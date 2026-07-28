// A single world layer: one 128^3 macro grid, its fields, and its gravity.
//
// This is one "slice" of the level stack (one value of the 4th coordinate W).
// It owns simulation state that is local to the layer; entities live in the
// shared ECS registry and reference their layer by index.
#pragma once
#include "world/field.h"
#include "world/gravity.h"
#include "world/macro_grid.h"

namespace giga {

class World {
public:
    MacroGrid& grid() { return grid_; }
    const MacroGrid& grid() const { return grid_; }

    FieldRegistry& fields() { return fields_; }
    const FieldRegistry& fields() const { return fields_; }

    GravityField& gravity() { return gravity_; }
    const GravityField& gravity() const { return gravity_; }

private:
    MacroGrid grid_;
    FieldRegistry fields_;
    GravityField gravity_;
};

} // namespace giga
