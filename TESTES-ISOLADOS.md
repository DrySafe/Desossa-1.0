# Desossa: versão isolada para homologação

Destino fixo: **dkiyakjftqcbbnfrgnmh.supabase.co**. Nunca consultar o Supabase de
produção nem executar os workflows antigos. A operação atual permanece na VPS.
Não use arquivos `site_desossa/migracao_*.sql` como instalador desta versão: eles
são históricos. As migrações revisadas estão em `supabase/migrations`.

## O que mudou

- Painel com líquido recebido, carne, sebo/osso, perda registrada e saldo a conferir.
  Recebimento de 100 kg com 80 kg de carne, 10 kg de sebo/osso e 10 kg de quebra
  apresenta rendimento de carne de 80% e perda registrada de 10 kg, mesmo quando
  o peso está conciliado. Saldo de peça em andamento não é tratado como perda.
- Período por data do recebimento; peças antigas sem vínculo usam data de entrada
  ou, na ausência dela, data de criação em São Paulo. O período inclui todos os
  lançamentos dessas peças, evitando misturar conjuntos diferentes.
- Custo da matéria-prima calculado sobre o peso de entrada completo. Preço/custo
  ausente aparece como pendente. Valores são estimativas de produção, não vendas
  efetivas no caixa. O custo atual do recebimento continua sendo a referência;
  alterações são auditadas, não reconstituímos custos históricos desconhecidos.
- Toda consulta do painel verifica erros, contagem e paginação. Uma falha impede
  exportar totais; não transforma erro em zero. Nomes são tratados como texto.
- Fila e histórico são salvos em uma única transação IndexedDB. Erros de validação
  não descartam registros. Conflito de UUID só é confirmado se o conteúdo for igual.
- Login por PIN existente verificado no servidor, sem baixar hashes aos aparelhos.
  A API usa cookie HttpOnly/Secure/SameSite e verifica permissões e usuários ativos.
  Operador não pode enviar pendência de outra pessoa nem acessar custos/auditoria.
  Entrada exige conexão; depois do login é possível registrar cortes offline.
  A senha de contingência do gestor é exclusiva de testes e fica somente no servidor.
- Biblioteca de sanitização, SDK e leitor alternativo são locais e versionados.
  Leitor nativo EAN-13 permanece preferencial; ZXing atende navegadores sem ele.
  Zeros à esquerda são preservados. Catálogos antigos sem zeros são reconhecidos
  apenas quando não há ambiguidade. A posição dos campos da etiqueta foi preservada.
- Auditoria no banco acompanha inclusões, alterações e exclusões, inclusive cascatas.
  PINs/hashes são omitidos da auditoria. Exclusão explícita usa transação com log.
  A aba Auditoria mostra os 100 eventos mais recentes, somente para gestor.

## Configuração e instalação

Node 24+ e Python 3.12+. Execute `npm ci` e `npm test` na raiz. Para navegador,
instale Chromium e execute `npm run test:browser` (CHROMIUM_PATH opcional).
O teste de navegador usa apenas APIs fictícias, uma imagem EAN sintética e câmera
simulada. Ele NÃO comprova foco, iluminação ou leitura de etiquetas reais no celular.
Os testes de build geram configuração fictícia em dist: nunca publicar esse artefato.

Variáveis do projeto Vercel de testes:

- DESOSSA_TEST_SUPABASE_URL=https://dkiyakjftqcbbnfrgnmh.supabase.co
- DESOSSA_TEST_SUPABASE_PUBLIC_KEY: chave pública do projeto (sem acesso direto a dados).
- DESOSSA_TEST_ADMIN_PASSWORD: senha de contingência exclusiva de testes, só servidor.
- DESOSSA_TEST_SERVICE_ROLE_KEY: chave de servidor do projeto TESTES, cifrada na Vercel.
- DESOSSA_TEST_SESSION_SECRET: pelo menos 32 caracteres aleatórios, só servidor.

As duas últimas nunca entram em runtime-config.js, dist ou Git. O build só inclui
URL e chave pública; a política CSP impede conexões diretas do navegador ao banco.
A API em `api/` fixa o projeto e usa os segredos somente no servidor. Ela não é
substituída por `python http.server`: servidor estático serve apenas a interface.

Para provisionar: cadastre **SUPABASE_TEST_MANAGEMENT_TOKEN** como segredo seguro
para api.supabase.com. Não envie o token pelo chat. Execute:

```
python3 scripts/provision-test.py --configure-vercel
```

O script executa uma transação no projeto fixo de testes, obtém somente sua chave
service_role e a configura cifrada no projeto Vercel `desossa`. Não chama produção.
Os SQLs foram testados em PostgreSQL embarcado, inclusive reaplicação. Sem credencial
administrativa não é possível aplicar SQL apenas com a chave pública do app.
Não se deve abrir permissões anônimas para contornar essa falta de acesso.

O comando `python3 scripts/vercel-test-env.py` configura variáveis já presentes
na máquina e cria o segredo de sessão se ainda não existir. Não substitui a chave
service_role ausente por outra chave nem transporta tokens administrativos à Vercel.
Depois gere um deployment com o código desta branch. Root Directory é a raiz,
Framework Preset Other, build `node scripts/build-test-config.cjs`, output `dist`.
Mantenha Deployment Protection ativo. `/api/health` retorna 503 enquanto faltar
configuração/tabela e 200 quando consegue consultar a view no banco de testes.

## Workflow separado

`workflows/desossa-testes.json` é um workflow NOVO, inativo, com execução manual e agendamento de 1 hora preparado.
Leia `workflows/README.md` antes de importar em uma instância separada do n8n.
Nenhum workflow foi ativado. O exemplo antigo foi desativado e não é o novo fluxo.

## Dados antigos: ensaio de migração

1. O agente não acessa produção. Obtenha uma exportação consistente pelos canais
   autorizados do responsável pelo banco e guarde uma cópia original imutável.
2. Importação deve ser ensaiada primeiro em esquema/instância isolados, sem workers,
   webhooks, tarefas ou credenciais da operação. Não executar um dump inteiro sem
   revisar comandos de extensões, funções, triggers, donos e permissões.
3. Preserve UUIDs, códigos TEXT, hashes de PIN, pesos NUMERIC, timestamps, datas,
   preços gravados e vínculos. Não recalcule preços antigos usando o catálogo atual.
   Quantidades desconhecidas não devem ser inventadas nem registros descartados.
4. Carregue colaboradores/cortes, recebimentos, peças e lançamentos nessa ordem.
   Faça conciliação de contagens, IDs, somas por peça/recebimento e valores nulos.
   Valide órfãos, duplicidades de peça e pesos inválidos antes de impor regras novas.
5. As regras operacionais rejeitam lançamentos em peças encerradas e excesso de peso.
   Para restaurar histórico fechado, use staging e um procedimento de manutenção
   transacional revisado; não tentar inserir todo o histórico pela API de operação.
   Não desativar triggers em um banco que esteja recebendo lançamentos.
6. Fotos de produção precisam de cópia independente para o bucket TESTES e remapeamento
   das URLs, sem alterar o arquivo original. URLs de produção são bloqueadas pela CSP.
7. `planilha_sheet_id` e `planilha_url` importados não são usados pelo novo workflow.
   Seus destinos ficam em sync_destinos_teste, preenchidos e aprovados separadamente.
8. Testar usuários antigos, peças legadas sem recebimento e etiquetas reais antes de
   considerar homologado. Só depois definir corte de atualização e plano de retorno.

## Backup e recuperação

- Botões na tela de login exportam/restauram pendências locais; projeto, IDs e conflitos
  são verificados antes da transação. Backup de outro ambiente é rejeitado. Não limpar
  dados do navegador enquanto houver pendências; guardar os arquivos com acesso restrito.
- `scripts/backup-test.py` exporta os registros do projeto TESTES e cifra com AES-256-GCM.
  Requer token administrativo e DESOSSA_TEST_BACKUP_PASSWORD (mínimo 16 caracteres,
  guardada separadamente). Arquivo anterior nunca é sobrescrito e a integridade é
  verificada após gravar. O script NÃO copia Storage, configurações do Supabase ou dados
  de Auth; não equivale a um snapshot completo do projeto. Mantenha também backup
  nativo/pg_dump e cópia dos buckets, com retenção e teste periódico de restauração.
- `node scripts/backup-crypto.cjs --verify < arquivo.enc` verifica senha/integridade
  e mostra apenas contagens. A restauração deve ser feita em banco separado e conciliada,
  nunca diretamente na operação como tentativa de recuperação.

Nenhum teste automatizado promete ausência absoluta de falhas. A câmera física,
o template real de planilha, o banco remoto provisionado e o ensaio com dados antigos
são verificações de homologação distintas e não devem ser declaradas concluídas sem execução.
