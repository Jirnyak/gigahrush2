// Мир-автомат (S16) — headless GPU-тесты. CANON S16.3: headless = «без окна»,
// НЕ «без GPU» — автомат обязан гоняться в ctest через Vulkan compute без
// свапчейна. Этот бинарь — тот самый прогон: init_headless() поднимает
// устройство по одной compute-семье, и вся буферная машинерия (staging через
// graphicsQueue) работает без правок.
//
// Сегодня здесь смоук обратного пути CPU→GPU→CPU (фундамент инкремента 3:
// осевшие брики текут назад байт-копией). Тесты самого правила автомата
// (масса сохраняется, вода находит уровень) добавляются в этот же бинарь
// инкрементом 2.
//
// Нет GPU-устройства — тест ПАДАЕТ, не скипается: GPU — осознанная часть
// ядра мира (решение владельца 2026-08-21), дерево без него не зелёное.
#include <cstdio>
#include <cstring>
#include <vector>

#include "render/vk_device.h"
#include "render/vk_buffer.h"

using namespace giga;

namespace {
int g_fails = 0;
int g_checks = 0;
}

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__,       \
                         #cond);                                               \
        }                                                                      \
    } while (0)

namespace {

// GPU→CPU ридбек device-local буфера отдельной командой — ровно тот шов,
// которым осевший брик вернётся в CPU-канон (инкремент 3).
bool readback(const gpu::VulkanDevice& dev, VkBuffer src, VkDeviceSize bytes,
              void* out) {
    gpu::VulkanBuffer host;
    if (!host.create_host_visible(dev, bytes,
                                  VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                                  "medium-test readback"))
        return false;

    VkCommandPool pool = VK_NULL_HANDLE;
    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    pci.queueFamilyIndex = dev.families.graphics;
    bool ok = vkCreateCommandPool(dev.device, &pci, nullptr, &pool) == VK_SUCCESS;
    if (ok) {
        VkCommandBufferAllocateInfo ai{};
        ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        ai.commandPool = pool;
        ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        ai.commandBufferCount = 1;
        VkCommandBuffer cmd = VK_NULL_HANDLE;
        ok = vkAllocateCommandBuffers(dev.device, &ai, &cmd) == VK_SUCCESS;
        if (ok) {
            VkCommandBufferBeginInfo bi{};
            bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
            bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
            vkBeginCommandBuffer(cmd, &bi);
            VkBufferCopy region{0, 0, bytes};
            vkCmdCopyBuffer(cmd, src, host.buffer, 1, &region);
            vkEndCommandBuffer(cmd);
            VkSubmitInfo si{};
            si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
            si.commandBufferCount = 1;
            si.pCommandBuffers = &cmd;
            ok = vkQueueSubmit(dev.graphicsQueue, 1, &si, VK_NULL_HANDLE)
                     == VK_SUCCESS
                 && vkQueueWaitIdle(dev.graphicsQueue) == VK_SUCCESS;
        }
    }
    if (ok) std::memcpy(out, host.mapped, bytes);
    if (pool) vkDestroyCommandPool(dev.device, pool, nullptr);
    host.destroy(dev);
    return ok;
}

void test_headless_roundtrip(const gpu::VulkanDevice& dev) {
    // Паттерн, ломающийся от любого сдвига/обрезания: не константа и не нули.
    constexpr std::size_t kWords = 4096;
    std::vector<std::uint32_t> src(kWords);
    for (std::size_t i = 0; i < kWords; ++i)
        src[i] = static_cast<std::uint32_t>(i * 2654435761u);

    // CPU→GPU тем же путём, что VoxelMirror: staging в device-local.
    gpu::VulkanBuffer devBuf;
    CHECK(devBuf.create_device_local(
        dev, src.data(), src.size() * sizeof(src[0]),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
        "medium-test device-local"));

    // GPU→CPU назад и побайтное сравнение.
    std::vector<std::uint32_t> back(kWords, 0);
    CHECK(readback(dev, devBuf.buffer, src.size() * sizeof(src[0]), back.data()));
    CHECK(std::memcmp(src.data(), back.data(), src.size() * sizeof(src[0])) == 0);

    devBuf.destroy(dev);
}

} // namespace

int main() {
    gpu::VulkanDevice dev;
    CHECK(dev.init_headless(false));
    if (dev.device != VK_NULL_HANDLE) {
        CHECK(dev.families.graphics != UINT32_MAX);
        CHECK(dev.graphicsQueue != VK_NULL_HANDLE);
        test_headless_roundtrip(dev);
    }
    dev.destroy();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    return g_fails == 0 ? 0 : 1;
}
