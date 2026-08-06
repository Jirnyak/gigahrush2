// The 4th coordinate: a stack of world layers indexed by W.
//
// Where (x, y, z) locate a voxel inside one 128^3 world, W selects *which*
// world. Layers are stacked in an ordered list; an entity transitions between
// adjacent layers (W -> W±1) through a "lift". This is the seam for nested
// worlds, dimensions, parallel floors, or scale changes (a macro world whose
// cells each open into their own sub-world at W+1).
//
// This skeleton owns the layers and the transition request queue. Streaming
// (async load/unload of distant layers) is intentionally left as a later seam:
// layers here are all resident.
#pragma once
#include <cstdint>
#include <memory>
#include <vector>

#include "world/world.h"

namespace giga {

using LayerId = std::uint32_t;
inline constexpr LayerId kInvalidLayer = 0xFFFFFFFFu;

class LevelStack {
public:
    // Create a fresh empty layer, returning its W index.
    LayerId push_layer() {
        layers_.push_back(std::make_unique<World>());
        return static_cast<LayerId>(layers_.size() - 1);
    }

    std::size_t size() const { return layers_.size(); }
    bool valid(LayerId w) const { return w < layers_.size(); }

    World& layer(LayerId w) { return *layers_[w]; }
    const World& layer(LayerId w) const { return *layers_[w]; }

    // Adjacent-layer navigation. Returns kInvalidLayer at the ends of the
    // stack (the stack does not wrap in W — only x/y/z are toroidal).
    //
    // The `w < size()` half is load-bearing and is NOT redundant with the test
    // beside it. `LayerId` is a uint32 and `kInvalidLayer` is 0xFFFFFFFF, so
    // `above(kInvalidLayer)` computed `0xFFFFFFFF + 1 == 0`, and `0 < size()` is
    // true for any non-empty stack — the one input guaranteed to be out of range
    // returned LAYER 0. The idiom this exists for, `w = stack.above(w)` in a
    // loop, therefore wrapped W from the top of the stack straight back to the
    // bottom: the single axis the torus law forbids from wrapping. `below()` was
    // always guarded (`w > 0`); this is its missing twin. [problems.md] section 30
    LayerId above(LayerId w) const {
        return (w < layers_.size() && w + 1 < layers_.size()) ? w + 1
                                                             : kInvalidLayer;
    }
    LayerId below(LayerId w) const {
        return (w > 0 && w < layers_.size()) ? w - 1 : kInvalidLayer;
    }

private:
    std::vector<std::unique_ptr<World>> layers_;
};

} // namespace giga
