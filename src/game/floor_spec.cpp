#include "game/floor_spec.h"

#include <algorithm> // std::min/std::max
#include <cmath>     // std::exp/std::pow/std::round/std::lround/std::abs
#include <cstddef>

namespace giga::game {

namespace {

// The floor catalog — one row per FloorKind, in enum order. This table IS the
// design: tune a floor's character by editing numbers here, not by branching in
// the seeder. Populations give a clear dense->sparse gradient; hostility runs
// the opposite way (safe residential -> deadly derelict).
//
// factionMix is FIVE wide, in Faction enum order:
//   Citizens, Liquidators, Cultists, Scientists, Wild
//
// The mixes are fiction, not filler. Citizens dominate the residential hub;
// Liquidators cluster where the building is maintained; Cultists live *among* the
// citizens rather than apart from them (the reference has them cold-neutral to
// citizens, not hostile); Scientists belong to the civil bloc; Wild are hostile to
// everyone and gather where nobody keeps order.
//
//   kind         name           pop  factionMix       hostility  age window
constexpr FloorSpec kCatalog[] = {
    {FloorKind::Residential, "Residential", 420, {7, 1, 1, 0, 1}, 0.05f, 1, 90},
    {FloorKind::Commercial,  "Commercial",  260, {3, 2, 1, 2, 2}, 0.20f, 14, 80},
    {FloorKind::Industrial,  "Industrial",  150, {2, 4, 0, 2, 1}, 0.35f, 18, 65},
    {FloorKind::Derelict,    "Derelict",     40, {1, 0, 4, 0, 3}, 0.90f, 16, 70},
    {FloorKind::Padic,       "Padic",        10, {0, 0, 1, 0, 9}, 1.00f, 20, 80},
};
static_assert(sizeof(kCatalog) / sizeof(kCatalog[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "floor catalog must have exactly one row per FloorKind");

// population_profiles.ts monsterShareForRouteZ, via
// baseMonsterPopulationAtDefaultSoftLimit — a stretched-exponential (Weibull-CDF)
// share of the 4096 soft-limit that ramps from ~0.024 at the hub to ~0.955 at the
// extremes. Computed in double to sidestep float/double overload ambiguity; the
// caller rescales by kMobSoftCap. Kept at the reference's 4096 internally so the
// curve (and its min-100 floor) is bit-faithful to the source.
double monster_share(double depth01) {
    const double eased = 1.0 - std::exp(-3.1 * std::pow(depth01, 2.35));
    const double base = std::max(100.0, std::round(100.0 + (4096.0 - 100.0) * eased));
    double s = base / 4096.0;
    return s < 0.0 ? 0.0 : (s > 0.96 ? 0.96 : s);
}

} // namespace

const FloorSpec& floor_spec(FloorKind kind) {
    std::size_t i = static_cast<std::size_t>(kind);
    if (i >= static_cast<std::size_t>(FloorKind::Count)) i = 0;
    return kCatalog[i];
}

const FloorSpec& floor_spec_for(int floor) {
    // Symmetric about the hub (|floor|), so a floor and its mirror share a
    // character; the hub is always safe and the deep extremes trend derelict —
    // the KIND half of the V-shape. Pure function of the number, reproducible.
    const int a = floor < 0 ? -floor : floor;
    FloorKind kind;
    if (a == 0)            kind = FloorKind::Residential; // hub: always safe
    else if (a >= 25)      kind = FloorKind::Padic;       // 4d spectrum extreme
    else if (a >= 20)      kind = FloorKind::Derelict;    // deep extremes: wrecked
    else if (a % 11 == 10) kind = FloorKind::Padic;
    else if (a % 7 == 6)   kind = FloorKind::Derelict;
    else if (a % 5 == 4)   kind = FloorKind::Industrial;
    else if (a % 3 == 2)   kind = FloorKind::Commercial;
    else                   kind = FloorKind::Residential;
    return floor_spec(kind);
}

float floor_depth01(int floor) {
    const float a = std::abs(static_cast<float>(floor)) / 25.0f;
    return a < 0.0f ? 0.0f : (a > 1.0f ? 1.0f : a);
}

int floor_danger(int floor) {
    // Danger 1..5 as the confirmed DESIGN V-shape (master_prompt §4): safe at the
    // hub, rising with depth, and DEEPER-IS-DEADLIER going DOWN. Anchored to the
    // reference's hand-authored design danger (hub 1, roof 2, void 5;
    // design_floors.ts). We deliberately do NOT use the reference's PROCEDURAL
    // routeDangerScore: it is up-biased (rates the roof hotter than the void) and
    // the reference itself overrides it on exactly the narrative floors, so it
    // contradicts this V — the design danger is the faithful port of how the game
    // actually plays. (Depth still drives count+tier symmetrically; danger is the
    // asymmetric nudge — the roof/void "weak vs elite" split is future kind-bias.)
    const float depth = floor_depth01(floor);
    const float dirWeight = floor < 0 ? 4.0f : 1.0f; // descending far deadlier
    const long d = std::lround(1.0f + dirWeight * depth);
    return d < 1 ? 1 : (d > 5 ? 5 : static_cast<int>(d));
}

int floor_mob_count(int floor, const FloorSpec& spec) {
    const double share = monster_share(floor_depth01(floor));
    const int danger = floor_danger(floor);
    const double dangerTerm = 1.0 + 0.06 * static_cast<double>(danger - 1);
    // The floor's own character enters as a multiplier so two floors at the same
    // depth still differ (safe Residential vs. deadly Derelict) — this is what
    // finally makes FloorSpec::hostility load-bearing now that mobs land.
    const double kindMult = 0.7 + static_cast<double>(spec.hostility);
    long c = std::lround(static_cast<double>(kMobSoftCap) * share * dangerTerm *
                         kindMult);
    if (c < 0) c = 0;
    if (c > kMobSoftCap) c = kMobSoftCap;
    return static_cast<int>(c);
}

int floor_mob_tier(int floor) {
    const float depth = floor_depth01(floor);
    const int danger = floor_danger(floor);
    long lvl = std::lround(1.0f + depth * 8.0f + 0.55f * static_cast<float>(danger - 1));
    if (lvl < 1) lvl = 1;
    if (lvl > 12) lvl = 12;
    // Design floors floor the level at the danger rating (max(danger, baseLevel)).
    return static_cast<int>(lvl) < danger ? danger : static_cast<int>(lvl);
}

} // namespace giga::game
