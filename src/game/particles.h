// The game → render seam of the UNIFIED PARTICLE POOL (owner's design,
// 2026-08-03): blood, dust, sparks and drips are rows of data/particles.csv,
// and every writer expresses itself as a BURST — "this kind, this many, from
// here, roughly that way". Nothing in game/ ever touches the GPU: the app
// drains this queue each sim tick, resolves material tints, jitters the
// velocities deterministically from `seed`, and feeds the pool
// (render/verlet_pass.h, банк частиц). Same one-dispose-path law as CarveProposalQueue
// ([combat.h]) — many proposers, one drain.
//
// Bounded POD ring, no heap: a shotgun fan plus a carve in the same tick must
// not allocate on the hot path, and overflow drops the newest burst (cosmetics
// may drop; damage never does).
#pragma once

#include <cstdint>
#include <type_traits>

#include "core/math.h"
#include "game/particle_table.h"

namespace giga::game {

inline constexpr std::size_t kMaxParticleBursts = 256;

struct ParticleBurst {
    vec3 pos{};                 // world metres (toroidal)
    vec3 dir{};                 // burst direction, need not be normalised
    std::uint8_t kind = 0;      // ParticleKind ordinal (CSV row — the ABI)
    std::uint8_t count = 0;     // particles to emit
    std::uint16_t matId = 0;    // tint source for colorFromMaterial rows
    std::uint32_t seed = 0;     // deterministic jitter stream
};
static_assert(std::is_trivially_copyable_v<ParticleBurst>,
              "ParticleBurst must stay a pure POD struct");

struct ParticleBurstQueue {
    ParticleBurst items[kMaxParticleBursts] = {};
    std::uint16_t count = 0;

    void clear() { count = 0; }

    bool push(const vec3& pos, const vec3& dir, ParticleKind kind,
              std::uint8_t n, std::uint16_t matId, std::uint32_t seed) {
        if (count >= kMaxParticleBursts) return false;
        if (n == 0) return false;
        if (static_cast<std::uint8_t>(kind) >= kParticleKindCount) return false;
        ParticleBurst& b = items[count++];
        b.pos = pos;
        b.dir = dir;
        b.kind = static_cast<std::uint8_t>(kind);
        b.count = n;
        b.matId = matId;
        b.seed = seed;
        return true;
    }
};
static_assert(std::is_trivially_copyable_v<ParticleBurstQueue>,
              "ParticleBurstQueue must stay a pure POD struct");

} // namespace giga::game
