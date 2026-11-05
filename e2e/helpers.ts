import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/** Вторая компания: регистрация и подтверждение почты по ссылке из письма (письма — в MAIL_OUTBOX) */
export async function newCompany(request: APIRequestContext, email: string, company: string, password = 'haslo1234') {
  const r = await request.post(`${SERVER}/api/register`, { data: { company, name: 'E2E', email, password, lang: 'ru', accept: true } })
  expect(r.ok()).toBeTruthy()
  const mails = readFileSync(join(process.env.E2E_DATA!, 'mail.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const link = new URL(mails.filter((m) => m.to === email).at(-1).text.match(/https?:\/\/\S+/)[0])
  expect((await request.get(SERVER + link.pathname + link.search)).ok()).toBeTruthy()
  return { login: email, password }
}
