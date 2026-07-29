#include "game/nav_cache.h"

#include <cstdio>
#include <filesystem>
#include <system_error>

#include "world/types.h" // giga::kMacroCells

namespace giga::game {
namespace {

// Bump whenever the on-disk layout OR the bake algorithm changes, so caches from
// an older build are rejected rather than silently trusted.
inline constexpr std::uint32_t kNavCacheVersion = 1;
inline constexpr char kNavCacheMagic[8] = {'G', 'H', 'N', 'A', 'V', 'B', 'K', '1'};

// Fixed-layout file header. All sizes are validated on load against the current
// build's constants, so a cache made by a differently-shaped binary is rejected.
struct Header {
    char magic[8];
    std::uint32_t version;
    std::int32_t number; // floor numbers can be negative (floors below ground)
    std::uint32_t kind;
    std::uint32_t seed;
    std::uint32_t nodes;
    std::uint64_t coarseBytes;
    std::uint64_t flowBytes;
    std::uint64_t nearestBytes;
};

bool read_exact(std::FILE* f, void* dst, std::size_t n) {
    return std::fread(dst, 1, n, f) == n;
}
bool write_exact(std::FILE* f, const void* src, std::size_t n) {
    return std::fwrite(src, 1, n, f) == n;
}

} // namespace

std::string nav_cache_name(int number, FloorKind kind, std::uint32_t seed) {
    // e.g. "nav_f-3_k2_s0000162e.bin"; the leading tag keeps it human-scannable.
    char buf[64];
    std::snprintf(buf, sizeof(buf), "nav_f%d_k%u_s%08x.bin", number,
                  static_cast<unsigned>(kind), static_cast<unsigned>(seed));
    return std::string(buf);
}

bool save_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, const nav::CoarseGraph& coarse,
                    const nav::FineNav& fine) {
    // Best-effort parent-dir creation via the error_code overload (never throws,
    // so it is fine under -fno-exceptions). If the dir truly cannot be made, the
    // fopen below fails and we return false.
    std::filesystem::path p(path);
    if (p.has_parent_path()) {
        std::error_code ec;
        std::filesystem::create_directories(p.parent_path(), ec);
    }

    std::FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;

    Header h{};
    for (int i = 0; i < 8; ++i) h.magic[i] = kNavCacheMagic[i];
    h.version = kNavCacheVersion;
    h.number = number;
    h.kind = static_cast<std::uint32_t>(kind);
    h.seed = seed;
    h.nodes = static_cast<std::uint32_t>(nav::kNodes);
    h.coarseBytes = sizeof(nav::CoarseGraph);
    h.flowBytes = fine.flow.size();
    h.nearestBytes = fine.nearest.size();

    const bool ok = write_exact(f, &h, sizeof(h)) &&
                    write_exact(f, &coarse, sizeof(coarse)) &&
                    write_exact(f, fine.flow.data(), fine.flow.size()) &&
                    write_exact(f, fine.nearest.data(), fine.nearest.size());
    std::fclose(f);
    if (!ok) std::remove(path.c_str()); // no truncated file left behind
    return ok;
}

bool load_nav_cache(const std::string& path, int number, FloorKind kind,
                    std::uint32_t seed, nav::CoarseGraph& coarse,
                    nav::FineNav& fine) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;

    Header h{};
    if (!read_exact(f, &h, sizeof(h))) {
        std::fclose(f);
        return false;
    }

    bool magicOk = true;
    for (int i = 0; i < 8; ++i)
        magicOk = magicOk && h.magic[i] == kNavCacheMagic[i];
    const std::uint64_t flowExpect =
        static_cast<std::uint64_t>(nav::kNodes) * kMacroCells;
    // Reject anything that is not this exact build's bake of this exact floor.
    if (!magicOk || h.version != kNavCacheVersion || h.number != number ||
        h.kind != static_cast<std::uint32_t>(kind) || h.seed != seed ||
        h.nodes != static_cast<std::uint32_t>(nav::kNodes) ||
        h.coarseBytes != sizeof(nav::CoarseGraph) || h.flowBytes != flowExpect ||
        h.nearestBytes != kMacroCells) {
        std::fclose(f);
        return false;
    }

    fine.flow.assign(h.flowBytes, 0);
    fine.nearest.assign(h.nearestBytes, 0);
    const bool ok = read_exact(f, &coarse, sizeof(coarse)) &&
                    read_exact(f, fine.flow.data(), fine.flow.size()) &&
                    read_exact(f, fine.nearest.data(), fine.nearest.size());
    std::fclose(f);
    return ok;
}

} // namespace giga::game
