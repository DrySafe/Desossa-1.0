'use strict';
const estado = { linhas: [], pronto: false, requisicao: 0, ordenar: 'data_referencia', asc: false };
const $ = id => document.getElementById(id);
const kg = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
const moeda = n => n === null ? 'Pendente' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = n => n === null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : 'Sem data';
function celula(tr, valor) { const td = document.createElement('td'); td.textContent = valor; tr.append(td); }
function periodo(dias) {
  $('data-fim').value = Relatorios.isoLocal();
  $('data-inicio').value = Relatorios.deslocar($('data-fim').value, -(Math.max(dias, 1) - 1));
}
function filtrar() {
  return estado.linhas.filter(p => (!$('filtro-fornecedor').value || p.fornecedor === $('filtro-fornecedor').value)
    && (!$('filtro-tipo').value || p.tipo === $('filtro-tipo').value));
}
async function carregarDados() {
  const id = ++estado.requisicao;
  estado.pronto = false;
  $('btn-exportar').disabled = true;
  $('resumo-periodo').textContent = 'Carregando todos os registros do período…';
  const inicio = $('data-inicio').value, fim = $('data-fim').value;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || inicio > fim) throw new Error('Informe um período válido.');
    const client = criarClienteTeste();
    const linhas = []; let esperado = null;
    for (let offset = 0; ; offset += 500) {
      const { data, error, count } = await client.from('vw_relatorio_pecas').select('*', { count: 'exact' })
        .gte('data_referencia', inicio).lte('data_referencia', fim).order('lote_id').range(offset, offset + 499);
      if (id !== estado.requisicao) return;
      if (error) throw error;
      if (!Array.isArray(data) || !Number.isInteger(count)) throw new Error('Não foi possível confirmar a integridade do relatório.');
      if (esperado !== null && esperado !== count) throw new Error('Dados mudaram durante a consulta. Atualize novamente.');
      esperado = count;
      linhas.push(...data);
      if (linhas.length === count) break;
      if (linhas.length > count) throw new Error('Contagem inconsistente.');
      if (!data.length) throw new Error('Consulta incompleta. Atualize novamente.');
    }
    estado.linhas = linhas.map(Relatorios.peca);
    const anterior = $('filtro-fornecedor').value;
    $('filtro-fornecedor').replaceChildren(new Option('Todos', ''));
    [...new Set(linhas.map(p => p.fornecedor || 'Legado sem recebimento'))].sort().forEach(n => $('filtro-fornecedor').add(new Option(n, n)));
    $('filtro-fornecedor').value = anterior;
    estado.pronto = true;
    $('btn-exportar').disabled = false;
    $('resumo-periodo').textContent = `${dataBR(inicio)} até ${dataBR(fim)} · por data do recebimento; peças legadas usam a data de entrada disponível.`;
    $('ultima-atualizacao').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    renderizar();
  } catch (err) {
    if (id !== estado.requisicao) return;
    estado.linhas = [];
    $('grid-kpi').replaceChildren();
    $('tabela-pecas').querySelector('tbody').replaceChildren();
    $('resumo-periodo').textContent = 'Relatório indisponível: ' + (err.message || 'confira a conexão.');
    $('ultima-atualizacao').textContent = 'Dados não confirmados. Não utilize totais anteriores.';
  }
}
function renderizar() {
  if (!estado.pronto) return;
  const linhas = filtrar(), m = Relatorios.totais(linhas);
  $('grid-kpi').replaceChildren();
  for (const [titulo, valor] of [
    ['Peso líquido recebido', kg(m.entrada)], ['Carne aproveitável', kg(m.carne)],
    ['Sebo e osso', kg(m.sebo)], ['Perda registrada', kg(m.quebra)],
    ['Saldo a conferir', kg(m.saldo)], ['Rendimento de carne', pct(m.rendimento)],
    ['Valor estimado dos cortes', moeda(m.valor)], ['Custo da matéria-prima', moeda(m.custo)],
    ['Resultado estimado', moeda(m.resultado)]
  ]) {
    const card = document.createElement('div'); card.className = 'kpi-card';
    const label = document.createElement('span'); label.className = 'kpi-label'; label.textContent = titulo;
    const value = document.createElement('strong'); value.className = 'kpi-valor'; value.textContent = valor;
    card.append(label, value); $('grid-kpi').append(card);
  }
  $('aviso-conferencia').textContent = `${linhas.length} peça(s). ${m.pendentes} com preços/custos pendentes. Valores estimados; peças abertas são provisórias. Saldo a conferir não é perda. Pesos excedidos exigem revisão.`;
  const tbody = $('tabela-pecas').querySelector('tbody'); tbody.replaceChildren();
  linhas.sort((a,b) => {
    const va = a[estado.ordenar] ?? '', vb = b[estado.ordenar] ?? '';
    const result = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
    return estado.asc ? result : -result;
  });
  for (const p of linhas) {
    const tr = document.createElement('tr');
    for (const v of [p.fornecedor, p.tipo, p.numero_peca ?? '—', dataBR(p.data_referencia), kg(p.entrada), kg(p.carne), kg(p.sebo), kg(p.quebra), kg(p.saldo), moeda(p.valor), moeda(p.custo), p.statusConferencia + (p.provisorio ? ' · provisório' : '')]) celula(tr, v);
    tbody.append(tr);
  }
  if (!linhas.length) { const tr=document.createElement('tr'); celula(tr,'Nenhuma peça no período.'); tbody.append(tr); }
}
function exportarCSV() {
  if (!estado.pronto) return;
  const linhas = [['Fornecedor','Tipo','Peça','Data referência','Líquido kg','Carne kg','Sebo e osso kg','Perda registrada kg','Saldo kg','Valor estimado R$','Custo R$','Status'],
    ...filtrar().map(p => [p.fornecedor,p.tipo,p.numero_peca,p.data_referencia,p.entrada,p.carne,p.sebo,p.quebra,p.saldo,p.valor,p.custo,p.statusConferencia])];
  const csv = linhas.map(l => l.map(Relatorios.campoCSV).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`desossa-testes-${$('data-inicio').value}-${$('data-fim').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
let verificandoAcesso = false;
async function verificarAcesso() {
  if (verificandoAcesso) return;
  verificandoAcesso = true;
  $('portao-mensagem').textContent = 'Verificando seu acesso…';
  $('portao-tentar').classList.add('hidden');
  $('portao-voltar').classList.add('hidden');
  try {
    const sessao = await sessaoAPI(null, 'GET');
    if (!sessao.authenticated || sessao.role !== 'gestor') {
      $('portao-mensagem').textContent = sessao.authenticated
        ? 'Seu perfil não tem permissão para acessar o painel.'
        : 'Sua sessão terminou. Entre no aplicativo para acessar o painel.';
      $('portao-voltar').classList.remove('hidden');
      return;
    }
    $('portao').classList.add('hidden');
    $('painel').classList.remove('hidden');
    await carregarDados();
  } catch (erro) {
    $('portao-mensagem').textContent = 'Não foi possível verificar seu acesso. Tente novamente.';
    $('portao-tentar').classList.remove('hidden');
    $('portao-voltar').classList.remove('hidden');
  } finally { verificandoAcesso = false; }
}
periodo(7);
$('portao-tentar').addEventListener('click', verificarAcesso);
verificarAcesso();
$('btn-atualizar').addEventListener('click',carregarDados);
$('btn-exportar').addEventListener('click',exportarCSV);
for(const id of ['data-inicio','data-fim']) $(id).addEventListener('change',carregarDados);
for(const id of ['filtro-fornecedor','filtro-tipo']) $(id).addEventListener('change',renderizar);
document.querySelectorAll('[data-dias]').forEach(b=>b.addEventListener('click',()=>{periodo(Number(b.dataset.dias));carregarDados()}));
document.querySelectorAll('[data-ordenar]').forEach(th=>th.addEventListener('click',()=>{estado.asc=estado.ordenar===th.dataset.ordenar?!estado.asc:true;estado.ordenar=th.dataset.ordenar;renderizar()}));
