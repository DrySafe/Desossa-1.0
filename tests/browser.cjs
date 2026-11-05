// Testes de navegador inteiramente locais; todas as conexões externas são bloqueadas.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {isoLocal}=require('../site_desossa/relatorios.js');
const build=spawnSync(process.execPath,['scripts/build-test-config.cjs'],{env:{...process.env,DESOSSA_TEST_SUPABASE_URL:'https://dkiyakjftqcbbnfrgnmh.supabase.co',DESOSSA_TEST_SUPABASE_PUBLIC_KEY:'sb_publishable_ficticia'},encoding:'utf8'});
assert.equal(build.status,0,build.stderr);
const uid='00000000-0000-4000-8000-000000000001',rid='00000000-0000-4000-8000-000000000002',pid='00000000-0000-4000-8000-000000000003';
const pessoa={id:uid,nome:'Pessoa Teste',ativo:true,nivel_acesso:'operador'};
const datasets={colaboradores:[pessoa],cortes_catalogo:[{codigo:'00123',nome:'PATINHO',preco_venda_kg:20,ativo:true}],recebimentos:[{id:rid,fornecedor:'Fornecedor Teste',status:'aberto',data_entrada:isoLocal()}],vw_rendimento_lote:[{lote_id:pid,recebimento_id:rid,tipo:'traseiro',numero_peca:1,peso_liquido_kg:100,peso_total_desossado:0}],vw_recebimentos_progresso:[],vw_lancamentos_detalhado:[],vw_relatorio_pecas:[{lote_id:pid,tipo:'traseiro',numero_peca:1,fornecedor:'<img src=x onerror=alert(1)>',data_referencia:isoLocal(),peso_liquido_kg:100,peso_carne_kg:80,peso_sebo_osso_kg:10,peso_quebra_kg:10,preco_kg_custo:10,valor_estimado:1602,status_recebimento:'finalizado'}]};
(async()=>{
 let inserted=[];
 const root=path.resolve('dist');
 const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(u.pathname==='/api/session')return res.end(JSON.stringify(req.method==='GET'?{colaboradores:[pessoa],role:'gestor',authenticated:true}:{ok:true,usuario:pessoa,role:'operador'}));
  const query=new URL(u.searchParams.get('path'),'https://test.invalid'),table=query.pathname.split('/').pop();
  if(req.method==='POST'&&table==='lancamentos'){inserted.push(JSON.parse(body));return res.end('');}
  const data=datasets[table]||[];res.setHeader('Content-Range','0-'+Math.max(data.length-1,0)+'/'+data.length);
  return res.end(JSON.stringify(data));
 }
 const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const context=await browser.newContext({permissions:['camera']});
 let externals=0;await context.route('**/*',route=>{if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();externals++;return route.abort()});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base);await page.getByText('Quem é você?').waitFor();
 await page.locator('.login-card').click();
 for(const n of '1234')await page.locator('[data-tecla="'+n+'"]').click();
 await page.waitForFunction(()=>!!state.usuario && state.cortes.length===1);
 assert.equal(await page.evaluate(()=>state.usuario.id),uid);
 assert.equal(await page.locator('#btn-acesso-gestor').count(),0);
 await page.evaluate(()=>{state.usuario.nivel_acesso='gestor';renderLancar()});
 await page.locator('#btn-acesso-gestor').click();
 await page.locator('[data-aba="cortes"]').waitFor();
 await page.evaluate(()=>irPara('lancar'));
 await page.locator('#btn-meu-perfil').waitFor();
 await context.setOffline(true);
 await page.evaluate(async({pid})=>{state.loteAtivo={id:pid,tipo:"traseiro",numero_peca:1,peso_entrada_kg:100};await salvarLancamento({codigo:'00123',nome:'PATINHO',peso:1.234,preco:20},'manual')},{pid});
 assert.equal(await page.evaluate(async()=>(await idbGetAll(STORES.fila)).length),1);
 assert.equal(await page.evaluate(async()=>(await idbGetAll(STORES.lancamentosLote))[0].peso_kg),1.234);
 const backup=await page.evaluate(async()=>({version:1,project:'dkiyakjftqcbbnfrgnmh',pendencias:await idbGetAll(STORES.fila)}));
 assert.equal(backup.pendencias.length,1);
 await assert.rejects(page.evaluate(()=>validarBackupLocal({version:1,project:'outro',pendencias:[]})));
 await context.setOffline(false);await page.evaluate(()=>sincronizarFila());
 assert.equal(await page.evaluate(async()=>(await idbGetAll(STORES.fila)).length),0);
 assert.equal(inserted.length,1);
 const original=externals;
 assert.equal(await page.evaluate(async()=>{try{await fetch('https://outro.supabase.co/rest/v1/lancamentos');return false}catch{return true}}),true);
 assert.equal(externals,original);
 // Leitura real pelo ZXing, a partir de imagem EAN-13 sintética, sem câmera física.
 const decoded=await page.evaluate(async()=>{
  const L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const R=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  const parity=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  let body='20'+'00123'+'01234',sum=0;for(let i=0;i<12;i++)sum+=Number(body[i])*(i%2?3:1);const code=body+(10-sum%10)%10;
  let bits='101';for(let i=1;i<=6;i++)bits+=(parity[Number(code[0])][i-1]==='L'?L:G)[Number(code[i])];bits+='01010';for(let i=7;i<13;i++)bits+=R[Number(code[i])];bits+='101';
  let bars='';[...bits].forEach((v,i)=>{if(v==='1')bars+=`<rect x="${(i+12)*3}" y="10" width="3" height="140"/>`});
  const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160"><rect width="100%" height="100%" fill="white"/><g fill="black">${bars}</g></svg>`);await image.decode();
  const reader=new ZXingBrowser.BrowserMultiFormatReader();const result=await reader.decodeFromImageElement(image);return decodificarCodigoBarras(result.getText());
 });
 assert.equal(decoded.codigo,'00123');assert.equal(decoded.peso,1.234);
 const camera=await page.evaluate(async()=>{const v=document.createElement('video');v.id='teste-video';v.muted=true;v.playsInline=true;document.body.append(v);await iniciarScanner(v.id,()=>{});const tracks=v.srcObject.getTracks();await pararScanner();return tracks.every(t=>t.readyState==='ended')});
 assert.equal(camera,true);
 await page.goto(base+'/painel-gestor.html');
 assert.equal(await page.locator('input[type=password]').count(),0);
 await page.waitForFunction(()=>document.querySelectorAll('.kpi-card').length===9);
 assert.ok((await page.locator('.kpi-card').filter({hasText:'Perda registrada'}).innerText()).includes('10,000 kg'));
 assert.equal(await page.locator('#tabela-pecas img').count(),0);
 assert.ok((await page.locator('#tabela-pecas tbody').innerText()).includes('<img src=x'));
 const sqlErrorPage=await context.newPage();await sqlErrorPage.route('**/api/database?**',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Falha fictícia'})}));
 await sqlErrorPage.goto(base+'/painel-gestor.html');
 await sqlErrorPage.getByText('Relatório indisponível:',{exact:false}).waitFor();assert.equal(await sqlErrorPage.locator('#btn-exportar').isDisabled(),true);
 for (const sessao of [{authenticated:false,role:null},{authenticated:true,role:'operador'}]) {
   const bloqueado=await context.newPage();let consultas=0;
   await bloqueado.route('**/api/session',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...sessao,colaboradores:[]})}));
   await bloqueado.route('**/api/database?**',route=>{consultas++;return route.abort()});
   await bloqueado.goto(base+'/painel-gestor.html');
   await bloqueado.locator('#portao-voltar').waitFor({state:'visible'});
   assert.equal(await bloqueado.locator('#painel').isVisible(),false);
   assert.equal(await bloqueado.locator('input[type=password]').count(),0);
   assert.equal(consultas,0);
   await bloqueado.close();
 }
 const falhaSessao=await context.newPage();
 await falhaSessao.route('**/api/session',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'indisponível'})}));
 await falhaSessao.goto(base+'/painel-gestor.html');
 await falhaSessao.locator('#portao-tentar').waitFor({state:'visible'});
 assert.equal(await falhaSessao.locator('#painel').isVisible(),false);
 await falhaSessao.unroute('**/api/session');
 await falhaSessao.locator('#portao-tentar').click();
 await falhaSessao.waitForFunction(()=>document.querySelectorAll('.kpi-card').length===9);
 await falhaSessao.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: login, fila offline/transação/reenvio, backup, CSP, leitura EAN por imagem, câmera simulada/encerramento, relatório, XSS e erro de consulta. Zero conexões externas reais.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
