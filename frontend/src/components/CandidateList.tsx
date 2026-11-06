/** Таблиця кандидатів із фільтрами й сортуванням (HR і адмін). */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { SearchX, SlidersHorizontal, Users } from 'lucide-react'
import { api } from '../api/client'
import type { CandidateRow, Dashboard, MethodologyListItem, Stage } from '../api/types'
import {
  ASSESSMENT_STATUS,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  Sheet,
  StatusText,
  VERDICT_LABEL,
  VerdictText,
  DayCell,
} from './ui'
import { ListAction } from './ListAction'
import { DataTable, SortTh, TableSkeleton, Td, Th } from './table'

interface Props {
  endpoint: '/hr/candidates' | '/analysis/candidates'
  basePath: string
  showFailures?: boolean
  /** Кнопка «До списку» в рядках (лише HR). */
  showLists?: boolean
  initialVerdict?: string
  initialStage?: string
}

/** Підпис стану в фільтрі — ті самі слова, що й у колонці «Стан» (мок H5). */
const STAGE_FILTER_ALL: Stage[] = ['IN_PROGRESS', 'PROCESSING', 'DONE']
/** Кабінет аналізу бачить лише подані проходження — «В процесі» там немає. */
const STAGE_FILTER_SUBMITTED: Stage[] = ['PROCESSING', 'DONE']

type SortKey = 'name' | 'completeness' | 'updated' | 'date' | 'score'
type SortDir = 'asc' | 'desc'
const defaultDir = (key: SortKey): SortDir => (key === 'name' ? 'asc' : 'desc')

/**
 * База кандидатів (H5, 38A / 78A): пошук за ПІБ, фільтри (на ≤640 px — за кнопкою «Фільтри · N», 62A), рядок статусу
 * «Знайдено N · …», таблиця КС (ПІБ з ініціалами, стан словом + іконкою, вердикт D-67). Дані й запити — без змін.
 * BR-5 (78A / 94A): база HR містить усіх кандидатів із рубежем етапів «N / M»; сортування сервером —
 * `sort=name|completeness|updated&dir=asc|desc`, за замовчуванням «Оновлено ↓». Кабінет аналізу (адмін) лишає `date|score`.
 * Кольору за повнотою немає (D-22 / D-60).
 */
export function CandidateList({
  endpoint,
  basePath,
  showFailures,
  showLists,
  initialVerdict = '',
  initialStage = '',
}: Props) {
  const [methodologyId, setMethodologyId] = useState('')
  const [stage, setStage] = useState(initialStage)
  const [verdict, setVerdict] = useState(initialVerdict)
  const [search, setSearch] = useState('')
  const isHr = endpoint === '/hr/candidates'
  const [sortState, setSortState] = useState<{ key: SortKey; dir: SortDir }>({
    key: isHr ? 'updated' : 'date',
    dir: 'desc',
  })
  const sort = sortState.key
  const toggleSort = (key: SortKey) =>
    setSortState((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) },
    )
  const sortDir = (key: SortKey) => (sortState.key === key ? sortState.dir : defaultDir(key))
  const stageFilter = isHr ? STAGE_FILTER_ALL : STAGE_FILTER_SUBMITTED
  const [filtersOpen, setFiltersOpen] = useState(false)

  const methodologies = useQuery({
    queryKey: ['methodologies'],
    queryFn: () => api.get<MethodologyListItem[]>('/methodologies'),
  })

  const params = new URLSearchParams()
  if (methodologyId) params.set('methodology_id', methodologyId)
  if (stage) params.set('stage', stage)
  if (verdict) params.set('verdict', verdict)
  if (search.trim()) params.set('search', search.trim())
  params.set('sort', sortState.key)
  params.set('dir', sortState.dir)

  const rows = useQuery({
    queryKey: [endpoint, params.toString()],
    queryFn: () => api.get<CandidateRow[]>(`${endpoint}?${params}`),
    refetchInterval: 15000,
  })
  // 87A: лічильники колишнього дашборда — у рядку статусу бази (лише HR)
  const counters = useQuery({
    queryKey: ['hr-dashboard'],
    queryFn: () => api.get<Dashboard>('/hr/dashboard'),
    enabled: endpoint === '/hr/candidates',
    refetchInterval: 20000,
  })

  const filterCount = [methodologyId, stage, verdict, search.trim()].filter(Boolean).length
  const list = rows.data ?? []
  const emptyBase = rows.data?.length === 0 && filterCount === 0
  const resetFilters = () => (setMethodologyId(''), setStage(''), setVerdict(''), setSearch(''))

  // 63A: порожня база — окремий стан сторінки без пошуку й таблиці
  if (emptyBase) {
    return (
      <EmptyState icon={Users} title="У базі ще немає кандидатів">
        Кандидати з’являться, щойно хтось надішле відповіді. Пошук і фільтри з’являться разом із першим
        кандидатом
      </EmptyState>
    )
  }

  const filters = (
    <>
      <div className="w-[12rem] max-sm:w-full">
        <Field label="Методологія">
          <Select value={methodologyId} onChange={(e) => setMethodologyId(e.target.value)}>
            <option value="">Усі методології</option>
            {methodologies.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-[12rem] max-sm:w-full">
        <Field label="Стан">
          <Select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Будь-який стан</option>
            {stageFilter.map((s) => (
              <option key={s} value={s}>
                {ASSESSMENT_STATUS[s].word}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-[12rem] max-sm:w-full">
        <Field label="Вердикт">
          <Select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
            <option value="">Будь-який вердикт</option>
            <option value="NONE">Без вердикту</option>
            {Object.entries(VERDICT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-[12rem] max-sm:w-full sm:hidden">
        <Field label="Сортування">
          <Select
            value={sort}
            onChange={(e) =>
              setSortState({ key: e.target.value as SortKey, dir: defaultDir(e.target.value as SortKey) })
            }
          >
            {isHr ? (
              <>
                <option value="updated">Спершу оновлені</option>
                <option value="name">За іменем</option>
                <option value="completeness">За повнотою профілю</option>
              </>
            ) : (
              <>
                <option value="date">Спершу нові</option>
                <option value="name">За іменем</option>
                <option value="score">За зведеним балом</option>
              </>
            )}
          </Select>
        </Field>
      </div>
    </>
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-[22rem] flex-[1_1_16rem] max-sm:max-w-none">
          <Field label="Пошук за ПІБ">
            <Input
              type="search"
              placeholder="Прізвище, ім’я або пошта"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        {/* ≥640 px: фільтри в рядку; ≤640 px: за кнопкою «Фільтри · N» → нижній лист (62A, 4B) */}
        <div className="contents max-sm:hidden">{filters}</div>
        <div className="w-full sm:hidden">
          <Button
            variant="secondary"
            icon={SlidersHorizontal}
            aria-expanded={filtersOpen}
            aria-controls="list-filters"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Фільтри
            {filterCount - (search.trim() ? 1 : 0) > 0 ? ` · ${filterCount - (search.trim() ? 1 : 0)}` : ''}
          </Button>
        </div>
      </div>
      {/* 4B (02.11, власник): на ≤640 px фільтри — у нижньому листі (мок H5 390) */}
      <Sheet
        open={filtersOpen}
        title="Фільтри"
        onClose={() => setFiltersOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFiltersOpen(false)}>
              Готово
            </Button>
            <Button variant="ghost" onClick={() => (setMethodologyId(''), setStage(''), setVerdict(''))}>
              Скинути
            </Button>
          </>
        }
      >
        <div id="list-filters" className="grid gap-3 [&>div]:w-full">
          {filters}
        </div>
      </Sheet>
      {rows.data && (
        <p className="m-0 text-meta tabular-nums text-muted-foreground" aria-live="polite">
          {rows.data.length === 0 ? 'Збігів немає' : <>Знайдено {rows.data.length}</>}
          {' · '}
          {filterCount ? `фільтрів: ${filterCount}` : 'без фільтрів'}
          {counters.data && filterCount === 0 && counters.data.awaiting_verdict > 0 && (
            <> · чекають на рішення: {counters.data.awaiting_verdict}</>
          )}
        </p>
      )}

      <ErrorBox error={rows.error} />
      {rows.data && rows.data.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            compact
            icon={SearchX}
            title="Нікого не знайдено"
            action={
              <Button variant="secondary" onClick={resetFilters}>
                Показати всіх
              </Button>
            }
          >
            За пошуком і фільтрами збігів немає. Перевірте написання ПІБ або зніміть частину фільтрів
          </EmptyState>
        </div>
      ) : (
        <DataTable caption="Кандидати" busy={rows.isLoading}>
          <thead>
            <tr>
              <SortTh
                active={sort === 'name'}
                dir={sortDir('name') === 'asc' ? 'ascending' : 'descending'}
                onSort={() => toggleSort('name')}
                className="w-[32%] sm:min-w-[15rem]"
              >
                ПІБ
              </SortTh>
              {isHr ? (
                <>
                  <SortTh
                    priority={3}
                    active={sort === 'updated'}
                    dir={sortDir('updated') === 'asc' ? 'ascending' : 'descending'}
                    onSort={() => toggleSort('updated')}
                  >
                    Оновлено
                  </SortTh>
                  <SortTh
                    priority={2}
                    active={sort === 'completeness'}
                    dir={sortDir('completeness') === 'asc' ? 'ascending' : 'descending'}
                    onSort={() => toggleSort('completeness')}
                  >
                    Етапи
                  </SortTh>
                </>
              ) : (
                <SortTh
                  priority={3}
                  active={sort === 'date'}
                  dir={sortDir('date') === 'asc' ? 'ascending' : 'descending'}
                  onSort={() => toggleSort('date')}
                >
                  Подано
                </SortTh>
              )}
              <Th>Стан</Th>
              <SortTh
                className="text-right"
                active={sort === 'score'}
                dir={sortDir('score') === 'asc' ? 'ascending' : 'descending'}
                onSort={() => toggleSort('score')}
              >
                Бал
              </SortTh>
              <Th>Вердикт</Th>
              {showLists && <Th />}
            </tr>
          </thead>
          {rows.isLoading || !rows.data ? (
            <TableSkeleton cols={(isHr ? 6 : 5) + (showLists ? 1 : 0)} />
          ) : (
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td lead>
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.candidate_name} />
                      <span className="grid min-w-0">
                        <Link to={`${basePath}/${r.id}`} className="row-link font-medium">
                          {r.candidate_name}
                        </Link>
                        <span
                          className="block truncate text-label text-foreground-tertiary"
                          title={`${r.candidate_email} · ${r.methodology_title}`}
                        >
                          {r.candidate_email} · {r.methodology_title}
                        </span>
                      </span>
                    </span>
                  </Td>
                  {isHr ? (
                    <>
                      <Td label="Оновлено" priority={3} className="whitespace-nowrap tabular-nums">
                        <DayCell iso={r.updated_at} />
                      </Td>
                      <Td label="Етапи" priority={2} className="whitespace-nowrap tabular-nums">
                        {r.stages?.length
                          ? `${r.stages.filter((s) => s.status === 'SUBMITTED').length} / ${r.stages.length}`
                          : '—'}
                      </Td>
                    </>
                  ) : (
                    <Td label="Подано" priority={3} className="whitespace-nowrap tabular-nums">
                      <DayCell iso={r.submitted_at} />
                    </Td>
                  )}
                  <Td label="Стан">
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusText
                        status={ASSESSMENT_STATUS[r.stage].status}
                        word={ASSESSMENT_STATUS[r.stage].word}
                        className="whitespace-nowrap"
                      />
                      {showFailures && r.failed_steps ? (
                        <Badge tone="red">Збоїв: {r.failed_steps}</Badge>
                      ) : null}
                    </span>
                  </Td>
                  <Td label="Бал" className="num font-medium tabular-nums">
                    {r.summary_score ?? '—'}
                  </Td>
                  <Td label="Вердикт">
                    <VerdictText verdict={r.verdict} />
                  </Td>
                  {showLists && (
                    <Td actions className="text-right">
                      <ListAction assessmentId={r.id} candidateName={r.candidate_name} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          )}
        </DataTable>
      )}
    </div>
  )
}
