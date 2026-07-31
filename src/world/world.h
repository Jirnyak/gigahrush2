// A single world layer: one 128^3 macro grid, its fields, and its gravity.
//
// This is one "slice" of the level stack (one value of the 4th coordinate W).
// It owns simulation state that is local to the layer; entities live in the
// shared ECS registry and reference their layer by index.
#pragma once
#include "world/field.h"
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/subfield.h"

namespace giga {

class World {
public:
    MacroGrid& grid() { return grid_; }
    const MacroGrid& grid() const { return grid_; }

    FieldRegistry& fields() { return fields_; }
    const FieldRegistry& fields() const { return fields_; }

    // Sparse sub-voxel-resolution fields ([subfield.h]): same registry idea as
    // fields(), one atom finer. The canonical resident is "sub_material"
    // ([destruct.h]), created lazily by whatever first paints a mixed cell.
    SubFieldRegistry& subfields() { return subfields_; }
    const SubFieldRegistry& subfields() const { return subfields_; }

    GravityField& gravity() { return gravity_; }
    const GravityField& gravity() const { return gravity_; }

private:
    MacroGrid grid_;
    FieldRegistry fields_;
    SubFieldRegistry subfields_;
    GravityField gravity_;
};

} // namespace giga
