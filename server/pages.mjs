// HTML-страницы, которые открываются по ссылкам из писем (подтверждение email, новый пароль),
// и юридические тексты (политика конфиденциальности, условия использования).
// Данные оператора сервиса — из переменных OPERATOR_* (см. README).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const layout = (lang, title, body) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Windauto</title>
<style>
:root{--bg:#f4ede3;--panel:#fffaf3;--text:#2a1a10;--muted:#7a6a5c;--line:#e2d5c3;--accent:#8a5a2b;--accent-text:#fff;--danger:#d32f2f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#170b03;--panel:#24150a;--text:#f1e6d4;--muted:#b3a28e;--line:#3d2b1c;--accent:#d9b27c;--accent-text:#291204;--danger:#ef5350;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:22px;margin:0 0 12px}h2{font-size:17px;margin:20px 0 6px}p,li{color:var(--text)}.muted{color:var(--muted)}
.brand{font-weight:700;font-size:18px;margin-bottom:16px}label{display:block;margin:12px 0 4px;color:var(--muted);font-size:14px}
input{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
button{width:100%;margin-top:16px;font:inherit;font-weight:600;border:0;border-radius:10px;padding:12px;background:var(--accent);color:var(--accent-text);cursor:pointer}
.error{color:var(--danger)}.ok{font-size:40px}
.show{display:flex;align-items:center;gap:8px;color:var(--text)}.show input{width:auto;margin:0}
</style></head><body><main><div class="brand">Windauto</div><div class="card">${body}</div></main></body></html>`

const T = {
  ru: {
    verified: ['Email подтверждён', 'Вернитесь в приложение Windauto и войдите с этим email и паролем.'],
    badLink: ['Ссылка недействительна', 'Ссылка устарела или уже использована. Запросите новую в приложении.'],
    setPass: 'Задайте пароль',
    newPass: 'Новый пароль',
    resetTitle: 'Новый пароль',
    pass: 'Пароль (минимум 8 символов)',
    pass2: 'Повторите пароль',
    show: 'Показать пароль',
    save: 'Сохранить',
    short: 'Пароль — минимум 8 символов',
    mismatch: 'Пароли не совпадают',
    saved: ['Пароль сохранён', 'Вернитесь в приложение Windauto и войдите с новым паролем.'],
  },
  pl: {
    verified: ['E-mail potwierdzony', 'Wróć do aplikacji Windauto i zaloguj się tym adresem e-mail i hasłem.'],
    badLink: ['Link jest nieważny', 'Link wygasł lub został już użyty. Poproś o nowy w aplikacji.'],
    setPass: 'Ustaw hasło',
    newPass: 'Nowe hasło',
    resetTitle: 'Nowe hasło',
    pass: 'Hasło (co najmniej 8 znaków)',
    pass2: 'Powtórz hasło',
    show: 'Pokaż hasło',
    save: 'Zapisz',
    short: 'Hasło musi mieć co najmniej 8 znaków',
    mismatch: 'Hasła nie są takie same',
    saved: ['Hasło zapisane', 'Wróć do aplikacji Windauto i zaloguj się nowym hasłem.'],
  },
}
export const pageText = (lang) => T[lang] ?? T.ru

export function messagePage(lang, [title, text], ok = true) {
  return layout(lang, title, `${ok ? '<div class="ok">✓</div>' : ''}<h1>${esc(title)}</h1><p>${esc(text)}</p>`)
}

/** Форма нового пароля: по ссылке «восстановить пароль» и по приглашению сотрудника */
export function passwordPage(lang, { token, kind, email, error }) {
  const t = pageText(lang)
  const title = kind === 'invite' ? t.setPass : t.resetTitle
  return layout(
    lang,
    title,
    `<h1>${esc(title)}</h1>${email ? `<p class="muted">${esc(email)}</p>` : ''}
<form method="post" action="/auth/reset">
<input type="hidden" name="t" value="${esc(token)}">
<label for="p1">${esc(t.pass)}</label><input id="p1" name="password" type="password" minlength="8" required autocomplete="new-password">
<label for="p2">${esc(t.pass2)}</label><input id="p2" name="password2" type="password" minlength="8" required autocomplete="new-password">
<label class="show"><input type="checkbox" onchange="for (const i of [p1, p2]) i.type = this.checked ? 'text' : 'password'">${esc(t.show)}</label>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<button type="submit">${esc(t.save)}</button>
</form>`,
  )
}

// --- юридические тексты ---
const op = () => ({
  name: process.env.OPERATOR_NAME || '[название / имя оператора]',
  address: process.env.OPERATOR_ADDRESS || '[адрес]',
  nip: process.env.OPERATOR_NIP || '[NIP]',
  email: process.env.OPERATOR_EMAIL || '[email для связи]',
})

const LEGAL = {
  privacy: {
    pl: (o) => ['Polityka prywatności', `
<p>Administratorem danych konta (adres e-mail, imię, nazwa firmy) jest ${esc(o.name)}, ${esc(o.address)}, NIP ${esc(o.nip)}, kontakt: ${esc(o.email)}.</p>
<h2>Dane klientów warsztatu</h2>
<p>Dane wprowadzane przez firmę korzystającą z Windauto (dane klientów, pojazdów, zdjęcia, podpisy) przetwarzamy wyłącznie w jej imieniu, jako podmiot przetwarzający (art. 28 RODO). Administratorem tych danych jest firma, która je wprowadziła.</p>
<h2>Cel i podstawa</h2>
<p>Dane konta przetwarzamy, aby świadczyć usługę (art. 6 ust. 1 lit. b RODO): logowanie, wysyłka wiadomości o potwierdzeniu adresu i zmianie hasła, bezpieczeństwo.</p>
<h2>Przechowywanie</h2>
<p>Dane są przechowywane na serwerze w Unii Europejskiej (Hetzner, Niemcy/Finlandia). Rozpoznawanie numerów i dokumentów ze zdjęć oraz mowy odbywa się z użyciem usługi Anthropic (USA) — zdjęcie lub tekst są przekazywane tylko w momencie użycia tej funkcji. E-maile wysyłamy przez Brevo (UE).</p>
<p>Dane przechowujemy do czasu usunięcia konta firmy. Usunięcie firmy w aplikacji kasuje wszystkie jej dane z serwera; kopie zapasowe są nadpisywane w ciągu 30 dni.</p>
<h2>Twoje prawa</h2>
<p>Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia oraz wniesienia skargi do Prezesa UODO. Napisz do nas: ${esc(o.email)}.</p>`],
    ru: (o) => ['Политика конфиденциальности', `
<p>Оператор данных аккаунта (email, имя, название компании) — ${esc(o.name)}, ${esc(o.address)}, NIP ${esc(o.nip)}, связь: ${esc(o.email)}.</p>
<h2>Данные клиентов сервиса</h2>
<p>Данные, которые вносит компания, пользующаяся Windauto (клиенты, автомобили, фото, подписи), мы обрабатываем только по её поручению (ст. 28 RODO/GDPR). Распорядитель этих данных — компания, которая их внесла.</p>
<h2>Цель и основание</h2>
<p>Данные аккаунта обрабатываются для оказания услуги (ст. 6 п. 1 б GDPR): вход, письма о подтверждении адреса и смене пароля, безопасность.</p>
<h2>Хранение</h2>
<p>Данные хранятся на сервере в ЕС (Hetzner, Германия/Финляндия). Распознавание номеров, документов и речи выполняется сервисом Anthropic (США) — фото или текст передаются только в момент использования функции. Письма отправляются через Brevo (ЕС).</p>
<p>Данные хранятся до удаления компании. Удаление компании в приложении стирает все её данные с сервера; резервные копии перезаписываются в течение 30 дней.</p>
<h2>Ваши права</h2>
<p>Доступ, исправление, удаление, ограничение обработки, перенос данных, жалоба в UODO. Пишите: ${esc(o.email)}.</p>`],
  },
  terms: {
    pl: (o) => ['Regulamin', `
<p>Usługę Windauto świadczy ${esc(o.name)}, ${esc(o.address)}, NIP ${esc(o.nip)}, kontakt: ${esc(o.email)}.</p>
<h2>Usługa</h2>
<p>Windauto to aplikacja do przyjmowania samochodów do naprawy: protokoły przyjęcia, zdjęcia, podpisy, wspólna baza zleceń dla pracowników firmy. Obecnie usługa jest bezpłatna. O wprowadzeniu opłat poinformujemy z co najmniej 30-dniowym wyprzedzeniem.</p>
<h2>Konto</h2>
<p>Konto firmy zakłada osoba uprawniona do działania w jej imieniu. Właściciel konta odpowiada za dodanych pracowników i za dane wprowadzone do aplikacji, w tym za podstawę prawną przetwarzania danych swoich klientów.</p>
<p>Zabronione jest wykorzystywanie usługi niezgodnie z prawem. W razie naruszeń możemy zablokować konto.</p>
<h2>Odpowiedzialność</h2>
<p>Dokładamy starań, aby usługa działała nieprzerwanie i aby dane były bezpieczne (kopie zapasowe codziennie), ale nie gwarantujemy braku przerw. Zalecamy regularne eksportowanie kopii danych (Ustawienia → Kopia zapasowa).</p>
<h2>Rezygnacja</h2>
<p>Właściciel może w każdej chwili usunąć firmę w ustawieniach aplikacji — wszystkie dane zostaną usunięte.</p>`],
    ru: (o) => ['Условия использования', `
<p>Сервис Windauto предоставляет ${esc(o.name)}, ${esc(o.address)}, NIP ${esc(o.nip)}, связь: ${esc(o.email)}.</p>
<h2>Сервис</h2>
<p>Windauto — приложение для приёмки автомобилей в ремонт: листы приёмки, фото, подписи, общая база заказов для сотрудников компании. Сейчас сервис бесплатный. О введении оплаты сообщим минимум за 30 дней.</p>
<h2>Аккаунт</h2>
<p>Аккаунт компании создаёт человек, уполномоченный действовать от её имени. Владелец аккаунта отвечает за добавленных сотрудников и за внесённые данные, в том числе за законность обработки данных своих клиентов.</p>
<p>Запрещено использовать сервис с нарушением закона. При нарушениях аккаунт может быть заблокирован.</p>
<h2>Ответственность</h2>
<p>Мы стараемся, чтобы сервис работал без перерывов, а данные были в сохранности (ежедневные резервные копии), но не гарантируем отсутствие перерывов. Рекомендуем регулярно сохранять копию данных (Настройки → Резервная копия).</p>
<h2>Отказ</h2>
<p>Владелец может в любой момент удалить компанию в настройках приложения — все данные будут удалены.</p>`],
  },
}

export function legalPage(kind, lang) {
  const doc = LEGAL[kind]
  if (!doc) return null
  const [title, body] = (doc[lang] ?? doc.pl)(op())
  const other = lang === 'ru' ? ['pl', 'Polski'] : ['ru', 'Русский']
  return layout(lang, title, `<h1>${esc(title)}</h1>${body}<p class="muted"><a href="?lang=${other[0]}">${other[1]}</a></p>`)
}

// --- отзыв клиента о ремонте: звёзды и комментарий, без JavaScript ---
const REVIEW = {
  ru: {
    title: 'Оцените ремонт',
    intro: (shop, car) => `${shop ? `«${shop}»` : 'Сервис'} благодарит вас за доверие${car ? ` и ремонт ${car}` : ''}. Пожалуйста, оцените нашу работу.`,
    stars: ['Очень плохо', 'Плохо', 'Нормально', 'Хорошо', 'Отлично'],
    comment: 'Комментарий (необязательно)',
    commentPh: 'Что понравилось, что улучшить',
    send: 'Отправить оценку',
    again: 'Вы уже оценили ремонт — можно изменить оценку.',
    pick: 'Выберите оценку — от 1 до 5 звёзд',
    badLink: ['Ссылка недействительна', 'Ссылка устарела или заказ удалён. Если хотите оставить отзыв, свяжитесь с сервисом.'],
    thanks: ['Спасибо за оценку!', 'Рады, что вам понравилось. Ждём вас снова.'],
    thanksLow: ['Спасибо за оценку', 'Нам жаль, что не всё получилось. Сервис получил ваш отзыв и свяжется с вами.'],
  },
  pl: {
    title: 'Oceń naprawę',
    intro: (shop, car) => `${shop ? `„${shop}”` : 'Warsztat'} dziękuje za zaufanie${car ? ` i naprawę ${car}` : ''}. Prosimy o ocenę naszej pracy.`,
    stars: ['Bardzo źle', 'Źle', 'Przeciętnie', 'Dobrze', 'Doskonale'],
    comment: 'Komentarz (opcjonalnie)',
    commentPh: 'Co się podobało, co poprawić',
    send: 'Wyślij ocenę',
    again: 'Ta naprawa jest już oceniona — możesz zmienić ocenę.',
    pick: 'Wybierz ocenę — od 1 do 5 gwiazdek',
    badLink: ['Link jest nieważny', 'Link wygasł lub zlecenie zostało usunięte. Jeśli chcesz zostawić opinię, skontaktuj się z warsztatem.'],
    thanks: ['Dziękujemy za ocenę!', 'Cieszymy się, że jesteś zadowolony. Zapraszamy ponownie.'],
    thanksLow: ['Dziękujemy za ocenę', 'Przykro nam, że nie wszystko się udało. Warsztat otrzymał Twoją opinię i skontaktuje się z Tobą.'],
  },
}
REVIEW.uk = {
  title: 'Оцініть ремонт',
  intro: (shop, car) => `${shop ? `«${shop}»` : 'Сервіс'} дякує вам за довіру${car ? ` і ремонт ${car}` : ''}. Будь ласка, оцініть нашу роботу.`,
  stars: ['Дуже погано', 'Погано', 'Нормально', 'Добре', 'Відмінно'],
  comment: "Коментар (необов'язково)",
  commentPh: 'Що сподобалося, що покращити',
  send: 'Надіслати оцінку',
  again: 'Ви вже оцінили ремонт — можна змінити оцінку.',
  pick: 'Виберіть оцінку — від 1 до 5 зірок',
  badLink: ['Посилання недійсне', "Посилання застаріло або замовлення видалено. Якщо хочете залишити відгук, зв'яжіться із сервісом."],
  thanks: ['Дякуємо за оцінку!', 'Раді, що вам сподобалося. Чекаємо на вас знову.'],
  thanksLow: ['Дякуємо за оцінку', "Нам шкода, що не все вдалося. Сервіс отримав ваш відгук і зв'яжеться з вами."],
}
REVIEW.be = {
  title: 'Ацаніце рамонт',
  intro: (shop, car) => `${shop ? `«${shop}»` : 'Сэрвіс'} дзякуе вам за давер${car ? ` і рамонт ${car}` : ''}. Калі ласка, ацаніце нашу работу.`,
  stars: ['Вельмі дрэнна', 'Дрэнна', 'Нармальна', 'Добра', 'Выдатна'],
  comment: 'Каментарый (неабавязкова)',
  commentPh: 'Што спадабалася, што палепшыць',
  send: 'Адправіць ацэнку',
  again: 'Вы ўжо ацанілі рамонт — можна змяніць ацэнку.',
  pick: 'Выберыце ацэнку — ад 1 да 5 зорак',
  badLink: ['Спасылка несапраўдная', 'Спасылка састарэла або заказ выдалены. Калі хочаце пакінуць водгук, звяжыцеся з сэрвісам.'],
  thanks: ['Дзякуй за ацэнку!', 'Рады, што вам спадабалася. Чакаем вас зноў.'],
  thanksLow: ['Дзякуй за ацэнку', 'Нам шкада, што не ўсё атрымалася. Сэрвіс атрымаў ваш водгук і звяжацца з вамі.'],
}
REVIEW.en = {
  title: 'Rate the repair',
  intro: (shop, car) => `${shop ? `“${shop}”` : 'The workshop'} thanks you for your trust${car ? ` and for the repair of ${car}` : ''}. Please rate our work.`,
  stars: ['Very bad', 'Bad', 'OK', 'Good', 'Excellent'],
  comment: 'Comment (optional)',
  commentPh: 'What you liked, what to improve',
  send: 'Send rating',
  again: 'You have already rated this repair — you can change the rating.',
  pick: 'Choose a rating — from 1 to 5 stars',
  badLink: ['The link is not valid', 'The link has expired or the order was deleted. If you want to leave a review, please contact the workshop.'],
  thanks: ['Thank you for your rating!', 'We are glad you liked it. See you again.'],
  thanksLow: ['Thank you for your rating', 'We are sorry not everything went well. The workshop has received your review and will contact you.'],
}
export const REVIEW_LANGS = Object.keys(REVIEW)
export const reviewText = (lang) => REVIEW[lang] ?? REVIEW.pl

const STAR_CSS = `<style>
.stars{display:flex;flex-direction:row-reverse;justify-content:center;gap:4px;margin:16px 0 4px}
.stars input{position:absolute;opacity:0;width:1px;height:1px}
.stars label{margin:0;font-size:44px;line-height:1;color:var(--line);cursor:pointer;padding:0 2px}
.stars input:checked~label,.stars label:hover,.stars label:hover~label{color:#f5a623}
.stars input:focus-visible+label{outline:2px solid var(--accent);border-radius:6px}
.star-hint{text-align:center;color:var(--muted);font-size:14px;min-height:21px;margin:0}
textarea{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;resize:vertical}
</style>`

export function reviewPage(lang, { token, shop, car, stars, comment, error }) {
  const t = reviewText(lang)
  // row-reverse: в разметке 5…1, на экране 1…5 слева направо
  const radios = [5, 4, 3, 2, 1]
    .map(
      (n) =>
        `<input type="radio" id="s${n}" name="stars" value="${n}"${stars === n ? ' checked' : ''} required><label for="s${n}" title="${esc(t.stars[n - 1])}" aria-label="${n} — ${esc(t.stars[n - 1])}">★</label>`,
    )
    .join('')
  return layout(
    lang,
    t.title,
    `${STAR_CSS}<h1>${esc(t.title)}</h1><p>${esc(t.intro(shop, car))}</p>
${stars ? `<p class="muted">${esc(t.again)}</p>` : ''}
<form method="post" action="/r/${esc(token)}">
<div class="stars" role="radiogroup" aria-label="${esc(t.title)}">${radios}</div>
<p class="star-hint">${esc(t.stars[0])} — ${esc(t.stars[4])}</p>
<label for="c">${esc(t.comment)}</label>
<textarea id="c" name="comment" rows="4" maxlength="1000" placeholder="${esc(t.commentPh)}">${esc(comment)}</textarea>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<button type="submit">${esc(t.send)}</button>
</form>`,
  )
}
