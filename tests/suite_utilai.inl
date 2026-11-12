// Utility AI — the arbitration suite.
//
// This suite exists for ONE reason, and it is not "does the scorer add up". It is
// that main already has systems which steer, so switching a utility AI on without
// settling who moves the body makes two systems fight over the same `Velocity`
// every tick and the crowd jitters — a bug that reads as broken physics and is
// not. The parked branch driver (`tools/branch_port_pending/ai.cpp`) was exactly
// that second writer.
//
// ЧТО СУДИТСЯ ЗДЕСЬ ТЕПЕРЬ (2026-11-09, пункт 2 шаг 2). Токен `MotionOwner` и
// обе двери к нему (`ai_owns_motion`/`motion_owned`) УМЕРЛИ, и вместе с ними
// умер предмет половины утверждений этого файла: арбитрировать запись нечем,
// когда писатель физически один. Вместо шести рулевых проходов, каждый из
// которых писал скорость сам, стоит ЗАЯВКА ЦЕЛИ (`Steer`, ранг + тик) и ОДИН
// писатель `guide_step` ([game/guide.h]). Поэтому несущие блоки читаются так:
//
//   Block 4 — ОДИН ПИСАТЕЛЬ, и это ЗАМЕР, а не построение. Сентинель взводится
//             каждый тик, затем прогоняется ВСЯ ЦЕПОЧКА ЗАЯВИТЕЛЕЙ в
//             прод-порядке (`ai_step` -> `ai_patrol_step` -> `wander_step`) и
//             ОДИН `guide_step`. Утверждается тройка: ни один заявитель скорость
//             НЕ ПИШЕТ (сентинель цел после всей цепочки), тело с заявкой
//             написано РОВНО ОДИН РАЗ («написанных тел» == `led + held`), тело
//             без ЖИВОЙ заявки не написано ВОВСЕ. Непустота проверяется ПО
//             РАНГАМ (`byRank[Flee] > 0`, `byRank[Walk] > 0`): ноль двойных
//             записей, купленный молчанием заявителей, — фальшивый гейт.
//   Block 5 — ГЕЙТ ЗАЯВКИ, ПОЛЯРНОСТЬ В ОБЕ СТОРОНЫ, и он СИЛЬНЕЕ прежнего
//             гейта токена. Сильная заявка руками -> прогулка обязана отказаться
//             ОТ РАБОТЫ (`WanderTick::considered == 0`, вопрос стоит ДО
//             счётчика), а не «просто не записать скорость»: отказ после
//             побочных эффектов был бы стрельбой на бегу. Нет заявки -> прогулка
//             обязана ВЗЯТЬ тело, заявить `Walk` и быть исполненной. Плюс
//             ИСПОРЧЕННЫЙ БАЙТ РАНГА: нераспознанное значение читается как
//             «заявки нет», тело НЕ пишется (`bogus`), и ведёт его слабейший
//             заявитель — отказ падает в сторону ведения, НИКОГДА в сторону
//             замершей толпы (гейт `e2e_test` f8_03, перенесённый с токена).
//   Block 3 — HYSTERESIS, measured. Intent switches per 100 re-plans with the
//             hysteresis on and off, printed as real numbers. A utility AI
//             without hysteresis thrashes, and a thrash you cannot count is not a
//             claim.
//
// Blocks 9-15 cover MEMORY (`AiMemory`, [ai.h] banner). Same standard: the point
// is never "the ring stores bytes", it is that a remembered fact CHANGES AN
// OUTCOME, with the difference printed as a number.
//
//   Block 9  — the ring. DEMAND allocation (0 bytes until the first write, then
//              the 4096-row chunk), the footprint table printed at demo scale and
//              at 2^20, payload round-trips, COALESCING (200 sightings of one cell
//              collapse to one trace, not eight), weakest-first eviction, lazy
//              expiry, and the payload-family guard.
//   Block 10 — MEMORY CHANGES THE MIND, twice. First as pure arithmetic: the same
//              Perception with and without one remembered danger mark, flee score
//              printed both ways. Then end to end through the driver, with the
//              LIVE recorder in the loop: hot field -> bodies flee and file a
//              trace -> field EVAPORATES -> the remembering arm keeps fleeing and
//              the forgetting arm goes back to work. Both counts printed.
//   Block 11 — the grudge is SIGNED BY FACTION. One remembered attacker moves
//              Liquidators toward combat and Citizens toward flight; measured as
//              committed-intent counts over 512 identities, all four printed.
//   Block 12 — MEMORY CHANGES THE MOTION, and the single-writer rule survives it.
//              A flat (gradient-free) danger field gives flee no live direction;
//              with memory the body ЗАЯВЛЯЕТ пеленг от запомненной клетки рангом
//              `Flee`, without memory it files nothing at all. Then block 4's
//              single-writer probe re-run with memory ON.
//   Block 13 — the TTL and the freshness curve are real: the age at which the
//              memory stops changing the decision is measured and printed, and the
//              trace is invisible at its TTL.
//   Block 14 — determinism, including every memory row, folded into one FNV-1a
//              digest the way suite_macrosim does for the pool columns.
//   Block 15 — memory is keyed by NpcId, so it SURVIVES the body. Fold the record
//              back, re-embody it (what an elevator ride does) and the recall is
//              unchanged while the AiBrain is fresh.
//
// МОГИЛА ПРЕДУПРЕЖДЕНИЯ. Здесь стояло «!! Block 5 (and therefore Block 4) FAILS
// UNTIL the guard lands in src/game/wander.cpp: if (ai_owns_motion(reg, e))
// continue;» — девять строк о ОДНОЙ недостающей строке прода. Предмет умер
// дважды: гейт в `wander.cpp` сперва приехал (2026-10), а затем перестал быть
// гейтом токена вовсе — сегодня там `steer_claimed_by_stronger(reg, e,
// SteerRank::Walk, tick)`, то есть ОДИН вопрос вместо четырёх его формулировок.
// Довод предупреждения при этом ЖИВ и перенесён в блок 5: гейт ЕСТЬ механизм,
// поэтому полярность гоняется в обе стороны, а не утверждается.
//
// WHAT THIS SUITE DOES **NOT** PROVE, so nobody reads the pass as broader than it
// is. Цепочка здесь — `ai_step`, `ai_patrol_step`, `wander_step` и `guide_step`.
//
//   * `place_errand_step` (ранг `Errand`, [game/place.h]) стоит в проде МЕЖДУ
//     нарядом и прогулкой, и в этой оснастке его НЕТ: ему нужны объявленные
//     комнаты этажа и шина событий. Его заявку судит `suite_place`, и это
//     названо, а не подразумевается.
//   * `investigate_step` (слух мобов) и `faction_feud_step` (вражда) ПИШУТ
//     скорость сами и стоят в кадре НИЖЕ `guide_step` ([app/main.cpp]). Вражда
//     заявку уже спрашивает (`steer_claimed_by_stronger` в
//     `faction_relations.cpp`), но запись у неё своя; слух не спрашивает вовсе —
//     именно он дал прибору 45 двойных записей за 250 тиков ([game/guide.h],
//     шапка). Их переезд в заявки — второй долг пункта 2, и этот файл о них
//     МОЛЧИТ: оба здесь не вызываются.
//
// A .inl and not a .cpp for the reason suite_samosbor.inl states: game_test owns
// the CHECK macro, so the include has to land after it, and the suite carries its
// own #include of the system under test to keep that diff two lines.

#include "game/ai.h"
#include "game/guide.h"   // Steer/SteerRank/guide_step — ЗАЯВКА и ЕДИНСТВЕННЫЙ писатель
#include "game/needs.h"   // needs_roll — NOT reachable from game_test.cpp's prelude
#include "game/wander.h"  // wander_init / wander_step / kWanderPeriod
#include "sim/diffusion.h"
#include "world/field.h"
#include "world/nav.h"

namespace utilai {

// ---------------------------------------------------------------------------
// The arena.
//
// A bare MacroGrid + a hand-written node-0 flow slice, the way
// suite_behaviours.inl does it: a full `World` is ~138 MiB and a real
// `bake_fine` is 128 MiB and seconds of BFS, and neither buys anything here —
// `wander_step` reads one flow byte and `ai_step` reads a float field and a
// wall test. Everything below shares ONE arena.
// ---------------------------------------------------------------------------

// The sentinel. Писатель один, и он не умеет произвести эту пару: `guide_step`
// пишет либо `dir*speed` по нормированному пеленгу, либо владеемый ноль. Значит
// «x всё ещё kSentX» есть ТОЧНЫЙ, а не статистический ответ на вопрос «писал ли
// в это тело хоть кто-нибудь» — и теперь этот вопрос задаётся дважды: после
// цепочки ЗАЯВИТЕЛЕЙ (обязан быть «нет») и после ВЕДЕНИЯ.
constexpr float kSentX = 777.0f;
constexpr float kSentY = -777.0f;

inline bool is_sentinel(const Velocity& v) {
    return v.v.x == kSentX && v.v.y == kSentY;
}

// ЗАЯВКА ЭТОГО ТЕЛА НА ЭТОТ ТИК — ОДИН ВОПРОС, И РОВНО ТОТ, КОТОРЫЙ ЗАДАЁТ ПРОД.
// `SteerRank::None` возвращается для всех трёх исходов — компоненты нет, заявка
// прошлого тика, байт ранга непонятен, — потому что мир читает их ОДИНАКОВО
// («заявки нет», [game/guide.h] `steer_claim_live`). Тест, различающий их,
// утверждал бы о механизме, которого у прода нет, и был бы вторым ответом.
inline SteerRank claim_rank(const Registry& reg, Entity e, std::uint64_t tick) {
    const Steer* s = reg.try_get<Steer>(e);
    if (s == nullptr || !steer_claim_live(*s, tick)) return SteerRank::None;
    return s->rank;
}
inline bool claimed(const Registry& reg, Entity e, std::uint64_t tick) {
    return claim_rank(reg, e, tick) != SteerRank::None;
}
inline std::size_t rank_slot(SteerRank r) { return static_cast<std::size_t>(r); }

// Layer under test. A bare id: nothing here pushes a LevelStack layer, because
// neither system reads the stack — `Transform::layer` is only ever compared.
constexpr LayerId kLayer = 0;

// Put an embodied NPC record on the floor at a macro cell centre.
inline Entity make_body(Registry& reg, NpcPool& pool, int cx, int cy, int cz,
                        Faction f, NpcId& outId) {
    const NpcId id = pool.spawn();
    pool.faction(id) = static_cast<std::uint16_t>(f);
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    const Entity e = embody(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos =
        vec3{(static_cast<float>(cx) + 0.5f) * kCellSize,
             (static_cast<float>(cy) + 0.5f) * kCellSize,
             (static_cast<float>(cz) + 0.5f) * kCellSize};
    outId = id;
    return e;
}

// Фикстура «тело идёт +x» переехала в `zone_fixture.inl` под именем
// `arm_zones_plus_x` (§88/F.2): прогулка читает нав ПО ЗОНАМ, а не поле решётки,
// и подделывать надо два её чтения, а не один байт потока. Здесь была
// `fill_flow_plus_x`, и она ушла вместе с предметом — тест, переживший свой
// предмет, есть будущая вторая реализация.

// Snapshot every body's Velocity to the sentinel.
inline void arm_sentinels(Registry& reg, const std::vector<Entity>& bodies) {
    for (Entity e : bodies) reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
}

// FNV-1a byte fold, the same primitive suite_macrosim digests pool columns with.
// Used in block 14 to reduce every memory row of every body to one number, so a
// determinism failure is one comparison instead of hundreds.
inline void fold_u32(std::uint32_t& h, std::uint32_t v) {
    for (int b = 0; b < 4; ++b) {
        h ^= (v >> (b * 8)) & 0xFFu;
        h *= 16777619u;
    }
}
inline void fold_f32(std::uint32_t& h, float f) {
    // Exact, and without <cstring>: seconds at millisecond resolution, which is
    // finer than anything this suite advances by (kSimDt == 8 ms).
    fold_u32(h, static_cast<std::uint32_t>(f * 1000.0f + 0.5f));
}
inline std::uint32_t digest_memory(const AiMemory& mem, NpcId id,
                                   std::uint32_t h = 2166136261u) {
    const MemoryRow& r = mem.row(id);
    for (int i = 0; i < kMemSlots; ++i) {
        fold_u32(h, r.slot[i].packed);
        fold_f32(h, r.slot[i].seenAt);
    }
    return h;
}

// A calm, healthy, full-needs Citizen's Perception — the baseline every memory
// block perturbs. Every stubbed field keeps its zero/-1 default, so the ONLY
// difference between the two arms of a measurement is the memory.
//
// With `needs_roll` bands (food/water 70..100, sleep 60..100, pee 0..30,
// poo 0..20) every pressure curve reads exactly 0, and at full HP so does
// healthPressure — so `urgent == 0` for this body and the arithmetic in the
// comments below is exact rather than approximate.
inline Perception calm_citizen(std::uint32_t npcId, Faction f = Faction::Citizens) {
    Perception p;
    p.idSeed = identity_seed(npcId);
    p.faction = static_cast<std::uint16_t>(f);
    p.hp = 100.0f;
    p.maxHp = 100.0f;
    return p;
}

} // namespace utilai

static void test_utilai_all() {
    using namespace utilai;

    // ======================================================================
    // 1. The scorer is pure, and the ranking responds to the inputs that are
    //    actually live (needs + danger), not to the stubbed ones.
    // ======================================================================
    {
        Needs fresh = needs_roll(12345u);
        CHECK(fresh.seeded != 0);

        Perception p;
        p.idSeed = identity_seed(7u);
        p.faction = static_cast<std::uint16_t>(Faction::Citizens);
        p.hp = 100.0f;
        p.maxHp = 100.0f;
        p.danger = 0.0f;

        float a[kIntentCount];
        float b[kIntentCount];
        score_intents(p, fresh, a);
        score_intents(p, fresh, b);
        // Purity: same inputs, same output, bit for bit. No stored RNG, no clock.
        for (int i = 0; i < kIntentCount; ++i) CHECK(a[i] == b[i]);

        // Every score is inside the band the reference clamps to.
        for (int i = 0; i < kIntentCount; ++i) {
            CHECK(a[i] >= 0.0f);
            CHECK(a[i] <= 100.0f);
        }

        // A calm, healthy, fresh-needs citizen does NOT flee, and does not pick a
        // survival intent at all. This is the "stubbed inputs contribute 0"
        // invariant stated as behaviour: with no threat and no unmet need, the
        // ranking is decided by faction traits alone.
        const std::uint8_t calm = select_intent_raw(a);
        CHECK(calm != IntentFlee);
        CHECK(calm != IntentSafety);
        CHECK(calm != IntentHeal);   // hp == maxHp -> healthPressure 0

        // Turn the one live threat channel up and flee must overtake it. Nothing
        // else changed, so this isolates the diffusion field's contribution.
        p.danger = 100.0f;
        float hot[kIntentCount];
        score_intents(p, fresh, hot);
        CHECK(hot[IntentFlee] > a[IntentFlee]);
        CHECK(select_intent_raw(hot) == IntentFlee);

        // A zeroed (never-seeded) Needs row reads as total crisis. This is exactly
        // the trap ai.cpp's `needs_for` substitution exists to avoid, and pinning
        // it here means a future change that drops the substitution shows up as a
        // crowd that eats forever rather than as a silent behaviour shift.
        Needs unseeded{};
        CHECK(unseeded.seeded == 0);
        float starving[kIntentCount];
        p.danger = 0.0f;
        score_intents(p, unseeded, starving);
        const std::uint8_t crisis = select_intent_raw(starving);
        CHECK(crisis == IntentDrink || crisis == IntentEat);
        CHECK(starving[IntentDrink] > a[IntentDrink]);
    }

    // ======================================================================
    // 2. select_intent's hysteresis, as an algebraic contract on 13 numbers.
    // ======================================================================
    {
        float s[kIntentCount];
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;

        // No valid incumbent -> raw argmax.
        s[IntentWork] = 30.0f;
        CHECK(select_intent(s, kIntentNone) == IntentWork);

        // A challenger inside the margin does NOT take over.
        s[IntentSocial] = 30.0f + kSwitchMargin - 0.5f;
        CHECK(select_intent(s, IntentWork) == IntentWork);
        // Strictly past the margin, it does.
        s[IntentSocial] = 30.0f + kSwitchMargin + 0.5f;
        CHECK(select_intent(s, IntentWork) == IntentSocial);

        // ОДНА ДВЕРЬ, И ОНА ОДНА ДЛЯ ВСЕХ (снос класса «аварийных интентов»
        // 2026-11-08). Прежде здесь пинился обход порога: четырём избранным
        // интентам со счётом >= 58 позволялось перебить действующий без
        // порога, остальным — нет. Класса нет; бегство внутри порога держится
        // ровно так же, как любое дело.
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;
        s[IntentWork] = 55.0f;
        s[IntentFlee] = 57.0f;                       // выше, но внутри порога
        CHECK(s[IntentFlee] > s[IntentWork]);
        CHECK(s[IntentFlee] <= s[IntentWork] + kSwitchMargin);
        CHECK(select_intent(s, IntentWork) == IntentWork);
        // За порогом — перебивает, и БЕЗ всякой принадлежности к классу: тот
        // же ответ даёт мирное «общаться» с тем же счётом.
        s[IntentFlee] = 55.0f + kSwitchMargin + 0.5f;
        CHECK(select_intent(s, IntentWork) == IntentFlee);
        for (int i = 0; i < kIntentCount; ++i) s[i] = 0.0f;
        s[IntentWork] = 55.0f;
        s[IntentSocial] = 55.0f + kSwitchMargin + 0.5f;
        CHECK(select_intent(s, IntentSocial) == IntentSocial);
        CHECK(select_intent(s, IntentWork) == IntentSocial);

        // ПОЧЕМУ КЛАСС НЕ НУЖЕН: угроза разводит бегство и дело САМА, на
        // порядок больше порога. Это свойство скорера, а не совпадение — у
        // работы угроза входит с минусом, у бегства с плюсом, по 42 очка.
        {
            Perception calm = calm_citizen(4242u);
            Needs full{};
            full.food = kNeedMax;
            full.water = kNeedMax;
            full.sleep = kNeedMax;
            full.seeded = 1;
            float quiet[kIntentCount];
            score_intents(calm, full, quiet);
            Perception scared = calm;
            scared.danger = 1.0f;          // поле опасности на капе
            scared.visibleHostiles = 2;
            float alarmed[kIntentCount];
            score_intents(scared, full, alarmed);
            CHECK(alarmed[IntentFlee] - alarmed[IntentWork] >
                  quiet[IntentFlee] - quiet[IntentWork] + 10.0f * kSwitchMargin);
            CHECK(select_intent(alarmed, IntentWork) == IntentFlee);
        }

        // Ties favour the lower index, which is why the enum order is frozen.
        for (int i = 0; i < kIntentCount; ++i) s[i] = 42.0f;
        CHECK(select_intent_raw(s) == 0);

        // The stickiness curve's stated band.
        CHECK(stickiness_amount(0.0f) == kStickBase);
        CHECK(stickiness_amount(1000.0f) == kStickBase + kStickCap);
        CHECK(stickiness_amount(10.0f) > stickiness_amount(1.0f));
    }

    // ======================================================================
    // 3. HYSTERESIS, MEASURED: intent switches per 100 re-plans, on vs off.
    //
    //    The cadence is forced to 0 s so every tick is a re-plan — at the
    //    shipping [1.5, 4.0] s cadence, 100 ticks (0.8 s at kSimHz) would hold at
    //    most ONE re-plan and the measurement could not distinguish anything.
    //    So the number below is honestly "switches per 100 RE-PLANS", and the
    //    print says so.
    //
    //    The oscillation is the danger field, flipped every tick between two
    //    values chosen to straddle the work/flee ranking boundary for a Citizen
    //    with fresh needs (crossover at threat ~= 0.101; the two values sit at
    //    0.02 and 0.25, so the raw ranking flips by a margin that clears the
    //    +/-2.5 identity jitter on every id). The field is flat, so its GRADIENT
    //    is zero и ЗАЯВКИ НА ВЕДЕНИЕ НЕ ПОДАЁТ НИКТО — this block measures the
    //    brain's mind, not its steering.
    // ======================================================================
    std::uint32_t switchesOn = 0;
    std::uint32_t switchesOff = 0;
    {
        constexpr int kBodies = 8;
        constexpr int kTicks = 100;
        constexpr float kCalmDanger = 2.0f;  // threat 0.02 -> work leads
        constexpr float kScaryDanger = 25.0f; // threat 0.25 -> flee leads

        MacroGrid grid;              // all air; only the gradient's wall test reads it
        Field<float> danger(0.0f);

        for (int arm = 0; arm < 2; ++arm) {
            const bool hyst = (arm == 0);

            Registry reg;
            NpcPool pool;
            pool.init();

            std::vector<Entity> bodies;
            for (int i = 0; i < kBodies; ++i) {
                NpcId id = 0;
                bodies.push_back(
                    make_body(reg, pool, 20 + i, 20, 1, Faction::Citizens, id));
            }
            CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(kBodies));

            AiConfig cfg;
            cfg.enabled = true;
            cfg.hysteresis = hyst;
            cfg.rethinkBaseSec = 0.0f;   // re-plan every tick
            cfg.rethinkSpreadSec = 0.0f;

            double now = 0.0;
            std::uint32_t replans = 0;
            for (int t = 0; t < kTicks; ++t) {
                danger.fill((t % 2) == 0 ? kCalmDanger : kScaryDanger);
                const AiTick tick =
                    ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg);
                CHECK(tick.considered == static_cast<std::uint32_t>(kBodies));
                replans += tick.replanned;
                now += static_cast<double>(kSimDt);
            }
            // Every body re-planned on every tick, so "per 100 ticks" and "per
            // 100 re-plans" are the same number here. Asserted, not assumed: a
            // cadence that quietly stopped firing would make a switch count of 0
            // look like perfect hysteresis.
            CHECK(replans == static_cast<std::uint32_t>(kBodies * kTicks));

            std::uint32_t total = 0;
            for (Entity e : bodies) total += reg.get<AiBrain>(e).switches;
            if (hyst) switchesOn = total; else switchesOff = total;

            // ЗАЯВКИ НЕТ НИ У ОДНОГО ТЕЛА, и это теперь ОТСУТСТВИЕ ЗАПИСИ, а не
            // её особое значение: поле плоское, градиента нет, бегству вести
            // нечем — значит `ai_step` не заявляет ничего, и компонента `Steer`
            // на этих телах не рождается ВООБЩЕ (пул прогрет, рядов ноль).
            // Прежде здесь проверялся БАЙТ ТОКЕНА (`motion == Wander`); байта
            // нет, но утверждение то же и СИЛЬНЕЕ — забыть выставить нечего.
            //
            // Мутация, которую это ловит: «бегство без пеленга заявляет
            // `target_hold()` вместо молчания». Она выглядит безобиднее
            // (владеемый ноль!), а означает замершую толпу на плоском поле —
            // ровно тот отказ в сторону неподвижности, который канон запрещает.
            for (Entity e : bodies) CHECK(!reg.all_of<Steer>(e));
        }

        std::fprintf(stdout,
                     "[utilai] intent switches over %d re-plans (%d bodies x %d "
                     "ticks): hysteresis ON = %u, OFF = %u\n",
                     kBodies * kTicks, kBodies, kTicks, switchesOn, switchesOff);
        std::fprintf(stdout,
                     "[utilai] per 100 re-plans per body: ON = %.1f, OFF = %.1f\n",
                     100.0 * static_cast<double>(switchesOn) /
                         static_cast<double>(kBodies * kTicks),
                     100.0 * static_cast<double>(switchesOff) /
                         static_cast<double>(kBodies * kTicks));

        // The claim, stated as an assertion rather than as a print. Without
        // hysteresis the committed intent follows the oscillation and flips on
        // essentially every re-plan; with it, the incumbent's stickiness plus the
        // switch margin holds it, and flee never reaches the emergency score that
        // would bypass them.
        CHECK(switchesOff >= static_cast<std::uint32_t>(kBodies * (kTicks - 20)));
        CHECK(switchesOn <= static_cast<std::uint32_t>(kBodies));
        CHECK(switchesOff > switchesOn * 10u + 10u);
    }

    // ======================================================================
    // 4 + 5. ОДИН ПИСАТЕЛЬ — ЗАМЕР, А НЕ ПОСТРОЕНИЕ.
    //
    // Arena: danger is FLAT ZERO for x < 64 (no threat, no gradient -> work wins
    // -> заявляет прогулка) and a RAMP for x >= 64 (real threat AND a real
    // gradient -> flee wins -> заявляет бегство). Group A stands in the calm
    // half, group B in the ramp, so ОБА РАНГА живут в одном тике.
    //
    // ПРОБА, каждый тик, в ПРОД-ПОРЯДКЕ ([app/main.cpp]):
    //     взвести сентинель
    //     -> ai_step          (заявка `Flee`, пеленг против градиента)
    //     -> ai_patrol_step   (заявка `Patrol`, если интент патрульный)
    //     -> wander_step      (заявка `Walk`, цель-зона или владеемый ноль)
    //     -> СЕНТИНЕЛЬ ОБЯЗАН БЫТЬ ЦЕЛ: заявитель скорость не пишет
    //     -> guide_step       (ОДИН писатель)
    //     -> «написанных тел» == `led + held`, и ни одного тела без ЖИВОЙ заявки
    //
    // ПОЧЕМУ ЭТО СИЛЬНЕЕ ПРЕЖНЕЙ ПРОБЫ, а не просто другая. Прежняя взводила
    // сентинель ДВА РАЗА за тик и сравнивала два множества «кто подвинулся»;
    // она ловила только пересечение двух ИЗВЕСТНЫХ ей писателей, а пятый
    // (`investigate_step`) в её модель не входил — и дал в проде 45 двойных
    // записей за 250 тиков. Теперь утверждается не «эти двое не пересеклись», а
    // «НИ ОДИН заявитель не тронул скорость» (сентинель цел после всей цепочки)
    // и «ведение написало ровно по разу» (счётчик прохода сверен с ЗАМЕРОМ по
    // телам: если бы `guide_step` написал одно тело дважды, а другое ни разу,
    // `led + held` сошлось бы, а «написанных тел» — нет).
    //
    // `place_errand_step` в цепочке НЕТ — ему нужны объявленные комнаты этажа;
    // его ранг `Errand` судит `suite_place`. Названо, а не подразумевается.
    // ======================================================================
    {
        constexpr int kGroup = 12;   // bodies per group
        constexpr int kTicks = 200;  // >> kWanderPeriod, so every body is visited

        MacroGrid grid;   // all air
        Field<float> danger(0.0f);
        for (int x = 64; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>((x - 63) * 4);

        ZoneNav zn;
        zone_fixture::arm_zones_plus_x(zn);
        CHECK(zn.built());                      // or wander_step returns at once
        // Два чтения шага подделаны, и оба проверены: таблица ведёт из зоны 1 в
        // зону 2, плоскость соседки говорит «+x», и «+x» правда горизонтален.
        CHECK(zone_walk_dir(zn, 1, 2, 20, 30, 1, 2) == 1);
        CHECK(nav::kNavDir[1][2] == 0);         // +x really is a horizontal step

        Registry reg;
        NpcPool pool;
        pool.init();

        std::vector<Entity> groupA;   // calm half: wander must own these
        std::vector<Entity> groupB;   // ramp half: ai must own these
        std::vector<Entity> all;
        for (int i = 0; i < kGroup; ++i) {
            NpcId id = 0;
            groupA.push_back(
                make_body(reg, pool, 20 + i, 30, 1, Faction::Citizens, id));
            groupB.push_back(
                make_body(reg, pool, 70 + i, 30, 1, Faction::Citizens, id));
        }
        for (Entity e : groupA) all.push_back(e);
        for (Entity e : groupB) all.push_back(e);

        // The field really does carry a usable gradient where group B stands, and
        // really does not where group A stands. Asserted so an ownership result
        // can never be blamed on a dead field.
        const vec3 gB = diffusion_gradient(danger, grid, 70, 30, 1);
        const vec3 gA = diffusion_gradient(danger, grid, 20, 30, 1);
        CHECK(gB.x * gB.x + gB.y * gB.y > kMinFleeGrad2);
        CHECK(gA.x * gA.x + gA.y * gA.y <= kMinFleeGrad2);

        CHECK(wander_init(reg, kLayer) ==
              static_cast<std::uint32_t>(2 * kGroup));
        CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(2 * kGroup));

        AiConfig cfg;
        cfg.enabled = true;   // hysteresis left ON: this is the shipping config

        // ТЕМП ПАНИКИ — ПРОИЗВЕДЕНИЕ, А НЕ ВТОРОЕ ЧИСЛО. `kWalkSpeedMps` и
        // `kPanicPace` живут в [game/guide.h] одним домом; `kFleeSpeed@ai.h`
        // обязан быть их произведением, иначе «быстрее обычного» перестанет
        // выражаться через обычное и ретюн паники молча разойдётся с бегством
        // (замер шапки guide.h: это число было выписано ЧЕТЫРЕ раза).
        // Мутация «подкрутить kPanicPace и забыть kFleeSpeed» роняет строку.
        CHECK(kFleeSpeed == kWalkSpeedMps * kPanicPace);
        CHECK(kErrandSpeed == kWalkSpeedMps);

        // --- счётчики пробы ------------------------------------------------
        std::uint32_t selfWriters = 0;    // заявитель тронул скорость САМ
        std::uint32_t wroteNoClaim = 0;   // писатель написал тело без ЖИВОЙ заявки
        std::uint32_t claimedNotLed = 0;  // заявка подана, а ведения не случилось
        std::uint32_t ledMismatch = 0;    // «написанных тел» != `led + held`
        std::uint32_t movedTotal = 0, ledTotal = 0, heldTotal = 0;
        std::uint32_t byRank[kSteerRankCount] = {};
        std::uint32_t staleTotal = 0, bogusTotal = 0;
        std::uint32_t unresolvedTotal = 0, foreignTotal = 0;
        std::uint32_t fleeOnCalm = 0;     // спокойная половина заявила БЕГСТВО
        std::uint32_t calmOnRamp = 0;     // половина с градиентом НЕ заявила бегство

        double now = 0.0;
        for (int t = 0; t < kTicks; ++t) {
            const std::uint64_t tk = static_cast<std::uint64_t>(t);
            arm_sentinels(reg, all);

            // ВСЯ ЦЕПОЧКА ЗАЯВИТЕЛЕЙ, В ПРОД-ПОРЯДКЕ. Тик передаётся ЯВНО
            // (последний аргумент `ai_step`), потому что им помечается заявка:
            // с тиком по умолчанию проба мерила бы заявки одного тика 200 раз.
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg,
                        nullptr, nullptr, nullptr, nullptr, tk);
            CHECK(tick.considered == static_cast<std::uint32_t>(2 * kGroup));
            // ИМЕНА СЧЁТЧИКОВ ПЕРЕЖИЛИ ТОКЕН, И ЧИТАТЬ ИХ НАДО ПО СМЫСЛУ
            // ([game/ai.h], переименование за лидом): `aiOwned` означает
            // «бегство ЗАЯВИЛО ведение», `wanderOwned` — «передало дальше по
            // слабости». Их сумма обязана быть знаменателем: тело либо
            // заявлено бегством, либо отдано, третьего исхода нет.
            CHECK(tick.aiOwned + tick.wanderOwned == tick.considered);
            ai_patrol_step(reg, zn, kLayer, nullptr, tk);
            wander_step(reg, grid, pool, zn, kLayer, tk);

            // НИ ОДИН ЗАЯВИТЕЛЬ НЕ ПИШЕТ СКОРОСТЬ. Это главная строка пробы:
            // мутация «вернуть `steer_write` в любой из трёх проходов» —
            // ровно тот дефект, из-за которого прибор намерил 45 двойных
            // записей, — роняет её и НЕ роняет ничего больше.
            for (Entity e : all)
                if (!is_sentinel(reg.get<Velocity>(e))) ++selfWriters;

            // АРБИТРАЖ ПО РАНГУ, устойчиво по группам: поле опасности не
            // меняется, значит тело, перескочившее группу, есть дефект
            // арбитража, а не шум. Проверяется НАЛИЧИЕ/ОТСУТСТВИЕ `Flee`, а не
            // «ровно Walk»: наряд вправе заявить своё тело, и это не ошибка.
            for (Entity e : groupA)
                if (claim_rank(reg, e, tk) == SteerRank::Flee) ++fleeOnCalm;
            for (Entity e : groupB)
                if (claim_rank(reg, e, tk) != SteerRank::Flee) ++calmOnRamp;

            // ОДИН ПРОХОД ВЕДЕНИЯ.
            const GuideTick g = guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
            std::uint32_t moved = 0;
            for (Entity e : all) {
                const bool w = !is_sentinel(reg.get<Velocity>(e));
                const bool c = claimed(reg, e, tk);
                if (w) ++moved;
                if (w && !c) ++wroteNoClaim;
                if (!w && c) ++claimedNotLed;
            }
            // РОВНО ОДНА ЗАПИСЬ НА ТЕЛО. Счётчик прохода («сколько записей») и
            // замер по телам («сколько тел написано») обязаны СОВПАСТЬ: напиши
            // проход одно тело дважды, а другое ни разу — сумма сойдётся, а эта
            // строка покраснеет.
            if (moved != g.led + g.held) ++ledMismatch;
            movedTotal += moved;
            ledTotal += g.led;
            heldTotal += g.held;
            for (std::size_t r = 0; r < kSteerRankCount; ++r)
                byRank[r] += g.byRank[r];
            staleTotal += g.stale;
            bogusTotal += g.bogus;
            unresolvedTotal += g.unresolved;
            foreignTotal += g.foreign;

            now += static_cast<double>(kSimDt);
        }

        std::fprintf(stdout,
                     "[utilai] %d тиков x %d тел: заявители написали скорость %u "
                     "раз (обязан ноль), ведение написало %u тел (%u по цели + %u "
                     "владеемым нулём); по рангам бегство %u, наряд %u, прогулка "
                     "%u; заявок прошлого тика %u\n",
                     kTicks, 2 * kGroup, selfWriters, movedTotal, ledTotal,
                     heldTotal, byRank[rank_slot(SteerRank::Flee)],
                     byRank[rank_slot(SteerRank::Patrol)],
                     byRank[rank_slot(SteerRank::Walk)], staleTotal);

        // THE assertions this whole lane exists for.
        CHECK(selfWriters == 0);     // писатель ОДИН, и он не здесь
        CHECK(wroteNoClaim == 0);    // без живой заявки тело не пишется ВООБЩЕ
        CHECK(claimedNotLed == 0);   // заявлено -> проведено (заявка исполнима)
        CHECK(ledMismatch == 0);     // ровно одна запись на тело
        CHECK(movedTotal == ledTotal + heldTotal);
        // ...И ЭТО НЕ ПУСТОТА: оба ранга правда заявляли и правда ведены. Ноль
        // двойных записей, купленный молчанием заявителей, — фальшивый гейт
        // (именно так держался токен: два звена цепочки почти всегда молчали).
        CHECK(ledTotal > 0);
        CHECK(byRank[rank_slot(SteerRank::Flee)] > 0);
        CHECK(byRank[rank_slot(SteerRank::Walk)] > 0);
        // НОЛЬ ЕСТЬ «ЗАЯВКИ НЕТ», и по нему писать нельзя никогда: слот ранга
        // `None` обязан остаться пустым, иначе зануленная компонента или свежий
        // эмплейс читались бы как заявка.
        CHECK(byRank[rank_slot(SteerRank::None)] == 0);
        // САМОПРОВЕРКИ ПРОХОДА. Непонятный байт, недостижимая ЗАЯВЛЕННАЯ цель и
        // заявка на чужом теле обязаны быть нулём — это не статистика.
        CHECK(bogusTotal == 0);
        CHECK(unresolvedTotal == 0);
        CHECK(foreignTotal == 0);
        // ...А ВОТ `stale` НУЛЁМ НЕ ОБЯЗАН, и шапка [game/guide.h] здесь
        // ошибается (назвал в отчёте). Прогулка посещает тело раз в
        // `kWanderPeriod` тиков, поэтому семь тиков из восьми тело несёт заявку
        // ПРОШЛОГО тика. Положительный ноль здесь и был бы ложью; гейт в том,
        // что устаревшая заявка НЕ ИСПОЛНЯЕТСЯ (`wroteNoClaim == 0` выше), а
        // эта строка делает тот гейт непустым: мутация «читать заявку без
        // сверки тика» роняет `wroteNoClaim`, и роняет её только потому, что
        // устаревшие заявки правда есть.
        CHECK(staleTotal > 0);
        CHECK(fleeOnCalm == 0);
        CHECK(calmOnRamp == 0);

        // Steering direction: group B flees UP-field, i.e. down the danger
        // gradient. The ramp rises with +x, so a fleeing body must move in -x.
        // И ПОРЯДОК ЗДЕСЬ — УТВЕРЖДЕНИЕ: после `ai_step` скорости НЕТ НИ У
        // КОГО, она появляется только от `guide_step`. Заявка — не движение.
        const std::uint64_t kDirTick = static_cast<std::uint64_t>(kTicks);
        arm_sentinels(reg, all);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, nullptr,
                nullptr, nullptr, nullptr, kDirTick);
        std::uint32_t steeredBeforeGuide = 0;
        for (Entity e : all)
            if (!is_sentinel(reg.get<Velocity>(e))) ++steeredBeforeGuide;
        CHECK(steeredBeforeGuide == 0);
        const GuideTick gDir = guide_step(reg, zn, kLayer, kDirTick, nullptr, nullptr);
        CHECK(gDir.led == static_cast<std::uint32_t>(kGroup));   // только B
        CHECK(gDir.held == 0u);
        CHECK(gDir.byRank[rank_slot(SteerRank::Flee)] ==
              static_cast<std::uint32_t>(kGroup));
        for (Entity e : groupB) {
            const Velocity& v = reg.get<Velocity>(e);
            CHECK(v.v.x < 0.0f);
            CHECK(v.v.z == 0.0f);   // z is gravity's, never the writer's
            const float sp = std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y);
            CHECK(std::fabs(sp - kFleeSpeed) < 1e-3f);
        }
        // Спокойная половина заявки не подавала (прогулку в этом тике не
        // звали), значит ведение её НЕ ПИСАЛО: тело без заявки едет на прошлой
        // скорости — ровно как при стаггере, когда проход тело не посетил.
        for (Entity e : groupA) CHECK(is_sentinel(reg.get<Velocity>(e)));

        // ---- Block 5: ГЕЙТ ЗАЯВКИ, ПОЛЯРНОСТЬ В ОБЕ СТОРОНЫ ----------------
        // Независимо от того, что решил мозг выше: заявка ставится РУКАМИ, и
        // проверяется, что прогулка её чтит. Прежде здесь ставился БАЙТ ТОКЕНА
        // и утверждалось «прогулка не записала скорость»; сегодня это было бы
        // ВТОРЫМ ОТВЕТОМ — скорость она не пишет вовсе. Утверждение переехало
        // туда, где механизм и живёт: прогулка обязана ОТКАЗАТЬСЯ ОТ РАБОТЫ,
        // и вопрос она задаёт ДО счётчика посещённых и до всякой работы
        // ([game/wander.cpp], `steer_claimed_by_stronger` стоит перед
        // `++out.considered`). Мутация «снять гейт у прогулки» роняет первые
        // две строки: тело попадает в знаменатель и получает цель.
        const std::uint64_t kStrongTick = 1000;
        std::uint32_t handClaims = 0;
        for (Entity e : all)
            if (steer_claim(reg, e, kStrongTick, SteerRank::Flee,
                            target_dir(vec3{-1.0f, 0.0f, 0.0f}, kFleeSpeed)))
                ++handClaims;
        CHECK(handClaims == static_cast<std::uint32_t>(2 * kGroup));
        arm_sentinels(reg, all);
        const WanderTick wStrong =
            wander_step(reg, grid, pool, zn, kLayer, kStrongTick);
        CHECK(wStrong.considered == 0u);
        CHECK(wStrong.walking == 0u);
        // И ЗАЯВКА ЦЕЛА — не только ранг, но и ЦЕЛЬ: слабая поверх сильной не
        // ложится ([game/guide.h] `steer_claim`). Это второй рубеж того же
        // закона, и проверять его отдельно ОБЯЗАТЕЛЬНО: сними гейт у прогулки —
        // ранг устоит сам, и тест, судивший только ранг, остался бы зелёным.
        std::uint32_t overwritten = 0, touched = 0;
        for (Entity e : all) {
            const Steer& s = reg.get<Steer>(e);
            if (s.rank != SteerRank::Flee || s.target.kind != TargetKind::Dir ||
                s.target.dir.x != -1.0f)
                ++overwritten;
            if (!is_sentinel(reg.get<Velocity>(e))) ++touched;
        }
        CHECK(overwritten == 0u);
        CHECK(touched == 0u);
        // ...и ведёт тело именно СИЛЬНАЯ заявка: -x на темпе паники.
        const GuideTick gStrong =
            guide_step(reg, zn, kLayer, kStrongTick, nullptr, nullptr);
        CHECK(gStrong.led == static_cast<std::uint32_t>(2 * kGroup));
        CHECK(gStrong.byRank[rank_slot(SteerRank::Flee)] ==
              static_cast<std::uint32_t>(2 * kGroup));
        std::uint32_t wrongDir = 0;
        for (Entity e : all) {
            const Velocity& v = reg.get<Velocity>(e);
            if (v.v.x >= 0.0f || std::fabs(v.v.y) > 1e-6f ||
                std::fabs(std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y) - kFleeSpeed) >
                    1e-3f)
                ++wrongDir;
        }
        CHECK(wrongDir == 0u);

        // ОБРАТНАЯ ПОЛЯРНОСТЬ: ЗАЯВКИ НЕТ — прогулка обязана ВЗЯТЬ тело. Без
        // этой половины гейт читался бы как «занято всегда», и отказ падал бы в
        // сторону замершей толпы — ровно то, что канон запрещает поимённо.
        for (Entity e : all) reg.get<Steer>(e).rank = SteerRank::None;
        std::uint32_t visited = 0, walkClaims = 0, walkLed = 0;
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t) {
            const std::uint64_t tk = kStrongTick + 1 + t;
            arm_sentinels(reg, all);
            visited += wander_step(reg, grid, pool, zn, kLayer, tk).considered;
            guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
            for (Entity e : all) {
                if (claim_rank(reg, e, tk) == SteerRank::Walk) ++walkClaims;
                if (!is_sentinel(reg.get<Velocity>(e))) ++walkLed;
            }
        }
        // Стаггер посещает КАЖДОЕ тело РОВНО РАЗ за период (слот есть функция
        // тождества), поэтому здесь равенство, а не оценка снизу: прежняя
        // редакция ограничивала счёт `>= 2*kGroup` и пропустила бы проход,
        // посетивший одно тело восемь раз.
        CHECK(visited == static_cast<std::uint32_t>(2 * kGroup));
        CHECK(walkClaims == static_cast<std::uint32_t>(2 * kGroup));
        CHECK(walkLed == static_cast<std::uint32_t>(2 * kGroup));
        std::fprintf(stdout,
                     "[utilai] гейт заявки: при сильной заявке прогулка "
                     "рассмотрела %u тел и написала %u; без заявки за период "
                     "стаггера рассмотрела %u, заявила %u, ведение написало %u\n",
                     wStrong.considered, touched, visited, walkClaims, walkLed);

        // ---- ИСПОРЧЕННЫЙ БАЙТ РАНГА: ОТКАЗ ПАДАЕТ В СТОРОНУ ВЕДЕНИЯ --------
        // Это гейт `e2e_test` f8_03, перенесённый с токена на заявку ДОСЛОВНО.
        // У токена он звучал «`Wander == 0`, поэтому забытый байт читается как
        // „ведёт как сегодня“»; у заявки — «`SteerRank::None == 0`, поэтому
        // любое непонятное значение байта читается как „заявки нет“». Обратная
        // формулировка («не прогулка значит занято») однажды уже прошла бы
        // ревью, и цена её — замершая толпа на любом мусоре в компоненте.
        //
        // Мутации, которые это ловит, и каждая роняет РАЗНУЮ строку:
        //   * `steer_claim_live` без проверки `rank < Count` -> первая строка;
        //   * `guide_step` исполняет непонятный ранг -> тело написано (третья);
        //   * `steer_claimed_by_stronger` считает мусор заявкой -> прогулка
        //     тело не берёт, и последние две строки краснеют (толпа замерла).
        const std::uint64_t kBadTick = kStrongTick + 100;
        const Entity victim = groupA[0];
        CHECK(steer_claim(reg, victim, kBadTick, SteerRank::Walk,
                          target_dir(vec3{1.0f, 0.0f, 0.0f}, kWalkSpeedMps)));
        CHECK(steer_claim_live(reg.get<Steer>(victim), kBadTick));
        reg.get<Steer>(victim).rank = static_cast<SteerRank>(42);
        CHECK(!steer_claim_live(reg.get<Steer>(victim), kBadTick));
        CHECK(!steer_claimed_by_stronger(reg, victim, SteerRank::Walk, kBadTick));
        arm_sentinels(reg, all);
        const GuideTick gBad = guide_step(reg, zn, kLayer, kBadTick, nullptr, nullptr);
        CHECK(gBad.bogus == 1u);
        CHECK(gBad.led + gBad.held == 0u);   // ни это тело, ни чужие просрочки
        CHECK(is_sentinel(reg.get<Velocity>(victim)));
        // ...И СЛАБЕЙШИЙ ЗАЯВИТЕЛЬ ВЕДЁТ ЕГО ДАЛЬШЕ: за один период стаггера
        // прогулка приходит ровно раз, перебивает мусор своей заявкой и тело
        // едет. Это и есть «худшее, что может случиться».
        std::uint32_t victimWalk = 0, victimLed = 0;
        for (std::uint64_t t = 1; t <= kWanderPeriod; ++t) {
            const std::uint64_t tk = kBadTick + t;
            arm_sentinels(reg, all);
            wander_step(reg, grid, pool, zn, kLayer, tk);
            guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
            if (claim_rank(reg, victim, tk) == SteerRank::Walk) ++victimWalk;
            if (!is_sentinel(reg.get<Velocity>(victim))) ++victimLed;
        }
        CHECK(victimWalk == 1u);
        CHECK(victimLed == 1u);
        std::fprintf(stdout,
                     "[utilai] испорченный байт ранга (42): заявка не жива, "
                     "ведение не написало тело (bogus %u), прогулка подхватила "
                     "его за %u тиков стаггера\n",
                     gBad.bogus, kWanderPeriod);
    }

    // ======================================================================
    // 6. DEFAULT OFF, and off means inert.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);

        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        const Entity e = make_body(reg, pool, 80, 40, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);

        // The default-constructed config is the shipping one, and it is OFF.
        const AiConfig defaults;
        CHECK(!defaults.enabled);

        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        double now = 0.0;
        for (int t = 0; t < 50; ++t) {
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt);
            CHECK(tick.considered == 0);
            CHECK(tick.replanned == 0);
            CHECK(tick.aiOwned == 0);
            now += static_cast<double>(kSimDt);
        }
        // Nothing steered, nothing decided, и ЗАЯВКИ НЕ ПОЯВИЛОСЬ ВОВСЕ.
        CHECK(is_sentinel(reg.get<Velocity>(e)));
        const AiBrain& b = reg.get<AiBrain>(e);
        CHECK(b.currentIntent == kIntentNone);
        CHECK(b.decisions == 0);
        // Здесь проверялся БАЙТ ТОКЕНА («motion == Wander», «!ai_owns_motion»).
        // Байта нет; утверждение то же и выражено прямо: выключенный ИИ не
        // кладёт на тело ни одной заявки за 50 тиков, и компонента `Steer` на
        // нём не рождается — выключить ИИ на живом этаже безопасно САМО, без
        // явного снятия (могила `ai_release`, [game/ai.h]).
        CHECK(!reg.all_of<Steer>(e));

        // Тело БЕЗ МОЗГА невидимо для арбитража, и это то, что делает посадку
        // ИИ аддитивной: пока `ai_init` не позван, прогулка ведёт его в точности
        // как прежде. Выражено тем же вопросом, которым спрашивает прод: «меня
        // уже перебил кто-то сильнее?» — и ответ обязан быть «нет».
        NpcId bare = 0;
        const Entity naked = make_body(reg, pool, 10, 40, 1, Faction::Wild, bare);
        CHECK(!reg.all_of<AiBrain>(naked));
        CHECK(!reg.all_of<Steer>(naked));
        CHECK(!steer_claimed_by_stronger(reg, naked, SteerRank::Walk, 0));
    }

    // ======================================================================
    // 7. ЗАЯВКА ВЫВОДИТСЯ КАЖДЫЙ ТИК, поэтому умерший градиент отдаёт тело
    //    молча, а вселение отдаёт его ДВАЖДЫ — у заявителя и у писателя.
    //
    //    Тик здесь передаётся ЯВНО и растёт, потому что заявка живёт РОВНО
    //    ОДИН ТИК: без этого «заявка снята» было бы неотличимо от «заявка той
    //    же метки осталась», то есть тест судил бы о механизме, которого нет.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);

        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        const Entity e = make_body(reg, pool, 80, 40, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);
        ZoneNav zn;   // непостроенный: цель-ПЕЛЕНГ нава не спрашивает вовсе

        AiConfig cfg;
        cfg.enabled = true;

        double now = 0.0;
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, nullptr,
                nullptr, nullptr, nullptr, 1);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        CHECK(claim_rank(reg, e, 1) == SteerRank::Flee);

        // Flatten the field. The intent is STICKY (still flee), but the gradient
        // it needs is gone, so ЗАЯВКА НЕ ПОДАЁТСЯ на этом же вызове — и тело
        // достаётся следующему по слабости. Прежде это требовало вернуть токен;
        // теперь возвращать нечего, и это проверяется ТРЕМЯ способами: заявки
        // на новый тик нет, прошлая заявка видна проходу как УСТАРЕВШАЯ, и
        // скорость по ней НЕ ПИШЕТСЯ.
        danger.fill(90.0f);
        now += static_cast<double>(kSimDt);
        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        const AiTick t2 = ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt,
                                  cfg, nullptr, nullptr, nullptr, nullptr, 2);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        CHECK(claim_rank(reg, e, 2) == SteerRank::None);
        CHECK(t2.wanderOwned == 1);
        CHECK(t2.aiOwned == 0);
        CHECK(is_sentinel(reg.get<Velocity>(e)));   // заявитель не пишет никогда
        // МЕТКА ТИКА — НЕСУЩАЯ, А НЕ УКРАШЕНИЕ. Компонента на теле ОСТАЛАСЬ с
        // прошлого тика и всё ещё несёт пеленг бегства; проход обязан прочитать
        // её как «заявки нет» и НЕ ВЕСТИ тело. Мутация «сверять только ранг»
        // (убрать `s.tick == tick` из `steer_claim_live`) роняет обе строки
        // ниже: тело бежало бы от испарившегося поля вечно.
        CHECK(reg.all_of<Steer>(e));
        const GuideTick gStale = guide_step(reg, zn, kLayer, 2, nullptr, nullptr);
        CHECK(gStale.stale == 1u);
        CHECK(gStale.led + gStale.held == 0u);
        CHECK(is_sentinel(reg.get<Velocity>(e)));

        // Restore the gradient, заявка возвращается, then POSSESS the body. A
        // camera holder is driven by controller_step, so ни заявитель не вправе
        // заявить его, ни писатель — написать: иначе ввод человека был бы
        // перетёрт в том же тике (Б6.2, потеря управления у владельца).
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x * 2);
        now += static_cast<double>(kSimDt);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, nullptr,
                nullptr, nullptr, nullptr, 3);
        CHECK(claim_rank(reg, e, 3) == SteerRank::Flee);

        reg.emplace<CameraTag>(e, CameraTag{});
        reg.emplace<Controller>(e, Controller{7.0f, {0, 0, 0}, false});
        now += static_cast<double>(kSimDt);
        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        const AiTick t3 = ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt,
                                  cfg, nullptr, nullptr, nullptr, nullptr, 4);
        CHECK(claim_rank(reg, e, 4) == SteerRank::None);
        CHECK(t3.considered == 0);   // out of scope entirely once possessed
        CHECK(is_sentinel(reg.get<Velocity>(e)));

        // ВТОРОЙ РУБЕЖ, И ОН НОВЫЙ: даже если заявка на теле человека ПОЯВИТСЯ
        // (вселение случается ПОСЕРЕДИНЕ кадра — заявка подана до того, как
        // тело стало игроком), писатель обязан отказаться сам. Ставим заявку
        // руками и спрашиваем писателя.
        //
        // Мутация «снять `decider_of` из `guide_step`» роняет обе строки; снять
        // её ТОЛЬКО у заявителей — не роняет ни одной, и в этом весь смысл
        // второго рубежа.
        CHECK(steer_claim(reg, e, 5, SteerRank::Flee,
                          target_dir(vec3{-1.0f, 0.0f, 0.0f}, kFleeSpeed)));
        const GuideTick gHuman = guide_step(reg, zn, kLayer, 5, nullptr, nullptr);
        CHECK(gHuman.foreign == 1u);
        CHECK(is_sentinel(reg.get<Velocity>(e)));

        // ТРУП — ТА ЖЕ ВЕТКА, и это не щедрость теста: смерть снимает MobRef, и
        // без ветки `Decider::None` патфайндинг ВОЗИЛ рагдоллы по маршрутам
        // (прогон владельца 2026-11-07: «мертвы, но едут»). Телом мёртвого
        // владеет солвер, занятию тут нечего.
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        reg.emplace<Corpse>(e, Corpse{});
        CHECK(steer_claim(reg, e, 6, SteerRank::Flee,
                          target_dir(vec3{-1.0f, 0.0f, 0.0f}, kFleeSpeed)));
        const GuideTick gDead = guide_step(reg, zn, kLayer, 6, nullptr, nullptr);
        CHECK(gDead.foreign == 1u);
        CHECK(is_sentinel(reg.get<Velocity>(e)));
        reg.remove<Corpse>(e);

        // МОГИЛА `ai_release`. Функция гасила токен у всех тел слоя, и нужна
        // была ровно потому, что токен был ПЕРСИСТЕНТНЫМ: тело, оставшееся с
        // `Ai` при выключении ИИ, пропускалось прогулкой НАВСЕГДА и стояло.
        // Класс снят ПО ПОСТРОЕНИЮ, и вот утверждение на это — то же самое,
        // которое держал `ai_release`, только без второго снятия: ИИ забрал
        // тело на тике 7, на тике 8 его выключили, и этого ДОСТАТОЧНО, чтобы
        // тело перестало считаться занятым.
        now += static_cast<double>(kSimDt);
        ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, nullptr,
                nullptr, nullptr, nullptr, 7);
        CHECK(claim_rank(reg, e, 7) == SteerRank::Flee);
        CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Walk, 7));
        AiConfig off;              // отгрузочная конфигурация: ИИ выключен
        CHECK(!off.enabled);
        now += static_cast<double>(kSimDt);
        const AiTick t4 = ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt,
                                  off, nullptr, nullptr, nullptr, nullptr, 8);
        CHECK(t4.considered == 0u);
        CHECK(claim_rank(reg, e, 8) == SteerRank::None);
        // ВОТ ОНО: следующий тик — и слабейший заявитель волен взять тело.
        // Мутация «заявка персистентна» (не сверять тик) роняет эту строку, и
        // роняет её именно как «тело замерло навсегда».
        CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, 8));
    }

    // ======================================================================
    // 8. Determinism. Two identical runs must agree on every decision and every
    //    velocity — the whole AI stores no RNG state, only identity hashes, so
    //    any divergence means something is reading uninitialised memory or a
    //    clock.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 0; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>(x);

        std::vector<std::uint32_t> intents[2];
        std::vector<std::uint32_t> decisions[2];
        std::vector<float> vx[2];

        for (int run = 0; run < 2; ++run) {
            Registry reg;
            NpcPool pool;
            pool.init();
            std::vector<Entity> bodies;
            for (int i = 0; i < 16; ++i) {
                NpcId id = 0;
                bodies.push_back(make_body(reg, pool, 60 + i, 50, 1,
                                           static_cast<Faction>(i % 5), id));
            }
            ai_init(reg, kLayer);

            AiConfig cfg;
            cfg.enabled = true;
            // ВЕДЕНИЕ В ПЕТЛЕ, И БЕЗ НЕГО ЭТОТ БЛОК СТАЛ БЫ ПУСТЫМ. `ai_step`
            // скорости больше не пишет, поэтому сравнение `vx` без `guide_step`
            // сверяло бы ноль с нулём — то есть измеряло бы, что `embody`
            // кладёт нулевую скорость. Нав не нужен: заявка бегства есть ПЕЛЕНГ.
            ZoneNav zn;
            double now = 0.0;
            for (int t = 0; t < 600; ++t) {   // ~4.8 s: several full re-plan cycles
                const std::uint64_t tk = static_cast<std::uint64_t>(t);
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg,
                        nullptr, nullptr, nullptr, nullptr, tk);
                guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
                now += static_cast<double>(kSimDt);
            }
            std::uint32_t steered = 0;
            for (Entity e : bodies) {
                const AiBrain& b = reg.get<AiBrain>(e);
                intents[run].push_back(b.currentIntent);
                decisions[run].push_back(b.decisions);
                const float x = reg.get<Velocity>(e).v.x;
                if (x != 0.0f) ++steered;
                vx[run].push_back(x);
            }
            // ...и сравнение НЕПУСТО: хотя бы одно тело правда ведено. Без этой
            // строки «детерминизм скоростей» был бы зелёным на любой правке,
            // которая ведение вовсе отключила.
            CHECK(steered > 0u);
            // The staggered cadence really did fire several times per body, so
            // the comparison covers re-planning and not just the first commit.
            for (std::uint32_t d : decisions[run]) CHECK(d >= 2u);
        }
        CHECK(intents[0].size() == intents[1].size());
        for (std::size_t i = 0; i < intents[0].size(); ++i) {
            CHECK(intents[0][i] == intents[1][i]);
            CHECK(decisions[0][i] == decisions[1][i]);
            CHECK(vx[0][i] == vx[1][i]);
        }
    }

    // ======================================================================
    // 9. THE RING ITSELF: DEMAND allocation, the footprint, coalescing,
    //    weakest-first eviction, lazy expiry, and the payload-family guard.
    // ======================================================================
    {
        // The packed word is the reason a trace is 8 B and a row 64 B, so pin both
        // payload families round-trip through it — including the extremes, where a
        // one-bit-narrow field would silently alias.
        for (int c = 0; c < kMacroDim; c += 17) {
            const std::uint32_t pay = mem_pack_cell(c, kMacroDim - 1 - c, (c + 5) % kMacroDim);
            CHECK(mem_cell_x(pay) == c);
            CHECK(mem_cell_y(pay) == kMacroDim - 1 - c);
            CHECK(mem_cell_z(pay) == (c + 5) % kMacroDim);
        }
        CHECK(mem_pack_cell(127, 127, 127) == kMemPayloadMask); // 21 bits, all set

        // Strength survives the 7-bit quantisation to within one step. (Not HALF a
        // step: 0.5 lands exactly on a tie, rounds up to 64/127, and sits at
        // precisely half a step away — an assertion at half a step would be a
        // coin-flip on the rounding rule.)
        const MemoryTrace probe = mem_trace(MemDanger, mem_pack_cell(3, 4, 5), 0.5f, 12.0f);
        CHECK(probe.kind() == MemDanger);
        CHECK(probe.payload() == mem_pack_cell(3, 4, 5));
        CHECK(std::fabs(probe.strength() - 0.5f) < 1.0f / 127.0f);
        CHECK(mem_trace(MemDanger, 0u, 0.0f, 0.0f).strength() == 0.0f);
        CHECK(mem_trace(MemDanger, 0u, 1.0f, 0.0f).strength() == 1.0f);
        CHECK(mem_trace(MemDanger, 0u, 9.0f, 0.0f).strength() == 1.0f);  // clamped
        CHECK(mem_trace(MemDanger, 0u, -9.0f, 0.0f).strength() == 0.0f); // clamped
        CHECK(probe.seenAt == 12.0f);
        CHECK(!probe.empty());
        CHECK(MemoryTrace{}.empty());   // a zeroed slot is EMPTY, not a fact about cell 0

        // --- DEMAND: zero until the first write ---------------------------
        AiMemory mem;
        CHECK(mem.rows() == 0u);
        CHECK(mem.resident_bytes() == 0u);
        CHECK(mem.live_traces(7u, 0.0) == 0u);      // legal on an unallocated id
        CHECK(mem.row(999999u).slot[0].empty());    // ...and returns the blank row

        CHECK(ai_remember_cell(mem, 7u, MemDanger, 40, 40, 1, 1.0f, 0.0));
        CHECK(mem.rows() == kMemChunk);             // one chunk, not 2^20
        CHECK(mem.resident_bytes() >= kMemChunk * sizeof(MemoryRow));
        CHECK(mem.live_traces(7u, 0.0) == 1u);
        CHECK(mem.writes() == 1u);
        CHECK(mem.coalesced() == 0u);

        std::fprintf(stdout,
                     "[utilai] memory footprint: trace %zu B, row %zu B (%d slots) "
                     "-> %.1f KiB resident after 1 write (%u rows); projected %.1f "
                     "MiB at the 950k active target, %.1f MiB at the full 2^20\n",
                     sizeof(MemoryTrace), sizeof(MemoryRow), kMemSlots,
                     static_cast<double>(mem.resident_bytes()) / 1024.0, mem.rows(),
                     static_cast<double>(kNpcActiveTarget) *
                         static_cast<double>(sizeof(MemoryRow)) / 1048576.0,
                     static_cast<double>(kNpcPoolSize) *
                         static_cast<double>(sizeof(MemoryRow)) / 1048576.0);

        // --- COALESCING: the property that makes the ring survive a hot cell ---
        // A body re-plans forever while standing in the same place. Without
        // coalescing that fills all eight slots with one fact and then starts
        // evicting real ones.
        for (int t = 1; t < 200; ++t)
            CHECK(ai_remember_cell(mem, 7u, MemDanger, 40, 40, 1, 1.0f,
                                   static_cast<double>(t) * 0.1));
        CHECK(mem.live_traces(7u, 20.0) == 1u);   // still ONE trace, not eight
        CHECK(mem.writes() == 1u);
        CHECK(mem.coalesced() == 199u);
        CHECK(mem.evictions() == 0u);
        std::fprintf(stdout,
                     "[utilai] coalescing: 200 sightings of one cell -> %u live "
                     "trace(s), %u write(s), %u coalesce(s), %u eviction(s)\n",
                     mem.live_traces(7u, 20.0), mem.writes(), mem.coalesced(),
                     mem.evictions());
        // The refreshed trace carries the LAST sighting's time, so it is young — a
        // coalesce that kept the FIRST timestamp would let a fact the body is
        // standing in front of expire while it watches.
        CHECK(std::fabs(mem.row(7u).slot[0].seenAt - 19.9f) < 1e-3f);

        // --- Fill, then EVICT the weakest --------------------------------
        AiMemory ring;
        for (int i = 0; i < kMemSlots; ++i) {
            // Descending strength: slot i holds 1.0 - 0.1*i, so slot 7 is weakest.
            CHECK(ai_remember_cell(ring, 3u, MemFood, 50 + i, 60, 1,
                                   1.0f - 0.1f * static_cast<float>(i), 0.0));
        }
        CHECK(ring.live_traces(3u, 0.0) == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.writes() == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.evictions() == 0u);
        const std::uint32_t keptSlot1 = ring.row(3u).slot[1].packed;
        // The ninth fact must displace the WEAKEST (slot 7), not the oldest.
        CHECK(ai_remember_cell(ring, 3u, MemFood, 99, 99, 1, 1.0f, 0.0));
        CHECK(ring.live_traces(3u, 0.0) == static_cast<std::uint32_t>(kMemSlots));
        CHECK(ring.evictions() == 1u);
        CHECK(ring.row(3u).slot[kMemSlots - 1].payload() == mem_pack_cell(99, 99, 1));
        CHECK(ring.row(3u).slot[1].packed == keptSlot1); // an innocent slot survived

        // --- LAZY EXPIRY: a trace dies by TTL, with no sweep pass ---------
        CHECK(mem_ttl_sec(MemDanger) == 900.0f);
        CHECK(mem_ttl_sec(MemFood) == 720.0f);
        CHECK(mem_ttl_sec(MemNone) == 0.0f);
        AiMemory aging;
        CHECK(ai_remember_cell(aging, 5u, MemDanger, 10, 10, 1, 1.0f, 0.0));
        CHECK(aging.live_traces(5u, 899.0) == 1u);
        CHECK(aging.live_traces(5u, 900.0) == 0u); // exactly at the TTL: gone
        // ...and the dead slot is REUSED rather than a ninth allocated.
        CHECK(ai_remember_cell(aging, 5u, MemFood, 11, 11, 1, 1.0f, 901.0));
        CHECK(aging.live_traces(5u, 901.0) == 1u);
        CHECK(aging.writes() == 2u);
        CHECK(aging.evictions() == 0u);
        CHECK(aging.row(5u).slot[0].kind() == MemFood); // slot 0, the expired one

        // The freshness curve is the reference's: 30 at t=0, 0 at exactly 900 s.
        CHECK(mem_freshness(0.0f) == kMemFreshnessMax);
        CHECK(mem_freshness(29.0f) == kMemFreshnessMax);
        CHECK(mem_freshness(30.0f) == kMemFreshnessMax - 1.0f);
        CHECK(mem_freshness(900.0f) == 0.0f);
        CHECK(mem_freshness(5000.0f) == 0.0f);

        // --- Payload families cannot be crossed --------------------------
        AiMemory guard;
        CHECK(!ai_remember_cell(guard, 1u, MemFoe, 1, 2, 3, 1.0f, 0.0));
        CHECK(!guard.remember(1u, MemNone, 0u, 1.0f, 0.0));
        CHECK(guard.rows() == 0u);   // every refusal allocated nothing
        // Акторный след кладётся ПРИМИТИВОМ: `ai_remember_actor` снесён
        // 2026-09-30 (ноль вызывающих в src/, при том что [ai.h] утверждал
        // обратное). Путь ЧТЕНИЯ акторного следа жив и проверяется здесь же.
        CHECK(guard.remember(1u, MemFoe, 1234u, 1.0f, 0.0));
        CHECK(ai_recall(guard, 1u, 0, 0, 0, 0.0).foe == 1234u);

        // forget() clears a row without shrinking the column.
        AiMemory forgetful;
        CHECK(ai_remember_cell(forgetful, 2u, MemDanger, 1, 1, 1, 1.0f, 0.0));
        forgetful.forget(2u);
        CHECK(forgetful.live_traces(2u, 0.0) == 0u);
        CHECK(forgetful.rows() == kMemChunk);
        forgetful.forget(999999u);   // out of range: legal no-op
    }

    // ======================================================================
    // 10. MEMORY CHANGES THE MIND.
    //
    //     The whole lane exists for this block. Everything else is plumbing.
    // ======================================================================
    float fleeCold = 0.0f;
    float fleeRemembered = 0.0f;
    {
        // ---- 10a: as pure arithmetic, one body, one trace ----------------
        // The Needs row is the same in both arms and every stubbed Perception field
        // stays at its default, so the ONLY difference is one remembered fact.
        const Needs needs = needs_roll(0xBEEFu);
        Perception cold = calm_citizen(11u);
        float scoresCold[kIntentCount];
        score_intents(cold, needs, scoresCold);
        const std::uint8_t pickCold = select_intent_raw(scoresCold);
        fleeCold = scoresCold[IntentFlee];

        AiMemory mem;
        CHECK(ai_remember_cell(mem, 11u, MemDanger, 64, 64, 1, 1.0f, 0.0));
        // Recall AT the remembered cell, one instant later: proximity 1, freshness
        // 1, strength 1 -> rememberedThreat 1.0 -> threat pressure kMemThreatWeight.
        const MemoryRecall r = ai_recall(mem, 11u, 64, 64, 1, 0.0);
        CHECK(r.live == 1u);
        CHECK(std::fabs(r.threat - 1.0f) < 1e-6f);
        CHECK(!r.haveAway);   // the mark is on the body's OWN cell: no bearing

        Perception warm = calm_citizen(11u);
        apply_recall(r, warm.faction, warm);
        CHECK(std::fabs(warm.rememberedThreat - 1.0f) < 1e-6f);
        float scoresWarm[kIntentCount];
        score_intents(warm, needs, scoresWarm);
        const std::uint8_t pickWarm = select_intent_raw(scoresWarm);
        fleeRemembered = scoresWarm[IntentFlee];

        // A calm Citizen with full needs works. The same Citizen, having SEEN
        // something here, runs — with the live danger field reading exactly zero in
        // both arms.
        CHECK(cold.danger == 0.0f);
        CHECK(warm.danger == 0.0f);
        CHECK(pickCold == IntentWork);
        CHECK(pickWarm == IntentFlee);
        CHECK(pickCold != pickWarm);
        // The shift is exactly threat*42 = kMemThreatWeight*42 = 29.4 on flee, and
        // it is the SAME number for every identity because the per-intent jitter is
        // a function of identity only and therefore cancels in the difference.
        CHECK(std::fabs((fleeRemembered - fleeCold) - kMemThreatWeight * 42.0f) < 0.01f);
        // ...and work is suppressed by the same threat pressure it raised flee by.
        CHECK(scoresWarm[IntentWork] < scoresCold[IntentWork]);

        std::fprintf(stdout,
                     "[utilai] MEMORY CHANGES THE DECISION (live danger field == 0 "
                     "in BOTH arms): forgets -> '%s' (flee %.1f); remembers one "
                     "danger mark -> '%s' (flee %.1f), delta +%.1f\n",
                     kIntentName[pickCold], static_cast<double>(fleeCold),
                     kIntentName[pickWarm], static_cast<double>(fleeRemembered),
                     static_cast<double>(fleeRemembered - fleeCold));

        // The same trace one recall-radius away carries no threat at all, which is
        // what keeps memory LOCAL rather than a floor-wide alarm. The trace is still
        // THERE (live == 1) — it just does not reach.
        const MemoryRecall far = ai_recall(mem, 11u, 64 + kMemRecallCells, 64, 1, 0.0);
        CHECK(far.live == 1u);
        CHECK(far.threat == 0.0f);
        CHECK(!far.haveAway);

        // And the distance is TOROIDAL. A mark at x=1 with the body at x=127 is TWO
        // cells away the short way round and 126 the long way; naive arithmetic
        // would put it far outside the recall radius and the memory would be
        // silent across the seam ([AGENTS.md] x/y/z wrap).
        // The long way really is out of range — a static_assert and not a CHECK,
        // because both sides are compile-time constants and MSVC /W4 rejects a
        // constant runtime condition (C4127).
        static_assert(kMacroDim - 2 > kMemRecallCells,
                      "the seam test needs the long way round to be out of recall "
                      "range, or it proves nothing about toroidal distance");
        AiMemory seamMem;
        CHECK(ai_remember_cell(seamMem, 12u, MemDanger, 1, 40, 1, 1.0f, 0.0));
        const MemoryRecall seam = ai_recall(seamMem, 12u, kMacroDim - 1, 40, 1, 0.0);
        CHECK(seam.live == 1u);
        CHECK(seam.threat > 0.0f);
        CHECK(seam.haveAway);
        CHECK(seam.awayX < 0.0f);   // the mark is +2 toroidally, so run in -x
        CHECK(std::fabs(seam.awayY) < 1e-6f);
        // Proximity is measured on the SHORT path: 2 cells of 12 -> 1 - 2/12.
        CHECK(std::fabs(seam.threat - (1.0f - 2.0f / static_cast<float>(kMemRecallCells))) <
              1e-5f);
    }
    {
        // ---- 10b: end to end through the driver, with the LIVE recorder --
        // Phase 1 runs a hot danger field: bodies flee on the FIELD and file a
        // trace. Phase 2 zeroes the field — the diffusion field evaporates, which
        // is what [diffusion.md] says it does. The question is what the crowd does
        // next, and it is the difference between a crowd that learns and one that
        // walks back into the corridor.
        //
        // Hysteresis is OFF here for the reason block 3 turns it off for its own
        // measurement: with it on, the incumbent's +5..12 stickiness would hold
        // flee in BOTH arms and the number would measure stickiness, not memory.
        constexpr int kBodies = 12;
        constexpr int kHot = 10;   // ticks of live danger
        constexpr int kCold = 10;  // ticks after it evaporates

        MacroGrid grid;
        std::uint32_t fleeing[3] = {0, 0, 0};
        std::uint32_t traces[3] = {0, 0, 0};

        for (int arm = 0; arm < 3; ++arm) {
            // arm 0: no store at all       (the pre-memory behaviour, bit for bit)
            // arm 1: a store, cfg.memory OFF (proves the flag, not just the pointer)
            // arm 2: a store, cfg.memory ON
            Field<float> danger(0.0f);
            Registry reg;
            NpcPool pool;
            pool.init();
            AiMemory store;
            std::vector<Entity> bodies;
            std::vector<NpcId> ids;
            for (int i = 0; i < kBodies; ++i) {
                NpcId id = 0;
                bodies.push_back(
                    make_body(reg, pool, 30 + i, 70, 1, Faction::Citizens, id));
                ids.push_back(id);
            }
            CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(kBodies));

            AiConfig cfg;
            cfg.enabled = true;
            cfg.hysteresis = false;
            cfg.memory = (arm == 2);
            cfg.rethinkBaseSec = 0.0f;
            cfg.rethinkSpreadSec = 0.0f;
            AiMemory* memPtr = (arm == 0) ? nullptr : &store;

            double now = 0.0;
            danger.fill(100.0f);   // unitish -> 1.0: maximum severity, worth filing
            for (int t = 0; t < kHot; ++t) {
                const AiTick tick = ai_step(reg, pool, &danger, grid, kLayer, now,
                                            kSimDt, cfg, memPtr);
                CHECK(tick.considered == static_cast<std::uint32_t>(kBodies));
                now += static_cast<double>(kSimDt);
            }
            // A live field of 100 makes every Citizen flee, in every arm — so the
            // two arms enter phase 2 from the SAME mental state and only differ in
            // what they kept.
            for (Entity e : bodies)
                CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);

            // Exactly one trace per body: the first re-plan wrote it and the other
            // nine coalesced into it. This is the coalescing property proven on the
            // real driver rather than on the store in isolation.
            if (arm == 2) {
                CHECK(store.writes() == static_cast<std::uint32_t>(kBodies));
                CHECK(store.coalesced() ==
                      static_cast<std::uint32_t>(kBodies * (kHot - 1)));
                CHECK(store.evictions() == 0u);
            } else {
                CHECK(store.writes() == 0u);       // nullptr, or the flag is off
                CHECK(store.resident_bytes() == 0u);
            }

            // --- the field evaporates ---
            danger.fill(0.0f);
            for (int t = 0; t < kCold; ++t) {
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, memPtr);
                now += static_cast<double>(kSimDt);
            }
            for (int i = 0; i < kBodies; ++i) {
                if (reg.get<AiBrain>(bodies[i]).currentIntent == IntentFlee)
                    ++fleeing[arm];
                traces[arm] += store.live_traces(ids[static_cast<std::size_t>(i)], now);
            }
        }

        std::fprintf(stdout,
                     "[utilai] danger field went to ZERO after %d hot ticks; %d "
                     "bodies still fleeing: no store = %u, store+memory OFF = %u, "
                     "store+memory ON = %u (live traces %u / %u / %u)\n",
                     kHot, kBodies, fleeing[0], fleeing[1], fleeing[2], traces[0],
                     traces[1], traces[2]);

        // With the field gone and nothing remembered, work (27.7) beats flee (19.2)
        // for every Citizen with full needs by more than the +/-2.5 jitter can
        // close, so this is 0 rather than "small".
        CHECK(fleeing[0] == 0u);
        CHECK(fleeing[1] == fleeing[0]);   // the flag really is the switch
        // With the trace, threat pressure is kMemThreatWeight -> flee 48.6 against
        // a next-best 33.3, a 12.8-point margin the jitter cannot close either.
        CHECK(fleeing[2] == static_cast<std::uint32_t>(kBodies));
        CHECK(traces[0] == 0u);
        CHECK(traces[1] == 0u);
        CHECK(traces[2] == static_cast<std::uint32_t>(kBodies));
    }

    // ======================================================================
    // 11. THE GRUDGE IS SIGNED BY FACTION.
    //
    //     One remembered attacker, two factions, the same Perception. The bonus is
    //     spent through the affordance slot and DIVIDED by `risk`, so a Liquidator
    //     (risk 0.74) turns and fights while a Citizen (risk 0.32) runs. Measured
    //     over 512 identities because the deciding margin is inside the +/-2.5
    //     identity jitter band for a single body — a per-id assertion would be
    //     luck, a distribution is a measurement.
    // ======================================================================
    {
        const Needs needs = needs_roll(0x5EEDu);
        AiMemory mem;

        // The near-tie arena, chosen so combat and flee are the top two and the
        // third-best intent is >15 points behind: armed, one visible hostile at
        // 16 m. Pre-grudge the Citizen margin is combat +2.3; the grudge shifts it
        // by 10*(0.32-0.68) = -3.6, i.e. across zero.
        auto arena = [&](std::uint32_t id, Faction f) {
            Perception p = calm_citizen(id, f);
            p.armed = true;
            p.visibleHostiles = 1.0f;
            p.threatDistance = 16.0f;
            return p;
        };

        constexpr std::uint32_t kIds = 512;
        std::uint32_t combatCold[2] = {0, 0};
        std::uint32_t fleeCold2[2] = {0, 0};
        std::uint32_t combatWarm[2] = {0, 0};
        std::uint32_t fleeWarm[2] = {0, 0};
        const Faction sides[2] = {Faction::Citizens, Faction::Liquidators};

        for (int s = 0; s < 2; ++s) {
            for (std::uint32_t id = 1; id <= kIds; ++id) {
                Perception cold = arena(id, sides[s]);
                float a[kIntentCount];
                score_intents(cold, needs, a);
                const std::uint8_t pc = select_intent_raw(a);
                if (pc == IntentCombat) ++combatCold[s];
                if (pc == IntentFlee) ++fleeCold2[s];

                // The same body, having been hurt by somebody it can still name.
                mem.forget(id);
                CHECK(mem.remember(id, MemFoe, (id + 100000u) & kNpcIdMask, 1.0f, 0.0));
                const MemoryRecall r = ai_recall(mem, id, 0, 0, 0, 0.0);
                CHECK(r.foe == id + 100000u);
                CHECK(std::fabs(r.grudge - 1.0f) < 1e-6f);
                CHECK(r.threat == 0.0f);   // a grudge is not a place

                Perception warm = arena(id, sides[s]);
                apply_recall(r, warm.faction, warm);
                // The signed split, asserted directly on the coefficients so the
                // distribution below has a mechanism behind it and not a guess.
                const FactionTraits& tr = faction_traits(warm.faction);
                CHECK(std::fabs(warm.localScore[IntentCombat] -
                                kMemAffordanceCap * tr.risk) < 1e-4f);
                CHECK(std::fabs(warm.localScore[IntentFlee] -
                                kMemAffordanceCap * (1.0f - tr.risk)) < 1e-4f);
                float b[kIntentCount];
                score_intents(warm, needs, b);
                const std::uint8_t pw = select_intent_raw(b);
                if (pw == IntentCombat) ++combatWarm[s];
                if (pw == IntentFlee) ++fleeWarm[s];
            }
        }

        std::fprintf(stdout,
                     "[utilai] one remembered attacker, %u identities each: "
                     "Citizens combat %u->%u flee %u->%u | Liquidators combat "
                     "%u->%u flee %u->%u\n",
                     kIds, combatCold[0], combatWarm[0], fleeCold2[0], fleeWarm[0],
                     combatCold[1], combatWarm[1], fleeCold2[1], fleeWarm[1]);

        // CITIZENS: the grudge pushes them OFF combat and ONTO flight, and it moves
        // a real share of the population rather than two bodies at the edge of the
        // jitter band. The arena's pre-grudge Citizen margin is combat +2.3 and the
        // grudge shifts it to -1.3, so with jitter differences triangular on
        // (-5, +5) the analytic flip rate is ~58% of the population; the bound below
        // is an eighth of it, i.e. deliberately loose.
        CHECK(fleeWarm[0] > fleeCold2[0] + kIds / 8u);
        CHECK(combatWarm[0] < combatCold[0]);

        // LIQUIDATORS: the same insult pushes them ONTO combat, and here the claim
        // can be absolute rather than statistical. Their pre-grudge contest is
        // combat 49.7 against patrol 47.1 — a 2.6 margin the jitter flips for some
        // identities — while the grudge widens it to 9.96, past anything +/-2.5 per
        // intent can close. So EVERY Liquidator fights, and not all of them did.
        CHECK(combatWarm[1] == kIds);
        CHECK(combatCold[1] < kIds);
        // ...and the effect is opposite in SIGN, not merely different in size: flee
        // peaks at 23.4 for a Liquidator in this arena, so it never wins either way.
        CHECK(fleeCold2[1] == 0u);
        CHECK(fleeWarm[1] == 0u);
    }

    // ======================================================================
    // 12. MEMORY CHANGES THE MOTION — and the single-writer rule survives it.
    //
    //     A FLAT danger field has no gradient, so flee has no live direction and
    //     today's code hands the body straight back to wander. With a remembered
    //     danger cell it now runs away from that cell instead. Three groups in one
    //     arena exercise all three arbitration paths in the SAME tick:
    //
    //       A  calm half, no memory      -> заявки нет (work wins, not flee)
    //       B  ramp half, live gradient  -> заявка `Flee` по ПОЛЮ
    //       C  calm half, one memory     -> заявка `Flee` по ПАМЯТИ
    // ======================================================================
    {
        constexpr int kGroup = 8;
        constexpr int kTicks = 200;

        MacroGrid grid;
        Field<float> danger(0.0f);
        for (int x = 64; x < kMacroDim; ++x)
            for (int y = 0; y < kMacroDim; ++y)
                for (int z = 0; z < kMacroDim; ++z)
                    danger.at(x, y, z) = static_cast<float>((x - 63) * 4);

        ZoneNav zn;
        zone_fixture::arm_zones_plus_x(zn);

        Registry reg;
        NpcPool pool;
        pool.init();
        AiMemory mem;

        std::vector<Entity> groupA, groupB, groupC, all;
        for (int i = 0; i < kGroup; ++i) {
            NpcId a = 0, b = 0, c = 0;
            groupA.push_back(make_body(reg, pool, 20 + i, 30, 1, Faction::Citizens, a));
            groupB.push_back(make_body(reg, pool, 70 + i, 30, 1, Faction::Citizens, b));
            groupC.push_back(make_body(reg, pool, 20 + i, 44, 1, Faction::Citizens, c));
            // Group C remembers something 8 cells to the +x — inside the 12-cell
            // recall radius, so it both scares them and gives them a bearing.
            CHECK(ai_remember_cell(mem, c, MemDanger, 28 + i, 44, 1, 1.0f, 0.0));
        }
        for (Entity e : groupA) all.push_back(e);
        for (Entity e : groupB) all.push_back(e);
        for (Entity e : groupC) all.push_back(e);

        // The arena really is what the three groups need it to be.
        const vec3 gA = diffusion_gradient(danger, grid, 20, 30, 1);
        const vec3 gB = diffusion_gradient(danger, grid, 70, 30, 1);
        const vec3 gC = diffusion_gradient(danger, grid, 20, 44, 1);
        CHECK(gA.x * gA.x + gA.y * gA.y <= kMinFleeGrad2);   // no live direction
        CHECK(gB.x * gB.x + gB.y * gB.y > kMinFleeGrad2);    // a live direction
        CHECK(gC.x * gC.x + gC.y * gC.y <= kMinFleeGrad2);   // no live direction

        CHECK(wander_init(reg, kLayer) ==
              static_cast<std::uint32_t>(3 * kGroup));
        CHECK(ai_init(reg, kLayer) == static_cast<std::uint32_t>(3 * kGroup));

        AiConfig cfg;
        cfg.enabled = true;   // hysteresis ON: this is the shipping config

        // ---- one tick, the whole arbitration table ------------------------
        arm_sentinels(reg, all);
        const AiTick t1 = ai_step(reg, pool, &danger, grid, kLayer, 0.0, kSimDt,
                                  cfg, &mem, nullptr, nullptr, nullptr, 1);
        CHECK(t1.considered == static_cast<std::uint32_t>(3 * kGroup));
        CHECK(t1.aiOwned + t1.wanderOwned == t1.considered);
        CHECK(t1.wanderOwned == static_cast<std::uint32_t>(kGroup));     // A
        CHECK(t1.aiOwned == static_cast<std::uint32_t>(2 * kGroup));     // B + C
        CHECK(t1.memoryFled == static_cast<std::uint32_t>(kGroup));      // C only
        // ЗАЯВКА ВМЕСТО ТОКЕНА, и группа A проверяется СИЛЬНЕЕ, чем прежде:
        // «токена нет» означало байт `Wander`, а «заявки нет» означает, что
        // компоненты на теле не появилось вовсе — забыть выставить нечего.
        for (Entity e : groupA) CHECK(!reg.all_of<Steer>(e));
        for (Entity e : groupB) CHECK(claim_rank(reg, e, 1) == SteerRank::Flee);
        for (Entity e : groupC) CHECK(claim_rank(reg, e, 1) == SteerRank::Flee);
        // ...И ПАМЯТЬ ЗАЯВЛЯЕТ ПЕЛЕНГ, А НЕ ЗОНУ: у бегства нет конечной точки
        // (CANON S13.3, цель-ПОЛЕ), поэтому вид цели здесь `Dir` — иначе проход
        // пошёл бы спрашивать нав о зоне, которой заявитель не выбирал.
        for (Entity e : groupC)
            CHECK(reg.get<Steer>(e).target.kind == TargetKind::Dir);
        // Пока ведение не позвано, не написано НИ ОДНО тело.
        std::uint32_t beforeGuide = 0;
        for (Entity e : all)
            if (!is_sentinel(reg.get<Velocity>(e))) ++beforeGuide;
        CHECK(beforeGuide == 0u);
        // Group C runs in -x, away from the cell it remembers, at flee pace —
        // и пишет это ЕДИНСТВЕННЫЙ писатель.
        const GuideTick g1 = guide_step(reg, zn, kLayer, 1, nullptr, nullptr);
        CHECK(g1.led == static_cast<std::uint32_t>(2 * kGroup));   // B + C
        CHECK(g1.held == 0u);
        CHECK(g1.byRank[rank_slot(SteerRank::Flee)] ==
              static_cast<std::uint32_t>(2 * kGroup));
        CHECK(g1.foreign == 0u);
        CHECK(g1.unresolved == 0u);
        for (Entity e : groupC) {
            const Velocity& v = reg.get<Velocity>(e);
            CHECK(v.v.x < 0.0f);
            CHECK(std::fabs(v.v.y) < 1e-4f);
            CHECK(v.v.z == 0.0f);   // z is gravity's, never the writer's
            CHECK(std::fabs(std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y) - kFleeSpeed) <
                  1e-3f);
        }
        for (Entity e : groupA) CHECK(is_sentinel(reg.get<Velocity>(e)));
        std::fprintf(stdout,
                     "[utilai] one tick, 3 groups x %d: заявок нет у %u, бегство "
                     "заявило %u (из них %u по ЗАПОМНЕННОЙ клетке при плоском "
                     "живом поле), ведение написало %u, group C |v| = %.2f m/s "
                     "in -x\n",
                     kGroup, t1.wanderOwned, t1.aiOwned, t1.memoryFled, g1.led,
                     static_cast<double>(kFleeSpeed));

        // ---- the same group C with NO memory delegates instead ------------
        // The measured difference in MOTION, isolated: nothing changed but the
        // store pointer.
        {
            Registry reg2;
            NpcPool pool2;
            pool2.init();
            std::vector<Entity> cOnly;
            for (int i = 0; i < kGroup; ++i) {
                NpcId c = 0;
                cOnly.push_back(
                    make_body(reg2, pool2, 20 + i, 44, 1, Faction::Citizens, c));
            }
            CHECK(ai_init(reg2, kLayer) == static_cast<std::uint32_t>(kGroup));
            arm_sentinels(reg2, cOnly);
            const AiTick t0 =
                ai_step(reg2, pool2, &danger, grid, kLayer, 0.0, kSimDt, cfg,
                        nullptr, nullptr, nullptr, nullptr, 1);
            CHECK(t0.aiOwned == 0u);
            CHECK(t0.wanderOwned == static_cast<std::uint32_t>(kGroup));
            CHECK(t0.memoryFled == 0u);
            CHECK(t0.recalled == 0u);
            // БЕЗ ПАМЯТИ ЗАЯВКИ НЕТ ВОВСЕ, и ведению нечего исполнять: ни одной
            // записи, ни одного владеемого нуля. Прежде это было «токен у
            // вандера»; разница в том, что теперь тело волен взять ЛЮБОЙ более
            // слабый заявитель, а не только тот, чьё имя стояло в байте.
            for (Entity e : cOnly) CHECK(!reg2.all_of<Steer>(e));
            const GuideTick g0 = guide_step(reg2, zn, kLayer, 1, nullptr, nullptr);
            CHECK(g0.led + g0.held == 0u);
            for (Entity e : cOnly) CHECK(is_sentinel(reg2.get<Velocity>(e)));
        }

        // ---- ОДИН ПИСАТЕЛЬ, ПЕРЕДОКАЗАНО С ПАМЯТЬЮ ------------------------
        // Block 4 proved it before memory existed. Память — ВТОРОЙ источник
        // пеленга бегства, значит проба обязана прогнаться ещё раз, иначе
        // доказательство относится к прошлой редакции кода.
        std::uint32_t selfWriters = 0, wroteNoClaim = 0, claimedNotLed = 0;
        std::uint32_t ledMismatch = 0, movedTotal = 0, ledTotal = 0, heldTotal = 0;
        std::uint32_t byRank[kSteerRankCount] = {};
        double now = 0.0;
        for (int t = 0; t < kTicks; ++t) {
            const std::uint64_t tk = static_cast<std::uint64_t>(t);
            arm_sentinels(reg, all);
            const AiTick tick =
                ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg, &mem,
                        nullptr, nullptr, nullptr, tk);
            CHECK(tick.aiOwned + tick.wanderOwned == tick.considered);
            ai_patrol_step(reg, zn, kLayer, nullptr, tk);
            wander_step(reg, grid, pool, zn, kLayer, tk);
            for (Entity e : all)
                if (!is_sentinel(reg.get<Velocity>(e))) ++selfWriters;
            const GuideTick g = guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
            std::uint32_t moved = 0;
            for (Entity e : all) {
                const bool w = !is_sentinel(reg.get<Velocity>(e));
                const bool c = claimed(reg, e, tk);
                if (w) ++moved;
                if (w && !c) ++wroteNoClaim;
                if (!w && c) ++claimedNotLed;
            }
            if (moved != g.led + g.held) ++ledMismatch;
            movedTotal += moved;
            ledTotal += g.led;
            heldTotal += g.held;
            for (std::size_t r = 0; r < kSteerRankCount; ++r)
                byRank[r] += g.byRank[r];
            now += static_cast<double>(kSimDt);
        }
        std::fprintf(stdout,
                     "[utilai] память ВКЛ, %d тиков x %d тел: заявители написали "
                     "скорость %u раз (обязан ноль), ведение написало %u тел "
                     "(бегство %u, прогулка %u)\n",
                     kTicks, 3 * kGroup, selfWriters, movedTotal,
                     byRank[rank_slot(SteerRank::Flee)],
                     byRank[rank_slot(SteerRank::Walk)]);
        CHECK(selfWriters == 0);
        CHECK(wroteNoClaim == 0);
        CHECK(claimedNotLed == 0);
        CHECK(ledMismatch == 0);
        CHECK(movedTotal == ledTotal + heldTotal);
        CHECK(byRank[rank_slot(SteerRank::Flee)] > 0);
        CHECK(byRank[rank_slot(SteerRank::Walk)] > 0);

        // МОГИЛА `ai_release` (вторая; первая — в блоке 7). Здесь утверждалось,
        // что при живой памяти снятие токена возвращает ровно 2*kGroup тел, то
        // есть «выключить ИИ не оставит тело замороженным». Предмет снят ПО
        // ПОСТРОЕНИЮ — заявка живёт один тик, — и утверждение переписано на то,
        // что раньше проверить было НЕЧЕМ: тело, бежавшее на прошлом тике,
        // подхватывает ПРОГУЛКА, и делает это СЛЕДУЮЩИМ ЖЕ ТИКОМ.
        //
        // Это строго сильнее снесённой пары: прежняя считала ТОКЕНЫ, новая
        // ведёт ТЕЛА. Мутация «заявка персистентна» роняет её как «толпа
        // замерла», мутация «прогулка игнорирует ранг» — как двойную запись.
        const std::uint64_t kOffTick = static_cast<std::uint64_t>(kTicks) + 1;
        std::uint32_t fleeingBefore = 0;
        for (Entity e : all)
            if (claim_rank(reg, e, static_cast<std::uint64_t>(kTicks) - 1) ==
                SteerRank::Flee)
                ++fleeingBefore;
        CHECK(fleeingBefore == static_cast<std::uint32_t>(2 * kGroup));
        AiConfig off;
        CHECK(!off.enabled);
        std::uint32_t pickedUp = 0, ledAfter = 0;
        for (std::uint64_t t = 0; t < kWanderPeriod; ++t) {
            const std::uint64_t tk = kOffTick + t;
            arm_sentinels(reg, all);
            const AiTick dead = ai_step(reg, pool, &danger, grid, kLayer, now,
                                        kSimDt, off, &mem, nullptr, nullptr,
                                        nullptr, tk);
            CHECK(dead.considered == 0u);
            wander_step(reg, grid, pool, zn, kLayer, tk);
            guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
            for (Entity e : all) {
                if (claim_rank(reg, e, tk) == SteerRank::Walk) ++pickedUp;
                if (!is_sentinel(reg.get<Velocity>(e))) ++ledAfter;
            }
            now += static_cast<double>(kSimDt);
        }
        CHECK(pickedUp == static_cast<std::uint32_t>(3 * kGroup));
        CHECK(ledAfter == static_cast<std::uint32_t>(3 * kGroup));
    }

    // ======================================================================
    // 13. THE TTL AND THE FRESHNESS CURVE ARE REAL.
    //
    //     A memory that never fades is a permanent state change wearing a
    //     timestamp. Measure the age at which the remembered danger stops winning
    //     the argument, and print it.
    // ======================================================================
    {
        const Needs needs = needs_roll(0xFADEu);
        AiMemory mem;
        CHECK(ai_remember_cell(mem, 21u, MemDanger, 33, 33, 1, 1.0f, 0.0));

        auto picks_flee = [&](double at) {
            const MemoryRecall r = ai_recall(mem, 21u, 33, 33, 1, at);
            Perception p = calm_citizen(21u);
            apply_recall(r, p.faction, p);
            float s[kIntentCount];
            score_intents(p, needs, s);
            return select_intent_raw(s) == IntentFlee;
        };

        CHECK(picks_flee(0.0));      // just seen: flee by >12 points
        CHECK(!picks_flee(900.0));   // at the TTL: the trace is invisible

        // Scan for the crossover. Analytically it is 780 s for a jitter-free body
        // (84*threat > 8.5, threat = 0.7*freshness/30), and the +/-2.5 per-intent
        // jitter can move it one freshness step in either direction — hence the
        // asserted band rather than an exact equality.
        int revertAt = -1;
        for (int age = 0; age <= 900; age += 30) {
            if (!picks_flee(static_cast<double>(age))) {
                revertAt = age;
                break;
            }
        }
        CHECK(revertAt >= 600);
        CHECK(revertAt < 900);
        // Monotone: once forgotten, it stays forgotten. A curve that flickered
        // would put the crowd back into the thrash hysteresis exists to stop.
        for (int age = revertAt; age <= 1200; age += 30)
            CHECK(!picks_flee(static_cast<double>(age)));

        std::fprintf(stdout,
                     "[utilai] freshness: a remembered danger mark stops changing "
                     "the decision at age %d s and expires entirely at %.0f s "
                     "(live traces %u -> %u)\n",
                     revertAt, static_cast<double>(mem_ttl_sec(MemDanger)),
                     mem.live_traces(21u, 0.0), mem.live_traces(21u, 900.0));
    }

    // ======================================================================
    // 14. DETERMINISM, memory included. The store holds no RNG, only identity
    //     hashes and recorded facts, so two identical runs must produce
    //     byte-identical rows — folded into one FNV-1a digest the way
    //     suite_macrosim digests the pool columns.
    // ======================================================================
    {
        MacroGrid grid;
        std::uint32_t digest[2] = {0, 0};
        std::vector<std::uint32_t> intents[2];
        std::vector<float> vx[2];
        std::vector<std::uint32_t> traces[2];

        for (int run = 0; run < 2; ++run) {
            Field<float> danger(0.0f);
            for (int x = 0; x < kMacroDim; ++x)
                for (int y = 0; y < kMacroDim; ++y)
                    for (int z = 0; z < kMacroDim; ++z)
                        danger.at(x, y, z) = static_cast<float>(x);

            Registry reg;
            NpcPool pool;
            pool.init();
            AiMemory mem;
            std::vector<Entity> bodies;
            std::vector<NpcId> ids;
            for (int i = 0; i < 16; ++i) {
                NpcId id = 0;
                bodies.push_back(make_body(reg, pool, 60 + i, 50, 1,
                                           static_cast<Faction>(i % 5), id));
                ids.push_back(id);
            }
            ai_init(reg, kLayer);

            AiConfig cfg;
            cfg.enabled = true;
            // ВЕДЕНИЕ В ПЕТЛЕ — по тому же доводу, что в блоке 8: `vx` без
            // единственного писателя сверял бы ноль с нулём. Нав не нужен,
            // заявка бегства есть ПЕЛЕНГ.
            ZoneNav zn;
            double now = 0.0;
            std::uint32_t recalls = 0, replans = 0;
            for (int t = 0; t < 600; ++t) {   // ~4.8 s: several full re-plan cycles
                // Damage one body on a fixed schedule so RECORDER 1 (the HP-drop
                // path) is exercised too, not just the danger sampler.
                if (t == 100 || t == 300) {
                    std::int16_t& hp = pool.hp(ids[3]);
                    hp = static_cast<std::int16_t>(hp - 25);
                }
                const std::uint64_t tk = static_cast<std::uint64_t>(t);
                const AiTick tick =
                    ai_step(reg, pool, &danger, grid, kLayer, now, kSimDt, cfg,
                            &mem, nullptr, nullptr, nullptr, tk);
                guide_step(reg, zn, kLayer, tk, nullptr, nullptr);
                recalls += tick.recalled;
                replans += tick.replanned;
                now += static_cast<double>(kSimDt);
            }
            std::uint32_t h = 2166136261u;
            std::uint32_t steered = 0;
            for (std::size_t i = 0; i < bodies.size(); ++i) {
                const AiBrain& b = reg.get<AiBrain>(bodies[i]);
                intents[run].push_back(b.currentIntent);
                const float x = reg.get<Velocity>(bodies[i]).v.x;
                if (x != 0.0f) ++steered;
                vx[run].push_back(x);
                traces[run].push_back(mem.live_traces(ids[i], now));
                h = digest_memory(mem, ids[i], h);
                fold_u32(h, b.currentIntent);
                fold_u32(h, b.decisions);
            }
            digest[run] = h;
            CHECK(steered > 0u);   // сверка скоростей НЕПУСТА

            if (run == 0) {
                // The HP-drop recorder really fired, so the digest covers it.
                CHECK(reg.get<AiBrain>(bodies[3]).lastHp == 50);
                CHECK(mem.live_traces(ids[3], now) >= 1u);
                // Cost, as a measured figure rather than a claim: recalls happen on
                // a re-plan or while fleeing, never unconditionally per tick.
                std::fprintf(stdout,
                             "[utilai] cost over 600 ticks x 16 bodies: %u re-plans, "
                             "%u recalls (%.2f recalls per body per tick vs %d ticks "
                             "of unconditional scanning that were avoided)\n",
                             replans, recalls,
                             static_cast<double>(recalls) / (600.0 * 16.0), 600);
                CHECK(recalls >= replans);      // every re-plan recalls...
                CHECK(recalls <= 600u * 16u);   // ...and nothing recalls twice a tick
            }
        }
        CHECK(digest[0] == digest[1]);
        for (std::size_t i = 0; i < intents[0].size(); ++i) {
            CHECK(intents[0][i] == intents[1][i]);
            CHECK(vx[0][i] == vx[1][i]);
            CHECK(traces[0][i] == traces[1][i]);
        }
        std::fprintf(stdout,
                     "[utilai] determinism: FNV-1a over every memory row + intent + "
                     "decision count, two independent runs = 0x%08x / 0x%08x\n",
                     digest[0], digest[1]);
    }

    // ======================================================================
    // 15. MEMORY OUTLIVES THE BODY.
    //
    //     Keyed by NpcId, not by Entity — which is the whole reason it is a pool-
    //     indexed column and not a component. An elevator ride destroys the body
    //     and builds a new one ([embody.h] fold_back -> embody), so a component
    //     would wipe what the person knows on every floor change. The AiBrain
    //     SHOULD reset (it is scheduling state); the memory must not.
    // ======================================================================
    {
        MacroGrid grid;
        Field<float> danger(0.0f);   // flat zero: only memory can cause a flee
        Registry reg;
        NpcPool pool;
        pool.init();
        AiMemory mem;
        NpcId id = 0;
        Entity e = make_body(reg, pool, 55, 55, 1, Faction::Citizens, id);
        CHECK(ai_remember_cell(mem, id, MemDanger, 55, 55, 1, 1.0f, 0.0));
        CHECK(ai_init(reg, kLayer) == 1u);

        AiConfig cfg;
        cfg.enabled = true;
        ai_step(reg, pool, &danger, grid, kLayer, 0.0, kSimDt, cfg, &mem);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        const std::uint32_t before = digest_memory(mem, id);
        const std::uint16_t decisionsBefore = reg.get<AiBrain>(e).decisions;
        CHECK(decisionsBefore > 0u);

        // Ride the elevator: the record folds back and re-embodies as a NEW entity.
        fold_back(reg, pool, NpcRef{id, pool.generation(id)}, e);
        CHECK(!reg.valid(e));
        e = embody(reg, pool, id, kLayer);
        reg.get<Transform>(e).pos = vec3{55.5f * kCellSize, 55.5f * kCellSize,
                                        1.5f * kCellSize};
        CHECK(ai_init(reg, kLayer) == 1u);          // a brand-new brain...
        CHECK(reg.get<AiBrain>(e).decisions == 0u); // ...with no history
        CHECK(reg.get<AiBrain>(e).currentIntent == kIntentNone);
        CHECK(digest_memory(mem, id) == before);    // ...but the memory is intact

        // And it still decides the same way on the other side of the ride.
        const AiTick after = ai_step(reg, pool, &danger, grid, kLayer,
                                     static_cast<double>(kSimDt), kSimDt, cfg, &mem);
        CHECK(after.recalled == 1u);
        CHECK(reg.get<AiBrain>(e).currentIntent == IntentFlee);
        std::fprintf(stdout,
                     "[utilai] body destroyed and rebuilt (the elevator path): brain "
                     "decisions %u -> 0, memory digest 0x%08x -> 0x%08x, intent "
                     "still '%s'\n",
                     decisionsBefore, before, digest_memory(mem, id),
                     kIntentName[reg.get<AiBrain>(e).currentIntent]);
    }

    // ======================================================================
    // ЗДЕСЬ СТОЯЛ БЛОК РОЛЕЙ, и он снесён 2026-11-08 вместе с `role.h`
    // (решение владельца): пять архетипов с шестью десятками чисел в заголовке
    // при законе проекта «вся политика в данных», мандата в CANON.md нет.
    // Блок стоил 4165 исполнений — две property-петли (детерминизм хеша 64 и
    // «нулевой вес есть ЗАПРЕТ» 4096) плюс распределение, дельта-отклик и
    // ролевая слепота: ровно то число, которым CMakeLists его и завёл
    // 2026-08-13. Различие тел осталось на ФРАКЦИЯХ (`suite_faction*`) и на
    // НУЖДАХ, у обеих свои свидетели.
    // ======================================================================

    // ======================================================================
    // Patrol execution (ai_patrol_step) — ЗОНЫ, не решётка (§88/F.2).
    // Синтетический нав по зонам: массивы публичные, бейк этажа не нужен.
    // ======================================================================
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        NpcId id = 0;
        Entity e = make_body(reg, pool, 32, 32, 1, Faction::Citizens, id);
        CHECK(ai_init(reg, kLayer) == 1u);
        AiBrain& brain = reg.get<AiBrain>(e);
        brain.currentIntent = IntentPatrol;

        // ДВЕ ЗОНЫ, граница по x == 48, и ОДНА плоскость поля, говорящая «+x»
        // в каждой клетке. Этого достаточно: шаг агента есть два чтения, и
        // синтетика обязана подделать ровно их — таблицу (зона 1 → зона 2) и
        // плоскость соседки (+x).
        ZoneNav zn;
        zn.part.zones = 2;
        zn.part.at.assign(kMacroCells, static_cast<RoomId>(1));
        for (int cz = 0; cz < kMacroDim; ++cz)
            for (int cy = 0; cy < kMacroDim; ++cy)
                for (int cx = 48; cx < kMacroDim; ++cx)
                    zn.part.at[macro_index(cx, cy, cz)] = static_cast<RoomId>(2);
        zn.graph.zones = 2;
        zn.graph.offset = {0u, 1u, 2u};
        zn.graph.nbr = {static_cast<RoomId>(2), static_cast<RoomId>(1)};
        zn.dist.zones = 2;
        zn.dist.d = {0, 1, 1, 0};
        zn.flow.planes = 1;
        zn.flow.dir.assign(kMacroCells, 1); // слот 0 = соседка, направление +x
        // `cells` несёт поперечник зоны, из него считается бюджет ноги в
        // прыжках ([game/zone_nav.h]). Ноль дал бы бюджет в один прыжок МОЛЧА.
        zn.part.cells = static_cast<std::uint32_t>(kMacroCells);
        CHECK(zn.built());
        CHECK(zone_hops_for_metres(zn.part, kPatrolLegMetres) >= 1u);

        // 1. НЕПОСТРОЕННЫЙ БЕЙК — NO-OP, НЕ UB (правило wander_step). Ни плана,
        //    ни ЗАЯВКИ, пока бейк в полёте.
        ZoneNav unbaked;
        PatrolTick t0 = ai_patrol_step(reg, unbaked, kLayer, nullptr, 1);
        CHECK(!reg.all_of<PatrolPlan>(e));
        CHECK(!reg.all_of<Steer>(e));   // компоненты не появилось ВООБЩЕ
        CHECK(t0.considered == 0u);

        // 2. ШАГ: лениво навешивает план, берёт ДОСТИЖИМУЮ зону и ЗАЯВЛЯЕТ её
        //    рангом наряда. Скорость НЕ ПИШЕТ: её напишет единственный
        //    писатель, и порядок двух этих фактов — утверждение, а не
        //    оформление (сентинель взведён ДО шага и обязан выжить).
        Velocity& vel = reg.get<Velocity>(e);
        vel.v = vec3{kSentX, kSentY, 0.0f};
        PatrolTick t1 = ai_patrol_step(reg, zn, kLayer, nullptr, 1);
        CHECK(reg.all_of<PatrolPlan>(e));
        CHECK(reg.get<PatrolPlan>(e).zoneTo == static_cast<RoomId>(2));
        CHECK(claim_rank(reg, e, 1) == SteerRank::Patrol);
        CHECK(t1.considered == 1u);
        CHECK(t1.walking == 1u);
        // ПЕРВАЯ нога прибытием НЕ СЧИТАЕТСЯ — иначе прибор давал бы тем
        // больше прибытий, чем хуже ходок (обратная полярность: засчитать её,
        // и эта строка краснеет).
        CHECK(t1.arrived == 0u);
        // ЦЕЛЬ — ЗОНА, И ТЕМП ЛЕЖИТ В ЗАЯВКЕ, а не в проходе ведения. Это
        // новое утверждение, и оно несущее: проход, выбирающий темп сам, завёл
        // бы ветку по заявителю, то есть вернул бы каждому занятию своё
        // движение ([game/guide.h], довод у `Target`). Мутация «наряд заявляет
        // kFleeSpeed» роняет третью строку, «заявляет пеленг вместо зоны» —
        // первую.
        CHECK(reg.get<Steer>(e).target.kind == TargetKind::Zone);
        CHECK(reg.get<Steer>(e).target.zone == static_cast<RoomId>(2));
        CHECK(reg.get<Steer>(e).target.speed == kErrandSpeed);
        CHECK(is_sentinel(vel));   // заявитель скорость не тронул
        // ...И ТЕПЕРЬ ВЕДЁТ ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ: +x к центру следующей
        // клетки, темпом ИЗ ЗАЯВКИ. Прежде эту тройку писал сам наряд, и
        // проверить «тот ли темп» было нечем — скорость и направление приходили
        // одной записью.
        const GuideTick g1 = guide_step(reg, zn, kLayer, 1, nullptr, nullptr);
        CHECK(g1.led == 1u);
        CHECK(g1.byRank[rank_slot(SteerRank::Patrol)] == 1u);
        CHECK(vel.v.x > 0.0f);  // вдоль поля...
        CHECK(vel.v.y == 0.0f); // ...и только вдоль него
        CHECK(vel.v.z == 0.0f); // ось гравитации принадлежит физике (NegZ)
        CHECK(std::fabs(vel.v.x - kErrandSpeed) < 1e-5f);

        // 3. ПРИБЫЛ = СТОИТ В ЦЕЛЕВОЙ ЗОНЕ, а не на целевой КЛЕТКЕ. Переносим
        //    тело в зону 2 — нога обязана закрыться прибытием и завестись
        //    новая. Это и есть то, чего решётка дать не могла: там нога
        //    кончалась в одной клетке из 2 097 152.
        //
        //    РУЧНОГО СБРОСА ЗДЕСЬ БОЛЬШЕ НЕТ, и это следствие, а не стиль:
        //    прежде строкой выше стояло `brain.motion = Wander`, потому что
        //    токен был ПЕРСИСТЕНТНЫМ и тест обязан был снять его сам. Заявка
        //    живёт один тик — достаточно позвать проход на СЛЕДУЮЩЕМ.
        reg.get<Transform>(e).pos.x = (50.0f + 0.5f) * kCellSize;
        PatrolTick t2 = ai_patrol_step(reg, zn, kLayer, nullptr, 2);
        CHECK(t2.arrived == 1u);
        CHECK(reg.get<PatrolPlan>(e).zoneTo == static_cast<RoomId>(1));
        CHECK(reg.get<PatrolPlan>(e).hops == 2u);

        // 4. ФРЕЙМ: под PosX шаг «+x» есть шаг ВДОЛЬ гравитации, а ходьба его
        //    тратить не умеет. Наряд обязан ОТКАЗАТЬСЯ и отдать тело прогулке —
        //    НЕ подменять шаг слепой прямой на цель. Ровно эта подмена была
        //    остатком якоря у решётки и стоила §88 нуля прибытий, поэтому
        //    утверждение здесь положительное: сторож x цел И ЗАЯВКИ НЕТ.
        //    Мутация «вернуть прямую на цель» роняет вторую строку.
        GravityField sideways;
        sideways.regime = GravityRegime::PosX;
        sideways.global = vec3{9.81f, 0.0f, 0.0f};
        reg.get<Transform>(e).pos = vec3{(32.0f + 0.5f) * kCellSize,
                                        (32.0f + 0.5f) * kCellSize,
                                        (1.0f + 0.5f) * kCellSize};
        vel.v = vec3{0.25f, 0.0f, 0.0f};
        PatrolTick t3 = ai_patrol_step(reg, zn, kLayer, &sideways, 3);
        CHECK(vel.v.x == 0.25f); // сторож оси гравитации не тронут
        CHECK(claim_rank(reg, e, 3) == SteerRank::None);
        CHECK(t3.idle == 1u);
        CHECK(t3.walking == 0u);
        // И ПИСАТЕЛЮ НЕЧЕГО ИСПОЛНЯТЬ. Заявка ПРОШЛОГО тика на теле ещё лежит
        // (нога на зону 1), и это ровно тот случай, в котором токен ДРЕЙФОВАЛ:
        // тело под токеном без записи скорости не ведётся никем. Проход обязан
        // прочитать её как устаревшую, тело оставить телу физики, а сторож оси
        // гравитации не тронуть вовсе.
        const GuideTick g3 = guide_step(reg, zn, kLayer, 3, &sideways, nullptr);
        CHECK(g3.stale == 1u);
        CHECK(g3.led + g3.held == 0u);
        CHECK(vel.v.x == 0.25f);

        // 5. АРБИТРАЖ: ЗАЯВЛЕННОЕ СИЛЬНЕЕ ТЕЛО НАРЯД НЕ ТРОГАЕТ, и полярность
        //    прогнана В ОБЕ СТОРОНЫ — без второй половины гейт читался бы как
        //    «занято всегда».
        //
        //    Утверждение переехало с «скорость не тронута» на «тело не вошло в
        //    знаменатель», и это не придирка: скорость наряд не пишет вовсе,
        //    поэтому прежняя форма стала бы ВТОРЫМ ОТВЕТОМ — зелёным при снятом
        //    гейте. Вопрос стоит ДО всей работы прохода ([game/ai.cpp]:
        //    `steer_claimed_by_stronger` перед `++out.considered`), потому что у
        //    заявителей есть побочные эффекты, и проигравший по рангу ПОСЛЕ них
        //    стрелял бы на бегу.
        CHECK(steer_claim(reg, e, 4, SteerRank::Flee,
                          target_dir(vec3{-1.0f, 0.0f, 0.0f}, kFleeSpeed)));
        vel.v = vec3{0.0f, 7.0f, 0.0f};
        PatrolTick t4 = ai_patrol_step(reg, zn, kLayer, nullptr, 4);
        CHECK(t4.considered == 0u); // отказ по рангу в знаменатель не входит
        CHECK(vel.v.y == 7.0f);
        // Заявка цела ЦЕЛИКОМ — и ранг, и цель: слабая поверх сильной не
        // ложится, а наряд её даже не пытался подать.
        CHECK(claim_rank(reg, e, 4) == SteerRank::Flee);
        CHECK(reg.get<Steer>(e).target.kind == TargetKind::Dir);

        // 5b. ОБРАТНАЯ ПОЛЯРНОСТЬ: заявка СЛАБЕЕ наряда его не останавливает —
        //     он обязан перебить её своей. Мутация «считать любую живую заявку
        //     чужой» (`>=` вместо `>` в `steer_claimed_by_stronger`) роняет обе
        //     строки: наряд перестал бы водить тела, которые ведёт прогулка, то
        //     есть наряд не работал бы ВООБЩЕ.
        //
        //     `cooldown = 0` руками — по тому же доводу, что в шаге 6: шаг 4
        //     законно взвёл стаггер дверью, а здесь проверяется АРБИТРАЖ.
        reg.get<PatrolPlan>(e).cooldown = 0;
        CHECK(steer_claim(reg, e, 5, SteerRank::Walk,
                          target_zone(static_cast<RoomId>(1), kWalkSpeedMps)));
        PatrolTick t4b = ai_patrol_step(reg, zn, kLayer, nullptr, 5);
        CHECK(t4b.considered == 1u);
        CHECK(claim_rank(reg, e, 5) == SteerRank::Patrol);

        // 6. НЕДОСТИЖИМАЯ ЗОНА: таблица говорит «другая компонента», и наряд
        //    обязан не выбрать цель вовсе, а не идти наугад.
        //
        //    `cooldown = 0` ставится РУКАМИ, и это не поблажка тесту: шаг 4
        //    только что отказал дверью и законно взвёл стаггер, а здесь
        //    проверяется ПРЕДИКАТ ДОСТИЖИМОСТИ. Без обнуления тест мерил бы
        //    стаггер под именем достижимости — ровно тот класс лжи прибора,
        //    когда верное число отвечает на НЕ ТОТ вопрос. Сам стаггер
        //    проверяется отдельно, шагом ниже.
        ZoneNav split = zn;
        split.dist.d = {0, kZoneUnreachable, kZoneUnreachable, 0};
        reg.get<PatrolPlan>(e).zoneTo = kNoRoom;
        reg.get<PatrolPlan>(e).cooldown = 0;
        PatrolTick t5 = ai_patrol_step(reg, split, kLayer, nullptr, 6);
        CHECK(t5.unreachable == 1u);
        CHECK(t5.walking == 0u);
        CHECK(reg.get<PatrolPlan>(e).zoneTo == kNoRoom);
        // ...И ЗАЯВКИ НЕТ: цель не выбрана, значит заявлять нечего. Это та же
        // строка, что стояла здесь про незабранный токен, но теперь она ещё и
        // ЗАКРЫВАЕТ НАЗВАННЫЙ ДЕФЕКТ: токен забирался ДО проверки шага, поэтому
        // тело под ним не вели ни наряд (ушёл по `continue`), ни прогулка
        // (пропускала по токену) — оно ДРЕЙФОВАЛО на прошлой скорости.
        CHECK(claim_rank(reg, e, 6) == SteerRank::None);

        // 6b. СТАГГЕР — и это утверждение КУПЛЕНО ЗАМЕРОМ, а не вкусом.
        //     Редакция без него снимала цель каждый тик: прогон 30000 кадров
        //     дал `unreach` 3334 против нуля у решётки, потерял 40% тиков и
        //     просадил ход по делам с 3.83 до 0.90 прибытий на 100 замеров.
        //     Поэтому следующий тик после отказа обязан НЕ переспрашивать:
        //     `unreachable` остаётся нулём, тело идёт в `idle`, а счётчик
        //     стаггера убывает. Обратная полярность — снять `cooldown` из
        //     `PatrolPlan` — роняет первые две строки.
        CHECK(reg.get<PatrolPlan>(e).cooldown == kPatrolRepickCooldown);
        PatrolTick t6 = ai_patrol_step(reg, split, kLayer, nullptr, 7);
        CHECK(t6.unreachable == 0u);
        CHECK(t6.idle == 1u);
        CHECK(reg.get<PatrolPlan>(e).cooldown < kPatrolRepickCooldown);

        // 6в. ПРЕДЕЛ ДАЛЬНОСТИ СТАЛ СТРУКТУРНЫМ, И ЭТОТ БЛОК — СВИДЕТЕЛЬСТВО
        //     ТОГО, ЧТО ИМЕННО ИЗМЕНИЛОСЬ (§88/F.2, 2026-10-12).
        //
        //     Прежняя редакция утверждала предел так: взять таблицу, поставить
        //     единственной чужой зоне расстояние «предел + 1» и потребовать,
        //     чтобы наряд цели НЕ ВЫБРАЛ. Это работало, пока выбор был ОТБОРОМ
        //     ИЗ РАВНОМЕРНОЙ ВЫБОРКИ с фильтром по таблице — и ровно поэтому
        //     работало плохо: замер (этаж 0, 13818 зон) показал, что тот же
        //     фильтр отвергал НЕ ТОЛЬКО дальние, а 952 кандидата из 952, то
        //     есть выбор не происходил вовсе. Тест был зелёным на дефекте,
        //     потому что проверял «отверг дальнюю», а не «выбрал близкую».
        //
        //     Выбор переехал на ОБХОД ГРАФА (`zone_pick_near`), и утверждение
        //     прежней формы стало НЕВЫРАЗИМЫМ — это и есть доказательство, что
        //     лечение структурное: соврать в таблице больше нельзя, потому что
        //     обход верит РЁБРАМ. Блуждание на один шаг дойдёт до соседки, что
        //     бы про неё ни говорила `dist`, и это правильно: рёбра и есть
        //     проходимость, а таблица — её производная.
        //
        //     Предел теперь держится ПО ПОСТРОЕНИЮ (шаг двигает не больше чем
        //     на ребро), и проверяется там, где это осмысленно — на НАСТОЯЩЕМ
        //     графе, таблицей, независимо от обхода: `near_pick_walks_the_graph`
        //     ([tests/suite_zonenav.inl], `overLimit == 0`, плюс печать «обход
        //     399/399 против отбора 1/399»). Мутация «обход игнорирует предел»
        //     роняет там РОВНО ОДНУ строку — проверено в обе полярности.
        //
        //     Здесь остаётся единственный путь, которым наряд ещё может не
        //     найти цели, и он теперь имеет ОДНУ причину вместо двух слипшихся:
        //     ЗОНА ИЗОЛИРОВАНА. Граф без рёбер — ровно это, и `unreachable`
        //     наряда означает теперь только его.
        ZoneNav lone = zn;
        lone.graph.offset = {0u, 0u, 0u}; // обе зоны без соседок
        lone.graph.nbr.clear();
        CHECK(lone.built());
        reg.get<PatrolPlan>(e).zoneTo = kNoRoom;
        reg.get<PatrolPlan>(e).cooldown = 0;
        PatrolTick t7 = ai_patrol_step(reg, lone, kLayer, nullptr, 8);
        CHECK(t7.unreachable == 1u);
        CHECK(reg.get<PatrolPlan>(e).zoneTo == kNoRoom);
        CHECK(claim_rank(reg, e, 8) == SteerRank::None); // заявки нет — ведёт прогулка

        // 7. РАЗВИЛКА МОЗГОВ (S13.7a) — Б6.2, потеря управления у владельца.
        //    Смерть игрока вселяет его НЕ в новое тело, а в живого жителя
        //    ([app/main.cpp] possess_a_survivor), и AiBrain прежнего владельца
        //    записи достаётся игроку целиком. Если житель был патрульным,
        //    currentIntent == IntentPatrol приезжает вместе с телом, а этот
        //    шаг стоит в кадре ПОСЛЕ controller_step — и перетирал ввод
        //    человека в том же тике. Проход обязан спрашивать ТЕЛО (decider_of).
        //
        //    Мутация «снять гейт decider_of» роняет все три строки ниже. Третья
        //    добавлена сегодня и она сильнее первых двух: скорость наряд не
        //    пишет вовсе, поэтому «ввод человека не тронут» прошло бы и при
        //    снятом гейте — покраснело бы только на следующем `guide_step`,
        //    то есть в другом месте. Знаменатель и заявка — здесь.
        reg.emplace<CameraTag>(e, CameraTag{});
        brain.currentIntent = IntentPatrol;
        vel.v = vec3{0.0f, 7.0f, 0.0f};
        const PatrolTick t8 = ai_patrol_step(reg, zn, kLayer, nullptr, 9);
        CHECK(vel.v.y == 7.0f);      // ввод человека не тронут
        CHECK(t8.considered == 0u);  // тело человека в знаменатель не входит
        CHECK(claim_rank(reg, e, 9) == SteerRank::None); // и заявки на него нет
        reg.remove<CameraTag>(e);
    }
}
