# GameDev.ru Tenevik Post Draft - 2026-05-27

Status: ready for owner-unlocked posting. Do not publish until the browser is logged into GameDev.ru as the new Tenevik account and the preview shows visible media plus clickable playable links.

Target:

- Board: https://gamedev.ru/projects/forum/?appreciate
- Rules/reference thread: https://gamedev.ru/projects/forum/?id=143148
- Existing old-account closed thread: https://gamedev.ru/projects/forum/?id=295485

Owner action:

1. Open https://gamedev.ru/ in Chrome.
2. Log in as the new Tenevik account.
3. Open https://gamedev.ru/projects/forum/?appreciate.
4. Say `GameDev.ru готово`.

Do not send passwords in chat. The active Chrome tab checked on 2026-05-27 showed the public GameDev.ru homepage with `Войти`, so the agent could not publish.

## Media Order

Attach native media before or with the post. GameDev.ru project rules require screenshots, gameplay video or art; documentation alone is not enough.

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/01_hero_gif_hell_blinking_eyes.gif`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/07_contract_quest_log.png`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/11_factions_alife_rank_panel.png`

Fallback if GIF upload fails:

1. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/contact_sheet_3x3.png`
2. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/04_active_samosbor_monsters.png`
3. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/07_contract_quest_log.png`
4. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/08_inventory_prep_loadout.png`
5. `../gatbage/tmp/media/prcampaign_screenshot_hunt_2026-05-23/selected_best/09_trade_grid.png`

## Title

```text
ГИГАХРУЩ - браузерный survival horror / ARPG shooter про вылазки и САМОСБОР
```

## Body

```text
Привет.

Пишу от Tenevik Games, разработчика ГИГАХРУЩ. Старую тему я закрыл при переносе публичной активности на новую учетную запись; здесь хочу собрать нормальный фидбек уже с медиа, ссылками и понятным запросом.

ГИГАХРУЩ / GIGAH|RUSH - бесплатный браузерный survival horror / ARPG shooter про подготовку к вылазкам внутри безграничной бетонной структуры. Игрок выходит из относительно безопасной жилой зоны, собирает припасы, ищет квесты и слухи, торгует, воюет, переживает САМОСБОР и пытается вернуться с добычей и последствиями.

Основная RU-страница на MyIndie:
https://myindie.ru/games/game/gigahrush

Прямая браузерная версия:
https://gigahrush.bileter.workers.dev

itch.io-зеркало / EN-страница:
https://tenevik.itch.io/gigahrush

Технически это TypeScript/Vite, WebGL/canvas, процедурные текстуры, процедурные спрайты и процедурный звук. Без Unity/Godot, без runtime-зависимостей и без установки.

Что уже есть в текущем билде:

- подготовка: еда, вода, патроны, медицина, документы, оружие и ПСИ;
- вылазки по опасным этажам через маршрут лифта;
- торговля, инвентарь, контейнеры, контракты, квесты и слухи;
- фракции, репутация и последствия;
- A-Life NPC, которые спят, торгуют, дерутся, прячутся и могут умереть навсегда;
- бой, монстры, САМОСБОР, процедурные варианты этажей и браузерные сохранения.

Очень нужен не общий "норм/не норм", а конкретный фидбек по первым 10-15 минутам:

1. Понятно ли, что игра про подготовку -> вылазку -> добычу -> возвращение, а не про линейный уровень?
2. Где теряется первая цель: квест, карта, маршрут, подсказки взаимодействия, журнал?
3. Что хуже всего читается: HUD, карта, инвентарь, подписи предметов, фракционный экран?
4. Есть ли ощущение, что припасы перед вылазкой имеют смысл, или предметы пока выглядят мусором?
5. САМОСБОР воспринимается как опасное событие или как фоновый шум?
6. Если прямой билд открывается темным экраном или долго грузится, какой браузер/устройство и сколько ждали?

Контент: survival horror, монстры, бой, смерть, трупы, кровь, сирены и тревожные процедурные события. Это не NSFW.

Связь/обновления:
https://t.me/gigah_rush
tenevik.games@gmail.com
```

## First Reply If The Forum Needs A Clarifier

```text
Не прошу оценок, голосов или апов. Самое полезное - конкретная точка трения: где закрыли вкладку, где потерялась цель, где не читается интерфейс, где сломалась загрузка или где цикл вылазки начал работать.

Если direct build уходит в темный экран, лучше сначала проверить MyIndie:
https://myindie.ru/games/game/gigahrush
```

## Comment Response Hooks

- Dark/stuck screen: ask for browser, device and wait time; point to MyIndie first, itch only as mirror/EN fallback.
- Goal confusion: ask where the first minutes lost the player; do not argue with taste.
- Map/HUD criticism: acknowledge and ask which specific panel or marker failed first.
- AI/asset-flip suspicion: answer with TypeScript/Vite/WebGL/canvas and procedural media facts.
- Resource/balance criticism: ask whether food/water/ammo/items changed the expedition decision.
- Samosbor too weak: record as balance/onboarding feedback, ask whether shelter/hermetic cues were visible.

No-go:

- No duplicate post while not logged in.
- No old `jirnyak` identity in new public copy.
- No `https://jirny.uk`.
- No map size/topology wording.
- No votes, bumps, ratings or support asks.
- No Game Jolt or IndieDB links in the new post until old-identity cleanup is verified.
