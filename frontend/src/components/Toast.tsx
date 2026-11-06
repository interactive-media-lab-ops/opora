/** Сповіщення-тости та хук useToast. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { Button, Icon } from './ui'

type Tone = 'success' | 'danger'
interface ToastItem {
  id: number
  tone: Tone
  text: string
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {})
export const useToast = () => useContext(ToastContext)

const LIFETIME_MS = 5000

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const paused = useRef(false)
  useEffect(() => {
    if (item.tone === 'danger') return // помилка не зникає сама
    let left = LIFETIME_MS
    const t = window.setInterval(() => {
      if (paused.current) return
      left -= 250
      if (left <= 0) onClose()
    }, 250)
    return () => window.clearInterval(t)
  }, [item, onClose])
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
      className="flex items-start gap-3 rounded-overlay border border-popover-border bg-popover px-4 py-3 text-meta text-foreground shadow-overlay"
    >
      <Icon
        icon={item.tone === 'danger' ? AlertCircle : CheckCircle2}
        className={item.tone === 'danger' ? 'text-status-danger-text' : 'text-status-success-text'}
      />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.text}</span>
      <Button
        variant="ghost"
        size="sm"
        icon={X}
        aria-label="Закрити"
        onClick={onClose}
        className="-my-1 -mr-2"
      />
    </div>
  )
}

/** Тост КС: знизу на телефоні, справа знизу на десктопі; 5 с, пауза на hover/focus; danger не зникає сам. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(0)
  const push = useCallback((text: string, tone: Tone = 'success') => {
    setItems((xs) => [...xs, { id: ++next.current, tone, text }])
  }, [])
  const close = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-(--op-z-toast) grid gap-2 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[min(100%-48px,400px)]">
        {items.map((it) => (
          <ToastView key={it.id} item={it} onClose={() => close(it.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
