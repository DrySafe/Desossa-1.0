-- Eventos de integração separados do legado. Nenhum destino de produção é copiado.
create table if not exists public.sync_destinos_teste (
 recebimento_id uuid primary key references public.recebimentos(id),
 spreadsheet_id text unique not null, aprovado boolean not null default false,
 projeto text not null default 'dkiyakjftqcbbnfrgnmh' check(projeto='dkiyakjftqcbbnfrgnmh')
);
create table if not exists public.sync_fila_recebimentos (
 recebimento_id uuid primary key, revisao bigint not null default 1, confirmado bigint not null default 0,
 lease uuid, bloqueado_ate timestamptz, tentativas integer not null default 0, ultimo_erro text
);
alter table public.sync_destinos_teste enable row level security;
alter table public.sync_fila_recebimentos enable row level security;
revoke all on public.sync_destinos_teste,public.sync_fila_recebimentos from anon,authenticated;
grant all on public.sync_destinos_teste,public.sync_fila_recebimentos to service_role;
create or replace function public.app_enfileirar_recebimento(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if p_id is null then return; end if;
 insert into public.sync_fila_recebimentos(recebimento_id) values(p_id)
 on conflict(recebimento_id) do update set revisao=sync_fila_recebimentos.revisao+1;
end $$;
create or replace function public.app_evento_sync() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare id_antigo uuid; id_novo uuid;
begin
 if tg_table_name='recebimentos' then
  if tg_op<>'DELETE' then id_novo=new.id; end if;
  if tg_op<>'INSERT' then id_antigo=old.id; end if;
 elsif tg_table_name='lotes' then
  if tg_op<>'DELETE' then id_novo=new.recebimento_id; end if;
  if tg_op<>'INSERT' then id_antigo=old.recebimento_id; end if;
 else
  if tg_op<>'DELETE' then select recebimento_id into id_novo from public.lotes where id=new.lote_id; end if;
  if tg_op<>'INSERT' then select recebimento_id into id_antigo from public.lotes where id=old.lote_id; end if;
 end if;
 perform public.app_enfileirar_recebimento(id_novo);
 if id_antigo is distinct from id_novo then perform public.app_enfileirar_recebimento(id_antigo); end if;
 return coalesce(new,old);
end $$;
do $$ declare nome text; begin
 foreach nome in array array['recebimentos','lotes','lancamentos'] loop
  if not exists(select 1 from pg_trigger where tgname='app_sync_'||nome and tgrelid=('public.'||nome)::regclass) then
   execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.app_evento_sync()', 'app_sync_'||nome,nome);
  end if;
 end loop;
end $$;
create or replace function public.app_sync_pendentes() returns setof jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare fila record; novo_lease uuid; snapshot jsonb;
begin
 for fila in select f.*,d.spreadsheet_id from public.sync_fila_recebimentos f
  join public.sync_destinos_teste d using(recebimento_id)
  where f.revisao>f.confirmado and d.aprovado and (f.bloqueado_ate is null or f.bloqueado_ate<now())
  order by f.recebimento_id limit 20 for update of f skip locked loop
   novo_lease=gen_random_uuid();
   update public.sync_fila_recebimentos set lease=novo_lease,bloqueado_ate=now()+interval '15 minutes' where recebimento_id=fila.recebimento_id;
   select jsonb_build_object('recebimento',to_jsonb(r), 'pecas',coalesce((select jsonb_agg(to_jsonb(p)) from public.lotes p where p.recebimento_id=r.id),'[]'::jsonb),
     'lancamentos',coalesce((select jsonb_agg(jsonb_build_object('numero_peca',p.numero_peca,'tipo',p.tipo,'codigo',l.corte_codigo,'nome',c.nome,'peso_kg',l.peso_kg)) from public.lancamentos l join public.lotes p on p.id=l.lote_id join public.cortes_catalogo c on c.codigo=l.corte_codigo where p.recebimento_id=r.id),'[]'::jsonb))
    into snapshot from public.recebimentos r where r.id=fila.recebimento_id;
   if snapshot is null then raise exception 'Recebimento não encontrado; destino deve ser revisto'; end if;
   return next snapshot||jsonb_build_object('recebimento_id',fila.recebimento_id,'revisao',fila.revisao,'lease',novo_lease,'spreadsheetId',fila.spreadsheet_id,'project','dkiyakjftqcbbnfrgnmh');
 end loop;
end $$;
create or replace function public.app_sync_confirmar(p_id uuid,p_revisao bigint,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 update public.sync_fila_recebimentos set confirmado=greatest(confirmado,p_revisao),bloqueado_ate=null,lease=null,ultimo_erro=null
 where recebimento_id=p_id and lease=p_lease and p_revisao<=revisao;
 return found;
end $$;
create or replace function public.app_sync_erro(p_id uuid,p_lease uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 update public.sync_fila_recebimentos set tentativas=tentativas+1,ultimo_erro='Falha ao gravar snapshot na planilha de testes',bloqueado_ate=null,lease=null where recebimento_id=p_id and lease=p_lease;
 if found then insert into public.sync_erros(recebimento_id,node,mensagem) values(p_id,'snapshot_planilha','Falha ao gravar snapshot na planilha de testes'); end if;
end $$;
revoke all on function public.app_enfileirar_recebimento(uuid),public.app_evento_sync(),public.app_sync_pendentes(),public.app_sync_confirmar(uuid,bigint,uuid),public.app_sync_erro(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_sync_pendentes(),public.app_sync_confirmar(uuid,bigint,uuid),public.app_sync_erro(uuid,uuid) to service_role;

create or replace function public.app_evento_catalogo() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rid uuid;
begin
 for rid in select distinct p.recebimento_id from public.lancamentos l join public.lotes p on p.id=l.lote_id where l.corte_codigo=new.codigo and p.recebimento_id is not null loop
  perform public.app_enfileirar_recebimento(rid);
 end loop;
 return new;
end $$;
revoke all on function public.app_evento_catalogo() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='app_sync_catalogo' and tgrelid='public.cortes_catalogo'::regclass) then
  create trigger app_sync_catalogo after update of nome on public.cortes_catalogo for each row execute function public.app_evento_catalogo();
 end if;
end $$;
