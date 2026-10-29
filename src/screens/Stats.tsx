import { useMemo, useState } from 'react'
import { getLayout } from '../body'
import { Stars } from '../components/ClientRating'
import TopBar from '../components/TopBar'
import { clientKey, clientProfiles, isRisky } from '../clients'
import { useReviews } from '../reviews'
import { useSettings } from '../settingsHooks'
import type { Order, WorkId } from '../types'
import { formatPlate } from '../validate'
import { ACTIVE_STATUSES, STATUSES, WORKS, WORK_BY_ID, formatMoney, orderTotals } from '../works'

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
}

type Period = 'month' | 'prev' | 'year' | 'all'
const PERIODS: Period[] = ['month', 'prev', 'year', 'all']

function range(p: Period, now = new Date()): [number, number] {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (p === 'month') return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()]
  if (p === 'prev') return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()]
  if (p === 'year') return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]
  return [0, Infinity]
}

// Простая статистика по заказам на этом телефоне (в общей базе — по всем сотрудникам).
// Суммы — по заказам, принятым в выбранный период, брутто.
export default function Stats({ orders, onOpen }: Props) {
  const { t, locale, settings } = useSettings()
  const [period, setPeriod] = useState<Period>('month')

  const data = useMemo(() => {
    const [from, to] = range(period)
    const inPeriod = orders.filter((o) => o.createdAt >= from && o.createdAt < to)
    const totalOf = (o: Order) => orderTotals(o, settings, getLayout(o.bodyType).elements.map((e) => e.id)).gross
    const sum = inPeriod.reduce((s, o) => s + totalOf(o), 0)
    const priced = inPeriod.filter((o) => totalOf(o) > 0)
    const issued = orders.filter((o) => {
      const at = o.signatures.issueClient?.at
      return o.status === 'issued' && (at ?? o.updatedAt) >= from && (at ?? o.updatedAt) < to
    }).length

    // работы: сколько элементов и на какую сумму
    const works = new Map<WorkId, { n: number; sum: number }>()
    for (const o of inPeriod)
      for (const v of Object.values(o.elements))
        for (const w of v.works) {
          const cur = works.get(w) ?? { n: 0, sum: 0 }
          cur.n++
          cur.sum += v.prices?.[w] ?? 0
          works.set(w, cur)
        }
    const workList = WORKS.filter((w) => works.has(w.id))
      .map((w) => ({ id: w.id, ...works.get(w.id)! }))
      .sort((a, b) => b.n - a.n)

    // последние 6 месяцев — принято машин и сумма
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const a = d.getTime()
      const b = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
      const list = orders.filter((o) => o.createdAt >= a && o.createdAt < b)
      return { label: d.toLocaleDateString(locale, { month: 'short' }), n: list.length, sum: list.reduce((s, o) => s + totalOf(o), 0) }
    })

    const today = new Date().toISOString().slice(0, 10)
    const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status))
    const overdue = active.filter((o) => o.status !== 'done' && o.dueDate && o.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    const byStatus = STATUSES.map((s) => ({ s, n: orders.filter((o) => o.status === s).length }))
    const byAssignee = new Map<string, number>()
    for (const o of active) byAssignee.set(o.assignee || '—', (byAssignee.get(o.assignee || '—') ?? 0) + 1)

    return {
      count: inPeriod.length,
      sum,
      avg: priced.length ? sum / priced.length : 0,
      issued,
      active: active.length,
      workList,
      months,
      overdue,
      byStatus,
      byAssignee: [...byAssignee.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [orders, period, settings, locale])

  const reviews = useReviews()
  const rv = useMemo(() => {
    const [from, to] = range(period)
    const byId = new Map(orders.map((o) => [o.id, o]))
    const sent = [...reviews.values()].filter((r) => byId.has(r.orderId) && r.sentAt >= from && r.sentAt < to)
    const got = sent.filter((r) => r.stars > 0).sort((a, b) => b.at - a.at)
    const avg = got.length ? Math.round((got.reduce((s, r) => s + r.stars, 0) / got.length) * 10) / 10 : 0
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: got.filter((r) => r.stars === n).length }))
    return { sent: sent.length, got, avg, dist, byId }
  }, [reviews, orders, period])

  // клиенты, которых мастера оценили на 2 и ниже — по всем заказам, не по периоду
  const risky = useMemo(() => {
    const seen = new Set<string>()
    const profiles = clientProfiles(orders)
    const out: { o: Order; avg: number; note?: string }[] = []
    for (const o of [...orders].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const k = clientKey(o)
      const p = profiles.get(k)
      if (!k || seen.has(k) || !p || !isRisky(p)) continue
      seen.add(k)
      out.push({ o, avg: p.avg, note: p.last?.note })
    }
    return out
  }, [orders])

  const maxWork = Math.max(1, ...data.workList.map((w) => w.n))
  const maxMonth = Math.max(1, ...data.months.map((m) => m.sum))

  return (
    <div className="screen">
      <TopBar current="stats" />

      <main className="content">
        <div className="seg-row four" role="radiogroup" aria-label={t('stats.period')}>
          {PERIODS.map((p) => (
            <button key={p} role="radio" aria-checked={period === p} className={'seg' + (period === p ? ' active' : '')} onClick={() => setPeriod(p)}>
              {t(`stats.${p}`)}
            </button>
          ))}
        </div>

        <div className="tiles">
          <div className="tile">
            <span>{t('stats.accepted')}</span>
            <b>{data.count}</b>
          </div>
          <div className="tile">
            <span>{t('stats.issued')}</span>
            <b>{data.issued}</b>
          </div>
          <div className="tile wide">
            <span>{t('stats.sum')}</span>
            <b>{formatMoney(data.sum)}</b>
          </div>
          <div className="tile">
            <span>{t('stats.avg')}</span>
            <b className="smaller">{formatMoney(data.avg)}</b>
          </div>
          <div className="tile">
            <span>{t('stats.inService')}</span>
            <b>{data.active}</b>
          </div>
        </div>

        <section className="panel">
          <h2>{t('stats.months')}</h2>
          <div className="month-bars" role="img" aria-label={t('stats.months')}>
            {data.months.map((m, i) => (
              <div key={i} className="month" title={`${m.label}: ${formatMoney(m.sum)} · ${t('stats.cars', { n: m.n })}`}>
                <span className="month-val">{m.sum ? Math.round(m.sum / 1000) + 'k' : ''}</span>
                <div className="month-track">
                  <div className="month-bar" style={{ height: `${(m.sum / maxMonth) * 100}%` }} />
                </div>
                <span className="month-label">{m.label}</span>
                <span className="month-n">{m.n}</span>
              </div>
            ))}
          </div>
          <p className="hint">{t('stats.monthsHint')}</p>
          <table className="sr-only">
            <tbody>
              {data.months.map((m, i) => (
                <tr key={i}>
                  <td>{m.label}</td>
                  <td>{m.n}</td>
                  <td>{formatMoney(m.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>{t('stats.works')}</h2>
          {data.workList.length === 0 ? (
            <p className="muted">{t('stats.noData')}</p>
          ) : (
            <ul className="hbars">
              {data.workList.map((w) => (
                <li key={w.id} title={`${t(`work.${w.id}`)}: ${w.n} · ${formatMoney(w.sum)}`}>
                  <div className="hbar-head">
                    <span>
                      <span className="swatch" style={{ background: WORK_BY_ID[w.id].color }} /> {t(`work.${w.id}`)}
                    </span>
                    <span className="muted">
                      {w.n} · {formatMoney(w.sum)}
                    </span>
                  </div>
                  <div className="hbar-track">
                    <div className="hbar" style={{ width: `${(w.n / maxWork) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>{t('stats.now')}</h2>
          <div className="status-counts">
            {data.byStatus.map(({ s, n }) => (
              <span key={s} className={`status st-${s}`}>
                {t(`status.${s}`)}: {n}
              </span>
            ))}
          </div>
          {data.byAssignee.length > 0 && (
            <>
              <h2 className="sub">{t('stats.byAssignee')}</h2>
              <ul className="plain-list">
                {data.byAssignee.map(([name, n]) => (
                  <li key={name}>
                    <span>{name === '—' ? t('stats.noAssignee') : name}</span>
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {rv.sent > 0 && (
          <section className="panel">
            <h2>{t('stats.reviews')}</h2>
            {rv.got.length === 0 ? (
              <p className="muted">{t('stats.reviewsNone', { n: rv.sent })}</p>
            ) : (
              <>
                <div className="review-sum">
                  <b>{String(rv.avg).replace('.', ',')}</b>
                  <span>
                    <Stars value={rv.avg} />
                    <small className="muted">{t('stats.reviewsCount', { n: rv.got.length, m: rv.sent })}</small>
                  </span>
                </div>
                <ul className="plain-list">
                  {rv.dist.map((d) => (
                    <li key={d.n} className="review-dist">
                      <span>{d.n}★</span>
                      <div className="hbar-track">
                        <div className="hbar" style={{ width: `${(d.count / rv.got.length) * 100}%` }} />
                      </div>
                      <span className="muted">{d.count}</span>
                    </li>
                  ))}
                </ul>
                <h2 className="sub">{t('stats.reviewsLast')}</h2>
                <ul className="plain-list">
                  {rv.got.slice(0, 8).map((r) => {
                    const o = rv.byId.get(r.orderId)!
                    return (
                      <li key={r.orderId} className="review-item">
                        <button className="link-btn" onClick={() => onOpen(o.id)}>
                          {o.plate ? formatPlate(o.plate, o.plateCountry) : [o.make, o.model].filter(Boolean).join(' ') || '—'}
                          {o.client && <span className="muted"> · {o.client}</span>}
                        </button>
                        <span className={r.stars <= 2 ? 'overdue' : 'stars-text'}>{'★'.repeat(r.stars)}</span>
                        {r.comment && <p className="review-comment">{r.comment}</p>}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {risky.length > 0 && (
          <section className="panel">
            <h2>⚠ {t('stats.risky', { n: risky.length })}</h2>
            <ul className="plain-list">
              {risky.map(({ o, avg, note }) => (
                <li key={o.id} className="review-item">
                  <button className="link-btn" onClick={() => onOpen(o.id)}>
                    {o.client || o.phone}
                    {o.client && o.phone && <span className="muted"> · {o.phone}</span>}
                  </button>
                  <span className="overdue">{String(avg).replace('.', ',')}★</span>
                  {note && <p className="review-comment">{note}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.overdue.length > 0 && (
          <section className="panel">
            <h2>⚠ {t('stats.overdue', { n: data.overdue.length })}</h2>
            <ul className="plain-list">
              {data.overdue.map((o) => (
                <li key={o.id}>
                  <button className="link-btn" onClick={() => onOpen(o.id)}>
                    {o.plate ? formatPlate(o.plate, o.plateCountry) : [o.make, o.model].filter(Boolean).join(' ') || '—'}
                  </button>
                  <span className="overdue">{new Date(o.dueDate + 'T12:00').toLocaleDateString(locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
