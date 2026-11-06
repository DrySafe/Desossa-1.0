// Service worker: busca sempre a versão mais nova primeiro (quando tem internet), e só cai pro
// que está salvo localmente se estiver offline. Assim, atualizações no app chegam sozinhas — sem
// precisar de "Unregister + Clear site data" manual toda vez que algo muda.
const CACHE = "desossa-test-dkiyakjftqcbbnfrgnmh-v5";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css?v=test-4",
  "./runtime-config.js",
  "./tema.js?v=test-3",
  "./tema.css?v=test-3",
  "./config.js?v=test-2",
  "./db.js?v=test-2",
  "./sync.js?v=test-2",
  "./scanner.js?v=test-2",
  "./app.js?v=test-4",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/supabase-2.119.0.js",
  "./vendor/purify-3.4.17.js",
  "./vendor/zxing-0.1.5.js",
  "./seguranca.js",
  "./backup.js"
  // painel-gestor.* fica de fora de propósito: é uma página desktop separada,
  // não faz parte do "app instalado" no celular do colaborador.
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting(); // a versão nova assume o controle imediatamente, sem esperar todas as abas fecharem
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k.startsWith("desossa-test-dkiyakjftqcbbnfrgnmh-") && k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nunca intercepta chamadas pro Supabase/n8n — isso precisa sempre ir direto pra rede.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(event.request)) // sem internet: usa o que estiver salvo
  );
});
