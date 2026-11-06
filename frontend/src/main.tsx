/** Точка входу: React Query, тема, service worker; у демо-режимі — mockApi замість бекенду. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initInstallPrompt } from './lib/install'
import { initTheme } from './theme'

initTheme()
initInstallPrompt()

// Демо-збірка для огляду дизайну без сервера (VITE_DEMO=1): fetch('/api/…') відповідає вигаданими даними (src/demo/mockApi.ts)
const ready: Promise<unknown> = import.meta.env.VITE_DEMO
  ? import('./demo/mockApi').then(
      (m) => ((document.documentElement.dataset.brand = 'ks'), m.installMockApi()),
    )
  : Promise.resolve()

// PWA-оболонка: застосунок відкривається без мережі (лише у збірці; у dev service worker заважав би HMR; у демо — ні)
if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

void ready.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
