// Service worker: busca sempre a versão mais nova primeiro (quando tem internet), e só cai pro
// que está salvo localmente se estiver offline. Assim, atualizações no app chegam sozinhas — sem
// precisar de "Unregister + Clear site data" manual toda vez que algo muda.
const CACHE = "desossa-shell-v27";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css?v=27",
  "./config.js?v=27",
  "./db.js?v=27",
  "./sync.js?v=27",
  "./scanner.js?v=27",
  "./app.js?v=27",
  "./manifest.json"
  // painel-gestor.* fica de fora de propósito: é uma página desktop separada,
  // não faz parte do "app instalado" no celular do colaborador.
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting(); // a versão nova assume o controle imediatamente, sem esperar todas as abas fecharem
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sincronizar-fila-desossa') {
    event.waitUntil(sincronizarFilaLocalServidor());
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nunca intercepta chamadas pro Supabase/n8n — isso precisa sempre ir direto pra rede.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copia));
        return resposta;
      })
      .catch(() => caches.match(event.request)) // sem internet: usa o que estiver salvo
  );
});
