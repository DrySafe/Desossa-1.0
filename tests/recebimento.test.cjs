const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const dados={id:'r',fornecedor:'Fornecedor Teste',colaborador_recebeu_id:'u',peso_entregador_1_kg:70.5,peso_entregador_2_kg:65.25,quantidade_dianteiro_esperada:1,quantidade_traseiro_esperada:1,status:'aberto'};
function mock({duplicado=false,falhaLeitura=false,registro={...dados},array=false}={}){
 let inserts=0,reads=0,puts=0;
 const ctx={console,window:{addEventListener(){}},setInterval(){},STORES:{recebimentos:'recebimentos'},idbPut:async()=>puts++,criarClienteTeste:()=>({from:()=>({insert:()=>{inserts++;return {select:()=>({single:async()=>({data:null,error:duplicado?{code:'23505'}:null})})}},select:()=>({eq:()=>({single:async()=>{reads++;return {data:array?[registro]:registro,error:falhaLeitura?{message:'rede indisponível'}:null}}})})})})};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('site_desossa/sync.js','utf8'),ctx);vm.runInContext('atualizarCacheReferencia=async()=>true',ctx);
 return {criar:(payload,progresso)=>ctx.criarRecebimento(payload,progresso),stats:()=>({inserts,reads,puts})};
}
test('só retorna recebimento após confirmar todos os dados',async()=>{const c=mock(),passos=[];const r=await c.criar(dados,m=>passos.push(m));assert.equal(r.fornecedor,dados.fornecedor);assert.equal(r.peso_entregador_1_kg,70.5);assert.deepEqual(c.stats(),{inserts:1,reads:1,puts:1});assert.deepEqual(passos,['Salvando recebimento…','Conferindo dados salvos…','Atualizando o aplicativo…'])});
test('reenvio com o mesmo ID confirma cadastro sem criar outra linha',async()=>{const c=mock({duplicado:true});const r=await c.criar(dados);assert.equal(r.id,dados.id);assert.equal(c.stats().reads,1)});
test('falha de confirmação não disponibiliza dados incompletos',async()=>{const c=mock({falhaLeitura:true});await assert.rejects(c.criar(dados),/não foi possível confirmar/);assert.equal(c.stats().puts,0)});
test('conflito de ID com pesos diferentes exige conferência',async()=>{const c=mock({duplicado:true,registro:{...dados,peso_entregador_1_kg:99}});await assert.rejects(c.criar(dados),/não conferem/);assert.equal(c.stats().puts,0)});
test('resposta legada em lista de um registro é normalizada',async()=>{const c=mock({array:true});const r=await c.criar(dados);assert.equal(r.fornecedor,dados.fornecedor);assert.equal(Array.isArray(r),false)});
test('peso inválido não envia cadastro',async()=>{const c=mock();await assert.rejects(c.criar({...dados,peso_entregador_1_kg:NaN}),/peso válido/);assert.equal(c.stats().inserts,0)});
