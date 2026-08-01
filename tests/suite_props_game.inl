// suite_props_game.inl — Unit tests for ECS Prop System ([jirnyak.md] §18).
// Wall-mounted Terminal / ElectricalShield live in ECS Interactable entities
// tagged by Transform.layer. PropPass is render-only; sim+HUD must not read it.

#include "game/floors/padic/padic.h"
#include "game/prop_system.h"
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
static void paint_floor_band(World& world, int x0, int x1, int yFloor, int z0, int z1) {
    const int yAir = yFloor + 1;
    for (int z = z0; z < z1; ++z) {
        for (int x = x0; x < x1; ++x) {
            world.grid().fill_cell(x, yFloor, z, kMatConcrete); // floor
            // Even offset from x0 → wall column; odd → air corridor cell.
            if (((x - x0) & 1) == 0)
                world.grid().fill_cell(x, yAir, z, kMatConcrete);
        }
    }
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

} // namespace

static void test_wall_interactables_seed_and_collect() {
    Registry reg;
    World world;
    const LayerId layer = 1;
    const unsigned seed = 0xC0FFEEu;

    // Dense floor band: enough air-above-solid candidates that 2%/1% rolls
    // produce at least one Terminal and one ElectricalShield under this seed.
    paint_floor_band(world, /*x0*/2, /*x1*/80, /*yFloor*/5, /*z0*/2, /*z1*/80);

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

static void test_padic_props_seed_tags_layer() {
    // seed_padic_props must tag Transform.layer so clear_layer_props can reclaim
    // the slot on the next arrival. No PropPass involved.
    Registry reg;
    World world;
    EventBus bus;
    const LayerId layer = 4;
    // seed_padic_props walks its own stairwell lattice; empty grid → n may be 0.
    // If it spawns anything, every entity must carry Transform.layer == layer.
    const std::uint32_t n =
        game::seed_padic_props(reg, world, layer, /*number=*/4, /*seed=*/0x0BAD1Cu, bus);
    if (n > 0) {
        auto view = reg.view<const game::Interactable, const Transform>();
        int tagged = 0;
        for (auto e : view) {
            if (view.get<const Transform>(e).layer == layer) ++tagged;
        }
        CHECK(tagged == static_cast<int>(n));
        CHECK(game::clear_layer_props(reg, layer) == n);
    } else {
        // Still exercise the call path: clear of an empty layer is a no-op.
        CHECK(game::clear_layer_props(reg, layer) == 0);
    }
}

// --- [jirnyak.md] section 18: spawn / anchor validate / ragdoll settle ---------

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
    CHECK(!reg.all_of<AngularVelocity>(e));
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
    CHECK(reg.all_of<AngularVelocity>(e));
    CHECK(reg.all_of<Rotation>(e));
    {
        const std::uint32_t n = bus.cycle_count(EventType::PropDetached);
        CHECK(n > 0u);
    }
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

static void test_prop_ragdoll_step_damps_angular() {
    Registry reg;
    const auto e = reg.create();
    reg.emplace<game::DynamicBodyTag>(e);
    reg.emplace<AngularVelocity>(e, AngularVelocity{vec3{10.0f, -8.0f, 4.0f}});
    reg.emplace<Rotation>(e, Rotation{});
    reg.emplace<Velocity>(e, Velocity{});

    // High angular speed -> active ragdoll path (exp damping).
    const float dt = 1.0f / 60.0f;
    const vec3 before = reg.get<AngularVelocity>(e).w;
    game::prop_ragdoll_step(reg, dt);
    const vec3 after = reg.get<AngularVelocity>(e).w;
    const float bl = std::sqrt(before.x * before.x + before.y * before.y +
                               before.z * before.z);
    const float al = std::sqrt(after.x * after.x + after.y * after.y +
                               after.z * after.z);
    CHECK(al < bl);
    CHECK(al > 0.0f);

    // Near-rest: small omega should be zeroed and AngularVelocity removed.
    reg.get<AngularVelocity>(e).w = vec3{0.001f, 0.0f, 0.0f};
    game::prop_ragdoll_step(reg, dt);
    CHECK(!reg.all_of<AngularVelocity>(e));
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

void test_props_game_all() {
    test_wall_interactables_seed_and_collect();
    test_wall_interactables_clear_is_layer_scoped();
    test_padic_props_seed_tags_layer();
    test_spawn_prop_anchor_and_detach_on_air();
    test_anchor_validate_skips_solid_support();
    test_prop_ragdoll_step_damps_angular();
    test_find_nearest_terminal_respects_reach();
    test_embody_interact_terminal_applies_at_given_pos();
}
