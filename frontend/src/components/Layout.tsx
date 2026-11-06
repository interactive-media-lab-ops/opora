/** Каркас сторінки: шапка, навігація за роллю, перемикач теми, банер імперсонації. */
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  LogOut,
  Mail,
  Moon,
  Sun,
  UserRound,
  UserSearch,
  UserX,
  Users,
  WifiOff,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import type { Role } from '../api/types'
import { useOnline } from '../lib/online'
import { useTheme } from '../theme'
import { Alert, Button, EmptyState, Icon, Mark, Select, Spinner, cx } from './ui'

type Cabinet = 'admin' | 'methodologist' | 'hr' | 'candidate'

const CABINET_NAV: Record<Cabinet, { to: string; label: string; icon: LucideIcon }[]> = {
  admin: [
    { to: '/admin/users', label: 'Користувачі', icon: Users },
    { to: '/admin/deletion-requests', label: 'Запити на видалення', icon: UserX },
  ],
  // D-77 (02.11): у методиста лише методології — доступу до даних кандидатів немає
  methodologist: [{ to: '/methodologist/methodologies', label: 'Методології', icon: ListChecks }],
  // 87A (DD-44): домашня HR — база H5, дашборда немає; підписи — з моку H5 («База», «Списки»)
  hr: [
    { to: '/hr/candidates', label: 'База', icon: UserSearch },
    { to: '/hr/lists', label: 'Списки', icon: Bookmark },
    { to: '/hr/invites', label: 'Запрошення', icon: Mail },
  ],
  candidate: [],
}

const ROLE_CABINET: Record<Role, Cabinet> = {
  ADMIN: 'admin',
  METHODOLOGIST: 'methodologist',
  HR: 'hr',
  CANDIDATE: 'candidate',
}

/** Кабінети, між якими може перемикатися адмін. */
const ADMIN_CABINETS: { id: Cabinet; label: string; home: string; prefix: string }[] = [
  { id: 'admin', label: 'Адмін', home: '/admin/users', prefix: '/admin' },
  { id: 'methodologist', label: 'Методист', home: '/methodologist/methodologies', prefix: '/methodologist' },
  { id: 'hr', label: 'HR', home: '/hr/candidates', prefix: '/hr' },
  { id: 'candidate', label: 'Кандидат', home: '/preview/candidate', prefix: '/preview' },
]

/** Перемикач теми — ghost-іконка (налаштування прототипу, у моках його немає). */
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Світла тема' : 'Темна тема'
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={theme === 'dark' ? Sun : Moon}
      onClick={toggle}
      aria-label={label}
      title={label}
    />
  )
}

/**
 * Мінімальна шапка (AppNav minimal, 47A / K-8): тональна смуга bg-muted, знак КС 40 px, контекст («← До етапів»),
 * праворуч — кінцеві дії (меню акаунта або «Увійти»). Кандидат, вхід, реєстрація, рекомендатор, системні стани.
 */
export function MinimalHeader({ context, end }: { context?: ReactNode; end?: ReactNode }) {
  return (
    <header className="flex min-h-16 items-center gap-4 bg-muted px-6 py-3 max-sm:gap-3 max-sm:px-4">
      {/* знак — декоративний, як у моках (ціль дотику не потрібна; «на головну» веде «До етапів») */}
      <Mark />
      {context && <div className="min-w-0 font-medium">{context}</div>}
      <div className="ml-auto flex min-w-0 items-center gap-2">{end}</div>
    </header>
  )
}

/** Меню акаунта кандидата (DropdownMenu КС): «Ім'я ▾» → Акаунт · Вийти; на ≤600 px — лише іконка, ім'я в aria-label (47A). */
function AccountMenu({
  name,
  onAccount,
  onLogout,
}: {
  name: string
  onAccount: () => void
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = 'account-menu'
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => (
      document.removeEventListener('mousedown', onDoc),
      document.removeEventListener('keydown', onKey)
    )
  }, [open])
  const item =
    'flex h-(--control-h) w-full cursor-pointer items-center gap-3 rounded-item border-0 bg-transparent px-3 text-left text-[0.9375rem] text-popover-foreground hover:bg-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'
  const label = `Меню акаунта: ${name}`
  return (
    <div ref={root} className="relative min-w-0 max-w-[14rem]">
      <Button
        variant="ghost"
        icon={UserRound}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'w-full max-w-full [&>span]:min-w-0 max-sm:w-11 max-sm:px-0',
          open && 'bg-accent text-accent-foreground',
        )}
      >
        <span className="min-w-0 truncate max-sm:sr-only">{name}</span>
        <Icon icon={ChevronDown} size={16} className="max-sm:hidden" />
      </Button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label="Меню акаунта"
          className="absolute right-0 top-full z-(--op-z-dropdown) m-0 mt-1 min-w-[12rem] list-none rounded-overlay border border-popover-border bg-popover p-1 shadow-overlay"
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => (setOpen(false), onAccount())}
            >
              <Icon icon={UserRound} />
              Акаунт
            </button>
          </li>
          <li role="separator" className="my-1 border-t border-border" />
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => (setOpen(false), onLogout())}
            >
              <Icon icon={LogOut} />
              Вийти
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

export function Layout() {
  const { user, loading, logout, impersonating, stopImpersonation } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  // інвентар §5.1: без входу раніше була біла сторінка (null до RequireRole) — тепер redirect на вхід
  if (loading) return <Spinner className="p-6" />
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />

  const isAdmin = user.role === 'ADMIN'
  const cabinet: Cabinet = isAdmin
    ? (ADMIN_CABINETS.find((c) => pathname === c.prefix || pathname.startsWith(`${c.prefix}/`))?.id ??
      'admin')
    : ROLE_CABINET[user.role]
  const nav = CABINET_NAV[cabinet]
  const goCabinet = (id: Cabinet) => {
    const c = ADMIN_CABINETS.find((x) => x.id === id)
    if (c && id !== cabinet) navigate(c.home)
  }

  const impersonationBanner = impersonating && (
    <Alert
      variant="warning"
      role="status"
      className="rounded-none border-x-0"
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await stopImpersonation()
            navigate('/preview/candidate')
          }}
        >
          ← Повернутися до адміна
        </Button>
      }
    >
      Ви працюєте від імені демо-кандидата <b>{user.name}</b>. Зміни зберігаються в його проходженні.
    </Alert>
  )

  // Кандидат (47A, DD-38): без бічної панелі — мінімальна шапка; «До етапів» на всіх сторінках, крім хабу; контейнер 72rem
  if (user.role === 'CANDIDATE') {
    const onHub = pathname === '/candidate'
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <MinimalHeader
          context={
            !onHub && (
              <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/candidate')}>
                До етапів
              </Button>
            )
          }
          end={
            <>
              <ThemeToggle />
              <AccountMenu name={user.name} onAccount={() => navigate('/account')} onLogout={logout} />
            </>
          }
        />
        {impersonationBanner}
        <main className="mx-auto w-full max-w-[75rem] min-w-0 flex-1 px-6 py-6 max-sm:px-4">
          <Outlet />
        </main>
      </div>
    )
  }

  // 93 (02.11, власник): навігація HR / методиста / адміна — у шапці, як у моках MVP (AppNav: тональна смуга, пункти з
  // підкресленням поточного, меню акаунта); бічну панель (88B) замінено. На ≤600 px — нижня смуга (DD-21) без змін.
  const topNav = nav.length > 0 && (
    <nav aria-label="Розділи" className="flex min-w-0 flex-wrap items-center gap-1 max-sm:hidden">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="inline-flex h-11 items-center rounded-control px-4 font-medium text-foreground no-underline hover:bg-accent hover:text-accent-foreground aria-[current=page]:font-semibold aria-[current=page]:underline aria-[current=page]:decoration-border-accent aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[0.3em] aria-[current=page]:[text-decoration-skip-ink:none] aria-[current=page]:hover:bg-transparent aria-[current=page]:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
  const cabinetSwitch = isAdmin && (
    <>
      <div
        role="group"
        aria-label="Кабінет"
        className="hidden items-center gap-1 rounded-control bg-card p-0.5 md:inline-flex"
      >
        {ADMIN_CABINETS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={cabinet === c.id}
            onClick={() => goCabinet(c.id)}
            className="h-8 whitespace-nowrap rounded-control border border-transparent px-3 text-meta font-medium text-muted-foreground hover:text-foreground aria-pressed:border-border-accent aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {c.label}
          </button>
        ))}
      </div>
      {/* до 768 px пігулки чотирьох кабінетів не вміщаються поряд із навігацією — селект */}
      <div className="md:hidden">
        <Select aria-label="Кабінет" value={cabinet} onChange={(e) => goCabinet(e.target.value as Cabinet)}>
          {ADMIN_CABINETS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
    </>
  )

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MinimalHeader
        context={topNav}
        end={
          <>
            {cabinetSwitch}
            <ThemeToggle />
            {/* меню акаунта «Ім'я ▾» для всіх ролей (47A, мок H5); адмін — з D-76 (зріз 4) */}
            <AccountMenu name={user.name} onAccount={() => navigate('/account')} onLogout={logout} />
          </>
        }
      />
      {impersonationBanner}
      <main className="mx-auto w-full max-w-[80rem] min-w-0 flex-1 px-6 py-6 max-sm:px-4">
        {/* HR, методолог, адмін: без мережі застосунок відкривається, але персональних даних на пристрої немає (DD-13) */}
        {!online ? (
          <EmptyState icon={WifiOff} title="Немає зв’язку">
            Дані кандидатів не зберігаються на пристрої, тож без інтернету їх не видно. Сторінка оновиться,
            щойно зв’язок з’явиться.
          </EmptyState>
        ) : (
          <Outlet />
        )}
      </main>
      {nav.length > 0 && (
        <nav
          aria-label="Розділи"
          className="sticky bottom-0 z-10 flex gap-1 border-t border-border bg-muted px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:hidden"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="group flex min-h-14 flex-1 no-underline flex-col items-center justify-center gap-0.5 rounded-field text-label font-medium text-foreground aria-[current=page]:font-semibold"
            >
              <Icon icon={item.icon} size={24} />
              <span className="group-aria-[current=page]:underline group-aria-[current=page]:decoration-2 group-aria-[current=page]:decoration-border-accent">
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
