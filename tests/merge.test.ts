import assert from 'node:assert/strict'
import { test } from 'node:test'
// одинаковые сценарии — для клиента и для сервера
import * as client from '../src/merge.ts'
import * as server from '../server/merge.mjs'
import type { Order } from '../src/types.ts'

const base = (): Order =>
  ({
    id: 'o1', number: '2026/0001', createdAt: 1, updatedAt: 100, status: 'new',
    plate: 'WA 12345', plateCountry: 'PL', vin: '', make: 'Škoda', model: 'Octavia', year: '', mileage: '',
    color: '', paintCode: '', paintFormula: '', paintNotes: '', bodyType: 'sedan',
    client: '', phone: '', email: '', notes: '', assignee: '', dueDate: '', discount: 0,
    intake: { items: [] }, consent: { rodo: false, contact: false }, signatures: {}, elements: {},
  }) as Order

for (const [name, m] of [['client', client], ['server', server]] as const) {
  test(`${name}: правки разных полей не теряются`, () => {
    const a = client.stampChanges(base(), { ...base(), phone: '+48 600', updatedAt: 200 })
    const b = client.stampChanges(base(), { ...base(), paintCode: 'LA7W', updatedAt: 300 })
    const r = m.mergeOrders(a, b)
    assert.equal(r.phone, '+48 600')
    assert.equal(r.paintCode, 'LA7W')
    assert.equal(r.updatedAt, 300)
    assert.deepEqual(m.mergeOrders(b, a).phone, '+48 600')
  })

  test(`${name}: одно поле — побеждает более позднее изменение`, () => {
    const a = client.stampChanges(base(), { ...base(), client: 'Jan', updatedAt: 300 })
    const b = client.stampChanges(base(), { ...base(), client: 'Anna', updatedAt: 200 })
    assert.equal(m.mergeOrders(a, b).client, 'Jan')
    assert.equal(m.mergeOrders(b, a).client, 'Jan')
  })

  test(`${name}: элементы кузова сливаются по отдельности, удаление элемента сохраняется`, () => {
    const start = { ...base(), elements: { door_f_l: { works: ['repair'] }, hood: { works: ['polish'] } } } as Order
    const a = client.stampChanges(start, { ...start, elements: { ...start.elements, bumper_f: { works: ['paint_full'] } }, updatedAt: 200 } as Order)
    const bEls = { ...start.elements } as Order['elements']
    delete bEls.hood
    const b = client.stampChanges(start, { ...start, elements: bEls, updatedAt: 300 })
    const r = m.mergeOrders(a, b)
    assert.deepEqual(Object.keys(r.elements).sort(), ['bumper_f', 'door_f_l'])
  })

  test(`${name}: подписи — разные виды не затирают друг друга`, () => {
    const s = { img: 'data:', at: 1 }
    const a = client.stampChanges(base(), { ...base(), signatures: { acceptClient: s }, updatedAt: 200 })
    const b = client.stampChanges(base(), { ...base(), signatures: { acceptMaster: s }, updatedAt: 250 })
    assert.deepEqual(Object.keys(m.mergeOrders(a, b).signatures).sort(), ['acceptClient', 'acceptMaster'])
  })

  test(`${name}: без отметок (старая версия) — побеждает более новый заказ`, () => {
    const a = { ...base(), phone: '1', updatedAt: 200 }
    const b = { ...base(), notes: 'x', updatedAt: 300 }
    const r = m.mergeOrders(a, b)
    assert.equal(r.notes, 'x')
    assert.equal(r.phone, '')
  })

  test(`${name}: sameOrder не зависит от порядка ключей и updatedAt`, () => {
    const a = base()
    const b = Object.fromEntries(Object.entries(base()).reverse()) as unknown as Order
    assert.ok(m.sameOrder(a, { ...b, updatedAt: 999 }))
    assert.ok(!m.sameOrder(a, { ...b, plate: 'X' }))
  })
}

test('stampChanges помечает только изменённые поля', () => {
  const a = base()
  const b = client.stampChanges(a, { ...a, vin: 'X', elements: { hood: { works: ['polish'] } }, updatedAt: 500 })
  assert.deepEqual(b._ft, { vin: 500, 'el:hood': 500 })
  assert.equal(client.stampChanges(undefined, a), a)
})
