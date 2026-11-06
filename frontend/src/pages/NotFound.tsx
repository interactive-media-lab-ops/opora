/** Сторінка 404. */
import { ArrowRight, FileQuestion, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { HOME_BY_ROLE, useAuth } from '../auth'
import { MinimalHeader } from '../components/Layout'
import { Button, EmptyState, Spinner } from '../components/ui'
import type { Role } from '../api/types'

/** Куди веде головна дія за роллю (патерн P, 58A: головна є лише тоді, коли наступний крок — у системі). */
const HOME_LABEL: Record<Role, string> = {
  CANDIDATE: 'До етапів',
  HR: 'До бази',
  METHODOLOGIST: 'До методологій',
  ADMIN: 'До користувачів',
}

/**
 * «Сторінку не знайдено» — інвентар §5.2 (раніше `*` тихо вів на вхід чи домашню). Патерн системних станів (DD-39):
 * EmptyState у колонці ≤36rem замість вмісту; заголовок — що сталося, текст — що робити, головна — наступний крок у системі.
 * Мок-доповнення до P: вигляд показується власнику у звіті зрізу 1.
 */
export function NotFound() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MinimalHeader />
      <main className="mx-auto w-full max-w-[39rem] min-w-0 flex-1 px-6 py-6 max-sm:px-4">
        {loading ? (
          <Spinner />
        ) : (
          <EmptyState
            icon={FileQuestion}
            title="Сторінку не знайдено"
            text="Перевірте адресу: можливо, в ній помилка або сторінку перенесено."
            action={
              user ? (
                <Button
                  icon={ArrowRight}
                  onClick={() => navigate(HOME_BY_ROLE[user.role], { replace: true })}
                >
                  {HOME_LABEL[user.role]}
                </Button>
              ) : (
                <Button icon={LogIn} onClick={() => navigate('/login', { replace: true })}>
                  Увійти
                </Button>
              )
            }
          />
        )}
      </main>
    </div>
  )
}
