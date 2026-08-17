-- ============================================================
-- MIGRAÇÃO — Recebimento (peças) vira uma etapa própria, feita pelo colaborador
-- Rode isto no SQL Editor do Supabase. Não apaga dados já existentes.
-- ============================================================

-- ---------- 1. Nova tabela: recebimentos ----------
create table if not exists recebimentos (
  id uuid primary key default gen_random_uuid(),
  data_entrada date not null default current_date,
  fornecedor text not null,
  placa_veiculo text,
  fiscal_prevencao text,
  acougueiro_acompanhante text,               -- pessoa que acompanhou a entrega (não é quem está logado)
  colaborador_recebeu_id uuid references colaboradores(id), -- quem registrou (logado no app)
  peso_entregador_1_kg numeric(10,3),         -- peso corporal de quem carrega, pra descontar do peso bruto
  peso_entregador_2_kg numeric(10,3),
  preco_kg_dianteiro numeric(10,2),           -- preenchido depois pelo gestor (não vem na folha de recebimento)
  preco_kg_traseiro numeric(10,2),
  status text not null default 'aberto' check (status in ('aberto','finalizado')),
  criado_em timestamptz not null default now()
);

-- ---------- 2. Ajusta a tabela lotes (cada "peça" numerada vira 1 lote, ligado a um recebimento) ----------
alter table lotes add column if not exists recebimento_id uuid references recebimentos(id) on delete cascade;
alter table lotes add column if not exists numero_peca int;         -- o número impresso na folha (1 a 12...), sem os rabiscos a caneta
alter table lotes add column if not exists peso_bruto_kg numeric(10,3);
alter table lotes add column if not exists peso_entregador_usado_kg numeric(10,3);
alter table lotes add column if not exists data_desossa date;
create unique index if not exists uq_lotes_recebimento_tipo_numero on lotes(recebimento_id, tipo, numero_peca);

-- peso_entrada_kg passa a significar "peso líquido" (bruto - entregador) — mantém o nome
-- pra não quebrar a view de rendimento, só muda como ele é calculado.

-- Os campos abaixo saem do nível "lote" e passam pro nível "recebimento" (preço é por entrega, não por peça):
-- preco_kg_custo, numero_nf, data_desossa, fiscal_prevencao, acougueiro, status — ficam como estão por
-- compatibilidade, mas não serão mais usados pelo app novo. Como eram obrigatórios (NOT NULL) na tabela
-- antiga e o app não preenche mais eles, é preciso liberar isso, senão toda peça nova falha ao salvar:
alter table lotes alter column preco_kg_custo drop not null;
alter table lotes alter column data_entrada drop not null;

-- Se quiser limpar de vez essas colunas antigas depois que confirmar que está tudo funcionando, pode rodar:
-- alter table lotes drop column preco_kg_custo, drop column status, drop column fiscal_prevencao, drop column acougueiro, drop column data_entrada, drop column numero_nf, drop column data_desossa;

-- ---------- 3. Views atualizadas ----------
-- Precisa apagar antes de recriar: o Postgres não deixa renomear/reordenar colunas
-- de uma view existente só com CREATE OR REPLACE.
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
  c.preco_venda_kg,
  round(l.peso_kg * coalesce(case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end, 0), 2) as custo_total,
  round(l.peso_kg * c.preco_venda_kg, 2) as venda_total,
  case when (l.peso_kg * c.preco_venda_kg) = 0 then 0
    else round((((l.peso_kg * c.preco_venda_kg) - (l.peso_kg * coalesce(case when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end, 0)))
         / (l.peso_kg * c.preco_venda_kg)) * 100, 2)
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
  sum(round(l.peso_kg * c.preco_venda_kg, 2)) as venda_total,
  lo.peso_entrada_kg - coalesce(sum(l.peso_kg), 0) as quebra_kg
from lotes lo
join recebimentos r on r.id = lo.recebimento_id
left join lancamentos l on l.lote_id = lo.id
left join cortes_catalogo c on c.codigo = l.corte_codigo
group by lo.id, lo.tipo, lo.numero_peca, lo.data_desossa, r.id, r.fornecedor, r.data_entrada, lo.peso_entrada_kg, r.preco_kg_dianteiro, r.preco_kg_traseiro;

-- ---------- 4. RLS pra tabela nova ----------
alter table recebimentos enable row level security;
drop policy if exists "acesso liberado" on recebimentos;
create policy "acesso liberado" on recebimentos for all using (true);

notify pgrst, 'reload schema';
