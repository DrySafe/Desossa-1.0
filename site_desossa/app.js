// ============================================================
// APP.js — telas e navegação (vanilla JS, sem build step)
// ============================================================
const el = document.getElementById("app");
const nav = document.getElementById("bottom-nav");

let abaLoteAtual = "abertos"; // Guarda a aba selecionada pelo usuário (abertos x concluidos)

const state = {
  usuario: null,        // colaborador logado
  loteAtivo: null,       // lote (peça) selecionado para lançar
  colaboradores: [],
  cortes: [],
  recebimentos: [],
  progressoRecebimentos: [],
  recebimentoEmEdicao: null,
  lotes: [],
  candidatoLogin: null   // colaborador escolhido na grade, aguardando PIN
};

function fmtKg(n) { return (Math.round((n + Number.EPSILON) * 1000) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 3 }); }
function fmtR$(n) { return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

function fmtDataLocal(data) {
  if (!data) return "—";
  const iso = String(data).length === 10 ? `${data}T00:00:00` : data;
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ---------- Router ----------
function irPara(rota) {
  location.hash = rota;
}
window.addEventListener("hashchange", renderRota);

async function renderRota() {
  const rota = (location.hash || "#login").slice(1);

  if (rota === "admin") return renderAdmin();
  if (rota.startsWith("relatorio-")) return renderRelatorioRecebimento(rota.replace("relatorio-", ""));
  if (rota.startsWith("desossa-")) return renderRelatorioDesossa(rota.replace("desossa-", "")); // <-- ADICIONADO

  if (!state.usuario) {
    nav.classList.add("hidden");
    if (state.candidatoLogin) return renderPin();
    return renderLogin();
  }

  nav.classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.route === rota));

  if (rota === "lote") {
    if (navigator.onLine) {
      el.innerHTML = `<div class="screen lote-screen"><p class="empty-msg">Conferindo peças no servidor…</p></div>`;
      await atualizarCacheReferencia();
      state.progressoRecebimentos = await buscarProgressoRecebimentos();
    }
    state.lotes = await idbGetAll(STORES.lotes);
    state.recebimentos = await idbGetAll(STORES.recebimentos);
    return renderLote();
  }
  if (rota === "novo-recebimento") return renderNovoRecebimento();
  if (rota === "add-pecas") return renderAddPecas();
  if (rota === "perfil") return renderPerfil();
  if (rota === "trocar") return trocarUsuario();
  return renderLancar();
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-btn");
  if (btn) irPara(btn.dataset.route);
});

// ---------- Login: grade de fotos ----------
function renderLogin() {
  const cards = state.colaboradores.map((c) => `
    <button class="login-card" data-id="${c.id}">
      <div class="login-avatar" style="background-image:url('${c.foto_url || ""}')">
        ${c.foto_url ? "" : (c.nome || "?").trim().charAt(0).toUpperCase()}
      </div>
      <span class="login-nome">${c.nome}</span>
    </button>
  `).join("");

  el.innerHTML = `
    <div class="screen login-screen">
      <div class="brand-mark">DESOSSA</div>
      <h1 class="login-title">Quem é você?</h1>
      <div class="login-grid">
        ${cards || '<p class="empty-msg">Nenhum colaborador cadastrado ainda.</p>'}
      </div>
      <button class="link-discreto" id="btn-area-gestor">Área do gestor</button>
      <button class="link-discreto" id="btn-forcar-atualizacao">🔄 Forçar atualização do app</button>
    </div>
  `;

  el.querySelectorAll(".login-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.candidatoLogin = state.colaboradores.find((c) => c.id === btn.dataset.id);
      renderPin();
    });
  });
  document.getElementById("btn-area-gestor").addEventListener("click", () => irPara("admin"));
  document.getElementById("btn-forcar-atualizacao").addEventListener("click", forcarAtualizacaoApp);
}

async function forcarAtualizacaoApp() {
  if (!confirm("Isso vai buscar a versão mais nova do app. Seus lançamentos pendentes de envio NÃO serão apagados. Continuar?")) return;
  try {
    if ("serviceWorker" in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      for (const r of registros) await r.unregister();
    }
    if ("caches" in window) {
      const chaves = await caches.keys();
      for (const k of chaves) await caches.delete(k);
    }
    mostrarToast("Atualizando…");
    setTimeout(() => location.reload(), 500);
  } catch (err) {
    alert("Não consegui atualizar sozinho. Tente limpar os dados do site pelas configurações do navegador.");
  }
}

async function renderRelatorioDesossa(recebimentoId) {
  nav.classList.add("hidden");
  const rec = state.recebimentos.find((r) => r.id === recebimentoId);
  if (!rec) return irPara("lote");

  const pecas = await buscarPecasDoRecebimento(rec.id);
  const sb = getSupabase();

  // Busca todos os lançamentos das peças deste recebimento
  const idsPecas = pecas.map((p) => p.id);
  let lancamentos = [];
  if (idsPecas.length > 0) {
    const { data } = await sb.from("vw_lancamentos_detalhado").select("*").in("lote_id", idsPecas);
    lancamentos = data || [];
  }

  // Separa peças por tipo
  const dianteiros = pecas.filter((p) => p.tipo === "dianteiro").sort((a, b) => a.numero_peca - b.numero_peca);
  const traseiros = pecas.filter((p) => p.tipo === "traseiro").sort((a, b) => a.numero_peca - b.numero_peca);

  // Função auxiliar para montar a tabela de matriz com totais de coluna e geral
  function criarTabelaMatriz(listaPecas, titulo) {
    if (!listaPecas.length) return `<p class="empty-msg">Nenhuma peça de ${titulo} cadastrada.</p>`;

    // Mapeia todos os cortes que apareceram nestas peças
    const cortesMap = {};
    const idsLista = listaPecas.map((p) => p.id);
    const lancamentosDoTipo = lancamentos.filter((l) => idsLista.includes(l.lote_id));

    // Acumuladores de totais por coluna (por peça)
    const totaisPorPeca = {};
    listaPecas.forEach((p) => { totaisPorPeca[p.id] = 0; });
    let totalGeralTipo = 0;

    lancamentosDoTipo.forEach((l) => {
      const nomeCorte = l.corte_nome;
      const peso = Number(l.peso_kg || 0);

      cortesMap[nomeCorte] = cortesMap[nomeCorte] || {};
      cortesMap[nomeCorte][l.lote_id] = (cortesMap[nomeCorte][l.lote_id] || 0) + peso;

      totaisPorPeca[l.lote_id] = (totaisPorPeca[l.lote_id] || 0) + peso;
      totalGeralTipo += peso;
    });

    const nomesCortes = Object.keys(cortesMap).sort();

    return `
      <h3 style="font-family:var(--display); font-size:18px; margin:20px 0 10px; color:#1E2422; text-transform:uppercase;">
        Cortes de ${titulo}
      </h3>
      <div style="overflow-x:auto; margin-bottom:20px;">
        <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
          <thead>
            <tr style="background:#1E2422; color:#ffffff;">
              <th style="padding:8px 10px;">Carne / Corte</th>
              ${listaPecas.map((p) => `<th style="padding:8px 10px; text-align:right;">Peça ${p.numero_peca}</th>`).join("")}
              <th style="padding:8px 10px; text-align:right; background:#2A3330;">TOTAL CARNE (kg)</th>
            </tr>
          </thead>
          <tbody>
            ${nomesCortes.map((corte) => {
              let totalLinha = 0;
              return `
                <tr style="border-bottom:1px solid #DADFDC;">
                  <td style="padding:8px 10px; font-weight:600;">${corte}</td>
                  ${listaPecas.map((p) => {
                    const peso = cortesMap[corte][p.id] || 0;
                    totalLinha += peso;
                    return `<td style="padding:8px 10px; text-align:right;">${peso > 0 ? fmtKg(peso) : "—"}</td>`;
                  }).join("")}
                  <td style="padding:8px 10px; text-align:right; font-weight:bold; background:#F4F5F3;">${fmtKg(totalLinha)} kg</td>
                </tr>
              `;
            }).join("") || '<tr><td colspan="10" style="padding:12px; text-align:center; color:#5B655F;">Nenhum corte lançado para este tipo ainda.</td></tr>'}
          </tbody>
          <!-- LINHA DE TOTAL POR PEÇA E SOMA GERAL -->
          <tfoot>
            <tr style="background:#E2E7E4; font-weight:bold; border-top:2px solid #1E2422;">
              <td style="padding:10px; text-transform:uppercase;">TOTAL PEÇA (kg)</td>
              ${listaPecas.map((p) => `
                <td style="padding:10px; text-align:right; color:var(--success); font-size:13px;">
                  ${fmtKg(totaisPorPeca[p.id] || 0)} kg
                </td>
              `).join("")}
              <td style="padding:10px; text-align:right; background:#1E2422; color:#ffffff; font-size:13px;">
                ${fmtKg(totalGeralTipo)} kg
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  // Cálculo do Total Geral do Recebimento (Dianteiro + Traseiro)
  const pesoTotalDesossadoGeral = lancamentos.reduce((s, l) => s + Number(l.peso_kg || 0), 0);

  el.innerHTML = `
    <div class="screen relatorio-print-area" style="max-width:900px; width:100%; margin:20px auto; background:#ffffff; color:#1E2422; padding:24px; border-radius:16px; border:1px solid #DADFDC; box-shadow:0 4px 12px rgba(0,0,0,0.05); height:auto !important; min-height:auto !important;">
      
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;" class="no-print">
        <button class="voltar" onclick="irPara('lote')" style="margin:0; cursor:pointer;">‹ Voltar</button>
        <button onclick="window.print()" class="botao-grande botao-confirmar" style="width:auto; padding:10px 20px; font-size:15px; margin:0; cursor:pointer;">
          🖨️ Imprimir / Salvar PDF
        </button>
      </div>

      <div style="border-bottom:2px solid #1E2422; padding-bottom:12px; margin-bottom:16px;">
        <h2 style="font-family:var(--display); font-size:24px; margin:0 0 4px; text-transform:uppercase; color:#1E2422;">
          Relatório de Desossa — ${rec.fornecedor}
        </h2>
        <span style="color:#5B655F; font-size:13px;">Data: ${fmtDataLocal(rec.data_entrada)} | Placa: ${rec.placa_veiculo || '—'}</span>
      </div>

      ${criarTabelaMatriz(dianteiros, "Dianteiro")}
      ${criarTabelaMatriz(traseiros, "Traseiro")}

      <!-- RESUMO FINAL COMBINADO -->
      <div style="display:flex; justify-content:flex-end; align-items:center; gap:16px; background:#1E2422; color:#ffffff; padding:16px 20px; border-radius:12px; margin-top:20px;">
        <span style="font-size:14px; text-transform:uppercase; letter-spacing:0.5px;">Total Geral Desossado do Recebimento:</span>
        <strong style="font-size:20px; color:#4EFA96;">${fmtKg(pesoTotalDesossadoGeral)} kg</strong>
      </div>

    </div>
  `;
}

// ---------- PIN ----------
let pinDigitado = "";
function renderPin() {
  const c = state.candidatoLogin;
  pinDigitado = "";
  el.innerHTML = `
    <div class="screen pin-screen">
      <button class="voltar" id="pin-voltar">‹ Voltar</button>
      <div class="pin-avatar" style="background-image:url('${c.foto_url || ""}')">
        ${c.foto_url ? "" : (c.nome || "?").trim().charAt(0).toUpperCase()}
      </div>
      <h2 class="pin-nome">${c.nome}</h2>
      <p class="pin-label">Digite seu PIN</p>
      <div class="pin-dots" id="pin-dots">
        ${[0,1,2,3].map(() => '<span class="dot"></span>').join("")}
      </div>
      <div id="pin-erro" class="pin-erro hidden">PIN incorreto, tente de novo</div>
      <div class="teclado">
        ${["1","2","3","4","5","6","7","8","9","","0","⌫"].map((n) =>
          n === "" ? '<span></span>' : `<button class="tecla" data-tecla="${n}">${n}</button>`
        ).join("")}
      </div>
    </div>
  `;
  document.getElementById("pin-voltar").addEventListener("click", () => {
    state.candidatoLogin = null;
    renderLogin();
  });
  el.querySelectorAll(".tecla").forEach((t) => t.addEventListener("click", () => onTeclaPin(t.dataset.tecla)));
}

async function onTeclaPin(tecla) {
  const erroEl = document.getElementById("pin-erro");
  if (erroEl) erroEl.classList.add("hidden");

  // Trava de segurança contra estado nulo
  if (!state.candidatoLogin) {
    mostrarToast("Selecione um usuário para continuar.");
    return irPara("login");
  }

  if (tecla === "⌫") { 
    pinDigitado = pinDigitado.slice(0, -1); 
  } else if (pinDigitado.length < 4) { 
    pinDigitado += tecla; 
  }

  document.querySelectorAll("#pin-dots .dot").forEach((d, i) => d.classList.toggle("preenchido", i < pinDigitado.length));

  if (pinDigitado.length === 4) {
    const hash = await sha256Hex(pinDigitado);
    
    if (state.candidatoLogin.pin_hash && hash === state.candidatoLogin.pin_hash) {
      state.usuario = state.candidatoLogin;
      state.candidatoLogin = null;
      await salvarSessao(state.usuario);
      pinDigitado = "";
      irPara("lancar"); // O 'hashchange' já se encarrega de chamar o renderRota() sozinho
    } else {
      if (erroEl) erroEl.classList.remove("hidden");
      setTimeout(() => { 
        pinDigitado = ""; 
        document.querySelectorAll("#pin-dots .dot").forEach((d) => d.classList.remove("preenchido")); 
      }, 500);
    }
  }
}

// ---------- Perfil ----------
function renderPerfil() {
  const u = state.usuario;
  el.innerHTML = `
    <div class="screen pin-screen">
      <button class="voltar" id="perfil-voltar">‹ Voltar</button>
      <div class="pin-avatar" id="perfil-avatar" style="background-image:url('${u.foto_url || ""}')">
        ${u.foto_url ? "" : u.nome.charAt(0).toUpperCase()}
      </div>
      <h2 class="pin-nome">${u.nome}</h2>
      <p class="pin-label">Meu perfil</p>

      <div class="botoes-linha" style="justify-content:center; margin-bottom:18px;">
        <button type="button" class="botao-secundario" id="btn-perfil-tirar-foto">📷 Tirar foto</button>
        <button type="button" class="botao-secundario" id="btn-perfil-escolher-foto">🖼️ Galeria</button>
      </div>
      <input type="file" accept="image/*" capture="environment" id="perfil-input-camera" class="hidden" />
      <input type="file" accept="image/*" id="perfil-input-galeria" class="hidden" />
      <span id="perfil-nome-foto" class="rotulo-campo"></span>

      <form id="form-perfil" class="admin-form" style="margin-top:18px;">
        <input type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Seu PIN atual" id="perfil-pin-atual" required />
        <input type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Novo PIN (deixe em branco pra manter)" id="perfil-pin-novo" />
        <input type="password" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Confirmar novo PIN" id="perfil-pin-confirmar" />
        <button type="submit" class="botao-grande botao-confirmar">Salvar alterações</button>
      </form>
    </div>
  `;
  document.getElementById("perfil-voltar").addEventListener("click", () => irPara("lancar"));

  let fotoSelecionada = null;
  const inputCamera = document.getElementById("perfil-input-camera");
  const inputGaleria = document.getElementById("perfil-input-galeria");
  const avatar = document.getElementById("perfil-avatar");
  const nomeFotoEl = document.getElementById("perfil-nome-foto");

  document.getElementById("btn-perfil-tirar-foto").addEventListener("click", () => inputCamera.click());
  document.getElementById("btn-perfil-escolher-foto").addEventListener("click", () => inputGaleria.click());
  function onFotoEscolhida(e) {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    fotoSelecionada = arquivo;
    avatar.style.backgroundImage = `url('${URL.createObjectURL(arquivo)}')`;
    avatar.textContent = "";
    nomeFotoEl.textContent = `Selecionada: ${arquivo.name}`;
  }
  inputCamera.addEventListener("change", onFotoEscolhida);
  inputGaleria.addEventListener("change", onFotoEscolhida);

  document.getElementById("form-perfil").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pinAtual = document.getElementById("perfil-pin-atual").value.trim();
    const pinNovo = document.getElementById("perfil-pin-novo").value.trim();
    const pinConfirmar = document.getElementById("perfil-pin-confirmar").value.trim();

    const hashAtual = await sha256Hex(pinAtual);
    if (hashAtual !== u.pin_hash) return alert("PIN atual incorreto.");

    if (pinNovo || pinConfirmar) {
      if (!/^\d{4}$/.test(pinNovo)) return alert("O novo PIN precisa ter exatamente 4 números.");
      if (pinNovo !== pinConfirmar) return alert("Os dois campos de novo PIN não são iguais.");
    }
    if (!fotoSelecionada && !pinNovo) return alert("Nada pra salvar — escolha uma foto nova ou digite um novo PIN.");

    const botao = e.target.querySelector("button[type=submit]");
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Salvando…";
    try {
      let foto_url = null;
      if (fotoSelecionada) foto_url = await uploadFotoColaborador(fotoSelecionada, u.id);
      await editarColaborador(u.id, { nome: u.nome, foto_url, pin: pinNovo || null });

      if (foto_url) u.foto_url = foto_url;
      if (pinNovo) u.pin_hash = await sha256Hex(pinNovo);
      state.usuario = u;
      await salvarSessao(u);

      mostrarToast("Perfil atualizado!");
      irPara("lancar");
      renderRota();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  });
}

async function trocarUsuario() {
  state.usuario = null;
  state.loteAtivo = null;
  await limparSessao();
  irPara("login");
  renderRota();
}

// ---------- Lançar (tela principal) ----------
let scannerAberto = false;
let leituraAtual = null;

function renderLancar() {
  const lote = state.loteAtivo;
  const recebimentoDoLote = lote ? state.recebimentos.find((r) => r.id === lote.recebimento_id) : null;
  leituraAtual = null;
  scannerAberto = false;

  el.innerHTML = `
    <div class="screen lancar-screen">
      <header class="topo">
        <button class="topo-usuario" id="btn-meu-perfil">
          <div class="mini-avatar" style="background-image:url('${state.usuario.foto_url || ""}')">
            ${state.usuario.foto_url ? "" : state.usuario.nome.charAt(0).toUpperCase()}
          </div>
          <span>${state.usuario.nome}</span>
        </button>
      </header>

      ${lote ? `
        <button class="lote-chip" id="lote-chip-trocar">
          <div class="lote-chip-topo">
            <span class="lote-tipo">${lote.tipo.toUpperCase()} — peça ${lote.numero_peca}</span>
            <span class="lote-chip-trocar-label">Trocar ⇄</span>
          </div>
          <span>${fmtKg(lote.peso_entrada_kg)} kg líquido</span>
          <div class="lote-chip-detalhes">
            ${recebimentoDoLote ? `<span>Fornecedor: ${recebimentoDoLote.fornecedor}</span>` : ""}
            ${recebimentoDoLote ? `<span>Recebimento: ${fmtDataLocal(recebimentoDoLote.data_entrada)}</span>` : ""}
            <span>Desossa: ${lote.data_desossa ? fmtDataLocal(lote.data_desossa) : "hoje"}</span>
          </div>
        </button>
      ` : `
        <div class="aviso-caixa">
          <p>Nenhuma peça selecionada.</p>
          <button class="botao-secundario" id="ir-lote">Escolher peça</button>
        </div>
      `}

      <div id="visor-area"></div>

      <div class="acoes-lancar ${lote ? "" : "disabled"}">
        <button class="botao-grande botao-escanear" id="btn-escanear" ${lote ? "" : "disabled"}>
          <span class="icone-grande">▤</span> Escanear etiqueta
        </button>
        <button class="botao-secundario" id="btn-manual" ${lote ? "" : "disabled"}>Digitar corte manualmente</button>
      </div>

      <div id="lista-recentes"></div>
    </div>
  `;
  document.getElementById("btn-meu-perfil").addEventListener("click", () => irPara("perfil"));

  if (!lote) {
    document.getElementById("ir-lote").addEventListener("click", () => irPara("lote"));
  } else {
    document.getElementById("lote-chip-trocar").addEventListener("click", () => irPara("lote"));
    document.getElementById("btn-escanear").addEventListener("click", abrirScanner);
    document.getElementById("btn-manual").addEventListener("click", abrirEntradaManual);
    carregarRecentes();
  }
}

// ---------- Lançamento Automático de Quebra ----------
async function lancarQuebraAutomatica(pesoQuebraKg) {
  const pesoFormatado = fmtKg(pesoQuebraKg);
  if (!confirm(`Confirmar lançamento da QUEBRA no valor de ${pesoFormatado} kg?`)) return;

  const corteQuebra = state.cortes.find(c => c.nome.toUpperCase().includes("QUEBRA"));

  const codigoCorte = corteQuebra ? corteQuebra.codigo : "QUEBRA";
  const nomeCorte = corteQuebra ? corteQuebra.nome : "QUEBRA";
  const precoKg = corteQuebra ? corteQuebra.preco_venda_kg : 0;

  try {
    await salvarLancamento({
      codigo: codigoCorte,
      nome: nomeCorte,
      peso: parseFloat(pesoQuebraKg.toFixed(3)),
      preco: precoKg
    }, "manual"); // <-- ALTERADO AQUI: de "calculado_quebra" para "manual"

    mostrarToast(`Quebra de ${pesoFormatado} kg lançada com sucesso!`);
  } catch (err) {
    alert("Erro ao lançar a quebra: " + err.message);
  }
}

function renderVisor(dados) {
  const area = document.getElementById("visor-area");
  if (!dados) { area.innerHTML = ""; return; }
  area.innerHTML = `
    <div class="visor-balanca">
      <div class="visor-linha visor-corte">${dados.nome || "CÓDIGO NÃO CADASTRADO"}</div>
      <div class="visor-linha visor-peso">
        <input type="number" inputmode="decimal" step="0.001" id="input-peso" value="${dados.peso ?? ""}" placeholder="peso kg" />
        <span class="visor-unidade">kg</span>
      </div>
      <div class="visor-linha visor-preco">
        <span class="visor-preco-rotulo">R$/kg</span>
        <input type="number" inputmode="decimal" step="0.01" id="input-preco" value="${dados.preco ?? ""}" placeholder="preço/kg" />
      </div>
      ${dados.valorTotal != null
        ? `<p class="visor-preco-dica">Total lido da etiqueta: ${fmtR$(dados.valorTotal)} — digite o peso pra calcular o R$/kg sozinho</p>`
        : dados.precoVeioDaEtiqueta ? "" : '<p class="visor-preco-dica">Confira se o preço bate com o da etiqueta de hoje</p>'}
    </div>
    <div class="confirmar-linha">
      <button class="botao-secundario" id="btn-cancelar-leitura">Cancelar</button>
      <button class="botao-grande botao-confirmar" id="btn-confirmar-leitura">Confirmar lançamento</button>
    </div>
  `;
  document.getElementById("btn-cancelar-leitura").addEventListener("click", () => { pararScanner(); renderLancar(); });
  document.getElementById("btn-confirmar-leitura").addEventListener("click", confirmarLancamento);

  if (dados.valorTotal != null) {
    document.getElementById("input-peso").addEventListener("input", (e) => {
      const peso = parseFloat(e.target.value);
      const campoPreco = document.getElementById("input-preco");
      if (peso > 0) campoPreco.value = (dados.valorTotal / peso).toFixed(2);
    });
  }
}

let flashLigado = false;
async function alternarFlash() {
  try {
    const video = document.getElementById("video-scanner");
    const track = video?.srcObject?.getVideoTracks?.()[0];
    if (!track) return mostrarToast("Câmera ainda carregando, espera 1 segundo e tenta de novo.");
    const capacidades = track.getCapabilities ? track.getCapabilities() : {};
    if (!capacidades.torch) return mostrarToast("Esse celular/câmera não permite ligar o flash pelo navegador.");
    flashLigado = !flashLigado;
    await track.applyConstraints({ advanced: [{ torch: flashLigado }] });
    document.getElementById("btn-flash")?.classList.toggle("flash-ativo", flashLigado);
  } catch (err) {
    registrarLog("erro", "Falha ao alternar flash", String(err));
    mostrarToast("Não consegui controlar o flash nesse aparelho.");
  }
}

// ============================================================
// SCANNER MÚLTIPLO (LOTE DE ETIQUETAS)
// ============================================================
let leiturasLote = new Map();

async function abrirScanner() {
  scannerAberto = true;
  flashLigado = false;
  leiturasLote.clear();

  el.innerHTML = `
    <div class="screen scanner-screen" style="display:flex; flex-direction:column; height:100vh; overflow:hidden;">
      <header class="topo-scanner" style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:#000; color:#fff; flex-shrink:0;">
        <button class="voltar" id="scanner-voltar">‹ Voltar</button>
        <button class="botao-flash" id="btn-flash">💡 Flash</button>
      </header>
      
      <div class="video-wrap" style="position:relative; width:100%; height:38vh; background:#000; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden;">
        <video id="video-scanner" class="video-scanner" autoPlay muted playsinline style="width:100%; height:100%; object-fit:cover; display:block;"></video>
        <div class="mira-scanner" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); border:3px solid #00ff00; border-radius:12px; width:80%; height:50%; pointer-events:none; box-sizing:border-box; box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);"></div>
      </div>

      <div class="painel-leituras" style="flex:1; padding:12px; display:flex; flex-direction:column; background:var(--bg-main, #fff); min-height:0; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-shrink:0;">
          <h3 style="margin:0; font-size:16px;">Etiquetas (<span id="qtd-lidas">0</span>)</h3>
          <button class="botao-grande botao-confirmar" id="btn-concluir-lote" style="width:auto; padding:8px 16px; margin:0;">
            Salvar Selecionadas
          </button>
        </div>
        
        <div id="lista-lote-lido" style="flex:1; overflow-y:auto; border:1px solid #ccc; border-radius:8px; padding:8px;">
          <p class="empty-msg">Aproxime a câmera das etiquetas para ler...</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById("scanner-voltar").addEventListener("click", () => { 
    pararScanner(); 
    renderLancar(); 
  });
  
  document.getElementById("btn-flash").addEventListener("click", alternarFlash);
  document.getElementById("btn-concluir-lote").addEventListener("click", confirmarLoteCompleto);

  try {
    await iniciarScanner("video-scanner", (decodificado) => {
      if (!decodificado || !decodificado.codigoBruto) return;
      if (leiturasLote.has(decodificado.codigoBruto)) return;

      const corte = state.cortes.find((c) => String(c.codigo) === String(decodificado.codigo));
      
      let precoCalculado = decodificado.preco ?? (corte ? corte.preco_venda_kg : null);
      if (decodificado.valorTotal != null && decodificado.peso > 0) {
        precoCalculado = parseFloat((decodificado.valorTotal / decodificado.peso).toFixed(2));
      }

      const itemLeitura = {
        codigoBruto: decodificado.codigoBruto,
        codigo: decodificado.codigo,
        nome: corte ? corte.nome : `NÃO CADASTRADO (${decodificado.codigo || decodificado.codigoBruto})`,
        peso: decodificado.peso || 0,
        preco: precoCalculado || 0,
        cadastrado: !!corte,
        selecionado: !!corte
      };

      leiturasLote.set(decodificado.codigoBruto, itemLeitura);
      atualizarListaLeiturasLote();
      
      if (navigator.vibrate) navigator.vibrate(80);
    });
  } catch (err) {
    registrarLog("erro", "Falha ao acessar a câmera", String(err));
    alert("Não consegui acessar a câmera. Você pode digitar manualmente.");
    renderLancar();
  }
}

function atualizarListaLeiturasLote() {
  const container = document.getElementById("lista-lote-lido");
  const qtdEl = document.getElementById("qtd-lidas");
  if (!container) return;

  const itens = Array.from(leiturasLote.values());
  const marcados = itens.filter(i => i.selecionado).length;
  qtdEl.textContent = `${marcados}/${itens.length}`;

  if (itens.length === 0) {
    container.innerHTML = '<p class="empty-msg">Aproxime a câmera das etiquetas para ler...</p>';
    return;
  }

  container.innerHTML = `
    <ul class="recentes-lista" style="list-style:none; padding:0; margin:0;">
      ${itens.map((item) => `
        <li class="linha-com-lixeira ${!item.cadastrado ? 'item-invalido' : ''}" style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;">
          <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer;">
            <input type="checkbox" data-check-bruto="${item.codigoBruto}" ${item.selecionado ? 'checked' : ''} style="width:20px; height:20px;" />
            <div style="display:flex; flex-direction:column;">
              <strong style="font-size:14px; ${!item.cadastrado ? 'color:var(--meat);' : ''}">${item.nome}</strong>
              <small style="color:#666;">${fmtKg(item.peso)} kg — ${fmtR$(item.preco)}/kg</small>
            </div>
          </label>
          <button class="link-discreto" data-remover-bruto="${item.codigoBruto}" style="background:none; border:none; padding:5px; cursor:pointer;">🗑️</button>
        </li>
      `).join("")}
    </ul>
  `;

  container.querySelectorAll("[data-check-bruto]").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const item = leiturasLote.get(e.target.dataset.checkBruto);
      if (item) {
        item.selecionado = e.target.checked;
        const totalMarcados = Array.from(leiturasLote.values()).filter(i => i.selecionado).length;
        qtdEl.textContent = `${totalMarcados}/${leiturasLote.size}`;
      }
    });
  });

  container.querySelectorAll("[data-remover-bruto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      leiturasLote.delete(btn.dataset.removerBruto);
      atualizarListaLeiturasLote();
    });
  });
}

async function confirmarLoteCompleto() {
  const todosItens = Array.from(leiturasLote.values());
  const selecionados = todosItens.filter(i => i.selecionado);

  if (selecionados.length === 0) {
    return alert("Nenhuma etiqueta selecionada para salvar.");
  }

  const naoCadastrados = selecionados.filter(i => !i.cadastrado);
  if (naoCadastrados.length > 0) {
    return alert(`Existem ${naoCadastrados.length} item(ns) não cadastrado(s) selecionado(s). Desmarque-os antes de salvar.`);
  }

  await pararScanner();

  let salvos = 0;
  for (const item of selecionados) {
    try {
      await salvarLancamento({
        codigo: item.codigo,
        nome: item.nome,
        peso: item.peso,
        preco: item.preco
      }, "scanner");
      salvos++;
    } catch (e) {
      registrarLog("erro", "Erro ao salvar item do lote", { item, erro: String(e) });
    }
  }

  mostrarToast(`${salvos} etiqueta(s) salva(s) com sucesso!`);
  irPara("lancar");
  renderRota();
}

// ============================================================
// ENTRADA MANUAL DE CORTES (RESTAURADA)
// ============================================================
function corteCorresponde(corte, termo) {
  const t = termo.trim().toUpperCase();
  if (!t) return true;
  if (corte.nome.toUpperCase().includes(t)) return true;
  const iniciais = corte.nome.split(/\s+/).map((palavra) => palavra[0] || "").join("").toUpperCase();
  return iniciais.includes(t);
}

let corteSelecionadoManual = null;

function abrirEntradaManual() {
  corteSelecionadoManual = null;
  el.innerHTML = `
    <div class="screen scanner-screen">
      <button class="voltar" id="manual-voltar">‹ Voltar</button>
      <h2 class="pin-label">Buscar corte</h2>
      <input type="text" id="busca-corte" class="select-grande" placeholder="Nome ou iniciais (ex: CF)" autocomplete="off" autofocus />
      <div id="lista-busca-corte" class="lista-busca-corte"></div>

      <div id="area-corte-escolhido" class="hidden">
        <div class="visor-balanca">
          <div class="visor-linha visor-corte" id="nome-corte-escolhido"></div>
          <div class="visor-linha visor-peso">
            <input type="number" inputmode="decimal" step="0.001" id="input-peso-manual" placeholder="peso kg" />
            <span class="visor-unidade">kg</span>
          </div>
          <div class="visor-linha visor-preco">
            <span class="visor-preco-rotulo">R$/kg</span>
            <input type="number" inputmode="decimal" step="0.01" id="input-preco-manual" placeholder="preço/kg" />
          </div>
        </div>
        <button class="botao-grande botao-confirmar" id="btn-confirmar-manual">Confirmar lançamento</button>
      </div>
    </div>
  `;
  document.getElementById("manual-voltar").addEventListener("click", renderLancar);

  const busca = document.getElementById("busca-corte");
  const listaEl = document.getElementById("lista-busca-corte");
  const areaEscolhido = document.getElementById("area-corte-escolhido");

  function renderLista() {
    const termo = busca.value;
    const resultados = state.cortes.filter((c) => c.ativo && corteCorresponde(c, termo)).slice(0, 30);
    listaEl.innerHTML = resultados.map((c) => `
      <button class="item-busca-corte" data-codigo="${c.codigo}">
        <span>${c.nome}</span>
        <span class="item-busca-preco">${fmtR$(c.preco_venda_kg)}/kg</span>
      </button>
    `).join("") || '<p class="empty-msg">Nenhum corte encontrado.</p>';
    
    listaEl.querySelectorAll("[data-codigo]").forEach((btn) => btn.addEventListener("click", () => {
      corteSelecionadoManual = state.cortes.find((c) => c.codigo === btn.dataset.codigo);
      document.getElementById("nome-corte-escolhido").textContent = corteSelecionadoManual.nome;
      document.getElementById("input-preco-manual").value = corteSelecionadoManual.preco_venda_kg;
      listaEl.innerHTML = "";
      busca.value = corteSelecionadoManual.nome;
      areaEscolhido.classList.remove("hidden");
      setTimeout(() => document.getElementById("input-peso-manual")?.focus(), 100);
    }));
  }

  busca.addEventListener("input", () => { areaEscolhido.classList.add("hidden"); renderLista(); });
  renderLista();

  document.getElementById("btn-confirmar-manual").addEventListener("click", async () => {
    const peso = parseFloat(document.getElementById("input-peso-manual").value);
    const preco = parseFloat(document.getElementById("input-preco-manual").value);
    if (!corteSelecionadoManual) { registrarLog("erro", "Tentou confirmar manual sem escolher corte"); return alert("Escolha o corte."); }
    if (!peso || peso <= 0) { registrarLog("erro", "Tentou confirmar manual com peso inválido", { peso }); return alert("Digite o peso."); }
    if (!preco || preco <= 0) { registrarLog("erro", "Tentou confirmar manual com preço inválido", { preco }); return alert("Digite o preço/kg."); }
    
    await salvarLancamento({ codigo: corteSelecionadoManual.codigo, nome: corteSelecionadoManual.nome, peso, preco }, "manual");
  });
}

// ---------- Confirmação e Salvamento ----------
async function confirmarLancamento() {
  const peso = parseFloat(document.getElementById("input-peso").value);
  const preco = parseFloat(document.getElementById("input-preco").value);
  if (!peso || peso <= 0) { registrarLog("erro", "Tentou confirmar leitura com peso inválido", { peso, leituraAtual }); return alert("Digite um peso válido."); }
  if (!preco || preco <= 0) { registrarLog("erro", "Tentou confirmar leitura com preço inválido", { preco, leituraAtual }); return alert("Digite o preço/kg."); }
  if (!leituraAtual.nome) { registrarLog("erro", "Tentou confirmar código não cadastrado", leituraAtual); return alert("Esse código não está cadastrado no catálogo. Avise o gestor."); }
  
  await salvarLancamento({ codigo: leituraAtual.codigo, nome: leituraAtual.nome, peso, preco }, "scanner");
}

async function salvarLancamento(dados, origem) {
  const idLancamento = crypto.randomUUID();
  const lancamento = {
    id: idLancamento,
    lote_id: state.loteAtivo.id,
    corte_codigo: dados.codigo,
    peso_kg: dados.peso,
    preco_venda_kg: dados.preco,
    colaborador_id: state.usuario.id,
    origem,
    criado_em_dispositivo: new Date().toISOString()
  };
  try {
    await enfileirarLancamento(lancamento);
    await idbPut(STORES.lancamentosLote, {
      id: idLancamento,
      lote_id: state.loteAtivo.id,
      corte_nome: dados.nome,
      peso_kg: dados.peso,
      preco_venda_kg: dados.preco,
      colaborador_nome: state.usuario.nome,
      criado_em: new Date().toISOString(),
      pendente: true
    });
    registrarLog("sucesso", `Lançamento salvo: ${dados.nome} — ${dados.peso}kg`, lancamento);
  } catch (err) {
    registrarLog("erro", "Falha ao salvar lançamento localmente", { erro: String(err), lancamento });
    mostrarToast("⚠️ Erro ao salvar — veja Logs na Área do Gestor");
    return;
  }

  if (typeof tentarEnviarFila === "function") {
    tentarEnviarFila().catch(err => console.warn(err));
  }

  atualizarBadgePendente();
  renderLancar();
  mostrarToast(`${dados.nome} — ${fmtKg(dados.peso)} kg lançado`);
}

// ---------- Histórico de cortes (Recentes) + Botão QUEBRA ----------
async function carregarRecentes() {
  const area = document.getElementById("lista-recentes");
  if (!area || !state.loteAtivo) return;
  const loteId = state.loteAtivo.id;

  const renderizar = (registros) => {
    if (!area || state.loteAtivo?.id !== loteId) return; // usuário trocou de peça/tela

    const somaAtual = registros.reduce((s, r) => s + Number(r.peso_kg || 0), 0);
    const pesoLiquido = Number(state.loteAtivo?.peso_entrada_kg || 0);
    const diferenca = pesoLiquido - somaAtual; // Quanto falta pra fechar a peça

    let classeResumo = "neutro";
    if (pesoLiquido > 0) {
      if (Math.abs(diferenca) < 0.001) classeResumo = "completo";
      else if (diferenca < 0) classeResumo = "excedido";
    }

    // Exibe o botão QUEBRA se ainda houver peso pendente de lançamento
    const podeLancarQuebra = diferenca > 0.001;

    const resumoHtml = `
      <div class="resumo-peso-total resumo-${classeResumo}" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div>
          <span>Total lançado</span><br>
          <strong>${fmtKg(somaAtual)} kg</strong>
          <span class="resumo-peso-liquido">de ${fmtKg(pesoLiquido)} kg líquido</span>
        </div>
        ${podeLancarQuebra ? `
          <button class="botao-secundario" id="btn-lancar-quebra" style="background:var(--warn); color:#fff; border:none; padding:8px 14px; font-weight:700; border-radius:10px; cursor:pointer;">
            + QUEBRA (${fmtKg(diferenca)} kg)
          </button>
        ` : ""}
      </div>
    `;

    area.innerHTML = resumoHtml + (registros.length ? `
      <h3 class="recentes-titulo">Cortes já lançados nesta peça</h3>
      <ul class="recentes-lista">
        ${registros.map((r) => `
          <li class="linha-com-lixeira">
            <span>${r.corte_nome}${r.pendente ? " ⏳" : ""}</span>
            <strong>${fmtKg(r.peso_kg)} kg</strong>
            <button class="link-discreto" data-excluir-lancamento="${r.id}" data-pendente="${r.pendente ? "1" : ""}">🗑️</button>
          </li>`).join("")}
      </ul>
    ` : '<p class="empty-msg">Nenhum corte lançado ainda nesta peça.</p>');

    // Evento do botão QUEBRA
    const btnQuebra = document.getElementById("btn-lancar-quebra");
    if (btnQuebra) {
      btnQuebra.addEventListener("click", () => lancarQuebraAutomatica(diferenca));
    }

    // Evento de exclusão
    area.querySelectorAll("[data-excluir-lancamento]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm("Excluir esse corte lançado? Essa ação fica registrada no log.")) return;
      try {
        if (btn.dataset.pendente) {
          const itens = await idbGetAll(STORES.fila);
          const item = itens.find((i) => i.payload.id === btn.dataset.excluirLancamento);
          if (item) await idbDelete(STORES.fila, item.id_local);
          await idbDelete(STORES.lancamentosLote, btn.dataset.excluirLancamento);
          await registrarLog("info", "Lançamento pendente excluído antes de sincronizar", { id: btn.dataset.excluirLancamento, colaborador: state.usuario.id });
        } else {
          await excluirLancamento(btn.dataset.excluirLancamento, state.usuario.id);
        }
        mostrarToast("Corte excluído");
        atualizarBadgePendente();
        carregarRecentes();
      } catch (err) {
        alert("Erro ao excluir: " + err.message);
      }
    }));
  };

  if (navigator.onLine) {
    area.innerHTML = `<p class="empty-msg">Conferindo lançamentos no servidor…</p>`;
    const doServidor = await buscarLancamentosDoLote(loteId);
    if (state.loteAtivo?.id !== loteId) return;
    if (doServidor) {
      renderizar(await lancamentosLocaisDoLote(loteId));
      return;
    }
  }
  renderizar(await lancamentosLocaisDoLote(loteId));
}

function mostrarToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2200);
}

function atualizarBadgePendente() {
  contarFilaPendente().then((n) => {
    const badge = document.getElementById("pending-badge");
    if (n > 0) { badge.textContent = `${n} pendente${n > 1 ? "s" : ""} de envio`; badge.classList.remove("hidden"); }
    else { badge.classList.add("hidden"); }
  });
}

// ---------- Peça / Lote ativo ----------
function agruparPecasPorTipo(pecas) {
  const dianteiros = pecas.filter((l) => l.tipo === "dianteiro").sort((a, b) => a.numero_peca - b.numero_peca);
  const traseiros = pecas.filter((l) => l.tipo === "traseiro").sort((a, b) => a.numero_peca - b.numero_peca);
  return { dianteiros, traseiros };
}

function pecaEstaCompleta(l) {
  return Math.abs((l.peso_total_desossado || 0) - l.peso_entrada_kg) < 0.001;
}

function renderItemPeca(l) {
  const completa = pecaEstaCompleta(l);
  return `
    <button class="lote-item ${state.loteAtivo && state.loteAtivo.id === l.id ? "selecionado" : ""} ${completa ? "completa" : ""}" data-id="${l.id}">
      <span class="lote-tipo">Peça ${l.numero_peca} ${completa ? "✓" : ""}</span>
      <span>${fmtKg(l.peso_entrada_kg)} kg líquido${completa ? " · completa" : ""}</span>
    </button>
  `;
}

function chaveSemana(dataStr) {
  const [ano, mes] = String(dataStr).split("-");
  const semana = semanaDoMes(dataStr);
  const nomeMes = new Date(`${ano}-${mes}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long" });
  return { chave: `${ano}${mes}${String(semana).padStart(2, "0")}`, rotulo: `Semana ${semana} — ${nomeMes}` };
}

function renderLote() {
  const todosRecebimentos = state.recebimentos;

  const abertos = [];
  const concluidos = [];

  todosRecebimentos.forEach((r) => {
    const progresso = state.progressoRecebimentos.find((p) => p.recebimento_id === r.id);
    const pecas = state.lotes.filter((l) => l.recebimento_id === r.id);
    const { dianteiros, traseiros } = agruparPecasPorTipo(pecas);

    const todasPecasDesossadas = pecas.length > 0 && pecas.every(pecaEstaCompleta);

    if (r.status === "finalizado" || todasPecasDesossadas) {
      concluidos.push({ ...r, progresso, pecas, dianteiros, traseiros });
    } else {
      abertos.push({ ...r, progresso, pecas, dianteiros, traseiros });
    }
  });

  function renderCardRecebimento(r) {
    const recebedor = state.colaboradores.find((c) => c.id === r.colaborador_recebeu_id);

    const pesoEntradaDianteiro = r.progresso?.peso_liquido_dianteiro_kg 
      ?? r.dianteiros.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0);
      
    const pesoEntradaTraseiro = r.progresso?.peso_liquido_traseiro_kg 
      ?? r.traseiros.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0);

    const pesoDesossadoDianteiro = r.progresso?.peso_desossado_dianteiro_kg 
      ?? r.dianteiros.reduce((s, p) => s + Number(p.peso_total_desossado || 0), 0);

    const pesoDesossadoTraseiro = r.progresso?.peso_desossado_traseiro_kg 
      ?? r.traseiros.reduce((s, p) => s + Number(p.peso_total_desossado || 0), 0);

    const qtdDianteiroIniciadas = r.dianteiros.filter((p) => (p.peso_total_desossado || 0) > 0 || pecaEstaCompleta(p)).length;
    const qtdTraseiroIniciadas = r.traseiros.filter((p) => (p.peso_total_desossado || 0) > 0 || pecaEstaCompleta(p)).length;

    const totalDianteiroEsperado = r.quantidade_dianteiro_esperada || r.dianteiros.length || 0;
    const totalTraseiroEsperado = r.quantidade_traseiro_esperada || r.traseiros.length || 0;

    const qtdDianteiroExibir = r.status === "finalizado" && r.progresso 
      ? r.progresso.quantidade_dianteiro_real 
      : qtdDianteiroIniciadas;

    const qtdTraseiroExibir = r.status === "finalizado" && r.progresso 
      ? r.progresso.quantidade_traseiro_real 
      : qtdTraseiroIniciadas;

    // Link para a planilha do Google Sheets vinculada ao n8n/Supabase
    const urlPlanilha = r.planilha_url || APP_CONFIG.URL_PLANILHA_GERAL || "#";

    return `
      <div class="recebimento-grupo ${r.status === "finalizado" ? "recebimento-travado" : ""}" style="margin-bottom:16px;">
        <div class="recebimento-cabecalho">
          <div class="recebimento-fornecedor">
            ${r.fornecedor} 
            ${r.status === "finalizado" ? '<span class="selo-finalizado">🔒 FINALIZADO</span>' : ""}
          </div>
          <div class="recebimento-meta">
            <span>📅 ${fmtDataLocal(r.data_entrada)}</span>
            <span>👤 Recebido por ${recebedor ? recebedor.nome : "—"}</span>
            ${r.placa_veiculo ? `<span>🚚 ${r.placa_veiculo}</span>` : ""}
          </div>
          
          <div class="recebimento-progresso" style="flex-direction:column; gap:6px; margin-top:8px; padding-top:8px; border-top:1px dashed #DADFDC;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
              <span class="${qtdDianteiroExibir >= totalDianteiroEsperado && totalDianteiroEsperado > 0 ? "progresso-completo" : ""}">
                Dianteiro: <strong>${qtdDianteiroExibir}/${totalDianteiroEsperado}</strong>
              </span>
              <span style="font-size:12px; color:var(--ink-soft);">
                <strong>${fmtKg(pesoDesossadoDianteiro)}</strong> de ${fmtKg(pesoEntradaDianteiro)} kg
              </span>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
              <span class="${qtdTraseiroExibir >= totalTraseiroEsperado && totalTraseiroEsperado > 0 ? "progresso-completo" : ""}">
                Traseiro: <strong>${qtdTraseiroExibir}/${totalTraseiroEsperado}</strong>
              </span>
              <span style="font-size:12px; color:var(--ink-soft);">
                <strong>${fmtKg(pesoDesossadoTraseiro)}</strong> de ${fmtKg(pesoEntradaTraseiro)} kg
              </span>
            </div>
          </div>

          <!-- BOTÕES DE RELATÓRIO E PLANILHA -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
            <button class="botao-secundario" data-relatorio-recebimento="${r.id}" style="font-size:12px; padding:8px 6px;">
              📄 Recebimento PDF
            </button>
            <button class="botao-secundario" data-relatorio-desossa="${r.id}" style="font-size:12px; padding:8px 6px;">
              🥩 Desossa PDF
            </button>
          </div>

          <a href="${urlPlanilha}" target="_blank" class="botao-secundario" style="display:block; text-align:center; text-decoration:none; margin-top:8px; font-size:12px; padding:7px; background:#EBF3EF; color:#1C5235; border:1px solid #B8D8C7; border-radius:8px; font-weight:600;">
            📊 Baixar / Ver Planilha
          </a>
        </div>

        ${r.status === "finalizado" ? `
          <p class="empty-msg" style="padding: 8px 0;">Finalizado pelo gestor.</p>
        ` : `
          <button class="botao-add-peca" data-add-peca="${r.id}" style="margin-top:10px;">
            <span class="icone-grande">➕</span> Adicionar peça
          </button>

          <div class="subgrupo-tipo">
            <h4 class="subgrupo-titulo">Dianteiro</h4>
            ${r.dianteiros.map(renderItemPeca).join("") || '<p class="empty-msg">Nenhuma peça ainda.</p>'}
          </div>
          <div class="subgrupo-tipo">
            <h4 class="subgrupo-titulo">Traseiro</h4>
            ${r.traseiros.map(renderItemPeca).join("") || '<p class="empty-msg">Nenhuma peça ainda.</p>'}
          </div>
        `}
      </div>
    `;
  }

  el.innerHTML = `
    <div class="screen lote-screen" style="max-width: 520px; margin: 0 auto; width: 100%;">
      <h2 class="titulo-tela">Escolha a peça em desossa</h2>
      <button class="botao-grande botao-confirmar" id="btn-novo-recebimento" style="margin-bottom:16px;">+ Registrar novo recebimento</button>
      
      <div class="admin-abas" style="margin-bottom:16px;">
        <button class="aba ${abaLoteAtual === 'abertos' ? 'ativa' : ''}" id="aba-lote-abertos">
          🟢 Em Aberto (${abertos.length})
        </button>
        <button class="aba ${abaLoteAtual === 'concluidos' ? 'ativa' : ''}" id="aba-lote-concluidos">
          ✅ Concluídos (${concluidos.length})
        </button>
      </div>

      <div id="lista-recebimentos-conteudo">
        ${(abaLoteAtual === 'abertos' ? abertos : concluidos).map(renderCardRecebimento).join("") || `
          <p class="empty-msg">Nenhum recebimento ${abaLoteAtual === 'abertos' ? 'em aberto' : 'concluído'}.</p>
        `}
      </div>
    </div>
  `;

  document.getElementById("aba-lote-abertos").addEventListener("click", () => { abaLoteAtual = 'abertos'; renderLote(); });
  document.getElementById("aba-lote-concluidos").addEventListener("click", () => { abaLoteAtual = 'concluidos'; renderLote(); });

  document.getElementById("btn-novo-recebimento").addEventListener("click", () => irPara("novo-recebimento"));

  el.querySelectorAll(".lote-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.loteAtivo = state.lotes.find((l) => l.id === btn.dataset.id);
      await salvarLoteAtivo(state.loteAtivo);
      garantirDataDesossa(state.loteAtivo);
      irPara("lancar");
      renderRota();
    });
  });

  el.querySelectorAll("[data-add-peca]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.recebimentoEmEdicao = state.recebimentos.find((r) => r.id === btn.dataset.addPeca);
      irPara("add-pecas");
    });
  });

  // Eventos dos dois relatórios
  el.querySelectorAll("[data-relatorio-recebimento]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#relatorio-${btn.dataset.relatorioRecebimento}`;
    });
  });

  el.querySelectorAll("[data-relatorio-desossa]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#desossa-${btn.dataset.relatorioDesossa}`;
    });
  });
}

// ---------- Novo recebimento ----------
function renderNovoRecebimento() {
  el.innerHTML = `
    <div class="screen admin-screen">
      <button class="voltar" id="rec-voltar">‹ Voltar</button>
      <h2 class="titulo-tela">Novo recebimento</h2>
      <form id="form-recebimento" class="admin-form">
        <input name="fornecedor" placeholder="Fornecedor" required />
        <input name="placa_veiculo" placeholder="Placa do veículo" />
        <input name="fiscal_prevencao" placeholder="Fiscal de prevenção" />
        <input name="acougueiro_acompanhante" placeholder="Açougueiro que acompanhou" />
        <input name="peso_entregador_1_kg" type="number" step="0.001" placeholder="Peso entregador 1 (kg)" required />
        <input name="peso_entregador_2_kg" type="number" step="0.001" placeholder="Peso entregador 2 (kg)" />
        <label class="rotulo-campo">Quantas peças vêm nesse recebimento?</label>
        <div class="linha-quantidade">
          <div class="campo-quantidade">
            <span>Dianteiro</span>
            <input name="quantidade_dianteiro_esperada" type="number" min="0" step="1" placeholder="0" required />
          </div>
          <div class="campo-quantidade">
            <span>Traseiro</span>
            <input name="quantidade_traseiro_esperada" type="number" min="0" step="1" placeholder="0" required />
          </div>
        </div>
        <button type="submit" class="botao-grande botao-confirmar">Salvar e adicionar peças</button>
      </form>
    </div>
  `;
  document.getElementById("rec-voltar").addEventListener("click", () => irPara("lote"));
  document.getElementById("form-recebimento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const rec = await criarRecebimento({
        fornecedor: f.get("fornecedor").trim(),
        placa_veiculo: f.get("placa_veiculo").trim() || null,
        fiscal_prevencao: f.get("fiscal_prevencao").trim() || null,
        acougueiro_acompanhante: f.get("acougueiro_acompanhante").trim() || null,
        colaborador_recebeu_id: state.usuario.id,
        peso_entregador_1_kg: parseFloat(f.get("peso_entregador_1_kg")),
        peso_entregador_2_kg: f.get("peso_entregador_2_kg") ? parseFloat(f.get("peso_entregador_2_kg")) : null,
        quantidade_dianteiro_esperada: parseInt(f.get("quantidade_dianteiro_esperada"), 10) || 0,
        quantidade_traseiro_esperada: parseInt(f.get("quantidade_traseiro_esperada"), 10) || 0,
        status: "aberto"
      });
      state.recebimentos = await idbGetAll(STORES.recebimentos);
      state.recebimentoEmEdicao = rec;
      irPara("add-pecas");
    } catch (err) {
      alert("Não consegui salvar o recebimento (precisa de internet nessa etapa). " + err.message);
    }
  });
}

// ---------- Adicionar peças a um recebimento ----------
function proximoNumeroPorTipo(pecasExistentes, tipo) {
  const numeros = pecasExistentes.filter((p) => p.tipo === tipo).map((p) => p.numero_peca).sort((a, b) => a - b);
  let esperado = 1;
  for (const n of numeros) {
    if (n !== esperado) return esperado;
    esperado++;
  }
  return esperado;
}

async function renderAddPecas() {
  const rec = state.recebimentoEmEdicao;
  if (!rec) return irPara("lote");
  let pecasExistentes = await buscarPecasDoRecebimento(rec.id);
  const { dianteiros, traseiros } = agruparPecasPorTipo(pecasExistentes);
  const recebedor = state.colaboradores.find((c) => c.id === rec.colaborador_recebeu_id);

  el.innerHTML = `
    <div class="screen admin-screen">
      <button class="voltar" id="peca-voltar">‹ Voltar</button>
      <h2 class="titulo-tela">${rec.fornecedor}</h2>
      <p class="pin-label">📅 ${fmtDataLocal(rec.data_entrada)} · 👤 Recebido por ${recebedor ? recebedor.nome : "—"}${rec.placa_veiculo ? ` · 🚚 ${rec.placa_veiculo}` : ""}</p>
      <p class="pin-label">Peso entregador 1: ${fmtKg(rec.peso_entregador_1_kg)} kg ${rec.peso_entregador_2_kg ? `· Peso entregador 2: ${fmtKg(rec.peso_entregador_2_kg)} kg` : ""}</p>

      <div class="subgrupo-tipo">
        <h4 class="subgrupo-titulo">Dianteiro</h4>
        <div class="resumo-peso-total resumo-compacto">
          <span>Total registrado</span>
          <strong>${fmtKg(dianteiros.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0))} kg</strong>
          <span class="resumo-peso-liquido">${dianteiros.length} peça${dianteiros.length !== 1 ? "s" : ""}${rec.quantidade_dianteiro_esperada ? ` de ${rec.quantidade_dianteiro_esperada} esperadas` : ""}</span>
        </div>
        <ul class="admin-lista">
          ${dianteiros.map((p) => `<li class="linha-com-lixeira"><span>Peça ${p.numero_peca}</span><strong>${fmtKg(p.peso_entrada_kg)} kg líquido</strong><button class="link-discreto" data-excluir-peca="${p.id}">🗑️</button></li>`).join("") || '<li><span>Nenhuma peça ainda</span></li>'}
        </ul>
      </div>
      <div class="subgrupo-tipo">
        <h4 class="subgrupo-titulo">Traseiro</h4>
        <div class="resumo-peso-total resumo-compacto">
          <span>Total registrado</span>
          <strong>${fmtKg(traseiros.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0))} kg</strong>
          <span class="resumo-peso-liquido">${traseiros.length} peça${traseiros.length !== 1 ? "s" : ""}${rec.quantidade_traseiro_esperada ? ` de ${rec.quantidade_traseiro_esperada} esperadas` : ""}</span>
        </div>
        <ul class="admin-lista">
          ${traseiros.map((p) => `<li class="linha-com-lixeira"><span>Peça ${p.numero_peca}</span><strong>${fmtKg(p.peso_entrada_kg)} kg líquido</strong><button class="link-discreto" data-excluir-peca="${p.id}">🗑️</button></li>`).join("") || '<li><span>Nenhuma peça ainda</span></li>'}
        </ul>
      </div>

      <form id="form-peca" class="admin-form">
        <h4 class="subgrupo-titulo">Nova peça</h4>
        <select name="tipo" id="select-tipo-peca" required>
          <option value="">Tipo da peça</option>
          <option value="dianteiro">Dianteiro</option>
          <option value="traseiro">Traseiro</option>
        </select>
        <div class="numero-peca-visor" id="numero-peca-visor">Escolha o tipo pra ver o número da peça</div>
        <input name="peso_bruto_kg" type="number" step="0.001" placeholder="Peso bruto (balança) kg" required />
        <select name="entregador_usado" required>
          <option value="">Quem carregou?</option>
          <option value="${rec.peso_entregador_1_kg}">Entregador 1 (${fmtKg(rec.peso_entregador_1_kg)} kg)</option>
          ${rec.peso_entregador_2_kg ? `<option value="${rec.peso_entregador_2_kg}">Entregador 2 (${fmtKg(rec.peso_entregador_2_kg)} kg)</option>` : ""}
        </select>
        <button type="submit" class="botao-grande botao-confirmar">Adicionar peça</button>
      </form>

      <div class="zona-concluir">
        <button class="botao-concluir-distante" id="btn-concluir-pecas">Concluir por agora</button>
      </div>
    </div>
  `;
  document.getElementById("peca-voltar").addEventListener("click", () => irPara("lote"));
  document.getElementById("btn-concluir-pecas").addEventListener("click", () => { state.recebimentoEmEdicao = null; irPara("lote"); });

  const selectTipo = document.getElementById("select-tipo-peca");
  const visorNumero = document.getElementById("numero-peca-visor");
  selectTipo.addEventListener("change", async () => {
    if (!selectTipo.value) { visorNumero.textContent = "Escolha o tipo pra ver o número da peça"; return; }
    visorNumero.textContent = "Calculando…";
    pecasExistentes = await buscarPecasDoRecebimento(rec.id);
    const numero = proximoNumeroPorTipo(pecasExistentes, selectTipo.value);
    visorNumero.textContent = `${selectTipo.value === "dianteiro" ? "Dianteiro" : "Traseiro"} — peça número ${numero}`;
  });

  document.getElementById("form-peca").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const tipo = f.get("tipo");
    if (!tipo) return alert("Escolha o tipo da peça.");
    try {
      const pecasNaHora = await buscarPecasDoRecebimento(rec.id);
      await adicionarPeca(rec.id, {
        tipo,
        numero_peca: proximoNumeroPorTipo(pecasNaHora, tipo),
        peso_bruto_kg: parseFloat(f.get("peso_bruto_kg")),
        peso_entregador_usado_kg: parseFloat(f.get("entregador_usado"))
      });
      state.lotes = await idbGetAll(STORES.lotes);
      renderAddPecas();
    } catch (err) {
      if (err.code === "23505") {
        alert("Esse número de peça já foi usado. Atualizando a lista, tenta de novo.");
        renderAddPecas();
      } else {
        alert("Não consegui salvar a peça (precisa de internet nessa etapa). " + err.message);
      }
    }
  });

  document.querySelectorAll("[data-excluir-peca]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Excluir essa peça? Isso também apaga TODOS os cortes já lançados nela.")) return;
    try {
      await excluirPeca(btn.dataset.excluirPeca, state.usuario.id);
      state.lotes = await idbGetAll(STORES.lotes);
      mostrarToast("Peça excluída");
      renderAddPecas();
    } catch (err) {
      alert("Erro ao excluir: " + err.message);
    }
  }));
}

async function renderRelatorioRecebimento(recebimentoId) {
  nav.classList.add("hidden");
  
  const rec = state.recebimentos.find((r) => r.id === recebimentoId);
  if (!rec) return irPara("lote");

  const pecas = await buscarPecasDoRecebimento(rec.id);
  const recebedor = state.colaboradores.find((c) => c.id === rec.colaborador_recebeu_id);

  // Separação das peças por tipo
  const dianteiros = pecas.filter((p) => p.tipo === "dianteiro").sort((a, b) => a.numero_peca - b.numero_peca);
  const traseiros = pecas.filter((p) => p.tipo === "traseiro").sort((a, b) => a.numero_peca - b.numero_peca);

  // Totais
  const totalBruto = pecas.reduce((s, p) => s + Number(p.peso_bruto_kg || 0), 0);
  const totalLiquido = pecas.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0);

  // Função interna para gerar a tabela de cada grupo
  function renderTabelaPecas(lista, titulo) {
    const brutoGrupo = lista.reduce((s, p) => s + Number(p.peso_bruto_kg || 0), 0);
    const liquidoGrupo = lista.reduce((s, p) => s + Number(p.peso_entrada_kg || 0), 0);

    return `
      <h3 style="font-family:var(--display); font-size:18px; margin:20px 0 10px; color:#1E2422; text-transform:uppercase;">
        Peças de ${titulo} (${lista.length})
      </h3>
      <div style="overflow-x:auto; margin-bottom:15px;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="background:#1E2422; color:#ffffff;">
              <th style="padding:10px 12px; border-radius:8px 0 0 0;">Tipo</th>
              <th style="padding:10px 12px; text-align:center;">Nº Peça</th>
              <th style="padding:10px 12px; text-align:right;">Peso Bruto (Balança)</th>
              <th style="padding:10px 12px; text-align:right;">Entregador Descontado</th>
              <th style="padding:10px 12px; text-align:right; border-radius:0 8px 0 0;">Peso Líquido Final</th>
            </tr>
          </thead>
          <tbody>
            ${lista.map((p) => `
              <tr style="border-bottom:1px solid #DADFDC;">
                <td style="padding:10px 12px; text-transform:capitalize; font-weight:600;">${p.tipo}</td>
                <td style="padding:10px 12px; text-align:center; font-weight:bold;">Peça ${p.numero_peca}</td>
                <td style="padding:10px 12px; text-align:right;">${fmtKg(p.peso_bruto_kg)} kg</td>
                <td style="padding:10px 12px; text-align:right;">${fmtKg(p.peso_entregador_usado_kg)} kg</td>
                <td style="padding:10px 12px; text-align:right; font-weight:bold; color:var(--success);">${fmtKg(p.peso_entrada_kg)} kg</td>
              </tr>
            `).join("") || '<tr><td colspan="5" style="text-align:center; padding:15px; color:#5B655F;">Nenhuma peça deste tipo registrada.</td></tr>'}
          </tbody>
          ${lista.length ? `
            <tfoot>
              <tr style="background:#F4F5F3; font-weight:bold; border-top:2px solid #DADFDC;">
                <td colspan="2" style="padding:10px 12px; text-transform:uppercase;">Subtotal ${titulo}</td>
                <td style="padding:10px 12px; text-align:right;">${fmtKg(brutoGrupo)} kg</td>
                <td style="padding:10px 12px; text-align:right;">—</td>
                <td style="padding:10px 12px; text-align:right; color:var(--success);">${fmtKg(liquidoGrupo)} kg</td>
              </tr>
            </tfoot>
          ` : ""}
        </table>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="screen relatorio-print-area" style="max-width:850px; width:100%; margin:20px auto; background:#ffffff; color:#1E2422; padding:24px; border-radius:16px; border:1px solid #DADFDC; box-shadow:0 4px 12px rgba(0,0,0,0.05); height:auto !important; min-height:auto !important;">
      
      <!-- Botões de topo -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;" class="no-print">
        <button class="voltar" onclick="irPara('lote')" style="margin:0; cursor:pointer;">‹ Voltar</button>
        <button onclick="window.print()" class="botao-grande botao-confirmar" style="width:auto; padding:10px 20px; font-size:15px; margin:0; cursor:pointer;">
          🖨️ Imprimir / Salvar PDF
        </button>
      </div>

      <!-- Cabeçalho -->
      <div style="border-bottom:2px solid #1E2422; padding-bottom:12px; margin-bottom:20px;">
        <h2 style="font-family:var(--display); font-size:26px; margin:0 0 4px; text-transform:uppercase; color:#1E2422;">
          Relatório de Recebimento — ${rec.fornecedor}
        </h2>
        <span style="color:#5B655F; font-size:13px;">Sistema de Desossa · Detalhamento de Entrada</span>
      </div>

      <!-- Metadados -->
      <div style="background:#F4F5F3; border:1px solid #DADFDC; border-radius:12px; padding:16px; margin-bottom:24px; display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; font-size:14px;">
        <div><strong>Data de Entrada:</strong> ${fmtDataLocal(rec.data_entrada)}</div>
        <div><strong>Placa do Veículo:</strong> ${rec.placa_veiculo || "—"}</div>
        <div><strong>Fiscal de Prevenção:</strong> ${rec.fiscal_prevencao || "—"}</div>
        <div><strong>Açougueiro Acompanhante:</strong> ${rec.acougueiro_acompanhante || "—"}</div>
        <div><strong>Recebido por:</strong> ${recebedor ? recebedor.nome : "—"}</div>
        <div><strong>Status do Lote:</strong> ${rec.status === 'finalizado' ? '🔒 FINALIZADO' : '🟢 ABERTO'}</div>
        <div><strong>Peso Entregador 1:</strong> ${fmtKg(rec.peso_entregador_1_kg)} kg</div>
        <div><strong>Peso Entregador 2:</strong> ${rec.peso_entregador_2_kg ? fmtKg(rec.peso_entregador_2_kg) + " kg" : "—"}</div>
        <div><strong>Peças Esperadas:</strong> Dianteiro: ${rec.quantidade_dianteiro_esperada || 0} | Traseiro: ${rec.quantidade_traseiro_esperada || 0}</div>
      </div>

      <!-- Tabelas Separadas -->
      ${renderTabelaPecas(dianteiros, "Dianteiro")}
      ${renderTabelaPecas(traseiros, "Traseiro")}

      <!-- Resumo Geral -->
      <div style="display:flex; justify-content:flex-end; gap:24px; font-size:15px; background:#1E2422; color:#ffffff; padding:16px 20px; border-radius:12px; margin-top:24px;">
        <div><strong>Total Bruto Entrada:</strong> ${fmtKg(totalBruto)} kg</div>
        <div><strong>Total Líquido do Recebimento:</strong> <span style="color:#4EFA96; font-weight:bold;">${fmtKg(totalLiquido)} kg</span></div>
      </div>

    </div>
  `;
}

// ---------- Área do gestor (admin) ----------
let adminAutenticado = false;
let abaAdminAtual = "cortes";

function renderAdmin() {
  nav.classList.add("hidden");
  if (!adminAutenticado) return renderAdminLogin();
  renderAdminShell();
}

function renderAdminLogin() {
  el.innerHTML = `
    <div class="screen pin-screen">
      <button class="voltar" id="admin-voltar">‹ Voltar</button>
      <h2 class="pin-nome">Área do gestor</h2>
      <p class="pin-label">Digite a senha</p>
      <input type="password" id="admin-senha" class="select-grande" />
      <button class="botao-grande botao-confirmar" id="admin-entrar">Entrar</button>
    </div>
  `;
  document.getElementById("admin-voltar").addEventListener("click", () => irPara("login"));
  document.getElementById("admin-entrar").addEventListener("click", () => {
    if (document.getElementById("admin-senha").value === APP_CONFIG.ADMIN_PASSWORD) {
      adminAutenticado = true;
      renderAdminShell();
    } else {
      alert("Senha incorreta.");
    }
  });
}

function renderAdminShell() {
  el.innerHTML = `
    <div class="screen admin-screen">
      <header class="admin-topo">
        <h2>Área do gestor</h2>
        <button class="link-discreto" id="admin-sair">Sair</button>
      </header>
      <a href="painel-gestor.html" target="_blank" rel="noopener" class="botao-grande botao-confirmar" style="text-decoration:none; margin-bottom:16px;">
        📊 Abrir Painel de Acompanhamento
      </a>
      <p class="pin-label" style="margin-top:-8px;">Abre em outra aba — o painel funciona melhor num computador.</p>
      <div class="admin-abas">
        <button class="aba ${abaAdminAtual === "cortes" ? "ativa" : ""}" data-aba="cortes">Cortes</button>
        <button class="aba ${abaAdminAtual === "colaboradores" ? "ativa" : ""}" data-aba="colaboradores">Colaboradores</button>
        <button class="aba ${abaAdminAtual === "pecas" ? "ativa" : ""}" data-aba="pecas">Recebimentos</button>
        <button class="aba ${abaAdminAtual === "logs" ? "ativa" : ""}" data-aba="logs">Logs</button>
      </div>
      <div id="admin-conteudo"></div>
    </div>
  `;
  document.getElementById("admin-sair").addEventListener("click", () => { adminAutenticado = false; irPara("login"); });
  el.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => { abaAdminAtual = b.dataset.aba; renderAdminShell(); }));

  if (abaAdminAtual === "cortes") renderAdminCortes();
  if (abaAdminAtual === "colaboradores") renderAdminColaboradores();
  if (abaAdminAtual === "pecas") renderAdminPecas();
  if (abaAdminAtual === "logs") renderAdminLogs();
}

async function renderAdminLogs() {
  const c = document.getElementById("admin-conteudo");
  c.innerHTML = `<p class="pin-label">Carregando…</p>`;
  const logs = await listarLogs();
  const corPorNivel = { erro: "#A8402B", sucesso: "#4C7A57", info: "#375061" };
  c.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button class="botao-secundario" id="btn-copiar-logs">📋 Copiar tudo</button>
      <button class="botao-secundario" id="btn-limpar-logs">🗑️ Limpar</button>
    </div>
    <ul class="admin-lista" style="flex-direction:column; align-items:stretch;">
      ${logs.map((l) => `
        <li style="flex-direction:column; align-items:flex-start; gap:2px;">
          <div style="display:flex; justify-content:space-between; width:100%;">
            <strong style="color:${corPorNivel[l.nivel] || "#333"};">${l.nivel.toUpperCase()}</strong>
            <span style="font-size:11px; color:var(--ink-soft);">${new Date(l.quando).toLocaleString("pt-BR")}</span>
          </div>
          <span>${l.mensagem}</span>
          ${l.detalhes ? `<span style="font-family:var(--mono); font-size:11px; color:var(--ink-soft); word-break:break-all;">${l.detalhes}</span>` : ""}
        </li>
      `).join("") || '<li><span>Nenhum log ainda.</span></li>'}
    </ul>
  `;
  document.getElementById("btn-copiar-logs").addEventListener("click", async () => {
    const texto = logs.map((l) => `[${l.quando}] ${l.nivel.toUpperCase()} — ${l.mensagem}${l.detalhes ? " — " + l.detalhes : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      mostrarToast("Logs copiados!");
    } catch {
      alert(texto);
    }
  });
  document.getElementById("btn-limpar-logs").addEventListener("click", async () => {
    if (!confirm("Apagar todos os logs?")) return;
    await limparLogs();
    renderAdminLogs();
  });
}

let corteEmEdicaoCodigo = null;

async function renderAdminCortes() {
  const c = document.getElementById("admin-conteudo");
  c.innerHTML = `<p class="pin-label">Carregando…</p>`;
  const todos = await buscarTodosCortes();
  const editando = corteEmEdicaoCodigo ? todos.find((ct) => ct.codigo === corteEmEdicaoCodigo) : null;

  c.innerHTML = `
    <form id="form-corte" class="admin-form">
      <input name="codigo" placeholder="Código (da etiqueta)" value="${editando ? editando.codigo : ""}" ${editando ? "readonly" : ""} required />
      <input name="nome" placeholder="Nome do corte" value="${editando ? editando.nome : ""}" required />
      <input name="preco_venda_kg" type="number" step="0.01" placeholder="Preço venda /kg" value="${editando ? editando.preco_venda_kg : ""}" required />
      <button type="submit" class="botao-grande botao-confirmar">${editando ? "Salvar alterações" : "Adicionar corte"}</button>
      ${editando ? '<button type="button" class="botao-secundario" id="btn-cancelar-edicao-corte">Cancelar edição</button>' : ""}
    </form>
    <input type="text" id="busca-corte-admin" class="select-grande" placeholder="🔎 Buscar por nome ou iniciais (ex: CF)" autocomplete="off" />
    <ul class="admin-lista" id="lista-cortes-admin">
      ${todos.map((ct) => `
        <li class="recebimento-admin-item ${ct.ativo ? "" : "item-inativo"}" data-nome-busca="${ct.nome}">
          <div class="recebimento-admin-topo">
            <span>${ct.codigo} — ${ct.nome} ${ct.ativo ? "" : "(desativado)"}</span>
            <strong>${fmtR$(ct.preco_venda_kg)}/kg</strong>
          </div>
          <div class="botoes-linha">
            <button class="link-discreto" data-editar-corte="${ct.codigo}">Editar</button>
            ${ct.ativo
              ? `<button class="link-discreto" data-desativar-corte="${ct.codigo}">Desativar</button>`
              : `<button class="link-discreto" data-reativar-corte="${ct.codigo}">Reativar</button>`}
          </div>
        </li>`).join("") || '<li><span>Nenhum corte cadastrado ainda.</span></li>'}
    </ul>
  `;

  document.getElementById("busca-corte-admin").addEventListener("input", (e) => {
    const termo = e.target.value;
    document.querySelectorAll("#lista-cortes-admin li[data-nome-busca]").forEach((li) => {
      const corteFake = { nome: li.dataset.nomeBusca };
      li.style.display = corteCorresponde(corteFake, termo) ? "" : "none";
    });
  });

  document.getElementById("form-corte").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const codigo = f.get("codigo").trim();
    const nome = f.get("nome").trim().toUpperCase();
    const preco_venda_kg = parseFloat(f.get("preco_venda_kg"));
    try {
      if (editando) {
        await editarCorte(codigo, { nome, preco_venda_kg });
        mostrarToast("Corte atualizado");
      } else {
        const sb = getSupabase();
        const { error } = await sb.from("cortes_catalogo").insert({ codigo, nome, preco_venda_kg, ativo: true });
        if (error) {
          if (error.code === "23505") throw new Error("Já existe um corte com esse código. Use 'Editar' na lista abaixo.");
          throw error;
        }
        await atualizarCacheReferencia();
        mostrarToast("Corte cadastrado");
      }
      corteEmEdicaoCodigo = null;
      renderAdminShell();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  });

  c.querySelectorAll("[data-editar-corte]").forEach((btn) => btn.addEventListener("click", () => {
    corteEmEdicaoCodigo = btn.dataset.editarCorte;
    renderAdminCortes();
  }));
  document.getElementById("btn-cancelar-edicao-corte")?.addEventListener("click", () => {
    corteEmEdicaoCodigo = null;
    renderAdminCortes();
  });
  c.querySelectorAll("[data-desativar-corte]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Desativar esse corte?")) return;
    await definirAtivoCorte(btn.dataset.desativarCorte, false);
    renderAdminCortes();
  }));
  c.querySelectorAll("[data-reativar-corte]").forEach((btn) => btn.addEventListener("click", async () => {
    await definirAtivoCorte(btn.dataset.reativarCorte, true);
    renderAdminCortes();
  }));
}

let colaboradorEmEdicaoId = null;

async function renderAdminColaboradores() {
  const c = document.getElementById("admin-conteudo");
  c.innerHTML = `<p class="pin-label">Carregando…</p>`;
  const todos = await buscarTodosColaboradores();
  const editando = colaboradorEmEdicaoId ? todos.find((cl) => cl.id === colaboradorEmEdicaoId) : null;

  c.innerHTML = `
    <form id="form-colab" class="admin-form">
      <input name="nome" placeholder="Nome do colaborador" value="${editando ? editando.nome : ""}" required />
      ${editando && editando.foto_url ? `<img src="${editando.foto_url}" class="foto-preview-atual" alt="Foto atual" />` : ""}
      <label class="rotulo-campo">Foto${editando ? " (deixe em branco pra manter a atual)" : ""}</label>
      <div class="botoes-linha">
        <button type="button" class="botao-secundario" id="btn-tirar-foto">📷 Tirar foto</button>
        <button type="button" class="botao-secundario" id="btn-escolher-foto">🖼️ Escolher da galeria</button>
      </div>
      <input type="file" accept="image/*" capture="environment" id="input-foto-camera" class="hidden" />
      <input type="file" accept="image/*" id="input-foto-galeria" class="hidden" />
      <img id="preview-foto-nova" class="foto-preview-atual hidden" alt="Foto escolhida" />
      <span id="nome-foto-escolhida" class="rotulo-campo"></span>
      <input name="pin" placeholder="${editando ? "Novo PIN (deixe em branco pra manter)" : "PIN de 4 dígitos"}" maxlength="4" pattern="\\d{4}" ${editando ? "" : "required"} />
      <button type="submit" class="botao-grande botao-confirmar">${editando ? "Salvar alterações" : "Adicionar colaborador"}</button>
      ${editando ? '<button type="button" class="botao-secundario" id="btn-cancelar-edicao-colab">Cancelar edição</button>' : ""}
    </form>
    <ul class="admin-lista">
      ${todos.map((cl) => `
        <li class="recebimento-admin-item ${cl.ativo ? "" : "item-inativo"}">
          <div class="recebimento-admin-topo">
            <span class="colab-admin-nome">
              <span class="mini-avatar" style="background-image:url('${cl.foto_url || ""}')">${cl.foto_url ? "" : cl.nome.charAt(0).toUpperCase()}</span>
              ${cl.nome} ${cl.ativo ? "" : "(desativado)"}
            </span>
          </div>
          <div class="botoes-linha">
            <button class="link-discreto" data-editar-colab="${cl.id}">Editar</button>
            ${cl.ativo
              ? `<button class="link-discreto" data-desativar-colab="${cl.id}">Desativar</button>`
              : `<button class="link-discreto" data-reativar-colab="${cl.id}">Reativar</button>`}
          </div>
        </li>`).join("") || '<li><span>Nenhum colaborador cadastrado ainda.</span></li>'}
    </ul>
  `;

  let fotoSelecionada = null;
  const inputCamera = document.getElementById("input-foto-camera");
  const inputGaleria = document.getElementById("input-foto-galeria");
  const preview = document.getElementById("preview-foto-nova");
  const nomeArquivoEl = document.getElementById("nome-foto-escolhida");

  document.getElementById("btn-tirar-foto").addEventListener("click", () => inputCamera.click());
  document.getElementById("btn-escolher-foto").addEventListener("click", () => inputGaleria.click());

  function onFotoEscolhida(e) {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    fotoSelecionada = arquivo;
    preview.src = URL.createObjectURL(arquivo);
    preview.classList.remove("hidden");
    nomeArquivoEl.textContent = `Selecionada: ${arquivo.name}`;
  }
  inputCamera.addEventListener("change", onFotoEscolhida);
  inputGaleria.addEventListener("change", onFotoEscolhida);

  document.getElementById("form-colab").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const nome = f.get("nome").trim();
    const pin = f.get("pin").trim();
    const arquivo = fotoSelecionada;
    if (!editando && !/^\d{4}$/.test(pin)) return alert("O PIN precisa ter exatamente 4 números.");
    if (pin && !/^\d{4}$/.test(pin)) return alert("O PIN precisa ter exatamente 4 números.");

    const botao = e.target.querySelector("button[type=submit]");
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = arquivo && arquivo.size > 0 ? "Enviando foto…" : "Salvando…";
    try {
      let foto_url = null;
      if (arquivo && arquivo.size > 0) {
        foto_url = await uploadFotoColaborador(arquivo, editando ? editando.id : crypto.randomUUID());
      }
      if (editando) {
        await editarColaborador(editando.id, { nome, foto_url, pin: pin || null });
        mostrarToast("Colaborador atualizado");
      } else {
        await criarColaborador({ nome, foto_url, pin });
        mostrarToast("Colaborador cadastrado");
      }
      colaboradorEmEdicaoId = null;
      renderAdminShell();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  });

  c.querySelectorAll("[data-editar-colab]").forEach((btn) => btn.addEventListener("click", () => {
    colaboradorEmEdicaoId = btn.dataset.editarColab;
    renderAdminColaboradores();
  }));
  document.getElementById("btn-cancelar-edicao-colab")?.addEventListener("click", () => {
    colaboradorEmEdicaoId = null;
    renderAdminColaboradores();
  });
  c.querySelectorAll("[data-desativar-colab]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Desativar esse colaborador?")) return;
    await definirAtivoColaborador(btn.dataset.desativarColab, false);
    renderAdminColaboradores();
  }));
  c.querySelectorAll("[data-reativar-colab]").forEach((btn) => btn.addEventListener("click", async () => {
    await definirAtivoColaborador(btn.dataset.reativarColab, true);
    renderAdminColaboradores();
  }));
}

let mesFiltroAdmin = null;

function semanaDoMes(dataStr) {
  const dia = parseInt(String(dataStr).slice(8, 10), 10);
  return Math.ceil(dia / 7);
}
function mesAnterior(mesStr) {
  const [a, m] = mesStr.split("-").map(Number);
  const d = new Date(a, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function mesSeguinte(mesStr) {
  const [a, m] = mesStr.split("-").map(Number);
  const d = new Date(a, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

let abaGestorRecebimento = "abertos";

async function renderAdminPecas() {
  const c = document.getElementById("admin-conteudo");
  c.innerHTML = `<p class="pin-label">Carregando…</p>`;
  
  if (!mesFiltroAdmin) {
    const hoje = new Date();
    mesFiltroAdmin = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  }
  
  const progresso = await buscarProgressoRecebimentos();
  const doMes = state.recebimentos.filter((r) => String(r.data_entrada).slice(0, 7) === mesFiltroAdmin);

  // Filtra em Aberto x Concluídos no Gestor
  const abertos = [];
  const concluidos = [];

  doMes.forEach((r) => {
    const p = progresso.find((x) => x.recebimento_id === r.id);
    const pecas = state.lotes.filter((l) => l.recebimento_id === r.id);
    const todasDesossadas = pecas.length > 0 && pecas.every(pecaEstaCompleta);

    if (r.status === "finalizado" || todasDesossadas) {
      concluidos.push({ ...r, progressoData: p });
    } else {
      abertos.push({ ...r, progressoData: p });
    }
  });

  const listaExibir = abaGestorRecebimento === "abertos" ? abertos : concluidos;
  const nomeMes = new Date(`${mesFiltroAdmin}-01T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  c.innerHTML = `
    <div class="filtro-mes">
      <button id="mes-anterior" class="botao-secundario">‹</button>
      <strong class="filtro-mes-nome">${nomeMes}</strong>
      <button id="mes-seguinte" class="botao-secundario">›</button>
    </div>

    <!-- Abas de Navegação no Gestor -->
    <div class="admin-abas" style="margin-bottom:16px;">
      <button class="aba ${abaGestorRecebimento === 'abertos' ? 'ativa' : ''}" id="aba-gestor-abertos">
        🟢 Em Aberto (${abertos.length})
      </button>
      <button class="aba ${abaGestorRecebimento === 'concluidos' ? 'ativa' : ''}" id="aba-gestor-concluidos">
        ✅ Concluídos (${concluidos.length})
      </button>
    </div>

    <ul class="admin-lista">
      ${listaExibir.sort((a, b) => new Date(b.data_entrada) - new Date(a.data_entrada)).map((r) => {
        const p = r.progressoData;
        const qtdDianteiro = p ? p.quantidade_dianteiro_real : 0;
        const qtdTraseiro = p ? p.quantidade_traseiro_real : 0;
        const pesoDianteiro = p ? p.peso_liquido_dianteiro_kg : 0;
        const pesoTraseiro = p ? p.peso_liquido_traseiro_kg : 0;
        const desossadoDianteiro = p ? p.peso_desossado_dianteiro_kg : 0;
        const desossadoTraseiro = p ? p.peso_desossado_traseiro_kg : 0;

        return `
          <li class="recebimento-admin-item">
            <div class="recebimento-admin-topo">
              <span><strong>${r.fornecedor}</strong> — ${fmtDataLocal(r.data_entrada)}</span>
              <span>${r.status === "aberto" ? "🟢 aberto" : "🔒 finalizado"}</span>
            </div>

            <!-- Dados Mantidos Mesmo com Finalização -->
            <div class="pesos-tipo-grid" style="margin: 8px 0;">
              <div class="pesos-tipo-coluna">
                <span class="pesos-tipo-titulo">Dianteiro (${qtdDianteiro}/${r.quantidade_dianteiro_esperada ?? "?"})</span>
                <span><strong>${fmtKg(pesoDianteiro)} kg</strong> entrada</span>
                <span>${fmtKg(desossadoDianteiro)} kg lançado</span>
              </div>
              <div class="pesos-tipo-coluna">
                <span class="pesos-tipo-titulo">Traseiro (${qtdTraseiro}/${r.quantidade_traseiro_esperada ?? "?"})</span>
                <span><strong>${fmtKg(pesoTraseiro)} kg</strong> entrada</span>
                <span>${fmtKg(desossadoTraseiro)} kg lançado</span>
              </div>
            </div>

            <form class="admin-form form-preco" data-recebimento="${r.id}">
              <label class="rotulo-campo">Data do recebimento</label>
              <input name="data_entrada" type="date" value="${r.data_entrada}" required />
              <input name="preco_kg_dianteiro" type="number" step="0.01" placeholder="Preço/kg Dianteiro" value="${r.preco_kg_dianteiro ?? ""}" />
              <input name="preco_kg_traseiro" type="number" step="0.01" placeholder="Preço/kg Traseiro" value="${r.preco_kg_traseiro ?? ""}" />
              <button type="submit" class="botao-secundario">Salvar</button>
            </form>

            ${r.status === "aberto"
              ? `<button class="link-discreto" data-finalizar="${r.id}">Finalizar recebimento</button>`
              : `<button class="link-discreto" data-reabrir="${r.id}">↺ Reabrir recebimento</button>`}
          </li>`;
      }).join("") || '<p class="empty-msg">Nenhum recebimento nesta aba.</p>'}
    </ul>
  `;

  // Lógica das Abas do Gestor
  document.getElementById("aba-gestor-abertos").addEventListener("click", () => { abaGestorRecebimento = "abertos"; renderAdminPecas(); });
  document.getElementById("aba-gestor-concluidos").addEventListener("click", () => { abaGestorRecebimento = "concluidos"; renderAdminPecas(); });

  document.getElementById("mes-anterior").addEventListener("click", () => { mesFiltroAdmin = mesAnterior(mesFiltroAdmin); renderAdminPecas(); });
  document.getElementById("mes-seguinte").addEventListener("click", () => { mesFiltroAdmin = mesSeguinte(mesFiltroAdmin); renderAdminPecas(); });

  c.querySelectorAll(".form-preco").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await atualizarPrecosRecebimento(
        form.dataset.recebimento,
        f.get("preco_kg_dianteiro") ? parseFloat(f.get("preco_kg_dianteiro")) : null,
        f.get("preco_kg_traseiro") ? parseFloat(f.get("preco_kg_traseiro")) : null,
        f.get("data_entrada")
      );
      state.recebimentos = await idbGetAll(STORES.recebimentos);
      mostrarToast("Recebimento atualizado");
      renderAdminShell();
    } catch (err) { alert("Erro ao salvar: " + err.message); }
  }));

  c.querySelectorAll("[data-finalizar]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Finalizar esse recebimento?")) return;
    try {
      await finalizarRecebimento(btn.dataset.finalizar);
      state.recebimentos = await idbGetAll(STORES.recebimentos);
      state.lotes = await idbGetAll(STORES.lotes);
      renderAdminShell();
    } catch (err) { alert("Erro ao finalizar: " + err.message); }
  }));

  c.querySelectorAll("[data-reabrir]").forEach((btn) => btn.addEventListener("click", async () => {
    if (!confirm("Reabrir esse recebimento?")) return;
    try {
      await reabrirRecebimento(btn.dataset.reabrir);
      state.recebimentos = await idbGetAll(STORES.recebimentos);
      state.lotes = await idbGetAll(STORES.lotes);
      renderAdminShell();
    } catch (err) { alert("Erro ao reabrir: " + err.message); }
  }));
}
// ---------- Selo de Pendências Clicável ----------
function atualizarBadgePendente() {
  contarFilaPendente().then((n) => {
    const badge = document.getElementById("pending-badge");
    if (!badge) return;

    if (n > 0) {
      badge.textContent = `🔄 ${n} pendente${n > 1 ? "s" : ""} de envio (toque para enviar)`;
      badge.classList.remove("hidden");
      badge.style.cursor = "pointer";

      // Torna o badge clicável/tocável no celular para forçar o envio manual
      badge.onclick = async () => {
        mostrarToast("Tentando enviar pendências...");
        if (typeof tentarEnviarFila === "function") {
          try {
            await tentarEnviarFila();
            const restantes = await contarFilaPendente();
            if (restantes === 0) {
              mostrarToast("Tudo sincronizado!");
            } else {
              mostrarToast(`Ainda restam ${restantes} item(ns). Veja os Logs no Gestor.`);
            }
          } catch (err) {
            mostrarToast("Erro ao tentar sincronizar.");
          }
        }
        atualizarBadgePendente();
      };
    } else {
      badge.classList.add("hidden");
      badge.onclick = null;
    }
  });
}

// ---------- Banner Offline ----------
function atualizarBannerOffline() {
  const banner = document.getElementById("offline-banner");
  if (banner) banner.classList.toggle("hidden", navigator.onLine);
}

async function registrarSincronizacaoSegundoPlano() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('sincronizar-fila-desossa');
  }
}

// ---------- Bootstrap ----------
async function bootstrap() {
  // Força limpar a sessão ao abrir/recarregar para sempre exigir o login com PIN
  await limparSessao();
  state.usuario = null;
  state.loteAtivo = null;

  const online = await atualizarCacheReferencia();
  if (!online) {
    mostrarToast("Sem internet — usando dados salvos no aparelho");
  }
  state.colaboradores = await idbGetAll(STORES.colaboradores);
  state.cortes = await idbGetAll(STORES.cortes);
  state.recebimentos = await idbGetAll(STORES.recebimentos);
  state.lotes = await idbGetAll(STORES.lotes);

  atualizarBadgePendente();
  atualizarBannerOffline();
  
  window.addEventListener("online", () => {
    atualizarBannerOffline();
    if (typeof tentarEnviarFila === "function") {
      tentarEnviarFila().then(() => atualizarBadgePendente());
    }
  });
  
  window.addEventListener("offline", atualizarBannerOffline);

  // Sempre força a inicialização na tela de login
  location.hash = "#login";
  renderRota();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

bootstrap();