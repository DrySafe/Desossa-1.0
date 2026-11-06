const {spawnSync}=require('node:child_process');
for(const file of ['isolation','relatorios','fila','recebimento','workflow','api','scanner','backup','database']){
 const r=spawnSync(process.execPath,['tests/'+file+'.test.cjs'],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
}
