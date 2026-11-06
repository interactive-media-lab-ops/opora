/** Картка-пропозиція встановити застосунок як PWA. */
import { useInstall } from '../lib/install'
import { Button, Card } from './ui'

/** Встановлення застосунку на пристрій (PWA): працює й без мережі, значок на екрані. */
export function InstallCard() {
  const { canInstall, iosHint, installed, install } = useInstall()
  if (installed || (!canInstall && !iosHint)) return null
  return (
    <Card title="Застосунок на пристрої">
      <p className="m-0 text-meta text-muted-foreground">
        Встановіть «Опору» на пристрій: вона відкриватиметься з екрана як звичайний застосунок і сторінки
        відкриваються навіть без інтернету.
      </p>
      {canInstall ? (
        <div>
          <Button variant="secondary" onClick={() => void install()}>
            Встановити застосунок
          </Button>
        </div>
      ) : (
        <p className="m-0 text-meta">
          На iPhone й iPad: натисніть «Поділитися» в Safari, потім «На екран Додому».
        </p>
      )}
    </Card>
  )
}
