/** Налаштування двофакторної автентифікації (TOTP) у кабінеті. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TwoFAStatus } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'
import { useToast } from './Toast'
import { Act, Alert, Button, Card, CopyButton, ErrorBox, Field, Input, Skeleton, StatusText } from './ui'

const KEY = ['2fa-status']

export function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { margin: 1, width: 192 }).then((u) => alive && setSrc(u))
    return () => {
      alive = false
    }
  }, [value])
  // QR завжди на білому тлі, інакше його не прочитає камера в темній темі
  return src ? (
    <img
      src={src}
      alt="QR-код для застосунку-автентифікатора"
      width={192}
      height={192}
      className="rounded-field border border-border bg-white"
    />
  ) : (
    <Skeleton variant="rect" width={192} height={192} />
  )
}

/**
 * 2FA (D-31): налаштування TOTP — QR + ключ вручну, підтвердження кодом; вимкнення потребує пароль і код.
 * sunken — блок «Захист входу» всередині картки «Вхід» (H8). managedBySupport (HR, 80A / D-39): без «Вимкнути 2FA»,
 * зміна й скидання — лише через підтримку; обовʼязковість з першого входу — екран H2 у Login (BR-7, готово).
 */
export function TwoFactorCard({
  sunken,
  managedBySupport,
  required,
}: { sunken?: boolean; managedBySupport?: boolean; required?: boolean } = {}) {
  const qc = useQueryClient()
  const toast = useToast()
  // BR-16: контакт підтримки з публічної конфігурації; порожній — кнопка недоступна з причиною
  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<{ support_contact: string | null }>('/config'),
    staleTime: 300_000,
  })
  const status = useQuery({ queryKey: KEY, queryFn: () => api.get<TwoFAStatus>('/account/2fa') })
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [password, setPassword] = useState('')

  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauth_uri: string }>('/account/2fa/setup'),
    onSuccess: (d) => (setCode(''), setSetup(d)),
  })
  const enable = useMutation({
    mutationFn: () => api.post<TwoFAStatus>('/account/2fa/enable', { code }),
    onSuccess: (s) => {
      qc.setQueryData(KEY, s)
      qc.invalidateQueries({ queryKey: ['me'] })
      setSetup(null)
      toast('Двофакторну автентифікацію ввімкнено')
    },
  })
  const disable = useMutation({
    mutationFn: () => api.post<TwoFAStatus>('/account/2fa/disable', { password, code }),
    onSuccess: (s) => {
      qc.setQueryData(KEY, s)
      setDisabling(false)
      toast('Двофакторну автентифікацію вимкнено')
    },
  })

  if (status.isLoading) return <Skeleton variant="rect" height={120} />
  if (!status.data?.available) return null

  return (
    <Card sunken={sunken} title={sunken ? 'Захист входу' : 'Двофакторна автентифікація'}>
      {status.data.enabled ? (
        <StatusText status="sent" word="Увімкнено · застосунок-автентифікатор" />
      ) : (
        <StatusText
          status="not-started"
          word={required ? 'Не налаштовано · для вашої ролі захист входу обовʼязковий' : 'Вимкнено'}
        />
      )}
      <p className="m-0 text-meta text-muted-foreground">
        Під час входу, окрім пароля, потрібен одноразовий код із застосунку-автентифікатора (Google
        Authenticator, Authy, 1Password тощо).
      </p>
      <ErrorBox error={status.error ?? start.error} />

      {!status.data.enabled && !setup && (
        <div>
          <Button variant="secondary" loading={start.isPending} onClick={() => start.mutate()}>
            Налаштувати 2FA
          </Button>
        </div>
      )}

      {!status.data.enabled && setup && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            enable.mutate()
          }}
        >
          <ol className="m-0 grid list-decimal gap-1 pl-5 text-meta">
            <li>Відскануйте QR-код застосунком-автентифікатором.</li>
            <li>Або введіть ключ вручну.</li>
            <li>Введіть 6-значний код, який показує застосунок.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-4">
            <Qr value={setup.otpauth_uri} />
            <div className="grid min-w-0 flex-1 gap-2">
              <span className="text-label text-foreground-tertiary">Ключ для ручного введення</span>
              <code className="[overflow-wrap:anywhere] rounded-field bg-muted px-3 py-2 text-meta tracking-wider">
                {setup.secret}
              </code>
              <div>
                <CopyButton size="sm" text={setup.secret} label="Копіювати ключ" />
              </div>
            </div>
          </div>
          <Field label="Код із застосунку" required>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="max-w-48 tabular-nums tracking-[0.3em]"
            />
          </Field>
          <ErrorBox error={enable.error} />
          <div className="flex flex-wrap gap-2 max-sm:flex-col max-sm:[&>button]:w-full">
            <Button type="submit" loading={enable.isPending} disabled={code.replace(/\s/g, '').length !== 6}>
              Увімкнути 2FA
            </Button>
            <Button type="button" variant="ghost" onClick={() => (setSetup(null), enable.reset())}>
              Скасувати
            </Button>
          </div>
        </form>
      )}

      {status.data.enabled && managedBySupport && (
        <>
          <p className="m-0 text-meta text-muted-foreground">
            Змінити спосіб або скинути захист самостійно не можна — лише через запит до техпідтримки
          </p>
          {/* BR-16: адреса — від Романа (?); поки `support_contact` порожній, кнопка недоступна з причиною */}
          {config.data?.support_contact ? (
            <div>
              <a
                href={`mailto:${config.data.support_contact}?subject=${encodeURIComponent('Опора: зміна або скидання 2FA')}`}
                className="inline-flex min-h-11 items-center rounded-field border border-border px-4 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Написати підтримці
              </a>
            </div>
          ) : (
            <Act hint="Контакт підтримки ще не налаштовано" fluid={false}>
              <Button variant="secondary" aria-disabled="true">
                Написати підтримці
              </Button>
            </Act>
          )}
        </>
      )}
      {status.data.enabled && !managedBySupport && (
        <>
          <Alert variant="info">
            Якщо втратите доступ до застосунку-автентифікатора, зверніться до адміністратора: він скине 2FA.
          </Alert>
          <div>
            <Button
              variant="secondary"
              onClick={() => (disable.reset(), setCode(''), setPassword(''), setDisabling(true))}
            >
              Вимкнути 2FA
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={disabling}
        danger
        title="Вимкнути 2FA?"
        description="Вхід знову відбуватиметься лише за паролем. Для підтвердження введіть пароль і поточний код."
        confirmLabel="Вимкнути"
        pending={disable.isPending}
        confirmDisabled={!password || code.replace(/\s/g, '').length !== 6}
        onCancel={() => setDisabling(false)}
        onConfirm={() => disable.mutate()}
      >
        <div className="grid gap-3">
          <Field label="Пароль" required>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Код із застосунку" required>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="tabular-nums tracking-[0.3em]"
            />
          </Field>
          <ErrorBox error={disable.error} />
        </div>
      </ConfirmDialog>
    </Card>
  )
}
