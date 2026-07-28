// Floor registry — the number <-> module <-> layer indirection from floors.md.
//
// Three deliberately-decoupled identifiers (floors.md, "storage slot != floor
// number"):
//   * floor number — the in-game label the macro-system assigns to a module.
//                    MUTABLE: reassignable/reshufflable at runtime.
//   * ModuleId     — the stable identity of a loaded module (its content: the
//                    generator, rule-set, geometry). Fixed for the module's life.
//   * LayerId      — the raw LevelStack storage slot where that module's World is
//                    currently resident (or kInvalidLayer when not loaded).
//
// An elevator targets a *number*; travel resolves
//     number -> ModuleId -> LayerId (resident World)
// through here. Because every hop is data, floors can be renumbered or reshuffled
// mid-game without touching module content, and a module can stream in/out of the
// stack without changing its number. Everything downstream resolves through the
// number-indirection, never against a raw LayerId.
//
// Pure game-layer data: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstdint>

#include "world/level_stack.h" // giga::LayerId, giga::kInvalidLayer

namespace giga::game {

// Stable identity of a loaded module. A small dense handle: the id indexes the
// residency tables directly, so a lookup masks/indexes without a divide.
using ModuleId = std::uint16_t;
inline constexpr ModuleId kInvalidModule = 0xFFFFu;

// Floor numbers are signed in-game labels, sparsely populated over this range
// (floors.md): game starts at 0, descends negative, rises positive; W does not
// wrap, so the stack has a genuine top and bottom.
inline constexpr int kMinFloor = -127;
inline constexpr int kMaxFloor = 127;
inline constexpr int kFloorSlots = kMaxFloor - kMinFloor + 1; // 255

// Upper bound on distinct modules tracked at once. Floors are sparse over 255
// labels, so this covers every floor being its own module plus headroom for
// unnumbered / preloaded modules. ModuleId ids live in [0, kMaxModules).
inline constexpr int kMaxModules = 256;

// Maps in-game floor numbers to modules, and modules to the LevelStack slot that
// currently holds their World. Both mappings are mutable at runtime: a module can
// be renumbered (assign / clear_number) and can be loaded or evicted
// (set_resident / evict) independently of its number.
//
// Invariants (maintained by assign):
//   * number -> module is a partial bijection: at most one module per number and
//     at most one number per module.
//   * module -> layer is partial: a module is resident (has a LayerId) or not,
//     orthogonal to whether it currently carries a floor number.
class FloorRegistry {
public:
    // Sentinel returned by number_of() when a module carries no floor number.
    static constexpr int kNoFloor = 0x7fffffff;

    FloorRegistry();

    // --- number <-> module (the reassignable label) --------------------------

    // Make `module` the content of floor `number`. Detaches any previous module
    // on that number and any previous number on that module, so the bijection
    // holds. No-op if `number` is out of range or `module` is invalid.
    void assign(int number, ModuleId module);

    // Floor `number` maps to nothing (its module, if any, keeps its residency but
    // loses this label). No-op if unassigned / out of range.
    void clear_number(int number);

    // The module currently labelled `number`, or kInvalidModule.
    ModuleId module_at(int number) const;

    // The number currently labelling `module`, or kNoFloor if none / out of range.
    int number_of(ModuleId module) const;

    // --- module <-> layer (residency in the LevelStack) ----------------------

    // Record that `module`'s World is resident in LevelStack slot `layer`.
    void set_resident(ModuleId module, LayerId layer);

    // `module` is no longer resident (its World was torn down / streamed out).
    void evict(ModuleId module);

    // The resident layer backing `module`, or kInvalidLayer if not resident.
    LayerId layer_of(ModuleId module) const;

    bool resident(ModuleId module) const {
        return layer_of(module) != kInvalidLayer;
    }

    // --- the full chain: number -> module -> layer ---------------------------

    // The resident layer currently backing floor `number`, or kInvalidLayer if
    // the number is unassigned or its module is not resident. This is what an
    // elevator resolves a destination number to.
    LayerId layer_at(int number) const;

    // True when floor `number` is both assigned and resident in the stack.
    bool loaded(int number) const { return layer_at(number) != kInvalidLayer; }

    // --- helpers -------------------------------------------------------------

    static bool valid_number(int number) {
        return number >= kMinFloor && number <= kMaxFloor;
    }
    static bool valid_module(ModuleId m) {
        return m != kInvalidModule && static_cast<int>(m) < kMaxModules;
    }

private:
    // number -> dense array index in [0, kFloorSlots), or -1 if out of range.
    static int slot_of(int number) {
        return valid_number(number) ? number - kMinFloor : -1;
    }

    ModuleId numberToModule_[kFloorSlots]; // floor label -> module
    int moduleToNumber_[kMaxModules];      // module -> floor label (kNoFloor if none)
    LayerId moduleToLayer_[kMaxModules];   // module -> resident slot (kInvalidLayer)
};

// Nearest labelled floor strictly beyond `from` in direction `dir` (+1 up, -1
// down), or `from` itself when there is none.
//
// Floor numbers are MUTABLE LABELS, not indices — that is the whole point of this
// registry ([floors.md]: LayerId is not the floor number). So a stack may legitimately
// be sparse: {0, 1, 2, -8, -26, -50, 14, 30} is a perfectly valid building, and
// `from + dir` lands on nothing for almost all of it. Anything that steps between
// floors must ask this rather than assume adjacency.
int next_labelled_floor(const FloorRegistry& reg, int from, int dir);

} // namespace giga::game
