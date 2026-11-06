/** Форматування дат, назв і класів. */

/** Формат дати: «26 жовт. 2026 р., 14:30» (як у поточному коді). */
export function fmtDate(iso: string | number | Date | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

/** Дата без часу, дд.мм.рррр — для реєстрів (таблиць). */
export function fmtDay(iso: string | number | Date | null | undefined): string {
  return iso
    ? new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'
}

/** Дата в рядку таблиці (мок H5 «Оновлено»): «дд.мм», повна дата — у title і dateTime. */
export function DayCell({ iso }: { iso: string | number | Date | null | undefined }) {
  if (!iso) return <span className="text-foreground-tertiary">—</span>
  const d = new Date(iso)
  return (
    <time dateTime={d.toISOString()} title={fmtDay(d)} className="tabular-nums">
      {d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}
    </time>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Службове
 * ---------------------------------------------------------------------------------------------- */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------------------------------------
 * Avatar — ініціали на тональному крузі (мок H5 / H6): 32 px у рядку таблиці, 48 px у шапці профілю.
 * Фото немає (лише вигадані дані, DD-03); ініціали — перші літери двох перших слів ПІБ.
 * ---------------------------------------------------------------------------------------------- */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** «дд.мм, чч:хх» для рядка мети (мок: «11.10, 14:21»). */
export function fmtShort(iso: string | number | Date): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`
}

/** Відмінок слова «етап» після числа: 1 етап · 2–4 етапи · 5+ етапів. */
export function etapy(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'етап'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'етапи'
  return 'етапів'
}
