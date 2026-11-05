-- Auditoria transacional; inclui cascatas e não depende da chamada do navegador.
create table if not exists public.auditoria_eventos (
 id uuid primary key default gen_random_uuid(), tabela text not null, registro_id text,
 operacao text not null, antes jsonb, depois jsonb, ator text, criado_em timestamptz not null default now()
);
alter table public.auditoria_eventos enable row level security;
revoke all on public.auditoria_eventos from anon, authenticated;
create or replace function public.app_auditar() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
 insert into public.auditoria_eventos(tabela, registro_id, operacao, antes, depois, ator)
 values (tg_table_name, coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id',to_jsonb(new)->>'codigo',to_jsonb(old)->>'codigo'), tg_op,
  case when tg_op <> 'INSERT' then to_jsonb(old) - 'pin_hash' end,
  case when tg_op <> 'DELETE' then to_jsonb(new) - 'pin_hash' end,
  coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-desossa-ator', nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',current_user));
 return coalesce(new,old);
end $$;
revoke all on function public.app_auditar() from public;
do $$ declare nome text; begin
 foreach nome in array array['colaboradores','cortes_catalogo','recebimentos','lotes','lancamentos'] loop
  if not exists(select 1 from pg_trigger where tgname='app_auditar_'||nome and tgrelid=('public.'||nome)::regclass) then
   execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.app_auditar()', 'app_auditar_'||nome,nome);
  end if;
 end loop;
end $$;
-- Não liberamos operações anônimas. Autorização de usuários deverá preceder importação de dados reais.

create or replace function public.app_excluir(p_tipo text,p_id uuid,p_ator uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare dados jsonb; rid uuid; situacao text;
begin
 if p_tipo='lancamento' then
  select to_jsonb(l) into dados from public.lancamentos l where id=p_id for update;
 elsif p_tipo='peca' then
  select jsonb_build_object('lote',to_jsonb(l),'lancamentos',coalesce((select jsonb_agg(to_jsonb(c)) from public.lancamentos c where c.lote_id=l.id),'[]'::jsonb)) into dados from public.lotes l where id=p_id for update;
 else raise exception 'Tipo de exclusão inválido'; end if;
 if dados is null then raise exception 'Registro não encontrado'; end if;
 if p_tipo='peca' then select recebimento_id into rid from public.lotes where id=p_id;
 else select lo.recebimento_id into rid from public.lotes lo join public.lancamentos l on l.lote_id=lo.id where l.id=p_id; end if;
 if rid is not null then
  select status into situacao from public.recebimentos where id=rid for update;
  if situacao='finalizado' then raise exception 'Reabra o recebimento antes de excluir registros'; end if;
 end if;
 insert into public.exclusoes_log(tipo,registro_id,dados_excluidos,colaborador_id) values(p_tipo,p_id,dados,p_ator);
 if p_tipo='lancamento' then delete from public.lancamentos where id=p_id;
 else delete from public.lotes where id=p_id; end if;
end $$;
revoke all on function public.app_excluir(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_excluir(text,uuid,uuid) to service_role;
