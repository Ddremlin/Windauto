// Лист приёмки для клиента — рендерится вне экрана и снимается в PDF.
// Стили простые (без var/color-mix), чтобы html2canvas отрисовал их точно.
import { getLayout } from '../body'
import { useSettings } from '../settings'
import type { Order } from '../types'
import { formatPlate } from '../validate'
import { WORKS, WORK_BY_ID, elementTotal, formatMoney, orderTotal } from '../works'
import BodyMap from './BodyMap'

export const DOC_WIDTH = 794 // A4 при 96 dpi

export function docNumber(o: Order): string {
  const d = new Date(o.createdAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

const css = `
.doc { width: ${DOC_WIDTH}px; padding: 0 40px; background: #fff; color: #111; font: 13px/1.4 Roboto, 'Segoe UI', Arial, sans-serif; box-sizing: border-box; }
.doc * { box-sizing: border-box; }
.doc-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 0 0 12px; border-bottom: 2px solid #111; }
.doc-shop { font-size: 12px; color: #444; }
.doc-shop b { font-size: 15px; color: #111; display: block; }
.doc-title { text-align: right; }
.doc-title h1 { margin: 0; font-size: 20px; }
.doc-title div { color: #444; }
.doc h2 { font-size: 14px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #333; }
.doc-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; }
.doc-kv span { color: #666; font-size: 11px; display: block; }
.doc-kv b { font-weight: 600; }
.doc-mono { font-family: 'Roboto Mono', Menlo, monospace; letter-spacing: .04em; }
.doc-formula { white-space: pre-wrap; font-family: 'Roboto Mono', Menlo, monospace; font-size: 12px; background: #f4f5f7; padding: 6px 8px; border-radius: 4px; margin-top: 6px; }
.doc-map { display: flex; gap: 20px; align-items: flex-start; }
.doc-map svg { flex: none; }
.doc-legend { display: flex; flex-direction: column; gap: 6px; padding-top: 30px; }
.doc-legend div { display: flex; align-items: center; gap: 8px; }
.doc-sw { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.2); display: inline-block; flex: none; }
.doc-table { width: 100%; border-collapse: collapse; }
.doc-table th { text-align: left; font-size: 11px; color: #666; font-weight: 600; border-bottom: 1px solid #999; padding: 4px 6px; }
.doc-table td { border-bottom: 1px solid #ddd; padding: 6px; vertical-align: top; }
.doc-table .num { text-align: right; white-space: nowrap; }
.doc-work { display: flex; justify-content: space-between; gap: 8px; }
.doc-work span:first-child { display: flex; align-items: center; gap: 6px; }
.doc-note { color: #555; font-style: italic; margin-top: 2px; }
.doc-total { display: flex; justify-content: space-between; font-size: 16px; padding: 10px 6px; border-top: 2px solid #111; margin-top: 4px; }
.doc-total b { font-size: 18px; }
.doc-small { font-size: 11px; color: #666; }
.doc-photos-el { font-weight: 600; margin: 8px 0 4px; }
.doc-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.doc-photos img { width: 100%; height: 170px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; display: block; }
.doc-sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 36px; padding-bottom: 8px; }
.doc-sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #444; }
`

interface Props {
  order: Order
  photoUrls: Record<string, string>
}

export default function AcceptanceDoc({ order, photoUrls }: Props) {
  const { t, locale, settings } = useSettings()
  const layout = getLayout(order.bodyType)
  const marked = layout.elements.filter((e) => order.elements[e.id])
  const withWorks = marked.filter((e) => order.elements[e.id].works.length || order.elements[e.id].note)
  const withPhotos = marked.filter((e) => order.elements[e.id].photos?.some((id) => photoUrls[id]))
  const usedWorks = WORKS.filter((w) => marked.some((e) => order.elements[e.id].works.includes(w.id)))
  const total = orderTotal(order.elements, marked.map((e) => e.id))
  const kv = (label: string, value: string, mono = false) =>
    value ? (
      <div className="doc-kv">
        <span>{label}</span>
        <b className={mono ? 'doc-mono' : undefined}>{value}</b>
      </div>
    ) : null

  // фото по 3 в ряд — каждый ряд отдельный блок для разбивки на страницы
  const photoRows = withPhotos.flatMap((e) => {
    const ids = (order.elements[e.id].photos ?? []).filter((id) => photoUrls[id])
    const rows: string[][] = []
    for (let i = 0; i < ids.length; i += 3) rows.push(ids.slice(i, i + 3))
    return rows.map((r, i) => ({ el: e, ids: r, first: i === 0 }))
  })

  return (
    <div className="doc">
      <style>{css}</style>
      <div data-block className="doc-head" style={{ paddingTop: 0 }}>
        <div className="doc-shop">
          {settings.shopName && <b>{settings.shopName}</b>}
          {settings.shopAddress && <div>{settings.shopAddress}</div>}
          {settings.shopPhone && <div>tel. {settings.shopPhone}</div>}
          {settings.shopNip && <div>NIP {settings.shopNip}</div>}
        </div>
        <div className="doc-title">
          <h1>{t('doc.title')}</h1>
          <div>{t('doc.number', { n: docNumber(order) })}</div>
          <div>{new Date(order.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
      </div>

      <div data-block>
        <h2>{t('order.car')}</h2>
        <div className="doc-grid">
          {kv(t('order.plate'), order.plate ? formatPlate(order.plate) : '', true)}
          {kv(t('order.vin'), order.vin, true)}
          {kv(t('order.make'), [order.make, order.model].filter(Boolean).join(' '))}
          {kv(t('order.year'), order.year)}
          {kv(t('order.mileage'), order.mileage)}
          {kv(t('order.body'), t(`body.${order.bodyType}`))}
          {kv(t('order.color'), order.color)}
          {kv(t('order.paintCode'), order.paintCode, true)}
        </div>
        {order.paintFormula && <div className="doc-formula">{order.paintFormula}</div>}
      </div>

      {(order.client || order.phone || order.email) && (
        <div data-block>
          <h2>{t('order.client')}</h2>
          <div className="doc-grid">
            {kv(t('order.clientName'), order.client)}
            {kv(t('order.phone'), order.phone)}
            {kv(t('order.email'), order.email)}
          </div>
        </div>
      )}

      <div data-block>
        <h2>{t('order.body')}</h2>
        <div className="doc-map">
          <BodyMap elements={order.elements} bodyType={order.bodyType} inline width={330} />
          <div className="doc-legend">
            {usedWorks.map((w) => (
              <div key={w.id}>
                <span className="doc-sw" style={{ background: w.color }} />
                {t(`work.${w.id}`)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {withWorks.length > 0 && (
        <>
          <div data-block>
            <h2>{t('order.works')}</h2>
          </div>
          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: '38%' }}>{t('doc.element')}</th>
                <th>{t('doc.workList')}</th>
                <th className="num" style={{ width: '18%' }}>{t('doc.price')}</th>
              </tr>
            </thead>
            <tbody>
              {withWorks.map((e) => {
                const v = order.elements[e.id]
                const sum = elementTotal(v)
                return (
                  <tr key={e.id} data-block>
                    <td>
                      <b>{t(`el.${e.key}`)}</b>
                      {v.note && <div className="doc-note">{v.note}</div>}
                    </td>
                    <td>
                      {v.works.map((w) => (
                        <div key={w} className="doc-work">
                          <span>
                            <span className="doc-sw" style={{ background: WORK_BY_ID[w].color }} />
                            {t(`work.${w}`)}
                          </span>
                          {v.prices?.[w] ? <span>{formatMoney(v.prices[w])}</span> : null}
                        </div>
                      ))}
                    </td>
                    <td className="num">{sum > 0 ? <b>{formatMoney(sum)}</b> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div data-block>
            <div className="doc-total">
              <span>{t('order.total')}</span>
              <b>{formatMoney(total)}</b>
            </div>
            <div className="doc-small">{t('doc.disclaimer')}</div>
          </div>
        </>
      )}

      {order.notes && (
        <div data-block>
          <h2>{t('order.notes')}</h2>
          <div style={{ whiteSpace: 'pre-wrap' }}>{order.notes}</div>
        </div>
      )}

      {photoRows.length > 0 && (
        <div data-block>
          <h2>{t('doc.photos')}</h2>
        </div>
      )}
      {photoRows.map((r, i) => (
        <div data-block key={i}>
          {r.first && <div className="doc-photos-el">{t(`el.${r.el.key}`)}</div>}
          <div className="doc-photos">
            {r.ids.map((id) => (
              <img key={id} src={photoUrls[id]} alt="" />
            ))}
          </div>
        </div>
      ))}

      <div data-block className="doc-sign">
        <div>{t('doc.signClient')}</div>
        <div>{t('doc.signMaster')}</div>
      </div>
    </div>
  )
}
