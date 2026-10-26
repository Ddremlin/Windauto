// Общая база IndexedDB: фото (photos) и заказы (orders).
// localStorage ограничен ~5 МБ на сайт — заказы с подписями туда уже не помещаются.
const DB = 'windauto'
export type Store = 'photos' | 'orders'

let dbPromise: Promise<IDBDatabase> | null = null

export function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos')
      if (!d.objectStoreNames.contains('orders')) d.createObjectStore('orders')
    }
    req.onsuccess = () => {
      // другая вкладка с новой версией приложения просит обновить базу
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked — закройте другие вкладки Windauto'))
  })
  return dbPromise
}

export async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Несколько записей и удалений одной транзакцией */
export async function writeMany(store: Store, puts: [string, unknown][], deletes: string[] = []): Promise<void> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite')
    const s = t.objectStore(store)
    for (const [k, v] of puts) s.put(v, k)
    for (const k of deletes) s.delete(k)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
  })
}
