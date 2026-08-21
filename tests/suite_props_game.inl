// suite_props_game.inl — Unit tests for ECS Prop System ([jirnyak.md] §18).
// Wall-mounted Terminal / ElectricalShield live in ECS Interactable entities
// tagged by Transform.layer. PropPass is render-only; sim+HUD must not read it.

#include "game/container.h"  // spawn_floor_containers — the clear_layer_props seam test
#include "game/floor_gen.h"  // generate_floor — real floor geometry for that seam
#include "game/floors/padic/padic.h"
#include "game/floor_spec.h"
#include "game/prop_system.h"
#include "game/combat.h"  // kProjHitRadius — выстрел-в-проп тем же радиусом
#include "game/embody.h"  // TerminalInteractResult / embody_interact_terminal
#include "world/world.h"
#include "world/types.h"
#include "world/materials.h"
#include "ecs/components.h"
#include "game/event_bus.h"

#include <cmath>
#include <cstdint>
#include <vector>

namespace {

// seed_wall_interactables walks AIR cells with a SOLID cell below (floor) AND
// at least one solid W/E/N/S neighbor (wall), then rolls spatial_hash for
// Terminal (wsel 25-34) / ElectricalShield (15-24). Paint a floor slab and
// alternating wall columns at yFloor+1 so every other cell is air with solid
// west+east neighbors (~half the band × 20% device rate). No PropPass.
static void paint_floor_band(World& world, int x0, int x1, int zFloor, int y0, int y1) {
    const int zAir = zFloor + 1;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            world.grid().fill_cell(x, y, zFloor, kMatConcrete); // floor (Z-up)
            // Even offset from x0 -> wall column; odd -> air corridor cell.
            if (((x - x0) & 1) == 0)
                world.grid().fill_cell(x, y, zAir, kMatConcrete);
        }
    }
}

// A bare slab, no wall columns — the standable surface a ceiling lamp needs
// under it. paint_floor_band above also raises walls, which would make every
// corridor cell a lintel niche and suppress lamps for a different reason.
static void paint_slab(World& world, int x0, int x1, int z, int y0, int y1) {
    for (int y = y0; y < y1; ++y)
        for (int x = x0; x < x1; ++x)
            world.grid().fill_cell(x, y, z, kMatConcrete);
}

static int count_kind(const Registry& reg, LayerId layer, game::Interactable::Kind k) {
    int n = 0;

    auto view = reg.view<const game::Interactable, const Transform>();
    for (auto e : view) {
        if (view.get<const game::Interactable>(e).kind != k) continue;
        if (view.get<const Transform>(e).layer != layer) continue;
        ++n;
    }
    return n;
}


// seed_ceiling_lights walks AIR cells with a SOLID cell above (ceiling) and
// rolls spatial_hash(kSaltLight) with lightChancePct=25. Paint a ceiling slab
// over an air band so ~25% of cells spawn LightBulb — no PropPass.
static void paint_ceiling_band(World& world, int x0, int x1, int zAir, int y0, int y1) {
    const int zCeil = zAir + 1;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            world.grid().fill_cell(x, y, zCeil, kMatConcrete);
        }
    }
}

} // namespace

static void test_wall_interactables_seed_and_collect() {
    Registry reg;
    World world;
    const LayerId layer = 1;
    const unsigned seed = 0xC0FFEEu;

    // Dense floor band: enough air-above-solid candidates that 2%/1% rolls
    // produce at least one Terminal and one ElectricalShield under this seed.
    paint_floor_band(world, /*x0*/2, /*x1*/80, /*zFloor*/5, /*z0*/2, /*z1*/80);

    const std::uint32_t n = game::seed_wall_interactables(reg, world, layer, seed);
    CHECK(n > 0);

    const int terms = count_kind(reg, layer, game::Interactable::Kind::Terminal);
    const int shields = count_kind(reg, layer, game::Interactable::Kind::ElectricalShield);
    CHECK(terms + shields == static_cast<int>(n));
    CHECK(terms > 0);
    CHECK(shields > 0);

    // collect_interactable_positions is the sim/HUD path — must see the same set.
    std::vector<vec3> termPos, shieldPos;
    game::collect_interactable_positions(reg, layer, game::Interactable::Kind::Terminal, termPos);
    game::collect_interactable_positions(reg, layer, game::Interactable::Kind::ElectricalShield,
                                         shieldPos);
    CHECK(static_cast<int>(termPos.size()) == terms);
    CHECK(static_cast<int>(shieldPos.size()) == shields);

    for (const vec3& p : termPos) {
        CHECK(std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z));
        CHECK(p.x != 0.0f || p.y != 0.0f || p.z != 0.0f);
    }
    for (const vec3& p : shieldPos) {
        CHECK(std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z));
        CHECK(p.x != 0.0f || p.y != 0.0f || p.z != 0.0f);
    }

    // Entities carry Transform.layer so a recycled LayerId slot can be cleared.
    auto view = reg.view<const game::Interactable, const Transform>();
    for (auto e : view) {
        const auto& t = view.get<const Transform>(e);
        const auto& i = view.get<const game::Interactable>(e);
        if (i.kind == game::Interactable::Kind::Terminal ||
            i.kind == game::Interactable::Kind::ElectricalShield) {
            CHECK(t.layer == layer);
        }
    }
}

static void test_wall_interactables_clear_is_layer_scoped() {
    Registry reg;
    World world;
    const LayerId layerA = 3;
    const LayerId layerB = 7;
    const unsigned seed = 0xA11CEDu;

    paint_floor_band(world, 2, 60, 5, 2, 60);

    const std::uint32_t nA = game::seed_wall_interactables(reg, world, layerA, seed);
    const std::uint32_t nB = game::seed_wall_interactables(reg, world, layerB, seed ^ 1u);
    CHECK(nA > 0);
    CHECK(nB > 0);

    // clear_layer_props only destroys entities tagged with the given layer.
    const std::uint32_t cleared = game::clear_layer_props(reg, layerA);
    CHECK(cleared == nA);
    CHECK(count_kind(reg, layerA, game::Interactable::Kind::Terminal) == 0);
    CHECK(count_kind(reg, layerA, game::Interactable::Kind::ElectricalShield) == 0);
    CHECK(count_kind(reg, layerB, game::Interactable::Kind::Terminal) +
              count_kind(reg, layerB, game::Interactable::Kind::ElectricalShield) ==
          static_cast<int>(nB));

    std::vector<vec3> emptyTerms;
    game::collect_interactable_positions(reg, layerA, game::Interactable::Kind::Terminal, emptyTerms);
    CHECK(emptyTerms.empty());
    std::vector<vec3> stillThere;
    game::collect_interactable_positions(reg, layerB, game::Interactable::Kind::Terminal, stillThere);
    game::collect_interactable_positions(reg, layerB, game::Interactable::Kind::ElectricalShield,
                                         stillThere);
    CHECK(static_cast<int>(stillThere.size()) == static_cast<int>(nB));
}


static void test_ceiling_lights_seed_and_collect() {
    // [jirnyak.md] §18 — ceiling lamps are ECS LightBulb Interactables.
    // Lighting / HUD must use collect_interactable_positions, never
    // propPass.get_prop_positions(BareBulb|FloodLamp).
    Registry reg;
    World world;
    const LayerId layer = 5;
    const unsigned seed = 0xB11B11u;

    // A ROOM, not a floating slab: a lamp needs a surface within its own reach
    // below it, so the fixture must carry a floor. Painting only the ceiling
    // used to seed lamps, which is the blame-floor defect in miniature — on the
    // torus cell(x,y,z+1) wraps, so the open sky over the town read as a ceiling
    // and came back as a flat sheet of 1538 bulbs at 255 m.
    paint_slab(world, /*x0*/2, /*x1*/80, /*z*/7, /*y0*/2, /*y1*/80);
    paint_ceiling_band(world, /*x0*/2, /*x1*/80, /*zAir*/8, /*z0*/2, /*z1*/80);

    const std::uint32_t n = game::seed_ceiling_lights(reg, world, layer, seed);
    CHECK(n > 0);

    const int bulbs = count_kind(reg, layer, game::Interactable::Kind::LightBulb);
    CHECK(bulbs == static_cast<int>(n));

    std::vector<vec3> lampPos;
    game::collect_interactable_positions(reg, layer, game::Interactable::Kind::LightBulb, lampPos);
    CHECK(static_cast<int>(lampPos.size()) == bulbs);

    for (const vec3& p : lampPos) {
        CHECK(std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z));
        // PropPlacer origin y = yAir*kCell + 1.55; yAir=8, kCell=2 → 16+1.55=17.55
        CHECK(p.z > 16.0f && p.z < 19.0f);
    }

    auto view = reg.view<const game::Interactable, const Transform>();
    for (auto e : view) {
        if (view.get<const game::Interactable>(e).kind != game::Interactable::Kind::LightBulb)
            continue;
        CHECK(view.get<const Transform>(e).layer == layer);
        CHECK(reg.all_of<game::SubVoxelAnchor>(e));
        CHECK(reg.all_of<game::StaticPropTag>(e));
        CHECK(reg.all_of<game::PropMeshTag>(e));
    }

    // Layer-scoped clear drops the lamps.
    CHECK(game::clear_layer_props(reg, layer) == n);
    CHECK(count_kind(reg, layer, game::Interactable::Kind::LightBulb) == 0);
}

// An overhang is not a ceiling. Same slab as above with the FLOOR removed: on a
// torus every axis wraps, so any solid mass anywhere in the column reads as
// "solid above" from the air below it. Blame's town shipped with 1538 bulbs in
// one flat plane 200 m over the street for exactly this reason — 17% of the
// floor's lamps at a single z. Delete the headroom test in seed_ceiling_lights
// and this goes red.
static void test_ceiling_lights_need_a_floor_under_them() {
    Registry reg;
    World world;
    const LayerId layer = 7;

    paint_ceiling_band(world, /*x0*/2, /*x1*/80, /*zAir*/8, /*z0*/2, /*z1*/80);
    CHECK(game::seed_ceiling_lights(reg, world, layer, 0xB11B11u) == 0);

    // A floor JUST out of the bulb's reach is still no floor: props.csv gives
    // BareBulb 12 m, so a slab 8 cells (16 m) under the lamp cell stays dark.
    paint_slab(world, /*x0*/2, /*x1*/80, /*z*/0, /*y0*/2, /*y1*/80);
    CHECK(game::seed_ceiling_lights(reg, world, layer, 0xB11B11u) == 0);

    // Inside the reach it lights up.
    paint_slab(world, /*x0*/2, /*x1*/80, /*z*/4, /*y0*/2, /*y1*/80);
    CHECK(game::seed_ceiling_lights(reg, world, layer, 0xB11B11u) > 0);
}

// A lamp hangs from the ceiling's REAL under-face, and its anchor must name the
// sub-layer that face lives in. Padic's storey ceiling is a sandwich: the slab
// occupies sub-layers 6..7 of the cell and 0..5 are hollow. The seeder measured
// that face for the bulb's POSITION but anchored at sub-layer 0 regardless, so
// spawn_prop's solid(cx,cy,cz, 4,4,subZ) gate threw away 123 110 of 123 156
// lamps and the floor shipped with 84 — "очень темно", owner's report.
static void test_ceiling_lights_hang_from_a_sandwich_slab() {
    Registry reg;
    World world;
    const LayerId layer = 8;
    const int zAir = 8, zCeil = 9;

    paint_slab(world, /*x0*/2, /*x1*/80, /*z*/7, /*y0*/2, /*y1*/80);
    // The ceiling cell carries matter ONLY in its top two sub-layers.
    for (int y = 2; y < 80; ++y)
        for (int x = 2; x < 80; ++x) {
            SubMask& m = world.grid().mask(x, y, zCeil);
            m.words[6] = ~std::uint64_t{0};
            m.words[7] = ~std::uint64_t{0};
            world.grid().set_cell(x, y, zCeil, kMatConcrete);
        }

    const std::uint32_t n = game::seed_ceiling_lights(reg, world, layer, 0x5A11Bu);
    CHECK(n > 0);

    for (auto e : reg.view<const game::SubVoxelAnchor, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const game::SubVoxelAnchor& a = reg.get<const game::SubVoxelAnchor>(e);
        CHECK(a.cz == zCeil);
        CHECK(a.subZ == 6); // the slab's own lowest layer, not 0
        // The bulb hangs just under that face, not under the cell plane.
        const float faceM = static_cast<float>(zCeil) * kCellSize + 6.0f * (kCellSize / 8.0f);
        CHECK(std::fabs(reg.get<const Transform>(e).pos.z - (faceM - 0.14f)) < 0.01f);
    }
    (void)zAir;
}

static void test_ceiling_lights_do_not_collide_with_wall_devices() {
    // Same seed+grid: wall devices need solidBelow+wall; ceiling lamps need
    // solidAbove. A floor+ceiling sandwich must produce both families without
    // double-counting kinds.
    Registry reg;
    World world;
    const LayerId layer = 6;
    const unsigned seed = 0xCE11u;

    // Floor at y=5, air at y=6, ceiling at y=7. Wall columns on even x at y=6.
    paint_floor_band(world, 2, 70, /*zFloor*/5, 2, 70);
    // paint_floor_band already fills even-x wall columns at yAir=6; add ceiling.
    paint_ceiling_band(world, 2, 70, /*zAir*/6, 2, 70);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    const std::uint32_t nLamp = game::seed_ceiling_lights(reg, world, layer, seed);
    CHECK(nWall > 0);
    CHECK(nLamp > 0);

    CHECK(count_kind(reg, layer, game::Interactable::Kind::Terminal) +
              count_kind(reg, layer, game::Interactable::Kind::ElectricalShield) ==
          static_cast<int>(nWall));
    CHECK(count_kind(reg, layer, game::Interactable::Kind::LightBulb) ==
          static_cast<int>(nLamp));
}

static void test_padic_props_seed_tags_layer() {
    // [jirnyak.md] section 24 -- padic stair lamps on PlanStair lattice after
    // generate_padic_floor; solid SubVoxelAnchor (no floating bulbs).
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 4;
    const int number = 4;
    const unsigned seed = 0x0BAD1Cu;

    FloorSpec spec{};
    generate_padic_floor(world, number, spec, seed);

    const std::uint32_t n =
        game::seed_padic_props(reg, world, layer, number, seed, bus);
    CHECK(n > 0u);

    auto view = reg.view<const game::Interactable, const Transform,
                         const game::SubVoxelAnchor>();
    int tagged = 0;
    int solidAnchors = 0;
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        ++tagged;
        CHECK(view.get<const game::Interactable>(e).kind ==
              game::Interactable::Kind::LightBulb);
        CHECK(reg.all_of<game::StaticPropTag>(e));
        const auto& a = view.get<const game::SubVoxelAnchor>(e);
        if (world.grid().solid(a.cx, a.cy, a.cz, a.subX, a.subY, a.subZ))
            ++solidAnchors;
        const auto& tr = view.get<const Transform>(e);
        CHECK(std::isfinite(tr.pos.x) && std::isfinite(tr.pos.y) &&
              std::isfinite(tr.pos.z));
    }
    CHECK(tagged == static_cast<int>(n));
    CHECK(solidAnchors == static_cast<int>(n));
    CHECK(game::clear_layer_props(reg, layer) == n);
    CHECK(count_kind(reg, layer, game::Interactable::Kind::LightBulb) == 0);
}


static void test_spawn_prop_anchor_and_detach_on_air() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 2;

    // Solid support cell the prop is anchored to.
    world.grid().fill_cell(10, 4, 10, kMatConcrete);

    game::SubVoxelAnchor anchor{};
    anchor.cx = 10;
    anchor.cy = 4;
    anchor.cz = 10;
    anchor.subX = 0;
    anchor.subY = 0;
    anchor.subZ = 0;
    anchor.face = 0;

    const vec3 pos{10.5f, 5.25f, 10.5f};
    const auto e = game::spawn_prop(reg, world, pos, anchor,
                                    game::Interactable::Kind::LightBulb,
                                    game::PropFallMode::RagdollRoll,
                                    vec3{0.9f, 0.85f, 0.4f},
                                    /*meshKind*/0, layer);
    CHECK(reg.valid(e));
    // CHECK is a function-like macro: commas inside all_of<A,B> split args.
    // Probe each type on its own line.
    CHECK(reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::SubVoxelAnchor>(e));
    CHECK(reg.all_of<Transform>(e));
    CHECK(reg.all_of<game::Interactable>(e));
    CHECK(reg.all_of<game::PropMeshTag>(e));
    CHECK(!reg.all_of<Velocity>(e));
    CHECK(!reg.all_of<RigidBody>(e)); // статик — не тело ядра до отрыва
    CHECK(!reg.all_of<game::DynamicBodyTag>(e));

    const auto& a = reg.get<game::SubVoxelAnchor>(e);
    CHECK(a.cx == 10);
    CHECK(a.cy == 4);
    CHECK(a.cz == 10);
    CHECK(reg.get<Transform>(e).layer == layer);
    CHECK(reg.get<game::Interactable>(e).kind ==
          game::Interactable::Kind::LightBulb);

    // Carve the anchor cell -> dirty list -> prop detaches into ragdoll.
    world.grid().clear_cell(10, 4, 10);
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(10, 4, 10))};
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);

    CHECK(!reg.all_of<game::StaticPropTag>(e));
    CHECK(!reg.all_of<game::SubVoxelAnchor>(e));
    CHECK(reg.all_of<game::DynamicBodyTag>(e));
    CHECK(reg.all_of<Velocity>(e));
    // Инкремент 6 рагдолл-эпика: детач — тело ЯДРА, не AngularVelocity-косметика.
    CHECK(reg.all_of<RigidBody>(e));
    CHECK(reg.all_of<SelfIntegrating>(e));
    {
        const std::uint32_t n = bus.cycle_count(EventType::PropDetached);
        CHECK(n > 0u);
    }
}

// Рагдолл-эпик §8 (ragdoll.md, решение владельца 2026-08-21): линк с мировым
// якорем живёт по ЕДИНОЙ якорной системе — линк-сущность несёт SubVoxelAnchor,
// и карв опоры рвёт линк в anchor_validate_step: подвешенная цепь падает.
// Обе полярности: чужой dirty-ключ линк не трогает, смерть опоры — рвёт и
// будит стороны.
static void test_world_anchored_link_severed_by_carve() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();

    // Потолок и шар на подвесе под ним.
    world.grid().fill_cell(10, 4, 10, kMatConcrete);
    Entity ball = reg.create();
    reg.emplace<Transform>(ball, Transform{vec3{21.0f, 9.0f, 18.5f}, 2});
    reg.emplace<Velocity>(ball);
    RigidBody rb;
    rb.asleep = true; // спит — разруб обязан разбудить
    reg.emplace<RigidBody>(ball, rb);

    Entity link = reg.create();
    JointLink jl;
    jl.a = ball;
    jl.b = entt::null;
    jl.anchorB = vec3{21.0f, 9.0f, 20.0f};
    jl.restLen = 1.5f;
    reg.emplace<JointLink>(link, jl);
    game::SubVoxelAnchor sva{};
    sva.cx = 10; sva.cy = 4; sva.cz = 10;
    sva.subX = 4; sva.subY = 4; sva.subZ = 0;
    sva.face = anchor_face_pack(2, -1); // нижняя грань потолка
    reg.emplace<game::SubVoxelAnchor>(link, sva);

    // Полярность 1: dirty ЧУЖОЙ клетки — линк жив.
    const std::vector<std::uint32_t> dirtyOther{
        static_cast<std::uint32_t>(macro_index(11, 4, 10))};
    game::anchor_validate_step(reg, world, bus, dirtyOther);
    CHECK(reg.valid(link));

    // Полярность 2: опора выкарвлена — линк уничтожен, шар разбужен.
    world.grid().clear_cell(10, 4, 10);
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(10, 4, 10))};
    game::anchor_validate_step(reg, world, bus, dirty);
    CHECK(!reg.valid(link));
    CHECK(!reg.get<RigidBody>(ball).asleep);
}

// Инкремент 3 якорного эпика (anchor-unify.md): проба живости — КОЛОНКА
// субвокселей у грани крепления, не один бит. Обе полярности одним тестом
// (закон run-the-mutation): чужой бит клетки НЕ роняет вещь, смерть колонки
// под точкой крепления — роняет.
static void test_anchor_column_probe_both_polarities() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 2;

    // Полная бетонная клетка потолка; лампа висит под нижней гранью, точка
    // крепления — центр (4,4), как её пишет seed_ceiling_lights.
    world.grid().fill_cell(10, 4, 10, kMatConcrete);
    game::SubVoxelAnchor anchor{};
    anchor.cx = 10;
    anchor.cy = 4;
    anchor.cz = 10;
    anchor.subX = 4;
    anchor.subY = 4;
    anchor.subZ = 0;
    anchor.face = anchor_face_pack(2, -1); // нижняя грань потолка

    const auto e = game::spawn_prop(reg, world, vec3{21.0f, 9.0f, 19.8f}, anchor,
                                    game::Interactable::Kind::LightBulb,
                                    game::PropFallMode::RagdollRoll,
                                    vec3{0.9f, 0.85f, 0.4f},
                                    /*meshKind*/0, layer);
    CHECK(reg.valid(e));
    CHECK(reg.all_of<game::StaticPropTag>(e));

    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(10, 4, 10))};

    // Полярность 1: выкарван ЧУЖОЙ угол клетки — колонка крепления цела,
    // вещь обязана висеть (прежний побитовый тест тут не менялся, но колонка
    // переживает и смерть самого бита (4,4,0), пока над ним есть материя).
    world.grid().mask(10, 4, 10).clear(sub_bit(0, 0, 7));
    world.grid().mask(10, 4, 10).clear(sub_bit(4, 4, 0));
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);
    CHECK(reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::SubVoxelAnchor>(e));

    // Полярность 2: умерла ВСЯ колонка 2×2 у грани крепления (окно {4,5}²
    // сквозь все 8 слоёв) — клетка ещё на 87% полна, но вещь держаться не на
    // чем: обязана отвалиться. Ровно кейс владельца с проводами 2026-08-05.
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 4; sy <= 5; ++sy)
            for (int sx = 4; sx <= 5; ++sx)
                world.grid().mask(10, 4, 10).clear(sub_bit(sx, sy, sz));
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);
    CHECK(!reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::DynamicBodyTag>(e));
    CHECK(bus.cycle_count(EventType::PropDetached) > 0u);
}

static void test_anchor_validate_skips_solid_support() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 1;

    world.grid().fill_cell(3, 2, 3, kMatConcrete);

    game::SubVoxelAnchor anchor{};
    anchor.cx = 3;
    anchor.cy = 2;
    anchor.cz = 3;

    const auto e = game::spawn_prop(reg, world, vec3{3.5f, 3.25f, 3.5f}, anchor,
                                    game::Interactable::Kind::Terminal,
                                    game::PropFallMode::SimpleFall,
                                    vec3{0.5f, 0.5f, 0.5f},
                                    /*meshKind*/0, layer);
    CHECK(reg.valid(e));
    CHECK(reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::SubVoxelAnchor>(e));

    // Dirty the cell but leave it solid -- prop stays anchored.
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(3, 2, 3))};
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);
    CHECK(reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::SubVoxelAnchor>(e));
    CHECK(!reg.all_of<Velocity>(e));
    {
        const std::uint32_t n = bus.cycle_count(EventType::PropDetached);
        CHECK(n == 0u);
    }
}

// Инкремент 6 рагдолл-эпика: сорванный проп — тело ЯДРА (RigidBody +
// SelfIntegrating, форма и масса выведены из строки пропа), а не косметика
// AngularVelocity; prop_ragdoll_step умер.
static void test_detached_prop_is_rigid_body() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 1;

    world.grid().fill_cell(7, 3, 7, kMatConcrete);
    game::SubVoxelAnchor anchor{};
    anchor.cx = 7;
    anchor.cy = 3;
    anchor.cz = 7;
    anchor.subX = 4;
    anchor.subY = 4;
    anchor.subZ = 0;
    anchor.face = anchor_face_pack(2, -1);

    const auto e = game::spawn_prop(reg, world, vec3{15.0f, 7.0f, 13.8f},
                                    anchor, game::Interactable::Kind::LightBulb,
                                    game::PropFallMode::RagdollRoll,
                                    vec3{0.9f, 0.85f, 0.4f},
                                    /*meshKind*/0, layer);
    CHECK(reg.valid(e));

    world.grid().clear_cell(7, 3, 7);
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(7, 3, 7))};
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);

    CHECK(!reg.all_of<game::StaticPropTag>(e));
    CHECK(reg.all_of<game::DynamicBodyTag>(e));
    CHECK(reg.all_of<RigidBody>(e));
    CHECK(reg.all_of<SelfIntegrating>(e)); // physics_step не двигает вторым разом
    CHECK(!reg.all_of<GravityAffected>(e)); // гравитацию интегрирует ядро
    // Масса выведена, не дефолт: invMass конечна и не единица-заглушка.
    const auto& rb = reg.get<RigidBody>(e);
    CHECK(rb.invMass > 0.0f);
    // Стартовый кувырок отрыва передан ядру.
    CHECK(dot(rb.w, rb.w) > 0.0f);
}


// --- [jirnyak.md] section 18: terminal interact must not fake-hit ---------------

static Entity make_actor_at(Registry& reg, LayerId layer, const vec3& pos) {
    const Entity e = reg.create();
    Transform t{};
    t.pos = pos;
    t.layer = layer;
    reg.emplace<Transform>(e, t);
    return e;
}

static Entity make_terminal_at(Registry& reg, LayerId layer, const vec3& pos) {
    const Entity e = reg.create();
    Transform t{};
    t.pos = pos;
    t.layer = layer;
    reg.emplace<Transform>(e, t);
    game::Interactable ia{};
    ia.kind = game::Interactable::Kind::Terminal;
    reg.emplace<game::Interactable>(e, ia);
    return e;
}

static void test_find_nearest_terminal_respects_reach() {
    Registry reg;
    EventBus bus;
    bus.init();
    const LayerId layer = 1;
    const Entity actor = make_actor_at(reg, layer, vec3{10.0f, 2.0f, 10.0f});
    make_terminal_at(reg, layer, vec3{20.0f, 2.0f, 10.0f}); // 10 m away

    // Out of 4 m reach -> miss.
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, actor, game::Interactable::Kind::Terminal, 4.0f);
        CHECK(!hit.hit);
    }
    // Within 12 m reach -> hit (caller-supplied reach).
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, actor, game::Interactable::Kind::Terminal, 12.0f);
        CHECK(hit.hit);
        CHECK(hit.pos.x == 20.0f);
        CHECK(hit.pos.z == 10.0f);
    }
    // interaction_step hardcodes ~3 m reach (prop_system.cpp) — still a miss at 10 m.
    {
        game::InteractionHit out{};
        CHECK(!game::interaction_step(reg, actor, game::Interactable::Kind::Terminal, bus, &out));
        CHECK(!out.hit);
    }
    // Walk into the default step reach: 2 m from the terminal -> hit.
    {
        reg.get<Transform>(actor).pos = vec3{18.0f, 2.0f, 10.0f};
        game::InteractionHit out{};
        CHECK(game::interaction_step(reg, actor, game::Interactable::Kind::Terminal, bus, &out));
        CHECK(out.hit);
        CHECK(out.pos.x == 20.0f);
        CHECK(out.pos.z == 10.0f);
    }
}

static void test_embody_interact_terminal_applies_at_given_pos() {
    // embody_interact_terminal no longer searches: caller gates proximity.
    // Calling it always reports interacted=true at the supplied terminalPos
    // (door toggle count depends on DoorSet contents -- empty set -> 0).
    Registry reg;
    World world;
    game::DoorSet doors{};
    const LayerId layer = 1;
    const vec3 termPos{5.0f, 1.0f, 5.0f};

    const game::TerminalInteractResult res =
        game::embody_interact_terminal(reg, world, doors, layer, termPos);
    CHECK(res.interacted);
    CHECK(res.propPos.x == termPos.x);
    CHECK(res.propPos.y == termPos.y);
    CHECK(res.propPos.z == termPos.z);
    CHECK(res.doorsToggled == 0u);

    // Miss path for live E-key: find_nearest returns !hit when nothing in reach,
    // so main must NOT call embody_interact_terminal. That contract is what
    // killed the old always-true fake hit at playerPos.
    const Entity actor = make_actor_at(reg, layer, vec3{0.0f, 1.0f, 0.0f});
    const game::InteractionHit miss = game::find_nearest_interactable(
        reg, actor, game::Interactable::Kind::Terminal, 4.0f);
    CHECK(!miss.hit);
}


// --- [jirnyak.md] section 18: PropPass passive skin (ECS PropMesh collect) ----

static void test_collect_static_prop_mesh_instances_shapes() {
    Registry reg;
    World world;
    const LayerId layer = 3;
    const std::uint32_t seed = 0xC0FFEEu;

    // Z-up: floor slab + alternating wall columns + ceiling (same contract as
    // seed_wall_interactables / seed_ceiling_lights). Tiny 8x8 west-wall room
    // under-seeds wall devices for seed 0xC0FFEE.
    paint_floor_band(world, /*x0*/2, /*x1*/70, /*zFloor*/5, /*y0*/2, /*y1*/70);
    paint_ceiling_band(world, /*x0*/2, /*x1*/70, /*zAir*/6, /*y0*/2, /*y1*/70);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    const std::uint32_t nLamp = game::seed_ceiling_lights(reg, world, layer, seed);
    CHECK(nWall + nLamp > 0u);

    std::vector<game::PropMeshInstance> insts;
    const std::uint32_t n = game::collect_static_prop_mesh_instances(reg, layer, insts);
    CHECK(n == nWall + nLamp);
    CHECK(insts.size() == static_cast<std::size_t>(n));

    // The rebuilt catalog (render/prop_mesh.h) shares shapes between prop
    // kinds (terminal/shield/flood are all Box), so classification goes by the
    // AUTHORED columns instead: material for the wall pair, emissive for lamps.
    constexpr std::uint8_t kBox  = 0;
    constexpr std::uint8_t kCylZ = 3;

    std::uint32_t nTerm = 0, nShield = 0, nBulb = 0, nFlood = 0;
    for (const auto& m : insts) {
        if (m.emissive > 0) {   // lamps: authored emissive (props.csv)
            if (m.shape == kCylZ) ++nBulb;
            else { CHECK(m.shape == kBox); ++nFlood; }
        } else if (m.shape == kBox && m.matId == 3) {
            ++nTerm;
        } else if (m.shape == kBox && m.matId == 4) {
            ++nShield;
        } else {
            CHECK(false); // unexpected instance from wall/ceiling seed
        }
        CHECK(m.origin.x >= 0.0f);
    }
    CHECK(nTerm + nShield == nWall);
    CHECK(nBulb + nFlood == nLamp);

    // Detach drops StaticPropTag -> collect must shrink.
    auto view = reg.view<game::SubVoxelAnchor, game::Interactable, Transform>();
    Entity target = entt::null;
    for (auto e : view) {
        if (view.get<game::Interactable>(e).kind == game::Interactable::Kind::LightBulb) {
            target = e;
            break;
        }
    }
    if (target != entt::null) {
        const auto& a = reg.get<game::SubVoxelAnchor>(target);
        world.grid().clear_cell(a.cx, a.cy, a.cz);
        game::EventBus bus;
        bus.init();
        const std::vector<std::uint32_t> dirty{
            static_cast<std::uint32_t>(macro_index(a.cx, a.cy, a.cz))};
        game::anchor_validate_step(reg, world, bus, dirty);
        // Лампы — GpuHandoff (data/props.csv, решение 2026-08-18): detach
        // уносит сущность целиком в GPU-burst, а не переводит в
        // DynamicBodyTag, как делал прежний RagdollRoll этих строк.
        CHECK(!reg.valid(target));

        std::vector<game::PropMeshInstance> after;
        const std::uint32_t n2 =
            game::collect_static_prop_mesh_instances(reg, layer, after);
        CHECK(n2 == n - 1u);
    }
}

// [jirnyak.md] §18 — corpses and floor loot carry Interactable so HUD/E and
// find_nearest_interactable share one query path. Kind filter must not leak
// across Corpse vs Loot, and an empty searched corpse deactivates.
static void test_corpse_and_loot_are_interactable() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();

    NpcId pid = pool.spawn();
    pool.hp(pid) = 500;
    pool.max_hp(pid) = 500;
    Entity player = embody_as_player(reg, pool, pid, /*layer=*/0);
    const vec3 ppos = reg.get<Transform>(player).pos;

    // --- Corpse path: same components finalize_deaths writes ------------------
    Entity corpse = reg.create();
    {
        Transform ct;
        ct.pos = ppos; // adjacent — inside 2.2 m corpse reach
        ct.layer = 0;
        reg.emplace<Transform>(corpse, ct);
        Corpse c{};
        c.searched = false;
        reg.emplace<Corpse>(corpse, c);
        game::Container cbox{};
        cbox.inv.slots[0] = ItemSlot{ItemId{1}, 1, 255};
        reg.emplace<game::Container>(corpse, cbox);

        // Mirrors combat.cpp finalize_deaths: Kind::Corpse, radius 2.2, active.
        reg.emplace<game::Interactable>(
            corpse, game::Interactable{game::Interactable::Kind::Corpse, 2.2f, true});
    }
    // CHECK is a function-like macro: commas inside all_of<A,B> split args.
    CHECK(reg.all_of<Corpse>(corpse));
    CHECK(reg.all_of<game::Interactable>(corpse));
    {
        const game::Interactable& ia = reg.get<game::Interactable>(corpse);
        CHECK(ia.kind == game::Interactable::Kind::Corpse);
        CHECK(ia.active);
        CHECK(ia.reachM >= 2.0f);

    }
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, player, game::Interactable::Kind::Corpse, 2.2f);
        CHECK(hit.hit);
        CHECK(hit.entity == corpse);
    }
    // Kind filter: Corpse must not answer a Loot query.
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, player, game::Interactable::Kind::Loot, 2.2f);
        CHECK(!hit.hit);
    }

    // Drain corpse loot → empty searched corpse deactivates Interactable.
    {
        const CorpseLootResult lr =
            loot_corpse_interact(reg, pool, bus, 0, ppos, /*maxReach=*/3.0f, 2u);
        CHECK(lr.foundCorpse);
        CHECK(lr.itemsTaken == 1);
    }
    CHECK(reg.get<Corpse>(corpse).searched);
    CHECK(reg.get<game::Container>(corpse).inv.empty());
    CHECK(reg.all_of<game::Interactable>(corpse));
    CHECK(!reg.get<game::Interactable>(corpse).active);
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, player, game::Interactable::Kind::Corpse, 2.2f);
        CHECK(!hit.hit); // inactive drops out of the query
    }

    // --- Floor loot path: drop_mob_loot → Kind::Loot -------------------------
    {
        const std::uint32_t n = drop_mob_loot(
            reg, /*layer=*/0, ppos,
            /*mobKind=*/static_cast<std::uint8_t>(MobKind::Mancobus),

            /*mobTier=*/static_cast<std::uint8_t>(MobTier::Boss),
            /*floorNumber=*/0, /*seed=*/99u);
        CHECK(n > 0);

    }
    std::uint32_t lootCount = 0;
    for (auto e : reg.view<const Pickup, const game::Interactable>()) {
        const game::Interactable& ia = reg.get<const game::Interactable>(e);
        if (ia.kind == game::Interactable::Kind::Loot && ia.active) ++lootCount;
    }
    CHECK(lootCount > 0);
    {
        // drop_mob_loot can scatter several pickups; find_nearest returns the
        // closest active Kind::Loot — not the first view iteration order.
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, player, game::Interactable::Kind::Loot, 3.0f);
        CHECK(hit.hit);
        CHECK(reg.valid(hit.entity));
        CHECK(reg.all_of<Pickup>(hit.entity));
        CHECK(reg.all_of<game::Interactable>(hit.entity));
        CHECK(reg.get<game::Interactable>(hit.entity).kind ==
              game::Interactable::Kind::Loot);
        CHECK(reg.get<game::Interactable>(hit.entity).active);
    }

    // Kind filter: Loot must not answer a Corpse query (corpse already inactive).
    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, player, game::Interactable::Kind::Corpse, 3.0f);
        CHECK(!hit.hit);
    }
}






// [jirnyak.md] section 18/19 -- GpuHandoff shatter.
// The mode's whole promise: ZERO CPU debris entities. The parent is destroyed and
// the SHOW is a burst pushed into the unified GPU particle pool ([particle_pass.h]),
// so a chain collapse costs the tick nothing. The queue is optional — headless sim
// and tests may pass nullptr and get silence, which the second half of this test pins.

static void test_gpu_handoff_destroys_parent_without_cpu_debris() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 11;

    world.grid().fill_cell(14, 6, 14, kMatConcrete);

    game::SubVoxelAnchor anchor{};
    anchor.cx = 14;
    anchor.cy = 6;
    anchor.cz = 14;
    anchor.subX = 4;
    anchor.subY = 4;
    anchor.subZ = 4;
    anchor.face = 0;

    const vec3 pos{14.5f * 2.0f, 6.5f * 2.0f, 14.5f * 2.0f};
    const auto e = game::spawn_prop(reg, world, pos, anchor,
                                    game::Interactable::Kind::LightBulb,
                                    game::PropFallMode::GpuHandoff,
                                    vec3{1.0f, 0.78f, 0.45f},
                                    /*meshKind*/28u, layer);
    CHECK(reg.valid(e));
    CHECK(reg.all_of<game::StaticPropTag>(e));

    // Carve support -> anchor_validate detaches GpuHandoff path.
    world.grid().clear_cell(14, 6, 14);
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(14, 6, 14))};
    bus.clear();
    // The mode's promise is "the GPU shows it" — so it must actually PUSH a
    // burst into the shared particle queue ([game/particles.h]). Vanishing in
    // silence was the half of the bug that outlived the CPU-debris half.
    game::ParticleBurstQueue bursts;
    const std::uint32_t detached =
        game::anchor_validate_step(reg, world, bus, dirty, &bursts, 77u);
    CHECK(detached == 1u);
    CHECK(bursts.count == 1u);
    CHECK(bursts.items[0].count > 0u);
    CHECK(bursts.items[0].kind ==
          static_cast<std::uint8_t>(game::ParticleKind::Debris));
    CHECK(bursts.items[0].pos.x == pos.x && bursts.items[0].pos.z == pos.z);
    // ...and the queue stays untouched when the caller does not offer one
    // (headless sim, tests, a server with no renderer).
    CHECK(game::anchor_validate_step(reg, world, bus, dirty) == 0u);
    CHECK(!reg.valid(e)); // parent destroyed
    {
        const std::uint32_t n = bus.cycle_count(EventType::PropDetached);
        CHECK(n > 0u);
    }

    // Zero CPU debris. GPU owns the effect now — a GpuHandoff shatter must
    // not leave a rigid-core body behind (инкремент 6: CPU-обломок = тело
    // ядра, старой AngularVelocity-косметики не существует).
    std::uint32_t chips = 0;
    auto view = reg.view<const game::DynamicBodyTag, const RigidBody>();
    for (auto d : view) {
        CHECK(reg.get<Transform>(d).layer == layer);
        ++chips;
    }
    CHECK(chips == 0u);
    printf("[props] GpuHandoff detach -> 0 CPU debris, GPU handled\n");
}


// markoaudit-systems.md §1.2 — THE SEAM THE SUITES NEVER RAN. main.cpp calls
// refresh_floor_containers and then refresh_floor_props, whose first line is
// clear_layer_props. When that clear keyed on "has a SubVoxelAnchor" it wiped
// every crate just spawned (38 of 38 measured on floor 0), because a container
// carries an anchor for gravity/destruction and is NOT part of the prop
// roster. Both halves were green in isolation — spawn_floor_containers here,
// clear_layer_props there — and the wipe lived in the ORDER, which no test
// executed. This test runs the seam: containers, then a roster prop, then the
// clear. The crate must survive; the roster prop must die.
static void test_clear_layer_props_spares_containers() {
    World w;
    const int floorZ = -3;
    const game::FloorKind kind = game::FloorKind::Residential;
    // Same seed formula main.cpp refresh_floor_containers uses.
    const std::uint32_t seed =
        0xC0FFEEu ^ static_cast<std::uint32_t>(floorZ) * 0x9e3779b9u;
    game::generate_floor(w, floorZ, game::floor_spec(kind), 1337u);

    Registry reg;
    const LayerId layer = 0;
    const std::uint32_t made =
        game::spawn_floor_containers(reg, w, floorZ, kind, layer, seed, /*cap=*/64u);
    CHECK(made > 4u);

    // One roster prop through the spawn_prop route (StaticPropTag attached).
    w.grid().fill_cell(14, 6, 14, kMatConcrete);
    game::SubVoxelAnchor anchor{};
    anchor.cx = 14; anchor.cy = 6; anchor.cz = 14;
    anchor.subX = 4; anchor.subY = 4; anchor.subZ = 4;
    const vec3 pos{14.5f * kCellSize, 6.5f * kCellSize, 14.5f * kCellSize};
    const auto roster = game::spawn_prop(reg, w, pos, anchor,
                                         game::Interactable::Kind::Terminal,
                                         game::PropFallMode::SimpleFall,
                                         vec3{0.3f, 0.3f, 0.3f},
                                         /*meshKind*/0u, layer);
    CHECK(reg.valid(roster));

    std::uint32_t cratesBefore = 0;
    for (auto e : reg.view<const game::Container>()) { (void)e; ++cratesBefore; }
    CHECK(cratesBefore == made);

    // Ящик — ПРОП (S14.1 B1, решение владельца 2026-08-21): клирится со
    // слоем, как всё со StaticPropTag, и пересеивается генерацией; контент
    // восстанавливает сейв. Прежний контракт «ящики переживают шов» охранял
    // до-проповый дизайн.
    const std::uint32_t cleared = game::clear_layer_props(reg, layer);
    CHECK(cleared >= 1u + made); // roster + все ящики
    CHECK(!reg.valid(roster));

    std::uint32_t cratesAfter = 0;
    for (auto e : reg.view<const game::Container>()) { (void)e; ++cratesAfter; }
    CHECK(cratesAfter == 0u);
    printf("[props] clear_layer_props: roster + %u crates cleared as props\n",
           made);
}


// markoaudit-systems.md §1.3 — furniture rows carried interact=Terminal, so E
// on a toilet toggled the door locks of every room on the floor. Pins BOTH
// halves of the fix: the four furniture rows are interact=None (generator
// ordinal 255, tools/gen_prop_table.py), and the spawn path strips the
// Interactable component for a None row. Lamps stay interactable — the
// negative control that None did not leak into the rest of the table.
static void test_furniture_is_not_a_terminal() {
    CHECK(game::prop_def(game::PropId::KitchenStove).interactKind == 255);
    CHECK(game::prop_def(game::PropId::KitchenTable).interactKind == 255);
    CHECK(game::prop_def(game::PropId::ToiletPan).interactKind == 255);
    CHECK(game::prop_def(game::PropId::BedCot).interactKind == 255);
    CHECK(game::prop_def(game::PropId::BareBulb).interactKind != 255);

    Registry reg;
    World world;
    world.grid().fill_cell(14, 6, 14, kMatConcrete);
    game::SubVoxelAnchor anchor{};
    anchor.cx = 14; anchor.cy = 6; anchor.cz = 14;
    anchor.subX = 4; anchor.subY = 4; anchor.subZ = 4;
    const vec3 pos{14.5f * kCellSize, 6.5f * kCellSize, 14.5f * kCellSize};
    const auto e = game::spawn_prop_from_id(reg, world, pos, anchor,
                                            game::PropId::ToiletPan, 3);
    CHECK(reg.valid(e));
    CHECK(!reg.all_of<game::Interactable>(e)); // scenery, not a verb
    printf("[props] furniture spawns without Interactable (None row)\n");
}


// Пин данных ([markoaudit/plans/lamp-gpuhandoff.md], решение владельца
// 2026-08-18): все три лампы — GpuHandoff (разбилась → всплеск осколков в
// GPU-пул, свет гаснет вместе с сущностью) и neon_tube (mat_id 20,
// data/materials.csv) — плафон из неон-стекла, осколки тонируются им же.
// До правки лампы были RagdollRoll с mat_id 0 (air, albedo 0/0/0): падали
// целиком и крошились бы ЧЁРНЫМ. Данные честнее фолбэка.
static void test_lamp_rows_are_gpu_handoff_neon() {
    const game::PropId lamps[] = {game::PropId::BareBulb,
                                  game::PropId::FloodLamp,
                                  game::PropId::PadicStairBulb};
    for (const game::PropId id : lamps) {
        const game::PropDef& d = game::prop_def(id);
        CHECK(d.fallMode ==
              static_cast<std::uint8_t>(game::PropFallMode::GpuHandoff));
        CHECK(d.matId == 20u); // neon_tube
    }
    printf("[props] lamp rows pinned: GpuHandoff + neon_tube matId=20\n");
}


// Выстрел в лампу ([markoaudit/plans/lamp-gpuhandoff.md] C): снаряд в радиусе
// kProjHitRadius от якорного пропа рвёт его по fall_mode строки. Для
// GpuHandoff-лампы это burst осколков в общую очередь, тонированный её
// материалом, и гибель сущности — вместе с PropLight, так что «свет погас»
// по построению: коллектор света ходит по view<Transform, PropLight>.
static void test_projectile_shatters_lamp_and_light_dies() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 13;

    // Потолочная лампа: якорная клетка твёрдая, спавн — из строки таблицы,
    // никакого хардкода fall/mat/цвета на месте вызова ([jirnyak.md] §21).
    world.grid().fill_cell(14, 6, 14, kMatConcrete);
    game::SubVoxelAnchor anchor{};
    anchor.cx = 14;
    anchor.cy = 6;
    anchor.cz = 14;
    anchor.subX = 4;
    anchor.subY = 4;
    anchor.subZ = 4;
    anchor.face = 0;
    const vec3 pos{14.5f * 2.0f, 6.5f * 2.0f, 14.5f * 2.0f};
    const auto lamp = game::spawn_prop_from_id(reg, world, pos, anchor,
                                               game::PropId::BareBulb, layer);
    CHECK(reg.valid(lamp));
    CHECK(reg.all_of<game::StaticPropTag>(lamp));
    // Строка светит (12000 мм / 1800 e3) — свет обязан гореть ДО выстрела,
    // иначе «погас» ниже не проверяет ничего.
    CHECK(reg.all_of<game::PropLight>(lamp));

    game::ParticleBurstQueue bursts;

    // Промах: снаряд в пяти клетках — лампа стоит, очередь пуста.
    CHECK(!game::check_projectile_prop_hits(
        reg, vec3{pos.x + 10.0f, pos.y, pos.z}, vec3{0.0f, 0.0f, -40.0f},
        game::kProjHitRadius, bus, &bursts, 5u));
    CHECK(reg.valid(lamp));
    CHECK(bursts.count == 0u);

    // Попадание: снаряд в 0.3 м, летит в лампу — тот же радиус, каким он
    // трогает тела (kProjHitRadius, combat.h).
    bus.clear();
    CHECK(game::check_projectile_prop_hits(
        reg, vec3{pos.x, pos.y, pos.z + 0.3f}, vec3{0.0f, 0.0f, -40.0f},
        game::kProjHitRadius, bus, &bursts, 5u));

    // Всплеск: осколки, тонированные материалом лампы — neon_tube, не air.
    CHECK(bursts.count > 0u);
    CHECK(bursts.items[0].count > 0u);
    CHECK(bursts.items[0].kind ==
          static_cast<std::uint8_t>(game::ParticleKind::Debris));
    CHECK(bursts.items[0].matId == 20u);

    // Сущность унесена целиком (GpuHandoff: ноль CPU-обломков)...
    CHECK(!reg.valid(lamp));
    CHECK(bus.cycle_count(EventType::PropDetached) > 0u);
    // ...и СВЕТ ПОГАС: во всём реестре не осталось ни одного PropLight.
    std::uint32_t lit = 0;
    for (auto e : reg.view<const game::PropLight>()) {
        (void)e;
        ++lit;
    }
    CHECK(lit == 0u);
    printf("[props] projectile shatters lamp: burst mat=20, light died\n");
}


// [jirnyak.md] section 18/20 -- terminals are sim-owned via seed_wall_interactables.
// PropPass no longer exposes get_terminal_positions; interaction_step must resolve
// ECS Interactable entities, not ghost GPU instances from env_detail.
static void test_sim_owned_terminals_seed_and_interact() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 21;
    const std::uint32_t seed = 0xC0FFEEu;

    // Z-up floor band with wall columns -- seed_wall_interactables needs air
    // above solid floor + solid W/E/N/S. Tiny rooms under-seed for this salt.
    paint_floor_band(world, /*x0*/2, /*x1*/70, /*zFloor*/5, /*y0*/2, /*y1*/70);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    CHECK(nWall > 0u);

    std::vector<vec3> terms;
    game::collect_interactable_positions(reg, layer, game::Interactable::Kind::Terminal, terms);
    std::vector<vec3> shields;
    game::collect_interactable_positions(reg, layer, game::Interactable::Kind::ElectricalShield, shields);
    CHECK(terms.size() + shields.size() > 0u);

    // Prefer Terminal if present; else ElectricalShield (both are wall devices).
    const auto kind = !terms.empty() ? game::Interactable::Kind::Terminal
                                     : game::Interactable::Kind::ElectricalShield;
    const vec3 target = !terms.empty() ? terms[0] : shields[0];

    // Actor 1.5 m from target -- inside interaction_step default reach (~3 m).
    const Entity actor = make_actor_at(reg, layer,
        vec3{target.x + 1.5f, target.y, target.z});

    {
        const game::InteractionHit hit = game::find_nearest_interactable(
            reg, actor, kind, 4.0f);
        CHECK(hit.hit);
        CHECK(hit.entity != entt::null);
        CHECK(reg.all_of<game::Interactable>(hit.entity));
        CHECK(reg.get<game::Interactable>(hit.entity).kind == kind);
    }

    bus.clear();
    game::InteractionHit out{};
    CHECK(game::interaction_step(reg, actor, kind, bus, &out));
    CHECK(out.hit);
    CHECK(out.entity != entt::null);
    CHECK(reg.valid(out.entity));
    CHECK(reg.all_of<game::Interactable>(out.entity));

    printf("[props] s20 sim-owned terminals: nWall=%u terms=%zu shields=%zu interact=ok\n",
           nWall, terms.size(), shields.size());
}

void test_props_game_all() {
    test_wall_interactables_seed_and_collect();
    test_wall_interactables_clear_is_layer_scoped();
    test_ceiling_lights_seed_and_collect();
    test_ceiling_lights_need_a_floor_under_them();
    test_ceiling_lights_hang_from_a_sandwich_slab();
    test_ceiling_lights_do_not_collide_with_wall_devices();
    test_padic_props_seed_tags_layer();
    test_spawn_prop_anchor_and_detach_on_air();
    test_world_anchored_link_severed_by_carve();
    test_anchor_column_probe_both_polarities();
    test_anchor_validate_skips_solid_support();
    test_detached_prop_is_rigid_body();
    test_gpu_handoff_destroys_parent_without_cpu_debris();
    test_clear_layer_props_spares_containers();
    test_furniture_is_not_a_terminal();
    test_lamp_rows_are_gpu_handoff_neon();
    test_projectile_shatters_lamp_and_light_dies();
    test_find_nearest_terminal_respects_reach();
    test_sim_owned_terminals_seed_and_interact();
    test_embody_interact_terminal_applies_at_given_pos();
    test_collect_static_prop_mesh_instances_shapes();
    test_corpse_and_loot_are_interactable();
}
