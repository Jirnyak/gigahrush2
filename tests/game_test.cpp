// Game-layer unit tests. Same tiny CHECK harness as world_test; links giga_game
// so it exercises the macro entity systems headless (no SDL/Vulkan).
#include <cstdio>
#include <cstring>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"
#include "game/elevator.h"
#include "game/event_bus.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include "game/population.h"

#include "world/lattice.h"
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
    CHECK(kLatticeCount == 64);
    CHECK(kLatticeSpacing == 32);
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

    std::printf("game_test: %d checks, %d failures\n", g_checks, g_fails);
    return g_fails == 0 ? 0 : 1;
}
