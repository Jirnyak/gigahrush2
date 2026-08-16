#include "game/floor_registry.h"

namespace giga::game {

FloorRegistry::FloorRegistry() {
    for (int i = 0; i < kFloorSlots; ++i) numberToModule_[i] = kInvalidModule;
    for (int m = 0; m < kMaxModules; ++m) {
        moduleToNumber_[m] = kNoFloor;
        moduleToLayer_[m] = kInvalidLayer;
    }
}

void FloorRegistry::assign(int number, ModuleId module) {
    int slot = slot_of(number);
    if (slot < 0 || !valid_module(module)) return;

    // Detach whatever module currently holds this number.
    ModuleId prevModule = numberToModule_[slot];
    if (valid_module(prevModule)) moduleToNumber_[prevModule] = kNoFloor;

    // Detach this module from any previous number (one number per module).
    int prevNumber = moduleToNumber_[module];
    int prevSlot = slot_of(prevNumber);
    if (prevSlot >= 0) numberToModule_[prevSlot] = kInvalidModule;

    numberToModule_[slot] = module;
    moduleToNumber_[module] = number;
}

void FloorRegistry::clear_number(int number) {
    int slot = slot_of(number);
    if (slot < 0) return;
    ModuleId m = numberToModule_[slot];
    if (valid_module(m)) moduleToNumber_[m] = kNoFloor;
    numberToModule_[slot] = kInvalidModule;
}

ModuleId FloorRegistry::module_at(int number) const {
    int slot = slot_of(number);
    return slot < 0 ? kInvalidModule : numberToModule_[slot];
}

int FloorRegistry::number_of(ModuleId module) const {
    return valid_module(module) ? moduleToNumber_[module] : kNoFloor;
}

void FloorRegistry::set_resident(ModuleId module, LayerId layer) {
    if (!valid_module(module)) return;
    moduleToLayer_[module] = layer;
}

void FloorRegistry::evict(ModuleId module) {
    if (!valid_module(module)) return;
    moduleToLayer_[module] = kInvalidLayer;
}

LayerId FloorRegistry::layer_of(ModuleId module) const {
    return valid_module(module) ? moduleToLayer_[module] : kInvalidLayer;
}

LayerId FloorRegistry::layer_at(int number) const {
    ModuleId m = module_at(number);
    if (m == kInvalidModule) return kInvalidLayer;
    return layer_of(m);
}

int next_labelled_floor(const FloorRegistry& reg, int from, int dir) {
    if (dir == 0) return from;
    const int sdir = dir > 0 ? 1 : -1;
    int best = from;
    int bestGap = 0;
    // Linear over the labelled floors. The stack is tens of entries, this runs on a
    // keypress, and a sorted index would have to be kept correct across every
    // renumbering the registry exists to allow.
    for (int f = kMinFloor; f <= kMaxFloor; ++f) {
        if (reg.module_at(f) == kInvalidModule) continue;
        const int gap = (f - from) * sdir;
        if (gap <= 0) continue;                      // wrong side, or `from` itself
        if (bestGap == 0 || gap < bestGap) { bestGap = gap; best = f; }
    }
    return best;
}

} // namespace giga::game
