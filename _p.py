# -*- coding: utf-8 -*-
from pathlib import Path

R = Path(r"C:\hades\gigahrush2")
log = []


def L(m):
    print(m)
    log.append(m)


def rep(rel, a, b, lab):
    p = R / rel
    t = p.read_text(encoding="utf-8").replace("\r\n", "\n")
    if a not in t:
        (R / "_fail.txt").write_text(lab + "\n---\n" + a[:300], encoding="utf-8")
        raise SystemExit("FAIL " + lab)
    n = t.count(a)
    if n != 1:
        raise SystemExit("FAIL %s count=%d" % (lab, n))
    p.write_text(t.replace(a, b, 1), encoding="utf-8", newline="\n")
    L("OK " + lab)


# 1 console DynamicBodyTag
rep(
    "src/game/console.cpp",
    "    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});\n\n    if (out && cap)",
    "    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});\n"
    "    // BodyPass / physics free-body filter ([jirnyak.md] section 18).\n"
    "    ctx.ecs->emplace<DynamicBodyTag>(ball);\n\n    if (out && cap)",
    "console DynamicBodyTag",
)

# 2 wall neighbors
rep(
    "src/game/prop_system.cpp",
    "                const CellType below = grid.cell(x, y - 1, z);\n"
    "                if (!is_solid_cell(below)) continue;\n\n"
    "                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));\n"
    "                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));\n"
    "                const bool solidNorth = is_solid_cell(grid.cell(x, y, z + 1));\n"
    "                const bool solidSouth = is_solid_cell(grid.cell(x, y, z - 1));",
    "                const CellType below = grid.cell(x, y, z - 1);\n"
    "                if (!is_solid_cell(below)) continue;\n\n"
    "                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));\n"
    "                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));\n"
    "                const bool solidNorth = is_solid_cell(grid.cell(x, y + 1, z));\n"
    "                const bool solidSouth = is_solid_cell(grid.cell(x, y - 1, z));",
    "wall neighbors Z-up",
)

# 3 wall yOff -> zOff
rep(
    "src/game/prop_system.cpp",
    "                Interactable::Kind kind;\n"
    "                float yOff;\n"
    "                vec3 color;\n"
    "                std::uint8_t shape = 0;\n"
    "                std::uint8_t matId = 4;\n"
    "                std::uint8_t face = 1; // wall\n"
    "                if (wsel >= 15 && wsel < 25) {\n"
    "                    kind  = Interactable::Kind::ElectricalShield;\n"
    "                    yOff  = 0.40f;",
    "                Interactable::Kind kind;\n"
    "                float zOff;\n"
    "                vec3 color;\n"
    "                std::uint8_t shape = 0;\n"
    "                std::uint8_t matId = 4;\n"
    "                std::uint8_t face = 1; // wall\n"
    "                if (wsel >= 15 && wsel < 25) {\n"
    "                    kind  = Interactable::Kind::ElectricalShield;\n"
    "                    zOff  = 0.40f;",
    "wall zOff decl",
)

rep(
    "src/game/prop_system.cpp",
    "                    kind  = Interactable::Kind::Terminal;\n"
    "                    yOff  = 0.0f;",
    "                    kind  = Interactable::Kind::Terminal;\n"
    "                    zOff  = 0.0f;",
    "wall zOff terminal",
)

rep(
    "src/game/prop_system.cpp",
    "                const float wx = static_cast<float>(x) * kCell;\n"
    "                const float wy = static_cast<float>(y) * kCell + yOff;\n"
    "                const float wz = static_cast<float>(z) * kCell;\n\n"
    "                // Anchor into the solid floor cell under the air cell (Y-1).\n"
    "                SubVoxelAnchor anchor;\n"
    "                anchor.cx   = x;\n"
    "                anchor.cy   = wrap_macro(y - 1);\n"
    "                anchor.cz   = z;\n"
    "                anchor.subX = 4;\n"
    "                anchor.subY = 7; // top of floor cell\n"
    "                anchor.subZ = 4;",
    "                const float wx = static_cast<float>(x) * kCell;\n"
    "                const float wy = static_cast<float>(y) * kCell;\n"
    "                const float wz = static_cast<float>(z) * kCell + zOff;\n\n"
    "                // Anchor into the solid floor cell under the air cell (Z-1).\n"
    "                SubVoxelAnchor anchor;\n"
    "                anchor.cx   = x;\n"
    "                anchor.cy   = y;\n"
    "                anchor.cz   = wrap_macro(z - 1);\n"
    "                anchor.subX = 4;\n"
    "                anchor.subY = 4;\n"
    "                anchor.subZ = 7; // top of floor cell",
    "wall origin+anchor Z-up",
)

# 4 ceiling
rep(
    "src/game/prop_system.cpp",
    "                const CellType above = grid.cell(x, y + 1, z);\n"
    "                if (!is_solid_cell(above)) continue;\n\n"
    "                const std::uint32_t rngLight = giga::spatial_hash(x, y, z, seed ^ kSaltLight);\n"
    "                if ((rngLight % 100u) >= kLightChancePct) continue;\n\n"
    "                const float wx = static_cast<float>(x) * kCell;\n"
    "                const float wy = static_cast<float>(y) * kCell + 1.55f;\n"
    "                const float wz = static_cast<float>(z) * kCell;\n\n"
    "                SubVoxelAnchor anchor;\n"
    "                anchor.cx   = x;\n"
    "                anchor.cy   = wrap_macro(y + 1);\n"
    "                anchor.cz   = z;\n"
    "                anchor.subX = 4;\n"
    "                anchor.subY = 0; // bottom of ceiling cell\n"
    "                anchor.subZ = 4;",
    "                const CellType above = grid.cell(x, y, z + 1);\n"
    "                if (!is_solid_cell(above)) continue;\n\n"
    "                const std::uint32_t rngLight = giga::spatial_hash(x, y, z, seed ^ kSaltLight);\n"
    "                if ((rngLight % 100u) >= kLightChancePct) continue;\n\n"
    "                const float wx = static_cast<float>(x) * kCell;\n"
    "                const float wy = static_cast<float>(y) * kCell;\n"
    "                const float wz = static_cast<float>(z) * kCell + 1.55f;\n\n"
    "                SubVoxelAnchor anchor;\n"
    "                anchor.cx   = x;\n"
    "                anchor.cy   = y;\n"
    "                anchor.cz   = wrap_macro(z + 1);\n"
    "                anchor.subX = 4;\n"
    "                anchor.subY = 4;\n"
    "                anchor.subZ = 0; // bottom of ceiling cell",
    "ceiling Z-up",
)

rep(
    "src/game/prop_system.cpp",
    "    // 25-35 terminal). Floor support = solidBelow on Y (same convention as\n"
    "    // prop_placer). Anchor sub-voxels point into the solid floor cell so",
    "    // 25-35 terminal). World is Z-up: floor support = solid cell at z-1.\n"
    "    // Horizontal walls are X/Y neighbors. Anchor into solid floor so",
    "wall comment",
)

rep(
    "src/game/prop_system.cpp",
    "    //   origin = {wx, wy + 1.55f, wz}\n"
    "    // Anchor into the solid ceiling cell (Y+1) so spawn_prop solid() and",
    "    //   origin = {wx, wy, wz + 1.55f}\n"
    "    // Anchor into the solid ceiling cell (Z+1) so spawn_prop solid() and",
    "ceil comment",
)

# 5 prop_placer
rep(
    "src/render/prop_placer.cpp",
    "                CellType below = grid.cell(x, y - 1, z);\n"
    "                CellType above = grid.cell(x, y + 1, z);\n"
    "                CellType west  = grid.cell(x - 1, y, z);\n"
    "                CellType east  = grid.cell(x + 1, y, z);\n"
    "                CellType north = grid.cell(x, y, z + 1);\n"
    "                CellType south = grid.cell(x, y, z - 1);",
    "                // Z-up: below/above on Z; north/south on Y.\n"
    "                CellType below = grid.cell(x, y, z - 1);\n"
    "                CellType above = grid.cell(x, y, z + 1);\n"
    "                CellType west  = grid.cell(x - 1, y, z);\n"
    "                CellType east  = grid.cell(x + 1, y, z);\n"
    "                CellType north = grid.cell(x, y + 1, z);\n"
    "                CellType south = grid.cell(x, y - 1, z);",
    "placer neighbors",
)

for a, b in [
    ("grate.origin    = {wx, wy + 0.01f, wz};", "grate.origin    = {wx, wy, wz + 0.01f};"),
    ("rad.origin    = {wx, wy + 0.05f, wz};", "rad.origin    = {wx, wy, wz + 0.05f};"),
    ("cam.origin    = {wx, wy + 1.50f, wz};", "cam.origin    = {wx, wy, wz + 1.50f};"),
    ("crystal.origin    = {wx, wy + 0.01f, wz};", "crystal.origin    = {wx, wy, wz + 0.01f};"),
    ("bench.origin    = {wx, wy + 0.01f, wz};", "bench.origin    = {wx, wy, wz + 0.01f};"),
    ("rail.origin    = {wx, wy + 0.01f, wz};", "rail.origin    = {wx, wy, wz + 0.01f};"),
    ("item.origin    = {wx, wy + 0.01f, wz};", "item.origin    = {wx, wy, wz + 0.01f};"),
]:
    rep("src/render/prop_placer.cpp", a, b, "placer " + a.split("=")[0].strip())

# 6 padic_module full rewrite
padic_new = r'''// PADIC module registration — the module's rows in the floor catalog.
//
// One claim today: floor number 4 ([padic.h] — the explicit-beats-pattern
// proof). As the module grows, its special loot tables, carvers, story NPCs,
// quests, events and interactive objects register from THIS file, so deleting
// the folder deletes the floor cleanly and nothing else has to know.
#include "game/floors/padic/padic.h"
#include "game/floor_catalog.h"
#include "game/prop_system.h"
#include "ecs/components.h"
#include "core/wrap.h"
#include "world/types.h"

namespace giga::game {

bool register_padic_floor(FloorCatalog& cat) {
    return cat.claim(kPadicFloorNumber, {"padic", FloorKind::Padic});
}

std::uint32_t seed_padic_props(Registry& reg, const World& world, LayerId layer,
                               int number, unsigned seed, EventBus& bus) {
    std::uint32_t count = 0;
    (void)seed;
    (void)number;
    (void)bus;

    const MacroGrid& grid = world.grid();

    // Match padic_gen.cpp PlanStair lattice exactly:
    //   hasStair when ((bi+bj)&1)==0
    //   sx = bx+13, sy = by+1  (flight A); flight B is sy+1
    //   storey bases b = 0,3,...,123; sandwich ceiling lives in cell b+2
    //   (kCeilW = sz=6 inside that cell). Shaft has no full sandwich, but
    //   stamp_stair puts an entry-strip slab at (sx, sy / sy+1, b+2).
    // Corridor mouth is (sx, by=sy-1) with opening — use a normal ceiling
    // neighbor when solid, else hang from the entry strip solid bits.
    constexpr int kStorey = 3;
    constexpr int kLastBase = 123;
    constexpr int kCorr0 = 16;          // kLatticeHalf
    constexpr int kLatticeSpacing = 32;
    constexpr int kLatticeDim = 4;

    auto try_spawn_bulb = [&](int cx, int cy, int airZ) -> bool {
        SubVoxelAnchor anchor{};
        vec3 bulbPos{};
        const int ceilZ = airZ + 1;
        const int wcx = wrap_macro(cx);
        const int wcy = wrap_macro(cy);
        const int wAir = wrap_macro(airZ);
        const int wCeil = wrap_macro(ceilZ);

        if (grid.solid(wcx, wcy, wCeil, 4, 4, 0)) {
            anchor.cx = wcx;
            anchor.cy = wcy;
            anchor.cz = wCeil;
            anchor.subX = 4;
            anchor.subY = 4;
            anchor.subZ = 0;
            anchor.face = 2;
            bulbPos = vec3{static_cast<float>(cx) * kCellSize + 1.0f,
                           static_cast<float>(cy) * kCellSize + 1.0f,
                           static_cast<float>(airZ) * kCellSize + 1.55f};
        } else if (grid.solid(wcx, wcy, wAir, 2, 4, 6)) {
            anchor.cx = wcx;
            anchor.cy = wcy;
            anchor.cz = wAir;
            anchor.subX = 2;
            anchor.subY = 4;
            anchor.subZ = 6;
            anchor.face = 2;
            bulbPos = vec3{static_cast<float>(cx) * kCellSize + 0.5f,
                           static_cast<float>(cy) * kCellSize + 1.0f,
                           static_cast<float>(airZ) * kCellSize + 1.55f};
        } else {
            return false; // no honest solid support — do not float a lamp
        }

        Entity lamp = spawn_prop(reg, world, bulbPos, anchor,
                                 Interactable::Kind::LightBulb,
                                 PropFallMode::RagdollRoll,
                                 vec3{1.0f, 0.95f, 0.7f}, /*meshKind*/28, layer,
                                 /*yaw*/0.0f, /*emissive*/250);
        return lamp != entt::null;
    };

    for (int b = 0; b <= kLastBase; b += kStorey) {
        for (int bj = 0; bj < kLatticeDim; ++bj) {
            for (int bi = 0; bi < kLatticeDim; ++bi) {
                if (((bi + bj) & 1) != 0) continue;
                const int bx = kCorr0 + bi * kLatticeSpacing + 2;
                const int by = kCorr0 + bj * kLatticeSpacing + 2;
                const int sx = bx + 13;
                const int sy = by + 1; // PlanStair.y — flight A row

                const int airZ = b + 1;
                if (try_spawn_bulb(sx, by, airZ)) ++count;       // corridor mouth
                if (try_spawn_bulb(sx, sy, airZ)) ++count;       // flight A
                if (try_spawn_bulb(sx, sy + 1, airZ)) ++count;   // flight B
            }
        }
    }
    return count;
}

} // namespace giga::game
'''
(R / "src/game/floors/padic/padic_module.cpp").write_text(padic_new, encoding="utf-8", newline="\n")
L("OK padic_module")

# 7 suite_props_game.inl — targeted fixes
import re

tt = (R / "tests/suite_props_game.inl").read_text(encoding="utf-8").replace("\r\n", "\n")

# paint_floor_band body
m = re.search(
    r"static void paint_floor_band\(World& world, int x0, int x1, int yFloor, int z0, int z1\) \{.*?\n\}",
    tt,
    re.S,
)
if not m:
    raise SystemExit("FAIL paint_floor_band fn")
new_pf = """static void paint_floor_band(World& world, int x0, int x1, int zFloor, int y0, int y1) {
    const int zAir = zFloor + 1;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            world.grid().fill_cell(x, y, zFloor, kMatConcrete); // floor (Z-up)
            // Even offset from x0 -> wall column; odd -> air corridor cell.
            if (((x - x0) & 1) == 0)
                world.grid().fill_cell(x, y, zAir, kMatConcrete);
        }
    }
}"""
tt = tt[: m.start()] + new_pf + tt[m.end() :]
L("OK paint_floor_band")

m = re.search(
    r"static void paint_ceiling_band\(World& world, int x0, int x1, int yAir, int z0, int z1\) \{.*?\n\}",
    tt,
    re.S,
)
if not m:
    raise SystemExit("FAIL paint_ceiling_band fn")
new_pc = """static void paint_ceiling_band(World& world, int x0, int x1, int zAir, int y0, int y1) {
    const int zCeil = zAir + 1;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            world.grid().fill_cell(x, y, zCeil, kMatConcrete);
        }
    }
}"""
tt = tt[: m.start()] + new_pc + tt[m.end() :]
L("OK paint_ceiling_band")

# lamp height assert p.y -> p.z
if "CHECK(p.y > 16.0f && p.y < 19.0f)" in tt:
    tt = tt.replace(
        "CHECK(p.y > 16.0f && p.y < 19.0f)",
        "CHECK(p.z > 16.0f && p.z < 19.0f)",
        1,
    )
    L("OK lamp assert p.z")
elif "CHECK(p.z > 16.0f && p.z < 19.0f)" in tt:
    L("OK lamp assert already p.z")
else:
    raise SystemExit("FAIL lamp assert")

tt = tt.replace("/*yFloor*/", "/*zFloor*/").replace("/*yAir*/", "/*zAir*/")

# Room paints Y-up -> Z-up (two variants)
room_old1 = """    for (int z = 10; z < 18; ++z) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, 2, z, kMatConcrete);
            world.grid().fill_cell(x, 5, z, kMatConcrete);
        }
    }
    for (int z = 10; z < 18; ++z)
        for (int y = 3; y < 5; ++y)
            world.grid().fill_cell(10, y, z, kMatConcrete);"""
room_new1 = """    for (int y = 10; y < 18; ++y) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, y, 2, kMatConcrete);
            world.grid().fill_cell(x, y, 5, kMatConcrete);
        }
    }
    for (int y = 10; y < 18; ++y)
        for (int z = 3; z < 5; ++z)
            world.grid().fill_cell(10, y, z, kMatConcrete);"""
c = tt.count(room_old1)
if c:
    tt = tt.replace(room_old1, room_new1)
    L("OK room paint x%d" % c)
else:
    L("WARN room paint pattern not found")

# padic test rewrite
start = tt.find("static void test_padic_props_seed_tags_layer()")
if start < 0:
    raise SystemExit("FAIL padic test missing")
end = tt.find("\nstatic void ", start + 10)
if end < 0:
    raise SystemExit("FAIL padic test end")
new_padic = '''static void test_padic_props_seed_tags_layer() {
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

'''
tt = tt[:start] + new_padic + tt[end:]
if '#include "game/floors/padic/padic.h"' not in tt:
    # find first include block
    ip = tt.find("#include")
    tt = tt[:ip] + '#include "game/floors/padic/padic.h"\n#include "game/floor_spec.h"\n' + tt[ip:]
elif "floor_spec.h" not in tt:
    tt = tt.replace(
        '#include "game/floors/padic/padic.h"\n',
        '#include "game/floors/padic/padic.h"\n#include "game/floor_spec.h"\n',
        1,
    )
(R / "tests/suite_props_game.inl").write_text(tt, encoding="utf-8", newline="\n")
L("OK suite_props_game")

# 8 suite_console DynamicBodyTag
ct = (R / "tests/suite_console.inl").read_text(encoding="utf-8").replace("\r\n", "\n")
if "all_of<DynamicBodyTag>(ball)" in ct:
    L("OK suite_console already has DynamicBodyTag")
else:
    needle = "CHECK(ecs.all_of<GravityAffected>(ball));"
    # find one near spawn_ball test - prefer first after spawn_ball mention
    idx = ct.find("test_console_spawn")
    if idx < 0:
        idx = ct.find("spawn_ball")
    if idx < 0:
        raise SystemExit("FAIL console spawn test")
    pos = ct.find(needle, idx)
    if pos < 0:
        # any GravityAffected ball
        pos = ct.find(needle)
    if pos < 0:
        (R / "_console_snip.txt").write_text(ct[idx : idx + 1500], encoding="utf-8")
        raise SystemExit("FAIL console GravityAffected")
    insert = "CHECK(ecs.all_of<GravityAffected>(ball));\n    CHECK(ecs.all_of<DynamicBodyTag>(ball));"
    ct = ct[:pos] + insert + ct[pos + len(needle) :]
    (R / "tests/suite_console.inl").write_text(ct, encoding="utf-8", newline="\n")
    L("OK suite_console DynamicBodyTag")

L("ALL PHASE1+2 DONE")
(R / "_patch_log.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
