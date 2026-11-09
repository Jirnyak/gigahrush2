// Hunt — prey selection: what a monster is going after, and why.
//
// Before this file, "what a monster is going after" had exactly one answer:
// whoever holds the camera, if it is within `kAggroRadius`. Distance was the whole
// model, so a monster 25 m away in a silent corridor and a monster 25 m away
// standing in the middle of a firefight behaved identically. This adds the second
// answer — a monster that HEARD something recently goes and looks at it — which is
// the reference's shared noise-investigation branch (`tryFollowNoise`), and the
// first consumer of [noise.h].
//
// ---------------------------------------------------------------------------
// Why this is an OVERRIDE on top of wander_step, not a rewrite of it
// ---------------------------------------------------------------------------
// The SEEN half still lives in [wander.cpp], where the sight-aggro pursuit,
// `pursuit_offset` encirclement, the gaze freeze and the wall-bias speed all
// already work. This pass runs AFTER `wander_step` and rewrites the horizontal
// velocity of the mobs that heard something and are not already in sight-aggro.
//
// That is a deliberate choice about blast radius, not laziness. Hoisting the seen
// half up here would be a refactor of the one steering path that is proven, inside
// a change whose actual job is to add a missing primitive — and the two would then
// have to be verified together instead of separately. As an override, `investigate_step`
// is purely additive: delete the call and the game is exactly what it was.
//
// The honest cost of that shape: two passes over the mobs on the layer instead of
// one. It is paid only when something is making a noise — `investigate_step` returns on
// `NoiseField::quiet()` before it looks at a single entity. В бою канона гейт
// не срабатывает вовсе (сотни шумов/сек, §65) — тогда цена держится фазами
// kWanderPeriod и O(kNoiseCap) на опрошенного, от частоты шумов не зависит. The stagger predicate is deliberately IDENTICAL to
// `wander_step`'s, so a mob's hearing decision lands on the same tick as the
// velocity it is overriding rather than one visit behind it.
//
// ---------------------------------------------------------------------------
// Sight beats sound
// ---------------------------------------------------------------------------
// A monster that can see you does not wander off toward a crate lid. The sight
// test here mirrors `wander_step`'s exactly, faction gate included — if the two
// ever disagree, a mob gets steered twice per tick by two systems that each think
// they own it, and the symptom is a monster that vibrates between a target and a
// sound. Same reason the faction gate had to be duplicated into `mob_attack_step`.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/mob_table.h"     // MobBehaviour
#include "game/noise.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"

namespace giga::game {

// ---------------------------------------------------------------------------
// The investigation branch's own numbers, from the reference
// ---------------------------------------------------------------------------
// `findNoiseInvestigationTarget` is `findNoiseForActor` with minSeverity 2,
// scanInterval 1.0 s and hearingMult 1.12. Two of the three port directly; the
// scan interval does not, and the difference is worth stating: the reference gives
// each actor a private randomised re-scan timer plus a "stay interested in this
// record" window, held in a per-actor map. Here the identity-hash stagger already
// spreads the scans (`kWanderPeriod` = 8 ticks = ~15 scans/s per mob, far finer
// than the reference's 1 Hz), and the noise's own fading TTL provides the
// persistence its `hotUntil` window provided. So there is no per-mob state at all
// in this pass, which is what keeps it allocation-free: it writes only `Velocity`,
// a component already in the view it iterates, and emplaces nothing.
inline constexpr std::uint8_t kInvestigateMinSeverity = 2;
inline constexpr float kInvestigateHearing = 1.12f;

// Metres from the sound at which a mob stops walking and mills about. Without it
// an investigating monster overshoots and oscillates across the point every visit,
// which reads as a bug rather than as searching.
inline constexpr float kInvestigateArriveRadius = 1.5f;

// Two hearing multipliers the reference authors for behaviours this file does NOT
// implement, kept here so the numbers are compiled, greppable and testable rather
// than living in a comment that will be re-derived from the reference next time.
// [noise.h] lists what each behaviour still needs beyond the primitive.
inline constexpr float kBeamHearing = 1.45f;   // Slepoglaz, LastSoundBeam
inline constexpr float kDogHearing = 1.25f;    // Green Dog, the noiseFear half
inline constexpr float kDogFearRadius = 18.0f; // ...and its fear radius, metres

// МОГИЛА ПРОХОДА СЛУХА (2026-11-09, CANON S25.8). Здесь жили
// `investigate_step`, `investigate_hear` и `InvestigateHeard`. Предмет переехал
// ЦЕЛИКОМ в один проход восприятия ([game/perceive.h]): слух стал каналом той
// же системы, что зрение, и слабее его РАНГОМ (`SteerRank::Noise < Chase`), а
// не порядком вызовов. Снесены, а не оставлены «на всякий случай», по трём
// причинам, каждая измерена:
//   * `investigate_step` был ПЯТЫМ писателем горизонтальной `Velocity` и
//     перебивал погоню — 45 двойных записей за 250 тиков на этаже 6 (прибор
//     `--action vedenie`), все его;
//   * писал жёсткие `v.x/v.y` без фрейма гравитации, то есть при любом режиме,
//     кроме −Z, вёл тело НЕ в плоскости ходьбы;
//   * глухота Безэхого была ВЕТКОЙ В КОДЕ (`if (beh == DeadEcho) return out;`),
//     а владелец потребовал строку таблицы — теперь это ноль множителя слуха
//     (`sense_hearing_mult`).
// Константы выше ОСТАЛИСЬ: у них есть живой читатель — проход восприятия.
// `kBeamHearing`/`kDogHearing`/`kDogFearRadius` читателя не имеют и названы
// вслух долгом, а не выданы за живые.

} // namespace giga::game
