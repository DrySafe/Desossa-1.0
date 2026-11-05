-- Impedir alteração de preços ou transferência de cortes de peças já encerradas.
-- O marcador de sincronização do Sheets permanece atualizável pela integração.
create or replace function public.app_proteger_encerrado() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare situacao_peca text; situacao_recebimento text; rid uuid;
begin
 if tg_table_name='recebimentos' then
  if old.status='finalizado' then raise exception 'Reabra o recebimento antes de excluir'; end if;
 elsif tg_table_name='lotes' then
  select status into situacao_recebimento from public.recebimentos where id=old.recebimento_id for update;
  if old.status='fechado' or situacao_recebimento='finalizado' then raise exception 'Reabra a peça ou recebimento antes de excluir'; end if;
 else
  select status,recebimento_id into situacao_peca,rid from public.lotes where id=old.lote_id for update;
  select status into situacao_recebimento from public.recebimentos where id=rid for update;
  if situacao_peca='fechado' or situacao_recebimento='finalizado' then raise exception 'Reabra a peça ou recebimento antes de corrigir lançamentos'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.app_proteger_encerrado() from public,anon,authenticated;
create or replace trigger app_proteger_corte_encerrado
 before delete or update of peso_kg,lote_id,corte_codigo,preco_venda_kg,colaborador_id,origem on public.lancamentos
 for each row execute function public.app_proteger_encerrado();
create or replace trigger app_proteger_peca_encerrada before delete on public.lotes
 for each row execute function public.app_proteger_encerrado();
create or replace trigger app_proteger_recebimento_encerrado before delete on public.recebimentos
 for each row execute function public.app_proteger_encerrado();
