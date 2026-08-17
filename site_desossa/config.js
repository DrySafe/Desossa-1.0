// ============================================================
// CONFIGURAÇÃO — preencha com os dados da sua VPS antes de publicar
// ============================================================
const APP_CONFIG = {
  // URL pública do seu Supabase self-hosted (ex: https://supabase.seudominio.com.br)
  SUPABASE_URL: "https://nypmvhsxvaqscswszwpr.supabase.co",

  // Chave "anon" do Supabase (Project Settings > API). O app usa essa chave tanto pra
  // ler dados de referência quanto para GRAVAR os lançamentos diretamente no banco —
  // a confirmação de sucesso vem do próprio Supabase, nunca de uma camada intermediária.
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55cG12aHN4dmFxc2Nzd3N6d3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MDMyNDUsImV4cCI6MjA5OTI3OTI0NX0.KDvNQiShZ6fD4rpAiWeMYAdP8PXdM0piGjMhZPK9tIA",

  // O n8n NÃO recebe os lançamentos em tempo real (isso mudou de propósito depois de um teste
  // que revelou um problema: o webhook do n8n respondia "recebido" antes de confirmar a gravação
  // no banco). Agora o n8n só espelha, em segundo plano, o que já está gravado no Supabase pro
  // Google Sheets — ver n8n/workflow-desossa.json. Por isso não há URL de webhook aqui.

  // Configuração de decodificação do código de barras da balança Prix.
  // Ajuste aqui sem precisar mexer no resto do código — veja README.md para instruções de calibração.
  BARCODE_CONFIG: {
    prefixo: "2",        // primeiro dígito, quase sempre "2"

    // Balança dedicada à desossa (separada do grupo do caixa), configurada em EAN-13 puro —
    // 3° ao 5° dígito é o código do produto, os últimos 4 dígitos são o peso.
    formatoPreferido: "auto",

    codigoInicio: 2,   // 3° dígito (posição 0-based 2)
    codigoFim: 7,        // até o 75° dígito, exclusive (6 dígitos de código)

    usaPesoEmbutido: true,
    pesoInicio: 7,      // últimos 4 dígitos do EAN-13 (13 dígitos: 0 a 12)
    pesoFim: 12,
    pesoCasasDecimais: 3, // ainda precisa confirmar com uma etiqueta real (ver README > Calibração)

    // Preço/kg direto no código: não vem nesse layout — o preço continua sendo o do cadastro,
    // editável na tela de lançamento.
    usaPrecoEmbutido: false,
    precoInicio: 12,
    precoFim: 17,
    precoCasasDecimais: 2,

    // Não usado.
    usaValorTotalEmbutido: false,
    valorTotalInicio: 7,
    valorTotalFim: 12,
    valorTotalCasasDecimais: 2
  },

  // Quantos minutos sem uso até avisar (não desloga sozinho, conforme decidido)
  INATIVIDADE_AVISO_MIN: 5,

  // Senha simples da Área do Gestor (cadastro de cortes, colaboradores e novas peças).
  // Troque isso antes de publicar. Para mais segurança no futuro, isso pode virar um login de verdade.
  ADMIN_PASSWORD: "#Eco2186*"
};
