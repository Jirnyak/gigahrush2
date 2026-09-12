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

bool capture_request(VulkanDevice& dev, VulkanRenderer& ren, Capture& cap) {
    const VulkanSwapchain& sc = ren.swap();
    if (sc.images.empty()) return false;
    cap.width = sc.extent.width;
    cap.height = sc.extent.height;
    if (cap.width == 0 || cap.height == 0) return false;

    // The renderer deliberately asks for a UNORM format so the shader does its own sRGB
    // encode ([cube.frag]); both BGRA and RGBA are plausible depending on the driver, so
    // handle both rather than assuming and silently writing a blue-tinted PNG.
    switch (sc.format) {
        case VK_FORMAT_B8G8R8A8_UNORM:
        case VK_FORMAT_B8G8R8A8_SRGB: cap.bgr = true; break;
        case VK_FORMAT_R8G8B8A8_UNORM:
        case VK_FORMAT_R8G8B8A8_SRGB: cap.bgr = false; break;
        default:
            std::fprintf(stderr, "screenshot: unsupported swapchain format %d\n",
                         static_cast<int>(sc.format));
            return false;
    }

    const VkDeviceSize bytes = static_cast<VkDeviceSize>(cap.width) * cap.height * 4;
    VkBufferCreateInfo bci{};
    bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bci.size = bytes;
    bci.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (vkCreateBuffer(dev.device, &bci, nullptr, &cap.buffer) != VK_SUCCESS)
        return false;

    VkMemoryRequirements mr{};
    vkGetBufferMemoryRequirements(dev.device, cap.buffer, &mr);
    const std::uint32_t type =
        find_memory(dev, mr.memoryTypeBits,
                    VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                        VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (type == UINT32_MAX) {
        vkDestroyBuffer(dev.device, cap.buffer, nullptr);
        cap.buffer = VK_NULL_HANDLE;
        return false;
    }
    VkMemoryAllocateInfo mai{};
    mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    mai.allocationSize = mr.size;
    mai.memoryTypeIndex = type;
    if (vkAllocateMemory(dev.device, &mai, nullptr, &cap.memory) != VK_SUCCESS) {
        vkDestroyBuffer(dev.device, cap.buffer, nullptr);
        cap.buffer = VK_NULL_HANDLE;
        return false;
    }
    vkBindBufferMemory(dev.device, cap.buffer, cap.memory, 0);
    ren.request_capture(cap.buffer, sc.extent);
    return true;
}

bool capture_save(VulkanDevice& dev, VulkanRenderer& ren, Capture& cap,
                  const char* path) {
    bool ok = false;
    if (cap.buffer != VK_NULL_HANDLE && ren.capture_done()) {
        // vkDeviceWaitIdle rather than a fence: this runs once per process, and
        // threading a fence handle out through the renderer's API buys nothing.
        vkDeviceWaitIdle(dev.device);
        const VkDeviceSize bytes =
            static_cast<VkDeviceSize>(cap.width) * cap.height * 4;
        void* mapped = nullptr;
        if (vkMapMemory(dev.device, cap.memory, 0, bytes, 0, &mapped) == VK_SUCCESS) {
            const std::uint8_t* src = static_cast<const std::uint8_t*>(mapped);
            std::vector<std::uint8_t> rgb(
                static_cast<std::size_t>(cap.width) * cap.height * 3);
            for (std::size_t i = 0,
                             n = static_cast<std::size_t>(cap.width) * cap.height;
                 i < n; ++i) {
                const std::uint8_t c0 = src[i * 4 + 0];
                const std::uint8_t c1 = src[i * 4 + 1];
                const std::uint8_t c2 = src[i * 4 + 2];
                rgb[i * 3 + 0] = cap.bgr ? c2 : c0;
                rgb[i * 3 + 1] = c1;
                rgb[i * 3 + 2] = cap.bgr ? c0 : c2;
            }
            vkUnmapMemory(dev.device, cap.memory);
            ok = write_png(path, cap.width, cap.height, rgb);
        }
    }
    ren.clear_capture();
    if (cap.memory) vkFreeMemory(dev.device, cap.memory, nullptr);
    if (cap.buffer) vkDestroyBuffer(dev.device, cap.buffer, nullptr);
    cap = Capture{};
    return ok;
}

} // namespace giga::gpu
