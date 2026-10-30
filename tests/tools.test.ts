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

test('клиенты: один телефон в разной записи — один клиент, средняя оценка', async () => {
  const { clientKey, clientProfiles, isRisky } = await import('../src/clients.ts')
  const o = (id: string, phone: string, client: string, stars?: number, at = 0) =>
    ({ id, phone, client, clientRating: stars ? { stars, note: `n${id}`, at } : undefined }) as never
  assert.equal(clientKey(o('1', '+48 600-100-200', '')), clientKey(o('2', '600100200', 'Jan')))
  assert.equal(clientKey(o('3', '', '  Jan  Kowalski ')), 'name:jan kowalski')
  assert.equal(clientKey(o('4', '', 'J')), '')
  // ни имени, ни телефона — по номеру машины
  assert.equal(clientKey({ phone: '', client: '', plate: 'W8 586E' }), 'car:W8586E')
  const p = clientProfiles([o('1', '600100200', 'Jan', 1, 5), o('2', '+48600100200', 'Jan', 2, 9), o('3', '600100200', 'Jan')])
  const jan = p.get('tel:600100200')!
  assert.equal(jan.orders, 3)
  assert.equal(jan.avg, 1.5)
  assert.equal(jan.last?.note, 'n2')
  assert.equal(isRisky(jan), true)
})

test('клиенты: список с последними контактами, свежие сверху', async () => {
  const { listClients } = await import('../src/clients.ts')
  const o = (id: string, createdAt: number, phone: string, client: string, email = '') => ({ id, createdAt, phone, client, email, plate: '', make: '', model: '', plateCountry: 'PL' }) as never
  const list = listClients([o('a', 1, '600100200', 'Jan', 'old@x.pl'), o('b', 5, '+48 600 100 200', '', 'new@x.pl'), o('c', 3, '', 'Anna Nowak')])
  assert.equal(list.length, 2)
  assert.equal(list[0].key, 'tel:600100200')
  assert.equal(list[0].name, 'Jan')
  assert.equal(list[0].email, 'new@x.pl')
  assert.deepEqual(list[0].orders.map((x: { id: string }) => x.id), ['b', 'a'])
  assert.equal(list[1].name, 'Anna Nowak')
})

test('клиенты: машины без повторов', async () => {
  const { carsOf } = await import('../src/clients.ts')
  const o = (make: string, model: string, plate: string) => ({ make, model, plate, plateCountry: 'PL' }) as never
  const cars = carsOf([o('MINI', 'Cooper', 'WA 12345'), o('', '', 'wa12345'), o('Škoda', 'Octavia', ''), o('Škoda', 'Octavia', ''), o('', '', '')])
  assert.deepEqual(cars.map((c: { car: string }) => c.car), ['MINI Cooper', 'Škoda Octavia'])
})

test('напоминания: свои, невыполненные, по времени напоминания', async () => {
  const { beforeParts, myReminders, notifId, remindAt } = await import('../src/reminders.ts')
  const r = (id: string, at: number, before: number, user = '', done = false) => ({ id, at, before, note: '', user, done })
  const orders = [
    { id: 'a', reminders: [r('1', 10_000_000, 60, 'jan'), r('2', 9_000_000, 0, 'anna'), r('3', 5_000_000, 0, 'jan', true)] },
    { id: 'b', reminders: [r('4', 8_000_000, 1440)] },
  ] as never
  assert.deepEqual(myReminders(orders, 'jan').map((d: { r: { id: string } }) => d.r.id), ['4', '1'])
  assert.equal(remindAt(r('x', 10_000_000, 60)), 10_000_000 - 3_600_000)
  assert.deepEqual(beforeParts(2880), { n: 2, unit: 'd' })
  assert.deepEqual(beforeParts(120), { n: 2, unit: 'h' })
  assert.deepEqual(beforeParts(15), { n: 15, unit: 'min' })
  assert.equal(notifId('abc'), notifId('abc'))
  assert.ok(notifId('abc') > 0 && notifId('abc') <= 0x7fffffff)
})

test('таблица .ods: строка заголовков, по строке на заказ', async () => {
  const { readFile } = await import('node:fs/promises')
  const { readOds, sheetBlocks } = await import('../src/sheetImport.ts')
  const f = await readFile(new URL('./fixtures/orders.ods', import.meta.url))
  const sheets = await readOds(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength))
  const { blocks, skipped } = sheetBlocks(sheets[0])
  assert.equal(skipped, 0)
  assert.deepEqual(blocks.map((b) => b.row), [2, 3, 5])
  const [a, b, c] = blocks.map((b) => parseOrderText(b.text))
  assert.equal(a.plate, 'WA 12345')
  assert.equal(a.make, 'Škoda')
  assert.equal(a.client, 'Jan Kowalski')
  assert.equal(a.phone, '600100200')
  assert.equal(a.dueDate, '2026-11-05')
  // незнакомый столбец — с названием в примечания, «Lp.» пропущен
  assert.equal(a.notes, 'zderzak przedni\nrysa na drzwiach\nKwota: 1200')
  assert.equal(b.client, 'Anna & Co')
  // LibreOffice сам сделал из телефона число — остаются цифры
  assert.equal(b.phone, '48601200300')
  assert.equal(c.model, 'Cooper')
  assert.equal(c.notes, 'lakierowanie maski')
})

test('таблица .ods: повторы клеток и строк, даты, длинные числа, примечания к клетке', async () => {
  const { parseOdsXml } = await import('../src/sheetImport.ts')
  const cell = (v: string, a = '') => `<table:table-cell${a}><text:p>${v}</text:p></table:table-cell>`
  const xml =
    `<table:table table:name="L1"><table:table-row>${cell('A')}<table:table-cell table:number-columns-repeated="3"/>${cell('B', ' table:number-columns-repeated="2"')}` +
    `<table:table-cell table:number-columns-repeated="16000"/></table:table-row>` +
    `<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>` +
    `<table:table-row>${cell('5 lis 2026', ' office:value-type="date" office:date-value="2026-11-05T00:00:00"')}${cell('6,01E+08', ' office:value-type="float" office:value="601200300"')}` +
    `<table:table-cell><office:annotation><text:p>не данные</text:p></office:annotation><text:p>x<text:s text:c="2"/>y &amp; z</text:p></table:table-cell></table:table-row></table:table>`
  const [s] = parseOdsXml(xml)
  assert.equal(s.name, 'L1')
  assert.deepEqual(s.rows[0].cells, ['A', '', '', '', 'B', 'B'])
  assert.deepEqual(s.rows[1].cells, [])
  assert.equal(s.rows[2].n, 1048002)
  assert.deepEqual(s.rows[2].cells, ['2026-11-05', '601200300', 'x  y & z'])
})

test('таблица .csv: кавычки, разделитель; без заголовков — как текст', async () => {
  const { csvSheet, sheetBlocks } = await import('../src/sheetImport.ts')
  const { blocks } = sheetBlocks(csvSheet('Госномер;Авто;Клиент;Телефон\r\nKR4567A;"BMW X5";"Иван ""Ваня""";600-100-200\r\n'))
  const p = parseOrderText(blocks[0].text)
  assert.equal(p.plate, 'KR 4567A')
  assert.equal(p.make, 'BMW')
  assert.equal(p.model, 'X5')
  assert.equal(p.client, 'Иван "Ваня"')
  // «подпись;значение» столбиком и «---» между заказами
  const t = sheetBlocks(csvSheet('Marka;Audi\nModel;A4\n---\nMarka;VW'))
  assert.equal(t.blocks.length, 2)
  assert.equal(t.blocks[0].table, false)
  assert.equal(parseOrderText(t.blocks[0].text).model, 'A4')
})

test('таблица .xlsx: тот же файл из Excel-формата', async () => {
  const { readFile } = await import('node:fs/promises')
  const { readSheets, sheetBlocks } = await import('../src/sheetImport.ts')
  const f = await readFile(new URL('./fixtures/orders.xlsx', import.meta.url))
  const sheets = await readSheets('Zlecenia.XLSX', f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength), decodeText)
  const { blocks } = sheetBlocks(sheets[0])
  assert.deepEqual(blocks.map((b) => b.row), [2, 3, 5])
  const [a, , c] = blocks.map((b) => parseOrderText(b.text))
  assert.equal(a.plate, 'WA 12345')
  assert.equal(a.make, 'Škoda')
  assert.equal(a.phone, '600100200')
  assert.equal(a.dueDate, '2026-11-05')
  assert.equal(a.notes, 'zderzak przedni\nrysa na drzwiach\nKwota: 1200')
  assert.equal(c.model, 'Cooper')
})

test('таблица .xlsx: общие и встроенные строки, даты по стилю, пропуски', async () => {
  const { parseXlsxSheet } = await import('../src/sheetImport.ts')
  const xml =
    '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:r><x:t>a &amp; </x:t></x:r><x:r><x:t>b</x:t></x:r></x:is></x:c></x:row>' +
    '<x:row r="4"><x:c r="B4" s="1"><x:v>46331</x:v></x:c><x:c r="C4"><x:v>6.012003E8</x:v></x:c><x:c r="D4" s="2"/></x:row></x:sheetData></x:worksheet>'
  const s = parseXlsxSheet('L', xml, ['Marka'], new Set([1]))
  assert.deepEqual(s.rows.map((r) => [r.n, r.cells]), [
    [1, ['Marka', '', 'a & b']],
    [2, []],
    [4, ['', '2026-11-05', '601200300']],
  ])
})

test('языки: украинский и белорусский переведены целиком', async () => {
  const { LANGS, makeT, missingKeys } = await import('../src/i18n.ts')
  for (const l of ['uk', 'be'] as const) {
    assert.deepEqual(missingKeys(l), [], l)
    assert.ok(LANGS.some((x) => x.id === l))
  }
  assert.equal(makeT('uk')('el.hood'), 'Капот')
  assert.equal(makeT('be')('order.client'), 'Кліент')
  assert.equal(makeT('uk')('cl.orders', { n: 3 }), 'замовлень: 3')
})

test('валюта: польский интерфейс — всегда злотый, иначе выбранная', async () => {
  const { currencyOf } = await import('../src/settingsStore.ts')
  const { formatMoney } = await import('../src/works.ts')
  assert.equal(currencyOf({ lang: 'pl', currency: 'EUR' }), 'PLN')
  assert.equal(currencyOf({ lang: 'uk', currency: 'UAH' }), 'UAH')
  assert.equal(currencyOf({ lang: 'ru', currency: 'XXX' as never }), 'PLN')
  assert.equal(formatMoney(12000).replace(/\s/g, ' '), '12 000,00 zł')
})
