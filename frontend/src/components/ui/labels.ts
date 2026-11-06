/** Словники станів: підписи й тони етапів, вердиктів, статусів. */
import { AlertCircle, Check, Circle, CircleDashed, Smartphone, Upload, type LucideIcon } from 'lucide-react'

/* ------------------------------------------------------------------------------------------------
 * Словники станів і форматування.
 * ---------------------------------------------------------------------------------------------- */
export type Stage = 'IN_PROGRESS' | 'PROCESSING' | 'DONE'

export type Verdict = 'IN_REVIEW' | 'RECOMMENDED' | 'REJECTED'

export type BadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'green-quiet' | 'outline'

export const STAGE_LABEL: Record<Stage, string> = {
  IN_PROGRESS: 'В процесі',
  PROCESSING: 'Обробка',
  DONE: 'Завершено',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  IN_REVIEW: 'На розгляді',
  RECOMMENDED: 'Рекомендовано',
  REJECTED: 'Відхилено',
}

/** Тон вердикту — єдине місце, де вердикт отримує колір (docs/design/semantic-colors.md). */
export const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  IN_REVIEW: 'amber',
  RECOMMENDED: 'green',
  REJECTED: 'red',
}

/** Тон етапу оцінювання (DD-36 «тиха шкала»: усе, що йде своїм ходом, — нейтраль; результат — тихий успіх). */
export const STAGE_TONE: Record<Stage, BadgeTone> = {
  IN_PROGRESS: 'slate',
  PROCESSING: 'slate',
  DONE: 'green-quiet',
}

/* ------------------------------------------------------------------------------------------------
 * StatusText — DD-36, схема C: статус без коробки (іконка 14 + слово 500), під бульбашкою відповіді, у рядку «Етап: ✓ Надіслано».
 * Тони: нейтраль (muted-foreground) · тон (foreground) · тихий успіх · warning · danger. Завжди слово + іконка.
 * ---------------------------------------------------------------------------------------------- */
export type StageStatusKey = 'not-started' | 'in-progress' | 'on-device' | 'sending' | 'sent' | 'error'

export const STAGE_STATUS: Record<
  StageStatusKey,
  { word: string; icon: LucideIcon; tone: BadgeTone; text: string }
> = {
  'not-started': { word: 'Не почато', icon: Circle, tone: 'outline', text: 'text-muted-foreground' },
  'in-progress': { word: 'В процесі', icon: CircleDashed, tone: 'slate', text: 'text-foreground' },
  'on-device': {
    word: 'Збережено на пристрої',
    icon: Smartphone,
    tone: 'amber',
    text: 'text-status-warning-text',
  },
  sending: { word: 'Надсилається', icon: Upload, tone: 'slate', text: 'text-foreground' },
  sent: { word: 'Надіслано', icon: Check, tone: 'green-quiet', text: 'text-status-success-text' },
  error: { word: 'Помилка', icon: AlertCircle, tone: 'red', text: 'text-status-danger-text' },
}

/** Стан проходження в базі HR (мок H5 «Стан», схема C): етап аналізу → слово + іконка. Назви станів — тексти моку. */
export const ASSESSMENT_STATUS: Record<Stage, { status: StageStatusKey; word: string }> = {
  IN_PROGRESS: { status: 'in-progress', word: 'В процесі' },
  PROCESSING: { status: 'sending', word: 'Аналіз готується' },
  DONE: { status: 'sent', word: 'Опрацьовано' },
}

/** Вердикт HR (D-67, локальне рішення) словом + іконкою; колір — лише з VERDICT_TONE. */
export const VERDICT_STATUS: Record<Verdict, { icon: LucideIcon; text: string }> = {
  IN_REVIEW: { icon: CircleDashed, text: 'text-status-warning-text' },
  RECOMMENDED: { icon: Check, text: 'text-status-success-text' },
  REJECTED: { icon: AlertCircle, text: 'text-status-danger-text' },
}
