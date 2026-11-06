/** Модальне підтвердження дії. */
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './ui'

interface Props {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  /** Руйнівна дія — кнопка підтвердження danger (70B). */
  danger?: boolean
  pending?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** Додатковий вміст (наприклад, поле вводу). */
  children?: ReactNode
}

/** Діалог підтвердження КС (AlertDialog): нативний <dialog> — фокус у вікні, Esc закриває; перший фокус на «Скасувати» (20A). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  pending,
  confirmDisabled,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!pending) onCancel()
      }}
      onClick={(e) => e.target === ref.current && !pending && onCancel()}
      className="m-auto w-[min(calc(100%-3rem),520px)] rounded-modal border-0 bg-popover p-0 text-foreground shadow-modal backdrop:bg-scrim"
    >
      {open && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault()
            if (!confirmDisabled && !pending) onConfirm()
          }}
          className="flex flex-col"
        >
          <div className="grid gap-2 px-6 pt-6">
            <h2 id="confirm-title" className="m-0 text-h2 font-semibold">
              {title}
            </h2>
            {description && <p className="m-0 text-[0.9375rem] text-muted-foreground">{description}</p>}
          </div>
          {children && <div className="px-6 py-5">{children}</div>}
          <div className="flex gap-2 px-6 pb-6 pt-5 max-sm:flex-col sm:justify-end max-sm:[&>*]:w-full">
            <Button type="button" variant="secondary" autoFocus disabled={pending} onClick={onCancel}>
              Скасувати
            </Button>
            <Button
              type="submit"
              variant={danger ? 'danger' : 'primary'}
              loading={pending}
              disabled={confirmDisabled || pending}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  )
}
