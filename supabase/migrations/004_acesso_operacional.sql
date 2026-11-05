-- Limitador persistente; a API nunca usa somente memória de uma instância serverless.
create table if not exists public.app_tentativas_login (
 identidade text primary key, inicio timestamptz not null default now(), tentativas integer not null default 1
);
alter table public.app_tentativas_login enable row level security;
revoke all on public.app_tentativas_login from anon, authenticated;
create or replace function public.app_reservar_tentativa(p_identidade text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 if length(p_identidade) <> 64 then return false; end if;
 insert into public.app_tentativas_login(identidade) values(p_identidade)
 on conflict(identidade) do update set
  tentativas=case when app_tentativas_login.inicio < now()-interval '15 minutes' then 1 else app_tentativas_login.tentativas+1 end,
  inicio=case when app_tentativas_login.inicio < now()-interval '15 minutes' then now() else app_tentativas_login.inicio end
 returning tentativas into n;
 return n <= 20;
end $$;
revoke all on function public.app_reservar_tentativa(text) from public,anon,authenticated;
grant execute on function public.app_reservar_tentativa(text) to service_role;

-- Bloqueios no banco valem também para solicitações simultâneas e para integrações.
create or replace function public.app_validar_lancamento() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare p public.lotes; r_status text; total numeric;
begin
 select * into p from public.lotes where id=new.lote_id for update;
 if not found then raise exception 'Peça inexistente'; end if;
 select status into r_status from public.recebimentos where id=p.recebimento_id for update;
 if p.status='fechado' or r_status='finalizado' then raise exception 'Recebimento ou peça encerrado'; end if;
 if new.peso_kg<=0 or new.preco_venda_kg<0 then raise exception 'Peso ou preço inválido'; end if;
 select coalesce(sum(peso_kg),0) into total from public.lancamentos where lote_id=new.lote_id and id<>new.id;
 if total+new.peso_kg>p.peso_entrada_kg+0.001 then raise exception 'Peso lançado excede o peso líquido'; end if;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='app_validar_lancamento' and tgrelid='public.lancamentos'::regclass) then
  create trigger app_validar_lancamento before insert or update of peso_kg,lote_id on public.lancamentos for each row execute function public.app_validar_lancamento();
 end if;
end $$;
-- A API usa chave de servidor exclusiva de testes. Clientes não acessam tabelas diretamente.
grant all on all tables in schema public to service_role;

create or replace function public.app_login_confirmado(p_identidade text) returns void
language sql security definer set search_path=pg_catalog,public as $$
 delete from public.app_tentativas_login where identidade=p_identidade;
$$;
revoke all on function public.app_login_confirmado(text) from public,anon,authenticated;
grant execute on function public.app_login_confirmado(text) to service_role;
