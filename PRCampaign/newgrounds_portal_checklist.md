# Чеклист порталов для ГИГАХРУЩ

Дата проверки: 2026-05-22.

Документ разделяет площадки по ближайшему действию для PR-кампании. "Без кода" означает, что можно заводить страницу/заявку на существующих материалах. "Отдельная сборка" означает, что основной runtime менять не нужно, но лучше подготовить отдельный ZIP/обертку/пакет ассетов под требования площадки. "SDK/интеграция" означает отдельную техническую задачу с платформенным адаптером, сохранениями, паузой, рекламой или событиями.

## Локальные артефакты

Генерируется по требованию:

- `dist/index.html` - production single-file browser build after `npm run build`.
- `itch/index.html` - itch HTML build after the release/itch build script.
- `itch/gigahrush-itch.zip` - HTML5 ZIP after the release/itch build script; root archive must contain `index.html`.

Уже есть в репозитории:

- `../gatbage/media/itch_page_pack/description_ru_approved.md` и `.html` - утвержденное RU-описание itch.
- `../gatbage/media/itch_page_pack/itch_fields_ru.md` - title, short description, tags, screenshot order.
- `PRCampaign/copy_pack_ru.md` - RU/EN copy, pitch, письма и one-liners.
- `PRCampaign/itch_release_announcement.md` - готовый itch forum post.
- `PRCampaign/press_kit_checklist.md` - структура press-kit.
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/` - текущий owner-updated best media set для PR/порталов; брать GIF/PNG и 3x3 sheet отсюда.
- `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png` - квадратный 3x3 обзор для social/portal preview.

Старые локальные binary backup-папки gallery/capsules/assets удалены во время уборки. Для новых порталов бери `selected_best/`, публичную itch cover и регенерируй portal assets под требования площадки.

Не хватает как повторяемых артефактов:

- отдельного `portal/` или `releases/portal/` каталога с Newgrounds/iDev/Crazy/Yandex/Pikabu/IgrayTut ZIP-пакетами;
- EN store-page набора: короткое описание, длинное описание, теги, возрастной дисклеймер, управление, content warning;
- 16:9 маркетинговых изображений под 1280x720, 1920x1080 и 640x360, подписанных по назначению, а не только itch pack;
- квадратных иконок в требуемом площадкой размере для RU-порталов;
- трейлера или чистого 30-60 секунд gameplay video;
- публичного press-kit URL или ZIP с fact sheet RU/EN, контактами и выбранными медиа;
- портального smoke-чеклиста: iframe, fullscreen, mobile controls, pause on blur, audio mute, no console errors;
- SDK-адаптера для порталов, который не загрязняет основной zero-runtime build.

## Можно сейчас без кода

| Площадка | Что можно сделать | Уже есть | Не хватает / риск |
| --- | --- | --- | --- |
| IndieDB | Создать страницу игры, добавить изображения/GIF, ссылку на itch и онлайн-версию, затем опубликовать news/update. IndieDB позиционирует профиль как developer-driven promo toolkit с profile, news, image gallery, video hosting и download hosting. | RU/EN pitch в `PRCampaign/copy_pack_ru.md`; screenshots/GIF в `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`; current public itch cover or freshly regenerated portal assets; live links из `PRCampaign/campaign_plan_ru.md`. | Нужен аккаунт/логин; лучше подготовить EN long description и 3-6 EN captions. Для страницы без downloadable build можно сразу вести на itch/Cloudflare, но для сильной страницы нужен trailer или gameplay video. |
| IndieDB | Загрузить файл как download, если решено давать HTML ZIP не только ссылкой. | `itch/gigahrush-itch.zip` уже маленький и содержит `index.html` в корне. | Проверить лицензионный текст/README внутри download pack. Может понадобиться отдельный archive note: "open index.html / browser build". |
| ИграйТут | Предварительно собрать заявку/метаданные и проверить контент на соответствие: название, short/long description, screenshots, возрастной рейтинг, отсутствие внешних ссылок в описании. | RU-описание, screenshots, 16:9 background/banner/media wall. | Для реальной публикации, если используется SDK ИграйТут, потребуется SDK init и облачные сохранения; не хватает 512x512 icon, 1280x720 cover, 640x360 thumbnail, 16:9 screenshots без альфа в нужной сетке. |
| Пикабу Игры | Подготовить письмо на `games@pikabu.ru` или заявку через официальное сообщество, приложив MyIndie/direct-build links и медиа. | RU-copy, публичная MyIndie page, онлайн-версия, itch mirror, PNG/GIF. | Реальная публикация требует GamePush-кабинет/договорные условия и облачные сохранения. Также нужен аудит контента: Пикабу запрещает 18+, казино-механики, ненормативную лексику и внешние ссылки в игре кроме поддержки. |

## Нужна отдельная сборка

| Площадка | Что подготовить | Уже есть | Не хватает / риск |
| --- | --- | --- | --- |
| Newgrounds | Newgrounds HTML5 ZIP: `index.html` в корне, iframe-friendly viewport, preview before publish. Newgrounds явно принимает HTML5 ZIP и предупреждает, что 403 часто значит `index.html` не в корне. | `itch/gigahrush-itch.zip` уже имеет `index.html` в корне; `dist/index.html`/`itch/index.html` single-file; CSS canvas fullscreen. | Лучше сделать `newgrounds` ZIP без лишних PWA/service worker файлов, с `body` margin reset или `topmargin=0 leftmargin=0` оберткой, и проверить в iframe. Нужны Newgrounds metadata: EN description, tags, rating, thumbnail/icon, "Touchscreen friendly" decision. |
| iDev.Games | HTML5 ZIP с `index.html` или `index.htm` в корне. Их tutorial прямо требует root index file. | Текущий ZIP уже совпадает по базовой структуре. | Нужен iDev-specific publish form pack: EN title/description, thumbnail, tags, controls. Лучше проверить, не мешают ли `manifest.webmanifest`/`sw.js` в их iframe/CDN. |
| CrazyGames Basic Launch | Отдельный CrazyGames ZIP/build candidate без внешней саморекламы, с чистым iframe/fullscreen поведением, no external ads, console-clean QA. Для Basic Launch SDK optional, но требования включают initial download <= 50MB, total <= 250MB или 50MB без SDK, file count <= 1500. | Размер подходит: HTML 9.25 MB, ZIP 4.45 MB, файлов в ZIP мало. WebGL/canvas build уже браузерный. | Нужна английская локализация/landing-in-gameplay оценка, PEGI12/content check, no external links/cross-promotion, QA в CrazyGames iframe. Для монетизации и Full Launch нужен SDK. |
| Яндекс Игры | Отдельная Yandex build branch/profile даже до SDK: fullscreen/mobile/Desktop declarations, no OS shortcut conflicts, pause/audio behavior, guest play with saved progress. | Русский интерфейс уже основной; игра браузерная; есть mobile controls и PWA/fullscreen логика. | Нужна отдельная сборка с Yandex SDK, настройкой паузы/звука при background, сохранениями через SDK при необходимости, и модерационными материалами. Модерация заявлена 3-5 рабочих дней. |
| Пикабу Игры | GamePush/Pikabu ZIP и промоматериалы под их размеры. | Есть рабочий HTML5 ZIP и RU-материалы. | Нужны облачные сохранения, автопауза при сворачивании/рекламе, отключение звука в фоне, отсутствие критических console errors, квадратная и горизонтальная иконки в требуемых площадкой размерах. |
| ИграйТут | IgrayTut-target build с правильными метаданными и локальными медиа размерами. | Есть browser build, RU copy, 1920x1080 background/media wall, скриншоты. | Нужны 512x512 icon, 1280x720 cover, 640x360 thumbnail, минимум 2 горизонтальных screenshots 1280x720-2560x1440 без альфа. Если подключать SDK, нужен `IgrayTut.init` до storage/ads/leaderboard/achievements/payments. |

## Нужен SDK/интеграция

| Площадка | Минимальная интеграция | Уже есть | Не хватает / риск |
| --- | --- | --- | --- |
| CrazyGames Full Launch | CrazyGames SDK v3: init до старта игры, `GameplayStart`/game events, ads через SDK, account/data только через CrazyGames, AdBlock-compatible flow. | Основная архитектура допускает платформенный адаптер отдельно от игрового цикла; есть localStorage save. | Нужен `PlatformAdapter` или аналогичный тонкий слой с compile-time/build-time выбором, без runtime-зависимости в основной сборке. Нужно решить, как маппить localStorage save на CrazyGames data и где показывать ad breaks без ломки темпа survival loop. |
| Яндекс Игры | Yandex Games SDK обязателен. Требуются guest play или добровольная авторизация, сохранение прогресса, остановка звука при сворачивании, платежи/реклама только через SDK. | Русская версия и браузерный runtime уже подходят по направлению. | Нужен SDK loader, pause/audio lifecycle, save adapter, optional ads adapter, тест draft mode, промоматериалы, возрастная маркировка, проверка mobile/desktop declared devices. |
| Пикабу Игры | GamePush SDK и кабинет GamePush; облачные сохранения обязательны для публикации; автопауза/звук/реклама/статистика через платформу. | Игра free browser, RU UI, playable >30 минут. | Нужен GamePush adapter, cloud save normalization под лимиты, запрет внешних ссылок/трекинга, юридическая готовность: Пикабу указывает, что физлица без подходящего статуса к сотрудничеству не допускаются. |
| ИграйТут | SDK ИграйТут, если использовать platform storage/ads/leaderboards/achievements/payments: `IgrayTut.init` обязателен до других методов; storage save limit 100 KB для пользователей без Premium и 10 MB для Premium. | Можно выделить минимальный save snapshot вместо дампа мира; есть save runtime shape. | Текущий save может быть больше 100 KB в поздней игре, значит нужен compact cloud save profile или только local save для не-SDK сценария. Нужны cooldowns для рекламы и запрет сторонних трекеров/API. |

## Порядок действий

1. Сразу завести IndieDB страницу и подготовить iDev/Newgrounds заявки на существующем ZIP, но не публиковать Newgrounds/iDev до iframe smoke.
2. Создать `portal` release script только для упаковки: Newgrounds/iDev ZIP без лишней PWA-обвязки, с margin reset и отдельными upload notes.
3. Сделать EN store copy pack и 16:9/square media export pack.
4. После этого брать CrazyGames Basic Launch как первый iframe portal QA.
5. SDK-порталы вести отдельной задачей: Yandex first, затем общий GamePush/Pikabu adapter, затем ИграйТут/CrazyGames Full Launch при необходимости.

## Источники проверки

- Newgrounds: https://www.newgrounds.com/wiki/help-information/content-submission/games-and-movies
- IndieDB: https://www.indiedb.com/how-to
- iDev.Games: https://idev.games/post/how-to-prepare-your-html5-game-files-for-uploading-
- CrazyGames requirements: https://docs.crazygames.com/requirements/intro/
- CrazyGames SDK: https://docs.crazygames.com/sdk/intro/
- Yandex Games requirements: https://yandex.com/dev/games/doc/en/concepts/requirements
- Пикабу Игры technical docs: https://games.pikabu.ru/page/tehnicheskaya-dokumentatsiya
- ИграйТут publishing rules: https://igraytut.ru/pages/publishing-rules

## 2026-05-27 Newgrounds Check-Only Update

Scope: check official requirement and current blocker only. No upload, no `/parkfile`, no publish, no project mutation.

- Official Newgrounds wiki still says games can be SWF or HTML5 ZIP, ZIP must have `index.html` in the archive root, it will load in an iframe, and the project preview appears before publish. A `403` after ZIP upload usually means `index.html` is inside a folder rather than root.
- Public recheck at 20:09 UTC / 21:09 BST: `https://www.newgrounds.com/portal/view/1033564` redirects to `https://www.newgrounds.com/portal/rip/1033564`; page title is `Eulogy for: GIGAH RUSH`, dates are `May 22, 2026 - May 22, 2026`, and the page says `This entry was deleted.`
- Account/session check: Chrome opens `https://www.newgrounds.com/projects/games/7759223/details` but shows `ERROR - You do not have permission to view this page`; Opera GX redirects the same URL to `https://www.newgrounds.com/login`. The prior project upload bug was therefore not retested.
- Current local artifact fact: `itch/gigahrush-itch.zip` is now `5 194 294` bytes, contains `index.html` at archive root, and the root `index.html` is `11 302 283` bytes. This supersedes older Newgrounds support wording that referenced `4 999 557` bytes.
- Durable decision: keep Newgrounds out of active campaign links. Publish remains forbidden until the correct logged-in account or Newgrounds support accepts the current real archive in preview and the preview plays.
