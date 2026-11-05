"""Configura somente o projeto Vercel de testes; nunca imprime valores."""
import os,json,secrets,urllib.request,urllib.error
BASE='https://api.vercel.com'
PROJECT='prj_5yyLYjy5YFkdFRwdZqm3d2eqr47o'
def request(path,body=None):
    req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+os.environ['VERCEL_TOKEN'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def configure(service_key=None):
    assert os.environ.get('DESOSSA_TEST_SUPABASE_URL')=='https://dkiyakjftqcbbnfrgnmh.supabase.co','URL de testes divergente'
    existing={v['key'] for v in request('/v9/projects/'+PROJECT+'/env').get('envs',[])}
    values={k:os.environ[k] for k in ['DESOSSA_TEST_SUPABASE_URL','DESOSSA_TEST_SUPABASE_PUBLIC_KEY','DESOSSA_TEST_ADMIN_PASSWORD']}
    if 'DESOSSA_TEST_SESSION_SECRET' not in existing:values['DESOSSA_TEST_SESSION_SECRET']=secrets.token_urlsafe(48)
    if service_key:values['DESOSSA_TEST_SERVICE_ROLE_KEY']=service_key
    elif os.environ.get('DESOSSA_TEST_SERVICE_ROLE_KEY'):values['DESOSSA_TEST_SERVICE_ROLE_KEY']=os.environ['DESOSSA_TEST_SERVICE_ROLE_KEY']
    for name,value in values.items():
        if not value:raise RuntimeError('Configuração ausente: '+name)
        request('/v10/projects/'+PROJECT+'/env?upsert=true',{'key':name,'value':value,'type':'encrypted','target':['preview','production']})
        print('Configurado:',name)
if __name__=='__main__':
    try:configure()
    except urllib.error.HTTPError as e:raise SystemExit('Configuração não confirmada; HTTP '+str(e.code))
