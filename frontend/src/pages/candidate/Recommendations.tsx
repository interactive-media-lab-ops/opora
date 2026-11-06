/** Етап «Рекомендації»: посилання для рекомендаторів і їх стан. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Eye, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import type { CandidateRecommendations, RecommendationLink } from '../../api/types'
import { useToast } from '../../components/Toast'
import {
  Act,
  ActionGroup,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorBox,
  Lead,
  MetaRow,
  Skeleton,
  StageProgress,
  StageTag,
  fmtDay,
  type SegmentState,
} from '../../components/ui'

import { RECOMMENDATIONS_KEY as KEY } from './keys'
const linkUrl = (token: string) => `${window.location.origin}/r/${token}`

/**
 * LinkCard КС (DD-40, 69B): картка «Посилання N» · мета «діє до дд.мм.рррр» · одна дія «Копіювати посилання» (secondary).
 * Використане — тег «Використано» без дії; прострочене — «Прострочено» + «Створити нове посилання» (поведінка коду для
 * будь-якого, що очікує, лишається — D-74 пропозиція, не змінюємо логіку; у моку такої дії немає).
 */
function LinkCard({
  link,
  onRenew,
  renewing,
}: {
  link: RecommendationLink
  onRenew: () => void
  renewing: boolean
}) {
  const used = link.status === 'USED'
  const url = link.token ? linkUrl(link.token) : null
  return (
    <Card
      as="article"
      title={`Посилання ${link.slot}`}
      meta={
        used || link.expired ? undefined : link.expires_at ? `діє до ${fmtDay(link.expires_at)}` : undefined
      }
      actions={
        used ? (
          <StageTag status="sent" word="Використано" />
        ) : link.expired ? (
          <Badge tone="amber" size="lg" icon={Clock}>
            Прострочено
          </Badge>
        ) : undefined
      }
      footer={
        used ? undefined : (
          <>
            {url && !link.expired && (
              <CopyButton
                text={url}
                label="Копіювати посилання"
                className="max-sm:h-auto max-sm:min-h-(--control-h) max-sm:whitespace-normal max-sm:py-2"
              />
            )}
            {link.status === 'PENDING' && (
              <Act hint="Старе посилання перестане діяти" className="sm:ml-auto">
                <Button
                  variant="ghost"
                  icon={RefreshCw}
                  loading={renewing}
                  onClick={onRenew}
                  className="max-sm:h-auto max-sm:min-h-(--control-h) max-sm:whitespace-normal max-sm:py-2"
                >
                  Створити нове посилання
                </Button>
              </Act>
            )}
          </>
        )
      }
    >
      {used ? (
        <p className="m-0 text-meta text-muted-foreground">Людина вже відповіла — посилання більше не діє</p>
      ) : link.expired ? (
        <p className="m-0 text-meta text-muted-foreground">
          Минуло 30 днів — посилання більше не відкривається
        </p>
      ) : null}
    </Card>
  )
}

/** Етап «Рекомендації» (C5): 4 одноразові посилання, рубіж «відгуків N / 4» без змісту й ролей (D-05, D-45, D-66). */
export function CandidateRecommendationsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<CandidateRecommendations>('/candidate/recommendations'),
  })
  const renew = useMutation({
    mutationFn: (slot: number) =>
      api.post<CandidateRecommendations>(`/candidate/recommendations/${slot}/renew`),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data)
      toast('Нове посилання створено, попереднє більше не діє')
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Не вдалося створити посилання', 'danger'),
  })
  const d = q.data
  const segments: SegmentState[] = d ? d.links.map((l) => (l.status === 'USED' ? 'done' : 'empty')) : []

  return (
    <div className="grid gap-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-10 gap-y-4 max-sm:grid-cols-1">
        <div className="grid min-w-0 gap-2">
          <h1 className="m-0 text-h1">Рекомендації</h1>
          <Lead>
            Надішліть {d?.total ?? 4} посилання людям, які знають вас по роботі: керівнику, колегам, підлеглим
          </Lead>
          <MetaRow source="відгуки людей, які вас знають" />
        </div>
        {d?.enabled && (
          <div className="grid justify-items-end gap-2 text-right max-sm:justify-items-start max-sm:text-left">
            <StageProgress done={d.used} total={d.total} label="відгуків отримано" segments={segments} />
            <p className="m-0 text-meta text-muted-foreground">Ви не бачите, хто відповів і що саме</p>
          </div>
        )}
      </header>
      <ErrorBox error={d ? null : q.error} />
      {q.isLoading && <Skeleton variant="rect" height={120} />}
      {d && !d.enabled && (
        // D-69 / BR-3: API більше не вимикає етап (enabled завжди true); гілку лишено як страховку
        <EmptyState compact title="Рекомендації не потрібні">
          Для цього оцінювання збирати відгуки не потрібно.
        </EmptyState>
      )}
      {d?.enabled && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,20rem)] items-start gap-6 max-[900px]:grid-cols-1">
          <Card as="section" title="Посилання" meta="одне посилання — одна людина">
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
              {d.links.map((l) => (
                <li key={l.slot} className="min-w-0">
                  <LinkCard
                    link={l}
                    renewing={renew.isPending && renew.variables === l.slot}
                    onRenew={() => renew.mutate(l.slot)}
                  />
                </li>
              ))}
            </ul>
            <div className="grid gap-1 pt-2">
              <p className="m-0 text-meta text-muted-foreground">
                Скопіюйте посилання й надішліть людині, яка знає вас по роботі. Кожне посилання одноразове —
                після відповіді воно перестає діяти; термін дії — 30 днів, дата на картці
              </p>
              <p className="m-0 text-meta text-muted-foreground">
                Коли людина відповість, лічильник угорі зміниться. Копіювання працює і без зв’язку
              </p>
            </div>
          </Card>
          <Card title={<span className="text-h3">Хто що бачить</span>}>
            <dl className="m-0 grid gap-3">
              {[
                ['Ви', `Лише кількість відповідей — зараз ${d.used} з ${d.total}`],
                ['HR', 'Відгуки без імен, з роллю, яку рекомендатор обрав сам'],
                [
                  'Рекомендатор',
                  'Ваше ім’я і кілька питань; близько 10 хвилин. Відповідь «Недостатньо знаю людину» теж можлива',
                ],
              ].map(([dt, dd]) => (
                <div key={dt} className="grid gap-0.5">
                  <dt className="text-label font-medium text-muted-foreground">{dt}</dt>
                  <dd className="m-0">{dd}</dd>
                </div>
              ))}
            </dl>
            {(() => {
              const open = d.links.find((l) => l.token && !l.expired)
              return open ? (
                <Act hint="Відкриє сторінку, на яку потрапить людина за посиланням (у новій вкладці; посилання не витрачається)">
                  <Button
                    variant="ghost"
                    icon={Eye}
                    onClick={() => window.open(linkUrl(open.token!), '_blank', 'noopener')}
                  >
                    Що бачить рекомендатор
                  </Button>
                </Act>
              ) : null
            })()}
          </Card>
        </div>
      )}
      <ActionGroup>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/candidate')}>
          До етапів
        </Button>
      </ActionGroup>
    </div>
  )
}
