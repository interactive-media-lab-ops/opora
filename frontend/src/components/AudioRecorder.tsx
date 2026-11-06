/** Запис голосової відповіді в браузері (MediaRecorder). */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Mic, Square } from 'lucide-react'
import { Act, Alert, Button, Card, ErrorBox, Icon, cx } from './ui'

export type Phase = 'idle' | 'recording' | 'review'

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))
}

const extFor = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm')

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

export interface Clip {
  file: File
  duration: number
}

interface Props {
  maxDurationSec: number
  uploading: boolean
  onSubmit: (file: File, durationSec: number) => void
  /**
   * Вбудований режим (VoiceRecorder у композері розмови, 43A / 44A): без картки й без власної «Надіслати» —
   * спокій = кнопка «Голос», запис = таймер цифрами + «Зупинити запис», готово = рядок кліпу + «Записати ще»;
   * надсилає головна дія композера. Стан кліпу повідомляється через onChange.
   */
  inline?: boolean
  onChange?: (clip: Clip | null, phase: Phase) => void
  /** Запис недоступний (ліміт спроб) — кнопка «Голос» недоступна з причиною. */
  disabledReason?: string
}

export function AudioRecorder({
  maxDurationSec,
  uploading,
  onSubmit,
  inline,
  onChange,
  disabledReason,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; file: File; duration: number } | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)

  const cleanupStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
  }

  useEffect(
    () => () => {
      cleanupStream()
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
    },
    [],
  )

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview.url) : undefined), [preview])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current?.(
      preview ? { file: preview.file, duration: Math.min(preview.duration, maxDurationSec) } : null,
      phase,
    )
  }, [preview, phase, maxDurationSec])

  async function start() {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Ваш браузер не підтримує запис звуку. Спробуйте актуальну версію Chrome, Firefox чи Safari.')
      return
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError(
        'Немає доступу до мікрофона. Дозвольте його використання в налаштуваннях браузера й спробуйте знову.',
      )
      return
    }
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
    rec.onstop = () => {
      const duration = Math.max((Date.now() - startedAt.current) / 1000, 0.5)
      const type = rec.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks.current, { type })
      cleanupStream()
      const file = new File([blob], `answer.${extFor(type)}`, { type })
      setPreview({ url: URL.createObjectURL(blob), file, duration })
      setPhase('review')
    }
    recorder.current = rec
    startedAt.current = Date.now()
    setElapsed(0)
    rec.start()
    setPhase('recording')
    timer.current = window.setInterval(() => {
      const sec = (Date.now() - startedAt.current) / 1000
      setElapsed(sec)
      if (sec >= maxDurationSec) stop()
    }, 250)
  }

  function stop() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  function retake() {
    setPreview(null)
    setPhase('idle')
    setElapsed(0)
  }

  const nearLimit = phase === 'recording' && maxDurationSec > 60 && maxDurationSec - elapsed <= 60

  if (inline) {
    return (
      <div
        className={cx('grid min-w-0 justify-items-start gap-2', phase !== 'idle' && 'max-sm:w-full')}
        role="group"
        aria-label="Запис голосу"
      >
        {phase === 'idle' && (
          <Act
            fluid={false}
            hintClassName="max-sm:sr-only"
            hint={disabledReason ?? `Запис до ${fmt(maxDurationSec)} на одну відповідь`}
          >
            <Button
              variant="secondary"
              icon={Mic}
              onClick={start}
              aria-disabled={disabledReason ? true : undefined}
              onClickCapture={disabledReason ? (e) => e.preventDefault() : undefined}
            >
              Голос
            </Button>
          </Act>
        )}
        {phase === 'recording' && (
          <>
            <p
              className="m-0 inline-flex items-center gap-2.5 font-semibold tabular-nums"
              role="timer"
              aria-live="off"
            >
              <span aria-hidden="true" className="size-2.5 rounded-chip bg-destructive" />
              <span>Запис</span>
              <span className="font-normal text-muted-foreground">
                {fmt(elapsed)} / {fmt(maxDurationSec)}
              </span>
            </p>
            {nearLimit && (
              <p className="m-0 inline-flex max-w-[44ch] items-start gap-2 text-label text-status-warning-text">
                <Icon icon={AlertTriangle} size={16} className="mt-px" />
                <span>Менше хвилини: запис зупиниться сам, записане збережеться</span>
              </p>
            )}
            <Act hint="Запис додасться до відповіді">
              <Button variant="secondary" icon={Square} onClick={stop}>
                Зупинити запис
              </Button>
            </Act>
          </>
        )}
        {phase === 'review' && preview && (
          <>
            <p className="m-0 inline-flex items-center gap-2 font-medium">
              <Icon icon={Mic} size={16} />
              <span>Голосова відповідь · {fmt(preview.duration)}</span>
            </p>
            <audio controls src={preview.url} className="w-full max-w-[24rem]" />
            <Button variant="ghost" disabled={uploading} onClick={retake}>
              Записати ще
            </Button>
          </>
        )}
        {error && <ErrorBox message={error} className="w-full" />}
      </div>
    )
  }

  return (
    <Card>
      <div className="grid gap-3">
        {phase === 'idle' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={Mic} onClick={start}>
              ● Почати запис
            </Button>
            <span className="text-meta tabular-nums text-muted-foreground">До {fmt(maxDurationSec)}</span>
          </div>
        )}
        {phase === 'recording' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="size-2.5 rounded-full bg-destructive" />
              <span className="font-medium">Запис</span>
              <span className="tabular-nums text-muted-foreground">
                {fmt(elapsed)} / {fmt(maxDurationSec)}
              </span>
              <Button variant="secondary" icon={Square} onClick={stop} className="ml-auto">
                ■ Зупинити
              </Button>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-chip bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={maxDurationSec}
              aria-valuenow={Math.round(elapsed)}
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min((elapsed / maxDurationSec) * 100, 100)}%` }}
              />
            </div>
            {nearLimit && (
              <Alert variant="warning">
                Залишилась менше хвилини: запис зупиниться автоматично, а те, що вже записано, збережеться.
              </Alert>
            )}
          </div>
        )}
        {phase === 'review' && preview && (
          <div className="grid gap-3">
            <p className="m-0 text-meta text-muted-foreground">
              Прослухайте запис ({fmt(preview.duration)}). Якщо все гаразд — надішліть.
            </p>
            <audio controls src={preview.url} className="w-full" />
            <div className="flex flex-wrap gap-2 max-sm:flex-col max-sm:[&>button]:w-full">
              <Button
                loading={uploading}
                disabled={uploading}
                onClick={() => onSubmit(preview.file, Math.min(preview.duration, maxDurationSec))}
              >
                {uploading ? 'Надсилання…' : 'Надіслати відповідь'}
              </Button>
              <Button variant="ghost" disabled={uploading} onClick={retake}>
                Записати ще раз
              </Button>
            </div>
          </div>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Card>
  )
}
