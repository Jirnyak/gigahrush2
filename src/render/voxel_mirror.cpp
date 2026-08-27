#include "render/voxel_mirror.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "render/vk_device.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/macro_grid.h"
#include "world/material_props.h" // kMatFlow/kMatDiffusion — класс 3 «среды»
#include "world/stain.h"    // StainRGB — the paged stain mirror
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

// 0 empty / 1 full / 2 partial / 3 partial С МАТЕРИЕЙ СРЕД — the raymarcher's
// macro skip byte. Класс 3 (CANON S16, мост рендера): в клетке есть материя
// без бита маски, чья строка движется — material_is_medium(), одна выписка
// закона в [world/material_props.h]. Только такие клетки платят фетч
// страницы на пустых битах маски в DDA; обычный мир (0/1/2) стоит ровно как
// раньше. GPU-двойник закона — settle в [shaders/medium_sim.comp];
// разъедутся — verify() покраснеет.
std::uint8_t classify(const SubMask& m, CellType type, const CellType* page) {
    if (m.full()) return 1;
    if (page) {
        for (int i = 0; i < kSubVoxels; ++i) {
            const CellType mt = page[i];
            if (mt != 0 && !m.test(i) && material_is_medium(mt)) return 3;
        }
    } else if (m.empty() && material_is_medium(type)) {
        // Закон чтения безстраничной клетки (sub_material_at,
        // [world/destruct.cpp]): ТОЛЬКО пустая маска означает «вся клетка
        // своего типа» (вода после collapse). Частичная маска + тип-среда
        // (rubble-завал генератора) — НЕ материя в дырах: класс 3 без этого
        // гейта рождал полный куб «грязи» из ниоткуда.
        return 3;
    }
    return m.empty() ? 0 : 2;
}

// CPU stain atoms are 3 B; the GPU page holds one u32 per atom.
void repack_stain_page(const StainRGB* src, std::uint8_t* dst) {
    for (int i = 0; i < kSubVoxels; ++i) {
        dst[i * 4 + 0] = src[i].r;
        dst[i * 4 + 1] = src[i].g;
        dst[i * 4 + 2] = src[i].b;
        dst[i * 4 + 3] = 0;
    }
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
    if (!stainIdx_.create_device_local_empty(dev, kStainIdxBytes, usage,
                                             "voxel-mirror stain-index"))
        return false;
    if (!stainPool_.create_device_local_empty(dev, kStainPoolBytes, usage,
                                              "voxel-mirror stain-pool"))
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

    // Теневой сет для растровых пассов ([ddalight.md]): masks(0) + class(1),
    // фрагментный стейдж — giga_shadow телам/пропсам маршует ту же занятость,
    // что мир и физика. Один сет на всех потребителей; raymarch держит свой.
    {
        VkDescriptorSetLayoutBinding b[2]{};
        for (uint32_t i = 0; i < 2; ++i) {
            b[i].binding = i;
            b[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            b[i].descriptorCount = 1;
            b[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        }
        VkDescriptorSetLayoutCreateInfo li{};
        li.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        li.bindingCount = 2;
        li.pBindings = b;
        VK_TRY(vkCreateDescriptorSetLayout(dev.device, &li, nullptr,
                                           &shadowSetLayout_));

        VkDescriptorPoolSize ps{};
        ps.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        ps.descriptorCount = 2;
        VkDescriptorPoolCreateInfo pci{};
        pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        pci.maxSets = 1;
        pci.poolSizeCount = 1;
        pci.pPoolSizes = &ps;
        VK_TRY(vkCreateDescriptorPool(dev.device, &pci, nullptr, &shadowPool_));

        VkDescriptorSetAllocateInfo sai{};
        sai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        sai.descriptorPool = shadowPool_;
        sai.descriptorSetCount = 1;
        sai.pSetLayouts = &shadowSetLayout_;
        VK_TRY(vkAllocateDescriptorSets(dev.device, &sai, &shadowSet_));

        VkDescriptorBufferInfo bi[2]{};
        bi[0].buffer = masks_.buffer;
        bi[0].range = VK_WHOLE_SIZE;
        bi[1].buffer = classes_.buffer;
        bi[1].range = VK_WHOLE_SIZE;
        VkWriteDescriptorSet w[2]{};
        for (uint32_t i = 0; i < 2; ++i) {
            w[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            w[i].dstSet = shadowSet_;
            w[i].dstBinding = i;
            w[i].descriptorCount = 1;
            w[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            w[i].pBufferInfo = &bi[i];
        }
        vkUpdateDescriptorSets(dev.device, 2, w, 0, nullptr);
    }

    dirtyBits_.assign((kMacroCells + 63u) / 64u, 0u);
    dirty_.reserve(4096);
    markGen_.assign(kMacroCells, 0u);
    uploadGen_.assign(kMacroCells, 0u);
    ready_ = true;
    return true;
}

void VoxelMirror::destroy() {
    if (!dev_) return;
    if (shadowPool_) vkDestroyDescriptorPool(dev_->device, shadowPool_, nullptr);
    if (shadowSetLayout_)
        vkDestroyDescriptorSetLayout(dev_->device, shadowSetLayout_, nullptr);
    shadowPool_ = VK_NULL_HANDLE;
    shadowSetLayout_ = VK_NULL_HANDLE;
    shadowSet_ = VK_NULL_HANDLE;
    if (oneShotFence_) vkDestroyFence(dev_->device, oneShotFence_, nullptr);
    if (oneShotPool_) vkDestroyCommandPool(dev_->device, oneShotPool_, nullptr);
    oneShotFence_ = VK_NULL_HANDLE;
    oneShotPool_ = VK_NULL_HANDLE;
    oneShotCmd_ = VK_NULL_HANDLE;
    for (int i = 0; i < kMaxFramesInFlight; ++i) staging_[i].destroy(*dev_);
    stainPool_.destroy(*dev_);
    stainIdx_.destroy(*dev_);
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
        classScratch_[i] =
            classify(g.masks()[i], g.types()[i], sub ? sub->page(i) : nullptr);
    ok = ok && upload_via_staging(classes_, classScratch_.data(), kClassBytes);

    // Fluid-буфер умер (чистка 2026-08-24): воду возят страницы.

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

    // Stain: the index must never stay raw VRAM — sub_stain() dereferences it
    // for every hit pixel, and a garbage slot is a wild read into the pool.
    // Reset every cell to kNoPage, then queue the cells that do carry stain
    // pages; the flush path lands index + page together, so a valid slot never
    // points at an unwritten page.
    idxScratch_.assign(kMacroCells, kNoPage);
    ok = ok && upload_via_staging(stainIdx_, idxScratch_.data(), kStainIdxBytes);
    if (const SubField<StainRGB>* stainF =
            world.subfields().find<StainRGB>(kStainFieldName)) {
        const std::uint32_t* tab = stainF->page_table();
        for (std::uint32_t ci = 0; ci < kMacroCells; ++ci)
            if (tab[ci] != kNoPage) mark_dirty(&ci, 1);
    }
    return ok;
}

void VoxelMirror::mark_dirty(const std::uint32_t* cells, std::size_t n) {
    if (!ready_) return;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        if (ci >= kMacroCells) continue;
        std::uint64_t& w = dirtyBits_[ci >> 6];
        const std::uint64_t bit = std::uint64_t{1} << (ci & 63u);
        // Поколение записи — ВСЕГДА (и для уже-стоящих в очереди: свежая
        // запись той же клетки должна отодвинуть её «доставлено»).
        markGen_[ci] = flushGen_;
        if (w & bit) continue;
        w |= bit;
        dirty_.push_back(ci);
    }
}

void VoxelMirror::flush(VkCommandBuffer cmd, std::uint32_t frameIndex,
                        const World& world) {
    lastFlushCells_ = 0;
    lastFlushBytes_ = 0;
    // Клок кадров тикает КАЖДЫЙ флеш, включая пустые — поколения доставки
    // сравнимы со счётчиком паков автомата (оба 1/кадр, флеш до пака).
    const std::uint32_t thisFlush = flushGen_++;
    if (!ready_) return;
    if (dirty_.empty()) return;

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
    const SubField<StainRGB>* stainF =
        world.subfields().find<StainRGB>(kStainFieldName);
    const std::uint32_t* stainTab = stainF ? stainF->page_table() : nullptr;
    const std::uint32_t stainPages =
        stainF ? static_cast<std::uint32_t>(
                     stainF->page_count() < kStainPageCap ? stainF->page_count()
                                                          : kStainPageCap)
               : 0u;

    // How many sorted cells fit this frame's staging window.
    //
    // +3: ПОТОЛОК ВЫРАВНИВАНИЯ. Писатель ниже после класс-байтов ровняет off
    // до 4 (`(off + 3) & ~3` — uint32-волны обязаны быть выровнены), т.е. до
    // 3 неучтённых байт НА КАЖДЫЙ РАН. Ранов не больше, чем клеток, так что
    // +3 на клетку — честная верхняя граница (~4% окна). Без неё лавина
    // РАССЫПАННЫХ грязных клеток (десятки тысяч ранов — восстановленный этаж
    // с проснувшимися средами) выгоняла off за staging-буфер: memmove бил
    // SIGBUS либо молча портил кучу, и падали СЛУЧАЙНЫЕ жертвы — судья
    // детача посреди cell_partition, деструктор зеркала на выходе. Три
    // крашрепорта 2026-08-27, один корень.
    std::size_t take = 0;
    std::size_t need = 0;
    while (take < dirty_.size()) {
        const std::uint32_t ci = dirty_[take];
        std::size_t c = kMaskBytesPerCell + sizeof(CellType) +
                        sizeof(std::uint32_t) * 2 + 1 /* class byte */ +
                        3 /* потолок выравнивания рана — вывод выше */;
        if (pageTab && pageTab[ci] < poolCount) c += kPageBytes;
        if (stainTab && stainTab[ci] < stainPages) c += kStainPageBytes;
        if (need + c > kStagingBytes) break;
        need += c;
        ++take;
    }
    if (take == 0) return;

    VulkanBuffer& st = staging_[frameIndex % kMaxFramesInFlight];
    std::uint8_t* base = static_cast<std::uint8_t*>(st.mapped);
    std::size_t off = 0;
    maskCopies_.clear();
    typeCopies_.clear();
    idxCopies_.clear();
    poolCopies_.clear();
    classCopies_.clear();
    stainIdxCopies_.clear();
    stainPoolCopies_.clear();

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
            base[off + k] = classify(g.masks()[c0 + k], g.types()[c0 + k],
                                     sub ? sub->page(c0 + k) : nullptr);
        classCopies_.push_back({off, static_cast<VkDeviceSize>(c0),
                                static_cast<VkDeviceSize>(len)});
        off += len;
        off = (off + 3u) & ~std::size_t(3u);

        bytes = static_cast<std::size_t>(len) * sizeof(std::uint32_t);
        std::uint32_t* dst = reinterpret_cast<std::uint32_t*>(base + off);
        for (std::uint32_t k = 0; k < len; ++k) {
            const std::uint32_t slot = pageTab ? pageTab[c0 + k] : kNoPage;
            dst[k] = slot < poolCount ? slot : kNoPage;
        }
        idxCopies_.push_back(
            {off, static_cast<VkDeviceSize>(c0) * sizeof(std::uint32_t), bytes});
        off += bytes;

        // Stain page indices ride the same run.
        std::uint32_t* sdst = reinterpret_cast<std::uint32_t*>(base + off);
        for (std::uint32_t k = 0; k < len; ++k) {
            const std::uint32_t slot = stainTab ? stainTab[c0 + k] : kNoPage;
            sdst[k] = slot < stainPages ? slot : kNoPage;
        }
        stainIdxCopies_.push_back(
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
        if (stainF)
            for (std::uint32_t k = 0; k < len; ++k) {
                const std::uint32_t slot = stainTab[c0 + k];
                if (slot >= stainPages) continue;
                repack_stain_page(stainF->pages_data() +
                                      static_cast<std::size_t>(slot) * kSubVoxels,
                                  base + off);
                stainPoolCopies_.push_back(
                    {off, static_cast<VkDeviceSize>(slot) * kStainPageBytes,
                     kStainPageBytes});
                off += kStainPageBytes;
            }
        i = j;
    }
    // Пояс к потолку выше: если оценщик и писатель когда-нибудь разойдутся
    // снова, обрыв ЗДЕСЬ — с именем и числами — а не порча кучи с крашем в
    // случайной жертве тремя минутами позже.
    if (off > kStagingBytes) {
        std::fprintf(stderr,
                     "[mirror] FATAL: staging overrun %zu > %zu (take %zu)\n",
                     off, static_cast<std::size_t>(kStagingBytes), take);
        std::abort();
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
    if (!stainIdxCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, stainIdx_.buffer,
                        static_cast<std::uint32_t>(stainIdxCopies_.size()),
                        stainIdxCopies_.data());
    if (!stainPoolCopies_.empty())
        vkCmdCopyBuffer(cmd, st.buffer, stainPool_.buffer,
                        static_cast<std::uint32_t>(stainPoolCopies_.size()),
                        stainPoolCopies_.data());


    barrier_transfer_to_shader(cmd);

    for (std::size_t k = 0; k < take; ++k) {
        const std::uint32_t ci = dirty_[k];
        dirtyBits_[ci >> 6] &= ~(std::uint64_t{1} << (ci & 63u));
        uploadGen_[ci] = thisFlush; // запись ДОСТАВЛЕНА этим флешем
    }
    if (take == dirty_.size()) {
        dirty_.clear();
    } else {
        dirty_.erase(dirty_.begin(),
                     dirty_.begin() + static_cast<std::ptrdiff_t>(take));
    }
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
        classScratch_[i] =
            classify(g.masks()[i], g.types()[i], sub ? sub->page(i) : nullptr);
    ok = readback_compare(classes_, classScratch_.data(), kClassBytes, "class",
                          &m4) && ok;
    if (sub && poolCount > 0)
        ok = readback_compare(pagePool_, sub->pages_data(),
                              static_cast<std::size_t>(poolCount) * kPageBytes,
                              "page-pool", &m3) && ok;

    // FLUID-буфер умер (чистка 2026-08-24) — сверять нечего.
    // Stain half — the same truth-vs-GPU contract as sub-material above.
    const SubField<StainRGB>* stainF =
        world.subfields().find<StainRGB>(kStainFieldName);
    const std::uint32_t stainPages =
        stainF ? (stainF->page_count() < kStainPageCap
                      ? static_cast<std::uint32_t>(stainF->page_count())
                      : kStainPageCap)
               : 0u;
    idxScratch_.assign(kMacroCells, kNoPage);
    if (stainF) {
        const std::uint32_t* tab = stainF->page_table();
        for (std::size_t i = 0; i < kMacroCells; ++i)
            idxScratch_[i] = tab[i] < stainPages ? tab[i] : kNoPage;
    }
    std::uint32_t m5 = 0, m6 = 0;
    ok = readback_compare(stainIdx_, idxScratch_.data(), kStainIdxBytes,
                          "stain-index", &m5) && ok;
    if (stainF && stainPages > 0) {
        std::vector<std::uint8_t> repacked(
            static_cast<std::size_t>(stainPages) * kStainPageBytes);
        for (std::uint32_t p = 0; p < stainPages; ++p)
            repack_stain_page(stainF->pages_data() +
                                  static_cast<std::size_t>(p) * kSubVoxels,
                              repacked.data() +
                                  static_cast<std::size_t>(p) * kStainPageBytes);
        ok = readback_compare(stainPool_, repacked.data(), repacked.size(),
                              "stain-pool", &m6) && ok;
    }
    std::fprintf(stderr,
                 "[mirror] verify %s: %u dirty queued | masks %u types %u "
                 "pageIdx %u pool %u class %u stainIdx %u stainPool %u "
                 "mismatching bytes\n",
                 ok ? "OK" : "FAIL", dirty_backlog(), m0, m1, m2, m3, m4,
                 m5, m6);
    return ok;
}

} // namespace giga::gpu
