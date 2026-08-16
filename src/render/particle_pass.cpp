#include "render/particle_pass.h"

#include <cstdio>
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

struct SimPush {
    vec4 sim;  // x dt, y unused, z particle count, w wrap period (m)
    vec4 grav; // xyz gravity vector (m/s^2), w unused — NEVER assume -Z
};
static_assert(sizeof(SimPush) == 32,
              "sim push must stay under the 128-byte guaranteed range");

} // namespace

bool ParticlePass::init(VulkanDevice* dev, VkRenderPass renderPass,
                        const char* shaderDir, VkBuffer masksBuffer) {
    dev_ = dev;
    if (!pool_.create_host_visible(*dev_, sizeof(GpuParticle) * kMaxParticles,
                                   VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                   "particle-pool"))
        return false;
    // Everything starts dead: life <= 0 skips the sim and clips the draw.
    std::memset(pool_.mapped, 0, sizeof(GpuParticle) * kMaxParticles);

    VkDescriptorSetLayoutBinding b[2]{};
    b[0].binding = 0; // the pool
    b[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[0].descriptorCount = 1;
    b[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_VERTEX_BIT;
    b[1].binding = 1; // VoxelMirror masks — collision truth, compute only
    b[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    b[1].descriptorCount = 1;
    b[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    VkDescriptorSetLayoutCreateInfo slci{};
    slci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    slci.bindingCount = 2;
    slci.pBindings = b;
    if (vkCreateDescriptorSetLayout(dev_->device, &slci, nullptr, &setLayout_) !=
        VK_SUCCESS)
        return false;

    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 2};
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.maxSets = 1;
    pci.poolSizeCount = 1;
    pci.pPoolSizes = &ps;
    if (vkCreateDescriptorPool(dev_->device, &pci, nullptr, &descPool_) !=
        VK_SUCCESS)
        return false;
    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = descPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &setLayout_;
    if (vkAllocateDescriptorSets(dev_->device, &ai, &set_) != VK_SUCCESS)
        return false;

    VkDescriptorBufferInfo bi[2] = {
        {pool_.buffer, 0, VK_WHOLE_SIZE},
        {masksBuffer, 0, VK_WHOLE_SIZE},
    };
    VkWriteDescriptorSet w[2]{};
    for (int i = 0; i < 2; ++i) {
        w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        w[i].dstSet = set_;
        w[i].dstBinding = static_cast<std::uint32_t>(i);
        w[i].descriptorCount = 1;
        w[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        w[i].pBufferInfo = &bi[i];
    }
    vkUpdateDescriptorSets(dev_->device, 2, w, 0, nullptr);

    return create_pipelines(renderPass, shaderDir);
}

bool ParticlePass::create_pipelines(VkRenderPass renderPass,
                                    const char* shaderDir) {
    VkDevice d = dev_->device;

    // --- compute -----------------------------------------------------------
    {
        VkPushConstantRange pr{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(SimPush)};
        VkPipelineLayoutCreateInfo pl{};
        pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl.setLayoutCount = 1;
        pl.pSetLayouts = &setLayout_;
        pl.pushConstantRangeCount = 1;
        pl.pPushConstantRanges = &pr;
        if (vkCreatePipelineLayout(d, &pl, nullptr, &simLayout_) != VK_SUCCESS)
            return false;

        std::vector<char> spv;
        if (!read_file(join(shaderDir, "particle_sim.comp.spv"), spv)) {
            std::fprintf(stderr, "[particle] particle_sim.comp.spv missing\n");
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

    // --- graphics (alpha-blended billboards) -------------------------------
    {
        VkPushConstantRange pr{
            VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0,
            sizeof(CubePush)};
        VkPipelineLayoutCreateInfo pl{};
        pl.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl.setLayoutCount = 1;
        pl.pSetLayouts = &setLayout_;
        pl.pushConstantRangeCount = 1;
        pl.pPushConstantRanges = &pr;
        if (vkCreatePipelineLayout(d, &pl, nullptr, &drawLayout_) != VK_SUCCESS)
            return false;

        std::vector<char> vs, fs;
        if (!read_file(join(shaderDir, "particle.vert.spv"), vs) ||
            !read_file(join(shaderDir, "particle.frag.spv"), fs)) {
            std::fprintf(stderr, "[particle] particle shaders missing\n");
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
        vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;

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
        rs.cullMode = VK_CULL_MODE_NONE;
        rs.lineWidth = 1.0f;

        VkPipelineMultisampleStateCreateInfo ms{};
        ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
        ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

        // Depth TEST against the solid world, no WRITE: translucent sprites
        // must not punch holes in each other's blending.
        VkPipelineDepthStencilStateCreateInfo ds{};
        ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
        ds.depthTestEnable = VK_TRUE;
        ds.depthWriteEnable = VK_FALSE;
        ds.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;

        VkPipelineColorBlendAttachmentState att{};
        att.blendEnable = VK_TRUE;
        att.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
        att.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
        att.colorBlendOp = VK_BLEND_OP_ADD;
        att.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
        att.dstAlphaBlendFactor = VK_BLEND_FACTOR_ZERO;
        att.alphaBlendOp = VK_BLEND_OP_ADD;
        att.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
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
                                                  nullptr, &drawPipeline_) ==
                        VK_SUCCESS;
        vkDestroyShaderModule(d, vm, nullptr);
        vkDestroyShaderModule(d, fm, nullptr);
        if (!ok) return false;
    }
    return true;
}

void ParticlePass::spawn(const GpuParticle* items, std::uint32_t count) {
    if (!pool_.mapped || count == 0) return;
    auto* p = static_cast<GpuParticle*>(pool_.mapped);
    for (std::uint32_t i = 0; i < count; ++i) {
        p[cursor_] = items[i];
        cursor_ = (cursor_ + 1u) % kMaxParticles;
    }
    spawnedTotal_ += count;
}

void ParticlePass::record_sim(VkCommandBuffer cmd, float dt, vec3 gravity) {
    if (simPipeline_ == VK_NULL_HANDLE) return;

    // Last frame's draw read the pool; order this write after it. Also order CPU host writes.
    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_HOST_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_VERTEX_SHADER_BIT | VK_PIPELINE_STAGE_HOST_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mb, 0,
                         nullptr, 0, nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, simLayout_, 0,
                            1, &set_, 0, nullptr);
    SimPush p{};
    p.sim = vec4{dt, 0.0f, static_cast<float>(kMaxParticles),
                 static_cast<float>(kWorldExtent)};
    p.grav = vec4{gravity.x, gravity.y, gravity.z, 0.0f};
    vkCmdPushConstants(cmd, simLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                       sizeof(SimPush), &p);
    vkCmdDispatch(cmd, (kMaxParticles + 63u) / 64u, 1, 1);

    VkMemoryBarrier mb2{};
    mb2.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb2.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb2.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, 0, 1, &mb2, 0,
                         nullptr, 0, nullptr);
}

void ParticlePass::record_draw(VkCommandBuffer cmd, const CubePush& push) {
    if (drawPipeline_ == VK_NULL_HANDLE) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawPipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, drawLayout_, 0,
                            1, &set_, 0, nullptr);
    vkCmdPushConstants(cmd, drawLayout_,
                       VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                       0, sizeof(CubePush), &push);
    vkCmdDraw(cmd, kMaxParticles * 6u, 1, 0, 0); // one quad per particle
}

void ParticlePass::destroy() {
    if (dev_ == nullptr) return;
    VkDevice d = dev_->device;
    if (drawPipeline_) vkDestroyPipeline(d, drawPipeline_, nullptr);
    if (drawLayout_) vkDestroyPipelineLayout(d, drawLayout_, nullptr);
    if (simPipeline_) vkDestroyPipeline(d, simPipeline_, nullptr);
    if (simLayout_) vkDestroyPipelineLayout(d, simLayout_, nullptr);
    if (descPool_) vkDestroyDescriptorPool(d, descPool_, nullptr);
    if (setLayout_) vkDestroyDescriptorSetLayout(d, setLayout_, nullptr);
    pool_.destroy(*dev_);
    drawPipeline_ = VK_NULL_HANDLE;
    drawLayout_ = VK_NULL_HANDLE;
    simPipeline_ = VK_NULL_HANDLE;
    simLayout_ = VK_NULL_HANDLE;
    descPool_ = VK_NULL_HANDLE;
    setLayout_ = VK_NULL_HANDLE;
    dev_ = nullptr;
}

} // namespace giga::gpu
