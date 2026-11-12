// ОДИН ПРОХОД ВОСПРИЯТИЯ — СУД НАД ЗАКОНОМ (CANON S25.8).
//
// ЧТО ЭТОТ ФАЙЛ ОБЯЗАН ЗАРАБОТАТЬ, одной фразой: **тело не видит сквозь стену,
// не видит за спиной, и зрение у него старше слуха — причём ни одно из трёх не
// про игрока.** Всё остальное здесь — оснастка, которая делает эти три
// утверждения непустыми.
//
// ПОЧЕМУ ЭТО НЕ ПОВТОРЕНИЕ `suite_noise.inl`. Тот судит ПОЛЕ ШУМА (кольцо,
// вытеснение, затухание, слышимость тором) и одного потребителя. Здесь
// предметом является ВОСПРИЯТИЕ КАК СИСТЕМА: три отсечки перед одной дорогой,
// строка таблицы вместо ветки в коде и ранг заявки вместо порядка вызовов. До
// `src/game/perceive.*` ни одного из этих предметов в дереве не было:
// «замечание» было сферой без геометрии в семи копиях, а каналы `Perception`
// имели читателей и НИ ОДНОГО производителя.
//
// ЗАМЕР, КОТОРЫЙ ЭТОТ ФАЙЛ ОХРАНЯЕТ (прибор `--action zrenie`, до лечения): на
// этаже 6 СКВОЗЬ СТЕНУ шло **25.7 %** контактов монстров, на падике — **52 %**
// контактов вражды. Блок 1 — тот самый гейт: он падает ровно от той мутации,
// которая эти проценты и вернёт.
//
// ===========================================================================
// ЧТО В ЭТОМ ФАЙЛЕ КРАСНОЕ СЕЙЧАС, И ПОЧЕМУ ЭТО НЕ ДЕФЕКТ СТЕНДА
// ===========================================================================
// ПЕЛЕНГ В `perceive.cpp` ПЕРЕВЁРНУТ. `wrap_delta_f(a, b, period)` по
// контракту ([core/wrap.h]) есть «кратчайшая разность ОТ a К b», то есть
// `b - a`. Проход строит пеленг так:
//
//     perceive.cpp:149-151   bx = wrap_delta_f(tt.pos.x, tr.pos.x, …)
//     perceive.cpp:219-221   hx = wrap_delta_f(n->x,     tr.pos.x, …)
//
// где `tr` — САМ наблюдатель, `tt` — ЦЕЛЬ, `n` — шум. Это даёт `сам − цель`,
// то есть вектор ОТ ЦЕЛИ К НАБЛЮДАТЕЛЮ. Следствий три, и все три
// катастрофические: конус смотрит НАЗАД (тело воспринимает то, что у него за
// спиной), заявка погони ведёт ОТ врага, заявка слуха — ОТ звука.
//
// ТРИ НЕЗАВИСИМЫХ ЯКОРЯ КОНВЕНЦИИ, по которым это видно без запуска:
//   * `wander.cpp:298-300` — пеленг погони: `wrap_delta_f(tr.pos, victimPos)`,
//     то есть «сам → цель»;
//   * `guide.cpp` `steer_to_zone` — шаг к зоне: `wrap_delta_f(pos, центр)`,
//     тот же порядок;
//   * `investigate.h:87` — дословно: «toroidal delta from the mob TO the
//     noise», а `wander.cpp:345-349` намеренно берёт ОБРАТНЫЙ порядок, потому
//     что `frozen_by_gaze` задаёт ДРУГОЙ вопрос («на меня смотрят»), и этот
//     порядок там правильный.
//
// ЛЕЧЕНИЕ — ПОМЕНЯТЬ АРГУМЕНТЫ В ШЕСТИ СТРОКАХ (`perceive.cpp` 149-151 и
// 219-221; седьмая копия тех же трёх строк лежит в `sight_probe.h:265-267` —
// прибор НЕ может поймать эту ошибку, потому что несёт её дословной копией
// вместо вызова самого прохода).
//
// СОСТОЯНИЕ НА 2026-11-12: проход вылечен до посадки (2026-11-09), и блоки
// ниже зелёные. Копия в приборе ПЕРЕЖИЛА лечение прохода на три дня — прибор
// мерил ЗАДНИЙ конус и маршировал пары на шве тора через полмира — и
// вылечена тем же заходом, что блок 14. Абзац оставлен как запись о том, чем
// кончается дословная копия закона в приборе.
//
// Блок 1a ниже изолирует полярность в четыре утверждения и печатает диагноз
// ПЕРВОЙ строкой — красно там, значит красно и всё, что ниже, и по одной
// причине.
//
// ===========================================================================
// ДИСЦИПЛИНА СТЕНДА — ЛОВУШКИ, КАЖДАЯ УЖЕ ЛОВИЛАСЬ КРАСНЫМ В ЭТОМ ДЕРЕВЕ
// ===========================================================================
//   1. СТАГГЕР 1/8 по хешу тождества: тело посещается РОВНО В ОДНОМ тике из
//      `kPerceivePeriod`. Поэтому каждое наблюдение идёт ОКНОМ в целый период
//      (`Stand::window`), а не одним вызовом. Подбирать «тот самый тик»
//      формулой стенд НЕ СТАЛ сознательно: это значило бы переписать соль
//      хеша в тест и молча разъехаться с продом (дословно тот дефект, который
//      `suite_noise.inl` описывает у своего прежнего `visits == 1`).
//   2. ЗАЯВКА ЖИВЁТ РОВНО ОДИН ТИК и опознаётся ШТАМПОМ ТИКА. Поэтому слепок
//      компонента и ранг заявки снимаются ВНУТРИ тика визита, а вторая фаза
//      каждого блока гоняется на НОВЫХ номерах тиков (`t0 += kPerceivePeriod`):
//      на тех же номерах заявка первой фазы читалась бы как живая — ровно то,
//      на чём упал блок заморозки в `suite_behaviours.inl`.
//   3. `kSimDt`/`kSimHz` НЕ ХАРДКОДЯТСЯ — их здесь нет вовсе: восприятие есть
//      система ТИКОВ и МЕТРОВ, времени в ней нет. ttl шума взят заведомо
//      длиннее любого окна, поэтому `noise_step` не зовётся ни разу.
//   4. ТРУПЫ (`Dead`) из восприятия исключены: ни одна сцена не стоит на
//      мёртвом теле, а сам факт исключения судится блоком 10.
//
// ТРИ БЛОКА ЗДЕСЬ ПИНЯТ ДЕФЕКТ, А НЕ ЗАКОН (3b, 7b, 9b), и каждый говорит об
// этом вслух. Это та же форма, которой `suite_behaviours.inl` пинит
// расхождение с референсом: найденное расхождение, записанное УТВЕРЖДЕНИЕМ,
// падает в день починки и показывает пальцем на причину — в отличие от
// найденного расхождения, записанного комментарием.
#include <cmath>
#include <cstdio>
#include <vector>

#include "core/rng.h"               // hash_u32 — тот же, которым живёт стаггер
#include "core/wrap.h"
#include "game/combat.h"            // Dead — труп вне восприятия
#include "game/embody.h"            // NpcRef, embody_as_player
#include "game/faction.h"
#include "game/faction_relations.h" // kBaseFactionMatrix, mob_hostile_to
#include "game/guide.h"             // Steer/SteerRank/guide_step — писатель
#include "game/investigate.h"       // kInvestigateMinSeverity/Hearing/Arrive
#include "game/look.h"              // Look, look_step, looking_at, look_birth_dir
#include "game/mob_behaviour.h"     // kGazeCosHalfAngle, behaviour_aggro_radius
#include "game/mob_spawn.h"         // MobRef
#include "game/mob_table.h"         // mob_def
#include "game/noise.h"             // поле шума — второй канал восприятия
#include "game/npc_pool.h"
#include "game/perceive.h"          // ПРЕДМЕТ
#include "game/wander.h"            // kAggroRadius, kWanderPeriod
#include "game/witness.h"           // kWitnessSightM, kEyeLiftM
#include "game/zone_nav.h"
#include "sim/camera.h"             // camera_forward — взгляд носителя камеры
#include "world/gravity.h"
#include "world/los.h"              // sub_march — что стоит за дверью заслонения
#include "world/macro_grid.h"
#include "world/materials.h"        // kMatConcrete
#include "world/types.h"

namespace perceive_detail {

inline bool near_eq(float a, float b, float eps = 1e-3f) {
    return std::fabs(a - b) <= eps;
}

// Скорость тела из ЕГО СТРОКИ, м/с. Копия перевода `speedMmps * 0.001 *
// kCellSize` здесь сознательна и ровно того же вида, что `table_speed` в
// `suite_behaviours.inl`: блоки ниже судят, что писатель исполнил ЗАЯВЛЕННУЮ
// скорость, а не подставил свою (`kWalkSpeedMps` подошёл бы по порядку
// величины и прошёл бы проверку «|v| > 0» незамеченным).
inline float mob_speed_mps(MobKind k) {
    return static_cast<float>(mob_def(k).speedMmps) * 0.001f * kCellSize;
}

inline float len3(const vec3& v) {
    return std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// Мировой СУБВОКСЕЛЬНЫЙ индекс точки — тем же полом, которым его считает
// `sub_march` ([world/los.cpp] `split_sub`). Нужен ровно затем, чтобы
// геометрия блока 1 была ВЫВЕДЕНА: щель в один субвоксель, найденная наугад,
// не гейт, а совпадение.
inline int sub_index_of(float m) {
    return static_cast<int>(std::floor(m / kVoxelSize));
}

// ---- ГЕОМЕТРИЯ АРЕНЫ -------------------------------------------------------
//
// Луч заслонения идёт ОТ ГЛАЗА к глазу цели, а глаз поднят на `kEyeLiftM`
// ([game/witness.h]) — значит высота ТЕЛА обязана выводиться из высоты ГЛАЗА,
// а не наоборот. Глаз посажен на 10.125 м = 40.5 субвокселя: это ряд sz = 0
// клетки z = 5, и ряд один и тот же у обоих тел, поэтому отрезок горизонтален
// и целиком лежит в одном субвоксельном ряду. Та же арифметика по y. Числа
// проверяются `sub_index_of` в блоке 1 — не комментарием.
inline constexpr float kEyeZ = 10.125f;
inline constexpr float kStandZ = kEyeZ - kEyeLiftM;   // 9.525 м — высота тела
inline constexpr int kEyeCellZ = 5;
inline constexpr int kEyeSubZ = 0;
inline constexpr int kRaySubY = 0;

// Шум публикуется от АНОНИМА. Ноль здесь — не «любой актор», а именно
// «фильтра нет» ([game/noise.cpp]: отсечка `ignoreActor != 0`), и это важно
// ровно потому, что ПЕРВАЯ созданная сущность реестра имеет
// `entt::to_integral == 0`: публикуй шум от «нулевого актора» как от тела, и
// первое тело стенда перестало бы его слышать как свой собственный.
inline constexpr std::uint32_t kAnon = 0u;

// Громкий долгий шум, слышный почти всему тору. ttl заведомо длиннее любого
// окна, поэтому `noise_step` не зовётся и ни одно утверждение не зависит от
// шага времени (ловушка 3 в шапке).
inline NoiseProfile loud_noise() {
    NoiseProfile p;
    p.radius = kNoiseRadiusCap;
    p.ttlMs = 60000;
    p.severity = 4;
    p.source = NoiseSource::WeaponFire;
    return p;
}

// Винтовочный шум: радиус 24 м, то есть слышимость 24 x 1.12 = 26.88 м. Нужен
// там, где шум обязан быть слышен ОДНОМУ телу и не слышен другому — иначе
// счётчики `heard`/`claimNoise` стали бы суммой двух тел и ничего не
// атрибутировали.
inline NoiseProfile rifle_noise() {
    NoiseProfile p = loud_noise();
    p.radius = 24.0f;
    return p;
}

inline void tick_add(PerceiveTick& a, const PerceiveTick& b) {
    a.bodies += b.bodies;
    a.blind += b.blind;
    a.scanned += b.scanned;
    a.pairsNear += b.pairsNear;
    a.pairsCone += b.pairsCone;
    a.rays += b.rays;
    a.occluded += b.occluded;
    a.sawFoe += b.sawFoe;
    a.heard += b.heard;
    a.claimSight += b.claimSight;
    a.claimNoise += b.claimNoise;
}

inline void guide_add(GuideTick& a, const GuideTick& b) {
    a.led += b.led;
    a.held += b.held;
    a.stale += b.stale;
    a.bogus += b.bogus;
    a.unresolved += b.unresolved;
    a.foreign += b.foreign;
    for (std::size_t i = 0; i < kSteerRankCount; ++i) a.byRank[i] += b.byRank[i];
}

// Что случилось с ОДНИМ телом за полный период восприятия.
struct Watched {
    PerceiveTick sum{};                 // счётчики прохода, сложенные по окну
    GuideTick guide{};                  // то же у писателя, если он звался
    Senses sen{};                       // слепок компонента В ТИК ВИЗИТА
    Target target{};                    // цель живой заявки того же тика
    SteerRank rank = SteerRank::None;   // и её ранг
    std::uint32_t visits = 0;           // тиков окна, в которых тело посещено
    std::uint64_t at = 0;               // номер последнего такого тика
    bool claimed = false;               // заявка в тик визита вообще была
};

// СТЕНД. Один объект, потому что окно иначе пришлось бы выписать в каждом
// блоке — а копия оснастки и есть то место, где один блок однажды забудет
// позвать писателя и начнёт судить скорость, записанную ДО вызова (дословно
// лечение `steer_tick` в `suite_behaviours.inl`).
//
// `zn` ВЫРОЖДЕН (`arm_zones_one`: зона есть, идти некуда) по той же причине,
// по которой он вырожден у семи других сюит. Заявки восприятия имеют вид
// `Dir`, то есть нава не спрашивают вовсе, и единственное, что настоящий бейк
// мог бы тут сделать — подмешать в скорость чужой шаг; прогулка здесь не
// зовётся, но фикстура стоит, чтобы `guide_step` судился на том же наве, что
// в игре.
struct Stand {
    Registry reg;
    NoiseField noise;
    NpcPool pool;
    FactionRelations rel = kBaseFactionMatrix;
    ZoneNav zn;
    LayerId layer = 0;
    const GravityField* gravity = nullptr;

    Stand() {
        pool.init();
        zone_fixture::arm_zones_one(zn);
    }

    Entity mob(MobKind k, const vec3& at) {
        const Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{at, layer});
        reg.emplace<Velocity>(e, Velocity{});
        const std::int16_t hp = static_cast<std::int16_t>(mob_def(k).hp);
        reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(k), 1, hp, hp});
        return e;
    }

    Entity resident(Faction f, const vec3& at) {
        const NpcId id = pool.spawn();
        pool.hp(id) = 100;
        pool.max_hp(id) = 100;
        pool.faction(id) = static_cast<std::uint16_t>(f);
        pool.height_mm(id) = 1750;
        const Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{at, layer});
        reg.emplace<Velocity>(e, Velocity{});
        reg.emplace<NpcRef>(e, NpcRef{id});
        return e;
    }

    // Взгляд КЛАДЁТСЯ РУКОЙ, и это не обход `look_step`: блоки конуса обязаны
    // поставить направление ТОЧНО (равенства с нулём ниже должны быть
    // свойством конуса, а не остатком тригонометрии), а сам проход взгляда
    // судится блоком 9 целиком и отдельно.
    void aim(Entity e, const vec3& dir) {
        reg.emplace_or_replace<Look>(e, Look{normalize(dir)});
    }

    std::uint32_t publish(const vec3& at, const NoiseProfile& p) {
        return noise_publish(noise, layer, at, p, kAnon);
    }

    template <class Fn>
    Watched window(const MacroGrid& grid, Entity watch, std::uint64_t from,
                   Fn&& after) {
        Watched out{};
        for (std::uint64_t t = from; t < from + kPerceivePeriod; ++t) {
            tick_add(out.sum, perceive_step(reg, grid, noise, pool, rel, layer,
                                            t, gravity));
            const Senses* s =
                watch == entt::null ? nullptr : reg.try_get<Senses>(watch);
            // ШТАМП ТИКА — И ЕСТЬ «проход меня посетил». Существование
            // компоненты этого не говорит: она переживает окно и несёт ответ
            // ПРОШЛОГО визита.
            if (s != nullptr && s->tick == static_cast<std::uint32_t>(t)) {
                ++out.visits;
                out.at = t;
                out.sen = *s;
                const Steer* st = reg.try_get<Steer>(watch);
                if (st != nullptr && steer_claim_live(*st, t)) {
                    out.claimed = true;
                    out.rank = st->rank;
                    out.target = st->target;
                }
            }
            after(t);
        }
        return out;
    }

    Watched window(const MacroGrid& grid, Entity watch, std::uint64_t from) {
        return window(grid, watch, from, [](std::uint64_t) {});
    }

    // ...то же окно, но с ЕДИНСТВЕННЫМ ПИСАТЕЛЕМ СКОРОСТИ в том же тике и с
    // той же гравитацией. Иначе блок судил бы скорость, записанную ДО вызова.
    Watched window_led(const MacroGrid& grid, Entity watch, std::uint64_t from) {
        GuideTick acc{};
        Watched out = window(grid, watch, from, [&](std::uint64_t t) {
            guide_add(acc, guide_step(reg, zn, layer, t, gravity));
        });
        out.guide = acc;
        return out;
    }
};

// Субвоксельная ПАНЕЛЬ в один атом толщиной у ближней грани клетки, БЕЗ смены
// типа клетки. Форма взята у `test_wall_probe@suite_behaviours.inl` и ровно по
// той же причине: по снесённому клеточному закону (`grid.cell != kCellAir`)
// такой стены не существует вовсе, значит она и отличает субвоксельный ответ
// от макро-ответа.
inline void stamp_panel(MacroGrid& g, int cx, int cy, int cz, int sx) {
    for (int sy = 0; sy < kSubDim; ++sy)
        for (int sz = 0; sz < kSubDim; ++sz)
            g.mask(cx, cy, cz).set(sub_bit(sx, sy, sz));
}

inline void wipe_cell(MacroGrid& g, int cx, int cy, int cz) {
    g.mask(cx, cy, cz).clear_all();
    g.set_cell(cx, cy, cz, kCellAir);
}

} // namespace perceive_detail

static void test_perceive_all() {
    using namespace perceive_detail;

    // ОДНА АРЕНА НА ВЕСЬ ФАЙЛ: `MacroGrid` — это ~138 МиБ типов клеток и
    // субвоксельных масок, и строить её под каждый блок было бы самым дорогим,
    // что есть в сюите. Блоки разложены по РАЗНЫМ рядам y, поэтому ни один не
    // делит с другим ни клетку, ни соседа; каждый, кто штампует материю,
    // убирает за собой `wipe_cell`.
    MacroGrid grid;

    // ---- 0. СТРОКА ВОСПРИЯТИЯ — ЧИСТАЯ ДАТА --------------------------------
    {
        // СТРОКА НА СВОЁМ МЕСТЕ. `sense_sight_m` индексирует таблицу кастом
        // класса, поэтому переставленные (или продублированные) строки отдали
        // бы монстру дальность жителя — и НИ ОДИН блок ниже этого не заметил
        // бы: все они мерили бы «какое-то» расстояние. Мутация: поменять две
        // строки `kSenseRows` местами.
        std::size_t blindRows = 0;
        for (std::size_t i = 0; i < kSenseClassCount; ++i) {
            const SenseRow& row = kSenseRows[i];
            CHECK(row.cls == static_cast<SenseClass>(i));
            CHECK(row.name != nullptr);
            CHECK(row.sightM > 0.0f);
            CHECK(row.hearingMult > 0.0f);
            if (row.fovCos > 1.0f) ++blindRows;
        }
        // Та же проверка у таблицы РАНГОВ: имя ранга ищется индексом, и
        // переставленная строка переименовала бы заявку в печати (и в приборе).
        for (std::size_t i = 0; i < kSteerRankCount; ++i)
            CHECK(kSteerRankRows[i].rank == static_cast<SteerRank>(i));

        // ЧИСЛА — ПЕРЕНОС, А НЕ ВЫБОР. Каждое обязано приезжать из своего
        // ДОМА, и мутация, которую ловят эти девять строк, — замена ссылки
        // литералом («20.0f» вместо `kAggroRadius`): дальность поедет от дома
        // молча, и «вижу» у одного тела станет двумя разными числами.
        const SenseRow& mon = kSenseRows[static_cast<std::size_t>(SenseClass::Monster)];
        const SenseRow& res = kSenseRows[static_cast<std::size_t>(SenseClass::Resident)];
        const SenseRow& hum = kSenseRows[static_cast<std::size_t>(SenseClass::Human)];
        CHECK(mon.sightM == kAggroRadius);
        CHECK(res.sightM == kWitnessSightM);
        CHECK(hum.sightM == kWitnessSightM);
        CHECK(mon.fovCos == kGazeCosHalfAngle);
        CHECK(res.fovCos == kGazeCosHalfAngle);
        CHECK(hum.fovCos == kGazeCosHalfAngle);
        CHECK(mon.hearingMult == kInvestigateHearing);
        CHECK(res.hearingMult == kInvestigateHearing);
        CHECK(hum.hearingMult == kInvestigateHearing);
        // «Конус восприятия и конус взгляда суть одна величина» (CANON S25.7):
        // единственный конус, который в дереве уже был, — конус заморозки
        // Скульптуры, и теперь он же конус зрения. Мутация: завести у
        // восприятия СВОЙ косинус. Утверждение о константах, поэтому
        // `static_assert`, а не CHECK (C4127 под /W4 — довод в блоке 10
        // `suite_behaviours.inl`).
        static_assert(kGazeCosHalfAngle > 0.0f && kGazeCosHalfAngle < 1.0f,
                      "конус обязан быть конусом, а не полусферой и не лучом");

        // ЗРЕНИЕ СТАРШЕ СЛУХА — РАНГОМ, А НЕ ПОРЯДКОМ ВЫЗОВОВ. Мутация:
        // переставить энумераторы `SteerRank` — и моб, вцепившийся в жителя,
        // снова будет бросать его на любой выстрел.
        static_assert(SteerRank::Noise < SteerRank::Chase,
                      "слух обязан быть СЛАБЕЕ зрения: это и есть арбитраж");
        static_assert(SteerRank::Walk < SteerRank::Noise,
                      "...и сильнее прогулки, иначе услышанное не перебивает "
                      "даже блуждание");
        static_assert(SteerRank::Chase < SteerRank::Flee,
                      "бегство остаётся сильнейшим: увидел врага — не повод "
                      "перестать убегать");
        // ТОЖДЕСТВО СЛОТОВ СТАГГЕРА с прогулкой — то, чем «зрение старше
        // слуха» вообще НАБЛЮДАЕМО в одном тике. Разъехались бы периоды —
        // блок 4 мерил бы два разных тика и прошёл бы при любом арбитраже.
        static_assert(kPerceivePeriod == kWanderPeriod,
                      "период восприятия обязан совпадать с периодом прогулки");

        // ПЕРЕОПРЕДЕЛЕНИЕ СТРОКОЙ МОНСТРА — та же форма «дефолт + поведение»,
        // которой живёт `behaviour_aggro_radius`. Проверяется в обе стороны:
        // вид, который видит ДАЛЬШЕ дефолта, и вид, который видит БЛИЖЕ.
        MobRef plain{static_cast<std::uint8_t>(MobKind::Zombie), 1, 10, 10};
        MobRef carpet{static_cast<std::uint8_t>(MobKind::SporeCarpet), 1, 10, 10};
        MobRef lamp{static_cast<std::uint8_t>(MobKind::Lishennyy), 1, 10, 10};
        MobRef deaf{static_cast<std::uint8_t>(MobKind::Bezekhiy), 1, 10, 10};
        // Мусорный вид: байт за концом таблицы. Мутация, которую ловит эта
        // пара, — снять проверку `kind >= kMobKindCount` и читать строку за
        // границей массива.
        MobRef junk{static_cast<std::uint8_t>(kMobKindCount + 7u), 1, 10, 10};

        // Блок называет КИНД, а судит ПОВЕДЕНИЕ — иначе уехавшая строка CSV
        // оставила бы всё ниже зелёным и мерящим не то.
        CHECK(mob_def(MobKind::SporeCarpet).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::LurkingFurniture));
        CHECK(mob_def(MobKind::Lishennyy).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::LightFollower));
        CHECK(mob_def(MobKind::Bezekhiy).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::DeadEcho));
        CHECK(mob_def(MobKind::Zombie).behaviour ==
              static_cast<std::uint8_t>(MobBehaviour::Plain));

        CHECK(sense_sight_m(SenseClass::Monster, nullptr) == kAggroRadius);
        CHECK(sense_sight_m(SenseClass::Monster, &plain) == kAggroRadius);
        CHECK(sense_sight_m(SenseClass::Monster, &carpet) ==
              behaviour_aggro_radius(MobBehaviour::LurkingFurniture, kAggroRadius));
        CHECK(sense_sight_m(SenseClass::Monster, &carpet) < kAggroRadius);
        CHECK(sense_sight_m(SenseClass::Monster, &lamp) ==
              behaviour_aggro_radius(MobBehaviour::LightFollower, kAggroRadius));
        CHECK(sense_sight_m(SenseClass::Monster, &lamp) > kAggroRadius);
        CHECK(sense_sight_m(SenseClass::Monster, &junk) == kAggroRadius);
        // ...и строка МОНСТРА не переопределяет ЧУЖОЙ класс. Мутация: снять
        // гейт `cls != SenseClass::Monster` — и житель, у которого рядом
        // оказалась компонента `MobRef` (вселение, труп, отладочный спавн),
        // начал бы видеть на 2.15 м.
        CHECK(sense_sight_m(SenseClass::Resident, &carpet) == kWitnessSightM);
        CHECK(sense_sight_m(SenseClass::Human, &carpet) == kWitnessSightM);

        CHECK(sense_hearing_mult(SenseClass::Monster, nullptr) == kInvestigateHearing);
        CHECK(sense_hearing_mult(SenseClass::Monster, &plain) == kInvestigateHearing);
        CHECK(sense_hearing_mult(SenseClass::Monster, &junk) == kInvestigateHearing);
        // ГЛУХОТА — ДАТА: Безэхий получает НОЛЬ множителя. Мутация: вернуть
        // ветку `if (beh == MobBehaviour::DeadEcho) return out;` в код прохода.
        // (Исполняется ли этот ноль — предмет блока 3b, и ответ там «нет».)
        CHECK(sense_hearing_mult(SenseClass::Monster, &deaf) == 0.0f);
        CHECK(sense_hearing_mult(SenseClass::Resident, &deaf) == kInvestigateHearing);

        std::printf("[восприятие] таблица: %zu строк, слепых по строке "
                    "(fovCos > 1) сегодня %zu; зрение монстра %.1f м, жителя "
                    "%.1f м, конус 2x%.0f градусов\n",
                    kSenseClassCount, blindRows,
                    static_cast<double>(mon.sightM),
                    static_cast<double>(res.sightM),
                    static_cast<double>(std::acos(kGazeCosHalfAngle) * 180.0 /
                                        3.14159265358979));
    }

    // ---- 1a. ПОЛЯРНОСТЬ ПЕЛЕНГА — ОДНА ТОЧКА, ОДИН ОТВЕТ ------------------
    //
    // ЕСЛИ КРАСНО ЗДЕСЬ, ТО КРАСНО И ВСЁ НИЖЕ, И ПО ЭТОЙ ЖЕ ПРИЧИНЕ. Разбор и
    // лечение — в шапке файла (`perceive.cpp` 149-151 и 219-221).
    //
    // КОНВЕНЦИЯ — САМО УТВЕРЖДЕНИЕ, А НЕ ВКУС: `looking_at(fwd, d…)` сравнивает
    // `dot(d, fwd)` с косинусом, значит `d` обязан идти ОТ НАБЛЮДАТЕЛЯ К ЦЕЛИ.
    // Тело, смотрящее в +x, видит цель, стоящую в +x, и не видит стоящую в −x —
    // двух строк хватает, чтобы это было не мнение.
    {
        const vec3 fwd{1.0f, 0.0f, 0.0f};
        CHECK(looking_at(fwd, 10.0f, 0.0f, 0.0f, kGazeCosHalfAngle));
        CHECK(!looking_at(fwd, -10.0f, 0.0f, 0.0f, kGazeCosHalfAngle));

        // ...И ТОТ ЖЕ ВОПРОС ПРОХОДУ. Два тела, чистая линия, враг СТРОГО
        // ВПЕРЕДИ по направлению взгляда.
        const float y = 44.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 aheadAt{42.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, aheadAt);
        st.aim(obs, fwd);
        const Watched w = st.window(grid, obs, 1);
        std::printf("[восприятие] ПОЛЯРНОСТЬ: тело смотрит в +x, враг в +x на "
                    "%.0f м → pairsNear %u, pairsCone %u, sawFoe %u "
                    "(обязаны быть 1/1/1)\n",
                    static_cast<double>(aheadAt.x - obsAt.x),
                    static_cast<unsigned>(w.sum.pairsNear),
                    static_cast<unsigned>(w.sum.pairsCone),
                    static_cast<unsigned>(w.sum.sawFoe));
        CHECK(w.sum.pairsNear == 1u);
        CHECK(w.sum.pairsCone == 1u);
        CHECK(w.sen.foe == foe);
    }

    // ---- 1. ЗАСЛОНЕНИЕ РАБОТАЕТ — ГЛАВНЫЙ ГЕЙТ ФАЙЛА ----------------------
    //
    // Две сцены на ОДНОМ расстоянии, отличающиеся ровно наличием материи между
    // телами. Расстояние 12 м — внутрь 20 м зрения монстра с запасом, чтобы
    // отказ нельзя было спутать с дальностью.
    //
    // МУТАЦИИ, КОТОРЫЕ ЛОВИТ ЭТОТ БЛОК (все четыре возвращают замеренные
    // 25.7 % контактов сквозь стену):
    //   * `sight_blocked` → `return false` (третьей отсечки нет);
    //   * `sub_march` → клеточный предикат `grid.cell(...) != kCellAir`:
    //     лепленая панель в «воздушной» клетке перестала бы быть стеной, а
    //     фаза B штампует ИМЕННО её и тип клетки НЕ ставит;
    //   * луч от позиции тела вместо глаза (`kEyeLiftM` потерян) — щель в один
    //     атом фазы C мимо такого луча пройдёт;
    //   * отсечка переставлена ПЕРЕД конусом (цена: луч за каждую пару —
    //     §66 заплатил за это 631 мкс/деяние и вылечился x162).
    {
        const float y = 40.125f;                 // клетка 20, ряд sy = 0
        const int cy = cell_of_metres(y);
        // ГЕОМЕТРИЯ ВЫВЕДЕНА, А НЕ ПОДОБРАНА: глаз обязан сесть в нулевой
        // субвоксельный ряд клетки, иначе «щель в один атом» ниже —
        // совпадение, а не гейт.
        CHECK(cy == 20);
        CHECK(cell_of_metres(kEyeZ) == kEyeCellZ);
        CHECK(sub_index_of(kEyeZ) == kEyeCellZ * kSubDim + kEyeSubZ);
        CHECK(sub_index_of(y) == cy * kSubDim + kRaySubY);

        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 foeAt{42.1f, y, kStandZ};     // РОВНО 12 м по +x
        const float want = foeAt.x - obsAt.x;    // независимый расчёт: 12 м
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});     // смотрит ПРЯМО на цель
        // Предпосылки, без которых блок прошёл бы вакуумно.
        CHECK(mob_hostile_to(st.pool, st.reg.get<const NpcRef>(foe).id));
        CHECK(want < sense_sight_m(SenseClass::Monster,
                                   st.reg.try_get<MobRef>(obs)));
        // Цель НЕ смотрит (взгляда нет вовсе), поэтому все лучи окна
        // принадлежат наблюдателю — без этого счётчики `rays`/`occluded` были
        // бы суммой двух тел и ничего не атрибутировали.
        CHECK(st.reg.try_get<Look>(foe) == nullptr);

        std::uint64_t t0 = 1;

        // --- A. ПРЯМАЯ ВИДИМОСТЬ -------------------------------------------
        const Watched clear = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(clear.visits == 1u);               // стаггер: ровно один визит
        CHECK(clear.sum.bodies == 2u);
        CHECK(clear.sum.blind == 1u);            // цель без взгляда
        CHECK(clear.sum.pairsNear == 1u);
        CHECK(clear.sum.pairsCone == 1u);
        CHECK(clear.sum.rays == 1u);             // луч заплачен РОВНО ОДИН
        CHECK(clear.sum.occluded == 0u);
        CHECK(clear.sum.sawFoe == 1u);
        CHECK(clear.sen.foe == foe);
        CHECK(clear.sen.visible == 1u);
        CHECK(near_eq(clear.sen.foeDist, want));
        CHECK(clear.sen.tick == static_cast<std::uint32_t>(clear.at));
        CHECK(clear.claimed);
        CHECK(clear.rank == SteerRank::Chase);
        CHECK(clear.target.kind == TargetKind::Dir);
        CHECK(clear.sum.claimSight == 1u);
        CHECK(clear.sum.claimNoise == 0u);

        // --- B. ТА ЖЕ ПАРА, ЛЕПЛЕНАЯ ПАНЕЛЬ МЕЖДУ -------------------------
        const int wallCx = 18;                   // 36.00..36.25 м — внутри зазора
        CHECK(wallCx > cell_of_metres(obsAt.x));
        CHECK(wallCx < cell_of_metres(foeAt.x));
        stamp_panel(grid, wallCx, cy, kEyeCellZ, 0);
        // ТИП КЛЕТКИ ОСТАЛСЯ ВОЗДУХОМ: по снесённому клеточному закону стены
        // здесь нет вовсе, и ровно это отличает субвоксельный ответ от макро.
        CHECK(grid.cell(wallCx, cy, kEyeCellZ) == kCellAir);
        CHECK(grid.solid(wallCx, cy, kEyeCellZ, 0, kRaySubY, kEyeSubZ));
        // Дверь заслонения — ПРЯМО, до всякого прохода: один вопрос, один
        // читатель. Отрезок тот же, что построит проход (глаз → глаз).
        const vec3 eye{obsAt.x, obsAt.y, obsAt.z + kEyeLiftM};
        const vec3 at{foeAt.x, foeAt.y, foeAt.z + kEyeLiftM};
        CHECK(near_eq(eye.z, kEyeZ));
        CHECK(sight_blocked(grid, eye, at));
        CHECK(sight_blocked(grid, at, eye));     // заслон симметричен

        const Watched walled = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(walled.visits == 1u);
        CHECK(walled.sum.pairsNear == 1u);       // дистанция пройдена...
        CHECK(walled.sum.pairsCone == 1u);       // ...и конус пройден...
        CHECK(walled.sum.rays == 1u);
        CHECK(walled.sum.occluded == 1u);        // ...а ОТКЛОНИЛ ЛУЧ
        CHECK(walled.sum.sawFoe == 0u);
        CHECK(walled.sen.foe == entt::null);
        CHECK(walled.sen.visible == 0u);
        CHECK(walled.sen.foeDist < 0.0f);        // «врага не видно» — не ноль
        CHECK(walled.sum.claimSight == 0u);
        // ПРОШЛЫЙ ОТВЕТ СТЁРТ, А НЕ ОСТАВЛЕН. Мутация: не чистить `Senses` на
        // входе — и моб гнался бы за врагом, которого видел минуту назад,
        // вечно (тот же класс, что «инвентарь пустеет»: состояние без хозяина).
        CHECK(walled.sen.tick == static_cast<std::uint32_t>(walled.at));
        CHECK(walled.sen.tick != clear.sen.tick);

        // --- C. ЩЕЛЬ В ОДИН СУБВОКСЕЛЬ ------------------------------------
        // Клетка 511/512 всё ещё почти полная, но реальная щель ОБЯЗАНА
        // пропускать взгляд — тот же закон и тот же приём, которым судится
        // свет (`solidity_law@suite_lightvis.inl`). Мутация: округлить ответ
        // заслонения до клетки (хоть «любой солид в клетке», хоть
        // `sub_thickness_cells > 0`).
        grid.mask(wallCx, cy, kEyeCellZ).clear(sub_bit(0, kRaySubY, kEyeSubZ));
        CHECK(!sight_blocked(grid, eye, at));
        const Watched slit = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(slit.sum.occluded == 0u);
        CHECK(slit.sen.foe == foe);
        CHECK(slit.sen.visible == 1u);
        CHECK(near_eq(slit.sen.foeDist, want));

        // --- D. ПОЛНАЯ КЛЕТКА ---------------------------------------------
        grid.fill_cell(wallCx, cy, kEyeCellZ, kMatConcrete);
        CHECK(grid.cell(wallCx, cy, kEyeCellZ) != kCellAir);
        CHECK(sight_blocked(grid, eye, at));
        const Watched solid = st.window(grid, obs, t0);
        CHECK(solid.sum.occluded == 1u);
        CHECK(solid.sen.visible == 0u);
        CHECK(solid.sen.foe == entt::null);

        wipe_cell(grid, wallCx, cy, kEyeCellZ);
        CHECK(!sight_blocked(grid, eye, at));    // арена сдана чистой
        std::printf("[восприятие] заслонение на %.0f м: чисто — вижу (%u луч), "
                    "панель в 1 атом (тип клетки ВОЗДУХ) — не вижу, щель в "
                    "1 атом — снова вижу, полная клетка — не вижу\n",
                    static_cast<double>(want),
                    static_cast<unsigned>(clear.sum.rays));
    }

    // ---- 2. КОНУС РАБОТАЕТ, И ОН АГНОСТИЧЕН -------------------------------
    //
    // Наблюдатель — ЖИТЕЛЬ: у него нет ни камеры, ни кватерниона, ни yaw, и до
    // `[game/look.h]` вопрос «куда он смотрит» был НЕВЫРАЗИМ — поэтому конус
    // проверяется именно на нём, а не на носителе камеры. Враг стоит ЗА
    // СПИНОЙ, на расстоянии, которое дистанция пропускает.
    //
    // МУТАЦИЯ: снять вторую отсечку (вернуть «сферу без геометрии», как было в
    // семи копиях скана «ближайшее тело в шаре»), либо спрашивать конус только
    // у тела с `CameraTag` — ровно то, что владелец назвал «игрок чем-то
    // особен» и велел снести.
    {
        const float y = 60.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 behindAt{20.1f, y, kStandZ};   // 10 м по −x, за спиной
        const Entity obs = st.resident(Faction::Citizens, obsAt);
        const Entity foe = st.mob(MobKind::Zombie, behindAt);
        CHECK(st.reg.try_get<CameraTag>(obs) == nullptr);  // НЕ носитель камеры
        CHECK(st.reg.try_get<Look>(foe) == nullptr);       // враг не смотрит
        const float gap = obsAt.x - behindAt.x;
        CHECK(gap < sense_sight_m(SenseClass::Resident, nullptr));

        std::uint64_t t0 = 1;

        // --- A. СМОТРИТ В ДРУГУЮ СТОРОНУ -----------------------------------
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        const Watched back = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(back.visits == 1u);
        CHECK(back.sum.pairsNear == 1u);   // дистанция и вражда пройдены...
        CHECK(back.sum.pairsCone == 0u);   // ...и ОТКЛОНИЛ КОНУС
        CHECK(back.sum.rays == 0u);        // за конусом луч не заплачен
        CHECK(back.sum.occluded == 0u);    // и отказ НЕ списан на материю
        CHECK(back.sen.visible == 0u);
        CHECK(back.sen.foe == entt::null);
        CHECK(back.sum.claimSight == 0u);

        // --- B. ТОТ ЖЕ ВРАГ ПОСЛЕ ПОВОРОТА ВЗГЛЯДА -------------------------
        st.aim(obs, vec3{-1.0f, 0.0f, 0.0f});
        const Watched front = st.window(grid, obs, t0);
        CHECK(front.visits == 1u);
        CHECK(front.sum.pairsCone == 1u);
        CHECK(front.sum.rays == 1u);
        CHECK(front.sen.visible == 1u);
        CHECK(front.sen.foe == foe);
        CHECK(near_eq(front.sen.foeDist, gap));
        // ЖИТЕЛЬ ЗАЯВЛЯЕТ ПОГОНЮ — и это записано здесь, а не обойдено: вид
        // заявки у зрения ОДИН на все тела, а «бежать, а не идти навстречу» —
        // дело заявителя сильнейшего ранга (`SteerRank::Flee`), которого в
        // этой сцене нет. Скорость заявки пешая, потому что строки монстра у
        // жителя нет — и это тот самый `kWalkSpeedMps`, единственный дом 1.35.
        CHECK(front.claimed);
        CHECK(front.rank == SteerRank::Chase);
        CHECK(near_eq(front.target.speed, kWalkSpeedMps));

        // --- C. КРАЙ КОНУСА, ПРЯМО НА ПРИМИТИВЕ ----------------------------
        // Порог включающий (`>=`): тело РОВНО на краю видно. Обе стороны,
        // иначе сдвиг сравнения на один знак невидим под любым другим углом.
        const float half = std::acos(kGazeCosHalfAngle);
        const vec3 fwd{1.0f, 0.0f, 0.0f};
        CHECK(looking_at(fwd, std::cos(half) * 10.0f, std::sin(half) * 10.0f,
                         0.0f, kGazeCosHalfAngle));
        CHECK(!looking_at(fwd, std::cos(half + 0.02f) * 10.0f,
                          std::sin(half + 0.02f) * 10.0f, 0.0f,
                          kGazeCosHalfAngle));
        // Конус СИММЕТРИЧЕН по знаку поперечной оси и по ТРЕТЬЕЙ оси тоже —
        // мутация «считать конус по двум осям x/y» (взгляд в зенит морозил
        // Скульптуру под ногами) прошла бы всё выше.
        CHECK(looking_at(fwd, std::cos(half) * 10.0f, 0.0f,
                         std::sin(half) * 10.0f, kGazeCosHalfAngle));
        CHECK(looking_at(fwd, std::cos(half) * 10.0f, 0.0f,
                         -std::sin(half) * 10.0f, kGazeCosHalfAngle));
        // Длина пеленга НЕ входит в ответ (это угол, а не дальность): та же
        // сторона на 100 м и на 1 см отвечается одинаково.
        CHECK(looking_at(fwd, 100.0f, 0.0f, 0.0f, kGazeCosHalfAngle));
        CHECK(looking_at(fwd, 0.01f, 0.0f, 0.0f, kGazeCosHalfAngle));
        // Взгляда нет — не смотрит. Мутация: убрать отказ по `f2 < 1e-6` —
        // нулевой взгляд дал бы деление на ноль и «вижу всё» при `cosHalf <= 0`.
        CHECK(!looking_at(vec3{0.0f, 0.0f, 0.0f}, 1.0f, 0.0f, 0.0f,
                          kGazeCosHalfAngle));
        std::printf("[восприятие] конус на теле БЕЗ камеры: за спиной — "
                    "pairsNear %u / pairsCone %u, после поворота — %u / %u\n",
                    static_cast<unsigned>(back.sum.pairsNear),
                    static_cast<unsigned>(back.sum.pairsCone),
                    static_cast<unsigned>(front.sum.pairsNear),
                    static_cast<unsigned>(front.sum.pairsCone));
    }

    // ---- 3. СЛЕПОТА — СТРОКА, А НЕ ВЕТКА ----------------------------------
    //
    // ЧЕСТНОЕ ОГРАНИЧЕНИЕ, НАЗВАННОЕ ВСЛУХ: строки со `fovCos > 1` в
    // `kSenseRows` сегодня НЕТ НИ ОДНОЙ (блок 0 это печатает), а таблица —
    // `const`, и подделать строку из теста нельзя, не нарушив язык. Поэтому
    // закон судится там, где он выражен: на ПРИМИТИВЕ, который слепой косинус
    // и получает, плюс на том случае прода, который `perceive_step` объявляет
    // ТЕМ ЖЕ («телу без взгляда зрение тоже невыразимо»).
    {
        // «Конус пуст» означает ПУСТ: 360 румбов x три дальности, и ни одного
        // «вижу». Мутация: `fovCos > 1.0f` → `>= 1.0f` (слепота перестала бы
        // выражаться косинусом вообще) либо клампинг косинуса в [−1, 1]
        // где-то по дороге — тогда слепой стал бы видеть ровно вперёд.
        const float blindCos = 2.0f;
        std::size_t seen = 0, probes = 0;
        for (int deg = 0; deg < 360; ++deg) {
            const float a = static_cast<float>(deg) * 3.14159265f / 180.0f;
            for (float r : {0.5f, 10.0f, 100.0f}) {
                ++probes;
                if (looking_at(vec3{1.0f, 0.0f, 0.0f}, std::cos(a) * r,
                               std::sin(a) * r, 0.0f, blindCos))
                    ++seen;
            }
        }
        CHECK(probes == 1080u);
        CHECK(seen == 0u);
        // ...И ЕДИНСТВЕННАЯ ДЫРА В СЛЕПОТЕ, названная, а не спрятанная: тело,
        // стоящее ВНУТРИ наблюдателя (пеленг короче миллиметра), проходит
        // конус при ЛЮБОМ косинусе — у примитива это ранний `return true` с
        // доводом «тот же закон, что у заморозки». В проде это значит, что
        // слепой моб «увидит» врага, забравшегося ему в клетку. Утверждение
        // пинит текущий ответ: починят — упадёт здесь и покажет причину.
        CHECK(looking_at(vec3{1.0f, 0.0f, 0.0f}, 0.0f, 0.0f, 0.0f, blindCos));

        // ...А ТЕПЕРЬ ПРОД: слепое тело слышит и заявляет СЛУХ.
        const float y = 240.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens,
                                       vec3{obsAt.x + 6.0f, y, kStandZ});
        (void)foe;
        // Взгляда НЕТ — тот самый случай, который проход считает слепотой.
        CHECK(st.reg.try_get<Look>(obs) == nullptr);
        const vec3 noiseAt{obsAt.x - 20.0f, y, kStandZ};
        CHECK(st.publish(noiseAt, loud_noise()) != 0u);

        const Watched w = st.window(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sum.blind == 2u);          // оба тела без взгляда
        CHECK(w.sum.pairsNear == 0u);      // слепой НЕ ХОДИТ по парам вовсе
        CHECK(w.sum.rays == 0u);           // и не платит за луч
        CHECK(w.sum.sawFoe == 0u);
        CHECK(w.sen.visible == 0u);
        CHECK(w.sen.foe == entt::null);
        // ...зато СЛЫШИТ, и это второй канал того же прохода.
        CHECK(w.sum.heard == 2u);
        CHECK(w.sen.heardSev == loud_noise().severity);
        CHECK(w.claimed);
        CHECK(w.rank == SteerRank::Noise);
        CHECK(w.target.kind == TargetKind::Dir);
        CHECK(w.target.dir.x < 0.0f);      // НА ШУМ, то есть в −x
        CHECK(w.sum.claimNoise == 2u);
        CHECK(w.sum.claimSight == 0u);
    }

    // ---- 3b. ГЛУХОТА СТРОКОЙ НЕ РАБОТАЕТ — ДЕФЕКТ, ПРИКОЛОЧЕННЫЙ ГЕЙТОМ ---
    //
    // ЭТОТ БЛОК ПИНИТ ДЕФЕКТ, А НЕ ЗАКОН, и говорит об этом вслух.
    //
    // ЗАКОН ([game/perceive.h], дословно): «Безэхий получает НОЛЬ, и
    // `loudest_heard` отсекает ему всё по радиусу ⇒ глухой по построению».
    // ЗАМЕР: отсечки нет. И `loudest_heard`, и `noise_audible` начинаются со
    // строки `mult = hearingMult > 0.0f ? hearingMult : 1.0f`
    // ([game/noise.cpp]), то есть НОЛЬ МНОЖИТЕЛЯ КОЭРСИТСЯ В ЕДИНИЦУ: глухой
    // слышит ровно как зрячий, только без бонуса 1.12. Данные верны (блок 0
    // это проверяет), а их читатель их не исполняет — то есть слепой/глухой
    // моб СТРОКОЙ пока не выражается, хотя строка есть.
    //
    // ЛЕЧЕНИЕ — ОДНА СТРОКА У ВЫЗЫВАЮЩЕГО: в `perceive_step` не звать
    // `loudest_heard` при `mult <= 0`. (Снять коэрсию в `noise.cpp` дороже: она
    // там защищает ЧУЖИХ вызывающих от нуля-по-умолчанию.) Когда положат — пять
    // помеченных `ДЕФЕКТ` утверждений ниже упадут и покажут сюда.
    {
        NoiseField f;
        NoiseProfile p = rifle_noise();
        p.radius = 12.0f;
        const vec3 src{10.0f, 10.0f, 2.0f};
        const vec3 ear{20.0f, 10.0f, 2.0f};     // 10 м — внутри 12 м радиуса
        CHECK(noise_publish(f, 0, src, p, kAnon) != 0u);
        CHECK(f.slot[0].id != 0u);
        // ПОЛЕ ШУМА ПО-ПРЕЖНЕМУ КОЭРСИТ НОЛЬ В ЕДИНИЦУ, и это названо вслух:
        // `loudest_heard`/`noise_audible` начинаются с `mult > 0 ? mult : 1`.
        // Поэтому глухоту обеспечивает НЕ поле, а то, что восприятие с нулевым
        // множителем поля НЕ СПРАШИВАЕТ ВОВСЕ (`perceive.cpp`). Эти два
        // утверждения пинят коэрсию как она есть: уберут её — упадут и покажут,
        // что проверку в проде можно снять.
        CHECK(loudest_heard(f, 0, ear, 0.0f, kInvestigateMinSeverity, kAnon,
                            nullptr) != nullptr);
        CHECK(noise_audible(f.slot[0], ear, 0.0f));

        // ...и то же в проде: Безэхий заявляет слух наравне с Зомби.
        const float y = 220.125f;
        Stand st;
        const Entity deaf = st.mob(MobKind::Bezekhiy, vec3{30.1f, y, kStandZ});
        const Entity hears = st.mob(MobKind::Zombie, vec3{33.1f, y, kStandZ});
        (void)hears;
        CHECK(sense_hearing_mult(SenseClass::Monster,
                                 st.reg.try_get<MobRef>(deaf)) == 0.0f);
        CHECK(!has_flag(mob_def(MobKind::Bezekhiy).aiFlags, AiFlag::Immobile));
        CHECK(mob_def(MobKind::Bezekhiy).speedMmps > 0u);
        CHECK(st.publish(vec3{10.1f, y, kStandZ}, loud_noise()) != 0u);
        const Watched wd = st.window(grid, deaf, 1);
        CHECK(wd.visits == 1u);
        // ГЛУХОЙ НЕ СЛЫШИТ И ЗАЯВКИ НЕ ПОДАЁТ — строкой таблицы, не веткой.
        // Мутация, которую это ловит: отдать нулевой множитель `loudest_heard`
        // (он коэрсит ноль в единицу, и Безэхий услышит наравне с Зомби).
        // Сумма по ОКНУ, а в сцене два тела: глухой Безэхий и слышащий Зомби.
        // Поэтому «услышал ровно один», и `Senses` ГЛУХОГО пуст.
        CHECK(wd.sum.heard == 1u);
        CHECK(wd.sen.heardSev == 0u);
        CHECK(wd.rank != SteerRank::Noise);
        std::printf("[восприятие] глухота строкой: множитель слуха Безэхого "
                    "%.2f, услышали %u тел из 2\n",
                    static_cast<double>(sense_hearing_mult(
                        SenseClass::Monster, st.reg.try_get<MobRef>(deaf))),
                    static_cast<unsigned>(wd.sum.heard));
    }

    // ---- 4. ЗРЕНИЕ СТАРШЕ СЛУХА — РАНГОМ, А НЕ ПОРЯДКОМ ВЫЗОВОВ -----------
    //
    // ОДНО ТЕЛО, ОДИН ТИК, ДВА ВХОДА СРАЗУ: враг виден по +x, выстрел кричит
    // по −x. Заявка обязана быть ОДНА, рангом `Chase`, и целью — ВРАГ.
    //
    // МУТАЦИЯ: поменять ранги местами (или вернуть арбитраж порядком вызовов,
    // как держалось до 2026-11-09 — замер прибора ведения: слух перебивал
    // прогулку 45 раз за 250 тиков и побеждал ВСЕГДА). Контроль — фаза B: та
    // же сцена со стеной перед врагом, и заявка ПЕРЕЕЗЖАЕТ на слух. Без неё
    // фаза A прошла бы и для тела, которое шума просто не слышит.
    //
    // ШУМ ВИНТОВОЧНЫЙ (26.88 м слышимости), а не предельный: он обязан быть
    // слышен НАБЛЮДАТЕЛЮ (20 м) и НЕ слышен его цели (32 м), иначе
    // `heard`/`claimNoise` стали бы суммой двух тел.
    {
        const float y = 80.125f;
        const int cy = cell_of_metres(y);
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 foeAt{42.1f, y, kStandZ};
        const vec3 noiseAt{10.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        CHECK(st.publish(noiseAt, rifle_noise()) != 0u);
        // Предпосылки: шум СЛЫШЕН наблюдателю и НЕ слышен цели.
        const float mult = sense_hearing_mult(SenseClass::Monster,
                                              st.reg.try_get<MobRef>(obs));
        float heardAt = 0.0f;
        CHECK(loudest_heard(st.noise, st.layer, obsAt, mult,
                            kInvestigateMinSeverity, kAnon,
                            &heardAt) != nullptr);
        CHECK(heardAt > kInvestigateArriveRadius);
        CHECK(loudest_heard(st.noise, st.layer, foeAt,
                            sense_hearing_mult(SenseClass::Resident, nullptr),
                            kInvestigateMinSeverity, kAnon,
                            nullptr) == nullptr);

        std::uint64_t t0 = 1;
        const Watched sight = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(sight.visits == 1u);
        CHECK(sight.sen.foe == foe);
        CHECK(sight.rank == SteerRank::Chase);
        CHECK(sight.target.dir.x > 0.0f);     // НА ВРАГА, а не на шум
        CHECK(sight.sum.claimSight == 1u);
        CHECK(sight.sum.claimNoise == 0u);
        // Увидевшее тело слух даже не СПРАШИВАЕТ: `heardSev` остаётся нулём, и
        // это наблюдаемая форма «услышанное уже не нужно».
        CHECK(sight.sen.heardSev == 0u);
        CHECK(sight.sum.heard == 0u);

        // --- B. СТЕНА ПЕРЕД ВРАГОМ — ЗАЯВКА ПЕРЕЕЗЖАЕТ НА СЛУХ ------------
        stamp_panel(grid, 18, cy, kEyeCellZ, 0);
        const Watched sound = st.window(grid, obs, t0);
        wipe_cell(grid, 18, cy, kEyeCellZ);
        CHECK(sound.visits == 1u);
        CHECK(sound.sum.occluded == 1u);
        CHECK(sound.sen.foe == entt::null);
        CHECK(sound.rank == SteerRank::Noise);
        CHECK(sound.target.dir.x < 0.0f);     // НА ШУМ, то есть в −x
        CHECK(sound.sum.claimSight == 0u);
        CHECK(sound.sum.claimNoise == 1u);
        CHECK(sound.sen.heardSev == rifle_noise().severity);
        CHECK(sight.rank > sound.rank);
        std::printf("[восприятие] арбитраж: вижу врага и слышу выстрел с "
                    "ДРУГОЙ стороны → заявка «%s» на +x; стена перед врагом → "
                    "«%s» на −x\n",
                    kSteerRankRows[static_cast<std::size_t>(sight.rank)].name,
                    kSteerRankRows[static_cast<std::size_t>(sound.rank)].name);
    }

    // ---- 5. ВОСПРИЯТИЕ НЕ ПИШЕТ СКОРОСТЬ ----------------------------------
    //
    // МУТАЦИЯ: вернуть восприятию прямую запись `Velocity` (ровно то, чем жил
    // снесённый `investigate_step`, и ровно то, что дало замеренные 45 двойных
    // записей за 250 тиков). Фаза A ловит её немедленно.
    //
    // СЕНТИНЕЛЬ 97 м/с — не «какое-нибудь» число: скорости заявок здесь
    // табличные (клетки/с x 2 м, единицы метров в секунду) и нормированы на
    // единицу длины, так что 97 не получается ни по одной оси. «Погасили» от
    // «не трогали» он тоже отличает — в отличие от нуля.
    {
        const float y = 100.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 foeAt{42.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        constexpr float kSentinel = 97.0f;

        std::uint64_t t0 = 1;
        st.reg.get<Velocity>(obs).v = vec3{kSentinel, kSentinel, 0.0f};
        const Watched seen = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(seen.visits == 1u);
        CHECK(seen.sen.foe == foe);                 // проход тело ПОСЕТИЛ...
        CHECK(seen.claimed);                        // ...и заявку подал...
        CHECK(st.reg.get<const Velocity>(obs).v.x == kSentinel);  // ...а скорость НЕ ТРОНУЛ
        CHECK(st.reg.get<const Velocity>(obs).v.y == kSentinel);

        // ...И ТЕПЕРЬ ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ, в том же тике.
        const Watched led = st.window_led(grid, obs, t0);
        CHECK(led.visits == 1u);
        CHECK(led.claimed);
        const vec3 v = st.reg.get<const Velocity>(obs).v;
        CHECK(v.x != kSentinel);
        CHECK(v.y != kSentinel);
        // Записана РОВНО заявленная скорость по нормированному пеленгу: враг
        // строго по +x, значит табличная скорость монстра целиком в x. Мутация:
        // писатель подставляет свою скорость (`kWalkSpeedMps`) вместо
        // заявленной — порядок величины тот же, а число другое.
        const float sp = mob_speed_mps(MobKind::Zombie);
        CHECK(near_eq(v.x, sp));
        CHECK(near_eq(v.y, 0.0f));
        CHECK(v.z == 0.0f);                         // ось гравитации не его дело
        // Самопроверки писателя: ровно одна запись, рангом ЗРЕНИЯ, и ни одной
        // жалобы. `foreign` ненулевой означал бы заявку на теле человека или
        // трупа, `stale` — что заявка и писатель разъехались по тикам.
        CHECK(led.guide.led == 1u);
        CHECK(led.guide.held == 0u);
        CHECK(led.guide.byRank[static_cast<std::size_t>(SteerRank::Chase)] == 1u);
        CHECK(led.guide.byRank[static_cast<std::size_t>(SteerRank::Noise)] == 0u);
        // `stale` НУЛЁМ НЕ ОБЯЗАН БЫТЬ, и это закон, а не поблажка: заявители
        // ходят стаггером, поэтому в тик, когда тело не в своём слоте, на нём
        // лежит заявка прошлого визита — ровно то, что уже зафиксировано в
        // `game_test.cpp` поправкой к шапке `GuideTick`. Нулём обязаны быть
        // `bogus` и `unresolved`.
        CHECK(led.guide.bogus == 0u);
        CHECK(led.guide.unresolved == 0u);
        CHECK(led.guide.foreign == 0u);
        std::printf("[восприятие] писатель один: после прохода восприятия "
                    "сентинель %.0f цел; после ведения v = (%.3f, %.3f) при "
                    "табличной %.3f м/с\n",
                    static_cast<double>(kSentinel), static_cast<double>(v.x),
                    static_cast<double>(v.y), static_cast<double>(sp));
    }

    // ---- 6. ПРОИЗВОДИТЕЛЬ КАНАЛОВ ЕСТЬ ------------------------------------
    //
    // `foe`, `foeDist`, `visible`, `heardSev` — четыре канала, у которых до
    // этого прохода были читатели (`compute_threat_pressure`, `score_intents`)
    // и НИ ОДНОГО производителя. Здесь судится не «компонента появилась», а
    // ЧТО В НЕЙ: метры, тождество и счёт.
    //
    // ГЛАВНОЕ УТВЕРЖДЕНИЕ БЛОКА — «ближайший ВОСПРИНЯТЫЙ, а не ближайший
    // вообще»: враг в 4 м за спиной против врага в 12 м перед лицом. Мутация:
    // выбирать ближайшего ДО отсечек — ровно так работали все семь снесённых
    // сканов «ближайшее тело в шаре».
    {
        const float y = 120.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 nearBehind{26.1f, y, kStandZ};   // 4 м, но ЗА СПИНОЙ
        const vec3 farFront{42.1f, y, kStandZ};     // 12 м, в лицо
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity nearFoe = st.resident(Faction::Citizens, nearBehind);
        const Entity farFoe = st.resident(Faction::Citizens, farFront);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});

        std::uint64_t t0 = 1;
        const Watched w = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(w.visits == 1u);
        CHECK(w.sum.pairsNear == 2u);        // оба прошли дистанцию и вражду
        CHECK(w.sum.pairsCone == 1u);        // в конусе только дальний
        CHECK(w.sen.visible == 1u);
        CHECK(w.sen.foe == farFoe);
        CHECK(w.sen.foe != nearFoe);
        CHECK(near_eq(w.sen.foeDist, farFront.x - obsAt.x));
        CHECK(w.sen.foeDist > 0.0f);

        // ДВА ВИДИМЫХ: счёт растёт, цель — БЛИЖАЙШИЙ ИЗ ВОСПРИНЯТЫХ. Третий
        // враг кладётся по диагонали (пеленг (6, 2, 0) внутри конуса 45°).
        const Entity diag = st.resident(Faction::Citizens,
                                        vec3{obsAt.x + 6.0f, y + 2.0f, kStandZ});
        const Watched two = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(two.sen.visible == 2u);        // дальний и диагональный
        CHECK(two.sen.foe == diag);          // он ближе: 6.3 м против 12 м
        CHECK(two.sen.foeDist < w.sen.foeDist);
        CHECK(near_eq(two.sen.foeDist, std::sqrt(6.0f * 6.0f + 2.0f * 2.0f)));

        // КАНАЛ ЧИСТИТСЯ НА ВХОДЕ. Уведи всех за радиус — и ответ обязан стать
        // «никого», а не остаться прошлым. Мутация: не трогать `Senses`, если
        // врага не нашли (состояние без хозяина — тот же класс, что
        // «инвентарь пустеет»).
        st.reg.get<Transform>(farFoe).pos = vec3{obsAt.x + 100.0f, y, kStandZ};
        st.reg.get<Transform>(diag).pos = vec3{obsAt.x + 100.0f, y + 2.0f, kStandZ};
        const Watched gone = st.window(grid, obs, t0);
        CHECK(gone.visits == 1u);
        CHECK(gone.sen.visible == 0u);
        CHECK(gone.sen.foe == entt::null);
        CHECK(gone.sen.foeDist < 0.0f);
        CHECK(gone.sen.tick > two.sen.tick);
        // ...а дальность — именно ДАЛЬНОСТЬ СТРОКИ: 100 м мимо, 12 м внутри.
        CHECK(100.0f > sense_sight_m(SenseClass::Monster,
                                     st.reg.try_get<MobRef>(obs)));
        std::printf("[восприятие] каналы: враг в %.0f м за спиной проигрывает "
                    "врагу в %.0f м в лицо; visible 1 → 2 → 0\n",
                    static_cast<double>(obsAt.x - nearBehind.x),
                    static_cast<double>(farFront.x - obsAt.x));
    }

    // ---- 7. ТОРОИДАЛЬНОСТЬ -------------------------------------------------
    //
    // Пара на ШВЕ МИРА: одно тело около нуля, другое около `kWorldExtent`.
    // Воспринимается как БЛИЗКАЯ — и по дистанции, и по ПЕЛЕНГУ.
    //
    // МУТАЦИЯ: убрать `wrap_dist2` (разность по оси даст 252 м, пара отлетит по
    // дистанции и тело ослепнет на шве) либо `wrap_delta_f` в пеленге
    // (дистанция пройдёт, а вести тело будет через весь мир — отсюда проверка
    // знака скорости).
    {
        const float y = 20.125f;
        Stand st;
        const vec3 obsAt{1.0f, y, kStandZ};
        const vec3 foeAt{kWorldExtent - 3.0f, y, kStandZ};   // 253 м, то есть −4 м
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{-1.0f, 0.0f, 0.0f});    // смотрит ЧЕРЕЗ шов
        // Независимый расчёт: 1 м от нуля + 3 м до периода = 4 м.
        const float want = 4.0f;
        CHECK(foeAt.x - obsAt.x > kWorldExtent * 0.5f);  // «наивно» — пол мира

        std::uint64_t t0 = 1;
        const Watched w = st.window_led(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(w.visits == 1u);
        CHECK(w.sen.visible == 1u);
        CHECK(w.sen.foe == foe);
        CHECK(near_eq(w.sen.foeDist, want, 1e-2f));
        CHECK(w.rank == SteerRank::Chase);
        CHECK(w.target.dir.x < 0.0f);            // К ШВУ, не через весь мир
        CHECK(st.reg.get<const Velocity>(obs).v.x < 0.0f);
        CHECK(near_eq(st.reg.get<const Velocity>(obs).v.x,
                      -mob_speed_mps(MobKind::Zombie)));
        CHECK(w.guide.led == 1u);
        CHECK(w.guide.unresolved == 0u);

        // ---- 7b. ...А ЛУЧ ЗАСЛОНЕНИЯ ИДЁТ ЧЕРЕЗ ВЕСЬ МИР — ДЕФЕКТ --------
        //
        // ЭТОТ ПОДБЛОК ПИНИТ ДЕФЕКТ, А НЕ ЗАКОН.
        //
        // `sight_blocked(grid, eye, at)` отдаёт `sub_march` СЫРЫЕ координаты, а
        // тот «берёт `b` как дан, без поиска ближайшего образа» (его
        // собственный док-комментарий: контракт писан под снарядный интегратор,
        // у которого отрезок — шаг за тик). Для пары на шве это значит, что луч
        // идёт НЕ через шов (4 м), а ВОКРУГ МИРА (252 м) — то есть на
        // населённом этаже такая пара заслонена практически всегда, хотя
        // дистанция и конус говорят «рядом». Плюс 1008 субвокселей марша вместо
        // шестнадцати.
        //
        // ВЫЛЕЧЕНО В ТОМ ЖЕ ЗАХОДЕ: восприятие марширует к БЛИЖАЙШЕМУ ОБРАЗУ
        // цели (конец луча строится из уже свёрнутого пеленга, `perceive.cpp`),
        // поэтому стена на ДЛИННОЙ дороге вокруг мира эту пару не гасит, а луч
        // идёт 4 м, не 252. Мутация, которую ловят два CHECK ниже: отдать
        // `sub_march` сырые координаты цели.
        const int cyS = cell_of_metres(y);
        const int farCx = 64;                    // 128..130 м — середина ДЛИННОЙ дороги
        CHECK(static_cast<float>(farCx) * kCellSize > obsAt.x + want);
        CHECK(static_cast<float>(farCx) * kCellSize < foeAt.x - want);
        grid.fill_cell(farCx, cyS, kEyeCellZ, kMatConcrete);
        const Watched blocked = st.window(grid, obs, t0);
        wipe_cell(grid, farCx, cyS, kEyeCellZ);
        CHECK(blocked.visits == 1u);
        CHECK(blocked.sum.occluded == 0u);       // стена ВОКРУГ МИРА не при чём
        CHECK(blocked.sen.visible == 1u);        // пара видна через шов
        std::printf("[восприятие] шов мира: %.0f м по разности координат, "
                    "%.2f м по тору, пеленг в −x; стена в 128 м (вне зазора) "
                    "эту пару НЕ гасит — луч идёт к ближайшему образу\n",
                    static_cast<double>(foeAt.x - obsAt.x),
                    static_cast<double>(w.sen.foeDist));
    }

    // ---- 8. ФРЕЙМ ГРАВИТАЦИИ ----------------------------------------------
    //
    // МУТАЦИЯ, КОТОРУЮ ЛОВИТ ТОЛЬКО ЭТОТ БЛОК: вернуть в заявку жёсткие x/y
    // (дословно то, чем жил снесённый проход слуха — `investigate.cpp` писал
    // `vel.v.x/vel.v.y` НАПРЯМУЮ). Под NegZ она неотличима от правильной, а под
    // боковым режимом делает две ошибки сразу: трогает ОСЬ ГРАВИТАЦИИ (её
    // владелец `physics_step`) и НЕ ведёт по третьей оси, которая под этим
    // режимом как раз и есть плоскость ходьбы.
    //
    // Поэтому враг стоит ПО ДИАГОНАЛИ плоскости (y и z сразу): пара, лежащая на
    // одной оси, прошла бы и при жёстких x/y.
    {
        const float y = 140.125f;
        Stand st;
        GravityField sideways;
        sideways.regime = GravityRegime::PosX;
        sideways.global = vec3{9.81f, 0.0f, 0.0f};
        st.gravity = &sideways;
        const GravityFrame gf = steer_frame_of(&sideways);
        CHECK(gf.axis == 0);
        CHECK(gf.pull);

        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 foeAt{30.1f, y + 8.0f, kStandZ + 6.0f};   // 10 м по диагонали y/z
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{0.0f, 0.8f, 0.6f});
        // Сентинель во ВСЕХ ТРЁХ осях: x — ось гравитации (её не смеет трогать
        // ни заявитель, ни писатель), y и z — плоскость ходьбы.
        st.reg.get<Velocity>(obs).v = vec3{0.125f, 3.0f, 4.0f};

        const Watched w = st.window_led(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sen.foe == foe);
        CHECK(near_eq(w.sen.foeDist, 10.0f));
        CHECK(w.rank == SteerRank::Chase);
        // ЗАЯВКА ЛЕЖИТ В ПЛОСКОСТИ ХОДЬБЫ: компонента вдоль гравитации — ноль
        // ещё в ЦЕЛИ, а не только в записи.
        CHECK(w.target.kind == TargetKind::Dir);
        CHECK(w.target.dir.x == 0.0f);
        CHECK(w.target.dir.y > 0.0f);
        CHECK(w.target.dir.z > 0.0f);
        const vec3 v = st.reg.get<const Velocity>(obs).v;
        const float sp = mob_speed_mps(MobKind::Zombie);
        CHECK(v.x == 0.125f);                    // падение принадлежит физике
        CHECK(near_eq(v.y, sp * 0.8f));
        CHECK(near_eq(v.z, sp * 0.6f));
        CHECK(near_eq(std::sqrt(v.y * v.y + v.z * v.z), sp));
        CHECK(w.guide.led == 1u);
        CHECK(w.guide.foreign == 0u);
        std::printf("[восприятие] PosX: заявка (%.2f, %.2f, %.2f), "
                    "v = (%+.3f, %+.3f, %+.3f) — ось гравитации x цела, ведём "
                    "в плоскости y/z\n",
                    static_cast<double>(w.target.dir.x),
                    static_cast<double>(w.target.dir.y),
                    static_cast<double>(w.target.dir.z),
                    static_cast<double>(v.x), static_cast<double>(v.y),
                    static_cast<double>(v.z));
    }

    // ---- 9. ВЗГЛЯД — ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ НАПРАВЛЕНИЯ -------------------
    //
    // Четыре закона `look_step`, и каждый назван мутацией:
    //   * ИДУЩЕЕ тело смотрит по ходу — мутация: не обновлять взгляд ходом
    //     вовсе (тогда вся толпа смотрит в румб рождения до конца сессии);
    //   * ВСТАВШЕЕ держит ПРЕЖНИЙ, а не ноль — мутация: `look->dir = {}` при
    //     малой скорости. Замер: на этаже 6 СТОЯТ 88 % жителей, на падике —
    //     100 % мобов, и нулевой взгляд дал бы `dot = 0 < cos45°`, то есть
    //     ПОЛНУЮ слепоту большинства толпы;
    //   * НОСИТЕЛЬ КАМЕРЫ берёт взгляд из камеры — мутация: снять ветку
    //     решателя, и взгляд игрока поедет от его же скорости (а он смотрит,
    //     не поворачиваясь телом — это и есть шутер);
    //   * НОВОРОЖДЁННОЕ получает НЕнулевой румб — мутация: `Look{}` по
    //     умолчанию (слепота) или общий +X (молчаливая анизотропия: вся толпа
    //     смотрит в одну сторону, и засада со спины работает с одного румба).
    {
        Registry reg;
        const GravityFrame gf = steer_frame_of(nullptr);
        const LayerId layer = 0;

        NpcPool pool;
        pool.init();
        const NpcId standerId = pool.spawn();
        pool.height_mm(standerId) = 1750;
        pool.faction(standerId) = static_cast<std::uint16_t>(Faction::Citizens);
        const NpcId pid = pool.spawn();
        pool.height_mm(pid) = 1750;
        pool.faction(pid) = static_cast<std::uint16_t>(Faction::Citizens);

        // Проп: ни тождества, ни взгляда. Мутация: выдать взгляд всем телам —
        // обломки и снаряды «смотрят», и цена прохода растёт на всю геометрию.
        const Entity prop = reg.create();
        reg.emplace<Transform>(prop, Transform{vec3{200.0f, 200.0f, 2.0f}, layer});
        reg.emplace<Velocity>(prop, Velocity{vec3{5.0f, 0.0f, 0.0f}});

        // Тело на ЧУЖОМ слое — проход обязан его не видеть.
        const Entity other = reg.create();
        reg.emplace<Transform>(other, Transform{vec3{200.0f, 204.0f, 2.0f},
                                                static_cast<LayerId>(1)});
        reg.emplace<Velocity>(other, Velocity{vec3{5.0f, 0.0f, 0.0f}});
        reg.emplace<MobRef>(other, MobRef{static_cast<std::uint8_t>(MobKind::Zombie),
                                          1, 10, 10});

        const Entity walker = reg.create();
        reg.emplace<Transform>(walker, Transform{vec3{200.0f, 208.0f, 2.0f}, layer});
        reg.emplace<Velocity>(walker, Velocity{vec3{0.0f, -3.0f, 0.0f}});
        reg.emplace<MobRef>(walker, MobRef{static_cast<std::uint8_t>(MobKind::Zombie),
                                           1, 10, 10});

        const Entity stander = reg.create();
        reg.emplace<Transform>(stander, Transform{vec3{200.0f, 212.0f, 2.0f}, layer});
        reg.emplace<Velocity>(stander, Velocity{});
        reg.emplace<NpcRef>(stander, NpcRef{standerId});

        const Entity human = embody_as_player(reg, pool, pid, layer);
        CHECK(human != entt::null);
        reg.get<Transform>(human).pos = vec3{200.0f, 216.0f, 2.0f};
        reg.emplace_or_replace<Velocity>(human, Velocity{vec3{0.0f, -5.0f, 0.0f}});
        reg.get<CameraTag>(human).yaw = 0.0f;     // камера смотрит в +x
        reg.get<CameraTag>(human).pitch = 0.0f;

        // --- A. ПЕРВЫЙ ПРОХОД: РОЖДЕНИЕ ------------------------------------
        const LookTick born = look_step(reg, layer, gf);
        CHECK(born.bodies == 3u);                 // walker, stander, human
        CHECK(born.born == 3u);                   // чужой слой и проп не считаны
        CHECK(reg.try_get<Look>(prop) == nullptr);
        CHECK(reg.try_get<Look>(other) == nullptr);
        for (Entity e : {walker, stander, human}) {
            const Look* lk = reg.try_get<Look>(e);
            CHECK(lk != nullptr);
            if (lk != nullptr) CHECK(len3(lk->dir) > 0.5f);
        }
        // В ЭТОМ ЖЕ проходе ход и камера уже перебили румб рождения.
        CHECK(born.moved == 1u);                  // walker
        CHECK(born.held == 1u);                   // stander
        CHECK(born.human == 1u);                  // носитель камеры

        // --- B. ИДУЩЕЕ СМОТРИТ ПО ХОДУ -------------------------------------
        const vec3 wd = reg.get<const Look>(walker).dir;
        CHECK(near_eq(wd.x, 0.0f));
        CHECK(near_eq(wd.y, -1.0f));
        CHECK(near_eq(wd.z, 0.0f));
        CHECK(near_eq(len3(wd), 1.0f));

        // --- C. ВСТАВШЕЕ ДЕРЖИТ ПРЕЖНИЙ, И ЭТО НЕ НОЛЬ ---------------------
        // Сентинель — направление, которого ход дать не мог: так «держит
        // прежний» отличается и от нуля, и от «перезаписал ходом».
        const vec3 kept{0.6f, 0.8f, 0.0f};
        reg.get<Look>(stander).dir = kept;
        const LookTick again = look_step(reg, layer, gf);
        CHECK(again.born == 0u);
        CHECK(again.held == 1u);
        CHECK(reg.get<const Look>(stander).dir.x == kept.x);
        CHECK(reg.get<const Look>(stander).dir.y == kept.y);
        CHECK(len3(reg.get<const Look>(stander).dir) > 0.5f);
        // ПОРОГ «тело идёт» — доля пешей скорости, и он проверяется с двух
        // сторон: чуть ниже — держит, чуть выше — поехал. Мутация: сравнить с
        // нулём (дрожь физики начала бы вертеть взглядом всей толпы).
        const float thresh = kWalkSpeedMps * kLookMovingFrac;
        reg.get<Velocity>(stander).v = vec3{thresh * 0.5f, 0.0f, 0.0f};
        look_step(reg, layer, gf);
        CHECK(reg.get<const Look>(stander).dir.x == kept.x);
        reg.get<Velocity>(stander).v = vec3{thresh * 2.0f, 0.0f, 0.0f};
        look_step(reg, layer, gf);
        CHECK(near_eq(reg.get<const Look>(stander).dir.x, 1.0f));

        // --- D. КАМЕРА СТАРШЕ ХОДА -----------------------------------------
        // Тело едет в −y, камера глядит в +x: взгляд обязан быть камерным.
        const vec3 hd = reg.get<const Look>(human).dir;
        const vec3 cam = camera_forward(reg.get<const CameraTag>(human).yaw,
                                        reg.get<const CameraTag>(human).pitch);
        CHECK(near_eq(hd.x, cam.x));
        CHECK(near_eq(hd.y, cam.y));
        CHECK(near_eq(hd.z, cam.z));
        CHECK(near_eq(hd.x, 1.0f));
        CHECK(near_eq(hd.y, 0.0f));          // НЕ −1: ход не победил камеру
        reg.get<CameraTag>(human).yaw = 1.5707963f;    // +y
        look_step(reg, layer, gf);
        CHECK(near_eq(reg.get<const Look>(human).dir.y, 1.0f));
        CHECK(near_eq(reg.get<const Look>(human).dir.x, 0.0f));

        // --- E. РУМБ РОЖДЕНИЯ РАЗНЫЙ У РАЗНЫХ ТОЖДЕСТВ ---------------------
        // Не распределение (это не предмет блока), а ВЫРОЖДЕНИЕ: общий +X
        // прошёл бы все проверки выше.
        std::size_t sameAsFirst = 0;
        const vec3 first = look_birth_dir(gf, 0u);
        for (std::uint32_t seed = 0; seed < 64u; ++seed) {
            const vec3 d = look_birth_dir(gf, seed);
            CHECK(near_eq(len3(d), 1.0f));
            CHECK(d.z == 0.0f);              // в плоскости ходьбы NegZ
            if (near_eq(d.x, first.x) && near_eq(d.y, first.y)) ++sameAsFirst;
        }
        CHECK(sameAsFirst < 8u);
        std::printf("[восприятие] взгляд: тел %u, рождено %u, по ходу %u, "
                    "держат %u, из камеры %u; из 64 румбов рождения совпали с "
                    "первым %zu\n",
                    static_cast<unsigned>(born.bodies),
                    static_cast<unsigned>(born.born),
                    static_cast<unsigned>(born.moved),
                    static_cast<unsigned>(born.held),
                    static_cast<unsigned>(born.human), sameAsFirst);

        // ---- 9b. РУМБ РОЖДЕНИЯ ВЫРОЖДАЕТСЯ ПРИ БОКОВОЙ ГРАВИТАЦИИ --------
        //
        // ЭТОТ ПОДБЛОК ПИНИТ ДЕФЕКТ, А НЕ ЗАКОН.
        //
        // `look_birth_dir` строит румб как `steer_tangent(gf, cos a, sin a, 0)`
        // — то есть кладёт круг в плоскость x/y и ТОЛЬКО ПОТОМ проецирует на
        // плоскость ходьбы. Под NegZ это круг (всё выше это и проверяет). Под
        // PosX ось x гасится, а в z генератор не кладёт НИЧЕГО: остаётся
        // отрезок `(0, sin a, 0)` длиной |sin a| — не единичный вектор, а при
        // угле около нуля и вовсе НУЛЕВОЙ, то есть новорождённое тело слепо
        // (`looking_at` отказывает при |fwd|² < 1e-6).
        //
        // ЛЕЧЕНИЕ: строить румб В ОСЯХ ФРЕЙМА (`gf.tanA`/`gf.tanB`,
        // [world/gravity.h]), а не в x/y с последующей проекцией. Когда
        // положат — четыре CHECK ниже упадут и покажут сюда.
        GravityField side;
        side.regime = GravityRegime::PosX;
        side.global = vec3{9.81f, 0.0f, 0.0f};
        const GravityFrame sgf = steer_frame_of(&side);
        // ПОЧЕМУ ЭТО НЕ ДЕЛАЕТСЯ ПРОЕКЦИЕЙ: круг в мировых x/y, спроецированный
        // на плоскость ходьбы режима PosX, даёт ОТРЕЗОК, а при угле 0 — НОЛЬ,
        // то есть слепое новорождённое тело. Два CHECK ниже пинят именно это —
        // мутация «вернуть `steer_tangent(gf, cos a, sin a, 0)`» их красит.
        const vec3 atAngleZero = steer_tangent(sgf, 1.0f, 0.0f, 0.0f);
        CHECK(len3(atAngleZero) == 0.0f);
        CHECK(!looking_at(atAngleZero, 0.0f, 1.0f, 0.0f, kGazeCosHalfAngle));
        float minLen = 2.0f;
        std::size_t inZ = 0, blindSeeds = 0;
        for (std::uint32_t seed = 0; seed < 256u; ++seed) {
            const vec3 d = look_birth_dir(sgf, seed);
            const float l = len3(d);
            if (l < minLen) minLen = l;
            if (d.z != 0.0f) ++inZ;
            if (l < 1e-3f) ++blindSeeds;
        }
        // РУМБ ЗАНИМАЕТ ОБЕ ОСИ ПЛОСКОСТИ И ЕДИНИЧЕН ПРИ ЛЮБОМ ТОЖДЕСТВЕ:
        // под PosX плоскость ходьбы это (y, z), поэтому z обязана быть занята,
        // а слепых тождеств не должно быть ни одного.
        CHECK(inZ > 200u);
        CHECK(minLen > 0.99f);
        CHECK(blindSeeds == 0u);
        std::printf("[восприятие] румб рождения под PosX: z занята у %zu из "
                    "256, min|dir| = %.4f, слепых тождеств %zu из 256\n",
                    inZ, static_cast<double>(minLen), blindSeeds);
    }

    // ---- 10. ТРУП ВНЕ ВОСПРИЯТИЯ ------------------------------------------
    //
    // МУТАЦИЯ: снять любую из двух проверок `Dead`. Цена известна по имени —
    // «живой каток» 2026-11-07: смерть снимает `MobRef`, труп проваливался в
    // решатель жителя, и патфайндинг возил рагдоллы по маршрутам (прогон
    // владельца: own_wander 363 при 107 живых). Моб, гоняющийся за трупом, —
    // тот же дефект на входе в восприятие.
    {
        const float y = 88.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const vec3 foeAt{42.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens, foeAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});

        std::uint64_t t0 = 1;
        const Watched alive = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(alive.sen.foe == foe);              // контроль: живого видит

        st.reg.emplace<Dead>(foe, Dead{});
        const Watched dead = st.window(grid, obs, t0);
        t0 += kPerceivePeriod;
        CHECK(dead.visits == 1u);                 // наблюдатель посещён...
        CHECK(dead.sum.pairsNear == 0u);          // ...а пары нет вовсе
        CHECK(dead.sum.rays == 0u);
        CHECK(dead.sen.visible == 0u);
        CHECK(dead.sen.foe == entt::null);
        CHECK(dead.sum.bodies == 1u);             // труп не посещён и сам

        st.reg.emplace<Dead>(obs, Dead{});
        const Watched both = st.window(grid, obs, t0);
        CHECK(both.visits == 0u);                 // мёртвый не воспринимает
        CHECK(both.sum.bodies == 0u);
        CHECK(both.sum.claimSight == 0u);
        CHECK(both.sum.claimNoise == 0u);
    }

    // ---- 11. ЧЕЛОВЕК ВОСПРИНИМАЕТ, НО ЗАЯВКИ НЕ ПОЛУЧАЕТ ------------------
    //
    // Носитель камеры — не исключение из системы, а её ВЕТКА (S13.7a): каналы
    // ему пишутся (худ, давление угрозы, летопись — всё это читатели), а цели
    // ведения он не получает, потому что за это тело решает человек.
    //
    // МУТАЦИЯ: снять `!human` у заявки. Это дефект Б6.2 по имени — он однажды
    // уже стоил владельцу управления, когда проход забрал тело игрока.
    {
        const float y = 160.125f;
        Stand st;
        const vec3 manAt{30.1f, y, kStandZ};
        const vec3 mobAt{42.1f, y, kStandZ};
        const NpcId pid = st.pool.spawn();
        st.pool.hp(pid) = 100;
        st.pool.max_hp(pid) = 100;
        st.pool.height_mm(pid) = 1750;
        st.pool.faction(pid) = static_cast<std::uint16_t>(Faction::Citizens);
        const Entity man = embody_as_player(st.reg, st.pool, pid, st.layer);
        CHECK(man != entt::null);
        st.reg.get<Transform>(man).pos = manAt;
        st.reg.get<CameraTag>(man).yaw = 0.0f;              // глядит в +x
        const Entity mob = st.mob(MobKind::Zombie, mobAt);
        // Взгляд человека приезжает ИЗ КАМЕРЫ через проход взгляда — здесь он
        // зовётся честно, а не подменяется рукой: это единственное место файла,
        // где два прохода восприятия стоят подряд, как в кадре игры.
        look_step(st.reg, st.layer, steer_frame_of(nullptr));
        CHECK(near_eq(st.reg.get<const Look>(man).dir.x, 1.0f));
        // ...а мобу взгляд ОТВОДИТСЯ рукой: проход выдал румб рождения и ему
        // тоже, а его заявка смазала бы атрибуцию счётчиков.
        st.aim(mob, vec3{1.0f, 0.0f, 0.0f});
        CHECK(mob_hostile_to(st.pool, pid));

        const Watched w = st.window_led(grid, man, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sum.bodies == 2u);
        CHECK(w.sum.pairsNear == 2u);             // вражда взаимна...
        CHECK(w.sum.pairsCone == 1u);             // ...а в конусе только у человека
        CHECK(w.sen.visible == 1u);               // ВОСПРИНЯЛ...
        CHECK(w.sen.foe == mob);
        CHECK(near_eq(w.sen.foeDist, mobAt.x - manAt.x));
        CHECK(w.sum.sawFoe == 1u);
        CHECK(!w.claimed);                        // ...а заявки НЕ ПОЛУЧИЛ
        CHECK(w.sum.claimSight == 0u);
        CHECK(w.sum.claimNoise == 0u);
        CHECK(w.guide.led == 0u);
        CHECK(w.guide.foreign == 0u);             // заявки нет — и жалобы нет
        CHECK(w.guide.byRank[static_cast<std::size_t>(SteerRank::Chase)] == 0u);
    }

    // ---- 12. СТАГГЕР, И ПУЛЫ, РОЖДАЮЩИЕСЯ ВНУТРИ ЖИВОГО ВИДА -------------
    //
    // ДВА УТВЕРЖДЕНИЯ, И ОНИ РАЗНЫЕ.
    //
    // (1) СТАГГЕР: каждое тело посещено РОВНО РАЗ за период, и слоты не
    // выродились. Мутация «хеш стал константой» (или `% 1`) посетила бы все 32
    // тела в ОДНОМ тике, каждое по-прежнему ровно раз — и `visits == 1` прошло
    // бы, пока цена прохода выросла в восемь раз. Поэтому занятых слотов
    // считается больше одного, а число печатается.
    //
    // (2) ПУЛЫ: `perceive_step` СОЗДАЁТ компоненты (`Senses` — всем, `Steer` —
    // заявителям) ВНУТРИ обхода живого вида `view<const Transform>`, а в свежем
    // реестре этих пулов ещё нет. «Рождение ПЕРВОГО элемента нового рода растит
    // контейнер пулов реестра и дангл'ит указатели живого вида» — named класс в
    // этом дереве (`steer_pool_warm@game/guide.h`, найден аудитом в
    // `place.cpp`), и ВСЕ ЧЕТЫРЕ прочих заявителя пулы ПРОГРЕВАЮТ до открытия
    // вида, а восприятие — НЕТ, ни `Senses`, ни `Steer`. Сцена ниже ставит
    // проход ровно в это положение: 32 тела, оба пула рождаются на первом же, и
    // дальше проход обходит ещё 31. Утверждения блока наблюдаемы и без
    // санитайзера (посещены все 32, компоненту получили все 32), а под
    // санитайзером этот блок и есть прибор на тот класс.
    {
        const float y = 180.125f;
        Stand st;
        constexpr int kHerd = 32;
        static_assert(kHerd >= 4 * static_cast<int>(kPerceivePeriod),
                      "вчетверо больше, чем слотов — чтобы пустой слот был "
                      "неожиданностью, а не нормой");
        std::vector<Entity> herd;
        for (int i = 0; i < kHerd; ++i)
            herd.push_back(st.mob(MobKind::Zombie,
                                  vec3{60.0f + 0.5f * static_cast<float>(i), y,
                                       kStandZ}));
        // Взгляд всем — ПРОХОДОМ, а не рукой: иначе этот блок стал бы ещё
        // одним блоком слепоты.
        const LookTick lt = look_step(st.reg, st.layer, steer_frame_of(nullptr));
        CHECK(lt.bodies == static_cast<std::uint32_t>(kHerd));
        CHECK(lt.born == static_cast<std::uint32_t>(kHerd));
        // Один громкий шум: слышат ВСЕ (иначе «не посещён» слилось бы с «не
        // услышал»), и ни одно тело не стоит внутри радиуса прибытия.
        CHECK(st.publish(vec3{40.0f, y, kStandZ}, loud_noise()) != 0u);
        // Пулов ЕЩЁ НЕТ — спрашивается `try_get`, потому что `storage<T>()` на
        // неконстантном реестре пул СОЗДАЁТ и тем самым уничтожил бы предмет
        // наблюдения.
        for (int i = 0; i < kHerd; ++i) {
            CHECK(st.reg.try_get<Senses>(herd[static_cast<std::size_t>(i)]) ==
                  nullptr);
            CHECK(st.reg.try_get<Steer>(herd[static_cast<std::size_t>(i)]) ==
                  nullptr);
        }

        std::vector<int> visits(kHerd, 0);
        std::size_t occupied = 0;
        PerceiveTick sum{};
        for (std::uint64_t t = 1; t <= kPerceivePeriod; ++t) {
            const PerceiveTick pt = perceive_step(st.reg, grid, st.noise, st.pool,
                                                  st.rel, st.layer, t, nullptr);
            tick_add(sum, pt);
            std::size_t here = 0;
            for (int i = 0; i < kHerd; ++i) {
                const Senses* s =
                    st.reg.try_get<Senses>(herd[static_cast<std::size_t>(i)]);
                if (s != nullptr && s->tick == static_cast<std::uint32_t>(t)) {
                    ++visits[static_cast<std::size_t>(i)];
                    ++here;
                }
            }
            // Счётчик прохода и наблюдение по телам обязаны сойтись — иначе
            // штамп лжёт и всё выше мерит не то.
            CHECK(here == static_cast<std::size_t>(pt.bodies));
            if (here != 0) ++occupied;
        }
        for (int i = 0; i < kHerd; ++i)
            CHECK(visits[static_cast<std::size_t>(i)] == 1);
        CHECK(sum.bodies == static_cast<std::uint32_t>(kHerd));
        CHECK(occupied > 1u);                    // стаггер РАЗНОСИТ толпу
        CHECK(occupied <= static_cast<std::size_t>(kPerceivePeriod));
        CHECK(sum.blind == 0u);                  // взгляд есть у всех
        CHECK(sum.pairsNear == 0u);              // моб мобу не враг
        CHECK(sum.heard == static_cast<std::uint32_t>(kHerd));
        CHECK(sum.claimNoise == static_cast<std::uint32_t>(kHerd));
        std::size_t withSenses = 0, withSteer = 0;
        for (int i = 0; i < kHerd; ++i) {
            if (st.reg.try_get<Senses>(herd[static_cast<std::size_t>(i)]) !=
                nullptr)
                ++withSenses;
            if (st.reg.try_get<Steer>(herd[static_cast<std::size_t>(i)]) !=
                nullptr)
                ++withSteer;
        }
        CHECK(withSenses == static_cast<std::size_t>(kHerd));
        CHECK(withSteer == static_cast<std::size_t>(kHerd));
        std::printf("[восприятие] стаггер: %d тел, занятых слотов %zu из %u, "
                    "каждое посещено ровно раз; пулы Senses/Steer родились "
                    "ВНУТРИ живого вида\n",
                    kHerd, occupied, static_cast<unsigned>(kPerceivePeriod));
    }

    // ---- 13. НЕПОДВИЖНЫЙ ВИДИТ, НО НЕ ИДЁТ --------------------------------
    //
    // МУТАЦИЯ: снять гейт `Immobile` у заявки. «Ковёр спор, идущий на выстрел,
    // — дефект хуже, чем ковёр, его игнорирующий» (закон `suite_noise.inl`), и
    // здесь он же для зрения: Борщевик — архитектура, а не охотник. Сентинель
    // отличает «не заявлял» от «заявил ноль».
    {
        const float y = 200.125f;
        Stand st;
        const vec3 obsAt{30.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Borshchevik, obsAt);
        const Entity foe = st.resident(Faction::Citizens,
                                       vec3{obsAt.x + 5.0f, y, kStandZ});
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        CHECK(has_flag(mob_def(MobKind::Borshchevik).aiFlags, AiFlag::Immobile));
        // Предпосылка: 5 м внутри ЕГО дальности (7.5 м у RootedPlant), иначе
        // блок прошёл бы «потому что не увидел».
        CHECK(sense_sight_m(SenseClass::Monster, st.reg.try_get<MobRef>(obs)) >
              5.0f);
        constexpr float kSentinel = 97.0f;
        st.reg.get<Velocity>(obs).v = vec3{kSentinel, -kSentinel, 0.0f};

        const Watched w = st.window_led(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sen.visible == 1u);              // УВИДЕЛ...
        CHECK(w.sen.foe == foe);
        CHECK(w.sum.sawFoe == 1u);
        CHECK(!w.claimed);                       // ...и заявки не подал
        CHECK(w.sum.claimSight == 0u);
        CHECK(w.guide.led == 0u);
        CHECK(st.reg.get<const Velocity>(obs).v.x == kSentinel);
        CHECK(st.reg.get<const Velocity>(obs).v.y == -kSentinel);
    }

    // ---- 14. ПРОХОД ПЛАТИТ ЗА ТЕЛА, А НЕ ЗА СУЩНОСТИ ------------------------
    //
    // ЗАМЕРЕННЫЙ ДЕФЕКТ, КОТОРЫЙ ЭТОТ БЛОК ОХРАНЯЕТ (2026-11-12, этаж 0,
    // Release, `--prof`): первая редакция прохода обходила `view<const
    // Transform>` дважды вложенно, а `Transform` носит ВСЁ, что стоит в мире,
    // — ~32 тысячи пропов против ~500 тел. Проход стоил 77.6 мс на кадр из
    // 98.7 (10 кадров в секунду), при том что маршей в тике было ПЯТЬ. Ни один
    // блок выше этого не видел: все они судят, ЧТО проход ответил, и ни один —
    // СКОЛЬКО он перебрал.
    //
    // ЧТО СУДИТСЯ: `scanned` — число кандидатов, перебранных внутренним
    // циклом. Закон: за полный период каждое зрячее тело перебирает РОВНО
    // (тел на слое − 1) кандидатов, и число сущностей без тождества в это
    // равенство НЕ ВХОДИТ.
    //
    // МУТАЦИИ: (а) собрать перепись из `view<const Transform>` без фильтра
    // тождества — `scanned` вырастет на число пропов; (б) вернуть во
    // внутренний цикл обход вида — то же. Обратная полярность: (в) выбросить
    // из переписи жителей — `scanned` упадёт, и пара перестанет находиться.
    {
        const float y = 228.125f;
        Stand st;
        constexpr int kInert = 1000;  // пропы: позиция есть, тождества нет
        for (int i = 0; i < kInert; ++i) {
            const Entity p = st.reg.create();
            st.reg.emplace<Transform>(
                p, Transform{vec3{30.1f + 0.01f * static_cast<float>(i), y,
                                  kStandZ},
                             st.layer});
            // Половине — ещё и скорость: обломок и снаряд её носят, и
            // тождеством она от этого не становится.
            if ((i & 1) != 0) st.reg.emplace<Velocity>(p, Velocity{});
        }
        const vec3 obsAt{30.1f, y, kStandZ};
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        const Entity foe = st.resident(Faction::Citizens,
                                       vec3{obsAt.x + 5.0f, y, kStandZ});
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        st.aim(foe, vec3{-1.0f, 0.0f, 0.0f});

        const Watched w = st.window(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sum.bodies == 2u);               // тел ДВА, а не 1002
        CHECK(w.sum.blind == 0u);
        // Каждое из двух зрячих тел перебрало ОДНОГО кандидата — другое тело.
        CHECK(w.sum.scanned == 2u);
        CHECK(w.sen.foe == foe);                 // и пара при этом НАЙДЕНА
        std::printf("[восприятие] цена: %d сущностей без тождества рядом с "
                    "двумя телами — перебрано кандидатов %u (закон: 2)\n",
                    kInert, static_cast<unsigned>(w.sum.scanned));
    }

    // ---- 15. РАВНЫЕ РАССТОЯНИЯ РАЗВОДИТ id, А НЕ ПОРЯДОК ОБХОДА -------------
    //
    // «Ближайший воспринятый враг» обязан быть свойством МИРА, а не памяти:
    // при двух врагах на РАВНОМ расстоянии побеждает меньший id — тот же
    // закон, что у `CellBins::nearest_in_radius`. Без него исход зависел бы от
    // порядка переписи (сперва монстры, затем жители, каждый пул — с хвоста).
    //
    // ДВЕ СЦЕНЫ, ПОТОМУ ЧТО МУТАЦИЙ ДВЕ, и одна сцена ловит ровно одну:
    //   (а) «побеждает ПОСЛЕДНИЙ в обходе» (`d2 <= best`) — ловит сцена, где
    //       меньший id стоит в обходе ПЕРВЫМ: враг-монстр, рождённый раньше
    //       врага-жителя (монстры в переписи впереди);
    //   (б) «побеждает ПЕРВЫЙ в обходе» (`d2 < best`) — ловит сцена, где
    //       меньший id стоит в обходе ПОСЛЕДНИМ: два врага-жителя (пул
    //       обходится с хвоста, старший id идёт первым).
    // Расстояния равны ТОЧНО: смещения ±1 м по y и 5 м по x представимы во
    // float без остатка, поэтому равенство d² — свойство сцены, а не удача.
    {
        const float y = 232.125f;
        Stand st;
        const vec3 obsAt{30.0f, y, kStandZ};
        // Сцена (а): наблюдатель-житель; враг-МОНСТР рождён РАНЬШЕ врага-жителя.
        const Entity foeMob =
            st.mob(MobKind::Zombie, vec3{obsAt.x + 5.0f, y + 1.0f, kStandZ});
        const Entity foeRes = st.resident(
            Faction::Wild, vec3{obsAt.x + 5.0f, y - 1.0f, kStandZ});
        const Entity obs = st.resident(Faction::Citizens, obsAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        CHECK(foeMob < foeRes);                  // предпосылка сцены
        CHECK(wrap_dist2(obsAt, st.reg.get<const Transform>(foeMob).pos,
                         kWorldExtent) ==
              wrap_dist2(obsAt, st.reg.get<const Transform>(foeRes).pos,
                         kWorldExtent));
        const Watched w = st.window(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sen.visible == 2u);              // оба врага восприняты
        CHECK(w.sen.foe == foeMob);              // ...и выбран МЕНЬШИЙ id
    }
    {
        const float y = 236.125f;
        Stand st;
        const vec3 obsAt{30.0f, y, kStandZ};
        // Сцена (б): два врага-жителя; меньший id обходится ПОСЛЕДНИМ.
        const Entity foeA = st.resident(
            Faction::Citizens, vec3{obsAt.x + 5.0f, y + 1.0f, kStandZ});
        const Entity foeB = st.resident(
            Faction::Citizens, vec3{obsAt.x + 5.0f, y - 1.0f, kStandZ});
        const Entity obs = st.mob(MobKind::Zombie, obsAt);
        st.aim(obs, vec3{1.0f, 0.0f, 0.0f});
        CHECK(foeA < foeB);                      // предпосылка сцены
        const Watched w = st.window(grid, obs, 1);
        CHECK(w.visits == 1u);
        CHECK(w.sen.visible == 2u);
        CHECK(w.sen.foe == foeA);                // МЕНЬШИЙ id, а не первый в обходе
    }
}
