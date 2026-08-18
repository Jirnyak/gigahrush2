# Аудит сущности «ОБЪЕКТ В МИРЕ»

Репозиторий `/Users/jirnyak/Mirror/gigahrush2`, ветка `torus`, дата проверки 2026-08-17.
Всё ниже перепроверено чтением файлов сегодня; комментарии в коде как доказательство не принимались.

---

## 0. Одной строкой

**У объекта в мире НЕТ поля «вид».** Вид выводится из НАЛИЧИЯ компонента, и это не описка,
а несущая конструкция: `clear_layer_props` считает «статическим пропом» всё, у чего есть
`SubVoxelAnchor` (`src/game/prop_system.cpp:331`), а `container.cpp` вешает `SubVoxelAnchor`
на ящик (`src/game/container.cpp:357`). Отсюда — уничтожение всех ящиков на всех этажах
в момент появления. Это первое и главное проявление категорийной ошибки; остальные
перечислены в §2.

---

## 1. Перепись представлений

Ниже — всё, что сегодня является «штукой в мире, на которую можно смотреть / наткнуться /
повзаимодействовать / сломать». **Девять** независимых представлений (плюс два мёртвых).

| # | Представление | Где спавнится | Якорь | Компоненты | Как рисуется | Ответ на карв | Поиск по близости | Сейв | Уничтожение при смене этажа |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Проп (статический)** | `prop_system.cpp:239 spawn_prop` / `:278 spawn_prop_from_id`; сеятели `:340 seed_wall_interactables`, `:422 seed_ceiling_lights`, `room_zone.cpp:478 seed_room_furniture`, `floors/padic/padic_module.cpp:20 seed_padic_props` | `SubVoxelAnchor` (клетка + субвоксель + face) `prop_system.cpp:255` | Transform, SubVoxelAnchor, Interactable, PropFallMode, Renderable, StaticPropTag, PropMeshTag, PropMesh, Mass, (PropLight) | PropPass через `collect_static_prop_mesh_instances` (`prop_system.cpp:511`) → `main.cpp:1303` | ДА — `anchor_validate_step` (`prop_system.cpp:181`) | `find_nearest_interactable` (`prop_system.cpp:539`) | **НЕ сохраняется** (детерминированный пересев) | `clear_layer_props` (`prop_system.cpp:325`) |
| 2 | **Проп отцепленный** | `detach_single_prop` (`prop_system.cpp:58`) снимает `SubVoxelAnchor`, ставит `DynamicBodyTag`+`GravityAffected`+`Velocity`(+`AngularVelocity`/`Rotation` для Ragdoll) | нет | Transform, AABB(**хардкод 0.2 м**, `:130`), Renderable, PropMesh, DynamicBodyTag | **BodyPass** как куб (`body_pass.cpp:284` пропускает `StaticPropTag`) | — | никак (Interactable остаётся, но объект уже не там где рисуется) | нет | **никак** — потерял `SubVoxelAnchor`, `clear_layer_props` его не видит; сметает только `FloorStreamer::unload` (`floor_stream.cpp:437-444`) |
| 3 | **Контейнер (ящик)** | `container.cpp:289 spawn_floor_containers` — **параллельный спавнер вне prop_system** | `SubVoxelAnchor` (`container.cpp:357`) + `PropFallMode::SimpleFall` (`:358`) | Transform, AABB(`kContainerHalf`), Renderable, SubVoxelAnchor, PropFallMode, Container. **`Interactable` НЕТ** | **BodyPass** как куб | ДА — попадает во view `anchor_validate_step` (Transform+SubVoxelAnchor+PropFallMode) | **свой ручной скан** `main.cpp:4111-4124` по `kContainerReach` | `ContainerRecord` по ключу (этаж, клетка) `save.cpp:771 container_key` | `refresh_floor_containers` (`main.cpp:1030-1033`) **И** `clear_layer_props` (баг) |
| 4 | **Дверь** | `door.cpp:85 door_build` — **не сущность ECS вообще**, POD в `DoorSet` + плотный индекс на 128³ | клетка сетки; лист = материал `kMatDoor` в самой сетке | нет компонентов | **как воксели мира** (raymarch), листа-меша нет | ПИШЕТ в карв: `doors.dirtyCells` (`door.cpp:59/67`) | `door_toggle_near` / `door_query_near` (`door.cpp:219/272`), кубическая окрестность 5×5×3 + `kDoorReach` | часть файла этажа (геометрия) | `door_build` очищает `doors.doors`/`doors.index` (`:92-95`) |
| 5 | **Труп** | `combat.cpp:640` в `finalize_deaths` (переиспользует ТУ ЖЕ сущность моба/НПЦ) + `save.cpp:903 spawn_corpse_records` (создаёт НОВУЮ, без MobRef) | нет | Transform, AABB, Renderable, Corpse, Interactable{Corpse, **2.2f хардкод**} | **BodyPass** (труп моба — старый куб тела) | — | `find_nearest_interactable` (главный путь) + мёртвый `loot_corpse_interact` (`loot.cpp:465`) | `CorpseRecord` (`save.h:471`), своя запись | `despawn_layer_mobs` (если сохранил `MobRef`) ИЛИ `spawn_corpse_records` (destroy-first, `save.cpp:888-895`). Труп НПЦ без MobRef — только вторым путём |
| 6 | **Брошенный/выпавший предмет** | `loot.cpp:222 spawn_floor_loot`, `loot.cpp:289 drop_weapon_ammo`, **и третий, отдельный, в UI**: `main.cpp:5990` (Drop) | нет | Transform, Velocity, AABB, GravityAffected, Renderable, Pickup, Mass, Interactable{Loot, `kPickupReach`} | **BodyPass** | — | `pickup_step` (`loot.cpp:370`) — свой скан; `Interactable::Kind::Loot` **никто не опрашивает** | нет | **нет своей очистки** — только `unload` |
| 7 | **Антураж: инстанс** (трубы, радиаторы) | `bake_antourage` (`antourage.h:167`), владелец — `FloorStreamer` | `ax0..az1` две клетки + `face` | не ECS вообще (POD в `AntourageBake`) | PropPass, второй фидер (`main.cpp:1326-1350`) | ДА — `antourage_carve_step` (`antourage.cpp:856`), + живость-проба `antourage_alive` каждый merge | никак | нет (чистая функция от seed) | `antourage_[m].reset()` (`floor_stream.cpp:415`) |
| 8 | **Антураж: провода / тенты** | там же | `ax0..az1` + `pinMask` | POD `WireChain` / `ClothSheet` | **WirePass / ClothPass** — два отдельных пути (`main.cpp:6996/6997`) | ДА — `wire_live_pins`/`cloth_live_pins` | никак | нет | там же |
| 9 | **`DetachedPiece`** (отвалившаяся труба) | `antourage_carve_step(..., fell)` (`antourage.cpp:882`) | нет | POD в `std::vector` в `main` (`main.cpp:1751`) | PropPass, **третий фидер** (`main.cpp:1356-1367`) | — | никак | нет | вектор живёт в кадре main |
| 10 | **Частица** | `ParticleBurstQueue` → `particlePass.spawn` | нет | GPU SSBO | ParticlePass | коллизия о воксельное зеркало на GPU | никак | нет | пул |
| 11 | **Снаряд** | `combat.cpp:1177/1220/1264` | нет | Transform, Velocity, AABB, Renderable, SelfIntegrating | BodyPass | — | `projectile_step` | нет | `unload` |

Итого **пять** независимых путей отрисовки (BodyPass, PropPass, WirePass, ClothPass, ParticlePass),
**три** фидера у одного PropPass, **три** модели якоря (`SubVoxelAnchor` / пара клеток `ax0..az1` /
никакого), **шесть** живых запросов близости (+2 мёртвых), **две** параллельные модели HP
(`Health` через `apply_damage` — только у тел; `Door::hp` — `door.cpp:387`), **ни одного**
поля вида.

`CubePass` больше НЕ рисует объекты: он остался держателем текстур и pipeline layout
(`src/render/cube_pass.h:1-16`), `cubePass.record` в `main.cpp` отсутствует (grep по файлу:
только `init`/`destroy`/`pipeline_layout`). Прошлый счёт «3 пути отрисовки» устарел
в лучшую сторону; актуальные — 5.

---

## 2. КАТЕГОРИЙНАЯ ОШИБКА: компонент подменяет вид

### 2.1 БАГ (живой, критический): все ящики уничтожаются при появлении

* `src/game/prop_system.cpp:325-338` — `clear_layer_props` берёт `reg.view<const SubVoxelAnchor, const Transform>()`
  и уничтожает **всё** на слое. Комментарий на `:328-330` прямо утверждает «SubVoxelAnchor marks
  every static prop» — это и есть подмена вида наличием компонента.
* `src/game/container.cpp:357-358` — ящик получает `SubVoxelAnchor` и `PropFallMode` («Connect to
  physical prop system for gravity/destruction»).
* Порядок вызова во **всех четырёх** точках прибытия:
  * `src/app/main.cpp:1967` (containers) → `:1968` (props) — старт игры;
  * `src/app/main.cpp:2602` → `:2603` — поездка на лифте;
  * `src/app/main.cpp:4795` → `:4808` — загрузка F9 (между ними ещё `apply_container_records` на `:4797`
    и `spawn_corpse_records` на `:4803` — **тоже впустую**);
  * `src/app/main.cpp:7122` → `:7124` — второй travel-сайт (`--shot`/консоль).
* `refresh_floor_props` первой строкой (`src/app/main.cpp:1072`) зовёт `clear_layer_props`.

Следствие: `spawn_floor_containers` вернул N, через кадр в реестре 0 `Container` на слое.
Восстановленные из сейва записи (`apply_container_records`) стираются вместе с ящиками.

**Почему гейты это не ловят.** `tests/suite_audit.inl:977-1035` и `tests/suite_saveload.inl:987`
зовут `spawn_floor_containers` напрямую и **никогда** не зовут `refresh_floor_props` —
порядок прибытия не воспроизводится ни одним тестом. `tests/suite_props_game.inl:127-128`
проверяет только «`clear_layer_props` не трогает чужой слой». То есть шов доказан
в изоляции и ни разу — в реальном порядке.

### 2.2 Остальные проявления той же ошибки

| Место | Компонент | Подменяемый вид | Классификация |
|---|---|---|---|
| `prop_system.cpp:331` | `SubVoxelAnchor` | «статический проп этажа» | КАТЕГОРИЙНАЯ-ОШИБКА (корень §2.1) |
| `prop_system.cpp:147`, `:195` | `<Transform, SubVoxelAnchor, PropFallMode>` | «то, что отваливается от карва» — ящик сюда попадает случайно, не по замыслу | КАТЕГОРИЙНАЯ-ОШИБКА |
| `body_pass.cpp:284` | `StaticPropTag` | «это мебель, её рисует PropPass» — рендер-путь определяется наличием тега, а не видом | КАТЕГОРИЙНАЯ-ОШИБКА |
| `prop_system.cpp:52 mark_dynamic` | swap `StaticPropTag`↔`DynamicBodyTag` | смена состояния = смена *вида* для рендера | КАТЕГОРИЙНАЯ-ОШИБКА |
| `mob_spawn.cpp:433-442` | `MobRef` | «это моб, снести при смене этажа» — но `MobRef` остаётся на **трупе** (`combat.cpp:640` переиспользует сущность), поэтому трупы мобов сносятся как мобы, а трупы НПЦ — нет | КАТЕГОРИЙНАЯ-ОШИБКА / БАГ |
| `main.cpp:1031` | `Container` | «это ящик» — единственное место, где вид определён компонентом-данными, а не тегом; и именно оно конфликтует с §2.1 | ДУБЛЬ |
| `main.cpp:4087`, `:6456` | `reg.all_of<game::Corpse>` поверх `Interactable::Kind::Corpse` | вид спрашивается ДВАЖДЫ, двумя разными способами подряд | ДУБЛЬ |
| `floor_stream.cpp:437-444` | «всё, что на слое» | единственная честная универсальная уборка — и она вне всякой типизации | — |

**Поля «вид» нет.** Ближайшие суррогаты, все частичные и несовместимые:
`Interactable::Kind` (6 значений, только «как со мной взаимодействовать»),
`PropFallMode` (3 значения, только «как я отваливаюсь»), `PropMesh::shape` (только меш),
`Container::kind`, `Corpse::mobKind`, `MobRef::kind`. Ни одно не отвечает на вопрос
«что это за штука».

---

## 3. Запросы близости и «reach»

### 3.1 Реализации «что рядом со мной»

| Функция | file:line | Дальность | Y на торе? | Живая? |
|---|---|---|---|---|
| `find_nearest_interactable` | `prop_system.cpp:539` | параметр вызывающего | **НЕТ** (`:562` `dy = ppos.y - tr.pos.y`) | да, главный путь |
| `interaction_step` | `prop_system.cpp:576` | **зашито 3.0f** (`:581`) вместо `interact_def` | наследует | не вызывается из main |
| `prop_interact_step` | `prop_system.cpp:636` | обёртка над предыдущей | — | **МЁРТВАЯ** (нет вызовов вне тестов) |
| `collect_interactable_positions` | `prop_system.cpp:494` | без дальности вообще | — | не вызывается из main |
| ручной скан ящиков | `main.cpp:4111-4124` | `kContainerReach` = 2.4 | да (все три wrap) | да |
| `pickup_step` | `loot.cpp:370-376` | `kPickupReach` = 1.8 | да | да |
| `loot_corpse_interact` | `loot.cpp:465-483` | параметр `maxReach` | **НЕТ** (`:476`) | **МЁРТВАЯ в игре** — вызовов в `src/` нет, только `tests/suite_props_game.inl:607` |
| `loot_containers_step` | `container.cpp:388-396` | `kContainerReach` | да | **МЁРТВАЯ в игре** (`main.cpp:4595` — «из тика выписан») |
| `door_toggle_near` / `door_query_near` | `door.cpp:219` / `:272` | `kDoorReach` = 3.0 (`door.h:110`) | да | да |
| `possess_nearest_survivor` | `main.cpp:1469-1486` | **8.0f** (`main.cpp:4257`) | **НЕТ** (`:1482`) | да |
| подсказка possess в HUD | `main.cpp:6470-6483` | **6.0f** (`:6479`) | **НЕТ** (`:6477`) | да |
| проверка живости собеседника | `main.cpp:6193-6196` | `interact_def(Npc).reachM + 1.0f` | да | да |
| `check_projectile_prop_hits` | `prop_system.cpp:133` | `projHitRadius` | да | **МЁРТВАЯ** — вызовов нет нигде |
| `leaf_occupied` (дверь) | `door.cpp:45-54` | пересечение AABB | да | да |
| медик | `ai.cpp:722-727` | `kMedicReachM` = 2.0 (`role.h:150`) | да | да |
| `push_cell_containers` | `combat.cpp:598-608` | равенство клетки | — | да |

**БАГ (изотропия/тор).** Шесть мест считают dx и dz через `wrap_delta_f`, а dy — вычитанием:
`prop_system.cpp:562`, `loot.cpp:476`, `main.cpp:1482`, `:3606`, `:3636`, `:6477`.
Прямое нарушение закона изотропии (`AGENTS.md` / memory `isotropy-law`): по оси Y объект
за швом тора невидим для взаимодействия, по X и Z — виден. Это ЦЕНТРАЛЬНАЯ функция
взаимодействия, а не периферия.

### 3.2 Написания дальности и расхождения

| Написание | file:line | Значение | Кто читает |
|---|---|---|---|
| `InteractDef::reachM` (CSV) | `interact_table.h:38-45` | 4.0 / 3.5 / 2.5 / 2.2 / 2.0 / 2.2 | главный источник |
| `Interactable::reachM` (на сущности) | `prop_system.h:37`, пишется `prop_system.cpp:258` (2.5) и `:303` (из `props.csv`) | 2.5 у всех 9 строк | **НИКТО. МЁРТВЫЕ ДАННЫЕ** — `find_nearest_interactable` его не читает (`prop_system.cpp:539-574`); единственное чтение в `tests/suite_props_game.inl:588` |
| `PropDef::reachMm` (props.csv `reach_mm`) | `prop_table.h:66`, все 9 строк = 2500 | милли**метры** | только в мёртвое поле выше |
| `WeaponDef::reachMm` | `weapon_table.h:31` | **клетки ×1000** (`combat.cpp:2283` домножает на `kCellSize`) | бой |
| `kPickupReach` | `loot.h:91` | **1.8** | `pickup_step` |
| `kContainerReach` | `container.h:90` | **2.4** | ящики |
| `kDoorReach` | `door.h:110` | 3.0 | двери |
| `kMedicReachM` | `role.h:150` | 2.0 | ИИ |
| `kExtractReachZ` | `extraction.h:86` | 2.5 | пад |
| литерал `3.5f` | `main.cpp:4203` | 3.5 | щиток, действие E — дубль строки CSV |
| литерал `2.2f` | `combat.cpp:645`, `save.cpp:919` | 2.2 | труп при создании — дубль строки CSV |
| литерал `3.0f` | `prop_system.cpp:581` | 3.0 | `interaction_step` — не совпадает ни с чем |
| литерал `2.2f` | `main.cpp:3609` | 2.2 | харнесс `--shot corp` |
| литералы `8.0f` / `6.0f` | `main.cpp:4257` / `:6479` | **расходятся** | possess: действие 8 м, подсказка 6 м |

**Одно действие — две дальности:**
* possess: 8.0 (действие) vs 6.0 (подсказка) → **РАСХОЖДЕНИЕ**, подсказка молчит там, где P сработает.
* подбор с пола: `kPickupReach`=1.8 (реальное действие) vs строка `loot` в CSV = 2.0
  (никем не читается) → **РАСХОЖДЕНИЕ-С-КАНОНОМ**: таблица объявлена «источником», но
  подбор её игнорирует.
* труп: 2.2 в CSV, 2.2 литералом в двух местах — совпадают сегодня, но три независимых копии.
* Двери: `kDoorReach` = сфера 3.0 м **поверх** кубической выборки `dx∈[-2,2], dy∈[-2,2], dz∈[-1,1]`
  клеток = ±4 м по XY и ±2 м по Z (`door.cpp:228-230`) — форма поиска и форма отсечения
  не совпадают, по Z дверь достаётся с 2 м, по XY — с 3 м.

### 3.3 Подсказка HUD vs действие E — перепроверено, порядки разные

| Приоритет | HUD (`main.cpp:6397-6505`) | Действие E (`main.cpp:4070-4250`) |
|---|---|---|
| 1 | Дверь (клавиша `door`, Q) | **Труп** |
| 2 | Terminal | **Ящик** |
| 3 | ElectricalShield | **NPC** |
| 4 | **Труп** | Terminal |
| 5 | Possess (клавиша `possess`) | ElectricalShield |
| 6 | Лифт (клавиша `elevator`) | Облегчение (relief) |
| 7 | Облегчение | — |

* **Ящик и NPC не имеют подсказки вообще** — два из шести живых действий E невидимы игроку.
* Truп в HUD четвёртый, в действии первый: стоя у терминала над трупом, игрок видит
  «TERMINAL (DOOR LOCKS)», а E открывает обыск трупа.
* Из шести строк `data/interactables.csv` до экрана доходят **три**: `terminal`, `electrical_shield`,
  `corpse` (`main.cpp:6424`, `:6441`, `:6460`). `light_bulb` не опрашивается нигде; `loot`
  привязан (`loot.cpp:251`, `:310`, `main.cpp:6009`), но `find_nearest_interactable(Loot)` не
  вызывается ни разу; `npc` привязан и опрашивается только в действии (`main.cpp:4150`),
  подсказки не имеет. Итог: **3/6 на экране, 2/6 привязаны и не опрашиваются**
  (`light_bulb` — вообще ни то ни другое) — прошлая формулировка подтверждена.

---

## 4. Пути отрисовки

| Путь | Что рисует | Фильтр | file:line |
|---|---|---|---|
| **BodyPass** | тела, ящики, трупы, пикапы, снаряды, отцепленные пропы | `<Transform, AABB, Renderable>` минус `CameraTag` минус `StaticPropTag` | `body_pass.cpp:278-298` |
| **PropPass** (фидер 1) | статические пропы ECS | `<Transform, PropMesh, StaticPropTag>` | `prop_system.cpp:516`, `main.cpp:1303-1316` |
| **PropPass** (фидер 2) | инстансы антуража | живость-проба по сетке | `main.cpp:1326-1350` |
| **PropPass** (фидер 3) | `DetachedPiece` | пока `life > 0` | `main.cpp:1356-1367` |
| **WirePass** | верлет-цепи | `upload_wires` | `main.cpp:1136-1159`, draw `:6996` |
| **ClothPass** | верлет-полотна | `upload_cloths` | `main.cpp:1163-1183`, draw `:6997` |
| **ParticlePass** | GPU-пул | — | `main.cpp:7000` |
| ~~CubePass~~ | **ничего** — только текстуры и pipeline layout | — | `cube_pass.h:1-16`; в `main.cpp` нет `cubePass.record` |

**Что мешает одному пути.** Три разные геометрии (единичный куб по AABB / каталог `PropShape`
по масштабу / верлет-точки) и три разных источника данных (ECS-компоненты / POD-вектор bake /
POD-вектор falling). Объединяемы 1+2+3: и BodyPass, и оба ECS-фидера PropPass читают
`Transform` — разница только в том, есть ли меш. Ящик рисуется кубом BodyPass **только
потому**, что ему не дали `PropMesh`, хотя `props.csv` умеет описать ящик одной строкой.
Верлет-примитивы (7,8) и частицы (10) не объединяются законно: у них своя динамика на GPU.

---

## 5. Ответ на карв

Два ответчика, вызываемые **подряд, три раза, в трёх местах**:

| Место | Причина карва | Строки |
|---|---|---|
| консольный/оружейный carve | `carve_sphere` | `main.cpp:4053` (`anchor_validate_step`) + `:4062` (`antourage_carve_step_here`) |
| боевой carve (гранаты) | `combatCarves` | `main.cpp:4407` + `:4414` |
| двери | `doors.dirtyCells` | `main.cpp:6747` + `:6754` |

Оба принимают **один и тот же вход** (`std::vector<uint32_t>` плоских `macro_index`), оба
отвечают на **один и тот же вопрос** («мой якорь ещё держит?»), оба **шлют всплеск частиц
той же очереди**, оба **возвращают «надо перепаковать PropPass»**. Разница только в том,
где лежат данные: ECS (`prop_system.cpp:195` view) против `AntourageBake` (`antourage.cpp:856`).
Третьего ответчика нет; проверено grep'ом по `dirtyCells`.

Асимметрия внутри: антураж проверяет живость **каждый merge** через `antourage_alive`
(`main.cpp:1327`) — то есть у него есть и событийный, и поллинговый путь; у пропов только
событийный. Поэтому карв, чей `dirtyCells` до пропа не доехал (например, восстановление
файла этажа), оставит проп висеть в воздухе, а трубу — нет.

Дверь как объект отвечает на карв **никак**: у неё свой HP (`door.cpp:387`), карв сферы
`kMatDoor` просто снесёт материал, а `DoorSet` продолжит считать дверь целой.

---

## 6. Мёртвое и недостижимое

| Что | file:line | Проверка |
|---|---|---|
| `check_projectile_prop_hits` | `prop_system.cpp:133-179` | вызовов в `src/` **ноль** — снаряды не попадают ни в пропы, ни в антураж |
| `prop_interact_step` | `prop_system.cpp:636-639` | вызовов вне тестов нет |
| `interaction_step` | `prop_system.cpp:576-586` | из main не вызывается; внутри зашитая 3.0f |
| `collect_interactable_positions` | `prop_system.cpp:494-509` | из main не вызывается |
| `loot_corpse_interact` | `loot.cpp:465` | вызовов в `src/` нет — только комментарии (`main.cpp:4079`, `:6447`) и тест. **Следствие-БАГ:** ветка «пустой обысканный труп гасит `Interactable.active`» (`loot.cpp:574-578`) никогда не выполняется, HUD вечно предлагает «LOOT CORPSE (REMAINDER)». Ручной путь (`mark_if_empty`, `main.cpp:5849-5856`) ставит `searched=true` и **не** гасит `Interactable` |
| `loot_containers_step` | `container.cpp:367` | из тика выписан (`main.cpp:4595`). **Следствие-БАГ:** `kOpenColour` (`container.cpp:25`) достижим только оттуда, `apply_container_records` зовут без `openedColour` (`main.cpp:2608`, `:4797`, `:7128`; параметр по умолчанию `nullptr`, `save.h:665`) → **опустошённый ящик никогда не темнеет**, весь замысел «видно, где ты уже был» мёртв |
| `InvUiRequest::Kind::Use` | шлётся `inventory_ui.cpp:386`, ветки в `main.cpp` нет (`switch` `:5869-5061`, `default:` на `:6057`), плюс `policy.allowUse = false` (`main.cpp:5714`) | глагол «Использовать» недостижим дважды |
| `Interactable::reachM` | `prop_system.h:37` | пишется в двух местах, читается только тестом |
| `PropDef::reachMm` | `prop_table.h:66` | питает только мёртвое поле выше |
| строка `light_bulb` в `interactables.csv` | `interact_table.h:41` | ни `find_nearest_interactable(LightBulb)`, ни подсказки — лампа помечена интерактивной и ничего не делает |
| `Interactable::Kind::Loot` | `loot.cpp:251`, `:310`, `main.cpp:6009` | компонент вешается трижды, запрос по нему — ноль раз |
| `door_shut_all` | `door.cpp:305` | вызовов вне тестов нет |
| `door_nearest_shelter` | `door.cpp:434` — сам говорит, что `world` не используется | вызывается из `ai_step`; параметр мёртв |
| виды объектов, которых никто не спавнит | — | `ContainerKind` все 4 спавнятся; `PropId` — все 9 строк `props.csv` спавнятся; `PropFallMode::GpuHandoff` **не назначен ни одной строке CSV** (все 9 строк — `SimpleFall`/`RagdollRoll`), то есть третий из трёх канонических типов пропа в данных отсутствует |

---

## 7. Хардкод

| Значение | file:line | Чем должно выводиться |
|---|---|---|
| `AABB{0.2, 0.2, 0.2}` у отцепленного пропа | `prop_system.cpp:130` | `PropDef::sizeXMm/YMm/ZMm` — они уже в `PropMesh::scale` (`prop_system.cpp:296-299`), рядом |
| `Interactable{kind, 2.5f, true}` | `prop_system.cpp:258` | строка `interactables.csv` |
| импульс `0.35f` у GpuHandoff, `-0.5f` у SimpleFall, `2.0f` у Ragdoll | `prop_system.cpp:97`, `:124`, `:116` | масса пропа уже есть (`Mass`, `:294`) — импульс обязан считаться от неё |
| `kAirDamp 1.5f`, `kGroundMul 0.85f`, `kRestW2 1e-4f` | `prop_system.cpp:594-596` | свойства материала/массы |
| `wsel < 7` / `< 11` из 2000 | `prop_system.cpp:371-374` | плотность приборов на площадь |
| `kLightChancePct = 25` | `prop_system.cpp:22` | освещённость помещения |
| смещение лампы `-0.14f` | `prop_system.cpp:466` | половина высоты плафона (`sizeZMm`) — как в `spawn_prop_from_id:311` `dropM` уже делает |
| зазор `0.02f` у настенной панели | `prop_system.cpp:393` | толщина уже берётся из CSV, зазор — нет |
| `kContainerHalf{0.55, 0.55, 0.45}` | `container.h:101` | строка ящика в `props.csv`, которой нет |
| `kShutColour` / `kOpenColour` | `container.cpp:23`, `:25` | материал/`props.csv` |
| `kContainerFloorMin = 24`, `rooms / 6u` | `container.h:99`, `container.cpp:276` | площадь/плотность |
| `kDoorHp = 120`, `kDoorForceMs = 1500`, `kDoorReach = 3.0` | `door.h:106`, `:119`, `:110` | материал двери / сила тела |
| выборка дверей `dx,dy ∈ [-2,2], dz ∈ [-1,1]` | `door.cpp:228-230` | `kDoorReach / kCellSize` |
| `2.2f` дважды | `combat.cpp:645`, `save.cpp:919` | `interact_def(Corpse).reachM` |
| `3.5f` | `main.cpp:4203` | `interact_def(ElectricalShield).reachM` (соседняя ветка в HUD уже так и делает — `main.cpp:6433`) |
| `8.0f` / `6.0f` possess | `main.cpp:4257` / `:6479` | одна строка данных |
| `3.0f` в `interaction_step` | `prop_system.cpp:581` | строка таблицы |
| AABB `{0.15,0.15,0.15}` и цвет `{0.55,0.75,0.45}` у брошенного предмета | `main.cpp:5996`, `:5998` | `kPickupHalf` / `kPickupColor` (`loot.h`) — они существуют и здесь просто не использованы |
| шум крышки `{7.0f, 2200, 1}`, шум трупа `{6.0f, 600, 1}` | `main.cpp:4135`, `:4096` | `container_open_noise()` уже есть (`container.cpp:420`) и здесь не вызван |
| `kLampIntensity = 2.2f` | `main.cpp:154` | — |
| `interact_def(Npc).reachM + 1.0f` | `main.cpp:6194` | «+1 м гистерезиса» — число ниоткуда |
| `dripEmitters->size() < 96`, `(simTick % 50u)` | `main.cpp:1332`, `main.cpp:6764` | — |

---

## 8. ПРЕДЛОЖЕНИЕ ОБОБЩЕНИЯ

### 8.1 Одна сущность

```
// ЕДИНСТВЕННЫЙ ответ на вопрос «что это». Порядковый номер строки data/worldobjects.csv,
// как InteractKind — строка interactables.csv. Новый вид объекта = строка CSV.
enum class WorldKind : std::uint8_t { Prop, Container, Door, Corpse, Pickup, Count };

struct WorldObject {          // ОДИН компонент, ОБЯЗАТЕЛЕН на каждом объекте мира
    WorldKind   kind;         // ← ВИД. Явный. Не выводится из наличия чего-либо.
    ObjectDefId def;          // строка данных: меш, размер, масса, реакция, дальность
    LayerId     layer;        // (уже есть в Transform; оставить там)
    std::uint8_t flags;       // bit0 active, bit1 detached, bit2 spent/opened/searched
};

struct WorldAnchor {          // ЕДИНСТВЕННЫЙ якорь. Ровно то, что сегодня SubVoxelAnchor,
    std::uint8_t cx, cy, cz;  // плюс необязательная вторая клетка — и антураж укладывается
    std::uint8_t sx, sy, sz;  // в ту же форму без второй модели.
    std::uint8_t face;
    std::uint8_t cx1, cy1, cz1, face1; // 0xFF = точечный якорь
};
```

Дальность взаимодействия — **из данных, один раз**: `object_def(o.def).reachM`, читается
внутри `find_nearest(...)`, а не передаётся вызывающим. Все литералы §7 исчезают.

### 8.2 Как укладываются

| Сегодня | Через `WorldObject` | Что уходит |
|---|---|---|
| Проп RagdollRoll / SimpleFall / GpuHandoff | `kind=Prop`, `def` несёт `fallMode`, меш, массу, reach | `PropFallMode` как компонент; `StaticPropTag`/`DynamicBodyTag` → `flags.detached` |
| Контейнер | `kind=Container`, `def=crate_*` (новая строка `props.csv`: размер, масса, цвет, reach 2.4) + компонент-данные `Container` | `kContainerHalf`, `kShutColour`, `kOpenColour`, `kContainerReach`, ручной скан `main.cpp:4111` |
| Дверь | `kind=Door` + компонент-данные `Door`. **Лист остаётся вокселями сетки** (это верно: дверь — геометрия), но у неё появляется сущность-ручка с якорем и reach | `door_query_near`+`door_toggle_near` схлопываются в общий `find_nearest`; `Door::hp` уходит в общий `Health`/`apply_damage` |
| Труп | `kind=Corpse` + `Corpse` | литералы 2.2f ×2; двойная проверка «Kind::Corpse И all_of\<Corpse\>» |
| Лампа | `kind=Prop`, `def` со светом (уже так: `PropLight` печётся из строки) | строка `light_bulb` в `interactables.csv` — либо оживить, либо убрать |
| Брошенный предмет | `kind=Pickup` + `Pickup` | третий спавнер `main.cpp:5990` схлопывается в `spawn_pickup` |

### 8.3 Что остаётся за пределами — законно

* **Антураж (инстансы/провода/полотна)** — законно снаружи. Он *не сущность*: его объём
  (тысячи кусков на этаж), отсутствие индивидуальной судьбы, чистая выводимость из seed
  (`antourage.h:23-24`) и GPU-верлет делают ECS-строку чистым убытком. Но **якорь у него
  обязан стать общим** (`WorldAnchor` выше), и тогда `antourage_carve_step` и
  `anchor_validate_step` схлопываются в одну функцию над двумя массивами якорей.
* **Частицы** — законно снаружи: пул на GPU, срок жизни секунды, взаимодействия нет.
* **Снаряды** — законно снаружи: `SelfIntegrating`, живут доли секунды, не интерактивны.
* **`DetachedPiece`** — законно снаружи ровно как частица, но его третий фидер PropPass
  (`main.cpp:1356`) обязан уйти: падающий кусок — это `flags.detached` на общем якоре.

### 8.4 Порядок шагов

| # | Шаг | Места правки | LOC | Риск | Что чинит попутно |
|---|---|---|---|---|---|
| **1** | **`WorldKind` + `WorldObject`, и `clear_layer_props` фильтрует по `kind==Prop`, а не по наличию `SubVoxelAnchor`** | `prop_system.h` (+struct), `prop_system.cpp:325-338`, `:253-276`, `container.cpp:347-361`, `save.cpp:903`, `loot.cpp:222/289`, `combat.cpp:640` | ~120 | **низкий** — новый компонент, старые не трогаются | **БАГ §2.1: ящики перестают исчезать на всех этажах.** Плюс `anchor_validate_step` (`:195`) начинает целиться в `kind==Prop`, а не «во всё, у чего три компонента» |
| 2 | Разделить `interact` в `props.csv`: `Terminal` только у `terminal`; для мебели — новая строка `furniture`/`none` | `data/props.csv` (4 строки), `data/interactables.csv` (+1 строка), регенерация | ~10 | низкий | **БАГ: E на унитазе больше не запирает весь этаж** (`embody.cpp:153 door_toggle_locks`) |
| 3 | `find_nearest` читает `reachM` из `object_def(o.def)`, а не из аргумента; **все три dy становятся `wrap_delta_f`** | `prop_system.cpp:539-574`, `loot.cpp:476`, `main.cpp:1482/3606/3636/6477`, снять `3.5f`/`2.2f`/`8.0f`/`6.0f`/`3.0f` | ~80 | средний (меняются радиусы) | БАГ изотропии по Y; расхождение possess 8↔6; мёртвое `Interactable::reachM` оживает или удаляется |
| 4 | Один список приоритетов взаимодействия, из которого строятся И подсказка, И действие | `main.cpp:4070-4250` + `:6385-6505` → одна таблица `{kind, prompt, handler}` | ~150 | средний | ящик и NPC получают подсказку; порядок HUD и E перестаёт расходиться по построению |
| 5 | `anchor_validate_step` + `antourage_carve_step` → один `carve_response(dirtyCells)` над общим якорем | `prop_system.cpp:181-236`, `antourage.cpp:856-900`, три пары вызовов в `main.cpp` | ~120 | средний | шесть вызовов → три; пропы получают поллинговую проверку живости, которая сегодня есть только у антуража |
| 6 | Один путь уничтожения: `clear_layer_objects(reg, layer, KindMask)` вместо `clear_layer_props` + `refresh_floor_containers` + `despawn_layer_mobs` + destroy-first в `spawn_corpse_records` | `prop_system.cpp:325`, `main.cpp:1030`, `mob_spawn.cpp:433`, `save.cpp:888` | ~90 | низкий | отцепленные пропы и брошенные пикапы перестают быть «никем не убираемыми» (§1, строки 2 и 6) |
| 7 | Ящик — строка `props.csv`, `PropMesh` вместо голого AABB; убить `loot_containers_step`/`kOpenColour` или вернуть тинт в `mark_if_empty` | `container.h:101/23/25`, `container.cpp:367-436`, `main.cpp:5840-5857` | ~70 | низкий | ящик уезжает из BodyPass в PropPass (один путь отрисовки меньше); опустошённый ящик снова темнеет |
| 8 | `Door::hp` → общий `Health`/`apply_damage`; убить `check_projectile_prop_hits` или подключить его к `projectile_step` | `door.cpp:380-403`, `combat.cpp` (projectile), `prop_system.cpp:133` | ~110 | высокий (боевой баланс) | вторая модель HP исчезает; снаряды начинают ломать пропы |

**Шаг 1 — первый и обязательный:** он единственный чинит баг с ящиками *попутно*,
не трогая ни данных, ни баланса, ни рендера, и создаёт поле, на которое опираются все
остальные шаги.

---

## 9. Сводная классификация

* **БАГ:** §2.1 (все ящики уничтожаются, 4 точки); §3.1 (Y не заворачивается в 6 местах, включая
  `find_nearest_interactable`); §6 (`loot_corpse_interact` мёртв → пустой труп вечно
  предлагается); §6 (`kOpenColour` недостижим → опустошённый ящик не темнеет); §2.2
  (труп НПЦ не сносится `despawn_layer_mobs`); шаг 2 (E на мебели запирает этаж).
* **КАТЕГОРИЙНАЯ-ОШИБКА:** 8 мест в таблице §2.2; отсутствие поля «вид» — корень.
* **ДУБЛЬ:** 3 спавнера пикапа; 2 спавнера трупа; 2 ответчика на карв ×3 сайта;
  2 списка приоритетов взаимодействия; 3 фидера PropPass; двойная проверка вида трупа.
* **РАСХОЖДЕНИЕ-С-КАНОНОМ:** `GpuHandoff` не назначен ни одной строке `props.csv` (третий
  канонический тип пропа отсутствует в данных); ящик — параллельная система вместо пропа;
  `Interactable::reachM`/`PropDef::reachMm` объявлены источником и не читаются.
* **ХАРДКОД:** таблица §7, 28 позиций.
* **МЁРТВОЕ:** таблица §6, 13 позиций.
