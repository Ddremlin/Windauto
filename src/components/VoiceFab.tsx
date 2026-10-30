// Плавающая кнопка голосового ввода.
// Курсор в текстовом поле — диктовка в это поле. Курсора нет — ИИ разбирает сказанное
// и после подтверждения заполняет заказ: авто, клиента, повреждения и работы по элементам.
import { useEffect, useRef, useState } from 'react'
import { getLayout } from '../body'
import { useSettings } from '../settingsHooks'
import { currencySymbol } from '../settingsStore'
import { canRecognize, parseVoice } from '../sync'
import type { Order } from '../types'
import { SPEECH_LANG, VOICE_FIELD_LABEL, applyVoice, dictationTarget, insertText, listen, speechSupported, type Listening, type VoiceChange } from '../voice'
import { DAMAGES, WORKS } from '../works'

type Lang = keyof typeof SPEECH_LANG
const LANG_KEY = 'windauto.voiceLang'

const isSpeechLang = (v: unknown): v is Lang => typeof v === 'string' && v in SPEECH_LANG

function savedLang(ui: string): Lang {
  const fallback = isSpeechLang(ui) ? ui : 'ru'
  try {
    const v = localStorage.getItem(LANG_KEY)
    return isSpeechLang(v) ? v : fallback
  } catch {
    return fallback
  }
}

type Phase =
  | { step: 'listen'; mode: 'dictate' | 'ai' }
  | { step: 'parse' }
  | { step: 'review'; patch: Partial<Order>; changes: VoiceChange[]; confident: boolean }

export default function VoiceFab({ order, onApply }: { order: Order; onApply: (patch: Partial<Order>) => void }) {
  const { t, settings } = useSettings()
  const [lang, setLangState] = useState<Lang>(() => savedLang(settings.lang))
  const [phase, setPhase] = useState<Phase | null>(null)
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  // микрофон включён (для отрисовки; сам сеанс — в listening)
  const [hearing, setHearing] = useState(false)
  const listening = useRef<Listening | null>(null)
  const target = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const layout = getLayout(order.bodyType)

  useEffect(() => () => listening.current?.cancel(), [])

  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* без сохранения — только на этот раз */
    }
  }

  const speechError = (e: string) =>
    e === 'not-allowed' || e === 'service-not-allowed' ? t('voice.denied') : e === 'unsupported' ? t('voice.unsupported') : t('voice.error', { e })

  const begin = (mode: 'dictate' | 'ai', l: Lang = lang) => {
    if (!speechSupported()) return setError(t('voice.unsupported'))
    setError(null)
    setText('')
    setInterim('')
    setPhase({ step: 'listen', mode })
    setHearing(true)
    listening.current = listen(
      SPEECH_LANG[l],
      (f, i) => {
        setText(f)
        setInterim(i)
      },
      (final, err) => {
        listening.current = null
        setHearing(false)
        setInterim('')
        if (err) {
          setError(speechError(err))
          if (mode === 'dictate') setPhase(null)
          return
        }
        if (mode === 'dictate') {
          if (final && target.current) insertText(target.current, final)
          setPhase(null)
          return
        }
        if (!final) return setError(t('voice.empty'))
        void analyse(final)
      },
    )
  }

  const analyse = async (said: string) => {
    if (!canRecognize()) return setError(t('voice.needServer'))
    setPhase({ step: 'parse' })
    try {
      const r = await parseVoice(said, {
        elements: layout.elements.map((e) => ({ id: e.id, name: t(`el.${e.key}`) })),
        works: WORKS.map((w) => ({ id: w.id, name: t(`work.${w.id}`) })),
        damages: DAMAGES.map((d) => ({ id: d, name: t(`damage.${d}`) })),
      })
      const { patch, changes } = applyVoice(order, r, new Set(layout.elements.map((e) => e.id)), settings.defaultPrices)
      if (!changes.length) {
        setError(t('voice.nothing'))
        return setPhase({ step: 'listen', mode: 'ai' })
      }
      setPhase({ step: 'review', patch, changes, confident: r.confident })
    } catch (e) {
      setError((e as Error).message)
      setPhase({ step: 'listen', mode: 'ai' })
    }
  }

  const close = () => {
    listening.current?.cancel()
    listening.current = null
    setHearing(false)
    setPhase(null)
    setError(null)
  }

  const onFab = () => {
    if (phase?.step === 'listen' && listening.current) return listening.current.stop()
    if (phase) return
    // поле под курсором — диктуем в него
    const el = dictationTarget(document.activeElement)
    target.current = el
    begin(el ? 'dictate' : 'ai')
  }

  const toNotes = () => {
    if (!text) return
    onApply({ notes: order.notes.trim() ? `${order.notes.trimEnd()}\n${text}` : text })
    close()
  }

  const elKey = (id: string) => layout.elements.find((e) => e.id === id)?.key ?? id
  const changeRow = (c: VoiceChange, i: number) =>
    c.kind === 'field' ? (
      <li key={i}>
        <b>{t(VOICE_FIELD_LABEL[c.key])}</b>
        <span>
          {c.from && c.key !== 'notes' && c.key !== 'paintNotes' && <s className="muted">{c.from}</s>} {c.to}
          {(c.key === 'notes' || c.key === 'paintNotes') && c.from && <small className="muted"> ({t('voice.append')})</small>}
        </span>
      </li>
    ) : (
      <li key={i}>
        <b>{t(`el.${elKey(c.id)}`)}</b>
        <span>
          {[
            ...c.works.map((w) => t(`work.${w}`)),
            ...c.damage.map((d) => t(`damage.${d}`)),
            c.price ? `${c.price} ${currencySymbol()}` : '',
            c.note ?? '',
          ]
            .filter(Boolean)
            .join(', ')}
        </span>
      </li>
    )

  const listeningNow = phase?.step === 'listen' && hearing
  const dictating = phase?.step === 'listen' && phase.mode === 'dictate'

  return (
    <>
      {/* диктовка: живой текст над кнопкой */}
      {dictating && (text || interim) && (
        <div className="voice-bubble no-print" aria-live="polite">
          {text} <span className="muted">{interim}</span>
        </div>
      )}
      {error && !phase && <div className="voice-bubble error no-print" onClick={() => setError(null)}>{error}</div>}

      {phase && !dictating && (
        <div className="sheet-backdrop no-print" onClick={phase.step === 'parse' ? undefined : close}>
          <div className="sheet voice-sheet" role="dialog" aria-label={t('voice.button')} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            {phase.step === 'review' ? (
              <>
                <h2>{t('voice.review')}</h2>
                {!phase.confident && <p className="warn-text">{t('voice.check')}</p>}
                <ul className="voice-changes">{phase.changes.map(changeRow)}</ul>
                <div className="sheet-actions">
                  <button className="btn ghost" onClick={() => begin('ai')}>{t('video.redo')}</button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      onApply(phase.patch)
                      close()
                    }}
                  >
                    {t('voice.apply')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="voice-head">
                  <h2>{phase.step === 'parse' ? t('voice.parsing') : listeningNow ? t('voice.listening') : t('voice.button')}</h2>
                  <div className="seg-row voice-lang">
                    {(Object.keys(SPEECH_LANG) as Lang[]).map((l) => (
                      <button
                        key={l}
                        className={'seg' + (lang === l ? ' active' : '')}
                        disabled={phase.step === 'parse'}
                        onClick={() => {
                          setLang(l)
                          // меняем язык на ходу — начинаем слушать заново
                          if (listening.current) {
                            listening.current.cancel()
                            begin('ai', l)
                          }
                        }}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                {!text && !interim && <p className="muted">{t('voice.aiHint')}</p>}
                {(text || interim) && (
                  <p className="voice-text">
                    {text} <span className="muted">{interim}</span>
                  </p>
                )}
                {error && <p className="error-text">{error}</p>}
                <div className="sheet-actions">
                  <button className="btn ghost" onClick={close} disabled={phase.step === 'parse'}>{t('app.cancel')}</button>
                  {listeningNow ? (
                    <button className="btn primary" onClick={() => listening.current?.stop()}>{t('voice.done')}</button>
                  ) : phase.step === 'parse' ? (
                    <button className="btn primary" disabled>{t('voice.parsing')}</button>
                  ) : (
                    <>
                      {/* разбор не удался (нет сервера, сети) — сказанное не теряем */}
                      {text && <button className="btn" onClick={toNotes}>{t('voice.toNotes')}</button>}
                      <button className="btn primary" onClick={() => begin('ai')}>{t('voice.again')}</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <button
        className={'fab voice-fab no-print' + (listeningNow ? ' on' : '')}
        // не забираем фокус у поля, в которое будем диктовать
        onPointerDown={(e) => e.preventDefault()}
        onClick={onFab}
        aria-label={listeningNow ? t('voice.done') : t('voice.button')}
        title={t('voice.button')}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
    </>
  )
}
