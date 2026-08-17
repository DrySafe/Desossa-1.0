// ============================================================
// SYNC.js — comunicação com Supabase (leitura) e n8n (escrita/fila offline)
// ============================================================
let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Baixa dados de referência (colaboradores, catálogo, recebimentos abertos e suas peças) ----------
async function atualizarCacheReferencia() {
  try {
    const sb = getSupabase();
    const [{ data: colaboradores }, { data: cortes }, { data: recebimentos }] = await Promise.all([
      sb.from("colaboradores").select("id,nome,foto_url,pin_hash,ativo").eq("ativo", true),
      sb.from("cortes_catalogo").select("codigo,nome,preco_venda_kg,ativo").eq("ativo", true),
      sb.from("recebimentos").select("*").order("criado_em", { ascending: false })
    ]);
    if (colaboradores) await idbClearReplace(STORES.colaboradores, colaboradores);
    if (cortes) await idbClearReplace(STORES.cortes, cortes);
    if (recebimentos) await idbClearReplace(STORES.recebimentos, recebimentos);

    const recebimentosAbertos = (recebimentos || []).filter((r) => r.status === "aberto").map((r) => r.id);
    if (recebimentosAbertos.length) {
      const { data: view } = await sb.from("vw_rendimento_lote").select("*").in("recebimento_id", recebimentosAbertos);
      const lotes = (view || []).map((v) => ({
        id: v.lote_id,
        recebimento_id: v.recebimento_id,
        tipo: v.tipo,
        numero_peca: v.numero_peca,
        data_desossa: v.data_desossa,
        peso_entrada_kg: v.peso_liquido_kg,
        peso_total_desossado: Number(v.peso_total_desossado || 0)
      }));
      if (lotes.length) await idbClearReplace(STORES.lotes, lotes);
      else await idbClearReplace(STORES.lotes, []);
    } else {
      await idbClearReplace(STORES.lotes, []);
    }
    return true;
  } catch (err) {
    console.warn("Não foi possível atualizar cache de referência (provavelmente offline):", err);
    return false;
  }
}

// Preenche a data da desossa na primeira vez que alguém lança um corte dessa peça (best-effort, não bloqueia o lançamento)
async function garantirDataDesossa(lote) {
  if (lote.data_desossa) return;
  try {
    const sb = getSupabase();
    const hoje = new Date().toISOString().slice(0, 10);
    const { error } = await sb.from("lotes").update({ data_desossa: hoje }).eq("id", lote.id).is("data_desossa", null);
    if (!error) {
      lote.data_desossa = hoje;
      await idbPut(STORES.lotes, lote);
    }
  } catch (err) {
    console.warn("Não deu pra gravar a data da desossa agora (sem internet), tenta de novo depois:", err);
  }
}

// ---------- Recebimento (colaborador cadastra a chegada da carne) ----------
// Diferente do lançamento de cortes, isso precisa de conexão (não entra na fila offline por enquanto,
// já que normalmente é feito no recebimento/doca, onde o sinal costuma ser melhor que na desossa).
async function criarRecebimento(dados) {
  const sb = getSupabase();
  const { data, error } = await sb.from("recebimentos").insert(dados).select().single();
  if (error) throw error;
  await atualizarCacheReferencia();
  return data;
}

// Busca as peças de um recebimento DIRETO do banco (sem cache) — importante pra calcular o
// próximo número de peça (reaproveitando números de peças excluídas) sempre com o dado mais
// atual possível, mesmo sem dar refresh na página.
async function buscarPecasDoRecebimento(recebimentoId) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("lotes").select("*").eq("recebimento_id", recebimentoId).order("numero_peca");
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Sem internet ou erro ao buscar peças — usando cache local como melhor esforço:", err);
    return (await idbGetAll(STORES.lotes)).filter((l) => l.recebimento_id === recebimentoId);
  }
}

async function adicionarPeca(recebimentoId, { tipo, numero_peca, peso_bruto_kg, peso_entregador_usado_kg }) {
  const peso_entrada_kg = Math.round((peso_bruto_kg - peso_entregador_usado_kg) * 1000) / 1000;
  const sb = getSupabase();
  const { data, error } = await sb.from("lotes").insert({
    recebimento_id: recebimentoId,
    tipo, numero_peca, peso_bruto_kg, peso_entregador_usado_kg, peso_entrada_kg
  }).select().single();
  if (error) throw error;
  await atualizarCacheReferencia();
  return data;
}

async function atualizarPrecosRecebimento(id, preco_kg_dianteiro, preco_kg_traseiro, data_entrada) {
  const sb = getSupabase();
  const dados = { preco_kg_dianteiro, preco_kg_traseiro };
  if (data_entrada) dados.data_entrada = data_entrada;
  const { error } = await sb.from("recebimentos").update(dados).eq("id", id);
  if (error) throw error;
  await atualizarCacheReferencia();
}

async function finalizarRecebimento(id) {
  const sb = getSupabase();
  const { error } = await sb.from("recebimentos").update({ status: "finalizado" }).eq("id", id);
  if (error) throw error;
  await atualizarCacheReferencia();
}

async function reabrirRecebimento(id) {
  const sb = getSupabase();
  const { error } = await sb.from("recebimentos").update({ status: "aberto" }).eq("id", id);
  if (error) throw error;
  await atualizarCacheReferencia();
}

// Busca a contagem real de peças (Dianteiro/Traseiro) de QUALQUER recebimento, aberto ou
// finalizado — usa a view que já calcula isso, em vez de depender do cache de lotes (que só
// guarda peças de recebimentos abertos).
async function buscarProgressoRecebimentos() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("vw_recebimentos_progresso").select("*");
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn("Não deu pra buscar progresso dos recebimentos (offline?):", err);
    return [];
  }
}

// ---------- Gerenciamento de colaboradores (admin) ----------
async function buscarTodosColaboradores() {
  const sb = getSupabase();
  const { data, error } = await sb.from("colaboradores").select("*").order("nome");
  if (error) throw error;
  return data || [];
}

async function uploadFotoColaborador(arquivo, colaboradorIdOuTemp) {
  const sb = getSupabase();
  const extensao = arquivo.name.split(".").pop() || "jpg";
  const caminho = `${colaboradorIdOuTemp}-${Date.now()}.${extensao}`;
  const { error } = await sb.storage.from("colaboradores").upload(caminho, arquivo, { upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from("colaboradores").getPublicUrl(caminho);
  return data.publicUrl;
}

async function criarColaborador({ nome, foto_url, pin }) {
  const sb = getSupabase();
  const pin_hash = await sha256Hex(pin);
  const { error } = await sb.from("colaboradores").insert({ nome, foto_url: foto_url || null, pin_hash, ativo: true });
  if (error) throw error;
  await atualizarCacheReferencia();
}

async function editarColaborador(id, { nome, foto_url, pin }) {
  const sb = getSupabase();
  const dados = { nome };
  if (foto_url) dados.foto_url = foto_url;
  if (pin) dados.pin_hash = await sha256Hex(pin);
  const { error } = await sb.from("colaboradores").update(dados).eq("id", id);
  if (error) throw error;
  await atualizarCacheReferencia();
}

async function definirAtivoColaborador(id, ativo) {
  const sb = getSupabase();
  const { error } = await sb.from("colaboradores").update({ ativo }).eq("id", id);
  if (error) throw error;
  await atualizarCacheReferencia();
}

// ---------- Gerenciamento de cortes (admin) ----------
async function buscarTodosCortes() {
  const sb = getSupabase();
  const { data, error } = await sb.from("cortes_catalogo").select("*").order("nome");
  if (error) throw error;
  return data || [];
}

async function editarCorte(codigo, { nome, preco_venda_kg }) {
  const sb = getSupabase();
  const { error } = await sb.from("cortes_catalogo").update({ nome, preco_venda_kg, atualizado_em: new Date().toISOString() }).eq("codigo", codigo);
  if (error) throw error;
  await atualizarCacheReferencia();
}

async function definirAtivoCorte(codigo, ativo) {
  const sb = getSupabase();
  const { error } = await sb.from("cortes_catalogo").update({ ativo }).eq("codigo", codigo);
  if (error) throw error;
  await atualizarCacheReferencia();
}

// ---------- Exclusão de peça / lançamento (com log de auditoria) ----------
async function excluirLancamento(lancamentoId, colaboradorId) {
  const sb = getSupabase();
  const { data: registro } = await sb.from("lancamentos").select("*").eq("id", lancamentoId).maybeSingle();
  await sb.from("exclusoes_log").insert({
    tipo: "lancamento",
    registro_id: lancamentoId,
    dados_excluidos: registro,
    colaborador_id: colaboradorId
  });
  const { error } = await sb.from("lancamentos").delete().eq("id", lancamentoId);
  if (error) throw error;
  await idbDelete(STORES.lancamentosLote, lancamentoId);
  await registrarLog("info", "Lançamento de corte excluído", { lancamentoId, colaboradorId, registro });
}

async function excluirPeca(loteId, colaboradorId) {
  const sb = getSupabase();
  const { data: lote } = await sb.from("lotes").select("*").eq("id", loteId).maybeSingle();
  const { data: lancamentosDaPeca } = await sb.from("lancamentos").select("*").eq("lote_id", loteId);
  await sb.from("exclusoes_log").insert({
    tipo: "peca",
    registro_id: loteId,
    dados_excluidos: { lote, lancamentos: lancamentosDaPeca },
    colaborador_id: colaboradorId
  });
  const { error } = await sb.from("lotes").delete().eq("id", loteId);
  if (error) throw error;
  await atualizarCacheReferencia();
  await registrarLog("info", "Peça excluída (e todos os cortes dela)", { loteId, colaboradorId, lote, lancamentosDaPeca });
}

// ---------- Histórico de cortes já lançados numa peça (persistente, sobrevive a atualizar a página) ----------
async function buscarLancamentosDoLote(loteId) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("vw_lancamentos_detalhado")
      .select("id,lote_id,corte_nome,peso_kg,preco_venda_kg,venda_total,colaborador_nome,criado_em")
      .eq("lote_id", loteId)
      .order("criado_em", { ascending: false })
      .limit(100);
    if (error) throw error;
    for (const registro of data) {
      await idbPut(STORES.lancamentosLote, { ...registro, pendente: false });
    }
    return data;
  } catch (err) {
    console.warn("Não deu pra atualizar o histórico de cortes agora (sem internet?):", err);
    return null;
  }
}

async function lancamentosLocaisDoLote(loteId) {
  const registros = await idbGetAllByIndex(STORES.lancamentosLote, "lote_id", loteId);
  return registros.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
}

// IMPORTANTE: o app grava DIRETO no Supabase. O "sucesso" só é considerado sucesso
// quando o próprio banco confirma a gravação — nunca antes disso. O n8n entra depois,
// em segundo plano, só para espelhar no Google Sheets (ver workflow-desossa.json).
async function enfileirarLancamento(lancamento) {
  const idLancamento = lancamento.id || crypto.randomUUID(); // gerado no app.js, pra podermos reenviar com segurança
  const item = {
    id_local: idLancamento,
    payload: { ...lancamento, id: idLancamento },
    tentativas: 0,
    criado_em: new Date().toISOString()
  };
  await idbPut(STORES.fila, item);
  sincronizarFila(); // tenta gravar na hora; se falhar (ou offline), fica na fila e tenta de novo depois
  return item;
}

async function contarFilaPendente() {
  const itens = await idbGetAll(STORES.fila);
  return itens.length;
}

async function sincronizarFila() {
  if (!navigator.onLine) return;
  const itens = await idbGetAll(STORES.fila);
  const sb = getSupabase();
  let algumSucesso = false;

  for (const item of itens) {
    try {
      // Trava de segurança: se o item da fila estiver corrompido, limpa da fila
      if (!item || !item.payload || !item.payload.lote_id) {
        await idbDelete(STORES.fila, item.id_local);
        continue;
      }

      // CORREÇÃO: Se a origem veio como "calculado_quebra", altera para "manual"
      // para passar na validação do Supabase (lancamentos_origem_check)
      if (item.payload.origem === "calculado_quebra") {
        item.payload.origem = "manual";
      }

      const { error } = await sb.from("lancamentos").insert(item.payload);
      if (error) {
        // 23505 = Registro já gravado anteriormente -> Remove da fila
        // 23514 = Erro de validação do banco -> Não será aceito, remove da fila para destravar
        if (error.code === "23505" || error.code === "23514") {
          await idbDelete(STORES.fila, item.id_local);
          await registrarLog("info", `Item removido da fila (código ${error.code})`, item.payload);
          algumSucesso = true;
          continue; // Pula para o próximo item da fila
        }
        throw error;
      }

      await idbDelete(STORES.fila, item.id_local);
      algumSucesso = true;

      const registroLocal = await idbGet(STORES.lancamentosLote, item.payload.id);
      if (registroLocal) await idbPut(STORES.lancamentosLote, { ...registroLocal, pendente: false });

      await registrarLog("sucesso", "Sincronizado com o Supabase", item.payload);
    } catch (err) {
      item.tentativas += 1;
      await idbPut(STORES.fila, item);
      await registrarLog("erro", "Falha ao gravar no Supabase — vai tentar de novo", {
        erro: err?.message || String(err), code: err?.code, details: err?.details, hint: err?.hint, payload: item.payload
      });
      console.warn("Não gravou no Supabase ainda, vai tentar de novo:", err);
    }
  }

  if (algumSucesso) await atualizarCacheReferencia();
  if (typeof atualizarBadgePendente === "function") atualizarBadgePendente();
}

// Apelido para garantir compatibilidade com o clique manual no celular (app.js)
const tentarEnviarFila = sincronizarFila;

// Tenta sincronizar sempre que a conexão voltar
window.addEventListener("online", () => sincronizarFila());
setInterval(() => sincronizarFila(), 30000); // tentativa de segurança a cada 30s
