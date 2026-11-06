// ============================================================
// CONFIGURAÇÃO — preencha com os dados da sua VPS antes de publicar
// ============================================================
const APP_CONFIG = {
  ENVIRONMENT: "test",
  SUPABASE_URL: window.DESOSSA_TEST_CONFIG?.SUPABASE_URL || "https://dkiyakjftqcbbnfrgnmh.supabase.co",
  SUPABASE_ANON_KEY: window.DESOSSA_TEST_CONFIG?.SUPABASE_ANON_KEY || "",

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

  // Credenciais de gestor e chave privilegiada permanecem somente no servidor.
  API_SESSION: "/api/session"
};
Object.freeze(APP_CONFIG);

function validarConfiguracaoTeste() {
  const destino = "https://dkiyakjftqcbbnfrgnmh.supabase.co";
  if (APP_CONFIG.ENVIRONMENT !== "test" || APP_CONFIG.SUPABASE_URL !== destino) {
    throw new Error("Configuração bloqueada: apenas o projeto de testes é permitido.");
  }
  const chave = APP_CONFIG.SUPABASE_ANON_KEY;
  if (typeof chave !== "string" || !chave) throw new Error("Configure a chave pública do Supabase de testes.");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(chave)) {
    let payload;
    try { payload = JSON.parse(atob(chave.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch { throw new Error("Use somente uma chave pública do projeto de testes."); }
    if (payload.role !== "anon" || payload.ref !== "dkiyakjftqcbbnfrgnmh") {
      throw new Error("Chave bloqueada: papel ou projeto incompatível com testes.");
    }
  }
  return destino;
}

function criarClienteTeste() {
  const destino = validarConfiguracaoTeste();
  return supabase.createClient(destino, APP_CONFIG.SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: false, storageKey: "desossa-test-dkiyakjftqcbbnfrgnmh-auth" },
    global: {
      fetch: async (input, init = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url || String(input));
        if (url.origin !== destino || url.username || url.password) {
          return Promise.reject(new Error("Conexão fora do projeto de testes bloqueada."));
        }
        if (!url.pathname.startsWith("/rest/v1/")) throw new Error("Endpoint não permitido no cliente.");
        const headers = {};
        const origem = new Headers(init.headers || (typeof input === "object" ? input.headers : {}));
        for (const nome of ["content-type", "accept", "prefer", "range", "range-unit"]) if (origem.has(nome)) headers[nome] = origem.get(nome);
        const method = init.method || input.method || "GET";
        const body = init.body ?? (typeof input === "object" && !["GET","HEAD"].includes(method) ? await input.clone().text() : undefined);
        return fetch("/api/database?path=" + encodeURIComponent(url.pathname + url.search), {
          method, body, headers, redirect: "error", credentials: "same-origin"
        });
      }
    }
  });
}

try { validarConfiguracaoTeste(); }
catch (erro) {
  window.addEventListener("DOMContentLoaded", () => {
    document.body.replaceChildren();
    const mensagem = document.createElement("p");
    mensagem.textContent = "Ambiente de testes bloqueado: " + erro.message;
    document.body.appendChild(mensagem);
  });
}

async function sessaoAPI(dados, method = "POST") {
  const resposta = await fetch("/api/session", { method, credentials: "same-origin", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(dados) });
  const data = await resposta.json();
  if (!resposta.ok) throw new Error(data.message || "Acesso não confirmado.");
  return data;
}
