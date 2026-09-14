// Vulkan instance + surface + logical device bring-up (SDL3 window surface,
// MoltenVK portability on macOS). Owns the objects every later stage needs.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

struct SDL_Window;

namespace giga::gpu {

struct QueueFamilies {
    std::uint32_t graphics = UINT32_MAX;
    std::uint32_t present = UINT32_MAX;
    bool complete() const {
        return graphics != UINT32_MAX && present != UINT32_MAX;
    }
};

struct VulkanDevice {
    VkInstance instance = VK_NULL_HANDLE;
    VkDebugUtilsMessengerEXT debug = VK_NULL_HANDLE;
    VkSurfaceKHR surface = VK_NULL_HANDLE;
    VkPhysicalDevice physical = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue graphicsQueue = VK_NULL_HANDLE;
    VkQueue presentQueue = VK_NULL_HANDLE;
    QueueFamilies families;
    VkPhysicalDeviceProperties props{};
    // Timestamp counter width of the GRAPHICS family, from
    // VkQueueFamilyProperties. 0 means that family cannot write timestamps at
    // all, which is legal and happens on real drivers — it is the authoritative
    // per-queue answer, where limits.timestampComputeAndGraphics only says
    // whether every graphics+compute family agrees. Fewer than 64 bits is
    // common; the high bits are undefined and must be masked off.
    std::uint32_t graphicsTimestampValidBits = 0;
    bool validation = false;
    // VK_EXT_memory_budget включено на устройстве (если оно его умеет). Даёт
    // взгляд ДРАЙВЕРА на кучу: сколько он готов нам отдать и сколько уже
    // занято всеми вместе. Своей суммы аллокаций для вопроса «влезли ли мы в
    // VRAM» мало — соседние процессы и сам композитор тоже там живут.
    bool memoryBudget = false;

    // window must have been created with SDL_WINDOW_VULKAN.
    bool init(SDL_Window* window, bool enableValidation);

    // Безоконный bring-up (CANON S16.3: headless = «без окна», НЕ «без GPU»).
    // Ни SDL-инициализации, ни surface, ни требования swapchain: расширения
    // инстанса перечисляются напрямую (портабилити на macOS), физустройство
    // выбирается по одной compute-способной семье, present-поля алиасят её —
    // так вся существующая машинерия (VulkanBuffer staging через
    // graphicsQueue, VoxelMirror, compute-пассы) работает без правок.
    // Потребители: ctest-прогоны мир-автомата и любой будущий headless-режим.
    bool init_headless(bool enableValidation);

    void destroy();

    VulkanDevice() = default;
    VulkanDevice(const VulkanDevice&) = delete;
    VulkanDevice& operator=(const VulkanDevice&) = delete;
};

// ОТЧЁТ О МАШИНЕ — одним блоком в stderr (а под --prof, значит, в файл).
//
// Зачем: сборка под винду даёт 10 fps там, где мак даёт 40, и первый вопрос
// такого разрыва — не «какой пасс дорогой», а «влезли ли мы в видеопамять».
// Пул страниц резидентен на 4 ГиБ: на едином поле Apple это ничего не стоит,
// на дискретной карте не влезший пул драйвер возит через PCIe, и это ровно
// такой порядок разницы. Ответ даёт ПАРА чисел, которой поодиночке нет ни у
// кого: размеры куч устройства (+ бюджет драйвера, если карта умеет
// VK_EXT_memory_budget) против нашей собственной суммы аллокаций
// ([vk_buffer.h] mem_tally).
//
// Зовётся ДВАЖДЫ: после подъёма всех пассов (сумма уже полная) и на выходе
// (что выросло за сессию). Между ними всё меняет только карв.
void write_device_report(const VulkanDevice& dev, const char* when);

} // namespace giga::gpu
