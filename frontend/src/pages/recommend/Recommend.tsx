/** Публічна форма рекомендатора за посиланням. */
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Link2, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'
import type { PublicRecommendation } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MinimalHeader } from '../../components/Layout'
import { useOnline } from '../../lib/online'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Icon,
  Lead,
  Skeleton,
  StatusText,
  Textarea,
  cx,
} from '../../components/ui'

type Role = PublicRecommendation['roles'][number]['id']
type Step = 'intro' | 'role' | 'questions' | 'done' | 'declined'

/** Голос у відгуку (D-75, 91A): вмикається, коли API приймає аудіо на /r/:token і транскрипція йде лише через NearAI (X-26). */
const VOICE_ENABLED = false // TODO(backend-requests: D-75)

/** Пояснення ролей — приклад інтерфейсних текстів з моку R3 (D-33); самі ролі — з конфігурації (D-28, D-32). */
const ROLE_HINT: Record<Role, string> = {
  MANAGER: 'Людина працює у вашому підпорядкуванні',
  COLLEAGUE: 'Працюєте поруч, без підпорядкування',
  SUBORDINATE: 'Ця людина — ваш керівник',
}

const draftKey = (token: string) => `opora.recommend.${token}`

interface Draft {
  role: Role | null
  answers: Record<number, string>
  index: number
}

function loadDraft(token: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(token))
    if (raw) return JSON.parse(raw) as Draft
  } catch {
    /* чернетка недоступна — починаємо з нуля */
  }
  return { role: null, answers: {}, index: 0 }
}

/** Картка ролі (RadioCards КС): радіо 18 px + назва + пояснення; обрана — accent + border-accent. */
function RoleCard({
  name,
  value,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string
  value: string
  label: string
  hint?: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      className={cx(
        'flex min-h-14 cursor-pointer items-start gap-3 rounded-card border bg-card px-4 py-3 transition-colors duration-(--op-duration-fast) has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
        checked ? 'border-border-accent bg-accent' : 'border-border hover:border-input',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="op-radio mt-0.5 focus-visible:outline-0"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * Публічна сторінка відгуку (R1 → R3 → R4 → R5 / R5b; DD-39: 54B без кроків, 55C одне питання на екран, 56C «Недостатньо знаю людину»
 * четвертою карткою з підтвердженням). Без входу й без особистих даних кандидата на вступі (D-10); посилання одноразове (D-45, D-66).
 * Логіка (чернетка на пристрої, надсилання, відмова) — без змін.
 */
export function Recommend() {
  const { token = '' } = useParams()
  const [step, setStep] = useState<Step>('intro')
  const [draft, setDraft] = useState<Draft>(() => loadDraft(token))
  const [confirmDecline, setConfirmDecline] = useState(false)
  const online = useOnline()

  // сторінка з одноразовим ключем в адресі: не індексується й не передає адресу далі через Referer
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    const title = document.title
    document.title = 'Відгук — Опора'
    return () => {
      robots.remove()
      referrer.remove()
      document.title = title
    }
  }, [])

  const page = useQuery({
    queryKey: ['recommend', token],
    queryFn: () => api.get<PublicRecommendation>(`/recommend/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: Infinity,
  })

  const update = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      try {
        localStorage.setItem(draftKey(token), JSON.stringify(next))
      } catch {
        /* без чернетки на пристрої відгук усе одно можна надіслати */
      }
      return next
    })
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey(token))
    } catch {
      /* ignore */
    }
  }

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/recommend/${encodeURIComponent(token)}/submit`, {
        role: draft.role,
        answers: page.data!.questions.map((q) => ({ question_id: q.id, text: draft.answers[q.id] ?? '' })),
      }),
    onSuccess: () => (clearDraft(), setStep('done')),
  })
  const decline = useMutation({
    mutationFn: () => api.post(`/recommend/${encodeURIComponent(token)}/decline`),
    onSuccess: () => (clearDraft(), setConfirmDecline(false), setStep('declined')),
  })

  const status = page.error instanceof ApiError ? page.error.status : null
  const questions = page.data?.questions ?? []
  const idx = Math.min(draft.index, Math.max(questions.length - 1, 0))
  const q = questions[idx]
  const last = idx === questions.length - 1
  const currentText = q ? (draft.answers[q.id] ?? '') : ''
  // BR-15: необов'язкове питання можна пропустити; ліміт знаків — від методології (інакше 5 000)
  const isRequired = q?.required !== false
  const limit = q?.max_length ?? 5000
  const canNext = !isRequired || currentText.trim().length > 0
  const allFilled = useMemo(
    () =>
      questions.every((x) => x.required === false || (draft.answers[x.id] ?? '').trim().length > 0) &&
      questions.some((x) => (draft.answers[x.id] ?? '').trim().length > 0),
    [questions, draft.answers],
  )
  const roleLabel = page.data?.roles.find((r) => r.id === draft.role)?.label.toLowerCase()
  // ім’я та посада кандидата для R3 / R4 (мок; на вступі не показуємо — D-10); API віддає `candidate` (BR-14), але без нього рядка просто немає
  const cand = page.data?.candidate?.name ? page.data.candidate : null
  const person = cand ? (
    <>
      Людина: <strong className="font-medium text-foreground">{cand.name}</strong>
    </>
  ) : null
  const [decline4, setDecline4] = useState(false) // четверта картка «Недостатньо знаю людину» (56C) — обрана до підтвердження

  // стани посилання (патерн P, DD-39): 410 «використано» / «термін минув» — без головної (наступний крок поза системою); інше — «недійсне»
  const expired = status === 410 && page.error instanceof ApiError && page.error.reason === 'expired' // BR-2
  const sysState = page.isError
    ? status === 410
      ? expired
        ? {
            icon: Clock,
            title: 'Термін дії посилання минув',
            text: 'Посилання діяло 30 днів і більше не відкривається. Попросіть людину, яка його надіслала, про нове',
          }
        : {
            icon: CheckCircle2,
            title: 'Посилання вже використано',
            text: 'За цим посиланням відгук уже надіслано. Повернутися до відповідей або змінити їх не можна',
          }
      : {
          icon: Link2,
          title: 'Посилання недійсне',
          text: 'Перевірте, чи скопійовано адресу повністю. Якщо посилання надійшло в повідомленні — попросіть людину надіслати його ще раз',
        }
    : null

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MinimalHeader context={<span className="text-foreground">Відгук про колегу</span>} />
      <main className="mx-auto grid w-full max-w-[75rem] min-w-0 flex-1 content-start gap-6 px-6 py-6 max-sm:px-4">
        {page.isLoading && <Skeleton variant="rect" height={180} />}

        {sysState && (
          <div className="mx-auto mt-8 w-full max-w-[36rem] max-sm:mt-2">
            <EmptyState icon={sysState.icon} title={sysState.title} text={sysState.text} />
          </div>
        )}

        {page.data && step !== 'done' && step !== 'declined' && !online && (
          <Alert variant="warning" title="Немає зв’язку" role="status">
            Читати й відповідати можна: чернетка зберігається на цьому пристрої. Надіслати відгук вдасться,
            коли зв’язок з’явиться
          </Alert>
        )}

        {/* R1 — вступ: без імені кандидата (D-10); картка «Хто що бачить»; три кроки */}
        {page.data && step === 'intro' && (
          <>
            <section
              aria-labelledby="r1-title"
              className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-x-16 gap-y-8 max-sm:grid-cols-1 max-sm:gap-6"
            >
              <div className="grid min-w-0 gap-5">
                <h1 id="r1-title" className="m-0 max-w-[22ch] text-h1 text-pretty">
                  Вас просять дати відгук про людину
                </h1>
                <Lead>
                  Людина, яка вам довіряє, бере участь у відборі лідерів і надіслала вам це посилання. Відгук
                  збирає платформа «{page.data.organization}»
                  {person ? '. Її ім’я побачите після «Почати»' : ''}
                </Lead>
                <p className="m-0 text-meta text-muted-foreground">
                  Близько 10 хвилин. Ім’я чи інші особисті дані кандидата на цій сторінці не показуємо
                </p>
                <ActionGroup>
                  <Act hint="Далі — ваша роль щодо людини">
                    <Button onClick={() => setStep(draft.role ? 'questions' : 'role')}>Почати</Button>
                  </Act>
                </ActionGroup>
              </div>
              <Card title={<span className="text-h3">Хто що бачить</span>}>
                <dl className="m-0 grid gap-3">
                  {[
                    ['HR', 'Ваш відгук і роль, яку ви оберете, — але не ім’я'],
                    ['Людина, про яку відгук', 'Лише кількість отриманих відгуків — ні змісту, ні ролей'],
                    ['Ви', 'Після надсилання відгук переглянути чи змінити не можна'],
                  ].map(([dt, dd]) => (
                    <div key={dt} className="grid gap-0.5">
                      <dt className="text-label font-medium text-muted-foreground">{dt}</dt>
                      <dd className="m-0">{dd}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </section>
            <Card as="section" title="Як це працює" meta="три кроки">
              <ol className="m-0 grid list-none gap-4 p-0">
                {[
                  [
                    'Оберете, ким ви є для цієї людини',
                    `${page.data.roles
                      .map((r) => r.label.toLowerCase())
                      .join(', ')
                      .replace(
                        /, ([^,]*)$/,
                        ' або $1',
                      )} — одна з ${page.data.roles.length === 3 ? 'трьох' : page.data.roles.length}`,
                  ],
                  [
                    'Відповісте на кілька питань — текстом',
                    'Можна зупинитися й повернутися: чернетка зберігається на цьому пристрої',
                  ],
                  [
                    'Надішлете відгук',
                    'Посилання одноразове — після надсилання воно перестане діяти. Якщо знаєте людину недостатньо, щоб відповідати, — так і скажете; HR цієї відповіді не побачить',
                  ],
                ].map(([t, d], i) => (
                  <li key={t} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-8 place-items-center rounded-badge border border-input font-medium tabular-nums text-muted-foreground"
                    >
                      {i + 1}
                    </span>
                    <span className="grid gap-0.5">
                      <span className="font-medium">{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                      <span className="text-meta text-muted-foreground">
                        {d.charAt(0).toUpperCase() + d.slice(1)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}

        {/* R3 — роль: три картки + четверта «Недостатньо знаю людину» з підтвердженням (56C) */}
        {page.data && step === 'role' && (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,35rem)] items-start gap-x-16 gap-y-8 max-sm:grid-cols-1 max-sm:gap-6">
            <div className="grid min-w-0 gap-5">
              <h1 className="m-0 text-h1 text-pretty">Ким ви є для цієї людини?</h1>
              <Lead>
                {person && (
                  <>
                    {person}
                    {cand?.post ? `, ${cand.post}` : ''}.{' '}
                  </>
                )}
                HR побачить ваш відгук і роль, яку ви оберете, але не ім’я
              </Lead>
              <p className="m-0 text-meta text-muted-foreground">
                Роль — одна з {page.data.roles.length === 3 ? 'трьох' : page.data.roles.length}. Вільного
                варіанта немає: так відповіді лишаються анонімними. Якщо знаєте людину недостатньо, щоб
                відповідати, — оберіть останній варіант: HR цієї відповіді не побачить
              </p>
              <p className="m-0 text-meta text-muted-foreground">
                Далі — кілька питань, разом близько 10 хвилин
              </p>
            </div>
            <form
              aria-label="Роль рекомендатора"
              className="grid min-w-0 gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (decline4) setConfirmDecline(true)
                else if (draft.role) setStep('questions')
              }}
            >
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className="mb-2 p-0 text-label font-medium">Ваша роль</legend>
                {page.data.roles.map((r) => (
                  <RoleCard
                    key={r.id}
                    name="role"
                    value={r.id}
                    label={r.label}
                    hint={ROLE_HINT[r.id]}
                    checked={!decline4 && draft.role === r.id}
                    onChange={() => (setDecline4(false), update({ role: r.id }))}
                  />
                ))}
                <RoleCard
                  name="role"
                  value="none"
                  label="Недостатньо знаю людину"
                  hint="Питань не буде; відгук не надсилається, HR його не побачить"
                  checked={decline4}
                  onChange={() => setDecline4(true)}
                />
              </fieldset>
              {/* «Назад» ліворуч, «Далі» праворуч (рев'ю 11-03); на телефоні головна — зверху */}
              <ActionGroup>
                <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => setStep('intro')}>
                  Назад
                </Button>
                <Act
                  className="max-sm:order-first"
                  hint={
                    decline4
                      ? 'Попросимо підтвердити: посилання після цього перестане діяти'
                      : draft.role
                        ? 'Далі — кілька питань про цю людину'
                        : 'Оберіть роль, щоб продовжити'
                  }
                >
                  <Button type="submit" aria-disabled={!draft.role && !decline4 ? true : undefined}>
                    {decline4 ? 'Продовжити' : 'Далі'}
                    <Icon icon={ArrowRight} size={20} />
                  </Button>
                </Act>
              </ActionGroup>
            </form>
          </div>
        )}

        {/* R4 — одне питання на екран (55C): «Питання N з M», h1 питання, підказка, картка «Ваша відповідь» */}
        {page.data && step === 'questions' && q && (
          <form
            aria-label="Відповідь на питання"
            className="mx-auto grid w-full max-w-[56rem] gap-6"
            onSubmit={(e) => {
              e.preventDefault()
              if (last) {
                if (allFilled) submit.mutate()
              } else if (canNext) update({ index: idx + 1 })
            }}
          >
            <div className="grid max-w-[68ch] gap-2">
              <p className="m-0 text-meta text-muted-foreground">
                Питання {idx + 1} з {questions.length}
              </p>
              <h1 className="m-0 text-h1 [overflow-wrap:anywhere]">{q.text}</h1>
              {q.hint && <Lead>{q.hint}</Lead>}
              <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-meta text-muted-foreground">
                  {person && (
                    <>
                      {person} · ваша роль: {roleLabel}
                    </>
                  )}
                  {!person && <>Ваша роль: {roleLabel}</>}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep('role')}>
                  Змінити роль
                </Button>
              </p>
            </div>
            <Card title="Ваша відповідь" meta={VOICE_ENABLED ? 'текстом або голосом' : 'текстом'}>
              <Field
                label="Відповідь текстом"
                required={isRequired}
                hint={`${isRequired ? '' : 'Це питання можна пропустити. '}Своїми словами. Можна зупинитися й повернутися — чернетка зберігається на цьому пристрої${q.max_length ? ` · до ${q.max_length} знаків` : ''}`}
              >
                <Textarea
                  rows={5}
                  maxLength={limit}
                  autoFocus
                  value={currentText}
                  onChange={(e) =>
                    update({ answers: { ...draft.answers, [q.id]: e.target.value }, index: idx })
                  }
                />
              </Field>
              {currentText.trim().length > 0 && (
                <StatusText
                  status="on-device"
                  word="Чернетку збережено на пристрої"
                  size="sm"
                  className="text-foreground-tertiary"
                />
              )}
              {/* голос (D-75): VoiceRecorder як у розмові кандидата — з’явиться, коли API прийматиме аудіо (BR-9); у бойовій конфігурації не вмикати, доки X-26 відкрита */}
              <ErrorBox error={submit.error} />
            </Card>
            <ActionGroup>
              <Act hint="Відповідь збережена як чернетка">
                <Button
                  type="button"
                  variant="ghost"
                  icon={ArrowLeft}
                  onClick={() => (idx === 0 ? setStep('role') : update({ index: idx - 1 }))}
                >
                  Назад
                </Button>
              </Act>
              {last ? (
                <Act
                  className="max-sm:order-first"
                  hint={
                    online
                      ? 'Після надсилання змінити відповіді не можна; посилання перестане діяти'
                      : 'Немає зв’язку — спробуйте, коли він з’явиться'
                  }
                >
                  <Button
                    type="submit"
                    icon={Send}
                    loading={submit.isPending}
                    aria-disabled={!allFilled || !online || undefined}
                  >
                    Надіслати відгук
                  </Button>
                </Act>
              ) : (
                <Act
                  className="max-sm:order-first"
                  hint={
                    canNext
                      ? isRequired || currentText.trim()
                        ? `Питання ${idx + 2} з ${questions.length}`
                        : `Пропустити — питання ${idx + 2} з ${questions.length}`
                      : 'Напишіть відповідь, щоб продовжити'
                  }
                >
                  <Button type="submit" aria-disabled={!canNext || undefined}>
                    Далі
                    <Icon icon={ArrowRight} size={20} />
                  </Button>
                </Act>
              )}
            </ActionGroup>
          </form>
        )}

        {/* R5 — тепла подяка (D-42); R5b — нейтральна після «Недостатньо знаю людину» (D-45) */}
        {(step === 'done' || step === 'declined') && (
          <div className="grid justify-items-start gap-3 pt-6 max-sm:pt-2">
            {step === 'done' && (
              <span
                aria-hidden="true"
                className="grid size-14 place-items-center rounded-card border border-status-success-text bg-status-success-bg text-status-success-text"
              >
                <Check size={32} strokeWidth={2} />
              </span>
            )}
            <h1 className="m-0 max-w-[22ch] text-h1 text-pretty">
              {step === 'done' ? 'Дякуємо за відгук' : 'Дякуємо за відповідь'}
            </h1>
            <Lead>
              {step === 'done'
                ? 'Ви допомогли знайти лідерів. Ваш відгук уже в HR — анонімно, з роллю, яку ви обрали'
                : 'Ви повідомили, що недостатньо знаєте людину, щоб відповідати. Це чесна відповідь — HR її не побачить'}
            </Lead>
            {step === 'done' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-meta text-muted-foreground">Відгук:</span>
                <StatusText status="sent" />
              </div>
            )}
            <p className="m-0 max-w-[72ch] text-meta text-muted-foreground">
              Посилання більше не діє: повернутися до відповідей або змінити їх не можна. Сторінку можна
              закрити
            </p>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={confirmDecline}
        title="Повідомити, що ви недостатньо знаєте людину?"
        description="Питань не буде; відгук не надсилається, HR його не побачить. Посилання перестане діяти — повернутися не можна."
        confirmLabel="Підтвердити"
        pending={decline.isPending}
        onCancel={() => (setConfirmDecline(false), setDecline4(false))}
        onConfirm={() => decline.mutate()}
      />
    </div>
  )
}
