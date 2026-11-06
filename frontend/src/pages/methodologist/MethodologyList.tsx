/** Методист: перелік методологій і їх статуси. */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Methodology, MethodologyListItem, MethodologyStatus } from '../../api/types'
import { Archive, Check, CircleDashed, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  fmtDate,
} from '../../components/ui'

export const STATUS_LABEL: Record<MethodologyStatus, string> = {
  DRAFT: 'Чернетка',
  ACTIVE: 'Активна',
  ARCHIVED: 'Архів',
}
export const STATUS_TONE = { DRAFT: 'amber', ACTIVE: 'green', ARCHIVED: 'slate' } as const
/** Статус методології словом + іконкою (схема C). */
export const STATUS_ICON = { DRAFT: CircleDashed, ACTIVE: Check, ARCHIVED: Archive } as const

export function MethodologyList() {
  const navigate = useNavigate()
  const list = useQuery({
    queryKey: ['methodologies'],
    queryFn: () => api.get<MethodologyListItem[]>('/methodologies'),
  })
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const create = useMutation({
    mutationFn: () => api.post<Methodology>('/methodologies', { title: title.trim(), description }),
    onSuccess: (m) => navigate(`/methodologist/methodologies/${m.id}`),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <div>
      <PageHeader
        title="Методології"
        subtitle="Кожна методологія — це анкета, опитувальник, розмова та граф промтів для оцінювання кандидатів на певну роль."
        actions={
          !creating && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Додати методологію
            </Button>
          )
        }
      />

      {creating && (
        <Card title="Нова методологія" className="mb-6">
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Назва" required>
              <Input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Наприклад, Менеджер з продажів"
              />
            </Field>
            <Field label="Опис">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <ErrorBox error={create.error} />
            <div className="flex gap-2 max-sm:flex-col max-sm:[&>button]:w-full">
              <Button type="submit" disabled={create.isPending}>
                Створити
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Скасувати
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ErrorBox error={list.error} />
      {list.isLoading && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy>
          <Skeleton variant="rect" height={104} />
          <Skeleton variant="rect" height={104} />
        </div>
      )}
      {list.data && list.data.length === 0 && !creating && (
        <EmptyState title="Методологій ще немає">Створіть першу.</EmptyState>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {list.data?.map((m) => (
          <Link
            key={m.id}
            to={`/methodologist/methodologies/${m.id}`}
            className="block rounded-card text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="h-full hover:bg-secondary-hover">
              <div className="flex items-start justify-between gap-3">
                <h2 className="m-0 text-h3 font-semibold">{m.title}</h2>
                <Badge tone={STATUS_TONE[m.status]} icon={STATUS_ICON[m.status]}>
                  {STATUS_LABEL[m.status]}
                </Badge>
              </div>
              {m.description && (
                <p className="m-0 line-clamp-2 text-meta text-muted-foreground">{m.description}</p>
              )}
              <p className="m-0 text-label text-foreground-tertiary tabular-nums">
                v{m.version} · створено {fmtDate(m.created_at)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
