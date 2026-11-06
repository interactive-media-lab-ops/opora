/** Встановлення PWA: перехоплення beforeinstallprompt, хук useInstall. */
import { useSyncExternalStore } from 'react'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Викликається один раз на старті: подію можна перехопити лише до того, як її побачить браузер. */
export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export function useInstall() {
  const available = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => deferred !== null,
    () => false,
  )
  return {
    /** Браузер дозволяє встановити застосунок одним натисканням. */
    canInstall: available,
    /** iOS Safari: події немає, встановлення — вручну через меню «Поділитися». */
    iosHint: !available && isIOS() && !isStandalone(),
    installed: isStandalone(),
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      emit()
    },
  }
}
