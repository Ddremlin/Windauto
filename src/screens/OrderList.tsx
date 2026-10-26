import { useMemo, useState } from 'react'
import { orderNo } from '../docNumber'
import { PlateBadge } from '../components/Plate'
import { useSettings } from '../settingsHooks'
import { syncNow, useSyncStatus } from '../sync'
import type { Order, OrderStatus } from '../types'
import { formatPlate, normalizePlate } from '../validate'
import { ACTIVE_STATUSES, STATUSES, WORK_BY_ID, formatMoney, orderTotals } from '../works'

type Filter = 'all' | 'active' | OrderStatus
const FILTER_KEY = 'windauto.listFilter'
const FILTERS: Filter[] = ['all', 'active', ...STATUSES]

const loadFilter = (): Filter => {
  try {
    const f = localStorage.getItem(FILTER_KEY) as Filter | null
    return f && FILTERS.includes(f) ? f : 'all'
  } catch {
    return 'all'
  }
}

const matches = (o: Order, f: Filter) => f === 'all' || (f === 'active' ? ACTIVE_STATUSES.includes(o.status) : o.status === f)
const today = () => new Date().toISOString().slice(0, 10)

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
  onCreate: () => void
  onSettings: () => void
  onStats: () => void
}

export default function OrderList({ orders, onOpen, onCreate, onSettings, onStats }: Props) {
  const { t, locale, settings } = useSettings()
  const [q, setQ] = useState('')
  const [filter, setFilterState] = useState<Filter>(loadFilter)
  const setFilter = (f: Filter) => {
    setFilterState(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* только на эту сессию */
    }
  }
  const sync = useSyncStatus()
  const syncIcon = sync.syncing ? '⟳' : sync.error || !sync.online ? '⚠' : sync.pending ? '↑' : '✓'

  const filtered = useMemo(() => {
    const nq = normalizePlate(q)
    const tq = q.trim().toLowerCase()
    const list = orders.filter((o) => matches(o, filter)).sort((a, b) => b.updatedAt - a.updatedAt)
    if (!tq) return list
    return list.filter(
      (o) =>
        (nq && (normalizePlate(o.plate).includes(nq) || o.vin.includes(nq))) ||
        o.number.includes(tq) ||
        `${o.make} ${o.model} ${o.client} ${o.phone} ${o.email} ${o.assignee}`.toLowerCase().includes(tq),
    )
  }, [orders, q, filter])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, orders.filter((o) => matches(o, f)).length])), [orders])

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="brand">Windauto</h1>
        {sync.connected && (
          <button
            className={'sync-badge' + (sync.error || !sync.online ? ' warn' : '') + (sync.syncing ? ' spin' : '')}
            onClick={() => (sync.authError ? onSettings() : syncNow())}
            title={sync.error ?? ''}
            aria-label={t('sync.now')}
          >
            ☁ {syncIcon}
          </button>
        )}
        <button className="icon-btn" aria-label={t('stats.title')} onClick={onStats}>📊</button>
        <button className="icon-btn" aria-label={t('app.settings')} onClick={onSettings}>⚙</button>
      </header>

      <div className="search">
        <input type="search" placeholder={t('list.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {orders.length > 0 && (
        <div className="filters" role="tablist" aria-label={t('list.filter')}>
          {FILTERS.filter((f) => f === 'all' || f === 'active' || counts[f] > 0 || filter === f).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={'filter-chip' + (filter === f ? ' active' : '') + (f !== 'all' && f !== 'active' ? ` st-${f}` : '')}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? t('list.all') : f === 'active' ? t('list.active') : t(`status.${f}`)}
              <span className="filter-count">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      <main className="list">
        {filtered.length === 0 && (
          <div className="empty">
            {orders.length === 0 ? (
              <>
                <p>{t('list.empty')}</p>
                <button className="btn primary" onClick={onCreate}>{t('list.accept')}</button>
              </>
            ) : (
              <p>{t('list.notFound')}</p>
            )}
          </div>
        )}
        {filtered.map((o) => {
          const marked = Object.entries(o.elements).filter(([, v]) => v.works.length || v.parts)
          const workIds = [...new Set(marked.flatMap(([, v]) => v.works))]
          const total = orderTotals(o, settings).gross
          const overdue = o.dueDate && ACTIVE_STATUSES.includes(o.status) && o.status !== 'done' && o.dueDate < today()
          return (
            <button key={o.id} className="card" onClick={() => onOpen(o.id)}>
              <div className="card-row">
                {o.plate ? (
                  <PlateBadge text={formatPlate(o.plate, o.plateCountry)} country={o.plateCountry} height={28} />
                ) : (
                  <span className="plate">{t('list.noPlate')}</span>
                )}
                <span className={`status st-${o.status}`}>{t(`status.${o.status}`)}</span>
              </div>
              <div className="card-row muted">
                <span>{[o.make, o.model, o.year].filter(Boolean).join(' ') || t('list.noMake')}</span>
                <span>{o.number ? `№ ${orderNo(o)}` : new Date(o.createdAt).toLocaleDateString(locale)}</span>
              </div>
              {(o.assignee || o.dueDate || o.client) && (
                <div className="card-row muted small">
                  <span>{[o.client, o.assignee && `👷 ${o.assignee}`].filter(Boolean).join(' · ')}</span>
                  {o.dueDate && (
                    <span className={overdue ? 'overdue' : undefined}>
                      {overdue ? '⚠ ' : '⏱ '}
                      {new Date(o.dueDate + 'T12:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              )}
              <div className="card-row">
                <span className="muted">
                  {marked.length ? t('list.elements', { n: marked.length }) : t('list.noWorks')}
                  {o.signatures.acceptClient ? ' · ✍' : ''}
                  {total > 0 && <strong className="card-sum"> · {formatMoney(total)}</strong>}
                </span>
                <span className="dots">
                  {workIds.map((w) => (
                    <span key={w} className="dot" style={{ background: WORK_BY_ID[w].color }} title={t(`work.${w}`)} />
                  ))}
                </span>
              </div>
            </button>
          )
        })}
      </main>

      {orders.length > 0 && (
        <button className="fab" onClick={onCreate} aria-label={t('app.new')}>
          ＋
        </button>
      )}
    </div>
  )
}
