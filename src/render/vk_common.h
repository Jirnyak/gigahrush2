// Vulkan backend common includes + minimal error handling.
// C API only (no vulkan.hpp); the render layer avoids exceptions to stay
// consistent with the engine core.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>
#include <cstdio>

namespace giga::gpu {

// Human-readable VkResult for logging. Covers the results we act on.
const char* vk_result_str(VkResult r);

// Use inside bool-returning init functions: logs the failing call and the
// VkResult, then returns false so the caller can bail and tear down.
#define VK_TRY(expr)                                                           \
    do {                                                                       \
        VkResult _vk_r = (expr);                                               \
        if (_vk_r != VK_SUCCESS) {                                             \
            std::fprintf(stderr, "[vk] %s failed: %s (%d) @ %s:%d\n", #expr,   \
                         ::giga::gpu::vk_result_str(_vk_r),                    \
                         static_cast<int>(_vk_r), __FILE__, __LINE__);         \
            return false;                                                      \
        }                                                                      \
    } while (0)

} // namespace giga::gpu
