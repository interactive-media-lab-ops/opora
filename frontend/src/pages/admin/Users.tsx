/** Адмін: акаунти методистів і HR. */
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Role, User } from '../../api/types'
import { ROLE_LABEL, useAuth } from '../../auth'
import {
  Alert,
  Avatar,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  StatusText,
} from '../../components/ui'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DataTable, TableSkeleton, Td, Th } from '../../components/table'

const STAFF: Role[] = ['METHODOLOGIST', 'HR', 'ADMIN']

export function Users() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'METHODOLOGIST' as Role })

  const create = useMutation({
    mutationFn: () => api.post<User>('/users', form),
    onSuccess: () => {
      setForm({ name: '', email: '', password: '', role: 'METHODOLOGIST' })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
  const toggle = useMutation({
    mutationFn: (u: User) => api.patch<User>(`/users/${u.id}`, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const resetPassword = useMutation({
    mutationFn: ({ u, password }: { u: User; password: string }) =>
      api.patch<User>(`/users/${u.id}`, { password }),
  })

  const [pwUser, setPwUser] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [deactivate, setDeactivate] = useState<User | null>(null)
  const [reset2fa, setReset2fa] = useState<User | null>(null)
  const resetTwoFa = useMutation({
    mutationFn: (u: User) => api.post<User>(`/users/${u.id}/reset-2fa`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  function changePassword(u: User) {
    setNewPassword('')
    setPwUser(u)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <div>
      <PageHeader
        title="Користувачі"
        subtitle="Акаунти методистів, HR і адміністраторів із тимчасовим паролем (D-68 — пропозиція). Кандидати реєструються самостійно за запрошенням"
      />

      <Card title="Новий співробітник" className="mb-6">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
          <Field label="Ім’я" required>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Пошта" required>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Тимчасовий пароль" required hint="Щонайменше 8 символів">
            <Input
              type="text"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Роль">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {STAFF.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-4">
            <ErrorBox error={create.error} />
            <Button type="submit" className="mt-3" disabled={create.isPending}>
              Створити акаунт
            </Button>
          </div>
        </form>
      </Card>

      <DataTable caption="Користувачі" busy={users.isLoading}>
        <thead>
          <tr>
            <Th>Ім’я</Th>
            <Th priority={2}>Пошта</Th>
            <Th>Роль</Th>
            <Th>Статус</Th>
            <Th />
          </tr>
        </thead>
        {users.isLoading || !users.data ? (
          <TableSkeleton cols={5} />
        ) : (
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id}>
                <Td lead>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={u.name} />
                    <span className="grid min-w-0">
                      <span className="font-medium">{u.name}</span>
                      <span className="block truncate text-label text-foreground-tertiary md:hidden">
                        {u.email}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td label="Пошта" priority={2}>
                  {u.email}
                </Td>
                <Td label="Роль">{ROLE_LABEL[u.role]}</Td>
                <Td label="Статус">
                  {/* статус словом + іконкою (схема C); 2FA — як частина статусу */}
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    {u.is_active ? (
                      <StatusText status="sent" word="Активний" />
                    ) : (
                      <StatusText status="error" word="Деактивований" />
                    )}
                    {u.totp_enabled ? (
                      <StatusText status="sent" word="2FA" size="sm" className="text-muted-foreground" />
                    ) : null}
                  </span>
                </Td>
                <Td actions className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={resetPassword.isPending}
                      onClick={() => changePassword(u)}
                    >
                      Змінити пароль
                    </Button>
                    {u.totp_enabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={resetTwoFa.isPending}
                        onClick={() => setReset2fa(u)}
                      >
                        Скинути 2FA
                      </Button>
                    )}
                    {u.id !== me?.id && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() => (u.is_active ? setDeactivate(u) : toggle.mutate(u))}
                      >
                        {u.is_active ? 'Деактивувати' : 'Активувати'}
                      </Button>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        )}
      </DataTable>
      <ConfirmDialog
        open={pwUser !== null}
        title="Змінити пароль"
        description={pwUser ? `Новий пароль для ${pwUser.email}.` : undefined}
        confirmLabel="Змінити пароль"
        confirmDisabled={newPassword.length < 8}
        onCancel={() => setPwUser(null)}
        onConfirm={() => {
          if (pwUser) resetPassword.mutate({ u: pwUser, password: newPassword })
          setPwUser(null)
        }}
      >
        <Field label="Новий пароль" hint="Щонайменше 8 символів" required>
          <Input
            type="text"
            autoComplete="off"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={deactivate !== null}
        danger
        title="Деактивувати акаунт?"
        description={
          deactivate
            ? `${deactivate.name} (${deactivate.email}) більше не зможе увійти. Акаунт можна активувати знову.`
            : undefined
        }
        confirmLabel="Деактивувати"
        onCancel={() => setDeactivate(null)}
        onConfirm={() => {
          if (deactivate) toggle.mutate(deactivate)
          setDeactivate(null)
        }}
      />
      <ConfirmDialog
        open={reset2fa !== null}
        title="Скинути 2FA?"
        description={
          reset2fa
            ? `${reset2fa.name} (${reset2fa.email}) зможе увійти лише паролем і ввімкнути 2FA знову.`
            : undefined
        }
        confirmLabel="Скинути 2FA"
        onCancel={() => setReset2fa(null)}
        onConfirm={() => {
          if (reset2fa) resetTwoFa.mutate(reset2fa)
          setReset2fa(null)
        }}
      />
      <ErrorBox error={toggle.error ?? resetPassword.error ?? resetTwoFa.error} />
      {resetPassword.isSuccess && (
        <Alert variant="success" role="status" className="mt-3">
          Пароль змінено.
        </Alert>
      )}
    </div>
  )
}
