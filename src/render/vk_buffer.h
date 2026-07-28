// GPU buffers for the cube renderer.
//
// Two flavours:
//   - device-local: uploaded once from CPU data via a staging copy (the static
//     cube mesh). Never touch per frame.
//   - host-visible dynamic: persistently mapped, rewritten every frame (the
//     per-instance array of visible voxels). Cheap to update, no staging.
#pragma once

#include <vulkan/vulkan.h>

#include <cstddef>
#include <cstdint>

namespace giga::gpu {

struct VulkanDevice;

struct VulkanBuffer {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VkDeviceSize size = 0;
    void* mapped = nullptr; // non-null for host-visible dynamic buffers

    // One-time DEVICE_LOCAL upload (adds TRANSFER_DST to usage).
    bool create_device_local(const VulkanDevice& dev, const void* data,
                             VkDeviceSize bytes, VkBufferUsageFlags usage);

    // Persistently-mapped HOST_VISIBLE|HOST_COHERENT buffer of `bytes`.
    bool create_host_visible(const VulkanDevice& dev, VkDeviceSize bytes,
                             VkBufferUsageFlags usage);

    void destroy(const VulkanDevice& dev);
};

} // namespace giga::gpu
