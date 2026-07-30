#include "render/cube_pass.h"

#include "render/cube_merge.h"
#include "render/vk_common.h"
#include "render/vk_device.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "core/jobs.h" // parallel_for — classify() is bake work, not tick work
#include "world/materials.h"
#include "world/world.h"

namespace giga::gpu {

namespace {

struct CubeVertex {
    vec3 pos;
    vec3 normal;
};

// 6 faces * 2 triangles * 3 verts = 36 vertices of a unit cube [0,1]^3, each
// carrying its outward face normal. Counter-clockwise winding when viewed from
// outside (front face = CCW to match the pipeline).
void build_unit_cube(std::vector<CubeVertex>& out) {
    struct Face { vec3 n; vec3 a, b, c, d; };
    const Face faces[6] = {
        // +X
        {{1, 0, 0}, {1, 0, 0}, {1, 1, 0}, {1, 1, 1}, {1, 0, 1}},
        // -X
        {{-1, 0, 0}, {0, 0, 0}, {0, 0, 1}, {0, 1, 1}, {0, 1, 0}},
        // +Y
        {{0, 1, 0}, {0, 1, 0}, {0, 1, 1}, {1, 1, 1}, {1, 1, 0}},
        // -Y
        {{0, -1, 0}, {0, 0, 0}, {1, 0, 0}, {1, 0, 1}, {0, 0, 1}},
        // +Z
        {{0, 0, 1}, {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1}},
        // -Z
        {{0, 0, -1}, {0, 0, 0}, {0, 1, 0}, {1, 1, 0}, {1, 0, 0}},
    };
    for (const auto& f : faces) {
        out.push_back({f.a, f.n});
        out.push_back({f.b, f.n});
        out.push_back({f.c, f.n});
        out.push_back({f.a, f.n});
        out.push_back({f.c, f.n});
        out.push_back({f.d, f.n});
    }
}

// Albedo per material id ([world/materials.h]), in **display-referred** values —
// cube.frag linearises once with pow(2.2) before lighting, so these are what you
// would pick in a colour picker, not linear.
//
// The industrial half is MEASURED, not chosen: each value is the mean albedo of a
// real 2 K photograph (Poly Haven, CC0), measured after linearising and converted
// back for this table. data/materials.csv carries the source URL, the linear mean
// and the luminance variance for every one, produced by tools/measure_materials.py.
// The residential half is authored, because the pack has no wallpaper, parquet,
// plaster or linoleum.
//
// Why bother measuring: hand-picked albedos drift bright and desaturated, which is
// exactly how "flat painted cubes" looks. Real rust is darker and far more
// saturated than anyone guesses.
constexpr vec3 kMaterial[kMatCount] = {
    /*  0 air, never drawn      */ {0.00f, 0.00f, 0.00f},
    /*  1 concrete (maze)       */ {0.45f, 0.42f, 0.40f},
    /*  2 soil (maze)           */ {0.30f, 0.55f, 0.25f},
    /*  3 water marker (maze)   */ {0.20f, 0.35f, 0.80f},
    /*  4 tan slab (maze)       */ {0.70f, 0.60f, 0.35f},
    /*  5 extraction pad        */ {0.10f, 0.85f, 0.42f}, // the bank: saturated
                                                         // emerald, unmistakable
                                                         // against a palette of
                                                         // rust, tan and grey —
                                                         // and NOT red, which is
                                                         // reserved for danger
                                                         // ([faction.h])
    /*  6 door leaf + frame     */ {0.20f, 0.31f, 0.58f}, // painted steel, the
                                                         // stairwell blue every
                                                         // khrushchevka entrance
                                                         // door is primed in. The
                                                         // one hue no interior
                                                         // material uses: the
                                                         // palette is plaster,
                                                         // parquet, greys, greens
                                                         // and four browns, and
                                                         // red is danger
                                                         // ([faction.h]), emerald
                                                         // the bank, cyan the nav
                                                         // pad. Family 0 (flat) in
                                                         // material_surface.glsl,
                                                         // so it reads as paint
                                                         // against mottled plaster
    /*  7 nav / hub pad         */ {0.00f, 0.80f, 0.95f},
    // --- khrushchevka ---
    /*  8 plaster    authored   */ {0.72f, 0.69f, 0.62f}, // dirty warm whitewash
    /*  9 parquet    authored   */ {0.52f, 0.36f, 0.19f}, // dark varnished wood
    /* 10 shop shutter  measured*/ {0.50f, 0.52f, 0.53f}, // painted_metal_shutter
    /* 11 lino          measured*/ {0.13f, 0.13f, 0.15f}, // rubber_tiles, near-black
    /* 12 factory wall  measured*/ {0.39f, 0.46f, 0.30f}, // factory_wall, green paint
    /* 13 tread plate   measured*/ {0.52f, 0.33f, 0.20f}, // metal_grate_rusty
    /* 14 rust          measured*/ {0.53f, 0.34f, 0.10f}, // rusty_metal_03
    /* 15 rubble        measured*/ {0.35f, 0.17f, 0.11f}, // rusty_corrugated_iron
    /* 16 electric grate        */ {0.85f, 0.80f, 0.20f}, // yellow-sparking electrical grate
    /* 17 acid pool             */ {0.20f, 0.85f, 0.15f}, // glowing acid green
    /* 18 fire cell             */ {0.90f, 0.30f, 0.05f}, // fiery orange-red
};
static_assert(sizeof(kMaterial) / sizeof(kMaterial[0]) == kMatCount,
              "one albedo row per material id in world/materials.h");

vec3 type_color(CellType t) {
    // Unknown ids render as the old default rather than black, so a generator that
    // writes a material the table does not know is visible but not invisible.
    return t < kMatCount ? kMaterial[t] : vec3{0.75f, 0.75f, 0.78f};
}

// --- photographic albedo ----------------------------------------------------
// The SECOND per-material table in this file, deliberately next to the first:
// which photograph in data/textures is a material's real albedo. Six rows,
// because six is how many of the sixteen ids the pack covers.
//
// AUTHORITY for this binding is the MATERIALS table in
// tools/gen_material_surface.py — the same table that decides each material's
// surface family and its measured sigma — and data/textures/README.md restates it.
// The other ten files in that pack (blue_metal_plate, corrugated_iron, ...) are
// bound to NOTHING: they were harvested for equipment casings and prop panels, and
// pointing an unbound cell material at one just because the counts happen to match
// is explicitly warned against there. Ids 1..9 stay authored because the pack has
// no plaster, wood, lino or concrete photograph, and 0/5/6/7 are air, signage and
// door paint.
//
// This IS a hand-written table and the data-driven rule says content belongs in a
// CSV plus a generator. What is hand-written here is six filenames, i.e. a
// resource binding, not content — but the drift it can suffer is real (rename a
// file in the pack and this goes quiet at build time and loud only at startup), so
// the mechanical check for it belongs in tools/check_source_rules.cmake next to
// the other generated-table drift rules. That is reported, not done, because that
// file is not this lane's.
struct MaterialMap {
    CellType id;
    const char* file;
};
constexpr MaterialMap kMaterialMaps[] = {
    {kMatShopShutter, "painted_metal_shutter.ktx2"},
    {kMatLino, "rubber_tiles.ktx2"},
    {kMatFactoryWall, "factory_wall.ktx2"},
    {kMatTread, "metal_grate_rusty.ktx2"},
    {kMatRust, "rusty_metal_03.ktx2"},
    {kMatRubble, "rusty_corrugated_iron.ktx2"},
};
inline constexpr int kMaterialMapCount =
    static_cast<int>(sizeof(kMaterialMaps) / sizeof(kMaterialMaps[0]));
// The array layer index IS the material id, so an id past the end of the array
// would index a layer that does not exist. Caught here rather than by a Vulkan
// validation message at load time.
constexpr bool material_maps_in_range() {
    for (const MaterialMap& m : kMaterialMaps)
        if (m.id >= kMatCount) return false;
    return true;
}
static_assert(material_maps_in_range(),
              "every textured material id must be < kMatCount — the albedo array "
              "is indexed by the id directly, with no mapping table");

// Where the pack lives on disk. A compile definition rather than a runtime search,
// exactly like GIGA_SHADER_DIR — the fallback below is a relative path and is only
// correct when the process happens to run from the repo root, so a build without
// the definition is a build that has to be told. The environment variable is the
// override that lets a packaged build point somewhere else without a rebuild.
#ifndef GIGA_TEXTURE_DIR
#define GIGA_TEXTURE_DIR "data/textures"
#endif

// The pack's shape, and every one of these is CHECKED rather than trusted:
// load_layer() rejects a file whose dimensions or level count differ, naming it.
// Measured across all six committed files (one byte-identical header signature):
// 2048x2048, levelCount 12, 4x4 blocks, 16 bytes/block, one RGB sample.
inline constexpr std::uint32_t kAlbedoDim = 2048;
constexpr std::uint32_t mip_count(std::uint32_t dim) {
    std::uint32_t n = 1;
    while (dim > 1) {
        dim >>= 1;
        ++n;
    }
    return n;
}
inline constexpr std::uint32_t kAlbedoMips = mip_count(kAlbedoDim);
static_assert(kAlbedoMips == 12,
              "the committed pack carries a full 12-level chain from 2048 to 1x1; "
              "a different count means the pack changed and every level offset in "
              "data/textures/README.md with it");

// Display-referred to linear with the SAME curve shaders/cube.frag uses — plain
// pow(2.2), NOT the piecewise sRGB transfer function. They have to agree, or the
// ratio below stops being exactly 1 for an untinted cell.
float to_linear(float v) { return std::pow(v, 2.2f); }

// The linear multiplier a TEXTURED instance carries in CubeInstance::color.
//
// Exactly {1,1,1} for an untinted cell — short-circuited rather than computed, so
// the common path pays no pow() and the identity is exact by construction instead
// of by floating-point luck. For a flooded cell it is the per-channel ratio of the
// tinted colour to the material's own mean albedo, which is what survives the
// sampled texel replacing that mean. The max() guards a material whose table entry
// has a zero channel; none of ids 10..15 does today (the smallest is lino's 0.13).
vec3 tint_multiplier(const vec3& base, const vec3& tinted) {
    return vec3{to_linear(tinted.x) / std::max(to_linear(base.x), 1e-4f),
                to_linear(tinted.y) / std::max(to_linear(base.y), 1e-4f),
                to_linear(tinted.z) / std::max(to_linear(base.z), 1e-4f)};
}

// Where the material id rides inside CubeInstance::occ. The AO mask occupies bits
// 0..26, so bits 27..31 were already allocated and unused; putting the id there is
// what makes per-material surfaces cost zero extra bytes per instance.
//
// Five bits hold 0..31 against kMatCount == 16. The static_assert is the guard that
// matters: extend materials.h past 32 ids and the build stops here rather than
// wrapping the id into the AO mask, which would corrupt the occlusion of every cell
// of the new material and look like an unrelated shading bug.
//
// The shift itself now lives in render/cube_merge.h, because the merge has to know
// which bits are the material id in order to refuse to merge across one. Kept
// visible under the old name here so the reference in cube.vert still resolves.
static_assert(kMatCount <= (1u << (32 - kMatIdShift)),
              "material ids no longer fit in the spare high bits of CubeInstance::occ "
              "— widen the field or add an attribute, do not let it wrap into the AO "
              "mask");

// Unknown ids fall back to 0, whose family in shaders/material_surface.glsl is the
// generic pre-existing surface. Matches type_color()'s spirit: an id the tables do
// not know renders as something plain, never as garbage.
std::uint32_t surface_id(CellType t) {
    return t < kMatCount ? static_cast<std::uint32_t>(t) : 0u;
}

// --- occupancy bitmaps -----------------------------------------------------
// One bit per macro cell, 256 KB each, for "fully solid" and "not empty".
//
// Why they exist rather than reading SubMask directly, which is what this pass did
// before: a SubMask is 64 bytes, so a 3x3x3 neighbourhood question touches 27 cache
// lines scattered over a 134 MB array, and run merging asks that question several
// times per cell because it probes along three axes. Packed to bits the whole 128^3
// occupancy field is 256 KB, fits in L2, and the probes are free. The masks are read
// exactly once, sequentially, which is also the fastest way to read 134 MB.
//
// `full()` and not `empty()` for the occluder test: a half-carved cell reads as NOT
// an occluder, which is the conservative choice. Over-occluding a doorway would put
// a dark smudge in the one place the player is trying to walk through.
//
// The two arrays are BORROWED, not owned: the storage lives in CubePass
// (occFull_ / occNonEmpty_, sized once in init()). They used to be two vectors local
// to classify(), which meant a 512 KB allocate-zero-free triple on every single
// rebuild — inside a class whose own header promises this scratch is "allocated once
// in init(), never in a frame", and in maze mode a rebuild happens ~31 times a
// second (main.cpp steps fluid every 4 sim ticks and invalidates).
struct OccBits {
    std::uint64_t* full = nullptr;     // mask(x,y,z).full()
    std::uint64_t* nonEmpty = nullptr; // !mask(x,y,z).empty()

    static bool get(const std::uint64_t* b, std::size_t i) {
        return (b[i >> 6] >> (i & 63)) & 1u;
    }
};

// Occupancy words covered by one z slab of the grid. Exact, not rounded: a slab is
// kMacroDim^2 = 16384 cells = 256 whole words, so a slab boundary is always a word
// boundary and two slabs never share an output word. That is what lets the build
// below be split across threads with plain whole-word stores.
inline constexpr std::size_t kOccWordsPerSlab =
    static_cast<std::size_t>(kMacroDim) * kMacroDim / 64;
static_assert(kOccWordsPerSlab * 64 * kMacroDim == kMacroCells,
              "a z slab must cover a whole number of 64-cell occupancy words, or "
              "parallel slabs would share one and race on it");
static_assert(kOccWordsPerSlab * kMacroDim == kClaimWords,
              "the occupancy bitmaps are one bit per cell, same as the claim bitmap");

// Build both bitmaps for one z slab: 134 MB / kMacroDim of sub-voxel masks in,
// 2 * 2 KB of bits out.
//
// Each output word is ASSIGNED once, not OR-ed into, which is what removed the
// separate 512 KB zero-fill pass the old `resize()` did — and is also the property
// that makes the slabs independent, so this is called once per z from a
// parallel_for. Bandwidth-bound work: splitting it is how it gets more than one
// core's worth of memory bandwidth.
void build_occ_slab(const SubMask* masks, const OccBits& out, int z) {
    const std::size_t w0 = static_cast<std::size_t>(z) * kOccWordsPerSlab;
    for (std::size_t w = w0; w < w0 + kOccWordsPerSlab; ++w) {
        const SubMask* m = masks + (w << 6);
        std::uint64_t ne = 0, fu = 0;
        for (int b = 0; b < 64; ++b) {
            if (m[b].empty()) continue;
            const std::uint64_t bit = std::uint64_t{1} << b;
            ne |= bit;
            if (m[b].full()) fu |= bit;
        }
        out.nonEmpty[w] = ne;
        out.full[w] = fu;
    }
}

// One cell's 3x3x3 neighbourhood as flat-index terms: entry k of each axis is the
// wrapped index contribution of offset k-1 along that axis, already multiplied by
// the axis stride. A neighbour's flat index is the sum of one term per axis, so
// `at(dx,dy,dz)` reproduces
// macro_index(wrap_macro(x+dx), wrap_macro(y+dy), wrap_macro(z+dz)) exactly — AO
// stays continuous across the torus seam with nothing special-cased, same as before.
//
// This is where the first-build cost was. The previous form evaluated that whole
// expression per PROBE — three signed modulos plus two multiplies each — and
// classify() probes up to 26 times per surface cell, so a 128^3 sweep spent most of
// its time recomputing wrapped addresses it had just computed. Wrapping once per
// coordinate instead, with the y and z triples hoisted out of the x loop, takes the
// per-cell address arithmetic from ~78 wraps to 2.
//
// MEASURED, single-threaded, on the real floor-0 geometry (472,545 instances), with
// this form and the previous one alternating inside one process so the same machine
// load hits both: the surface+AO sweep went 89.4 ms -> 41.7 ms, and it is the
// dominant term in classify(). Output is byte-identical — the two implementations'
// 8 MB cellClass_ arrays memcmp equal, and so does the 15.1 MB instance buffer the
// merge then produces from them.
struct Nbr {
    std::size_t x[3], y[3], z[3];
    std::size_t at(int dx, int dy, int dz) const {
        return x[dx + 1] + y[dy + 1] + z[dz + 1];
    }
};

// Fill one axis triple. `c` is already in [0, kMacroDim) — every caller is sweeping
// the grid, never probing from outside it — so the toroidal step is one compare per
// side rather than wrap_macro's signed modulo. `stride` is a literal at every call
// site (1 / kMacroDim / kMacroDim^2), so the multiplies fold to shifts.
inline void nbr_axis(std::size_t out[3], int c, std::size_t stride) {
    const int lo = c == 0 ? kMacroDim - 1 : c - 1;
    const int hi = c == kMacroDim - 1 ? 0 : c + 1;
    out[0] = static_cast<std::size_t>(lo) * stride;
    out[1] = static_cast<std::size_t>(c) * stride;
    out[2] = static_cast<std::size_t>(hi) * stride;
}

// A cell is a surface cell (worth drawing) if it is non-empty and at least one of
// its six face neighbours is not fully solid. Fully-buried cells are skipped.
bool is_visible_surface(const OccBits& o, const Nbr& n) {
    if (!OccBits::get(o.nonEmpty, n.at(0, 0, 0))) return false;
    const int d[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                         {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
    for (auto& f : d)
        if (!OccBits::get(o.full, n.at(f[0], f[1], f[2]))) return true;
    return false;
}

// The AO input for one cell: the occupancy of the 20 neighbours cube.vert's
// corner_ao() can actually sample. The other six of the 26 — the single-axis face
// offsets — are deliberately left clear: no shader reads them, and a merged run has
// no single honest value for them, so writing them would be storing a number whose
// meaning depends on which cell of the run was scanned first. See kAoReadBits.
//
// The 20 are enumerated into a constexpr table rather than filtered out of the 27
// at runtime: the table is built by the SAME `>= 2 non-zero components` predicate at
// compile time, so it is the same set by construction, but the loop then carries no
// filter branch and no variable shift for `ao_bit`.
struct AoProbe {
    int d[3];
    std::uint32_t bit;
};
inline constexpr int kAoProbeCount = 20;
struct AoProbes {
    AoProbe p[kAoProbeCount];
};
constexpr AoProbes ao_probes() {
    AoProbes t{};
    int k = 0;
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                if ((dx != 0) + (dy != 0) + (dz != 0) < 2) continue;
                t.p[k].d[0] = dx;
                t.p[k].d[1] = dy;
                t.p[k].d[2] = dz;
                t.p[k].bit = ao_bit(dx, dy, dz);
                ++k;
            }
    return t;
}
inline constexpr AoProbes kAoProbes = ao_probes();
constexpr std::uint32_t ao_probe_union() {
    std::uint32_t m = 0;
    for (const AoProbe& p : kAoProbes.p) m |= p.bit;
    return m;
}
// The table must cover EXACTLY the bits the merge treats as observable. This is the
// contract between the two halves of the pass: cube_merge.h refuses to merge cells
// that differ in kAoReadBits, so classify() writing any other bit would make a run
// break on a bit no shader reads, and writing fewer would lose occlusion. Deriving
// both from the same predicate is not enough on its own — this pins them.
static_assert(ao_probe_union() == kAoReadBits,
              "the AO probe table and cube_merge.h's kAoReadBits must be the same set "
              "of bits; a probe that is not a merge bit (or vice versa) desynchronises "
              "classify() from the run merge");
static_assert(kAoProbes.p[kAoProbeCount - 1].bit != 0,
              "the probe table must be fully populated: exactly 20 of the 27 offsets "
              "have two or more non-zero components");

std::uint32_t ao_mask(const OccBits& o, const Nbr& n) {
    std::uint32_t m = 0;
    for (const AoProbe& p : kAoProbes.p)
        if (OccBits::get(o.full, n.at(p.d[0], p.d[1], p.d[2]))) m |= p.bit;
    return m;
}

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

bool read_file(const std::string& path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) { std::fprintf(stderr, "[vk] cannot open %s\n", path.c_str()); return false; }
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) { std::fclose(f); return false; }
    out.resize(static_cast<std::size_t>(n));
    std::size_t rd = std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return rd == static_cast<std::size_t>(n);
}

bool make_module(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode = reinterpret_cast<const std::uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

} // namespace

bool CubePass::init(VulkanDevice& dev, VkRenderPass renderPass,
                    const char* shaderDir) {
    dev_ = &dev;
    if (!create_cube_mesh()) return false;
    // BEFORE the pipeline: it decides which fragment module is compiled in and
    // whether the pipeline layout carries a sampler descriptor.
    load_material_textures();
    if (!create_pipeline(renderPass, shaderDir)) return false;

    // Upper bound: one instance per macro cell. In practice surface culling and run
    // merging keep this far lower, but sizing for the worst case means the buffer
    // never reallocates mid-run.
    instanceCapacity_ = static_cast<std::uint32_t>(kMacroCells);
    VkDeviceSize bytes = static_cast<VkDeviceSize>(instanceCapacity_)
                       * sizeof(CubeInstance);
    for (int i = 0; i < kMaxFramesInFlight; ++i)
        if (!instances_[i].create_host_visible(
                dev, bytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT))
            return false;

    // Rebuild scratch, allocated once and never in a frame: 8 MB of per-cell
    // classification, 256 KB of run-claim bits, and the two 256 KB occupancy bitmaps
    // classify() derives from the sub-voxel masks. The bitmaps are sized here rather
    // than declared inside classify() because a rebuild is not always a rare event —
    // in maze mode fluid invalidates ~31 times a second — and because the header
    // already promised this scratch was allocated once.
    cellClass_.assign(kMacroCells, 0u);
    claimed_.assign(kClaimWords, 0ull);
    occFull_.assign(kOccWordsPerSlab * kMacroDim, 0ull);
    occNonEmpty_.assign(kOccWordsPerSlab * kMacroDim, 0ull);
    classValid_ = false;

    // A/B knob, read exactly once. GIGA_CUBE_MAXRUN=1 reproduces the pre-merge
    // renderer instance-for-instance in this same binary, which is the only way to
    // compare two GPU timings without a rebuild between them — and a rebuild between
    // them is precisely how a thermally-downclocked "improvement" gets published.
    maxRun_ = kMaxRunCells;
    if (const char* e = std::getenv("GIGA_CUBE_MAXRUN")) {
        const int v = std::atoi(e);
        if (v >= 1 && v <= kMacroDim) maxRun_ = v;
        std::fprintf(stderr, "[cube] GIGA_CUBE_MAXRUN=%s -> max run %d cells\n", e,
                     maxRun_);
    }

    // Second A/B knob, same shape and the same reason: how many threads classify()
    // splits its two grid sweeps across. 0 (the default) means every hardware thread;
    // 1 forces the serial sweep, which is the pre-threading renderer in this same
    // binary.
    //
    // It exists because the threading win is the one part of the rebuild that is a
    // property of the MACHINE and not of the code, and the moment it runs is the worst
    // possible one: main.cpp starts the async nav bake on the same floor change, and
    // that bake pegs every core through the same parallel_for. Measured on the 6 P-core
    // + 8 E-core Windows box, on the real floor-0 geometry, best-of-8, with the two
    // implementations alternating inside one process: the serial sweep is a flat
    // 1.89x faster than the pre-change code (113.95 -> 60.18 ms) every single run,
    // while the threaded sweep ranged 34.24 ms (3.40x) to 147.97 ms (0.78x — SLOWER
    // than the old serial code) depending only on what else the box was doing.
    // parallel_for splits into equal static chunks, so a join waits for whichever
    // chunk landed on an E-core.
    //
    // So the default is "peg all cores" per performance.md, and this is the switch
    // that settles it on real hardware with one run and no rebuild instead of an
    // argument.
    classifyThreads_ = 0;
    if (const char* e = std::getenv("GIGA_CUBE_THREADS")) {
        const int v = std::atoi(e);
        if (v >= 1) classifyThreads_ = v;
        std::fprintf(stderr, "[cube] GIGA_CUBE_THREADS=%s -> classify on %s\n", e,
                     classifyThreads_ == 1 ? "1 thread (serial)"
                                           : "the requested thread count");
    }
    return true;
}

bool CubePass::create_cube_mesh() {
    std::vector<CubeVertex> verts;
    build_unit_cube(verts);
    vertexCount_ = static_cast<std::uint32_t>(verts.size());
    return cubeVerts_.create_device_local(
        *dev_, verts.data(), verts.size() * sizeof(CubeVertex),
        VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
}

// Load the pack, and say out loud what happened either way.
//
// This function CANNOT fail the pass. Every way it can go wrong — a GPU with no
// block-compressed format, a missing data directory, one corrupt file — leaves the
// pass on the procedural surface, which is not a stub or a placeholder but the
// renderer this project shipped for its whole life up to this change. What it must
// never do is go quiet: the one line it always prints at the end is the only place
// a human can read whether the six committed photographs are on screen.
void CubePass::load_material_textures() {
    const char* dir = std::getenv("GIGA_TEXTURE_DIR");
    if (dir == nullptr || *dir == '\0') dir = GIGA_TEXTURE_DIR;

    if (!albedo_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, false)) {
        std::fprintf(stderr,
                     "[cube] albedo array could not be created — every material "
                     "renders with the procedural surface\n");
        albedo_.destroy();
        return;
    }
    if (!normal_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, true)) {
        std::fprintf(stderr, "[cube] normal map array could not be created\n");
    }
    if (!roughness_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips, true)) {
        std::fprintf(stderr, "[cube] roughness map array could not be created\n");
    }

    for (const MaterialMap& m : kMaterialMaps) {
        const std::string path_albedo = join(dir, m.file);
        if (albedo_.load_layer(m.id, path_albedo.c_str()))
            texMask_ |= 1u << m.id;

        std::string stem = m.file;
        if (stem.size() >= 5 && stem.compare(stem.size() - 5, 5, ".ktx2") == 0)
            stem.erase(stem.size() - 5);

        const std::string path_normal = join(dir, (stem + "_normal.ktx2").c_str());
        if (normal_.load_layer(m.id, path_normal.c_str()))
            normalMask_ |= 1u << m.id;

        const std::string path_roughness = join(dir, (stem + "_roughness.ktx2").c_str());
        if (roughness_.load_layer(m.id, path_roughness.c_str()))
            roughnessMask_ |= 1u << m.id;
    }

    if (texMask_ == 0) {
        std::fprintf(stderr,
                     "[cube] ERROR: 0 of %d albedo maps loaded from '%s'. The "
                     "world renders with the procedural surface only.\n",
                     kMaterialMapCount, dir);
        albedo_.destroy();
        normal_.destroy();
        roughness_.destroy();
        return;
    }

    if (!albedo_.finish()) {
        std::fprintf(stderr, "[cube] ERROR: albedo array finish failed\n");
        albedo_.destroy();
        normal_.destroy();
        roughness_.destroy();
        texMask_ = 0;
        return;
    }
    normal_.finish();
    roughness_.finish();

    // Descriptor Set Layout with 3 combined image samplers
    VkDescriptorSetLayoutBinding bindings[3]{};
    for (uint32_t i = 0; i < 3; ++i) {
        bindings[i].binding = i;
        bindings[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    }

    VkDescriptorSetLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    li.bindingCount = 3;
    li.pBindings = bindings;
    if (vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &descriptorSetLayout_) != VK_SUCCESS)
        return;

    VkDescriptorPoolSize ps{};
    ps.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    ps.descriptorCount = 3;
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.maxSets = 1;
    pi.poolSizeCount = 1;
    pi.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pi, nullptr, &descriptorPool_) != VK_SUCCESS)
        return;

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = descriptorPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &descriptorSetLayout_;
    if (vkAllocateDescriptorSets(dev_->device, &ai, &descriptorSet_) != VK_SUCCESS)
        return;

    VkDescriptorImageInfo imageInfos[3]{};
    imageInfos[0].sampler = albedo_.sampler();
    imageInfos[0].imageView = albedo_.view();
    imageInfos[0].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    imageInfos[1].sampler = normal_.sampler();
    imageInfos[1].imageView = normal_.view();
    imageInfos[1].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    imageInfos[2].sampler = roughness_.sampler();
    imageInfos[2].imageView = roughness_.view();
    imageInfos[2].imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkWriteDescriptorSet writes[3]{};
    for (uint32_t b = 0; b < 3; ++b) {
        writes[b].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[b].dstSet = descriptorSet_;
        writes[b].dstBinding = b;
        writes[b].descriptorCount = 1;
        writes[b].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        writes[b].pImageInfo = &imageInfos[b];
    }
    vkUpdateDescriptorSets(dev_->device, 3, writes, 0, nullptr);

    textured_ = albedo_.ready();
    std::fprintf(stderr,
                 "[cube] albedo: %u/%d materials (mask 0x%04x), normal: %u/%d (mask 0x%04x), roughness: %u/%d (mask 0x%04x)\n",
                 albedo_.layers_loaded(), kMaterialMapCount, texMask_,
                 normal_.layers_loaded(), kMaterialMapCount, normalMask_,
                 roughness_.layers_loaded(), kMaterialMapCount, roughnessMask_);
}

bool CubePass::create_pipeline(VkRenderPass renderPass, const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    if (!read_file(join(shaderDir, "cube.vert.spv"), vsrc)) return false;
    // Two modules from ONE source: shaders/cube.frag is compiled plain for
    // body_pass and again with -DGIGA_ALBEDO_ARRAY for this pass, because a
    // sampler declared unconditionally would be statically used by the body
    // pipeline, whose layout has no descriptor sets (see the header comment in
    // cube.frag). If the second glslc command is missing from CMakeLists.txt this
    // read fails and the pass refuses to start — deliberately louder than
    // silently reverting to the untextured module, which would look like the
    // loader did nothing.
    const char* fragSpv = textured_ ? "cube_tex.frag.spv" : "cube.frag.spv";
    if (!read_file(join(shaderDir, fragSpv), fsrc)) {
        if (textured_)
            std::fprintf(stderr,
                         "[cube] ERROR: %s is missing. CMakeLists.txt needs a "
                         "glslc command that compiles shaders/cube.frag with "
                         "-DGIGA_ALBEDO_ARRAY into that name; see the shader "
                         "block next to `foreach(_sh cube.vert cube.frag "
                         "body.vert)`.\n",
                         fragSpv);
        return false;
    }

    VkShaderModule vs = VK_NULL_HANDLE, fs = VK_NULL_HANDLE;
    if (!make_module(dev_->device, vsrc, &vs)) return false;
    if (!make_module(dev_->device, fsrc, &fs)) {
        vkDestroyShaderModule(dev_->device, vs, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vs;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fs;
    stages[1].pName = "main";

    // Two bindings: 0 = per-vertex cube mesh, 1 = per-instance voxel data.
    VkVertexInputBindingDescription bindings[2]{};
    bindings[0].binding = 0;
    bindings[0].stride = sizeof(CubeVertex);
    bindings[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    bindings[1].binding = 1;
    bindings[1].stride = sizeof(CubeInstance);
    bindings[1].inputRate = VK_VERTEX_INPUT_RATE_INSTANCE;

    VkVertexInputAttributeDescription attrs[6]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, pos)};
    attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, normal)};
    attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeInstance, origin)};
    // R8G8B8A8_UINT over the four bytes the old `float scale` occupied. Mandatory
    // vertex-buffer format in the Vulkan spec (and a native Metal uchar4 under
    // MoltenVK), so this needs no format-feature query.
    attrs[3] = {3, 1, VK_FORMAT_R8G8B8A8_UINT, offsetof(CubeInstance, span)};
    attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeInstance, color)};
    attrs[5] = {5, 1, VK_FORMAT_R32_UINT, offsetof(CubeInstance, occ)};

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount = 2;
    vi.pVertexBindingDescriptions = bindings;
    vi.vertexAttributeDescriptionCount = 6;
    vi.pVertexAttributeDescriptions = attrs;

    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount = 1;

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_BACK_BIT;
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_FALSE;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable = VK_TRUE;
    ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp = VK_COMPARE_OP_LESS;

    VkDynamicState dyn[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dsi{};
    dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dsi.dynamicStateCount = 2;
    dsi.pDynamicStates = dyn;

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(CubePush);

    VkPipelineLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    lci.pushConstantRangeCount = 1;
    lci.pPushConstantRanges = &pcr;
    // Set 0 = the albedo array's combined image sampler, and ONLY when the
    // textured module is the one being compiled in. A layout that declares a set
    // the shader does not use is legal but pointless; a shader that uses a set the
    // layout does not declare is invalid, which is the whole reason for the two
    // modules.
    const VkDescriptorSetLayout setLayout = descriptorSetLayout_;
    if (textured_) {
        lci.setLayoutCount = 1;
        lci.pSetLayouts = &setLayout;
    }

    bool ok = vkCreatePipelineLayout(dev_->device, &lci, nullptr, &layout_)
              == VK_SUCCESS;
    if (ok) {
        VkGraphicsPipelineCreateInfo gp{};
        gp.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
        gp.stageCount = 2;
        gp.pStages = stages;
        gp.pVertexInputState = &vi;
        gp.pInputAssemblyState = &ia;
        gp.pViewportState = &vp;
        gp.pRasterizationState = &rs;
        gp.pMultisampleState = &ms;
        gp.pColorBlendState = &cb;
        gp.pDepthStencilState = &ds;
        gp.pDynamicState = &dsi;
        gp.layout = layout_;
        gp.renderPass = renderPass;
        gp.subpass = 0;
        ok = vkCreateGraphicsPipelines(dev_->device, VK_NULL_HANDLE, 1, &gp,
                                       nullptr, &pipeline_) == VK_SUCCESS;
    }

    vkDestroyShaderModule(dev_->device, vs, nullptr);
    vkDestroyShaderModule(dev_->device, fs, nullptr);
    if (!ok) std::fprintf(stderr, "[vk] cube pipeline creation failed\n");
    return ok;
}

void CubePass::invalidate() {
    for (int i = 0; i < kMaxFramesInFlight; ++i) dirty_[i] = true;
    classValid_ = false;
}

// The World-identity check is the same one record() does, and for the same reason: a
// recycled World object cannot be detected by address, so a caller that prebuilds
// against a different layer than it will later draw must still have invalidated. Doing
// the check here as well means a prebuild against a genuinely new World cannot leave
// record() thinking the cache is valid.
void CubePass::prebuild(const World& world) {
    if (cellClass_.empty()) return; // before init(): nothing to fill yet
    if (cachedWorld_ != &world) {
        cachedWorld_ = &world;
        invalidate();
    }
    if (!classValid_) classify(world);
}

// Classify every macro cell once: surface flag, AO input, material id, packed into
// one uint32 per cell. Two sweeps — the sub-voxel masks into occupancy bitmaps, then
// the bitmaps into per-cell AO — because the 134 MB mask array wants to be read
// exactly once and in order, while the 3x3x3 neighbourhood question wants its input
// to fit in L2. They cannot be fused: the AO pass reads neighbours at z-1 and z+1, so
// the whole bitmap has to exist before any of it is consumed.
//
// Shared by both frame slots, so an invalidate() pays this once no matter how many
// buffers have to be refilled from it. That is exactly why the first rebuild after a
// floor change costs several times the second, and why this function — not the merge,
// not the buffer write — is what a floor-entry hitch is made of.
//
// BOTH sweeps are split across cores. This is bake work, not tick work: it runs on a
// floor change, off the fixed-step sim loop, and performance.md's rule for that
// window is "peg all cores, spare nothing". The split is over z slabs, and slab z
// writes only its own 64 KB of cellClass_ (or its own 2 KB of bitmap words) while
// reading everything else read-only — jobs.h's determinism contract, so the result is
// bit-identical to the serial sweep and independent of thread count. Verified
// byte-for-byte against the serial output on the real floor-0 geometry, both the 8 MB
// cellClass_ array and the 15.1 MB instance buffer the GPU reads.
//
// The one caveat worth knowing: in maze mode a fluid step invalidates ~31 times a
// second, so this becomes a per-frame cost and each call spawns and joins a thread
// pool twice. Cheap against the ~95 ms it used to cost serially, but it is the reason
// jobs.h's "never on the sim tick" line deserves a second look if fluid ever moves
// into the floor modules.
void CubePass::classify(const World& world) {
    const MacroGrid& g = world.grid();
    // MacroGrid sizes both arrays to kMacroCells at construction and never resizes
    // them, so these are dense 128^3 views, not bounded ranges.
    const SubMask* masks = g.masks().data();
    const CellType* types = g.types().data();
    const OccBits occ{occFull_.data(), occNonEmpty_.data()};
    std::uint32_t* out = cellClass_.data();

    parallel_for(kMacroDim, [&](int z) { build_occ_slab(masks, occ, z); },
                 classifyThreads_);

    parallel_for(kMacroDim, [&](int z) {
        Nbr n;
        nbr_axis(n.z, z, static_cast<std::size_t>(kMacroDim) * kMacroDim);
        for (int y = 0; y < kMacroDim; ++y) {
            nbr_axis(n.y, y, kMacroDim);
            for (int x = 0; x < kMacroDim; ++x) {
                nbr_axis(n.x, x, 1);
                const std::size_t i = n.at(0, 0, 0); // == macro_index(x, y, z)
                if (!is_visible_surface(occ, n)) {
                    out[i] = 0;
                    continue;
                }
                out[i] = kSurfaceFlag | ao_mask(occ, n)
                       | (surface_id(types[i]) << kMatIdShift);
            }
        }
    }, classifyThreads_);
    classValid_ = true;
}

// Merge runs and fill one frame slot's instance buffer. Origins are ABSOLUTE grid
// positions (cell index * kCellSize): the nearest-toroidal-image shift is done
// per-vertex in cube.vert against push.camPos. Keeping the camera out of the
// instance data is precisely what makes this buffer cacheable across frames — and it
// is also why a merged box has a single toroidal image for all its cells, which is
// the one property of the merge that is a bounded trade-off rather than an identity
// (see the note on kMaxRunCells in render/cube_merge.h).
std::uint32_t CubePass::build_instances(std::uint32_t frameIndex,
                                        const World& world) {
    const MacroGrid& g = world.grid();
    if (!classValid_) classify(world);

    // Fluid field is optional; if present, cells with liquid tint blue.
    const Field<float>* fluid =
        const_cast<World&>(world).fields().find<float>("fluid");
    const float* fluidData = fluid ? fluid->data().data() : nullptr;
    const std::vector<CellType>& types = g.types();

    // The instance colour is a pure function of (cell type, fluid tint strength), so
    // comparing those two inputs is EXACTLY equivalent to comparing the colours and
    // needs no second cache. `tint` collapses every sub-threshold fluid amount to one
    // value, because those all produce the identical untinted colour and refusing to
    // merge them would cost runs for nothing.
    //
    // Still exactly equivalent now that a textured material writes a linear tint
    // RATIO instead of an absolute colour: the ratio is a pure function of the same
    // two inputs, and whether a material is textured is fixed for the whole run of
    // the process. No merge is gained or lost by this change.
    auto tint = [fluidData](std::size_t i) -> float {
        if (!fluidData) return 0.0f;
        const float f = fluidData[i];
        return f > 0.05f ? clamp01(f) : 0.0f;
    };
    auto same_colour = [&](std::size_t a, std::size_t b) {
        return types[a] == types[b] && tint(a) == tint(b);
    };

    auto* dst = static_cast<CubeInstance*>(instances_[frameIndex].mapped);
    auto emit = [&](std::size_t i, int x, int y, int z,
                    const std::uint8_t span[3]) {
        CubeInstance& inst = *dst;
        inst.origin = vec3{static_cast<float>(x) * kCellSize,
                           static_cast<float>(y) * kCellSize,
                           static_cast<float>(z) * kCellSize};
        inst.span[0] = span[0];
        inst.span[1] = span[1];
        inst.span[2] = span[2];
        inst.spanW = 0;
        const CellType ct = types[i];
        const vec3 base = type_color(ct);
        const float t = tint(i);
        vec3 col = base;
        if (t > 0.0f)
            col = vec3{lerp(base.x, 0.15f, t), lerp(base.y, 0.35f, t),
                       lerp(base.z, 0.85f, t)};
        // A textured material's mean albedo already arrives in the sampled texel,
        // so shipping it again in `color` would darken the photograph by its own
        // mean. What ships instead is the linear tint ratio — {1,1,1} when dry.
        // See the two-meanings note on CubeInstance::color.
        if (ct < kMatCount && ((texMask_ >> ct) & 1u) != 0u)
            col = t > 0.0f ? tint_multiplier(base, col) : vec3{1.0f, 1.0f, 1.0f};
        inst.color = col;
        // The fluid tint above deliberately does NOT change the surface family: a
        // flooded parquet floor is still parquet, wet. Tint is colour, family is
        // material. The surface flag comes off before upload — it lives on the
        // never-read centre bit of the mask and means nothing to the shader.
        inst.occ = cellClass_[i] & ~kSurfaceFlag;
        ++dst;
    };

    return merge_surface_runs(cellClass_.data(), claimed_.data(), maxRun_,
                              instanceCapacity_, same_colour, emit);
}

void CubePass::record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                      const World& world, const CubePush& push) {
    // A different World object is a guaranteed content change; the same object
    // with mutated contents is not detectable here, which is why invalidate()
    // exists (floor streaming recycles World objects in place).
    if (cachedWorld_ != &world) {
        cachedWorld_ = &world;
        invalidate();
    }
    if (dirty_[frameIndex]) {
        // The rebuild is the whole cost of a floor change on this thread, and it is
        // the number an elevator ride is judged by, so it is printed rather than left
        // to the HUD: a --shot run has no HUD reader. Two lines per invalidate (one
        // per frame slot), not per frame.
        const auto t0 = std::chrono::steady_clock::now();
        lastInstanceCount_ = build_instances(frameIndex, world);
        const auto t1 = std::chrono::steady_clock::now();
        std::fprintf(stderr, "[cube] rebuild slot %u: %u instances in %.2f ms\n",
                     frameIndex, lastInstanceCount_,
                     std::chrono::duration<double, std::milli>(t1 - t0).count());
        dirty_[frameIndex] = false;
    }

    const std::uint32_t count = lastInstanceCount_;
    if (count == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    if (textured_) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0,
                                1, &descriptorSet_, 0, nullptr);
    }
    CubePush p = push;
    p.torus.z = static_cast<float>(texMask_);
    std::uint32_t packedMasks = (normalMask_ & 0xFFFFu) | ((roughnessMask_ & 0xFFFFu) << 16);
    float packedF;
    std::memcpy(&packedF, &packedMasks, sizeof(packedF));
    p.torus.w = packedF;
    vkCmdPushConstants(cmd, layout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &p);
    VkDeviceSize offs[2] = {0, 0};
    VkBuffer bufs[2] = {cubeVerts_.buffer, instances_[frameIndex].buffer};
    vkCmdBindVertexBuffers(cmd, 0, 2, bufs, offs);
    vkCmdDraw(cmd, vertexCount_, count, 0, 0);
}

void CubePass::destroy() {
    if (!dev_) return;
    for (int i = 0; i < kMaxFramesInFlight; ++i) instances_[i].destroy(*dev_);
    cubeVerts_.destroy(*dev_);
    if (pipeline_) { vkDestroyPipeline(dev_->device, pipeline_, nullptr); pipeline_ = VK_NULL_HANDLE; }
    if (layout_) { vkDestroyPipelineLayout(dev_->device, layout_, nullptr); layout_ = VK_NULL_HANDLE; }
    if (descriptorSetLayout_) { vkDestroyDescriptorSetLayout(dev_->device, descriptorSetLayout_, nullptr); descriptorSetLayout_ = VK_NULL_HANDLE; }
    if (descriptorPool_) { vkDestroyDescriptorPool(dev_->device, descriptorPool_, nullptr); descriptorPool_ = VK_NULL_HANDLE; descriptorSet_ = VK_NULL_HANDLE; }
    roughness_.destroy();
    normal_.destroy();
    albedo_.destroy();
    textured_ = false;
    texMask_ = 0;
    normalMask_ = 0;
    roughnessMask_ = 0;
}

} // namespace giga::gpu
