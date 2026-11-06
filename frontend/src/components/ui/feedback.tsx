/** Зворотний зв'язок: Alert, ErrorBox, Skeleton, Spinner, EmptyState. */
import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Inbox, Loader2, type LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { cx } from './format'

/* ------------------------------------------------------------------------------------------------
 * Alert (додатковий експорт) і ErrorBox — КС .cf-alert: тон status-*-bg, межа status-*-border, текст status-*-text,
 * радіус card (8), 14 px, іконка 20. danger має role="alert" і не закривається (помилка стоїть, доки не виправлена).
 * Використання: ErrorBox — помилки; Alert warning — банер «працюєте як кандидат», «методологія заморожена»; Alert info — підказки.
 * ---------------------------------------------------------------------------------------------- */
export type AlertVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant
  title?: React.ReactNode
  /** Дії в кольорі повідомлення (КС: посилання/кнопки-посилання). */
  actions?: React.ReactNode
  icon?: LucideIcon | null
}

const ALERT_TONE: Record<AlertVariant, string> = {
  neutral: 'border-border bg-muted text-foreground',
  info: 'border-status-info-border bg-status-info-bg text-status-info-text',
  success: 'border-status-success-border bg-status-success-bg text-status-success-text',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger-text',
}

const ALERT_ICON: Record<AlertVariant, LucideIcon | null> = {
  neutral: null,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
}

export function Alert({
  variant = 'neutral',
  title,
  actions,
  icon,
  className,
  children,
  role,
  ...rest
}: AlertProps) {
  const Ico = icon === undefined ? ALERT_ICON[variant] : icon
  return (
    <div
      role={role ?? (variant === 'danger' ? 'alert' : 'status')}
      className={cx('flex gap-3 rounded-card border px-4 py-3 text-meta', ALERT_TONE[variant], className)}
      {...rest}
    >
      {Ico && <Icon icon={Ico} size={20} className="mt-px" />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="m-0 font-semibold">{title}</p>}
        {children && <div className="[&>p]:m-0">{children}</div>}
        {actions && (
          <div className="mt-1 flex flex-wrap gap-3 font-medium [&_a]:text-inherit [&_button]:text-inherit">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export interface ErrorBoxProps extends Omit<AlertProps, 'variant'> {
  /** Текст помилки (альтернатива children). */
  message?: React.ReactNode
  /** Об'єкт помилки з запиту (ApiError / Error / будь-що); порожнє значення — нічого не показуємо. */
  error?: unknown
}

export function ErrorBox({ message, error, children, ...rest }: ErrorBoxProps) {
  let text = children ?? message
  if (text == null || text === false) {
    if (!error) return null
    // TypeError з fetch — немає зв'язку із сервером; сирий «Failed to fetch» користувачу не показуємо
    text =
      error instanceof TypeError
        ? 'Немає зв’язку із сервером. Перевірте інтернет і спробуйте ще раз.'
        : error instanceof Error
          ? error.message
          : 'Сталася помилка'
  }
  return (
    <Alert variant="danger" {...rest}>
      {text}
    </Alert>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Skeleton (додатковий експорт) і Spinner — КС: скелет із хвилею 1,4 с на ролях --skeleton / --skeleton-shine;
 * Spinner за замовчуванням = блок скелетів із прихованим статусом; через 2 с текст стає видимим (патерн Loading).
 * Рядок «Завантаження…» збережено як у коді. inline — малий спінер для кнопок і рядків.
 * ---------------------------------------------------------------------------------------------- */
export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'text' | 'rect' | 'circle'
  /** Кількість рядків для variant="text" (останній — 60 % ширини). */
  lines?: number
  width?: number | string
  height?: number | string
}

const SKELETON_BASE =
  'relative block overflow-hidden bg-skeleton ' +
  'after:absolute after:inset-0 after:-translate-x-full after:bg-[linear-gradient(90deg,transparent,var(--skeleton-shine),transparent)] ' +
  'after:animate-[op-shimmer_1.4s_infinite] motion-reduce:after:animate-none'

export function Skeleton({
  variant = 'text',
  lines = 1,
  width,
  height,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (variant === 'text') {
    return (
      <span className={cx('block', className)} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={cx(SKELETON_BASE, 'my-[0.35em] h-[0.875em] rounded-check last:w-3/5')}
            style={{ width }}
          />
        ))}
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cx(SKELETON_BASE, variant === 'circle' ? 'rounded-full' : 'rounded-card', className)}
      style={{
        width: width ?? (variant === 'circle' ? 40 : undefined),
        height: height ?? (variant === 'circle' ? 40 : 96),
        ...style,
      }}
      {...rest}
    />
  )
}

export interface SpinnerProps {
  /** Текст статусу; за замовчуванням «Завантаження…» (рядок коду). */
  label?: string
  /** inline — лише обертова дуга + прихований текст (для кнопок, комірок). */
  inline?: boolean
  /** Кількість рядків скелета (блочний варіант). */
  lines?: number
  /** Через скільки мс показати текст видимо (патерн Loading: 2000). */
  slowAfter?: number | false
  className?: string
}

export function Spinner({
  label = 'Завантаження…',
  inline = false,
  lines = 3,
  slowAfter = 2000,
  className,
}: SpinnerProps) {
  const [slow, setSlow] = React.useState(slowAfter === false)
  React.useEffect(() => {
    if (slowAfter === false) return
    const t = window.setTimeout(() => setSlow(true), slowAfter)
    return () => window.clearTimeout(t)
  }, [slowAfter])
  if (inline) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cx('inline-flex items-center gap-2 text-meta text-muted-foreground', className)}
      >
        <Loader2
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="animate-spin motion-reduce:animate-none"
        />
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cx('grid gap-3 py-4', className)}>
      <Skeleton lines={lines} />
      <span className={slow ? 'text-meta text-muted-foreground' : 'sr-only'}>{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * EmptyState — КС .cf-empty: по центру, іконка в колі 48 (muted / foreground-tertiary), заголовок 18/600,
 * текст 14 до 44ch, дії по центру; compact — для порожнього результату всередині таблиці чи картки (63A).
 * Пунктирна рамка старого компонента прибрана (у дизайні її немає). Текст: що сталося + що робити.
 * ---------------------------------------------------------------------------------------------- */
export interface EmptyStateProps {
  title?: React.ReactNode
  /** Пояснення (альтернатива children). */
  text?: React.ReactNode
  children?: React.ReactNode
  icon?: LucideIcon | null
  /** Одна дія (secondary у HR-екранах читання — 38A). */
  action?: React.ReactNode
  secondary?: React.ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({
  title,
  text,
  children,
  icon = Inbox,
  action,
  secondary,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-3 text-center text-muted-foreground',
        compact ? 'p-6' : 'px-6 py-12',
        className,
      )}
    >
      {icon && (
        <span className="grid size-12 place-content-center rounded-full bg-muted text-foreground-tertiary">
          <Icon icon={icon} size={24} />
        </span>
      )}
      {title && <p className="m-0 text-lg font-semibold leading-[1.3] text-foreground">{title}</p>}
      {(text ?? children) && <div className="m-0 max-w-[44ch] text-meta [&>p]:m-0">{text ?? children}</div>}
      {(action || secondary) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
