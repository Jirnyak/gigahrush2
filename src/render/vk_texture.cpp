#include "render/vk_texture.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <ktx.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

namespace giga::gpu {

namespace {

// Both candidate targets are 4x4 blocks of 16 bytes, which is what makes the
// staging arithmetic in chain_bytes() independent of which one is chosen.
inline constexpr std::uint32_t kBlockDim = 4;
inline constexpr VkDeviceSize kBlockBytes = 16;

struct Target {
    VkFormat format;
    ktx_transcode_fmt_e ttf;
    const char* name;
};

// Order is preference, and it is an argument rather than a habit. BC7 first
// because every desktop discrete GPU has it and it is what the pack was tuned
// for; ASTC second because it is what Apple silicon has instead of BC, and
// because it is LOSSLESS here — UASTC LDR 4x4 is an ASTC 4x4 subset, so that
// transcode is a re-wrap where BC7 costs a measured mean -1.84 dB
// (data/textures/README.md, per-map table). If BC ever stops being universal the
// order is the only thing that has to change.
constexpr Target kTargets[] = {
    {VK_FORMAT_BC7_SRGB_BLOCK, KTX_TTF_BC7_RGBA, "BC7_SRGB_BLOCK"},
    {VK_FORMAT_ASTC_4x4_SRGB_BLOCK, KTX_TTF_ASTC_4x4_RGBA, "ASTC_4x4_SRGB_BLOCK"},
};

// Third copy of this eight-line search in src/render (vk_buffer.cpp and
// screenshot.cpp have the other two), and it stays a copy on purpose: hoisting it
// would mean editing vk_buffer.h, which belongs to another lane. When somebody
// owns that header, this is the third consumer and therefore the moment
// AGENTS.md's "a shared utility used by 3+ consumers" rule says to move it.
//
// UINT32_MAX on failure, never 0 — the bug vk_buffer.cpp documents at length is
// that "type 0" and "not found" are indistinguishable, and a wrong-property
// binding then succeeds all the way to a silent failure much later.
std::uint32_t find_mem(const VkPhysicalDeviceMemoryProperties& mp,
                       std::uint32_t typeBits, VkMemoryPropertyFlags props) {
    for (std::uint32_t i = 0; i < mp.memoryTypeCount; ++i)
        if ((typeBits & (1u << i))
            && (mp.memoryTypes[i].propertyFlags & props) == props)
            return i;
    return UINT32_MAX;
}

inline std::uint32_t mip_dim(std::uint32_t base, std::uint32_t level) {
    const std::uint32_t d = base >> level;
    return d > 0 ? d : 1u;
}

// Exact byte count of one mip level as 4x4 blocks. ceil-divide, not floor: the
// tail levels of a 2048 chain are 2x2 and 1x1 texels and still occupy one whole
// block each, which is why the measured `uncompressedByteLength` of the last
// three levels of every file in the pack is 16 and not 4 or 1.
VkDeviceSize level_bytes(std::uint32_t width, std::uint32_t height,
                         std::uint32_t level) {
    const VkDeviceSize bw = (mip_dim(width, level) + kBlockDim - 1) / kBlockDim;
    const VkDeviceSize bh = (mip_dim(height, level) + kBlockDim - 1) / kBlockDim;
    return bw * bh * kBlockBytes;
}

// Reject a file whose shape is not the shape the array image was created with.
// Every one of these is a case where uploading anyway would produce a plausible
// but wrong image, which is worse than refusing.
bool validate_shape(const ktxTexture2* tex, const char* path, std::uint32_t width,
                    std::uint32_t height, std::uint32_t mips) {
    if (tex->numDimensions != 2 || tex->isCubemap || tex->numFaces != 1) {
        std::fprintf(stderr,
                     "[tex] ERROR %s: not a plain 2D image "
                     "(numDimensions=%u faces=%u cubemap=%d)\n",
                     path, tex->numDimensions, tex->numFaces,
                     static_cast<int>(tex->isCubemap));
        return false;
    }
    if (tex->numLayers > 1 || tex->isArray) {
        std::fprintf(stderr, "[tex] ERROR %s: is itself an array (%u layers)\n",
                     path, tex->numLayers);
        return false;
    }
    if (tex->baseWidth != width || tex->baseHeight != height) {
        std::fprintf(stderr,
                     "[tex] ERROR %s: %ux%u does not match the array's %ux%u\n",
                     path, tex->baseWidth, tex->baseHeight, width, height);
        return false;
    }
    // A short chain is the quiet one: it uploads, it samples, and the missing
    // small mips read as aliasing at range that looks like a shader bug.
    if (tex->numLevels != mips) {
        std::fprintf(stderr,
                     "[tex] ERROR %s: %u mip levels, the array has %u — a "
                     "partial chain would alias at range\n",
                     path, tex->numLevels, mips);
        return false;
    }
    return true;
}

// Inflate + transcode, then prove the result is the format the image was created
// with. `NeedsTranscoding` is true for this pack (vkFormat is UNDEFINED); a file
// that says false must already carry the exact target format or it cannot be
// copied into this image.
bool transcode_to_target(ktxTexture2* tex, const char* path, const Target& target) {
    if (ktxTexture2_NeedsTranscoding(tex)) {
        const KTX_error_code r = ktxTexture2_TranscodeBasis(tex, target.ttf, 0);
        if (r != KTX_SUCCESS) {
            std::fprintf(stderr, "[tex] ERROR %s: transcode to %s failed: %s\n",
                         path, target.name, ktxErrorString(r));
            return false;
        }
    }
    if (tex->vkFormat != static_cast<ktx_uint32_t>(target.format)) {
        std::fprintf(stderr,
                     "[tex] ERROR %s: vkFormat is %u after transcode, the image "
                     "is %s (%d)\n",
                     path, tex->vkFormat, target.name,
                     static_cast<int>(target.format));
        return false;
    }
    if (tex->supercompressionScheme != KTX_SS_NONE) {
        std::fprintf(stderr,
                     "[tex] ERROR %s: still supercompressed (scheme %d) after "
                     "transcode — the payload is not uploadable\n",
                     path, static_cast<int>(tex->supercompressionScheme));
        return false;
    }
    if (!tex->pData || tex->dataSize == 0) {
        std::fprintf(stderr, "[tex] ERROR %s: no image data after transcode\n",
                     path);
        return false;
    }
    return true;
}

// Re-pack the decoded chain into the staging buffer at offsets THIS function
// chooses, and fill `outOffsets` with them.
//
// This is the whole answer to trap 3. libktx reports where each level sits in its
// own allocation, and for a supercompressed source those positions have no
// alignment guarantee whatsoever — measured mod 16 across factory_wall.ktx2's
// level index: 11, 4, 6, 0, 7, 7, 6, 12, 3, 10, 1, 8. A compressed-format
// VkBufferImageCopy requires bufferOffset to be a multiple of the 16-byte block,
// so copying "the whole blob once, then point at libktx's offsets" is invalid on
// nine of those twelve levels. Copying level by level into a 16-aligned cursor
// costs one memcpy of the same total bytes and removes the assumption entirely:
// the offsets are ours, so their alignment is a fact rather than a hope.
bool pack_levels(ktxTexture2* tex, const char* path, std::uint32_t mips,
                 std::uint32_t width, std::uint32_t height, void* staging,
                 VkDeviceSize stagingBytes, VkDeviceSize* outOffsets) {
    auto* base = reinterpret_cast<ktxTexture*>(tex);
    auto* dst = static_cast<std::uint8_t*>(staging);
    VkDeviceSize cursor = 0;
    for (std::uint32_t level = 0; level < mips; ++level) {
        const VkDeviceSize want = level_bytes(width, height, level);
        const ktx_size_t have = ktxTexture_GetImageSize(base, level);
        if (static_cast<VkDeviceSize>(have) != want) {
            std::fprintf(stderr,
                         "[tex] ERROR %s: level %u is %llu B, its exact block "
                         "count is %llu B\n",
                         path, level, static_cast<unsigned long long>(have),
                         static_cast<unsigned long long>(want));
            return false;
        }
        ktx_size_t srcOff = 0;
        const KTX_error_code r = ktxTexture2_GetImageOffset(tex, level, 0, 0,
                                                           &srcOff);
        if (r != KTX_SUCCESS) {
            std::fprintf(stderr, "[tex] ERROR %s: level %u offset: %s\n", path,
                         level, ktxErrorString(r));
            return false;
        }
        // A truncated read cannot reach here silently: libktx would have failed
        // the inflate, but the bound check is what makes that a guarantee rather
        // than a belief about somebody else's code.
        if (static_cast<VkDeviceSize>(srcOff) + want
            > static_cast<VkDeviceSize>(tex->dataSize)) {
            std::fprintf(stderr,
                         "[tex] ERROR %s: level %u runs past the decoded data "
                         "(%llu + %llu > %llu)\n",
                         path, level, static_cast<unsigned long long>(srcOff),
                         static_cast<unsigned long long>(want),
                         static_cast<unsigned long long>(tex->dataSize));
            return false;
        }
        if (cursor + want > stagingBytes) {
            std::fprintf(stderr,
                         "[tex] ERROR %s: level %u overruns the %llu B staging "
                         "buffer\n",
                         path, level,
                         static_cast<unsigned long long>(stagingBytes));
            return false;
        }
        std::memcpy(dst + cursor, tex->pData + srcOff,
                    static_cast<std::size_t>(want));
        outOffsets[level] = cursor;
        cursor += want;
        // Every level of a 16-byte-block chain is already a multiple of 16, so
        // this round is a no-op today. It is here because "already aligned" is a
        // property of the block size, and the one thing the old BC7 pack proved
        // is that a loader which assumes an alignment it did not enforce breaks
        // silently when the pack changes.
        cursor = (cursor + kBlockBytes - 1) / kBlockBytes * kBlockBytes;
    }
    return true;
}

} // namespace

VkDeviceSize chain_bytes(std::uint32_t width, std::uint32_t height,
                         std::uint32_t mips) {
    VkDeviceSize total = 0;
    for (std::uint32_t level = 0; level < mips; ++level) {
        total += level_bytes(width, height, level);
        total = (total + kBlockBytes - 1) / kBlockBytes * kBlockBytes;
    }
    return total;
}

const char* VulkanTextureArray::format_name() const {
    for (const Target& t : kTargets)
        if (t.format == format_) return t.name;
    return "UNDEFINED";
}

bool VulkanTextureArray::choose_format() {
    // SAMPLED_IMAGE alone is not enough: without FILTER_LINEAR the sampler below
    // is invalid, and a NEAREST fallback on a 2048 map with 12 mips would shimmer
    // so hard it would read as a bug in the mip chain.
    constexpr VkFormatFeatureFlags kNeed =
        VK_FORMAT_FEATURE_SAMPLED_IMAGE_BIT
        | VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT;
    for (const Target& t : kTargets) {
        VkFormatProperties fp{};
        vkGetPhysicalDeviceFormatProperties(dev_->physical, t.format, &fp);
        if ((fp.optimalTilingFeatures & kNeed) != kNeed) continue;

        VkImageFormatProperties ifp{};
        const VkResult r = vkGetPhysicalDeviceImageFormatProperties(
            dev_->physical, t.format, VK_IMAGE_TYPE_2D, VK_IMAGE_TILING_OPTIMAL,
            VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 0,
            &ifp);
        if (r != VK_SUCCESS) continue;
        if (ifp.maxArrayLayers < layers_ || ifp.maxMipLevels < mips_
            || ifp.maxExtent.width < width_ || ifp.maxExtent.height < height_) {
            std::fprintf(stderr,
                         "[tex] %s can be sampled but not at %ux%u x%u layers "
                         "x%u mips (device max %ux%u x%u x%u)\n",
                         t.name, width_, height_, layers_, mips_,
                         ifp.maxExtent.width, ifp.maxExtent.height,
                         ifp.maxArrayLayers, ifp.maxMipLevels);
            continue;
        }
        format_ = t.format;
        target_ = static_cast<int>(t.ttf);
        return true;
    }
    std::fprintf(stderr,
                 "[tex] ERROR: this device samples neither BC7_SRGB nor "
                 "ASTC_4x4_SRGB with linear filtering, so the UASTC pack in "
                 "data/textures cannot be transcoded to anything it can read. "
                 "Falling back to the procedural surface.\n");
    return false;
}

bool VulkanTextureArray::create_image() {
    VkImageCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ci.imageType = VK_IMAGE_TYPE_2D;
    ci.format = format_;
    ci.extent = {width_, height_, 1};
    ci.mipLevels = mips_;
    ci.arrayLayers = layers_;
    ci.samples = VK_SAMPLE_COUNT_1_BIT;
    ci.tiling = VK_IMAGE_TILING_OPTIMAL;
    ci.usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;
    ci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    ci.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    VK_TRY(vkCreateImage(dev_->device, &ci, nullptr, &image_));

    VkMemoryRequirements req{};
    vkGetImageMemoryRequirements(dev_->device, image_, &req);
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev_->physical, &mp);
    const std::uint32_t type = find_mem(mp, req.memoryTypeBits,
                                       VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (type == UINT32_MAX) {
        std::fprintf(stderr,
                     "[tex] ERROR: no DEVICE_LOCAL memory type for the albedo "
                     "array: typeBits=0x%08x\n",
                     static_cast<unsigned>(req.memoryTypeBits));
        return false;
    }
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = type;
    VK_TRY(vkAllocateMemory(dev_->device, &ai, nullptr, &memory_));
    VK_TRY(vkBindImageMemory(dev_->device, image_, memory_, 0));
    deviceBytes_ = req.size;

    // Same reasoning as vk_buffer.cpp's placement log: an allocation this size
    // that nothing reports is an allocation nobody can reason about. 16 layers of
    // a 12-level 2048 chain is 85.33 MiB of VRAM even though only six layers
    // carry a photograph, and that trade is deliberate — see the layer-indexing
    // note in cube_pass.cpp.
    std::fprintf(stderr,
                 "[vk-mem] albedo array: %.2f MiB -> type %u heap %u (%.0f MiB) "
                 "%s %ux%u x%u layers x%u mips\n",
                 static_cast<double>(req.size) / (1024.0 * 1024.0), type,
                 mp.memoryTypes[type].heapIndex,
                 static_cast<double>(mp.memoryHeaps[mp.memoryTypes[type].heapIndex]
                                         .size)
                     / (1024.0 * 1024.0),
                 format_name(), width_, height_, layers_, mips_);
    return true;
}

bool VulkanTextureArray::create_view_and_sampler() {
    VkImageViewCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vi.image = image_;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D_ARRAY;
    vi.format = format_;
    vi.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    vi.subresourceRange.levelCount = mips_;
    vi.subresourceRange.layerCount = layers_;
    VK_TRY(vkCreateImageView(dev_->device, &vi, nullptr, &view_));

    VkSamplerCreateInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    si.magFilter = VK_FILTER_LINEAR;
    si.minFilter = VK_FILTER_LINEAR;
    si.mipmapMode = VK_SAMPLER_MIPMAP_MODE_LINEAR;
    // REPEAT on both axes because the uv the world pass feeds this is WORLD
    // space in cell units, unbounded and growing with the grid — a clamped
    // sampler would smear the last texel across an entire wall.
    si.addressModeU = VK_SAMPLER_ADDRESS_MODE_REPEAT;
    si.addressModeV = VK_SAMPLER_ADDRESS_MODE_REPEAT;
    si.addressModeW = VK_SAMPLER_ADDRESS_MODE_REPEAT;
    // ANISOTROPY IS OFF, and not because it would not help. vk_device.cpp creates
    // the logical device with a zero-initialised VkPhysicalDeviceFeatures, so
    // samplerAnisotropy is NOT enabled and requesting it here would be an invalid
    // sampler rather than a slow one. Enabling the feature is a one-line change in
    // a file this lane does not own; until it happens, floors seen at a grazing
    // angle are blurrier than they need to be. Stated rather than papered over.
    si.anisotropyEnable = VK_FALSE;
    si.maxAnisotropy = 1.0f;
    si.compareEnable = VK_FALSE;
    si.borderColor = VK_BORDER_COLOR_INT_OPAQUE_BLACK;
    si.unnormalizedCoordinates = VK_FALSE;
    si.minLod = 0.0f;
    // The full chain. Not VK_LOD_CLAMP_NONE: mips_ is the exact level count, and
    // pinning it means a future short chain clamps instead of sampling a level
    // that does not exist.
    si.maxLod = static_cast<float>(mips_);
    VK_TRY(vkCreateSampler(dev_->device, &si, nullptr, &sampler_));
    return true;
}

bool VulkanTextureArray::create_descriptor() {
    VkDescriptorSetLayoutBinding b{};
    b.binding = 0;
    b.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    b.descriptorCount = 1;
    b.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    VkDescriptorSetLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    li.bindingCount = 1;
    li.pBindings = &b;
    VK_TRY(vkCreateDescriptorSetLayout(dev_->device, &li, nullptr, &setLayout_));

    VkDescriptorPoolSize ps{};
    ps.type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    ps.descriptorCount = 1;
    VkDescriptorPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pi.maxSets = 1;
    pi.poolSizeCount = 1;
    pi.pPoolSizes = &ps;
    VK_TRY(vkCreateDescriptorPool(dev_->device, &pi, nullptr, &pool_));

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = pool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &setLayout_;
    VK_TRY(vkAllocateDescriptorSets(dev_->device, &ai, &set_));

    // The set is allocated here and WRITTEN in finish(), once the image is
    // actually in SHADER_READ_ONLY_OPTIMAL. Writing it now with that layout while
    // the image is still TRANSFER_DST is legal by the letter of the spec — a
    // descriptor is only consumed at draw time — but it makes the validation
    // layer's image-layout tracking report a mismatch that is noise rather than a
    // defect, and noise in the one channel that reports real defects is a cost.
    return true;
}

bool VulkanTextureArray::create_staging() {
    stagingBytes_ = chain_bytes(width_, height_, mips_);
    VkBufferCreateInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bi.size = stagingBytes_;
    bi.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_TRY(vkCreateBuffer(dev_->device, &bi, nullptr, &staging_));

    VkMemoryRequirements req{};
    vkGetBufferMemoryRequirements(dev_->device, staging_, &req);
    VkPhysicalDeviceMemoryProperties mp{};
    vkGetPhysicalDeviceMemoryProperties(dev_->physical, &mp);
    const std::uint32_t type =
        find_mem(mp, req.memoryTypeBits,
                 VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
                     | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (type == UINT32_MAX) {
        std::fprintf(stderr,
                     "[tex] ERROR: no HOST_VISIBLE|HOST_COHERENT memory type "
                     "for the %llu B texture staging buffer\n",
                     static_cast<unsigned long long>(stagingBytes_));
        return false;
    }
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = type;
    VK_TRY(vkAllocateMemory(dev_->device, &ai, nullptr, &stagingMem_));
    VK_TRY(vkBindBufferMemory(dev_->device, staging_, stagingMem_, 0));
    VK_TRY(vkMapMemory(dev_->device, stagingMem_, 0, stagingBytes_, 0,
                       &stagingMap_));
    return true;
}

bool VulkanTextureArray::run_one_shot(VkCommandBuffer* out) {
    VkCommandBufferAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    ai.commandPool = cmdPool_;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VK_TRY(vkAllocateCommandBuffers(dev_->device, &ai, out));
    VkCommandBufferBeginInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    VK_TRY(vkBeginCommandBuffer(*out, &bi));
    return true;
}

bool VulkanTextureArray::submit_and_wait(VkCommandBuffer cmd) {
    VK_TRY(vkEndCommandBuffer(cmd));
    VkSubmitInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    si.commandBufferCount = 1;
    si.pCommandBuffers = &cmd;
    VK_TRY(vkQueueSubmit(dev_->graphicsQueue, 1, &si, VK_NULL_HANDLE));
    // Load-time only, and load time is unbounded per performance.md. A fence per
    // upload would buy nothing: the very next thing this does is overwrite the
    // one staging buffer the copy is reading from.
    VK_TRY(vkQueueWaitIdle(dev_->graphicsQueue));
    vkFreeCommandBuffers(dev_->device, cmdPool_, 1, &cmd);
    return true;
}

bool VulkanTextureArray::transition(VkImageLayout from, VkImageLayout to) {
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (!run_one_shot(&cmd)) return false;

    VkImageMemoryBarrier b{};
    b.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    b.oldLayout = from;
    b.newLayout = to;
    b.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.image = image_;
    b.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    b.subresourceRange.levelCount = mips_;
    b.subresourceRange.layerCount = layers_;

    VkPipelineStageFlags srcStage = VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT;
    VkPipelineStageFlags dstStage = VK_PIPELINE_STAGE_TRANSFER_BIT;
    if (to == VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL) {
        b.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        b.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        srcStage = VK_PIPELINE_STAGE_TRANSFER_BIT;
        dstStage = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
    } else {
        b.srcAccessMask = 0;
        b.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    }
    vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 0, nullptr, 0, nullptr, 1,
                         &b);
    return submit_and_wait(cmd);
}

bool VulkanTextureArray::copy_staged_levels(std::uint32_t layer,
                                            const VkDeviceSize* offsets) {
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (!run_one_shot(&cmd)) return false;

    // 12 regions, one submit. bufferRowLength/bufferImageHeight stay 0 ("tightly
    // packed, matching imageExtent"), which is correct because the pack is
    // row-major with no per-row padding — data/textures/README.md states it and
    // pack_levels() has just proved every level is exactly its block count.
    VkBufferImageCopy regions[32]{};
    const std::uint32_t n = std::min<std::uint32_t>(mips_, 32);
    for (std::uint32_t level = 0; level < n; ++level) {
        regions[level].bufferOffset = offsets[level];
        regions[level].imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        regions[level].imageSubresource.mipLevel = level;
        regions[level].imageSubresource.baseArrayLayer = layer;
        regions[level].imageSubresource.layerCount = 1;
        regions[level].imageExtent = {mip_dim(width_, level),
                                      mip_dim(height_, level), 1};
    }
    vkCmdCopyBufferToImage(cmd, staging_, image_,
                           VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, n, regions);
    return submit_and_wait(cmd);
}

bool VulkanTextureArray::init(VulkanDevice& dev, std::uint32_t layers,
                              std::uint32_t width, std::uint32_t height,
                              std::uint32_t mips) {
    dev_ = &dev;
    layers_ = layers;
    width_ = width;
    height_ = height;
    mips_ = mips;
    if (layers_ == 0 || mips_ == 0 || mips_ > 32 || width_ == 0 || height_ == 0) {
        std::fprintf(stderr,
                     "[tex] ERROR: bad array shape %ux%u x%u layers x%u mips\n",
                     width_, height_, layers_, mips_);
        return false;
    }
    if (!choose_format()) return false;
    if (!create_image()) return false;
    if (!create_view_and_sampler()) return false;
    if (!create_descriptor()) return false;

    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    pci.queueFamilyIndex = dev_->families.graphics;
    VK_TRY(vkCreateCommandPool(dev_->device, &pci, nullptr, &cmdPool_));

    if (!create_staging()) return false;
    // Every layer, including the ones no file will ever fill. Their contents stay
    // undefined, which is safe only because the caller's material mask stops the
    // shader sampling them; see the mask contract in cube_pass.cpp. A compressed
    // image cannot be cleared (vkCmdClearColorImage rejects block formats) and
    // hand-writing a constant-colour BC7 block to fake one would be exactly the
    // plausible-looking wrong texture this repository bans.
    return transition(VK_IMAGE_LAYOUT_UNDEFINED,
                      VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL);
}

bool VulkanTextureArray::load_layer(std::uint32_t layer, const char* path) {
    if (!dev_ || image_ == VK_NULL_HANDLE) {
        std::fprintf(stderr, "[tex] ERROR %s: load before init\n", path);
        return false;
    }
    if (sealed_) {
        std::fprintf(stderr, "[tex] ERROR %s: load after finish()\n", path);
        return false;
    }
    if (layer >= layers_) {
        std::fprintf(stderr, "[tex] ERROR %s: layer %u is past the %u the array "
                             "was created with\n",
                     path, layer, layers_);
        return false;
    }

    const Target target{format_, static_cast<ktx_transcode_fmt_e>(target_),
                        format_name()};

    const auto tDecode0 = std::chrono::steady_clock::now();
    ktxTexture2* tex = nullptr;
    const KTX_error_code r = ktxTexture2_CreateFromNamedFile(
        path, KTX_TEXTURE_CREATE_LOAD_IMAGE_DATA_BIT, &tex);
    if (r != KTX_SUCCESS || tex == nullptr) {
        // The loudest of the loud paths, because it is the likely one: a missing
        // file, a wrong working directory, or a truncated checkout. Named file,
        // named libktx reason, no substitute image.
        std::fprintf(stderr, "[tex] ERROR %s: %s\n", path, ktxErrorString(r));
        return false;
    }

    VkDeviceSize offsets[32] = {};
    bool ok = validate_shape(tex, path, width_, height_, mips_);
    if (ok) ok = transcode_to_target(tex, path, target);
    if (ok) {
        // The chain is size-preserving, so this equality is a real check on the
        // container rather than bookkeeping: 5,592,432 B for every 2048 map in
        // the pack, before and after the transcode.
        const VkDeviceSize want = chain_bytes(width_, height_, mips_);
        if (static_cast<VkDeviceSize>(tex->dataSize) < want) {
            std::fprintf(stderr,
                         "[tex] ERROR %s: decoded to %llu B, a complete %u-level "
                         "chain is %llu B\n",
                         path, static_cast<unsigned long long>(tex->dataSize),
                         mips_, static_cast<unsigned long long>(want));
            ok = false;
        }
    }
    if (ok)
        ok = pack_levels(tex, path, mips_, width_, height_, stagingMap_,
                         stagingBytes_, offsets);
    const std::size_t srcBytes = ok ? static_cast<std::size_t>(tex->dataSize) : 0;
    ktxTexture2_Destroy(tex);
    const auto tDecode1 = std::chrono::steady_clock::now();
    if (!ok) return false;

    if (!copy_staged_levels(layer, offsets)) return false;
    const auto tUpload1 = std::chrono::steady_clock::now();

    const double dms =
        std::chrono::duration<double, std::milli>(tDecode1 - tDecode0).count();
    const double ums =
        std::chrono::duration<double, std::milli>(tUpload1 - tDecode1).count();
    decodeMs_ += dms;
    uploadMs_ += ums;
    ++loaded_;
    std::fprintf(stderr,
                 "[tex] layer %2u <- %s: %llu B decoded -> %s, %u levels, "
                 "%.1f ms decode + %.1f ms upload\n",
                 layer, path, static_cast<unsigned long long>(srcBytes),
                 format_name(), mips_, dms, ums);
    return true;
}

bool VulkanTextureArray::finish() {
    if (!dev_ || image_ == VK_NULL_HANDLE) return false;
    if (sealed_) return ready_;
    sealed_ = true;

    if (!transition(VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
                    VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL))
        return false;

    VkDescriptorImageInfo ii{};
    ii.sampler = sampler_;
    ii.imageView = view_;
    ii.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    VkWriteDescriptorSet w{};
    w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    w.dstSet = set_;
    w.dstBinding = 0;
    w.descriptorCount = 1;
    w.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
    w.pImageInfo = &ii;
    vkUpdateDescriptorSets(dev_->device, 1, &w, 0, nullptr);

    // 5.3 MiB that would otherwise stay resident for the life of the process for
    // no reader at all.
    if (stagingMap_) {
        vkUnmapMemory(dev_->device, stagingMem_);
        stagingMap_ = nullptr;
    }
    if (staging_) {
        vkDestroyBuffer(dev_->device, staging_, nullptr);
        staging_ = VK_NULL_HANDLE;
    }
    if (stagingMem_) {
        vkFreeMemory(dev_->device, stagingMem_, nullptr);
        stagingMem_ = VK_NULL_HANDLE;
    }
    ready_ = true;
    return true;
}

void VulkanTextureArray::destroy() {
    if (!dev_) return;
    if (stagingMap_) { vkUnmapMemory(dev_->device, stagingMem_); stagingMap_ = nullptr; }
    if (staging_) { vkDestroyBuffer(dev_->device, staging_, nullptr); staging_ = VK_NULL_HANDLE; }
    if (stagingMem_) { vkFreeMemory(dev_->device, stagingMem_, nullptr); stagingMem_ = VK_NULL_HANDLE; }
    if (cmdPool_) { vkDestroyCommandPool(dev_->device, cmdPool_, nullptr); cmdPool_ = VK_NULL_HANDLE; }
    // The pool owns the set; freeing the set separately would be redundant.
    if (pool_) { vkDestroyDescriptorPool(dev_->device, pool_, nullptr); pool_ = VK_NULL_HANDLE; set_ = VK_NULL_HANDLE; }
    if (setLayout_) { vkDestroyDescriptorSetLayout(dev_->device, setLayout_, nullptr); setLayout_ = VK_NULL_HANDLE; }
    if (sampler_) { vkDestroySampler(dev_->device, sampler_, nullptr); sampler_ = VK_NULL_HANDLE; }
    if (view_) { vkDestroyImageView(dev_->device, view_, nullptr); view_ = VK_NULL_HANDLE; }
    if (image_) { vkDestroyImage(dev_->device, image_, nullptr); image_ = VK_NULL_HANDLE; }
    if (memory_) { vkFreeMemory(dev_->device, memory_, nullptr); memory_ = VK_NULL_HANDLE; }
    ready_ = false;
    sealed_ = false;
    loaded_ = 0;
}

} // namespace giga::gpu
