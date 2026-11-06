/** Приватні нотатки HR до кандидата (BR-6). */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { HRNote } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, Card, ErrorBox, Field, Skeleton, Textarea } from './ui'

const when = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Нотатки HR (BR-6, 79A / D-14): свої в кожного HR, бачить лише автор; перелік записів з датою, додати / змінити / видалити.
 * В PDF не потрапляють (BR-10).
 */
export function HRNotes({ assessmentId }: { assessmentId: number }) {
  const qc = useQueryClient()
  const key = ['hr-notes', assessmentId]
  const base = `/hr/candidates/${assessmentId}/notes`
  const notes = useQuery({ queryKey: key, queryFn: () => api.get<HRNote[]>(base) })
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [removing, setRemoving] = useState<HRNote | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const add = useMutation({
    mutationFn: () => api.post<HRNote>(base, { text: draft.trim() }),
    onSuccess: () => (setDraft(''), refresh()),
  })
  const save = useMutation({
    mutationFn: () => api.put<HRNote>(`${base}/${editing!.id}`, { text: editing!.text.trim() }),
    onSuccess: () => (setEditing(null), refresh()),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`${base}/${id}`),
    onSuccess: () => (setRemoving(null), refresh()),
  })

  return (
    <Card title="Нотатки" meta="бачите лише ви">
      <Field label="Нова нотатка" hint="В PDF не потрапляє. Окремо від вашого рішення">
        <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <ErrorBox error={add.error} />
      {draft.trim() && (
        <div>
          <Button variant="secondary" icon={Check} loading={add.isPending} onClick={() => add.mutate()}>
            Зберегти нотатку
          </Button>
        </div>
      )}

      {notes.isLoading && <Skeleton variant="rect" height={48} />}
      <ErrorBox error={notes.error} />
      {notes.data && notes.data.length > 0 && (
        <ul className="m-0 grid list-none gap-3 p-0">
          {notes.data.map((n) => (
            <li key={n.id} className="grid gap-2 border-t border-border pt-3">
              {editing?.id === n.id ? (
                <>
                  <Textarea
                    rows={3}
                    aria-label="Текст нотатки"
                    value={editing.text}
                    onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                  />
                  <ErrorBox error={save.error} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={save.isPending}
                      disabled={!editing.text.trim()}
                      onClick={() => save.mutate()}
                    >
                      Зберегти
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (setEditing(null), save.reset())}>
                      Скасувати
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{n.text}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <time
                      dateTime={n.updated_at}
                      className="text-label tabular-nums text-foreground-tertiary"
                    >
                      {when(n.updated_at)}
                    </time>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Pencil}
                      onClick={() => (save.reset(), setEditing({ id: n.id, text: n.text }))}
                    >
                      Змінити
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={() => (remove.reset(), setRemoving(n))}
                    >
                      Видалити
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {notes.data?.length === 0 && !draft && (
        <p className="m-0 text-meta text-muted-foreground">Нотаток ще немає</p>
      )}

      <ConfirmDialog
        open={removing !== null}
        danger
        title="Видалити нотатку?"
        description="Нотатку буде видалено остаточно."
        confirmLabel="Видалити"
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      >
        <ErrorBox error={remove.error} />
      </ConfirmDialog>
    </Card>
  )
}
