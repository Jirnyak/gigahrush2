#include "core/rng.h"
#include "game/floor_gen.h"

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

constexpr FloorGeneratorFunc kGenerators[] = {
    generate_padic_floor,   // Residential — themed by content tables, padic geometry
    generate_padic_floor,   // Commercial
    generate_padic_floor,   // Industrial
    generate_padic_floor,   // Derelict
    generate_padic_floor,   // Padic
    generate_blame_floor,   // Blame — the megastructure module's own geometry
    generate_khrushi_floor, // Khrushi — the open microdistrict's own geometry
};
static_assert(sizeof(kGenerators) / sizeof(kGenerators[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "generator table must have exactly one row per FloorKind");

constexpr FloorGeneratorFunc kRuleDeclarers[] = {
    padic_declare_rules, padic_declare_rules,   padic_declare_rules,
    padic_declare_rules, padic_declare_rules,   blame_declare_rules,
    khrushi_declare_rules,
};
static_assert(sizeof(kRuleDeclarers) / sizeof(kRuleDeclarers[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "rule-declarer table must have exactly one row per FloorKind");

constexpr FloorGeneratorFunc kRuleAppliers[] = {
    padic_apply_rules, padic_apply_rules,   padic_apply_rules,
    padic_apply_rules, padic_apply_rules,   blame_apply_rules,
    khrushi_apply_rules,
};

// Объявители комнат (rooms-object C, S12.1: комнаты объявляет МОДУЛЬ) —
// та же строка данных на kind, что генератор и законы. Чистые функции
// (number, seed), перештамповка на каждом входе (закон масок S18).
using FloorRoomsFunc = std::uint32_t (*)(int, unsigned, FloorRooms&);
constexpr FloorRoomsFunc kRoomDeclarers[] = {
    padic_rooms, padic_rooms,   padic_rooms,
    padic_rooms, padic_rooms,   blame_rooms,
    khrushi_rooms,
};
static_assert(sizeof(kRoomDeclarers) / sizeof(kRoomDeclarers[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "room-declarer table must have exactly one row per FloorKind");
static_assert(sizeof(kRuleAppliers) / sizeof(kRuleAppliers[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "rule-applier table must have exactly one row per FloorKind");

// Module antourage rows: null = the kind adds nothing over the generic bake.
using AntourageExtraFunc = void (*)(const World&, int, unsigned,
                                    AntourageBake&);
constexpr AntourageExtraFunc kAntourageExtras[] = {
    nullptr, nullptr, nullptr,
    nullptr, nullptr, nullptr,
    khrushi_bake_antourage, // Khrushi — wires between the street poles
};
static_assert(sizeof(kAntourageExtras) / sizeof(kAntourageExtras[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "antourage-extra table must have exactly one row per FloorKind");

std::size_t kind_row(const FloorSpec& spec) {
    const std::size_t k = static_cast<std::size_t>(spec.kind);
    return k >= static_cast<std::size_t>(FloorKind::Count) ? 0 : k;
}

void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed) {
    kRuleDeclarers[kind_row(spec)](world, number, spec, seed);
}

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    kGenerators[kind_row(spec)](world, number, spec, seed);
    // Лифтовые столбы — поверх любого модуля (вывод у stamp_lift_pillars).
    stamp_lift_pillars(world, number, spec, seed);
}

void rooms_declare(FloorRooms& rooms, int number, const FloorSpec& spec,
                   unsigned seed) {
    rooms_reset(rooms);
    const std::uint32_t n = kRoomDeclarers[kind_row(spec)](number, seed, rooms);
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
    kRuleAppliers[kind_row(spec)](world, number, spec, seed);
}

void floor_antourage_extra(const World& world, int number,
                           const FloorSpec& spec, unsigned seed,
                           AntourageBake& out) {
    if (AntourageExtraFunc fn = kAntourageExtras[kind_row(spec)])
        fn(world, number, seed, out);
}

} // namespace giga::game
