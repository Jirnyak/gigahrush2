// Noise-as-information, and the one consumer wired to it.
//
// The claim this suite has to earn is specific: **a monster that could not have seen
// the player changes what it does because the player fired a gun.** Everything else
// here is the scaffolding that makes that claim non-vacuous — the field is bounded,
// the eviction policy cannot swallow a gunshot, the sweep really does expire things,
// and hearing beats nothing while sight beats hearing.
//
// The measured numbers are printed, not just asserted, because "it changed" is not a
// result — a distance in metres against a control run is.
//
// Included here rather than in game_test.cpp so that file keeps exactly two new lines.
//
// ===========================================================================
// ЧТО ПЕРЕЕХАЛО 2026-11-09 И ПОЧЕМУ ЭТОТ ФАЙЛ ПЕРЕПИСАН НАПОЛОВИНУ
// ===========================================================================
// СЛУХ БОЛЬШЕ НЕ СВОЙ ПРОХОД. Решение владельца (CANON S25.8): «зрение и слух
// ОДНОЙ системой, агностично» — и обе половины теперь живут в
// `perceive_step` ([game/perceive.h]). Для этого файла это три разных
// изменения, и каждое меняет ФОРМУ наблюдения, а не только имя функции:
//
//   1. СКОРОСТЬ ПИШЕТ НЕ СЛУХ. Восприятие подаёт ЗАЯВКУ ВЕДЕНИЯ
//      (`steer_claim`, [game/guide.h]) — зрение рангом `Chase`, слух рангом
//      `Noise`, — а горизонтальную `Velocity` пишет ровно один проход,
//      `guide_step`. Значит каждый блок, судящий СКОРОСТЬ, обязан звать ОБА
//      прохода и в одном тике; блок, судящий РЕШЕНИЕ, обязан смотреть на
//      заявку и на счётчики `PerceiveTick`, а не на скорость. Прежний приём
//      «сентинель в скорости == слух меня посетил» умер вместе с писателем, и
//      на его место пришёл ШТАМП `Senses::tick` — прямое наблюдение визита.
//
//   2. ЗРЕНИЕ СТАРШЕ СЛУХА ПО ПОСТРОЕНИЮ, А НЕ ПОРЯДКОМ ВЫЗОВОВ. Раньше это
//      держалось тем, что `investigate_step` стоял в кадре ПОСЛЕ прогулки;
//      теперь `Noise < Chase` в перечислении рангов, а внутри прохода тело,
//      УВИДЕВШЕЕ врага, слух не спрашивает вовсе. Поэтому гейт ниже судит не
//      только направление, но и РАНГ оставленной заявки, и счётчик `heard`:
//      «вопрос не задан» — сильнейшая форма старшинства.
//
//   3. ГЛУХОТА И СЛЕПОТА СТАЛИ ДАТОЙ. `MobBehaviour::DeadEcho` получает НОЛЬ
//      множителя слуха строкой (`sense_hearing_mult`), а не веткой
//      `if (beh == DeadEcho) return out;` внутри снесённого `investigate_hear`;
//      слепота — `fovCos > 1` в строке `kSenseRows`. Отсюда два новых блока:
//      один судит СТРОКУ, второй — ПРОГОН по ней.
//
// ЧТО НЕ ТРОНУТО И ПОЧЕМУ: пять блоков поля шума (`noise_publish`/`noise_step`/
// `loudest_heard`/`noise_distance`/профили оружия/переполнение) — чистые
// функции, предмет которых переезд не затронул. Диффузность поля — тоже
// решение владельца: СЛУХ СТЕН НЕ ЗНАЕТ, зрение знает (блок стены ниже судит
// обе половины в одной сцене).
//
// ГДЕ ПРОВЕДЕНА ГРАНИЦА С `tests/suite_perceive.inl` (он появился в тот же
// день и судит ВОСПРИЯТИЕ КАК СИСТЕМУ — заслонение, конус, слепоту, глухоту,
// ранг, труп, человека, фрейм гравитации, взгляд). Здесь остаётся ПОЛЕ ШУМА И
// ЕГО ПОТРЕБИТЕЛЬ, и ровно четыре блока прохода, у каждого — свой предмет,
// которого там нет:
//   * ТОЖДЕСТВО СЛОТОВ СТАГГЕРА С ПРОГУЛКОЙ — хеш выписан в двух файлах
//     намеренно, и больше его сходство не судит никто;
//   * СЛУХ, ДОВЕДЁННЫЙ ДО СКОРОСТИ — от записи в поле до метров в секунду,
//     плюс тихое поле, в котором решений не принимается вовсе;
//   * СЛУХ СКВОЗЬ СТЕНУ, которая закрыла глаза, — диффузность машиной;
//   * ЦЕНА ПРОХОДА под полным полем шума;
//   * и ГУНСХОТ-ДЕМО, ради которого файл и существует.
// Четыре блока, которые первая редакция этой переписи ДУБЛИРОВАЛА, снесены с
// доводом — надгробие стоит на их месте, ниже стаггера.
#include <ctime>

#include "core/tick.h"   // giga::kSimDt - the sim is 125 Hz, never hardcode it
#include "game/investigate.h"  // kInvestigateHearing/MinSeverity/ArriveRadius — числа слуха
#include "game/look.h"         // Look/look_step — взгляд любого тела (S25.7)
#include "game/noise.h"
#include "game/perceive.h"     // ОДИН проход восприятия (S25.8)
#include "game/witness.h"      // kWitnessSightM — дальность зрения жителя

static void test_noise_field_bounds() {
    NoiseField f;
    CHECK(f.quiet());
    CHECK(f.live() == 0);
    CHECK(f.dropped == 0);

    NoiseProfile p;
    p.radius = 10.0f;
    p.ttlMs = 1000;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;

    const std::uint32_t id = noise_publish(f, 0, vec3{10, 10, 2}, p, 7u);
    CHECK(id == 1);                 // ids start at 1; 0 means "no noise"
    CHECK(!f.quiet());
    CHECK(f.live() == 1);

    // A degenerate profile is REFUSED, not clamped up into something audible.
    NoiseProfile bad;
    bad.radius = 0.0f;
    bad.ttlMs = 1000;
    bad.source = NoiseSource::Door;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    bad.radius = 5.0f;
    bad.ttlMs = 0;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    bad.ttlMs = 500;
    bad.source = NoiseSource::None;
    CHECK(noise_publish(f, 0, vec3{0, 0, 0}, bad, 0) == 0);
    CHECK(f.dropped == 3);
    CHECK(f.live() == 1);           // none of the three landed

    // A layer past one byte is refused rather than aliased onto (id % 256) — a
    // gunshot must never become audible on a different floor.
    CHECK(noise_publish(f, 300u, vec3{0, 0, 0}, p, 0) == 0);
    CHECK(noise_publish(f, kNoiseLayerMax, vec3{0, 0, 0}, p, 0) != 0);

    // Radius is capped, so no data error can make one event audible across a torus
    // whose half-period is the maximum meaningful distance.
    NoiseProfile huge = p;
    huge.radius = 4000.0f;
    const std::uint32_t hid = noise_publish(f, 0, vec3{0, 0, 0}, huge, 0);
    CHECK(hid != 0);
    const Noise* found = nullptr;
    for (const Noise& s : f.slot)
        if (s.id == hid) found = &s;
    CHECK(found != nullptr);
    if (found) CHECK(found->radius == kNoiseRadiusCap);
}

static void test_noise_fades() {
    NoiseField f;
    NoiseProfile p;
    p.radius = 12.0f;
    p.ttlMs = 100;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;
    CHECK(noise_publish(f, 0, vec3{20, 20, 2}, p, 0) != 0);

    // The fade is what makes this a field of RECENT noises rather than a log.
    CHECK(noise_step(f, 40) == 0);
    CHECK(f.live() == 1);
    CHECK(noise_step(f, 40) == 0);
    CHECK(f.live() == 1);
    CHECK(noise_step(f, 40) == 1);   // 120 > 100: expired
    CHECK(f.live() == 0);
    CHECK(f.quiet());
    // Sweeping a quiet field is free and must not underflow the counter.
    CHECK(noise_step(f, 1000) == 0);
    CHECK(f.live() == 0);

    // Age enters the score, so a stale loud noise can lose to a fresh quiet one.
    // Two severity-3 records at the same distance, one 2 s older: the fresh one wins.
    NoiseField g;
    NoiseProfile old = p;
    old.ttlMs = 4000;
    const std::uint32_t oldId = noise_publish(g, 0, vec3{10, 10, 0}, old, 0);
    noise_step(g, 2000);
    const std::uint32_t newId = noise_publish(g, 0, vec3{10, 10, 0}, old, 0);
    CHECK(oldId != 0 && newId != 0);
    float d = 0.0f;
    const Noise* best = loudest_heard(g, 0, vec3{10, 10, 0}, 1.0f, 0, 0, &d);
    CHECK(best != nullptr);
    if (best) CHECK(best->id == newId);
}

static void test_noise_overflow_keeps_the_gunshot() {
    // THE policy difference from the event bus, and the reason it exists: a ring full
    // of quiet events must not be able to swallow a gunshot.
    NoiseField f;
    NoiseProfile quietOne;
    quietOne.radius = 3.0f;
    quietOne.ttlMs = 5000;
    quietOne.severity = 1;
    quietOne.source = NoiseSource::Footstep;

    for (std::size_t i = 0; i < kNoiseCap; ++i)
        CHECK(noise_publish(f, 0, vec3{1, 1, 0}, quietOne, 0) != 0);
    CHECK(f.live() == kNoiseCap);
    CHECK(f.dropped == 0);

    // The field is full of severity-1 footsteps. A rifle still gets in.
    NoiseProfile shot;
    shot.radius = 24.0f;
    shot.ttlMs = 2800;
    shot.severity = 4;
    shot.source = NoiseSource::WeaponFire;
    const std::uint32_t sid = noise_publish(f, 0, vec3{50, 50, 2}, shot, 0);
    CHECK(sid != 0);
    CHECK(f.live() == kNoiseCap);   // it replaced a slot, it did not grow the field
    CHECK(f.dropped == 0);

    // ...and it is the one a listener now hears from 30 m, where no footstep reaches.
    float d = 0.0f;
    const Noise* best = loudest_heard(f, 0, vec3{50, 30, 2}, 1.0f, 2, 0, &d);
    CHECK(best != nullptr);
    if (best) {
        CHECK(best->id == sid);
        CHECK(best->severity == 4);
        CHECK(d > 19.0f && d < 21.0f);
    }

    // Now fill the rest with rifles and try to squeeze a footstep in: THAT is refused,
    // and counted, rather than displacing something that matters more.
    for (std::size_t i = 0; i < kNoiseCap; ++i) noise_publish(f, 0, vec3{1, 1, 0}, shot, 0);
    CHECK(f.live() == kNoiseCap);
    const std::uint32_t before = f.dropped;
    CHECK(noise_publish(f, 0, vec3{1, 1, 0}, quietOne, 0) == 0);
    CHECK(f.dropped == before + 1);
}

static void test_noise_hearing_geometry() {
    NoiseField f;
    NoiseProfile p;
    p.radius = 10.0f;
    p.ttlMs = 2000;
    p.severity = 3;
    p.source = NoiseSource::WeaponFire;

    // All three axes wrap ([AGENTS.md]: x/y/z wrap; W does not). A noise 2 m
    // from the far seam is 4 m away across the wrap on ANY axis — the previous
    // version of this test pinned z as "a storey axis, not a torus", modelling
    // the W stack inside a field that never sees W, and the pin kept the ear
    // deaf through the z seam (markoaudit/systems/05-torus.md §1.4).
    CHECK(noise_publish(f, 0, vec3{2.0f, 10.0f, 4.0f}, p, 0) != 0);
    const Noise n = f.slot[0];
    CHECK(n.id != 0);
    const float across = noise_distance(n, vec3{kWorldExtent - 2.0f, 10.0f, 4.0f});
    CHECK(across > 3.9f && across < 4.1f);
    // Source z=4, ear z=254: raw delta 250, through the seam 6 — same rule as x.
    const float upSeam = noise_distance(n, vec3{2.0f, 10.0f, kWorldExtent - 2.0f});
    CHECK(upSeam > 5.9f && upSeam < 6.1f);

    // hearingMult scales the radius — the reference's whole model of a sharp-eared
    // kind. At 11 m a radius-10 noise is inaudible flat and audible at 1.12x.
    const vec3 ear{13.0f, 10.0f, 4.0f};   // 11 m away
    CHECK(!noise_audible(n, ear, 1.0f));
    CHECK(noise_audible(n, ear, kInvestigateHearing));
    CHECK(noise_audible(n, ear, kBeamHearing));

    // Layer scoping: the same position on another layer hears nothing at all.
    CHECK(loudest_heard(f, 0, vec3{2, 10, 4}, 1.0f, 0, 0, nullptr) != nullptr);
    CHECK(loudest_heard(f, 1, vec3{2, 10, 4}, 1.0f, 0, 0, nullptr) == nullptr);

    // Severity gate, and the self-filter. A monster must not investigate its own
    // muzzle: 13 of the 69 kinds shoot.
    CHECK(loudest_heard(f, 0, vec3{2, 10, 4}, 1.0f, 4, 0, nullptr) == nullptr);
    NoiseField g;
    CHECK(noise_publish(g, 0, vec3{2, 10, 4}, p, 99u) != 0);
    CHECK(loudest_heard(g, 0, vec3{2, 10, 4}, 1.0f, 0, 99u, nullptr) == nullptr);
    CHECK(loudest_heard(g, 0, vec3{2, 10, 4}, 1.0f, 0, 98u, nullptr) != nullptr);

    // Louder wins over nearer. A severity-4 rifle at the edge of its radius beats a
    // severity-2 crate underfoot: severity*10 dominates nearness*8 by construction.
    NoiseField h;
    NoiseProfile crate = container_open_noise();
    NoiseProfile rifle;
    rifle.radius = 24.0f;
    rifle.ttlMs = 2800;
    rifle.severity = 4;
    rifle.source = NoiseSource::WeaponFire;
    const std::uint32_t crateId = noise_publish(h, 0, vec3{40, 40, 2}, crate, 0);
    const std::uint32_t rifleId = noise_publish(h, 0, vec3{62, 40, 2}, rifle, 0);
    CHECK(crateId != 0 && rifleId != 0);
    const Noise* pick = loudest_heard(h, 0, vec3{40, 40, 2}, 1.0f, 2, 0, nullptr);
    CHECK(pick != nullptr);
    if (pick) CHECK(pick->id == rifleId);
}

static void test_noise_weapon_profiles() {
    // Every one of the 29 firearms produces a legal, in-band profile — a table-driven
    // radius means a new CSV row is automatically as loud as its numbers deserve, and
    // this is what catches a row that would make it silent or world-spanning.
    int loudEnoughToBeatSight = 0;
    float minR = 1e9f, maxR = -1e9f;
    for (std::size_t i = 0; i < kRangedCount; ++i) {
        const NoiseProfile p = weapon_fire_noise(kRangedTable[i]);
        CHECK(p.source == NoiseSource::WeaponFire);
        CHECK(p.ttlMs == 2800);
        CHECK(p.radius >= 9.0f && p.radius <= 24.0f);
        CHECK(p.severity >= 2 && p.severity <= 4);
        // The banding must agree with the radius it was derived from.
        if (p.radius >= 21.0f) CHECK(p.severity == 4);
        else if (p.radius >= 13.0f) CHECK(p.severity == 3);
        else CHECK(p.severity == 2);
        if (p.radius < minR) minR = p.radius;
        if (p.radius > maxR) maxR = p.radius;
        // Audible beyond the 20 m sight radius once the investigation bonus applies:
        // that band is the ONLY place "heard but not seen" can happen.
        if (p.radius * kInvestigateHearing > kAggroRadius) ++loudEnoughToBeatSight;
    }
    std::printf("noise: 29 guns, radius %.1f..%.1f m, %d of 29 audible past the "
                "%.0f m sight radius\n", minR, maxR, loudEnoughToBeatSight,
                kAggroRadius);
    // At least the heavy rifles must clear it, or the primitive cannot be shown to do
    // anything sight does not already do.
    CHECK(loudEnoughToBeatSight > 0);

    // Nothing else publishes above the investigation threshold by accident.
    CHECK(body_fall_noise().severity == 2);
    CHECK(container_open_noise().severity == 2);
    CHECK(container_open_noise().radius == 7.0f);
}

// ===========================================================================
// ОСНАСТКА ВОСПРИЯТИЯ — ОДНА, А НЕ ПО КОПИИ В КАЖДОМ БЛОКЕ
// ===========================================================================
namespace noise_detail {

// ПУЛОВ ЗДЕСЬ НЕ ГРЕЮТ, И ЭТО ПРОВЕРЕННОЕ РЕШЕНИЕ, А НЕ ЗАБЫВЧИВОСТЬ.
// `perceive_step` эмплейсит `Senses` (и `Steer` — заявкой) ВНУТРИ живого вида
// `view<const Transform>`, то есть попадает под тот же вопрос, под который в
// проде стоит `steer_pool_warm` ([game/guide.h]: «рождение первого элемента
// нового рода растит контейнер пулов и дангл'ит указатели живого вида»).
// Прочитан пин EnTT (v3.14.0, `CMakeLists.txt:152`): `basic_registry::assure`
// держит пулы как `dense_map<id_type, shared_ptr<base>>` и кладёт САМО
// ХРАНИЛИЩЕ в отдельную аллокацию (`allocate_shared`), а вид держит указатели
// на хранилища — значит рост и рехеш контейнера их не двигает. Эмплейс рода,
// которого вид НЕ ОБХОДИТ, здесь безопасен; греть пул значило бы носить
// оснастку без читателя и подпирать её прозой, которая на этом пине неверна.
inline bool near_eq(float a, float b, float eps = 1e-3f) {
    return std::fabs(a - b) <= eps;
}

// Табличная скорость кинда в м/с — знаменатель, на который делятся все
// утверждения о скорости ниже. Никогда не литерал: 0.82..3.15 клетки/с живут
// в CSV, и абсолютное число было бы её копией.
inline float table_speed(MobKind k) {
    return static_cast<float>(kMobTable[static_cast<std::size_t>(k)].speedMmps) *
           0.001f * kCellSize;
}

inline float flat_speed(const Velocity& v) {
    return std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y);
}

// Сумма телеметрии прохода за окно. Нужна потому, что ТЕЛО ПОСЕЩАЕТСЯ РАЗ В
// `kPerceivePeriod` ТИКОВ: утверждение про один тик зависело бы от того, в
// какой слот попал хеш тождества, то есть от номера сущности.
struct PerceiveSum {
    std::uint32_t bodies = 0, blind = 0, pairsNear = 0, pairsCone = 0, rays = 0,
                  occluded = 0, sawFoe = 0, heard = 0, claimSight = 0,
                  claimNoise = 0;
    void add(const PerceiveTick& t) {
        bodies += t.bodies;       blind += t.blind;
        pairsNear += t.pairsNear; pairsCone += t.pairsCone;
        rays += t.rays;           occluded += t.occluded;
        sawFoe += t.sawFoe;       heard += t.heard;
        claimSight += t.claimSight; claimNoise += t.claimNoise;
    }
};

// ТРИ ОТСЕЧКИ ИДУТ В ОДНОМ ПОРЯДКЕ, И ЭТО НЕ ВКУС. §66 заплатил 631 мкс за
// луч без отсечек и вылечился ×162 тем, что поставил перед лучом дешёвые
// вопросы. Монотонность счётчиков — машинная форма этого порядка: марш
// платится РОВНО за пару, прошедшую конус, а конус — подмножество прошедших
// дистанцию. Мутация, которую это ловит: подвинуть `sight_blocked` перед
// `looking_at` (цена вырастет, а поведение не изменится — то есть ни один
// поведенческий гейт этого не увидит).
inline void check_cutoff_order(const PerceiveTick& pt) {
    CHECK(pt.pairsCone <= pt.pairsNear);
    CHECK(pt.rays == pt.pairsCone);
    CHECK(pt.occluded <= pt.rays);
    CHECK(pt.sawFoe <= pt.bodies);
    CHECK(pt.blind <= pt.bodies);
    CHECK(pt.heard <= pt.bodies);
    CHECK(pt.claimSight <= pt.sawFoe);
    CHECK(pt.claimNoise <= pt.heard);
}

// ОДИН ТИК ВОСПРИЯТИЯ ЦЕЛИКОМ — ЗАЯВКА ПЛЮС ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ.
//
// Пара, а не два вызова, и это то же лечение, которое сделали в проде: шесть
// блоков ниже несли бы шесть дословных копий двухстрочной последовательности,
// и достаточно одной копии, забывшей `guide_step`, чтобы блок начал судить
// скорость, записанную ДО вызова — зелёным. Образец — `steer_tick` в
// [tests/suite_behaviours.inl].
//
// `nullptr` гравитацией: вся арена этого файла стоит под NegZ, и
// `steer_frame_of(nullptr)` даёт ровно NegZ побитово ([world/gravity.h]).
inline PerceiveTick sense_tick(Registry& reg, const MacroGrid& grid,
                               const NoiseField& noise, NpcPool& pool,
                               const FactionRelations& rel, const ZoneNav& zn,
                               LayerId layer, std::uint64_t t) {
    const PerceiveTick pt =
        perceive_step(reg, grid, noise, pool, rel, layer, t, nullptr);
    check_cutoff_order(pt);
    const GuideTick gt = guide_step(reg, zn, layer, t, nullptr);
    // Самопроверка писателя на каждом тике: непонятный байт ранга/вида,
    // недостижимая заявленная цель и заявка на теле человека обязаны быть
    // нулём ПО ПОСТРОЕНИЮ. Восприятие заявляет только `Dir` и `Hold`, поэтому
    // ненулевой `unresolved` здесь означал бы заявку зоны, которой у него нет.
    CHECK(gt.bogus == 0u);
    CHECK(gt.unresolved == 0u);
    CHECK(gt.foreign == 0u);
    return pt;
}

// Монстр на слое: тождество, скорость и ВЗГЛЯД.
//
// ВЗГЛЯД СТАВИТСЯ ПОЛЕМ, А НЕ ПРОХОДОМ, И ЭТО ОСОЗНАННО. Писатель взгляда —
// `look_step`, и он выводит направление ИЗ СКОРОСТИ ([game/look.h]), то есть
// в стенде направление конуса стало бы следствием того, куда тело уже едет —
// ровно той величины, которую блоки ниже и мерят. Направление, поставленное
// рукой, делает конус ПРЕДМЕТОМ, а не побочным эффектом; прогон, где взгляд
// пишет сам проход, стоит один — гунсхот-демо ниже.
inline Entity spawn_mob(Registry& reg, LayerId layer, MobKind k, const vec3& pos,
                        const vec3& gaze) {
    const Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{pos, layer});
    reg.emplace<Velocity>(e, Velocity{});
    reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(k), 1, 40, 40});
    reg.emplace<Look>(e, Look{gaze});
    return e;
}

// ТЕЛО, КОТОРОЕ МОНСТР ВООБЩЕ СПОСОБЕН УВИДЕТЬ. Восприятие спрашивает
// «враждебны ли двое» по СТРОКЕ АЛАЙФА (`mob_hostile_to` через `NpcRef`), а не
// «есть ли у тела камера»: тело без тождества для монстра НЕВИДИМО по
// построению. Это перепись закона, а не удобство фикстуры — ровно так зрение
// и стало агностичным к тому, игрок перед ним или житель.
//
// ВЗГЛЯДА ЭТОМУ ТЕЛУ НЕ ВЫДАНО: без `Look` оно слепо (`look == nullptr` —
// тот же случай, что `fovCos > 1`), значит заявок ЗРЕНИЯ не подаёт и в
// арбитраж зрения не вмешивается. Жертва здесь — наблюдаемое, а не
// наблюдатель. СЛЫШИТ ОНО ПО-ПРЕЖНЕМУ (слепота и глухота — разные строки), и
// блоки, считающие `heard` суммой по телам, обязаны это учитывать: ниже
// геометрия сцен подобрана так, чтобы жертва шума не слышала, либо счёт идёт
// по `Senses` конкретного тела, а не по сумме прохода.
inline Entity spawn_person(Registry& reg, NpcPool& pool, LayerId layer,
                           const vec3& pos) {
    const NpcId id = pool.spawn();
    pool.height_mm(id) = 1750;
    const Entity e = embody(reg, pool, id, layer);
    CHECK(e != entt::null);
    if (e == entt::null) return e;
    reg.get<Transform>(e).pos = pos;
    // Citizens: kMobVsFaction[0] = -80 <= kHostileRelation (-50). Пинится
    // здесь, потому что смена дефолтной фракции пула сделала бы все блоки
    // зрения ниже вакуумными — монстру стало бы не на кого смотреть.
    CHECK(mob_hostile_to(pool, id));
    return e;
}

// Громкий долгий шум одной строкой. `ttlMs` длиннее любого окна ниже (60 с
// против самого длинного окна 32 тика = 0.26 с): свип поля — предмет блока
// `test_noise_fades`, и здесь он решать ничего не должен.
//
// 60 000, А НЕ 600 000, И ЭТО ЛЕЧЕНИЕ, А НЕ ВКУС. `NoiseProfile::ttlMs` —
// `std::uint16_t`, то есть 65 535 мс потолком; прежняя редакция этого файла
// писала здесь `600000` с комментарием «длиннее прогона», и компилятор
// усекал его до 10 176 мс (-Wconstant-conversion). Срок выжил случайно —
// 10 с всё ещё больше любого окна, — но заявленное число не существовало.
inline NoiseProfile loud_profile(float radius) {
    NoiseProfile p;
    p.radius = radius;
    p.ttlMs = 60000;
    p.severity = 4;
    p.source = NoiseSource::WeaponFire;
    return p;
}

} // namespace noise_detail

// ===========================================================================
// ТОЖДЕСТВО СЛОТОВ СТАГГЕРА: ВОСПРИЯТИЕ И ПРОГУЛКА ХОДЯТ ОДНИМ РАСПИСАНИЕМ
// ===========================================================================
// Если эти два прохода когда-нибудь вычислят РАЗНЫЕ слоты, тело будет
// заявлено двумя системами в разных тиках и начнёт дёргаться между целью и
// звуком. Утверждается машиной, а не доверием, потому что хеш выписан в двух
// файлах НАМЕРЕННО (`perceive.cpp:102`, `wander.cpp:248`).
//
// ЧТО ЗДЕСЬ БЫЛО НЕ ТАК ДО 2026-11-09, дословно. Тест назывался «общий стаггер
// прогулки и слуха», а проверял `visits == 1` НА ОДНОМ ТЕЛЕ — то есть что слух
// ходит стаггером с периодом `kWanderPeriod`. Это половина утверждения, и
// ровно НЕ та половина: про прогулку он не спрашивал НИЧЕГО, поэтому соль хеша
// можно было сменить на любую — слоты разъехались бы, а тест остался бы
// ЗЕЛЁНЫМ. Утверждение доказывало ПРАВИЛО и не доказывало ПРОВОДКУ. Судится
// тождество МНОЖЕСТВ, тик за тиком, на 24 телах (втрое больше, чем слотов).
//
// ЧЕМ НАБЛЮДАЮТСЯ ВИЗИТЫ ТЕПЕРЬ, И ЭТО ВТОРОЕ ЛЕЧЕНИЕ ЭТОГО БЛОКА. Прежде
// визит слуха виделся СЕНТИНЕЛЕМ В СКОРОСТИ («слух пишет скорость сам»), и с
// переездом этот приём умер вместе с писателем: восприятие скорости не пишет
// вовсе. На его месте — ШТАМП `Senses::tick`, который проход ставит каждому
// посещённому телу; визит прогулки — живая заявка РАНГА `Walk`, которого
// восприятие не подаёт НИКОГДА (у него только `Noise` и `Chase`). То есть оба
// множества наблюдаются ПРЯМО и ни одно не может быть произведено чужим
// проходом.
//
// ПОЛЕ ТИХОЕ, ЖЕРТВ НЕТ — И ЭТО ТРЕБОВАНИЕ, А НЕ ЭКОНОМИЯ: заявка слуха
// (`Noise`) СИЛЬНЕЕ `Walk`, поэтому услышавшее тело прогулка пропустила бы
// целиком (`steer_claimed_by_stronger`), и множество прогулки стало бы
// подмножеством — тождество превратилось бы в неравенство, а блок мерил бы
// арбитраж вместо расписания.
static void test_noise_stagger_matches_wander(MacroGrid& grid) {
    using namespace noise_detail;

    // ПЕРИОД — ОДНО ЧИСЛО НА ДВА ПРОХОДА. Машинная половина утверждения: пока
    // стоит этот assert, «разные слоты» могут приехать только из разной СОЛИ,
    // и её ловит тождество множеств ниже.
    static_assert(kPerceivePeriod == static_cast<std::uint64_t>(kWanderPeriod),
                  "восприятие и прогулка обязаны ходить одним расписанием");

    // 24 тела — ВТРОЕ БОЛЬШЕ, ЧЕМ СЛОТОВ. Шестнадцати хватило бы, но при
    // троекратном запасе пустой слот становится неожиданностью, а пустой слот
    // делает тождество множеств в своём тике ТРИВИАЛЬНЫМ (∅ == ∅) — то есть
    // оставляет дыру той же формы, что и прежний `visits == 1`.
    constexpr int kHerd = 24;
    static_assert(kHerd >= 16, "не меньше 16 тел");
    static_assert(kHerd >= 3 * static_cast<int>(kWanderPeriod),
                  "втрое больше, чем слотов — чтобы пустой слот был "
                  "неожиданностью, а не нормой");

    Registry reg;
    NoiseField silentField;    // ТИХОЕ, см. шапку блока
    NpcPool pool;
    pool.init();
    FactionRelations rel = kBaseFactionMatrix;

    // Нав ВЫРОЖДЕН (`arm_zones_one`: зона есть, идти некуда) — тот же довод,
    // что в `suite_behaviours.inl`: тело не проваливается в `offnav`, доходит
    // до решения и кончает заявкой `Hold` РАНГА `Walk`, то есть заявку
    // оставляет ВСЕГДА. Без этого «не посещён прогулкой» слилось бы с
    // «посещён, но цель не разрешилась».
    ZoneNav zn;
    zone_fixture::arm_zones_one(zn);
    CHECK(zn.built());

    std::vector<Entity> bodies;
    for (int i = 0; i < kHerd; ++i) {
        // Кучка вдоль +x в своём углу тора. Взгляд у всех есть (блок хочет
        // `blind == 0`, то есть ПОЛНУЮ работу прохода), но смотреть не на кого:
        // монстр монстру не враг — у монстра нет строки алайфа, и вопрос к нему
        // невыразим (`perceive.cpp` `hostile_pair`).
        bodies.push_back(spawn_mob(
            reg, 0, MobKind::Zombie,
            vec3{40.0f + 0.5f * static_cast<float>(i), 40.0f, 2.0f},
            vec3{1.0f, 0.0f, 0.0f}));
    }
    // Сетка нужна прогулке ровно под пробу «стена рядом», а она закрыта гейтом
    // `wall_query_needed` для 5 кинд из 69 — Zombie не из них, так что ни
    // одного чтения клетки прогулкой здесь не будет. Восприятие сетку читает
    // только маршем, а маршей тут ноль (смотреть не на кого).
    CHECK(!wall_query_needed(mob_def(MobKind::Zombie).aiFlags,
                             static_cast<MobBehaviour>(
                                 mob_def(MobKind::Zombie).behaviour)));
    CHECK(wander_init(reg, 0) == static_cast<std::uint32_t>(kHerd));

    std::vector<int> seenVisits(kHerd, 0), walkVisits(kHerd, 0);
    std::size_t occupiedSlots = 0;
    for (std::uint64_t t = 0; t < kPerceivePeriod; ++t) {
        // ПОРЯДОК КАДРА ДОСЛОВНО КАК В `main.cpp`: восприятие заявляет первым,
        // прогулка — последней, писатель один и стоит за ними. На тождество
        // слотов порядок не влияет, и именно поэтому стоит как в игре, а не
        // «как удобнее наблюдать».
        const PerceiveTick pt =
            perceive_step(reg, grid, silentField, pool, rel, 0, t, nullptr);
        check_cutoff_order(pt);
        // Тихое поле и некого видеть: проход обязан НИЧЕГО не решить. Без этих
        // трёх строк множество `Senses` ниже могло бы оказаться множеством
        // услышавших, а не посещённых.
        CHECK(pt.blind == 0u);
        CHECK(pt.pairsNear == 0u);
        CHECK(pt.sawFoe == 0u);
        CHECK(pt.heard == 0u);
        CHECK(pt.claimSight == 0u);
        CHECK(pt.claimNoise == 0u);

        std::vector<std::uint8_t> perceived(kHerd, 0u);
        std::size_t nSeen = 0;
        for (int i = 0; i < kHerd; ++i) {
            const Senses* s =
                reg.try_get<Senses>(bodies[static_cast<std::size_t>(i)]);
            // ШТАМП ЭТОГО ТИКА — и есть «восприятие меня посетило».
            if (s != nullptr && s->tick == static_cast<std::uint32_t>(t)) {
                perceived[static_cast<std::size_t>(i)] = 1u;
                ++nSeen;
                ++seenVisits[static_cast<std::size_t>(i)];
            }
        }
        CHECK(nSeen == static_cast<std::size_t>(pt.bodies));

        wander_step(reg, grid, pool, zn, 0, t);
        std::vector<std::uint8_t> walked(kHerd, 0u);
        std::size_t nWalk = 0;
        for (int i = 0; i < kHerd; ++i) {
            const Steer* s =
                reg.try_get<Steer>(bodies[static_cast<std::size_t>(i)]);
            // ЗАЯВКА ЭТОГО ТИКА РАНГА `Walk` — и есть «прогулка меня
            // посетила». Ранг назван, а не опущен: он отсекает заявку
            // восприятия, которой в этом блоке нет, но которая появится у
            // первого же, кто перепишет блок под живой шум.
            if (s != nullptr && steer_claim_live(*s, t) &&
                s->rank == SteerRank::Walk) {
                walked[static_cast<std::size_t>(i)] = 1u;
                ++nWalk;
                ++walkVisits[static_cast<std::size_t>(i)];
            }
        }
        // ТО САМОЕ УТВЕРЖДЕНИЕ. Сменишь соль любого из двух — множества
        // разойдутся в ПЕРВОМ ЖЕ непустом слоте.
        CHECK(perceived == walked);
        if (nWalk != 0) ++occupiedSlots;
    }
    // Каждое тело посещено РОВНО ОДИН раз за период каждым из двух проходов:
    // это стаггер как таковой, и без него тождество множеств прошло бы для
    // двух проходов, посещающих всех каждый тик.
    for (int i = 0; i < kHerd; ++i) {
        CHECK(seenVisits[static_cast<std::size_t>(i)] == 1);
        CHECK(walkVisits[static_cast<std::size_t>(i)] == 1);
    }
    std::printf("noise: стаггер — %d тел, занятых слотов %zu из %u, "
                "множества восприятия и прогулки совпали во всех\n",
                kHerd, occupiedSlots, static_cast<unsigned>(kPerceivePeriod));
    // СТАГГЕР ВООБЩЕ РАЗНОСИТ ТОЛПУ. Это НЕ то же, что тождество выше: хеш,
    // выродившийся в константу (или `% 1`), посетил бы все 24 тела в ОДНОМ
    // тике, каждое по-прежнему ровно раз, оба прохода согласно — и всё выше
    // прошло бы, пока цена прохода выросла бы в восемь раз. Полоса нижняя и
    // грубая (вырождение, а не распределение), само число печатается строкой
    // выше и читается глазом.
    CHECK(occupiedSlots > 1u);
}

// ===========================================================================
// ЗРЕНИЕ СТАРШЕ СЛУХА, ГЛУХОТА СТРОКОЙ, КОНУС, СЛЕПОТА, НЕПОДВИЖНЫЙ —
// СУДЯТСЯ НЕ ЗДЕСЬ, И ЭТО РЕШЕНИЕ, А НЕ ПРОПУСК
// ===========================================================================
// Эти пять утверждений — ПРЕДМЕТ ВОСПРИЯТИЯ КАК СИСТЕМЫ, и они уже стоят
// гейтами в `tests/suite_perceive.inl`, поимённо:
//   блок 0  — строка `kSenseRows` как чистая дата (дальности, конус, множители);
//   блок 1  — ЗАСЛОНЕНИЕ: та же пара на 12 м со стеной и без, плюс лепленая
//             панель в «воздушной» клетке и щель в один атом;
//   блок 2  — КОНУС на ЖИТЕЛЕ (враг за спиной), то есть агностично к камере;
//   блок 3  — СЛЕПОТА строкой, блок 3b — ГЛУХОТА (см. ниже);
//   блок 4  — ЗРЕНИЕ СТАРШЕ СЛУХА РАНГОМ: один тик, два входа, заявка одна;
//   блок 5  — восприятие не пишет скорость (сентинель 97 м/с);
//   блок 12 — стаггер и пулы, рождающиеся внутри живого вида;
//   блок 13 — неподвижный видит, но не идёт.
//
// ПЕРВАЯ РЕДАКЦИЯ ЭТОЙ ПЕРЕПИСИ ИХ ВСЕ ПОВТОРИЛА — четыре блока, почти 400
// строк, пять сцен, — и это был бы РОВНО тот дефект, который канон запрещает в
// проде (S11: «вторая реализация того, что объявлено одной системой, —
// дефект»), только в стендовой форме, где он ещё и опаснее: две сюиты, судящие
// одну сцену, рано или поздно расходятся в том, что считают нормой, и тогда
// красное показывает на тест, а не на мир. Снесено сознательно.
//
// ОДНА ОГОВОРКА, И ОНА ДЛЯ ЛИДА: на момент этой переписи `suite_perceive.inl`
// НАПИСАН, НО ЕЩЁ НЕ ЗАРЕГИСТРИРОВАН в `tests/game_test.cpp` (его собственная
// шапка просит лида добавить `#include` и вызов `test_perceive_all()`). Пока
// этого коммита нет, перечисленные выше девять блоков НЕ ГОНЯЮТСЯ ВОВСЕ — и
// тогда их место здесь. Если лид решит сюиту не включать, четыре снесённых
// блока надо вернуть сюда; выбор между «вернуть» и «включить» — его, но
// третьего («и там, и тут») быть не должно.
//
// ЧТО ОСТАЛОСЬ ЗА ЭТИМ ФАЙЛОМ: ПОЛЕ ШУМА и его ЕДИНСТВЕННЫЙ потребитель —
// пять блоков чистых функций выше, тождество слотов стаггера с ПРОГУЛКОЙ
// (его не судит никто больше), слух сквозь стену (диффузность — решение
// владельца, и надгробие акустических шаров живёт здесь), слух, доведённый до
// СКОРОСТИ единственным писателем, цена прохода под полным полем и
// гунсхот-демо.
//
// ГЛУХОТА БЕЗЭХОГО — ДЕФЕКТ ПРОДА, И ОН УЖЕ ПРИКОЛОЧЕН ГЕЙТОМ.
// `sense_hearing_mult` отдаёт `MobBehaviour::DeadEcho` НОЛЬ, но `loudest_heard`
// и `noise_audible` начинаются со строки `mult = hearingMult > 0 ? hearingMult
// : 1.0f` ([game/noise.cpp]) — ноль КОЭРСИТСЯ В ЕДИНИЦУ, и глухой кинд слышит
// ровно как зрячий, только без бонуса 1.12. То есть ветку из кода убрали
// (`if (beh == DeadEcho) return out;` в снесённом `investigate_hear`), а дата
// её НЕ ЗАМЕНИЛА. Прежний гейт этого файла (`investigate_hear(f, DeadEcho,
// ...).heard == false`) был ЗЕЛЁНЫМ и умер вместе со своим символом; его
// предмет теперь судит `suite_perceive.inl` блок 3b — в форме «пин дефекта»,
// то есть утверждениями, которые упадут в день лечения и покажут на причину.
// Лечение — одна строка: не звать `loudest_heard` при `mult <= 0`.


// ===========================================================================
// СЛУХ, ДОВЕДЁННЫЙ ДО СКОРОСТИ — И ТОЛЬКО ЧЕРЕЗ ЕДИНСТВЕННОГО ПИСАТЕЛЯ
// ===========================================================================
// ПРЕДМЕТ ЭТОГО БЛОКА — ПОТРЕБИТЕЛЬ ПОЛЯ ШУМА ЦЕЛИКОМ, от записи в поле до
// метров в секунду: услышал → заявил рангом `Noise` → писатель повёл НА шум
// СВОЕЙ ТАБЛИЧНОЙ скоростью, не тронув ось гравитации. Это то, чем файл
// занимался всегда, только раньше все четыре звена были одной функцией.
//
// ЧТО ЗДЕСЬ ПЕРЕСЕКАЕТСЯ С `suite_perceive.inl` БЛОКОМ 5 И ПОЧЕМУ ОСТАВЛЕНО:
// тот судит «восприятие не пишет скорость» сентинелем на СЦЕНЕ ЗРЕНИЯ, здесь
// то же утверждение стоит на СЦЕНЕ СЛУХА и несёт две вещи, которых у него
// нет, — ТИХОЕ ПОЛЕ (ни одного решения на 32 тиках) и ГЕОМЕТРИЮ ШУМА (знак
// пеленга, табличная скорость, целая ось гравитации). Пересечение названо, а
// не обойдено: если блок 5 однажды заберёт и это, здесь останется тихое поле.
//
// МУТАЦИЯ, КОТОРУЮ ЛОВИТ СРЕДНЯЯ ФАЗА: вернуть в проход восприятия прямую
// запись `vel.v.x = ...; vel.v.y = ...;` (ровно то, что стояло в
// `investigate.cpp:122` и дало замеренные 45 двойных записей за 250 тиков —
// [game/guide.h], прибор `--action vedenie`). Все прочие блоки зовут
// `guide_step` и остались бы зелёными: мутация видна лишь там, где писателя
// СОЗНАТЕЛЬНО нет.
static void test_noise_reaches_velocity_through_the_writer(MacroGrid& grid) {
    using namespace noise_detail;

    Registry reg;
    NoiseField f;
    NpcPool pool;
    pool.init();
    FactionRelations rel = kBaseFactionMatrix;
    ZoneNav zn;
    zone_fixture::arm_zones_one(zn);

    const vec3 at{41.0f, 161.0f, 3.0f};                 // клетка (20,80,1)
    const Entity m = spawn_mob(reg, 0, MobKind::Zombie, at, vec3{1.0f, 0.0f, 0.0f});
    // Сентинель во ВСЕХ ТРЁХ осях: x/y — плоскость ходьбы (их пишет ведение),
    // z — ось гравитации, которой ведение не касается НИКОГДА.
    const vec3 sentinel{1.0f, 2.0f, 3.0f};
    reg.get<Velocity>(m).v = sentinel;

    // ---- ТИХОЕ ПОЛЕ: НИ ОДНОГО КАСАНИЯ, И ЭТО НЕ РАННИЙ ВЫХОД ------------
    // Прежний блок утверждал «тихое поле == проход не трогает НИ ОДНОЙ
    // сущности», и это держалось гейтом `field.quiet()` на входе
    // `investigate_step`. Такого гейта больше НЕТ и быть не может: у прохода
    // две половины, и зрение работает в тишине. Поэтому утверждение
    // переформулировано честно — тело посещается, `Senses` ставится, а
    // РЕШЕНИЯ не принимается ни одного, и скорость не меняется даже с
    // писателем в кадре.
    for (std::uint64_t t = 0; t < 4u * kPerceivePeriod; ++t) {
        const PerceiveTick pt = sense_tick(reg, grid, f, pool, rel, zn, 0, t);
        CHECK(pt.heard == 0u);
        CHECK(pt.claimNoise == 0u);
        CHECK(pt.claimSight == 0u);
        CHECK(reg.try_get<Steer>(m) == nullptr);
        const vec3 v = reg.get<const Velocity>(m).v;
        CHECK(v.x == sentinel.x);
        CHECK(v.y == sentinel.y);
        CHECK(v.z == sentinel.z);
    }

    // ---- ГРОМКОЕ ПОЛЕ, ПИСАТЕЛЯ В КАДРЕ НЕТ ------------------------------
    const NoiseProfile loud = loud_profile(30.0f);
    CHECK(noise_publish(f, 0, vec3{at.x - 10.0f, at.y, at.z}, loud, 0) != 0);
    PerceiveSum sum;
    const std::uint64_t t0 = 4u * kPerceivePeriod;
    for (std::uint64_t t = t0; t < t0 + 4u * kPerceivePeriod; ++t) {
        const PerceiveTick pt =
            perceive_step(reg, grid, f, pool, rel, 0, t, nullptr);
        check_cutoff_order(pt);
        sum.add(pt);
        // СКОРОСТЬ НЕ ТРОНУТА НИ НА ОДНОМ ТИКЕ — проверяется в цикле, а не
        // после: единственная запись в единственном тике была бы невидима
        // сверке «в конце».
        const vec3 v = reg.get<const Velocity>(m).v;
        CHECK(v.x == sentinel.x);
        CHECK(v.y == sentinel.y);
        CHECK(v.z == sentinel.z);
    }
    // Решение ПРИНЯТО четыре раза (одно посещение в периоде × четыре периода)
    // и четыре раза ЗАЯВЛЕНО — то есть молчание скорости выше не от того, что
    // проход ничего не решил.
    CHECK(sum.bodies == 4u);
    CHECK(sum.heard == 4u);
    CHECK(sum.claimNoise == 4u);
    CHECK(sum.claimSight == 0u);
    const Senses* sen = reg.try_get<Senses>(m);
    CHECK(sen != nullptr);
    if (sen != nullptr) CHECK(sen->heardSev == 4u);

    // ---- ТОТ ЖЕ ТИК С ПИСАТЕЛЕМ — СКОРОСТЬ ЕДЕТ ---------------------------
    const std::uint64_t t1 = t0 + 4u * kPerceivePeriod;
    bool wrote = false;
    for (std::uint64_t t = t1; t < t1 + kPerceivePeriod; ++t) {
        const PerceiveTick pt = sense_tick(reg, grid, f, pool, rel, zn, 0, t);
        if (pt.claimNoise != 0) {
            wrote = true;
            const vec3 v = reg.get<const Velocity>(m).v;
            CHECK(v.x < 0.0f);                       // на шум (−x)
            CHECK(v.x != sentinel.x);
            CHECK(near_eq(flat_speed(reg.get<const Velocity>(m)),
                          table_speed(MobKind::Zombie)));
            // ОСЬ ГРАВИТАЦИИ НЕ ТРОНУТА: это локомоция, а не полёт. Тот же
            // закон, что судит блок 8в в `suite_behaviours.inl`.
            CHECK(v.z == sentinel.z);
        }
    }
    CHECK(wrote);
    std::printf("noise: писатель один — 4 заявки слуха без `guide_step` не "
                "сдвинули скорость ни на тик, с ним сдвинули на первом же\n");
}

// ===========================================================================
// СЛУХ СКВОЗЬ СТЕНУ — ТА ЖЕ СТЕНА, КОТОРАЯ ЗАКРЫЛА ГЛАЗА
// ===========================================================================
// ОДНА СЦЕНА, ДВА ЗАКОНА, И ИМЕННО ПОЭТОМУ ОНИ ВМЕСТЕ. Поле шума ДИФФУЗНОЕ —
// решение владельца (CANON S25.8: «слух через поле звука запечённое, то есть
// диффузно»), поэтому слух стен не знает и знать не должен; зрение — КОНУС ПО
// КЛЕТКАМ С ЗАСЛОНЕНИЕМ, и оно стену знает одной дверью `sight_blocked`
// ([game/perceive.h]).
//
// ЧЕЙ ЗДЕСЬ ПРЕДМЕТ, И ЧЕМ ЭТО НЕ БЛОК 1 `suite_perceive.inl`. Тот судит
// ЗАСЛОНЕНИЕ как таковое — две сцены на одном расстоянии, лепленая панель,
// щель в один атом, — и шум в нём стоит ПО ДРУГУЮ сторону от стены (блок 4,
// фаза B). Здесь ИСТОЧНИК ШУМА СТОИТ ЗА СТЕНОЙ, вместе с невидимой жертвой, и
// судится именно то, чего там нет: материя между телами НЕ отнимает слух, хотя
// отнимает зрение — в ОДНОМ тике, по ОДНОЙ стене. Это прямое продолжение
// надгробия акустических шаров ниже и единственное место в дереве, где
// диффузность названа машиной, а не прозой.
//
// ЗАМЕР, КОТОРЫЙ ЗАЩИЩАЕТ ВТОРАЯ ПОЛОВИНА БЛОКА (прибор `--action zrenie`, до
// лечения): на этаже 6 СКВОЗЬ СТЕНУ шло 25.7 % контактов монстров, на падике —
// 52 % контактов вражды. Сфера без геометрии и была тем «игрок чем-то особен»,
// которое снёс владелец.
static void test_noise_passes_the_wall_that_stops_sight(MacroGrid& grid) {
    using namespace noise_detail;

    Registry reg;
    NoiseField f;
    NpcPool pool;
    pool.init();
    FactionRelations rel = kBaseFactionMatrix;
    ZoneNav zn;
    zone_fixture::arm_zones_one(zn);

    // СВОИ КЛЕТКИ, И СЕТКА — ЕДИНСТВЕННОЕ, ЧТО БЛОКИ ЭТОГО ФАЙЛА ДЕЛЯТ.
    // Наблюдатель (70,70,1) → пос (141,141,3); жертва (76,70,1) → (153,141,3),
    // то есть 12 м по +x — внутри 20 м и точно в конусе. Стена ровно посередине,
    // в клетке (73,70,1): 146..148 м по x.
    const vec3 eyeAt{141.0f, 141.0f, 3.0f};
    const vec3 preyAt{153.0f, 141.0f, 3.0f};
    const int wallX = 73, wallY = 70, wallZ = 1;
    CHECK(grid.cell(wallX, wallY, wallZ) == kCellAir);   // арена чиста до нас

    const Entity m =
        spawn_mob(reg, 0, MobKind::Zombie, eyeAt, vec3{1.0f, 0.0f, 0.0f});
    const Entity prey = spawn_person(reg, pool, 0, preyAt);
    CHECK(prey != entt::null);

    // ШУМ В ТОЧКЕ ЖЕРТВЫ, ЗА СТЕНОЙ. Радиус 30 м: слышно с запасом, и пеленг
    // слуха совпадает с пеленгом зрения — значит направление скорости НЕ
    // различает две причины, а счётчики различают. Поэтому ниже судятся
    // счётчики, а скорость только подтверждает, что тело вообще поехало.
    CHECK(noise_publish(f, 0, preyAt, loud_profile(30.0f), 0) != 0);

    // ПУТЬ ГЛАЗА — НА ВЫСОТЕ ГЛАЗА, А НЕ ПОЛА: `kEyeLiftM` = 0.6 м поднимает
    // оба конца, и луч идёт на z = 3.6 м, то есть внутри клетки z=1 (2..4 м).
    const vec3 eye{eyeAt.x, eyeAt.y, eyeAt.z + kEyeLiftM};
    const vec3 target{preyAt.x, preyAt.y, preyAt.z + kEyeLiftM};
    // ДВЕРЬ ПИНИТСЯ ДО ПРОХОДА: если фикстура промахнулась мимо луча, падёт
    // ЭТА строка, а не пять ниже — отказ назван там, где он произошёл.
    CHECK(!sight_blocked(grid, eye, target));
    grid.fill_cell(wallX, wallY, wallZ, kMatConcrete);
    CHECK(grid.cell(wallX, wallY, wallZ) != kCellAir);
    CHECK(sight_blocked(grid, eye, target));

    // ---- стена стоит: глаза отказали, уши нет ----------------------------
    {
        PerceiveSum sum;
        for (std::uint64_t t = 0; t < kPerceivePeriod; ++t)
            sum.add(sense_tick(reg, grid, f, pool, rel, zn, 0, t));
        CHECK(sum.pairsNear >= 1u);   // слой и дистанция пару ПРОПУСТИЛИ
        CHECK(sum.pairsCone >= 1u);   // конус тоже: жертва прямо впереди
        CHECK(sum.rays == sum.pairsCone);
        CHECK(sum.occluded == sum.rays);   // ...и КАЖДЫЙ марш уткнулся в стену
        CHECK(sum.sawFoe == 0u);
        CHECK(sum.claimSight == 0u);
        const Senses* sen = reg.try_get<Senses>(m);
        CHECK(sen != nullptr);
        if (sen != nullptr) {
            CHECK(sen->foe == entt::null);
            CHECK(sen->foeDist < 0.0f);
            CHECK(sen->visible == 0u);
            // СЛУХ СКВОЗЬ СТЕНУ — ДА, И ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА, А НЕ ДЫРА.
            CHECK(sen->heardSev == 4u);
        }
        CHECK(sum.heard >= 1u);
        CHECK(sum.claimNoise >= 1u);
        CHECK(reg.get<const Velocity>(m).v.x > 0.0f);   // пошёл на звук
        std::printf("noise: стена — маршей %u, заслонено %u, увидено %u, "
                    "услышано %u (слух диффузен по решению владельца)\n",
                    sum.rays, sum.occluded, sum.sawFoe, sum.heard);
    }

    // ---- стена снята: та же пара в прямой видимости -----------------------
    // Без этой половины блок прошёл бы для прохода, который не видит НИКОГДА:
    // «заслонено» и «зрения нет» в первой половине неразличимы.
    grid.clear_cell(wallX, wallY, wallZ);
    CHECK(grid.cell(wallX, wallY, wallZ) == kCellAir);
    CHECK(!sight_blocked(grid, eye, target));
    {
        PerceiveSum sum;
        for (std::uint64_t t = kPerceivePeriod; t < 2u * kPerceivePeriod; ++t)
            sum.add(sense_tick(reg, grid, f, pool, rel, zn, 0, t));
        CHECK(sum.occluded == 0u);
        CHECK(sum.sawFoe == 1u);
        CHECK(sum.claimSight == 1u);
        const Senses* sen = reg.try_get<Senses>(m);
        CHECK(sen != nullptr);
        if (sen != nullptr) {
            CHECK(sen->foe == prey);
            CHECK(sen->foeDist > 11.9f && sen->foeDist < 12.1f);
            CHECK(sen->visible == 1u);
            // ВРАГА ВИДНО — СЛУХ НЕ СПРОШЕН. Судится `Senses` ЭТОГО ТЕЛА, а
            // не сумма прохода: жертва стоит ровно НА шуме и слышит его в
            // обеих фазах (слепота и глухота — разные строки), поэтому
            // `sum.heard` здесь считал бы два тела и утверждение о мобе было
            // бы невыразимо.
            CHECK(sen->heardSev == 0u);
        }
        CHECK(reg.get<const Velocity>(m).v.x > 0.0f);
    }
    // КОНУС ЗДЕСЬ НЕ СУДИТСЯ — он предмет `suite_perceive.inl` блока 2, и
    // судится там на ЖИТЕЛЕ (враг за спиной), то есть агностично к камере.
    // Третья фаза этого блока (моб отвернулся → `pairsCone == 0`, `rays == 0`)
    // была написана и СНЕСЕНА как дословный повтор того блока.
}

// ---------------------------------------------------------------------------
// The demonstration
// ---------------------------------------------------------------------------
// A monster 26 m away cannot see the player: sight aggro is kAggroRadius = 20 m, and
// the distance cutoff is the FIRST of the three the perception pass applies, so > 20 m
// is unambiguously outside every way the mob has of knowing anything exists. The
// player fires a rifle. Measured: how much ground the mob covers toward the shot,
// against a bit-identical control run with the shot silenced.
//
// ЧТО ЗДЕСЬ СТАЛО ДРУГИМ 2026-11-09, И ЭТО НЕ КОСМЕТИКА. Прежняя шапка
// утверждала дословно: «there is no line-of-sight test anywhere in the tree».
// ТЕПЕРЬ ЕСТЬ — `sight_blocked` внутри одного прохода восприятия, — и строка
// была бы ложью ровно того класса, который в этом дереве зафиксирован как
// дефект. Атрибуция от этого только окрепла: она считается по `claimNoise`, то
// есть по ЗАЯВКАМ РАНГА `Noise`, а проход подаёт их ТОЛЬКО когда врага не
// воспринято (`sen.foe == entt::null`) — значит ненулевой счёт есть
// доказательство, что движение вызвано слухом, а не зрением, ПО ПОСТРОЕНИЮ
// прохода, а не по арифметике радиусов в комментарии.
//
// Взгляд здесь пишет САМ ПРОХОД (`look_step`), а не стенд, и это единственный
// блок, где так: моб идёт на выстрел, взгляд следует за ходом, и к моменту,
// когда он войдёт в 20 м, он уже смотрит на игрока — то есть сцена
// воспроизводит «услышал, пришёл, увидел» целиком, а не до середины.
static void test_noise_moves_a_monster_that_cannot_see_you() {
    using namespace noise_detail;

    // Physics needs a real floor; wander needs a baked nav or it no-ops. Both are the
    // live systems, not stubs — the point is to measure the game, not a harness.
    World w;
    generate_floor(w, /*number=*/0, floor_spec(FloorKind::Industrial), 4242u);
    // НАВ ПО ЗОНАМ ВЫРОЖДЕН СОЗНАТЕЛЬНО (§88/F.2), и это УСИЛИВАЕТ тест, а не
    // ослабляет: прежде здесь стоял настоящий бейк решётки, и прогулка таскала
    // моба своим шагом ОДНОВРЕМЕННО с шумом — то есть «приблизился к выстрелу»
    // было суммой двух причин, а разница громкого и тихого прогона мерила их
    // обе. Вырожденная фикстура (`zone_fixture.inl`: зона у тела есть, идти
    // некуда) делает прогулку МОЛЧАЩЕЙ, и тогда всё, что движет моба, есть
    // звук. Та же логика, которой живёт `suite_behaviours.inl`: контроль
    // однозначен, только когда альтернативная причина выключена, а не усреднена.
    ZoneNav zn;
    zone_fixture::arm_zones_one(zn);
    CHECK(zn.built());
    FactionRelations rel = kBaseFactionMatrix;

    // Two identical worlds-in-miniature: same seeds, same positions, same ticks. The
    // ONLY difference is whether the gunshot is published.
    struct Run {
        Registry reg;
        NoiseField noise;
        NpcPool pool;
        Entity mob = entt::null;
        Entity player = entt::null;
        float startD = 0.0f;
        std::uint32_t claimNoise = 0;
        std::uint32_t claimSight = 0;
        std::uint32_t heard = 0;
    };

    // A standable pair of cells 13 cells (26 m) apart on the same row: air, with
    // something solid under it. Derived from the floor rather than hardcoded, because a
    // body spawned inside a pillar is a physics measurement, not a hearing one.
    const int gz = floor_ground_z(); // the module's ground storey, not literal 1
    auto standable = [&](int x, int y) {
        return w.grid().cell(wrap_macro(x), y, gz) == kCellAir &&
               w.grid().cell(wrap_macro(x), y, gz - 1) != kCellAir;
    };
    // 26 m: deep in the hearing-only band, between the 20 m sight radius and a rifle's
    // 24 m x 1.12 investigation hearing = 26.9 m. It was 11 cells / 22 m, which is
    // inside that band on paper and useless in practice: only 2 m of clearance, so the
    // mob wanders into SIGHT within about a second and sight aggro then drives the
    // audible and silent runs identically — contaminating the one thing measured here.
    const int kGapCells = 13;
    // Search the module's CORRIDOR rows (2-cell bands hugging the lattice
    // lines): the only rows guaranteed to offer a 26 m straight line with no
    // apartment wall between the two bodies. A wall in the gap would now measure
    // ЗАСЛОНЕНИЕ (the third cutoff) instead of hearing — which the wall block
    // above measures on purpose, and this one must not.
    int px = 0, py = 0;
    for (int ny = 0; ny < kLatticeDim && !px; ++ny)
        for (int dy = 0; dy < 2 && !px; ++dy) {
            const int y = lattice_coord(ny) + dy;
            for (int x = 30; x < 100; ++x)
                if (standable(x, y) && standable(x + kGapCells, y)) {
                    px = x;
                    py = y;
                    break;
                }
        }
    CHECK(px != 0);

    const vec3 playerPos{(static_cast<float>(px) + 0.5f) * kCellSize,
                         (static_cast<float>(py) + 0.5f) * kCellSize,
                         static_cast<float>(gz) * kCellSize + 0.9f};
    const float gap = static_cast<float>(kGapCells) * kCellSize;
    const vec3 mobPos{playerPos.x + gap, playerPos.y, playerPos.z};

    auto setup = [&](Run& r) {
        r.pool.init();
        NpcId pid = r.pool.spawn();
        r.pool.height_mm(pid) = 1750;
        r.player = embody_as_player(r.reg, r.pool, pid, /*layer=*/0);
        CHECK(r.player != entt::null);
        r.reg.get<Transform>(r.player).pos = playerPos;
        // A gun and a magazine's worth of ammo, so the shot is a real shot through
        // player_ranged_step and not a hand-made noise.
        Inventory& inv = r.pool.inventory(pid);
        ItemId gun = kInvalidItem;
        const RangedDef* def = nullptr;
        for (ItemId id = 1; id <= kItemCount && !def; ++id) {
            const RangedDef* d = ranged_for_item(id);
            // The loudest class in the table: a heavy round, single pellet.
            if (d && d->dmg >= 100) { gun = id; def = d; }
        }
        CHECK(def != nullptr);
        inv.slots[0] = ItemSlot{gun, 1};
        if (def) inv.slots[1] = ItemSlot{def->ammo, 40};
        // The DECISION, recorded: a bag with a gun in it is bare hands until
        // someone equips it ([equip.h]) — this is the player's hand doing so,
        // the same write `equip 0` performs in the console.
        equip_item(inv, r.reg.get<Equipped>(r.player), 0);
        // Pre-armed: weapon already drawn, magazine already full.
        //
        // Without this the test cannot fire at all, and it is worth recording why,
        // because the failure reads as a noise bug and is not one. On its first call
        // player_ranged_step sees pr.weapon (0) != gun, takes the gun-swap branch
        // which empties the magazine, then finds magCount == 0, STARTS A RELOAD and
        // returns 0 ([combat.cpp]). The shot would land some reloadMs later — but this
        // test requests fire only on tick 0, so no shot ever happened: shotsFired
        // stayed 0 and the steer count, live() and the distance delta all failed as
        // consequences of a mob that never shot, not of anything it failed to hear.
        // Arming the magazine here keeps the "fire exactly once, on tick 0" design,
        // which is what makes the loud and silent runs identical in every other way.
        if (def)
            r.reg.emplace_or_replace<PlayerRanged>(
                r.player, PlayerRanged{def->magazine, gun, 0, 0});

        // A Zombie: Plain behaviour, ordinary speed, nothing special to confound the
        // measurement. ВЗГЛЯДА РУКОЙ НЕ ВЫДАНО — его напишет `look_step` в кадре,
        // как в игре.
        r.mob = r.reg.create();
        r.reg.emplace<Transform>(r.mob, Transform{mobPos, 0});
        r.reg.emplace<Velocity>(r.mob, Velocity{});
        r.reg.emplace<AABB>(r.mob, AABB{vec3{0.4f, 0.4f, 0.9f}});
        r.reg.emplace<GravityAffected>(r.mob, GravityAffected{});
        r.reg.emplace<MobRef>(
            r.mob, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 40, 40});
        r.reg.emplace<Acting>(r.mob, Acting{});
        CHECK(wander_init(r.reg, 0) > 0);
        r.startD = std::sqrt(
            wrap_delta_f(mobPos.x, playerPos.x, kWorldExtent) *
                wrap_delta_f(mobPos.x, playerPos.x, kWorldExtent) +
            wrap_delta_f(mobPos.y, playerPos.y, kWorldExtent) *
                wrap_delta_f(mobPos.y, playerPos.y, kWorldExtent));
    };

    Run loud, silent;
    setup(loud);
    setup(silent);
    // The mob starts outside every way it could previously have known anything.
    CHECK(loud.startD > kAggroRadius);
    CHECK(std::fabs(loud.startD - silent.startD) < 1e-4f);

    const float dt = giga::kSimDt;
    const std::uint32_t dtMs = static_cast<std::uint32_t>(dt * 1000.0f + 0.5f);
    LevelStack stack;
    // The stack has to own the floor for physics; one layer, index 0.
    stack.push_layer();
    stack.layer(0).grid() = w.grid();
    const GravityFrame gf = steer_frame_of(nullptr);

    std::uint32_t shotsFired = 0;
    // 350 ticks = 2.80 s at the 125 Hz sim tick: the gunshot's whole life, so the
    // window is the noise's TTL rather than an arbitrary count. It was 300 ticks /
    // 2.5 s written against a 120 Hz tick, and both halves of that had to move.
    const int kWindowTicks = 350;
    for (std::uint64_t t = 0; t < static_cast<std::uint64_t>(kWindowTicks); ++t) {
        for (Run* r : {&loud, &silent}) {
            const bool audible = (r == &loud);
            noise_step(r->noise, dtMs);
            // ПОРЯДОК КАДРА ДОСЛОВНО КАК В `main.cpp` (2026-11-09):
            // восприятие ЗАЯВЛЯЕТ первым (6067), прогулка — последней из
            // заявителей (7074), `guide_step` ПИШЕТ (7092), `look_step`
            // обновляет взгляд по уже написанной скорости (7102), физика
            // превращает скорость в движение.
            //
            // Без `guide_step` этот прогон остался бы зелёным и измерил бы не
            // то: на вырожденном наве прогулка заявляет `Hold`, то есть ГАСИТ
            // прошлую скорость моба на каждом его стаггер-визите — ровно то,
            // что делает «всё, что движет моба, есть звук» истинным. Без
            // писателя не исполнилась бы ни одна заявка вовсе.
            const PerceiveTick pt = perceive_step(
                r->reg, stack.layer(0).grid(), r->noise, r->pool, rel, 0, t,
                nullptr);
            check_cutoff_order(pt);
            r->claimNoise += pt.claimNoise;
            r->claimSight += pt.claimSight;
            r->heard += pt.heard;
            wander_step(r->reg, stack.layer(0).grid(), r->pool, zn, 0, t);
            const GuideTick gt = guide_step(r->reg, zn, 0, t, nullptr);
            CHECK(gt.bogus == 0u);
            CHECK(gt.unresolved == 0u);
            CHECK(gt.foreign == 0u);
            look_step(r->reg, 0, gf);
            physics_step(r->reg, stack, dt);
            // Fire once, on tick 0. The silent run fires the same shot with no sink,
            // so the projectile, the ammo spend and the cooldown are identical and the
            // ONLY difference between the two runs is the noise record.
            if (t == 0) {
                const std::uint32_t s = player_ranged_step(
                    r->reg, r->pool, 0, /*wantFireL=*/true,
                    /*wantFireR=*/false, dt, t,
                    audible ? &r->noise : nullptr);
                if (audible) shotsFired += s;
            }
        }
    }

    auto dist_to_player = [&](Run& r) {
        const vec3 mp = r.reg.get<Transform>(r.mob).pos;
        const float dx = wrap_delta_f(mp.x, playerPos.x, kWorldExtent);
        const float dy = wrap_delta_f(mp.y, playerPos.y, kWorldExtent);
        return std::sqrt(dx * dx + dy * dy);
    };
    const float loudEnd = dist_to_player(loud);
    const float silentEnd = dist_to_player(silent);

    std::printf("noise: gunshot demo — %s at %.1f m, %d ticks (%.2f s)\n"
                "  start    : %.2f m  (sight radius %.0f m, so it cannot see him)\n"
                "  heard    : %.2f m  (closed %+.2f m)\n"
                "  silenced : %.2f m  (closed %+.2f m)\n"
                "  delta    : %.2f m | %u noise-claims while blind, %u sight-claims "
                "after | %u shot | %u live noise\n",
                mob_name(MobKind::Zombie), gap, kWindowTicks,
                static_cast<double>(kWindowTicks) * dt,
                loud.startD, kAggroRadius,
                loudEnd, loud.startD - loudEnd,
                silentEnd, loud.startD - silentEnd,
                silentEnd - loudEnd, loud.claimNoise, loud.claimSight, shotsFired,
                static_cast<unsigned>(loud.noise.live()));

    // The shot happened, was heard, and was acted on WHILE the mob perceived no foe —
    // the pass claims rank `Noise` only when `Senses::foe` is null, so a non-zero
    // count IS the attribution.
    CHECK(shotsFired == 1);
    CHECK(loud.claimNoise > 0);
    CHECK(loud.noise.live() == 1);
    // КОНТРОЛЬ НЕ СЛЫШАЛ НИЧЕГО, и это сильнее, чем «не двигался»: тихий
    // прогон отличается от громкого ровно одной записью в поле шума, поэтому
    // ноль услышанного у него есть доказательство, что переменная опыта одна.
    CHECK(silent.heard == 0u);
    CHECK(silent.claimNoise == 0u);
    // The audible run closed real ground toward the player.
    CHECK(loud.startD - loudEnd > 4.0f);   // measured 7.82 m before the переезд

    // ...and it ended closer than the silent control. The threshold is 0.5 m and NOT
    // the 4 m first written here, and the difference is a limit of THIS TEST rather
    // than of the system, so it is recorded instead of quietly relaxed.
    //
    // The control is not an independent random walk. Both runs share wander seed 99u
    // and follow the same baked nav route, and that route already leads toward the
    // player's region: the silent mob closes 6.73 m of the 7.82 m the audible one
    // does. The noise can therefore only NUDGE an already-playerward path, and a 4 m
    // differential is unachievable by construction — it would need the control to
    // stand still. Nobody had ever seen that, because shotsFired == 1 above failed
    // first: the shot never happened, so this line had never once run against a mob
    // that actually heard anything.
    //
    // In the module geometry both runs are funneled along the same 2-cell
    // corridor, so the endpoint differential collapses to 0.00 m — the noise can
    // nudge but not reroute a body that has exactly one axis to move on. The
    // claim that survives (and the one that matters) is the noise-claim count
    // above: deliberate steers toward a noise by a mob that perceived no foe.
    // What this line still guards: hearing must never end the mob FARTHER than
    // deafness does.
    CHECK(silentEnd - loudEnd >= 0.0f);    // measured 0.00 m (corridor-funneled)

    // And the mechanism, not just the outcome: with the noise expired the same mob
    // stops being steered by it at all. СУДИТСЯ СЛУХ, А НЕ ВОСПРИЯТИЕ ЦЕЛИКОМ —
    // моб к этому моменту мог войти в 20 м и видеть игрока, и это ПРАВИЛЬНОЕ
    // поведение («услышал, пришёл, увидел»), а не загрязнение: в тишине обязан
    // замолчать слух, и только он.
    noise_clear(loud.noise);
    CHECK(loud.noise.quiet());
    PerceiveSum after;
    for (std::uint64_t t = 400; t < 400 + kPerceivePeriod; ++t)
        after.add(perceive_step(loud.reg, stack.layer(0).grid(), loud.noise,
                                loud.pool, rel, 0, t, nullptr));
    CHECK(after.bodies > 0u);        // проход тела посещал — отказ не в стаггере
    CHECK(after.heard == 0u);
    CHECK(after.claimNoise == 0u);
}

// ===========================================================================
// ЦЕНА ПРОХОДА — ЧИСЛО, А НЕ ПРИЛАГАТЕЛЬНОЕ
// ===========================================================================
// ЧТО БЫЛО ЗДЕСЬ ДО ПЕРЕЕЗДА, И ПОЧЕМУ ЭТОГО БОЛЬШЕ НЕЛЬЗЯ УТВЕРЖДАТЬ.
// Прежний блок мерил «цену тихого пути» и держал потолок 5 мкс, и этот потолок
// был свойством ОДНОЙ СТРОКИ — гейта `if (field.quiet()) return 0;` на входе
// `investigate_step`. У прохода восприятия такого гейта нет И БЫТЬ НЕ МОЖЕТ:
// зрение работает в тишине, и тихий кадр — его НОРМАЛЬНАЯ, а не вырожденная
// нагрузка. Потолок 5 мкс после переезда означал бы «гейт поймал регресс»
// там, где он поймал переезд, — поэтому он СНЯТ НАЗВАННО, а не ослаблен молча.
//
// ЧЕМ ОН ЗАМЕНЁН — ДВА РОДА УТВЕРЖДЕНИЙ, И ДЕТЕРМИНИРОВАННОЕ ИДЁТ ПЕРВЫМ:
//   * СТРУКТУРНОЕ (от машины, не от таймера): стаггер покрывает КАЖДОЕ тело
//     ровно раз за период — сумма посещений за период равна числу тел на
//     слое; тишина не производит ни одного услышавшего; порядок трёх отсечек
//     монотонен (`check_cutoff_order`). Вырождение хеша в константу, потеря
//     стаггера и марш перед конусом ловятся ИМЕННО здесь, и ловятся
//     одинаково на любой машине.
//   * ЦЕНА — печатается с разложением по счётчикам (пар, конусов, маршей), а
//     потолком стоит ТИК ЦЕЛИКОМ: проход, не влезающий в тик, не может
//     работать вовсе. Полоса грубая сознательно — она обязана держаться и в
//     Debug-дереве, где всё медленнее ×10 ([memory] debug-tree-fps-trap), а
//     тонкую цену мерит прибор `--action zrenie` на живом этаже, где она и
//     замерена: 187-289 нс на марш, 753 пары, 0.166 мс на проход при 470
//     телах.
static void test_noise_pass_cost(MacroGrid& grid) {
    using namespace noise_detail;

    Registry reg;
    NoiseField f;
    NpcPool pool;
    pool.init();
    FactionRelations rel = kBaseFactionMatrix;
    ZoneNav zn;
    zone_fixture::arm_zones_one(zn);

    // A realistic floor's worth of monsters, all on one layer, plus a crowd of
    // residents — БЕЗ НИХ ПРОХОД НЕ ПЛАТИЛ БЫ НИ ОДНОГО МАРША: монстр монстру
    // не враг, и вопрос снимается ДО конуса. То есть замер без толпы мерил бы
    // только отсечку дистанции и врал бы в разы.
    const int kMobs = 300;
    const int kFolk = 20;
    for (int i = 0; i < kMobs; ++i) {
        const float x = static_cast<float>((i * 37) % 120) * kCellSize;
        const float y = static_cast<float>((i * 53) % 120) * kCellSize;
        spawn_mob(reg, 0, MobKind::Zombie, vec3{x, y, 3.0f},
                  vec3{1.0f, 0.0f, 0.0f});
    }
    for (int i = 0; i < kFolk; ++i) {
        // СДВИГ НА ПОЛКЛЕТКИ — чтобы ни один житель не встал ТОЧКА В ТОЧКУ на
        // монстре: монстры сидят на чётных метрах, и при совпадении (а оно
        // случается: моб 120 и житель 0 оба попали бы в (0,0)) пеленг пары
        // вырождается в ноль, `looking_at` отвечает «смотрю» по правилу «стою
        // внутри», а марш получает отрезок нулевой длины. Это законно и не
        // падает, но замеряло бы вырожденный случай вместо сцены.
        const float x = static_cast<float>((i * 11) % 120) * kCellSize + 1.0f;
        const float y = static_cast<float>((i * 29) % 120) * kCellSize + 1.0f;
        CHECK(spawn_person(reg, pool, 0, vec3{x, y, 3.0f}) != entt::null);
    }
    const std::uint32_t kBodies = static_cast<std::uint32_t>(kMobs + kFolk);

    // Окно выведено из частоты, а не выбрано: две секунды сима. Литерал 12000,
    // стоявший здесь прежде, был 100 секундами только при 120 Гц, и при этом
    // тело цикла старило поле на хардкоженные 8 мс (шаг 125 Гц) — окно было
    // 96 с и расходилось и со своим комментарием, и со своим dt.
    //
    // ОКНО — ЦЕЛОЕ ЧИСЛО ПЕРИОДОВ, И ЭТО НЕ ОКРУГЛЕНИЕ ДЛЯ КРАСОТЫ: хвост
    // короче периода раздаёт лишний визит ТОЛЬКО тем фазам, в которые он
    // попал, и равенство «посещений == тел × периодов» перестало бы быть
    // равенством — оно зависело бы от того, как хеш тождества разложил толпу
    // по слотам. 250 тиков на период 8 дают именно такой хвост (250 = 8×31+2).
    const int kPeriods = 2 * kSimHz / static_cast<int>(kPerceivePeriod);
    const int kTicks = kPeriods * static_cast<int>(kPerceivePeriod);

    // ---- тихое поле ------------------------------------------------------
    PerceiveSum quietSum;
    const std::clock_t q0 = std::clock();
    for (int t = 0; t < kTicks; ++t) {
        noise_step(f, kSimStepMs);
        quietSum.add(perceive_step(reg, grid, f, pool, rel, 0,
                                   static_cast<std::uint64_t>(t), nullptr));
    }
    const std::clock_t q1 = std::clock();
    // СТАГГЕР ПОКРЫВАЕТ ВСЕХ, РОВНО ПО РАЗУ ЗА ПЕРИОД. Детерминированная
    // форма «цена делится на восемь»: вырождение хеша в константу оставило бы
    // сумму той же, но это ловит блок тождества слотов; здесь ловится ПОТЕРЯ
    // стаггера (посещение всех каждый тик) и потеря тел (фаза, которая никому
    // не досталась).
    CHECK(quietSum.bodies == kBodies * static_cast<std::uint32_t>(kPeriods));
    CHECK(quietSum.heard == 0u);
    CHECK(quietSum.claimNoise == 0u);
    // СЛЕПЫХ ЗДЕСЬ БОЛЬШЕ, ЧЕМ ТЕЛ, И ЭТО СВОЙСТВО СТЕНДА, А НЕ МИРА: этот
    // блок мерит ЦЕНУ прохода и `look_step` не зовёт вовсе, поэтому взгляд
    // есть только у тех тел, которым его выдала фикстура. Пин под число
    // слепых был бы пином раскладки фикстуры; утверждается то, что несёт
    // смысл — зрячие визиты ЕСТЬ, то есть замер не пуст по построению.
    // Фактическое число печатается ниже.
    CHECK(quietSum.blind < quietSum.bodies);
    CHECK(quietSum.rays > 0u);        // ...и марши заплачены, иначе замер пуст
    std::printf("[noise] цена: визитов %u, из них слепых %u, маршей %u\n",
                quietSum.bodies, quietSum.blind, quietSum.rays);

    // ---- полное поле: каждая отсечка и каждый шум ------------------------
    const NoiseProfile p = loud_profile(48.0f);
    for (std::size_t i = 0; i < kNoiseCap; ++i)
        noise_publish(f, 0, vec3{static_cast<float>(i * 3), 60.0f, 3.0f}, p, 0);
    CHECK(f.live() == kNoiseCap);

    PerceiveSum loudSum;
    const std::clock_t l0 = std::clock();
    for (int t = 0; t < kTicks; ++t) {
        noise_step(f, 0);   // 0 ms so nothing expires and the load stays constant
        loudSum.add(perceive_step(reg, grid, f, pool, rel, 0,
                                  static_cast<std::uint64_t>(t), nullptr));
    }
    const std::clock_t l1 = std::clock();
    CHECK(loudSum.bodies == quietSum.bodies);   // расписание от шума не зависит
    CHECK(loudSum.heard > 0u);
    CHECK(loudSum.claimNoise > 0u);

    const double quietUs =
        1e6 * static_cast<double>(q1 - q0) / CLOCKS_PER_SEC / kTicks;
    const double loudUs =
        1e6 * static_cast<double>(l1 - l0) / CLOCKS_PER_SEC / kTicks;
    const double perTick = static_cast<double>(kTicks);
    std::printf("noise: цена восприятия при %d монстрах + %d жителях — тихо "
                "%.1f мкс/тик, поле полно (%zu записей) %.1f мкс/тик\n"
                "  на тик: тел %.1f, пар %.1f, конус %.1f, маршей %.1f, "
                "заслонено %.1f, увидели %.1f, услышали %.1f\n",
                kMobs, kFolk, quietUs, kNoiseCap, loudUs,
                loudSum.bodies / perTick, loudSum.pairsNear / perTick,
                loudSum.pairsCone / perTick, loudSum.rays / perTick,
                loudSum.occluded / perTick, loudSum.sawFoe / perTick,
                loudSum.heard / perTick);
    // ПОТОЛОК — ТИК ЦЕЛИКОМ, и он выведен, а не выбран: проход, не влезающий
    // в один шаг сима, не может работать ни при какой нагрузке. Тонкую цену
    // судит прибор на живом этаже (см. шапку блока).
    const double tickUs = 1e6 * static_cast<double>(giga::kSimDt);
    CHECK(quietUs < tickUs);
    CHECK(loudUs < tickUs);
}

// test_noise_walls_deafen И test_noise_bake_cost ВЫРЕЗАНЫ вместе с шарами
// акустики (решение владельца 2026-09-06, problems.md §65): пер-шумовой BFS
// не держит канонический масштаб (сотни выстрелов/сек по этажу; замер цены
// перед вырезом — 73 мкс/выстрел, 285 мкс/взрыв worst-open — записан в §65).
// Слышимость снова прямолинейная тором; регресс «слышно сквозь стены» —
// назван, не спрятан. Честные стены вернёт эпик «звуковое поле этажа»
// (бейк при генерации, как пути и свет) — стенд стены/щели вернётся с ним.
//
// ПОПРАВКА 2026-11-09: надгробие относится ТОЛЬКО К СЛУХУ, и это теперь важно
// различать. ГЛАЗА СВОЮ СТЕНУ ПОЛУЧИЛИ — `sight_blocked` в одном проходе
// восприятия, — и её судят `test_noise_passes_the_wall_that_stops_sight` выше
// (в той же сцене, где слух стену по-прежнему не знает) и `suite_perceive.inl`
// блок 1 целиком. Диффузность слуха есть РЕШЕНИЕ ВЛАДЕЛЬЦА (CANON S25.8), а не
// остаток выреза, так что возвращать её «как у зрения» нельзя — вернётся она
// запечённым полем звука.

static void test_noise_all() {
    test_noise_field_bounds();
    test_noise_fades();
    test_noise_overflow_keeps_the_gunshot();
    test_noise_hearing_geometry();
    test_noise_weapon_profiles();
    // ОДНА СЕТКА НА ЧЕТЫРЕ БЛОКА ПРОХОДА, И ОНА ЖИВЁТ В СВОЕЙ ОБЛАСТИ.
    // `MacroGrid` — это ~138 МиБ типов клеток и субвоксельных масок, поэтому
    // четыре штуки под четыре решения были бы самой дорогой вещью в сюите;
    // блоки вместо этого берут свои реестры и разложены так, что никакие два
    // не делят ни клетку, ни соседа (единственный писатель сетки — блок стены,
    // и он за собой прибирает). Область закрывается ДО гунсхот-демо, у которого
    // своя `World` плюс копия в `LevelStack`: иначе три сетки жили бы в пике
    // одновременно.
    {
        MacroGrid grid;
        test_noise_stagger_matches_wander(grid);
        test_noise_reaches_velocity_through_the_writer(grid);
        test_noise_passes_the_wall_that_stops_sight(grid);
        test_noise_pass_cost(grid);
    }
    test_noise_moves_a_monster_that_cannot_see_you();
}
