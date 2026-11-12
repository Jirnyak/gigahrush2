#include "core/rng.h"
#include "game/floor_gen.h"

#include "core/table_guard.h"

#include <bit>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>

#include "game/floors/blame/blame.h"     // the megastructure module (kind Blame)
#include "game/floors/khrushi/khrushi.h" // the open microdistrict (kind Khrushi)
#include "game/floors/padic/padic.h"     // the module every OTHER kind dispatches to
#include "game/fast_travel.h"        // лифтовая сетка 2×2 — узлы столбов
#include "game/room.h"               // FloorRooms — комнаты объявляет модуль (S12.1)
#include "world/destruct.h"          // kSubMaterialName — страницы под штампом
#include "world/macro_grid.h"        // MacroGrid — the frame helpers query cells
#include "world/world.h"             // World — live gravity regime + grid

namespace giga::game {



bool floor_standable(const World& w, int x, int y, int z) {
    const MacroGrid& g = w.grid();
    if (g.cell(x, y, z) != kCellAir) return false;
    const CellStep d = regime_down(w.gravity().regime);
    if (d.x == 0 && d.y == 0 && d.z == 0) return true; // Zero-g: any air cell
    return g.cell(x + d.x, y + d.y, z + d.z) != kCellAir;
}

int floor_ground_z() { return kFloorArrivalCoord; }

// ---- КОНТРАКТ ПРИБЫТИЯ: ОДНО ЧИСЛО, И КАЖДЫЙ МОДУЛЬ ЕМУ ОБЯЗАН -------------
// Поездка (ride_elevator) и загрузка сейва планируют координату прибытия
// ЗАРАНЕЕ, одной на весь столб — `save.h kArrivalCoord` летит параметром, — а
// значит модуль, который хочет быть достижимым лифтом, обязан держать ходовую
// клетку (воздух, твердь на шаг вниз) ровно там. Промахнётся — каждая поездка
// высаживает игрока внутрь потолочного сэндвича и перекладывает спасение на
// разрешитель размещения.
//
// Здесь стоял ОДИН пин, `kPadicGroundCoord == 3`, то есть общий код проверял
// соблюдение контракта у ОДНОГО модуля из трёх. Теперь утверждение на каждый
// зарегистрированный модуль: `floor_gen.cpp` — единственное место, которое
// включает все три манифеста, значит это и есть место для контракта. Модуль,
// перестроивший геометрию и уехавший ground'ом, перестаёт СОБИРАТЬСЯ.
// `save.h` по-прежнему повторён литералом: включить его отсюда нельзя
// (save.h → container.h → floor_gen.h — цикл).
static_assert(kFloorArrivalCoord == 3,
              "keep save.h kArrivalCoord in step with the lift contract");
static_assert(kPadicGroundCoord == kFloorArrivalCoord,
              "padic: ходовой ground модуля разъехался с координатой прибытия "
              "лифта — либо верни геометрию, либо подними контракт и save.h");
static_assert(kBlameGroundCoord == kFloorArrivalCoord,
              "blame: ходовой ground модуля разъехался с координатой прибытия "
              "лифта — либо верни геометрию, либо подними контракт и save.h");
static_assert(kKhrushiGroundCoord == kFloorArrivalCoord,
              "khrushi: ходовой ground модуля разъехался с координатой "
              "прибытия лифта — либо верни геометрию, либо подними контракт "
              "и save.h");

// ---------------------------------------------------------------------------
// Floor Generator Dispatch
// ---------------------------------------------------------------------------
// GEOMETRY COMES FROM MODULES, period ([floors.md] — the folder is the module).
// There is no generic lattice builder any more: the old per-kind slab/wall
// generator was purged (owner's mandate, 2026-08-02) and every kind dispatches
// to the one registered geometry module. A new floor look = a new module folder
// under src/game/floors/<name>/ + its row here, never a branch.
using FloorGeneratorFunc = void (*)(World&, int, const FloorSpec&, unsigned);
using FloorRoomsFunc = std::uint32_t (*)(int, unsigned, FloorRooms&);
using FloorDoorwaysFunc = std::uint32_t (*)(int, unsigned, std::vector<Doorway>&);
using AntourageExtraFunc = void (*)(const World&, int, unsigned, AntourageBake&);
using FloorPlaceFunc = std::uint32_t (*)(const FloorPlaceCtx&);

// ---- КОНВЕЙЕР МОДУЛЯ: ДЕВЯТЬ ТАБЛИЦ, И У КАЖДОЙ СТРОКИ ЕСТЬ КЛЮЧ ----------
//
// Шесть из девяти: 2026-11-08 к шести конвейерным добавились гравитационный
// фрейм, перечисление проёмов и РАССТАНОВКА СОДЕРЖИМОГО — три вопроса, на
// которые общий код отвечал САМ (`return kPadicGravity;`,
// `if (kind == Blame || kind == Khrushi)` и — в app, а не даже здесь —
// `if (kind == Padic) seed_padic_props(...)`).
//
// Здесь стояли шесть ГОЛЫХ массивов, индексируемых `FloorKind`, и каждый был
// прикрыт `static_assert`'ом на ДЛИНУ. Длина ловит вставку и удаление значения
// энума и НЕ ловит перестановку — а эти шесть таблиц раздают работу МОДУЛЯМ
// ЭТАЖЕЙ. Переставь два значения в `FloorKind`, и падик начнёт генерировать
// хрущи: геометрия, законы, комнаты и версия снимка разъедутся по чужим
// модулям, пройдя все шесть утверждений на длину и весь зелёный `ctest`.
// Прямое нарушение CANON S11 («этажи — изолированные модули»), которое в дифе
// энума глазами не видно.
//
// Лечение структурное: строка несёт свой `FloorKind` колонкой, и
// `GIGA_TABLE_BY_ENUM` утверждает И население, И ПОРЯДОК. Съехавшая таблица
// перестаёт СОБИРАТЬСЯ. Цена — одна колонка на строку и `.fn` на точке вызова;
// никакого рантайма (всё `constexpr`).
//
// Перепись 2026-10-01: в дереве было 14 таблиц с проверкой длины и НОЛЬ
// проверок порядка. Эти шесть и каталог `floor_spec.cpp` — первые семь.
struct FloorGenRow { FloorKind kind; FloorGeneratorFunc fn; };
struct FloorRoomsRow { FloorKind kind; FloorRoomsFunc fn; };
struct FloorDoorwaysRow { FloorKind kind; FloorDoorwaysFunc fn; };
struct GravityFrameRow { FloorKind kind; GravityRegime regime; };
struct ModuleVersionRow { FloorKind kind; std::uint32_t version; };
struct AntourageExtraRow { FloorKind kind; AntourageExtraFunc fn; };
struct FloorPlaceRow { FloorKind kind; FloorPlaceFunc fn; };

// There is no generic lattice builder any more: the old per-kind slab/wall
// generator was purged (owner's mandate, 2026-08-02) and every kind dispatches
// to the one registered geometry module. A new floor look = a new module folder
// under src/game/floors/<name>/ + its row here, never a branch.
constexpr FloorGenRow kGenerators[] = {
    {FloorKind::Residential, generate_padic_floor},   // themed by content tables, padic geometry
    {FloorKind::Commercial,  generate_padic_floor},
    {FloorKind::Industrial,  generate_padic_floor},
    {FloorKind::Derelict,    generate_padic_floor},
    {FloorKind::Padic,       generate_padic_floor},
    {FloorKind::Blame,       generate_blame_floor},   // the megastructure module's own geometry
    {FloorKind::Khrushi,     generate_khrushi_floor}, // the open microdistrict's own geometry
};
GIGA_TABLE_BY_ENUM(kGenerators, &FloorGenRow::kind, FloorKind::Count);

constexpr FloorGenRow kRuleDeclarers[] = {
    {FloorKind::Residential, padic_declare_rules},
    {FloorKind::Commercial,  padic_declare_rules},
    {FloorKind::Industrial,  padic_declare_rules},
    {FloorKind::Derelict,    padic_declare_rules},
    {FloorKind::Padic,       padic_declare_rules},
    {FloorKind::Blame,       blame_declare_rules},
    {FloorKind::Khrushi,     khrushi_declare_rules},
};
GIGA_TABLE_BY_ENUM(kRuleDeclarers, &FloorGenRow::kind, FloorKind::Count);

// ГРАВИТАЦИОННЫЙ ФРЕЙМ МОДУЛЯ (CANON S11: «Модуль обязан уметь объявить свой
// гравитационный фрейм»). Строка НАЗЫВАЕТ константу модуля, а не повторяет её
// значение: `kPadicGravity`/`kBlameGravity`/`kKhrushiGravity` объявлены каждая
// в своём манифесте, рядом с выводом («башня складывает ярусы против -Z»), и
// тот же `kXGravity` модуль пишет в живой `world.gravity().regime` в своём
// `*_declare_rules`. Поменять фрейм модуля = поправить ОДНУ константу в ОДНОМ
// файле модуля; таблицу при этом трогать не надо.
//
// Жил здесь `GravityRegime floor_gravity_regime() { return kPadicGravity; }` —
// движковый вопрос «какой фрейм у ЭТОГО этажа» с ответом фреймом ОДНОГО
// модуля.
constexpr GravityFrameRow kGravityFrames[] = {
    {FloorKind::Residential, kPadicGravity},   // padic геометрия — её фрейм
    {FloorKind::Commercial,  kPadicGravity},
    {FloorKind::Industrial,  kPadicGravity},
    {FloorKind::Derelict,    kPadicGravity},
    {FloorKind::Padic,       kPadicGravity},
    {FloorKind::Blame,       kBlameGravity},
    {FloorKind::Khrushi,     kKhrushiGravity},
};
GIGA_TABLE_BY_ENUM(kGravityFrames, &GravityFrameRow::kind, FloorKind::Count);

// ---- ГЕЙТ: «ШАХТА ИНВАРИАНТНА» СИЛЬНЕЕ, ЧЕМ ИЗОТРОПИЯ ФРЕЙМА --------------
// Сегодня латентный долг не виден: все три модуля объявляют NegZ. Но ровно в
// тот день, когда модуль объявит -X, мина сработает молча — потому что
// ЛИФТ У НАС Z-ОСЕВОЙ, и это не фрейм модуля, а общий каркас:
// `stamp_lift_pillars` кладёт кольцо 3×3 в плоскости XY вокруг ПЛАНАРНОГО
// узла латтиса (`fast_hub_cell` отдаёт только cx/cy) и гонит шахту через все
// z; `LiftEntrance::h` и `kFloorArrivalCoord` — Z-координаты; кабина, её пол
// и её потолок кладутся как `e.h - 1`/`e.h`/`e.h + 1` по z. Модуль с -X
// получил бы ГОРИЗОНТАЛЬНУЮ трубу вместо шахты и «пол» кабины на стене.
//
// Поэтому фрейм модуля не свободен, пока у лифта одна ось, и это сказано
// утверждением, а не надеждой. Zero законен — там падать некуда. Custom
// отказан намеренно: он требует фолбэка на векторное поле, которого у таблицы
// в compile-time нет. Снять этот гейт = сперва научить столб ложиться по
// объявленной оси.
constexpr bool lift_axis_ok(GravityRegime r) {
    return r == GravityRegime::NegZ || r == GravityRegime::PosZ ||
           r == GravityRegime::Zero;
}
constexpr bool all_frames_lift_compatible() {
    for (const GravityFrameRow& r : kGravityFrames)
        if (!lift_axis_ok(r.regime)) return false;
    return true;
}
static_assert(all_frames_lift_compatible(),
              "модуль объявил не-Z гравитационный фрейм, а лифтовый столб "
              "кладётся по Z у ЛЮБОГО модуля (stamp_lift_pillars: кольцо в "
              "XY вокруг планарного узла, шахта через все z; прибытие — "
              "kFloorArrivalCoord по z). Сперва научи столб ложиться по "
              "объявленной оси, потом меняй фрейм.");

constexpr FloorGenRow kRuleAppliers[] = {
    {FloorKind::Residential, padic_apply_rules},
    {FloorKind::Commercial,  padic_apply_rules},
    {FloorKind::Industrial,  padic_apply_rules},
    {FloorKind::Derelict,    padic_apply_rules},
    {FloorKind::Padic,       padic_apply_rules},
    {FloorKind::Blame,       blame_apply_rules},
    {FloorKind::Khrushi,     khrushi_apply_rules},
};
GIGA_TABLE_BY_ENUM(kRuleAppliers, &FloorGenRow::kind, FloorKind::Count);

// Объявители комнат (rooms-object C, S12.1: комнаты объявляет МОДУЛЬ) —
// та же строка данных на kind, что генератор и законы. Чистые функции
// (number, seed), перештамповка на каждом входе (закон масок S18).
constexpr FloorRoomsRow kRoomDeclarers[] = {
    {FloorKind::Residential, padic_rooms},
    {FloorKind::Commercial,  padic_rooms},
    {FloorKind::Industrial,  padic_rooms},
    {FloorKind::Derelict,    padic_rooms},
    {FloorKind::Padic,       padic_rooms},
    {FloorKind::Blame,       blame_rooms},
    {FloorKind::Khrushi,     khrushi_rooms},
};
GIGA_TABLE_BY_ENUM(kRoomDeclarers, &FloorRoomsRow::kind, FloorKind::Count);

// ПРОЁМЫ МОДУЛЯ — та же строка данных, что комнаты: чистая функция
// (number, seed), перечисляющая клетки, в которые модуль пробил дверные
// отверстия ([door.h] — полотно навешивает door_declare).
//
// НОЛЬ ТОЖЕ ОБЪЯВЛЯЕТ МОДУЛЬ. Здесь стояла ветка
// `if (spec.kind == Blame || spec.kind == Khrushi) return 0;` — знание о двух
// конкретных модулях в общем коде, с их причинами, записанными здесь. Причина
// — свойство модуля, значит и ноль, и причина уехали в его файл
// (`blame_doorways`, `khrushi_doorways`); когда у хрущей появятся подъездные и
// квартирные двери, наполнится ТЕЛО функции модуля, а эта таблица не
// шевельнётся. Строк `nullptr` здесь намеренно нет (в отличие от
// kAntourageExtras, где null = «обвеса сверх общего бейка нет»): «проёмов
// нет» — ответ модуля, а не отсутствие ответа.
constexpr FloorDoorwaysRow kDoorwayEnumerators[] = {
    {FloorKind::Residential, padic_doorways},
    {FloorKind::Commercial,  padic_doorways},
    {FloorKind::Industrial,  padic_doorways},
    {FloorKind::Derelict,    padic_doorways},
    {FloorKind::Padic,       padic_doorways},
    {FloorKind::Blame,       blame_doorways},
    {FloorKind::Khrushi,     khrushi_doorways},
};
GIGA_TABLE_BY_ENUM(kDoorwayEnumerators, &FloorDoorwaysRow::kind,
                   FloorKind::Count);

// РАССТАНОВЩИКИ СОДЕРЖИМОГО (контракт — в шапке floor_gen.h): проп,
// интерактор и — когда появится первый вызывающий — моб ПО КООРДИНАТАМ
// МОДУЛЯ, после объявления комнат и с ними на руках.
//
// Здесь родилась не таблица, а ЗАМЕНА ДВУМ ВЕТКАМ: в `seed_floor_props`
// (app/main.cpp) стояло
//     if (kind_for_floor(floorNumber) == FloorKind::Padic)   seed_padic_props(…);
//     if (kind_for_floor(floorNumber) == FloorKind::Khrushi) seed_khrushi_props(…);
// — знание о двух конкретных модулях в общем коде, прямо запрещённое CANON
// S11, и вдобавок единственная дверь модуля к рождению вещей была ею же и
// закрыта для третьего модуля: блейму пришлось бы дописывать ТРЕТЬЮ ветку в
// app.
//
// Строк `nullptr` здесь намеренно нет (как у kDoorwayEnumerators и в отличие
// от kAntourageExtras): «я ничего не ставлю» — это ОТВЕТ модуля, который он
// даёт из своего файла и со своей причиной, а не отсутствие ответа у
// движка. Блейм отвечает нулём в blame_module.cpp.
constexpr FloorPlaceRow kContentPlacers[] = {
    {FloorKind::Residential, padic_place},   // padic геометрия — её расстановка
    {FloorKind::Commercial,  padic_place},
    {FloorKind::Industrial,  padic_place},
    {FloorKind::Derelict,    padic_place},
    {FloorKind::Padic,       padic_place},
    {FloorKind::Blame,       blame_place},
    {FloorKind::Khrushi,     khrushi_place},
};
GIGA_TABLE_BY_ENUM(kContentPlacers, &FloorPlaceRow::kind, FloorKind::Count);

// Module antourage rows: null = the kind adds nothing over the generic bake.
constexpr AntourageExtraRow kAntourageExtras[] = {
    {FloorKind::Residential, nullptr},
    {FloorKind::Commercial,  nullptr},
    {FloorKind::Industrial,  nullptr},
    {FloorKind::Derelict,    nullptr},
    {FloorKind::Padic,       nullptr},
    {FloorKind::Blame,       nullptr},
    {FloorKind::Khrushi,     khrushi_bake_antourage}, // wires between the street poles
};
GIGA_TABLE_BY_ENUM(kAntourageExtras, &AntourageExtraRow::kind, FloorKind::Count);

std::size_t kind_row(FloorKind kind) {
    const std::size_t k = static_cast<std::size_t>(kind);
    return k >= static_cast<std::size_t>(FloorKind::Count) ? 0 : k;
}

std::size_t kind_row(const FloorSpec& spec) { return kind_row(spec.kind); }

// Версии генерации модулей (S20.6 закон 4) — строка данных на kind, как
// генератор. ПОДНИМАТЬ РУКОЙ при любом изменении выхода generate_floor
// этого kind; изменение общего каркаса (stamp_lift_pillars, сид-формулы)
// поднимает ВСЕ строки. Стартуют с 1: 0 — «версии нет» у до-F снимков.
// 1 -> 2 на 2026-11-08: потолок кабины в stamp_lift_pillars (общий каркас —
// все строки разом); без поднятия фикс не доехал бы до обжитых сейвов —
// столбы едут в снимок обычными клетками, restore не перештамповывает.
constexpr ModuleVersionRow kModuleGenVersions[] = {
    // 2 -> 3 (2026-11-12): полотно двери стало СЕЧЕНИЕМ СТЕНЫ вместо полной
    // клетки. Геометрия генератора не менялась, но закрытая дверь едет в
    // снимок материей, и прежний блок 2 × 2 × 4 м новая форма при открытии
    // сняла бы не целиком. Этажи без дверей модуля (блейм, хрущи) не подняты.
    {FloorKind::Residential, 3}, // padic геометрия
    {FloorKind::Commercial,  3},
    {FloorKind::Industrial,  3},
    {FloorKind::Derelict,    3},
    {FloorKind::Padic,       3},
    {FloorKind::Blame,       2},
    {FloorKind::Khrushi,     2},
};
GIGA_TABLE_BY_ENUM(kModuleGenVersions, &ModuleVersionRow::kind, FloorKind::Count);

void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed) {
    kRuleDeclarers[kind_row(spec)].fn(world, number, spec, seed);
}

GravityRegime floor_gravity_regime(FloorKind kind) {
    return kGravityFrames[kind_row(kind)].regime;
}

std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out) {
    return kDoorwayEnumerators[kind_row(spec)].fn(number, seed, out);
}

std::uint32_t module_gen_version(FloorKind kind) {
    return kModuleGenVersions[kind_row(kind)].version;
}

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    kGenerators[kind_row(spec)].fn(world, number, spec, seed);
    // Лифтовые столбы — поверх любого модуля (вывод у stamp_lift_pillars).
    stamp_lift_pillars(world, number, spec, seed);
}

void rooms_build(FloorRooms& rooms, int number, const FloorSpec& spec,
                 unsigned seed) {
    rooms_reset(rooms);
    (void)kRoomDeclarers[kind_row(spec)].fn(number, seed, rooms);
}

void rooms_declare(FloorRooms& rooms, int number, const FloorSpec& spec,
                   unsigned seed) {
    rooms_reset(rooms);
    const std::uint32_t n = kRoomDeclarers[kind_row(spec)].fn(number, seed, rooms);
    std::size_t cells = 0;
    for (const Room& r : rooms.list) cells += r.cells;
    // Счёт всегда вслух (S11: молчаливого обрезания и молчаливого нуля нет);
    // пересечение зон и отказы — дефект объявителя, кричим отдельно.
    std::printf("[rooms] %s floor %d: %u rooms, %zu cells\n", spec.name, number,
                n, cells);
    if (rooms.overlapCells != 0 || rooms.refused != 0)
        std::printf("[rooms] WARN floor %d: overlap=%u cells, refused=%u "
                    "declarations — модуль объявил пересекающиеся или пустые "
                    "зоны\n",
                    number, rooms.overlapCells, rooms.refused);
}

LiftEntrance lift_entrance(FloorKind kind, int number, int node, unsigned seed) {
    // Storey входа — ОБЩИЙ КОНТРАКТ СТОЛБА (kFloorArrivalCoord), и это не
    // «политика модуля», как тут было написано: поездка планирует координату
    // прибытия ДО того, как узнаёт модуль назначения (`save.h kArrivalCoord`
    // летит параметром в ride_elevator), а каждый модуль утверждением в шапке
    // этого файла обязан держать там ходовую клетку. Чтобы storey называл
    // МОДУЛЬ (случайный жилой ярус, улица, машинное), поездку надо сперва
    // научить спрашивать этаж назначения — тогда здесь встанет таблица, как у
    // гравитационного фрейма. `kind` ждёт ровно этого дня.
    (void)kind;
    LiftEntrance e;
    e.h = floor_ground_z();
    // Сторона проёма — чистый хеш идентичности столба: свой на каждом этаже,
    // одинаковый в каждом прогоне (чистый хеш идентичности).
    e.side = static_cast<int>(
        hash_u32(static_cast<std::uint32_t>(seed) * 0x9E3779B9u ^
                 static_cast<std::uint32_t>(number) * 0x85EBCA6Bu ^
                 static_cast<std::uint32_t>(node) * 0x27220A95u) &
        3u);
    return e;
}

// side 0..3 -> направление проёма из центра столба.
static constexpr int kLiftSideStep[4][2] = {
    {1, 0}, {-1, 0}, {0, 1}, {0, -1}};

void stamp_lift_protection(World& world) {
    FloorMasks& fm = world.masks();
    fm.clear_all(); // слот перерабатывается — чужие маски умирают с этажом
    // Полноклеточная форма: у столба защищён весь объём. Частичные формы
    // (гермостенка тоньше клетки) — то же поле allow с другими битами.
    SubMask full;
    for (std::size_t wd = 0; wd < kSubMaskWords; ++wd)
        full.words[wd] = ~0ull;
    for (int node = 0; node < kFastHubsPerFloor; ++node) {
        std::uint8_t cx8 = 0, cy8 = 0;
        fast_hub_cell(node, cx8, cy8);
        MaskGroup g;
        g.props = kMaskShield;
        g.centre = vec3{(static_cast<float>(cx8) + 0.5f) * kCellSize,
                        (static_cast<float>(cy8) + 0.5f) * kCellSize,
                        0.5f * kWorldExtent}; // столб сквозь весь тор
        for (int z = 0; z < kMacroDim; ++z)
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx)
                    g.cells.push_back(MaskCell{
                        static_cast<std::uint32_t>(macro_index(
                            wrap_macro(cx8 + dx), wrap_macro(cy8 + dy), z)),
                        full});
        fm.groups.push_back(std::move(g));
    }
    fm.rebuild_shield_cache();
}

void stamp_lift_pillars(World& world, int number, const FloorSpec& spec,
                        unsigned seed) {
    MacroGrid& g = world.grid();
    SubField<CellType>& sm =
        world.subfields().get_or_create<CellType>(kSubMaterialName);
    // fill/clear правят тип+маску; страница суб-материалов, оставленная
    // модулем под футпринтом столба (узорные стены и т.п.), обязана умереть
    // вместе с узором — иначе тип говорит «бетон», а страница светит гипсом.
    auto restamp_page = [&](int x, int y, int z, CellType t) {
        const std::size_t ci =
            macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z));
        if (CellType* pg = sm.page(ci))
            for (int b = 0; b < kSubVoxels; ++b) pg[b] = t;
    };
    for (int node = 0; node < kFastHubsPerFloor; ++node) {
        std::uint8_t cx8 = 0, cy8 = 0;
        fast_hub_cell(node, cx8, cy8);
        const int cx = cx8, cy = cy8;
        // Кольцо стен + шахта — через ВСЕ z: столб замкнут на торе.
        for (int z = 0; z < kMacroDim; ++z)
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int x = wrap_macro(cx + dx);
                    const int y = wrap_macro(cy + dy);
                    if (dx == 0 && dy == 0) {
                        g.clear_cell(x, y, z);
                        restamp_page(x, y, z, kCellAir);
                    } else {
                        g.fill_cell(x, y, z, kMatConcrete);
                        restamp_page(x, y, z, kMatConcrete);
                    }
                }
        const LiftEntrance e = lift_entrance(spec.kind, number, node, seed);
        // Проём — walkable клетка кольца на storey входа; пол кабины — под
        // центром шахты, чтобы вошедший стоял, а не падал в колодец.
        const int ex = wrap_macro(cx + kLiftSideStep[e.side][0]);
        const int ey = wrap_macro(cy + kLiftSideStep[e.side][1]);
        g.clear_cell(ex, ey, e.h);
        restamp_page(ex, ey, e.h, kCellAir);
        g.fill_cell(cx, cy, wrap_macro(e.h - 1), kMatConcrete);
        restamp_page(cx, cy, e.h - 1, kMatConcrete);
        // ПОТОЛОК КАБИНЫ (владелец 2026-11-08: «потолок кабины пропал»).
        // Пропадать было нечему — его не строил никто: центр столба чистился
        // через все z, и кабина была ДНОМ открытого колодца в 256 м. Кабина —
        // замкнутая клетка-инвариант (рамка владельца: шахты одинаковы и
        // неразрушимы), значит коробка закрывается здесь же, где кладутся её
        // пол и проём: одна плита над storey входа. Остальной колодец выше
        // плиты остаётся полым — он запечатан и игроку не принадлежит.
        g.fill_cell(cx, cy, wrap_macro(e.h + 1), kMatConcrete);
        restamp_page(cx, cy, e.h + 1, kMatConcrete);
    }
}

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed) {
    kRuleAppliers[kind_row(spec)].fn(world, number, spec, seed);
}

std::uint32_t floor_place_content(const FloorPlaceCtx& ctx) {
    // Вид берётся ИЗ КОНТЕКСТА, а не выводится здесь из номера: номер этажа
    // модуль может ЗАЯВИТЬ (`FloorCatalog::claim` — падик держит 4, хрущи 6),
    // и `floor_spec_for(4)` отдал бы Industrial по шаблонной цепочке, то есть
    // расстановка уехала бы в чужой модуль на обоих заявленных этажах.
    // ВРЕМЯ — ЧАСТЬ ОТВЕТА, а не украшение: плотность расстановки это политика
    // модуля (владелец: «сколько и где хочет»), и единственный способ судить о
    // ней — видеть цену рядом со счётом. Прибытие на этаж печатает так весь
    // свой конвейер ([entry] light rebuild / mirror classify / …).
    const auto t0 = std::chrono::steady_clock::now();
    const std::uint32_t n = kContentPlacers[kind_row(ctx.spec)].fn(ctx);
    const float ms = std::chrono::duration<float, std::milli>(
                         std::chrono::steady_clock::now() - t0)
                         .count();
    // Счёт вслух (S11: молчаливого нуля нет) — и ноль тоже ответ: он означает
    // «модуль ничего не ставит» или «назвал клетки, где нет опоры».
    std::printf("[content] %s floor %d: %u вещей поставил модуль, %.0f ms\n",
                ctx.spec.name, ctx.number, n, ms);
    return n;
}

void floor_antourage_extra(const World& world, int number,
                           const FloorSpec& spec, unsigned seed,
                           AntourageBake& out) {
    if (AntourageExtraFunc fn = kAntourageExtras[kind_row(spec)].fn)
        fn(world, number, seed, out);
}

} // namespace giga::game
