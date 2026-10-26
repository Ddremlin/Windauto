// Лист приёмки и акт выдачи для клиента — рендерятся вне экрана и снимаются в PDF.
// Стили простые (без var/color-mix), чтобы html2canvas отрисовал их точно.
import { getLayout } from '../body'
import { orderNo } from '../docNumber'
import { rodoClause } from '../rodo'
import { useSettings } from '../settingsHooks'
import type { Order, Signature } from '../types'
import { formatDuration } from '../videos'
import { formatPlate } from '../validate'
import { WORKS, WORK_BY_ID, elementLabor, elementTotal, formatMoney, fuelLabel, orderTotals } from '../works'
import BodyMap, { DAMAGE_COLOR } from './BodyMap'
import { PlateBadge } from './Plate'

export type DocKind = 'acceptance' | 'handover'

export const DOC_WIDTH = 794 // A4 при 96 dpi

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
.doc-kv > span { color: #666; font-size: 11px; display: block; }
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
.doc-paint-notes { white-space: pre-wrap; margin-top: 6px; }
.doc-paint-notes > span { color: #666; font-size: 11px; display: block; }
.doc-note { color: #555; font-style: italic; margin-top: 2px; }
.doc-total { display: flex; justify-content: space-between; font-size: 16px; padding: 10px 6px; border-top: 2px solid #111; margin-top: 4px; }
.doc-total b { font-size: 18px; }
.doc-small { font-size: 11px; color: #666; }
.doc-photos-el { font-weight: 600; margin: 8px 0 4px; }
.doc-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.doc-photos img { width: 100%; height: 170px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; display: block; }
.doc-sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 28px; padding-bottom: 8px; }
.doc-sign > div { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
.doc-sign-img { height: 64px; display: flex; align-items: flex-end; }
.doc-sign-img img { max-height: 64px; max-width: 100%; }
.doc-sign-line { border-top: 1px solid #111; padding-top: 4px; font-size: 11px; color: #444; }
.doc-statement { font-size: 12px; margin-top: 18px; }
.doc-totals { margin-left: auto; width: 55%; }
.doc-totals div { display: flex; justify-content: space-between; padding: 3px 6px; }
.doc-intake { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px 16px; margin-top: 8px; font-size: 12px; }
.doc-check { display: inline-block; width: 11px; height: 11px; border: 1px solid #333; border-radius: 2px; margin-right: 5px; vertical-align: -1px; text-align: center; line-height: 9px; font-size: 10px; font-weight: 700; }
.doc-rodo { font-size: 10.5px; color: #444; line-height: 1.35; }
.doc-consent { font-size: 12px; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.doc-damage { color: #8a3b00; }
.doc-photos-label { font-size: 11px; color: #666; margin: 4px 0 2px; }
`

interface Props {
  order: Order
  photoUrls: Record<string, string>
  kind?: DocKind
}

export default function AcceptanceDoc({ order, photoUrls, kind = 'acceptance' }: Props) {
  const { t, locale, settings } = useSettings()
  const handover = kind === 'handover'
  const layout = getLayout(order.bodyType)
  const marked = layout.elements.filter((e) => order.elements[e.id])
  const withWorks = marked.filter((e) => {
    const v = order.elements[e.id]
    return v.works.length || v.parts || (v.note && !v.damage?.length)
  })
  const withDamage = marked.filter((e) => order.elements[e.id].damage?.length)
  const usedWorks = WORKS.filter((w) => marked.some((e) => order.elements[e.id].works.includes(w.id)))
  const totals = orderTotals(order, settings, marked.map((e) => e.id))
  const dateStyle = { dateStyle: 'medium', timeStyle: 'short' } as const
  const kv = (label: string, value: string, mono = false) =>
    value ? (
      <div className="doc-kv">
        <span>{label}</span>
        <b className={mono ? 'doc-mono' : undefined}>{value}</b>
      </div>
    ) : null
  const check = (on: boolean) => <span className="doc-check">{on ? '✓' : ''}</span>

  // фото по 3 в ряд — каждый ряд отдельный блок для разбивки на страницы
  type Row = { el: (typeof marked)[number]; ids: string[]; first: boolean; label?: string }
  const rowsOf = (e: Row['el'], ids: string[], label?: string): Row[] => {
    const ok = ids.filter((id) => photoUrls[id])
    const rows: Row[] = []
    for (let i = 0; i < ok.length; i += 3) rows.push({ el: e, ids: ok.slice(i, i + 3), first: false, label: i === 0 ? label : undefined })
    return rows
  }
  const photoRows = marked.flatMap((e) => {
    const v = order.elements[e.id]
    const rows = handover
      ? [...rowsOf(e, v.photos ?? [], t('doc.before')), ...rowsOf(e, v.photosAfter ?? [], t('doc.after'))]
      : rowsOf(e, v.photos ?? [])
    if (rows[0]) rows[0].first = true
    return rows
  })

  const sign = (s: Signature | undefined, label: string) => (
    <div>
      <div className="doc-sign-img">{s && <img src={s.img} alt="" />}</div>
      <div className="doc-sign-line">
        {label}
        {s && (
          <>
            {s.name ? `: ${s.name}` : ''} · {new Date(s.at).toLocaleString(locale, dateStyle)}
          </>
        )}
      </div>
    </div>
  )

  const intake = order.intake
  const hasIntake = intake.fuel !== undefined || intake.keys !== undefined || intake.items.length > 0 || intake.belongings || Boolean(order.walkaround)

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
          <h1>{t(handover ? 'doc.handoverTitle' : 'doc.title')}</h1>
          <div>{t('doc.number', { n: orderNo(order) })}</div>
          <div>
            {handover && t('doc.accepted') + ' '}
            {new Date(order.createdAt).toLocaleString(locale, dateStyle)}
          </div>
          {handover && (
            <div>
              {t('doc.issued')} {new Date(order.signatures.issueClient?.at ?? Date.now()).toLocaleString(locale, dateStyle)}
            </div>
          )}
        </div>
      </div>

      <div data-block>
        <h2>{t('order.car')}</h2>
        <div className="doc-grid">
          {order.plate && (
            <div className="doc-kv">
              <span>{t('order.plate')}</span>
              <span>
                <PlateBadge text={formatPlate(order.plate, order.plateCountry)} country={order.plateCountry} height={26} />
              </span>
            </div>
          )}
          {kv(t('order.vin'), order.vin, true)}
          {kv(t('order.make'), [order.make, order.model].filter(Boolean).join(' '))}
          {kv(t('order.year'), order.year)}
          {kv(t('order.mileage'), order.mileage)}
          {kv(t('order.body'), t(`body.${order.bodyType}`))}
          {kv(t('order.color'), order.color)}
          {kv(t('order.paintCode'), order.paintCode, true)}
          {!handover && kv(t('order.dueDate'), order.dueDate ? new Date(order.dueDate + 'T12:00').toLocaleDateString(locale) : '')}
        </div>
        {!handover && order.paintFormula && <div className="doc-formula">{order.paintFormula}</div>}
        {!handover && order.paintNotes && (
          <div className="doc-paint-notes">
            <span>{t('order.paintNotes')}</span>
            {order.paintNotes}
          </div>
        )}
      </div>

      {!handover && hasIntake && (
        <div data-block>
          <h2>{t('intake.title')}</h2>
          <div className="doc-grid">
            {kv(t('intake.fuel'), intake.fuel !== undefined ? fuelLabel(intake.fuel) : '')}
            {kv(t('intake.keys'), intake.keys !== undefined ? String(intake.keys) : '')}
            {order.walkaround &&
              kv(t('video.title'), t('video.recorded', { date: new Date(order.walkaround.at).toLocaleString(locale, dateStyle), dur: formatDuration(order.walkaround.duration) }))}
          </div>
          {intake.items.length > 0 && (
            <div className="doc-intake">
              {intake.items.map((id) => (
                <div key={id}>
                  {check(true)}
                  {t(`intake.${id}`)}
                </div>
              ))}
            </div>
          )}
          {intake.belongings && (
            <div className="doc-paint-notes">
              <span>{t('intake.belongings')}</span>
              {intake.belongings}
            </div>
          )}
        </div>
      )}

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
            {withDamage.length > 0 && (
              <div>
                <span className="doc-sw" style={{ background: DAMAGE_COLOR, borderRadius: '50%' }} />
                {t('damage.legend')}
              </div>
            )}
          </div>
        </div>
      </div>

      {withDamage.length > 0 && (
        <div data-block>
          <h2>{t('damage.title')}</h2>
          <table className="doc-table">
            <tbody>
              {withDamage.map((e) => (
                <tr key={e.id}>
                  <td style={{ width: '38%' }}>
                    <b>{t(`el.${e.key}`)}</b>
                  </td>
                  <td className="doc-damage">{order.elements[e.id].damage!.map((d) => t(`damage.${d}`)).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="doc-small">{t('damage.docNote')}</div>
        </div>
      )}

      {withWorks.length > 0 && (
        <>
          <div data-block>
            <h2>{t(handover ? 'doc.worksDone' : 'order.works')}</h2>
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
                      {v.parts ? (
                        <div className="doc-work">
                          <span>{t('tot.parts')}</span>
                          <span>{formatMoney(v.parts)}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{sum > 0 ? <b>{formatMoney(sum)}</b> : elementLabor(v) ? '' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div data-block>
            <div className="doc-totals">
              {totals.parts > 0 && (
                <>
                  <div><span>{t('tot.labor')}</span><span>{formatMoney(totals.labor)}</span></div>
                  <div><span>{t('tot.parts')}</span><span>{formatMoney(totals.parts)}</span></div>
                </>
              )}
              {totals.discount > 0 && (
                <div><span>{t('tot.discountSum', { p: totals.discountPct })}</span><span>−{formatMoney(totals.discount)}</span></div>
              )}
              {totals.vatRate > 0 && (
                <>
                  <div><span>{t('tot.net')}</span><span>{formatMoney(totals.net)}</span></div>
                  <div><span>{t('tot.vat', { r: totals.vatRate })}</span><span>{formatMoney(totals.vat)}</span></div>
                </>
              )}
            </div>
            <div className="doc-total">
              <span>{totals.vatRate > 0 ? t('tot.gross') : t('order.total')}</span>
              <b>{formatMoney(totals.gross)}</b>
            </div>
            {!handover && <div className="doc-small">{t('doc.disclaimer')}</div>}
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
          <h2>{t(handover ? 'doc.photosBeforeAfter' : 'doc.photos')}</h2>
        </div>
      )}
      {photoRows.map((r, i) => (
        <div data-block key={i}>
          {r.first && <div className="doc-photos-el">{t(`el.${r.el.key}`)}</div>}
          {r.label && <div className="doc-photos-label">{r.label}</div>}
          <div className="doc-photos">
            {r.ids.map((id) => (
              <img key={id} src={photoUrls[id]} alt="" />
            ))}
          </div>
        </div>
      ))}

      {!handover && (
        <div data-block>
          <h2>{t('consent.title')}</h2>
          <div className="doc-rodo">{rodoClause(settings, locale.startsWith('ru') ? 'ru' : 'pl')}</div>
          <div className="doc-consent">
            <div>
              {check(order.consent.rodo)}
              {t('consent.rodoDoc')}
            </div>
            <div>
              {check(order.consent.contact)}
              {t('consent.contactDoc')}
            </div>
          </div>
        </div>
      )}

      <div data-block>
        <div className="doc-statement">{t(handover ? 'sig.statement.issueClient' : 'sig.statement.acceptClient')}</div>
        <div className="doc-sign">
          {handover ? sign(order.signatures.issueClient, t('sig.issueClient')) : sign(order.signatures.acceptClient, t('doc.signClient'))}
          {sign(handover ? undefined : order.signatures.acceptMaster, t('doc.signMaster'))}
        </div>
      </div>
    </div>
  )
}
