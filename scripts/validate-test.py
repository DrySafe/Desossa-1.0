"""Teste transacional remoto no projeto FIXO de testes; não deixa fixtures persistidas."""
import os,json,pathlib,urllib.request,urllib.error
PROJECT='dkiyakjftqcbbnfrgnmh'
root=pathlib.Path(__file__).resolve().parents[1]
token=os.environ.get('SUPABASE_TEST_MANAGEMENT_TOKEN')
if not token:raise SystemExit('Credencial administrativa de testes ausente.')
req=urllib.request.Request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',data=json.dumps({'query':(root/'tests/remote-database.sql').read_text()}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
try:
 with urllib.request.urlopen(req,timeout=60) as r:data=json.load(r)
 if not any(row.get('validation')=='ok' for row in data):raise SystemExit('Validação não confirmada.')
 print('PASS: PostgreSQL remoto; permissões, pesos, legado, auditoria, exclusão, login e fila versionada. Fixtures desfeitas.')
except urllib.error.HTTPError as e:
 try:
  d=json.load(e);message=d.get('message','Erro de SQL/API')
 except:message='Erro de SQL/API'
 raise SystemExit('Validação não confirmada; HTTP '+str(e.code)+': '+message)
