/** Кроки етапів кандидата: Stepper, поля анкети, питання опитувальника. */
import { stageTitle } from '../../lib/stages'
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { CandidateAssessment, ProfileField, QuizQuestion, StageInfo } from '../../api/types'
import { Check } from 'lucide-react'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Card,
  Checkbox,
  ErrorBox,
  Field,
  Input,
  Radio,
  Select,
  Textarea,
  cx,
} from '../../components/ui'

/** Дебаунс-автозбереження чернетки; повертає стан для індикатора. */
function useAutosave<T>(value: T, enabled: boolean, save: (v: T) => Promise<unknown>) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const initial = useRef(value)
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (value === initial.current || !enabled) return
    setState('saving')
    const t = setTimeout(() => {
      saveRef
        .current(value)
        .then(() => setState('saved'))
        .catch(() => setState('error'))
    }, 700)
    return () => clearTimeout(t)
  }, [value, enabled])
  return state
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null
  const text = {
    saving: 'Зберігаємо чернетку…',
    saved: 'Чернетку збережено',
    error: 'Не вдалося зберегти чернетку',
  }[state]
  return (
    <span
      role="status"
      className={cx('text-meta', state === 'error' ? 'text-status-danger-text' : 'text-muted-foreground')}
    >
      {text}
    </span>
  )
}

/** Крокомір (лише перегляд адміна): назви — з хелпера D-73 (`titles` — з конфігурації, якщо є). */
export function Stepper({
  steps,
  current,
  titles,
}: {
  steps: string[]
  current: string
  titles?: Pick<StageInfo, 'key' | 'title'>[]
}) {
  const idx = steps.indexOf(current)
  return (
    <ol className="m-0 mb-6 flex list-none p-0 max-sm:flex-col">
      {steps.map((st, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'next'
        return (
          <li
            key={st}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className="group relative flex flex-1 flex-col gap-2 before:absolute before:left-6 before:right-0 before:top-[11px] before:h-0.5 before:bg-border last:before:hidden data-[state=done]:before:bg-primary max-sm:flex-row max-sm:gap-3 max-sm:pb-4 max-sm:before:bottom-0 max-sm:before:left-[11px] max-sm:before:right-auto max-sm:before:top-6 max-sm:before:h-auto max-sm:before:w-0.5"
          >
            <span className="relative z-[1] grid size-6 shrink-0 place-content-center rounded-full border-2 border-input bg-card text-caption font-semibold text-foreground-tertiary group-data-[state=current]:border-primary group-data-[state=current]:text-foreground group-data-[state=done]:border-primary group-data-[state=done]:bg-primary group-data-[state=done]:text-primary-foreground">
              {state === 'done' ? <Check aria-hidden size={14} strokeWidth={2} /> : i + 1}
            </span>
            <span className="grid gap-0.5 text-meta">
              <span className={cx('font-medium', state === 'next' && 'text-muted-foreground')}>
                {stageTitle(st, titles)}
              </span>
              <span className="sr-only">
                Крок {i + 1} з {steps.length}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/* ---------- Етап 1: анкета ---------- */

export function ProfileInput({
  f,
  value,
  onChange,
}: {
  f: ProfileField
  value: string
  onChange: (v: string) => void
}) {
  if (f.type === 'TEXTAREA') return <Textarea value={value} onChange={(e) => onChange(e.target.value)} />
  if (f.type === 'SELECT')
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— оберіть —</option>
        {f.options?.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </Select>
    )
  return (
    <Input
      type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'}
      step="any"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function ProfileStep({
  a,
  onUpdate,
  onDone,
}: {
  a: CandidateAssessment
  onUpdate: (a: CandidateAssessment) => void
  onDone: () => void
}) {
  const stage = a.stages.find((x) => x.key === 'PROFILE')
  // після подання анкета редагується (D-24): без автозбереження, зміни фіксуються одним записом у журналі
  const editing = stage?.status === 'SUBMITTED'
  const [values, setValues] = useState<Record<string, string>>(a.profile_answers)
  const answers = (v: Record<string, string>) => ({
    answers: a.profile_fields.map((f) => ({ question_id: f.id, value: v[f.id] ?? '' })),
  })
  const [sent, setSent] = useState(false) // після надсилання автозбереження вже не потрібне (етап закрито)
  const autosave = useAutosave(values, !editing && !sent, (v) =>
    api.put<CandidateAssessment>('/candidate/assessment/profile', answers(v)),
  )

  const submit = useMutation({
    mutationFn: async () => {
      const saved = await api.put<CandidateAssessment>('/candidate/assessment/profile', answers(values))
      return editing ? saved : api.post<CandidateAssessment>('/candidate/assessment/profile/submit')
    },
    onMutate: () => setSent(true),
    onError: () => setSent(false),
    onSuccess: (data) => (onUpdate(data), onDone()),
  })

  return (
    <form
      className="grid max-w-[56rem] gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      {editing && (
        <Alert variant="info">
          Ви редагуєте надіслану анкету. Після збереження HR побачить оновлені відповіді
          {a.stage === 'DONE' ? ', а аналіз буде виконано заново' : ''}.
        </Alert>
      )}
      {/* C3: поля в картці, сітка 18rem; файли (CV, зображення) — після рішення 52A, тут лише наявні типи полів */}
      <Card className="min-w-0">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-4 gap-y-3">
          {a.profile_fields.map((f) => (
            <Field
              key={f.id}
              label={f.label}
              required={f.required}
              className={cx(f.type === 'TEXTAREA' && 'col-span-full')}
            >
              <ProfileInput
                f={f}
                value={values[f.id] ?? ''}
                onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
              />
            </Field>
          ))}
        </div>
      </Card>
      <ErrorBox error={submit.error} />
      <ActionGroup>
        <Act
          hint={
            editing ? 'HR побачить оновлені відповіді' : 'Надішлемо на опрацювання, повернетеся до етапів'
          }
        >
          <Button type="submit" loading={submit.isPending}>
            {editing ? 'Зберегти зміни' : 'Надіслати анкету'}
          </Button>
        </Act>
        <SaveIndicator state={autosave} />
      </ActionGroup>
    </form>
  )
}

/* ---------- Етап 2а: опитувальник ---------- */

export function QuizInput({
  q,
  value,
  onChange,
}: {
  q: QuizQuestion
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (q.type === 'TEXT')
    return (
      <Textarea
        aria-label={q.text}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  if (q.type === 'SINGLE_CHOICE')
    return (
      <div className="grid">
        {q.options?.map((o) => (
          <Radio
            key={String(o)}
            name={`q${q.id}`}
            label={String(o)}
            checked={value === o}
            onChange={() => onChange(o)}
          />
        ))}
      </div>
    )
  if (q.type === 'MULTI_CHOICE') {
    const selected = (value as string[]) ?? []
    return (
      <div className="grid">
        {q.options?.map((o) => (
          <Checkbox
            key={String(o)}
            label={String(o)}
            checked={selected.includes(String(o))}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, String(o)] : selected.filter((x) => x !== String(o)))
            }
          />
        ))}
      </div>
    )
  }
  // шкала — ряд квадратних кнопок 44×44 (КС ToggleGroup, 22A): обрана — accent + border-accent
  const lo = Number(q.options?.[0] ?? 1)
  const hi = Number(q.options?.[1] ?? 10)
  const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  return (
    <div className="grid gap-2">
      <div role="group" aria-label={q.text} className="flex flex-wrap gap-2">
        {range.map((n) => (
          <Button
            key={n}
            variant="secondary"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className="size-11 px-0 tabular-nums [--control-h:2.75rem] aria-pressed:border-border-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          >
            {n}
          </Button>
        ))}
      </div>
      <p className="m-0 text-caption text-foreground-tertiary">
        від {lo} до {hi}
      </p>
    </div>
  )
}

export function QuizStep({
  a,
  onUpdate,
  onDone,
}: {
  a: CandidateAssessment
  onUpdate: (a: CandidateAssessment) => void
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, unknown>>(a.quiz_answers)
  const answers = (v: Record<string, unknown>) => ({
    answers: a.quiz_questions
      .filter((q) => v[q.id] !== undefined)
      .map((q) => ({ question_id: q.id, value: v[q.id] })),
  })
  const [sent, setSent] = useState(false)
  const autosave = useAutosave(values, !sent, (v) =>
    api.put<CandidateAssessment>('/candidate/assessment/quiz', answers(v)),
  )
  const submit = useMutation({
    mutationFn: async () => {
      await api.put('/candidate/assessment/quiz', answers(values))
      return api.post<CandidateAssessment>('/candidate/assessment/quiz/submit')
    },
    onMutate: () => setSent(true),
    onError: () => setSent(false),
    onSuccess: (data) => (onUpdate(data), onDone()),
  })

  return (
    <form
      className="grid max-w-[56rem] gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      <Card className="min-w-0 gap-6">
        {a.quiz_questions.map((q, i) => (
          <fieldset key={q.id} className="m-0 grid min-w-0 gap-2 border-0 p-0">
            <legend className="mb-2 p-0 font-medium">
              {i + 1}. {q.text}
            </legend>
            <QuizInput q={q} value={values[q.id]} onChange={(v) => setValues((s) => ({ ...s, [q.id]: v }))} />
          </fieldset>
        ))}
      </Card>
      <ErrorBox error={submit.error} />
      <ActionGroup>
        <Act hint="Після надсилання опитувальник можна пройти заново">
          <Button type="submit" loading={submit.isPending}>
            Надіслати опитувальник
          </Button>
        </Act>
        <SaveIndicator state={autosave} />
      </ActionGroup>
    </form>
  )
}
