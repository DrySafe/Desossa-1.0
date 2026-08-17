-- ============================================================
-- MIGRAÇÃO — Log de exclusões (peças e lançamentos de corte)
-- ============================================================
-- Guarda quem excluiu, quando, e uma cópia do que foi excluído (pra auditoria/recuperação).
-- ============================================================

create table if not exists exclusoes_log (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('peca', 'lancamento')),
  registro_id uuid not null,
  dados_excluidos jsonb,           -- cópia do registro (e dos cortes, se for peça) antes de apagar
  colaborador_id uuid references colaboradores(id),
  criado_em timestamptz not null default now()
);

alter table exclusoes_log enable row level security;
drop policy if exists "acesso liberado" on exclusoes_log;
create policy "acesso liberado" on exclusoes_log for all using (true);

create index if not exists idx_exclusoes_log_registro on exclusoes_log(registro_id);

notify pgrst, 'reload schema';
