// Memoization of a floor's baked navigation — the bake stops costing ~3.7 s per entry.
//
// A floor's geometry is a pure function of (number, kind, seed) ([game/floor_gen.h]) and
// there is no runtime voxel mutation in the tree ([game/save.h] relies on the same
// fact), so its baked nav is a pure function of those three numbers too. Measured on a
// 20-thread machine ([world/nav_async.h]) the bake is coarse ~1.9 s + fine ~1.8 s, all
// of it recomputing something a previous session already computed. A floor should need
// baking ONCE EVER, not once per entry.
//
// WHAT THIS BUYS, per section, because they are wildly asymmetric and the caller should
// get to pick:
//
//   * COARSE: 13,056 bytes replaces ~1.9 s. Four orders of magnitude of time for a
//     rounding error of disk. There is no argument against caching this one, and it is
//     small enough to hold for every floor in the stack at once.
//   * FINE (flow): 134,217,728 bytes (128 MiB exactly) replaces ~1.8 s. Worth it only
//     if the medium reads faster than 128 MiB / 1.8 s = 74.6 MB/s, which any SSD clears
//     by a factor of 7 or more — but it is 10,280x the bytes for 0.95x the time saved,
//     and a ten-floor stack is 1.27 GiB on disk. [performance.md] calls disk "effectively
//     unlimited" and load time "unbounded", so both are in contract; the point is that
//     the caller states which trade it is making instead of inheriting one.
//   * NEAREST: 2,097,152 bytes (2 MiB) — the geodesic-Voronoi anchor map baked by the
//     same `bake_fine` pass. Travels WITH the flow field and never alone, because
//     `nav::route_step` composes the two and either one on its own routes nobody.
//
// THE MEMORY BOUND IS THE SECTION MASK, and there is nothing else here that bounds
// anything. A caller that only wants reachability answers reads `kNavSectionCoarse`
// alone and pays 13,108 bytes instead of 136,327,988 — a factor of 10,400 — and
// `nav_cache_bytes` lets it reject a file by length before it reads a byte. There is no
// eviction of any kind: nothing here enumerates, ages out, or size-caps a cache
// directory, so a long-lived stack grows on disk without limit. That is a real gap, not
// a design choice; it is called out rather than implied so nobody reads the section mask
// as a disk-space policy.
//
// TWO LAYERS, and the lower one does NO FILE I/O. `nav_cache_write` / `nav_cache_read`
// move bytes only — main's rule, not this file's preference ([game/save.h]: "`giga_game`
// links `giga_core` and nothing platform-shaped ([AGENTS.md]), so this file takes and
// returns a byte buffer and the `fopen` lives in `src/app`"). That is what makes the
// whole format testable headless: [tests/suite_navcache.inl] never touches a disk. On
// top of it sit `save_nav_cache` / `load_nav_cache`, the two path-taking wrappers
// `FloorStreamer::ensure_loaded` already calls; they are the only things in here that
// open a file, and they stream the two large sections straight to and from the caller's
// vectors rather than materializing a second 130 MiB copy of them.
//
// EVERY HEADER FIELD IS LITTLE-ENDIAN AND WRITTEN BYTE AT A TIME, never as a memcpy of
// the struct — the reason is quoted verbatim in [game/save.cpp]: "a struct copy would
// put this compiler's padding and this host's byte order into the file, and then a save
// written by one of the two builds would be unreadable by the other for reasons nothing
// in the format could diagnose." This repository is built on both Windows/MSVC and
// macOS/Clang, so that is a live concern and not a theoretical one. The two large
// sections are already byte arrays, so they go through in bulk: there is no byte order
// to impose on a `std::uint8_t`, and 134 M bounds-checked push_backs for an identity
// transform would be absurd.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "game/floor_spec.h" // giga::game::FloorKind
#include "world/nav.h"       // giga::nav::CoarseGraph, FineNav, kNodes
#include "world/types.h"     // giga::kMacroCells, kMacroDim

namespace giga::game {

// On-disk bytes spell "GH2N", so the four leading bytes of a cache file are readable in
// a hex dump on any host — the same convention kSaveMagic (0x53324847, "GH2S") uses.
// Written low byte first, so 0x4E = 'N' is the LAST byte on the wire, not the first.
inline constexpr std::uint32_t kNavCacheMagic = 0x4E324847u;

// Bump on ANY change to the wire layout OR to the bake algorithm. The second half is
// the one that bites: a blob whose layout is unchanged but whose flow bytes were
// produced by a different BFS is undetectable from the payload, and it would steer
// agents by a graph that does not match the geometry. `bake_fine` and `bake_coarse`
// changing without this constant changing is the silent failure this format exists to
// prevent.
//
// Version 2 is the first version that carries `FineNav::nearest`. Version 1 predates
// that field and also predates this whole wire format (it was a memcpy of the structs
// behind an eight-byte "GHNAVBK1" magic); a v1 file is rejected on the magic check
// before the version is even consulted, which is the correct outcome — the caller
// re-bakes and overwrites it.
inline constexpr std::uint32_t kNavCacheVersion = 2u;

// Which sections a blob carries. A bitmask rather than three bools because it is what
// goes on the wire, and because "coarse only" is a first-class mode rather than a
// degenerate case.
inline constexpr std::uint32_t kNavSectionCoarse = 1u << 0;
inline constexpr std::uint32_t kNavSectionFine = 1u << 1;
inline constexpr std::uint32_t kNavSectionNearest = 1u << 2;
// The two halves of one `bake_fine` product. `nav::route_step` needs BOTH — the anchor
// map picks which of the 64 flow fields to descend — so they are written and read as a
// pair and a blob carrying one without the other is malformed, not merely partial.
inline constexpr std::uint32_t kNavSectionFineAll =
    kNavSectionFine | kNavSectionNearest;
inline constexpr std::uint32_t kNavSectionAll =
    kNavSectionCoarse | kNavSectionFineAll;

// Wire sizes. All exact at kNodes = 64 and kMacroDim = 128, all asserted against the
// live structs in nav_cache.cpp so a change to CoarseGraph or FineNav cannot silently
// reshape the format.
inline constexpr std::size_t kNavCacheHeaderWire = 52; // 11 x u32/i32 + 1 x u64
inline constexpr std::size_t kNavCoarseWire =
    static_cast<std::size_t>(nav::kNodes) * 6 * 2 +           //   768 B  edge[64][6]  u16
    static_cast<std::size_t>(nav::kNodes) * nav::kNodes * 2 + //  8192 B  dist[64][64] u16
    static_cast<std::size_t>(nav::kNodes) * nav::kNodes;      //  4096 B  next[64][64] u8
inline constexpr std::size_t kNavFineWire =
    static_cast<std::size_t>(nav::kNodes) * kMacroCells; // 134,217,728 B = 128 MiB
inline constexpr std::size_t kNavNearestWire = kMacroCells; // 2,097,152 B = 2 MiB

// The three numbers a floor's geometry — and therefore its nav — is a pure function of.
// Grouped into a struct because they travel together through every call here and because
// getting their ORDER wrong at a call site with three scalar parameters is a bug that
// compiles.
struct NavCacheKey {
    // Signed, because floors descend: main.cpp's demo stack is
    // {0, 1, 2, -8, -14, -26, -36, -50, 14, 30} and FloorRegistry's legal range is
    // -127..+127. [tests/suite_npcpool.inl] documents the same field being std::uint16_t
    // once and storing floor -50 as 65486.
    int number = 0;
    FloorKind kind = FloorKind::Residential;
    std::uint32_t seed = 0;
};

// Why a read was refused. Reported rather than folded into `false`, for [game/save.h]'s
// reason: "a test that only asserts `!ok` cannot tell a version rejection from an
// accidental parse failure", and a cold-start miss ("no such file") wants different log
// words from a rejected stale blob.
enum class NavCacheError : std::uint8_t {
    None = 0,
    TooShort,       // buffer ends before the format does
    BadMagic,       // not a gigahrush2 nav cache at all
    BadVersion,     // a different kNavCacheVersion wrote it
    KeyMismatch,    // a different (number, kind, seed) — the wrong floor
    ShapeMismatch,  // this build's kNodes / kMacroDim / CoarseGraph differ
    SizeMismatch,   // a declared section length disagrees with the build's constant
    MissingSection, // the caller asked for a section the blob does not carry
    BadChecksum,    // the coarse section is corrupt
    NoFile,         // the path does not exist / could not be opened (a cold-start miss)
    Count
};
const char* nav_cache_error_text(NavCacheError e);

// The cache filename (BASENAME only — this layer knows nothing about directories, which
// is the point of the no-file-I/O rule above). The caller joins it onto whatever
// directory it chose. Stable and collision-free over the key: e.g. floor -3, kind 2,
// seed 0x162e -> "nav_f-3_k2_s0000162e.bin".
std::string nav_cache_name(const NavCacheKey& key);
// Same thing from three loose scalars, kept because `FloorStreamer::ensure_loaded` and
// game_test.cpp both call it that way and a rename there is another lane's edit.
std::string nav_cache_name(int number, FloorKind kind, std::uint32_t seed);

// Exact blob size for a section set, so an app can size a buffer or reject a file by
// length before reading a byte of it. 0 for an empty section set.
std::size_t nav_cache_bytes(std::uint32_t sections);

// Encode a baked nav into `out` (cleared first). Pass nullptr for a section to omit it,
// so writing just the 13 KB coarse graph is `nav_cache_write(key, &coarse, nullptr, buf)`.
// A non-null `fine` writes BOTH fine sections (flow + nearest): they are one bake
// product and `route_step` cannot use either alone. Both null produces a valid
// header-only blob carrying no sections, which is useless but not malformed — the caller
// decides that is a mistake, not this function.
//
// `fine->flow` MUST be exactly kNavFineWire bytes and `fine->nearest` exactly
// kNavNearestWire when `fine` is non-null. An AsyncBake that has not finished holds an
// EMPTY flow vector by design ([world/nav_async.h] `ready()` is `!flow.empty()`), so
// handing this a mid-bake AsyncBake would otherwise write a truncated blob that the
// reader rejects one session later. It is refused here instead: `out` is left empty and
// the caller can tell by out.empty().
void nav_cache_write(const NavCacheKey& key, const nav::CoarseGraph* coarse,
                     const nav::FineNav* fine, std::vector<std::uint8_t>& out);

// Decode. Writes only the sections the caller asked for (non-null) AND the blob carries;
// asking for a missing one fails with MissingSection and leaves both outputs untouched,
// so a partial trust is not expressible. `fine->flow` is resized to kNavFineWire and
// `fine->nearest` to kNavNearestWire.
//
// Nothing is written to either output until every header check has passed, which is what
// makes a rejected read a no-op rather than a half-applied one. A caller that wants only
// reachability passes `fine = nullptr` and then this touches 13 KB of a 130 MiB blob and
// allocates nothing — that is the memory bound described at the top of this header.
bool nav_cache_read(const std::uint8_t* bytes, std::size_t n, const NavCacheKey& key,
                    nav::CoarseGraph* coarse, nav::FineNav* fine,
                    NavCacheError* err = nullptr);

// --- The two path-taking wrappers: the only file I/O in this file ------------------
//
// `FloorStreamer::ensure_loaded` calls these, so their signatures are a contract with
// another lane's file and are deliberately unchanged from the pre-merge version. They
// are thin: the whole format lives above, and these add exactly a `std::fopen`, the
// parent-directory creation, and the chunking that keeps a 130 MiB nav from being
// duplicated in RAM on its way to or from disk.
//
// Both are `-fno-exceptions`-clean: C stdio plus the `std::error_code` overload of
// `std::filesystem::create_directories`, which is specified not to throw.

// Write a full (coarse + fine + nearest) cache to `path`, creating parent directories.
// Returns false on any I/O failure and leaves no truncated file behind — a failed write
// just means the next load re-bakes. Refuses a `fine` that is not fully baked, for the
// reason `nav_cache_write` gives.
bool save_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, const nav::CoarseGraph& coarse,
                    const nav::FineNav& fine);

// Read a full cache from `path` into `coarse`/`fine`. Returns false — leaving BOTH
// outputs untouched — when the file is missing, truncated, corrupt, or its header does
// not match (number, kind, seed) or this build's shape: i.e. any case where the caller
// must bake instead. `err` (optional) says which, so a cold-start miss (`NoFile`) can be
// logged differently from a rejected stale blob.
bool load_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, nav::CoarseGraph& coarse, nav::FineNav& fine,
                    NavCacheError* err = nullptr);

// -- WHAT THE INTEGRITY CHECK DOES AND DOES NOT COVER, stated rather than implied ------
//
// The coarse section carries a CRC-32. The two fine sections do NOT, and that is a
// measured decision, not an omission. [game/save.cpp] computes CRC-32 bit-serially and
// justifies it on "a ~3.6 KB save"; the same loop over 136,314,880 bytes is 1,090,519,040
// shift iterations, plausibly 0.3-1.0 s — a third to a half of the 1.8 s of baking that
// the cache exists to avoid. The failure modes it would add cover are already covered: a
// stale or foreign blob is caught by the key and shape checks, and truncation (a crash
// mid-write) is caught by the exact length checks. What is left uncovered is silent bit
// rot in the flow bytes, whose blast radius is one agent taking one wrong step out of
// 136 M bytes, against a cache that is regenerable from three numbers at any time. If
// that trade ever stops being acceptable, the fix is a table-driven CRC in a shared core
// header, not a bit-serial one here.
} // namespace giga::game
