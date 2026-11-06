/** HR: дашборд і база кандидатів. */
import { useSearchParams } from 'react-router-dom'
import { CandidateList } from '../../components/CandidateList'
import { PageHeader } from '../../components/ui'

/** H5 «База кандидатів» — домашня сторінка HR (87A, DD-44). Тексти — мок H5; рішення в системі — D-67 (пропозиція). */
export function HRCandidates() {
  const [params] = useSearchParams()
  return (
    <div>
      <PageHeader
        title="База кандидатів"
        subtitle="Усі, хто надіслав відповіді. Профіль — підстава для рішення; ваше рішення фіксується в картці кандидата"
      />
      <CandidateList
        key={params.toString()}
        endpoint="/hr/candidates"
        basePath="/hr/candidates"
        showLists
        initialVerdict={params.get('verdict') ?? ''}
        initialStage={params.get('stage') ?? ''}
      />
    </div>
  )
}
