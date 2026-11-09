#include "game/perceive.h"

#include <cmath>

#include "core/rng.h"
#include "core/wrap.h"
#include "game/combat.h"            // Dead — труп не воспринимает и не воспринимается
#include "game/embody.h"            // NpcRef
#include "game/faction_relations.h" // вражда: ОДИН вопрос «враждебны ли двое»
#include "game/guide.h"             // steer_claim, SteerRank, цели
#include "game/investigate.h"       // kInvestigateMinSeverity — порог слуха
#include "game/look.h"              // Look, looking_at — конус любого тела
#include "game/mob_behaviour.h"     // behaviour_aggro_radius, kGazeCosHalfAngle
#include "game/mob_spawn.h"         // MobRef
#include "game/mob_table.h"         // mob_def — строка монстра
#include "game/noise.h"             // loudest_heard — поле шума
#include "game/npc_pool.h"
#include "game/wander.h"            // kAggroRadius — дефолт зрения монстра
#include "game/witness.h"           // kWitnessSightM, kEyeLiftM — глаз и дальность
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga::game {

// ЕДИНСТВЕННЫЙ ЧИТАТЕЛЬ ЗАСЛОНЕНИЯ В ВОСПРИЯТИИ. Довод за дверь — в заголовке.
bool sight_blocked(const MacroGrid& grid, const vec3& eye, const vec3& at) {
    SubRayHit hit;
    return sub_march(grid, eye, at, hit);
}

const SenseRow kSenseRows[kSenseClassCount] = {
    {SenseClass::Monster, "монстр", kAggroRadius, kGazeCosHalfAngle,
     kInvestigateHearing},
    {SenseClass::Resident, "житель", kWitnessSightM, kGazeCosHalfAngle,
     kInvestigateHearing},
    {SenseClass::Human, "человек", kWitnessSightM, kGazeCosHalfAngle,
     kInvestigateHearing},
};

float sense_sight_m(SenseClass cls, const MobRef* mr) {
    const SenseRow& row = kSenseRows[static_cast<std::size_t>(cls)];
    if (cls != SenseClass::Monster || mr == nullptr) return row.sightM;
    if (static_cast<std::size_t>(mr->kind) >= kMobKindCount) return row.sightM;
    // Переопределение строкой монстра — та же форма «дефолт + поведение»,
    // которой `behaviour_aggro_radius` работает с 2026-09: авторская дальность
    // 2.15…30 м остаётся ровно той, что была, и перенос ничего не сдвигает.
    return behaviour_aggro_radius(
        static_cast<MobBehaviour>(mob_def(static_cast<MobKind>(mr->kind)).behaviour),
        row.sightM);
}

float sense_hearing_mult(SenseClass cls, const MobRef* mr) {
    const SenseRow& row = kSenseRows[static_cast<std::size_t>(cls)];
    if (cls != SenseClass::Monster || mr == nullptr) return row.hearingMult;
    if (static_cast<std::size_t>(mr->kind) >= kMobKindCount) return row.hearingMult;
    const MobBehaviour beh = static_cast<MobBehaviour>(
        mob_def(static_cast<MobKind>(mr->kind)).behaviour);
    // Довод Безэхого — перенос референса дословно: «deadEcho && !revealed ->
    // return false», а «revealed» в этом дереве не существует, поэтому отказ И
    // ЕСТЬ его до-раскрытое поведение. Ноль множителя выражает это данными.
    return beh == MobBehaviour::DeadEcho ? 0.0f : row.hearingMult;
}

namespace {

// «Враждебны ли двое» — ОДИН вопрос, две сегодняшние двери под ним. Монстр
// судит фракцию жертвы таблицей `kMobVsFaction` (`mob_hostile_to`), житель —
// изменяемой матрицей фракций (`bodies_hostile`). Это НЕ ветка «если игрок»:
// развилка идёт по тождеству СУБЪЕКТА, что и требует S13.7a.
bool hostile_pair(const NpcPool& pool, const FactionRelations& rel,
                  bool selfIsMob, NpcId selfId, bool otherIsMob, NpcId otherId) {
    if (selfIsMob) {
        // Монстр и монстр не враждуют — у монстра нет строки алайфа вовсе,
        // поэтому вопрос к нему невыразим (и это перепись, не выбор).
        if (otherIsMob) return false;
        return mob_hostile_to(pool, otherId);
    }
    if (otherIsMob) return true;  // монстр враждебен любому телу с тождеством
    return bodies_hostile(rel, pool, selfId, otherId);
}

} // namespace

PerceiveTick perceive_step(Registry& reg, const MacroGrid& grid,
                           const NoiseField& noise, NpcPool& pool,
                           const FactionRelations& rel, LayerId layer,
                           std::uint64_t tick, const GravityField* gravity) {
    PerceiveTick out{};
    const GravityFrame gf = steer_frame_of(gravity);
    const std::uint64_t phase = tick % kPerceivePeriod;
    const std::uint32_t stamp = static_cast<std::uint32_t>(tick);

    // ПРОГРЕВ ПУЛОВ — снятие УБ, а не удобство: `Senses` и `Steer` рождаются
    // ВНУТРИ живого вида, и закон дерева требует, чтобы хранилище существовало
    // до его открытия (тот же довод, что у `steer_pool_warm` в [game/guide.h]).
    (void)reg.storage<Senses>();
    steer_pool_warm(reg);
    auto bodies = reg.view<const Transform>();
    for (auto e : bodies) {
        const Transform& tr = bodies.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (reg.all_of<Dead>(e)) continue;
        const MobRef* mr = reg.try_get<MobRef>(e);
        const NpcRef* nr = reg.try_get<NpcRef>(e);
        const bool human = reg.all_of<CameraTag>(e);
        if (mr == nullptr && nr == nullptr) continue;  // проп, обломок, снаряд
        if (hash_u32(static_cast<std::uint32_t>(entt::to_integral(e))) %
                kPerceivePeriod !=
            phase)
            continue;
        ++out.bodies;

        const SenseClass cls = human      ? SenseClass::Human
                               : mr != nullptr ? SenseClass::Monster
                                               : SenseClass::Resident;
        const SenseRow& row = kSenseRows[static_cast<std::size_t>(cls)];
        const float sightM = sense_sight_m(cls, mr);
        const float sight2 = sightM * sightM;
        const Look* look = reg.try_get<Look>(e);
        // СЛЕПОТА — СТРОКА, А НЕ ВЕТКА: `fovCos > 1` значит «конус пуст».
        // Телу без взгляда зрение тоже невыразимо, и это тот же случай.
        const bool blind = row.fovCos > 1.0f || look == nullptr;
        if (blind) ++out.blind;

        Senses& sen = reg.get_or_emplace<Senses>(e);
        sen.foe = entt::null;
        sen.foeDist = -1.0f;
        sen.visible = 0;
        sen.heardSev = 0;
        sen.tick = stamp;

        const vec3 eye{tr.pos.x, tr.pos.y, tr.pos.z + kEyeLiftM};
        float bestDist2 = sight2;
        vec3 bestBearing{0.0f, 0.0f, 0.0f};

        if (!blind) {
            for (auto t : bodies) {
                if (t == e) continue;
                const Transform& tt = bodies.get<const Transform>(t);
                if (tt.layer != layer) continue;
                if (reg.all_of<Dead>(t)) continue;
                const MobRef* tmr = reg.try_get<MobRef>(t);
                const NpcRef* tnr = reg.try_get<NpcRef>(t);
                if (tmr == nullptr && tnr == nullptr) continue;
                // ОТСЕЧКА 1 — дистанция, тороидальная.
                const float d2 = wrap_dist2(tr.pos, tt.pos, kWorldExtent);
                if (d2 > sight2) continue;
                if (!hostile_pair(pool, rel, mr != nullptr,
                                  nr != nullptr ? nr->id : kInvalidNpc,
                                  tmr != nullptr,
                                  tnr != nullptr ? tnr->id : kInvalidNpc))
                    continue;
                ++out.pairsNear;
                // ПЕЛЕНГ «ОТ СЕБЯ К ЦЕЛИ», и порядок аргументов тут несущий:
                // `wrap_delta_f(a,b)` есть `b − a`. Первая редакция этого
                // файла держала его НАОБОРОТ — конус смотрел назад, а погоня
                // вела ОТ врага; поймано гейтом нового сьюта до прогона.
                // Конвенция — та же, что у погони (`wander.cpp`) и у
                // `steer_to_zone`.
                const float bx = wrap_delta_f(tr.pos.x, tt.pos.x, kWorldExtent);
                const float by = wrap_delta_f(tr.pos.y, tt.pos.y, kWorldExtent);
                const float bz = wrap_delta_f(tr.pos.z, tt.pos.z, kWorldExtent);
                // ОТСЕЧКА 2 — КОНУС. Агностичен к тому, что в клетке: это
                // чистая геометрия над направлением взгляда любого тела.
                if (!looking_at(look->dir, bx, by, bz, row.fovCos)) continue;
                ++out.pairsCone;
                // ОТСЕЧКА 3 — ЗАСЛОНЕНИЕ, одной дверью и ПОСЛЕДНЕЙ.
                ++out.rays;
                // БЛИЖАЙШИЙ ОБРАЗ, А НЕ СЫРАЯ КООРДИНАТА. `sub_march` берёт
                // конец «как дан» (его контракт — снарядный интегратор ходит в
                // непрерывных координатах), поэтому пара на шве тора
                // маршировалась бы через ПОЛМИРА и была заслонена всегда.
                // Пеленг выше уже свёрнут — здесь тот же ответ, в точке.
                const vec3 at{eye.x + bx, eye.y + by, eye.z + bz};
                if (sight_blocked(grid, eye, at)) {
                    ++out.occluded;
                    continue;
                }
                if (sen.visible < 255) ++sen.visible;
                if (d2 <= bestDist2) {
                    bestDist2 = d2;
                    bestBearing = vec3{bx, by, bz};
                    sen.foe = t;
                    sen.foeDist = std::sqrt(d2);
                }
            }
        }

        // ЗАЯВКА ЦЕЛИ. Восприятие СКОРОСТИ НЕ ПИШЕТ — у него нет `Velocity` в
        // виде, поэтому второй писатель здесь НЕВЫРАЗИМ, а не запрещён
        // (сильнейшая форма гейта, CANON S25.4).
        const bool immobile =
            mr != nullptr &&
            static_cast<std::size_t>(mr->kind) < kMobKindCount &&
            (mob_def(static_cast<MobKind>(mr->kind)).aiFlags &
             static_cast<std::uint8_t>(AiFlag::Immobile)) != 0;
        if (sen.foe != entt::null) {
            ++out.sawFoe;
            if (!immobile && !human) {
                const float sp =
                    mr != nullptr
                        ? static_cast<float>(
                              mob_def(static_cast<MobKind>(mr->kind)).speedMmps) *
                              0.001f * kCellSize
                        : kWalkSpeedMps;
                if (steer_claim(reg, e, tick, SteerRank::Chase,
                                target_dir(steer_tangent(gf, bestBearing.x,
                                                         bestBearing.y,
                                                         bestBearing.z),
                                           sp)))
                    ++out.claimSight;
            }
            continue;  // ЗРЕНИЕ СТАРШЕ СЛУХА — услышанное уже не нужно
        }

        // СЛУХ — диффузное поле шума, тот же вопрос, что задавал `investigate`.
        // ГЛУХОЙ НЕ СПРАШИВАЕТ ПОЛЕ ВОВСЕ. Ноль множителя нельзя отдать
        // `loudest_heard`: он начинается с `mult > 0 ? mult : 1.0f`, то есть
        // КОЭРСИТ ноль в единицу, и «глухой по построению» стало бы ложью
        // шапки. Поймано гейтом нового сьюта (блок 3b) до прогона.
        const float hearMult = sense_hearing_mult(cls, mr);
        if (hearMult <= 0.0f) continue;
        float dist = 0.0f;
        const Noise* n = loudest_heard(
            noise, layer, tr.pos, hearMult,
            kInvestigateMinSeverity,
            static_cast<std::uint32_t>(entt::to_integral(e)), &dist);
        if (n == nullptr) continue;
        ++out.heard;
        sen.heardSev = n->severity;
        if (immobile || human) continue;
        if (dist <= kInvestigateArriveRadius) {
            // ПРИБЫЛ. Стоит у звука, а не вращается вокруг точки: это и есть
            // «ищет», и это единственный устойчивый ответ — рулить на цель, на
            // которой стоишь, значит нормировать ноль. Перенос из снесённого
            // прохода слуха вместе с его доводом.
            if (steer_claim(reg, e, tick, SteerRank::Noise, target_hold()))
                ++out.claimNoise;
            continue;
        }
        const float hx = wrap_delta_f(tr.pos.x, n->x, kWorldExtent);
        const float hy = wrap_delta_f(tr.pos.y, n->y, kWorldExtent);
        const float hz = wrap_delta_f(tr.pos.z, n->z, kWorldExtent);
        const float sp = mr != nullptr
                             ? static_cast<float>(
                                   mob_def(static_cast<MobKind>(mr->kind)).speedMmps) *
                                   0.001f * kCellSize
                             : kWalkSpeedMps;
        if (steer_claim(reg, e, tick, SteerRank::Noise,
                        target_dir(steer_tangent(gf, hx, hy, hz), sp)))
            ++out.claimNoise;
    }
    return out;
}

} // namespace giga::game
