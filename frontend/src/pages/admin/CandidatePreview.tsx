/** Адмін: перегляд кабінету кандидата від його імені. */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Methodology, MethodologyListItem, Stage } from '../../api/types'
import { AudioRecorder } from '../../components/AudioRecorder'
import { Check, CheckCircle2 } from 'lucide-react'
import {
  Act,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Icon,
  PageHeader,
  Select,
  Spinner,
  STAGE_LABEL,
  STAGE_TONE,
} from '../../components/ui'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { ProfileInput, QuizInput, Stepper } from '../candidate/steps'
import { stageTitle } from '../../lib/stages'

type Recorded = { url: string; duration: number }
// режим перегляду ходить по етапах послідовно; це лише сценарій перегляду, а не стан реального кандидата
type PreviewStep = 'PROFILE' | 'QUIZ' | 'INTERVIEW' | 'DONE'

function Preview({ m, onRestart }: { m: Methodology; onRestart: () => void }) {
  const hasQuiz = m.quiz_questions.length > 0
  const hasInterview = m.interview_questions.length > 0
  const [stage, setStage] = useState<PreviewStep>('PROFILE')
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [quiz, setQuiz] = useState<Record<string, unknown>>({})
  const [recorded, setRecorded] = useState<Record<number, Recorded>>({})
  const [index, setIndex] = useState(0)

  useEffect(() => () => Object.values(recorded).forEach((r) => URL.revokeObjectURL(r.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const after = (current: PreviewStep): PreviewStep => {
    if (current === 'PROFILE') return hasQuiz ? 'QUIZ' : hasInterview ? 'INTERVIEW' : 'DONE'
    if (current === 'QUIZ') return hasInterview ? 'INTERVIEW' : 'DONE'
    return 'DONE'
  }

  const steps: string[] = [
    'PROFILE',
    ...(hasQuiz ? ['QUIZ'] : []),
    ...(hasInterview ? ['INTERVIEW'] : []),
    'DONE',
  ]
  const q = m.interview_questions[index]

  return (
    <div className="mx-auto max-w-2xl">
      <Alert
        variant="warning"
        className="mb-5"
        actions={
          <Button variant="secondary" size="sm" onClick={onRestart}>
            Вибрати іншу методологію
          </Button>
        }
      >
        Режим перегляду: так бачить кабінет кандидат. Відповіді й записи ніде не зберігаються.
      </Alert>
      <h1 className="m-0 mb-6 text-h1 max-sm:text-h1-mobile">{m.title}</h1>
      <Stepper steps={steps} current={stage} />

      {stage === 'PROFILE' && (
        <Card title={stageTitle('PROFILE')}>
          {m.profile_fields.map((f) => (
            <Field key={f.id} label={f.label} required={f.required}>
              <ProfileInput
                f={f}
                value={profile[f.id] ?? ''}
                onChange={(v) => setProfile((s) => ({ ...s, [f.id]: v }))}
              />
            </Field>
          ))}
          <div className="flex justify-end">
            <Button onClick={() => setStage(after('PROFILE'))}>Далі</Button>
          </div>
        </Card>
      )}

      {stage === 'QUIZ' && (
        <Card title={stageTitle('QUIZ')}>
          {m.quiz_questions.map((qq, i) => (
            <div key={qq.id} className="grid gap-2">
              <div className="font-medium">
                {i + 1}. {qq.text}
              </div>
              <QuizInput
                q={qq}
                value={quiz[qq.id]}
                onChange={(v) => setQuiz((s) => ({ ...s, [qq.id]: v }))}
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button onClick={() => setStage(after('QUIZ'))}>Далі</Button>
          </div>
        </Card>
      )}

      {stage === 'INTERVIEW' && q && (
        <Card title="Голосове інтерв’ю" meta={`Питання ${index + 1} з ${m.interview_questions.length}`}>
          <div className="grid gap-1">
            <p className="m-0 text-lg font-medium">{q.text}</p>
            {q.hint && <p className="m-0 text-meta text-muted-foreground">{q.hint}</p>}
          </div>
          {recorded[q.id] ? (
            <Card sunken>
              <Badge tone="green" icon={Check}>
                Відповідь записано (лише в цьому перегляді)
              </Badge>
              <audio controls src={recorded[q.id].url} className="w-full" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  URL.revokeObjectURL(recorded[q.id].url)
                  setRecorded((r) => {
                    const { [q.id]: _removed, ...rest } = r
                    return rest
                  })
                }}
              >
                Перезаписати
              </Button>
            </Card>
          ) : (
            <AudioRecorder
              key={q.id}
              maxDurationSec={q.max_duration_sec}
              uploading={false}
              onSubmit={(file, duration) =>
                setRecorded((r) => ({ ...r, [q.id]: { url: URL.createObjectURL(file), duration } }))
              }
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              ← Назад
            </Button>
            {index < m.interview_questions.length - 1 ? (
              <Button variant="secondary" onClick={() => setIndex(index + 1)}>
                Далі →
              </Button>
            ) : (
              <Button onClick={() => setStage('DONE')}>Завершити оцінювання</Button>
            )}
          </div>
        </Card>
      )}

      {stage === 'DONE' && (
        <Card className="items-center py-10 text-center">
          <Icon icon={CheckCircle2} size={48} className="text-status-success-text" />
          <h2 className="m-0 text-h2 font-semibold">Дякуємо! Ваші відповіді отримано</h2>
          <p className="m-0 max-w-md text-meta text-muted-foreground">
            Ви завершили оцінювання «{m.title}». Команда HR розгляне результати й зв’яжеться з вами. Більше
            нічого робити не потрібно.
          </p>
          <Button variant="secondary" onClick={onRestart}>
            Почати перегляд заново
          </Button>
        </Card>
      )}
    </div>
  )
}

interface DemoCandidate {
  id: number
  name: string
  email: string
  methodology_title: string | null
  stage: Stage | null
  stages_done: number | null
  stages_total: number | null
}

function DemoCandidates() {
  const { impersonate } = useAuth()
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const list = useQuery({
    queryKey: ['demo-candidates'],
    queryFn: () => api.get<DemoCandidate[]>('/users/demo-candidates'),
  })

  async function open(c: DemoCandidate) {
    setBusyId(c.id)
    setError(null)
    try {
      await impersonate(c.id)
      navigate('/candidate')
    } catch (err) {
      setError(err)
      setBusyId(null)
    }
  }

  return (
    <Card title="Увійти в кабінет демо-кандидата">
      <div>
        <p className="m-0 text-meta text-muted-foreground">
          Справжній кабінет кандидата з реальним збереженням: можна пройти етапи, записати голос, подати
          відповіді. Входити можна лише в демо-акаунти — справжніх кандидатів це не стосується.
        </p>
      </div>
      <ErrorBox error={error ?? list.error} />
      {list.isLoading && <Spinner />}
      {list.data && list.data.length === 0 && (
        <EmptyState>
          Демо-кандидатів немає. Запустіть сід: <code>python -m app.seed</code>.
        </EmptyState>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
          {list.data.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0 max-sm:basis-full">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-label text-foreground-tertiary">
                  {c.methodology_title ?? 'Без методології'} · {c.email}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {c.stage && (
                  <Badge tone={STAGE_TONE[c.stage]}>
                    {STAGE_LABEL[c.stage]}
                    {c.stage === 'IN_PROGRESS' && c.stages_total
                      ? ` · ${c.stages_done} / ${c.stages_total}`
                      : ''}
                  </Badge>
                )}
                {/* одна головна на екран: вхід у демо-кабінет — secondary, головна — «Відкрити перегляд» */}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyId === c.id}
                  aria-disabled={busyId !== null || undefined}
                  onClick={() => busyId === null && open(c)}
                >
                  Відкрити кабінет
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function CandidatePreview() {
  const list = useQuery({
    queryKey: ['methodologies'],
    queryFn: () => api.get<MethodologyListItem[]>('/methodologies'),
  })
  const [id, setId] = useState<string>('')
  const [started, setStarted] = useState(false)
  const full = useQuery({
    queryKey: ['methodology', id],
    queryFn: () => api.get<Methodology>(`/methodologies/${id}`),
    enabled: Boolean(id) && started,
  })

  if (started && full.isLoading) return <Spinner />
  if (started && full.data) {
    return <Preview key={full.data.id + String(started)} m={full.data} onRestart={() => setStarted(false)} />
  }

  return (
    <div>
      <PageHeader
        title="Кабінет кандидата"
        subtitle="Подивіться на платформу очима кандидата — по-справжньому або в режимі перегляду без збереження."
      />
      <div className="grid gap-6">
        <DemoCandidates />
        <ErrorBox error={list.error ?? full.error} />
        {list.isLoading && <Spinner />}
        {list.data && list.data.length === 0 && <EmptyState>Методологій ще немає.</EmptyState>}
        {list.data && list.data.length > 0 && (
          <Card title="Перегляд без збереження">
            <div>
              <p className="m-0 text-meta text-muted-foreground">
                Пройдіть будь-яку методологію (навіть чернетку) — відповіді й записи ніде не зберігаються.
              </p>
            </div>
            <Field label="Методологія">
              <Select value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">— оберіть —</option>
                {list.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} (
                    {m.status === 'ACTIVE' ? 'активна' : m.status === 'DRAFT' ? 'чернетка' : 'архів'})
                  </option>
                ))}
              </Select>
            </Field>
            <Act hint={id ? undefined : 'Оберіть методологію, щоб відкрити перегляд'} fluid={false}>
              <Button aria-disabled={!id || undefined} onClick={() => id && setStarted(true)}>
                Відкрити перегляд
              </Button>
            </Act>
          </Card>
        )}
      </div>
    </div>
  )
}
