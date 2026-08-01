// GPU mirror of the active floor's voxel truth — stage 1 of the raymarch
// migration (the DDA pass of stage 2 is its first consumer; the GPU field
// engine of [performance.md] §The compute split is the second).
//
// Four device-local SSBOs hold, verbatim, what the CPU sim owns:
//
//   masks     kMacroCells x 64 B    SubMask words. Shaders view them as
//                                   uint[16] per cell — NO shaderInt64, because
//                                   MoltenVK/Metal has no 64-bit integer type.
//   types     kMacroCells x 2 B     CellType — the per-cell uniform material.
//   pageIdx   kMacroCells x 4 B     "sub_material" page slot, kNoPage = uniform.
//   pagePool  kPageCap    x 1 KiB   the SubField page pool, slot-for-slot the
//                                   CPU pool ([world/subfield.h]) so no
//                                   remapping logic exists to go wrong.
//
// ONE-WAY FLOW, sim -> GPU ([render.md]): the mirror never writes back, and the
// CPU grid stays the single source of truth for every gameplay question. It is
// kept fresh by exactly the seams the sim already publishes:
//
//   * wholesale (floor build / arrival / F9 / teleport)  -> upload_all()
//   * carve ([world/destruct.h] CarveResult::dirtyCells) -> mark_dirty()
//   * doors  ([game/door.h] DoorSet::dirtyCells)         -> mark_dirty()
//   * future mutators (the cellular sandpile, when the app wires it) owe the
//     same debt the carve table in [destruct.md] already states.
//
// Dirty cells are re-uploaded as byte ranges (64 B mask + 2 B type + 4 B page
// index + 1 KiB page when mixed) through a per-frame staging window — so the
// render-side cost of destruction is O(dirtied cells), never a rescan. That is
// the entire point of the migration: mass destruction by hundreds of NPCs is
// bandwidth (64 B/cell), not a 2.1 M-cell rebuild.
//
// Overflow is honest ("no silent caps"): dirty cells that do not fit this
// frame's staging window stay queued for the next frame, and a page pool past
// kPageCap logs loudly while the affected cells fall back to their uniform
// CellType on the GPU side only.
#pragma once

#include <vulkan/vulkan.h>

#include <cstddef>
#include <cstdint>
#include <vector>

#include "render/vk_buffer.h"
#include "render/vk_common.h" // kMaxFramesInFlight
#include "world/types.h"      // kMacroCells, kSubVoxels

namespace giga {
class World;
}

namespace giga::gpu {

struct VulkanDevice;

class VoxelMirror {
public:
    // Mirrors SubField<T>::kNoPage — asserted equal in the .cpp.
    static constexpr std::uint32_t kNoPage = 0xFFFFFFFFu;
    // Page-pool capacity, slots. 64 MiB; typical floors hold tens of MB of
    // mixed cells ([destruct.md]), so this is generous, and running past it is
    // loud, never silent.
    static constexpr std::uint32_t kPageCap = 65536u;

    static constexpr std::size_t kMaskBytesPerCell = 64;                    // 8x uint64
    static constexpr std::size_t kPageBytes = kSubVoxels * sizeof(std::uint16_t);
    static constexpr std::size_t kMasksBytes = kMacroCells * kMaskBytesPerCell;
    static constexpr std::size_t kTypesBytes = kMacroCells * sizeof(std::uint16_t);
    static constexpr std::size_t kPageIdxBytes = kMacroCells * sizeof(std::uint32_t);
    static constexpr std::size_t kPoolBytes = kPageCap * kPageBytes;
    // Per-cell classification byte (0 empty / 1 full / 2 partial) — the
    // raymarcher's macro-skip: air costs one byte, full walls hit with no mask
    // read, only boundary cells pay the sub-DDA.
    static constexpr std::size_t kClassBytes = kMacroCells;
    // The "fluid" macro field, mirrored whole (8 MiB) whenever a fluid step
    // marks it — the marcher tints hit cells from it, which is what retired
    // the last regular invalidate() storm (31/s in maze mode).
    static constexpr std::size_t kFluidBytes = kMacroCells * sizeof(float);
    // Per-frame dirty staging window: cells plus one whole fluid image fit
    // together; the queue carries any remainder to the next frame.
    static constexpr std::size_t kStagingBytes = 12u * 1024u * 1024u;

    bool init(VulkanDevice& dev);
    void destroy();
    bool ready() const { return ready_; }

    // Full snapshot of `world` into all four buffers. Own one-shot submit +
    // fence wait — a load-screen moment (floor build/arrival/load), never a
    // per-frame call. Clears the dirty queue: everything is fresh.
    bool upload_all(const World& world);

    // Queue macro cells (flat macro_index values) for the next flush(). Dedup'd
    // against a bitset, so feeding the same cell twice a frame costs nothing.
    void mark_dirty(const std::uint32_t* cells, std::size_t n);

    // The "fluid" field changed (a fluid step ran): re-mirror it whole at the
    // next flush(). A flag, not a cell list — the field moves globally.
    void mark_fluid_dirty() { fluidDirty_ = true; }

    // Record this frame's dirty-cell copies into `cmd` — call OUTSIDE the render
    // pass, before begin_pass. Reads the fresh bytes from `world`; consumed
    // cells leave the queue, overflow stays queued.
    void flush(VkCommandBuffer cmd, std::uint32_t frameIndex, const World& world);

    // --mirror-verify: read every buffer back and memcmp against the CPU truth.
    // Queue-idles on a fence per buffer — a diagnostic, never a frame-path call.
    // Returns true when all four buffers match bit-exactly.
    bool verify(const World& world);

    // HUD stats.
    std::uint32_t last_flush_cells() const { return lastFlushCells_; }
    std::uint32_t last_flush_bytes() const { return lastFlushBytes_; }
    std::uint32_t dirty_backlog() const { return static_cast<std::uint32_t>(dirty_.size()); }
    std::uint32_t pages_in_pool() const { return poolPages_; }
    bool page_overflowed() const { return pageOverflow_; }

    // Buffer handles for the raymarch pass's descriptor set.
    VkBuffer masks_buffer() const { return masks_.buffer; }
    VkBuffer types_buffer() const { return types_.buffer; }
    VkBuffer page_index_buffer() const { return pageIdx_.buffer; }
    VkBuffer page_pool_buffer() const { return pagePool_.buffer; }
    VkBuffer class_buffer() const { return classes_.buffer; }
    VkBuffer fluid_buffer() const { return fluid_.buffer; }

private:
    bool upload_via_staging(VulkanBuffer& dst, const void* src, std::size_t bytes);
    bool readback_compare(VulkanBuffer& src, const void* expected,
                          std::size_t bytes, const char* label,
                          std::uint32_t* mismatches);
    bool one_shot_begin();
    bool one_shot_submit();

    VulkanDevice* dev_ = nullptr;
    bool ready_ = false;

    VulkanBuffer masks_;
    VulkanBuffer types_;
    VulkanBuffer pageIdx_;
    VulkanBuffer pagePool_;
    VulkanBuffer classes_;
    VulkanBuffer fluid_;
    VulkanBuffer staging_[kMaxFramesInFlight];

    VkCommandPool oneShotPool_ = VK_NULL_HANDLE;
    VkCommandBuffer oneShotCmd_ = VK_NULL_HANDLE;
    VkFence oneShotFence_ = VK_NULL_HANDLE;

    // Dirty queue: dedup bitset (kMacroCells bits = 256 KiB) + the cell list.
    std::vector<std::uint64_t> dirtyBits_;
    std::vector<std::uint32_t> dirty_;

    // Reused per-flush region scratch (no per-frame allocation after warmup).
    std::vector<VkBufferCopy> maskCopies_;
    std::vector<VkBufferCopy> typeCopies_;
    std::vector<VkBufferCopy> idxCopies_;
    std::vector<VkBufferCopy> poolCopies_;
    std::vector<VkBufferCopy> classCopies_;
    // Reused expectation scratch for upload_all/verify's pageIdx image.
    std::vector<std::uint32_t> idxScratch_;
    std::vector<std::uint8_t> classScratch_;
    std::vector<float> fluidZeros_;
    bool fluidDirty_ = false;

    std::uint32_t lastFlushCells_ = 0;
    std::uint32_t lastFlushBytes_ = 0;
    std::uint32_t poolPages_ = 0;
    std::uint32_t overflowEvents_ = 0;
    bool pageOverflow_ = false;
};

} // namespace giga::gpu
