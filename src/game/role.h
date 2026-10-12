// Role system — five behavioural archetypes layered ABOVE faction traits.
//
// DESIGN: A role is NOT a new intent. The 13-intent table is complete. A role is
// a MULTIPLIER ROW on the scoring weights: the same score computation runs for
// every body, but a Duty body has patrolDrive ×1.5 and a Looter has scavengeDrive
// ×1.0, so they win different intents from identical environments.
//
// WHY A POOL COLUMN, NOT A PURE FUNCTION. role_for() is a deterministic hash from
// (npcId, floorKind) — the same trick as seat_offset and identity_seed. But the
// spec explicitly names one story event where a Resident turns Looter after
// samosbor, so the column exists as an OVERRIDE, initialised from role_for() and
// writable. Cost: 1 B/row in the LIVE column set.
//
// BACKWARD COMPATIBILITY. Resident's trait row is all-ones on the multiplier
// axes, so a floor of all Residents scores exactly what the pre-role build
// scored: the system is a no-op until a floor mixes in the other four rows.
//
// Ported from marko1olo e720f906+08ac5c00 (his wiring was honest: seeded in
// population.cpp, read in ai.cpp scoring). NOT ported: PatrolPlan (its only
// consumer, ai_patrol_step, never had a definition) and the panic/rally
// emission constants (the fields they write were never created).
#pragma once

#include <cstdint>

#include "core/rng.h"        // hash3, rand_below
#include "game/floor_spec.h" // FloorKind
#include "game/npc_pool.h"   // NpcId
#include "game/room.h"       // RoomId/kNoRoom — цель наряда есть ЗОНА (§88/F.2)

namespace giga::game {

// RoleId — the five archetypes. The INDEX is load-bearing: it indexes
// kRoleTraits and kRoleWeights.
enum class RoleId : std::uint8_t {
    Resident = 0, // ~70% residential; the baseline all others diverge from
    Duty,         // 2-5%; wants HQ and patrol; the future consumer of route_step
    Medic,        // 1-3%; the only role that acts on ANOTHER body's hpBank
    Looter,       // 3-8%; grows with |floor|; sleeps anywhere
    Cultist,      // 0% residential; up to 40% on Derelict
    kRoleCount,
};

inline constexpr std::size_t kRoleCount =
    static_cast<std::size_t>(RoleId::kRoleCount);

struct RoleTraits {
    float workDrive;      // multiplier on IntentWork score
    float patrolDrive;    // multiplier on IntentPatrol score
    float sociability;    // multiplier on IntentSocial score; Cultist > 1.0
    float scavengeDrive;  // additive term: scavenging from local room recall
    float careDrive;      // additive term on IntentHeal from nearby wounded
    // homeRooms/workRooms УМЕРЛИ (rooms-object F, S12.2): маски вида заменят
    // ЯКОРЯ (ModuleId, RoomId) на агенте, раздаваемые заселением по
    // declared-вектору комнат (решение владельца 2026-08-28) — agent-goals.
};

// TABLE 1 — 5×5 role traits matrix.
inline constexpr RoleTraits kRoleTraits[kRoleCount] = {
    //           workDrv patrol social scaveng care
    /* Resident */ { 1.00f, 1.00f, 1.00f, 0.10f, 0.05f },
    /* Duty     */ { 1.00f, 1.50f, 0.60f, 0.05f, 0.20f },
    /* Medic    */ { 1.00f, 0.20f, 0.80f, 0.10f, 1.00f },
    /* Looter   */ { 0.20f, 0.10f, 0.40f, 1.00f, 0.00f },
    /* Cultist  */ { 0.60f, 0.40f, 1.20f, 0.30f, 0.10f },
};

inline constexpr std::size_t kFloorKindCount =
    static_cast<std::size_t>(FloorKind::Count);

// TABLE 2 — role weights by floor archetype. Row sums are NOT 100 on purpose:
// role_for divides by the actual total, so a row is relative weights, exactly
// the convention FloorSpec already uses for its mixes.
inline constexpr std::uint8_t kRoleWeights[kFloorKindCount][kRoleCount] = {
    //              Resident Duty Medic Looter Cultist
    /* Residential */ {  70,    5,    3,     3,     0 },
    /* Commercial  */ {  50,   10,    3,     8,     2 },
    /* Industrial  */ {  30,   15,    5,     8,     5 },
    /* Derelict    */ {  10,    2,    1,    20,    40 },
    /* Padic       */ {  20,    5,    2,    15,    20 },
    /* Blame       */ {  10,    5,    2,    25,    15 },
    /* Khrushi     */ {  65,    6,    3,     4,     1 },
};

inline constexpr std::uint32_t kRoleSalt = 0x726F6C65u; // "role"

// Deterministic role assignment. Call at floor seeding, not per-tick — the pool
// column is the runtime source of truth precisely so this can be overridden.
inline RoleId role_for(NpcId id, FloorKind kind) {
    const std::size_t ki = static_cast<std::size_t>(kind);
    const std::size_t safeKi = ki < kFloorKindCount ? ki : 0u;
    const auto* weights = kRoleWeights[safeKi];

    std::uint32_t total = 0;
    for (std::size_t i = 0; i < kRoleCount; ++i) total += weights[i];
    if (total == 0) return RoleId::Resident;

    const std::uint32_t h = hash3(static_cast<std::uint32_t>(id),
                                  static_cast<std::uint32_t>(safeKi),
                                  kRoleSalt);
    std::uint32_t pos = rand_below(h, total);
    for (std::size_t i = 0; i < kRoleCount; ++i) {
        if (pos < weights[i])
            return static_cast<RoleId>(i);
        pos -= weights[i];
    }
    return RoleId::Resident;
}

// Bounds-safe accessor — matches faction_traits() design in ai.h.
inline const RoleTraits& role_traits(RoleId r) {
    const std::size_t i = static_cast<std::size_t>(r);
    return kRoleTraits[i < kRoleCount ? i : 0u];
}

// PatrolPlan — sparse ECS component, IntentPatrol bodies only (a few % of the
// embodied window). Lazily attached by ai_patrol_step, the same rule as
// PlayerMelee: no spawn path has to remember it. sizeof == 4: POD, no
// allocation, cache-friendly.
//
// ЦЕЛЬ — ЗОНА, А НЕ УЗЕЛ РЕШЁТКИ (§88/F.2). Прежде здесь лежали два байта
// решётки 4×4×4, `nodeFrom` и `nodeTo`. `nodeFrom` ТОЛЬКО ПИСАЛСЯ — читали его
// одни тесты, — и ушёл вместе с предметом; его байт и оплатил расширение цели
// до `RoomId`, поэтому пин 4 держится БЕЗ подкрутки, а не вопреки ей. Это
// важнее арифметики: будь пин подкручен, он перестал бы быть утверждением.
struct PatrolPlan {
    RoomId zoneTo = kNoRoom; // зона, в которую идёт эта нога; kNoRoom = ноги нет
    std::uint8_t hops = 0;   // legs completed; feeds the next-zone hash
    // ТИКОВ ЖДАТЬ ПЕРЕД НОВЫМ ВЫБОРОМ, и этот байт — ЗАМЕР, а не запас.
    // Первая редакция перевода на зоны его не имела, и замер 30000 кадров её
    // опроверг: цель снималась КАЖДЫЙ тик (`unreach` 0 -> 3334), скан
    // достижимости бежал по всем зонам этажа заново, тиков в прогоне стало на
    // 40% меньше, и просел ДАЖЕ ход по делам — 3.83 -> 0.90 прибытий на 100
    // замеров, потому что наряд забирал тела токеном и не доводил.
    // `place_errand_step` ровно от этого и держит `nextPickAt`; у плана наряда
    // места под double нет, и не нужно — лишний байт уже был паддингом.
    std::uint8_t cooldown = 0;
};
static_assert(sizeof(PatrolPlan) == 4,
              "PatrolPlan must stay 4 bytes — sparse hot component");

// Patrol next-node salt. Distinct from kRoleSalt so a body's patrol route and
// its role assignment cannot correlate by construction.
inline constexpr std::uint32_t kPatrolSalt = 0x70617472u; // "patr"

// ПОПЫТОК НА ВЫБОР ЦЕЛИ ЗДЕСЬ БОЛЬШЕ НЕТ (`kPatrolTries` снесён 2026-10-12), и
// это следствие замера, а не упрощение. Восемь попыток были верным лечением
// ВЕРНОГО дефекта: полный скан зон этажа стоил 40% тиков прогона. Но замер
// тогда не спросил, сколько раз выбор УДАЁТСЯ, — а спросив (на прогулке,
// которая несла копию того же кода), получил НОЛЬ успехов на 119 попыток и 952
// кандидата. Отбор из равномерной выборки среди 5700-14742 зон с фильтром «не
// дальше предела» есть отбраковка с вероятностью успеха порядка 0.003, то есть
// предел работал не ограничителем, а ОТКАЗОМ. Выбор переехал на обход графа
// (`zone_pick_near`), который не промахивается по построению, и ограничивать
// попытки стало нечего.

// ДАЛЬНОСТЬ НОГИ НАРЯДА — В МЕТРАХ, и это решение владельца 2026-10-12: «зоны
// могут быть какие угодно на каких угодно этажах, это специфика исключительно
// генератора модуля, он вправе ставить какие угодно зоны». Значит число ЗОН
// дальности не выражает вовсе — замер: зона этажа 0 поперёк 8.9 м, зона этажа 6
// — 4.8 м, и прежние «шесть зон» означали 53 м там и 29 м здесь. В прыжки
// бюджет переводит бейк, знающий свою разбивку ([game/zone_nav.h]
// `zone_hops_for_metres`).
//
// ВЫВОД: смена патруля — порядок 45 с хода, при `kErrandSpeed` (= шаг жителя,
// 1.35 м/с) это 60.75 м. Выражение, а не литерал: скорость обязана переехать
// сама. Нога закрывается внутри прогона (~315 с сима), то есть становится
// ПРОВЕРЯЕМОЙ — ровно того и не было, когда прибытий было ровно ноль дважды.
//
// ЭТО ВРЕМЯНКА, А НЕ ЗАМЫСЕЛ, и решение владельца 2026-10-12 записано здесь
// именно потому, что число без этой оговорки читалось бы как дизайн. Верный
// замысел — ПОСТ И ОБХОД ВОКРУГ НЕГО: «у каждого есть место работы», наряд
// обходит зоны вокруг своего рабочего места и возвращается. Случайная близкая
// зона даёт прибытия и ничего не обещает про поведение: со стороны это
// броуновское движение в пределах квартала, маршрута у наряда нет.
//
// ОТЛОЖЕНО ДО agent-goals СОЗНАТЕЛЬНО: пост — это якорь агента (ModuleId,
// RoomId), а якорей на сущности сегодня нет вовсе (`RoleTraits` выше несёт
// надгробие homeRooms/workRooms, умерших в rooms-object F). Приделать здесь
// свой носитель места работы значило бы завести ВТОРОЙ ответ на вопрос, на
// который agent-goals отвечает первым, — то есть ровно тот дефект, которым
// болели двери и комнаты. Когда якоря приедут, бюджет перестанет быть
// константой: он станет радиусом обхода вокруг поста.
inline constexpr float kPatrolLegMetres = 45.0f * 1.35f; // 60.75 м

// Тиков ждать, если зона изолирована или дверь
// отказала. 64 тика при 125 Гц — полсекунды: достаточно редко, чтобы цена
// отказа перестала быть видна в кадре, и достаточно часто, чтобы тело, у
// которого мир переменился карвом, не стояло заметно для глаза.
inline constexpr std::uint8_t kPatrolRepickCooldown = 64;

// Medic constants. The heal credit lands in the PATIENT's Needs::hpBank — the
// same bank (Needs::hpBank), so a medic in a ward
// stacks with the ward instead of inventing a second heal path. 3 HP/s is ~2× the
// ward's own rate on a 100-max body: a person beats a room.
inline constexpr float kMedicReachM        = 2.0f; // metres, one macro cell
inline constexpr float kMedicThreshold     = 0.6f; // heal below this hp fraction
inline constexpr float kMedicHealPerSec    = 3.0f; // HP bank credit /s per patient
inline constexpr float kMedicFatiguePerSec = 0.5f; // medic's sleep cost /s per patient

} // namespace giga::game
