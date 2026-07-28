#include "render/cube_pass.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <cmath>
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

// A cell is a surface cell (worth drawing) if it is non-empty and at least one
// of its six neighbours is not fully solid. Fully-buried cells are skipped.
bool is_visible_surface(const MacroGrid& g, int x, int y, int z) {
    if (g.mask(x, y, z).empty()) return false;
    const int d[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                         {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
    for (auto& n : d)
        if (!g.mask(x + n[0], y + n[1], z + n[2]).full()) return true;
    return false;
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

    // Upper bound: one instance per macro cell. In practice surface culling
    // keeps this far lower, but sizing for the worst case means the buffer
    // never reallocates mid-run.
    instanceCapacity_ = static_cast<std::uint32_t>(kMacroCells);
    VkDeviceSize bytes = static_cast<VkDeviceSize>(instanceCapacity_)
                       * sizeof(CubeInstance);
    for (int i = 0; i < kMaxFramesInFlight; ++i)
        if (!instances_[i].create_host_visible(
                dev, bytes, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT))
            return false;
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

    VkVertexInputAttributeDescription attrs[5]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, pos)};
    attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeVertex, normal)};
    attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeInstance, origin)};
    attrs[3] = {3, 1, VK_FORMAT_R32_SFLOAT, offsetof(CubeInstance, scale)};
    attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(CubeInstance, color)};

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount = 2;
    vi.pVertexBindingDescriptions = bindings;
    vi.vertexAttributeDescriptionCount = 5;
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
}

// Scan the grid once and fill one frame slot's instance buffer. Origins are
// ABSOLUTE grid positions (cell index * kCellSize, inside [0, kWorldExtent)):
// the nearest-toroidal-image shift is done per-vertex in cube.vert against
// push.camPos. Keeping the camera out of the instance data is precisely what
// makes this buffer cacheable across frames.
std::uint32_t CubePass::build_instances(std::uint32_t frameIndex,
                                        const World& world) {
    const MacroGrid& g = world.grid();

    // Fluid field is optional; if present, cells with liquid tint blue.
    const Field<float>* fluid =
        const_cast<World&>(world).fields().find<float>("fluid");

    auto* dst = static_cast<CubeInstance*>(instances_[frameIndex].mapped);
    std::uint32_t count = 0;

    for (int z = 0; z < kMacroDim && count < instanceCapacity_; ++z)
    for (int y = 0; y < kMacroDim && count < instanceCapacity_; ++y)
    for (int x = 0; x < kMacroDim && count < instanceCapacity_; ++x) {
        if (!is_visible_surface(g, x, y, z)) continue;
        vec3 col = type_color(g.cell(x, y, z));
        if (fluid) {
            float f = fluid->at(x, y, z);
            if (f > 0.05f) {
                float t = clamp01(f);
                col = vec3{lerp(col.x, 0.15f, t), lerp(col.y, 0.35f, t),
                           lerp(col.z, 0.85f, t)};
            }
        }
        dst[count].origin = vec3{static_cast<float>(x) * kCellSize,
                                 static_cast<float>(y) * kCellSize,
                                 static_cast<float>(z) * kCellSize};
        dst[count].scale = kCellSize;
        dst[count].color = col;
        ++count;
    }
    return count;
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
        lastInstanceCount_ = build_instances(frameIndex, world);
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
