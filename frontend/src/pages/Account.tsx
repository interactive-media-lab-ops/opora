/** Сторінка «Акаунт»: 2FA, запит на видалення даних. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { api } from '../api/client'
import type { DeletionRequest } from '../api/types'
import { ROLE_LABEL, useAuth } from '../auth'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { InstallCard } from '../components/InstallCard'
import { TwoFactorCard } from '../components/TwoFactorCard'
import { useToast } from '../components/Toast'
import { Act, Alert, Button, Card, ErrorBox, Lead, Skeleton, StatusText, fmtDate } from '../components/ui'

const KEY = ['deletion-request']

/**
 * Акаунт (H8 / C6): «Дані» → «Про вас» (лише перегляд — імʼя, логін і роль змінює адміністратор), «Вхід» → «Пароль»
 * і «Захист входу» (2FA; для HR — обовʼязкова, зміна лише через підтримку: 80A / D-39), «Видалення акаунта» (D-57: запит,
 * підтвердження — червона дія, 70B), «Вийти». Запити — без змін.
 */
export function Account() {
  const { user, logout } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const request = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DeletionRequest | null>('/account/deletion-request'),
    enabled: Boolean(user),
  })
  const send = useMutation({
    mutationFn: () => api.post<DeletionRequest>('/account/deletion-request'),
    onSuccess: (r) => {
      qc.setQueryData(KEY, r)
      toast('Запит на видалення акаунта надіслано')
    },
  })
  if (!user) return null
  const isHR = user.role === 'HR'
  const isAdmin = user.role === 'ADMIN' // D-76: 2FA обовʼязкова, змінює сам; запиту на видалення немає (BR-8)

  return (
    <div className="mx-auto grid w-full max-w-[56rem] gap-6">
      <div className="grid gap-3">
        <h1 className="m-0 text-h1 font-semibold">Акаунт</h1>
        <Lead>Ваші дані, пароль і захист входу. Ролі й доступи видає адміністратор</Lead>
      </div>

      <Card title="Дані">
        <Card sunken title="Про вас">
          {/* лише перегляд (67A поза скоупом): текст замість полів, щоб не показувати «вимкнені» контроли */}
          <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Ім’я та прізвище', user.name],
              ['Логін (ел. пошта)', user.email],
              ['Роль', ROLE_LABEL[user.role]],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-label font-medium">{k}</dt>
                <dd className="m-0 [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-label text-foreground-tertiary">
            Змінити ім’я, логін або роль може лише адміністратор
          </p>
        </Card>
      </Card>

      <Card title="Вхід">
        <Card sunken title="Пароль">
          <p className="m-0 text-meta text-muted-foreground">
            Пароль встановлює й змінює адміністратор. Якщо потрібен новий — зверніться до нього
          </p>
        </Card>
        <TwoFactorCard sunken managedBySupport={isHR} required={isHR || isAdmin} />
      </Card>

      <InstallCard />

      {!isAdmin && (
        <Card title="Видалення акаунта">
          <Card sunken className="gap-3">
            <p className="m-0 text-meta text-muted-foreground">
              Запит розгляне адміністратор платформи. Акаунт і дані не зникнуть одразу; після видалення
              відновити {isHR ? 'нотатки й списки' : 'акаунт і відповіді'} буде неможливо
            </p>
            <ErrorBox error={request.error ?? send.error} />
            {user.is_demo && user.role === 'CANDIDATE' ? (
              <Alert variant="info">
                Це демонстраційний акаунт — запит на видалення для нього недоступний.
              </Alert>
            ) : request.isLoading ? (
              <Skeleton variant="rect" height={36} />
            ) : request.data ? (
              <StatusText
                status="sent"
                word={`Запит надіслано ${fmtDate(request.data.created_at)} — очікує на розгляд адміністратором`}
              />
            ) : (
              <div>
                <Button variant="secondary" onClick={() => (send.reset(), setConfirming(true))}>
                  Надіслати запит
                </Button>
              </div>
            )}
          </Card>
        </Card>
      )}

      <Act hint="Повернетеся на сторінку входу" fluid={false}>
        <Button variant="ghost" icon={LogOut} onClick={logout}>
          Вийти
        </Button>
      </Act>

      <ConfirmDialog
        open={confirming}
        danger
        title="Надіслати запит на видалення акаунта?"
        description="Адміністратор отримає запит і розгляне його. Після видалення відновити акаунт і відповіді буде неможливо."
        confirmLabel="Надіслати запит"
        pending={send.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => send.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </div>
  )
}
