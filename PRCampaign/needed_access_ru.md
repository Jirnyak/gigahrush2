# Что нужно от владельца для продолжения PR

Дата: 2026-05-23. Миграция контакта: 2026-05-26.

Не присылай личные пароли в чат, если можно обойтись входом в браузере. Для текущей PR-миграции новый почтовый секрет хранится локально в `.env.pr.local`, файл игнорируется git и не должен коммититься. Лучший вариант для площадок: открыть нужную площадку в Opera GX или Chrome, войти там, после этого я продолжу публикацию через уже авторизованную сессию.

Новые PR-письма, регистрации, посты и support-запросы идут от `Tenevik Games` / `tenevik.games@gmail.com`. `jirnyak@gmail.com`, `jirnyak` и `https://jirny.uk` больше не использовать в новой публичной копии; старые строки ниже сохраняются только как факты уже отправленных писем, опубликованных постов или заблокированных аккаунтов.

Актуальный медианабор уже подготовлен и не требует от владельца нового поиска скриншотов: `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/`. Для быстрого квадратного превью использовать `contact_sheet_3x3.png`; для галерей и писем брать GIF/PNG из этой же папки.

## Уже не требует действий

| Площадка | Статус |
| --- | --- |
| samosborarchive Fandom | Страница опубликована: https://samosborarchive.fandom.com/ru/wiki/ГИГАХРУЩ |
| samosb0r Fandom | Страница опубликована: https://samosb0r.fandom.com/ru/wiki/ГИГАХРУЩ |
| Self-Assembly Wiki EN / Fandom | Страница опубликована: https://samosborarchive-en.fandom.com/wiki/GIGAH_RUSH. Правка 2026-05-23 21:19 UTC, rev `420`, убрала неактивный Newgrounds и заменила его на Game Jolt; API extlinks больше не содержат Newgrounds. |
| Fandom game lists | `ГИГАХРУЩ` добавлен в https://samosborarchive.fandom.com/ru/wiki/Игры_по_вселенной, `GIGAH RUSH` добавлен в https://samosborarchive-en.fandom.com/wiki/Self-Assembly_Games |
| ShoutWiki Самосбор | Нужен не логин, а разморозка вики: abuse filter `запрет правок` запрещает все правки правилом `1==1`. |
| itch.io Release Announcements | Топик опубликован: https://itch.io/t/6385827/gigahrush-free-browser-survival-horror-in-an-endless-concrete-apartment-block |
| itch.io Devlog | Devlog index опубликован: https://tenevik.itch.io/gigahrush/devlog; прежний прямой URL `https://tenevik.itch.io/gigahrush/devlog/1530909/-` вернул публичный `404` из shell на 2026-05-23. Dashboard/editor check уже сделан: пост `Published`, но отдельного slug/permalink поля нет. |
| DTF | Пост опубликован: https://dtf.ru/indie/5077801-gigahrush-brauzernyj-survival-horror |
| GameDev.ru | Тема опубликована: https://gamedev.ru/projects/forum/?id=295485 |
| Newgrounds | Больше не считать закрытым успешным действием: https://www.newgrounds.com/portal/view/1033564 редиректит на RIP/eulogy https://www.newgrounds.com/portal/rip/1033564. Существующий проект `7759223` редактируется, но штатный upload flow сохраняет свежий ZIP как `9B`; битый файл удален. |
| GamHub | Публичная форма приняла сабмит: https://gamhub.net/website_submit/ вернул `{"code":200,"msg":"Submit success"}`. Follow-up 2026-05-23 21:26 UTC: публичного URL нет, `/game/gigahrush/` и `/game/gigah-rush/` 404, sitemap без `gigahrush`, contact/about не найдены; нужен review 48-72 часа, не duplicate-submit same-day. |
| Reddit r/playmygame | Новый non-NSFW пост опубликован пользователем: https://www.reddit.com/r/playmygame/comments/1tku91k/gigahrush/ |
| IndieDB | Листинг создан: https://www.indiedb.com/games/gigahrush; загружены assets и 5 gameplay screenshots: https://www.indiedb.com/games/gigahrush/images/gigahrush-gameplay-screenshots. Shell fetch остается Cloudflare `403`, но Chrome browser/account check 2026-05-23 21:23-21:24 UTC открыл game page и screenshot page с ожидаемыми заголовками. |
| DiscoverGG | Листинг стал публичным: https://discovergg.com/game/gigahrush. Public recheck 2026-05-23 19:45 UTC: `200 OK`, title `GIGAH\|RUSH — Free Browser Game`, `robots: index, follow`, play link ведет на itch.io. |
| Fake Portal | Сабмит отправлен; ответ сайта: `Game submitted for review!`, `game_id: 10841`, status `pending`. Logged-in dashboard 2026-05-23 21:22 UTC подтверждает `Submitted Games (1)`, `GIGAH\|RUSH`, status `Pending`, date `May 23, 2026`, только `Preview`; публичный URL еще 404. |
| FreeZonePlay | Заявка отправлена через contact form: `mail_sent`; public/direct slugs на 2026-05-23 21:26 UTC не дают листинг, guessed submit/add-game paths 404, WP REST не показывает game post type. |
| Email batch 1 | Отправлено через Gmail DOM automation 2026-05-23: Alpha Beta Gamer `Admin@alphabetagamer.com`, Free Game Planet `admin@freegameplanet.com`, Games Pending `gamespending@gmail.com`. Gmail показал `Message sent` по каждому письму. |
| Email batch 3 | Отправлено через Gmail DOM automation 2026-05-24 00:28-00:31 BST: VK Play Media `mediavkplay@vkteam.ru`, HorrorFam `lauren@horrorfam.com`, Indie Game Buzz `games@indiegamebuzz.com`, Into Indie Games `info@intoindiegames.com`. Gmail search подтвердил sent conversation по каждому адресу. |
| Game Jolt | Страница опубликована публично и package sync завершен: https://gamejolt.com/games/gigahrush/1072064; description сохранен; maturity сохранен как Teen/non-adult; thumbnail `50560626`, header `50560651`, screenshot `2181594`/`50560706` загружены. Package `1093814`, release `1474942`, version `0.2.0`, build `1960153`; public API reports `gigahrush-itch.zip` at `4 999 557` bytes, and direct `serve.gamejolt.net` check returned current `index.html` with visible canvases. |
| iDev.Games | Публичный листинг опубликован: https://idev.games/game/gigah-rush. Public fetch 2026-05-23 21:21 UTC: `200 OK`, title `Gigah Rush - Free Online Browser Game`, `noindex` нет; edit page пишет `Public: This game has been released and is visible to everyone!`; embed HTML открывает `ГИГАХРУЩ - САМОСБОР` с canvas content. |
| MyIndie | Публичный Web (HTML5) листинг опубликован: https://myindie.ru/games/game/gigahrush. Public/API recheck on 2026-05-27: version `0.3.0`, updated `2026-05-27`, `11` views, `10` web plays, `2` downloads, `0` comments, `0` likes. Для RU/CIS это primary game page. |
| Kongregate | Developer Application submitted 2026-05-23: https://www.kongregate.com/en/developer/apply. Это не публичная страница игры; ждать approval before Alpha/upload. |

## itch.io support/indexing: выполнено, ожидание

| Что нужно | Почему | Что делать |
| --- | --- | --- |
| Проверить dashboard `GIGAH\|RUSH` на itch.io | Выполнено через Opera GX owner session 2026-05-23 20:10-20:20 UTC. Public recheck 20:20 UTC: страница `https://tenevik.itch.io/gigahrush` отдает `200 OK`, видна из профиля и playable, но публичный HTML все еще содержит `noindex`; поиск itch по `gigahrush`, `GIGAH\|RUSH`, `ГИГАХРУЩ` не показывает страницу Tenevik. Dashboard source: published/active, not restricted, not unlisted, current ZIP ready/embedded, cover/screenshots есть, Release info и Classification saved, Engines/tools blank intentionally, External links compact. | Больше не просить owner login для этого чеклиста. Ждать support/indexing, затем recheck `noindex`/search. Не пересоздавать страницу, не дублировать itch posts. |
| Написать в support@itch.io с email владельца аккаунта | Выполнено: Gmail `jirnyak@gmail.com` отправил письмо в `support@itch.io` 2026-05-23 20:22 UTC; перед отправкой DOM-проверка подтвердила recipient, subject и body. | Ждать ответа/изменения индексации. Если поддержка попросит уточнения, использовать факты из `PRCampaign/itch_listing_incident_2026-05-23.md`. |
| Исправить devlog permalink | `https://tenevik.itch.io/gigahrush/devlog` и RSS показывают launch post, но `https://tenevik.itch.io/gigahrush/devlog/1530909/-` публично возвращает `404`. Devlog editor уже проверен: пост `Published`, comments enabled, type `Major Update or Launch`, но отдельного slug/permalink поля нет. | Ждать ответа itch support или явного owner ok на публичное изменение заголовка ради латинского автослага. До фикса шарить только devlog index. |

## Нужен логин только для условных ответов

| Площадка | Что нужно | Что я сделаю после входа |
| --- | --- | --- |
| DTF follow-up | По newest owner request нужен вход в DTF: открыть https://dtf.ru/indie под нужным developer/Tenevik identity, открыть редактор поста и написать `DTF готово`. Previous DTF post metrics on 2026-05-27: `13` comments, `10` favorites, `7` reactions, `2 138` views, `569` hits, `2 737` total. | Использую `PRCampaign/dtf_followup_myindie_post_2026-05-27.md`, загружу GIF/screenshots, проверю preview/clickable links and ask for explicit final publish approval. Пост должен быть свежим update с MyIndie-first link, не duplicate/link bump. |
| Pikabu gamedev | Пост уже опубликован: https://pikabu.ru/story/delayu_brauzernyiy_survival_horror_pro_samosbor_alife_i_vyilazki_v_betonnoy_strukture_14010914. Body remains itch-only and `data-editable="false"`, but author correction comment `393697666` is public. Recheck on 2026-05-27 19:39 UTC / 20:39 BST showed `Комментариев - 1`, AJAX `total:1`, and visible MyIndie. | No access needed now. Do not duplicate-post or submit another correction. Monitor retention/moderation and answer only concrete comments. |
| GameDev.ru fallback | Если owner имел в виду именно GameDev.ru: открыть https://gamedev.ru/ в Chrome, войти под новым Tenevik-аккаунтом, открыть https://gamedev.ru/projects/forum/?appreciate и написать `GameDev.ru готово`. Active Chrome check on 2026-05-27 still showed `Войти`, so the agent cannot publish yet. | Использую draft `PRCampaign/gamedev_ru_tenevik_post_2026-05-27.md`, загружу GIF/screenshots, проверю preview/clickable links and ask for explicit final publish approval. Не публиковать от старого `jirnyak` account and do not make a generic bump. |

## Нужен вход в аккаунт

| Площадка | Что нужно | Что я сделаю после входа |
| --- | --- | --- |
| iDev.Games | Больше не нужен для базовой публикации: https://idev.games/game/gigah-rush уже public. | Логин понадобится только позже для icon/promo polish, moderation response или devlog/media work. |
| Reddit следующие сабреддиты | Текущий Reddit уже авторизован, но лучше не постить пачкой. | Через 24-48 часов можно идти в r/WebGames, затем r/indiegames другим текстом. |

## Нужен ручной контакт с владельцами площадок

| Площадка | Что произошло | Что нужно от владельца проекта |
| --- | --- | --- |
| Newgrounds | В существующем проекте `7759223` штатный browser upload через настоящий file input и прямой `/parkfile` attach оба сохраняют свежий `itch/gigahrush-itch.zip` как `9B`; прямой `file_2=@zip` не прикрепляет файл. | Если продолжаем Newgrounds, открыть редактор вручную и проверить, повторяется ли `9B`. Если повторяется, писать в Newgrounds support: HTML5 ZIP `4.77 MiB` / `4 999 557` bytes attaches as `9B` in project `7759223`. Не нажимать publish без playable preview. |
| Gamemoor | Старый аккаунт `jirnyak` был авторизован, но `/developer` редиректит на главную; `/submit`, `/games/add`, `/dashboard`, `/my-games` дают `404`. | Не продолжать публикацию от старого аккаунта. Открыть https://gamemoor.com/contact и попросить перенести/деактивировать `jirnyak`, включить developer portal для Tenevik Games или дать актуальный submit URL. |
| Free Indie Games | https://www.freeindiegames.org/submit-game/ показывает сырой shortcode `[ninja_forms_display_form id=1]`; рабочей формы нет. | Нужен email/contact владельца сайта или ремонт формы на их стороне. |

## Контакт подтвержден, outbound работает

Контакт обновлен владельцем 2026-05-26:

- Ник/подпись: `Tenevik Games`
- Email: `tenevik.games@gmail.com`
- Сайт: не указывать; `https://jirny.uk` снят с будущих постов.
- Telegram можно указывать: https://t.me/gigah_rush
- Основная RU/CIS страница игры: https://myindie.ru/games/game/gigahrush
- Прямая браузерная версия: https://gigahrush.bileter.workers.dev
- itch.io mirror / EN page: https://tenevik.itch.io/gigahrush

| Для чего | Что нужно |
| --- | --- |
| Письма медиа/кураторам | Gmail batch 1 и batch 2 отправлены через DOM automation, без координатных кликов. Chrome Apple Events рабочий, но при длинной автоматизации может вернуть ошибку 12; если это случится, активировать Chrome/проверить menu item и повторить. Дальше пауза: мониторить ответы/bounce/coverage, быстрые follow-up не слать. |
| Alpha Beta Gamer / Free Game Planet / Games Pending | Уже отправлено 2026-05-23; не отправлять быстрый follow-up, ждать ответов/coverage. |
| Indie Games Plus / TapCraftBox / Armor Games | Уже отправлено 2026-05-23: Armor Games `mygame@armorgames.com` 21:33 BST, TapCraftBox `support@tapcraftbox.com` 21:34 BST, Indie Games Plus `editors@indiegamesplus.com` 21:35 BST. Не делать быстрый follow-up. |
| VK Play Media / HorrorFam / Indie Game Buzz / Into Indie Games | Уже отправлено 2026-05-24 00:28-00:31 BST через Gmail DOM. | Не делать быстрый follow-up. Ждать ответы/bounce/coverage; для HorrorFam выдержать минимум 7 business days перед повторным письмом. |
| Gamemoor support | Support request отправлен на `contact@gamemoor.com` 2026-05-23 21:35 BST, но public contact page показывает форму, не email. | Ждать ответ/bounce; если bounce или тишина, повторить через https://gamemoor.com/contact form. |
| PLRun | Не считать P0 email target: старый `https://plrun.com/plrun-for-developers/` на 2026-05-23 вернул `410`; возвращаться только после подтверждения актуального developer/contact path. |
| VK Play Media / Telegram-каналы | Telegram разрешен как контакт; RU pitch допустим. |

## Нужны решения по порталам

| Портал | Решение |
| --- | --- |
| Яндекс Игры | Нужен отдельный SDK-адаптер и developer account. Это уже техническая задача, не просто публикация. |
| Пикабу Игры | Нужен GamePush/юридический статус и отдельная портальная сборка; физлицам без подходящего статуса может быть нельзя. |
| ИграйТут | Нужно решить, публикуем ли без SDK или делаем SDK-сборку; для SDK есть ограничения на cloud save size. |
| CrazyGames | Можно начинать только как отдельную portal-build задачу: Basic Launch допускает Basic Implementation/QA без CrazyGames-specific SDK и без монетизации, но нужны английская локализация, PEGI 12, iframe readability/performance, no custom fullscreen, no cross-promotion, `<=50MB` initial download, `<=250MB` total, `<=1500` files. Full Launch требует CrazyGames SDK и Full QA. |
| Newgrounds | Сейчас не playable listing: RIP/eulogy, а свежий ZIP в редакторе сохраняется как `9B`. Нужна ручная проверка/support; до этого не ссылаться как на active publication. |
| Kongregate | Developer Application уже подана; нужен approval. После approval можно загружать HTML5/WebGL/iframe game в Alpha/review. |
| Game Jolt | Public page уже опубликован и синхронизирован: package `1093814`, release `1474942`, build `1960153`, текущий `itch/gigahrush-itch.zip` (`4 999 557` bytes) подтвержден public API и прямой playable check. Дальше только мониторить plays/comments/followers и позже добавить media/devlog через безопасный UI path при реальном инфоповоде. |
| CWS Games | Решение: пропустить пока. Площадка adult-adjacent, а игра не NSFW; публикация даст неправильный контекст. |
| MegaViral | Нужен отдельный бюджетный ok: форма требует Stripe `$1/month per game`. Без подтверждения не трогать. |

## Участок 4: account-gated / quick listing queue, проверено 2026-05-23

Без логина и без отправок проверены публичные текущие URL:

| Площадка | Что нужно от владельца | Что можно сделать безопасно после входа |
| --- | --- | --- |
| Game Jolt | Аккаунт уже использован для создания, публикации и package sync. Description, Teen maturity, thumbnail, header, один screenshot, package `1093814`, release `1474942`, build `1960153` сохранены и публично проверены. | Следующий шаг: мониторинг, дополнительные screenshots/GIFs и devlog/update, если composer открывается trusted UI path и есть реальный инфоповод. |
| MyIndie | Больше не нужен для базовой публикации: https://myindie.ru/games/game/gigahrush уже public. | Логин понадобится только позже для правок, media polish, moderation response или comments. |
| iDev.Games | Public listing уже есть: https://idev.games/game/gigah-rush. | Мониторинг/moderation/media polish; не resubmit. |
| IndieHub | Зарегистрироваться/войти на https://indiehub.ru/ или написать в support Telegram с вопросом о рабочем add-game path. | Публичная кнопка `добавить игру` ведет на https://indiehub.ru/game/add, где сейчас ошибка “страница не существует”. Не считать готовым quick target, пока аккаунт/support не покажет рабочую форму. |
| Kongregate | Ждать ответа по уже поданной Developer Application. | Это не quick listing: до approval нельзя публиковать. После approval можно подготовить Alpha submission; publish доступен только после Kongregate review/approval. |

Дополнительные owner decisions перед финальными кликами:

- Kongregate application подана, но до Alpha submission всё еще нужно решить English language option и AI declaration.
- Game Jolt maturity уже сохранен как Teen/non-adult: cartoon violence 2, fantasy violence 2, bloodshed 2, без sexual/gambling/adult flags.
- iDev.Games уже public; adult/hateful content rule остается важным для будущих правок: survival-horror описывать аккуратно как non-NSFW, без adult positioning.

## Участок 4: quick RU/listing public recheck, 2026-05-23

Проверено публично без логина и без отправок:

| Площадка | Текущий публичный факт | Что нужно от владельца |
| --- | --- | --- |
| MyIndie | Superseded PR 11: `https://myindie.ru/games/game/gigahrush` уже public. | Больше не нужен вход для базовой публикации; только мониторинг и будущие правки. |
| IndieHub | `https://indiehub.ru/` показывает вход/регистрацию, `добавить игру`, правила и Telegram support. `https://indiehub.ru/game/add` сейчас отвечает ошибкой, что страницы нет и нужно обратиться к администрации в Telegram. | Либо войти и проверить, появляется ли рабочий add-flow, либо написать в support Telegram и попросить актуальный путь добавления игры. |
| iDev.Games | `https://idev.games/game/gigah-rush` уже public; edit page подтверждает visible to everyone. | Мониторить страницу/moderation; не загружать повторно. |
| Gamemoor | `https://gamemoor.com/contact` говорит, что developer portal открыт и submissions идут в review queue за несколько дней. Публично `https://gamemoor.com/developer` редиректит на login; `/submit`, `/dashboard`, `/my-games`, `/games/add` не дают рабочий submit. | Войти с Tenevik identity и открыть `/developer`; если снова редирект/нет доступа, отправить support message с просьбой перенести/деактивировать `jirnyak`, включить developer portal для Tenevik Games или дать submit URL. |

Реально можно сегодня:

1. MyIndie: уже опубликован; только мониторинг и media polish позже.
2. Gamemoor: проверить `/developer` после логина или отправить support request; это не instant-public.
3. iDev.Games: уже опубликован; только мониторинг и media polish позже.
4. IndieHub: не тратить финальные клики; сначала support/login check.

## Расширенный public recheck account-gated portals, 2026-05-23 20:31 UTC

Без логина, без отправок, без final-click. Проверены MyIndie, iDev.Games, IndieHub, Kongregate, CrazyGames, Gamemoor.

| Площадка | Текущий публичный blocker / requirement | Что нужно от владельца |
| --- | --- | --- |
| MyIndie | Completed/public after PR 11: https://myindie.ru/games/game/gigahrush. Карточка опубликована с Web HTML5/Another/RU+EN/current ZIP. | Мониторить страницу, Web iframe, comments/moderation. |
| iDev.Games | Public listing: https://idev.games/game/gigah-rush; account/editor says released and visible to everyone. | Мониторить moderation/plays/comments; логин нужен только для будущих правок. |
| IndieHub | `/game/add` публично сломан: “страница не существует”, просит обратиться в Telegram support. Rules требуют publisher rights и запрещают spam/malware/illegal/misleading/infringing content. | Войти и проверить скрытый add-flow или написать в support Telegram за текущим URL. Не публиковать, пока форма/статус неизвестны. |
| Kongregate | Developer Application submitted after PR 11. Требует approval, legal upload agreement, Alpha/review. Нужны screenshots, description, instructions, voluntary age rating, AI declaration, English language option; publish только после review. | Ждать approval. После approval можно готовить Alpha. |
| CrazyGames | Developer Portal - JS app. Basic Launch требует Basic Implementation/QA, но не Full SDK и без monetization; Full Launch SDK-required. Public requirements: `<=50MB` initial download, `<=250MB` total, `<=1500` files, relative paths, Chrome/Edge, iframe/mobile readability, English localization, PEGI 12, no custom fullscreen, no cross-promotion. | Сначала принять отдельную portal-build задачу. После owner login я не должен submit current build как quick PR: нужно убрать external playable CTA/fullscreen, проверить English path, iframe/performance, затем preview/QA. Full Launch требует SDK events/data/user work. |
| Gamemoor | Contact page says developer portal open and review usually within a few days. `/developer` redirects to login; `/submit`, `/dashboard`, `/my-games` = 404; `/games/add` -> 404. Terms: submissions reviewed for PEGI 3-16 and no NSFW. | Войти с Tenevik identity и открыть `/developer`; если нет доступа, отправить support request о переносе/деактивации `jirnyak`, developer portal для Tenevik Games или submit URL. Подавать как non-NSFW survival horror / PEGI 16. |

Классификация после PR 11: already public - MyIndie и iDev.Games; support-blocked - IndieHub; application/review queue - Kongregate; SDK/portal-build - CrazyGames; review queue after portal access/support - Gamemoor.

## Браузерная автоматизация

Chrome давал выполнять JavaScript через AppleScript: проверка вернула title активной вкладки, Game Jolt description/maturity/media были сохранены, Gmail отправил 3 письма через DOM-кнопку Send. Во время длинной передачи ZIP Chrome один раз вернул ошибку 12, но пункт `Allow JavaScript from Apple Events` оставался отмеченным; после активации Chrome и повтора выполнение JS восстановилось, Game Jolt ZIP/release/game publish были завершены.

```text
Chrome menu: View > Developer > Allow JavaScript from Apple Events
```

Все равно не использовать слепые координатные клики по формам, file dialogs, Gmail send buttons или portal publish buttons. Безопасный режим: DOM-inspection/DOM-action и trusted keyboard activation; final publish/upload только после page-specific preview. Если Chrome вернет ошибку 12, сначала активировать Chrome, проверить `View > Developer > Allow JavaScript from Apple Events`, затем повторить команду.

## Готовый email pitch

Для Alpha Beta Gamer, Free Game Planet, Indie Games Plus (`editors@indiegamesplus.com`) и Games Pending:

```text
Subject: GIGAH|RUSH - free browser survival horror / ARPG shooter

Hello,

My name is Tenevik Games. I am affiliated with the development/outreach for GIGAH|RUSH, a free browser survival horror / ARPG shooter about expeditions inside an endless Soviet-style concrete apartment block.

The player prepares food, water, ammo, medicine, documents and weapons, then leaves the safer living area for hostile floors with factions, traders, monsters, quests, rumors and Samosbor events. The current browser build includes preparation, expeditions, combat, trading, inventory, quests, factions, procedural floors, browser saves, A-Life NPCs and persistent consequences.

Primary EN/media link: https://tenevik.itch.io/gigahrush
Direct browser build: https://gigahrush.bileter.workers.dev
Telegram: https://t.me/gigah_rush

Content note: survival horror atmosphere, monsters, combat, death, corpses, blood, weapon use, sirens and disturbing procedural events. It is not NSFW.

If this fits your coverage, list, video channel or indie roundup, I would be glad if you took a look.

Best,
Tenevik Games
tenevik.games@gmail.com
```

Для TapCraftBox / Armor Games / Free Play Games добавить перед `Content note`:

```text
The game is HTML5/WebGL/canvas, runs directly in the browser with no install, and has no ads or premium purchases in the submitted build.
```
