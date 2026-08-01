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

namespace giga::game {

bool register_padic_floor(FloorCatalog& cat) {
    return cat.claim(kPadicFloorNumber, {"padic", FloorKind::Padic});
}

std::uint32_t seed_padic_props(Registry& reg, const World& world, int number, unsigned seed, EventBus& bus) {
    std::uint32_t count = 0;
    (void)seed;
    (void)number;
    (void)bus;

    // Storey base heights b = 0, 3, ..., 123
    for (int b = 0; b <= 123; b += 3) {
        // Stairwells at fixed locations across blocks
        for (int bj = 0; bj < 4; ++bj) {
            for (int bi = 0; bi < 4; ++bi) {
                if (((bi + bj) & 1) == 0) {
                    int bx = 16 + bi * 32 + 2;
                    int by = 16 + bj * 32 + 2;
                    int sx = bx + 13;
                    
                    // Corridor ceiling lightbulb:
                    vec3 bulbPos{static_cast<float>(sx * 2.0f + 1.0f), static_cast<float>((by - 1) * 2.0f + 1.0f), static_cast<float>((b + 2) * 2.0f + 1.75f)};
                    SubVoxelAnchor lightAnchor;
                    lightAnchor.cx = wrap_macro(sx);
                    lightAnchor.cy = wrap_macro(by - 1);
                    lightAnchor.cz = static_cast<int>(b + 2);
                    lightAnchor.subX = 4;
                    lightAnchor.subY = 4; 
                    lightAnchor.subZ = 6; // Ceiling is sz=6
                    
                    Entity lamp = spawn_prop(reg, world, bulbPos, lightAnchor, Interactable::Kind::LightBulb, PropFallMode::RagdollRoll, vec3{1.0f, 0.95f, 0.7f}, 12);
                    if (lamp != entt::null) {
                        ++count;
                    }
                }
            }
        }
    }
    return count;
}

} // namespace giga::game
