import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLayout, innerId, isInner, outerId, partName } from '../src/body.ts'
import { calendarAt, defaultBookingAt, intakeAt, isLate, isPlanned } from '../src/booking.ts'
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

test('смета: дополнительные работы идут в работы и под скидку', () => {
  const els = { a: { works: ['repair'], prices: { repair: 1000 } } } as Order['elements']
  const t = orderTotals({ ...order(els, 10), extras: [{ id: '1', name: 'Мойка', price: 100 }, { id: '2', name: 'Без цены' }] }, { vatRate: 0, pricesGross: true }, [])
  assert.equal(t.labor, 100) // элементы не выбраны, доп. работы считаются всегда
  assert.equal(t.gross, 90)
})

test('отпечаток подписи меняется от работ, но не от фото «после»', () => {
  const o = { plate: 'WA1', elements: { hood: { works: ['polish'], prices: { polish: 100 } } }, intake: { items: [] } } as unknown as Order
  const d = signedDigest(o)
  assert.equal(signedDigest({ ...o, elements: { hood: { ...o.elements.hood, photosAfter: ['x'] } } }), d)
  assert.notEqual(signedDigest({ ...o, elements: { hood: { ...o.elements.hood, prices: { polish: 150 } } } }), d)
  assert.notEqual(signedDigest({ ...o, mileage: '100' }), d)
  assert.equal(signedDigest({ ...o, extras: [] }), d)
  assert.notEqual(signedDigest({ ...o, extras: [{ id: '1', name: 'Мойка', price: 50 }] }), d)
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

test('запись на приёмку: ожидается, опаздывает, приехала', () => {
  const at = Date.parse('2026-03-05T10:00')
  const planned = { createdAt: 1, booking: { at } }
  assert.equal(isPlanned(planned), true)
  assert.equal(calendarAt(planned), at)
  assert.equal(intakeAt(planned), 1)
  assert.equal(isLate(planned, at + 30 * 60_000), false)
  assert.equal(isLate(planned, at + 2 * 3600_000), true)
  const came = { createdAt: 1, booking: { at, arrived: at + 5 } }
  assert.equal(isPlanned(came), false)
  assert.equal(isLate(came, at + 9e9), false)
  assert.equal(intakeAt(came), at + 5)
  assert.equal(calendarAt(came), at + 5)
  assert.equal(isPlanned({}), false)
})

test('запись на приёмку: время по умолчанию', () => {
  const morning = Date.parse('2026-03-05T07:00')
  assert.equal(defaultBookingAt('2026-03-05', morning), Date.parse('2026-03-05T09:00'))
  const later = Date.parse('2026-03-05T13:20')
  assert.equal(defaultBookingAt('2026-03-05', later), Date.parse('2026-03-05T14:00'))
})

test('внутренняя сторона детали: отдельный элемент сразу после своей детали, в названии и сумме', () => {
  const l = getLayout('sedan')
  const i = l.parts.findIndex((e) => e.id === 'door_f_l')
  assert.equal(l.parts[i + 1].id, 'door_f_l_in')
  assert.equal(l.parts[i + 1].inner, true)
  // на схеме внутренних нет, у стёкол и фар внутренней стороны нет
  assert.ok(!l.elements.some((e) => e.inner))
  assert.ok(!l.parts.some((e) => e.id === 'windshield_in' || e.id === 'headlight_l_in'))
  assert.equal(innerId('hood'), 'hood_in')
  assert.equal(outerId('hood_in'), 'hood')
  assert.equal(isInner('hood'), false)
  const t = (k: string) => ({ 'el.door_f_l': 'Дверь передняя левая', 'el.inner': 'изнутри' })[k] ?? k
  assert.equal(partName(t, l.parts[i + 1]), 'Дверь передняя левая — изнутри')
  assert.equal(partName(t, l.parts[i]), 'Дверь передняя левая')
})

test('календарь «Ремонт»: полоска от приёмки до срока, цвет к сроку, ряды в неделе', async () => {
  const { orderSpan, spanColor, weekSegments, spansOn } = await import('../src/calendarSpans.ts')
  const base = { id: 'a', status: 'in_work', createdAt: Date.parse('2026-11-02T10:00'), updatedAt: 1, signatures: {}, dueDate: '2026-11-12' } as unknown as Order
  const a = orderSpan(base, '2026-11-07')
  assert.deepEqual([a.start, a.end, a.state, a.left], ['2026-11-02', '2026-11-12', 'active', 5])
  assert.equal(a.ratio, 0.5)
  // половина пути — жёлтая; за 2 дня до срока — красно-оранжевая, хоть путь только начат
  assert.equal(spanColor(a), 'hsl(60 70% 42%)')
  assert.equal(spanColor(orderSpan({ ...base, createdAt: Date.parse('2026-11-27T10:00'), dueDate: '2026-11-30' }, '2026-11-28')), 'hsl(34 70% 42%)')
  // только приняли, срок через 2 недели — зелёная
  assert.equal(spanColor(orderSpan({ ...base, dueDate: '2026-11-20' }, '2026-11-02')), 'hsl(120 70% 42%)')
  // срок прошёл — до сегодня и тёмно-красная
  const late = orderSpan(base, '2026-11-15')
  assert.deepEqual([late.end, late.state, late.left], ['2026-11-15', 'overdue', -3])
  // выдана по подписи
  const issued = orderSpan({ ...base, status: 'issued', signatures: { issueClient: { img: '', at: Date.parse('2026-11-10T15:00') } } } as Order, '2026-11-20')
  assert.deepEqual([issued.end, issued.state], ['2026-11-10', 'issued'])
  // без срока — до сегодня
  const open = orderSpan({ ...base, dueDate: '' }, '2026-11-05')
  assert.deepEqual([open.end, open.open], ['2026-11-05', true])

  // неделя с понедельника 2026-11-09: две пересекающиеся — в разных рядах, третья встаёт в свободный
  const b = orderSpan({ ...base, id: 'b', createdAt: Date.parse('2026-11-10T09:00'), dueDate: '2026-11-11' } as Order, '2026-11-07')
  const c = orderSpan({ ...base, id: 'c', createdAt: Date.parse('2026-11-13T09:00'), dueDate: '2026-11-20' } as Order, '2026-11-07')
  const w = weekSegments([c, b, a], '2026-11-09')
  assert.equal(w.lanes, 2)
  const by = Object.fromEntries(w.segments.map((g) => [g.span.order.id, g]))
  assert.deepEqual([by.a.col0, by.a.col1, by.a.lane, by.a.head, by.a.tail], [0, 3, 0, false, true])
  assert.deepEqual([by.b.col0, by.b.col1, by.b.lane], [1, 2, 1])
  assert.deepEqual([by.c.col0, by.c.col1, by.c.lane, by.c.tail], [4, 6, 0, false])
  assert.deepEqual(spansOn([a, b, c], '2026-11-11').map((s) => s.order.id), ['b', 'a'])
})

test('календарь «Ремонт»: линия зелёная в день приёмки и красная в день выдачи', async () => {
  const { orderSpan, dayColor, weekSegments, segmentBackground } = await import('../src/calendarSpans.ts')
  const o = { id: 'a', status: 'in_work', createdAt: Date.parse('2026-11-02T10:00'), updatedAt: 1, signatures: {}, dueDate: '2026-11-09' } as unknown as Order
  const s = orderSpan(o, '2026-11-05')
  assert.equal(dayColor(s, '2026-11-02'), 'hsl(120 70% 45%)')
  assert.equal(dayColor(s, '2026-11-09'), 'hsl(0 70% 45%)')
  assert.equal(dayColor(s, '2026-11-10'), 'hsl(0 75% 38%)')
  // неделя 2–8 ноября: линия с понедельника до воскресенья, 7 точек цвета; продолжение — в следующей неделе
  const [g] = weekSegments([s], '2026-11-02').segments
  const bg = segmentBackground(g, '2026-11-02')
  assert.ok(bg.startsWith('linear-gradient(to right, hsl(120 70% 45%) 7.1%'))
  assert.equal(bg.split('hsl(').length - 1, 7)
  const [g2] = weekSegments([s], '2026-11-09').segments
  assert.equal(segmentBackground(g2, '2026-11-09'), 'hsl(0 70% 45%)')
})
