// BLAME module registration — the module's rows in the floor catalog.
//
// One claim today: floor number 5 ([blame.h]). As the module grows, its special
// loot, story NPCs, props (beacon lamps on the bridge consoles, terminals on
// the cantilever balconies) register from THIS file, so deleting the folder
// deletes the floor cleanly and nothing else has to know.
#include "game/floors/blame/blame.h"
#include "game/floor_catalog.h"

namespace giga::game {

bool register_blame_floor(FloorCatalog& cat) {
    return cat.claim(kBlameFloorNumber, {"blame", FloorKind::Blame});
}

} // namespace giga::game
