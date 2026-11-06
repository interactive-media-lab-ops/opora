/** Статуси: Badge, StatusText, StageTag, VerdictText, Segments, StageProgress. */
import * as React from 'react'
import { type LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { cx } from './format'
import {
  type Verdict,
  type BadgeTone,
  VERDICT_LABEL,
  type StageStatusKey,
  STAGE_STATUS,
  VERDICT_STATUS,
} from './labels'

/* ------------------------------------------------------------------------------------------------
 * Badge — КС .cf-tag: 22 px, пігулка (radius chip), 12/500, іконка 12; lg — 28 px, 13, іконка 14.
 * Тони: slate = нейтраль (muted / muted-foreground) · blue = info · green = success · amber = warning · red = danger ·
 * green-quiet = «тихий успіх» (DD-36: зелений текст і межа, без заливки) — для «Опрацьовано / Готово».
 * Статус — завжди слово (+ іконка, якщо є), ніколи лише колір.
 * ---------------------------------------------------------------------------------------------- */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Додатково: lg = 28 px (статус етапу в картці). */
  size?: 'md' | 'lg'
  /** Додатково: іконка перед словом (DD-36 — слово + іконка). */
  icon?: LucideIcon
  /** Додатково: КС .cf-tag--square (радіус badge 4) — тег версії методології в рядку мети. */
  square?: boolean
}

const BADGE_TONE: Record<BadgeTone, string> = {
  slate: 'border-transparent bg-muted text-muted-foreground',
  blue: 'border-transparent bg-status-info-bg text-status-info-text',
  green: 'border-transparent bg-status-success-bg text-status-success-text',
  amber: 'border-transparent bg-status-warning-bg text-status-warning-text',
  red: 'border-transparent bg-status-danger-bg text-status-danger-text',
  'green-quiet': 'bg-transparent border-status-success-text text-status-success-text',
  // КС .cf-tag--outline: прозорий, межа border, текст foreground («Не почато», «методологія vN»)
  outline: 'bg-transparent border-border text-foreground',
}

export function Badge({
  tone = 'slate',
  size = 'md',
  icon,
  square,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap border align-middle font-medium leading-none',
        square ? 'rounded-badge' : 'rounded-chip',
        size === 'lg' ? 'h-7 px-3 text-label' : 'h-[22px] px-2 text-caption',
        BADGE_TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon && <Icon icon={icon} size={size === 'lg' ? 14 : 12} />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Segments / StageProgress — DD-36 (D2): рубіж «N / M». Число — шрифт display (CY Grotesk Grand), 3rem, 800;
 * сегменти 6 px: чорнило (готово) · soft = input (є, але ще не в системі, 35A) · контур input (порожньо); ≤15rem.
 * M завжди з довжини списку (D-65, D-69). compact — у картці етапу («сценаріїв 1 / 3», «відгуків 2 / 4»).
 * ---------------------------------------------------------------------------------------------- */
export type SegmentState = 'done' | 'soft' | 'empty'

export function Segments({
  items,
  compact,
  label,
  className,
}: {
  items: SegmentState[]
  compact?: boolean
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cx('flex', compact ? 'w-[4.5rem] gap-0.5' : 'w-full max-w-[15rem] gap-1', className)}
    >
      {items.map((st, i) => (
        <span
          key={i}
          className={cx(
            'relative flex-1 overflow-hidden rounded-chip',
            compact ? 'h-1 min-w-0' : 'h-1.5 min-w-6',
            st === 'done'
              ? 'bg-primary'
              : st === 'soft'
                ? 'bg-input'
                : 'bg-transparent inset-ring inset-ring-input',
          )}
        />
      ))}
    </span>
  )
}

export interface StageProgressProps {
  done: number
  total: number
  /** Підпис після числа: «етапів надіслано», «відгуків отримано». */
  label: string
  /** Стан кожного сегмента; типово — перші `done` чорнилом, решта контуром. */
  segments?: SegmentState[]
  className?: string
}

export function StageProgress({ done, total, label, segments, className }: StageProgressProps) {
  const items =
    segments ?? Array.from({ length: total }, (_, i): SegmentState => (i < done ? 'done' : 'empty'))
  return (
    <div className={cx('grid min-w-0 justify-items-start gap-2', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="whitespace-nowrap font-display text-stat tabular-nums"
          style={{ fontWeight: 'var(--weight-stat)' }}
        >
          {done} / {total}
        </span>
        <span className="text-label text-foreground-tertiary">{label}</span>
      </div>
      <Segments items={items} label={`${label}: ${done} з ${total}`} />
    </div>
  )
}

export function StatusText({
  status,
  word,
  size = 'md',
  className,
}: {
  status: StageStatusKey
  word?: string
  size?: 'md' | 'sm'
  className?: string
}) {
  const s = STAGE_STATUS[status]
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 font-medium',
        size === 'sm' ? 'text-label' : 'text-meta',
        s.text,
        className,
      )}
    >
      <Icon icon={s.icon} size={14} />
      <span className="text-pretty">{word ?? s.word}</span>
    </span>
  )
}

/** Тег статусу етапу (схема B, 28 px): слово + іконка; «Надіслано» — тихий успіх (36B). */
export function StageTag({
  status,
  word,
  className,
}: {
  status: StageStatusKey
  word?: string
  className?: string
}) {
  const s = STAGE_STATUS[status]
  return (
    <Badge tone={s.tone} size="lg" icon={s.icon} className={className}>
      {word ?? s.word}
    </Badge>
  )
}

export function VerdictText({
  verdict,
  size = 'md',
  className,
}: {
  verdict: Verdict | null
  size?: 'md' | 'sm'
  className?: string
}) {
  if (!verdict)
    return (
      <span className={cx('text-foreground-tertiary', size === 'sm' ? 'text-label' : 'text-meta', className)}>
        —
      </span>
    )
  const v = VERDICT_STATUS[verdict]
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap font-medium',
        size === 'sm' ? 'text-label' : 'text-meta',
        v.text,
        className,
      )}
    >
      <Icon icon={v.icon} size={14} />
      <span>{VERDICT_LABEL[verdict]}</span>
    </span>
  )
}
