// Optional on-disk memoization of a floor's baked navigation (C.2b).
//
// A floor's geometry is a pure deterministic function of (number, kind, seed)
// (floor_gen.h), so its baked nav is too. Baking all 64 flow fields is a load-
// time cost we can pay once and reuse across sessions: this serializes a baked
// CoarseGraph + FineNav to one file and reads it back, validating a header so a
// stale, foreign, or mismatched cache is safely rejected (the caller re-bakes).
//
// Pure game-layer std I/O (C stdio + std::filesystem error_code overloads, no
// exceptions): giga_game stays headless and dependency-light. Caching is OPT-IN
// — FloorStreamer only touches disk when handed a cache directory; with none it
// bakes on every load exactly as before, so nothing here is on any hot path.
#pragma once

#include <cstdint>
#include <string>

#include "game/floor_spec.h" // giga::game::FloorKind
#include "world/nav.h"       // giga::nav::CoarseGraph, FineNav

namespace giga::game {

// The cache filename (basename only) for a floor's geometry key — a stable,
// collision-free encoding of (number, kind, seed). Callers join it onto their
// chosen cache directory.
std::string nav_cache_name(int number, FloorKind kind, std::uint32_t seed);

// Write a baked nav to `path` (creating parent directories). Returns false on any
// I/O failure and leaves no truncated file behind. Best-effort: a failed write
// just means the next load re-bakes.
bool save_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, const nav::CoarseGraph& coarse,
                    const nav::FineNav& fine);

// Read a baked nav from `path` into `coarse`/`fine`. Returns false — leaving the
// outputs unspecified — when the file is missing, truncated, or its header does
// not match (number, kind, seed) or the current struct/grid sizes, i.e. any case
// where the caller must bake instead. Never partially trusts a bad file.
bool load_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, nav::CoarseGraph& coarse,
                    nav::FineNav& fine);

} // namespace giga::game
