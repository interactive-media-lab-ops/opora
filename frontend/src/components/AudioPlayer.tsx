/** Програвач аудіозапису відповіді з бекенду. */
import { useEffect, useState } from 'react'
import { fetchBlob } from '../api/client'
import { ErrorBox, Skeleton } from './ui'

/** Аудіо за захищеним ендпоінтом: <audio> не вміє слати Authorization, тому тягнемо як blob. */
export function AudioPlayer({ voiceAnswerId, path }: { voiceAnswerId?: number; path?: string }) {
  const source = path ?? `/audio/${voiceAnswerId}`
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    fetchBlob(source)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])

  if (error) return <ErrorBox message="Не вдалося завантажити запис" />
  if (!url) return <Skeleton variant="rect" height={54} aria-label="Завантаження запису…" />
  return <audio controls src={url} className="w-full" />
}
