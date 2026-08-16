#include "render/vk_renderer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/vk_swapchain.h"

#include <SDL3/SDL.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <vector>

namespace giga::gpu {

namespace {

std::uint32_t find_mem_type(const VulkanDevice& d, std::uint32_t typeBits,
                            VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(d.physical, &mp);
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i))
            && (mp.memoryTypes[i].propertyFlags & props) == props)
            return i;
    return 0;
}

void drawable_size(SDL_Window* w, int* pw, int* ph) {
    SDL_GetWindowSizeInPixels(w, pw, ph);
}

bool read_file_bytes(const std::string& path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long sz = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (sz <= 0) {
        std::fclose(f);
        return false;
    }
    out.resize(static_cast<std::size_t>(sz));
    const bool ok = (std::fread(out.data(), 1, out.size(), f) == out.size());
    std::fclose(f);
    return ok;
}

bool load_shader_module(VkDevice device, const std::string& filename,
                        const std::string& dir, VkShaderModule* outModule) {
    std::vector<char> bytes;
    std::vector<std::string> searchPaths;
    if (!dir.empty()) {
        std::string p = dir;
        if (p.back() != '/' && p.back() != '\\') p += '/';
        searchPaths.push_back(p + filename);
    }
    searchPaths.push_back("shaders/" + filename);
    searchPaths.push_back("build/shaders/" + filename);
    searchPaths.push_back("build-win/shaders/" + filename);
    searchPaths.push_back(filename);

    bool loaded = false;
    for (const auto& path : searchPaths) {
        if (std::filesystem::exists(path) && read_file_bytes(path, bytes)) {
            loaded = true;
            break;
        }
    }

    if (!loaded) {
        std::fprintf(stderr, "[vk_renderer] failed to load shader SPIR-V: %s\n", filename.c_str());
        return false;
    }

    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = bytes.size();
    ci.pCode = reinterpret_cast<const std::uint32_t*>(bytes.data());
    return vkCreateShaderModule(device, &ci, nullptr, outModule) == VK_SUCCESS;
}

} // namespace

bool VulkanRenderer::init(VulkanDevice& d, SDL_Window* window, const char* shaderDir) {
    dev = &d;
    if (shaderDir != nullptr && shaderDir[0] != '\0') {
        shaderDir_ = shaderDir;
    } else {
#ifdef GIGA_SHADER_DIR
        shaderDir_ = GIGA_SHADER_DIR;
#else
        shaderDir_ = "shaders";
#endif
    }

    if (std::getenv("GIGA_NO_CRT") != nullptr) {
        crtEnabled = false;
    }

    swapchain_ = new VulkanSwapchain();
    int w = 0, h = 0;
    drawable_size(window, &w, &h);
    if (!swapchain_->create(d, w, h)) return false;
    if (!create_hdr_target()) return false;
    if (!create_depth()) return false;
    if (!create_scene_render_pass()) return false;
    if (!create_post_render_pass()) return false;
    if (!create_framebuffers()) return false;
    if (!create_post_pipeline()) return false;
    if (!create_commands()) return false;
    if (!create_frame_sync()) return false;
    if (!create_present_semaphores()) return false;

    timer.init(d);
    return true;
}

bool VulkanRenderer::create_scene_render_pass() {
    VkAttachmentDescription color{};
    color.format = hdrFormat;
    color.samples = VK_SAMPLE_COUNT_1_BIT;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    color.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkAttachmentReference ref{};
    ref.attachment = 0;
    ref.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkAttachmentDescription depth{};
    depth.format = depthFormat;
    depth.samples = VK_SAMPLE_COUNT_1_BIT;
    depth.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    depth.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    depth.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    depth.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    depth.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    depth.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    VkAttachmentReference depthRef{};
    depthRef.attachment = 1;
    depthRef.layout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    VkSubpassDescription sub{};
    sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    sub.colorAttachmentCount = 1;
    sub.pColorAttachments = &ref;
    sub.pDepthStencilAttachment = &depthRef;

    VkSubpassDependency deps[2]{};
    deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
    deps[0].dstSubpass = 0;
    deps[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                           | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
    deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                           | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
    deps[0].srcAccessMask = 0;
    deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT
                            | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

    deps[1].srcSubpass = 0;
    deps[1].dstSubpass = VK_SUBPASS_EXTERNAL;
    deps[1].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    deps[1].dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    deps[1].srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    deps[1].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

    VkAttachmentDescription atts[2] = {color, depth};
    VkRenderPassCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    ci.attachmentCount = 2;
    ci.pAttachments = atts;
    ci.subpassCount = 1;
    ci.pSubpasses = &sub;
    ci.dependencyCount = 2;
    ci.pDependencies = deps;
    VK_TRY(vkCreateRenderPass(dev->device, &ci, nullptr, &renderPass));
    return true;
}

bool VulkanRenderer::create_post_render_pass() {
    VkAttachmentDescription color{};
    color.format = swapchain_->format;
    color.samples = VK_SAMPLE_COUNT_1_BIT;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentReference ref{};
    ref.attachment = 0;
    ref.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkSubpassDescription sub{};
    sub.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    sub.colorAttachmentCount = 1;
    sub.pColorAttachments = &ref;
    sub.pDepthStencilAttachment = nullptr;

    VkSubpassDependency dep{};
    dep.srcSubpass = VK_SUBPASS_EXTERNAL;
    dep.dstSubpass = 0;
    dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dep.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dep.srcAccessMask = 0;
    dep.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

    VkRenderPassCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    ci.attachmentCount = 1;
    ci.pAttachments = &color;
    ci.subpassCount = 1;
    ci.pSubpasses = &sub;
    ci.dependencyCount = 1;
    ci.pDependencies = &dep;
    VK_TRY(vkCreateRenderPass(dev->device, &ci, nullptr, &postRenderPass));
    return true;
}

bool VulkanRenderer::create_hdr_target() {
    VkImageCreateInfo ii{};
    ii.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.extent = {swapchain_->extent.width, swapchain_->extent.height, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 1;
    ii.format = hdrFormat;
    ii.tiling = VK_IMAGE_TILING_OPTIMAL;
    ii.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    ii.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_TRY(vkCreateImage(dev->device, &ii, nullptr, &hdrImage));

    VkMemoryRequirements req{};
    vkGetImageMemoryRequirements(dev->device, hdrImage, &req);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = find_mem_type(*dev, req.memoryTypeBits,
                                       VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    VK_TRY(vkAllocateMemory(dev->device, &ai, nullptr, &hdrMemory));
    VK_TRY(vkBindImageMemory(dev->device, hdrImage, hdrMemory, 0));

    VkImageViewCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vi.image = hdrImage;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = hdrFormat;
    vi.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    vi.subresourceRange.levelCount = 1;
    vi.subresourceRange.layerCount = 1;
    VK_TRY(vkCreateImageView(dev->device, &vi, nullptr, &hdrView));

    VkSamplerCreateInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    si.magFilter = VK_FILTER_LINEAR;
    si.minFilter = VK_FILTER_LINEAR;
    si.mipmapMode = VK_SAMPLER_MIPMAP_MODE_LINEAR;
    si.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    si.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    si.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    si.borderColor = VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK;
    VK_TRY(vkCreateSampler(dev->device, &si, nullptr, &hdrSampler));
    return true;
}

void VulkanRenderer::destroy_hdr_target() {
    if (hdrSampler) { vkDestroySampler(dev->device, hdrSampler, nullptr); hdrSampler = VK_NULL_HANDLE; }
    if (hdrView) { vkDestroyImageView(dev->device, hdrView, nullptr); hdrView = VK_NULL_HANDLE; }
    if (hdrImage) { vkDestroyImage(dev->device, hdrImage, nullptr); hdrImage = VK_NULL_HANDLE; }
    if (hdrMemory) { vkFreeMemory(dev->device, hdrMemory, nullptr); hdrMemory = VK_NULL_HANDLE; }
}

bool VulkanRenderer::create_depth() {
    VkImageCreateInfo ii{};
    ii.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.extent = {swapchain_->extent.width, swapchain_->extent.height, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 1;
    ii.format = depthFormat;
    ii.tiling = VK_IMAGE_TILING_OPTIMAL;
    ii.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    ii.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_TRY(vkCreateImage(dev->device, &ii, nullptr, &depthImage));

    VkMemoryRequirements req{};
    vkGetImageMemoryRequirements(dev->device, depthImage, &req);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = find_mem_type(*dev, req.memoryTypeBits,
                                       VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    VK_TRY(vkAllocateMemory(dev->device, &ai, nullptr, &depthMemory));
    VK_TRY(vkBindImageMemory(dev->device, depthImage, depthMemory, 0));

    VkImageViewCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vi.image = depthImage;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = depthFormat;
    vi.subresourceRange.aspectMask = VK_IMAGE_ASPECT_DEPTH_BIT;
    vi.subresourceRange.levelCount = 1;
    vi.subresourceRange.layerCount = 1;
    VK_TRY(vkCreateImageView(dev->device, &vi, nullptr, &depthView));
    return true;
}

void VulkanRenderer::destroy_depth() {
    if (depthView) { vkDestroyImageView(dev->device, depthView, nullptr); depthView = VK_NULL_HANDLE; }
    if (depthImage) { vkDestroyImage(dev->device, depthImage, nullptr); depthImage = VK_NULL_HANDLE; }
    if (depthMemory) { vkFreeMemory(dev->device, depthMemory, nullptr); depthMemory = VK_NULL_HANDLE; }
}

bool VulkanRenderer::create_framebuffers() {
    // Pass 1: Scene Framebuffer (HDR Color Attachment + Depth Attachment)
    VkImageView sceneAtts[2] = {hdrView, depthView};
    VkFramebufferCreateInfo sceneCi{};
    sceneCi.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
    sceneCi.renderPass = renderPass;
    sceneCi.attachmentCount = 2;
    sceneCi.pAttachments = sceneAtts;
    sceneCi.width = swapchain_->extent.width;
    sceneCi.height = swapchain_->extent.height;
    sceneCi.layers = 1;
    VK_TRY(vkCreateFramebuffer(dev->device, &sceneCi, nullptr, &sceneFramebuffer_));

    // Pass 2: Post-Processing Framebuffers (one per Swapchain Image View)
    postFramebuffers_.resize(swapchain_->views.size());
    for (std::size_t i = 0; i < swapchain_->views.size(); ++i) {
        VkImageView postAtt = swapchain_->views[i];
        VkFramebufferCreateInfo postCi{};
        postCi.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        postCi.renderPass = postRenderPass;
        postCi.attachmentCount = 1;
        postCi.pAttachments = &postAtt;
        postCi.width = swapchain_->extent.width;
        postCi.height = swapchain_->extent.height;
        postCi.layers = 1;
        VK_TRY(vkCreateFramebuffer(dev->device, &postCi, nullptr, &postFramebuffers_[i]));
    }
    return true;
}

void VulkanRenderer::destroy_framebuffers() {
    if (sceneFramebuffer_) {
        vkDestroyFramebuffer(dev->device, sceneFramebuffer_, nullptr);
        sceneFramebuffer_ = VK_NULL_HANDLE;
    }
    for (auto fb : postFramebuffers_) {
        if (fb) vkDestroyFramebuffer(dev->device, fb, nullptr);
    }
    postFramebuffers_.clear();
}

bool VulkanRenderer::create_post_pipeline() {
    // 1. Descriptor Set Layout
    VkDescriptorSetLayoutBinding binding{};
    binding.binding = 0;
    binding.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    binding.descriptorCount = 1;
    binding.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutCreateInfo layoutInfo{};
    layoutInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    layoutInfo.bindingCount = 1;
    layoutInfo.pBindings = &binding;
    VK_TRY(vkCreateDescriptorSetLayout(dev->device, &layoutInfo, nullptr, &postSetLayout_));

    // 2. Descriptor Pool & Descriptor Set Allocation
    VkDescriptorPoolSize poolSize{};
    poolSize.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    poolSize.descriptorCount = 1;

    VkDescriptorPoolCreateInfo poolInfo{};
    poolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolInfo.poolSizeCount = 1;
    poolInfo.pPoolSizes = &poolSize;
    poolInfo.maxSets = 1;
    VK_TRY(vkCreateDescriptorPool(dev->device, &poolInfo, nullptr, &postPool_));

    VkDescriptorSetAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    allocInfo.descriptorPool = postPool_;
    allocInfo.descriptorSetCount = 1;
    allocInfo.pSetLayouts = &postSetLayout_;
    VK_TRY(vkAllocateDescriptorSets(dev->device, &allocInfo, &postSet_));

    VkDescriptorImageInfo imageInfo{};
    imageInfo.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    imageInfo.imageView = hdrView;
    imageInfo.sampler = hdrSampler;

    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.dstSet = postSet_;
    write.dstBinding = 0;
    write.dstArrayElement = 0;
    write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    write.descriptorCount = 1;
    write.pImageInfo = &imageInfo;
    vkUpdateDescriptorSets(dev->device, 1, &write, 0, nullptr);

    // 3. Pipeline Layout
    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.offset = 0;
    pcr.size = sizeof(PostPush);

    VkPipelineLayoutCreateInfo pipelineLayoutInfo{};
    pipelineLayoutInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    pipelineLayoutInfo.setLayoutCount = 1;
    pipelineLayoutInfo.pSetLayouts = &postSetLayout_;
    pipelineLayoutInfo.pushConstantRangeCount = 1;
    pipelineLayoutInfo.pPushConstantRanges = &pcr;
    VK_TRY(vkCreatePipelineLayout(dev->device, &pipelineLayoutInfo, nullptr, &postLayout_));

    // 4. Shaders
    VkShaderModule vertModule = VK_NULL_HANDLE;
    VkShaderModule fragModule = VK_NULL_HANDLE;
    if (!load_shader_module(dev->device, "post_pass.vert.spv", shaderDir_, &vertModule)) return false;
    if (!load_shader_module(dev->device, "post_pass.frag.spv", shaderDir_, &fragModule)) {
        vkDestroyShaderModule(dev->device, vertModule, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vertModule;
    stages[0].pName = "main";

    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fragModule;
    stages[1].pName = "main";

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

    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable = VK_FALSE;
    ds.depthWriteEnable = VK_FALSE;

    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                         VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    cba.blendEnable = VK_FALSE;

    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;

    VkDynamicState dynStates[2] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dsi{};
    dsi.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dsi.dynamicStateCount = 2;
    dsi.pDynamicStates = dynStates;

    VkGraphicsPipelineCreateInfo gp{};
    gp.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    gp.stageCount = 2;
    gp.pStages = stages;
    gp.pVertexInputState = &vi;
    gp.pInputAssemblyState = &ia;
    gp.pViewportState = &vp;
    gp.pRasterizationState = &rs;
    gp.pMultisampleState = &ms;
    gp.pDepthStencilState = &ds;
    gp.pColorBlendState = &cb;
    gp.pDynamicState = &dsi;
    gp.layout = postLayout_;
    gp.renderPass = postRenderPass;
    gp.subpass = 0;

    VkResult pr = vkCreateGraphicsPipelines(dev->device, VK_NULL_HANDLE, 1, &gp, nullptr, &postPipeline_);
    vkDestroyShaderModule(dev->device, vertModule, nullptr);
    vkDestroyShaderModule(dev->device, fragModule, nullptr);
    return pr == VK_SUCCESS;
}

void VulkanRenderer::destroy_post_pipeline() {
    if (postPipeline_) {
        vkDestroyPipeline(dev->device, postPipeline_, nullptr);
        postPipeline_ = VK_NULL_HANDLE;
    }
    if (postLayout_) {
        vkDestroyPipelineLayout(dev->device, postLayout_, nullptr);
        postLayout_ = VK_NULL_HANDLE;
    }
    if (postPool_) {
        vkDestroyDescriptorPool(dev->device, postPool_, nullptr);
        postPool_ = VK_NULL_HANDLE;
        postSet_ = VK_NULL_HANDLE;
    }
    if (postSetLayout_) {
        vkDestroyDescriptorSetLayout(dev->device, postSetLayout_, nullptr);
        postSetLayout_ = VK_NULL_HANDLE;
    }
}

bool VulkanRenderer::create_commands() {
    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pci.queueFamilyIndex = dev->families.graphics;
    VK_TRY(vkCreateCommandPool(dev->device, &pci, nullptr, &cmdPool));

    VkCommandBufferAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    ai.commandPool = cmdPool;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = kMaxFramesInFlight;
    VK_TRY(vkAllocateCommandBuffers(dev->device, &ai, cmd));
    return true;
}

bool VulkanRenderer::create_frame_sync() {
    VkSemaphoreCreateInfo sci{};
    sci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
    VkFenceCreateInfo fci{};
    fci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
    fci.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    fci.flags = VK_FENCE_CREATE_SIGNALED_BIT;
    for (int i = 0; i < kMaxFramesInFlight; ++i) {
        VK_TRY(vkCreateSemaphore(dev->device, &sci, nullptr, &imageAvailable[i]));
        VK_TRY(vkCreateFence(dev->device, &fci, nullptr, &inFlight[i]));
    }
    return true;
}

bool VulkanRenderer::create_present_semaphores() {
    VkSemaphoreCreateInfo sci{};
    sci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
    renderFinished.resize(swapchain_->images.size());
    for (auto& s : renderFinished)
        VK_TRY(vkCreateSemaphore(dev->device, &sci, nullptr, &s));
    imagesInFlight.assign(swapchain_->images.size(), VK_NULL_HANDLE);
    return true;
}

void VulkanRenderer::destroy_present_semaphores() {
    for (auto s : renderFinished)
        if (s) vkDestroySemaphore(dev->device, s, nullptr);
    renderFinished.clear();
    imagesInFlight.clear();
}

bool VulkanRenderer::acquire_frame(SDL_Window* window) {
    vkWaitForFences(dev->device, 1, &inFlight[currentFrame], VK_TRUE, UINT64_MAX);

    timer.collect(currentFrame);

    VkResult acq = vkAcquireNextImageKHR(
        dev->device, swapchain_->handle, UINT64_MAX,
        imageAvailable[currentFrame], VK_NULL_HANDLE, &currentImageIndex);
    if (acq == VK_ERROR_OUT_OF_DATE_KHR) {
        recreate(window);
        return false;
    }
    if (acq != VK_SUCCESS && acq != VK_SUBOPTIMAL_KHR) {
        std::fprintf(stderr, "[vk] acquire failed: %s\n", vk_result_str(acq));
        return false;
    }

    if (imagesInFlight[currentImageIndex] != VK_NULL_HANDLE)
        vkWaitForFences(dev->device, 1, &imagesInFlight[currentImageIndex],
                        VK_TRUE, UINT64_MAX);
    imagesInFlight[currentImageIndex] = inFlight[currentFrame];

    vkResetFences(dev->device, 1, &inFlight[currentFrame]);

    VkCommandBuffer c = cmd[currentFrame];
    vkResetCommandBuffer(c, 0);
    VkCommandBufferBeginInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    return vkBeginCommandBuffer(c, &bi) == VK_SUCCESS;
}

void VulkanRenderer::begin_render_pass(float r, float g, float b) {
    VkCommandBuffer c = cmd[currentFrame];
    VkClearValue clears[2]{};
    clears[0].color.float32[0] = r;
    clears[0].color.float32[1] = g;
    clears[0].color.float32[2] = b;
    clears[0].color.float32[3] = 1.0f;
    clears[1].depthStencil.depth = 1.0f;
    clears[1].depthStencil.stencil = 0;

    VkRenderPassBeginInfo rp{};
    rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rp.renderPass = renderPass;
    rp.framebuffer = sceneFramebuffer_;
    rp.renderArea.offset = {0, 0};
    rp.renderArea.extent = swapchain_->extent;
    rp.clearValueCount = 2;
    rp.pClearValues = clears;
    vkCmdBeginRenderPass(c, &rp, VK_SUBPASS_CONTENTS_INLINE);

    VkViewport vp{};
    vp.x = 0.0f; vp.y = 0.0f;
    vp.width = static_cast<float>(swapchain_->extent.width);
    vp.height = static_cast<float>(swapchain_->extent.height);
    vp.minDepth = 0.0f; vp.maxDepth = 1.0f;
    vkCmdSetViewport(c, 0, 1, &vp);
    VkRect2D sc{};
    sc.offset = {0, 0};
    sc.extent = swapchain_->extent;
    vkCmdSetScissor(c, 0, 1, &sc);
}

void VulkanRenderer::record_post_pass(VkCommandBuffer c) {
    VkClearValue clear{};
    clear.color.float32[0] = 0.0f;
    clear.color.float32[1] = 0.0f;
    clear.color.float32[2] = 0.0f;
    clear.color.float32[3] = 1.0f;

    VkRenderPassBeginInfo rpi{};
    rpi.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rpi.renderPass = postRenderPass;
    rpi.framebuffer = postFramebuffers_[currentImageIndex];
    rpi.renderArea.offset = {0, 0};
    rpi.renderArea.extent = swapchain_->extent;
    rpi.clearValueCount = 1;
    rpi.pClearValues = &clear;
    vkCmdBeginRenderPass(c, &rpi, VK_SUBPASS_CONTENTS_INLINE);

    VkViewport vp{};
    vp.x = 0.0f; vp.y = 0.0f;
    vp.width = static_cast<float>(swapchain_->extent.width);
    vp.height = static_cast<float>(swapchain_->extent.height);
    vp.minDepth = 0.0f; vp.maxDepth = 1.0f;
    vkCmdSetViewport(c, 0, 1, &vp);

    VkRect2D sc{};
    sc.offset = {0, 0};
    sc.extent = swapchain_->extent;
    vkCmdSetScissor(c, 0, 1, &sc);

    if (postPipeline_ != VK_NULL_HANDLE) {
        vkCmdBindPipeline(c, VK_PIPELINE_BIND_POINT_GRAPHICS, postPipeline_);
        vkCmdBindDescriptorSets(c, VK_PIPELINE_BIND_POINT_GRAPHICS, postLayout_,
                                0, 1, &postSet_, 0, nullptr);

        const float w = static_cast<float>(swapchain_->extent.width);
        const float h = static_cast<float>(swapchain_->extent.height);
        const float currentTimeSec = static_cast<float>(SDL_GetTicks()) / 1000.0f;

        PostPush push{};
        push.params0 = vec4{currentTimeSec, darkAdaptation, crtEnabled ? 1.0f : 0.0f, chromaticAberration};
        push.params1 = vec4{crtCurvature, scanlineIntensity, vignettePower, phosphorWash};
        push.resolution = vec4{w, h, w > 0.0f ? 1.0f / w : 0.0f, h > 0.0f ? 1.0f / h : 0.0f};

        vkCmdPushConstants(c, postLayout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(PostPush), &push);
        vkCmdDraw(c, 3, 1, 0, 0);
    }

    vkCmdEndRenderPass(c);
}

bool VulkanRenderer::begin_frame_cmd(SDL_Window* window) {
    if (!acquire_frame(window)) return false;
    timer.frame_begin(cmd[currentFrame], currentFrame);
    return true;
}

void VulkanRenderer::begin_pass(float r, float g, float b) {
    begin_render_pass(r, g, b);
}

bool VulkanRenderer::begin_frame(SDL_Window* window, float r, float g, float b) {
    if (!begin_frame_cmd(window)) return false;
    begin_pass(r, g, b);
    return true;
}

bool VulkanRenderer::end_frame(SDL_Window* window) {
    VkCommandBuffer c = cmd[currentFrame];
    vkCmdEndRenderPass(c);

    // Pass 2: Fullscreen post-processing pass rendering to swapchain
    record_post_pass(c);

    // A pending capture is recorded HERE: after post pass, before submit and present.
    if (captureTo_ != VK_NULL_HANDLE) {
        VkImageMemoryBarrier b{};
        b.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        b.oldLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        b.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        b.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        b.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        b.image = swapchain_->images[currentImageIndex];
        b.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        vkCmdPipelineBarrier(c, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                             VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0,
                             nullptr, 1, &b);

        VkBufferImageCopy region{};
        region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        region.imageExtent = {swapchain_->extent.width, swapchain_->extent.height, 1};
        vkCmdCopyImageToBuffer(c, swapchain_->images[currentImageIndex],
                               VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, captureTo_, 1,
                               &region);

        b.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        b.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        b.dstAccessMask = 0;
        vkCmdPipelineBarrier(c, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0, nullptr, 0,
                             nullptr, 1, &b);
        captureDone_ = true;
    }

    timer.frame_end(c);
    if (vkEndCommandBuffer(c) != VK_SUCCESS) return false;

    VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    si.waitSemaphoreCount = 1;
    si.pWaitSemaphores = &imageAvailable[currentFrame];
    si.pWaitDstStageMask = &waitStage;
    si.commandBufferCount = 1;
    si.pCommandBuffers = &c;
    si.signalSemaphoreCount = 1;
    si.pSignalSemaphores = &renderFinished[currentImageIndex];
    VK_TRY(vkQueueSubmit(dev->graphicsQueue, 1, &si, inFlight[currentFrame]));

    timer.frame_submitted();

    VkPresentInfoKHR pi{};
    pi.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    pi.waitSemaphoreCount = 1;
    pi.pWaitSemaphores = &renderFinished[currentImageIndex];
    pi.swapchainCount = 1;
    pi.pSwapchains = &swapchain_->handle;
    pi.pImageIndices = &currentImageIndex;
    VkResult pr = vkQueuePresentKHR(dev->presentQueue, &pi);

    currentFrame = (currentFrame + 1) % kMaxFramesInFlight;

    if (pr == VK_ERROR_OUT_OF_DATE_KHR || pr == VK_SUBOPTIMAL_KHR
        || framebufferResized) {
        framebufferResized = false;
        recreate(window);
    } else if (pr != VK_SUCCESS) {
        std::fprintf(stderr, "[vk] present failed: %s\n", vk_result_str(pr));
        return false;
    }
    return true;
}

bool VulkanRenderer::recreate(SDL_Window* window) {
    int w = 0, h = 0;
    drawable_size(window, &w, &h);
    if (w == 0 || h == 0) return true; // minimized

    vkDeviceWaitIdle(dev->device);
    destroy_present_semaphores();
    destroy_post_pipeline();
    destroy_framebuffers();
    destroy_depth();
    destroy_hdr_target();
    swapchain_->destroy(*dev);
    if (!swapchain_->create(*dev, w, h)) return false;
    if (!create_hdr_target()) return false;
    if (!create_depth()) return false;
    if (!create_framebuffers()) return false;
    if (!create_post_pipeline()) return false;
    if (!create_present_semaphores()) return false;
    currentFrame = 0;
    return true;
}

void VulkanRenderer::destroy() {
    if (!dev) return;
    vkDeviceWaitIdle(dev->device);
    timer.destroy();
    destroy_present_semaphores();
    for (int i = 0; i < kMaxFramesInFlight; ++i) {
        if (imageAvailable[i]) vkDestroySemaphore(dev->device, imageAvailable[i], nullptr);
        if (inFlight[i]) vkDestroyFence(dev->device, inFlight[i], nullptr);
        imageAvailable[i] = VK_NULL_HANDLE;
        inFlight[i] = VK_NULL_HANDLE;
    }
    if (cmdPool) { vkDestroyCommandPool(dev->device, cmdPool, nullptr); cmdPool = VK_NULL_HANDLE; }
    destroy_post_pipeline();
    destroy_framebuffers();
    destroy_depth();
    destroy_hdr_target();
    if (postRenderPass) { vkDestroyRenderPass(dev->device, postRenderPass, nullptr); postRenderPass = VK_NULL_HANDLE; }
    if (renderPass) { vkDestroyRenderPass(dev->device, renderPass, nullptr); renderPass = VK_NULL_HANDLE; }
    if (swapchain_) {
        swapchain_->destroy(*dev);
        delete swapchain_;
        swapchain_ = nullptr;
    }
}

} // namespace giga::gpu
