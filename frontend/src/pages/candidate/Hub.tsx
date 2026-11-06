/** Головна кабінету кандидата: перелік етапів і їх стан. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { CandidateAssessment, CandidateRecommendations, StageInfo, StageKey } from '../../api/types'
import { useAuth } from '../../auth'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import {
  Act,
  ActionGroup,
  Alert,
  Button,
  Card,
  ErrorBox,
  MetaRow,
  Segments,
  Skeleton,
  StageProgress,
  StageTag,
  cx,
  type SegmentState,
  type StageStatusKey,
} from '../../components/ui'
import { OfflineBanner } from './OfflineBanner'

import { ASSESSMENT_KEY, RECOMMENDATIONS_KEY } from './keys'
const PATH: Record<StageKey, string> = { PROFILE: 'profile', QUIZ: 'quiz', INTERVIEW: 'interview' }
const RETAKE_API: Partial<Record<StageKey, string>> = { QUIZ: 'quiz', INTERVIEW: 'interview' }

/** Статус картки за даними API (DD-36, схема B): не почато → в процесі → надіслано; помилка обробки — danger. */
function statusOf(s: StageInfo, problem: boolean): StageStatusKey {
  if (problem) return 'error'
  return s.status === 'SUBMITTED' ? 'sent' : s.status === 'IN_PROGRESS' ? 'in-progress' : 'not-started'
}

/**
 * Картка етапу (StageCard, 29A / 36B): шапка — назва + один тег статусу; тіло — рядок мети (оновлено · методологія vN) і текст;
 * підвал — одна дія за станом з підказкою «що буде далі». Головної (primary) у картці немає (DD-37). У групі — блок sunken (9B).
 */
function StageCard({
  title,
  status,
  statusWord,
  updated,
  version,
  text,
  alert,
  sub,
  action,
  current,
  className,
}: {
  title: string
  status: StageStatusKey
  statusWord?: string
  updated?: string | null
  version?: number | null
  text?: ReactNode
  alert?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  current?: boolean
  className?: string
}) {
  return (
    <Card
      as="article"
      sunken
      title={title}
      actions={<StageTag status={status} word={statusWord} />}
      footer={action}
      aria-current={current ? 'step' : undefined}
      className={cx('[&>div:first-child]:items-start', className)}
    >
      <MetaRow updated={updated ?? undefined} version={version} />
      {alert && <p className="m-0 text-meta text-status-danger-text">{alert}</p>}
      {text && <p className="m-0 max-w-[72ch]">{text}</p>}
      {sub}
    </Card>
  )
}

/** Рядок «сценаріїв / відгуків N / M» у картці: компактні сегменти + підпис. */
function SubProgress({ done, total, noun }: { done: number; total: number; noun: string }) {
  const items = Array.from({ length: total }, (_, i): SegmentState => (i < done ? 'done' : 'empty'))
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Segments compact items={items} label={`${noun}: ${done} з ${total}`} />
      <span className="text-label tabular-nums text-foreground-tertiary">
        {noun} {done} / {total}
      </span>
    </div>
  )
}

/** Хаб етапів (C2, DD-07): незалежні етапи з картками; одна головна дія — у шапці, за станом етапів (37A); «N / M» з переліку (D-65). */
export function Hub() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const q = useQuery({
    queryKey: ASSESSMENT_KEY,
    queryFn: () => api.get<CandidateAssessment>('/candidate/assessment'),
    refetchInterval: (query) => (query.state.data?.stage === 'PROCESSING' ? 4000 : false),
  })
  const recs = useQuery({
    queryKey: RECOMMENDATIONS_KEY,
    queryFn: () => api.get<CandidateRecommendations>('/candidate/recommendations'),
    enabled: q.data?.recommendations_enabled === true,
  })
  const [retake, setRetake] = useState<StageInfo | null>(null)
  const doRetake = useMutation({
    mutationFn: (s: StageInfo) =>
      api.post<CandidateAssessment>(`/candidate/assessment/${RETAKE_API[s.key]}/retake`),
    onSuccess: (data, s) => {
      qc.setQueryData(ASSESSMENT_KEY, data)
      setRetake(null)
      navigate(`/candidate/stage/${PATH[s.key]}`)
    },
    onError: (e) => (
      setRetake(null),
      toast(e instanceof Error ? e.message : 'Не вдалося почати заново', 'danger')
    ),
  })

  if (q.isLoading) return <Skeleton variant="rect" height={240} />
  if (q.error && !q.data) return <ErrorBox error={q.error} /> // з копією на пристрої показуємо її, навіть якщо мережі немає
  const a = q.data
  if (!a) return null

  const processing = a.stage === 'PROCESSING'
  const problemStage = a.processing_problem ? a.stages.find((s) => s.key === 'INTERVIEW') : undefined
  const next =
    a.stages.find((s) => s.status === 'IN_PROGRESS') ?? a.stages.find((s) => s.status === 'NOT_STARTED')
  const firstName = user?.name.split(' ')[0]
  const go = (s: StageInfo) => navigate(`/candidate/stage/${PATH[s.key]}`)
  const askRetake = (s: StageInfo) => (doRetake.reset(), setRetake(s))

  // Рубіж «N / M» (D-65, D-69): M — з переліку етапів; «Рекомендації» рахуються етапом, коли їх увімкнено (D-69 — поведінка API без змін).
  // BR-3 (D-69): API віддає recommendations_enabled і enabled завжди true — «Рекомендації» є завжди, навіть без питань
  const recsOn = a.recommendations_enabled && recs.data?.enabled
  const recsDone = recsOn ? recs.data!.used >= recs.data!.total : false
  const stageSegments: SegmentState[] = a.stages.map((s) =>
    s === problemStage
      ? 'soft'
      : s.status === 'SUBMITTED'
        ? 'done'
        : s.status === 'IN_PROGRESS'
          ? 'soft'
          : 'empty',
  )
  if (recsOn) stageSegments.push(recsDone ? 'done' : (recs.data!.used ?? 0) > 0 ? 'soft' : 'empty')
  const total = stageSegments.length
  const done = stageSegments.filter((x) => x === 'done').length
  const allDone = done === total

  // Головна дія — одна, за станом (37A): помилка → продовжити → почати; немає кроку — немає головної (DD-37)
  let primary: ReactNode = null
  if (processing && !problemStage) {
    primary = null
  } else if (problemStage) {
    primary = (
      <Act hint="Попередня спроба збережеться в історії, відповіді очистяться">
        <Button onClick={() => askRetake(problemStage)}>Пройти заново: {problemStage.title}</Button>
      </Act>
    )
  } else if (next) {
    const cont = next.status === 'IN_PROGRESS'
    primary = (
      <Act
        hint={cont ? `Відкриє етап «${next.title}» там, де ви зупинились` : `Відкриє етап «${next.title}»`}
      >
        <Button onClick={() => go(next)}>
          {cont ? 'Продовжити' : 'Почати'}: {next.title}
        </Button>
      </Act>
    )
  }

  return (
    <div className="grid gap-6">
      <OfflineBanner />
      {a.processing_problem && (
        <Alert variant="danger" title="Не вдалося обробити запис розмови">
          Спробуйте записати відповіді ще раз кнопкою «Пройти заново». Якщо помилка повториться, зверніться до
          організаторів оцінювання.
        </Alert>
      )}
      {processing && !a.processing_problem && (
        <Alert variant="info" role="status">
          Ваші відповіді обробляються. Редагування й повторне проходження будуть доступні після завершення
          обробки.
        </Alert>
      )}

      {/* HubHeader (D4): текст | рубіж; дія під текстом; на ≤640 — стовпець */}
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-10 gap-y-4 [grid-template-areas:'text_rub'_'acts_rub'] max-sm:grid-cols-1 max-sm:[grid-template-areas:'text'_'rub'_'acts']">
        <div className="grid min-w-0 gap-2 [grid-area:text]">
          <h1 className="m-0 text-h1 [overflow-wrap:anywhere]">Вітаємо{firstName ? `, ${firstName}` : ''}</h1>
          <p className="m-0 max-w-[56ch] text-[1.125rem] leading-normal text-muted-foreground">
            {a.methodology_title}: етапи незалежні — проходьте в будь-якому порядку. Збережене не губиться
          </p>
        </div>
        <StageProgress
          className="[grid-area:rub]"
          done={done}
          total={total}
          label="етапів надіслано"
          segments={stageSegments}
        />
        <div className="min-w-0 [grid-area:acts]">
          {primary ? (
            <ActionGroup aria-label="Наступний крок">{primary}</ActionGroup>
          ) : allDone && !processing ? (
            <p className="m-0 max-w-[52ch] text-[0.9375rem] text-muted-foreground" role="status">
              Усі етапи надіслано — команда HR розгляне результати й зв’яжеться з вами. Будь-який етап можна
              відкрити з картки нижче
            </p>
          ) : null}
        </div>
      </header>

      <Card as="section" title="Етапи" meta={`усі ${total} незалежні`} aria-label="Етапи">
        <div className="op-rise grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-4">
          {a.stages.map((s) => {
            const problem = s === problemStage
            const busy = processing && !s.can_retake
            const status = statusOf(s, problem)
            let action: ReactNode = null
            if (busy) {
              action = (
                <Act hint="Недоступно, доки триває обробка">
                  <Button variant="secondary" disabled>
                    {s.status === 'SUBMITTED'
                      ? s.can_edit
                        ? 'Редагувати'
                        : 'Пройти заново'
                      : s.status === 'IN_PROGRESS'
                        ? 'Продовжити'
                        : 'Почати'}
                  </Button>
                </Act>
              )
            } else if (problem && s.can_retake) {
              action = (
                <Act hint="Заповнене збережеться в історії для HR">
                  <Button variant="secondary" onClick={() => askRetake(s)}>
                    Пройти заново
                  </Button>
                </Act>
              )
            } else if (s.status === 'NOT_STARTED') {
              action = (
                <Act
                  hint={
                    s.key === 'PROFILE'
                      ? 'Редагується будь-коли'
                      : 'Після завершення етап можна пройти заново'
                  }
                >
                  <Button variant="secondary" onClick={() => go(s)}>
                    Почати
                  </Button>
                </Act>
              )
            } else if (s.status === 'IN_PROGRESS') {
              action = (
                <Act hint="Попередні відповіді збережено">
                  <Button variant="secondary" onClick={() => go(s)}>
                    Продовжити
                  </Button>
                </Act>
              )
            } else if (s.can_edit) {
              action = (
                <Act hint="Зміни надішлемо після збереження">
                  <Button variant="ghost" onClick={() => go(s)}>
                    Редагувати
                  </Button>
                </Act>
              )
            } else if (s.can_retake) {
              action = (
                <Act hint="Попереднє проходження збережеться; HR бачить останнє">
                  <Button variant="ghost" onClick={() => askRetake(s)}>
                    Пройти заново
                  </Button>
                </Act>
              )
            }
            return (
              <StageCard
                key={s.key}
                title={s.title}
                status={status}
                updated={s.status === 'SUBMITTED' ? s.updated_at : undefined}
                version={s.methodology_version ?? a.methodology_version}
                alert={problem ? 'Не вдалося обробити запис. Пройдіть розмову заново' : undefined}
                text={`Питань: ${s.question_count}`}
                action={action}
                current={s === next}
              />
            )
          })}
          {a.recommendations_enabled && (
            <StageCard
              title="Рекомендації"
              status={
                recsOn
                  ? recsDone
                    ? 'sent'
                    : recs.data!.used > 0
                      ? 'in-progress'
                      : 'not-started'
                  : 'not-started'
              }
              version={a.methodology_version}
              text="Посилання для людей, які знають вас у роботі"
              sub={
                recsOn ? (
                  <SubProgress done={recs.data!.used} total={recs.data!.total} noun="відгуків" />
                ) : undefined
              }
              action={
                <Act hint="Ви бачите лише кількість відповідей, не їхній зміст">
                  <Button variant="secondary" onClick={() => navigate('/candidate/recommendations')}>
                    {recsOn && recs.data!.used > 0 ? 'Продовжити' : 'Відкрити'}
                  </Button>
                </Act>
              }
            />
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={retake !== null}
        title={retake ? `Пройти «${retake.title}» заново?` : ''}
        description={
          retake?.key === 'INTERVIEW'
            ? 'Попередня спроба збережеться в історії для HR, відповіді очистяться, а лічильник спроб запису почнеться з нуля. Розмову потрібно буде пройти й надіслати знову.'
            : 'Попередня спроба збережеться в історії для HR, відповіді очистяться. Опитувальник потрібно буде заповнити й надіслати знову.'
        }
        confirmLabel="Пройти заново"
        pending={doRetake.isPending}
        onCancel={() => setRetake(null)}
        onConfirm={() => retake && doRetake.mutate(retake)}
      />
    </div>
  )
}

/** Посилання «← До етапів» — лишається для сумісності (у шапці кандидата воно вже є, 47A). */
export function BackToHub() {
  return (
    <Link to="/candidate" className="inline-block text-meta text-link hover:underline">
      ← До етапів
    </Link>
  )
}
