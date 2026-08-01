// suite_props_game.inl — Unit tests for ECS Prop System ([jirnyak.md] §18).
// Wall-mounted Terminal / ElectricalShield live in ECS Interactable entities
// tagged by Transform.layer. PropPass is render-only; sim+HUD must not read it.

#include "game/floors/padic/padic.h"
#include "game/prop_system.h"
#include "world/world.h"
#include "world/materials.h"
#include "ecs/components.h"
#include "game/event_bus.h"

#include <cmath>

namespace {

// seed_wall_interactables walks AIR cells with a SOLID cell below (floor),
// then rolls spatial_hash for Terminal (2%) / ElectricalShield (1%). Paint a
// solid floor slab under an air band so the walk finds candidates. No PropPass.
static void paint_floor_band(World& world, int x0, int x1, int yFloor, int z0, int z1) {
    for (int z = z0; z < z1; ++z)
        for (int x = x0; x < x1; ++x)
            world.grid().fill_cell(x, yFloor, z, kMatConcrete);
    // air above stays kCellAir (default) — that is the candidate band at yFloor+1.
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

void test_props_game_all() {
    test_wall_interactables_seed_and_collect();
    test_wall_interactables_clear_is_layer_scoped();
    test_padic_props_seed_tags_layer();
}
