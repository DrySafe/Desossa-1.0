const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c={window:{addEventListener(){}},document:{addEventListener(){}},console,APP_CONFIG:{BARCODE_CONFIG:{codigoInicio:2,codigoFim:7,usaPesoEmbutido:true,pesoInicio:7,pesoFim:12,pesoCasasDecimais:3}}};
vm.createContext(c);vm.runInContext(fs.readFileSync('site_desossa/scanner.js','utf8'),c);
function ean(body){let sum=0;for(let i=0;i<12;i++)sum+=Number(body[i])*(i%2?3:1);return body+(10-sum%10)%10;}
const code=ean('20'+'00123'+'01234');
test('EAN13 preserva zeros do código e três casas no peso',()=>{const d=vm.runInContext(`decodificarCodigoBarras('${code}')`,c);assert.equal(d.codigo,'00123');assert.equal(d.peso,1.234)});
test('checksum incorreto não é aceito',()=>assert.equal(vm.runInContext(`decodificarCodigoBarras('${code.slice(0,12)}${(Number(code[12])+1)%10}')`,c),null));
test('código comercial fora do prefixo de balança é recusado',()=>assert.equal(vm.runInContext(`decodificarCodigoBarras('${ean('78'+'00123'+'01234')}')`,c),null));
test('catálogo legado sem zeros é reconhecido sem mudar o ID enviado',()=>assert.equal(vm.runInContext("encontrarCortePorCodigo([{codigo:'123'}],'00123').codigo",c),'123'));
test('cadastro ambíguo é bloqueado',()=>assert.throws(()=>vm.runInContext("encontrarCortePorCodigo([{codigo:'123'},{codigo:'00123'}],'000123')",c),/ambíguo/));
