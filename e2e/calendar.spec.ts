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
  // у каждой машины — своя линия: в день приёмки зелёная, к дню выдачи красная
  const colors = async (plate: string) => {
    const bars = page.locator(`.span-bar[title^="${plate}"]`)
    await expect(bars.first()).toBeAttached()
    const all = (await bars.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor)))
      .join(' ')
      .match(/rgb\(\d+, \d+, \d+\)/g)!
      .map((c) => c.match(/\d+/g)!.map(Number))
    return { first: all.find((c) => c.some((v) => v > 0))!, last: all.findLast((c) => c.some((v) => v > 0))! }
  }
  for (const plate of ['SP 40001', 'SP 40002']) {
    const { first, last } = await colors(plate)
    expect(first[1]).toBeGreaterThan(first[0]) // зелёный
    if (plate === 'SP 40001') expect(last[0]).toBeGreaterThan(last[1]) // красный к выдаче
  }

  // сегодня — обе машины в списке
  const list = page.locator('.cal-orders')
  await expect(list).toContainText('SP 40001')
  await expect(list).toContainText('SP 40002')
  await expect(list).toContainText(/осталось 2 дн\./)
  await page.screenshot({ path: 'test-results/calendar-span.png', fullPage: true })
})
