// gpu_light_grid.cpp — GPU 3D Volumetric Light Grid & Fog Subsystem.
#include "render/gpu_light_grid.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "render/vk_common.h"
#include "render/vk_device.h"
#include "world/types.h"   // kWorldExtent — the ONE wrap period, never a literal

namespace giga::gpu {

namespace {

std::string path_join(const char* dir, const char* file) {
    std::string s = dir;
    if (!s.empty() && s.back() != '/' && s.back() != '\\') s += '/';
    s += file;
    return s;
}

bool read_spv(const char* path, std::vector<char>& out) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) {
        std::fprintf(stderr, "[light-grid] cannot open %s\n", path);
        return false;
    }
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (n <= 0) {
        std::fclose(f);
        return false;
    }
    out.resize(static_cast<std::size_t>(n));
    std::fread(out.data(), 1, static_cast<std::size_t>(n), f);
    std::fclose(f);
    return true;
}

} // namespace

bool GpuLightGrid::init(VulkanDevice* dev, const char* shaderDir) {
    dev_ = dev;
    if (!dev_) return false;

    stagingLights_.resize(kRootLights);

    if (!create_buffers()) {
        std::fprintf(stderr, "[light-grid] failed to allocate GPU buffers\n");
        return false;
    }
    if (!create_descriptor_sets()) {
        std::fprintf(stderr, "[light-grid] failed to create descriptor sets\n");
        return false;
    }
    if (!create_compute_pipeline(shaderDir)) {
        std::fprintf(stderr, "[light-grid] failed to create compute pipeline\n");
        return false;
    }

    // Числа — из констант, не из прозы: старая строка врала «32x16x32, 256
    // lights» ещё долго после переезда сетки на весь тор.
    std::fprintf(stderr,
                 "[light-grid] initialized (%ux%ux%u grid, cell %u B = %u id slots, "
                 "root cap %u lights, baked mirror %zu MiB)\n",
                 kGridDimX, kGridDimY, kGridDimZ, kGridCellBytes, kGridCellSlots,
                 kRootLights,
                 static_cast<std::size_t>(kTotalGridCells) * kGridCellBytes >> 20);
    return true;
}

bool GpuLightGrid::create_buffers() noexcept {
    // 16 bytes header (uPointLightCount + 3 reserved uints) + корневой кап
    // таблицы: 131072 × 48 Б = 6.3 МБ host-visible (решение владельца,
    // light-perf.md §капы; «дальние комнаты гаснут» уходит по построению).
    constexpr VkDeviceSize kLightBufSize = 16 + kRootLights * sizeof(GpuPointLight);
    if (!lightBuf_.create_host_visible(*dev_, kLightBufSize,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "light-point-buf")) {
        return false;
    }
    lightMapped_ = lightBuf_.mapped;
    std::memset(lightMapped_, 0, static_cast<std::size_t>(kLightBufSize));

    // 64³ клеток (весь тор, 4 м клетка) × kGridCellBytes: 262144 × 256 Б =
    // 64 МиБ device-local («гроши» — решение владельца, light-visibility-bake.md)
    constexpr VkDeviceSize kGridBufSize = kTotalGridCells * sizeof(GpuGridCell);
    std::vector<uint8_t> zeroGrid(static_cast<std::size_t>(kGridBufSize), 0);
    if (!gridSSBO_.create_device_local(*dev_, zeroGrid.data(), kGridBufSize,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "light-grid-ssbo")) {
        return false;
    }

    // Запечённая видимость: зеркало bakedGrid (device-local, чтобы кадр читал
    // из VRAM, а не через PCIe — Windows-железо дискретно) + host-visible
    // стейджинг той же раскладки. «Бери больше во благо» (решение владельца
    // §7: VRAM +65 МиБ принят). Буферы dirtyGen/кластерной топологии грязной
    // ветки вырезаны чисткой 2026-08-23 (свет ДОГОНЯЕТ мир, 37e772d1).
    if (!bakedGrid_.create_device_local(*dev_, zeroGrid.data(), kGridBufSize,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
            "light-baked-grid")) {
        return false;
    }
    if (!bakedStaging_.create_host_visible(*dev_, kGridBufSize,
            VK_BUFFER_USAGE_TRANSFER_SRC_BIT, "light-baked-staging")) {
        return false;
    }
    bakedMapped_ = bakedStaging_.mapped;

    // Бакеты динамиков (59.14): 4096 × 16 u32 = 256 КиБ, CPU пересплачивает
    // каждый кадр (чистятся только счётчики, слоты дописываются поверх).
    constexpr VkDeviceSize kDynSize =
        static_cast<VkDeviceSize>(kDynBucketCount) * (1 + kDynBucketSlots) *
        sizeof(uint32_t);
    if (!dynBuckets_.create_host_visible(*dev_, kDynSize,
            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT, "light-dyn-buckets")) {
        return false;
    }
    dynBucketsMapped_ = static_cast<uint32_t*>(dynBuckets_.mapped);
    std::memset(dynBucketsMapped_, 0, static_cast<std::size_t>(kDynSize));

    return true;
}

bool GpuLightGrid::create_descriptor_sets() noexcept {
    VkDevice d = dev_->device;

    // Binding 0: PointLightBuffer (Set 0)
    // Binding 1: LightGridBuffer (Set 0)
    // Binding 2: BakedGridBuffer — запечённая видимость (compute-only)
    // Binding 3: DynBucketBuffer — бакеты динамиков 59.14 (compute-only)
    // (DirtyGen и кластерная топология — биндинги 3/5/6 до чистки 2026-08-23 —
    //  вырезаны вместе с шейдерной стороной, layout снова плотный.)
    VkDescriptorSetLayoutBinding bindings[4]{};
    for (uint32_t i = 0; i < 4; ++i) {
        bindings[i].binding = i;
        bindings[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        bindings[i].descriptorCount = 1;
        bindings[i].stageFlags =
            i < 2 ? (VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT)
                  : VK_SHADER_STAGE_COMPUTE_BIT;
    }

    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 4;
    dslci.pBindings = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &descriptorSetLayout_));

    // Pool
    VkDescriptorPoolSize poolSize{};
    poolSize.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSize.descriptorCount = 4;

    VkDescriptorPoolCreateInfo poolci{};
    poolci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    poolci.maxSets = 1;
    poolci.poolSizeCount = 1;
    poolci.pPoolSizes = &poolSize;
    VK_TRY(vkCreateDescriptorPool(d, &poolci, nullptr, &descPool_));

    // Allocate Set 0
    VkDescriptorSetAllocateInfo alloci{};
    alloci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloci.descriptorPool = descPool_;
    alloci.descriptorSetCount = 1;
    alloci.pSetLayouts = &descriptorSetLayout_;
    VK_TRY(vkAllocateDescriptorSets(d, &alloci, &descriptorSet_));

    // Write descriptor sets
    VkDescriptorBufferInfo bufi[4]{};
    bufi[0].buffer = lightBuf_.buffer;
    bufi[1].buffer = gridSSBO_.buffer;
    bufi[2].buffer = bakedGrid_.buffer;
    bufi[3].buffer = dynBuckets_.buffer;
    for (auto& b : bufi) {
        b.offset = 0;
        b.range = VK_WHOLE_SIZE;
    }

    VkWriteDescriptorSet writes[4]{};
    for (uint32_t i = 0; i < 4; ++i) {
        writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet = descriptorSet_;
        writes[i].dstBinding = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[i].pBufferInfo = &bufi[i];
    }
    vkUpdateDescriptorSets(d, 4, writes, 0, nullptr);
    return true;
}

bool GpuLightGrid::create_compute_pipeline(const char* shaderDir) noexcept {
    VkDevice d = dev_->device;

    const std::string spvPath = path_join(shaderDir, "light_grid.comp.spv");
    std::vector<char> code;
    if (!read_spv(spvPath.c_str(), code)) {
        std::fprintf(stderr, "[light-grid] ERROR: failed to load %s\n", spvPath.c_str());
        return false;
    }

    VkShaderModuleCreateInfo smci{};
    smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    smci.codeSize = code.size();
    smci.pCode = reinterpret_cast<const uint32_t*>(code.data());

    VkShaderModule compModule = VK_NULL_HANDLE;
    VK_TRY(vkCreateShaderModule(d, &smci, nullptr, &compModule));

    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    pcRange.offset = 0;
    pcRange.size = sizeof(GridPush);

    VkPipelineLayoutCreateInfo layoutci{};
    layoutci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    layoutci.setLayoutCount = 1;
    layoutci.pSetLayouts = &descriptorSetLayout_;
    layoutci.pushConstantRangeCount = 1;
    layoutci.pPushConstantRanges = &pcRange;
    VK_TRY(vkCreatePipelineLayout(d, &layoutci, nullptr, &pipelineLayout_));

    VkComputePipelineCreateInfo pipeci{};
    pipeci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipeci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipeci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    pipeci.stage.module = compModule;
    pipeci.stage.pName = "main";
    pipeci.layout = pipelineLayout_;

    VkResult res = vkCreateComputePipelines(d, VK_NULL_HANDLE, 1, &pipeci, nullptr, &computePipeline_);
    vkDestroyShaderModule(d, compModule, nullptr);

    return res == VK_SUCCESS;
}

void GpuLightGrid::set_static_table(const GpuPointLight* base, uint32_t n) noexcept {
    if (n > kRootLights) {
        // Корневой кап — вслух (S11): молчаливое обрезание запрещено.
        std::fprintf(stderr,
                     "[light-grid] STATIC TABLE OVERFLOW: %u lamps > root cap %u"
                     " — tail dropped\n",
                     n, kRootLights);
        n = kRootLights;
    }
    if (n > 0) {
        std::memcpy(stagingLights_.data(), base, n * sizeof(GpuPointLight));
    }
    staticCount_ = n;
    dynamicCount_ = 0;
}

void GpuLightGrid::set_static_intensity(uint32_t slot, float intensity) noexcept {
    if (slot >= staticCount_) return; // kNoLightSlot и чужой слой падают сюда
    stagingLights_[slot].colorIntensity.w = intensity;
}

float GpuLightGrid::staged_intensity(uint32_t slot) const noexcept {
    return slot < kRootLights ? stagingLights_[slot].colorIntensity.w : 0.0f;
}

void GpuLightGrid::clear_lights() noexcept {
    // Статики: интенсивность в ноль (надгробие по умолчанию — живые лампы
    // перепишут её в этом же кадре), позиция/радиус/цвет стоят как испечены.
    for (uint32_t i = 0; i < staticCount_; ++i) {
        stagingLights_[i].colorIntensity.w = 0.0f;
    }
    dynamicCount_ = 0;
    overflowDropped_ = 0;
}

void GpuLightGrid::add_light(const vec3& pos, float radius, const vec3& color, float intensity) noexcept {
    if (radius <= 0.0f || intensity <= kTombstoneIntensity) return;
    if (staticCount_ + dynamicCount_ >= kRootLights) {
        ++overflowDropped_; // считаем, не молчим — GIGA_LIGHT_DBG покажет
        return;
    }

    GpuPointLight& pt = stagingLights_[staticCount_ + dynamicCount_++];
    pt.posRadius = vec4{pos.x, pos.y, pos.z, radius};
    pt.colorIntensity = vec4{color.x, color.y, color.z, intensity};
    // w = -2: сентинель «омни». Нулевой w означал бы конус 90° — молчаливый баг.
    pt.dirCone = vec4{0.0f, 0.0f, 1.0f, -2.0f};
}

void GpuLightGrid::add_light(const vec3& pos, float radius, const vec3& color, float intensity,
                             const vec3& dir, float cosOuter) noexcept {
    if (radius <= 0.0f || intensity <= kTombstoneIntensity) return;
    if (staticCount_ + dynamicCount_ >= kRootLights) {
        ++overflowDropped_;
        return;
    }

    GpuPointLight& pt = stagingLights_[staticCount_ + dynamicCount_++];
    pt.posRadius = vec4{pos.x, pos.y, pos.z, radius};
    pt.colorIntensity = vec4{color.x, color.y, color.z, intensity};
    const float len = std::sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    const float inv = len > 1e-6f ? 1.0f / len : 0.0f;
    pt.dirCone = vec4{dir.x * inv, dir.y * inv, dir.z * inv, cosOuter};
}

void GpuLightGrid::upload_baked_grid(const uint32_t* cells, std::size_t words,
                                     uint32_t bakedGen) noexcept {
    if (!bakedMapped_ || cells == nullptr) return;
    constexpr std::size_t kExpect =
        static_cast<std::size_t>(kTotalGridCells) * (kGridCellSlots + 1);
    if (words != kExpect) {
        // Лейаут разъехался — вслух, и старый bakedGrid продолжает жить
        // (консервативно: устаревший список лучше рваного).
        std::fprintf(stderr,
                     "[light-grid] baked grid layout mismatch: %zu words, "
                     "expected %zu — swap refused\n",
                     words, kExpect);
        return;
    }
    std::memcpy(bakedMapped_, cells, words * sizeof(uint32_t));
    bakedGen_ = bakedGen;
    bakedUploadPending_ = true;
    bakedRegions_.clear(); // полная копия кроет любые частичные диапазоны
}

void GpuLightGrid::upload_baked_cells(const uint32_t* cells, std::size_t words,
                                      const uint32_t* changed,
                                      std::size_t nChanged,
                                      uint32_t bakedGen) noexcept {
    if (!bakedMapped_ || cells == nullptr) return;
    constexpr std::size_t kExpect =
        static_cast<std::size_t>(kTotalGridCells) * (kGridCellSlots + 1);
    if (words != kExpect) {
        std::fprintf(stderr,
                     "[light-grid] baked cells layout mismatch: %zu words, "
                     "expected %zu — patch refused\n",
                     words, kExpect);
        return;
    }
    // Ген — CPU-бухгалтерия поколений бейка (rebake); шейдер его больше не
    // получает (лейна genBaked умерла с грязной веткой, чистка 2026-08-23).
    bakedGen_ = bakedGen;
    if (bakedUploadPending_) return; // полная заливка того же кадра главнее
    constexpr VkDeviceSize kCellBytes = sizeof(GpuGridCell);
    for (std::size_t i = 0; i < nChanged; ++i) {
        const uint32_t cell = changed[i];
        if (cell >= kTotalGridCells) continue;
        const VkDeviceSize off = static_cast<VkDeviceSize>(cell) * kCellBytes;
        std::memcpy(static_cast<char*>(bakedMapped_) + off,
                    cells + static_cast<std::size_t>(cell) *
                                (kGridCellSlots + 1),
                    kCellBytes);
        // Смежные клетки (список отсортирован) склеиваются в один регион.
        if (!bakedRegions_.empty() &&
            bakedRegions_.back().srcOffset + bakedRegions_.back().size == off) {
            bakedRegions_.back().size += kCellBytes;
        } else {
            VkBufferCopy r{};
            r.srcOffset = off;
            r.dstOffset = off;
            r.size = kCellBytes;
            bakedRegions_.push_back(r);
        }
    }
}

void GpuLightGrid::update_and_dispatch(VkCommandBuffer cmd) noexcept {
    if (!ready() || !lightMapped_) return;

    // Свап бейка видимости: копия стейджинг -> device-local, вне рендер-пасса
    // (мы и так вне его — контракт этого метода). Барьер TRANSFER->COMPUTE
    // ставится тут же; каденция — секунды, полоса копейки.
    if (bakedUploadPending_) {
        bakedUploadPending_ = false;
        VkBufferCopy region{};
        region.size = static_cast<VkDeviceSize>(kTotalGridCells) * sizeof(GpuGridCell);
        vkCmdCopyBuffer(cmd, bakedStaging_.buffer, bakedGrid_.buffer, 1, &region);
        VkBufferMemoryBarrier copyBarrier{};
        copyBarrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        copyBarrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        copyBarrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        copyBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        copyBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        copyBarrier.buffer = bakedGrid_.buffer;
        copyBarrier.offset = 0;
        copyBarrier.size = VK_WHOLE_SIZE;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, nullptr,
                             1, &copyBarrier, 0, nullptr);
    } else if (!bakedRegions_.empty()) {
        // Частичный свап (дельта-патч): те же стейджинг и барьер, но копия —
        // только изменённые диапазоны (сотни клеток × 256 Б против 64 МиБ).
        vkCmdCopyBuffer(cmd, bakedStaging_.buffer, bakedGrid_.buffer,
                        static_cast<uint32_t>(bakedRegions_.size()),
                        bakedRegions_.data());
        bakedRegions_.clear();
        VkBufferMemoryBarrier copyBarrier{};
        copyBarrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        copyBarrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        copyBarrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        copyBarrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        copyBarrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        copyBarrier.buffer = bakedGrid_.buffer;
        copyBarrier.offset = 0;
        copyBarrier.size = VK_WHOLE_SIZE;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, nullptr,
                             1, &copyBarrier, 0, nullptr);
    }

    // На GPU едет ВСЯ таблица: статики [0..staticCount) со стабильными id
    // (кандидатов клетке даёт бейк видимости + дистанционный фолбэк грязных
    // клеток) + динамический хвост. Камерный сорт и кап 512 мертвы (S7).
    const uint32_t uploadCount = staticCount_ + dynamicCount_;

    // Переливы клеток светосетки: light_grid.comp атомарно копит в слове 1
    // заголовка число клеток, где достижимых ламп оказалось больше
    // kGridCellSlots (хвост вытеснен по вкладу top-K). Буфер host-visible и
    // persistent-mapped — читаем значение ПРОШЛОГО завершённого кадра до
    // перезаписи заголовка (свежее ещё пишется GPU; для счётчика диагностики
    // лаг в кадр честен) и печатаем раз в кадр при ненулевом: перелив теперь
    // виден, как overflowDropped_, — молча не режем (закон S11).
    std::memcpy(&cellOverflow_, static_cast<const char*>(lightMapped_) + sizeof(uint32_t),
                sizeof(cellOverflow_));
    if (cellOverflow_ != 0) {
        std::fprintf(stderr,
                     "[light-grid] cell overflow: %u cells saw > %u reachable "
                     "lights (kept top-%u by contribution)\n",
                     cellOverflow_, kGridCellSlots, kGridCellSlots);
    }

    // Слово 3 — переопределение бюджета теневых лучей surface_light
    // (0 = авто-ступени 4/2/1 по дистанции). GIGA_SHADOW_RAYS=N —
    // измерительная ручка: цена теней добывается вычитанием.
    static const uint32_t kSurfaceRayOverride = [] {
        const char* e = std::getenv("GIGA_SHADOW_RAYS");
        if (!e) return 0u;
        const long v = std::atol(e);
        return static_cast<uint32_t>(std::clamp<long>(v, 0, kGridCellSlots));
    }();
    uint32_t header[4] = {uploadCount, 0, 0, kSurfaceRayOverride};
    std::memcpy(lightMapped_, header, sizeof(header));
    if (uploadCount > 0) {
        std::memcpy(static_cast<char*>(lightMapped_) + 16, stagingLights_.data(),
                    uploadCount * sizeof(GpuPointLight));
    }

    // Сплат динамиков по бакетам (59.14): каждый динамик ложится id-шником
    // во все бакеты, которых касается его сфера (тор: отрицательный индекс
    // оборачивается битовым И — степень двойки). Переполненный бакет
    // помечается фоллбэком «сканируй весь хвост»: свет не теряется по
    // построению, теряется только выигрыш — и это видно строкой (S11).
    if (dynBucketsMapped_ != nullptr) {
        constexpr uint32_t stride = 1u + kDynBucketSlots;
        for (uint32_t b = 0; b < kDynBucketCount; ++b)
            dynBucketsMapped_[b * stride] = 0u;
        const float bucketM = kWorldExtent / static_cast<float>(kDynBucketDim);
        uint32_t overflowed = 0;
        for (uint32_t i = staticCount_; i < uploadCount; ++i) {
            const vec4 pr = stagingLights_[i].posRadius;
            if (pr.w <= 0.0f) continue;
            const float p[3] = {pr.x, pr.y, pr.z};
            int lo[3], span[3];
            for (int a = 0; a < 3; ++a) {
                lo[a] = static_cast<int>(std::floor((p[a] - pr.w) / bucketM));
                const int hi =
                    static_cast<int>(std::floor((p[a] + pr.w) / bucketM));
                span[a] = hi - lo[a] + 1;
                if (span[a] > static_cast<int>(kDynBucketDim))
                    span[a] = static_cast<int>(kDynBucketDim);
            }
            for (int dz = 0; dz < span[2]; ++dz)
                for (int dy = 0; dy < span[1]; ++dy)
                    for (int dx = 0; dx < span[0]; ++dx) {
                        const uint32_t bx =
                            static_cast<uint32_t>(lo[0] + dx) &
                            (kDynBucketDim - 1u);
                        const uint32_t by =
                            static_cast<uint32_t>(lo[1] + dy) &
                            (kDynBucketDim - 1u);
                        const uint32_t bz =
                            static_cast<uint32_t>(lo[2] + dz) &
                            (kDynBucketDim - 1u);
                        const uint32_t base =
                            (bx + by * kDynBucketDim +
                             bz * kDynBucketDim * kDynBucketDim) *
                            stride;
                        const uint32_t cnt = dynBucketsMapped_[base];
                        if (cnt == kDynBucketFallback) continue;
                        if (cnt >= kDynBucketSlots) {
                            dynBucketsMapped_[base] = kDynBucketFallback;
                            ++overflowed;
                            continue;
                        }
                        dynBucketsMapped_[base + 1 + cnt] = i;
                        dynBucketsMapped_[base] = cnt + 1u;
                    }
        }
        if (overflowed != 0 && (dynBucketOverflowFrames_++ % 300u) == 0u) {
            std::fprintf(stderr,
                         "[light-grid] dyn bucket overflow: %u buckets fell "
                         "back to full-tail scan (slots %u)\n",
                         overflowed, kDynBucketSlots);
        }
    }

    // World-aligned: сетка — весь тор, начало в нуле мира, камера ни при чём.
    // Врап у потребителей — битовое И индекса; «вне сетки» не существует.
    GridPush push{};
    push.gridMin = vec4{0.0f, 0.0f, 0.0f, kGridCellMeters};
    push.gridExt = vec4{static_cast<float>(kGridDimX), static_cast<float>(kGridDimY),
                        static_cast<float>(kGridDimZ), kGridCellMeters};
    // params.w carries the TORUS WRAP PERIOD. It used to be a spare 0 while the
    // shader wrapped against a hardcoded `128.0` — half the real 256 m extent, and
    // only on x and z. The literal itself turned out to be harmless (128 divides
    // 256, and `collect_scene_lights` culls every light past 48 m before it ever
    // reaches this buffer), but the MISSING Y WRAP was not: a lamp two metres away
    // across the y seam reads as ~254 m, falls outside the grid box and is never
    // binned at all, so the fog goes dark exactly where it should glow. Sending the
    // period makes the shader's period unfalsifiable by construction — the same
    // rule [problems.md] §7 wrote after the phantom-lamp hunt.
    push.params = vec4{static_cast<float>(uploadCount), kWorldExtent,
                       0.0f, 0.0f};
    push.genStaticCount = staticCount_;
    push.dynBucketDim = kDynBucketDim;
    push.dynBucketSlots = kDynBucketSlots;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, computePipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelineLayout_, 0, 1, &descriptorSet_, 0, nullptr);
    vkCmdPushConstants(cmd, pipelineLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(GridPush), &push);

    // Workgroup size: (8, 4, 8) -> Dispatch (64/8, 64/4, 64/8) = (8, 16, 8)
    vkCmdDispatch(cmd, kGridDimX / 8, kGridDimY / 4, kGridDimZ / 8);

    // Insert VkBufferMemoryBarrier: COMPUTE SHADER WRITE -> FRAGMENT SHADER READ
    VkBufferMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
    barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.buffer = gridSSBO_.buffer;
    barrier.offset = 0;
    barrier.size = VK_WHOLE_SIZE;

    vkCmdPipelineBarrier(
        cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
        0,
        0, nullptr,
        1, &barrier,
        0, nullptr
    );
}

void GpuLightGrid::destroy() noexcept {
    if (!dev_ || dev_->device == VK_NULL_HANDLE) return;
    VkDevice d = dev_->device;

    if (computePipeline_) { vkDestroyPipeline(d, computePipeline_, nullptr); computePipeline_ = VK_NULL_HANDLE; }
    if (pipelineLayout_)  { vkDestroyPipelineLayout(d, pipelineLayout_, nullptr); pipelineLayout_ = VK_NULL_HANDLE; }
    if (descPool_)        { vkDestroyDescriptorPool(d, descPool_, nullptr); descPool_ = VK_NULL_HANDLE; }
    if (descriptorSetLayout_) { vkDestroyDescriptorSetLayout(d, descriptorSetLayout_, nullptr); descriptorSetLayout_ = VK_NULL_HANDLE; }

    lightBuf_.destroy(*dev_);
    gridSSBO_.destroy(*dev_);
    bakedGrid_.destroy(*dev_);
    bakedStaging_.destroy(*dev_);
    dynBuckets_.destroy(*dev_);
    dynBucketsMapped_ = nullptr;
    lightMapped_ = nullptr;
    bakedMapped_ = nullptr;
    dev_ = nullptr;
}

} // namespace giga::gpu
