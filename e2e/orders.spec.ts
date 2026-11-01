// Заказ на телефоне без сервера: создать, отметить работы, найти, пережить перезагрузку, сделать PDF
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createOrder } from './helpers'

test('новый заказ сохраняется и виден в списке после перезагрузки', async ({ page }) => {
  await createOrder(page, { plate: 'WA 12345', make: 'Škoda', client: 'Jan Kowalski', phone: '600100200' })
  await page.getByLabel('Модель').fill('Octavia')
  await page.getByRole('button', { name: 'Назад' }).click()
  const card = page.locator('.card', { hasText: 'WA 12345' })
  await expect(card).toContainText('Škoda Octavia')
  await expect(card).toContainText('Jan Kowalski')
  await page.reload()
  await expect(page.locator('.card', { hasText: 'WA 12345' })).toBeVisible()
})

test('работы по элементу: отметка, цена, счётчик в списке', async ({ page }) => {
  await createOrder(page, { plate: 'KR 777AA' })
  await page.locator('svg g', { has: page.locator('title', { hasText: /^Капот$/ }) }).first().click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Окрас полный').check()
  await sheet.getByLabel('Стоимость: Окрас полный').fill('800')
  await sheet.getByRole('button', { name: 'Готово' }).click()
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.locator('.card', { hasText: 'KR 777AA' })).toContainText('Элементов: 1')
})

test('поиск по номеру и клиенту', async ({ page }) => {
  await createOrder(page, { plate: 'PO 11111', client: 'Anna Nowak' })
  await createOrder(page, { plate: 'GD 22222', client: 'Piotr Lis' })
  await page.goto('/#/')
  const search = page.getByPlaceholder(/Поиск/)
  await search.fill('nowak')
  await expect(page.locator('.card', { hasText: 'PO 11111' })).toBeVisible()
  await expect(page.locator('.card', { hasText: 'GD 22222' })).toBeHidden()
  await search.fill('GD 2')
  await expect(page.locator('.card', { hasText: 'GD 22222' })).toBeVisible()
  await expect(page.locator('.card', { hasText: 'PO 11111' })).toBeHidden()
})

test('документ приёмки: PDF готовится и скачивается', async ({ page }) => {
  await createOrder(page, { plate: 'WE 55555', make: 'Toyota', client: 'Ewa Zielińska' })
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  const sheet = page.getByRole('dialog')
  // первое нажатие готовит PDF, дальше — отправить или скачать
  await sheet.getByRole('button', { name: /Отправить PDF/ }).click()
  const save = sheet.getByRole('button', { name: /Скачать PDF/ })
  await expect(save).toBeVisible({ timeout: 30_000 })
  await expect(sheet).toContainText(/\.pdf/)
  const download = page.waitForEvent('download')
  await save.click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.pdf$/)
  const data = readFileSync(await file.path())
  expect(data.length).toBeGreaterThan(10_000)
  expect(data.subarray(0, 5).toString()).toBe('%PDF-')
})

test('ошибка в приложении уходит отчётом на сервер', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByText('Windauto').first()).toBeVisible()
  const report = page.waitForRequest((r) => r.url().endsWith('/api/errors') && r.method() === 'POST')
  await page.evaluate(() => setTimeout(() => { throw new Error('e2e: проверка отчёта') }))
  const body = (await report).postDataJSON()
  expect(body.message).toBe('Error: e2e: проверка отчёта')
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
  expect((await (await report).response())?.status()).toBe(200)
})
