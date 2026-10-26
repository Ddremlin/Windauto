export type WorkId =
  | 'replace'
  | 'repair'
  | 'paint_partial'
  | 'paint_full'
  | 'polish'
  | 'rr'
  | 'plastic'
  | 'pdr'
  | 'weld'

// повреждения, которые уже были при приёмке (ремонт не заказан)
export type DamageId = 'scratch' | 'dent' | 'chip' | 'crack' | 'rust' | 'broken'

// done — «готов к выдаче» (id сохранён ради старых заказов)
export type OrderStatus = 'new' | 'in_work' | 'waiting_parts' | 'done' | 'issued'

export type BodyType = 'sedan' | 'hatchback' | 'wagon' | 'suv' | 'coupe' | 'pickup'

export interface ElementWork {
  works: WorkId[]
  // предварительная стоимость по каждому виду работ, zł
  prices?: Partial<Record<WorkId, number>>
  // запчасти по элементу, zł
  parts?: number
  // уже имеющиеся повреждения
  damage?: DamageId[]
  note?: string
  // id фото в IndexedDB: до ремонта и после
  photos?: string[]
  photosAfter?: string[]
}

export interface Signature {
  // PNG data URL
  img: string
  at: number
  name?: string
  // отпечаток подписанного содержимого — чтобы заметить правки после подписи
  hash?: string
}

export type SignatureKind = 'acceptClient' | 'acceptMaster' | 'issueClient'

export type IntakeItem =
  | 'docs'
  | 'service_book'
  | 'spare_wheel'
  | 'repair_kit'
  | 'jack'
  | 'first_aid'
  | 'extinguisher'
  | 'triangle'
  | 'vest'
  | 'child_seat'
  | 'parcel_shelf'
  | 'mats'
  | 'radio_panel'
  | 'charging_cable'

export interface Intake {
  // уровень топлива / заряда в восьмых: 0 — пусто, 8 — полный бак
  fuel?: number
  keys?: number
  items: IntakeItem[]
  // что осталось в салоне
  belongings?: string
}

export interface Consent {
  // клиент ознакомился с информацией об обработке данных (RODO)
  rodo: boolean
  // согласие на связь по SMS / WhatsApp / e-mail по заказу
  contact: boolean
  at?: number
}

export interface Order {
  id: string
  // номер заказа «2026/0142»; пусто — ещё не выдан (выдаёт сервер)
  number: string
  createdAt: number
  updatedAt: number
  status: OrderStatus
  plate: string
  plateCountry: string
  vin: string
  make: string
  model: string
  year: string
  mileage: string
  color: string
  paintCode: string
  paintFormula: string
  paintNotes: string
  bodyType: BodyType
  client: string
  phone: string
  email: string
  notes: string
  // ответственный сотрудник (имя) и срок готовности YYYY-MM-DD
  assignee: string
  dueDate: string
  // скидка на всё, %
  discount: number
  intake: Intake
  consent: Consent
  signatures: Partial<Record<SignatureKind, Signature>>
  elements: Record<string, ElementWork>
  // время последнего изменения каждого поля (для слияния правок с разных телефонов):
  // ключ — имя поля или «el:<id элемента>»
  _ft?: Record<string, number>
}
