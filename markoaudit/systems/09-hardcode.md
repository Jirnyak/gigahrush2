# 09 — Кросс-репозиторный аудит ХАРДКОДА

Дерево: `/Users/jirnyak/Mirror/gigahrush2`, ветка `torus`, HEAD `97bdf13e`.
Все `file:line` проверены **2026-08-17** чтением файла или `grep`, не по памяти.
Работа только на чтение; ни один файл репозитория не изменён.

**Закон владельца, по которому идёт оценка:** константа обязана ВЫВОДИТЬСЯ из свойств
объекта, и вывод должен быть виден рядом с константой. «Назначено на глаз» и «взято от
максимума» — нарушение, даже если число сегодня правильное.

---

## 0. Замер: стало хуже, а не лучше

Скрипт по `src/**/*.{h,cpp}` (регэксп на `constexpr <тип> k<Имя> = <выражение>;`, массивы
исключены), прогон 2026-08-17:

| метрика | значение |
|---|---|
| скалярных `constexpr k*` всего | **805** |
| из них инициализатор — голый литерал | **588 (73 %)** |
| из них ещё и БЕЗ вывода в комментарии (< 40 символов пояснения) | **320 (39 %)** |
| из этих 320 — реальные тюнинг-числа (не sentinel, не id из CSV, не ёмкость буфера) | **271** |

Прошлый замер в задании: 504 из 695 (72 %). Сегодня 588 из 805 (73 %). **Доля не
изменилась, абсолютное число нарушений выросло на 84.** Правило без гейта не удерживает
ничего: каждый новый инкремент добавляет литералы ровно с той же скоростью, с какой
добавляет код. Это главный аргумент за §8.

Распределение голых литералов по каталогам:

| каталог | голых / всего | комментарий |
|---|---|---|
| `src/game` | 436 / 558 | эпицентр |
| `src/render` | 43 / 85 | лучше среднего |
| `src/world` | 34 / 51 | ядро дисциплинировано (см. `types.h`, `lattice.h`) |
| `src/game/antourage` | 24 / 28 | почти сплошь |
| `src/audio` | 22 / 23 | почти сплошь |
| `src/sim` | 5 / 21 | **лучший результат в дереве** |
| `src/game/floors/padic` | 15 / 20 | |
| `src/app` | 12 / 17 | |
| `src/core` | 1 / 3 | |

`src/sim` (5/21) и `src/world/types.h` — доказательство, что закон исполним: там, где его
держали, он держится.

### Эталоны «как надо» (для сравнения во всех разделах ниже)

1. `src/game/impact.cpp:35` — `joules = 0.5f * m->kg * eff * eff`, обе константы выведены
   и посчитаны в `impact.h:29-36` (калибровка на теле 70 кг: 5 м → ~20 HP, 10 м → ~98 HP).
2. `src/core/tick.h:27-33` — `kSimDt = 1.0f/kSimHz`, `kSimStepMs = 1000/kSimHz`, плюс
   `static_assert(kSimStepMs * kSimHz == 1000)`. Вывод + машинная проверка вывода.
3. `src/world/lattice.h:32-37` — `kLatticeSpacing = kMacroDim / kLatticeDim` + два
   `static_assert`. Ровно та форма, которой не хватает 271 месту.
4. `src/sim/physics.cpp:130` — `kStepRise = kVoxelSize + 0.01f`. Одна строка, вывод виден.
5. `tools/check_source_rules.cmake:415-452` (Rule 7) — **обе** стороны выведены: скрипт
   пересчитывает строки CSV и сверяет с числом, которое эмитил генератор. Человек не
   перепечатывает число никогда. Образец для §6 и §8.

---

## 1. Категория А — ХАРДКОД-МИРА

Канон `src/world/types.h`: `kMacroDim=128`, `kSubDim=8`, `kSubVoxels=512`,
`kCellSize=2.0f`, `kVoxelSize=kCellSize/kSubDim=0.25f`, `kWorldExtent=kMacroDim*kCellSize=256.0f`.

**Хорошая новость и она честная:** C++-сторона размеров мира почти чистая. Полный обход
`src/`, `tests/`, `tools/` дал 5 HIGH-нарушений, а не 40+. `physics`, `camera`,
`diffusion`, `fluid`, `room_zone`, `door`, `wander`, `save/load`, `nav bake`, оба
floor-модуля — везде именованные константы. Этот раунд аудита уже проходили.

| # | file:line | литерал | должно быть | класс |
|---|---|---|---|---|
| А1 | `src/render/gpu_gas_pass.cpp:266` | `vkCmdDispatch(cmd, 8, 8, 128)` | `kMacroDim/16, kMacroDim/16, kMacroDim` (local_size 16×16×1 в `gas_sim.comp:10`). Комментарий на :264 сам пишет «128/16 × 128/16 × 128/1» — вывод есть, в коде его нет. Файл использует `kMacroCells` на строках 44/76/207, т.е. заголовок уже подключён | ХАРДКОД-МИРА |
| А2 | `src/game/population.cpp:25` | `constexpr int kRoomsPerAxis = 128 / kRoomStride; // 8` | `kMacroDim / kRoomStride`. Тот же файл на :192 уже пишет `kMacroDim` для того же — внутрифайловая непоследовательность | ХАРДКОД-МИРА |
| А3 | `src/world/material_props.h:83` | `kSubVoxelVolumeM3 = 0.25f * 0.25f * 0.25f` | `kVoxelSize*kVoxelSize*kVoxelSize`. **Правится не здесь**, файл генерируемый → `tools/gen_material_table.py:263` | ХАРДКОД-МИРА |
| А4 | `src/game/embody.h:43` | `kEmbodyCellSize = 2.0f` | `kCellSize`. Локальная копия мировой константы с комментарием «Kept here so embodiment can place ... without pulling in app code» — но `kCellSize` живёт в `world/types.h`, а не в app | ХАРДКОД-МИРА |
| А5 | `tools/xray_map.cpp:516,525-528` | строка `"TORUS: 256m x 256m x 256m (128^3 …)"`, подпись линейки `"128m (64c)"`, длина линии `64 px` | `kWorldExtent`/`kMacroDim` через `%g/%d`; линейка зависит от `--width` (дефолт 1024), при другом `--width` подпись врёт | ХАРДКОД-МИРА |
| А6 | `src/game/ai.h:486` | `kMemCellBits = 7; // kMacroDim == 128 -> 7 bits/axis` + маски `0x7Fu` на :493-504 | нет `static_assert(kMacroDim == 128)`. `types.h:6` прямо обещает, что `kSubDim` — «one-line change»; при смене `kMacroDim` маски молча обрежут координату | ХАРДКОД-МИРА (MED) |
| А7 | `src/render/voxel_mirror.h:101` | `kMaskBytesPerCell = 64 // 8x uint64` | `kSubMaskWords * sizeof(std::uint64_t)`. Соседние строки 102-106 выведены правильно — эта одна выпала | ХАРДКОД-МИРА (LOW) |
| А8 | `src/game/floors/padic/padic_module.cpp:38-41` | `kCorr0 = 16; // kLatticeHalf` / `kLatticeSpacing = 32` / `kLatticeDim = 4` | буквальная копия `world/lattice.h:26-33`, где всё выведено и защищено `static_assert`. Достаточно `#include "world/lattice.h"` | ХАРДКОД-МИРА |
| А9 | `tests/sim_bench.cpp:181`, `tests/suite_diffusion.inl:494-497,656-660`, `tests/world_test.cpp:53-59`, `tests/e2e_test.cpp:642-645` | `128`, `256.0f`, `127`, `64` в форматных строках и координатах | косметика: тесты общих `wrapi`/`wrap_delta` законно берут произвольный период; форматные строки «128^3» рядом с живым `kMacroCells` — рассинхрон при смене канона | ЗАКОННО / LOW |

**Проверено и НЕ нарушение** (чтобы не переоткрывать): `kMatHardness` 256/128/64 —
независимая шкала прочности (`jirnyak.md §1`); `-128/127` — границы `int8_t`;
`char buf[128]` — буферы форматирования; `destruct.cpp:293` `kSubGridDim*0.25f` — буквально
«четверть мира», не `kVoxelSize`; `xray --width=1024`, `measure_materials.py SAMPLE=256` —
параметры инструментов.

### 1б. Шейдеры против C++ — один живой баг и шесть копий сетки

**ЖИВОЙ БАГ. `shaders/prop.frag:254`.**

```glsl
float samosborPulse = pc.torus.z > 0.0 ? pc.torus.z
    : clamp((1.0 - pc.fog.x / (128.0 * 0.30 * 2.0)) / 0.66, 0.0, 1.0);
```

Цепочка проверена целиком сегодня:
* `src/app/main.cpp:6966` считает `samosborPulse = clamp((1-fogScale)/(1-kSamosborFogSqueeze),0,1)`
  и кладёт его в `push.torus.z` (`main.cpp:6973`). `kSamosborFogSqueeze = 0.34f` (`main.cpp:172`).
* `PropPass` инициализируется от `cubePass.pipeline_layout()` (`main.cpp:1702`) — то есть
  `prop.frag` получает **тот же** `CubePush`. `prop_pass.cpp:304` читает `push.torus.x`.
* Без самосбора `fogScale == 1.0` → CPU честно даёт **ровно `0.0`**. Это легальное
  значение, а не «не заполнено».
* Тест `pc.torus.z > 0.0` не отличает легальный ноль от «не заполнено» → падает в
  запасную ветку и пересчитывает пульс сам: берёт `pc.fog.x` (**начало** тумана
  `= kWorldExtent*0.25*fogScale = 64.0`, `main.cpp:6967`) против литерала
  `128.0*0.30*2.0 = 76.8`.
* Итог: `clamp((1 − 64/76.8)/0.66, 0, 1) ≈ **0.2525**` вместо `0`. **Все пропы в игре
  постоянно живут с пульсом самосбора ≈ 0.25.** Это раздувает `kAbsorption` в
  `volumetric_fog.glsl:222` (`0.035*(1+pulse*3.5)`) и эмиссивный шум в `prop.frag:180-181`.

`cube.frag:632-644` — **уже починенный близнец**: считает через `pc.fog.y / (pc.torus.x*0.5)`,
период приходит из push-блока, и над ним стоит комментарий с разбором ровно этой ошибки
(«divisor was 128.0*0.50 = 64 instead of the 128 that is kWorldExtent*0.5», `problems.md §20`).
`prop.frag` — та же семья, но починку не получил. Это буквально та же ошибка через один
файл, и она сегодня живая.

**Шесть независимых копий макро-сетки в GLSL.** Все шесть сегодня совпадают с
`world/types.h`, но связаны только руками; при смене `kSubDim` (которую `types.h:6` называет
однострочной) сломаются молча и порознь:

| # | файл | форма |
|---|---|---|
| 1 | `shaders/raymarch.frag:86-88` | именованные `kMacroDim=128 / kCell=2.0 / kVoxel=0.25` |
| 2 | `shaders/shadow_march.glsl:23-25` | вторая именованная копия — `kSmMacroDim / kSmCell / kSmVoxel` |
| 3 | `shaders/particle_sim.comp:35-37` | безымянные `&127`, `*0.5`, `*8.0`, `&7` |
| 4 | `shaders/cloth_sim.comp:35-38` | те же безымянные |
| 5 | `shaders/wire_sim.comp:38-41` | те же безымянные |
| 6 | `shaders/gas_sim.comp:73,75,120-133` | `>=128`, `<<7`, `<<14`, `&127u` |

В `shaders/` уже есть механизм общих include (`flicker.glsl`, `material_surface.glsl`,
`shadow_march.glsl`, `volumetric_fog.glsl`) — то есть решение стоит один файл
`shaders/world_grid.glsl`, а не архитектурную работу.

**Световая сетка — договор на честном слове.** `src/render/gpu_light_grid.h:22-25`
(`kGridDimX/Y/Z = 64`, `kGridCellMeters = 4.0f`) и `shaders/volumetric_fog.glsl:34-35`
(`kLightGridDim = 64`, `kLightGridCell = 4.0`) захардкожены **независимо с обеих сторон**.
Комментарий в заголовке пишет прямым текстом: *«Числа обязаны совпадать с
kLightGridDim/kLightGridCell в shaders/volumetric_fog.glsl»* — обязанность есть, механизма
нет. При этом сами числа обязаны выводиться: `64 × 4 м = 256 м = kWorldExtent`, то есть
`kGridDimX = kMacroDim / 2` и `kGridCellMeters = kWorldExtent / kGridDimX`.

**Гниль в комментариях и логах** (не влияет на GPU, но обманывает следующего читателя):
* `src/render/gpu_light_grid.cpp:68` печатает в stderr `"(32x16x32 grid, max 256 lights)"` —
  реально 64³ и 512.
* `src/render/gpu_light_grid.h:58-61` и `shaders/light_grid.comp:32-35` описывают
  `camPos.w = max range (48.0m)`, `cell size (2.0m)`, `gridExt (32,16,32)`,
  `maxLightsPerCell (15)`. Реально пушится (`gpu_light_grid.cpp:275-289`): `camPos.w = 0`
  (поле мёртвое), `4.0`, `(64,64,64)`, `31`.

**Проверено и в порядке:** `cull.comp` берёт `fogEnd`/`torusPeriod` только push-константами
(`main.cpp:6797-6798`, формула байт-в-байт совпадает с мировым пасом); `kMaxParticles=32768`
живёт только в C++ (`particle_pass.h:42`), в шейдер идёт счётчиком; `kFogDistScale` из
памяти — **действительно похоронен**, `distance_fog()` в `volumetric_fog.glsl:75-77` теперь
чистый `smoothstep`, и над ним стоит эпитафия.

---

## 2. Категория Б — ХАРДКОД-ТЕЛА

Канон: рост → тело. `src/game/embody.cpp:24-37` этот закон **исполняет** и является
локальным эталоном:

```cpp
float body_half_height(h_mm) { return resolved_height_mm(h_mm) * 0.001f * 0.5f; }
float body_mass_kg(h_mm)     { return 22.0f * hm * hm; }   // BMI-подобный вывод
float body_eye_height(h_mm)  { return h*0.5f - h*0.07f; }  // глаза на 7% ниже темени
```

Дальше закон рвётся в шести местах.

### 2.1 «4×4×7 субвокселей» — заморожено, и уже на один слой короче тела

`src/game/room_zone.cpp:44-51` строит `kBodyFootprint` циклом `sy/sx ∈ [2,5]` — четыре
субвокселя по каждой горизонтали, границы вписаны руками.
`src/game/room_zone.cpp:58` — `kBodySubLayers = 7`, а комментарий на :52 обосновывает:
«1.7 m of body needs 7 of the cell's 8 sub-layers».

**Но `kDefaultHeightMm = 1800` (`embody.h:47`), а не 1700.** `1.8 / kVoxelSize = 7.2` →
телу по умолчанию нужно **8** субслоёв, не 7. Проходимость комнат сегодня считается по телу
1.7 м, а рождаются тела 1.8 м; статуры в дереве доходят до 2200 мм (`combat.h:367-372`).
Файл под своим же баннером «STRICTER THAN NAV, NEVER LOOSER» стал looser относительно
реального коллайдера.

Готовая замена (воспроизводит горизонталь ровно, вертикаль чинит):
```cpp
inline constexpr float  kBodyHalfWidthM = 0.4f;            // = embody.cpp:55
inline constexpr int    kBodySubHalf    = ceil_i(kBodyHalfWidthM / kVoxelSize);   // 2
// границы цикла: [kSubDim/2 - kBodySubHalf, kSubDim/2 - 1 + kBodySubHalf] == [2,5]
inline constexpr int    kBodySubLayers  = ceil_i(kDefaultHeightMm * 0.001f / kVoxelSize); // 8
```

### 2.2 Четыре разных ответа на «AABB по умолчанию»

| file:line | значение | что это |
|---|---|---|
| `src/ecs/components.h:31` | `{0.4, 0.4, 0.9}` | дефолт структуры (полувысота 0.9 = тело 1.8 м — согласовано с `kDefaultHeightMm`) |
| `src/sim/physics.cpp:199` | `{0.4, 0.4, 0.4}` | фолбэк солвера — тело 0.8 м, карлик |
| `src/game/save.cpp:1008` | `{0.4, 0.4, 0.4}` | третья копия; комментарий :1002-1005 **сознательно** держит её равной солверу, а не структуре |
| `src/game/door.cpp:50` | `{0.4, 0.4, 0.4}` | четвёртая копия, без имени |

Ни одна не ссылается на общую константу. Правка: одна `inline constexpr vec3 kDefaultBodyHalf`
в `components.h`, три `#include`.

### 2.3 `embody.cpp:55` — полувысота выведена, подошва нет

`reg.emplace<AABB>(e, AABB{vec3{0.4f, 0.4f, hh}})` — `hh = body_half_height(...)`, а `0.4/0.4`
литералы. Ребёнок 1.2 м получает плечи взрослого. `0.4 / kVoxelSize = 1.6` — даже не целое
число субвокселей, при том что нав меряет тело именно субвокселями (§2.1).
Замена: `body_half_width(height_mm)` рядом с `body_half_height` — например
`0.222f * h` (плечевая ширина ≈ 0.22 роста даёт ровно 0.4 при 1.8 м).

### 2.4 БАГ: труп читает не ту ось — и падает вбок

`src/game/combat.cpp:539-545`:
```cpp
if (auto* aabb = reg.try_get<AABB>(e)) {
    const float h = aabb->half.y;               // ← ШИРИНА, не рост
    aabb->half.y = 0.18f;
    aabb->half.z = std::max(h * 0.75f, 0.55f);
}
if (auto* tr = reg.try_get<Transform>(e)) {
    tr->pos.y -= 0.45f;                          // ← «на пол» вдоль ГОРИЗОНТАЛЬНОЙ оси
}
```
Два дефекта в семи строках:
1. `half.y` для любого NPC и игрока — это всегда `0.4` (`embody.cpp:55`), рост живёт в
   `half.z`. Значит `h*0.75 = 0.3 < 0.55` **всегда**, и длина всякого трупа зажимается в
   `0.55` независимо от статуры. Ребёнок 1.4 м и мужик 2.2 м ложатся одинаковыми. Рост
   перестаёт вести тело ровно в момент смерти.
2. `tr->pos.y -= 0.45f` двигает труп по **Y**, тогда как гравитация в этом мире — `-Z`
   (`gravity.h:113`, `physics.cpp:202` `vec3 up{0,0,1}`). Это остаток Z-хардкода
   («буква оси вместо фрейма»), тот самый класс, что `problems.md §9` держит открытым.

Плюс косметика без вывода в том же блоке: `0.18f`, `0.75f`, `0.55f`, `0.45f`, и
`rend->color * {0.35, 0.35, 0.40}` (`combat.cpp:549`).

### 2.5 Прыжок: литерал, который обнулил запас в `impact.h`

* `src/ecs/components.h:71` — `Jump::impulse = 5.0f`.
* `src/game/embody.cpp:62` — `reg.emplace<Jump>(e, Jump{6.5f, false})`, т.е. **реальный
  игрок прыгает не тем числом, что стоит в дефолте структуры**.

Теперь сложим с эталоном. `src/game/impact.h:29-33` обосновывает `kImpactFreeSpeed = 6.5f`
так: *«The jump arc peaks at 1.27 m and lands at ~5 m/s; 6.5 leaves margin over it plus a
step off a 2 m cell (~6.3 m/s)»*. Проверяем: `5.0²/(2·9.81) = 1.274 м` ✓ — вывод сделан для
импульса **5.0**, то есть для дефолта структуры. Но живое тело прыгает с **6.5**, приземляется
ровно на 6.5 м/с, и `eff = 6.5 − 6.5 = 0`.

**Обещанный в эталонном файле запас равен нулю.** Любой встречный ветер, `kAirDragCoef`
(`src/sim/drag.h:28`) или лишний тик — и обычный прыжок начинает кровить. А шаг с одной
клетки: `sqrt(6.5² + 2·9.81·2) = 9.03 м/с` → `eff = 2.53` → `0.05·0.5·71·2.53² ≈ 11 HP` за
спуск на один этаж по лестнице.

Это самая дорогая находка аудита: голый литерал в `embody.cpp:62` тихо аннулировал
выведенную константу в лучшем файле дерева. Замена:
```cpp
inline constexpr float kJumpApexM = 1.27f;              // проектная высота прыжка
inline float jump_impulse(float gMag) { return std::sqrt(2.0f * gMag * kJumpApexM); }
// embody.cpp:62 → Jump{ jump_impulse(length(world.gravity().global)), false }
```
и тогда `kImpactFreeSpeed` в `impact.h` тоже должен считаться от `jump_impulse`, а не стоять
числом.

### 2.6 Прочее по телу и агентам

| file:line | что | значение | вердикт |
|---|---|---|---|
| `src/game/mob_spawn.cpp:126-136` | `mob_half_extents` — 7 строк `vec3` по тирам | `{0.30,0.30,0.35}` … `{0.90,0.90,1.70}` | ХАРДКОД-ТЕЛА: у мобов вообще нет поля роста в `mobs.csv`, закон «рост→тело» на них не распространён по построению |
| `src/game/embody.cpp:103`, `src/app/main.cpp:1463,1511` | `Controller{7.0f, …}` | 7.0 | расходится с `kPlayerWalkSpeed = 6.0f` (`main.cpp:754`) и с дефолтом структуры (`components.h:87`). Перетирается каждый тик (`main.cpp:3348`) → сегодня безвредно, но это третье число для одной величины |
| `src/ecs/components.h:81` | `CameraTag::eyeOffset = {0,0,0.7f}` | 0.7 | не соответствует `body_eye_height` ни при одном росте (0.7 → рост 1.63 м); перетирается в `embody_as_player` |
| `src/ecs/components.h:50` | `Mass::kg = 70.0f` | 70 | `body_mass_kg(1800) = 71.28`; фолбэк, риск низкий, но число «на глаз» |
| `src/game/combat.h:415` | `kMeleeReachSlack = 0.9f` | 0.9 | комментарий выводит его из «half-extents up to 0.9 m» — то есть из **дефолта структуры**, а не из максимальной статуры (2200 мм → `body_half_height = 1.1`). Просрочен на 0.2 м |
| `src/game/combat.h:350` | `kKnockbackRefMassKg = 67.4f` | 67.4 | равно `22·1.75²`; `body_mass_kg` не `constexpr`, поэтому синхронизируется руками. При этом «стандартный взрослый» в дереве **два разных**: 1.75 м здесь и 1.80 м в `embody.h:47` |
| `src/game/ai.h:797` | `kSeatArriveM = kCellSize * 0.35f` | 0.7 м | полувыведено: `kCellSize` есть, коэффициент 0.35 — литерал (0.7 м = 2.8 субвокселя, нецелое) |
| `src/game/ai.h:769` | `kSwitchMargin = 7.0f` | 7 | **долг из памяти закрыт**: одно определение, одна точка использования (`ai.cpp:305`), лишнего `8` в дереве нет |
| `src/game/loot.cpp:29` vs `src/app/main.cpp:5996` | половина габарита предмета на полу | `0.16` vs `0.15` | два разных куба для одного понятия, две точки спавна |
| `src/game/combat.cpp:1193,1240,1283` | AABB гранаты | `{0.10,0.10,0.10}` ×3 | один литерал, продублированный трижды вместо имени |

**Не найдено (и, похоже, правильно):** приседания нет; радиуса сепарации в толпе нет —
стиринг построен на полях потока (`room_zone.cpp`), не на боидах, так что искать нечего.

---

## 3. Категория В — ХАРДКОД-ФИЗИКИ

### 3.1 Отбрасывание: закон восстановили, число — нет

`src/game/combat.cpp:373-383` **уже починен** относительно того, что описано в задании:
импульс делится на массу (`p = m·v`), нормировка на `kKnockbackRefMassKg`. Но:

```cpp
const float impulse = 2.5f * (kKnockbackRefMassKg / kmass);
```

`2.5f` — по-прежнему плоская величина для **любого оружия**, а колонка `knockback` в
`data/weapons_melee.csv` остаётся мёртвой: `src/game/weapon_table.h:34` эмитит
`std::uint16_t knockbackMm;` с честным комментарием *«unused by physics yet; recorded, not
invented»*, и во всём `src/` нет ни одного чтения `.knockbackMm` (проверено grep сегодня).
Кувалда и нож толкают одинаково.
Замена: `const float impulse = wp->knockbackMm * 0.001f * (kKnockbackRefMassKg / kmass);`

### 3.2 Рикошет: десять чисел, привезённых из чужого форка

`src/game/combat.cpp:1629-1683`, помечено в самом коде: *«формула форка 16004b86, нормаль —
НАША»*. К чести автора, нормаль действительно переделана и разбор старой ошибки записан
(argmax скорости давал `cos ≥ 0.577`, выше обоих порогов → рикошет форка был мёртвым кодом).
Но десять решающих чисел — привозные:

| line | число | роль | из чего обязано выводиться |
|---|---|---|---|
| 1673 | `>= 180` | порог «твёрдого» | `material_hardness()` уже читается тут же — порог обязан быть долей шкалы: `kMatHardness[kMatConcrete] * 0.70f` (256·0.7 = 179) |
| 1675 | `0.55 / 0.40` | `maxCos`, окно угла | угол скольжения — свойство пары «шероховатость/твёрдость» из `materials.csv`, не два числа по списку id |
| 1680 | `0.55 / 0.40` | `eRest`, упругость | то же; при этом численно совпадает с `maxCos` — совпадение или copy-paste, из кода не видно |
| 1680 | `0.85 / 0.70` | `fFric`, тангенциальное | то же |
| 1638 | `p.dmg >= 4` | порог «это пуля» | должно быть свойством `ProjType`, не порогом урона |
| 1638 | `spd > 1.0f` | минимальная скорость | |
| 1672 | `cosInc > 0.01f` | нижняя граница касания | |
| 1688 | `0.02f` | отжим от грани | `kVoxelSize * 0.08f`, иначе при смене субвокселя пуля залипнет |
| 1693 | `65 / 50` (%) | съеденный урон | |
| 1706 | `12 / 6` | число искр | |

Плюс **самое дорогое** в этом блоке (см. также §5): классификация материала списком id.
`combat.cpp:1668-1674`:
```cpp
isSteel    = mat==kMatTread || kMatElectricGrate || kMatPipeMetal || kMatDoor || kMatShopShutter;
isConcrete = mat==kMatConcrete || kMatFactoryWall || kMatSlabTan || outOfZ;
```
Это придуманная в C++ таксономия, и она **уже расходится с CSV**: `kMatPipeMetal` и
`kMatFactoryWall` в `data/materials.csv` оба `family=ribbed`, а код разводит их по разным
классам. При этом строкой ниже (`:1673`) тот же блок **правильно** спрашивает
`material_hardness(mat)` — верный приём стоит в трёх строках и не переиспользован.
Новый 21-й материал по умолчанию не отскакивает никак и никто не заметит.
Замена: колонка `acoustic = metal|concrete|soft` в `materials.csv` → `kMatAcoustic[]`.

### 3.3 Свой закон гравитации у снарядов

`src/game/combat.h:422` — `kProjGravity = 6.0f; // m/s^2`.
Направление честное: `combat.cpp:1473-1479` берёт `stack.layer(layer).gravity().at(tr.pos)`,
нормирует и умножает — фрейм соблюдён, и это записано в комментарии. Но **величина
игнорирует поле полностью**: на этаже с половинной гравитацией пуля всё равно падает с
6 м/с². `GravityRegime` имеет 8 значений (`gravity.h`), и `Zero` — тоже одно из них: в
невесомости снаряд продолжит падать.
Замена: `const float mag = projGLen * kProjGravityFraction * (p.gravityPct*0.01f) * dt;`
с `kProjGravityFraction = 6.0f / 9.81f = 0.61f` — читаемость дуги сохраняется, закон
восстанавливается.

### 3.4 `-9.81f` в трёх местах

`src/world/gravity.h:113`, `src/game/floors/blame/blame_gen.cpp:662`,
`src/game/floors/padic/padic_gen.cpp:577`. Ни одной именованной константы. Модуль этажа,
задающий земную гравитацию, обязан писать `kGravityEarth`, а не перепечатывать число.

### 3.5 Прочая физика

| file:line | константа | вердикт |
|---|---|---|
| `src/game/combat.h:834-835` | `kBulletCarveRadius = 0.35f`, `kMeleeCarveRadius = 0.55f` | ХАРДКОД-ФИЗИКИ: радиус выгрызания обязан быть кратен `kVoxelSize` (0.35 = 1.4 субвокселя). `1.5f*kVoxelSize` / `2.0f*kVoxelSize` |
| `src/game/combat.h:445-447` | `kGrenadeRestitution 0.38 / kGrenadeFriction 0.72 / kGrenadeRestSpeed 0.55` | комментарий :435-444 честно выводит их из требования «затухнуть за 4 отскока внутри фузы» — **вывод есть**, но задан обратной задачей, а не свойствами материала. Пограничный случай, оставить с пометкой |
| `src/game/combat.h:424` | `kProjHitRadius = 0.75f` | обоснован туннелированием при `kSimDt`; `combat.h:340-344` считает арифметику. ЗАКОННО-ish, но 0.75 = 3·`kVoxelSize` — стоит записать так |
| `src/game/combat.h:455` | `kBlastCarveScale = 0.35f` | вывод в комментарии есть («0.35 от 5.0 м = 1.75 м — одна честная дверь»). ЗАКОННО-ish |
| `src/sim/drag.h:28` | `kAirDragCoef = 0.19f` | голый литерал; коэффициент лобового сопротивления — свойство формы, обязан считаться от габарита AABB |
| `src/game/prop_system.cpp:594-596` | `kAirDamp 1.5f / kGroundMul 0.85f / kRestW2 1e-4f` | угловое затухание пропа, голые числа; момент инерции считается от габарита и массы, которые у пропа есть |
| `src/game/rpg.cpp:13-27` | **15 подряд** `kStrMeleeDamagePerPoint = 0.01f` … `kIntPsiCostEfficiencyPerPoint = 0.035f` | ни у одной нет ни выражения, ни комментария. Чистый «дизайнерский лист в коде» — см. §4 |
| `src/game/noise.cpp:16-39` | `kWeaponDmgDivisor 7.0f`, `kWeaponRadiusCap 24.0f`, `kBodyRadius 6.0f`, `kScoreNearness 8.0f`, `kBlastTtlMs 4000` … | блок из 13 голых чисел; радиусы слышимости обязаны выводиться от энергии события (у выстрела есть `dmg`, у взрыва — радиус), а не от «capа» |
| `src/game/mob_behaviour.h:323-384,564-568` | `kDeadEchoBackDamage 1.55`, `kWallBiasDamage 1.20`, `kFractureSprintMult 3.25` … (14 шт.) | тактические множители мобов, все голые; кандидаты в `monster_traits.csv` |
| `src/app/main.cpp:155` | `kLampRadius = 14.0f; // metres (7 macro cells)` | **образцовая формулировка проблемы владельца**: вывод написан в комментарии и НЕ написан в коде. Замена ровно `7.0f * kCellSize` |

---

## 4. Категория Г — ДАННЫЕ-В-КОДЕ (самый ценный раздел)

### 4.1 Число в коде при живой колонке CSV

| # | code file:line | число | CSV-колонка | значение в CSV | статус |
|---|---|---|---|---|---|
| Г1 | `src/game/combat.cpp:382` | `2.5f` | `weapons_melee.csv` → `knockback` | по строкам | колонка эмитится (`weapon_table.h:34`), читателей **0** |
| Г2 | `src/game/loot.h:91` | `kPickupReach = 1.8f` | `interactables.csv` строка `loot` → `reach_m` | `2.0` | `interact_def(InteractKind::Loot)` не зовётся **нигде** → строка CSV мёртвая, реальный радиус 1.8 |
| Г3 | `src/app/main.cpp:4203` | `3.5f` | `interactables.csv` → `electrical_shield.reach_m` | `3.5` | **новое**: сосед по файлу (`main.cpp:6433`) на тот же вид зовёт `interact_def(...).reachM` — файл спорит сам с собой по форме |
| Г4 | `src/game/combat.cpp:645` | `2.2f` | `interactables.csv` → `corpse.reach_m` | `2.2` | **новое**: живой путь «смерть→труп» |
| Г5 | `src/game/save.cpp:919` | `2.2f` | то же | `2.2` | **новое**: второй независимый хардкод той же ячейки CSV в другом файле |
| Г6 | `src/game/contract.cpp:77` | `if (c.reward < 20) c.reward = 20` | `economy.csv` → `quest_cap`/`quest_rate` | 250…250000 / 35…1200 | пол награды плоский; `economy.h:179-182` сам пишет, что колонки лежат «because they are the authored contract … ([contract.h] pays flat numbers today)» |
| Г7 | `src/game/contract.cpp:120` | `if (c.reward < 30) c.reward = 30` | то же | | то же |
| Г8 | `src/game/contract.cpp:23,28,32` | `kFetchPayMult 1.6f`, `kHuntPayPerHp 3`, `kDescendPayPerBand 900` | — | — | под колонки нет, но это ровно те ставки, ради которых `quest_rate` заведён |
| Г9 | `src/game/population.cpp:125-126` | `kLootValueCap[band]/8 + 15`, кэп `5000` | `economy.csv` → `cash_cap` | 250 / 2000 / 25000 / 250000 / 5000000 | наличка жителя считается выдуманной формулой от **чужой** колонки, при живой авторской `cash_cap` без единого читателя |
| Г10 | `src/game/item_table.h:222-224` | `kLootValueCap[] = {90,450,4000,80000,250000}` | `economy.csv` → `loot_cap` | те же числа | дубль, но **осознанный и сверяемый** генератором (`gen_economy_table.py:27`). Класс ЗАКОННО-ish, две авторитетные копии одного числа |
| Г11 | `src/game/prop_system.h:37` / `prop_system.cpp:258` | `reachM = 2.5f` дефолт | `props.csv` → `reach_mm` | 2500 у всех строк | поле `Interactable::reachM` пишется (`prop_system.cpp:303`), но **не читается никогда**: `find_nearest_interactable` (`prop_system.cpp:539-548`) берёт радиус параметром. Вся колонка `reach_mm` в `props.csv` — мёртвая; правка в ней ничего не меняет в игре, и это молча |
| Г12 | `src/game/needs.h` (см. `problems.md:1456`) | `kRiskyFeedHpCost = 6` | `items.csv` → `use_b` | −5/−8/−6/−6 | расхождение уже объявлено в `needs.h:151-157` с рецептом; закрыть |

### 4.2 Мёртвые колонки CSV (0 потребителей в `src/`)

| CSV | мёртвые колонки | где обрывается |
|---|---|---|
| `items.csv` (45 колонок) | `name_en`, `stack_declared`, `spawn_count_max`, `science_value`, `contraband_score`, `deceptive_score`, `use_b`, `use_grant_id`, `use_grant_n`, `ammo_id`, `tag_count`, `tags_hot`, `tags_all` — **13** | `tools/gen_item_table.py` вообще не читает эти имена. (`craft_*` 10 колонок НЕ мертвы — их читает `gen_craft_table.py`.) Скилл `dolgi-items-csv` говорит «14 из 42» — цифра устарела относительно сегодняшних 45/13 |
| `economy.csv` | `cash_cap`, `quest_cap`, `quest_rate` | эмитятся в `BankTerms` (`economy.h:185-187`), читателей нет. `deposit_bp`/`loan_bp`/`credit_limit`/`loot_cap` — живые |
| `weapons_melee.csv` | `knockback` | `weapon_table.h:34`, читателей нет |
| `props.csv` | `reach_mm` (де-факто) | пишется в компонент, компонент не читается — см. Г11 |
| `monster_traits.csv` | `terrain`, `bait`, `wet_incoming`, `wet_move`, `dry_move`, `wet_dmg`, `dry_dmg` — **7 из 17** | значения парсятся, функции-запросы существуют (`trait_allows_wet_spawn`, `trait_takes_bait`, `trait_incoming_mult`, `trait_move_mult`, `trait_damage_mult`) — но **ни у одной нет вызывающего за пределами `monster_traits.cpp/.h`**. Заголовок честно помечает мёртвыми 3 из 7; `trait_move_mult`/`trait_damage_mult` не помечены, хотя тоже мертвы — самоаудит файла отстал от дерева |
| `mobs.csv` | `ai_flags`, `n_ai_flags`, `n_rare_drops`, `has_loot_table`, `role`, `def_src`, `eco_src` | провенанс-колонки TS-порта; `gen_mob_table.py` берёт из группы только `idx` как проверку порядка строк. Не дефект, но и не данные |
| `sounds.csv` | — | файл имеет заголовок и **ноль строк данных**; читается в рантайме `src/audio/audio_system.cpp:213`. Механизм жив, контента нет |
| `materials.csv`, `craft_recipes.csv`, `quests.csv`, `status.csv`, `particles.csv`, `speech_lines.csv`, `weapons_ranged.csv`, `textures.csv` | мёртвых не найдено | `weapons_ranged.reload_s` плоский (1.0 на всех 29 строках) — это дыра в авторстве контента, а не мёртвая колонка |

### 4.3 Рукописные таблицы контента в C++

| файл | объём | что | приговор |
|---|---|---|---|
| `src/game/loot_table.cpp` | 363 строки, 136 строк `rareDrops` + 3 `lootTable`, 54 сырых `ItemId` | дроп с монстров | известный случай, подтверждён. Файл сам себя обвиняет в шапке (:17-22): `items.csv` отсортирован по алфавиту, вставка строки сдвигает все id после неё, компилятор не заметит. Страховка — пин `kLootTableValueChecksum` (`loot_table.h:228`), т.е. защита хешем вместо защиты конструкцией |
| `src/game/floor_gen.cpp:40-83` | 6 массивов + `kRoomMix[]`, ~30 пар `(RoomBit, вес)` | веса типов комнат по архетипу этажа | реальная spawn-таблица баланса, CSV нет |
| `src/game/role.h:62-96` | `kRoleTraits[5]` + `kRoleWeights[6][5]` = 65 чисел | множители архетипов NPC и веса ролей по виду этажа | «stats/rates» из закона владельца, живут в заголовке |
| `src/game/room_zone.h:238-260` | `kRoomRecovery[11]` | скорости восстановления Needs по типу комнаты (`Кухня {3.5,4.5,0,0,0,2.1,1.225,0}`) | **ставки** в заголовке — самый прямой конфликт с формулировкой закона |
| `src/game/room_zone.h:121-134,317-333` | `kRoomAffordance[]`, `kRoomFurniture[]` | какая комната закрывает какое намерение; мебель по комнате | то же семейство |
| `src/game/floor_spec.cpp:26-32` | `kCatalog[6]` | население, микс фракций, враждебность, возрастное окно по виду этажа | буквально каталог контента этажей |
| `src/game/vendor.h:46-48` | `kSellMult[3]` = 0.85/0.92/0.72 | прайс-множители по тиру фракции | мал, но это прайс-лист в коде |
| `src/game/combat.h:122-144` | `get_cell_hazard` — switch по `kMatElectricGrate/kMatAcidPool/kMatFireCell` | урон и канал урона от материала | **все остальные** свойства материала идут из `materials.csv` через генератор (твёрдость, плотность, альбедо, эмиссия, радиус света). Урон — единственное, что автор пишет руками. Нужны колонки `hazard_dmg`, `hazard_channel` |
| `src/game/rpg.cpp:13-27` | 15 коэффициентов «за очко атрибута» | сила/ловкость/интеллект → урон, износ, разброс, пси, XP, награда | ни одного комментария на 15 строк; просится в `data/rpg.csv` |
| `src/game/mob_spawn.cpp:108-113` | `kAnchors[6]` | этаж → `FloorBit` | зеркало enum, не контент — LOW |
| `src/game/conversation.cpp:155-163` | `kConvOptions[6]` | пункты меню разговора | **НЕ** кандидат: несёт указатели на функции, в CSV не уедет без скриптового слоя. Отмечено, чтобы не переоткрывали |

---

## 5. Категория Д — ЗАШИТЫЙ-ЭТАЖ

Закон живёт не только в устных замечаниях: `floors.md:194-199` формулирует его сам —
*«A module touches exactly two things outside its folder, both data rows: one registration
call in `build_default_floor_catalog` and one generator row in `floor_gen.cpp`'s per-kind
dispatch table … never a branch»* (`floors.md:276`).

| # | file:line | ветка | почему нарушение | замена |
|---|---|---|---|---|
| Д1 | `src/game/floor_gen.cpp:171` | `if (spec.kind == FloorKind::Blame) return 0;` в `floor_doorways()` | общий код ветвится по ВИДУ этажа — в том самом файле, который двадцатью строками ниже (:183-231) реализует правильный приём трижды: `kGenerators[]`, `kRuleDeclarers[]`, `kRuleAppliers[]`, каждая со `static_assert(... == FloorKind::Count)` | четвёртая строка диспетчера `kDoorwayFns[FloorKind::Count]`, у Blame — функция, возвращающая 0 |
| Д2 | `src/app/main.cpp:1094` | `if (kind_for_floor(floorNumber) == FloorKind::Padic) count += seed_padic_props(...)` | общий код приложения ветвится по виду, чтобы позвать **приватную функцию модуля** (`floors/padic/padic_module.cpp`). Это **третья** точка касания модуля извне папки при разрешённых двух, и в отличие от них — сырая ветка, а не строка данных | строка `ExtraPropsFunc` в per-kind таблице; сигнатуру придётся расширить `Registry&`/`EventBus&` — вероятно, поэтому и оставили веткой |
| Д3 | `src/game/mob_spawn.cpp:213-221` | `theme_for_kind()` — `switch (kind)` с `default: FloorTheme::Ministry` | нет `static_assert` на `FloorKind::Count`, единственный такой switch в дереве. **Дефект уже сработал**: `Padic` и `Blame` добавлены позже и молча проваливаются в `Ministry`. `mob_spawn.h:86-89` сам это признаёт («right today and silently wrong the first time a fifth FloorKind is themed») — пятый и шестой уже существуют | `constexpr FloorTheme kThemeForKind[FloorKind::Count]` + `static_assert`, как `mob_table.cpp:917` уже делает для `kThemeMult[FloorTheme::Count]` |
| Д4 | `src/game/container.cpp:41-54` | `pick_kind()` — `switch (fk)`, `Industrial/Derelict → kIndustrial`, `default → kResidential` | тот же класс, тоже без `static_assert`. `Padic` (враждебность 1.00) и `Blame` (0.80) по `floor_spec.cpp` попадают в жилую таблицу без оружейных ящиков | `constexpr KindWeightRow kContainerRow[FloorKind::Count]` + `static_assert` |
| Д5 | `src/game/combat.cpp:1668-1674` | списки id материалов `isSteel`/`isConcrete` | не этаж, но тот же класс «перечисление вместо свойства»; уже расходится с колонкой `family` в `materials.csv` (см. §3.2) | колонка `acoustic` в CSV |

**Проверено и ЗАКОННО:**
* `src/game/floors/padic/padic_gen.cpp:527` `if (number == 0)` — **внутри папки модуля**.
  `floors.md:156` прямо разрешает модулю любую ветвящуюся логику у себя. Метка экстракции
  на нулевом этаже — дело padic и ничьё больше.
* `src/game/floor_spec.cpp:59-74` `floor_spec_for` — это и есть каноническая функция
  «номер → вид», а не потребитель уже разрешённого вида. Мягкое замечание: она сознательно
  продублирована строками данных в `floor_catalog.cpp` и синхронизируется **тестом**
  (`suite_floorcatalog`), а не конструкцией — латентный DRY-риск, отдельный тикет.
* `src/app/main.cpp:778-813` `kDemoFloors` — таблица по номеру, но используется
  **исключительно** для `.claim()` через `FloorCatalog` (санкционированный механизм, тот же,
  которым регистрируются `padic`/`blame`), конфликт отвергается громко. Приложение здесь —
  свой «модуль».
* `item_table.cpp:3144-3153` `economy_band`, `floor_spec.cpp:81-120` `floor_danger` /
  `floor_mob_count` / `floor_mob_tier` — лестницы порогов по `|floor|`, одинаковые для всех
  номеров. `floor_spec.h:62-71` называет это законной «другой половиной» V-образной схемы:
  глобальная таблица + множитель от глубины — ровно то, чего закон и просит.
* `rpg.cpp:78-118` `monster_base_xp` — switch по 36 из 69 `MobKind`. В `mobs.csv` **нет**
  колонки `xp`, обходить нечего; комментарий защищает выбор («таблица была бы 33 копии
  дефолта»). Стилистически спорно, нарушением не считаю.
* `door.cpp`, `extraction.cpp:23`, `container.cpp:332`, `antourage.cpp:85,777` — сравнения
  с `kCellAir`/`kMatExtract`: движковые сентинелы (пустота; неразрушаемая площадка банка),
  от вида этажа не зависят.
* `src/world/nav.cpp`, `nav_async.cpp` — ни одной ссылки на `CellType`. Чисто.
* `ItemId`/`MobId` спецкейсов вне генерируемых таблиц не найдено. Эта граница чистая.

---

## 6. Категория Е — ЗОЛОТЫЕ ЧИСЛА

### 6.1 Пины в `CMakeLists.txt`

| line | число | что пинит | вердикт |
|---|---|---|---|
| 482 | `23391/23391` | все проверки `world_test` | ЗАКОННО, поддерживается руками. Число печатается тестом (`world_test.cpp:888`), но в CMake перепечатано |
| 543 | `146` | `audit_test: 146 checks, 0 failures` | ЗАКОННО. Комментарий прямо говорит «the count IS the gate»: закрытие дефекта обязано двигать число — трение намеренное |
| 1032 | `243576` | все проверки `game_test` | ЗАКОННО, но **самый дорогой пин в дереве**: несёт 3887 из 4036 CHECK-точек, любая из ~80 сюит двигает его. Рядом лежит ~30-строчный журнал каждой дельты |
| 1042 | `[0-9]+` | `e2e_test` | **ЗАКОННО и намеренно НЕ пинится** (:1034-1036). Образец здравого смысла |
| 1105 | `[0-9][0-9][0-9]` | `files_scanned=` | ЗАКОННО, пол а не равенство: `src/` под `GLOB_RECURSE` |
| 1121 | `[0-9][0-9]` | `entry_points=` | ЗАКОННО, пол |

Асимметрия (точный счёт там, где инвариант; пол или ничего там, где контент растёт) —
осознанная и задокументирована в самом файле. Здесь система работает.

### 6.2 Дубли и трение в тестах

| file:line | число | вердикт |
|---|---|---|
| `tests/suite_navcache.inl:621` и `:1258` | `namesRoundTripped == 540` | **ДВОЙНОЙ ПИН, подтверждён**. Одна и та же переменная `g_tally`, второй раз без независимой причины. Удалить :1258 |
| `src/game/loot_table.h:228` + `tests/suite_loottable.inl:131` | `kLootTableValueChecksum = 104447` | **ЗАКОННО и, вопреки заданию, пин ОДИН**: тест сравнивает с именованной константой. Побочное трение реально: любая правка `value` у любого лутового предмета требует вручную пересчитать константу в продакшн-коде |
| `tests/suite_craft.inl:162` и `:390` | `5590` (сумма материалов по 442 рецептам) | ДВОЙНОЙ ПИН + **третья, неисполняемая копия в шапке** (:18). :390 считает независимым путём (разбор), т.е. это почти честная перекрёстная проверка — сохранить, но сравнивать с `total` из блока 1, а не со вторым литералом |
| `tests/suite_craft.inl:167-184` | `896/456/1103/388/794/959/749/245` (8 осей) + гистограмма тиров (5) + гистограмма станков (5) | **ТРЕНИЕ ×18**. Классика «добавил строку в CSV — двигай 18 несвязанных чисел». Инварианта не защищают, только «совпадает с CSV» |
| `tests/suite_craft.inl:164-166` | `minRow 1`, `maxRow 180`, `maxAxis 70` | ТРЕНИЕ: ломаются от любой перебалансировки в ту сторону |
| `tests/suite_craft.inl:17-25` (шапка) | прозой `442 рецепта`, `5,590`, гистограммы | **УЖЕ УПЛЫЛА**: `kItemCount = 443` (`item_table.h:49`), а шапка говорит про 442. Не исполняется — не ловится |
| `tests/suite_saveload.inl:431-442` | `kSaveHeaderWire==64`, `kRpgWire==12`, `kCraftingWire==89`, `kRangedWire==16`, `kCombatSaveWire==21`, `kStatusWire==42`, `kSamosborWire==17`, `kFastTravelWire==32`, `kFactionWire==36` | **ДЕВЯТЬ ДВОЙНЫХ ПИНОВ**: у каждой уже есть идентичный `static_assert` в `save.h`/`craft.h`. Нулевая независимая проверка (обе стороны падают от одного изменения), двойная стоимость правки. `kCraftingWire` пинится **трижды** (+`suite_craft.inl:128`). Удалить, оставив только суммы `kSaveFixedWire==1284` (:441) и `save_bytes_for(0)==1388` (:444) — их в `save.h` нет |
| `tests/suite_navcache.inl:556`/`:1280`, `:995`/`:1268`, `:1084`/`:1269` | `1363279880`, `272655976`, `136341096` | три ДВОЙНЫХ ПИНА байтовых бюджетов |
| `tests/suite_navcache.inl:1274-1282` | `545390600`, `552023248` | **ЗАКОННО и образцово**: `static_assert`-ы, вычисленные из констант формата; комментарий прямо пишет, что печатаемая строка не может разойтись с кодом |
| `tests/suite_samosbor.inl:36-37` | `total == kSamosborWeightTotal`, затем `total == 121u` | :37 избыточна — :36 уже привязана к продакшн-константе. Удалить |
| `tests/suite_economy.inl:720` | `periods == 1157` | ТРЕНИЕ: несущий инвариант проверяется на следующей строке (:721, `> 30u*38u`); точное 1157 не добавляет защиты и ломается от любой перебалансировки ставки |
| `tests/suite_hunt.inl:358` | `420` жителей на этаж/сид | ТРЕНИЕ, **осознанное**: комментарий сам пишет «The scenario is pinned» |
| `tests/suite_packs.inl:116` | `194` моба | ТРЕНИЕ-ish: пин против потери населения при рефакторинге размещения, но двигается от любой перебалансировки плотности |
| `tests/suite_behaviours.inl:162-217` | `1160/1200/820/2750/3400/11500` | **ЗАКОННО и образцово**: разрешаются по ИМЕНИ через `mob_def(MobKind::X)`, не по индексу строки — иммунны к вставке строк в CSV. Контраст с §6.2 `suite_craft` |
| `src/game/mob_table.h:47` | `static_assert(kMobKindCount == 68)` | ЗАКОННО, один пин |
| прозой в 7+ местах (`suite_loottable.inl:109`, `suite_behaviours.inl:159/431/1009`, `suite_monster.inl:229/280`, `suite_noise.inl:180`, `suite_samosbor.inl:533/535`) | «69 kinds» | **УСТАРЕЛО**: истина 68. Не исполняется, но вводит в заблуждение рядом с живым `static_assert` |
| `src/game/save.h:171` | `kSaveVersion = 16u` | ЗАКОННО, один источник; тесты сравнивают с именем |

### 6.3 Поправка к памяти

`tools/check_wired.cmake:44-72` — в `GIGA_DEFERRED_ENTRY_POINTS` сегодня **9** самоисключений
(`cellular_step`, `fluid_step`, `loot_containers_step`, `diffusion_step`, `route_step`,
`feed_tick`, `samosbor_fog_tick`, `interaction_step`, `prop_interact_step`), а не 4, как
записано в заметке `marko-batch-2026-08-13`. Каждое несёт причину и владеющий документ.
Список сам по себе законен; заметку стоит поправить.

Единственный `giga-check: allow` во всём дереве — `tests/game_test.cpp:5411`.

---

## 7. ТОП-30 к исправлению

Ранжировано по «цена ошибки × дешевизна правки». Каждая строка — готовая задача.

| # | file:line | сейчас | обязано выводиться из | готовая замена | класс |
|---|---|---|---|---|---|
| 1 | `src/game/embody.cpp:62` | `Jump{6.5f, false}` | высоты апекса и модуля гравитации слоя; сейчас обнуляет запас `kImpactFreeSpeed=6.5` в `impact.h:33` — прыжок садится ровно на порог урона | `Jump{ std::sqrt(2.0f * length(w.gravity().global) * kJumpApexM), false }`, `kJumpApexM = 1.27f` | ХАРДКОД-ТЕЛА |
| 2 | `shaders/prop.frag:254` | `pc.torus.z > 0.0 ? … : clamp((1.0 - pc.fog.x/(128.0*0.30*2.0))/0.66,0,1)` | `pc.torus.z` заполняется всегда (`main.cpp:6973`); легальный 0 путается с «не задано» → все пропы живут с пульсом 0.25 | убрать тернарник: `float samosborPulse = pc.torus.z;` (как `cube.frag:642-643`, уже починенный) | ХАРДКОД-МИРА |
| 3 | `src/game/combat.cpp:540-542` | `const float h = aabb->half.y;` | `half.z` — рост; `half.y` всегда 0.4 → длина трупа зажата в 0.55 для любой статуры | `const float h = aabb->half.z;` | ХАРДКОД-ТЕЛА |
| 4 | `src/game/combat.cpp:545` | `tr->pos.y -= 0.45f;` | гравитация — фрейм (`gravity.h:113` = `-Z`), а не буква оси | `tr->pos = tr->pos - up * 0.45f;` (`up` уже выводится в этом файле для отбрасывания) | ХАРДКОД-ФИЗИКИ |
| 5 | `src/game/combat.cpp:382` | `2.5f` | `weapons_melee.csv` → `knockback`, мёртвая колонка (`weapon_table.h:34`) | `wp->knockbackMm * 0.001f * (kKnockbackRefMassKg / kmass)` | ДАННЫЕ-В-КОДЕ |
| 6 | `src/game/mob_spawn.cpp:213-221` | `switch(kind)` + `default: Ministry` | `Padic`/`Blame` уже молча тематизированы как Ministry | `constexpr FloorTheme kThemeForKind[FloorKind::Count]` + `static_assert` (образец: `mob_table.cpp:917`) | ЗАШИТЫЙ-ЭТАЖ |
| 7 | `src/game/floor_gen.cpp:171` | `if (spec.kind == FloorKind::Blame) return 0;` | тот же файл на :183-231 трижды делает это таблицей | 4-я строка диспетчера `kDoorwayFns[FloorKind::Count]` + `static_assert` | ЗАШИТЫЙ-ЭТАЖ |
| 8 | `src/game/room_zone.cpp:58` | `kBodySubLayers = 7` | `kDefaultHeightMm=1800` / `kVoxelSize` = 7.2 → нужно **8**; сейчас проходимость считается по телу 1.7 м | `ceil_i(kDefaultHeightMm * 0.001f / kVoxelSize)` | ХАРДКОД-ТЕЛА |
| 9 | `src/game/combat.h:422` + `combat.cpp:1477` | `kProjGravity = 6.0f` как абсолют | модуль поля слоя; в `GravityRegime::Zero` снаряд всё равно падает | `mag = projGLen * kProjGravityFraction * …`, `kProjGravityFraction = 6.0f/9.81f` | ХАРДКОД-ФИЗИКИ |
| 10 | `src/game/loot.h:91` | `kPickupReach = 1.8f` | `interactables.csv` строка `loot`, `reach_m = 2.0` (строка мёртвая) | `interact_def(InteractKind::Loot).reachM` в трёх точках (`loot.cpp:251,310,376`, `main.cpp:6012`) | ДАННЫЕ-В-КОДЕ |
| 11 | `src/render/gpu_light_grid.h:22-25` | `kGridDimX/Y/Z = 64`, `kGridCellMeters = 4.0f` | `64 × 4 = 256 = kWorldExtent` — вывод написан в комментарии, не в коде; вторая копия в `volumetric_fog.glsl:34-35` держится честным словом | `kGridDimX = kMacroDim/2`, `kGridCellMeters = kWorldExtent / kGridDimX`, + `static_assert(kGridDimX*kGridCellMeters == kWorldExtent)` | ХАРДКОД-МИРА |
| 12 | `src/game/combat.cpp:1668-1674` | списки id `isSteel` / `isConcrete` | `materials.csv`; уже расходится с колонкой `family` (`kMatPipeMetal` и `kMatFactoryWall` оба `ribbed`, но разведены) | колонка `acoustic=metal\|concrete\|soft` → `kMatAcoustic[]` | ДАННЫЕ-В-КОДЕ |
| 13 | `src/game/combat.h:122-144` | `get_cell_hazard` switch: 15/10/20 урона по трём материалам | все прочие свойства материала уже из `materials.csv` | колонки `hazard_dmg`, `hazard_channel` → `kMatHazard[kMatCount]` | ДАННЫЕ-В-КОДЕ |
| 14 | `src/app/main.cpp:1094` | `if (kind_for_floor(...) == FloorKind::Padic) seed_padic_props(...)` | `floors.md:194-199` — модуль касается двух строк данных, не ветки | строка `ExtraPropsFunc` в per-kind таблице | ЗАШИТЫЙ-ЭТАЖ |
| 15 | `src/game/floors/padic/padic_module.cpp:38-41` | `kCorr0=16 / kLatticeSpacing=32 / kLatticeDim=4` | `world/lattice.h:26-33`, где всё выведено + два `static_assert` | `#include "world/lattice.h"`, локальные удалить | ХАРДКОД-МИРА |
| 16 | `src/game/prop_system.h:37` + `prop_system.cpp:303` | `Interactable::reachM` пишется и **никогда не читается** | `find_nearest_interactable` берёт радиус параметром → колонка `props.csv:reach_mm` мёртвая, правка в ней молча ничего не делает | либо читать поле в `prop_system.cpp:539-548`, либо удалить поле и колонку | ДАННЫЕ-В-КОДЕ |
| 17 | `src/game/container.cpp:41-54` | `switch(fk)` + `default: kResidential` | `Padic` (враждебность 1.00) и `Blame` (0.80) попадают в жилую таблицу | `constexpr KindWeightRow kContainerRow[FloorKind::Count]` + `static_assert` | ЗАШИТЫЙ-ЭТАЖ |
| 18 | `src/sim/physics.cpp:199`, `src/game/save.cpp:1008`, `src/game/door.cpp:50` | три копии `{0.4,0.4,0.4}` при дефолте структуры `{0.4,0.4,0.9}` | `components.h:31` | одна `inline constexpr vec3 kDefaultBodyHalf` в `components.h`, три ссылки | ХАРДКОД-ТЕЛА |
| 19 | `tools/gen_material_table.py:263` | эмитит `kSubVoxelVolumeM3 = 0.25f*0.25f*0.25f` | `kVoxelSize³`; правка обязана быть в генераторе, не в `material_props.h:83` | эмитить `kVoxelSize*kVoxelSize*kVoxelSize` + `#include "world/types.h"` | ХАРДКОД-МИРА |
| 20 | `src/game/population.cpp:125-126` | `kLootValueCap[band]/8 + 15`, кэп 5000 | `economy.csv` → `cash_cap` (250…5 000 000), колонка без читателей | `bank_terms(band).cashCap` | ДАННЫЕ-В-КОДЕ |
| 21 | `src/game/contract.cpp:77,120` | полы награды `20` / `30` | `economy.csv` → `quest_rate` (35…1200), `quest_cap` — обе мёртвые; `economy.h:179-182` сам это признаёт | `bank_terms(economy_band(floorZ)).questRate` как масштаб, `questCap` как потолок | ДАННЫЕ-В-КОДЕ |
| 22 | `src/render/gpu_gas_pass.cpp:266` | `vkCmdDispatch(cmd, 8, 8, 128)` | комментарий на :264 выводит «128/16 × 128/16 × 128/1»; `kMacroCells` в этом файле уже используется | `vkCmdDispatch(cmd, kMacroDim/16, kMacroDim/16, kMacroDim)` | ХАРДКОД-МИРА |
| 23 | `src/game/combat.cpp:645` и `src/game/save.cpp:919` | два независимых `2.2f` | `interactables.csv` → `corpse.reach_m` | `interact_def(InteractKind::Corpse).reachM` в обоих | ДАННЫЕ-В-КОДЕ |
| 24 | `src/app/main.cpp:4203` | `3.5f` | `interactables.csv` → `electrical_shield.reach_m`; сосед `main.cpp:6433` уже делает правильно | `interact_def(InteractKind::ElectricalShield).reachM` | ДАННЫЕ-В-КОДЕ |
| 25 | `src/game/embody.cpp:55` | `AABB{vec3{0.4f, 0.4f, hh}}` | `hh` выведен, подошва нет → ребёнок с плечами взрослого; 0.4/`kVoxelSize` = 1.6, нецелое при нав-мере в субвокселях | `body_half_width(height_mm)` рядом с `body_half_height`; `0.222f*h` даёт 0.4 при 1.8 м | ХАРДКОД-ТЕЛА |
| 26 | `tests/suite_saveload.inl:431-442` | 9 `static_assert`, дублирующих `save.h`/`craft.h` | нулевая независимая проверка, двойная стоимость правки | удалить 9, оставить `kSaveFixedWire==1284` (:441) и `save_bytes_for(0)==1388` (:444) | ЗОЛОТОЕ-ЧИСЛО |
| 27 | `src/game/embody.h:43` | `kEmbodyCellSize = 2.0f` | `world/types.h:34 kCellSize` — она в `world`, не в `app`, обоснование «не тянуть app» неверно | удалить, `#include "world/types.h"` | ХАРДКОД-МИРА |
| 28 | `src/app/main.cpp:155` | `kLampRadius = 14.0f; // metres (7 macro cells)` | эталон жалобы владельца: вывод в комментарии, не в коде | `7.0f * kCellSize` | ХАРДКОД-МИРА |
| 29 | `src/game/rpg.cpp:13-27` | 15 подряд коэффициентов «за очко» без единого комментария | дизайнерский лист | `data/rpg.csv` + `tools/gen_rpg_table.py` (16-й генератор, шаблон уже отработан 15 раз) | ДАННЫЕ-В-КОДЕ |
| 30 | `tests/suite_navcache.inl:1258`, `tests/suite_samosbor.inl:37` | `namesRoundTripped == 540` (второй раз), `total == 121u` (второй раз) | обе величины уже проверены строкой выше/раньше | удалить обе строки | ЗОЛОТОЕ-ЧИСЛО |

Дешёвые довески вне тридцатки (одна строка каждый): `voxel_mirror.h:101` →
`kSubMaskWords*sizeof(uint64_t)`; `ai.h:486` → добавить `static_assert(kMacroDim == 128)`;
`population.cpp:25` → `kMacroDim / kRoomStride`; `combat.h:834` → `1.5f*kVoxelSize`;
`gravity.h:113` + `blame_gen.cpp:662` + `padic_gen.cpp:577` → одна `kGravityEarth`;
`gpu_light_grid.cpp:68` → печатать `kGridDimX` вместо «32x16x32»; свести «69 kinds» к 68
в 7+ комментариях тестов.

---

## 8. Гейт. Список кончится, гейт останется

### 8.1 Почему гейт вообще возможен на этом дереве

Инфраструктура уже стоит и зрелая. `tools/check_source_rules.cmake` — 569 строк, зарегистрирован
как ctest `source_rules`, работает `cmake -P` без компилятора (то есть одинаково на macOS и
Windows), уже умеет:
* читать файлы построчно с обходом трёх ловушек CMake (UTF-8, `;`, `[]`) — :75-90;
* эмулировать границы слов, чтобы `try_emplace` не срабатывал на `try` — :67-69;
* иметь греппабельный побег `giga-check: allow` — :27-32;
* печатать `files_scanned=`, что пинится полом в `CMakeLists.txt:1105`;
* **Rule 7** (:415-452) уже реализует ровно тот приём, который нужен: пересчитывает строки
  CSV и сверяет с числом, которое эмитил генератор. Обе стороны выведены, человек не
  перепечатывает ничего.

Добавить правило — это дописать блок в существующий файл, а не построить систему.

### 8.2 Что НЕ внедряемо (и почему честнее это сказать)

* **«Запрет числовых литералов вне таблиц в каталоге»** — нерабочее. В `src/game` 271 живое
  нарушение; запрет сразу красный, а красный гейт снимают. Плюс легальных литералов в коде
  масса (`0`, `1`, `-1`, индексы, битовые сдвиги, `1e-4f` допуски) — доля ложных
  срабатываний уйдёт за 50 %.
* **«`constexpr k*` обязана содержать ссылку на другую величину»** — тоже нерабочее в
  чистом виде, и `impact.h:29` это доказывает: `kImpactFreeSpeed = 6.5f` — голый литерал,
  и он же **эталон** этого репозитория, потому что вывод развёрнут в комментарии выше.
  Правило, отвергающее собственный эталон, будет отвергнуто само.

### 8.3 Что внедряемо: правило «голый литерал обязан нести вывод», с храповиком

**Формулировка.** Объявление `constexpr <скалярный тип> k<Имя> = <числовой литерал>;`
обязано удовлетворять хотя бы одному:
1. инициализатор — выражение, содержащее идентификатор (другую константу или `constexpr`-функцию); **или**
2. рядом есть вывод: комментарий над объявлением или хвостовой, суммарно ≥ 40 значащих
   символов; **или**
3. на строке стоит `giga-check: allow` с причиной.

Это ровно то, что репозиторий уже считает правильным: пункт 1 — `tick.h`, `lattice.h`,
`physics.cpp:130`; пункт 2 — `impact.h`, `combat.h:435-447`.

**Замерено сегодня на этом дереве, а не оценено:**

| | |
|---|---|
| всего скалярных `constexpr k*` | 805 |
| прошли по пункту 1 (выражение) | 217 |
| прошли по пункту 2 (комментарий ≥ 40 симв.) | 268 |
| **красных на старте** | **320** |
| из них требуют побега (id из CSV, sentinel `0xFFFFFFFF`, ёмкость буфера) | ~49 |
| **красных по существу** | **271** |

320 сразу — гейт так не включают. Поэтому:

**Храповик вместо запрета.** Правило печатает `underived_constants=<N>` и падает только
если `N > <пин>`. Пин кладётся в `CMakeLists.txt` рядом с существующими — это уже
привычный на дереве приём (`files_scanned=`, `entry_points=`), просто с противоположным
знаком: не пол, а **потолок, который разрешено только опускать**.

Цена этого решения ровно та, что нужна: сегодня в дерево нельзя внести новую голую
константу, не сняв другую, — а §0 показывает, что за прошлый период их внесли 84.

**Ложные срабатывания.** Три класса, и все три закрываются механически, а не побегами:
1. **id, эмитированные генераторами** (`kMatSoil = 2`, `kItemCount = 443`, `kMeleeCount = 22`,
   `kMobKindCount`) — исключить по списку **файлов**, помеченных `GENERATED`/`DO NOT EDIT`
   (их 21, найдены грепом; `check_source_rules.cmake` уже умеет фильтровать по путям).
   Убирает ~26 красных.
2. **Сентинелы и маски** — литерал в шестнадцатеричной форме, либо имя матчит
   `^k(Invalid|No|Any|None|Max|Min)[A-Z]`. Убирает ~23.
3. **Ёмкости пулов и буферов** (`kMaxParticles = 32768`, `kMaxBinds = 64`, `kNameLen = 24`) —
   спорный класс. Я бы **не** исключал: `kStagingLights = 16384` (`gpu_light_grid.h:36`)
   как раз показывает, зачем — там 16384 обосновано измерением («блейм несёт 9500 лампочек»,
   `GIGA_LIGHT_DBG` 2026-08-17), и такое обоснование обязано быть написано. Класс уже
   проходит по пункту 2, если автор написал, откуда взял.

После вычета 1 и 2 остаётся **271 честно красная константа** — и это ровно тот список, что
питает §7. Ложные срабатывания среди них я оцениваю ниже 5 %: выборка из 45 первых строк
(`/tmp/markoaudit2/_naked.txt`) даёт 2 спорных (`kHalfPi`, `kHashGolden` — математические
константы; закрываются побегом с причиной в одну строку).

**Стоимость.** ~60 строк CMake в существующем файле, один пин в `CMakeLists.txt`, ноль
изменений в исходниках для включения. Прогон — тот же `cmake -P`, без компилятора,
одинаково на обоих хостах.

### 8.4 Второй гейт, дешевле и точнее первого: «шейдер против C++»

Прицельно закрывает §1б, где расхождение уже стоило одного живого бага (`prop.frag:254`)
и держит шесть копий макро-сетки.

Правило: в `shaders/*.{vert,frag,comp,glsl}` литералы `128`, `256`, `64`, `2.0`, `0.25`, `8`
запрещены **вне** файла `shaders/world_grid.glsl`. Общий include уже штатный приём в этой
папке (`flicker.glsl`, `material_surface.glsl`, `shadow_march.glsl`, `volumetric_fog.glsl`),
так что правка — механическая, а не архитектурная.

Ложные срабатывания низкие: в GLSL эти конкретные числа почти всегда и есть мировая сетка.
Побег — тот же `giga-check: allow`. Отдельной строкой добавить проверку пары
`kGridDim`/`kGridCellMeters`: значения в `gpu_light_grid.h:22-25` и `volumetric_fog.glsl:34-35`
обязаны совпасть текстуально — сегодня их держит только фраза «Числа обязаны совпадать» в
комментарии.

### 8.5 Третий, почти бесплатный: `static_assert` на каждой таблице по enum

Массив, индексируемый `FloorKind`/`FloorTheme`/`MobTier`/`ItemCategory`, обязан нести
`static_assert(std::size(arr) == <Enum>::Count)`. Дерево уже делает это в `floor_gen.cpp:183-231`,
`floor_spec.cpp`, `role.h:82`, `mob_table.cpp:917` — то есть правило описывает
**существующую** практику, а не вводит новую. Оба нарушителя (§5 Д3, Д4) — ровно те два
места, где `static_assert` забыли, и оба уже дали молчаливый дефект (`Padic`/`Blame` →
`Ministry`, жилые ящики на враждебном этаже).

Реализация: грепом искать `switch (` по типу, имя которого кончается на `Kind`/`Theme`/`Tier`,
и требовать в теле либо покрытия всех `case` без `default`, либо перевода в таблицу. Здесь
доля ложных срабатываний выше (~20 %, законные `default` для отладочных строк), поэтому
правило стоит включать как предупреждение с храповиком, а не как красный.

### 8.6 Порядок внедрения

1. §8.4 (шейдеры) — самый дешёвый, закрывает живой баг и шесть копий, ложных срабатываний почти нет.
2. §8.3 (храповик по константам) — главный, но требует пина и двух списков исключений.
3. §8.5 (таблицы по enum) — предупреждением, после того как Д3/Д4 закрыты.

---

## Приложение: пересечения с уже заведёнными проблемами

Чтобы не заводить дубликаты:
* `problems.md:84-88` — «локальные копии функций и констант ядра» — накрывает А4, А8, §2.2.
* `problems.md:133-135` — хардкод спавна лампочек в `padic_module.cpp` (id пропа 28, цвет) —
  соседний класс с Д2.
* `problems.md:180` — «все wrap-константы только через `kWorldExtent`» — урок из уже
  закрытого бага полупериода; §1б показывает, что в `prop.frag` он не применён.
* `problems.md:241` «Проблема 9: остатки Z-хардкода» — **ЖИВА**, и §2.4
  (`combat.cpp:545 tr->pos.y -= 0.45f`) — её новый экземпляр.
* `problems.md:1456,1460` (§35) — мёртвые колонки `use_b` и reach в `interactables.csv` —
  накрывает Г2 и Г12; §4.2 расширяет список до 6 CSV.
