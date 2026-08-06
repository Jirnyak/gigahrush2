# Architecture — gigahrush2

The layered design source of truth. [AGENTS.md](AGENTS.md) holds contributor
rules; [README.md](README.md) orchestrates the per-system docs. This document
describes *how the pieces fit*, not every function.

## The one-sentence model

A **monolithic 128³ macro grid** of typed cells (each cell ~2 m), wrapped as a
**torus** on all three spatial axes; every cell subdivides into an **8³
sub-voxel** blocker mask; arbitrary **typed scalar fields** overlay the grid at
runtime; a **4th coordinate W** stacks whole worlds into a **level stack**;
entities live in a shared **EnTT** registry and are moved by **systems**
(physics, controller, camera, fluid); a **Vulkan** backend **raymarches** the
voxel world per pixel (two-level DDA over a GPU mirror of the same masks
physics collides against, with honest depth) and rasterizes bodies/props/
particles over it.

## Resource model — the frame for everything

This is a **native C++/Vulkan desktop game**. That fixes the cost model:

- **Disk unlimited** → save whole worlds verbatim (all cells + objects),
  persisted as the player explores (Dwarf Fortress / Minecraft style).
- **GPU unlimited — draw *and* compute** → full dynamic lighting/shadows and
  generous overdraw, *plus* every cellular field (fluid/gas/heat/pressure/light)
  runs here as async compute. The GPU is the field engine, not just the renderer.
- **RAM ~8 GB** → generous but finite; the one budget that bounds the dense model.
- **CPU is the bottleneck — it runs the agents** → the player + ~16k embodied
  NPCs/mobs (movement, collision, AI). The agent tick must stay **O(n)** in live
  agents; fields are off-CPU (see the compute split below).
- **Load time unbounded** → do all heavy precomputation (BFS/nav, light maps) at
  load and bake it into flat memory; the tick only does O(1) lookups.

The consequences — **dense over sparse**, **bake at load, tick in O(n)**, the
**CPU-agents / GPU-fields compute split**, **two regimes of re-bake** (ideal at
load/self-assembly, cheap dirty-local for in-play destruction), and the fixed
**N = 128 active floor** — are detailed in [performance.md](performance.md) and
drive every layer below.

## Layers

Dependencies point downward only. Include hygiene enforces this — verify an
`#include` target sits in the same layer or below before adding it.

```
L4  app/      window, main loop, worldgen, module orchestration    ┐ platform
    render/   Vulkan device/swapchain/renderer, cube pass, ImGui   │ side
    input/    SDL3 → ECS bridge                                    ┘
    game/     NPC pool, inventory, event bus, mob table  ───────────► giga_game
------------------------------------------------------------------- giga_core
L2  sim/      physics, controller, camera, fluid  (systems)
L1  world/    macro grid, sub-voxel masks, fields, gravity, level stack
L0  core/     math, toroidal wrap  (pure, header-only, no deps)
    ecs/      EnTT alias + POD components
```

**`giga_core`** = L0–L2 (`src/core`, `src/world`, `src/ecs`, `src/sim`). It has
**no** SDL/Vulkan/ImGui dependency, links only EnTT, and is what the headless
tests link. **`giga_game`** (`src/game`) sits just above it — gameplay
macro-systems that link `giga_core` but still **no** SDL/Vulkan, so they too are
headless-testable (`game_test`) and the society sim ([macrosim.md](macrosim.md))
can run without a GPU. Rendering, input, and the app shell sit on top and pull in
the platform libraries. This seam is deliberate: the simulation must be testable
without a GPU and embeddable in a different host.

## L0 — Core primitives

- [core/math.h](src/core/math.h) — POD `vec2/3/4`, `mat4` (column-major),
  perspective/lookAt. Ships instead of GLM so the core has zero third-party
  includes. See [render.md](render.md) for the Vulkan clip-space caveat.
- [core/wrap.h](src/core/wrap.h) — `wrapi`, `wrapf`, `wrap_delta`. The torus
  math every spatial coordinate flows through.
- [ecs/](src/ecs) — `Registry`/`Entity` aliases over EnTT and the universal POD
  [components.h](src/ecs/components.h). See [ecs.md](ecs.md).

## L1 — World

One `World` (see [world.md](world.md)) = one layer of the stack, owning:

- **MacroGrid** ([macro_grid.h](src/world/macro_grid.h)) — SoA arrays of
  `CellType` + `SubMask`. Toroidal accessors wrap on every axis. See
  [voxels.md](voxels.md).
- **FieldRegistry** ([field.h](src/world/field.h)) — runtime-registered dense
  128³ fields of any POD type, keyed by name, type-checked via an RTTI-free
  `type_tag<T>()`. See [fields.md](fields.md).
- **GravityField** ([gravity.h](src/world/gravity.h)) — a 3D acceleration vector
  plus an optional regional override hook. See [gravity.md](gravity.md).

**LevelStack** ([level_stack.h](src/world/level_stack.h)) owns the ordered
layers indexed by W. x/y/z wrap; **W does not** — `above`/`below` return
`kInvalidLayer` at the ends. This is the storage substrate for **floor modules**
(see [floors.md](floors.md)); note the storage slot (`LayerId`) is distinct from
the mutable in-game floor number.

## L2 — Simulation systems

Free functions over EnTT views, each taking the state it needs plus `dt`:

- **physics** ([physics.md](physics.md)) — vector gravity + jump + swept-AABB
  collision, one axis at a time, against sub-voxel masks. Substeps prevent
  tunneling.
- **controller** ([controller.md](controller.md)) — turns `Controller::wishDir`
  (camera-local intent) into world velocity; walk vs. 6DoF fly.
- **camera** ([camera.md](camera.md)) — derives view/projection from whichever
  entity holds a `CameraTag`. Not a singleton.
- **fluid** ([fluid.md](fluid.md)) — deterministic, mass-conserving cellular
  liquid stored as a runtime field, pooling on sub-voxel terrain. The current
  step is CPU (throttled); as a *cellular field* it is destined for GPU async
  compute like all fields (see [performance.md](performance.md) §The compute
  split).

The **player is not special**: it is the entity that currently owns a
`CameraTag` + `Controller` + physics components. Move those components and the
view/control follow.

## L3 — Platform side

Everything here is a **read-only shell over the sim**: it consumes L0–L2 state to
draw and to feed input in, but the game runs to completion headless with L3
removed. Data flows sim → render, never back (see [render.md](render.md)).

- **render/** — [render.md](render.md): device/swapchain/renderer bring-up plus
  the **voxel mirror** ([src/render/voxel_mirror.h](src/render/voxel_mirror.h))
  — a one-way sim→GPU copy of masks/types/sub-materials/class/fluid kept fresh
  by the existing dirty seams (carve `dirtyCells`, door `dirtyCells`, arrival
  re-uploads) — and the **raymarch pass**
  ([src/render/raymarch_pass.h](src/render/raymarch_pass.h)) that DDA-marches it
  per pixel, writes honest `gl_FragDepth`, places everything at its **nearest
  toroidal image** around the camera (seamless wrap), and fogs to black at the
  `kWorldExtent/2` render radius. Destruction costs the renderer 64 B per dirty
  cell — there is no remesh. Body/prop/particle raster passes share the depth
  buffer; ImGui HUD on top.
- **input/** — SDL3 events → ECS components (yaw/pitch/wishDir/jump) on the
  active camera entity. Writes components, not a hardcoded player. Held
  movement keys come from the keybinding table's axis rows, not constants.
- **keys are data** — every pressed action lives in the **KeybindTable**
  ([src/game/keybind.h](src/game/keybind.h)): a row maps a scancode to a
  **console command line**, the app's event loop does one lookup per keydown,
  and the effect lands as a `ConsoleRequest` bit the app drains at its safe
  frame point (the same client-proposes/server-disposes seam as the console
  teleport). Bound keys, pause-menu buttons and typed console lines all drive
  the same command rows. Rebinding is a pause-menu page; bindings persist to
  `gigahrush2.keys` (the table parses/serializes bytes, the app owns the file
  I/O — the save.h split).

## L4 — App & game layer

Two pieces sit above the core: the **app shell** (`src/app`, `src/input`,
`src/render`), which only the executable links, and **`giga_game`** (`src/game`),
a static library of gameplay macro-systems that links `giga_core` but **not**
SDL/Vulkan/ImGui — so it is headless-testable (`game_test`) exactly like the
core. Data-oriented gameplay state (the NPC pool, inventory, the event bus
([events.md](events.md)), and — pending — the mob table) lives in `giga_game`,
not scattered through `src/app`.

[app/main.cpp](src/app/main.cpp) wires SDL3 + Vulkan + ECS and runs a
fixed-timestep sim (125 Hz — `kSimHz` in [src/core/tick.h](src/core/tick.h), an
exactly-8 ms step) against an uncapped render loop with a HUD.
Geometry comes from **floor modules** under `src/game/floors/<name>/`, claimed by
the floor catalog ([floors.md](floors.md)); `src/game/floor_gen.h` is the dispatch
seam. The old `src/app/worldgen.cpp` demo worlds (maze + khrushchevka stack) and
their launch modes were **deleted 2026-08-02** — [worldgen.md](worldgen.md) is now
a tombstone. The only registered geometric module is `padic`.

**This is where the game lives.** The planned game layer — floor **modules**
(isolated geometry/quests/NPCs/rules per floor), elevators, fast-travel grid,
global monster/loot tables with per-floor weight multipliers, macro NPC
population — is built here on top of the engine primitives, not inside the core.
See [floors.md](floors.md), [monsters.md](monsters.md), [items.md](items.md),
[npcs.md](npcs.md), [macrosim.md](macrosim.md).

**Dressing is a game-layer bake, not a render feature.** `src/game/antourage`
runs over a finished floor and emits mesh primitives anchored to real voxels —
pipes, verlet wires, curtains ([antourage.md](antourage.md)). It lives in
`giga_game` and is headless-testable for the same reason everything else here
is: it touches no GPU type, the app merely packs its rows into the passes.

**Macrosim is its own module — a game within the game.** The macro population
simulation ([macrosim.md](macrosim.md)) is a self-contained, socially/economically
focused society sim that runs in the background of normal play and can be
developed, run, and tested **fully headless** on its own. It reads *up* into the
action game (embodiment) but never depends on it — the same one-way stance the
core has toward render. Remove the 3D front-end and a complete, running society
simulation remains.

## Simulation loop

```
poll SDL events ──► input (feed HUD, accumulate deltas)
while (accumulator ≥ dt):          # fixed 125 Hz (kSimDt, 8 ms exactly)
    input.apply       → write intent onto active camera entity
    controller_step   → intent → velocity
    physics_step      → integrate + collide vs sub-voxel masks
    (fluid_step)      → NOT CALLED: no floor module seeds the field, so the
                        cellular liquid step is absent from the shipped loop
                        (see the call site in main.cpp and problems.md §13)
compute_camera        → view/proj from CameraTag entity
render                → mirror flush (dirty cells → GPU) → raymarch world
                        → body/prop/particle passes → ImGui HUD
```

## Data-driven extension points

| Want | Do | Not |
|------|-----|-----|
| A new cell type | Assign an id + an albedo row in the material table (feeds the raymarcher's UBO) | Engine `if` chains |
| A new world quantity (temperature, light) | `fields().get_or_create<T>("name")` | New struct field on the grid |
| Regional/inverted gravity | Install a `GravityField::region` fn | Branch in physics |
| A new floor | A folder under `src/game/floors/<name>/` + a catalog claim or pattern ([floors.md](floors.md)) | Hardcode a layer index |
| A floor for a whole class of numbers | A pattern row in the floor catalog ("every even", modulo) — an explicit claim overrides it | An `if` chain on the number |
| A new monster / loot | One row in the global table + per-floor weight | Per-floor spawn code |
| A new console command | One `ConsoleCommand` row ([src/game/console.h](src/game/console.h)); args complete from live tables | Key-handler `if`s in the app |
| A new key action | A `KeyBind` row (scancode → console line, [src/game/keybind.h](src/game/keybind.h)) + its command row | A scancode `if` in the event loop |
| A new pause-menu item | A `MenuItem` row in main.cpp (label + console line) | A new ImGui handler with its own logic |

## Determinism

Within a single build, same seed → same world (worldgen and fluid are
deterministic). Cross-build / cross-platform float identity is a non-goal.

## Манифест игры (владелец, 2026-08-01)

Как игра выглядит в финале; каждый пункт — контракт поверх слоёв выше.
Принцип над всем: **максимум контекста, минимум систем** — каждая
формула (урон, спавн, лут, квесты) переиспользует базовые системы;
эмерджентность рождается из их пересечений, не из новых механизмов.

1. **Один активный этаж.** Вся живая игра — на одном 128³-торе (1024³
   разрушаемых атомов-субвокселей). Геометрия этажа — отдельный
   модуль ([floors.md](floors.md)), любая сколь угодно сложная структура,
   заполняющая тор. Переход между этажами — всегда загрузка.
2. **Макропопуляция — ИСТОЧНИК ИСТИНЫ.** Холодная таблица всего
   населения (~2²⁰ строк), ВСЕ NPC включая игрока; ролевые строки
   (имя/фамилия/инвентарь/уровень/атрибуты/отношения/перки/характер/
   жильё, расширяемо). **Игрок = NPC** с камерой на голове (`NpcPlayer`-бит,
   `possess` пересаживает). Фоном — холодная социально-экономическая
   симуляция миграций и отношений ([macrosim.md](macrosim.md)).
3. **Цикл воплощения.** Загрузка этажа: генерация геометрии → болванки
   NPC/мобов по дизайну модуля → контекстное data-driven воплощение строк
   макропопуляции в них. Уход с этажа / сейв → fold-back всех воплощённых
   обратно в пул. Константа: ≤ 16k воплощённых на этаже. Синхронизация
   макро↔этаж прямо в живой симуляции допустима, если ≤ O(n) —
   осторожно: макропопуляция — миллион строк.
4. **Карта путей, комнаты-зоны, лифты, самосбор.** После генерации —
   запекание навигации по 1024³-геометрии с учётом торических швов
   ([nav.md](nav.md)); горячий тик читает её за O(1). **Комнаты — поля на
   128³**: зоны интереса для AI по нуждам (туалеты, кухни, цеха, курилки),
   жилые — неразрушимые гермоубежища (персистентные маски гермостен/
   дверей/лифтов переживают и самосбор, и разрушение); зоны **контекстно
   привязываемы к id** (логово конкретного моба, любимая комната NPC) —
   субстрат эмерджентных социальных сценариев (два NPC назначают свидание
   в зоне и реально идут туда; вечеринки; NPC навещает место — всё через
   одну систему зон + макро-планы); у монстров — свои
   зоны (логова: таскают трупы, отступают). **Лифты**: 4×4 фиксированных
   fast-travel + 4×4 случайных процедурных «вниз» + 4×4 «вверх» — столбы во
   всю высоту с интеракцией меню перехода; **сетка fast-travel одинакова и
   симметрична на всех этажах** — пространственный ориентир для игрока.
   **Самосбор — центральная кризис-механика, GPU-first**: сирена → волны
   в реалтайме разъедают и заращивают мир на уровне субвокселей (стена
   зарастает проходом, пол исчезает — реальная опасность для всех; NPC бегут
   к гермодверям). Архитектура: волна = **целочисленный клеточный
   автомат-стенсил на GPU** поверх зеркала масок (без флоатов и атомик-
   гонок → бит-точно на любом GPU → реплей от (seed, tick) без пересылки
   масок); GPU **предлагает** компактный op-list, CPU-истина **применяет**
   его к маскам и перезаливает dirty через существующий шов зеркала (тот
   же client-proposes/server-disposes); волна читает поле гермозащиты и не
   трогает персистентные зоны. После волны: затронутое помечено → модуль
   этажа генерит свежую геометрию и сшивает на место → полное перепекание
   (regime-1 из [performance.md](performance.md)) → игра продолжается с
   последствиями.
5. **RPG и бой.** 8 атрибутов (степень двойки для хранения): сила (+1%
   ближний урон), ловкость (скорость перезарядки; ближнее оружие = магазин
   на 1 — единая система), интеллект (+1% пси-урон, +1% XP), харизма (цены,
   +1 отношения, награды контрактов), сила воли (+1% пси — симметрично
   живучести), выносливость (+1 кг веса), живучесть (+1% HP), скорость (+1%
   хода).
   Уровень = +1 очко атрибута, каждый второй — +1 перк. **Перки — референс
   Fallout/Underrail**: от чистых статов до событий и изменений мира от
   носителя; гейтятся любым числом игры (атрибут/уровень/карма/…) или
   безусловны. База: 8 очков атрибутов + 1 перк, HP 100. **Пси — сильное и
   редкое (РЕШЕНО)**: пул 100 симметрично HP; пси-удар — 10 урона за 1 пси,
   гейм-ченджеры ~100 = полный бар, плавная градация между. Реген пси —
   ТОЛЬКО при полном сне, очень медленно (~1%/с при max сне — аналогично
   HP-от-еды) плюс предметы (антидепрессанты и пр.).
   Атрибуты влияют контекстно везде (нужды, проверки в интеракциях,
   требования экипировки). **Бой**: типы урона × типы брони — сейчас РАБОЧИЙ
   СКЕЛЕТ на существующих пяти резистах (kinetic/buckshot/energy/fire/psi),
   баланс и расширение — потом (% сопротивления; только топ-броня
   универсальна, остальная ситуативна).
   Монстры — без инвентаря/атрибутов, чисто таблица (hp/урон/скорость/типы).
   **Урон рушит мир**: тип урона × материал = вероятность сноса субвокселя
   (расширение carve-ролла [destruct.md](destruct.md); у материала НЕТ HP —
   очередь из автомата лишь царапает краску). **Инвентарь** 8×8 + вес (50 кг
   база) + слоты оружие/броня/пси/инструменты (заряд/прочность — фонарик).
   **Нужды тикают У ВСЕХ воплощённых** — держатель камеры ничем не особенный
   (тот же закон, что «игрок не специален»).
   **Снаряды — честная баллистика в торе**, никаких friendly-fire-исключений;
   граната скачет по вокселям, осколки бьют и владельца. Смерть — дроп
   инвентаря на этаж (маркеры сюжетных квестов переживают смерть
   квестодателя на дропе). **Смерть игрока (РЕШЕНО)**: главное меню
   (можно грузиться) ИЛИ переселение в случайного NPC макропопуляции
   (твой труп с лутом остаётся на этаже); респавнов НЕТ. XP — за убийства
   (таблицы + контекст уровня) и квесты (линейная сюжетная цепочка +
   процедурные квесты/ивенты). |absN| этажа = уровень опасности → монстры,
   лут, уровень жителей.
6. **Технические константы цели.** **16k воплощённых — КОНСТАНТА**, на
   которую ориентируется вся игра; 1024³ разрушаемый живой изотропный
   этаж — техническая цель. **Запекать на загрузке — МНОГОПОТОЧНО**: всё,
   что можно генерить/запекать параллельно с последующей сшивкой — делать
   так (результат статичен, синхронизации нет — бесплатная скорость
   загрузки; без фанатизма, но по умолчанию — да).

Старый прототип `/Users/jirnyak/Mirror/gigahrush` — справочник решений
(интеракторы навешиваются на пропы/фичи этапом генерации, сшивка
самосбора, квесты) — но не образец кода.

### Конфликты и зазоры манифест ↔ код (сверено 2026-08-01)

| Манифест | Сегодня в коде | Статус |
|---|---|---|
| 8 атрибутов | `Attr{Str,Agi,Int}` ([rpg.h](src/game/rpg.h)); пул УЖЕ держит 8 слотов (3..7 свободны, засеяны) | **КОНФЛИКТ**: расширить enum + `RpgStats.attr[8]` (12→16 Б), пересадить производные (сейчас STR→HP+melee, AGI→move+attack+spread, INT→psi+xp+награды), сейв-версия |
| Пси | `kBasePsi = 100`, +1/уровень, max от INT +1% | **РЕШЕНО НА БУМАГЕ, пул инертен**: числа есть ([rpg.h:110-111]), но пси никто не тратит и не восстанавливает — `adjusted_psi_cost`, `int_psi_cost_mult_e3`, `int_psi_duration_bonus_sec` не имеют вызовов вне тестов, пси-урона нет, регена во сне нет, `UseEffect::HealPsi` (7 строк items.csv) и `PsiSurge` не диспатчатся. [problems.md] §35 |
| Перки (Fallout/Underrail: статы → события → мир) | нет системы (XP-кривая и очки атрибутов есть) | **GAP**: таблица + гейты + эффекты-модификаторы + хуки через событийную шину ([events.md](events.md)) |
| Типы урона/брони | в данных УЖЕ 5 резистов: kinetic/buckshot/energy/fire/psi (items.csv), `damageType` частично в combat | **ПОЧТИ**: сверить номенклатуру (колющий=kinetic? дробящий=buckshot?) и довести до боя |
| Тип урона × материал | carve: один скаляр power vs hardness | **GAP**: колонки типов в [material_props.h](src/world/material_props.h) — data-driven, без HP |
| Инвентарь 8×8 + слоты | `kInvSlots = 64 = 8×8`, `equip_slot` в items.csv | **ЧАСТИЧНО**: 8×8 ✓, но слотов экипировки НЕТ — `equipSlot` читается в одном месте и только сравнивается с `Armor` (`combat.cpp:724`); оружие выбирается автоматически по лучшему стату (`ranged_pick.cpp:6`), `Tool` не проверяет никто. `stackMax` соблюдается непоследовательно ([problems.md] §35) |
| Вес (50 кг + выносливость) | в items.csv нет колонки веса, системы нет | **GAP** (CSV + генератор + гейт) |
| Нужды еда/вода/туалет/сон | `Needs{food,water,sleep,pee,poo}` + needs_step | **ЧАСТИЧНО, решение НЕ реализовано**: структура ✓, но `needs_step` до сих пор выходит по `find_player(...) == entt::null` и тикает РОВНО ОДНУ строку — держателя камеры ([needs.cpp:239-243], [needs.h:25] «TICK SCOPE: ONLY THE CAMERA HOLDER»). Решение «тик у ВСЕХ воплощённых» принято и не написано; из-за этого скорер утилити-ИИ схлопывается в константу — [problems.md] §27 |
| Игрок = NPC, possess | `NpcPlayer`-бит, `possess` | **СОВПАДАЕТ** ✓ |
| Макропопуляция = источник истины, fold-back | streamer/embody/fold-back, сейв несёт пул verbatim | **СОВПАДАЕТ** ✓ |
| Комнаты-зоны как поля 128³ | комнаты в floor_gen, `spawn_rooms` в лут-таблице; зонального поля для AI-нужд нет | **ЧАСТИЧНО** |
| Гермо-комнаты неразрушимые | механизм `kHardnessUnbreakable` есть; жилых гермозон нет | **ЧАСТИЧНО** |
| Лифты 4×4 fast + 4×4↓ + 4×4↑ столбами | hub-пады на z-уровнях {16,48,80,112} + extract-пады + [/]-ride | **КОНФЛИКТ раскладки** (см. [elevators.md](elevators.md)) |
| Самосбор-перестройка + сшивка + ребейк | сирена/туман/duty/варианты есть; волновой перестройки геометрии НЕТ | **GAP, дизайн ЗАФИКСИРОВАН** (GPU-стенсил + op-list → CPU-истина; см. манифест п.4) |
| Баллистика снарядов | `projectile_step` + carve от попаданий | **КОНФЛИКТ**: `Projectile::team` вводит ТРИ friendly-fire-исключения, прямо запрещённых манифестом — пуля игрока не может задеть NPC (`combat.cpp:1066`), выстрел монстра не может задеть монстра (`:1035`), снаряд не может задеть владельца (`:1013`, `:1038`). Гранат нет вовсе: все 19 не-`Normal` стволов отложены ([ranged_table.h:20-27]). [problems.md] §33 |
| Квесты: линейка + процедурные | quests.csv + suite_quest; процедурные/ивенты частично ([events.md](events.md)) | **ЧАСТИЧНО, и XP за квесты НЕТ**: `quest_step` (`quest.cpp:433-447`) и `contract_step` (`contract.cpp:356-363`) платят только деньгами (+предмет у квеста), при том что манифест п.5 требует XP за квесты, а `xp_for_quest` (`rpg.cpp:300`) написан и не имеет НИ ОДНОГО вызова вне тестов. Плюс цель Hunt засчитывает ЛЮБУЮ смерть моба, включая убийства монстрами и хазардами ([problems.md] §40) |
