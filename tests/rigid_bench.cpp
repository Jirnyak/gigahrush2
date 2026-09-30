// СТЕНД §64: куча трупов, а не один труп на статике.
//
// Зачем отдельный исполняемый файл, а не проверка в game_test: цикл отладки.
// game_test — 102 секунды на прогон, и вопрос «почему тела не затихают» решается
// десятками прогонов с разными числами. Бенч, как sim_bench и macro_bench, не
// ctest: он печатает числа, из которых потом ВЫВОДЯТСЯ N и T гейта.
//
// Население — как в игре (§67.1): 479 трупов = 1340 тел + 1005 линков, лежащих
// друг на друге. Стенд ставит их тем же кодом, что игра (spawn_form_segments,
// prop_forms.csv), на бетонный пол, тесной решёткой — куча складывается сама.
#include <cmath>
#include <cstdio>
#include <cstdlib>

#include "core/tick.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/prop_form_table.h"
#include "game/prop_system.h"
#include "sim/rigid.h"
#include "world/level_stack.h"
#include "world/materials.h"
#include "world/world.h"

using namespace giga;

int main(int argc, char** argv) {
    const int corpses = argc > 1 ? std::atoi(argv[1]) : 64;
    const int seconds = argc > 2 ? std::atoi(argv[2]) : 20;
    const float step = argc > 3 ? float(std::atof(argv[3])) : 0.7f;

    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    const int side = static_cast<int>(std::ceil(std::sqrt(double(corpses))));
    // Пол обязан быть шире решётки трупов: иначе крайние падают мимо него и
    // разгоняются до терминальной скорости — стенд начинает мерить свободное
    // падение вместо сна (поймано прогоном с шагом 3.0: maxV 38 м/с).
    const int pad = static_cast<int>(std::ceil(float(side) * step * 0.5f)) + 8;
    for (int y = 0; y < pad; ++y)
        for (int x = 0; x < pad; ++x) w.grid().fill_cell(x, y, 4, kMatConcrete);

    Registry reg;
    const float floorTop = 5.0f * kCellSize;
    const vec3 half{0.4f, 0.4f, 0.9f};
    // Шаг решётки МЕНЬШЕ габарита — трупы обязаны сойтись в кучу, а не встать
    // рядком: в игре они падают там, где умерли, и лежат друг на друге.
    for (int i = 0; i < corpses; ++i) {
        const int ix = i % side, iy = i / side;
        Entity root = reg.create();
        reg.emplace<Transform>(
            root, Transform{vec3{(3.0f + float(ix) * step) * kCellSize * 0.5f +
                                     2.0f * kCellSize,
                                 (3.0f + float(iy) * step) * kCellSize * 0.5f +
                                     2.0f * kCellSize,
                                 floorTop + 0.9f + float(i % 3) * 0.05f},
                            g});
        // Мёртвый падает не из стойки: небольшая начальная скорость, как у
        // тела, которое ещё шло. Без неё куча складывается идеально
        // симметрично — стенд стал бы удобнее игры.
        reg.emplace<Velocity>(
            root, Velocity{vec3{0.3f * float((i % 5) - 2),
                                0.3f * float((i % 3) - 1), 0.0f}});
        reg.emplace<AABB>(root, AABB{half});
        reg.emplace<Renderable>(root, Renderable{vec3{0.3f, 0.25f, 0.25f}});
        game::spawn_form_segments(reg, root, game::FormId::Humanoid, half,
                                  70.0f, game::kFleshRestitution,
                                  game::kFleshFriction);
    }

    std::printf("[стенд] трупов %d, шаг решётки %.2f клетки\n", corpses,
                static_cast<double>(step));
    const int ticks = seconds * kSimHz;
    for (int i = 0; i < ticks; ++i) {
        rigid_body_step(reg, stack, kSimDt);
        if ((i + 1) % (kSimHz / 2) != 0) continue; // срез раз в полсекунды
        const RigidStats& s = reg.ctx().get<RigidStats>();
        std::uint32_t asleep = 0, maxTicks = 0;
        for (auto e : reg.view<RigidBody>()) {
            const auto& rb = reg.get<RigidBody>(e);
            if (rb.asleep) ++asleep;
            if (rb.sleepTicks > maxTicks) maxTicks = rb.sleepTicks;
        }
        std::printf(
            "t=%5.1f тел %4u спит %4u | шумных %4u (лин %4u вращ %4u maxV "
            "%.3f) без-опоры %3u | будят: линк %3u пара %3u агент %3u извне "
            "%3u | суставы вне люфта %4u/%4u maxC %.4f | sleepTicks max %2u | "
            "bins %.3f solve %.3f мс\n",
            double(i + 1) / double(kSimHz), s.bodies, asleep, s.noisyBodies,
            s.noisyLinear, s.noisySpin, double(s.noisyMaxV), s.quietNoTouch,
            s.wokeLink, s.wokePair, s.wokeAgent, s.wokeExtern,
            s.linksBeyondSlop, s.links, double(s.linkMaxAbsC), maxTicks,
            double(s.binsMs), double(s.solveMs));
    }
    return 0;
}
