// Game-layer unit tests. Same tiny CHECK harness as world_test; links giga_game
// so it exercises the macro entity systems headless (no SDL/Vulkan).
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>

#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/combat.h"
#include "game/embody.h"
#include "game/elevator.h"
#include "game/event_bus.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/extraction.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/floor_spec.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/item_table.h"
#include "game/loot.h"
#include "game/weapon_table.h"
#include "game/mob_spawn.h"
#include "game/floor_stream.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include "game/wander.h"
#include "game/population.h"

#include "sim/physics.h"
#include "world/lattice.h"
#include "world/materials.h"
#include "world/level_stack.h"
#include "world/nav.h"
#include "world/world.h"

using namespace giga;
using namespace giga::game;

namespace {
int g_fails = 0;
int g_checks = 0;
}

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__,       \
                         #cond);                                               \
        }                                                                      \
    } while (0)

static void test_inventory() {
    // Compile-time layout contract: a static_assert, not a CHECK. It is a fact
    // about the type, so it belongs to the build, not to a test run.
    static_assert(kInvSlots == 64, "inventory is an 8x8 grid ([items.md])");

    Inventory inv;
    CHECK(inv.empty());
    CHECK(inv.first_free() == 0);

    inv.at(3, 2).item = 7;
    inv.at(3, 2).count = 5;
    CHECK(!inv.empty());
    CHECK(inv.slots[2 * kInvCols + 3].item == 7);
    CHECK(inv.first_free() == 0); // slot 0 still empty

    inv.slots[0].item = 1;
    CHECK(inv.first_free() == 1);

    inv.clear();
    CHECK(inv.empty());

    // Full inventory has no free slot.
    for (auto& s : inv.slots) s.item = 99;
    CHECK(inv.first_free() == -1);
}

static void test_pool_basics() {
    // 2^20 slots is a load-bearing constant (id masking, verbatim serialization
    // with the world) — assert it at build time.
    static_assert(kNpcPoolSize == 1048576u, "pool is 2^20 slots ([npcs.md])");

    NpcPool pool;
    pool.init();
    CHECK(pool.capacity() == kNpcPoolSize);
    CHECK(pool.count() == 0);
    CHECK(pool.reserve_remaining() == kNpcPoolSize);

    NpcId a = pool.spawn();
    NpcId b = pool.spawn();
    CHECK(a == 0);            // id is the slot index
    CHECK(b == 1);
    CHECK(pool.count() == 2);
    CHECK(pool.valid(a) && pool.valid(b));
    CHECK(pool.alive(a) && pool.alive(b));
    CHECK(!pool.embodied(a)); // spawned NPCs start de-embodied
    CHECK(!pool.valid(2));    // beyond high-water mark

    // Name is inline fixed-width, truncated + null-terminated.
    pool.set_name(a, "Ivan", "Petrov");
    CHECK(std::strcmp(pool.name(a).data(), "Ivan") == 0);
    CHECK(std::strcmp(pool.surname(a).data(), "Petrov") == 0);

    // Fields are per-id SoA rows.
    pool.hp(a) = 30;
    pool.max_hp(a) = 30;
    pool.faction(a) = 4;
    pool.floor(a) = 12;
    CHECK(pool.hp(a) == 30 && pool.faction(a) == 4 && pool.floor(a) == 12);

    // Inventory lives inline in the row.
    pool.inventory(a).at(0, 0).item = 42;
    CHECK(pool.inventory(a).at(0, 0).item == 42);
    CHECK(pool.inventory(b).empty()); // rows are independent
}

static void test_pool_death_keeps_slot() {
    NpcPool pool;
    pool.init();
    NpcId a = pool.spawn();
    NpcId b = pool.spawn();
    pool.set_embodied(a, true);
    CHECK(pool.embodied(a));

    pool.kill(a);
    CHECK(pool.valid(a));   // id still valid — the dead stay in the table
    CHECK(!pool.alive(a));  // but no longer alive
    CHECK(!pool.embodied(a)); // kill also de-embodies

    // The next spawn bumps the tail; it never reuses the dead slot.
    NpcId c = pool.spawn();
    CHECK(c == 2);
    CHECK(c != a);
    CHECK(pool.count() == 3);
    CHECK(pool.alive(b) && pool.alive(c));
}

static void test_relationships() {
    NpcPool pool;
    pool.init();
    NpcId a = pool.spawn();
    auto& rel = pool.relations(a);
    CHECK(rel.size() == static_cast<std::size_t>(kRelSlots));
    CHECK(rel[0].target == kInvalidNpc); // zeroed = no relation
    rel[0].target = 5;
    rel[0].affinity = -100;
    CHECK(pool.relations(a)[0].target == 5);
    CHECK(pool.relations(a)[0].affinity == -100);
}

static void test_design_flag() {
    NpcPool pool;
    pool.init();
    NpcId a = pool.spawn(); // procedural by default
    CHECK(!(pool.flags(a) & NpcDesign));
    pool.set_design(a, true);
    CHECK(pool.flags(a) & NpcDesign);
    CHECK(pool.alive(a)); // setting design doesn't disturb alive bit
}

static void test_event_bus_transient() {
    EventBus bus;
    bus.init();
    CHECK(bus.empty());
    CHECK(bus.dropped() == 0);
    CHECK(!bus.logging());

    CHECK(bus.publish(EventType::NpcSpawned, 7));
    CHECK(bus.publish(EventType::NpcDied, 7, 0, 0, 42));
    CHECK(bus.size() == 2);
    CHECK(bus.events()[0].type == EventType::NpcSpawned);
    CHECK(bus.events()[0].a == 7);
    CHECK(bus.events()[1].type == EventType::NpcDied);
    CHECK(bus.events()[1].tick == 42);

    // Events are transient: clear wipes the batch but keeps the ring allocated.
    bus.clear();
    CHECK(bus.empty());
    CHECK(bus.publish(EventType::FloorEntered, 3));
    CHECK(bus.size() == 1); // fresh cycle, no leftovers
}

static void test_event_bus_overflow() {
    EventBus bus;
    bus.init();
    for (std::size_t i = 0; i < EventBus::kCapacity; ++i)
        CHECK(bus.publish(EventType::NpcMigrated, static_cast<std::uint32_t>(i)));
    CHECK(bus.size() == EventBus::kCapacity);

    // Ring is full: further publishes are dropped and counted, never grown.
    CHECK(!bus.publish(EventType::NpcMigrated, 9999));
    CHECK(!bus.publish(EventType::NpcMigrated, 10000));
    CHECK(bus.size() == EventBus::kCapacity);
    CHECK(bus.dropped() == 2);
}

static void test_event_bus_log() {
    EventBus bus;
    bus.init();
    bus.set_logging(true);
    CHECK(bus.logging());

    bus.publish(EventType::ItemTransferred, 1, 2, 55);
    bus.clear(); // transient batch gone...
    bus.publish(EventType::ItemTransferred, 3, 4, 66);

    CHECK(bus.empty() == false);
    CHECK(bus.log().size() == 2); // ...but the log kept both across clear()
    CHECK(bus.log()[0].c == 55);
    CHECK(bus.log()[1].c == 66);

    bus.clear_log();
    CHECK(bus.log().empty());
}

static void test_attribute_block() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    // The 8-slot generic block round-trips; nothing is a named str/agi/int.
    for (int i = 0; i < kAttrSlots; ++i)
        pool.attrs(id)[static_cast<std::size_t>(i)] =
            static_cast<std::uint8_t>(10 + i);
    for (int i = 0; i < kAttrSlots; ++i)
        CHECK(pool.attrs(id)[static_cast<std::size_t>(i)] == 10 + i);

    pool.age(id) = 30;
    pool.sex(id) = SexFemale;
    pool.height_mm(id) = 1720;
    pool.level(id) = 7;
    CHECK(pool.age(id) == 30);
    CHECK(pool.sex(id) == SexFemale);
    CHECK(pool.height_mm(id) == 1720);
    CHECK(pool.level(id) == 7);
}

static void test_height_maps_to_body() {
    // Stature drives collider half-height and eye height monotonically: a taller
    // record embodies a taller body and (as player) sees from higher up.
    CHECK(body_half_height(2000) > body_half_height(1200));
    CHECK(body_eye_height(2000) > body_eye_height(1200));
    // A blank (zeroed) record falls back to a sane adult stature, not zero.
    CHECK(body_half_height(0) == body_half_height(kDefaultHeightMm));
    // Half-height is ~half the metric height.
    CHECK(body_half_height(1800) > 0.85f && body_half_height(1800) < 0.95f);
}

static void test_embody_and_foldback() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    pool.floor(id) = 3;
    pool.cx(id) = 20; pool.cy(id) = 40; pool.cz(id) = 13;
    pool.height_mm(id) = 1600;

    Registry reg;
    Entity e = embody(reg, pool, id, /*layer=*/0);
    CHECK(e != entt::null);
    CHECK(pool.embodied(id));
    CHECK(!pool.is_player(id)); // plain embodiment is not the player
    CHECK(reg.get<game::NpcRef>(e).id == id);
    // Collider height came from the record's stature.
    CHECK(reg.get<AABB>(e).half.z == body_half_height(1600));
    // Placed at the macro cell centre (2 m cells).
    CHECK(reg.get<Transform>(e).pos.x > 40.0f && reg.get<Transform>(e).pos.x < 42.0f);

    // Move the live entity, then fold back: the record's cell follows, and it is
    // de-embodied. hp/inventory were never duplicated onto the entity.
    reg.get<Transform>(e).pos.x = 100.0f; // -> cell 50
    fold_back(reg, pool, id, e);
    CHECK(!pool.embodied(id));
    CHECK(pool.cx(id) == 50);
    CHECK(!reg.valid(e));
}

static void test_player_is_a_record() {
    NpcPool pool;
    pool.init();
    NpcId shortId = pool.spawn();
    NpcId tallId = pool.spawn();
    pool.height_mm(shortId) = 1200;
    pool.height_mm(tallId) = 2000;

    Registry reg;
    Entity shortP = embody_as_player(reg, pool, shortId, 0);
    CHECK(pool.is_player(shortId));
    CHECK(reg.all_of<CameraTag>(shortP));
    CHECK(reg.all_of<Controller>(shortP));
    float shortEye = reg.get<CameraTag>(shortP).eyeOffset.z;

    // Switch bodies: fold the short one back, embody the tall one as player. The
    // camera eye height must jump to the taller stature (the body-swap rule).
    fold_back(reg, pool, shortId, shortP);
    CHECK(!pool.is_player(shortId));
    Entity tallP = embody_as_player(reg, pool, tallId, 0);
    float tallEye = reg.get<CameraTag>(tallP).eyeOffset.z;
    CHECK(tallEye > shortEye);

    // The player record dies exactly like any NPC — no privileged path.
    pool.kill(tallId);
    CHECK(!pool.alive(tallId));
    CHECK(!pool.embodied(tallId)); // kill() clears embodiment too
}

static void test_population_seed() {
    NpcPool pool;
    pool.init();
    NpcId playerId = seed_floor_population(pool, /*floor=*/5, /*n=*/32, /*seed=*/1u);
    CHECK(playerId != kInvalidNpc);
    CHECK(pool.count() == 32);
    // Every seeded record lives on the floor, is alive, has a stature and an age.
    for (NpcId id = 0; id < pool.count(); ++id) {
        CHECK(pool.alive(id));
        CHECK(pool.floor(id) == 5);
        CHECK(pool.age(id) >= 1 && pool.age(id) <= 100);
        CHECK(pool.height_mm(id) > 0);
        // Records stand on the module's internal ground storey (one above slab),
        // independent of the floor label — each floor is its own 128^3 world.
        CHECK(pool.cz(id) == 1);
    }
    // Seeding alone does not make anyone the player; embodiment does.
    CHECK(!pool.is_player(playerId));

    // Height-for-age is monotonic through childhood into adulthood.
    CHECK(height_for_age(30, 0) > height_for_age(5, 0));
}

static void test_floor_spec() {
    // Every catalog row reports its own kind and has a sane age window/label.
    for (int k = 0; k < static_cast<int>(FloorKind::Count); ++k) {
        const FloorSpec& s = floor_spec(static_cast<FloorKind>(k));
        CHECK(s.kind == static_cast<FloorKind>(k));
        CHECK(s.name != nullptr);
        CHECK(s.minAge >= 1 && s.maxAge >= s.minAge);
    }

    // The vision, encoded as data: residential is dense + safe, derelict is
    // sparse + dangerous.
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    const FloorSpec& der = floor_spec(FloorKind::Derelict);
    CHECK(res.population > der.population);
    CHECK(res.hostility < der.hostility);

    // floor_spec_for is a pure, in-range mapping from floor number to rule-set.
    CHECK(floor_spec_for(0).kind == FloorKind::Residential);
    CHECK(floor_spec_for(6).kind == FloorKind::Derelict); // 6 % 7 == 6
    CHECK(&floor_spec_for(5) == &floor_spec_for(5));       // deterministic
    for (std::uint16_t f = 0; f < 64; ++f)
        CHECK(static_cast<int>(floor_spec_for(f).kind) <
              static_cast<int>(FloorKind::Count));
}

static void test_seed_from_spec() {
    // A monoculture spec: everyone faction 0, ages within [20,40].
    NpcPool pool;
    pool.init();
    FloorSpec mono{FloorKind::Residential, "mono", 100u,
                   {1, 0, 0, 0}, 0.0f, 20, 40};
    NpcId cand = seed_floor_from_spec(pool, /*floor=*/3, mono, /*seed=*/9u);
    CHECK(cand != kInvalidNpc);
    CHECK(pool.count() == 100u); // seeded exactly spec.population records

    for (NpcId id = 0; id < pool.count(); ++id) {
        CHECK(pool.alive(id));
        CHECK(pool.floor(id) == 3);
        CHECK(pool.cz(id) == 1);                         // internal ground storey
        CHECK(pool.age(id) >= 20 && pool.age(id) <= 40); // spec age window honored
        CHECK(pool.height_mm(id) > 0);
        CHECK(pool.faction(id) == 0);                    // mix {1,0,0,0}
        // Never seeded inside the wall lattice (walls sit on local coord 0).
        CHECK((pool.cx(id) % 16) != 0 && (pool.cy(id) % 16) != 0);
    }

    // Density follows the catalog: residential seeds a bigger crowd than derelict,
    // and each matches its spec's population exactly (reserve is far larger).
    NpcPool dense;
    dense.init();
    NpcPool sparse;
    sparse.init();
    seed_floor_from_spec(dense, 0, floor_spec(FloorKind::Residential), 1u);
    seed_floor_from_spec(sparse, 0, floor_spec(FloorKind::Derelict), 1u);
    CHECK(dense.count() > sparse.count());
    CHECK(dense.count() == floor_spec(FloorKind::Residential).population);
    CHECK(sparse.count() == floor_spec(FloorKind::Derelict).population);
}

// The floors.md indirection: floor number -> ModuleId -> LayerId, with the label
// and the residency mutable independently. This is the backbone elevators and
// streaming both resolve through.
static void test_floor_registry() {
    FloorRegistry reg;

    // Fresh registry: nothing assigned, nothing resident.
    CHECK(reg.module_at(0) == kInvalidModule);
    CHECK(reg.layer_at(0) == kInvalidLayer);
    CHECK(!reg.loaded(0));
    CHECK(reg.number_of(3) == FloorRegistry::kNoFloor);

    // Range guards: sparse over [-127, 127], W does not wrap.
    CHECK(FloorRegistry::valid_number(0));
    CHECK(FloorRegistry::valid_number(-127));
    CHECK(FloorRegistry::valid_number(127));
    CHECK(!FloorRegistry::valid_number(128));
    CHECK(!FloorRegistry::valid_number(-128));

    // Assign floor 0 -> module 7; the number<->module link resolves both ways.
    reg.assign(0, 7);
    CHECK(reg.module_at(0) == 7);
    CHECK(reg.number_of(7) == 0);

    // Assigned but not resident until a layer is recorded; then the whole chain
    // number -> module -> layer resolves.
    CHECK(reg.layer_at(0) == kInvalidLayer);
    CHECK(!reg.resident(7));
    reg.set_resident(7, 3u);
    CHECK(reg.resident(7));
    CHECK(reg.layer_of(7) == 3u);
    CHECK(reg.layer_at(0) == 3u);
    CHECK(reg.loaded(0));

    // Renumber module 7 from floor 0 to floor -1 WITHOUT touching its residency
    // (floors.md: reshuffle labels mid-game, module content/World unchanged).
    reg.assign(-1, 7);
    CHECK(reg.module_at(-1) == 7);
    CHECK(reg.number_of(7) == -1);
    CHECK(reg.module_at(0) == kInvalidModule); // old label detached
    CHECK(reg.layer_at(-1) == 3u);             // still resident on the same slot
    CHECK(reg.layer_at(0) == kInvalidLayer);

    // Point floor -1 at a different module: the old module loses that label but
    // keeps its residency (label and residency are orthogonal).
    reg.assign(-1, 9);
    CHECK(reg.module_at(-1) == 9);
    CHECK(reg.number_of(9) == -1);
    CHECK(reg.number_of(7) == FloorRegistry::kNoFloor);
    CHECK(reg.layer_of(7) == 3u);

    // Eviction breaks the chain but leaves the label intact.
    reg.set_resident(9, 5u);
    CHECK(reg.layer_at(-1) == 5u);
    reg.evict(9);
    CHECK(reg.layer_of(9) == kInvalidLayer);
    CHECK(reg.layer_at(-1) == kInvalidLayer);
    CHECK(reg.module_at(-1) == 9); // survives eviction

    // clear_number detaches both directions.
    reg.clear_number(-1);
    CHECK(reg.module_at(-1) == kInvalidModule);
    CHECK(reg.number_of(9) == FloorRegistry::kNoFloor);

    // Out-of-range operations are no-ops, never crashes.
    reg.assign(200, 1);
    CHECK(reg.module_at(200) == kInvalidModule);
    CHECK(reg.number_of(1) == FloorRegistry::kNoFloor);
}

// Count solid (non-air) macro cells — a cheap fingerprint of a floor's geometry.
static std::size_t solid_cells(const World& w) {
    std::size_t n = 0;
    for (CellType t : w.grid().types())
        if (t != kCellAir) ++n;
    return n;
}

// The fixed 4x4x4 = 64-node nav / fast-travel lattice (src/world/lattice.h).
// Pure, seed-independent geometry; it must be a cyclic (Z/4)^3 torus graph (no
// boundary node) so the nav bake avoids spanning-tree seams on the torus.
static void test_lattice() {
    // Geometry contract, so a static_assert rather than a CHECK: 4^3 nodes at a
    // 32-cell spacing is what makes the lattice a cyclic (Z/4)^3 torus graph.
    static_assert(kLatticeCount == 64, "4x4x4 nav lattice ([floors.md])");
    static_assert(kLatticeSpacing == 32, "128 / 4 == 32 cells between nodes");

    CHECK(lattice_coord(0) == 16);
    CHECK(lattice_coord(1) == 48);
    CHECK(lattice_coord(2) == 80);
    CHECK(lattice_coord(3) == 112);

    // Each axis band is the node's Voronoi cell: [0,32)->0 ... [96,128)->3.
    CHECK(lattice_axis_of(0) == 0);
    CHECK(lattice_axis_of(31) == 0);
    CHECK(lattice_axis_of(32) == 1);
    CHECK(lattice_axis_of(112) == 3);
    CHECK(lattice_axis_of(127) == 3);

    // id <-> (ix,iy,iz) round-trips for all 64 nodes.
    for (int id = 0; id < kLatticeCount; ++id) {
        LatticeNode n = lattice_unpack(id);
        CHECK(n.ix >= 0 && n.ix < kLatticeDim);
        CHECK(n.iy >= 0 && n.iy < kLatticeDim);
        CHECK(n.iz >= 0 && n.iz < kLatticeDim);
        CHECK(lattice_id(n.ix, n.iy, n.iz) == id);
    }

    // The graph wraps on every axis (the "no seam" property): stepping off the
    // last column returns to the first, and -x/+x are inverses.
    CHECK(lattice_neighbor(lattice_id(3, 1, 2), 1) == lattice_id(0, 1, 2)); // +x
    CHECK(lattice_neighbor(lattice_id(0, 1, 2), 0) == lattice_id(3, 1, 2)); // -x
    CHECK(lattice_neighbor(lattice_id(2, 3, 0), 3) == lattice_id(2, 0, 0)); // +y
    CHECK(lattice_neighbor(lattice_id(1, 1, 3), 5) == lattice_id(1, 1, 0)); // +z
    // Every node has exactly 6 distinct neighbours (degree-6 cyclic graph).
    for (int id = 0; id < kLatticeCount; ++id) {
        bool seen[kLatticeCount] = {false};
        for (int d = 0; d < 6; ++d) {
            int nb = lattice_neighbor(id, d);
            CHECK(nb != id);
            CHECK(!seen[nb]);
            seen[nb] = true;
        }
    }
}

// The per-floor generator (floors.md: floor = pure fn(seed, number)). It must be
// deterministic, wipe prior contents, and give each FloorKind a measurably
// different interior.
static void test_floor_gen() {
    // Determinism, including over a recycled slot: build a floor, then build the
    // SAME floor into a world already dirtied by a different one — the grids must
    // come out bit-for-bit identical (this is what lets #9 regenerate on return).
    World a;
    World b;
    generate_floor(a, 5, floor_spec(FloorKind::Residential), 1u);
    generate_floor(b, 99, floor_spec(FloorKind::Derelict), 7u); // dirty b first
    generate_floor(b, 5, floor_spec(FloorKind::Residential), 1u);
    CHECK(a.grid().types() == b.grid().types());
    CHECK(solid_cells(a) > 0);

    // The floor NUMBER is folded into the seed, so a sibling residential floor
    // gets a different layout from the same world seed.
    World c;
    generate_floor(c, 6, floor_spec(FloorKind::Residential), 1u);
    CHECK(a.grid().types() != c.grid().types());

    // Kind selects a geometry profile with a clearly different solid-cell budget.
    World res, com, ind, der;
    generate_floor(res, 0, floor_spec(FloorKind::Residential), 3u);
    generate_floor(com, 0, floor_spec(FloorKind::Commercial), 3u);
    generate_floor(ind, 0, floor_spec(FloorKind::Industrial), 3u);
    generate_floor(der, 0, floor_spec(FloorKind::Derelict), 3u);
    const std::size_t nr = solid_cells(res);
    const std::size_t nc = solid_cells(com);
    const std::size_t ni = solid_cells(ind);
    const std::size_t nd = solid_cells(der);

    // All four kinds are distinct interiors...
    CHECK(nr != nc && nr != ni && nr != nd);
    CHECK(nc != ni && nc != nd && ni != nd);
    // ...and the ordering matches the design: a dense residential warren has more
    // wall than open commercial halls, which have more than a pillared industrial
    // plate; the derelict floor is the residential lattice half-collapsed, so it
    // sits below intact residential. Even the sparsest floor has real structure.
    CHECK(nr > nc);
    CHECK(nc > ni);
    CHECK(nr > nd);
    CHECK(ni > 0);

    // Fixed lattice: on EVERY floor kind the 16 shaft columns are carved to air
    // through the FULL height (Z wraps, so this also links top -> 0), and an
    // adjacent lobby cell is opened so the shaft joins the walkable graph.
    // Node-to-node reachability is exercised by the nav no-seam test (#11).
    for (World* w : {&res, &com, &ind, &der}) {
        auto& g = w->grid();
        for (int ny = 0; ny < kLatticeDim; ++ny)
            for (int nx = 0; nx < kLatticeDim; ++nx) {
                const int cx = lattice_coord(nx);
                const int cy = lattice_coord(ny);
                for (int z = 0; z < kMacroDim; ++z)
                    CHECK(g.cell(cx, cy, z) == kCellAir); // shaft is air
                CHECK(g.cell(cx + 2, cy, 1) == kCellAir);  // lobby opened
                // Elevator column: diagonal corner posts are solid hub-pad type
                // the FULL height (span the whole map; Z wraps into a loop).
                CHECK(g.cell(cx + 2, cy + 2, 0) == 7);
                CHECK(g.cell(cx + 2, cy + 2, 1) == 7);
                CHECK(g.cell(cx + 2, cy + 2, kMacroDim - 1) == 7);
            }
    }

    // Hub pads: each column carries a coloured landing pad (type 7) at all four
    // lattice z-levels {16,48,80,112}, so the 16 columns present 4x4x4 = 64
    // visible nodes. Checked on the intact kinds only: derelict randomly drops
    // slab cells (holePct), so a given pad cell there may be an open hole.
    for (World* w : {&res, &com, &ind}) {
        auto& g = w->grid();
        for (int ny = 0; ny < kLatticeDim; ++ny)
            for (int nx = 0; nx < kLatticeDim; ++nx) {
                const int cx = lattice_coord(nx);
                const int cy = lattice_coord(ny);
                for (int nz = 0; nz < kLatticeDim; ++nz)
                    CHECK(g.cell(cx + 2, cy, lattice_coord(nz)) == 7); // kHubPad
            }
    }
}

static void test_elevator() {
    // The elevator is the embodiment seam in motion: fold the player's record
    // back on the floor it leaves, re-embody it on the destination floor, and
    // carry the view + movement mode across the body swap. Two floors resident;
    // embodiment is world-free so no World is needed here.
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRegistry registry;

    const LayerId l0 = 0, l1 = 1;
    registry.assign(0, static_cast<ModuleId>(0));
    registry.set_resident(static_cast<ModuleId>(0), l0);
    registry.assign(1, static_cast<ModuleId>(1));
    registry.set_resident(static_cast<ModuleId>(1), l1);

    NpcId id = pool.spawn();
    CHECK(id != kInvalidNpc);
    pool.cx(id) = 40;
    pool.cy(id) = 50;
    pool.cz(id) = 1;
    pool.height_mm(id) = 1750;

    Entity p = embody_as_player(reg, pool, id, l0);
    CHECK(p != entt::null);
    CHECK(pool.is_player(id));
    // Give the camera a recognizable pose + fly on, to prove they survive a ride.
    reg.get<CameraTag>(p).yaw = 1.234f;
    reg.get<CameraTag>(p).pitch = -0.321f;
    reg.get<Controller>(p).fly = true;

    // Ride up: floor 0 -> 1. Same record, now embodied on layer 1.
    RideResult up = ride_elevator(reg, pool, registry, p, /*from=*/0, /*dir=*/+1,
                                  /*arrivalZ=*/2);
    CHECK(up.moved);
    CHECK(up.floor == 1);
    CHECK(up.layer == l1);
    CHECK(up.player != entt::null);
    CHECK(!reg.valid(p)); // the old body was folded away and destroyed
    p = up.player;
    CHECK(reg.get<NpcRef>(p).id == id);       // it is the very same record
    CHECK(reg.get<Transform>(p).layer == l1); // now on the destination layer
    CHECK(pool.is_player(id));                // still the player
    CHECK(pool.embodied(id));
    CHECK(pool.cx(id) == 40); // x/y kept
    CHECK(pool.cy(id) == 50);
    CHECK(pool.cz(id) == 2);  // dropped onto the arrival storey
    // View + movement mode preserved across the swap.
    CHECK(reg.get<Controller>(p).fly == true);
    // Not named `near`: <minwindef.h> defines `near` and `far` as object-like
    // macros, so that identifier detonates the moment anything in giga_game's
    // header chain reaches <windows.h>.
    auto approx = [](float a, float b) { return (a - b) * (a - b) < 1e-8f; };
    CHECK(approx(reg.get<CameraTag>(p).yaw, 1.234f));
    CHECK(approx(reg.get<CameraTag>(p).pitch, -0.321f));

    // Ride up again: floor 2 is not loaded -> no-op, player untouched.
    RideResult none = ride_elevator(reg, pool, registry, p, /*from=*/1,
                                    /*dir=*/+1, /*arrivalZ=*/2);
    CHECK(!none.moved);
    CHECK(none.floor == 1);
    CHECK(none.player == p);
    CHECK(reg.valid(p));
    CHECK(reg.get<Transform>(p).layer == l1);

    // Ride back down: floor 1 -> 0.
    RideResult down = ride_elevator(reg, pool, registry, p, /*from=*/1,
                                    /*dir=*/-1, /*arrivalZ=*/2);
    CHECK(down.moved);
    CHECK(down.floor == 0);
    CHECK(down.layer == l0);
    p = down.player;
    CHECK(reg.get<NpcRef>(p).id == id);
    CHECK(reg.get<Transform>(p).layer == l0);
    CHECK(pool.is_player(id));
}

// Count records whose id is in [lo, hi) that are currently live ECS entities
// standing on `layer` — i.e. the crowd of one streamed floor.
static int live_on_layer(Registry& ecs, NpcId lo, NpcId hi, LayerId layer) {
    int n = 0;
    auto view = ecs.view<NpcRef, Transform>();
    for (auto e : view) {
        const NpcRef& ref = view.get<NpcRef>(e);
        const Transform& tr = view.get<Transform>(e);
        if (ref.id >= lo && ref.id < hi && tr.layer == layer) ++n;
    }
    return n;
}

static void test_floor_stream() {
    // The heart of streaming (master_prompt #9): a floor's crowd is seeded into
    // the cold pool exactly once, embodied on load, folded back on unload, and
    // re-embodied — same records, no growth — on every later load. Verified with a
    // pure crowd: a standalone player parked on another layer keeps the streamer
    // from claiming a candidate here, and proves an already-embodied record is
    // skipped rather than duplicated.
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;

    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0); // two recyclable physical layers

    ModuleId m0 = stream.add_module(reg, /*number=*/0, FloorKind::Residential,
                                    /*seed=*/1234u);
    CHECK(m0 != kInvalidModule);
    const std::uint32_t pop = floor_spec(FloorKind::Residential).population;

    // A player that lives elsewhere: spawned before the crowd (so it is outside
    // the crowd's id range) and embodied on an unrelated layer. Passing its id as
    // playerId means ensure_loaded will NOT designate a player from the crowd.
    NpcId dummy = pool.spawn();
    pool.height_mm(dummy) = 1750;
    Entity dummyBody = embody_as_player(ecs, pool, dummy, /*layer=*/999);
    CHECK(dummyBody != entt::null);
    CHECK(pool.is_player(dummy));
    NpcId playerId = dummy;

    const NpcId before = pool.count();

    // First load: seeds the crowd once and embodies all of it.
    LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(r.layer != kInvalidLayer);
    CHECK(r.player == entt::null); // a player already existed -> none created
    CHECK(stream.loaded(reg, 0));
    const NpcId lo = before, hi = pool.count();
    CHECK(hi == before + pop);                          // crowd seeded exactly once
    CHECK(live_on_layer(ecs, lo, hi, r.layer) == (int)pop); // ...and all embodied
    CHECK(playerId == dummy);                           // player untouched
    CHECK(pool.embodied(dummy));

    // Unload: the same ids fold back (embodied=false); no record is created/freed.
    stream.unload(stack, reg, ecs, pool, 0);
    CHECK(!stream.loaded(reg, 0));
    CHECK(pool.count() == hi); // bump high-water mark unchanged
    CHECK(live_on_layer(ecs, lo, hi, r.layer) == 0);
    for (NpcId id = lo; id < hi; ++id) CHECK(!pool.embodied(id));

    // Reload: re-embodies THAT SAME range, seeds nothing -> population steady.
    LoadResult r2 = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(r2.layer != kInvalidLayer);
    CHECK(pool.count() == hi); // <-- the #9 invariant: no per-visit growth
    CHECK(live_on_layer(ecs, lo, hi, r2.layer) == (int)pop);
    for (NpcId id = lo; id < hi; ++id) CHECK(pool.embodied(id));

    // Asking again while resident is an idempotent no-op returning the same layer.
    const NpcId steady = pool.count();
    LoadResult r3 = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(r3.layer == r2.layer);
    CHECK(pool.count() == steady);

    // Load-on-demand boundary: an unregistered floor maps to no module -> empty.
    LoadResult none = stream.ensure_loaded(stack, reg, ecs, pool, 7, playerId);
    CHECK(none.layer == kInvalidLayer);
    CHECK(!stream.loaded(reg, 7));
}

static void test_floor_travel() {
    // A real player riding between streamed floors. The destination loads on
    // demand, the departed floor folds away (keepRadius 0), the population never
    // grows on the return trip, and the player is the SAME record throughout.
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;

    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0);
    stream.add_module(reg, /*number=*/0, FloorKind::Residential, /*seed=*/1u);
    stream.add_module(reg, /*number=*/1, FloorKind::Commercial, /*seed=*/2u);
    const std::uint32_t popRes = floor_spec(FloorKind::Residential).population;
    const std::uint32_t popCom = floor_spec(FloorKind::Commercial).population;

    // Start on floor 0: no player yet, so the streamer designates one from floor
    // 0's crowd and embodies it with a camera.
    NpcId playerId = kInvalidNpc;
    LoadResult start = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(start.layer != kInvalidLayer);
    CHECK(start.player != entt::null);
    CHECK(playerId != kInvalidNpc);
    Entity player = start.player;
    CHECK(ecs.get<NpcRef>(player).id == playerId);
    CHECK(pool.is_player(playerId));
    CHECK(pool.count() == popRes);  // only floor 0 seeded so far
    CHECK(!stream.loaded(reg, 1));  // floor 1 stays cold until entered

    // Ride up 0 -> 1: destination loads on demand, floor 0 unloads.
    RideResult up = stream.travel(stack, reg, ecs, pool, player, /*from=*/0,
                                  /*dir=*/+1, /*arrivalZ=*/2, playerId);
    CHECK(up.moved);
    CHECK(up.floor == 1);
    player = up.player;
    CHECK(ecs.get<NpcRef>(player).id == playerId); // same record survived the swap
    CHECK(pool.is_player(playerId));
    CHECK(pool.embodied(playerId));
    CHECK(ecs.get<Transform>(player).layer == up.layer);
    CHECK(stream.loaded(reg, 1));
    CHECK(!stream.loaded(reg, 0));               // departed crowd folded away
    const NpcId afterUp = pool.count();
    CHECK(afterUp == popRes + popCom);           // floor 1 seeded exactly once

    // Ride back down 1 -> 0: floor 0 reloads its SAME range (no growth), and the
    // player — a member of floor 0's range but currently embodied — is skipped by
    // the crowd pass and moved across by the elevator, so it is never duplicated.
    RideResult down = stream.travel(stack, reg, ecs, pool, player, /*from=*/1,
                                    /*dir=*/-1, /*arrivalZ=*/2, playerId);
    CHECK(down.moved);
    CHECK(down.floor == 0);
    player = down.player;
    CHECK(ecs.get<NpcRef>(player).id == playerId); // identity preserved round trip
    CHECK(pool.is_player(playerId));
    CHECK(ecs.get<Transform>(player).layer == down.layer);
    CHECK(stream.loaded(reg, 0));
    CHECK(!stream.loaded(reg, 1));
    CHECK(pool.count() == afterUp); // <-- #9: population steady across the return
    CHECK(live_on_layer(ecs, 0, popRes, down.layer) == (int)popRes); // full crowd
}

// The nav coarse bake on a REAL carved floor (master_prompt #11 — the "no-seam"
// test that test_floor_gen defers to). Shafts guarantee vertical links; the bake
// must find full node-to-node connectivity on a dense floor, stay deterministic
// on actual geometry, and keep the lattice intact on a decayed floor.
static void test_nav_realfloor() {
    using namespace nav;

    // Dense residential: rooms tile the whole floor and the 7x7 lobbies punch
    // through the wall lattice, so all 64 nodes join one connected component.
    World res;
    generate_floor(res, /*number=*/0, floor_spec(FloorKind::Residential), 1337u);
    CoarseGraph g{};
    bake_coarse(res.grid(), g);
    for (int i = 0; i < kNodes; ++i)
        for (int j = 0; j < kNodes; ++j)
            CHECK(g.dist[i][j] != kUnreachable); // fully connected

    // Vertical neighbours share a shaft carved to air through every slab, so the
    // +/-z edge is the pure spacing (32): a straight open column, no detour.
    for (int i = 0; i < kNodes; ++i) {
        CHECK(g.edge[i][4] == kLatticeSpacing); // -z
        CHECK(g.edge[i][5] == kLatticeSpacing); // +z
    }

    // Deterministic on real geometry too.
    CoarseGraph g2{};
    bake_coarse(res.grid(), g2);
    CHECK(std::memcmp(&g, &g2, sizeof(CoarseGraph)) == 0);

    // Derelict randomly drops slab/wall cells, but the lattice is carved LAST and
    // seed-independently, so every shaft stays open: the vertical links survive a
    // half-collapsed floor even where the horizontal rooms may not.
    World der;
    generate_floor(der, /*number=*/-3, floor_spec(FloorKind::Derelict), 42u);
    CoarseGraph gd{};
    bake_coarse(der.grid(), gd);
    for (int i = 0; i < kNodes; ++i) {
        CHECK(gd.edge[i][4] == kLatticeSpacing);
        CHECK(gd.edge[i][5] == kLatticeSpacing);
    }
}

// The L2 fine bake on a REAL carved floor (master_prompt #11, increment C). Each
// node's flow field must carry an agent cell-by-cell home through the actual
// rooms/shafts without ever crossing a wall, and re-bake bit-identically.
static void test_nav_fine_realfloor() {
    using namespace nav;

    World res;
    generate_floor(res, /*number=*/0, floor_spec(FloorKind::Residential), 1337u);
    FineNav f;
    bake_fine(res.grid(), f);

    // Descend `node`'s field from a start cell, asserting nothing it steps onto
    // is solid. Returns steps to arrive, -1 at a dead end (kFlowNone), -2 if it
    // ever lands in a wall, -3 if it fails to terminate (a cycle => a bug). A
    // BFS parent chain strictly shortens, so a correct field always arrives.
    auto follow = [&](int node, int x, int y, int z) -> int {
        int cx = x, cy = y, cz = z;
        for (std::size_t steps = 0; steps <= kMacroCells; ++steps) {
            if (res.grid().mask(cx, cy, cz).full()) return -2;
            const std::uint8_t d = f.at(node, cx, cy, cz);
            if (d == kFlowArrived) return static_cast<int>(steps);
            if (d == kFlowNone) return -1;
            cx = wrap_macro(cx + kNavDir[d][0]);
            cy = wrap_macro(cy + kNavDir[d][1]);
            cz = wrap_macro(cz + kNavDir[d][2]);
        }
        return -3;
    };

    // Every one of the 64 node cells routes home to node 0. Dense residential is
    // fully connected (proven by the coarse test), so each must arrive.
    for (int id = 0; id < kNodes; ++id) {
        const LatticeNode n = lattice_unpack(id);
        CHECK(follow(0, lattice_coord(n.ix), lattice_coord(n.iy),
                     lattice_coord(n.iz)) >= 0);
    }
    // The target's own cell is "arrived".
    CHECK(f.at(0, lattice_coord(0), lattice_coord(0), lattice_coord(0)) ==
          kFlowArrived);
    // A different target field routes too: node 0's cell to the antipode (2,2,2).
    const int antipode = lattice_id(2, 2, 2);
    CHECK(follow(antipode, lattice_coord(0), lattice_coord(0),
                 lattice_coord(0)) >= 0);

    // Deterministic on real geometry (schedule-invariant across the 64 threads).
    FineNav f2;
    bake_fine(res.grid(), f2);
    CHECK(f.flow.size() == f2.flow.size());
    CHECK(std::memcmp(f.flow.data(), f2.flow.data(), f.flow.size()) == 0);
}

// ---- Global mob table -----------------------------------------------------

// Table integrity. Every assertion here was checked against data/mobs.csv before
// being written, so a failure means the table drifted from its source — not that
// the assertion was optimistic.
static void test_mob_table() {
    CHECK(kMobTable.size() == kMobKindCount);
    CHECK(kMobNames.size() == kMobKindCount);

    int ranged = 0, immobile = 0, boss = 0, rare = 0, plain = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];

        // The row index IS the kind; this is what lets a MobKind be a raw index.
        CHECK(m.kind == static_cast<std::uint8_t>(i));
        CHECK(kMobNames[i] != nullptr && kMobNames[i][0] != '\0');

        // Every enum-valued byte must be in range, or a jump table walks off.
        CHECK(m.tier < static_cast<std::uint8_t>(MobTier::Count));
        CHECK(m.behaviour < static_cast<std::uint8_t>(MobBehaviour::Count));
        CHECK(m.projType < static_cast<std::uint8_t>(ProjType::Count));
        CHECK(m.packMode < static_cast<std::uint8_t>(MobPackMode::Count));

        // Measured ranges from the reference.
        CHECK(m.hp >= 8 && m.hp <= 1000);
        CHECK(m.dmg <= 1000);            // PAUPSINA is the one 0-damage kind
        CHECK(m.speedMmps <= 8500);
        CHECK(m.attackCdMs >= 240 && m.attackCdMs <= 3800);
        CHECK(m.meleeReachMm >= 1050 && m.meleeReachMm <= 1550);
        CHECK(m.spawnWeightX10 <= 850);
        CHECK(m.minSamosbor <= 99);
        CHECK(m.packMin >= 1 && m.packMax >= m.packMin && m.packMax <= 16);
        CHECK(m.packSpread <= 10);

        // Every kind has a habitat: an empty mask would make it unspawnable
        // everywhere, silently.
        CHECK(m.roomMask != 0);
        CHECK(m.floorMask != 0);

        // Derived flags must agree with the fields they were derived from.
        CHECK(has_flag(m.aiFlags, AiFlag::Immobile) == (m.speedMmps == 0));
        if (has_flag(m.aiFlags, AiFlag::Ranged)) {
            ++ranged;
            CHECK(m.projSpeedMmps > 0);  // a ranged kind with no projectile speed
        }                                // could never actually shoot
        if (has_flag(m.aiFlags, AiFlag::Immobile)) ++immobile;
        if (has_flag(m.aiFlags, AiFlag::Boss)) ++boss;
        if (has_flag(m.aiFlags, AiFlag::Rare)) ++rare;
        if (m.behaviour == static_cast<std::uint8_t>(MobBehaviour::Plain)) ++plain;
    }

    // Population counts, pinned to the reference. These catch a truncated or
    // duplicated regenerate that per-row checks would pass.
    CHECK(ranged == 13);
    CHECK(immobile == 4);   // IDOL, BORSHCHEVIK, KANTSELYARSKIY_IDOL, BLOOD_PLANT
    CHECK(boss == 3);       // MANCOBUS, HERALD, CREATOR
    CHECK(rare == 33);
    CHECK(plain == 23);     // 15 with no flags + 8 whose flags are all shared bits

    // Spot-check both ends of the catalog against the CSV.
    const MobDef& sborka = mob_def(MobKind::Sborka);
    CHECK(sborka.hp == 8 && sborka.dmg == 3 && sborka.speedMmps == 3150);
    CHECK(has_flag(sborka.aiFlags, AiFlag::FoodBait));
    CHECK(mob_def(MobKind::Gnome).behaviour ==
          static_cast<std::uint8_t>(MobBehaviour::Melee));
    // GREEN_DOG is the only kind whose two singleton flags were merged.
    CHECK(mob_def(MobKind::GreenDog).behaviour ==
          static_cast<std::uint8_t>(MobBehaviour::GreenDogPack));
}

// Danger is V-shaped about the hub, NOT monotonic with depth: floor 0 is the safe
// living hub and hostility rises in BOTH directions. This is the contract most
// likely to be "simplified" into a monotonic depth curve by a later change.
static void test_mob_budget_v_shape() {
    const FloorTheme t = FloorTheme::Ministry;

    // Head-count depends on |floor|, so the two arms are mirror images.
    for (int z = 1; z <= 50; z += 7)
        CHECK(mob_count_for_floor(z, 3, t) == mob_count_for_floor(-z, 3, t));

    // ...and it RISES away from the hub in both directions.
    const int hub = mob_count_for_floor(0, 3, t);
    CHECK(hub < mob_count_for_floor(20, 3, t));
    CHECK(mob_count_for_floor(20, 3, t) < mob_count_for_floor(50, 3, t));
    CHECK(hub < mob_count_for_floor(-20, 3, t));
    CHECK(mob_count_for_floor(-20, 3, t) < mob_count_for_floor(-50, 3, t));

    // The curve saturates at |z| = 50; past the ends nothing changes or overflows.
    CHECK(mob_count_for_floor(50, 3, t) == mob_count_for_floor(127, 3, t));
    CHECK(mob_count_for_floor(-50, 3, t) == mob_count_for_floor(-127, 3, t));
    CHECK(mob_count_for_floor(127, 5, FloorTheme::Void) <= kMobBudgetCap);

    // Theme trims head-count without changing its shape: the hub is deliberately
    // the emptiest floor of monsters and the void the fullest.
    CHECK(mob_count_for_floor(30, 3, FloorTheme::Living) <
          mob_count_for_floor(30, 3, FloorTheme::Void));
    // Danger trims it too, monotonically.
    CHECK(mob_count_for_floor(30, 1, t) < mob_count_for_floor(30, 5, t));

    // LEVEL = f(|floor|) + danger, clamped 1..12, and never below the authored
    // danger — a danger-5 floor near the hub is small but not soft.
    for (int z = -60; z <= 60; z += 5) {
        for (std::uint8_t d = 1; d <= 5; ++d) {
            std::uint8_t lv = mob_level_for_floor(z, d);
            CHECK(lv >= 1 && lv <= 12);
            CHECK(lv >= d);
            CHECK(mob_level_for_floor(z, d) == mob_level_for_floor(-z, d));
        }
    }
    CHECK(mob_level_for_floor(0, 1) < mob_level_for_floor(50, 1));

    // 11, not 12. The floor formula tops out at 1 + 8 + (5-1)*0.55 = 11.2, so the
    // documented 1..12 range is really 1..11 from floor geometry alone — LEVEL 12
    // needs the reference's per-zone bonus, which gigahrush2 has no zones for yet.
    // Pinned deliberately: when zones land, this is the assertion that should
    // change, and it should change on purpose.
    CHECK(mob_level_for_floor(50, 5) == 11);
    CHECK(mob_level_for_floor(-50, 5) == 11);

    // A level-1 instance sits at exactly its authored base HP — that is why the
    // samosbor HP curve was chosen over the design-floor one.
    CHECK(mob_hp_at_level(100, 1) == 100);
    CHECK(mob_hp_at_level(100, 12) == 232);   // 100 * (1 + 0.12*11)
    CHECK(mob_hp_at_level(100, 200) == mob_hp_at_level(100, 12)); // clamped
    CHECK(mob_hp_at_level(8, 1) == 8);
}

// ---- Mob spawning ---------------------------------------------------------

static void test_mob_spawn() {
    World w;
    const FloorSpec& spec = floor_spec(FloorKind::Derelict);
    generate_floor(w, 4, spec, 11u);

    Registry reg;
    const std::uint8_t danger = danger_for_hostility(spec.hostility);
    const FloorTheme theme = theme_for_kind(FloorKind::Derelict);
    CHECK(danger == 5);                        // 0.90 hostility -> danger 5
    CHECK(theme == FloorTheme::Hell);

    const std::uint32_t budget = static_cast<std::uint32_t>(
        mob_count_for_floor(4, danger, theme));
    CHECK(budget > 0);

    const std::uint32_t n =
        spawn_floor_mobs(reg, w, 4, danger, theme, /*layer=*/0, /*seed=*/77u);
    CHECK(n > 0);
    CHECK(n <= budget);                        // never exceeds the budget
    CHECK(count_layer_mobs(reg, 0) == n);
    CHECK(count_layer_mobs(reg, 1) == 0);      // layer-scoped

    // Every spawned mob must be a legal inhabitant of this floor and a legal row.
    const std::uint8_t level = mob_level_for_floor(4, danger);
    auto view = reg.view<const MobRef, const Transform, const AABB>();
    for (auto e : view) {
        const MobRef& m = view.get<const MobRef>(e);
        CHECK(m.kind < kMobKindCount);
        CHECK(m.level == level);
        CHECK(m.hp > 0 && m.hp == m.maxHp);
        CHECK(m.hp == static_cast<std::int16_t>(
                          mob_hp_at_level(kMobTable[m.kind].hp, level)));

        // Spawned into air, not inside a wall — the whole point of the placement
        // rejection loop.
        const Transform& tr = view.get<const Transform>(e);
        int cx = static_cast<int>(tr.pos.x / kCellSize);
        int cy = static_cast<int>(tr.pos.y / kCellSize);
        CHECK(w.grid().cell(cx, cy, 1) == kCellAir);

        // Immobile kinds are architecture, not bodies: no gravity component.
        const bool immobile = has_flag(kMobTable[m.kind].aiFlags, AiFlag::Immobile);
        CHECK(reg.all_of<GravityAffected>(e) == !immobile);
    }

    // The cap bounds the spawn regardless of budget — this is what keeps a deep
    // floor from adding thousands of entities in one frame.
    Registry capped;
    std::uint32_t c = spawn_floor_mobs(capped, w, 4, danger, theme, 0, 77u,
                                       /*cap=*/5);
    CHECK(c <= 5);

    // Determinism: same (floor, seed) must reproduce the same roster in the same
    // places, or unloading and reloading a floor visibly rearranges it.
    Registry again;
    std::uint32_t n2 = spawn_floor_mobs(again, w, 4, danger, theme, 0, 77u);
    CHECK(n2 == n);

    // Despawn is total and layer-scoped.
    CHECK(despawn_layer_mobs(reg, 0) == n);
    CHECK(count_layer_mobs(reg, 0) == 0);
}

// The hub must be meaningfully safer than the depths — the V-shape has to survive
// contact with real generated geometry, not just the formula.
static void test_mob_spawn_v_shape_in_world() {
    Registry reg;
    World hub, deep;
    generate_floor(hub, 0, floor_spec(FloorKind::Residential), 3u);
    generate_floor(deep, 40, floor_spec(FloorKind::Derelict), 3u);

    std::uint32_t nHub = spawn_floor_mobs(
        reg, hub, 0, danger_for_hostility(floor_spec(FloorKind::Residential).hostility),
        theme_for_kind(FloorKind::Residential), 0, 5u, /*cap=*/4096);
    std::uint32_t nDeep = spawn_floor_mobs(
        reg, deep, 40, danger_for_hostility(floor_spec(FloorKind::Derelict).hostility),
        theme_for_kind(FloorKind::Derelict), 1, 5u, /*cap=*/4096);

    CHECK(nHub < nDeep);
    CHECK(count_layer_mobs(reg, 0) == nHub);
    CHECK(count_layer_mobs(reg, 1) == nDeep);

    // ...and the roof arm is as crowded as the equally-deep basement arm, because
    // COUNT is driven by |floor|.
    World roof;
    generate_floor(roof, -40, floor_spec(FloorKind::Derelict), 3u);
    Registry r2;
    std::uint32_t nRoof = spawn_floor_mobs(
        r2, roof, -40, danger_for_hostility(floor_spec(FloorKind::Derelict).hostility),
        theme_for_kind(FloorKind::Derelict), 0, 5u, /*cap=*/4096);
    // Not equal — placement depends on the floor's own geometry — but the same
    // order of magnitude, and both far above the hub.
    CHECK(nRoof > nHub * 2);
}

// ---- Palette separation: monsters must not look like people ---------------

// This is a gameplay contract, not a style guide. In a dark corridor the player
// has to tell a civilian from a monster instantly, so the two palettes occupy
// different axes: people are green-teal/blue/violet/cyan/amber, monsters own the
// red/dark axis, and red belongs to danger only (faction.h).
//
// The first mob palette violated this — boss yellow (1.00, 0.92, 0.30) sat a
// squared distance of only 0.023 from faction amber (0.95, 0.80, 0.22). This test
// exists so that regression cannot happen quietly.
static void test_palette_separation() {
    // faction.h owns the people side; sample it through the public accessor.
    vec3 people[kFactionCount];
    for (std::uint16_t f = 0; f < kFactionCount; ++f)
        people[f] = faction_color(f, /*jitterKey=*/0u);

    // mob_spawn keeps tier_color internal, so mirror the authored rows here. A
    // divergence shows up as this test passing while the game looks wrong, which
    // is why the values are commented with their names in both places.
    const vec3 threats[] = {
        {0.30f, 0.26f, 0.22f}, {0.42f, 0.30f, 0.18f}, {0.56f, 0.26f, 0.15f},
        {0.68f, 0.14f, 0.13f}, {0.90f, 0.31f, 0.36f}, {1.00f, 0.58f, 0.52f},
    };
    const std::size_t nThreats = sizeof(threats) / sizeof(threats[0]);
    static_assert(sizeof(threats) / sizeof(threats[0]) ==
                      static_cast<std::size_t>(MobTier::Count),
                  "one mirrored tier colour per MobTier");

    // Separation is measured as squared RGB distance MINIMISED OVER THE JITTER,
    // which is the only honest form: faction_color and tier_color each add a
    // deterministic per-record offset of the same amount to all three channels
    // (+/-0.09), so two colours can be pushed toward each other by up to 0.18
    // along the grey diagonal. Comparing base colours alone would pass a palette
    // that collides in the crowd.
    //
    // For d = a - b and a uniform shift delta applied to one of them, the squared
    // distance is sum(d_i + delta)^2 = Q + 2*S*delta + 3*delta^2, minimised at
    // delta = -S/3 (clamped to the jitter range). Closed form, no sampling.
    auto worst_d2 = [](const vec3& a, const vec3& b) {
        const float d0 = a.x - b.x, d1 = a.y - b.y, d2v = a.z - b.z;
        const float S = d0 + d1 + d2v;
        const float Q = d0 * d0 + d1 * d1 + d2v * d2v;
        float delta = -S / 3.0f;
        if (delta < -0.18f) delta = -0.18f;
        if (delta > 0.18f) delta = 0.18f;
        return Q + 2.0f * S * delta + 3.0f * delta * delta;
    };

    // No monster may be confusable with any civilian. Measured worst case for the
    // current palettes is 0.0533 (Wild amber vs Boss); the threshold keeps
    // headroom. For scale, the palette this replaced put boss yellow at 0.0283
    // from faction amber under the same measure — half as far.
    for (std::uint16_t f = 0; f < kFactionCount; ++f)
        for (std::size_t t = 0; t < nThreats; ++t)
            CHECK(worst_d2(people[f], threats[t]) > 0.040f);

    // Factions must also be distinguishable from each other, or a five-way
    // society reads as one crowd. Worst case is 0.0333 (Liquidators vs
    // Scientists — blue against cyan, the tightest authored pair).
    for (std::uint16_t a = 0; a < kFactionCount; ++a)
        for (std::uint16_t b = static_cast<std::uint16_t>(a + 1);
             b < kFactionCount; ++b)
            CHECK(worst_d2(people[a], people[b]) > 0.025f);

    auto d2 = [](const vec3& a, const vec3& b) {
        const float dr = a.x - b.x, dg = a.y - b.y, db = a.z - b.z;
        return dr * dr + dg * dg + db * db;
    };

    // Five factions, and the index must wrap by modulo, not fold: the `faction & 3`
    // mask this replaced silently mapped Wild onto Citizens.
    static_assert(kFactionCount == 5, "five factions");
    for (std::uint16_t f = 0; f < kFactionCount; ++f)
        CHECK(d2(faction_color(f, 0u),
                 faction_color(static_cast<std::uint16_t>(f + kFactionCount), 0u))
              < 1e-6f);  // wraps by modulo, same hue
    CHECK(d2(faction_color(static_cast<std::uint16_t>(Faction::Wild), 0u),
             faction_color(static_cast<std::uint16_t>(Faction::Citizens), 0u))
          > 0.03f);
}

// The floor catalog must carry five faction weights and mean something by them.
static void test_faction_mix_is_five_wide() {
    for (int k = 0; k < static_cast<int>(FloorKind::Count); ++k) {
        const FloorSpec& s = floor_spec(static_cast<FloorKind>(k));
        std::uint32_t total = 0;
        for (std::size_t f = 0; f < kFactionCount; ++f) total += s.factionMix[f];
        CHECK(total > 0);  // a zero mix would seed one arbitrary faction
    }
    // Fiction checks: the hub is citizen-dominant, the derelict cultist-dominant.
    const FloorSpec& res = floor_spec(FloorKind::Residential);
    const std::size_t cit = static_cast<std::size_t>(Faction::Citizens);
    const std::size_t cul = static_cast<std::size_t>(Faction::Cultists);
    for (std::size_t f = 0; f < kFactionCount; ++f)
        if (f != cit) CHECK(res.factionMix[cit] > res.factionMix[f]);
    const FloorSpec& der = floor_spec(FloorKind::Derelict);
    CHECK(der.factionMix[cul] > der.factionMix[cit]);
}

// ---- Wander locomotion: the crowd actually moves ---------------------------

// The nav bake existed complete, tested, and wired to NOTHING. This is the test
// that the seam is real: run the sim and assert that bodies are in different
// places afterwards. Screenshots cannot prove this (a stationary camera and a
// drifting player confound it); a headless step-and-measure can.
static void test_wander_moves_the_crowd() {
    World w;
    const FloorSpec& spec = floor_spec(FloorKind::Residential);
    generate_floor(w, 0, spec, 21u);

    LevelStack stack;
    LayerId layer = stack.push_layer();
    stack.layer(layer).grid() = w.grid();

    // A modest crowd is enough to measure, and keeps the 64-BFS bake affordable.
    NpcPool pool;
    pool.init();
    Registry reg;
    NpcId first = seed_floor_population(pool, /*floor=*/0, /*n=*/120, /*seed=*/9u);
    CHECK(first != kInvalidNpc);
    for (NpcId id = 0; id < pool.count(); ++id)
        if (pool.alive(id)) embody(reg, pool, id, layer);

    nav::CoarseGraph coarse;
    nav::FineNav fine;
    nav::bake_coarse(stack.layer(layer).grid(), coarse);
    nav::bake_fine(stack.layer(layer).grid(), fine);

    const std::uint32_t wandering = wander_init(reg, layer, 4u);
    CHECK(wandering > 0);

    // Snapshot start positions.
    std::vector<Entity> agents;
    std::vector<vec3> start;
    for (auto e : reg.view<const WanderTarget, const Transform>()) {
        agents.push_back(e);
        start.push_back(reg.get<const Transform>(e).pos);
    }
    CHECK(agents.size() == wandering);

    // Run a second of sim. kWanderPeriod = 8, so every agent gets ~15 steering
    // passes in this window.
    const float dt = 1.0f / 120.0f;
    for (std::uint64_t t = 0; t < 120; ++t) {
        wander_step(reg, coarse, fine, layer, t);
        physics_step(reg, stack, dt);
    }

    // Count how many actually travelled. Not all will: an agent sealed into an
    // apartment, or one whose flow byte is a vertical step, legitimately stays put
    // (see wander.h — stairwell traversal is not wired). So this asserts a
    // MAJORITY moved, not everyone.
    std::size_t moved = 0;
    float maxDist = 0.0f;
    for (std::size_t i = 0; i < agents.size(); ++i) {
        const vec3& p = reg.get<const Transform>(agents[i]).pos;
        const float dx = wrap_delta_f(start[i].x, p.x, kWorldExtent);
        const float dy = wrap_delta_f(start[i].y, p.y, kWorldExtent);
        const float d = std::sqrt(dx * dx + dy * dy);
        if (d > 0.25f) ++moved;
        if (d > maxDist) maxDist = d;
    }
    CHECK(moved * 2 > agents.size());   // a majority is walking
    CHECK(maxDist > 1.0f);              // and somebody covered real ground

    // Steering must be a pure read of the bake: it may not mutate the nav data,
    // or a second floor visit would behave differently from the first.
    nav::CoarseGraph after = coarse;
    wander_step(reg, coarse, fine, layer, 999u);
    CHECK(std::memcmp(&after, &coarse, sizeof(coarse)) == 0);

    // Immobile mobs are never given a target: a spore carpet must not walk.
    Registry mobReg;
    spawn_floor_mobs(mobReg, w, 0, danger_for_hostility(spec.hostility),
                     theme_for_kind(FloorKind::Residential), layer, 3u, 400);
    wander_init(mobReg, layer, 7u);
    for (auto e : mobReg.view<const MobRef>()) {
        const MobRef& m = mobReg.get<const MobRef>(e);
        if (has_flag(kMobTable[m.kind].aiFlags, AiFlag::Immobile))
            CHECK(!mobReg.all_of<WanderTarget>(e));
    }
}

// ---- Combat: the three reference defects, asserted impossible ---------------

// Defect 1 — one damage function, and it reports what it APPLIED. In the
// reference, pre-armour damage leaked into the kill feed and the threat model
// while HP took the mitigated value, so the number shown was not the number that
// landed.
static void test_damage_reports_applied_not_raw() {
    NpcPool pool;
    pool.init();
    Registry reg;
    NpcId id = pool.spawn();
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    Entity e = embody(reg, pool, id, 0);

    DamageResult r = apply_damage(reg, pool, e, 30, DamageChannel::Kinetic,
                                  entt::null);
    CHECK(r.hit && r.applied == 30 && r.blocked == 0 && !r.lethal);
    CHECK(pool.hp(id) == 70);

    // 50% kinetic armour halves it, and `applied` is the halved number — the raw
    // 40 must not escape anywhere.
    Armour a{};
    a.resist[static_cast<std::size_t>(DamageChannel::Kinetic)] = 50;
    reg.emplace<Armour>(e, a);
    r = apply_damage(reg, pool, e, 40, DamageChannel::Kinetic, entt::null);
    CHECK(r.applied == 20 && r.blocked == 20);
    CHECK(pool.hp(id) == 50);

    // Armour is per channel: the same plate does nothing against fire.
    r = apply_damage(reg, pool, e, 10, DamageChannel::Fire, entt::null);
    CHECK(r.applied == 10 && r.blocked == 0);
    CHECK(pool.hp(id) == 40);

    // A negative resist is a vulnerability, deliberately not clamped away.
    reg.get<Armour>(e).resist[static_cast<std::size_t>(DamageChannel::Energy)] =
        -100;
    r = apply_damage(reg, pool, e, 10, DamageChannel::Energy, entt::null);
    CHECK(r.applied == 20);

    // Overkill reports what HP actually lost, not the authored swing.
    const std::int16_t before = pool.hp(id);
    r = apply_damage(reg, pool, e, 9999, DamageChannel::Kinetic, entt::null);
    CHECK(r.applied == before);   // not 9999, and not the mitigated 5000 either
    CHECK(r.lethal);
    CHECK(pool.hp(id) == 0);
}

// Defect 2 — apply_damage never destroys; finalize_deaths is the only place a
// life ends, and the event is published while the victim can still be read.
static void test_death_goes_through_one_finalizer() {
    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();

    NpcId id = pool.spawn();
    pool.hp(id) = 10;
    pool.max_hp(id) = 10;
    Entity e = embody(reg, pool, id, 0);

    DamageResult r = apply_damage(reg, pool, e, 50, DamageChannel::Kinetic,
                                  entt::null);
    CHECK(r.lethal);
    // Tagged, not destroyed. This is what gives loot / quest / A-Life hooks a
    // chance to run — the reference's P0 was that they could be skipped.
    CHECK(reg.valid(e));
    CHECK(reg.all_of<Dead>(e));
    CHECK(pool.alive(id));        // the record is not killed until finalize either

    // A second hit on a corpse-in-waiting is a no-op, so a death cannot be
    // double-counted by two systems in the same tick.
    DamageResult again = apply_damage(reg, pool, e, 50, DamageChannel::Kinetic,
                                      entt::null);
    CHECK(!again.hit && again.applied == 0);

    CHECK(finalize_deaths(reg, pool, bus, /*tick=*/7u) == 1);
    CHECK(!reg.valid(e));         // now it is gone
    CHECK(!pool.alive(id));       // and the record is dead
    CHECK(pool.valid(id));        // but its id stays valid forever ([npcs.md])

    std::uint32_t died = 0;
    for (std::size_t i = 0; i < bus.size(); ++i) {
        const Event& ev = bus.events()[i];
        if (ev.type != EventType::NpcDied) continue;
        ++died;
        CHECK(ev.a == id);
        CHECK(ev.tick == 7u);
    }
    CHECK(died == 1);
    CHECK(finalize_deaths(reg, pool, bus, 8u) == 0);   // idempotent
}

// Defect 3 — one cooldown decrement, for every mob, whether or not it can attack.
// The reference decremented attackCd at ~60 sites, several as max() floors, so
// some monsters out-attacked their own authored rate.
static void test_melee_cooldown_and_reach() {
    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();

    NpcId pid = pool.spawn();
    pool.hp(pid) = 30000;         // enough to survive the whole test
    pool.max_hp(pid) = 30000;
    Entity player = embody_as_player(reg, pool, pid, 0);
    const vec3 ppos = reg.get<Transform>(player).pos;

    const std::uint8_t kind = static_cast<std::uint8_t>(MobKind::Tvar);
    const MobDef& def = kMobTable[kind];
    const float dt = 1.0f / 120.0f;
    const std::uint16_t step = static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

    // Far mob: must never land a hit, but its cooldown must still run down.
    Entity far = reg.create();
    Transform ft;
    ft.pos = vec3{ppos.x + 60.0f, ppos.y, ppos.z};
    ft.layer = 0;
    reg.emplace<Transform>(far, ft);
    reg.emplace<MobRef>(far, MobRef{kind, 1, 100, 100});
    reg.emplace<MobCombat>(far, MobCombat{500});

    CHECK(mob_attack_step(reg, pool, bus, 0, dt, 0) == 0);
    CHECK(reg.get<MobCombat>(far).cooldownMs == 500 - step);
    CHECK(pool.hp(pid) == 30000);

    // Adjacent mob with an expired cooldown hits on the first pass.
    Entity adj = reg.create();
    Transform nt;
    nt.pos = ppos;
    nt.layer = 0;
    reg.emplace<Transform>(adj, nt);
    reg.emplace<MobRef>(adj, MobRef{kind, 1, 100, 100});
    reg.emplace<MobCombat>(adj, MobCombat{0});

    CHECK(mob_attack_step(reg, pool, bus, 0, dt, 1) == 1);
    const std::int16_t expect = static_cast<std::int16_t>(
        mob_hp_at_level(def.dmg, 1));
    CHECK(pool.hp(pid) == 30000 - expect);
    // Reset to the AUTHORED rate — not to zero, and not through a max() floor.
    CHECK(reg.get<MobCombat>(adj).cooldownMs == def.attackCdMs);

    // It may not swing again until the whole cooldown has elapsed. This is the
    // defect: run one pass short of it and assert no second hit.
    const std::int16_t hpAfterFirst = pool.hp(pid);
    const int passes = static_cast<int>(def.attackCdMs / step);
    for (int i = 0; i < passes - 1; ++i)
        CHECK(mob_attack_step(reg, pool, bus, 0, dt, 2u + static_cast<std::uint64_t>(i))
              == 0);
    CHECK(pool.hp(pid) == hpAfterFirst);
    // ...and then exactly one more, once it has.
    std::uint32_t later = 0;
    for (int i = 0; i < 3; ++i)
        later += mob_attack_step(reg, pool, bus, 0, dt,
                                100u + static_cast<std::uint64_t>(i));
    CHECK(later == 1);
}

// ---- Item table + the greed loop -------------------------------------------

static void test_item_table() {
    // 446, not the ~434 items.md and the reference's own desdoc.md both claim, and
    // not the 253 in its balance.md. Compile-time, so it belongs to the build.
    static_assert(kItemCount == 446, "446 items ([items.md])");
    static_assert(kMeleeCount == 23, "23 melee weapons, 22 of them items");

    CHECK(kItemTable.size() == kItemCount);
    CHECK(kItemNames.size() == kItemCount);

    // Ids are 1-based because ItemSlot::item == 0 already means "empty slot".
    CHECK(!item_valid(kInvalidItem));
    CHECK(item_valid(1));
    CHECK(item_valid(static_cast<ItemId>(kItemCount)));
    CHECK(!item_valid(static_cast<ItemId>(kItemCount + 1)));

    int weapons = 0, healers = 0, armoured = 0, spawnable = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const ItemDef& d = item_def(id);

        CHECK(item_name(id) != nullptr && item_name(id)[0] != '\0');
        CHECK(d.category < static_cast<std::uint8_t>(ItemCategory::Count));
        CHECK(d.equipSlot < static_cast<std::uint8_t>(EquipSlot::Count));
        CHECK(d.useEffect < static_cast<std::uint8_t>(UseEffect::Count));
        CHECK(d.stackMax >= 1);
        CHECK(d.value >= 0 && d.value <= 500000);

        if (d.category == static_cast<std::uint8_t>(ItemCategory::Weapon)) ++weapons;
        if (d.useEffect == static_cast<std::uint8_t>(UseEffect::Heal) && d.useA > 0)
            ++healers;
        for (std::size_t c = 0; c < kItemResistChannels; ++c)
            if (d.resist[c] != 0) { ++armoured; break; }
        if (d.spawnWeight > 0) ++spawnable;
    }
    // Census pins, so a truncated or duplicated regenerate fails here rather than
    // passing every per-row check.
    CHECK(weapons == 88);
    CHECK(healers == 12);
    CHECK(armoured == 5);
    CHECK(spawnable == 355);
}

// Depth gating is the greed loop: value rises with depth, and NOT via a hard cut.
static void test_economy_bands_gate_by_depth() {
    CHECK(economy_band(0) == 0);
    CHECK(economy_band(3) == 0);
    CHECK(economy_band(-3) == 0);      // symmetric: driven by |floor|
    CHECK(economy_band(4) == 1);
    CHECK(economy_band(-40) == 4);
    CHECK(economy_band(127) == 4);     // saturates, never overruns the array
    for (int z = -60; z <= 60; ++z) {
        CHECK(economy_band(z) < kEconomyBands);
        CHECK(economy_band(z) == economy_band(-z));
    }

    // Find a genuinely expensive spawnable item and show it is rarer shallow than
    // deep — that is the whole mechanic.
    ItemId pricey = kInvalidItem;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const ItemDef& d = item_def(id);
        if (d.spawnWeight > 0 && d.value > 5000) { pricey = id; break; }
    }
    CHECK(pricey != kInvalidItem);
    const std::uint32_t shallow = item_weight_on_floor(pricey, 0, 0);
    const std::uint32_t deep = item_weight_on_floor(pricey, 50, 0);
    CHECK(deep > shallow);
    // Decay, not a cut: at its own band the weight is exactly the authored one.
    CHECK(deep == item_def(pricey).spawnWeight);

    // A cheap item is unaffected by depth — the gate only bites above the cap.
    ItemId cheap = kInvalidItem;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        if (item_def(id).spawnWeight > 0 && item_def(id).value <= 50) {
            cheap = id;
            break;
        }
    }
    CHECK(cheap != kInvalidItem);
    CHECK(item_weight_on_floor(cheap, 0, 0) == item_def(cheap).spawnWeight);
    CHECK(item_weight_on_floor(cheap, 50, 0) == item_def(cheap).spawnWeight);

    // Weight 0 means never random, whatever the floor.
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        if (item_def(id).spawnWeight == 0)
            CHECK(item_weight_on_floor(id, 30, 0) == 0);
    }
    CHECK(item_weight_on_floor(kInvalidItem, 0, 0) == 0);
}

// Loot must drop in the window between "died" and "destroyed" — the reason the
// Dead tag exists at all. The reference's P0 was culling an entity before its loot
// hook ran; this asserts the ordering that makes that impossible.
static void test_loot_drops_before_the_corpse_is_gone() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 5u);
    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();

    NpcId pid = pool.spawn();
    pool.hp(pid) = 500;
    pool.max_hp(pid) = 500;
    Entity player = embody_as_player(reg, pool, pid, 0);
    const vec3 ppos = reg.get<Transform>(player).pos;

    // A Boss dies right next to the player: 5 rolls at 100% means it always pays.
    Entity boss = reg.create();
    Transform bt;
    bt.pos = ppos;
    bt.layer = 0;
    reg.emplace<Transform>(boss, bt);
    reg.emplace<MobRef>(boss,
                        MobRef{static_cast<std::uint8_t>(MobKind::Mancobus), 1, 5, 5});
    CHECK(kMobTable[static_cast<std::uint8_t>(MobKind::Mancobus)].tier ==
          static_cast<std::uint8_t>(MobTier::Boss));

    DamageResult r = apply_damage(reg, pool, boss, 999, DamageChannel::Kinetic,
                                  player);
    CHECK(r.lethal);
    CHECK(reg.valid(boss));       // tagged, not gone — this is the window

    const std::uint32_t dropped = loot_dead_mobs(reg, 0, /*floor=*/0, 1234u);
    CHECK(dropped > 0);           // a boss always pays out

    // Only NOW is the corpse destroyed, and the loot outlives it.
    CHECK(finalize_deaths(reg, pool, bus, 1u) == 1);
    CHECK(!reg.valid(boss));
    std::uint32_t onFloor = 0;
    for (auto e : reg.view<const Pickup>()) { (void)e; ++onFloor; }
    CHECK(onFloor == dropped);

    // Sweeping it up moves value into the pool row, which is canonical and folds
    // back on floor exit.
    CHECK(inventory_value(pool.inventory(pid)) == 0);
    const std::int32_t gained = pickup_step(reg, pool, bus, 0, 2u);
    CHECK(gained >= 0);
    CHECK(inventory_value(pool.inventory(pid)) == gained);
    // Everything in reach is gone from the floor.
    std::uint32_t left = 0;
    for (auto e : reg.view<const Pickup>()) { (void)e; ++left; }
    CHECK(left < dropped || dropped == 0);
}

// Healing: use the smallest item that covers the wound, and report what landed.
static void test_heal_picks_the_right_item() {
    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();

    NpcId pid = pool.spawn();
    pool.max_hp(pid) = 100;
    pool.hp(pid) = 100;
    embody_as_player(reg, pool, pid, 0);

    // Collect a small and a large healer straight from the table.
    ItemId small = kInvalidItem, large = kInvalidItem;
    std::int16_t smallAmt = 0, largeAmt = 0;
    for (std::size_t i = 0; i < kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i + 1);
        const ItemDef& d = item_def(id);
        if (d.useEffect != static_cast<std::uint8_t>(UseEffect::Heal)) continue;
        if (d.useA <= 0) continue;
        if (small == kInvalidItem || d.useA < smallAmt) {
            small = id;
            smallAmt = static_cast<std::int16_t>(d.useA);
        }
        if (large == kInvalidItem || d.useA > largeAmt) {
            large = id;
            largeAmt = static_cast<std::int16_t>(d.useA);
        }
    }
    CHECK(small != kInvalidItem && large != kInvalidItem && largeAmt > smallAmt);

    // At full health nothing is spent — a bandage is not burned on a scratch that
    // does not exist.
    Inventory& inv = pool.inventory(pid);
    inv.slots[0] = ItemSlot{small, 1};
    inv.slots[1] = ItemSlot{large, 1};
    CHECK(use_best_heal(reg, pool, bus, 0, 1u) == 0);
    CHECK(inv.slots[0].item == small && inv.slots[1].item == large);

    // A small wound spends the small item, and the return value is what LANDED,
    // clamped to the wound rather than the item's label.
    pool.hp(pid) = static_cast<std::int16_t>(100 - smallAmt);
    const std::int16_t got = use_best_heal(reg, pool, bus, 0, 2u);
    CHECK(got == smallAmt);
    CHECK(pool.hp(pid) == 100);
    CHECK(inv.slots[0].item == kInvalidItem);   // consumed
    CHECK(inv.slots[1].item == large);          // the big one was NOT wasted

    // Overheal is clamped and reported honestly.
    pool.hp(pid) = 99;
    const std::int16_t over = use_best_heal(reg, pool, bus, 0, 3u);
    CHECK(over == 1);                 // not largeAmt
    CHECK(pool.hp(pid) == 100);
    CHECK(pool.hp(pid) <= pool.max_hp(pid));

    // Nothing left to heal with.
    pool.hp(pid) = 50;
    CHECK(use_best_heal(reg, pool, bus, 0, 4u) == 0);
}

// Loot has to MATTER: a found weapon must hit harder than fists, and found armour
// must actually reduce the damage that lands. That is the whole reason to pick
// anything up, so it is asserted rather than assumed.
static void test_loadout_changes_the_numbers() {
    // Every melee row is sane and reachable, and the sparse index is consistent
    // both ways — a rename in the CSV would otherwise silently orphan the stats.
    CHECK(kMeleeTable.size() == kMeleeCount);
    CHECK(kMeleeByItem.size() == kItemCount + 1);
    int linked = 0;
    for (std::size_t i = 0; i <= kItemCount; ++i) {
        const std::uint8_t mi = kMeleeByItem[i];
        CHECK(mi < kMeleeCount);
        if (mi == 0) continue;
        ++linked;
        // Index 0 is unarmed and must never be reachable via an item.
        CHECK(melee_for_item(static_cast<ItemId>(i)) == &kMeleeTable[mi]);
    }
    CHECK(linked == 22);                     // 22 item-backed + fists
    CHECK(melee_for_item(kInvalidItem) == nullptr);
    for (const MeleeDef& m : kMeleeTable) {
        CHECK(m.dmg >= 1 && m.dmg <= 4000);
        CHECK(m.reachMm >= 100 && m.reachMm <= 4000);
        CHECK(m.cooldownMs >= 50);
    }

    // Fists are deliberately feeble, so anything at all is an upgrade.
    const MeleeDef& fist = unarmed_melee();
    CHECK(fist.dmg == 3);
    for (std::size_t i = 1; i < kMeleeCount; ++i)
        CHECK(kMeleeTable[i].dmg > fist.dmg);

    // equipped_melee picks the hardest hitter present, and ignores non-weapons.
    Inventory inv;
    CHECK(equipped_melee(inv) == kInvalidItem);      // bare hands

    ItemId weak = kInvalidItem, strong = kInvalidItem;
    std::uint16_t weakD = 0xFFFF, strongD = 0;
    for (std::size_t i = 1; i <= kItemCount; ++i) {
        const ItemId id = static_cast<ItemId>(i);
        const MeleeDef* m = melee_for_item(id);
        if (!m) continue;
        if (m->dmg < weakD) { weakD = m->dmg; weak = id; }
        if (m->dmg > strongD) { strongD = m->dmg; strong = id; }
    }
    CHECK(weak != kInvalidItem && strong != kInvalidItem && strongD > weakD);

    inv.slots[0] = ItemSlot{weak, 1};
    CHECK(equipped_melee(inv) == weak);
    inv.slots[1] = ItemSlot{strong, 1};
    CHECK(equipped_melee(inv) == strong);            // upgrade wins
    // A zero-count slot is not held, even if the id is still in it.
    inv.slots[1].count = 0;
    CHECK(equipped_melee(inv) == weak);

    // Armour: resistances were in the item table all along; sync_armour is what
    // finally feeds mitigation. 5 of 446 items carry them.
    ItemId vest = equipped_armour(inv);
    CHECK(vest == kInvalidItem);                    // no armour among weapons

    ItemId best = kInvalidItem;
    int bestSum = 0;
    for (std::size_t i = 1; i <= kItemCount; ++i) {
        const ItemDef& d = item_def(static_cast<ItemId>(i));
        int sum = 0;
        for (std::size_t c = 0; c < kItemResistChannels; ++c) sum += d.resist[c];
        if (sum > bestSum) { bestSum = sum; best = static_cast<ItemId>(i); }
    }
    CHECK(best != kInvalidItem && bestSum > 0);

    NpcPool pool;
    pool.init();
    Registry reg;
    NpcId id = pool.spawn();
    pool.hp(id) = 1000;
    pool.max_hp(id) = 1000;
    Entity e = embody(reg, pool, id, 0);

    // Unarmoured baseline.
    sync_armour(reg, pool, e);
    CHECK(!reg.all_of<Armour>(e));
    const std::int16_t bare =
        apply_damage(reg, pool, e, 100, DamageChannel::Kinetic, entt::null).applied;
    CHECK(bare == 100);

    // Now wear the best armour and take the same hit.
    pool.inventory(id).slots[0] = ItemSlot{best, 1};
    sync_armour(reg, pool, e);
    CHECK(reg.all_of<Armour>(e));
    const std::int16_t worn =
        apply_damage(reg, pool, e, 100, DamageChannel::Kinetic, entt::null).applied;
    CHECK(worn < bare);        // armour actually protects

    // Taking it off removes the component again, rather than leaving stale resists.
    pool.inventory(id).slots[0] = ItemSlot{};
    sync_armour(reg, pool, e);
    CHECK(!reg.all_of<Armour>(e));
}

// Each floor kind must write ITS OWN materials, or every floor renders in the same
// palette however good that palette is. Asserted headless, because a screenshot only
// ever proves the one floor you happened to be standing on.
static void test_floor_kinds_use_distinct_materials() {
    std::vector<std::vector<CellType>> perKind;
    for (int k = 0; k < static_cast<int>(FloorKind::Count); ++k) {
        World w;
        generate_floor(w, /*number=*/k, floor_spec(static_cast<FloorKind>(k)),
                       4242u);

        bool seen[kMatCount] = {};
        for (CellType t : w.grid().types())
            if (t != kCellAir && t < kMatCount) seen[t] = true;

        std::vector<CellType> used;
        for (CellType t = 1; t < kMatCount; ++t)
            if (seen[t]) used.push_back(t);
        CHECK(!used.empty());               // a floor made of nothing is a bug
        perKind.push_back(used);
    }

    // No two kinds may write the same material set — that was exactly the defect:
    // all four wrote {concrete, tan slab} and rendered identically.
    for (std::size_t a = 0; a < perKind.size(); ++a)
        for (std::size_t b = a + 1; b < perKind.size(); ++b)
            CHECK(perKind[a] != perKind[b]);

    // The ids must be the khrushchevka range, not the maze demo's. A kind writing
    // kMatConcrete or kMatSlabTan again has regressed to the shared palette.
    for (const auto& used : perKind)
        for (CellType t : used) {
            CHECK(t != kMatConcrete);
            CHECK(t != kMatSlabTan);
            // kMatExtract (5) is the deliberate third exception: it reuses a free
            // low id so kMatCount and the count-drift checks stay put. See
            // world/materials.h for why extraction could not reuse kMatHubPad.
            CHECK(t >= kMatPlaster || t == kMatHubPad || t == kMatExtract);
        }

    // Spot-check both extremes against the table.
    World res, der;
    generate_floor(res, 0, floor_spec(FloorKind::Residential), 7u);
    generate_floor(der, 3, floor_spec(FloorKind::Derelict), 7u);
    auto has = [](const World& w, CellType t) {
        for (CellType c : w.grid().types())
            if (c == t) return true;
        return false;
    };
    CHECK(has(res, kMatPlaster) && has(res, kMatParquet));
    CHECK(has(der, kMatRust) && has(der, kMatRubble));
    CHECK(!has(res, kMatRust));
    CHECK(!has(der, kMatPlaster));
}


// Ranged monsters: the windup is the contract. 13 of the 69 kinds shoot, and a
// shot that lands with no warning is the difference between tense and unfair.
static void test_ranged_windup_and_deadzone() {
    // Every ranged kind must carry all three numbers, and no melee-only kind may.
    int ranged = 0;
    for (std::size_t i = 0; i < kMobKindCount; ++i) {
        const MobDef& m = kMobTable[i];
        const bool isRanged = has_flag(m.aiFlags, AiFlag::Ranged);
        if (isRanged) {
            ++ranged;
            CHECK(m.shotRangeMm > 0);
            CHECK(m.windupMs > 0);
            CHECK(m.projSpeedMmps > 0);
            // The dead zone must sit inside the shot range or the band is empty.
            CHECK(m.minRangeMm < m.shotRangeMm);
            // And outside melee reach, or the kind could never choose to shoot.
            CHECK(m.shotRangeMm > m.meleeReachMm);
        } else {
            CHECK(m.shotRangeMm == 0 && m.minRangeMm == 0 && m.windupMs == 0);
        }
    }
    CHECK(ranged == 13);

    NpcPool pool;
    pool.init();
    Registry reg;
    EventBus bus;
    bus.init();
    LevelStack stack;
    LayerId layer = stack.push_layer();

    NpcId pid = pool.spawn();
    pool.hp(pid) = 30000;
    pool.max_hp(pid) = 30000;
    Entity player = embody_as_player(reg, pool, pid, layer);
    const vec3 ppos = reg.get<Transform>(player).pos;

    // An Eye: 15 cells max, 1.5 min, 0.85 s windup.
    const std::uint8_t kind = static_cast<std::uint8_t>(MobKind::Eye);
    const MobDef& def = kMobTable[kind];
    CHECK(has_flag(def.aiFlags, AiFlag::Ranged));

    auto place = [&](float metres) {
        Entity e = reg.create();
        Transform t;
        t.pos = vec3{ppos.x + metres, ppos.y, ppos.z};
        t.layer = layer;
        reg.emplace<Transform>(e, t);
        reg.emplace<MobRef>(e, MobRef{kind, 1, 500, 500});
        reg.emplace<MobCombat>(e, MobCombat{0, 0});
        return e;
    };

    const float dt = 1.0f / 120.0f;
    const std::uint16_t step = static_cast<std::uint16_t>(dt * 1000.0f + 0.5f);

    // Inside the band. The first pass must NOT fire — it starts the telegraph.
    Entity shooter = place(12.0f);
    // The first pass starts the telegraph and fires NOTHING. That is the point.
    CHECK(mob_attack_step(reg, pool, bus, layer, dt, 0) == 0);
    CHECK(reg.get<MobCombat>(shooter).windupMs == def.windupMs);
    std::uint32_t inFlight = 0;
    for (auto e : reg.view<const Projectile>()) { (void)e; ++inFlight; }
    CHECK(inFlight == 0);            // telegraphing, nothing launched yet

    // Run the telegraph down. NOTHING may launch on any pass while it runs — that
    // is the whole guarantee, so it is checked on every pass rather than at the end.
    const int passes = static_cast<int>(def.windupMs / step);
    for (int i = 0; i < passes; ++i) {
        mob_attack_step(reg, pool, bus, layer, dt,
                        1u + static_cast<std::uint64_t>(i));
        std::uint32_t f = 0;
        for (auto e : reg.view<const Projectile>()) { (void)e; ++f; }
        CHECK(f == 0);
    }
    CHECK(reg.get<MobCombat>(shooter).windupMs > 0);   // a remainder is still due
    // The pass that finishes the windup is the pass that fires.
    mob_attack_step(reg, pool, bus, layer, dt, 500u);
    CHECK(reg.get<MobCombat>(shooter).windupMs == 0);
    inFlight = 0;
    for (auto e : reg.view<const Projectile>()) { (void)e; ++inFlight; }
    CHECK(inFlight >= 1);

    // A shot must not damage on the frame it is fired, and must be able to reach.
    CHECK(pool.hp(pid) == 30000);
    std::int16_t before = pool.hp(pid);
    for (int i = 0; i < 400 && pool.hp(pid) == before; ++i)
        projectile_step(reg, pool, bus, stack, layer, dt,
                        600u + static_cast<std::uint64_t>(i));
    CHECK(pool.hp(pid) < before);    // it connected

    // Nothing lives forever: every projectile is eventually gone.
    for (int i = 0; i < 1000; ++i)
        projectile_step(reg, pool, bus, stack, layer, dt,
                        2000u + static_cast<std::uint64_t>(i));
    inFlight = 0;
    for (auto e : reg.view<const Projectile>()) { (void)e; ++inFlight; }
    CHECK(inFlight == 0);

    // Leaving the band mid-windup ABORTS the shot rather than banking it.
    Registry r2;
    NpcPool p2;
    p2.init();
    NpcId pid2 = p2.spawn();
    p2.hp(pid2) = 30000;
    p2.max_hp(pid2) = 30000;
    Entity pl2 = embody_as_player(r2, p2, pid2, layer);
    const vec3 pp2 = r2.get<Transform>(pl2).pos;

    Entity s2 = r2.create();
    Transform t2;
    t2.pos = vec3{pp2.x + 12.0f, pp2.y, pp2.z};
    t2.layer = layer;
    r2.emplace<Transform>(s2, t2);
    r2.emplace<MobRef>(s2, MobRef{kind, 1, 500, 500});
    r2.emplace<MobCombat>(s2, MobCombat{0, 0});

    mob_attack_step(r2, p2, bus, layer, dt, 0);
    CHECK(r2.get<MobCombat>(s2).windupMs > 0);   // telegraphing
    // Walk it far out of range; the next pass must clear the windup.
    r2.get<Transform>(s2).pos.x = pp2.x + 200.0f;
    mob_attack_step(r2, p2, bus, layer, dt, 1);
    CHECK(r2.get<MobCombat>(s2).windupMs == 0);
    std::uint32_t shots = 0;
    for (auto e : r2.view<const Projectile>()) { (void)e; ++shots; }
    CHECK(shots == 0);                            // aborted, not banked
}


// The relations matrix. The load-bearing assertion is the hostile-pair COUNT: every
// Wild cell sits exactly on the -50 boundary, so a strict `<` instead of `<=` leaves
// the matrix with zero hostile pairs and the whole system silently does nothing.
// Counting them is the only check that catches that, and it is why it is first.
static void test_faction_relations() {
    static_assert(kRelFactionCount == 6, "five factions plus the player row");
    static_assert(sizeof(FactionRelations) == 36);

    FactionRelations m = kBaseFactionMatrix;

    // Symmetric, and nobody is hostile to themselves.
    for (std::uint8_t a = 0; a < kRelFactionCount; ++a) {
        CHECK(!m.hostile(a, a));
        for (std::uint8_t b = 0; b < kRelFactionCount; ++b)
            CHECK(m.at(a, b) == m.at(b, a));
    }

    // Exactly six hostile unordered pairs at t=0.
    int pairs = 0;
    for (std::uint8_t a = 0; a < kRelFactionCount; ++a)
        for (std::uint8_t b = static_cast<std::uint8_t>(a + 1);
             b < kRelFactionCount; ++b)
            if (m.hostile(a, b)) ++pairs;
    CHECK(pairs == 6);

    const std::uint8_t cit = static_cast<std::uint8_t>(Faction::Citizens);
    const std::uint8_t liq = static_cast<std::uint8_t>(Faction::Liquidators);
    const std::uint8_t cul = static_cast<std::uint8_t>(Faction::Cultists);
    const std::uint8_t sci = static_cast<std::uint8_t>(Faction::Scientists);
    const std::uint8_t wld = static_cast<std::uint8_t>(Faction::Wild);
    const std::uint8_t ply = kFactionPlayerRow;

    // Wild against everyone; cultists against the police only.
    CHECK(m.hostile(wld, cit) && m.hostile(wld, liq) && m.hostile(wld, cul));
    CHECK(m.hostile(wld, sci) && m.hostile(wld, ply));
    CHECK(m.hostile(cul, liq));
    // Cultists are cold-neutral to citizens, NOT hostile — they live among them.
    CHECK(!m.hostile(cul, cit));
    CHECK(m.at(cul, cit) == 0);
    // The civil bloc.
    CHECK(m.at(cit, liq) == 50 && m.at(cit, sci) == 50 && m.at(liq, sci) == 50);
    // The boundary itself is inclusive: exactly -50 IS hostile.
    CHECK(m.at(wld, cit) == kHostileRelation);
    CHECK(m.hostile(wld, cit));

    // Mutation is symmetric and clamped.
    CHECK(m.add_mutual(cit, liq, -30) == 20);
    CHECK(m.at(cit, liq) == 20 && m.at(liq, cit) == 20);
    CHECK(m.add_mutual(cit, liq, -10000) == -128);   // clamps, does not wrap
    CHECK(m.add_mutual(cit, liq, 100000) == 127);

    // Rebirth: the player's row and column reset; the world's memory does not.
    m.reset();
    m.add_mutual(cit, liq, -30);          // the world bends
    m.add_mutual(ply, liq, -30);          // and so does the player's standing
    CHECK(m.at(cit, liq) == 20);
    CHECK(m.at(ply, liq) == -5);
    m.reset_player_row_col();
    CHECK(m.at(cit, liq) == 20);          // survived — this is the point
    CHECK(m.at(ply, liq) == 25);          // back to authored
    CHECK(m.at(liq, ply) == 25);          // and the column too

    // Monsters: cultists are the one society they leave alone.
    CHECK(kMobVsFaction[cul] > 0);
    CHECK(kMobVsFaction[cit] <= kHostileRelation);
    CHECK(kMobVsFaction[ply] <= kHostileRelation);

    // rel_row is driven by the NpcPlayer BIT, not by an id — which is what lets the
    // player have a matrix row without being a singleton.
    NpcPool pool;
    pool.init();
    NpcId a = pool.spawn();
    NpcId b = pool.spawn();
    pool.faction(a) = static_cast<std::uint16_t>(Faction::Cultists);
    pool.faction(b) = static_cast<std::uint16_t>(Faction::Citizens);
    CHECK(rel_row(pool, a) == cul);
    CHECK(!mob_hostile_to(pool, a));      // a cultist is safe from monsters
    CHECK(mob_hostile_to(pool, b));

    pool.set_player(a, true);
    CHECK(rel_row(pool, a) == ply);       // the bit moved the row
    CHECK(mob_hostile_to(pool, a));       // and being the player is never safe
    pool.set_player(a, false);
    CHECK(rel_row(pool, a) == cul);       // and back

    // An out-of-range faction folds rather than reading past the matrix.
    pool.faction(b) = 999;
    CHECK(rel_row(pool, b) < kFactionCount);
}


// Extraction. The mechanic is "value is not yours until it is banked", so the tests
// that matter are the two that keep it from quietly becoming pointless:
//   1. banking must never take your equipped kit (if it did, never banking would be
//      optimal and the whole system would be dead on arrival), and
//   2. a death must be recorded as a LOSS, because an invisible cost is not a cost.
static void test_extraction() {
    // Find one real item of each shape we care about, from the live table rather
    // than by hardcoding an id — 446 rows generated from CSV will renumber.
    ItemId misc = 0, food = 0, wpn = 0, key = 0;
    for (ItemId i = 1; i <= kItemCount; ++i) {
        const ItemDef& d = item_def(i);
        if (d.value <= 0) continue;
        const ItemCategory c = static_cast<ItemCategory>(d.category);
        if (!misc && c == ItemCategory::Misc) misc = i;
        if (!food && c == ItemCategory::Food) food = i;
        // Must be a weapon `equipped_melee` will actually SELECT, which means one of
        // the 23 rows in the melee table — not merely any Weapon-category item. My
        // first attempt picked the latter and the test failed for the right reason.
        if (!wpn && melee_for_item(i) != nullptr) wpn = i;
        if (!key && c == ItemCategory::Key) key = i;
    }
    CHECK(misc && food && wpn);   // Key may legitimately be valueless; the rest are not

    CHECK(bankable_category(ItemCategory::Misc));
    CHECK(bankable_category(ItemCategory::Weapon));
    CHECK(bankable_category(ItemCategory::Tool));
    CHECK(!bankable_category(ItemCategory::Food));
    CHECK(!bankable_category(ItemCategory::Drink));
    CHECK(!bankable_category(ItemCategory::Medicine));
    CHECK(!bankable_category(ItemCategory::Ammo));
    CHECK(!bankable_category(ItemCategory::Key));   // a route key is progress, not money

    RunLedger led;
    Inventory inv;
    inv.slots[0] = ItemSlot{misc, 1};
    inv.slots[1] = ItemSlot{food, 2};
    inv.slots[2] = ItemSlot{wpn, 1};

    const std::int32_t before = at_risk_value(inv);
    const std::int32_t mv = item_def(misc).value;
    const std::int32_t fv = item_def(food).value * 2;
    const std::int32_t wv = item_def(wpn).value;
    CHECK(before == mv + fv + wv);

    // The weapon is equipped, so it must survive the deposit; the misc item must not.
    CHECK(equipped_melee(inv) == wpn);
    const std::int32_t got = deposit_valuables(inv, led);
    CHECK(got == mv);                       // ONLY the haul
    CHECK(led.banked == mv);
    CHECK(led.bestHaul == mv);
    CHECK(led.deposits == 1);
    CHECK(equipped_melee(inv) == wpn);      // still armed — the load-bearing assertion
    CHECK(at_risk_value(inv) == fv + wv);   // food and the weapon stayed

    // Banking again with nothing bankable left is a no-op, not a phantom deposit.
    // This runs every tick you stand on the pad, so a false deposit would inflate
    // the count without limit.
    CHECK(deposit_valuables(inv, led) == 0);
    CHECK(led.deposits == 1);

    // A death takes everything still carried, kit included.
    record_death(led, inv);
    CHECK(led.deaths == 1);
    CHECK(led.lostToDeath == fv + wv);
    CHECK(led.banked == mv);                // banked value survives the death

    // Greed reading. Carrying nothing is safe, not maximally endangered.
    CHECK(risk_share(led, 0) == 0.0f);
    RunLedger fresh;
    CHECK(risk_share(fresh, 500) > 0.99f);  // nothing banked: a death costs everything
    fresh.banked = 9500;
    const float half = risk_share(fresh, 500);
    CHECK(half > 0.04f && half < 0.06f);    // 500 / 10000

    // Depth tracking is on |z| — the roof is as far from safety as the basement.
    RunLedger d;
    record_floor(d, -3);
    CHECK(d.deepestFloor == -3);
    record_floor(d, 1);
    CHECK(d.deepestFloor == -3);            // shallower, ignored
    record_floor(d, 9);
    CHECK(d.deepestFloor == 9);             // |9| > |-3|
    CHECK(d.deepestBand == economy_band(9));
    record_floor(d, -9);
    CHECK(d.deepestFloor == 9);             // equal magnitude does not overwrite
}


// Can the player ever actually stand on an extraction pad?
//
// This test exists because the answer was NO for the first version, and nothing
// caught it: the mechanic was pointed at kMatHubPad, which the generator stamps onto
// the slab at the four lattice z-levels {16,48,80,112}, while a body walks at cell
// z=1. The pad was permanently 30 m above the player's feet. No crash, no warning,
// no failing test — banking would simply never have fired, and the only symptom
// would have been a player wondering why the number never went up.
//
// So the assertion is deliberately about REACHABILITY, at the height a body really
// occupies, against the real generator. A unit test of deposit_valuables cannot
// catch this class of bug and neither can the compiler.
static void test_extraction_reachable() {
    World hub;
    generate_floor(hub, 0, floor_spec(FloorKind::Residential), 1u);

    // Walkable ground is cell z=1: the storey-0 slab is z=0 and a body stands on it.
    const float standZ = 1.5f * kCellSize;
    int reachable = 0;
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x) {
            if (hub.grid().cell(x, y, 1) != kCellAir) continue;   // must be standable
            const vec3 p{(x + 0.5f) * kCellSize, (y + 0.5f) * kCellSize, standZ};
            if (on_extraction_pad(hub.grid(), p)) ++reachable;
        }
    // 16 shafts x (7x7 lobby minus the 3x3 shaft hole) = 16 x 40 = 640 cells. Assert
    // a floor rather than the exact number: the lobby radius is the generator's to
    // tune, but "hundreds of cells, spread over all 16 lobbies" is the contract.
    if (reachable <= 400)
        std::printf("  extraction ring reachable cells: %d (want >400)\n", reachable);
    CHECK(reachable > 400);

    // And the ring is ONLY on the hub. A looting floor that banked would delete the
    // entire risk half of the loop, so this is as load-bearing as the line above.
    World deep;
    generate_floor(deep, -7, floor_spec(FloorKind::Derelict), 3u);
    int leaked = 0;
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x) {
            if (deep.grid().cell(x, y, 1) != kCellAir) continue;
            const vec3 p{(x + 0.5f) * kCellSize, (y + 0.5f) * kCellSize, standZ};
            if (on_extraction_pad(deep.grid(), p)) ++leaked;
        }
    CHECK(leaked == 0);

    // The nav pads must still be there and must still NOT bank: they are a
    // different material for a reason, and this pins the two apart.
    static_assert(kMatExtract != kMatHubPad, "the bank and the nav pad must differ");
    int navPads = 0;
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x)
            if (hub.grid().cell(x, y, 16) == kMatHubPad) ++navPads;
    CHECK(navPads > 0);
}


// Behaviour dispatch, wave 1. Every function under test is pure, which is exactly
// why this wave was chosen first: no world, no registry, no tick needed to pin any
// of it, and nothing here can desynchronise from anything.
static void test_mob_behaviour() {
    // --- encirclement -----------------------------------------------------
    // The property that matters is SPREAD: before this, every aggroed monster
    // steered at the same point and a group converged into one cell. Assert that a
    // crowd of Помойный Рой takes distinct ring slots, because "it compiles and
    // returns a vector" would pass with a constant.
    bool slotSeen[8] = {false};
    for (std::uint32_t m = 0; m < 512; ++m) {
        const PursuitOffset o =
            pursuit_offset(MobBehaviour::GarbageSurround, m, 7u, 1.0f, 0.0f);
        const float r = std::sqrt(o.x * o.x + o.y * o.y);
        CHECK(r > 1.6f && r < 1.7f);          // on the 1.65 m ring
        // Recover the slot from the angle and mark it.
        int best = 0;
        float bestDot = -2.0f;
        const float ring[8][2] = {{1,0},{0.7071068f,0.7071068f},{0,1},
                                  {-0.7071068f,0.7071068f},{-1,0},
                                  {-0.7071068f,-0.7071068f},{0,-1},
                                  {0.7071068f,-0.7071068f}};
        for (int i = 0; i < 8; ++i) {
            const float d = (o.x / r) * ring[i][0] + (o.y / r) * ring[i][1];
            if (d > bestDot) { bestDot = d; best = i; }
        }
        slotSeen[best] = true;
    }
    for (int i = 0; i < 8; ++i) CHECK(slotSeen[i]);   // all 8 slots used

    // Stable: the same pair must always produce the same slot, or the ring would
    // shimmer every frame and read as jitter rather than as encirclement.
    const PursuitOffset a1 = pursuit_offset(MobBehaviour::GarbageSurround, 42u, 7u, 1, 0);
    const PursuitOffset a2 = pursuit_offset(MobBehaviour::GarbageSurround, 42u, 7u, 1, 0);
    CHECK(a1.x == a2.x && a1.y == a2.y);
    // ...and different targets must pull a different slot, so a rat pack that
    // switches victim re-forms rather than keeping its old shape.
    int differing = 0;
    for (std::uint32_t v = 0; v < 64; ++v) {
        const PursuitOffset o = pursuit_offset(MobBehaviour::GarbageSurround, 42u, v, 1, 0);
        if (o.x != a1.x || o.y != a1.y) ++differing;
    }
    CHECK(differing > 32);

    // Green dogs: the flank must be PERPENDICULAR to the approach, and both sides
    // must occur. A pack that all flanked the same way would just be an offset line.
    int left = 0, right = 0, behind = 0;
    for (std::uint32_t m = 0; m < 256; ++m) {
        const PursuitOffset o =
            pursuit_offset(MobBehaviour::GreenDogPack, m, 1u, 1.0f, 0.0f);
        if ((m & 3u) == 0u) {
            CHECK(o.x < 0.0f);                       // cuts in behind
            ++behind;
        } else {
            CHECK(std::fabs(o.x) < 1e-5f);           // no along-track component
            if (o.y > 0.0f) ++left; else ++right;
        }
    }
    CHECK(behind == 64);                             // exactly one in four
    CHECK(left > 40 && right > 40);                  // both flanks used
    // Degenerate direction must not divide by zero.
    const PursuitOffset z = pursuit_offset(MobBehaviour::GreenDogPack, 5u, 1u, 0, 0);
    CHECK(z.x == 0.0f && z.y == 0.0f);
    // Plain monsters are unaffected — this wave must not change 60-odd kinds by
    // accident.
    const PursuitOffset p = pursuit_offset(MobBehaviour::Plain, 3u, 4u, 1, 0);
    CHECK(p.x == 0.0f && p.y == 0.0f);

    // --- detect radius ----------------------------------------------------
    CHECK(behaviour_aggro_radius(MobBehaviour::DeadEcho, 20.0f) == 7.5f);
    CHECK(behaviour_aggro_radius(MobBehaviour::CloseReveal, 20.0f) == 6.0f);
    CHECK(behaviour_aggro_radius(MobBehaviour::Plain, 20.0f) == 20.0f);
    // Both overrides must SHRINK the radius. An override that grew it would make a
    // kind harder rather than sneakable, which is the opposite of the intent.
    CHECK(behaviour_aggro_radius(MobBehaviour::DeadEcho, 20.0f) < 20.0f);
    CHECK(behaviour_aggro_radius(MobBehaviour::CloseReveal, 20.0f) < 20.0f);

    // --- the gaze ---------------------------------------------------------
    // Looking straight at it, in range: frozen. This is the assertion that matters,
    // because Sculpture's row is 8.5 cells/s and 1000 damage — with the behaviour
    // unimplemented it sprinted in and one-shot the player with no counterplay.
    CHECK(frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f, 10.0f, 0.0f));
    // Just inside the 45-degree cone edge, and just outside it.
    CHECK(frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f, 10.0f, 9.0f));
    CHECK(!frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f, 10.0f, 11.0f));
    // Behind you: free to move. That is the entire mechanic.
    CHECK(!frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f, -10.0f, 0.0f));
    // Beyond 25 m it does not care whether you are looking.
    CHECK(!frozen_by_gaze(MobBehaviour::WeepingAngel, 1.0f, 0.0f, 30.0f, 0.0f));
    // Range is a circle, not a square: 20,20 is 28.3 m away and must NOT freeze.
    CHECK(!frozen_by_gaze(MobBehaviour::WeepingAngel, 0.7071068f, 0.7071068f,
                          20.0f, 20.0f));
    // No other kind is affected.
    CHECK(!frozen_by_gaze(MobBehaviour::Plain, 1.0f, 0.0f, 1.0f, 0.0f));

    // --- wall bias --------------------------------------------------------
    const std::uint32_t wb = static_cast<std::uint32_t>(AiFlag::WallBias);
    CHECK(wall_bias_speed(wb, true) > 1.0f);
    CHECK(wall_bias_speed(wb, false) < 1.0f);
    CHECK(wall_bias_speed(0u, true) == 1.0f);      // non-carriers untouched
    CHECK(wall_bias_damage(wb, true) > 1.0f);
    CHECK(wall_bias_damage(wb, false) == 1.0f);
    CHECK(wall_bias_damage(0u, true) == 1.0f);

    // --- the dead ones ----------------------------------------------------
    // Compiled rather than commented, so the finding cannot rot: these four have no
    // implementation in the reference to port. Naming them is worth more than
    // specifying them, because it stops the next pass re-deriving the same dead end.
    CHECK(behaviour_is_dead(MobBehaviour::Melee));
    CHECK(behaviour_is_dead(MobBehaviour::WeakWallBreach));
    CHECK(behaviour_is_dead(MobBehaviour::RangedClause));
    CHECK(behaviour_is_dead(MobBehaviour::SourceSwarm));
    CHECK(!behaviour_is_dead(MobBehaviour::Plain));
    CHECK(!behaviour_is_dead(MobBehaviour::GarbageSurround));
    // And the four implemented here must not be marked dead.
    CHECK(!behaviour_is_dead(MobBehaviour::GreenDogPack));
    CHECK(!behaviour_is_dead(MobBehaviour::WeepingAngel));
    CHECK(!behaviour_is_dead(MobBehaviour::DeadEcho));
    CHECK(!behaviour_is_dead(MobBehaviour::CloseReveal));

    // Every kind that carries a behaviour this wave dispatches must actually exist
    // in the table — otherwise the code is dispatching on a value no row uses and
    // the whole wave is dead on arrival, silently.
    int carriers = 0;
    for (std::size_t k = 0; k < kMobKindCount; ++k) {
        const MobBehaviour b = static_cast<MobBehaviour>(kMobTable[k].behaviour);
        if (b == MobBehaviour::GarbageSurround || b == MobBehaviour::GreenDogPack ||
            b == MobBehaviour::WeepingAngel || b == MobBehaviour::DeadEcho ||
            b == MobBehaviour::CloseReveal)
            ++carriers;
    }
    CHECK(carriers == 5);   // one kind each
}

int main() {
    test_inventory();
    test_pool_basics();
    test_pool_death_keeps_slot();
    test_relationships();
    test_design_flag();
    test_event_bus_transient();
    test_event_bus_overflow();
    test_event_bus_log();
    test_attribute_block();
    test_height_maps_to_body();
    test_embody_and_foldback();
    test_player_is_a_record();
    test_population_seed();
    test_floor_spec();
    test_seed_from_spec();
    test_floor_registry();
    test_lattice();
    test_floor_gen();
    test_elevator();
    test_floor_stream();
    test_floor_travel();
    test_nav_realfloor();
    test_nav_fine_realfloor();
    test_mob_table();
    test_mob_budget_v_shape();
    test_mob_spawn();
    test_mob_spawn_v_shape_in_world();
    test_palette_separation();
    test_faction_mix_is_five_wide();
    test_wander_moves_the_crowd();
    test_damage_reports_applied_not_raw();
    test_death_goes_through_one_finalizer();
    test_melee_cooldown_and_reach();
    test_item_table();
    test_economy_bands_gate_by_depth();
    test_loot_drops_before_the_corpse_is_gone();
    test_heal_picks_the_right_item();
    test_loadout_changes_the_numbers();
    test_floor_kinds_use_distinct_materials();
    test_ranged_windup_and_deadzone();
    test_faction_relations();
    test_extraction();
    test_extraction_reachable();
    test_mob_behaviour();

    std::printf("game_test: %d checks, %d failures\n", g_checks, g_fails);
    return g_fails == 0 ? 0 : 1;
}
