# Аудит 05 — ИЗОТРОПНЫЙ ТОР как единая система

Репозиторий: `/Users/jirnyak/Mirror/gigahrush2`, ветка `torus`, рабочее дерево (есть незакоммиченные правки в `floor_gen.cpp`, `floor_spec.*`, `floor_catalog.cpp`, `tests/suite_*`).
Дата проверки: **2026-08-17**. Все `file:line` открыты и прочитаны сегодня; комментарии в коде за доказательство не принимались — каждое утверждение подтверждено самим кодом.

Классификация: **НЕ-ТОР** / **АНИЗОТРОПИЯ** / **ДУБЛЬ** / **ХАРДКОД** / **МЁРТВОЕ** / **БАГ**.

---

## 0. Резюме: где канон, где реальность

| Канон владельца | Что в коде |
|---|---|
| 128³ изотропный тор, x/y/z равноправны | Ядро — да (`physics.cpp`, `nav.cpp`, `los`-DDA, `fluid.cpp`, `light_bake.cpp`, `antourage.cpp`). Игровой слой — нет: **13 подтверждённых мест** считают расстояние/позицию без заворота хотя бы по одной оси |
| Гравитация — ФРЕЙМ, не буква оси | Машина на 8 режимов ЧИТАЕТСЯ 13 модулями честно, но **ПИШЕТСЯ только одно значение — `NegZ`**. 7 из 8 недостижимы в шиппинге. `RegionFn` не присваивается нигде → `Custom` мёртв структурно |
| Модуль этажа объявляет свой фрейм | **НЕ МОЖЕТ.** `floor_gravity_regime()`/`floor_ground_coord()` — функции БЕЗ АРГУМЕНТОВ, возвращают константы padic. Хук регистрации отсутствует: `FloorDef` = `{name, kind}` и всё |
| Клетка 2 м, субвоксель 0.25 | Константы правильные (`types.h:34-35`), но пересчёт клетка↔мир заинлайнен **≈200 строк** в двух несовместимых вариантах округления. **Девять** подтверждённых столкновений вариантов в одном пути, включая писателя и читателя поля страха |
| `kMacroDim`/`kWorldExtent` — единственные ручки | В GLSL сетка переписана литералами в **7 шейдерах**, субвоксель ещё в 2; связи с `types.h` в сборке нет вообще |

---

## 1. Перепись нарушений тороидальности

### 1.1 Что даёт `src/core/wrap.h` и кто его обходит

`wrap.h` (57 строк) предоставляет ровно пять примитивов:

| Примитив | Строка | Что делает |
|---|---|---|
| `wrapi(int, size)` | `src/core/wrap.h:8` | нормализация целой координаты |
| `wrapf(float, size)` | `src/core/wrap.h:13` | нормализация непрерывной координаты |
| `wrap_delta(int a, int b, size)` | `src/core/wrap.h:19` | кратчайшая знаковая разность, целая |
| `wrap_delta_f(float a, float b, period)` | `src/core/wrap.h:37` | то же, непрерывная, корректна для >периода |
| `nearest_image(abs, ref, period)` | `src/core/wrap.h:52` | ближайший образ (правило рендера) |

Плюс `wrap_macro(int)` в `src/world/types.h:50` — обёртка над `wrapi(c, kMacroDim)`.

**Чего в `wrap.h` НЕТ и что поэтому пишут руками:** нет ВЕКТОРНОЙ формы. Нет `wrap_delta3(vec3,vec3)`, нет `wrap_vec3`, нет итератора соседей. Отсюда прямое следствие — измерено grep'ом сегодня:

| Метрика | Значение |
|---|---|
| Файлов, включающих `core/wrap.h` | 34 (`src/` — 30, `tests/` — 4) |
| Вызовов `wrap_delta_f` в `src/` | **153** |
| Из них: блоков «полная тройка» (3 вызова подряд) | **31** |
| Блоков «две оси» (третья — голая разность) | **8** |
| Одиночных вызовов | 44 |
| Вызовов `wrap_macro(` в `src/` | **192** |
| Вызовов `wrapi(` | 17 |
| Вызовов `wrap_delta(` (целый) | 20 |
| Вызовов `wrapf(` | **16** (и это ВСЁ — см. §1.3) |

То есть тороидальная тройка написана руками 31 раз полностью и 8 раз наполовину, а целочисленный заворот — 192 раза. Помощника векторного уровня в ядре нет, поэтому «обходят» его не злонамеренно: его просто не существует.

### 1.2 Полная таблица: расстояние/разность без заворота

Найдено автоматическим сканом (окно ±4 строки вокруг каждого `wrap_delta_f`, поиск сырых однооcевых разностей в том же окне) + ручной проверкой каждого попадания.

| file:line | Незавёрнутая ось | Что за код | Игровой симптом | Класс |
|---|---|---|---|---|
| `src/app/main.cpp:1482` | **y** | выбор ближайшего NPC для вселения (`possess`) | у шва по y нельзя вселиться в соседа, стоящего в 2 м | НЕ-ТОР |
| `src/app/main.cpp:3606` | **y** | `corpseNear` — детект трупа рядом | труп у шва не «виден» игроку | НЕ-ТОР |
| `src/app/main.cpp:3636` | **y** | поиск ближайшего моба | моб через шов недосягаем/невидим для логики | НЕ-ТОР |
| `src/app/main.cpp:3842` | **y** | вспышка моба → `apply_slow` на игрока r=14 м | замедление не срабатывает через шов | НЕ-ТОР |
| `src/app/main.cpp:3858` | **y** | SporeCarpet — урон кислотой r=2.15 м | стоя на споровом ковре у шва не получаешь урон | НЕ-ТОР / БАГ |
| `src/app/main.cpp:6477` | **y** | подсказка «POSSESS SURVIVOR» r=6 м | подсказка не появляется | НЕ-ТОР |
| `src/game/loot.cpp:476` | **y** | `loot_corpse` — выбор трупа в радиусе | труп у шва нельзя обыскать | НЕ-ТОР |
| `src/game/prop_system.cpp:562` | **y** | `find_nearest_interactable` — **12 вызывающих** (`main.cpp:4083,4150,4176,4202,4873,6028,6089,6420,6430,6451` + `interaction_step:583`) | двери/терминалы/щиты/NPC/контейнеры у шва по y не взаимодействуемы | НЕ-ТОР / БАГ |
| `src/world/los.cpp:29` | **z** | `los_blockers` — линия огня, DDA | см. §1.4 | НЕ-ТОР |
| `src/world/los.cpp:99` | **z** | тот же — `cell.z<0 \|\| >=kMacroDim` считается БЛОКИРУЮЩИМ | стрельба/видимость через z-шов всегда перекрыты «стеной из ничего» | НЕ-ТОР / БАГ |
| `src/game/noise.cpp:240` | **z** | `noise_distance` — слух | звук через z-шов не слышен; см. §1.4 | НЕ-ТОР |
| `src/audio/spatial_audio.cpp:35` | **z** | `spatial_evaluate_geom` — панорама/громкость 3D-звука | **НОВОЕ, вне известных зацепок.** Источник за z-швом звучит на 250 м вместо 6 м → полностью глухой | НЕ-ТОР |
| `src/game/combat.cpp:168` | **z** | `grenade_advance` — финальная позиция гранаты | **НОВОЕ.** `pos.z = from.z;` — граната выходит из `[0,kWorldExtent)` | НЕ-ТОР / БАГ |
| `src/game/combat.cpp:1691` | **z** | рикошет пули — позиция после отскока | **НОВОЕ.** `tr.pos.z = hitP.z;` — пуля выходит из диапазона | НЕ-ТОР / БАГ |
| `src/game/combat.cpp:1625-1627` | **z** | терминальная клетка снаряда: `cz` без `wrap_macro`, `outOfZ` → материал подменяется на `kMatConcrete` | **НОВОЕ.** Пуля, ушедшая за z-шов, врезается в несуществующий бетон | НЕ-ТОР / БАГ |

### 1.3 `wrapf` — только 16 вызовов на весь `src/`

Полный список (`grep -rn 'wrapf(' src/`):

* `src/sim/physics.cpp:192-194` и `282-284` — **правильно, все три оси**. Это и есть «тор реален для агента».
* `src/game/combat.cpp:222-224` (`muzzle_point`) и `1507-1509` (интегратор пули) — **правильно, все три оси**.
* `src/game/combat.cpp:166-167` — **x и y, z пропущена** (граната).
* `src/game/combat.cpp:1689-1690` — **x и y, z пропущена** (рикошет).

То есть в одном файле `combat.cpp` живут ОБА соглашения одновременно.

### 1.4 Комментарии, которые сочиняют оправдание (проверено)

**`src/world/los.cpp:97-98`:**
> `// Off the top or the bottom of the stack: there is nothing there to see`
> `// through, so it blocks. z does not wrap ([AGENTS.md]: W and the vertical`
> `// extent of the stack are not toroidal the way x/y are).`

Открыт `AGENTS.md:206-212`. Там написано **обратное**:
> `**x/y/z wrap; W does not.** The 128³ macro grid is a torus on all three spatial axes … The level stack (W, the 4th coordinate) does **not** wrap`

`los.cpp` подставляет z вместо W и ссылается на документ, который его опровергает. **Ссылка сфабрикована.** Тот же приём в `src/game/noise.cpp:235-237` («z … the level stack is the 4th axis») и в `src/game/combat.cpp:164-165` («the same convention the bullet integrator uses, and the same one the level stack has, [AGENTS.md]»).

Последняя ссылка вдобавок **фактически ложна внутри своего же файла**: интегратор пули на `combat.cpp:1507-1509` заворачивает z. Гранатный код ссылается на соседа как на прецедент, а сосед делает наоборот.

Контрпримеры в самом дереве, подтверждающие канон: `src/game/extraction.cpp:12-13` («*The old "z must not wrap" guard came from the …*», и код заворачивает), `src/game/floors/blame/blame_gen.cpp:174` («*a body dropped here falls 256 m and arrives from above (z wraps)*»), `src/game/floors/padic/padic_gen.cpp:11` («*the torus wraps in z*»).

---

## 2. Перепись анизотропии

### 2.1 Что уже честно (эталоны — на них надо равняться)

| file:line | Как сделано |
|---|---|
| `src/sim/physics.cpp:202-239` | `up` берётся из `normalize(-gravity.at(pos))`, доминантная ось вычисляется (`upComp`), `sweep_axis_walk` параметризован осью. `{0,0,1}` только как дефолт для сущностей без `GravityAffected` |
| `src/sim/fluid.cpp:77-115` | `regime_frame` + `regime_down`, боковые шаги строятся из `frame.tanA/tanB`, `frame.pull` гасит падение при Zero |
| `src/game/antourage/antourage.cpp:31-33, 80-108, 693-699` | всё через `GravityFrame`; `gravity_frames()` разворачивает Zero в 6 граней. Комментарий на :33 прямо называет `z + 1` как то, чего делать нельзя |
| `src/world/nav.cpp:62-77`, `src/world/nav.h:77-79` | 6-связность, `wrap_macro` по всем трём, ни одной привилегированной оси |
| `src/world/los.cpp:16-18, 47-64` | DDA написан через аксессор `axis(v, i)` и цикл на 3 — ось не может получить особый случай (кроме z-заворота, §1.2) |
| `src/game/light_bake.cpp:34-95` | BFS 6-связный, координаты неврапнутые относительно затравки → центроид кластера на шве не разъезжается |
| `src/app/main.cpp:5070-5073` | камера: `worldUp = gravity().up_vector()` — вид следует фрейму |
| `src/game/floor_gen.cpp:102-125` | `floor_standable`/`floor_cell` читают ЖИВОЙ `w.gravity().regime` |
| `src/game/elevator.cpp:71-85` | лифт едет по оси, которую назвал режим |

### 2.2 Нарушения

| file:line | Как зашита ось | Обходит ли `GravityFrame` | Класс |
|---|---|---|---|
| `src/game/prop_system.cpp:432-440` | `const CellType above = grid.cell(x, y, z + 1);` — потолок как `z+1`, лампа крепится в него | **Да.** Файл вообще не включает `gravity.h`; единственное обращение к гравитации — `:220 world.gravity().at(tr.pos)` для импульса. Ровно тот `z + 1`, который `antourage.cpp:33` называет ошибкой | АНИЗОТРОПИЯ |
| `src/game/prop_system.cpp:353-360` | тройной цикл `z/y/x` + соседи `x±1, y±1` как «West/East/North» — стены ищутся только в плоскости xy | Да | АНИЗОТРОПИЯ |
| `src/game/room_zone.cpp:483-495` | `roomsPerAxis = kMacroDim/stride`, решётка комнат по `rx/ry`, а `const int z = floor_ground_coord();` — координата гравитации подставлена напрямую как индекс Z | **Да.** Даже если бы `floor_ground_coord()` знал фрейм, здесь он всё равно попадёт в третий аргумент | АНИЗОТРОПИЯ / БАГ |
| `src/game/room_zone.cpp:463` | `const int below = wrap_macro(z - 1);` — «под» = `z-1` | Да | АНИЗОТРОПИЯ |
| `src/game/mob_spawn.cpp:369-378` | `ax`/`ay` — из решётки комнат (x/y), `packH` — случайная координата, передаётся третьим аргументом в `placeable(wet, world, ax, ay, packH)` | Да. Комментарий на :373-375 честно говорит «WHOLE gravity axis», но код всегда кладёт её в z | АНИЗОТРОПИЯ |
| `src/game/mob_spawn.cpp:141-147` | `vec3{..., static_cast<float>(cz)*kCellSize + half.z}` — тело поднимается над клеткой по z | Да | АНИЗОТРОПИЯ |
| `src/game/save.cpp:1026` | `const vec3 foot{c.x, c.y, c.z - half.z - kVoxelSize*0.5f};` — «ступни» = минус z | Да | АНИЗОТРОПИЯ |
| `src/game/embody.cpp:101` | `cam.eyeOffset = vec3{0.0f, 0.0f, body_eye_height(...)}` — глаз строго по +Z | Да | АНИЗОТРОПИЯ |
| `src/game/combat.cpp:542` | `aabb->half.z = std::max(h*0.75f, 0.55f); // Extend along floor` — труп «растекается» по z | Да | АНИЗОТРОПИЯ |
| `src/game/door.cpp:40` | `std::fabs(wrap_delta_f(ccz, pos.z, ...)) < hz + half.z` — «высота» двери по z | Да | АНИЗОТРОПИЯ |
| `src/game/console.cpp:185-187` | `const int cz = ...; // the caller's storey` — «этаж» = срез по z | Да | АНИЗОТРОПИЯ |
| `src/game/floors/padic/padic_gen.cpp:602-632` | объявляет `world.gravity().regime = kPadicGravity` на :578, затем сеет воду в `z=0..2` и газ в `z=3..15` по решётке `nx/ny` | **Да, в том же файле, через 24 строки после объявления фрейма.** Объявление декоративное: смени `kPadicGravity` на `NegX` — геометрия не сдвинется | АНИЗОТРОПИЯ / БАГ |
| `src/game/combat.cpp:405, 1145` | `vec3 up{0.0f, 0.0f, 1.0f};` | Да (`combat.cpp:744-748` и `988-1003` в том же файле фрейм читают — соглашения смешаны) | АНИЗОТРОПИЯ |
| `src/game/prop_system.cpp:173` | `vec3 impulse = normalize(projVel)*3.0f + vec3{0,0,1};` | Да (на :223 в том же файле — честный `-g/|g|`) | АНИЗОТРОПИЯ |
| `src/app/main.cpp:4235, 4459` | `vec3{0,0,-1.0f}`, `vec3{0.0f,0.0f,1.0f}` как направления | Да | АНИЗОТРОПИЯ |
| `src/game/combat.cpp:2059` | `vec3 up = (fwd.z>0.9f\|\|fwd.z<-0.9f) ? {1,0,0} : {0,0,1};` | Формально да, но **безвредно**: это выбор базиса для конуса разброса, конус симметричен → наблюдаемого эффекта нет. Отмечено, чтобы не тратить время повторно | (доброкачественно) |

---

## 3. Гравитация как фрейм — работает ли машина

### 3.1 Кто ПИШЕТ режим

Полный список присваиваний `regime` во всём `src/`:

| file:line | Значение |
|---|---|
| `src/world/gravity.h:126` | дефолт `= GravityRegime::NegZ` |
| `src/game/floors/padic/padic_gen.cpp:578` | `= kPadicGravity` → `padic.h:53` → **`NegZ`** |
| `src/game/floors/blame/blame_gen.cpp:663` | `= kBlameGravity` → `blame.h:55` → **`NegZ`** |

**Больше нигде.** Проверено дополнительно:
* Консоль (`src/game/console.cpp`) — команды переключения гравитации **нет** (grep по `gravity`/`regime` в файле: 0 попаданий).
* Сейв (`src/game/save.cpp`, `save.h`) — режим **не сохраняется** (0 попаданий). Комментарий `padic_gen.cpp:573-576` это подтверждает и объясняет как замысел.
* `GravityField::region` (`RegionFn`, `gravity.h:131-132`) — **не присваивается ни разу во всём `src/`**. Единственное упоминание вне заголовка: `tests/e2e_test.cpp:1434 g.region = nullptr;` (то есть тест присваивает НОЛЬ).

**Вывод: в шиппинг-билде `GravityRegime` имеет ровно ОДНО достижимое значение — `NegZ`. 7 из 8 недостижимы.** `Custom` недостижим структурно вдвойне: он появляется только когда `region != nullptr` даёт вектор, не совпадающий с `global`, а `region` присвоить некому.

### 3.2 Кто ЧИТАЕТ режим — машина подключена честно

13 модулей, и читают правильно (через `regime_frame`/`regime_down`/`gravity_frames`, с фолбэком `regime_from_vector` для `Custom`):

`src/sim/fluid.cpp:77-78` · `src/sim/controller.cpp:31-40` · `src/game/wander.cpp:125-131` · `src/game/ai.cpp:613-620, 1115-1121` · `src/game/combat.cpp:744-748, 988-1003` · `src/game/faction_relations.cpp:197-203` · `src/game/container.cpp:331` · `src/game/antourage/antourage.cpp:693-699` · `src/game/floor_gen.cpp:105, 111` · `src/game/elevator.cpp:71` · `src/app/main.cpp:5071, 6836` · `src/render/gpu_gas_pass.h:21` (`downStep` в push-константе).

### 3.3 Приговор: машина НЕ НЕНУЖНА — она ОТКЛЮЧЕНА СО СТОРОНЫ ЗАПИСИ

Это важное различение, и ответ однозначен. Читающая половина — рабочая, покрытая тестами (`tests/suite_gravity_regimes.inl` гоняет все 8 значений; `tests/e2e_test.cpp:1846`, `tests/suite_utilai.inl:1649`, `tests/suite_faction2.inl:322` ставят `PosX`; `tests/suite_antourage.inl:16-18` — все 8). Тесты **зелёные** на 6 направленных режимах одновременно, а это, как верно пишет `suite_gravity_regimes.inl:6-8`, невозможно при зашитой оси. Значит: **читающая сторона доказана, пишущая — пуста.**

Мёртвыми являются не «8 веток `Custom`», а весь регионально-векторный контур:
* `GravityField::region` / `RegionFn` (`gravity.h:131-134`) — **МЁРТВОЕ**;
* ветка `if (r == GravityRegime::Custom) r = regime_from_vector(...)` в 6 местах (`combat.cpp:747,1001`, `controller.cpp:38`, `ai.cpp:617,1118`, `wander.cpp:128`, `faction_relations.cpp:200`) — **МЁРТВОЕ в продакшене**, живое в тестах;
* шестигранная развёртка `gravity_frames()` для `Zero` (`gravity.h:161-163`) и `kMaxGravityFrames` — **МЁРТВОЕ в продакшене**.

### 3.4 Может ли модуль этажа объявить свой фрейм — НЕТ

```cpp
// src/game/floor_gen.cpp
GravityRegime floor_gravity_regime() { return kPadicGravity; }   // :98
int floor_ground_coord()             { return kPadicGroundCoord; } // :100
int floor_ground_z()                 { return kPadicGroundCoord; } // :131  ← «Legacy»-дубль :100
```

Все три — **без аргументов**. Ни номера этажа, ни `FloorSpec`, ни `FloorKind` (объявления: `floor_gen.h:84, 88, 108`). Переопределить невозможно в принципе.

Хука регистрации тоже нет: `FloorDef` — это `{const char* name; FloorKind kind;}` и ничего больше; `FloorSpec` несёт население/фракции/враждебность/возраст, но ни гравитации, ни опорной координаты, ни шага комнат. Модуль при регистрации может объявить **имя и вид, и всё**.

Практическое следствие — **split-brain**, уже присутствующий в дереве:

| Потребитель | Откуда берёт фрейм | Что получит на этаже Blame |
|---|---|---|
| `floor_cell` / `floor_standable` (`floor_gen.cpp:105,111`) | ЖИВОЙ `w.gravity().regime` | режим Blame |
| `elevator.cpp:71` (ось прибытия) | `floor_gravity_regime()` | режим **padic** |
| `room_zone.cpp:484` (этаж мебели) | `floor_ground_coord()` | координата **padic** |
| `population.cpp:6` | `floor_ground_z()` | координата **padic** |
| `save.h:727` `kArrivalCoord = 3` | литерал | **padic** |

Сегодня это не стреляет **только потому, что оба модуля выбрали `NegZ` и `3`**. `blame.h:57-62` признаёт это письменно: «*the global frame helpers ([floor_gen.h]) still export one module's constants*». И `kBlameGroundCoord` (`blame.h:62`) при этом **не читается ни одной строкой кода** — только определение и два комментария. **МЁРТВОЕ.**

---

## 4. Клетка ↔ мир

### 4.1 Два несовместимых соглашения — и их точный объём

| Вариант | Форма | Строк / мест |
|---|---|---|
| **A — `std::floor`** | `static_cast<int>(std::floor(p.x / kCellSize))` | **65 строк / 21 место** |
| **B — усечение** | `static_cast<int>(p.x / kCellSize)` | **55 строк / 21 место** |
| **C — умножение на обратное** | `1.0f/kCellSize`, затем `floor`/`&127` | 6 строк C++ / 9 строк GLSL, 5 мест |
| **D-центр** | `(c + 0.5f) * kCellSize` | ~50 строк |
| **D-угол** | `c * kCellSize` | ~26 строк |
| **Итого заинлайненных пересчётов** | | **≈200 строк** |
| Экспортированных общих помощников | | **один** (`macro_cell_of`, `save.h:824`) |

Для положительных координат A и B совпадают. Расходятся при отрицательной: `int(-0.5/2.0) == 0`, `floor(-0.5/2.0) == -1` → клетка 0 против клетки 127 после заворота. Позиции сущностей заворачиваются физикой в `[0, kWorldExtent)` (`physics.cpp:282-284`), поэтому «обычно» разницы нет. **Но:** снаряды помечены `SelfIntegrating` и физикой ИСКЛЮЧЕНЫ (`physics.cpp:179`), `combat.cpp:168` и `:1691` не заворачивают z, а зондирующие лучи и кольцевые пробы строят координаты сами (`main.cpp:3089`) и уходят в минус штатно.

Дерево **знает** правильный ответ и написал его один раз, `src/game/combat.cpp:2325-2326`:
> `// floor, не усечение: p ∈ (-2,0) обязан дать клетку 127,`
> `// не 0 — торовый шов класса hazard/finalize (аудит c5eaaa50).`

и не распространил этот вывод на 55 остальных строк — включая три в том же файле.

### 4.2 Оба варианта в ОДНОМ вычислительном пути — гарантированный off-by-one

**(а) Поле страха: писатель и читатель разошлись — САМОЕ ТЯЖЁЛОЕ.**
* **Пишет:** `src/game/ai.cpp:1250` → `diffusion_driver_add_at(driver, world, tr.pos, …)` → `src/sim/diffusion.cpp:481-482` → `cell_of` (`diffusion.cpp:105`) = **усечение**.
* **Читает:** `src/game/ai.cpp:681-683` → `danger->at(cx, cy, cz)` (`ai.cpp:685`) = **`floor`**. Тот же файл, тот же тик, тот же `Transform::pos`. Второй читатель — `src/audio/audio_system.cpp:145-147`, тоже **`floor`** (счётчик Гейгера).

Паникующее тело записывает страх в клетку 0, а все читают его из клетки 127 при координате в `(-2, 0)`. **БАГ.** И это ровно тот сценарий, который комментарий `diffusion.cpp:102-103` обещает предотвратить.

**(б) `projectile_step` — ОДНА ФУНКЦИЯ, `src/game/combat.cpp`:**
* `:1623-1625` терминальная клетка — **усечение** (z ещё и без `wrap_macro`);
* `:1651-1653` плоскость входа для нормали рикошета — **`floor`**.
Пуля определяет клетку попадания одним округлением, а грань входа — другим. Нормаль рикошета берётся от чужой грани. **БАГ.**

**(в) `mob_attack_step` — ОДНА ФУНКЦИЯ, `combat.cpp:656-959`:**
* `:740-742` зонд опасности — **`floor`**;
* `:861` → `adjacent_wall(grid, tr.pos)` → `combat.cpp:43-45` — **усечение**.
Два зонда от одной и той же позиции, через один виток цикла. `adjacent_wall` вдобавок не заворачивает перед смещением (`grid.cell(cx±1, …)`) и полностью полагается на внутренний `wrap_macro` в `macro_grid.h:127-129`.

**(г) `hazard_step` — комментарий утверждает обратное.** `combat.cpp:979-984` говорит «*the same two probes the monster path makes*», но путь монстра (`:740-742`) использует **`floor`**, а этот — **усечение**.

**(д) `apply_damage` (`combat.cpp:260-437`) против собственного соглашения файла.** `:290` зовёт `adjacent_wall` (усечение), тогда как `cell_solid` (`:72-77`) — **`floor`** — то, чем в этом файле делается любой другой геометрический запрос.

**(е) Мёртвый гейт в `main.cpp`.** `main.cpp:3089/3099/3101` (и точный клон `3702/3714/3716`): `px = cx + ox * kCellSize` при `ox ∈ [-8,8]` уходит в минус, когда игрок ближе 16 м к началу координат; `sampleZ = eyeZ - kCellSize` уходит в минус на нижнем этаже. Проверка `if (gz < 0 …) continue` на `main.cpp:3090` **мертва** для `gz ∈ (-2,0)` — усечение вернёт 0, и проба молча читает этаж 0. Тот же файл использует `floor` на `:187-189` и `:3292-3294`.

**(ж) `fold_back` — не заворачивает, а ЗАЖИМАЕТ.** `src/game/embody.cpp:130-134`:
```cpp
auto to_cell = [](float w) -> std::uint8_t {
    float c = w / kEmbodyCellSize;
    if (c < 0.0f) c = 0.0f;
    if (c > 255.0f) c = 255.0f;
    return static_cast<std::uint8_t>(c);
};
```
Две ошибки в пяти строках. Первая: **зажим вместо заворота** — тор здесь просто отменён, NPC у шва складывается в клетку 0. Вторая: **верхняя граница 255 при сетке в 128 клеток** — должно быть `kMacroDim-1 = 127`; клетки 128..255 в гриде не существуют, а обратное преобразование `embody.cpp:46-48` вернёт до 511 м в 256-метровом мире. **НЕ-ТОР / БАГ.**

И `ai.cpp:678-680` уверенно ссылается на этот код как на эталон:
> `// The macro cell the body stands in — the same pos->cell map fold_back`
> `// uses, wrapped onto the torus. kCellSize == kEmbodyCellSize; …`

`fold_back` усекает и зажимает; `ai.cpp:681-683` округляет вниз и заворачивает. Расходятся **по двум признакам сразу**. Ссылка ложна.

**(з) D-центр против D-угла на ОДНОМ И ТОМ ЖЕ узле решётки — расхождение ровно 1 м.**
* `src/game/wander.cpp:424-426`: `lattice_coord(ln.ix) * kCellSize` — **угол**;
* `src/game/ai.cpp:1205-1207`: `(lattice_coord(n.ix) + 0.5f) * kCellSize` — **центр**;
* и `ai.cpp:1201-1202` называет это «*the same fallback the errand's vertical step takes, and for the same reason*».

Проверка прибытия `wander.cpp:432` (`len < kCellSize`, т.е. < 2 м) меряется до точки, смещённой на 1 м по каждой оси. **БАГ.**

**(и) `combat.h:94`** строит `shieldPos` в **углу** клетки, а `prop_system.cpp:394-398` спавнит щит в **центре**. Пузырь `is_power_cut` радиусом 12 м смещён на 1 м по x и по y.

### 4.3 `diffusion.cpp:101-103` — заявление ЛОЖНО

```cpp
// src/sim/diffusion.cpp:101-106
// Macro cell containing a world-space coordinate. Truncation then wrap, matching
// [game/door.cpp] / [game/combat.cpp] / [game/wander.cpp] exactly — a different
// rounding here would put a corpse's danger one cell off from where the body is.
inline int cell_of(float coord) {
    return wrap_macro(static_cast<int>(coord / kCellSize));
}
```

Проверено сегодня:
* `door.cpp:22-24` — усечение. **Совпадает.**
* `wander.cpp:40-42` и `108-110` — усечение. **Совпадает.**
* `combat.cpp` — **НЕ совпадает**: `floor` на строках `73, 75-76, 740-742, 2327-2329, 578-581, 602-604, 110-111, 1651-1653` (8 мест) против усечения на `43-45, 982-984, 1623-1625`.

То же заявление повторено в `src/sim/diffusion.h:342-347`. Проверено сегодня построчно:

| Файл, на который ссылаются | Вердикт |
|---|---|
| `door.cpp:22-24` | **ВЕРНО** — усечение |
| `wander.cpp:40-42`, `108-110` | **ВЕРНО** — усечение |
| `combat.cpp` | **ЛОЖЬ** — усечение в 3 местах (`43-45`, `982-984`, `1623-1625`) против **`floor` в 7** (`73/75/76`, `110/111`, `579-581`, `602-604`, `740-742`, `1651/1653`, `2327-2329`) |

Комментарий устарел относительно аудита `c5eaaa50`, который и добавил в `combat.cpp` явный отказ от усечения (`combat.cpp:2325-2326`, см. §4.1). Именно тот дефект, который `cell_of` обещает предотвратить («*a corpse's danger one cell off from where the body is*»), **реализовался** — это §4.2(а). **ДУБЛЬ + БАГ.**

### 4.4 Общих помощников почти нет, а те, что есть, обходят

**Экспортировано ровно два, оба в `save.h`:**
* `macro_cell_of(const vec3&, u8&, u8&, u8&)` — `save.h:824`, реализация `save.cpp:987-992` (**вариант B**). Вызывающих **два**: `save.cpp:783`, `save.cpp:1176`. При этом `save.cpp:781-782` хвалится: «*Through the shared helper rather than inline, so … cannot end up one cell apart*».
* `macro_cell_centre(u8,u8,u8)` — `save.h:829`, реализация `save.cpp:994-998` (D-центр). Вызывающих два.

**Обходчик найден:** `src/app/main.cpp:2435-2439` — тот же снапшот клетки игрока, **выражение переписано побайтово** вместо вызова помощника, при том что `main.cpp` включает `save.h`. Плюс ещё 16 усечений в том же файле.

**Все остальные не могут им воспользоваться даже при желании:** `combat.cpp`, `door.cpp`, `wander.cpp`, `extraction.cpp`, `console.cpp`, `prop_system.cpp`, `mob_spawn.cpp`, `needs.cpp`, `ai.cpp`, `audio_system.cpp`, `los.cpp`, `monster_traits.cpp` не включают `save.h` — и правильно делают, помощник пересчёта координат не должен жить в сериализаторе.

**Файл-локальные дубли (невидимы вне TU):** `cell_of` (`diffusion.cpp:104`, анонимная область), `floor_div` (`physics.cpp:18`, анонимная область), `agent_cell` — **дословно продублирован** в `door.cpp:20-25` и `wander.cpp:39-43`, `adjacent_wall` — **дословно продублирован** в `combat.cpp:42-50` и `wander.cpp:107-115`.

**Корневая причина названа точно:** `src/world/types.h` — единственное место, где определён `kCellSize` — не предлагает **ни одного** преобразования float↔клетка. В нём только `macro_index`, `wrap_macro`, `sub_bit` (`types.h:43-55`). Поэтому все ≈200 строк написаны заново каждым.

**И третье написание размера клетки:** `src/game/embody.h:43` `inline constexpr float kEmbodyCellSize = 2.0f;` — литерал, не выведенный из `kCellSize`. Держится на одном `static_assert` в `save.cpp:936`. **ХАРДКОД / ДУБЛЬ.**

---

## 5. Хардкод размеров

Канон: `src/world/types.h:17` `kMacroDim=128`, `:23` `kSubDim=8`, `:34` `kCellSize=2.0f`, `:35` `kVoxelSize=0.25f`, `:39` `kWorldExtent=256.0f`.

### 5.1 Живой неправильный номер — ровно один

**`shaders/prop.frag:254`**
```glsl
float samosborPulse = pc.torus.z > 0.0 ? pc.torus.z
    : clamp((1.0 - pc.fog.x / (128.0 * 0.30 * 2.0)) / 0.66, 0.0, 1.0);
```
`prop_pass.cpp:296-298` шлёт `CubePush` без изменений, значит `torus.z` — это `samosborPulse` из `main.cpp:6966`. В спокойном мире он `0.0`, тернарник проваливается в литеральную ветку. Там `fog.x = kWorldExtent*0.25 = 64.0`, делитель `128.0*0.30*2.0 = 76.8` (это `kMacroDim`, притворившийся метрами при мире в 256 м). Результат `clamp((1-64/76.8)/0.66) = **0.2525**` вместо `0.0`.

**Симптом:** каждый проп рендерится с вечной 25% пульсацией самосбора — `prop.frag:181` умножает эмиссию на `(1 + samosborPulse*3.0*…)` (до ~1.75×), и та же величина уходит в `march_volumetric_fog` на `:266`. Пропы мерцают в мире без угрозы и **расходятся по освещению с `cube.frag` и `raymarch.frag`, рисующими ту же сцену**.

`cube.frag:643` делает это правильно (`pc.fog.y / (pc.torus.x * 0.5)`), а комментарии `cube.frag:633-641` и `raymarch.frag:720-728` описывают, как этот самый литерал `128.0` уже ловили и чинили — `prop.frag` пропустили. **БАГ / ХАРДКОД.**

### 5.2 GLSL — сетка переписана литералами (связи с `types.h` в сборке НЕТ)

Проверено: `CMakeLists.txt:261-269` зовёт `glslc -O` **без единого `-D` для размеров**; единственный `-D` во всём дереве — `GIGA_ALBEDO_ARRAY` (`:364, :376`).

| file:line | Литерал | Должно быть | Тяжесть |
|---|---|---|---|
| `shaders/prop.frag:254` | `128.0*0.30*2.0` | `pc.torus.x*0.5` над `fog.y` | **ломает рендер сейчас** |
| `shaders/volumetric_fog.glsl:34-35` | `kLightGridDim=64`, `kLightGridCell=4.0` | должно равняться `gpu_light_grid.h:22-25`; 64×4 = 256 = `kWorldExtent` | ломает рендер при смене extent |
| `shaders/raymarch.frag:86-88` | `kMacroDim=128`, `kCell=2.0`, `kVoxel=0.25` | `types.h` | латентно |
| `shaders/shadow_march.glsl:23-25` | те же три — **вторая независимая копия** | `types.h` | латентно, ДУБЛЬ |
| `shaders/raymarch.frag:92`, `shadow_march.glsl:29` | `<<7`, `<<14` | `log2(kMacroDim)` | латентно |
| `shaders/gas_sim.comp:73` | `pos.x>=128 \|\| pos.y>=128 \|\| pos.z>=128` | `kMacroDim` | ломает сим |
| `shaders/gas_sim.comp:124-133` | `&127u`, `<<7`, `<<14` (6 мест) | `kMacroDim-1`, `log2` | ломает сим |
| `shaders/cloth_sim.comp:34-35` | `w*0.5`, `&127` | `1/kCellSize`, `kMacroDim-1` — **при том что период уже приходит в push и используется на :87** | ломает сим |
| `shaders/wire_sim.comp:37-38` | `w*0.5`, `&127` | то же (push есть на :65) | ломает сим |
| `shaders/particle_sim.comp:35-36` | `w*0.5`, `&127` | то же (push есть на :28) | ломает сим |
| `shaders/raymarch.frag:210` | `for (int i=0; i<224; ++i)` | из радиуса тумана 64 клетки = `kWorldExtent*0.5/kCellSize` | ломает рендер при росте мира |
| `shaders/raymarch.frag:219`, `shadow_march.glsl:46,58` | `ivec3(7)`, `s[axis]>7` | `kSubDim-1` | ломает рендер при `kSubDim=16` |
| `shaders/raymarch.frag:104,116`, `shadow_march.glsl:38` | `<<3`, `<<6` | `log2(kSubDim)` | то же |
| `shaders/cube.frag:521`, `prop.frag:195` | `uv /= 2.0;` | `kCellSize` | косметика |
| `shaders/cube.frag:285,317`, `raymarch.frag:357,385,497,502` | `fract(vWorldPos.z*0.5)` | `1/kCellSize` | косметика |
| `shaders/cube.frag:109`, `raymarch.frag:62` | `kTexRepeat=0.5` | из `kCellSize` | косметика |
| `shaders/light_grid.comp:33-34` | комментарий «32×16×32 @ 2.0 m» | фактически 64³ @ 4.0 м (`gpu_light_grid.h:22-25`) | документация врёт в 8× |

`types.h:6-7` рекламирует: «*Flipping kSubDim to 16 … is a one-line change here*». **Это неправда**: субвоксельная размерность зашита ещё в двух GLSL-файлах, недостижимых для этой «одной строки».

### 5.3 C++

| file:line | Литерал | Должно быть | Тяжесть |
|---|---|---|---|
| `src/render/gpu_gas_pass.cpp:266` | `vkCmdDispatch(cmd, 8, 8, 128)` | `kMacroDim/16, kMacroDim/16, kMacroDim` | ломает сим при смене |
| `src/render/gpu_gas_pass.cpp:264` | комментарий «Grid 512×512×16 … Dispatch (32,32,16)» | противоречит строке 266 | документация врёт |
| `src/render/gpu_gas_pass.cpp:93` | `ivec4{x&127, y&127, z&127, 1}` | `wrap_macro()` | ломает сим |
| `src/app/main.cpp:1259-1261` | `&127`, `>>7`, `>>14` | `kMacroDim-1`, `log2` | ломает сим |
| `src/world/destruct.cpp:29-31` | `&127u`, `>>7`, `>>14` (:31 без маски) | то же | ломает сим |
| `src/game/light_bake.cpp:21-22` | `<<7`, `<<14` | то же | ломает рендер |
| `src/game/ai.cpp:957-958` | `<<7`, `<<14`, `&127` | то же | ломает сим |
| `src/game/antourage/antourage.cpp:558-560, 631-633` | `&127u`, `>>7`, `>>14` (6 мест) | то же | ломает сим |
| `src/game/ai.h:493-504` | `0x7Fu` ×5 рядом с корректно выведенным `kMemCellBits=7` (:486) и его `static_assert` (:487) | `((1u<<kMemCellBits)-1)` | наполовину доделано |
| `src/render/gpu_light_grid.cpp:68` | лог «32x16x32 grid, max 256 lights» | реально 64³, `kMaxPointLights=512` | косметика |
| `src/render/gpu_light_grid.cpp:296` | `/8, /4, /8` | `local_size` из `light_grid.comp` | нет статической сверки |

Проверено и исключено как непричастное: `128` в `main.cpp:1374-1808`, `nav_async.*`, `npc_pool.h` — мегабайты; `255` в `gas_sim.comp`, `prop.vert:71` — диапазон байта; `4096` в `prop_pass.h:28` — лимит инстансов; `256` в `light_grid.comp:65-103` — размер тайла воркгруппы.

---

## 6. Зашитые номера этажей

Прямой поиск `if (floor == N)`, `layer == N`, `spec.number == N`, `switch` по индексу этажа по всему `src/`: **единственное литеральное сравнение номера в дереве — `padic_gen.cpp:529`.** Но нарушений закона больше, они просто другой формы.

| file:line | Ветка / константа | Класс |
|---|---|---|
| `src/game/floor_gen.cpp:171` | `if (spec.kind == FloorKind::Blame) return 0;` внутри `floor_doorways()` | **Нарушение закона: ветка в диспетчере** |
| `src/game/floor_gen.cpp:172` | `return padic_doorways(number, seed, out);` — сквозной путь для остальных 5 видов | **Нарушение: диспетчер прибит к одному модулю** |
| `src/game/floor_gen.cpp:98, 100, 131` | `floor_gravity_regime/ground_coord/ground_z` возвращают константы padic | **Нарушение: диспетчер экспортирует константы одного модуля** |
| `src/game/floor_gen.cpp:9` | `#include "game/floors/padic/padic.h" // the module every OTHER kind dispatches to` | зависимость диспетчера от внутренностей модуля |
| `src/game/floor_gen.cpp:92, 96` | `kRoomStride = 4`, `floor_room_stride(FloorKind /*kind*/)` игнорирует вид | ХАРДКОД (признано в комментарии :88-91) |
| `src/game/floor_gen.cpp:135-136` | `static_assert(kPadicGroundCoord == 3, "keep save.h kArrivalCoord in step")` | ХАРДКОД, межмодульный пин |
| `src/game/floors/padic/padic_gen.cpp:529` | `if (number == 0) { … extraction marker … }` внутри `stamp_lattice()` | **Фактически диспетчерская ветка** — `generate_padic_floor` работает для **5 из 6 видов** (`floor_gen.cpp:186-190`), т.е. модуль, заявивший номер **4** (`padic.h:46`), решает игровой факт про этаж **0** |
| `src/game/floors/padic/padic_gen.cpp:535` | `for (const int z : {0, kMacroDim - 1})` | ХАРДКОД, внутримодульный |
| `src/app/main.cpp:1094` | `if (kind_for_floor(floorNumber) == game::FloorKind::Padic) count += game::seed_padic_props(…)` | **Нарушение: ветка по виду в общем app-слое** |
| `src/app/main.cpp:83` | `#include "game/floors/padic/padic.h"` | утечка модуля за пределы `floors/` |
| `src/game/save.h:727` | `kArrivalCoord = 3` | ХАРДКОД вне модуля, дубль `kPadicGroundCoord` |
| `src/game/mob_spawn.cpp:214-220` | `switch (kind)` в общем спавнере; Padic и Blame молча падают в `Ministry` | ветка по виду в общем коде |
| `src/game/container.cpp:41-53` | `switch (fk)`; Padic/Blame получают жилую таблицу | то же |
| `src/game/floors/blame/blame.h:62` | `kBlameGroundCoord = 3` — **не читается ни одной строкой кода** | **МЁРТВОЕ** |
| `src/app/main.cpp:779-788` | `kDemoFloors[] = {0,1,2,-8,-14,-26,-36,-50,14,30}` | ХАРДКОД, но идёт через `cat.claim` — архитектурно допустимо |
| `src/game/floor_spec.cpp:65-72`, `floor_catalog.cpp:55-62` | лестница `a==0` / `a>=25` / `%11==10` / `%3==2` | данные по замыслу, запинены тестами — ОК |

Показательно: в `floor_gen.cpp:185-211` стоят **три правильные таблицы** указателей (`kGenerators`, `kRuleDeclarers`, `kRuleAppliers`) с `static_assert` на полноту, а прямо над ними (`:167-173`) четвёртая точка диспетчеризации выродилась в `if`. Собственный мандат файла на `:178-182` («*A new floor look = a new module folder … + its row here, never a branch*») нарушается функцией, стоящей на 10 строк выше него.

---

## 7. ПРЕДЛОЖЕНИЕ — как сделать нарушение изотропии ТРУДНЫМ

### 7.1 Диагноз, из которого следует лекарство

Все 13 нарушений тора, 16 нарушений анизотропии и 82 инлайна пересчёта имеют **одну причину**: в ядре нет примитива нужного УРОВНЯ. `wrap.h` даёт скалярные операции — а код работает с `vec3` и с клетками. Между «есть `wrap_delta_f`» и «нужна тороидальная дистанция между двумя сущностями» лежат три строки, которые каждый пишет сам, и каждый десятый пишет с ошибкой. Список правок это не лечит: он кончится, а следующие три строки напишут заново.

### 7.2 Что должно появиться в ядре

**Файл 1: `src/core/wrap.h` — дополнить (≈40 LOC).**

```cpp
// Тороидальная разность как ВЕКТОР. Единственная форма, которой измеряют
// расстояние между двумя точками мира.
inline vec3 wrap_delta3(vec3 a, vec3 b, float period = kWorldExtent);
inline float wrap_dist2(vec3 a, vec3 b);   // квадрат — для сравнений с радиусом
inline float wrap_dist(vec3 a, vec3 b);
inline vec3  wrap_pos(vec3 p);             // заворот позиции, все три оси
inline ivec3 wrap_cell(ivec3 c);           // wrap_macro по трём осям
```
(`period` по умолчанию убирает соблазн подставить литерал; `wrap_pos` заменяет три строки `wrapf` и делает пропуск оси невыразимым.)

**Файл 2: `src/world/coords.h` — новый (≈50 LOC).** Единственное место, где живёт округление:

```cpp
inline int   cell_of(float world);            // floor, ОДИН вариант навсегда
inline ivec3 cell_of(vec3 world);             // + wrap_cell
inline vec3  cell_centre(ivec3 cell);         // (c + 0.5) * kCellSize
inline vec3  cell_corner(ivec3 cell);         // c * kCellSize — ТОЛЬКО для DDA-плоскостей
inline int   subvoxel_of(float world);        // floor по kVoxelSize
```
Выбор округления — `std::floor`: он единственный корректен при отрицательной координате, он уже в большинстве (65 строк против 55), и он уже назван правильным в `combat.cpp:2325-2326`.

Два ИМЕНОВАННЫХ обратных преобразования вместо одного — потому что §4.2(з) и §4.2(и) показывают: угол и центр — это два РАЗНЫХ вопроса, которые сегодня выглядят одинаково (`c * kCellSize` против `(c+0.5f) * kCellSize`) и потому путаются. `cell_corner` нужен ровно для границ клеток в DDA (`los.cpp:63`, `combat.cpp:114`, `:1657` — там он корректен); везде, где речь о ТОЧКЕ, ответ — `cell_centre`. Разные имена делают ошибку видимой на строке вызова.

**Файл 3: `src/world/neighbors.h` — новый (≈40 LOC).** Итератор соседей, чтобы `x±1, y±1` перестало быть способом выразить «стены вокруг»:

```cpp
inline constexpr ivec3 kFace6[6];             // единственная таблица на дерево
template <class F> void for_each_face(ivec3 c, F&& f);   // с wrap_cell внутри
template <class F> void for_each_tangent(const GravityFrame&, ivec3 c, F&&);
```
(последняя — четыре соседа в плоскости, перпендикулярной гравитации; ровно то, что руками написано в `fluid.cpp:110-115` и чего не хватило `prop_system.cpp:358-360`.)

**Файл 4: `src/world/gravity.h` — дополнить (≈25 LOC).** Фрейм-осведомлённые up/down на уровне ЗНАЧЕНИЙ, а не индексов осей:

```cpp
inline float  frame_coord(const GravityFrame&, vec3 p);        // «высота»
inline vec3   frame_offset(const GravityFrame&, float up);     // «поднять на h»
inline ivec3  frame_cell_up(const GravityFrame&, ivec3 c);     // «потолок»
inline ivec3  frame_cell_down(const GravityFrame&, ivec3 c);   // «пол»
```
`prop_system.cpp:439` (`grid.cell(x, y, z+1)`) становится `grid.cell(frame_cell_up(f, c))` — и вопрос «а какая ось вверх?» задаётся автоматически.

**Файл 5: хук модуля этажа (≈30 LOC).** Расширить `FloorDef` (`floor_catalog.h:33-37`) до

```cpp
struct FloorDef {
    const char* name;
    FloorKind kind;
    GravityRegime gravity = GravityRegime::NegZ;  // модуль ОБЪЯВЛЯЕТ
    int groundCoord = 3;
    int roomStride = 4;
    std::uint32_t (*doorways)(int, unsigned, std::vector<Doorway>&) = nullptr;
};
```
и переписать `floor_gravity_regime()`/`floor_ground_coord()`/`floor_doorways()` в лукап по номеру этажа. Это убирает разом `floor_gen.cpp:98, 100, 131, 171, 172` и весь split-brain из §3.4.

### 7.3 ГЕЙТ — главное. Гейт важнее списка

Инфраструктура **уже есть и её не надо строить**: `tools/check_source_rules.cmake` — текстовый гейт, зарегистрирован как ctest `source_rules`, имеет макрос `_giga_scan(<список> <регекс> <сообщение>)` (`:135`) и грепаемую отдушину `giga-check: allow` (`:30`). Сегодня в нём 7 правил (`throw`, `catch`, `try`, `dynamic_cast`, `typeid`, GLM, Eigen — `:328-344`). Добавление правила — **одна строка плюс текст сообщения**.

**Гейт A — «голая арифметика над координатами вне ядра» (≈15 LOC, риск НИЗКИЙ).**
Три `_giga_scan`-правила, применяемые ко всему `src/` кроме белого списка `src/core/`, `src/world/wrap*`, `src/world/coords.h`:

1. Запрет `static_cast<int>(<что угодно> / kCellSize)` — «используй `cell_of` из `world/coords.h`».
2. Запрет `wrapf(` вне `src/core/` и `src/sim/physics.cpp` — «используй `wrap_pos`; поосевой `wrapf` — это способ забыть одну ось (combat.cpp:168, :1691)».
3. Запрет литералов `128`/`256`/`0.25` рядом с токенами `kCellSize|kMacroDim|kWorldExtent|Dim|Grid|extent` — «выводи из `world/types.h`».

Ловит: все 82 инлайна §4, оба пропуска z из §1.3, весь C++-столбец §5.3. Отдушина остаётся для честных исключений и грепается (`rg "giga-check"`).

**Гейт B — «неполная тороидальная тройка» (≈30 LOC, риск НИЗКИЙ, лучшая отдача).**
Скан не по регексу, а по окну: файл читается построчно, при встрече `wrap_delta_f` берётся окно ±4 строки; если в нём есть `wrap_delta_f` по одним осям И голая одноимённая разность `.a - .a` по другой — падение. **Этот скан у меня уже написан и прогнан сегодня** (`/tmp/markoaudit2/scan.py`): он нашёл ровно 11 мест, включая два, которых не было в известных зацепках (`spatial_audio.cpp:33`, и он же подтвердил `noise.cpp:236`). Ноль ложных срабатываний. Портирование в CMake или отдельный ctest на python — механическая работа.

**Гейт C — «поверни мир» (≈120 LOC, риск СРЕДНИЙ, но это единственный СЕМАНТИЧЕСКИЙ гейт).**
Полутора-строчный прототип уже существует: `tests/suite_gravity_regimes.inl` гоняет 6 направленных режимов и, как верно замечено на `:6-8`, «*passing for all 6 at once is impossible with any single hardcoded axis*». Расширить его на системы, которые сегодня НЕ покрыты — а это ровно те, где §2.2 нашла нарушения:

| Что добавить | Что поймает сегодня |
|---|---|
| `seed_room_furniture` под `PosX` | `room_zone.cpp:484` |
| размещение ламп/щитов под `PosX` | `prop_system.cpp:432-440, 353-360` |
| `spawn_mob_pack` под `NegY` | `mob_spawn.cpp:369-378` |
| `los_clear` / `noise_audible` / `spatial_evaluate_geom` через каждый из трёх швов | все 6 строк §1.2 с осью z |
| дистанционные тесты (`find_nearest_interactable`, `loot_corpse`) с обеих сторон каждого шва | все 8 строк §1.2 с осью y |

Последние две строки — это, по сути, **гейт D**, и его стоит выделить: **«поставь две сущности по разные стороны шва на 2 м и проверь, что система их видит»**, прогнанное по всем трём осям. Дешёвый (≈40 LOC на систему), не требует поворота мира и ловит ВСЕ 13 нарушений §1.2 напрямую, включая те, где ось z спрятана за фальшивой ссылкой на AGENTS.md.

**Гейт E — GLSL (≈10 LOC, риск НИЗКИЙ).**
В `CMakeLists.txt:263-267` добавить к вызову `glslc` набор `-DGIGA_MACRO_DIM=128 -DGIGA_CELL=2.0 -DGIGA_SUB_DIM=8 -DGIGA_EXTENT=256.0`, генерируемых **из самих C++-констант**, и правилом гейта A запретить литералы `128`/`256`/`7`/`0.25` в `shaders/`. Закрывает весь столбец §5.2 разом, включая живой баг `prop.frag:254`, и снимает ДУБЛЬ `raymarch.frag:86-88` ↔ `shadow_march.glsl:23-25`.

### 7.4 Оценка

| Работа | LOC | Риск | Что закрывает |
|---|---|---|---|
| Примитивы ядра (§7.2, файлы 1-4) | ≈155 нового | НИЗКИЙ (чистое добавление, старое не трогается) | делает правильный путь короче неправильного |
| Механическая замена ≈200 строк инлайнов на `cell_of`/`world_of` | ≈200 правок | **СРЕДНИЙ** — переход `усечение → floor` меняет поведение при отрицательных координатах, а `D-угол → D-центр` сдвигает точки на 1 м. **Это и есть починка §4.2**, но прогнать надо весь ctest и `--shot` | §4 целиком |
| Правка 14 нарушений тора (13 + `fold_back`) | ≈45 | НИЗКИЙ | §1.2, §4.2(ж) |
| Правка 16 мест анизотропии | ≈120 | СРЕДНИЙ (задевает размещение — миры пересоберутся, старые сейвы могут разъехаться по мебели) | §2.2 |
| Хук модуля этажа (§7.2, файл 5) | ≈80 | НИЗКИЙ | §3.4, §6 (5 из 6 нарушений закона) |
| **Гейт A** (регексы) | **≈15** | **НИЗКИЙ** | не даст вернуться §4, §5.3 |
| **Гейт B** (окно тройки) | **≈30** | **НИЗКИЙ** | не даст вернуться §1.2 (скан готов и проверен) |
| **Гейт D** (две сущности через шов) | **≈40 на систему** | **НИЗКИЙ** | ловит §1.2 семантически |
| Гейт C (поворот мира) | ≈120 | СРЕДНИЙ | §2.2 семантически |
| **Гейт E** (`-D` в glslc) | **≈10** | **НИЗКИЙ** | §5.2 целиком |

**Порядок, который я бы предложил владельцу.** Сначала гейты B, D и E — 80 LOC суммарно, риск низкий, и они **сразу покраснеют** на существующих дефектах, то есть станут рабочим списком, который нельзя проигнорировать. Потом примитивы ядра. Потом правки под красными гейтами. Гейт A — последним, когда инлайны уже заменены, иначе он покраснеет 82 раза и его отключат.

Обратная полярность проверена там, где это было возможно: скан §7.3-B прогнан по дереву сегодня и дал 11 попаданий, из которых 9 подтверждены чтением кода вручную и 2 оказались новыми — то есть он ловит, а не рисует PASS.

---

## Приложение: сводка по классам

| Класс | Количество | Где смотреть |
|---|---|---|
| **НЕ-ТОР** | **14** подтверждённых мест (+12 транзитивных вызывающих `find_nearest_interactable`) | §1.2, §4.2(ж) |
| **АНИЗОТРОПИЯ** | 16 мест | §2.2 |
| **ДУБЛЬ** | `floor_ground_z`↔`floor_ground_coord`; `raymarch.frag`↔`shadow_march.glsl`; `kArrivalCoord`↔`kPadicGroundCoord`; `kEmbodyCellSize`↔`kCellSize`; `agent_cell` ×2; `adjacent_wall` ×2; пересчёт координат ≈200 строк | §3.4, §4.4, §5.2 |
| **ХАРДКОД** | 19 GLSL + 12 C++ | §5, §4.4 |
| **МЁРТВОЕ** | `GravityField::region`/`RegionFn`; 7 из 8 значений `GravityRegime`; 6 веток `Custom`; `gravity_frames()` для Zero; `kBlameGroundCoord`; гейт `main.cpp:3090` | §3.3, §4.2(е) |
| **БАГ** (наблюдаемо сейчас) | `ai.cpp:681`↔`diffusion.cpp:105` (страх пишется в одну клетку, читается из другой); `prop.frag:254` (пропы вечно пульсируют на 25%); `combat.cpp:1623/1651` (нормаль рикошета от чужой грани); `wander.cpp:424`↔`ai.cpp:1205` (один узел решётки в двух точках, 1 м); `embody.cpp:130-134` (fold_back зажимает вместо заворота, граница 255 при сетке 128); `los.cpp:99` (стрельба через z-шов заблокирована); `spatial_audio.cpp:35` (глухота через z-шов); `prop_system.cpp:562` (12 систем взаимодействия слепы у y-шва); `combat.h:94`↔`prop_system.cpp:394` (щит смещён на 1 м) | §1.2, §4.2, §5.1 |
| **Сфабрикованные / устаревшие ссылки в комментариях** | **7**: `los.cpp:97-98`, `noise.cpp:235-237`, `combat.cpp:164-165` (все три опровергаются `AGENTS.md:206-212`); `diffusion.cpp:102-103` и `diffusion.h:342-347` (про `combat.cpp`); `ai.cpp:678-680` (про `fold_back`); `combat.cpp:980` (про «те же два зонда»); `ai.cpp:1201-1202` (про «тот же фолбэк»); плюс `gpu_gas_pass.cpp:264` и `light_grid.comp:33-34`, противоречащие соседнему коду | §1.4, §4.2, §4.3, §5.3 |

### Приложение Б: методическое замечание

Ни один комментарий в этом дереве не был принят за доказательство, и это оправдалось: из **девяти** проверенных утверждений вида «здесь так же, как в X» **семь оказались ложными**. При этом сам код содержит и правильный ответ, записанный однажды и не распространённый (`combat.cpp:2325-2326`), и правильные эталоны реализации (`physics.cpp`, `fluid.cpp`, `antourage.cpp`, `nav.cpp`). Дерево не заблуждается насчёт канона — оно не имеет механизма, который бы заставил канон исполняться. Отсюда приоритет §7.3 над всем остальным.
