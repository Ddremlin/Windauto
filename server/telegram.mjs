// Сообщения в Telegram через бота: TELEGRAM_BOT_TOKEN (от @BotFather) и TELEGRAM_CHAT_ID (куда слать).
// TELEGRAM_OUTBOX — файл, куда дописываются сообщения (для тестов).
import { appendFileSync } from 'node:fs'

export const telegramReady = () => Boolean((process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || process.env.TELEGRAM_OUTBOX)

export async function sendTelegram(text, log) {
  // у Telegram предел 4096 знаков
  text = text.length > 4000 ? text.slice(0, 4000) + '…' : text
  if (process.env.TELEGRAM_OUTBOX) {
    appendFileSync(process.env.TELEGRAM_OUTBOX, JSON.stringify({ text }) + '\n')
    if (!process.env.TELEGRAM_BOT_TOKEN) return
  }
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  })
  if (!res.ok) {
    log('ошибка отправки в Telegram', res.status, await res.text().catch(() => ''))
    throw new Error('telegram')
  }
}
