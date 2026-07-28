// Faction relations — the global inter-faction attitude table ([macrosim.md] #10d).
//
// A tiny, universal DATA primitive: a kFactionCount × kFactionCount matrix of
// signed-byte attitudes that each faction holds toward every other. It is the
// BASELINE the macro social pass drifts per-NPC relationships toward, and the
// query combat / utility-AI use to answer "is this one an enemy?". The character
// of the society lives in a table, never in code branches — exactly the
// data-oriented stance of FloorSpec ([floors.md]) and MacroParams ([macrosim.md]).
//
// Ported verbatim from the reference's base seed matrix (`../gigahrush`,
// src/data/relations.ts), for the six factions this world recognises. NPCs in the macro pool currently carry
// faction 0..3 (the four civilian-ish factions the seeder samples, npc_pool.h /
// population.cpp); Wild and Player round out the matrix so combat and the player's
// own standing resolve through the same table.
#pragma once

#include <array>
#include <cstdint>

namespace giga::game {

// The factions this world recognises. Values 0..3 match what the seeder already
// assigns via FloorSpec::factionMix; Wild (hostile fauna / raiders) and Player
// (the embodied camera-wearer, npc_pool.h) extend the space. Stored in the pool's
// uint16 faction column, so a query tolerates an out-of-range value (returns
// neutral) rather than indexing past the matrix.
enum FactionId : std::uint8_t {
    FactionCitizen    = 0,  // ordinary residents — the bulk of the population
    FactionLiquidator = 1,  // authority / enforcers
    FactionCultist    = 2,  // zealots
    FactionScientist  = 3,  // researchers
    FactionWild       = 4,  // hostile fauna / feral raiders
    FactionPlayer     = 5,  // the record currently wearing the camera
};

inline constexpr int kFactionCount = 6;

// Attitude scale. Signed byte clamped to [-127, 127] — we avoid -128 so magnitude
// and negation stay well-defined; the reference clamps to [-128, 127], an
// immaterial one-unit-lower floor (both read as "maximally hostile"). The base
// matrix's own span is only -50..100. Two data-driven thresholds classify a cell
// without a branch elsewhere, ported from the reference's areFactionsHostile /
// FRIENDLY_RELATION_THRESHOLD: at or below hostile (-50) → enemies, at or above
// friendly (50) → allies, the band between is neutral/wary.
//
// NOTE these are the FACTION-matrix thresholds. The per-NPC social graph
// ([macrosim.md] #10d-ii, the pool's `rel_` block) is a SEPARATE store with its
// own wider ±64 thresholds — do not conflate the two.
inline constexpr std::int8_t kAttitudeMin       = -127;
inline constexpr std::int8_t kAttitudeMax       =  127;
inline constexpr std::int8_t kHostileThreshold  =  -50;
inline constexpr std::int8_t kFriendlyThreshold =   50;

// Row-major kFactionCount² attitude table. Default-constructed to the ported base
// matrix; mutable at runtime (events may nudge whole-faction standing, e.g. the
// player angering the Liquidators). A flat POD-ish value type — copyable, trivially
// serialisable as part of the society state ([macrosim.md] owns one).
class FactionMatrix {
public:
    // Fill with the ported base matrix (faction.cpp). Also re-callable to reset.
    FactionMatrix();
    void reset_to_base();

    // Attitude a→b. Out-of-range factions (>= kFactionCount, e.g. a stray pool
    // value) read as neutral 0 rather than indexing past the table.
    std::int8_t attitude(std::uint16_t a, std::uint16_t b) const {
        if (a >= kFactionCount || b >= kFactionCount) return 0;
        return m_[a * kFactionCount + b];
    }

    // Overwrite a single directed cell (used by the base-matrix builder and tests).
    void set(std::uint16_t a, std::uint16_t b, std::int8_t v) {
        if (a >= kFactionCount || b >= kFactionCount) return;
        m_[a * kFactionCount + b] = v;
    }

    // Shift a directed cell by delta, clamped to [kAttitudeMin, kAttitudeMax].
    // Integer math throughout so a large delta can't overflow the byte.
    void nudge(std::uint16_t a, std::uint16_t b, int delta) {
        if (a >= kFactionCount || b >= kFactionCount) return;
        int v = static_cast<int>(m_[a * kFactionCount + b]) + delta;
        if (v < kAttitudeMin) v = kAttitudeMin;
        if (v > kAttitudeMax) v = kAttitudeMax;
        m_[a * kFactionCount + b] = static_cast<std::int8_t>(v);
    }

    // Symmetric shift — the reference's addFactionRelMutual, its most common
    // mutation: an event that moves how a regards b moves b's view of a in step
    // (a Liquidator crackdown sours both directions at once).
    void nudge_mutual(std::uint16_t a, std::uint16_t b, int delta) {
        nudge(a, b, delta);
        nudge(b, a, delta);
    }

    bool hostile(std::uint16_t a, std::uint16_t b) const {
        return attitude(a, b) <= kHostileThreshold;
    }
    bool friendly(std::uint16_t a, std::uint16_t b) const {
        return attitude(a, b) >= kFriendlyThreshold;
    }

private:
    std::array<std::int8_t, kFactionCount * kFactionCount> m_{};
};

} // namespace giga::game
