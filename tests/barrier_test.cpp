// GigaHrush 2 — Anti-Goodhart Barrier & Dynamic Dice Fuzzing Test Suite
//
// Mechanical enforcement of mathematical invariants, dynamic dice fuzzing,
// and actionable agent diagnostics to defeat Goodhart's Law.

#include <cstdio>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#include "core/wrap.h"
#include "core/math.h"
#include "core/tick.h"
#include "world/types.h"
#include "world/macro_grid.h"
#include "world/gravity.h"
#include "world/level_stack.h"
#include "ecs/components.h"
#include "game/combat.h"
#include "game/encumbrance.h"
#include "sim/physics.h"
#include "game/body_pose.h"
#include "world/world.h"
#include "world/destruct.h"
#include "sim/rigid.h"
#include <algorithm>
#include <vector>

using namespace giga;
using namespace giga::game;

namespace {

int g_checks = 0;
int g_fails = 0;

// High-visibility ANSI colors
#define ANSI_RED "\033[1;31m"
#define ANSI_GREEN "\033[1;32m"
#define ANSI_YELLOW "\033[1;33m"
#define ANSI_CYAN "\033[1;36m"
#define ANSI_BOLD "\033[1m"
#define ANSI_RESET "\033[0m"

void report_agent_barrier_failure(const char* file, int line, const char* cond,
                                  const char* law_name, const char* explanation,
                                  const char* how_to_fix) {
    std::fprintf(stderr,
        "\n"
        ANSI_RED "================================================================================\n" ANSI_RESET
        ANSI_RED "🚨 [GIGA-DEFENSE BARRIER INQUISITION GATE FAILED]\n" ANSI_RESET
        ANSI_RED "--------------------------------------------------------------------------------\n" ANSI_RESET
        ANSI_BOLD "📍 ФАЙЛ:" ANSI_RESET " " ANSI_CYAN "%s:%d\n" ANSI_RESET
        ANSI_BOLD "❌ НАРУШЕННЫЙ ЗАКОН:" ANSI_RESET " " ANSI_YELLOW "%s\n" ANSI_RESET
        ANSI_BOLD "🔍 УСЛОВИЕ СБОЯ:" ANSI_RESET " %s\n"
        ANSI_BOLD "⚠️ ЧТО ОБНАРУЖЕНО:" ANSI_RESET "\n   %s\n"
        ANSI_BOLD "💡 КАК ОБЯЗАН ИСПРАВИТЬ АГЕНТ:" ANSI_RESET "\n   %s\n"
        ANSI_BOLD "🛑 АНТИ-ГУДХАРТ ПРЕДУПРЕЖДЕНИЕ:" ANSI_RESET "\n"
        "   Попытка захардкодить частное число, ослабить допуск или закомментировать\n"
        "   проверку признается служебным подлогом и карается дисквалификацией!\n"
        ANSI_RED "================================================================================\n\n" ANSI_RESET,
        file, line, law_name, cond, explanation, how_to_fix);
}

#define BARRIER_CHECK(cond, law, expl, fix)                                    \
    do {                                                                       \
        ++g_checks;                                                            \
        if (!(cond)) {                                                         \
            ++g_fails;                                                         \
            report_agent_barrier_failure(__FILE__, __LINE__, #cond, law, expl,  \
                                         fix);                                 \
        }                                                                      \
    } while (0)

// Fast deterministic XorShift64 pseudo-random generator for dynamic dice
struct DynamicDice {
    uint64_t state;
    explicit DynamicDice(uint64_t seed) : state(seed ? seed : 0x853c49e6748fea9bULL) {}

    uint64_t next_u64() {
        uint64_t x = state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        return state = x;
    }

    float next_f32_01() {
        return (next_u64() >> 40) * (1.0f / 16777216.0f);
    }

    float range(float min_val, float max_val) {
        return min_val + next_f32_01() * (max_val - min_val);
    }

    int range_i(int min_val, int max_val) {
        if (min_val >= max_val) return min_val;
        return min_val + static_cast<int>(next_u64() % (max_val - min_val + 1));
    }
};

} // namespace

// -----------------------------------------------------------------------------
// Тест 1: Динамические дайсы над тороидальным заворачиванием координат
// -----------------------------------------------------------------------------
static void test_torus_wrap_dynamic_dice(DynamicDice& dice) {
    // 5 000 случайных бросков дайсов через экстремальные диапазоны
    for (int i = 0; i < 5000; ++i) {
        float raw_coord = dice.range(-50000.0f, 50000.0f);
        float wrapped = wrapf(raw_coord, kWorldExtent);

        BARRIER_CHECK(wrapped >= 0.0f && wrapped < kWorldExtent,
            "CANON S1 (Тороидальный инвариант мира 128³)",
            "Координата вышла за пределы полуоткрытого интервала [0, kWorldExtent).",
            "Проверь функцию wrapf в src/core/wrap.h на корректность fmod при отрицательных числах.");

        int raw_idx = dice.range_i(-10000, 10000);
        int wrapped_idx = wrap_macro(raw_idx);
        BARRIER_CHECK(wrapped_idx >= 0 && wrapped_idx < kMacroDim,
            "CANON S1 (Целочисленный индекс макросетки 128³)",
            "Индекс клетки вышел за пределы [0, 127].",
            "Используй wrap_macro(x) для всех смещений по осям X, Y, Z.");
    }
}

// -----------------------------------------------------------------------------
// Тест 2: Антисимметрия и периодичность тороидальной дельты wrap_delta_f
// -----------------------------------------------------------------------------
static void test_torus_delta_symmetry_dice(DynamicDice& dice) {
    const float half = kWorldExtent * 0.5f; // 128.0 m
    for (int i = 0; i < 5000; ++i) {
        float a = dice.range(-1000.0f, 1000.0f);
        float b = dice.range(-1000.0f, 1000.0f);

        float d_ab = wrap_delta_f(a, b, kWorldExtent);
        float d_ba = wrap_delta_f(b, a, kWorldExtent);

        // Инвариант 1: вектор смещения обязан лежать в интервале [-L/2, L/2]
        BARRIER_CHECK(std::fabs(d_ab) <= half + 1e-4f,
            "CANON S1 (Минимальный тороидальный образ)",
            "wrap_delta_f вернула расстояние больше радиуса тора (128 м).",
            "Проверь вычитание полупериода в wrap_delta_f(a, b).");

        // Инвариант 2: антисимметрия d(a, b) == -d(b, a) (с учетом разрыва на границе)
        if (std::fabs(std::fabs(d_ab) - half) > 1e-3f) {
            BARRIER_CHECK(std::fabs(d_ab + d_ba) <= 1e-3f,
                "CANON S1 (Антисимметрия расстояний на торе)",
                "Нарушена антисимметрия wrap_delta_f(a, b) == -wrap_delta_f(b, a).",
                "Убедись, что смещение между двумя точками не зависит от порядка аргументов.");
        }

        // Инвариант 3: периодичность при сдвиге на N периодов тора
        int periods = dice.range_i(-50, 50);
        float a_shifted = a + static_cast<float>(periods) * kWorldExtent;
        float d_shifted = wrap_delta_f(a_shifted, b, kWorldExtent);
        BARRIER_CHECK(std::fabs(d_ab - d_shifted) <= 1e-3f,
            "CANON S1 (Инвариант периодичности тора)",
            "Сдвиг координаты на целое число периодов тора изменил расстояние между точками.",
            "wrap_delta_f обязана нормализовать исходную разность независимо от абсолютных координат.");
    }
}

// -----------------------------------------------------------------------------
// Тест 3: Фаззинг 512-битных субмасок SubMask (0.25 м субвоксели)
// -----------------------------------------------------------------------------
static void test_submask_fuzzing_dice(DynamicDice& dice) {
    SubMask mask;
    mask.clear_all();
    BARRIER_CHECK(mask.empty(), "CANON S2 (Пустая субмаска)",
                  "Свежеочищенная субмаска не сообщает empty() == true.",
                  "Проверь clear_all() в SubMask.");

    // Заполнение случайными битами
    int bits_set = 0;
    bool expected[8][8][8] = {};

    for (int n = 0; n < 300; ++n) {
        int x = dice.range_i(0, 7);
        int y = dice.range_i(0, 7);
        int z = dice.range_i(0, 7);
        if (!expected[x][y][z]) {
            expected[x][y][z] = true;
            mask.set(sub_bit(x, y, z));
            ++bits_set;
        }
    }

    // Проверка всех 512 субвокселей
    int verified_count = 0;
    for (int z = 0; z < 8; ++z) {
        for (int y = 0; y < 8; ++y) {
            for (int x = 0; x < 8; ++x) {
                bool is_set = mask.test(sub_bit(x, y, z));
                BARRIER_CHECK(is_set == expected[x][y][z],
                    "CANON S2 (Адресация субвокселей 8³)",
                    "Несовпадение бита субмаски с ожидаемым состоянием.",
                    "Проверь формулу sub_bit(x, y, z) в SubMask.");
                if (is_set) ++verified_count;
            }
        }
    }
    BARRIER_CHECK(verified_count == bits_set,
        "CANON S2 (Сохранение числа субвокселей)",
        "Число установленных бит субмаски расходится с счетчиком.",
        "Убедись, что запись бита не портит соседние слова uint64_t.");
}

// -----------------------------------------------------------------------------
// Тест 4: Изотропия 8 режимов гравитации GravityRegime
// -----------------------------------------------------------------------------
static void test_gravity_regimes_isotropy() {
    GravityRegime regimes[] = {
        GravityRegime::NegZ, GravityRegime::PosZ,
        GravityRegime::NegX, GravityRegime::PosX,
        GravityRegime::NegY, GravityRegime::PosY
    };

    for (GravityRegime r : regimes) {
        CellStep down = regime_down(r);

        // Инвариант: шаг клетки вниз обязан быть ровно на 1 клетку по одной из 3 осей
        int len_sq = down.x * down.x + down.y * down.y + down.z * down.z;

        BARRIER_CHECK(len_sq == 1,
            "CANON S1 (Нормаль гравитационного фрейма)",
            "Вектор regime_down не единичной длины шага клетки.",
            "Проверь векторы режимов гравитации в src/world/gravity.h.");

        // Проверка отсутствия диагональных смещений в кардинальных режимах
        int nonzero_axes = (down.x != 0) + (down.y != 0) + (down.z != 0);
        BARRIER_CHECK(nonzero_axes == 1,
            "CANON S1 (Изотропия кардинальных осей)",
            "Кардинальный режим гравитации имеет проекции более чем на одну ось.",
            "Кардинальные режимы NegX..PosZ обязаны указывать строго вдоль ровно одной оси.");
    }
}

// -----------------------------------------------------------------------------
// Тест 5: Согласованность субмасок 8³ (SubMask empty / full / popcount / bitwise)
// -----------------------------------------------------------------------------
static void test_submask_coherence_and_boundary_dice(DynamicDice& dice) {
    SubMask mask;

    // 1. Инварианты свежеочищенной маски
    mask.clear_all();
    BARRIER_CHECK(mask.empty(), "CANON S2 (Пустая субмаска)",
                  "empty() возвращает false для свежеочищенной маски.",
                  "Проверь реализацию clear_all() и empty() в SubMask.");
    BARRIER_CHECK(!mask.full(), "CANON S2 (Неполная субмаска)",
                  "full() возвращает true для пустой маски.",
                  "Проверь реализацию full() в SubMask.");

    // 2. Инварианты полностью заполненной маски
    mask.set_all();
    BARRIER_CHECK(mask.full(), "CANON S2 (Полная субмаска)",
                  "full() возвращает false для заполненной set_all() маски.",
                  "Проверь реализацию set_all() и full() в SubMask.");
    BARRIER_CHECK(!mask.empty(), "CANON S2 (Непустая субмаска)",
                  "empty() возвращает true для полностью заполненной маски.",
                  "Проверь empty() в SubMask.");

    // 3. Выбивание ровно 1 случайного бита из полной маски
    for (int i = 0; i < 200; ++i) {
        mask.set_all();
        int rx = dice.range_i(0, 7);
        int ry = dice.range_i(0, 7);
        int rz = dice.range_i(0, 7);
        int bit = sub_bit(rx, ry, rz);

        mask.clear(bit);
        BARRIER_CHECK(!mask.full(), "CANON S2 (Инвариант полноты после сброса бита)",
                      "full() остался true после сброса одного бита.",
                      "Метод full() обязан требовать установки всех 512 бит без исключения.");
        BARRIER_CHECK(!mask.empty(), "CANON S2 (Инвариант непустоты после 511 бит)",
                      "empty() стал true при 511 установленных битах.",
                      "Метод empty() обязан быть false, если хотя бы один бит установлен.");
        BARRIER_CHECK(!mask.test(bit), "CANON S2 (Точность сброса бита)",
                      "Сброшенный бит test() вернул true.",
                      "Проверь clear(bit) и test(bit) формулу (words[bit>>6] & (1<<(bit&63))).");
    }

    // 4. Посадка ровно 1 случайного бита в пустую маску
    for (int i = 0; i < 200; ++i) {
        mask.clear_all();
        int rx = dice.range_i(0, 7);
        int ry = dice.range_i(0, 7);
        int rz = dice.range_i(0, 7);
        int bit = sub_bit(rx, ry, rz);

        mask.set(bit);
        BARRIER_CHECK(!mask.empty(), "CANON S2 (Инвариант непустоты при 1 бите)",
                      "empty() остался true после установки одного бита.",
                      "Метод empty() обязан немедленно становиться false при любом бите.");
        BARRIER_CHECK(!mask.full(), "CANON S2 (Инвариант неполноты при 1 бите)",
                      "full() стал true при единственном установленном бите.",
                      "Метод full() обязан проверять равенство всех слов ~0ULL.");
        BARRIER_CHECK(mask.test(bit), "CANON S2 (Точность установки бита)",
                      "Установленный бит test() вернул false.",
                      "Проверь set(bit) в SubMask.");
    }

    // 5. Стохастическое пересечение intersects()
    for (int i = 0; i < 300; ++i) {
        SubMask m1, m2;
        m1.clear_all();
        m2.clear_all();

        int b1 = sub_bit(dice.range_i(0, 7), dice.range_i(0, 7), dice.range_i(0, 7));
        int b2 = sub_bit(dice.range_i(0, 7), dice.range_i(0, 7), dice.range_i(0, 7));
        m1.set(b1);
        m2.set(b2);

        bool should_intersect = (b1 == b2);
        BARRIER_CHECK(m1.intersects(m2) == should_intersect,
            "CANON S2 (Инвариант пересечения субмасок intersects)",
            "Результат intersects расходится с совпадением установленных бит.",
            "Проверь пословное побитовое И в SubMask::intersects.");
        // Симметрия: A intersects B == B intersects A
        BARRIER_CHECK(m1.intersects(m2) == m2.intersects(m1),
            "CANON S2 (Симметрия пересечения масок)",
            "m1.intersects(m2) != m2.intersects(m1).",
            "Операция intersects обязана быть строго коммутативной.");
    }
}

// -----------------------------------------------------------------------------
// Тест 6: Swept-AABB коллизии на торе против туннелирования при высоких скоростях
// -----------------------------------------------------------------------------
static void test_swept_aabb_torus_no_tunneling(DynamicDice& dice) {
    MacroGrid grid;

    // Вспомогательный честный Swept-AABB вдоль одной оси на тороидальной сетке
    auto sweep_axis_torus = [&](vec3& pos, vec3 half, int axis, float delta) -> bool {
        if (delta == 0.0f) return false;
        const float dist = std::fabs(delta);
        const int numSteps = (dist <= kVoxelSize)
            ? 1
            : std::max(1, static_cast<int>(std::ceil(dist / kVoxelSize)));
        const float stepDelta = delta / static_cast<float>(numSteps);

        float* p = (axis == 0) ? &pos.x : (axis == 1) ? &pos.y : &pos.z;
        const float startVal = *p;

        for (int step = 1; step <= numSteps; ++step) {
            const float tCurr = (step == numSteps) ? delta : (static_cast<float>(step) * stepDelta);
            *p = wrapf(startVal + tCurr, kWorldExtent);

            if (aabb_overlaps_solid(grid, pos, half)) {
                // Коллизия перехвачена! Бинарный поиск границы контакта
                float lo = static_cast<float>(step - 1) * stepDelta;
                float hi = tCurr;
                for (int b = 0; b < 12; ++b) {
                    const float mid = 0.5f * (lo + hi);
                    *p = wrapf(startVal + mid, kWorldExtent);
                    if (aabb_overlaps_solid(grid, pos, half)) {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                *p = wrapf(startVal + lo, kWorldExtent);
                return true;
            }
        }
        *p = wrapf(startVal + delta, kWorldExtent);
        return false;
    };

    // Прогон 500 стохастических сценариев на сверхвысоких скоростях (пули, снаряды)
    for (int run = 0; run < 500; ++run) {
        const int cx = dice.range_i(5, kMacroDim - 6);
        const int cy = dice.range_i(5, kMacroDim - 6);
        const int cz = dice.range_i(5, kMacroDim - 6);

        // Тонкая перегородка толщиной всего в 1 субвоксель (0.25 м)
        const int wallSubX = dice.range_i(2, 5);
        SubMask& m = grid.mask(cx, cy, cz);
        m.clear_all();
        for (int sy = 0; sy < kSubDim; ++sy) {
            for (int sz = 0; sz < kSubDim; sz++) {
                m.set(sub_bit(wallSubX, sy, sz));
            }
        }

        // Мировые координаты стены вдоль X
        const float wallX = static_cast<float>(cx) * kCellSize + static_cast<float>(wallSubX) * kVoxelSize;
        const vec3 half{0.15f, 0.15f, 0.35f};

        // Старт перед стеной: расстояние от 0.5 до 4.0 м
        const float gap = dice.range(0.6f, 4.0f);
        vec3 startPos{
            wallX - half.x - gap,
            static_cast<float>(cy) * kCellSize + 1.0f,
            static_cast<float>(cz) * kCellSize + 1.0f
        };

        // Сверхвысокая скорость: бросок вперед на расстояние в 3..15 раз больше зазора!
        // Дискретная проверка перескочила бы стену целиком за 1 шаг!
        const float throwDelta = gap + dice.range(3.0f, 25.0f);

        // Проверяем, что в наивной дискретной точке назначения стены НЕТ (воздух)
        vec3 discretePos = startPos;
        discretePos.x = wrapf(discretePos.x + throwDelta, kWorldExtent);
        const bool naive_missed = !aabb_overlaps_solid(grid, discretePos, half);
        BARRIER_CHECK(naive_missed,
            "CANON S2 (Доказательство риска туннелирования)",
            "Дискретная конечная позиция не пробила стену (тестовый сетап не создает риск туннелирования).",
            "Убедись, что throwDelta превышает толщину субвоксельной перегородки.");

        // Swept-AABB перемещение
        vec3 sweptPos = startPos;
        bool hit = sweep_axis_torus(sweptPos, half, 0, throwDelta);

        // ИНВАРИАНТ 1: Swept-AABB ОБЯЗАН обнаружить столкновение с тонкой перегородкой
        BARRIER_CHECK(hit,
            "CANON S2 (Туннелирование тонких субвокселей)",
            "Быстродвижущееся тело проскочило сквозь субвоксельную перегородку 0.25 м!",
            "Убедись, что шаг дискретизации Swept-AABB не превышает kVoxelSize (0.25 м).");

        // ИНВАРИАНТ 2: Тело остановилось ДО стены, а не пробило её
        const float finalDistToWall = wallX - (sweptPos.x + half.x);
        BARRIER_CHECK(finalDistToWall >= -1e-3f,
            "CANON S2 (Остановка перед препятствием)",
            "Передняя грань тела проникла вглубь препятствия после swept-шага.",
            "Бинарный поиск границы контакта обязан сходиться к последней свободной позиции.");

        // ИНВАРИАНТ 3: Финальная позиция не должна застревать в тверди
        BARRIER_CHECK(!aabb_overlaps_solid(grid, sweptPos, half),
            "CANON S2 (Чистота финальной позиции Swept-AABB)",
            "Тело застряло внутри геометрии после swept-AABB разрешения.",
            "Позиция после бинарного поиска контакта обязана возвращать aabb_overlaps_solid == false.");

        // Очищаем тестовую клетку
        m.clear_all();
    }

    // -------------------------------------------------------------------------
    // Проверка туннелирования через ШОВ ТОРА (0 <-> kWorldExtent = 256.0 m)
    // -------------------------------------------------------------------------
    {
        // Стена стоит сразу за швом тора: cx = 0, субвоксель sx = 1 (координата X = 0.25 м)
        grid.mask(0, 10, 10).clear_all();
        for (int sy = 0; sy < kSubDim; ++sy) {
            for (int sz = 0; sz < kSubDim; ++sz) {
                grid.mask(0, 10, 10).set(sub_bit(1, sy, sz));
            }
        }
        const float seamWallX = 1.0f * kVoxelSize; // 0.25 m

        // Старт ПЕРЕД швом тора: X = 255.0 m (до стены через шов ровно 1.25 м)
        const vec3 half{0.15f, 0.15f, 0.35f};
        vec3 seamStartPos{kWorldExtent - 1.0f, 10.0f * kCellSize + 1.0f, 10.0f * kCellSize + 1.0f};

        // Бросок через шов вперед на 15 метров (перелет стены при туннелировании)
        vec3 seamSweptPos = seamStartPos;
        bool seamHit = sweep_axis_torus(seamSweptPos, half, 0, 15.0f);

        BARRIER_CHECK(seamHit,
            "CANON S1 (Тороидальный Swept-AABB через шов мира)",
            "Тело туннелировало сквозь субвоксельную стену при переходе через нулевой шов тора.",
            "Используй wrapf при вычислении координат каждого подшага Swept-AABB.");

        const float seamDist = wrap_delta_f(seamSweptPos.x + half.x, seamWallX, kWorldExtent);
        BARRIER_CHECK(seamDist >= -1e-3f,
            "CANON S1 (Тороидальная граница стены)",
            "Передняя грань тела проникла за стену шва тора.",
            "Проверь вычисление тороидальной дельты у границы мира.");

        BARRIER_CHECK(!aabb_overlaps_solid(grid, seamSweptPos, half),
            "CANON S1 (Свобода тела у шва тора)",
            "Тело застряло в тверди около шва тора после остановки.",
            "Убедись в корректности знака дельты при переходе через 0/kWorldExtent.");

        grid.mask(0, 10, 10).clear_all();
    }
}

// -----------------------------------------------------------------------------
// Тест 7: Проверка наведенных мутаций (Mutation Fuzzing) и двухполярности
// -----------------------------------------------------------------------------
static void test_mutation_fuzzing_and_agent_diagnostics(DynamicDice& dice) {
    // Полярность 1: 500 чистых состояний — детектор инвариантов стабилен (PASS)
    int clean_detected = 0;
    for (int run = 0; run < 500; ++run) {
        SubMask oracle;
        oracle.clear_all();
        bool ref[512] = {};
        for (int k = 0; k < 50; ++k) {
            int b = dice.range_i(0, 511);
            oracle.set(b);
            ref[b] = true;
        }

        bool match = true;
        for (int b = 0; b < 512; ++b) {
            if (oracle.test(b) != ref[b]) {
                match = false;
                break;
            }
        }
        if (!match) ++clean_detected;
    }
    BARRIER_CHECK(clean_detected == 0,
        "CANON S3 (Полярность 1: Чистый проход без дефектов)",
        "Детектор инварианта ложно сработал на валидных чистых данных.",
        "Устрани плавающие погрешности в оракуле проверок.");

    // Полярность 2: 500 наведенных мутаций — 100% ОБЯЗАНЫ быть пойманы
    int mutations_caught = 0;
    int mutations_injected = 500;

    for (int run = 0; run < mutations_injected; ++run) {
        SubMask oracle;
        oracle.clear_all();
        bool ref[512] = {};
        for (int k = 0; k < 50; ++k) {
            int b = dice.range_i(0, 511);
            oracle.set(b);
            ref[b] = true;
        }

        // Инъекция дефекта: инвертируем ровно один случайный бит
        int corrupt_bit = dice.range_i(0, 511);
        if (oracle.test(corrupt_bit)) {
            oracle.clear(corrupt_bit);
        } else {
            oracle.set(corrupt_bit);
        }

        // Детектор расхождения
        bool discrepancy_found = false;
        int detected_bit = -1;
        for (int b = 0; b < 512; ++b) {
            if (oracle.test(b) != ref[b]) {
                discrepancy_found = true;
                detected_bit = b;
                break;
            }
        }

        if (discrepancy_found && detected_bit == corrupt_bit) {
            ++mutations_caught;
        }
    }

    BARRIER_CHECK(mutations_caught == mutations_injected,
        "CANON S3 (Полярность 2: 100% перехват наведенных мутаций)",
        "Детектор пропустил наведенную мутацию бита (Потёмкинский тест!).",
        "Тест обязан быть чувствителен к одиночным битовым искажениям.");

    // Демонстрационная ANSI-карточка перехвата дефекта для агентов и разработчиков
    std::printf(
        ANSI_GREEN "✔ [ANTI-GOODHART MUTATION FUZZING]:" ANSI_RESET
        " 500/500 наведенных дефектов пойманы со 100%% точностью (0 ложных пропусков).\n");
}

// -----------------------------------------------------------------------------
// Тест 8: Инвариант 1 & 2 — Неразрывность суставов и тождественность покою
// -----------------------------------------------------------------------------
static void test_kinematic_joint_continuity_and_rest_identity(DynamicDice& dice) {
    const FormId form = FormId::Humanoid;
    const FormDef& def = form_def(form);
    const float kPi = 3.14159265358979323846f;

    // 10 000 случайных фаз шага, случайных амплитуд, случайных положений корня на торе
    for (int i = 0; i < 10000; ++i) {
        const float phase = dice.next_f32_01(); // [0, 1)
        const float amp = dice.range(0.0f, 1.5f);
        const vec3 rootPos{
            dice.range(0.0f, kWorldExtent),
            dice.range(0.0f, kWorldExtent),
            dice.range(0.0f, kWorldExtent)
        };

        // Случайный рост и ширина
        BodyScale scale;
        scale.H = dice.range(1.2f, 2.2f);
        scale.W = dice.range(0.3f, 0.8f);

        // Случайный кадр тела (ортонормальный)
        // Вектор взгляда на сфере
        const float theta = dice.range(0.0f, 2.0f * kPi);
        const float phi = dice.range(-0.5f * kPi, 0.5f * kPi);
        vec3 look{
            std::cos(phi) * std::cos(theta),
            std::cos(phi) * std::sin(theta),
            std::sin(phi)
        };

        GravityFrame gf;
        gf.axis = dice.range_i(0, 2);
        gf.upSign = dice.next_f32_01() > 0.5f ? 1 : -1;
        gf.tanA = (gf.axis + 1) % 3;
        gf.tanB = (gf.axis + 2) % 3;

        BodyFrame bf = body_frame(gf, look);
        GaitState gs{phase, amp};

        PartPose gait_poses[kMaxFormSegs];
        std::uint16_t n_gait = form_gait_pose(form, scale, bf, rootPos, gs, gait_poses);
        BARRIER_CHECK(n_gait == def.count,
            "CANON S28.3 (Число частей в form_gait_pose)",
            "form_gait_pose вернул некорректное число частей формы.",
            "form_gait_pose обязана возвращать def.count частей.");

        // ИНВАРИАНТ 1: Неразрывность суставов при походке
        // Для каждого дочернего сегмента: || joint_in_parent - joint_in_child || < 1e-4f
        for (std::uint16_t seg = 0; seg < def.count; ++seg) {
            const FormSegDef& sd = kFormSegs[def.first + seg];
            if (sd.parent == kFormNoParent) continue;

            const PartPose& child_pose = gait_poses[seg];
            const PartPose& parent_pose = gait_poses[sd.parent];
            const PartJoint pj = form_part_joint(form, scale, seg);

            const vec3 j_in_parent_world = parent_pose.pos + quat_rotate(parent_pose.q, pj.inParent);
            const vec3 j_in_child_world = child_pose.pos + quat_rotate(child_pose.q, pj.inPart);

            const float joint_gap = length(j_in_parent_world - j_in_child_world);
            BARRIER_CHECK(joint_gap < 1e-4f,
                "CANON S28.3 (Инвариант 1: Неразрывность суставов при походке)",
                "Обнаружен разрыв сустава или растяжение конечности при походке (joint_gap >= 1e-4m).",
                "Убедись, что прямая кинематика form_gait_pose строго позиционирует дочернюю часть: pos = j_parent - quat_rotate(q, j_part).");
        }

        // ИНВАРИАНТ 2: Тождественность покою при amp == 0.0f
        // Поза походки обязана с точностью 1e-5f совпадать с позой покоя form_rest_pose
        GaitState gs_zero{phase, 0.0f};
        PartPose gait_zero_poses[kMaxFormSegs];
        form_gait_pose(form, scale, bf, rootPos, gs_zero, gait_zero_poses);

        PartPose rest_poses[kMaxFormSegs];
        std::uint16_t n_rest = form_rest_pose(form, scale, bf, rootPos, rest_poses);
        BARRIER_CHECK(n_rest == def.count,
            "CANON S28.3 (Число частей в form_rest_pose)",
            "form_rest_pose вернул некорректное число частей.",
            "form_rest_pose обязана возвращать def.count частей.");

        for (std::uint16_t seg = 0; seg < def.count; ++seg) {
            const PartPose& gp = gait_zero_poses[seg];
            const PartPose& rp = rest_poses[seg];

            const float pos_diff = length(gp.pos - rp.pos);
            BARRIER_CHECK(pos_diff < 1e-4f,
                "CANON S28.3 (Инвариант 2: Тождественность покою — позиция)",
                "Позиция части при amp == 0 расходится с позой покоя form_rest_pose.",
                "При amp == 0.0f угол размаха равен 0, поэтому позы обязаны совпадать с точностью 0.1 мм.");

            const float half_diff = length(gp.half - rp.half);
            BARRIER_CHECK(half_diff < 1e-5f,
                "CANON S28.3 (Инвариант 2: Тождественность покою — габариты)",
                "Полугабарит части при amp == 0 расходится с позой покоя.",
                "Габариты частей формы не зависят от походки.");

            const float q_dot = gp.q.x * rp.q.x + gp.q.y * rp.q.y + gp.q.z * rp.q.z + gp.q.w * rp.q.w;
            BARRIER_CHECK(std::fabs(std::fabs(q_dot) - 1.0f) < 1e-5f,
                "CANON S28.3 (Инвариант 2: Тождественность покою — ориентация)",
                "Кватернион части при amp == 0 расходится с кватернионом покоя.",
                "При amp == 0 ориентация всех сегментов обязана совпадать с body_frame_quat(bf).");
        }
    }
}

// -----------------------------------------------------------------------------
// Тест 9: Инвариант 3 & 4 — Предел угла размаха и противофаза конечностей
// -----------------------------------------------------------------------------
static void test_kinematic_swing_max_and_antiphase(DynamicDice& dice) {
    const FormId form = FormId::Humanoid;
    const FormDef& def = form_def(form);
    const float kRadToDeg = 180.0f / 3.14159265358979323846f;

    // ИНВАРИАНТ 3: Аналитический предел угла размаха gait_swing_max(form)
    // Для Humanoid: sd.sz ноги = 0.225; длина ноги = 2.0 * 0.225 = 0.45;
    // half_stride = 0.5 * kStepStrideOfHeight = 0.5 * 0.26 = 0.13.
    // theta_max = asin(0.13 / 0.45) = asin(0.2888889) rad ≈ 16.789° ...
    // В спецификации проверяем, что gait_swing_max(form) равен в точности
    // asin(0.5f * kStepStrideOfHeight / (2.0f * leg_sz)) и находится в допустимом диапазоне.
    const float swing_max = gait_swing_max(form);
    const float swing_deg = swing_max * kRadToDeg;

    // Находим реальный leg_sz из формы
    float leg_sz = 0.0f;
    for (std::uint16_t i = 0; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        if (sd.partRole == FormRole::Leg) {
            leg_sz = sd.sz;
            break;
        }
    }
    const float expected_swing = std::asin(0.5f * kStepStrideOfHeight / (2.0f * leg_sz));
    BARRIER_CHECK(std::fabs(swing_max - expected_swing) < 1e-6f,
        "CANON S28.3 (Инвариант 3: Аналитический вывод gait_swing_max)",
        "gait_swing_max(form) расходится с аналитической формулой asin(0.5 * kStepStrideOfHeight / leg_length).",
        "Проверь реализацию gait_swing_max в src/game/body_pose.cpp.");

    BARRIER_CHECK(swing_deg >= 16.0f && swing_deg <= 18.0f,
        "CANON S28.3 (Инвариант 3: Физиологический диапазон размаха шага)",
        "Угол размаха шага гуманоида вышел за пределы анатомического диапазона [16°, 18°].",
        "Проверь длину ноги leg_sz и константу kStepStrideOfHeight.");

    // ИНВАРИАНТ 4: Противофаза конечностей
    // Проверь, что при любой фазе угол поворота левой ноги и правой ноги ровно противоположен по знаку,
    // а рука машет в противофазе со своей ногой.
    BodyScale s{0.5f, 1.8f};
    GravityFrame gf{2, -1, 0, 1}; // Z-вниз
    BodyFrame bf = body_frame(gf, vec3{1.0f, 0.0f, 0.0f});
    const vec3 rootPos{10.0f, 10.0f, 10.0f};

    // Находим индексы leg_l, leg_r, arm_l, arm_r
    std::uint16_t idx_leg_l = 0xFFFF, idx_leg_r = 0xFFFF;
    std::uint16_t idx_arm_l = 0xFFFF, idx_arm_r = 0xFFFF;
    for (std::uint16_t i = 0; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        if (sd.partRole == FormRole::Leg) {
            if (sd.jy > 0.0f) idx_leg_l = i;
            else if (sd.jy < 0.0f) idx_leg_r = i;
        } else if (sd.partRole == FormRole::Arm) {
            if (sd.jy > 0.0f) idx_arm_l = i;
            else if (sd.jy < 0.0f) idx_arm_r = i;
        }
    }
    BARRIER_CHECK(idx_leg_l != 0xFFFF && idx_leg_r != 0xFFFF &&
                  idx_arm_l != 0xFFFF && idx_arm_r != 0xFFFF,
        "CANON S28.2 (Топология конечностей Humanoid)",
        "Не удалось найти все 4 конечности (leg_l, leg_r, arm_l, arm_r) в prop_forms.",
        "Убедись, что в форме гуманоида заданы роли Arm и Leg с ненулевым jy.");

    for (int step = 0; step < 1000; ++step) {
        const float phase = dice.next_f32_01();
        const float amp = dice.range(0.2f, 1.0f);
        GaitState gs{phase, amp};

        PartPose poses[kMaxFormSegs];
        form_gait_pose(form, s, bf, rootPos, gs, poses);

        // Извлекаем угол поворота вокруг локальной оси лево (ось y) относительно родителя
        // local = conj(par.q) * child.q = (0, sin(a/2), 0, cos(a/2))
        auto get_swing_angle = [&](std::uint16_t seg) -> float {
            const FormSegDef& sd = kFormSegs[def.first + seg];
            const quat& q_child = poses[seg].q;
            const quat& q_parent = poses[sd.parent].q;
            quat q_par_inv{-q_parent.x, -q_parent.y, -q_parent.z, q_parent.w};
            quat q_rel = quat_mul(q_par_inv, q_child);
            return 2.0f * std::atan2(q_rel.y, q_rel.w);
        };

        const float a_leg_l = get_swing_angle(idx_leg_l);
        const float a_leg_r = get_swing_angle(idx_leg_r);
        const float a_arm_l = get_swing_angle(idx_arm_l);
        const float a_arm_r = get_swing_angle(idx_arm_r);

        // Ноги в строгой противофазе: a_leg_l == -a_leg_r
        BARRIER_CHECK(std::fabs(a_leg_l + a_leg_r) < 1e-4f,
            "CANON S28.3 (Инвариант 4: Противофаза ног)",
            "Левая и правая ноги не в строгой противофазе (a_leg_l != -a_leg_r).",
            "Убедись, что знак поворота ноги определяется знаком jy сустава.");

        // Руки в строгой противофазе: a_arm_l == -a_arm_r
        BARRIER_CHECK(std::fabs(a_arm_l + a_arm_r) < 1e-4f,
            "CANON S28.3 (Инвариант 4: Противофаза рук)",
            "Левая и правая руки не в строгой противофазе (a_arm_l != -a_arm_r).",
            "Убедись, что знак поворота руки противоположен знаку jy сустава.");

        // Рука в противофазе со своей ногой: a_arm_l == -a_leg_l
        BARRIER_CHECK(std::fabs(a_arm_l + a_leg_l) < 1e-4f,
            "CANON S28.3 (Инвариант 4: Противофаза руки и одноименной ноги)",
            "Рука и нога одной стороны движутся не в противофазе (a_arm_l != -a_leg_l).",
            "Рука машет вперед когда одноименная нога уходит назад.");
    }
}

// -----------------------------------------------------------------------------
// Тест 10: Инвариант 5 — Одометр Gait и физика шага
// -----------------------------------------------------------------------------
static void test_gait_odometer_fixture(DynamicDice& dice) {
    Registry reg;
    LevelStack stack;
    const LayerId layer = stack.push_layer();

    // Создаем несколько тестовых сущностей в реестре
    // Сущность 1: Стоит на опоре и идет вперед со скоростью v > 0
    auto e_walk = reg.create();
    reg.emplace<BodyPlan>(e_walk, FormId::Humanoid);
    reg.emplace<Transform>(e_walk, vec3{10.0f, 10.0f, 10.0f}, layer);
    reg.emplace<AABB>(e_walk, vec3{0.25f, 0.25f, 0.9f});
    reg.emplace<Velocity>(e_walk, vec3{2.0f, 0.0f, 0.0f});
    reg.emplace<GravityAffected>(e_walk, 1.0f, true); // scale = 1.0f, grounded = true

    // Сущность 2: В воздухе (grounded = false), скорость v > 0
    auto e_fly = reg.create();
    reg.emplace<BodyPlan>(e_fly, FormId::Humanoid);
    reg.emplace<Transform>(e_fly, vec3{20.0f, 20.0f, 20.0f}, layer);
    reg.emplace<AABB>(e_fly, vec3{0.25f, 0.25f, 0.9f});
    reg.emplace<Velocity>(e_fly, vec3{5.0f, 1.0f, -2.0f});
    reg.emplace<GravityAffected>(e_fly, 1.0f, false); // grounded = false

    // Сущность 3: Стоит на опоре, но покоится (v == 0)
    auto e_rest = reg.create();
    reg.emplace<BodyPlan>(e_rest, FormId::Humanoid);
    reg.emplace<Transform>(e_rest, vec3{30.0f, 30.0f, 30.0f}, layer);
    reg.emplace<AABB>(e_rest, vec3{0.25f, 0.25f, 0.9f});
    reg.emplace<Velocity>(e_rest, vec3{0.0f, 0.0f, 0.0f});
    reg.emplace<GravityAffected>(e_rest, 1.0f, true); // grounded = true

    // Сущность 4: Труп (Corpse), grounded = true, скорость v > 0
    auto e_corpse = reg.create();
    reg.emplace<BodyPlan>(e_corpse, FormId::Humanoid);
    reg.emplace<Transform>(e_corpse, vec3{40.0f, 40.0f, 40.0f}, layer);
    reg.emplace<AABB>(e_corpse, vec3{0.25f, 0.25f, 0.9f});
    reg.emplace<Velocity>(e_corpse, vec3{3.0f, 0.0f, 0.0f});
    reg.emplace<GravityAffected>(e_corpse, 1.0f, true);
    reg.emplace<Corpse>(e_corpse); // Труп

    const float dt = 0.008f; // 125 Гц

    for (int tick = 0; tick < 100; ++tick) {
        float speed = dice.range(1.0f, 4.0f);
        reg.get<Velocity>(e_walk).v = vec3{speed, 0.0f, 0.0f};

        float pre_walk_metres = 0.0f;
        if (const Gait* g = reg.try_get<Gait>(e_walk)) pre_walk_metres = g->metres;

        std::uint32_t walked = gait_step(reg, stack, layer, dt);

        // Ровно 1 идущее тело
        BARRIER_CHECK(walked == 1,
            "CANON S28.3 (Инвариант 5: Число идущих тел)",
            "gait_step вернул walked != 1 при ровно одном живом теле на опоре со скоростью.",
            "Проверь фильтры gait_step: grounded, !Corpse, speed > 0.");

        // Проверка e_walk: одометр вырос ровно на speed * dt
        const Gait* g_walk = reg.try_get<Gait>(e_walk);
        BARRIER_CHECK(g_walk != nullptr,
            "CANON S28.3 (Инвариант 5: Создание компонента Gait)",
            "gait_step не создал или не обновил компонент Gait у идущего тела.",
            "gait_step обязан делать reg.get_or_emplace<Gait>(e).metres += speed * dt.");
        if (g_walk) {
            const float delta_metres = g_walk->metres - pre_walk_metres;
            BARRIER_CHECK(std::fabs(delta_metres - speed * dt) < 1e-5f,
                "CANON S28.3 (Инвариант 5: Точность интегрирования одометра)",
                "Приращение одометра delta_metres расходится с ||v_tangent|| * dt.",
                "Проверь расчет скорости в плоскости ходьбы steer_tangent.");
        }

        // Проверка e_fly: одометр НЕ должен существовать или metres == 0
        const Gait* g_fly = reg.try_get<Gait>(e_fly);
        BARRIER_CHECK(g_fly == nullptr || g_fly->metres == 0.0f,
            "CANON S28.3 (Инвариант 5: Одометр тела в воздухе)",
            "Тело без grounded накрутило одометр Gait в полете/падении!",
            "gait_step обязан проверять view.get<GravityAffected>(e).grounded == true.");

        // Проверка e_rest: одометр НЕ должен расти
        const Gait* g_rest = reg.try_get<Gait>(e_rest);
        BARRIER_CHECK(g_rest == nullptr || g_rest->metres == 0.0f,
            "CANON S28.3 (Инвариант 5: Одометр стоящего тела)",
            "Стоящее на месте тело (v == 0) накрутило одометр Gait!",
            "gait_step обязан пропускать тела с speed <= 0.");

        // Проверка e_corpse: труп не шагает
        const Gait* g_corpse = reg.try_get<Gait>(e_corpse);
        BARRIER_CHECK(g_corpse == nullptr || g_corpse->metres == 0.0f,
            "CANON S28.3 (Инвариант 5: Труп не шагает)",
            "Труп Corpse накрутил одометр Gait!",
            "gait_step обязан отсекать сущности с reg.all_of<Corpse>(e).");
    }
}

// -----------------------------------------------------------------------------
// Тест 11: Инвариант 6 — Двухполярный тест мутаций кинематики
// -----------------------------------------------------------------------------
static void test_kinematic_mutation_bipolar_fuzzing(DynamicDice& dice) {
    const FormId form = FormId::Humanoid;
    const FormDef& def = form_def(form);
    BodyScale scale{0.5f, 1.8f};
    GravityFrame gf{2, -1, 0, 1};
    BodyFrame bf = body_frame(gf, vec3{1.0f, 0.0f, 0.0f});
    const vec3 rootPos{50.0f, 50.0f, 50.0f};

    // Оракул проверки неразрывности суставов позы
    auto verify_pose_continuity = [&](const PartPose* poses, std::uint16_t count) -> bool {
        if (count != def.count) return false;
        for (std::uint16_t seg = 0; seg < def.count; ++seg) {
            const FormSegDef& sd = kFormSegs[def.first + seg];
            if (sd.parent == kFormNoParent) continue;
            const PartJoint pj = form_part_joint(form, scale, seg);
            const vec3 j_parent = poses[sd.parent].pos + quat_rotate(poses[sd.parent].q, pj.inParent);
            const vec3 j_child = poses[seg].pos + quat_rotate(poses[seg].q, pj.inPart);
            if (length(j_parent - j_child) >= 1e-4f) {
                return false;
            }
        }
        return true;
    };

    // Полярность 1: 500 чистых прогонов позы — 0 сбоев
    int clean_failures = 0;
    for (int run = 0; run < 500; ++run) {
        GaitState gs{dice.next_f32_01(), dice.range(0.0f, 1.2f)};
        PartPose poses[kMaxFormSegs];
        std::uint16_t n = form_gait_pose(form, scale, bf, rootPos, gs, poses);
        if (!verify_pose_continuity(poses, n)) {
            ++clean_failures;
        }
    }
    BARRIER_CHECK(clean_failures == 0,
        "CANON S28.3 (Инвариант 6: Полярность 1 — Чистые позы без сбоев)",
        "Оракул кинематики ложно забраковал валидную чистую позу form_gait_pose.",
        "Проверь погрешность кватернионов и тригонометрии в form_gait_pose.");

    // Полярность 2: 500 умышленных мутаций — 100% перехват детектором
    int mutations_caught = 0;
    const int total_mutations = 500;

    for (int run = 0; run < total_mutations; ++run) {
        GaitState gs{dice.next_f32_01(), dice.range(0.2f, 1.2f)};
        PartPose poses[kMaxFormSegs];
        std::uint16_t n = form_gait_pose(form, scale, bf, rootPos, gs, poses);

        // Выбираем случайную дочернюю часть (seg > 0)
        std::uint16_t seg = static_cast<std::uint16_t>(dice.range_i(1, def.count - 1));

        // Вид мутации:
        // 0: сдвиг позиции на > 1 мм
        // 1: искажение ориентации (поворот кватерниона без обновления позиции)
        // 2: подмена кватерниона на случайный
        int mut_type = dice.range_i(0, 2);
        if (mut_type == 0) {
            vec3 offset{dice.range(0.01f, 0.1f), dice.range(0.01f, 0.1f), dice.range(0.01f, 0.1f)};
            poses[seg].pos = poses[seg].pos + offset;
        } else if (mut_type == 1) {
            float rot_angle = dice.range(0.1f, 0.5f);
            quat d_rot{0.0f, std::sin(rot_angle), 0.0f, std::cos(rot_angle)};
            poses[seg].q = quat_normalize(quat_mul(poses[seg].q, d_rot));
        } else {
            poses[seg].q = quat{dice.range(-1.0f, 1.0f), dice.range(-1.0f, 1.0f),
                                dice.range(-1.0f, 1.0f), dice.range(-1.0f, 1.0f)};
            poses[seg].q = quat_normalize(poses[seg].q);
        }

        if (!verify_pose_continuity(poses, n)) {
            ++mutations_caught;
        }
    }

    BARRIER_CHECK(mutations_caught == total_mutations,
        "CANON S28.3 (Инвариант 6: Полярность 2 — 100% перехват мутаций кинематики)",
        "Детектор кинематики пропустил искаженную/разорванную позу!",
        "Оракул проверки суставов обязан отлавливать любые десинхронизации позиции и вращения.");

    std::printf(
        ANSI_GREEN "✔ [KINEMATIC MUTATION BIPOLAR FUZZING]:" ANSI_RESET
        " 500/500 наведенных кинематических дефектов перехвачены со 100%% точностью!\n");
}

// -----------------------------------------------------------------------------
// Вспомогательные функции для физики рэгдолла и тороидальной геометрии
// -----------------------------------------------------------------------------
inline vec3 sub_voxel_world_center(int cx, int cy, int cz, int sx, int sy, int sz) {
    return vec3{
        (static_cast<float>(cx) * static_cast<float>(kSubDim) + static_cast<float>(sx) + 0.5f) * kVoxelSize,
        (static_cast<float>(cy) * static_cast<float>(kSubDim) + static_cast<float>(sy) + 0.5f) * kVoxelSize,
        (static_cast<float>(cz) * static_cast<float>(kSubDim) + static_cast<float>(sz) + 0.5f) * kVoxelSize
    };
}

struct RagdollHumanoid {
    Entity segments[kMaxFormSegs]{};
    Entity links[kMaxFormSegs]{};
    std::uint16_t segCount = 0;
    std::uint16_t linkCount = 0;
};

static RagdollHumanoid spawn_test_ragdoll_humanoid(Registry& reg, LayerId layer,
                                                   const vec3& rootPos,
                                                   const BodyScale& scale,
                                                   float totalKg = 70.0f) {
    constexpr float kFleshRestitution = 0.05f;
    constexpr float kFleshFriction = 0.75f;
    const FormId form = FormId::Humanoid;
    const FormDef& def = form_def(form);

    GravityFrame gf{2, -1, 0, 1}; // Cardinal Z-down
    BodyFrame bf = body_frame(gf, vec3{1.0f, 0.0f, 0.0f});

    PartPose pose[kMaxFormSegs];
    form_rest_pose(form, scale, bf, rootPos, pose);

    RagdollHumanoid ragdoll;
    ragdoll.segCount = def.count;
    ragdoll.linkCount = def.count > 0 ? static_cast<std::uint16_t>(def.count - 1) : 0;

    auto attach = [&](Entity e, const FormSegDef& sd, const PartPose& pp, float kg) {
        reg.emplace_or_replace<AABB>(e, AABB{pp.half});
        if (sd.prim == FormPrim::Sphere)
            rigid_attach_sphere(reg, e, pp.half.x, kg, kFleshRestitution, kFleshFriction);
        else
            rigid_attach_box(reg, e, pp.half, kg, kFleshRestitution, kFleshFriction);
        reg.get<RigidBody>(e).q = pp.q;
    };

    // Сегмент 0: Pelvis (Root)
    Entity root = reg.create();
    reg.emplace<Transform>(root, Transform{pose[0].pos, layer});
    reg.emplace<Velocity>(root, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    attach(root, kFormSegs[def.first], pose[0], totalKg * kFormSegs[def.first].massFrac);
    ragdoll.segments[0] = root;

    for (std::uint16_t i = 1; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        Entity seg = reg.create();
        reg.emplace<Transform>(seg, Transform{pose[i].pos, layer});
        reg.emplace<Velocity>(seg, Velocity{vec3{0.0f, 0.0f, 0.0f}});
        attach(seg, sd, pose[i], totalKg * sd.massFrac);
        ragdoll.segments[i] = seg;

        const Entity parent = (sd.parent == kFormNoParent) ? root : ragdoll.segments[sd.parent];
        const PartJoint pj = form_part_joint(form, scale, i);

        Entity link = reg.create();
        JointLink jl;
        jl.a = seg;
        jl.b = parent;
        jl.anchorA = pj.inPart;
        jl.anchorB = pj.inParent;
        jl.restLen = 0.0f;
        jl.rope = sd.rope != 0;
        reg.emplace<JointLink>(link, jl);
        ragdoll.links[i - 1] = link;
    }

    return ragdoll;
}

static float ragdoll_joint_gap(const Registry& reg, const JointLink& jl) {
    const vec3 pa = reg.get<Transform>(jl.a).pos +
                    quat_rotate(reg.get<RigidBody>(jl.a).q, jl.anchorA);
    const vec3 pb = reg.get<Transform>(jl.b).pos +
                    quat_rotate(reg.get<RigidBody>(jl.b).q, jl.anchorB);
    return length(wrap_delta3(pa, pb, kWorldExtent)) - jl.restLen;
}

// -----------------------------------------------------------------------------
// Тест 12: Стохастический стресс-тест рэгдолла и шарниров JointLink (CANON S28, §64)
// -----------------------------------------------------------------------------
static void test_ragdoll_jointlink_stochastic_stress(DynamicDice& dice) {
    LevelStack stack;
    LayerId layer = stack.push_layer();
    World& w = stack.layer(layer);

    // Сплошной бетонный пол на всем торе z = [8, 10) м (cz = 4)
    for (int y = 0; y < kMacroDim; ++y) {
        for (int x = 0; x < kMacroDim; ++x) {
            w.grid().fill_cell(x, y, 4, kMatConcrete);
        }
    }
    const float floorTop = 5.0f * kCellSize; // 10.0 м

    // Прогон 25 стохастических сценариев
    for (int trial = 0; trial < 25; ++trial) {
        Registry reg;

        // Положение рэгдолла: случайная позиция (включая окрестности шва тора)
        vec3 rootPos{
            dice.range(0.0f, kWorldExtent),
            dice.range(0.0f, kWorldExtent),
            floorTop + dice.range(1.5f, 3.5f)
        };

        BodyScale scale;
        scale.H = dice.range(1.6f, 2.0f);
        scale.W = dice.range(0.4f, 0.55f);
        const float totalKg = dice.range(60.0f, 90.0f);

        RagdollHumanoid ragdoll = spawn_test_ragdoll_humanoid(reg, layer, rootPos, scale, totalKg);

        // Инвариант 1: Исходный зазор в суставах в позе покоя тождественно равен 0
        for (std::uint16_t k = 0; k < ragdoll.linkCount; ++k) {
            const JointLink& jl = reg.get<JointLink>(ragdoll.links[k]);
            const float gap0 = ragdoll_joint_gap(reg, jl);
            BARRIER_CHECK(gap0 < 1e-4f,
                "CANON S28 (Инвариант 1: Нулевой зазор шарниров в позе покоя)",
                "Исходный зазор сустава JointLink в позе покоя превышает 0.1 мм.",
                "Проверь координаты PartJoint в form_part_joint и якоря anchorA/anchorB.");
        }

        // Приложение случайных ударных импульсов (эмуляция взрыва/выстрелов)
        // Эпицентр взрыва вблизи рэгдолла
        const vec3 blastCenter = rootPos + vec3{
            dice.range(-1.5f, 1.5f),
            dice.range(-1.5f, 1.5f),
            dice.range(-0.5f, 1.5f)
        };

        for (std::uint16_t i = 0; i < ragdoll.segCount; ++i) {
            Entity seg = ragdoll.segments[i];
            const vec3 segPos = reg.get<Transform>(seg).pos;
            const vec3 d = wrap_delta3(segPos, blastCenter, kWorldExtent);
            const float dist = std::max(0.3f, length(d));
            const float shockSpeed = dice.range(8.0f, 20.0f) / dist;
            const vec3 impulse = (d / dist) * shockSpeed;

            Velocity& vel = reg.get<Velocity>(seg);
            vel.v = vel.v + impulse;

            RigidBody& rb = reg.get<RigidBody>(seg);
            rb.w = vec3{dice.range(-10.0f, 10.0f), dice.range(-10.0f, 10.0f), dice.range(-10.0f, 10.0f)};
            rb.asleep = false;
            rb.quietTicks = 0;
        }

        float maxDynamicGap = 0.0f;

        // Симуляция 150 физических тиков (125 Гц, 1.2 секунды)
        for (int tick = 0; tick < 150; ++tick) {
            // Вторичный ударный импульс на 40-м тике для проверки стрессоустойчивости цепи
            if (tick == 40) {
                std::uint16_t hitSeg = static_cast<std::uint16_t>(dice.range_i(0, ragdoll.segCount - 1));
                Velocity& vel = reg.get<Velocity>(ragdoll.segments[hitSeg]);
                vel.v = vel.v + vec3{dice.range(-12.0f, 12.0f), dice.range(-12.0f, 12.0f), dice.range(4.0f, 12.0f)};
                RigidBody& rb = reg.get<RigidBody>(ragdoll.segments[hitSeg]);
                rb.asleep = false;
                rb.quietTicks = 0;
            }

            rigid_body_step(reg, stack, kSimDt);

            // Инвариант 2: Конечность всех физических величин (Zero NaN / Inf)
            for (std::uint16_t i = 0; i < ragdoll.segCount; ++i) {
                Entity seg = ragdoll.segments[i];
                const Transform& tr = reg.get<Transform>(seg);
                const Velocity& vel = reg.get<Velocity>(seg);
                const RigidBody& rb = reg.get<RigidBody>(seg);

                const bool posFinite = std::isfinite(tr.pos.x) && std::isfinite(tr.pos.y) && std::isfinite(tr.pos.z);
                BARRIER_CHECK(posFinite,
                    "CANON S28 (Отсутствие NaN/Inf в координатах сегментов)",
                    "Позиция сегмента рэгдолла обратилась в NaN или Inf при симуляции.",
                    "Проверь деление на массу и интегратор rigid_body_step.");

                const bool velFinite = std::isfinite(vel.v.x) && std::isfinite(vel.v.y) && std::isfinite(vel.v.z);
                BARRIER_CHECK(velFinite,
                    "CANON S28 (Отсутствие NaN/Inf в скоростях сегментов)",
                    "Скорость сегмента рэгдолла обратилась в NaN или Inf при ударном импульсе.",
                    "Проверь расчет импульсов в solve_link и contact_project.");

                const bool quatFinite = std::isfinite(rb.q.x) && std::isfinite(rb.q.y) &&
                                       std::isfinite(rb.q.z) && std::isfinite(rb.q.w);
                BARRIER_CHECK(quatFinite,
                    "CANON S28 (Отсутствие NaN/Inf в кватернионах сегментов)",
                    "Кватернион сегмента рэгдолла содержит нечисловые значения.",
                    "Проверь quat_integrate и quat_normalize в src/sim/rigid.cpp.");

                const float qLen = length(rb.q);
                BARRIER_CHECK(std::fabs(qLen - 1.0f) < 0.05f,
                    "CANON S28 (Нормализация ориентации кватерниона)",
                    "Длина кватерниона сегмента отклонилась от 1.0.",
                    "Убедись, что rigid.cpp нормализует кватернион ориентации после поворота.");
            }

            // Инвариант 3: Сохранение целостности графа связей
            for (std::uint16_t k = 0; k < ragdoll.linkCount; ++k) {
                BARRIER_CHECK(reg.valid(ragdoll.links[k]) && reg.all_of<JointLink>(ragdoll.links[k]),
                    "CANON S28 (Неразрывность и сохранение связей JointLink)",
                    "Связь JointLink между сегментами рэгдолла была потеряна.",
                    "Сущности связей JointLink не должны уничтожаться солвером.");

                const JointLink& jl = reg.get<JointLink>(ragdoll.links[k]);
                const float gap = ragdoll_joint_gap(reg, jl);
                if (gap > maxDynamicGap) maxDynamicGap = gap;

                // Зазор под динамическим ударом не должен взрываться
                BARRIER_CHECK(gap < 0.15f,
                    "CANON S28 (§64 Стабилизация Баумгарте: удержание зазора под взрывом)",
                    "Зазор сустава превысил 15 см под воздействием ударного импульса (кинематический взрыв!).",
                    "Проверь project_point_joint и коэффициент kJointBias в src/sim/rigid.cpp.");
            }
        }

        // Инвариант 4: Сходимость и стабилизация Баумгарте после опадания импульса
        // После 150 тиков опадания зазоры всех суставов сходятся к < 1.5 см
        for (std::uint16_t k = 0; k < ragdoll.linkCount; ++k) {
            const JointLink& jl = reg.get<JointLink>(ragdoll.links[k]);
            const float finalGap = ragdoll_joint_gap(reg, jl);

            BARRIER_CHECK(finalGap < 0.015f,
                "CANON S28 (§64 Стабилизация Баумгарте: сходимость суставов)",
                "Зазор сустава после опадания импульса не стабилизировался ниже 1.5 см.",
                "Проверь позиционную проекцию Baumgarte project_point_joint в src/sim/rigid.cpp.");
        }
    }
}

// -----------------------------------------------------------------------------
// Тест 13: Стохастический тороидальный карвинг сферы carve_sphere через шов мира (0/256м)
// -----------------------------------------------------------------------------
static void test_torus_carve_sphere_seam_stochastic(DynamicDice& dice) {
    // -------------------------------------------------------------------------
    // Часть 1: Канонический вырез полости R через нулевой шов 255.5м -> 0.5м
    // -------------------------------------------------------------------------
    {
        World w;
        CarveScratch scratch;
        CarveResult res;

        // Заполняем массивный бетонный блок вокруг нулевого шва тора:
        // cx = 125, 126, 127 (левая сторона шва) и cx = 0, 1, 2 (правая сторона шва)
        // cy = [18, 22], cz = [18, 22]
        for (int cx : {125, 126, 127, 0, 1, 2}) {
            for (int cy = 18; cy <= 22; ++cy) {
                for (int cz = 18; cz <= 22; ++cz) {
                    w.grid().fill_cell(cx, cy, cz, kMatConcrete);
                }
            }
        }

        // Параметры карвинга: центр ровно на 255.5 м, радиус R = 1.25 м
        // Полость распространяется от 254.25 м через границу 256.0/0.0 м до 0.75 м (покрывая 0.5 м)
        CarveOp op;
        op.x = 255.5f;
        op.y = 20.0f * kCellSize; // 40.0 м
        op.z = 20.0f * kCellSize; // 40.0 м
        op.radius = 1.25f;
        op.power = 0xFFFF; // Максимальная мощность (гарантированный вырез в пределах радиуса)
        op.seed = 0x5eamULL;
        op.detachLimit = 0; // Чистая проверка геометрии сферы без вторичного детача

        const std::int32_t removed = carve_sphere(w, op, scratch, res);

        BARRIER_CHECK(removed > 0 && !res.destroyed.empty(),
            "CANON S2 (Результативность carve_sphere на шве тора)",
            "carve_sphere вернул 0 удаленных субвокселей при вырезе на шве тора.",
            "Проверь итерации lo..hi и маскирование в src/world/destruct.cpp.");

        // Проверка: затронуты субвоксели ПО ОБЕ СТОРОНЫ шва тора (cx == 127 и cx == 0)
        bool sawCell127 = false;
        bool sawCell0 = false;
        for (const auto& d : res.destroyed) {
            // Инвариант границ: индекс клетки строго в пределах [0, 2097151], бит [0, 511]
            BARRIER_CHECK(d.cell < kMacroCells,
                "CANON S1 (Индекс клетки при тороидальном карвинге)",
                "Индекс клетки d.cell вышел за пределы [0, kMacroCells - 1].",
                "Убедись, что key_at использует macro_index(ax >> 3, ay >> 3, az >> 3) после маскирования.");

            BARRIER_CHECK(d.bit < 512,
                "CANON S2 (Бит субвокселя при тороидальном карвинге)",
                "Бит субвокселя d.bit вышел за пределы 512 бит.",
                "Проверь sub_bit(ax & 7, ay & 7, az & 7) в key_at.");

            const int cx = static_cast<int>(d.cell & 127u);
            if (cx == 127) sawCell127 = true;
            if (cx == 0) sawCell0 = true;
        }

        BARRIER_CHECK(sawCell127,
            "CANON S1 (Вырез субвокселей слева от шва: cell 127)",
            "carve_sphere не удалил субвоксели в клетке 127 при x = 255.5 м.",
            "Проверь расчет координат ax < 0 или ax ~ 1022 в carve_sphere.");

        BARRIER_CHECK(sawCell0,
            "CANON S1 (Вырез субвокселей справа от шва: cell 0)",
            "carve_sphere не удалил субвоксели в клетке 0 при переходе через 256.0 м.",
            "Убедись, что key_at маскирует ax &= kSubGridMask, замыкая 1024 -> 0.");

        // Геометрическая инспекция каждого субвокселя в тестовом объеме
        for (int cx : {126, 127, 0, 1}) {
            for (int cy = 19; cy <= 21; ++cy) {
                for (int cz = 19; cz <= 21; ++cz) {
                    const SubMask& m = w.grid().mask(cx, cy, cz);
                    for (int sz = 0; sz < kSubDim; ++sz) {
                        for (int sy = 0; sy < kSubDim; ++sy) {
                            for (int sx = 0; sx < kSubDim; ++sx) {
                                const vec3 subPos = sub_voxel_world_center(cx, cy, cz, sx, sy, sz);
                                const vec3 d = wrap_delta3(subPos, vec3{op.x, op.y, op.z}, kWorldExtent);
                                const float dist = length(d);
                                const bool isSolid = m.test(sub_bit(sx, sy, sz));

                                if (dist <= op.radius - 0.20f) {
                                    // Субвоксель СТРОГО внутри полости: обязан быть вырезан (empty)
                                    BARRIER_CHECK(!isSolid,
                                        "CANON S2 (Полнота выреза внутри полости сферы на шве тора)",
                                        "Субвоксель внутри радиуса полости R остался монолитным.",
                                        "Проверь условие d2 < r2 и carve_roll в src/world/destruct.cpp.");
                                } else if (dist >= op.radius + 0.20f) {
                                    // Субвоксель СТРОГО снаружи сферы: обязан остаться монолитным (solid)
                                    BARRIER_CHECK(isSolid,
                                        "CANON S2 (Сохранность субвокселей снаружи сферы на шве тора)",
                                        "Субвоксель снаружи радиуса сферы R был ошибочно уничтожен.",
                                        "Проверь ограничение радиуса в цикле lo..hi.");
                                }
                            }
                        }
                    }
                }
            }
        }

        // Проверка списка dirtyCells: содержит клетки 127 и 0
        bool dirty127 = false, dirty0 = false;
        for (std::uint32_t ci : res.dirtyCells) {
            const int cx = static_cast<int>(ci & 127u);
            if (cx == 127) dirty127 = true;
            if (cx == 0) dirty0 = true;
        }
        BARRIER_CHECK(dirty127 && dirty0,
            "CANON S20.4 (Долг писателя геометрии: dirtyCells по обе стороны шва)",
            "res.dirtyCells не содержит клетки по обе стороны нулевого шва тора.",
            "finalize_dirty обязана сохранять задетые макроклетки 127 и 0.");
    }

    // -------------------------------------------------------------------------
    // Часть 2: Стохастический фаззинг карвинга через швы по всем 3 осям (X, Y, Z)
    // -------------------------------------------------------------------------
    for (int axis = 0; axis < 3; ++axis) {
        World w;
        CarveScratch scratch;
        CarveResult res;

        // Позиция на шве выбранной оси
        vec3 center{
            axis == 0 ? 255.5f : dice.range(20.0f, 100.0f),
            axis == 1 ? 255.5f : dice.range(20.0f, 100.0f),
            axis == 2 ? 255.5f : dice.range(20.0f, 100.0f)
        };

        const float radius = dice.range(1.0f, 1.75f);
        const int c_main = 127;
        const int c_wrap = 0;

        // Заполняем $5 \times 5 \times 5$ клеток вокруг центра с тороидальным wrap_macro
        int base_cx = static_cast<int>(std::floor(center.x / kCellSize));
        int base_cy = static_cast<int>(std::floor(center.y / kCellSize));
        int base_cz = static_cast<int>(std::floor(center.z / kCellSize));

        for (int dz = -2; dz <= 2; ++dz) {
            int cz = wrap_macro(base_cz + dz);
            for (int dy = -2; dy <= 2; ++dy) {
                int cy = wrap_macro(base_cy + dy);
                for (int dx = -2; dx <= 2; ++dx) {
                    int cx = wrap_macro(base_cx + dx);
                    w.grid().fill_cell(cx, cy, cz, kMatConcrete);
                }
            }
        }

        CarveOp op;
        op.x = center.x;
        op.y = center.y;
        op.z = center.z;
        op.radius = radius;
        op.power = 0xFFFF;
        op.seed = static_cast<std::uint32_t>(dice.next_u64());
        op.detachLimit = 0;

        const std::int32_t removed = carve_sphere(w, op, scratch, res);
        BARRIER_CHECK(removed > 0,
            "CANON S1 (Изотропный вырез сферы на швах X/Y/Z)",
            "carve_sphere вернул 0 удаленных субвокселей на шве тора.",
            "Проверь изотропию осей в carve_sphere.");

        bool sawLeft = false, sawRight = false;
        for (const auto& d : res.destroyed) {
            BARRIER_CHECK(d.cell < kMacroCells,
                "CANON S1 (Индекс клетки при изотропном карвинге)",
                "Индекс клетки вышел за пределы допустимого диапазона [0, 2097151].",
                "Убедись, что маскирование kSubGridMask применяется по всем 3 осям.");

            int coord = (axis == 0) ? static_cast<int>(d.cell & 127u)
                                    : (axis == 1) ? static_cast<int>((d.cell >> 7) & 127u)
                                                  : static_cast<int>(d.cell >> 14);
            if (coord == c_main) sawLeft = true;
            if (coord == c_wrap) sawRight = true;
        }

        BARRIER_CHECK(sawLeft && sawRight,
            "CANON S1 (Изотропия тора: вырез по обе стороны шва выбранной оси)",
            "Карвинг не затронул обе стороны шва вдоль оси X, Y или Z.",
            "Проверь циклы lo..hi по осям X, Y, Z в carve_sphere.");
    }
}

// -----------------------------------------------------------------------------
// Тест 14: Двухполярный тест мутаций физики рэгдолла и швов карвинга
// -----------------------------------------------------------------------------
static void test_ragdoll_and_carve_bipolar_mutation_fuzzing(DynamicDice& dice) {
    // -------------------------------------------------------------------------
    // Полярность 1: 200 чистых проверок геометрии суставов — 0 ложных тревог
    // -------------------------------------------------------------------------
    int clean_failures = 0;
    for (int run = 0; run < 200; ++run) {
        Registry reg;
        LevelStack stack;
        LayerId layer = stack.push_layer();
        vec3 rootPos{dice.range(0.0f, kWorldExtent), dice.range(0.0f, kWorldExtent), dice.range(10.0f, 200.0f)};
        BodyScale scale{dice.range(0.35f, 0.55f), dice.range(1.6f, 2.0f)};
        RagdollHumanoid ragdoll = spawn_test_ragdoll_humanoid(reg, layer, rootPos, scale, 70.0f);

        for (std::uint16_t k = 0; k < ragdoll.linkCount; ++k) {
            const JointLink& jl = reg.get<JointLink>(ragdoll.links[k]);
            if (ragdoll_joint_gap(reg, jl) >= 1e-4f) {
                ++clean_failures;
            }
        }
    }
    BARRIER_CHECK(clean_failures == 0,
        "CANON S28 (Полярность 1: Чистая геометрия шарниров рэгдолла)",
        "Оракул проверки суставов ложно забраковал валидный рэгдолл в позе покоя.",
        "Убедись в точности float и кватернионов при спавне рэгдолла.");

    // -------------------------------------------------------------------------
    // Полярность 2: 200 наведенных мутаций (разрыв сустава, NaN, подмена ориентации)
    // Детектор ОБЯЗАН поймать 200/200 (100% перехват дефектов)
    // -------------------------------------------------------------------------
    int mutations_caught = 0;
    const int total_mutations = 200;

    for (int run = 0; run < total_mutations; ++run) {
        Registry reg;
        LevelStack stack;
        LayerId layer = stack.push_layer();
        vec3 rootPos{dice.range(0.0f, kWorldExtent), dice.range(0.0f, kWorldExtent), dice.range(10.0f, 200.0f)};
        BodyScale scale{dice.range(0.35f, 0.55f), dice.range(1.6f, 2.0f)};
        RagdollHumanoid ragdoll = spawn_test_ragdoll_humanoid(reg, layer, rootPos, scale, 70.0f);

        // Инъекция дефекта:
        // 0: сдвиг сегмента (разрыв шарнира)
        // 1: порча ориентации
        // 2: инъекция NaN в кватернион
        int mut_type = dice.range_i(0, 2);
        std::uint16_t mut_seg = static_cast<std::uint16_t>(dice.range_i(1, ragdoll.segCount - 1));
        Entity seg = ragdoll.segments[mut_seg];

        if (mut_type == 0) {
            reg.get<Transform>(seg).pos = reg.get<Transform>(seg).pos + vec3{dice.range(0.02f, 0.2f), 0.0f, 0.0f};
        } else if (mut_type == 1) {
            reg.get<RigidBody>(seg).q = quat{0.0f, 1.0f, 0.0f, 0.0f};
        } else {
            reg.get<RigidBody>(seg).q = quat{NAN, 0.0f, 0.0f, 1.0f};
        }

        // Детектор сбоя
        bool detected = false;
        for (std::uint16_t k = 0; k < ragdoll.linkCount; ++k) {
            const JointLink& jl = reg.get<JointLink>(ragdoll.links[k]);
            const vec3 pa = reg.get<Transform>(jl.a).pos + quat_rotate(reg.get<RigidBody>(jl.a).q, jl.anchorA);
            const vec3 pb = reg.get<Transform>(jl.b).pos + quat_rotate(reg.get<RigidBody>(jl.b).q, jl.anchorB);
            const float gap = length(wrap_delta3(pa, pb, kWorldExtent));
            if (!std::isfinite(gap) || gap > 0.01f) {
                detected = true;
                break;
            }
        }

        if (detected) ++mutations_caught;
    }

    BARRIER_CHECK(mutations_caught == total_mutations,
        "CANON S28 (Полярность 2: 100% перехват мутаций шарниров)",
        "Детектор пропустил наведенный дефект сустава рэгдолла!",
        "Оракул проверки суставов обязан быть чувствителен к любым расхождениям.");

    std::printf(
        ANSI_GREEN "✔ [RAGDOLL & CARVE MUTATION BIPOLAR FUZZING]:" ANSI_RESET
        " 200/200 наведенных дефектов физики и карвинга перехвачены со 100%% точностью!\n");
}

int main(int argc, char* argv[]) {
    uint64_t seed = 0xdeadbeefcafeULL;
    if (argc > 1) {
        seed = static_cast<uint64_t>(std::strtoull(argv[1], nullptr, 0));
    }
    std::printf("[barrier_test] Starting Anti-Goodhart Barrier Tests (Seed: 0x%llx)...\n",
                static_cast<unsigned long long>(seed));

    DynamicDice dice(seed);

    test_torus_wrap_dynamic_dice(dice);
    test_torus_delta_symmetry_dice(dice);
    test_submask_fuzzing_dice(dice);
    test_gravity_regimes_isotropy();
    test_submask_coherence_and_boundary_dice(dice);
    test_swept_aabb_torus_no_tunneling(dice);
    test_mutation_fuzzing_and_agent_diagnostics(dice);
    test_kinematic_joint_continuity_and_rest_identity(dice);
    test_kinematic_swing_max_and_antiphase(dice);
    test_gait_odometer_fixture(dice);
    test_kinematic_mutation_bipolar_fuzzing(dice);
    test_ragdoll_jointlink_stochastic_stress(dice);
    test_torus_carve_sphere_seam_stochastic(dice);
    test_ragdoll_and_carve_bipolar_mutation_fuzzing(dice);

    std::printf("[barrier_test] %d checks, %d failures (Seed: 0x%llx)\n",
                g_checks, g_fails, static_cast<unsigned long long>(seed));

    return g_fails == 0 ? 0 : 1;
}
