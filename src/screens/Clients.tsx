import { useMemo, useState } from 'react'
import { StarPicker, Stars } from '../components/ClientRating'
import { PlateBadge } from '../components/Plate'
import TopBar from '../components/TopBar'
import { isRisky, listClients, type ClientInfo } from '../clients'
import { orderNo } from '../docNumber'
import { useReviews } from '../reviews'
import { useSettings } from '../settingsHooks'
import { useSyncStatus } from '../sync'
import type { Order } from '../types'
import { formatPlate } from '../validate'
import { formatMoney, orderTotals } from '../works'

type Filter = 'all' | 'rated' | 'risky'
const FILTERS: Filter[] = ['all', 'rated', 'risky']

const avgText = (v: number) => String(v).replace('.', ',')

interface ListProps {
  orders: Order[]
  onOpenClient: (key: string) => void
}

// Раздел «Клиенты»: все, кто сдавал машину, с оценками мастеров
export function ClientList({ orders, onOpenClient }: ListProps) {
  const { t, locale, settings } = useSettings()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const clients = useMemo(() => listClients(orders), [orders])

  const shown = useMemo(() => {
    const tq = q.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clients.filter((c) => {
      if (filter === 'rated' && !c.profile.rated) return false
      if (filter === 'risky' && !isRisky(c.profile)) return false
      if (!tq) return true
      return (
        `${c.name} ${c.email}`.toLowerCase().includes(tq) ||
        (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)) ||
        c.orders.some((o) => `${o.plate} ${o.make} ${o.model}`.toLowerCase().includes(tq))
      )
    })
  }, [clients, q, filter])

  const count = (f: Filter) => (f === 'all' ? clients.length : f === 'rated' ? clients.filter((c) => c.profile.rated).length : clients.filter((c) => isRisky(c.profile)).length)

  return (
    <div className="screen">
      <TopBar current="clients" />
      <div className="search">
        <input type="search" placeholder={t('cl.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {clients.length > 0 && (
        <div className="filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={'filter-chip' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
              {t(`cl.f.${f}`)}
              <span className="filter-count">{count(f)}</span>
            </button>
          ))}
        </div>
      )}
      <main className="list">
        {shown.length === 0 && <div className="empty"><p>{clients.length ? t('list.notFound') : t('cl.empty')}</p></div>}
        {shown.map((c) => {
          const sum = c.orders.reduce((s, o) => s + orderTotals(o, settings).gross, 0)
          const risky = isRisky(c.profile)
          return (
            <button key={c.key} className={'card client-card' + (risky ? ' risky' : '')} onClick={() => onOpenClient(c.key)}>
              <div className="card-row">
                <b className="client-name">{risky && '⚠ '}{c.name || c.phone}</b>
                {c.profile.rated ? (
                  <span className="client-stars">
                    <Stars value={c.profile.avg} size="sm" /> {avgText(c.profile.avg)}
                  </span>
                ) : (
                  <span className="muted small">{t('cl.noRating')}</span>
                )}
              </div>
              {c.cars.length > 0 && (
                <div className="client-cars">
                  {c.cars.map((car, i) => (
                    <span key={i} className="client-car">
                      🚗 {car.car || t('list.noMake')}
                      {car.plate && <small> · {formatPlate(car.plate, car.plateCountry)}</small>}
                    </span>
                  ))}
                </div>
              )}
              <div className="card-row muted small">
                <span>{[c.name && c.phone, c.email].filter(Boolean).join(' · ') || ' '}</span>
              </div>
              <div className="card-row muted small">
                <span>
                  {t('cl.orders', { n: c.orders.length })}
                  {sum > 0 && <> · {formatMoney(sum)}</>}
                </span>
                <span>{new Date(c.lastVisit).toLocaleDateString(locale)}</span>
              </div>
              {c.profile.last?.note && <div className="client-note">«{c.profile.last.note}»</div>}
            </button>
          )
        })}
      </main>
    </div>
  )
}

interface PageProps {
  client: ClientInfo | undefined
  onBack: () => void
  onOpen: (id: string) => void
  onSave: (o: Order) => void
  onNewOrder: (c: ClientInfo) => void
}

// Карточка клиента: контакты, оценка, история оценок и заказов
export function ClientPage({ client, onBack, onOpen, onSave, onNewOrder }: PageProps) {
  const { t, locale, settings } = useSettings()
  const sync = useSyncStatus()
  const reviews = useReviews()

  if (!client)
    return (
      <div className="screen">
        <header className="topbar">
          <button className="icon-btn" aria-label={t('app.back')} onClick={onBack}>←</button>
          <h1>{t('menu.clients')}</h1>
          <span className="topbar-spacer" />
        </header>
        <main className="content"><p className="muted">{t('list.notFound')}</p></main>
      </div>
    )

  const by = sync.user?.name || sync.user?.login || ''
  // оценка ставится на самый новый заказ клиента — по нему и видно, когда и кто оценил
  const latest = client.orders[0]
  const current = latest.clientRating
  const rate = (stars: number) =>
    onSave({ ...latest, clientRating: stars ? { stars, note: current?.note ?? '', at: Date.now(), by } : undefined, updatedAt: Date.now() })
  const setNote = (note: string) => current && onSave({ ...latest, clientRating: { ...current, note, at: Date.now(), by }, updatedAt: Date.now() })

  const rated = client.orders.filter((o) => o.clientRating?.stars)
  const theirReviews = client.orders.map((o) => reviews.get(o.id)).filter((r) => r?.stars)
  const reviewAvg = theirReviews.length ? Math.round((theirReviews.reduce((s, r) => s + r!.stars, 0) / theirReviews.length) * 10) / 10 : 0
  const sum = client.orders.reduce((s, o) => s + orderTotals(o, settings).gross, 0)
  const risky = isRisky(client.profile)

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label={t('app.back')} onClick={onBack}>←</button>
        <h1>{client.name || client.phone}</h1>
        <span className="topbar-spacer" />
      </header>
      <main className="content">
        <section className={'panel' + (risky ? ' client-risky' : '')}>
          {risky && <p className="client-risky-text">⚠ {t('rate.risky')}</p>}
          {client.cars.length > 0 && (
            <div className="client-cars big">
              {client.cars.map((car, i) => (
                <span key={i} className="client-car">
                  {car.plate && <PlateBadge text={formatPlate(car.plate, car.plateCountry)} country={car.plateCountry} height={24} />}
                  <b>{car.car || t('list.noMake')}</b>
                </span>
              ))}
            </div>
          )}
          <div className="client-contacts">
            {client.phone && <a href={`tel:${client.phone.replace(/[^\d+]/g, '')}`}>📞 {client.phone}</a>}
            {client.email && <a href={`mailto:${client.email}`}>📧 {client.email}</a>}
          </div>
          <div className="tiles client-tiles">
            <div className="tile">
              <span>{t('cl.ordersTitle')}</span>
              <b>{client.orders.length}</b>
            </div>
            <div className="tile">
              <span>{t('cl.sum')}</span>
              <b className="smaller">{formatMoney(sum)}</b>
            </div>
            <div className="tile">
              <span>{t('cl.avg')}</span>
              <b>{client.profile.rated ? avgText(client.profile.avg) + ' ★' : '—'}</b>
            </div>
            <div className="tile">
              <span>{t('cl.theirReview')}</span>
              <b>{theirReviews.length ? avgText(reviewAvg) + ' ★' : '—'}</b>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>{t('rate.title')}</h2>
          <StarPicker value={current?.stars ?? 0} onChange={rate} label={t('rate.title')} />
          {current && (
            <input
              type="text"
              className="client-note-input"
              placeholder={t('rate.notePh')}
              value={current.note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          <p className="hint">{t('cl.rateHint', { d: new Date(latest.createdAt).toLocaleDateString(locale) })}</p>
          {rated.length > 0 && (
            <ul className="plain-list">
              {rated.map((o) => (
                <li key={o.id} className="review-item">
                  <span>
                    <Stars value={o.clientRating!.stars} size="sm" />{' '}
                    <span className="muted small">
                      {[o.clientRating!.by, new Date(o.clientRating!.at).toLocaleDateString(locale)].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  <button className="link-btn" onClick={() => onOpen(o.id)}>
                    {o.plate ? formatPlate(o.plate, o.plateCountry) : orderNo(o)}
                  </button>
                  {o.clientRating!.note && <p className="review-comment">{o.clientRating!.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>{t('cl.ordersTitle')}</h2>
          <ul className="plain-list">
            {client.orders.map((o) => {
              const r = reviews.get(o.id)
              const total = orderTotals(o, settings).gross
              return (
                <li key={o.id}>
                  <button className="cal-order" onClick={() => onOpen(o.id)}>
                    <span className={`cal-bar s-${o.status}`} />
                    <span className="cal-order-text">
                      <b>{o.plate ? formatPlate(o.plate, o.plateCountry) : [o.make, o.model].filter(Boolean).join(' ') || t('list.noPlate')}</b>
                      <small className="muted">
                        {[
                          o.plate && [o.make, o.model].filter(Boolean).join(' '),
                          new Date(o.createdAt).toLocaleDateString(locale),
                          total > 0 && formatMoney(total),
                          r?.stars && `⭐${r.stars}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    <span className={`status st-${o.status}`}>{t(`status.${o.status}`)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <button className="btn primary wide-btn" onClick={() => onNewOrder(client)}>
            ＋ {t('cl.newOrder')}
          </button>
        </section>
      </main>
    </div>
  )
}
