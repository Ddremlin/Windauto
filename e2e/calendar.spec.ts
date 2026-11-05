// Календарь «Ремонт»: машина — полоска от приёмки до срока, по нажатию на день — все машины этого дня
import { expect, test } from '@playwright/test'
import { connect, createOrder } from './helpers'

const day = (n: number) => {
  const d = new Date(Date.now() + n * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('полоски машин в ремонте и список машин по дню', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await connect(page)
  await expect(page.getByText('admin', { exact: false }).first()).toBeVisible()
  for (const [plate, due] of [['SP 40001', 2], ['SP 40002', 9]] as const) {
    await createOrder(page, { plate, client: `Span ${plate}` })
    await page.getByLabel('Срок готовности').fill(day(due))
  }
  await page.goto('/#/calendar')
  await page.getByRole('button', { name: 'Ремонт', exact: true }).click()
  const bars = page.locator('.span-bar', { hasText: /SP 4000/ })
  await expect(bars.first()).toBeVisible()
  // ближе к сроку — краснее: у машины со сроком через 2 дня оттенок меньше
  const hue = async (plate: string) =>
    Number((await page.locator('.span-bar', { hasText: plate }).first().evaluate((el) => getComputedStyle(el).getPropertyValue('--color'))).match(/hsl\((\d+)/)![1])
  expect(await hue('SP 40001')).toBeLessThan(await hue('SP 40002'))

  // сегодня — обе машины в списке
  const list = page.locator('.cal-orders')
  await expect(list).toContainText('SP 40001')
  await expect(list).toContainText('SP 40002')
  await expect(list).toContainText(/осталось 2 дн\./)
  await page.screenshot({ path: 'test-results/calendar-span.png', fullPage: true })
})
