import { useEffect, useState } from 'react'
import { makeT, type Lang } from '../i18n'
import LangSelect from './LangSelect'
import { useSettings } from '../settingsHooks'
import { isNative, openExternal, printNative } from '../native'
import { getLayout, partName } from '../body'
import { ESTIMATE_CSS, ESTIMATE_FORMATS, buildEstimate, estimateBody, estimateCsv, estimateFileName, estimateHtml, estimateText, type EstimateFormat } from '../estimate'
import { getPhoto } from '../photos'
import { formatDuration, getVideo } from '../videos'
import { Thumb } from './Photos'
import { isPro } from '../sync'
import { normalizePlate } from '../validate'
import { downloadBlob, mailtoUrl, makeEstimatePdf, makePdf, orderText, pdfFileName, readyText, shareFiles, sharePdf, shareText, smsUrl, whatsappUrl } from '../share'
import type { Order } from '../types'
import type { DocKind } from './AcceptanceDoc'

interface Props {
  order: Order
  onClose: () => void
}

export default function ShareSheet({ order, onClose }: Props) {
  const { t, settings } = useSettings()
  const [lang, setLang] = useState<Lang>(settings.docLang)
  // после ремонта по умолчанию — акт выдачи
  const [kind, setKind] = useState<DocKind>(order.status === 'done' || order.status === 'issued' ? 'handover' : 'acceptance')
  const [pdf, setPdf] = useState<{ blob: Blob; lang: Lang; kind: DocKind; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // PDF устарел, если заказ изменили после его создания
  const ready = pdf && pdf.lang === lang && pdf.kind === kind && pdf.at >= order.updatedAt ? pdf.blob : null
  const name = pdfFileName(order, kind)
  const docTitle = makeT(lang)(kind === 'handover' ? 'doc.handoverTitle' : 'doc.title')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // PDF готовится несколько секунд — после этого браузер уже не считает
  // нажатие «свежим» для share(), поэтому отправка — отдельным нажатием
  const generate = async () => {
    setBusy(true)
    try {
      setPdf({ blob: await makePdf(order, lang, kind), lang, kind, at: order.updatedAt })
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  // смета списком в выбранном формате
  const [fmt, setFmt] = useState<EstimateFormat>('pdf')
  const [estBusy, setEstBusy] = useState(false)
  const estimateFile = async (): Promise<{ blob: Blob; name: string }> => {
    const e = buildEstimate(order, lang, settings)
    const logo = isPro() ? settings.shopLogo : undefined
    const name = estimateFileName(order, fmt)
    if (fmt === 'pdf') return { blob: await makeEstimatePdf(estimateBody(e, lang, logo), ESTIMATE_CSS), name }
    if (fmt === 'csv') return { blob: new Blob([estimateCsv(e, lang)], { type: 'text/csv;charset=utf-8' }), name }
    if (fmt === 'html') return { blob: new Blob([estimateHtml(e, lang, logo)], { type: 'text/html;charset=utf-8' }), name }
    return { blob: new Blob([estimateText(e, lang)], { type: 'text/plain;charset=utf-8' }), name }
  }
  const estimate = async (action: 'share' | 'save') => {
    setEstBusy(true)
    try {
      // текст удобнее отправить сообщением, а не файлом
      if (action === 'share' && fmt === 'txt') {
        const txt = estimateText(buildEstimate(order, lang, settings), lang)
        if (!(await shareText(txt, docTitle))) await downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), estimateFileName(order, 'txt'))
        return
      }
      const f = await estimateFile()
      if (action === 'share') await shareFiles([f], makeT(lang)('est.title'))
      else {
        const path = await downloadBlob(f.blob, f.name)
        if (path) alert(t('share.saved', { path }))
      }
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setEstBusy(false)
    }
  }

  // все фото заказа одним разом: «номер_деталь_n.jpg»
  const photoList = getLayout(order.bodyType).parts.flatMap((e) => {
    const v = order.elements[e.id]
    const slug = partName(makeT(lang), e).replace(/[\s—/]+/g, '_').replace(/_+/g, '_')
    return [...(v?.photos ?? []), ...(v?.photosAfter ?? [])].map((id, i) => ({ id, name: `${normalizePlate(order.plate) || 'auto'}_${slug}_${i + 1}.jpg` }))
  })
  const [photosBusy, setPhotosBusy] = useState(false)
  const sharePhotos = async () => {
    setPhotosBusy(true)
    try {
      const files: { blob: Blob; name: string }[] = []
      for (const p of photoList) {
        const blob = await getPhoto(p.id)
        if (blob) files.push({ blob, name: p.name })
      }
      if (files.length) await shareFiles(files, t('media.allPhotos', { n: files.length }))
      else alert(t('media.missing'))
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setPhotosBusy(false)
    }
  }

  // вложения к сообщению: выбранные фото, видео, готовый PDF
  const [picked, setPicked] = useState<string[]>([])
  const [withPdf, setWithPdf] = useState(false)
  const [sending, setSending] = useState(false)
  const plate = normalizePlate(order.plate) || 'auto'
  const videos = [
    order.walkaround && { ref: order.walkaround, label: t('video.title'), name: `video_${plate}` },
    order.walkaroundAfter && { ref: order.walkaroundAfter, label: t('video.titleAfter'), name: `video_po_${plate}` },
  ].filter((v) => Boolean(v)) as { ref: NonNullable<Order['walkaround']>; label: string; name: string }[]
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const attached = picked.length + (withPdf && ready ? 1 : 0)

  const sendWithFiles = async () => {
    setSending(true)
    try {
      const files: { blob: Blob; name: string }[] = []
      if (withPdf && ready) files.push({ blob: ready, name })
      for (const p of photoList) {
        if (!picked.includes(p.id)) continue
        const blob = await getPhoto(p.id)
        if (blob) files.push({ blob, name: p.name })
      }
      for (const v of videos) {
        if (!picked.includes(v.ref.id)) continue
        // видео может быть только на сервере — скачается сейчас
        const blob = await getVideo(v.ref.id)
        if (blob) files.push({ blob, name: v.name + v.ref.id.slice(v.ref.id.lastIndexOf('.')) })
      }
      if (!files.length) return alert(t('media.missing'))
      const how = await shareFiles(files, docTitle, text())
      // меню «Поделиться» нет (компьютер) — файлы скачались, текст кладём в буфер
      if (how === 'downloaded') await copy()
    } catch (e) {
      alert(t('share.error', { e: (e as Error).message }))
    } finally {
      setSending(false)
    }
  }

  const text = () => (kind === 'handover' ? readyText(order, lang, settings) : orderText(order, lang, settings))

  const whatsapp = () => {
    // ссылка wa.me не умеет файлы — с вложениями через меню «Поделиться»
    if (attached) return sendWithFiles()
    if (!order.phone) alert(t('share.noPhone'))
    openExternal(whatsappUrl(order.phone, text()))
  }

  const sms = () => {
    if (attached) return sendWithFiles()
    window.location.assign(smsUrl(order.phone, text()))
  }

  const email = () => {
    if (attached) return sendWithFiles()
    const car = [order.make, order.model, order.plate].filter(Boolean).join(' ')
    window.location.assign(mailtoUrl(order.email, `${docTitle}${car ? ' — ' + car : ''}`, text()))
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      alert(t('share.copied'))
    } catch {
      prompt(t('share.copyManual'), text())
    }
  }

  const message = async () => {
    if (attached) return sendWithFiles()
    if (!(await shareText(text(), docTitle))) copy()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('app.share')}>
        <div className="sheet-handle" />
        <h2>{t('share.title')}</h2>

        <div className="seg-row two">
          {(['acceptance', 'handover'] as DocKind[]).map((k) => (
            <button key={k} className={'seg' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
              {t(k === 'handover' ? 'share.handover' : 'share.acceptance')}
            </button>
          ))}
        </div>

        <LangSelect value={lang} onChange={setLang} label={t('set.docLang')} />

        <div className="share-list">
          {ready ? (
            <button className="share-item primary" onClick={() => sharePdf(ready, name, docTitle)}>
              <span className="share-icon">📤</span>
              <span>
                <b>{t('share.pdf')}</b>
                <small>{name}</small>
              </span>
            </button>
          ) : (
            <button className="share-item" onClick={generate} disabled={busy}>
              <span className="share-icon">{busy ? '⏳' : '📄'}</span>
              <span>
                <b>{busy ? t('share.making') : t('share.pdf')}</b>
                <small>{t('share.pdfHint')}</small>
              </span>
            </button>
          )}
          {ready && (
            <button className="share-item" onClick={async () => {
              const path = await downloadBlob(ready, name)
              if (path) alert(t('share.saved', { path }))
            }}>
              <span className="share-icon">⬇️</span>
              <span>
                <b>{t('share.download')}</b>
              </span>
            </button>
          )}
          {(photoList.length > 0 || videos.length > 0 || ready) && (
            <div className="attach">
              <div className="attach-head">
                <b>{t('attach.title')}{attached ? ` · ${attached}` : ''}</b>
                {photoList.length > 0 && (
                  <button
                    className="link-btn"
                    onClick={() => {
                      const all = photoList.every((p) => picked.includes(p.id))
                      setPicked((cur) => (all ? cur.filter((id) => !photoList.some((p) => p.id === id)) : [...new Set([...cur, ...photoList.map((p) => p.id)])]))
                    }}
                  >
                    {photoList.every((p) => picked.includes(p.id)) ? t('attach.none') : t('attach.allPhotos')}
                  </button>
                )}
              </div>
              {photoList.length > 0 && (
                <div className="thumbs attach-thumbs">
                  {photoList.map((p) => (
                    <span key={p.id} className={'attach-thumb' + (picked.includes(p.id) ? ' on' : '')}>
                      <Thumb id={p.id} onClick={() => togglePick(p.id)} />
                    </span>
                  ))}
                </div>
              )}
              {(videos.length > 0 || ready) && <div className="check-grid">
                {videos.map((v) => (
                  <label key={v.ref.id} className={'check-chip' + (picked.includes(v.ref.id) ? ' on' : '')}>
                    <input type="checkbox" checked={picked.includes(v.ref.id)} onChange={() => togglePick(v.ref.id)} />
                    🎥 {v.label}{v.ref.duration ? ` · ${formatDuration(v.ref.duration)}` : ''}
                  </label>
                ))}
                {ready && (
                  <label className={'check-chip' + (withPdf ? ' on' : '')}>
                    <input type="checkbox" checked={withPdf} onChange={(e) => setWithPdf(e.target.checked)} />
                    📄 PDF
                  </label>
                )}
              </div>}
              <p className="hint">{t(attached ? 'attach.hintOn' : 'attach.hint')}</p>
            </div>
          )}
          {attached > 0 && (
            <button className="share-item primary" onClick={sendWithFiles} disabled={sending}>
              <span className="share-icon">{sending ? '⏳' : '📎'}</span>
              <span>
                <b>{sending ? t('attach.preparing') : t('attach.send', { n: attached })}</b>
                <small>{t('attach.sendHint')}</small>
              </span>
            </button>
          )}
          <button className="share-item" onClick={whatsapp}>
            <span className="share-icon">💬</span>
            <span>
              <b>{t('share.whatsapp')}</b>
              <small>{order.phone || t('share.whatsappHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={sms}>
            <span className="share-icon">✉️</span>
            <span>
              <b>{t('share.sms')}</b>
              <small>{order.phone || t('share.smsHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={email}>
            <span className="share-icon">📧</span>
            <span>
              <b>{t('share.email')}</b>
              <small>{order.email || t('share.emailHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={message}>
            <span className="share-icon">📨</span>
            <span>
              <b>{t('share.text')}</b>
              <small>{t('share.textHint')}</small>
            </span>
          </button>
          <button className="share-item" onClick={copy}>
            <span className="share-icon">📋</span>
            <span>
              <b>{t('share.copy')}</b>
            </span>
          </button>
          {photoList.length > 0 && (
            <button className="share-item" onClick={sharePhotos} disabled={photosBusy}>
              <span className="share-icon">{photosBusy ? '⏳' : '📷'}</span>
              <span>
                <b>{t('media.allPhotos', { n: photoList.length })}</b>
                <small>{t('media.allPhotosHint')}</small>
              </span>
            </button>
          )}
          <button
            className="share-item"
            onClick={() => {
              onClose()
              setTimeout(() => (isNative ? printNative(docTitle) : window.print()), 100)
            }}
          >
            <span className="share-icon">🖨</span>
            <span>
              <b>{t('share.print')}</b>
            </span>
          </button>
        </div>

        <div className="sheet-section estimate-export">
          <h3>{t('est.export')}</h3>
          <div className="seg-row four" role="radiogroup" aria-label={t('est.format')}>
            {ESTIMATE_FORMATS.map((f) => (
              <button key={f} role="radio" aria-checked={fmt === f} className={'seg' + (fmt === f ? ' active' : '')} onClick={() => setFmt(f)}>
                {t(`est.fmt.${f}`)}
              </button>
            ))}
          </div>
          <p className="hint">{t(`est.hint.${fmt}`)}</p>
          <div className="row">
            <button className="btn primary" onClick={() => estimate('share')} disabled={estBusy}>
              {estBusy ? '⏳' : '📤'} {t('media.share')}
            </button>
            <button className="btn" onClick={() => estimate('save')} disabled={estBusy}>
              ⬇️ {t('media.download')}
            </button>
          </div>
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
