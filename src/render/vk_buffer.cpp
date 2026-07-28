#include "render/vk_buffer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <cstring>

namespace giga::gpu {

namespace {

std::uint32_t find_mem(const VulkanDevice& dev, std::uint32_t typeBits,
                       VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev.physical, &mp);
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i))
            && (mp.memoryTypes[i].propertyFlags & props) == props)
            return i;
    return 0;
}

bool make_buffer(const VulkanDevice& dev, VkDeviceSize size,
                 VkBufferUsageFlags usage, VkMemoryPropertyFlags props,
                 VkBuffer* buf, VkDeviceMemory* mem) {
    VkBufferCreateInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bi.size = size;
    bi.usage = usage;
    bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_TRY(vkCreateBuffer(dev.device, &bi, nullptr, buf));
    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(dev.device, *buf, &req);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = find_mem(dev, req.memoryTypeBits, props);
    VK_TRY(vkAllocateMemory(dev.device, &ai, nullptr, mem));
    VK_TRY(vkBindBufferMemory(dev.device, *buf, *mem, 0));
    return true;
}

} // namespace

bool VulkanBuffer::create_device_local(const VulkanDevice& dev,
                                       const void* data, VkDeviceSize bytes,
                                       VkBufferUsageFlags usage) {
    size = bytes;

    VkBuffer staging = VK_NULL_HANDLE;
    VkDeviceMemory stagingMem = VK_NULL_HANDLE;
    if (!make_buffer(dev, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                     VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                         | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                     &staging, &stagingMem))
        return false;

    void* map = nullptr;
    if (vkMapMemory(dev.device, stagingMem, 0, bytes, 0, &map) != VK_SUCCESS) {
        vkDestroyBuffer(dev.device, staging, nullptr);
        vkFreeMemory(dev.device, stagingMem, nullptr);
        return false;
    }
    std::memcpy(map, data, static_cast<std::size_t>(bytes));
    vkUnmapMemory(dev.device, stagingMem);

    if (!make_buffer(dev, bytes, usage | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                     VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, &buffer, &memory)) {
        vkDestroyBuffer(dev.device, staging, nullptr);
        vkFreeMemory(dev.device, stagingMem, nullptr);
        return false;
    }

    VkCommandPool pool = VK_NULL_HANDLE;
    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    pci.queueFamilyIndex = dev.families.graphics;
    bool ok = vkCreateCommandPool(dev.device, &pci, nullptr, &pool)
              == VK_SUCCESS;

    VkCommandBuffer c = VK_NULL_HANDLE;
    if (ok) {
        VkCommandBufferAllocateInfo ai{};
        ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        ai.commandPool = pool;
        ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        ai.commandBufferCount = 1;
        ok = vkAllocateCommandBuffers(dev.device, &ai, &c) == VK_SUCCESS;
    }
    if (ok) {
        VkCommandBufferBeginInfo bi{};
        bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(c, &bi);
        VkBufferCopy region{};
        region.size = bytes;
        vkCmdCopyBuffer(c, staging, buffer, 1, &region);
        vkEndCommandBuffer(c);

        VkSubmitInfo si{};
        si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        si.commandBufferCount = 1;
        si.pCommandBuffers = &c;
        vkQueueSubmit(dev.graphicsQueue, 1, &si, VK_NULL_HANDLE);
        vkQueueWaitIdle(dev.graphicsQueue);
    }

    if (pool) vkDestroyCommandPool(dev.device, pool, nullptr);
    vkDestroyBuffer(dev.device, staging, nullptr);
    vkFreeMemory(dev.device, stagingMem, nullptr);
    return ok;
}

bool VulkanBuffer::create_host_visible(const VulkanDevice& dev,
                                       VkDeviceSize bytes,
                                       VkBufferUsageFlags usage) {
    size = bytes;
    if (!make_buffer(dev, bytes, usage,
                     VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                         | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                     &buffer, &memory))
        return false;
    return vkMapMemory(dev.device, memory, 0, bytes, 0, &mapped) == VK_SUCCESS;
}

void VulkanBuffer::destroy(const VulkanDevice& dev) {
    if (mapped) {
        vkUnmapMemory(dev.device, memory);
        mapped = nullptr;
    }
    if (buffer) {
        vkDestroyBuffer(dev.device, buffer, nullptr);
        buffer = VK_NULL_HANDLE;
    }
    if (memory) {
        vkFreeMemory(dev.device, memory, nullptr);
        memory = VK_NULL_HANDLE;
    }
    size = 0;
}

} // namespace giga::gpu
