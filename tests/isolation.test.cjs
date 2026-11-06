const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const code = fs.readFileSync('site_desossa/config.js', 'utf8');
const host = 'https://dkiyakjftqcbbnfrgnmh.supabase.co';
function load(config) {
  const calls = [];
  const c = {window:{DESOSSA_TEST_CONFIG:config,addEventListener(){}},URL,atob,Headers,
    fetch:async(...args)=>{calls.push(args);return {ok:true}},
    supabase:{createClient:(url,key,options)=>({url,key,options})}};
  vm.createContext(c);vm.runInContext(code,c);
  return {run:s=>vm.runInContext(s,c),calls};
}
function key(role,ref){return 'e30.'+Buffer.from(JSON.stringify({role,ref})).toString('base64url')+'.signature';}
test('configuração ausente não cria cliente',()=>assert.throws(()=>load({}).run('criarClienteTeste()')));
test('URL de outro projeto bloqueada antes de criar cliente',()=>assert.throws(()=>load({SUPABASE_URL:'https://outro.supabase.co',SUPABASE_ANON_KEY:'sb_publishable_test'}).run('criarClienteTeste()')));
for(const value of ['sb_secret_example',key('service_role','dkiyakjftqcbbnfrgnmh'),key('anon','outro')])
 test('chave incompatível rejeitada '+value.slice(0,10),()=>assert.throws(()=>load({SUPABASE_ANON_KEY:value}).run('criarClienteTeste()')));
test('JWT anon do projeto de testes aceito',()=>assert.equal(load({SUPABASE_ANON_KEY:key('anon','dkiyakjftqcbbnfrgnmh')}).run('criarClienteTeste().url'),host));
test('fetch bloqueia outros destinos e redirecionamentos',async()=>{
 const {run,calls}=load({SUPABASE_ANON_KEY:'sb_publishable_test'});
 const client=run('criarClienteTeste()');
 await assert.rejects(client.options.global.fetch('https://outro.supabase.co/rest/v1/lancamentos'));
 await assert.rejects(client.options.global.fetch('https://webhook.example/n8n'));
 assert.equal(calls.length,0);
 await client.options.global.fetch(host+'/rest/v1/lancamentos');
 assert.equal(calls[0][1].redirect,'error');
 assert.ok(calls[0][0].startsWith('/api/database?path='));
 assert.equal(calls[0][1].credentials,'same-origin');
});
test('CSP permite conexão apenas com banco de testes',()=>{
 const v=JSON.parse(fs.readFileSync('vercel.json'));
 const csp=v.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
 assert.equal(csp.split(';').find(s=>s.trim().startsWith('connect-src')).trim(),"connect-src 'self'");
 for(const name of ['index.html','painel-gestor.html'])assert.ok(fs.readFileSync('site_desossa/'+name,'utf8').includes("connect-src 'self'"+';'));
});
test('filas e links não reutilizam o ambiente anterior',()=>{
 assert.match(fs.readFileSync('site_desossa/db.js','utf8'),/desossa_test_dkiyakjftqcbbnfrgnmh/);
 assert.ok(!fs.readFileSync('site_desossa/app.js','utf8').includes('r.planilha_url ||'));
});
test('build sem chave falha e não imprime credenciais',()=>{
 const r=spawnSync(process.execPath,['scripts/build-test-config.cjs'],{env:{...process.env,DESOSSA_TEST_SUPABASE_PUBLIC_KEY:'',DESOSSA_TEST_SUPABASE_URL:host},encoding:'utf8'});
 assert.notEqual(r.status,0);
});
test('build gera somente site, sem SQL ou workflows',()=>{
 const r=spawnSync(process.execPath,['scripts/build-test-config.cjs'],{env:{...process.env,DESOSSA_TEST_SUPABASE_URL:host,DESOSSA_TEST_SUPABASE_PUBLIC_KEY:'sb_publishable_ficticia',DESOSSA_TEST_ADMIN_PASSWORD:'somente-teste-ficticio'},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 assert.ok(!fs.existsSync('dist/workflow-desossa.json'));
 assert.ok(!fs.readFileSync('dist/runtime-config.js','utf8').includes('somente-teste-ficticio'));
 assert.ok(!fs.readFileSync('dist/runtime-config.js','utf8').includes('ADMIN_PASSWORD'));
 assert.ok(!fs.readdirSync('dist').some(n=>n.endsWith('.sql')));
 for(const name of fs.readdirSync('dist',{recursive:true}))if(fs.statSync('dist/'+name).isFile())assert.ok(!fs.readFileSync('dist/'+name,'utf8').includes('nypmvhsxvaqscswszwpr'));
});
test('cliente preserva formato single sem repassar credenciais',async()=>{
 const {run,calls}=load({SUPABASE_ANON_KEY:'sb_publishable_test'});
 await run('criarClienteTeste()').options.global.fetch(host+'/rest/v1/recebimentos?select=*',{method:'POST',headers:{accept:'application/vnd.pgrst.object+json',apikey:'ficticia',authorization:'Bearer ficticio','content-type':'application/json'},body:'{}'});
 assert.equal(calls[0][1].headers.accept,'application/vnd.pgrst.object+json');
 assert.equal(calls[0][1].headers.apikey,undefined);assert.equal(calls[0][1].headers.authorization,undefined);
});
