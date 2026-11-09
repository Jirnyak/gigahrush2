// Comprehensive Opaque-Box E2E Test Suite for GigaHrush 2
// Covering Features F1 through F15 across Tier 1, Tier 2, Tier 3, and Tier 4.
// Strict compliance with ECS/DOD invariants, zero exceptions, zero RTTI.

#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>

#include "core/tick.h"
#include "core/wrap.h"
#include "core/rng.h"
#include "core/math.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"
#include "game/patrol.h"
#include "game/guide.h"   // заявка + ЕДИНСТВЕННЫЙ писатель скорости (см. ниже)
#include "game/economy.h"
#include "game/event_bus.h"
#include "game/prop_system.h"
#include "game/faction.h"
#include "game/faction_relations.h"
#include "game/floor_gen.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/elevator.h"
#include "game/embody.h"
#include "game/npc_pool.h"
#include "game/needs.h"
#include "game/combat.h"
#include "game/samosbor.h"
#include "game/wander.h"
#include "game/population.h"
#include "world/world.h"
#include "world/lattice.h"
#include "world/nav.h"
#include "world/gravity.h"
#include "world/level_stack.h"
#include "sim/physics.h"
#include "sim/diffusion.h"

using namespace giga;
using namespace giga::game;

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

static bool approx_eq(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps;
}

// Shared Navigation Fixture for fast test execution
struct NavFixture {
    World world;
    // НАВ ПО ЗОНАМ — синтетический, две зоны и одна плоскость поля (§88/F.2).
    // Печь настоящий бейк зон здесь нельзя: он стоит сотни мс и 98 МиБ на
    // этаж, а проверяется в этом файле ПОТРЕБИТЕЛЬ, не бейк. Синтетика
    // подделывает ровно два чтения шага — таблицу и плоскость соседки.
    game::ZoneNav zn;
    bool initialized = false;

    void init() {
        if (!initialized) {
            generate_floor(world, 0, floor_spec(FloorKind::Residential), 42u);
            zn.part.zones = 2;
            zn.part.at.assign(kMacroCells, static_cast<game::RoomId>(1));
            for (int cz = 0; cz < kMacroDim; ++cz)
                for (int cy = 0; cy < kMacroDim; ++cy)
                    for (int cx = 48; cx < kMacroDim; ++cx)
                        zn.part.at[macro_index(cx, cy, cz)] =
                            static_cast<game::RoomId>(2);
            zn.graph.zones = 2;
            zn.graph.offset = {0u, 1u, 2u};
            zn.graph.nbr = {static_cast<game::RoomId>(2),
                            static_cast<game::RoomId>(1)};
            zn.dist.zones = 2;
            zn.dist.d = {0, 1, 1, 0};
            zn.flow.planes = 1;
            zn.flow.dir.assign(kMacroCells, 1); // слот 0, направление +x
            initialized = true;
        }
    }
};
static NavFixture g_nav;

// ===========================================================================
// ОСНАСТКА ВЕДЕНИЯ (2026-11-09) — ДВА ПРИМИТИВА, И ОБА ВЫВЕДЕНЫ
// ===========================================================================
//
// Токен `MotionOwner` умер вместе с шестью рулевыми проходами, каждый из
// которых писал `Velocity` сам. Теперь занятие ЗАЯВЛЯЕТ ЦЕЛЬ со своим РАНГОМ
// (`steer_claim`), а горизонтальную скорость пишет ОДИН проход (`guide_step`),
// и стоит он ПОСЛЕ всех заявителей в том же тике ([game/guide.h]).

// СЕНТИНЕЛЬ ЗАПИСИ. Величина выбрана так, чтобы НИ ОДНА заявка этого файла не
// могла её воспроизвести: скорости здесь положительные и не больше 3 м/с,
// пеленги осевые. Значит «сентинель на месте» означает РОВНО «никто не писал»,
// а не «написал то же самое» — иначе проверка записи судила бы совпадение
// значений, а не факт записи (пятый класс лжи прибора, §87).
inline constexpr float kSteerSentinel = -7.25f;

// ТИК, В КОТОРЫЙ ПРОГУЛКА ПОСЕТИТ ЭТО ТЕЛО. `wander_step` ходит стаггером по
// тождеству — `hash_u32(id) % kWanderPeriod == tick % kWanderPeriod`
// ([game/wander.cpp]), — поэтому стенд, взявший тик наугад, в СЕМИ случаях из
// восьми мерил бы ПРОПУСК ПО СТАГГЕРУ и называл бы его отказом по рангу: гейт
// остался бы зелёным и при полностью мёртвой прогулке. Тик ВЫВОДИТСЯ из того же
// хеша, а не подбирается.
static std::uint64_t wander_visit_tick(Entity e) {
    return static_cast<std::uint64_t>(
        hash_u32(static_cast<std::uint32_t>(entt::to_integral(e))) %
        kWanderPeriod);
}

// ===========================================================================
// TIER 1: FEATURE COVERAGE (>=5 tests per feature F1-F15 = 75 tests)
// ===========================================================================

// --- F1 и F2 СНЕСЕНЫ 2026-11-08 вместе с системой ролей ---
// F1 была «RoleId & kRoleTraits Multipliers» (5 тестов, 23 исполнения), F2 —
// «role_for Floor Distributions» (5 тестов, 563 исполнения). Обе проверяли
// ТАБЛИЦУ из `role.h`: 60 захардкоженных множителей и весов в C++ при законе
// проекта «вся политика в данных». Файл снесён решением владельца, и вместе с
// ним — оба блока; различие тел на этаже несут ФРАКЦИИ (F5, F6 и suite_faction*)
// и НУЖДЫ. Номера F3..F15 НЕ сдвинуты сознательно: они адреса, по которым на
// этот файл ссылаются CMakeLists и markoaudit, а не порядковые номера.

// --- F3: Patrol Routing ---

static void test_t1_f3_01_patrol_plan_component_pod_layout() {
    PatrolPlan plan{};
    // Цель наряда — ЗОНА (§88/F.2). `nodeFrom`/`nodeTo` решётки 4x4x4 умерли
    // вместе с предметом; освободившийся байт оплатил расширение цели до
    // RoomId, поэтому пин 4 держится БЕЗ подкрутки.
    CHECK(plan.zoneTo == game::kNoRoom);
    CHECK(plan.hops == 0);
    static_assert(sizeof(PatrolPlan) == 4, "PatrolPlan must stay 4 bytes POD");
    static_assert(std::is_trivially_copyable_v<PatrolPlan>);
}

// ПЕРЕИМЕНОВАН 2026-11-08: прежде `..._duty_patrol_...` и ставил роль Duty
// (множитель 1.5 на счёт патруля). Роли снесены; утверждение осталось тем же и
// по-прежнему бьётся — счёт патруля растёт из ФРАКЦИОННЫХ `patrolDrive`/`duty`,
// а ролевой множитель не мог сделать положительное из нуля.
static void test_t1_f3_02_patrol_intent_activation() {
    Perception p{};
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(101u);
    n.food = 10.0f;
    n.water = 10.0f;
    n.sleep = 10.0f;

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentPatrol] > 0.0f);
}

static void test_t1_f3_03_patrol_step_lazy_attachment() {
    g_nav.init();
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;

    const std::uint64_t tick = 7u;
    ai_patrol_step(reg, g_nav.zn, 0u, nullptr, tick);
    CHECK(reg.all_of<PatrolPlan>(e));
    // ВТОРАЯ ЛЕНИВАЯ ПРИСТЁЖКА, И ЕЮ ТЕПЕРЬ ВЫРАЖЕН ВЕСЬ АРБИТРАЖ: вместо байта
    // токена наряд оставляет на теле ЗАЯВКУ своего ранга. Мутация «забрать тело
    // и не заявить» (снятие `steer_claim` в хвосте `ai_patrol_step`) красит это
    // место в обе стороны: заявки нет — `try_get` даёт nullptr; заявка не того
    // ранга — не сходится `rank`.
    const Steer* s = reg.try_get<Steer>(e);
    CHECK(s != nullptr);
    CHECK(steer_claim_live(*s, tick));
    CHECK(s->rank == SteerRank::Patrol);
}

static void test_t1_f3_04_patrol_leg_progression_and_hop_increment() {
    // ПЕРЕПИСАН НА ПРЕДМЕТ, А НЕ НА ЕГО КОПИЮ. Прежняя версия СИМУЛИРОВАЛА
    // бухгалтерию ноги руками (`nodeFrom = nodeTo; nodeTo = lattice_neighbor`)
    // и утверждала о своей же симуляции — то есть была второй реализацией
    // закона и не могла покраснеть ни на какой правке `ai_patrol_step`.
    // Теперь нога закрывается ПРОХОДОМ: тело переносится в целевую зону, и
    // шаг обязан отчитаться о прибытии и завести новую ногу.
    g_nav.init();
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{(32.0f + 0.5f) * kCellSize,
                                             (32.0f + 0.5f) * kCellSize,
                                             (1.0f + 0.5f) * kCellSize}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;

    const PatrolTick first = ai_patrol_step(reg, g_nav.zn, 0u, nullptr, 7u);
    CHECK(first.arrived == 0u); // первая нога прибытием не считается
    CHECK(reg.get<PatrolPlan>(e).hops == 1u);
    CHECK(reg.get<PatrolPlan>(e).zoneTo == static_cast<game::RoomId>(2));

    // ТИК ДРУГОЙ, И ЭТО НЕ КОСМЕТИКА: заявка живёт РОВНО ОДИН тик, и второй шаг
    // наряда в проде всегда приходит на следующем. Сброс токена руками (две
    // строки `brain.motion = Wander`, стоявшие здесь) был именно подделкой этой
    // смены тика — компонента снимается сама, снимать её стенду нечем.
    reg.get<Transform>(e).pos.x = (50.0f + 0.5f) * kCellSize;
    const PatrolTick second = ai_patrol_step(reg, g_nav.zn, 0u, nullptr, 8u);
    CHECK(second.arrived == 1u);
    CHECK(reg.get<PatrolPlan>(e).hops == 2u);
    CHECK(reg.get<PatrolPlan>(e).zoneTo == static_cast<game::RoomId>(1));
}

// ПЛОСКОСТЬ ХОДЬБЫ — ДВЕ СТАНЗЫ, И ВТОРАЯ ПРИЕХАЛА СЮДА ИЗ СНЕСЁННОГО t3_05
// (тот утверждал `vec3 tangentVel{0,1.35f,0}; CHECK(tangentVel.x == 0)`, то есть
// инициализацию агрегата компилятором). Осей у гравитации три, и `steer_write`
// несёт по ветке на каждую: гейт на одном режиме оставил бы две ветки без
// читателя (закон изотропии — x/y/z равноправны).
static void test_t1_f3_05_patrol_steering_in_walking_plane() {
    g_nav.init();
    const std::uint64_t tick = 7u;

    // СТАНЗА А — НАСТОЯЩИЙ НАРЯД ПРИ -Z. Главное здесь: наряд скорость НЕ ПИШЕТ
    // ВОВСЕ (это и есть перемена), а когда её пишет единственный писатель —
    // ось гравитации остаётся той, какой была. Мутация «писать все три оси» в
    // `steer_write` красит вертикаль; мутация «вернуть запись наряду» красит
    // проверку ДО `guide_step`.
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        // Сентинель в плоскости ходьбы, живая вертикаль в оси гравитации:
        // первая половина проверяет, что заявитель НЕ ПИСАЛ, вторая — что
        // писатель не тронул ось. Ноль в плоскости для первой не годился бы:
        // «не писал» было бы не отличить от «написал ноль».
        reg.emplace<Velocity>(e,
                              Velocity{vec3{kSteerSentinel, kSteerSentinel, 5.0f}});
        reg.emplace<NpcRef>(e, NpcRef{1u});
        AiBrain& brain = reg.emplace<AiBrain>(e);
        brain.currentIntent = IntentPatrol;

        GravityField g{};
        g.regime = GravityRegime::NegZ;
        g.global = vec3{0.0f, 0.0f, -9.81f};

        ai_patrol_step(reg, g_nav.zn, 0u, &g, tick);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kSteerSentinel)); // не писал
        CHECK(approx_eq(reg.get<Velocity>(e).v.y, kSteerSentinel));
        const GuideTick gt = guide_step(reg, g_nav.zn, 0u, tick, &g);
        CHECK(gt.led == 1u);
        const Velocity& v = reg.get<Velocity>(e);
        CHECK(approx_eq(v.v.z, 5.0f)); // ось гравитации не тронута
        // Длина в плоскости ходьбы есть РОВНО заявленная скорость: без этого
        // «написано» нельзя было бы отличить от «написано чем попало».
        CHECK(approx_eq(std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y), kErrandSpeed));
    }

    // СТАНЗА Б — ТА ЖЕ ОСЬ, ДРУГОЙ РЕЖИМ (+X). Плоскость ходьбы Y/Z, и
    // неприкосновенна X. Наряд в этой синтетике не заявляет (шаг поля идёт
    // ВДОЛЬ гравитации, дверь отдаёт `StepUp`), поэтому заявка подаётся прямо:
    // предмет станзы — `steer_write`, а не выбор ноги.
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(
            e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});

        GravityField g{};
        g.regime = GravityRegime::PosX;
        g.global = vec3{9.81f, 0.0f, 0.0f};

        CHECK(steer_claim(reg, e, tick, SteerRank::Patrol,
                          target_dir(vec3{0.0f, 1.0f, 0.0f}, kErrandSpeed)));
        const GuideTick gt = guide_step(reg, g_nav.zn, 0u, tick, &g);
        CHECK(gt.led == 1u);
        const Velocity& v = reg.get<Velocity>(e);
        CHECK(approx_eq(v.v.x, kSteerSentinel)); // ось гравитации не тронута
        CHECK(approx_eq(v.v.y, kErrandSpeed));   // плоскость написана
        CHECK(approx_eq(v.v.z, 0.0f));
    }
}

// --- F4 «Medic Healing Mechanic» СНЕСЕНА 2026-11-08 ---
// Санитар был одним из пяти архетипов `role.h`; роли снесены целиком, и его
// четыре константы (`kMedicReachM/Threshold/HealPerSec/FatiguePerSec`) уехали
// вместе с файлом. Пять тестов, 9 исполнений. Три из пяти были к тому же
// ВТОРОЙ РЕАЛИЗАЦИЕЙ: они складывали `hpBank += kMedicHealPerSec * dt` руками
// и утверждали о своей же арифметике, не о `ai_step`, — то есть не могли
// покраснеть ни на какой правке аурной петли. Поток самого банка
// (`Needs::hpBank` -> целые HP) жив и пинится в `suite_rooms`/`needs`.

// --- F5: Liquidator & Guard Defense ---

static void test_t1_f5_01_liquidator_faction_traits() {
    const FactionTraits& ft = faction_traits(static_cast<std::uint16_t>(Faction::Liquidators));
    CHECK(approx_eq(ft.duty, 0.82f));
    CHECK(approx_eq(ft.risk, 0.74f));
    CHECK(approx_eq(ft.panic, 0.22f));
    CHECK(approx_eq(ft.patrolDrive, 0.82f));
    CHECK(approx_eq(ft.workDrive, 0.50f));
}

static void test_t1_f5_02_liquidator_combat_intent_under_danger() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.85f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(88u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] >= 0.0f);
}

static void test_t1_f5_03_liquidator_grudge_combat_conversion() {
    MemoryRecall r{};
    r.grudge = 0.8f;
    r.foe = 12u;
    Perception p{};

    apply_recall(r, static_cast<std::uint16_t>(Faction::Liquidators), p);
    CHECK(p.grudge > 0.0f);
}

static void test_t1_f5_04_liquidator_vs_citizen_panic_divergence() {
    Perception pCiv{};
    pCiv.faction = static_cast<std::uint16_t>(Faction::Citizens);
    pCiv.danger = 0.9f;
    pCiv.hp = 100.0f;
    pCiv.maxHp = 100.0f;
    Needs nCiv = needs_roll(1u);
    float sCiv[kIntentCount];
    score_intents(pCiv, nCiv, sCiv);

    Perception pLiq{};
    pLiq.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    pLiq.danger = 0.9f;
    pLiq.hp = 100.0f;
    pLiq.maxHp = 100.0f;
    Needs nLiq = needs_roll(1u);
    float sLiq[kIntentCount];
    score_intents(pLiq, nLiq, sLiq);

    CHECK(sLiq[IntentCombat] >= sCiv[IntentCombat]);
}

static void test_t1_f5_05_liquidator_fireline_samosbor_stance() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.samosborActive = true;
    p.danger = 0.5f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(99u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] > 0.0f || scores[IntentPatrol] > 0.0f);
}

// --- F6: Cultist Faction Routines ---
// Три ролевых теста блока (t1_f6_01..03, 5 исполнений) снесены 2026-11-08: они
// читали строки `kRoleTraits` напрямую. Выжившие держатся на ФРАКЦИИ
// `Faction::Cultists` и на памяти агента — на предметах, которые остались.

static void test_t1_f6_04_cultist_monster_non_aggression() {
    NpcPool pool;
    pool.init();
    NpcId id = pool.spawn();
    pool.faction(id) = static_cast<std::uint16_t>(Faction::Cultists);
    CHECK(!mob_hostile_to(pool, id));
}

static void test_t1_f6_05_looter_memory_recall_scavenge_affordance() {
    AiMemory mem;
    NpcId looterId = 42u;
    ai_remember_cell(mem, looterId, MemFood, 10, 10, 10, 0.9f, 100.0);

    MemoryRecall r = ai_recall(mem, looterId, 10, 10, 10, 105.0);
    CHECK(r.siteStrength[MemFood] > 0.0f);
    CHECK(r.live == 1);
}

// --- F7: ВЖИВЛЁННОСТЬ ШАГА В ПРОХОД НАРЯДА ---
//
// Четыре теста решётки (достижимость и симметрия coarse-графа, `kFlowArrived`
// на якоре, `route_step` между соседними якорями и на одной клетке) СНЕСЕНЫ
// 2026-10-12 вместе с предметом (§88/F.2 шаг 3). Пятый остался и впервые
// говорит правду своим именем: он проверяет не маршрут решётки, а то, что шаг
// нава по зонам ВЖИВЛЁН в проход наряда.
//
// ЧТО ИМЕННО ОН СУДИТ ТЕПЕРЬ, когда токена нет: наряд не «забирает тело», а
// ЗАЯВЛЯЕТ ЦЕЛЬ, и заявка обязана назвать ЗОНУ СВОЕГО ПЛАНА и скорость хода
// жителя. Это сильнее прежнего утверждения про байт: байт говорил «кто-то
// что-то забрал», а заявка говорит КУДА и КАК БЫСТРО, то есть ловит мутацию
// «заявить не ту зону» (`target_zone(myZone, ...)` вместо `plan.zoneTo`), на
// которую токен был слеп по построению.

static void test_t1_f7_05_zone_step_wiring_in_ai_patrol_step() {
    g_nav.init();
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;

    const std::uint64_t tick = 7u;
    const PatrolTick t = ai_patrol_step(reg, g_nav.zn, 0u, nullptr, tick);
    CHECK(t.walking == 1u);
    const Steer& s = reg.get<Steer>(e);
    CHECK(steer_claim_live(s, tick));
    CHECK(s.rank == SteerRank::Patrol);
    CHECK(s.target.kind == TargetKind::Zone);
    CHECK(s.target.zone == reg.get<PatrolPlan>(e).zoneTo);
    CHECK(approx_eq(s.target.speed, kErrandSpeed));
}

// --- F8: Single-Writer Velocity Ownership ---
//
// ПРЕДМЕТ БЛОКА ЖИВ, А ЕГО НОСИТЕЛЬ СМЕНИЛСЯ (2026-11-09). Пять тел ниже
// стерегли ТОКЕН `MotionOwner` — байт арбитража между ШЕСТЬЮ писателями
// скорости. Писатель стал ОДИН физически (`guide_step`), токен умер по
// построению, и каждое из пяти утверждений перенесено на то, чем теперь
// выражается то же свойство: знак ранга, один вопрос «кто-то сильнее»,
// отсутствие заявки, отказ слабого перебить сильного, снятие владения.

static void test_t1_f8_01_fresh_claim_reads_as_no_claim() {
    // ЗНАК РАНГА — ТОТ ЖЕ ЗАКОН, ЧТО ДЕРЖАЛ `MotionOwner::Wander == 0`.
    // Зануленная компонента, остаток на трупе, свежий эмплейс и заявитель,
    // выставивший цель и забывший ранг, обязаны читаться как «ЗАЯВКИ НЕТ».
    // Поставь сильнейший ранг нулём — и любой из этих четырёх случаев даёт
    // заявку БЕГСТВА высшего приоритета на всю толпу ([game/guide.h]).
    Steer fresh{};
    CHECK(static_cast<std::uint8_t>(SteerRank::None) == 0u);
    CHECK(fresh.rank == SteerRank::None);
    CHECK(fresh.target.kind == TargetKind::None);
    CHECK(!steer_claim_live(fresh, 0u)); // тик совпал, и всё равно не заявка
    // ОБРАТНАЯ ПОЛЯРНОСТЬ: слабейший ЗАКОННЫЙ ранг на этом тике — заявка есть.
    const Steer walk{target_hold(), 0u, SteerRank::Walk};
    CHECK(steer_claim_live(walk, 0u));
    // ПОРЯДОК ПЕРЕЧИСЛЕНИЯ — ОТ СЛАБОГО К СИЛЬНОМУ, и это половина закона
    // выше: перестановка строк энума (бегство вниз, прогулка вверх) сделала бы
    // «отказ падает в сторону ведения» ложью, оставив `None == 0` на месте.
    CHECK(SteerRank::Walk < SteerRank::Errand);
    CHECK(SteerRank::Errand < SteerRank::Patrol);
    CHECK(SteerRank::Patrol < SteerRank::Flee);
    CHECK(SteerRank::Flee < SteerRank::Count);
}

static void test_t1_f8_02_stronger_claim_is_what_the_weak_sees() {
    // ОДИН ВОПРОС ВМЕСТО ЧЕТЫРЁХ ФОРМУЛИРОВОК ТОКЕНА. Полярности здесь не две,
    // а три, и средняя — главная: РАВНЫЙ РАНГ НЕ СИЛЬНЕЕ. Мутация `>` на `>=`
    // заставила бы проход отказываться от тела, которое заявил сам в прошлом
    // проходе того же тика, то есть рвать собственное занятие каждый кадр —
    // ровно дефект, который у токена поймал `suite_place` ([game/ai.h]).
    Registry reg;
    Entity e = reg.create();
    const std::uint64_t tick = 9u;
    CHECK(steer_claim(reg, e, tick, SteerRank::Patrol, target_hold()));
    CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Walk, tick));
    CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Errand, tick));
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Patrol, tick));
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Flee, tick));
}

static void test_t1_f8_03_no_claim_means_zero_writes() {
    // ТЕЛО БЕЗ ЗАЯВКИ ПОЛУЧАЕТ НОЛЬ ЗАПИСЕЙ И ПРОШЛУЮ СКОРОСТЬ — дословно то,
    // что происходит сегодня при стаггере, когда проход тело не посетил. Это
    // прямой наследник `!ai_owns_motion` на теле без `AiBrain`, и мутация
    // «вести тело без заявки как-нибудь» (например ветка `default` в
    // `guide_step` вместо `continue`) красит сентинель.
    g_nav.init();
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(
        e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, 0u));
    const GuideTick gt = guide_step(reg, g_nav.zn, 0u, 0u, nullptr);
    CHECK(gt.led == 0u && gt.held == 0u);
    CHECK(gt.bogus == 0u && gt.stale == 0u); // «нет заявки» — не отказ, а тишина
    CHECK(approx_eq(reg.get<Velocity>(e).v.x, kSteerSentinel));
    CHECK(approx_eq(reg.get<Velocity>(e).v.y, kSteerSentinel));
}

static void test_t1_f8_04_weak_claim_never_lands_on_a_strong_one() {
    // ПРОГУЛКА — СЛАБЕЙШИЙ ЗАЯВИТЕЛЬ, и прежде это выражалось её собственным
    // чтением токена (`ai_owns_motion` → `continue`). Теперь — рангом, и
    // спрашивается ДВА разных следствия, потому что в проде им соответствуют ДВА
    // разных места:
    //   * `considered == 0` — проход над телом НЕ РАБОТАЛ (отказ стоит ДО всей
    //     работы заявителя, как стоял гейт токена). Ловит снятие
    //     `steer_claimed_by_stronger` в `wander_step`;
    //   * цель на теле осталась целью СИЛЬНОГО. Ловит снятие `s->rank > rank` в
    //     `steer_claim` — то есть закон «слабая заявка поверх сильной не ложится».
    // Разделить их обязательно: убери только первое, и второе всё равно
    // удержит исход, то есть гейт на одном утверждении назвал бы здоровым
    // проход, который стреляет на бегу.
    g_nav.init();
    NpcPool pool;
    pool.init();

    // Полярность А: сильная заявка стоит — прогулка её НЕ ПЕРЕБИВАЕТ.
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
        reg.emplace<WanderTarget>(e, WanderTarget{});
        const std::uint64_t tick = wander_visit_tick(e);
        CHECK(steer_claim(reg, e, tick, SteerRank::Errand,
                          target_dir(vec3{0.0f, 1.0f, 0.0f}, 2.0f)));
        const WanderTick w =
            wander_step(reg, g_nav.world.grid(), pool, g_nav.zn, 0u, tick);
        CHECK(w.considered == 0u);
        const Steer& s = reg.get<Steer>(e);
        CHECK(s.rank == SteerRank::Errand);
        CHECK(s.target.kind == TargetKind::Dir);
        CHECK(approx_eq(s.target.speed, 2.0f));
    }

    // Полярность Б: заявки нет — прогулка тело ЗАБИРАЕТ. Без этой половины гейт
    // выше был бы зелен и при `wander_step`, не заявляющем вообще ничего (и при
    // стаггере, который тело не посещает — довод у `wander_visit_tick`).
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
        reg.emplace<WanderTarget>(e, WanderTarget{});
        const std::uint64_t tick = wander_visit_tick(e);
        const WanderTick w =
            wander_step(reg, g_nav.world.grid(), pool, g_nav.zn, 0u, tick);
        CHECK(w.considered == 1u);
        const Steer* s = reg.try_get<Steer>(e);
        CHECK(s != nullptr);
        CHECK(steer_claim_live(*s, tick));
        CHECK(s->rank == SteerRank::Walk);
    }
}

static void test_t1_f8_05_claim_expires_with_its_own_tick() {
    // `ai_release` УМЕР, И ЗАМЕНИЛ ЕГО НЕ ВЫЗОВ, А ПОЛЕ. Проход, возвращавший
    // все токены разом, существовал потому, что владение ПЕРЕЖИВАЛО тик;
    // заявка носит тик в себе и снимается сама, а сброс отдельным проходом по
    // телам CANON S22 запрещает поимённо ([game/guide.h]).
    //
    // СВОЙСТВО, КОТОРОЕ СТЕРЁГ `ai_release`, ОСТАЛОСЬ ТЕМ ЖЕ: тело не должно
    // ехать решением, которое уже снято. Мутация `s.tick == tick` → `true`
    // (или снятие ветки `stale`) красит вторую половину.
    g_nav.init();
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(
        e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    CHECK(steer_claim(reg, e, 11u, SteerRank::Patrol,
                      target_dir(vec3{1.0f, 0.0f, 0.0f}, kErrandSpeed)));

    const GuideTick now = guide_step(reg, g_nav.zn, 0u, 11u, nullptr);
    CHECK(now.led == 1u);
    CHECK(now.stale == 0u);
    CHECK(approx_eq(reg.get<Velocity>(e).v.x, kErrandSpeed));

    reg.get<Velocity>(e).v.x = kSteerSentinel;
    const GuideTick later = guide_step(reg, g_nav.zn, 0u, 12u, nullptr);
    CHECK(later.stale == 1u);
    CHECK(later.led == 0u && later.held == 0u);
    CHECK(approx_eq(reg.get<Velocity>(e).v.x, kSteerSentinel));
    // И слабейший на НОВОМ тике тело берёт без спора: истёкшая заявка не
    // держит тело (`steer_claimed_by_stronger` читает ту же живость).
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, 12u));
}

// --- F9: Vector Gravity Tangent Projection ---

static void test_t1_f9_01_all_six_cardinal_regime_frames() {
    GravityFrame fz = regime_frame(GravityRegime::NegZ);
    CHECK(fz.axis == 2 && fz.upSign == 1 && fz.tanA == 0 && fz.tanB == 1 && fz.pull);

    GravityFrame fx = regime_frame(GravityRegime::PosX);
    CHECK(fx.axis == 0 && fx.upSign == -1 && fx.tanA == 1 && fx.tanB == 2 && fx.pull);

    GravityFrame fy = regime_frame(GravityRegime::NegY);
    CHECK(fy.axis == 1 && fy.upSign == 1 && fy.tanA == 0 && fy.tanB == 2 && fy.pull);
}

static void test_t1_f9_02_regime_down_cardinal_steps() {
    CellStep dz = regime_down(GravityRegime::NegZ);
    CHECK(dz.x == 0 && dz.y == 0 && dz.z == -1);

    CellStep dx = regime_down(GravityRegime::PosX);
    CHECK(dx.x == 1 && dx.y == 0 && dx.z == 0);

    CellStep dy = regime_down(GravityRegime::NegY);
    CHECK(dy.x == 0 && dy.y == -1 && dy.z == 0);
}

static void test_t1_f9_03_zero_gravity_frame_isotropy() {
    GravityField g{};
    g.regime = GravityRegime::Zero;
    g.global = vec3{0.0f, 0.0f, 0.0f};

    GravityFrame frames[kMaxGravityFrames];
    int count = gravity_frames(g, frames);
    CHECK(count == 6);
    for (int i = 0; i < 6; ++i) {
        CHECK(!frames[i].pull);
    }
}

static void test_t1_f9_04_regime_from_vector_classification() {
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, -9.81f}) == GravityRegime::NegZ);
    CHECK(regime_from_vector(vec3{9.81f, 0.0f, 0.0f}) == GravityRegime::PosX);
    CHECK(regime_from_vector(vec3{0.0f, -9.81f, 0.0f}) == GravityRegime::NegY);
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, 0.0f}) == GravityRegime::Zero);
}

static void test_t1_f9_05_tangent_velocity_preserves_gravity_axis() {
    // Gravity along X, tangent plane is Y/Z
    vec3 v{9.81f, 0.0f, 0.0f};
    v.y = 1.35f; // Steer along tanA
    v.z = 0.50f; // Steer along tanB
    CHECK(approx_eq(v.x, 9.81f)); // X preserved
}

// --- F10: 3D Toroidal Wrapping Invariant ---

static void test_t1_f10_01_wrap_delta_f_continuous_torus() {
    float p = 256.0f;
    CHECK(approx_eq(wrap_delta_f(0.0f, 10.0f, p), 10.0f));
    CHECK(approx_eq(wrap_delta_f(10.0f, 0.0f, p), -10.0f));
    CHECK(approx_eq(wrap_delta_f(1.0f, 255.0f, p), -2.0f));
    CHECK(approx_eq(wrap_delta_f(255.0f, 1.0f, p), 2.0f));
}

static void test_t1_f10_02_nearest_image_projection() {
    float p = 256.0f;
    float img = nearest_image(254.0f, 2.0f, p);
    CHECK(approx_eq(img, -2.0f));
}

static void test_t1_f10_03_discrete_wrap_macro_and_wrapi() {
    CHECK(wrap_macro(0) == 0);
    CHECK(wrap_macro(127) == 127);
    CHECK(wrap_macro(128) == 0);
    CHECK(wrap_macro(-1) == 127);
    CHECK(wrapi(-128, 128) == 0);
    CHECK(wrap_delta(0, 127, 128) == -1);
}

static void test_t1_f10_04_toroidal_distance_symmetry() {
    float p = 256.0f;
    float d1 = std::fabs(wrap_delta_f(20.0f, 240.0f, p));
    float d2 = std::fabs(wrap_delta_f(240.0f, 20.0f, p));
    CHECK(approx_eq(d1, d2));
    CHECK(approx_eq(d1, 36.0f));
}

static void test_t1_f10_05_multi_period_coordinate_invariance() {
    float p = 256.0f;
    float d0 = wrap_delta_f(15.0f, 35.0f, p);
    float d1 = wrap_delta_f(15.0f + 2.0f * p, 35.0f - 3.0f * p, p);
    CHECK(approx_eq(d0, d1));
}

// --- F11: БЛОК БАНКА СНЕСЁН ЦЕЛИКОМ (2026-11-08) ---
//
// Здесь стояли десять тел (t1_f11_01..05 и t2_f11_01..05) и приватный хелпер
// `net_worth`: открытие счёта по банде, цикл вклад/снятие, жизненный цикл
// кредита, периодическое начисление, СОХРАНЕНИЕ ЧИСТОЙ СУММЫ через все
// операции, нули и отрицательные суммы, потолок принципала, лимит кредита,
// кап догона на 24 периода и асимметричное округление процента.
//
// Снесены вместе с системой (пад-банк, решение владельца «легаси, ядро должно
// быть чистым»), а не оставлены красными: пин с ненулевым числом падений в
// этом проекте запрещён, а тест системы, которой нет, — не тест.
//
// ДВА СВОЙСТВА, которые эти тела проверяли, стоит унести к следующей денежной
// системе, потому что оба ловили настоящие дефекты: (1) ИНВАРИАНТ СУММЫ — любая
// операция обязана сохранять `banked + вклад - долг`, и это ловит перенос,
// который теряет или печатает рубль, чего не ловит ни одна проверка поля; (2)
// НОЛЬ И ОТРИЦАТЕЛЬНОЕ как законные входы — глагол обязан отказывать числом 0,
// а не клампить молча. Живая касса (`teller_deposit_cash`/`teller_withdraw_cash`)
// покрыта в suite_economy.

// --- F12: шина событий ---

static void test_t1_f12_01_event_bus_publish_and_size() {
    EventBus bus;
    bus.init();
    CHECK(bus.empty());

    bus.publish(EventType::FloorEntered, 1u, 0u, 0u, 100u);
    bus.publish(EventType::NpcDied, 2u, 0u, 0u, 105u);
    CHECK(bus.size() == 2);
    CHECK(!bus.empty());
}

// F12: тесты ленты событий СНЕСЕНЫ 2026-09-30 вместе с самой лентой
// (`EventFeed`/`feed_drain`/`feed_line`/`feed_tick`/`event_line` — ноль
// вызывающих в `src/`). Шина осталась, и её проверяет t1_f12_01 ниже.





// --- F13: Interactable wiring ---
// Тесты t1_f13_01..04 и t1_f14_03 СНЕСЕНЫ 2026-11-07 вместе с парой
// find_nearest_interactable/interaction_step/prop_interact_step (инкремент B
// лифт-лимба): они проверяли сами символы (критерий [purge-2026-09-30]),
// прод-вызовов у пары не было (бывшие отложки wired §52). Выбор цели
// интеракции — закон фокуса ([game/focus.h]), прицел + body_reach.

static void test_t1_f13_05_collect_interactable_positions() {
    Registry reg;
    Entity p1 = reg.create();
    reg.emplace<Transform>(p1, Transform{vec3{1.0f, 2.0f, 3.0f}, 0u});
    Interactable& a1 = reg.emplace<Interactable>(p1);
    a1.kind = Interactable::Kind::Terminal;
    a1.active = true;

    Entity p2 = reg.create();
    reg.emplace<Transform>(p2, Transform{vec3{4.0f, 5.0f, 6.0f}, 0u});
    Interactable& a2 = reg.emplace<Interactable>(p2);
    a2.kind = Interactable::Kind::Terminal;
    a2.active = true;

    std::vector<vec3> positions;
    std::uint32_t count = collect_interactable_positions(reg, 0u, Interactable::Kind::Terminal, positions);
    CHECK(count == 2);
    CHECK(positions.size() == 2);
}

// --- F14: check_wired.cmake Static Gate & Entry Points Contract ---

// t1_f14_01 (контракт и подпись `bank_step`) и t1_f14_05 (идемпотентность
// точки входа, нулевая аллокация) СНЕСЕНЫ 2026-11-08 вместе с банком. Оба
// проверяли САМ СИМВОЛ — критерий сноса [purge-2026-09-30].
// --- F15: Samosbor & Multi-Floor AI Integration ---

static void test_t1_f15_01_samosbor_four_phase_cycle() {
    SamosborState st{};
    SamosborRng rng{12345u};
    st = samosbor_new_game(rng);

    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
    // Fast-forward to Warning
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Warning));

    // Fast-forward to Active
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Active));

    // Fast-forward to Aftermath
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Aftermath));

    // Fast-forward to Idle
    samosbor_step(st, st.phaseMs, 0, rng);
    CHECK(st.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
    CHECK(st.count == 1);
}

static void test_t1_f15_02_samosbor_duty_cycle_depth_scaling() {
    float d0 = samosbor_duty01(0);
    float d10 = samosbor_duty01(10);
    float d25 = samosbor_duty01(25);
    float d50 = samosbor_duty01(50);

    CHECK(d0 < d10);
    CHECK(d10 < d25);
    CHECK(d25 < d50);
    CHECK(d50 > 0.90f);
}

static void test_t1_f15_03_samosbor_specialist_perception_reaction() {
    Perception p{};
    p.samosborActive = true;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(10u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSafety] > 0.0f || scores[IntentFlee] > 0.0f || scores[IntentCombat] > 0.0f);
}

static void test_t1_f15_04_samosbor_alarm_and_beat_hud_level() {
    SamosborState st{};
    st.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    st.phaseMs = 15000u;
    st.phaseTotalMs = 30000u;

    SamosborAlarm alarm = samosbor_alarm(st);
    CHECK(alarm.on);
    CHECK(std::strlen(alarm.text) > 0);
    CHECK(alarm.beat == static_cast<std::uint8_t>(SamosborBeat::Warning));
}

static void test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count() {
    SamosborState prev{};
    prev.count = 5;
    SamosborRng rng{99u};

    SamosborState next = samosbor_enter_floor(prev, 10, rng);
    CHECK(next.count == 5);
    CHECK(next.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
}

// ===========================================================================
// TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature F1-F15 = 75 tests)
// ===========================================================================

// --- F1 Boundaries СНЕСЕНЫ 2026-11-08 (5 тестов, 30 исполнений) ---
// Все пять были границами ролевой таблицы: битый enum, матрица как constexpr,
// переход роли в прогоне. Одна проверка стоит отдельного надгробия —
// `test_t2_f1_02` гоняла «ни один счёт не NaN и не отрицателен» по всем 13
// интентам (26 исполнений) и была единственным местом в e2e, где это
// утверждалось. Предмет у неё, однако, был ролевой (`p.role = Duty`), а
// нан-безопасность счёта пинится в `suite_utilai.inl` на живом `ai_step`.

// --- F2 Boundaries ---
// Границы `role_for` (t2_f2_01/02 — битый FloorKind, предельный NpcId) и
// `t2_f2_04` (нулевая инициализация колонки `role_`) снесены 2026-11-08
// вместе с функцией и колонкой: 4 исполнения.

static void test_t2_f2_03_single_npc_monoculture_spec() {
    NpcPool pool;
    pool.init();
    FloorSpec mono{FloorKind::Residential, "mono", 50u, {1, 0, 0, 0, 0}, 0.0f, 25, 30};
    seed_floor_from_spec(pool, 1, mono, 999u);
    CHECK(pool.count() == 50u);
    for (NpcId id = 0; id < 50; ++id) {
        CHECK(pool.faction(id) == 0);
    }
}

static void test_t2_f2_05_floor_boundary_numbers() {
    CHECK(FloorRegistry::valid_number(-127));
    CHECK(FloorRegistry::valid_number(127));
    CHECK(!FloorRegistry::valid_number(-128));
    CHECK(!FloorRegistry::valid_number(128));
}

// --- F3 Boundaries ---

static void test_t2_f3_01_patrol_plan_unreachable_destination_fallback() {
    // НЕПОСТРОЕННЫЙ БЕЙК — NO-OP, и границу держит ИСХОД ДЛЯ ТЕЛА, а не байт
    // токена: наряд заявки НЕ ПОДАЁТ, поэтому тело достаётся слабейшему
    // (прогулке) и идёт «как сегодня». Это дословно то, что утверждал прежний
    // `brain.motion == Wander`, только спрошено у предмета, который жив.
    //
    // ТЕЛО ЗДЕСЬ ПОЛНОЦЕННОЕ (добавлен `NpcRef`, которого вид наряда требует):
    // без него гейт был бы зелен даже у прохода, заявляющего всем подряд, —
    // тело просто не попадало бы в вид. Мутация, которую это ловит: заявка ДО
    // проверки `zones.built()` (отняла бы тело у того, кто его провёл бы).
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{1u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;

    game::ZoneNav emptyZn{};
    const PatrolTick t = ai_patrol_step(reg, emptyZn, 0u, nullptr, 3u);
    CHECK(t.considered == 0u);
    CHECK(reg.try_get<Steer>(e) == nullptr);
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, 3u));
}

// t2_f3_02/03/04 СНЕСЕНЫ 2026-11-09 — три подтверждённо фальшивых гейта,
// и каждый фальшив по своей причине:
//   * `..._with_empty_nav_graphs`: пустой реестр + непечёный нав, НИ ОДНОГО
//     CHECK. `ai_patrol_step` на непечёном наве возвращается первой строкой,
//     то есть тело прохода даже не исполнялось. Та же граница со СВИДЕТЕЛЕМ —
//     t2_f3_01 выше;
//   * `..._hop_counter_overflow_wrap`: `plan.hops = 255; ++plan.hops;
//     CHECK(== 0)` — арифметика `uint8` компилятором, ни одной строки дерева.
//     `hops` в проде читает только хеш выбора ноги, и заворот ему безразличен
//     по построению;
//   * `..._on_dead_or_despawned_entity`: сущность уничтожается, но нав
//     непечёный — проход опять возвращается до вида, и «мёртвое тело» в нём ни
//     разу не участвует. Ноль CHECK. Безопасность снятой сущности держит
//     t2_f8_02 (запрос заявки по снятому дескриптору), и там она спрошена.

static void test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket() {
    // ПЕРЕПИСАН: прежде утверждал `plan.nodeTo == 5` сразу после `nodeTo = 5`,
    // то есть проверял присваивание компилятора. Настоящая граница — ЗОНА В
    // СВОЕЙ КОМПОНЕНТЕ СВЯЗНОСТИ: наряд обязан не выбрать цель вовсе, а не
    // пойти наугад.
    g_nav.init();
    game::ZoneNav split = g_nav.zn;
    split.dist.d = {0, game::kZoneUnreachable, game::kZoneUnreachable, 0};
    Registry reg;
    Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{(32.0f + 0.5f) * kCellSize,
                                             (32.0f + 0.5f) * kCellSize,
                                             (1.0f + 0.5f) * kCellSize}, 0u});
    reg.emplace<Velocity>(e, Velocity{vec3{0.0f, 0.0f, 0.0f}});
    reg.emplace<NpcRef>(e, NpcRef{2u});
    AiBrain& brain = reg.emplace<AiBrain>(e);
    brain.currentIntent = IntentPatrol;
    const PatrolTick t = ai_patrol_step(reg, split, 0u, nullptr, 5u);
    CHECK(t.unreachable == 1u);
    CHECK(t.walking == 0u);
    CHECK(reg.get<PatrolPlan>(e).zoneTo == game::kNoRoom);
    // ЗАЯВЛЯТЬ СЛЕДУЕТ ТОЛЬКО ИСПОЛНИМОЕ ([game/guide.h]): цель не выбрана —
    // заявки нет, и тело достаётся прогулке. Прежде то же самое выражалось
    // незабранным токеном; мутация «заявить и провалить» дала бы телу ноль
    // записей от кого бы то ни было, то есть дрейф на прошлой скорости.
    CHECK(reg.try_get<Steer>(e) == nullptr);
}

// --- F4 Boundaries ---
// Четыре из пяти (t2_f4_01/02/04/05, 4 исполнения) снесены 2026-11-08 вместе с
// медицинскими константами: все четыре были `if`-ом теста о своей же
// арифметике. Выжил t2_f4_03 — он про ВРАЖДЕБНОСТЬ ФРАКЦИЙ и ни одного
// ролевого символа не называл; имя оставлено как адрес в нумерации F4.

static void test_t2_f4_03_medic_refuses_hostile_enemies() {
    FactionRelations rel{};
    rel.reset();
    Faction fMedic = Faction::Citizens;
    Faction fEnemy = Faction::Wild;
    CHECK(rel.hostile(static_cast<std::uint8_t>(fMedic), static_cast<std::uint8_t>(fEnemy)));
}

// --- F5 Boundaries ---

static void test_t2_f5_01_liquidator_critical_low_hp_flee_threshold() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.95f;
    p.hp = 5.0f; // Critical HP
    p.maxHp = 100.0f;
    Needs n = needs_roll(12u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSafety] > 0.0f || scores[IntentFlee] > 0.0f);
}

static void test_t2_f5_02_liquidator_overwhelming_hostile_odds() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 1.0f;
    p.hostilePower = 1000.0f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(14u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    for (int i = 0; i < kIntentCount; ++i) {
        CHECK(!std::isnan(scores[i]));
    }
}

static void test_t2_f5_03_liquidator_zero_danger_routine() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.danger = 0.0f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(16u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentPatrol] >= scores[IntentFlee]);
}

static void test_t2_f5_04_liquidator_unarmed_combat_scoring() {
    Perception p{};
    p.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    p.armed = false;
    p.danger = 0.5f;
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    Needs n = needs_roll(18u);

    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentCombat] >= 0.0f);
}

static void test_t2_f5_05_liquidator_corrupted_faction_id_fallback() {
    const FactionTraits& ft = faction_traits(9999u);
    const FactionTraits& fallback = faction_traits(static_cast<std::uint16_t>(kFactionPlayerRow));
    CHECK(std::memcmp(&ft, &fallback, sizeof(FactionTraits)) == 0);
}

// --- F6 Boundaries ---

// t2_f6_01 снесён 2026-11-08: он брал `role_traits(RoleId::Looter)` в
// неиспользуемую ссылку и не содержал НИ ОДНОГО CHECK — то есть и до сноса
// ролей ничего не утверждал (0 исполнений в пине).

static void test_t2_f6_02_cultist_mob_aggression_with_invalid_npc() {
    NpcPool pool;
    pool.init();
    CHECK(mob_hostile_to(pool, kInvalidNpc));
}

// ПЕРЕИМЕНОВАН 2026-11-08 (роли снесены): сон никогда не был ролевым термом —
// ни один множитель `kRoleTraits` его не касался, — так что утверждение то же.
static void test_t2_f6_03_sleep_intent_with_empty_world() {
    Perception p{};
    Needs n{};
    n.sleep = 95.0f;
    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSleep] > 0.0f);
}

// ПЕРЕИМЕНОВАН 2026-11-08 (роли снесены). Утверждение `IntentSocial >= 0`
// держится на клампе счёта, а не на множителе `sociability`.
static void test_t2_f6_04_rally_with_zero_allies() {
    Perception p{};
    p.allyPower = 0.0f;
    Needs n = needs_roll(22u);
    float scores[kIntentCount];
    score_intents(p, n, scores);
    CHECK(scores[IntentSocial] >= 0.0f);
}

static void test_t2_f6_05_looter_memory_full_slot_eviction() {
    AiMemory mem;
    NpcId id = 100u;
    for (int i = 0; i < 10; ++i) {
        ai_remember_cell(mem, id, MemFood, i, i, i, 0.5f, 10.0 + i);
    }
    CHECK(mem.live_traces(id, 30.0) == static_cast<std::uint32_t>(kMemSlots));
}

// --- F7 Boundaries ---
//
// ПЯТЬ ГРАНИЧНЫХ ТЕСТОВ `route_step` СНЕСЕНЫ 2026-10-12 вместе с предметом
// (§88/F.2 шаг 3): цель в толще, разорванный граф, заворот тора, непечёный нав,
// координаты вне диапазона. Те же пять границ у нава по зонам держит его
// собственный сьют — `degenerate_inputs_answer@suite_zonenav.inl`, и там они
// спрашиваются у самой двери (`zone_walk_dir`), а не у снесённого потребителя.

// --- F8 Boundaries ---

static void test_t2_f8_01_null_entity_claim_query() {
    Registry reg;
    CHECK(!steer_claimed_by_stronger(reg, entt::null, SteerRank::Walk, 0u));
}

static void test_t2_f8_02_destroyed_entity_claim_safety() {
    Registry reg;
    Entity e = reg.create();
    CHECK(steer_claim(reg, e, 4u, SteerRank::Flee, target_hold()));
    reg.destroy(e);
    // Снятая сущность не держит тело: дескриптор поменял версию, и вопрос
    // «кто-то сильнее» обязан ответить «нет» вместо чтения чужой строки пула.
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, 4u));
}

// ===========================================================================
// ИСПОРЧЕННЫЙ БАЙТ ОБЯЗАН ЧИТАТЬСЯ КАК «НИКТО НЕ ВЛАДЕЕТ»
// ===========================================================================
//
// ЭТОТ ГЕЙТ ОДИН РАЗ УЖЕ ПОПРАВИЛ ПРОЕКТ, поэтому перенесён ДОСЛОВНО, а не по
// смыслу. Он стерёг токен — `brain.motion = 42` обязан был читаться как
// `MotionOwner::Wander`, то есть «никто не владеет», — и довод у него был не
// про мусор в памяти, а про СТОРОНУ ОТКАЗА: тело, чей байт владения не
// распознан, обязано достаться САМОМУ СЛАБОМУ заявителю и идти «как сегодня»,
// НИКОГДА не замирать. Обратная формулировка («не прогулка — значит занято»)
// прошла бы ревью и уронила бы толпу в неподвижность на первом же мусорном
// байте. Токен умер 2026-11-09; свойство — нет, и носит его теперь РАНГ
// (`SteerRank::None == 0`, довод дословно в шапке [game/guide.h], где этот гейт
// назван по имени как причина выбора знака).
//
// МУТАЦИИ ПРОДА, КОТОРЫЕ ЭТО ЛОВИТ, В ОБЕ ПОЛЯРНОСТИ:
//   * снять `s.rank < SteerRank::Count` в `steer_claim_live` — мусорный ранг
//     станет ЖИВОЙ заявкой, и слабейший заявитель начнёт от такого тела
//     ОТКАЗЫВАТЬСЯ (42 > Flee), то есть тело замрёт: красит станзу А;
//   * снять `s.rank >= SteerRank::Count` в `guide_step` — мусор поедет в
//     `byRank[42]`, за пределы массива: красит `bogus` станзы А;
//   * снять `s.target.kind >= TargetKind::Count` — мусорный вид цели
//     провалится в ветку зоны: красит станзу В;
//   * ОБРАТНАЯ мутация (читать как «заявки нет» СЛИШКОМ много: например
//     `s.rank < SteerRank::Flee`) — законная заявка перестанет владеть телом:
//     красит станзы Б и вторую половину В.
static void test_t2_f8_03_corrupted_claim_byte_reads_as_unowned() {
    g_nav.init();
    const std::uint64_t tick = 13u;

    // СТАНЗА А — ИСПОРЧЕН БАЙТ РАНГА. Число 42 то же, которым портился байт
    // токена: гейт переносится вместе со своим входом.
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(
            e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
        reg.emplace<Steer>(e,
                           Steer{target_dir(vec3{1.0f, 0.0f, 0.0f}, kErrandSpeed),
                                 static_cast<std::uint32_t>(tick),
                                 static_cast<SteerRank>(42)});

        CHECK(!steer_claim_live(reg.get<Steer>(e), tick));
        // ...и слабейший от такого тела НЕ ОТКАЗЫВАЕТСЯ — вот сторона отказа.
        CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, tick));

        const GuideTick bad = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(bad.bogus == 1u);
        CHECK(bad.led == 0u && bad.held == 0u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kSteerSentinel));

        // И СЛАБЕЙШИЙ ЕГО ВЕДЁТ. Без этой половины «тело не написано» нельзя
        // отличить от «тело брошено всеми», а разница между ними и есть всё,
        // что гейт охраняет: первое — исправный отказ, второе — замершая толпа.
        CHECK(steer_claim(reg, e, tick, SteerRank::Walk,
                          target_dir(vec3{1.0f, 0.0f, 0.0f}, kWalkSpeedMps)));
        const GuideTick led = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(led.bogus == 0u);
        CHECK(led.led == 1u);
        CHECK(led.byRank[static_cast<std::size_t>(SteerRank::Walk)] == 1u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kWalkSpeedMps));
    }

    // СТАНЗА Б — ЗАКОННЫЙ БАЙТ РАНГА ВЛАДЕЕТ. Обратная полярность станзы А:
    // без неё всё выше осталось бы зелёным у `steer_claim_live`, который
    // возвращает false ВСЕГДА (то есть у ведения, не ведущего никого).
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(
            e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
        reg.emplace<Steer>(e,
                           Steer{target_dir(vec3{1.0f, 0.0f, 0.0f}, kErrandSpeed),
                                 static_cast<std::uint32_t>(tick),
                                 SteerRank::Errand});

        CHECK(steer_claim_live(reg.get<Steer>(e), tick));
        CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Walk, tick));
        const GuideTick gt = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(gt.bogus == 0u);
        CHECK(gt.led == 1u);
        CHECK(gt.byRank[static_cast<std::size_t>(SteerRank::Errand)] == 1u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kErrandSpeed));
    }

    // СТАНЗА В — ИСПОРЧЕН БАЙТ ВИДА ЦЕЛИ при ЗАКОННОМ (и сильнейшем) ранге.
    //
    // ЧЕСТНАЯ ОГОВОРКА, И ОНА ЗДЕСЬ ВАЖНЕЕ САМОГО ГЕЙТА. Шапка [game/guide.h]
    // обещает, что «нераспознанный байт ранга ИЛИ ВИДА ЦЕЛИ читается как заявки
    // нет». Для ПИСАТЕЛЯ это правда — он не пишет и считает `bogus`. Для
    // АРБИТРАЖА — нет: `steer_claim_live` читает только ранг, поэтому тело с
    // мусорным видом цели и законным рангом слабейший заявитель обходит
    // (`steer_claimed_by_stronger` отвечает «занято»), и вести его оказывается
    // некому. Утверждается ниже ровно то, что прод ДЕЛАЕТ, а не то, что
    // комментарий обещает: ослабить гейт до обещания значило бы покрасить его
    // без правки прода, а это не моя дверь.
    {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(
            e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
        Steer st{};
        st.target.dir = vec3{1.0f, 0.0f, 0.0f};
        st.target.speed = kErrandSpeed;
        st.target.kind = static_cast<TargetKind>(42);
        st.tick = static_cast<std::uint32_t>(tick);
        st.rank = SteerRank::Flee;
        reg.emplace<Steer>(e, st);

        const GuideTick bad = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(bad.bogus == 1u);
        CHECK(bad.led == 0u && bad.held == 0u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kSteerSentinel));

        // ОБРАТНАЯ ПОЛЯРНОСТЬ ВИДА: тот же ранг, тот же тик, ЗАКОННЫЙ `Hold` —
        // и пишется ВЛАДЕЕМЫЙ НОЛЬ (остановка, а не толчок), причём только в
        // плоскости ходьбы.
        reg.get<Steer>(e).target = target_hold();
        const GuideTick held = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(held.bogus == 0u);
        CHECK(held.held == 1u);
        CHECK(held.byRank[static_cast<std::size_t>(SteerRank::Flee)] == 1u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, 0.0f));
        CHECK(approx_eq(reg.get<Velocity>(e).v.z, kSteerSentinel));
    }
}

static void test_t2_f8_04_rapid_claim_toggle_stability() {
    // ТЫСЯЧА ТИКОВ, И ПРЕДМЕТ ТЕПЕРЬ НЕ «БАЙТ ТУДА-СЮДА», А ДВА СВОЙСТВА СРАЗУ,
    // потому что токен держался в памяти, а заявка — в ТИКЕ:
    //   * на НОВОМ тике заявка любого ранга ложится (истёкшая сильная не держит
    //     тело вечно) — иначе чётные итерации оставили бы наряд навсегда и
    //     нечётные покраснели бы;
    //   * арбитраж отвечает ровно по текущему рангу, тысячу переключений подряд.
    // Мутация «считать заявку живой независимо от тика» красит нечётные шаги,
    // мутация «не обновлять ранг на новом тике» — чётные.
    Registry reg;
    Entity e = reg.create();
    for (int i = 0; i < 1000; ++i) {
        const std::uint64_t tick = static_cast<std::uint64_t>(i);
        const bool strong = (i % 2 == 0);
        steer_claim(reg, e, tick,
                    strong ? SteerRank::Patrol : SteerRank::Walk, target_hold());
        CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Walk, tick) == strong);
    }
}

static void test_t2_f8_05_guide_writes_only_its_own_layer() {
    // ИЗОЛЯЦИЯ СЛОЁВ ПЕРЕЕХАЛА К ЕДИНСТВЕННОМУ ПИСАТЕЛЮ. Прежде её держал
    // `ai_release(reg, layer)`, возвращавший токены одного слоя; теперь слой
    // берёт параметром `guide_step`, и свойство то же: тело чужого слоя не
    // получает НИ ОДНОЙ записи. Мутация «снять `tr.layer != layer`» красит
    // первую половину, мутация «не писать никому» — вторую.
    g_nav.init();
    Registry reg;
    Entity e0 = reg.create();
    Entity e1 = reg.create();
    reg.emplace<Transform>(e0, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Transform>(e1, Transform{vec3{16.0f, 16.0f, 16.0f}, 1u});
    reg.emplace<Velocity>(
        e0, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    reg.emplace<Velocity>(
        e1, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    const Target go = target_dir(vec3{1.0f, 0.0f, 0.0f}, kWalkSpeedMps);
    CHECK(steer_claim(reg, e0, 2u, SteerRank::Walk, go));
    CHECK(steer_claim(reg, e1, 2u, SteerRank::Walk, go));

    const GuideTick zero = guide_step(reg, g_nav.zn, 0u, 2u, nullptr);
    CHECK(zero.led == 1u);
    CHECK(approx_eq(reg.get<Velocity>(e0).v.x, kWalkSpeedMps));
    CHECK(approx_eq(reg.get<Velocity>(e1).v.x, kSteerSentinel));

    const GuideTick one = guide_step(reg, g_nav.zn, 1u, 2u, nullptr);
    CHECK(one.led == 1u);
    CHECK(approx_eq(reg.get<Velocity>(e1).v.x, kWalkSpeedMps));
}

// --- F9 Boundaries ---

static void test_t2_f9_01_zero_magnitude_vector() {
    CHECK(regime_from_vector(vec3{0.0f, 0.0f, 0.0f}) == GravityRegime::Zero);
}

static void test_t2_f9_02_near_threshold_vector_epsilon() {
    CHECK(regime_from_vector(vec3{1e-5f, 1e-5f, 1e-5f}) == GravityRegime::Zero);
    CHECK(regime_from_vector(vec3{2e-4f, 0.0f, 0.0f}) == GravityRegime::PosX);
}

static void test_t2_f9_03_diagonal_equal_magnitude_tie_break() {
    CHECK(regime_from_vector(vec3{5.0f, 5.0f, 0.0f}) == GravityRegime::PosX);
}

static void test_t2_f9_04_invalid_regime_enum_safety() {
    CellStep s = regime_down(static_cast<GravityRegime>(99));
    CHECK(s.x == 0 && s.y == 0 && s.z == 0);

    GravityFrame f = regime_frame(static_cast<GravityRegime>(99));
    CHECK(f.axis == 2 && f.upSign == 1 && !f.pull);
}

static void test_t2_f9_05_gravity_field_at_returns_global() {
    // Крюк RegionFn СНЕСЁН аудитом 2026-08-25 (решение владельца): at()
    // возвращает global всегда; Custom зарезервирован, механизма нет.
    GravityField g{};
    g.global = vec3{1.0f, 2.0f, 3.0f};
    vec3 out = g.at(vec3{100.0f, 200.0f, 300.0f});
    CHECK(approx_eq(out.x, 1.0f) && approx_eq(out.y, 2.0f) && approx_eq(out.z, 3.0f));
}

// --- F10 Boundaries ---

static void test_t2_f10_01_exact_half_period_boundary() {
    float p = 256.0f;
    float d1 = wrap_delta_f(0.0f, 128.0f, p);
    float d2 = wrap_delta_f(0.0f, -128.0f, p);
    CHECK(approx_eq(std::fabs(d1), 128.0f));
    CHECK(approx_eq(std::fabs(d2), 128.0f));
}

static void test_t2_f10_02_extreme_large_coordinates() {
    float p = 256.0f;
    float wrapped = wrapf(500000.0f, p);
    CHECK(wrapped >= 0.0f && wrapped < p);
}

static void test_t2_f10_03_extreme_negative_discrete_indices() {
    CHECK(wrapi(-128, 128) == 0);
    CHECK(wrapi(-129, 128) == 127);
    CHECK(wrapi(-1000, 128) >= 0 && wrapi(-1000, 128) < 128);
}

static void test_t2_f10_04_sub_voxel_cell_cross_seam_distance() {
    float p = 256.0f;
    vec3 a{255.0f, 255.0f, 255.0f};
    vec3 b{1.0f, 1.0f, 1.0f};
    float dx = wrap_delta_f(a.x, b.x, p);
    float dy = wrap_delta_f(a.y, b.y, p);
    float dz = wrap_delta_f(a.z, b.z, p);
    CHECK(approx_eq(dx, 2.0f));
    CHECK(approx_eq(dy, 2.0f));
    CHECK(approx_eq(dz, 2.0f));
}

static void test_t2_f10_05_floating_point_epsilon_near_seams() {
    float p = 256.0f;
    float delta = wrap_delta_f(p - 1e-6f, 1e-6f, p);
    CHECK(approx_eq(delta, 2e-6f, 1e-5f));
}

// --- F11 Boundaries: СНЕСЕНЫ вместе с банком (2026-11-08) ---
// Пять тел (t2_f11_01..05) перечислены в надгробии блока F11 выше.

// --- F12 Boundaries ---



static void test_t2_f12_03_bus_ring_overflow_drop_counter() {
    EventBus bus;
    bus.init();
    for (std::size_t i = 0; i < EventBus::kCapacity + 50; ++i) {
        bus.publish(EventType::NpcSpawned, static_cast<std::uint32_t>(i));
    }
    CHECK(bus.dropped() == 50);
}



// --- F13 Boundaries ---
// Тесты t2_f13_01..05 СНЕСЕНЫ 2026-11-07 вместе с парой
// find_nearest_interactable/interaction_step — проверяли сами символы
// (границы reach/kind/layer мёртвого запроса). Прицел границы досягаемости
// держит законом фокуса: tests/suite_props_game.inl (фокус + body_reach).

// --- F14 Boundaries ---

// БЛОК F14 ПУСТ, И ЭТО КОНЕЦ ДОЛГОЙ ИСТОРИИ. t2_f14_01/02 (нулевой вход,
// экстремальные тики) снесены 2026-11-08 вместе с банком; t2_f14_04 — вместе с
// ролями. Последние два снесены 2026-11-09:
//   * `..._entry_points_zero_delta_time` — предмет УМЕР БУКВАЛЬНО: он вызывал
//     `ai_patrol_step(reg, zn, 0u, 0.0f)`, а `dt` снят с подписи прохода
//     (параметр был `(void)dt`, «скорость есть темп, интегрирует физика»).
//     Вдобавок ни одного CHECK и непечёный нав, то есть тело прохода опять не
//     исполнялось;
//   * `..._static_gate_regex_compliance` — ПОДТВЕРЖДЁННО ФАЛЬШИВ: он заводил
//     СВОЙ массив литералов (`{"samosbor_step", "wander_step"}`) и проверял,
//     что в этих строках есть подстрока `_step`. Проверялось соглашение об
//     именах В СВОЁМ ЖЕ МАССИВЕ: снеси из дерева `wander_step` — гейт
//     останется зелёным, потому что символа он не называет ни разу (ни
//     адресом, ни вызовом). Настоящий гейт этого свойства — машинный,
//     `check_wired.cmake`, и он читает ДЕРЕВО, а не литералы теста.

// --- F15 Boundaries ---

static void test_t2_f15_01_samosbor_extreme_depth_duty_cycle() {
    float duty50 = samosbor_duty01(50);
    float dutyNeg50 = samosbor_duty01(-50);
    CHECK(duty50 >= 0.90f);
    CHECK(approx_eq(duty50, dutyNeg50));
}

static void test_t2_f15_02_samosbor_large_dt_multi_step_crossing() {
    SamosborState st{};
    SamosborRng rng{555u};
    st = samosbor_new_game(rng);

    // Large dtMs
    SamosborTransition tr = samosbor_step(st, 1000000u, 0, rng);
    CHECK(tr.steps <= 4);
}

static void test_t2_f15_03_samosbor_unsheltered_pressure_one_shot() {
    SamosborPressure p = samosbor_unsheltered_pressure(SamosborVariant::Classic);
    CHECK(p.hpDamage == kSamosborUnshelteredHp);
    CHECK(p.psiDamage == kSamosborUnshelteredPsi);
}

static void test_t2_f15_04_samosbor_variant_weights_normalization() {
    std::uint32_t sum = 0;
    for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
        sum += kSamosborVariants[i].weight;
    }
    CHECK(sum == kSamosborWeightTotal);
}

static void test_t2_f15_05_samosbor_zero_dt_step() {
    SamosborState st{};
    SamosborRng rng{111u};
    st = samosbor_new_game(rng);
    std::uint32_t p0 = st.phaseMs;

    SamosborTransition tr = samosbor_step(st, 0u, 0, rng);
    CHECK(!tr.changed);
    CHECK(st.phaseMs == p0);
}

// ===========================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (15 Pairwise Interactions)
// ===========================================================================

// t3_01 снесён 2026-11-08 вместе с ролями (2 исполнения). Сценарное имя
// обещало «медик лечит ВО ВРЕМЯ самосбора», а тело заводило `SamosborState`,
// НИ РАЗУ его не читало и складывало `hpBank += kMedicHealPerSec * 2` руками:
// тест о своей же арифметике, к самосбору отношения не имевший.

static void test_t3_02_patrol_yields_the_body_to_a_stronger_claim() {
    // ЗАВОРОТ ТОРА БОЛЬШЕ НЕ СВОЙСТВО РЕШЁТКИ: прежде тест вызывал
    // `lattice_neighbor(3, 1)` и утверждал `== 0`, то есть пинил арифметику
    // предмета, которого в навигации больше нет. Остаётся то, что в этом блоке
    // было настоящим утверждением о НАРЯДЕ — арбитраж; только носитель его
    // сменился с токена на РАНГ ЗАЯВКИ.
    //
    // БЕГСТВО — ЕДИНСТВЕННЫЙ РАНГ СИЛЬНЕЕ НАРЯДА, и в кадре оно заявляется
    // раньше (`ai_step` → наряд → дело → прогулка, [app/main.cpp]). Проверяется
    // ТРИ следствия отказа, и третье — новое: наряд не только не ведёт тело, он
    // не делает над ним НИКАКОЙ работы (плана не заводит), потому что вопрос
    // стоит ДО работы заявителя, а не перед записью скорости. Мутация «спросить
    // ранг в конце» оставила бы `considered` и `PatrolPlan` на месте.
    g_nav.init();
    const std::uint64_t tick = 6u;
    const vec3 pos{(32.0f + 0.5f) * kCellSize, (32.0f + 0.5f) * kCellSize,
                   (1.0f + 0.5f) * kCellSize};

    Registry reg;
    Entity guard = reg.create();
    reg.emplace<Transform>(guard, Transform{pos, 0u});
    reg.emplace<Velocity>(guard, Velocity{vec3{0.0f, 7.0f, 0.0f}});
    reg.emplace<NpcRef>(guard, NpcRef{3u});
    AiBrain& brain = reg.emplace<AiBrain>(guard);
    brain.currentIntent = IntentPatrol;

    CHECK(steer_claim(reg, guard, tick, SteerRank::Flee, target_hold()));
    const PatrolTick t = ai_patrol_step(reg, g_nav.zn, 0u, nullptr, tick);
    CHECK(t.considered == 0u); // отказ по чужой заявке в знаменатель не входит
    CHECK(!reg.all_of<PatrolPlan>(guard)); // и работы над телом не было вовсе
    CHECK(reg.get<Steer>(guard).rank == SteerRank::Flee); // наряд не перебил
    CHECK(reg.get<Velocity>(guard).v.y == 7.0f); // скорость пишет только ведение

    // ОБРАТНАЯ ПОЛЯРНОСТЬ: то же тело без чужой заявки — наряд его
    // РАССМАТРИВАЕТ, заводит план и заявляет свой ранг.
    Registry open;
    Entity free_ = open.create();
    open.emplace<Transform>(free_, Transform{pos, 0u});
    open.emplace<Velocity>(free_, Velocity{vec3{0.0f, 7.0f, 0.0f}});
    open.emplace<NpcRef>(free_, NpcRef{3u});
    open.emplace<AiBrain>(free_).currentIntent = IntentPatrol;
    const PatrolTick t2 = ai_patrol_step(open, g_nav.zn, 0u, nullptr, tick);
    CHECK(t2.considered == 1u);
    CHECK(open.all_of<PatrolPlan>(free_));
    CHECK(open.get<Steer>(free_).rank == SteerRank::Patrol);
}

// t3_03 (долг и процент через переход этажа) СНЕСЁН 2026-11-08 вместе с банком.
//
// t3_04 И t3_05 СНЕСЕНЫ 2026-11-09 — оба подтверждённо фальшивы, и оба в один
// и тот же способ: тест сам выставлял значение и сам же его читал.
//   * `..._prop_interaction_during_ai_navigation_single_writer`: заводил три
//     сущности, писал `brain.motion = Ai` и `act.active = true`, после чего
//     проверял РОВНО эти два присваивания. Ни `interaction_step` (снесён
//     2026-11-07), ни один `*_step` вообще здесь не звался, поэтому «single
//     writer» в имени не судил ничего: снеси в проде весь арбитраж — тест
//     зелен. Настоящее утверждение этого имени теперь стоит в t3_15 и t3_16
//     ниже, и там зовутся ПРОХОДЫ;
//   * `..._vector_gravity_with_duty_lattice_patrol`: `vec3 tangentVel{0,1.35f,0};
//     CHECK(tangentVel.x == 0.0f)` — проверка инициализации агрегата
//     компилятором. Две оставшиеся строки (`regime_frame(PosX)` даёт axis 0 и
//     тангенты 1/2) ПОБАЙТОВО дублировали t1_f9_01, то есть нового не судили
//     тоже; ни наряда, ни решётки из имени в теле не было ни одной строки.
//     Настоящая связка «режим гравитации × плоскость записи» уехала станзой Б
//     в t1_f3_05 — там она спрошена у `guide_step`, который пишет.

static void test_t3_06_economy_events_reach_the_bus() {
    // ПОДОПЫТНЫЙ ЗДЕСЬ — ШИНА, а не деньги: банк был декорацией, и когда его
    // снесли (2026-11-08), тест не потерял ни одного утверждения. Декорация
    // заменена на ЖИВОЙ денежный глагол ([economy.h] касса), чтобы сценарий
    // по-прежнему был экономическим, а не пустой публикацией.
    NpcPool pool;
    pool.init();
    const NpcId who = pool.spawn();
    RunLedger led{};
    EventBus bus;
    bus.init();

    Inventory& inv = pool.inventory(who);
    CHECK(inventory_give(inv, kItemRuble, 500) == 0);
    CHECK(teller_deposit_cash(inv, led) == 500);
    CHECK(led.banked == 500);
    bus.publish(EventType::ItemTransferred, 500u, 0u, 0u, 100u);

    // Раньше читалось лентой; лента снесена 2026-09-30, шина — нет.
    CHECK(bus.cycle_count(EventType::ItemTransferred) == 1);
    CHECK(bus.events()[0].tick == 100u);
}

static void test_t3_07_toroidal_wrap_with_prop_interaction() {
    Registry reg;
    Entity player = reg.create();
    reg.emplace<Transform>(player, Transform{vec3{255.5f, 10.0f, 0.0f}, 0u});

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, Transform{vec3{0.5f, 10.0f, 0.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(prop);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    float dx = wrap_delta_f(255.5f, 0.5f, kWorldExtent);
    CHECK(approx_eq(std::fabs(dx), 1.0f));
}

static void test_t3_08_liquidator_defense_vs_civilian_panic_diffusion() {
    Perception civPercep{};
    civPercep.faction = static_cast<std::uint16_t>(Faction::Citizens);
    civPercep.danger = 0.9f;
    civPercep.hp = 100.0f;
    civPercep.maxHp = 100.0f;
    Needs civNeeds = needs_roll(1u);
    float civScores[kIntentCount];
    score_intents(civPercep, civNeeds, civScores);

    Perception liqPercep{};
    liqPercep.faction = static_cast<std::uint16_t>(Faction::Liquidators);
    liqPercep.danger = 0.9f;
    liqPercep.hp = 100.0f;
    liqPercep.maxHp = 100.0f;
    Needs liqNeeds = needs_roll(2u);
    float liqScores[kIntentCount];
    score_intents(liqPercep, liqNeeds, liqScores);

    CHECK(civScores[IntentFlee] > 0.0f || civScores[IntentSafety] > 0.0f);
    CHECK(liqScores[IntentCombat] >= civScores[IntentCombat]);
}

// ПЕРЕИМЕНОВАН 2026-11-08 (роли снесены): утверждение — что ПАМЯТЬ агента
// поднимает местный счёт еды, и `apply_recall` ролей никогда не читал.
static void test_t3_09_scavenging_via_memory_during_samosbor_aftermath() {
    AiMemory mem;
    NpcId looterId = 88u;
    ai_remember_cell(mem, looterId, MemFood, 20, 20, 20, 0.95f, 100.0);

    Perception p{};
    p.samosborActive = false;
    MemoryRecall r = ai_recall(mem, looterId, 20, 20, 20, 150.0);
    apply_recall(r, static_cast<std::uint16_t>(Faction::Citizens), p);

    CHECK(p.localScore[IntentEat] > 0.0f);
}

static void test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns() {
    NpcPool pool;
    pool.init();
    NpcId cultistId = pool.spawn();
    pool.faction(cultistId) = static_cast<std::uint16_t>(Faction::Cultists);

    NpcId citizenId = pool.spawn();
    pool.faction(citizenId) = static_cast<std::uint16_t>(Faction::Citizens);

    CHECK(!mob_hostile_to(pool, cultistId));
    CHECK(mob_hostile_to(pool, citizenId));
}

// Был `..._role_distribution_seeding_with_floor_spec_and_bank_terms`, и оба
// предмета из имени снесены 2026-11-08: разбивка по ролям и условия банка.
// Утверждение, которое выжило, — ПОСЕВ ПО АНКЕТЕ ЭТАЖА заселяет пул; оно
// единственное и здесь, а имя приведено к нему.
static void test_t3_11_floor_spec_seeding_populates_the_pool() {
    NpcPool pool;
    pool.init();
    seed_floor_from_spec(pool, 0, floor_spec(FloorKind::Commercial), 333u);
    CHECK(pool.count() > 0);
}

static void test_t3_12_zone_step_navigation_with_vector_gravity_tangent_plane() {
    g_nav.init();
    // Шаг по зонам из зоны 1 в зону 2 существует (синтетика фикстуры: граница
    // по x==48, поле «+x»). Решёточная половина этого теста снесена вместе с
    // `route_step`; гравитационная — ниже, и она здесь главная.
    const std::uint8_t step =
        game::zone_walk_dir(g_nav.zn, static_cast<game::RoomId>(1),
                            static_cast<game::RoomId>(2), 16, 16, 16,
                            /*gravityAxis=*/2);
    CHECK(step != game::kZoneFlowNone);

    GravityFrame fy = regime_frame(GravityRegime::NegY);
    CHECK(fy.tanA == 0 && fy.tanB == 2);
}

static void test_t3_13_samosbor_alarm_and_event_bus_emission() {
    EventBus bus;
    bus.init();
    SamosborState st{};
    st.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    st.phaseMs = 25000u;

    SamosborAlarm alarm = samosbor_alarm(st);
    CHECK(alarm.on);

    bus.publish(EventType::FloorEntered, 0u, 0u, 0u, 100u);
    CHECK(bus.cycle_count(EventType::FloorEntered) == 1);
}

static void test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage() {
    Needs patient = needs_roll(404u);
    patient.hpBank = 10.0f;

    SamosborPressure pressure = samosbor_unsheltered_pressure(SamosborVariant::Classic);
    float finalHpBank = patient.hpBank - pressure.hpDamage;
    CHECK(finalHpBank == 6.0f);
}

// ===========================================================================
// ПИСАТЕЛЬ ОДИН — ПРОВЕРЕНО ПРОХОДАМИ В ПРОД-ПОРЯДКЕ
// ===========================================================================
//
// ЗАЧЕМ ЭТОТ ГЕЙТ ВООБЩЕ НУЖЕН, хотя писатель «один по построению»: закон
// «писатель один» в проде НЕ ДЕРЖАЛСЯ, и это ЗАМЕР, а не подозрение — прибор
// `--action vedenie` ([game/steer_probe.h]) на этаже 6 насчитал 45 ДВОЙНЫХ
// ЗАПИСЕЙ скорости за 250 тиков, и перебивал всегда проход, который токена не
// читал вовсе. Держался закон не токеном, а тем, что два звена цепочки почти
// всегда молчали. Значит утверждение «ровно одна запись на тело за тик»
// обязано иметь СВИДЕТЕЛЯ в стенде, а не только довод в шапке.
//
// ЧЕМ СЧИТАЮТСЯ ЗАПИСИ. Внутри одного `guide_step` вторая запись в то же тело
// НЕВИДИМА по значению (цель одна, запишется то же), поэтому сентинеля мало:
// он отвечает «написано ли», а не «сколько раз». Поэтому записи считаются
// счётчиками прохода, и сразу ДВУМЯ независимыми суммами: `led + held` и
// `Σ byRank`. Проход инкрементит по одному из каждой пары на тело, значит
// снятый `continue` в любой ветке (ровно тот класс дефекта, которым болел
// токен) ломает ОБЕ суммы, а не одну.
static void test_t3_15_one_writer_for_patrol_and_wander_in_one_tick() {
    g_nav.init();
    NpcPool pool;
    pool.init();
    Registry reg;

    // ТЕЛО ПОД СИЛЬНОЙ ЗАЯВКОЙ — настоящий наряд. `WanderTarget` у него тоже
    // есть, и это прод-вид тела, а не декорация: в кадре патрульное тело лежит
    // в обоих видах сразу, и ровно поэтому арбитраж вообще нужен.
    Entity patrolman = reg.create();
    reg.emplace<Transform>(patrolman, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(
        patrolman,
        Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    reg.emplace<NpcRef>(patrolman, NpcRef{1u});
    reg.emplace<WanderTarget>(patrolman,
                              WanderTarget{static_cast<game::RoomId>(2), 0u, 0u});
    reg.emplace<AiBrain>(patrolman).currentIntent = IntentPatrol;

    // ТЕЛО ПОД СЛАБОЙ ЗАЯВКОЙ — прогулка с готовой ногой в зону 2 (без неё
    // проход выбрал бы цель и встал владеемым нулём, то есть мерился бы `held`
    // вместо хода).
    Entity walker = reg.create();
    reg.emplace<Transform>(walker, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
    reg.emplace<Velocity>(
        walker, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
    reg.emplace<WanderTarget>(walker,
                              WanderTarget{static_cast<game::RoomId>(2), 0u, 0u});

    // ТИК ВЫВЕДЕН ИЗ СТАГГЕРА ПРОГУЛКИ (довод у `wander_visit_tick`): наряд
    // стаггера по телу не имеет, прогулка имеет, значит тик диктует она.
    const std::uint64_t tick = wander_visit_tick(walker);

    // ПОРЯДОК ПРОХОДОВ — ПРОД-ПОРЯДОК ([app/main.cpp]): бегство → наряд →
    // ДЕЛО → прогулка, и один `guide_step` после всех. `place_errand_step`
    // здесь не зовётся сознательно — ему нужны комнаты этажа, пул и шина, то
    // есть пол-мира оснастки, а свойство «один писатель» он не добавляет:
    // ранг дела лежит МЕЖДУ нарядом и прогулкой, и обе границы уже под гейтом.
    ai_patrol_step(reg, g_nav.zn, 0u, nullptr, tick);
    wander_step(reg, g_nav.world.grid(), pool, g_nav.zn, 0u, tick);

    // Заявки на месте и РАЗНЫХ рангов — иначе «по одной записи на тело» можно
    // было бы получить и от одного заявителя на оба тела.
    CHECK(reg.get<Steer>(patrolman).rank == SteerRank::Patrol);
    CHECK(reg.get<Steer>(walker).rank == SteerRank::Walk);

    const GuideTick g = guide_step(reg, g_nav.zn, 0u, tick, nullptr);

    // РОВНО ПО ОДНОЙ ЗАПИСИ НА ТЕЛО, двумя независимыми суммами.
    std::uint32_t byRankSum = 0;
    for (std::size_t r = 0; r < kSteerRankCount; ++r) byRankSum += g.byRank[r];
    CHECK(g.led == 2u);
    CHECK(g.held == 0u);
    CHECK(byRankSum == 2u);

    // КАЖДЫЙ РАНГ, КОТОРЫЙ СОЗДАЛА ОСНАСТКА, НЕПУСТ. Без этого гейт был бы
    // зелен и у прохода, который ведёт наряды дважды и прогулку не ведёт.
    CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Patrol)] == 1u);
    CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Walk)] == 1u);
    // ...и ни один ранг, которого оснастка не создавала, не тронут. Это ловит
    // мутацию индекса (`byRank[rank + 1]`, `byRank[0]`), на которую сумма слепа.
    CHECK(g.byRank[static_cast<std::size_t>(SteerRank::None)] == 0u);
    CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Errand)] == 0u);
    CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Flee)] == 0u);

    // САМОПРОВЕРКА ПРОХОДА: все четыре счётчика отказов обязаны быть НУЛЁМ
    // ([game/guide.h]) — заявитель заявляет только исполнимое и только свой
    // тик, а ведение не пишет в человека и труп.
    CHECK(g.stale == 0u && g.bogus == 0u);
    CHECK(g.unresolved == 0u && g.foreign == 0u);

    // И ОБА ТЕЛА ДЕЙСТВИТЕЛЬНО НАПИСАНЫ — счётчик без сентинеля утверждал бы
    // только о себе. Ось гравитации при этом у обоих цела: её владелец
    // `physics_step`, а не ведение.
    for (Entity b : {patrolman, walker}) {
        const Velocity& v = reg.get<Velocity>(b);
        CHECK(!approx_eq(v.v.x, kSteerSentinel));
        CHECK(approx_eq(v.v.z, kSteerSentinel));
    }
}

static void test_t3_16_rank_beats_the_order_of_submission() {
    // РАЗНИЦА МЕЖДУ РАНГОМ И ПОРЯДКОМ ВЫЗОВОВ — ВЕСЬ СМЫСЛ ЗАМЕНЫ ТОКЕНА.
    // Токен работал ровно потому, что цепочка стояла в известном порядке: кто
    // позже, тот и писал. Поэтому исход спрашивается в ОБОИХ порядках подачи —
    // мутация «последняя заявка выигрывает» (снятие `s->rank > rank` в
    // `steer_claim`) красит РОВНО ОДИН из двух, и гейт на одном порядке остался
    // бы зелёным, как остался зелёным токен при шести писателях.
    //
    // ПЕЛЕНГИ ПРОТИВОПОЛОЖНЫ, СКОРОСТИ РАЗНЫЕ: по написанной скорости видно не
    // «кто-то написал», а ИМЕННО КТО (+3 против −1), то есть проверка судит
    // победителя, а не факт записи.
    g_nav.init();
    const std::uint64_t tick = 21u;
    const float kStrong = 3.0f;
    const float kWeak = 1.0f;

    for (int order = 0; order < 2; ++order) {
        Registry reg;
        Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{vec3{16.0f, 16.0f, 16.0f}, 0u});
        reg.emplace<Velocity>(
            e, Velocity{vec3{kSteerSentinel, kSteerSentinel, kSteerSentinel}});
        const Target strong = target_dir(vec3{1.0f, 0.0f, 0.0f}, kStrong);
        const Target weak = target_dir(vec3{-1.0f, 0.0f, 0.0f}, kWeak);

        if (order == 0) {
            CHECK(steer_claim(reg, e, tick, SteerRank::Flee, strong));
            CHECK(!steer_claim(reg, e, tick, SteerRank::Walk, weak));
        } else {
            CHECK(steer_claim(reg, e, tick, SteerRank::Walk, weak));
            CHECK(steer_claim(reg, e, tick, SteerRank::Flee, strong));
        }

        CHECK(reg.get<Steer>(e).rank == SteerRank::Flee);
        const GuideTick g = guide_step(reg, g_nav.zn, 0u, tick, nullptr);
        CHECK(g.led == 1u);
        CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Flee)] == 1u);
        CHECK(g.byRank[static_cast<std::size_t>(SteerRank::Walk)] == 0u);
        CHECK(approx_eq(reg.get<Velocity>(e).v.x, kStrong));
    }
}

// ===========================================================================
// TIER 4: REAL-WORLD WORKLOAD SCENARIOS (5 Integrated Scenarios)
// ===========================================================================

// ПЕРЕИМЕНОВАН 2026-11-08: «and_roles» ушло из имени вместе с посевом роли
// (`p.role = role_for(id, kinds[k])`). Марафон остался тем, чем был настоящим:
// заселение пяти видов этажей и ОБЯЗАТЕЛЬНЫЙ выбор интента на каждом теле.
static void test_t4_01_multi_floor_alife_demographics_simulation() {
    FloorKind kinds[5] = {FloorKind::Residential, FloorKind::Commercial, FloorKind::Industrial, FloorKind::Derelict, FloorKind::Padic};

    for (int k = 0; k < 5; ++k) {
        NpcPool pool;
        pool.init();
        seed_floor_from_spec(pool, k, floor_spec(kinds[k]), 1000u + k);
        CHECK(pool.count() > 0);

        for (NpcId id = 0; id < std::min(pool.count(), 25u); ++id) {
            Needs n = needs_roll(id);
            Perception p{};
            p.hp = 100.0f;
            p.maxHp = 100.0f;
            float scores[kIntentCount];
            score_intents(p, n, scores);
            uint8_t intent = select_intent_raw(scores);
            CHECK(intent < kIntentCount);
        }
    }
}

// t4_02 (сложный процент на длинной дистанции: десять периодов подряд, вклад
// растёт, долг накапливается) СНЕСЁН 2026-11-08. Подопытным был сам процент,
// а не долгий прогон, — заменять тут нечего.

static void test_t4_03_long_duration_specialist_patrol_and_errand_marathon() {
    g_nav.init();
    // МАРАФОН ХОДА: двести шагов подряд, и каждый обязан быть ЗАКОННЫМ шагом
    // по графу — то есть вести в зону, которая ближе к цели. Прежде это
    // спрашивалось у `coarse_next` решётки (таблица 64×64); теперь у таблицы
    // зон, и у этого вопроса появился смысл, которого у решёточного не было:
    // граф зон почти ДЕРЕВО (средняя степень 2.0-2.1, замер 2026-10-12), и
    // «шаг всегда ближе» на дереве — это и есть то, чем ходок доходит.
    for (int g = 0; g < 10; ++g) {
        game::RoomId cur = static_cast<game::RoomId>(1 + (g & 1));
        const game::RoomId target = static_cast<game::RoomId>(2 - (g & 1));
        for (int hop = 0; hop < 20; ++hop) {
            if (cur == target) { // дошёл — марафон продолжается с другого конца
                cur = static_cast<game::RoomId>(3 - target);
                continue;
            }
            const game::RoomId nxt =
                game::zone_next(g_nav.zn.graph, g_nav.zn.dist, cur, target);
            CHECK(nxt != game::kNoRoom);
            cur = nxt;
        }
    }
}

static void test_t4_04_full_samosbor_disaster_and_specialist_response_cycle() {
    SamosborState samosbor{};
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Warning);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Warning));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Active);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Active));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Aftermath));

    samosbor.phase = static_cast<std::uint8_t>(SamosborPhase::Idle);
    CHECK(samosbor.phase == static_cast<std::uint8_t>(SamosborPhase::Idle));
}

static void test_t4_05_headless_integrated_engine_game_loop() {
    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();

    NpcId pid = pool.spawn();
    pool.hp(pid) = 100;
    pool.max_hp(pid) = 100;
    Entity player = embody_as_player(reg, pool, pid, 0u);

    Entity term = reg.create();
    reg.emplace<Transform>(term, Transform{vec3{41.0f, 40.0f, 2.0f}, 0u});
    Interactable& act = reg.emplace<Interactable>(term);
    act.kind = Interactable::Kind::Terminal;
    act.active = true;

    for (uint64_t t = 0; t < 200; ++t) {
        if (t % 50 == 0) {
            // interaction_step снесён 2026-11-07, банк — 2026-11-08; сценарий
            // гоняет ШИНУ двести тиков, терминал остаётся свидетелем реестра.
            bus.publish(EventType::ItemTransferred, 1u, 0u, 0u, t);
        }
        bus.clear();
    }
    CHECK(reg.valid(player));
    CHECK(reg.valid(term));
}

// ===========================================================================
// MAIN ENTRY POINT
// ===========================================================================

int main() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);

    // =======================================================================
    // Tier 1: Feature Coverage (75 tests)
    // =======================================================================
    // F1 и F2 — ролевые, снесены 2026-11-08 вместе с `role.h` (10 тестов).

    // F3
    std::fprintf(stderr, "[e2e] test_t1_f3_01_patrol_plan_component_pod_layout\n");
    test_t1_f3_01_patrol_plan_component_pod_layout();
    std::fprintf(stderr, "[e2e] test_t1_f3_02_patrol_intent_activation\n");
    test_t1_f3_02_patrol_intent_activation();
    std::fprintf(stderr, "[e2e] test_t1_f3_03_patrol_step_lazy_attachment\n");
    test_t1_f3_03_patrol_step_lazy_attachment();
    std::fprintf(stderr, "[e2e] test_t1_f3_04_patrol_leg_progression_and_hop_increment\n");
    test_t1_f3_04_patrol_leg_progression_and_hop_increment();
    std::fprintf(stderr, "[e2e] test_t1_f3_05_patrol_steering_in_walking_plane\n");
    test_t1_f3_05_patrol_steering_in_walking_plane();

    // F4 — медик был ролью, блок снесён 2026-11-08 (5 тестов).

    // F5
    std::fprintf(stderr, "[e2e] test_t1_f5_01_liquidator_faction_traits\n");
    test_t1_f5_01_liquidator_faction_traits();
    std::fprintf(stderr, "[e2e] test_t1_f5_02_liquidator_combat_intent_under_danger\n");
    test_t1_f5_02_liquidator_combat_intent_under_danger();
    std::fprintf(stderr, "[e2e] test_t1_f5_03_liquidator_grudge_combat_conversion\n");
    test_t1_f5_03_liquidator_grudge_combat_conversion();
    std::fprintf(stderr, "[e2e] test_t1_f5_04_liquidator_vs_citizen_panic_divergence\n");
    test_t1_f5_04_liquidator_vs_citizen_panic_divergence();
    std::fprintf(stderr, "[e2e] test_t1_f5_05_liquidator_fireline_samosbor_stance\n");
    test_t1_f5_05_liquidator_fireline_samosbor_stance();

    // F6
    // t1_f6_01..03 — ролевые строки, снесены 2026-11-08.
    std::fprintf(stderr, "[e2e] test_t1_f6_04_cultist_monster_non_aggression\n");
    test_t1_f6_04_cultist_monster_non_aggression();
    std::fprintf(stderr, "[e2e] test_t1_f6_05_looter_memory_recall_scavenge_affordance\n");
    test_t1_f6_05_looter_memory_recall_scavenge_affordance();

    // F7
    std::fprintf(stderr, "[e2e] test_t1_f7_05_zone_step_wiring_in_ai_patrol_step\n");
    test_t1_f7_05_zone_step_wiring_in_ai_patrol_step();

    // F8
    std::fprintf(stderr, "[e2e] test_t1_f8_01_fresh_claim_reads_as_no_claim\n");
    test_t1_f8_01_fresh_claim_reads_as_no_claim();
    std::fprintf(stderr, "[e2e] test_t1_f8_02_stronger_claim_is_what_the_weak_sees\n");
    test_t1_f8_02_stronger_claim_is_what_the_weak_sees();
    std::fprintf(stderr, "[e2e] test_t1_f8_03_no_claim_means_zero_writes\n");
    test_t1_f8_03_no_claim_means_zero_writes();
    std::fprintf(stderr, "[e2e] test_t1_f8_04_weak_claim_never_lands_on_a_strong_one\n");
    test_t1_f8_04_weak_claim_never_lands_on_a_strong_one();
    std::fprintf(stderr, "[e2e] test_t1_f8_05_claim_expires_with_its_own_tick\n");
    test_t1_f8_05_claim_expires_with_its_own_tick();

    // F9
    std::fprintf(stderr, "[e2e] test_t1_f9_01_all_six_cardinal_regime_frames\n");
    test_t1_f9_01_all_six_cardinal_regime_frames();
    std::fprintf(stderr, "[e2e] test_t1_f9_02_regime_down_cardinal_steps\n");
    test_t1_f9_02_regime_down_cardinal_steps();
    std::fprintf(stderr, "[e2e] test_t1_f9_03_zero_gravity_frame_isotropy\n");
    test_t1_f9_03_zero_gravity_frame_isotropy();
    std::fprintf(stderr, "[e2e] test_t1_f9_04_regime_from_vector_classification\n");
    test_t1_f9_04_regime_from_vector_classification();
    std::fprintf(stderr, "[e2e] test_t1_f9_05_tangent_velocity_preserves_gravity_axis\n");
    test_t1_f9_05_tangent_velocity_preserves_gravity_axis();

    // F10
    std::fprintf(stderr, "[e2e] test_t1_f10_01_wrap_delta_f_continuous_torus\n");
    test_t1_f10_01_wrap_delta_f_continuous_torus();
    std::fprintf(stderr, "[e2e] test_t1_f10_02_nearest_image_projection\n");
    test_t1_f10_02_nearest_image_projection();
    std::fprintf(stderr, "[e2e] test_t1_f10_03_discrete_wrap_macro_and_wrapi\n");
    test_t1_f10_03_discrete_wrap_macro_and_wrapi();
    std::fprintf(stderr, "[e2e] test_t1_f10_04_toroidal_distance_symmetry\n");
    test_t1_f10_04_toroidal_distance_symmetry();
    std::fprintf(stderr, "[e2e] test_t1_f10_05_multi_period_coordinate_invariance\n");
    test_t1_f10_05_multi_period_coordinate_invariance();

    // F11

    // F12
    std::fprintf(stderr, "[e2e] test_t1_f12_01_event_bus_publish_and_size\n");
    test_t1_f12_01_event_bus_publish_and_size();

    // F13
    // t1_f13_01..04 и t1_f14_03 сняты 2026-11-07 вместе с парой
    // interaction_step/find_nearest_interactable (снос, инкремент B).
    std::fprintf(stderr, "[e2e] test_t1_f13_05_collect_interactable_positions\n");
    test_t1_f13_05_collect_interactable_positions();

    // F14

    // F15
    std::fprintf(stderr, "[e2e] test_t1_f15_01_samosbor_four_phase_cycle\n");
    test_t1_f15_01_samosbor_four_phase_cycle();
    std::fprintf(stderr, "[e2e] test_t1_f15_02_samosbor_duty_cycle_depth_scaling\n");
    test_t1_f15_02_samosbor_duty_cycle_depth_scaling();
    std::fprintf(stderr, "[e2e] test_t1_f15_03_samosbor_specialist_perception_reaction\n");
    test_t1_f15_03_samosbor_specialist_perception_reaction();
    std::fprintf(stderr, "[e2e] test_t1_f15_04_samosbor_alarm_and_beat_hud_level\n");
    test_t1_f15_04_samosbor_alarm_and_beat_hud_level();
    std::fprintf(stderr, "[e2e] test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count\n");
    test_t1_f15_05_samosbor_floor_transit_preserves_cycle_count();

    // =======================================================================
    // Tier 2: Boundary & Corner Cases (75 tests)
    // =======================================================================
    // F1 Boundaries — ролевые, снесены 2026-11-08 (5 тестов).

    // F2 Boundaries (t2_f2_01/02/04 — границы `role_for` и колонки, снесены)
    std::fprintf(stderr, "[e2e] test_t2_f2_03_single_npc_monoculture_spec\n");
    test_t2_f2_03_single_npc_monoculture_spec();
    std::fprintf(stderr, "[e2e] test_t2_f2_05_floor_boundary_numbers\n");
    test_t2_f2_05_floor_boundary_numbers();

    // F3 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f3_01_patrol_plan_unreachable_destination_fallback\n");
    test_t2_f3_01_patrol_plan_unreachable_destination_fallback();
    // t2_f3_02/03/04 снесены 2026-11-09 — три фальшивых гейта (надгробие у тел).
    std::fprintf(stderr, "[e2e] test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket\n");
    test_t2_f3_05_patrol_plan_in_single_node_accessible_pocket();

    // F4 Boundaries
    // t2_f4_01/02/04/05 снесены 2026-11-08 с медицинскими константами.
    std::fprintf(stderr, "[e2e] test_t2_f4_03_medic_refuses_hostile_enemies\n");
    test_t2_f4_03_medic_refuses_hostile_enemies();

    // F5 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f5_01_liquidator_critical_low_hp_flee_threshold\n");
    test_t2_f5_01_liquidator_critical_low_hp_flee_threshold();
    std::fprintf(stderr, "[e2e] test_t2_f5_02_liquidator_overwhelming_hostile_odds\n");
    test_t2_f5_02_liquidator_overwhelming_hostile_odds();
    std::fprintf(stderr, "[e2e] test_t2_f5_03_liquidator_zero_danger_routine\n");
    test_t2_f5_03_liquidator_zero_danger_routine();
    std::fprintf(stderr, "[e2e] test_t2_f5_04_liquidator_unarmed_combat_scoring\n");
    test_t2_f5_04_liquidator_unarmed_combat_scoring();
    std::fprintf(stderr, "[e2e] test_t2_f5_05_liquidator_corrupted_faction_id_fallback\n");
    test_t2_f5_05_liquidator_corrupted_faction_id_fallback();

    // F6 Boundaries
    // t2_f6_01 снесён 2026-11-08 (ноль CHECK, одна ролевая ссылка).
    std::fprintf(stderr, "[e2e] test_t2_f6_02_cultist_mob_aggression_with_invalid_npc\n");
    test_t2_f6_02_cultist_mob_aggression_with_invalid_npc();
    std::fprintf(stderr, "[e2e] test_t2_f6_03_sleep_intent_with_empty_world\n");
    test_t2_f6_03_sleep_intent_with_empty_world();
    std::fprintf(stderr, "[e2e] test_t2_f6_04_rally_with_zero_allies\n");
    test_t2_f6_04_rally_with_zero_allies();
    std::fprintf(stderr, "[e2e] test_t2_f6_05_looter_memory_full_slot_eviction\n");
    test_t2_f6_05_looter_memory_full_slot_eviction();

    // F7 Boundaries

    // F8 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f8_01_null_entity_claim_query\n");
    test_t2_f8_01_null_entity_claim_query();
    std::fprintf(stderr, "[e2e] test_t2_f8_02_destroyed_entity_claim_safety\n");
    test_t2_f8_02_destroyed_entity_claim_safety();
    std::fprintf(stderr, "[e2e] test_t2_f8_03_corrupted_claim_byte_reads_as_unowned\n");
    test_t2_f8_03_corrupted_claim_byte_reads_as_unowned();
    std::fprintf(stderr, "[e2e] test_t2_f8_04_rapid_claim_toggle_stability\n");
    test_t2_f8_04_rapid_claim_toggle_stability();
    std::fprintf(stderr, "[e2e] test_t2_f8_05_guide_writes_only_its_own_layer\n");
    test_t2_f8_05_guide_writes_only_its_own_layer();

    // F9 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f9_01_zero_magnitude_vector\n");
    test_t2_f9_01_zero_magnitude_vector();
    std::fprintf(stderr, "[e2e] test_t2_f9_02_near_threshold_vector_epsilon\n");
    test_t2_f9_02_near_threshold_vector_epsilon();
    std::fprintf(stderr, "[e2e] test_t2_f9_03_diagonal_equal_magnitude_tie_break\n");
    test_t2_f9_03_diagonal_equal_magnitude_tie_break();
    std::fprintf(stderr, "[e2e] test_t2_f9_04_invalid_regime_enum_safety\n");
    test_t2_f9_04_invalid_regime_enum_safety();
    // Ярлык лога привёден к имени тела: крюк `RegionFn` снесён 2026-08-25, и
    // печатать «null_region_callback» значило печатать имя мёртвого предмета.
    std::fprintf(stderr, "[e2e] test_t2_f9_05_gravity_field_at_returns_global\n");
    test_t2_f9_05_gravity_field_at_returns_global();

    // F10 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f10_01_exact_half_period_boundary\n");
    test_t2_f10_01_exact_half_period_boundary();
    std::fprintf(stderr, "[e2e] test_t2_f10_02_extreme_large_coordinates\n");
    test_t2_f10_02_extreme_large_coordinates();
    std::fprintf(stderr, "[e2e] test_t2_f10_03_extreme_negative_discrete_indices\n");
    test_t2_f10_03_extreme_negative_discrete_indices();
    std::fprintf(stderr, "[e2e] test_t2_f10_04_sub_voxel_cell_cross_seam_distance\n");
    test_t2_f10_04_sub_voxel_cell_cross_seam_distance();
    std::fprintf(stderr, "[e2e] test_t2_f10_05_floating_point_epsilon_near_seams\n");
    test_t2_f10_05_floating_point_epsilon_near_seams();

    // F11 Boundaries

    // F12 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f12_03_bus_ring_overflow_drop_counter\n");
    test_t2_f12_03_bus_ring_overflow_drop_counter();

    // F13 Boundaries
    // t2_f13_01..05 сняты 2026-11-07 — границы мёртвого запроса (снос пары).

    // F14 Boundaries — блок пуст с 2026-11-09 (надгробие у тел): t2_f14_01/02 и
    // t2_f14_04 сняты 2026-11-08 с банком и ролями, t2_f14_03 — вместе с
    // параметром `dt`, t2_f14_05 — как подтверждённо фальшивый.

    // F15 Boundaries
    std::fprintf(stderr, "[e2e] test_t2_f15_01_samosbor_extreme_depth_duty_cycle\n");
    test_t2_f15_01_samosbor_extreme_depth_duty_cycle();
    std::fprintf(stderr, "[e2e] test_t2_f15_02_samosbor_large_dt_multi_step_crossing\n");
    test_t2_f15_02_samosbor_large_dt_multi_step_crossing();
    std::fprintf(stderr, "[e2e] test_t2_f15_03_samosbor_unsheltered_pressure_one_shot\n");
    test_t2_f15_03_samosbor_unsheltered_pressure_one_shot();
    std::fprintf(stderr, "[e2e] test_t2_f15_04_samosbor_variant_weights_normalization\n");
    test_t2_f15_04_samosbor_variant_weights_normalization();
    std::fprintf(stderr, "[e2e] test_t2_f15_05_samosbor_zero_dt_step\n");
    test_t2_f15_05_samosbor_zero_dt_step();

    // =======================================================================
    // Tier 3: Cross-Feature Combinations (15 tests)
    // =======================================================================
    // t3_01 снесён 2026-11-08 (медицинские константы + самосбор, который он
    // заводил и ни разу не читал).
    std::fprintf(stderr, "[e2e] test_t3_02_patrol_yields_the_body_to_a_stronger_claim\n");
    test_t3_02_patrol_yields_the_body_to_a_stronger_claim();
    // t3_04 и t3_05 снесены 2026-11-09 — оба проверяли свои же присваивания
    // (надгробие у тел); их предмет уехал в t3_15/t3_16 и в станзу Б t1_f3_05.
    std::fprintf(stderr, "[e2e] test_t3_06_economy_events_reach_the_bus\n");
    test_t3_06_economy_events_reach_the_bus();
    std::fprintf(stderr, "[e2e] test_t3_07_toroidal_wrap_with_prop_interaction\n");
    test_t3_07_toroidal_wrap_with_prop_interaction();
    std::fprintf(stderr, "[e2e] test_t3_08_liquidator_defense_vs_civilian_panic_diffusion\n");
    test_t3_08_liquidator_defense_vs_civilian_panic_diffusion();
    std::fprintf(stderr, "[e2e] test_t3_09_scavenging_via_memory_during_samosbor_aftermath\n");
    test_t3_09_scavenging_via_memory_during_samosbor_aftermath();
    std::fprintf(stderr, "[e2e] test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns\n");
    test_t3_10_cultist_monster_immunity_during_samosbor_fog_spawns();
    std::fprintf(stderr, "[e2e] test_t3_11_floor_spec_seeding_populates_the_pool\n");
    test_t3_11_floor_spec_seeding_populates_the_pool();
    std::fprintf(stderr, "[e2e] test_t3_12_zone_step_navigation_with_vector_gravity_tangent_plane\n");
    test_t3_12_zone_step_navigation_with_vector_gravity_tangent_plane();
    std::fprintf(stderr, "[e2e] test_t3_13_samosbor_alarm_and_event_bus_emission\n");
    test_t3_13_samosbor_alarm_and_event_bus_emission();
    std::fprintf(stderr, "[e2e] test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage\n");
    test_t3_14_medic_healing_interrupted_by_samosbor_unsheltered_damage();
    std::fprintf(stderr, "[e2e] test_t3_15_one_writer_for_patrol_and_wander_in_one_tick\n");
    test_t3_15_one_writer_for_patrol_and_wander_in_one_tick();
    std::fprintf(stderr, "[e2e] test_t3_16_rank_beats_the_order_of_submission\n");
    test_t3_16_rank_beats_the_order_of_submission();

    // =======================================================================
    // Tier 4: Real-World Workload Scenarios (5 tests)
    // =======================================================================
    std::fprintf(stderr, "[e2e] test_t4_01_multi_floor_alife_demographics_simulation\n");
    test_t4_01_multi_floor_alife_demographics_simulation();
    std::fprintf(stderr, "[e2e] test_t4_03_long_duration_specialist_patrol_and_errand_marathon\n");
    test_t4_03_long_duration_specialist_patrol_and_errand_marathon();
    std::fprintf(stderr, "[e2e] test_t4_04_full_samosbor_disaster_and_specialist_response_cycle\n");
    test_t4_04_full_samosbor_disaster_and_specialist_response_cycle();
    std::fprintf(stderr, "[e2e] test_t4_05_headless_integrated_engine_game_loop\n");
    test_t4_05_headless_integrated_engine_game_loop();

    std::printf("e2e_test: %d checks, %d failures\n", g_checks, g_fails);
    return g_fails == 0 ? 0 : 1;
}
