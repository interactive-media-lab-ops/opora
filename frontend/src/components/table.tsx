/** Примітиви таблиць: DataTable, Th/Td, сортований заголовок, скелет. */
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Icon, Skeleton, cx } from './ui'

/** Таблиця КС (.dt в index.css): справжній <table>, на ≤640 px рядки стають картками. */
export function DataTable({
  caption,
  busy,
  children,
}: {
  caption: string
  busy?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0 overflow-auto rounded-card border border-border bg-card">
      <table className="dt" aria-busy={busy || undefined}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export function Th({
  priority,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { priority?: 2 | 3 }) {
  return <th scope="col" data-priority={priority} className={className} {...rest} />
}

/** label — підпис комірки в картковому вигляді на телефоні; lead — перша комірка рядка (ім'я/посилання). */
export function Td({
  label,
  priority,
  lead,
  actions,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  label?: string
  priority?: 2 | 3
  lead?: boolean
  actions?: boolean
}) {
  return (
    <td
      data-label={label}
      data-priority={priority}
      className={cx(lead && 'dt-title', actions && 'dt-actions', className)}
      {...rest}
    />
  )
}

/** Рядки скелетів на час завантаження. */
export function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Skeleton />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/** Заголовок із сортуванням: кнопка в th, aria-sort на th (components.md §2). Напрямок один на колонку (dir; сервер — лише спадання). */
export function SortTh({
  active,
  dir = 'descending',
  onSort,
  priority,
  className,
  children,
}: {
  active: boolean
  dir?: 'ascending' | 'descending'
  onSort: () => void
  priority?: 2 | 3
  className?: string
  children: ReactNode
}) {
  return (
    <th scope="col" data-priority={priority} aria-sort={active ? dir : 'none'} className={className}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-inherit uppercase tracking-[inherit] [font:inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
        <Icon
          icon={active ? (dir === 'ascending' ? ArrowUp : ArrowDown) : ArrowUpDown}
          size={14}
          className={active ? '' : 'opacity-50'}
        />
      </button>
    </th>
  )
}
