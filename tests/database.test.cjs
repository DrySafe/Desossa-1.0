const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('PostgreSQL: compatibilidade, cálculos, auditoria, bloqueios e fila versionada',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const uid='00000000-0000-4000-8000-000000000001',rid='00000000-0000-4000-8000-000000000002',pid='00000000-0000-4000-8000-000000000003';
 await db.exec(`insert into colaboradores(id,nome,pin_hash) values('${uid}','Teste','hash-ficticio');insert into cortes_catalogo(codigo,nome,preco_venda_kg) values('00123','PATINHO',20);insert into recebimentos(id,fornecedor,preco_kg_traseiro,quantidade_traseiro_esperada,quantidade_dianteiro_esperada) values('${rid}','Teste',10,1,0);insert into lotes(id,recebimento_id,numero_peca,tipo,peso_entrada_kg) values('${pid}','${rid}',1,'traseiro',100);`);
 const ids=[];
 for(const [codigo,peso,preco]of[['00123',80,20],['93960',10,0.2],['00000',10,0]]){
 const {rows}=await db.query('insert into lancamentos(lote_id,corte_codigo,peso_kg,preco_venda_kg,colaborador_id) values($1,$2,$3,$4,$5) returning id',[pid,codigo,peso,preco,uid]);ids.push(rows[0].id);
 }
 const p=(await db.query('select * from vw_relatorio_pecas where lote_id=$1',[pid])).rows[0];
 assert.equal(Number(p.peso_carne_kg),80);assert.equal(Number(p.peso_quebra_kg),10);assert.equal(Number(p.peso_sebo_osso_kg),10);assert.equal(Number(p.valor_estimado),1602);
 await assert.rejects(db.query('insert into lancamentos(lote_id,corte_codigo,peso_kg,colaborador_id) values($1,$2,1,$3)',[pid,'00123',uid]),/excede/);
 await db.exec(`insert into lotes(tipo,peso_entrada_kg,preco_kg_custo,data_entrada) values('dianteiro',50,12,'2026-01-01');`);
 const legacy=(await db.query('select * from vw_relatorio_pecas where recebimento_id is null')).rows;
 assert.equal(legacy.length,1);assert.equal(Number(legacy[0].preco_kg_custo),12);
 await db.exec("set role anon");await assert.rejects(db.query('select * from colaboradores'),/permission denied/);await db.exec('reset role');
 await db.query('insert into sync_destinos_teste(recebimento_id,spreadsheet_id,aprovado) values($1,$2,true)',[rid,'sheet-teste']);
 let snapshot=(await db.query('select * from app_sync_pendentes()')).rows[0].app_sync_pendentes;
 assert.equal(snapshot.project,'dkiyakjftqcbbnfrgnmh');assert.equal(snapshot.lancamentos.length,3);
 assert.equal((await db.query('select * from app_sync_pendentes()')).rows.length,0,'lease impede execução concorrente');
 await db.query('update recebimentos set preco_kg_traseiro=11 where id=$1',[rid]);
 await db.query('select app_sync_confirmar($1,$2,$3)',[rid,snapshot.revisao,snapshot.lease]);
 const pending=(await db.query('select * from app_sync_pendentes()')).rows[0].app_sync_pendentes;
 assert.ok(Number(pending.revisao)>Number(snapshot.revisao),'alteração posterior não é confirmada pela execução antiga');
 await db.query('select app_sync_confirmar($1,$2,$3)',[rid,pending.revisao,pending.lease]);
 await db.query("select app_excluir('lancamento',$1,$2)",[ids[1],uid]);
 const deleted=(await db.query('select * from app_sync_pendentes()')).rows[0].app_sync_pendentes;
 assert.equal(deleted.lancamentos.length,2,'exclusão gera snapshot atualizado');
 assert.equal((await db.query('select * from exclusoes_log')).rows.length,1);
 const events=(await db.query('select * from auditoria_eventos')).rows;
 assert.ok(events.some(e=>e.operacao==='DELETE'&&e.tabela==='lancamentos'));
 assert.ok(events.filter(e=>e.tabela==='colaboradores').every(e=>!JSON.stringify(e).includes('hash-ficticio')));
 for(let i=0;i<20;i++)assert.equal((await db.query('select app_reservar_tentativa($1) ok',['a'.repeat(64)])).rows[0].ok,true);
 assert.equal((await db.query('select app_reservar_tentativa($1) ok',['a'.repeat(64)])).rows[0].ok,false);
 // A reaplicação não apaga dados nem duplica triggers.
 for(const f of fs.readdirSync('supabase/migrations').sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 assert.equal((await db.query('select * from colaboradores')).rows.length,1);
 }finally{await db.close()}
});
