/** HTTP-клієнт до бекенду: токени, оновлення сесії, обробка помилок, завантаження файлів. */
const ACCESS_KEY = 'opora.access'
const REFRESH_KEY = 'opora.refresh'

export class ApiError extends Error {
  status: number
  /** Машинозчитувана причина 410: `used` | `expired` (BR-2) */
  reason?: string
  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string }
    return first.msg ?? 'Некоректні дані'
  }
  if (status === 401) return 'Потрібна авторизація'
  if (status === 403) return 'Недостатньо прав'
  return `Помилка запиту (${status})`
}

let refreshing: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  const refresh = tokens.refresh
  if (!refresh) return false
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) return false
      const data = await res.json()
      tokens.set(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

type Options = { method?: string; json?: unknown; form?: FormData; auth?: boolean }

async function rawRequest(path: string, opts: Options): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && tokens.access) headers.Authorization = `Bearer ${tokens.access}`
  return fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  })
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  let res = await rawRequest(path, opts)
  if (res.status === 401 && opts.auth !== false && (await tryRefresh())) {
    res = await rawRequest(path, opts)
  }
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* тіло не JSON */
    }
    if (res.status === 401 && opts.auth !== false) {
      tokens.clear()
      window.dispatchEvent(new Event('opora:logout'))
    }
    const reason = (body as { reason?: unknown } | null)?.reason
    throw new ApiError(
      res.status,
      errorMessage(body, res.status),
      typeof reason === 'string' ? reason : undefined,
    )
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function fetchBlob(path: string): Promise<Blob> {
  let res = await rawRequest(path, {})
  if (res.status === 401 && (await tryRefresh())) res = await rawRequest(path, {})
  if (!res.ok) throw new ApiError(res.status, errorMessage(null, res.status))
  return res.blob()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json: json ?? {} }),
  put: <T>(path: string, json: unknown) => request<T>(path, { method: 'PUT', json }),
  patch: <T>(path: string, json: unknown) => request<T>(path, { method: 'PATCH', json }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
}
