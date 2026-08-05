# RU/CIS Upload Platform Scout - 2026-05-26

Задача: найти лучший русский/СНГ ресурс, где можно выложить playable build `ГИГАХРУЩ`, потому что itch.io/Game Jolt/iDev/MyIndie уже есть, а нужна доступная российской аудитории площадка. Было запущено 6 read-only субагентов: HTML5 upload portals, RU community/devlog, Telegram/VK/media, PC/Web stores, конкурентная активность и техническая пригодность текущего Vite/WebGL билда. Публичных публикаций, заявок и final-click действий не было.

## Decision

Если выбирать один лучший ресурс под русскоязычную playable-дистрибуцию: **Яндекс Игры**.

Причина: это официальный массовый HTML5/WebGL каталог с русской аудиторией, внутренней органикой, рейтингами, отзывами и понятной консолью публикации. Это не быстрый mirror: нужен отдельный `yandex` portal build с SDK, lifecycle hooks, `ready`, корректной паузой звука, проверкой UI и удалением внешних CTA.

Если нужен ближайший практический шаг без большой SDK-интеграции: **VK Play browser project scout** и **ИграйТут**.

VK Play может принять браузерный проект через dashboard/iframe path, но потребует owner login, карточку, возрастной рейтинг, iframe QA и модерацию. ИграйТут принимает HTML5/JS/WASM/WebGL архивы с лимитами, под которые текущий single-file build проходит, но это меньшая витрина и требует убрать/проверить внешние ссылки внутри игры.

## Ranked Upload Targets

| Rank | Platform | Best use | Current-build fit | Blocker / adaptation | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Яндекс Игры | Главная RU/CIS playable-витрина для HTML5/WebGL | Размер подходит, RU canonical подходит | SDK Яндекс Игр обязателен, модерация 3-5 рабочих дней, `ready`, pause/audio, no external CTA, mobile/UI QA | Делать отдельную portal-build задачу первой |
| 2 | VK Play browser project | RU PC/web store presence, iframe/direct hosted playable | Cloudflare HTTPS build может быть основой iframe | Owner login, developer dashboard, legal/profile verification, карточка, iframe/pointer-lock/fullscreen QA | Скаутить dashboard как ближайший owner-unlock |
| 3 | ИграйТут | Быстрый RU HTML5 catalog upload | Текущий `dist/index.html` около 10.7 MB и ZIP около 5 MB проходят опубликованные лимиты | Ручная модерация, no prohibited content, external-link/CSP check, age rating | Хороший быстрый второй upload, если форма доступна |
| 4 | Пикабу Игры | Массовая RU/Pikabu audience плюс фичеринг | Русский интерфейс подходит | GamePush SDK обязателен, cloud saves обязательны, no external links, legal status: юрлицо/ИП/самозанятый, модерация до 7 рабочих дней | Сильный, но после GamePush/cloud-save adapter |
| 5 | GamePush distribution | Один адаптер для Yandex/VK/Pikabu/OK и других HTML5 площадок | Билд удобен для обертки | Сторонний SDK; нужно не загрязнить canonical build | Делать как отдельный `PortalBridge` слой, если идем сразу в несколько соц/HTML5 витрин |
| 6 | IndieHub / MyIndie-like catalogs | Long-tail RU indie cards and SEO | MyIndie уже доказанно принял ZIP | IndieHub add path/support unclear; MyIndie уже live | MyIndie мониторить/просить фичеринг; IndieHub только после working add flow |
| 7 | RuStore / NashStore | Android app stores | Не подходят текущему Web/PC build | Нужен Android WebView/APK wrapper | Не делать сейчас |
| 8 | Plati / Digiseller / Boosty | Paid/supporter distribution | Можно продавать/выкладывать файл, но это не discovery | Торговые правила, слабая playable органика | Не PR/upload target для бесплатной браузерной версии |

## PR Layer Around Upload

Для российской аудитории сам upload надо сопровождать не новыми линк-дампами, а media-first posts:

- **Пикабу gamedev**: лучший следующий community post после DTF. Нужен авторский longpost с GIF/скриншотами, developer disclosure и конкретным фидбек-запросом; не голая самореклама.
- **Indie Spotlight / prototype.indie / Indie Varvar's**: питчить как редакционный/Telegram/VK материал с 2 GIF, contact sheet, 3-5 механиками и playable links.
- **forum.indie.ru**: безопасный низкоохватный форумный тред.
- **Habr/vc.ru**: только отдельный технический/маркетинговый кейс, не релизный пост.
- **StopGame / VGTimes / Канобу / PlayGround**: только с инфоповодом, трейлером/демо/крупным обновлением и пресс-китом.

## Technical Split

Quick / low-code:

- ИграйТут: проверить upload form, подготовить ZIP, иконки, возрастной рейтинг, убрать/проверить внешние ссылки.
- VK Play: owner login -> создать Browser project draft -> iframe/direct URL test -> карточка и модерация.
- MyIndie: уже live; не дублировать, только обновлять/просить фичеринг при реальном обновлении.

Separate integration:

- Яндекс Игры: `portal=yandex`, SDK init, `LoadingAPI.ready`, pause/resume/audio, no external CTA, mobile/browser QA, moderation pack.
- Пикабу Игры/GamePush: `portal=gamepush`, cloud-save bridge over current save payload, ad-safe pause, support-only external link policy, mobile QA.
- VK social games / OK Games: через GamePush or platform-specific SDK only after the generic portal bridge exists.

Implementation guardrail: canonical Cloudflare/itch build remains zero-runtime-dependency. Any platform SDK belongs in a separate portal artifact or thin optional `PortalBridge`, not in the normal browser build.

## Source URLs Checked

- Яндекс Игры developers: https://yandex.com/support/games/ru/for-developers
- Яндекс Игры requirements: https://yandex.ru/dev/games/doc/ru/concepts/requirements
- Яндекс Игры upload guide: https://yandex.com/dev/games/doc/en/console/add-new-game
- Пикабу Игры add game: https://games.pikabu.ru/add-own-game
- Пикабу Игры technical documentation: https://games.pikabu.ru/page/tehnicheskaya-dokumentatsiya
- GamePush: https://gamepush.ru/ru/
- VK Play developers: https://developers.vkplay.ru/
- VK Play project creation / browser project documentation: https://documentation.vkplay.ru/p2p_vkp/p2p_create_vkp
- ИграйТут publishing rules: https://igraytut.ru/pages/publishing-rules
- RuStore publishing docs: https://www.rustore.ru/help/developers/publishing-and-verifying-apps
- NashStore developer registration/upload docs: https://help.nashstore.ru/hc/articles/71/registraciya-razrabotchika-nashstore and https://help.nashstore.ru/hc/articles/76/zagruzka-prilozheniya-v-nashstore-poshagovoe-rukovodstvo
- Playhop developers: https://playhop.com/developers
- Sber HTML5 publication docs: https://developers.sber.ru/docs/ru/va/html/publication
- FITGAME publisher context: https://fitgame.ru/

## Next Actions

1. Owner chooses lane: `Yandex portal build`, `VK Play dashboard scout`, or `ИграйТут quick upload`.
2. If Yandex: create a separate engineering task for portal bridge and run browser/mobile checks before console submission.
3. If VK Play: log in to developers.vkplay.ru under Tenevik identity; create draft only, no final publish without preview.
4. If ИграйТут: verify current submit form/account, prepare no-external-link ZIP and media pack, then submit only after preview.
5. After first RU upload is live, publish one Пикабу gamedev longpost and pitch Indie Spotlight/prototype.indie with the new local playable URL.

## 2026-05-27 Yandex / VK Play Official Recheck

Срез 20:08-20:14 UTC / 21:08-21:14 BST, без кода, без upload, без publish.

| Platform | Official requirements confirmed | Current session blocker | Decision |
| --- | --- | --- | --- |
| Яндекс Игры | SDK Яндекс Игр обязателен для успешной модерации; требуется корректный `LoadingAPI.ready()`; игра с прогрессом должна сохранять прогресс; звук должен останавливаться при сворачивании; платежи/реклама только через SDK; unzipped source limit `100 MB`; в корне архива нужен `index.html`; внешние ссылки в текстах/медиа не допускаются кроме разрешенных каталогом/сообществом случаев; moderation usually takes `3-5 working days`. | Chrome reaches Yandex as `tenevik.games@gmail.com`, but `https://games.yandex.com/console` redirects to Yandex ID registration asking to create a Yandex mailbox. No mailbox or draft was created. | Ranking unchanged: best long-term RU/CIS upload target, but only after separate `portal=yandex` build and owner account setup. Do not submit current build. |
| VK Play browser project | Project creation supports `Browser` type; after creation the project cannot be deleted from account, only hidden. Browser projects are developer-hosted through an HTTPS iframe URL entered in Basic features; VK Play then loads `https://vkplay.ru/app/[GMRID]`. Test iFrames support up to 10 test pages. Dashboard shows moderation/publication status and distinguishes unpublished from published. Browser test checklist includes first-load success, adaptive layout, no external leading links on page, no external links in game, no third-party ads/payments, age rating and filled Basic Features fields. | Chrome is logged into `developers.vkplay.ru` as `Tenevik`, but `Developer Dashboard` opens a registration application requiring `Company Name`, `Country of Residence` where taxes are paid, game description, contact emails and `I'm 18 years old`. No registration application or browser project was submitted because those are owner/legal attestations. | Nearer practical scout remains valid, but next step is owner-completed developer registration. After that, create only a non-public Browser draft/test iframe and do not publish until preview QA passes. |

## 2026-05-27 Bridge Start

PR_28 started the engineering side without submitting to any portal:

- Added optional `src/systems/platform_bridge.ts` for Yandex/GamePush SDK lifecycle hooks.
- Added platform pause as transient runtime state in `src/main.ts`.
- Extended audio suspension to multiple reasons, so page-hidden and platform pauses cannot resume over each other.
- Local `localStorage` save remains authoritative; portal cloud-save is attempted only when an SDK exists and the raw payload is below `190 KiB`.
- Focused verification passed: `npm run typecheck` and `node --test --import tsx tests/audio.test.ts tests/platform-bridge.test.ts`.

This does not make Yandex or Pikabu Games upload-ready. Remaining work: owner/legal setup, Yandex/GamePush credentials, dedicated portal artifact, compact save policy, external-link/content cleanup, mobile/browser QA, and moderation assets.

## 2026-05-27 Pikabu Games / GamePush Prep Continuation

PR_29 continued the Pikabu Games lane without upload or final submit:

- `?portal=gamepush` and `?portal=pikabu` are now strict portal modes.
- GamePush SDK loading is optional and credential-driven only: query/meta `gpProjectId` plus `gpPublicToken`; no project secret is committed.
- GamePush cloud save writes wrapped current-shape save records to `player.progress`, prefers compact current-shape portal records after `64 KiB`, and syncs cloud storage up to the hard `900 KiB` guard.
- Current-shape cloud saves can hydrate back into local `gigahrush_save` when local storage is missing or older.
- Strict portal mode disables generated roulette/slots, NPC durak/dice money-stake options, authored `floor_69`, the Floor 69 placeholder entertainment option, and optional Net Sphere `/api/net` traffic.
- `npm run pikabu:build` now emits a separate `pikabu/gigahrush-pikabu.zip` candidate with strict portal metadata and optional local-env GamePush public credentials.
- Added `PRCampaign/pikabu_games_pre_submit_qa_2026-05-27.md` as the concrete pre-submit gate.
- Focused verification passed: `npm run typecheck` and `npx tsx --test tests/platform-bridge.test.ts tests/audio.test.ts tests/npc-interaction-options.test.ts tests/interactions.test.ts tests/procedural-floors.test.ts` (`71` tests, `69` pass, `2` skipped, `0` fail).
- Full `npm run check` passed after docs: typecheck, `1336` unit tests, content audit and production build.
- Local `npm run pikabu:build` passed without GamePush credentials and produced ignored `pikabu/gigahrush-pikabu.zip` (`5 196 710` bytes) with root `index.html` and strict portal metadata.

This still does not make Pikabu Games submit-ready. Remaining work: owner-created GamePush project, real project id/public token, GamePush `progress` field, owner legal/payment readiness, `npm run pikabu:build` with real local-env credentials, real GamePush/Pikabu iframe test, `npm run check:browser`, final icons/cover/form fields and moderation preview. Any compact portal save above `900 KiB` remains a blocker until the current-shape portal profile is tightened.
