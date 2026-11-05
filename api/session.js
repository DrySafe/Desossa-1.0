const c=require('../server/lib.cjs');
const crypto=require('node:crypto');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
 c.origem(req);
 if(req.method==='DELETE'){c.cookie(res,null);return res.json({ok:true});}
 if(req.method==='GET'){
  const colaboradores=await c.jsonBanco('/rest/v1/colaboradores?select=id,nome,foto_url&ativo=eq.true&order=nome');
  const s=c.session(req);return res.json({authenticated:!!s,role:s?.role||null,colaboradores});
 }
 if(req.method!=='POST')throw c.error(405,'Método não permitido.');
 const b=req.body||{};
 if(JSON.stringify(b).length>2048)throw c.error(400,'Requisição inválida.');
 const identity=crypto.createHmac('sha256',c.secret()).update(b.adminPassword!==undefined?'gestor':String(b.id||'invalido')).digest('hex');
 const permitido=await c.jsonBanco('/rest/v1/rpc/app_reservar_tentativa',{method:'POST',body:JSON.stringify({p_identidade:identity})});
 if(!permitido)throw c.error(429,'Limite de tentativas. Aguarde 15 minutos.');
 let payload,usuario;
 if(b.adminPassword!==undefined){
  if(!process.env.DESOSSA_TEST_ADMIN_PASSWORD || !c.equal(b.adminPassword,process.env.DESOSSA_TEST_ADMIN_PASSWORD))throw c.error(401,'Credenciais inválidas.');
  payload={role:'gestor',uid:null};
 }else{
  if(!/^[0-9a-f-]{36}$/i.test(b.id||'')||!/^\d{4}$/.test(b.pin||''))throw c.error(401,'Credenciais inválidas.');
  const rows=await c.jsonBanco('/rest/v1/colaboradores?id=eq.'+encodeURIComponent(b.id)+'&ativo=eq.true&select=id,nome,foto_url,pin_hash,nivel_acesso');
  const row=rows?.[0];const hash=crypto.createHash('sha256').update(b.pin).digest('hex');
  if(!row||!c.equal(hash,row.pin_hash))throw c.error(401,'Credenciais inválidas.');
  if (b.novoPin != null || b.foto_url != null) {
   const update={};
   if(b.novoPin != null){if(!/^\d{4}$/.test(b.novoPin))throw c.error(400,'PIN deve ter quatro dígitos.');update.pin_hash=crypto.createHash('sha256').update(b.novoPin).digest('hex');}
   if(b.foto_url != null){let photo;try{photo=new URL(b.foto_url)}catch{throw c.error(400,'Foto inválida.');}
    if(photo.origin!=='https://dkiyakjftqcbbnfrgnmh.supabase.co'||!photo.pathname.startsWith('/storage/v1/object/public/colaboradores/'))throw c.error(400,'Foto fora do projeto de testes.');update.foto_url=photo.href;}
   await c.jsonBanco('/rest/v1/colaboradores?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',headers:{'x-desossa-ator':row.id},body:JSON.stringify(update)});
   if(update.foto_url)row.foto_url=update.foto_url;
  }
  usuario={id:row.id,nome:row.nome,foto_url:row.foto_url,nivel_acesso:row.nivel_acesso};
  payload={uid:row.id,role:['gestor','admin'].includes(row.nivel_acesso)?'gestor':'operador'};
 }
 await c.jsonBanco('/rest/v1/rpc/app_login_confirmado',{method:'POST',body:JSON.stringify({p_identidade:identity})});
 c.cookie(res,payload);return res.json({ok:true,usuario,role:payload.role});
 }catch(e){c.responderErro(res,e)}
};
