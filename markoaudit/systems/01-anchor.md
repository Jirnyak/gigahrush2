# Аудит: СИСТЕМА КРЕПЛЕНИЯ К СКЕЛЕТУ ВОКСЕЛЕЙ

Репозиторий `/Users/jirnyak/Mirror/gigahrush2`, ветка `torus`, дата 2026-08-17.
Все file:line проверены грепом сегодня. Комментарии не принимались за доказательство.

---

## 0. Главное в шести строках

1. Крепления в игре **два независимых**, с несовместимой кодировкой грани и несовместимой пробой живости: ECS-`SubVoxelAnchor` (пропы/контейнеры) и антуражный `face`-байт (трубы/провода/тенты).
2. Проба у пропов — **один бит из 512**, у антуража — **колонка 2×2 по любой оси**. Канон S2 требует одного правила; сейчас их два, и точнее — антуражное.
3. `SubVoxelAnchor::face` **не читает никто** — write-only байт (5 мест записи, 0 мест чтения).
4. Контейнеры **уничтожаются каждый вход на этаж**: `refresh_floor_containers` идёт раньше `refresh_floor_props`, а `clear_layer_props` сносит всё с `SubVoxelAnchor` — все 4 площадки в `main.cpp` в этом порядке.
5. Контейнер вдобавок **привязан к воздуху с рождения** (`floor_standable` гарантирует `cell == kCellAir`, якорь ставится в ту же клетку), проверка `spawn_prop` обойдена прямым `emplace`.
6. Найдены живые Y-up рудименты: труп кладётся «на пол» по оси **Y** (`combat.cpp:539-544`), поиск интерактивного не оборачивает тор по **Y** (`prop_system.cpp:562`).

---

## 1. Полная перепись механизмов крепления

| # | Механизм | Объявление / запись | Разрешение | Кодировка грани | Проба живости | Изотропен |
|---|---|---|---|---|---|---|
| 1 | `SubVoxelAnchor` (ECS-проп) | `src/game/prop_system.h:25-29`; запись `prop_system.cpp:255-257` | клетка (`int cx,cy,cz`) + **один** субвоксель (`subX/subY/subZ` 0..7) | `std::uint8_t face`, комментарий обещает `0=Floor,1=WallNorth,2=Ceiling…`; **никто не читает** | `anchor_validate_step` `prop_system.cpp:208` → `grid().solid(cx,cy,cz,subX,subY,subZ)` = **один бит** | нет (см. §3) |
| 2 | Настенные устройства (Terminal/ElectricalShield) | `prop_system.cpp:402-409` | клетка соседней стены + субвоксель `(7\|0\|4, 7\|0\|4, 4)` | `face = 1` — «стена», одно значение на **все 4** боковые | как #1 | **нет**: только `±X/±Y`, потолок/пол недоступны, `subZ` жёстко 4 |
| 3 | Потолочные лампы | `prop_system.cpp:468-475` | клетка потолка + субвоксель `(4,4,0)` | `face = 2` — «потолок» | как #1 | **нет**: только `z+1` (`:439`, `:457`, `:471`) |
| 4 | Мебель комнат | `src/game/room_zone.cpp:505-513` | клетка опоры + `(kSubDim/2, kSubDim/2, floor.subZ)` — subZ **выведен сканом** | `face = 0` — «пол» | как #1 | **нет**: `room_floor_under` `room_zone.cpp:441-473` сканирует только Z (`words[sz]`, `z-1`) |
| 5 | Лампы падика | `src/game/floors/padic/padic_module.cpp:44-77` | клетка + `(4,4,0)` либо `(2,4,6)` | `face = 2` | как #1 | **нет**: `ceilZ = airZ + 1` (`:49`) |
| 6 | **Контейнеры (ящики)** | `src/game/container.cpp:357` `SubVoxelAnchor{cx,cy,cz,4,4,0,0}` | клетка **воздуха** + `(4,4,0)` | `face = 0` | **нулевая при рождении** — клетка гарантированно воздух (`floor_gen.cpp:104`); при попадании в `dirtyCells` → мгновенный detach | нет; `floor_cell` изотропен, а якорь — нет |
| 7 | Антураж: жёсткие инстансы (трубы, хомуты, фитинги) | `src/game/antourage/antourage.h:125-141`; запись `antourage.cpp:247-249, 458-460` | **две** клетки-якоря (`ax0..az1`, `uint8`), субвоксель не хранится | `face = axis*2 + (dir<0)` — честные **6** значений, `antourage.h:106-112` | `antourage_alive` `antourage.cpp:783-789` → `anchor_gone` `:775-780` → `face_layer(axis, dir, centreOnly=true)` = **колонка 2×2 по 8 слоям вдоль оси грани** | **да** |
| 8 | Антураж: провода `WireChain` | `antourage.h:47-77`; запись `antourage.cpp:582-611` | две клетки-якоря + `pinMask` по 8 точкам | тот же 6-значный `face` (`:609`) | `wire_live_pins` `antourage.cpp:790-796` — по каждому концу отдельно; `antourage_alive` = «хоть один пин жив» | **да** |
| 9 | Антураж: тенты `ClothSheet` | `antourage.h:88-101`; запись `antourage.cpp:648-680` | две клетки-якоря + 32-битный `pinMask` | тот же 6-значный `face` (`:679`) | `cloth_live_pins` `antourage.cpp:798-806`, половины верхнего ряда | **да** |
| 10 | Двери | `src/game/door.h:122-133`; `door_build` `door.cpp:84+` | **клетка**, `cx,cy,cz` (`uint8`) + `h` клеток вверх | `axis : 2` — **только 0 или 1** (`door.h:126`) | никакой; дверь **пишет воксели** (`fill_cell`/`clear_cell` `door.cpp:59,67`), а не крепится | **нет**: полотно растёт по `cz + z` (`door.cpp:56,64`), косяки только в X/Y (`door.cpp:106-107`) |
| 11 | Трупы | `src/game/combat.cpp:640` `emplace<Corpse>` | ничего — только `Transform` | нет | нет; труп висит там, где умер, карв под ним ничего не делает | **нет** — «положить на пол» сделано по оси **Y** (`combat.cpp:539-544`) |
| 12 | Лут на полу (`Pickup`) | `src/game/loot.cpp:238, 301` | ничего — `Transform` + `GravityAffected` | нет | нет (падает физикой, не крепится) | да (физика изотропна) |
| 13 | Пятна (`stain`) | `src/world/stain.h:44-57` | **глобальный субвоксель** 1024³ (`stain_paint(gx,gy,gz)`) | нет (объёмное поле, не грань) | нет пробы: пятно живёт в разреженной странице клетки, карв её не чистит | да |
| 14 | Свет пропа `PropLight` | `prop_system.h:73-80`; запись `prop_system.cpp:306-314` | наследует якорь своего пропа | — | косвенно: умрёт вместе с сущностью пропа | наследует анизотропию #2/#3/#5 |

Итого: **девять** разных способов сказать «эта вещь висит здесь», из них **две** реальные кодировки грани и **две** реальные пробы живости.

---

## 2. Проба живости — что происходит при карве

### 2.1 Пропы: один бит из 512
`prop_system.cpp:181-236`. Условие детача — ровно одна строка:

```cpp
// prop_system.cpp:208
if (!world.grid().solid(cx, cy, cz, anchor.subX, anchor.subY, anchor.subZ)) {
```

`MacroGrid::solid` (`macro_grid.h:144-146`) → `mask(...).test(sub_bit(sx,sy,sz))` — **один бит**. Два симметричных дефекта:

* **Ложный отвал.** Лампа с якорем `(4,4,0)` в потолочной клетке. Выстрел выел субвоксель `(4,4,0)`, слои `1..7` над ним целы. Лампа падает, хотя над ней 1.75 м бетона — физически она должна повиснуть на 0.25 м выше. Это ровно тот случай, который у антуража закрыт `face_layer`.
* **Ложное выживание.** Тот же якорь; карв снёс слои `1..7`, оставил `(4,4,0)`. Лампа висит на плёнке в 0.25 м, у которой сверху пустота. `solid()` говорит «жива».

Ни одного колоночного сканирования на стороне пропов нет. Единственный вызов колонки — `prop_system.cpp:457` `lowest_layer_centre()`, и он только для **позиции** при спавне, не для живости.

### 2.2 Антураж: колонка по грани, по любой оси
`antourage.cpp:775-780`:

```cpp
static bool anchor_gone(const MacroGrid& g, int x, int y, int z, std::uint8_t face) {
    if (g.cell(x, y, z) == kCellAir) return true;
    return g.mask(x, y, z).face_layer(antourage_face_axis(face),
                                      antourage_face_dir(face), true) < 0;
}
```

`SubMask::face_layer` (`macro_grid.h:67-76`) сканирует **8 слоёв перпендикулярно оси грани**, с нужной стороны, по центральной колонке 2×2 (`kCentreZ` `macro_grid.h:33-35` для Z, `tangent_layer_solid` `macro_grid.h:80-88` для X/Y). Это тот же вопрос, который задавал спавн (`can_hug` `antourage.cpp:207-214`, `pipe_point` `:225`), — поэтому проба и посадка не могут разойтись.

`pair_died` (`antourage.cpp:843-852`) добавляет второе условие — «умер именно на этой операции», иначе кусок сыпал бы обломки при каждом соседнем карве. У пропов такой защиты нет вообще, но она им и не нужна: детач одноразовый (`SubVoxelAnchor` удаляется на `:107-108`).

### 2.3 Кто не проверяет вообще

| Объект | Что происходит при карве под ним |
|---|---|
| Дверь (`door.h:122`) | ничего. Полотно — это воксели, карв косяка не ломает дверь; `hp` уменьшают только мобы (`door_step`) |
| Труп (`combat.cpp:640`) | ничего. Пол вырезали — труп висит в воздухе |
| `Pickup` (`loot.cpp:238`) | падает физикой (`GravityAffected` `:230`) — единственный, кто ведёт себя правильно **без** крепления |
| Пятно (`stain.h:44`) | ничего. Разреженная страница переживает карв, окрашенные субвоксели остаются на воздухе |
| Контейнер (`container.cpp:357`) | якорь на воздухе с рождения → отваливается при первом же попадании клетки в `dirtyCells`; до того — не падает, `SimpleFall` не срабатывает без `anchor_validate_step` |

### 2.4 Утечка отсоединённых пропов
`detach_single_prop` снимает `SubVoxelAnchor` (`prop_system.cpp:107-108`) и вешает `DynamicBodyTag`. `clear_layer_props` (`:331`) ищет **только** `SubVoxelAnchor` → отвалившийся проп **никогда не удаляется** при переиспользовании слота `LayerId`. Единственные потребители `DynamicBodyTag` — `body_pass.cpp:283`, `physics.cpp:292`, `console.cpp:603`; чистильщика нет. **БАГ + УТЕЧКА**: мусор с этажа 5 продолжает рендериться и падать на этаже 12.

---

## 3. Изотропия крепления

Канон S1: x/y/z равноправны. Проверка «может ли механизм повесить вещь на любую из 6 граней»:

| Механизм | 6 граней? | Где зашита ось | Классификация |
|---|---|---|---|
| Антураж (все три примитива) | **Да**. `faceOrder` `antourage.cpp:271-274` строится из `f.axis/f.tanA/f.tanB` | Единственное сознательное исключение — пол выкинут из 6 в 5 (`kFaces = 5`, `antourage.cpp:270`, обоснование в комментарии `:266-269`) | приемлемо, задокументировано и выведено из фрейма |
| Настенные устройства | **Нет, 4 из 6** | `prop_system.cpp:358-362`: `solidWest/East/North/South` — только `x±1`, `y±1`. `z±1` не рассматривается | **АНИЗОТРОПИЯ** |
| Потолочные лампы | **Нет, 1 из 6** | `prop_system.cpp:439` `grid.cell(x,y,z+1)`; `:457` `mask(x,y,z+1).lowest_layer_centre()` (Z-only хелпер); `:471` `wrap_macro(z+1)` | **АНИЗОТРОПИЯ** |
| Мебель комнат | **Нет, 1 из 6** | `room_zone.cpp:445-473` — цикл по `words[sz]` (Z-слои) и `wrap_macro(z-1)`; `:485` `floor_ground_coord()` | **АНИЗОТРОПИЯ** |
| Лампы падика | **Нет, 1 из 6** | `padic_module.cpp:49` `ceilZ = airZ + 1` | **АНИЗОТРОПИЯ** |
| Контейнеры | Клетку выбирают изотропно (`floor_cell` `floor_gen.cpp:110-125`, `regime_down` `container.cpp:331`), но **якорь** ставят `subZ = 0` (`container.cpp:357`) | смешанная: половина функции изотропна, вторая половина нет | **АНИЗОТРОПИЯ (частичная)** |
| Двери | **Нет, 2 из 6** | `door.h:126` `axis : 2` (0 или 1); полотно растёт `cz + z` (`door.cpp:56,64`); `body_in_leaf` `door.cpp:31-40` считает высоту по Z | **АНИЗОТРОПИЯ** |
| Трупы | **Нет, и ось перепутана** | `combat.cpp:539-544`: `half.y = 0.18` («сплющить»), `half.z = max(h*0.75, 0.55)` («растянуть по полу»), `pos.y -= 0.45` («положить на пол»). Верх мира — **Z** (`regime_down(NegZ) = {0,0,-1}` `gravity.h:39`; этажи стоят по Z). Труп сплющивается по горизонтали и **вытягивается вверх**, а «опускают» его вбок по Y | **БАГ + АНИЗОТРОПИЯ** (класс «axis-letter forces» из аудита 2026-08-06) |

Дополнительно: `find_nearest_interactable` `prop_system.cpp:561-563` оборачивает тор по X и Z, но **не по Y**:
```cpp
const float dx = wrap_delta_f(ppos.x, tr.pos.x, kWorldExtent);
const float dy = ppos.y - tr.pos.y;              // <- шва по Y нет
const float dz = wrap_delta_f(ppos.z, tr.pos.z, kWorldExtent);
```
Мир — тор по всем трём (`macro_grid.h:127-140` оборачивает все три). **БАГ + АНИЗОТРОПИЯ**: интерактивный объект через шов по Y не находится, зато находится «дальний» на 250 м.

---

## 4. Категорийная ошибка: компонент подменяет ВИД объекта

### 4.1 `SubVoxelAnchor` == «статический проп» — и контейнеры дохнут

```cpp
// prop_system.cpp:328-337
// SubVoxelAnchor marks every static prop (terminals, shields, padic bulbs).
auto view = reg.view<const SubVoxelAnchor, const Transform>();
for (auto e : view)
    if (view.get<const Transform>(e).layer == layer) old_.push_back(e);
for (Entity e : old_) reg.destroy(e);
```

Контейнер получает `SubVoxelAnchor` на `container.cpp:357`. Порядок вызовов в `main.cpp` — на **всех четырёх** площадках контейнеры идут **до** пропов:

| Площадка | контейнеры | пропы |
|---|---|---|
| старт игры | `main.cpp:1967` | `main.cpp:1968` |
| смена этажа (лифт) | `main.cpp:2602` | `main.cpp:2603` |
| загрузка сейва | `main.cpp:4795` | `main.cpp:4808` |
| fast travel | `main.cpp:7122` | `main.cpp:7124` |

Следствие: `refresh_floor_props` → `clear_layer_props(reg, layer)` (`main.cpp:1072`) уничтожает **каждый** ящик этажа сразу после спавна. Причём на площадке 4795 между ними успевает отработать `apply_container_records` (`main.cpp:4798-4802`), то есть восстановленное из сейва состояние ящиков стирается тем же вызовом. **КАТЕГОРИЙНАЯ-ОШИБКА + БАГ, живой на всех путях входа на этаж.**

Правильный признак «это статический проп» лежит рядом и не используется: `StaticPropTag` (`ecs/components.h:150-153`), который `spawn_prop` вешает на `prop_system.cpp:263`, а контейнер — нет.

### 4.2 То же заболевание в других местах

| Место | Компонент | Какой ВИД он подменяет | Классификация |
|---|---|---|---|
| `prop_system.cpp:331` | `SubVoxelAnchor` | «статический проп этажа» | КАТЕГОРИЙНАЯ-ОШИБКА (см. выше) |
| `combat.cpp:500-501` | `RpgStats` | «этот убийца достоин XP» — комментарий `:499` прямо пишет «the component IS the licence» | КАТЕГОРИЙНАЯ-ОШИБКА (осознанная, но именно она) |
| `container.cpp:388` / `main.cpp:1030` | `Container` | «это ящик этажа» — сносит и ящики, поставленные не спавнером | КАТЕГОРИЙНАЯ-ОШИБКА (потенциальная) |
| `prop_system.cpp:516` | `StaticPropTag` | «рисовать в PropPass» | корректно — тег и есть фильтр |
| `combat.cpp:643-645` | `Interactable{Kind::Corpse}` | труп; при этом сам `Corpse` компонент уже есть на `:640` | ДУБЛЬ признака |
| `prop_system.cpp:147, 195` | `SubVoxelAnchor + PropFallMode` | «падающая штука» — контейнер имеет оба (`container.cpp:357-358`) и попадает в оба прохода | КАТЕГОРИЙНАЯ-ОШИБКА |

Общий корень: **в кодовой базе нет ни одного явного тега «род объекта»**, вместо него используется наличие структурного компонента. Компонент отвечает на вопрос «как это устроено», а спрашивают у него «что это такое».

---

## 5. Хардкод в путях крепления

| file:line | Число | Из чего ОБЯЗАНО выводиться |
|---|---|---|
| `prop_system.cpp:406` | `wxd<0 ? 7 : wxd>0 ? 0 : 4` | `kSubDim-1` / `0` / `kSubDim/2` (`types.h:23`) |
| `prop_system.cpp:407` | то же по Y | `kSubDim-1` / `0` / `kSubDim/2` |
| `prop_system.cpp:408` | `anchor.subZ = 4` | `kSubDim/2` — центр клетки, поскольку `wz = (z+0.5)*kCell` (`:398`) |
| `prop_system.cpp:409` | `face = 1` | 6-значный `face_pack(axis, dir)` от `wxd/wyd`, которые тут же посчитаны на `:386-389` |
| `prop_system.cpp:393` | `slide = 1.0f - (0.5f*thick + 0.02f)` | `kCellSize*0.5f - (0.5f*thick + зазор)`; `1.0f` — это полклетки, написанное числом. Зазор `0.02` — не выведен ни из чего |
| `prop_system.cpp:460` | `kCell / 8.0f` | `kVoxelSize` (`types.h:35`), уже существует |
| `prop_system.cpp:466` | `wz = faceM - 0.14f` | полвысоты плафона: `d.sizeZMm * 0.0005f` — та самая формула уже применена рядом для `dropM` (`:311`) |
| `prop_system.cpp:472-474` | `subX=4, subY=4, subZ=0` | `kSubDim/2`, `kSubDim/2`, и **не 0**, а `faceSz` — результат `lowest_layer_centre()`, посчитанный строкой выше (`:457`) и выброшенный |
| `prop_system.cpp:475` | `face = 2` | `face_pack(f.axis, -f.upSign)` |
| `prop_system.cpp:130` | `AABB{0.2f, 0.2f, 0.2f}` | `PropMesh::scale * 0.5f` — авторские метры из props.csv, уже лежат на сущности (`:296-299`) |
| `prop_system.cpp:116` | `AngularVelocity{{impulse.z, impulse.x, 2.0f}}` | буквы осей + магическая `2.0`; должно быть кросс-произведение импульса на плечо |
| `prop_system.cpp:97-98` | `0.35f`, `vec3{0,0,0.35f}` | скорость обломка от массы (`Mass` `:294`) и энергии удара |
| `prop_system.cpp:124` | `-0.5f`, `vec3{0,0,-0.5f}` | то же |
| `prop_system.cpp:583` | `reach = 3.0f` | `Interactable::reachM` сущности (`:303`) либо `interact_def(kind).reachM` |
| `prop_system.cpp:258` | `Interactable{kind, 2.5f, true}` | `interact_def(kind).reachM` (`interact_table.h:34`) |
| `container.cpp:357` | `4, 4, 0` | `kSubDim/2`, `kSubDim/2`, и `subZ` от скана опоры; клетку тоже надо брать опорную, не воздушную |
| `container.cpp:351` | `cz*kCellSize + kContainerHalf.z` | опирается на `.z` буквой, а не на ось фрейма |
| `padic_module.cpp:57-59` | `4, 4, 0` | `kSubDim/2`, `kSubDim/2`, `face_layer` |
| `padic_module.cpp:68-70` | `2, 4, 6` | ни из чего не выводимо — подгонка под `stamp_stair` |
| `padic_module.cpp:63,74` | `+1.55f`, `+1.0f`, `+0.5f` | `1.0f` = `kCellSize*0.5`; `1.55` = высота подвеса, не выведена |
| `antourage.cpp:231` | `kPipeRadius + 0.04f` | зазор посадки, не выведен |
| `antourage.cpp:478` | `0.05f` порог «уступа» | `kVoxelSize * доля` |
| `antourage.cpp:494, 501` | `kCellSize + 0.1f`, `0.5f*kCellSize + 0.05f` | перекрытие сегментов — должно быть от `kPipeRadius` |
| `antourage.cpp:505-507` | `2.4 / 2.1 / 1.8 * kPipeRadius` | выведены от радиуса — **правильный образец** |
| `antourage.cpp:589-590, 659` | `lift = 0.12f`, `0.10f` | утопление точки крепления в материю; должно быть `kVoxelSize/2` |
| `antourage.cpp:596` | `sag = 0.15f * spanM` | слабина кабеля — авторское свойство, ему место в таблице |
| `combat.cpp:540-544` | `0.18f`, `0.75f`, `0.55f`, `0.45f` | габариты трупа от `AABB` живого тела **по правильной оси** |

Образцы, как надо, в том же коде: `room_zone.cpp:508-510` (`kSubDim/2` и `floor.subZ` из скана), `antourage.cpp:663-664` (`restX = kClothWidthM/(kClothW-1)`), `macro_grid.h:33-35` (`kCentreZ` собран из `kSubDim`).

---

## 6. Мёртвое внутри системы крепления

| Сущность | file:line | Статус |
|---|---|---|
| `check_projectile_prop_hits` | объявление `prop_system.h:174`, определение `prop_system.cpp:133-179` | **МЁРТВОЕ.** Ноль вызовов в `src/`, `apps/`, `tests/`. 47 строк, включая единственный оставшийся `vec3{0,0,1}` (`:173`) |
| `SubVoxelAnchor::face` | `prop_system.h:28` | **МЁРТВОЕ ПОЛЕ.** Записывается в 5 местах (`prop_system.cpp:409,475`; `room_zone.cpp:512`; `padic_module.cpp:59,70`; `container.cpp:357` через агрегат) и в 2 тестах (`suite_props_game.inl:274,731`). Читается **нигде** — единственное «чтение» это копия в `prop_system.cpp:257` |
| `Interactable::reachM` | `prop_system.h:37`, запись `prop_system.cpp:303` | **МЁРТВЫЕ ДАННЫЕ.** Колонка `reach_mm` из props.csv доезжает до компонента и не читается: все площадки берут `interact_def(kind).reachM` (`main.cpp:4178, 4085, 6422, 6433, 6453…`), одна — литерал `3.5f` (`main.cpp:4202`), `interaction_step` — литерал `3.0f` (`prop_system.cpp:583`) |
| `PendingDetachedProp::color/meshKind` | `prop_system.h:99-106` | почти мёртвые: `anchor_validate_step` заполняет (`:210-215`), а `detach_single_prop` их всё равно перерешивает по сущности (`:65-72`) — **ДУБЛЬ** |
| `antourage_face_pack` | `antourage.h:106` | **ЖИВОЙ** — вызывается на `antourage.cpp:272, 273, 274, 609, 679`. Утверждение из вводной («мёртв») **не подтвердилось** |
| `SubMask::face_layer` | `macro_grid.h:67` | **ЖИВОЙ, но только у антуража**: `antourage.cpp:112, 213, 225, 778` + `tests/suite_antourage.inl:484`. Пропы к нему не обращаются ни разу |
| `SubMask::lowest_layer` | `macro_grid.h:47` | **МЁРТВОЕ.** Единственный `lowest_layer_centre` (`:52`) вызывается один раз — `prop_system.cpp:457`; `lowest_layer()` без `_centre` не вызывается нигде |
| `interaction_step` / `prop_interact_step` | `prop_system.cpp:576-586, 636-639` | `prop_interact_step` — обёртка над обёрткой, ноль вызовов в `src/` вне файла. **МЁРТВОЕ** |

---

## 7. ПРЕДЛОЖЕНИЕ ОБОБЩЕНИЯ

### 7.1 Ответ на главный вопрос: клетка+грань, а не точный субвоксель

Хранить **клетку + грань + тангенциальный отпечаток**, а живость проверять **пробой колонки**. Антуражный вариант правильный, и вот почему — три причины, все проверяемые:

1. **Проба совпадает с посадкой.** Спавн уже спрашивает «где начинается материя вдоль этой оси» — `can_hug` (`antourage.cpp:213`) и `pipe_point` (`:225`) оба зовут `face_layer(ax, dr, true)`. Проба живости зовёт **ту же функцию с теми же аргументами** (`:778`). Разойтись физически невозможно. У пропов посадка идёт через `lowest_layer_centre` (`prop_system.cpp:457`), а живость — через `solid()` одного бита (`:208`): **две разные функции, два разных ответа**, и именно это порождает «висит на плёнке 0.25 м».
2. **Вещь пере-садится, а не падает.** Колонка отвечает «есть ли ещё материя», и если карв съел нижний слой, вещь остаётся висеть — на 0.25 м выше, что и есть физика. Точный субвоксель отвечает «жив ли ровно этот кубик», и любое касание роняет.
3. **Это уже проверено боем.** Комментарий `antourage.cpp:767-774` фиксирует конкретный баг владельца от 2026-08-05: выстрел опустошил колонку хомута, клетка осталась не-воздухом, клеточная проба сказала «жив», рендер перестал рисовать. Исправление — переход на `face_layer`. Второй раз проходить этот путь не нужно.

Компромисс: колонка 2×2 — это `centreOnly`. Для крупного пропа (терминал 0.8 м) нужна колонка шире. Поэтому в структуре предлагается **радиус отпечатка** в субвокселях, выводимый из авторского размера пропа, а не константа.

### 7.2 Структура

`src/world/anchor.h` — **новый файл, core-слой** (антуражу и игре одинаково доступен, `world/` уже зависимость обоих):

```cpp
namespace giga {

// ЕДИНАЯ кодировка грани на 6 значений: axis*2 + (dir<0).
// Ровно та, что сегодня живёт в antourage.h:106 — переезжает сюда, а
// antourage_face_pack становится алиасом на один релиз и удаляется.
inline constexpr std::uint8_t face_pack(int axis, int dir) {
    return static_cast<std::uint8_t>(axis * 2 + (dir < 0 ? 1 : 0));
}
inline constexpr int face_axis(std::uint8_t f) { return f >> 1; }
inline constexpr int face_dir (std::uint8_t f) { return (f & 1u) ? -1 : 1; }
static_assert(face_pack(face_axis(5), face_dir(5)) == 5);   // круговой пин

// ОДИН якорь на всю игру. 8 байт, POD.
struct WorldAnchor {
    std::uint8_t cx = 0, cy = 0, cz = 0; // клетка-ОПОРА (та, где материя)
    std::uint8_t face = 0;               // 0..5, куда смотрит подвешенное
    std::uint8_t tanA = 4, tanB = 4;     // отпечаток на грани, субвоксели 0..7
    std::uint8_t rad  = 1;               // полуширина отпечатка в субвокселях
    std::uint8_t pad_ = 0;
};
static_assert(sizeof(WorldAnchor) == 8);

} // namespace giga
```

`tanA/tanB` — координаты **в системе грани**, не «X и Y»: для `face_axis == 2` это (sx, sy), для `face_axis == 0` — (sy, sz). Никаких букв.

### 7.3 Один хелпер пробы, работающий по любой оси

`SubMask::face_layer(axis, dir, centreOnly)` (`macro_grid.h:67`) уже обобщён по оси — менять его не надо, надо **обобщить отпечаток**: сегодня выбор только «вся грань или центральные 2×2» (`macro_grid.h:68, 81-82`). Заменяется на явное окно:

```cpp
// macro_grid.h — замена face_layer/tangent_layer_solid (та же семантика при
// tanA=tanB=kSubDim/2, rad=1, что и сегодняшний centreOnly=true).
int face_layer_window(int axis, int dir, int tanA, int tanB, int rad) const;
bool window_solid(int axis, int tanA, int tanB, int rad) const; // любой слой
```

Публичный API пробы (там же, `world/anchor.h`):

```cpp
// Единственный вопрос «жив ли якорь», для ВСЕХ потребителей.
// -1 = мертва (в колонке отпечатка нет материи), иначе номер субслоя 0..7,
// на котором материя начинается со стороны подвешенного, — то есть готовая
// координата пере-посадки.
int anchor_layer(const MacroGrid& g, const WorldAnchor& a);
inline bool anchor_alive(const MacroGrid& g, const WorldAnchor& a) {
    return anchor_layer(g, a) >= 0;
}

// Мировая точка поверхности, на которой якорь сидит СЕЙЧАС. Одна функция и
// для спавна, и для пере-посадки — расходиться нечему.
bool anchor_surface(const MacroGrid& g, const WorldAnchor& a, vec3& out);

// Умер ли он ИМЕННО на этой операции (антуражный pair_died, обобщённый).
bool anchor_died(const MacroGrid& g, const std::uint32_t* dirty, std::size_t n,
                 const WorldAnchor& a);

// Собрать якорь из «клетка воздуха + направление опоры» — единственный
// конструктор, который call-site'ы имеют право звать. Возвращает false, если
// опоры нет: спавн обязан отказаться, а не поставить вещь в воздух.
bool anchor_make(const MacroGrid& g, int airX, int airY, int airZ,
                 int axis, int dir, float sizeM, WorldAnchor& out);
```

`anchor_make` берёт `sizeM` (авторские метры из props.csv) и выводит `rad = clamp(ceil(sizeM / kVoxelSize / 2), 1, kSubDim/2)` — **отпечаток выводится из размера вещи**, а не из константы 4.

### 7.4 Список мест правки

| # | Файл | Что делать | LOC |
|---|---|---|---|
| 1 | `src/world/anchor.h` (новый) | структура + 6-значный `face_pack` + 4 функции пробы | +90 |
| 2 | `src/world/macro_grid.h:67-88` | `face_layer` → `face_layer_window` (окно вместо `centreOnly`), старая сигнатура остаётся тонкой обёрткой | +25 / −8 |
| 3 | `src/game/prop_system.h:25-29` | `SubVoxelAnchor` → `using SubVoxelAnchor = WorldAnchor;` на переходный релиз, затем переименовать | −5 / +2 |
| 4 | `src/game/prop_system.cpp:208` | `solid(...)` → `anchor_alive(...)`; при `alive` — пере-посадить `Transform.pos` через `anchor_surface` | +14 / −3 |
| 5 | `src/game/prop_system.cpp:249` | `spawn_prop` gate → `anchor_alive` | +2 / −3 |
| 6 | `src/game/prop_system.cpp:331` | **`view<SubVoxelAnchor, Transform>` → `view<StaticPropTag, Transform>`** — одна строка, чинит контейнеры | +1 / −1 |
| 7 | `src/game/prop_system.cpp:402-409` | стены: `anchor_make(g, x, y, z, wxd?0:1, wxd?wxd:wyd, d.sizeXMm*0.001f, a)`; убрать 7/0/4/4 и `face=1`; разрешить `z±1` в цикле кандидатов (`:358-362`) | +22 / −16 |
| 8 | `src/game/prop_system.cpp:434-475` | лампы: цикл по 6 граням фрейма вместо `z+1`; `subZ` из `anchor_layer`, а не 0; `-0.14f` → `sizeZMm*0.0005f` | +30 / −22 |
| 9 | `src/game/room_zone.cpp:441-513` | `room_floor_under` → `anchor_make(..., f.axis, -f.upSign, ...)`; удалить Z-скан целиком | +12 / −34 |
| 10 | `src/game/container.cpp:357` | `anchor_make` от **опорной** клетки (`cx+dn.x, …`, `dn` уже посчитан на `:331`); не `emplace` напрямую, а через ту же проверку | +8 / −1 |
| 11 | `src/game/floors/padic/padic_module.cpp:44-77` | обе ветки через `anchor_make`; `(2,4,6)` уходит | +10 / −24 |
| 12 | `src/game/antourage/antourage.h:106-112` | удалить `antourage_face_*`, `#include "world/anchor.h"`, заменить 15 call-site'ов на `face_*` | +2 / −8 |
| 13 | `src/game/antourage/antourage.cpp:775-780` | `anchor_gone` → `!anchor_alive`; `WireChain/ClothSheet/AntourageInstance` хранят `WorldAnchor` вместо `ax0..az1 + face` | +18 / −30 |
| 14 | `src/game/combat.cpp:539-544` | труп: сплющивать по `f.axis`, смещать по `-f.upSign`; габариты от `AABB` живого | +14 / −7 |
| 15 | `src/game/prop_system.cpp:562` | `dy` → `wrap_delta_f` | +1 / −1 |
| 16 | `src/game/prop_system.cpp:133-179, 576-586, 636-639` | удалить `check_projectile_prop_hits`, `prop_interact_step` | −58 |
| 17 | `src/game/prop_system.cpp:583` | `3.0f` → `interact_def(kind).reachM`; либо честно читать `Interactable::reachM` | +3 / −2 |
| 18 | Чистильщик отвалившихся | новая `clear_layer_debris(reg, layer)` по `DynamicBodyTag+Transform`, звать из `refresh_floor_props` | +14 |
| 19 | `tests/suite_props_game.inl`, `suite_antourage.inl`, `suite_rooms.inl` | новые тесты (§7.5) | +170 |

**Итого: ~+440 / −220, чистый прирост ≈ +220 LOC.** Двери (`door.h:126` `axis:2`, полотно по Z) — **вне этого захода**: там надо переписать `door_build`, `body_in_leaf`, `door_step` и индекс, это ещё ~150 LOC и отдельный риск для nav-бейка (`doors.frozen`). Ставить в очередь вторым инкрементом.

### 7.5 Что СЛОМАЕТСЯ и как это поймать

| Что ломается | Почему | Чем ловить |
|---|---|---|
| **Число заспавненных пропов вырастет** | `spawn_prop` перестанет отказывать там, где в точке-субвокселе дырка, но в колонке материя есть; лампы получат 6 граней вместо одной | `suite_props_game.inl:179-252` и `suite_rooms.inl:590+` держат счётчики. Перед правкой **записать текущие числа**, после — сравнить и объяснить каждую дельту |
| **Число упавших при карве упадёт** | одиночный субвоксель больше не роняет | `suite_props_game.inl:307, 348, 537, 752` чистят **всю клетку** (`clear_cell`) → останутся зелёными и НИЧЕГО не проверят. **Это ловушка.** Нужен новый тест обратной полярности (ниже) |
| **Контейнеры перестанут исчезать** | п.6 таблицы правок | Новый тест: последовательность `refresh_floor_containers` → `refresh_floor_props` на одном `layer`, `CHECK(count<Container>(layer) > 0)`. **Запустить его ДО правки и убедиться, что он красный** — иначе он не проверяет ничего |
| **Сейв v16 начнёт применяться** | `apply_container_records` (`save.cpp:840`) сегодня стамповать некуда — ящиков нет; после фикса записи «полу-обысканный ящик» оживут | Прогон: обыскать ящик, F5, сменить этаж, вернуться → ящик должен быть пуст. Сегодня он просто отсутствует |
| **Детерминизм бейка антуража** | если `centreOnly=true` заменить на окно с `rad=1`, ответ бит-в-бит тот же (`kCentreZ` = 2×2 центр). Если `rad` где-то поедет — трубы сядут иначе | `static_assert` на эквивалентность + `suite_antourage.inl:484` уже пинит `face_layer` посадку |
| **Смысл байта `face` меняется с 0/1/2 на 0..5** | старые значения `1` («стена») и `2` («потолок») теперь означают `axis0/dir-1` и `axis1/dir+1` | Читателей нет (§6) → **не сломается ничего**. Но: `suite_props_game.inl:274,731` записывают `face=0` — проверить, что тест не начал зависеть от смысла |
| **GPU-инстансы антуража** | `AntourageInstance` меняет раскладку полей (`ax0..az1+face` → `WorldAnchor`) | Структура — CPU-only (`main.cpp:1326-1348` читает поля вручную), в SSBO не едет. Прогнать `GIGA_ANTOURAGE_DEBUG=1` и сверить число нарисованных |
| **`DynamicBodyTag`-мусор начнёт удаляться** | п.18 | Тест: спавн → detach → `clear_layer_props` + `clear_layer_debris` → `CHECK(reg.storage<Transform>().size() == 0)` для слоя |

**Обязательный тест обратной полярности** (сначала красный, потом зелёный):

```cpp
// 1. Карв ОДНОГО субвокселя РЯДОМ с якорем — вещь обязана выжить.
world.grid().mask(cx,cy,cz).clear(sub_bit(0,0,0));      // не отпечаток
anchor_validate_step(reg, world, bus, {macro_index(cx,cy,cz)});
CHECK(reg.all_of<StaticPropTag>(e));                    // СЕГОДНЯ ЗЕЛЁНЫЙ

// 2. Карв ОДНОГО субвокселя ПОД якорем, колонка выше цела — тоже выжить,
//    и пере-сесть на 0.25 м выше.
const float z0 = reg.get<Transform>(e).pos.z;
world.grid().mask(cx,cy,cz).clear(sub_bit(4,4,0));
anchor_validate_step(reg, world, bus, {macro_index(cx,cy,cz)});
CHECK(reg.all_of<StaticPropTag>(e));                    // СЕГОДНЯ КРАСНЫЙ ← цель
CHECK(reg.get<Transform>(e).pos.z > z0);                // СЕГОДНЯ КРАСНЫЙ

// 3. Выесть ВСЮ колонку отпечатка — обязана упасть.
for (int sz = 0; sz < kSubDim; ++sz)
  for (int a = 3; a <= 4; ++a) for (int b = 3; b <= 4; ++b)
    world.grid().mask(cx,cy,cz).clear(sub_bit(a,b,sz));
anchor_validate_step(reg, world, bus, {macro_index(cx,cy,cz)});
CHECK(reg.all_of<DynamicBodyTag>(e));                   // СЕГОДНЯ ЗЕЛЁНЫЙ

// 4. То же самое для граней 0..5 в цикле — изотропия как тест, не как обещание.
```

Пункт 4 — то, чего в репозитории нет ни для одного механизма крепления: **ни один тест не вешает вещь на грань, отличную от «потолок сверху» или «пол снизу»**.

---

## 8. Сводная классификация

| Класс | Находки |
|---|---|
| **РАСХОЖДЕНИЕ-С-КАНОНОМ** | проба пропов = 1 бит вместо колонки (`prop_system.cpp:208`); трупы/пятна/двери не крепятся вообще; `SubVoxelAnchor::face` обещает 6 значений, обслуживает 3 |
| **ДУБЛЬ** | две кодировки грани (`prop_system.h:28` vs `antourage.h:106`); две пробы живости (`prop_system.cpp:208` vs `antourage.cpp:775`); два колоночных хелпера (`macro_grid.h:52` Z-only vs `:67` изотропный); `PendingDetachedProp::color/meshKind` пересчитываются в `detach_single_prop:65-72`; `Corpse` + `Interactable{Kind::Corpse}` |
| **АНИЗОТРОПИЯ** | `prop_system.cpp:358-362` (4 стены); `:439,457,471` (потолок = z+1); `room_zone.cpp:445-473` (пол = z-1); `padic_module.cpp:49`; `container.cpp:357` (subZ=0); `door.h:126` (`axis:2`) + `door.cpp:56,64`; `combat.cpp:539-544` (Y как вертикаль); `prop_system.cpp:562` (нет wrap по Y) |
| **ХАРДКОД** | 27 позиций, таблица §5. Худшие: `prop_system.cpp:406-408, 472-474` (7/0/4/4/0), `:466` (`-0.14f`), `:130` (`AABB{0.2,0.2,0.2}` при живом `PropMesh::scale`), `padic_module.cpp:68-70` (`2,4,6`) |
| **КАТЕГОРИЙНАЯ-ОШИБКА** | `prop_system.cpp:331` — `SubVoxelAnchor` == «статический проп»; `prop_system.cpp:147,195` — то же в двух проходах; `combat.cpp:500` — `RpgStats` == «достоин XP»; `main.cpp:1030` — `Container` == «ящик спавнера» |
| **МЁРТВОЕ** | `check_projectile_prop_hits` (`prop_system.cpp:133`, 47 строк); `SubVoxelAnchor::face` (`prop_system.h:28`); `Interactable::reachM` (`prop_system.h:37`); `SubMask::lowest_layer` (`macro_grid.h:47`); `prop_interact_step` (`prop_system.cpp:636`) |
| **БАГ** | **(1)** контейнеры уничтожаются на каждом входе на этаж — `main.cpp:1967/1968, 2602/2603, 4795/4808, 7122/7124` + `prop_system.cpp:331`; **(2)** контейнер привязан к воздуху — `container.cpp:357` vs `floor_gen.cpp:104`; **(3)** труп кладётся на пол по оси Y — `combat.cpp:539-544`; **(4)** нет wrap по Y в поиске интерактивного — `prop_system.cpp:562`; **(5)** отвалившиеся пропы не чистятся при переиспользовании `LayerId` — `prop_system.cpp:331` + отсутствие потребителя `DynamicBodyTag` |

### Порядок работ (по стоимости/эффекту)

1. `prop_system.cpp:331` → `StaticPropTag`. **Одна строка**, воскрешает всю контейнерную экономику и сейв-записи ящиков.
2. `container.cpp:357` → якорь на опорную клетку. ~8 строк.
3. `combat.cpp:539-544` + `prop_system.cpp:562` → оси. ~15 строк.
4. Удалить мёртвое (§6). −110 строк, ноль риска.
5. `world/anchor.h` + перевод пропов на колоночную пробу (§7). Основной заход.
6. Двери — отдельным инкрементом.
