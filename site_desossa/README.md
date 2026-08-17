# Controle de Desossa — App

PWA mobile-first para lançamento da desossa direto no celular, com login por colaborador (foto + PIN), leitura de código de barras da balança Prix, fila offline, e painel de acompanhamento. Espelha os dados no Google Sheets via n8n.

## Estrutura

```
index.html        tela principal (shell do app)
style.css         identidade visual
config.js         ⚠️ preencher antes de publicar (Supabase, n8n, senha do gestor)
db.js             armazenamento local (IndexedDB) — fila offline e cache
sync.js           comunicação com Supabase (leitura) e n8n (escrita)
scanner.js        leitura de código de barras (câmera) e decodificação
app.js            todas as telas do celular (login, PIN, lançar, peça, admin)
manifest.json     configuração de instalação como app
sw.js             service worker (funciona offline)
painel-gestor.html  painel de acompanhamento — desktop, só gestor, não instala no celular
painel-gestor.css   visual do painel
painel-gestor.js    KPIs, gráficos, filtros de data, exportar CSV
supabase/schema.sql   schema do banco (rode no SQL Editor do Supabase)
n8n/workflow-desossa.json   workflow pra importar no n8n
```

## Arquitetura de gravação (importante — leia antes de configurar)

O app grava os lançamentos **direto no Supabase**. O n8n não fica no caminho da gravação — ele só espelha, em segundo plano, o que já está confirmado no banco pro Google Sheets. Isso foi uma correção feita depois de um teste real: um desenho anterior (app → webhook do n8n → Supabase) fazia o n8n responder "recebido" antes de confirmar que o Supabase gravou de verdade, então uma falha silenciosa no Supabase (ex: credencial não configurada) fazia o app achar que tinha dado tudo certo. Gravando direto no banco, a única confirmação de sucesso é o próprio Postgres — sem ambiguidade, sem perda de dado por falha em camada intermediária.

## 0. Se você já tem o banco rodando (atualização)

Rode `supabase/migracao_recebimento.sql` no SQL Editor — isso adiciona a etapa de **Recebimento** sem apagar nada que já existe. Se for instalação nova, use direto o `supabase/schema.sql` (já vem com essa etapa incluída).

## Como funciona agora: Recebimento → Peça → Lançamento

1. **Recebimento** (tela "Peça" → "+ Registrar novo recebimento", feito por qualquer colaborador logado): fornecedor, placa, fiscal de prevenção, açougueiro que acompanhou, e o peso corporal de quem carrega a carne (1 ou 2 pessoas) — esse peso é descontado depois de cada peça pesada.
2. **Peças** (dentro do recebimento, mesma tela): pra cada metade de boi que chega, registra tipo (Dianteiro/Traseiro), número da peça, peso bruto (lido na balança com a pessoa junto) e quem carregou — o app calcula sozinho o peso líquido (bruto − peso da pessoa). Pode ir adicionando peças a qualquer momento, mesmo depois, enquanto o recebimento não for finalizado.
3. **Lançamento de cortes**: o colaborador escolhe uma dessas peças (agora agrupadas por recebimento) e lança os cortes normalmente (scanner ou manual), como já funcionava.
4. **Preço de custo**: como a folha de recebimento não traz preço, o gestor define depois, na Área do Gestor → aba "Recebimentos", um preço/kg pro Dianteiro e outro pro Traseiro daquele recebimento — usado pra calcular margem de todas as peças dele.
5. **Finalizar**: só o gestor finaliza (Área do Gestor → Recebimentos), e isso bloqueia o recebimento inteiro (todas as peças dele) de uma vez — depois disso só o gestor consegue reabrir/editar.

## Painel de Acompanhamento (só gestor)

O colaborador não tem mais acesso a margem, valor ou custo — isso foi tirado do app do celular. Em vez disso, existe uma página separada, pensada pra computador: `painel-gestor.html`.

- Acesse pela Área do Gestor no app (botão "📊 Abrir Painel de Acompanhamento"), ou direto pela URL — ela pede a mesma senha do `ADMIN_PASSWORD`.
- Filtros: período (atalhos de 7/30/90 dias ou datas customizadas), fornecedor, tipo (Dianteiro/Traseiro), e comparação automática com o período anterior.
- KPIs: rendimento, margem bruta, quebra (kg e %), peso recebido/desossado, venda, custo, lucro bruto, ticket médio R$/kg, nº de peças, lançamentos e colaboradores ativos — cada um com a variação (▲/▼) em relação ao período anterior.
- Gráficos: evolução de margem/quebra ao longo do tempo, Dianteiro × Traseiro, produtividade por colaborador, e mix de cortes.
- Tabelas: comparativo por fornecedor, e detalhamento peça por peça (com selo "Completa", "Em andamento" ou "Quebra alta" — acima de 8% de quebra), ordenável clicando no cabeçalho da coluna.
- Botão de exportar CSV das peças do período filtrado.

Como é uma página HTML separada (fora do app instalado no celular), ela não fica em cache offline de propósito — precisa de internet pra abrir, o que faz sentido já que é feita pra ser usada num computador na gestão, não na área de desossa.

## 1. Banco de dados (Supabase)

1. Abra o SQL Editor do seu Supabase self-hosted.
2. Rode o conteúdo de `supabase/schema.sql`.
3. Cadastre pelo menos 1 colaborador e os cortes do catálogo pela **Área do gestor** dentro do próprio app (depois de publicado), ou direto no Supabase Table Editor pra testar mais rápido.

## 2. n8n (só espelha pro Sheets, em segundo plano)

1. Importe `n8n/workflow-desossa.json` no seu n8n — é um workflow **agendado** (roda a cada 2 minutos por padrão), não um webhook.
2. Configure as variáveis de ambiente do n8n: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (pegue a **service_role**, não a anon, já que o n8n roda no servidor).
3. Configure a credencial do Google Sheets (OAuth2) no node "Escrever no Google Sheets" e troque `COLOQUE_O_ID_DA_SUA_PLANILHA_AQUI` pelo ID da planilha (está na URL do Google Sheets).
4. **Ative o workflow.** Se ele nunca gravar no Sheets, teste rodando manualmente uma vez ("Execute workflow") pra ver o erro exato, em vez de só esperar a execução automática — assim você vê na hora se falta credencial, e não descobre só quando for tarde.

## 3. Configurar o app (`config.js`)

Preencha:
- `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Project Settings > API no Supabase) — usada tanto pra ler dados de referência quanto pra **gravar os lançamentos diretamente**.
- `ADMIN_PASSWORD` — troque a senha padrão antes de publicar.

## 4. Calibrar a leitura do código de barras da Prix ⚠️ importante

O formato do código de barras da Prix é configurável e pode variar de loja pra loja. Pra calibrar:

1. Pegue 2–3 etiquetas reais impressas (como as do exemplo que você mandou).
2. Escaneie com o app (tela "Escanear etiqueta") e olhe no console do navegador (ou peça pra eu adicionar uma tela de depuração temporária) o texto bruto lido.
3. Compare os dígitos com o código do produto impresso na etiqueta (ex: `015097`) pra achar a posição certa em `BARCODE_CONFIG.codigoInicio` / `codigoFim`.
4. Se quiser que o peso também venha do código de barras (em vez do colaborador digitar), ative `usaPesoEmbutido: true` e ajuste `pesoInicio`, `pesoFim` e `pesoCasasDecimais` comparando com o peso real impresso.
5. Não conseguindo bater 100%: deixe `usaPesoEmbutido: false` — o app já funciona plenamente assim, só que o colaborador digita o peso (1 campo numérico) depois de escanear o código do corte.

## 5. Publicar

Como é só HTML/CSS/JS puro (sem build step), publicar é copiar a pasta inteira pro seu servidor e apontar o Traefik pra ela como site estático, com HTTPS (obrigatório — câmera só funciona em HTTPS ou localhost).

**Cache do navegador (importante pra atualizações chegarem sozinhas):** por padrão, servidores estáticos (nginx, etc.) costumam deixar o navegador guardar `.html`/`.js`/`.css` em cache por um tempo — o que pode fazer celulares mostrarem uma versão antiga do app mesmo depois de você subir arquivos novos. Recomendo configurar o servidor que serve essa pasta pra sempre revalidar esses arquivos. Se for nginx, adicione isso no `location` do site:
```nginx
location ~* \.(html|js|css|json)$ {
    add_header Cache-Control "no-cache";
}
```
Isso não desliga o cache, só obriga o navegador a perguntar pro servidor "isso mudou?" antes de usar a cópia salva — rápido, e garante que atualizações cheguem sozinhas. Como reforço extra, os arquivos principais do `index.html` (`app.js?v=12`, etc.) têm um número de versão na URL — cada vez que eu mandar uma atualização, esse número muda, e isso sozinho já força o navegador a buscar de novo, independente da configuração do servidor.

## 6. Cadastro inicial (feito por você, o gestor)

Na tela de login, toque em **"Área do gestor"**:
- Aba **Cortes**: cadastre código (da etiqueta), nome e preço de venda/kg de cada corte — inclusive `93960` (Sebo e Osso) e `00000` (Quebra), que já vêm pré-cadastrados no schema.
- Aba **Colaboradores**: cadastre nome, foto (link de imagem) e PIN de 4 dígitos de cada pessoa que faz a desossa.
- Aba **Peças**: sempre que chegar uma peça nova (Traseiro/Dianteiro), cadastre peso de entrada e preço pago/kg — isso abre o lançamento pros colaboradores.

## Limitações conhecidas desta primeira versão (próximos passos sugeridos)

- Upload de foto ainda é por link (URL); dá pra evoluir pra upload direto (Supabase Storage).
- Faltam os ícones `icon-192.png` e `icon-512.png` (referenciados no `manifest.json`) — adicione uma imagem quadrada simples com esses nomes na pasta pra completar o "instalar como app".
- Cadastrar um recebimento ou adicionar uma peça exige internet no momento (não entra na fila offline como o lançamento de cortes) — geralmente não é problema porque acontece na doca, onde o sinal costuma ser melhor, mas dá pra estender a mesma lógica de fila se precisar.
- A senha da Área do Gestor é única e simples — pra mais segurança, dá pra trocar por login de verdade (Supabase Auth).
- As políticas de acesso (RLS) do banco estão abertas pra simplificar o MVP — como o app agora grava direto no banco com a chave anon, isso é ainda mais importante de revisar antes de ir pra produção: hoje qualquer pessoa com a chave anon (que fica visível no código do app) consegue ler e escrever em qualquer tabela. Pra uma rede interna isso já reduz bastante o risco, mas o ideal a médio prazo é restringir por papel (ex: só permitir INSERT em `lancamentos`, sem UPDATE/DELETE, e sem acesso de escrita às outras tabelas pela chave anon).
- Alertas automáticos (ex: WhatsApp quando a quebra sair do padrão) podem ser adicionados como um node a mais no mesmo workflow do n8n.
