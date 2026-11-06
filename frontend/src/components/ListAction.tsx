/** Кнопка «До списку»: додати кандидата у власний список HR. */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Plus, Star } from 'lucide-react'
import { api } from '../api/client'
import { LISTS_KEY, useHRLists } from '../api/lists'
import type { HRList } from '../api/types'
import { NewListDialog } from './NewListDialog'
import { useToast } from './Toast'
import { Button, Icon, cx } from './ui'

/**
 * «До списку» (D5): ghost-кнопка з меню-чекбоксами списків; у списку — «У списку · N» (39A); на ≤600 px підпис лише в title/sr-only (40A).
 * `inHeader` — у шапці профілю H6: secondary звичайного розміру, як «Вивантажити PDF» (64A, 97A).
 */
export function ListAction({
  assessmentId,
  candidateName,
  inHeader,
}: {
  assessmentId: number
  candidateName: string
  inHeader?: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const lists = useHRLists()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !menu.current?.contains(t)) setOpen(false)
    }
    // прокрутка таблиці зсуває кнопку: тримаємо меню біля неї, а якщо кнопка зникла з екрана — закриваємо
    const close = () => {
      const r = root.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false)
      else setPos({ top: r.bottom + 4, right: Math.max(window.innerWidth - r.right, 8) })
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = useMutation({
    mutationFn: ({ list, add }: { list: HRList; add: boolean }) =>
      add
        ? api.put(`/hr/lists/${list.id}/items/${assessmentId}`, {})
        : api.delete(`/hr/lists/${list.id}/items/${assessmentId}`),
    onSuccess: (_, { list, add }) => {
      qc.invalidateQueries({ queryKey: LISTS_KEY })
      qc.invalidateQueries({ queryKey: ['hr-list', list.id] })
      toast(
        add
          ? `${candidateName} додано до списку «${list.name}»`
          : `${candidateName} прибрано зі списку «${list.name}»`,
      )
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Не вдалося змінити список', 'danger'),
  })

  const all = lists.data ?? []
  const memberOf = all.filter((l) => l.assessment_ids.includes(assessmentId))
  const inAny = memberOf.length > 0

  return (
    <div ref={root} className="relative inline-block">
      <Button
        variant={inHeader ? 'secondary' : 'ghost'}
        size={inHeader ? undefined : 'sm'}
        aria-haspopup="true"
        aria-expanded={open}
        title={inAny ? `У списку · ${memberOf.length}` : 'До списку'}
        icon={inAny ? Check : Star}
        onClick={() => {
          const r = root.current?.getBoundingClientRect()
          if (r) setPos({ top: r.bottom + 4, right: Math.max(window.innerWidth - r.right, 8) })
          setOpen((o) => !o)
        }}
      >
        <span className="max-sm:sr-only">{inAny ? 'У списку' : 'До списку'}</span>
        {inAny && (
          <span className="tabular-nums">
            <span className="max-sm:sr-only">· </span>
            {memberOf.length}
          </span>
        )}
        <Icon icon={ChevronDown} size={14} className="max-sm:hidden" />
      </Button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            role="group"
            aria-label="Списки"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-(--op-z-dropdown) grid w-64 gap-0.5 rounded-overlay border border-popover-border bg-popover p-1 text-foreground shadow-overlay max-sm:!inset-x-4 max-sm:!top-auto max-sm:bottom-4 max-sm:w-auto"
          >
            {lists.isLoading && (
              <div className="px-3 py-2 text-meta text-muted-foreground">Завантаження…</div>
            )}
            {all.map((l) => {
              const checked = l.assessment_ids.includes(assessmentId)
              return (
                <label
                  key={l.id}
                  className={cx(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 hover:bg-secondary-hover',
                    toggle.isPending && 'opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-[18px] accent-primary"
                    checked={checked}
                    disabled={toggle.isPending}
                    onChange={() => toggle.mutate({ list: l, add: !checked })}
                  />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="text-label tabular-nums text-foreground-tertiary">
                    {l.assessment_ids.length}
                  </span>
                </label>
              )
            })}
            <button
              type="button"
              onClick={() => (setOpen(false), setCreating(true))}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border-0 bg-transparent px-3 text-left font-medium text-foreground hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Icon icon={Plus} />
              Новий список…
            </button>
          </div>,
          document.body,
        )}
      <NewListDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(list) => toggle.mutate({ list, add: true })}
      />
    </div>
  )
}
