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

test('камеры: составная iPhone, отдельная сверхширокая', async () => {
  const { classifyCameras, zoomBase } = await import('../src/camera.ts')
  const dev = (label: string, deviceId = label) => ({ kind: 'videoinput' as MediaDeviceKind, deviceId, label })
  // iPhone (английский и русский интерфейс)
  assert.deepEqual(classifyCameras([dev('Front Camera'), dev('Back Camera'), dev('Back Ultra Wide Camera'), dev('Back Triple Camera')]), {
    multi: 'Back Triple Camera',
    ultra: 'Back Ultra Wide Camera',
    backs: ['Back Camera', 'Back Ultra Wide Camera', 'Back Triple Camera'],
  })
  assert.equal(classifyCameras([dev('Двойная широкоугольная камера на задней панели', 'dw'), dev('Камера на передней панели', 'f')]).multi, 'dw')
  // Android: названия без подсказок — сверхширокую не угадываем
  assert.deepEqual(classifyCameras([dev('camera2 0, facing back'), dev('camera2 1, facing front'), dev('camera2 2, facing back')]), {
    multi: undefined,
    ultra: undefined,
    backs: ['camera2 0, facing back', 'camera2 2, facing back'],
  })
  assert.equal(zoomBase('Back Dual Wide Camera'), 2)
  assert.equal(zoomBase('camera2 0, facing back'), 1)
})

test('голос: поля, элементы, цены и примечания', async () => {
  const { applyVoice } = await import('../src/voice.ts')
  const order = {
    plate: '', plateCountry: 'PL', vin: '', make: 'Škoda', model: '', year: '', mileage: '', color: '', paintCode: '',
    paintNotes: '', client: '', phone: '', email: '', notes: 'Ключи у мастера',
    elements: { hood: { works: ['paint_partial'], prices: { paint_partial: 300 } } },
  } as unknown as Order
  const empty = Object.fromEntries(['plate', 'plateCountry', 'vin', 'make', 'model', 'year', 'mileage', 'color', 'paintCode', 'paintNotes', 'client', 'phone', 'email', 'notes'].map((k) => [k, '']))
  const { patch, changes } = applyVoice(
    order,
    {
      fields: { ...empty, plate: 'wa12345', make: 'Škoda', model: 'Octavia', mileage: '154 000 км', year: '2019 год', notes: 'Клиент просит позвонить' },
      elements: [
        { id: 'hood', works: ['paint_full'], damage: ['scratch'], price: 0, note: '' },
        { id: 'bumper_front', works: ['repair', 'paint_partial'], damage: [], price: 900, note: 'трещина снизу' },
        { id: 'no_such', works: ['repair'], damage: [], price: 0, note: '' },
      ],
      confident: true,
    },
    new Set(['hood', 'bumper_front']),
    { paint_full: 1200, repair: 250 },
  )
  assert.equal(patch.plate, formatPlate('WA12345', 'PL'))
  assert.equal(patch.model, 'Octavia')
  assert.equal(patch.make, undefined) // уже такая же — не меняем
  assert.equal(patch.mileage, '154000')
  assert.equal(patch.year, '2019')
  assert.equal(patch.notes, 'Ключи у мастера\nКлиент просит позвонить')
  // окрас полный заменяет частичный; цена из настроек для новой работы
  assert.deepEqual(patch.elements!.hood.works, ['paint_full'])
  assert.equal(patch.elements!.hood.prices!.paint_full, 1200)
  assert.deepEqual(patch.elements!.hood.damage, ['scratch'])
  // две работы и одна цена — цену не угадываем, кладём в комментарий
  assert.deepEqual(patch.elements!.bumper_front.works, ['repair', 'paint_partial'])
  assert.equal(patch.elements!.bumper_front.note, 'трещина снизу, 900 zł')
  assert.equal(patch.elements!.no_such, undefined)
  assert.equal(changes.filter((c) => c.kind === 'element').length, 2)
})
