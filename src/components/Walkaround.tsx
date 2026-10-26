// Круговое видео при приёмке: запись камерой в приложении (MediaRecorder),
// а если она недоступна — системной камерой или из галереи.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { classifyCameras, currentZoom, openCamera, setZoom, stopStream, trackLabel, zoomBase, zoomLevels, zoomRange, type Cameras, type ZoomRange } from '../camera'
import { useSettings, useT } from '../settingsHooks'
import type { Order, VideoRef } from '../types'
import { addVideo, deleteVideos, formatDuration, useVideoUrl } from '../videos'

const MAX_SEC = 180
const MAX_BYTES = 300 * 1024 * 1024
// ~2,5 Мбит/с: 3 минуты ≈ 56 МБ — грузится на сервер даже по мобильной сети
const BITRATE = 2_500_000

const MIME = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

const canRecord = () => typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'

// длительность файла из галереи / системной камеры
const fileDuration = (blob: Blob) =>
  new Promise<number>((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(blob)
    const done = (d: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(d) ? d : 0)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => done(v.duration)
    v.onerror = () => done(0)
    v.src = url
  })

// «0.5», «1×», «1.6×»; на неактивных кнопках — коротко, как в системной камере
const zoomLabel = (l: number, short = false) => {
  const v = Math.round(l * 10) / 10
  const txt = String(v).replace('.', ',').replace(/,0$/, '')
  return short ? txt : `${txt}×`
}

interface Taken {
  blob: Blob
  duration: number
  url: string
}

function Recorder({ onSave, onClose }: { onSave: (r: VideoRef) => void; onClose: () => void }) {
  const t = useT()
  const overlayRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const startedAt = useRef(0)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [ready, setReady] = useState(false)
  const [noCamera, setNoCamera] = useState(!canRecord())
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [taken, setTaken] = useState<Taken | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // зум: 'ultra' — включена отдельная сверхширокая камера; zoom — плавный зум текущей камеры
  const alive = useRef(true)
  const cams = useRef<Cameras | null>(null)
  const lensRef = useRef<'main' | 'ultra'>('main')
  // камера, выбранная перебором (Android); undefined — по умолчанию
  const deviceRef = useRef<string | undefined>(undefined)
  const levelRef = useRef(1)
  const [lens, setLens] = useState<'main' | 'ultra'>('main')
  const [zoom, setZoomInfo] = useState<{ range: ZoomRange; base: number } | null>(null)
  const [level, setLevelState] = useState(1)
  const [hasUltra, setHasUltra] = useState(false)
  const [canCycle, setCanCycle] = useState(false)
  const setLevel = (l: number) => {
    levelRef.current = l
    setLevelState(l)
  }

  const stopCamera = () => {
    stopStream(streamRef.current)
    streamRef.current = null
    setReady(false)
  }

  const startCamera = async (want: 'main' | 'ultra' = lensRef.current, wantLevel = levelRef.current) => {
    if (!canRecord()) return
    stopCamera()
    try {
      let s: MediaStream
      if (want === 'ultra' && cams.current?.ultra) s = await openCamera(cams.current.ultra)
      else {
        want = 'main'
        s = await openCamera(deviceRef.current ?? cams.current?.multi)
        // первое открытие: после разрешения видны названия камер — ищем составную с плавным зумом от 0.5×
        if (!cams.current) {
          cams.current = classifyCameras(await navigator.mediaDevices.enumerateDevices())
          setHasUltra(Boolean(cams.current.ultra))
          // перебор нужен, только если сверхширокую не нашли по названию
          setCanCycle(!cams.current.ultra && !cams.current.multi && cams.current.backs.length > 1)
          if (cams.current.multi) {
            stopStream(s)
            const multi = await openCamera(cams.current.multi).catch(() => null)
            if (multi && zoomRange(multi)) s = multi
            else {
              stopStream(multi)
              cams.current.multi = undefined
              s = await openCamera()
            }
          }
        }
      }
      if (!alive.current) return stopStream(s)
      streamRef.current = s
      if (liveRef.current) liveRef.current.srcObject = s
      const range = want === 'main' ? zoomRange(s) : null
      const base = zoomBase(trackLabel(s))
      lensRef.current = want
      setLens(want)
      setZoomInfo(range && { range, base })
      if (want === 'ultra') setLevel(0.5)
      else if (range) {
        const z = Math.min(range.max, Math.max(range.min, wantLevel * base))
        await setZoom(s, z)?.catch(() => {})
        setLevel((currentZoom(s) ?? z) / base)
      } else setLevel(1)
      setReady(true)
    } catch {
      if (!alive.current) return
      // сверхширокая не открылась — возвращаемся к основной
      if (want === 'ultra') return startCamera('main', 1)
      setNoCamera(true)
    }
  }

  const levels = zoomLevels(lens === 'main' ? (zoom?.range ?? null) : null, zoom?.base ?? 1, hasUltra)
  // на ultra-камере плавного зума нет: из неё — только обратно на 1×
  const shownLevels = lens === 'ultra' ? [0.5, 1] : levels

  const chooseLevel = (l: number) => {
    const s = streamRef.current
    if (!s) return
    if (lens === 'main' && zoom && l * zoom.base >= zoom.range.min - 0.01 && l * zoom.base <= zoom.range.max + 0.01) {
      setZoom(s, l * zoom.base)?.catch(() => {})
      setLevel(l)
    } else if (recording) return
    else if (l === 0.5 && hasUltra) startCamera('ultra')
    else if (lens === 'ultra') startCamera('main', l)
  }
  // кнопку нельзя нажать во время записи, если для неё нужно переключить камеру
  const needsSwitch = (l: number) =>
    !(lens === 'main' && zoom && l * zoom.base >= zoom.range.min - 0.01 && l * zoom.base <= zoom.range.max + 0.01)

  // следующая задняя камера (до начала записи)
  const cycleCamera = () => {
    const backs = cams.current?.backs ?? []
    const cur = deviceRef.current ?? backs.find((id) => id === streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId) ?? backs[0]
    deviceRef.current = backs[(backs.indexOf(cur) + 1) % backs.length]
    void startCamera('main', 1)
  }

  // зум двумя пальцами
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const frame = useRef(0)
  const touchDist = (e: React.TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lens === 'main' && zoom) pinch.current = { dist: touchDist(e), zoom: levelRef.current * zoom.base }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinch.current
    const s = streamRef.current
    if (!p || !zoom || !s || e.touches.length !== 2) return
    const z = Math.min(zoom.range.max, Math.max(zoom.range.min, (p.zoom * touchDist(e)) / p.dist))
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      setZoom(s, z)?.catch(() => {})
      setLevel(z / zoom.base)
    })
  }
  const onTouchEnd = () => {
    pinch.current = null
  }

  const openOnMount = useEffectEvent(() => void startCamera())
  const reopen = useEffectEvent(() => void startCamera())

  useEffect(() => {
    alive.current = true
    openOnMount()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // на весь экран без панелей браузера (Android, планшеты); iPhone этого не умеет — остаётся окно во весь вид
    const el = overlayRef.current
    const full = Boolean(el?.requestFullscreen && !document.fullscreenElement)
    if (full) el!.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    return () => {
      alive.current = false
      if (recRef.current?.state === 'recording') recRef.current.stop()
      stopStream(streamRef.current)
      document.body.style.overflow = prev
      if (full && document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  // повернули телефон до начала записи — переоткрываем камеру в новой ориентации
  const idle = ready && !recording && !taken
  useEffect(() => {
    if (!idle) return
    const mq = window.matchMedia('(orientation: portrait)')
    const onTurn = () => reopen()
    mq.addEventListener('change', onTurn)
    return () => mq.removeEventListener('change', onTurn)
  }, [idle])

  // таймер записи и автостоп
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000
      setElapsed(s)
      if (s >= MAX_SEC) recRef.current?.stop()
    }, 250)
    return () => clearInterval(id)
  }, [recording])

  useEffect(() => {
    if (!taken) return
    return () => URL.revokeObjectURL(taken.url)
  }, [taken])

  const start = () => {
    const stream = streamRef.current
    if (!stream) return
    const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: BITRATE })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    rec.onstop = () => {
      setRecording(false)
      const duration = (Date.now() - startedAt.current) / 1000
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/mp4' })
      stopCamera()
      setTaken({ blob, duration, url: URL.createObjectURL(blob) })
    }
    recRef.current = rec
    startedAt.current = Date.now()
    setElapsed(0)
    setError(null)
    rec.start(1000)
    setRecording(true)
  }

  const fromFile = async (file: File | undefined) => {
    if (camRef.current) camRef.current.value = ''
    if (galRef.current) galRef.current.value = ''
    if (!file) return
    stopCamera()
    setTaken({ blob: file, duration: await fileDuration(file), url: URL.createObjectURL(file) })
  }

  const redo = () => {
    setTaken(null)
    setError(null)
    if (canRecord() && !noCamera) void startCamera()
  }

  const save = async () => {
    if (!taken) return
    if (taken.blob.size > MAX_BYTES) return setError(t('video.tooBig'))
    setSaving(true)
    try {
      onSave(await addVideo(taken.blob, taken.duration))
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const fileInputs = (
    <>
      <input ref={camRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="video/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
    </>
  )

  return (
    <div ref={overlayRef} className="rec-overlay" role="dialog" aria-label={t('video.title')}>
      {taken ? (
        <video className="rec-video" src={taken.url} controls playsInline autoPlay />
      ) : noCamera ? (
        <div className="rec-nocam">
          <p>{t('video.noCamera')}</p>
          <button className="btn primary" onClick={() => camRef.current?.click()}>{t('video.systemCamera')}</button>
          <button className="btn" onClick={() => galRef.current?.click()}>{t('video.gallery')}</button>
        </div>
      ) : (
        <video
          ref={liveRef}
          className="rec-video rec-live"
          muted
          playsInline
          autoPlay
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />
      )}

      {!taken && ready && (shownLevels.length > 1 || canCycle) && (
        <div className="rec-zoom" role="group" aria-label={t('video.zoom')}>
          {shownLevels.map((l) => {
            // активная кнопка — ближайшая снизу к текущему зуму; на ней показываем точное значение
            const active = l === [...shownLevels].reverse().find((x) => level >= x - 0.05)
            return (
              <button
                key={l}
                className={active ? 'active' : undefined}
                disabled={recording && needsSwitch(l)}
                onClick={() => chooseLevel(l)}
              >
                {active ? zoomLabel(level) : zoomLabel(l, true)}
              </button>
            )
          })}
          {canCycle && (
            <button onClick={cycleCamera} disabled={recording} title={t('video.switchCam')} aria-label={t('video.switchCam')}>
              ⟳
            </button>
          )}
        </div>
      )}

      <div className="rec-top">
        {recording ? (
          <span className="rec-badge">● {formatDuration(elapsed)} / {formatDuration(MAX_SEC)}</span>
        ) : !taken && !noCamera ? (
          <span className="rec-tip">
            {t('video.walk')}
            <small>{t('video.limit', { min: MAX_SEC / 60 })}</small>
          </span>
        ) : null}
      </div>

      <div className="rec-bar">
        {error && <p className="rec-error">{error}</p>}
        {taken ? (
          <>
            <button className="btn" onClick={redo} disabled={saving}>{t('video.redo')}</button>
            <button className="btn primary" onClick={save} disabled={saving}>{saving ? t('video.saving') : t('video.save')}</button>
          </>
        ) : recording ? (
          <button className="rec-btn stop" onClick={() => recRef.current?.stop()} aria-label={t('video.stop')} />
        ) : (
          <>
            <button className="btn ghost rec-light" onClick={onClose}>{t('app.cancel')}</button>
            {!noCamera && <button className="rec-btn" onClick={start} disabled={!ready} aria-label={t('video.start')} />}
            {!noCamera && <button className="btn ghost rec-light" onClick={() => galRef.current?.click()}>{t('video.gallery')}</button>}
            {noCamera && <span />}
          </>
        )}
      </div>
      {fileInputs}
    </div>
  )
}

export function WalkaroundPanel({ order, onChange }: { order: Order; onChange: (v: VideoRef | undefined) => void }) {
  const { t, locale } = useSettings()
  const [rec, setRec] = useState(false)
  const v = order.walkaround
  const { url, loading } = useVideoUrl(v?.id)
  const signed = Boolean(order.signatures.acceptClient || order.signatures.acceptMaster)

  const record = () => {
    if (v && signed && !confirm(t('video.replaceSigned'))) return
    setRec(true)
  }

  const remove = () => {
    if (!v || !confirm(signed ? t('video.replaceSigned') : t('video.removeConfirm'))) return
    deleteVideos([v.id])
    onChange(undefined)
  }

  return (
    <section className="panel no-print">
      <h2>{t('video.title')}</h2>
      {v ? (
        <>
          {url ? (
            <video className="walk-video" src={url} controls playsInline preload="metadata" />
          ) : (
            <p className="muted">{loading ? t('video.loading') : t('video.missing')}</p>
          )}
          <div className="walk-meta">
            <small className="muted">
              {t('video.recorded', { date: new Date(v.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }), dur: formatDuration(v.duration) })}
            </small>
            <span className="row">
              <button className="btn small ghost" onClick={record}>{t('video.redo')}</button>
              <button className="btn small ghost danger" onClick={remove}>{t('video.remove')}</button>
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t('video.hint')}</p>
          <button className="btn primary wide-btn" onClick={record}>🎥 {t('video.record')}</button>
        </>
      )}
      {rec && (
        <Recorder
          onClose={() => setRec(false)}
          onSave={(ref) => {
            if (v) deleteVideos([v.id])
            onChange(ref)
            setRec(false)
          }}
        />
      )}
    </section>
  )
}
