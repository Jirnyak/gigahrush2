// ДОСЕЛЕНИЕ — СУД НАД ЕДИНОЙ СИСТЕМОЙ «ГДЕ ТЕЛУ ВСТАТЬ» ([game/settle.h],
// CANON S26).
//
// ЗАЧЕМ. До неё холодные записи сеялись слепым хешем по всему тору, а шов
// воплощения принимал клетку, в которую тело ПОМЕЩАЕТСЯ. Замер `[voploshenie]`
// 2026-11-12: на открытой геометрии 366 тел из 378 рождались в небе и 339
// разбивались; на плотной 142 из 420 падали с 1–4 м, четверо — в столб без
// дна. Этот сьют держит закон, которым это вылечено: ТЕЛО РОЖДАЕТСЯ СТОЯЩИМ,
// на любой геометрии и в любой системе гравитации, — и судит его на
// настоящих этажах двух противоположных геометрий, а не на фикстуре.
#include <cstdint>
#include <vector>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/embody.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/floors/khrushi/khrushi.h"
#include "game/npc_pool.h"
#include "game/room.h"
#include "game/settle.h"
#include "sim/physics.h"
#include "world/gravity.h"
#include "world/level_stack.h"
#include "world/world.h"

namespace settle_test {

using namespace giga;
using namespace giga::game;

const vec3 kHalf{kBodyHalfWidth, kBodyHalfWidth, body_half_height(1750)};

bool stands(const World& w, const vec3& centre, const vec3& half) {
    const StandProbe p = stand_probe(w, centre, half);
    return p.fits && p.supported && support_gap_sub(w, centre, half) == 0;
}

// ---- 1. МЕСТО В КЛЕТКЕ: шесть гравитаций, пол на границе и пол ВНУТРИ ------
void stand_point_is_frame_agnostic() {
    // Куб: полуразмер вдоль любой оси один, судится ось фрейма.
    const vec3 cube{0.4f, 0.4f, 0.4f};
    constexpr int kC = 50;
    const GravityRegime regimes[] = {
        GravityRegime::NegX, GravityRegime::PosX, GravityRegime::NegY,
        GravityRegime::PosY, GravityRegime::NegZ, GravityRegime::PosZ};
    for (GravityRegime r : regimes) {
        const CellStep d = regime_down(r);
        { // пол — целая клетка под клеткой тела (перекрытие на границе)
            World w;
            w.gravity().regime = r;
            w.grid().fill_cell(kC + d.x, kC + d.y, kC + d.z, kMatConcrete);
            vec3 c{};
            CHECK(stand_point_in_cell(w, cube, kC, kC, kC, c));
            CHECK(stands(w, c, cube));
            // Тело стоит В названной клетке, а не в соседней.
            CHECK(cell_of_metres(c.x) == kC);
            CHECK(cell_of_metres(c.y) == kC);
            CHECK(cell_of_metres(c.z) == kC);
            // Клетка без опоры (на шаг дальше от пола) — отказ.
            vec3 air{};
            CHECK(!stand_point_in_cell(w, cube, kC - d.x, kC - d.y, kC - d.z,
                                       air));
            // Сама клетка тверди — отказ.
            CHECK(!stand_point_in_cell(w, cube, kC + d.x, kC + d.y, kC + d.z,
                                       air));
        }
        { // пол ВНУТРИ клетки: нижняя половина клетки — твердь (этаж в полторы
          // клетки кладёт перекрытие на субвоксель 4). Клеткой как единицей
          // высоты такое место не выразить — атомами выражается.
            World w;
            w.gravity().regime = r;
            // Заполнить целиком и вырезать верхнюю (против низа) половину.
            w.grid().fill_cell(kC, kC, kC, kMatConcrete);
            SubMask& half = w.grid().mask(kC, kC, kC);
            for (int sz = 0; sz < kSubDim; ++sz)
                for (int sy = 0; sy < kSubDim; ++sy)
                    for (int sx = 0; sx < kSubDim; ++sx) {
                        const int along = d.x != 0 ? sx : d.y != 0 ? sy : sz;
                        const int sign = d.x + d.y + d.z; // −1: низ у нуля
                        const bool upper =
                            sign < 0 ? along >= kSubDim / 2 : along < kSubDim / 2;
                        if (upper) half.clear(sub_bit(sx, sy, sz));
                    }
            vec3 c{};
            CHECK(stand_point_in_cell(w, cube, kC, kC, kC, c));
            CHECK(stands(w, c, cube));
        }
    }
    // Невесомость: опора не нужна, годится любой свободный объём.
    World zero;
    zero.gravity().regime = GravityRegime::Zero;
    vec3 c{};
    CHECK(stand_point_in_cell(zero, cube, kC, kC, kC, c));
    zero.grid().fill_cell(kC, kC, kC, kMatConcrete);
    CHECK(!stand_point_in_cell(zero, cube, kC, kC, kC, c));
}

// Плоская сцена: плита z = 9 под зоной 6×6×1 на z = 10.
struct Scene {
    World w;
    FloorRooms rooms;
    static constexpr int kX = 20, kY = 20, kZ = 10, kS = 6;
    Scene() {
        for (int y = kY; y < kY + kS; ++y)
            for (int x = kX; x < kX + kS; ++x)
                w.grid().fill_cell(x, y, kZ - 1, kMatConcrete);
        rooms_reset(rooms);
        const RoomBox box{static_cast<std::uint8_t>(kX),
                          static_cast<std::uint8_t>(kY),
                          static_cast<std::uint8_t>(kZ),
                          static_cast<std::uint8_t>(kS),
                          static_cast<std::uint8_t>(kS), 1};
        CHECK(room_declare(rooms, &box, 1, 0, 0, nullptr) != kNoRoom);
    }
};

// ---- 2. ВЫДАЧА МЕСТА: ключ, занятость, разрушенный дом, предел ------------
void settle_law() {
    { // тот же ключ на той же геометрии — то же место («на своём слоте»)
        Scene sc;
        Settlement a, b;
        settle_begin(a, sc.w, sc.rooms);
        settle_begin(b, sc.w, sc.rooms);
        for (std::uint32_t key = 1; key <= 20; ++key) {
            vec3 pa{}, pb{};
            CHECK(settle_spot(a, key * 7919u, kHalf, pa));
            CHECK(settle_spot(b, key * 7919u, kHalf, pb));
            CHECK(pa.x == pb.x);
            CHECK(pa.y == pb.y);
            CHECK(pa.z == pb.z);
            CHECK(stands(sc.w, pa, kHalf));
        }
        CHECK(a.settled == 20u);
        CHECK(a.homeless == 0u);
    }
    { // место занято — второе тело с тем же ключом встаёт В ДРУГУЮ клетку
        Scene sc;
        Settlement s;
        settle_begin(s, sc.w, sc.rooms);
        vec3 p1{}, p2{};
        CHECK(settle_spot(s, 42u, kHalf, p1));
        CHECK(settle_spot(s, 42u, kHalf, p2));
        CHECK(cell_of_metres(p1.x) != cell_of_metres(p2.x) ||
              cell_of_metres(p1.y) != cell_of_metres(p2.y));
        CHECK(stands(sc.w, p2, kHalf));
        // Зона вмещает ровно 36 тел; тридцать седьмому места нет, и отказ
        // ничего не помечает.
        for (int i = 0; i < Scene::kS * Scene::kS - 2; ++i) {
            vec3 p{};
            CHECK(settle_spot(s, 42u, kHalf, p));
        }
        vec3 none{};
        CHECK(!settle_spot(s, 42u, kHalf, none));
        CHECK(s.settled == 36u);
        CHECK(s.homeless == 1u);
    }
    { // ДОМ РАЗРУШЕН: пол под «своей» клеткой вырезан — тело встаёт рядом,
      // в той же зоне, а не падает и не уезжает на другой конец этажа
        Scene sc;
        Settlement before;
        settle_begin(before, sc.w, sc.rooms);
        vec3 home{};
        CHECK(settle_spot(before, 4242u, kHalf, home));
        const int hx = cell_of_metres(home.x), hy = cell_of_metres(home.y);
        sc.w.grid().clear_cell(hx, hy, Scene::kZ - 1); // дыра в полу
        Settlement after;
        settle_begin(after, sc.w, sc.rooms);
        vec3 moved{};
        CHECK(settle_spot(after, 4242u, kHalf, moved));
        CHECK(stands(sc.w, moved, kHalf));
        CHECK(cell_of_metres(moved.x) != hx || cell_of_metres(moved.y) != hy);
        CHECK(room_at(sc.rooms, cell_of_metres(moved.x), cell_of_metres(moved.y),
                      cell_of_metres(moved.z)) != kNoRoom);
    }
    { // ЗОН НЕТ — «ПРОСТО ГДЕ-ТО»: клетки всего тора, где можно стоять
        World w;
        // Плита z = 30 на весь тор: стоять можно в любой клетке z = 31.
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                w.grid().fill_cell(x, y, 30, kMatConcrete);
        FloorRooms none;
        rooms_reset(none);
        Settlement s;
        settle_begin(s, w, none);
        CHECK(s.total == 0u);
        std::uint32_t placed = 0, distinctX = 0;
        int lastX = -1;
        for (std::uint32_t key = 1; key <= 64; ++key) {
            vec3 p{};
            if (!settle_spot(s, key, kHalf, p)) continue;
            ++placed;
            CHECK(stands(w, p, kHalf));
            CHECK(cell_of_metres(p.z) == 31);
            if (cell_of_metres(p.x) != lastX) ++distinctX;
            lastX = cell_of_metres(p.x);
        }
        // Слой z = 31 — 1/128 тора, предел поиска 512 клеток: место находит
        // подавляющее большинство, и разбросаны они по этажу, а не строкой.
        CHECK(placed >= 56u);
        CHECK(distinctX >= placed / 2);
    }
    { // ЖИТЬ НЕГДЕ: зона висит в пустоте — предел исчерпан, отказ, счёт вслух
        World w;
        FloorRooms rooms;
        rooms_reset(rooms);
        const RoomBox box{10, 10, 10, 4, 4, 2};
        CHECK(room_declare(rooms, &box, 1, 0, 0, nullptr) != kNoRoom);
        Settlement s;
        settle_begin(s, w, rooms);
        vec3 p{};
        CHECK(!settle_spot(s, 1u, kHalf, p));
        CHECK(s.homeless == 1u);
        CHECK(s.settled == 0u);
        // Предел — объём зоны (32 клетки), он меньше общего предела.
        CHECK(s.probes == 32u);
    }
}

// Все тела слоя: стоят ли, и сколько их.
struct Census {
    std::uint32_t bodies = 0, standing = 0, inZone = 0, zones = 0;
};
Census census_of(Registry& ecs, const World& w, const FloorRooms& zones,
                 LayerId layer) {
    Census c;
    std::vector<bool> seen(zones.list.size() + 1, false);
    for (auto e : ecs.view<const NpcRef, const Transform, const AABB>()) {
        const Transform& tr = ecs.get<const Transform>(e);
        if (tr.layer != layer) continue;
        ++c.bodies;
        if (stands(w, tr.pos, ecs.get<const AABB>(e).half)) ++c.standing;
        const RoomId z =
            room_at(zones, cell_of_metres(tr.pos.x), cell_of_metres(tr.pos.y),
                    cell_of_metres(tr.pos.z));
        if (z == kNoRoom) continue;
        ++c.inZone;
        if (!seen[z]) {
            seen[z] = true;
            ++c.zones;
        }
    }
    return c;
}

// ---- 3. НАСТОЯЩИЕ ЭТАЖИ ДВУХ ГЕОМЕТРИЙ ЧЕРЕЗ СТРИМЕР -----------------------
// Тот самый шов, которым идёт игра (`ensure_loaded` → `embody_crowd`), на
// плотной геометрии (падик) и на открытой (хрущи, 97 % тора — небо). Один
// этаж отвечал бы только за себя ([[no-floor-is-special]]).
void real_floors_embody_standing() {
    struct Row {
        int number;
        FloorKind kind;
    };
    const Row rows[] = {{0, FloorKind::Residential},
                        {kKhrushiFloorNumber, FloorKind::Khrushi}};
    for (const Row& row : rows) {
        Registry ecs;
        NpcPool pool;
        pool.init();
        FloorRegistry reg;
        LevelStack stack;
        FloorStreamer stream;
        stream.init(stack, /*keepRadius=*/0);
        const std::uint32_t seed = 1234u;
        stream.add_module(reg, row.number, row.kind, seed);
        const std::uint32_t pop = stream.seed_all_modules(pool);
        CHECK(pop > 300u);

        NpcId playerId = kInvalidNpc;
        const LoadResult r =
            stream.ensure_loaded(stack, reg, ecs, pool, row.number, playerId);
        CHECK(r.layer != kInvalidLayer);
        CHECK(r.player != entt::null);
        const World& w = stack.layer(r.layer);
        FloorRooms zones;
        rooms_build(zones, row.number, floor_spec(row.kind), seed);

        // ЗАКОН: воплощены ВСЕ, и КАЖДОЕ тело стоит — помещается, опёрто,
        // просвет под подошвой ноль. До лечения на хрущах стояли 12 из 378.
        const Census c = census_of(ecs, w, zones, r.layer);
        CHECK(c.bodies == pop);
        CHECK(c.standing == c.bodies);
        CHECK(c.inZone == c.bodies); // и каждое — в объявленной зоне модуля
        // ТОЛПА РАССЕЛЕНА, А НЕ СВАЛЕНА: ключ у каждого свой, и занятых зон
        // больше половины числа тел. Один ключ на всех прошёл бы все проверки
        // выше, поставив этаж в одну комнату и её соседей.
        CHECK(c.zones * 2u > c.bodies);

        // «НА СВОЁМ СЛОТЕ»: выгрузили и вошли снова — те же жители на тех же
        // местах. Позиции при этом НИГДЕ не хранились.
        std::vector<vec3> first(pool.count(), vec3{-1, -1, -1});
        for (auto e : ecs.view<const NpcRef, const Transform>())
            first[ecs.get<const NpcRef>(e).id] = ecs.get<const Transform>(e).pos;
        const NpcId camera = playerId;
        stream.unload(stack, reg, ecs, pool, row.number);
        // ПОРЯДОК БАКЕТА ПЕРЕВЁРНУТ между входами (так его перетасовывают
        // смерти и миграции — swap-remove): каждая запись уходит на чужую
        // метку и возвращается, старшие первыми. Спор двух тел за клетку
        // обязан решаться номером записи, а не тем, кто раньше попался в
        // бакете, — иначе «свой слот» зависел бы от истории этажа. Эту
        // проверку привела мутация: без неё снос сортировки проходил.
        {
            const std::int16_t home = static_cast<std::int16_t>(row.number);
            const std::int16_t away = static_cast<std::int16_t>(row.number + 100);
            for (NpcId id = pool.count(); id-- > 0;)
                if (pool.alive(id) && pool.floor(id) == home)
                    pool.set_floor(id, away);
            for (NpcId id = pool.count(); id-- > 0;)
                if (pool.alive(id) && pool.floor(id) == away)
                    pool.set_floor(id, home);
            const std::vector<NpcId>& bucket = pool.floor_bucket(home);
            CHECK(bucket.size() == pop);
            CHECK(bucket.front() > bucket.back()); // порядок действительно другой
        }
        NpcId again = kInvalidNpc;
        const LoadResult r2 =
            stream.ensure_loaded(stack, reg, ecs, pool, row.number, again);
        CHECK(r2.layer != kInvalidLayer);
        std::uint32_t same = 0, seen = 0;
        for (auto e : ecs.view<const NpcRef, const Transform>()) {
            const NpcId id = ecs.get<const NpcRef>(e).id;
            const vec3& p = ecs.get<const Transform>(e).pos;
            ++seen;
            if (p.x == first[id].x && p.y == first[id].y && p.z == first[id].z)
                ++same;
        }
        CHECK(seen == pop);
        CHECK(same == seen);
        CHECK(again == camera); // и камера — у того же жителя
    }
}

} // namespace settle_test

static void test_settle_all() {
    settle_test::stand_point_is_frame_agnostic();
    settle_test::settle_law();
    settle_test::real_floors_embody_standing();
}
