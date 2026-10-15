const DB_NAME = 'MiniNewTabDB';
const STORE = 'imgStore';
let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error('数据库被其他页面占用')); };
  });
  return opening;
}
async function transaction(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('壁纸存储失败'));
  });
}
export const readMedia = key => transaction('readonly', store => store.get(key));
export const writeMedia = (key, value) => transaction('readwrite', store => store.put(value, key));
export const deleteMedia = key => transaction('readwrite', store => store.delete(key));
export const isExtension = Boolean(globalThis.chrome?.storage?.local);
export async function readConfig() {
  if (isExtension) return (await chrome.storage.local.get('ntConfig')).ntConfig;
  const raw = localStorage.getItem('ntConfig');
  return raw ? JSON.parse(raw) : undefined;
}
export async function writeConfig(config) {
  if (isExtension) await chrome.storage.local.set({ ntConfig: config });
  else localStorage.setItem('ntConfig', JSON.stringify(config));
}
export function subscribeConfig(listener) {
  if (isExtension) chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ntConfig) listener(changes.ntConfig.newValue);
  });
  else window.addEventListener('storage', event => {
    if (event.key === 'ntConfig') {
      try { listener(event.newValue ? JSON.parse(event.newValue) : undefined); } catch { /* Ignore malformed external data. */ }
    }
  });
}
