// Информация об обработке персональных данных (RODO, ст. 13) для листа приёмки.
// Текст можно заменить своим в Настройках (общие данные сервиса); {shop} — название и адрес.
import type { Lang } from './i18n'
import type { SharedSettings } from './settingsStore'

const DEFAULT: Record<Lang, string> = {
  pl:
    'Administratorem Pani/Pana danych osobowych jest {shop}. Dane przetwarzamy w celu przyjęcia i realizacji zlecenia ' +
    'naprawy pojazdu, kontaktu w sprawie zlecenia oraz wystawienia dokumentów rozliczeniowych (art. 6 ust. 1 lit. b i c RODO). ' +
    'Dane przechowujemy przez okres wymagany przepisami podatkowymi oraz do czasu przedawnienia roszczeń. ' +
    'Przysługuje Pani/Panu prawo dostępu do danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, ' +
    'wniesienia sprzeciwu oraz skargi do Prezesa Urzędu Ochrony Danych Osobowych. ' +
    'Podanie danych jest dobrowolne, ale niezbędne do realizacji zlecenia.',
  ru:
    'Администратор ваших персональных данных — {shop}. Данные обрабатываются для приёма и выполнения заказа на ремонт, ' +
    'связи по заказу и оформления расчётных документов (ст. 6 п. 1 лит. b и c RODO). ' +
    'Данные хранятся в течение срока, требуемого налоговым законодательством, и до истечения срока давности претензий. ' +
    'Вы вправе получить доступ к данным, исправить, удалить их или ограничить обработку, возразить против обработки ' +
    'и подать жалобу Председателю UODO. Предоставление данных добровольно, но необходимо для выполнения заказа.',
  uk:
    'Адміністратор ваших персональних даних — {shop}. Дані обробляються для приймання й виконання замовлення на ремонт, ' +
    "зв'язку щодо замовлення та оформлення розрахункових документів (ст. 6 п. 1 літ. b і c RODO). " +
    'Дані зберігаються протягом строку, якого вимагає податкове законодавство, і до спливу строку давності претензій. ' +
    'Ви маєте право на доступ до даних, їх виправлення, видалення або обмеження обробки, право заперечити проти обробки ' +
    "та подати скаргу Голові UODO. Надання даних добровільне, але необхідне для виконання замовлення.",
  be:
    'Адміністратар вашых персанальных даных — {shop}. Даныя апрацоўваюцца для прыёму і выканання заказа на рамонт, ' +
    'сувязі наконт заказа і афармлення разліковых дакументаў (арт. 6 п. 1 літ. b і c RODO). ' +
    'Даныя захоўваюцца на працягу тэрміну, які патрабуе падатковае заканадаўства, і да заканчэння тэрміну даўнасці прэтэнзій. ' +
    'Вы маеце права на доступ да даных, іх выпраўленне, выдаленне або абмежаванне апрацоўкі, права пярэчыць супраць апрацоўкі ' +
    'і падаць скаргу Старшыні UODO. Прадастаўленне даных добраахвотнае, але неабходнае для выканання заказа.',
  en:
    'The controller of your personal data is {shop}. The data is processed to accept and carry out the vehicle repair order, ' +
    'to contact you about the order and to issue settlement documents (Art. 6(1)(b) and (c) GDPR). ' +
    'The data is kept for the period required by tax law and until claims become time-barred. ' +
    'You have the right to access, rectify or erase your data or restrict its processing, to object to processing ' +
    'and to lodge a complaint with the President of the Personal Data Protection Office (UODO). ' +
    'Providing the data is voluntary but necessary to carry out the order.',
}

const SHOP: Record<Lang, string> = { pl: 'warsztat', ru: 'сервис', uk: 'сервіс', be: 'сэрвіс', en: 'the workshop' }

export function rodoClause(s: Pick<SharedSettings, 'shopName' | 'shopAddress' | 'shopNip' | 'rodoText'>, lang: Lang): string {
  const shop = [s.shopName || SHOP[lang], s.shopAddress, s.shopNip && `NIP ${s.shopNip}`].filter(Boolean).join(', ')
  return (s.rodoText.trim() || DEFAULT[lang]).replaceAll('{shop}', shop)
}
