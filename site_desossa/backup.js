/* Backup local de pendências. Não contém PINs nem credenciais de acesso. */
const BACKUP_PROJECT = 'dkiyakjftqcbbnfrgnmh';
function validarBackupLocal(dados) {
  if (!dados || dados.version !== 1 || dados.project !== BACKUP_PROJECT || !Array.isArray(dados.pendencias) || dados.pendencias.length > 10000) throw new Error('Arquivo de backup inválido ou de outro ambiente.');
  const ids = new Set();
  for (const item of dados.pendencias) {
    const p=item?.payload;
    if(!p||item.id_local!==p.id||! /^[a-f0-9-]{36}$/i.test(p.id)||ids.has(p.id)||!p.lote_id||!p.colaborador_id||!p.corte_codigo||!Number.isFinite(Number(p.peso_kg))||Number(p.peso_kg)<=0) throw new Error('Backup contém pendência inválida. Nenhum registro foi restaurado.');
    ids.add(p.id);
  }
  return dados.pendencias;
}
async function exportarPendencias() {
  const dados={version:1,project:BACKUP_PROJECT,exportado_em:new Date().toISOString(),pendencias:await idbGetAll(STORES.fila)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(dados,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='desossa-pendencias-testes-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function restaurarPendencias(arquivo) {
  if(arquivo.size>10*1024*1024)throw new Error('Arquivo maior que 10 MB.');
  const itens=validarBackupLocal(JSON.parse(await arquivo.text()));
  const existentes=await idbGetAll(STORES.fila);
  const porId=new Map(existentes.map(i=>[i.id_local,i]));
  for(const item of itens)if(porId.has(item.id_local)&&!mesmoLancamento(porId.get(item.id_local).payload,item.payload))throw new Error('Conflito com uma pendência existente. Nenhum registro foi restaurado.');
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction([STORES.fila,STORES.lancamentosLote],'readwrite');
    for(const item of itens){
      if(porId.has(item.id_local))continue;
      tx.objectStore(STORES.fila).put({...item,restaurado_em:new Date().toISOString()});
      const p=item.payload;
      tx.objectStore(STORES.lancamentosLote).put({id:p.id,lote_id:p.lote_id,corte_codigo:p.corte_codigo,corte_nome:'Recuperado — '+p.corte_codigo,peso_kg:p.peso_kg,preco_venda_kg:p.preco_venda_kg,criado_em:item.criado_em,pendente:true});
    }
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Falha ao restaurar.'));
  });
  return itens.length;
}
