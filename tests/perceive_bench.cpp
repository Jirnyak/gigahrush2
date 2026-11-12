// СТЕНД МАСШТАБА ВОСПРИЯТИЯ — «сколько стоит проход восприятия на тысячах тел
// на НАСТОЯЩЕМ этаже, и что в этой цене луч, а что перебор».
//
// ЗАЧЕМ ОН ЕСТЬ. Владелец 2026-11-12 задал масштаб, от которого решается форма
// заслонения («луч или не луч»): порядка 10 тысяч активных объектов на этаже и
// минимум тысячи мобов/NPC. Живая игра сегодня держит ~500 тел, и замер на ней
// (5-14 маршей в тик, проход 0.05-0.12 мс) отвечает на вопрос о ДРУГОМ
// масштабе. Экстраполяция с 500 на 4096 — модель; за последние заходы семь
// таких моделей подряд опроверг прогон. Поэтому стенд, а не арифметика.
//
// ЧТО В НЁМ НАСТОЯЩЕЕ: этаж строит тот же генератор, что в игре
// (`generate_floor`), проход — тот же `perceive_step`, взгляд — тот же
// `look_step`, вражда — та же базовая матрица. Своего закона у стенда нет.
//
// ЧТО В НЁМ МОДЕЛЬ, И ОНА НАЗВАНА: расстановка тел. Игра ставит население по
// комнатам модуля; стенд ставит его на клетки «чистый воздух над опорой» двумя
// способами, и оба числа печатаются рядом:
//   * РОВНО по всему этажу — так сегодня живёт толпа;
//   * КУЧНО в шаре радиуса `kFogStartFrac * kWorldExtent` (64 м) — так живут
//     ВОПЛОЩЁННЫЕ тела вокруг наблюдателя: кап акторов есть кап окрестности
//     игрока, а не этажа, и плотность там выше.
// Состав — доли этажа 6 ([game/floor_spec.cpp]): пятая часть монстров, жители
// 7:1:1:0:1 по фракциям.
//
// ЦЕНА МАРША мерится ОТДЕЛЬНО, вторым таймером по выборке настоящих пар в
// радиусе зрения: часы внутри прохода стоили бы дороже самого марша (§86 —
// счётчик в горячем цикле недействителен), а разность «проход минус марши»
// и есть цена перебора.
//
// Не ctest — прибор, как `sim_bench` и `rigid_bench`.
// Запуск: ./build/perceive_bench [этаж=0] [тел=500,1000,2000,4096]

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"            // NpcRef
#include "game/faction.h"
#include "game/faction_relations.h" // kBaseFactionMatrix
#include "game/floor_catalog.h"     // модуль этажа по номеру
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/look.h"
#include "game/mob_spawn.h"         // MobRef
#include "game/mob_table.h"
#include "game/noise.h"
#include "game/npc_pool.h"
#include "game/perceive.h"
#include "game/witness.h"           // kEyeLiftM
#include "world/gravity.h"
#include "world/level_stack.h"
#include "world/los.h"
#include "world/macro_grid.h"
#include "world/types.h"
#include "world/world.h"

using namespace giga;
using namespace giga::game;

namespace {

constexpr int kInertObjects = 10000;  // «активные объекты» масштаба владельца
constexpr int kPeriods = 12;          // полных периодов восприятия в замере
constexpr float kBodyHalfHeightM = 0.9f;

struct Spot {
    vec3 pos;
};

// Клетка «чистый воздух над опорой»: в ней стоит тело, и глаз его (центр +
// kEyeLiftM = 1.5 м над низом клетки) лежит в той же клетке. Опора — любая
// материя в клетке ниже по гравитации этажа; все три модуля сегодня NegZ, и
// стенд это ПРОВЕРЯЕТ, а не предполагает.
std::vector<Spot> standable_spots(const World& w) {
    const MacroGrid& g = w.grid();
    std::vector<Spot> out;
    out.reserve(1u << 20);
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                if (!g.mask(x, y, z).empty()) continue;
                if (g.mask(x, y, z - 1).empty()) continue;
                out.push_back(Spot{vec3{(static_cast<float>(x) + 0.5f) * kCellSize,
                                        (static_cast<float>(y) + 0.5f) * kCellSize,
                                        static_cast<float>(z) * kCellSize +
                                            kBodyHalfHeightM}});
            }
    return out;
}

struct Run {
    double msPerTick = 0.0;
    double scanned = 0.0, pairsNear = 0.0, pairsCone = 0.0;
    double rays = 0.0, occluded = 0.0, sawFoe = 0.0;
    double marchNs = 0.0;  // нс на марш по выборке настоящих пар
};

Run measure(const World& world, const std::vector<Spot>& spots, int n,
            std::uint32_t seed) {
    Registry reg;
    NpcPool pool;
    pool.init();
    NoiseField noise;
    const FactionRelations rel = kBaseFactionMatrix;
    const LayerId layer = 0;

    // Объекты без тождества — масштаб владельца. Проход обязан их не замечать.
    for (int i = 0; i < kInertObjects; ++i) {
        const Entity p = reg.create();
        const Spot& s = spots[(static_cast<std::size_t>(i) * 7919u) % spots.size()];
        reg.emplace<Transform>(p, Transform{s.pos, layer});
        if ((i & 1) != 0) reg.emplace<Velocity>(p, Velocity{});
    }

    static constexpr Faction kMix[10] = {
        Faction::Citizens, Faction::Citizens, Faction::Citizens, Faction::Citizens,
        Faction::Citizens, Faction::Citizens, Faction::Citizens,
        Faction::Liquidators, Faction::Cultists, Faction::Wild};
    std::vector<vec3> eyes;
    eyes.reserve(static_cast<std::size_t>(n));
    const std::size_t stride = spots.size() / static_cast<std::size_t>(n);
    for (int i = 0; i < n; ++i) {
        // Шаг по списку плюс хеш-сдвиг внутри шага: тела не ложатся в линию.
        const std::size_t at =
            (static_cast<std::size_t>(i) * stride +
             hash_u32(seed ^ static_cast<std::uint32_t>(i)) % (stride ? stride : 1)) %
            spots.size();
        const vec3 pos = spots[at].pos;
        const Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{pos, layer});
        reg.emplace<Velocity>(e, Velocity{});
        if (i % 5 == 0) {
            const MobKind k = MobKind::Zombie;
            const std::int16_t hp = static_cast<std::int16_t>(mob_def(k).hp);
            reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(k), 1, hp, hp});
        } else {
            const NpcId id = pool.spawn();
            pool.hp(id) = 100;
            pool.max_hp(id) = 100;
            pool.faction(id) = static_cast<std::uint16_t>(kMix[i % 10]);
            pool.height_mm(id) = 1750;
            reg.emplace<NpcRef>(e, NpcRef{id});
        }
        eyes.push_back(vec3{pos.x, pos.y, pos.z + kEyeLiftM});
    }
    const GravityFrame gf = steer_frame_of(&world.gravity());
    look_step(reg, layer, gf);  // взгляд новорождённых — из тождества

    Run r{};
    PerceiveTick sum{};
    const int ticks = kPeriods * static_cast<int>(kPerceivePeriod);
    // Прогрев: первый период рождает `Senses`/`Steer` и не мерится.
    for (std::uint64_t t = 0; t < kPerceivePeriod; ++t)
        (void)perceive_step(reg, world.grid(), noise, pool, rel, layer, t,
                            &world.gravity());
    const auto t0 = std::chrono::steady_clock::now();
    for (int t = 0; t < ticks; ++t) {
        const PerceiveTick pt =
            perceive_step(reg, world.grid(), noise, pool, rel, layer,
                          kPerceivePeriod + static_cast<std::uint64_t>(t),
                          &world.gravity());
        sum.scanned += pt.scanned;
        sum.pairsNear += pt.pairsNear;
        sum.pairsCone += pt.pairsCone;
        sum.rays += pt.rays;
        sum.occluded += pt.occluded;
        sum.sawFoe += pt.sawFoe;
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double tk = static_cast<double>(ticks);
    r.msPerTick =
        std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(
            t1 - t0).count() / tk;
    r.scanned = sum.scanned / tk;
    r.pairsNear = sum.pairsNear / tk;
    r.pairsCone = sum.pairsCone / tk;
    r.rays = sum.rays / tk;
    r.occluded = sum.occluded / tk;
    r.sawFoe = sum.sawFoe / tk;

    // ЦЕНА МАРША — отдельный таймер по выборке пар в радиусе зрения жителя.
    std::vector<std::pair<vec3, vec3>> sample;
    const float r2 = kWitnessSightM * kWitnessSightM;
    for (std::size_t i = 0; i < eyes.size() && sample.size() < 20000; ++i)
        for (std::size_t j = i + 1; j < eyes.size() && sample.size() < 20000; ++j) {
            if (wrap_dist2(eyes[i], eyes[j], kWorldExtent) > r2) continue;
            const vec3 d = wrap_delta3(eyes[i], eyes[j], kWorldExtent);
            sample.push_back({eyes[i], vec3{eyes[i].x + d.x, eyes[i].y + d.y,
                                            eyes[i].z + d.z}});
        }
    if (!sample.empty()) {
        std::uint32_t blockedCount = 0;
        const auto m0 = std::chrono::steady_clock::now();
        for (const auto& s : sample)
            if (sight_blocked(world.grid(), s.first, s.second)) ++blockedCount;
        const auto m1 = std::chrono::steady_clock::now();
        (void)blockedCount;
        r.marchNs = static_cast<double>(
                        std::chrono::duration_cast<std::chrono::nanoseconds>(
                            m1 - m0).count()) /
                    static_cast<double>(sample.size());
    }
    return r;
}

void report(const char* label, const World& world, const std::vector<Spot>& spots,
            const std::vector<int>& counts) {
    std::printf("\n%s — стоячих клеток %zu\n", label, spots.size());
    std::printf("  %6s | %9s | %12s | %9s | %8s | %8s | %6s | %7s | %9s | %9s\n",
                "тел", "мс/тик", "перебрано", "пар рядом", "в конусе", "маршей",
                "засл.%", "нс/марш", "марши мс", "перебор мс");
    for (int n : counts) {
        if (static_cast<std::size_t>(n) > spots.size()) {
            std::printf("  %6d | клеток меньше, чем тел — пропуск\n", n);
            continue;
        }
        const Run r = measure(world, spots, n, 0x51ed270bu);
        const double marchMs = r.rays * r.marchNs / 1e6;
        std::printf("  %6d | %9.3f | %12.0f | %9.1f | %8.1f | %8.1f | %6.1f | "
                    "%7.0f | %9.3f | %9.3f\n",
                    n, r.msPerTick, r.scanned, r.pairsNear, r.pairsCone, r.rays,
                    r.rays > 0.0 ? 100.0 * r.occluded / r.rays : 0.0, r.marchNs,
                    marchMs, r.msPerTick - marchMs);
    }
}

} // namespace

int main(int argc, char** argv) {
    const int floor = argc > 1 ? std::atoi(argv[1]) : 0;
    std::vector<int> counts;
    if (argc > 2) {
        for (const char* p = argv[2]; *p != '\0';) {
            counts.push_back(std::atoi(p));
            while (*p != '\0' && *p != ',') ++p;
            if (*p == ',') ++p;
        }
    } else {
        counts = {500, 1000, 2000, 4096};
    }

    LevelStack stack;
    const LayerId ground = stack.push_layer();
    // МОДУЛЬ ЭТАЖА — ИЗ КАТАЛОГА, тем же вопросом, что задаёт приложение
    // (`floor_catalog().resolve(number).kind`). `floor_spec_for(number)` на
    // этот вопрос НЕ отвечает: он раздаёт характер по V-образной шкале и про
    // заявки модулей не знает — первая редакция стенда звала его и молча
    // мерила падик под номерами 5 и 6 (три таблицы совпали до третьего знака).
    FloorCatalog catalog;
    if (!build_default_floor_catalog(catalog)) {
        std::printf("ОТКАЗ: каталог этажей не собрался\n");
        return 1;
    }
    const FloorKind kind = catalog.resolve(floor).kind;
    const FloorSpec& spec = floor_spec(kind);
    generate_floor(stack.layer(ground), floor, spec,
                   1337u ^ (static_cast<std::uint32_t>(floor) * 0x9e3779b9u));
    std::printf("модуль этажа %d: вид %d\n", floor, static_cast<int>(kind));
    const World& world = stack.layer(ground);
    const GravityFrame gf = steer_frame_of(&world.gravity());
    std::printf("=== стенд масштаба восприятия: этаж %d, период %u тиков, "
                "%d объектов без тождества, замер %d периодов ===\n",
                floor, static_cast<unsigned>(kPerceivePeriod), kInertObjects,
                kPeriods);
    if (gf.axis != 2 || gf.upSign != 1) {
        std::printf("ОТКАЗ: расстановка стенда написана под гравитацию −Z, а у "
                    "этажа ось %d знак %d\n", gf.axis, gf.upSign);
        return 1;
    }

    const std::vector<Spot> all = standable_spots(world);
    if (all.empty()) {
        std::printf("ОТКАЗ: на этаже нет стоячих клеток\n");
        return 1;
    }
    report("РОВНО ПО ЭТАЖУ", world, all, counts);

    // КУЧНО: шар радиуса старта дымки вокруг срединной стоячей клетки.
    const vec3 centre = all[all.size() / 2].pos;
    const float ballM = kWorldExtent * kFogStartFrac;
    std::vector<Spot> ball;
    for (const Spot& s : all)
        if (wrap_dist2(centre, s.pos, kWorldExtent) <= ballM * ballM)
            ball.push_back(s);
    char label[160];
    std::snprintf(label, sizeof label,
                  "КУЧНО, шар %.0f м вокруг (%.0f, %.0f, %.0f)",
                  static_cast<double>(ballM), static_cast<double>(centre.x),
                  static_cast<double>(centre.y), static_cast<double>(centre.z));
    report(label, world, ball, counts);
    return 0;
}
