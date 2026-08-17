// ============================================================
// PAINEL-GESTOR.js — dashboard desktop-first pro gestor
// ============================================================
let sb = null;
function getSupabaseClient() {
  if (!sb) sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
  return sb;
}

const estado = {
  dataInicio: null,
  dataFim: null,
  fornecedor: "",
  tipo: "",
  compararAnterior: true,
  lancamentos: [],
  pecas: [],
  lancamentosAnterior: [],
  pecasAnterior: [],
  ordenarPor: "data_desossa",
  ordenarAsc: false
};

const graficos = {}; // instâncias do Chart.js, pra poder destruir e recriar

function fmtKg(n) { return (Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtR$(n) { return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtPct(n) { return (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"; }
function fmtData(d) { return d ? new Date(d + (String(d).length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR") : "—"; }

// ---------- Portão de senha ----------
document.getElementById("portao-entrar").addEventListener("click", tentarEntrar);
document.getElementById("portao-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") tentarEntrar(); });
function tentarEntrar() {
  const valor = document.getElementById("portao-senha").value;
  if (valor === APP_CONFIG.ADMIN_PASSWORD) {
    document.getElementById("portao").classList.add("hidden");
    document.getElementById("painel").classList.remove("hidden");
    iniciar();
  } else {
    document.getElementById("portao-erro").classList.remove("hidden");
  }
}

// ---------- Inicialização ----------
function iniciar() {
  const hoje = new Date();
  const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(hoje.getDate() - 6);
  document.getElementById("data-inicio").value = isoData(seteDiasAtras);
  document.getElementById("data-fim").value = isoData(hoje);
  estado.dataInicio = isoData(seteDiasAtras);
  estado.dataFim = isoData(hoje);

  document.querySelectorAll("#chips-periodo button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#chips-periodo button").forEach((b) => b.classList.remove("ativo"));
      btn.classList.add("ativo");
      const dias = parseInt(btn.dataset.dias, 10);
      const fim = new Date();
      const inicio = new Date(); inicio.setDate(fim.getDate() - dias);
      document.getElementById("data-inicio").value = isoData(inicio);
      document.getElementById("data-fim").value = isoData(fim);
      estado.dataInicio = isoData(inicio);
      estado.dataFim = isoData(fim);
      carregarDados();
    });
  });
  document.getElementById("data-inicio").addEventListener("change", (e) => { estado.dataInicio = e.target.value; desmarcarChips(); });
  document.getElementById("data-fim").addEventListener("change", (e) => { estado.dataFim = e.target.value; desmarcarChips(); });
  document.getElementById("filtro-fornecedor").addEventListener("change", (e) => { estado.fornecedor = e.target.value; carregarDados(); });
  document.getElementById("filtro-tipo").addEventListener("change", (e) => { estado.tipo = e.target.value; carregarDados(); });
  document.getElementById("comparar-anterior").addEventListener("change", (e) => { estado.compararAnterior = e.target.checked; carregarDados(); });
  document.getElementById("btn-atualizar").addEventListener("click", carregarDados);
  document.getElementById("btn-exportar").addEventListener("click", exportarCSV);
  document.querySelectorAll("#tabela-pecas th[data-ordenar]").forEach((th) => {
    th.addEventListener("click", () => {
      const campo = th.dataset.ordenar;
      if (estado.ordenarPor === campo) estado.ordenarAsc = !estado.ordenarAsc;
      else { estado.ordenarPor = campo; estado.ordenarAsc = false; }
      renderTabelaPecas();
    });
  });

  carregarDados();
}

function desmarcarChips() { document.querySelectorAll("#chips-periodo button").forEach((b) => b.classList.remove("ativo")); }
function isoData(d) { return d.toISOString().slice(0, 10); }
function diasEntre(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

// ---------- Carregamento de dados ----------
async function carregarDados() {
  const client = getSupabaseClient();
  document.getElementById("resumo-periodo").textContent = "Carregando…";

  const fimExclusivo = new Date(estado.dataFim); fimExclusivo.setDate(fimExclusivo.getDate() + 1);
  const fimExclusivoIso = isoData(fimExclusivo);

  try {
    let qLanc = client.from("vw_lancamentos_detalhado").select("*")
      .gte("criado_em", estado.dataInicio).lt("criado_em", fimExclusivoIso);
    let qPecas = client.from("vw_rendimento_lote").select("*")
      .gte("data_desossa", estado.dataInicio).lt("data_desossa", fimExclusivoIso);
    if (estado.fornecedor) { qLanc = qLanc.eq("fornecedor", estado.fornecedor); qPecas = qPecas.eq("fornecedor", estado.fornecedor); }
    if (estado.tipo) { qLanc = qLanc.eq("lote_tipo", estado.tipo); qPecas = qPecas.eq("tipo", estado.tipo); }

    const [{ data: lancamentos }, { data: pecas }] = await Promise.all([qLanc, qPecas]);
    estado.lancamentos = lancamentos || [];
    estado.pecas = pecas || [];

    if (estado.compararAnterior) {
      const nDias = diasEntre(estado.dataInicio, estado.dataFim) + 1;
      const inicioAnterior = new Date(estado.dataInicio); inicioAnterior.setDate(inicioAnterior.getDate() - nDias);
      const fimAnterior = new Date(estado.dataInicio);
      let qLancA = client.from("vw_lancamentos_detalhado").select("*")
        .gte("criado_em", isoData(inicioAnterior)).lt("criado_em", isoData(fimAnterior));
      let qPecasA = client.from("vw_rendimento_lote").select("*")
        .gte("data_desossa", isoData(inicioAnterior)).lt("data_desossa", isoData(fimAnterior));
      if (estado.fornecedor) { qLancA = qLancA.eq("fornecedor", estado.fornecedor); qPecasA = qPecasA.eq("fornecedor", estado.fornecedor); }
      if (estado.tipo) { qLancA = qLancA.eq("lote_tipo", estado.tipo); qPecasA = qPecasA.eq("tipo", estado.tipo); }
      const [{ data: lancA }, { data: pecasA }] = await Promise.all([qLancA, qPecasA]);
      estado.lancamentosAnterior = lancA || [];
      estado.pecasAnterior = pecasA || [];
    } else {
      estado.lancamentosAnterior = [];
      estado.pecasAnterior = [];
    }

    await preencherFiltroFornecedores(client);
    document.getElementById("resumo-periodo").textContent =
      `${fmtData(estado.dataInicio)} até ${fmtData(estado.dataFim)}` +
      (estado.fornecedor ? ` · ${estado.fornecedor}` : "") +
      (estado.tipo ? ` · ${estado.tipo === "dianteiro" ? "Dianteiro" : "Traseiro"}` : "");
    document.getElementById("ultima-atualizacao").textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR");

    renderTudo();
  } catch (err) {
    console.error(err);
    document.getElementById("resumo-periodo").textContent = "Erro ao carregar dados — confira a conexão.";
  }
}

async function preencherFiltroFornecedores(client) {
  const select = document.getElementById("filtro-fornecedor");
  if (select.dataset.carregado) return;
  const { data } = await client.from("recebimentos").select("fornecedor").order("fornecedor");
  const nomes = [...new Set((data || []).map((r) => r.fornecedor))];
  nomes.forEach((n) => { const op = document.createElement("option"); op.value = n; op.textContent = n; select.appendChild(op); });
  select.dataset.carregado = "1";
}

// ---------- Cálculo de métricas ----------
function calcularMetricas(lancamentos, pecas) {
  const pesoLiquido = pecas.reduce((s, p) => s + Number(p.peso_liquido_kg || 0), 0);
  const pesoDesossado = pecas.reduce((s, p) => s + Number(p.peso_total_desossado || 0), 0);
  const quebraKg = pesoLiquido - pesoDesossado;
  const vendaTotal = lancamentos.reduce((s, l) => s + Number(l.venda_total || 0), 0);
  const custoTotal = lancamentos.reduce((s, l) => s + Number(l.custo_total || 0), 0);
  const margemR$ = vendaTotal - custoTotal;
  return {
    pesoLiquido, pesoDesossado, quebraKg,
    rendimentoPct: pesoLiquido ? (pesoDesossado / pesoLiquido) * 100 : 0,
    quebraPct: pesoLiquido ? (quebraKg / pesoLiquido) * 100 : 0,
    vendaTotal, custoTotal, margemR$,
    margemPct: vendaTotal ? (margemR$ / vendaTotal) * 100 : 0,
    ticketMedio: pesoDesossado ? vendaTotal / pesoDesossado : 0,
    nPecas: pecas.length,
    nLancamentos: lancamentos.length,
    nColaboradores: new Set(lancamentos.map((l) => l.colaborador_nome)).size
  };
}

function delta(atual, anterior) {
  if (!estado.compararAnterior) return null;
  if (!anterior) return { texto: "sem período anterior", classe: "neutro" };
  const diff = atual - anterior;
  const pct = anterior !== 0 ? (diff / Math.abs(anterior)) * 100 : 0;
  const seta = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
  const classe = diff > 0 ? "positivo" : diff < 0 ? "negativo" : "neutro";
  return { texto: `${seta} ${Math.abs(pct).toFixed(1)}% vs período anterior`, classe };
}

// ---------- Render geral ----------
function renderTudo() {
  const m = calcularMetricas(estado.lancamentos, estado.pecas);
  const mAnterior = estado.compararAnterior ? calcularMetricas(estado.lancamentosAnterior, estado.pecasAnterior) : null;
  renderKPIs(m, mAnterior);
  renderGraficoEvolucao();
  renderGraficoDianteiroTraseiro();
  renderGraficoColaboradores();
  renderGraficoCortes();
  renderTabelaFornecedores();
  renderTabelaPecas();
}

function renderKPIs(m, mA) {
  const cartoes = [
    { label: "Rendimento", valor: fmtPct(m.rendimentoPct), delta: mA ? delta(m.rendimentoPct, mA.rendimentoPct) : null, destaque: true },
    { label: "Margem bruta", valor: fmtPct(m.margemPct), delta: mA ? delta(m.margemPct, mA.margemPct) : null, destaque: true },
    { label: "Quebra", valor: `${fmtPct(m.quebraPct)} (${fmtKg(m.quebraKg)} kg)`, delta: mA ? delta(mA.quebraPct, m.quebraPct) : null },
    { label: "Peso líquido recebido", valor: `${fmtKg(m.pesoLiquido)} kg`, delta: mA ? delta(m.pesoLiquido, mA.pesoLiquido) : null },
    { label: "Peso desossado", valor: `${fmtKg(m.pesoDesossado)} kg`, delta: mA ? delta(m.pesoDesossado, mA.pesoDesossado) : null },
    { label: "Venda total", valor: fmtR$(m.vendaTotal), delta: mA ? delta(m.vendaTotal, mA.vendaTotal) : null },
    { label: "Custo total", valor: fmtR$(m.custoTotal), delta: mA ? delta(mA.custoTotal, m.custoTotal) : null },
    { label: "Lucro bruto", valor: fmtR$(m.margemR$), delta: mA ? delta(m.margemR$, mA.margemR$) : null },
    { label: "Ticket médio (R$/kg)", valor: fmtR$(m.ticketMedio), delta: mA ? delta(m.ticketMedio, mA.ticketMedio) : null },
    { label: "Peças processadas", valor: m.nPecas, delta: null },
    { label: "Lançamentos", valor: m.nLancamentos, delta: null },
    { label: "Colaboradores ativos", valor: m.nColaboradores, delta: null }
  ];
  document.getElementById("grid-kpi").innerHTML = cartoes.map((c) => `
    <div class="kpi-card ${c.destaque ? "destaque" : ""}">
      <span class="kpi-label">${c.label}</span>
      <span class="kpi-valor">${c.valor}</span>
      ${c.delta ? `<span class="kpi-delta ${c.delta.classe}">${c.delta.texto}</span>` : ""}
    </div>
  `).join("");
}

function destruirGrafico(chave) { if (graficos[chave]) { graficos[chave].destroy(); delete graficos[chave]; } }

function renderGraficoEvolucao() {
  const porDia = {};
  estado.lancamentos.forEach((l) => {
    const dia = String(l.criado_em).slice(0, 10);
    porDia[dia] = porDia[dia] || { venda: 0, custo: 0 };
    porDia[dia].venda += Number(l.venda_total || 0);
    porDia[dia].custo += Number(l.custo_total || 0);
  });
  const porDiaQuebra = {};
  estado.pecas.forEach((p) => {
    const dia = String(p.data_desossa);
    porDiaQuebra[dia] = porDiaQuebra[dia] || { liquido: 0, desossado: 0 };
    porDiaQuebra[dia].liquido += Number(p.peso_liquido_kg || 0);
    porDiaQuebra[dia].desossado += Number(p.peso_total_desossado || 0);
  });
  const dias = [...new Set([...Object.keys(porDia), ...Object.keys(porDiaQuebra)])].sort();
  const margemSerie = dias.map((d) => { const v = porDia[d]; return v && v.venda ? ((v.venda - v.custo) / v.venda) * 100 : null; });
  const quebraSerie = dias.map((d) => { const v = porDiaQuebra[d]; return v && v.liquido ? ((v.liquido - v.desossado) / v.liquido) * 100 : null; });

  destruirGrafico("evolucao");
  graficos.evolucao = new Chart(document.getElementById("grafico-evolucao"), {
    type: "line",
    data: {
      labels: dias.map(fmtData),
      datasets: [
        { label: "Margem %", data: margemSerie, borderColor: "#4C7A57", backgroundColor: "transparent", tension: 0.3, spanGaps: true },
        { label: "Quebra %", data: quebraSerie, borderColor: "#A8402B", backgroundColor: "transparent", tension: 0.3, spanGaps: true }
      ]
    },
    options: { responsive: true, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } } }
  });
}

function renderGraficoDianteiroTraseiro() {
  const grupos = { dianteiro: { liquido: 0, desossado: 0, venda: 0, custo: 0 }, traseiro: { liquido: 0, desossado: 0, venda: 0, custo: 0 } };
  estado.pecas.forEach((p) => { const g = grupos[p.tipo]; if (g) { g.liquido += Number(p.peso_liquido_kg || 0); g.desossado += Number(p.peso_total_desossado || 0); } });
  estado.lancamentos.forEach((l) => { const g = grupos[l.lote_tipo]; if (g) { g.venda += Number(l.venda_total || 0); g.custo += Number(l.custo_total || 0); } });
  const rendimento = ["dianteiro", "traseiro"].map((t) => grupos[t].liquido ? (grupos[t].desossado / grupos[t].liquido) * 100 : 0);
  const margem = ["dianteiro", "traseiro"].map((t) => grupos[t].venda ? ((grupos[t].venda - grupos[t].custo) / grupos[t].venda) * 100 : 0);

  destruirGrafico("dianteiroTraseiro");
  graficos.dianteiroTraseiro = new Chart(document.getElementById("grafico-dianteiro-traseiro"), {
    type: "bar",
    data: {
      labels: ["Dianteiro", "Traseiro"],
      datasets: [
        { label: "Rendimento %", data: rendimento, backgroundColor: "#375061" },
        { label: "Margem %", data: margem, backgroundColor: "#A8402B" }
      ]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });
}

function renderGraficoColaboradores() {
  const porColab = {};
  estado.lancamentos.forEach((l) => { porColab[l.colaborador_nome] = (porColab[l.colaborador_nome] || 0) + Number(l.peso_kg || 0); });
  const nomes = Object.keys(porColab).sort((a, b) => porColab[b] - porColab[a]).slice(0, 10);

  destruirGrafico("colaboradores");
  graficos.colaboradores = new Chart(document.getElementById("grafico-colaboradores"), {
    type: "bar",
    data: { labels: nomes, datasets: [{ label: "Kg lançado", data: nomes.map((n) => porColab[n]), backgroundColor: "#4C7A57" }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } } }
  });
}

function renderGraficoCortes() {
  const porCorte = {};
  estado.lancamentos.forEach((l) => { porCorte[l.corte_nome] = (porCorte[l.corte_nome] || 0) + Number(l.peso_kg || 0); });
  const nomes = Object.keys(porCorte).sort((a, b) => porCorte[b] - porCorte[a]).slice(0, 14);

  destruirGrafico("cortes");
  graficos.cortes = new Chart(document.getElementById("grafico-cortes"), {
    type: "bar",
    data: { labels: nomes, datasets: [{ label: "Kg", data: nomes.map((n) => porCorte[n]), backgroundColor: "#A8402B" }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } } } }
  });
}

function renderTabelaFornecedores() {
  const porFornecedor = {};
  estado.pecas.forEach((p) => {
    porFornecedor[p.fornecedor] = porFornecedor[p.fornecedor] || { pecas: 0, liquido: 0, desossado: 0 };
    porFornecedor[p.fornecedor].pecas += 1;
    porFornecedor[p.fornecedor].liquido += Number(p.peso_liquido_kg || 0);
    porFornecedor[p.fornecedor].desossado += Number(p.peso_total_desossado || 0);
  });
  const vendaCustoPorFornecedor = {};
  estado.lancamentos.forEach((l) => {
    vendaCustoPorFornecedor[l.fornecedor] = vendaCustoPorFornecedor[l.fornecedor] || { venda: 0, custo: 0 };
    vendaCustoPorFornecedor[l.fornecedor].venda += Number(l.venda_total || 0);
    vendaCustoPorFornecedor[l.fornecedor].custo += Number(l.custo_total || 0);
  });

  const linhas = Object.keys(porFornecedor).map((f) => {
    const d = porFornecedor[f];
    const vc = vendaCustoPorFornecedor[f] || { venda: 0, custo: 0 };
    const rendimento = d.liquido ? (d.desossado / d.liquido) * 100 : 0;
    const quebra = d.liquido ? ((d.liquido - d.desossado) / d.liquido) * 100 : 0;
    const margem = vc.venda ? ((vc.venda - vc.custo) / vc.venda) * 100 : 0;
    return { fornecedor: f, pecas: d.pecas, liquido: d.liquido, rendimento, quebra, margem };
  }).sort((a, b) => b.liquido - a.liquido);

  document.querySelector("#tabela-fornecedores tbody").innerHTML = linhas.map((l) => `
    <tr>
      <td>${l.fornecedor}</td>
      <td>${l.pecas}</td>
      <td>${fmtKg(l.liquido)} kg</td>
      <td>${fmtPct(l.rendimento)}</td>
      <td>${fmtPct(l.quebra)}</td>
      <td>${fmtPct(l.margem)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Nenhum dado no período.</td></tr>`;
}

function renderTabelaPecas() {
  const vendaCustoPorLote = {};
  estado.lancamentos.forEach((l) => {
    vendaCustoPorLote[l.lote_id] = vendaCustoPorLote[l.lote_id] || { venda: 0, custo: 0 };
    vendaCustoPorLote[l.lote_id].venda += Number(l.venda_total || 0);
    vendaCustoPorLote[l.lote_id].custo += Number(l.custo_total || 0);
  });

  let linhas = estado.pecas.map((p) => {
    const vc = vendaCustoPorLote[p.lote_id] || { venda: 0, custo: 0 };
    const quebra_pct = p.peso_liquido_kg ? ((p.peso_liquido_kg - p.peso_total_desossado) / p.peso_liquido_kg) * 100 : 0;
    const margem_pct = vc.venda ? ((vc.venda - vc.custo) / vc.venda) * 100 : 0;
    const completa = Math.abs(Number(p.peso_total_desossado || 0) - Number(p.peso_liquido_kg || 0)) < 0.001;
    return { ...p, quebra_pct, margem_pct, completa };
  });

  linhas.sort((a, b) => {
    const campo = estado.ordenarPor;
    let va = a[campo], vb = b[campo];
    if (typeof va === "string") { va = va || ""; vb = vb || ""; return estado.ordenarAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
    va = Number(va || 0); vb = Number(vb || 0);
    return estado.ordenarAsc ? va - vb : vb - va;
  });

  document.querySelector("#tabela-pecas tbody").innerHTML = linhas.map((p) => `
    <tr>
      <td>${p.fornecedor}</td>
      <td>${p.tipo === "dianteiro" ? "Dianteiro" : "Traseiro"}</td>
      <td>${p.numero_peca}</td>
      <td>${fmtData(p.data_desossa)}</td>
      <td>${fmtKg(p.peso_liquido_kg)} kg</td>
      <td>${fmtKg(p.peso_total_desossado)} kg</td>
      <td>${fmtPct(p.quebra_pct)}</td>
      <td>${fmtPct(p.margem_pct)}</td>
      <td>${p.completa
        ? '<span class="selo selo-completa">Completa</span>'
        : p.quebra_pct > 8
          ? '<span class="selo selo-alerta">Quebra alta</span>'
          : '<span class="selo selo-andamento">Em andamento</span>'}</td>
    </tr>
  `).join("") || `<tr><td colspan="9">Nenhuma peça no período.</td></tr>`;
}

// ---------- Exportar CSV ----------
function exportarCSV() {
  const linhas = [["Fornecedor", "Tipo", "Peça", "Data desossa", "Peso líquido kg", "Peso desossado kg", "Quebra %", "Margem %"]];
  estado.pecas.forEach((p) => {
    const vc = estado.lancamentos.filter((l) => l.lote_id === p.lote_id)
      .reduce((acc, l) => ({ venda: acc.venda + Number(l.venda_total || 0), custo: acc.custo + Number(l.custo_total || 0) }), { venda: 0, custo: 0 });
    const quebra_pct = p.peso_liquido_kg ? ((p.peso_liquido_kg - p.peso_total_desossado) / p.peso_liquido_kg) * 100 : 0;
    const margem_pct = vc.venda ? ((vc.venda - vc.custo) / vc.venda) * 100 : 0;
    linhas.push([p.fornecedor, p.tipo, p.numero_peca, p.data_desossa, p.peso_liquido_kg, p.peso_total_desossado, quebra_pct.toFixed(1), margem_pct.toFixed(1)]);
  });
  const csv = linhas.map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `desossa-pecas-${estado.dataInicio}-a-${estado.dataFim}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
