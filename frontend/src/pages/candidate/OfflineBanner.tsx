/** Банер «немає зв'язку» для кабінету кандидата. */
import { WifiOff } from 'lucide-react'
import { Alert } from '../../components/ui'
import { useAnswerQueue } from './AnswerQueue'

/** Смуга «Немає зв'язку» (45A): ввід не блокується, відповіді чекають на пристрої. */
export function OfflineBanner() {
  const { online, items, submitPending } = useAnswerQueue()
  const waiting = Object.keys(items).length
  if (online && waiting === 0 && !submitPending) return null
  return (
    <Alert variant="warning" icon={WifiOff} role="status">
      {online
        ? 'Надсилаємо збережені відповіді…'
        : 'Немає зв’язку. Відповіді зберігаються на пристрої й надсилаються автоматично, коли зв’язок з’явиться. Не закривайте сторінку, якщо вона відкрита без мережі.'}
    </Alert>
  )
}
