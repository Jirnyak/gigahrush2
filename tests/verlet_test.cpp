// GPU-верле антуража — headless-тесты НАСТОЯЩЕГО SPIR-V (verlet_sim.comp).
// До 2026-08-31 план честно писал «ctest не исполняет ни одной строки GLSL и
// не поймает ни одной регрессии слияния» (verlet-merge.md §6) — этот бинарь
// закрывает ровно эту дыру тем же приёмом, что medium_test: init_headless()
// без окна и свапчейна, VerletPass в compute-only режиме (renderPass = null),
// физика читается с host-visible буферов после queue-idle.
//
// Инварианты, а не пиксели:
//   ПОДВЕС  — цепь на двух пинах провисает серединой и ДОСТИГАЕТ покоя;
//   ПОСАДКА — цепь без пинов падает и ложится НА маску, не проваливаясь;
//   ИЗОТРОПИЯ — та же посадка при гравитации +X о стену (вектор, не ось Z);
//   ТКАНЬ   — решётка 8x4 с пиновой верхней строкой висит и держит restY;
//   ДЕТЕРМИНИЗМ — два одинаковых прогона бит-в-бит (фундамент пин-протокола);
//   ТЕЛА    — толкатель выдавливает точки из своего радиуса.
//
// Нет GPU-устройства — тест ПАДАЕТ, не скипается (закон medium_test:
// GPU — осознанная часть ядра, дерево без него не зелёное).
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "render/verlet_pass.h"
#include "render/vk_device.h"
#include "render/voxel_mirror.h"
#include "world/materials.h" // kMatConcrete
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

constexpr float kDt = 1.0f / 60.0f; // референсный шаг пин-протокола

// N симов одной командой с ожиданием: барьеры внутри record_sim упорядочивают
// диспатчи между собой, после queue-idle mapped-буфер честен (host-coherent).
bool run_sims(gpu::VulkanDevice& dev, gpu::VerletPass& pass, int n,
              vec3 gravity) {
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
        for (int i = 0; i < n; ++i) pass.record_sim(cmd, kDt, gravity);
        vkEndCommandBuffer(cmd);
        VkSubmitInfo si{};
        si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        si.commandBufferCount = 1;
        si.pCommandBuffers = &cmd;
        ok = vkQueueSubmit(dev.graphicsQueue, 1, &si, VK_NULL_HANDLE) ==
                 VK_SUCCESS &&
             vkQueueWaitIdle(dev.graphicsQueue) == VK_SUCCESS;
    }
    vkDestroyCommandPool(dev.device, pool, nullptr);
    return ok;
}

// Цепь W=8 из готовых позиций: meta = {restX, alive, massKg, 0},
// cur[i].w = обратная масса (0 = пин).
gpu::GpuWireChain make_chain(const vec3* pts, const bool* pinned,
                             float restX) {
    gpu::GpuWireChain c{};
    c.meta = vec4{restX, 1.0f, 0.35f, 0.0f};
    for (int i = 0; i < gpu::kWireChainPoints; ++i) {
        c.cur[i] = vec4{pts[i].x, pts[i].y, pts[i].z, pinned[i] ? 0.0f : 1.0f};
        c.prev[i] = vec4{pts[i].x, pts[i].y, pts[i].z, 0.0f};
    }
    return c;
}

// Метрика покоя (план §6.2): сумма |cur - prev| по свободным точкам — самый
// чувствительный индикатор демпфирования и итераций.
float rest_metric(const gpu::GpuWireChain& c) {
    float s = 0.0f;
    for (int i = 0; i < gpu::kWireChainPoints; ++i) {
        if (c.cur[i].w == 0.0f) continue;
        s += std::fabs(c.cur[i].x - c.prev[i].x) +
             std::fabs(c.cur[i].y - c.prev[i].y) +
             std::fabs(c.cur[i].z - c.prev[i].z);
    }
    return s;
}

std::uint64_t fnv1a(const void* data, std::size_t bytes, std::uint64_t h) {
    const auto* p = static_cast<const unsigned char*>(data);
    for (std::size_t i = 0; i < bytes; ++i) {
        h ^= p[i];
        h *= 1099511628211ull;
    }
    return h;
}

std::uint64_t hash_chain(const gpu::GpuWireChain& c) {
    std::uint64_t h = 1469598103934665603ull;
    for (int i = 0; i < gpu::kWireChainPoints; ++i)
        h = fnv1a(&c.cur[i], sizeof(float) * 3, h);
    return h;
}

const gpu::GpuWireChain* mapped_chain(const gpu::VerletPass& pass,
                                      const void* mapped, int idx) {
    (void)pass;
    return static_cast<const gpu::GpuWireChain*>(mapped) + idx;
}

// ПОДВЕС: два пина на 2 м, суммарный rest 2.8 м — середина обязана провиснуть
// и успокоиться; пины не двигаются вообще (в шейдере ранний continue).
void test_hanging_chain(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                        const void* wireMapped) {
    vec3 pts[8];
    bool pin[8] = {true, false, false, false, false, false, false, true};
    for (int i = 0; i < 8; ++i)
        pts[i] = vec3{10.0f + 2.0f * static_cast<float>(i) / 7.0f, 10.0f,
                      30.0f};
    const gpu::GpuWireChain up = make_chain(pts, pin, 0.4f);
    pass.upload_wires(&up, 1);
    pass.upload_bodies(nullptr, 0);
    CHECK(run_sims(dev, pass, 600, vec3{0.0f, 0.0f, -9.81f}));
    const gpu::GpuWireChain got = *mapped_chain(pass, wireMapped, 0);
    // Пины стоят точно там, где их поставили.
    CHECK(got.cur[0].x == 10.0f && got.cur[0].z == 30.0f);
    CHECK(got.cur[7].x == 12.0f && got.cur[7].z == 30.0f);
    // Середина провисла заметно ниже пинов (rest 2.8 > 2.0 хорды).
    CHECK(got.cur[3].z < 29.8f);
    CHECK(got.cur[4].z < 29.8f);
    // Покой достигнут: скорость на шаге меньше миллиметра суммарно.
    CHECK(rest_metric(got) < 1e-3f);
    // Ни одного NaN (солвер не разошёлся).
    for (int i = 0; i < 8; ++i) CHECK(std::isfinite(got.cur[i].z));
}

// ПОСАДКА: цепь без единого пина над бетонной плитой — падает и ложится НА
// поверхность (верх плиты z=10), не проваливаясь и не зависая.
void test_severed_lands(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                        const void* wireMapped) {
    vec3 pts[8];
    bool pin[8] = {false, false, false, false, false, false, false, false};
    for (int i = 0; i < 8; ++i)
        pts[i] = vec3{10.5f + 0.3f * static_cast<float>(i), 11.0f, 11.5f};
    const gpu::GpuWireChain up = make_chain(pts, pin, 0.3f);
    pass.upload_wires(&up, 1);
    pass.upload_bodies(nullptr, 0);
    CHECK(run_sims(dev, pass, 600, vec3{0.0f, 0.0f, -9.81f}));
    const gpu::GpuWireChain got = *mapped_chain(pass, wireMapped, 0);
    for (int i = 0; i < 8; ++i) {
        CHECK(got.cur[i].z >= 9.99f); // не утонула в плите
        CHECK(got.cur[i].z <= 10.6f); // и не зависла в воздухе
    }
    CHECK(rest_metric(got) < 1e-2f);
}

// ИЗОТРОПИЯ: гравитация — ВЕКТОР (+X), опора — стена, перпендикулярная X.
// Тот же закон посадки, ни одной оси в правиле (S1; канон «NEVER assume -Z»).
void test_isotropy_landing(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                           const void* wireMapped) {
    vec3 pts[8];
    bool pin[8] = {false, false, false, false, false, false, false, false};
    for (int i = 0; i < 8; ++i)
        pts[i] = vec3{79.0f, 77.5f + 0.3f * static_cast<float>(i), 79.0f};
    const gpu::GpuWireChain up = make_chain(pts, pin, 0.3f);
    pass.upload_wires(&up, 1);
    pass.upload_bodies(nullptr, 0);
    CHECK(run_sims(dev, pass, 600, vec3{9.81f, 0.0f, 0.0f}));
    const gpu::GpuWireChain got = *mapped_chain(pass, wireMapped, 0);
    for (int i = 0; i < 8; ++i) {
        CHECK(got.cur[i].x >= 79.99f); // долетела до стены (грань x=80)
        CHECK(got.cur[i].x <= 80.6f);  // и не вошла в неё
    }
    CHECK(rest_metric(got) < 1e-2f);
}

// ТКАНЬ: решётка 8x4, верхняя строка пиновая. Вертикальный солвер (H>1 —
// ветка, которой нет у цепей) держит restY, нижняя строка висит ниже верхней.
void test_cloth_hangs(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                      const void* clothMapped) {
    gpu::GpuClothSheet s{};
    const float restX = 0.25f, restY = 0.25f;
    s.meta = vec4{restX, 1.0f, restY, 0.0f};
    for (int r = 0; r < gpu::kClothGridH; ++r)
        for (int c = 0; c < gpu::kClothGridW; ++c) {
            const int i = r * gpu::kClothGridW + c;
            const vec3 p{20.0f + restX * static_cast<float>(c), 20.0f,
                         30.0f - restY * static_cast<float>(r)};
            s.cur[i] = vec4{p.x, p.y, p.z, r == 0 ? 0.0f : 1.0f};
            s.prev[i] = vec4{p.x, p.y, p.z, 0.0f};
        }
    pass.upload_cloths(&s, 1);
    pass.upload_bodies(nullptr, 0);
    CHECK(run_sims(dev, pass, 600, vec3{0.0f, 0.0f, -9.81f}));
    const auto* got = static_cast<const gpu::GpuClothSheet*>(clothMapped);
    // Верхняя строка приколота, нижняя — ниже неё.
    CHECK(got->cur[0].z == 30.0f);
    for (int c = 0; c < gpu::kClothGridW; ++c) {
        const int bottom = (gpu::kClothGridH - 1) * gpu::kClothGridW + c;
        CHECK(got->cur[bottom].z < got->cur[c].z - 0.5f);
    }
    // Вертикальные соседи держат restY с точностью солвера.
    for (int r = 0; r < gpu::kClothGridH - 1; ++r) {
        const int a = r * gpu::kClothGridW + 3;
        const int b = a + gpu::kClothGridW;
        const float dx = got->cur[b].x - got->cur[a].x;
        const float dy = got->cur[b].y - got->cur[a].y;
        const float dz = got->cur[b].z - got->cur[a].z;
        const float len = std::sqrt(dx * dx + dy * dy + dz * dz);
        CHECK(std::fabs(len - restY) < 0.05f);
    }
}

// ДЕТЕРМИНИЗМ: одинаковый вход — бит-идентичный выход. Это фундамент всего
// пин-протокола слияния (§6.2: «побитово, где математика не тронута»).
void test_determinism(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                      const void* wireMapped) {
    std::uint64_t h[2] = {0, 0};
    for (int run = 0; run < 2; ++run) {
        vec3 pts[8];
        bool pin[8] = {true, false, false, false, false, false, false, true};
        for (int i = 0; i < 8; ++i)
            pts[i] = vec3{10.0f + 2.0f * static_cast<float>(i) / 7.0f, 10.0f,
                          30.0f};
        const gpu::GpuWireChain up = make_chain(pts, pin, 0.4f);
        pass.upload_wires(&up, 1);
        pass.upload_bodies(nullptr, 0);
        CHECK(run_sims(dev, pass, 300, vec3{0.0f, 0.0f, -9.81f}));
        h[run] = hash_chain(*mapped_chain(pass, wireMapped, 0));
    }
    CHECK(h[0] == h[1]);
    CHECK(h[0] != 1469598103934665603ull); // хеш не пустышка
}

// ТЕЛА: толкатель в точке провиса — успокоившаяся цепь обязана лежать ВНЕ
// его радиуса (единственный тест байндинга тел; у частиц его не было никогда,
// и слияние подарит им этот же путь).
void test_body_pushes(gpu::VulkanDevice& dev, gpu::VerletPass& pass,
                      const void* wireMapped) {
    vec3 pts[8];
    bool pin[8] = {true, false, false, false, false, false, false, true};
    for (int i = 0; i < 8; ++i)
        pts[i] = vec3{10.0f + 2.0f * static_cast<float>(i) / 7.0f, 10.0f,
                      30.0f};
    const gpu::GpuWireChain up = make_chain(pts, pin, 0.4f);
    pass.upload_wires(&up, 1);
    const vec4 body{11.0f, 10.0f, 29.4f, 0.6f}; // там, куда цепь провисает
    pass.upload_bodies(&body, 1);
    CHECK(run_sims(dev, pass, 600, vec3{0.0f, 0.0f, -9.81f}));
    const gpu::GpuWireChain got = *mapped_chain(pass, wireMapped, 0);
    int inside = 0;
    for (int i = 1; i < 7; ++i) {
        const float dx = got.cur[i].x - body.x;
        const float dy = got.cur[i].y - body.y;
        const float dz = got.cur[i].z - body.z;
        if (dx * dx + dy * dy + dz * dz < 0.5f * 0.5f) ++inside;
    }
    CHECK(inside == 0);
}

} // namespace

int main() {
    gpu::VulkanDevice dev;
    CHECK(dev.init_headless(false));
    if (dev.device != VK_NULL_HANDLE) {
        CHECK(dev.families.graphics != UINT32_MAX);

        // Мир: бетонная плита-пол (верх z=10) и стена по +X (грань x=80) —
        // опоры для посадки и изотропии. Остальное — воздух.
        static World w;
        for (int x = 4; x < 8; ++x)
            for (int y = 4; y < 8; ++y) w.grid().fill_cell(x, y, 4, kMatConcrete);
        for (int y = 37; y < 43; ++y)
            for (int z = 37; z < 43; ++z)
                w.grid().fill_cell(40, y, z, kMatConcrete);

        static gpu::VoxelMirror mirror;
        CHECK(mirror.init(dev));
        CHECK(mirror.upload_all(w));

        static gpu::VerletPass pass;
        // renderPass = null: compute-only — рисующих пайплайнов НЕТ, физика
        // полная. Это и есть headless-разрез инкремента 1.
        CHECK(pass.init(&dev, VK_NULL_HANDLE, GIGA_SHADER_DIR,
                        mirror.masks_buffer()));
        CHECK(pass.sim_ready());
        CHECK(!pass.ready()); // draw-пайплайны не создавались

        // Прямые mapped-указатели секций: тест читает то же, что хеширует
        // GIGA_VERLET_PIN. Доступ через дружественный шов не нужен — буферы
        // host-visible по построению (иначе бы и пин не работал).
        const void* wireMapped = nullptr;
        const void* clothMapped = nullptr;
        {
            // Одна цепь-зонд, чтобы достать указатели через section state:
            // upload не меняет адрес буфера, только содержимое.
            vec3 pts[8] = {};
            bool pin[8] = {};
            const gpu::GpuWireChain probe = make_chain(pts, pin, 0.3f);
            pass.upload_wires(&probe, 1);
            wireMapped = pass.wire_mapped();
            clothMapped = pass.cloth_mapped();
            CHECK(wireMapped != nullptr && clothMapped != nullptr);
        }

        test_hanging_chain(dev, pass, wireMapped);
        test_severed_lands(dev, pass, wireMapped);
        test_isotropy_landing(dev, pass, wireMapped);
        test_cloth_hangs(dev, pass, clothMapped);
        test_determinism(dev, pass, wireMapped);
        test_body_pushes(dev, pass, wireMapped);

        pass.destroy();
        mirror.destroy();
    }
    dev.destroy();

    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    return g_fails == 0 ? 0 : 1;
}
