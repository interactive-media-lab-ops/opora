/** Адмін: черга запитів на видалення даних. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import type { AdminDeletionRequest } from '../../api/types'
import { ROLE_LABEL } from '../../auth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DataTable, TableSkeleton, Td, Th } from '../../components/table'
import { useToast } from '../../components/Toast'
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  ErrorBox,
  PageHeader,
  StatusText,
  fmtDate,
} from '../../components/ui'

const KEY = ['admin-deletion-requests']

export function DeletionRequests() {
  const qc = useQueryClient()
  const toast = useToast()
  const [target, setTarget] = useState<AdminDeletionRequest | null>(null)
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<AdminDeletionRequest[]>('/admin/deletion-requests'),
  })
  const done = useMutation({
    mutationFn: (r: AdminDeletionRequest) =>
      api.post<AdminDeletionRequest>(`/admin/deletion-requests/${r.id}/done`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: KEY })
      toast(`Запит ${r.user_email} позначено обробленим`)
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Не вдалося оновити запит', 'danger'),
  })

  return (
    <div>
      <PageHeader
        title="Запити на видалення"
        subtitle="Користувачі, які попросили видалити свій акаунт. Повне видалення даних адміністратором — D-71 (пропозиція, X-27)"
      />
      <Alert variant="info" className="mb-4">
        Позначка «Оброблено» лише фіксує, що запит розглянуто: дані й акаунт вона не видаляє. Видалення
        виконується вручну (наприклад, деактивацією акаунта на сторінці «Користувачі»).
      </Alert>
      <ErrorBox error={list.error} />
      {list.data && list.data.length === 0 ? (
        <EmptyState compact title="Запитів немає">
          Коли користувач надішле запит із сторінки «Акаунт», він з’явиться тут.
        </EmptyState>
      ) : (
        <DataTable caption="Запити на видалення акаунтів" busy={list.isLoading}>
          <thead>
            <tr>
              <Th>Користувач</Th>
              <Th>Роль</Th>
              <Th priority={2}>Надіслано</Th>
              <Th>Статус</Th>
              <Th />
            </tr>
          </thead>
          {list.isLoading || !list.data ? (
            <TableSkeleton cols={5} rows={3} />
          ) : (
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <Td lead>
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.user_name} />
                      <span className="grid min-w-0">
                        <span className="font-medium">{r.user_name}</span>
                        <span className="block truncate text-label text-foreground-tertiary">
                          {r.user_email}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td label="Роль">{ROLE_LABEL[r.user_role]}</Td>
                  <Td label="Надіслано" priority={2}>
                    {fmtDate(r.created_at)}
                  </Td>
                  <Td label="Статус">
                    {r.status === 'NEW' ? (
                      <StatusText status="in-progress" word="Очікує" />
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <StatusText status="sent" word="Оброблено" />
                        <span className="text-label text-foreground-tertiary">
                          {r.processed_by_name ?? '—'}, {fmtDate(r.processed_at)}
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td actions className="text-right">
                    {r.status === 'NEW' && (
                      <Button variant="secondary" size="sm" onClick={() => setTarget(r)}>
                        Позначити обробленим
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          )}
        </DataTable>
      )}
      <ConfirmDialog
        open={target !== null}
        title="Позначити запит обробленим?"
        description={
          target ? `${target.user_name} (${target.user_email}). Дані й акаунт ця дія не видаляє.` : undefined
        }
        confirmLabel="Позначити обробленим"
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (target) done.mutate(target)
          setTarget(null)
        }}
      />
    </div>
  )
}
