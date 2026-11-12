// СТОРОЖ КРАЯ — СУД ([game/guide.h] steer_off_edge, CANON S26.5).
//
// РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-11-12: тело само не шагает туда, где падение ранит;
// сторож стоит в двери ведения. До него сторожа не было нигде: бегство,
// погоня и идти-на-шум вели вслепую, а цена обрыва в полях нава отговаривала
// только цели вида «зона» и только внутри зоны.
//
// ЧТО СУДИТСЯ: высота края выведена из закона удара и тяги ЭТОГО мира; обрыв
// распознаётся в шести системах гравитации; граница — ровно безвредная
// высота; стена и ступень краем не считаются; единственный писатель скорости
// останавливает тело у края владеемым нулём — и это проверено ХОДОМ через
// настоящий солвер, в обе полярности (со сторожем стоит, без него падает).
#include <cmath>
#include <cstdint>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"       // decider_of — у вещи решателя нет
#include "game/embody.h"   // NpcRef, kBodyHalfWidth
#include "game/guide.h"
#include "game/impact.h"
#include "game/npc_pool.h"
#include "game/wander.h"
#include "sim/physics.h"
#include "world/gravity.h"
#include "world/level_stack.h"
#include "world/macro_grid.h"

namespace kray_test {

using namespace giga;
using namespace giga::game;

const vec3 kCube{0.4f, 0.4f, 0.4f};

GravityField field_of(GravityRegime r, float g = 9.81f) {
    const CellStep d = regime_down(r);
    GravityField f;
    f.regime = r;
    f.global = vec3{static_cast<float>(d.x) * g, static_cast<float>(d.y) * g,
                    static_cast<float>(d.z) * g};
    return f;
}

// Клетка (a, b) в плоскости ходьбы и `depth` вдоль оси низа — для любой оси.
void fill_at(MacroGrid& g, int axis, int a, int b, int depth) {
    const int cx = axis == 0 ? depth : a;
    const int cy = axis == 1 ? depth : (axis == 0 ? a : b);
    const int cz = axis == 2 ? depth : b;
    g.fill_cell(cx, cy, cz, kMatConcrete);
}

// ---- 1. ВЫСОТА КРАЯ ВЫВЕДЕНА, А НЕ НАЗНАЧЕНА --------------------------------
void drop_height_is_derived() {
    MacroGrid grid;
    const GravityField earth = field_of(GravityRegime::NegZ);
    const SteerGround g = steer_ground_of(&grid, &earth);
    CHECK(g.grid == &grid);
    // h = v² / 2g при бесплатной скорости закона удара; в субвокселях — вниз.
    const float h = kImpactFreeSpeed * kImpactFreeSpeed / (2.0f * 9.81f);
    CHECK(g.dropLayers == static_cast<int>(h / kVoxelSize));
    CHECK(g.dropLayers == 8); // 2.15 м: шаг с двухметровой клетки бесплатен
    // Половинная тяга — вдвое выше безвредный край. Число не зашито.
    const GravityField half = field_of(GravityRegime::NegZ, 9.81f * 0.5f);
    CHECK(steer_ground_of(&grid, &half).dropLayers == 17);
    // Без грида, без низа — сторожить нечего.
    CHECK(steer_ground_of(nullptr, &earth).grid == nullptr);
    const GravityField zero = field_of(GravityRegime::Zero);
    CHECK(steer_ground_of(&grid, &zero).grid == nullptr);
    CHECK(!steer_off_edge(steer_ground_of(nullptr, &earth), vec3{9, 9, 9},
                          kCube, vec3{1, 0, 0}));
}

// ---- 2. ОБРЫВ В ШЕСТИ СИСТЕМАХ ГРАВИТАЦИИ -----------------------------------
// Платформа — пятно 3×3 клетки (a, b ∈ 20..22) на шаг «ниже» клеток тела;
// тело стоит на средней клетке и смотрит по первой касательной оси.
void edge_is_frame_agnostic() {
    const GravityRegime regimes[] = {
        GravityRegime::NegX, GravityRegime::PosX, GravityRegime::NegY,
        GravityRegime::PosY, GravityRegime::NegZ, GravityRegime::PosZ};
    for (GravityRegime r : regimes) {
        const CellStep d = regime_down(r);
        const int axis = d.x != 0 ? 0 : d.y != 0 ? 1 : 2;
        const int sign = d.x + d.y + d.z;
        constexpr int kBody = 30;          // слой клеток тела вдоль оси низа
        const int support = kBody + sign;  // слой платформы
        MacroGrid grid;
        for (int a = 20; a <= 22; ++a)
            for (int b = 20; b <= 22; ++b) fill_at(grid, axis, a, b, support);
        const GravityField f = field_of(r);
        const SteerGround g = steer_ground_of(&grid, &f);

        // Центр тела: середина клетки (21, 21) в плоскости, подошва в 5 см
        // над платформой.
        const float plane = 21.0f * kCellSize + kCellSize * 0.5f;
        const float body =
            (static_cast<float>(kBody) + 0.5f) * kCellSize +
            static_cast<float>(sign) * (kCellSize * 0.5f - kCube.x - 0.05f);
        const auto at = [&](float a, float b) {
            return vec3{axis == 0 ? body : a, axis == 1 ? body : (axis == 0 ? a : b),
                        axis == 2 ? body : b};
        };
        // Первая касательная ось — направление шага.
        const vec3 fwd{axis == 0 ? 0.0f : 1.0f, axis == 0 ? 1.0f : 0.0f, 0.0f};
        const vec3 back = fwd * -1.0f;

        // В середине платформы шаг законен в обе стороны.
        CHECK(!steer_off_edge(g, at(plane, plane), kCube, fwd));
        CHECK(!steer_off_edge(g, at(plane, plane), kCube, back));
        // У кромки: передний край тела дошёл до края платформы (кромка на
        // 23 клетках = 46 м по ходу) и перешёл его на 3 см — дальше пустота.
        // РОВНО на кромку ставить нельзя: предикат тверди на точной границе
        // субвокселя отвечает по округлению float, и тест судил бы его.
        const float brink = 23.0f * kCellSize - kCube.x + 0.03f;
        CHECK(steer_off_edge(g, at(brink, plane), kCube, fwd));
        CHECK(!steer_off_edge(g, at(brink, plane), kCube, back)); // назад можно
        // За шаг до кромки — ещё можно: след по ходу целиком на платформе.
        CHECK(!steer_off_edge(g, at(brink - 2.0f * kCube.x - 0.05f, plane),
                              kCube, fwd));

        // НИЖНЯЯ СТУПЕНЬ ЗА КРОМКОЙ. Ровно безвредная высота (восемь
        // субвокселей = клетка) — шаг законен; на субвоксель глубже — обрыв.
        {
            MacroGrid stepG = grid;
            // Плита на клетку ниже платформы, сразу за кромкой: верх её на
            // 2.0 м ниже верха платформы → просвет под следом 8 слоёв.
            fill_at(stepG, axis, 23, 21, support + sign);
            const SteerGround sg = steer_ground_of(&stepG, &f);
            CHECK(!steer_off_edge(sg, at(brink, plane), kCube, fwd));
            // Срезать у этой плиты верхний субвоксель: просвет 9 слоёв.
            const int cx = axis == 0 ? support + sign : 23;
            const int cy = axis == 1 ? support + sign : (axis == 0 ? 23 : 21);
            const int cz = axis == 2 ? support + sign : 21;
            SubMask& m = stepG.mask(cx, cy, cz);
            const int top = sign < 0 ? kSubDim - 1 : 0; // слой у платформы
            for (int u = 0; u < kSubDim; ++u)
                for (int v = 0; v < kSubDim; ++v)
                    m.clear(axis == 0   ? sub_bit(top, u, v)
                            : axis == 1 ? sub_bit(u, top, v)
                                        : sub_bit(u, v, top));
            CHECK(steer_off_edge(sg, at(brink, plane), kCube, fwd));
        }
        // СТЕНА ЗА КРОМКОЙ — не край: плита подошвы упирается в её основание.
        {
            MacroGrid wallG = grid;
            fill_at(wallG, axis, 23, 21, kBody);
            const SteerGround wg = steer_ground_of(&wallG, &f);
            CHECK(!steer_off_edge(wg, at(brink, plane), kCube, fwd));
        }
    }
}

// Сцена хода: платформа z = 9, клетки x ∈ 10..14, y ∈ 10..12; дальше по +x —
// пустота на весь тор. Тело стоит на ней и получает пеленг +x.
struct Walk {
    LevelStack stack;
    LayerId layer;
    Registry reg;
    NpcPool pool;
    Entity e = entt::null;
    ZoneNav zones; // пустой: пеленгу нав не нужен
    Walk() {
        layer = stack.push_layer();
        MacroGrid& g = stack.layer(layer).grid();
        for (int y = 10; y <= 12; ++y)
            for (int x = 10; x <= 14; ++x) g.fill_cell(x, y, 9, kMatConcrete);
        pool.init();
        const NpcId id = pool.spawn();
        pool.hp(id) = 100;
        pool.max_hp(id) = 100;
        e = reg.create();
        const vec3 half{kBodyHalfWidth, kBodyHalfWidth, body_half_height(1750)};
        Transform tr;
        tr.pos = stand_centre(stack.layer(layer),
                              vec3{11.0f * kCellSize, 11.0f * kCellSize + 1.0f,
                                   10.0f * kCellSize},
                              half);
        tr.layer = layer;
        reg.emplace<Transform>(e, tr);
        reg.emplace<Velocity>(e);
        reg.emplace<AABB>(e, AABB{half});
        reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});
        reg.emplace<NpcRef>(e, NpcRef{id, pool.generation(id)});
    }
    // Секунды хода под пеленгом +x; возвращает телеметрию последнего тика.
    GuideTick march(int ticks, const MacroGrid* grid) {
        GuideTick last;
        for (int t = 0; t < ticks; ++t) {
            const std::uint64_t tick = static_cast<std::uint64_t>(t);
            steer_claim(reg, e, tick, SteerRank::Flee,
                        target_dir(vec3{1.0f, 0.0f, 0.0f},
                                   kWalkSpeedMps * kPanicPace));
            last = guide_step(reg, zones, layer, tick,
                              &stack.layer(layer).gravity(), grid);
            physics_step(reg, stack, kSimDt);
        }
        return last;
    }
};

// ---- 3. ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ ОСТАНАВЛИВАЕТ ТЕЛО У КРАЯ — ХОДОМ -------------
void writer_stops_at_the_brink() {
    constexpr float kBrinkX = 15.0f * kCellSize; // край платформы, 30 м
    constexpr int kTicks = 8 * kSimHz;           // восемь секунд бегства
    { // СО СТОРОЖЕМ: бежит к краю, встаёт всей подошвой на платформе, стоит
        Walk w;
        const float startX = w.reg.get<Transform>(w.e).pos.x;
        const GuideTick last =
            w.march(kTicks, &w.stack.layer(w.layer).grid());
        const Transform& tr = w.reg.get<Transform>(w.e);
        const vec3 half = w.reg.get<AABB>(w.e).half;
        CHECK(tr.pos.x > startX + 3.0f);          // действительно шёл
        CHECK(tr.pos.x + half.x <= kBrinkX + 0.01f); // и не вышел за кромку
        CHECK(tr.pos.x + half.x > kBrinkX - 0.5f);   // остановился У края
        CHECK(support_gap_sub(w.stack.layer(w.layer), tr.pos, half) == 0);
        CHECK(w.reg.get<GravityAffected>(w.e).grounded);
        // Последний тик: владеемый ноль у края, а не ведение и не «заявки нет».
        CHECK(last.edge == 1u);
        CHECK(last.led == 0u);
        CHECK(w.reg.get<Velocity>(w.e).v.x == 0.0f);
        CHECK(w.pool.hp(w.reg.get<NpcRef>(w.e).id) == 100);
    }
    { // БЕЗ СТОРОЖА (грид не дан) — та же сцена, тот же пеленг: тело уходит
      // за кромку и падает. Контроль: гейт выше держит именно сторож, а не
      // платформа, скорость или длина прогона.
        Walk w;
        const GuideTick last = w.march(kTicks, nullptr);
        const Transform& tr = w.reg.get<Transform>(w.e);
        CHECK(tr.pos.x > kBrinkX + 1.0f);
        CHECK(support_gap_sub(w.stack.layer(w.layer), tr.pos,
                              w.reg.get<AABB>(w.e).half) != 0);
        CHECK(last.edge == 0u);
        CHECK(last.led == 1u);
    }
    { // ТОЛКНУЛИ — ЛЕТИТ. Сторож держит только СВОЙ шаг: скорость, написанная
      // мимо ведения (отброс, взрыв), сбрасывает с края, как и раньше.
        Walk w;
        w.reg.get<Velocity>(w.e).v.x = 12.0f;
        for (int t = 0; t < kSimHz; ++t) {
            (void)guide_step(w.reg, w.zones, w.layer,
                             static_cast<std::uint64_t>(t),
                             &w.stack.layer(w.layer).gravity(),
                             &w.stack.layer(w.layer).grid());
            physics_step(w.reg, w.stack, kSimDt);
        }
        CHECK(w.reg.get<Transform>(w.e).pos.x > kBrinkX);
    }
}

// ---- 4. ЗАЯВИТЕЛЬ УЗНАЁТ ОБ ОБРЫВЕ ТОЙ ЖЕ ДВЕРЬЮ ----------------------------
// Поле зон говорит «+x» всюду. На платформе шаг есть; у кромки дверь «куда
// шагнуть» отдаёт отказ `Edge` — и прогулка снимает ногу, а не стоит у края с
// целью, которую считает исполнимой.
void claimant_learns_from_the_same_door() {
    Walk w;
    ZoneNav zn;
    zone_fixture::arm_zones_plus_x(zn);
    const GravityField& gravity = w.stack.layer(w.layer).gravity();
    const MacroGrid& grid = w.stack.layer(w.layer).grid();
    const GravityFrame gf = steer_frame_of(&gravity);
    const SteerGround ground = steer_ground_of(&grid, &gravity);
    const vec3 half = w.reg.get<AABB>(w.e).half;
    Transform& tr = w.reg.get<Transform>(w.e);

    const auto step_at = [&](float x) {
        tr.pos.x = x;
        return steer_to_zone(zn, gf, ground, tr.pos, half, cell_of_metres(x),
                             cell_of_metres(tr.pos.y), cell_of_metres(tr.pos.z),
                             static_cast<RoomId>(1), static_cast<RoomId>(2));
    };
    CHECK(step_at(12.0f * kCellSize).fail == SteerFail::None);
    const SteerStep brink = step_at(15.0f * kCellSize - half.x);
    CHECK(brink.fail == SteerFail::Edge);
    CHECK(brink.dir.x == 0.0f); // отказ скорости не несёт
    // Без земли та же дверь шаг отдаёт: отказ — дело сторожа, а не нава.
    CHECK(steer_to_zone(zn, gf, SteerGround{}, tr.pos, half,
                        cell_of_metres(tr.pos.x), cell_of_metres(tr.pos.y),
                        cell_of_metres(tr.pos.z), static_cast<RoomId>(1),
                        static_cast<RoomId>(2))
              .fail == SteerFail::None);

    // ПРОГУЛКА у кромки с готовой ногой в зону 2: нога снята, счёт `edge`.
    w.reg.emplace<WanderTarget>(
        w.e, WanderTarget{static_cast<RoomId>(2), 0u, 0u});
    // Один период стаггера: тело посещается ровно в одном его тике
    // ([game/wander.h] kWanderPeriod), остальные проходят мимо.
    std::uint32_t edge = 0, walking = 0, considered = 0;
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t) {
        const WanderTick wt =
            wander_step(w.reg, grid, w.pool, zn, w.layer, t, &gravity);
        edge += wt.edge;
        walking += wt.walking;
        considered += wt.considered;
    }
    CHECK(considered == 1u);
    CHECK(edge == 1u);
    CHECK(walking == 0u);
    CHECK(w.reg.get<WanderTarget>(w.e).zone == kNoRoom);
}

// ---- 5. ВЕЩЬ — НЕ ТЕЛО: решателя у неё нет, ног ей не выдают ----------------
// Этот закон привёл сам сторож: до 2026-11-12 `decider_of` отвечал «житель»
// про ЛЮБУЮ сущность без `MobRef` и камеры, `wander_init` выдавал ноги каждому
// `Transform` слоя, и проход прогулки посещал 4069 сущностей в тик там, где
// тел 62 — выбирал пропам ногу, спрашивал нав, подавал заявку. Лампа на стене
// получила отказ «за шагом обрыв», и счётчик `walk` упал в двенадцать раз.
void a_thing_is_not_a_body() {
    Registry reg;
    NpcPool pool;
    pool.init();
    const NpcId id = pool.spawn();

    Entity prop = reg.create();   // вещь: место есть, тождества нет
    reg.emplace<Transform>(prop, Transform{vec3{20.0f, 20.0f, 20.0f}, 0u});
    Entity body = reg.create();   // житель
    reg.emplace<Transform>(body, Transform{vec3{22.0f, 20.0f, 20.0f}, 0u});
    reg.emplace<Velocity>(body);
    reg.emplace<NpcRef>(body, NpcRef{id, pool.generation(id)});

    CHECK(decider_of(reg, prop) == Decider::None);
    CHECK(decider_of(reg, body) == Decider::Resident);

    // Ноги — только телу.
    CHECK(wander_init(reg, 0u) == 1u);
    CHECK(reg.all_of<WanderTarget>(body));
    CHECK(!reg.all_of<WanderTarget>(prop));

    // И даже вещь, которой ноги навесили руками, проход не посещает и заявки
    // ей не подаёт: за период стаггера посещено ровно одно тело.
    reg.emplace<WanderTarget>(prop, WanderTarget{});
    ZoneNav zn;
    zone_fixture::arm_zones_plus_x(zn);
    MacroGrid grid;
    std::uint32_t considered = 0;
    for (std::uint64_t t = 0; t < kWanderPeriod; ++t)
        considered += wander_step(reg, grid, pool, zn, 0u, t).considered;
    CHECK(considered == 1u);
    CHECK(reg.try_get<Steer>(prop) == nullptr);
    // Писатель скорости вещь тоже не трогает — даже с живой заявкой на ней.
    reg.emplace<Velocity>(prop, Velocity{vec3{7.0f, 7.0f, 7.0f}});
    CHECK(steer_claim(reg, prop, 3u, SteerRank::Walk,
                      target_dir(vec3{1.0f, 0.0f, 0.0f}, 1.0f)));
    const GuideTick g = guide_step(reg, zn, 0u, 3u, nullptr, nullptr);
    CHECK(g.foreign == 1u);
    CHECK(g.led == 0u);
    CHECK(reg.get<Velocity>(prop).v.x == 7.0f);
}

} // namespace kray_test

static void test_kray_all() {
    kray_test::drop_height_is_derived();
    kray_test::edge_is_frame_agnostic();
    kray_test::writer_stops_at_the_brink();
    kray_test::claimant_learns_from_the_same_door();
    kray_test::a_thing_is_not_a_body();
}
