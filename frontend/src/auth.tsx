/** Стан автентифікації: токени, поточний користувач, ролі, домашні сторінки ролей. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, request, tokens } from './api/client'
import { clearPersistedCache } from './lib/persist'
import type { MfaRequired, MfaSetupRequired, Role, Tokens, User } from './api/types'

interface AuthState {
  user: User | null
  loading: boolean
  /** true, якщо адмін зараз працює від імені демо-кандидата */
  impersonating: boolean
  /** Повертає користувача, `{ mfaToken }` (потрібен код 2FA, далі — completeMfa) або `{ setupToken }` (2FA ще не налаштована, H2). */
  login: (email: string, password: string) => Promise<User | { mfaToken: string } | { setupToken: string }>
  completeMfa: (mfaToken: string, code: string) => Promise<User>
  /** H2: генерує секрет для першого налаштування 2FA під час входу. */
  startMfaSetup: (setupToken: string) => Promise<{ secret: string; otpauth_uri: string }>
  /** H2: підтверджує перший код, вмикає 2FA і виконує вхід. */
  completeMfaSetup: (setupToken: string, code: string) => Promise<User>
  register: (data: {
    code: string
    email: string
    password: string
    password_confirm: string
    name: string
    consents: { kind: 'personal_data' | 'offer'; version: string; accepted_at: string }[]
  }) => Promise<User>
  logout: () => void
  impersonate: (userId: number) => Promise<User>
  stopImpersonation: () => Promise<User>
}

const AuthContext = createContext<AuthState | null>(null)

const ADMIN_BACKUP_KEY = 'opora.admin-backup'
const USER_KEY = 'opora.user'

// останній відомий користувач: без мережі застосунок відкривається з ним, а не викидає на вхід
function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}
function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* сховище недоступне */
  }
}

type AdminBackup = { access: string; refresh: string }

function readBackup(): AdminBackup | null {
  try {
    const raw = localStorage.getItem(ADMIN_BACKUP_KEY)
    return raw ? (JSON.parse(raw) as AdminBackup) : null
  } catch {
    return null
  }
}

export const HOME_BY_ROLE: Record<Role, string> = {
  ADMIN: '/admin/users',
  METHODOLOGIST: '/methodologist/methodologies',
  HR: '/hr',
  CANDIDATE: '/candidate',
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Адміністратор',
  METHODOLOGIST: 'Методист',
  HR: 'HR',
  CANDIDATE: 'Кандидат',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(tokens.access))
  const [impersonating, setImpersonating] = useState(() => readBackup() !== null)

  useEffect(() => {
    if (!tokens.access) return
    api
      .get<User>('/auth/me')
      .then((me) => (cacheUser(me), setUser(me)))
      .catch((err) => {
        if (!(err instanceof ApiError)) {
          // немає зв'язку із сервером: лишаємося в кабінеті з останнім відомим користувачем
          const cached = readCachedUser()
          if (cached) return setUser(cached)
        }
        tokens.clear()
        cacheUser(null)
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onLogout = () => {
      cacheUser(null)
      void clearPersistedCache()
      localStorage.removeItem(ADMIN_BACKUP_KEY)
      setImpersonating(false)
      setUser(null)
    }
    window.addEventListener('opora:logout', onLogout)
    return () => window.removeEventListener('opora:logout', onLogout)
  }, [])

  const finishAuth = useCallback(async (t: Tokens) => {
    tokens.set(t.access_token, t.refresh_token)
    const me = await api.get<User>('/auth/me')
    cacheUser(me)
    setUser(me)
    return me
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      impersonating,
      login: async (email, password) => {
        const t = await request<Tokens | MfaRequired | MfaSetupRequired>('/auth/login', {
          method: 'POST',
          json: { email, password },
          auth: false,
        })
        if ('mfa_required' in t) return { mfaToken: t.mfa_token }
        if ('mfa_setup_required' in t) return { setupToken: t.setup_token }
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
        return finishAuth(t)
      },
      completeMfa: async (mfaToken, code) => {
        const t = await request<Tokens>('/auth/login/2fa', {
          method: 'POST',
          json: { mfa_token: mfaToken, code },
          auth: false,
        })
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
        return finishAuth(t)
      },
      startMfaSetup: (setupToken) =>
        request<{ secret: string; otpauth_uri: string }>('/auth/2fa/setup', {
          method: 'POST',
          json: { setup_token: setupToken },
          auth: false,
        }),
      completeMfaSetup: async (setupToken, code) => {
        const t = await request<Tokens>('/auth/2fa/enable', {
          method: 'POST',
          json: { setup_token: setupToken, code },
          auth: false,
        })
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
        return finishAuth(t)
      },
      register: async (data) => {
        const t = await request<Tokens>('/auth/register', { method: 'POST', json: data, auth: false })
        return finishAuth(t)
      },
      logout: () => {
        tokens.clear()
        cacheUser(null)
        void clearPersistedCache()
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
        setUser(null)
      },
      impersonate: async (userId) => {
        const res = await api.post<{ access_token: string; user: User }>(`/users/${userId}/impersonate`)
        // токени адміна зберігаємо, щоб повернутися без повторного входу
        localStorage.setItem(
          ADMIN_BACKUP_KEY,
          JSON.stringify({ access: tokens.access ?? '', refresh: tokens.refresh ?? '' }),
        )
        tokens.set(res.access_token, '')
        setImpersonating(true)
        cacheUser(res.user)
        setUser(res.user)
        return res.user
      },
      stopImpersonation: async () => {
        const backup = readBackup()
        if (!backup) throw new Error('Немає збереженого сеансу адміна')
        localStorage.removeItem(ADMIN_BACKUP_KEY)
        setImpersonating(false)
        return finishAuth({ access_token: backup.access, refresh_token: backup.refresh })
      },
    }),
    [user, loading, impersonating, finishAuth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth поза AuthProvider')
  return ctx
}
