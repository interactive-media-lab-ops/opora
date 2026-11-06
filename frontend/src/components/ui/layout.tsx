/** Поверхні й розмітка: Card, PageHeader, Sheet, Act, ActionGroup, MetaRow. */
import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cx, fmtShort } from './format'
import { Badge } from './status'

/* ------------------------------------------------------------------------------------------------
 * Card — КС .cf-card: фон card, межа border, радіус card (8), БЕЗ тіні (тінь лише в перекриттів).
 * Без title — просто поверхня з відступом --gap (16). З title — шапка з межею знизу (52 px), тіло, за потреби підвал.
 * Вкладені картки заборонені (DD-33): усередині картки — блоки sunken (bg-muted), а не ще одна Card.
 * ---------------------------------------------------------------------------------------------- */
export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Додатково: заголовок шапки (h3 за замовчуванням). */
  title?: React.ReactNode
  /** Додатково: короткий підпис праворуч у шапці (foreground-tertiary, переноситься — 71A). */
  meta?: React.ReactNode
  /** Додатково: дії в шапці (кнопки-іконки, secondary). */
  actions?: React.ReactNode
  /** Додатково: підвал з межею зверху (дії; primary у картці не береться — DD-37). */
  footer?: React.ReactNode
  /** Додатково: заглиблений блок усередині іншої картки (bg-muted, без межі). */
  sunken?: boolean
  /** Додатково: вибрана (межа border-accent + тон accent). */
  selected?: boolean
  /** Додатково: виділена лише межею border-accent, фон card (99A: блок «Ваше рішення» в H6). */
  accent?: boolean
  as?: 'div' | 'section' | 'article'
}

export function Card({
  title,
  meta,
  actions,
  footer,
  sunken,
  selected,
  accent,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  const surface = cx(
    'flex min-w-0 flex-col rounded-card border text-card-foreground',
    sunken
      ? 'border-transparent bg-muted'
      : selected
        ? 'border-border-accent bg-accent'
        : accent
          ? 'border-border-accent bg-card'
          : 'border-border bg-card',
  )
  if (!title && !actions && !footer) {
    return (
      <Tag className={cx(surface, 'p-(--gap)', className)} {...rest}>
        {children}
      </Tag>
    )
  }
  return (
    <Tag className={cx(surface, className)} {...rest}>
      {(title || actions) && (
        <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-(--gap) py-3">
          {/* заголовок не ламається всередині слова: росте, але не стискається; довга мета переноситься рядком нижче (K-5 / 71A) */}
          {title && (
            <h3 className="m-0 max-w-full min-w-0 flex-[1_0_auto] text-lg font-semibold leading-[1.3]">
              {title}
            </h3>
          )}
          {meta && (
            <span className="min-w-0 flex-[0_1_auto] text-label text-foreground-tertiary [overflow-wrap:anywhere]">
              {meta}
            </span>
          )}
          {actions && <div className="ml-auto flex shrink-0 gap-2">{actions}</div>}
        </div>
      )}
      {/* тіло лише коли є вміст: картка «заголовок + підвал» (LinkCard C5) без порожньої смуги */}
      {children != null && children !== false && (
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-(--gap)">{children}</div>
      )}
      {footer && (
        <div
          className={cx(
            'flex items-center gap-2 px-(--gap) py-3 max-sm:flex-col max-sm:items-stretch',
            children != null && children !== false && 'border-t border-border',
          )}
        >
          {footer}
        </div>
      )}
    </Tag>
  )
}

/* ------------------------------------------------------------------------------------------------
 * PageHeader — заголовок сторінки (моки H5/H6/C3): h1 1.75/600, підзаголовок meta muted-foreground до 68ch,
 * дії праворуч; на телефоні дії стають стовпцем на всю ширину (правило 6 PrimaryAction).
 * Правило DD-37: якщо на екрані є головна дія — вона тут (одна), інакше дії лише secondary/ghost.
 * ---------------------------------------------------------------------------------------------- */
export interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="grid min-w-0 gap-1.5">
        <h1 className="m-0 text-h1 font-semibold [overflow-wrap:anywhere] text-balance">{title}</h1>
        {subtitle && (
          <p className="m-0 max-w-[68ch] text-meta text-muted-foreground text-pretty">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
          {actions}
        </div>
      )}
    </header>
  )
}

/** Підзаголовок сторінки (.mk-lead моків): кегль h3, накреслення 400, до 56ch. */
export function Lead({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cx('m-0 max-w-[56ch] text-h3 font-normal leading-normal text-pretty', className)}>
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Act / ActionGroup — DD-37 (D4): дія + підказка «що станеться далі» (.ks-act + .cf-hint); група дій — одна головна,
 * другорядні поруч; на ≤640 px — стовпець, усі на всю ширину. Головна щонайменше 12.5rem (.ks-actions > primary).
 * Підказку зв'язано з кнопкою через aria-describedby. Недоступна з причиною — aria-disabled + причина замість підказки (4B).
 * ---------------------------------------------------------------------------------------------- */
export interface ActProps {
  /** Підказка під дією (0.75rem, foreground-tertiary). */
  hint?: React.ReactNode
  /** Вирівнювання підказки під дією (end — для групи дій праворуч). */
  align?: 'start' | 'end'
  /** На ≤640 px дія розтягується на всю ширину (типово); false — лишається за вмістом (композер розмови). */
  fluid?: boolean
  className?: string
  hintClassName?: string
  /** Одна кнопка або посилання. */
  children: React.ReactElement<{ 'aria-describedby'?: string; className?: string }>
}

export function Act({ hint, align = 'start', fluid = true, className, hintClassName, children }: ActProps) {
  const id = React.useId()
  const child = hint
    ? React.cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })
    : children
  return (
    <span
      className={cx(
        'inline-grid min-w-0 gap-1',
        align === 'end' ? 'justify-items-end text-right' : 'justify-items-start',
        fluid && 'max-sm:w-full max-sm:justify-items-stretch',
        className,
      )}
    >
      {child}
      {hint && (
        <span id={id} className={cx('text-caption text-foreground-tertiary', hintClassName)}>
          {hint}
        </span>
      )}
    </span>
  )
}

export function ActionGroup({
  className,
  align,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'end' | 'between' }) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-wrap items-start gap-x-6 gap-y-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-3',
        align === 'end' && 'justify-end',
        align === 'between' && 'justify-between',
        '[&_button.bg-primary]:min-w-[12.5rem] [&_a.bg-primary]:min-w-[12.5rem] max-sm:[&_a]:w-full max-sm:[&_button]:w-full',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Sheet — нижній лист (мок H5 390, 62A / рішення 4B): нативний <dialog>, на ≤640 px притиснутий до низу на всю ширину
 * (верхні кути modal, до 85dvh, прокрутка всередині), на ширших — звичайне вікно по центру. Esc і клік по підкладці закривають.
 * ---------------------------------------------------------------------------------------------- */
export interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  /** Підвал: дії (secondary / ghost; primary у листі фільтрів не береться — екран читання, 38A). */
  footer?: React.ReactNode
  children: React.ReactNode
}

export function Sheet({ open, title, onClose, footer, children }: SheetProps) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const id = React.useId()
  React.useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto flex max-h-[85dvh] w-full max-w-none flex-col rounded-t-modal border-0 bg-popover p-0 text-foreground shadow-modal backdrop:bg-scrim open:flex sm:m-auto sm:max-h-[min(85dvh,40rem)] sm:w-[min(calc(100%-3rem),32rem)] sm:rounded-modal"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 px-5 pt-4 pb-3">
            <h2 id={id} className="m-0 flex-1 text-h2 font-semibold">
              {title}
            </h2>
            <Button variant="ghost" icon={X} aria-label="Закрити" title="Закрити" onClick={onClose} />
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  )
}

/* ------------------------------------------------------------------------------------------------
 * MetaRow — рядок мети (.ks-meta): «джерело: … · оновлено дд.мм, чч:хх» + тег «методологія vN» (0.8125rem, foreground-tertiary).
 * ---------------------------------------------------------------------------------------------- */
export interface MetaRowProps {
  source?: React.ReactNode
  updated?: string | number | Date | null
  version?: string | number | null
  items?: React.ReactNode[]
  className?: string
}

export function MetaRow({ source, updated, version, items = [], className }: MetaRowProps) {
  const parts: React.ReactNode[] = []
  if (source) parts.push(<>джерело: {source}</>)
  if (updated)
    parts.push(
      <>
        оновлено <time dateTime={new Date(updated).toISOString()}>{fmtShort(updated)}</time>
      </>,
    )
  parts.push(...items)
  if (parts.length === 0 && version == null) return null
  return (
    <p
      className={cx(
        'm-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-label text-foreground-tertiary',
        className,
      )}
    >
      {parts.length > 0 && (
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {parts.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {p}
            </React.Fragment>
          ))}
        </span>
      )}
      {version != null && (
        <Badge tone="outline" square>
          методологія v{version}
        </Badge>
      )}
    </p>
  )
}
