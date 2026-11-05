-- Validar SOMENTE via scripts/validate-test.py no projeto fixo de testes.
-- Todas as movimentações fictícias são desfeitas ao final; não dispara integrações.
begin;
do $$
declare
 u uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 l uuid; codigo text:='CHECK-'||substr(gen_random_uuid()::text,1,8);
 v record; snap jsonb; novo jsonb; falhou boolean; identidade text;
begin
 assert not has_table_privilege('anon','public.colaboradores','select'), 'Anon consegue ler colaboradores';
 assert not has_table_privilege('authenticated','public.lancamentos','insert'), 'Cliente consegue inserir diretamente';
 assert not has_function_privilege('anon','public.app_excluir(text,uuid,uuid)','execute'), 'Exclusão exposta ao anon';
 insert into public.colaboradores(id,nome,pin_hash) values(u,'TESTE TRANSACIONAL',repeat('a',64));
 insert into public.cortes_catalogo(codigo,nome,preco_venda_kg) values(codigo,'PATINHO',20);
 insert into public.recebimentos(id,fornecedor,preco_kg_traseiro,quantidade_traseiro_esperada,quantidade_dianteiro_esperada)
 values(r,'TESTE TRANSACIONAL',10,1,0);
 insert into public.lotes(id,recebimento_id,tipo,numero_peca,peso_bruto_kg,peso_entregador_usado_kg,peso_entrada_kg)
 values(p,r,'traseiro',1,170,70,100);
 insert into public.lancamentos(lote_id,corte_codigo,peso_kg,preco_venda_kg,colaborador_id) values(p,codigo,80,20,u);
 insert into public.lancamentos(lote_id,corte_codigo,peso_kg,preco_venda_kg,colaborador_id) values(p,'93960',10,0.2,u) returning id into l;
 insert into public.lancamentos(lote_id,corte_codigo,peso_kg,preco_venda_kg,colaborador_id) values(p,'00000',10,0,u);
 select * into v from public.vw_relatorio_pecas where lote_id=p;
 assert v.peso_carne_kg=80 and v.peso_sebo_osso_kg=10 and v.peso_quebra_kg=10, 'Balanço de pesos incorreto';
 assert v.valor_estimado=1602 and v.preco_kg_custo=10, 'Valores incorretos';
 falhou:=false;
 begin
  insert into public.lancamentos(lote_id,corte_codigo,peso_kg,colaborador_id) values(p,codigo,1,u);
 exception when others then falhou:=sqlerrm like '%excede%'; end;
 assert falhou,'Excesso de peso não foi bloqueado';
 insert into public.sync_destinos_teste(recebimento_id,spreadsheet_id,aprovado) values(r,'TESTE-'||r::text,true);
 select x into snap from public.app_sync_pendentes() x where x->>'recebimento_id'=r::text;
 assert snap->>'project'='dkiyakjftqcbbnfrgnmh' and jsonb_array_length(snap->'lancamentos')=3,'Snapshot incompleto';
 assert not exists(select 1 from public.app_sync_pendentes() x where x->>'recebimento_id'=r::text),'Lease permite concorrência';
 update public.recebimentos set preco_kg_traseiro=11 where id=r;
 perform public.app_sync_confirmar(r,(snap->>'revisao')::bigint,(snap->>'lease')::uuid);
 select x into novo from public.app_sync_pendentes() x where x->>'recebimento_id'=r::text;
 assert (novo->>'revisao')::bigint>(snap->>'revisao')::bigint,'Revisão antiga confirmou mudança nova';
 perform public.app_sync_confirmar(r,(novo->>'revisao')::bigint,(novo->>'lease')::uuid);
 update public.recebimentos set status='finalizado' where id=r;
 falhou:=false;
 begin perform public.app_excluir('lancamento',l,u);
 exception when others then falhou:=sqlerrm like '%Reabra%'; end;
 assert falhou,'Exclusão alterou recebimento encerrado';
 falhou:=false;
 begin update public.lancamentos set preco_venda_kg=99 where id=l;
 exception when others then falhou:=sqlerrm like '%Reabra%'; end;
 assert falhou,'Preço de lançamento encerrado foi alterado';
 update public.recebimentos set status='aberto' where id=r;
 perform public.app_excluir('lancamento',l,u);
 assert exists(select 1 from public.exclusoes_log where registro_id=l),'Log transacional ausente';
 assert exists(select 1 from public.auditoria_eventos where registro_id=l::text and operacao='DELETE'),'Auditoria da exclusão ausente';
 assert not exists(select 1 from public.auditoria_eventos where registro_id=u::text and ((antes ? 'pin_hash') or (depois ? 'pin_hash'))),'Hash de PIN exposto na auditoria';
 insert into public.lotes(tipo,peso_entrada_kg,preco_kg_custo,data_entrada) values('dianteiro',50,12,'2026-01-01') returning id into p;
 select * into v from public.vw_relatorio_pecas where lote_id=p;
 assert v.recebimento_id is null and v.preco_kg_custo=12,'Peça legada perdeu compatibilidade';
 identidade:=md5(u::text)||md5(u::text);
 for i in 1..20 loop assert public.app_reservar_tentativa(identidade),'Limite bloqueou antes da hora'; end loop;
 assert not public.app_reservar_tentativa(identidade),'Limite de login não aplicado';
 perform public.app_login_confirmado(identidade);
 assert public.app_reservar_tentativa(identidade),'Login válido não libera tentativas';
end $$;
rollback;
select 'ok' as validation, 'Movimentações fictícias desfeitas por rollback' as cleanup;
