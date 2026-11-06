/** Методист: редактор методології — анкета, опитувальник, інтерв'ю, граф промтів. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Lock, X } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type {
  FieldType,
  InterviewQuestion,
  Methodology,
  MethodologyStatus,
  ProfileField,
  QuizQuestion,
  QuizType,
} from '../../api/types'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { PromptCanvas } from './PromptCanvas'
import { STAGE_DEFAULT, type StageLike } from '../../lib/stages'
import { STATUS_ICON, STATUS_LABEL, STATUS_TONE } from './MethodologyList'

type Tab = 'settings' | 'profile' | 'quiz' | 'interview' | 'recommendations' | 'prompts'
const TABS: { id: Tab; label: string }[] = [
  { id: 'settings', label: 'Налаштування' },
  // типові назви (D-73); задані методологом (BR-4) підставляє tabLabel
  { id: 'profile', label: STAGE_DEFAULT.PROFILE },
  { id: 'quiz', label: STAGE_DEFAULT.QUIZ },
  { id: 'interview', label: STAGE_DEFAULT.INTERVIEW },
  { id: 'recommendations', label: STAGE_DEFAULT.RECOMMENDATIONS },
  { id: 'prompts', label: 'Промти' },
]

/** Назва вкладки: задана методологом (BR-4) або типова. */
function tabLabel(t: { id: Tab; label: string }, m: Methodology) {
  const custom =
    t.id === 'profile'
      ? m.profile_title
      : t.id === 'quiz'
        ? m.quiz_title
        : t.id === 'interview'
          ? m.interview_title
          : null
  return custom?.trim() || t.label
}

let keyCounter = 0
const newKey = () => `k${++keyCounter}`

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const copy = [...items]
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

function RowControls({
  index,
  count,
  onMove,
  onRemove,
  disabled,
}: {
  index: number
  count: number
  onMove: (d: number) => void
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={ChevronUp}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
        aria-label="Вгору"
        title="Вгору"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={ChevronDown}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
        aria-label="Вниз"
        title="Вниз"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={X}
        disabled={disabled}
        onClick={onRemove}
        aria-label="Видалити"
        title="Видалити"
      />
    </div>
  )
}

const TITLE_FIELD: Partial<Record<StageLike, 'profile_title' | 'quiz_title' | 'interview_title'>> = {
  PROFILE: 'profile_title',
  QUIZ: 'quiz_title',
  INTERVIEW: 'interview_title',
}

/** «Назва блоку» (D-73, 89C, BR-4): задає методолог — її бачать кандидат і HR. Міняється й в активній методології. «Рекомендації» — без назви в API. */
function BlockNameField({ m, stage }: { m: Methodology; stage: StageLike }) {
  const qc = useQueryClient()
  const field = TITLE_FIELD[stage]
  const [value, setValue] = useState(() => (field ? (m[field] ?? '') : ''))
  const save = useMutation({
    mutationFn: () => api.patch<Methodology>(`/methodologies/${m.id}`, { [field!]: value.trim() }),
    onSuccess: (data) => {
      qc.setQueryData(['methodology', String(m.id)], data)
      qc.invalidateQueries({ queryKey: ['methodologies'] })
    },
  })
  if (!field) {
    return (
      <div className="mb-4 max-w-[28rem]">
        <Field label="Назва блоку" hint="Для блоку «Рекомендації» назва поки фіксована">
          <Input disabled value={STAGE_DEFAULT[stage]} />
        </Field>
      </div>
    )
  }
  const dirty = value.trim() !== (m[field] ?? '').trim()
  return (
    <div className="mb-4 grid max-w-[28rem] gap-2">
      <Field label="Назва блоку" hint={`Порожньо — «${STAGE_DEFAULT[stage]}». Цю назву бачать кандидат і HR`}>
        <Input
          maxLength={120}
          placeholder={STAGE_DEFAULT[stage]}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <ErrorBox error={save.error} />
      {dirty && (
        <div>
          <Button variant="secondary" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Зберегти назву
          </Button>
        </div>
      )}
    </div>
  )
}

function FrozenNotice() {
  return (
    <Alert variant="warning" icon={Lock} className="mb-4">
      Методологія активна, тому поля й питання зафіксовані — усі кандидати проходять однакові умови. Промти
      можна змінювати будь-коли на вкладці «Промти». Щоб змінити питання, створіть нову методологію.
    </Alert>
  )
}

function SaveBar({
  onSave,
  pending,
  error,
  disabled,
  saved,
}: {
  onSave: () => void
  pending: boolean
  error: unknown
  disabled: boolean
  saved: boolean
}) {
  return (
    <div className="mt-4 space-y-3">
      <ErrorBox error={error} />
      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={disabled || pending}>
          {pending ? 'Збереження…' : 'Зберегти'}
        </Button>
        {saved && (
          <span role="status" className="text-meta text-status-success-text">
            Збережено ✓
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------- Налаштування ---------- */

function SettingsTab({ m }: { m: Methodology }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState(m.title)
  const [description, setDescription] = useState(m.description)
  const [allowRerecord, setAllowRerecord] = useState(m.allow_rerecord)
  const [attempts, setAttempts] = useState(m.max_record_attempts)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Methodology>(`/methodologies/${m.id}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(['methodology', String(m.id)], data)
      qc.invalidateQueries({ queryKey: ['methodologies'] })
      setSaved(true)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/methodologies/${m.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['methodologies'] })
      navigate('/methodologist/methodologies')
    },
  })

  function setStatus(status: MethodologyStatus) {
    setSaved(false)
    update.mutate({ status })
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <Field label="Назва" required>
          <Input value={title} onChange={(e) => (setTitle(e.target.value), setSaved(false))} />
        </Field>
        <Field label="Опис">
          <Textarea value={description} onChange={(e) => (setDescription(e.target.value), setSaved(false))} />
        </Field>
        <Card sunken>
          <h3 className="m-0 text-body font-semibold">Голосові відповіді в розмові</h3>
          <Checkbox
            label="Дозволити кандидату перезаписувати відповідь"
            checked={allowRerecord}
            disabled={m.status !== 'DRAFT'}
            onChange={(e) => (setAllowRerecord(e.target.checked), setSaved(false))}
          />
          {allowRerecord && (
            <Field label="Максимум спроб запису на питання">
              <Input
                type="number"
                min={1}
                max={10}
                className="max-w-32"
                value={attempts}
                disabled={m.status !== 'DRAFT'}
                onChange={(e) => (setAttempts(Number(e.target.value)), setSaved(false))}
              />
            </Field>
          )}
          {m.status !== 'DRAFT' && (
            <p className="m-0 text-label text-foreground-tertiary">
              Правила запису зафіксовані після активації.
            </p>
          )}
        </Card>
        <ErrorBox error={update.error} />
        <div className="flex items-center gap-3">
          <Button
            disabled={update.isPending || !title.trim()}
            onClick={() =>
              update.mutate({
                title: title.trim(),
                description,
                ...(m.status === 'DRAFT'
                  ? { allow_rerecord: allowRerecord, max_record_attempts: allowRerecord ? attempts : 1 }
                  : {}),
              })
            }
          >
            Зберегти
          </Button>
          {saved && (
            <span role="status" className="text-meta text-status-success-text">
              Збережено ✓
            </span>
          )}
        </div>
      </Card>

      <Card className="gap-3">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-lg font-semibold">Статус</h3>
          <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
        </div>
        {m.status === 'DRAFT' && (
          <p className="m-0 text-meta text-muted-foreground">
            У чернетці можна вільно змінювати все. Активація відкриває методологію для запрошення кандидатів і
            фіксує поля та питання.
          </p>
        )}
        {m.status === 'ACTIVE' && (
          <p className="m-0 text-meta text-muted-foreground">
            HR може запрошувати кандидатів. Архівація закриває реєстрацію нових кандидатів.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {m.status === 'DRAFT' && <Button onClick={() => setStatus('ACTIVE')}>Активувати</Button>}
          {m.status === 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setStatus('ARCHIVED')}>
              Перенести в архів
            </Button>
          )}
          {m.status === 'ARCHIVED' && <Button onClick={() => setStatus('ACTIVE')}>Повернути в роботу</Button>}
          {m.status !== 'DRAFT' && (
            <Button variant="ghost" onClick={() => setStatus('DRAFT')}>
              Повернути в чернетку
            </Button>
          )}
          <Button variant="danger" disabled={remove.isPending} onClick={() => setConfirmDelete(true)}>
            Видалити
          </Button>
        </div>
        <ErrorBox error={remove.error} />
        <ConfirmDialog
          open={confirmDelete}
          danger
          title="Видалити методологію?"
          description="Методологію буде видалено разом із її питаннями та промтами. Це не можна скасувати."
          confirmLabel="Видалити"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => (setConfirmDelete(false), remove.mutate())}
        />
      </Card>
    </div>
  )
}

/* ---------- Анкета ---------- */

type FieldDraft = { key: string; label: string; type: FieldType; optionsText: string; required: boolean }
const FIELD_TYPES: Record<FieldType, string> = {
  TEXT: 'Короткий текст',
  TEXTAREA: 'Довгий текст',
  DATE: 'Дата',
  NUMBER: 'Число',
  SELECT: 'Вибір зі списку',
}

function ProfileTab({ m }: { m: Methodology }) {
  const qc = useQueryClient()
  const frozen = m.status !== 'DRAFT'
  const [items, setItems] = useState<FieldDraft[]>(() =>
    m.profile_fields.map((f: ProfileField) => ({
      key: newKey(),
      label: f.label,
      type: f.type,
      optionsText: (f.options ?? []).join('\n'),
      required: f.required,
    })),
  )
  const [saved, setSaved] = useState(false)
  const patch = (i: number, p: Partial<FieldDraft>) => (
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x))),
    setSaved(false)
  )

  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/methodologies/${m.id}/profile-fields`,
        items.map((i) => ({
          label: i.label.trim(),
          type: i.type,
          required: i.required,
          options:
            i.type === 'SELECT'
              ? i.optionsText
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : null,
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['methodology', String(m.id)] })
      setSaved(true)
    },
  })

  return (
    <div>
      {frozen && <FrozenNotice />}
      <BlockNameField m={m} stage="PROFILE" />
      <div className="space-y-3">
        {items.map((it, i) => (
          <Card key={it.key} className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="grid flex-1 gap-3 md:grid-cols-[1fr_12rem]">
                <Field label="Назва поля">
                  <Input
                    disabled={frozen}
                    value={it.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                  />
                </Field>
                <Field label="Тип">
                  <Select
                    disabled={frozen}
                    value={it.type}
                    onChange={(e) => patch(i, { type: e.target.value as FieldType })}
                  >
                    {Object.entries(FIELD_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <RowControls
                index={i}
                count={items.length}
                disabled={frozen}
                onMove={(d) => (setItems((xs) => move(xs, i, d)), setSaved(false))}
                onRemove={() => (setItems((xs) => xs.filter((_, j) => j !== i)), setSaved(false))}
              />
            </div>
            {it.type === 'SELECT' && (
              <Field label="Варіанти (кожен з нового рядка)">
                <Textarea
                  disabled={frozen}
                  value={it.optionsText}
                  onChange={(e) => patch(i, { optionsText: e.target.value })}
                />
              </Field>
            )}
            <Checkbox
              label="Обов’язкове"
              disabled={frozen}
              checked={it.required}
              onChange={(e) => patch(i, { required: e.target.checked })}
            />
          </Card>
        ))}
      </div>
      {!frozen && (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => (
            setItems((xs) => [
              ...xs,
              { key: newKey(), label: '', type: 'TEXT', optionsText: '', required: false },
            ]),
            setSaved(false)
          )}
        >
          + Додати поле
        </Button>
      )}
      {!frozen && (
        <SaveBar
          onSave={() => save.mutate()}
          pending={save.isPending}
          error={save.error}
          saved={saved}
          disabled={false}
        />
      )}
    </div>
  )
}

/* ---------- Опитувальник ---------- */

type QuizDraft = { key: string; text: string; type: QuizType; optionsText: string; min: number; max: number }
const QUIZ_TYPES: Record<QuizType, string> = {
  TEXT: 'Вільна відповідь',
  SINGLE_CHOICE: 'Один варіант',
  MULTI_CHOICE: 'Кілька варіантів',
  SCALE: 'Шкала',
}

function QuizTab({ m }: { m: Methodology }) {
  const qc = useQueryClient()
  const frozen = m.status !== 'DRAFT'
  const [items, setItems] = useState<QuizDraft[]>(() =>
    m.quiz_questions.map((q: QuizQuestion) => ({
      key: newKey(),
      text: q.text,
      type: q.type,
      optionsText: q.type === 'SCALE' ? '' : (q.options ?? []).join('\n'),
      min: q.type === 'SCALE' ? Number(q.options?.[0] ?? 1) : 1,
      max: q.type === 'SCALE' ? Number(q.options?.[1] ?? 10) : 10,
    })),
  )
  const [saved, setSaved] = useState(false)
  const patch = (i: number, p: Partial<QuizDraft>) => (
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x))),
    setSaved(false)
  )

  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/methodologies/${m.id}/quiz-questions`,
        items.map((i) => ({
          text: i.text.trim(),
          type: i.type,
          options:
            i.type === 'SCALE'
              ? [i.min, i.max]
              : i.type === 'TEXT'
                ? null
                : i.optionsText
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['methodology', String(m.id)] })
      setSaved(true)
    },
  })

  return (
    <div>
      {frozen && <FrozenNotice />}
      <BlockNameField m={m} stage="QUIZ" />
      <div className="space-y-3">
        {items.map((it, i) => (
          <Card key={it.key} className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="grid flex-1 gap-3 md:grid-cols-[1fr_12rem]">
                <Field label={`Питання ${i + 1}`}>
                  <Input
                    disabled={frozen}
                    value={it.text}
                    onChange={(e) => patch(i, { text: e.target.value })}
                  />
                </Field>
                <Field label="Тип відповіді">
                  <Select
                    disabled={frozen}
                    value={it.type}
                    onChange={(e) => patch(i, { type: e.target.value as QuizType })}
                  >
                    {Object.entries(QUIZ_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <RowControls
                index={i}
                count={items.length}
                disabled={frozen}
                onMove={(d) => (setItems((xs) => move(xs, i, d)), setSaved(false))}
                onRemove={() => (setItems((xs) => xs.filter((_, j) => j !== i)), setSaved(false))}
              />
            </div>
            {(it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') && (
              <Field label="Варіанти (кожен з нового рядка, щонайменше два)">
                <Textarea
                  disabled={frozen}
                  value={it.optionsText}
                  onChange={(e) => patch(i, { optionsText: e.target.value })}
                />
              </Field>
            )}
            {it.type === 'SCALE' && (
              <div className="flex gap-3">
                <Field label="Від">
                  <Input
                    type="number"
                    disabled={frozen}
                    className="w-24"
                    value={it.min}
                    onChange={(e) => patch(i, { min: Number(e.target.value) })}
                  />
                </Field>
                <Field label="До">
                  <Input
                    type="number"
                    disabled={frozen}
                    className="w-24"
                    value={it.max}
                    onChange={(e) => patch(i, { max: Number(e.target.value) })}
                  />
                </Field>
              </div>
            )}
          </Card>
        ))}
      </div>
      {!frozen && (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => (
            setItems((xs) => [
              ...xs,
              { key: newKey(), text: '', type: 'TEXT', optionsText: '', min: 1, max: 10 },
            ]),
            setSaved(false)
          )}
        >
          + Додати питання
        </Button>
      )}
      {!frozen && (
        <SaveBar
          onSave={() => save.mutate()}
          pending={save.isPending}
          error={save.error}
          saved={saved}
          disabled={false}
        />
      )}
    </div>
  )
}

/* ---------- Інтерв'ю ---------- */

type InterviewDraft = { key: string; text: string; hint: string; max: number }

function InterviewTab({ m }: { m: Methodology }) {
  const qc = useQueryClient()
  const frozen = m.status !== 'DRAFT'
  const [items, setItems] = useState<InterviewDraft[]>(() =>
    m.interview_questions.map((q: InterviewQuestion) => ({
      key: newKey(),
      text: q.text,
      hint: q.hint,
      max: q.max_duration_sec,
    })),
  )
  const [saved, setSaved] = useState(false)
  const patch = (i: number, p: Partial<InterviewDraft>) => (
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x))),
    setSaved(false)
  )

  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/methodologies/${m.id}/interview-questions`,
        items.map((i) => ({ text: i.text.trim(), hint: i.hint, max_duration_sec: i.max })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['methodology', String(m.id)] })
      setSaved(true)
    },
  })

  return (
    <div>
      {frozen && <FrozenNotice />}
      <BlockNameField m={m} stage="INTERVIEW" />
      <div className="space-y-3">
        {items.map((it, i) => (
          <Card key={it.key} className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-3">
                <Field label={`Питання ${i + 1}`}>
                  <Textarea
                    disabled={frozen}
                    value={it.text}
                    onChange={(e) => patch(i, { text: e.target.value })}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
                  <Field label="Підказка кандидату">
                    <Input
                      disabled={frozen}
                      value={it.hint}
                      onChange={(e) => patch(i, { hint: e.target.value })}
                    />
                  </Field>
                  <Field label="Ліміт запису, с" hint="10–900">
                    <Input
                      type="number"
                      min={10}
                      max={900}
                      disabled={frozen}
                      value={it.max}
                      onChange={(e) => patch(i, { max: Number(e.target.value) })}
                    />
                  </Field>
                </div>
              </div>
              <RowControls
                index={i}
                count={items.length}
                disabled={frozen}
                onMove={(d) => (setItems((xs) => move(xs, i, d)), setSaved(false))}
                onRemove={() => (setItems((xs) => xs.filter((_, j) => j !== i)), setSaved(false))}
              />
            </div>
          </Card>
        ))}
      </div>
      {!frozen && (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => (
            setItems((xs) => [...xs, { key: newKey(), text: '', hint: '', max: 120 }]),
            setSaved(false)
          )}
        >
          + Додати питання
        </Button>
      )}
      {!frozen && (
        <SaveBar
          onSave={() => save.mutate()}
          pending={save.isPending}
          error={save.error}
          saved={saved}
          disabled={false}
        />
      )}
    </div>
  )
}

/* ---------- Рекомендації (питання для рекомендаторів) ---------- */

type RecDraft = { key: string; text: string; hint: string; required: boolean; maxLength: string }

function RecommendationsTab({ m }: { m: Methodology }) {
  const qc = useQueryClient()
  const frozen = m.status !== 'DRAFT'
  const [items, setItems] = useState<RecDraft[]>(() =>
    m.recommendation_questions.map((q) => ({
      key: newKey(),
      text: q.text,
      hint: q.hint,
      required: q.required !== false,
      maxLength: q.max_length ? String(q.max_length) : '',
    })),
  )
  const [saved, setSaved] = useState(false)
  const patch = (i: number, p: Partial<RecDraft>) => (
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x))),
    setSaved(false)
  )

  const save = useMutation({
    mutationFn: () =>
      api.put(
        `/methodologies/${m.id}/recommendation-questions`,
        items.map((i) => ({
          text: i.text.trim(),
          hint: i.hint,
          required: i.required,
          max_length: i.maxLength.trim() ? Number(i.maxLength) : null,
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['methodology', String(m.id)] })
      setSaved(true)
    },
  })

  return (
    <div>
      {frozen && <FrozenNotice />}
      <BlockNameField m={m} stage="RECOMMENDATIONS" />
      <p className="m-0 mb-4 max-w-2xl text-meta text-muted-foreground">
        Питання, на які відповідають рекомендатори за посиланнями кандидата. Відповідь — текст. Етап
        «Рекомендації» є в кандидата завжди; без питань рекомендатор побачить недійсне посилання.
      </p>
      <div className="grid gap-3">
        {items.map((it, i) => (
          <Card key={it.key}>
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 gap-3">
                <Field label={`Питання ${i + 1}`}>
                  <Textarea
                    disabled={frozen}
                    value={it.text}
                    onChange={(e) => patch(i, { text: e.target.value })}
                  />
                </Field>
                <Field label="Підказка рекомендатору">
                  <Input
                    disabled={frozen}
                    value={it.hint}
                    onChange={(e) => patch(i, { hint: e.target.value })}
                  />
                </Field>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <Checkbox
                    label="Обов’язкове питання"
                    disabled={frozen}
                    checked={it.required}
                    onChange={(e) => patch(i, { required: e.target.checked })}
                  />
                  <Field label="Ліміт знаків" hint="Порожньо — до 5 000">
                    <Input
                      type="number"
                      min={50}
                      max={5000}
                      disabled={frozen}
                      className="w-32"
                      value={it.maxLength}
                      onChange={(e) => patch(i, { maxLength: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
              <RowControls
                index={i}
                count={items.length}
                disabled={frozen}
                onMove={(d) => (setItems((xs) => move(xs, i, d)), setSaved(false))}
                onRemove={() => (setItems((xs) => xs.filter((_, j) => j !== i)), setSaved(false))}
              />
            </div>
          </Card>
        ))}
      </div>
      {!frozen && (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => (
            setItems((xs) => [...xs, { key: newKey(), text: '', hint: '', required: true, maxLength: '' }]),
            setSaved(false)
          )}
        >
          + Додати питання
        </Button>
      )}
      {!frozen && (
        <SaveBar
          onSave={() => save.mutate()}
          pending={save.isPending}
          error={save.error}
          saved={saved}
          disabled={items.some((i) => !i.text.trim())}
        />
      )}
    </div>
  )
}

/* ---------- Сторінка ---------- */

export function MethodologyEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ['methodology', id],
    queryFn: () => api.get<Methodology>(`/methodologies/${id}`),
  })
  const [tab, setTab] = useState<Tab>('settings')
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = {
      ArrowRight: (i + 1) % TABS.length,
      ArrowLeft: (i - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setTab(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  useEffect(() => {
    document.title = q.data ? `${q.data.title} — OPORA` : 'OPORA'
  }, [q.data])

  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox error={q.error} />
  const m = q.data!

  const panels: Record<Tab, ReactNode> = {
    settings: <SettingsTab key={`s-${m.status}`} m={m} />,
    profile: <ProfileTab key={`p-${m.status}`} m={m} />,
    quiz: <QuizTab key={`q-${m.status}`} m={m} />,
    interview: <InterviewTab key={`i-${m.status}`} m={m} />,
    recommendations: <RecommendationsTab key={`r-${m.status}`} m={m} />,
    prompts: <PromptCanvas methodologyId={m.id} />,
  }

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/methodologist/methodologies')}>
          Усі методології
        </Button>
      </div>
      <PageHeader
        title={m.title}
        actions={
          <>
            <Badge tone="outline" square>
              методологія v{m.version}
            </Badge>
            <Badge tone={STATUS_TONE[m.status]} icon={STATUS_ICON[m.status]}>
              {STATUS_LABEL[m.status]}
            </Badge>
          </>
        }
      />
      <div
        role="tablist"
        aria-label="Розділи методології"
        onKeyDown={onTabKey}
        className="mb-6 flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => void (tabRefs.current[t.id] = el)}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className="-mb-px inline-flex h-(--control-h) items-center gap-2 whitespace-nowrap border-0 border-b-2 border-transparent bg-transparent px-1 font-medium text-muted-foreground hover:text-foreground aria-selected:border-border-accent aria-selected:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {tabLabel(t, m)}
          </button>
        ))}
      </div>
      {TABS.map((t) =>
        t.id === 'prompts' ? (
          tab === 'prompts' && (
            <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} tabIndex={0}>
              {panels[t.id]}
            </div>
          )
        ) : (
          <div
            key={t.id}
            role="tabpanel"
            id={`panel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            tabIndex={0}
            hidden={tab !== t.id}
          >
            {panels[t.id]}
          </div>
        ),
      )}
    </div>
  )
}
