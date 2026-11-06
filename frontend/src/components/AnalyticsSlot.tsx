/** Блок аналітики кандидата: радар за принципами лідерства та супутні показники. */
import { useMemo, useState } from 'react'
import type { Analytics } from '../api/types'
import { Alert, Card, EmptyState, cx } from './ui'

const W = 520 // поле під довгі підписи осей ліворуч/праворуч («Розвиток людей» обрізалось)
const H = 390
const CX = W / 2
const CY = 190
const R = 132

/** Штрих і заливка серії: колір + малюнок, щоб розрізнялись без кольору (chart-n, chart-n-dash). */
const color = (i: number) => `var(--chart-${(i % 5) + 1})`
const dash = (i: number) => `var(--chart-${(i % 5) + 1}-dash)`

function wrap(label: string, max = 14): string[] {
  const words = label.split(/\s+/)
  const lines: string[] = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last && (last + ' ' + w).length <= max) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
  }
  const out = lines.slice(0, 2)
  if (lines.length > 2) out[1] = out[1].slice(0, max - 1) + '…'
  return out
}

/** Зразок серії в легенді — та сама лінія зі штрихом (--chart-n-dash), якою серію малюють і радар, і смуги: ряди розрізняються не лише кольором (1.4.1). */
function Swatch({ i }: { i: number }) {
  return (
    <svg width="28" height="10" aria-hidden>
      <line
        x1="1"
        y1="5"
        x2="27"
        y2="5"
        stroke={color(i)}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ strokeDasharray: dash(i) }}
      />
    </svg>
  )
}

function Radar({ a, active }: { a: Analytics; active: Set<string> }) {
  const n = a.axes.length
  const ang = (k: number) => -Math.PI / 2 + (k * 2 * Math.PI) / n
  const pt = (k: number, v: number) =>
    [CX + Math.cos(ang(k)) * R * (v / a.scale_max), CY + Math.sin(ang(k)) * R * (v / a.scale_max)] as const
  const rings = [0.25, 0.5, 0.75, 1].map((f) => f * a.scale_max) // 4 кільця, як у макеті
  const valueOf = (key: string, ax: string) => a.series.find((s) => s.source === key)?.values[ax] ?? null
  const shownSources = a.sources.filter((s) => active.has(s.key))
  // Значення — тим, хто не бачить діаграму (таблиці під радаром немає): «Джерело: вісь — значення; …»
  const summary = shownSources
    .map(
      (s) =>
        `${s.label}: ${a.axes.map((ax) => `${ax} — ${valueOf(s.key, ax) ?? 'немає оцінки'}`).join('; ')}`,
    )
    .join('. ')
  // Підписи значень біля вершин, назовні від вершини. Якщо на одній осі кілька близьких значень — розсуваємо їх
  // вздовж осі навколо вершин (однакові значення зливаємо в один підпис) і не пускаємо далі за обідок,
  // щоб не наїжджати на назву осі.
  const valueLabels = a.axes.flatMap((ax, k) => {
    const c = Math.cos(ang(k))
    const s = Math.sin(ang(k))
    const off = 11 + 9 * Math.abs(c) // від точки значення; горизонтальні осі — більший відступ: цифри ширші за висоту
    const gap = 12 + 8 * Math.abs(c)
    const maxLr = R + 4 - 8 * Math.abs(c)
    const items = [
      ...new Set(shownSources.map((src) => valueOf(src.key, ax)).filter((v): v is number => v != null)),
    ]
      .sort((p, q) => p - q)
      .map((v) => ({ v, lr: (R * v) / a.scale_max + off }))
    for (let pass = 0; pass < 40; pass++) {
      let moved = false
      for (let j = 1; j < items.length; j++) {
        const d = items[j].lr - items[j - 1].lr
        if (d < gap - 0.1) {
          items[j - 1].lr -= (gap - d) / 2
          items[j].lr += (gap - d) / 2
          moved = true
        }
      }
      for (const it of items) it.lr = Math.min(Math.max(it.lr, 8), maxLr)
      if (!moved) break
    }
    return items.map((it) => ({ key: `${ax}-${it.v}`, x: CX + c * it.lr, y: CY + s * it.lr, v: it.v }))
  })
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Радар за ${n} осями: ${a.axes.join(', ')}. ${summary}`}
    >
      {rings.map((r) => (
        <polygon
          key={r}
          points={a.axes.map((_, k) => pt(k, r).join(',')).join(' ')}
          fill="none"
          stroke="var(--chart-grid)"
          strokeWidth="1"
        />
      ))}
      {a.axes.map((label, k) => {
        const [x, y] = pt(k, a.scale_max)
        const [lx, ly] = [CX + Math.cos(ang(k)) * (R + 14), CY + Math.sin(ang(k)) * (R + 14)]
        const anchor = Math.abs(Math.cos(ang(k))) < 0.2 ? 'middle' : Math.cos(ang(k)) > 0 ? 'start' : 'end'
        const lines = wrap(label)
        const dy =
          Math.sin(ang(k)) > 0.5
            ? 10
            : Math.sin(ang(k)) < -0.5
              ? -(lines.length - 1) * 13 - 2
              : -(lines.length - 1) * 6.5 + 4
        return (
          <g key={label}>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={lx} y={ly + dy} textAnchor={anchor} fontSize="12" fill="var(--foreground)">
              <title>{label}</title>
              {lines.map((t, i) => (
                <tspan key={i} x={lx} dy={i === 0 ? 0 : 13}>
                  {t}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
      {a.sources.map((src, i) => {
        if (!active.has(src.key)) return null
        const vals = a.series.find((s) => s.source === src.key)?.values ?? {}
        const pts = a.axes.map((ax, k) => (vals[ax] == null ? null : pt(k, vals[ax] as number)))
        const present = pts.filter((p): p is readonly [number, number] => p != null)
        if (present.length === 0) return null
        const full = present.length === n && n >= 3
        if (full) {
          return (
            <g key={src.key}>
              {/* мок H6: контур 2 px з малюнком штриха, заливка 0.12, без точок; значення — підписами біля вершин (нижче, поверх усіх серій) */}
              <path
                d={`M ${present.map((p) => p.join(',')).join(' L ')} Z`}
                fill={color(i)}
                fillOpacity="0.12"
                stroke={color(i)}
                strokeWidth="2"
                strokeLinejoin="round"
                style={{ strokeDasharray: dash(i) }}
              />
            </g>
          )
        }
        // Частковий ряд (бали не на всіх осях): контур не замкнути, тож кожен бал — промінь від центру до значення + точка;
        // сусідні бали ще й з'єднані відрізком. Раніше одиночний бал не малювався зовсім (діаграма «порожня»).
        const seg = pts
          .map((p, k) =>
            p && pts[(k + 1) % n] && n >= 3 ? `M ${p.join(',')} L ${pts[(k + 1) % n]!.join(',')}` : '',
          )
          .join(' ')
        return (
          <g key={src.key}>
            {seg.trim() && (
              <path
                d={seg}
                fill="none"
                stroke={color(i)}
                strokeWidth="2"
                strokeLinejoin="round"
                style={{ strokeDasharray: dash(i) }}
              />
            )}
            {present.map((p, j) => (
              <line
                key={`r${j}`}
                x1={CX}
                y1={CY}
                x2={p[0]}
                y2={p[1]}
                stroke={color(i)}
                strokeWidth="3"
                strokeLinecap="round"
                style={{ strokeDasharray: dash(i) }}
              />
            ))}
            {present.map((p, j) => (
              <circle
                key={`c${j}`}
                cx={p[0]}
                cy={p[1]}
                r="4.5"
                fill={color(i)}
                stroke="var(--card)"
                strokeWidth="1.5"
              />
            ))}
          </g>
        )
      })}
      {valueLabels.map((l) => (
        <text
          key={l.key}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="11"
          fontWeight="600"
          fill="var(--foreground)"
          stroke="var(--card)"
          strokeWidth="3"
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {l.v}
        </text>
      ))}
    </svg>
  )
}

/**
 * Смуги за макетом H6: назва принципу (осі) ліворуч, праворуч — по лінії на КОЖНЕ увімкнене джерело (етап: самоподача, розмова, відгуки…)
 * в однаковому порядку, колір і малюнок штриха серії — як у словнику; значення числом праворуч від лінії. Немає балу від джерела —
 * рядок лишається з «—», щоб під кожним принципом було видно всі етапи. Окремої таблиці значень немає (власник, 02.11).
 */
function Bars({ a, active }: { a: Analytics; active: Set<string> }) {
  const shownSources = a.sources.map((src, i) => ({ src, i })).filter(({ src }) => active.has(src.key))
  const valueOf = (key: string, ax: string) => a.series.find((s) => s.source === key)?.values[ax] ?? null
  const summary = a.axes
    .map(
      (ax) =>
        `${ax}: ${shownSources.map(({ src }) => `${src.label} — ${valueOf(src.key, ax) ?? 'немає оцінки'}`).join(', ') || 'немає оцінки'}`,
    )
    .join('. ')
  return (
    <div
      className="grid gap-5"
      role="img"
      aria-label={`Оцінки за принципами, шкала 0–${a.scale_max}. ${summary}`}
    >
      {a.axes.map((ax) => (
        <div key={ax} className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start">
          <span className="text-meta font-medium">{ax}</span>
          {shownSources.length === 0 ? (
            <span className="text-meta text-foreground-tertiary">Немає оцінки</span>
          ) : (
            <div className="grid gap-1.5 sm:pt-0.5">
              {shownSources.map(({ src, i }) => {
                const v = valueOf(src.key, ax)
                const pct = v == null ? 0 : Math.max(0, Math.min(100, (v / a.scale_max) * 100))
                return (
                  <div
                    key={src.key}
                    className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3"
                    title={`${src.label}: ${v ?? 'немає оцінки'}`}
                  >
                    <svg className="block h-2 w-full overflow-visible" aria-hidden>
                      {v != null && pct > 0 && (
                        <line
                          x1="0"
                          y1="50%"
                          x2={`${pct}%`}
                          y2="50%"
                          stroke={color(i)}
                          strokeWidth="6"
                          style={{ strokeDasharray: dash(i) }}
                        />
                      )}
                    </svg>
                    <span
                      className={cx(
                        'text-right text-label tabular-nums',
                        v == null ? 'text-foreground-tertiary' : 'font-medium',
                      )}
                    >
                      {v ?? '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Слот аналітики (DD-06, D6) за моком H6: шапка «Аналітика · мета» + перемикач «Радар | Смуги» (сегменти КС, стартове значення —
 * з конфігурації методології), ліворуч — діаграма, праворуч — словник джерел (чипи-перемикачі зі зразком штриха + пояснення),
 * рядок «Осі», стан «даних ще немає». Таблиці значень немає в жодному виді (власник, 02.11): на радарі значення підписані біля вершин,
 * у «Смугах» — по лінії на кожне джерело під кожним принципом зі значенням числом; текстовий опис — в aria-label обох видів.
 * Діаграма має однакову ширину в обох видах (max-w-[36rem], по центру колонки). Дані й логіка — без змін.
 */
export function AnalyticsSlot({ a }: { a: Analytics }) {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(a.sources.filter((s) => s.has_data).map((s) => s.key)),
  )
  const [mode, setMode] = useState<Analytics['mode']>(a.mode)
  const none = a.sources_with_data === 0
  const meta = a.fallback
    ? 'за підсумковими оцінками'
    : a.sources_with_data === a.sources_total
      ? 'за всіма етапами'
      : `за ${a.sources_with_data} з ${a.sources_total} джерел`
  const toggle = (key: string) =>
    setActive((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const shown = useMemo(
    () => new Set([...active].filter((k) => a.sources.find((s) => s.key === k)?.has_data)),
    [active, a.sources],
  )

  if (!a.configured) {
    return (
      <Card title="Аналітика">
        <EmptyState compact title="Аналітика ще не налаштована">
          Методолог не задав осі аналітики, а підсумкових оцінок за вузлами немає.
        </EmptyState>
      </Card>
    )
  }

  const seg = (m: Analytics['mode'], label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className="h-11 rounded-full px-4 text-[0.9375rem] font-medium text-foreground hover:bg-secondary-hover aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  )

  return (
    <Card
      title="Аналітика"
      meta={meta}
      actions={
        <div role="group" aria-label="Вид діаграми" className="inline-flex rounded-full bg-muted p-1">
          {seg('radar', 'Радар')}
          {seg('bars', 'Смуги')}
        </div>
      }
    >
      {none && (
        <Alert variant="info">
          Даних ще немає — аналіз не завершено. Діаграма заповниться, коли будуть оцінки.
        </Alert>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div
          className={cx(
            'mx-auto w-full min-w-0 max-w-[36rem]',
            mode === 'radar' ? 'self-center' : 'self-start',
          )}
        >
          {mode === 'radar' ? <Radar a={a} active={shown} /> : <Bars a={a} active={shown} />}
        </div>
        <dl className="m-0 grid content-start gap-4" aria-label="Джерела">
          {a.sources.map((s, i) => (
            <div key={s.key} className="grid gap-1.5">
              <dt>
                {/* КС .ks-fchip: secondary-чип зі зразком штриха; увімкнене джерело — тон accent + межа border-accent */}
                <button
                  type="button"
                  aria-pressed={shown.has(s.key)}
                  disabled={!s.has_data}
                  title={s.has_data ? s.hint : 'Даних ще немає — етап не опрацьовано'}
                  onClick={() => toggle(s.key)}
                  className={cx(
                    'inline-flex h-(--control-h) items-center gap-2 rounded-control border px-3 text-[0.9375rem] font-medium text-foreground',
                    'border-border bg-card hover:bg-secondary-hover aria-pressed:border-border-accent aria-pressed:bg-accent',
                    'disabled:cursor-not-allowed disabled:opacity-(--op-opacity-disabled) disabled:hover:bg-card',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  )}
                >
                  <Swatch i={i} />
                  {s.label}
                </button>
              </dt>
              <dd className="m-0 text-label text-muted-foreground">
                {s.has_data ? s.hint : 'Даних ще немає — етап не опрацьовано'}
              </dd>
            </div>
          ))}
          <div className="grid gap-1">
            <dt className="text-label font-medium">Осі</dt>
            <dd className="m-0 text-label text-muted-foreground">
              {a.axes.join(' · ')} — назви дає методолог
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  )
}
