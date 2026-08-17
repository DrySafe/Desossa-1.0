-- ============================================================
-- MIGRAÇÃO — Preço gravado no momento do lançamento (não mais só no cadastro)
-- ============================================================
-- Resolve 2 coisas de uma vez:
-- 1) Corrige o cálculo histórico: hoje a margem de um lançamento antigo muda se o preço do
--    cadastro mudar depois. Com essa migração, o preço fica "congelado" no momento real do
--    lançamento, que é o correto pra dashboard.
-- 2) Prepara o app pra também aceitar preço lido direto da etiqueta (código de barras Code 128,
--    se um dia vocês migrarem pra esse formato) sem precisar de outra migração depois.
-- ============================================================

alter table lancamentos add column if not exists preco_venda_kg numeric(10,2);

-- Preenche os lançamentos que já existem com o preço atual do cadastro (é a melhor aproximação
-- possível pra dados antigos, já que antes esse valor não era gravado por lançamento).
update lancamentos l
set preco_venda_kg = c.preco_venda_kg
from cortes_catalogo c
where c.codigo = l.corte_codigo and l.preco_venda_kg is null;

-- ---------- Views atualizadas: usam o preço gravado no lançamento, não o do cadastro ----------
drop view if exists vw_lancamentos_detalhado cascade;
drop view if exists vw_rendimento_lote cascade;

create view vw_lancamentos_detalhado as
select
  l.id,
  l.lote_id,
  lo.tipo as lote_tipo,
  lo.numero_peca,
  r.id as recebimento_id,
  r.fornecedor,
  r.data_entrada,
  case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end as preco_kg_custo,
  c.codigo as corte_codigo,
  c.nome as corte_nome,
  l.peso_kg,
  l.preco_venda_kg,
  c.preco_venda_kg as preco_catalogo_kg_atual, -- preço de HOJE no cadastro, só pra comparação/divergência
  round(l.peso_kg * coalesce(case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end, 0), 2) as custo_total,
  round(l.peso_kg * coalesce(l.preco_venda_kg, 0), 2) as venda_total,
  case when (l.peso_kg * coalesce(l.preco_venda_kg, 0)) = 0 then 0
    else round((((l.peso_kg * l.preco_venda_kg) - (l.peso_kg * coalesce(case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end, 0)))
         / (l.peso_kg * l.preco_venda_kg)) * 100, 2)
  end as margem_pct,
  col.nome as colaborador_nome,
  l.origem,
  l.criado_em,
  l.criado_em_dispositivo,
  l.sheets_sincronizado_em
from lancamentos l
join lotes lo on lo.id = l.lote_id
join recebimentos r on r.id = lo.recebimento_id
join cortes_catalogo c on c.codigo = l.corte_codigo
join colaboradores col on col.id = l.colaborador_id;

create view vw_rendimento_lote as
select
  lo.id as lote_id,
  lo.tipo,
  lo.numero_peca,
  lo.data_desossa,
  r.id as recebimento_id,
  r.fornecedor,
  r.data_entrada,
  lo.peso_entrada_kg as peso_liquido_kg,
  case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end as preco_kg_custo,
  coalesce(sum(l.peso_kg), 0) as peso_total_desossado,
  sum(round(l.peso_kg * coalesce(l.preco_venda_kg, 0), 2)) as venda_total,
  lo.peso_entrada_kg - coalesce(sum(l.peso_kg), 0) as quebra_kg
from lotes lo
join recebimentos r on r.id = lo.recebimento_id
left join lancamentos l on l.lote_id = lo.id
group by lo.id, lo.tipo, lo.numero_peca, lo.data_desossa, r.id, r.fornecedor, r.data_entrada, lo.peso_entrada_kg, r.preco_kg_dianteiro, r.preco_kg_traseiro;

notify pgrst, 'reload schema';
