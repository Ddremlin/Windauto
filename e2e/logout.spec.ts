// Выход и закрытая сессия: заказы компании не остаются видны на устройстве
import { expect, test } from '@playwright/test'
import { ADMIN, SERVER, connect, createOrder } from './helpers'

test('после выхода заказов на устройстве нет, после входа они возвращаются с сервера', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await expect(page.getByText('admin', { exact: false }).first()).toBeVisible()
  await createOrder(page, { plate: 'WX 20001', client: 'Logout Test' })
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.locator('.card', { hasText: 'WX 20001' })).toContainText(/\d{4}\/\d{4}/, { timeout: 15_000 })

  await page.goto('/#/sync')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()
  await page.goto('/#/')
  await page.reload()
  await expect(page.locator('.card', { hasText: 'WX 20001' })).toHaveCount(0)

  await connect(page)
  await page.goto('/#/')
  await expect(page.locator('.card', { hasText: 'WX 20001' })).toBeVisible({ timeout: 15_000 })
})

test('сессию закрыли с другого устройства — вместо заказов экран входа', async ({ page, request }) => {
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await page.goto('/#/')
  await expect(page.locator('.card', { hasText: 'WX 20001' })).toBeVisible({ timeout: 15_000 })

  // «выйти на всех остальных устройствах» с другого входа
  const login = await request.post(`${SERVER}/api/login`, { data: ADMIN })
  const { token } = await login.json()
  await request.post(`${SERVER}/api/logout/others`, { headers: { Authorization: `Bearer ${token}` }, data: {} })

  await page.reload()
  await expect(page.getByText('Вход закрыт', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.card')).toHaveCount(0)
  await page.goto('/#/order/x')
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible()

  // войти снова — заказы на месте
  await connect(page)
  await page.goto('/#/')
  await expect(page.locator('.card', { hasText: 'WX 20001' })).toBeVisible({ timeout: 15_000 })
})
