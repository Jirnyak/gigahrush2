// GPU buffers for the cube renderer.
//
// Two flavours:
//   - device-local: uploaded once from CPU data via a staging copy (the static
//     cube mesh). Never touch per frame.
//   - host-visible dynamic: persistently mapped, rewritten every frame (the
//     per-instance array of visible voxels). Cheap to update, no staging.
#pragma once

#include <vulkan/vulkan.h>

#include <cstddef>
#include <cstdint>

namespace giga::gpu {

struct VulkanDevice;

// ---- Учёт выделенной видеопамяти ------------------------------------------
// Строка [vk-mem] на каждую аллокацию уже печатается, и её достаточно, пока
// вопрос «куда легло», а не «сколько всего». Вопрос «сколько всего» задаёт
// винда: там 10 fps против 40 на маке, а мы держим резидентным пул страниц в
// 4 ГиБ. На едином поле Apple это ничего не стоит, на дискретной карте пул,
// не влезший в VRAM, драйвер возит через PCIe — и это ровно такая разница в
// кадре. Поэтому сумма и крупнейшие потребители печатаются РЯДОМ с размерами
// куч устройства: одно число ни о чём не говорит, пара «просим/есть» говорит
// всё. Счётчик — здесь, потому что здесь вызывается vkAllocateMemory; отчёт
// собирает vk_device.cpp.
//
// Образы (текстуры, глубина, полурезный свет) выделяются своими
// vkAllocateMemory мимо make_buffer, поэтому каждый такой вызов зовёт
// mem_tally() сам. Пропустишь вызов — сумма молча занизится, и это худший
// класс дефекта у прибора, поэтому список вызывающих держим коротким.
void mem_tally(const char* label, VkDeviceSize bytes);

// Имя КОПИРУЕТСЯ, а не хранится указателем — это не перестраховка, это
// пойманный дефект: prop_pass.cpp собирает метку в СТЕКОВОМ char label[] и
// отдаёт указатель на неё. Существующему логу [vk-mem] всё равно, он печатает
// в тот же миг; таблица же переживает вызов, и в первом прогоне отчёт показал
// строку с именем «d» на 24 МиБ — остаток протухшего кадра стека. Прибор,
// врущий в именах, ровно настолько же способен врать в числах.
struct MemTallyEntry {
    char label[48];
    VkDeviceSize bytes;
};
// Снимок для отчёта: заполняет до `cap` записей, отсортированных по убыванию
// размера, возвращает сколько записал; общая сумма — в *totalOut.
std::size_t mem_tally_snapshot(MemTallyEntry* out, std::size_t cap,
                               VkDeviceSize* totalOut);

struct VulkanBuffer {
    VkBuffer buffer = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VkDeviceSize size = 0;
    void* mapped = nullptr; // non-null for host-visible dynamic buffers

    // `label` names the buffer in the one-line placement log each allocation
    // emits at boot ("[vk-mem] <label>: N MiB -> type T heap H ..."). It is
    // DEFAULTED, not required, so existing call sites need no edit — but pass a
    // real name when you add one. The cube pass alone pins 128 MiB of
    // host-visible memory across its two frame slots and, until that log existed,
    // nothing said whether it landed in system RAM or in the VRAM BAR. An
    // unnamed 64 MiB line is still readable by size; two unnamed ones are not.

    // One-time DEVICE_LOCAL upload (adds TRANSFER_DST to usage).
    bool create_device_local(const VulkanDevice& dev, const void* data,
                             VkDeviceSize bytes, VkBufferUsageFlags usage,
                             const char* label = "device-local buffer");

    // DEVICE_LOCAL buffer with no initial contents — for mirrors filled by
    // their own staging paths (render/voxel_mirror.h). Caller supplies the
    // full usage set (transfer bits included); nothing is implied.
    bool create_device_local_empty(const VulkanDevice& dev, VkDeviceSize bytes,
                                   VkBufferUsageFlags usage,
                                   const char* label = "device-local buffer");

    // Persistently-mapped HOST_VISIBLE|HOST_COHERENT buffer of `bytes`.
    bool create_host_visible(const VulkanDevice& dev, VkDeviceSize bytes,
                             VkBufferUsageFlags usage,
                             const char* label = "host-visible buffer");

    void destroy(const VulkanDevice& dev);
};

} // namespace giga::gpu
