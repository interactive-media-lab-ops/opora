/** HR: запрошення кандидатів. */
import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { MethodologyListItem, PersonalInvite } from '../../api/types'
import {
  Badge,
  Card,
  CopyButton,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  fmtDate,
} from '../../components/ui'
import { Button } from '../../components/ui'
import { DataTable, Td, Th } from '../../components/table'

const registerUrl = (code: string) => `${window.location.origin}/register/${code}`

export function Invites() {
  const qc = useQueryClient()
  const methodologies = useQuery({
    queryKey: ['methodologies'],
    queryFn: () => api.get<MethodologyListItem[]>('/methodologies'),
  })
  const active = methodologies.data?.filter((m) => m.status === 'ACTIVE') ?? []
  const [methodologyId, setMethodologyId] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (!methodologyId && active.length) setMethodologyId(String(active[0].id))
  }, [active, methodologyId])

  const general = useQuery({
    queryKey: ['invite-link', methodologyId],
    queryFn: () => api.get<{ general_url: string }>(`/methodologies/${methodologyId}/invite-link`),
    enabled: Boolean(methodologyId),
  })
  const invites = useQuery({
    queryKey: ['personal-invites', methodologyId],
    queryFn: () => api.get<PersonalInvite[]>(`/invites?methodology_id=${methodologyId}`),
    enabled: Boolean(methodologyId),
  })
  const create = useMutation({
    mutationFn: () =>
      api.post<PersonalInvite>('/invites', {
        methodology_id: Number(methodologyId),
        candidate_email: email.trim(),
      }),
    onSuccess: () => {
      setEmail('')
      qc.invalidateQueries({ queryKey: ['personal-invites'] })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  if (methodologies.isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Запрошення"
        subtitle="Кандидати потрапляють на платформу лише за посиланням. Надішліть його зручним каналом — поштою чи в месенджері."
      />
      {active.length === 0 ? (
        <EmptyState>Немає активних методологій. Попросіть методиста активувати хоча б одну.</EmptyState>
      ) : (
        <div className="space-y-6">
          <Field label="Методологія">
            {/* 100A: одна активна методологія — вибору немає; поле лише для читання (73A), назву видно повністю */}
            {active.length === 1 ? (
              <Input readOnly value={active[0].title} className="max-w-md" />
            ) : (
              <Select
                value={methodologyId}
                onChange={(e) => setMethodologyId(e.target.value)}
                className="max-w-md"
              >
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Card>
            <h2 className="text-base font-semibold">Загальне посилання</h2>
            <p className="mb-3 mt-1 text-meta text-muted-foreground">
              Багаторазове: кожен, хто його отримав, може зареєструватися.
            </p>
            {general.data && (
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-field bg-muted px-3 py-2 text-meta">
                  {registerUrl(general.data.general_url.split('/').pop()!)}
                </code>
                <CopyButton text={registerUrl(general.data.general_url.split('/').pop()!)} />
              </div>
            )}
            <ErrorBox error={general.error} />
          </Card>

          <Card>
            <h2 className="text-base font-semibold">Персональне запрошення</h2>
            <p className="mb-3 mt-1 text-meta text-muted-foreground">
              Одноразове посилання, прив’язане до пошти кандидата — зареєструватися за ним зможе лише ця
              адреса.
            </p>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <Field label="Пошта кандидата">
                  <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" disabled={create.isPending}>
                Створити посилання
              </Button>
            </form>
            <div className="mt-3">
              <ErrorBox error={create.error} />
            </div>
          </Card>

          {invites.data && invites.data.length > 0 && (
            <DataTable caption="Персональні запрошення">
              <thead>
                <tr>
                  <Th>Пошта</Th>
                  <Th priority={2}>Створено</Th>
                  <Th>Статус</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {invites.data.map((i) => (
                  <tr key={i.id}>
                    <Td lead>{i.candidate_email}</Td>
                    <Td label="Створено" priority={2}>
                      {fmtDate(i.created_at)}
                    </Td>
                    <Td label="Статус">
                      {i.used_at ? (
                        <Badge tone="green">Використано</Badge>
                      ) : (
                        <Badge tone="amber">Очікує</Badge>
                      )}
                    </Td>
                    <Td actions className="text-right">
                      {!i.used_at && (
                        <CopyButton size="sm" text={registerUrl(i.code)} label="Копіювати посилання" />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      )}
    </div>
  )
}
