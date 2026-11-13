// Tiny IndexedDB wrapper. Everything stays on this device.
const DB_NAME = 'fj62-garage';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('kv');
        db.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const kvGet = key => run('kv', 'readonly', s => s.get(key));
export const kvSet = (key, val) => run('kv', 'readwrite', s => s.put(val, key));
export const photoGet = id => run('photos', 'readonly', s => s.get(id));
export const photoSet = (id, blob) => run('photos', 'readwrite', s => s.put(blob, id));
export const photoDel = id => run('photos', 'readwrite', s => s.delete(id));
export const photoKeys = () => run('photos', 'readonly', s => s.getAllKeys());
export const photoClear = () => run('photos', 'readwrite', s => s.clear());
