# Cloudflare Net Sphere

> Центральный документ optional online layer.
>
> Роль: описывает НЕТ-СФЕРУ, чат, heartbeat, cloud profile, D1/Worker deployment and current online implementation. Core single-player browser game must work without Cloudflare, D1, Worker API, market endpoint, chat or network access.

НЕТ-СФЕРА добавляет к статичному Vite-билду маленький Cloudflare Worker слой:

- `functions/worker.ts` - Worker entrypoint: `/api/net/*` уходит в API, остальное в Worker Assets.
- `functions/api/net/hello.ts` - heartbeat, онлайн, личный облачный профиль.
- `functions/api/net/stats.ts` - публичная статистика для меню.
- `functions/api/net/event.ts` - игровые события: `samosbor`, `death`.
- `functions/api/net/chat.ts` - короткий общий текстовый терминал.
- `functions/api/net/market.ts` - глобальная НЕТ-биржа: компактные импульсы игроков и агрегированный snapshot котировок.
- `cloudflare/d1/net_sphere.sql` - каноническая D1-схема для свежей базы.
- `cloudflare/d1/net_sphere_names.sql` - историческая guarded-миграция для ника и человекочитаемой сводки событий.
- `cloudflare/d1/net_sphere_market.sql` - историческая идемпотентная миграция для опциональных таблиц НЕТ-биржи.

Клиент остается без runtime-зависимостей: только `fetch` к same-origin `/api/net/*`.

## Setup

1. В Cloudflare Workers проекте оставь:

```txt
Build command: npm run build
```

`npm run build` перезаписывает `dist/`. Статика обслуживается через `assets.directory` в `wrangler.jsonc`, а API через `functions/worker.ts`.
В репозитории есть `.node-version` с Node `22.16.0`; это фиксирует build image на версии, совместимой с Vite 7 и Wrangler 4, даже если проект в Cloudflare использует старые настройки.

2. Один раз залогинь Wrangler на этой машине:

```bash
npx wrangler login
```

3. Запусти setup из репозитория:

```bash
npm run cf:setup
```

Скрипт требует Cloudflare auth/Wrangler, сам создаст или найдет D1 `gigahrush-net`, D1 `gigahrush-npc-intake`, пропишет bindings `GIGA_NET` и `NPC_DB` в `wrangler.jsonc` с реальными ids/names и применит SQL-схемы. `net_sphere_names.sql` исполняется через PRAGMA guards, чтобы старые базы получили недостающие колонки, а свежие базы не падали на duplicate column.

4. Если Cloudflare Workers уже привязан к GitHub, просто redeploy Worker. `wrangler.jsonc` теперь источник правды: `name`, `main`, `assets`, `compatibility_date`, D1 binding.

Если не хочешь использовать `wrangler.jsonc` как источник правды, тот же binding можно добавить вручную в dashboard:

```txt
Workers & Pages -> gigahrush -> Settings -> Bindings -> Add -> D1 database
Variable name: GIGA_NET
Database: gigahrush-net
```

После деплоя `/api/net/stats` должен вернуть JSON.

Cloudflare docs:

- Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Workers D1 bindings: https://developers.cloudflare.com/d1/worker-api/

## D1 Schema Files

Порядок миграций в `scripts/cloudflare-net-setup.mjs` - источник правды для setup/schema:

1. `cloudflare/d1/net_sphere.sql` - каноническая полная схема для свежей D1 базы. В ней должны быть все таблицы, которые текущий Worker может читать или писать.
2. `cloudflare/d1/net_sphere_names.sql` - историческая миграция для баз, созданных до `nickname`, `net_events.nickname` и `net_events.summary`. Файл содержит обычные `ALTER TABLE`, но setup применяет их только если колонок еще нет.
3. `cloudflare/d1/net_sphere_market.sql` - идемпотентная миграция для таблиц НЕТ-биржи. Таблицы `net_market_impulses`, `net_market_budgets` и `net_market_snapshots` опциональны для локального билда игры, но обязательны для hosted `/api/net/market`; setup применяет их по умолчанию.

`npm run dev`, `npm run build`, `npm run test:unit` и локальная игра не требуют Cloudflare credentials. Cloudflare нужен только для `npm run cf:setup`, `npm run cf:schema`, `npm run cf:dev` и деплоя Worker.

## Local Cloudflare Test

Обычный `npm run dev` не поднимает Worker API. Для проверки API локально:

```bash
npm run cf:dev
```

`cf:dev` сначала перезаписывает `dist/` через `vite build --mode cloudflare`, включая статический `/npc-intake/`, затем запускает `wrangler dev` с `wrangler.jsonc`. Перед ним нужен `npm run cf:setup`, чтобы в конфиге был реальный D1 `database_id`. Это не секрет: Cloudflare Worker нужен конкретный UUID базы для binding, а `cf:setup` перезаписывает его под текущий аккаунт.

Чтобы только повторно применить схему и защищенные миграции к уже настроенной базе:

```bash
npm run cf:schema
```

`cf:schema` требует Cloudflare auth/Wrangler и пишет только в удаленные D1 базы. Для CLI-деплоя используй:

```bash
npm run cf:deploy
```

`cf:deploy` перезаписывает `dist/` через Cloudflare-mode build, включая `/npc-intake/`, и деплоит Worker в Cloudflare.

## Routing And Cache Headers

- `functions/worker.ts` обрабатывает только namespace `/api/net` и `/api/net/*`; неизвестные Net API пути возвращают JSON `404`.
- `functions/worker.ts` также прокидывает namespace `/api/npc-intake/*` в inbox handler из `gigahrush-npc-intake/hosted/worker.mjs`. Публичная форма `/npc-intake/` отправляет validated ZIP на `/api/npc-intake/submit`; review endpoints доступны под `/api/npc-intake/review/submissions...` и требуют `TENEVIK_REVIEW_TOKEN`.
- Поддержанные endpoint-ы возвращают JSON `405` с `Allow` для неподдержанного метода.
- Все ответы Net API, включая `200`, `400`, `404`, `405`, `429` и `503`, идут с `Cache-Control: no-store`, потому что содержат живые счетчики, чат, профиль или состояние binding-а.
- Остальные пути передаются в Worker Assets. Если `GIGA_NET` не настроен, API возвращает мягкий `503`, но статический билд игры продолжает обслуживаться через assets.

## NPC Intake Inbox

Only the Cloudflare-mode online build serves the player-facing NPC questionnaire at `/npc-intake/`; default local, itch and single-file builds do not include the intake subproject.
The form can still export a local ZIP, but its primary online path is:

```txt
/npc-intake/
  -> POST /api/npc-intake/submit
  -> D1 NPC_DB stores private contact, metadata, status, review pointers, and the ZIP/source/preview files as BLOBs
  -> /api/npc-intake/review/* lets TENEVIK download/export accepted submissions
```

Required optional bindings for online submission:

```txt
NPC_DB           D1 database with gigahrush-npc-intake/hosted/cloudflare/npc_intake.sql applied
TENEVIK_REVIEW_TOKEN  private review secret
TURNSTILE_SECRET_KEY  leave unset for the main game form until a client Turnstile token UI exists
```

If these bindings are missing, `/api/npc-intake/submit` returns `503`; the game
and static questionnaire still load, and the form tells the player to use
`Export ZIP` as the manual fallback.

## In Game

- `N` открывает НЕТ-СФЕРУ.
- В НЕТ-СФЕРЕ `Enter` отправляет текущую строку и закрывает окно, `Backspace` стирает символ, `Delete` закрывает окно, колесо мыши / `PageUp` / `PageDown` / стрелки листают загруженную историю чата; `Esc` не используется для игровых окон и остается за браузером/pointer lock.
- Новый браузер получает личный НЕТ-ГЕН вида `NET-XXXX-XXXX-XXXX` и хранит его в `localStorage`.
- Перед входом игрок вводит НЕТ-ИМЯ; оно хранится в `localStorage` и уходит в облачный профиль.
- В терминале можно ввести `/netgen NET-...`, чтобы вернуться к старому сетевому профилю.
- `/new` выдает новый НЕТ-ГЕН.
- `/clear` очищает локально загруженные строки терминала.

Сейчас облачный прогресс - это профиль и агрегаты: запуски, самосборы, смерти, лучший уровень, лучший счетчик самосборов, последний этаж, текущий route seed, route id и `z`. НЕТ-биржа принимает только bounded market impulses `{ eventKey, corpId, kind, magnitude }` и отдает агрегированный snapshot котировок; локальный портфель не становится server-authoritative. Полное сохранение игры в облако намеренно не отправляется, чтобы не связывать D1 с форматом локального save.

## Stored Data

`net_players`

- `net_gen` - личный код облачного профиля; в игре игрок видит только свой код.
- `nickname` - последнее НЕТ-ИМЯ игрока.
- `runs` - новые browser-session входы.
- `total_samosbors`, `deaths` - личные счетчики.
- `best_level`, `best_samosbor_count`, `last_floor` - компактный прогресс.
- `progress_json` - последний краткий snapshot, включая `runSeed`, `routeId` и `floorZ`; это ambient Net Sphere signal, не облачное сохранение маршрута.

`net_sessions`

- `session_id`, `net_gen`, `last_seen_at`.
- Онлайн считается по сессиям с `last_seen_at` за последние 90 секунд.

`net_events`

- Уникальные события с `event_key`.
- `net_gen` хранится как внутренний владелец события и не отдается в публичную сводку.
- Сейчас используются типы `samosbor` и `death`.
- `summary` хранит короткую строку для НЕТ-СФЕРЫ, например `[nickname] умер 2026-05-18 02:42 UTC`.

`net_chat`

- `net_gen`, `body`, `created_at`; `net_gen` нужен для лимита и привязки к профилю, публичная строка чата отдается с `nickname`.
- Сообщения режутся до 160 символов.

`net_market_impulses`

- `event_key` уникален и делает POST идемпотентным.
- `net_gen` хранит внутренний источник импульса, а публичный snapshot отдает только `corpId`, `price`, `lastDelta`, `volume`, `updatedAt`.
- `corp_id`, `kind` и `magnitude` чистятся и ограничиваются на сервере; сырые игровые логи сюда не отправляются.

`net_market_snapshots`

- Одна строка на корпорацию: текущая агрегированная цена, последний дельта-импульс, накопленный объем и время обновления.
- `GET /api/net/market` отдает bounded список snapshot rows.
- `POST /api/net/market` принимает heartbeat identity/progress и компактные impulses, затем возвращает `{ ok: true, market }`.

## Safety

- НЕТ-ГЕН, session id, event key и сообщения валидируются на сервере.
- НЕТ-ИМЯ валидируется на клиенте и сервере, режется до 24 символов.
- Сообщения чистятся от control chars и символов `<`, `>`, `` ` ``, `\`.
- НЕТ-биржа принимает не больше 16 импульсов за POST, режет payload по общему лимиту API и ограничивает magnitude.
- Публичные строки терминала и сводки не отдают чужой НЕТ-ГЕН, только ник и текст/summary.
- В игре терминал рисуется через canvas `fillText`, не через HTML.
- Есть простое ограничение: одно сообщение от одного НЕТ-ГЕН раз в 2.5 секунды.

## Expansion Points

Новые онлайн-фичи добавляются без изменения клиента API-формата:

- новый event type в `/api/net/event`;
- новая колонка или JSON-поле в `progress_json`;
- новый endpoint под `functions/api/net/<feature>.ts`;
- новый блок в canvas overlay `src/render/net_sphere_ui.ts`.

Для realtime-чата или присутствия без polling следующим шагом будет Durable Object + WebSocket, но текущая D1/polling схема проще и дешевле для первого публичного билда.
