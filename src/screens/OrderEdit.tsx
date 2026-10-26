import { useEffect, useRef, useState } from 'react'
import { BODY_TYPES, getLayout } from '../body'
import { MAKES, isKnownModel, modelsOf } from '../cars'
import BodyMap from '../components/BodyMap'
import Combo from '../components/Combo'
import ElementSheet from '../components/ElementSheet'
import Field from '../components/Field'
import { PhotoStrip } from '../components/Photos'
import { PlateInput } from '../components/Plate'
import ShareSheet from '../components/ShareSheet'
import { deletePhotos, orderPhotoIds } from '../photos'
import { useSettings } from '../settings'
import type { BodyType, ElementWork, Order } from '../types'
import { checkEmail, checkPlate, checkVin, formatPlate, normalizeVin } from '../validate'
import { STATUSES, WORKS, WORK_BY_ID, elementTotal, formatMoney, orderTotal } from '../works'

interface Props {
  initial: Order
  onSave: (o: Order) => void
  onDelete: (id: string) => void
  onBack: () => void
}

const hasContent = (o: Order) =>
  Boolean(o.plate || o.vin || o.make || o.model || o.client || o.phone || o.email || o.notes || Object.keys(o.elements).length)

export default function OrderEdit({ initial, onSave, onDelete, onBack }: Props) {
  const { t, locale } = useSettings()
  const [order, setOrder] = useState(initial)
  const [sheet, setSheet] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const modelRef = useRef<HTMLInputElement>(null)

  // заказ изменили на другом телефоне — показываем свежую версию
  useEffect(() => {
    if (initial.updatedAt > order.updatedAt) setOrder(initial)
  }, [initial, order.updatedAt])

  const update = (patch: Partial<Order>) => {
    const next = { ...order, ...patch, updatedAt: Math.max(Date.now(), order.updatedAt + 1) }
    setOrder(next)
    if (hasContent(next)) onSave(next)
  }

  const setElement = (id: string, v: ElementWork | undefined) => {
    const elements = { ...order.elements }
    if (v) elements[id] = v
    else delete elements[id]
    update({ elements })
  }

  const field = (key: keyof Order) => ({
    value: order[key] as string,
    onChange: (v: string) => update({ [key]: v } as Partial<Order>),
  })

  const plateCheck = checkPlate(order.plate, order.plateCountry)
  const vinCheck = checkVin(order.vin)
  const layout = getLayout(order.bodyType)
  const marked = layout.elements.filter((e) => order.elements[e.id])
  const total = orderTotal(order.elements, marked.map((e) => e.id))
  const sheetEl = sheet ? layout.elements.find((e) => e.id === sheet) : undefined
  const usedWorks = WORKS.filter((w) => marked.some((e) => order.elements[e.id].works.includes(w.id)))

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
    deletePhotos(lost.flatMap((id) => order.elements[id].photos ?? []))
    const elements = Object.fromEntries(Object.entries(order.elements).filter(([id]) => ids.has(id)))
    update({ bodyType: b, elements })
  }

  const remove = () => {
    if (confirm(t('order.deleteConfirm'))) {
      deletePhotos(orderPhotoIds(order))
      onDelete(order.id)
      onBack()
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label={t('app.back')} onClick={onBack}>←</button>
        <h1>{order.plate ? formatPlate(order.plate, order.plateCountry) : t('app.new')}</h1>
        <button className="icon-btn" aria-label={t('app.share')} onClick={() => setShare(true)}>⇪</button>
      </header>

      <main className="content">
        <div className="print-only print-head">
          <strong>Windauto — {t('share.title')}</strong>
          <span>{new Date(order.createdAt).toLocaleString(locale)}</span>
        </div>

        <section className="panel">
          <div className="status-bar">
            {STATUSES.map((s) => (
              <button key={s} className={`seg st-${s}` + (order.status === s ? ' active' : '')} onClick={() => update({ status: s })}>
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>{t('order.car')}</h2>
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
            />
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
        </section>

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
          </div>
        </section>

        <section className="panel">
          <h2>
            {t('order.works')} {marked.length ? `(${marked.length})` : ''}
          </h2>
          {marked.length === 0 ? (
            <p className="muted">{t('order.noElements')}</p>
          ) : (
            <ul className="work-summary">
              {marked.map((e) => {
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
                    </div>
                    {v.note ? <div className="ws-note">{v.note}</div> : null}
                    {v.photos?.length ? (
                      <div className="ws-photos" onClick={(ev) => ev.stopPropagation()}>
                        <PhotoStrip ids={v.photos} />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {marked.length > 0 && (
            <div className="grand-total">
              <span>{t('order.total')}</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>{t('order.notes')}</h2>
          <textarea rows={3} placeholder={t('order.notesPh')} value={order.notes} onChange={(e) => update({ notes: e.target.value })} />
        </section>

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
    </div>
  )
}
