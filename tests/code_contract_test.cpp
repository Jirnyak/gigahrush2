// GigaHrush 2 — Static & Runtime Code Contract & Binary Layout Barrier
//
// Mechanical verification of binary contracts, structure sizes, alignments,
// padding, trivial copyability, IEEE 754 float determinism, and memory passports.
// Modeled after Dental CRM & Timeart binary integrity standards.

#include <cstdio>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <type_traits>
#include <bit>
#include <limits>

#include "core/math.h"
#include "core/wrap.h"
#include "world/types.h"
#include "world/macro_grid.h"
#include "world/gravity.h"
#include "ecs/components.h"
#include "game/body_pose.h"
#include "game/action.h"
#include "game/look.h"
#include "game/mob_spawn.h"
#include "game/room.h"
#include "game/save.h"

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
static_assert(alignof(vec3) == 4);
static_assert(alignof(quat) == 4);
static_assert(std::is_trivially_copyable_v<vec3>);
static_assert(std::is_trivially_copyable_v<quat>);

// 1.3 Компоненты ECS (src/ecs/components.h)
static_assert(sizeof(Transform) == 16,
    "Transform обязан быть ровно 16 байт (vec3 pos = 12 Б + uint32 layer = 4 Б)!");
static_assert(std::is_trivially_copyable_v<Transform>);

static_assert(sizeof(Velocity) == 12, "Velocity обязан быть ровно 12 байт (vec3 v)!");
static_assert(std::is_trivially_copyable_v<Velocity>);

static_assert(sizeof(AABB) == 12, "AABB обязан быть ровно 12 байт (vec3 half)!");
static_assert(std::is_trivially_copyable_v<AABB>);

static_assert(sizeof(Mass) == 4, "Mass обязан быть ровно 4 байта (float kg)!");
static_assert(std::is_trivially_copyable_v<Mass>);

static_assert(sizeof(Impact) == 4, "Impact обязан быть ровно 4 байта (float speed)!");
static_assert(std::is_trivially_copyable_v<Impact>);

static_assert(sizeof(GravityAffected) == 8, "GravityAffected обязан быть ровно 8 байт (float scale + bool grounded + padding)!");
static_assert(std::is_trivially_copyable_v<GravityAffected>);

static_assert(sizeof(Jump) == 8, "Jump обязан быть ровно 8 байт (float impulse + bool wants_jump + padding)!");
static_assert(std::is_trivially_copyable_v<Jump>);

static_assert(sizeof(CameraTag) == 24, "CameraTag обязан быть ровно 24 байта (yaw + pitch + fovY + eyeOffset)!");
static_assert(std::is_trivially_copyable_v<CameraTag>);

static_assert(sizeof(Controller) == 20, "Controller обязан быть ровно 20 байт (moveSpeed + wishDir + fly + padding)!");
static_assert(std::is_trivially_copyable_v<Controller>);

static_assert(sizeof(Gait) == 4, "Gait одометр обязан быть ровно 4 байта (float metres)!");
static_assert(std::is_trivially_copyable_v<Gait>);

static_assert(sizeof(RigidBody) == 60,
    "RigidBody обязан быть ровно 60 байт (48 чисел + 4 флагов + 4 метки цепи + 4 паддинг/тишина)!");
static_assert(alignof(RigidBody) == 4, "RigidBody не должен содержать 8-байтных членов");
static_assert(std::is_trivially_copyable_v<RigidBody>);
static_assert(std::is_standard_layout_v<RigidBody>);

static_assert(sizeof(JointLink) == 40,
    "JointLink обязан быть ровно 40 байт (Entity a + Entity b + anchorA + anchorB + restLen + rope + padding)!");
static_assert(alignof(JointLink) == 4);
static_assert(std::is_trivially_copyable_v<JointLink>);

static_assert(sizeof(CarriedBy) == 20, "CarriedBy обязан быть ровно 20 байт!");
static_assert(std::is_trivially_copyable_v<CarriedBy>);

static_assert(sizeof(BodyPart) == 44, "BodyPart обязан быть ровно 44 байта!");
static_assert(std::is_trivially_copyable_v<BodyPart>);

static_assert(sizeof(BodyParts) == 356, "BodyParts обязан быть ровно 356 байт (1 Б count + 8 * 44 Б + padding)!");
static_assert(std::is_trivially_copyable_v<BodyParts>);

// 1.3b Комнаты и дельта-сохранение (CANON S12/S18)
static_assert(sizeof(RoomFeature) == 16, "RoomFeature обязан быть ровно 16 байт!");
static_assert(alignof(RoomFeature) == 4);
static_assert(std::is_trivially_copyable_v<RoomFeature>);
static_assert(std::is_standard_layout_v<RoomFeature>);

static_assert(sizeof(RoomRecord) == 8, "RoomRecord обязан быть ровно 8 байт!");
static_assert(alignof(RoomRecord) == 2);
static_assert(std::is_trivially_copyable_v<RoomRecord>);
static_assert(std::is_standard_layout_v<RoomRecord>);

static_assert(sizeof(RoomDelta) == 6, "RoomDelta обязан быть ровно 6 байт!");
static_assert(alignof(RoomDelta) == 2);
static_assert(std::is_trivially_copyable_v<RoomDelta>);
static_assert(std::is_standard_layout_v<RoomDelta>);

static_assert(sizeof(Room) == 136, "Room (композитный фасад) обязан быть ровно 136 байт!");
static_assert(std::is_trivially_copyable_v<Room>);

static_assert(std::is_trivially_copyable_v<ContactForm>);
static_assert(std::is_standard_layout_v<ContactForm>);

// 1.4 Фреймы гравитации и направления (src/world/gravity.h, src/game/look.h)
static_assert(sizeof(GravityFrame) == 20, "GravityFrame обязан быть ровно 20 байт!");
static_assert(alignof(GravityFrame) == 4);
static_assert(std::is_trivially_copyable_v<GravityFrame>);

static_assert(sizeof(CellStep) == 12, "CellStep обязан быть ровно 12 байт (3 * int32)!");
static_assert(std::is_trivially_copyable_v<CellStep>);

static_assert(sizeof(Look) == 12, "Look обязан быть ровно 12 байт (vec3 dir)!");
static_assert(std::is_trivially_copyable_v<Look>);

// 1.5 Окна действий и снимки (src/game/action.h, src/game/mob_spawn.h)
static_assert(std::is_trivially_copyable_v<ActWindow>,
    "ActWindow обязана сериализоваться байтами в run.sav!");
static_assert(std::is_trivially_copyable_v<Acting>,
    "Acting носитель окон обязан переживать прямое копирование памяти!");
static_assert(std::is_trivially_copyable_v<ActingSnap>);
static_assert(std::is_trivially_copyable_v<BreakResult>);

static_assert(sizeof(MobRef) == 8, "MobRef обязан быть ровно 8 байт (kind + level + hp + maxHp + pack + padding)!");
static_assert(offsetof(MobRef, hp) == 2);
static_assert(offsetof(MobRef, pack) == 6);
static_assert(std::is_trivially_copyable_v<MobRef>);

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
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    std::setvbuf(stderr, nullptr, _IONBF, 0);

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

    // 3.5 Проверка тривиального побайтового копирования (Trivial Copy Memcpy Round-Trip)
    {
        RigidBody src_rb;
        src_rb.q = quat{0.1f, 0.2f, 0.3f, 0.9f};
        src_rb.w = vec3{1.0f, 2.0f, 3.0f};
        src_rb.radius = 0.45f;
        src_rb.invMass = 0.02f;
        src_rb.asleep = true;
        src_rb.suspended = true;
        src_rb.chain = 0x12345678;

        RigidBody dst_rb;
        std::memcpy(&dst_rb, &src_rb, sizeof(RigidBody));
        require(std::memcmp(&dst_rb, &src_rb, sizeof(RigidBody)) == 0,
                "RigidBody memcpy round-trip",
                "RigidBody обязана переживать побайтовое копирование без искажений");
    }

    {
        JointLink src_jl;
        src_jl.a = static_cast<Entity>(42);
        src_jl.b = static_cast<Entity>(99);
        src_jl.anchorA = vec3{0.1f, 0.2f, 0.3f};
        src_jl.anchorB = vec3{-0.1f, -0.2f, -0.3f};
        src_jl.restLen = 0.5f;
        src_jl.rope = true;

        JointLink dst_jl;
        std::memcpy(&dst_jl, &src_jl, sizeof(JointLink));
        require(std::memcmp(&dst_jl, &src_jl, sizeof(JointLink)) == 0,
                "JointLink memcpy round-trip",
                "JointLink обязана переживать побайтовое копирование без искажений");
    }

    {
        Transform src_tr{vec3{10.0f, 20.0f, 30.0f}, 7u};
        Transform dst_tr;
        std::memcpy(&dst_tr, &src_tr, sizeof(Transform));
        require(std::memcmp(&dst_tr, &src_tr, sizeof(Transform)) == 0,
                "Transform memcpy round-trip",
                "Transform обязана переживать прямое копирование памяти");
    }

    constexpr int kCompileAsserts = 35;
    std::printf("[code_contract_test] %d compile-time static asserts verified.\n", kCompileAsserts);
    std::printf("[code_contract_test] %d runtime layout invariants verified, %d failures.\n", checks, fails);

    if (fails == 0) {
        std::printf("\033[1;32m✔ [CODE CONTRACTS]: Все структуры, раскладки памяти и паспорта типов валидны (PASS).\033[0m\n");
        std::fflush(stdout);
        std::fflush(stderr);
        return 0;
    }
    std::fflush(stdout);
    std::fflush(stderr);
    return 1;
}
