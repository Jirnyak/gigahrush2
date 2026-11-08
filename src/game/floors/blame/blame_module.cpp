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

std::uint32_t blame_place(const FloorPlaceCtx& ctx) {
    // НОЛЬ ОБЪЯВЛЯЕТ МОДУЛЬ, и причина живёт здесь, а не в таблице диспатча
    // (тот же закон, что у `blame_doorways`): мегаструктура — это бездна и
    // лепленая масса, её единственная объявленная зона — гермолобби
    // (`blame_gen.cpp` room_declare с kRoomTagHermetic), и ни «спать», ни
    // «есть», ни «сортир» она не объявляет, то есть мебели здесь не место ни
    // одной строкой. Обвес, который модулю ПОЛОЖЕН по его же манифесту
    // (маячные лампы на консолях мостов, терминалы на балконах-кантилеверах),
    // ещё не нарисован — когда будет, он приедет ТЕЛОМ ЭТОЙ ФУНКЦИИ, и
    // таблица в floor_gen.cpp не шевельнётся.
    (void)ctx;
    return 0;
}

} // namespace giga::game
