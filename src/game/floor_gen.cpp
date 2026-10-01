#include "core/rng.h"
#include "game/floor_gen.h"

#include "core/table_guard.h"

#include <bit>
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



GravityRegime floor_gravity_regime() { return kPadicGravity; }

int floor_ground_coord() { return kPadicGroundCoord; }

bool floor_standable(const World& w, int x, int y, int z) {
    const MacroGrid& g = w.grid();
    if (g.cell(x, y, z) != kCellAir) return false;
    const CellStep d = regime_down(w.gravity().regime);
    if (d.x == 0 && d.y == 0 && d.z == 0) return true; // Zero-g: any air cell
    return g.cell(x + d.x, y + d.y, z + d.z) != kCellAir;
}

void floor_cell(const World& w, int u, int v, int h, int& x, int& y, int& z) {
    const CellStep d = regime_down(w.gravity().regime);
    if (d.x != 0) {
        x = h;
        y = u;
        z = v;
    } else if (d.y != 0) {
        x = u;
        y = h;
        z = v;
    } else { // +-Z, and the Zero fallback where h is just a third coordinate
        x = u;
        y = v;
        z = h;
    }
}

void floor_ground_cell(const World& w, int u, int v, int& x, int& y, int& z) {
    floor_cell(w, u, v, floor_ground_coord(), x, y, z);
}

int floor_ground_z() { return kPadicGroundCoord; }
// The elevator/load arrival coordinate must BE the module's ground storey, or
// every ride lands inside the ceiling sandwich and leans on the placement
// resolver. save.h cannot include the module, so the pin lives here.
static_assert(kPadicGroundCoord == 3,
              "keep save.h kArrivalCoord in step with the module");


std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out) {
    // Blame punches raw openings, never doorable ones — its labyrinth mouths
    // onto the abyss have no jambs for a leaf, so it contributes zero rows.
    // Khrushi contributes zero until its blocks grow doorable entrances
    // (module increment: подъезды + квартирные двери).
    if (spec.kind == FloorKind::Blame || spec.kind == FloorKind::Khrushi)
        return 0;
    return padic_doorways(number, seed, out);
}

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
using AntourageExtraFunc = void (*)(const World&, int, unsigned, AntourageBake&);

// ---- КОНВЕЙЕР МОДУЛЯ: ШЕСТЬ ТАБЛИЦ, И У КАЖДОЙ СТРОКИ ТЕПЕРЬ ЕСТЬ КЛЮЧ ----
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
struct AntourageExtraRow { FloorKind kind; AntourageExtraFunc fn; };
struct ModuleVersionRow { FloorKind kind; std::uint32_t version; };

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

std::size_t kind_row(const FloorSpec& spec) {
    const std::size_t k = static_cast<std::size_t>(spec.kind);
    return k >= static_cast<std::size_t>(FloorKind::Count) ? 0 : k;
}

// Версии генерации модулей (S20.6 закон 4) — строка данных на kind, как
// генератор. ПОДНИМАТЬ РУКОЙ при любом изменении выхода generate_floor
// этого kind; изменение общего каркаса (stamp_lift_pillars, сид-формулы)
// поднимает ВСЕ строки. Стартуют с 1: 0 — «версии нет» у до-F снимков.
constexpr ModuleVersionRow kModuleGenVersions[] = {
    {FloorKind::Residential, 1}, // padic геометрия
    {FloorKind::Commercial,  1},
    {FloorKind::Industrial,  1},
    {FloorKind::Derelict,    1},
    {FloorKind::Padic,       1},
    {FloorKind::Blame,       1},
    {FloorKind::Khrushi,     1},
};
GIGA_TABLE_BY_ENUM(kModuleGenVersions, &ModuleVersionRow::kind, FloorKind::Count);

void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed) {
    kRuleDeclarers[kind_row(spec)].fn(world, number, spec, seed);
}

std::uint32_t module_gen_version(FloorKind kind) {
    const std::size_t k = static_cast<std::size_t>(kind);
    return kModuleGenVersions[k >= static_cast<std::size_t>(FloorKind::Count)
                                  ? 0
                                  : k]
        .version;
}

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    kGenerators[kind_row(spec)].fn(world, number, spec, seed);
    // Лифтовые столбы — поверх любого модуля (вывод у stamp_lift_pillars).
    stamp_lift_pillars(world, number, spec, seed);
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
    // Storey входа называет МОДУЛЬ (S10). Сегодня у всех трёх модулей одна
    // политика — ходовой ground (walkable-клетка прибытия, floor_ground_z);
    // другая политика (случайный жилой storey, улица, машинное) = новая
    // строка здесь при посадке лобби инкремента 6, не ветка у потребителей.
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
    }
}

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed) {
    kRuleAppliers[kind_row(spec)].fn(world, number, spec, seed);
}

void floor_antourage_extra(const World& world, int number,
                           const FloorSpec& spec, unsigned seed,
                           AntourageBake& out) {
    if (AntourageExtraFunc fn = kAntourageExtras[kind_row(spec)].fn)
        fn(world, number, seed, out);
}

} // namespace giga::game
