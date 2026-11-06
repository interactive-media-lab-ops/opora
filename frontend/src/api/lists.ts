/** Запити списків HR і завантаження експортів (PDF кандидата, Excel списку). */
import { useQuery } from '@tanstack/react-query'
import { api, fetchBlob } from './client'
import type { HRList } from './types'

export const LISTS_KEY = ['hr-lists']

export function useHRLists() {
  return useQuery({ queryKey: LISTS_KEY, queryFn: () => api.get<HRList[]>('/hr/lists'), staleTime: 30000 })
}

/** Завантажує PDF-профіль кандидата (BR-10); сервер логує кожен виклик. Потрібен Authorization, тому не просте посилання. */
export async function downloadCandidatePdf(assessmentId: number, candidateName: string) {
  const blob = await fetchBlob(`/hr/candidates/${assessmentId}/export.pdf`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Профіль — ${candidateName.replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'кандидат'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Завантажує xlsx списку (потрібен Authorization, тому не просте посилання). */
export async function downloadListXlsx(list: { id: number; name: string }) {
  const blob = await fetchBlob(`/hr/lists/${list.id}/export`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${list.name.replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'list'}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
