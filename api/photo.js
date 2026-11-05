const c=require('../server/lib.cjs');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
 c.origem(req);const s=await c.autenticar(req);
 if(req.method!=='POST')throw c.error(405,'Método não permitido.');
 const name=req.query.name,type=req.headers['content-type'];
 if(typeof name!=='string'||! /^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(name)||!['image/jpeg','image/png','image/webp'].includes(type))throw c.error(400,'Foto inválida.');
 if(s.role!=='gestor'&&!name.startsWith(s.uid+'-'))throw c.error(403,'Foto de outro colaborador.');
 let data=req.body;
 if(!Buffer.isBuffer(data)){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw c.error(413,'Foto maior que 2 MB.');chunks.push(chunk)}
  data=Buffer.concat(chunks);
 }
 if(!data.length||data.length>2*1024*1024)throw c.error(413,'Foto inválida ou maior que 2 MB.');
 const ok=type==='image/jpeg'?data[0]===255&&data[1]===216&&data[2]===255:type==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
 if(!ok)throw c.error(400,'Conteúdo da foto incompatível com o formato.');
 const r=await c.banco('/storage/v1/object/colaboradores/'+name,{method:'POST',headers:{'Content-Type':type,'x-upsert':'false'},body:data});
 if(!r.ok)throw c.error(400,'Upload não confirmado pelo banco de testes.');
 return res.json({publicUrl:'https://dkiyakjftqcbbnfrgnmh.supabase.co/storage/v1/object/public/colaboradores/'+name});
 }catch(e){c.responderErro(res,e)}
};
module.exports.config={api:{bodyParser:false}};
