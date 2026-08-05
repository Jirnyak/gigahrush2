# Процедурные этажи и клеточная динамика мира

> Центральный документ процедурных этажей.
>
> Роль: описывает roguelike/RNG route floors, anomaly profiles, клеточный `World`, локальную runtime-динамику, majority factions, danger, procedural loot/monster bias and bounded topology changes. Связан с `floors.md`, который описывает весь вертикальный floor system.

Актуально на 2026-05-30. Это не backlog отдельных аномалий, а описание работающей системы процедурных route-этажей, клеточного `World` и bounded runtime-динамики поверх него. Частные старые планы перенесены в архив; текущую фактуру проверяйте по `src/data/procedural_floors.ts`, `src/gen/procedural_floor.ts`, `src/gen/procedural_anomalies/` и `src/systems/procedural_anomalies*`.

## Что является системой

Процедурный этаж - это route-stop в `FloorRun`, а не новый `FloorLevel`. Данные `ProceduralFloorSpec` задают `key`, `z`, seed, depth, danger, геометрию, majority-фракцию, anomaly-профиль, лутовые bias и monster bias. Сейчас источник данных содержит 54 процедурных route-остановки, 10 geometry-профилей, 5 majority-профилей и 20 anomaly-профилей.

`World` остается одной 1024x1024 тороидальной клеточной поверхностью. В ней живут `cells`, `roomMap`, `zoneMap`, `wallTex`, `floorTex`, `features`, light/fog/surface state, doors, rooms, containers, route marks и сущности. Любая динамика обязана работать через `world.idx`, `world.wrap`, `world.delta`, `world.dist` или `world.dist2`; прямые плоские координатные допущения ломают тороид.

Генерация идет слоями:

1. Собрать базовую геометрию этажа из geometry-профиля.
2. Создать настоящие комнаты, двери, коридоры, зоны, лифты и route anchors.
3. Проверить достижимость и привести лифты к route-контракту.
4. Разложить контейнеры, лут, factory/production hooks, emergency panels и population placement.
5. Наложить anomaly-профиль через inline-ветку или модуль `src/gen/procedural_anomalies/<id>.ts`.
6. Зарегистрировать runtime state только там, где динамика нужна после загрузки этажа.

## Клеточная динамика

Клетка может быть статической геометрией, временным проходом, опасной поверхностью, движущимся препятствием, топологическим следом, медиа-пикселем или точкой route-памяти. Но это всегда часть текущего `World`, а не отдельная DOM/renderer-сцена.

Runtime-аномалия должна менять минимум клеток и хранить компактное состояние:

- локальная арена, route track, ring buffer, dirty list, seed, bounded map или `WeakMap<World, ...>`;
- медленный tick, cooldown, cap, scan radius или query cap;
- dirty-version bump при изменении геометрии, света, fog, surface или текстур;
- вытеснение/урон сущностям при cell mutation без тихого мгновенного убийства игрока;
- player-facing warning через HUD/log/events/marks, а не скрытый внутренний id;
- debug summary или тест, если эффект может закрыть проход или съесть FPS.

Тяжелые topology-профили вроде moving walls, section shifts, клеточных автоматов, поездов, живых тоннелей и экранных миров не должны пересчитывать весь 1024x1024 мир каждый кадр. Они работают локальными площадками, заранее построенными треками, списками изменившихся клеток или частотными обновлениями.

## Поведение мира

Процедурный этаж должен ощущаться как маленький мир, а не как список комнат. Геометрия, majority-фракция, anomaly, danger, route depth, population profile, лут и rumors должны складываться в один читаемый набор решений:

- идти коротким опасным путем или обходить;
- чинить, глушить, зачищать, заклеивать, ехать, ждать ритм, кормить ловушку или уводить врага;
- воровать из anomaly-тайника или оставить его как приманку;
- пережить самосбор в измененной геометрии;
- использовать фракцию/монстров/поезда/дым/свет против другой угрозы.

Если профиль не дает решения и не меняет маршрутную тактику, он остается декоративным и не должен расширять runtime.

## Сохранение и самосбор

Процедурные route-этажи живут через `systems/procedural_floors.ts`, `systems/floor_memory.ts` и текущий save shape. Первый визит строится из route seed; повторный визит должен восстановить floor memory для того же floor key, если snapshot сохранен. Самосбор меняет активный `World`, и результат становится следующей памятью этого floor key.

Аномалия не должна создавать legacy-миграции save. Если добавляется persistent runtime state, он должен иметь текущую save-секцию, sanitizer, caps и bump `SAVE_SHAPE_VERSION`, когда shape несовместим.

## Где добавлять новое

- Данные профиля: `src/data/procedural_floors.ts`.
- Генерация профиля: `src/gen/procedural_anomalies/<id>.ts` и регистрация в `src/gen/procedural_anomalies/index.ts`; простые старые inline-профили оставлять inline только если они действительно малы.
- Runtime: `src/systems/procedural_anomalies/<id>.ts`, вызываемый через `src/systems/procedural_anomalies.ts`.
- Лут/экономика: через anomaly loot tags, resource mappings, containers или production, не через ручной spawn без reachability.
- Render feedback: существующие `Cell`, `Tex`, `Feature`, fog/light/surface marks/HUD/log; новый render channel только если текущих каналов недостаточно.
- Тесты: локальная модель правила, route reachability, protected lifts/spawn, save/load при persistent state, browser check для render-heavy профилей.

## Запреты

- Новый `FloorLevel` для route-stop, anomaly или номерного лифта.
- Per-frame full-world scan ради одной аномалии.
- DOM/UI-слой, который владеет игровым состоянием.
- Изменение `main.ts`, `core/world.ts` или `render/webgl.ts` ради частного профиля.
- Запирание лифтов, spawn, hermetic/protected комнат или единственного прохода без repair/escape path.
- Бесконечный refill NPC/монстров, маскирующийся под динамику этажа.
