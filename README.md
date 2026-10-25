# Windauto

Мобильное веб-приложение для приёмки автомобилей в кузовной ремонт и покраску.

- Госномер (проверка по польскому формату) и VIN (17 символов, без I/O/Q, контрольная цифра)
- Развёртка кузова: нажатие на элемент → виды работ галочками, элемент закрашивается цветом работы
  (несколько работ — полосами)
- Список заказов, статусы, печать листа приёмки, резервная копия в JSON
- Данные хранятся только на устройстве (localStorage)

## Запуск

```bash
npm install
npm run dev        # разработка, http://<ip>:5173
npm run build      # сборка в dist/
npm run preview    # просмотр сборки, http://<ip>:4173
```

Справочники: виды работ — `src/works.ts`, элементы кузова — `src/body.ts`, проверки — `src/validate.ts`.

## Публикация

Сайт: https://ddremlin.github.io/Windauto/

Публикуется автоматически при каждом push в `main` (GitHub Actions, `.github/workflows/deploy.yml`).
Вручную: на GitHub → Actions → Deploy to GitHub Pages → Run workflow.
