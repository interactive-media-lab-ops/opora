/** Світла/темна тема: збереження вибору і застосування до документа. */
import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'opora-theme'

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const listeners = new Set<() => void>()
const current = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') as Theme

/** Ставить тему на <html>; за замовчуванням light, prefers-color-scheme не читаємо (DD-23). */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* сховище недоступне — тема діє до перезавантаження */
  }
  listeners.forEach((l) => l())
}

export function initTheme() {
  const theme = read()
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    current,
    () => 'light' as Theme,
  )
  const toggle = useCallback(() => applyTheme(current() === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle }
}
