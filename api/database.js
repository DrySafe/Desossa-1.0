const c=require('../server/lib.cjs');
const tables=new Set(['colaboradores','cortes_catalogo','recebimentos','lotes','lancamentos','exclusoes_log','auditoria_eventos','vw_rendimento_lote','vw_lancamentos_detalhado','vw_recebimentos_progresso','vw_lancamentos_completo','vw_relatorio_pecas']);
const writes={
 recebimentos:['data_entrada','fornecedor','placa_veiculo','fiscal_prevencao','acougueiro_acompanhante','colaborador_recebeu_id','peso_entregador_1_kg','peso_entregador_2_kg','quantidade_dianteiro_esperada','quantidade_traseiro_esperada'],
 lotes:['recebimento_id','tipo','numero_peca','peso_bruto_kg','peso_entregador_usado_kg','peso_entrada_kg'],
 lancamentos:['id','lote_id','corte_codigo','peso_kg','preco_venda_kg','colaborador_id','origem','criado_em_dispositivo','codigo_barras_bruto']
};
function limpar(data,gestor){
 if(Array.isArray(data))return data.map(d=>limpar(d,gestor));
 if(data&&typeof data==='object')return Object.fromEntries(Object.entries(data).filter(([k])=>k!=='pin_hash'&&(gestor||!['preco_kg_custo','preco_kg_dianteiro','preco_kg_traseiro','custo_total','margem_pct'].includes(k))).map(([k,v])=>[k,limpar(v,gestor)]));
 return data;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
 c.origem(req);const s=await c.autenticar(req),gestor=s.role==='gestor';
 const raw=req.query.path;
 if(typeof raw!=='string'||raw.includes('://')||raw.includes('..')||raw.includes('#'))throw c.error(400,'Caminho inválido.');
 const u=new URL(raw,'https://test.invalid');
 const table=u.pathname.replace('/rest/v1/','');
 if(u.pathname==='/rest/v1/rpc/app_excluir'){
  if(!gestor||req.method!=='POST')throw c.error(403,'Acesso de gestor necessário.');
  const dados=await c.jsonBanco('/rest/v1/rpc/app_excluir',{method:'POST',headers:{'x-desossa-ator':s.uid||'gestor'},body:JSON.stringify({p_tipo:req.body?.p_tipo,p_id:req.body?.p_id,p_ator:s.uid||null})});
  return res.json(dados);
 }
 if(!u.pathname.startsWith('/rest/v1/')||!tables.has(table))throw c.error(403,'Recurso não permitido.');
 if([...u.searchParams].some(([k,v])=>/pin_hash/i.test(k+' '+v)))throw c.error(403,'Consulta de credenciais não permitida.');
 if(!gestor&&[...u.searchParams].some(([k,v])=>/preco_kg_custo|preco_kg_dianteiro|preco_kg_traseiro|custo_total|margem_pct/i.test(k+' '+v)))throw c.error(403,'Consulta financeira não permitida.');
 if(/[()!:]/.test(u.searchParams.get('select')||''))throw c.error(400,'Relacionamentos não permitidos nesta consulta.');
 if(!gestor&&['vw_relatorio_pecas','exclusoes_log','auditoria_eventos'].includes(table))throw c.error(403,'Acesso de gestor necessário.');
 const method=req.method;
 if(!['GET','HEAD','POST','PATCH','DELETE'].includes(method))throw c.error(405,'Método não permitido.');
 let body=req.body;
 if(!['GET','HEAD'].includes(method)){
  if(method!=='DELETE'&&(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>65536))throw c.error(400,'Dados inválidos.');
  if(!gestor){
   if(method==='POST'&&writes[table]){
    if(Object.keys(body).some(k=>!writes[table].includes(k)))throw c.error(403,'Campo não permitido.');
    if(table==='recebimentos')body={...body,colaborador_recebeu_id:s.uid};
    if(table==='lotes'&&!body.recebimento_id)throw c.error(400,'Novas peças precisam de recebimento.');
    if(table==='lancamentos'&&body.colaborador_id!==s.uid)throw c.error(403,'Esta pendência pertence a outro colaborador. Entre com o usuário original para enviar.');
   }else if(!(method==='PATCH'&&table==='lotes'&&Object.keys(body).length===1&&typeof body.data_desossa==='string'&&u.searchParams.get('data_desossa')==='is.null'))throw c.error(403,'Operação de gestor necessária.');
  }
  if(table.startsWith('vw_'))throw c.error(403,'Relatório é somente leitura.');
  if(method==='DELETE')throw c.error(403,'Use a exclusão transacional com auditoria.');
  if(table==='auditoria_eventos')throw c.error(403,'Auditoria é somente leitura.');
  if(table==='exclusoes_log')throw c.error(403,'Histórico de exclusões é somente leitura.');
 }
 const headers={'x-desossa-ator':s.uid || 'gestor'};
 if(req.headers.prefer){
  const prefer=req.headers.prefer.split(',').map(v=>v.trim());
  if(prefer.some(v=>! /^(return=(representation|minimal)|count=exact)$/.test(v)))throw c.error(400,'Preferência de operação não permitida.');
  headers.prefer=prefer.join(',');
 }
 for(const key of ['range','range-unit'])if(req.headers[key])headers[key]=req.headers[key];
 if(u.searchParams.has('on_conflict'))throw c.error(403,'Substituição de registros não permitida.');
 const r=await c.banco(u.pathname+u.search,{method,headers,body:['GET','HEAD','DELETE'].includes(method)?undefined:JSON.stringify(body)});
 res.statusCode=r.status;
 for(const key of ['content-range','range-unit','preference-applied'])if(r.headers.has(key))res.setHeader(key,r.headers.get(key));
 if(method==='HEAD'||r.status===204)return res.end();
 const data=await r.json().catch(()=>({message:'Resposta inválida do banco.'}));
 return res.json(limpar(data,gestor));
 }catch(e){c.responderErro(res,e)}
};
