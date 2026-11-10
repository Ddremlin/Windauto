// Общий поиск: кнопка 🔍 в шапке, клиенты / машины / заказы, «назад» возвращает к результатам
import { expect, test } from '@playwright/test'
import { connect, createOrder } from './helpers'

test('поиск по клиенту, номеру и телефону; из заказа назад — к результатам', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await createOrder(page, { plate: 'GD 70001', make: 'Škoda', client: 'Paweł Łukasik', phone: '600 700 800' })
  await page.goto('/#/')
  await page.getByRole('button', { name: 'Поиск', exact: true }).click()
  await expect(page).toHaveURL(/#\/search/)
  const box = page.getByRole('searchbox', { name: 'Поиск' })
  await box.fill('lukasik')
  const results = page.locator('.search-results')
  await expect(results.getByRole('heading', { name: /Клиенты/ })).toBeVisible()
  await expect(results.getByRole('heading', { name: /Заказы/ })).toBeVisible()
  await expect(results.locator('mark').first()).toHaveText('Łukasik')

  await box.fill('gd7000')
  await expect(results.getByRole('heading', { name: /Машины/ })).toBeVisible()
  await box.fill('+48 600700800')
  await expect(results.locator('.search-hit', { hasText: 'GD 70001' }).first()).toBeVisible()

  await results.getByRole('heading', { name: /Заказы/ }).locator('xpath=following-sibling::button[1]').click()
  await expect(page).toHaveURL(/#\/order\//)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/#\/search\?q=/)
  await expect(box).toHaveValue('+48 600700800')

  await box.fill('nie-ma-takiego')
  await expect(results).toContainText('Ничего не найдено')
})
