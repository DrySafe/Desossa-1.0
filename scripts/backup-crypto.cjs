const crypto=require('node:crypto');
function encrypt(value,password){
 if(typeof password!=='string'||password.length<16)throw new Error('Senha de backup deve ter pelo menos 16 caracteres.');
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.scryptSync(password,salt,32),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return {version:1,algorithm:'AES-256-GCM',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
function decrypt(value,password){
 if(value.version!==1||value.algorithm!=='AES-256-GCM')throw new Error('Formato de backup inválido.');
 const key=crypto.scryptSync(password,Buffer.from(value.salt,'base64'),32),cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));
 cipher.setAuthTag(Buffer.from(value.tag,'base64'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));
}
if(require.main===module){
 let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
 try{const d=JSON.parse(text),p=process.env.DESOSSA_TEST_BACKUP_PASSWORD;if(!p)throw new Error('Senha de backup ausente.');
 if(process.argv.includes('--verify')){const raw=decrypt(d,p);if(raw.project!=='dkiyakjftqcbbnfrgnmh')throw new Error('Projeto divergente.');const tables=raw.tables||JSON.parse(raw.payload_json)[0].backup.tables;console.log(JSON.stringify({project:raw.project,tables:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))}));}
 else process.stdout.write(JSON.stringify(encrypt(d,p)));
 }catch(e){process.stderr.write('Backup não confirmado: '+e.message+'\n');process.exitCode=1;}
 });
}
module.exports={encrypt,decrypt};
