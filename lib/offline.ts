// Offline queue (PWA): mutations made offline are stored in IndexedDB then replayed.
// Minimal dependency-free implementation; SW caches app shell + recents (see public/sw.js).
const DB = "eiden-drive", STORE = "outbox";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function enqueue(op: { url: string; method: string; body: unknown }) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...op, ts: Date.now() });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function flush() {
  const db = await idb();
  const items: { key: IDBValidKey; op: { url: string; method: string; body: unknown } }[] = await new Promise((res) => {
    const out: typeof items = [];
    const tx = db.transaction(STORE, "readonly");
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { out.push({ key: c.primaryKey, op: c.value }); c.continue(); }
      else res(out);
    };
  });
  for (const { key, op } of items) {
    try {
      await fetch(op.url, { method: op.method, headers: { "content-type": "application/json" }, body: JSON.stringify(op.body) });
      const db2 = await idb();
      await new Promise<void>((res) => {
        const tx = db2.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => res();
      });
    } catch { break; } // still offline — keep rest queued
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", flush);
}
