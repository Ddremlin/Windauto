import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY, currentValue, formatNum, press, putValue, type CalcState, type Key } from '../src/calc.ts'
import { decodeText, parseDate, parseOrderText, splitOrders } from '../src/textImport.ts'

const run = (keys: string, s: CalcState = EMPTY) =>
  keys.split(' ').reduce((st, k) => press(st, k as Key), s)

test('калькулятор: порядок действий, проценты, знак', () => {
  assert.equal(currentValue(run('2 + 3 * 4 =')), 14)
  assert.equal(currentValue(run('1 0 0 - 2 0 / 4 =')), 95)
  assert.equal(currentValue(run('0 . 1 + 0 . 2 =')), 0.3)
  assert.equal(currentValue(run('2 0 0 + 1 0 % =')), 220)
  assert.equal(currentValue(run('2 0 0 * 1 0 % =')), 20)
  assert.equal(currentValue(run('5 ± * 3 =')), -15)
  // действие подряд заменяет предыдущее
  assert.equal(currentValue(run('8 + * 2 =')), 16)
  // после «=» действие продолжает счёт, цифра — начинает новый
  assert.equal(currentValue(run('2 + 2 = * 3 =')), 12)
  assert.equal(currentValue(run('2 + 2 = 7')), 7)
  assert.equal(run('1 / 0 =').error, true)
  // «⌫» после действия возвращает число
  assert.deepEqual(run('1 2 + back'), { tokens: [], entry: '12' })
  assert.equal(currentValue(putValue(run('5 + 5 ='), 42)), 42)
})

test('калькулятор: вывод чисел', () => {
  assert.equal(formatNum(1234567.5, 'pl-PL').replace(/\s/g, ' '), '1 234 567,5')
  assert.equal(formatNum('-0.', 'ru-RU'), '−0,')
  assert.equal(formatNum('', 'ru-RU'), '0')
})

test('импорт текста: подписи, VIN и телефон без подписей, примечания', () => {
  const p = parseOrderText(
    [
      'Nr rej.: wa12345',
      'Marka: Škoda',
      'Model: Octavia',
      'Rok: 2019 r.',
      'Przebieg: 123 456 km',
      'Klient: Jan Kowalski',
      'TMBJJ7NE8L0123456',
      '+48 600 100 200',
      'jan@example.pl',
      'Termin: 5.11.2026',
      'Uwagi:',
      'zderzak przedni do lakierowania',
      'rysa na drzwiach',
    ].join('\n'),
  )
  assert.equal(p.plate, 'WA 12345')
  assert.equal(p.make, 'Škoda')
  assert.equal(p.year, '2019')
  assert.equal(p.mileage, '123456')
  assert.equal(p.client, 'Jan Kowalski')
  assert.equal(p.vin, 'TMBJJ7NE8L0123456')
  assert.equal(p.phone, '+48 600 100 200')
  assert.equal(p.email, 'jan@example.pl')
  assert.equal(p.dueDate, '2026-11-05')
  assert.equal(p.notes, 'zderzak przedni do lakierowania\nrysa na drzwiach')
})

test('импорт текста: по-русски, лишние строки — в примечания', () => {
  const p = parseOrderText('Госномер: KR 4567A\nКлиент — Иван\nТелефон: 600-100-200\nЦвет: чёрный')
  assert.equal(p.plate, 'KR 4567A')
  assert.equal(p.phone, '600-100-200')
  assert.equal(p.color, 'чёрный')
  assert.equal(p.notes, 'Клиент — Иван')
})

test('импорт текста: несколько заказов, даты, кодировка', () => {
  assert.deepEqual(splitOrders('a: 1\n---\nb: 2\n\n===\n'), ['a: 1', 'b: 2'])
  assert.equal(parseDate('2026-02-30'), '')
  assert.equal(parseDate('31.12', new Date(2026, 0, 1)), '2026-12-31')
  assert.equal(parseDate('1/2/27'), '2027-02-01')
  // «Марка» в Windows-1251
  const cp1251 = new Uint8Array([0xcc, 0xe0, 0xf0, 0xea, 0xe0])
  assert.equal(decodeText(cp1251.buffer), 'Марка')
  // «Zażółć» в Windows-1250
  const cp1250 = new Uint8Array([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6])
  assert.equal(decodeText(cp1250.buffer), 'Zażółć')
})
