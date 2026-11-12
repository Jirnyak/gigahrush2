// Per-floor generator — builds a floor MODULE's 128^3 World as a pure function
// of (seed, floor number, FloorSpec).
//
// floors.md / macrosim.md: a floor is a self-contained module whose geometry is
// fully determined by its number and the world seed. That determinism is what
// lets a streamed-out floor be torn down and regenerated bit-for-bit on return
// (increment #9), so nothing about a floor's layout has to be persisted.
//
// GEOMETRY COMES FROM MODULES ([floors.md] — the folder is the module). This
// file is only the dispatch seam (kind -> module generator row) plus the room
// TAXONOMY the content tables key on. The floor's *character* (its FloorKind,
// carried in the FloorSpec) themes CONTENT — population, mobs, loot, room mix —
// never geometry branches.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "ecs/registry.h"      // Registry — контекст постановки содержимого
#include "game/floor_spec.h"
#include "world/gravity.h"     // GravityRegime — the module's declared frame
#include "world/level_stack.h" // LayerId — слот слоя в контексте постановки
#include "world/macro_grid.h"  // SubMask — сечение полотна в клетке проёма

namespace giga {
class World;
class MacroGrid;
}

namespace giga::game {

// Build `world`'s grid into the floor labelled `number`, themed by `spec`.
//
// The world is cleared to air first, so the result depends only on
// (number, spec.kind, seed) and NOT on any prior contents of `world` — call it
// again with the same arguments (even on a recycled World slot) and you get an
// identical grid. `number` is the in-game floor label (signed, floors.md); it is
// mixed into the RNG so two floors of the same kind still differ.
// A FLOOR ENTRY IS THREE STEPS, NOT ONE. Generation and rules used to be fused
// inside the module generator; splitting them is what lets a VISITED floor come
// back from its snapshot instead of being rebuilt ([floors.md], [problems.md] §42):
//
//   1. floor_declare_rules  — the module's LAWS. Gravity frame, registries.
//                             ALWAYS, before any geometry exists. The frame is a
//                             property of the MODULE, never of the saved bytes,
//                             which is exactly why a restored floor still needs
//                             this and why the snapshot does not carry it.
//   2. generate_floor  OR  a snapshot restore — the GEOMETRY. One or the other:
//                             first visit builds it from (seed, number), a
//                             revisit reads it back verbatim.
//   3. floor_apply_rules    — the module's rules laid ON TOP of whichever
//                             geometry step ran: fluids, seeded content.
//                             ALWAYS, after geometry is final.
//
// Steps 1 and 3 are idempotent and deterministic in (seed, number), like the
// geometry itself. A module supplies all three as data rows in floor_gen.cpp's
// dispatch tables — never a branch.
void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed);

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed);

// ВЕРСИЯ ГЕНЕРАЦИИ МОДУЛЯ (CANON S20.6 закон 4). Целое, поднимаемое РУКОЙ
// при любом изменении, меняющем выход generate_floor для этого kind, — сам
// генератор, общий каркас (лифтовые столбы), сид-формулы. Снимок этажа несёт
// её; несовпадение = честная инвалидация снимка целиком (перегенерация,
// накопленное теряется). Полуслияние старого снимка с новым модулем
// запрещено — законы (двери, комнаты, DoorRef обвеса) перештамповываются
// индексами ТОЙ ЖЕ генерации, и под чужой версией индекс молча врал бы.
std::uint32_t module_gen_version(FloorKind kind);

// Объявить комнаты этажа (rooms-object, канон S12.1): rooms_reset + диспетч
// в объявитель модуля (строка данных, как генератор). Зовётся на КАЖДОМ входе
// на этаж — generate и restore (закон масок S18: декларация — чистая функция
// (kind, number, seed), в снимок не едет). Печатает счёт вслух; пересечение
// зон или отказ объявления — WARN, гейт в suite_rooms_object.
struct FloorRooms;
void rooms_declare(FloorRooms& rooms, int number, const FloorSpec& spec,
                   unsigned seed);

// --- Лифтовые столбы (elevators-2x2.md, решения владельца 2026-08-27) -------
// Узел лифта = ЗАМКНУТЫЙ столб: кольцо стен 3×3 через весь тор (z
// заворачивается — у столба нет ни начала, ни конца), шахта 1 клетка в
// центре. Кабина НЕ движется: на этаже входа в шахте стоит пол (клетка под
// storey входа), «приезд кабины» — иллюзия поездки. ВХОД — один проём в
// кольце: storey — ОБЩАЯ координата прибытия столба (kFloorArrivalCoord ниже:
// поездка планирует её до того, как узнает модуль назначения), сторону — хеш
// (сид, этаж, узел).
// От этой структуры считают ВСЕ потребители: посадка ride_elevator, кнопка
// вызова, панель кабины — второй копии закона не существует.

// КООРДИНАТА ПРИБЫТИЯ — КОНТРАКТ ВСЕГО СТОЛБА, А НЕ ПОЛИТИКА ОДНОГО МОДУЛЯ.
//
// Это число ОБЩЕЕ для всех модулей этажей, и так и надо говорить вслух. Оно
// жило здесь как `kPadicGroundCoord` — константа ОДНОГО модуля в общем ответе,
// — и три модуля независимо писали в своих заголовках «намеренно равно
// падиковскому». Равны они не падику: поездка между этажами планирует
// координату прибытия ЗАРАНЕЕ, одной на весь столб (`save.h kArrivalCoord`
// летит параметром в `ride_elevator`), значит модуль, чтобы быть достижимым
// лифтом, ОБЯЗАН гарантировать ходовую клетку ровно здесь. Это требование
// лифта к модулю, а не наблюдение о падике.
//
// Пин живёт тут, а не в `save.h`: `save.h` → `game/container.h` →
// `game/floor_gen.h`, то есть включить `save.h` отсюда нельзя — цикл. Поэтому
// число повторено литералом, а `floor_gen.cpp` утверждает равенство и ему, и
// собственной координате КАЖДОГО зарегистрированного модуля
// (`kPadicGroundCoord`/`kBlameGroundCoord`/`kKhrushiGroundCoord`): модуль,
// перестроивший свою геометрию и забывший про лифт, перестаёт СОБИРАТЬСЯ.
inline constexpr int kFloorArrivalCoord = 3;

struct LiftEntrance {
    int h;    // walkable storey клетки входа (и пола кабины под ней)
    int side; // 0..3 = +x, -x, +y, -y — сторона проёма в кольце
};
// node — лифтовый хаб [0, kFastHubsPerFloor) из fast_travel.h.
LiftEntrance lift_entrance(FloorKind kind, int number, int node, unsigned seed);

// Проштамповать 4 столба поверх ЛЮБОГО модуля — generate_floor зовёт это
// сам после генератора. В снимок ревизита столбы входят обычными клетками,
// restore-ветка ничего не перештамповывает.
void stamp_lift_pillars(World& world, int number, const FloorSpec& spec,
                        unsigned seed);

// ЩИТ лифтов ([world/protect.h], решение владельца 2026-08-27): весь объём
// каждого столба 3×3 через все z — защищённая область (кольцо, шахта, пол
// кабины, проём — ни карв, ни детач, ни будущий самосбор их не меняют;
// лифт — ключевая механика). Маска НЕ в снимке — чистая функция сетки, её
// штампует ensure_loaded/Prebuild на КАЖДОМ входе, обеими ветками
// (build_world_half). Чистит маску слота и кладёт свою.
void stamp_lift_protection(World& world);

// ---------------------------------------------------------------------------
// Gravity frame — МОДУЛЬ ОБЪЯВЛЯЕТ, ОБЩИЙ КОД ТОЛЬКО СПРАШИВАЕТ
// ---------------------------------------------------------------------------
// The engine is ISOTROPIC (x/y/z equal citizens on the torus); gravity is the
// one emergent asymmetry, and it is the MODULE's to declare ([world/gravity.h]
// GravityRegime — 8 values, one of which is Zero). Канон S11: «Модуль обязан
// уметь объявить свой гравитационный фрейм».
//
// ДВА КАНАЛА, И ЭТО НЕ ДУБЛИКАТЫ — У НИХ РАЗНОЕ ВРЕМЯ ЖИЗНИ:
//
//   * ЖИВОЙ фрейм этажа — `world.gravity().regime`. Его пишет сам модуль в
//     своём `*_declare_rules` (шаг 1 входа на этаж), и это РАНТАЙМ-состояние:
//     игра вправе его перевернуть посреди прогона, потребители обязаны
//     перечитывать, а не кэшировать. Все, кто держит World, спрашивают ЕГО —
//     так и работает `floor_standable` ниже.
//
//   * ЗАЯВЛЕННЫЙ фрейм МОДУЛЯ — `floor_gravity_regime(kind)`. Отвечает, когда
//     World'а ещё нет: фрейм обязан быть известен ДО геометрии (шаг 1 из трёх
//     наверху файла), и посадка лифта выбирает ось прибытия на этаже, который
//     в этот момент может быть не резидентным. Берётся СТРОКОЙ таблицы
//     модулей в floor_gen.cpp, и каждая строка называет собственную константу
//     своего модуля — kPadicGravity / kBlameGravity / kKhrushiGravity, каждая
//     в своём заголовке.
//
// На этом месте до 2026-11-08 стояло `return kPadicGravity;`: общий код
// отвечал фреймом ОДНОГО модуля на вопрос обо ВСЕХ. Формально это не `if` по
// виду этажа, а по существу — та же запрещённая каноном ветка, просто
// схлопнутая в константу. Долг был ЛАТЕНТНЫМ (все три модуля объявляют NegZ),
// то есть ровно той миной, про которую канон и написан.
GravityRegime floor_gravity_regime(FloorKind kind);

// A standing cell: air, with solid one cell toward -g. Under Zero every air
// cell qualifies. Wraps on all axes. Reads the WORLD's live regime
// (world.gravity().regime — runtime state the game may flip mid-run), never the
// module's generation-time constant.
bool floor_standable(const World& w, int x, int y, int z);

// Координата прибытия, названная как Z — то есть `kFloorArrivalCoord` выше.
// Z, а не «ось фрейма», и это ЧЕСТНО: лифтовый столб кладётся общим каркасом
// по оси Z у ЛЮБОГО модуля (stamp_lift_pillars: кольцо в плоскости XY вокруг
// планарного узла латтиса, шахта через все z), поэтому ходовая клетка
// прибытия — Z-координата по построению. Гейт в floor_gen.cpp держит это
// утверждение: модуль, объявивший не-Z фрейм, не соберётся, пока у лифта не
// появится поперечная шахта.
//
// РЕШЁТОЧНЫЙ КЛАСТЕР floor_ground_coord/floor_cell/floor_ground_cell УМЕР
// (2026-11-08): три осе-generic функции, у которых НЕ БЫЛО ни одного
// потребителя ни в src/, ни в tests/, а `floor_ground_coord` вдобавок был
// дубликатом этой функции. Осе-generic композиция клетки вернётся с реальным
// потребителем — модулем, который объявит не-Z фрейм, — и вместе с ним
// вернётся через `world.gravity()`, а не через константу одного модуля.
int floor_ground_z();

// ---------------------------------------------------------------------------
// РЕШЁТОЧНАЯ ТАКСОНОМИЯ КОМНАТ УМЕРЛА (rooms-object F, 2026-08-28): хеш
// «вида» по (kind, number, rx, ry) заменён НАСТОЯЩИМИ комнатами модуля —
// game/room.h (RoomId, roomAt, теги, глаголы). floor_room_mask/stride/
// bit_index и RoomBit не существуют; грепный гейт в check_source_rules.
// ---------------------------------------------------------------------------

// One opening this generator punches through an interior wall — the cell a DOOR
// occupies ([door.h]). Positions are macro cells, so a byte each.
//
// `axis` says which wall line the opening is IN, which is the only thing a
// consumer cannot re-derive from the cell alone once the wall has decayed:
//   0 -> the wall line x == cx, so the jambs are at (cx, cy+-1)
//   1 -> the wall line y == cy, so the jambs are at (cx+-1, cy)
struct Doorway {
    std::uint8_t cx = 0;   // opening cell, X
    std::uint8_t cy = 0;   // opening cell, Y
    std::uint8_t cz = 0;   // BOTTOM cell of the opening
    std::uint8_t h = 0;    // opening height in cells, >= 1
    std::uint8_t axis = 0; // which wall line holds it (see above)
    // ФОРМА ПОЛОТНА — какие атомы КЛЕТКИ ПРОЁМА оно занимает, одна на все
    // клетки проёма по высоте. Закон (владелец, 2026-11-12): «дверь просто
    // заполняет субвокселями материала дверной проём… не важно какая сторона,
    // толщиной дверного проёма». То есть полотно — это СЕЧЕНИЕ СТЕНЫ, в
    // которой проём прорезан: те самые атомы, которых стене в этой клетке не
    // хватает. Закрытая дверь поэтому стоит заподлицо со стеной, сторон у неё
    // нет, а толщина — толщина стены, какой бы та ни была.
    //
    // Называет её МОДУЛЬ, а не `door_declare`, и по той же причине, по которой
    // здесь лежит `axis`: из мира сечение не вывести, когда косяки выбиты
    // карвом, — а объявление обязано быть чистой функцией (номер, сид).
    // До этого дня полотном была ПОЛНАЯ клетка на всю высоту проёма — блок
    // 2 × 2 × 4 м вместо двери в стене толщиной полметра; он и замуровывал
    // тело, стоявшее рядом с проёмом.
    SubMask leaf;
};

// Enumerate every doorway `generate_floor(world, number, spec, seed)` punches,
// appending to `out`; returns how many were added.
//
// ПЕРЕЧИСЛЯЕТ МОДУЛЬ, НЕ ЭТА ФУНКЦИЯ — строка данных в таблице
// `kDoorwayEnumerators` (floor_gen.cpp), как генератор и как объявитель
// комнат. Здесь стояла ветка `if (kind == Blame || kind == Khrushi) return 0;`
// — знание о ДВУХ конкретных модулях в общем коде, прямо запрещённое каноном
// S11. Теперь ноль возвращает сам модуль, из своего файла и со своей
// причиной: у блейма пасти лабиринта выходят в бездну и у них нет наличников
// под полотно, у хрущей подъездные и квартирные двери — следующий инкремент.
//
// Exported so a second consumer has to
// agree with the generator EXACTLY. door.cpp needs the doorway cells at floor
// load, and the two ways to get them are both traps —
//
//   * re-deriving them from the finished grid guesses, and guesses wrong on a
//     Derelict floor, where `gapPct` has knocked 38% of the wall out and a
//     collapsed hole is indistinguishable from an architectural opening;
//   * replaying the generator's xorshift stream couples the replay to the ORDER
//     every other loop in generate_floor draws numbers in — the same silent,
//     seed-dependent drift the note above warns about for the stride table.
//
// So the offset of an opening inside its wall segment is a pure HASH of
// (seed, number, storey, room, axis), and this function and the generator call
// the same one. A hash has no order to get wrong.
std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out);

// ---------------------------------------------------------------------------
// ПОСТАНОВКА СОДЕРЖИМОГО — ДЕВЯТАЯ ТАБЛИЦА МОДУЛЯ
// ---------------------------------------------------------------------------
// ЗАКОН ВЛАДЕЛЬЦА 2026-11-08, дословно: «ядро это движок, а этажи как
// редакторы/генераторы уровней, а системы агностичные. Никаких решений по
// контенту в системах. У модуля должен быть контроль вплоть до решить: вот тан
// этот воксель с такими координатами крепится вот тут, такая комната, вот тут
// такой моб, вот тут такой проп и интерактор — и это должно быть легко
// доступно модулю по желанию».
//
// Шесть пунктов из семи у модуля БЫЛИ: воксель (`fill_cell`/`carve_*` зовёт
// сам генератор), комната (`room_declare` из своего объявителя), законы,
// фрейм, проёмы, антураж — всё строками этих таблиц. СЕДЬМОЙ НЕ БЫЛО: проп и
// интерактор рождались ТОЛЬКО общим стохастическим проходом по полосам весов
// строки этажа (`FloorSpec::wallDevices`/`floorDevices`/`ceilingLights`), то
// есть сказать «койка в клетке (12,34,5) спиной к +Y» модуль не мог ничем.
// Поэтому в дереве и не было ни одной мебельной вещи: `bed_cot`,
// `kitchen_stove`, `toilet_pan`, `kitchen_table` стояли в props.csv со своими
// глаголами и НОЛЬ раз упоминались в коде.
//
// Хук идёт ПОСЛЕ ОБЪЯВЛЕНИЯ КОМНАТ и видит `FloorRooms` — это решение
// владельца, и оно несущее: соответствие «вещь ↔ место» ищется ПО ГЛАГОЛУ
// (`Room::declared` против колонки verbs строки пропа), а не по «виду
// комнаты», которого не существует (S12.2). Модуль ставит сколько и где
// хочет: примитивы постановки ([game/prop_system.h] place_prop_on_wall /
// place_prop_standing / place_prop_hanging + room_stand_spots) выставлены ему
// наружу, и те же три глагола зовут общие сеялки — полоса весов осталась
// УДОБСТВОМ, а путь рождения стал один.
//
// МОБ — ТОТ ЖЕ ХУК И ТА ЖЕ ЕДИНАЯ ФУНКЦИЯ (`spawn_mob_at`, [mob_spawn.h]):
// модуль сам решает, по каким комнатам, структурам или любым своим условиям
// их сажать. Общий код об этом не знает ничего — ни одной строки про «крыши»
// или «гнёзда» в системах нет и быть не должно.
//
// `EventBus&` в контекст НЕ попал: оба прежних сеялки модулей брали его
// параметром и оба делали `(void)bus` — читателя не было никогда.
struct FloorRooms;
struct FloorPlaceCtx {
    Registry& reg;
    const World& world;      // ТОЛЬКО ЧИТАТЬ: геометрия финальна (шаг 3 входа)
    const FloorRooms& rooms; // комнаты УЖЕ объявлены этим прибытием
    const FloorSpec& spec;   // строка этажа — ею же диспатчится расстановщик
    LayerId layer;           // слой-слот: Transform помечается им
    int number;              // внутриигровой номер этажа
    unsigned seed;           // сид ЭТОГО этажа (тот же, что у его геометрии)
    // ЖИВОЙ СИМ-ТИК, и он обязателен без умолчания — ровно как у
    // `spawn_floor_mobs`/`spawn_mob_at` (CANON S22): авторский моб рождается с
    // ОКНОМ действия, открытым «сейчас», а окно без «сейчас» выразить нечем.
    // Поле завелось 2026-11-08 ВМЕСТЕ С ПЕРВЫМ ЧИТАТЕЛЕМ (`khrushi_place`
    // сажает по мобу на крышу); до того дня его здесь намеренно не было.
    std::uint64_t tick;
};

// Позвать расстановщика модуля (строка `kContentPlacers` в floor_gen.cpp).
// Возвращает число рождённых вещей — счёт всегда вслух (S11). Зовётся ТОЛЬКО
// ветвью generate: на restore содержимое приходит записями снимка (S20.6
// закон 2), иначе каждое возвращение на этаж удваивало бы мебель.
std::uint32_t floor_place_content(const FloorPlaceCtx& ctx);

// MODULE antourage on top of the generic bake: after bake_antourage reads the
// finished grid, the floor's own module may append instances/wires/cloths it
// can only lay out from its plan (khrushi strings wires between its street
// poles). Per-kind table row in floor_gen.cpp — a row, never a branch; kinds
// without module dressing have a null row and this is a no-op. Deterministic
// in (grid, number, seed) like the generic bake, and it obeys the same law:
// READ the grid, never write it.
struct AntourageBake;
void floor_antourage_extra(const World& world, int number,
                           const FloorSpec& spec, unsigned seed,
                           AntourageBake& out);

} // namespace giga::game
