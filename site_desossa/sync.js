// ============================================================
// SYNC.js — comunicação com Supabase (leitura) e n8n (escrita/fila offline)
// ============================================================
let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = criarClienteTeste();
  }
  return supabaseClient;
}

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Paginação por chave estável; erros nunca viram uma lista vazia.
async function buscarTodasPaginas(criarQuery) {
  const registros = []; let esperado = null;
  for (let offset = 0; ; offset += 500) {
    const { data, error, count } = await criarQuery().range(offset, offset + 499);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isInteger(count)) throw new Error("Consulta sem confirmação de total.");
    if (esperado !== null && esperado !== count) throw new Error("Dados mudaram durante a consulta. Tente novamente.");
    esperado = count;
    registros.push(...data);
    if (registros.length === count) return registros;
    if (!data.length || registros.length > count) throw new Error("Consulta incompleta.");
  }
}
async function atualizarCacheReferencia() {
  try {
    const sb = getSupabase();
    const [colaboradores, cortes, recebimentos, view] = await Promise.all([
      buscarTodasPaginas(() => sb.from("colaboradores").select("id,nome,foto_url,ativo,nivel_acesso", { count: "exact" }).eq("ativo", true).order("id")),
      buscarTodasPaginas(() => sb.from("cortes_catalogo").select("*", { count: "exact" }).eq("ativo", true).order("codigo")),
      buscarTodasPaginas(() => sb.from("recebimentos").select("*", { count: "exact" }).order("id")),
      buscarTodasPaginas(() => sb.from("vw_rendimento_lote").select("*", { count: "exact" }).order("lote_id"))
    ]);
    const abertos = new Set(recebimentos.filter(r => r.status === "aberto").map(r => r.id));
    const lotes = view.filter(v => (!v.recebimento_id || abertos.has(v.recebimento_id)) && v.status_lote !== "fechado").map(v => ({
      id: v.lote_id, recebimento_id: v.recebimento_id, tipo: v.tipo, numero_peca: v.numero_peca, status: v.status_lote,
      data_desossa: v.data_desossa, peso_entrada_kg: v.peso_liquido_kg,
      peso_total_desossado: Number(v.peso_total_desossado || 0)
    }));
    await idbSubstituirCaches({ [STORES.colaboradores]: colaboradores, [STORES.cortes]: cortes,
      [STORES.recebimentos]: recebimentos, [STORES.lotes]: lotes });
    return true;
  } catch (err) {
    console.warn("Referências não atualizadas; cache anterior preservado.", err.message);
    return false;
  }
}

// Preenche a data da desossa na primeira vez que alguém lança um corte dessa peça (best-effort, não bloqueia o lançamento)
async function garantirDataDesossa(lote) {
  if (lote.data_desossa) return;
  try {
    const sb = getSupabase();
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
  if (!['image/jpeg','image/png','image/webp'].includes(arquivo.type) || arquivo.size > 2 * 1024 * 1024) throw new Error('Escolha uma foto JPG, PNG ou WebP de até 2 MB.');
  const extensao = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[arquivo.type];
  const caminho = `${colaboradorIdOuTemp}-${Date.now()}.${extensao}`;
  const resposta = await fetch('/api/photo?name='+encodeURIComponent(caminho), { method:'POST', credentials:'same-origin', headers:{'Content-Type':arquivo.type}, body:arquivo });
  const data = await resposta.json();
  if (!resposta.ok) throw new Error(data.message || 'Upload não confirmado.');
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
async function excluirLancamento(lancamentoId) {
  const { error } = await getSupabase().rpc('app_excluir', { p_tipo:'lancamento', p_id:lancamentoId });
  if(error)throw error;
  await idbDelete(STORES.lancamentosLote,lancamentoId);
}
async function excluirPeca(loteId) {
  const { error } = await getSupabase().rpc('app_excluir', { p_tipo:'peca', p_id:loteId });
  if(error)throw error;
  await atualizarCacheReferencia();
}

// ---------- Histórico de cortes já lançados numa peça (persistente, sobrevive a atualizar a página) ----------
async function buscarLancamentosDoLote(loteId) {
  try {
    const sb = getSupabase();
    const data = await buscarTodasPaginas(() => sb.from("vw_lancamentos_detalhado")
      .select("id,lote_id,corte_codigo,corte_nome,peso_kg,preco_venda_kg,venda_total,colaborador_nome,criado_em", { count: "exact" })
      .eq("lote_id", loteId).order("id"));
    await idbReconciliarHistorico(loteId, data);
    return data;
  } catch (err) {
    console.warn("Histórico não confirmado; preservado no aparelho.", err.message);
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
async function enfileirarLancamento(lancamento, registroLocal) {
  const id = lancamento.id || crypto.randomUUID();
  const item = { id_local: id, payload: { ...lancamento, id }, tentativas: 0, criado_em: new Date().toISOString() };
  if (!registroLocal) throw new Error("Histórico local obrigatório para salvar com segurança.");
  await idbSalvarLancamento(item, { ...registroLocal, id, pendente: true });
  return item;
}
async function contarFilaPendente() { return (await idbGetAll(STORES.fila)).length; }

function mesmoLancamento(a, b) {
  if (!a || !b) return false;
  const texto = ['id', 'lote_id', 'corte_codigo', 'colaborador_id', 'origem'];
  return texto.every(k => String(a[k]) === String(b[k]))
    && Number(a.peso_kg) === Number(b.peso_kg)
    && ((a.preco_venda_kg == null && b.preco_venda_kg == null) || (a.preco_venda_kg != null && b.preco_venda_kg != null && Number(a.preco_venda_kg) === Number(b.preco_venda_kg)));
}
let sincronizacaoEmCurso = null;
let sincronizacaoAutorizada = false;
async function executarSincronizacao() {
  try { validarConfiguracaoTeste(); } catch { return; }
  if (!navigator.onLine || !sincronizacaoAutorizada) return;
  const sb = getSupabase();
  for (const item of await idbGetAll(STORES.fila)) {
    try {
      if (!item || !item.payload || !item.payload.lote_id) throw new Error('Item incompleto; exporte as pendências para recuperação.');
      if (item.payload.origem === 'calculado_quebra') item.payload.origem = 'manual';
      const { error } = await sb.from('lancamentos').insert(item.payload);
      if (error?.code === '23505') {
        const { data, error: erroConsulta } = await sb.from('lancamentos').select('*').eq('id', item.payload.id).maybeSingle();
        if (erroConsulta) throw erroConsulta;
        if (!mesmoLancamento(item.payload, data)) throw new Error('Conflito de identificador; pendência preservada para conferência.');
      } else if (error) throw error;
      const registro = await idbGet(STORES.lancamentosLote, item.payload.id);
      if (registro) await idbPut(STORES.lancamentosLote, { ...registro, pendente: false });
      await idbDelete(STORES.fila, item.id_local);
      await registrarLog('sucesso', 'Gravação confirmada no banco de testes', { id: item.payload.id });
    } catch (err) {
      if (item?.id_local) await idbPut(STORES.fila, { ...item, tentativas: Number(item.tentativas || 0) + 1,
        ultimo_erro: err.message || String(err), codigo_erro: err.code || null, ultima_tentativa: new Date().toISOString() });
      await registrarLog('erro', 'Registro NÃO confirmado; pendência preservada', { id: item?.id_local, erro: err.message, codigo: err.code });
    }
  }
  if (typeof atualizarBadgePendente === 'function') atualizarBadgePendente();
}
function sincronizarFila() {
  if (sincronizacaoEmCurso) return sincronizacaoEmCurso;
  const run = () => executarSincronizacao();
  sincronizacaoEmCurso = (navigator.locks ? navigator.locks.request('desossa-test-sync', run) : run())
    .finally(() => { sincronizacaoEmCurso = null; });
  return sincronizacaoEmCurso;
}
const tentarEnviarFila = sincronizarFila;
window.addEventListener('online', () => sincronizarFila().catch(console.warn));
setInterval(() => sincronizarFila().catch(console.warn), 30000);

async function cancelarPendencia(id, usuarioId) {
  const run = async () => {
    const item = await idbGet(STORES.fila, id);
    if (!item) return excluirLancamento(id);
    if (item.payload?.colaborador_id !== usuarioId) throw new Error('Pendência de outro colaborador.');
    const db = await openDB();
    await new Promise((resolve,reject) => {
      const tx = db.transaction([STORES.fila,STORES.lancamentosLote,STORES.logs], 'readwrite');
      tx.objectStore(STORES.logs).put({id:crypto.randomUUID(),quando:new Date().toISOString(),nivel:'info',mensagem:'Pendência cancelada pelo usuário',detalhes:JSON.stringify({id,usuarioId,payload:item.payload})});
      tx.objectStore(STORES.fila).delete(id);tx.objectStore(STORES.lancamentosLote).delete(id);
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Cancelamento não confirmado.'));
    });
  };
  if(navigator.locks)return navigator.locks.request('desossa-test-sync',run);
  if(sincronizacaoEmCurso)await sincronizacaoEmCurso;
  return run();
}
