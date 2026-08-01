#include "render/voxel_mirror.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "render/vk_device.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/field.h"    // the mirrored "fluid" macro field
#include "world/macro_grid.h"
#include "world/subfield.h"
#include "world/world.h"

namespace giga::gpu {

namespace {

// The GPU-side layout is a byte-exact memcpy of the CPU structures; these are
// the assumptions that make that true.
static_assert(sizeof(SubMask) == VoxelMirror::kMaskBytesPerCell,
              "SubMask must stay 8x uint64 = 64 B; the mirror copies it raw");
static_assert(sizeof(CellType) == sizeof(std::uint16_t),
              "CellType must stay uint16; the types buffer copies it raw");
static_assert(SubField<CellType>::kNoPage == VoxelMirror::kNoPage,
              "the mirror's kNoPage sentinel must match SubField's");

// One barrier shape for every upload path: transfers done, shaders may read.
// Nothing reads the mirror yet (stage 2 does), but emitting the correct
// barrier now means stage 2 is a pure shader drop-in.
void barrier_transfer_to_shader(VkCommandBuffer cmd) {
    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                         VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT |
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &mb, 0, nullptr, 0, nullptr);
}

// 0 empty / 1 full / 2 partial — the raymarcher's macro skip byte.
std::uint8_t classify(const SubMask& m) {
    if (m.empty()) return 0;
    return m.full() ? 1 : 2;
}

} // namespace

bool VoxelMirror::init(VulkanDevice& dev) {
    dev_ = &dev;

    const VkBufferUsageFlags usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                                     VK_BUFFER_USAGE_TRANSFER_DST_BIT |
                                     VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    if (!masks_.create_device_local_empty(dev, kMasksBytes, usage,
                                          "voxel-mirror masks"))
        return false;
    if (!types_.create_device_local_empty(dev, kTypesBytes, usage,
                                          "voxel-mirror types"))
        return false;
    if (!pageIdx_.create_device_local_empty(dev, kPageIdxBytes, usage,
                                            "voxel-mirror page-index"))
        return false;
    if (!pagePool_.create_device_local_empty(dev, kPoolBytes, usage,
                                             "voxel-mirror page-pool"))
        return false;
    if (!classes_.create_device_local_empty(dev, kClassBytes, usage,
                                            "voxel-mirror class"))
        return false;
    if (!fluid_.create_device_local_empty(dev, kFluidBytes, usage,
                                          "voxel-mirror fluid"))
        return false;
    for (int i = 0; i < kMaxFramesInFlight; ++i)
        if (!staging_[i].create_host_visible(dev, kStagingBytes,
                                             VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                                             "voxel-mirror staging"))
            return false;

    // The masks SSBO sits exactly at the spec-guaranteed minimum
    // maxStorageBufferRange (2^27). Desktop drivers report far more; if one
    // ever does not, stage 2 must bind the masks as two half-range buffers.
    if (dev.props.limits.maxStorageBufferRange < kMasksBytes)
        std::fprintf(stderr,
                     "[mirror] maxStorageBufferRange %u < masks %zu — the "
                     "raymarch pass must split the masks binding on this device\n",
                     dev.props.limits.maxStorageBufferRange, kMasksBytes);

    VkCommandPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pi.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT |
               VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pi.queueFamilyIndex = dev.families.graphics;
    VK_TRY(vkCreateCommandPool(dev.device, &pi, nullptr, &oneShotPool_));

    VkCommandBufferAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    ai.commandPool = oneShotPool_;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VK_TRY(vkAllocateCommandBuffers(dev.device, &ai, &oneShotCmd_));

    VkFenceCreateInfo fi{};
    fi.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    VK_TRY(vkCreateFence(dev.device, &fi, nullptr, &oneShotFence_));

    dirtyBits_.assign((kMacroCells + 63u) / 64u, 0u);
    dirty_.reserve(4096);
    ready_ = true;
    return true;
}

void VoxelMirror::destroy() {
    if (!dev_) return;
    if (oneShotFence_) vkDestroyFence(dev_->device, oneShotFence_, nullptr);
    if (oneShotPool_) vkDestroyCommandPool(dev_->device, oneShotPool_, nullptr);
    oneShotFence_ = VK_NULL_HANDLE;
    oneShotPool_ = VK_NULL_HANDLE;
    oneShotCmd_ = VK_NULL_HANDLE;
    for (int i = 0; i < kMaxFramesInFlight; ++i) staging_[i].destroy(*dev_);
    fluid_.destroy(*dev_);
    classes_.destroy(*dev_);
    pagePool_.destroy(*dev_);
    pageIdx_.destroy(*dev_);
    types_.destroy(*dev_);
    masks_.destroy(*dev_);
    ready_ = false;
    dev_ = nullptr;
}

bool VoxelMirror::one_shot_begin() {
    VK_TRY(vkResetCommandBuffer(oneShotCmd_, 0));
    VkCommandBufferBeginInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    VK_TRY(vkBeginCommandBuffer(oneShotCmd_, &bi));
    return true;
}

bool VoxelMirror::one_shot_submit() {
    VK_TRY(vkEndCommandBuffer(oneShotCmd_));
    VK_TRY(vkResetFences(dev_->device, 1, &oneShotFence_));
    VkSubmitInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    si.commandBufferCount = 1;
    si.pCommandBuffers = &oneShotCmd_;
    VK_TRY(vkQueueSubmit(dev_->graphicsQueue, 1, &si, oneShotFence_));
    VK_TRY(vkWaitForFences(dev_->device, 1, &oneShotFence_, VK_TRUE,
                           UINT64_MAX));
    return true;
}

bool VoxelMirror::upload_via_staging(VulkanBuffer& dst, const void* src,
                                     std::size_t bytes) {
    if (bytes == 0) return true;
    VulkanBuffer st;
    if (!st.create_host_visible(*dev_, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                                nullptr))
        return false;
    std::memcpy(st.mapped, src, bytes);
    bool ok = one_shot_begin();
    if (ok) {
        VkBufferCopy region{0, 0, bytes};
        vkCmdCopyBuffer(oneShotCmd_, st.buffer, dst.buffer, 1, &region);
        barrier_transfer_to_shader(oneShotCmd_);
        ok = one_shot_submit();
    }
    st.destroy(*dev_);
    return ok;
}

bool VoxelMirror::upload_all(const World& world) {
    if (!ready_) return false;

    // Everything becomes fresh; the queue and its dedup bits reset with it.
    dirty_.clear();
    std::fill(dirtyBits_.begin(), dirtyBits_.end(), 0u);

    const MacroGrid& g = world.grid();
    const SubField<CellType>* sub =
        world.subfields().find<CellType>(kSubMaterialName);

    bool ok = upload_via_staging(masks_, g.masks().data(), kMasksBytes);
    ok = ok && upload_via_staging(types_, g.types().data(), kTypesBytes);

    classScratch_.resize(kMacroCells);
    for (std::size_t i = 0; i < kMacroCells; ++i)
        classScratch_[i] = classify(g.masks()[i]);
    ok = ok && upload_via_staging(classes_, classScratch_.data(), kClassBytes);

    // Fluid: the field's bytes when the layer has one, zeros otherwise — a
    // recycled World must not tint the new floor with the old floor's puddles.
    const Field<float>* fl = world.fields().find<float>("fluid");
    if (fl) {
        ok = ok && upload_via_staging(fluid_, fl->data().data(), kFluidBytes);
    } else {
        fluidZeros_.assign(kMacroCells, 0.0f);
        ok = ok && upload_via_staging(fluid_, fluidZeros_.data(), kFluidBytes);
    }
    fluidDirty_ = false;

    // Page indices: verbatim CPU page table, with out-of-capacity slots
    // clamped to kNoPage so the GPU never dereferences past its pool.
    const std::uint32_t pageCount =
        sub ? static_cast<std::uint32_t>(sub->page_count()) : 0u;
    poolPages_ = pageCount < kPageCap ? pageCount : kPageCap;
    pageOverflow_ = pageCount > kPageCap;
    if (pageOverflow_)
        std::fprintf(stderr,
                     "[mirror] page pool OVERFLOW: %u CPU pages > %u GPU slots; "
                     "cells past the cap render their uniform CellType\n",
                     pageCount, kPageCap);
    idxScratch_.assign(kMacroCells, kNoPage);
    if (sub) {
        const std::uint32_t* tab = sub->page_table();
        for (std::size_t i = 0; i < kMacroCells; ++i)
            idxScratch_[i] = tab[i] < poolPages_ ? tab[i] : kNoPage;
    }
    ok = ok && upload_via_staging(pageIdx_, idxScratch_.data(), kPageIdxBytes);
    if (sub && poolPages_ > 0)
        ok = ok && upload_via_staging(
                       pagePool_, sub->pages_data(),
                       static_cast<std::size_t>(poolPages_) * kPageBytes);
    return ok;
}

void VoxelMirror::mark_dirty(const std::uint32_t* cells, std::size_t n) {
    if (!ready_) return;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        if (ci >= kMacroCells) continue;
        std::uint64_t& w = dirtyBits_[ci >> 6];
        const std::uint64_t bit = std::uint64_t{1} << (ci & 63u);
        if (w & bit) continue;
        w |= bit;
        dirty_.push_back(ci);
    }
}

void VoxelMirror::flush(VkCommandBuffer cmd, std::uint32_t frameIndex,
                        const World& world) {
    lastFlushCells_ = 0;
    lastFlushBytes_ = 0;
    if (!ready_) return;
    if (dirty_.empty() && !fluidDirty_) return;

    // Sorted, adjacent dirty cells collapse into single copy regions — carves
    // are spatially local, so runs are the common case, and the consumed
    // prefix below is then well-defined.
    std::sort(dirty_.begin(), dirty_.end());

    const MacroGrid& g = world.grid();
    const SubField<CellType>* sub =
        world.subfields().find<CellType>(kSubMaterialName);
    const std::uint32_t* pageTab = sub ? sub->page_table() : nullptr;
    const CellType* poolData = sub ? sub->pages_data() : nullptr;
    const std::uint32_t poolCount =
        sub ? (sub->page_count() < kPageCap
                   ? static_cast<std::uint32_t>(sub->page_count())
                   : kPageCap)
            : 0u;
    poolPages_ = poolCount;

    // How many sorted cells fit this frame's staging window.
    std::size_t take = 0;
    std::size_t need = 0;
    while (take < dirty_.size()) {
        const std::uint32_t ci = dirty_[take];
        std::size_t c = kMaskBytesPerCell + sizeof(CellType) +
                        sizeof(std::uint32_t) + 1 /* class byte */;
        if (pageTab && pageTab[ci] < poolCount) c += kPageBytes;
        if (need + c > kStagingBytes) break;
        need += c;
        ++take;
    }

    VulkanBuffer& st = staging_[frameIndex % kMaxFramesInFlight];
    std::uint8_t* base = static_cast<std::uint8_t*>(st.mapped);
    std::size_t off = 0;
    maskCopies_.clear();
    typeCopies_.clear();
    idxCopies_.clear();
    poolCopies_.clear();
    classCopies_.clear();

    std::size_t i = 0;
    while (i < take) {
        std::size_t j = i + 1;
        while (j < take && dirty_[j] == dirty_[j - 1] + 1u) ++j;
        const std::uint32_t c0 = dirty_[i];
        const std::uint32_t len = static_cast<std::uint32_t>(j - i);

        std::size_t bytes = static_cast<std::size_t>(len) * kMaskBytesPerCell;
        std::memcpy(base + off, g.masks().data() + c0, bytes);
        maskCopies_.push_back(
            {off, static_cast<VkDeviceSize>(c0) * kMaskBytesPerCell, bytes});
        off += bytes;

        bytes = static_cast<std::size_t>(len) * sizeof(CellType);
        std::memcpy(base + off, g.types().data() + c0, bytes);
        typeCopies_.push_back(
            {off, static_cast<VkDeviceSize>(c0) * sizeof(CellType), bytes});
        off += bytes;

        for (std::uint32_t k = 0; k < len; ++k)
            base[off + k] = classify(g.masks()[c0 + k]);
        classCopies_.push_back({off, static_cast<VkDeviceSize>(c0),
                                static_cast<VkDeviceSize>(len)});
        off += len;

        bytes = static_cast<std::size_t>(len) * sizeof(std::uint32_t);
        std::uint32_t* dst = reinterpret_cast<std::uint32_t*>(base + off);
        for (std::uint32_t k = 0; k < len; ++k) {
            const std::uint32_t slot = pageTab ? pageTab[c0 + k] : kNoPage;
            dst[k] = slot < poolCount ? slot : kNoPage;
        }
        idxCopies_.push_back(
            {off, static_cast<VkDeviceSize>(c0) * sizeof(std::uint32_t), bytes});
        off += bytes;

        if (poolData)
            for (std::uint32_t k = 0; k < len; ++k) {
                const std::uint32_t slot = pageTab[c0 + k];
                if (slot >= poolCount) continue;
                std::memcpy(base + off,
                            poolData + static_cast<std::size_t>(slot) * kSubVoxels,
                            kPageBytes);
                poolCopies_.push_back(
                    {off, static_cast<VkDeviceSize>(slot) * kPageBytes,
                     kPageBytes});
                off += kPageBytes;
            }
        i = j;
    }

    if (!maskCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, masks_.buffer,
                        static_cast<std::uint32_t>(maskCopies_.size()),
                        maskCopies_.data());    if (!typeCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, types_.buffer,
                        static_cast<std::uint32_t>(typeCopies_.size()),
                        typeCopies_.data());
    if (!idxCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, pageIdx_.buffer,
                        static_cast<std::uint32_t>(idxCopies_.size()),
                        idxCopies_.data());
    if (!classCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, classes_.buffer,
                        static_cast<std::uint32_t>(classCopies_.size()),
                        classCopies_.data());
    if (!poolCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, pagePool_.buffer,
                        static_cast<std::uint32_t>(poolCopies_.size()),
                        poolCopies_.data());

    // The fluid image rides the same window, whole, after the cells; if this
    // frame's cells left no room it simply waits one more frame.
    if (fluidDirty_ && off + kFluidBytes <= kStagingBytes) {
        const Field<float>* fl = world.fields().find<float>("fluid");
        if (fl) {
            std::memcpy(base + off, fl->data().data(), kFluidBytes);
            VkBufferCopy region{off, 0, kFluidBytes};
            vkCmdCopyBuffer(cmd, st.buffer, fluid_.buffer, 1, &region);
            off += kFluidBytes;
        }
        fluidDirty_ = false;
    }
    barrier_transfer_to_shader(cmd);

    for (std::size_t k = 0; k < take; ++k) {
        const std::uint32_t ci = dirty_[k];
        dirtyBits_[ci >> 6] &= ~(std::uint64_t{1} << (ci & 63u));
    }
    dirty_.erase(dirty_.begin(),
                 dirty_.begin() + static_cast<std::ptrdiff_t>(take));
    if (!dirty_.empty() && (overflowEvents_++ % 64u) == 0u)
        std::fprintf(stderr,
                     "[mirror] staging window full: %zu cells carried to the "
                     "next frame (uploaded %zu, %zu KiB)\n",
                     dirty_.size(), take, off / 1024u);

    lastFlushCells_ = static_cast<std::uint32_t>(take);
    lastFlushBytes_ = static_cast<std::uint32_t>(off);
}

bool VoxelMirror::readback_compare(VulkanBuffer& src, const void* expected,
                                   std::size_t bytes, const char* label,
                                   std::uint32_t* mismatches) {
    *mismatches = 0;
    if (bytes == 0) return true;
    VulkanBuffer st;
    if (!st.create_host_visible(*dev_, bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                                nullptr))
        return false;
    bool ok = one_shot_begin();
    if (ok) {
        // Order against everything previously submitted (frame flushes), then
        // copy device -> host.
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(oneShotCmd_, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                             VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &mb, 0,
                             nullptr, 0, nullptr);
        VkBufferCopy region{0, 0, bytes};
        vkCmdCopyBuffer(oneShotCmd_, src.buffer, st.buffer, 1, &region);
        ok = one_shot_submit();
    }
    if (ok && std::memcmp(st.mapped, expected, bytes) != 0) {
        const std::uint8_t* a = static_cast<const std::uint8_t*>(st.mapped);
        const std::uint8_t* b = static_cast<const std::uint8_t*>(expected);
        std::size_t firstBad = bytes;
        std::uint32_t bad = 0;
        for (std::size_t i = 0; i < bytes; ++i)
            if (a[i] != b[i]) {
                if (firstBad == bytes) firstBad = i;
                ++bad;
            }
        *mismatches = bad;
        std::fprintf(stderr,
                     "[mirror] VERIFY FAIL %s: %u mismatching bytes of %zu, "
                     "first at offset %zu\n",
                     label, bad, bytes, firstBad);
    }
    st.destroy(*dev_);
    return ok && *mismatches == 0;
}

bool VoxelMirror::verify(const World& world) {
    if (!ready_) return false;
    const MacroGrid& g = world.grid();
    const SubField<CellType>* sub =
        world.subfields().find<CellType>(kSubMaterialName);
    const std::uint32_t poolCount =
        sub ? (sub->page_count() < kPageCap
                   ? static_cast<std::uint32_t>(sub->page_count())
                   : kPageCap)
            : 0u;

    idxScratch_.assign(kMacroCells, kNoPage);
    if (sub) {
        const std::uint32_t* tab = sub->page_table();
        for (std::size_t i = 0; i < kMacroCells; ++i)
            idxScratch_[i] = tab[i] < poolCount ? tab[i] : kNoPage;
    }

    std::uint32_t m0 = 0, m1 = 0, m2 = 0, m3 = 0, m4 = 0;
    bool ok = readback_compare(masks_, g.masks().data(), kMasksBytes, "masks", &m0);
    ok = readback_compare(types_, g.types().data(), kTypesBytes, "types", &m1) && ok;
    ok = readback_compare(pageIdx_, idxScratch_.data(), kPageIdxBytes,
                          "page-index", &m2) && ok;
    classScratch_.resize(kMacroCells);
    for (std::size_t i = 0; i < kMacroCells; ++i)
        classScratch_[i] = classify(g.masks()[i]);
    ok = readback_compare(classes_, classScratch_.data(), kClassBytes, "class",
                          &m4) && ok;
    if (sub && poolCount > 0)
        ok = readback_compare(pagePool_, sub->pages_data(),
                              static_cast<std::size_t>(poolCount) * kPageBytes,
                              "page-pool", &m3) && ok;
    std::fprintf(stderr,
                 "[mirror] verify %s: %u dirty queued | masks %u types %u "
                 "pageIdx %u pool %u class %u mismatching bytes\n",
                 ok ? "OK" : "FAIL", dirty_backlog(), m0, m1, m2, m3, m4);
    return ok;
}

} // namespace giga::gpu
