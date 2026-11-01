// Письма: подтверждение email, сброс пароля, приглашение сотрудника.
// Отправка через Brevo (HTTP API, нужен BREVO_API_KEY). Без ключа письмо только пишется в журнал —
// так сервер работает и до настройки почты. MAIL_OUTBOX — файл, куда дописываются письма (для тестов).
import { appendFileSync } from 'node:fs'

const FROM = process.env.MAIL_FROM || 'noreply@windauto.pl'
const FROM_NAME = process.env.MAIL_FROM_NAME || 'Windauto'

export async function sendMail({ to, subject, text, html, replyTo }, log) {
  if (process.env.MAIL_OUTBOX) appendFileSync(process.env.MAIL_OUTBOX, JSON.stringify({ to, subject, text, replyTo }) + '\n')
  if (!process.env.BREVO_API_KEY) {
    log(`письмо не отправлено (нет BREVO_API_KEY) → ${to}: ${subject}\n${text}`)
    return
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: FROM, name: FROM_NAME }, to: [{ email: to }], subject, textContent: text, htmlContent: html,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
  })
  if (!res.ok) {
    log('ошибка отправки письма', to, res.status, await res.text().catch(() => ''))
    throw new Error('mail')
  }
}

const TEXTS = {
  ru: {
    verify: {
      subject: 'Подтвердите email — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nВы зарегистрировали компанию «${v.company}» в Windauto. Подтвердите email, чтобы войти:`,
      button: 'Подтвердить email',
      foot: 'Ссылка действует 7 дней. Если вы не регистрировались — просто удалите это письмо.',
    },
    reset: {
      subject: 'Восстановление пароля — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nКто-то (надеемся, вы) запросил смену пароля в Windauto. Задайте новый пароль по ссылке:`,
      button: 'Задать новый пароль',
      foot: 'Ссылка действует 1 час. Если вы не запрашивали смену пароля — ничего не делайте, пароль останется прежним.',
    },
    invite: {
      subject: (v) => `Приглашение в ${v.company} — Windauto`,
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nВас добавили сотрудником компании «${v.company}» в Windauto — приложении для приёмки автомобилей. Задайте пароль, чтобы войти:`,
      button: 'Задать пароль',
      foot: 'Ссылка действует 7 дней. Логин для входа — этот email.',
    },
    email: {
      subject: 'Подтвердите новый email — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nВы указали этот адрес для своего аккаунта в компании «${v.company}» в Windauto. Подтвердите его — после этого им можно входить и восстанавливать пароль:`,
      button: 'Подтвердить email',
      foot: 'Ссылка действует 1 день. Если это были не вы — просто удалите это письмо.',
    },
    trial: {
      subject: 'Пробный период Pro заканчивается — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nЧерез ${v.days} дн. у компании «${v.company}» закончится пробный период Pro. Потом Windauto продолжит работать бесплатно: заказы, документы и до 2 сотрудников. Распознавание ИИ, голосовой ввод, видео, логотип в документах и выгрузка станут недоступны.\n\nОформить Pro — 79 zł netto в месяц или 790 zł в год (карта или BLIK):`,
      button: 'Оформить Pro',
      foot: 'Оплатить можно и в приложении: Настройки → Тариф.',
    },
    idle: {
      subject: 'Фото на сервере будут удалены — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nВ компанию «${v.company}» в Windauto никто не заходил ${v.months} мес. На бесплатном тарифе фото неактивных компаний хранятся 6 месяцев: через ${v.days} дн. они будут удалены с сервера (заказы останутся). Чтобы сохранить фото, просто откройте приложение:`,
      button: 'Открыть Windauto',
      foot: 'На тарифе Pro фото хранятся без этого ограничения.',
    },
    exists: {
      subject: 'Вы уже зарегистрированы — Windauto',
      body: (v) => `Здравствуйте${v.name ? ', ' + v.name : ''}!\n\nКто-то пытался зарегистрировать в Windauto новую компанию на этот адрес, но аккаунт с ним уже есть (компания «${v.company}»). Если это были вы и вы не помните пароль — задайте новый:`,
      button: 'Задать новый пароль',
      foot: 'Ссылка действует 1 час. Если это были не вы — ничего не делайте, ваш аккаунт в порядке.',
    },
  },
  pl: {
    verify: {
      subject: 'Potwierdź e-mail — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nZarejestrowałeś firmę „${v.company}” w Windauto. Potwierdź adres e-mail, aby się zalogować:`,
      button: 'Potwierdź e-mail',
      foot: 'Link jest ważny 7 dni. Jeśli to nie Ty się rejestrowałeś — po prostu usuń tę wiadomość.',
    },
    reset: {
      subject: 'Odzyskiwanie hasła — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nOtrzymaliśmy prośbę o zmianę hasła w Windauto. Ustaw nowe hasło, klikając link:`,
      button: 'Ustaw nowe hasło',
      foot: 'Link jest ważny 1 godzinę. Jeśli to nie Ty prosiłeś o zmianę — nic nie rób, hasło pozostanie bez zmian.',
    },
    invite: {
      subject: (v) => `Zaproszenie do ${v.company} — Windauto`,
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nZostałeś dodany jako pracownik firmy „${v.company}” w Windauto — aplikacji do przyjmowania samochodów. Ustaw hasło, aby się zalogować:`,
      button: 'Ustaw hasło',
      foot: 'Link jest ważny 7 dni. Login to ten adres e-mail.',
    },
    email: {
      subject: 'Potwierdź nowy e-mail — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nTen adres został podany dla Twojego konta w firmie „${v.company}” w Windauto. Potwierdź go — potem możesz się nim logować i odzyskiwać hasło:`,
      button: 'Potwierdź e-mail',
      foot: 'Link jest ważny 1 dzień. Jeśli to nie Ty — po prostu usuń tę wiadomość.',
    },
    trial: {
      subject: 'Okres próbny Pro się kończy — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nZa ${v.days} dni firmie „${v.company}” skończy się okres próbny Pro. Potem Windauto będzie działać bezpłatnie: zlecenia, dokumenty i do 2 pracowników. Rozpoznawanie AI, wprowadzanie głosowe, wideo, logo w dokumentach i eksport będą niedostępne.\n\nWykup Pro — 79 zł netto miesięcznie lub 790 zł rocznie (karta lub BLIK):`,
      button: 'Wykup Pro',
      foot: 'Zapłacić możesz też w aplikacji: Ustawienia → Plan.',
    },
    idle: {
      subject: 'Zdjęcia na serwerze zostaną usunięte — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nNikt nie logował się do firmy „${v.company}” w Windauto od ${v.months} mies. W planie bezpłatnym zdjęcia nieaktywnych firm przechowujemy 6 miesięcy: za ${v.days} dni zostaną usunięte z serwera (zlecenia zostaną). Aby je zachować, po prostu otwórz aplikację:`,
      button: 'Otwórz Windauto',
      foot: 'W planie Pro zdjęcia przechowujemy bez tego ograniczenia.',
    },
    exists: {
      subject: 'Masz już konto — Windauto',
      body: (v) => `Dzień dobry${v.name ? ', ' + v.name : ''}!\n\nKtoś próbował zarejestrować w Windauto nową firmę na ten adres, ale konto z tym adresem już istnieje (firma „${v.company}”). Jeśli to Ty i nie pamiętasz hasła — ustaw nowe:`,
      button: 'Ustaw nowe hasło',
      foot: 'Link jest ważny 1 godzinę. Jeśli to nie Ty — nic nie rób, Twoje konto jest bezpieczne.',
    },
  },
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Тема и текст письма вида kind (verify | reset | invite | email) на языке пользователя */
export function mailFor(kind, lang, v) {
  const t = (TEXTS[lang] ?? TEXTS.ru)[kind]
  const subject = typeof t.subject === 'function' ? t.subject(v) : t.subject
  const body = t.body(v)
  const text = `${body}\n\n${v.link}\n\n${t.foot}\n\n— Windauto`
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#15181d">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:12px;padding:24px">
<div style="font-weight:700;font-size:20px;margin-bottom:16px">Windauto</div>
${esc(body).split('\n\n').map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('')}
<p style="margin:20px 0"><a href="${esc(v.link)}" style="display:inline-block;background:#0f62fe;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(t.button)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#6b7280;word-break:break-all">${esc(v.link)}</p>
<p style="margin:0;font-size:13px;color:#6b7280">${esc(t.foot)}</p>
</div></div></body></html>`
  return { subject, text, html }
}
