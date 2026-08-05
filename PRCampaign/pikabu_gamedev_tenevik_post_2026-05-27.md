# Pikabu Gamedev Tenevik Post Draft - 2026-05-27

Status: published at `https://pikabu.ru/story/delayu_brauzernyiy_survival_horror_pro_samosbor_alife_i_vyilazki_v_betonnoy_strukture_14010914` on 2026-05-27. PR_18 records the live-link incident: the published body used itch.io as the only game link, but for RU/CIS the primary surface is MyIndie. Correction was posted as author comment `393697666` / `?cid=393697666` and public recheck showed `Комментариев - 1` plus visible MyIndie. Keep this file as the corrected source for future Pikabu edits/reposts; do not create a duplicate post or submit another correction.

Target:

- Community: https://pikabu.ru/community/gamedev
- Composer: https://pikabu.ru/add
- Yandex login: https://pikabu.ru/oauth.php?type=ya
- VK login: https://pikabu.ru/oauth.php?type=vk

If body editing becomes available:

1. Replace the published itch-only link line with the corrected MyIndie-first line from the Body section below.
2. Keep only one external game-link line in the body if community rules remain strict.
3. Do not delete and repost unless the owner explicitly chooses that after moderation risk review.

If body editing stays unavailable, do not submit another correction while comment `393697666` remains public. Only monitor retention/moderation and answer concrete user comments.

## Media Order

Upload media natively when possible. The post should read like a developer story with screenshots, not a bare external-link announcement.

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
   - Alt: `ГИГАХРУЩ: стены с глазами в красном коридоре`
   - Caption: `Короткий horror-hook: дом смотрит на игрока еще до объяснения систем.`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png`
   - Alt: `ГИГАХРУЩ: САМОСБОР, монстры и боевой HUD`
   - Caption: `САМОСБОР как игровое давление: сирена, туман, враги и решение бежать или добивать цель.`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
   - Alt: `ГИГАХРУЩ: инвентарь перед вылазкой`
   - Caption: `Петля начинается до боя: еда, вода, патроны, бинты и оружие решают, насколько далеко можно уйти.`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/07_contract_quest_log.png`
   - Alt: `ГИГАХРУЩ: журнал задания с наградой, сроком и маршрутом`
   - Caption: `Контракты дают конкретный повод выйти из жилой зоны: цель, срок, риск и награда.`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/09_trade_grid.png`
   - Alt: `ГИГАХРУЩ: экран торговли с NPC`
   - Caption: `Торговля и дефицит ресурсов: патроны и тушенка важны не меньше стрельбы.`
6. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`
   - Alt: `ГИГАХРУЩ: отношения фракций и A-Life рейтинг NPC`
   - Caption: `Фракции, отношения и A-Life: NPC живут, конфликтуют и могут исчезать навсегда.`

Fallback:

- If Pikabu accepts only one strong preview, use `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`.
- If GIF upload fails, start with `04_active_samosbor_monsters.png`.
- Do not upload both `contact_sheet_3x3.png` and `contact_sheet_png.png`; they are the same image.

## Tags

Use only tags that fit the final post editor:

```text
моё, Gamedev, Инди игра, Разработка игр, Игры, Браузерные игры, Survival horror, WebGL, Геймдев
```

## Title

```text
Делаю браузерный survival horror про САМОСБОР, A-Life и вылазки в бетонной структуре
```

## Body

```text
Привет, Пикабу. Я разработчик ГИГАХРУЩ / GIGAH|RUSH и хочу показать текущий браузерный билд, а заодно собрать нормальный фидбек по первым минутам.

Это survival horror / ARPG shooter про вылазки внутри безграничной бетонной структуры. Игрок начинает в относительно жилой зоне, собирает еду, воду, патроны, бинты, документы и оружие, выбирает повод выйти наружу, а потом пытается вернуться с добычей, информацией и последствиями.

Мне хотелось уйти от формата "сгенерировали коридор, убили врагов, вышли в меню". Поэтому игра строится вокруг вылазок и систем, которые давят друг на друга. Есть фракции, торговцы, NPC с A-Life, рынки, слухи, квесты, контракты, монстры, ручные и процедурные этажи, браузерные сохранения и САМОСБОР.

NPC не просто стоят декором. Они могут торговать, спать, драться, прятаться, вступать в конфликты и умереть навсегда. Фракции помнят поступки игрока. Рынки меняют цены. В комнатах остаются следы боев и пустые контейнеры. Если где-то умер человек, система не обязана тихо заменить его новым.

Отдельная механика - САМОСБОР. Это не катсцена, а событие, которое ломает нормальную прогулку: двери герметизируются, туман идет по щелям, монстры становятся активнее, а привычный маршрут перестает быть надежным. Иногда правильное решение - не геройствовать, а бросить часть плана и искать выход.

Сейчас в билде уже есть:

- подготовка перед вылазкой;
- бой, торговля, инвентарь и квесты;
- фракции, репутация и A-Life NPC;
- ручные и процедурные этажи;
- САМОСБОР-события;
- карта, слухи, контракты и браузерные сохранения;
- запуск прямо в браузере без установки.

Делается на TypeScript/Vite, WebGL/canvas и процедурных ассетах. Без Unity/Godot, без импортированных UI-фреймворков и без ассет-паков: текстуры, спрайты и звук генерируются внутри проекта.

Основная RU-страница игры на MyIndie: https://myindie.ru/games/game/gigahrush

Прямая браузерная версия: https://gigahrush.bileter.workers.dev

itch.io-зеркало: https://tenevik.itch.io/gigahrush

Я не прошу плюсов, рейтинга или продвижения. Мне полезнее конкретный фидбек:

1. Где в первые 5-10 минут непонятно, что делать?
2. Читается ли интерфейс, инвентарь, торговля и карта в браузере?
3. Достаточно ли очевидно, что брать перед вылазкой?
4. САМОСБОР ощущается опасностью или пока шумом на фоне?
5. В какой момент хочется закрыть вкладку?
6. Если билд долго грузится или уходит в темный экран, какой браузер/устройство и сколько ждали?

Если билд выглядит как долгий темный экран, это тоже полезный баг-репорт: напишите браузер, устройство и сколько ждали.

Контент-нота: это не NSFW, но это survival horror с боем, кровью, трупами, сиренами, монстрами и тревожными событиями.
```

## First Comment If Needed

```text
Для конкретики: особенно полезны сообщения в формате "браузер / устройство / что делал / где потерял цель или закрыл вкладку". Общая оценка тоже ок, но чинить можно только конкретные места: загрузку, карту, HUD, инвентарь, взаимодействие, САМОСБОР или первый квест.
```

## Published Correction Comment

Published through the author account as comment `393697666`:

```text
Апдейт по ссылке: для RU-аудитории основная страница сейчас MyIndie, не itch.io. Там русская карточка, Web HTML5 и актуальная сборка: https://myindie.ru/games/game/gigahrush
```

## Link Fallback

If the editor strips links or the community treats external links as too promotional:

- keep the media and developer story;
- keep only MyIndie in the body for RU/CIS posts when the community allows only one game link;
- move direct build / itch mirror / Telegram to replies only if someone asks or if the editor permits a clean three-link block;
- do not disguise links or evade moderation.

Safe links:

- https://myindie.ru/games/game/gigahrush - primary RU/CIS public page.
- https://gigahrush.bileter.workers.dev - direct browser build fallback.
- https://tenevik.itch.io/gigahrush - itch mirror / EN audience.
- https://t.me/gigah_rush only if contact/update link is allowed or requested.

Do not use Game Jolt, IndieDB, Newgrounds, itch devlog permalink, Querygame, GamHub, Fake Portal, FreeZonePlay, Gamemoor or Free Indie Games in this new post until identity/link cleanup is verified.

## No-Go

- No `jirnyak`, `jirnyak@gmail.com` or `https://jirny.uk` in new public copy.
- No requests for pluses, boosts, ratings, reposts or votes.
- No public map size/topology wording.
- No NSFW/adult positioning.
- No duplicate DTF/GameDev.ru/Reddit text.
