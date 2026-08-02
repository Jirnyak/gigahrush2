// Deterministic hashing + RNG — a universal, dependency-free primitive shared by
// the whole engine (worldgen, population seeding, the macro tick, the AI
// stagger). Header-only and `constexpr`, so it lives in `src/core` alongside
// math.h / wrap.h with no translation unit of its own.
//
// The load-bearing idea is STATELESS hashing: `hash*(...)` turns a tuple of
// integer keys — typically (entity id, tick, salt) — into a well-avalanched
// pseudo-random word with NO per-entity RNG state to store or advance. That is
// what lets the macro tick (macrosim.md) and the utility-AI stagger (npcs.md) be
// (a) O(1) per record, (b) independent of iteration order, and (c) perfectly
// deterministic for a given (seed, tick) — the engine's determinism stance
// (ARCHITECTURE.md §Determinism). No <random>, no globals.
#pragma once

#include <cstdint>

namespace giga {

// splitmix32 finalizer — the same mix used by the seeders, promoted to a shared
// home. Good avalanche: flipping one input bit flips ~half the output bits, so
// nearby keys (id, id+1) produce uncorrelated streams.
constexpr std::uint32_t hash_u32(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// 3D coordinate spatial hash (stateless, identical avalanche properties to
// splitmix32 but pre-mixed with primes for fast coordinate processing).
// Used by both gpu procedural generation and ecs prop placement.
constexpr std::uint32_t spatial_hash(int x, int y, int z, std::uint32_t seed) {
    std::uint32_t h = static_cast<std::uint32_t>(x) * 73856093u ^
                      static_cast<std::uint32_t>(y) * 19349663u ^
                      static_cast<std::uint32_t>(z) * 83492791u ^ seed;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    h = (h ^ (h >> 16)) * 0x45d9f3bu;
    return h ^ (h >> 16);
}

// splitmix64 finalizer — for 64-bit mixing / combining wide keys.
constexpr std::uint64_t hash_u64(std::uint64_t x) {
    x ^= x >> 30;
    x *= 0xbf58476d1ce4e5b9ull;
    x ^= x >> 27;
    x *= 0x94d049bb133111ebull;
    x ^= x >> 31;
    return x;
}

// Combine two/three 32-bit keys into one hash. Order-sensitive and
// well-mixed, so hash2(id, tick) and hash2(tick, id) differ, and consecutive
// ids at a fixed tick spread across the whole range.
constexpr std::uint32_t hash2(std::uint32_t a, std::uint32_t b) {
    return hash_u32(a ^ (hash_u32(b) * 0x9e3779b9u + 0x85ebca6bu));
}
constexpr std::uint32_t hash3(std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    return hash2(hash2(a, b), c);
}

// Uniform float in [0, 1) from a hash word (top 24 bits -> exact 2^-24 spacing).
constexpr float rand01(std::uint32_t h) {
    return static_cast<float>(h >> 8) * (1.0f / 16777216.0f);
}

// Uniform integer in [0, n) from a hash word (0 when n == 0). Modulo bias is
// negligible for the small n these callers use (factions, directions, budgets).
constexpr std::uint32_t rand_below(std::uint32_t h, std::uint32_t n) {
    return n ? (h % n) : 0u;
}

} // namespace giga
