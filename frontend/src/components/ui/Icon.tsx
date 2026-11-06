/** Іконка, логотип-знак і аватар. */
import { type LucideIcon } from 'lucide-react'
import { cx, initials } from './format'

/** Іконка дизайн-системи: 24-та сітка, штрих 1.5, aria-hidden. */
export function Icon({
  icon: Cmp,
  size = 20,
  className,
}: {
  icon: LucideIcon
  size?: number
  className?: string
}) {
  return (
    <Cmp
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={1.5}
      className={cx('shrink-0', className)}
    />
  )
}

/* ================================================================================================
 * Етап 8 · зріз 1 (DD-42/43): примітиви, які потрібні кільком сторінкам кандидата (хаб, етапи, вхід, реєстрація).
 * Анатомія — збірка з атомів системи КС у дизайн-системі v21 (розділ D: .ks-rubizh, .ks-segs, .ks-status, .ks-meta,
 * .ks-actions / .ks-act, .cf-checkbox / .cf-radio, .op-mark). Кольори — лише ролі токенів.
 * ============================================================================================== */

/** Знак КС у квадраті 40 px (.op-mark): фон card, межа input, радіус badge; колір — currentColor, тож тема перемикається сама. */
export function Mark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid shrink-0 place-content-center rounded-badge border border-input bg-card text-foreground',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="-6 -6 66.57 88.221" width={size * 0.8} height={size * 0.8} fill="currentColor">
        <path d="M 33.107 76.221 L 20.775 76.221 L 20.775 17.946 L 33.107 17.946 L 33.107 76.221 Z M 54.567 17.946 L 54.567 58.438 C 54.567 61.751 50.644 64.619 45.442 64.843 C 40.24 65.098 35.935 62.64 35.775 59.323 C 35.65 56.04 39.697 53.142 44.899 52.918 C 47.012 52.805 48.968 53.139 50.553 53.818 L 50.553 17.943 L 54.57 17.943 L 54.567 17.946 Z M 17.986 63.188 L 0 63.188 L 0 17.022 L 17.986 63.188 Z M 20.62 15.809 L 15.254 0 L 25.98 0 L 20.62 15.809 Z M 33.24 15.809 L 27.841 0 L 38.606 0 L 33.24 15.809 Z" />
      </svg>
    </span>
  )
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-medium uppercase text-muted-foreground',
        size === 'lg' ? 'size-12 text-meta' : 'size-8 text-[0.6875rem]',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
