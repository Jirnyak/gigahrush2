#include "render/vk_renderer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/vk_swapchain.h"

#include <SDL3/SDL.h>

#include <cstdio>
#include <string>
#include <vector>

namespace giga::gpu {

namespace {

// Push-константы пост-паса; раскладка зеркалит post_pass.frag.
struct PostPush {
    float params0[4];    // timeSec, darkAdaptation, crtEnabled, chromAberr
    float params1[4];    // curvature, scanlineIntensity, vignettePower, phosphorWash
    float resolution[4]; // w, h, 1/w, 1/h
};

bool read_spv(const std::string& path, std::vector<char>& out) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    out.resize(static_cast<std::size_t>(n));
    const bool ok = std::fread(out.data(), 1, out.size(), f) == out.size();
    std::fclose(f);
    return ok;
}

bool make_module(VkDevice dev, const std::vector<char>& code, VkShaderModule* m) {
    VkShaderModuleCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    ci.codeSize = code.size();
    ci.pCode = reinterpret_cast<const std::uint32_t*>(code.data());
    return vkCreateShaderModule(dev, &ci, nullptr, m) == VK_SUCCESS;
}

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

// SDL3 renamed the SDL2 SDL_Vulkan_GetDrawableSize to the generic
// SDL_GetWindowSizeInPixels, which reports the true backing-store pixel size.
void drawable_size(SDL_Window* w, int* pw, int* ph) {
    SDL_GetWindowSizeInPixels(w, pw, ph);
}

} // namespace

bool VulkanRenderer::init(VulkanDevice& d, SDL_Window* window,
                          const char* shaderDir) {
    dev = &d;
    swapchain_ = new VulkanSwapchain();
    int w = 0, h = 0;
    drawable_size(window, &w, &h);
    if (!swapchain_->create(d, w, h)) return false;
    if (!create_hdr_target()) return false;
    if (!create_depth()) return false;
    if (!create_render_pass()) return false;
    if (!create_post_render_pass()) return false;
    if (!create_framebuffers()) return false;
    if (!create_post_descriptors()) return false;
    if (!create_post_pipeline(shaderDir)) return false;
    if (!create_commands()) return false;
    if (!create_frame_sync()) return false;
    if (!create_present_semaphores()) return false;
    // Deliberately not checked: missing timestamp support disables the readout,
    // it does not stop the game booting (gpu_timer.h).
    timer.init(d);
    return true;
}

bool VulkanRenderer::create_render_pass() {
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
    // EXTERNAL -> scene. HDR-таргет ОДИН на все кадры в полёте, и предыдущий
    // кадр читает его ФРАГМЕНТ-ШЕЙДЕРОМ пост-паса: без FRAGMENT_SHADER в
    // srcStageMask layout-переход UNDEFINED (discard) нового кадра не
    // упорядочен против этого чтения — write-after-read гонка форка. Для
    // WAR достаточно execution-зависимости, поэтому srcAccessMask пуст и
    // второй таргет не нужен.
    deps[0].srcSubpass = VK_SUBPASS_EXTERNAL;
    deps[0].dstSubpass = 0;
    deps[0].srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                           | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT
                           | VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    deps[0].dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                           | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
    deps[0].srcAccessMask = 0;
    deps[0].dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT
                            | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

    // Scene -> EXTERNAL: запись цвета видна семплеру пост-паса этого же кадра.
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

    if (hdrSampler == VK_NULL_HANDLE) {
        VkSamplerCreateInfo sci{};
        sci.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
        sci.magFilter = VK_FILTER_LINEAR;
        sci.minFilter = VK_FILTER_LINEAR;
        sci.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
        sci.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sci.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        VK_TRY(vkCreateSampler(dev->device, &sci, nullptr, &hdrSampler));
    }
    return true;
}

void VulkanRenderer::destroy_hdr_target() {
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
    // Сцена рисует в ЕДИНСТВЕННЫЙ HDR-таргет — один фреймбуфер, не по
    // свопчейн-имиджу (гонку кадров закрывает external-зависимость паса).
    {
        VkImageView att[2] = {hdrView, depthView};
        VkFramebufferCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        ci.renderPass = renderPass;
        ci.attachmentCount = 2;
        ci.pAttachments = att;
        ci.width = swapchain_->extent.width;
        ci.height = swapchain_->extent.height;
        ci.layers = 1;
        VK_TRY(vkCreateFramebuffer(dev->device, &ci, nullptr, &sceneFramebuffer_));
    }
    postFramebuffers_.resize(swapchain_->views.size());
    for (std::size_t i = 0; i < swapchain_->views.size(); ++i) {
        VkFramebufferCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        ci.renderPass = postRenderPass;
        ci.attachmentCount = 1;
        ci.pAttachments = &swapchain_->views[i];
        ci.width = swapchain_->extent.width;
        ci.height = swapchain_->extent.height;
        ci.layers = 1;
        VK_TRY(vkCreateFramebuffer(dev->device, &ci, nullptr, &postFramebuffers_[i]));
    }
    return true;
}

void VulkanRenderer::destroy_framebuffers() {
    if (sceneFramebuffer_) {
        vkDestroyFramebuffer(dev->device, sceneFramebuffer_, nullptr);
        sceneFramebuffer_ = VK_NULL_HANDLE;
    }
    for (auto fb : postFramebuffers_)
        if (fb) vkDestroyFramebuffer(dev->device, fb, nullptr);
    postFramebuffers_.clear();
}

bool VulkanRenderer::create_post_descriptors() {
    VkDescriptorSetLayoutBinding b{};
    b.binding = 0;
    b.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    b.descriptorCount = 1;
    b.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutCreateInfo lci{};
    lci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    lci.bindingCount = 1;
    lci.pBindings = &b;
    VK_TRY(vkCreateDescriptorSetLayout(dev->device, &lci, nullptr, &postSetLayout_));

    VkDescriptorPoolSize ps{};
    ps.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    ps.descriptorCount = 1;
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.maxSets = 1;
    pci.poolSizeCount = 1;
    pci.pPoolSizes = &ps;
    VK_TRY(vkCreateDescriptorPool(dev->device, &pci, nullptr, &postPool_));

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = postPool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &postSetLayout_;
    VK_TRY(vkAllocateDescriptorSets(dev->device, &ai, &postSet_));

    write_post_descriptor();
    return true;
}

void VulkanRenderer::write_post_descriptor() {
    VkDescriptorImageInfo ii{};
    ii.sampler = hdrSampler;
    ii.imageView = hdrView;
    ii.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

    VkWriteDescriptorSet w{};
    w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    w.dstSet = postSet_;
    w.dstBinding = 0;
    w.descriptorCount = 1;
    w.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    w.pImageInfo = &ii;
    vkUpdateDescriptorSets(dev->device, 1, &w, 0, nullptr);
}

bool VulkanRenderer::create_post_pipeline(const char* shaderDir) {
    std::vector<char> vsrc, fsrc;
    const std::string dir(shaderDir);
    if (!read_spv(dir + "/post_pass.vert.spv", vsrc)) return false;
    if (!read_spv(dir + "/post_pass.frag.spv", fsrc)) return false;

    VkShaderModule vs = VK_NULL_HANDLE, fs = VK_NULL_HANDLE;
    if (!make_module(dev->device, vsrc, &vs)) return false;
    if (!make_module(dev->device, fsrc, &fs)) {
        vkDestroyShaderModule(dev->device, vs, nullptr);
        return false;
    }

    VkPushConstantRange pcr{};
    pcr.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    pcr.size = sizeof(PostPush);

    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &postSetLayout_;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcr;
    if (vkCreatePipelineLayout(dev->device, &plci, nullptr, &postLayout_)
        != VK_SUCCESS) {
        vkDestroyShaderModule(dev->device, vs, nullptr);
        vkDestroyShaderModule(dev->device, fs, nullptr);
        return false;
    }

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vs;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fs;
    stages[1].pName = "main";

    // Полноэкранный треугольник из gl_VertexIndex: ни вершин, ни глубины.
    VkPipelineVertexInputStateCreateInfo vin{};
    vin.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;
    VkPipelineViewportStateCreateInfo vps{};
    vps.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vps.viewportCount = 1;
    vps.scissorCount = 1;
    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;
    rs.lineWidth = 1.0f;
    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
    VkPipelineColorBlendAttachmentState cba{};
    cba.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT
                         | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &cba;
    VkDynamicState dyn[2] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    ds.dynamicStateCount = 2;
    ds.pDynamicStates = dyn;

    VkGraphicsPipelineCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    ci.stageCount = 2;
    ci.pStages = stages;
    ci.pVertexInputState = &vin;
    ci.pInputAssemblyState = &ia;
    ci.pViewportState = &vps;
    ci.pRasterizationState = &rs;
    ci.pMultisampleState = &ms;
    ci.pColorBlendState = &cb;
    ci.pDynamicState = &ds;
    ci.layout = postLayout_;
    ci.renderPass = postRenderPass;
    const VkResult pr = vkCreateGraphicsPipelines(
        dev->device, VK_NULL_HANDLE, 1, &ci, nullptr, &postPipeline_);
    vkDestroyShaderModule(dev->device, vs, nullptr);
    vkDestroyShaderModule(dev->device, fs, nullptr);
    return pr == VK_SUCCESS;
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

    // The fence just waited on belongs to this slot's submission from
    // kMaxFramesInFlight frames ago, so that frame's timestamps are now complete
    // and readable with no additional stall. This is the only correct place for
    // the readback: earlier would block on in-flight GPU work and inflate the
    // very numbers being measured, and later would be after frame_begin() has
    // reset the range. See GpuTimer::collect.
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

    // Dynamic viewport + scissor covering the whole swapchain.
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

void VulkanRenderer::begin_post_pass() {
    VkCommandBuffer c = cmd[currentFrame];
    vkCmdEndRenderPass(c); // сценовый пас закрыт: HDR-таргет готов к семплингу

    VkClearValue clear{};
    clear.color.float32[3] = 1.0f;
    VkRenderPassBeginInfo rp{};
    rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rp.renderPass = postRenderPass;
    rp.framebuffer = postFramebuffers_[currentImageIndex];
    rp.renderArea.offset = {0, 0};
    rp.renderArea.extent = swapchain_->extent;
    rp.clearValueCount = 1;
    rp.pClearValues = &clear;
    vkCmdBeginRenderPass(c, &rp, VK_SUBPASS_CONTENTS_INLINE);

    VkViewport vp{};
    vp.width = static_cast<float>(swapchain_->extent.width);
    vp.height = static_cast<float>(swapchain_->extent.height);
    vp.maxDepth = 1.0f;
    vkCmdSetViewport(c, 0, 1, &vp);
    VkRect2D sc{};
    sc.extent = swapchain_->extent;
    vkCmdSetScissor(c, 0, 1, &sc);

    vkCmdBindPipeline(c, VK_PIPELINE_BIND_POINT_GRAPHICS, postPipeline_);
    vkCmdBindDescriptorSets(c, VK_PIPELINE_BIND_POINT_GRAPHICS, postLayout_, 0, 1,
                            &postSet_, 0, nullptr);

    PostPush push{};
    push.params0[0] = static_cast<float>(SDL_GetTicks()) / 1000.0f;
    push.params0[1] = darkAdaptation;
    push.params0[2] = crtEnabled ? 1.0f : 0.0f;
    push.params0[3] = chromaticAberration;
    push.params1[0] = crtCurvature;
    push.params1[1] = scanlineIntensity;
    push.params1[2] = vignettePower;
    push.params1[3] = phosphorWash;
    push.resolution[0] = vp.width;
    push.resolution[1] = vp.height;
    push.resolution[2] = vp.width > 0.0f ? 1.0f / vp.width : 0.0f;
    push.resolution[3] = vp.height > 0.0f ? 1.0f / vp.height : 0.0f;
    vkCmdPushConstants(c, postLayout_, VK_SHADER_STAGE_FRAGMENT_BIT, 0,
                       sizeof(PostPush), &push);
    vkCmdDraw(c, 3, 1, 0, 0);
    // Пас остаётся открытым: ImGui запишется сюда же, поверх обработки.
}

bool VulkanRenderer::end_frame(SDL_Window* window) {
    VkCommandBuffer c = cmd[currentFrame];
    vkCmdEndRenderPass(c); // закрывает ПОСТ-пас (begin_post_pass обязателен)

    // A pending capture is recorded HERE: after the render pass, before submit and
    // present. This is the only point at which the swapchain image is legally ours to
    // read — handed to us by vkAcquireNextImageKHR and not yet handed back.
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

        // Back to PRESENT_SRC, or the present that immediately follows is undefined.
        b.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        b.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        b.dstAccessMask = 0;
        vkCmdPipelineBarrier(c, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0, nullptr, 0,
                             nullptr, 1, &b);
        captureDone_ = true;
    }

    // Last command in the buffer: the whole-GPU-frame closing mark.
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
    // Only now are this slot's queries worth reading: before the submit the GPU
    // has written nothing and their contents are undefined.
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
    if (w == 0 || h == 0) return true; // minimized: retry next frame

    vkDeviceWaitIdle(dev->device);
    destroy_present_semaphores();
    destroy_framebuffers();
    destroy_depth();
    destroy_hdr_target();
    swapchain_->destroy(*dev);
    if (!swapchain_->create(*dev, w, h)) return false;
    if (!create_hdr_target()) return false;
    if (!create_depth()) return false;
    if (!create_framebuffers()) return false;
    if (!create_present_semaphores()) return false;
    // Новый hdrView — дескриптор пост-паса обязан смотреть на него.
    write_post_descriptor();
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
    destroy_framebuffers();
    destroy_depth();
    if (postPipeline_) { vkDestroyPipeline(dev->device, postPipeline_, nullptr); postPipeline_ = VK_NULL_HANDLE; }
    if (postLayout_) { vkDestroyPipelineLayout(dev->device, postLayout_, nullptr); postLayout_ = VK_NULL_HANDLE; }
    if (postPool_) { vkDestroyDescriptorPool(dev->device, postPool_, nullptr); postPool_ = VK_NULL_HANDLE; }
    if (postSetLayout_) { vkDestroyDescriptorSetLayout(dev->device, postSetLayout_, nullptr); postSetLayout_ = VK_NULL_HANDLE; }
    if (hdrSampler) { vkDestroySampler(dev->device, hdrSampler, nullptr); hdrSampler = VK_NULL_HANDLE; }
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
