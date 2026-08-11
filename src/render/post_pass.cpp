#include "render/post_pass.h"
#include "render/vk_device.h"
#include "render/vk_common.h"


#include <cstdio>
#include <vector>

namespace giga::gpu {

namespace {
VkShaderModule load_shader(const VulkanDevice& dev, const char* dir, const char* file) {
    char path[1024];
    std::snprintf(path, sizeof(path), "%s/%s", dir, file);
    FILE* f = std::fopen(path, "rb");
    if (!f) return VK_NULL_HANDLE;
    std::fseek(f, 0, SEEK_END);
    long size = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    std::vector<uint32_t> code(size / 4);
    std::fread(code.data(), 1, size, f);
    std::fclose(f);
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = size;
    ci.pCode = code.data();
    VkShaderModule module = VK_NULL_HANDLE;
    vkCreateShaderModule(dev.device, &ci, nullptr, &module);
    return module;
}
}

bool PostPass::init(VulkanDevice& dev, VkRenderPass postRenderPass, const char* shaderDir) {
    dev_ = &dev;
    if (!create_sampler()) return false;
    if (!create_descriptors()) return false;
    if (!create_pipeline(postRenderPass, shaderDir)) return false;
    return true;
}

void PostPass::destroy() {
    if (!dev_) return;
    if (sampler_) { vkDestroySampler(dev_->device, sampler_, nullptr); sampler_ = VK_NULL_HANDLE; }
    if (pipeline_) { vkDestroyPipeline(dev_->device, pipeline_, nullptr); pipeline_ = VK_NULL_HANDLE; }
    if (layout_) { vkDestroyPipelineLayout(dev_->device, layout_, nullptr); layout_ = VK_NULL_HANDLE; }
    if (descPool_) { vkDestroyDescriptorPool(dev_->device, descPool_, nullptr); descPool_ = VK_NULL_HANDLE; }
    if (setLayout_) { vkDestroyDescriptorSetLayout(dev_->device, setLayout_, nullptr); setLayout_ = VK_NULL_HANDLE; }
    dev_ = nullptr;
}

bool PostPass::create_sampler() {
    VkSamplerCreateInfo sci{};
    sci.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    sci.magFilter = VK_FILTER_LINEAR;
    sci.minFilter = VK_FILTER_LINEAR;
    sci.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
    sci.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sci.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sci.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sci.maxAnisotropy = 1.0f;
    sci.minLod = 0.0f;
    sci.maxLod = 1.0f;
    VK_TRY(vkCreateSampler(dev_->device, &sci, nullptr, &sampler_));
    return true;
}

bool PostPass::create_descriptors() {
    VkDescriptorSetLayoutBinding b{};
    b.binding = 0;
    b.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    b.descriptorCount = 1;
    b.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    ci.bindingCount = 1;
    ci.pBindings = &b;
    VK_TRY(vkCreateDescriptorSetLayout(dev_->device, &ci, nullptr, &setLayout_));

    VkDescriptorPoolSize sz{};
    sz.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    sz.descriptorCount = 1;
    
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.poolSizeCount = 1;
    pi.pPoolSizes = &sz;
    pi.maxSets = 1;
    VK_TRY(vkCreateDescriptorPool(dev_->device, &pi, nullptr, &descPool_));

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = descPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &setLayout_;
    VK_TRY(vkAllocateDescriptorSets(dev_->device, &ai, &ds_));
    return true;
}

bool PostPass::create_pipeline(VkRenderPass renderPass, const char* shaderDir) {
    VkShaderModule vert = load_shader(*dev_, shaderDir, "post.vert.spv");
    VkShaderModule frag = load_shader(*dev_, shaderDir, "post.frag.spv");
    if (!vert || !frag) {
        if (vert) vkDestroyShaderModule(dev_->device, vert, nullptr);
        if (frag) vkDestroyShaderModule(dev_->device, frag, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo ss[2]{};
    ss[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    ss[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    ss[0].module = vert;
    ss[0].pName = "main";
    ss[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    ss[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    ss[1].module = frag;
    ss[1].pName = "main";

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(PostState);

    VkPipelineLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    lci.setLayoutCount = 1;
    lci.pSetLayouts = &setLayout_;
    lci.pushConstantRangeCount = 1;
    lci.pPushConstantRanges = &pcr;
    VK_TRY(vkCreatePipelineLayout(dev_->device, &lci, nullptr, &layout_));

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
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    // Opaque fullscreen draw
    cba.blendEnable = VK_FALSE;

    VkPipelineColorBlendStateCreateInfo bs{};
    bs.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    bs.attachmentCount = 1;
    bs.pAttachments = &cba;

    VkDynamicState dyn[2] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR };
    VkPipelineDynamicStateCreateInfo dys{};
    dys.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dys.dynamicStateCount = 2;
    dys.pDynamicStates = dyn;

    VkGraphicsPipelineCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    pci.stageCount = 2;
    pci.pStages = ss;
    pci.pVertexInputState = &vi;
    pci.pInputAssemblyState = &ia;
    pci.pViewportState = &vp;
    pci.pRasterizationState = &rs;
    pci.pMultisampleState = &ms;
    pci.pColorBlendState = &bs;
    pci.pDynamicState = &dys;
    pci.layout = layout_;
    pci.renderPass = renderPass;
    pci.subpass = 0;

    VkResult res = vkCreateGraphicsPipelines(dev_->device, VK_NULL_HANDLE, 1, &pci, nullptr, &pipeline_);
    
    vkDestroyShaderModule(dev_->device, vert, nullptr);
    vkDestroyShaderModule(dev_->device, frag, nullptr);
    return res == VK_SUCCESS;
}

void PostPass::record(VkCommandBuffer cmd, VkImageView offscreenView, const PostState& state) {
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);

    // Push constants
    vkCmdPushConstants(cmd, layout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(PostState), &state);

    // Update descriptor set with the current frame's offscreen view
    VkDescriptorImageInfo ii{};
    ii.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    ii.imageView = offscreenView;
    ii.sampler = sampler_;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = ds_;
    write.dstBinding = 0;
    write.dstArrayElement = 0;
    write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    write.descriptorCount = 1;
    write.pImageInfo = &ii;

    vkUpdateDescriptorSets(dev_->device, 1, &write, 0, nullptr);

    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0, 1, &ds_, 0, nullptr);

    vkCmdDraw(cmd, 3, 1, 0, 0); // Fullscreen triangle
}
} // namespace giga::gpu
