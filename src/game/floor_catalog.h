// Floor catalog — the data-driven index "any number -> a floor definition".
//
// [floors.md] separates three identities (number / ModuleId / LayerId); this is
// the layer ABOVE them: it answers "what floor IS number N" before any module is
// registered or loaded. Two kinds of rows, with a fixed precedence:
//
//   * an EXPLICIT CLAIM — "number 4 is the padic floor". At most one claim per
//     number: a second claim on the same number is REFUSED at registration and
//     recorded, so a duplicate is a red test, never a silent shadowing
//     ([tests/suite_floorcatalog.inl] pins this on the default catalog).
//   * a PATTERN — "every |n| >= 25 is padic", "every n % 5 == 4 is industrial".
//     Patterns are the DEFAULTS: first registered match wins among patterns, and
//     an explicit claim always beats every pattern. So a pattern can hand out a
//     whole residue class while one number of that class is overridden by name.
//
// resolve() therefore never fails and never branches on floor identity in code:
// pick ANY number in [-127, 127] and there is a floor there — which is what lets
// the stack be sparse, deep, and re-shuffled without hand-authoring 255 rows.
//
// A FloorDef row deliberately carries a NAME + KIND, not code: the kind selects
// the rule-set ([floor_spec.h]) and the generator family ([floor_gen.h] dispatch
// table), so a new floor module contributes rows here and a folder under
// src/game/floors/<name>/ ([floors.md] §Module folders) — never an engine `if`.
//
// Pure game-layer data: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include "game/floor_registry.h" // kMinFloor / kMaxFloor / kFloorSlots
#include "game/floor_spec.h"     // FloorKind

namespace giga::game {

// One floor definition: what a resolved number builds. POD row, static strings.
struct FloorDef {
    const char* name = "";                   // module label (HUD / console / debug)
    FloorKind kind = FloorKind::Residential; // rule-set + generator family
};

// A pattern predicate — plain function pointer (no captures: the build has no
// exceptions/RTTI and the catalog is static data, not a closure store).
using FloorPatternFn = bool (*)(int number);

class FloorCatalog {
public:
    static constexpr int kMaxClaims = kFloorSlots; // one per number, by invariant
    static constexpr int kMaxPatterns = 32;

    // Claim exactly `number` for `def`. Returns false — and records the conflict
    // — if the number is out of range or ALREADY claimed. Refusing rather than
    // overwriting is the whole point: the first registration wins, the duplicate
    // is loud, and conflicts() lets a test assert the catalog is collision-free.
    bool claim(int number, const FloorDef& def);

    // Register a default pattern ("every even", "every n % 5 == 4", ...).
    // Priority is registration order among patterns — register the specific
    // before the general, with a catch-all last. Returns false when full.
    bool add_pattern(FloorPatternFn match, const FloorDef& def);

    // The explicit claim on `number`, or nullptr if none. resolve() minus the
    // pattern fallback — for tests and for tools that show WHY a number is what
    // it is.
    const FloorDef* claimed(int number) const;

    // The definition of floor `number`: its claim if one exists, else the first
    // matching pattern, else a static Residential fallback. Total — any number
    // resolves to a real floor.
    const FloorDef& resolve(int number) const;

    // How many claim() calls were refused for a number already taken. A healthy
    // catalog has 0; the test suite pins that on the default game catalog.
    int conflicts() const { return conflicts_; }
    // The first refused number (kNoConflict when conflicts() == 0), so the red
    // test names the collision instead of just counting it.
    static constexpr int kNoConflict = 0x7fffffff;
    int first_conflict() const { return firstConflict_; }

    int claim_count() const { return claimCount_; }
    int pattern_count() const { return patternCount_; }

private:
    // Dense over the label range, like FloorRegistry: number -> claim slot.
    static int slot_of(int number) {
        return FloorRegistry::valid_number(number) ? number - kMinFloor : -1;
    }

    FloorDef claims_[kFloorSlots] = {};
    bool hasClaim_[kFloorSlots] = {};
    FloorDef patternDefs_[kMaxPatterns] = {};
    FloorPatternFn patterns_[kMaxPatterns] = {};
    int claimCount_ = 0;
    int patternCount_ = 0;
    int conflicts_ = 0;
    int firstConflict_ = kNoConflict;
};

// Build the game's default catalog into `cat`: the pattern chain that used to
// live as branches in floor_spec_for (hub safe, extremes wrecked, the modulo
// families), plus every floor-module folder's explicit claims
// (src/game/floors/*/ — currently the padic module claiming number 4). Returns
// false if any registration was refused — i.e. two modules claimed one number —
// which the test suite turns into a failure.
bool build_default_floor_catalog(FloorCatalog& cat);

// The global catalog singleton. Access via mutable_floor_catalog() during app startup
// to inject demo or mod floors, and via floor_catalog() everywhere else for read-only
// lookups (like floor_spec_for).
FloorCatalog& mutable_floor_catalog();
const FloorCatalog& floor_catalog();

} // namespace giga::game
