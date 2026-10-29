import { useEffect, useRef, useState } from 'react'
import { BODY_TYPES, getLayout } from '../body'
import { MAKES, canonMake, canonModel, isKnownModel, modelsOf } from '../cars'
import AcceptanceNo from '../components/AcceptanceNo'
import BodyMap, { DAMAGE_COLOR } from '../components/BodyMap'
import { ClientRatingBlock, ReviewPanel, Stars } from '../components/ClientRating'
import { clientKey, clientPath, isRisky, profileOf } from '../clients'
import Combo from '../components/Combo'
import ElementSheet from '../components/ElementSheet'
import Field from '../components/Field'
import { ConsentBlock, HistoryPanel, IntakePanel, ReadyNotice, SignaturesPanel, TotalsView } from '../components/OrderPanels'
import { PhotoStrip } from '../components/Photos'
import { PlateInput } from '../components/Plate'
import { useDocScan, useScan } from '../components/Scan'
import ShareSheet from '../components/ShareSheet'
import VoiceFab from '../components/VoiceFab'
import { WalkaroundPanel } from '../components/Walkaround'
import { COUNTRIES } from '../countries'
import { deletePhotos, elementPhotoIds, orderPhotoIds } from '../photos'
import { useSettings } from '../settingsHooks'
import { useOrders } from '../storage'
import { listStaff, useSyncStatus, type RecognizedDoc } from '../sync'
import type { BodyType, ElementWork, Order, Signature, SignatureKind } from '../types'
import { checkEmail, checkPlate, checkVin, formatPlate, normalizePlate, normalizeVin } from '../validate'
import { deleteVideos, orderVideoIds } from '../videos'
import { decodeVin } from '../vin'
import { STATUSES, WORKS, WORK_BY_ID, elementTotal, formatMoney, orderTotals } from '../works'

interface Props {
  initial: Order
  // возвращает сохранённую версию (с номером и отметками времени полей)
  onSave: (o: Order) => Order | void
  onDelete: (id: string) => void
  onBack: () => void
}

const hasContent = (o: Order) =>
  Boolean(
    o.plate || o.vin || o.make || o.model || o.client || o.phone || o.email || o.notes || o.paintNotes || o.assignee || o.dueDate ||
      Object.keys(o.elements).length || Object.keys(o.signatures).length || o.intake.items.length || o.intake.fuel !== undefined,
  )

function stamp(order: Order, patch: Partial<Order>): Order {
  return { ...order, ...patch, updatedAt: Math.max(Date.now(), order.updatedAt + 1) }
}

export default function OrderEdit({ initial, onSave, onDelete, onBack }: Props) {
  const { t, locale, settings } = useSettings()
  const sync = useSyncStatus()
  const { orders: allOrders } = useOrders()
  const [order, setOrder] = useState(initial)
  const [sheet, setSheet] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const [staff, setStaff] = useState<string[]>([])
  const modelRef = useRef<HTMLInputElement>(null)

  // заказ изменили на другом телефоне (или сервер выдал номер) — показываем свежую версию
  if (initial.updatedAt > order.updatedAt) setOrder(initial)

  useEffect(() => {
    if (!sync.connected) return
    listStaff().then((list) => setStaff(list.map((u) => u.name || u.login)))
  }, [sync.connected])

  const update = (patch: Partial<Order>) => {
    const next = stamp(order, patch)
    setOrder(next)
    if (hasContent(next)) {
      const saved = onSave(next)
      if (saved) setOrder(saved)
    }
  }

  const setElement = (id: string, v: ElementWork | undefined) => {
    const elements = { ...order.elements }
    if (v) elements[id] = v
    else delete elements[id]
    update({ elements })
  }

  const setSignature = (kind: SignatureKind, s: Signature | undefined) => {
    const signatures = { ...order.signatures }
    if (s) signatures[kind] = s
    else delete signatures[kind]
    // подпись при выдаче — машина выдана
    update({ signatures, ...(kind === 'issueClient' && s && order.status !== 'issued' ? { status: 'issued' as const } : {}) })
  }

  const field = (key: keyof Order) => ({
    value: order[key] as string,
    onChange: (v: string) => update({ [key]: v } as Partial<Order>),
  })

  const vinScan = useScan('vin', (r) => update({ vin: normalizeVin(r.value) }))
  const plateScan = useScan('plate', (r) => {
    const c = COUNTRIES.find((c) => c.code === r.country?.toUpperCase() || c.iso === r.country?.toUpperCase())
    const country = c?.code ?? order.plateCountry
    update({ plate: formatPlate(r.value.toUpperCase(), country), plateCountry: country })
  })

  // техпаспорт: заполняем пустые поля, а заполненные по-другому — после подтверждения
  const applyDoc = (r: RecognizedDoc) => {
    const make = canonMake(r.make)
    const found: Partial<Order> = {
      plate: r.plate ? formatPlate(r.plate.toUpperCase(), 'PL') : '',
      vin: r.vin ? normalizeVin(r.vin) : '',
      make,
      model: canonModel(make || order.make, r.model),
      year: /^\d{4}$/.test(r.year.trim()) ? r.year.trim() : '',
      client: r.owner.trim(),
    }
    const patch: Partial<Order> = {}
    const conflicts: string[] = []
    const label: Record<string, string> = { plate: 'order.plate', vin: 'order.vin', make: 'order.make', model: 'order.model', year: 'order.year', client: 'order.clientName' }
    for (const [k, v] of Object.entries(found) as [keyof Order, string][]) {
      if (!v) continue
      const cur = String(order[k] ?? '')
      const same = k === 'plate' ? normalizePlate(cur) === normalizePlate(v) : cur.trim().toLowerCase() === v.toLowerCase()
      if (!cur) Object.assign(patch, { [k]: v })
      else if (!same) conflicts.push(`${t(label[k])}: ${cur} → ${v}`)
    }
    if (conflicts.length && confirm(t('scan.docReplace', { list: conflicts.join('\n') })))
      for (const [k, v] of Object.entries(found)) if (v) Object.assign(patch, { [k]: v })
    if (patch.plate && !order.plate) patch.plateCountry = 'PL'
    if (Object.keys(patch).length) update(patch)
    return Object.keys(patch).length
  }
  const docScan = useDocScan(applyDoc)

  const plateCheck = checkPlate(order.plate, order.plateCountry)
  const vinCheck = checkVin(order.vin)
  const vinInfo = decodeVin(order.vin)
  const vinSuggest: Partial<Order> = {}
  if (vinInfo.make && !order.make) vinSuggest.make = vinInfo.make
  if (vinInfo.year && !order.year) vinSuggest.year = String(vinInfo.year)
  const layout = getLayout(order.bodyType)
  const marked = layout.elements.filter((e) => order.elements[e.id])
  const withWorks = marked.filter((e) => {
    const v = order.elements[e.id]
    return v.works.length || v.parts || v.note || v.photos?.length || v.photosAfter?.length
  })
  const damaged = marked.filter((e) => order.elements[e.id].damage?.length)
  const totals = orderTotals(order, settings, marked.map((e) => e.id))
  const sheetEl = sheet ? layout.elements.find((e) => e.id === sheet) : undefined
  const usedWorks = WORKS.filter((w) => marked.some((e) => order.elements[e.id].works.includes(w.id)))
  const overdue = order.dueDate && order.status !== 'issued' && order.status !== 'done' && order.dueDate < new Date().toISOString().slice(0, 10)

  const changeBody = (b: BodyType) => {
    if (b === order.bodyType) return
    const ids = new Set(getLayout(b).elements.map((e) => e.id))
    const lost = Object.keys(order.elements).filter((id) => !ids.has(id))
    if (lost.length) {
      const names = lost.map((id) => {
        const e = layout.elements.find((x) => x.id === id)
        return e ? t(`el.${e.key}`) : id
      })
      if (!confirm(t('order.bodyLost', { body: t(`body.${b}`), names: names.join(', ') }))) return
    }
    deletePhotos(lost.flatMap((id) => elementPhotoIds(order.elements[id])))
    const elements = Object.fromEntries(Object.entries(order.elements).filter(([id]) => ids.has(id)))
    update({ bodyType: b, elements })
  }

  const remove = () => {
    if (confirm(t('order.deleteConfirm'))) {
      deletePhotos(orderPhotoIds(order))
      deleteVideos(orderVideoIds(order))
      onDelete(order.id)
      onBack()
    }
  }

  const title = order.plate ? formatPlate(order.plate, order.plateCountry) : t('app.new')
  // клиент со звёздами вверху заказа — по всем его заказам, включая этот
  const ckey = clientKey(order)
  const cprof = ckey ? profileOf(allOrders.filter((o) => o.id === order.id || clientKey(o) === ckey).map((o) => (o.id === order.id ? order : o))) : null

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label={t('app.back')} onClick={onBack}>←</button>
        <h1>{title}</h1>
        <button className="icon-btn" aria-label={t('app.share')} onClick={() => setShare(true)}>⇪</button>
      </header>

      <main className="content">
        <div className="print-only print-head">
          <strong>Windauto — {t('share.title')}</strong>
          <span>{new Date(order.createdAt).toLocaleString(locale)}</span>
        </div>

        <section className="panel">
          <div className="order-meta">
            <AcceptanceNo order={order} pendingServer={sync.connected} />
            <span className="muted">{new Date(order.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <div className="status-bar" role="radiogroup" aria-label={t('order.status')}>
            {STATUSES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={order.status === s}
                className={`seg st-${s}` + (order.status === s ? ' active' : '')}
                onClick={() => update({ status: s })}
              >
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
          {cprof && (
            <button className={'order-client' + (isRisky(cprof) ? ' risky' : '')} onClick={() => (location.hash = clientPath(ckey))}>
              <span>
                {isRisky(cprof) ? '⚠ ' : '👤 '}
                {order.client || order.phone || t('cl.noName')}
                {cprof.orders > 1 && <small className="muted"> · {t('cl.orders', { n: cprof.orders })}</small>}
              </span>
              {cprof.rated ? (
                <span className="client-stars">
                  <Stars value={cprof.avg} size="sm" /> {String(cprof.avg).replace('.', ',')}
                </span>
              ) : (
                <small className="muted">{t('cl.noRating')} ›</small>
              )}
            </button>
          )}
          <ReadyNotice order={order} />
          <div className="grid meta-grid">
            <Combo label={t('order.assignee')} placeholder={t('order.assigneePh')} items={staff} {...field('assignee')} />
            <label className={'field' + (overdue ? ' lvl-warn' : '')}>
              <span className="field-label">{t('order.dueDate')}</span>
              <input type="date" value={order.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
              {overdue && <span className="field-hint">{t('order.overdue')}</span>}
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t('order.car')}</h2>
            <button className="btn small no-print" onClick={docScan.start} disabled={docScan.busy}>
              {docScan.busy ? <span className="spinner small" /> : '🪪'} {t('scan.doc')}
            </button>
            {docScan.input}
          </div>
          {docScan.message && <p className="hint scan-note">{docScan.message}</p>}
          <div className="grid">
            <PlateInput
              label={t('order.plate')}
              value={order.plate}
              country={order.plateCountry}
              onChange={(v) => update({ plate: v })}
              onCountry={(c) => update({ plateCountry: c })}
              onBlur={() => order.plate && update({ plate: formatPlate(order.plate, order.plateCountry) })}
              level={plateCheck.level}
              hint={plateCheck.message ? t(plateCheck.message, plateCheck.vars) : undefined}
              action={plateScan.button}
              note={plateScan.message}
            />
            <Field
              label={t('order.vin')}
              placeholder={t('order.vinPh')}
              upper
              mono
              wide
              {...field('vin')}
              onBlur={() => order.vin && update({ vin: normalizeVin(order.vin) })}
              check={vinCheck}
              action={vinScan.button}
              note={vinScan.message}
            />
            {Object.keys(vinSuggest).length > 0 && (
              <div className="vin-suggest wide no-print">
                <span>
                  {t('vin.found', {
                    what: [vinSuggest.make, vinSuggest.year && t('vin.year', { y: vinSuggest.year })].filter(Boolean).join(', '),
                  })}
                </span>
                <button className="btn small" onClick={() => update(vinSuggest)}>{t('vin.apply')}</button>
              </div>
            )}
            <Combo
              label={t('order.make')}
              placeholder="Škoda"
              items={MAKES}
              {...field('make')}
              onPick={(make) => {
                // модель от другой марки не подходит — очищаем и сразу переходим к выбору модели
                if (order.model && !isKnownModel(make, order.model)) update({ make, model: '' })
                if (!order.model || !isKnownModel(make, order.model)) modelRef.current?.focus()
              }}
            />
            <Combo label={t('order.model')} placeholder="Octavia" items={modelsOf(order.make)} inputRef={modelRef} {...field('model')} />
            <Field label={t('order.year')} inputMode="numeric" placeholder="2019" {...field('year')} />
            <Field label={t('order.mileage')} inputMode="numeric" {...field('mileage')} />
          </div>
          {vinInfo.year && order.year && /^\d{4}$/.test(order.year) && Math.abs(Number(order.year) - vinInfo.year) > 1 && (
            <p className="hint warn-text">{t('vin.yearMismatch', { y: vinInfo.year })}</p>
          )}
        </section>

        <section className="panel">
          <h2>{t('order.paint')}</h2>
          <div className="grid">
            <Field label={t('order.color')} placeholder={t('order.colorPh')} {...field('color')} />
            <Field label={t('order.paintCode')} placeholder="LA7W / 9102" upper mono {...field('paintCode')} />
          </div>
          <label className="field wide formula">
            <span className="field-label">{t('order.formula')}</span>
            <textarea
              rows={4}
              className="mono"
              placeholder={t('order.formulaPh')}
              value={order.paintFormula}
              onChange={(e) => update({ paintFormula: e.target.value })}
            />
          </label>
          <label className="field wide formula">
            <span className="field-label">{t('order.paintNotes')}</span>
            <textarea
              rows={2}
              placeholder={t('order.paintNotesPh')}
              value={order.paintNotes}
              onChange={(e) => update({ paintNotes: e.target.value })}
            />
          </label>
        </section>

        <section className="panel">
          <h2>{t('order.client')}</h2>
          <div className="grid">
            <Field label={t('order.clientName')} {...field('client')} />
            <Field label={t('order.phone')} type="tel" inputMode="tel" placeholder="+48" {...field('phone')} />
            <Field
              label={t('order.email')}
              type="email"
              inputMode="email"
              placeholder="jan@example.pl"
              wide
              {...field('email')}
              onBlur={() => order.email && update({ email: order.email.trim() })}
              check={checkEmail(order.email)}
            />
          </div>
          <ClientRatingBlock
            order={order}
            orders={allOrders}
            by={sync.user?.name || sync.user?.login || ''}
            onChange={(clientRating) => update({ clientRating })}
          />
          <ConsentBlock consent={order.consent} onChange={(consent) => update({ consent })} />
        </section>

        <IntakePanel intake={order.intake} onChange={(intake) => update({ intake })} />

        <section className="panel">
          <h2>
            {t('order.body')} — {t(`body.${order.bodyType}`)}
          </h2>
          <div className="seg-row no-print">
            {BODY_TYPES.map((b) => (
              <button key={b} className={'seg' + (order.bodyType === b ? ' active' : '')} onClick={() => changeBody(b)}>
                {t(`body.${b}`)}
              </button>
            ))}
          </div>
          <p className="hint no-print">{t('order.bodyHint')}</p>
          <BodyMap elements={order.elements} onSelect={setSheet} selected={sheet} bodyType={order.bodyType} />
          <div className="legend">
            {(usedWorks.length ? usedWorks : WORKS).map((w) => (
              <span key={w.id} className="legend-item">
                <span className="swatch" style={{ background: w.color }} />
                {t(`work.${w.id}`)}
              </span>
            ))}
            <span className="legend-item">
              <span className="swatch round" style={{ background: DAMAGE_COLOR }} />
              {t('damage.legend')}
            </span>
          </div>
        </section>

        {damaged.length > 0 && (
          <section className="panel">
            <h2>{t('damage.title')} ({damaged.length})</h2>
            <ul className="work-summary">
              {damaged.map((e) => (
                <li key={e.id} onClick={() => setSheet(e.id)}>
                  <div className="ws-title">
                    <span>{t(`el.${e.key}`)}</span>
                  </div>
                  <div className="ws-works">
                    {order.elements[e.id].damage!.map((d) => (
                      <span key={d} className="chip damage-chip">{t(`damage.${d}`)}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>
            {t('order.works')} {withWorks.length ? `(${withWorks.length})` : ''}
          </h2>
          {withWorks.length === 0 ? (
            <p className="muted">{t('order.noElements')}</p>
          ) : (
            <ul className="work-summary">
              {withWorks.map((e) => {
                const v = order.elements[e.id]
                const sum = elementTotal(v)
                return (
                  <li key={e.id} onClick={() => setSheet(e.id)}>
                    <div className="ws-title">
                      <span>{t(`el.${e.key}`)}</span>
                      {sum > 0 && <span className="ws-sum">{formatMoney(sum)}</span>}
                    </div>
                    <div className="ws-works">
                      {v.works.map((w) => (
                        <span key={w} className="chip" style={{ borderColor: WORK_BY_ID[w].color }}>
                          <span className="swatch" style={{ background: WORK_BY_ID[w].color }} />
                          {t(`work.${w}`)}
                          {v.prices?.[w] ? <span className="chip-price">{formatMoney(v.prices[w])}</span> : null}
                        </span>
                      ))}
                      {v.parts ? (
                        <span className="chip">
                          🔩 {t('tot.parts')}
                          <span className="chip-price">{formatMoney(v.parts)}</span>
                        </span>
                      ) : null}
                    </div>
                    {v.note ? <div className="ws-note">{v.note}</div> : null}
                    {v.photos?.length || v.photosAfter?.length ? (
                      <div className="ws-photos" onClick={(ev) => ev.stopPropagation()}>
                        {v.photos?.length ? <PhotoStrip ids={v.photos} /> : null}
                        {v.photosAfter?.length ? (
                          <>
                            <span className="field-label">{t('sheet.photosAfter')}</span>
                            <PhotoStrip ids={v.photosAfter} />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {withWorks.length > 0 && (
            <TotalsView totals={totals} discount={order.discount} onDiscount={(discount) => update({ discount })} />
          )}
        </section>

        <section className="panel">
          <h2>{t('order.notes')}</h2>
          <textarea rows={3} placeholder={t('order.notesPh')} value={order.notes} onChange={(e) => update({ notes: e.target.value })} />
        </section>

        <WalkaroundPanel order={order} onChange={(walkaround) => update({ walkaround })} />

        <SignaturesPanel order={order} master={sync.user?.name || sync.user?.login || ''} onChange={setSignature} />

        <ReviewPanel order={order} />

        <HistoryPanel orderId={order.id} />

        <div className="print-only signatures">
          <span>{t('doc.signClient')}: ____________________</span>
          <span>{t('doc.signMaster')}: ____________________</span>
        </div>

        <div className="actions no-print">
          <button className="btn danger" onClick={remove}>{t('order.delete')}</button>
        </div>
      </main>

      {sheet && sheetEl && (
        <ElementSheet
          key={sheet}
          label={t(`el.${sheetEl.key}`)}
          value={order.elements[sheet]}
          onChange={(v) => setElement(sheet, v)}
          onClose={() => setSheet(null)}
        />
      )}
      {share && <ShareSheet order={order} onClose={() => setShare(false)} />}
      <VoiceFab order={order} onApply={update} />
    </div>
  )
}
