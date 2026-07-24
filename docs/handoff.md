# Передача контекста разработки

Актуально на 24 июля 2026 года. Рабочая ветка: `develop`.

## Как продолжить на другом ноутбуке

1. Установить Git, Node.js 24 LTS, npm 11+ и Codex.
2. Войти в Codex заново, не копируя каталог `~/.codex` со старого ноутбука.
3. Клонировать репозиторий и открыть его каталог в Codex:

   ```powershell
   git clone https://github.com/mkolya31/2popuga-bot.git
   Set-Location .\2popuga-bot
   git switch develop
   npm ci
   ```

4. Проверить локальный проект:

   ```powershell
   npm test
   npm run lint
   npm run typecheck
   npm run build
   ```

5. В новой задаче Codex попросить прочитать этот файл и продолжить с раздела
   «Следующий шаг».

Для SSH-доступа к VPS на новом ноутбуке нужен отдельный SSH-ключ либо безопасно
перенесённый PuTTY-ключ `vps.ppk`. Приватные ключи нельзя добавлять в Git.

## Что уже настроено

- Репозиторий: `https://github.com/mkolya31/2popuga-bot`.
- Разработка ведётся в `develop`.
- Ветка `production` защищена и принимает изменения только через pull request из
  `develop`.
- Push в `production` запускает GitHub Actions и автоматический деплой на VPS.
- Каталог приложения на VPS: `/opt/2popuga-bot`.
- Пользователь деплоя: `deploy-2popuga`.
- Домен: `https://2popuga.kolyach.me`.
- NGINX работает в Docker и подключён к сети `kolyachmesite_default`.
- Telegram-бот: `@two_popuga_bot`.
- Разрешённая приватная supergroup настроена через `ALLOWED_CHAT_ID` на VPS.
- `/healthz` проверяет HTTP-процесс.
- `/readyz` проверяет готовность Telegram webhook.
- Реализованы Express, grammY webhook и SQLite-миграции.
- Согласованные правила MVP находятся в `docs/product-rules.md`.

## Секреты

Значения секретов в репозитории не хранятся.

- Переменные Telegram и webhook находятся в `/opt/2popuga-bot/.env` на VPS.
- Конфигурация AmneziaWG находится в
  `/opt/2popuga-bot/secrets/amneziawg.conf`.
- Каталог `secrets` исключён из Git и Docker build context.
- Приватный конфигурационный файл VPN и содержимое `.env` не нужно переносить на
  новый ноутбук для продолжения разработки.

## Причина добавления VPN

VPS расположен в России. Исходящее TCP-соединение к
`api.telegram.org:443` напрямую завершается тайм-аутом, хотя другие HTTPS-сайты
доступны. Поддержка Timeweb сообщила, что со своей стороны ограничений нет и
фильтрация происходит на промежуточных магистральных узлах.

Для Telegram-трафика добавлен отдельный Docker-sidecar с AmneziaWG Legacy. Он
делит сетевое пространство только с контейнером бота, поэтому маршруты VPS,
NGINX и остальных сервисов не меняются.

## Подтверждённое production-состояние

VPN и webhook полностью проверены 24 июля 2026 года. Production до текущих
локальных изменений находился на merge-коммите `1d4ab20`.

- Контейнеры `vpn` и `bot` имеют статус `healthy`, перезапусков нет.
- DNS внутри VPN использует `1.1.1.1` и `1.0.0.1`.
- `awg0` устанавливает handshake и передаёт данные.
- На VPS нет kernel-модуля AmneziaWG, поэтому ожидаемо используется
  userspace-реализация `amneziawg-go`.
- Временный Node.js-контейнер в сетевом пространстве VPN получил HTTP 200 от
  `https://api.telegram.org`.
- `/healthz` возвращает `{"status":"ok"}`.
- `/readyz` возвращает `{"status":"ready"}`.
- Telegram webhook зарегистрирован для `@two_popuga_bot`.
- Команда из разрешённой группы дошла как `POST /telegram/webhook` с HTTP 200;
  `pending_update_count` после обработки был равен нулю.
- В production установлена версия `better-sqlite3` 12.11.1.

Строка `Error: Unknown device type.` при старте VPN не является аварией: сразу
после неё `awg-quick` переходит на `amneziawg-go`.

Первый production-запуск уже состоялся, исходная точка расписания сохранена в
SQLite. Docker volume `bot-data` нельзя удалять при обычных деплоях.

## Текущая локальная работа

В рабочем дереве реализован первый пользовательский срез MVP:

- обработка только настроенного `ALLOWED_CHAT_ID`;
- команда `/start` и главная inline-панель;
- отметки замены воды, корма и мытья поддона;
- расчёт следующего срока от фактического времени;
- защита от повторной отметки той же процедуры в течение пяти минут;
- статус всех процедур с учётом исходной точки;
- отмена только автором и только самой новой записи процедуры;
- сохранение отменённых записей для аудита;
- удаление старой кнопки отмены после новой отметки.

Проверки текущего среза:

```text
7 test files passed
57 tests passed
ESLint passed
TypeScript typecheck passed
Production build passed
```

## Следующий шаг

Сначала опубликовать текущий пользовательский срез обычным процессом:

1. проверить diff;
2. создать коммит в `develop` и push;
3. создать pull request `develop` → `production`;
4. дождаться успешного deployment action;
5. проверить `/healthz`, `/readyz`, `docker compose ps` и логи.

Затем выполнить live-проверку в разрешённой Telegram-группе:

1. `/start@two_popuga_bot`;
2. отметить одну процедуру и проверить текст подтверждения и новый срок;
3. нажать ту же кнопку повторно в течение пяти минут и убедиться, что второй
   event не создан;
4. открыть статус;
5. проверить запрет отмены другим участником;
6. отменить запись её автором и проверить пересчитанный срок.

Проверочные записи сохраняются в production SQLite. После теста созданную запись
следует отменить её автором, чтобы вернуть расписание к исходному состоянию.

Следующий этап разработки после live-проверки — напоминания:

- минутная проверка сроков;
- одно жёлтое напоминание при наступлении срока;
- красное напоминание через 24 часа и каждые следующие 24 часа;
- только одно актуальное напоминание после простоя;
- закрытие кнопок всех активных напоминаний после выполнения;
- тесты планировщика с управляемым временем.

## Последние значимые коммиты

```text
7cbb6d4 fix: use prebuilt better-sqlite3 release
2ba780e fix: configure VPN DNS and add development handoff
a83c97b fix: configure VPN routing inside container namespace
b0f9a13 fix: normalize empty AmneziaWG legacy parameters
1e95973 feat: route bot traffic through AmneziaWG
7ba8021 feat: add SQLite schema and migrations
737b084 feat: add Telegram webhook integration
```
