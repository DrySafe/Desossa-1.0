-- SOMENTE PROJETO DE TESTES dkiyakjftqcbbnfrgnmh. Transação aplicada pelo provisionador.
-- ============================================================
-- Controle de Desossa — schema Supabase/Postgres
-- ============================================================
-- Rode este arquivo no SQL Editor do seu Supabase (self-hosted), num banco novo.
-- Se você já tem esse banco rodando com dados, use migracao_recebimento.sql em vez deste.
-- ============================================================



-- ---------- Colaboradores (quem faz a desossa / recebe a carne) ----------
create table if not exists colaboradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  foto_url text,
  pin_hash text not null,          -- PIN de 4 dígitos, salvo com hash (nunca em texto puro)
  ativo boolean not null default true,
  nivel_acesso text default 'operador',
  criado_em timestamptz not null default now()
);

-- ---------- Catálogo de cortes (cadastrado pelo gestor) ----------
create table if not exists cortes_catalogo (
  codigo text primary key,          -- código do produto lido no código de barras (ex: 015097)
  nome text not null,               -- ex: CARNE FRALDINHA
  preco_venda_kg numeric not null default 0,
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
  peso_entregador_1_kg numeric,         -- peso corporal de quem carrega, pra descontar do peso bruto
  peso_entregador_2_kg numeric,
  preco_kg_dianteiro numeric,           -- preenchido pelo gestor (não vem na folha de recebimento)
  preco_kg_traseiro numeric,
  status text not null default 'aberto' check (status in ('aberto','finalizado')),
  criado_em timestamptz not null default now(),
  quantidade_dianteiro_esperada integer,
  quantidade_traseiro_esperada integer,
  planilha_sheet_id text,
  planilha_url text,
  concluido_operador boolean default false,
  status_conferencia text default 'em_andamento'
);

-- ---------- Lotes (cada peça numerada — 1 metade de boi — dentro de um recebimento) ----------
create table if not exists lotes (
  id uuid primary key default gen_random_uuid(),
  numero_nf text,
  preco_kg_custo numeric,
  data_entrada date,
  fiscal_prevencao text,
  acougueiro text,
  status text not null default 'aberto' check (status in ('aberto','fechado')),
  recebimento_id uuid references recebimentos(id) on delete cascade,
  numero_peca int,                -- o número impresso na folha (1, 2, 3...), ignorando anotação a caneta
  tipo text not null check (tipo in ('traseiro','dianteiro')),
  peso_bruto_kg numeric,     -- lido na balança, com a pessoa carregando junto
  peso_entregador_usado_kg numeric,
  peso_entrada_kg numeric not null,   -- peso líquido = peso_bruto_kg - peso_entregador_usado_kg
  data_desossa date,                         -- preenchido sozinho quando o 1º corte dessa peça é lançado
  criado_em timestamptz not null default now()
);

-- ---------- Lançamentos (cada corte pesado e escaneado durante a desossa) ----------
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),   -- gerado no celular (client-side), evita duplicar em reenvio
  lote_id uuid not null references lotes(id) on delete cascade,
  corte_codigo text not null references cortes_catalogo(codigo),
  peso_kg numeric not null,
  preco_venda_kg numeric,                         -- preço/kg no MOMENTO do lançamento (não muda se o cadastro mudar depois)
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


create table if not exists exclusoes_log (
 id uuid primary key default gen_random_uuid(), tipo text not null check (tipo in ('peca','lancamento')),
 registro_id uuid not null, dados_excluidos jsonb, colaborador_id uuid references colaboradores(id),
 criado_em timestamptz not null default now()
);
create index if not exists idx_exclusoes_log_registro on exclusoes_log(registro_id);
create table if not exists sync_erros (
 id uuid primary key default gen_random_uuid(), lancamento_id uuid, recebimento_id uuid,
 node text, mensagem text, criado_em timestamptz not null default now(), resolvido boolean not null default false
);

create or replace view public.vw_rendimento_lote with (security_invoker = true) as
 SELECT lo.id AS lote_id,
    lo.tipo,
    lo.numero_peca,
    lo.data_desossa,
    r.id AS recebimento_id,
    r.fornecedor,
    r.data_entrada,
    lo.peso_entrada_kg AS peso_liquido_kg,
        CASE
            WHEN (lo.tipo = 'dianteiro'::text) THEN r.preco_kg_dianteiro
            ELSE r.preco_kg_traseiro
        END AS preco_kg_custo,
    COALESCE(sum(l.peso_kg), (0)::numeric) AS peso_total_desossado,
    sum(round((l.peso_kg * COALESCE(l.preco_venda_kg, (0)::numeric)), 2)) AS venda_total,
    (lo.peso_entrada_kg - COALESCE(sum(l.peso_kg), (0)::numeric)) AS quebra_kg,
    lo.status AS status_lote
   FROM ((lotes lo
     LEFT JOIN recebimentos r ON ((r.id = lo.recebimento_id)))
     LEFT JOIN lancamentos l ON ((l.lote_id = lo.id)))
  GROUP BY lo.id, lo.tipo, lo.numero_peca, lo.data_desossa, r.id, r.fornecedor, r.data_entrada, lo.peso_entrada_kg, r.preco_kg_dianteiro, r.preco_kg_traseiro;

create or replace view public.vw_lancamentos_detalhado with (security_invoker = true) as
 SELECT l.id,
    l.lote_id,
    lo.tipo AS lote_tipo,
    lo.numero_peca,
    r.id AS recebimento_id,
    r.fornecedor,
    r.data_entrada,
    r.planilha_sheet_id,
    r.planilha_url,
        CASE
            WHEN (lo.tipo = 'dianteiro'::text) THEN r.preco_kg_dianteiro
            ELSE r.preco_kg_traseiro
        END AS preco_kg_custo,
    c.codigo AS corte_codigo,
    c.nome AS corte_nome,
    l.peso_kg,
    l.preco_venda_kg,
    c.preco_venda_kg AS preco_catalogo_kg_atual,
    round((l.peso_kg * COALESCE(
        CASE
            WHEN (lo.tipo = 'dianteiro'::text) THEN r.preco_kg_dianteiro
            ELSE r.preco_kg_traseiro
        END, (0)::numeric)), 2) AS custo_total,
    round((l.peso_kg * COALESCE(l.preco_venda_kg, (0)::numeric)), 2) AS venda_total,
        CASE
            WHEN ((l.peso_kg * COALESCE(l.preco_venda_kg, (0)::numeric)) = (0)::numeric) THEN (0)::numeric
            ELSE round(((((l.peso_kg * l.preco_venda_kg) - (l.peso_kg * COALESCE(
            CASE
                WHEN (lo.tipo = 'dianteiro'::text) THEN r.preco_kg_dianteiro
                ELSE r.preco_kg_traseiro
            END, (0)::numeric))) / (l.peso_kg * l.preco_venda_kg)) * (100)::numeric), 2)
        END AS margem_pct,
    col.nome AS colaborador_nome,
    l.origem,
    l.criado_em,
    l.criado_em_dispositivo,
    l.sheets_sincronizado_em
   FROM ((((lancamentos l
     JOIN lotes lo ON ((lo.id = l.lote_id)))
     JOIN recebimentos r ON ((r.id = lo.recebimento_id)))
     JOIN cortes_catalogo c ON ((c.codigo = l.corte_codigo)))
     JOIN colaboradores col ON ((col.id = l.colaborador_id)));

create or replace view public.vw_recebimentos_progresso with (security_invoker = true) as
 WITH lote_soma AS (
         SELECT lancamentos.lote_id,
            sum(lancamentos.peso_kg) AS peso_lancado
           FROM lancamentos
          GROUP BY lancamentos.lote_id
        )
 SELECT r.id AS recebimento_id,
    r.fornecedor,
    r.data_entrada,
    r.criado_em AS recebimento_criado_em,
    r.status,
    r.planilha_sheet_id,
    r.planilha_url,
    r.quantidade_dianteiro_esperada,
    r.quantidade_traseiro_esperada,
    count(*) FILTER (WHERE (lo.tipo = 'dianteiro'::text)) AS quantidade_dianteiro_real,
    count(*) FILTER (WHERE (lo.tipo = 'traseiro'::text)) AS quantidade_traseiro_real,
    COALESCE(sum(lo.peso_entrada_kg) FILTER (WHERE (lo.tipo = 'dianteiro'::text)), (0)::numeric) AS peso_liquido_dianteiro_kg,
    COALESCE(sum(lo.peso_entrada_kg) FILTER (WHERE (lo.tipo = 'traseiro'::text)), (0)::numeric) AS peso_liquido_traseiro_kg,
    COALESCE(sum(ls.peso_lancado) FILTER (WHERE (lo.tipo = 'dianteiro'::text)), (0)::numeric) AS peso_desossado_dianteiro_kg,
    COALESCE(sum(ls.peso_lancado) FILTER (WHERE (lo.tipo = 'traseiro'::text)), (0)::numeric) AS peso_desossado_traseiro_kg,
    max(lo.criado_em) AS ultima_peca_registrada_em,
    ((count(*) FILTER (WHERE (lo.tipo = 'dianteiro'::text)) >= COALESCE(r.quantidade_dianteiro_esperada, 0)) AND (count(*) FILTER (WHERE (lo.tipo = 'traseiro'::text)) >= COALESCE(r.quantidade_traseiro_esperada, 0)) AND ((COALESCE(r.quantidade_dianteiro_esperada, 0) + COALESCE(r.quantidade_traseiro_esperada, 0)) > 0)) AS todas_pecas_registradas
   FROM ((recebimentos r
     LEFT JOIN lotes lo ON ((lo.recebimento_id = r.id)))
     LEFT JOIN lote_soma ls ON ((ls.lote_id = lo.id)))
  GROUP BY r.id, r.fornecedor, r.data_entrada, r.criado_em, r.status, r.planilha_sheet_id, r.planilha_url, r.quantidade_dianteiro_esperada, r.quantidade_traseiro_esperada;

create or replace view public.vw_lancamentos_completo with (security_invoker = true) as
 SELECT l.id,
    l.lote_id,
    l.lote_tipo,
    l.numero_peca,
    l.recebimento_id,
    l.fornecedor,
    l.data_entrada,
    l.planilha_sheet_id,
    l.planilha_url,
    l.preco_kg_custo,
    l.corte_codigo,
    l.corte_nome,
    l.peso_kg,
    l.preco_venda_kg,
    l.preco_catalogo_kg_atual,
    l.custo_total,
    l.venda_total,
    l.margem_pct,
    l.colaborador_nome,
    l.origem,
    l.criado_em,
    l.criado_em_dispositivo,
    l.sheets_sincronizado_em,
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
   FROM (vw_lancamentos_detalhado l
     JOIN vw_recebimentos_progresso p ON ((p.recebimento_id = l.recebimento_id)));

-- Fechado por padrão. Chave pública/PIN no navegador não é autenticação de banco.
-- Nunca copiar as políticas permissivas de produção para tornar o teste acessível.
alter table colaboradores enable row level security;
alter table cortes_catalogo enable row level security;
alter table recebimentos enable row level security;
alter table lotes enable row level security;
alter table lancamentos enable row level security;
alter table exclusoes_log enable row level security;
alter table sync_erros enable row level security;
revoke all on colaboradores,cortes_catalogo,recebimentos,lotes,lancamentos,exclusoes_log,sync_erros from anon, authenticated;
revoke all on vw_rendimento_lote,vw_lancamentos_detalhado,vw_recebimentos_progresso,vw_lancamentos_completo from anon, authenticated;
