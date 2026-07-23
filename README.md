# 2popuga-bot

Telegram-бот для фиксации процедур ухода за попугаями и отправки напоминаний.

Согласованные правила MVP находятся в
[`docs/product-rules.md`](docs/product-rules.md).

## Требования

- Node.js 24 LTS
- npm 11+

## Установка

```shell
npm ci
```

SQLite хранит данные по пути `DATABASE_PATH` (по умолчанию
`./data/2popuga.sqlite`). При первом запуске каталог и схема базы данных
создаются автоматически.

При необходимости скопируйте `.env.example` в `.env` и задайте локальные
значения. Для запуска обязательны `BOT_TOKEN`, `ALLOWED_CHAT_ID`,
`WEBHOOK_BASE_URL` и `WEBHOOK_SECRET`.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запуск приложения в watch-режиме |
| `npm run build` | Сборка TypeScript в `dist/` |
| `npm start` | Запуск собранного приложения |
| `npm test` | Однократный запуск тестов |
| `npm run test:watch` | Запуск тестов в watch-режиме |
| `npm run test:coverage` | Запуск тестов с отчётом о покрытии |
| `npm run lint` | Проверка ESLint |
| `npm run typecheck` | Проверка типов без сборки |

После запуска доступны:

- `GET /healthz` — проверка работы HTTP-процесса;
- `GET /readyz` — проверка регистрации Telegram webhook;
- `POST /telegram/webhook` — приём Telegram updates.

## Production

Production-развёртывание выполняется при push в ветку `production`:

1. GitHub Actions подключается к VPS по SSH.
2. Репозиторий синхронизируется в `/opt/2popuga-bot`.
3. `docker compose up --detach --build` пересобирает и запускает контейнер.
4. Workflow проверяет `https://2popuga.kolyach.me/healthz`.

Контейнер подключается к внешней Docker-сети `kolyachmesite_default`. NGINX
проксирует запросы с `2popuga.kolyach.me` на `http://2popuga-bot:3000`.

Необходимые secrets GitHub Environment `production`:

- `VPS_HOST`;
- `VPS_PORT`;
- `VPS_USER`;
- `VPS_SSH_KEY`;
- `VPS_KNOWN_HOSTS`.
