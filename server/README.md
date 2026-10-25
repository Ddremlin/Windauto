# Сервер Windauto

Общая база заказов и фото для нескольких сотрудников. Node.js 24 + SQLite, без внешних зависимостей;
HTTPS через Caddy (сертификат Let's Encrypt выпускается сам).

## Установка на VPS

Нужен VPS с Ubuntu 22.04/24.04 или Debian 12 (1 ядро, 1 ГБ RAM достаточно), открытые порты 80 и 443.

```bash
scp -r server root@<IP>:/opt/windauto
ssh root@<IP> 'bash /opt/windauto/install.sh'
```

Скрипт поставит Docker, запустит сервер и выведет адрес (`https://<IP>.sslip.io`) и пароль администратора.
Свой домен: `bash install.sh api.example.pl` (DNS-запись A должна указывать на IP сервера).

## В приложении

Настройки → «Общая база» → адрес сервера, логин `admin`, пароль из вывода установки.
Администратор добавляет сотрудников там же, в разделе «Сотрудники».

## Обслуживание

```bash
cd /opt/windauto
docker compose logs -f api        # журнал
docker compose up -d --build      # обновление после замены server.mjs
./backup.sh                       # резервная копия вручную (автоматически — каждую ночь в 03:30)
```

Данные: `data/windauto.db` (база) и `data/photos/` (фото). Копии: `backups/`, хранятся 30 последних.
Восстановление: остановить (`docker compose down`), распаковать архив в `data/`
(`backup.db` переименовать в `windauto.db`), запустить снова.

## API

| Метод | Путь | Назначение |
|---|---|---|
| POST | /api/login | вход, выдаёт токен |
| GET | /api/sync?since=N | изменения новее N |
| POST | /api/sync | отправка изменений (конфликт: побеждает более позднее `updatedAt`) |
| GET | /api/events | SSE-уведомления об изменениях |
| PUT/GET | /api/photos/:id | фото |
| GET/POST/PATCH/DELETE | /api/users | сотрудники (только администратор) |
