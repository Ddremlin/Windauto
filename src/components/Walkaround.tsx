// Круговое видео при приёмке: запись камерой в приложении (MediaRecorder),
// а если она недоступна — системной камерой или из галереи.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  DIGITAL_MAX,
  classifyCameras,
  currentZoom,
  digitalZoomStream,
  openCamera,
  setZoom,
  stopStream,
  trackLabel,
  zoomBase,
  zoomRange,
  type Cameras,
  type ZoomRange,
} from '../camera'
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

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
  // зум: lens 'ultra' — включена отдельная сверхширокая камера;
  // zoom — зум текущей камеры: свой у камеры (native) или цифровой (кадр обрезается при записи)
  const alive = useRef(true)
  const cams = useRef<Cameras | null>(null)
  const lensRef = useRef<'main' | 'ultra'>('main')
  // камера, выбранная перебором (Android); undefined — по умолчанию
  const deviceRef = useRef<string | undefined>(undefined)
  const levelRef = useRef(1)
  // предел зума основной камеры — чтобы с ultra можно было сразу уйти на 2×, 3×
  const digitalRef = useRef<{ stop: () => void } | null>(null)
  const [lens, setLens] = useState<'main' | 'ultra'>('main')
  const [zoom, setZoomInfo] = useState<{ range: ZoomRange; base: number; digital: boolean } | null>(null)
  const [level, setLevelState] = useState(1)
  const [hasUltra, setHasUltra] = useState(false)
  const [canCycle, setCanCycle] = useState(false)
  // предел зума основной камеры — чтобы с ultra ползунком сразу уйти на 2×, 3×
  const [ultraMax, setUltraMax] = useState(DIGITAL_MAX)
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
      lensRef.current = want
      setLens(want)
      if (want === 'ultra') {
        setZoomInfo(null)
        setLevel(0.5)
      } else {
        const native = zoomRange(s)
        const base = native ? zoomBase(trackLabel(s)) : 1
        const range = native ?? { min: 1, max: DIGITAL_MAX }
        setUltraMax(range.max / base)
        setZoomInfo({ range, base, digital: !native })
        const z = clamp(wantLevel * base, range.min, range.max)
        if (native) await setZoom(s, z)?.catch(() => {})
        setLevel((native ? (currentZoom(s) ?? z) : z) / base)
      }
      setReady(true)
    } catch {
      if (!alive.current) return
      // сверхширокая не открылась — возвращаемся к основной
      if (want === 'ultra') return startCamera('main', 1)
      setNoCamera(true)
    }
  }

  // что умеет текущая камера, без переключения
  const curMin = zoom ? zoom.range.min / zoom.base : lens === 'ultra' ? 0.5 : 1
  const curMax = zoom ? zoom.range.max / zoom.base : lens === 'ultra' ? 0.5 : 1
  // ползунок: от 0.5 (если есть сверхширокая) до предела основной камеры
  const sliderMin = Math.min(curMin, hasUltra ? 0.5 : curMin)
  const sliderMax = lens === 'ultra' ? ultraMax : curMax

  const frame = useRef(0)
  // зум в пределах текущей камеры — сразу (и во время записи)
  const applyLevel = (l: number) => {
    const s = streamRef.current
    if (!s || !zoom) return setLevel(l)
    const v = clamp(l, curMin, curMax)
    setLevel(v)
    if (!zoom.digital) {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => void setZoom(s, v * zoom.base)?.catch(() => {}))
    }
  }
  // отпустили ползунок: если значение вне текущей камеры — переключаем (только до записи)
  const commitLevel = () => {
    const l = levelRef.current
    if (recording) return applyLevel(clamp(l, curMin, curMax))
    if (lens === 'main' && l < curMin - 0.01) {
      if (hasUltra) void startCamera('ultra')
      else applyLevel(curMin)
    } else if (lens === 'ultra' && l >= 0.75) void startCamera('main', Math.max(1, l))
    else if (lens === 'ultra') setLevel(0.5)
  }
  const onSlider = (l: number) => {
    // в пределах текущей камеры — применяем на лету; иначе только показываем до отпускания
    if (l >= curMin - 0.01 && l <= curMax + 0.01) applyLevel(l)
    else if (!recording) setLevel(l)
  }

  // следующая задняя камера (до начала записи)
  const cycleCamera = () => {
    const backs = cams.current?.backs ?? []
    const cur = deviceRef.current ?? backs.find((id) => id === streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId) ?? backs[0]
    deviceRef.current = backs[(backs.indexOf(cur) + 1) % backs.length]
    void startCamera('main', 1)
  }

  // зум двумя пальцами — в пределах текущей камеры
  const pinch = useRef<{ dist: number; level: number } | null>(null)
  const touchDist = (e: React.TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && zoom) pinch.current = { dist: touchDist(e), level: levelRef.current }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinch.current
    if (p && e.touches.length === 2) applyLevel((p.level * touchDist(e)) / p.dist)
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
      digitalRef.current?.stop()
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
    // цифровой зум: пишем холст с увеличенным центром кадра
    const digital = zoom?.digital && liveRef.current ? digitalZoomStream(liveRef.current, () => levelRef.current, stream.getAudioTracks()) : null
    digitalRef.current = digital
    const rec = new MediaRecorder(digital?.stream ?? stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: BITRATE })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    rec.onstop = () => {
      setRecording(false)
      const duration = (Date.now() - startedAt.current) / 1000
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'video/mp4' })
      digitalRef.current?.stop()
      digitalRef.current = null
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
          style={zoom?.digital && level > 1 ? { transform: `scale(${level})` } : undefined}
          muted
          playsInline
          autoPlay
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />
      )}

      {!taken && ready && (sliderMax > sliderMin || canCycle) && (
        <div className="rec-zoom" role="group" aria-label={t('video.zoom')}>
          <span className="rec-zoom-value">{zoomLabel(level)}</span>
          {sliderMax > sliderMin && (
            <div className="rec-zoom-track">
              <input
                type="range"
                className="rec-zoom-slider"
                aria-label={t('video.zoom')}
                min={Math.log2(sliderMin)}
                max={Math.log2(sliderMax)}
                step={0.01}
                value={Math.log2(clamp(level, sliderMin, sliderMax))}
                onChange={(e) => onSlider(2 ** Number(e.target.value))}
                onPointerUp={commitLevel}
                onTouchEnd={commitLevel}
                onKeyUp={commitLevel}
              />
              {/* отметки 0.5 · 1 · 2 · 3 — нажатием сразу на нужный зум */}
              {[0.5, 1, 2, 3].filter((m) => m >= sliderMin - 0.01 && m <= sliderMax + 0.01).map((m) => (
                <button
                  key={m}
                  className="rec-zoom-mark"
                  style={{ bottom: `${(100 * Math.log2(m / sliderMin)) / Math.log2(sliderMax / sliderMin)}%` }}
                  disabled={recording && (m < curMin - 0.01 || m > curMax + 0.01)}
                  onClick={() => {
                    onSlider(m)
                    levelRef.current = m
                    commitLevel()
                  }}
                >
                  {zoomLabel(m, true)}
                </button>
              ))}
            </div>
          )}
          {canCycle && (
            <button className="rec-zoom-cycle" onClick={cycleCamera} disabled={recording} title={t('video.switchCam')} aria-label={t('video.switchCam')}>
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
