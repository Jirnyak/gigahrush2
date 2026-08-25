#include "render/gpu_medium_pass.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/voxel_mirror.h"
#include "world/destruct.h" // kSubMaterialName, materialize_sub_page
#include "world/macro_grid.h"
#include "world/medium.h"   // medium_recount — агрегаты S16.4 на шве
#include "world/subfield.h"
#include "world/world.h"

namespace giga::gpu {

namespace {

std::string path_join(const char* dir, const char* file) {
    std::string s = dir ? dir : "";
    if (!s.empty() && s.back() != '/' && s.back() != '\\') s += '/';
    s += file;
    return s;
}

bool read_spv(const char* path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) { std::fclose(f); return false; }
    out.resize(static_cast<std::size_t>(n));
    std::size_t rd = std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return rd == static_cast<std::size_t>(n);
}

// Слоты обратного шва: страница 1 КиБ + маска 64 Б, зеркало шейдера.
constexpr VkDeviceSize kPageBytesBack = kSubVoxels * sizeof(std::uint16_t);
constexpr VkDeviceSize kMaskBytesBack = 64;
// Регион списка: 8 u32 заголовка (count, quanta, woken, slept, честный
// размер списка до окна пака, флаг капа wake_next, 2 резервных) + слоты.
constexpr std::uint32_t kListHeader = 8;

// Режимы шейдера ([shaders/medium_sim.comp] pc.params.y).
constexpr std::uint32_t kModePrepare = 0;
constexpr std::uint32_t kModeMove = 1;
constexpr std::uint32_t kModeSettle = 2;
constexpr std::uint32_t kModeInject = 3;
constexpr std::uint32_t kModePack = 4;
constexpr std::uint32_t kModeRelease = 5; // снять биты списка до move

} // namespace

bool GpuMediumPass::init(VulkanDevice* dev, const char* shaderDir,
                         const VoxelMirror& mirror) {
    dev_ = dev;
    if (!dev_) return false;
    mirrorPool_ = mirror.page_pool_buffer();
    mirrorMasks_ = mirror.masks_buffer();
    if (!create_buffers()) return false;
    if (!create_descriptors(mirror)) return false;
    if (!create_pipeline(shaderDir)) return false;
    appendPending_.reserve(kAppendCap);
    return true;
}

void GpuMediumPass::destroy() noexcept {
    if (!dev_) return;
    VkDevice d = dev_->device;
    if (pipeline_) vkDestroyPipeline(d, pipeline_, nullptr);
    if (pipeLayout_) vkDestroyPipelineLayout(d, pipeLayout_, nullptr);
    if (pool_) vkDestroyDescriptorPool(d, pool_, nullptr);
    if (setLayout_) vkDestroyDescriptorSetLayout(d, setLayout_, nullptr);
    pipeline_ = VK_NULL_HANDLE;
    pipeLayout_ = VK_NULL_HANDLE;
    pool_ = VK_NULL_HANDLE;
    setLayout_ = VK_NULL_HANDLE;
    listA_.destroy(*dev_);
    listB_.destroy(*dev_);
    counters_.destroy(*dev_);
    cellAct_.destroy(*dev_);
    for (auto& b : appendBuf_) b.destroy(*dev_);
    pageBack_.destroy(*dev_);
    maskBack_.destroy(*dev_);
    listBack_.destroy(*dev_);
    dev_ = nullptr;
}

bool GpuMediumPass::create_buffers() noexcept {
    const VkBufferUsageFlags st = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
    if (!listA_.create_device_local_empty(
            *dev_, kLiveCap * sizeof(std::uint32_t), st, "medium-list-a"))
        return false;
    if (!listB_.create_device_local_empty(
            *dev_, kLiveCap * sizeof(std::uint32_t), st, "medium-list-b"))
        return false;
    if (!counters_.create_device_local_empty(
            *dev_, 16 * sizeof(std::uint32_t),
            st | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT |
                VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "medium-counters"))
        return false;
    if (!cellAct_.create_device_local_empty(
            *dev_, kMacroCells * sizeof(std::uint32_t),
            st | VK_BUFFER_USAGE_TRANSFER_DST_BIT, "medium-cell-act"))
        return false;
    for (int i = 0; i < kMaxFramesInFlight; ++i)
        if (!appendBuf_[i].create_host_visible(
                *dev_, (1 + kAppendCap) * sizeof(std::uint32_t), st,
                "medium-append"))
            return false;
    if (!pageBack_.create_host_visible(
            *dev_,
            static_cast<VkDeviceSize>(kRbRegions) * kRbSlotCap * kPageBytesBack,
            st, "medium-page-back"))
        return false;
    if (!maskBack_.create_host_visible(
            *dev_,
            static_cast<VkDeviceSize>(kRbRegions) * kRbSlotCap * kMaskBytesBack,
            st, "medium-mask-back"))
        return false;
    if (!listBack_.create_host_visible(
            *dev_,
            static_cast<VkDeviceSize>(kRbRegions) * (kListHeader + kRbSlotCap) *
                sizeof(std::uint32_t),
            st, "medium-list-back"))
        return false;
    return true;
}

bool GpuMediumPass::create_descriptors(const VoxelMirror& mirror) noexcept {
    VkDevice d = dev_->device;
    constexpr std::uint32_t kBindings = 13;

    VkDescriptorSetLayoutBinding bindings[kBindings]{};
    for (std::uint32_t b = 0; b < kBindings; ++b) {
        bindings[b].binding = b;
        bindings[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        bindings[b].descriptorCount = 1;
        bindings[b].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    }
    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = kBindings;
    dslci.pBindings = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &setLayout_));

    VkDescriptorPoolSize poolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
                                  kBindings * kMaxFramesInFlight};
    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets = kMaxFramesInFlight;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes = &poolSize;
    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &pool_));

    // Один сет на слот кадра — отличается только append-буфером.
    VkDescriptorSetLayout layouts[kMaxFramesInFlight];
    for (int i = 0; i < kMaxFramesInFlight; ++i) layouts[i] = setLayout_;
    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = pool_;
    ai.descriptorSetCount = kMaxFramesInFlight;
    ai.pSetLayouts = layouts;
    VK_TRY(vkAllocateDescriptorSets(d, &ai, sets_));

    for (int f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo bufs[kBindings]{};
        bufs[0] = {mirror.masks_buffer(), 0, VK_WHOLE_SIZE};
        bufs[1] = {mirror.types_buffer(), 0, VK_WHOLE_SIZE};
        bufs[2] = {mirror.page_index_buffer(), 0, VK_WHOLE_SIZE};
        bufs[3] = {mirror.page_pool_buffer(), 0, VK_WHOLE_SIZE};
        bufs[4] = {mirror.class_buffer(), 0, VK_WHOLE_SIZE};
        bufs[5] = {listA_.buffer, 0, VK_WHOLE_SIZE};
        bufs[6] = {cellAct_.buffer, 0, VK_WHOLE_SIZE};
        bufs[7] = {listB_.buffer, 0, VK_WHOLE_SIZE};
        bufs[8] = {counters_.buffer, 0, VK_WHOLE_SIZE};
        bufs[9] = {appendBuf_[f].buffer, 0, VK_WHOLE_SIZE};
        bufs[10] = {pageBack_.buffer, 0, VK_WHOLE_SIZE};
        bufs[11] = {maskBack_.buffer, 0, VK_WHOLE_SIZE};
        bufs[12] = {listBack_.buffer, 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[kBindings]{};
        for (std::uint32_t b = 0; b < kBindings; ++b) {
            writes[b].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[b].dstSet = sets_[f];
            writes[b].dstBinding = b;
            writes[b].descriptorCount = 1;
            writes[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
            writes[b].pBufferInfo = &bufs[b];
        }
        vkUpdateDescriptorSets(d, kBindings, writes, 0, nullptr);
    }
    return true;
}

bool GpuMediumPass::create_pipeline(const char* shaderDir) noexcept {
    VkDevice d = dev_->device;
    const std::string spvPath = path_join(shaderDir, "medium_sim.comp.spv");
    std::vector<char> code;
    if (!read_spv(spvPath.c_str(), code)) {
        std::fprintf(stderr, "[medium] failed to load %s\n", spvPath.c_str());
        return false;
    }
    VkShaderModuleCreateInfo smci{};
    smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    smci.codeSize = code.size();
    smci.pCode = reinterpret_cast<const std::uint32_t*>(code.data());
    VkShaderModule mod = VK_NULL_HANDLE;
    VK_TRY(vkCreateShaderModule(d, &smci, nullptr, &mod));

    VkPushConstantRange pcRange{VK_SHADER_STAGE_COMPUTE_BIT, 0,
                                sizeof(MediumPush)};
    VkPipelineLayoutCreateInfo plci{};
    plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plci.setLayoutCount = 1;
    plci.pSetLayouts = &setLayout_;
    plci.pushConstantRangeCount = 1;
    plci.pPushConstantRanges = &pcRange;
    if (vkCreatePipelineLayout(d, &plci, nullptr, &pipeLayout_) != VK_SUCCESS) {
        vkDestroyShaderModule(d, mod, nullptr);
        return false;
    }
    VkComputePipelineCreateInfo cpci{};
    cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    cpci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    cpci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    cpci.stage.module = mod;
    cpci.stage.pName = "main";
    cpci.layout = pipeLayout_;
    VkResult res =
        vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &cpci, nullptr, &pipeline_);
    vkDestroyShaderModule(d, mod, nullptr);
    return res == VK_SUCCESS;
}

void GpuMediumPass::wake_cells(const std::uint32_t* cells, std::size_t n,
                               World& world, VoxelMirror& mirror) {
    if (!ready()) return;
    auto touch = [&](std::uint32_t ci) {
        if (ci >= kMacroCells) return;
        // Полнотвёрдую клетку не будим: под маской двигать нечего.
        if (world.grid().masks()[ci].full()) return;
        SubField<CellType>& f =
            world.subfields().get_or_create<CellType>(kSubMaterialName);
        if (!f.paged(ci)) {
            materialize_sub_page(world, ci);
            mirror.mark_dirty(&ci, 1);
        }
        if (appendPending_.size() < kAppendCap)
            appendPending_.push_back(ci);
        else if (!overflow_) {
            overflow_ = true;
            std::fprintf(stderr,
                         "[medium] APPEND OVERFLOW: %u pending, further wakes "
                         "drop this frame\n",
                         kAppendCap);
        }
    };
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        touch(ci);
        // Закон писателя: запись меняет и свободу материи соседей.
        const int cx = static_cast<int>(ci & 127u);
        const int cy = static_cast<int>((ci >> 7) & 127u);
        const int cz = static_cast<int>((ci >> 14) & 127u);
        touch(static_cast<std::uint32_t>(
                  macro_index(wrap_macro(cx - 1), cy, cz)));
        touch(static_cast<std::uint32_t>(
                  macro_index(wrap_macro(cx + 1), cy, cz)));
        touch(static_cast<std::uint32_t>(
                  macro_index(cx, wrap_macro(cy - 1), cz)));
        touch(static_cast<std::uint32_t>(
                  macro_index(cx, wrap_macro(cy + 1), cz)));
        touch(static_cast<std::uint32_t>(
                  macro_index(cx, cy, wrap_macro(cz - 1))));
        touch(static_cast<std::uint32_t>(
                  macro_index(cx, cy, wrap_macro(cz + 1))));
    }
}

void GpuMediumPass::apply_readback(World& world, VoxelMirror& mirror,
                                   std::vector<std::uint32_t>* changedMasks) {
    if (!ready() || !pageBack_.mapped || !maskBack_.mapped ||
        !listBack_.mapped)
        return;
    if (rbGen_ < kRbRegions) return;
    RbRecord& rec = rbRing_[rbGen_ % kRbRegions];
    if (!rec.valid) return;
    rec.valid = false;
    const auto region = static_cast<std::uint32_t>(rbGen_ % kRbRegions);

    const auto* list = static_cast<const std::uint32_t*>(listBack_.mapped) +
                       static_cast<std::size_t>(region) *
                           (kListHeader + kRbSlotCap);
    const std::uint32_t count = std::min(list[0], kRbSlotCap);
    lastCount_ = list[0];
    lastQuanta_ = list[1];
    wokenTotal_ = list[2];
    sleptTotal_ = list[3];
    listTotal_ = list[4];
    fadeTotal_ = list[7];
    wakeCapHit_ = list[5] != 0;
    if (list[4] > kRbSlotCap && !rbWindowWarned_) {
        rbWindowWarned_ = true;
        std::fprintf(stderr,
                     "[medium] rb window: %u live > %u slots\n", list[4],
                     kRbSlotCap);
    }
    if (wakeCapHit_ && !wakeCapWarned_) {
        wakeCapWarned_ = true;
        std::fprintf(stderr, "[medium] WAKE CAP HIT: список полон\n");
    }

    SubField<CellType>* f =
        world.subfields().find<CellType>(kSubMaterialName);
    if (!f) return;
    const auto* src = static_cast<const std::uint8_t*>(pageBack_.mapped) +
                      static_cast<std::size_t>(region) * kRbSlotCap *
                          kPageBytesBack;
    const auto* msrc = static_cast<const std::uint8_t*>(maskBack_.mapped) +
                       static_cast<std::size_t>(region) * kRbSlotCap *
                           kMaskBytesBack;
    lazyDirty_.clear();
    const bool probeDiag = std::getenv("GIGA_POUR") != nullptr;
    for (std::uint32_t i = 0; i < count; ++i) {
        const std::uint32_t word = list[kListHeader + i];
        const std::uint32_t ci = word & 0x7FFFFFFFu;
        if (ci >= kMacroCells) continue;
        if (probeDiag) {
            seamSeen_.insert(ci);
            if (word & 0x80000000u) seamLazy_.insert(ci);
        }
        if (word & 0x80000000u) {
            // GPU видел клетку безстраничной: материализуем лениво — flush
            // довезёт страницу, материя подождёт у границы кадр-два.
            if (!f->paged(ci)) {
                materialize_sub_page(world, ci);
                lazyDirty_.push_back(ci);
            }
            continue;
        }
        // ГЕЙТ СВЕЖЕСТИ ОТ ДОСТАВКИ (баг «дыра заросла», 2026-08-26):
        // CPU-запись честна на GPU только после её ФЛЕША; окно стейджинга
        // возит остаток кадрами, поэтому гейт «от момента записи» ломался:
        // пак между записью и её доставкой нёс до-записное состояние и
        // воскрешал выбитые карвом атомы. Скип, пока запись в очереди, и
        // для паков, записанных не позже доставившего флеша.
        if (mirror.write_pending(ci) ||
            rec.flushCount <= mirror.upload_gen(ci))
            continue;
        CellType* pg = f->page(ci);
        if (!pg) continue; // CPU-писатель схлопнул — его решение свежее
        const void* np = src + static_cast<std::size_t>(i) * kPageBytesBack;
        SubMask& m = world.grid().masks_mut()[ci];
        const void* nm = msrc + static_cast<std::size_t>(i) * kMaskBytesBack;
        // Пак возит ВЕСЬ живой список, но большинство слотов не менялись с
        // прошлого applied-региона: сравнение дешевле копии с пересчётом
        // агрегатов (замер 2026-08-25: apply 5-7 мс/кадр при полном окне,
        // почти весь — memcpy+recount неизменённых страниц).
        const bool pageSame = std::memcmp(pg, np, kPageBytesBack) == 0;
        const bool maskSame = std::memcmp(m.words, nm, kMaskBytesBack) == 0;
        if (pageSame && maskSame) continue;
        if (!pageSame) {
            std::memcpy(pg, np, kPageBytesBack);
            medium_recount(world, ci, pg);
        }
        if (!maskSame) {
            std::memcpy(m.words, nm, kMaskBytesBack);
            if (changedMasks) changedMasks->push_back(ci);
        }
    }
    if (!lazyDirty_.empty()) {
        mirror.mark_dirty(lazyDirty_.data(), lazyDirty_.size());
        lazyTotal_ += static_cast<std::uint32_t>(lazyDirty_.size());
        // Закон писателя: материализация — это запись, она меняет свободу
        // материи соседей. Будим клетку И грани — иначе сосед-владелец
        // межклеточных блоков мог уснуть об неписуемую страницу, и обрыв
        // замерзает (тест frontier freeze).
        wake_cells(lazyDirty_.data(), lazyDirty_.size(), world, mirror);
    }
}

void GpuMediumPass::record_substeps(VkCommandBuffer cmd, std::uint32_t n,
                                    const CellStep& downStep,
                                    std::uint64_t substepBase,
                                    const World& world, std::uint32_t frameSlot,
                                    std::uint32_t mirrorFlushGen) {
    (void)world;
    if (!ready()) return;
    const std::uint32_t slot = frameSlot % kMaxFramesInFlight;

    if (actNeedsClear_) {
        vkCmdFillBuffer(cmd, cellAct_.buffer, 0, VK_WHOLE_SIZE, 0u);
        vkCmdFillBuffer(cmd, counters_.buffer, 0, VK_WHOLE_SIZE, 0u);
        VkMemoryBarrier fb{};
        fb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &fb,
                             0, nullptr, 0, nullptr);
        actNeedsClear_ = false;
        listSel_ = 0;
        rbGen_ = 0;
        for (auto& r : rbRing_) r.valid = false;
    }

    // Вход: flush зеркала (трансфер) и прошлые читатели — до компьюта.
    VkMemoryBarrier inBar{};
    inBar.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    inBar.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT | VK_ACCESS_SHADER_READ_BIT;
    inBar.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_TRANSFER_BIT |
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT |
                             VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &inBar, 0,
                         nullptr, 0, nullptr);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeLayout_, 0,
                            1, &sets_[slot], 0, nullptr);

    VkMemoryBarrier c2c{};
    c2c.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    c2c.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    c2c.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT |
                        VK_ACCESS_INDIRECT_COMMAND_READ_BIT;
    auto barrier = [&]() {
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT |
                                 VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
                             0, 1, &c2c, 0, nullptr, 0, nullptr);
    };

    MediumPush push{};
    push.downStep = ivec4{downStep.x, downStep.y, downStep.z, 0};
    auto dispatch_mode = [&](std::uint32_t mode, std::uint32_t sel,
                             std::uint32_t region, std::uint32_t groups) {
        push.params[0] = static_cast<std::uint32_t>(substepBase);
        push.params[1] = mode;
        push.params[2] = sel;
        push.params[3] = region;
        vkCmdPushConstants(cmd, pipeLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(push), &push);
        vkCmdDispatch(cmd, groups, 1, 1);
    };
    auto dispatch_indirect = [&](std::uint32_t mode, std::uint32_t sel,
                                 std::uint64_t sub) {
        push.params[0] = static_cast<std::uint32_t>(sub);
        push.params[1] = mode;
        push.params[2] = sel;
        push.params[3] = 0;
        vkCmdPushConstants(cmd, pipeLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(push), &push);
        vkCmdDispatchIndirect(cmd, counters_.buffer,
                              sel == 0 ? 0 : 4 * sizeof(std::uint32_t));
    };

    // ИНЖЕКТ писателей: клетки кадра — в ТЕКУЩИЙ список (селектор
    // инвертирован: «next» инжекта = текущий).
    if (!appendPending_.empty() && appendBuf_[slot].mapped) {
        auto* ap = static_cast<std::uint32_t*>(appendBuf_[slot].mapped);
        const auto cnt =
            static_cast<std::uint32_t>(appendPending_.size());
        ap[0] = cnt;
        std::memcpy(ap + 1, appendPending_.data(),
                    cnt * sizeof(std::uint32_t));
        appendPending_.clear();
        dispatch_mode(kModeInject, listSel_ ^ 1u, 0, (cnt + 63) / 64);
        barrier();
    }

    // Подтики: prepare (кламп cur, сброс next+квантов) -> move -> settle.
    for (std::uint32_t s = 0; s < n; ++s) {
        dispatch_mode(kModePrepare, listSel_, 1, 1);
        barrier();
        // Release ДО move: бит после него = «уже в следующем списке»,
        // дубликаты слотов мертвы по построению ([medium_sim.comp]).
        dispatch_indirect(kModeRelease, listSel_, substepBase + s);
        barrier();
        dispatch_indirect(kModeMove, listSel_, substepBase + s);
        barrier();
        dispatch_indirect(kModeSettle, listSel_, substepBase + s);
        barrier();
        listSel_ ^= 1u;
    }
    if (n == 0) {
        // Спокойный кадр: кламп текущего счётчика всё равно нужен паку.
        dispatch_mode(kModePrepare, listSel_, 0, 1);
        barrier();
    }

    // PACK шва: страницы/маски/список живых — в регион кольца, GPU-пассом.
    const auto region = static_cast<std::uint32_t>(rbGen_ % kRbRegions);
    rbRing_[region].valid = true;
    rbRing_[region].flushCount = mirrorFlushGen;
    // Поколение кольца — паку: вращает окно по списку (хвост не голодает).
    push.params[0] = static_cast<std::uint32_t>(rbGen_);
    ++rbGen_;
    push.params[1] = kModePack;
    push.params[2] = listSel_;
    push.params[3] = region;
    vkCmdPushConstants(cmd, pipeLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                       sizeof(push), &push);
    vkCmdDispatchIndirect(cmd, counters_.buffer,
                          listSel_ == 0 ? 0 : 4 * sizeof(std::uint32_t));

    // Выход: пул/классы/маски читают фрагменты и компьюты; регионы шва —
    // хост (фенсовая дисциплина решает готовность).
    VkMemoryBarrier outBar{};
    outBar.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    outBar.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    outBar.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_HOST_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT |
                             VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT |
                             VK_PIPELINE_STAGE_HOST_BIT,
                         0, 1, &outBar, 0, nullptr, 0, nullptr);
}

} // namespace giga::gpu
