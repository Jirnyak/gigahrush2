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
#include "world/materials.h" // kMatWater, kMatConcrete, kMatToxicGas
#include "world/medium.h"    // агрегаты S16.4 — чек уровней на шве
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
               std::uint64_t base, std::uint32_t frameSlot = 0) {
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
                               w, frameSlot, mirror.flush_gen());
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

// Слить хвост обратного шва: фенсовая дисциплина применяет запись возрастом
// kRbRegions кадров — спокойные кадры досылают всё в CPU-канон.
void drain_seam(gpu::VulkanDevice& dev, gpu::VoxelMirror& mirror,
                gpu::GpuMediumPass& medium, World& w, std::uint64_t& substep) {
    for (std::uint32_t t = 0; t < gpu::GpuMediumPass::kRbRegions + 1; ++t) {
        CHECK(run_batch(dev, mirror, medium, w, 0, substep));
        medium.apply_readback(w, mirror);
    }
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

    // РЕПРО РЕГРЕССИИ «вода не растекается вдоль стен» (фидбек владельца
    // 2026-08-24): внутри бассейна — ЧАСТИЧНАЯ безстраничная стеновая
    // клетка игрового вида (тип бетона, тонкая стена 2 субвокселя в
    // центре, БЕЗ страницы — кодировка генератора): вода обязана затечь в
    // её воздушную часть чисто GPU-путём (пробуждение wake_next + ленивая
    // материализация по метке pack'а).
    {
        w.grid().set_cell(64, 64, 5, kMatConcrete);
        for (int sy = 0; sy < 8; ++sy)
            for (int sz = 0; sz < 8; ++sz) {
                w.grid().mask(64, 64, 5).set(sub_bit(3, sy, sz));
                w.grid().mask(64, 64, 5).set(sub_bit(4, sy, sz));
            }
    }

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
    // Писатель будит клетку И грани; счётчик живых теперь GPU-истина и
    // приходит швом с лагом кольца — мгновенных чеков здесь больше нет.
    medium.wake_cells(&pourCell, 1, w, mirror);

    // ЧИСТЫЙ МАРКОВ (закон владельца 2026-08-24): открытая лужа диффундирует
    // вечно и НЕ спит — сон больше не цель прогона. Гоняем фиксированные
    // 100 батчей (800 подтиков = 25.6 с игрового времени) и меряем ФОРМУ.
    std::uint64_t substep = 0;
    // 25 батчей (200 подтиков = 6.4 с): растекание и уровень достигнуты, а
    // усушка тонкого монослоя (закон одиночек ×10, p_воды ~1e-3) ещё не
    // съела форму — пины ширины меряют растекание, не смертность.
    for (int b = 0; b < 25; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        // Кадровый шов: сначала обратный поток в CPU-канон, потом протокол
        // пробуждения — тот же порядок, что в кадре игры.
        medium.apply_readback(w, mirror);
    }
    // Шов до конца: счётчик истаиваний (заголовок пака) обязан догнать
    // состояние пула ДО счёта массы — иначе гонка лага в 3 региона.
    drain_seam(dev, mirror, medium, w, substep);
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
    std::size_t mobileQ = 0; // ВСЯ подвижная материя пула (вода + рубл)
    for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
        if (idx[ci] == gpu::VoxelMirror::kNoPage || idx[ci] >= pages) {
            // Бесстраничная клетка по закону чтения: непустая маска ->
            // маскированное читается ТИПОМ (завал = 128 рублов без страницы),
            // пустая маска у среды -> весь тип. Иначе масса завала выпадает
            // из уравнения, пока клетку никто не материализовал.
            const CellType base = w.grid().types()[ci];
            if (base != 0 && material_is_medium(base)) {
                const SubMask& pm = w.grid().masks()[ci];
                int bits = 0;
                for (std::size_t wI = 0; wI < kSubMaskWords; ++wI)
                    bits += __builtin_popcountll(pm.words[wI]);
                mobileQ += bits ? bits : kSubVoxels;
            }
            continue;
        }
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
            if (mt != 0 && material_is_medium(mt)) ++mobileQ;
            if (mt != kMatWater || m.test(bit)) continue;
            const int sx = bit & 7, sy = (bit >> 3) & 7, sz = (bit >> 6) & 7;
            water.insert(key(cx * 8 + sx, cy * 8 + sy, cz * 8 + sz));
        }
    }
    // МАССА по новому закону (2026-08-25): одиночки истаивают, и счётчик
    // ОБЩИЙ на все материалы — уравнение пишется по ВСЕЙ подвижной материи:
    // вода (kPoured) + завал (128 рублов маской) + истаявшие == константа.
    // (Первая версия чека вешала счётчик на одну воду и ловила «+1» от
    // истаявшего рубл-одиночки завала — уравнение, не течь.)
    std::printf("[medium_test] mass: mobile %zu + faded %u vs poured %u+128\n",
                mobileQ, medium.fade_total(), kPoured);
    CHECK(mobileQ + medium.fade_total() == kPoured + 128);
    CHECK(unmaskedSolid == 0); // материи из ниоткуда нет (закон чтения)

    // Класс клетки завала — 2 (частичная твёрдая), НЕ 3: и CPU-classify
    // (upload/flush), и GPU-settle (клетку будила вода) обязаны читать закон
    // одинаково.
    {
        std::vector<std::uint8_t> cls(kMacroCells);
        CHECK(readback(dev, mirror.class_buffer(), kMacroCells, cls.data()));
        CHECK(cls[moundCell] == 2);
    }

    // ОБРАТНЫЙ ШОВ (инкремент 3): CPU-канон сошёлся с GPU (лаг фенсовой
    // дисциплины — kRbRegions кадров) — карв и сейв видят ту же воду,
    // фантомы стейл-страниц мертвы. Спокойные кадры досылают хвост.
    drain_seam(dev, mirror, medium, w, substep);
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
        // CPU-канон == GPU-пул по воде (шов честен) — без счётчика:
        // сходимость шва меряется равенством двух счётов, не массой.
        CHECK(cpuWater == water.size());

        // АГРЕГАТЫ S16.4 — без редьюс-пасса: шов пересчитал medium_level по
        // изменённым клеткам; сумма уровней жидкости == всей воде мира.
        std::size_t aggWater = 0;
        for (std::uint32_t ci = 0; ci < kMacroCells; ++ci)
            aggWater += medium_level_at(w, ci) & 0xFFFFu;
        CHECK(aggWater == cpuWater); // агрегат == прямой счёт воды
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
    // Вода ЗАТЕКЛА в воздушную часть частичной стеновой клетки (репро
    // регрессии): в клетке (64,64,5) есть water-атомы вне маски.
    {
        int inWall = 0;
        const SubField<CellType>* f3 =
            w.subfields().find<CellType>(kSubMaterialName);
        const CellType* pg3 = f3 ? f3->page(macro_index(64, 64, 5)) : nullptr;
        if (pg3)
            for (int bit = 0; bit < kSubVoxels; ++bit)
                if (pg3[bit] == kMatWater) ++inWall;
        std::printf("[medium_test] partial-wall cell: %d water quanta\n",
                    inWall);
        CHECK(inWall > 0);
    }
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
        for (int b = 0; b < 6; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
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
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);

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
        CHECK(rubbleQ >= 8 + 128 - 4);
        CHECK(floating == 0);      // осел, не левитирует
        CHECK(onWater == 0);       // утонул: вода не под рублом
        CHECK(maskMismatch == 0);  // маска-кэш == фаза материала (весь пул)
    }

    // ДЕТАЧ = ЗАМЫСЕЛ ВЛАДЕЛЬЦА (2026-08-24): потерявший связность кусок НЕ
    // исчезает и ничего не рождает — ТЕ ЖЕ атомы на месте становятся рыхлой
    // строкой и честно падают автоматом, как вода: один механизм. Полка на
    // столбике; срубаем столбик — полка отрывается, конвертируется и падает.
    {
        w.grid().fill_cell(80, 80, 4, kMatConcrete); // пол-опора (две клетки —
        w.grid().fill_cell(81, 80, 4, kMatConcrete); // компонент > лимита)
        CellType* sp = materialize_sub_page(
            w, macro_index(80, 80, 5));
        auto put = [&](int sx, int sy, int sz) {
            sp[sub_bit(sx, sy, sz)] = kMatConcrete;
            w.grid().mask(80, 80, 5).set(sub_bit(sx, sy, sz));
        };
        for (int sz = 0; sz < 4; ++sz) put(4, 4, sz); // столбик 4
        for (int sx = 5; sx < 8; ++sx) put(sx, 4, 3); // полка 3 на верхушке
        const std::uint32_t towerCell =
            static_cast<std::uint32_t>(macro_index(80, 80, 5));
        mirror.mark_dirty(&towerCell, 1);

        CarveScratch scratch;
        CarveResult res;
        // Срубить НИЖНИЙ атом столбика: верх (3 столбика + 3 полки = 6)
        // теряет связность с полом.
        CHECK(carve_at(w, 80, 80, 5, 4, 4, 0, 60000, 77, scratch, res));
        CHECK(res.detached.size() == 6);
        // Конверсия НА МЕСТЕ: те же атомы, материал rubble, маска стоит.
        CHECK(sub_material_at(w, 80, 80, 5, 4, 4, 3) == kMatRubbleConcrete);
        CHECK(w.grid().mask(80, 80, 5).test(sub_bit(5, 4, 3)));

        mirror.mark_dirty(res.dirtyCells.data(), res.dirtyCells.size());
        medium.wake_cells(res.dirtyCells.data(), res.dirtyCells.size(), w,
                          mirror);
        for (int b = 0; b < 40; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);

        // CPU-канон догнал (шов): 6 квантов рубла осели на полу-опоре, ни
        // один не левитирует; полка не висит на прежней высоте.
        int fell = 0, still = 0, floating = 0;
        for (int sx = 0; sx < 8; ++sx)
            for (int sy = 0; sy < 8; ++sy)
                for (int sz = 0; sz < 8; ++sz)
                    for (int cxx = 79; cxx <= 81; ++cxx) {
                        if (sub_material_at(w, cxx, 80, 5, sx, sy, sz) !=
                            kMatRubbleConcrete)
                            continue;
                        ++fell;
                        if (sz >= 3) ++still;
                        const bool sup =
                            sz > 0
                                ? w.grid().mask(cxx, 80, 5).test(
                                      sub_bit(sx, sy, sz - 1))
                                : w.grid().mask(cxx, 80, 4).test(
                                      sub_bit(sx, sy, 7));
                        if (!sup) ++floating;
                    }
        std::printf("[medium_test] detach: %d rubble quanta, %d at old "
                    "height, %d floating\n",
                    fell, still, floating);
        CHECK(fell == 6);     // масса куска цела — ничего не родилось
        CHECK(still == 0);    // полка не висит где висела
        CHECK(floating == 0); // всё на опоре
    }

    // ГАЗ = МАТЕРИЯ (инкремент 4, слияние gas_sim): toxic_gas тяжелее
    // табличного воздуха (3 > 0) — облако под потолком камеры ТОНЕТ и
    // стелется по полу; агрегат клетки считает газ в верхних 16 битах.
    {
        for (int gx = 90; gx < 93; ++gx)
            for (int gy = 90; gy < 93; ++gy) {
                w.grid().fill_cell(gx, gy, 40, kMatConcrete); // пол
                if (gx == 90 || gx == 92 || gy == 90 || gy == 92) {
                    w.grid().fill_cell(gx, gy, 41, kMatConcrete);
                    w.grid().fill_cell(gx, gy, 42, kMatConcrete);
                }
            }
        const std::uint32_t gasCell =
            static_cast<std::uint32_t>(macro_index(91, 91, 42)); // под потолком
        CellType* gp = materialize_sub_page(w, gasCell);
        for (int sx = 2; sx < 6; ++sx)
            for (int sy = 2; sy < 6; ++sy)
                for (int sz = 4; sz < 6; ++sz)
                    gp[sub_bit(sx, sy, sz)] = kMatToxicGas; // 32 кванта
        mirror.mark_dirty(&gasCell, 1);
        const std::uint32_t fadeBeforeGas = medium.fade_total();
        medium.wake_cells(&gasCell, 1, w, mirror);
        // 8 батчей (64 подтика): газу хватает осесть на пол камеры; дольше
        // нельзя — по закону 2026-08-25 одиночки пуфа истаивают (газ живёт
        // ~секунду на одиночку), и от облака ничего не останется.
        for (int b = 0; b < 8; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);
        std::size_t gasLow = 0, gasHigh = 0, gasAll = 0;
        for (int cz2 = 40; cz2 <= 42; ++cz2)
            for (int gx = 90; gx < 93; ++gx)
                for (int gy = 90; gy < 93; ++gy) {
                    const std::uint32_t lvl = medium_level_at(
                        w, macro_index(gx, gy, cz2));
                    const std::uint32_t g2 = lvl >> 16;
                    gasAll += g2;
                    if (cz2 == 41) gasLow += g2;   // нижняя клетка камеры
                    if (cz2 == 42) gasHigh += g2;  // стартовая, под потолком
                }
        std::printf("[medium_test] gas: %zu quanta (low %zu, high %zu)\n",
                    gasAll, gasLow, gasHigh);
        const std::uint32_t gasFaded =
            medium.fade_total() - fadeBeforeGas;
        // Масса сходится С УЧЁТОМ истаявших (закон 2026-08-25); из ниоткуда
        // газ не рождается; большинство доживает до пола за 64 подтика.
        CHECK(gasAll + gasFaded >= 32);
        CHECK(gasAll <= 32);
        CHECK(gasAll >= 16);
        CHECK(gasLow > gasHigh);  // тяжёлый газ ОСЕЛ — стелется по полу
    }

    // ИЗОТРОПИЯ ПО ФРЕЙМАМ (порт умершего suite_gravity_regimes §5.1 b/c на
    // настоящий SPIR-V): материя падает СТРОГО по regime_down каждого из 6
    // режимов; Zero гравитацией не двигает (живёт только диффузия). Ловит
    // захардкоженную ось в правиле — класс дефектов из isotropy-law.
    {
        auto pour8 = [&](int cx, int cy, int cz) {
            const std::uint32_t ci =
                static_cast<std::uint32_t>(macro_index(cx, cy, cz));
            CellType* pg = materialize_sub_page(w, ci);
            for (int sx = 3; sx < 5; ++sx)
                for (int sy = 3; sy < 5; ++sy)
                    for (int sz = 3; sz < 5; ++sz)
                        pg[sub_bit(sx, sy, sz)] = kMatWater;
            mirror.mark_dirty(&ci, 1);
            medium.wake_cells(&ci, 1, w, mirror);
            return ci;
        };
        auto count_at = [&](int cx, int cy, int cz) {
            const std::size_t ci = macro_index(wrap_macro(cx), wrap_macro(cy),
                                               wrap_macro(cz));
            const SubField<CellType>* f2 =
                w.subfields().find<CellType>(kSubMaterialName);
            const CellType* pg = f2 ? f2->page(ci) : nullptr;
            if (!pg) return 0;
            int n = 0;
            for (int b = 0; b < kSubVoxels; ++b)
                if (pg[b] == kMatWater) ++n;
            return n;
        };
        const GravityRegime regimes[6] = {
            GravityRegime::NegZ, GravityRegime::PosZ, GravityRegime::NegY,
            GravityRegime::PosY, GravityRegime::NegX, GravityRegime::PosX};
        int rgn = 0;
        for (GravityRegime r : regimes) {
            medium.clear_live();
            w.gravity().regime = r;
            const int cx = 20 + rgn * 6, cy = 20, cz = 100;
            pour8(cx, cy, cz);
            for (int b = 0; b < 4; ++b) {
                CHECK(run_batch(dev, mirror, medium, w, 8, substep));
                substep += 8;
                medium.apply_readback(w, mirror);
            }
            drain_seam(dev, mirror, medium, w, substep);
            const CellStep d = regime_down(r);
            // За 32 подтика свободного падения масса ушла по d и НЕ пошла
            // против d.
            int along = 0, against = 0;
            for (int k = 1; k <= 5; ++k) {
                along += count_at(cx + d.x * k, cy + d.y * k, cz + d.z * k);
                against +=
                    count_at(cx - d.x * k, cy - d.y * k, cz - d.z * k);
            }
            CHECK(along > 0);
            CHECK(against == 0);
            ++rgn;
        }
        // Zero: гравитации нет — направленного сноса нет (диффузия могла
        // размазать по соседям, но за 2 клетки по осям — пусто).
        medium.clear_live();
        w.gravity().regime = GravityRegime::Zero;
        const int zx = 20 + rgn * 6, zy = 20, zz = 100;
        pour8(zx, zy, zz);
        for (int b = 0; b < 2; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);
        CHECK(count_at(zx + 2, zy, zz) == 0);
        CHECK(count_at(zx - 2, zy, zz) == 0);
        CHECK(count_at(zx, zy, zz + 2) == 0);
        CHECK(count_at(zx, zy, zz - 2) == 0);
        w.gravity().regime = GravityRegime::NegZ;
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
    // 2) Вырезанный бетонный бит УДАЛЯЕТСЯ (редакция владельца 2026-08-24:
    //    никакого рождения субвокселей при разрушении) и НЕ уносит воду
    //    клетки.
    CHECK(carve_at(w, cx, cy, cz, 0, 0, 0, 60000, 43, scratch, res));
    CHECK(!w.grid().mask(cx, cy, cz).test(sub_bit(0, 0, 0)));
    CHECK(sub_material_at(w, cx, cy, cz, 0, 0, 0) == kCellAir);
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

    // 5б) РЕГРЕССИЯ «вода не течёт вдоль стен» (владелец ловил ДВАЖДЫ):
    //    карв ПОСЛЕДНЕГО масочного атома твёрдой клетки не смеет заливать
    //    её фантомной базой — вся клетка обязана стать воздухом. Пустая
    //    маска = «весь тип» ТОЛЬКО у материи сред; у твёрдого — воздух.
    const int lx2 = cx + 10;
    w.grid().fill_cell(lx2, cy, cz - 1, kMatConcrete); // двухклеточный якорь
    w.grid().fill_cell(lx2 + 1, cy, cz - 1, kMatConcrete);
    w.grid().set_cell(lx2, cy, cz, kMatConcrete);
    w.grid().mask(lx2, cy, cz).set(sub_bit(2, 2, 0));
    CHECK(carve_at(w, lx2, cy, cz, 2, 2, 0, 60000, 99, scratch, res));
    CHECK(w.grid().mask(lx2, cy, cz).empty());
    CHECK(sub_material_at(w, lx2, cy, cz, 5, 5, 5) == kCellAir); // НЕ база!
    CHECK(w.grid().cell(lx2, cy, cz) == kCellAir); // схлопнулась в воздух

    // 6) РЫХЛЫЕ ДВОЙНИКИ (решение владельца 2026-08-24): детач и писатели
    //    конвертируют в двойника ИСХОДНИКА (вид сохраняется), среды и
    //    небьющееся — сами себя.
    CHECK(kMatRubbleOf[kMatConcrete] == kMatRubbleConcrete);
    CHECK(kMatRubbleOf[kMatWater] == kMatWater);
    CHECK(kMatRubbleOf[kMatDoor] == kMatDoor);
    CHECK(material_is_medium(kMatRubbleConcrete)); // двойник движется строкой

    // 7) ОДИН ЗАКОН СВЯЗНОСТИ НА ПИСАТЕЛЯХ: «шар» бетона в воздухе
    //    конвертируется detach_scan'ом целиком — дальше его роняет автомат;
    //    маски стоят (бит-кэш поедет с материей).
    const int fx = cx + 8;
    CellType* fp = materialize_sub_page(w, macro_index(fx, cy, cz));
    for (int sx2 = 2; sx2 < 5; ++sx2)
        for (int sy2 = 2; sy2 < 5; ++sy2)
            for (int sz2 = 2; sz2 < 5; ++sz2) {
                fp[sub_bit(sx2, sy2, sz2)] = kMatConcrete;
                w.grid().mask(fx, cy, cz).set(sub_bit(sx2, sy2, sz2));
            }
    CHECK(detach_scan(w, fx, cy, cz, 3, 3, 3, 27 + 64, scratch, res) == 27);
    CHECK(sub_material_at(w, fx, cy, cz, 2, 2, 2) == kMatRubbleConcrete);
    CHECK(w.grid().mask(fx, cy, cz).test(sub_bit(2, 2, 2)));
}

// РЕПРО скрина владельца 2026-08-25: «клетки-квадраты, в которые вода не
// идёт, хотя там пусто по субвокселям». Обрыв у БЕЗстраничного соседа:
// клетка W стоит с водой в 3 слоя, сосед D — воздух без страницы. Блоки
// Марголуса через границу W|D принадлежат W, но писать в D нельзя, пока
// страница D не приедет швом (лаг kRbRegions кадров). Если за это время
// у W не было ходов — тишина дорастает до сна, и НИКТО не будит W после
// приезда страницы: обрыв 3:0 замерзает навсегда. Закон писателя обязывает
// ленивую материализацию будить клетку И грани — вода обязана перелиться.
void test_frontier_freeze(gpu::VulkanDevice& dev) {
    static World w;
    // Дно и бокс 2x1 вдоль +x: W=(80,80,5) с водой, D=(81,80,5) — воздух.
    for (int x = 79; x <= 82; ++x)
        for (int y = 79; y <= 81; ++y)
            w.grid().fill_cell(x, y, 4, kMatConcrete);
    w.grid().fill_cell(79, 80, 5, kMatConcrete);
    w.grid().fill_cell(82, 80, 5, kMatConcrete);
    w.grid().fill_cell(80, 79, 5, kMatConcrete);
    w.grid().fill_cell(80, 81, 5, kMatConcrete);
    w.grid().fill_cell(81, 79, 5, kMatConcrete);
    w.grid().fill_cell(81, 81, 5, kMatConcrete);
    const auto wCell = static_cast<std::uint32_t>(macro_index(80, 80, 5));
    const auto dCell = static_cast<std::uint32_t>(macro_index(81, 80, 5));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(wCell, w.grid().types()[wCell]);
    constexpr int kPoured = 192; // 3 слоя по 64 — обрыв 3:0 к соседу
    for (int sx = 0; sx < 8; ++sx)
        for (int sy = 0; sy < 8; ++sy)
            for (int sz = 0; sz < 3; ++sz)
                pg[sub_bit(sx, sy, sz)] = kMatWater;
    CHECK(!f.paged(dCell)); // суть сцены: сосед-воздух БЕЗ страницы

    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    // Будим ТОЛЬКО столб над водой — его грани не трогают D: страница D
    // обязана приехать честным GPU-путём (wake_next -> pack -> шов), как
    // на фронте растекания в игре.
    const auto above = static_cast<std::uint32_t>(macro_index(80, 80, 6));
    medium.wake_cells(&above, 1, w, mirror);

    std::uint64_t substep = 0;
    // ИГРОВОЙ каденс, не тестовый: кадры чередуют слоты (0/1, как
    // kMaxFramesInFlight в игре) и половина кадров несёт НОЛЬ подтиков
    // (60 fps против 31.25 подтиков/с) — класс «харнесс не как игра»
    // дважды прятал баги петли (батчи по 8 и вечный слот 0).
    for (int b = 0; b < 80; ++b) {
        const std::uint32_t n = (b & 1) ? 0u : 4u;
        CHECK(run_batch(dev, mirror, medium, w, n, substep,
                        static_cast<std::uint32_t>(b) %
                            gpu::kMaxFramesInFlight));
        substep += n;
        medium.apply_readback(w, mirror);
    }
    drain_seam(dev, mirror, medium, w, substep);

    const CellType* dp = f.page(dCell);
    int dq = 0, wq = 0;
    if (dp)
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (dp[b2] == kMatWater) ++dq;
    const CellType* wp = f.page(wCell);
    if (wp)
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (wp[b2] == kMatWater) ++wq;
    std::printf("[medium_test] frontier: D page %s, water D %d + W %d\n",
                dp ? "yes" : "NO", dq, wq);
    // Масса не рождается и не тонет в шве; истаявшие одиночки (закон
    // 2026-08-25) на счётчике.
    CHECK(dq + wq + int(medium.fade_total()) == kPoured);
    // Уровень: 192 кванта на 2 клетки дна — в D обязан стоять минимум слой
    // с запасом на рябь диффузии (полслоя).
    CHECK(dq >= 32);
    medium.destroy(); // статики: Vulkan-объекты умирают ДО устройства
    mirror.destroy();
}

// РЕПРО скрина владельца 2026-08-25, механизм №2: ХВОСТ СПИСКА ЗА ОКНОМ
// ПАКА. При live > kRbSlotCap пак покрывал только первые 8192 слота, а
// порядок списка между подтиками почти стабилен (выжившие перепушиваются
// раньше новых) — новорожденная клетка фронта вечно сидела в хвосте: не
// пакуется -> не помечается -> не материализуется -> вода в неё не идёт.
// Сцена: одеяло газа > kRbSlotCap клеток держит список толстым, потом
// обрыв воды у безстраничного соседа — сосед обязан получить страницу
// вращающимся окном пака и принять воду.
void test_seam_tail(gpu::VulkanDevice& dev) {
    static World w;
    // Газовое одеяло: 96x96 клеток одним слоем на дне из полнотвёрдых.
    // 9216 живых > окна 8192. По 32 кванта газа — бурлит и не спит.
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    for (int y = 16; y < 112; ++y)
        for (int x = 16; x < 112; ++x) {
            w.grid().fill_cell(x, y, 20, kMatConcrete);
            const auto ci =
                static_cast<std::uint32_t>(macro_index(x, y, 21));
            CellType* pg = f.ensure_page(ci, w.grid().types()[ci]);
            // Плита 8x8x2 НЕПРЕРЫВНА через границы клеток: у нутра всегда
            // есть блокомейт — закон истаивания одиночек (2026-08-25) ест
            // только кромку, островки 4x4 испарились бы целиком.
            for (int sy = 0; sy < 8; ++sy)
                for (int sx = 0; sx < 8; ++sx)
                    for (int sz = 0; sz < 2; ++sz)
                        pg[sub_bit(sx, sy, sz)] = kMatToxicGas;
        }
    // Обрыв воды НИЖЕ одеяла: бокс 2x1, W с водой, D — воздух без страницы.
    for (int x = 59; x <= 62; ++x)
        for (int y = 59; y <= 61; ++y)
            w.grid().fill_cell(x, y, 4, kMatConcrete);
    w.grid().fill_cell(59, 60, 5, kMatConcrete);
    w.grid().fill_cell(62, 60, 5, kMatConcrete);
    w.grid().fill_cell(60, 59, 5, kMatConcrete);
    w.grid().fill_cell(60, 61, 5, kMatConcrete);
    w.grid().fill_cell(61, 59, 5, kMatConcrete);
    w.grid().fill_cell(61, 61, 5, kMatConcrete);
    const auto wCell = static_cast<std::uint32_t>(macro_index(60, 60, 5));
    const auto dCell = static_cast<std::uint32_t>(macro_index(61, 60, 5));
    CellType* pg = f.ensure_page(wCell, w.grid().types()[wCell]);
    constexpr int kPoured = 192;
    for (int sx = 0; sx < 8; ++sx)
        for (int sy = 0; sy < 8; ++sy)
            for (int sz = 0; sz < 3; ++sz)
                pg[sub_bit(sx, sy, sz)] = kMatWater;
    CHECK(!f.paged(dCell));

    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));

    // Будим одеяло волнами под кап инжекта, ПОТОМ воду — газ занимает
    // голову списка, клетки воды достаются хвосту (порядок как в игре:
    // старожилы впереди).
    std::vector<std::uint32_t> wave;
    std::uint64_t substep = 0;
    for (int y = 16; y < 112; ++y) {
        for (int x = 16; x < 112; ++x)
            wave.push_back(
                static_cast<std::uint32_t>(macro_index(x, y, 21)));
        if (wave.size() >= 1000 || y == 111) {
            medium.wake_cells(wave.data(), wave.size(), w, mirror);
            wave.clear();
            CHECK(run_batch(dev, mirror, medium, w, 1, substep));
            substep += 1;
            medium.apply_readback(w, mirror);
        }
    }
    const auto above = static_cast<std::uint32_t>(macro_index(60, 60, 6));
    medium.wake_cells(&above, 1, w, mirror);
    for (int b = 0; b < 60; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 4, substep));
        substep += 4;
        medium.apply_readback(w, mirror);
    }
    drain_seam(dev, mirror, medium, w, substep);

    const CellType* dp = f.page(dCell);
    int dq = 0;
    if (dp)
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (dp[b2] == kMatWater) ++dq;
    std::printf("[medium_test] seam tail: list %u, D page %s, D water %d\n",
                medium.list_total(), dp ? "yes" : "NO", dq);
    CHECK(medium.list_total() > gpu::GpuMediumPass::kRbSlotCap);
    CHECK(dq >= 32);
    (void)kPoured;
    medium.destroy(); // статики: Vulkan-объекты умирают ДО устройства
    mirror.destroy();
}

// ЗАКОН ИСТАИВАНИЯ ОДИНОЧЕК (владелец 2026-08-25): подвижный атом без
// единого атома СВОЕГО материала в блоке Марголуса тает роллом с шансом,
// обратным массе кванта (kMatMedium.z, вывод в кодогене). Одинокий квант
// газа живёт ~секунду — за 640 подтиков шанс выжить ~1e-9; счётчик
// истаиваний обязан сойтись с массой РОВНО. Плотная вода (полная клетка)
// не тает: у каждого атома блокомейт в любой фазе.
void test_lone_fade(gpu::VulkanDevice& dev) {
    static World w;
    // Камера: пол, одинокий квант газа в воздухе + полная клетка воды.
    for (int x = 40; x <= 44; ++x)
        for (int y = 40; y <= 44; ++y)
            w.grid().fill_cell(x, y, 30, kMatConcrete);
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    const auto gCell = static_cast<std::uint32_t>(macro_index(41, 41, 31));
    CellType* gp = f.ensure_page(gCell, w.grid().types()[gCell]);
    gp[sub_bit(4, 4, 0)] = kMatToxicGas; // одиночка — обязан истаять
    // Полная клетка воды В СКЛЕПЕ (стены+потолок): двигаться некуда, ни
    // один атом не одинок ни в одной фазе — масса обязана держаться РОВНО.
    // (Открытая клетка растекается по платформе, крошит одиночек на краях
    // и честно истаивает по закону — для пина «вечна» нужна плотность.)
    for (int dx = -1; dx <= 1; ++dx)
        for (int dy = -1; dy <= 1; ++dy)
            if (dx != 0 || dy != 0)
                w.grid().fill_cell(43 + dx, 43 + dy, 31, kMatConcrete);
    w.grid().fill_cell(43, 43, 32, kMatConcrete);
    const auto wCell = static_cast<std::uint32_t>(macro_index(43, 43, 31));
    CellType* wp = f.ensure_page(wCell, w.grid().types()[wCell]);
    for (int b = 0; b < kSubVoxels; ++b)
        wp[b] = kMatWater;

    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    std::uint32_t cells[2] = {gCell, wCell};
    medium.wake_cells(cells, 2, w, mirror);

    std::uint64_t substep = 0;
    for (int b = 0; b < 80; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
    }
    drain_seam(dev, mirror, medium, w, substep);

    int gas = 0, water = 0;
    for (std::uint32_t ci = 0; ci < kMacroCells; ++ci) {
        const CellType* pg = f.page(ci);
        if (!pg) continue;
        for (int b2 = 0; b2 < kSubVoxels; ++b2) {
            if (pg[b2] == kMatToxicGas) ++gas;
            if (pg[b2] == kMatWater) ++water;
        }
    }
    std::printf("[medium_test] lone fade: gas %d, water %d, faded %u\n",
                gas, water, medium.fade_total());
    CHECK(gas == 0);                        // одиночка истаяла
    CHECK(water == 512);                    // плотное — вечно, ровно
    CHECK(medium.fade_total() == 1);        // истаяла ровно одиночка
    medium.destroy(); // статики: Vulkan-объекты умирают ДО устройства
    mirror.destroy();
}

// БАГ ВЛАДЕЛЬЦА 2026-08-26 «дыра переехала»: карв против шва В ПОЛЁТЕ.
// Живая клетка пакуется каждый кадр; CPU-карв бьёт её между паком и
// применением; стейл-регион (запакован ДО карва) применяется ПОСЛЕ и
// воскрешал выбитые атомы в CPU-каноне — дыра «затягивалась», рядом
// оставалась свежая: выглядело сдвигом дыры. Гейт свежести: клетка с
// CPU-записью на/после поколения пака не перезаписывается.
void test_carve_vs_seam(gpu::VulkanDevice& dev) {
    static World w;
    for (int x = 99; x <= 101; ++x)
        for (int y = 99; y <= 101; ++y)
            w.grid().fill_cell(x, y, 50, kMatConcrete);
    w.grid().fill_cell(99, 100, 51, kMatConcrete);
    w.grid().fill_cell(101, 100, 51, kMatConcrete);
    w.grid().fill_cell(100, 99, 51, kMatConcrete);
    w.grid().fill_cell(100, 101, 51, kMatConcrete);
    // Потолок: без него вода за 10 батчей выбурливала из клетки поверх
    // стенок, и к карву воскрешать было нечего (пустой стейл == пустой
    // свежий — тест не отличал). Диагонали не текут (свопы осевые).
    w.grid().fill_cell(100, 100, 52, kMatConcrete);
    const auto wCell = static_cast<std::uint32_t>(macro_index(100, 100, 51));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(wCell, w.grid().types()[wCell]);
    // НЕРОВНАЯ поверхность (слой + полслоя): полные слои в склепе спят
    // (плотное вверх нельзя, латералей нет — ходов ноль), а живость клетки
    // в момент карва — суть гонки: спящую не пакуют. Латеральная диффузия
    // полуслоя жива вечно (как поверхность бассейна).
    for (int sx = 0; sx < 8; ++sx)
        for (int sy = 0; sy < 8; ++sy) {
            pg[sub_bit(sx, sy, 0)] = kMatWater;
            if (sx < 4) pg[sub_bit(sx, sy, 1)] = kMatWater;
        }

    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    medium.wake_cells(&wCell, 1, w, mirror);

    // Клетка живёт и пакуется каждый батч; регионы кольца полны её водой.
    std::uint64_t substep = 0;
    for (int b = 0; b < 10; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 4, substep));
        substep += 4;
        medium.apply_readback(w, mirror);
    }

    {
        int pre = 0;
        const CellType* pp2 = f.page(wCell);
        for (int b4 = 0; b4 < kSubVoxels; ++b4)
            if (pp2 && pp2[b4] == kMatWater) ++pre;
        std::printf("[medium_test]   pre-carve W water %d\n", pre);
    }
    // КАРВ между паком и применением: CPU выбивает всю воду (путь игры:
    // страница + wake_cells + флеш придёт следующим батчем).
    CellType* cp = f.page(wCell);
    for (int b2 = 0; b2 < kSubVoxels; ++b2)
        if (cp[b2] == kMatWater) cp[b2] = kCellAir;
    mirror.mark_dirty(&wCell, 1);
    medium.wake_cells(&wCell, 1, w, mirror);

    // Окно гонки — ДВА следующих кадра: они потребляют регионы, записанные
    // ДО карва (полные воды). Батчи с нулём подтиков: флеш+пак без движения
    // материи — чистое воспроизведение «стейл-шов против свежего карва».
    for (int b3 = 0; b3 < 2; ++b3) {
        CHECK(run_batch(dev, mirror, medium, w, 0, substep));
        medium.apply_readback(w, mirror);
        int dbg = 0;
        const CellType* dp2 = f.page(wCell);
        for (int b4 = 0; b4 < kSubVoxels; ++b4)
            if (dp2 && dp2[b4] == kMatWater) ++dbg;
        std::printf("[medium_test]   seam tail %d: W water %d, live %u\n",
                    b3, dbg, medium.live_count());
    }

    int resurrected = 0;
    const CellType* rp = f.page(wCell);
    if (rp)
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (rp[b2] == kMatWater) ++resurrected;
    std::printf("[medium_test] carve vs seam: resurrected %d\n", resurrected);
    CHECK(resurrected == 0); // выбитое НЕ воскресает стейл-швом

    // ФАЗА 2 — ЗАТОР СТЕЙДЖИНГА (вторая половина бага «дыра заросла»):
    // гейт «от момента записи» ломался, когда окно стейджинга (12 МиБ)
    // не довозило карв тем же кадром: пак, записанный МЕЖДУ записью и её
    // доставкой, нёс до-карвную воду. Забиваем очередь ~11.5k страничных
    // клеток С МЛАДШИМИ ci (флеш сортирует по ci — карв в хвосте окна),
    // карвим, гоним кадры: вода не смеет вернуться.
    {
        CellType* wp2 = f.page(wCell);
        for (int sx = 0; sx < 8; ++sx)
            for (int sy = 0; sy < 8; ++sy) {
                wp2[sub_bit(sx, sy, 0)] = kMatWater;
                if (sx < 4) wp2[sub_bit(sx, sy, 1)] = kMatWater;
            }
        mirror.mark_dirty(&wCell, 1);
        medium.wake_cells(&wCell, 1, w, mirror);
        for (int b = 0; b < 10; ++b) {
            CHECK(run_batch(dev, mirror, medium, w, 4, substep));
            substep += 4;
            medium.apply_readback(w, mirror);
        }
        static std::vector<std::uint32_t> bulk;
        bulk.clear();
        for (int cz2 = 8; cz2 <= 10 && bulk.size() < 11500; ++cz2)
            for (int cy2 = 8; cy2 < 72 && bulk.size() < 11500; ++cy2)
                for (int cx2 = 8; cx2 < 72 && bulk.size() < 11500; ++cx2) {
                    const auto ci = static_cast<std::uint32_t>(
                        macro_index(cx2, cy2, cz2));
                    f.ensure_page(ci, w.grid().types()[ci]);
                    bulk.push_back(ci);
                }
        mirror.mark_dirty(bulk.data(), bulk.size());
        CellType* cp2 = f.page(wCell);
        int carved2 = 0;
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (cp2[b2] == kMatWater) { cp2[b2] = kCellAir; ++carved2; }
        mirror.mark_dirty(&wCell, 1);
        medium.wake_cells(&wCell, 1, w, mirror);
        for (int b3 = 0; b3 < 6; ++b3) {
            CHECK(run_batch(dev, mirror, medium, w, 0, substep));
            medium.apply_readback(w, mirror);
        }
        int res2 = 0;
        const CellType* rp2 = f.page(wCell);
        if (rp2)
            for (int b2 = 0; b2 < kSubVoxels; ++b2)
                if (rp2[b2] == kMatWater) ++res2;
        std::printf("[medium_test] carve vs backlog: carved %d, "
                    "resurrected %d\n",
                    carved2, res2);
        CHECK(res2 == 0); // затор не возвращает до-карвную воду
    }
    medium.destroy(); // статики: Vulkan-объекты умирают ДО устройства
    mirror.destroy();
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
        test_frontier_freeze(dev);
        test_seam_tail(dev);
        test_lone_fade(dev);
        test_carve_vs_seam(dev);
    }
    test_carve_agnostic();
    dev.destroy();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    return g_fails == 0 ? 0 : 1;
}
