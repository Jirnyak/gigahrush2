#include "render/verlet_pass.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "render/vk_device.h"
#include "world/types.h" // kWorldExtent — the sim's wrap period

namespace giga::gpu {

namespace {

bool read_file(const std::string& path, std::vector<char>& out) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return false;
    const std::streamsize n = f.tellg();
    f.seekg(0);
    out.resize(static_cast<std::size_t>(n));
    return static_cast<bool>(f.read(out.data(), n));
}

bool make_module(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode = reinterpret_cast<const uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

// One push block, one meaning per field. Mirrors verlet_sim.comp. Bank
// membership of a point/element is arithmetic off the bank bases — the SoA
// pool has no indirection table by design (plan §2.1). The particle bank
// base is a compile-time lockstep constant on both sides, not a push lane.
struct VerletPush {
    vec4 dims; // x point count (this dispatch), y point base (offset),
               //   z cloth point base, w phase
    vec4 sim;  // x dt, y damping, z wrap period (m), w element count
    vec4 grav; // xyz gravity vector (m/s^2), w body count — NEVER assume -Z
};
static_assert(sizeof(VerletPush) == 48,
              "sim push must stay under the 128-byte guaranteed range");

// Verlet damping per step. A LITERAL by explicit owner decision for the
// behaviour-preserving merge: deriving it from the element's mass and the
// MEDIUM it hangs in (materials.csv density — owner's extension 2026-08-31)
// is a SEMANTIC change and lives in its own increment (verlet-merge.md инкр. 4).
constexpr float kVerletDamping = 0.985f;

// --- GIGA_VERLET_PIN=N: reproducible state snapshot after N recorded sims ---
// Counted in SIMS SINCE THE LAST upload, never frames or ticks: the --shot
// harness presents a run-dependent number of frames before travel fires, so
// only "sims since this floor's upload" is comparable across runs. Under the
// flag the push bodies are dropped too — the crowd walks nondeterministically
// and would poison the hash. Zero cost when the env var is absent.
// PERMANENT tool, do not remove. The hash walks cur.xyz per element in point
// order — IDENTICAL byte order before and after the SoA relayout, so pins
// stay comparable across the merge.
int verlet_pin_sims() {
    static const int n = [] {
        const char* e = std::getenv("GIGA_VERLET_PIN");
        return e != nullptr ? std::atoi(e) : 0;
    }();
    return n;
}

// GIGA_PARTICLE_PIN=N — twin counter for the particle bank (see
// maybe_particle_pin_dump); migrated with the ParticlePass merge.
int particle_pin_sims() {
    static const int n = [] {
        const char* e = std::getenv("GIGA_PARTICLE_PIN");
        return e != nullptr ? std::atoi(e) : 0;
    }();
    return n;
}

std::uint64_t fnv1a(const void* data, std::size_t bytes, std::uint64_t h) {
    const auto* p = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < bytes; ++i) {
        h ^= p[i];
        h *= 1099511628211ull;
    }
    return h;
}

} // namespace

bool particle_pin_active() { return particle_pin_sims() > 0; }

bool VerletPass::init(VulkanDevice* dev, VkRenderPass renderPass,
                      const char* shaderDir, VkBuffer masksBuffer,
                      VkDescriptorSetLayout lightGridSetLayout) {
    dev_ = dev;
    lightGridSetLayout_ = lightGridSetLayout;
    if (!points_.create_host_visible(*dev_, sizeof(VerletPoint) * kPoolPoints,
                                     VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                     "verlet-points"))
        return false;
    // The particle bank starts all dead: prev.w (life) <= 0 skips the sim
    // and clips the draw.
    std::memset(static_cast<VerletPoint*>(points_.mapped) + kParticlePointBase,
                0, sizeof(VerletPoint) * kRootParticles);
    if (!elems_.create_host_visible(*dev_,
                                    sizeof(VerletElem) * kMaxAntourageElems,
                                    VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                    "verlet-elems"))
        return false;
    if (!bodies_.create_host_visible(*dev_, sizeof(vec4) * kMaxPushBodies,
                                     VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                     "verlet-bodies"))
        return false;
    if (!aux_.create_host_visible(*dev_,
                                  sizeof(VerletParticleAux) * kRootParticles,
                                  VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                  "verlet-particle-aux"))
        return false;

    VkDescriptorSetLayoutBinding b[5]{};
    b[0].binding = 0; // the point pool (banks back to back)
    b[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[0].descriptorCount = 1;
    b[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_VERTEX_BIT;
    b[1].binding = 1; // the element table {restX, restY, alive, massKg}
    b[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[1].descriptorCount = 1;
    b[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_VERTEX_BIT;
    b[2].binding = 2; // this frame's push bodies, compute only
    b[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[2].descriptorCount = 1;
    b[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    b[3].binding = 3; // VoxelMirror masks — what a severed piece lands ON
    b[3].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[3].descriptorCount = 1;
    b[3].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    b[4].binding = 4; // particle aux bank (γ/bounce in sim, tint in vert)
    b[4].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[4].descriptorCount = 1;
    b[4].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_VERTEX_BIT;
    VkDescriptorSetLayoutCreateInfo slci{};
    slci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    slci.bindingCount = 5;
    slci.pBindings = b;
    if (vkCreateDescriptorSetLayout(dev_->device, &slci, nullptr, &setLayout_) !=
        VK_SUCCESS)
        return false;

    // ONE set: the banks stopped owning buffers, so the two per-section sets
    // of the pre-SoA pass collapsed with them.
    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 5};
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.maxSets = 1;
    pci.poolSizeCount = 1;
    pci.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pci, nullptr, &pool_) != VK_SUCCESS)
        return false;
    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = pool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &setLayout_;
    if (vkAllocateDescriptorSets(dev_->device, &ai, &set_) != VK_SUCCESS)
        return false;

    VkDescriptorBufferInfo bi[5] = {
        {points_.buffer, 0, VK_WHOLE_SIZE},
        {elems_.buffer, 0, VK_WHOLE_SIZE},
        {bodies_.buffer, 0, VK_WHOLE_SIZE},
        {masksBuffer, 0, VK_WHOLE_SIZE},
        {aux_.buffer, 0, VK_WHOLE_SIZE},
    };
    VkWriteDescriptorSet w[5]{};
    for (int i = 0; i < 5; ++i) {
        w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        w[i].dstSet = set_;
        w[i].dstBinding = static_cast<std::uint32_t>(i);
        w[i].descriptorCount = 1;
        w[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        w[i].pBufferInfo = &bi[i];
    }
    vkUpdateDescriptorSets(dev_->device, 5, w, 0, nullptr);

    return create_pipelines(renderPass, shaderDir);
}

bool VerletPass::create_pipelines(VkRenderPass renderPass,
                                  const char* shaderDir) {
    VkDevice d = dev_->device;

    // --- compute: ONE pipeline for both phases (points / constraints) ------
    {
        VkPushConstantRange pr{VK_SHADER_STAGE_COMPUTE_BIT, 0,
                               sizeof(VerletPush)};
        VkPipelineLayoutCreateInfo pl{};
        pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl.setLayoutCount = 1;
        pl.pSetLayouts = &setLayout_;
        pl.pushConstantRangeCount = 1;
        pl.pPushConstantRanges = &pr;
        if (vkCreatePipelineLayout(d, &pl, nullptr, &simLayout_) != VK_SUCCESS)
            return false;

        std::vector<char> spv;
        if (!read_file(join(shaderDir, "verlet_sim.comp.spv"), spv)) {
            std::fprintf(stderr, "[verlet] verlet_sim.comp.spv missing\n");
            return false;
        }
        VkShaderModule m = VK_NULL_HANDLE;
        if (!make_module(d, spv, &m)) return false;
        VkComputePipelineCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        ci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        ci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        ci.stage.module = m;
        ci.stage.pName = "main";
        ci.layout = simLayout_;
        const bool ok = vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &ci,
                                                 nullptr, &simPipeline_) ==
                        VK_SUCCESS;
        vkDestroyShaderModule(d, m, nullptr);
        if (!ok) return false;
    }

    // Headless compute-only mode (verlet_test): no render pass — the sim is
    // fully functional, the draws are simply never created. Same seam as
    // GpuMediumPass, which never needed a render pass at all.
    if (renderPass == VK_NULL_HANDLE) return true;

    // --- graphics: two pipelines over one layout, one state recipe ---------
    // The section primitives differ (camera-facing ribbon vs two-sided quad)
    // but every fixed-function state is IDENTICAL — the old passes proved it
    // by diff, so the recipe is written once and fed two shader pairs.
    {
        // Two ranges: CubePush (family-shared, vertex+fragment) plus the
        // 16-byte VerletDrawPush the instanced verts need to address the pool
        // (vertex-only, right after CubePush; together exactly 128 B).
        VkPushConstantRange pr[2] = {
            {VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
             sizeof(CubePush)},
            {VK_SHADER_STAGE_VERTEX_BIT, sizeof(CubePush),
             sizeof(VerletDrawPush)},
        };
        // Set 1 — световая сетка (S5-долг закрыт 2026-08-21): dressing_light
        // в wire/cloth.frag читает те же лампы и кластеры, что стены.
        VkDescriptorSetLayout sls[2] = {setLayout_, lightGridSetLayout_};
        VkPipelineLayoutCreateInfo pl{};
        pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl.setLayoutCount = lightGridSetLayout_ != VK_NULL_HANDLE ? 2u : 1u;
        pl.pSetLayouts = sls;
        pl.pushConstantRangeCount = 2;
        pl.pPushConstantRanges = pr;
        if (vkCreatePipelineLayout(d, &pl, nullptr, &drawLayout_) != VK_SUCCESS)
            return false;

        struct DrawSpec {
            const char* vert;
            const char* frag;
            VkPipeline* out;
            bool translucent; // particles: alpha-blend, no depth write
        };
        const DrawSpec specs[3] = {
            {"wire.vert.spv", "wire.frag.spv", &wireDrawPipeline_, false},
            {"cloth.vert.spv", "cloth.frag.spv", &clothDrawPipeline_, false},
            {"particle.vert.spv", "particle.frag.spv",
             &particleDrawPipeline_, true},
        };
        for (const DrawSpec& spec : specs) {
            std::vector<char> vs, fs;
            if (!read_file(join(shaderDir, spec.vert), vs) ||
                !read_file(join(shaderDir, spec.frag), fs)) {
                std::fprintf(stderr, "[verlet] %s/%s missing\n", spec.vert,
                             spec.frag);
                return false;
            }
            VkShaderModule vm = VK_NULL_HANDLE, fm = VK_NULL_HANDLE;
            if (!make_module(d, vs, &vm)) return false;
            if (!make_module(d, fs, &fm)) {
                vkDestroyShaderModule(d, vm, nullptr);
                return false;
            }

            VkPipelineShaderStageCreateInfo st[2]{};
            st[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
            st[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
            st[0].module = vm;
            st[0].pName = "main";
            st[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
            st[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
            st[1].module = fm;
            st[1].pName = "main";

            VkPipelineVertexInputStateCreateInfo vi{};
            vi.sType =
                VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;

            VkPipelineInputAssemblyStateCreateInfo ia{};
            ia.sType =
                VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
            ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

            VkPipelineViewportStateCreateInfo vp{};
            vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
            vp.viewportCount = 1;
            vp.scissorCount = 1;

            VkPipelineRasterizationStateCreateInfo rs{};
            rs.sType =
                VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
            rs.polygonMode = VK_POLYGON_MODE_FILL;
            rs.cullMode = VK_CULL_MODE_NONE; // ribbon and cloth: two faces each
            rs.lineWidth = 1.0f;

            VkPipelineMultisampleStateCreateInfo ms{};
            ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
            ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

            // Particles: depth TEST against the solid world, no WRITE —
            // translucent sprites must not punch holes in each other's blend.
            VkPipelineDepthStencilStateCreateInfo ds{};
            ds.sType =
                VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
            ds.depthTestEnable = VK_TRUE;
            ds.depthWriteEnable = spec.translucent ? VK_FALSE : VK_TRUE;
            ds.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;

            VkPipelineColorBlendAttachmentState att{};
            if (spec.translucent) {
                att.blendEnable = VK_TRUE;
                att.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
                att.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
                att.colorBlendOp = VK_BLEND_OP_ADD;
                att.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
                att.dstAlphaBlendFactor = VK_BLEND_FACTOR_ZERO;
                att.alphaBlendOp = VK_BLEND_OP_ADD;
            }
            att.colorWriteMask =
                VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
            VkPipelineColorBlendStateCreateInfo cb{};
            cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
            cb.attachmentCount = 1;
            cb.pAttachments = &att;

            const VkDynamicState dyn[2] = {VK_DYNAMIC_STATE_VIEWPORT,
                                           VK_DYNAMIC_STATE_SCISSOR};
            VkPipelineDynamicStateCreateInfo dsi{};
            dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
            dsi.dynamicStateCount = 2;
            dsi.pDynamicStates = dyn;

            VkGraphicsPipelineCreateInfo ci{};
            ci.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
            ci.stageCount = 2;
            ci.pStages = st;
            ci.pVertexInputState = &vi;
            ci.pInputAssemblyState = &ia;
            ci.pViewportState = &vp;
            ci.pRasterizationState = &rs;
            ci.pMultisampleState = &ms;
            ci.pDepthStencilState = &ds;
            ci.pColorBlendState = &cb;
            ci.pDynamicState = &dsi;
            ci.layout = drawLayout_;
            ci.renderPass = renderPass;
            const bool ok = vkCreateGraphicsPipelines(d, VK_NULL_HANDLE, 1, &ci,
                                                      nullptr, spec.out) ==
                            VK_SUCCESS;
            vkDestroyShaderModule(d, vm, nullptr);
            vkDestroyShaderModule(d, fm, nullptr);
            if (!ok) return false;
        }
    }
    return true;
}

void VerletPass::repack() {
    if (!points_.mapped || !elems_.mapped) return;
    // Root-cap honesty (S11): the tail that does not fit is dropped OUT LOUD,
    // wires first (they were staged first). With the root at 2^20 points a
    // padic floor (~750 chains + ~150 sheets ≈ 11k points) uses ~1 %.
    std::uint32_t nw = static_cast<std::uint32_t>(wireStage_.size());
    std::uint32_t nc = static_cast<std::uint32_t>(clothStage_.size());
    const std::uint32_t wirePts = nw * kWireChainPoints;
    if (wirePts > kRootAntouragePoints) {
        nw = kRootAntouragePoints / kWireChainPoints;
        std::fprintf(stderr,
                     "[verlet] TRUNCATED: %zu chains baked, pool fits %u\n",
                     wireStage_.size(), nw);
    }
    const std::uint32_t clothCap =
        (kRootAntouragePoints - nw * kWireChainPoints) / kClothGridPoints;
    if (nc > clothCap) {
        std::fprintf(stderr,
                     "[verlet] TRUNCATED: %zu sheets baked, pool fits %u\n",
                     clothStage_.size(), clothCap);
        nc = clothCap;
    }
    if (nw + nc > kMaxAntourageElems) { // derived cap, unreachable while the
        nc = kMaxAntourageElems - nw;   // smallest element is the divisor
        std::fprintf(stderr, "[verlet] TRUNCATED: element table full\n");
    }
    wireCount_ = nw;
    clothCount_ = nc;

    auto* pts = static_cast<VerletPoint*>(points_.mapped);
    auto* els = static_cast<VerletElem*>(elems_.mapped);
    for (std::uint32_t i = 0; i < nw; ++i) {
        const GpuWireChain& c = wireStage_[i];
        els[i].v = vec4{c.meta.x, 0.0f, c.meta.y, c.meta.z};
        for (int k = 0; k < kWireChainPoints; ++k) {
            pts[i * kWireChainPoints + k].cur = c.cur[k];
            pts[i * kWireChainPoints + k].prev = c.prev[k];
        }
    }
    const std::uint32_t cb = cloth_point_base();
    for (std::uint32_t i = 0; i < nc; ++i) {
        const GpuClothSheet& s = clothStage_[i];
        els[nw + i].v = vec4{s.meta.x, s.meta.z, s.meta.y, 0.0f};
        for (int k = 0; k < kClothGridPoints; ++k) {
            pts[cb + i * kClothGridPoints + k].cur = s.cur[k];
            pts[cb + i * kClothGridPoints + k].prev = s.prev[k];
        }
    }
}

void VerletPass::upload_wires(const GpuWireChain* chains, std::uint32_t count) {
    if (!points_.mapped) return;
    // Fresh verlet state = a fresh pin epoch: the sim counter restarts so a
    // GIGA_VERLET_PIN snapshot always means "N sims after THIS upload".
    wirePin_.simsSinceUpload = 0;
    wirePin_.pinDumped = false;
    ++wirePin_.uploadEpoch;
    if (chains != nullptr && count > 0)
        wireStage_.assign(chains, chains + count);
    else
        wireStage_.clear();
    repack();
}

void VerletPass::upload_cloths(const GpuClothSheet* sheets,
                               std::uint32_t count) {
    if (!points_.mapped) return;
    clothPin_.simsSinceUpload = 0;
    clothPin_.pinDumped = false;
    ++clothPin_.uploadEpoch;
    if (sheets != nullptr && count > 0)
        clothStage_.assign(sheets, sheets + count);
    else
        clothStage_.clear();
    repack();
}

void VerletPass::write_wire_pins(const std::uint8_t* masks,
                                 std::uint32_t count) {
    if (!points_.mapped) return;
    auto* pts = static_cast<VerletPoint*>(points_.mapped);
    const std::uint32_t n = count < wireCount_ ? count : wireCount_;
    for (std::uint32_t i = 0; i < n; ++i)
        for (int j = 0; j < kWireChainPoints; ++j)
            pts[i * kWireChainPoints + j].cur.w =
                ((masks[i] >> j) & 1u) ? 0.0f : 1.0f;
}

void VerletPass::write_cloth_pins(const std::uint32_t* masks,
                                  std::uint32_t count) {
    if (!points_.mapped) return;
    auto* pts = static_cast<VerletPoint*>(points_.mapped);
    const std::uint32_t cb = cloth_point_base();
    const std::uint32_t n = count < clothCount_ ? count : clothCount_;
    for (std::uint32_t i = 0; i < n; ++i)
        for (int j = 0; j < kClothGridPoints; ++j)
            pts[cb + i * kClothGridPoints + j].cur.w =
                ((masks[i] >> j) & 1u) ? 0.0f : 1.0f;
}

void VerletPass::write_wire_alive(const std::uint8_t* flags,
                                  std::uint32_t count) {
    if (!elems_.mapped) return;
    auto* els = static_cast<VerletElem*>(elems_.mapped);
    const std::uint32_t n = count < wireCount_ ? count : wireCount_;
    for (std::uint32_t i = 0; i < n; ++i)
        els[i].v.z = flags[i] ? 1.0f : 0.0f;
}

void VerletPass::write_cloth_alive(const std::uint8_t* flags,
                                   std::uint32_t count) {
    if (!elems_.mapped) return;
    auto* els = static_cast<VerletElem*>(elems_.mapped);
    const std::uint32_t n = count < clothCount_ ? count : clothCount_;
    for (std::uint32_t i = 0; i < n; ++i)
        els[wireCount_ + i].v.z = flags[i] ? 1.0f : 0.0f;
}

void VerletPass::upload_bodies(const vec4* bodies, std::uint32_t count) {
    if (!bodies_.mapped) return;
    // Pin protocol: the crowd is nondeterministic, so a pinned run sims
    // without push bodies — otherwise no two runs could ever hash equal.
    if (verlet_pin_sims() > 0 || particle_pin_sims() > 0) {
        bodyCount_ = 0;
        return;
    }
    if (count > kMaxPushBodies) {
        // S11: обрезание вслух (аудит 2026-08-25) — 513-е тело молча
        // переставало толкать провода.
        static bool warned = false;
        if (!warned) {
            warned = true;
            std::fprintf(stderr,
                         "[verlet] PUSH-BODY CAP: %u > %u, хвост толпы не "
                         "толкает антураж\n",
                         count, kMaxPushBodies);
        }
    }
    bodyCount_ = count < kMaxPushBodies ? count : kMaxPushBodies;
    if (bodyCount_ > 0)
        std::memcpy(bodies_.mapped, bodies, sizeof(vec4) * bodyCount_);
}

void VerletPass::gather_chain(std::uint32_t idx, GpuWireChain* out) const {
    *out = GpuWireChain{};
    if (!points_.mapped || idx >= wireCount_) return;
    const auto* pts = static_cast<const VerletPoint*>(points_.mapped);
    const auto* els = static_cast<const VerletElem*>(elems_.mapped);
    out->meta = vec4{els[idx].v.x, els[idx].v.z, els[idx].v.w, 0.0f};
    for (int k = 0; k < kWireChainPoints; ++k) {
        out->cur[k] = pts[idx * kWireChainPoints + k].cur;
        out->prev[k] = pts[idx * kWireChainPoints + k].prev;
    }
}

void VerletPass::gather_sheet(std::uint32_t idx, GpuClothSheet* out) const {
    *out = GpuClothSheet{};
    if (!points_.mapped || idx >= clothCount_) return;
    const auto* pts = static_cast<const VerletPoint*>(points_.mapped);
    const auto* els = static_cast<const VerletElem*>(elems_.mapped);
    const VerletElem& e = els[wireCount_ + idx];
    out->meta = vec4{e.v.x, e.v.z, e.v.y, 0.0f};
    const std::uint32_t cb = cloth_point_base();
    for (int k = 0; k < kClothGridPoints; ++k) {
        out->cur[k] = pts[cb + idx * kClothGridPoints + k].cur;
        out->prev[k] = pts[cb + idx * kClothGridPoints + k].prev;
    }
}

void VerletPass::gather_particle(std::uint32_t slot, VerletPoint* out) const {
    *out = VerletPoint{};
    if (!points_.mapped || slot >= kRootParticles) return;
    *out = static_cast<const VerletPoint*>(
        points_.mapped)[kParticlePointBase + slot];
}

void VerletPass::maybe_pin_dump(BankPin& s, const char* tag,
                                std::uint32_t elemBase,
                                std::uint32_t pointBase, std::uint32_t count,
                                std::uint32_t pointsPer) {
    (void)elemBase;
    if (verlet_pin_sims() <= 0 || s.pinDumped || count == 0) return;
    if (s.simsSinceUpload < static_cast<std::uint32_t>(verlet_pin_sims()))
        return;
    s.pinDumped = true;
    // Every counted sim was recorded AND submitted by a previous frame (one
    // sim per presented frame), so after an idle the mapped buffer holds
    // exactly the post-sim-N state.
    vkDeviceWaitIdle(dev_->device);
    const auto* pts = static_cast<const VerletPoint*>(points_.mapped);
    std::uint64_t h = 1469598103934665603ull; // FNV-1a offset basis
    for (std::uint32_t i = 0; i < count; ++i)
        for (std::uint32_t k = 0; k < pointsPer; ++k)
            h = fnv1a(&pts[pointBase + i * pointsPer + k].cur,
                      sizeof(float) * 3, h);
    const vec4 f0 = pts[pointBase + 0].cur;
    const vec4 f1 = pts[pointBase + 1].cur;
    const std::uint32_t lastBase = pointBase + (count - 1u) * pointsPer;
    const vec4 l1 = pts[lastBase + pointsPer - 2u].cur;
    const vec4 l0 = pts[lastBase + pointsPer - 1u].cur;
    std::fprintf(stderr,
                 "[verlet-pin] %s epoch=%u sims=%u elems=%u points=%u "
                 "fnv=%016llx first=(%.6f %.6f %.6f)(%.6f %.6f %.6f) "
                 "last=(%.6f %.6f %.6f)(%.6f %.6f %.6f)\n",
                 tag, s.uploadEpoch, s.simsSinceUpload, count,
                 count * pointsPer, static_cast<unsigned long long>(h), f0.x,
                 f0.y, f0.z, f1.x, f1.y, f1.z, l1.x, l1.y, l1.z, l0.x, l0.y,
                 l0.z);
    // Full positions for the tolerance-level comparison (plan §6.2): raw xyz
    // floats, exactly the hashed bytes.
    if (const char* pfx = std::getenv("GIGA_VERLET_PIN_DUMP")) {
        char path[512];
        std::snprintf(path, sizeof path, "%s_%s_e%u.bin", pfx, tag,
                      s.uploadEpoch);
        if (std::FILE* fp = std::fopen(path, "wb")) {
            for (std::uint32_t i = 0; i < count; ++i)
                for (std::uint32_t k = 0; k < pointsPer; ++k)
                    std::fwrite(&pts[pointBase + i * pointsPer + k].cur,
                                sizeof(float), 3, fp);
            std::fclose(fp);
        }
    }
}

void VerletPass::record_sim(VkCommandBuffer cmd, float dt, vec3 gravity) {
    if (simPipeline_ == VK_NULL_HANDLE) return;
    // Bank skip flags: the old per-pass GIGA_*_NOSIM A/B switches, one home.
    static const bool noWireSim = std::getenv("GIGA_WIRE_NOSIM") != nullptr;
    static const bool noParticleSim =
        std::getenv("GIGA_PARTICLE_NOSIM") != nullptr;
    const bool doAntourage =
        !noWireSim && (wireCount_ > 0 || clothCount_ > 0);
    const bool doParticles = !noParticleSim;
    if (!doAntourage && !doParticles) return;

    // Under GIGA_VERLET_PIN the step is the 60 Hz reference, not the caller's
    // frame dt: the pin hashes state after N sims, and the live dt is
    // min(frameDt, 2/60) — wall-clock, run-dependent — it would poison the
    // hash exactly like the push bodies (dropped above for the same reason).
    // GIGA_PARTICLE_PIN forces the same reference dt (same law, own counter).
    if (verlet_pin_sims() > 0 || particle_pin_sims() > 0) dt = 1.0f / 60.0f;

    maybe_pin_dump(wirePin_, "wire", 0, 0, wireCount_, kWireChainPoints);
    maybe_pin_dump(clothPin_, "cloth", wireCount_, cloth_point_base(),
                   clothCount_, kClothGridPoints);
    maybe_particle_pin_dump();

    const std::uint32_t antouragePoints =
        cloth_point_base() + clothCount_ * kClothGridPoints;
    const std::uint32_t elemCount = wireCount_ + clothCount_;

    VerletPush p{};
    p.dims = vec4{static_cast<float>(antouragePoints), 0.0f,
                  static_cast<float>(cloth_point_base()), 0.0f};
    p.sim = vec4{dt, kVerletDamping, static_cast<float>(kWorldExtent),
                 static_cast<float>(elemCount)};
    p.grav = vec4{gravity.x, gravity.y, gravity.z,
                  static_cast<float>(bodyCount_)};

    // Last frame's draws read the points; order the writes after them.
    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_HOST_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_VERTEX_SHADER_BIT |
                             VK_PIPELINE_STAGE_HOST_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mb, 0,
                         nullptr, 0, nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simLayout_, 0,
                            1, &set_, 0, nullptr);

    // Phase 0 — POINTS, two disjoint spans of the one pool, no barrier
    // between them: antourage [0..antouragePoints), particles at the fixed
    // bank base (full region always — measured free at zero alive,
    // перф-замер 2026-08-30 «частицы при нуле живых = 0.00 мс GPU»).
    if (doAntourage && antouragePoints > 0) {
        vkCmdPushConstants(cmd, simLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(VerletPush), &p);
        vkCmdDispatch(cmd, (antouragePoints + 63u) / 64u, 1, 1);
    }
    if (doParticles) {
        VerletPush pp = p;
        pp.dims.x = static_cast<float>(kRootParticles);
        pp.dims.y = static_cast<float>(kParticlePointBase);
        vkCmdPushConstants(cmd, simLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(VerletPush), &pp);
        vkCmdDispatch(cmd, (kRootParticles + 63u) / 64u, 1, 1);
        ++particleSims_;
    }

    // Constraints read what integration wrote — one compute-compute barrier.
    VkMemoryBarrier mid{};
    mid.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mid.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mid.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mid, 0,
                         nullptr, 0, nullptr);

    // Phase 1 — ELEMENTS: serial relaxation per element, thread per element.
    // Particles have no elements — «ноль связей» is absence from this
    // dispatch, not an early-out (plan §2.3).
    if (doAntourage && elemCount > 0) {
        p.dims.w = 1.0f;
        vkCmdPushConstants(cmd, simLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(VerletPush), &p);
        vkCmdDispatch(cmd, (elemCount + 63u) / 64u, 1, 1);
    }

    if (wireCount_ > 0) ++wirePin_.simsSinceUpload;
    if (clothCount_ > 0) ++clothPin_.simsSinceUpload;

    VkMemoryBarrier mb2{};
    mb2.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb2.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, 0, 1, &mb2, 0,
                         nullptr, 0, nullptr);
}

void VerletPass::spawn_particles(const GpuParticle* items,
                                 std::uint32_t count) {
    if (!points_.mapped || !aux_.mapped || items == nullptr) return;
    auto* pts = static_cast<VerletPoint*>(points_.mapped);
    auto* aux = static_cast<VerletParticleAux*>(aux_.mapped);
    particleSpawned_ += count;
    for (std::uint32_t k = 0; k < count; ++k) {
        const GpuParticle& s = items[k];
        const std::uint32_t slot = particleCursor_;
        particleCursor_ = (particleCursor_ + 1u) % kRootParticles;
        const std::uint32_t i = kParticlePointBase + slot;
        // Verlet form: velocity is implied by cur − prev over the 60 Hz
        // reference step (the pin dt — one honest constant, not a new knob).
        const float dtRef = 1.0f / 60.0f;
        pts[i].cur = vec4{s.posLife.x, s.posLife.y, s.posLife.z, 1.0f};
        pts[i].prev = vec4{s.posLife.x - s.velTotal.x * dtRef,
                           s.posLife.y - s.velTotal.y * dtRef,
                           s.posLife.z - s.velTotal.z * dtRef, s.posLife.w};
        VerletParticleAux& a = aux[slot];
        a.colorSize = s.colorSize;
        // γ = −ln(drag)·60: the CSV stays «drag per 60 Hz step», the sim
        // becomes dt-honest exp(−γ·dt) — plan §3's bonus, applied here once.
        const float drag = s.phys.y > 0.0f ? s.phys.y : 1.0f;
        a.phys = vec4{s.phys.x, -std::log(drag) * 60.0f, s.phys.z, s.phys.w};
        a.meta = vec4{s.velTotal.w, 0.0f, 0.0f, 0.0f};
    }
}

std::uint32_t VerletPass::particle_alive_count() const {
    if (!points_.mapped) return 0;
    const auto* pts = static_cast<const VerletPoint*>(points_.mapped);
    std::uint32_t n = 0;
    for (std::uint32_t i = 0; i < kRootParticles; ++i)
        if (pts[kParticlePointBase + i].prev.w > 0.0f) ++n;
    return n;
}

// GIGA_PARTICLE_PIN=N — migrated intact from the dead ParticlePass: curve of
// alive counts every 100 sims plus an FNV-1a hash of alive positions at N.
void VerletPass::maybe_particle_pin_dump() {
    const int pin = particle_pin_sims();
    if (pin <= 0 || particlePinDumped_ || particleSims_ == 0) return;
    const bool checkpoint = (particleSims_ % 100u) == 0u;
    const bool final = particleSims_ >= static_cast<std::uint32_t>(pin);
    if (!checkpoint && !final) return;
    vkDeviceWaitIdle(dev_->device);
    const auto* pts = static_cast<const VerletPoint*>(points_.mapped);
    std::uint32_t alive = 0;
    std::uint64_t h = 1469598103934665603ull; // FNV-1a offset basis
    for (std::uint32_t i = 0; i < kRootParticles; ++i) {
        const VerletPoint& q = pts[kParticlePointBase + i];
        if (q.prev.w <= 0.0f) continue;
        ++alive;
        h = fnv1a(&q.cur, sizeof(float) * 3, h);
    }
    std::fprintf(stderr, "[particle-pin] sims=%u alive=%u fnv=%016llx\n",
                 particleSims_, alive, static_cast<unsigned long long>(h));
    if (final) particlePinDumped_ = true;
}

void VerletPass::record_draw_wires(VkCommandBuffer cmd, const CubePush& push,
                                   VkDescriptorSet lightSet) {
    if (wireDrawPipeline_ == VK_NULL_HANDLE || wireCount_ == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, wireDrawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_,
                            0, 1, &set_, 0, nullptr);
    if (lightSet != VK_NULL_HANDLE && lightGridSetLayout_ != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                drawLayout_, 1, 1, &lightSet, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    const VerletDrawPush extra{cloth_point_base(), wireCount_, 0, 0};
    vkCmdPushConstants(cmd, drawLayout_, VK_SHADER_STAGE_VERTEX_BIT,
                       sizeof(CubePush), sizeof(VerletDrawPush), &extra);
    // One INSTANCE per chain: 7 segs x 2 tris x 3 verts.
    vkCmdDraw(cmd, 42u, wireCount_, 0, 0);
}

void VerletPass::record_draw_cloths(VkCommandBuffer cmd, const CubePush& push,
                                    VkDescriptorSet lightSet) {
    if (clothDrawPipeline_ == VK_NULL_HANDLE || clothCount_ == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, clothDrawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_,
                            0, 1, &set_, 0, nullptr);
    if (lightSet != VK_NULL_HANDLE && lightGridSetLayout_ != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                drawLayout_, 1, 1, &lightSet, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    const VerletDrawPush extra{cloth_point_base(), wireCount_, 0, 0};
    vkCmdPushConstants(cmd, drawLayout_, VK_SHADER_STAGE_VERTEX_BIT,
                       sizeof(CubePush), sizeof(VerletDrawPush), &extra);
    vkCmdDraw(cmd, kClothVertsPerSheet, clothCount_, 0, 0);
}

void VerletPass::record_draw_particles(VkCommandBuffer cmd,
                                       const CubePush& push,
                                       VkDescriptorSet lightSet) {
    if (particleDrawPipeline_ == VK_NULL_HANDLE) return;
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                      particleDrawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_,
                            0, 1, &set_, 0, nullptr);
    if (lightSet != VK_NULL_HANDLE && lightGridSetLayout_ != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                drawLayout_, 1, 1, &lightSet, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    const VerletDrawPush extra{cloth_point_base(), wireCount_, 0, 0};
    vkCmdPushConstants(cmd, drawLayout_, VK_SHADER_STAGE_VERTEX_BIT,
                       sizeof(CubePush), sizeof(VerletDrawPush), &extra);
    // 6 verts per billboard, full bank — dead ones clip in the vert (life
    // rides prev.w), exactly the old ParticlePass draw.
    vkCmdDraw(cmd, kRootParticles * 6u, 1, 0, 0);
}

void VerletPass::destroy() {
    if (dev_ == nullptr) return;
    VkDevice d = dev_->device;
    if (wireDrawPipeline_) vkDestroyPipeline(d, wireDrawPipeline_, nullptr);
    if (clothDrawPipeline_) vkDestroyPipeline(d, clothDrawPipeline_, nullptr);
    if (particleDrawPipeline_)
        vkDestroyPipeline(d, particleDrawPipeline_, nullptr);
    if (drawLayout_) vkDestroyPipelineLayout(d, drawLayout_, nullptr);
    if (simPipeline_) vkDestroyPipeline(d, simPipeline_, nullptr);
    if (simLayout_) vkDestroyPipelineLayout(d, simLayout_, nullptr);
    if (pool_) vkDestroyDescriptorPool(d, pool_, nullptr);
    if (setLayout_) vkDestroyDescriptorSetLayout(d, setLayout_, nullptr);
    points_.destroy(*dev_);
    elems_.destroy(*dev_);
    bodies_.destroy(*dev_);
    aux_.destroy(*dev_);
    wireDrawPipeline_ = VK_NULL_HANDLE;
    clothDrawPipeline_ = VK_NULL_HANDLE;
    particleDrawPipeline_ = VK_NULL_HANDLE;
    drawLayout_ = VK_NULL_HANDLE;
    simPipeline_ = VK_NULL_HANDLE;
    simLayout_ = VK_NULL_HANDLE;
    pool_ = VK_NULL_HANDLE;
    setLayout_ = VK_NULL_HANDLE;
    set_ = VK_NULL_HANDLE;
    dev_ = nullptr;
}

} // namespace giga::gpu
