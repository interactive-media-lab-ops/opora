/** Мінімальна обгортка IndexedDB для черги відповідей кандидата (аудіо-блоби не влазять у localStorage). */
const DB_NAME = 'opora-offline'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const idb = {
  get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)),
  delete: (key: string) => run('readwrite', (s) => s.delete(key)),
  /** Видаляє всі записи, ключі яких починаються з prefix. */
  async deleteByPrefix(prefix: string): Promise<void> {
    const db = await open()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '\uffff'))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  },
  /** Усі значення, ключі яких починаються з prefix. */
  async list<T>(prefix: string): Promise<T[]> {
    const db = await open()
    try {
      return await new Promise<T[]>((resolve, reject) => {
        const out: T[] = []
        const req = db
          .transaction(STORE, 'readonly')
          .objectStore(STORE)
          .openCursor(IDBKeyRange.bound(prefix, prefix + '￿'))
        req.onsuccess = () => {
          const cur = req.result
          if (cur) {
            out.push(cur.value as T)
            cur.continue()
          } else resolve(out)
        }
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  },
}
