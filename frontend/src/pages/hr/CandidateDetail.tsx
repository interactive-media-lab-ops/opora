/** HR: картка кандидата — фінальні висновки, вердикт, нотатки, рекомендації, PDF. */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronDown, FileDown } from 'lucide-react'
import { api } from '../../api/client'
import { downloadCandidatePdf } from '../../api/lists'
import { useToast } from '../../components/Toast'
import type { HRDetail, Verdict } from '../../api/types'
import { RecommendationReviews } from '../../components/RecommendationReviews'
import { AnalyticsSlot } from '../../components/AnalyticsSlot'
import { VerdictHistory } from '../../components/VerdictHistory'
import { ListAction } from '../../components/ListAction'
import { HRNotes } from '../../components/HRNotes'
import { CandidateAnswers, sectionTitles } from '../../components/CandidateInfo'
import {
  ASSESSMENT_STATUS,
  Act,
  Avatar,
  Badge,
  Button,
  Card,
  ErrorBox,
  Icon,
  Markdownish,
  MetaRow,
  Radio,
  Spinner,
  StageProgress,
  StatusText,
  VERDICT_LABEL,
  VerdictText,
} from '../../components/ui'

/**
 * H6 «Профіль кандидата» (64A, DD-08; компонування — ЧЕКПОЙНТ 13, 03.11): шапка — ініціали 48, ПІБ, мета, дії під ПІБ на лінії імені
 * («До списку» і «Вивантажити PDF», обидві secondary — 97A; BR-10: PDF без нотаток, з записом у журнал), праворуч — рубіж етапів «N / M»
 * (98, гібрид C + A). Нижче — дві колонки: ліворуч аналітика, «Висновок», сирі дані (згорнуто), відгуки, «Історія змін»; праворуч вузька
 * колонка «Ваше рішення» (D-67, пропозиція; виділено межею border-accent — 99A) і «Нотатки» (свої в кожного HR — 79A / D-14).
 * На телефоні: шапка → рубіж → рішення → нотатки → решта. Запити й мутація — без змін.
 */
export function HRCandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['hr-candidate', id],
    queryFn: () => api.get<HRDetail>(`/hr/candidates/${id}`),
    refetchInterval: (query) => (query.state.data?.stage === 'PROCESSING' ? 5000 : false),
  })
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  useEffect(() => {
    if (q.data) {
      setVerdict(q.data.verdict)
    }
  }, [q.data?.verdict]) // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useToast()
  const exportPdf = useMutation({
    mutationFn: () => downloadCandidatePdf(Number(id), q.data?.candidate_name ?? ''),
    onSuccess: () => toast('PDF збережено. Нотаток у ньому немає'),
  })

  const save = useMutation({
    mutationFn: () => api.put<HRDetail>(`/hr/candidates/${id}/verdict`, { verdict }),
    onSuccess: (data) => {
      qc.setQueryData(['hr-candidate', id], data)
      qc.invalidateQueries({ queryKey: ['/hr/candidates'] })
      qc.invalidateQueries({ queryKey: ['hr-dashboard'] })
    },
  })

  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const dirtyVerdict = verdict !== d.verdict
  const dirty = dirtyVerdict

  // Етапи — з наявних розділів відповідей (назви — приклади, D-73); у базі HR усі етапи вже надіслано,
  // стан кожного = стан аналізу проходження. Рубіж по етапах у списку бази — BR-5 (готово)
  const titles = sectionTitles(d)
  const sections = [
    {
      key: 'profile',
      title: titles.profile,
      present: d.profile.length > 0,
    },
    { key: 'quiz', title: titles.quiz, present: d.quiz.length > 0 },
    { key: 'voice', title: titles.voice, present: d.voice.length > 0 },
    {
      key: 'recommendations',
      title: titles.recommendations,
      present: d.recommendations.length > 0,
    },
  ].filter((s) => s.present)
  const st = ASSESSMENT_STATUS[d.stage]
  const sent = d.stage === 'IN_PROGRESS' ? 0 : sections.length
  const back = (
    <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/hr/candidates')}>
      До бази
    </Button>
  )

  return (
    <div className="grid gap-6">
      <div>{back}</div>

      {/* шапка кандидата: ініціали 48 + ПІБ, мета, дії під ПІБ (97A); рубіж етапів праворуч від 1280 px (98), вужче — під дієвим рядком */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-5 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Avatar name={d.candidate_name} size="lg" />
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 text-h1 font-semibold [overflow-wrap:anywhere] text-balance">
            {d.candidate_name}
          </h1>
          <p className="m-0 text-meta text-muted-foreground [overflow-wrap:anywhere]">
            {d.candidate_email} · {d.methodology_title}
          </p>
          <MetaRow source="анкети кандидата" updated={d.submitted_at} />
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <ListAction assessmentId={d.id} candidateName={d.candidate_name} inHeader />
            {/* 64A / BR-10: шапка, етапи, аналітика, висновок, відгуки; нотаток HR немає; виклик логується */}
            <Act hint="Без ваших нотаток; експорт записується в журнал" fluid={false}>
              <Button
                variant="secondary"
                icon={FileDown}
                loading={exportPdf.isPending}
                onClick={() => !exportPdf.isPending && exportPdf.mutate()}
              >
                Вивантажити PDF
              </Button>
            </Act>
          </div>
        </div>
        {/* рубіж етапів (98): дані короткі — без окремої картки; стан аналізу однаковий для всіх етапів проходження */}
        <section
          aria-label="Етапи"
          className="col-span-2 grid min-w-0 justify-items-start gap-2 xl:col-span-1 xl:justify-items-end xl:text-right"
        >
          <StageProgress
            done={sent}
            total={sections.length}
            label="етапів надіслано"
            className="xl:justify-items-end"
          />
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 xl:justify-end">
            {sections.map((s) => (
              <li key={s.key}>
                <StatusText status={st.status} word={s.title} size="sm" />
              </li>
            ))}
          </ul>
          <p className="m-0 text-label text-foreground-tertiary">
            {st.word}
            {d.summary_score !== null && ` · зведений бал ${d.summary_score}`}
          </p>
        </section>
      </header>
      <ErrorBox error={exportPdf.error} />

      {/* праворуч (на телефоні — одразу після шапки) те, що вносить HR; ліворуч — доказ, за яким HR вирішує (98) */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4 lg:col-start-2 lg:row-start-1">
          {/* D-67 (77A, пропозиція): локальне рішення HR — єдина головна дія екрана; виділено лише межею (99A) */}
          <Card
            accent
            title="Ваше рішення"
            meta={d.verdict ? <VerdictText verdict={d.verdict} size="sm" /> : 'ще не ухвалено'}
          >
            <fieldset className="m-0 grid gap-1 border-0 p-0">
              <legend className="sr-only">Вердикт</legend>
              {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
                <Radio
                  key={v}
                  name="verdict"
                  label={VERDICT_LABEL[v]}
                  checked={verdict === v}
                  onChange={() => setVerdict(v)}
                />
              ))}
            </fieldset>
            {verdict && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setVerdict(null)}>
                  Скинути вердикт
                </Button>
              </div>
            )}
            <ErrorBox error={save.error} />
            <Act
              hint={dirty ? 'Зміна потрапить в історію змін' : 'Змініть рішення, щоб зберегти'}
              fluid={false}
            >
              <Button
                icon={Check}
                loading={save.isPending}
                aria-disabled={!dirty || undefined}
                onClick={() => dirty && save.mutate()}
              >
                Зберегти рішення
              </Button>
            </Act>
          </Card>

          {/* 65B / 79A (D-14, BR-6): нотатки — свої в кожного HR, поруч із рішенням */}
          <HRNotes assessmentId={d.id} />
        </div>

        <div className="grid min-w-0 gap-6 lg:col-start-1 lg:row-start-1">
          <AnalyticsSlot a={d.analytics} />

          {/* висновок ШІ — одна картка, як у коді; підсумки по етапах — D-72 (пропозиція) */}
          <Card
            title="Висновок"
            meta={
              d.stage === 'DONE'
                ? `${d.final_conclusions.length} ${d.final_conclusions.length === 1 ? 'вузол' : 'вузлів'} аналізу`
                : undefined
            }
          >
            {d.stage !== 'DONE' ? (
              <StatusText status={st.status} word={`${st.word} — висновок з’явиться автоматично`} />
            ) : d.final_conclusions.length === 0 ? (
              <p className="m-0 text-meta text-muted-foreground">Висновків немає.</p>
            ) : (
              <div className="grid gap-5">
                {d.final_conclusions.map((c) => (
                  <div key={c.node_name}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="m-0 font-semibold">{c.node_name}</h3>
                      {c.score !== null && (
                        <Badge tone="slate" className="tabular-nums">
                          {c.score}/10
                        </Badge>
                      )}
                    </div>
                    <Markdownish text={c.output} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* DD-08: сирі дані згорнуті */}
          <details className="group rounded-card border border-border bg-card px-(--gap)">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 font-medium hover:text-link focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="flex-1">Сирі дані</span>
              <span className="text-label font-normal text-foreground-tertiary">
                {sections
                  .filter((s) => s.key !== 'recommendations')
                  .map((s) => s.title.toLowerCase())
                  .join(', ')}
              </span>
              <Icon icon={ChevronDown} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="pb-4">
              <CandidateAnswers d={d} />
            </div>
          </details>

          <RecommendationReviews reviews={d.recommendations} />
          <VerdictHistory history={d.history} events={d.events} />
        </div>
      </div>

      <div>{back}</div>
    </div>
  )
}
