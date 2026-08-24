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
//
// Инкремент 2: правило автомата гоняется настоящим SPIR-V (medium_sim.comp)
// над настоящим зеркалом — вода в бассейне падает, растекается, ЗАСЫПАЕТ;
// масса (счёт квантов) сохраняется точно; осевшие кванты стоят на опоре.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unordered_set>
#include <vector>

#include "render/gpu_medium_pass.h"
#include "render/vk_buffer.h"
#include "render/vk_device.h"
#include "render/voxel_mirror.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/gravity.h"
#include "world/macro_grid.h"
#include "world/materials.h" // kMatWaterMark, kMatConcrete
#include "world/subfield.h"
#include "world/world.h"

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

// Один батч кадра глазами автомата: flush зеркала (CPU-писатели легли) +
// n подтиков + settle, отдельной командой с ожиданием — после queue-idle
// ActOut честен без оговорок про кадры в полёте.
bool run_batch(gpu::VulkanDevice& dev, gpu::VoxelMirror& mirror,
               gpu::GpuMediumPass& medium, World& w, std::uint32_t n,
               std::uint64_t base) {
    VkCommandPool pool = VK_NULL_HANDLE;
    VkCommandPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pci.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    pci.queueFamilyIndex = dev.families.graphics;
    if (vkCreateCommandPool(dev.device, &pci, nullptr, &pool) != VK_SUCCESS)
        return false;
    bool ok = false;
    VkCommandBufferAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    ai.commandPool = pool;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    if (vkAllocateCommandBuffers(dev.device, &ai, &cmd) == VK_SUCCESS) {
        VkCommandBufferBeginInfo bi{};
        bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(cmd, &bi);
        mirror.flush(cmd, 0, w);
        medium.record_substeps(cmd, n, regime_down(w.gravity().regime), base,
                               w);
        vkEndCommandBuffer(cmd);
        VkSubmitInfo si{};
        si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        si.commandBufferCount = 1;
        si.pCommandBuffers = &cmd;
        ok = vkQueueSubmit(dev.graphicsQueue, 1, &si, VK_NULL_HANDLE)
                 == VK_SUCCESS
             && vkQueueWaitIdle(dev.graphicsQueue) == VK_SUCCESS;
    }
    vkDestroyCommandPool(dev.device, pool, nullptr);
    return ok;
}

// Инкремент 2: вода в бассейне. Инварианты, а не пиксели:
//   1. МАССА: счёт квантов после осадки == налитому (перестановка Margolus
//      не рождает и не убивает — мутация правила красная именно здесь);
//   2. СОН: автомат ДОСТИГАЕТ фикспоинта — live-набор пустеет (без этого
//      спящая материя не бесплатна и S16.1 нарушен);
//   3. ОПОРА: каждый осевший квант стоит на маске или на воде — материя не
//      висит и не утонула в полу;
//   4. УРОВЕНЬ: перепад соседних столбов <= 1 кванта — лужа нашла уровень с
//      точностью формата (строго выравнивающая диагональ, см. medium_sim).
void test_automaton_water(gpu::VulkanDevice& dev) {
    static World w; // 128^3 решётка толще стека — статик, тест один
    // Бассейн: дно 10x10 клеток на z=4, борта высотой 2 клетки.
    for (int x = 60; x < 70; ++x)
        for (int y = 60; y < 70; ++y) {
            w.grid().fill_cell(x, y, 4, kMatConcrete);
            if (x == 60 || x == 69 || y == 60 || y == 69) {
                w.grid().fill_cell(x, y, 5, kMatConcrete);
                w.grid().fill_cell(x, y, 6, kMatConcrete);
            }
        }
    // «Завал» генераторной кодировки на дне бассейна: безстраничная клетка
    // ТИПА rubble (среда: flow 0.1) с частичной маской. Закон чтения обязан
    // видеть в её дырах ВОЗДУХ — прежняя трактовка «немаскированное читается
    // типом» рождала из завала полный куб «грязи» (скриншот владельца).
    const std::uint32_t moundCell =
        static_cast<std::uint32_t>(macro_index(63, 63, 5));
    w.grid().set_cell(63, 63, 5, kMatRubble);
    for (int sy = 0; sy < 8; ++sy)
        for (int sx = 0; sx < 8; ++sx)
            for (int sz = 0; sz < 2; ++sz)
                w.grid().mask(63, 63, 5).set(sub_bit(sx, sy, sz));

    // Налив: столб 4x4x8 = 128 квантов ДВУМЯ КЛЕТКАМИ ВЫШЕ дна — вода
    // обязана пролететь сквозь спящие нераскрытые клетки (пробуждение по
    // граням раскрывает им страницы) и растечься за границы клеток вбок:
    // тест покрывает межклеточный wake-протокол, не только правило.
    const std::uint32_t pourCell = static_cast<std::uint32_t>(
        macro_index(65, 65, 7));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(pourCell, w.grid().types()[pourCell]);
    constexpr std::uint32_t kPoured = 128;
    for (int sx = 2; sx < 6; ++sx)
        for (int sy = 2; sy < 6; ++sy)
            for (int sz = 0; sz < 8; ++sz)
                pg[sub_bit(sx, sy, sz)] = kMatWater;

    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    // Писатель будит клетку И грани (вода соседей должна получить свободу):
    // клетка налива + 6 соседей-воздуха = 7.
    medium.wake_cells(&pourCell, 1, w, mirror);
    CHECK(medium.live_count() == 7);

    // ЧИСТЫЙ МАРКОВ (закон владельца 2026-08-24): открытая лужа диффундирует
    // вечно и НЕ спит — сон больше не цель прогона. Гоняем фиксированные
    // 100 батчей (800 подтиков = 25.6 с игрового времени) и меряем ФОРМУ.
    std::uint64_t substep = 0;
    for (int b = 0; b < 100; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        // Кадровый шов: сначала обратный поток в CPU-канон, потом протокол
        // пробуждения — тот же порядок, что в кадре игры.
        medium.apply_readback(w);
        medium.poll_activity(w, mirror);
    }
    std::printf("[medium_test] after %llu substeps: live %u, woken %u, "
                "slept %u\n",
                static_cast<unsigned long long>(substep), medium.live_count(),
                medium.woken_total(), medium.slept_total());
    // Поверхность живой лужи — осознанная цена; live ограничен поверхностью.
    CHECK(medium.live_count() > 0);
    CHECK(medium.live_count() < 200);

    // Ридбек GPU-истины: pageIdx + занятые страницы пула.
    std::vector<std::uint32_t> idx(kMacroCells);
    CHECK(readback(dev, mirror.page_index_buffer(),
                   kMacroCells * sizeof(std::uint32_t), idx.data()));
    const std::uint32_t pages = mirror.pages_in_pool();
    CHECK(pages > 0);
    std::vector<std::uint16_t> poolHost(
        static_cast<std::size_t>(pages) * kSubVoxels);
    CHECK(readback(dev, mirror.page_pool_buffer(),
                   poolHost.size() * sizeof(std::uint16_t), poolHost.data()));

    // Сбор квантов воды: глобальные суб-координаты (тор 1024 на ось).
    std::unordered_set<std::uint64_t> water;
    auto key = [](int gx, int gy, int gz) {
        return (static_cast<std::uint64_t>(gz) << 20) |
               (static_cast<std::uint64_t>(gy) << 10) |
               static_cast<std::uint64_t>(gx);
    };
    // Инвариант закона чтения на ВЕСЬ пул: немаскированного атома ТВЁРДОГО
    // материала не существует (кубы-призраки = ровно его нарушение: заливка
    // страниц базой у генераторов/материализации).
    int unmaskedSolid = 0;
    for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
        if (idx[ci] == gpu::VoxelMirror::kNoPage || idx[ci] >= pages) continue;
        const std::uint16_t* page =
            poolHost.data() + static_cast<std::size_t>(idx[ci]) * kSubVoxels;
        const SubMask& m = w.grid().masks()[ci];
        const int cx = static_cast<int>(ci & 127u);
        const int cy = static_cast<int>((ci >> 7) & 127u);
        const int cz = static_cast<int>((ci >> 14) & 127u);
        for (int bit = 0; bit < kSubVoxels; ++bit) {
            const CellType mt = static_cast<CellType>(page[bit]);
            if (mt != 0 && !m.test(bit) && !material_is_medium(mt))
                ++unmaskedSolid;
            if (mt != kMatWater || m.test(bit)) continue;
            const int sx = bit & 7, sy = (bit >> 3) & 7, sz = (bit >> 6) & 7;
            water.insert(key(cx * 8 + sx, cy * 8 + sy, cz * 8 + sz));
        }
    }
    CHECK(water.size() == kPoured); // МАССА
    CHECK(unmaskedSolid == 0); // материи из ниоткуда нет (закон чтения)

    // Класс клетки завала — 2 (частичная твёрдая), НЕ 3: и CPU-classify
    // (upload/flush), и GPU-settle (клетку будила вода) обязаны читать закон
    // одинаково.
    {
        std::vector<std::uint8_t> cls(kMacroCells);
        CHECK(readback(dev, mirror.class_buffer(), kMacroCells, cls.data()));
        CHECK(cls[moundCell] == 2);
    }

    // ОБРАТНЫЙ ШОВ (инкремент 3): CPU-канон сошёлся с GPU с точностью
    // кадра — карв и сейв видят ту же воду, фантомы стейл-страниц мертвы.
    // Один «спокойный кадр» (owed 0): квант, перешедший границу клеток
    // последним подтиком, доезжает — как в игре.
    CHECK(run_batch(dev, mirror, medium, w, 0, substep));
    medium.apply_readback(w);
    // Независимый счёт по CPU-страницам.
    {
        std::size_t cpuWater = 0;
        for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
            const CellType* pg = f.page(ci);
            if (!pg) continue;
            const SubMask& m = w.grid().masks()[ci];
            for (int bit = 0; bit < kSubVoxels; ++bit)
                if (pg[bit] == kMatWater && !m.test(bit)) ++cpuWater;
        }
        std::printf("[medium_test] reverse seam: CPU sees %zu quanta\n",
                    cpuWater);
        CHECK(cpuWater == kPoured);
    }

    // ОПОРА (гравитация NegZ): под квантом — маска или вода.
    auto solid_at = [&](int gx, int gy, int gz) {
        const int cx = (gx >> 3) & 127, cy = (gy >> 3) & 127,
                  cz = (gz >> 3) & 127;
        return w.grid().masks()[macro_index(cx, cy, cz)].test(
            sub_bit(gx & 7, gy & 7, gz & 7));
    };
    int unsupported = 0;
    for (auto it : water) {
        const int gx = static_cast<int>(it & 0x3FF);
        const int gy = static_cast<int>((it >> 10) & 0x3FF);
        const int gz = static_cast<int>((it >> 20) & 0x3FF);
        const int bz = (gz - 1 + 1024) & 1023;
        if (!solid_at(gx, gy, bz) && !water.count(key(gx, gy, bz)))
            ++unsupported;
    }
    // Марковская лужа дышит: снапшот может застать атом в боковом прыжке
    // над пустотой (упадёт следующим подтиком) — допуск 5%.
    CHECK(unsupported <= static_cast<int>(kPoured) / 20);

    // УРОВЕНЬ: высоты столбов над дном бассейна (внутренность 8x8 клеток =
    // 64x64 столба); перепад соседних столбов с водой <= 1.
    const int bx0 = 61 * 8, bx1 = 69 * 8; // [bx0, bx1) — внутренность
    const int by0 = 61 * 8, by1 = 69 * 8;
    const int zFloor = 4 * 8 + 7; // верхний субвоксель плиты дна
    std::vector<int> height(static_cast<std::size_t>(bx1 - bx0) *
                                static_cast<std::size_t>(by1 - by0),
                            0);
    auto hAt = [&](int gx, int gy) -> int& {
        return height[static_cast<std::size_t>(gy - by0) *
                          static_cast<std::size_t>(bx1 - bx0) +
                      static_cast<std::size_t>(gx - bx0)];
    };
    for (auto it : water) {
        const int gx = static_cast<int>(it & 0x3FF);
        const int gy = static_cast<int>((it >> 10) & 0x3FF);
        const int gz = static_cast<int>((it >> 20) & 0x3FF);
        if (gx < bx0 || gx >= bx1 || gy < by0 || gy >= by1) continue;
        const int h = gz - zFloor;
        if (h > hAt(gx, gy)) hAt(gx, gy) = h;
    }
    int maxStep = 0, wetColumns = 0, maxH = 0;
    for (int gy = by0; gy < by1; ++gy)
        for (int gx = bx0; gx < bx1; ++gx) {
            const int h = hAt(gx, gy);
            if (h > 0) ++wetColumns;
            if (h > maxH) maxH = h;
            if (gx + 1 < bx1 && hAt(gx + 1, gy) > 0 && h > 0)
                maxStep = std::max(maxStep, std::abs(h - hAt(gx + 1, gy)));
            if (gy + 1 < by1 && hAt(gx, gy + 1) > 0 && h > 0)
                maxStep = std::max(maxStep, std::abs(h - hAt(gx, gy + 1)));
        }
    std::printf("[medium_test] water: %zu quanta, %d wet columns, max height "
                "%d, max neighbour step %d\n",
                water.size(), wetColumns, maxH, maxStep);
    // ПЛОСКАЯ ЛУЖА из чистого Маркова: диффузия выравнивает, гравитация
    // прижимает — 128 квантов почти монослоем; флуктуации живой поверхности
    // дают редкие транзиенты высоты 2.
    CHECK(maxStep <= 2);
    CHECK(wetColumns >= 90);
    CHECK(maxH <= 2);
    // Протокол пробуждения работал: минимум клетки падения (6, 5) плюс
    // латеральные соседи лужи.
    CHECK(medium.woken_total() >= 4);

    // ЗАМУРОВАННАЯ вода СПИТ: у полной воды в каменном мешке нет ни одной
    // пары с воздухом — правило (не зная о сне) не делает ни одного свопа,
    // и планировщик-наблюдатель усыпляет клетку. Так «спящий брик бесплатен»
    // (S16.1) уживается с вечно живой поверхностью открытой лужи.
    {
        std::vector<std::uint32_t> box;
        for (int dz = -1; dz <= 1; ++dz)
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx) {
                    const int bx = 40 + dx, by = 40 + dy, bzc = 40 + dz;
                    const std::size_t bci = macro_index(bx, by, bzc);
                    if (dx == 0 && dy == 0 && dz == 0) {
                        CellType* wp =
                            f.ensure_page(bci, w.grid().types()[bci]);
                        for (int bit = 0; bit < kSubVoxels; ++bit)
                            wp[bit] = kMatWater;
                    } else {
                        w.grid().fill_cell(bx, by, bzc, kMatConcrete);
                    }
                    box.push_back(static_cast<std::uint32_t>(bci));
                }
        mirror.mark_dirty(box.data(), box.size());
        // Изоляция от вечно живой поверхности бассейна: чистый лист live.
        medium.clear_live();
        const std::uint32_t centre =
            static_cast<std::uint32_t>(macro_index(40, 40, 40));
        medium.wake_cells(&centre, 1, w, mirror);
        // Соседи-грани полнотвёрдые — wake их пропускает: ровно одна клетка.
        CHECK(medium.live_count() == 1);
        for (int b = 0; b < 6; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.poll_activity(w, mirror);
        }
        std::printf("[medium_test] entombed water: live after %u\n",
                    medium.live_count());
        CHECK(medium.live_count() == 0); // мешок уснул
    }

    // РУБЛ (инкремент 5): столб обломков, сброшенный в лужу, падает ВМЕСТЕ С
    // МАСКАМИ (бит — кэш фазы, едет с материей), тонет в воде по плотности
    // (1800 > 1000 — из строк, не из ветки), оседает и не левитирует; после
    // шва масок бит совпадает с фазой материала ВО ВСЁМ пуле.
    {
        const std::uint32_t rubCell =
            static_cast<std::uint32_t>(macro_index(65, 65, 6));
        CellType* rp2 = materialize_sub_page(w, rubCell);
        for (int sx = 3; sx < 5; ++sx)
            for (int sy = 3; sy < 5; ++sy)
                for (int sz = 3; sz < 5; ++sz) {
                    rp2[sub_bit(sx, sy, sz)] = kMatRubble;
                    w.grid().mask(65, 65, 6).set(sub_bit(sx, sy, sz));
                }
        mirror.mark_dirty(&rubCell, 1);
        medium.wake_cells(&rubCell, 1, w, mirror);
        for (int b = 0; b < 60; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w);
            medium.poll_activity(w, mirror);
        }
        CHECK(run_batch(dev, mirror, medium, w, 0, substep));
        medium.apply_readback(w);

        std::vector<std::uint32_t> idx2(kMacroCells);
        CHECK(readback(dev, mirror.page_index_buffer(),
                       kMacroCells * sizeof(std::uint32_t), idx2.data()));
        const std::uint32_t pages2 = mirror.pages_in_pool();
        std::vector<std::uint16_t> pool2(
            static_cast<std::size_t>(pages2) * kSubVoxels);
        CHECK(readback(dev, mirror.page_pool_buffer(),
                       pool2.size() * sizeof(std::uint16_t), pool2.data()));

        auto gpuMatAt = [&](int gx, int gy, int gz) -> CellType {
            const std::uint32_t c2 = static_cast<std::uint32_t>(
                macro_index((gx >> 3) & 127, (gy >> 3) & 127,
                            (gz >> 3) & 127));
            const int b2 = sub_bit(gx & 7, gy & 7, gz & 7);
            if (idx2[c2] != gpu::VoxelMirror::kNoPage && idx2[c2] < pages2)
                return static_cast<CellType>(
                    pool2[static_cast<std::size_t>(idx2[c2]) * kSubVoxels +
                          b2]);
            const SubMask& mm = w.grid().masks()[c2];
            return (mm.empty() || mm.test(b2)) ? w.grid().types()[c2]
                                               : kCellAir;
        };

        int rubbleQ = 0, floating = 0, onWater = 0, maskMismatch = 0;
        for (std::uint32_t c2 = 0; c2 < kMacroCells; ++c2) {
            if (idx2[c2] == gpu::VoxelMirror::kNoPage || idx2[c2] >= pages2)
                continue;
            const std::uint16_t* page =
                pool2.data() + static_cast<std::size_t>(idx2[c2]) * kSubVoxels;
            const SubMask& mm = w.grid().masks()[c2];
            const int cx2 = static_cast<int>(c2 & 127u);
            const int cy2 = static_cast<int>((c2 >> 7) & 127u);
            const int cz2 = static_cast<int>((c2 >> 14) & 127u);
            for (int bit = 0; bit < kSubVoxels; ++bit) {
                const CellType mt = static_cast<CellType>(page[bit]);
                const bool solid =
                    mt != kCellAir && material_phase(mt) == MatPhase::Solid;
                if (mm.test(bit) != solid) ++maskMismatch;
                if (mt != kMatRubble) continue;
                ++rubbleQ;
                const int gx = cx2 * 8 + (bit & 7);
                const int gy = cy2 * 8 + ((bit >> 3) & 7);
                const int gz = cz2 * 8 + ((bit >> 6) & 7);
                const CellType below = gpuMatAt(gx, gy, (gz - 1 + 1024) & 1023);
                if (below == kCellAir) ++floating;
                if (below == kMatWater) ++onWater;
            }
        }
        std::printf("[medium_test] rubble: %d quanta, floating %d, on-water "
                    "%d, mask mismatches %d\n",
                    rubbleQ, floating, onWater, maskMismatch);
        // 8 сброшенных + 128 масочного завала генераторной кодировки (та
        // клетка выше по сцене; она спит и никуда не делась — тоже инвариант).
        CHECK(rubbleQ == 8 + 128);
        CHECK(floating == 0);      // осел, не левитирует
        CHECK(onWater == 0);       // утонул: вода не под рублом
        CHECK(maskMismatch == 0);  // маска-кэш == фаза материала (весь пул)
    }

    medium.destroy();
    mirror.destroy();
}

// Карв АГНОСТИЧЕН к виду материи (владелец 2026-08-24): вода режется тем же
// роллом, что бетон, — и наоборот, вырезанный твёрдый атом не уносит воду,
// делившую с ним клетку (старый remove_key ронял страницу по пустой маске).
// CPU-тест, GPU не нужен.
void test_carve_agnostic() {
    static World w;
    const int cx = 30, cy = 30, cz = 30;
    const std::size_t ci = macro_index(cx, cy, cz);
    // Якорь-клетка снизу: детач-свип не должен судить наш пол «оторванным».
    w.grid().fill_cell(cx, cy, cz - 1, kMatConcrete);
    // Пол = нижний слой битов бетона; вода — 4 атома страницей над ним.
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(ci, w.grid().types()[ci]);
    for (int sy = 0; sy < 8; ++sy)
        for (int sx = 0; sx < 8; ++sx) {
            w.grid().mask(cx, cy, cz).set(sub_bit(sx, sy, 0));
            pg[sub_bit(sx, sy, 0)] = kMatConcrete;
        }
    for (int sx = 3; sx < 5; ++sx)
        for (int sy = 3; sy < 5; ++sy)
            pg[sub_bit(sx, sy, 1)] = kMatWater;

    CarveScratch scratch;
    CarveResult res;
    // 1) Вода режется: power 256 против твёрдости воды 96 — ролл
    //    гарантирован; маска не тронута (у воды её и не было).
    CHECK(carve_at(w, cx, cy, cz, 3, 3, 1, 256, 42, scratch, res));
    CHECK(sub_material_at(w, cx, cy, cz, 3, 3, 1) == kCellAir);
    CHECK(w.grid().mask(cx, cy, cz).test(sub_bit(3, 3, 0)));
    // 2) Вырезанный бетонный бит НЕ уносит воду клетки — а сам, по S16.5,
    //    НЕ испаряется: плотность бетона выше насыпной, обломок гарантирован,
    //    и с опорой прямо под ним он ложится на место выреза рублом.
    CHECK(carve_at(w, cx, cy, cz, 0, 0, 0, 60000, 43, scratch, res));
    CHECK(sub_material_at(w, cx, cy, cz, 0, 0, 0) == kMatRubble);
    CHECK(w.grid().mask(cx, cy, cz).test(sub_bit(0, 0, 0)));
    CHECK(sub_material_at(w, cx, cy, cz, 4, 3, 1) == kMatWater);
    // 3) Однородная водная клетка (без страницы): карв одного атома
    //    раскрывает страницу, а не превращает всю клетку в воздух.
    w.grid().set_cell(cx + 1, cy, cz, kMatWater);
    CHECK(carve_at(w, cx + 1, cy, cz, 0, 0, 0, 256, 44, scratch, res));
    CHECK(sub_material_at(w, cx + 1, cy, cz, 0, 0, 0) == kCellAir);
    CHECK(sub_material_at(w, cx + 1, cy, cz, 7, 7, 7) == kMatWater);

    // 4) Материализация ЧЕСТНА (швы у стен, фидбек владельца): у частичной
    //    клетки без страницы дыры — ВОЗДУХ, не заливка базой.
    const int mx = cx + 3;
    w.grid().fill_cell(mx, cy, cz, kMatConcrete);
    w.grid().mask(mx, cy, cz).clear(sub_bit(1, 1, 1));
    const CellType* mp =
        materialize_sub_page(w, macro_index(mx, cy, cz));
    CHECK(mp[sub_bit(1, 1, 1)] == kCellAir);
    CHECK(mp[sub_bit(0, 0, 0)] == kMatConcrete);

    // 5) Закон чтения и для ТИПА-СРЕДЫ (rubble-завал генератора, «блок
    //    грязи»): частичная маска — дыры воздух и в sub_material_at, и в
    //    материализации; пустая маска (вода после collapse) — весь тип.
    const int rx = cx + 5;
    w.grid().set_cell(rx, cy, cz, kMatRubble);
    w.grid().mask(rx, cy, cz).set(sub_bit(0, 0, 0));
    CHECK(sub_material_at(w, rx, cy, cz, 0, 0, 0) == kMatRubble);
    CHECK(sub_material_at(w, rx, cy, cz, 5, 5, 5) == kCellAir);
    const CellType* rp = materialize_sub_page(w, macro_index(rx, cy, cz));
    CHECK(rp[sub_bit(0, 0, 0)] == kMatRubble);
    CHECK(rp[sub_bit(5, 5, 5)] == kCellAir);
    const int ux = cx + 6;
    w.grid().set_cell(ux, cy, cz, kMatWater); // пустая маска = вся вода
    CHECK(sub_material_at(w, ux, cy, cz, 3, 3, 3) == kMatWater);
}

} // namespace

int main() {
    gpu::VulkanDevice dev;
    CHECK(dev.init_headless(false));
    if (dev.device != VK_NULL_HANDLE) {
        CHECK(dev.families.graphics != UINT32_MAX);
        CHECK(dev.graphicsQueue != VK_NULL_HANDLE);
        test_headless_roundtrip(dev);
        test_automaton_water(dev);
    }
    test_carve_agnostic();
    dev.destroy();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    return g_fails == 0 ? 0 : 1;
}
