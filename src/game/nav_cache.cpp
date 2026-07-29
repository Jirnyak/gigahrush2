#include "game/nav_cache.h"

#include <cstdio>      // snprintf (formatting) + fopen/fread/fwrite/fclose/remove
#include <filesystem>  // create_directories / file_size — error_code overloads only
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
                    const nav::FineNav& fine) {
    // Checked before a file exists, so a mid-bake nav does not truncate the previous
    // good cache for this key.
    if (!fine_is_complete(fine)) return false;

    // Best-effort parent-dir creation via the error_code overload (never throws, so it is
    // fine under -fno-exceptions). If the dir truly cannot be made, the fopen below fails
    // and we return false.
    std::filesystem::path p(path);
    if (p.has_parent_path()) {
        std::error_code ec;
        std::filesystem::create_directories(p.parent_path(), ec);
    }

    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;

    // 13,108 bytes, not 136,327,988: the two big sections go straight from the caller's
    // vectors to the file. A `nav_cache_write` into a buffer would have doubled the peak
    // footprint of a 130 MiB nav for no gain.
    std::vector<std::uint8_t> prologue;
    write_prologue(NavCacheKey{number, kind, seed}, kNavSectionAll, &coarse,
                   kNavCacheHeaderWire + kNavCoarseWire, prologue);

    const bool ok = write_exact(f, prologue.data(), prologue.size()) &&
                    write_exact(f, fine.flow.data(), fine.flow.size()) &&
                    write_exact(f, fine.nearest.data(), fine.nearest.size());
    std::fclose(f);
    if (!ok) std::remove(path.c_str()); // no truncated file left behind
    return ok;
}

bool load_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, nav::CoarseGraph& coarse, nav::FineNav& fine,
                    NavCacheError* err) {
    if (err) *err = NavCacheError::None;
    auto fail = [err](NavCacheError e) {
        if (err) *err = e;
        return false;
    };

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
    // This wrapper's contract is a whole nav; a coarse-only blob is a legal format but
    // not an answer to this call. The buffer API is where section picking lives.
    if (!lay.hasCoarse || !lay.hasFine) {
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
    nav::CoarseGraph decoded{};
    Reader br(cbuf.data(), cbuf.size());
    visit_coarse(br, decoded);

    // Now the 130 MiB, read straight into the caller's vectors — the whole reason this
    // wrapper exists rather than a `nav_cache_read` over a file-sized buffer. If the
    // medium fails here (it cannot be truncation: the length matched above) `fine` is
    // left unspecified and `coarse` untouched; the caller re-bakes, which overwrites
    // both.
    fine.flow.assign(kNavFineWire, 0u);
    fine.nearest.assign(kNavNearestWire, 0u);
    const bool ok = read_exact(f, fine.flow.data(), fine.flow.size()) &&
                    read_exact(f, fine.nearest.data(), fine.nearest.size());
    std::fclose(f);
    if (!ok) return fail(NavCacheError::TooShort);

    coarse = decoded;
    return true;
}

} // namespace giga::game
