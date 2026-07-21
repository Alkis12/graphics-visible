# Graphics Visible

Role-based analytics portal for publishing embedded business dashboards behind a configurable access layer.

## Portfolio overview

This repository is a sanitized, reusable version of a production system built for a business-planning and analytics company. The deployed solution replaced daily manual Excel reporting with live dashboards based on ticketing data.

- 4 portal sections and 8 embedded DataLens dashboards
- Used by 3 managers and 5 shareholders
- Role-based access for administrators, clients, users, tabs, and individual dashboards
- MongoDB-backed sessions and configuration
- Optional Python ETL worker for external data ingestion
- Docker Compose deployment with health checks and production-oriented defaults

## Technology

Node.js 20+, Express, MongoDB, JavaScript, Chart.js, Python ETL, Docker, and Docker Compose.

## Documentation in Russian

Веб-приложение для публикации аналитических дашбордов с разграничением доступа. Администратор управляет клиентами, пользователями, вкладками и доступными дашбордами; пользователи видят только назначенные им разделы.

## Возможности

- роли администратора и клиента;
- управление пользователями и доступом к отдельным дашбордам;
- встраивание аналитики DataLens;
- настройка вкладок, заголовков и оформления;
- хранение сессий и настроек в MongoDB;
- опциональный ETL-воркер для загрузки данных из внешнего источника;
- запуск в Docker Compose.

## Стек

- Node.js 20+, Express и MongoDB;
- JavaScript без фронтенд-фреймворка, Chart.js;
- Python ETL;
- Docker и Docker Compose.

## Быстрый запуск

1. Скопируйте файл конфигурации:

   ```bash
   cp .env.example .env
   ```

2. Заполните обязательные значения в `.env`:

   - `MONGO_ROOT_PASSWORD` — новый случайный пароль MongoDB;
   - `SESSION_SECRET` — случайная строка длиной не менее 32 байт.

   Docker Compose собирает `MONGO_URL` из настроек локального контейнера. Если используется внешняя MongoDB, задайте `MONGO_URL` явно; пароль в нём должен быть URL-encoded. Пример структуры без реальных данных:

   ```text
   mongodb://<user>:<password>@mongo:27017/<database>?authSource=admin
   ```

3. Соберите и запустите сервисы:

   ```bash
   docker compose up -d --build
   docker compose exec -T app npm run seed
   ```

   При первом запуске seed создаёт отсутствующие учётные записи со случайными паролями и показывает эти одноразовые данные в терминале. При повторных запусках существующие `passwordHash` не изменяются.

4. Откройте `http://127.0.0.1:8080`.

MongoDB по умолчанию доступна только через loopback-интерфейс на порту `27018` и не публикуется во внешнюю сеть.

## Запуск без Docker

Нужны Node.js 20+ и доступная MongoDB. Для такого запуска `MONGO_URL` обязателен. После заполнения `.env`:

```bash
npm ci
npm run seed
npm start
```

Для разработки с автоматическим перезапуском используется `npm run dev`.

## ETL

ETL-профиль запускается отдельно:

```bash
docker compose --profile etl up -d etl_scripts
```

Параметры внешней базы задаются переменными `PLANETRA_DB_*`. Если ETL не нужен, эти значения можно оставить пустыми.

## Учётные записи

Пароли пользователей приложения хранятся только в MongoDB в виде bcrypt-хэшей. В `.env` находятся только логины создаваемых seed-скриптом учётных записей; пароли пользователей через окружение не передаются.

Seed создаёт случайный пароль только для отсутствующей учётной записи. Если пользователь уже существует, скрипт обновляет его метаданные и доступы, не меняя `passwordHash`. Пароли действующих пользователей меняются через административный интерфейс.

Скрипт назначения ограниченного доступа также работает только с существующим пользователем и не создаёт и не обновляет пароль:

```bash
docker compose exec -T app node scripts/ensure-odeon-pulse-access.js
```

`MONGO_ROOT_PASSWORD`, `MONGO_URL`, `SESSION_SECRET` и опциональный `PLANETRA_DB_PASSWORD` относятся к инфраструктуре, а не к пользователям веб-приложения. Они нужны сервисам для подключения к базам и подписи сессий.

## SSH-туннель и удалённый деплой

Репозиторий не содержит адресов и SSH-логинов. Их нужно передавать только через локальные переменные окружения.

Для туннеля:

```bash
SERVER_SSH=user@example-host ./scripts/open-server-mongo-tunnel.sh
```

Для удалённого запуска деплоя:

```bash
DEPLOY_TARGET=remote \
PROD_HOST=user@example-host \
PROD_APP_DIR=/srv/graphics-visible \
./redeploy.sh
```

На самом сервере `redeploy.sh` запускается с `DEPLOY_TARGET=local`. При необходимости имя дополнительной Docker-сети передаётся через `EXTERNAL_NETWORK_NAME`.

## Безопасность

- `.env`, приватные ключи и локальные файлы окружения исключены из Git;
- приложение завершается с ошибкой, если `MONGO_URL` или `SESSION_SECRET` не заданы;
- Compose требует явные `MONGO_ROOT_PASSWORD` и `SESSION_SECRET`, а строку подключения собирает без пароля по умолчанию;
- служебные скрипты не содержат паролей по умолчанию и не меняют пароли существующих пользователей;
- опубликованный когда-либо секрет нужно немедленно отозвать и заменить, даже если он больше не используется;
- удаление секрета из текущей версии не удаляет его из истории Git — перед публикацией историю нужно очистить отдельно.

Не коммитьте `.env`, дампы базы, приватные ключи и реальные строки подключения.
