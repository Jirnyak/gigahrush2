// Read a presented swapchain image back to a PNG on disk.
//
// This exists so a visual change can be PROVEN without a human at the keyboard and
// without leaving a window open. The renderer draws into a window surface — there is
// no headless path and the HUD only exists in a rendered frame — so a capture has to
// come out of the swapchain. Grabbing it from the compositor instead (the obvious
// alternative) is unreliable in practice: another window can come to the front between
// the focus call and the copy, and the result is a screenshot of a browser rather than
// of the game. That happened repeatedly before this existed.
//
// Used by `gigahrush2 --shot out.png --frames N`: render N frames, capture, exit. The
// window lives for a couple of seconds instead of indefinitely.
//
// The PNG is written by hand — zlib's uncompressed "stored" deflate blocks plus a CRC
// — because the project has no image library and adding one for this would be a
// dependency for a debug tool. A 1280x720 frame lands at about 3.7 MB, which is
// irrelevant for a proof artefact that is deleted after it is read.
#pragma once

#include <cstdint>

#include "render/vk_common.h"

namespace giga::gpu {

struct VulkanDevice;
struct VulkanRenderer;

// A capture in progress. Two phases, because the copy has to be recorded INSIDE a
// frame: the swapchain image belongs to the application only between
// vkAcquireNextImageKHR and vkQueuePresentKHR, so there is no legal way to read it
// after presenting. Request on one frame, save after the next.
//
// The first version of this did the copy after present from a throwaway command pool.
// It produced correct PNGs on this NVIDIA driver and was a spec violation the whole
// time — flagged by a validation run, invisible to any amount of testing here, and
// MoltenVK is where it would have bitten.
struct Capture {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    bool bgr = false;
};

// Allocate a host-visible staging buffer and ask the renderer to fill it on its next
// end_frame. Returns false and touches nothing on failure.
bool capture_request(VulkanDevice& dev, VulkanRenderer& ren, Capture& cap);

// Write the captured frame to `path` as a PNG and release the buffer. Must be called
// AFTER at least one end_frame has run since capture_request. Safe to call on a failed
// or unfilled capture — it releases and returns false.
bool capture_save(VulkanDevice& dev, VulkanRenderer& ren, Capture& cap,
                  const char* path);

} // namespace giga::gpu
