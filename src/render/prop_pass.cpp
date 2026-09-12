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
    layout_ = pipelineLayout;

    // Build and upload each prop mesh
    for (int s = 0; s < kPropShapeCount; ++s) {
        if (!build_prop_mesh(static_cast<PropShape>(s), *dev_, meshes_[s])) {
            std::fprintf(stderr, "[prop] mesh build failed for shape %d\n", s);
            return false;
        }
    }

    // ONE shared instance buffer per frame (src + culled), sized by the root
    // cap: kRootPropInstances × 48 B = 6 MiB each. Shapes live as ranges cut
    // by upload_instances(); range starts must be legal SSBO bind offsets, so
    // derive the alignment (in instances) from the device limit.
    {
        const VkDeviceSize minAlign =
            dev_->props.limits.minStorageBufferOffsetAlignment;
        const VkDeviceSize stride = sizeof(PropInstance); // 48
        VkDeviceSize alignBytes = stride;
        while (alignBytes % (minAlign > 0 ? minAlign : 1) != 0)
            alignBytes += stride; // lcm(stride, minAlign) by walking multiples
        alignInstances_ = static_cast<uint32_t>(alignBytes / stride);
    }

    constexpr VkDeviceSize kInstBufBytes =
        static_cast<VkDeviceSize>(kRootPropInstances) * sizeof(PropInstance);
    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        char label[64];
        std::snprintf(label, sizeof(label), "prop-inst-f%d", f);
        if (!instBuf_[f].create_host_visible(
                *dev_, kInstBufBytes,
                VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, label))
            return false;

        std::snprintf(label, sizeof(label), "prop-cull-f%d", f);
        if (!culledInstBuf_[f].create_host_visible(
                *dev_, kInstBufBytes,
                VK_BUFFER_USAGE_VERTEX_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, label))
            return false;
    }
    for (int s = 0; s < kPropShapeCount; ++s) {
        for (int f = 0; f < kMaxFramesInFlight; ++f) {
            char label[64];
            std::snprintf(label, sizeof(label), "prop-cmd-s%d-f%d", s, f);
            if (!indirectCmdBufs_[s][f].create_host_visible(
                    *dev_, 32ull,
                    VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT | VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT, label))
                return false;
        }
    }

    if (!create_pipeline(pipelineLayout, renderPass, shaderDir))
        return false;

    std::fprintf(stderr,
                 "[prop] pass ready: %d shapes as ranges of one %u-instance "
                 "buffer (%llu MiB x %d frames, range align %u inst), "
                 "visibility = GpuCullPass\n",
                 kPropShapeCount, kRootPropInstances,
                 static_cast<unsigned long long>(kInstBufBytes >> 20),
                 kMaxFramesInFlight, alignInstances_);
    return true;
}

bool PropPass::create_pipeline(VkPipelineLayout layout, VkRenderPass rp,
                               const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    if (!read_file(join(shaderDir, "prop.vert.spv"), vsrc)) return false;

    // prop.frag.spv has full emissive support; fall back to cube.frag.spv if not built yet
    std::string fpath = join(shaderDir, "prop.frag.spv");
    if (!read_file(fpath, fsrc)) {
        std::fprintf(stderr, "[prop] prop.frag.spv not found, "
                     "falling back to cube.frag.spv\n");
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
    //  loc 0 = inPos      (binding 0, PropVertex::pos)
    //  loc 1 = inNormal   (binding 0, PropVertex::normal)
    //  loc 2 = inOrigin   (binding 1, PropInstance::origin)
    //  loc 3 = inYaw      (binding 1, PropInstance::yaw)
    //  loc 4 = inColor    (binding 1, PropInstance::color)
    //  loc 5 = inMat      (binding 1, PropInstance::matId     as R8_UINT)
    //  loc 6 = inEmissive (binding 1, PropInstance::emissive  as R8_UINT)
    //  loc 7 = inFlags    (binding 1, PropInstance::flags     as R8_UINT)
    //  loc 8 = inAnimPhase(binding 1, PropInstance::animPhase as R8_UNORM)
    VkVertexInputAttributeDescription attrs[10]{};
    attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropVertex,   pos)};
    attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropVertex,   normal)};
    attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropInstance, origin)};
    attrs[3] = {3, 1, VK_FORMAT_R32_SFLOAT,        offsetof(PropInstance, yaw)};
    attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropInstance, color)};
    attrs[5] = {5, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, matId)};
    attrs[6] = {6, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, emissive)};
    attrs[7] = {7, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, flags)};
    attrs[8] = {8, 1, VK_FORMAT_R8_UNORM,          offsetof(PropInstance, animPhase)};
    attrs[9] = {9, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropInstance, scale)};

    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType                           = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount   = 2;
    vi.pVertexBindingDescriptions      = bindings;
    vi.vertexAttributeDescriptionCount = 10;
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
            indirectCmdBufs_[s][f].destroy(*dev_);
    }
    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        instBuf_[f].destroy(*dev_);
        culledInstBuf_[f].destroy(*dev_);
    }
    if (pipeline_) {
        vkDestroyPipeline(dev_->device, pipeline_, nullptr);
        pipeline_ = VK_NULL_HANDLE;
    }
    layout_ = VK_NULL_HANDLE;
    dev_ = nullptr;
}

// ─────────────────────── per-frame API ───────────────────────────────────────

void PropPass::add_instance(PropShape shape, const PropInstance& inst) {
    int s = static_cast<int>(shape);
    if (s < 0 || s >= kPropShapeCount) return;
    if (totalInst_ >= kRootPropInstances) {
        // ROOT cap full ([light-perf.md] owner decision: the only cap left,
        // and it talks). Say so ONCE per rebuild, then keep counting; the
        // total goes out at clear_instances().
        if (++overflowDropped_ == 1u)
            std::fprintf(stderr,
                         "[prop] ROOT CAP FULL: %u instances total — "
                         "everything past this is dropped this rebuild "
                         "(kRootPropInstances)\n",
                         kRootPropInstances);
        return;
    }
    cpuInst_[s].push_back(inst);
    ++totalInst_;
}

void PropPass::clear_instances() {
    // The rebuild may be torn down before a single frame ran compute_ranges();
    // the totals must not vanish with it.
    if (overflowDropped_ > 0u && !overflowReported_)
        std::fprintf(stderr,
                     "[prop] root cap overflow: dropped %u of %u submitted "
                     "instances (cap %u)\n",
                     overflowDropped_, totalInst_ + overflowDropped_,
                     kRootPropInstances);
    overflowDropped_ = 0u;
    overflowReported_ = false;
    totalInst_ = 0u;
    for (auto& v : cpuInst_) v.clear();
}

// Cut per-shape ranges over the shared buffer. Range starts are aligned to
// alignInstances_ so each start is a legal SSBO descriptor offset. Alignment
// padding can eat into the tail only when the buffer is ~full to the last few
// instances — if it does, the truncation is printed, never silent.
void PropPass::compute_ranges() {
    // First frame after an overflowing rebuild: report the final numbers ONCE
    // (add_instance already shouted when the cap was first hit).
    if (overflowDropped_ > 0u && !overflowReported_) {
        std::fprintf(stderr,
                     "[prop] root cap overflow: dropped %u of %u submitted "
                     "instances (cap %u)\n",
                     overflowDropped_, totalInst_ + overflowDropped_,
                     kRootPropInstances);
        overflowReported_ = true;
    }
    uint32_t base = 0;
    for (int s = 0; s < kPropShapeCount; ++s) {
        base = (base + alignInstances_ - 1u) / alignInstances_ * alignInstances_;
        uint32_t n = static_cast<uint32_t>(cpuInst_[s].size());
        if (base > kRootPropInstances) base = kRootPropInstances;
        if (base + n > kRootPropInstances) {
            std::fprintf(stderr,
                         "[prop] shape %d range truncated %u -> %u by "
                         "alignment padding at the root cap (%u)\n",
                         s, n, kRootPropInstances - base, kRootPropInstances);
            n = kRootPropInstances - base;
        }
        rangeBase_[s]  = base;
        rangeCount_[s] = n;
        base += n;
    }
}

void PropPass::upload_instances(uint32_t frameIndex) {
    compute_ranges();
    auto* dst = static_cast<PropInstance*>(instBuf_[frameIndex].mapped);
    if (dst == nullptr) return;
    for (int s = 0; s < kPropShapeCount; ++s) {
        if (rangeCount_[s] == 0) continue;
        std::memcpy(dst + rangeBase_[s], cpuInst_[s].data(),
                    static_cast<std::size_t>(rangeCount_[s]) * sizeof(PropInstance));
    }
}

void PropPass::record(VkCommandBuffer cmd, uint32_t frameIndex,
                      const CubePush& push, VkDescriptorSet lightGridSet,
                      VkDescriptorSet shadowSet) {
    if (!pipeline_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);
    if (layout_ != VK_NULL_HANDLE) {
        if (lightGridSet != VK_NULL_HANDLE) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 1, 1, &lightGridSet, 0, nullptr);
        }
        if (shadowSet != VK_NULL_HANDLE) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 2, 1, &shadowSet, 0, nullptr);
        }
        vkCmdPushConstants(cmd, layout_,
                           VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, sizeof(CubePush), &push);
    }

    // Extract camera position and fog radius from push constants for culling.
    const vec3  camPos   = {push.camPos.x, push.camPos.y, push.camPos.z};
    const float fogEnd   = push.fog.y;
    const float period   = push.torus.x;

    lastDrawCount_ = 0;

    if (useGpuCulling_) {
        // GPU MDI path: the caller ran upload_instances() and
        // GpuCullPass::record_cull per shape range, so culledInstBuf_ holds
        // the surviving instances at each shape's range offset and
        // indirectCmdBufs_ the per-shape draw. Visibility was decided there —
        // this loop only binds ranges and fires the indirect draws.
        for (int s = 0; s < kPropShapeCount; ++s) {
            if (rangeCount_[s] == 0) continue;
            VkBuffer     bufs[2] = {meshes_[s].vertexBuffer,
                                    culledInstBuf_[frameIndex].buffer};
            VkDeviceSize offs[2] = {0, range_offset_bytes(s)};
            vkCmdBindVertexBuffers(cmd, 0, 2, bufs, offs);
            vkCmdBindIndexBuffer(cmd, meshes_[s].indexBuffer, 0, VK_INDEX_TYPE_UINT32);
            vkCmdDrawIndexedIndirect(cmd, indirectCmdBufs_[s][frameIndex].buffer, 0, 1, sizeof(VkDrawIndexedIndirectCommand));
            lastDrawCount_ += rangeCount_[s];
        }
        return;
    }

    // CPU frustum/fog cull fallback (GIGA_NO_GPU_CULL): filter into the shared
    // instance buffer at each shape's range offset and draw direct.
    compute_ranges();
    auto* dstBase = static_cast<PropInstance*>(instBuf_[frameIndex].mapped);
    if (dstBase == nullptr) return;
    for (int s = 0; s < kPropShapeCount; ++s) {
        const auto& src = cpuInst_[s];
        if (rangeCount_[s] == 0) continue;

        auto* dst = dstBase + rangeBase_[s];
        uint32_t count = 0;

        for (const auto& inst : src) {
            float dx = inst.origin.x - camPos.x;
            float dy = inst.origin.y - camPos.y;
            float dz = inst.origin.z - camPos.z;

            // Wrap each component to nearest image
            dx -= period * std::floor(dx / period + 0.5f);
            dy -= period * std::floor(dy / period + 0.5f);
            dz -= period * std::floor(dz / period + 0.5f);
            // Nearest point of the instance bounds, mirroring cull.comp — a
            // centre-only test culled long legs whose near end was in view.
            const float boundR =
                0.5f * std::sqrt(inst.scale.x * inst.scale.x +
                                 inst.scale.y * inst.scale.y +
                                 inst.scale.z * inst.scale.z) +
                0.1f;
            const float dist = std::sqrt(dx * dx + dy * dy + dz * dz) - boundR;
            if (dist > fogEnd) continue; // entirely fogged to black

            dst[count++] = inst;
            if (count >= rangeCount_[s]) break;
        }
        if (count == 0) continue;

        // Bind vertex + instance buffers (at the shape's range) and draw
        VkBuffer     bufs[2] = {meshes_[s].vertexBuffer, instBuf_[frameIndex].buffer};
        VkDeviceSize offs[2] = {0, range_offset_bytes(s)};
        vkCmdBindVertexBuffers(cmd, 0, 2, bufs, offs);
        vkCmdBindIndexBuffer(cmd, meshes_[s].indexBuffer, 0,
                             VK_INDEX_TYPE_UINT32);
        vkCmdDrawIndexed(cmd, meshes_[s].indexCount, count, 0, 0, 0);
        lastDrawCount_ += count;
    }
}

} // namespace giga::gpu

