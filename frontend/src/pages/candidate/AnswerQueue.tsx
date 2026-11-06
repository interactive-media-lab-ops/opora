/** Офлайн-черга відповідей кандидата: зберігає локально, надсилає при появі зв'язку. */
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ApiError, api } from '../../api/client'
import { useAuth } from '../../auth'
import { useOnline } from '../../lib/online'
import { hydrateCandidateQueries, persistCandidateQueries } from '../../lib/persist'
import type { CandidateAssessment } from '../../api/types'
import { idb } from '../../lib/idb'
import { ASSESSMENT_KEY, RECOMMENDATIONS_KEY } from './keys'

export type QueueStatus = 'local' | 'sending' | 'failed'

export interface QueueItem {
  key: string // `${userId}:${assessmentId}:${questionId}` — на питання одна «найсвіжіша» відповідь
  userId: number // відповіді належать власнику: інший користувач цього пристрою їх не бачить і не відправляє
  assessmentId: number
  questionId: number
  kind: 'TEXT' | 'VOICE'
  text?: string
  blob?: Blob
  filename?: string
  duration?: number
  requestId: string
  status: QueueStatus
  error?: string
  fatal?: boolean // помилка від сервера (не обрив зв'язку): автоповтор не допоможе
}

interface QueueApi {
  online: boolean
  items: Record<number, QueueItem> // за id питання
  /** Остання відправка етапу відкладена до появи зв'язку / спорожнення черги. */
  submitPending: boolean
  enqueueText: (assessmentId: number, questionId: number, text: string) => void
  enqueueVoice: (assessmentId: number, questionId: number, file: File, duration: number) => void
  retry: (questionId: number) => void
  requestSubmit: (assessmentId: number) => void
}

const Ctx = createContext<QueueApi | null>(null)
export const useAnswerQueue = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAnswerQueue поза AnswerQueueShell')
  return c
}

const PREFIX = 'queue:'
const SUBMIT_KEY = 'submit:'
const CACHED_KEYS = [ASSESSMENT_KEY, RECOMMENDATIONS_KEY]
const rid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
const isNetworkError = (e: unknown) => !(e instanceof ApiError)

/**
 * Черга відповідей розмови (D-06, DD-13): відповідь спершу зберігається на пристрої (IndexedDB) і лише потім
 * відправляється; без зв'язку чекає й іде автоматично. Повтор запиту ідемпотентний (client_request_id).
 * Працює на всіх сторінках кабінету кандидата. Відкриття застосунку без мережі (PWA) — окремий крок.
 */
export function AnswerQueueShell() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? 0
  const online = useOnline()
  const [items, setItems] = useState<Record<number, QueueItem>>({})
  const [submitFor, setSubmitFor] = useState<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const busy = useRef(false)

  const patch = useCallback((qid: number, changes: Partial<QueueItem>, onlyRequestId?: string) => {
    setItems((cur) => {
      const item = cur[qid]
      if (!item || (onlyRequestId && item.requestId !== onlyRequestId)) return cur
      const next = { ...item, ...changes }
      void idb.set(PREFIX + item.key, next).catch(() => {})
      return { ...cur, [qid]: next }
    })
  }, [])

  // відновлення черги після перезавантаження сторінки — лише відповіді поточного користувача
  useEffect(() => {
    let alive = true
    setItems({})
    setSubmitFor(null)
    if (!userId) return
    void idb
      .list<QueueItem>(`${PREFIX}${userId}:`)
      .then((list) => {
        if (!alive) return
        const restored: Record<number, QueueItem> = {}
        for (const it of list)
          restored[it.questionId] = { ...it, status: it.status === 'sending' ? 'local' : it.status }
        setItems((cur) => ({ ...restored, ...cur }))
      })
      .catch(() => {})
    void idb
      .get<number>(SUBMIT_KEY + userId)
      .then((v) => alive && v && setSubmitFor(v))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [userId])

  // офлайн-копія кабінету: зберігаємо останні відповіді сервера й підставляємо, коли мережі немає (D-18)
  useEffect(() => {
    if (!userId) return
    void hydrateCandidateQueries(qc, userId, CACHED_KEYS)
    void navigator.storage?.persist?.().catch(() => {}) // просимо браузер не витісняти дані (D-34)
    return persistCandidateQueries(qc, userId, CACHED_KEYS)
  }, [qc, userId])

  const flush = useCallback(async () => {
    if (busy.current || !navigator.onLine) return
    busy.current = true
    try {
      for (const item of Object.values(itemsRef.current)) {
        if (item.fatal || item.status === 'sending') continue
        patch(item.questionId, { status: 'sending', error: undefined }, item.requestId)
        try {
          let data: CandidateAssessment
          if (item.kind === 'TEXT') {
            data = await api.post<CandidateAssessment>(
              `/candidate/assessment/interview/${item.questionId}/text`,
              { text: item.text, client_request_id: item.requestId },
            )
          } else {
            const form = new FormData()
            form.append(
              'file',
              new File([item.blob!], item.filename ?? 'answer.webm', { type: item.blob!.type }),
            )
            form.append('duration_sec', String(item.duration ?? 1))
            form.append('client_request_id', item.requestId)
            data = await api.upload<CandidateAssessment>(
              `/candidate/assessment/interview/${item.questionId}/audio`,
              form,
            )
          }
          qc.setQueryData(ASSESSMENT_KEY, data)
          setItems((cur) => {
            // якщо за час відправки відповідь замінили — лишаємо нову
            if (cur[item.questionId]?.requestId !== item.requestId) return cur
            const { [item.questionId]: _done, ...rest } = cur
            return rest
          })
          void idb.delete(PREFIX + item.key).catch(() => {})
        } catch (e) {
          if (isNetworkError(e))
            patch(item.questionId, { status: 'failed', error: 'Немає зв’язку із сервером' }, item.requestId)
          else
            patch(
              item.questionId,
              {
                status: 'failed',
                fatal: true,
                error: e instanceof Error ? e.message : 'Не вдалося надіслати',
              },
              item.requestId,
            )
          break // порядок зберігаємо: наступні відповіді чекають
        }
      }
    } finally {
      busy.current = false
    }
  }, [patch, qc])

  // надсилаємо, коли є зв'язок і щось чекає; повторюємо, поки не вдасться
  useEffect(() => {
    const waiting = Object.values(items).some((i) => !i.fatal && i.status !== 'sending')
    if (!waiting || !online) return
    void flush()
    const t = window.setInterval(() => void flush(), 10000)
    return () => window.clearInterval(t)
  }, [items, online, flush])

  // відкладена подача етапу: коли черга порожня й зв'язок є
  useEffect(() => {
    if (submitFor === null || !online || Object.keys(items).length > 0) return
    const aid = submitFor
    void (async () => {
      try {
        const data = await api.post<CandidateAssessment>('/candidate/assessment/interview/submit')
        qc.setQueryData(ASSESSMENT_KEY, data)
      } catch (e) {
        // 409 — уже подано (повтор після обриву): це успіх; інша серверна помилка — знімаємо прапорець, кандидат побачить стан у хабі
        if (!isNetworkError(e)) await qc.invalidateQueries({ queryKey: ASSESSMENT_KEY })
        else return
      }
      setSubmitFor((cur) => (cur === aid ? null : cur))
      void idb.delete(SUBMIT_KEY + userId).catch(() => {})
    })()
  }, [submitFor, online, items, qc, userId])

  const put = useCallback((item: QueueItem) => {
    setItems((cur) => ({ ...cur, [item.questionId]: item }))
    void idb.set(PREFIX + item.key, item).catch(() => {})
  }, [])

  const value = useMemo<QueueApi>(
    () => ({
      online,
      items,
      submitPending: submitFor !== null,
      enqueueText: (assessmentId, questionId, text) =>
        put({
          key: `${userId}:${assessmentId}:${questionId}`,
          userId,
          assessmentId,
          questionId,
          kind: 'TEXT',
          text,
          requestId: rid(),
          status: 'local',
        }),
      enqueueVoice: (assessmentId, questionId, file, duration) =>
        put({
          key: `${userId}:${assessmentId}:${questionId}`,
          userId,
          assessmentId,
          questionId,
          kind: 'VOICE',
          blob: file,
          filename: file.name,
          duration,
          requestId: rid(),
          status: 'local',
        }),
      retry: (questionId) => patch(questionId, { status: 'local', fatal: false, error: undefined }),
      requestSubmit: (assessmentId) => {
        setSubmitFor(assessmentId)
        void idb.set(SUBMIT_KEY + userId, assessmentId).catch(() => {})
      },
    }),
    [online, items, submitFor, put, patch, userId],
  )

  return (
    <Ctx.Provider value={value}>
      <Outlet />
    </Ctx.Provider>
  )
}
