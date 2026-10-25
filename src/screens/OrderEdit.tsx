import { useState } from 'react'
import { BODY_TYPES, getLayout } from '../body'
import BodyMap from '../components/BodyMap'
import ElementSheet from '../components/ElementSheet'
import Field from '../components/Field'
import { PhotoStrip } from '../components/Photos'
import { deletePhotos, orderPhotoIds } from '../photos'
import type { BodyType, ElementWork, Order, OrderStatus } from '../types'
import { checkPlatePL, checkVin, formatPlate, normalizeVin } from '../validate'
import { STATUS_LABEL, WORKS, WORK_BY_ID, elementTotal, formatMoney, orderTotal } from '../works'

interface Props {
  initial: Order
  onSave: (o: Order) => void
  onDelete: (id: string) => void
  onBack: () => void
}

const hasContent = (o: Order) =>
  Boolean(o.plate || o.vin || o.make || o.model || o.client || o.phone || o.notes || Object.keys(o.elements).length)

export default function OrderEdit({ initial, onSave, onDelete, onBack }: Props) {
  const [order, setOrder] = useState(initial)
  const [sheet, setSheet] = useState<string | null>(null)

  const update = (patch: Partial<Order>) => {
    const next = { ...order, ...patch }
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

  const plateCheck = checkPlatePL(order.plate)
  const vinCheck = checkVin(order.vin)
  const layout = getLayout(order.bodyType)
  const marked = layout.elements.filter((e) => order.elements[e.id])
  const total = orderTotal(order.elements, marked.map((e) => e.id))
  const sheetEl = sheet ? layout.elements.find((e) => e.id === sheet) : undefined

  const changeBody = (t: BodyType) => {
    if (t === order.bodyType) return
    const ids = new Set(getLayout(t).elements.map((e) => e.id))
    const lost = Object.keys(order.elements).filter((id) => !ids.has(id))
    if (lost.length) {
      const names = lost.map((id) => layout.elements.find((e) => e.id === id)?.label ?? id).join(', ')
      if (!confirm(`В кузове «${BODY_TYPES.find((b) => b.id === t)!.label}» нет элементов: ${names}. Отметки по ним будут удалены. Продолжить?`)) return
    }
    deletePhotos(lost.flatMap((id) => order.elements[id].photos ?? []))
    const elements = Object.fromEntries(Object.entries(order.elements).filter(([id]) => ids.has(id)))
    update({ bodyType: t, elements })
  }
  const usedWorks = WORKS.filter((w) => marked.some((e) => order.elements[e.id].works.includes(w.id)))

  const remove = () => {
    if (confirm('Удалить заказ? Это действие нельзя отменить.')) {
      deletePhotos(orderPhotoIds(order))
      onDelete(order.id)
      onBack()
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" aria-label="Назад" onClick={onBack}>←</button>
        <h1>{order.plate ? formatPlate(order.plate) : 'Новый заказ'}</h1>
        <button className="icon-btn" aria-label="Печать" onClick={() => window.print()}>⎙</button>
      </header>

      <main className="content">
        <div className="print-only print-head">
          <strong>Windauto — лист приёмки</strong>
          <span>{new Date(order.createdAt).toLocaleString('ru-RU')}</span>
        </div>

        <section className="panel">
          <div className="status-bar">
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <button
                key={s}
                className={`seg st-${s}` + (order.status === s ? ' active' : '')}
                onClick={() => update({ status: s })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Автомобиль</h2>
          <div className="grid">
            <Field
              label="Госномер (PL)"
              placeholder="WA 12345"
              upper
              mono
              {...field('plate')}
              onBlur={() => order.plate && update({ plate: formatPlate(order.plate) })}
              check={plateCheck}
            />
            <Field
              label="VIN"
              placeholder="17 символов"
              upper
              mono
              wide
              {...field('vin')}
              onBlur={() => order.vin && update({ vin: normalizeVin(order.vin) })}
              check={vinCheck}
            />
            <Field label="Марка" placeholder="Škoda" {...field('make')} />
            <Field label="Модель" placeholder="Octavia" {...field('model')} />
            <Field label="Год" inputMode="numeric" placeholder="2019" {...field('year')} />
            <Field label="Пробег, км" inputMode="numeric" {...field('mileage')} />
          </div>
        </section>

        <section className="panel">
          <h2>Краска</h2>
          <div className="grid">
            <Field label="Цвет" placeholder="Серебристый металлик" {...field('color')} />
            <Field label="Код краски" placeholder="LA7W / 9102" upper mono {...field('paintCode')} />
          </div>
          <label className="field wide formula">
            <span className="field-label">Формула краски</span>
            <textarea
              rows={4}
              className="mono"
              placeholder={'Компонент — количество, г\nнапр.: 9140 — 412.5\n9160 — 38.2'}
              value={order.paintFormula}
              onChange={(e) => update({ paintFormula: e.target.value })}
            />
          </label>
        </section>

        <section className="panel">
          <h2>Клиент</h2>
          <div className="grid">
            <Field label="Имя" {...field('client')} />
            <Field label="Телефон" type="tel" inputMode="tel" placeholder="+48" {...field('phone')} />
          </div>
        </section>

        <section className="panel">
          <h2>Кузов — {BODY_TYPES.find((b) => b.id === order.bodyType)?.label}</h2>
          <div className="seg-row no-print">
            {BODY_TYPES.map((b) => (
              <button key={b.id} className={'seg' + (order.bodyType === b.id ? ' active' : '')} onClick={() => changeBody(b.id)}>
                {b.label}
              </button>
            ))}
          </div>
          <p className="hint no-print">Нажмите на элемент, чтобы отметить работы и стоимость</p>
          <BodyMap elements={order.elements} onSelect={setSheet} selected={sheet} bodyType={order.bodyType} />
          <div className="legend">
            {(usedWorks.length ? usedWorks : WORKS).map((w) => (
              <span key={w.id} className="legend-item">
                <span className="swatch" style={{ background: w.color }} />
                {w.label}
              </span>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Работы {marked.length ? `(${marked.length})` : ''}</h2>
          {marked.length === 0 ? (
            <p className="muted">Элементы не отмечены</p>
          ) : (
            <ul className="work-summary">
              {marked.map((e) => {
                const v = order.elements[e.id]
                return (
                  <li key={e.id} onClick={() => setSheet(e.id)}>
                    <div className="ws-title">
                      <span>{e.label}</span>
                      {elementTotal(v) > 0 && <span className="ws-sum">{formatMoney(elementTotal(v))}</span>}
                    </div>
                    <div className="ws-works">
                      {v.works.map((w) => (
                        <span key={w} className="chip" style={{ borderColor: WORK_BY_ID[w].color }}>
                          <span className="swatch" style={{ background: WORK_BY_ID[w].color }} />
                          {WORK_BY_ID[w].label}
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
              <span>Предварительная стоимость</span>
              <strong>{formatMoney(total)}</strong>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Примечания</h2>
          <textarea rows={3} placeholder="Общие замечания, состояние, договорённости…" value={order.notes} onChange={(e) => update({ notes: e.target.value })} />
        </section>

        <div className="print-only signatures">
          <span>Клиент: ____________________</span>
          <span>Мастер-приёмщик: ____________________</span>
        </div>

        <div className="actions no-print">
          <button className="btn danger" onClick={remove}>Удалить заказ</button>
        </div>
      </main>

      {sheet && sheetEl && (
        <ElementSheet
          key={sheet}
          label={sheetEl.label}
          value={order.elements[sheet]}
          onChange={(v) => setElement(sheet, v)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
