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

static constexpr uint32_t kMaxCullDescriptorSets = 64;

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
                              uint32_t instanceCount,
                              uint32_t indexCount,
                              uint32_t firstIndex,
                              int32_t vertexOffset,
                              uint32_t firstInstance,
                              const vec3& boxMin,
                              const vec3& boxMax,
                              VkBuffer outCulledInstanceBuf,
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

    // 2. Bind compute pipeline
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);

    // 3. Prepare Push Constants
    CullPush push{};
    push.viewProj      = viewProj;
    push.camPos        = vec4{camPos.x, camPos.y, camPos.z, fogEnd};
    push.boxMinExt     = vec4{boxMin.x, boxMin.y, boxMin.z, torusPeriod};
    push.boxMaxParams  = vec4{boxMax.x, boxMax.y, boxMax.z, static_cast<float>(vertexOffset)};
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

void GpuCullPass::get_shape_aabb(PropShape shape, vec3& outMin, vec3& outMax) noexcept {
    switch (shape) {
    case PropShape::Cylinder:
        outMin = {-0.30f, 0.00f, -0.30f};
        outMax = { 0.30f, 2.00f,  0.30f};
        break;
    case PropShape::HalfCylinder:
        outMin = {-0.40f, 0.00f, -0.40f};
        outMax = { 0.40f, 2.00f,  0.40f};
        break;
    case PropShape::Arch:
        outMin = {-1.00f, 0.00f, -0.25f};
        outMax = { 1.00f, 1.00f,  0.25f};
        break;
    case PropShape::Barrel:
        outMin = {-0.35f, 0.00f, -0.35f};
        outMax = { 0.35f, 0.80f,  0.35f};
        break;
    case PropShape::StairStep:
        outMin = {-1.00f, 0.00f, -0.20f};
        outMax = { 1.00f, 0.25f,  0.20f};
        break;
    case PropShape::Pipe:
        outMin = {-0.15f, -0.15f, 0.00f};
        outMax = { 0.15f,  0.15f, 2.00f};
        break;
    case PropShape::PipeElbow:
        outMin = {-0.45f, -0.45f, -0.15f};
        outMax = { 0.45f,  0.45f,  0.15f};
        break;
    case PropShape::PipeTee:
        outMin = {-1.00f, -0.15f, -0.15f};
        outMax = { 1.00f,  0.15f,  0.15f};
        break;
    case PropShape::Valve:
        outMin = {-0.25f, -0.25f, -0.25f};
        outMax = { 0.25f,  0.25f,  0.25f};
        break;
    case PropShape::Grate:
        outMin = {-1.00f, 0.00f, -1.00f};
        outMax = { 1.00f, 0.05f,  1.00f};
        break;
    case PropShape::RoundGrate:
        outMin = {-0.50f, 0.00f, -0.50f};
        outMax = { 0.50f, 0.05f,  0.50f};
        break;
    case PropShape::CabinetBox:
        outMin = {-0.20f, 0.00f, -0.10f};
        outMax = { 0.20f, 1.80f,  0.10f};
        break;
    case PropShape::ControlPanel:
        outMin = {-0.60f, 0.00f, -0.20f};
        outMax = { 0.60f, 1.00f,  0.20f};
        break;
    case PropShape::Railing:
        outMin = {-1.00f, 0.00f, -0.10f};
        outMax = { 1.00f, 1.10f,  0.10f};
        break;
    case PropShape::SupportBeam:
        outMin = {-0.20f, 0.00f, -0.20f};
        outMax = { 0.20f, 4.00f,  0.20f};
        break;
    case PropShape::CrateBox:
        outMin = {-0.30f, 0.00f, -0.30f};
        outMax = { 0.30f, 0.60f,  0.30f};
        break;
    case PropShape::CrateLong:
        outMin = {-1.00f, 0.00f, -0.30f};
        outMax = { 1.00f, 0.60f,  0.30f};
        break;
    case PropShape::LockerUnit:
        outMin = {-0.25f, 0.00f, -0.15f};
        outMax = { 0.25f, 1.80f,  0.15f};
        break;
    case PropShape::BenchSlab:
        outMin = {-1.00f, 0.00f, -0.20f};
        outMax = { 1.00f, 0.45f,  0.20f};
        break;
    case PropShape::Terminal:
        outMin = {-0.40f, 0.00f, -0.40f};
        outMax = { 0.40f, 1.40f,  0.40f};
        break;
    case PropShape::SecurityCamera:
        outMin = {-0.20f, -0.20f, -0.20f};
        outMax = { 0.20f,  0.30f,  0.20f};
        break;
    case PropShape::FloodLamp:
        outMin = {-0.30f, 0.00f, -0.30f};
        outMax = { 0.30f, 1.50f,  0.30f};
        break;
    case PropShape::FungalColumn:
        outMin = {-0.40f, 0.00f, -0.40f};
        outMax = { 0.40f, 2.00f,  0.40f};
        break;
    case PropShape::CrystalCluster:
        outMin = {-0.50f, 0.00f, -0.50f};
        outMax = { 0.50f, 1.00f,  0.50f};
        break;
    case PropShape::AcidPool:
        outMin = {-0.80f, 0.00f, -0.80f};
        outMax = { 0.80f, 0.10f,  0.80f};
        break;
    default:
        outMin = {-1.00f, -1.00f, -1.00f};
        outMax = { 1.00f,  2.00f,  1.00f};
        break;
    }
}

} // namespace giga::gpu
