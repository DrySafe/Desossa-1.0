/* Espelha o estado completo: repetição não soma duas vezes e exclusões zeram células. */
function montarSnapshot(d, permitidas) {
 if(d.project!=='dkiyakjftqcbbnfrgnmh'||!permitidas.includes(d.spreadsheetId))throw new Error('Destino não aprovado para testes.');
 const mapas={traseiro:{PATINHO:6,LAGARTO:7,MUSCULO:8,'COXAO DURO':9,'COXAO MOLE':10,'FILE MIGNON':11,RABO:12,FRALDINHA:13,COSTELA:14,MAMINHA:15,'CONTRA FILE':16,ALCATRA:17,PICANHA:18,'SEBO E OSSO':19,QUEBRA:20},dianteiro:{PALETA:29,ACEM:30,PEITO:31,CUPIM:32,COSTELA:33,MUSCULO:34,'SEBO E OSSO':35,QUEBRA:36}};
 const normalizar=s=>String(s).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').replace(/^CARNE\s+/,'').replace(/\s+(C\/OSSO|S\/OSSO)$/,'');
 const somas=new Map(),data=[];
 for(const p of d.pecas){if(!mapas[p.tipo]||!Number.isInteger(Number(p.numero_peca))||Number(p.numero_peca)<1||Number(p.numero_peca)>20)throw new Error('Peça fora do layout de 20 colunas.');}
 for(const l of d.lancamentos){
  const nome=l.codigo==='00000'?'QUEBRA':l.codigo==='93960'?'SEBO E OSSO':normalizar(l.nome);
  const linha=mapas[l.tipo]?.[nome];if(!linha)throw new Error('Corte não mapeado: '+nome);
  const num=Number(l.numero_peca);if(!Number.isInteger(num)||num<1||num>20)throw new Error('Número de peça inválido.');
  const peso=Number(l.peso_kg);if(!Number.isFinite(peso)||peso<=0)throw new Error('Peso inválido.');
  const range='Somas!'+String.fromCharCode(67+num-1)+linha;
  somas.set(range,(somas.get(range)||0)+Math.round(peso*1000));
 }
 for(const [tipo,mapa] of Object.entries(mapas)){
  for(let n=1;n<=20;n++)for(const linha of Object.values(mapa)){
   const range='Somas!'+String.fromCharCode(67+n-1)+linha;data.push({range,values:[[(somas.get(range)||0)/1000]]});
  }
  const aba=tipo==='traseiro'?'TRAZEIRO':'DIANTEIRO';
  const quantidade=d.recebimento['quantidade_'+tipo+'_esperada'];
  if(quantidade==null||!Number.isInteger(Number(quantidade))||Number(quantidade)<0)throw new Error('Quantidade esperada não informada.');
  const custo=d.recebimento['preco_kg_'+tipo];
  if(custo!=null&&(!Number.isFinite(Number(custo))||Number(custo)<0))throw new Error('Custo inválido.');
  const peso=d.pecas.filter(p=>p.tipo===tipo).reduce((s,p)=>{const n=Number(p.peso_entrada_kg);if(!Number.isFinite(n)||n<=0)throw new Error('Peso líquido inválido.');return s+Math.round(n*1000)},0)/1000;
  data.push({range:aba+'!E4',values:[[Number(quantidade)]]},{range:aba+'!F4',values:[[peso]]},{range:aba+'!G4',values:[[custo==null?'':Number(custo)]]});
 }
 return {recebimento_id:d.recebimento_id,revisao:d.revisao,lease:d.lease,spreadsheetId:d.spreadsheetId,batchBody:{valueInputOption:'RAW',data}};
}
if(typeof module!=='undefined')module.exports={montarSnapshot};
