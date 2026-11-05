/* Regras de conferência, compartilhadas pelo painel e testes offline. */
(function (root) {
  'use strict';
  const gramas = n => Math.round(Number(n || 0) * 1000);
  const centavos = n => Math.round(Number(n || 0) * 100);
  function numero(n) {
    if (n === null || n === undefined || n === '') return null;
    const value = Number(n);
    if (!Number.isFinite(value)) throw new Error('Valor numérico inválido no relatório.');
    return value;
  }
  function peca(p) {
    const entrada = numero(p.peso_liquido_kg);
    if (entrada === null || entrada <= 0) throw new Error('Peça sem peso líquido válido.');
    const carne = numero(p.peso_carne_kg) ?? 0;
    const sebo = numero(p.peso_sebo_osso_kg) ?? 0;
    const quebra = numero(p.peso_quebra_kg) ?? 0;
    const custoKg = numero(p.preco_kg_custo);
    const valor = numero(p.valor_estimado) ?? 0;
    const saldo = (gramas(entrada) - gramas(carne) - gramas(sebo) - gramas(quebra)) / 1000;
    const precoPendente = custoKg === null || Number(p.lancamentos_sem_preco || 0) > 0;
    const custo = custoKg === null ? null : Math.round(entrada * custoKg * 100) / 100;
    const resultado = precoPendente ? null : Math.round((valor - custo) * 100) / 100;
    return { ...p, entrada, carne, sebo, quebra, saldo, valor, custo, resultado, precoPendente,
      rendimento: carne / entrada * 100,
      quebraPct: quebra / entrada * 100,
      statusConferencia: saldo < -0.001 ? 'Peso excedido' : saldo > 0.001 ? 'Saldo a conferir' : 'Peso conciliado',
      provisorio: p.status_recebimento !== 'finalizado' && p.status_lote !== 'fechado' };
  }
  function totais(linhas) {
    const somarPeso = key => linhas.reduce((s, p) => s + gramas(p[key]), 0) / 1000;
    const entrada = somarPeso('entrada');
    const carne = somarPeso('carne');
    const quebra = somarPeso('quebra');
    const valor = linhas.reduce((s, p) => s + centavos(p.valor), 0) / 100;
    const pendentes = linhas.filter(p => p.precoPendente).length;
    const custo = pendentes ? null : linhas.reduce((s, p) => s + centavos(p.custo), 0) / 100;
    return { entrada, carne, quebra, sebo: somarPeso('sebo'), saldo: somarPeso('saldo'), valor, custo,
      resultado: custo === null ? null : Math.round((valor - custo) * 100) / 100,
      pendentes, pecas: linhas.length, rendimento: entrada ? carne / entrada * 100 : null,
      quebraPct: entrada ? quebra / entrada * 100 : null };
  }
  function campoCSV(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function isoLocal(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  function deslocar(data, dias) {
    const d = new Date(data + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  const api = { peca, totais, campoCSV, isoLocal, deslocar };
  root.Relatorios = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
