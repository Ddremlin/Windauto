import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, highlight, parseQuery, search } from '../src/search.ts'
import type { Order } from '../src/types.ts'

const o = (p: Partial<Order>): Order =>
  ({
    id: Math.random().toString(36).slice(2), number: '', createdAt: 1, updatedAt: 1, status: 'new', plate: '', plateCountry: 'PL', vin: '', make: '', model: '',
    year: '', mileage: '', color: '', paintCode: '', paintFormula: '', paintNotes: '', bodyType: 'sedan', client: '', phone: '', email: '', notes: '',
    assignee: '', dueDate: '', discount: 0, intake: { items: [] }, consent: { rodo: false, contact: false }, signatures: {}, elements: {}, ...p,
  }) as Order

const orders = [
  o({ id: 'a1', number: '2026/0142', plate: 'WA12345', make: 'Škoda', model: 'Octavia', client: 'Jan Kowalski', phone: '600 100 200', createdAt: 3, updatedAt: 3 }),
  o({ id: 'a2', number: '2026/0098', plate: 'WA 12345', make: 'Škoda', model: 'Octavia', client: 'Jan Kowalski', phone: '+48600100200', createdAt: 2, updatedAt: 2 }),
  o({ id: 'b1', number: '2026/0150', plate: 'KR 1AB23', make: 'Toyota', model: 'Corolla', client: 'Paweł Łukasik', email: 'pawel@firma.pl', vin: 'JTDKB20U703123456' }),
  o({ id: 'c1', number: '2026/0151', client: 'Иван Петров', phone: '501 234 567', notes: 'царапина на двери' }),
]

test('поиск: без регистра и польских букв, несколько слов', () => {
  assert.equal(fold('Łukasik ŚCIEŻKA Ёж'), 'lukasik sciezka еж')
  const r = search(orders, 'skoda kowal')
  assert.deepEqual(r.orders.map((x) => x.id), ['a1', 'a2'])
  assert.equal(r.clients.length, 1)
  assert.equal(r.clients[0].orders.length, 2)
  assert.deepEqual(search(orders, 'lukasik').orders.map((x) => x.id), ['b1'])
  assert.deepEqual(search(orders, 'škoda toyota').orders, [])
})

test('поиск: номер с пробелом и без, VIN, № заказа, телефон по цифрам', () => {
  const r = search(orders, 'wa12')
  assert.equal(r.cars.length, 1, 'одна машина, хотя номер записан по-разному')
  assert.equal(r.cars[0].orders.length, 2)
  assert.equal(search(orders, 'WA 123').cars.length, 1)
  assert.deepEqual(search(orders, '0150').orders.map((x) => x.id), ['b1'])
  assert.deepEqual(search(orders, 'JTDKB20').cars.map((c) => c.key), ['KR1AB23'])
  assert.deepEqual(search(orders, '600100200').orders.map((x) => x.id), ['a1', 'a2'])
  assert.deepEqual(search(orders, '+48 600 100').orders.map((x) => x.id).sort(), ['a1', 'a2'])
  assert.deepEqual(search(orders, 'царапина').orders.map((x) => x.id), ['c1'])
  assert.deepEqual(search(orders, '   '), { clients: [], cars: [], orders: [] })
})

test('подсветка совпадений без учёта диакритики', () => {
  assert.deepEqual(highlight('Paweł Łukasik', parseQuery('luk')), [['Paweł ', false], ['Łuk', true], ['asik', false]])
  assert.deepEqual(highlight('Škoda', parseQuery('sko')), [['Ško', true], ['da', false]])
  assert.deepEqual(highlight('abc', parseQuery('')), [['abc', false]])
})
