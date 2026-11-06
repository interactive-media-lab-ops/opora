/**
 * Примітиви інтерфейсу «Опора» (дизайн-система КС 1:1 — DD-32, анатомія — DD-33).
 *
 * Правила цього файлу:
 *  - експорти й пропси збережено (Button, Input, Textarea, Select, Field, Card, PageHeader, Badge, ErrorBox,
 *    Spinner, EmptyState, CopyButton, Markdownish, STAGE_LABEL, VERDICT_LABEL, VERDICT_TONE, fmtDate);
 *    нові пропси лише необов'язкові, нові експорти — додаткові (Alert, Skeleton, Icon-пропси);
 *  - жодного кольору поза токенами: лише утиліти з @theme (bg-card, text-muted-foreground, rounded-field …);
 *  - розміри контролів — із CSS-змінних щільності (--control-h, --pad-x, --control-fs): 36 px, на дотику 44 px (DD-22);
 *  - кожен інтерактивний елемент має hover (лише (hover:hover) — так робить Tailwind v4), focus-visible (кільце --ring 2/2), disabled (прозорість 0.45);
 *  - іконки — lucide-react, штрих 1.5 (дизайн-система КС: «Lucide, штрих 1.5»; X-17), розмір 20 (--op-icon-md), у тегах 12/14.
 * Джерело анатомії: артефакт дизайн-системи
 * (components/bundle.css, розділ D «КС — компоненти системи КС 1:1»); пояснення — docs/design/components.md.
 */
export {
  STAGE_LABEL,
  VERDICT_LABEL,
  VERDICT_TONE,
  STAGE_TONE,
  STAGE_STATUS,
  ASSESSMENT_STATUS,
  VERDICT_STATUS,
} from './labels'
export type { Stage, Verdict, BadgeTone, StageStatusKey } from './labels'
export { fmtDate, fmtDay, DayCell, cx, initials, fmtShort, etapy } from './format'
export { Icon, Mark, Avatar } from './Icon'
export { Button, CopyButton } from './Button'
export type { ButtonVariant, ButtonSize, ButtonProps, CopyButtonProps } from './Button'
export { Input, Textarea, Select, Field, Checkbox, Radio } from './form'
export type { InputProps, TextareaProps, SelectProps, FieldProps, CheckProps } from './form'
export { Card, PageHeader, Lead, Act, ActionGroup, Sheet, MetaRow } from './layout'
export type { CardProps, PageHeaderProps, ActProps, SheetProps, MetaRowProps } from './layout'
export { Alert, ErrorBox, Skeleton, Spinner, EmptyState } from './feedback'
export type {
  AlertVariant,
  AlertProps,
  ErrorBoxProps,
  SkeletonProps,
  SpinnerProps,
  EmptyStateProps,
} from './feedback'
export { Badge, Segments, StageProgress, StatusText, StageTag, VerdictText } from './status'
export type { BadgeProps, SegmentState, StageProgressProps } from './status'
export { Markdownish } from './Markdownish'
export type { MarkdownishProps } from './Markdownish'
