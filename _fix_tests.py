# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"C:/hades/gigahrush2/tests/suite_props_game.inl")
t = p.read_text(encoding="utf-8")
print("len", len(t))
print("has section18", "section 18" in t)
print("has jirnyak", "jirnyak" in t)
print("anchor.x", "anchor.x" in t)
print("anchor.cx", "anchor.cx" in t)
print("spawn_prop(reg, world", "spawn_prop(reg, world" in t)
print("spawn_prop(reg, layer", "spawn_prop(reg, layer" in t)

# Keep everything before the first §18 marker or before test_props_game_all
markers = [
    t.find("// --- [jirnyak.md]"),
    t.find("// --- [jirnyak.md] section 18"),
    t.rfind("void test_props_game_all()"),
]
# Prefer earliest jirnyak marker if present
cut = -1
for m in markers[:2]:
    if m >= 0:
        cut = m
        break
if cut < 0:
    cut = markers[2]
print("cut", cut)

head = t[:cut]

# Ensure required includes in head
need = [
    ('#include "game/event_bus.h"', '#include "game/floors/padic_module.h"'),
    ('#include "game/prop_system.h"', '#include "game/floors/padic_module.h"'),
    ('#include "world/materials.h"', '#include "world/world.h"'),
    ('#include "world/types.h"', '#include "world/world.h"'),
    ('#include <vector>', '#include <cmath>'),
    ('#include <cstdint>', '#include <cmath>'),
]
for inc, after in need:
    if inc not in head:
        if after in head:
            head = head.replace(after, after + "\n" + inc)
        else:
            head = inc + "\n" + head

new_tail = r'''// --- [jirnyak.md] section 18: spawn / anchor validate / ragdoll settle ---------

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
    CHECK(reg.all_of<game::StaticPropTag, game::SubVoxelAnchor, Transform,
                     game::Interactable, game::PropMeshTag>(e));
    CHECK(!reg.all_of<Velocity>(e));
    CHECK(!reg.all_of<AngularVelocity>(e));
    CHECK(!reg.all_of<game::DynamicBodyTag>(e));

    const auto& a = reg.get<game::SubVoxelAnchor>(e);
    CHECK(a.cx == 10 && a.cy == 4 && a.cz == 10);
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
    CHECK(reg.all_of<game::DynamicBodyTag, Velocity, AngularVelocity, Rotation>(e));
    CHECK(bus.cycle_count(EventType::PropDetached) >= 1u);
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
    CHECK(reg.all_of<game::StaticPropTag, game::SubVoxelAnchor>(e));

    // Dirty the cell but leave it solid -- prop stays anchored.
    const std::vector<std::uint32_t> dirty{
        static_cast<std::uint32_t>(macro_index(3, 2, 3))};
    bus.clear();
    game::anchor_validate_step(reg, world, bus, dirty);
    CHECK(reg.all_of<game::StaticPropTag, game::SubVoxelAnchor>(e));
    CHECK(!reg.all_of<Velocity>(e));
    CHECK(bus.cycle_count(EventType::PropDetached) == 0u);
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

void test_props_game_all() {
    test_wall_interactables_seed_and_collect();
    test_wall_interactables_clear_is_layer_scoped();
    test_padic_props_seed_tags_layer();
    test_spawn_prop_anchor_and_detach_on_air();
    test_anchor_validate_skips_solid_support();
    test_prop_ragdoll_step_damps_angular();
}
'''

out = head + new_tail
out_bytes = out.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
p.write_bytes(out_bytes)
print("wrote", len(out_bytes))
print("verify cx", b"anchor.cx" in out_bytes)
print("verify spawn world", b"spawn_prop(reg, world" in out_bytes)
