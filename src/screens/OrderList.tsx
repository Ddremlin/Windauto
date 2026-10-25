import { useMemo, useState } from 'react'
import { PlateBadge } from '../components/Plate'
import { useSettings } from '../settings'
import { syncNow, useSyncStatus } from '../sync'
import type { Order } from '../types'
import { formatPlate, normalizePlate } from '../validate'
import { WORK_BY_ID, formatMoney, orderTotal } from '../works'

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
  onCreate: () => void
  onSettings: () => void
}

export default function OrderList({ orders, onOpen, onCreate, onSettings }: Props) {
  const { t, locale } = useSettings()
  const [q, setQ] = useState('')
  const sync = useSyncStatus()
  const syncIcon = sync.syncing ? '⟳' : sync.error || !sync.online ? '⚠' : sync.pending ? '↑' : '✓'

  const filtered = useMemo(() => {
    const nq = normalizePlate(q)
    const tq = q.trim().toLowerCase()
    const list = [...orders].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!tq) return list
    return list.filter(
      (o) =>
        (nq && (normalizePlate(o.plate).includes(nq) || o.vin.includes(nq))) ||
        `${o.make} ${o.model} ${o.client} ${o.phone} ${o.email}`.toLowerCase().includes(tq),
    )
  }, [orders, q])

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
        <button className="icon-btn" aria-label={t('app.settings')} onClick={onSettings}>⚙</button>
      </header>

      <div className="search">
        <input type="search" placeholder={t('list.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

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
          const marked = Object.entries(o.elements).filter(([, v]) => v.works.length)
          const workIds = [...new Set(marked.flatMap(([, v]) => v.works))]
          const total = orderTotal(o.elements)
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
                <span>{new Date(o.createdAt).toLocaleDateString(locale)}</span>
              </div>
              <div className="card-row">
                <span className="muted">
                  {marked.length ? t('list.elements', { n: marked.length }) : t('list.noWorks')}
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
