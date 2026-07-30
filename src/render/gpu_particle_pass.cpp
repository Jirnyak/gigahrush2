// gpu_particle_pass.cpp — GPU-native particle system implementation.
//
// Vulkan object creation order:
//   1. alloc_buffers()          — DEVICE_LOCAL state/vertex/drawcmd + HOST_VISIBLE emit ring
//   2. create_descriptor_sets() — pool + set for the 4 SSBOs
//   3. create_compute_pipeline()— particles.comp.spv + compute layout/pipeline
//   4. create_graphics_pipeline()— particle.vert/frag.spv + draw layout/pipeline
//
// Hot-path (per frame):
//   emit_burst() / emit() — CPU writes into mapped emitBuf_ (HOST_COHERENT, no flush)
//   record_compute()      — vkCmdFillBuffer(drawCmdBuf_, 0), vkCmdDispatch, memory barrier
//   record_draw()         — bind pipeline, bind vertex buf, vkCmdDrawIndirect from drawCmdBuf_
//
// Zero heap allocs after init. No CPU readback. No staging copies on hot path.
//
#include "render/gpu_particle_pass.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <numbers>
#include <string>
#include <vector>

#include "render/vk_common.h"
#include "render/vk_device.h"

namespace giga::gpu {

namespace {

// ── SPIR-V loader (identical to prop_pass.cpp) ──────────────────────────────

std::string path_join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/' && s.back() != '\\') s += '/';
    s += file;
    return s;
}

bool read_spv(const char* path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) {
        std::fprintf(stderr, "[particle] cannot open %s\n", path);
        return false;
    }
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) { std::fclose(f); return false; }
    out.resize(static_cast<std::size_t>(n));
    std::size_t rd = std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return rd == static_cast<std::size_t>(n);
}

bool make_shader(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType    = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode    = reinterpret_cast<const uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

} // namespace

// ── buffer allocation ─────────────────────────────────────────────────────────

bool GpuParticlePass::alloc_buffers() noexcept {
    // Particle state — DEVICE_LOCAL, compute read/write
    // 80 bytes per particle (Particle struct in shader, padded to 80 B)
    constexpr VkDeviceSize kParticleBytes = kMaxGpuParticles * 80ull;
    // Zero-initialise so all lifetime fields start at 0 (dead)
    std::vector<char> zero(kParticleBytes, 0);
    if (!particleBuf_.create_device_local(*dev_, zero.data(), kParticleBytes,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "particle-state"))
        return false;

    // Billboard vertex output — DEVICE_LOCAL, compute write + vertex read
    // BillVertex = 4×vec4 = 64 bytes; 6 verts per particle
    constexpr VkDeviceSize kVertBytes = kMaxGpuParticles * 6ull * 64ull;
    if (!vertexBuf_.create_device_local(*dev_, nullptr, kVertBytes,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
            VK_BUFFER_USAGE_VERTEX_BUFFER_BIT  |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "particle-verts"))
        return false;

    // Indirect draw command — DEVICE_LOCAL, compute write + indirect draw source
    // VkDrawIndirectCommand = 4 × uint32 = 16 bytes
    if (!drawCmdBuf_.create_device_local(*dev_, nullptr, 16ull,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT    |
            VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT   |
            VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "particle-draw-cmd"))
        return false;

    // Emit ring buffer — HOST_VISIBLE|HOST_COHERENT, CPU write + compute read
    constexpr VkDeviceSize kEmitBytes = kMaxEmitEvents * sizeof(GpuEmitEvent);
    if (!emitBuf_.create_host_visible(*dev_, kEmitBytes,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "particle-emit-ring"))
        return false;

    // Pre-zero the emit buffer (paranoia; mapped is HOST_COHERENT)
    std::memset(emitBuf_.mapped, 0, static_cast<std::size_t>(kEmitBytes));

    std::fprintf(stderr,
        "[particle] buffers ok: state=%.1f KiB verts=%.1f KiB\n",
        kParticleBytes / 1024.0, kVertBytes / 1024.0);
    return true;
}

// ── descriptor sets ───────────────────────────────────────────────────────────

bool GpuParticlePass::create_descriptor_sets() noexcept {
    VkDevice d = dev_->device;

    // Layout: 4 storage buffers (binding 0-3)
    VkDescriptorSetLayoutBinding bindings[4]{};
    for (uint32_t i = 0; i < 4; ++i) {
        bindings[i].binding         = i;
        bindings[i].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags      = VK_SHADER_STAGE_COMPUTE_BIT;
    }
    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType        = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 4;
    dslci.pBindings    = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &computeDescLayout_));

    // Pool
    VkDescriptorPoolSize poolSize{};
    poolSize.type            = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSize.descriptorCount = 4;
    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType         = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets       = 1;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes    = &poolSize;
    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &descPool_));

    // Allocate set
    VkDescriptorSetAllocateInfo alloci{};
    alloci.sType              = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloci.descriptorPool     = descPool_;
    alloci.descriptorSetCount = 1;
    alloci.pSetLayouts        = &computeDescLayout_;
    VK_TRY(vkAllocateDescriptorSets(d, &alloci, &computeDescSet_));

    // Write bindings — order matches particles.comp layout(binding=N)
    VkBuffer bufs[4] = {
        particleBuf_.buffer,  // binding 0: particle state
        emitBuf_.buffer,      // binding 1: emit events
        drawCmdBuf_.buffer,   // binding 2: draw indirect
        vertexBuf_.buffer,    // binding 3: vertex output
    };
    VkDeviceSize sizes[4] = {
        kMaxGpuParticles * 80ull,
        kMaxEmitEvents * sizeof(GpuEmitEvent),
        16ull,
        kMaxGpuParticles * 6ull * 64ull,
    };

    VkWriteDescriptorSet writes[4]{};
    VkDescriptorBufferInfo bufi[4]{};
    for (uint32_t i = 0; i < 4; ++i) {
        bufi[i].buffer = bufs[i];
        bufi[i].offset = 0;
        bufi[i].range  = sizes[i];
        writes[i].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet          = computeDescSet_;
        writes[i].dstBinding      = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[i].pBufferInfo     = &bufi[i];
    }
    vkUpdateDescriptorSets(d, 4, writes, 0, nullptr);
    return true;
}

// ── compute pipeline ──────────────────────────────────────────────────────────

bool GpuParticlePass::create_compute_pipeline(const char* shaderDir) noexcept {
    VkDevice d = dev_->device;

    // Push constant: ParticleComputePush (40 bytes)
    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pcRange.offset     = 0;
    pcRange.size       = sizeof(ParticleComputePush);

    VkPipelineLayoutCreateInfo layoutci{};
    layoutci.sType                  = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutci.setLayoutCount         = 1;
    layoutci.pSetLayouts            = &computeDescLayout_;
    layoutci.pushConstantRangeCount = 1;
    layoutci.pPushConstantRanges    = &pcRange;
    VK_TRY(vkCreatePipelineLayout(d, &layoutci, nullptr, &computeLayout_));

    // Load SPIR-V
    std::vector<char> compSpv;
    if (!read_spv(path_join(shaderDir, "particles.comp.spv").c_str(), compSpv)) {
        std::fprintf(stderr, "[particle] particles.comp.spv not found in %s\n", shaderDir);
        return false;
    }
    VkShaderModule compMod = VK_NULL_HANDLE;
    if (!make_shader(d, compSpv, &compMod)) return false;

    VkComputePipelineCreateInfo pci{};
    pci.sType  = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pci.layout = computeLayout_;
    pci.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pci.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
    pci.stage.module = compMod;
    pci.stage.pName  = "main";

    VkResult r = vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &pci, nullptr,
                                          &computePipeline_);
    vkDestroyShaderModule(d, compMod, nullptr);
    if (r != VK_SUCCESS) {
        std::fprintf(stderr, "[particle] compute pipeline create failed: %d\n", r);
        return false;
    }
    std::fprintf(stderr, "[particle] compute pipeline ready\n");
    return true;
}

// ── graphics pipeline (billboard draw) ───────────────────────────────────────

bool GpuParticlePass::create_graphics_pipeline(VkRenderPass rp,
                                                uint32_t subpass,
                                                const char* shaderDir) noexcept {
    VkDevice d = dev_->device;

    // Push constants for draw stage: ParticleDrawPush (viewProj + cam vectors + fog)
    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;
    pcRange.offset     = 0;
    pcRange.size       = sizeof(ParticleDrawPush);

    VkPipelineLayoutCreateInfo layoutci{};
    layoutci.sType                  = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutci.pushConstantRangeCount = 1;
    layoutci.pPushConstantRanges    = &pcRange;

    // The setLayouts array MUST outlive the vkCreatePipelineLayout call.
    // Keep it in the outer scope; the if-block only decides whether to populate it.
    VkDescriptorSetLayout dummySet0 = VK_NULL_HANDLE;
    VkDescriptorSetLayout setLayouts[2] = { VK_NULL_HANDLE, VK_NULL_HANDLE };
    if (lightGridSetLayout_ != VK_NULL_HANDLE) {
        VkDescriptorSetLayoutCreateInfo li{};
        li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        vkCreateDescriptorSetLayout(d, &li, nullptr, &dummySet0);

        setLayouts[0] = dummySet0;
        setLayouts[1] = lightGridSetLayout_;
        layoutci.setLayoutCount = 2;
        layoutci.pSetLayouts    = setLayouts;
    } else {
        layoutci.setLayoutCount = 0;
    }

    VkResult layoutRes = vkCreatePipelineLayout(d, &layoutci, nullptr, &drawLayout_);
    if (dummySet0 != VK_NULL_HANDLE) {
        vkDestroyDescriptorSetLayout(d, dummySet0, nullptr);
    }
    VK_TRY(layoutRes);

    // Load shaders
    std::vector<char> vertSpv, fragSpv;
    if (!read_spv(path_join(shaderDir, "particle.vert.spv").c_str(), vertSpv)) return false;
    if (!read_spv(path_join(shaderDir, "particle.frag.spv").c_str(), fragSpv)) return false;

    VkShaderModule vertMod = VK_NULL_HANDLE, fragMod = VK_NULL_HANDLE;
    if (!make_shader(d, vertSpv, &vertMod)) return false;
    if (!make_shader(d, fragSpv, &fragMod)) { vkDestroyShaderModule(d, vertMod, nullptr); return false; }

    // Vertex binding: BillVertex = posSize(vec4) + colorAlpha(vec4) + uv(vec2) + pad(vec2) = 64 bytes
    VkVertexInputBindingDescription vbind{};
    vbind.binding   = 0;
    vbind.stride    = 64;
    vbind.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

    VkVertexInputAttributeDescription vattr[3]{};
    // location 0: posSize  (vec4, offset 0)
    vattr[0].location = 0; vattr[0].binding = 0;
    vattr[0].format   = VK_FORMAT_R32G32B32A32_SFLOAT; vattr[0].offset = 0;
    // location 1: colorAlpha (vec4, offset 16)
    vattr[1].location = 1; vattr[1].binding = 0;
    vattr[1].format   = VK_FORMAT_R32G32B32A32_SFLOAT; vattr[1].offset = 16;
    // location 2: uv (vec2, offset 32)
    vattr[2].location = 2; vattr[2].binding = 0;
    vattr[2].format   = VK_FORMAT_R32G32_SFLOAT;       vattr[2].offset = 32;

    VkPipelineVertexInputStateCreateInfo vis{};
    vis.sType                           = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vis.vertexBindingDescriptionCount   = 1;
    vis.pVertexBindingDescriptions      = &vbind;
    vis.vertexAttributeDescriptionCount = 3;
    vis.pVertexAttributeDescriptions    = vattr;

    VkPipelineInputAssemblyStateCreateInfo ias{};
    ias.sType    = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ias.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineRasterizationStateCreateInfo ras{};
    ras.sType       = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    ras.polygonMode = VK_POLYGON_MODE_FILL;
    ras.cullMode    = VK_CULL_MODE_NONE;   // both faces — billboards can face either way
    ras.frontFace   = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    ras.lineWidth   = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType                = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    // Additive blending: src=ONE dst=ONE_MINUS_SRC_ALPHA (premultiplied alpha)
    VkPipelineColorBlendAttachmentState cba{};
    cba.blendEnable         = VK_TRUE;
    cba.srcColorBlendFactor = VK_BLEND_FACTOR_ONE;
    cba.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    cba.colorBlendOp        = VK_BLEND_OP_ADD;
    cba.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    cba.dstAlphaBlendFactor = VK_BLEND_FACTOR_ZERO;
    cba.alphaBlendOp        = VK_BLEND_OP_ADD;
    cba.colorWriteMask      = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                              VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;

    VkPipelineColorBlendStateCreateInfo cbs{};
    cbs.sType           = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cbs.attachmentCount = 1;
    cbs.pAttachments    = &cba;

    // Depth test ON, depth write OFF (don't occlude world geometry with particles)
    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType            = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable  = VK_TRUE;
    ds.depthWriteEnable = VK_FALSE;
    ds.depthCompareOp   = VK_COMPARE_OP_LESS_OR_EQUAL;

    // Dynamic viewport/scissor (same as cube pass)
    VkDynamicState dynStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dyn{};
    dyn.sType             = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dyn.dynamicStateCount = 2;
    dyn.pDynamicStates    = dynStates;

    VkPipelineViewportStateCreateInfo vps{};
    vps.sType         = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vps.viewportCount = 1;
    vps.scissorCount  = 1;

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage  = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vertMod;
    stages[0].pName  = "main";
    stages[1].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage  = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fragMod;
    stages[1].pName  = "main";

    VkGraphicsPipelineCreateInfo gpci{};
    gpci.sType               = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    gpci.stageCount          = 2;
    gpci.pStages             = stages;
    gpci.pVertexInputState   = &vis;
    gpci.pInputAssemblyState = &ias;
    gpci.pViewportState      = &vps;
    gpci.pRasterizationState = &ras;
    gpci.pMultisampleState   = &ms;
    gpci.pDepthStencilState  = &ds;
    gpci.pColorBlendState    = &cbs;
    gpci.pDynamicState       = &dyn;
    gpci.layout              = drawLayout_;
    gpci.renderPass          = rp;
    gpci.subpass             = subpass;

    VkResult r = vkCreateGraphicsPipelines(d, VK_NULL_HANDLE, 1, &gpci, nullptr,
                                           &drawPipeline_);
    vkDestroyShaderModule(d, vertMod, nullptr);
    vkDestroyShaderModule(d, fragMod, nullptr);
    if (r != VK_SUCCESS) {
        std::fprintf(stderr, "[particle] graphics pipeline create failed: %d\n", r);
        return false;
    }
    std::fprintf(stderr, "[particle] graphics pipeline ready\n");
    return true;
}

// ── init ──────────────────────────────────────────────────────────────────────

bool GpuParticlePass::init(VulkanDevice* dev, VkRenderPass renderPass,
                            uint32_t subpass, const char* shaderDir,
                            VkDescriptorSetLayout lightGridSetLayout) {
    dev_ = dev;
    lightGridSetLayout_ = lightGridSetLayout;
    if (!alloc_buffers())          return false;
    if (!create_descriptor_sets()) return false;
    if (!create_compute_pipeline(shaderDir))              return false;
    if (!create_graphics_pipeline(renderPass, subpass, shaderDir)) return false;
    std::fprintf(stderr, "[particle] init complete: %u slots\n", kMaxGpuParticles);
    return true;
}

// ── emit ──────────────────────────────────────────────────────────────────────

uint32_t GpuParticlePass::emit_burst(vec3 pos, vec3 dir, vec3 color,
                                      GpuParticleKind kind,
                                      int count, float speed,
                                      float lifetime, float size,
                                      float spreadDeg) noexcept {
    if (!emitBuf_.mapped || emitQueued_ >= kMaxEmitEvents) return 0;

    const float kDeg2Rad = std::numbers::pi_v<float> / 180.0f;
    float spreadCos = std::cos(spreadDeg * kDeg2Rad * 0.5f);

    // Normalise direction
    float len = std::sqrt(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
    if (len < 1e-6f) dir = {0.0f, 1.0f, 0.0f};
    else { dir.x /= len; dir.y /= len; dir.z /= len; }

    int spawned = 0;
    for (int i = 0; i < count && emitQueued_ < kMaxEmitEvents; ++i) {
        uint32_t slot = (emitHead_ + emitQueued_) % kMaxEmitEvents;
        auto* ev = reinterpret_cast<GpuEmitEvent*>(emitBuf_.mapped) + slot;
        ev->pos       = pos;
        ev->speed     = speed;
        ev->dir       = dir;
        ev->lifetime  = lifetime;
        ev->color     = color;
        ev->size      = size;
        ev->kind      = static_cast<uint32_t>(kind);
        ev->spreadCos = spreadCos;
        ev->pad0 = ev->pad1 = 0;
        ++emitQueued_;
        ++spawned;
    }
    return static_cast<uint32_t>(spawned);
}

uint32_t GpuParticlePass::emit_destruction_burst(vec3 pos, std::uint16_t matId, int count) noexcept {
    vec3 col{0.65f, 0.62f, 0.58f};
    GpuParticleKind kind = GpuParticleKind::DustMote;
    float speed = 4.5f;
    float lifetime = 1.8f;

    switch (matId) {
        case 1:  // kMatConcrete
            col = vec3{0.65f, 0.65f, 0.65f};
            kind = GpuParticleKind::DustMote;
            break;
        case 6:  // kMatDoor / metal
        case 13: // kMatGrate / metal_grate_rusty
        case 14: // rusty_metal_03
        case 15: // rusty_corrugated_iron
            col = vec3{0.85f, 0.45f, 0.15f};
            kind = GpuParticleKind::Spark;
            speed = 7.0f;
            break;
        case 5:  // kMatExtract (emerald)
        case 7:  // kMatHubPad (cyan)
            col = vec3{0.20f, 0.85f, 0.95f};
            kind = GpuParticleKind::ElecArc;
            speed = 6.0f;
            break;
        case 0:  // Crystal / Organic
            col = vec3{0.35f, 0.85f, 0.45f};
            kind = GpuParticleKind::BioSpore;
            speed = 3.0f;
            break;
        default:
            col = vec3{0.70f, 0.65f, 0.55f};
            kind = GpuParticleKind::Smoke;
            break;
    }

    uint32_t n1 = emit_burst(pos, vec3{0.0f, 1.0f, 0.0f}, col, kind, count / 2, speed, lifetime, 0.25f, 90.0f);
    uint32_t n2 = emit_burst(pos, vec3{0.0f, 0.5f, 0.0f}, col * 0.7f, GpuParticleKind::DustMote, count / 2, speed * 0.5f, lifetime * 1.5f, 0.40f, 120.0f);
    return n1 + n2;
}

uint32_t GpuParticlePass::emit(const GpuEmitEvent& templ,
                                float rate, float dt) noexcept {
    if (!emitBuf_.mapped) return 0;
    float particlesF = rate * dt;
    int count = static_cast<int>(particlesF);
    // Stochastic remainder — cheap deterministic decision
    float frac = particlesF - static_cast<float>(count);
    uint32_t seed = emitHead_ ^ static_cast<uint32_t>(dt * 131072.0f);
    seed ^= seed >> 16; seed *= 0x45d9f3bu; seed ^= seed >> 16;
    if ((seed & 0xFFFFu) < static_cast<uint32_t>(frac * 65536.0f)) ++count;

    if (count <= 0) return 0;
    return emit_burst(templ.pos, templ.dir, templ.color,
                      static_cast<GpuParticleKind>(templ.kind),
                      count, templ.speed, templ.lifetime, templ.size,
                      std::acos(std::clamp(templ.spreadCos, -1.0f, 1.0f))
                      * (180.0f / std::numbers::pi_v<float>) * 2.0f);
}

// ── record compute ────────────────────────────────────────────────────────────

void GpuParticlePass::record_compute(VkCommandBuffer cmd,
                                      float dt, float time,
                                      const vec3& camPos) noexcept {
    // 1. Clear draw command vertex count to 0 (transfer op before compute barrier)
    vkCmdFillBuffer(cmd, drawCmdBuf_.buffer, 0, 16, 0);

    // 2. Transfer → compute barrier for drawCmdBuf_
    VkBufferMemoryBarrier bar{};
    bar.sType               = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    bar.srcAccessMask       = VK_ACCESS_TRANSFER_WRITE_BIT;
    bar.dstAccessMask       = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    bar.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    bar.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    bar.buffer              = drawCmdBuf_.buffer;
    bar.offset              = 0;
    bar.size                = 16;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 0, nullptr, 1, &bar, 0, nullptr);

    // 3. Bind compute pipeline + descriptor set
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, computePipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            computeLayout_, 0, 1, &computeDescSet_, 0, nullptr);

    // 4. Push constants
    ParticleComputePush push{};
    push.dt           = dt;
    push.time         = time;
    push.maxParticles = kMaxGpuParticles;
    push.emitCount    = emitQueued_;
    push.emitRingHead = emitHead_ % kMaxEmitEvents;
    push.camX         = camPos.x;
    push.camY         = camPos.y;
    push.camZ         = camPos.z;
    push.fogStart     = 20.0f;
    push.fogEnd       = 60.0f;
    vkCmdPushConstants(cmd, computeLayout_,
                       VK_SHADER_STAGE_COMPUTE_BIT, 0,
                       sizeof(push), &push);

    // 5. Dispatch: ceil(kMaxGpuParticles / 64) groups
    uint32_t groups = (kMaxGpuParticles + 63u) / 64u;
    vkCmdDispatch(cmd, groups, 1, 1);

    // 6. Compute → vertex/indirect barrier for BOTH vertexBuf_ and drawCmdBuf_
    VkBufferMemoryBarrier bars[2]{};
    bars[0].sType               = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    bars[0].srcAccessMask       = VK_ACCESS_SHADER_WRITE_BIT;
    bars[0].dstAccessMask       = VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT;
    bars[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    bars[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    bars[0].buffer              = vertexBuf_.buffer;
    bars[0].offset              = 0;
    bars[0].size                = VK_WHOLE_SIZE;
    bars[1]                     = bars[0];
    bars[1].dstAccessMask       = VK_ACCESS_INDIRECT_COMMAND_READ_BIT;
    bars[1].buffer              = drawCmdBuf_.buffer;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_VERTEX_INPUT_BIT | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
        0, 0, nullptr, 2, bars, 0, nullptr);

    // Advance emit ring
    emitHead_   = (emitHead_ + emitQueued_) % kMaxEmitEvents;
    emitQueued_ = 0;
}

// ── record draw ───────────────────────────────────────────────────────────────

void GpuParticlePass::record_draw(VkCommandBuffer cmd,
                                   const ParticleDrawPush& push,
                                   VkDescriptorSet lightGridSet) noexcept {
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawPipeline_);
    if (lightGridSet != VK_NULL_HANDLE) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_, 1, 1, &lightGridSet, 0, nullptr);
    }
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(push), &push);

    VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &vertexBuf_.buffer, &offset);
    vkCmdDrawIndirect(cmd, drawCmdBuf_.buffer, 0, 1, sizeof(VkDrawIndirectCommand));
}

// ── destroy ───────────────────────────────────────────────────────────────────

void GpuParticlePass::destroy() noexcept {
    if (!dev_) return;
    VkDevice d = dev_->device;
    vkDeviceWaitIdle(d);

    if (drawPipeline_    != VK_NULL_HANDLE) vkDestroyPipeline(d, drawPipeline_, nullptr);
    if (drawLayout_      != VK_NULL_HANDLE) vkDestroyPipelineLayout(d, drawLayout_, nullptr);
    if (computePipeline_ != VK_NULL_HANDLE) vkDestroyPipeline(d, computePipeline_, nullptr);
    if (computeLayout_   != VK_NULL_HANDLE) vkDestroyPipelineLayout(d, computeLayout_, nullptr);
    if (descPool_        != VK_NULL_HANDLE) vkDestroyDescriptorPool(d, descPool_, nullptr);
    if (computeDescLayout_!= VK_NULL_HANDLE)vkDestroyDescriptorSetLayout(d, computeDescLayout_, nullptr);

    particleBuf_.destroy(*dev_);
    vertexBuf_.destroy(*dev_);
    drawCmdBuf_.destroy(*dev_);
    emitBuf_.destroy(*dev_);

    drawPipeline_ = computePipeline_ = VK_NULL_HANDLE;
    drawLayout_   = computeLayout_   = VK_NULL_HANDLE;
    dev_ = nullptr;
}

} // namespace giga::gpu
