// gpu_cull_pass.cpp — GPU Compute Frustum & Distance Culling Pass Implementation.
#include "render/gpu_cull_pass.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "render/vk_common.h"
#include "render/vk_device.h"

namespace giga::gpu {

namespace {

std::string path_join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/' && s.back() != '\\') s += '/';
    s += file;
    return s;
}

bool read_spv(const char* path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) {
        std::fprintf(stderr, "[cull] cannot open %s\n", path);
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

bool GpuCullPass::init(VulkanDevice* dev, const char* shaderDir) noexcept {
    dev_ = dev;

    if (!create_descriptor_set_layout()) return false;
    if (!create_compute_pipeline(shaderDir)) return false;

    std::fprintf(stderr, "[cull] pass ready (frustum & distance culling pipeline ok)\n");
    return true;
}

void GpuCullPass::destroy() noexcept {
    if (!dev_ || dev_->device == VK_NULL_HANDLE) return;
    VkDevice d = dev_->device;

    if (pipeline_)       { vkDestroyPipeline(d, pipeline_, nullptr); pipeline_ = VK_NULL_HANDLE; }
    if (pipelineLayout_) { vkDestroyPipelineLayout(d, pipelineLayout_, nullptr); pipelineLayout_ = VK_NULL_HANDLE; }
    if (descPool_)       { vkDestroyDescriptorPool(d, descPool_, nullptr); descPool_ = VK_NULL_HANDLE; }
    if (descSetLayout_)  { vkDestroyDescriptorSetLayout(d, descSetLayout_, nullptr); descSetLayout_ = VK_NULL_HANDLE; }
}

bool GpuCullPass::create_descriptor_set_layout() noexcept {
    VkDevice d = dev_->device;

    // Binding 0: Input instances SSBO
    // Binding 1: Output culled instances SSBO
    // Binding 2: Indirect draw command SSBO
    VkDescriptorSetLayoutBinding bindings[3]{};
    for (uint32_t i = 0; i < 3; ++i) {
        bindings[i].binding         = i;
        bindings[i].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags      = VK_SHADER_STAGE_COMPUTE_BIT;
    }

    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType        = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 3;
    dslci.pBindings    = bindings;

    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &descSetLayout_));

    // Кольцо сетов ВЫВЕДЕНО (К5-C7, аудит 2026-08-26; было «64» из
    // воздуха): диспатчей кулла за кадр максимум kPropShapeCount, кадров в
    // полёте kMaxFramesInFlight, x2 запас на повторный record кадра
    // (ресайз/OUT_OF_DATE). Рост шейпов больше не сможет молча начать
    // переиспользовать сет в полёте.
    constexpr uint32_t kCullSetRing =
        static_cast<uint32_t>(kPropShapeCount) * kMaxFramesInFlight * 2;
    VkDescriptorPoolSize poolSize{};
    poolSize.type            = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSize.descriptorCount = kCullSetRing * 3;

    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType         = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets       = kCullSetRing;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes    = &poolSize;

    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &descPool_));

    std::vector<VkDescriptorSetLayout> layouts(kCullSetRing, descSetLayout_);
    VkDescriptorSetAllocateInfo alloci{};
    alloci.sType              = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloci.descriptorPool     = descPool_;
    alloci.descriptorSetCount = kCullSetRing;
    alloci.pSetLayouts        = layouts.data();

    descSets_.resize(kCullSetRing);
    VK_TRY(vkAllocateDescriptorSets(d, &alloci, descSets_.data()));
    return true;
}

bool GpuCullPass::create_compute_pipeline(const char* shaderDir) noexcept {
    VkDevice d = dev_->device;

    std::string spvPath = path_join(shaderDir, "cull.comp.spv");
    std::vector<char> spv;
    if (!read_spv(spvPath.c_str(), spv)) return false;

    VkShaderModule compModule = VK_NULL_HANDLE;
    if (!make_shader(d, spv, &compModule)) return false;

    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pcRange.offset     = 0;
    pcRange.size       = sizeof(CullPush);

    VkPipelineLayoutCreateInfo layoutci{};
    layoutci.sType                  = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutci.setLayoutCount         = 1;
    layoutci.pSetLayouts            = &descSetLayout_;
    layoutci.pushConstantRangeCount = 1;
    layoutci.pPushConstantRanges    = &pcRange;

    VkResult r = vkCreatePipelineLayout(d, &layoutci, nullptr, &pipelineLayout_);
    if (r != VK_SUCCESS) {
        vkDestroyShaderModule(d, compModule, nullptr);
        return false;
    }

    VkComputePipelineCreateInfo pipeci{};
    pipeci.sType        = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipeci.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipeci.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
    pipeci.stage.module = compModule;
    pipeci.stage.pName  = "main";
    pipeci.layout       = pipelineLayout_;

    r = vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &pipeci, nullptr, &pipeline_);
    vkDestroyShaderModule(d, compModule, nullptr);

    return r == VK_SUCCESS;
}

void GpuCullPass::record_cull(VkCommandBuffer cmd,
                              const mat4& viewProj,
                              const vec3& camPos,
                              float fogEnd,
                              float torusPeriod,
                              VkBuffer srcInstanceBuf,
                              VkDeviceSize srcOffsetBytes,
                              uint32_t instanceCount,
                              uint32_t indexCount,
                              uint32_t firstIndex,
                              int32_t vertexOffset,
                              uint32_t firstInstance,
                              VkBuffer outCulledInstanceBuf,
                              VkDeviceSize dstOffsetBytes,
                              VkBuffer outIndirectBuf) noexcept {
    if (!pipeline_ || instanceCount == 0) return;

    // 1. Reset instanceCount field (offset 4, 4 bytes) in the indirect command buffer to 0
    vkCmdFillBuffer(cmd, outIndirectBuf, offsetof(GpuDrawIndexedIndirectCommand, instanceCount), sizeof(uint32_t), 0);

    // Barrier: Transfer write -> Compute shader read/write
    VkMemoryBarrier mb1{};
    mb1.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb1.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    mb1.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &mb1, 0, nullptr, 0, nullptr);

    // 2. Bind compute pipeline and update/bind descriptor set
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);

    VkDescriptorSet set = descSets_[setHead_ % descSets_.size()];
    ++setHead_;

    // Bind each shape's RANGE of the shared instance buffers via descriptor
    // offsets — the shader indexes from 0 inside its range, so cull.comp
    // needed no change. The culled write stays inside the range by
    // construction: at most `instanceCount` survivors are appended.
    const VkDeviceSize rangeBytes =
        static_cast<VkDeviceSize>(instanceCount) * sizeof(PropInstance);
    VkDescriptorBufferInfo b0{srcInstanceBuf, srcOffsetBytes, rangeBytes};
    VkDescriptorBufferInfo b1{outCulledInstanceBuf, dstOffsetBytes, rangeBytes};
    VkDescriptorBufferInfo b2{outIndirectBuf, 0, VK_WHOLE_SIZE};

    VkWriteDescriptorSet writes[3]{};
    for (uint32_t i = 0; i < 3; ++i) {
        writes[i].sType           = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet          = set;
        writes[i].dstBinding      = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType  = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    }
    writes[0].pBufferInfo = &b0;
    writes[1].pBufferInfo = &b1;
    writes[2].pBufferInfo = &b2;

    vkUpdateDescriptorSets(dev_->device, 3, writes, 0, nullptr);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1, &set, 0, nullptr);

    // 3. Prepare Push Constants
    CullPush push{};
    push.viewProj      = viewProj;
    push.camPos        = vec4{camPos.x, camPos.y, camPos.z, fogEnd};
    push.params        = vec4{torusPeriod, static_cast<float>(vertexOffset),
                              0.0f, 0.0f};
    push.objectCount   = instanceCount;
    push.indexCount    = indexCount;
    push.firstIndex    = firstIndex;
    push.firstInstance = firstInstance;

    vkCmdPushConstants(cmd, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(CullPush), &push);

    // 4. Dispatch compute kernel
    uint32_t groupX = (instanceCount + 63u) / 64u;
    vkCmdDispatch(cmd, groupX, 1, 1);

    // 5. Barrier: Compute shader write -> Indirect draw command & vertex buffer read
    VkMemoryBarrier mb2{};
    mb2.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb2.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb2.dstAccessMask = VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_VERTEX_ATTRIBUTE_READ_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_VERTEX_INPUT_BIT,
                         0, 1, &mb2, 0, nullptr, 0, nullptr);
}


} // namespace giga::gpu
