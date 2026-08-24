#include "render/gpu_medium_pass.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "render/voxel_mirror.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/macro_grid.h"
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

// Биты слова ActOut — зеркало шапки medium_sim.comp.
constexpr std::uint32_t kActChanged = 1u;
constexpr std::uint32_t kActTouchPosX = 1u << 2;
constexpr std::uint32_t kActTouchPosY = 1u << 3;
constexpr std::uint32_t kActTouchPosZ = 1u << 4;
constexpr std::uint32_t kActFaceShift = 8u;   // 6 бит: -x +x -y +y -z +z
constexpr std::uint32_t kActQuantaShift = 16u; // 10 бит: 0..512

} // namespace

bool GpuMediumPass::init(VulkanDevice* dev, const char* shaderDir,
                         const VoxelMirror& mirror) {
    dev_ = dev;
    if (!dev_) return false;
    if (!create_buffers()) return false;
    if (!create_descriptors(mirror)) return false;
    if (!create_pipeline(shaderDir)) return false;
    live_.reserve(kLiveCap);
    lastSlots_.reserve(kLiveCap);
    liveBits_.assign(kMacroCells / 64, 0);
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
    liveBuf_.destroy(*dev_);
    cellAct_.destroy(*dev_);
    actOut_.destroy(*dev_);
    dev_ = nullptr;
}

bool GpuMediumPass::create_buffers() noexcept {
    if (!liveBuf_.create_host_visible(*dev_, kLiveCap * sizeof(std::uint32_t),
                                      VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                      "medium-live"))
        return false;
    if (!cellAct_.create_device_local_empty(
            *dev_, kMacroCells * sizeof(std::uint32_t),
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "medium-cell-act"))
        return false;
    if (!actOut_.create_host_visible(*dev_, kLiveCap * sizeof(std::uint32_t),
                                     VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                     "medium-act-out"))
        return false;
    return true;
}

bool GpuMediumPass::create_descriptors(const VoxelMirror& mirror) noexcept {
    VkDevice d = dev_->device;

    VkDescriptorSetLayoutBinding bindings[8]{};
    for (std::uint32_t b = 0; b < 8; ++b) {
        bindings[b].binding = b;
        bindings[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        bindings[b].descriptorCount = 1;
        bindings[b].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    }
    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 8;
    dslci.pBindings = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &setLayout_));

    VkDescriptorPoolSize poolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 8};
    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets = 1;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes = &poolSize;
    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &pool_));

    VkDescriptorSetAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    ai.descriptorPool = pool_;
    ai.descriptorSetCount = 1;
    ai.pSetLayouts = &setLayout_;
    VK_TRY(vkAllocateDescriptorSets(d, &ai, &set_));

    VkDescriptorBufferInfo bufs[8]{};
    bufs[0] = {mirror.masks_buffer(), 0, VK_WHOLE_SIZE};
    bufs[1] = {mirror.types_buffer(), 0, VK_WHOLE_SIZE};
    bufs[2] = {mirror.page_index_buffer(), 0, VK_WHOLE_SIZE};
    bufs[3] = {mirror.page_pool_buffer(), 0, VK_WHOLE_SIZE};
    bufs[4] = {mirror.class_buffer(), 0, VK_WHOLE_SIZE};
    bufs[5] = {liveBuf_.buffer, 0, VK_WHOLE_SIZE};
    bufs[6] = {cellAct_.buffer, 0, VK_WHOLE_SIZE};
    bufs[7] = {actOut_.buffer, 0, VK_WHOLE_SIZE};

    VkWriteDescriptorSet writes[8]{};
    for (std::uint32_t b = 0; b < 8; ++b) {
        writes[b].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[b].dstSet = set_;
        writes[b].dstBinding = b;
        writes[b].descriptorCount = 1;
        writes[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[b].pBufferInfo = &bufs[b];
    }
    vkUpdateDescriptorSets(d, 8, writes, 0, nullptr);
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

void GpuMediumPass::wake_one(std::uint32_t ci, World& world,
                             VoxelMirror& mirror) {
    if (ci >= kMacroCells) return;
    if (liveBits_[ci >> 6] & (1ull << (ci & 63))) return;
    // Полнотвёрдую клетку не будим: под маской автомат не двигает ничего.
    const SubMask& m = world.grid().masks()[ci];
    if (m.full()) return;
    if (live_.size() >= kLiveCap) {
        if (!overflow_)
            std::fprintf(stderr,
                         "[medium] LIVE OVERFLOW: cap %u cells hit, further "
                         "wakes drop until sleepers free slots\n",
                         kLiveCap);
        overflow_ = true;
        return;
    }
    // Автомат пишет только в страницы: раскрыть CPU-страницу базой CellType и
    // прогнать её зеркальным dirty-путём. Уже раскрытую клетку flush не
    // трогает — GPU-состояние её материи не перетирается.
    SubField<CellType>& f =
        world.subfields().get_or_create<CellType>(kSubMaterialName);
    if (!f.paged(ci)) {
        f.ensure_page(ci, world.grid().types()[ci]);
        mirror.mark_dirty(&ci, 1);
    }
    liveBits_[ci >> 6] |= 1ull << (ci & 63);
    live_.push_back({ci, 0});
    ++wokenTotal_;
}

void GpuMediumPass::wake_cells(const std::uint32_t* cells, std::size_t n,
                               World& world, VoxelMirror& mirror) {
    if (!ready()) return;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        wake_one(ci, world, mirror);
        // Закон писателя: запись меняет и СВОБОДУ материи соседей (вода
        // рядом с новой дырой обязана потечь) — будим грани; лишние заснут
        // за kSleepSubsteps.
        const int cx = static_cast<int>(ci & 127u);
        const int cy = static_cast<int>((ci >> 7) & 127u);
        const int cz = static_cast<int>((ci >> 14) & 127u);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(wrap_macro(cx - 1), cy, cz)),
                 world, mirror);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(wrap_macro(cx + 1), cy, cz)),
                 world, mirror);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(cx, wrap_macro(cy - 1), cz)),
                 world, mirror);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(cx, wrap_macro(cy + 1), cz)),
                 world, mirror);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(cx, cy, wrap_macro(cz - 1))),
                 world, mirror);
        wake_one(static_cast<std::uint32_t>(
                     macro_index(cx, cy, wrap_macro(cz + 1))),
                 world, mirror);
    }
}

void GpuMediumPass::poll_activity(World& world, VoxelMirror& mirror) {
    if (!ready() || lastDispatched_ == 0 || !actOut_.mapped) return;
    const auto* words = static_cast<const std::uint32_t*>(actOut_.mapped);
    liveQuanta_ = 0;

    // Индексация quiet по ci: слоты текущего live_ могли уехать относительно
    // lastSlots_ (усыпления прошлых кадров) — карта ci->слот текущего live_.
    // live_ мал (кап 32768), линейный проход дешевле любой карты.
    for (std::uint32_t slot = 0; slot < lastDispatched_; ++slot) {
        const std::uint32_t ci = lastSlots_[slot];
        const std::uint32_t w = words[slot];
        const std::uint32_t quanta = (w >> kActQuantaShift) & 0x3FFu;
        liveQuanta_ += quanta;

        LiveCell* lc = nullptr;
        for (auto& c : live_)
            if (c.ci == ci) { lc = &c; break; }
        if (!lc) continue; // уснула раньше — слово опоздало

        if (w & kActChanged)
            lc->quiet = 0;
        else
            lc->quiet += lastSubstepsInDispatch_;

        const int cx = static_cast<int>(ci & 127u);
        const int cy = static_cast<int>((ci >> 7) & 127u);
        const int cz = static_cast<int>((ci >> 14) & 127u);
        auto wake_at = [&](int dx, int dy, int dz) {
            const std::uint32_t n = static_cast<std::uint32_t>(
                macro_index(wrap_macro(cx + dx), wrap_macro(cy + dy),
                            wrap_macro(cz + dz)));
            wake_one(n, world, mirror);
        };

        // Касание +октанта Margolus-блоками: будим все комбинации осей.
        const bool px = (w & kActTouchPosX) != 0;
        const bool py = (w & kActTouchPosY) != 0;
        const bool pz = (w & kActTouchPosZ) != 0;
        if (px) wake_at(1, 0, 0);
        if (py) wake_at(0, 1, 0);
        if (pz) wake_at(0, 0, 1);
        if (px && py) wake_at(1, 1, 0);
        if (px && pz) wake_at(1, 0, 1);
        if (py && pz) wake_at(0, 1, 1);
        if (px && py && pz) wake_at(1, 1, 1);

        // Материя у грани: сосед обязан жить, пока клетка не затихла —
        // блоки, покрывающие межклеточную пару, диспатчатся от него.
        if (lc->quiet < kSleepSubsteps) {
            const std::uint32_t faces = (w >> kActFaceShift) & 0x3Fu;
            if (faces & 1u) wake_at(-1, 0, 0);
            if (faces & 2u) wake_at(1, 0, 0);
            if (faces & 4u) wake_at(0, -1, 0);
            if (faces & 8u) wake_at(0, 1, 0);
            if (faces & 16u) wake_at(0, 0, -1);
            if (faces & 32u) wake_at(0, 0, 1);
        }
    }
    lastDispatched_ = 0;

    // Усыпление тихих: страница остаётся каноническим форматом зеркала,
    // клетка перестаёт стоить диспатча. Возврат в CPU-канон — инкремент 3.
    for (std::size_t i = 0; i < live_.size();) {
        if (live_[i].quiet >= kSleepSubsteps) {
            const std::uint32_t ci = live_[i].ci;
            liveBits_[ci >> 6] &= ~(1ull << (ci & 63));
            live_[i] = live_.back();
            live_.pop_back();
            ++sleptTotal_;
            if (overflow_ && live_.size() < kLiveCap) overflow_ = false;
        } else {
            ++i;
        }
    }
}

void GpuMediumPass::record_substeps(VkCommandBuffer cmd, std::uint32_t n,
                                    const CellStep& downStep,
                                    std::uint64_t substepBase) {
    if (!ready()) return;

    if (actNeedsClear_) {
        vkCmdFillBuffer(cmd, cellAct_.buffer, 0, VK_WHOLE_SIZE, 0u);
        VkBufferMemoryBarrier fb{};
        fb.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        fb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        fb.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        fb.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        fb.buffer = cellAct_.buffer;
        fb.offset = 0;
        fb.size = VK_WHOLE_SIZE;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0,
                             nullptr, 1, &fb, 0, nullptr);
        actNeedsClear_ = false;
    }

    if (n == 0 || live_.empty()) {
        lastDispatched_ = 0;
        return;
    }

    // Слоты этого диспатча — снапшот для poll_activity следующего кадра.
    lastSlots_.clear();
    auto* liveDst = static_cast<std::uint32_t*>(liveBuf_.mapped);
    for (std::size_t i = 0; i < live_.size(); ++i) {
        liveDst[i] = live_[i].ci;
        lastSlots_.push_back(live_[i].ci);
    }
    const auto liveCount = static_cast<std::uint32_t>(live_.size());
    lastDispatched_ = liveCount;
    lastSubstepsInDispatch_ = n;

    // Вход: flush() зеркала писал pool/masks/классы трансфером, прошлые
    // компьют/фрагментные читатели могли читать — полный вход в компьют.
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
                            1, &set_, 0, nullptr);

    VkMemoryBarrier c2c{};
    c2c.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    c2c.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    c2c.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;

    MediumPush push{};
    push.downStep = ivec4{downStep.x, downStep.y, downStep.z, 0};
    for (std::uint32_t s = 0; s < n; ++s) {
        push.params[0] = static_cast<std::uint32_t>(substepBase + s);
        push.params[1] = liveCount;
        push.params[2] = 0; // MOVE
        vkCmdPushConstants(cmd, pipeLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(push), &push);
        vkCmdDispatch(cmd, liveCount, 1, 1);
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &c2c,
                             0, nullptr, 0, nullptr);
    }
    // SETTLE один на пачку: класс/кванты/грани нужны по итогу кадра, а
    // CellAct копит changed-биты всех подтиков пачки до atomicExchange.
    push.params[2] = 1;
    vkCmdPushConstants(cmd, pipeLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                       sizeof(push), &push);
    vkCmdDispatch(cmd, liveCount, 1, 1);

    // Выход: пул/классы читают DDA-фрагменты и другие компьюты; ActOut
    // читает хост (без фенса, честность отставания — см. шапку .h).
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
