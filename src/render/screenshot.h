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

// Copy the LAST PRESENTED swapchain image to `path` as a PNG.
//
// Must be called after `end_frame` returned true, so the image contains a complete
// frame. Blocks on a fence — this is a debug tool, not a per-frame path.
//
// Handles the two format families the swapchain is created with: B8G8R8A8 and
// R8G8B8A8, swizzling as needed. Returns false and writes nothing on any failure
// (unsupported format, no host-visible memory, unwritable path).
bool save_swapchain_png(VulkanDevice& dev, VulkanRenderer& ren, const char* path);

} // namespace giga::gpu
