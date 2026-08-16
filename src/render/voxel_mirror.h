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
//   * any future grid mutator owes the same debt the carve table in
//     [destruct.md] already states. (The cellular sandpile module that used to
//     be named here was deleted 2026-08-10: 1492 lines, zero reachable.)
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
    // Page-pool capacity, slots. **768 MiB** at 1 KiB per page.
    //
    // MEASURED, not guessed (2026-08-06, floor 0, Release): the padic sandwich
    // gives almost every cell a floor material and a different ceiling material,
    // so the cell is genuinely non-uniform and earns a page. A pristine floor
    // holds **689,958** pages = 706 MB. The old cap of 65,536 (64 MiB) was
    // therefore oversubscribed **10.5x**, and the overflow was not academic:
    // `upload_all` clamped `poolPages_` to the cap and handed every cell past it
    // `kNoPage`, so **90.5% of the floor rendered as flat uniform CellType** —
    // all the sub-voxel carving the generator emitted, invisible. It printed
    // `[mirror] page pool OVERFLOW` on every single run and nobody read it.
    //
    // 786,432 slots = exactly 768 MiB, ~14% headroom over the measured need.
    // Affordable by contract: [performance.md] budgets the GPU as "effectively
    // unlimited - draw AND compute", and this host reports a 16 GiB heap.
    // Transient cost is higher than resident: `upload_via_staging` allocates a
    // staging buffer the size of the payload, so a full snapshot peaks at
    // ~706 MB device + ~706 MB host-visible before the staging buffer is freed.
    //
    // 690k pages is NOT a defect to design away — it is what the design costs. A
    // cell genuinely holds 8^3 material atoms, and the sandwich genuinely gives it
    // a floor of one material and a ceiling of another, so the page is honest. An
    // earlier revision of this comment proposed promoting common combinations
    // ("concrete floor + plaster ceiling") to their own CellType so the cell would
    // read uniform. That idea is WRONG and is recorded here so nobody revives it:
    // CellTypes are a finite vocabulary and sub-voxel combinations are not, so it
    // hardcodes an arbitrary subset of mixes and breaks the moment a surface chips
    // — which is the entire premise of a floor built from destructible atoms.
    //
    // The page COUNT is therefore correct and this cap simply has to cover it. What
    // was actually oversized was the ENCODING on disk, and that was fixed where it
    // belonged: the floor snapshot run-length-encodes pages now ([save.h] v2), 736
    // -> 125 MB and 6.6 -> 1.3 s, with the material model untouched.
    // 1048576 -> 4194304 (2026-08-17, решение владельца): 4 GiB пула — «не со
    // всем его же спорить»; кап больше не может переполниться ни при каком
    // контенте (превышает даже все-клетки-смешанные), цена — резидентные
    // 4 GiB на 16-GiB куче, что владелец счёл приемлемым. Громкий OVERFLOW-лог
    // остаётся на месте как исторический сторож формата.
    static constexpr std::uint32_t kPageCap = 4194304u;

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
    // The "stain" SubField ([world/stain.h]): same paged mirror as
    // sub_material. GPU pages are RGBA8 (512 x 4 B) so the shader indexes one
    // u32 per atom; the CPU's 3 B atoms are repacked during upload. Stains are
    // painted, never load-bulk, so the pool is smaller than sub_material's.
    // NOT covered by verify() yet — the repack has no CPU twin to memcmp.
    static constexpr std::uint32_t kStainPageCap = 16384u; // 32 MiB
    static constexpr std::size_t kStainPageBytes = kSubVoxels * 4;
    static constexpr std::size_t kStainIdxBytes = kMacroCells * sizeof(std::uint32_t);
    static constexpr std::size_t kStainPoolBytes = kStainPageCap * kStainPageBytes;
    // Per-frame dirty staging window: cells plus one whole fluid image fit
    // together; the queue carries any remainder to the next frame.
    static constexpr std::size_t kStagingBytes = 12u * 1024u * 1024u;

    bool init(VulkanDevice& dev);
    void destroy();
    bool ready() const { return ready_; }

    // Full snapshot of `world` into EVERY mirrored buffer (there are eight, not
    // the four this line said for as long as the mirror had four). Own one-shot submit +
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
    // Returns true when every mirrored buffer matches bit-exactly. `fluid_` was
    // missing from this comparison until 2026-08-06 — the same present-in-upload,
    // absent-from-verify split that [problems.md] section 7 blames for the white
    // pixels. Stain pages are still uncovered: their GPU form is a repack, so
    // there is no CPU twin to memcmp.
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
    VkBuffer stain_index_buffer() const { return stainIdx_.buffer; }
    VkBuffer stain_pool_buffer() const { return stainPool_.buffer; }

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
    VulkanBuffer stainIdx_;
    VulkanBuffer stainPool_;
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
    std::vector<VkBufferCopy> stainIdxCopies_;
    std::vector<VkBufferCopy> stainPoolCopies_;
    // Reused expectation scratch for upload_all/verify's pageIdx image.
    std::vector<std::uint32_t> idxScratch_;
    std::vector<std::uint8_t> classScratch_;
    std::vector<std::uint8_t> stainRepack_;
    std::vector<float> fluidZeros_;
    bool fluidDirty_ = false;

    std::uint32_t lastFlushCells_ = 0;
    std::uint32_t lastFlushBytes_ = 0;
    std::uint32_t poolPages_ = 0;
    std::uint32_t overflowEvents_ = 0;
    bool pageOverflow_ = false;
};

} // namespace giga::gpu
