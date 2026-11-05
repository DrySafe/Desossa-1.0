create or replace function public.app_validar_peca() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare situacao text;
begin
 if new.peso_entrada_kg<=0 or new.peso_entrada_kg::text in ('NaN','Infinity','-Infinity') then raise exception 'Peso líquido inválido'; end if;
 if new.peso_bruto_kg is not null and (new.peso_bruto_kg<=0 or new.peso_bruto_kg::text in ('NaN','Infinity','-Infinity')) then raise exception 'Peso bruto inválido'; end if;
 if new.peso_entregador_usado_kg is not null and (new.peso_entregador_usado_kg<0 or new.peso_entregador_usado_kg::text in ('NaN','Infinity','-Infinity')) then raise exception 'Peso descontado inválido'; end if;
 if new.peso_bruto_kg is not null and new.peso_entregador_usado_kg is not null and abs((new.peso_bruto_kg-new.peso_entregador_usado_kg)-new.peso_entrada_kg)>0.001 then raise exception 'Peso líquido não confere com bruto menos desconto'; end if;
 if new.recebimento_id is not null then
  select status into situacao from public.recebimentos where id=new.recebimento_id for update;
  if situacao='finalizado' then raise exception 'Reabra o recebimento antes de alterar peças'; end if;
 end if;
 return new;
end $$;
create or replace trigger app_validar_peca before insert or update on public.lotes for each row execute function public.app_validar_peca();

create or replace function public.app_validar_recebimento() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if trim(new.fornecedor)='' then raise exception 'Fornecedor obrigatório'; end if;
 if new.quantidade_dianteiro_esperada<0 or new.quantidade_traseiro_esperada<0 then raise exception 'Quantidade esperada inválida'; end if;
 if new.preco_kg_dianteiro<0 or new.preco_kg_traseiro<0 or new.preco_kg_dianteiro::text in ('NaN','Infinity','-Infinity') or new.preco_kg_traseiro::text in ('NaN','Infinity','-Infinity') then raise exception 'Custo inválido'; end if;
 if tg_op='UPDATE' and old.status='finalizado' and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'Reabra o recebimento antes de corrigir dados'; end if;
 return new;
end $$;
create or replace trigger app_validar_recebimento before insert or update on public.recebimentos for each row execute function public.app_validar_recebimento();

create or replace function public.app_validar_preco() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
 if new.preco_venda_kg<0 or new.preco_venda_kg::text in ('NaN','Infinity','-Infinity') then raise exception 'Preço inválido'; end if;
 return new;
end $$;
create or replace trigger app_validar_preco_corte before insert or update on public.cortes_catalogo for each row execute function public.app_validar_preco();
create or replace trigger app_validar_preco_lancamento before insert or update on public.lancamentos for each row execute function public.app_validar_preco();
