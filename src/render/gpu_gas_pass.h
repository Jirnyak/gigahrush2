#pragma once

#include <cstdint>
#include <vulkan/vulkan.h>
#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_common.h"
#include "render/vk_device.h"
#include "world/types.h"
#include "world/gravity.h"

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4324) // structure was padded due to alignment specifier
#endif

namespace giga::gpu {

// Matches Push in shaders/gas_sim.comp
struct alignas(16) GasPush {
    ivec4 downStep;   // xyz = regime_down vector, w = unused
    vec4  params;     // x = diffusionRate, y = buoyancy, z = unused, w = dt
    ivec4 probeCoord; // xyz = player macro cell pos, w = probe enabled
};
static_assert(sizeof(GasPush) == 48, "GasPush layout must be 48 bytes");

class GpuGasPass {
public:
    GpuGasPass() = default;
    ~GpuGasPass() { destroy(); }

    GpuGasPass(const GpuGasPass&) = delete;
    GpuGasPass& operator=(const GpuGasPass&) = delete;

    bool init(VulkanDevice* dev, const char* shaderDir, VkBuffer classBuffer);
    void destroy() noexcept;

    // Advance GPU gas simulation step (ping-pongs buffers)
    void record_sim(VkCommandBuffer cmd, const CellStep& downStep, float dt,
                    float diffusionRate = 0.15f, float buoyancy = 0.40f) noexcept;

    VkBuffer current_gas_buffer() const noexcept {
        return gasSSBO_[readIndex_].buffer;
    }

    // ИСТОЧНИК: залить CPU-поле kGasField (float 0..1 на клетку — засев шахт
    // из padic_gen) в toxic-канал ОБОИХ буферов, oxy = 255, остальное 0.
    // Зовётся при входе на этаж, тем же контрактом, что
    // diffusion_driver_on_floor_built: рециклированный слот не должен держать
    // газ ушедшего этажа. nullptr = чистая атмосфера.
    void upload_field(const float* toxic01) noexcept;

    // ЧИТАТЕЛЬ: упакованная клетка (toxic|smoke<<8|oxy<<16|heat<<24) из
    // читаемого буфера. Чтение через probeBuffer без CPU/GPU stalls.
    std::uint32_t sample_cell(int x, int y, int z) const noexcept;

    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

private:
    bool create_buffers() noexcept;
    bool create_descriptors(VkBuffer classBuffer) noexcept;
    bool create_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer gasSSBO_[2]{};  // Fast DEVICE_LOCAL ping-pong VRAM buffers (16 MiB each)
    VulkanBuffer stagingBuf_{};  // Host-visible upload staging buffer (16 MiB)
    VulkanBuffer probeBuffer_{}; // Host-visible probe readback buffer (64 bytes)
    uint32_t readIndex_ = 0;
    bool uploadDirty_ = false;

    mutable ivec4 probeCoord_{0, 0, 0, 0};

    VkDescriptorSetLayout descSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descSets_[2]{}; // [0]: In=SSBO[0], Out=SSBO[1]; [1]: In=SSBO[1], Out=SSBO[0]

    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu

#ifdef _MSC_VER
#pragma warning(pop)
#endif
