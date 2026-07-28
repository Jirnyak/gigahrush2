#include "world/macro_grid.h"

namespace giga {

MacroGrid::MacroGrid()
    : types_(kMacroCells, kCellAir), masks_(kMacroCells) {}

void MacroGrid::fill_cell(int x, int y, int z, CellType t) {
    int wx = wrap_macro(x), wy = wrap_macro(y), wz = wrap_macro(z);
    std::size_t i = macro_index(wx, wy, wz);
    types_[i] = t;
    masks_[i].set_all();
}

void MacroGrid::clear_cell(int x, int y, int z) {
    int wx = wrap_macro(x), wy = wrap_macro(y), wz = wrap_macro(z);
    std::size_t i = macro_index(wx, wy, wz);
    types_[i] = kCellAir;
    masks_[i].clear_all();
}

} // namespace giga
