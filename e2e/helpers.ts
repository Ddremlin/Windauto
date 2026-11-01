import { expect, type Page } from '@playwright/test'

export const SERVER = 'http://127.0.0.1:18090'
export const ADMIN = { login: 'admin', password: 'e2e-secret1' }

// новый заказ: номер, марка, клиент — и обратно в список
export async function createOrder(page: Page, o: { plate: string; make?: string; client?: string; phone?: string }) {
  await page.goto('/#/')
  await page.getByRole('button', { name: /Принять автомобиль|Новый заказ/ }).first().click()
  await expect(page).toHaveURL(/#\/new/)
  await page.getByLabel('Госномер').fill(o.plate)
  if (o.make) await page.getByLabel('Марка').fill(o.make)
  if (o.client) await page.getByLabel('Имя').fill(o.client)
  if (o.phone) await page.getByLabel('Телефон').fill(o.phone)
  // после первого сохранения заказ получает свой адрес
  await expect(page).toHaveURL(/#\/order\//)
}

export async function connect(page: Page, login = ADMIN.login, password = ADMIN.password) {
  await page.goto('/#/sync')
  await page.getByLabel('Адрес сервера').fill(SERVER)
  await page.getByLabel('Email или логин').fill(login)
  await page.getByRole('textbox', { name: /^Пароль/ }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}
