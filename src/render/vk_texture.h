// A 2D ARRAY image of block-compressed sRGB albedo maps, decoded from the
// KTX2 / UASTC+zstd pack in data/textures.
//
// WHY THIS FILE EXISTS. Until it did, this engine had no image decoder at all —
// shaders/cube.frag SAID so in its own comment ("Generated, not sampled: there is
// no image decoder in the tree") — so the photographs committed under
// data/textures were 25 MiB of bytes that nothing read. That is the repository's
// recurring failure shape: a real asset with no system behind it.
//
// WHAT THE CONTAINER FORCES, all three verified against the committed bytes
// (data/textures/README.md is the contract; the figures below were re-measured
// from the six files with a header parser, not copied):
//
//   1. THERE IS NO VkFormat IN THE FILE. The header carries
//      `vkFormat = VK_FORMAT_UNDEFINED (0)`, DFD colorModel 166 (UASTC),
//      transferFunction 2 (sRGB). The GPU format is a decision this loader makes.
//   2. THE LEVEL BYTES ARE A ZSTD STREAM OF UASTC BLOCKS, not GPU blocks:
//      `supercompressionScheme = 2`. They must be inflated AND transcoded.
//      Uploading them verbatim yields noise that still looks like a texture from
//      a distance, which is why this path goes through libktx and hand-rolling it
//      is banned.
//   3. LEVEL OFFSETS ARE NOT 16-BYTE ALIGNED. mipPadding does not apply to a
//      supercompressed file, so the levels are packed tight — measured on
//      factory_wall.ktx2, offset mod 16 per level index entry: 11, 4, 6, 0, 7, 7,
//      6, 12, 3, 10, 1, 8. A `VkBufferImageCopy.bufferOffset` for a compressed
//      format must be a multiple of the 16-byte block, so this loader never
//      copies from libktx's own offsets: it re-packs each level into the staging
//      buffer at an offset it aligns itself (see upload_levels()).
//
// The transcode is SIZE-PRESERVING — UASTC LDR 4x4 and both targets below are 16
// bytes per 4x4 block — so the staging buffer is sized from block arithmetic
// before a single byte is inflated: 4,194,304 B for level 0 and 5,592,432 B for
// the whole 12-level chain of a 2048x2048 map. chain_bytes() reproduces both.
//
// TARGET FORMAT IS CHOSEN FROM THE DEVICE, not hardcoded, and that is not
// gold-plating: Apple-silicon GPUs do not support BC at all, so a BC7-only loader
// would fail on the owner's primary (macOS/MoltenVK) host while passing here.
// Preference order is BC7_SRGB then ASTC_4x4_SRGB; per data/textures/README.md
// ASTC costs 0 dB (UASTC is an ASTC 4x4 subset, so it is a re-wrap) where BC7
// costs a measured mean -1.84 dB, so the fallback is the higher-quality path and
// only the desktop-universal one is first.
//
// sRGB IS THE WHOLE COLOUR-SPACE ARGUMENT AND IT IS DELIBERATE. Both targets are
// the _SRGB variant, so the sampler linearises each texel in hardware BEFORE
// filtering. A shader sampling this must therefore NOT apply cube.frag's
// pow(vColor, 2.2) to the result — doing it twice darkens mid-grey by ~2x. The
// _UNORM variants would hold identical bits and move that conversion into the
// shader, where filtering then happens in the wrong space; that is why they are
// not used.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

namespace giga::gpu {

struct VulkanDevice;

class VulkanTextureArray {
public:
    // Create the array image, view, sampler and a one-binding descriptor set,
    // and put every layer in TRANSFER_DST_OPTIMAL ready for load_layer().
    //
    // `layers` is indexed directly by the caller's own id (the world pass passes
    // kMatCount and uses the material id as the layer), so slots with no file
    // are allocated and never sampled. Returns false if the device can sample
    // neither BC7 nor ASTC 4x4 with linear filtering, if the array shape exceeds
    // the device's image limits, or if any Vulkan call fails — each with the
    // reason on stderr.
    bool init(VulkanDevice& dev, std::uint32_t layers, std::uint32_t width,
              std::uint32_t height, std::uint32_t mips, bool unorm = false);

    // Decode `path` and upload its complete mip chain into `layer`.
    //
    // EVERY rejection is loud and returns false: a missing file, a libktx error,
    // a transcode failure, a dimension/level-count mismatch against init()'s
    // shape, a post-transcode format that is not the one the image was created
    // with, or a level whose size is not its exact block count. Nothing is
    // substituted for a file that did not load — no magenta, no flat grey, no
    // neighbouring material's photograph. The caller drops the layer from its
    // "textured" set and that material keeps rendering exactly as it did before
    // this file existed.
    bool load_layer(std::uint32_t layer, const char* path);

    // Move every layer to SHADER_READ_ONLY_OPTIMAL, point the descriptor set at
    // the view, and release the staging buffer. Call once, after the last
    // load_layer(); load_layer() must not be called afterwards.
    bool finish();

    void destroy();

    // True once init() and finish() have both succeeded, i.e. the descriptor set
    // is written and safe to bind. A pass must fall back to a pipeline with no
    // sampler when this is false.
    bool ready() const { return ready_; }

    VkImageView view() const { return view_; }
    VkSampler sampler() const { return sampler_; }
    VkDescriptorSetLayout set_layout() const { return setLayout_; }
    VkDescriptorSet descriptor_set() const { return set_; }
    VkFormat format() const { return format_; }
    const char* format_name() const;

    std::uint32_t layers_loaded() const { return loaded_; }
    // Wall-clock split of the load, printed by the owner rather than guessed at:
    // decode is inflate+transcode on the CPU (the dominant term — the CLI that
    // calls the same library measures 247-476 ms per 2K map), upload is the
    // staging copy plus the queue wait.
    double decode_ms() const { return decodeMs_; }
    double upload_ms() const { return uploadMs_; }
    // Bytes of device memory the array actually cost, as reported by
    // VkMemoryRequirements — not the block arithmetic, which ignores tiling.
    VkDeviceSize device_bytes() const { return deviceBytes_; }

private:
    VulkanDevice* dev_ = nullptr;

    VkImage image_ = VK_NULL_HANDLE;
    VkDeviceMemory memory_ = VK_NULL_HANDLE;
    VkImageView view_ = VK_NULL_HANDLE;
    VkSampler sampler_ = VK_NULL_HANDLE;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;

    VkCommandPool cmdPool_ = VK_NULL_HANDLE;

    // Staging is created once at init() and reused by every layer: one 5.3 MiB
    // host-visible buffer, not one per file. Freed by finish(), because after the
    // last upload it is 5.3 MiB of permanently-resident nothing.
    VkBuffer staging_ = VK_NULL_HANDLE;
    VkDeviceMemory stagingMem_ = VK_NULL_HANDLE;
    void* stagingMap_ = nullptr;
    VkDeviceSize stagingBytes_ = 0;

    VkFormat format_ = VK_FORMAT_UNDEFINED;
    // ktx_transcode_fmt_e, held as an int so ktx.h stays out of this header (the
    // core-purity rule is about giga_core, but a decoder header has no business
    // in a Vulkan interface either).
    int target_ = 0;
    bool unorm_ = false;

    std::uint32_t layers_ = 0;
    std::uint32_t width_ = 0;
    std::uint32_t height_ = 0;
    std::uint32_t mips_ = 0;
    std::uint32_t loaded_ = 0;
    VkDeviceSize deviceBytes_ = 0;
    double decodeMs_ = 0.0;
    double uploadMs_ = 0.0;

    bool ready_ = false;
    bool sealed_ = false;

    bool choose_format();
    bool create_image();
    bool create_view_and_sampler();
    bool create_descriptor();
    bool create_staging();
    // UNDEFINED -> TRANSFER_DST_OPTIMAL (init) and TRANSFER_DST_OPTIMAL ->
    // SHADER_READ_ONLY_OPTIMAL (finish), over every mip of every layer.
    bool transition(VkImageLayout from, VkImageLayout to);
    // Copy `mips_` regions out of the staging buffer into one array layer.
    bool copy_staged_levels(std::uint32_t layer, const VkDeviceSize* offsets);
    bool run_one_shot(VkCommandBuffer* out);
    bool submit_and_wait(VkCommandBuffer cmd);
};

// Total bytes of a complete 4x4-block mip chain, 16 bytes per block, each level
// padded up to a 16-byte boundary. Exposed because the caller may want to log or
// budget it before anything is created; for 2048x2048x12 it is 5,592,432, which
// is the figure data/textures/README.md measured out of the containers.
VkDeviceSize chain_bytes(std::uint32_t width, std::uint32_t height,
                         std::uint32_t mips);

} // namespace giga::gpu
