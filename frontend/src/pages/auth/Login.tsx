/** Вхід, зокрема крок 2FA. */
import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { HOME_BY_ROLE, useAuth } from '../../auth'
import { MinimalHeader } from '../../components/Layout'
import { Qr } from '../../components/TwoFactorCard'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Card,
  CopyButton,
  ErrorBox,
  Field,
  Input,
  Lead,
} from '../../components/ui'

/**
 * Вхід — H3 (DD-39, 59A): колонка 28rem, h1 + підзаголовок, помилка входу — Alert НАД формою без позначки поля (безпека),
 * поля в картці, одна головна «Увійти» з підказкою. Крок коду 2FA (H4) — та сама колонка. Логіка входу без змін.
 */
export function Login() {
  const { user, login, completeMfa, startMfaSetup, completeMfaSetup } = useAuth()
  const navigate = useNavigate()
  // BR-13: після входу — на сторінку, з якої перекинуло на вхід (лише внутрішній шлях), інакше на головну ролі
  const from = (useLocation().state as { from?: unknown } | null)?.from
  const target = (role: keyof typeof HOME_BY_ROLE) =>
    typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login')
      ? from
      : HOME_BY_ROLE[role]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  // H2 (BR-7 / BR-8): 2FA обовʼязкова й ще не налаштована — без пропуску, повного входу немає, доки код не підтверджено
  const [setupToken, setSetupToken] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const startSetup = useMutation({ mutationFn: (token: string) => startMfaSetup(token), onSuccess: setSetup })

  if (user) return <Navigate to={target(user.role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = await login(email.trim(), password)
      if ('mfaToken' in me) {
        setMfaToken(me.mfaToken)
        return
      }
      if ('setupToken' in me) {
        setSetupToken(me.setupToken)
        startSetup.mutate(me.setupToken)
        return
      }
      navigate(target(me.role), { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    if (!mfaToken) return
    setBusy(true)
    setError(null)
    try {
      const me = await completeMfa(mfaToken, code)
      navigate(target(me.role), { replace: true })
    } catch (err) {
      setError(err)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function submitSetup(e: FormEvent) {
    e.preventDefault()
    if (!setupToken) return
    setBusy(true)
    setError(null)
    try {
      const me = await completeMfaSetup(setupToken, code)
      navigate(target(me.role), { replace: true })
    } catch (err) {
      setError(err)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  function backToLogin() {
    setMfaToken(null)
    setSetupToken(null)
    setSetup(null)
    startSetup.reset()
    setCode('')
    setError(null)
  }

  // 59A: «логін або пароль не підходять» — одне повідомлення над формою; інші помилки (зв'язок, сервер) — текстом ErrorBox
  const authError = error instanceof ApiError && (error.status === 401 || error.status === 400)
  const filled = email.trim().length > 0 && password.length > 0

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MinimalHeader />
      <main className="mx-auto w-full max-w-[31rem] min-w-0 flex-1 px-6 py-6 max-sm:px-4">
        {setupToken ? (
          <form onSubmit={submitSetup} aria-label="Налаштування 2FA" className="grid gap-6">
            <div className="grid gap-2">
              <h1 className="m-0 text-h1">Налаштуйте двофакторний захист</h1>
              <Lead>Для вашої ролі він обовʼязковий. Без цього кроку кабінет не відкриється</Lead>
            </div>
            <ErrorBox error={error ?? startSetup.error} />
            <Card>
              {setup ? (
                <div className="grid gap-4">
                  <ol className="m-0 grid list-decimal gap-1 pl-5 text-meta">
                    <li>
                      Відскануйте QR-код застосунком-автентифікатором (Google Authenticator, Authy, 1Password
                      тощо).
                    </li>
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
                      pattern="[0-9 ]*"
                      maxLength={7}
                      autoFocus
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="max-w-48 tabular-nums tracking-[0.3em]"
                    />
                  </Field>
                </div>
              ) : (
                <p className="m-0 text-meta text-muted-foreground">
                  {startSetup.isError ? 'Не вдалося підготувати налаштування' : 'Готуємо ключ…'}
                </p>
              )}
            </Card>
            <ActionGroup>
              <Act
                hint={
                  setup && code.replace(/\s/g, '').length === 6
                    ? 'Далі — ваш кабінет'
                    : 'Введіть 6-значний код'
                }
              >
                <Button
                  type="submit"
                  loading={busy}
                  disabled={busy || !setup || code.replace(/\s/g, '').length !== 6}
                >
                  Увімкнути й увійти
                </Button>
              </Act>
              {startSetup.isError ? (
                <Button type="button" variant="secondary" onClick={() => startSetup.mutate(setupToken)}>
                  Спробувати ще раз
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={backToLogin}>
                Назад
              </Button>
            </ActionGroup>
          </form>
        ) : mfaToken ? (
          <form onSubmit={submitCode} aria-label="Код підтвердження" className="grid gap-6">
            <div className="grid gap-2">
              <h1 className="m-0 text-h1">Код підтвердження</h1>
              <Lead>Введіть 6-значний код із застосунку-автентифікатора</Lead>
            </div>
            {error ? <ErrorBox error={error} /> : null}
            <Card>
              <Field label="Код" required>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={7}
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="tabular-nums tracking-[0.3em]"
                />
              </Field>
            </Card>
            <ActionGroup>
              <Act hint="Далі — ваш кабінет">
                <Button type="submit" loading={busy} disabled={busy || code.replace(/\s/g, '').length !== 6}>
                  Підтвердити
                </Button>
              </Act>
              <Button
                type="button"
                variant="ghost"
                onClick={() => (setMfaToken(null), setCode(''), setError(null))}
              >
                Назад
              </Button>
            </ActionGroup>
          </form>
        ) : (
          <form onSubmit={submit} aria-label="Вхід" className="grid gap-6">
            <div className="grid gap-2">
              <h1 className="m-0 text-h1">Вхід</h1>
              {/* текст моку припускає код для всіх; у прототипі код вводить лише HR (80A) — формулювання «?» */}
              <Lead>Логін і пароль; HR далі вводить код із застосунку-автентифікатора</Lead>
            </div>
            {error ? (
              authError ? (
                <Alert variant="danger" title="Логін або пароль не підходять">
                  Перевірте розкладку й регістр. Якщо не допомагає — зверніться до підтримки
                </Alert>
              ) : (
                <ErrorBox error={error} />
              )
            ) : null}
            <Card>
              <div className="grid gap-(--field-gap)">
                <Field label="Логін (ел. пошта)" required>
                  <Input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Пароль" required>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </div>
            </Card>
            <ActionGroup>
              <Act hint={filled ? 'Далі — ваш кабінет' : 'Введіть логін і пароль'}>
                <Button
                  type="submit"
                  loading={busy}
                  aria-disabled={!filled || busy || undefined}
                  onClick={(e) => (!filled || busy) && e.preventDefault()}
                >
                  Увійти
                </Button>
              </Act>
            </ActionGroup>
            {/* «Не вдається увійти» — поза скоупом зрізу 1 (інвентар §3.10); рядок коду про реєстрацію лишається */}
            <p className="m-0 max-w-[56ch] text-meta text-muted-foreground">
              Кандидатам: зареєструватися можна лише за посиланням-запрошенням від HR.
            </p>
          </form>
        )}
      </main>
    </div>
  )
}
