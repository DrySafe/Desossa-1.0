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
 let inserted=[],tentativasLogin=0;
 let liberarLogin,recebeuLogin,liberarCache,recebeuCache;
 const loginSuspenso=new Promise(r=>liberarLogin=r),loginRecebido=new Promise(r=>recebeuLogin=r);
 const cacheSuspenso=new Promise(r=>liberarCache=r),cacheRecebido=new Promise(r=>recebeuCache=r);
 let liberarCadastro,recebeuCadastro,liberarConferencia,recebeuConferencia;
 const cadastroSuspenso=new Promise(r=>liberarCadastro=r),cadastroRecebido=new Promise(r=>recebeuCadastro=r);
 const conferenciaSuspensa=new Promise(r=>liberarConferencia=r),conferenciaRecebida=new Promise(r=>recebeuConferencia=r);
 const novosRecebimentos=[],headersSingle=[];let enviosRecebimento=0,leiturasConfirmacao=0;
 const root=path.resolve('dist');
 const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(u.pathname==='/api/session'){
   if(req.method==='GET')return res.end(JSON.stringify({colaboradores:[pessoa],role:'gestor',authenticated:true}));
   tentativasLogin++;
   if(JSON.parse(body).pin==='0000'){res.statusCode=401;return res.end(JSON.stringify({message:'Credenciais inválidas.'}));}
   recebeuLogin();await loginSuspenso;
   return res.end(JSON.stringify({ok:true,usuario:pessoa,role:'operador'}));
  }
  const query=new URL(u.searchParams.get('path'),'https://test.invalid'),table=query.pathname.split('/').pop();
  const single=req.headers.accept==='application/vnd.pgrst.object+json';
  if(req.method==='POST'&&table==='recebimentos'){
   enviosRecebimento++;headersSingle.push(req.headers.accept);
   const payload=JSON.parse(body);
   if(novosRecebimentos.some(r=>r.id===payload.id)){res.statusCode=409;return res.end(JSON.stringify({code:'23505',message:'Registro já gravado'}));}
   recebeuCadastro();await cadastroSuspenso;
   const row={...payload,data_entrada:isoLocal()};novosRecebimentos.push(row);datasets.recebimentos.push(row);
   res.statusCode=201;return res.end(JSON.stringify(single?row:[row]));
  }
  if(req.method==='GET'&&table==='recebimentos'&&novosRecebimentos.length&&query.searchParams.has('id')&&query.searchParams.get('id').slice(3)===novosRecebimentos[0].id){
   headersSingle.push(req.headers.accept);leiturasConfirmacao++;recebeuConferencia();await conferenciaSuspensa;
   if(leiturasConfirmacao===1){res.statusCode=400;return res.end(JSON.stringify({code:'TEST_CONFIRMATION_FAILURE',message:'Falha fictícia na confirmação'}));}
   return res.end(JSON.stringify(single?novosRecebimentos[0]:[novosRecebimentos[0]]));
  }
  if(req.method==='POST'&&table==='lotes'){
   headersSingle.push(req.headers.accept);const row={...JSON.parse(body),id:require('node:crypto').randomUUID(),status:'aberto'};
   datasets.lotes??=[];datasets.lotes.push(row);datasets.vw_rendimento_lote.push({lote_id:row.id,recebimento_id:row.recebimento_id,tipo:row.tipo,numero_peca:row.numero_peca,peso_liquido_kg:row.peso_entrada_kg,peso_total_desossado:0,status_lote:'aberto'});
   res.statusCode=201;return res.end(JSON.stringify(single?row:[row]));
  }
  if(req.method==='POST'&&table==='lancamentos'){inserted.push(JSON.parse(body));return res.end('');}
  if(req.method==='GET'&&['colaboradores','cortes_catalogo','recebimentos','vw_rendimento_lote'].includes(table)){recebeuCache();await cacheSuspenso;}
  let data=datasets[table]||[];
  for(const key of ['id','recebimento_id'])if(query.searchParams.get(key)?.startsWith('eq.'))data=data.filter(row=>String(row[key])===query.searchParams.get(key).slice(3));
  res.setHeader('Content-Range','0-'+Math.max(data.length-1,0)+'/'+data.length);
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
 await page.setViewportSize({width:390,height:844});
 for(const n of '0000')await page.locator('[data-tecla="'+n+'"]').click();
 await page.locator('#pin-erro').waitFor({state:'visible'});
 assert.equal(await page.locator('#pin-status').isVisible(),false);
 assert.equal(await page.locator('#pin-voltar').isEnabled(),true);
 assert.equal(await page.locator('.tecla:disabled').count(),0);
 assert.equal(await page.locator('#pin-dots .preenchido').count(),0);
 for(const n of '1234')await page.locator('[data-tecla="'+n+'"]').click();
 await loginRecebido;
 await page.locator('#pin-status').waitFor({state:'visible'});
 assert.equal(await page.locator('#pin-status-texto').textContent(),'Efetuando login…');
 assert.equal(await page.locator('#pin-teclado').getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('.tecla:disabled').count(),11);
 assert.equal(await page.locator('#pin-voltar').isDisabled(),true);
 assert.equal(await page.locator('#pin-status [role=progressbar]').getAttribute('aria-valuenow'),null);
 await page.evaluate(()=>onTeclaPin('9'));assert.equal(tentativasLogin,2);
 const statusBounds=await page.locator('#pin-status').boundingBox(),tecladoBounds=await page.locator('#pin-teclado').boundingBox();
 assert.ok(statusBounds.y>=tecladoBounds.y+tecladoBounds.height);
 assert.ok(statusBounds.y+statusBounds.height<=844);
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.pin-progresso-movimento').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 assert.equal(await page.locator('.pin-progresso-movimento').evaluate(e=>getComputedStyle(e).animationName),'pin-carregando');
 liberarLogin();await cacheRecebido;
 await page.getByText('Carregando dados do aplicativo…',{exact:true}).waitFor();
 assert.equal(await page.locator('.tecla:disabled').count(),11);
 liberarCache();
 await page.waitForFunction(()=>!!state.usuario && state.cortes.length===1);
 await page.locator('#btn-meu-perfil').waitFor();
 await page.setViewportSize({width:1280,height:720});
 assert.equal(tentativasLogin,2);
 assert.equal(await page.evaluate(()=>state.usuario.id),uid);
 // Regressão: salvar, conferir e adicionar peça sem undefined/NaN ou duplicação no retry.
 await page.evaluate(()=>irPara('novo-recebimento'));
 await page.locator('[name=fornecedor]').fill('Fornecedor Cadastro Teste');
 await page.locator('[name=placa_veiculo]').fill('ABC1D23');
 await page.locator('[name=fiscal_prevencao]').fill('Fiscal Teste');
 await page.locator('[name=acougueiro_acompanhante]').fill('Acompanhante Teste');
 await page.locator('[name=peso_entregador_1_kg]').fill('70.5');
 await page.locator('[name=peso_entregador_2_kg]').fill('65.25');
 await page.locator('[name=quantidade_dianteiro_esperada]').fill('1');
 await page.locator('[name=quantidade_traseiro_esperada]').fill('1');
 await page.locator('#form-recebimento button[type=submit]').click();await cadastroRecebido;
 assert.equal(await page.locator('#recebimento-status').isVisible(),true);
 assert.equal(await page.locator('#recebimento-status-texto').textContent(),'Salvando recebimento…');
 assert.equal(await page.locator('#form-recebimento button[type=submit]').isDisabled(),true);
 assert.equal(await page.locator('#form-peca').count(),0);
 await page.evaluate(()=>document.querySelector('#form-recebimento').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(enviosRecebimento,1);
 liberarCadastro();await conferenciaRecebida;
 assert.equal(await page.locator('#recebimento-status-texto').textContent(),'Conferindo dados salvos…');
 assert.equal(await page.locator('#form-peca').count(),0);
 liberarConferencia();
 await page.locator('#recebimento-erro').waitFor({state:'visible'});
 assert.equal(await page.locator('#form-recebimento button[type=submit]').isEnabled(),true);
 assert.equal(novosRecebimentos.length,1);
 await page.locator('#form-recebimento button[type=submit]').click();
 await page.locator('#form-peca').waitFor();
 assert.equal(novosRecebimentos.length,1);assert.equal(enviosRecebimento,2);
 assert.equal(await page.locator('h2.titulo-tela').textContent(),'Fornecedor Cadastro Teste');
 assert.ok((await page.locator('.pin-label').allTextContents()).join(' ').includes('Recebido por Pessoa Teste'));
 const pesos=await page.locator('.pin-label').filter({hasText:'Peso entregador 1'}).innerText();assert.ok(pesos.includes('70,500 kg'));assert.ok(pesos.includes('65,250 kg'));
 assert.equal(await page.evaluate(()=>fmtKg('70.5')),'70,500');assert.equal(await page.evaluate(()=>fmtKg(undefined)),'—');
 await page.locator('#select-tipo-peca').selectOption('traseiro');
 await page.getByText('Traseiro — peça número 1',{exact:true}).waitFor();
 await page.locator('[name=peso_bruto_kg]').fill('165.25');
 await page.locator('[name=entregador_usado]').selectOption('65.25');
 await page.locator('#form-peca button[type=submit]').click();
 await page.getByText('100,000 kg líquido',{exact:true}).waitFor();
 assert.equal(datasets.lotes[0].peso_entrada_kg,100);
 assert.ok(headersSingle.every(h=>h==='application/vnd.pgrst.object+json'));
 assert.ok(!(await page.locator('#app').innerText()).match(/undefined|NaN/));
 await page.evaluate(()=>irPara('lancar'));await page.locator('#btn-meu-perfil').waitFor();

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
 // Exportação imprimível usa os mesmos filtros, pesos e totais da tela.
 assert.equal(await page.locator('#btn-imprimir').isEnabled(),true);
 await page.locator('#filtro-tipo').selectOption('traseiro');
 await page.evaluate(()=>{window.print=()=>{window.__impressoes=(window.__impressoes||0)+1;window.dispatchEvent(new Event('beforeprint'))}});
 await page.locator('#btn-imprimir').click();
 assert.equal(await page.evaluate(()=>window.__impressoes),1);
 assert.ok((await page.locator('#impressao-filtros').textContent()).includes('Tipo: Traseiro'));
 assert.ok((await page.locator('#totais-pecas').textContent()).includes('100,000 kg'));
 const bounds=await page.locator('#btn-sair-painel').boundingBox();assert.ok(bounds.x+bounds.width<=1280);assert.ok(bounds.height>=44);
 await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('.barra-lateral').isVisible(),false);
 assert.equal(await page.locator('#btn-sair-painel').isVisible(),false);
 assert.equal(await page.locator('#cabecalho-impressao').isVisible(),true);
 assert.equal(await page.evaluate(()=>{const t=document.querySelector('#tabela-pecas');return t.scrollWidth<=t.clientWidth+1}),true);
 fs.mkdirSync('test-results',{recursive:true});
 const pdf=await page.pdf({path:'test-results/acompanhamento-amostra.pdf',preferCSSPageSize:true,printBackground:true});
 assert.ok(pdf.subarray(0,4).toString()==='%PDF');
 await page.screenshot({path:'test-results/acompanhamento-impressao.png',fullPage:true});
 await page.evaluate(()=>{const p=estado.linhas[0];estado.linhas=Array.from({length:60},(_,i)=>({...p,lote_id:'print-'+i,numero_peca:i%20+1}));renderizar()});
 await page.pdf({path:'test-results/acompanhamento-multipagina.pdf',preferCSSPageSize:true,printBackground:true});
 const info=spawnSync('pdfinfo',['test-results/acompanhamento-multipagina.pdf'],{encoding:'utf8'});
 assert.equal(info.status,0);assert.ok(Number(info.stdout.match(/Pages:\s+(\d+)/)[1])>1);
 const text=spawnSync('pdftotext',['-layout','test-results/acompanhamento-multipagina.pdf','-'],{encoding:'utf8'});
 assert.equal(text.status,0);assert.equal((text.stdout.match(/TOTAL DO FILTRO/g)||[]).length,1);
 assert.ok(text.stdout.includes('6.000,000'));
 await page.emulateMedia({media:'screen'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
 const sairMobile=page.locator('.barra-lateral .botao-sair');assert.equal(await sairMobile.isVisible(),true);
 const mobileBounds=await sairMobile.boundingBox();assert.ok(mobileBounds.y+mobileBounds.height<844);
 assert.equal(await sairMobile.getAttribute('href'),'index.html');
 const sqlErrorPage=await context.newPage();await sqlErrorPage.route('**/api/database?**',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Falha fictícia'})}));
 await sqlErrorPage.goto(base+'/painel-gestor.html');
 await sqlErrorPage.getByText('Relatório indisponível:',{exact:false}).waitFor();assert.equal(await sqlErrorPage.locator('#btn-exportar').isDisabled(),true);
 assert.equal(await sqlErrorPage.locator('#btn-imprimir').isDisabled(),true);
 await sqlErrorPage.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 await sqlErrorPage.emulateMedia({media:'print'});
 assert.equal(await sqlErrorPage.locator('#painel').isVisible(),false);
 assert.equal(await sqlErrorPage.locator('.impressao-bloqueada').isVisible(),true);
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
 }finally{liberarLogin();liberarCache();liberarCadastro();liberarConferencia();await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
