-- ============================================================
-- Controle de Desossa — schema Supabase/Postgres
-- ============================================================
-- Rode este arquivo no SQL Editor do seu Supabase (self-hosted), num banco novo.
-- Se você já tem esse banco rodando com dados, use migracao_recebimento.sql em vez deste.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Colaboradores (quem faz a desossa / recebe a carne) ----------
create table if not exists colaboradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  foto_url text,
  pin_hash text not null,          -- PIN de 4 dígitos, salvo com hash (nunca em texto puro)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------- Catálogo de cortes (cadastrado pelo gestor) ----------
create table if not exists cortes_catalogo (
  codigo text primary key,          -- código do produto lido no código de barras (ex: 015097)
  nome text not null,               -- ex: CARNE FRALDINHA
  preco_venda_kg numeric(10,2) not null default 0,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

-- ---------- Recebimentos (chegada de várias peças/metades de boi, de um fornecedor) ----------
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
  preco_kg_dianteiro numeric(10,2),           -- preenchido pelo gestor (não vem na folha de recebimento)
  preco_kg_traseiro numeric(10,2),
  status text not null default 'aberto' check (status in ('aberto','finalizado')),
  criado_em timestamptz not null default now()
);

-- ---------- Lotes (cada peça numerada — 1 metade de boi — dentro de um recebimento) ----------
create table if not exists lotes (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  numero_peca int not null,                -- o número impresso na folha (1, 2, 3...), ignorando anotação a caneta
  tipo text not null check (tipo in ('traseiro','dianteiro')),
  peso_bruto_kg numeric(10,3) not null,     -- lido na balança, com a pessoa carregando junto
  peso_entregador_usado_kg numeric(10,3) not null,
  peso_entrada_kg numeric(10,3) not null,   -- peso líquido = peso_bruto_kg - peso_entregador_usado_kg
  data_desossa date,                         -- preenchido sozinho quando o 1º corte dessa peça é lançado
  criado_em timestamptz not null default now()
);

-- ---------- Lançamentos (cada corte pesado e escaneado durante a desossa) ----------
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),   -- gerado no celular (client-side), evita duplicar em reenvio
  lote_id uuid not null references lotes(id) on delete cascade,
  corte_codigo text not null references cortes_catalogo(codigo),
  peso_kg numeric(10,3) not null,
  preco_venda_kg numeric(10,2),                         -- preço/kg no MOMENTO do lançamento (não muda se o cadastro mudar depois)
  colaborador_id uuid not null references colaboradores(id),
  origem text not null default 'scanner' check (origem in ('scanner','manual')),
  criado_em timestamptz not null default now(),        -- quando o Postgres confirmou a gravação (fonte da verdade)
  criado_em_dispositivo timestamptz,                    -- horário real no celular (pode ser antes, se ficou na fila offline)
  sheets_sincronizado_em timestamptz,                   -- preenchido pelo n8n quando espelhar no Google Sheets
  codigo_barras_bruto text                              -- guarda o código lido, útil pra debugar o decodificador
);

-- Itens especiais que sempre existem em toda peça (não vêm de etiqueta, mas fecham a conta):
-- SEBO E OSSO e QUEBRA também são lançados como "cortes" no catálogo (códigos fixos 93960 e 00000),
-- assim entram no mesmo fluxo de lançamentos sem precisar de tabela separada.

-- ---------- Índices ----------
create index if not exists idx_lancamentos_lote on lancamentos(lote_id);
create index if not exists idx_lancamentos_colaborador on lancamentos(colaborador_id);
create index if not exists idx_lancamentos_criado_em on lancamentos(criado_em);
create index if not exists idx_lotes_recebimento on lotes(recebimento_id);
create unique index if not exists uq_lotes_recebimento_tipo_numero on lotes(recebimento_id, tipo, numero_peca);

-- ---------- View: lançamento com margem já calculada (alimenta o dashboard e o espelho no Sheets) ----------
create or replace view vw_lancamentos_detalhado as
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

-- ---------- View: rendimento por peça (equivalente ao "Sub-Total" da planilha) ----------
create or replace view vw_rendimento_lote as
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

-- ---------- Seed opcional: itens fixos que sempre existem em qualquer peça ----------
insert into cortes_catalogo (codigo, nome, preco_venda_kg) values
  ('93960', 'SEBO E OSSO', 0.20),
  ('00000', 'QUEBRA', 0)
on conflict (codigo) do nothing;

-- ---------- RLS (recomendado) ----------
alter table colaboradores enable row level security;
alter table cortes_catalogo enable row level security;
alter table recebimentos enable row level security;
alter table lotes enable row level security;
alter table lancamentos enable row level security;

-- Política simples: liberado para a chave anon (o app grava direto com ela).
-- Antes de ir pra produção com dados sensíveis, vale restringir por papel (ver README > Limitações).
create policy "acesso liberado" on colaboradores for all using (true);
create policy "acesso liberado" on cortes_catalogo for all using (true);
create policy "acesso liberado" on recebimentos for all using (true);
create policy "acesso liberado" on lotes for all using (true);
create policy "acesso liberado" on lancamentos for all using (true);
