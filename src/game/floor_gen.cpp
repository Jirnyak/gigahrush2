#include "core/rng.h"
#include "game/floor_gen.h"

#include <bit>
#include <cstddef>
#include <cstdint>

#include "game/floors/blame/blame.h" // the megastructure module (kind Blame)
#include "game/floors/padic/padic.h" // the module every OTHER kind dispatches to
#include "game/mob_table.h"          // RoomBit — rooms named in the shared taxonomy
#include "world/macro_grid.h"        // MacroGrid — the frame helpers query cells
#include "world/world.h"             // World — live gravity regime + grid

namespace giga::game {

namespace {


// --- room taxonomy ----------------------------------------------------------
// One weighted row per FloorKind: which RoomBits this kind's lattice produces and in
// what proportion. The theming lives here, never as a branch in floor_room_mask.
// GEOMETRY is a module's business ([floors.md] — the folder is the module); the
// kind rows below are pure CONTENT theming, feeding the per-room item/mob filters.
//
// The weights are NOT free, and the constraint is measured rather than aesthetic. The
// filter these bits drive returns weight 0 on a mismatch, so a room whose bit matches
// little in a table generates little — and each bit's real pool is small. Measured on
// data/mobs.csv against the six habitat anchors, average heads per pack by room bit at
// anchor Z0: storage 4.72, common 4.21, corridor 3.74, production 1.42, bathroom 1.22,
// smoking 1.00, against 3.84 for the unfiltered roster. So a Derelict mix leaning on
// bathrooms would quietly shrink every pack on the floor by a third. Each row below
// therefore leans on the bits its fiction shares with the content tables:
//
//   Residential  living/kitchen/bathroom/common/corridor/storage — an apartment
//   Commercial   office/common/storage/hq/smoking/medical        — a ministry floor
//   Industrial   production/storage/corridor/smoking             — a works
//   Derelict     the residential warren gone to storage and rot
struct RoomMix { RoomBit bit; std::uint8_t w; };

constexpr RoomMix kRoomsResidential[] = {
    {RoomBit::Living, 30},   {RoomBit::Kitchen, 16}, {RoomBit::Bathroom, 12},
    {RoomBit::Common, 14},   {RoomBit::Corridor, 10}, {RoomBit::Storage, 18},
};
constexpr RoomMix kRoomsCommercial[] = {
    {RoomBit::Office, 34},   {RoomBit::Common, 16},  {RoomBit::Storage, 16},
    {RoomBit::Hq, 10},       {RoomBit::Smoking, 8},  {RoomBit::Medical, 16},
};
constexpr RoomMix kRoomsIndustrial[] = {
    {RoomBit::Production, 44}, {RoomBit::Storage, 26}, {RoomBit::Corridor, 16},
    {RoomBit::Smoking, 14},
};
constexpr RoomMix kRoomsDerelict[] = {
    {RoomBit::Storage, 30},  {RoomBit::Corridor, 26}, {RoomBit::Common, 24},
    {RoomBit::Production, 14}, {RoomBit::Bathroom, 6},
};
// Four bits, not two: the taxonomy invariant is that every kind's authored bits
// all appear on a floor, with 4 as the floor — a kind narrower than that starves
// the per-room item/mob filters of variety.
constexpr RoomMix kRoomsPadic[] = {
    {RoomBit::Corridor, 34}, {RoomBit::Storage, 30},
    {RoomBit::Common, 20},   {RoomBit::Production, 16},
};
// The megastructure: dead industry gone to scavenger caches — corridors and
// stores lean heavier than padic, production lighter (the machines are husks).
constexpr RoomMix kRoomsBlame[] = {
    {RoomBit::Corridor, 30}, {RoomBit::Storage, 28},
    {RoomBit::Production, 22}, {RoomBit::Common, 20},
};

struct RoomMixRow { const RoomMix* tab; std::uint8_t n; };

template <std::size_t N>
constexpr RoomMixRow room_row(const RoomMix (&a)[N]) {
    return {a, static_cast<std::uint8_t>(N)};
}

constexpr RoomMixRow kRoomMix[] = {
    room_row(kRoomsResidential), room_row(kRoomsCommercial),
    room_row(kRoomsIndustrial),  room_row(kRoomsDerelict),
    room_row(kRoomsPadic),       room_row(kRoomsBlame),
};
static_assert(sizeof(kRoomMix) / sizeof(kRoomMix[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "room-mix table must have exactly one row per FloorKind");
static_assert(static_cast<std::uint16_t>(RoomBit::Hq) == (1u << 10),
              "kFloorRoomBits assumes Hq is the highest RoomBit");

// The X/Y room-lattice pitch every consumer keys taxonomy lookups on. One value
// for every kind because every kind currently builds the ONE registered module's
// geometry (padic); when a second geometry module lands, this becomes that
// module's own export.
constexpr int kRoomStride = 4;

} // namespace

int floor_room_stride(FloorKind /*kind*/) { return kRoomStride; }

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

int floor_room_bit_index(std::uint16_t mask) {
    if (mask == 0) return -1;
    const int i = std::countr_zero(mask);
    return i < static_cast<int>(kFloorRoomBits) ? i : -1;
}

std::uint16_t floor_room_mask(FloorKind kind, int number, int rx, int ry) {
    std::size_t k = static_cast<std::size_t>(kind);
    if (k >= static_cast<std::size_t>(FloorKind::Count)) k = 0;
    const RoomMixRow& row = kRoomMix[k];

    // A pure hash of the room's identity, with each input on its own odd multiplier so
    // a floor's rooms decorrelate from its neighbour's at the same (rx, ry).
    const std::uint32_t h =
        hash_u32(static_cast<std::uint32_t>(k) * 0x9E3779B9u ^
              static_cast<std::uint32_t>(number) * 0x85EBCA6Bu ^
              static_cast<std::uint32_t>(rx) * 0x27220A95u ^
              static_cast<std::uint32_t>(ry) * 0x165667B1u);

    std::uint32_t total = 0;
    for (std::uint8_t i = 0; i < row.n; ++i) total += row.tab[i].w;
    std::uint32_t pick = total ? h % total : 0u;
    for (std::uint8_t i = 0; i < row.n; ++i) {
        if (pick < row.tab[i].w) return static_cast<std::uint16_t>(row.tab[i].bit);
        pick -= row.tab[i].w;
    }
    return static_cast<std::uint16_t>(row.tab[0].bit);
}

std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out) {
    // Blame punches raw openings, never doorable ones — its labyrinth mouths
    // onto the abyss have no jambs for a leaf, so it contributes zero rows.
    if (spec.kind == FloorKind::Blame) return 0;
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
};
static_assert(sizeof(kGenerators) / sizeof(kGenerators[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "generator table must have exactly one row per FloorKind");

constexpr FloorGeneratorFunc kRuleDeclarers[] = {
    padic_declare_rules, padic_declare_rules, padic_declare_rules,
    padic_declare_rules, padic_declare_rules, blame_declare_rules,
};
static_assert(sizeof(kRuleDeclarers) / sizeof(kRuleDeclarers[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "rule-declarer table must have exactly one row per FloorKind");

constexpr FloorGeneratorFunc kRuleAppliers[] = {
    padic_apply_rules, padic_apply_rules, padic_apply_rules,
    padic_apply_rules, padic_apply_rules, blame_apply_rules,
};
static_assert(sizeof(kRuleAppliers) / sizeof(kRuleAppliers[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "rule-applier table must have exactly one row per FloorKind");

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
}

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed) {
    kRuleAppliers[kind_row(spec)](world, number, spec, seed);
}

} // namespace giga::game
