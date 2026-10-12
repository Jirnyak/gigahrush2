#include "core/rng.h"
#include "game/wander.h"

#include <cmath>
#include <vector>

#include "core/math.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/ai.h"       // ai_owns_motion — the single-writer guard for Velocity
#include "game/combat.h"
#include "game/embody.h"   // NpcRef
#include "game/faction_relations.h"
#include "game/hunt.h"
#include "game/mob_behaviour.h"
#include "game/mob_table.h"
#include "game/mob_spawn.h"
#include "world/gravity.h"
#include "world/types.h"

namespace giga::game {

namespace {


// Walking speed for an ordinary resident, m/s. Mobs override this from their
// table row (speed is authored in cells/s, and a cell is kCellSize metres).
constexpr float kNpcWalkSpeed = 1.35f;

// Visits to wait before choosing a new destination after arriving or failing.
// Staggered visits, not ticks: with kWanderPeriod = 8 at 120 Hz this is ~1.1 s.
constexpr std::uint8_t kRepathCooldown = 16;

// kAggroRadius moved to wander.h — [investigate.h] needs the same number to decide
// whether a mob is already hunting by sight or is free to investigate a sound.

// Cell the agent currently occupies.
void agent_cell(const vec3& pos, int& cx, int& cy, int& cz) {
    cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    cz = wrap_macro(static_cast<int>(pos.z / kCellSize));
}

} // namespace

RoomId pack_target_zone(std::uint8_t pack, std::uint64_t tick,
                        std::uint32_t zones) {
    // Ноль зон — бейк не построен или этаж пуст. Делить на него нельзя, а
    // «цели нет» уже имеет имя.
    if (zones == 0) return kNoRoom;
    const std::uint32_t epoch = static_cast<std::uint32_t>(tick / kPackEpochTicks);
    // The epoch is mixed before it is combined, not after: raw epochs are 0,1,2...
    // and XORing a small counter into a small pack id would make neighbouring packs
    // and neighbouring epochs collide in blocks.
    const std::uint32_t h =
        hash_u32((static_cast<std::uint32_t>(pack) * 0x9e3779b9u) ^ hash_u32(epoch));
    // `RoomId` нумерует с единицы (ноль занят `kNoRoom`), таблица зон — с нуля.
    // Та же поправка на единицу, что у наряда ([game/ai.cpp] выбор зоны).
    return static_cast<RoomId>(h % zones + 1u);
}

std::uint32_t wander_init(Registry& reg, LayerId layer) {
    // Two phases, and the split is the discipline combat.cpp documents at length,
    // not tidiness: `emplace<WanderTarget>` on the FIRST agent creates that
    // component's storage, which can reallocate the registry's pool container and
    // dangle the view being iterated. Phase 1 only reads; phase 2 writes once the
    // view is gone. Bounded by the live-actor budget, and this runs at floor load.
    struct Candidate {
        Entity e;
        std::uint8_t pack;
    };
    std::vector<Candidate> fresh;

    auto view = reg.view<const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        if (decider_of(reg, e) == Decider::Human) continue; // за человеком решает человек
        if (reg.all_of<WanderTarget>(e)) continue;       // already wandering
        std::uint8_t pack = 0;
        if (const MobRef* m = reg.try_get<MobRef>(e)) {
            // Immobile mobs are architecture; giving them a destination would only
            // make them fight their own zero speed every pass.
            if (has_flag(kMobTable[m->kind].aiFlags, AiFlag::Immobile)) continue;
            pack = m->pack;
        }
        fresh.push_back(Candidate{e, pack});
    }

    for (const Candidate& c : fresh) {
        // НОГИ ЗДЕСЬ НЕ ВЫДАЮТ — её выберет первый посещающий проход (довод в
        // [game/wander.h]: число зон этажа известно только бейку, а бейк в
        // полёте). Компонента всё равно навешивается, и это она делает тело
        // ХОДЯЧИМ: `wander_step` обходит вид с `WanderTarget`, и моб без неё —
        // статуя ([game/mob_spawn.cpp]).
        //
        // Пачка тоже ждёт первого прохода, и когезия от этого не страдает, а
        // крепнет: цель пачки есть производная от (pack, эпоха), и все её члены
        // вычисляют один и тот же ответ в свой слот стаггера, а не хранят
        // каждый свою копию начального броска.
        reg.emplace<WanderTarget>(c.e, WanderTarget{kNoRoom, 0, c.pack});
    }
    return static_cast<std::uint32_t>(fresh.size());
}

namespace {

// ВЫБОР НОГИ — ОДНОЙ ДВЕРЬЮ `zone_pick_near` ([game/zone_nav.h]), и это
// ЛЕЧЕНИЕ ЗАМЕРЕННОГО ДЕФЕКТА, а не оформление.
//
// Здесь стояла копия выбора наряда: `kWanderTries` РАВНОМЕРНЫХ кандидатов среди
// всех зон этажа, отбраковка тех, что дальше предела. Замер 2026-10-12, этаж 0,
// 13818 зон, одна секунда сима: 119 попыток, 952 кандидата, прибытий и даже
// ВЫБОРОВ — ноль. Доля зон в пределах двух рёбер есть десятки из десятков
// тысяч, то есть предел дальности работал не ограничителем, а отказом; `walk 0`
// в приборе был не «не доходят», а «цели не выбрали ВООБЩЕ».
//
// Поэтому `kWanderTries` больше нет, и это не упрощение: попытки имели смысл
// ровно потому, что выборка могла промахнуться. Обход графа не промахивается —
// цель лежит в пределах предела по построению. Число без надобности есть число
// без происхождения.
RoomId pick_leg_zone(const ZoneNav& zones, RoomId myZone, std::uint32_t id,
                     std::uint64_t tick, bool isMob) {
    const std::uint16_t legMax = isMob ? kWanderLegZonesMob : kWanderLegZones;
    // Соль — тот же `id ^ tick`, которым прогулка перевыбирала узел решётки:
    // менять хеш вместе с предметом значило бы сменить ДВА правила за раз и
    // лишить красный тест возможности сказать, которое.
    return zone_pick_near(zones, myZone,
                          hash_u32(id ^ static_cast<std::uint32_t>(tick)),
                          legMax);
}

} // namespace

WanderTick wander_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                 const ZoneNav& zones, LayerId layer, std::uint64_t tick,
                 const GravityField* gravity) {
    WanderTick out;
    // Непостроенный бейк — no-op, не UB: тот же контракт, которым живут
    // `ai_patrol_step` и `place_errand_step`. Пока бейк зон в полёте, толпа
    // стоит — ровно как стояла при пустом `fine.flow`.
    if (!zones.built()) return out;

    GravityRegime steerRegime = GravityRegime::NegZ;
    if (gravity != nullptr) {
        steerRegime = gravity->regime;
        if (steerRegime == GravityRegime::Custom)
            steerRegime = regime_from_vector(gravity->global);
    }
    const GravityFrame gf = regime_frame(steerRegime);
    const auto tangent = [&gf](float x, float y, float z) {
        if (gf.axis == 0) x = 0.0f;
        else if (gf.axis == 1) y = 0.0f;
        else z = 0.0f;
        return vec3{x, y, z};
    };

    const std::uint32_t phase = static_cast<std::uint32_t>(tick % kWanderPeriod);

    // Whoever holds the camera. Mobs inside kAggroRadius abandon their wander and
    // come for it, which is what turns 77 idle monsters into a threat. Found once
    // per pass, not per agent.
    bool haveVictim = false;
    vec3 victimPos{0, 0, 0};
    std::uint32_t victimId = 0;
    // The viewer's forward, for WeepingAngel. Computed ONCE per pass, not per
    // monster: the whole reason the gaze test compares cosines is that no monster
    // then needs any trig of its own.
    float fwdX = 1.0f, fwdY = 0.0f;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        // Monsters do not hunt what they do not consider prey. Same gate as
        // mob_attack_step, and it has to be in BOTH: gating only the attack would
        // give a cultist a floor of monsters that chase and never swing, which reads
        // as broken pathfinding rather than as safety.
        if (const NpcRef* nr = reg.try_get<NpcRef>(e))
            if (!mob_hostile_to(pool, nr->id)) continue;
        victimPos = t.pos;
        victimId = static_cast<std::uint32_t>(entt::to_integral(e));
        const CameraTag& cam = reg.get<const CameraTag>(e);
        fwdX = std::cos(cam.yaw);
        fwdY = std::sin(cam.yaw);
        haveVictim = true;
        break;
    }

    // ХАЗАРД КЛЕТКИ ЗДЕСЬ НЕ ПРИМЕНЯЕТСЯ — и это закон, а не упущение.
    // Единственный применитель для мобов — `mob_attack_step`
    // ([combat.h] «the only place that damage was ever APPLIED»). Здесь жил
    // ВТОРОЙ, незамеченный экземпляр того же закона, и он был хуже по трём
    // признакам сразу: без стаггера (пуш каждый тик против `(tick + mobId)
    // % 16` — при 125 Гц это 1875 HP/с вместо 117, смерть за четыре тика),
    // с жёстким `cz - 1` вместо `regime_down` (врал при любой гравитации,
    // кроме -Z) и по подмножеству мобов (`WanderTarget` есть не у всех —
    // туманный моб без него статуя, [mob_spawn.cpp]; `MobCombat` есть у
    // КАЖДОГО, `emplace_mob`). Снят 2026-09-23 по замеру: два применителя
    // в одном тике = двойной урон, и это S11 «второй реализации не бывает».
    auto view = reg.view<Transform, Velocity, WanderTarget>();
    for (auto e : view) {
        Transform& tr = view.get<Transform>(e);
        if (tr.layer != layer) continue;

        const MobRef* mr = reg.try_get<MobRef>(e);

        // THE SINGLE-WRITER GUARD ([ai.h]). Exactly one system may write a body's
        // horizontal Velocity on a tick, and the token that decides it is
        // AiBrain::motion: ai_step runs before this loop, claims the bodies it will
        // steer, and this skips them. Without it, ai_step and this loop both write the
        // same component every tick and the creature vibrates — a bug that reads as
        // broken physics and is not.
        //
        // ADDITIVE TODAY, on purpose. A body with no AiBrain returns false, AiBrain is
        // attached only by ai_init, and ai_init has no caller yet — so this is a null
        // try_get and nothing else changes. That is what makes the AI's default-off real
        // rather than aspirational, and it is why the guard lands BEFORE the AI is
        // switched on instead of in the same commit.
        if (ai_owns_motion(reg, e)) continue;

        // The player is steered by input, never by the flow field. wander_init
        // already refuses to GIVE the camera holder a target (see the CameraTag
        // check in its loop above), but that only protects a body that was the
        // player when the floor was populated. possess_a_survivor hands CameraTag
        // and Controller to a resident that has been wandering for minutes and
        // therefore already carries a WanderTarget, so after any death this loop
        // was overwriting the player's own velocity every stagger period — the
        // documented contract in [wander.h] ("The player is skipped — it holds
        // CameraTag and is steered by input") held only until the first death.
        // Checked here rather than by stripping WanderTarget on possession: the
        // component is harmless data, and an exclusion at the point of steering
        // cannot be defeated by a future third way of becoming the player.
        // С 2026-09-12 вопрос задаётся общим примитивом ([ai.h] decider_of) —
        // «третий способ стать игроком» теперь обязан ответить в ОДНОМ месте.
        if (decider_of(reg, e) == Decider::Human) continue;

        // Identity-hash stagger: an agent's slot is a function of its own id, so
        // the crowd spreads evenly across the period with no scheduling state.
        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (hash_u32(id) % kWanderPeriod != phase) continue;
        // Знаменатель — ПОСЕЩЁННЫЕ, а не все в слое: стаггер пропускает семь
        // тел из восьми, и знаменатель, его не знающий, занизил бы долю
        // прибытий ровно в восемь раз.
        ++out.considered;

        WanderTarget& wt = view.get<WanderTarget>(e);
        Velocity& vel = view.get<Velocity>(e);

        // A packed agent's destination is DERIVED from the pack every pass, never
        // remembered from whenever it last repathed. That is what makes cohesion
        // exact instead of statistical: two members in different stagger slots
        // cannot come to hold different zones, because neither of them is holding a
        // decision of its own. One mix per visit, and `wt.zone` degrades to a cache.
        if (wt.pack != 0) {
            wt.zone = pack_target_zone(wt.pack, tick, zones.dist.zones);
            ++out.packed;
        }

        // Aggro overrides navigation entirely: a monster that can see you does not
        // consult a flow field, it comes straight at you. Straight-line pursuit is
        // correct at this range — inside 20 m in an apartment interior there is
        // rarely a wall worth routing around, and physics stops it if there is.
        //
        // Only mobs hunt. What they may hunt is now the crowd as well as the camera
        // holder, and the RATE is the whole design — see [hunt.h] before touching
        // this. Residents themselves still walk past the carnage: NPC-on-NPC and
        // NPC-on-monster fighting is a threat model this does not have.
        if (mr) {
            const MobDef& md = kMobTable[mr->kind];
            const MobBehaviour beh = static_cast<MobBehaviour>(md.behaviour);
            // Ten kinds have their own sight range instead of the flat 20 m: three
            // notice you far LATER (2.15 to 7.5 m), which is the only reason walking
            // past a monster is ever possible, and six notice you EARLIER (23 to
            // 30 m). Both directions are authored. [mob_behaviour.h]
            const float radius = behaviour_aggro_radius(beh, kAggroRadius);

            // Pick the chase target. The camera holder first and at its full aggro
            // radius; only a monster with nobody better, and holding this epoch's
            // hunting licence, drops to the crowd — and then only inside
            // min(kHuntRadius, its own radius), so the player can never lose a monster
            // to a resident standing further away than it can see the player.
            //
            // The prey scan runs inside this view's iteration and that is safe for one
            // stated reason: `nearest_prey` takes a const Registry and reads only
            // components that already exist, so it can neither create a storage nor
            // reallocate the pool container this live view is holding.
            bool chasing = false;
            float ax = 0.0f, ay = 0.0f;
            std::uint32_t chaseId = victimId;
            if (haveVictim) {
                ax = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
                ay = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
                const float az = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
                if (ax * ax + ay * ay + az * az < radius * radius) chasing = true;
            }
            if (!chasing && mob_hunts_npcs(id, tick)) {
                // Clamped to the mob's OWN sight radius, not left at the flat 6 m.
                // [hunt.h] states "the player wins inside kHuntRadius" as a strict
                // rule, and justifies it by kHuntRadius never exceeding the smallest
                // behaviour radius — which was true only while that smallest value
                // was CloseReveal's 6.0. LurkingFurniture is 2.15 ([mob_behaviour.h]),
                // so without this clamp a dormant Ковер would ignore the camera holder
                // standing 3 m away and go and eat a resident at 5 m: the rule
                // inverted, for the one kind whose whole design is not noticing you.
                // Derived from the radius rather than re-stated, so the next short
                // behaviour cannot reintroduce it.
                const float preyRadius = radius < kHuntRadius ? radius : kHuntRadius;
                const Prey pr = nearest_prey(reg, pool, layer, tr.pos, preyRadius);
                if (pr.e != entt::null) {
                    ax = wrap_delta_f(tr.pos.x, pr.pos.x, kWorldExtent);
                    ay = wrap_delta_f(tr.pos.y, pr.pos.y, kWorldExtent);
                    chaseId = static_cast<std::uint32_t>(entt::to_integral(pr.e));
                    chasing = true;
                }
            }
            if (chasing) {
                // Frozen while looked at. This returns BEFORE any velocity is
                // written, so a gazed Sculpture holds perfectly still instead of
                // coasting on last pass's velocity.
                //
                // The delta is VIEWER -> monster and is recomputed from the camera
                // holder rather than reused from the chase vector, because those are
                // now two different things: a Sculpture stalking a resident must still
                // freeze while you are watching it, or the one behaviour that gives it
                // counterplay would switch itself off the moment it found other prey.
                if (haveVictim) {
                    const float gx =
                        wrap_delta_f(victimPos.x, tr.pos.x, kWorldExtent);
                    const float gy =
                        wrap_delta_f(victimPos.y, tr.pos.y, kWorldExtent);
                    if (frozen_by_gaze(beh, fwdX, fwdY, gx, gy)) {
                        vel.v.x = 0.0f;
                        vel.v.y = 0.0f;
                        continue;
                    }
                }
                const float len = std::sqrt(ax * ax + ay * ay);
                if (len > 0.05f) {
                    // Steer at a SLOT around the victim, not at the victim itself.
                    // Two behaviours turn a converging queue into an encirclement,
                    // and both offsets are pure functions of entity ids — no state,
                    // no coordination, no spatial query. [mob_behaviour.h]
                    const PursuitOffset off =
                        pursuit_offset(beh, id, chaseId, ax / len, ay / len);
                    float tx = ax + off.x;
                    float ty = ay + off.y;
                    float tl = std::sqrt(tx * tx + ty * ty);
                    // Standing exactly on the slot must not divide by zero, and
                    // must not stop the chase either: fall back to the direct line.
                    if (tl < 0.05f) { tx = ax; ty = ay; tl = len; }
                    float sp = static_cast<float>(md.speedMmps) *
                               0.001f * kCellSize;
                    // Wall-adjacency pace. The four AiFlag::WallBias carriers move
                    // faster hugging a wall and slower in the open, which makes
                    // corridors and doorways genuinely worse places to be caught
                    // than open rooms — free level design, extracted from geometry
                    // that already exists. Two BEHAVIOURS read the same query with
                    // their own numbers (Арматура x1.22/x0.68, Панельник
                    // x1.02/x0.90) and TAKE PRECEDENCE over the flag rather than
                    // stacking with it: Арматура carries both, and multiplying
                    // would give it 1.44 where the reference gives 1.22.
                    // [mob_behaviour.h]
                    //
                    // One gate, one query. `wall_query_needed` is true for 5 of the
                    // 69 kinds, so the four cardinal cell reads stay off the other
                    // 64 — wave 2 added the query for exactly one more kind.
                    if (wall_query_needed(md.aiFlags, beh)) {
                        const bool wall = body_wall_adjacent(grid, tr.pos);
                        const MoveMult bm = behaviour_move_mult(beh, wall);
                        sp *= bm.claimed ? bm.mult
                                         : wall_bias_speed(md.aiFlags, wall);
                    }
                    const game::BurstPhase bp = game::burst_phase(beh, id, tick, len);
                    sp *= game::burst_speed_mult(bp);
                    sp *= game::behaviour_hurt_move_mult(beh, mr->hp, mr->maxHp);
                    const vec3 to = tangent(tx, ty, 0.0f);
                    const float toLen = length(to);
                    if (toLen > 0.001f) {
                        if (gf.axis != 0) vel.v.x = (to.x / toLen) * sp;
                        if (gf.axis != 1) vel.v.y = (to.y / toLen) * sp;
                        if (gf.axis != 2) vel.v.z = (to.z / toLen) * sp;
                    }
                }
                ++out.chasing;
                continue;  // no repath, no flow read — it has a target
            }
        }

        int cx, cy, cz;
        agent_cell(tr.pos, cx, cy, cz);

        if (wt.cooldown > 0) --wt.cooldown;

        // ВАНДЕР — ПОСЛЕДНИЙ, И ОТСЮДА ВСЯ РАЗНИЦА С НАРЯДОМ И ДЕЛОМ. У тех на
        // каждом отказе есть кому отдать тело («отдаём вандеру», токен не
        // забран), а за вандером нет никого: тело, которое он пропустит, не
        // ведётся НИКЕМ и дрейфует на прошлой скорости. Поэтому каждый отказ
        // ниже кончается ВЛАДЕЕМЫМ НУЛЁМ — это остановка, а не толчок, и
        // физика по оси гравитации продолжает работать как всегда.
        const auto stop = [&] {
            if (gf.axis != 0) vel.v.x = 0.0f;
            if (gf.axis != 1) vel.v.y = 0.0f;
            if (gf.axis != 2) vel.v.z = 0.0f;
        };

        // ЗОНА ТЕЛА — через дверь с опорой на соседа, а не `part.cell` напрямую:
        // клетка центра тела бывает ДЫРКОЙ в разбивке (замер §88: 26 тел на тик
        // из 238 ведомых), и это следствие названной неточности гранного
        // клиренса, а не дефект разбивки. Дословно правило `ai_patrol_step`.
        const RoomId myZone = zone_of_body(zones, cx, cy, cz);
        if (myZone == kNoRoom) {
            ++out.offnav;
            stop();
            continue;
        }

        // ПРИБЫЛ = СТОИТ В ЦЕЛЕВОЙ ЗОНЕ. Прежде прибытие спрашивалось у поля
        // решётки (`kFlowArrived` на клетке узла) — то есть у ТОЧКИ: нога
        // кончалась в одной клетке из 2 097 152, промах мимо неё на полметра
        // читался как «ещё иду», и за прогон 30000 кадров прибытий было РОВНО
        // НОЛЬ. Зона есть ОБЛАСТЬ, и попадание в неё — тот же вопрос, на
        // который отвечает прибытие дела (§88/E).
        const bool arrived = (wt.zone != kNoRoom && myZone == wt.zone);
        if (arrived) ++out.arrived;
        if (wt.zone == kNoRoom || arrived) {
            // Pick a fresh destination, but not every pass — thrashing between
            // unreachable zones would burn the whole stagger budget on repathing.
            // Цена отсутствия этого стаггера ЗАМЕРЕНА на наряде: `unreach`
            // 0 -> 3334, тиков в прогоне −40%, и просел даже соседний проход
            // (ход по делам 3.83 -> 0.90 прибытий на 100 замеров).
            //
            // A PACKED agent does not re-roll: its zone is the pack's, and rolling a
            // private one here is precisely the bug that would let a member peel off
            // the first time it arrived or hit a dead end. It instead waits out the
            // epoch, which reads as a pack that has arrived and is milling about.
            if (wt.pack == 0 && wt.cooldown == 0) {
                wt.zone = pick_leg_zone(zones, myZone, id, tick, mr != nullptr);
                wt.cooldown = kRepathCooldown;
                // РАЗНЫЕ ИМЕНА РАЗНЫМ ИСХОДАМ: «выбрал» и «за восемь попыток
                // достижимой близкой зоны не нашлось» — это два разных ответа,
                // и сложить их в один счётчик значило бы получить прибор,
                // который не умеет сказать, что именно не работает.
                if (wt.zone == kNoRoom) ++out.unreachable;
                else ++out.repicked;
            }
            stop();
            continue;
        }

        // ДВА ЧТЕНИЯ, И НИ ОДНОЙ ВОЛНЫ (§88): таблица даёт соседку на пути к
        // цели, плоскость соседки даёт направление. Ступеньку разрешает САМА
        // дверь, поэтому ветки на вертикаль у потребителя нет — была бы, значит
        // дверь обошли.
        const std::uint8_t d = zone_walk_dir(zones, myZone, wt.zone, cx, cy, cz,
                                             gf.pull ? gf.axis : -1);
        if (d == kZoneFlowNone) {
            // Маршрута нет: другая компонента связности, либо поле соседки не
            // покрывает эту клетку. Цель снимается СО СТАГГЕРОМ.
            ++out.unreachable;
            if (wt.pack == 0) wt.zone = kNoRoom;
            wt.cooldown = kRepathCooldown;
            stop();
            continue;
        }
        if (d < 6 && (d >> 1) == gf.axis) {
            // СТУПЕНЬКА И ЕСТЬ ВЫХОД ИЗ ЗОНЫ — единственный случай, когда дверь
            // отдаёт шаг вдоль гравитации (она смотрит вперёд через ступеньки и
            // отказывает, только когда подъём и есть сам переход). Наряд и дело
            // здесь отдают тело вандеру и ОСТАВЛЯЮТ цель; вандеру отдавать
            // некому, а стоять под ступенькой до конца прогона — это та же
            // непроверяемая по построению нога. Поэтому цель СНИМАЕТСЯ: у
            // прогулки она произвольна, и сменить её дешевле, чем изобретать
            // здесь подъём. Слепой прямой на цель нет сознательно — ровно она
            // была остатком якоря у решётки и стоила §88 нуля прибытий.
            ++out.stepup;
            if (wt.pack == 0) wt.zone = kNoRoom;
            wt.cooldown = kRepathCooldown;
            stop();
            continue;
        }
        if (wt.pack == 0) {
            // Прибор приближения — Σ по ВЕДОМЫМ телам (тело без хода в
            // знаменателе исказило бы среднее ровно в ту сторону, которая
            // выглядит успехом). Стоит ПОСЛЕ всех отказов и ДО записи скорости.
            //
            // ТОЛЬКО ОДИНОЧНЫЕ ТЕЛА, И ЭТО НАШЁЛ ЗАМЕР. Первая редакция
            // складывала сюда и пачковые: на этаже 6 они дают половину ведомых,
            // а предела дальности у них нет по построению (довод у
            // `pack_target_zone`) — их цель равномерна среди 5700 зон и лежит в
            // 10-30 зонах. Среднее вышло 9.47 при пределе ноги ДВА, то есть
            // прибор был честен, полон и отвечал на НЕ ЗАДАННЫЙ вопрос:
            // «далеко ли цель» вместо «приближается ли ходок к близкой цели».
            // Это четвёртый класс лжи прибора (§87), и лечится он не точностью,
            // а РАЗДЕЛЕНИЕМ популяций: сколько пачковых тел — говорит `packed`,
            // а их дальность есть арифметика, а не наблюдение.
            const std::uint16_t zd = zones.dist.at(
                static_cast<std::uint32_t>(myZone) - 1u,
                static_cast<std::uint32_t>(wt.zone) - 1u);
            if (zd != kZoneUnreachable) {
                out.zoneDistSum += zd;
                ++out.zoneDistBodies;
            }
        }

        // Шаг в плоскости ходьбы: целимся в ЦЕНТР следующей клетки — то же
        // самоисправляющееся правило (и по тому же замеру), которым идут наряд и
        // дело. Прежде здесь брался ГОЛЫЙ ОРТ `kNavDir`, и разница не
        // косметическая: орт ведёт тело из любой точки клетки одинаково, поэтому
        // тело, вошедшее в клетку по касательной, так и шло по её краю и
        // цеплялось за углы, а центр следующей клетки сам стягивает его к
        // середине коридора.
        const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
        const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
        const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
        vec3 dir = tangent(
            wrap_delta_f(tr.pos.x, (static_cast<float>(nx) + 0.5f) * kCellSize,
                         kWorldExtent),
            wrap_delta_f(tr.pos.y, (static_cast<float>(ny) + 0.5f) * kCellSize,
                         kWorldExtent),
            wrap_delta_f(tr.pos.z, (static_cast<float>(nz) + 0.5f) * kCellSize,
                         kWorldExtent));
        const float dlen2 = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
        if (dlen2 <= kMinFleeGrad2) {
            // Направления нет: проекция на плоскость ходьбы опустошила вектор,
            // или тело стоит точно в центре целевой клетки. Владеемый ноль, цель
            // ОСТАЁТСЯ — следующий тик сдвинет тело физикой и пеленг появится.
            stop();
            continue;
        }
        dir = dir * (1.0f / std::sqrt(dlen2));

        float speed = kNpcWalkSpeed;
        if (mr != nullptr) {
            // Table speed is cells/s in fixed point; a cell is kCellSize metres.
            speed = static_cast<float>(kMobTable[mr->kind].speedMmps) * 0.001f *
                    kCellSize;
        }

        ++out.walking;
        if (gf.axis != 0) vel.v.x = dir.x * speed;
        if (gf.axis != 1) vel.v.y = dir.y * speed;
        if (gf.axis != 2) vel.v.z = dir.z * speed;
        // Gravity axis is left to physics_step
    }
    return out;
}

} // namespace giga::game
