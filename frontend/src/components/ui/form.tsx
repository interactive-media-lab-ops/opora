/** Поля форм: Input, Textarea, Select, Field, Checkbox, Radio. */
import * as React from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { cx } from './format'
import { FOCUS_FIELD } from './shared'

/* ------------------------------------------------------------------------------------------------
 * Поля — КС .cf-input / .cf-textarea / .cf-select: фон card, межа input, радіус field (4), висота --control-h,
 * плейсхолдер foreground-disabled, фокус — межа border-accent + кільце без відступу, помилка — межа status-danger-border
 * (ставиться через aria-invalid — Field робить це сам), disabled — muted + 0.45, readOnly — muted + межа border (73A).
 * ---------------------------------------------------------------------------------------------- */
const FIELD_BASE =
  'block w-full h-(--control-h) px-(--pad-x) rounded-field border border-input bg-card text-foreground ' +
  'font-sans text-(length:--control-fs) leading-[1.4] placeholder:text-foreground-disabled ' +
  'transition-[border-color] duration-(--op-duration-fast) ease-(--op-ease-standard) ' +
  'focus:border-border-accent ' +
  FOCUS_FIELD +
  ' aria-invalid:border-status-danger-border ' +
  'disabled:bg-muted disabled:text-foreground-disabled disabled:opacity-(--op-opacity-disabled)'

// readOnly (73A) — лише для текстових полів: <select> завжди :read-only за CSS, тож йому ці стилі не можна (зріз 1: «Напрям» у анкеті виглядав вимкненим)
const FIELD_READONLY = 'read-only:bg-muted read-only:border-border'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(FIELD_BASE, FIELD_READONLY, className)} {...rest} />
})

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(
        FIELD_BASE,
        FIELD_READONLY,
        'h-auto min-h-[calc(var(--control-h)*2.5)] py-(--pad-y) resize-y',
        className,
      )}
      {...rest}
    />
  )
})

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

/** className — на обгортку (ширина, відступи): так шеврон лишається всередині поля, коли ширину обмежено (`max-w-md`). */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <span className={cx('relative grid', className)}>
      <select
        ref={ref}
        className={cx(
          FIELD_BASE,
          'peer appearance-none cursor-pointer pr-[calc(var(--pad-x)+var(--op-icon-md)+0.25rem)] disabled:cursor-default',
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={20}
        strokeWidth={1.5}
        className="pointer-events-none absolute right-(--pad-x) top-0 bottom-0 my-auto text-muted-foreground peer-disabled:opacity-(--op-opacity-disabled)"
      />
    </span>
  )
})

/* ------------------------------------------------------------------------------------------------
 * Field — КС .cf-field: підпис 13/500 над полем, підказка 12 foreground-tertiary, помилка 12 status-danger-text з іконкою;
 * зірочка обов'язковості — status-danger-text (КС). Підказку й помилку зв'язує aria-describedby, помилка ставить aria-invalid.
 * ---------------------------------------------------------------------------------------------- */
export interface FieldProps {
  label: React.ReactNode
  hint?: React.ReactNode
  required?: boolean
  /** Додатково: текст помилки «що сталося + що робити»; підсвічує поле й оголошує через role="alert". */
  error?: React.ReactNode
  /** Додатково: id поля, якщо дитина не одна або має власний id. */
  htmlFor?: string
  className?: string
  children: React.ReactNode
}

export function Field({ label, hint, required, error, htmlFor, className, children }: FieldProps) {
  const autoId = React.useId()
  const hintId = `${autoId}-hint`
  const errorId = `${autoId}-error`
  let control = children
  let controlId = htmlFor
  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown>>
    controlId = (child.props.id as string | undefined) ?? htmlFor ?? autoId
    const describedBy = [
      hint ? hintId : null,
      error ? errorId : null,
      child.props['aria-describedby'] as string | undefined,
    ]
      .filter(Boolean)
      .join(' ')
    control = React.cloneElement(child, {
      id: controlId,
      'aria-describedby': describedBy || undefined,
      'aria-invalid': error ? true : (child.props['aria-invalid'] as boolean | undefined),
      'aria-required': required || undefined,
    })
  }
  return (
    <div className={cx('grid content-start gap-1', className)}>
      <label htmlFor={controlId} className="text-label font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-status-danger-text" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="m-0 text-caption text-foreground-tertiary">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="m-0 flex items-center gap-1 text-caption text-status-danger-text"
        >
          <AlertCircle aria-hidden="true" size={14} strokeWidth={1.5} className="shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Checkbox / Radio — КС .cf-checkbox / .cf-radio 1:1 (18 px, межа input, обране — primary з галочкою primary-foreground);
 * вигляд галочки — клас .op-check / .op-radio з index.css 9.8. Рядок-ціль ≥44 px, підпис — звичайний текст.
 * ---------------------------------------------------------------------------------------------- */
export interface CheckProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode
  /** Підказка або помилка під підписом (помилка підсвічує межу через aria-invalid). */
  hint?: React.ReactNode
  error?: React.ReactNode
}

function CheckBase({
  kind,
  label,
  hint,
  error,
  className,
  id,
  ...rest
}: CheckProps & { kind: 'checkbox' | 'radio' }) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  const descId = `${inputId}-desc`
  return (
    <div className={cx('grid gap-1', className)}>
      <label
        htmlFor={inputId}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 py-2 text-body has-[input:disabled]:cursor-default has-[input:disabled]:opacity-(--op-opacity-disabled)"
      >
        <input
          id={inputId}
          type={kind}
          className={kind === 'checkbox' ? 'op-check' : 'op-radio'}
          aria-invalid={error ? true : rest['aria-invalid']}
          aria-describedby={hint || error ? descId : rest['aria-describedby']}
          {...rest}
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      </label>
      {(error || hint) && (
        <p
          id={descId}
          role={error ? 'alert' : undefined}
          className={cx(
            'm-0 ml-7 flex items-center gap-1 text-caption',
            error ? 'text-status-danger-text' : 'text-foreground-tertiary',
          )}
        >
          {error && <AlertCircle aria-hidden="true" size={14} strokeWidth={1.5} className="shrink-0" />}
          <span>{error ?? hint}</span>
        </p>
      )}
    </div>
  )
}

export function Checkbox(props: CheckProps) {
  return <CheckBase kind="checkbox" {...props} />
}

export function Radio(props: CheckProps) {
  return <CheckBase kind="radio" {...props} />
}
