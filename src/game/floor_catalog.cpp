#include "game/floor_catalog.h"

#include "game/floors/padic/padic.h" // register_padic_floor — the folder claims its number

namespace giga::game {

bool FloorCatalog::claim(int number, const FloorDef& def) {
    const int slot = slot_of(number);
    if (slot < 0 || hasClaim_[slot]) {
        ++conflicts_;
        if (firstConflict_ == kNoConflict) firstConflict_ = number;
        return false;
    }
    claims_[slot] = def;
    hasClaim_[slot] = true;
    ++claimCount_;
    return true;
}

bool FloorCatalog::add_pattern(FloorPatternFn match, const FloorDef& def) {
    if (!match || patternCount_ >= kMaxPatterns) return false;
    patterns_[patternCount_] = match;
    patternDefs_[patternCount_] = def;
    ++patternCount_;
    return true;
}

const FloorDef* FloorCatalog::claimed(int number) const {
    const int slot = slot_of(number);
    return (slot >= 0 && hasClaim_[slot]) ? &claims_[slot] : nullptr;
}

const FloorDef& FloorCatalog::resolve(int number) const {
    if (const FloorDef* c = claimed(number)) return *c;
    for (int i = 0; i < patternCount_; ++i)
        if (patterns_[i](number)) return patternDefs_[i];
    static constexpr FloorDef kFallback{"residential", FloorKind::Residential};
    return kFallback;
}

// ---------------------------------------------------------------------------
// The default pattern chain — floor_spec_for's V-shape as DATA rows.
//
// Same predicates, same order, same kinds ([floor_spec.cpp]): symmetric about
// the hub, hub always safe, deep extremes trending wrecked, the modulo families
// in specificity order, Residential as the catch-all. floor_spec_for stays the
// pure function other systems key off; these rows keep the catalog's answer for
// an UNCLAIMED number identical to it — pinned by suite_floorcatalog.
// ---------------------------------------------------------------------------
namespace {

int mag(int n) { return n < 0 ? -n : n; }

bool pat_hub(int n) { return n == 0; }
bool pat_padic_extreme(int n) { return mag(n) >= 25; }
bool pat_derelict_deep(int n) { return mag(n) >= 20; }
bool pat_padic_mod(int n) { return mag(n) % 11 == 10; }
bool pat_derelict_mod(int n) { return mag(n) % 7 == 6; }
bool pat_industrial_mod(int n) { return mag(n) % 5 == 4; }
bool pat_commercial_mod(int n) { return mag(n) % 3 == 2; }
bool pat_all(int) { return true; }

} // namespace

bool build_default_floor_catalog(FloorCatalog& cat) {
    bool ok = true;

    // Patterns first — they are the defaults an explicit claim overrides.
    ok &= cat.add_pattern(pat_hub, {"hub", FloorKind::Residential});
    ok &= cat.add_pattern(pat_padic_extreme, {"padic-extreme", FloorKind::Padic});
    ok &= cat.add_pattern(pat_derelict_deep, {"derelict-deep", FloorKind::Derelict});
    ok &= cat.add_pattern(pat_padic_mod, {"padic", FloorKind::Padic});
    ok &= cat.add_pattern(pat_derelict_mod, {"derelict", FloorKind::Derelict});
    ok &= cat.add_pattern(pat_industrial_mod, {"industrial", FloorKind::Industrial});
    ok &= cat.add_pattern(pat_commercial_mod, {"commercial", FloorKind::Commercial});
    ok &= cat.add_pattern(pat_all, {"residential", FloorKind::Residential});

    // Explicit claims: each floor-module folder registers its own. Padic claims
    // number 4 — the pattern chain alone would make 4 Industrial (4 % 5 == 4),
    // so this is the live proof that a named claim beats the modulo default.
    ok &= register_padic_floor(cat);

    return ok;
}

} // namespace giga::game
