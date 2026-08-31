#include "render/verlet_pass.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "render/vk_device.h"
#include "world/types.h" // kWorldExtent — the torus period for body deltas

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

// One push block, one meaning per field — the three old SimPush structs (two
// 48 B, one 32 B, sim.w = damping OR torus period depending on the file) were
// an ODR trap waiting for exactly this merge. Mirrors verlet_sim.comp.
struct VerletPush {
    vec4 dims; // x element count, y body count, z grid W, w grid H
    vec4 sim;  // x dt, y damping, z wrap period (m), w unused
    vec4 grav; // xyz gravity vector (m/s^2), w unused — NEVER assume -Z
};
static_assert(sizeof(VerletPush) == 48,
              "sim push must stay under the 128-byte guaranteed range");

// Verlet damping per step. A LITERAL by explicit owner decision for the
// behaviour-preserving merge: deriving it from the element's mass (which the
// bake already packs into meta.z) is a SEMANTIC change and lives in its own
// increment (markoaudit/plans/verlet-merge.md §3, stage 1.5).
constexpr float kVerletDamping = 0.985f;

// --- GIGA_VERLET_PIN=N: reproducible state snapshot after N recorded sims ---
// The ONLY test surface the GPU verlet has (ctest executes no GLSL, see
// markoaudit/plans/verlet-merge.md §6). Counted in SIMS SINCE THE LAST
// upload, never frames or ticks: the --shot harness presents a run-dependent
// number of frames before travel fires, so only "sims since this floor's
// upload" is comparable across runs. Under the flag the push bodies are
// dropped too — the crowd walks nondeterministically and would poison the
// hash. Zero cost when the env var is absent. PERMANENT tool, do not remove.
int verlet_pin_sims() {
    static const int n = [] {
        const char* e = std::getenv("GIGA_VERLET_PIN");
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

bool VerletPass::init(VulkanDevice* dev, VkRenderPass renderPass,
                      const char* shaderDir, VkBuffer masksBuffer,
                      VkDescriptorSetLayout lightGridSetLayout) {
    dev_ = dev;
    lightGridSetLayout_ = lightGridSetLayout;
    if (!wire_.points.create_host_visible(
            *dev_, sizeof(GpuWireChain) * kMaxWireChains,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "wire-chains"))
        return false;
    if (!cloth_.points.create_host_visible(
            *dev_, sizeof(GpuClothSheet) * kMaxClothSheets,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "cloth-sheets"))
        return false;
    if (!bodies_.create_host_visible(*dev_, sizeof(vec4) * kMaxPushBodies,
                                     VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                     "verlet-bodies"))
        return false;

    VkDescriptorSetLayoutBinding b[3]{};
    b[0].binding = 0; // the section's elements (chains or sheets)
    b[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[0].descriptorCount = 1;
    b[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_VERTEX_BIT;
    b[1].binding = 1; // this frame's push bodies, compute only
    b[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[1].descriptorCount = 1;
    b[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    b[2].binding = 2; // VoxelMirror masks — what a severed piece lands ON
    b[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[2].descriptorCount = 1;
    b[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    VkDescriptorSetLayoutCreateInfo slci{};
    slci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    slci.bindingCount = 3;
    slci.pBindings = b;
    if (vkCreateDescriptorSetLayout(dev_->device, &slci, nullptr, &setLayout_) !=
        VK_SUCCESS)
        return false;

    // Two sets — wire and cloth — over ONE layout: only binding 0 differs.
    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 6};
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.maxSets = 2;
    pci.poolSizeCount = 1;
    pci.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pci, nullptr, &pool_) != VK_SUCCESS)
        return false;
    VkDescriptorSetLayout layouts[2] = {setLayout_, setLayout_};
    VkDescriptorSet sets[2] = {VK_NULL_HANDLE, VK_NULL_HANDLE};
    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = pool_;
    ai.descriptorSetCount = 2;
    ai.pSetLayouts = layouts;
    if (vkAllocateDescriptorSets(dev_->device, &ai, sets) != VK_SUCCESS)
        return false;
    wire_.set = sets[0];
    cloth_.set = sets[1];

    const VkBuffer pointBufs[2] = {wire_.points.buffer, cloth_.points.buffer};
    for (int si = 0; si < 2; ++si) {
        VkDescriptorBufferInfo bi[3] = {
            {pointBufs[si], 0, VK_WHOLE_SIZE},
            {bodies_.buffer, 0, VK_WHOLE_SIZE},
            {masksBuffer, 0, VK_WHOLE_SIZE},
        };
        VkWriteDescriptorSet w[3]{};
        for (int i = 0; i < 3; ++i) {
            w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[i].dstSet = sets[si];
            w[i].dstBinding = static_cast<std::uint32_t>(i);
            w[i].descriptorCount = 1;
            w[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[i].pBufferInfo = &bi[i];
        }
        vkUpdateDescriptorSets(dev_->device, 3, w, 0, nullptr);
    }

    return create_pipelines(renderPass, shaderDir);
}

bool VerletPass::create_pipelines(VkRenderPass renderPass,
                                  const char* shaderDir) {
    VkDevice d = dev_->device;

    // --- compute: ONE pipeline for both sections ---------------------------
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
        VkPushConstantRange pr{
            VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
            sizeof(CubePush)};
        // Set 1 — световая сетка (S5-долг закрыт 2026-08-21): dressing_light
        // в wire/cloth.frag читает те же лампы и кластеры, что стены.
        VkDescriptorSetLayout sls[2] = {setLayout_, lightGridSetLayout_};
        VkPipelineLayoutCreateInfo pl{};
        pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl.setLayoutCount = lightGridSetLayout_ != VK_NULL_HANDLE ? 2u : 1u;
        pl.pSetLayouts = sls;
        pl.pushConstantRangeCount = 1;
        pl.pPushConstantRanges = &pr;
        if (vkCreatePipelineLayout(d, &pl, nullptr, &drawLayout_) != VK_SUCCESS)
            return false;

        struct DrawSpec {
            const char* vert;
            const char* frag;
            VkPipeline* out;
        };
        const DrawSpec specs[2] = {
            {"wire.vert.spv", "wire.frag.spv", &wireDrawPipeline_},
            {"cloth.vert.spv", "cloth.frag.spv", &clothDrawPipeline_},
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

            VkPipelineDepthStencilStateCreateInfo ds{};
            ds.sType =
                VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
            ds.depthTestEnable = VK_TRUE;
            ds.depthWriteEnable = VK_TRUE;
            ds.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;

            VkPipelineColorBlendAttachmentState att{};
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

void VerletPass::begin_upload(Section& s) {
    // Fresh verlet state = a fresh pin epoch: the sim counter restarts so a
    // GIGA_VERLET_PIN snapshot always means "N sims after THIS upload".
    s.simsSinceUpload = 0;
    s.pinDumped = false;
    ++s.uploadEpoch;
}

void VerletPass::upload_wires(const GpuWireChain* chains, std::uint32_t count) {
    if (!wire_.points.mapped) return;
    begin_upload(wire_);
    wire_.count = count < kMaxWireChains ? count : kMaxWireChains;
    // A silent truncation reads as "the floor has this many wires" forever.
    // Say it out loud instead: the bake is already at ~800 on a padic floor.
    if (count > kMaxWireChains)
        std::fprintf(stderr,
                     "[wire] TRUNCATED: %u chains baked, cap %u — %u are NOT "
                     "drawn or simulated (raise kMaxWireChains)\n",
                     count, kMaxWireChains, count - kMaxWireChains);
    if (wire_.count > 0)
        std::memcpy(wire_.points.mapped, chains,
                    sizeof(GpuWireChain) * wire_.count);
}

void VerletPass::upload_cloths(const GpuClothSheet* sheets,
                               std::uint32_t count) {
    if (!cloth_.points.mapped) return;
    begin_upload(cloth_);
    cloth_.count = count < kMaxClothSheets ? count : kMaxClothSheets;
    // Same honesty rule as upload_wires — no silent ceiling.
    if (count > kMaxClothSheets)
        std::fprintf(stderr,
                     "[cloth] TRUNCATED: %u sheets baked, cap %u — %u are NOT "
                     "drawn or simulated (raise kMaxClothSheets)\n",
                     count, kMaxClothSheets, count - kMaxClothSheets);
    if (cloth_.count > 0)
        std::memcpy(cloth_.points.mapped, sheets,
                    sizeof(GpuClothSheet) * cloth_.count);
}

void VerletPass::write_wire_pins(const std::uint8_t* masks,
                                 std::uint32_t count) {
    if (!wire_.points.mapped) return;
    auto* c = static_cast<GpuWireChain*>(wire_.points.mapped);
    const std::uint32_t n = count < wire_.count ? count : wire_.count;
    for (std::uint32_t i = 0; i < n; ++i)
        for (int j = 0; j < kWireChainPoints; ++j)
            c[i].cur[j].w = ((masks[i] >> j) & 1u) ? 0.0f : 1.0f;
}

void VerletPass::write_cloth_pins(const std::uint32_t* masks,
                                  std::uint32_t count) {
    if (!cloth_.points.mapped) return;
    auto* c = static_cast<GpuClothSheet*>(cloth_.points.mapped);
    const std::uint32_t n = count < cloth_.count ? count : cloth_.count;
    for (std::uint32_t i = 0; i < n; ++i)
        for (int j = 0; j < kClothGridPoints; ++j)
            c[i].cur[j].w = ((masks[i] >> j) & 1u) ? 0.0f : 1.0f;
}

void VerletPass::write_wire_alive(const std::uint8_t* flags,
                                  std::uint32_t count) {
    if (!wire_.points.mapped) return;
    auto* c = static_cast<GpuWireChain*>(wire_.points.mapped);
    const std::uint32_t n = count < wire_.count ? count : wire_.count;
    for (std::uint32_t i = 0; i < n; ++i)
        c[i].meta.y = flags[i] ? 1.0f : 0.0f;
}

void VerletPass::write_cloth_alive(const std::uint8_t* flags,
                                   std::uint32_t count) {
    if (!cloth_.points.mapped) return;
    auto* c = static_cast<GpuClothSheet*>(cloth_.points.mapped);
    const std::uint32_t n = count < cloth_.count ? count : cloth_.count;
    for (std::uint32_t i = 0; i < n; ++i)
        c[i].meta.y = flags[i] ? 1.0f : 0.0f;
}

void VerletPass::upload_bodies(const vec4* bodies, std::uint32_t count) {
    if (!bodies_.mapped) return;
    // Pin protocol: the crowd is nondeterministic, so a pinned run sims
    // without push bodies — otherwise no two runs could ever hash equal.
    if (verlet_pin_sims() > 0) {
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

void VerletPass::maybe_pin_dump(Section& s, const char* tag,
                                std::uint32_t pointsPer) {
    if (verlet_pin_sims() <= 0 || s.pinDumped || s.count == 0) return;
    if (s.simsSinceUpload < static_cast<std::uint32_t>(verlet_pin_sims()))
        return;
    s.pinDumped = true;
    // Every counted sim was recorded AND submitted by a previous frame (one
    // sim per presented frame), so after an idle the mapped buffer holds
    // exactly the post-sim-N state.
    vkDeviceWaitIdle(dev_->device);
    // Element = {vec4 meta; vec4 cur[P]; vec4 prev[P]} — walked as raw vec4s,
    // the same arithmetic verlet_sim.comp uses.
    const auto* v = static_cast<const vec4*>(s.points.mapped);
    const std::uint32_t stride = 1u + 2u * pointsPer;
    std::uint64_t h = 1469598103934665603ull; // FNV-1a offset basis
    for (std::uint32_t i = 0; i < s.count; ++i)
        for (std::uint32_t k = 0; k < pointsPer; ++k)
            h = fnv1a(&v[i * stride + 1u + k], sizeof(float) * 3, h);
    const vec4 f0 = v[1];
    const vec4 f1 = v[2];
    const std::uint32_t lastBase = (s.count - 1u) * stride + 1u;
    const vec4 l1 = v[lastBase + pointsPer - 2u];
    const vec4 l0 = v[lastBase + pointsPer - 1u];
    std::fprintf(stderr,
                 "[verlet-pin] %s epoch=%u sims=%u elems=%u points=%u "
                 "fnv=%016llx first=(%.6f %.6f %.6f)(%.6f %.6f %.6f) "
                 "last=(%.6f %.6f %.6f)(%.6f %.6f %.6f)\n",
                 tag, s.uploadEpoch, s.simsSinceUpload, s.count,
                 s.count * pointsPer, static_cast<unsigned long long>(h), f0.x,
                 f0.y, f0.z, f1.x, f1.y, f1.z, l1.x, l1.y, l1.z, l0.x, l0.y,
                 l0.z);
    // Full positions for the tolerance-level comparison (plan §6.2): raw xyz
    // floats, exactly the hashed bytes.
    if (const char* pfx = std::getenv("GIGA_VERLET_PIN_DUMP")) {
        char path[512];
        std::snprintf(path, sizeof path, "%s_%s_e%u.bin", pfx, tag,
                      s.uploadEpoch);
        if (std::FILE* fp = std::fopen(path, "wb")) {
            for (std::uint32_t i = 0; i < s.count; ++i)
                for (std::uint32_t k = 0; k < pointsPer; ++k)
                    std::fwrite(&v[i * stride + 1u + k], sizeof(float), 3, fp);
            std::fclose(fp);
        }
    }
}

void VerletPass::record_section_sim(VkCommandBuffer cmd, Section& s,
                                    float gridW, float gridH, float dt,
                                    vec3 gravity) {
    if (s.count == 0) return;
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simLayout_, 0,
                            1, &s.set, 0, nullptr);
    VerletPush p{};
    p.dims = vec4{static_cast<float>(s.count), static_cast<float>(bodyCount_),
                  gridW, gridH};
    p.sim = vec4{dt, kVerletDamping, static_cast<float>(kWorldExtent), 0.0f};
    p.grav = vec4{gravity.x, gravity.y, gravity.z, 0.0f};
    vkCmdPushConstants(cmd, simLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                       sizeof(VerletPush), &p);
    vkCmdDispatch(cmd, (s.count + 63u) / 64u, 1, 1);
    ++s.simsSinceUpload;
}

void VerletPass::record_sim(VkCommandBuffer cmd, float dt, vec3 gravity) {
    if (simPipeline_ == VK_NULL_HANDLE) return;
    if (wire_.count == 0 && cloth_.count == 0) return;

    // Under GIGA_VERLET_PIN the step is the 60 Hz reference, not the caller's
    // frame dt: the pin hashes state after N sims, and the live dt is
    // min(frameDt, 2/60) — wall-clock, run-dependent — it would poison the
    // hash exactly like the push bodies (dropped above for the same reason).
    if (verlet_pin_sims() > 0) dt = 1.0f / 60.0f;

    maybe_pin_dump(wire_, "wire", kWireChainPoints);
    maybe_pin_dump(cloth_, "cloth", kClothGridPoints);

    // Last frame's draws read the points; order the writes after them. The
    // two dispatches touch disjoint buffers, so no barrier between them.
    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_HOST_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(
        cmd, VK_PIPELINE_STAGE_VERTEX_SHADER_BIT | VK_PIPELINE_STAGE_HOST_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mb, 0, nullptr, 0,
        nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simPipeline_);
    record_section_sim(cmd, wire_, static_cast<float>(kWireChainPoints), 1.0f,
                       dt, gravity);
    record_section_sim(cmd, cloth_, static_cast<float>(kClothGridW),
                       static_cast<float>(kClothGridH), dt, gravity);

    VkMemoryBarrier mb2{};
    mb2.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb2.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, 0, 1, &mb2, 0,
                         nullptr, 0, nullptr);
}

void VerletPass::record_draw_wires(VkCommandBuffer cmd, const CubePush& push,
                                VkDescriptorSet lightSet) {
    if (wireDrawPipeline_ == VK_NULL_HANDLE || wire_.count == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, wireDrawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_,
                            0, 1, &wire_.set, 0, nullptr);
    if (lightSet != VK_NULL_HANDLE && lightGridSetLayout_ != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                drawLayout_, 1, 1, &lightSet, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    vkCmdDraw(cmd, wire_.count * 42u, 1, 0, 0); // 7 segs x 2 tris x 3
}

void VerletPass::record_draw_cloths(VkCommandBuffer cmd, const CubePush& push,
                                VkDescriptorSet lightSet) {
    if (clothDrawPipeline_ == VK_NULL_HANDLE || cloth_.count == 0) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, clothDrawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_,
                            0, 1, &cloth_.set, 0, nullptr);
    if (lightSet != VK_NULL_HANDLE && lightGridSetLayout_ != VK_NULL_HANDLE)
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                drawLayout_, 1, 1, &lightSet, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    vkCmdDraw(cmd, cloth_.count * kClothVertsPerSheet, 1, 0, 0);
}

void VerletPass::destroy() {
    if (dev_ == nullptr) return;
    VkDevice d = dev_->device;
    if (wireDrawPipeline_) vkDestroyPipeline(d, wireDrawPipeline_, nullptr);
    if (clothDrawPipeline_) vkDestroyPipeline(d, clothDrawPipeline_, nullptr);
    if (drawLayout_) vkDestroyPipelineLayout(d, drawLayout_, nullptr);
    if (simPipeline_) vkDestroyPipeline(d, simPipeline_, nullptr);
    if (simLayout_) vkDestroyPipelineLayout(d, simLayout_, nullptr);
    if (pool_) vkDestroyDescriptorPool(d, pool_, nullptr);
    if (setLayout_) vkDestroyDescriptorSetLayout(d, setLayout_, nullptr);
    wire_.points.destroy(*dev_);
    cloth_.points.destroy(*dev_);
    bodies_.destroy(*dev_);
    wireDrawPipeline_ = VK_NULL_HANDLE;
    clothDrawPipeline_ = VK_NULL_HANDLE;
    drawLayout_ = VK_NULL_HANDLE;
    simPipeline_ = VK_NULL_HANDLE;
    simLayout_ = VK_NULL_HANDLE;
    pool_ = VK_NULL_HANDLE;
    setLayout_ = VK_NULL_HANDLE;
    wire_.set = VK_NULL_HANDLE;
    cloth_.set = VK_NULL_HANDLE;
    dev_ = nullptr;
}

} // namespace giga::gpu
