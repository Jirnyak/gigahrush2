#include "game/vendor.h"

namespace giga::game {

VendorKind vendor_kind_for(Faction who) {
    switch (who) {
        case Faction::Scientists: return VendorKind::Scientist;
        case Faction::Wild:       return VendorKind::Wild;
        case Faction::Citizens:
        case Faction::Liquidators:
        case Faction::Cultists:
        default:                  return VendorKind::Citizen;
    }
}

} // namespace giga::game
