/** Збереження запитів React Query в IndexedDB, щоб кабінет кандидата працював офлайн. */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { idb } from './idb'

/**
 * Офлайн-копія даних кабінету кандидата (D-18): останні відповіді сервера зберігаються на пристрої власника
 * й підставляються, коли мережі немає. Лише ці запити; дані HR / адміна на пристрої не кешуються (DD-13).
 */
const PREFIX = 'cache:'
const keyOf = (userId: number, key: QueryKey) => `${PREFIX}${userId}:${JSON.stringify(key)}`

export function persistCandidateQueries(qc: QueryClient, userId: number, keys: QueryKey[]): () => void {
  const wanted = new Set(keys.map((k) => JSON.stringify(k)))
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const id = JSON.stringify(event.query.queryKey)
    if (wanted.has(id))
      void idb.set(keyOf(userId, event.query.queryKey), event.query.state.data).catch(() => {})
  })
}

/** Підставляє збережені копії в кеш запитів, якщо свіжих даних ще немає. */
export async function hydrateCandidateQueries(qc: QueryClient, userId: number, keys: QueryKey[]) {
  for (const key of keys) {
    if (qc.getQueryData(key) !== undefined) continue
    const saved = await idb.get<unknown>(keyOf(userId, key)).catch(() => undefined)
    if (saved !== undefined && qc.getQueryData(key) === undefined) qc.setQueryData(key, saved)
  }
}

/** Прибирає копії даних (вихід із кабінету на спільному пристрої). Невідправлені відповіді лишаються в черзі свого власника. */
export async function clearPersistedCache() {
  const items = await idb.list<unknown>(PREFIX).catch(() => [])
  if (items.length) await idb.deleteByPrefix(PREFIX).catch(() => {})
}
