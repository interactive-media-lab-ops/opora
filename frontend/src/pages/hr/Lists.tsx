/** HR: власні списки кандидатів і експорт у Excel. */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { LISTS_KEY, downloadListXlsx, useHRLists } from '../../api/lists'
import type { HRListDetail } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { NewListDialog } from '../../components/NewListDialog'
import { DataTable, TableSkeleton, Td, Th } from '../../components/table'
import { useToast } from '../../components/Toast'
import { ListAction } from '../../components/ListAction'
import {
  ASSESSMENT_STATUS,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Icon,
  Input,
  PageHeader,
  Skeleton,
  StatusText,
  VerdictText,
  DayCell,
} from '../../components/ui'

const candidates = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'кандидат' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'кандидати' : 'кандидатів'}`

/** Меню «⋯» зі списком дій (мок H7): перейменувати, видалити — для власних списків. */
function MoreMenu({ items }: { items: { label: string; icon: typeof Pencil; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => (
      document.removeEventListener('mousedown', onDoc),
      document.removeEventListener('keydown', onKey)
    )
  }, [open])
  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        icon={MoreHorizontal}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Дії зі списком"
        title="Дії зі списком"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <ul
          role="menu"
          aria-label="Дії зі списком"
          className="absolute right-0 top-full z-(--op-z-dropdown) m-0 mt-1 min-w-[12rem] list-none rounded-overlay border border-popover-border bg-popover p-1 shadow-overlay"
        >
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex h-(--control-h) w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-item border-0 bg-transparent px-3 text-left text-[0.9375rem] text-popover-foreground hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                onClick={() => (setOpen(false), it.onSelect())}
              >
                <Icon icon={it.icon} />
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Lists() {
  const qc = useQueryClient()
  const toast = useToast()
  const lists = useHRLists()
  const [selected, setSelected] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState(false)

  const current = lists.data?.find((l) => l.id === selected) ?? lists.data?.[0]
  useEffect(() => {
    if (lists.data && !lists.data.some((l) => l.id === selected)) setSelected(lists.data[0]?.id ?? null)
  }, [lists.data, selected])

  const detail = useQuery({
    queryKey: ['hr-list', current?.id],
    queryFn: () => api.get<HRListDetail>(`/hr/lists/${current!.id}`),
    enabled: current !== undefined,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: LISTS_KEY })
    qc.invalidateQueries({ queryKey: ['hr-list'] })
  }
  const rename = useMutation({
    mutationFn: () => api.patch(`/hr/lists/${current!.id}`, { name: renameValue.trim() }),
    onSuccess: () => (invalidate(), setRenaming(false)),
  })
  const drop = useMutation({
    mutationFn: () => api.delete(`/hr/lists/${current!.id}`),
    onSuccess: () => {
      toast(`Список «${current?.name}» видалено`)
      setDeleting(false)
      setSelected(null)
      invalidate()
    },
  })
  const exportXlsx = useMutation({
    mutationFn: () => downloadListXlsx(current!),
    onSuccess: () => toast(`Файл «${current?.name}.xlsx» збережено`),
    onError: () => toast('Не вдалося вивантажити файл. Спробуйте ще раз.', 'danger'),
  })

  const rows = detail.data?.rows ?? []

  return (
    <div>
      <PageHeader
        title="Списки"
        subtitle="Список «Обрані» є в кожного HR; власні списки бачите лише ви. Будь-який список можна вивантажити в Excel"
        actions={
          <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
            Новий список
          </Button>
        }
      />
      <ErrorBox error={lists.error} />
      {lists.isLoading && <Skeleton variant="rect" height={44} />}
      {lists.data && current && (
        <div className="grid gap-4">
          <div
            role="tablist"
            aria-label="Списки"
            className="flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {lists.data.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={l.id === current.id}
                onClick={() => setSelected(l.id)}
                className="-mb-px inline-flex h-(--control-h) items-center gap-2 whitespace-nowrap border-0 border-b-2 border-transparent bg-transparent px-1 font-medium text-muted-foreground hover:text-foreground aria-selected:border-border-accent aria-selected:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {l.name}
                <Badge>{l.assessment_ids.length}</Badge>
              </button>
            ))}
          </div>

          {/* рядок статусу + дії списку (мок H7): «Експорт в Excel» secondary, решта — у меню «⋯» */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {detail.data && (
              <p className="m-0 text-meta tabular-nums text-muted-foreground" aria-live="polite">
                {candidates(rows.length)} ·{' '}
                {current.is_default ? 'список за замовчуванням' : 'власний список'}
              </p>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="secondary"
                icon={Download}
                loading={exportXlsx.isPending}
                aria-disabled={rows.length === 0 || undefined}
                onClick={() => rows.length > 0 && exportXlsx.mutate()}
              >
                Експорт в Excel
              </Button>
              {!current.is_default && (
                <MoreMenu
                  items={[
                    {
                      label: 'Перейменувати',
                      icon: Pencil,
                      onSelect: () => (setRenameValue(current.name), rename.reset(), setRenaming(true)),
                    },
                    { label: 'Видалити список', icon: Trash2, onSelect: () => setDeleting(true) },
                  ]}
                />
              )}
            </div>
          </div>

          <ErrorBox error={detail.error} />
          {detail.data && rows.length === 0 ? (
            <EmptyState compact title="У списку нікого немає">
              Додайте кандидатів кнопкою «До списку» у базі кандидатів або в картці кандидата.
            </EmptyState>
          ) : (
            <DataTable caption={`Список «${current.name}»`} busy={detail.isLoading}>
              <thead>
                <tr>
                  <Th className="w-[32%] sm:min-w-[15rem]">ПІБ</Th>
                  <Th priority={3}>Подано</Th>
                  <Th>Стан</Th>
                  <Th className="text-right">Бал</Th>
                  <Th>Вердикт</Th>
                  <Th />
                </tr>
              </thead>
              {detail.isLoading || !detail.data ? (
                <TableSkeleton cols={6} rows={4} />
              ) : (
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td lead>
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={r.candidate_name} />
                          <span className="grid min-w-0">
                            <Link to={`/hr/candidates/${r.id}`} className="row-link font-medium">
                              {r.candidate_name}
                            </Link>
                            <span
                              className="block truncate text-label text-foreground-tertiary"
                              title={`${r.candidate_email} · ${r.methodology_title}`}
                            >
                              {r.candidate_email} · {r.methodology_title}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td label="Подано" priority={3} className="whitespace-nowrap tabular-nums">
                        <DayCell iso={r.submitted_at} />
                      </Td>
                      <Td label="Стан">
                        <StatusText
                          status={ASSESSMENT_STATUS[r.stage].status}
                          word={ASSESSMENT_STATUS[r.stage].word}
                          className="whitespace-nowrap"
                        />
                      </Td>
                      <Td label="Бал" className="num font-medium tabular-nums">
                        {r.summary_score ?? '—'}
                      </Td>
                      <Td label="Вердикт">
                        <VerdictText verdict={r.verdict} />
                      </Td>
                      {/* 39A: «У списку · N» замість «×» — той самий компонент, що в базі; прибрати зі списку — зняти позначку в меню */}
                      <Td actions className="text-right">
                        <ListAction assessmentId={r.id} candidateName={r.candidate_name} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </DataTable>
          )}
        </div>
      )}

      <NewListDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(l) => (setSelected(l.id), toast(`Список «${l.name}» створено`))}
      />
      <ConfirmDialog
        open={renaming}
        title="Перейменувати список"
        confirmLabel="Зберегти"
        confirmDisabled={!renameValue.trim()}
        pending={rename.isPending}
        onCancel={() => setRenaming(false)}
        onConfirm={() => rename.mutate()}
      >
        <div className="grid gap-3">
          <Field label="Назва списку" required>
            <Input
              value={renameValue}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </Field>
          <ErrorBox error={rename.error} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting}
        danger
        title="Видалити список?"
        description={
          current ? `Список «${current.name}» буде видалено. Самі кандидати лишаться в базі.` : undefined
        }
        confirmLabel="Видалити"
        pending={drop.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => drop.mutate()}
      />
    </div>
  )
}
