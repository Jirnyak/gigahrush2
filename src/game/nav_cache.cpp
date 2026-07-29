#include "game/nav_cache.h"

#include <algorithm>   // sort (LRU order over a directory listing)
#include <chrono>      // file_time_type::clock::now — the LRU stamp
#include <cstdio>      // snprintf (formatting) + fopen/fread/fwrite/fclose/remove
#include <filesystem>  // create_directories / file_size / rename — error_code overloads
#include <system_error>

namespace giga::game {

namespace {

// ---------------------------------------------------------------------------
// One traversal, two directions
// ---------------------------------------------------------------------------
// Every struct below is walked by a single `visit_*` template that both the writer and
// the reader instantiate, for the reason [game/save.cpp] states: hand-written write/read
// pairs drift by one field and the result is a decode that succeeds with every later
// field shifted. With one traversal that bug is not expressible. The archives take a
// reference per field, so `T` deduces as `const Foo` when writing and `Foo` when reading.

// Little-endian, byte at a time. NOT a memcpy of the struct — see the header.
class Writer {
public:
    explicit Writer(std::vector<std::uint8_t>& out) : out_(&out) {}

    void u8(const std::uint8_t& v) { out_->push_back(v); }
    void u16(const std::uint16_t& v) {
        out_->push_back(static_cast<std::uint8_t>(v & 0xFFu));
        out_->push_back(static_cast<std::uint8_t>((v >> 8) & 0xFFu));
    }
    void u32(const std::uint32_t& v) {
        for (int i = 0; i < 4; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    void u64(const std::uint64_t& v) {
        for (int i = 0; i < 8; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    // Signed -> unsigned is modular and always has been; the reverse is well-defined
    // since C++20 mandated two's complement and this tree is C++23. So a negative floor
    // number round-trips exactly, which is the whole point of NavCacheKey::number being
    // signed.
    void i32(const std::int32_t& v) { u32(static_cast<std::uint32_t>(v)); }

private:
    std::vector<std::uint8_t>* out_;
};

// Bounds-checked in ONE place — u8 — so no visitor has to know how long the buffer is.
// Once ok_ is false every later field reads as zero and the whole parse is discarded.
class Reader {
public:
    Reader(const std::uint8_t* p, std::size_t n) : p_(p), n_(n) {}

    void u8(std::uint8_t& v) {
        if (at_ >= n_) {
            ok_ = false;
            v = 0;
            return;
        }
        v = p_[at_++];
    }
    void u16(std::uint16_t& v) {
        std::uint8_t a = 0, b = 0;
        u8(a);
        u8(b);
        v = static_cast<std::uint16_t>(static_cast<std::uint32_t>(a) |
                                       (static_cast<std::uint32_t>(b) << 8));
    }
    void u32(std::uint32_t& v) {
        std::uint8_t b[4] = {};
        for (int i = 0; i < 4; ++i) u8(b[i]);
        v = static_cast<std::uint32_t>(b[0]) |
            (static_cast<std::uint32_t>(b[1]) << 8) |
            (static_cast<std::uint32_t>(b[2]) << 16) |
            (static_cast<std::uint32_t>(b[3]) << 24);
    }
    void u64(std::uint64_t& v) {
        std::uint8_t b[8] = {};
        for (int i = 0; i < 8; ++i) u8(b[i]);
        v = 0;
        for (int i = 7; i >= 0; --i) v = (v << 8) | static_cast<std::uint64_t>(b[i]);
    }
    void i32(std::int32_t& v) {
        std::uint32_t u = 0;
        u32(u);
        v = static_cast<std::int32_t>(u);
    }

    bool ok() const { return ok_; }

private:
    const std::uint8_t* p_ = nullptr;
    std::size_t n_ = 0;
    std::size_t at_ = 0;
    bool ok_ = true;
};

// CRC-32 (reflected 0xEDB88320), bit-serial. A THIRD copy of this loop would be one too
// many; this is the third counting [render/screenshot.cpp]'s PNG chunk CRC and
// [game/save.cpp]'s payload CRC, and the right fix is to promote it to a shared core
// header the same way src/core/rng.h now hosts the splitmix finalizer that had thirteen
// copies. Kept local here rather than reaching into another translation unit's anonymous
// namespace, which is not possible anyway.
//
// It is only ever run over the 13,056-byte coarse section — 104,448 shift iterations,
// microseconds. The header explains at length why the 130 MiB of fine sections do not
// get one.
std::uint32_t crc32(const std::uint8_t* p, std::size_t n) {
    std::uint32_t c = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < n; ++i) {
        c ^= static_cast<std::uint32_t>(p[i]);
        for (int k = 0; k < 8; ++k)
            c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

// The fixed prologue, in wire order. Offsets are in the comments because a hex dump of a
// rejected cache is the fastest way to find out why it was rejected.
struct Header {
    std::uint32_t magic = 0;       //  0
    std::uint32_t version = 0;     //  4
    std::uint32_t sections = 0;    //  8  kNavSection* bitmask
    std::int32_t number = 0;       // 12  signed: floors descend
    std::uint32_t kind = 0;        // 16  FloorKind
    std::uint32_t seed = 0;        // 20
    std::uint32_t nodes = 0;       // 24  nav::kNodes at write time
    std::uint32_t macroDim = 0;    // 28  kMacroDim at write time
    std::uint32_t coarseWire = 0;  // 32  bytes of the coarse section (0 if absent)
    std::uint32_t coarseCrc = 0;   // 36  CRC-32 of the coarse section (0 if absent)
    std::uint64_t fineWire = 0;    // 40  bytes of the flow section (0 if absent)
    std::uint32_t nearestWire = 0; // 48  bytes of the anchor section (0 if absent)
};                                 // 52 == kNavCacheHeaderWire

template <class Ar, class H>
void visit_header(Ar& ar, H& h) {
    ar.u32(h.magic);
    ar.u32(h.version);
    ar.u32(h.sections);
    ar.i32(h.number);
    ar.u32(h.kind);
    ar.u32(h.seed);
    ar.u32(h.nodes);
    ar.u32(h.macroDim);
    ar.u32(h.coarseWire);
    ar.u32(h.coarseCrc);
    ar.u64(h.fineWire);
    ar.u32(h.nearestWire);
}

// The coarse graph, in DECLARATION order — edge, dist, next. nav::Dist is std::uint16_t
// so no conversion happens here; if it ever widens, kNavCoarseWire changes and the
// static_assert below fires before any cache is written in the new shape.
template <class Ar, class G>
void visit_coarse(Ar& ar, G& g) {
    for (int i = 0; i < nav::kNodes; ++i)
        for (int d = 0; d < 6; ++d) ar.u16(g.edge[i][d]);
    for (int i = 0; i < nav::kNodes; ++i)
        for (int j = 0; j < nav::kNodes; ++j) ar.u16(g.dist[i][j]);
    for (int i = 0; i < nav::kNodes; ++i)
        for (int j = 0; j < nav::kNodes; ++j) ar.u8(g.next[i][j]);
}

// Two independent guards pointing at the same fact, deliberately.
//
// The wire check (coarseWire == kNavCoarseWire in the header) catches a blob written by a
// build whose CoarseGraph was a different shape. This static_assert catches the reverse:
// THIS build changing CoarseGraph without anyone updating kNavCoarseWire, which the wire
// check cannot see because both sides would move together.
static_assert(sizeof(nav::CoarseGraph::edge) + sizeof(nav::CoarseGraph::dist) +
                      sizeof(nav::CoarseGraph::next) ==
                  kNavCoarseWire,
              "a CoarseGraph member changed width. Update kNavCoarseWire and bump "
              "kNavCacheVersion in the same edit, or every cached bake is misread.");
// And this one says there is nothing ELSE in CoarseGraph that the three visited members
// are not carrying — a fourth member would make sizeof exceed the sum above while the
// sum itself stayed correct. It holds today because the struct is three tightly packed
// arrays of 2- and 1-byte types (768 + 8192 + 4096 = 13056, even, so no tail padding).
// If a compiler ever inserts padding, the right fix is to relax THIS assert to `>=`, not
// to change kNavCoarseWire: the wire layout is explicit and does not depend on sizeof.
static_assert(sizeof(nav::CoarseGraph) == kNavCoarseWire,
              "CoarseGraph gained a member (serialize it and bump kNavCacheVersion) or "
              "gained padding (see the note above this assert)");
static_assert(kNavCoarseWire == 13056, "768 + 8192 + 4096 at kNodes = 64");
static_assert(kNavFineWire == 134217728u, "64 flow fields x 128^3 bytes = 128 MiB");
static_assert(kNavNearestWire == 2097152u, "one anchor byte per cell = 2 MiB");
static_assert(kNavCacheHeaderWire == 11u * 4u + 8u, "11 x u32/i32 + 1 x u64");
// The three lengths a reader can accept, and the budget derived from the largest. Pinned
// as literals because they are quoted as measured figures in this file's header, in
// [tests/suite_navcache.inl] and in the sweep's own arithmetic — if the format moves, every
// one of those numbers is wrong and this is where it is noticed.
static_assert(kNavCacheCoarseOnlyWire == 13108u, "52 + 13,056");
static_assert(kNavCacheFineOnlyWire == 136314932u, "52 + 128 MiB + 2 MiB");
static_assert(kNavCacheFullWire == 136327988u, "52 + 13,056 + 128 MiB + 2 MiB");
static_assert(kNavCacheFineBudgetBytes == 545311952ull, "4 full entries");
static_assert(kNavCacheMaxCoarseStubs > 255,
              "the stub cap must exceed kFloorSlots, or one world's own floors evict each "
              "other's coarse graphs — which is the one section that is never worth losing");
static_assert(nav::kUnreachable == 0xFFFFu,
              "the sentinel is serialized verbatim, so it is part of the format");
// The two fine sections are one bake product ([world/nav.h] `bake_fine` fills both), so
// the format has a name for "both" and nothing anywhere writes one without the other.
static_assert(kNavSectionFineAll == (kNavSectionFine | kNavSectionNearest));

// Where each section sits in a blob whose header has been validated.
struct Layout {
    bool hasCoarse = false;
    bool hasFine = false;
    std::size_t coarseAt = 0;
    std::size_t fineAt = 0;
    std::size_t nearestAt = 0;
    std::size_t total = 0;
};

// EVERY rule that decides whether a header may be trusted, in one place — so the
// in-memory reader and the file reader cannot drift apart on which stale blob they
// accept. Fills `lay` only on success.
NavCacheError check_header(const Header& h, const NavCacheKey& key, Layout& lay) {
    if (h.magic != kNavCacheMagic) return NavCacheError::BadMagic;
    if (h.version != kNavCacheVersion) return NavCacheError::BadVersion;

    // The key: is this even the right floor? Checked before anything about shape, because
    // "you cached floor 2 and asked for floor -8" is a caller bug and wants to be named
    // as one rather than as a size problem.
    if (h.number != static_cast<std::int32_t>(key.number) ||
        h.kind != static_cast<std::uint32_t>(key.kind) || h.seed != key.seed)
        return NavCacheError::KeyMismatch;

    if (h.nodes != static_cast<std::uint32_t>(nav::kNodes) ||
        h.macroDim != static_cast<std::uint32_t>(kMacroDim))
        return NavCacheError::ShapeMismatch;

    const bool hasCoarse = (h.sections & kNavSectionCoarse) != 0u;
    const bool hasFine = (h.sections & kNavSectionFine) != 0u;
    const bool hasNearest = (h.sections & kNavSectionNearest) != 0u;

    // Half a bake product is malformed, not partial: flow without its anchor map (or the
    // reverse) routes nobody, and zero-filling the absent half would read as "every cell
    // is anchored to node 0" — a plausible-looking lie. Reported as a size problem
    // because that is literally what it is: one of the two declared lengths is 0 where
    // the format requires it to be the build's constant.
    if (hasFine != hasNearest) return NavCacheError::SizeMismatch;

    // Declared lengths must equal THIS build's constants exactly. Validated before they
    // are used to compute any offset, so a corrupt header cannot walk the read off the
    // end of the buffer — the same "bound it before you size anything with it" rule
    // [game/save.cpp] applies to openedCount.
    if (hasCoarse && h.coarseWire != static_cast<std::uint32_t>(kNavCoarseWire))
        return NavCacheError::SizeMismatch;
    if (hasFine && h.fineWire != static_cast<std::uint64_t>(kNavFineWire))
        return NavCacheError::SizeMismatch;
    if (hasNearest && h.nearestWire != static_cast<std::uint32_t>(kNavNearestWire))
        return NavCacheError::SizeMismatch;
    if (!hasCoarse && h.coarseWire != 0u) return NavCacheError::SizeMismatch;
    if (!hasFine && h.fineWire != 0ull) return NavCacheError::SizeMismatch;
    if (!hasNearest && h.nearestWire != 0u) return NavCacheError::SizeMismatch;

    lay.hasCoarse = hasCoarse;
    lay.hasFine = hasFine;
    lay.coarseAt = kNavCacheHeaderWire;
    lay.fineAt = lay.coarseAt + (hasCoarse ? kNavCoarseWire : 0u);
    lay.nearestAt = lay.fineAt + (hasFine ? kNavFineWire : 0u);
    lay.total = lay.nearestAt + (hasNearest ? kNavNearestWire : 0u);
    return NavCacheError::None;
}

// Header + coarse section, i.e. everything except the two big byte arrays. Split out so
// `save_nav_cache` can build the 13,108-byte prologue, write it, and then stream 130 MiB
// straight from the caller's vectors — instead of materializing a second copy of them.
void write_prologue(const NavCacheKey& key, std::uint32_t sections,
                    const nav::CoarseGraph* coarse, std::size_t reserveTotal,
                    std::vector<std::uint8_t>& out) {
    out.reserve(reserveTotal);
    out.clear();

    // Coarse body first: the header carries its CRC, so it cannot be written until the
    // bytes it covers exist. Same ordering [game/save.cpp] uses and for the same reason.
    std::vector<std::uint8_t> body;
    if (coarse != nullptr) {
        body.reserve(kNavCoarseWire);
        Writer bw(body);
        visit_coarse(bw, *coarse);
    }

    Header h{};
    h.magic = kNavCacheMagic;
    h.version = kNavCacheVersion;
    h.sections = sections;
    h.number = static_cast<std::int32_t>(key.number);
    h.kind = static_cast<std::uint32_t>(key.kind);
    h.seed = key.seed;
    h.nodes = static_cast<std::uint32_t>(nav::kNodes);
    h.macroDim = static_cast<std::uint32_t>(kMacroDim);
    h.coarseWire = static_cast<std::uint32_t>(body.size());
    h.coarseCrc = body.empty() ? 0u : crc32(body.data(), body.size());
    h.fineWire = ((sections & kNavSectionFine) != 0u)
                     ? static_cast<std::uint64_t>(kNavFineWire)
                     : 0ull;
    h.nearestWire = ((sections & kNavSectionNearest) != 0u)
                        ? static_cast<std::uint32_t>(kNavNearestWire)
                        : 0u;

    Writer hw(out);
    visit_header(hw, h);
    out.insert(out.end(), body.begin(), body.end());
}

// A fully baked FineNav is the only one this format can describe. An AsyncBake between
// start() and the poll() that completes it holds an EMPTY flow vector on purpose
// ([world/nav_async.h]: ready() is !flow.empty()), so this is the shape a caller that
// forgot to check ready() would hand over.
bool fine_is_complete(const nav::FineNav& fine) {
    return fine.flow.size() == kNavFineWire && fine.nearest.size() == kNavNearestWire;
}

bool read_exact(std::FILE* f, void* dst, std::size_t n) {
    return std::fread(dst, 1, n, f) == n;
}
bool write_exact(std::FILE* f, const void* src, std::size_t n) {
    return std::fwrite(src, 1, n, f) == n;
}

// ---------------------------------------------------------------------------
// Bounding the directory
// ---------------------------------------------------------------------------

// Write `path` by way of `path + ".tmp"` plus a rename, so an interrupted write cannot
// destroy the good file that was already there. Three pieces rather than one buffer
// because the caller's 130 MiB goes straight from its vectors to the file and is never
// concatenated first — the same reason `write_prologue` exists.
bool write_atomic(const std::string& path, const std::uint8_t* a, std::size_t an,
                  const std::uint8_t* b, std::size_t bn, const std::uint8_t* c,
                  std::size_t cn) {
    const std::string tmp = path + ".tmp";
    std::FILE* f = std::fopen(tmp.c_str(), "wb");
    if (!f) return false;

    bool ok = write_exact(f, a, an);
    if (ok && bn != 0) ok = write_exact(f, b, bn);
    if (ok && cn != 0) ok = write_exact(f, c, cn);
    // fclose's status, not only fwrite's: the tail of the last chunk can still be sitting
    // in the stdio buffer, so a full disk surfaces HERE. The previous in-place writer
    // discarded this return and could report a successful save of a short file.
    if (std::fclose(f) != 0) ok = false;
    if (!ok) {
        std::remove(tmp.c_str());
        return false;
    }

    std::error_code ec;
    std::filesystem::rename(tmp, path, ec); // replaces an existing regular file
    if (ec) {
        std::remove(tmp.c_str());
        return false;
    }
    return true;
}

// The directory a cache file lives in. A bare filename means the working directory, which
// is what game_test's relative paths use.
std::string parent_dir_of(const std::string& path) {
    const std::filesystem::path p(path);
    if (!p.has_parent_path()) return std::string(".");
    const std::string d = p.parent_path().string();
    return d.empty() ? std::string(".") : d;
}

// One owned file, as a sweep sees it.
struct DirEntry {
    std::string name;
    NavCacheKey key{};
    std::uint64_t bytes = 0;
    std::filesystem::file_time_type stamp{};
    bool fine = false;   // carries the 136 MB half
    bool coarse = false; // carries the 13 KB half
    bool junk = false;   // no reader can ever get anything out of it
    bool gone = false;   // removed by this sweep
};

// Is this file ours? The name grammar (round-trip validated in `nav_cache_parse_name`),
// plus the one extra spelling `write_atomic` produces. A `.tmp` is ours AND is junk by
// construction: it is either mid-write or abandoned, and nothing ever reads it by that
// name.
bool owned_name(const std::string& name, NavCacheKey& key, bool& isTemp) {
    isTemp = false;
    const std::size_t n = name.size();
    if (n > 4 && name[n - 4] == '.' && name[n - 3] == 't' && name[n - 2] == 'm' &&
        name[n - 1] == 'p') {
        isTemp = true;
        return nav_cache_parse_name(std::string(name.data(), n - 4), key);
    }
    return nav_cache_parse_name(name, key);
}

// What a file carries, decided by the SAME rules the reader applies: `check_header` is
// called with the key the file's own header declares, so its key test is a tautology while
// every other rule (magic, version, shape, section-vs-length agreement) is enforced here
// by the one function that defines it. No second copy of the policy to drift.
//
// A length that disagrees with the header's own declaration is the truncation signature —
// a crash mid-write, or a leftover from the pre-rename writer. It is junk, because no
// future read of it can succeed: `load_nav_cache*` rejects it on the exact-length check
// forever, so the bytes are pure waste and reclaiming them is free.
//
// "Junk" means unreadable BY THIS BUILD, deliberately: a wrong `kNavCacheVersion` or a
// different lattice/grid shape lands here too, and both are files this build will refuse on
// every future read while they sit on disk. Reclaiming them is the whole point of a version
// bump. Nothing is lost either way — every entry is a pure function of three numbers.
void classify_entry(const std::string& path, DirEntry& e) {
    e.junk = true;
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return;
    std::uint8_t hbuf[kNavCacheHeaderWire] = {};
    const bool got = read_exact(f, hbuf, sizeof(hbuf));
    std::fclose(f);
    if (!got) return;

    Header h{};
    Reader hr(hbuf, sizeof(hbuf));
    visit_header(hr, h);
    if (!hr.ok()) return;

    Layout lay;
    const NavCacheKey self{static_cast<int>(h.number),
                           static_cast<FloorKind>(static_cast<std::uint8_t>(h.kind)),
                           h.seed};
    if (check_header(h, self, lay) != NavCacheError::None) return;
    if (e.bytes != static_cast<std::uint64_t>(lay.total)) return;
    if (!lay.hasCoarse && !lay.hasFine) return; // header-only: nothing for any reader

    e.coarse = lay.hasCoarse;
    e.fine = lay.hasFine;
    e.junk = false;
}

// Enumerate `dir`, skipping everything that is not ours. False only when the directory
// cannot be opened at all — a missing cache dir is the ordinary cold start, not an error.
//
// The explicit `increment(ec)` loop is not stylistic: range-for over a
// `directory_iterator` advances through `operator++`, which reports failure by an
// exception this tree does not have. On a mid-walk failure the scan keeps what it has,
// which under-counts and therefore under-evicts — the safe direction.
bool scan_dir(const std::string& dir, std::vector<DirEntry>& out) {
    std::error_code ec;
    std::filesystem::directory_iterator it(
        dir, std::filesystem::directory_options::skip_permission_denied, ec);
    if (ec) return false;

    const std::filesystem::directory_iterator end;
    for (; it != end; it.increment(ec)) {
        if (ec) break;
        const std::filesystem::directory_entry& de = *it;

        std::error_code fec;
        if (!de.is_regular_file(fec) || fec) continue;
        const std::string name = de.path().filename().string();

        DirEntry e;
        bool isTemp = false;
        if (!owned_name(name, e.key, isTemp)) continue; // somebody else's file
        e.name = name;

        const std::uintmax_t sz = de.file_size(fec);
        if (fec) continue;
        e.bytes = static_cast<std::uint64_t>(sz);
        e.stamp = de.last_write_time(fec);
        if (fec) e.stamp = std::filesystem::file_time_type{};

        if (isTemp) e.junk = true;
        else classify_entry(dir + "/" + name, e);
        out.push_back(e);
    }
    return true;
}

// LRU order: oldest first, ties by name so the victim is deterministic and a test can
// assert WHICH entry went rather than only how many.
bool older_first(const DirEntry& a, const DirEntry& b) {
    if (a.stamp != b.stamp) return a.stamp < b.stamp;
    return a.name < b.name;
}

NavCacheUsage tally(const std::vector<DirEntry>& v) {
    NavCacheUsage u;
    for (const DirEntry& e : v) {
        if (e.gone) continue;
        ++u.files;
        u.bytes += e.bytes;
        if (e.junk) {
            ++u.junkFiles;
        } else if (e.fine) {
            ++u.fineFiles;
            u.fineBytes += e.bytes;
        } else {
            ++u.coarseFiles;
        }
    }
    return u;
}

// Rewrite a full entry as its coarse section alone, preserving its LRU stamp — being
// evicted is not the same as being used, and a downgraded entry that looked freshly used
// would corrupt the next sweep's ordering.
//
// False when the coarse half will not decode: a fine-only blob (no coarse section), a key
// whose header disagrees with its filename, or bit rot the CRC catches. The caller then
// deletes the file, which is right — an entry that can give a reader nothing is not worth
// 13 KB either.
bool downgrade_to_coarse(const std::string& path, const NavCacheKey& key,
                         std::filesystem::file_time_type stamp) {
    nav::CoarseGraph g{};
    if (!load_nav_cache_sections(path, key.number, key.kind, key.seed, &g, nullptr,
                                 nullptr))
        return false;

    std::vector<std::uint8_t> stub;
    nav_cache_write(key, &g, nullptr, stub);
    if (stub.size() != kNavCacheCoarseOnlyWire) return false;
    if (!write_atomic(path, stub.data(), stub.size(), nullptr, 0, nullptr, 0)) return false;

    std::error_code ec;
    std::filesystem::last_write_time(path, stamp, ec); // best effort: LRU only
    return true;
}

} // namespace

const char* nav_cache_error_text(NavCacheError e) {
    switch (e) {
        case NavCacheError::None: return "ok";
        case NavCacheError::TooShort: return "file ends before the format does";
        case NavCacheError::BadMagic: return "not a gigahrush2 nav cache";
        case NavCacheError::BadVersion: return "written by a different build";
        case NavCacheError::KeyMismatch: return "cached a different floor";
        case NavCacheError::ShapeMismatch: return "different lattice or grid size";
        case NavCacheError::SizeMismatch: return "section length disagrees with build";
        case NavCacheError::MissingSection: return "blob lacks a requested section";
        case NavCacheError::BadChecksum: return "coarse graph corrupt";
        case NavCacheError::NoFile: return "no cache file yet";
        case NavCacheError::Count: break;
    }
    return "unknown";
}

std::string nav_cache_name(const NavCacheKey& key) {
    // The leading tag keeps a cache directory human-scannable, and %d (not %u) is what
    // makes floor -3 read as "nav_f-3_..." instead of as a 10-digit unsigned.
    // 64 bytes is comfortably enough: the longest reachable expansion is
    // "nav_f-2147483648_k255_sffffffff.bin" at 35 characters. The %u field cannot reach
    // 10 digits — FloorKind's underlying type is std::uint8_t ([game/floor_spec.h]), so
    // the widened cast tops out at 255. [tests/suite_navcache.inl] pins that 35.
    char buf[64];
    std::snprintf(buf, sizeof(buf), "nav_f%d_k%u_s%08x.bin", key.number,
                  static_cast<unsigned>(key.kind), static_cast<unsigned>(key.seed));
    return std::string(buf);
}

std::string nav_cache_name(int number, FloorKind kind, std::uint32_t seed) {
    return nav_cache_name(NavCacheKey{number, kind, seed});
}

bool nav_cache_parse_name(const std::string& name, NavCacheKey& out) {
    const char* p = name.c_str();
    const std::size_t n = name.size();
    std::size_t at = 0;

    // `at <= n` holds at every call, so `n - at` never wraps.
    auto eat = [&](const char* lit, std::size_t len) {
        if (n - at < len) return false;
        for (std::size_t i = 0; i < len; ++i)
            if (p[at + i] != lit[i]) return false;
        at += len;
        return true;
    };

    if (!eat("nav_f", 5)) return false;

    // The floor number, signed. Bounded during the digit walk so a 40-digit name cannot
    // overflow its way to a plausible key — signed overflow would be undefined, and this
    // function's whole job is to be trustworthy enough to delete a file on.
    bool neg = false;
    if (at < n && p[at] == '-') {
        neg = true;
        ++at;
    }
    const std::size_t numAt = at;
    std::int64_t num = 0;
    while (at < n && p[at] >= '0' && p[at] <= '9') {
        num = num * 10 + static_cast<std::int64_t>(p[at] - '0');
        if (num > 2147483648LL) return false;
        ++at;
    }
    if (at == numAt) return false;                 // "nav_f_k0_..." has no number
    if (!neg && num > 2147483647LL) return false;  // +2^31 is not an int

    if (!eat("_k", 2)) return false;
    const std::size_t kindAt = at;
    std::uint32_t kind = 0;
    while (at < n && p[at] >= '0' && p[at] <= '9') {
        kind = kind * 10u + static_cast<std::uint32_t>(p[at] - '0');
        if (kind > 255u) return false; // FloorKind is std::uint8_t ([game/floor_spec.h])
        ++at;
    }
    if (at == kindAt) return false;

    if (!eat("_s", 2)) return false;
    if (n - at < 8) return false;
    std::uint32_t seed = 0;
    for (std::size_t i = 0; i < 8; ++i) {
        const char c = p[at + i];
        std::uint32_t d = 0;
        if (c >= '0' && c <= '9') d = static_cast<std::uint32_t>(c - '0');
        else if (c >= 'a' && c <= 'f') d = static_cast<std::uint32_t>(c - 'a') + 10u;
        else return false; // %08x writes lower case, so an upper-case digit is not ours
        seed = (seed << 4) | d;
    }
    at += 8;

    if (!eat(".bin", 4)) return false;
    if (at != n) return false; // trailing anything: not ours

    const NavCacheKey key{neg ? static_cast<int>(-num) : static_cast<int>(num),
                          static_cast<FloorKind>(static_cast<std::uint8_t>(kind)), seed};
    // The entire safety argument, in one line: a name is ours only if we would have
    // written exactly it. A leading '+', a short seed field, upper-case hex and "-0" all
    // survive the grammar above and all die here.
    if (nav_cache_name(key) != name) return false;
    out = key;
    return true;
}

std::size_t nav_cache_bytes(std::uint32_t sections) {
    if (sections == 0) return 0;
    std::size_t n = kNavCacheHeaderWire;
    if (sections & kNavSectionCoarse) n += kNavCoarseWire;
    if (sections & kNavSectionFine) n += kNavFineWire;
    if (sections & kNavSectionNearest) n += kNavNearestWire;
    return n;
}

void nav_cache_write(const NavCacheKey& key, const nav::CoarseGraph* coarse,
                     const nav::FineNav* fine, std::vector<std::uint8_t>& out) {
    out.clear();

    // Refusing a half-baked FineNav costs nothing; writing it would produce a file that
    // looks valid to `ls` and is rejected on the length check a session later, which is a
    // much worse bug report.
    if (fine != nullptr && !fine_is_complete(*fine)) return;

    std::uint32_t sections = 0;
    if (coarse != nullptr) sections |= kNavSectionCoarse;
    if (fine != nullptr) sections |= kNavSectionFineAll;

    write_prologue(key, sections, coarse, nav_cache_bytes(sections), out);
    // Bulk, not byte-at-a-time: these ARE bytes, so there is no byte order to impose and
    // memcpy semantics cost nothing in portability. 130 MiB through push_back would be
    // 136 M bounds checks for an identity transform.
    if (fine != nullptr) {
        out.insert(out.end(), fine->flow.begin(), fine->flow.end());
        out.insert(out.end(), fine->nearest.begin(), fine->nearest.end());
    }
}

bool nav_cache_read(const std::uint8_t* bytes, std::size_t n, const NavCacheKey& key,
                    nav::CoarseGraph* coarse, nav::FineNav* fine, NavCacheError* err) {
    if (err) *err = NavCacheError::None;
    auto fail = [err](NavCacheError e) {
        if (err) *err = e;
        return false;
    };

    if (bytes == nullptr || n < kNavCacheHeaderWire) return fail(NavCacheError::TooShort);

    Header h{};
    Reader hr(bytes, kNavCacheHeaderWire);
    visit_header(hr, h);
    if (!hr.ok()) return fail(NavCacheError::TooShort);

    Layout lay;
    const NavCacheError bad = check_header(h, key, lay);
    if (bad != NavCacheError::None) return fail(bad);

    if (n < lay.total) return fail(NavCacheError::TooShort);

    // A caller asking for a section the blob does not carry gets told so, and gets its
    // outputs left alone. The alternative — zero-filling the missing one — is the
    // plausible-looking lie check_header refuses to write.
    if (coarse != nullptr && !lay.hasCoarse) return fail(NavCacheError::MissingSection);
    if (fine != nullptr && !lay.hasFine) return fail(NavCacheError::MissingSection);

    if (lay.hasCoarse && crc32(bytes + lay.coarseAt, kNavCoarseWire) != h.coarseCrc)
        return fail(NavCacheError::BadChecksum);

    // Every check has passed, so from here nothing can fail and the read is all-or-
    // nothing by construction rather than by unwinding.
    if (coarse != nullptr) {
        Reader br(bytes + lay.coarseAt, kNavCoarseWire);
        visit_coarse(br, *coarse);
    }
    if (fine != nullptr) {
        fine->flow.assign(bytes + lay.fineAt, bytes + lay.fineAt + kNavFineWire);
        fine->nearest.assign(bytes + lay.nearestAt,
                             bytes + lay.nearestAt + kNavNearestWire);
    }
    return true;
}

bool save_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, const nav::CoarseGraph& coarse,
                    const nav::FineNav& fine, const NavCachePolicy& policy) {
    // Checked before a file exists, so a mid-bake nav does not touch the previous good
    // cache for this key.
    if (!fine_is_complete(fine)) return false;

    // Best-effort parent-dir creation via the error_code overload (never throws, so it is
    // fine under -fno-exceptions). If the dir truly cannot be made, the fopen below fails
    // and we return false.
    std::filesystem::path p(path);
    if (p.has_parent_path()) {
        std::error_code ec;
        std::filesystem::create_directories(p.parent_path(), ec);
    }

    // 13,108 bytes, not 136,327,988: the two big sections go straight from the caller's
    // vectors to the file. A `nav_cache_write` into a buffer would have doubled the peak
    // footprint of a 130 MiB nav for no gain.
    const NavCacheKey key{number, kind, seed};
    std::vector<std::uint8_t> prologue;
    write_prologue(key, kNavSectionAll, &coarse, kNavCacheHeaderWire + kNavCoarseWire,
                   prologue);

    // Temp-then-rename, so a write interrupted by a crash no longer destroys the good file
    // that was there — and its leftover is reclaimed by the sweep below on the next save,
    // instead of occupying 136 MB that nothing would ever read again.
    if (!write_atomic(path, prologue.data(), prologue.size(), fine.flow.data(),
                      fine.flow.size(), fine.nearest.data(), fine.nearest.size()))
        return false;

    // The directory just grew by 136 MB, so bound it here rather than hoping a caller
    // remembers to. `key` is pinned: the sweep must never evict the floor whose nav the
    // caller is loading at this instant.
    nav_cache_evict(parent_dir_of(path), policy, &key);
    return true;
}

bool load_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, nav::CoarseGraph& coarse, nav::FineNav& fine,
                    NavCacheError* err) {
    // One implementation, both contracts: asking for both halves is exactly the old
    // whole-nav read, `MissingSection` on a coarse-only blob included.
    return load_nav_cache_sections(path, number, kind, seed, &coarse, &fine, err);
}

bool load_nav_cache_sections(const std::string& path, int number, FloorKind kind,
                             std::uint32_t seed, nav::CoarseGraph* coarse,
                             nav::FineNav* fine, NavCacheError* err) {
    if (err) *err = NavCacheError::None;
    auto fail = [err](NavCacheError e) {
        if (err) *err = e;
        return false;
    };

    // Asking for nothing is a caller bug rather than a cheap validation: reporting on a
    // file without decoding it is what `nav_cache_usage` does.
    if (coarse == nullptr && fine == nullptr) return fail(NavCacheError::MissingSection);

    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return fail(NavCacheError::NoFile); // the ordinary cold-start miss

    std::uint8_t hbuf[kNavCacheHeaderWire] = {};
    if (!read_exact(f, hbuf, sizeof(hbuf))) {
        std::fclose(f);
        return fail(NavCacheError::TooShort);
    }

    Header h{};
    Reader hr(hbuf, sizeof(hbuf));
    visit_header(hr, h);
    if (!hr.ok()) {
        std::fclose(f);
        return fail(NavCacheError::TooShort);
    }

    Layout lay;
    const NavCacheError bad = check_header(h, NavCacheKey{number, kind, seed}, lay);
    if (bad != NavCacheError::None) {
        std::fclose(f);
        return fail(bad);
    }
    // Only what was asked for. A coarse-only blob is a legal format and a perfectly good
    // answer to a `(&coarse, nullptr)` call — that is what an evicted entry is — while it
    // is still `MissingSection` to anyone who wanted the flow fields.
    if ((coarse != nullptr && !lay.hasCoarse) || (fine != nullptr && !lay.hasFine)) {
        std::fclose(f);
        return fail(NavCacheError::MissingSection);
    }

    // Length checked from the directory entry BEFORE anything is read into the caller's
    // vectors, so the common truncation case (a crash mid-write) is rejected while both
    // outputs are still untouched. An exact match, not >=: trailing bytes mean the file
    // is not what this header describes either.
    std::error_code ec;
    const std::uintmax_t onDisk = std::filesystem::file_size(path, ec);
    if (ec || onDisk != static_cast<std::uintmax_t>(lay.total)) {
        std::fclose(f);
        return fail(NavCacheError::TooShort);
    }

    // Decode the coarse graph into a LOCAL, so a later I/O failure cannot leave the
    // caller holding half a graph. 13 KB on the stack of a load path is free.
    //
    // Read and checksummed whenever the blob CARRIES one, even for a caller that only
    // wants the flow fields: it is 13,056 bytes, it is the format's only content check,
    // and reading it is also what advances the file position to `fineAt` — so this path
    // needs no seek, and there is no offset arithmetic to get wrong.
    nav::CoarseGraph decoded{};
    if (lay.hasCoarse) {
        std::vector<std::uint8_t> cbuf;
        cbuf.resize(kNavCoarseWire);
        if (!read_exact(f, cbuf.data(), cbuf.size())) {
            std::fclose(f);
            return fail(NavCacheError::TooShort);
        }
        if (crc32(cbuf.data(), cbuf.size()) != h.coarseCrc) {
            std::fclose(f);
            return fail(NavCacheError::BadChecksum);
        }
        Reader br(cbuf.data(), cbuf.size());
        visit_coarse(br, decoded);
    }

    // Now the 130 MiB, read straight into the caller's vectors — the whole reason this
    // wrapper exists rather than a `nav_cache_read` over a file-sized buffer. If the
    // medium fails here (it cannot be truncation: the length matched above) `fine` is
    // left unspecified and `coarse` untouched; the caller re-bakes, which overwrites
    // both. A coarse-only caller never reaches this and never allocates it.
    bool ok = true;
    if (fine != nullptr) {
        fine->flow.assign(kNavFineWire, 0u);
        fine->nearest.assign(kNavNearestWire, 0u);
        ok = read_exact(f, fine->flow.data(), fine->flow.size()) &&
             read_exact(f, fine->nearest.data(), fine->nearest.size());
    }
    std::fclose(f);
    if (!ok) return fail(NavCacheError::TooShort);

    if (coarse != nullptr) *coarse = decoded;

    // A hit is a USE, and this is the clock `nav_cache_evict` orders victims by. mtime and
    // not atime because NTFS disables last-access updates by default, so atime would rank
    // a floor the player just visited alongside one they have never opened. Best effort: a
    // read-only cache directory still serves hits, it just stops re-ordering them.
    std::error_code tec;
    std::filesystem::last_write_time(path, std::filesystem::file_time_type::clock::now(),
                                     tec);
    return true;
}

NavCacheUsage nav_cache_usage(const std::string& dir) {
    std::vector<DirEntry> files;
    scan_dir(dir, files); // a missing directory reports an empty, all-zero usage
    return tally(files);
}

NavCacheSweep nav_cache_evict(const std::string& dir, const NavCachePolicy& policy,
                              const NavCacheKey* keep) {
    NavCacheSweep sw;
    std::vector<DirEntry> files;
    if (!scan_dir(dir, files)) return sw; // no such directory: nothing to bound
    sw.before = tally(files);

    // Oldest first, so "the first candidate in the list" IS the least-recently-used one
    // and no pass has to re-derive the order.
    std::sort(files.begin(), files.end(), older_first);

    const auto pinned = [keep](const DirEntry& e) {
        return keep != nullptr && e.key.number == keep->number &&
               e.key.kind == keep->kind && e.key.seed == keep->seed;
    };
    const auto drop = [&](DirEntry& e) {
        std::remove((dir + "/" + e.name).c_str());
        e.gone = true;
        sw.bytesReclaimed += e.bytes;
    };

    // Running totals rather than a re-tally per iteration: the pathological case for the
    // stub cap is thousands of entries, and an O(n^2) sweep on a load path is exactly the
    // kind of thing that gets discovered as a stall much later.
    std::uint64_t fineBytes = sw.before.fineBytes;
    int stubs = sw.before.coarseFiles;

    // 1. Junk, unconditionally and BEFORE any LRU decision — so a file truncated by the
    //    crash that just happened cannot cost a good entry its fine half. Not pinned-
    //    exempt: an unreadable file is of no use to the pinning caller either, and this is
    //    the only path that ever reclaims a leftover `.tmp` or a pre-rename corpse.
    for (DirEntry& e : files) {
        if (e.gone || !e.junk) continue;
        drop(e);
        ++sw.junkRemoved;
    }

    // 2. The fine budget, LRU, by DOWNGRADE rather than delete: 136,327,988 -> 13,108 B
    //    keeps the section that replaces about half the bake for 0.0096 % of the bytes.
    while (fineBytes > policy.fineBudgetBytes) {
        DirEntry* victim = nullptr;
        for (DirEntry& e : files) {
            if (e.gone || e.junk || !e.fine || pinned(e)) continue;
            victim = &e;
            break;
        }
        if (victim == nullptr) {
            // Only the pinned entry is left and it is still over budget. Reported, not
            // hidden: a bound that silently gives up is worse than a bound that says so.
            sw.overBudget = true;
            break;
        }
        const std::uint64_t was = victim->bytes;
        if (downgrade_to_coarse(dir + "/" + victim->name, victim->key, victim->stamp)) {
            victim->bytes = static_cast<std::uint64_t>(kNavCacheCoarseOnlyWire);
            victim->fine = false;
            victim->coarse = true;
            sw.bytesReclaimed += was - victim->bytes;
            ++sw.downgraded;
            ++stubs;
        } else {
            // Its coarse half will not decode, so it is junk in the one sense that matters
            // — no reader can get anything out of it — and it is counted as such.
            drop(*victim);
            ++sw.junkRemoved;
        }
        fineBytes -= was;
    }

    // 3. The stub cap. Reached only past maxCoarseStubs (512 > the 255 legal floor labels),
    //    and it is what makes the total bounded in the SEED axis rather than only in the
    //    floor axis.
    while (stubs > policy.maxCoarseStubs) {
        DirEntry* victim = nullptr;
        for (DirEntry& e : files) {
            if (e.gone || e.junk || e.fine || pinned(e)) continue;
            victim = &e;
            break;
        }
        if (victim == nullptr) {
            sw.overBudget = true;
            break;
        }
        drop(*victim);
        ++sw.stubsRemoved;
        --stubs;
    }

    // Re-measured from the filesystem, not derived from the loops above, so a sweep cannot
    // report a bound it did not actually achieve.
    std::vector<DirEntry> post;
    scan_dir(dir, post);
    sw.after = tally(post);
    return sw;
}

} // namespace giga::game
