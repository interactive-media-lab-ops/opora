/** Шапка картки кандидата: етап, вердикт, дати, методологія. */
import { Clock } from 'lucide-react'
import type { DetailBase } from '../api/types'
import { STAGE_DEFAULT } from '../lib/stages'
import { AudioPlayer } from './AudioPlayer'
import { Alert, Badge, Card, STAGE_LABEL, STAGE_TONE, VERDICT_LABEL, VERDICT_TONE, fmtDate } from './ui'

/** Типові назви розділів профілю (D-73, `lib/stages.ts`); задані методологом — `sectionTitles(d)` (BR-4). */
export const SECTION_TITLE = {
  profile: STAGE_DEFAULT.PROFILE,
  quiz: STAGE_DEFAULT.QUIZ,
  voice: STAGE_DEFAULT.INTERVIEW,
  recommendations: STAGE_DEFAULT.RECOMMENDATIONS,
} as const

export function sectionTitles(d: {
  stage_titles?: Partial<Record<'PROFILE' | 'QUIZ' | 'INTERVIEW', string>>
}) {
  const t = d.stage_titles ?? {}
  return {
    ...SECTION_TITLE,
    profile: t.PROFILE || SECTION_TITLE.profile,
    quiz: t.QUIZ || SECTION_TITLE.quiz,
    voice: t.INTERVIEW || SECTION_TITLE.voice,
  }
}

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—'
  return Array.isArray(value) ? value.join(', ') : String(value)
}

export function CandidateHeader({ d }: { d: DetailBase }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-muted-foreground">
      <span>{d.candidate_email}</span>
      <span>·</span>
      <span>{d.methodology_title}</span>
      <span>·</span>
      <span>Подано: {fmtDate(d.submitted_at)}</span>
      <Badge tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</Badge>
      {d.verdict && <Badge tone={VERDICT_TONE[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>}
      {d.summary_score !== null && <Badge tone="slate">Зведений бал: {d.summary_score}</Badge>}
    </div>
  )
}

export function CandidateAnswers({ d, showErrors }: { d: DetailBase; showErrors?: boolean }) {
  const titles = sectionTitles(d)
  return (
    <div className="grid gap-4">
      <Card title={titles.profile}>
        <dl className="m-0 grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] gap-x-4 gap-y-2 max-sm:grid-cols-1">
          {d.profile.map((p) => (
            <div key={p.label} className="contents">
              <dt className="text-label text-foreground-tertiary">{p.label}</dt>
              <dd className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] max-sm:mb-2">
                {formatValue(p.value)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {d.quiz.length > 0 && (
        <Card title={titles.quiz} meta={`${d.quiz.length} відповідей`}>
          <ul className="m-0 grid list-none gap-3 p-0">
            {d.quiz.map((q) => (
              <li key={q.question}>
                <div className="text-label text-foreground-tertiary">{q.question}</div>
                <div className="font-medium">{formatValue(q.value)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d.voice.length > 0 && (
        <Card title={titles.voice} meta={`${d.voice.length} відповідей`}>
          <div className="grid gap-3">
            {d.voice.map((v) => (
              <Card key={v.voice_answer_id} sunken>
                <div className="font-medium">{v.question}</div>
                {v.kind === 'TEXT' ? (
                  <div>
                    <Badge tone="slate">Текстова відповідь</Badge>
                  </div>
                ) : (
                  <AudioPlayer voiceAnswerId={v.voice_answer_id} />
                )}
                {v.transcript_status === 'DONE' ? (
                  <p className="m-0 whitespace-pre-wrap rounded-card border border-border bg-card p-3 text-meta">
                    {v.transcript || (v.kind === 'TEXT' ? '(порожня відповідь)' : '(порожній транскрипт)')}
                  </p>
                ) : v.transcript_status === 'FAILED' ? (
                  <Alert variant="danger">
                    Транскрипт: не вдалося отримати
                    {showErrors && v.transcript_error ? ` — ${v.transcript_error}` : ''}
                  </Alert>
                ) : (
                  <div>
                    <Badge tone="slate" icon={Clock}>
                      Транскрипт готується
                    </Badge>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
