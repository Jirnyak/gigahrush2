#include "render/eye_adapt.h"
#include "render/vk_device.h"
#include "render/vk_common.h"
#include "render/vk_buffer.h"

#include <vector>
#include <cstdio>
#include <cstdlib>

namespace giga::gpu {

namespace {

VkShaderModule load_shader(const VulkanDevice& dev, const char* path) {
    FILE* f = std::fopen(path, "rb");
    if (!f) {
        std::fprintf(stderr, "[eye_adapt] Failed to open %s\n", path);
        return VK_NULL_HANDLE;
    }
    std::fseek(f, 0, SEEK_END);
    long size = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);

    std::vector<char> code(size);
    std::fread(code.data(), 1, size, f);
    std::fclose(f);

    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = size;
    ci.pCode = reinterpret_cast<const uint32_t*>(code.data());

    VkShaderModule mod;
    if (vkCreateShaderModule(dev.device, &ci, nullptr, &mod) != VK_SUCCESS) {
        std::fprintf(stderr, "[eye_adapt] Failed to create shader module\n");
        return VK_NULL_HANDLE;
    }
    return mod;
}

} // namespace

bool EyeAdaptPass::init(VulkanDevice& dev) {
    if (!ssbo_.create_host_visible(dev, sizeof(AdaptState), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "EyeAdapt SSBO")) {
        return false;
    }
    
    // Initialize state
    AdaptState* state = static_cast<AdaptState*>(ssbo_.mapped);
    state->currentLum = 1.0f;
    state->targetLum = 1.0f;
    state->dt = 0.0f;

    VkDescriptorSetLayoutBinding bindings[2] = {};
    // Binding 0: HDR Image
    bindings[0].binding = 0;
    bindings[0].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    bindings[0].descriptorCount = 1;
    bindings[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    
    // Binding 1: SSBO
    bindings[1].binding = 1;
    bindings[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[1].descriptorCount = 1;
    bindings[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT; // So PostPass can read it

    VkDescriptorSetLayoutCreateInfo layoutInfo{};
    layoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    layoutInfo.bindingCount = 2;
    layoutInfo.pBindings = bindings;

    if (vkCreateDescriptorSetLayout(dev.device, &layoutInfo, nullptr, &setLayout_) != VK_SUCCESS) {
        return false;
    }

    VkPipelineLayoutCreateInfo pLayoutInfo{};
    pLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    pLayoutInfo.setLayoutCount = 1;
    pLayoutInfo.pSetLayouts = &setLayout_;

    if (vkCreatePipelineLayout(dev.device, &pLayoutInfo, nullptr, &pipelineLayout_) != VK_SUCCESS) {
        return false;
    }

    VkShaderModule compShader = load_shader(dev, "shaders/adapt.comp.spv");
    if (!compShader) return false;

    VkComputePipelineCreateInfo pipelineInfo{};
    pipelineInfo.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipelineInfo.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipelineInfo.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    pipelineInfo.stage.module = compShader;
    pipelineInfo.stage.pName = "main";
    pipelineInfo.layout = pipelineLayout_;

    if (vkCreateComputePipelines(dev.device, VK_NULL_HANDLE, 1, &pipelineInfo, nullptr, &pipeline_) != VK_SUCCESS) {
        vkDestroyShaderModule(dev.device, compShader, nullptr);
        return false;
    }
    vkDestroyShaderModule(dev.device, compShader, nullptr);

    VkDescriptorPoolSize poolSizes[2] = {};
    poolSizes[0].type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    poolSizes[0].descriptorCount = 1;
    poolSizes[1].type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSizes[1].descriptorCount = 1;

    VkDescriptorPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolInfo.poolSizeCount = 2;
    poolInfo.pPoolSizes = poolSizes;
    poolInfo.maxSets = 1;

    if (vkCreateDescriptorPool(dev.device, &poolInfo, nullptr, &descriptorPool_) != VK_SUCCESS) {
        return false;
    }

    VkDescriptorSetAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    allocInfo.descriptorPool = descriptorPool_;
    allocInfo.descriptorSetCount = 1;
    allocInfo.pSetLayouts = &setLayout_;

    if (vkAllocateDescriptorSets(dev.device, &allocInfo, &descriptorSet_) != VK_SUCCESS) {
        return false;
    }

    VkSamplerCreateInfo samplerInfo{};
    samplerInfo.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    samplerInfo.magFilter = VK_FILTER_LINEAR;
    samplerInfo.minFilter = VK_FILTER_LINEAR;
    samplerInfo.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    samplerInfo.unnormalizedCoordinates = VK_FALSE;
    if (vkCreateSampler(dev.device, &samplerInfo, nullptr, &sampler_) != VK_SUCCESS) {
        return false;
    }

    VkDescriptorBufferInfo bufferInfo{};
    bufferInfo.buffer = ssbo_.buffer;
    bufferInfo.offset = 0;
    bufferInfo.range = sizeof(AdaptState);

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = descriptorSet_;
    write.dstBinding = 1;
    write.dstArrayElement = 0;
    write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    write.descriptorCount = 1;
    write.pBufferInfo = &bufferInfo;

    vkUpdateDescriptorSets(dev.device, 1, &write, 0, nullptr);

    return true;
}

void EyeAdaptPass::destroy(VulkanDevice& dev) {
    if (sampler_) {
        vkDestroySampler(dev.device, sampler_, nullptr);
        sampler_ = VK_NULL_HANDLE;
    }
    if (descriptorPool_) {
        vkDestroyDescriptorPool(dev.device, descriptorPool_, nullptr);
        descriptorPool_ = VK_NULL_HANDLE;
    }
    if (pipeline_) {
        vkDestroyPipeline(dev.device, pipeline_, nullptr);
        pipeline_ = VK_NULL_HANDLE;
    }
    if (pipelineLayout_) {
        vkDestroyPipelineLayout(dev.device, pipelineLayout_, nullptr);
        pipelineLayout_ = VK_NULL_HANDLE;
    }
    if (setLayout_) {
        vkDestroyDescriptorSetLayout(dev.device, setLayout_, nullptr);
        setLayout_ = VK_NULL_HANDLE;
    }
    ssbo_.destroy(dev);
}

void EyeAdaptPass::record(VulkanDevice& dev, VkCommandBuffer cmd, VkImageView hdrView, float dtSec) {
    // 1. Update dt in the mapped SSBO
    if (ssbo_.mapped) {
        AdaptState* state = static_cast<AdaptState*>(ssbo_.mapped);
        state->dt = dtSec;
    }

    // 2. Update Descriptor Set with the current HDR view
    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    imageInfo.imageView = hdrView;
    imageInfo.sampler = sampler_;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = descriptorSet_;
    write.dstBinding = 0;
    write.dstArrayElement = 0;
    write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    write.descriptorCount = 1;
    write.pImageInfo = &imageInfo;

    vkUpdateDescriptorSets(dev.device, 1, &write, 0, nullptr);

    // 3. Dispatch the compute shader
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1, &descriptorSet_, 0, nullptr);
    vkCmdDispatch(cmd, 1, 1, 1);
}

} // namespace giga::gpu
