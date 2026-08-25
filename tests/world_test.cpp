// Engine-core unit tests. No test framework dependency: a tiny CHECK macro that
// tracks failures and reports at the end. Links only giga_core (no SDL/Vulkan),
// so it runs headless in CI.
#include <cstdio>
#include <cmath>
#include <cstring>
#include <thread>
#include <vector>

#include "core/jobs.h"
#include "core/math.h"
#include "core/tick.h"   // kSimDt / kSimHz — never a bare 1/120 ([core/tick.h])
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "sim/camera.h"
#include "sim/diffusion.h"
#include "sim/drag.h"
#include "sim/physics.h"
#include "sim/rigid.h"
#include "world/destruct.h"
#include "world/field.h"
#include "world/level_stack.h"
#include "world/los.h"
#include "world/macro_grid.h"
#include "world/medium.h" // агрегаты S16.4 — тест плавучести
#include "world/nav.h"
#include "world/stain.h"
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

#define CHECK_NEAR(a, b, eps) CHECK(std::fabs((a) - (b)) <= (eps))

#include "suite_props.inl"
#include "suite_destruct.inl"
#include "suite_surface.inl"
#include "suite_clearance.inl"
static void test_wrap() {
    CHECK(wrapi(0, 128) == 0);
    CHECK(wrapi(128, 128) == 0);
    CHECK(wrapi(-1, 128) == 127);
    CHECK(wrapi(129, 128) == 1);
    CHECK(wrap_delta(0, 127, 128) == -1); // shortest path wraps backward
    CHECK(wrap_delta(127, 0, 128) == 1);
    CHECK(wrap_delta(0, 10, 128) == 10);

    // Vector forms (audit wave 2): the level call sites actually need, added
    // so "toroidal distance between two entities" is one call, not three
    // hand-written lines with an axis to forget. Points 2 m apart across all
    // three seams at once — the case every hand-rolled triple got wrong on
    // exactly one axis.
    const float p = 256.0f;
    const vec3 a{255.0f, 255.0f, 255.0f};
    const vec3 b{1.0f, 1.0f, 1.0f};
    const vec3 d = wrap_delta3(a, b, p);
    CHECK(d.x == 2.0f && d.y == 2.0f && d.z == 2.0f);
    CHECK(wrap_dist2(a, b, p) == 12.0f);           // 3 * 2^2, not 3 * 254^2
    CHECK(wrap_dist2(b, a, p) == 12.0f);           // symmetric
    const vec3 w = wrap_pos(vec3{-1.0f, 256.0f, 300.0f}, p);
    CHECK(w.x == 255.0f && w.y == 0.0f && w.z == 44.0f);
}

// The minimal-image rule the renderer draws by. This is a *contract test*: the
// same expression is reimplemented in shaders/cube.vert (GLSL cannot include
// core/wrap.h), and it is what keeps the toroidal wrap seam out of view. If the
// two drift apart, geometry pops across the seam and the world stops reading as
// endless — easy to introduce, hard to notice.
static void test_nearest_image() {
    const float p = 256.0f;

    for (int ai = 0; ai < 256; ai += 7) {
        for (int ci = -600; ci <= 600; ci += 37) {
            const float a = static_cast<float>(ai);   // absolute, in [0, p)
            const float c = static_cast<float>(ci);   // reference (camera)
            const float got = nearest_image(a, c, p);

            // Reference: shift by whole periods until within [-p/2, p/2] of c.
            // This is the branch-based formulation the branchless one replaced.
            float want = a;
            while (want - c > p * 0.5f) want -= p;
            while (c - want > p * 0.5f) want += p;

            // Asserted as a property, not as equality with one arbitrary
            // tie-break. At an exact half-period tie the two images are
            // equidistant and both are correct minimal images; the branchless and
            // branch-based forms resolve it in opposite directions. That is
            // unobservable — fog is fully black at exactly p/2 — so pinning
            // equality there would be testing an accident, not the contract.
            const bool tie = std::fabs(std::fabs(got - c) - p * 0.5f) < 1e-3f;
            if (!tie) CHECK_NEAR(got, want, 1e-3f);

            CHECK(std::fabs(got - c) <= p * 0.5f + 1e-3f);
            // Congruence: (got - a) must be a whole number of periods.
            const float k = (got - a) / p;
            CHECK_NEAR(k, std::round(k), 1e-4f);
        }
    }

    // The seam cases: a cell at the origin, seen from just inside the far edge,
    // must render *ahead* of the camera rather than a whole period behind it.
    CHECK(nearest_image(0.0f, 250.0f, p) > 250.0f);
    CHECK(nearest_image(254.0f, 2.0f, p) < 2.0f);
}

static void test_submask() {
    SubMask m;
    CHECK(m.empty());
    CHECK(!m.full());
    m.set(sub_bit(1, 2, 3));
    CHECK(!m.empty());
    CHECK(m.test(sub_bit(1, 2, 3)));
    CHECK(!m.test(sub_bit(0, 0, 0)));
    m.clear(sub_bit(1, 2, 3));
    CHECK(m.empty());
    m.set_all();
    CHECK(m.full());
    CHECK(!m.empty());

    SubMask a, b;
    a.set(sub_bit(4, 4, 4));
    CHECK(!a.intersects(b));
    b.set(sub_bit(4, 4, 4));
    CHECK(a.intersects(b));
}

static void test_grid_toroidal() {
    MacroGrid g;
    g.set_cell(0, 0, 0, 7);
    // Wrap: cell(-128, ...) maps back to cell 0.
    CHECK(g.cell(kMacroDim, 0, 0) == 7);
    CHECK(g.cell(-kMacroDim, 0, 0) == 7);
    g.fill_cell(5, 6, 7, 3);
    CHECK(g.cell(5, 6, 7) == 3);
    CHECK(g.mask(5, 6, 7).full());
    g.clear_cell(5, 6, 7);
    CHECK(g.cell(5, 6, 7) == kCellAir);
    CHECK(g.mask(5, 6, 7).empty());
}

static void test_fields() {
    FieldRegistry fr;
    CHECK(!fr.exists("temperature"));
    auto& t = fr.get_or_create<float>("temperature", 20.0f);
    CHECK(fr.exists("temperature"));
    CHECK_NEAR(t.at(1, 2, 3), 20.0f, 1e-6f);
    t.at(1, 2, 3) = 55.5f;
    CHECK_NEAR(t.at(1, 2, 3), 55.5f, 1e-6f);
    // Same name returns the same field.
    auto& t2 = fr.get_or_create<float>("temperature");
    CHECK_NEAR(t2.at(1, 2, 3), 55.5f, 1e-6f);
    // Toroidal wrap on field access.
    CHECK_NEAR(t.at(1 + kMacroDim, 2, 3), 55.5f, 1e-6f);
    // Wrong-type lookup is safe (returns nullptr, no reinterpret).
    CHECK(fr.find<int>("temperature") == nullptr);
    CHECK(fr.find<float>("temperature") != nullptr);
    CHECK(fr.count() == 1);

    // A second, differently-typed field coexists.
    auto& count = fr.get_or_create<int>("population", 0);
    count.at(0, 0, 0) = 42;
    CHECK(count.at(0, 0, 0) == 42);
    CHECK(fr.count() == 2);
}

static void test_level_stack() {
    LevelStack s;
    CHECK(s.size() == 0);
    LayerId a = s.push_layer();
    LayerId b = s.push_layer();
    CHECK(s.size() == 2);
    CHECK(a == 0 && b == 1);
    CHECK(s.above(a) == b);
    CHECK(s.below(b) == a);
    CHECK(s.above(b) == kInvalidLayer); // top of stack
    CHECK(s.below(a) == kInvalidLayer); // bottom of stack
    CHECK(s.valid(a) && !s.valid(99));
}

static void test_aabb_overlap() {
    World w;
    // Fill one macro cell solid at (10,10,10). Its world span is
    // [10, 11) * kCellSize on each axis.
    w.grid().fill_cell(10, 10, 10, 1);
    float c = 10.5f * kCellSize; // center of that cell
    CHECK(aabb_overlaps_solid(w, vec3{c, c, c}, vec3{0.1f, 0.1f, 0.1f}));
    // Far away in empty space: no overlap.
    CHECK(!aabb_overlaps_solid(w, vec3{50.5f * kCellSize, 50.5f * kCellSize,
                                       50.5f * kCellSize},
                               vec3{0.1f, 0.1f, 0.1f}));
}

static void test_physics_lands_on_floor() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    // Solid floor slab at z-cell 4 across a patch.
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 10.0f * kCellSize};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{{0.2f, 0.2f, 0.4f}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    // Simulate 3 seconds; the entity should fall and rest on the slab top. Both the
    // step and the tick count come from kSimHz, so this stays 3 real seconds if the
    // rate moves again — 360 ticks of a hardcoded 1/120 was 2.88 s at the shipping
    // 125 Hz, i.e. a shorter fall than the comment claimed.
    for (int i = 0; i < 3 * kSimHz; ++i) physics_step(reg, stack, kSimDt);

    auto& out = reg.get<Transform>(e);
    float floorTop = 5.0f * kCellSize; // top surface of z-cell 4
    // Feet should rest just above the floor: center = floorTop + half.z.
    CHECK(out.pos.z >= floorTop);
    CHECK(out.pos.z <= floorTop + 0.45f);
    CHECK(reg.get<GravityAffected>(e).grounded);
    // Did not fall through.
    CHECK(!aabb_overlaps_solid(w, out.pos, vec3{0.2f, 0.2f, 0.4f}));
}

// ПЛАВУЧЕСТЬ (CANON S16.4, инкремент 4): тело читает агрегат СВОЕЙ клетки —
// один член силы, толчок против гравитации фрейма x погружённость.
// kBuoyancy = 1000/985 (человек с воздухом в лёгких) — в полной воде тело
// ВСПЛЫВАЕТ медленно, а не тонет; вязкость гасит скорость. Рядом в сухой
// клетке — падает как падало (test_physics_lands_on_floor выше).
static void test_buoyancy() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    // Клетка (10,10,10) целиком «под водой» по агрегату — заполняем поле
    // напрямую (в игре его пересчитывает обратный шов автомата).
    medium_level_field(w).data()[macro_index(10, 10, 10)] = kSubVoxels;

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 10.5f * kCellSize};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{{0.2f, 0.2f, 0.4f}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    for (int i = 0; i < kSimHz; ++i) physics_step(reg, stack, kSimDt);
    // Секунда в воде: тело не утонуло (плавучесть чуть положительная) и не
    // разогналось (вязкость): скорость около нуля, всплытие ползучее.
    CHECK(reg.get<Transform>(e).pos.z >= tr.pos.z - 0.05f);
    CHECK(std::fabs(reg.get<Velocity>(e).v.z) < 0.2f);
}

// Рагдолл-ядро ([markoaudit/plans/ragdoll.md] инкремент 1): шар на импульсном
// твердотеле брошен вбок над плитой — падает, отскакивает (restitution),
// РАСКРУЧИВАЕТСЯ трением через точку контакта (качение возникает из физики,
// не из косметики), оседает на своём радиусе и засыпает; спящего будит только
// внешняя запись Velocity.
static void test_rigid_ball_settles_and_sleeps() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    // 1.15 м над плитой (верх z-клетки 4 = 10 м): удар ~4.8 м/с, пара
    // отскоков — и в качение; высокий сброс держал бы фазу отскоков дольше
    // самого теста.
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 5.75f * kCellSize};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    // Вбок медленно (1 м/с): качение тормозит только трение качения, и его
    // эффективное замедление с поправкой на инерцию сферы Crr·g/(1+2/5) ≈
    // 0.21 м/с² — метр в секунду выкатывается почти пять секунд.
    reg.emplace<Velocity>(e, Velocity{vec3{1.0f, 0.0f, 0.0f}});

    // Те же выводы, что у spawn_ball: сталь, сфера.
    RigidBody rb;
    rb.radius = 0.35f;
    const float mass = 7800.0f * (4.0f / 3.0f) * 3.14159265f *
                       rb.radius * rb.radius * rb.radius;
    rb.invMass = 1.0f / mass;
    rb.invInertia = 1.0f / (0.4f * mass * rb.radius * rb.radius);
    rb.restitution = 0.35f;
    rb.friction = 0.6f;
    reg.emplace<RigidBody>(e, rb);

    bool spun = false;
    for (int i = 0; i < 10 * kSimHz; ++i) {
        rigid_body_step(reg, stack, kSimDt);
        const auto& b = reg.get<RigidBody>(e);
        if (dot(b.w, b.w) > 0.01f) spun = true;
    }

    const auto& out = reg.get<Transform>(e);
    const auto& b = reg.get<RigidBody>(e);
    const float floorTop = 5.0f * kCellSize;
    CHECK(spun);     // трение Кулона раскрутило качение
    CHECK(b.asleep); // тихое тело с контактом заснуло
    // Лежит на своём радиусе над плитой (позиционное выталкивание, не тонет).
    CHECK(out.pos.z >= floorTop + rb.radius - 0.02f);
    CHECK(out.pos.z <= floorTop + rb.radius + 0.05f);
    // Кватернион остался единичным — интегратор не разъехался (NaN-страховка).
    const float qn =
        b.q.x * b.q.x + b.q.y * b.q.y + b.q.z * b.q.z + b.q.w * b.q.w;
    CHECK(std::fabs(qn - 1.0f) < 1e-3f);
    // Пробуждение: внешняя запись скорости (взрыв/толчок пишут Velocity).
    reg.get<Velocity>(e).v = vec3{2.0f, 0.0f, 0.0f};
    rigid_body_step(reg, stack, kSimDt);
    CHECK(!reg.get<RigidBody>(e).asleep);
}

// Инкремент 2 ([markoaudit/plans/ragdoll.md]): форма из контактных сфер.
// Бокс (солвер видит 14 сфер: 8 углов + 6 граней) сброшен с подкруткой —
// кувыркается, гасится трением (у бокса Кулон останавливает, качения нет),
// ложится ПЛАШМЯ на свою полувысоту и засыпает.
static void test_rigid_box_lies_flat() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 5.75f * kCellSize};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e, Velocity{vec3{1.5f, 0.0f, 0.0f}});

    // Дерево (паркет 700 кг/м³), ящик 1.1×1.1×0.9 — как spawn_box.
    const vec3 half{0.55f, 0.55f, 0.45f};
    const float dx = 1.1f, dy = 1.1f, dz = 0.9f;
    const float mass = 700.0f * dx * dy * dz;
    ContactForm formSpheres;
    const float bound = form_from_box(half, formSpheres);
    CHECK(formSpheres.count == 14);

    RigidBody rb;
    rb.radius = bound;
    rb.invMass = 1.0f / mass;
    rb.invInertia = 18.0f / (mass * (dx * dx + dy * dy + dz * dz));
    rb.restitution = 0.09f;
    rb.friction = 0.9f;
    rb.w = vec3{0.0f, -3.0f, 0.0f}; // кувырок вперёд по X
    reg.emplace<RigidBody>(e, rb);
    reg.emplace<ContactForm>(e, formSpheres);

    for (int i = 0; i < 10 * kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);

    const auto& out = reg.get<Transform>(e);
    const auto& b = reg.get<RigidBody>(e);
    const float floorTop = 5.0f * kCellSize;
    CHECK(b.asleep);
    // Плашмя = центр на одной из ПОЛУВЫСОТ бокса (0.45 или 0.55 — на какую
    // грань лёг кувырок), а не на радиусе ограничивающей сферы (0.9).
    const float rest = out.pos.z - floorTop;
    CHECK(rest > 0.40f);
    CHECK(rest < 0.60f);
    const float qn =
        b.q.x * b.q.x + b.q.y * b.q.y + b.q.z * b.q.z + b.q.w * b.q.w;
    CHECK(std::fabs(qn - 1.0f) < 1e-3f);
}

// Инкремент 3 ([markoaudit/plans/ragdoll.md] §8): связи — линк-СУЩНОСТИ.
// Цепь из 4 шаров на мировом якоре (JointLink с b=null) висит связно над
// полом; разрубание (destroy линка подвеса + пробуждение) роняет её на пол,
// и звенья остаются связанными между собой.
static void test_rigid_chain_hangs_and_cuts() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    const float floorTop = 5.0f * kCellSize; // 10 м
    const vec3 anchor{10.5f * kCellSize, 10.5f * kCellSize, floorTop + 3.0f};
    constexpr int kN = 4;
    const float radius = 0.15f;
    const float restLen = 3.0f * radius; // шаг цепи — как в spawn_chain
    const float mass =
        7800.0f * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;

    Entity balls[kN];
    Entity worldLink = entt::null;
    Entity prev = entt::null;
    for (int i = 0; i < kN; ++i) {
        RigidBody rb;
        rb.radius = radius;
        rb.invMass = 1.0f / mass;
        rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
        rb.restitution = 0.35f;
        rb.friction = 0.6f;
        Entity ball = reg.create();
        // 2 см сдвига на звено: идеально вертикальная цепь после разруба
        // складывается в устойчивую БАШНЮ из шаров (вырожденная симметрия,
        // с шар-шар контактом это честно) — асимметрия её валит, как в жизни.
        reg.emplace<Transform>(
            ball, Transform{anchor - vec3{-0.02f * static_cast<float>(i), 0.0f,
                                          restLen * static_cast<float>(i + 1)},
                            g});
        reg.emplace<Velocity>(ball);
        reg.emplace<RigidBody>(ball, rb);
        balls[i] = ball;

        Entity link = reg.create();
        JointLink jl;
        jl.a = ball;
        if (i == 0) {
            jl.b = entt::null;
            jl.anchorB = anchor;
            worldLink = link;
        } else {
            jl.b = prev;
        }
        jl.restLen = restLen;
        // Верёвочные звенья — как у spawn_chain по умолчанию: жёсткое звено
        // толкает, и разрубленная цепь стояла бы колонной (честная физика
        // стержней), а не падала.
        jl.rope = true;
        reg.emplace<JointLink>(link, jl);
        prev = ball;
    }

    for (int i = 0; i < 6 * kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);

    auto linkDist = [&](int i, int j) {
        const vec3 d = reg.get<Transform>(balls[i]).pos -
                       reg.get<Transform>(balls[j]).pos;
        return length(d);
    };
    bool connected = true;
    for (int i = 1; i < kN; ++i)
        if (linkDist(i, i - 1) > restLen * 1.35f) connected = false;
    CHECK(connected);
    // Висит: нижний шар заметно выше пола (подвес 3 м − цепь 1.8 м).
    CHECK(reg.get<Transform>(balls[kN - 1]).pos.z > floorTop + 0.5f);

    // РАЗРУБ подвеса: destroy линк-сущности + пробуждение (как cut_link).
    for (int i = 0; i < kN; ++i) {
        auto& rb = reg.get<RigidBody>(balls[i]);
        rb.asleep = false;
        rb.sleepTicks = 0;
    }
    reg.destroy(worldLink);

    for (int i = 0; i < 4 * kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);

    bool onFloor = true;
    for (int i = 0; i < kN; ++i) {
        const float z = reg.get<Transform>(balls[i]).pos.z;
        if (z > floorTop + 0.5f) onFloor = false;
    }
    CHECK(onFloor);
    bool stillConnected = true;
    for (int i = 1; i < kN; ++i)
        if (linkDist(i, i - 1) > restLen * 1.5f) stillConnected = false;
    CHECK(stillConnected);
}

// Инкремент 4 ([markoaudit/plans/ragdoll.md]): шар-шар через клеточный
// биннинг. Падающий шар БУДИТ спящего касанием (куча оживает), пара
// разрешается импульсом (не проходят друг сквозь друга): идеально соосная
// пара встаёт стопкой 2r, и стопка засыпает (touchedTick от пары — опора).
static void test_rigid_ball_ball_wakes_and_stacks() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    const float floorTop = 5.0f * kCellSize;
    const float radius = 0.35f;
    const float mass =
        7800.0f * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;
    auto make_ball = [&](vec3 pos) {
        RigidBody rb;
        rb.radius = radius;
        rb.invMass = 1.0f / mass;
        rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
        rb.restitution = 0.2f;
        rb.friction = 0.6f;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{pos, g});
        reg.emplace<Velocity>(e);
        reg.emplace<RigidBody>(e, rb);
        return e;
    };

    const float cx = 10.5f * kCellSize, cy = 10.5f * kCellSize;
    Entity bottom = make_ball(vec3{cx, cy, floorTop + radius + 0.1f});
    for (int i = 0; i < 3 * kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);
    CHECK(reg.get<RigidBody>(bottom).asleep);

    // Второй шар точно сверху, с небольшой высоты: 0.6 м зазора — падение
    // ~44 тика, к 60-му контакт гарантирован.
    Entity top = make_ball(vec3{cx, cy, floorTop + 3.0f * radius + 0.6f});
    for (int i = 0; i < 60; ++i) rigid_body_step(reg, stack, kSimDt);
    // Касание разбудило спящего.
    CHECK(!reg.get<RigidBody>(bottom).asleep);

    for (int i = 0; i < 6 * kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);
    const float zBot = reg.get<Transform>(bottom).pos.z;
    const float zTop = reg.get<Transform>(top).pos.z;
    // Не прошли друг сквозь друга: либо стопка 2r, либо скатился рядом на
    // радиус — в обоих случаях верхний НЕ внутри нижнего.
    const vec3 d = reg.get<Transform>(top).pos - reg.get<Transform>(bottom).pos;
    CHECK(length(d) > 1.8f * radius);
    CHECK(zBot < floorTop + radius + 0.05f); // нижний остался на полу
    CHECK(zTop > zBot - 0.05f);              // верхний не провалился под него
    CHECK(reg.get<RigidBody>(bottom).asleep); // стопка/пара уснула
    CHECK(reg.get<RigidBody>(top).asleep);
}

// Инкремент 5 ([markoaudit/plans/ragdoll.md]): проп ↔ агент. S3: RagdollRoll
// «задевает игрока, может убить»; S7: игрок = NPC. Быстрый шар в стоящего
// агента — Impact на обоих (в закон урона E=mv²/2) и отскок; идущий агент
// в спящий шар — шар просыпается и откатывается.
static void test_rigid_prop_hits_agent_and_agent_kicks() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);

    Registry reg;
    const float floorTop = 5.0f * kCellSize;
    const float radius = 0.35f;
    const float mass =
        7800.0f * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;

    // Агент — тело игрока/NPC: AABB 0.4×0.4×0.9, стоит на плите.
    Entity agent = reg.create();
    reg.emplace<Transform>(
        agent, Transform{vec3{12.0f * kCellSize, 10.5f * kCellSize,
                              floorTop + 0.9f},
                         g});
    reg.emplace<Velocity>(agent);
    reg.emplace<AABB>(agent, AABB{vec3{0.4f, 0.4f, 0.9f}});
    reg.emplace<GravityAffected>(agent);

    // Стальной шар летит в него на 10 м/с.
    Entity ball = reg.create();
    RigidBody rb;
    rb.radius = radius;
    rb.invMass = 1.0f / mass;
    rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
    rb.restitution = 0.35f;
    rb.friction = 0.6f;
    reg.emplace<Transform>(
        ball, Transform{vec3{12.0f * kCellSize - 3.0f, 10.5f * kCellSize,
                             floorTop + 0.9f},
                        g});
    reg.emplace<Velocity>(ball, Velocity{vec3{10.0f, 0.0f, 0.0f}});
    reg.emplace<RigidBody>(ball, rb);

    for (int i = 0; i < kSimHz; ++i) rigid_body_step(reg, stack, kSimDt);
    // Удар случился: Impact на агенте (урон посчитает impact_damage_step) и
    // шар не пролетел сквозь — его X левее агента.
    CHECK(reg.all_of<Impact>(agent));
    CHECK(reg.get<Impact>(agent).speed > 4.0f);
    CHECK(reg.get<Transform>(ball).pos.x <
          reg.get<Transform>(agent).pos.x);

    // Агент идёт в СПЯЩИЙ шар — тот просыпается и сдвигается.
    Registry reg2;
    Entity ball2 = reg2.create();
    RigidBody rb2 = rb;
    reg2.emplace<Transform>(
        ball2, Transform{vec3{10.5f * kCellSize, 10.5f * kCellSize,
                              floorTop + radius + 0.05f},
                         g});
    reg2.emplace<Velocity>(ball2);
    reg2.emplace<RigidBody>(ball2, rb2);
    for (int i = 0; i < 3 * kSimHz; ++i) rigid_body_step(reg2, stack, kSimDt);
    CHECK(reg2.get<RigidBody>(ball2).asleep);

    Entity walker = reg2.create();
    reg2.emplace<Transform>(
        walker, Transform{vec3{10.5f * kCellSize - 1.0f, 10.5f * kCellSize,
                               floorTop + 0.9f},
                          g});
    // Контроллерная скорость ходьбы, пишется каждый тик — как в игре.
    reg2.emplace<Velocity>(walker, Velocity{vec3{1.5f, 0.0f, 0.0f}});
    reg2.emplace<AABB>(walker, AABB{vec3{0.4f, 0.4f, 0.9f}});
    reg2.emplace<GravityAffected>(walker);
    const float ballX0 = reg2.get<Transform>(ball2).pos.x;
    for (int i = 0; i < kSimHz; ++i) {
        // Шаг агента двигает его сам (в игре — physics_step).
        reg2.get<Transform>(walker).pos.x += 1.5f * kSimDt;
        reg2.get<Velocity>(walker).v = vec3{1.5f, 0.0f, 0.0f};
        rigid_body_step(reg2, stack, kSimDt);
    }
    CHECK(!reg2.get<RigidBody>(ball2).asleep);
    CHECK(reg2.get<Transform>(ball2).pos.x > ballX0 + 0.1f);
}

// Инкремент 7 ([markoaudit/plans/ragdoll.md]): МАТЕРИАЛЬНАЯ ПАРА — отскок
// свойство пары, не тела. Один и тот же стальной шар: на бетоне (256) звенит,
// на щебне (24) глохнет — без ветки по виду поверхности.
static void test_rigid_material_pair_bounce() {
    auto rebound_apex = [](std::uint8_t mat) -> float {
        LevelStack stack;
        LayerId g = stack.push_layer();
        World& w = stack.layer(g);
        for (int y = 0; y < 20; ++y)
            for (int x = 0; x < 20; ++x)
                w.grid().fill_cell(x, y, 4, mat);

        Registry reg;
        const float floorTop = 5.0f * kCellSize;
        const float radius = 0.35f;
        const float mass =
            7800.0f * (4.0f / 3.0f) * 3.14159265f * radius * radius * radius;
        RigidBody rb;
        rb.radius = radius;
        rb.invMass = 1.0f / mass;
        rb.invInertia = 1.0f / (0.4f * mass * radius * radius);
        rb.restitution = 0.35f; // сталь — свойство ТЕЛА, поверхность решит пара
        rb.friction = 0.6f;
        Entity e = reg.create();
        // 0.8 м свободного падения: удар ~3.96 м/с — выше порога отскока.
        reg.emplace<Transform>(
            e, Transform{vec3{10.5f * kCellSize, 10.5f * kCellSize,
                              floorTop + radius + 0.8f},
                         g});
        reg.emplace<Velocity>(e);
        reg.emplace<RigidBody>(e, rb);

        bool contacted = false;
        float apex = 0.0f;
        for (int i = 0; i < 2 * kSimHz; ++i) {
            rigid_body_step(reg, stack, kSimDt);
            const float z = reg.get<Transform>(e).pos.z;
            if (!contacted && z < floorTop + radius + 0.02f) contacted = true;
            if (contacted)
                apex = std::max(apex, z - (floorTop + radius));
        }
        return apex;
    };

    const float onConcrete = rebound_apex(1);  // бетон, hardness 256
    const float onRubble = rebound_apex(15);   // щебень, hardness 24
    CHECK(onConcrete > 0.03f);                // на бетоне реально отскочил
    CHECK(onConcrete > onRubble + 0.05f);     // на щебне заметно глуше
}

// Трение воздуха ([sim/drag.h]): падение в пустой шахте тора КАПИТСЯ на
// терминальной скорости, а не разгоняется вечно. Полоса 50-60 м/с — приёмка
// владельца для тела 70 кг; она же и есть проводка-детектор: без трения 20 с
// свободного падения дают 196 м/с, и полоса рушится.
static void test_air_drag_terminal_velocity() {
    // Замкнутая форма шага: v' = v/(1 + q*|v|*h), точное решение dv/dt=-q|v|v.
    {
        vec3 v{100.0f, 0.0f, 0.0f};
        air_drag_step(v, 0.01f, 0.5f);
        CHECK_NEAR(v.x, 100.0f / (1.0f + 0.01f * 100.0f * 0.5f), 1e-3f);
        CHECK(v.y == 0.0f && v.z == 0.0f); // трение не выдумывает направлений
    }

    LevelStack stack;
    LayerId g = stack.push_layer(); // весь слой — воздух: шахта, wrap без дна
    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{64.0f, 64.0f, 64.0f};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e);  // дефолтное тело 0.8 x 0.8 x 1.8
    reg.emplace<Mass>(e);  // дефолтные 70 кг
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    for (int i = 0; i < 20 * kSimHz; ++i) physics_step(reg, stack, kSimDt);
    const float v20 = length(reg.get<Velocity>(e).v);
    CHECK(v20 > 50.0f);
    CHECK(v20 < 60.0f);

    // Ещё 20 с: кап, а не замедленный разгон.
    for (int i = 0; i < 20 * kSimHz; ++i) physics_step(reg, stack, kSimDt);
    const float v40 = length(reg.get<Velocity>(e).v);
    CHECK(std::fabs(v40 - v20) < 0.2f);
    // Неподвижная точка пары «гравитация, затем трение» — АНАЛИТИЧЕСКИЙ
    // терминал sqrt(g/q), точно при любом шаге (см. [sim/drag.h] почему).
    const float q = drag_q(AABB{}.half, Mass{}.kg);
    CHECK_NEAR(v40, std::sqrt(9.81f / q), 0.1f);
}

// The manifest's smooth step: one 0.25 m sub-voxel atom is walkable without a
// jump; two atoms are a wall. Exercised through the real physics_step.
static void test_step_up_one_atom() {
    LevelStack stack;
    LayerId g = stack.push_layer();
    World& w = stack.layer(g);
    for (int y = 0; y < 20; ++y)
        for (int x = 0; x < 20; ++x)
            w.grid().fill_cell(x, y, 4, 1);
    // A one-atom ridge across the walker's path at x-cell 12: the TOP sub-voxel
    // layer of the (otherwise air) cells at z-cell 5... use the bottom layer.
    for (int y = 0; y < 20; ++y) {
        SubMask& m = w.grid().mask(12, y, 5);
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx)
                m.set(sub_bit(sx, sy, 0)); // one 0.25 m slab on the floor
        w.grid().set_cell(12, y, 5, 1);
    }
    // A two-atom ridge further along, at x-cell 15: must stay a wall.
    for (int y = 0; y < 20; ++y) {
        SubMask& m = w.grid().mask(15, y, 5);
        for (int sz = 0; sz < 2; ++sz)
            for (int sy = 0; sy < kSubDim; ++sy)
                for (int sx = 0; sx < kSubDim; ++sx)
                    m.set(sub_bit(sx, sy, sz));
        w.grid().set_cell(15, y, 5, 1);
    }

    Registry reg;
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{10.5f * kCellSize, 10.5f * kCellSize, 5.0f * kCellSize + 0.5f};
    tr.layer = g;
    reg.emplace<Transform>(e, tr);
    reg.emplace<Velocity>(e);
    reg.emplace<AABB>(e, AABB{{0.2f, 0.2f, 0.4f}});
    reg.emplace<GravityAffected>(e, GravityAffected{1.0f, false});

    // Settle onto the floor first (grounded gates the step).
    for (int i = 0; i < kSimHz; ++i) physics_step(reg, stack, kSimDt);
    CHECK(reg.get<GravityAffected>(e).grounded);
    const float floorZ = reg.get<Transform>(e).pos.z;

    // Walk +x for 3 s: the one-atom ridge at cell 12 must be crossed smoothly.
    for (int i = 0; i < 3 * kSimHz; ++i) {
        reg.get<Velocity>(e).v.x = 2.0f;
        physics_step(reg, stack, kSimDt);
    }
    const vec3 stopped = reg.get<Transform>(e).pos;
    CHECK(stopped.x > 13.0f * kCellSize);          // crossed the one-atom ridge
    CHECK(stopped.x < 15.0f * kCellSize);          // held by the two-atom wall
    CHECK(stopped.z >= floorZ - 0.01f);            // never sank into the floor
    CHECK(reg.get<GravityAffected>(e).grounded);
    CHECK(!aabb_overlaps_solid(w, stopped, vec3{0.2f, 0.2f, 0.4f}));
}

// The universal stain layer ([world/stain.h]): additive per-atom RGB on solid
// sub-voxels — blood + urine mix by channel addition, air holds no paint.
static void test_stain_layer() {
    World w;
    w.grid().fill_cell(10, 10, 10, 1);

    // Air holds no paint; zero adds paint nothing.
    CHECK(stain_paint(w, 10, 10, 10, kStainBlood) == UINT32_MAX);
    CHECK(stain_paint(w, 10 * kSubDim, 10 * kSubDim, 10 * kSubDim,
                      StainRGB{}) == UINT32_MAX);

    // Paint one solid atom twice: channels ADD with saturation.
    const int g = 10 * kSubDim; // the cell's first atom, global sub coords
    const std::uint32_t ci = stain_paint(w, g, g, g, kStainBlood);
    CHECK(ci == macro_index(10, 10, 10));
    CHECK(stain_paint(w, g, g, g, kStainUrine) == ci);
    const auto* f = w.subfields().find<StainRGB>(kStainFieldName);
    CHECK(f != nullptr);
    const StainRGB s = f->at(ci, 0, StainRGB{});
    CHECK(s.r == 255); // 150 + 140 saturates
    CHECK(s.g == 132); // 12 + 120: emergent mix, no substance branch anywhere
    CHECK(s.b == 35);

    // Splatter against a wall: deterministic, paints, reports dirty cells.
    World v;
    for (int z = 8; z < 12; ++z)
        for (int y = 8; y < 12; ++y)
            v.grid().fill_cell(10, y, z, 1);
    std::vector<std::uint32_t> dirty;
    const vec3 at{9.0f * kCellSize, 10.0f * kCellSize, 10.0f * kCellSize};
    const std::int32_t a = stain_splat(v, at, vec3{1, 0, 0}, 4.0f, 16,
                                       kStainBlood, 777u, dirty);
    CHECK(a > 0);
    CHECK(!dirty.empty());
    std::vector<std::uint32_t> dirty2;
    World u;
    for (int z = 8; z < 12; ++z)
        for (int y = 8; y < 12; ++y)
            u.grid().fill_cell(10, y, z, 1);
    CHECK(stain_splat(u, at, vec3{1, 0, 0}, 4.0f, 16, kStainBlood, 777u,
                      dirty2) == a); // same seed, same bytes
}

// (test_fluid_conserves_mass УМЕР с fluid.cpp — чистка 2026-08-24: воду
// двигает мир-автомат, масс-инвариант живёт в medium_test на настоящем
// SPIR-V.)

// The diffusion danger/scent field (increment D): a source spreads to its open
// neighbours, wraps across the torus seam, is blocked by walls (no flux), yields
// a flee gradient, steps deterministically, and decays toward zero without a
// source. It is stepped like fluid but is NOT mass-conserving (it evaporates).
static void test_diffusion() {
    auto total = [](const Field<float>& f) {
        double s = 0;
        for (float v : f.data()) s += v;
        return s;
    };

    // 1) One step spreads a central spike symmetrically to its 6 neighbours, and
    //    total mass drops (evaporation) but stays positive.
    {
        World w; // all air
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        const double before = total(f);
        diffusion_step(w);
        CHECK(f.at(64, 64, 64) < 100.0f);
        const float nb = f.at(65, 64, 64);
        CHECK(nb > 0.0f);
        CHECK(f.at(63, 64, 64) == nb); // symmetric on every face
        CHECK(f.at(64, 65, 64) == nb);
        CHECK(f.at(64, 63, 64) == nb);
        CHECK(f.at(64, 64, 65) == nb);
        CHECK(f.at(64, 64, 63) == nb);
        const double after = total(f);
        CHECK(after < before && after > 0.0);
    }

    // 2) Periodic on the torus: a spike at x=0 leaks across the seam to x=127.
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(0, 10, 10) = 50.0f;
        diffusion_step(w);
        CHECK(f.at(127, 10, 10) > 0.0f); // wrapped -x neighbour received flux
    }

    // 3) Walls block flux (no-flux boundary): a fully-solid neighbour receives
    //    nothing and holds nothing, while the open neighbours still take their
    //    share.
    {
        World w;
        w.grid().fill_cell(65, 64, 64, 1); // wall the +x neighbour of the source
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        diffusion_step(w);
        CHECK(f.at(65, 64, 64) == 0.0f); // wall holds nothing
        CHECK(f.at(63, 64, 64) > 0.0f);  // the open -x side still receives
    }

    // 4) Flee gradient: after diffusing a spike, danger falls with distance, so at
    //    a cell on the +x side the gradient points back toward the source (-x) and
    //    an agent flees along -gradient (+x, away). Symmetric axes read ~0.
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 100.0f;
        for (int s = 0; s < 8; ++s) diffusion_step(w);
        const vec3 grad = diffusion_gradient(f, w.grid(), 68, 64, 64);
        CHECK(grad.x < 0.0f);                       // danger increases toward -x
        CHECK(grad.y < 1e-6f && grad.y > -1e-6f);   // symmetric off-axis
        CHECK(grad.z < 1e-6f && grad.z > -1e-6f);
    }

    // 5) Deterministic: two identical seedings step bit-identically.
    {
        World a, b;
        auto seed = [](World& w) {
            auto& f = w.fields().get_or_create<float>("danger", 0.0f);
            f.at(64, 64, 64) = 100.0f;
            f.at(20, 30, 40) = 40.0f;
        };
        seed(a);
        seed(b);
        for (int s = 0; s < 16; ++s) { diffusion_step(a); diffusion_step(b); }
        const Field<float>* fa = a.fields().find<float>("danger");
        const Field<float>* fb = b.fields().find<float>("danger");
        CHECK(fa != nullptr && fb != nullptr);
        CHECK(fa->data().size() == fb->data().size());
        CHECK(std::memcmp(fa->data().data(), fb->data().data(),
                          fa->data().size() * sizeof(float)) == 0);
    }

    // 6) Stable + decaying: with no fresh source the total never grows and trends
    //    well below the initial mass (evaporation wins; no blow-up).
    {
        World w;
        auto& f = w.fields().get_or_create<float>("danger", 0.0f);
        f.at(64, 64, 64) = 10.0f;
        double prev = 1e30;
        for (int s = 0; s < 50; ++s) {
            diffusion_step(w);
            const double t = total(f);
            CHECK(t <= prev + 1e-3); // monotone non-increasing (stability + decay)
            prev = t;
        }
        CHECK(prev < 10.0); // decayed below where it started
    }
}

static void test_camera_component_is_movable() {
    Registry reg;
    // No camera yet.
    CameraMatrices none = compute_camera(reg, 1.0f);
    CHECK(!none.valid);

    Entity a = reg.create();
    reg.emplace<Transform>(a, Transform{vec3{1, 2, 3}, 0});
    reg.emplace<CameraTag>(a, CameraTag{});
    CameraMatrices m = compute_camera(reg, 1.777f);
    CHECK(m.valid);
    CHECK_NEAR(m.eye.x, 1.0f, 1e-4f);
}

// The bake-time job system (src/core/jobs.h). Its whole contract is that a
// parallel run over disjoint indices equals the serial run — deterministic, not
// merely "eventually the same".
static void test_parallel_for() {
    const int n = 10000;
    std::vector<int> a(n, -1);
    parallel_for(n, [&a](int i) { a[i] = i * i; });
    for (int i = 0; i < n; ++i) CHECK(a[i] == i * i);

    // Degenerate ranges are safe: n<=0 never calls the body, n==1 calls once.
    parallel_for(0, [](int) { CHECK(false); }); // body must never run
    int calls = 0, last = -1;
    parallel_for(1, [&](int i) { ++calls; last = i; });
    CHECK(calls == 1 && last == 0);

    // A forced single worker gives the identical result to the multi-thread run.
    std::vector<int> b(n, -1);
    parallel_for(n, [&b](int i) { b[i] = i * i; }, /*threads=*/1);
    CHECK(a == b);
}

// L1 nav bake on open space (master_prompt #11). A fresh MacroGrid is all-air
// (empty masks) hence fully walkable, so this isolates the graph math from any
// floor geometry: the coarse graph must be complete, symmetric, and SEAM-FREE.
static void test_nav_coarse() {
    using namespace nav;
    MacroGrid air;
    CoarseGraph g{};
    bake_coarse(air, g);

    for (int i = 0; i < kNodes; ++i) {
        CHECK(g.dist[i][i] == 0);
        for (int j = 0; j < kNodes; ++j) {
            CHECK(g.dist[i][j] != kUnreachable);  // fully connected
            CHECK(g.dist[i][j] == g.dist[j][i]);  // symmetric geometry
        }
    }
    // Every lattice edge is one clear spacing (32) through open air.
    for (int i = 0; i < kNodes; ++i)
        for (int d = 0; d < 6; ++d) CHECK(g.edge[i][d] == kLatticeSpacing);

    // No seam: node 0's antipode on (Z/4)^3 is (2,2,2). On the torus each axis
    // hop-pair costs 2*32 = 64, so the coarse distance is 3*64 = 192 and routing
    // reaches it in EXACTLY 6 lattice hops. A spanning tree over the torus would
    // blow both up — that is the reference's documented failure this rules out.
    const int antipode = lattice_id(2, 2, 2);
    CHECK(g.dist[0][antipode] == 192);
    int cur = 0, hops = 0;
    while (cur != antipode && hops <= kNodes) {
        cur = coarse_next(g, cur, antipode);
        ++hops;
    }
    CHECK(cur == antipode);
    CHECK(hops == 6);

    // Deterministic: a second bake is bit-identical (schedule-invariant).
    CoarseGraph g2{};
    bake_coarse(air, g2);
    CHECK(std::memcmp(&g, &g2, sizeof(CoarseGraph)) == 0);
}

// L2 fine bake on open space. Following a node's flow field must descend a
// SHORTEST wrapped path: on all-air the step count equals the wrapped Manhattan
// distance to that node's cell — proving the field is both correct and, being a
// BFS parent chain, cycle-free (it always arrives). Plus determinism.
static void test_nav_fine() {
    using namespace nav;
    MacroGrid air;
    FineNav f;
    bake_fine(air, f);

    // The node cell itself is "arrived".
    CHECK(f.at(0, 16, 16, 16) == kFlowArrived);

    auto follow = [&](int node, int x, int y, int z) -> int {
        int cx = x, cy = y, cz = z;
        for (int steps = 0; steps <= 4 * kMacroDim; ++steps) {
            const std::uint8_t d = f.at(node, cx, cy, cz);
            if (d == kFlowArrived) return steps;
            if (d == kFlowNone) return -1; // no route (never, on open air)
            cx = wrap_macro(cx + kNavDir[d][0]);
            cy = wrap_macro(cy + kNavDir[d][1]);
            cz = wrap_macro(cz + kNavDir[d][2]);
        }
        return -2; // exceeded the bound without arriving
    };
    auto wrapped_manhattan = [](int a, int b) {
        int d = a - b < 0 ? b - a : a - b;
        return d < kMacroDim - d ? d : kMacroDim - d;
    };
    // Node 0's cell is (16,16,16); sample cells at varied wrapped distances.
    const int cells[][3] = {
        {16, 16, 16}, {17, 16, 16}, {48, 16, 16}, {100, 50, 80}, {0, 0, 0},
    };
    for (auto& c : cells) {
        const int expect = wrapped_manhattan(c[0], 16) +
                           wrapped_manhattan(c[1], 16) +
                           wrapped_manhattan(c[2], 16);
        CHECK(follow(0, c[0], c[1], c[2]) == expect);
    }

    // Nearest-node field (C.2): every node's own cell is its own anchor, and a
    // cell well inside a Voronoi band resolves to that band's node. Bands are
    // [i*32,(i+1)*32) with centres {16,48,80,112}, so (20,52,84) -> node (0,1,2).
    for (int id = 0; id < kNodes; ++id) {
        const LatticeNode n = lattice_unpack(id);
        CHECK(f.nearest_node(lattice_coord(n.ix), lattice_coord(n.iy),
                             lattice_coord(n.iz)) == id);
    }
    CHECK(f.nearest_node(20, 52, 84) == lattice_id(0, 1, 2));
    // Consistency: descending your own nearest anchor's field is a legal step.
    CHECK(f.at(f.nearest_node(20, 52, 84), 20, 52, 84) != kFlowNone);

    // Deterministic: a second bake is bit-identical (schedule-invariant), for
    // both the flow fields and the (single-threaded) nearest-node field.
    FineNav f2;
    bake_fine(air, f2);
    CHECK(f.flow.size() == f2.flow.size());
    CHECK(std::memcmp(f.flow.data(), f2.flow.data(), f.flow.size()) == 0);
    CHECK(f.nearest.size() == f2.nearest.size());
    CHECK(std::memcmp(f.nearest.data(), f2.nearest.data(), f.nearest.size()) == 0);
}

// route_step (master_prompt #11 C.2): the O(1) tick query that composes the
// nearest-node field + coarse reachability + a flow field into one step. On open
// air the route is a straight wrapped-Manhattan descent to the target's anchor.
static void test_route_step() {
    using namespace nav;
    MacroGrid air;
    FineNav f;
    bake_fine(air, f);
    CoarseGraph g{};
    bake_coarse(air, g);

    // Standing on the destination cell: arrived, no step.
    CHECK(route_step(g, f, ivec3{40, 40, 40}, ivec3{40, 40, 40}) == kFlowArrived);

    // Follow route_step from node 0's centre to node 63's centre. Every step
    // descends field 63 (the destination's anchor), so the walk is a shortest
    // wrapped path and arrives in exactly the wrapped-Manhattan cell count.
    const ivec3 to{112, 112, 112}; // node 63 centre (== lattice_id(3,3,3))
    int cx = 16, cy = 16, cz = 16, steps = 0; // node 0 centre
    for (; steps <= 4 * kMacroDim; ++steps) {
        const std::uint8_t d = route_step(g, f, ivec3{cx, cy, cz}, to);
        CHECK(d != kFlowNone); // open air is fully reachable
        if (d == kFlowArrived) break;
        cx = wrap_macro(cx + kNavDir[d][0]);
        cy = wrap_macro(cy + kNavDir[d][1]);
        cz = wrap_macro(cz + kNavDir[d][2]);
    }
    CHECK(cx == 112 && cy == 112 && cz == 112);
    CHECK(steps == 3 * 32); // |112-16| wraps to 32 per axis, over three axes

    // Unreachable: a fully-solid target is claimed by no anchor, so there is no
    // field to it -> kFlowNone. Symmetrically, routing FROM inside solid fails.
    MacroGrid walled;
    walled.fill_cell(0, 0, 0, 1);
    FineNav fw;
    bake_fine(walled, fw);
    CoarseGraph gw{};
    bake_coarse(walled, gw);
    CHECK(fw.nearest_node(0, 0, 0) == kFlowNone);
    CHECK(route_step(gw, fw, ivec3{16, 16, 16}, ivec3{0, 0, 0}) == kFlowNone);
    CHECK(route_step(gw, fw, ivec3{0, 0, 0}, ivec3{16, 16, 16}) == kFlowNone);

    // Coarse-unreachable branch: wall node 0's centre in on all 6 faces so its
    // air pocket is a disconnected component. Its anchor still claims its own
    // cell, but nothing reaches it, so routing to it returns kFlowNone via the
    // O(1) coarse reachability guard — a different path than "target in solid".
    MacroGrid isolated;
    for (int d = 0; d < 6; ++d)
        isolated.fill_cell(16 + kNavDir[d][0], 16 + kNavDir[d][1],
                           16 + kNavDir[d][2], 1);
    FineNav fi;
    bake_fine(isolated, fi);
    CoarseGraph gi{};
    bake_coarse(isolated, gi);
    CHECK(fi.nearest_node(16, 16, 16) == 0);  // node 0 still owns its own cell
    CHECK(gi.dist[1][0] == kUnreachable);     // but it is cut off from the rest
    CHECK(route_step(gi, fi, ivec3{48, 48, 48}, ivec3{16, 16, 16}) == kFlowNone);
}

// mat4_lookAt's basis, and the degenerate case that used to collapse it. The
// pre-guard code did `normalize(cross(f, up))` unconditionally: when f is
// parallel or anti-parallel to up the cross vanishes, normalize() returns
// {0,0,0} (math.h:29-32 substitutes no axis), and s, then u = cross(s,f), then
// the whole rotation basis went to zeros — a singular view matrix. Under a
// gravity-derived up, "looking along gravity" is the COMMON case, not an exotic
// one, so this is asserted as the property that actually broke: the three
// rotation rows must be unit-length and mutually perpendicular.
static void test_mat4_lookAt() {
    // The rotation rows of the column-major view matrix: right (s), up (u) and
    // -forward. Read as rows because the matrix is stored column-major for GLSL.
    auto row_right = [](const mat4& m) { return vec3{m.m[0], m.m[4], m.m[8]}; };
    auto row_up    = [](const mat4& m) { return vec3{m.m[1], m.m[5], m.m[9]}; };
    auto row_back  = [](const mat4& m) { return vec3{m.m[2], m.m[6], m.m[10]}; };

    auto check_orthonormal = [&](const mat4& m) {
        const vec3 s = row_right(m), u = row_up(m), b = row_back(m);
        CHECK_NEAR(length(s), 1.0f, 1e-4f);   // all three zero before the guard
        CHECK_NEAR(length(u), 1.0f, 1e-4f);
        CHECK_NEAR(length(b), 1.0f, 1e-4f);
        CHECK_NEAR(dot(s, u), 0.0f, 1e-4f);   // mutually perpendicular
        CHECK_NEAR(dot(s, b), 0.0f, 1e-4f);
        CHECK_NEAR(dot(u, b), 0.0f, 1e-4f);
    };

    // THE REGRESSION CASES. Straight down and straight up the reference up axis:
    // cross(f, up) is exactly {0,0,0} both times, so the old code returned a
    // basis of zeros and length(s) == length(u) == 0 failed here.
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0, 0, -1}, vec3{0, 0, 1}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0, 0, 1}, vec3{0, 0, 1}));

    // Ordinary directions — well clear of the threshold, so the guard must not
    // change them. These passed before the fix and still have to.
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{1, 0, 0}, vec3{0, 0, 1}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0, 1, 0}, vec3{0, 0, 1}));
    check_orthonormal(mat4_lookAt(vec3{1, 2, 3}, vec3{2, 3, 4}, vec3{0, 0, 1}));

    // Near-degenerate, and the reason the old defect was survivable in practice:
    // src/game/player_command.cpp clamps pitch to +-1.5533 rad (~89 deg), so a
    // real mouselook frame looking "straight up" is f ~ {0.0175, 0, 0.9998}.
    // |cross(f, up)| is then ~0.0175 — 3.06e-4 squared, still 306x the 1e-6
    // threshold — so this takes the ORDINARY path, not the fallback. It is the
    // boundary the clamp buys, pinned so that widening the clamp or the
    // threshold without re-reading this cannot go unnoticed.
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0.0175f, 0, 0.9998f},
                                  vec3{0, 0, 1}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0.0175f, 0, -0.9998f},
                                  vec3{0, 0, 1}));

    // Non-NegZ gravity regimes. The engine runs 8 of them and "up" is not always
    // Z, so the collapse was reachable on every axis, not just the Z one. Each of
    // these four is exactly parallel/anti-parallel and so hit the same zero basis.
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{1, 0, 0}, vec3{1, 0, 0}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{-1, 0, 0}, vec3{1, 0, 0}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0, 1, 0}, vec3{0, 1, 0}));
    check_orthonormal(mat4_lookAt(vec3{0, 0, 0}, vec3{0, -1, 0}, vec3{0, 1, 0}));

    // NON-UNIT up — the case that pins WHICH quantity the guard measures. up is a
    // public parameter and is not required to be unit-length, so a guard written
    // against dot(f, up) would be reading a number scaled by |up| and compare it
    // to a threshold calibrated for 1.
    //
    // Orthonormality alone cannot catch that mistake: a wrongly-taken fallback
    // still returns an orthonormal basis, just a differently-rolled one. So the
    // discriminating assertion is that the guard did NOT fire — on the ordinary
    // path s = normalize(cross(f, up)) is perpendicular to up BY CONSTRUCTION,
    // whereas the fallback's s = normalize(cross(f, alt)) is not.
    auto check_up_respected = [&](const mat4& m, vec3 up) {
        CHECK_NEAR(dot(row_right(m), normalize(up)), 0.0f, 1e-4f);
    };
    const vec3 tallUp{0, 0, 10};
    const mat4 perp = mat4_lookAt(vec3{0, 0, 0}, vec3{1, 0, 0}, tallUp);
    check_orthonormal(perp);
    check_up_respected(perp, tallUp);
    const mat4 perpOff = mat4_lookAt(vec3{5, 5, 5}, vec3{6, 5, 5}, vec3{0, 0, 100});
    check_orthonormal(perpOff);
    check_up_respected(perpOff, vec3{0, 0, 100});
    // The one that actually separates |cross| from dot: f is 0.8 aligned with the
    // up AXIS, so dot(f, up) == 8 — far past any unit-calibrated threshold — while
    // |cross(f, up)| == 6 and the basis is perfectly well-conditioned. A dot-based
    // guard fires here and rolls the camera; the |cross| guard leaves it alone.
    const mat4 tilted = mat4_lookAt(vec3{0, 0, 0}, vec3{0.6f, 0, 0.8f}, tallUp);
    check_orthonormal(tilted);
    check_up_respected(tilted, tallUp);
}

// Line of sight — the first LOS primitive in the tree ([world/los.h]).
//
// Written against the four things that make a voxel raycast wrong rather than
// against "does it return true in a room": the endpoint cells, the toroidal seam,
// the axes, and the diagonal that clips a corner.
static void test_los() {
    // Клеточный los_clear/los_blockers СНЕСЁН (§60, 2026-08-26): свойства
    // (изотропия, шов, старт-в-материи) переезжают на ЖИВОЙ примитив —
    // sub_march / sub_thickness_cells; консумеры (осколки, звук) ходят ими.
    MacroGrid g;
    const float c = kCellSize;   // 2 m
    auto mid = [&](int cx, int cy, int cz) {
        return vec3{(cx + 0.5f) * c, (cy + 0.5f) * c, (cz + 0.5f) * c};
    };
    SubRayHit hit;

    // Открытый воздух чист в обе стороны; толщина материи нулевая.
    CHECK(!sub_march(g, mid(10, 10, 10), mid(20, 10, 10), hit));
    CHECK(!sub_march(g, mid(20, 10, 10), mid(10, 10, 10), hit));
    CHECK(sub_thickness_cells(g, mid(10, 10, 10), mid(20, 10, 10)) == 0);

    // ОДНА клетка стены блокирует — на каждой оси одним и тем же кодом
    // (изотропия: ни одна буква не особенная, [problems.md] §34); снятие
    // стены возвращает простреливаемость; толщина полной клетки пути == 1.
    for (int a = 0; a < 3; ++a) {
        MacroGrid w;
        int lo[3] = {10, 10, 10};
        int hi[3] = {10, 10, 10};
        int wall[3] = {10, 10, 10};
        lo[a] = 8;
        hi[a] = 12;
        wall[a] = 10;
        w.fill_cell(wall[0], wall[1], wall[2], kMatConcrete);
        const vec3 A = mid(lo[0], lo[1], lo[2]);
        const vec3 B = mid(hi[0], hi[1], hi[2]);
        CHECK(sub_march(w, A, B, hit));
        CHECK(sub_march(w, B, A, hit)); // symmetric
        CHECK(sub_thickness_cells(w, A, B) == 1);
        w.clear_cell(wall[0], wall[1], wall[2]);
        CHECK(!sub_march(w, A, B, hit));
    }

    // СТАРТ В МАТЕРИИ: пуля, рождённая в тверди, стопится ею (t=0, грани
    // входа нет) — противоположно правилу концов покойного los_clear, и
    // это НЕ случайность (см. шапку los.h): марш отвечает «первое
    // касание», не «что стоит между».
    {
        MacroGrid w;
        w.fill_cell(10, 10, 10, kMatConcrete);
        CHECK(sub_march(w, mid(10, 10, 10), mid(14, 10, 10), hit));
        CHECK(hit.t == 0.0f);
        CHECK(hit.axis == -1);
    }

    // ШОВ ТОРА: потребитель марширует к БЛИЖАЙШЕМУ образу (сегмент даётся
    // как есть — так ходит снарядный интегратор): стена на КОРОТКОМ пути
    // блокирует, на длинном — нет. Оси x и z одним кодом (z заворачивает,
    // [AGENTS.md]).
    for (int a = 0; a < 3; a += 2) {
        int lo[3] = {10, 10, 10};
        lo[a] = 1;
        int hi[3] = {10, 10, 10};
        hi[a] = kMacroDim - 2;
        int wall[3] = {10, 10, 10};
        wall[a] = kMacroDim - 1;
        const vec3 A = mid(lo[0], lo[1], lo[2]);
        const vec3 Bfar = mid(hi[0], hi[1], hi[2]);
        vec3 Bnear = A; // ближайший образ B: короткая дорога через шов
        // wrap_delta_f(a, b) = b - a обёрнутое (см. core/wrap.h).
        Bnear.x += wrap_delta_f(A.x, Bfar.x, kWorldExtent);
        Bnear.y += wrap_delta_f(A.y, Bfar.y, kWorldExtent);
        Bnear.z += wrap_delta_f(A.z, Bfar.z, kWorldExtent);
        MacroGrid w;
        CHECK(!sub_march(w, A, Bnear, hit));
        w.fill_cell(wall[0], wall[1], wall[2], kMatConcrete);
        CHECK(sub_march(w, A, Bnear, hit));
        MacroGrid w2;
        int far3[3] = {10, 10, 10};
        far3[a] = 64;
        w2.fill_cell(far3[0], far3[1], far3[2], kMatConcrete);
        CHECK(!sub_march(w2, A, Bnear, hit));
    }

    // ДИАГОНАЛЬ через угол: сегмент проходит ровно между двумя твёрдыми
    // клетками — реализация, шагающая по одной оси и не посещающая обе
    // граничные, проскользнула бы.
    {
        MacroGrid w;
        w.fill_cell(11, 10, 10, kMatConcrete);
        w.fill_cell(10, 11, 10, kMatConcrete);
        CHECK(sub_march(w, mid(10, 10, 10), mid(11, 11, 10), hit));
    }
    std::printf("[los] sub_march: 3 оси, старт-в-материи, шов, диагональ\n");
}

int main() {
    test_wrap();
    test_los();
    test_nearest_image();
    test_mat4_lookAt();
    test_submask();
    test_grid_toroidal();
    test_fields();
    test_level_stack();
    test_aabb_overlap();
    test_physics_lands_on_floor();
    test_buoyancy();
    test_rigid_ball_settles_and_sleeps();
    test_rigid_box_lies_flat();
    test_rigid_chain_hangs_and_cuts();
    test_rigid_ball_ball_wakes_and_stacks();
    test_rigid_prop_hits_agent_and_agent_kicks();
    test_rigid_material_pair_bounce();
    test_air_drag_terminal_velocity();
    test_diffusion();
    test_camera_component_is_movable();
    test_parallel_for();
    test_nav_coarse();
    test_nav_fine();
    test_route_step();
    test_destruct_all();

    test_step_up_one_atom();
    test_stain_layer();
    test_props_all();
    test_surface_all();
    test_clearance_all();
    std::printf("%d/%d checks passed\n", g_checks - g_fails, g_checks);
    if (g_fails) {
        std::printf("FAILED (%d)\n", g_fails);
        return 1;
    }
    std::printf("OK\n");
    return 0;
}
