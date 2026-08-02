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

std::uint32_t seed_padic_props(Registry& reg, const World& world, LayerId layer,
                               int number, unsigned seed, EventBus& bus) {
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
                    // empty for now, formerly held lightbulbs
                }
            }
        }
    }
    return count;
}

} // namespace giga::game
