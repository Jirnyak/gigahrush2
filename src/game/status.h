// Timed player status effects — the six the reference authors, as a table.
//
// WHAT THIS REPLACES. [combat.h] carries `Slowed`, and its own comment is a careful
// argument for a CAP rather than a multiplier: `controller_step` rewrites the player's
// velocity every tick, `wander_step` writes a crowd body's only on its stagger slot,
// so a repeated multiply would give a resident 0.45^8 = 0.0017 of its speed within one
// period — a freeze, not a slow. That reasoning is correct and is NOT undone here.
// `Slowed` is the enforcement mechanism; this is the CONTENT layer that decides what
// lands and for how long. Five of the six statuses below had authored numbers in the
// reference and nowhere to live.
//
// The reference spreads them across two files, which is why they read as missing:
// zhelemish/paupsina/spore_haze constants are in `systems/status.ts:20-50`, and the
// three govnyak durations are in `systems/govnyak.ts:30-32` (70 / 210 / 480 s).
//
// FIXED POINT, stated because it cannot be guessed: every multiplier is x1000. 0.54
// is 540, 1.65 is 1650, "no change" is 1000. Integer throughout, because this tree
// pins bit-exact digests and a float multiplier chain is not guaranteed identical
// between MSVC and Clang ([AGENTS.md]).
//
// THE ALT COLUMN. Three statuses have a second value selected by a runtime condition,
// not by being a different status: zhelemish is 180 s raw / 150 s treated, spore_haze
// is 4.8 s bare / 2.2 s through an IP-4 (and x1.65 / x1.18 aim spread), paupsina moves
// at x0.54 walking and x0.22 while still rooted. One row with an alternate, because
// the player holds ONE zhelemish status whichever way he ate it.
#pragma once

#include <array>
#include <cstdint>
#include <type_traits>

#include "game/item_table.h"

namespace giga::game {

struct RpgStats;

inline constexpr std::size_t kStatusCount = 6;

// Row order is data/status.csv row order, and it is load-bearing: a StatusId is an
// index into the generated table, so INSERTING or REORDERING a row redefines every
// stored id. Same hazard [save.h] documents for ItemId, same rule — append only.
enum class StatusId : std::uint8_t {
    ZhelemishSkin = 0,
    PaupsinaWeb,
    SporeHaze,
    GovnyakRelief,
    GovnyakCough,
    GovnyakDebt,
};

// POD, 24 bytes. Fixed-point throughout; see the header note for the x1000 scale.
struct StatusDef {
    std::uint32_t durationMs;     //  0  primary duration
    std::uint32_t altDurationMs;  //  4  duration under the alternate condition
    std::uint16_t moveMultE3;     //  8  horizontal speed multiplier x1000
    std::uint16_t altMoveMultE3;  // 10  ... while rooted (paupsina)
    std::uint16_t aimMultE3;      // 12  aim SPREAD multiplier x1000; >1000 is worse
    std::uint16_t altAimMultE3;   // 14  ... with the gate item worn
    std::uint16_t rootMs;         // 16  leading window with no movement at all
    std::uint16_t meleeMultE3;    // 18  outgoing melee damage multiplier x1000
    std::uint16_t healMultE3;     // 20  healing received multiplier x1000
    std::uint16_t waterDrainE3;   // 22  extra water drain per second x1000
    // 1-based ItemId whose PRESENCE selects the alternate column, or 0 for none.
    // Resolved at generation time against data/items.csv, so a typo is a build
    // failure rather than a status that is silently never protected.
    ItemId gateItem;             // 24
    std::uint8_t stacks;         // 26  1 = intensity accumulates (the govnyak three)
    // `= 0` is load-bearing twice over, and this row had neither. The generator
    // emits twelve initialisers for thirteen fields, so without a default this is
    // (a) six -Wmissing-field-initializers in a tree that must build with none, and
    // (b) an INDETERMINATE byte inside a table that determinism tests digest —
    // two builds of identical sources could disagree. The same default every other
    // generated row already carries ([prop_table.h] pad0_, [mob_table.h] before its
    // pads were reclaimed by massG).
    std::uint8_t pad_ = 0;       // 27
};
static_assert(sizeof(StatusDef) == 28, "StatusDef must stay a tight row");
static_assert(std::is_trivially_copyable_v<StatusDef>);

// Generated from data/status.csv by tools/gen_status_table.py.
extern const std::array<StatusDef, kStatusCount> kStatusTable;
extern const std::array<const char*, kStatusCount> kStatusNames;

inline bool status_valid(StatusId id) {
    return static_cast<std::size_t>(id) < kStatusCount;
}

inline const StatusDef& status_def(StatusId id) {
    return kStatusTable[static_cast<std::size_t>(id)];
}

inline const char* status_name(StatusId id) {
    return status_valid(id) ? kStatusNames[static_cast<std::size_t>(id)] : "";
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------
// Fixed-size, so the tick allocates nothing. Six statuses exist and a player can hold
// all six at once, so the array is exactly kStatusCount and a slot is addressed by its
// own StatusId — no search, no compaction, no ordering question.
//
// An expired slot keeps `remainMs == 0` rather than being cleared, for the reason
// [combat.h] gives for leaving an expired `Slowed` attached: removing a component
// mid-view can reallocate registry storage.
struct StatusSet {
    std::uint32_t remainMs[kStatusCount] = {};
    // Accumulated intensity for the stacking statuses, x1000. The reference caps this
    // (`GOVNYAK_STATUS_INTENSITY_CAP`); non-stacking rows leave it at 1000.
    std::uint16_t intensityE3[kStatusCount] = {};
    // Which slots resolved to their ALT column when they landed. Latched at landing,
    // not re-read per tick: taking the gasmask off mid-effect must not retroactively
    // lengthen a haze that was already shortened by wearing it.
    std::uint8_t alt[kStatusCount] = {};
};

// The reference's cap on accumulated intensity (govnyak.ts). x1000.
inline constexpr std::uint16_t kStatusIntensityCapE3 = 3000;

// Land `id`. `useAlt` selects the alternate duration/multiplier column — the caller
// resolves the condition (item worn, food treated) because this module must not reach
// into an inventory. Refreshes rather than replaces: an already-held status keeps the
// LONGER remaining time, so re-entering a spore cloud cannot shorten your haze.
// Accepts optional `rpg` to factor in mutations (e.g. GillsOfGigahrush spore immunity),
// traits (ChemResistant halved duration), and implants (CardioFilterPump).
void status_apply(StatusSet& set, StatusId id, bool useAlt, const RpgStats* rpg = nullptr);

// Advance every slot by `dtMs`. Returns how many statuses expired on this call.
std::uint32_t status_step(StatusSet& set, std::uint32_t dtMs);

bool status_active(const StatusSet& set, StatusId id);

// ---------------------------------------------------------------------------
// Queries — the whole reason the effects are data
// ---------------------------------------------------------------------------
// Each folds every ACTIVE status into one multiplier, x1000, so a caller applies one
// number and never enumerates statuses itself. Multiplicative composition, because two
// independent slows must both bite: 0.82 zhelemish x 0.54 paupsina = 0.44, not 0.82.
std::uint16_t status_move_mult_e3(const StatusSet& set);
std::uint16_t status_aim_mult_e3(const StatusSet& set);
std::uint16_t status_melee_mult_e3(const StatusSet& set);
std::uint16_t status_heal_mult_e3(const StatusSet& set, const RpgStats* rpg = nullptr);

// Extra water drain per second, x1000, summed. A drain is a RATE and rates add.
std::uint32_t status_water_drain_e3(const StatusSet& set, const RpgStats* rpg = nullptr);

// True while any status is inside its leading root window. Paupsina's 0.65 s.
bool status_is_rooted(const StatusSet& set);

} // namespace giga::game
