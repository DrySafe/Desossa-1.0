# Integração exclusiva de testes

Importar `desossa-testes.json` em n8n separado. O arquivo está INATIVO e contém
gatilho manual e agendamento de 1 hora, sem WhatsApp nem IDs de subworkflows antigos.
O agendamento só executará quando o NOVO workflow for ativado após homologação.

Configurar nova credencial HTTP Header Auth: nome do header `apikey`, valor da
chave de servidor SOMENTE do Supabase de testes. Selecionar a credencial nos nodes
RPC. Configurar uma credencial Google Sheets exclusiva para a pasta/planilha de
homologação, sem compartilhar as planilhas da operação com essa conta.

No node Montar snapshot completo, preencher `planilhasPermitidas` com IDs
exclusivos de testes. Aprovar esses mesmos IDs em `sync_destinos_teste` no banco.
Os campos legados de planilha não são consultados. Não há cópia de template nem
criação de pasta automática: isso evita reutilizar IDs de Drive da operação.

O layout preserva os nomes de abas `Somas`, `TRAZEIRO` e `DIANTEIRO` do fluxo
fornecido. Validar o template de testes: C:V são as 20 peças, linhas 6:20 para
traseiro e 29:36 para dianteiro; E4/F4/G4 contêm quantidade/peso/custo. Se o
layout real for diferente, revisar o mapa ANTES de executar. Peças fora de 1:20,
cortes não mapeados e quantidades ausentes geram erro em vez de sumir do relatório.

Cada execução obtém snapshot completo e escreve valores numéricos com RAW. Todas
as células de cortes são regravadas, inclusive zeros, corrigindo exclusões. A
confirmação só ocorre após a escrita no Google. A fila tem revisão e lease, de
modo que uma revisão antiga não confirme alterações novas. Mudanças de recebimento,
peça, lançamento e nome de corte criam novas revisões. Custos ausentes limpam a
célula correspondente, sem trocar falha de consulta por peso zero.

Há lease de 15 minutos, timeout de 30 segundos por HTTP e 5 minutos por workflow.
Não habilitar execuções manuais concorrentes para o mesmo destino. Se uma chamada
externa exceder esses limites de forma indeterminada, reconciliar novamente o
snapshot antes de considerar a planilha consistente. O Google Sheets não participa
da transação PostgreSQL; idempotência e conciliação continuam necessárias.

Falhas de escrita não confirmam revisão e são registradas em sync_erros. Erros
anteriores à escrita mantêm a revisão pendente e liberam após o lease. Não existe
corte global que paralise todas as planilhas por falha de um único recebimento.
Não ativar agendamento até testar pesos, exclusões, alteração de custo, falha de
rede, reenvio e edição concorrente numa planilha descartável.

O código-fonte puro é `montar-snapshot.cjs`; execute `node scripts/build-workflow.cjs`
para regenerar o JSON após mudanças e rode `npm test`.
