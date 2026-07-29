#include "render/vk_buffer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <cstring>

namespace giga::gpu {

namespace {

// UINT32_MAX on failure, NOT 0.
//
// It used to return 0, which is indistinguishable from "found, and it is type 0" —
// so a device with no matching memory type got type 0 bound to it,
// vkAllocateMemory and vkBindBufferMemory both succeeded, and
// create_device_local() returned **true** having bound memory with the wrong
// properties. create_host_visible() then failed one line later at vkMapMemory with
// no explanation. find_memory() in screenshot.cpp already gets this right; the two
// now agree. This is a correctness fix, not a performance one.
std::uint32_t find_mem(const VkPhysicalDeviceMemoryProperties& mp,
                       std::uint32_t typeBits, VkMemoryPropertyFlags props) {
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i))
            && (mp.memoryTypes[i].propertyFlags & props) == props)
            return i;
    return UINT32_MAX;
}

// Which heap a buffer actually landed in, and how big that heap is.
//
// WHY THIS IS LOGGED. The two instance buffers of the cube pass are 64 MiB each
// (kMacroCells * sizeof(CubeInstance) = 2,097,152 * 32) and the body pass adds
// 2.25 MiB each, so the render layer pins ~132.5 MiB of HOST_VISIBLE memory for
// the life of the process — written by the CPU every rebuild and read by the GPU
// every frame. find_mem takes the FIRST type matching HOST_VISIBLE|HOST_COHERENT,
// and on a resizable-BAR system that can be a DEVICE_LOCAL|HOST_VISIBLE type: then
// those 132.5 MiB come out of the VRAM budget and CPU writes cross PCIe. It can
// equally be plain system memory, and then the GPU reads cross PCIe instead. Which
// one happens was not discoverable anywhere in the logs, so nobody could reason
// about it, let alone measure it. Four lines at boot, nothing per frame.
//
// The selection heuristic is deliberately NOT changed. Which placement is faster
// depends on the CPU-write to GPU-read ratio of this exact access pattern; that is
// a measurement, and silently moving 132 MiB between heaps on the strength of a
// guess is how a change regresses on hardware the author does not own.
void log_placement(const VkPhysicalDeviceMemoryProperties& mp, std::uint32_t type,
                   VkDeviceSize bytes, const char* what) {
    const VkMemoryPropertyFlags f = mp.memoryTypes[type].propertyFlags;
    const std::uint32_t heap = mp.memoryTypes[type].heapIndex;
    std::fprintf(stderr,
                 "[vk-mem] %s: %.2f MiB -> type %u heap %u (%.0f MiB)%s%s%s%s\n",
                 what, static_cast<double>(bytes) / (1024.0 * 1024.0), type, heap,
                 static_cast<double>(mp.memoryHeaps[heap].size)
                     / (1024.0 * 1024.0),
                 (f & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT) ? " DEVICE_LOCAL" : "",
                 (f & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) ? " HOST_VISIBLE" : "",
                 (f & VK_MEMORY_PROPERTY_HOST_COHERENT_BIT) ? " HOST_COHERENT" : "",
                 (f & VK_MEMORY_PROPERTY_HOST_CACHED_BIT) ? " HOST_CACHED" : "");
}

// `what` names the buffer in the placement log; pass nullptr for the transient
// staging buffers, whose heap nobody has to reason about.
bool make_buffer(const VulkanDevice& dev, VkDeviceSize size,
                 VkBufferUsageFlags usage, VkMemoryPropertyFlags props,
                 VkBuffer* buf, VkDeviceMemory* mem, const char* what) {
    VkBufferCreateInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bi.size = size;
    bi.usage = usage;
    bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_TRY(vkCreateBuffer(dev.device, &bi, nullptr, buf));
    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(dev.device, *buf, &req);

    // Queried once per buffer creation, which happens 8 times in the whole
    // process (two meshes x a staging pair, plus four instance buffers). Caching
    // it across calls would be optimising nothing measurable; noted so the next
    // reader does not have to work that out again.
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev.physical, &mp);
    const std::uint32_t type = find_mem(mp, req.memoryTypeBits, props);
    if (type == UINT32_MAX) {
        std::fprintf(stderr,
                     "[vk] no memory type for %s: typeBits=0x%08x props=0x%08x\n",
                     what ? what : "buffer",
                     static_cast<unsigned>(req.memoryTypeBits),
                     static_cast<unsigned>(props));
        // The VkBuffer above is already live, and this is the one failure path
        // that returns without the caller ever seeing the handle: the staging
        // pair in create_device_local passes a LOCAL VkBuffer, so nothing would
        // ever destroy it. Hand back VK_NULL_HANDLE so every caller's
        // VulkanBuffer::destroy() stays correct whichever way it failed.
        vkDestroyBuffer(dev.device, *buf, nullptr);
        *buf = VK_NULL_HANDLE;
        return false;
    }

    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = type;
    VK_TRY(vkAllocateMemory(dev.device, &ai, nullptr, mem));
    VK_TRY(vkBindBufferMemory(dev.device, *buf, *mem, 0));
    if (what) log_placement(mp, type, req.size, what);
    return true;
}

} // namespace

bool VulkanBuffer::create_device_local(const VulkanDevice& dev,
                                       const void* data, VkDeviceSize bytes,
                                       VkBufferUsageFlags usage,
                                       const char* label) {
    size = bytes;

    VkBuffer staging = VK_NULL_HANDLE;
    VkDeviceMemory stagingMem = VK_NULL_HANDLE;
    // nullptr: the staging buffer is created and destroyed inside this call, so
    // its placement is nobody's business and logging it would only add noise.
    if (!make_buffer(dev, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                     VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                         | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                     &staging, &stagingMem, nullptr))
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
                     VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, &buffer, &memory,
                     label)) {
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
                                       VkBufferUsageFlags usage,
                                       const char* label) {
    size = bytes;
    if (!make_buffer(dev, bytes, usage,
                     VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                         | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                     &buffer, &memory, label))
        return false;
    if (vkMapMemory(dev.device, memory, 0, bytes, 0, &mapped) != VK_SUCCESS) {
        std::fprintf(stderr, "[vk] vkMapMemory failed for %s (%.2f MiB)\n", label,
                     static_cast<double>(bytes) / (1024.0 * 1024.0));
        return false;
    }
    return true;
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
