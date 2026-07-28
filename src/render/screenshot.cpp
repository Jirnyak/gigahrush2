#include "render/screenshot.h"

#include <cstdio>
#include <cstring>
#include <vector>

#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "render/vk_swapchain.h"

namespace giga::gpu {

namespace {

std::uint32_t crc32_of(const std::uint8_t* p, std::size_t n, std::uint32_t crc) {
    // Table-free CRC-32. Eight shifts per byte is slower than a table and this runs
    // once per screenshot, so the table would be 1 KB of static data for nothing.
    crc = ~crc;
    for (std::size_t i = 0; i < n; ++i) {
        crc ^= p[i];
        for (int k = 0; k < 8; ++k)
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

void be32(std::vector<std::uint8_t>& out, std::uint32_t v) {
    out.push_back(static_cast<std::uint8_t>(v >> 24));
    out.push_back(static_cast<std::uint8_t>(v >> 16));
    out.push_back(static_cast<std::uint8_t>(v >> 8));
    out.push_back(static_cast<std::uint8_t>(v));
}

void chunk(std::vector<std::uint8_t>& out, const char tag[5],
           const std::vector<std::uint8_t>& body) {
    be32(out, static_cast<std::uint32_t>(body.size()));
    const std::size_t crcFrom = out.size();
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(tag[i]));
    out.insert(out.end(), body.begin(), body.end());
    const std::uint32_t crc =
        crc32_of(out.data() + crcFrom, out.size() - crcFrom, 0);
    be32(out, crc);
}

// zlib stream wrapping STORED deflate blocks. No compression: this is a debug
// artefact, and a real deflate implementation is a lot of code to avoid a few MB.
std::vector<std::uint8_t> zlib_stored(const std::vector<std::uint8_t>& raw) {
    std::vector<std::uint8_t> z;
    z.push_back(0x78);   // CMF: deflate, 32K window
    z.push_back(0x01);   // FLG: no dict, fastest; (0x78<<8|0x01) % 31 == 0
    std::size_t off = 0;
    while (off < raw.size()) {
        const std::size_t n =
            raw.size() - off > 65535u ? 65535u : raw.size() - off;
        const bool last = (off + n) >= raw.size();
        z.push_back(last ? 1u : 0u);
        z.push_back(static_cast<std::uint8_t>(n & 0xFF));
        z.push_back(static_cast<std::uint8_t>(n >> 8));
        const std::uint16_t inv = static_cast<std::uint16_t>(~n);
        z.push_back(static_cast<std::uint8_t>(inv & 0xFF));
        z.push_back(static_cast<std::uint8_t>(inv >> 8));
        z.insert(z.end(), raw.begin() + static_cast<std::ptrdiff_t>(off),
                 raw.begin() + static_cast<std::ptrdiff_t>(off + n));
        off += n;
    }
    // Adler-32 of the uncompressed data, per RFC 1950.
    std::uint32_t a = 1, b = 0;
    for (std::uint8_t v : raw) {
        a = (a + v) % 65521u;
        b = (b + a) % 65521u;
    }
    be32(z, (b << 16) | a);
    return z;
}

bool write_png(const char* path, std::uint32_t w, std::uint32_t h,
               const std::vector<std::uint8_t>& rgb) {
    // PNG scanlines are prefixed with a filter byte; 0 means "none".
    std::vector<std::uint8_t> raw;
    raw.reserve(static_cast<std::size_t>(h) * (1 + 3 * w));
    for (std::uint32_t y = 0; y < h; ++y) {
        raw.push_back(0);
        const std::size_t row = static_cast<std::size_t>(y) * w * 3;
        raw.insert(raw.end(), rgb.begin() + static_cast<std::ptrdiff_t>(row),
                   rgb.begin() + static_cast<std::ptrdiff_t>(row + w * 3));
    }

    std::vector<std::uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    std::vector<std::uint8_t> ihdr;
    be32(ihdr, w);
    be32(ihdr, h);
    ihdr.push_back(8);   // bit depth
    ihdr.push_back(2);   // colour type 2 = truecolour RGB
    ihdr.push_back(0);   // deflate
    ihdr.push_back(0);   // no filter
    ihdr.push_back(0);   // no interlace
    chunk(png, "IHDR", ihdr);
    chunk(png, "IDAT", zlib_stored(raw));
    chunk(png, "IEND", {});

    std::FILE* fh = std::fopen(path, "wb");
    if (!fh) return false;
    const std::size_t wrote = std::fwrite(png.data(), 1, png.size(), fh);
    std::fclose(fh);
    return wrote == png.size();
}

std::uint32_t find_memory(const VulkanDevice& dev, std::uint32_t typeBits,
                          VkMemoryPropertyFlags want) {
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev.physical, &mp);
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i)) &&
            (mp.memoryTypes[i].propertyFlags & want) == want)
            return i;
    return UINT32_MAX;
}

} // namespace

bool save_swapchain_png(VulkanDevice& dev, VulkanRenderer& ren, const char* path) {
    const VulkanSwapchain& sc = ren.swap();
    if (sc.images.empty()) return false;
    const std::uint32_t idx = ren.currentImageIndex;
    if (idx >= sc.images.size()) return false;
    const std::uint32_t w = sc.extent.width, h = sc.extent.height;
    if (w == 0 || h == 0) return false;

    // Which channel order the swapchain gave us. The renderer deliberately asks for a
    // UNORM format so the shader can do its own sRGB encode ([cube.frag]); both BGRA
    // and RGBA are plausible depending on the driver, so handle both rather than
    // assuming and silently producing a blue-tinted PNG.
    bool bgr;
    switch (sc.format) {
        case VK_FORMAT_B8G8R8A8_UNORM:
        case VK_FORMAT_B8G8R8A8_SRGB: bgr = true; break;
        case VK_FORMAT_R8G8B8A8_UNORM:
        case VK_FORMAT_R8G8B8A8_SRGB: bgr = false; break;
        default:
            std::fprintf(stderr, "screenshot: unsupported swapchain format %d\n",
                         static_cast<int>(sc.format));
            return false;
    }

    const VkDeviceSize bytes = static_cast<VkDeviceSize>(w) * h * 4;

    VkBufferCreateInfo bci{};
    bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bci.size = bytes;
    bci.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VkBuffer buf = VK_NULL_HANDLE;
    if (vkCreateBuffer(dev.device, &bci, nullptr, &buf) != VK_SUCCESS) return false;

    VkMemoryRequirements mr{};
    vkGetBufferMemoryRequirements(dev.device, buf, &mr);
    const std::uint32_t type =
        find_memory(dev, mr.memoryTypeBits,
                    VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                        VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (type == UINT32_MAX) {
        vkDestroyBuffer(dev.device, buf, nullptr);
        return false;
    }
    VkMemoryAllocateInfo mai{};
    mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = type;
    VkDeviceMemory mem = VK_NULL_HANDLE;
    if (vkAllocateMemory(dev.device, &mai, nullptr, &mem) != VK_SUCCESS) {
        vkDestroyBuffer(dev.device, buf, nullptr);
        return false;
    }
    vkBindBufferMemory(dev.device, buf, mem, 0);

    // A one-shot command buffer from a throwaway pool: the renderer's own pool and
    // command buffers belong to the frame loop and must not be reused here.
    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.queueFamilyIndex = dev.families.graphics;
    pci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    VkCommandPool pool = VK_NULL_HANDLE;
    vkCreateCommandPool(dev.device, &pci, nullptr, &pool);

    VkCommandBufferAllocateInfo cai{};
    cai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    cai.commandPool = pool;
    cai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    cai.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    vkAllocateCommandBuffers(dev.device, &cai, &cmd);

    VkCommandBufferBeginInfo cbi{};
    cbi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    cbi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &cbi);

    // PRESENT_SRC -> TRANSFER_SRC, copy, and back. The image must be returned to
    // PRESENT_SRC or the next present is undefined; on a --shot run we exit
    // immediately, but leaving a layout wrong because "we are about to quit" is the
    // kind of shortcut that breaks the day someone captures mid-session.
    VkImageMemoryBarrier b{};
    b.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    b.oldLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    b.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    b.srcAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    b.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    b.image = sc.images[idx];
    b.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr,
                         1, &b);

    VkBufferImageCopy region{};
    region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    region.imageExtent = {w, h, 1};
    vkCmdCopyImageToBuffer(cmd, sc.images[idx],
                           VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, buf, 1, &region);

    b.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
    b.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    b.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    b.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr,
                         1, &b);
    vkEndCommandBuffer(cmd);

    VkSubmitInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    si.commandBufferCount = 1;
    si.pCommandBuffers = &cmd;
    vkQueueSubmit(dev.graphicsQueue, 1, &si, VK_NULL_HANDLE);
    vkQueueWaitIdle(dev.graphicsQueue);

    void* mapped = nullptr;
    bool ok = false;
    if (vkMapMemory(dev.device, mem, 0, bytes, 0, &mapped) == VK_SUCCESS) {
        const std::uint8_t* src = static_cast<const std::uint8_t*>(mapped);
        std::vector<std::uint8_t> rgb(static_cast<std::size_t>(w) * h * 3);
        for (std::size_t i = 0, n = static_cast<std::size_t>(w) * h; i < n; ++i) {
            const std::uint8_t c0 = src[i * 4 + 0];
            const std::uint8_t c1 = src[i * 4 + 1];
            const std::uint8_t c2 = src[i * 4 + 2];
            rgb[i * 3 + 0] = bgr ? c2 : c0;
            rgb[i * 3 + 1] = c1;
            rgb[i * 3 + 2] = bgr ? c0 : c2;
        }
        vkUnmapMemory(dev.device, mem);
        ok = write_png(path, w, h, rgb);
    }

    vkDestroyCommandPool(dev.device, pool, nullptr);
    vkFreeMemory(dev.device, mem, nullptr);
    vkDestroyBuffer(dev.device, buf, nullptr);
    return ok;
}

} // namespace giga::gpu
