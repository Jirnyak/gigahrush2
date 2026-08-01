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

    // `label` names the buffer in the one-line placement log each allocation
    // emits at boot ("[vk-mem] <label>: N MiB -> type T heap H ..."). It is
    // DEFAULTED, not required, so existing call sites need no edit — but pass a
    // real name when you add one. The cube pass alone pins 128 MiB of
    // host-visible memory across its two frame slots and, until that log existed,
    // nothing said whether it landed in system RAM or in the VRAM BAR. An
    // unnamed 64 MiB line is still readable by size; two unnamed ones are not.

    // One-time DEVICE_LOCAL upload (adds TRANSFER_DST to usage).
    bool create_device_local(const VulkanDevice& dev, const void* data,
                             VkDeviceSize bytes, VkBufferUsageFlags usage,
                             const char* label = "device-local buffer");

    // DEVICE_LOCAL buffer with no initial contents — for mirrors filled by
    // their own staging paths (render/voxel_mirror.h). Caller supplies the
    // full usage set (transfer bits included); nothing is implied.
    bool create_device_local_empty(const VulkanDevice& dev, VkDeviceSize bytes,
                                   VkBufferUsageFlags usage,
                                   const char* label = "device-local buffer");

    // Persistently-mapped HOST_VISIBLE|HOST_COHERENT buffer of `bytes`.
    bool create_host_visible(const VulkanDevice& dev, VkDeviceSize bytes,
                             VkBufferUsageFlags usage,
                             const char* label = "host-visible buffer");

    void destroy(const VulkanDevice& dev);
};

} // namespace giga::gpu
