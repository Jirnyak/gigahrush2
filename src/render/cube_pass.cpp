#include "render/cube_pass.h"

#include "render/cube_merge.h"
#include "render/vk_common.h"
#include "render/vk_device.h"

#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

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
    /*  6 unused                */ {0.75f, 0.75f, 0.78f},
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
};
static_assert(sizeof(kMaterial) / sizeof(kMaterial[0]) == kMatCount,
              "one albedo row per material id in world/materials.h");

vec3 type_color(CellType t) {
    // Unknown ids render as the old default rather than black, so a generator that
    // writes a material the table does not know is visible but not invisible.
    return t < kMatCount ? kMaterial[t] : vec3{0.75f, 0.75f, 0.78f};
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
struct OccBits {
    std::vector<std::uint64_t> full;     // mask(x,y,z).full()
    std::vector<std::uint64_t> nonEmpty; // !mask(x,y,z).empty()

    void resize() {
        full.assign(kClaimWords, 0);
        nonEmpty.assign(kClaimWords, 0);
    }
    static bool get(const std::vector<std::uint64_t>& b, std::size_t i) {
        return (b[i >> 6] >> (i & 63)) & 1u;
    }
};

// Wrapped flat index of the neighbour at (x+dx, y+dy, z+dz). Every read goes
// through wrap_macro on all three axes — so AO is continuous across the torus seam
// for free, with nothing to special-case.
inline std::size_t neighbour_index(int x, int y, int z, int dx, int dy, int dz) {
    return macro_index(wrap_macro(x + dx), wrap_macro(y + dy), wrap_macro(z + dz));
}

void build_occ_bits(const MacroGrid& g, OccBits& out) {
    out.resize();
    const std::vector<SubMask>& masks = g.masks();
    for (std::size_t i = 0; i < masks.size(); ++i) {
        const SubMask& m = masks[i];
        const std::uint64_t bit = std::uint64_t{1} << (i & 63);
        if (!m.empty()) {
            out.nonEmpty[i >> 6] |= bit;
            if (m.full()) out.full[i >> 6] |= bit;
        }
    }
}

// A cell is a surface cell (worth drawing) if it is non-empty and at least one of
// its six face neighbours is not fully solid. Fully-buried cells are skipped.
bool is_visible_surface(const OccBits& o, int x, int y, int z) {
    if (!OccBits::get(o.nonEmpty, macro_index(x, y, z))) return false;
    const int d[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                         {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
    for (auto& n : d)
        if (!OccBits::get(o.full, neighbour_index(x, y, z, n[0], n[1], n[2])))
            return true;
    return false;
}

// The AO input for one cell: the occupancy of the 20 neighbours cube.vert's
// corner_ao() can actually sample. The other six of the 26 — the single-axis face
// offsets — are deliberately left clear: no shader reads them, and a merged run has
// no single honest value for them, so writing them would be storing a number whose
// meaning depends on which cell of the run was scanned first. See kAoReadBits.
std::uint32_t ao_mask(const OccBits& o, int x, int y, int z) {
    std::uint32_t m = 0;
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                if ((dx != 0) + (dy != 0) + (dz != 0) < 2) continue;
                if (OccBits::get(o.full, neighbour_index(x, y, z, dx, dy, dz)))
                    m |= ao_bit(dx, dy, dz);
            }
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
    // classification and 256 KB of run-claim bits.
    cellClass_.assign(kMacroCells, 0u);
    claimed_.assign(kClaimWords, 0ull);
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

bool CubePass::create_pipeline(VkRenderPass renderPass, const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    if (!read_file(join(shaderDir, "cube.vert.spv"), vsrc)) return false;
    if (!read_file(join(shaderDir, "cube.frag.spv"), fsrc)) return false;

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

// Classify every macro cell once: surface flag, AO input, material id, packed into
// one uint32 per cell. Two sequential sweeps — the sub-voxel masks into occupancy
// bitmaps, then the bitmaps into per-cell AO — because the 134 MB mask array wants
// to be read exactly once and in order, while the 3x3x3 neighbourhood question wants
// its input to fit in L2.
//
// Shared by both frame slots, so an invalidate() pays this once no matter how many
// buffers have to be refilled from it.
void CubePass::classify(const World& world) {
    const MacroGrid& g = world.grid();
    OccBits occ;
    build_occ_bits(g, occ);
    const std::vector<CellType>& types = g.types();
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                const std::size_t i = macro_index(x, y, z);
                if (!is_visible_surface(occ, x, y, z)) {
                    cellClass_[i] = 0;
                    continue;
                }
                cellClass_[i] = kSurfaceFlag | ao_mask(occ, x, y, z)
                              | (surface_id(types[i]) << kMatIdShift);
            }
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
        vec3 col = type_color(types[i]);
        const float t = tint(i);
        if (t > 0.0f)
            col = vec3{lerp(col.x, 0.15f, t), lerp(col.y, 0.35f, t),
                       lerp(col.z, 0.85f, t)};
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
    vkCmdPushConstants(cmd, layout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
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
}

} // namespace giga::gpu
