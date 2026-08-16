#include "world/macro_grid.h"

namespace giga {

MacroGrid::MacroGrid()
    : types_(kMacroCells, kCellAir), masks_(kMacroCells) {}

void MacroGrid::fill_cell(int x, int y, int z, CellType t) {
    const auto c = clamp_macro(x, y, z);
    std::size_t i = macro_index(c.x, c.y, c.z);
    types_[i] = t;
    masks_[i].set_all();
}

void MacroGrid::clear_cell(int x, int y, int z) {
    const auto c = clamp_macro(x, y, z);
    std::size_t i = macro_index(c.x, c.y, c.z);
    types_[i] = kCellAir;
    masks_[i].clear_all();
}

} // namespace giga
