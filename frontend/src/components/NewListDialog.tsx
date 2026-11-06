/** Діалог створення нового списку HR. */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { LISTS_KEY } from '../api/lists'
import type { HRList } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'
import { ErrorBox, Field, Input } from './ui'

/** «Новий список» (66A): вікно з полем назви, головна «Створити список» усередині. */
export function NewListDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (list: HRList) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => api.post<HRList>('/hr/lists', { name: name.trim() }),
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: LISTS_KEY })
      setName('')
      onClose()
      onCreated?.(list)
    },
  })
  const close = () => {
    create.reset()
    setName('')
    onClose()
  }
  return (
    <ConfirmDialog
      open={open}
      title="Новий список"
      description="Список бачите лише ви. Назву можна змінити пізніше"
      confirmLabel="Створити список"
      confirmDisabled={!name.trim()}
      pending={create.isPending}
      onCancel={close}
      onConfirm={() => create.mutate()}
    >
      <div className="grid gap-3">
        <Field label="Назва списку" required hint="Коротка назва вміщується у вкладку; довга — переноситься">
          <Input
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="Наприклад, «Резерв 2027»"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <ErrorBox error={create.error} />
      </div>
    </ConfirmDialog>
  )
}
