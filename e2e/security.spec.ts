// Защита: PIN-код на приложении, двухфакторный вход
import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { ADMIN, SERVER, connect, createOrder } from './helpers'

// код TOTP — как в приложении-аутентификаторе
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const bits = [...secret].map((c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('PIN-код: приложение заперто после перезапуска, неверный PIN не пускает', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await createOrder(page, { plate: 'WX 40001', client: 'PIN Test' })
  await page.goto('/#/sync')
  await page.getByRole('button', { name: /Блокировка приложения PIN-кодом/ }).click()
  await page.getByLabel('Новый PIN (4–8 цифр)').fill('2468')
  await page.getByLabel('PIN ещё раз').fill('2468')
  await page.getByRole('button', { name: 'Включить PIN' }).click()
  await expect(page.getByRole('button', { name: /PIN-код включён/ })).toBeVisible()

  await page.goto('/#/')
  await page.reload()
  await expect(page.getByText('Введите PIN-код')).toBeVisible()
  await expect(page.locator('.card', { hasText: 'WX 40001' })).toBeHidden()
  await page.locator('.pin-input').fill('1111')
  await page.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.getByText('Неверный PIN')).toBeVisible()
  await page.locator('.pin-input').fill('2468')
  await page.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.locator('.card', { hasText: 'WX 40001' })).toBeVisible()
})

test('двухфакторный вход: без кода не войти, с кодом из приложения — входит', async ({ page, request }) => {
  page.on('dialog', (d) => void d.accept())
  const admin = (await (await request.post(`${SERVER}/api/login`, { data: ADMIN })).json()).token
  const auth = { Authorization: `Bearer ${admin}` }
  expect((await request.post(`${SERVER}/api/users`, { headers: auth, data: { login: 'tfa', name: 'TFA', password: 'tfa-pass1', role: 'staff' } })).ok()).toBeTruthy()
  const t = (await (await request.post(`${SERVER}/api/login`, { data: { login: 'tfa', password: 'tfa-pass1' } })).json()).token
  const h = { Authorization: `Bearer ${t}` }
  const { secret } = await (await request.post(`${SERVER}/api/me/totp/setup`, { headers: h, data: { password: 'tfa-pass1' } })).json()
  const step = Math.floor(Date.now() / 30000)
  expect((await request.post(`${SERVER}/api/me/totp/enable`, { headers: h, data: { code: totp(secret, step) } })).ok()).toBeTruthy()

  await connect(page, 'tfa', 'tfa-pass1')
  await expect(page.getByText('Введите код из приложения-аутентификатора')).toBeVisible()
  await page.getByLabel('Код из приложения-аутентификатора').fill(totp(secret, step + 1))
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible({ timeout: 15_000 })
})
