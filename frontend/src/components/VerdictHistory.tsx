/** Журнал змін вердикту. */
import { ChevronDown } from 'lucide-react'
import type { AssessmentEvent, VerdictChange } from '../api/types'
import { STAGE_DEFAULT, STAGE_DEFAULT_ACC } from '../lib/stages'
import { AudioPlayer } from './AudioPlayer'
import { Badge, Icon, VERDICT_LABEL, VERDICT_TONE, fmtDate } from './ui'

const plural = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'запис'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'записи'
  return 'записів'
}

// назви етапів — з хелпера D-73 (`lib/stages.ts`): STAGE_DEFAULT (називний), STAGE_DEFAULT_ACC (знахідний)
const STAGE_NAME = STAGE_DEFAULT_ACC
const STAGE_TITLE = STAGE_DEFAULT

function VerdictTag({ value }: { value: VerdictChange['new_verdict'] }) {
  return value ? (
    <Badge tone={VERDICT_TONE[value]}>{VERDICT_LABEL[value]}</Badge>
  ) : (
    <Badge tone="slate">Без вердикту</Badge>
  )
}

function Frame({ who, at, children }: { who: string; at: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-label text-foreground-tertiary">
        <span className="font-medium text-foreground">{who}</span>
        <time dateTime={at} className="tabular-nums">
          {fmtDate(at)}
        </time>
      </div>
      {children}
    </li>
  )
}

function VerdictEntry({ c }: { c: VerdictChange }) {
  const verdictChanged = c.old_verdict !== c.new_verdict
  const noteChanged = c.old_note !== c.new_note
  return (
    <Frame who={c.author_name ?? 'Видалений користувач'} at={c.changed_at}>
      {verdictChanged && (
        <div className="flex flex-wrap items-center gap-2 text-meta">
          <span className="text-muted-foreground">Вердикт:</span>
          <VerdictTag value={c.old_verdict} />
          <span aria-label="змінено на">→</span>
          <VerdictTag value={c.new_verdict} />
        </div>
      )}
      {noteChanged && (
        <div className="grid gap-1 text-meta">
          <span className="text-muted-foreground">
            {c.new_note ? (c.old_note ? 'Нотатку змінено:' : 'Нотатку додано:') : 'Нотатку видалено'}
          </span>
          {c.old_note && (
            <p className="m-0 whitespace-pre-wrap rounded-card bg-muted p-2 text-muted-foreground line-through [overflow-wrap:anywhere]">
              {c.old_note}
            </p>
          )}
          {c.new_note && (
            <p className="m-0 whitespace-pre-wrap rounded-card bg-muted p-2 [overflow-wrap:anywhere]">
              {c.new_note}
            </p>
          )}
        </div>
      )}
    </Frame>
  )
}

type SnapshotAnswer = {
  question: string
  value?: unknown
  transcript?: string
  duration_sec?: number
  attempts_used?: number
  audio?: string | null
}

const fmtValue = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v)

function EventEntry({ e }: { e: AssessmentEvent }) {
  const stage = e.stage
  const v = e.methodology_version ? ` · методологія v${e.methodology_version}` : ''
  const d = (e.details ?? {}) as {
    changes?: { field: string; old: string; new: string }[]
    answers?: SnapshotAnswer[]
    attempts_reset?: { question: string; attempts_used: number }[]
    reason?: string
  }

  let title = ''
  if (e.kind === 'STAGE_SUBMITTED' && stage) title = `Кандидат надіслав етап «${STAGE_TITLE[stage]}»${v}`
  else if (e.kind === 'STAGE_UPDATED' && stage) title = `Кандидат змінив ${STAGE_NAME[stage]}${v}`
  else if (e.kind === 'STAGE_RETAKEN' && stage)
    title = `Кандидат почав проходити «${STAGE_TITLE[stage]}» заново${v}. Попередню спробу збережено`
  else if (e.kind === 'ANALYSIS_RESTARTED') title = `Аналіз перезапущено${d.reason ? `: ${d.reason}` : ''}`
  else title = e.kind

  return (
    <Frame who="Кандидат" at={e.created_at}>
      <p className="m-0 text-meta">{title}</p>
      {d.changes && d.changes.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0 text-meta">
          {d.changes.map((c, i) => (
            <li key={i} className="grid gap-1">
              <span className="text-label text-foreground-tertiary">{c.field}</span>
              <span className="[overflow-wrap:anywhere]">
                <span className="text-muted-foreground line-through">{c.old || '—'}</span> → {c.new || '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.attempts_reset && d.attempts_reset.length > 0 && (
        <p className="m-0 text-label text-foreground-tertiary">
          Лічильник спроб запису скинуто:{' '}
          {d.attempts_reset.map((a) => `«${a.question}» — було ${a.attempts_used}`).join('; ')}
        </p>
      )}
      {e.kind === 'STAGE_RETAKEN' && d.answers && (
        <details className="group rounded-card bg-muted px-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-label hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="flex-1">Попередня спроба</span>
            <Icon icon={ChevronDown} size={16} className="transition-transform group-open:rotate-180" />
          </summary>
          <dl className="m-0 grid gap-2 pb-3 text-meta">
            {d.answers.map((a, i) => (
              <div key={i} className="grid gap-0.5">
                <dt className="text-label text-foreground-tertiary">{a.question}</dt>
                <dd className="m-0 grid gap-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {a.audio && <AudioPlayer path={`/audio/archive/${e.id}/${i}`} />}
                  {a.transcript !== undefined ? a.transcript || '(транскрипт відсутній)' : fmtValue(a.value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </Frame>
  )
}

/** Історія змін (лише HR / методист, D-56): зміни вердикту й нотаток та події проходження — разом, від нових до старих. */
export function VerdictHistory({
  history,
  events = [],
}: {
  history: VerdictChange[]
  events?: AssessmentEvent[]
}) {
  const items = [
    ...history.map((h) => ({ at: h.changed_at, key: `v${h.id}`, node: <VerdictEntry c={h} /> })),
    ...events.map((e) => ({ at: e.created_at, key: `e${e.id}`, node: <EventEntry e={e} /> })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return (
    <details className="group rounded-card border border-border bg-card px-(--gap)">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 font-medium hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="flex-1">Історія змін</span>
        <span className="text-label font-normal tabular-nums text-foreground-tertiary">
          {items.length} {plural(items.length)}
        </span>
        <Icon icon={ChevronDown} className="transition-transform group-open:rotate-180" />
      </summary>
      {items.length === 0 ? (
        <p className="m-0 pb-4 text-meta text-muted-foreground">Змін ще не було.</p>
      ) : (
        <ol className="m-0 list-none p-0 pb-1">
          {items.map((i) => (
            <span key={i.key} className="contents">
              {i.node}
            </span>
          ))}
        </ol>
      )}
    </details>
  )
}
