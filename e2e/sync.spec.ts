// Два телефона одной компании через настоящий сервер: заказ доходит, правки приходят сами (живые обновления)
import { expect, test, type Browser, type Page } from '@playwright/test'
import { connect, createOrder } from './helpers'

// адреса подключений к живым обновлениям — чтобы проверить, что токена в них нет
const events = new WeakMap<Page, string[]>()

async function phone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const urls: string[] = []
  events.set(page, urls)
  page.on('request', (r) => r.url().includes('/api/events?') && urls.push(r.url()))
  // «перенести заказы с телефона в базу?» и подобные вопросы — соглашаемся
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await expect(page.getByText('admin', { exact: false }).first()).toBeVisible()
  return page
}

test('заказ с одного телефона появляется на другом, правки приходят без перезагрузки', async ({ browser }) => {
  const a = await phone(browser)
  const b = await phone(browser)

  await createOrder(a, { plate: 'WX 10001', make: 'Opel', client: 'Marek Sync' })
  await a.getByRole('button', { name: 'Назад' }).click()

  await b.goto('/#/')
  await expect(b.locator('.card', { hasText: 'WX 10001' })).toContainText('Marek Sync', { timeout: 20_000 })
  // номер заказа выдал сервер
  await expect(b.locator('.card', { hasText: 'WX 10001' })).toContainText(/\d{4}\/\d{4}/)

  // второй телефон уже открыт на списке — новый заказ должен прийти сам
  await createOrder(a, { plate: 'WX 10002', client: 'Live Update' })
  await expect(b.locator('.card', { hasText: 'WX 10002' })).toBeVisible({ timeout: 15_000 })

  // правка клиента — тоже
  await a.getByLabel('Имя').fill('Live Updated')
  await expect(b.locator('.card', { hasText: 'WX 10002' })).toContainText('Live Updated', { timeout: 15_000 })
  // живые обновления — по одноразовому билету, токена входа в адресе нет
  const urls = events.get(b) ?? []
  expect(urls.length).toBeGreaterThan(0)
  for (const u of urls) {
    expect(u).toMatch(/[?&]ticket=/)
    expect(u).not.toMatch(/token=/)
  }
})

test('неверный пароль: вход не проходит, понятная ошибка', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
  await connect(page, 'admin', 'wrong-password')
  await expect(page.getByText(/Неверный логин или пароль|неверн/i).first()).toBeVisible()
})
