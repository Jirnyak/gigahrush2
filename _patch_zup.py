#!/usr/bin/env python3
"""One-shot Z-up + DynamicBodyTag + padic lamp lattice patch. Delete after use."""
from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")


def must_replace(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        # try CRLF
        old2 = old.replace("\n", "\r\n")
        new2 = new.replace("\n", "\r\n")
        if old2 in text:
            old, new = old2, new2
        else:
            raise SystemExit(f"FAIL {label}: pattern not found in {path}")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"FAIL {label}: expected 1 match, got {n} in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    print(f"OK {label}")


# --- 1. console.cpp: DynamicBodyTag on spawn_ball ---
must_replace(
    ROOT / "src/game/console.cpp",
    """    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});

    if (out && cap)
        std::snprintf(out, cap,
                      "spawn_ball: body at (%.1f, %.1f, %.1f) layer %u",""",
    """    ctx.ecs->emplace<Renderable>(ball, Renderable{vec3{0.95f, 0.15f, 0.10f}});
    // BodyPass / physics free-body filter ([jirnyak.md] section 18). No
    // AngularVelocity/Rotation -- tumbling is RagdollRoll props only.
    ctx.ecs->emplace<DynamicBodyTag>(ball);

    if (out && cap)
        std::snprintf(out, cap,
                      "spawn_ball: body at (%.1f, %.1f, %.1f) layer %u",""",
    "console DynamicBodyTag",
)


# --- 2. prop_system.cpp: seed_wall_interactables Z-up ---
must_replace(
    ROOT / "src/game/prop_system.cpp",
    """std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate wall-device branch (wsel bands 15-25 shield,
    // 25-35 terminal). Floor support = solidBelow on Y (same convention as
    // prop_placer). Anchor sub-voxels point into the solid floor cell so
    // spawn_prop's solid() check and anchor_validate_step stay honest.
    for (int z = 0; z < kMacroDimLocal; ++z) {
        for (int y = 0; y < kMacroDimLocal; ++y) {
            for (int x = 0; x < kMacroDimLocal; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType below = grid.cell(x, y - 1, z);
                if (!is_solid_cell(below)) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y, z + 1));
                const bool solidSouth = is_solid_cell(grid.cell(x, y, z - 1));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 100;

                // Wall yaw matches PropPlacer (west=0, east=pi, south=halfPi, north=3*halfPi).
                float yawVal = 0.0f;
                if (solidWest)        yawVal = 0.0f;
                else if (solidEast)   yawVal = kPi;
                else if (solidSouth)  yawVal = kHalfPi;
                else if (solidNorth)  yawVal = kHalfPi * 3.0f;

                Interactable::Kind kind;
                float yOff;
                vec3 color;
                std::uint8_t shape = 0;
                std::uint8_t matId = 4;
                std::uint8_t face = 1; // wall
                if (wsel >= 15 && wsel < 25) {
                    kind  = Interactable::Kind::ElectricalShield;
                    yOff  = 0.40f;
                    color = {0.18f, 0.20f, 0.22f};
                    shape = kShapeElectricalShield;
                    matId = 4;
                } else if (wsel >= 25 && wsel < 35) {
                    kind  = Interactable::Kind::Terminal;
                    yOff  = 0.0f;
                    color = {0.32f, 0.35f, 0.38f};
                    shape = kShapeTerminal;
                    matId = 3;
                } else {
                    continue; // radiator / empty — no Interactable
                }

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell + yOff;
                const float wz = static_cast<float>(z) * kCell;

                // Anchor into the solid floor cell under the air cell (Y-1).
                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = wrap_macro_local(y - 1);
                anchor.cz   = z;
                anchor.subX = 4;
                anchor.subY = 7; // top of floor cell
                anchor.subZ = 4;
                anchor.face = face;

                const std::uint8_t anim = static_cast<std::uint8_t>(rngWall & 0xFFu);
                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor, kind,
                                      PropFallMode::SimpleFall, color, shape, layer,
                                      yawVal, /*emissive*/0, matId, anim, /*flags*/0);
                if (e != entt::null) ++count;

            }
        }
    }
    return count;
}""",
    """std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate wall-device branch (wsel bands 15-25 shield,
    // 25-35 terminal). World is Z-up: floor support = solid cell at z-1.
    // Horizontal walls are X/Y neighbors. Anchor into the solid floor cell so
    // spawn_prop's solid() check and anchor_validate_step stay honest.
    for (int z = 0; z < kMacroDimLocal; ++z) {
        for (int y = 0; y < kMacroDimLocal; ++y) {
            for (int x = 0; x < kMacroDimLocal; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType below = grid.cell(x, y, z - 1);
                if (!is_solid_cell(below)) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y + 1, z));
                const bool solidSouth = is_solid_cell(grid.cell(x, y - 1, z));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 100;

                // Wall yaw matches PropPlacer (west=0, east=pi, south=halfPi, north=3*halfPi).
                float yawVal = 0.0f;
                if (solidWest)        yawVal = 0.0f;
                else if (solidEast)   yawVal = kPi;
                else if (solidSouth)  yawVal = kHalfPi;
                else if (solidNorth)  yawVal = kHalfPi * 3.0f;

                Interactable::Kind kind;
                float zOff;
                vec3 color;
                std::uint8_t shape = 0;
                std::uint8_t matId = 4;
                std::uint8_t face = 1; // wall
                if (wsel >= 15 && wsel < 25) {
                    kind  = Interactable::Kind::ElectricalShield;
                    zOff  = 0.40f;
                    color = {0.18f, 0.20f, 0.22f};
                    shape = kShapeElectricalShield;
                    matId = 4;
                } else if (wsel >= 25 && wsel < 35) {
                    kind  = Interactable::Kind::Terminal;
                    zOff  = 0.0f;
                    color = {0.32f, 0.35f, 0.38f};
                    shape = kShapeTerminal;
                    matId = 3;
                } else {
                    continue; // radiator / empty -- no Interactable
                }

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell;
                const float wz = static_cast<float>(z) * kCell + zOff;

                // Anchor into the solid floor cell under the air cell (Z-1).
                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = wrap_macro_local(z - 1);
                anchor.subX = 4;
                anchor.subY = 4;
                anchor.subZ = 7; // top of floor cell
                anchor.face = face;

                const std::uint8_t anim = static_cast<std::uint8_t>(rngWall & 0xFFu);
                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor, kind,
                                      PropFallMode::SimpleFall, color, shape, layer,
                                      yawVal, /*emissive*/0, matId, anim, /*flags*/0);
                if (e != entt::null) ++count;

            }
        }
    }
    return count;
}""",
    "seed_wall_interactables Z-up",
)


# --- 3. prop_system.cpp: seed_ceiling_lights Z-up ---
must_replace(
    ROOT / "src/game/prop_system.cpp",
    """std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate light branch:
    //   solidAbove && (rngLight % 100 < lightChancePct)
    //   origin = {wx, wy + 1.55f, wz}
    // Anchor into the solid ceiling cell (Y+1) so spawn_prop solid() and
    // anchor_validate_step stay honest — lamp falls when ceiling is carved.
    for (int z = 0; z < kMacroDimLocal; ++z) {
        for (int y = 0; y < kMacroDimLocal; ++y) {
            for (int x = 0; x < kMacroDimLocal; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType above = grid.cell(x, y + 1, z);
                if (!is_solid_cell(above)) continue;

                const std::uint32_t rngLight = spatial_hash(x, y, z, seed ^ kSaltLight);
                if ((rngLight % 100u) >= kLightChancePct) continue;

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell + 1.55f;
                const float wz = static_cast<float>(z) * kCell;

                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = wrap_macro_local(y + 1);
                anchor.cz   = z;
                anchor.subX = 4;
                anchor.subY = 0; // bottom of ceiling cell
                anchor.subZ = 4;
                anchor.face = 2; // ceiling

                // BareBulb vs FloodLamp + yaw/emissive match PropPlacer light branch.
                const std::uint8_t shape =
                    (rngLight & 1u) ? kShapeBareBulb : kShapeFloodLamp;
                const float yaw = static_cast<float>(rngLight % 4u) * kHalfPi;
                const std::uint8_t anim =
                    static_cast<std::uint8_t>(rngLight & 0xFFu);

                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor,
                                      Interactable::Kind::LightBulb,
                                      PropFallMode::RagdollRoll,
                                      vec3{1.00f, 0.78f, 0.45f}, shape, layer,
                                      yaw, /*emissive*/250, /*matId*/0, anim,
                                      /*flags*/0);
                if (e != entt::null) ++count;
            }
        }
    }
    return count;
}""",
    """std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // Mirror PropPlacer::populate light branch (Z-up):
    //   solidAbove (z+1) && (rngLight % 100 < lightChancePct)
    //   origin = {wx, wy, wz + 1.55f}
    // Anchor into the solid ceiling cell (Z+1) so spawn_prop solid() and
    // anchor_validate_step stay honest -- lamp falls when ceiling is carved.
    for (int z = 0; z < kMacroDimLocal; ++z) {
        for (int y = 0; y < kMacroDimLocal; ++y) {
            for (int x = 0; x < kMacroDimLocal; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType above = grid.cell(x, y, z + 1);
                if (!is_solid_cell(above)) continue;

                const std::uint32_t rngLight = spatial_hash(x, y, z, seed ^ kSaltLight);
                if ((rngLight % 100u) >= kLightChancePct) continue;

                const float wx = static_cast<float>(x) * kCell;
                const float wy = static_cast<float>(y) * kCell;
                const float wz = static_cast<float>(z) * kCell + 1.55f;

                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = wrap_macro_local(z + 1);
                anchor.subX = 4;
                anchor.subY = 4;
                anchor.subZ = 0; // bottom of ceiling cell
                anchor.face = 2; // ceiling

                // BareBulb vs FloodLamp + yaw/emissive match PropPlacer light branch.
                const std::uint8_t shape =
                    (rngLight & 1u) ? kShapeBareBulb : kShapeFloodLamp;
                const float yaw = static_cast<float>(rngLight % 4u) * kHalfPi;
                const std::uint8_t anim =
                    static_cast<std::uint8_t>(rngLight & 0xFFu);

                Entity e = spawn_prop(reg, world, vec3{wx, wy, wz}, anchor,
                                      Interactable::Kind::LightBulb,
                                      PropFallMode::RagdollRoll,
                                      vec3{1.00f, 0.78f, 0.45f}, shape, layer,
                                      yaw, /*emissive*/250, /*matId*/0, anim,
                                      /*flags*/0);
                if (e != entt::null) ++count;
            }
        }
    }
    return count;
}""",
    "seed_ceiling_lights Z-up",
)


# --- 4. prop_placer.cpp: full Z-up neighbor + origin rewrite ---
placer = ROOT / "src/render/prop_placer.cpp"
pt = placer.read_text(encoding="utf-8")
old_neighbors = """                CellType below = grid.cell(x, y - 1, z);
                CellType above = grid.cell(x, y + 1, z);
                CellType west  = grid.cell(x - 1, y, z);
                CellType east  = grid.cell(x + 1, y, z);
                CellType north = grid.cell(x, y, z + 1);
                CellType south = grid.cell(x, y, z - 1);"""
new_neighbors = """                // Z-up world: below/above on Z; north/south on Y (horizontal).
                CellType below = grid.cell(x, y, z - 1);
                CellType above = grid.cell(x, y, z + 1);
                CellType west  = grid.cell(x - 1, y, z);
                CellType east  = grid.cell(x + 1, y, z);
                CellType north = grid.cell(x, y + 1, z);
                CellType south = grid.cell(x, y - 1, z);"""
if old_neighbors not in pt and old_neighbors.replace("\n", "\r\n") in pt:
    pt = pt.replace("\r\n", "\n")
if old_neighbors not in pt:
    raise SystemExit("FAIL prop_placer neighbors")
pt = pt.replace(old_neighbors, new_neighbors, 1)

# Origin offsets: vertical lifts were on Y; move them to Z.
replacements = [
    ("grate.origin    = {wx, wy + 0.01f, wz};", "grate.origin    = {wx, wy, wz + 0.01f};"),
    ("rad.origin    = {wx, wy + 0.05f, wz};", "rad.origin    = {wx, wy, wz + 0.05f};"),
    ("cam.origin    = {wx, wy + 1.50f, wz};", "cam.origin    = {wx, wy, wz + 1.50f};"),
    ("crystal.origin    = {wx, wy + 0.01f, wz};", "crystal.origin    = {wx, wy, wz + 0.01f};"),
    ("bench.origin    = {wx, wy + 0.01f, wz};", "bench.origin    = {wx, wy, wz + 0.01f};"),
    ("rail.origin    = {wx, wy + 0.01f, wz};", "rail.origin    = {wx, wy, wz + 0.01f};"),
    ("item.origin    = {wx, wy + 0.01f, wz};", "item.origin    = {wx, wy, wz + 0.01f};"),
]
for a, b in replacements:
    if a not in pt:
        raise SystemExit(f"FAIL prop_placer origin: {a}")
    pt = pt.replace(a, b, 1)
placer.write_text(pt, encoding="utf-8", newline="\n")
print("OK prop_placer Z-up")


# --- 5. padic_module.cpp: PlanStair lattice + honest ceiling anchors ---
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
        // Prefer anchoring into solid ceiling cell above the air volume.
        // Fall back to sandwich ceiling bits (sz=6) in the air cell itself
        // (stair entry strip / partial sandwich).
        SubVoxelAnchor anchor{};
        vec3 bulbPos{};
        const int ceilZ = airZ + 1;
        const int wcx = wrap_macro(cx);
        const int wcy = wrap_macro(cy);
        const int wAir = wrap_macro(airZ);
        const int wCeil = wrap_macro(ceilZ);

        if (grid.solid(wcx, wcy, wCeil, 4, 4, 0)) {
            // Full solid ceiling cell above — same contract as seed_ceiling_lights.
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
            // Stair entry strip: kEntryX04 sets sx in [0,5) at kCeilW=6.
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

                // Corridor mouth (opening south of shaft) + both flights.
                // Ceiling band is the storey sandwich cell b+2; air volume for
                // hanging lamps is the mid storey cell b+1 under that sandwich.
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
(ROOT / "src/game/floors/padic/padic_module.cpp").write_text(padic_new, encoding="utf-8", newline="\n")
print("OK padic_module")


# --- 6. suite_props_game.inl: Z-up paint helpers + assertions + padic test ---
tests = ROOT / "tests/suite_props_game.inl"
tt = tests.read_text(encoding="utf-8")
if "\r\n" in tt:
    tt = tt.replace("\r\n", "\n")

old_paint_floor = '''// seed_wall_interactables walks AIR cells with a SOLID cell below (floor) AND
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
}'''

new_paint_floor = '''// seed_wall_interactables walks AIR cells with a SOLID cell below on Z (floor)
// AND at least one solid W/E/N/S neighbor on the XY plane, then rolls
// spatial_hash for Terminal (wsel 25-34) / ElectricalShield (15-24). Paint a
// floor slab at zFloor and alternating wall columns at zFloor+1 so every other
// cell is air with solid west+east neighbors. No PropPass.
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
}'''

old_paint_ceil = '''// seed_ceiling_lights walks AIR cells with a SOLID cell above (ceiling) and
// rolls spatial_hash(kSaltLight) with lightChancePct=25. Paint a ceiling slab
// over an air band so ~25% of cells spawn LightBulb — no PropPass.
static void paint_ceiling_band(World& world, int x0, int x1, int yAir, int z0, int z1) {
    const int yCeil = yAir + 1;
    for (int z = z0; z < z1; ++z) {
        for (int x = x0; x < x1; ++x) {
            // Ensure the air cell stays air (default) and ceiling is solid.
            world.grid().fill_cell(x, yCeil, z, kMatConcrete);
        }
    }
}'''

new_paint_ceil = '''// seed_ceiling_lights walks AIR cells with a SOLID cell above on Z (ceiling)
// and rolls spatial_hash(kSaltLight) with lightChancePct=25. Paint a ceiling
// slab over an air band so ~25% of cells spawn LightBulb -- no PropPass.
static void paint_ceiling_band(World& world, int x0, int x1, int zAir, int y0, int y1) {
    const int zCeil = zAir + 1;
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            // Ensure the air cell stays air (default) and ceiling is solid.
            world.grid().fill_cell(x, y, zCeil, kMatConcrete);
        }
    }
}'''

for label, a, b in (
    ("paint_floor", old_paint_floor, new_paint_floor),
    ("paint_ceil", old_paint_ceil, new_paint_ceil),
):
    if a not in tt:
        raise SystemExit(f"FAIL tests {label}")
    tt = tt.replace(a, b, 1)

# Call sites still use positional args (x0,x1, vertical, horiz0, horiz1) —
# parameter names changed but call order is the same (vertical was y, now z;
# the last pair was z-range, now y-range). Values stay valid on the torus.

# Ceiling light height assertion: was p.y, must be p.z (Z-up origin wz+1.55).
old_assert = '''    for (const vec3& p : lampPos) {
        CHECK(std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z));
        // PropPlacer origin y = yAir*kCell + 1.55; yAir=8, kCell=2 → 16+1.55=17.55
        CHECK(p.y > 16.0f && p.y < 19.0f);
    }'''
new_assert = '''    for (const vec3& p : lampPos) {
        CHECK(std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z));
        // PropPlacer origin z = zAir*kCell + 1.55; zAir=8, kCell=2 -> 16+1.55=17.55
        CHECK(p.z > 16.0f && p.z < 19.0f);
    }'''
if old_assert not in tt:
    raise SystemExit("FAIL tests lamp assert")
tt = tt.replace(old_assert, new_assert, 1)

# Sandwich comments in collide test
tt = tt.replace(
    "    // Floor at y=5, air at y=6, ceiling at y=7. Wall columns on even x at y=6.\n"
    "    paint_floor_band(world, 2, 70, /*yFloor*/5, 2, 70);\n"
    "    // paint_floor_band already fills even-x wall columns at yAir=6; add ceiling.\n"
    "    paint_ceiling_band(world, 2, 70, /*yAir*/6, 2, 70);",
    "    // Floor at z=5, air at z=6, ceiling at z=7. Wall columns on even x at z=6.\n"
    "    paint_floor_band(world, 2, 70, /*zFloor*/5, 2, 70);\n"
    "    // paint_floor_band already fills even-x wall columns at zAir=6; add ceiling.\n"
    "    paint_ceiling_band(world, 2, 70, /*zAir*/6, 2, 70);",
    1,
)

# Room paint in collect_static / sim_owned tests: floor y=2 ceiling y=5 west wall
# was Y-up vertical. Convert to Z-up: floor z=2, ceiling z=5, air z=3..4, west wall.
old_room = '''    // Room: floor y=2, ceiling y=5, west wall at x=10 for wall devices.
    for (int z = 10; z < 18; ++z) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, 2, z, kMatConcrete);
            world.grid().fill_cell(x, 5, z, kMatConcrete);
        }
    }
    for (int z = 10; z < 18; ++z)
        for (int y = 3; y < 5; ++y)
            world.grid().fill_cell(10, y, z, kMatConcrete);'''
new_room = '''    // Room: floor z=2, ceiling z=5, west wall at x=10 for wall devices (Z-up).
    for (int y = 10; y < 18; ++y) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, y, 2, kMatConcrete);
            world.grid().fill_cell(x, y, 5, kMatConcrete);
        }
    }
    for (int y = 10; y < 18; ++y)
        for (int z = 3; z < 5; ++z)
            world.grid().fill_cell(10, y, z, kMatConcrete);'''
if tt.count(old_room) < 1:
    raise SystemExit("FAIL tests room paint missing")
tt = tt.replace(old_room, new_room)  # both collect_static and any single copy

old_room2 = '''    // Floor y=2, ceiling y=5, west wall x=10 so seed_wall can place devices.
    for (int z = 10; z < 18; ++z) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, 2, z, kMatConcrete);
            world.grid().fill_cell(x, 5, z, kMatConcrete);
        }
    }
    for (int z = 10; z < 18; ++z)
        for (int y = 3; y < 5; ++y)
            world.grid().fill_cell(10, y, z, kMatConcrete);'''
new_room2 = '''    // Floor z=2, ceiling z=5, west wall x=10 so seed_wall can place devices (Z-up).
    for (int y = 10; y < 18; ++y) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, y, 2, kMatConcrete);
            world.grid().fill_cell(x, y, 5, kMatConcrete);
        }
    }
    for (int y = 10; y < 18; ++y)
        for (int z = 3; z < 5; ++z)
            world.grid().fill_cell(10, y, z, kMatConcrete);'''
if old_room2 not in tt:
    raise SystemExit("FAIL tests room2 paint missing")
tt = tt.replace(old_room2, new_room2, 1)

# Strengthen padic test: generate real floor then seed lamps.
old_padic_test = '''static void test_padic_props_seed_tags_layer() {
    // seed_padic_props must tag Transform.layer so clear_layer_props can reclaim
    // the slot on the next arrival. No PropPass involved.
    Registry reg;
    World world;
    EventBus bus;
    // seed_padic_props walks its own stairwell lattice; empty grid → n may be 0.
    // If it spawns anything, every entity must carry Transform.layer == layer.
    const LayerId layer = 4;
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
}'''

# The file may have slightly different comment text - read actual block via markers.
start = tt.find("static void test_padic_props_seed_tags_layer()")
if start < 0:
    raise SystemExit("FAIL padic test not found")
end = tt.find("\n// --- [jirnyak.md] section 18: spawn / anchor validate", start)
if end < 0:
    end = tt.find("\nstatic void test_spawn_prop_anchor", start)
if end < 0:
    raise SystemExit("FAIL padic test end not found")

new_padic_test = '''static void test_padic_props_seed_tags_layer() {
    // [jirnyak.md] section 24 -- padic stair lamps must land on PlanStair
    // lattice after a real generate_padic_floor, with solid SubVoxelAnchor
    // support (no floating bulbs). Layer tags enable clear_layer_props.
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
    // 8 stairwells x 42 storeys x up to 3 lamps -- must get a real population.
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
        // Hang near a stair column: sx = bx+13 with bx in the 4x4 lattice.
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

tt = tt[:start] + new_padic_test + tt[end:]

# Need FloorSpec include if not present
if 'floor_spec.h' not in tt and 'FloorSpec' in tt:
    tt = tt.replace(
        '#include "game/floors/padic/padic.h"\n',
        '#include "game/floors/padic/padic.h"\n#include "game/floor_spec.h"\n',
        1,
    )

tests.write_text(tt, encoding="utf-8", newline="\n")
print("OK suite_props_game.inl")

# --- 7. suite_console.inl: assert DynamicBodyTag on spawn_ball ---
con_t = ROOT / "tests/suite_console.inl"
ct = con_t.read_text(encoding="utf-8")
if "\r\n" in ct:
    ct = ct.replace("\r\n", "\n")
old_c = '''    CHECK(ball != entt::null);
    CHECK(ecs.all_of<GravityAffected>(ball));
    // spawn_ball must NOT attach angular components (RagdollRoll props do).
    CHECK(!ecs.all_of<AngularVelocity>(ball));
    CHECK(!ecs.all_of<Rotation>(ball));'''
new_c = '''    CHECK(ball != entt::null);
    CHECK(ecs.all_of<GravityAffected>(ball));
    CHECK(ecs.all_of<DynamicBodyTag>(ball));
    // spawn_ball must NOT attach angular components (RagdollRoll props do).
    CHECK(!ecs.all_of<AngularVelocity>(ball));
    CHECK(!ecs.all_of<Rotation>(ball));'''
if old_c not in ct:
    if "all_of<DynamicBodyTag>(ball)" in ct:
        print("OK suite_console already has DynamicBodyTag check")
    else:
        raise SystemExit("FAIL suite_console pattern")
else:
    con_t.write_text(ct.replace(old_c, new_c, 1), encoding="utf-8", newline="\n")
    print("OK suite_console DynamicBodyTag check")

print("ALL PATCHES APPLIED")
'''
