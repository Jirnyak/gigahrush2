// KHRUSHI module registration — the module's rows in the floor catalog, and
// the dressing the module lays out itself: street lamps on the pole hooks,
// подъезд bulbs on every stairwell landing, a bulb over every entrance.
//
// Everything anchors through the surface primitive ([world/surface.h]): the
// lamp asks the hook / ceiling / wall where its exposed face actually is, and
// refuses to spawn rather than float (S2 — carve the support, the lamp falls).
#include "game/floors/khrushi/khrushi.h"

#include "core/wrap.h"
#include "game/floor_catalog.h"
#include "game/prop_system.h"
#include "world/anchor.h"
#include "world/surface.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

bool register_khrushi_floor(FloorCatalog& cat) {
    return cat.claim(kKhrushiFloorNumber, {"khrushi", FloorKind::Khrushi});
}

namespace {

// Storey rise in sub-voxels — re-derived, not copied: 2.5 m ceiling + 0.5 m
// slab at 0.25 m sub-voxels (same derivation as khrushi_gen.cpp kStoreyRise).
constexpr int kRise = 12;
constexpr int kFlats = 10;

// Hang a prop from the under-face of the solid found in cell (cx,cy,cz):
// surface query, honest anchor, `drop` metres of flex below the face.
Entity hang_from_ceiling(Registry& reg, const World& world, LayerId layer,
                         int cx, int cy, int cz, PropId id, float drop) {
    const MacroGrid& grid = world.grid();
    const int wx = wrap_macro(cx), wy = wrap_macro(cy), wz = wrap_macro(cz);
    const SurfaceFace sfc =
        surface_face_at(grid, wx, wy, wz, anchor_face_pack(2, -1));
    if (sfc.columns == 0) return entt::null; // no honest support — no lamp
    SubVoxelAnchor anchor{};
    anchor.cx = static_cast<std::uint8_t>(wx);
    anchor.cy = static_cast<std::uint8_t>(wy);
    anchor.cz = static_cast<std::uint8_t>(wz);
    anchor.subX = sfc.su;
    anchor.subY = sfc.sv;
    anchor.subZ = sfc.layer;
    anchor.face = anchor_face_pack(2, -1);
    const float faceM = static_cast<float>(cz) * kCellSize +
                        static_cast<float>(sfc.layer) * (kCellSize / 8.0f);
    const vec3 pos{
        static_cast<float>(cx) * kCellSize +
            (static_cast<float>(sfc.su) + 0.5f) * (kCellSize / 8.0f),
        static_cast<float>(cy) * kCellSize +
            (static_cast<float>(sfc.sv) + 0.5f) * (kCellSize / 8.0f),
        faceM - drop};
    return spawn_prop_from_id(reg, world, pos, anchor, id, layer, /*yaw*/ 0.0f);
}

} // namespace

std::uint32_t seed_khrushi_props(Registry& reg, const World& world,
                                 LayerId layer, int number, unsigned seed,
                                 EventBus& bus) {
    (void)bus;
    std::uint32_t count = 0;
    const MacroGrid& grid = world.grid();

    // Street lamps: one under every pole hook. The hook is the pole's top
    // sub-layer, so its cell derives from kKhrushiPoleTopH — one source.
    std::vector<KhrushiPole> poles;
    khrushi_poles(seed, number, poles);
    const int hookZ = kKhrushiGroundCoord + ((kKhrushiPoleTopH - 1) >> 3);
    for (const KhrushiPole& p : poles)
        if (hang_from_ceiling(reg, world, layer, p.x + p.dx, p.y + p.dy, hookZ,
                              PropId::StreetLamp, 0.2f) != entt::null)
            ++count;

    // Подъезды: a bulb on every stairwell landing (the entrance facade cell
    // IS the landing column), hung from each storey's slab, and one over the
    // entrance opening outside, anchored into the facade panel.
    std::vector<KhrushiEntrance> doors;
    khrushi_entrances(seed, number, doors);
    for (const KhrushiEntrance& e : doors) {
        for (int s = 0; s < kFlats; ++s) {
            const int ceilH = s * kRise + kRise - 2; // this storey's slab
            const int cz = kKhrushiGroundCoord + (ceilH >> 3);
            if (hang_from_ceiling(reg, world, layer, e.x, e.y, cz,
                                  PropId::BareBulb, 0.45f) != entt::null)
                ++count;
        }
        // Over-entrance bulb: anchored into the facade wall band one cell up.
        const int axis = e.dx != 0 ? 0 : 1;
        const int dir = e.dx + e.dy;
        const int wallZ = kKhrushiGroundCoord + 1;
        const std::uint8_t face =
            anchor_face_pack(axis, dir);
        const int wx = wrap_macro(e.x), wy = wrap_macro(e.y);
        const SurfaceFace sf = surface_face_at(grid, wx, wy, wallZ, face);
        if (sf.columns == 0) continue;
        SubVoxelAnchor anchor{};
        anchor.cx = static_cast<std::uint8_t>(wx);
        anchor.cy = static_cast<std::uint8_t>(wy);
        anchor.cz = static_cast<std::uint8_t>(wallZ);
        anchor.subX = axis == 0 ? sf.layer : sf.su;
        anchor.subY = axis == 0 ? sf.su : sf.layer;
        anchor.subZ = sf.sv;
        anchor.face = face;
        // 0.3 m off the wall face, just above the opening lintel (2.4 m).
        const vec3 pos{
            (static_cast<float>(e.x) + 0.5f) * kCellSize +
                static_cast<float>(e.dx) * (kCellSize * 0.5f + 0.3f),
            (static_cast<float>(e.y) + 0.5f) * kCellSize +
                static_cast<float>(e.dy) * (kCellSize * 0.5f + 0.3f),
            static_cast<float>(kKhrushiGroundCoord) * kCellSize + 2.4f};
        if (spawn_prop_from_id(reg, world, pos, anchor, PropId::BareBulb, layer,
                               0.0f) != entt::null)
            ++count;
    }
    return count;
}

} // namespace giga::game
