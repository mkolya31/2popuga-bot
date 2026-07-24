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

## Последний подтверждённый результат VPN

Тестовый контейнер `2popuga-vpn-test` успешно:

- создал интерфейс `awg0`;
- установил handshake с peer `194.58.39.157:36354`;
- получил и отправил данные;
- направил default route через `awg0`;
- сохранил отдельный маршрут до VPN endpoint через Docker gateway.

Проверка `wget https://api.telegram.org` не прошла только из-за DNS. При этом
явный запрос:

```bash
nslookup api.telegram.org 1.1.1.1
```

успешно вернул адрес Telegram. Поэтому в сервис `vpn` в `compose.yaml` добавлены
DNS-серверы `1.1.1.1` и `1.0.0.1`.

## Следующий шаг

Сначала проверить на VPS последнюю DNS-правку до слияния в `production`.

После появления коммита с DNS-правкой в `origin/develop` выполнить на VPS:

```bash
cd /opt/2popuga-bot
git fetch origin develop
git rev-parse --short FETCH_HEAD
git show FETCH_HEAD:compose.yaml | sed -n '1,40p'
```

Пересобрать тестовый VPN-образ из полученной версии `develop`:

```bash
git archive FETCH_HEAD | docker build \
  --file deploy/amneziawg/Dockerfile \
  --tag 2popuga-vpn:test \
  -
```

Удалить прежний тестовый контейнер, если он существует:

```bash
docker rm --force 2popuga-vpn-test 2>/dev/null || true
```

Запустить sidecar с внешними DNS-серверами:

```bash
docker run --detach \
  --name 2popuga-vpn-test \
  --cap-add NET_ADMIN \
  --device /dev/net/tun:/dev/net/tun \
  --security-opt no-new-privileges:true \
  --dns 1.1.1.1 \
  --dns 1.0.0.1 \
  --env AWG_INTERFACE=awg0 \
  --volume /opt/2popuga-bot/secrets/amneziawg.conf:/run/secrets/amneziawg.conf:ro \
  2popuga-vpn:test
```

Проверить контейнер, handshake, DNS и Telegram API:

```bash
docker ps --filter name=2popuga-vpn-test
docker exec 2popuga-vpn-test awg show awg0
docker exec 2popuga-vpn-test nslookup api.telegram.org
docker exec 2popuga-vpn-test /usr/local/bin/amneziawg-healthcheck \
  && echo "Telegram API доступен через VPN"
```

Если healthcheck успешен, проверить сетевое пространство будущего контейнера
бота отдельным временным контейнером:

```bash
docker run --rm \
  --network container:2popuga-vpn-test \
  public.ecr.aws/docker/library/node:24-bookworm-slim \
  node -e "fetch('https://api.telegram.org', { signal: AbortSignal.timeout(10000) }).then(r => console.log(r.status)).catch(e => { console.error(e.cause?.code ?? e.name); process.exit(1) })"
```

Ожидается HTTP-ответ Telegram без `TimeoutError`.

После успешной проверки:

1. удалить тестовый контейнер;
2. создать pull request `develop` → `production`;
3. дождаться успешного production deploy;
4. проверить `https://2popuga.kolyach.me/healthz`;
5. проверить `https://2popuga.kolyach.me/readyz`;
6. проверить логи `docker compose logs --tail=100 vpn bot`;
7. отправить боту сообщение в разрешённой Telegram-группе.

## Важное замечание о первом production-запуске

SQLite фиксирует исходную точку расписания при первом полноценном запуске.
VPN-изменения пока не следует сливать в `production`, пока доступ к Telegram API
не подтверждён, чтобы не создавать исходное расписание раньше времени.

## Последние значимые коммиты до DNS-правки

```text
a83c97b fix: configure VPN routing inside container namespace
b0f9a13 fix: normalize empty AmneziaWG legacy parameters
1e95973 feat: route bot traffic through AmneziaWG
7ba8021 feat: add SQLite schema and migrations
737b084 feat: add Telegram webhook integration
```
