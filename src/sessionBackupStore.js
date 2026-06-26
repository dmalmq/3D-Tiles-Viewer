const DB_NAME = "cesium-app";
const DB_VERSION = 2;
const BACKUP_STORE = "sessionBackups";
export const MAX_BACKUPS = 10;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("directoryHandles")) {
        db.createObjectStore("directoryHandles");
      }
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        const store = db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
  });
}

function hashSession(session) {
  return JSON.stringify(session);
}

export async function saveBackup(session, { label = null, source = "manual" } = {}) {
  const db = await openDB();
  const latest = await listBackups(db);
  const serialized = hashSession(session);
  if (latest[0] && hashSession(latest[0].session) === serialized) {
    return latest[0];
  }

  const entry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    label,
    source,
    session,
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readwrite");
    tx.objectStore(BACKUP_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await pruneBackups(db);
  return entry;
}

async function pruneBackups(db) {
  const all = await listBackups(db);
  if (all.length <= MAX_BACKUPS) return;
  const toDelete = all.slice(MAX_BACKUPS);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readwrite");
    const store = tx.objectStore(BACKUP_STORE);
    for (const entry of toDelete) store.delete(entry.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBackups(existingDb = null) {
  const db = existingDb ?? (await openDB());
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readonly");
    const request = tx.objectStore(BACKUP_STORE).getAll();
    request.onsuccess = () => {
      const items = (request.result ?? []).sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getBackup(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readonly");
    const request = tx.objectStore(BACKUP_STORE).get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBackup(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readwrite");
    tx.objectStore(BACKUP_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllBackups() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, "readwrite");
    tx.objectStore(BACKUP_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}