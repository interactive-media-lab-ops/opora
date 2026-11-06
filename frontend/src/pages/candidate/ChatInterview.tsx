/** Голосове інтерв'ю у форматі чату: питання → запис → статус надсилання. */
import { Check, CheckCircle2, Mic, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CandidateAssessment } from '../../api/types'
import { AudioRecorder, type Clip, type Phase } from '../../components/AudioRecorder'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Field,
  Icon,
  Lead,
  StatusText,
  Textarea,
  cx,
  type StageStatusKey,
} from '../../components/ui'
import { useAnswerQueue, type QueueItem } from './AnswerQueue'
import { OfflineBanner } from './OfflineBanner'

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

interface Effective {
  kind: 'TEXT' | 'VOICE'
  text: string
  duration: number
  item?: QueueItem
}

function LocalAudio({ blob }: { blob: Blob }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <audio controls src={url} className="w-full max-w-64" />
}

/** Статус черги під відповіддю (45A, схема C): слово + іконка; помилка — danger з причиною і «Повторити». */
function StatusLine({
  answer,
  online,
  onRetry,
}: {
  answer: Effective
  online: boolean
  onRetry: () => void
}) {
  const it = answer.item
  let status: StageStatusKey = 'sent'
  let word = 'Надіслано'
  if (it?.status === 'sending') {
    status = 'sending'
    word = 'Надсилається'
  } else if (it?.status === 'failed') {
    status = 'error'
    word = 'Не вдалося надіслати'
  } else if (it) {
    status = 'on-device'
    word = online ? 'Збережено на пристрої' : 'Збережено на пристрої, надішлеться, коли з’явиться зв’язок'
  }
  const failed = it?.status === 'failed'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusText size="sm" status={status} word={failed && it?.error ? `${word} — ${it.error}` : word} />
      {failed && it?.fatal && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Повторити
        </Button>
      )}
    </span>
  )
}

/** C4b: «Усе успішно» (D-36); без зв'язку — «Збережено на пристрої» (53A). Одна навігаційна дія «На головну», без підказок і без
 * «Відкрити рекомендації» (рев'ю власника 11-03, змінює D-48); наступного кроку немає — тому другорядна (DD-37). */
function Finished({ saved, stageTitle }: { saved: boolean; stageTitle: string }) {
  const navigate = useNavigate()
  return (
    <div className="grid gap-6 pt-6 max-sm:pt-2">
      <div className="grid justify-items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-card border border-status-success-text bg-status-success-bg text-status-success-text"
        >
          <Check size={32} strokeWidth={2} />
        </span>
        <h1 className="m-0 text-h1">{saved ? 'Усе успішно' : 'Збережено на пристрої'}</h1>
        <Lead>
          {saved
            ? 'Розмову завершено, дані збережено'
            : 'Розмову завершено. Надішлемо, щойно з’явиться зв’язок'}
        </Lead>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-meta text-muted-foreground">Етап «{stageTitle}»:</span>
          <StatusText status={saved ? 'sent' : 'on-device'} />
        </div>
        <p className="m-0 max-w-[72ch] text-meta text-muted-foreground">
          Розмову можна пройти заново будь-коли; попереднє проходження зберігається, HR бачить останнє. Своєї
          оцінки ви не побачите — лише статуси етапів
        </p>
      </div>
      <ActionGroup>
        <Button variant="secondary" onClick={() => navigate('/candidate')}>
          На головну
        </Button>
      </ActionGroup>
    </div>
  )
}

/** Етап «Розмова» (C4, D-63, 43A): питання по одному у вигляді чату, відповідь текстом або голосом, офлайн-черга (45A). */
export function ChatInterview({ a }: { a: CandidateAssessment }) {
  const queue = useAnswerQueue()
  const questions = a.interview_questions
  const stage = a.stages.find((s) => s.key === 'INTERVIEW')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [clip, setClip] = useState<Clip | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [recorderKey, setRecorderKey] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const end = useRef<HTMLLIElement>(null)

  const effective = (qid: number): Effective | null => {
    const it = queue.items[qid]
    if (it) return { kind: it.kind, text: it.text ?? '', duration: it.duration ?? 0, item: it }
    const v = a.voice.find((x) => x.question_id === qid)
    return v?.kind ? { kind: v.kind as 'TEXT' | 'VOICE', text: v.text, duration: v.duration_sec } : null
  }

  const firstOpen = questions.findIndex((q) => !effective(q.id))
  const allAnswered = firstOpen === -1
  const activeId = editing ?? (allAnswered ? null : questions[firstOpen].id)
  const active = questions.find((q) => q.id === activeId)
  const status = a.voice.find((v) => v.question_id === activeId)
  const submitted = stage?.status === 'SUBMITTED'
  const lastCount = Object.keys(queue.items).length + a.voice.length // для прокрутки до нового повідомлення

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [lastCount, activeId])

  if (submitted || queue.submitPending)
    return <Finished saved={submitted} stageTitle={stage?.title ?? 'Розмова'} />

  const visible = questions.filter((q, i) => effective(q.id) || i === firstOpen || q.id === editing)
  const answeredCount = questions.filter((q) => effective(q.id)).length
  const current = Math.min(answeredCount + (allAnswered ? 0 : 1), questions.length)
  const waiting = Object.keys(queue.items).length

  function resetComposer() {
    setDraft('')
    setEditing(null)
    setClip(null)
    setRecorderKey((k) => k + 1)
  }

  function send() {
    if (!active) return
    if (clip) queue.enqueueVoice(a.id, active.id, clip.file, clip.duration)
    else if (draft.trim()) queue.enqueueText(a.id, active.id, draft.trim())
    else return
    resetComposer()
  }

  function startEdit(qid: number) {
    const e = effective(qid)
    setEditing(qid)
    setClip(null)
    setRecorderKey((k) => k + 1)
    setDraft(e?.kind === 'TEXT' ? e.text : '')
  }

  const canRecord = status ? status.can_record : true
  const maxSec = active?.max_duration_sec ?? 0
  const canSend = phase !== 'recording' && (Boolean(clip) || Boolean(draft.trim()))
  const sendHint =
    phase === 'recording'
      ? 'Спочатку зупиніть запис'
      : clip
        ? draft.trim()
          ? 'Надішлемо голосову відповідь; текст не збережеться'
          : 'Запис піде як відповідь'
        : draft.trim()
          ? 'Відповідь збережеться й надішлеться'
          : 'Напишіть або запишіть відповідь'

  return (
    <div className="grid gap-4">
      <OfflineBanner />
      <div className="grid gap-1">
        <p className="m-0 text-label text-foreground-tertiary">
          Питання {current} з {questions.length}
        </p>
        {queue.online && waiting === 0 && (
          <p className="m-0 flex items-center gap-2 text-label text-muted-foreground" role="status">
            <Icon icon={CheckCircle2} size={16} className="text-status-success-text" />
            Зв’язок є · відповіді надсилаються одразу
          </p>
        )}
      </div>

      <ol
        role="log"
        aria-live="polite"
        aria-label="Хід розмови"
        className="m-0 flex min-w-0 list-none flex-col gap-2 p-0"
      >
        {visible.map((q) => {
          const ans = effective(q.id)
          return (
            <li key={q.id} className="contents">
              <div className="flex max-w-[85%] min-w-0 flex-col items-start gap-1 self-start max-sm:max-w-[92%]">
                <div className="grid max-w-full gap-2 rounded-card bg-muted px-4 py-3 text-[0.9375rem]">
                  <p className="m-0 font-semibold leading-[1.35]">{q.text}</p>
                  {q.hint && <p className="m-0 text-meta text-muted-foreground">{q.hint}</p>}
                </div>
              </div>
              {ans && (
                <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1 self-end max-sm:max-w-[92%]">
                  <div className="grid max-w-full gap-2 rounded-card border border-border bg-card px-4 py-3 text-[0.9375rem]">
                    {ans.kind === 'TEXT' ? (
                      <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{ans.text}</p>
                    ) : (
                      <>
                        <span className="inline-flex items-start gap-2.5 font-medium">
                          <Icon icon={Mic} size={16} className="mt-[3px]" />
                          <span>
                            Голосова відповідь{ans.duration ? ` · ${fmt(ans.duration)}` : ''}
                            {q.max_duration_sec ? ` з ${fmt(q.max_duration_sec)}` : ''}
                          </span>
                        </span>
                        {ans.item?.blob && <LocalAudio blob={ans.item.blob} />}
                      </>
                    )}
                  </div>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-1 text-caption text-foreground-tertiary">
                    <StatusLine answer={ans} online={queue.online} onRetry={() => queue.retry(q.id)} />
                    {editing !== q.id && (
                      <Button size="sm" variant="ghost" onClick={() => startEdit(q.id)}>
                        Змінити відповідь
                      </Button>
                    )}
                  </span>
                </div>
              )}
            </li>
          )
        })}
        <li ref={end} aria-hidden="true" />
      </ol>

      {active ? (
        <section
          aria-label="Ваша відповідь"
          className="grid gap-2 max-sm:sticky max-sm:bottom-0 max-sm:z-(--op-z-sticky) max-sm:-mx-4 max-sm:bg-background max-sm:px-4 max-sm:py-2 max-sm:shadow-[0_-1px_0_var(--border)]"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 max-sm:hidden">
            <h2 className="m-0 text-base font-semibold leading-[1.3]">Ваша відповідь</h2>
            {maxSec > 0 && (
              <span className="text-label text-foreground-tertiary">
                голосом — до {fmt(maxSec)} на одне питання
              </span>
            )}
          </div>
          <div
            role="group"
            aria-label={`Відповідь на питання: ${active.text}`}
            className="grid min-w-0 gap-3 rounded-card border border-border bg-card p-(--gap) max-sm:gap-2 max-sm:p-3"
          >
            {editing !== null && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-muted-foreground">
                <span>
                  Змінюєте відповідь на питання {questions.findIndex((q) => q.id === editing) + 1}. Нова
                  відповідь замінить попередню.
                </span>
                <Button size="sm" variant="ghost" onClick={resetComposer}>
                  Скасувати
                </Button>
              </div>
            )}
            <Field label="Відповідь текстом" className="max-sm:[&>label]:sr-only">
              <Textarea
                rows={3}
                placeholder="Напишіть відповідь або натисніть «Голос»"
                value={draft}
                maxLength={10000}
                onChange={(e) => setDraft(e.target.value)}
                className="max-sm:h-[4.25rem] max-sm:min-h-0"
              />
            </Field>
            <div
              className={cx(
                'flex flex-wrap items-start justify-between gap-x-6 gap-y-3',
                phase === 'idle' && 'max-sm:flex-nowrap max-sm:items-center max-sm:gap-2',
              )}
            >
              <AudioRecorder
                key={`${active.id}-${recorderKey}`}
                inline
                maxDurationSec={active.max_duration_sec}
                uploading={false}
                disabledReason={canRecord ? undefined : 'Ліміт спроб запису вичерпано'}
                onChange={(c, p) => (setClip(c), setPhase(p))}
                onSubmit={() => send()}
              />
              <div
                className={cx(
                  'ml-auto flex min-w-0 justify-end',
                  phase === 'idle' ? 'max-sm:ml-0 max-sm:flex-1' : 'max-sm:w-full',
                )}
              >
                <Act hint={sendHint} align="end" hintClassName="max-sm:sr-only" className="max-sm:flex-1">
                  <Button
                    icon={Send}
                    aria-disabled={!canSend || undefined}
                    onClick={() => canSend && send()}
                    className="min-w-[12.5rem] max-sm:min-w-0 max-sm:px-3"
                  >
                    Надіслати
                  </Button>
                </Act>
              </div>
            </div>
            {/* «спроб запису залишилось: N» — поза анатомією C4 (інвентар §8.6, відкрите питання); рядок коду лишається, лише стиль */}
            {status && status.attempts_left < a.max_record_attempts && (
              <p className="m-0 text-caption text-foreground-tertiary max-sm:hidden">
                Спроб запису залишилось: {status.attempts_left}.
              </p>
            )}
          </div>
        </section>
      ) : (
        <div className="grid gap-4">
          <Alert variant="success">
            Ви відповіли на всі питання. Перевірте відповіді (їх можна змінити) і надішліть розмову.
          </Alert>
          <ActionGroup>
            <Act hint="Після надсилання змінити відповіді можна лише пройшовши розмову заново">
              <Button onClick={() => setConfirm(true)}>Надіслати розмову</Button>
            </Act>
          </ActionGroup>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title="Надіслати розмову?"
        description="Після надсилання змінити відповіді можна лише пройшовши розмову заново."
        confirmLabel="Надіслати"
        onCancel={() => setConfirm(false)}
        onConfirm={() => (setConfirm(false), queue.requestSubmit(a.id))}
      />
    </div>
  )
}
