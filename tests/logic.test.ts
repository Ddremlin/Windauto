import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signedDigest } from '../src/signed.ts'
import type { Order } from '../src/types.ts'
import { checkPlate, checkVin, formatPlate } from '../src/validate.ts'
import { decodeVin, vinYear } from '../src/vin.ts'
import { orderTotals } from '../src/works.ts'

test('VIN: контрольная цифра и запрещённые буквы', () => {
  assert.equal(checkVin('1M8GDM9AXKP042788').message, 'v.vinOk')
  assert.equal(checkVin('WVWZZZ1KZAW000000').level, 'ok')
  assert.equal(checkVin('WVWZZZ1KZAW00000O').level, 'error')
  assert.equal(checkVin('WVWZZZ').message, 'v.vinLen')
})

test('VIN: марка и год', () => {
  assert.deepEqual(decodeVin('TMBJJ7NE8L0123456', 2026), { make: 'Škoda', year: 2020 })
  assert.deepEqual(decodeVin('WVWZZZAUZKW123456', 2026), { make: 'Volkswagen', year: 2019 })
  // у BMW год в 10-м символе ненадёжен — не предлагаем
  assert.deepEqual(decodeVin('WBA8E9C51GK123456', 2026), { make: 'BMW' })
  assert.deepEqual(decodeVin('JTDKB20U703123456', 2026).make, 'Toyota')
  assert.deepEqual(decodeVin('JTHBA30G900123456', 2026).make, 'Lexus')
  assert.deepEqual(decodeVin('XXX', 2026), {})
  assert.equal(vinYear('A', 2026), 2010)
  assert.equal(vinYear('Y', 2026), 2000)
  assert.equal(vinYear('T', 2026), 2026)
  assert.equal(vinYear('V', 2026), 2027)
  assert.equal(vinYear('W', 2026), 1998)
})

test('номер PL', () => {
  assert.equal(formatPlate('wa12345'), 'WA 12345')
  assert.equal(checkPlate('KR 1AC23').level, 'ok')
  assert.equal(checkPlate('W').level, 'error')
})

const order = (elements: Order['elements'], discount = 0) => ({ elements, discount })

test('смета: брутто-цены, VAT 23%, скидка', () => {
  const t = orderTotals(order({ a: { works: ['repair', 'polish'], prices: { repair: 800, polish: 200, replace: 999 }, parts: 230 } }, 10), { vatRate: 23, pricesGross: true })
  assert.equal(t.labor, 1000) // цена неотмеченной замены не считается
  assert.equal(t.parts, 230)
  assert.equal(t.discount, 123)
  assert.equal(t.gross, 1107)
  assert.equal(t.net, 900)
  assert.equal(t.vat, 207)
})

test('смета: нетто-цены и без VAT', () => {
  const els = { a: { works: ['repair'], prices: { repair: 1000 } } } as Order['elements']
  assert.deepEqual([orderTotals(order(els), { vatRate: 23, pricesGross: false }).gross, orderTotals(order(els), { vatRate: 23, pricesGross: false }).vat], [1230, 230])
  const z = orderTotals(order(els), { vatRate: 0, pricesGross: true })
  assert.equal(z.gross, 1000)
  assert.equal(z.vat, 0)
})

test('отпечаток подписи меняется от работ, но не от фото «после»', () => {
  const o = { plate: 'WA1', elements: { hood: { works: ['polish'], prices: { polish: 100 } } }, intake: { items: [] } } as unknown as Order
  const d = signedDigest(o)
  assert.equal(signedDigest({ ...o, elements: { hood: { ...o.elements.hood, photosAfter: ['x'] } } }), d)
  assert.notEqual(signedDigest({ ...o, elements: { hood: { ...o.elements.hood, prices: { polish: 150 } } } }), d)
  assert.notEqual(signedDigest({ ...o, mileage: '100' }), d)
})
