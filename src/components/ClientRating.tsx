// Оценки: внутренняя оценка клиента мастером (в блоке «Клиент») и отзыв клиента о ремонте (ссылка с сервера).
import { useMemo, useState } from 'react'
import { clientKey, isRisky, profileOf } from '../clients'
import { LANGS, makeT, type Lang } from '../i18n'
import { openExternal } from '../native'
import { markSent, refreshReviews, useReviews } from '../reviews'
import { shareText, smsUrl, whatsappUrl } from '../share'
import { useSettings } from '../settingsHooks'
import { reviewLink, useSyncStatus } from '../sync'
import type { ClientRating, Order } from '../types'

export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const full = Math.round(value)
  return (
    <span className={`stars-view ${size}`} aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= full ? 'on' : ''}>★</span>
      ))}
    </span>
  )
}

export function StarPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="star-picker" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          className={n <= value ? 'on' : ''}
          // повторное нажатие на ту же звезду снимает оценку
          onClick={() => onChange(value === n ? 0 : n)}
        >
          ★
        </button>
      ))}
    </div>
  )
}

interface BlockProps {
  order: Order
  orders: Order[]
  by: string
  onChange: (r: ClientRating | undefined) => void
}

/** Внутренняя оценка клиента и то, что известно о нём по прошлым заказам */
export function ClientRatingBlock({ order, orders, by, onChange }: BlockProps) {
  const { t, locale } = useSettings()
  const key = clientKey(order)
  const past = useMemo(() => (key ? profileOf(orders.filter((o) => o.id !== order.id && clientKey(o) === key)) : null), [orders, order.id, key])
  const r = order.clientRating

  const set = (stars: number) => onChange(stars ? { stars, note: r?.note ?? '', at: Date.now(), by } : undefined)

  return (
    <div className="client-rating">
      {past && past.orders > 0 && (
        <div className={'client-past' + (isRisky(past) ? ' risky' : '')}>
          <span>
            {isRisky(past) ? '⚠ ' : '↺ '}
            {t('rate.past', { n: past.orders })}
            {past.rated > 0 && (
              <>
                {' · '}
                <Stars value={past.avg} size="sm" /> {String(past.avg).replace('.', ',')}
              </>
            )}
          </span>
          {past.last?.note && (
            <small>
              «{past.last.note}» — {[past.last.by, new Date(past.last.at).toLocaleDateString(locale)].filter(Boolean).join(', ')}
            </small>
          )}
        </div>
      )}
      <div className="client-rating-row">
        <span className="field-label">{t('rate.title')}</span>
        <StarPicker value={r?.stars ?? 0} onChange={set} label={t('rate.title')} />
      </div>
      {r && (
        <input
          type="text"
          placeholder={t('rate.notePh')}
          value={r.note}
          maxLength={300}
          onChange={(e) => onChange({ ...r, note: e.target.value, at: Date.now(), by })}
        />
      )}
      <p className="hint">{t('rate.hint')}</p>
    </div>
  )
}

/** Отзыв клиента о ремонте: отправить ссылку и посмотреть ответ */
export function ReviewPanel({ order }: { order: Order }) {
  const { t, locale, settings } = useSettings()
  const sync = useSyncStatus()
  const reviews = useReviews()
  const review = reviews.get(order.id)
  const [lang, setLang] = useState<Lang>(settings.docLang)
  const [link, setLink] = useState<{ url: string; lang: Lang } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!sync.connected) return null

  const car = [order.make, order.model].filter(Boolean).join(' ')
  const message = (url: string, l: Lang) => makeT(l)('review.msg', { shop: settings.shopName || 'Windauto', car: car || '—', url })

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const url = await reviewLink(order.id, lang)
      setLink({ url, lang })
      markSent(order.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const text = link ? message(link.url, link.lang) : ''
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      alert(t('share.copied'))
    } catch {
      prompt(t('share.copyManual'), text)
    }
  }

  return (
    <section className="panel no-print">
      <h2>{t('review.title')}</h2>
      {review?.stars ? (
        <div className="review-got">
          <div>
            <Stars value={review.stars} /> <b>{review.stars}/5</b>
            <span className="muted"> · {new Date(review.at).toLocaleDateString(locale)}</span>
          </div>
          {review.comment && <p className="review-comment">{review.comment}</p>}
        </div>
      ) : review?.sentAt ? (
        <p className="muted">
          {t('review.waiting', { d: new Date(review.sentAt).toLocaleDateString(locale) })}{' '}
          <button className="link-btn" onClick={() => refreshReviews(true)}>
            {t('review.check')}
          </button>
        </p>
      ) : (
        <p className="hint">{t('review.hint')}</p>
      )}

      {!link ? (
        <>
          <div className="seg-row two">
            {LANGS.map((l) => (
              <button key={l.id} className={'seg' + (lang === l.id ? ' active' : '')} onClick={() => setLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <button className="btn wide-btn" disabled={busy} onClick={create}>
            {busy ? '⏳' : '⭐'} {review?.sentAt ? t('review.again') : t('review.ask')}
          </button>
        </>
      ) : (
        <>
          <p className="review-text">{text}</p>
          <div className="seg-row">
            <button className="btn small" onClick={() => openExternal(whatsappUrl(order.phone, text))}>💬 WhatsApp</button>
            <button className="btn small" onClick={() => (window.location.href = smsUrl(order.phone, text))}>✉️ SMS</button>
            <button className="btn small" onClick={async () => (await shareText(text, t('review.title'))) || copy()}>
              📨 {t('review.other')}
            </button>
          </div>
          <button className="link-btn" onClick={copy}>📋 {t('share.copy')}</button>
        </>
      )}
      {error && <p className="warn-text">⚠ {error}</p>}
    </section>
  )
}
