/** Реєстрація кандидата за запрошенням. */
import { Clock, LayoutGrid, Link2, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'
import { HOME_BY_ROLE, useAuth } from '../../auth'
import { MinimalHeader } from '../../components/Layout'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBox,
  Field,
  Icon,
  Input,
  Lead,
  Spinner,
} from '../../components/ui'

interface InvitePreview {
  methodology_title: string
  personal: boolean
  candidate_email: string | null
}

/**
 * Реєстрація кандидата — C1 (DD-38 51B, DD-44 84A): дві колонки (пояснення | «Новий акаунт»), картки «Дані для входу»
 * (+ «Повторіть пароль» — перевірка на клієнті, D-46) і «Згода й оферта» (дві окремі обов'язкові згоди, тексти — «?» від Романа);
 * головна «Зареєструватися» недоступна з причиною, доки згоди не позначено. Недійсний код — патерн системних станів (DD-39).
 * Повтор пароля й згоди (версія 'draft') ідуть на сервер — BR-1.
 */
export function Register() {
  const { code = '' } = useParams()
  const { register, logout, user } = useAuth()
  const navigate = useNavigate()
  const invite = useQuery({
    queryKey: ['invite', code],
    queryFn: () => api.get<InvitePreview>(`/auth/invite/${encodeURIComponent(code)}`),
    retry: false,
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [consentData, setConsentData] = useState(false)
  const [consentOffer, setConsentOffer] = useState(false)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const lockedEmail = invite.data?.candidate_email ?? null
  const mismatch = password2.length > 0 && password !== password2
  const consents = consentData && consentOffer
  const ready =
    consents &&
    !mismatch &&
    name.trim() &&
    (lockedEmail ?? email).trim() &&
    password.length >= 8 &&
    password2.length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      // BR-1: сервер перевіряє повтор пароля й зберігає згоди з часом і версією тексту; поки тексти від Романа не затверджені — версія 'draft'
      const acceptedAt = new Date().toISOString()
      const me = await register({
        code,
        name: name.trim(),
        email: (lockedEmail ?? email).trim(),
        password,
        password_confirm: password2,
        consents: [
          { kind: 'personal_data', version: 'draft', accepted_at: acceptedAt },
          { kind: 'offer', version: 'draft', accepted_at: acceptedAt },
        ],
      })
      navigate(HOME_BY_ROLE[me.role], { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const end = !user && (
    <Button variant="ghost" icon={LogIn} onClick={() => navigate('/login')}>
      Увійти
    </Button>
  )

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MinimalHeader end={end} />
      <main className="mx-auto w-full max-w-[75rem] min-w-0 flex-1 px-6 py-6 max-sm:px-4">
        {invite.isLoading && <Spinner />}
        {invite.isError && (
          // патерн P (BR-2): «використано» → головна «Увійти»; «термін минув» і «недійсне» — без головної (наступний крок поза системою)
          <div className="mx-auto w-full max-w-[36rem]">
            {invite.error instanceof ApiError && invite.error.reason === 'used' ? (
              <EmptyState
                icon={Link2}
                title="Посилання вже використано"
                text="За цим запрошенням уже створено акаунт. Якщо він ваш — увійдіть з логіном і паролем"
                action={<Button onClick={() => navigate('/login')}>Увійти</Button>}
              />
            ) : invite.error instanceof ApiError && invite.error.reason === 'expired' ? (
              <EmptyState
                icon={Link2}
                title="Термін дії посилання минув"
                text="Це запрошення більше не відкривається. Попросіть HR надіслати нове"
                secondary={
                  <Button variant="ghost" onClick={() => navigate('/login')}>
                    Увійти
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Link2}
                title="Посилання недійсне"
                text="Перевірте, чи скопійовано адресу повністю. Посилання на реєстрацію ви отримали в запрошенні; якщо воно не працює — попросіть HR про нове"
                secondary={
                  <Button variant="ghost" onClick={() => navigate('/login')}>
                    Увійти
                  </Button>
                }
              />
            )}
          </div>
        )}
        {invite.data && user && (
          <div className="mx-auto w-full max-w-[36rem]">
            <Alert
              variant="neutral"
              title={`Ви вже ввійшли як ${user.email}`}
              actions={
                <Button variant="secondary" size="sm" onClick={logout}>
                  Вийти
                </Button>
              }
            >
              Щоб зареєструватися за цим запрошенням, спершу вийдіть
            </Alert>
          </div>
        )}
        {invite.data && !user && (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,35rem)] items-start gap-x-16 gap-y-8 max-sm:grid-cols-1 max-sm:gap-6">
            <div className="grid min-w-0 gap-5">
              <h1 className="m-0 text-h1">Реєстрація</h1>
              <Lead>Ви перейшли за запрошенням на оцінювання «{invite.data.methodology_title}»</Lead>
              <ul aria-label="Що буде після реєстрації" className="m-0 grid max-w-[40ch] list-none gap-3 p-0">
                <li className="flex items-start gap-3">
                  <Icon icon={LayoutGrid} size={24} className="text-muted-foreground" />
                  <span>Потрапите на головну зі своїми етапами оцінювання</span>
                </li>
                <li className="flex items-start gap-3">
                  <Icon icon={Clock} size={24} className="text-muted-foreground" />
                  <span>Заповнюватимете етапи у своєму темпі: збережене не губиться</span>
                </li>
              </ul>
            </div>
            <Card as="section" title="Новий акаунт" meta="усі поля обов’язкові" aria-label="Новий акаунт">
              <form onSubmit={submit} noValidate aria-label="Реєстрація" className="grid min-w-0 gap-4">
                {/* «Увійти через WorkSection» (D-59) — поза скоупом зрізу 1 (інвентар §3.5) */}
                <Card sunken title="Дані для входу">
                  <div className="grid gap-(--field-gap)">
                    <Field
                      label="Ім’я та прізвище"
                      required
                      error={tried && !name.trim() ? 'Вкажіть ім’я та прізвище' : undefined}
                    >
                      <Input
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </Field>
                    <Field
                      label="Логін (ел. пошта)"
                      required
                      hint={lockedEmail ? 'Запрошення видано на цю адресу' : undefined}
                      error={tried && !(lockedEmail ?? email).trim() ? 'Вкажіть електронну пошту' : undefined}
                    >
                      <Input
                        type="email"
                        required
                        autoComplete="username"
                        value={lockedEmail ?? email}
                        readOnly={Boolean(lockedEmail)}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Пароль"
                      required
                      hint="Щонайменше 8 символів"
                      error={
                        tried && password.length < 8
                          ? 'Пароль закороткий: потрібно щонайменше 8 символів'
                          : undefined
                      }
                    >
                      <Input
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Повторіть пароль"
                      required
                      error={
                        mismatch || (tried && !password2)
                          ? 'Паролі не збігаються. Введіть той самий пароль двічі'
                          : undefined
                      }
                    >
                      <Input
                        type="password"
                        required
                        autoComplete="new-password"
                        value={password2}
                        onChange={(e) => setPassword2(e.target.value)}
                      />
                    </Field>
                  </div>
                </Card>
                <Card sunken title="Згода й оферта">
                  <div className="grid gap-2">
                    {/* тексти згоди й оферти — від Романа (84A, DD-44): тут заповнювачі «?» */}
                    <p className="m-0 text-meta text-muted-foreground">
                      [Текст згоди: що збираємо, хто бачить, як використовуються результати — ?]
                    </p>
                    <Checkbox
                      label="Погоджуюсь на обробку персональних даних і ознайомився з правилами обробки [посилання — ?]"
                      checked={consentData}
                      onChange={(e) => setConsentData(e.target.checked)}
                      error={tried && !consentData ? 'Позначте згоду, щоб продовжити' : undefined}
                    />
                    <Checkbox
                      label="Приймаю умови публічної оферти [посилання — ?]"
                      checked={consentOffer}
                      onChange={(e) => setConsentOffer(e.target.checked)}
                      error={tried && !consentOffer ? 'Позначте згоду, щоб продовжити' : undefined}
                    />
                  </div>
                </Card>
                {error ? <ErrorBox error={error} /> : null}
                <ActionGroup>
                  <Act
                    hint={
                      ready
                        ? 'Далі — головна з вашими етапами'
                        : consents
                          ? 'Заповніть усі поля, щоб продовжити'
                          : 'Позначте обидві згоди, щоб продовжити'
                    }
                  >
                    <Button type="submit" loading={busy} aria-disabled={!ready || busy || undefined}>
                      Зареєструватися
                    </Button>
                  </Act>
                </ActionGroup>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
