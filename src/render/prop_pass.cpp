#include "render/prop_pass.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "core/math.h"


namespace giga::gpu {

namespace {

std::string join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/') s += '/';
    s += file;
    return s;
}

bool read_file(const std::string& path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) {
        std::fprintf(stderr, "[prop] cannot open %s\n", path.c_str());
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

bool make_module(VkDevice dev, const std::vector<char>& spv, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType    = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = spv.size();
    ci.pCode    = reinterpret_cast<const uint32_t*>(spv.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

} // namespace

// ─────────────────────── init / destroy ──────────────────────────────────────

bool PropPass::init(VulkanDevice* dev, VkPipelineLayout pipelineLayout,
                    VkRenderPass renderPass, const char* shaderDir) {
    dev_ = dev;

    // Build and upload each prop mesh
    for (int s = 0; s < kPropShapeCount; ++s) {
        if (!build_prop_mesh(static_cast<PropShape>(s), *dev_, meshes_[s])) {
            std::fprintf(stderr, "[prop] mesh build failed for shape %d\n", s);
            return false;
        }
    }

    // Allocate per-shape × per-frame instance buffers (host-visible)
    constexpr VkDeviceSize kInstBufBytes =
        static_cast<VkDeviceSize>(kMaxPropInstances) * sizeof(PropInstance);
    for (int s = 0; s < kPropShapeCount; ++s) {
        for (int f = 0; f < kMaxFramesInFlight; ++f) {
            char label[64];
            std::snprintf(label, sizeof(label), "prop-inst-s%d-f%d", s, f);
            if (!instBufs_[s][f].create_host_visible(
                    *dev_, kInstBufBytes,
                    VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, label))
                return false;
        }
    }

    if (!create_pipeline(pipelineLayout, renderPass, shaderDir))
        return false;

    std::fprintf(stderr, "[prop] pass ready: %d shapes, %d frames in flight\n",
                 kPropShapeCount, kMaxFramesInFlight);
    return true;
}

bool PropPass::create_pipeline(VkPipelineLayout layout, VkRenderPass rp,
                               const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    if (!read_file(join(shaderDir, "prop.vert.spv"), vsrc))    return false;

    // Reuse the textured fragment variant when available, fall back to plain
    std::string fpath = join(shaderDir, "cube_tex.frag.spv");
    if (!read_file(fpath, fsrc)) {
        std::fprintf(stderr, "[prop] cube_tex.frag.spv not found, "
                     "trying cube.frag.spv\n");
        if (!read_file(join(shaderDir, "cube.frag.spv"), fsrc))
            return false;
    }

    VkShaderModule vs = VK_NULL_HANDLE, fs = VK_NULL_HANDLE;
    if (!make_module(dev_->device, vsrc, &vs)) return false;
    if (!make_module(dev_->device, fsrc, &fs)) {
        vkDestroyShaderModule(dev_->device, vs, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage  = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vs;
    stages[0].pName  = "main";
    stages[1].sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage  = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fs;
    stages[1].pName  = "main";

    // Binding 0: per-vertex PropVertex  (VK_VERTEX_INPUT_RATE_VERTEX)
    // Binding 1: per-instance PropInstance (VK_VERTEX_INPUT_RATE_INSTANCE)
    VkVertexInputBindingDescription bindings[2]{};
    bindings[0].binding   = 0;
    bindings[0].stride    = sizeof(PropVertex);
    bindings[0].inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    bindings[1].binding   = 1;
    bindings[1].stride    = sizeof(PropInstance);
    bindings[1].inputRate = VK_VERTEX_INPUT_RATE_INSTANCE;

    // Attribute layout must match prop.vert exactly:
    //  loc 0 = inPos    (binding 0, PropVertex::pos)
    //  loc 1 = inNormal (binding 0, PropVertex::normal)
    //  loc 2 = inOrigin (binding 1, PropInstance::origin)
    //  loc 3 = inYaw    (binding 1, PropInstance::yaw)
    //  loc 4 = inColor  (binding 1, PropInstance::color)
    //  loc 5 = inMat    (binding 1, PropInstance::matId as uint)
    VkVertexInputAttributeDescription attrs[6]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT,  offsetof(PropVertex,   pos)};
    attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT,  offsetof(PropVertex,   normal)};
    attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT,  offsetof(PropInstance, origin)};
    attrs[3] = {3, 1, VK_FORMAT_R32_SFLOAT,         offsetof(PropInstance, yaw)};
    attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT,  offsetof(PropInstance, color)};
    attrs[5] = {5, 1, VK_FORMAT_R8_UINT,            offsetof(PropInstance, matId)};

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType                           = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount   = 2;
    vi.pVertexBindingDescriptions      = bindings;
    vi.vertexAttributeDescriptionCount = 6;
    vi.pVertexAttributeDescriptions    = attrs;

    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType    = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType         = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount  = 1;

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType       = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode    = VK_CULL_MODE_BACK_BIT;
    rs.frontFace   = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth   = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType               = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                       | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable    = VK_FALSE;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType           = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments    = &cba;

    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType            = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable  = VK_TRUE;
    ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp   = VK_COMPARE_OP_LESS;

    VkDynamicState dyn[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dsi{};
    dsi.sType             = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dsi.dynamicStateCount = 2;
    dsi.pDynamicStates    = dyn;

    VkGraphicsPipelineCreateInfo gp{};
    gp.sType               = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    gp.stageCount          = 2;
    gp.pStages             = stages;
    gp.pVertexInputState   = &vi;
    gp.pInputAssemblyState = &ia;
    gp.pViewportState      = &vp;
    gp.pRasterizationState = &rs;
    gp.pMultisampleState   = &ms;
    gp.pColorBlendState    = &cb;
    gp.pDepthStencilState  = &ds;
    gp.pDynamicState       = &dsi;
    gp.layout              = layout;
    gp.renderPass          = rp;
    gp.subpass             = 0;

    bool ok = vkCreateGraphicsPipelines(dev_->device, VK_NULL_HANDLE, 1, &gp,
                                        nullptr, &pipeline_) == VK_SUCCESS;
    vkDestroyShaderModule(dev_->device, vs, nullptr);
    vkDestroyShaderModule(dev_->device, fs, nullptr);
    if (!ok) std::fprintf(stderr, "[prop] pipeline creation failed\n");
    return ok;
}

void PropPass::destroy() {
    if (!dev_) return;
    for (int s = 0; s < kPropShapeCount; ++s) {
        meshes_[s].destroy(dev_->device);
        for (int f = 0; f < kMaxFramesInFlight; ++f)
            instBufs_[s][f].destroy(*dev_);
    }
    if (pipeline_) {
        vkDestroyPipeline(dev_->device, pipeline_, nullptr);
        pipeline_ = VK_NULL_HANDLE;
    }
    dev_ = nullptr;
}

// ─────────────────────── per-frame API ───────────────────────────────────────

void PropPass::add_instance(PropShape shape, const PropInstance& inst) {
    int s = static_cast<int>(shape);
    if (s < 0 || s >= kPropShapeCount) return;
    if (static_cast<int>(cpuInst_[s].size()) < kMaxPropInstances)
        cpuInst_[s].push_back(inst);
}

void PropPass::clear_instances() {
    for (auto& v : cpuInst_) v.clear();
}

void PropPass::record(VkCommandBuffer cmd, uint32_t frameIndex,
                      const CubePush& push) {
    if (!pipeline_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);

    // Extract camera position and fog radius from push constants for culling.
    const vec3  camPos   = {push.camPos.x, push.camPos.y, push.camPos.z};
    const float fogEnd   = push.fog.y;
    const float fogEndSq = fogEnd * fogEnd;
    const float period   = push.torus.x;

    lastDrawCount_ = 0;
    for (int s = 0; s < kPropShapeCount; ++s) {
        const auto& src = cpuInst_[s];
        if (src.empty()) continue;

        // CPU frustum/fog cull: skip instances that are completely fogged out.
        // This keeps GPU draw calls proportional to visible props, not total count.
        // Also enforces the kMaxPropInstances hard cap per shape per frame.
        auto& buf = instBufs_[s][frameIndex];
        auto* dst = static_cast<PropInstance*>(buf.mapped);
        uint32_t count = 0;

        for (const auto& inst : src) {
            float dx = inst.origin.x - camPos.x;
            float dy = inst.origin.y - camPos.y;
            float dz = inst.origin.z - camPos.z;

            // Wrap each component to nearest image
            dx -= period * std::floor(dx / period + 0.5f);
            dy -= period * std::floor(dy / period + 0.5f);
            dz -= period * std::floor(dz / period + 0.5f);
            float distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > fogEndSq) continue; // entirely fogged to black

            dst[count++] = inst;
            if (count >= static_cast<uint32_t>(kMaxPropInstances)) break;
        }
        if (count == 0) continue;

        // Bind vertex + instance buffers and draw
        VkBuffer     bufs[2] = {meshes_[s].vertexBuffer, buf.buffer};
        VkDeviceSize offs[2] = {0, 0};
        vkCmdBindVertexBuffers(cmd, 0, 2, bufs, offs);
        vkCmdBindIndexBuffer(cmd, meshes_[s].indexBuffer, 0,
                             VK_INDEX_TYPE_UINT32);
        vkCmdDrawIndexed(cmd, meshes_[s].indexCount, count, 0, 0, 0);
        lastDrawCount_ += count;
    }
}

} // namespace giga::gpu

