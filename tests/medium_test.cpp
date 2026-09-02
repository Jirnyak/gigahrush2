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
        // Как в кадре игры: дренаж очереди пробуждений ДО flush (страницы
        // фронтира порции уезжают этим же кадром), инжект — в record ниже.
        medium.drain_wakes(w, mirror);
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
        // клетка выше по сцене; она спит и никуда не делась — тоже
        // инвариант). Допуск истаиваний −4 → −5 пересдан инкрементом 2
        // «Автомат-2»: гало правила «+7» честно исполняет клетки, прежде
        // спавшие ВНЕ списка, и их одиночки получают свой законный ролл
        // (замер: 131 квант, ровно +1 истаивание; масса сходится
        // счётчиком fade).
        CHECK(rubbleQ >= 8 + 128 - 5);
        CHECK(floating == 0);      // осел, не левитирует
        CHECK(onWater == 0);       // утонул: вода не под рублом
        CHECK(maskMismatch == 0);  // маска-кэш == фаза материала (весь пул)
    }

    // ДЕТАЧ = ЗАМЫСЕЛ ВЛАДЕЛЬЦА (2026-08-24): потерявший связность кусок НЕ
    // исчезает и ничего не рождает — ТЕ ЖЕ атомы на месте становятся рыхлой
    // строкой и честно падают автоматом, как вода: один механизм. Полка на
    // столбике; срубаем столбик — полка отрывается, конвертируется и падает.
    {
        // Пол-опора — плита 26×26 = 676 клеток: больше узлового бюджета
        // судьи («сам дом»). Прежние две клетки жили атомным лимитом 512 —
        // под иерархическим судьёй голая пара клеток в пустом торе честно
        // рыхлая (спящие клетки плиты автомату безразличны — инертны).
        for (int px = 68; px <= 93; ++px)
            for (int py = 68; py <= 93; ++py)
                w.grid().fill_cell(px, py, 4, kMatConcrete);
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
            // Шаг сцен 12 клеток: с фронтиром (страницы впереди материи,
            // 2026-08-27) масса летит свободно все 32 подтика = 4 клетки, и
            // прежний шаг 6 позволял ±X-каплям долетать до соседнего пина.
            const int cx = 20 + rgn * 12, cy = 20, cz = 100;
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
        const int zx = 20 + rgn * 12, zy = 20, zz = 100;
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
    CHECK(detach_scan(w, fx, cy, cz, 3, 3, 3, scratch, res) == 27);
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
    // Пик списка ловится ПО ХОДУ прогона: с фронтиром (2026-08-27) осевшая
    // вода честно засыпает, и к концу лист садится ниже окна — прежний пин
    // «в конце всё ещё > окна» был прокси, живым за счёт замороженных
    // границ. Свойство теста — «окно вращалось» — меряется пиком.
    std::uint32_t peakList = 0;
    for (int b = 0; b < 60; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 4, substep));
        substep += 4;
        medium.apply_readback(w, mirror);
        if (medium.list_total() > peakList) peakList = medium.list_total();
    }
    drain_seam(dev, mirror, medium, w, substep);

    const CellType* dp = f.page(dCell);
    int dq = 0;
    if (dp)
        for (int b2 = 0; b2 < kSubVoxels; ++b2)
            if (dp[b2] == kMatWater) ++dq;
    std::printf("[medium_test] seam tail: list %u (peak %u), D page %s, "
                "D water %d\n",
                medium.list_total(), peakList, dp ? "yes" : "NO", dq);
    CHECK(peakList > gpu::GpuMediumPass::kRbSlotCap);
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

// ---------------------------------------------------------------------------
// ИГРОВОЙ КАДЕНС (остаток п.1 core-stabilization.md, решение владельца
// 2026-08-27: «тест до правок, не менять вслепую»). Весь этот файл гоняет
// автомат батчами по 8 подтиков при frameSlot=0; кадр игры (main.cpp,
// «МИР-АВТОМАТ: подтики, назревшие по сим-часам») дёргает 0..4 подтика с
// чередованием слота 0/1 и швом каждый кадр. Фаза Марголуса — функция НОМЕРА
// подтика (base), не нарезки на батчи и не слота кадра, и потому каденсы
// ОБЯЗАНЫ давать БИТ-ИДЕНТИЧНЫЙ CPU-канон — это закон владельца 2026-08-27
// («в игре ничего не должно зависеть от кадра»). Первая версия этого теста
// поймала расхождение (125 против 121 кванта): ленивая материализация ждала
// КАДРАМИ («кадр-два»), и фронт пересекал границы нераскрытых клеток на
// разных номерах подтиков — скорость воды зависела от fps. Вылечено
// фронтиром ([gpu_medium_pass.cpp] apply_readback: страницы соседей живых
// клеток строятся ВПЕРЕДИ материи, гейт не срабатывает). Дополнительно
// пинится то, что верно при любом каденсе: масса точна (подвижная +
// истаявшая == налитой) и форма (вся вода в бассейне). Этот пин обязан
// стоять ДО правок сна сред (макро-дельта) и будильника налива.

void cadence_build_scene(World& w, std::uint32_t& pourCell) {
    // Бассейн 10x10 с бортами — вторая копия сцены первого теста в ДРУГОМ
    // углу тора: статики миров живут до конца процесса, сцены не должны
    // пересекаться.
    for (int x = 24; x < 34; ++x)
        for (int y = 24; y < 34; ++y) {
            w.grid().fill_cell(x, y, 4, kMatConcrete);
            if (x == 24 || x == 33 || y == 24 || y == 33) {
                w.grid().fill_cell(x, y, 5, kMatConcrete);
                w.grid().fill_cell(x, y, 6, kMatConcrete);
            }
        }
    pourCell = static_cast<std::uint32_t>(macro_index(29, 29, 7));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(pourCell, w.grid().types()[pourCell]);
    for (int sx = 2; sx < 6; ++sx)
        for (int sy = 2; sy < 6; ++sy)
            for (int sz = 0; sz < 8; ++sz)
                pg[sub_bit(sx, sy, sz)] = kMatWater;
}

// FNV-дайджест всего CPU-канона: тип клетки, маска, страница материалов.
// Пустые клетки хеш не кормят — дайджест не зависит от порядка обхода пула.
std::uint64_t cadence_digest(World& w, std::size_t* waterOut,
                              std::size_t* outsideOut) {
    const SubField<CellType>* f =
        w.subfields().find<CellType>(kSubMaterialName);
    std::uint64_t h = 1469598103934665603ull;
    auto fold = [&h](std::uint64_t v) {
        for (int i = 0; i < 8; ++i) {
            h ^= (v >> (i * 8)) & 0xFFull;
            h *= 1099511628211ull;
        }
    };
    std::size_t water = 0;
    std::size_t outside = 0;
    std::size_t ci = 0;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x, ++ci) {
                const CellType t = w.grid().types()[ci];
                const SubMask& m = w.grid().mask(x, y, z);
                const CellType* pg = f ? f->page(ci) : nullptr;
                bool any = t != kCellAir || pg != nullptr;
                for (int wi = 0; wi < 8 && !any; ++wi)
                    if (m.words[wi] != 0) any = true;
                if (!any) continue;
                fold(ci);
                fold(t);
                for (int wi = 0; wi < 8; ++wi) fold(m.words[wi]);
                if (pg)
                    for (int b = 0; b < kSubVoxels; ++b) {
                        fold(pg[b]);
                        if (pg[b] == kMatWater && !m.test(b)) {
                            ++water;
                            // Бассейн сцены + столб налива над ним.
                            const bool inBox = x >= 24 && x < 34 &&
                                               y >= 24 && y < 34 &&
                                               z >= 4 && z <= 7;
                            if (!inBox) ++outside;
                        }
                    }
            }
    if (waterOut) *waterOut = water;
    if (outsideOut) *outsideOut = outside;
    return h;
}

void test_cadence_equivalence(gpu::VulkanDevice& dev) {
    constexpr std::uint64_t kTotalSubsteps = 200; // как пины формы: 6.4 с
    constexpr std::size_t kPoured = 128;
    std::uint64_t dig[2] = {0, 0};
    std::size_t water[2] = {0, 0};
    std::size_t outside[2] = {0, 0};
    unsigned live[2] = {0, 0};
    unsigned fade[2] = {0, 0};

    { // Каденс А — стендовый: батчи по 8, слот всегда 0.
        static World w;
        std::uint32_t pourCell = 0;
        cadence_build_scene(w, pourCell);
        static gpu::VoxelMirror mirror;
        CHECK(mirror.init(dev));
        CHECK(mirror.upload_all(w));
        static gpu::GpuMediumPass medium;
        CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
        medium.wake_cells(&pourCell, 1, w, mirror);
        std::uint64_t substep = 0;
        while (substep < kTotalSubsteps) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);
        live[0] = medium.live_count();
        fade[0] = medium.fade_total();
        dig[0] = cadence_digest(w, &water[0], &outside[0]);
        medium.destroy();
        mirror.destroy();
    }

    { // Каденс Б — игровой: 0..4 подтика/кадр, слот 0/1, шов каждый кадр.
        static World w;
        std::uint32_t pourCell = 0;
        cadence_build_scene(w, pourCell);
        static gpu::VoxelMirror mirror;
        CHECK(mirror.init(dev));
        CHECK(mirror.upload_all(w));
        static gpu::GpuMediumPass medium;
        CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
        medium.wake_cells(&pourCell, 1, w, mirror);
        // Паттерн покрывает весь игровой диапазон: пустые кадры (owed 0 —
        // шов едет и без подтиков), обычные 1-2, и 3-4 после лага (кап 8
        // покрыт каденсом А).
        static const std::uint32_t kPat[8] = {1, 0, 2, 1, 0, 4, 3, 1};
        std::uint64_t substep = 0;
        std::uint32_t frame = 0;
        while (substep < kTotalSubsteps) {
            std::uint32_t n = kPat[frame & 7u];
            const std::uint64_t left = kTotalSubsteps - substep;
            if (n > left) n = static_cast<std::uint32_t>(left);
            CHECK(run_batch(dev, mirror, medium, w, n, substep, frame & 1u));
            substep += n;
            medium.apply_readback(w, mirror);
            ++frame;
        }
        drain_seam(dev, mirror, medium, w, substep);
        live[1] = medium.live_count();
        fade[1] = medium.fade_total();
        dig[1] = cadence_digest(w, &water[1], &outside[1]);
        medium.destroy();
        mirror.destroy();
    }

    std::printf("[medium_test] cadence: batch %016llx water %zu+%u fade "
                "(live %u) vs game %016llx water %zu+%u fade (live %u)%s\n",
                static_cast<unsigned long long>(dig[0]), water[0], fade[0],
                live[0], static_cast<unsigned long long>(dig[1]), water[1],
                fade[1], live[1],
                dig[0] == dig[1] ? "" : "  [CADENCE DIVERGENCE — REGRESSION]");
    for (int c = 0; c < 2; ++c) {
        CHECK(water[c] > 0);                      // сцена не пустая
        CHECK(water[c] + fade[c] == kPoured);     // масса точна в КАЖДОМ каденсе
        CHECK(outside[c] == 0);                   // вся вода в бассейне
    }
    CHECK(dig[0] == dig[1]);      // ЗАКОН: физика не зависит от нарезки кадров
    CHECK(water[0] == water[1]);  // и кванты сходятся квант в квант
}

// БЮДЖЕТНЫЙ ДИСПАТЧ (markoaudit/plans/big-judge.md D, закон владельца
// 2026-08-30): за подтик исполняется ~total/stride слотов, остальные
// переносятся замороженными. Что запинено: (1) МАССА точна под бюджетом —
// заморозка не теряет и не плодит атомы; (2) ДЕТЕРМИНИЗМ — два бюджетных
// прогона бит-в-бит (расписание — чистая функция номера подтика);
// (3) БЮДЖЕТ КУСАЕТ — тесный бюджет даёт ДРУГУЮ траекторию, чем полный
// темп (мутация «slot_budgeted всегда true» роняет ровно этот CHECK);
// (4) вся вода в бассейне — заморозка не телепортирует материю.
void test_budget_dispatch(gpu::VulkanDevice& dev) {
    constexpr std::uint64_t kSub = 200;
    constexpr std::size_t kPoured = 128;
    std::uint64_t dig[3] = {0, 0, 0};
    std::size_t water[3] = {0, 0, 0};
    std::size_t outside[3] = {0, 0, 0};
    unsigned fade[3] = {0, 0, 0};
    // Бюджет 4 при live ~50 даёт страйд ~13 (нечётный) — окно кусает
    // сильно, траектория обязана отличаться от полного темпа.
    static World w0, w1, w2;
    World* ws[3] = {&w0, &w1, &w2};
    const std::uint32_t kBudget[3] = {0u, 4u, 4u};
    for (int r = 0; r < 3; ++r) {
        World& w = *ws[r];
        std::uint32_t pourCell = 0;
        cadence_build_scene(w, pourCell);
        static gpu::VoxelMirror mirrors[3];
        static gpu::GpuMediumPass mediums[3];
        gpu::VoxelMirror& mirror = mirrors[r];
        gpu::GpuMediumPass& medium = mediums[r];
        CHECK(mirror.init(dev));
        CHECK(mirror.upload_all(w));
        CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
        medium.set_budget(kBudget[r]);
        medium.wake_cells(&pourCell, 1, w, mirror);
        std::uint64_t substep = 0;
        while (substep < kSub) {
            CHECK(run_batch(dev, mirror, medium, w, 8, substep));
            substep += 8;
            medium.apply_readback(w, mirror);
        }
        drain_seam(dev, mirror, medium, w, substep);
        dig[r] = cadence_digest(w, &water[r], &outside[r]);
        fade[r] = medium.fade_total();
        medium.destroy();
        mirror.destroy();
    }
    std::printf("[medium_test] budget: full %016llx water %zu+%u | b4 "
                "%016llx water %zu+%u | b4' %016llx%s\n",
                static_cast<unsigned long long>(dig[0]), water[0], fade[0],
                static_cast<unsigned long long>(dig[1]), water[1], fade[1],
                static_cast<unsigned long long>(dig[2]),
                dig[1] == dig[2] ? "" : "  [BUDGET NONDETERMINISM]");
    for (int r = 0; r < 3; ++r) {
        CHECK(water[r] + fade[r] == kPoured); // масса точна под бюджетом
        CHECK(outside[r] == 0);               // заморозка не телепортирует
    }
    CHECK(dig[1] == dig[2]); // детерминизм бюджетного расписания
    CHECK(dig[0] != dig[1]); // бюджет кусает: тесный темп != полный
}

// flow РЫХЛОГО = 1.0 (решение владельца 2026-09-01): осыпь ЛАВИННА на
// масштабе подтика и ДОСТИГАЕТ СНА — прежние 0.1 кодировали угол откоса в
// вероятность, а угол держит сама геометрия ската Марголуса; вероятность
// лишь растягивала осадку в «плач» редкими каплями, и куча не могла
// заснуть (плейтест владельца: «рабл словно плачет субвокселями»).
// Гейт СКОРОСТИ СНА: столб рыхлого оседает и live пустеет за 10 батчей
// (80 подтиков = 2.5 с); мутация flow 0.1 оставляет live непустым.
void test_rubble_settles_fast(gpu::VulkanDevice& dev) {
    static World w;
    for (int x = 40; x < 46; ++x)
        for (int y = 40; y < 46; ++y)
            w.grid().fill_cell(x, y, 30, kMatConcrete);
    const std::uint32_t pourCell =
        static_cast<std::uint32_t>(macro_index(42, 42, 32));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(pourCell, w.grid().types()[pourCell]);
    // Узкая БАШНЯ 2x2x8: после падения на плиту обязана расползтись именно
    // СКАТОМ (перепад >= 2) — гравитация одна такой столб не разбирает.
    std::uint32_t poured = 0;
    for (int sx = 3; sx < 5; ++sx)
        for (int sy = 3; sy < 5; ++sy)
            for (int sz = 0; sz < 8; ++sz) {
                pg[sub_bit(sx, sy, sz)] = kMatRubble;
                ++poured;
            }
    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    medium.wake_cells(&pourCell, 1, w, mirror);
    std::uint64_t substep = 0;
    std::uint32_t liveEarly = ~0u;
    std::uint32_t liveTail[3] = {~0u, ~0u, ~0u};
    for (int b = 0; b < 10; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
        if (b == 6) liveEarly = medium.live_count();
        if (b >= 7) liveTail[b - 7] = medium.live_count();
    }
    std::printf("[medium_test] rubble-settle: live@7 %u, live %u/%u/%u (батчи 8..10), "
                "fade %u\n",
                liveEarly, liveTail[0], liveTail[1], liveTail[2],
                medium.fade_total());
    // ЗОМБИ-НОЛЬ (плановый гейт «Автомат-2» инкр. 2): лавина осела — live
    // РОВНО НОЛЬ, не «≤8». Прежний хвост 2 клетки был вечными зомби-
    // владельцами граничных блоков (их держал face-пуш в списке); правило
    // «+7» гейта исполняет владельца, пока сосед активен, ДЕРЖАТЬ его
    // бодрым не нужно — класс умер по построению. И стабильно три батча:
    // «плач» (редкие капли, будящие клетки) мёртв.
    CHECK(liveTail[2] == 0);
    CHECK(liveTail[0] == liveTail[1] && liveTail[1] == liveTail[2]);
    // ЛАВИННОСТЬ (пересдано инкрементом 2 «Автомат-2»): в битовом мире
    // live к 40-му подтику законно несёт дозревающую тишину (клетка активна
    // 16 тихих подтиков после последнего хода — «финал обязан успеть в
    // pack»), поэтому мера — ПОЛНЫЙ СОН к подтику 56: последний ход лавины
    // ~26-й подтик + порог 16 + гало-хвост < 56 (кривая замера: батчи
    // 0,0,32,32,12,8,0...). Тянущийся скат (flow 0.1) капает и после 56-го.
    CHECK(liveEarly == 0);
    drain_seam(dev, mirror, medium, w, substep);
    // Масса точна: осевшее в CPU-каноне + истаявшие одиночки == налитому.
    std::uint32_t settled = 0;
    for (int cz = 30; cz <= 33; ++cz)
        for (int cx = 40; cx < 46; ++cx)
            for (int cy = 40; cy < 46; ++cy) {
                const CellType* p = f.page(static_cast<std::size_t>(
                    macro_index(cx, cy, cz)));
                if (!p) continue;
                for (int b2 = 0; b2 < kSubVoxels; ++b2)
                    if (p[b2] == kMatRubble) ++settled;
            }
    CHECK(settled + medium.fade_total() == poured);
    medium.destroy();
    mirror.destroy();
}

// ==== ИНКРЕМЕНТ 2 «АВТОМАТ-2»: исполнение от битсета (medium-bitmask.md) ===
// Гейт-сверка нервной системы: словный гейт обязан пересобирать список-
// однодневку РОВНО как дилатацию битсета правилом «бит мой | 7
// „+"-соседей». Протокол: батч 8 → idle → читаем битсет B → батч 1 (его
// гейт стартует от B) → список и счёт обязаны равняться CPU-дилатации B.
// Сцена несёт оба класса материи (вода растекается и спит нутром, рыхлое
// осыпается и спит целиком) + инжект спящей клетки посреди прогона.
// (Эволюция сверки инкремента 1 «биты == следующему списку»: список стал
// ПРОИЗВОДНОЙ битсета, сверяем производство.)
void test_bitset_execution(gpu::VulkanDevice& dev) {
    constexpr std::uint32_t kCells = static_cast<std::uint32_t>(kMacroCells);
    static World w;
    // Плита-бассейн: борта держат воду, рыхлое оседает на плиту.
    for (int x = 40; x < 50; ++x)
        for (int y = 40; y < 50; ++y)
            w.grid().fill_cell(x, y, 30, kMatConcrete);
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    const std::uint32_t rubbleCell =
        static_cast<std::uint32_t>(macro_index(42, 42, 32));
    const std::uint32_t waterCell =
        static_cast<std::uint32_t>(macro_index(46, 46, 32));
    CellType* rp = f.ensure_page(rubbleCell, w.grid().types()[rubbleCell]);
    CellType* wp = f.ensure_page(waterCell, w.grid().types()[waterCell]);
    for (int sx = 3; sx < 5; ++sx)
        for (int sy = 3; sy < 5; ++sy)
            for (int sz = 0; sz < 8; ++sz) {
                rp[sub_bit(sx, sy, sz)] = kMatRubble;
                wp[sub_bit(sx, sy, sz)] = kMatWater;
            }
    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    std::uint32_t seeds[2] = {rubbleCell, waterCell};
    medium.wake_cells(seeds, 2, w, mirror);

    // Сверка производства: список-однодневка == CPU-дилатация битсета,
    // снятого ДО подтика, чей гейт его собрал.
    std::vector<std::uint32_t> bits(kCells / 32u);
    std::vector<std::uint8_t> exec(kCells);
    auto gate_check = [&](std::uint64_t& sub) {
        // Битсет B на паузе (queue idle) — вход следующего гейта.
        if (!readback(dev, medium.active_bits_buffer(), kCells / 8u,
                      bits.data()))
            return false;
        // CPU-эталон дилатации «бит мой | 7 „+"-соседей» (тор).
        auto bit_at = [&](int x, int y, int z) {
            std::uint32_t ci = static_cast<std::uint32_t>(macro_index(
                x & (kMacroDim - 1), y & (kMacroDim - 1),
                z & (kMacroDim - 1)));
            return (bits[ci >> 5] >> (ci & 31u)) & 1u;
        };
        std::uint32_t expected = 0;
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    std::uint32_t e = 0;
                    for (int dz = 0; dz <= 1 && !e; ++dz)
                        for (int dy = 0; dy <= 1 && !e; ++dy)
                            for (int dx = 0; dx <= 1 && !e; ++dx)
                                e |= bit_at(x + dx, y + dy, z + dz);
                    exec[macro_index(x, y, z)] =
                        static_cast<std::uint8_t>(e);
                    expected += e;
                }
        // Один подтик (в общей нумерации — закон каденса): его гейт
        // стартует ровно от B.
        if (!run_batch(dev, mirror, medium, w, 1, sub)) return false;
        sub += 1;
        std::uint32_t cnt[4] = {0};
        if (!readback(dev, medium.counters_buffer(), sizeof(cnt), cnt))
            return false;
        if (cnt[3] != expected) return false; // счёт гейта == эталону
        static std::vector<std::uint32_t> list;
        list.assign(cnt[3], 0u);
        if (cnt[3] > 0 &&
            !readback(dev, medium.exec_list_buffer(),
                      cnt[3] * sizeof(std::uint32_t), list.data()))
            return false;
        for (std::uint32_t ci : list)
            if (!exec[ci]) return false; // клетка списка вне дилатации
        return true; // счёт == |E| и все в E => равенство множеств
    };

    std::uint64_t substep = 0;
    for (int b = 0; b < 6; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
        CHECK(gate_check(substep)); // внутри ещё +1 подтик сверки
        // Посреди прогона — инжект по уже осевшему рыхлому (путь
        // писателя: спящая клетка входит через run_inject битом).
        if (b == 3) medium.wake_cells(&rubbleCell, 1, w, mirror);
    }
    std::printf("[medium_test] bitset-exec: live %u, сверка 6/6 батчей\n",
                medium.live_count());
    medium.destroy();
    mirror.destroy();
}

// ==== ИНКРЕМЕНТ 3 «АВТОМАТ-2»: сон-состояние (medium-bitmask.md) ===========
// ГЕЙТ «ВИСЯКИ» (план §3.3, корень В1 плейтеста «первый раз идеально, потом
// висяки»): куча оседает и ЗАСЫПАЕТ (тишина насыщена) → карв нижнего слоя
// путём игры (страница + mark_dirty + wake_cells) → верх ОБЯЗАН упасть и
// доспать: ни одного атома без опоры, масса точна, live снова 0. До
// инкремента 3 разбуженная писателем клетка получала РОВНО ОДИН подтик
// (settle видел зрелую тишину и усыплял обратно) — нижний слой висел.
void test_recarve_no_floating(gpu::VulkanDevice& dev) {
    static World w;
    for (int x = 60; x < 66; ++x)
        for (int y = 60; y < 66; ++y)
            w.grid().fill_cell(x, y, 30, kMatConcrete);
    const auto towerCell = static_cast<std::uint32_t>(macro_index(62, 62, 32));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(towerCell, w.grid().types()[towerCell]);
    std::uint32_t poured = 0;
    for (int sx = 3; sx < 5; ++sx)
        for (int sy = 3; sy < 5; ++sy)
            for (int sz = 0; sz < 8; ++sz) {
                pg[sub_bit(sx, sy, sz)] = kMatRubble;
                ++poured;
            }
    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    medium.wake_cells(&towerCell, 1, w, mirror);
    std::uint64_t substep = 0;
    for (int b = 0; b < 8; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
    }
    drain_seam(dev, mirror, medium, w, substep);
    CHECK(medium.live_count() == 0); // куча уснула, тишина насыщена

    // СДВИГ НА НЕЧЁТНУЮ ФАЗУ: первый подтик после карва обязан быть
    // НЕудачным для падения (off_z=1 — пара z (1,2), верхний атом
    // неподвижен), иначе детерминированное расписание маскирует корень В1
    // удачной чётностью (атом падает первым же подтиком и сам ставит себе
    // changed — мутация «инжект не гасит часы» оставалась зелёной).
    CHECK(run_batch(dev, mirror, medium, w, 1, substep));
    substep += 1;

    // Повторный карв: нижний слой осевшей кучи — в воздух (путь игры).
    const auto bedCell = static_cast<std::uint32_t>(macro_index(62, 62, 31));
    CellType* bp = f.page(bedCell);
    CHECK(bp != nullptr);
    std::uint32_t carved = 0;
    for (int sx = 0; sx < 8; ++sx)
        for (int sy = 0; sy < 8; ++sy)
            if (bp[sub_bit(sx, sy, 0)] == kMatRubble) {
                bp[sub_bit(sx, sy, 0)] = kCellAir;
                ++carved;
            }
    CHECK(carved > 0);
    mirror.mark_dirty(&bedCell, 1);
    medium.wake_cells(&bedCell, 1, w, mirror);

    for (int b = 0; b < 8; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
    }
    drain_seam(dev, mirror, medium, w, substep);

    // Ни одного атома без опоры; масса точна; куча доспала.
    auto mat_at = [&](int gx, int gy, int gz) -> CellType {
        const auto ci = static_cast<std::uint32_t>(macro_index(
            (gx >> 3) & (kMacroDim - 1), (gy >> 3) & (kMacroDim - 1),
            (gz >> 3) & (kMacroDim - 1)));
        const CellType* p = f.page(ci);
        if (p) return p[sub_bit(gx & 7, gy & 7, gz & 7)];
        return w.grid().types()[ci];
    };
    int floating = 0;
    std::uint32_t settled = 0;
    for (int cz = 30; cz <= 33; ++cz)
        for (int cx = 60; cx < 66; ++cx)
            for (int cy = 60; cy < 66; ++cy) {
                const CellType* p = f.page(
                    static_cast<std::uint32_t>(macro_index(cx, cy, cz)));
                if (!p) continue;
                for (int bit = 0; bit < kSubVoxels; ++bit) {
                    if (p[bit] != kMatRubble) continue;
                    ++settled;
                    const int gx = cx * 8 + (bit & 7);
                    const int gy = cy * 8 + ((bit >> 3) & 7);
                    const int gz = cz * 8 + ((bit >> 6) & 7);
                    if (mat_at(gx, gy, gz - 1) == kCellAir) ++floating;
                }
            }
    std::printf("[medium_test] recarve: carved %u, settled %u, floating %d, "
                "live %u, fade %u\n",
                carved, settled, floating, medium.live_count(),
                medium.fade_total());
    CHECK(floating == 0); // висяков нет: верх упал следом
    CHECK(settled + medium.fade_total() == poured - carved);
    CHECK(medium.live_count() == 0); // и доспала обратно в ЗОМБИ-НОЛЬ
    medium.destroy();
    mirror.destroy();
}

// ГЕЙТ «СХОДИМОСТЬ ПОД БЮДЖЕТОМ» (план §3.1, петля К2 — доказана A/B на
// сейве владельца: с бюджетом live рос без плато, потому что часы тишины
// замерзали у неисполненных и сток сна делился на страйд). Тесный бюджет 2
// при live ~30-50: физика честно замедлена в разы, но СТОК СНА работает на
// полной скорости у тихих — башня рыхлого ОБЯЗАНА доспать до нуля за
// разумное число подтиков. Расписание бюджета детерминировано (хеш клетки
// и подтика) — номер батча сна воспроизводим бит-в-бит.
void test_sleep_under_budget(gpu::VulkanDevice& dev) {
    static World w;
    for (int x = 40; x < 46; ++x)
        for (int y = 40; y < 46; ++y)
            w.grid().fill_cell(x, y, 30, kMatConcrete);
    const auto pourCell = static_cast<std::uint32_t>(macro_index(42, 42, 32));
    SubField<CellType>& f =
        w.subfields().get_or_create<CellType>(kSubMaterialName);
    CellType* pg = f.ensure_page(pourCell, w.grid().types()[pourCell]);
    std::uint32_t poured = 0;
    for (int sx = 3; sx < 5; ++sx)
        for (int sy = 3; sy < 5; ++sy)
            for (int sz = 0; sz < 8; ++sz) {
                pg[sub_bit(sx, sy, sz)] = kMatRubble;
                ++poured;
            }
    static gpu::VoxelMirror mirror;
    CHECK(mirror.init(dev));
    CHECK(mirror.upload_all(w));
    static gpu::GpuMediumPass medium;
    CHECK(medium.init(&dev, GIGA_SHADER_DIR, mirror));
    medium.set_budget(2);
    medium.wake_cells(&pourCell, 1, w, mirror);
    std::uint64_t substep = 0;
    std::uint32_t liveAt = ~0u;
    for (int b = 0; b < 40; ++b) {
        CHECK(run_batch(dev, mirror, medium, w, 8, substep));
        substep += 8;
        medium.apply_readback(w, mirror);
        if (b == 39) liveAt = medium.live_count();
    }
    drain_seam(dev, mirror, medium, w, substep);
    std::printf("[medium_test] sleep-under-budget: live@40 %u, fade %u\n",
                liveAt, medium.fade_total());
    CHECK(liveAt == 0);
    // Масса точна и под тесным бюджетом.
    std::uint32_t settled = 0;
    for (int cz = 30; cz <= 33; ++cz)
        for (int cx = 40; cx < 46; ++cx)
            for (int cy = 40; cy < 46; ++cy) {
                const CellType* p = f.page(
                    static_cast<std::uint32_t>(macro_index(cx, cy, cz)));
                if (!p) continue;
                for (int bit = 0; bit < kSubVoxels; ++bit)
                    if (p[bit] == kMatRubble) ++settled;
            }
    CHECK(settled + medium.fade_total() == poured);
    medium.destroy();
    mirror.destroy();
}

// ==== СТЕНД ИНКРЕМЕНТА 0 «АВТОМАТ-2» (markoaudit/plans/medium-bitmask.md) ==
// Цена битсетной «нервной системы» — замер ДО правок боевого medium_sim.
// Формы плотного гейта (shaders/bitmask_stand.comp):
//   А: PREPARE → GATE (2М тредов, atomic-append выживших) → FINALIZE
//      (count → 2D indirect, лимит оси 65535) → WORK indirect по списку;
//   Б: плотный WORK 128^3 воркгрупп (воркгруппа = клетка) с ранним выходом.
// Сценарии битсета — из замеров medium-stability.md: пусто (этаж спит),
// типичный ~2k активных (live сейва владельца), горб ~24k кластером
// (§63-горб без бюджета), полный 2М (катастрофа). Тест ПИНИТ КОРРЕКТНОСТЬ
// (обе формы исполняют ровно множество «бит мой | 7 „+"-соседей», счёт
// компактации точен — против CPU-эталона), а миллисекунды ПЕЧАТАЕТ: число
// уходит в план решением «форма А или Б», в CHECK его не заводим — закон
// дерева: «бенчмарк, роняющий сборку на медленной машине, никто не гоняет».

// Один сабмит с ожиданием — команды пишет вызывающий через рекордер.
template <typename RecordFn>
bool stand_submit(const gpu::VulkanDevice& dev, RecordFn record) {
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
        record(cmd);
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

void test_bitmask_gate_stand(gpu::VulkanDevice& dev) {
    constexpr std::uint32_t kCells = static_cast<std::uint32_t>(kMacroCells);
    constexpr std::uint32_t kWords = kCells / 32u;
    constexpr std::uint32_t kGateGroups = kCells / 64u; // 32768
    // Режимы — зеркало bitmask_stand.comp.
    constexpr std::uint32_t kStPrepare = 0, kStGate = 1, kStFinalize = 2,
                            kStWorkList = 3, kStWorkDense = 4, kStGate32 = 5;
    // Прогрев прогоняет пайплайн/кэши, замер делится на kIters.
    constexpr std::uint32_t kWarm = 4, kIters = 32;

    // Замер без таймстампов — не замер: машина без них не даёт числа
    // решению «форма А или Б», это красный, как и машина без GPU.
    CHECK(dev.graphicsTimestampValidBits != 0);

    // --- буферы стенда ---
    gpu::VulkanBuffer listBuf, cntBuf, outBuf;
    CHECK(listBuf.create_device_local_empty(
        dev, kCells * 4ull, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
        "bitmask-stand list"));
    CHECK(cntBuf.create_device_local_empty(
        dev, 4 * sizeof(std::uint32_t),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT
            | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT
            | VK_BUFFER_USAGE_TRANSFER_SRC_BIT
            | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        "bitmask-stand counters"));
    CHECK(outBuf.create_device_local_empty(
        dev, kCells * 4ull,
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT
            | VK_BUFFER_USAGE_TRANSFER_SRC_BIT
            | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        "bitmask-stand out"));

    // --- дескрипторы: 4 storage-биндинга одним сетом ---
    VkDescriptorSetLayoutBinding binds[4]{};
    for (std::uint32_t b = 0; b < 4; ++b) {
        binds[b].binding = b;
        binds[b].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        binds[b].descriptorCount = 1;
        binds[b].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    }
    VkDescriptorSetLayoutCreateInfo slci{};
    slci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    slci.bindingCount = 4;
    slci.pBindings = binds;
    VkDescriptorSetLayout setLayout = VK_NULL_HANDLE;
    CHECK(vkCreateDescriptorSetLayout(dev.device, &slci, nullptr, &setLayout)
          == VK_SUCCESS);
    VkDescriptorPoolSize poolSize{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 4};
    VkDescriptorPoolCreateInfo dpci{};
    dpci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    dpci.maxSets = 1;
    dpci.poolSizeCount = 1;
    dpci.pPoolSizes = &poolSize;
    VkDescriptorPool descPool = VK_NULL_HANDLE;
    CHECK(vkCreateDescriptorPool(dev.device, &dpci, nullptr, &descPool)
          == VK_SUCCESS);
    VkDescriptorSetAllocateInfo dsai{};
    dsai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    dsai.descriptorPool = descPool;
    dsai.descriptorSetCount = 1;
    dsai.pSetLayouts = &setLayout;
    VkDescriptorSet set = VK_NULL_HANDLE;
    CHECK(vkAllocateDescriptorSets(dev.device, &dsai, &set) == VK_SUCCESS);
    auto bind_buffer = [&](std::uint32_t binding, VkBuffer buf) {
        VkDescriptorBufferInfo info{buf, 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet wr{};
        wr.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        wr.dstSet = set;
        wr.dstBinding = binding;
        wr.descriptorCount = 1;
        wr.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        wr.pBufferInfo = &info;
        vkUpdateDescriptorSets(dev.device, 1, &wr, 0, nullptr);
    };
    bind_buffer(1, listBuf.buffer);
    bind_buffer(2, cntBuf.buffer);
    bind_buffer(3, outBuf.buffer);

    // --- пайплайн из bitmask_stand.comp.spv (скелет — create_pipeline
    // боевого пасса; push = uvec4, x = режим) ---
    VkPipelineLayout pipeLayout = VK_NULL_HANDLE;
    VkPipeline pipeline = VK_NULL_HANDLE;
    {
        std::string spv = GIGA_SHADER_DIR;
        spv += "/bitmask_stand.comp.spv";
        std::FILE* f = std::fopen(spv.c_str(), "rb");
        CHECK(f != nullptr);
        std::vector<char> code;
        if (f) {
            std::fseek(f, 0, SEEK_END);
            long n = std::ftell(f);
            std::fseek(f, 0, SEEK_SET);
            code.resize(static_cast<std::size_t>(n));
            CHECK(std::fread(code.data(), 1, code.size(), f) == code.size());
            std::fclose(f);
        }
        VkShaderModuleCreateInfo smci{};
        smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        smci.codeSize = code.size();
        smci.pCode = reinterpret_cast<const std::uint32_t*>(code.data());
        VkShaderModule mod = VK_NULL_HANDLE;
        CHECK(vkCreateShaderModule(dev.device, &smci, nullptr, &mod)
              == VK_SUCCESS);
        VkPushConstantRange pcr{VK_SHADER_STAGE_COMPUTE_BIT, 0,
                                4 * sizeof(std::uint32_t)};
        VkPipelineLayoutCreateInfo plci{};
        plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        plci.setLayoutCount = 1;
        plci.pSetLayouts = &setLayout;
        plci.pushConstantRangeCount = 1;
        plci.pPushConstantRanges = &pcr;
        CHECK(vkCreatePipelineLayout(dev.device, &plci, nullptr, &pipeLayout)
              == VK_SUCCESS);
        VkComputePipelineCreateInfo cpci{};
        cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        cpci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        cpci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        cpci.stage.module = mod;
        cpci.stage.pName = "main";
        cpci.layout = pipeLayout;
        CHECK(vkCreateComputePipelines(dev.device, VK_NULL_HANDLE, 1, &cpci,
                                       nullptr, &pipeline)
              == VK_SUCCESS);
        vkDestroyShaderModule(dev.device, mod, nullptr);
    }

    // --- таймстампы: свой пул на 2 запроса; MoltenVK-урок gpu_timer.h —
    // доверять суммарному интервалу, не пер-диспатчным срезам ---
    VkQueryPool queryPool = VK_NULL_HANDLE;
    VkQueryPoolCreateInfo qci{};
    qci.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
    qci.queryType = VK_QUERY_TYPE_TIMESTAMP;
    qci.queryCount = 2;
    CHECK(vkCreateQueryPool(dev.device, &qci, nullptr, &queryPool)
          == VK_SUCCESS);
    const double periodNs = dev.props.limits.timestampPeriod;
    const std::uint64_t tsMask =
        dev.graphicsTimestampValidBits >= 64
            ? ~0ull
            : ((1ull << dev.graphicsTimestampValidBits) - 1ull);

    std::printf("[bitmask-stand] warm %u, iters %u; maxWG %u/%u/%u, "
                "ts period %.3f ns\n",
                kWarm, kIters, dev.props.limits.maxComputeWorkGroupCount[0],
                dev.props.limits.maxComputeWorkGroupCount[1],
                dev.props.limits.maxComputeWorkGroupCount[2], periodNs);

    auto push_mode = [&](VkCommandBuffer cmd, std::uint32_t mode) {
        std::uint32_t pc[4] = {mode, 0, 0, 0};
        vkCmdPushConstants(cmd, pipeLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                           sizeof(pc), pc);
    };
    auto barrier = [](VkCommandBuffer cmd) {
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT
                           | VK_ACCESS_INDIRECT_COMMAND_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT
                                 | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
                             0, 1, &mb, 0, nullptr, 0, nullptr);
    };
    // Один «подтик» форм А/А2: сброс → гейт → укладка indirect → работа.
    // А судит клетку тредом (2М тредов × 8 бит), А2 — словом (65536
    // тредов × 8 слов, дилатация сдвигами).
    enum StandForm { kFormA, kFormA2, kFormB };
    auto iter_form_a = [&](VkCommandBuffer cmd, bool wordGate) {
        push_mode(cmd, kStPrepare);
        vkCmdDispatch(cmd, 1, 1, 1);
        barrier(cmd);
        push_mode(cmd, wordGate ? kStGate32 : kStGate);
        vkCmdDispatch(cmd, wordGate ? kWords / 64u : kGateGroups, 1, 1);
        barrier(cmd);
        push_mode(cmd, kStFinalize);
        vkCmdDispatch(cmd, 1, 1, 1);
        barrier(cmd);
        push_mode(cmd, kStWorkList);
        vkCmdDispatchIndirect(cmd, cntBuf.buffer, 0);
        barrier(cmd);
    };
    // Один «подтик» формы Б: плотный диспатч воркгруппа-на-клетку.
    auto iter_form_b = [&](VkCommandBuffer cmd) {
        push_mode(cmd, kStWorkDense);
        vkCmdDispatch(cmd, static_cast<std::uint32_t>(kMacroDim),
                      static_cast<std::uint32_t>(kMacroDim),
                      static_cast<std::uint32_t>(kMacroDim));
        barrier(cmd);
    };
    // Прогон формы: чистый uOut → прогрев → таймстампы вокруг kIters.
    auto run_form = [&](StandForm form, double& msOut) {
        bool ok = stand_submit(dev, [&](VkCommandBuffer cmd) {
            vkCmdFillBuffer(cmd, outBuf.buffer, 0, VK_WHOLE_SIZE, 0);
            VkMemoryBarrier mb{};
            mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            mb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT
                               | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                                 VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1,
                                 &mb, 0, nullptr, 0, nullptr);
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    pipeLayout, 0, 1, &set, 0, nullptr);
            auto iter = [&](VkCommandBuffer c) {
                if (form == kFormB) iter_form_b(c);
                else iter_form_a(c, form == kFormA2);
            };
            for (std::uint32_t i = 0; i < kWarm; ++i) iter(cmd);
            vkCmdResetQueryPool(cmd, queryPool, 0, 2);
            vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                                queryPool, 0);
            for (std::uint32_t i = 0; i < kIters; ++i) iter(cmd);
            vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
                                queryPool, 1);
        });
        CHECK(ok);
        std::uint64_t ts[2] = {0, 0};
        CHECK(vkGetQueryPoolResults(dev.device, queryPool, 0, 2, sizeof(ts),
                                    ts, sizeof(ts[0]),
                                    VK_QUERY_RESULT_64_BIT
                                        | VK_QUERY_RESULT_WAIT_BIT)
              == VK_SUCCESS);
        msOut = static_cast<double>(((ts[1] & tsMask) - (ts[0] & tsMask))
                                    & tsMask)
                * periodNs / 1.0e6 / kIters;
    };
    // Сверка множества исполненных: uOut == (kWarm+kIters | 0) поклеточно.
    auto verify_out = [&](const std::vector<std::uint8_t>& exec) {
        static std::vector<std::uint32_t> out;
        out.assign(kCells, 0xFFFFFFFFu);
        if (!readback(dev, outBuf.buffer, kCells * 4ull, out.data())) return false;
        for (std::uint32_t ci = 0; ci < kCells; ++ci)
            if (out[ci] != (exec[ci] ? kWarm + kIters : 0u)) return false;
        return true;
    };

    // --- сценарии ---
    struct Scenario {
        const char* name;
        std::uint32_t seeds; // 0 = пусто, ~0 = полный, иначе — счёт
        bool hump;
    };
    const Scenario scenarios[4] = {
        {"пусто   ", 0u, false},
        {"типичный", 2048u, false},
        {"горб    ", 0u, true},
        {"полный  ", ~0u, false},
    };
    std::vector<std::uint32_t> bits(kWords);
    std::vector<std::uint8_t> exec(kCells);
    for (const Scenario& sc : scenarios) {
        std::fill(bits.begin(), bits.end(), 0u);
        if (sc.seeds == ~0u) {
            std::fill(bits.begin(), bits.end(), 0xFFFFFFFFu);
        } else if (sc.hump) {
            // Кластер обрушения ~24k клеток: куб 29^3 (§63-горб 23.9k).
            for (int z = 40; z < 69; ++z)
                for (int y = 40; y < 69; ++y)
                    for (int x = 40; x < 69; ++x) {
                        std::uint32_t ci = static_cast<std::uint32_t>(
                            macro_index(x, y, z));
                        bits[ci >> 5] |= 1u << (ci & 31u);
                    }
        } else {
            // Рассев мультипликативным хешем — детерминирован, без ГСЧ.
            for (std::uint32_t k = 0; k < sc.seeds; ++k) {
                std::uint32_t ci = (k * 2654435761u) % kCells;
                bits[ci >> 5] |= 1u << (ci & 31u);
            }
        }
        // CPU-эталон предиката «бит мой | 7 „+"-соседей» (тор).
        std::uint32_t active = 0, expected = 0;
        auto bit_at = [&](int x, int y, int z) {
            std::uint32_t ci = static_cast<std::uint32_t>(macro_index(
                x & (kMacroDim - 1), y & (kMacroDim - 1),
                z & (kMacroDim - 1)));
            return (bits[ci >> 5] >> (ci & 31u)) & 1u;
        };
        for (int z = 0; z < kMacroDim; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    std::uint32_t ci =
                        static_cast<std::uint32_t>(macro_index(x, y, z));
                    active += bit_at(x, y, z);
                    std::uint32_t e = 0;
                    for (int dz = 0; dz <= 1 && !e; ++dz)
                        for (int dy = 0; dy <= 1 && !e; ++dy)
                            for (int dx = 0; dx <= 1 && !e; ++dx)
                                e |= bit_at(x + dx, y + dy, z + dz);
                    exec[ci] = static_cast<std::uint8_t>(e);
                    expected += e;
                }

        gpu::VulkanBuffer bitsBuf;
        CHECK(bitsBuf.create_device_local(dev, bits.data(), kWords * 4ull,
                                          VK_BUFFER_USAGE_STORAGE_BUFFER_BIT,
                                          "bitmask-stand bits"));
        bind_buffer(0, bitsBuf.buffer);

        double msA = 0.0, msA2 = 0.0, msB = 0.0;
        // Счёт компактации гейта == CPU-эталону (последняя итерация
        // оставила его в uCnt[3]) — у ОБЕИХ компактирующих форм.
        std::uint32_t cnt[4] = {0, 0, 0, 0};
        run_form(kFormA, msA);
        CHECK(readback(dev, cntBuf.buffer, sizeof(cnt), cnt));
        CHECK(cnt[3] == expected);
        CHECK(verify_out(exec));
        run_form(kFormA2, msA2);
        CHECK(readback(dev, cntBuf.buffer, sizeof(cnt), cnt));
        CHECK(cnt[3] == expected);
        CHECK(verify_out(exec));
        run_form(kFormB, msB);
        CHECK(verify_out(exec));

        std::printf("[bitmask-stand] %s: A %8.3f | А2-слово %8.3f | Б "
                    "%8.3f мс/подтик (active %u, exec %u)\n",
                    sc.name, msA, msA2, msB, active, expected);
        bitsBuf.destroy(dev);
    }

    vkDestroyQueryPool(dev.device, queryPool, nullptr);
    vkDestroyPipeline(dev.device, pipeline, nullptr);
    vkDestroyPipelineLayout(dev.device, pipeLayout, nullptr);
    vkDestroyDescriptorPool(dev.device, descPool, nullptr);
    vkDestroyDescriptorSetLayout(dev.device, setLayout, nullptr);
    outBuf.destroy(dev);
    cntBuf.destroy(dev);
    listBuf.destroy(dev);
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
        test_cadence_equivalence(dev);
        test_budget_dispatch(dev);
        test_rubble_settles_fast(dev);
        test_bitset_execution(dev);
        test_recarve_no_floating(dev);
        test_sleep_under_budget(dev);
        test_bitmask_gate_stand(dev);
    }
    test_carve_agnostic();
    dev.destroy();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    return g_fails == 0 ? 0 : 1;
}
