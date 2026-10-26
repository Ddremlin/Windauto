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
}

export function rodoClause(s: Pick<SharedSettings, 'shopName' | 'shopAddress' | 'shopNip' | 'rodoText'>, lang: Lang): string {
  const shop = [s.shopName || (lang === 'pl' ? 'warsztat' : 'сервис'), s.shopAddress, s.shopNip && `NIP ${s.shopNip}`].filter(Boolean).join(', ')
  return (s.rodoText.trim() || DEFAULT[lang]).replaceAll('{shop}', shop)
}
