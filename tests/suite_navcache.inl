// nav_cache — the on-the-wire format, and the four things a cache is allowed to claim.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga` / `using namespace giga::game`. Everything except the single
// entry point `test_navcache_all()` lives in `namespace navcache_test`.
//
// THIS SUITE NEVER TOUCHES A DISK, which is the whole point of nav_cache.h's two-layer
// split: `nav_cache_write` / `nav_cache_read` move bytes only, and the `fopen` lives in
// the two path-taking wrappers above them. game_test.cpp's pre-existing
// `test_nav_cache_roundtrip` / `test_streamed_nav_cache` already cover those wrappers and
// the FloorStreamer wiring (including the doctored-sentinel proof that the read path is
// real), so this file deliberately does NOT repeat them. It tests the layer underneath,
// where every rejection can be forged by poking a byte instead of by crafting a file.
//
// FOUR CLAIMS, and they are testing different things:
//
//   * `baked_round_trip_routes_identically()` — a cache HIT must answer route queries
//     exactly as the cold bake does. A memcmp of 136 MB proves the bytes survived; it
//     does not prove they still route. So this walks `nav::route_step` to termination
//     over a set of node pairs on BOTH navs and compares the full step traces byte for
//     byte. That is the difference between "the blob round-tripped" and "the cache is
//     usable".
//   * `invalidation_rejects()` — every way a blob can be stale must be REFUSED, with the
//     right error code, and with the caller's outputs untouched. Forged in place by
//     poking one header field at a time and restoring it, so the 136 MB blob is never
//     copied. A test that only asserts `!ok` cannot tell a version rejection from a
//     parse accident ([game/save.h]), so each case pins its `NavCacheError`.
//   * `the_memory_bound_is_the_section_mask()` — the only thing in nav_cache that bounds
//     memory is which sections a caller asks for. It also pins the LIMIT of that bound,
//     which the header oversells: you cannot pull the 13 KB coarse section out of a
//     136 MB blob unless all 136 MB are present, because the length check precedes the
//     section check.
//   * `nothing_bounds_the_cache_directory()` — there is no eviction of any kind. Rather
//     than pretend to test an eviction policy that does not exist, this measures the
//     consequence: N floors mean N distinct filenames and N x 136 MB, forever. The
//     header states this as a known gap; this turns the statement into a number.
//
// WORK COUNTS, NEVER WALL-CLOCK. Every assertion here counts hits, refusals-by-code,
// route_step calls and bytes. Nothing times anything: the bake this suite depends on is
// seconds long and machine-dependent, and a timing assertion would be a flake generator.
// The measured figures are PRINTED at the end so a run reports what it actually did.
//
// On memcmp of a CoarseGraph: normally comparing two structs byte-wise is a test that can
// fail for a reason that is not a bug (padding is uninitialized). It is safe here and only
// here because nav_cache.cpp carries `static_assert(sizeof(nav::CoarseGraph) ==
// kNavCoarseWire)` — three tightly packed arrays summing to 13056, so the type provably
// has no padding at all.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "game/floor_gen.h"  // generate_floor
#include "game/floor_spec.h" // FloorKind, floor_spec
#include "game/nav_cache.h"
#include "world/lattice.h" // lattice_unpack, lattice_coord
#include "world/nav.h"     // CoarseGraph, FineNav, bake_coarse, bake_fine, route_step
#include "world/types.h"   // wrap_macro, kMacroDim
#include "world/world.h"

namespace navcache_test {

// ---------------------------------------------------------------------------
// Fixed wire facts. static_assert, not CHECK: these are facts about the build, so
// they belong to the compile, not to a run.
// ---------------------------------------------------------------------------
static_assert(kNavCacheHeaderWire == 52, "11 x u32/i32 + 1 x u64");
static_assert(kNavCoarseWire == 13056, "768 + 8192 + 4096 at kNodes = 64");
static_assert(kNavFineWire == 134217728u, "64 flow fields x 128^3 bytes = 128 MiB");
static_assert(kNavNearestWire == 2097152u, "one anchor byte per cell = 2 MiB");
static_assert(kNavCacheVersion == 2u,
              "version 2 is the first that carries FineNav::nearest. If this fires, the "
              "wire layout moved and every offset asserted below moved with it.");
// The two fine sections are one bake product, so the mask has a name for "both". These
// are facts about the build, not about a run — a CHECK on a constant would also trip
// MSVC's C4127 at /W4.
static_assert(kNavSectionFineAll == (kNavSectionFine | kNavSectionNearest),
              "flow and its anchor map travel together or not at all");
static_assert(kNavSectionAll ==
                  (kNavSectionCoarse | kNavSectionFine | kNavSectionNearest),
              "kNavSectionAll must cover every section the format defines");

// Byte offsets of every header field, derived here INDEPENDENTLY of nav_cache.cpp's
// Header struct. If the two ever disagree the decode below reports it, which is the
// point: a suite that reuses the production layout can only prove it agrees with itself.
inline constexpr std::size_t kOffMagic = 0;
inline constexpr std::size_t kOffVersion = 4;
inline constexpr std::size_t kOffSections = 8;
inline constexpr std::size_t kOffNumber = 12;
inline constexpr std::size_t kOffKind = 16;
inline constexpr std::size_t kOffSeed = 20;
inline constexpr std::size_t kOffNodes = 24;
inline constexpr std::size_t kOffMacroDim = 28;
inline constexpr std::size_t kOffCoarseWire = 32;
inline constexpr std::size_t kOffCoarseCrc = 36;
inline constexpr std::size_t kOffFineWire = 40; // u64
inline constexpr std::size_t kOffNearestWire = 48;

// Section offsets inside a full (coarse + fine + nearest) blob.
inline constexpr std::size_t kAtCoarse = kNavCacheHeaderWire;              //        52
inline constexpr std::size_t kAtFlow = kAtCoarse + kNavCoarseWire;         //    13,108
inline constexpr std::size_t kAtNearest = kAtFlow + kNavFineWire;          // 134,230,836
inline constexpr std::size_t kBlobAll = kAtNearest + kNavNearestWire;      // 136,327,988
inline constexpr std::size_t kBlobCoarse = kNavCacheHeaderWire + kNavCoarseWire; // 13,108

// ---------------------------------------------------------------------------
// Independent instruments
// ---------------------------------------------------------------------------

// CRC-32 (reflected 0xEDB88320), written out again on purpose. Two jobs: it lets a test
// re-checksum a section it edited deliberately, and — pinned below against the standard's
// own check value — it proves the production checksum really is CRC-32 rather than "a hash
// that agrees with itself", which is all a same-implementation comparison could show.
std::uint32_t crc32_over(const std::uint8_t* p, std::size_t n) {
    std::uint32_t c = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < n; ++i) {
        c ^= static_cast<std::uint32_t>(p[i]);
        for (int k = 0; k < 8; ++k)
            c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

std::uint32_t peek_u32(const std::vector<std::uint8_t>& b, std::size_t at) {
    return static_cast<std::uint32_t>(b[at]) |
           (static_cast<std::uint32_t>(b[at + 1]) << 8) |
           (static_cast<std::uint32_t>(b[at + 2]) << 16) |
           (static_cast<std::uint32_t>(b[at + 3]) << 24);
}

std::uint64_t peek_u64(const std::vector<std::uint8_t>& b, std::size_t at) {
    std::uint64_t v = 0;
    for (int i = 7; i >= 0; --i)
        v = (v << 8) | static_cast<std::uint64_t>(b[at + static_cast<std::size_t>(i)]);
    return v;
}

std::int32_t peek_i32(const std::vector<std::uint8_t>& b, std::size_t at) {
    return static_cast<std::int32_t>(peek_u32(b, at));
}

void poke_u32(std::vector<std::uint8_t>& b, std::size_t at, std::uint32_t v) {
    for (int i = 0; i < 4; ++i)
        b[at + static_cast<std::size_t>(i)] =
            static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu);
}

// A fully-populated CoarseGraph. Deliberately NOT zeroes: a round-trip over a zeroed
// struct passes even when the serializer drops half of it. An LCG rather than a shift
// mixer so nothing here can shift a signed value.
void fill_coarse(nav::CoarseGraph& g, std::uint32_t salt) {
    std::uint32_t h = salt | 1u;
    auto nextv = [&h]() -> std::uint32_t {
        h = h * 1664525u + 1013904223u;
        return h >> 8;
    };
    for (int i = 0; i < nav::kNodes; ++i)
        for (int d = 0; d < 6; ++d) g.edge[i][d] = static_cast<nav::Dist>(nextv());
    for (int i = 0; i < nav::kNodes; ++i)
        for (int j = 0; j < nav::kNodes; ++j) g.dist[i][j] = static_cast<nav::Dist>(nextv());
    for (int i = 0; i < nav::kNodes; ++i)
        for (int j = 0; j < nav::kNodes; ++j)
            g.next[i][j] =
                static_cast<std::uint8_t>(nextv() % static_cast<std::uint32_t>(nav::kNodes));
}

// ---------------------------------------------------------------------------
// Work counters — the only thing this suite measures. No clocks.
// ---------------------------------------------------------------------------
inline constexpr std::size_t kErrCodes = static_cast<std::size_t>(NavCacheError::Count);

struct Counters {
    int hits = 0;                 // reads that returned true
    int refusals = 0;             // reads that returned false
    int byCode[kErrCodes] = {};   // refusals (and hits, under None) per error code
    int routeCalls = 0;           // route_step invocations compared
    int walks = 0;                // node pairs walked
    int arrivals = 0;             // walks that reached kFlowArrived
};
Counters g_tally;

// Read, tally, and pin the error code. `expect == None` means the read must succeed.
bool read_tally(const std::uint8_t* bytes, std::size_t n, const NavCacheKey& key,
                nav::CoarseGraph* g, nav::FineNav* f, NavCacheError expect) {
    NavCacheError err = NavCacheError::Count;
    const bool ok = nav_cache_read(bytes, n, key, g, f, &err);
    if (ok) ++g_tally.hits;
    else ++g_tally.refusals;
    if (static_cast<std::size_t>(err) < kErrCodes) ++g_tally.byCode[static_cast<std::size_t>(err)];
    CHECK(err == expect);
    CHECK(ok == (expect == NavCacheError::None));
    return ok;
}

// A refused read must leave the caller's graph exactly as it was. Forge one header field,
// read, restore. The blob is never copied — it is 136 MB.
void refuse_with_poked_u32(std::vector<std::uint8_t>& blob, std::size_t at,
                           std::uint32_t forged, const NavCacheKey& key,
                           NavCacheError expect) {
    nav::CoarseGraph sentinel{};
    fill_coarse(sentinel, 0xABCDEF01u);
    nav::CoarseGraph probe = sentinel;

    const std::uint32_t was = peek_u32(blob, at);
    poke_u32(blob, at, forged);
    read_tally(blob.data(), blob.size(), key, &probe, nullptr, expect);
    poke_u32(blob, at, was);

    // Untouched, not half-applied: nav_cache_read validates the whole header before it
    // writes a byte, and this is what makes a rejected read a no-op.
    CHECK(std::memcmp(&probe, &sentinel, sizeof(nav::CoarseGraph)) == 0);
    CHECK(peek_u32(blob, at) == was);
}

// Walk route_step to termination, appending every returned byte (including the terminal
// one) to `trace`. Returns true if the walk arrived rather than stalling or capping out.
inline constexpr int kWalkCap = 512; // 6-connected torus diameter is 192; ample headroom

bool walk(const nav::CoarseGraph& g, const nav::FineNav& f, ivec3 from, ivec3 to,
          std::vector<std::uint8_t>& trace) {
    ivec3 at = from;
    for (int steps = 0; steps < kWalkCap; ++steps) {
        const std::uint8_t d = nav::route_step(g, f, at, to);
        trace.push_back(d);
        ++g_tally.routeCalls;
        if (d == nav::kFlowArrived) return true;
        if (d == nav::kFlowNone) return false;
        const int di = static_cast<int>(d);
        at.x = wrap_macro(at.x + nav::kNavDir[di][0]);
        at.y = wrap_macro(at.y + nav::kNavDir[di][1]);
        at.z = wrap_macro(at.z + nav::kNavDir[di][2]);
    }
    return false;
}

ivec3 node_cell(int node) {
    const LatticeNode n = lattice_unpack(node);
    return ivec3{lattice_coord(n.ix), lattice_coord(n.iy), lattice_coord(n.iz)};
}

// ---------------------------------------------------------------------------
// 1. The wire layout, decoded independently of the production Header struct.
//    No bake: a synthetic coarse graph exercises every byte of the format.
// ---------------------------------------------------------------------------
void wire_layout() {
    // The instrument first. 0xCBF43926 over "123456789" is CRC-32's published check
    // value, so this pins crc32_over to the real polynomial before anything trusts it.
    const char* check = "123456789";
    CHECK(crc32_over(reinterpret_cast<const std::uint8_t*>(check), 9) == 0xCBF43926u);

    // Advertised sizes must equal the offsets this suite computed on its own.
    CHECK(nav_cache_bytes(kNavSectionCoarse) == kBlobCoarse);
    CHECK(nav_cache_bytes(kNavSectionCoarse) == 13108u);
    CHECK(nav_cache_bytes(kNavSectionFineAll) == 136314932u);
    CHECK(nav_cache_bytes(kNavSectionAll) == kBlobAll);
    CHECK(nav_cache_bytes(kNavSectionAll) == 136327988u);

    // A NEGATIVE floor number, because that is the trap NavCacheKey::number exists to
    // avoid: this stack really does descend to -50, and the same label stored as
    // std::uint16_t elsewhere became 65486.
    const NavCacheKey key{-50, FloorKind::Derelict, 0xDEADBEEFu};

    nav::CoarseGraph g{};
    fill_coarse(g, 0x1234u);

    std::vector<std::uint8_t> blob;
    nav_cache_write(key, &g, nullptr, blob);
    CHECK(blob.size() == kBlobCoarse);

    // Every header field, at the offset this file declared, with the value it must hold.
    CHECK(peek_u32(blob, kOffMagic) == kNavCacheMagic);
    CHECK(peek_u32(blob, kOffMagic) == 0x4E324847u); // "GH2N", low byte first
    CHECK(peek_u32(blob, kOffVersion) == kNavCacheVersion);
    CHECK(peek_u32(blob, kOffSections) == kNavSectionCoarse);
    CHECK(peek_i32(blob, kOffNumber) == -50); // signed, exactly
    CHECK(peek_u32(blob, kOffKind) == static_cast<std::uint32_t>(FloorKind::Derelict));
    CHECK(peek_u32(blob, kOffSeed) == 0xDEADBEEFu);
    CHECK(peek_u32(blob, kOffNodes) == static_cast<std::uint32_t>(nav::kNodes));
    CHECK(peek_u32(blob, kOffNodes) == 64u);
    CHECK(peek_u32(blob, kOffMacroDim) == static_cast<std::uint32_t>(kMacroDim));
    CHECK(peek_u32(blob, kOffMacroDim) == 128u);
    CHECK(peek_u32(blob, kOffCoarseWire) == kNavCoarseWire);
    CHECK(peek_u64(blob, kOffFineWire) == 0ull);       // section absent => length 0
    CHECK(peek_u32(blob, kOffNearestWire) == 0u);      // ditto

    // The checksum really covers the coarse body, and really is CRC-32.
    CHECK(peek_u32(blob, kOffCoarseCrc) ==
          crc32_over(blob.data() + kAtCoarse, kNavCoarseWire));

    // Lossless over a fully-populated graph. memcmp is legitimate here only because
    // nav_cache.cpp proves CoarseGraph has no padding (see the note at the top).
    nav::CoarseGraph back{};
    read_tally(blob.data(), blob.size(), key, &back, nullptr, NavCacheError::None);
    CHECK(std::memcmp(&back, &g, sizeof(nav::CoarseGraph)) == 0);

    // Little-endian is not an accident of the host: byte 0 of the magic is 0x47 ('G')
    // and byte 3 is 0x4E ('N'), so a hex dump reads "GH2N" the same way on both builds.
    CHECK(blob[0] == 0x47); // 'G' — int literals, not 0x47u: a uint8_t promotes to int,
    CHECK(blob[3] == 0x4E); // and int-vs-unsigned would be MSVC C4389 at /W4

    // A header-only blob is legal and 52 bytes long, while nav_cache_bytes(0) reports 0.
    // Pinned because it is a documented asymmetry, not a rounding error: an app that
    // sizes a buffer from nav_cache_bytes(0) and then meets a header-only file will
    // reject it on length. Nothing in the tree writes one, so this is latent.
    std::vector<std::uint8_t> empty;
    nav_cache_write(key, nullptr, nullptr, empty);
    CHECK(empty.size() == kNavCacheHeaderWire);
    CHECK(nav_cache_bytes(0) == 0u);
    CHECK(peek_u32(empty, kOffSections) == 0u);
    CHECK(peek_u32(empty, kOffCoarseWire) == 0u);
    CHECK(peek_u32(empty, kOffCoarseCrc) == 0u);

    // Determinism: the same key + graph produce byte-identical bytes, every time. The
    // two large sections are a verbatim copy so they cannot vary; the header and the
    // CRC are the parts that could, which is exactly what this compares.
    std::vector<std::uint8_t> again;
    nav_cache_write(key, &g, nullptr, again);
    CHECK(again.size() == blob.size());
    CHECK(std::memcmp(again.data(), blob.data(), blob.size()) == 0);

    // A different key must produce different bytes, or the key check is decorative.
    std::vector<std::uint8_t> other;
    nav_cache_write(NavCacheKey{-50, FloorKind::Derelict, 0xDEADBEF0u}, &g, nullptr, other);
    CHECK(other.size() == blob.size());
    CHECK(std::memcmp(other.data(), blob.data(), blob.size()) != 0);

    // Asking for a section the blob does not carry is refused, and leaves BOTH outputs
    // alone — a partial trust is not expressible.
    nav::CoarseGraph g2{};
    nav::FineNav f2;
    read_tally(blob.data(), blob.size(), key, &g2, &f2, NavCacheError::MissingSection);
    CHECK(f2.flow.empty());
    CHECK(f2.nearest.empty());
}

// ---------------------------------------------------------------------------
// 2. A FineNav that is not fully baked must be refused at write time.
//    This is the AsyncBake trap: between start() and the poll() that finishes it, `flow`
//    is empty ON PURPOSE ([world/nav_async.h] ready() is !flow.empty()). Writing it
//    would produce a file that looks valid to `ls` and is rejected on the length check
//    one session later, which is a far worse bug report than a refusal here.
// ---------------------------------------------------------------------------
void a_half_baked_fine_is_refused() {
    nav::CoarseGraph g{};
    fill_coarse(g, 0x77u);
    const NavCacheKey key{7, FloorKind::Industrial, 5u};

    nav::FineNav midBake; // both vectors empty: exactly the mid-bake shape
    std::vector<std::uint8_t> blob;
    nav_cache_write(key, &g, &midBake, blob);
    CHECK(blob.empty()); // the caller's only signal is out.empty()

    // And a partially-sized one, which is the shape a hand-rolled FineNav lands in.
    midBake.flow.assign(16u, static_cast<std::uint8_t>(3));
    nav_cache_write(key, &g, &midBake, blob);
    CHECK(blob.empty());

    // The coarse-only path is unaffected by any of that.
    nav_cache_write(key, &g, nullptr, blob);
    CHECK(blob.size() == kBlobCoarse);
}

// ---------------------------------------------------------------------------
// 3. Filenames: stable, signed-safe, collision-free, and bounded.
// ---------------------------------------------------------------------------
void names_are_stable() {
    // The exact example nav_cache.h documents. Kind 2 is Industrial.
    CHECK(nav_cache_name(NavCacheKey{-3, FloorKind::Industrial, 0x162eu}) ==
          "nav_f-3_k2_s0000162e.bin");
    // The two overloads must agree — FloorStreamer calls the scalar one, game_test both.
    CHECK(nav_cache_name(-3, FloorKind::Industrial, 0x162eu) ==
          nav_cache_name(NavCacheKey{-3, FloorKind::Industrial, 0x162eu}));
    // %d not %u: a negative floor reads as "-50", not as a 10-digit unsigned.
    CHECK(nav_cache_name(-50, FloorKind::Residential, 0u) == "nav_f-50_k0_s00000000.bin");
    // The seed is zero-padded to 8 hex digits, so names sort stably in a directory.
    CHECK(nav_cache_name(0, FloorKind::Commercial, 1u) == "nav_f0_k1_s00000001.bin");
    CHECK(nav_cache_name(0, FloorKind::Commercial, 0xFFFFFFFFu) ==
          "nav_f0_k1_sffffffff.bin");

    // The key is three-dimensional: changing any one component changes the name.
    const std::string base = nav_cache_name(4, FloorKind::Residential, 9u);
    CHECK(nav_cache_name(5, FloorKind::Residential, 9u) != base);
    CHECK(nav_cache_name(4, FloorKind::Commercial, 9u) != base);
    CHECK(nav_cache_name(4, FloorKind::Residential, 10u) != base);

    // snprintf into char[64] must never be the thing that truncates. The widest real
    // expansion is INT_MIN + kind 255 + 8 hex digits = 35 characters.
    CHECK(nav_cache_name(-2147483647 - 1, static_cast<FloorKind>(255), 0xFFFFFFFFu)
              .size() < 64u);
    CHECK(nav_cache_name(-2147483647 - 1, static_cast<FloorKind>(255), 0xFFFFFFFFu)
              .size() == 35u);
}

// ---------------------------------------------------------------------------
// 4. NOTHING bounds the cache directory, and this is the number.
//    nav_cache.h calls this out as a real gap rather than a design choice: no entry
//    point here enumerates, ages out, or size-caps a directory, so there is no eviction
//    policy to test. What CAN be tested is the consequence — every distinct floor is a
//    distinct 136 MB file that is never reclaimed — so that is what is asserted, over
//    main.cpp's actual demo stack.
// ---------------------------------------------------------------------------
void nothing_bounds_the_cache_directory() {
    const int demoStack[] = {0, 1, 2, -8, -14, -26, -36, -50, 14, 30};
    static_assert(sizeof(demoStack) / sizeof(demoStack[0]) == 10,
                  "main.cpp's kDemoFloors is ten floors; the 1.27 GiB figure below is "
                  "ten times one full cache file");
    const std::size_t n = sizeof(demoStack) / sizeof(demoStack[0]);

    std::vector<std::string> names;
    for (std::size_t i = 0; i < n; ++i)
        names.push_back(nav_cache_name(demoStack[i], FloorKind::Residential,
                                       1337u ^ (static_cast<std::uint32_t>(demoStack[i]) *
                                                0x9e3779b9u)));

    // Ten floors, ten names: no key folds onto another, so nothing is ever overwritten
    // and nothing is ever removed.
    for (std::size_t i = 0; i < n; ++i)
        for (std::size_t j = i + 1; j < n; ++j) CHECK(names[i] != names[j]);

    // 10 x 136,327,988 = 1,363,279,880 bytes = 1.27 GiB, which is the figure
    // nav_cache.h quotes. If either the format or the demo stack changes, this moves and
    // somebody has to look at the growth story again.
    const unsigned long long onDisk =
        static_cast<unsigned long long>(n) * nav_cache_bytes(kNavSectionAll);
    CHECK(onDisk == 1363279880ull);
}

// ---------------------------------------------------------------------------
// 5. Every stale blob is refused, by the right code, with outputs untouched.
//    Forged in place on the full blob so 136 MB is never duplicated.
// ---------------------------------------------------------------------------
void invalidation_rejects(std::vector<std::uint8_t>& blob, const NavCacheKey& key) {
    CHECK(blob.size() == kBlobAll);

    // --- the blob is not ours, or not this version ---
    refuse_with_poked_u32(blob, kOffMagic, 0x4E324848u, key, NavCacheError::BadMagic);
    refuse_with_poked_u32(blob, kOffMagic, 0u, key, NavCacheError::BadMagic);
    // Version 1 is the pre-`nearest` format. A v1 blob under a v2 magic is refused on
    // the version check, which is what makes "bump the version when the BAKE changes"
    // an enforceable rule and not a hope.
    refuse_with_poked_u32(blob, kOffVersion, 1u, key, NavCacheError::BadVersion);
    refuse_with_poked_u32(blob, kOffVersion, 3u, key, NavCacheError::BadVersion);

    // --- right format, WRONG FLOOR. This is the invalidation that matters at runtime:
    //     the key is the cache's whole theory of staleness, because geometry is a pure
    //     function of (number, kind, seed).
    nav::CoarseGraph sentinel{};
    fill_coarse(sentinel, 0x5A5Au);
    nav::CoarseGraph probe = sentinel;
    nav::FineNav probeFine;
    read_tally(blob.data(), blob.size(), NavCacheKey{key.number + 1, key.kind, key.seed},
               &probe, &probeFine, NavCacheError::KeyMismatch);
    read_tally(blob.data(), blob.size(),
               NavCacheKey{key.number, FloorKind::Derelict, key.seed}, &probe, &probeFine,
               NavCacheError::KeyMismatch);
    read_tally(blob.data(), blob.size(), NavCacheKey{key.number, key.kind, key.seed + 1u},
               &probe, &probeFine, NavCacheError::KeyMismatch);
    // Neither output was touched — not the graph, and not one byte of the 130 MB fine.
    CHECK(std::memcmp(&probe, &sentinel, sizeof(nav::CoarseGraph)) == 0);
    CHECK(probeFine.flow.empty());
    CHECK(probeFine.nearest.empty());

    // --- a build with a different lattice or grid cannot read this file ---
    refuse_with_poked_u32(blob, kOffNodes, 63u, key, NavCacheError::ShapeMismatch);
    refuse_with_poked_u32(blob, kOffMacroDim, 64u, key, NavCacheError::ShapeMismatch);

    // --- declared lengths must equal THIS build's constants, exactly ---
    refuse_with_poked_u32(blob, kOffCoarseWire,
                          static_cast<std::uint32_t>(kNavCoarseWire) + 1u, key,
                          NavCacheError::SizeMismatch);
    refuse_with_poked_u32(blob, kOffNearestWire,
                          static_cast<std::uint32_t>(kNavNearestWire) + 1u, key,
                          NavCacheError::SizeMismatch);
    // Half a bake product is MALFORMED, not partial: flow without its anchor map routes
    // nobody, and zero-filling the absent half would read as "every cell is anchored to
    // node 0" — a plausible-looking lie. Clearing just the nearest bit forges exactly
    // that, and it is refused.
    refuse_with_poked_u32(blob, kOffSections, kNavSectionCoarse | kNavSectionFine, key,
                          NavCacheError::SizeMismatch);
    // A section bit cleared while its length stays non-zero is the reverse inconsistency
    // and is caught by the same rule.
    refuse_with_poked_u32(blob, kOffSections, kNavSectionFineAll, key,
                          NavCacheError::SizeMismatch);

    // --- truncation: the ordinary crash-mid-write case ---
    read_tally(blob.data(), blob.size() - 1u, key, &probe, nullptr,
               NavCacheError::TooShort);
    read_tally(blob.data(), kNavCacheHeaderWire - 1u, key, &probe, nullptr,
               NavCacheError::TooShort);
    read_tally(blob.data(), 0u, key, &probe, nullptr, NavCacheError::TooShort);
    read_tally(nullptr, blob.size(), key, &probe, nullptr, NavCacheError::TooShort);
    CHECK(std::memcmp(&probe, &sentinel, sizeof(nav::CoarseGraph)) == 0);

    // --- bit rot in the coarse section. The checksum is the only content check in the
    //     format, and it covers exactly 13,056 bytes; the header explains at length why
    //     the other 136 MB do not get one.
    const std::uint8_t wasByte = blob[kAtCoarse + 4096u];
    blob[kAtCoarse + 4096u] = static_cast<std::uint8_t>(wasByte ^ 0x01u);
    probe = sentinel;
    read_tally(blob.data(), blob.size(), key, &probe, nullptr, NavCacheError::BadChecksum);
    CHECK(std::memcmp(&probe, &sentinel, sizeof(nav::CoarseGraph)) == 0);
    blob[kAtCoarse + 4096u] = wasByte;

    // A forged CRC over unforged bytes is rejected too, so the check is not one-sided.
    refuse_with_poked_u32(blob, kOffCoarseCrc, 0u, key, NavCacheError::BadChecksum);

    // Every poke was restored, so the blob still reads cleanly. Coarse only — this
    // allocates nothing and is the cheap re-validation the next test builds on.
    probe = sentinel;
    CHECK(read_tally(blob.data(), blob.size(), key, &probe, nullptr, NavCacheError::None));
    CHECK(std::memcmp(&probe, &sentinel, sizeof(nav::CoarseGraph)) != 0);
}

// ---------------------------------------------------------------------------
// 6. The memory bound IS the section mask — and here is where that bound stops.
// ---------------------------------------------------------------------------
void the_memory_bound_is_the_section_mask(const nav::CoarseGraph& coarse,
                                          const std::vector<std::uint8_t>& fullBlob,
                                          const NavCacheKey& key) {
    // A caller that only wants reachability writes 13,108 bytes instead of 136,327,988 —
    // a factor of 10,400. That ratio is the entire memory story of this module. Integer
    // division on purpose: 10,400.36 truncates to the figure nav_cache.h quotes.
    std::vector<std::uint8_t> coarseOnly;
    nav_cache_write(key, &coarse, nullptr, coarseOnly);
    CHECK(coarseOnly.size() == kBlobCoarse);
    CHECK(nav_cache_bytes(kNavSectionAll) / nav_cache_bytes(kNavSectionCoarse) == 10400u);

    // The coarse BODY is identical in both blobs — same visitor, same order — while the
    // headers differ only in the three section fields. That is what proves the section
    // mask changes what is carried and nothing else.
    CHECK(std::memcmp(coarseOnly.data() + kAtCoarse, fullBlob.data() + kAtCoarse,
                      kNavCoarseWire) == 0);
    CHECK(std::memcmp(coarseOnly.data(), fullBlob.data(), kOffSections) == 0);
    CHECK(std::memcmp(coarseOnly.data() + kOffNumber, fullBlob.data() + kOffNumber,
                      kOffFineWire - kOffNumber) == 0);
    CHECK(peek_u32(coarseOnly, kOffSections) != peek_u32(fullBlob, kOffSections));

    // Reading coarse out of the FULL blob allocates nothing for fine, which is the bound
    // working as advertised.
    nav::CoarseGraph g{};
    CHECK(read_tally(fullBlob.data(), fullBlob.size(), key, &g, nullptr,
                     NavCacheError::None));
    CHECK(std::memcmp(&g, &coarse, sizeof(nav::CoarseGraph)) == 0);

    // AND HERE IS THE LIMIT OF IT, pinned so nobody "fixes" it by accident. The header
    // says a coarse-only caller "touches 13 KB of a 130 MiB blob"; true of the WORK, but
    // not of the residency. nav_cache_read checks `n < lay.total` before it checks which
    // section the caller wants, so handing it the first 13,108 bytes of a full blob is
    // TooShort — the whole 136 MB must be in memory (or mapped) even to read the 13 KB
    // graph out of it. The cheap path exists only when the blob was WRITTEN coarse-only.
    read_tally(fullBlob.data(), kBlobCoarse, key, &g, nullptr, NavCacheError::TooShort);

    // Whereas a coarse-only blob really is answerable from 13,108 bytes.
    nav::CoarseGraph g2{};
    CHECK(read_tally(coarseOnly.data(), coarseOnly.size(), key, &g2, nullptr,
                     NavCacheError::None));
    CHECK(std::memcmp(&g2, &coarse, sizeof(nav::CoarseGraph)) == 0);
}

// ---------------------------------------------------------------------------
// 7. THE LOAD-BEARING TEST: a cache hit routes exactly as the cold bake does.
//    One bake, reused by everything below it. Residential because master_prompt
//    documents it as the dense, fully-connected kind, so route_step has real answers to
//    give rather than kFlowNone everywhere.
// ---------------------------------------------------------------------------
void baked_round_trip_routes_identically() {
    const NavCacheKey key{-14, FloorKind::Residential, 0x51ed270bu};

    World w;
    generate_floor(w, key.number, floor_spec(key.kind), key.seed);

    nav::CoarseGraph cold{};
    nav::bake_coarse(w.grid(), cold);
    nav::FineNav coldFine;
    nav::bake_fine(w.grid(), coldFine);
    CHECK(coldFine.flow.size() == kNavFineWire);
    CHECK(coldFine.nearest.size() == kNavNearestWire);

    // The COLD answer: walk 17 node pairs to termination and keep the full step trace.
    // Traces, not endpoints — an identical destination reached by a different route
    // would still be a changed cache.
    std::vector<std::uint8_t> coldTrace;
    int coldArrivals = 0;
    for (int i = 0; i < 16; ++i) {
        if (walk(cold, coldFine, node_cell(i), node_cell((i + 7) % nav::kNodes), coldTrace))
            ++coldArrivals;
        ++g_tally.walks;
    }
    // The pair game_test's own test_streamed_nav uses, for continuity with it.
    if (walk(cold, coldFine, node_cell(5), node_cell(58), coldTrace)) ++coldArrivals;
    ++g_tally.walks;
    g_tally.arrivals += coldArrivals;
    // A dense Residential floor must route SOMEWHERE, or this test proves nothing about
    // routing and only re-proves memcmp. Deliberately `> 0` and not `== 17`, even though
    // MEASURED 2026-07-29 on floor -14 / seed 0x51ed270b all 17 pairs arrive (3526
    // route_step calls across the cold and warm walks combined): full horizontal 64-node
    // connectivity is documented as NOT structurally guaranteed, a nav that correctly
    // reports kUnreachable is sound, and floor_gen is another lane's file. The
    // nav_cache-relevant assertions are the cold-vs-warm ones below, and those are exact.
    CHECK(coldArrivals > 0);
    CHECK(!coldTrace.empty());

    // Encode the whole thing.
    std::vector<std::uint8_t> blob;
    nav_cache_write(key, &cold, &coldFine, blob);
    CHECK(blob.size() == kBlobAll);

    // The two large sections sit at the offsets this suite computed, byte for byte —
    // which is what makes every poke offset above land where it was meant to.
    CHECK(std::memcmp(blob.data() + kAtFlow, coldFine.flow.data(), kNavFineWire) == 0);
    CHECK(std::memcmp(blob.data() + kAtNearest, coldFine.nearest.data(),
                      kNavNearestWire) == 0);
    CHECK(peek_u64(blob, kOffFineWire) == static_cast<std::uint64_t>(kNavFineWire));
    CHECK(peek_u32(blob, kOffNearestWire) == static_cast<std::uint32_t>(kNavNearestWire));
    CHECK(peek_u32(blob, kOffSections) == kNavSectionAll);

    // A fine whose flow is complete but whose ANCHOR MAP is missing is refused. This is
    // the half-product case the v1 format could not even express, and it is checked by
    // swapping the vector out rather than allocating a second 2 MB.
    {
        std::vector<std::uint8_t> stolen;
        coldFine.nearest.swap(stolen);
        std::vector<std::uint8_t> refused;
        nav_cache_write(key, &cold, &coldFine, refused);
        CHECK(refused.empty());
        coldFine.nearest.swap(stolen);
        CHECK(coldFine.nearest.size() == kNavNearestWire);
    }

    // THE HIT. Decode into a fresh nav and prove it is the same bake...
    nav::CoarseGraph warm{};
    nav::FineNav warmFine;
    CHECK(read_tally(blob.data(), blob.size(), key, &warm, &warmFine,
                     NavCacheError::None));
    CHECK(std::memcmp(&warm, &cold, sizeof(nav::CoarseGraph)) == 0);
    CHECK(warmFine.flow.size() == kNavFineWire);
    CHECK(warmFine.nearest.size() == kNavNearestWire);
    CHECK(std::memcmp(warmFine.flow.data(), coldFine.flow.data(), kNavFineWire) == 0);
    CHECK(std::memcmp(warmFine.nearest.data(), coldFine.nearest.data(),
                      kNavNearestWire) == 0);

    // ...and then prove it still ROUTES the same, which is the claim a user of the cache
    // actually depends on. Same pairs, same order, same traces.
    std::vector<std::uint8_t> warmTrace;
    int warmArrivals = 0;
    for (int i = 0; i < 16; ++i) {
        if (walk(warm, warmFine, node_cell(i), node_cell((i + 7) % nav::kNodes), warmTrace))
            ++warmArrivals;
        ++g_tally.walks;
    }
    if (walk(warm, warmFine, node_cell(5), node_cell(58), warmTrace)) ++warmArrivals;
    ++g_tally.walks;
    g_tally.arrivals += warmArrivals;

    CHECK(warmArrivals == coldArrivals);
    CHECK(warmTrace.size() == coldTrace.size());
    CHECK(!warmTrace.empty());
    CHECK(std::memcmp(warmTrace.data(), coldTrace.data(), warmTrace.size()) == 0);

    // Re-encoding the DECODED nav reproduces the original bytes, so a cache that is read
    // and rewritten (the re-entry path) cannot drift over generations. Only the coarse
    // half is re-encoded here, deliberately: the fine half of a re-encode is a verbatim
    // insert of warmFine, and warmFine was just memcmp'd against coldFine, which the
    // blob's own fine section was memcmp'd against two blocks up. So the full re-encode
    // is byte-identical by transitivity, and materializing another 136 MB to restate it
    // would only raise this suite's peak footprint.
    std::vector<std::uint8_t> recoarse;
    nav_cache_write(key, &warm, nullptr, recoarse);
    CHECK(recoarse.size() == kBlobCoarse);
    CHECK(std::memcmp(recoarse.data() + kAtCoarse, blob.data() + kAtCoarse,
                      kNavCoarseWire) == 0);
    CHECK(peek_u32(recoarse, kOffCoarseCrc) == peek_u32(blob, kOffCoarseCrc));

    // Reuse this one bake for the two remaining suites, so game_test pays for it once.
    the_memory_bound_is_the_section_mask(cold, blob, key);
    invalidation_rejects(blob, key);
}

// Print what the run actually did. ASCII only — this console is CP1251.
void report() {
    const unsigned long long all = nav_cache_bytes(kNavSectionAll);
    const unsigned long long cs = nav_cache_bytes(kNavSectionCoarse);

    // How many of the nine failure codes a run genuinely exercised. Index 0 (None) is
    // the hits bucket, so it is skipped: this counts REJECTION coverage.
    int codesHit = 0;
    for (std::size_t i = 1; i < kErrCodes; ++i)
        if (g_tally.byCode[i] > 0) ++codesHit;

    // Nine codes exist; NoFile is only reachable through load_nav_cache, which this
    // suite deliberately does not call (game_test's test_nav_cache_roundtrip covers it),
    // so eight is the ceiling from the buffer layer.
    CHECK(codesHit == 8);
    CHECK(g_tally.hits > 0);
    CHECK(g_tally.refusals > g_tally.hits);
    CHECK(g_tally.walks == 34);      // 17 node pairs, walked on both the cold and warm nav
    CHECK(g_tally.routeCalls >= 34); // at least one step per walk
    CHECK(g_tally.arrivals > 0);

    std::printf("  navcache: %d hits / %d refusals across %d of 9 error codes; "
                "%d route_step calls compared over %d walks (%d arrived); "
                "blob %llu B full vs %llu B coarse-only (%llux); "
                "10-floor stack = %.2f GiB on disk with no eviction path\n",
                g_tally.hits, g_tally.refusals, codesHit, g_tally.routeCalls,
                g_tally.walks, g_tally.arrivals, all, cs, all / cs,
                static_cast<double>(10ull * all) / (1024.0 * 1024.0 * 1024.0));
}

} // namespace navcache_test

static void test_navcache_all() {
    navcache_test::wire_layout();
    navcache_test::a_half_baked_fine_is_refused();
    navcache_test::names_are_stable();
    navcache_test::nothing_bounds_the_cache_directory();
    // Last: it owns the single ~3.7 s / 130 MB bake and hands it to the two suites that
    // need real baked bytes rather than a synthetic graph.
    navcache_test::baked_round_trip_routes_identically();
    navcache_test::report();
}
