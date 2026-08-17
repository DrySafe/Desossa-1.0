-- ============================================================
-- MIGRAÇÃO — Peso total e peso já lançado, por tipo (Dianteiro/Traseiro), no progresso do recebimento
-- ============================================================

drop view if exists vw_lancamentos_completo cascade;
drop view if exists vw_recebimentos_progresso cascade;

create view vw_recebimentos_progresso as
with lote_soma as (
  select lote_id, sum(peso_kg) as peso_lancado
  from lancamentos
  group by lote_id
)
select
  r.id as recebimento_id,
  r.fornecedor,
  r.data_entrada,
  r.criado_em as recebimento_criado_em,
  r.status,
  r.planilha_sheet_id,
  r.planilha_url,
  r.quantidade_dianteiro_esperada,
  r.quantidade_traseiro_esperada,
  count(*) filter (where lo.tipo = 'dianteiro') as quantidade_dianteiro_real,
  count(*) filter (where lo.tipo = 'traseiro') as quantidade_traseiro_real,
  coalesce(sum(lo.peso_entrada_kg) filter (where lo.tipo = 'dianteiro'), 0) as peso_liquido_dianteiro_kg,
  coalesce(sum(lo.peso_entrada_kg) filter (where lo.tipo = 'traseiro'), 0) as peso_liquido_traseiro_kg,
  coalesce(sum(ls.peso_lancado) filter (where lo.tipo = 'dianteiro'), 0) as peso_desossado_dianteiro_kg,
  coalesce(sum(ls.peso_lancado) filter (where lo.tipo = 'traseiro'), 0) as peso_desossado_traseiro_kg,
  max(lo.criado_em) as ultima_peca_registrada_em,
  (
    count(*) filter (where lo.tipo = 'dianteiro') >= coalesce(r.quantidade_dianteiro_esperada, 0)
    and count(*) filter (where lo.tipo = 'traseiro') >= coalesce(r.quantidade_traseiro_esperada, 0)
    and (coalesce(r.quantidade_dianteiro_esperada, 0) + coalesce(r.quantidade_traseiro_esperada, 0)) > 0
  ) as todas_pecas_registradas
from recebimentos r
left join lotes lo on lo.recebimento_id = r.id
left join lote_soma ls on ls.lote_id = lo.id
group by r.id, r.fornecedor, r.data_entrada, r.criado_em, r.status, r.planilha_sheet_id, r.planilha_url,
  r.quantidade_dianteiro_esperada, r.quantidade_traseiro_esperada;

create view vw_lancamentos_completo as
select
  l.*,
  p.quantidade_dianteiro_esperada,
  p.quantidade_traseiro_esperada,
  p.quantidade_dianteiro_real,
  p.quantidade_traseiro_real,
  p.peso_liquido_dianteiro_kg,
  p.peso_liquido_traseiro_kg,
  p.peso_desossado_dianteiro_kg,
  p.peso_desossado_traseiro_kg,
  p.todas_pecas_registradas,
  p.recebimento_criado_em,
  p.ultima_peca_registrada_em
from vw_lancamentos_detalhado l
join vw_recebimentos_progresso p on p.recebimento_id = l.recebimento_id;

notify pgrst, 'reload schema';
