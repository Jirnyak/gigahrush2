// KHRUSHI module registration — the module's rows in the floor catalog.
//
// One claim today: floor number 6 ([khrushi.h]). As the module grows, its
// street lamps, stairwell bulbs and apartment dressing register from THIS
// file, so deleting the folder deletes the floor cleanly and nothing else has
// to know.
#include "game/floors/khrushi/khrushi.h"
#include "game/floor_catalog.h"

namespace giga::game {

bool register_khrushi_floor(FloorCatalog& cat) {
    return cat.claim(kKhrushiFloorNumber, {"khrushi", FloorKind::Khrushi});
}

} // namespace giga::game
