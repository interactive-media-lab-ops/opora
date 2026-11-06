/** Анонімні відгуки рекомендаторів у картці кандидата. */
import { ChevronDown } from 'lucide-react'
import type { RecommendationReview } from '../api/types'
import { Badge, Card, Icon } from './ui'

const noun = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'відгук'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'відгуки'
  return 'відгуків'
}

/** Відгуки рекомендаторів для HR і методолога: лише роль і відповіді, без імен і часу (D-17). */
export function RecommendationReviews({ reviews }: { reviews: RecommendationReview[] }) {
  return (
    <Card title="Рекомендації" meta={`${reviews.length} ${noun(reviews.length)}`}>
      {reviews.length === 0 ? (
        <p className="m-0 text-meta text-muted-foreground">Відгуків ще немає.</p>
      ) : (
        <div className="grid gap-3">
          {reviews.map((r, i) => (
            <details key={i} className="group min-w-0 rounded-card border border-border bg-muted px-3">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-2 hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <Badge tone="slate">{r.role_label}</Badge>
                <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground">
                  {r.answers[0]?.text}
                </span>
                <Icon icon={ChevronDown} className="transition-transform group-open:rotate-180" />
              </summary>
              <dl className="m-0 grid gap-3 pb-3">
                {r.answers.map((a, j) => (
                  <div key={j} className="grid gap-0.5">
                    <dt className="text-label text-foreground-tertiary">{a.question}</dt>
                    <dd className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{a.text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      )}
    </Card>
  )
}
