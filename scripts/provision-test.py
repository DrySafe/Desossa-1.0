"""Executa somente migrações revisadas no projeto FIXO de testes via Management API."""
import os, pathlib, urllib.request, urllib.error, json
PROJECT = 'dkiyakjftqcbbnfrgnmh'
def main():
    token = os.environ.get('SUPABASE_TEST_MANAGEMENT_TOKEN')
    if not token:
        raise SystemExit('Falta SUPABASE_TEST_MANAGEMENT_TOKEN nas configurações seguras do ambiente.')
    root = pathlib.Path(__file__).resolve().parents[1]
    sql = '\n'.join(p.read_text() for p in sorted((root/'supabase/migrations').glob('*.sql')))
    # Transação única: falhas não deixam metade da estrutura aplicada.
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query':'begin;\n'+sql+'\ncommit;'}).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
            print('Migrações aplicadas no projeto de testes; HTTP',r.status)
        # Obter somente a chave de servidor do projeto fixo e armazená-la cifrada na Vercel.
        if '--configure-vercel' in __import__('sys').argv:
            request_keys=urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/api-keys', headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(request_keys,timeout=30) as result:keys=json.load(result)
            if not isinstance(keys,list):raise SystemExit('Não foi possível identificar a chave de servidor; não configurar Vercel.')
            candidates=[k.get('api_key') for k in keys if k.get('name')=='service_role' and k.get('api_key')]
            if len(candidates)!=1:raise SystemExit('Chave de servidor não identificada; configurar com segurança após revisão.')
            import importlib.util
            spec=importlib.util.spec_from_file_location('vercel_test_env',root/'scripts/vercel-test-env.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            module.configure(candidates[0])
    except urllib.error.HTTPError as e:
        raise SystemExit(f'Migração não confirmada: HTTP {e.code}. Não repetir sem diagnosticar.')
if __name__=='__main__': main()
