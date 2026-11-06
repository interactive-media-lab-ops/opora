/** Маршрути застосунку: публічні сторінки, кабінети за ролями, захист за автентифікацією. */
import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HOME_BY_ROLE, AuthProvider, useAuth } from './auth'
import type { Role } from './api/types'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { Hub } from './pages/candidate/Hub'
import { StagePage } from './pages/candidate/StagePage'
import { AnswerQueueShell } from './pages/candidate/AnswerQueue'
import { MethodologyList } from './pages/methodologist/MethodologyList'
import { MethodologyEditor } from './pages/methodologist/MethodologyEditor'
import { HRCandidates } from './pages/hr/Candidates'
import { HRCandidateDetail } from './pages/hr/CandidateDetail'
import { Lists } from './pages/hr/Lists'
import { ToastProvider } from './components/Toast'
import { Invites } from './pages/hr/Invites'
import { Users } from './pages/admin/Users'
import { DeletionRequests } from './pages/admin/DeletionRequests'
import { Account } from './pages/Account'
import { Recommend } from './pages/recommend/Recommend'
import { CandidateRecommendationsPage } from './pages/candidate/Recommendations'
import { CandidatePreview } from './pages/admin/CandidatePreview'
import { NotFound } from './pages/NotFound'

// демо-збірка (VITE_DEMO=1) живе на одній сторінці без сервера — маршрути в хеші
const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } },
})

function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />
  return <Outlet />
}

function Home() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/login'} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <Router>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register/:code" element={<Register />} />
              <Route path="/r/:token" element={<Recommend />} />

              <Route element={<Layout />}>
                {/* D-76 (92A): акаунт є і в адміна — 2FA обовʼязкова, змінює сам; запиту на видалення немає (BR-8, API готовий). */}
                <Route element={<RequireRole roles={['CANDIDATE', 'METHODOLOGIST', 'HR', 'ADMIN']} />}>
                  <Route path="/account" element={<Account />} />
                </Route>

                <Route element={<RequireRole roles={['CANDIDATE']} />}>
                  <Route element={<AnswerQueueShell />}>
                    <Route path="/candidate" element={<Hub />} />
                    <Route path="/candidate/stage/:stage" element={<StagePage />} />
                    <Route path="/candidate/recommendations" element={<CandidateRecommendationsPage />} />
                  </Route>
                </Route>

                <Route element={<RequireRole roles={['METHODOLOGIST', 'ADMIN']} />}>
                  <Route path="/methodologist/methodologies" element={<MethodologyList />} />
                  <Route path="/methodologist/methodologies/:id" element={<MethodologyEditor />} />
                  {/* D-77 (власник 02.11): методист не має доступу до даних кандидатів — маршрути /methodologist/candidates* прибрано;
                      API /analysis/candidates* для методиста закрито (BR-17, 403). */}
                </Route>

                <Route element={<RequireRole roles={['HR', 'ADMIN']} />}>
                  {/* 87A (DD-44): домашня HR — база H5; дашборда немає, лічильники — у рядку статусу бази */}
                  <Route path="/hr" element={<Navigate to="/hr/candidates" replace />} />
                  <Route path="/hr/candidates" element={<HRCandidates />} />
                  <Route path="/hr/candidates/:id" element={<HRCandidateDetail />} />
                  <Route path="/hr/lists" element={<Lists />} />
                  <Route path="/hr/invites" element={<Invites />} />
                </Route>

                <Route element={<RequireRole roles={['ADMIN']} />}>
                  <Route path="/admin/users" element={<Users />} />
                  <Route path="/admin/deletion-requests" element={<DeletionRequests />} />
                  <Route path="/preview/candidate" element={<CandidatePreview />} />
                </Route>
              </Route>

              {/* інвентар §5.2: невідома адреса → «Сторінку не знайдено» (патерн P), а не тихий redirect */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
