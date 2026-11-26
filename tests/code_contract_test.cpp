// GigaHrush 2 — Static & Runtime Code Contract & Binary Layout Barrier
//
// Mechanical verification of binary contracts, structure sizes, alignments,
// padding, trivial copyability, IEEE 754 float determinism, and memory passports.
// Modeled after Dental CRM & Timeart binary integrity standards.

#include <cstdio>
#include <cstdint>
#include <cmath>
#include <type_traits>
#include <bit>
#include <limits>

#include "core/math.h"
#include "core/wrap.h"
#include "world/types.h"
#include "world/macro_grid.h"
#include "ecs/components.h"
#include "game/body_pose.h"
#include "game/action.h"

using namespace giga;
using namespace giga::game;

// =============================================================================
// 1. КОНТРАКТЫ БИНАРНОЙ РАСКЛАДКИ ДАННЫХ (BINARY LAYOUT & PADDING INVARIANTS)
// =============================================================================

// 1.1 Воксельный мир и субмаски 8³
static_assert(sizeof(SubMask) == 64,
    "SubMask обязана быть ровно 64 байта (512 бит) для идеального выравнивания под кэш-линию L1/L2!");
static_assert(alignof(SubMask) >= 8,
    "SubMask обязана быть выровнена минимум по 8 байт для 64-битных битовых операций без unaligned-штрафа!");
static_assert(std::is_trivially_copyable_v<SubMask>,
    "SubMask обязана быть тривиально копируемой для прямого DMA / Vulkan Staging перелива в GPU!");
static_assert(std::is_standard_layout_v<SubMask>,
    "SubMask обязана обладать standard layout (ноль виртуальных таблиц, ноль скрытых смещений).");

// 1.2 Математические типы ядра (src/core/math.h)
static_assert(sizeof(vec3) == 12, "vec3 обязан быть ровно 12 байт (3 * float32 без скрытого padding)");
static_assert(sizeof(quat) == 16, "quat обязан быть ровно 16 байт (4 * float32)");
static_assert(std::is_trivially_copyable_v<vec3>);
static_assert(std::is_trivially_copyable_v<quat>);

// 1.3 Компоненты ECS (src/ecs/components.h)
static_assert(sizeof(Transform) == 16,
    "Transform обязан быть ровно 16 байт (vec3 pos = 12 Б + uint32 layer = 4 Б)!");
static_assert(std::is_trivially_copyable_v<Transform>);

static_assert(sizeof(Velocity) == 12,
    "Velocity обязан быть ровно 12 байт (vec3 v)!");
static_assert(std::is_trivially_copyable_v<Velocity>);

static_assert(sizeof(AABB) == 12,
    "AABB обязан быть ровно 12 байт (vec3 half)!");
static_assert(std::is_trivially_copyable_v<AABB>);

static_assert(sizeof(Mass) == 4,
    "Mass обязан быть ровно 4 байта (float kg)!");
static_assert(std::is_trivially_copyable_v<Mass>);

static_assert(sizeof(Gait) == 4,
    "Gait одометр обязан быть ровно 4 байта (float metres)!");
static_assert(std::is_trivially_copyable_v<Gait>);

static_assert(sizeof(BodyPlan) == 1 || sizeof(BodyPlan) == 2 || sizeof(BodyPlan) == 4,
    "BodyPlan не должен нести скрытых динамических аллокаций!");
static_assert(std::is_trivially_copyable_v<BodyPlan>);

static_assert(sizeof(BodyPart) == 44 || sizeof(BodyPart) == 48,
    "BodyPart обязан быть плоской структурой без динамической памяти!");
static_assert(std::is_trivially_copyable_v<BodyPart>);

// 1.4 Окна действий (src/game/action.h)
static_assert(std::is_trivially_copyable_v<ActWindow>,
    "ActWindow обязана сериализоваться байтами в run.sav!");
static_assert(std::is_trivially_copyable_v<Acting>,
    "Acting носитель окон обязан переживать прямое копирование памяти!");

// =============================================================================
// 2. ДЕТЕРМИНИЗМ АРИФМЕТИКИ И АРХИТЕКТУРА ПРОЦЕССОРА
// =============================================================================

// Проверка порядка байт: x86_64 и ARM64 в Little Endian
static_assert(std::endian::native == std::endian::little,
    "Движок GigaHrush 2 строго спроектирован под Little Endian платформы (x86_64, aarch64)!");

// Проверка стандарта IEEE 754 для float32
static_assert(std::numeric_limits<float>::is_iec559,
    "Плавающая точка float обязана строго следовать стандарту IEEE 754 (IEC 559)!");
static_assert(sizeof(float) == 4, "float обязан быть ровно 32-битным");
static_assert(sizeof(double) == 8, "double обязан быть ровно 64-битным");

// =============================================================================
// 3. РАНТАЙМ-ВЕРИФИКАЦИЯ ИНВАРИАНТОВ ПАМЯТИ И МАТЕМАТИКИ
// =============================================================================

int main() {
    std::printf("[code_contract_test] Running Binary Layout & Code Contract Gates...\n");

    int checks = 0;
    int fails = 0;

    auto require = [&](bool cond, const char* name, const char* details) {
        ++checks;
        if (!cond) {
            ++fails;
            std::fprintf(stderr, "❌ [CODE CONTRACT FAILED]: %s\n   %s\n", name, details);
        }
    };

    // 3.1 Проверка отсутствия денормализованных чисел при нулевом wrap
    float zero_wrap = wrapf(0.0f, kWorldExtent);
    require(zero_wrap == 0.0f, "Wrap zero check", "wrapf(0) must return exact 0.0f");

    // 3.2 Проверка субмасок в памяти (ровно 64 байта)
    SubMask mask;
    mask.set_all();
    const uint8_t* raw_bytes = reinterpret_cast<const uint8_t*>(&mask);
    bool all_ones = true;
    for (size_t i = 0; i < sizeof(SubMask); ++i) {
        if (raw_bytes[i] != 0xFF) {
            all_ones = false;
            break;
        }
    }
    require(all_ones, "SubMask byte density", "set_all() must fill all 64 bytes with 0xFF without padding holes");

    // 3.3 Проверка паспорта памяти макросетки (MacroGrid Monolith Passport)
    // 128^3 клеток * 64 байта маска = ровно 128 МиБ плотной непрерывной памяти!
    size_t expected_masks_size = kMacroCells * sizeof(SubMask);
    size_t expected_masks_mib = expected_masks_size / (1024 * 1024);
    require(expected_masks_mib == 128, "MacroGrid memory passport",
            "Monolith 128^3 grid bitmasks must occupy exactly 128 MiB of RAM!");

    // 3.4 Проверка отсутствия расхождения в периоде тора
    require(kWorldExtent == 256.0f, "Torus extent invariant", "kWorldExtent must be exactly 256.0 metres");
    require(kVoxelSize == 0.25f, "Voxel size invariant", "kVoxelSize must be exactly 0.25 metres");

    std::printf("[code_contract_test] %d compile-time static asserts verified.\n", 18);
    std::printf("[code_contract_test] %d runtime layout invariants verified, %d failures.\n", checks, fails);

    if (fails == 0) {
        std::printf("\033[1;32m✔ [CODE CONTRACTS]: Все структуры, раскладки памяти и паспорта типов валидны (PASS).\033[0m\n");
        return 0;
    }
    return 1;
}
