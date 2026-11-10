import { useMemo, useState, type ReactNode } from 'react'
import TopBar from '../components/TopBar'
import { clientPath } from '../clients'
import { fold, highlight, parseQuery, search, type Query } from '../search'
import { useSettings } from '../settingsHooks'
import type { Order } from '../types'
import { formatPlate } from '../validate'

// сколько показывать в каждой группе — дальше «уточните запрос»
const LIMIT = { clients: 10, cars: 10, orders: 30 }

const readQuery = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? ''

/** Совпавшие части текста — жирным */
function Hl({ text, q }: { text: string; q: Query }): ReactNode {
  return highlight(text, q).map(([part, hit], i) => (hit ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))
}

/** Общий поиск: клиенты, машины и заказы по одной строке. Запрос — в адресе (#/search?q=…), «назад» его не теряет */
export default function Search({ orders, onOpenOrder, onOpenClient }: { orders: Order[]; onOpenOrder: (id: string) => void; onOpenClient: (path: string) => void }) {
  const { t, locale } = useSettings()
  const [q, setQ] = useState(readQuery)
  const query = useMemo(() => parseQuery(q), [q])
  const res = useMemo(() => search(orders, q), [orders, q])
  const total = res.clients.length + res.cars.length + res.orders.length

  const change = (v: string) => {
    setQ(v)
    history.replaceState(null, '', v.trim() ? `#/search?q=${encodeURIComponent(v)}` : '#/search')
  }
  const more = (n: number, limit: number) => n > limit && <p className="hint search-more">{t('search.more', { n: n - limit })}</p>
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale)
  const plate = (p: string, c: string) => (p ? formatPlate(p, c) : '')

  return (
    <div className="screen">
      <TopBar current="search" />
      <div className="search">
        <input
          type="search"
          enterKeyHint="search"
          autoFocus
          aria-label={t('search.title')}
          placeholder={t('search.placeholder')}
          value={q}
          onChange={(e) => change(e.target.value)}
        />
      </div>
      <main className="list search-results">
        {!query.tokens.length && <div className="empty"><p>{t('search.hint')}</p></div>}
        {query.tokens.length > 0 && total === 0 && <div className="empty"><p>{t('list.notFound')}</p></div>}

        {res.clients.length > 0 && <h2 className="search-group">👥 {t('search.clients')} <span className="filter-count">{res.clients.length}</span></h2>}
        {res.clients.slice(0, LIMIT.clients).map((c) => (
          <button key={c.key} className="card search-hit" onClick={() => onOpenClient(clientPath(c.key))}>
            <div className="card-row">
              <b><Hl text={c.name || c.phone || t('cl.noName')} q={query} /></b>
              <span className="muted small">{t('cl.orders', { n: c.orders.length })}</span>
            </div>
            <div className="card-row muted small">
              <span>
                <Hl text={[c.name && c.phone, c.email].filter(Boolean).join(' · ')} q={query} />
              </span>
            </div>
            {c.cars.length > 0 && (
              <div className="muted small">
                🚗 <Hl text={c.cars.map((car) => [car.car, plate(car.plate, car.plateCountry)].filter(Boolean).join(' · ')).join(', ')} q={query} />
              </div>
            )}
          </button>
        ))}
        {more(res.clients.length, LIMIT.clients)}

        {res.cars.length > 0 && <h2 className="search-group">🚗 {t('search.cars')} <span className="filter-count">{res.cars.length}</span></h2>}
        {res.cars.slice(0, LIMIT.cars).map((car) => (
          <button
            key={car.key}
            className="card search-hit"
            onClick={() => (car.clientKey ? onOpenClient(clientPath(car.clientKey)) : onOpenOrder(car.orders[0].id))}
          >
            <div className="card-row">
              <b className="plate-text"><Hl text={plate(car.plate, car.plateCountry) || car.vin} q={query} /></b>
              <span className="muted small">{t('cl.orders', { n: car.orders.length })}</span>
            </div>
            <div className="card-row muted small">
              <span>
                <Hl text={[car.car || t('list.noMake'), car.client].filter(Boolean).join(' · ')} q={query} />
              </span>
              <span>{date(car.orders[0].createdAt)}</span>
            </div>
            {car.vin && car.plate && (
              <div className="muted small">
                VIN <Hl text={car.vin} q={query} />
              </div>
            )}
          </button>
        ))}
        {more(res.cars.length, LIMIT.cars)}

        {res.orders.length > 0 && <h2 className="search-group">📋 {t('search.orders')} <span className="filter-count">{res.orders.length}</span></h2>}
        {res.orders.slice(0, LIMIT.orders).map((o) => (
          <button key={o.id} className="card search-hit" onClick={() => onOpenOrder(o.id)}>
            <div className="card-row">
              <b>
                <Hl text={[o.number, plate(o.plate, o.plateCountry)].filter(Boolean).join(' · ') || t('list.noPlate')} q={query} />
              </b>
              <span className={`status st-${o.status}`}>{t(`status.${o.status}`)}</span>
            </div>
            <div className="card-row muted small">
              <span>
                <Hl text={[[o.make, o.model].filter(Boolean).join(' '), o.client, o.phone].filter(Boolean).join(' · ')} q={query} />
              </span>
              <span>{date(o.createdAt)}</span>
            </div>
            {/* нашлось в поле, которого нет в строке выше (заметки, VIN, цвет…) — показываем его */}
            {(() => {
              const extra = [o.vin, o.color, o.paintCode, o.email, o.assignee && `👷 ${o.assignee}`, o.notes].filter(
                (v): v is string => Boolean(v) && query.tokens.some((tok) => fold(v as string).includes(tok)),
              )
              return extra.length > 0 && <div className="muted small search-extra"><Hl text={extra.join(' · ').slice(0, 160)} q={query} /></div>
            })()}
          </button>
        ))}
        {more(res.orders.length, LIMIT.orders)}
      </main>
    </div>
  )
}
