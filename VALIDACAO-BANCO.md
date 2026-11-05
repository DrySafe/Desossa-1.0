# Validação do Supabase de testes

Projeto: `dkiyakjftqcbbnfrgnmh`. Produção não foi consultada.

As migrações 001–009 foram aplicadas no projeto de testes. Estado confirmado:
11 tabelas públicas, 5 views e RLS ativo em todas as tabelas. A chave pública
recebeu HTTP 401 ao consultar o relatório; a chave de servidor recebeu HTTP 200.
A chave privilegiada foi configurada cifrada na Vercel, nunca no frontend/Git.

`python3 scripts/validate-test.py` executou no PostgreSQL remoto, dentro de uma
transação desfeita por rollback:

- 100 kg recebidos → 80 kg carne + 10 kg sebo/osso + 10 kg quebra;
- bloqueio de excesso de peso e correções de registros encerrados;
- preservação de peça legada sem recebimento;
- exclusão transacional e auditoria sem hash de PIN;
- limite de tentativas e liberação após login válido;
- snapshots com lease e confirmação por revisão, sem confirmar alterações novas.

Nenhuma fixture de negócio permaneceu: colaboradores, recebimentos e lançamentos
continuam vazios; somente os dois cortes fixos (QUEBRA e SEBO E OSSO) foram criados.

O código real das APIs também foi executado conectado a esse Supabase: health,
login de gestor e consulta autorizada passaram. A verificação foi feita pela
execução local do mesmo código; não equivale a um teste de navegador através da
proteção SSO da Vercel. Homologação com usuários/dados antigos, câmera física e
planilha real continua separada. O workflow não foi ativado.
