const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const dados={id:'p',tipo:'traseiro',numero_peca:1,peso_bruto_kg:165.25,peso_entregador_usado_kg:65.25};
function mock({duplicado=false,falhaLeitura=false,registro={...dados,recebimento_id:'r',peso_entrada_kg:100}}={}){
 let inserts=0,reads=0,puts=0;
 const ctx={console,window:{addEventListener(){}},setInterval(){},STORES:{lotes:'lotes'},idbGet:async()=>null,idbPut:async()=>puts++,criarClienteTeste:()=>({from:()=>({insert:payload=>{inserts++;assert.equal(payload.id,'p');return {select:()=>({single:async()=>({error:duplicado?{code:'23505'}:null})})}},select:()=>({eq:()=>({maybeSingle:async()=>{reads++;return {data:registro,error:falhaLeitura?{message:'falha'}:null}}})})})})};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('site_desossa/sync.js','utf8'),ctx);vm.runInContext('atualizarCacheReferencia=async()=>true',ctx);
 return {adicionar:(d=dados,progresso)=>ctx.adicionarPeca('r',d,progresso),stats:()=>({inserts,reads,puts})};
}
test('peça só é confirmada após leitura dos pesos e dados corretos',async()=>{const c=mock(),passos=[];const r=await c.adicionar(dados,m=>passos.push(m));assert.equal(r.peso_entrada_kg,100);assert.deepEqual(c.stats(),{inserts:1,reads:1,puts:1});assert.deepEqual(passos,['Salvando peça…','Conferindo peça salva…','Atualizando a lista de peças…'])});
test('reenvio com o mesmo ID recupera a peça já gravada',async()=>{const c=mock({duplicado:true});assert.equal((await c.adicionar()).id,'p');assert.equal(c.stats().puts,1)});
test('conflito de número de outra peça não é considerado sucesso',async()=>{const c=mock({duplicado:true,registro:null});await assert.rejects(c.adicionar(),e=>e.code==='23505');assert.equal(c.stats().puts,0)});
test('falha de conferência não confirma a peça',async()=>{const c=mock({falhaLeitura:true});await assert.rejects(c.adicionar(),/não foi confirmada/);assert.equal(c.stats().puts,0)});
test('peso diferente no retorno não é aceito',async()=>{const c=mock({registro:{...dados,recebimento_id:'r',peso_entrada_kg:99}});await assert.rejects(c.adicionar(),/não conferem/);assert.equal(c.stats().puts,0)});
test('bruto menor que o carregador não é enviado',async()=>{const c=mock();await assert.rejects(c.adicionar({...dados,peso_bruto_kg:10}),/Confira os pesos/);assert.equal(c.stats().inserts,0)});
