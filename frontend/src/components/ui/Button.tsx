/** Кнопки: Button і CopyButton. */
import * as React from 'react'
import { Check, Copy, Loader2, type LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { cx } from './format'
import { FOCUS } from './shared'

/* ------------------------------------------------------------------------------------------------
 * Button — КС .cf-btn: висота --control-h (36; на дотику 44), радіус control (8), 500, без переносу тексту.
 * primary — заливка primary, текст ink; secondary — контурна (межа input, фон card); ghost — прозора;
 * danger — destructive, стани фільтром яскравості (КС 1:1). sm — 28 px лише з точним вказівником; на дотику 44 (K-4, DD-22).
 * Одна primary на екран (DD-37). Контурного primary не існує (1B).
 * ---------------------------------------------------------------------------------------------- */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Додатково: показує спінер замість вмісту й блокує натискання; підпис не змінюється (КС). */
  loading?: boolean
  /** Додатково: іконка ліворуч (lucide), 20 px / 16 px у sm. */
  icon?: LucideIcon
}

const BUTTON_BASE =
  'relative inline-flex items-center justify-center gap-2 h-(--control-h) px-[calc(var(--pad-x)+0.25rem)] ' +
  'rounded-control border text-foreground ' +
  'font-sans font-medium text-(length:--control-fs) leading-[1.2] whitespace-nowrap select-none cursor-pointer ' +
  'transition-colors duration-(--op-duration-fast) ease-(--op-ease-standard) ' +
  FOCUS +
  ' disabled:opacity-(--op-opacity-disabled) disabled:pointer-events-none aria-disabled:opacity-(--op-opacity-disabled) aria-disabled:pointer-events-none ' +
  'aria-busy:pointer-events-none'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed',
  secondary: 'bg-card text-foreground border-input hover:bg-secondary-hover active:bg-muted',
  ghost: 'border-transparent bg-transparent text-foreground hover:bg-secondary-hover active:bg-muted',
  danger:
    'border-transparent bg-destructive text-destructive-foreground hover:brightness-[0.93] active:brightness-[0.86]',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: '',
  // КС compact 28 px; на сенсорному — 44 (виняток 71A / K-4 з КС 1:1)
  sm: '[--control-h:1.75rem] [--control-fs:0.875rem] [--pad-x:0.5rem] gap-1 pointer-coarse:[--control-h:2.75rem]',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && !loading && <Icon icon={icon} size={size === 'sm' ? 16 : 20} />}
      <span className={cx('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-content-center" aria-hidden="true">
          <Loader2
            size={size === 'sm' ? 16 : 20}
            strokeWidth={2}
            className="animate-spin motion-reduce:animate-none"
          />
        </span>
      )}
    </button>
  )
})

/* ------------------------------------------------------------------------------------------------
 * CopyButton — secondary з іконкою; після копіювання ~2 с показує «Скопійовано ✓» (рядок коду), оголошує через aria-live.
 * Ширина не стрибає: обидва підписи лежать в одній клітинці сітки, видимий лише поточний (правило «сталий розмір», 21.10).
 * ---------------------------------------------------------------------------------------------- */
export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'value'> {
  /** Текст для копіювання. */
  text: string
  /** Підпис у спокої (перенести з поточного коду, якщо він там є). */
  children?: React.ReactNode
  /** Алиас children (старий пропс). */
  label?: React.ReactNode
  copiedLabel?: React.ReactNode
  resetAfter?: number
}

export function CopyButton({
  text,
  label,
  children = label ?? 'Скопіювати',
  copiedLabel = 'Скопійовано ✓',
  resetAfter = 2000,
  variant = 'secondary',
  icon,
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    if (!copied && !failed) return
    const t = window.setTimeout(() => (setCopied(false), setFailed(false)), resetAfter)
    return () => window.clearTimeout(t)
  }, [copied, failed, resetAfter])
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // http без TLS: буфер недоступний — пробуємо старий спосіб через тимчасове поле
      const field = document.createElement('textarea')
      field.value = text
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      try {
        if (document.execCommand('copy')) setCopied(true)
        else setFailed(true)
      } catch {
        setFailed(true)
      }
      field.remove()
    }
  }
  return (
    <Button
      variant={variant}
      icon={copied ? Check : (icon ?? Copy)}
      onClick={copy}
      aria-live="polite"
      {...rest}
    >
      <span className="inline-grid">
        <span
          className={cx('col-start-1 row-start-1', (copied || failed) && 'invisible')}
          aria-hidden={copied || failed || undefined}
        >
          {children}
        </span>
        <span
          className={cx('col-start-1 row-start-1', !copied && !failed && 'invisible')}
          aria-hidden={(!copied && !failed) || undefined}
        >
          {failed ? 'Скопіюйте вручну' : copiedLabel}
        </span>
      </span>
    </Button>
  )
}
