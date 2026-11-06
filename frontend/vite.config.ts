import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:8765'

function walk(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    const rel = `${base}/${name}`
    return statSync(full).isDirectory() ? walk(full, rel) : [rel]
  })
}

/** Збирає src/sw.js у корінь збірки: підставляє перелік файлів оболонки й версію (хеш переліку та вмісту index.html). */
function serviceWorker(): Plugin {
  return {
    name: 'opora-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicFiles = walk('public').filter((f) => !f.endsWith('.DS_Store'))
      const built = Object.keys(bundle).map((f) => `/${f}`)
      const precache = [
        '/',
        '/index.html',
        ...built.filter((f) => f !== '/sw.js' && f !== '/index.html'),
        ...publicFiles,
      ].filter((f, i, a) => a.indexOf(f) === i)
      const version = createHash('sha1')
        .update(precache.join('\n'))
        .update(
          JSON.stringify(Object.values(bundle).map((b) => ('code' in b ? b.code : String(b.source)).length)),
        )
        .digest('hex')
        .slice(0, 10)
      const source = readFileSync('src/sw.js', 'utf8')
        .replaceAll('__VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
})
