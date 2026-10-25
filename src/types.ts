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

export type OrderStatus = 'new' | 'in_work' | 'done'

export type BodyType = 'sedan' | 'hatchback' | 'wagon' | 'suv' | 'coupe' | 'pickup'

export interface ElementWork {
  works: WorkId[]
  // предварительная стоимость по каждому виду работ, zł
  prices?: Partial<Record<WorkId, number>>
  note?: string
  // id фото в IndexedDB
  photos?: string[]
}

export interface Order {
  id: string
  createdAt: number
  updatedAt: number
  status: OrderStatus
  plate: string
  vin: string
  make: string
  model: string
  year: string
  mileage: string
  color: string
  paintCode: string
  paintFormula: string
  bodyType: BodyType
  client: string
  phone: string
  email: string
  notes: string
  elements: Record<string, ElementWork>
}
