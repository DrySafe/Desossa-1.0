const crypto = require('node:crypto');
const URL_TESTE = 'https://dkiyakjftqcbbnfrgnmh.supabase.co';
const cookieName = 'desossa_test_session';
function error(status, message) { const e = new Error(message); e.status = status; return e; }
function secret() { const v = process.env.DESOSSA_TEST_SESSION_SECRET; if (!v || v.length < 32) throw error(503, 'Sessão de testes não configurada.'); return v; }
function equal(a,b) { const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x,y); }
function sign(payload) { const p=Buffer.from(JSON.stringify({...payload,exp:Date.now()+2*3600000})).toString('base64url');return p+'.'+crypto.createHmac('sha256',secret()).update(p).digest('base64url'); }
function session(req) {
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token)return null;
 const [p,s]=token.split('.');if(!p||!s||!equal(s,crypto.createHmac('sha256',secret()).update(p).digest('base64url')))return null;
 try{const v=JSON.parse(Buffer.from(p,'base64url'));return v.exp>Date.now()?v:null}catch{return null}
}
function cookie(res,payload) {res.setHeader('Set-Cookie',cookieName+'='+(payload?sign(payload):'')+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+(payload?7200:0));}
function origem(req) {
 if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)throw error(403,'Origem não permitida.');
 if(req.headers['sec-fetch-site']==='cross-site')throw error(403,'Requisição externa bloqueada.');
}
async function banco(path,options={}) {
 if(!path.startsWith('/rest/v1/')&&!path.startsWith('/storage/v1/'))throw error(403,'Destino inválido.');
 const key=process.env.DESOSSA_TEST_SERVICE_ROLE_KEY;
 if(!key || !(key.startsWith('sb_secret_')||key.startsWith('eyJ')))throw error(503,'Acesso administrativo do banco de testes não configurado.');
 const headers={apikey:key,'Content-Type':'application/json',...options.headers};
 if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;
 const r=await fetch(URL_TESTE+path,{...options,headers,redirect:'error'});
 return r;
}
async function jsonBanco(path,options) {const r=await banco(path,options);const d=await r.json().catch(()=>null);if(!r.ok)throw error(r.status>=500?503:400,'Operação não confirmada pelo banco de testes.');return d;}
async function autenticar(req) {
 const s=session(req);if(!s)throw error(401,'Entre novamente para continuar.');
 if(s.uid){const data=await jsonBanco('/rest/v1/colaboradores?id=eq.'+encodeURIComponent(s.uid)+'&select=id,ativo,nivel_acesso');
 if(!data?.[0]?.ativo)throw error(401,'Colaborador inativo.');
 s.role=['gestor','admin'].includes(data[0].nivel_acesso)?'gestor':'operador';}
 return s;
}
function responderErro(res,e){res.statusCode=e.status||500;res.setHeader('Cache-Control','no-store');res.json({message:e.status?e.message:'Operação não confirmada. Tente novamente.'});}
module.exports={banco,jsonBanco,error,equal,session,cookie,origem,autenticar,responderErro,secret,sign};
