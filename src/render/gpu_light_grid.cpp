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
    sortScratch_.resize(kRootLights);
    sortKeys_.resize(kRootLights);

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
                 "upload cap %u lights)\n",
                 kGridDimX, kGridDimY, kGridDimZ, kGridCellBytes, kGridCellSlots,
                 kMaxPointLights);
    return true;
}

bool GpuLightGrid::create_buffers() noexcept {
    // 16 bytes header (uPointLightCount + 3 reserved uints) + 512 * 48 B PointLight
    constexpr VkDeviceSize kLightBufSize = 16 + kMaxPointLights * sizeof(GpuPointLight);
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

    return true;
}

bool GpuLightGrid::create_descriptor_sets() noexcept {
    VkDevice d = dev_->device;

    // Binding 0: PointLightBuffer (Set 0)
    // Binding 1: LightGridBuffer (Set 0)
    VkDescriptorSetLayoutBinding bindings[2]{};
    bindings[0].binding = 0;
    bindings[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[0].descriptorCount = 1;
    bindings[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;

    bindings[1].binding = 1;
    bindings[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[1].descriptorCount = 1;
    bindings[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT;

    VkDescriptorSetLayoutCreateInfo dslci{};
    dslci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslci.bindingCount = 2;
    dslci.pBindings = bindings;
    VK_TRY(vkCreateDescriptorSetLayout(d, &dslci, nullptr, &descriptorSetLayout_));

    // Pool
    VkDescriptorPoolSize poolSize{};
    poolSize.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSize.descriptorCount = 2;

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
    VkDescriptorBufferInfo bufi[2]{};
    bufi[0].buffer = lightBuf_.buffer;
    bufi[0].offset = 0;
    bufi[0].range = VK_WHOLE_SIZE;

    bufi[1].buffer = gridSSBO_.buffer;
    bufi[1].offset = 0;
    bufi[1].range = VK_WHOLE_SIZE;

    VkWriteDescriptorSet writes[2]{};
    for (uint32_t i = 0; i < 2; ++i) {
        writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet = descriptorSet_;
        writes[i].dstBinding = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[i].pBufferInfo = &bufi[i];
    }
    vkUpdateDescriptorSets(d, 2, writes, 0, nullptr);
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
    if (radius <= 0.0f || intensity <= 0.001f) return;
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
    if (radius <= 0.0f || intensity <= 0.001f) return;
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

void GpuLightGrid::sort_lights_by_distance(const vec3& camPos) noexcept {
    // Статики НЕ переупорядочиваются (слот-id стабильны для бейка видимости):
    // сорт строит ключи по обеим секциям, но пишет копию в sortScratch_, и на
    // GPU едет она. Потухшие лампы (интенсивность-надгробие) в ключи не
    // попадают — как раньше не попадали в стейджинг.
    uint32_t n = 0;
    const uint32_t total = staticCount_ + dynamicCount_;
    for (uint32_t i = 0; i < total; ++i) {
        if (stagingLights_[i].colorIntensity.w <= 0.001f) continue;
        const vec4& p = stagingLights_[i].posRadius;
        const float dx = wrap_delta_f(camPos.x, p.x, kWorldExtent);
        const float dy = wrap_delta_f(camPos.y, p.y, kWorldExtent);
        const float dz = wrap_delta_f(camPos.z, p.z, kWorldExtent);
        sortKeys_[n++] = { dx * dx + dy * dy + dz * dz, i };
    }
    std::sort(sortKeys_.begin(), sortKeys_.begin() + n);
    for (uint32_t i = 0; i < n; ++i) {
        sortScratch_[i] = stagingLights_[sortKeys_[i].second];
    }
    sortedCount_ = n;
}

void GpuLightGrid::update_and_dispatch(VkCommandBuffer cmd, float timeSec, const vec3& camPos) noexcept {
    if (!ready() || !lightMapped_) return;

    // Sort active point lights by distance to camera so nearest lights take priority
    sort_lights_by_distance(camPos);

    // На GPU едут БЛИЖАЙШИЕ kMaxPointLights (стейджинг уже отсортирован по
    // дистанции) — лишними остаются только самые дальние, они за туманом.
    //
    // GIGA_LIGHT_BUDGET=N — A/B-ручка ТОЛЬКО ДЛЯ ЗАМЕРА (перф-кривая
    // ФПС-регрессии 2026-08-18: сколько миллисекунд кадра стоят марши к
    // лампам). Ужимает аплоад до N ближайших; буфер и дефолт не меняются.
    // Ручка того же класса, что GIGA_GPU_TIMER=0: инструмент обязан уметь
    // измерить сам себя, число без A/B — мнение.
    static const uint32_t kBudgetCap = [] {
        const char* e = std::getenv("GIGA_LIGHT_BUDGET");
        const long v = e ? std::atol(e) : 0;
        return (v > 0 && v <= static_cast<long>(kMaxPointLights))
                   ? static_cast<uint32_t>(v)
                   : kMaxPointLights;
    }();
    const uint32_t uploadCount = std::min(sortedCount_, kBudgetCap);

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

    uint32_t header[4] = {uploadCount, 0, 0, 0};
    std::memcpy(lightMapped_, header, sizeof(header));
    if (uploadCount > 0) {
        std::memcpy(static_cast<char*>(lightMapped_) + 16, sortScratch_.data(),
                    uploadCount * sizeof(GpuPointLight));
    }

    // World-aligned: сетка — весь тор, начало в нуле мира, камера ни при чём.
    // Врап у потребителей — битовое И индекса; «вне сетки» не существует.
    GridPush push{};
    push.camPos = vec4{camPos.x, camPos.y, camPos.z, 0.0f};
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
    push.params = vec4{timeSec, static_cast<float>(kGridCellSlots),
                       static_cast<float>(uploadCount), kWorldExtent};

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
    lightMapped_ = nullptr;
    dev_ = nullptr;
}

} // namespace giga::gpu
