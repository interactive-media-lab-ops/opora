/** Назви етапів оцінювання за замовчуванням і їх перевизначення методологією. */
import type { StageInfo, StageKey } from '../api/types'

/**
 * Назви етапів і блоків (D-73, 89C): задає методолог у конфігурації методології. Поки в API є лише `StageInfo.title`
 * (кандидат), `stage_titles` у профілі HR і `*_title` у методології (BR-4); без них — типові значення. Єдине місце з цими словами в UI.
 */
export type StageLike = StageKey | 'RECOMMENDATIONS' | 'DONE'

export const STAGE_DEFAULT: Record<StageLike, string> = {
  PROFILE: 'Анкета',
  QUIZ: 'Опитувальник',
  INTERVIEW: 'Розмова',
  RECOMMENDATIONS: 'Рекомендації',
  DONE: 'Готово',
}

/** Знахідний відмінок для журналу подій («надіслав анкету»). */
export const STAGE_DEFAULT_ACC: Record<StageKey, string> = {
  PROFILE: 'анкету',
  QUIZ: 'опитувальник',
  INTERVIEW: 'розмову',
}

/** Назва етапу: з конфігурації (якщо передано `stages` з API), інакше — приклад. */
export function stageTitle(
  key: StageLike | string,
  stages?: Pick<StageInfo, 'key' | 'title'>[] | null,
): string {
  const fromApi = stages?.find((s) => s.key === key)?.title
  return fromApi || STAGE_DEFAULT[key as StageLike] || String(key)
}
