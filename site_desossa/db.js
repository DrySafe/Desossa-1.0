// ============================================================
// DB.js — armazenamento local (IndexedDB), permite o app funcionar sem internet
// ============================================================
const DB_NAME = "desossa_db";
const DB_VERSION = 4;

const STORES = {
  fila: "fila_pendente",       // lançamentos aguardando sincronizar
  colaboradores: "colaboradores_cache",
  cortes: "cortes_cache",
  recebimentos: "recebimentos_cache",
  lotes: "lotes_cache",
  lancamentosLote: "lancamentos_lote_cache", // histórico de cortes já lançados, por peça — sobrevive a atualizar a página
  logs: "log_app",              // log de eventos (leitura de código, erros, envios) — pra diagnosticar sem devtools no celular
  sessao: "sessao"
};

async function solicitarPersistenciaStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const persistido = await navigator.storage.persisted();
    if (!persistido) {
      const concedido = await navigator.storage.persist();
      console.log(concedido ? "Armazenamento persistente ativado!" : "Navegador negou persistência.");
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.fila)) {
        db.createObjectStore(STORES.fila, { keyPath: "id_local" });
      }
      if (!db.objectStoreNames.contains(STORES.colaboradores)) {
        db.createObjectStore(STORES.colaboradores, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.cortes)) {
        db.createObjectStore(STORES.cortes, { keyPath: "codigo" });
      }
      if (!db.objectStoreNames.contains(STORES.recebimentos)) {
        db.createObjectStore(STORES.recebimentos, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.lotes)) {
        db.createObjectStore(STORES.lotes, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.lancamentosLote)) {
        const store = db.createObjectStore(STORES.lancamentosLote, { keyPath: "id" });
        store.createIndex("lote_id", "lote_id", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.logs)) {
        db.createObjectStore(STORES.logs, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.sessao)) {
        db.createObjectStore(STORES.sessao, { keyPath: "chave" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllByIndex(storeName, indexName, valor) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index(indexName).getAll(valor);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearReplace(storeName, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    values.forEach((v) => store.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Sessão (usuário logado no aparelho) ----------
async function salvarSessao(colaborador) {
  await idbPut(STORES.sessao, { chave: "usuario_atual", valor: colaborador, quando: Date.now() });
}
async function lerSessao() {
  const row = await idbGet(STORES.sessao, "usuario_atual");
  return row ? row.valor : null;
}
async function limparSessao() {
  await idbDelete(STORES.sessao, "usuario_atual");
}
async function salvarLoteAtivo(lote) {
  await idbPut(STORES.sessao, { chave: "lote_atual", valor: lote, quando: Date.now() });
}
async function lerLoteAtivo() {
  const row = await idbGet(STORES.sessao, "lote_atual");
  return row ? row.valor : null;
}

// ---------- Log local (pra diagnosticar problemas no celular, sem devtools) ----------
async function registrarLog(nivel, mensagem, detalhes) {
  try {
    const entrada = {
      id: crypto.randomUUID(),
      quando: new Date().toISOString(),
      nivel, // "info" | "sucesso" | "erro"
      mensagem,
      detalhes: detalhes != null ? JSON.stringify(detalhes) : null
    };
    await idbPut(STORES.logs, entrada);
    // mantém só os últimos 300, pra não crescer pra sempre
    const todos = await idbGetAll(STORES.logs);
    if (todos.length > 300) {
      const excedentes = todos.sort((a, b) => new Date(a.quando) - new Date(b.quando)).slice(0, todos.length - 300);
      for (const e of excedentes) await idbDelete(STORES.logs, e.id);
    }
  } catch (err) {
    console.warn("Falha ao gravar log local:", err);
  }
}

async function listarLogs() {
  const todos = await idbGetAll(STORES.logs);
  return todos.sort((a, b) => new Date(b.quando) - new Date(a.quando));
}

async function limparLogs() {
  const todos = await idbGetAll(STORES.logs);
  for (const e of todos) await idbDelete(STORES.logs, e.id);
}
