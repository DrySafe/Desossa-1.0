-- View adicional: não altera cálculos/colunas das views consumidas pelo workflow antigo.
create or replace view public.vw_relatorio_pecas with (security_invoker = true) as
with classificados as (
 select l.*, case
   when l.corte_codigo = '00000' or upper(trim(c.nome)) = 'QUEBRA' then 'quebra'
   when l.corte_codigo = '93960' or upper(trim(c.nome)) = 'SEBO E OSSO' then 'sebo'
   else 'carne' end as categoria
 from public.lancamentos l join public.cortes_catalogo c on c.codigo = l.corte_codigo
), somas as (
 select lote_id,
  coalesce(sum(peso_kg) filter (where categoria = 'carne'),0) as peso_carne_kg,
  coalesce(sum(peso_kg) filter (where categoria = 'sebo'),0) as peso_sebo_osso_kg,
  coalesce(sum(peso_kg) filter (where categoria = 'quebra'),0) as peso_quebra_kg,
  coalesce(sum(round(peso_kg * preco_venda_kg,2)),0) as valor_estimado,
  count(*) filter (where preco_venda_kg is null and categoria <> 'quebra') as lancamentos_sem_preco
 from classificados group by lote_id
)
select lo.id as lote_id, lo.recebimento_id, lo.numero_peca, lo.tipo,
 coalesce(r.fornecedor, 'Legado sem recebimento') as fornecedor,
 coalesce(r.data_entrada, lo.data_entrada, (lo.criado_em at time zone 'America/Sao_Paulo')::date) as data_referencia,
 lo.data_desossa, lo.peso_entrada_kg as peso_liquido_kg,
 case when r.id is null then lo.preco_kg_custo
      when lo.tipo = 'dianteiro' then r.preco_kg_dianteiro else r.preco_kg_traseiro end as preco_kg_custo,
 coalesce(s.peso_carne_kg,0) as peso_carne_kg,
 coalesce(s.peso_sebo_osso_kg,0) as peso_sebo_osso_kg,
 coalesce(s.peso_quebra_kg,0) as peso_quebra_kg,
 coalesce(s.valor_estimado,0) as valor_estimado,
 coalesce(s.lancamentos_sem_preco,0) as lancamentos_sem_preco,
 r.status as status_recebimento, lo.status as status_lote
from public.lotes lo left join public.recebimentos r on r.id = lo.recebimento_id
left join somas s on s.lote_id = lo.id;
revoke all on public.vw_relatorio_pecas from anon;
create index if not exists idx_lotes_recebimento on lotes(recebimento_id);
create index if not exists idx_lancamentos_pendentes on lancamentos(criado_em,id) where sheets_sincronizado_em is null;
