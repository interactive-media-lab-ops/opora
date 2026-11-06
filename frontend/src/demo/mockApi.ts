/**
 * Демо-бекенд для огляду дизайну без сервера (лише збірка з VITE_DEMO=1, у продукт не потрапляє).
 * Перехоплює fetch('/api/…') і відповідає вигаданими даними (DD-03); стан живе в localStorage цього браузера.
 * Покриває зрізи 1–2: вхід, реєстрація, кабінет кандидата, рекомендації, сторінка рекомендатора.
 */
import type {
  CandidateAssessment,
  CandidateRecommendations,
  PublicRecommendation,
  StageInfo,
  StageKey,
  User,
} from '../api/types'

type State = {
  userId: number | null
  users: User[]
  assessments: Record<number, CandidateAssessment>
  recs: Record<number, CandidateRecommendations>
  tokens: Record<string, { userId: number; slot: number; status: 'PENDING' | 'USED' | 'EXPIRED' }>
}

const KEY = 'opora.demo.state'
const PASSWORD = 'ChangeMe123!'

const profile_fields = [
  { id: 1, label: 'Посада', type: 'TEXT', options: null, required: true, order: 1 },
  {
    id: 2,
    label: 'Напрям',
    type: 'SELECT',
    options: ['Культура в громадах', 'Кіно та документалістика', 'Тури'],
    required: true,
    order: 2,
  },
  { id: 3, label: 'Дата початку роботи', type: 'DATE', options: null, required: false, order: 3 },
  { id: 4, label: 'Коротко про себе', type: 'TEXTAREA', options: null, required: false, order: 4 },
] as CandidateAssessment['profile_fields']
const quiz_questions = [
  {
    id: 11,
    text: 'Що для вас важливіше в роботі?',
    type: 'SINGLE_CHOICE',
    options: ['Результат', 'Команда', 'Розвиток', 'Стабільність'],
    order: 1,
  },
  {
    id: 12,
    text: 'Які формати роботи вам підходять?',
    type: 'MULTI_CHOICE',
    options: ['Польові виїзди', 'Офіс', 'Віддалено'],
    order: 2,
  },
  { id: 13, text: 'Оцініть вашу стресостійкість', type: 'SCALE', options: [1, 10], order: 3 },
  {
    id: 14,
    text: 'Опишіть ситуацію, коли довелося ухвалювати рішення за команду',
    type: 'TEXT',
    options: null,
    order: 4,
  },
] as CandidateAssessment['quiz_questions']
const interview_questions = [
  {
    id: 21,
    text: 'Опишіть випадок, коли ви допомогли незадоволеній людині.',
    hint: 'Що було, що ви зробили, чим закінчилось.',
    max_duration_sec: 90,
    order: 1,
  },
  {
    id: 22,
    text: 'Чому ви хочете працювати саме в цьому напрямі?',
    hint: 'Достатньо 1 хвилини.',
    max_duration_sec: 90,
    order: 2,
  },
  { id: 23, text: 'Як ви пояснюєте людям непопулярне рішення?', hint: '', max_duration_sec: 120, order: 3 },
] as CandidateAssessment['interview_questions']

const stage = (key: StageKey, title: string, status: StageInfo['status'], n: number): StageInfo => ({
  key,
  title,
  status,
  updated_at: status === 'SUBMITTED' ? '2026-10-27T14:20:00' : null,
  methodology_version: status === 'SUBMITTED' ? 1 : null,
  question_count: n,
  can_edit: key === 'PROFILE' && status === 'SUBMITTED',
  can_retake: key !== 'PROFILE' && status === 'SUBMITTED',
})

function assessment(
  id: number,
  p: StageInfo['status'],
  q: StageInfo['status'],
  i: StageInfo['status'],
): CandidateAssessment {
  const all = p === 'SUBMITTED' && q === 'SUBMITTED' && i === 'SUBMITTED'
  return {
    id,
    recommendations_enabled: true,
    methodology_version: 1,
    methodology_title: 'Менеджер з продажів (демо)',
    allow_rerecord: true,
    max_record_attempts: 3,
    stage: all ? 'DONE' : 'IN_PROGRESS',
    stages: [
      stage('PROFILE', 'Анкета', p, 4),
      stage('QUIZ', 'Опитувальник', q, 4),
      stage('INTERVIEW', 'Розмова', i, 3),
    ],
    profile_fields,
    profile_answers:
      p === 'NOT_STARTED'
        ? {}
        : {
            1: 'координаторка програм',
            2: 'Культура в громадах',
            3: '2024-03-01',
            4: 'Працюю з громадами з 2022 року.',
          },
    quiz_questions,
    quiz_answers:
      q === 'NOT_STARTED'
        ? {}
        : {
            11: 'Команда',
            12: ['Польові виїзди', 'Віддалено'],
            13: 7,
            14: 'Під час туру змінили маршрут через обстріл.',
          },
    interview_questions,
    voice:
      i === 'NOT_STARTED'
        ? []
        : [
            {
              question_id: 21,
              attempts_used: 1,
              attempts_left: 2,
              can_rerecord: true,
              duration_sec: 63,
              kind: 'VOICE',
              text: '',
              can_record: true,
            },
            ...(i === 'SUBMITTED'
              ? [
                  {
                    question_id: 22,
                    attempts_used: 0,
                    attempts_left: 3,
                    can_rerecord: true,
                    duration_sec: 0,
                    kind: 'TEXT' as const,
                    text: 'Бо тут можна поєднати досвід із сенсом.',
                    can_record: true,
                  },
                  {
                    question_id: 23,
                    attempts_used: 1,
                    attempts_left: 2,
                    can_rerecord: true,
                    duration_sec: 95,
                    kind: 'VOICE' as const,
                    text: '',
                    can_record: true,
                  },
                ]
              : []),
          ],
  }
}

function recs(userId: number, used: number): CandidateRecommendations {
  return {
    enabled: true,
    total: 4,
    used,
    links: [1, 2, 3, 4].map((slot) => ({
      slot,
      status: slot <= used ? 'USED' : 'PENDING',
      token: slot <= used ? null : `demo${userId}-${slot}`,
      expires_at: slot <= used ? null : '2026-11-26T00:00:00',
      expired: false,
    })),
  }
}

function fresh(): State {
  const users: User[] = [
    {
      id: 1,
      email: 'demo.profile@opora.example',
      name: 'Демо: на етапі анкети',
      role: 'CANDIDATE',
      is_active: true,
      is_demo: true,
    },
    {
      id: 2,
      email: 'demo.quiz@opora.example',
      name: 'Демо: на етапі опитувальника',
      role: 'CANDIDATE',
      is_active: true,
      is_demo: true,
    },
    {
      id: 3,
      email: 'demo.interview@opora.example',
      name: "Демо: на етапі інтерв'ю",
      role: 'CANDIDATE',
      is_active: true,
      is_demo: true,
    },
    {
      id: 4,
      email: 'olena.kovalenko@opora.example',
      name: 'Олена Коваленко',
      role: 'CANDIDATE',
      is_active: true,
    },
  ]
  const s: State = {
    userId: null,
    users,
    assessments: {
      1: assessment(1, 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'),
      2: assessment(2, 'SUBMITTED', 'NOT_STARTED', 'NOT_STARTED'),
      3: assessment(3, 'SUBMITTED', 'SUBMITTED', 'IN_PROGRESS'),
      4: assessment(4, 'SUBMITTED', 'SUBMITTED', 'SUBMITTED'),
    },
    recs: { 1: recs(1, 0), 2: recs(2, 0), 3: recs(3, 2), 4: recs(4, 4) },
    tokens: {},
  }
  for (const [uid, r] of Object.entries(s.recs))
    for (const l of r.links)
      if (l.token) s.tokens[l.token] = { userId: Number(uid), slot: l.slot, status: 'PENDING' }
  s.tokens['used'] = { userId: 4, slot: 1, status: 'USED' }
  s.tokens['old'] = { userId: 4, slot: 2, status: 'EXPIRED' }
  return s
}

let state: State = (() => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    /* ignore */
  }
  return fresh()
})()
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const err = (status: number, detail: string) => json({ detail }, status)
const me = () => state.users.find((u) => u.id === state.userId) ?? null

async function handle(path: string, method: string, body: unknown, headers: Headers): Promise<Response> {
  const auth = headers.get('Authorization')
  if (auth?.startsWith('Bearer demo-')) state.userId = Number(auth.slice(12)) || null
  const user = me()

  if (path === '/auth/login' && method === 'POST') {
    const { email, password } = body as { email: string; password: string }
    const u = state.users.find((x) => x.email === email.toLowerCase())
    if (!u || password !== PASSWORD) return err(401, 'Невірна електронна пошта або пароль')
    state.userId = u.id
    save()
    return json({ access_token: `demo-${u.id}`, refresh_token: `demo-${u.id}` })
  }
  if (path === '/auth/refresh')
    return user
      ? json({ access_token: `demo-${user.id}`, refresh_token: `demo-${user.id}` })
      : err(401, 'Потрібна авторизація')
  if (path === '/auth/me') return user ? json(user) : err(401, 'Потрібна авторизація')
  if (path.startsWith('/auth/invite/')) {
    const code = decodeURIComponent(path.slice('/auth/invite/'.length))
    if (code === 'demo')
      return json({ methodology_title: 'Менеджер з продажів (демо)', personal: false, candidate_email: null })
    if (code === 'personal')
      return json({
        methodology_title: 'Менеджер з продажів (демо)',
        personal: true,
        candidate_email: 'nova@opora.example',
      })
    return err(404, 'Запрошення не знайдено або вже використане')
  }
  if (path === '/auth/register' && method === 'POST') {
    const { email, name } = body as { email: string; name: string }
    if (state.users.some((u) => u.email === email.toLowerCase()))
      return err(409, 'Користувач із такою поштою вже існує')
    const id = Math.max(...state.users.map((u) => u.id)) + 1
    state.users.push({ id, email: email.toLowerCase(), name, role: 'CANDIDATE', is_active: true })
    state.assessments[id] = assessment(id, 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED')
    state.recs[id] = recs(id, 0)
    for (const l of state.recs[id].links)
      if (l.token) state.tokens[l.token] = { userId: id, slot: l.slot, status: 'PENDING' }
    state.userId = id
    save()
    return json({ access_token: `demo-${id}`, refresh_token: `demo-${id}` })
  }

  // рекомендатор — без входу
  const rec = /^\/recommend\/([^/]+)(\/(submit|decline))?$/.exec(path)
  if (rec) {
    const t = state.tokens[decodeURIComponent(rec[1])]
    if (!t) return err(404, 'Посилання не знайдено')
    if (t.status === 'USED') return err(410, 'Посилання вже використано')
    if (t.status === 'EXPIRED') return err(410, 'Термін дії посилання минув')
    if (rec[3]) {
      t.status = 'USED'
      const r = state.recs[t.userId]
      const l = r.links.find((x) => x.slot === t.slot)
      if (l) {
        l.status = 'USED'
        l.token = null
        l.expires_at = null
      }
      r.used = r.links.filter((x) => x.status === 'USED').length
      save()
      return json({ ok: true })
    }
    const page: PublicRecommendation = {
      organization: 'Опора для Культурних Сил',
      roles: [
        { id: 'MANAGER', label: 'Керівник' },
        { id: 'COLLEAGUE', label: 'Колега' },
        { id: 'SUBORDINATE', label: 'Підлеглий' },
      ],
      questions: [
        {
          id: 1,
          text: 'Опишіть ситуацію, коли ця людина взяла відповідальність за рішення команди.',
          hint: 'Що сталося, що вона зробила, чим закінчилось.',
        },
        { id: 2, text: 'Як ця людина поводиться, коли думки в команді розходяться?', hint: '' },
        { id: 3, text: 'Що б ви порадили їй розвивати як лідеру?', hint: 'Достатньо кількох речень.' },
      ],
    }
    return json(page)
  }

  if (!user) return err(401, 'Потрібна авторизація')
  const a = state.assessments[user.id]
  const r = state.recs[user.id]
  if (!a) return err(403, 'Демо покриває лише кабінет кандидата (зрізи 1–2)')
  const st = (k: StageKey) => a.stages.find((s) => s.key === k)!
  const touch = (s: StageInfo, status: StageInfo['status']) => {
    s.status = status
    if (status === 'SUBMITTED') {
      s.updated_at = new Date().toISOString()
      s.methodology_version = 1
    }
    s.can_edit = s.key === 'PROFILE' && status === 'SUBMITTED'
    s.can_retake = s.key !== 'PROFILE' && status === 'SUBMITTED'
    a.stage = a.stages.every((x) => x.status === 'SUBMITTED') ? 'DONE' : 'IN_PROGRESS'
  }
  const answersOf = (b: unknown) =>
    Object.fromEntries(
      ((b as { answers: { question_id: number; value: unknown }[] }).answers ?? []).map((x) => [
        x.question_id,
        x.value,
      ]),
    )

  if (path === '/candidate/assessment') return json(a)
  if (path === '/candidate/assessment/profile' && method === 'PUT') {
    a.profile_answers = answersOf(body) as Record<string, string>
    if (st('PROFILE').status === 'NOT_STARTED') touch(st('PROFILE'), 'IN_PROGRESS')
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/profile/submit') {
    touch(st('PROFILE'), 'SUBMITTED')
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/quiz' && method === 'PUT') {
    a.quiz_answers = answersOf(body)
    if (st('QUIZ').status === 'NOT_STARTED') touch(st('QUIZ'), 'IN_PROGRESS')
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/quiz/submit') {
    touch(st('QUIZ'), 'SUBMITTED')
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/quiz/retake') {
    touch(st('QUIZ'), 'NOT_STARTED')
    a.quiz_answers = {}
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/interview/retake') {
    touch(st('INTERVIEW'), 'NOT_STARTED')
    a.voice = []
    save()
    return json(a)
  }
  const ans = /^\/candidate\/assessment\/interview\/(\d+)\/(text|audio)$/.exec(path)
  if (ans) {
    const qid = Number(ans[1])
    const v = a.voice.find((x) => x.question_id === qid)
    const text = ans[2] === 'text' ? ((body as { text?: string })?.text ?? '') : ''
    const entry = {
      question_id: qid,
      attempts_used: ans[2] === 'audio' ? (v?.attempts_used ?? 0) + 1 : (v?.attempts_used ?? 0),
      attempts_left: ans[2] === 'audio' ? Math.max((v?.attempts_left ?? 3) - 1, 0) : (v?.attempts_left ?? 3),
      can_rerecord: true,
      duration_sec: ans[2] === 'audio' ? 42 : 0,
      kind: ans[2] === 'audio' ? ('VOICE' as const) : ('TEXT' as const),
      text,
      can_record: true,
    }
    a.voice = [...a.voice.filter((x) => x.question_id !== qid), entry]
    if (st('INTERVIEW').status === 'NOT_STARTED') touch(st('INTERVIEW'), 'IN_PROGRESS')
    save()
    return json(a)
  }
  if (path === '/candidate/assessment/interview/submit') {
    touch(st('INTERVIEW'), 'SUBMITTED')
    save()
    return json(a)
  }
  if (path === '/candidate/recommendations') return json(r)
  const renew = /^\/candidate\/recommendations\/(\d+)\/renew$/.exec(path)
  if (renew) {
    const l = r.links.find((x) => x.slot === Number(renew[1]))
    if (l?.token) delete state.tokens[l.token]
    if (l) {
      l.token = `demo${user.id}-${l.slot}-${Date.now().toString(36)}`
      l.expires_at = new Date(Date.now() + 30 * 864e5).toISOString()
      l.expired = false
      state.tokens[l.token] = { userId: user.id, slot: l.slot, status: 'PENDING' }
    }
    save()
    return json(r)
  }
  if (path === '/account/2fa') return json({ available: false, enabled: false })
  return err(404, 'Демо-бекенд не знає цього запиту')
}

export function installMockApi() {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(url, location.href)
    if (!u.pathname.startsWith('/api/')) return real(input, init)
    const method = init?.method ?? 'GET'
    let body: unknown = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = null
      }
    }
    const headers = new Headers(init?.headers ?? {})
    await new Promise((r) => setTimeout(r, 120))
    return handle(u.pathname.replace(/^\/api/, ''), method, body, headers)
  }
}
