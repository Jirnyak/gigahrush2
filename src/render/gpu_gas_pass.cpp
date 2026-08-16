#include "render/gpu_gas_pass.h"
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "render/vk_common.h"

namespace giga::gpu {

namespace {

std::string path_join(const char* dir, const char* file) {
    std::string s = dir ? dir : "";
    if (!s.empty() && s.back() != '/' && s.back() != '\\') s += '/';
    s += file;
    return s;
}

bool read_spv(const char* path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) { std::fclose(f); return false; }
    out.resize(static_cast<std::size_t>(n));
    std::size_t rd = std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return rd == static_cast<std::size_t>(n);
}

} // namespace

bool GpuGasPass::init(VulkanDevice* dev, const char* shaderDir, VkBuffer classBuffer) {
    dev_ = dev;
    if (!dev_) return false;
    if (!create_buffers()) return false;
    if (!create_descriptors(classBuffer)) return false;
    if (!create_pipeline(shaderDir)) return false;
    return true;
}

bool GpuGasPass::create_buffers() noexcept {
    constexpr VkDeviceSize kGasBufSize = kMacroCells * sizeof(uint32_t); // 2,097,152 * 4 = 8 MiB (128^3)

    // Fast DEVICE_LOCAL storage buffers in GPU VRAM for high-bandwidth simulation:
    for (int i = 0; i < 2; ++i) {
        char label[32];
        std::snprintf(label, sizeof(label), "gas-ssbo-%d", i);
        if (!gasSSBO_[i].create_device_local_empty(*dev_, kGasBufSize,
                VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                label)) {
            return false;
        }
    }

    // Host-visible staging buffer for lazy floor upload (memcpy -> GPU copy):
    if (!stagingBuf_.create_host_visible(*dev_, kGasBufSize,
            VK_BUFFER_USAGE_TRANSFER_SRC_BIT, "gas-staging-ssbo")) {
        return false;
    }

    // Host-visible probe buffer for instant 0-stall CPU sampling of the player's cell:
    if (!probeBuffer_.create_host_visible(*dev_, 64,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "gas-probe-ssbo")) {
        return false;
    }

    upload_field(nullptr);  // clean atmosphere: oxy=255 everywhere
    return true;
}

void GpuGasPass::upload_field(const float* toxic01) noexcept {
    if (!stagingBuf_.mapped) return;
    uint32_t* cells = static_cast<uint32_t*>(stagingBuf_.mapped);
    for (std::size_t c = 0; c < kMacroCells; ++c) {
        uint32_t toxic = 0;
        if (toxic01) {
            float t = toxic01[c];
            if (t < 0.0f) t = 0.0f;
            if (t > 1.0f) t = 1.0f;
            toxic = static_cast<uint32_t>(t * 255.0f + 0.5f);
        }
        cells[c] = toxic | 0x00FF0000u;  // oxy=255, smoke=0, heat=0
    }
    if (probeBuffer_.mapped) {
        *static_cast<uint32_t*>(probeBuffer_.mapped) = 0x00FF0000u;
    }
    uploadDirty_ = true;
}

std::uint32_t GpuGasPass::sample_cell(int x, int y, int z) const noexcept {
    probeCoord_ = ivec4{x & 127, y & 127, z & 127, 1};
    if (probeBuffer_.mapped) {
        return *static_cast<const uint32_t*>(probeBuffer_.mapped);
    }
    return 0x00FF0000u;
}

bool GpuGasPass::create_descriptors(VkBuffer classBuffer) noexcept {
    VkDevice d = dev_->device;

    VkDescriptorSetLayoutBinding bindings[4]{};
    bindings[0].binding = 0; // GasIn
    bindings[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[0].descriptorCount = 1;
    bindings[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    bindings[1].binding = 1; // GasOut
    bindings[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[1].descriptorCount = 1;
    bindings[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    bindings[2].binding = 2; // ClassBuf
    bindings[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[2].descriptorCount = 1;
    bindings[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    bindings[3].binding = 3; // ProbeBuf
    bindings[3].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[3].descriptorCount = 1;
    bindings[3].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 4;
    dslci.pBindings = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &descSetLayout_));

    VkDescriptorPoolSize poolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets = 2;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes = &poolSize;
    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &descPool_));

    for (uint32_t step = 0; step < 2; ++step) {
        VkDescriptorSetAllocateInfo ai{};
        ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        ai.descriptorPool = descPool_;
        ai.descriptorSetCount = 1;
        ai.pSetLayouts = &descSetLayout_;
        VK_TRY(vkAllocateDescriptorSets(d, &ai, &descSets_[step]));

        VkDescriptorBufferInfo bufs[4]{};
        bufs[0] = {gasSSBO_[step].buffer, 0, VK_WHOLE_SIZE};       // In
        bufs[1] = {gasSSBO_[1 - step].buffer, 0, VK_WHOLE_SIZE};   // Out
        bufs[2] = {classBuffer, 0, VK_WHOLE_SIZE};                 // Class
        bufs[3] = {probeBuffer_.buffer, 0, VK_WHOLE_SIZE};         // Probe

        VkWriteDescriptorSet writes[4]{};
        for (uint32_t b = 0; b < 4; ++b) {
            writes[b].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[b].dstSet = descSets_[step];
            writes[b].dstBinding = b;
            writes[b].descriptorCount = 1;
            writes[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            writes[b].pBufferInfo = &bufs[b];
        }
        vkUpdateDescriptorSets(d, 4, writes, 0, nullptr);
    }
    return true;
}

bool GpuGasPass::create_pipeline(const char* shaderDir) noexcept {
    VkDevice d = dev_->device;
    const std::string spvPath = path_join(shaderDir, "gas_sim.comp.spv");
    std::vector<char> code;
    if (!read_spv(spvPath.c_str(), code)) {
        std::fprintf(stderr, "[gas-pass] failed to load %s\n", spvPath.c_str());
        return false;
    }

    VkShaderModuleCreateInfo smci{};
    smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    smci.codeSize = code.size();
    smci.pCode = reinterpret_cast<const uint32_t*>(code.data());
    VkShaderModule mod = VK_NULL_HANDLE;
    VK_TRY(vkCreateShaderModule(d, &smci, nullptr, &mod));

    VkPushConstantRange pcRange{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(GasPush)};
    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &descSetLayout_;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcRange;
    VK_TRY(vkCreatePipelineLayout(d, &plci, nullptr, &pipelineLayout_));

    VkComputePipelineCreateInfo cpci{};
    cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    cpci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    cpci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    cpci.stage.module = mod;
    cpci.stage.pName = "main";
    cpci.layout = pipelineLayout_;
    VkResult res = vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &cpci, nullptr, &computePipeline_);
    vkDestroyShaderModule(d, mod, nullptr);
    return res == VK_SUCCESS;
}

void GpuGasPass::record_sim(VkCommandBuffer cmd, const CellStep& downStep, float dt,
                            float diffusionRate, float buoyancy) noexcept {
    if (!ready()) return;

    constexpr VkDeviceSize kGasBufSize = kMacroCells * sizeof(uint32_t);

    if (uploadDirty_) {
        VkBufferCopy copyRegion{};
        copyRegion.srcOffset = 0;
        copyRegion.dstOffset = 0;
        copyRegion.size = kGasBufSize;

        vkCmdCopyBuffer(cmd, stagingBuf_.buffer, gasSSBO_[0].buffer, 1, &copyRegion);
        vkCmdCopyBuffer(cmd, stagingBuf_.buffer, gasSSBO_[1].buffer, 1, &copyRegion);

        VkBufferMemoryBarrier copyBarriers[2]{};
        for (int i = 0; i < 2; ++i) {
            copyBarriers[i].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
            copyBarriers[i].srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            copyBarriers[i].dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            copyBarriers[i].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            copyBarriers[i].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            copyBarriers[i].buffer = gasSSBO_[i].buffer;
            copyBarriers[i].offset = 0;
            copyBarriers[i].size = VK_WHOLE_SIZE;
        }
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 0, nullptr, 2, copyBarriers, 0, nullptr);
        uploadDirty_ = false;
    }

    const uint32_t writeIndex = 1 - readIndex_;

    // Barrier: Ensure previous reads/writes on gasSSBO_[writeIndex] complete
    VkBufferMemoryBarrier preBarrier{};
    preBarrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    preBarrier.srcAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    preBarrier.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    preBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    preBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    preBarrier.buffer = gasSSBO_[writeIndex].buffer;
    preBarrier.offset = 0;
    preBarrier.size = VK_WHOLE_SIZE;

    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 0, nullptr, 1, &preBarrier, 0, nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, computePipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_,
                            0, 1, &descSets_[readIndex_], 0, nullptr);

    GasPush push{};
    push.downStep = ivec4{downStep.x, downStep.y, downStep.z, 0};
    push.params = vec4{diffusionRate, buoyancy, 0.0f, dt};
    push.probeCoord = probeCoord_;
    vkCmdPushConstants(cmd, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(GasPush), &push);

    // Grid 512x512x16 / (16,16,1) = Dispatch (32, 32, 16)
    // 128/16 x 128/16 x 128/1 воркгрупп: 16x16x1 держит x-ось локальной —
    // кэш-линия подряд идущих клеток (x — быстрая ось упаковки).
    vkCmdDispatch(cmd, 8, 8, 128);

    // Barrier: Compute write -> Compute/Fragment/Host read
    VkBufferMemoryBarrier postBarriers[2]{};
    postBarriers[0].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    postBarriers[0].srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    postBarriers[0].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    postBarriers[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    postBarriers[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    postBarriers[0].buffer = gasSSBO_[writeIndex].buffer;
    postBarriers[0].offset = 0;
    postBarriers[0].size = VK_WHOLE_SIZE;

    postBarriers[1].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    postBarriers[1].srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    postBarriers[1].dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    postBarriers[1].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    postBarriers[1].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    postBarriers[1].buffer = probeBuffer_.buffer;
    postBarriers[1].offset = 0;
    postBarriers[1].size = VK_WHOLE_SIZE;

    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT | VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT | VK_PIPELINE_STAGE_HOST_BIT,
                         0, 0, nullptr, 2, postBarriers, 0, nullptr);

    readIndex_ = writeIndex; // Advance ping-pong
}

void GpuGasPass::destroy() noexcept {
    if (!dev_ || dev_->device == VK_NULL_HANDLE) return;
    VkDevice d = dev_->device;
    if (computePipeline_) { vkDestroyPipeline(d, computePipeline_, nullptr); computePipeline_ = VK_NULL_HANDLE; }
    if (pipelineLayout_)  { vkDestroyPipelineLayout(d, pipelineLayout_, nullptr); pipelineLayout_ = VK_NULL_HANDLE; }
    if (descPool_)        { vkDestroyDescriptorPool(d, descPool_, nullptr); descPool_ = VK_NULL_HANDLE; }
    if (descSetLayout_)   { vkDestroyDescriptorSetLayout(d, descSetLayout_, nullptr); descSetLayout_ = VK_NULL_HANDLE; }
    for (int i = 0; i < 2; ++i) gasSSBO_[i].destroy(*dev_);
    stagingBuf_.destroy(*dev_);
    probeBuffer_.destroy(*dev_);
    dev_ = nullptr;
}

} // namespace giga::gpu
