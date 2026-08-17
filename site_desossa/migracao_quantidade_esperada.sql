-- ============================================================
-- MIGRAÇÃO — Quantidade esperada de peças por recebimento (Dianteiro/Traseiro)
-- ============================================================
-- Permite saber, olhando só os dados, quando um recebimento "começa" e "termina" —
-- útil pra gerar o arquivo Excel corretamente no n8n, comparando quantidade esperada x real.
-- ============================================================

alter table recebimentos add column if not exists quantidade_dianteiro_esperada int;
alter table recebimentos add column if not exists quantidade_traseiro_esperada int;

-- ---------- View: progresso do recebimento (esperado x real, início/fim, completo ou não) ----------
create or replace view vw_recebimentos_progresso as
select
  r.id as recebimento_id,
  r.fornecedor,
  r.data_entrada,
  r.criado_em as recebimento_criado_em,       -- "início" do recebimento
  r.status,
  r.quantidade_dianteiro_esperada,
  r.quantidade_traseiro_esperada,
  count(*) filter (where lo.tipo = 'dianteiro') as quantidade_dianteiro_real,
  count(*) filter (where lo.tipo = 'traseiro') as quantidade_traseiro_real,
  max(lo.criado_em) as ultima_peca_registrada_em, -- "fim" aproximado, enquanto não finalizado manualmente
  (
    count(*) filter (where lo.tipo = 'dianteiro') >= coalesce(r.quantidade_dianteiro_esperada, 0)
    and count(*) filter (where lo.tipo = 'traseiro') >= coalesce(r.quantidade_traseiro_esperada, 0)
    and (coalesce(r.quantidade_dianteiro_esperada, 0) + coalesce(r.quantidade_traseiro_esperada, 0)) > 0
  ) as todas_pecas_registradas
from recebimentos r
left join lotes lo on lo.recebimento_id = r.id
group by r.id, r.fornecedor, r.data_entrada, r.criado_em, r.status, r.quantidade_dianteiro_esperada, r.quantidade_traseiro_esperada;

notify pgrst, 'reload schema';
