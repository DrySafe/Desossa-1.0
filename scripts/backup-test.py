"""Exportação criptografada dos registros de testes. Não exporta buckets nem configurações do projeto."""
import os,json,pathlib,urllib.request,urllib.error,subprocess,sys
PROJECT='dkiyakjftqcbbnfrgnmh'
TABLES=['colaboradores','cortes_catalogo','recebimentos','lotes','lancamentos','exclusoes_log','sync_erros','auditoria_eventos','sync_destinos_teste','sync_fila_recebimentos']
def main():
    token=os.environ.get('SUPABASE_TEST_MANAGEMENT_TOKEN')
    if not token or not os.environ.get('DESOSSA_TEST_BACKUP_PASSWORD'):
        raise SystemExit('Configure token administrativo de testes e DESOSSA_TEST_BACKUP_PASSWORD com segurança.')
    query="select jsonb_build_object('project','"+PROJECT+"','version',1,'exportado_em',now(),'tables',jsonb_build_object("+','.join("'"+t+"',coalesce((select jsonb_agg(to_jsonb(r)) from public."+t+" r),'[]'::jsonb)" for t in TABLES)+")) as backup"
    req=urllib.request.Request('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',data=json.dumps({'query':query}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=60) as r:
        data={'project':PROJECT,'version':1,'payload_json':r.read().decode('utf8')}
    # Manter JSON original em texto preserva NUMERIC sem conversão para float.
    root=pathlib.Path(__file__).resolve().parents[1]
    encrypted=subprocess.run(['node',str(root/'scripts/backup-crypto.cjs')],input=json.dumps(data),text=True,capture_output=True,check=True).stdout
    out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/backups/desossa-testes.json.enc')
    if out.exists():raise SystemExit('Arquivo já existe; escolha outro destino para preservar o backup anterior.')
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('x') as f:f.write(encrypted)
    out.chmod(0o600)
    subprocess.run(['node',str(root/'scripts/backup-crypto.cjs'),'--verify'],input=encrypted,text=True,check=True)
    print('Backup cifrado e integridade verificada. Fotos do Storage exigem cópia separada.')
if __name__=='__main__':
    try:main()
    except urllib.error.HTTPError as e:raise SystemExit('Backup não confirmado; HTTP '+str(e.code))
