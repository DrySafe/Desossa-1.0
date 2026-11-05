const c=require('../server/lib.cjs');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
  c.secret();
  await c.jsonBanco('/rest/v1/vw_relatorio_pecas?select=lote_id&limit=0');
  res.json({status:'ok',environment:'test'});
 }catch{res.statusCode=503;res.json({status:'maintenance',environment:'test',message:'Ambiente de testes aguardando configuração do banco.'});}
};
