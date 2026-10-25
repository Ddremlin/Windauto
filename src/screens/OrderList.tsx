import { useMemo, useRef, useState } from 'react'
import { exportJson, importJson } from '../storage'
import type { Order } from '../types'
import { formatPlate, normalizePlate } from '../validate'
import { STATUS_LABEL, WORK_BY_ID, formatMoney, orderTotal } from '../works'

interface Props {
  orders: Order[]
  onOpen: (id: string) => void
  onCreate: () => void
  onImport: (list: Order[]) => void
}

export default function OrderList({ orders, onOpen, onCreate, onImport }: Props) {
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const nq = normalizePlate(q)
    const tq = q.trim().toLowerCase()
    const list = [...orders].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!tq) return list
    return list.filter(
      (o) =>
        (nq && (normalizePlate(o.plate).includes(nq) || o.vin.includes(nq))) ||
        `${o.make} ${o.model} ${o.client} ${o.phone}`.toLowerCase().includes(tq),
    )
  }, [orders, q])

  const handleFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const list = await importJson(f)
      if (confirm(`Загрузить ${list.length} заказ(ов)? Текущие данные (${orders.length}) будут заменены.`)) onImport(list)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="brand">Windauto</h1>
        <button className="icon-btn" aria-label="Меню" onClick={() => setMenu((m) => !m)}>⋮</button>
        {menu && (
          <div className="menu" onClick={() => setMenu(false)}>
            <button onClick={() => exportJson(orders)}>Сохранить резервную копию</button>
            <button onClick={() => fileRef.current?.click()}>Загрузить из копии…</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      </header>

      <div className="search">
        <input type="search" placeholder="Поиск: номер, VIN, марка, клиент" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <main className="list">
        {filtered.length === 0 && (
          <div className="empty">
            {orders.length === 0 ? (
              <>
                <p>Пока нет ни одного заказа.</p>
                <button className="btn primary" onClick={onCreate}>Принять автомобиль</button>
              </>
            ) : (
              <p>Ничего не найдено</p>
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
                <span className="plate">{o.plate ? formatPlate(o.plate) : '— без номера —'}</span>
                <span className={`status st-${o.status}`}>{STATUS_LABEL[o.status]}</span>
              </div>
              <div className="card-row muted">
                <span>{[o.make, o.model, o.year].filter(Boolean).join(' ') || 'Марка не указана'}</span>
                <span>{new Date(o.createdAt).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="card-row">
                <span className="muted">
                  {marked.length ? `Элементов: ${marked.length}` : 'Работы не отмечены'}
                  {total > 0 && <strong className="card-sum"> · {formatMoney(total)}</strong>}
                </span>
                <span className="dots">
                  {workIds.map((w) => (
                    <span key={w} className="dot" style={{ background: WORK_BY_ID[w].color }} title={WORK_BY_ID[w].label} />
                  ))}
                </span>
              </div>
            </button>
          )
        })}
      </main>

      {orders.length > 0 && (
        <button className="fab" onClick={onCreate} aria-label="Новый заказ">
          ＋
        </button>
      )}
    </div>
  )
}
