/** Сторінка одного етапу (анкета / опитувальник) з переходами між ними. */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { CandidateAssessment, StageKey } from '../../api/types'
import { useToast } from '../../components/Toast'
import { ErrorBox, Lead, MetaRow, Skeleton, cx } from '../../components/ui'
import { ASSESSMENT_KEY } from './keys'
import { ChatInterview } from './ChatInterview'
import { ProfileStep, QuizStep } from './steps'

const KEYS = { profile: 'PROFILE', quiz: 'QUIZ', interview: 'INTERVIEW' } as const

const fmtMin = (sec: number) =>
  sec % 60 === 0 ? `${sec / 60} хв` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/** Підзаголовок і джерело етапу (моки C3 / C4; для опитувальника моку немає — текст «?»). Назви етапів — з конфігурації (D-73). */
function stageLead(key: StageKey, a: CandidateAssessment): { lead: string; source: string } {
  if (key === 'PROFILE')
    return {
      lead: 'Єдиний етап, який можна редагувати будь-коли. HR бачить останню збережену версію',
      source: 'сам про себе',
    }
  if (key === 'INTERVIEW') {
    const max = Math.max(0, ...a.interview_questions.map((q) => q.max_duration_sec))
    return {
      lead: `Питання йдуть по одному. Відповідайте текстом або голосом${max ? ` — до ${fmtMin(max)} на одне питання` : ''}, можна з перервами`,
      source: 'розмова з асистентом',
    }
  }
  return {
    lead: 'Відповідайте на питання по порядку. Чернетка зберігається автоматично',
    source: 'відповіді на питання',
  }
}

/** Сторінка одного етапу: шапка h1 + підзаголовок + рядок мети (C3 / C4), форма етапу; після надсилання — до хабу. */
export function StagePage() {
  const { stage = '' } = useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ASSESSMENT_KEY,
    queryFn: () => api.get<CandidateAssessment>('/candidate/assessment'),
  })

  if (q.isLoading) return <Skeleton variant="rect" height={240} />
  if (q.error && !q.data) return <ErrorBox error={q.error} />
  const a = q.data
  const key = KEYS[stage as keyof typeof KEYS]
  const info = a?.stages.find((s) => s.key === key)
  if (!a || !key || !info) return <Navigate to="/candidate" replace />
  // етап подано, а редагувати/перепроходити його не можна (або триває обробка) — назад до хабу
  // розмова сама показує фінальний екран (C4b) після надсилання, тому її не перенаправляємо
  if (info.status === 'SUBMITTED' && !info.can_edit && key !== 'INTERVIEW')
    return <Navigate to="/candidate" replace />

  const update = (data: CandidateAssessment) => qc.setQueryData(ASSESSMENT_KEY, data)
  const done = () => {
    toast(
      key === 'PROFILE' && info.status === 'SUBMITTED' ? 'Зміни збережено' : `Етап «${info.title}» надіслано`,
    )
    navigate('/candidate')
  }
  const { lead, source } = stageLead(key, a)
  const finished = key === 'INTERVIEW' && info.status === 'SUBMITTED'

  return (
    <div
      className={cx(
        'grid gap-6',
        key === 'INTERVIEW' && 'mx-auto w-full',
        key === 'INTERVIEW' && (finished ? 'max-w-[64rem]' : 'max-w-[56rem]'),
      )}
    >
      {/* C4b «Усе успішно» має власну шапку — тут її не дублюємо */}
      {!finished && (
        <div className="grid max-w-[68ch] gap-2">
          <h1 className="m-0 text-h1 [overflow-wrap:anywhere]">{info.title}</h1>
          <Lead>{lead}</Lead>
          <MetaRow
            source={source}
            updated={info.updated_at}
            version={info.methodology_version ?? a.methodology_version}
          />
        </div>
      )}
      {key === 'PROFILE' && <ProfileStep a={a} onUpdate={update} onDone={done} />}
      {key === 'QUIZ' && <QuizStep a={a} onUpdate={update} onDone={done} />}
      {key === 'INTERVIEW' && <ChatInterview a={a} />}
    </div>
  )
}
