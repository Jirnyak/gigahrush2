#include "render/vk_renderer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/vk_swapchain.h"

#include <SDL3/SDL.h>

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

// SDL3 renamed the SDL2 SDL_Vulkan_GetDrawableSize to the generic
// SDL_GetWindowSizeInPixels, which reports the true backing-store pixel size.
void drawable_size(SDL_Window* w, int* pw, int* ph) {
    SDL_GetWindowSizeInPixels(w, pw, ph);
}

} // namespace

bool VulkanRenderer::init(VulkanDevice& d, SDL_Window* window) {
    dev = &d;
    swapchain_ = new VulkanSwapchain();
    int w = 0, h = 0;
    drawable_size(window, &w, &h);
    if (!swapchain_->create(d, w, h)) return false;
    if (!create_depth()) return false;
    if (!create_render_pass()) return false;
    if (!create_framebuffers()) return false;
    if (!create_commands()) return false;
    if (!create_frame_sync()) return false;
    if (!create_present_semaphores()) return false;
    return true;
}

bool VulkanRenderer::create_render_pass() {
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

    VkSubpassDependency dep{};
    dep.srcSubpass = VK_SUBPASS_EXTERNAL;
    dep.dstSubpass = 0;
    dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                       | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
    dep.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT
                       | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
    dep.srcAccessMask = 0;
    dep.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT
                        | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

    VkAttachmentDescription atts[2] = {color, depth};
    VkRenderPassCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    ci.attachmentCount = 2;
    ci.pAttachments = atts;
    ci.subpassCount = 1;
    ci.pSubpasses = &sub;
    ci.dependencyCount = 1;
    ci.pDependencies = &dep;
    VK_TRY(vkCreateRenderPass(dev->device, &ci, nullptr, &renderPass));
    return true;
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
    framebuffers_.resize(swapchain_->views.size());
    for (std::size_t i = 0; i < swapchain_->views.size(); ++i) {
        VkImageView att[2] = {swapchain_->views[i], depthView};
        VkFramebufferCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        ci.renderPass = renderPass;
        ci.attachmentCount = 2;
        ci.pAttachments = att;
        ci.width = swapchain_->extent.width;
        ci.height = swapchain_->extent.height;
        ci.layers = 1;
        VK_TRY(vkCreateFramebuffer(dev->device, &ci, nullptr, &framebuffers_[i]));
    }
    return true;
}

void VulkanRenderer::destroy_framebuffers() {
    for (auto fb : framebuffers_)
        if (fb) vkDestroyFramebuffer(dev->device, fb, nullptr);
    framebuffers_.clear();
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
    rp.framebuffer = framebuffers_[currentImageIndex];
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

bool VulkanRenderer::begin_frame(SDL_Window* window, float r, float g, float b) {
    if (!acquire_frame(window)) return false;
    begin_render_pass(r, g, b);
    return true;
}

bool VulkanRenderer::end_frame(SDL_Window* window) {
    VkCommandBuffer c = cmd[currentFrame];
    vkCmdEndRenderPass(c);
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
    swapchain_->destroy(*dev);
    if (!swapchain_->create(*dev, w, h)) return true;
    if (!create_depth()) return false;
    if (!create_framebuffers()) return false;
    if (!create_present_semaphores()) return false;
    currentFrame = 0;
    return true;
}

void VulkanRenderer::destroy() {
    if (!dev) return;
    vkDeviceWaitIdle(dev->device);
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
    if (renderPass) { vkDestroyRenderPass(dev->device, renderPass, nullptr); renderPass = VK_NULL_HANDLE; }
    if (swapchain_) {
        swapchain_->destroy(*dev);
        delete swapchain_;
        swapchain_ = nullptr;
    }
}

} // namespace giga::gpu
