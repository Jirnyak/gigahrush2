// PADIC module registration — the module's rows in the floor catalog.
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
#include "world/anchor.h"
#include "world/surface.h"
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

        // ASK THE CEILING WHERE ITS UNDER-FACE IS — теперь одним ЗАПРОСОМ
        // ПОВЕРХНОСТЕЙ ([world/surface.h], S10): ручной lowest_layer_centre +
        // добор точного бита и специальный тест известного скульпт-бита
        // (2,4,6) умерли — примитив находит экспонированную колонку и в
        // потолочной клетке, и в лепке внутри «воздушной». История дефекта,
        // который тут лечили руками, — в шапке seed_ceiling_lights.
        const SurfaceFace sfc =
            surface_face_at(grid, wcx, wcy, wCeil, anchor_face_pack(2, -1));
        const SurfaceFace sfa =
            sfc.columns > 0
                ? sfc
                : surface_face_at(grid, wcx, wcy, wAir, anchor_face_pack(2, -1));
        if (sfa.columns > 0) {
            const bool inCeil = sfc.columns > 0;
            const int faceCz = inCeil ? ceilZ : airZ;
            anchor.cx = wcx;
            anchor.cy = wcy;
            anchor.cz = static_cast<std::uint8_t>(inCeil ? wCeil : wAir);
            anchor.subX = sfa.su;
            anchor.subY = sfa.sv;
            anchor.subZ = sfa.layer;
            anchor.face = anchor_face_pack(2, -1); // нижняя грань опоры
            // Corded bulb: 0.45 m of flex below the face it hangs from —
            // грань считается от НАЙДЕННОГО слоя найденной клетки, лампы
            // полного потолка (layer 0 в ceilZ) не сдвинулись ни на мм.
            const float faceM =
                static_cast<float>(faceCz) * kCellSize +
                static_cast<float>(sfa.layer) * (kCellSize / 8.0f);
            bulbPos = vec3{static_cast<float>(cx) * kCellSize + 1.0f,
                           static_cast<float>(cy) * kCellSize + 1.0f,
                           faceM - 0.45f};
        } else {
            return false; // no honest solid support — do not float a lamp
        }

        // Skin/fall/color/emissive from data/props.csv (PropId::PadicStairBulb).
        Entity lamp = spawn_prop_from_id(reg, world, bulbPos, anchor,
                                         PropId::PadicStairBulb, layer,
                                         /*yaw*/0.0f);
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
