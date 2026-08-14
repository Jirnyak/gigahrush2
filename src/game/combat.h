// Combat — damage, death, and melee attacks.
//
// This module is deliberately shaped around three defects found in the TypeScript
// reference during the port. They are the reason it looks over-engineered for its
// size; each one is a bug that is *impossible* here rather than merely absent.
//
//   1. **One damage function.** In the reference, pre-armour damage leaked into
//      the kill feed, the AI threat model and the blood spray while HP took the
//      mitigated value — so the number the player saw was not the number that
//      landed. `apply_damage` is the only place damage is computed, and it returns
//      the value it actually applied. Report *that*, never the raw input.
//
//   2. **One death finalizer.** The reference had no single place a death funnels
//      through, so an entity could be culled before its loot / A-Life / quest
//      hooks ran — a P0 its own balance.md documented and never fixed. Here
//      `apply_damage` NEVER destroys anything: it tags `Dead`, and
//      `finalize_deaths` is the one function that ends a life, at one defined
//      point in the tick.
//
//   3. **One cooldown decrement.** The reference decremented `attackCd` at ~60
//      sites, several of them as `max()` floors, so some monsters out-attacked
//      their own authored attack rate. `mob_melee_step` decrements it exactly
//      once, at the top, for every mob.
//
// Where HP lives is NOT unified, on purpose. For an embodied NPC the pool row is
// canonical and folds back on floor exit ([npcs.md], embody.h); a mob has no macro
// existence at all and carries its own. `apply_damage` resolves which, so callers
// never have to care — the *function* is single, the storage is where the
// architecture already put it.
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "game/status.h"
#include "game/inventory.h"
#include "game/item_table.h"
#include <unordered_set>

#include "game/noise.h"          // NoiseField, for the gunshot and the body fall
#include "game/particles.h"      // ParticleBurstQueue — blood/spark proposals
#include "game/ranged_table.h"   // ItemId, for the equipped-loadout helpers
#include "game/npc_pool.h"
#include "game/rpg.h"      // RpgStats (POSRPG transfer)
#include "core/wrap.h"     // wrap_delta_f — toroidal deltas, every axis
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/materials.h"

namespace giga::game {

inline std::uint64_t cell_key(int x, int y, int z) {
    return (static_cast<std::uint64_t>(x & 0xFFFF) << 32) |
           (static_cast<std::uint64_t>(y & 0xFFFF) << 16) |
           (static_cast<std::uint64_t>(z & 0xFFFF));
}

inline constexpr std::size_t kMaxDestroyedShields = 128;

// Tracks destroyed electrical shields and localized power outages (Pure POD).
struct PowerGridState {
    std::uint64_t destroyedShieldKeys[kMaxDestroyedShields] = {};
    std::uint32_t count = 0;

    void destroy_shield(int cx, int cy, int cz) {
        std::uint64_t k = cell_key(cx, cy, cz);
        for (std::uint32_t i = 0; i < count; ++i) {
            if (destroyedShieldKeys[i] == k) return;
        }
        if (count < kMaxDestroyedShields) {
            destroyedShieldKeys[count++] = k;
        }
    }

    bool is_shield_destroyed(int cx, int cy, int cz) const {
        std::uint64_t k = cell_key(cx, cy, cz);
        for (std::uint32_t i = 0; i < count; ++i) {
            if (destroyedShieldKeys[i] == k) return true;
        }
        return false;
    }

    bool is_power_cut(const vec3& pos) const {
        for (std::uint32_t i = 0; i < count; ++i) {
            std::uint64_t k = destroyedShieldKeys[i];
            int sx = static_cast<int>((k >> 32) & 0xFFFF);
            int sy = static_cast<int>((k >> 16) & 0xFFFF);
            int sz = static_cast<int>(k & 0xFFFF);
            // Z-up: the 0.40 m mount offset rides the vertical (z) axis.
            vec3 shieldPos{sx * kCellSize, sy * kCellSize, sz * kCellSize + 0.40f};
            float dx = wrap_delta_f(pos.x, shieldPos.x, kWorldExtent);
            float dy = wrap_delta_f(pos.y, shieldPos.y, kWorldExtent);
            float dz = wrap_delta_f(pos.z, shieldPos.z, kWorldExtent);
            if (dx * dx + dy * dy + dz * dz <= 12.0f * 12.0f) {
                return true;
            }
        }
        return false;
    }
};
static_assert(std::is_trivially_copyable_v<PowerGridState>, "PowerGridState must stay a pure POD struct");

// Five channels, matching the reference's armour model and the `resist[5]` vector
// carried by armour items.
enum class DamageChannel : std::uint8_t {
    Kinetic = 0, Buckshot, Energy, Fire, Psi, Count
};
inline constexpr std::size_t kDamageChannels =
    static_cast<std::size_t>(DamageChannel::Count);

// Environmental hazard query for cell materials.
struct CellHazard {
    std::int16_t damage = 0;
    DamageChannel channel = DamageChannel::Kinetic;
    bool active = false;
};

inline CellHazard get_cell_hazard(CellType t) {
    CellHazard h;
    switch (t) {
        case kMatElectricGrate:
            h.damage = 15;
            h.channel = DamageChannel::Energy;
            h.active = true;
            break;
        case kMatAcidPool:
            h.damage = 10;
            h.channel = DamageChannel::Kinetic;
            h.active = true;
            break;
        case kMatFireCell:
            h.damage = 20;
            h.channel = DamageChannel::Fire;
            h.active = true;
            break;
        default:
            break;
    }
    return h;
}

// Flat percentage mitigation per channel, 0..100, clamped on use. Absent means no
// armour at all, which is the common case — the reference authors only four.
//
// Populated from the item table's armour rows (equip flow below and
// monster_traits.cpp for mobs). It lives here, in one place, because mitigation
// living in one place is the whole point of defect (1) above, and bolting it on later is how the leak
// gets reintroduced.
struct Armour {
    std::int8_t resist[kDamageChannels] = {};
};

// "Damage does not touch me" — debug/console god mode.
//
// Checked in exactly one place, the top of apply_damage, because apply_damage is
// THE damage entry point (defect (1) above): melee, projectiles, hazards and
// faction feuds all funnel through it, so one tag test covers every source
// without a second leak-prone guard anywhere else. The console toggles it.
struct GodMode {};

// Set by apply_damage when a target's HP reaches zero. Nothing else may set it,
// and it does not mean the entity is gone — only that it is scheduled to die at
// the next finalize_deaths.
struct Dead {
    Entity killer = entt::null;
    std::uint8_t channel = 0;
};

// Fixed corpse inventory. 8 slots covers Boss (5 rolls @ 100%) plus a bundled
// ammo pack when a firearm pays — still a pure POD array, no heap, no vector.
inline constexpr std::size_t kMaxCorpseSlots = 8;

// Staged mob loot on a Dead entity, filled by loot_dead_mobs in the Dead window
// and consumed by finalize_deaths when the entity becomes a persistent Corpse.
//
// **Why a separate component and not Corpse early:** finalize is the only place
// that may emplace Corpse (defect 2 — one death finalizer). Staging as data on
// the still-Dead entity keeps the systems pure: loot writes data, finalize
// moves data, interact reads data. No floor Pickup double-drop.
struct CorpseLootPending {
    ItemSlot slots[kMaxCorpseSlots] = {};
    std::uint8_t slotCount = 0;
};
static_assert(std::is_trivially_copyable_v<CorpseLootPending>,
              "CorpseLootPending must stay a pure POD struct");

// Persistent corpse lying on the ground after death, available for tactical looting (Pure POD).
struct Corpse {
    ItemSlot lootSlots[kMaxCorpseSlots] = {};
    std::uint32_t deathTick = 0;
    std::uint8_t mobKind = 0xFF;  // 0xFF for NPC record, or MobKind
    std::uint8_t slotCount = 0;
    bool searched = false;
};
static_assert(std::is_trivially_copyable_v<Corpse>, "Corpse component must stay a pure POD struct");


// Per-instance melee state. Separate from MobRef because MobRef is the spawn
// record (what this monster IS) and this is combat state (what it is DOING).
struct MobCombat {
    std::uint16_t cooldownMs = 0;  // time until this mob may attack again
    // >0 while a ranged shot is being telegraphed. The windup is the whole reason
    // ranged monsters are fair: you get 0.48-1.25 s of warning, per kind, and
    // breaking line of sight or leaving the cone during it aborts the shot.
    std::uint16_t windupMs = 0;
};

// A temporary cap on how fast a body may move horizontally, in m/s.
//
// **A CAP and not a multiplier, and that is the load-bearing decision.** The
// obvious shape — scale `Velocity` by 0.45 every tick — compounds catastrophically
// for anything that is not the camera holder. `controller_step` rewrites the
// player's x/y from `moveSpeed` every single tick, so a repeated multiply is
// harmless there; `wander_step` writes a crowd body's velocity only on its own
// stagger slot, once every `kWanderPeriod` (8) ticks, and leaves it alone in
// between. Multiplying a resident's velocity every tick would give it 0.45^8 =
// 0.0017 of its speed within one period — a freeze, not a slow. Clamping is
// idempotent, so the same enforcement pass is safe against both writers.
//
// The cap is therefore resolved ONCE, at the moment the effect lands, from the
// victim's own authority: a monster's table speed, or a Controller's `moveSpeed`.
// It composes with exhaustion for free and in the right direction — needs already
// scales `moveSpeed` down every tick ([needs.h]) and a clamp is an upper bound, so
// whichever of the two is slower wins with no coordination between them.
//
// An expired effect is left ATTACHED with `ttlMs == 0` rather than removed, and
// that is a crash avoidance rather than laziness: `slow_step` finds expiry while
// iterating a view that includes `Slowed`, and erasing the component there is the
// same reallocate-the-storage hazard the two-phase split in `mob_attack_step`
// exists to prevent. The alternative — collect the expired into a vector and erase
// after — allocates every tick in the hot path for a component almost nothing
// carries. An inert 8-byte component is the cheaper honest answer; `slow_scale`
// and `slow_step` both read `ttlMs == 0` as "not slowed".
struct Slowed {
    float maxSpeed = 0.0f;     // horizontal cap, m/s
    std::uint16_t ttlMs = 0;   // remaining; 0 = expired and inert, never removed
};

// A monster's shot in flight. Not a mob and not an alife record — it exists for a
// fraction of a second and then hits something, hits the floor, or times out.
//
// Carries Transform + AABB + Renderable too, so it renders through the existing
// body pass with no new render code: shots are visible tracers, not invisible
// damage events.
struct Projectile {
    Entity source = entt::null;   // for the kill feed; may already be dead
    std::int16_t dmg = 0;
    std::uint16_t ttlMs = 0;      // hard bound, so a stray shot cannot live forever
    // Percent of kProjGravity this shot obeys. 100 for a monster, kPlayerGravityPct
    // for the player.
    //
    // These two bytes are what keep ONE projectile system instead of two. A monster
    // auto-aims at a known point and therefore gets a gravity-compensated lob
    // (`vz = dz/tof + 0.5*g*tof`, below). The player aims with the camera and cannot
    // be handed that compensation without it being an aimbot — so a player bullet
    // gets a flatter arc instead. Forking projectile_step to express that would mean
    // maintaining two integrators forever.
    std::uint8_t gravityPct = 100;
    // THERE IS NO `team` FIELD, and its absence is the design — deleted 2026-08-12.
    //
    // One lived here: 0 = fired by a monster, 1 = fired by the player, "decides who
    // it may hit". It bought three exclusions — a player bullet could not touch a
    // civilian, a monster's shot could not touch another monster, and neither could
    // touch the body that fired it — and all three are forbidden by name in
    // ARCHITECTURE.md §Манифест п.5: "никаких friendly-fire-исключений; граната
    // скачет по вокселям, осколки бьют и владельца".
    //
    // Owner's ruling: **ownership itself is the hardcode.** Once a shot leaves the
    // barrel it is a physical object with no memory. It does not know who fired it,
    // what team they were on, or which faction is in front of it.
    //
    // `source` below stays, and the distinction is the whole point: it is
    // ATTRIBUTION, not exclusion. `finalize_deaths` needs to know whose kill it was
    // in order to award XP; nothing reads it to decide what may be hit. A body can
    // now be credited with killing itself, which is correct rather than a bug.
    //
    // Re-adding a team field would not be a tuning change, it would be reversing a
    // design decision — say so out loud if you do.
    // What KIND of shot this is: a `ProjType` ([mob_table.h]), stored as the same
    // raw u8 `MobDef::projType` is so this header does not have to include the mob
    // table. 0 = Bullet, 1 = Web.
    //
    // It exists because `MobDef::projType` was write-only: the enum, the field and
    // 69 generated rows were there, and a search across src/ for a READER found
    // nothing. 68 of the rows are blank (Bullet) and exactly one is WEB, so the one
    // authored row behaved identically to the other 68 — which reads as implemented
    // and is not. Carried on the projectile rather than looked up from the shooter
    // at impact, because the shooter may already be dead by then (`source` is
    // documented as possibly stale) and a shot's behaviour must not depend on
    // whether its owner survived the flight.
    std::uint8_t proj = 0;
    // Which `DamageChannel` this shot delivers, stored as the raw u8 the enum is.
    //
    // Same defect, same fix, one field over: `RangedDef::channel` was write-only.
    // The column exists in [ranged_table.h], the generator fills it from
    // data/weapons_ranged.csv, and a search across src/ for a READER found NOTHING —
    // so armour's `resist[5]`, the five psi-resist rows in data/items.csv and every
    // per-channel column in [monster_traits.h] were being mitigated against a channel
    // that only ever arrived as Kinetic.
    //
    // Carried on the projectile rather than looked up from the shooter at impact, for
    // the reason `proj` above states: `source` is documented as possibly stale, and a
    // shot's behaviour must not depend on whether its owner survived the flight.
    //
    // Kinetic on all 29 firearms TODAY and that is not a placeholder — the reference
    // sets `damageType` on zero physical weapons ([ranged_table.h] records this), so a
    // shotgun there deals Kinetic too. The channel that is genuinely authored is Psi,
    // on the 18 rows of the reference's data/psi.ts.
    std::uint8_t channel = static_cast<std::uint8_t>(DamageChannel::Kinetic);
    // Blast radius in DECIMETRES, 0 for anything that is not explosive.
    //
    // Carried here for the third time and for the third identical reason (`proj`
    // and `channel` above): the thrower may be dead — indeed a grenade dropped at
    // your own feet is *expected* to outlive you — and what a detonation does must
    // not depend on whether whoever threw it survived the fuse.
    //
    // Decimetres and not metres, because a u8 of metres cannot say 4.5 m and the
    // whole scale of interest is 1..10 m. 0.1 m of resolution over a 25.5 m ceiling.
    //
    // It is also the ONE field that decides a detonation happens at all: `ttlMs`
    // reaching zero is the fuse, and a Bullet reaching the same zero is a spent shot
    // that vanishes. Same timer, two meanings, told apart by `proj` — see
    // `projectile_step`.
    std::uint8_t blastDm = 0;
};

// Fraction of gravity a player bullet obeys, in percent. The reference's NORMAL
// projectile gravity is 1.2 spriteZ/s^2 over a 2 m cell, i.e. ~2.4 m/s^2, against our
// kProjGravity of 6.0 — so 40% reproduces its trajectory rather than guessing one.
inline constexpr std::uint8_t kPlayerGravityPct = 40;

// How far in front of the eye a player bullet is born, metres.
//
// NOT cosmetic — without it the player shoots himself on the first frame, and the
// arithmetic is decisive: a shot spawned at the body with only +0.6 z, fired from a
// makarov at 44 m/s, advances 0.352 m in one 125 Hz step (kSimDt = 8 ms exactly,
// [core/tick.h]), giving d^2 = 0.352^2 + 0.6^2 = 0.484 against
// kProjHitRadius^2 = 0.5625. It hits — and the shorter 125 Hz step makes it hit
// HARDER than the 0.497 this comment recorded at 120 Hz. The reference uses
// 0.85 cells; this is that.
// The stature knockback is normalised to, in kg: `body_mass_kg` of a 1.75 m adult
// ([embody.h] m = 22*h^2 -> 67.4). A body of exactly this mass takes the historical
// flat 2.5 m/s shove, so the shipped feel is a FIXED POINT rather than a retune,
// and everything lighter or heavier now scales around it through p = m*v — which
// is what makes a full pack plant you and a child fly. See combat.cpp's knockback.
inline constexpr float kKnockbackRefMassKg = 67.4f;

// The MINIMUM barrel length, and no longer the whole of the guarantee.
//
// It is a floor rather than the answer because the muzzle is measured from the EYE
// while the hit test measures from the BODY ORIGIN, and the distance between those
// two is stature — `body_eye_height` is h*0.43 ([embody.h]). Fire straight down and
// the clearance is `kMuzzleForward - eyeHeight`, which at the tallest stature
// `height_for_age` will produce (2200 mm) comes to 0.754 m against a 0.75 m hit
// sphere: **4 mm**, held together by three constants in three files.
//
// That coincidence was what the last owner test in the tree, `p.source != victim`,
// was quietly insuring against — a rule paying for arithmetic nobody had done, which
// is the same shape of defect §33 found when a rule was paying for a muzzle nobody
// had placed. `muzzle_point` (combat.cpp) now solves the ray/sphere exit and pushes
// the spawn point past this floor when, and only when, it has to. The clearance is a
// guarantee at every stature, and the rule is deleted.
inline constexpr float kMuzzleForward = 1.7f;

// The camera holder's firearm state. A sibling of PlayerMelee rather than an
// extension of it, so one body can carry both a pipe and a pistol.
//
// `weapon` records which gun the magazine belongs to: swapping guns empties it, since
// a magazine of shells is not a magazine of 9mm. Attached lazily, like PlayerMelee.
struct PlayerRanged {
    std::uint16_t cooldownMs = 0;
    std::uint16_t reloadMs = 0;
    std::uint16_t magCount = 0;
    ItemId weapon = 0;
    std::uint32_t shots = 0;    // cumulative; survives possession like kills does
    std::uint32_t hits = 0;
};

// The camera holder's swing state. Attached lazily by player_melee_step, so
// possessing a new body after death does not need to remember to add it.
struct PlayerMelee {
    std::uint16_t cooldownMs = 0;
    std::uint32_t kills = 0;       // cumulative, survives possession
};

// POSRPG — move person-progression across a live-to-live camera hop.
//
// Death possession (main.cpp) and the elevator ride already capture/restore
// their own way (old body is destroyed). Voluntary possess only swaps
// CameraTag/Controller, so without this stamp the new body has no RpgStats
// (ordinary embody never attaches one), lazy PlayerMelee starts kills at 0,
// and cumulative shots/hits on PlayerRanged are wiped on first fire.
//
// Rules:
//   * RpgStats: copy from -> to (person sheet follows the mind).
//   * PlayerMelee::kills: MOVE (zero on from, stamp on to).
//   * PlayerRanged shots/hits: MOVE into a lazy component on to; mag/weapon/
//     cooldowns stay on from (physical chamber belongs to the abandoned body).
//   * Does nothing when from==to or either handle is invalid.
void transfer_player_progression(Registry& reg, Entity from, Entity to);

// Cosine of the half-angle you must be facing the target within. 0.35 is roughly
// a 70-degree half-cone: generous enough not to feel like pixel-hunting in a dark
// corridor, tight enough that you cannot hit what is behind you.
inline constexpr float kMeleeFacingDot = 0.35f;

// Reach is authored in cells and a cell is 2 m, but a bare 0.5-cell fist would be
// a 1 m reach against bodies whose own half-extents are up to 0.9 m — you could
// not touch a boss. This slack is added to every weapon's reach so contact is
// possible at all; it is a body-size allowance, not a weapon buff.
inline constexpr float kMeleeReachSlack = 0.9f;   // metres

// Projectile constants. Gravity is lighter than the world's so a shot arcs
// readably instead of dropping like a stone; the TTL is a hard backstop so a
// shot fired into open space cannot live forever; the hit radius is generous
// because a 10 cm box at 20 m/s advances 16 cm per 125 Hz step (0.008 s) and so
// would tunnel clean through a body between two of them.
inline constexpr float kProjGravity = 6.0f;        // m/s^2
inline constexpr std::uint16_t kProjTtlMs = 4000;
inline constexpr float kProjHitRadius = 0.75f;     // metres

// GRENADE BALLISTICS. A grenade is the one projectile that does not end on contact
// — it bounces off the world and detonates on its FUSE, which is what
// ARCHITECTURE.md §Манифест п.5 means by "граната скачет по вокселям".
//
// The restitution pair is measured against the thing it must produce: a grenade
// thrown down a 2 m corridor has to come to rest inside the fuse rather than
// ricochet for three seconds (unplayable) or stick where it lands (a mine, not a
// grenade). 0.38 normal / 0.72 tangential drops a 16 m/s throw below the rest
// threshold in four bounces, which reads on screen as a couple of hops and a roll.
//
// The rest threshold is what stops the perpetual micro-bounce: gravity re-adds
// ~0.05 m/s every 8 ms tick, so without a floor the last 1% of energy costs as many
// bounce resolutions as the first throw did, for no visible motion.
inline constexpr float kGrenadeRestitution = 0.38f;   // normal component kept
inline constexpr float kGrenadeFriction    = 0.72f;   // tangential kept per bounce
inline constexpr float kGrenadeRestSpeed   = 0.55f;   // m/s below which it settles

// Fraction of the DAMAGE radius that the geometry carve gets.
//
// Not 1.0, and the gap is the design: an RGD-5 kills across a room and opens a hole
// you could crawl through, not a room-sized crater. Fragments travel; the pressure
// wave that breaks concrete does not travel nearly as far. 0.35 of a 5.0 m blast is
// a 1.75 m carve — one honest doorway.
inline constexpr float kBlastCarveScale = 0.35f;

// What a WEB shot does instead of damage. Both numbers are read off the one
// authored WEB row rather than picked, and the row is unusually explicit about its
// own design — `data/mobs.csv` gives PAUPSINA `dmg = 0` and describes it as a
// control monster that "does not chew health, but makes a bad corridor into a
// sticky trap". It is the ONLY row in the file with zero damage.
//
// 0.45: the player walks 6.0 m/s and PAUPSINA moves 2250 mmps x 2 m = 4.5 m/s, so
// 6.0 x 0.45 = 2.70 m/s. Unwebbed you outrun it (6.0 > 4.5); webbed you cannot
// (2.70 < 4.5) and have to deal with it. That threshold is the entire mechanic, and
// any scale above 0.75 puts it back on the wrong side of 4.5 and makes the web
// cosmetic.
//
// 2500 ms: just under the kind's own 2650 ms attack cooldown, so a landed web holds
// until it can fire again and a second hit refreshes rather than stacks — the hold
// is continuous while you stay in the band and ends ~150 ms after you leave it.
inline constexpr float kWebSlowScale = 0.45f;
inline constexpr std::uint16_t kWebSlowMs = 2500;

// Put a horizontal speed cap on `target` at `scale` of its own top speed, for
// `ms`. Returns false when the effect could not be resolved.
//
// The cap is derived from whichever authority the target actually has: `MobRef` ->
// the kind's table speed, else `Controller` -> `moveSpeed`. A body with neither is
// REFUSED rather than guessed at, and the refusal is deliberate. The remaining
// case is an embodied resident, whose walk speed is a constant private to
// wander.cpp; copying 1.35 m/s in here would be a second definition of a number
// with one owner, and a copy that silently disagrees is worse than a false return.
//
// It is also unreachable today, by arithmetic rather than by hope: the only web
// source is PAUPSINA, whose minimum shot range is 3400 mm x 2 m = 6.8 m, while
// crowd prey is only ever selected inside `kHuntRadius` = 6.0 m ([hunt.h]). Every
// resident it could target is inside its own dead zone, so a web can only ever land
// on the camera holder — which always carries a Controller.
//
// Refreshing takes the STRONGER cap and the LONGER remaining time, never the
// product: two webs must not compound to 0.20 and pin a player in place, because
// the drop below the spitter's own 4.5 m/s is already the whole effect and anything
// past it only removes the player's options.
bool apply_slow(Registry& reg, Entity target, float scale, std::uint16_t ms);

// The multiplier `e` is currently moving under, as a fraction of the cap's own
// base. 1.0 when nothing is slowing it. For the HUD; `slow_step` does the
// enforcing.
float slow_scale(const Registry& reg, Entity e);

// Age every slow on `layer` and enforce the survivors' caps on Velocity. Returns
// how many bodies are still slowed after the pass.
//
// Call it AFTER everything that writes velocity (`controller_step`, `wander_step`,
// `investigate_step`) and BEFORE `physics_step`, so the cap applies to the velocity
// that actually gets integrated. Costs one view iteration over a component almost
// nothing carries — it early-outs on an empty storage.
//
// Only x/y are clamped. Scaling z would make a webbed body FALL slower, which is
// not what a movement slow means and would quietly break gravity for anything
// caught in mid-air.
std::uint32_t slow_step(Registry& reg, LayerId layer, float dt);

// Environmental gas/smoke absorption by equipped filters and continuous battery usage (Spec 03 §4.2).
// Staggered 1-in-16 by entity id. Returns count of degraded items.
std::uint32_t fouling_step(Registry& reg, NpcPool& pool, LayerId layer,
                           const float* gasField, const float* smokeField,
                           float dt, std::uint64_t tick);

struct Equipped;

int equipped_melee_slot(const Inventory& inv, const Equipped* eq = nullptr);
ItemId equipped_melee(const Inventory& inv, const Equipped* eq = nullptr);

int equipped_armour_slot(const Inventory& inv, const Equipped* eq = nullptr);
ItemId equipped_armour(const Inventory& inv, const Equipped* eq = nullptr);

// Copy the equipped armour's resistances onto `e`'s Armour component, adding or
// removing it as needed. Call after anything that changes the inventory, so that
// picking a vest up actually protects you.
//
// This is what finally gives Armour data: the resistances were in the item table
// all along (5 of 446 items carry them) — mitigation just had nothing feeding it.
void sync_armour(Registry& reg, NpcPool& pool, Entity e);

struct DamageResult {
    std::int16_t applied = 0;  // AFTER mitigation — the only number worth reporting
    std::int16_t blocked = 0;
    bool lethal = false;       // this hit took it to zero
    bool hit = false;          // false when the target holds no HP at all
};

// THE damage entry point. Every hit in the game goes through here.
//
// Resolves where the target's HP lives (mob instance vs. pool row), applies
// channel mitigation, clamps, and tags `Dead` on reaching zero. Does **not**
// destroy the entity — see finalize_deaths.
// Optional `particles`: when non-null, a hit that applied damage through a
// physical channel (everything but Psi) proposes a Blood burst at the target —
// the unified-pool law ([particles.h]): apply_damage IS the blood writer, so a
// bullet, a swing, a fall and a hazard all bleed through one line. Null keeps
// the pre-particle path bit-for-bit (tests compile unchanged).
//
// Optional `gravity`: the field the knockback plane is derived from. A hit shoves
// the target along the FLOOR, and "floor" means "perpendicular to gravity here",
// never the XZ plane ([AGENTS.md]: gravity is a vector, -Z is not an axiom). When
// null the impulse follows the raw line between attacker and target — isotropic,
// no axis assumed, just uncorrected for slope. Pass it wherever the layer is known.
DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                          std::int16_t raw, DamageChannel ch, Entity source,
                          const MacroGrid* grid = nullptr,
                          ParticleBurstQueue* particles = nullptr,
                          const GravityField* gravity = nullptr,
                          const float* fluid = nullptr);

// THE death finalizer, and the only place an entity dies. Publishes one NpcDied
// per death (payload: `a` = victim NpcId or kInvalidNpc for a mob, `b` = MobKind
// or 0xFF, `c` = killer entity id), marks the pool row dead for records, and then
// destroys. Returns the number finalized.
//
// Call it at ONE defined point per tick, after every system that can deal damage.
// Anything that needs to react to a death must do so from the event, not by
// watching for entities to vanish.
//
// `noise` is an optional sink for the body hitting the floor ([noise.h]). It is a
// separate channel from the NpcDied event on purpose: the event is bookkeeping ("the
// records should know"), the noise is a place in the world something might walk
// toward. Optional and trailing so the existing call sites compile unchanged.
std::uint32_t finalize_deaths(Registry& reg, NpcPool& pool, EventBus& bus,
                              std::uint64_t tick, NoiseField* noise = nullptr);

// Attack pass: every mob on `layer` whose cooldown has expired attacks its target
// — melee if it is in reach, or a telegraphed shot if the kind is ranged and the
// target sits between its minimum and maximum range.
//
// One function rather than a melee one and a ranged one, deliberately. The
// reference had ~60 places decrementing `attackCd` and at least one monster
// (Slepoglaz) decremented twice, doubling its own fire rate. Keeping both attack
// modes behind the single decrement makes that unrepresentable instead of merely
// absent.
//
// The target is the camera holder OR a member of the crowd, and which one is
// decided by [hunt.h] — read that file before touching the choice. The short
// version: the camera holder wins whenever it is within `kHuntRadius`, so being
// hunted as the player is unchanged, and only ~1 monster in `kHuntShare` is
// licensed to take a resident at all. That licence, not a radius, is what keeps a
// 600-monster floor from emptying its 420-body crowd in a minute — which is the
// bloodbath this whole feature was deferred over.
//
// Returns the number of swings that landed.
// `grid` is read only for the wall-adjacency test AiFlag::WallBias needs — four
// cardinal cell reads, and only for a monster actually in reach and swinging.
// `gravity` is forwarded to apply_damage so the knockback plane matches the layer.
std::uint32_t mob_attack_step(Registry& reg, const MacroGrid& grid,
                             NpcPool& pool, EventBus& bus,
                             LayerId layer, float dt, std::uint64_t tick,
                             ParticleBurstQueue* particles = nullptr,
                             const GravityField* gravity = nullptr,
                             const float* fluid = nullptr,
                             bool samosborFrenzy = false);

// Cell hazards for EMBODIED BODIES — the player and every resident.
//
// `get_cell_hazard` has always known that an electrified grate costs 15 Energy, an
// acid pool 10 and a fire cell 20. Until now the only place that damage was ever
// APPLIED was inside `mob_attack_step`'s `view<MobRef, Transform, MobCombat>`, so
// monsters burned and **nothing else did**: the player and every resident could
// stand in fire, in acid and on a live grate indefinitely and lose zero HP. That
// broke two stated laws at once — "the player is not special" (here he was special
// in his own favour) and the manifest's "100% symmetrical combat, damage, armour".
// [problems.md] §41.
//
// Same law as the monsters, deliberately: the same cell-then-floor-below probe and
// the same 1-in-16-tick cadence, so a body in fire pays 20 HP about 7.8 times a
// second whoever it belongs to. That is fast — under a second to kill an unarmoured
// 100 HP body — but it is the rate monsters have always paid, and making the two
// differ is precisely the asymmetry this closes. Flying monsters are exempt in the
// mob path; embodied bodies have no such flag and none is invented here.
//
// Two-phase, like every other damage sweep in this file: `apply_damage` can
// `emplace<Dead>` and reallocate the storage the view is walking.
//
// Returns the number of bodies that took hazard damage this step.
//
// Optional `gravity`: decides which neighbouring cell counts as "the one the body
// stands on". Null keeps the -Z probe, which is correct under the shipping NegZ
// regime and wrong under every other one.
std::uint32_t hazard_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                          LayerId layer, std::uint64_t tick,
                          ParticleBurstQueue* particles = nullptr,
                          const GravityField* gravity = nullptr);

// Optional `gravity`: the field the LOB is solved in. A ballistic launch is one
// vector equation, `v0 = delta/T - 0.5*a*T`, and the version of it that lived here
// was that solution written out in a basis where `a` is along -Z. Passing the field
// makes the frame the layer's own; passing nullptr keeps +Z and is bit-for-bit the
// pre-change path. `mob_attack_step` already holds one — it forwards the same
// pointer it gives `apply_damage`.
void spawn_projectile(Registry& reg, LayerId layer, const vec3& from,
                      const vec3& to, std::int16_t dmg,
                      std::uint16_t projSpeedMmps, Entity source,
                      std::uint8_t projType,
                      const GravityField* gravity = nullptr);

void spawn_projectile_dir(Registry& reg, LayerId layer, const vec3& from,
                          const vec3& dir, std::int16_t dmg,
                          std::uint16_t projSpeedMmps, Entity source,
                          std::uint8_t gravityPct = 100,
                          std::uint8_t channel = 0);

// Throw an explosive. A third spawner and not a flag on the second, because a
// grenade disagrees with a bullet about three of the four things a spawner decides:
// it obeys FULL gravity (a thrown weight is not a camera-aimed tracer, so there is
// no aimbot to avoid — see Projectile::gravityPct), its TTL is a FUSE that is
// authored per weapon rather than the shared 4 s backstop, and it carries a blast
// radius. Only the muzzle offset is shared.
//
// `fuseMs` becomes `Projectile::ttlMs` outright. There is deliberately no second
// timer: the fuse IS the lifetime, and a grenade that has not detonated has not
// expired. Anything else would be two clocks that can disagree — the defect
// [combat.h]'s header note calls "one cooldown decrement".
void spawn_grenade(Registry& reg, LayerId layer, const vec3& from,
                   const vec3& dir, std::int16_t dmg,
                   std::uint16_t projSpeedMmps, Entity source,
                   std::uint8_t blastDm, std::uint16_t fuseMs,
                   std::uint8_t channel = 0);

// The camera holder throws the best explosive in its inventory. Sibling of
// player_ranged_step, and NOT a branch inside it, because a throw and a shot agree
// on almost nothing: there is no magazine (the weapon IS the ammunition, so it
// leaves the inventory one item per throw), there is no reload, and the spread cone
// belongs to a barrel rather than to an arm.
//
// It DOES share `PlayerRanged::cooldownMs`, and that is a decision rather than
// reuse: a body has one pair of hands. Sharing the timer means you cannot throw a
// grenade and empty a magazine in the same instant, which is what a second
// independent cooldown would have quietly allowed.
//
// Because the cooldown is shared, the decrement must NOT be repeated here — it is
// `player_ranged_step`'s, at the top, exactly once per tick (defect 3). Call this
// AFTER player_ranged_step in the sim order, on the same tick, or the timer runs at
// half speed on any tick a throw is wanted.
//
// No `dt`, no `tick`, no `NoiseField` — the three parameters its siblings carry and
// this one would not read. A throw ages no timer of its own, needs no random seed
// (there is no spread cone: a thrown weight goes where you are looking), and is
// nearly silent; what a floor hears is the detonation, published by `projectile_step`
// three seconds later and somewhere else. An unread parameter is how a field becomes
// write-only, which is the defect both `Projectile::proj` and `RangedDef::channel`
// had to be dug out of.
//
// Returns 1 when a grenade actually left the hand.
std::uint32_t player_throw_step(Registry& reg, NpcPool& pool, LayerId layer,
                                bool wantThrow);

// Advance every shot in flight: integrate under gravity, stop on solid geometry,
// damage what it touches on contact, expire on TTL. Destroys spent projectiles.
//
// A shot hits the NEAREST thing it reaches, and asks nothing about whose it is.
// One sweep over every body and every monster on the layer; no team, no faction, no
// owner. See `Projectile` above for why the field that used to decide this is gone.
//
// The nearest, not the first: with the old split branches "first the view yields"
// was already arbitrary, and merged it would have meant a monster shields a civilian
// only when EnTT happens to order it that way.
//
// Gravity is what makes a ranged monster miss: a shot fired level from chest height
// reaches the floor in well under a second, so distance is bought with arc. The
// launch adds a vertical rate proportional to range for exactly that reason.
//
// A WEB shot (`Projectile::proj == ProjType::Web`) applies `apply_slow` to whatever
// it hits INSTEAD of damage, and is counted as a hit for it. That is the only place
// `projType` is read, and reading it is why the field exists at all — before this,
// the one authored WEB row spat a bullet with the other 68.
//
// A GRENADE (`ProjType::Grenade`) inverts both halves of the contract above, and
// that inversion is the entire feature:
//
//   * **Contact does not end it.** Solid geometry REFLECTS it — off the cell FACE it
//     actually crossed, found by sweeping the step against the three cell-boundary
//     planes and taking the earliest crossing, never off "the axis with the biggest
//     component" ([problems.md] §34, isotropy: x/y/z are equal citizens). Bodies do
//     not stop it either: a grenade is not a bullet with a bigger number, and a
//     grenade that detonated on the first shoulder it grazed would never reach the
//     floor the manifesto says it skips across.
//   * **The TTL is the fuse.** `ttlMs` reaching zero destroys a bullet and DETONATES
//     a grenade: one area sweep over every body and every monster within the blast
//     radius, damage falling off with distance, every hit through `apply_damage`
//     like every other hit in the game.
//
// The detonation sweep contains NO owner test of any kind — not the `p.source !=
// victim` one the direct-contact path above still carries for a bullet leaving a
// barrel. **The thrower is inside his own blast like anything else standing there**,
// which is ARCHITECTURE.md §Манифест п.5 in one line ("осколки бьют и владельца")
// and is the reason `Projectile::team` was deleted on 2026-08-12. `source` is read
// on this path for exactly one thing — attribution of the kill — and never to decide
// who may be hit.
//
// `noise` is an optional sink for the detonation ([noise.h] blast_noise), and it is
// the only thing on this path a monster on the far side of a wall can perceive. A
// bullet impact publishes nothing — 29 rows of small-arms fire would evict the
// 64-slot field every trigger pull — but an explosion is the loudest event in the
// game and the first severity-5 source in the tree. Optional and trailing, so every
// existing call site compiles unchanged and stays silent, bit for bit.
// Combat → geometry destruction seam ([world/destruct.h]).
//
// Combat NEVER mutates the grid. It proposes spheres (position, radius, power,
// seed); the app drains them on the sim clock behind the same doors.frozen gate
// the console `carve` row already uses. That is the whole design: one dispose
// path, many proposers (console, bullet impact, melee wall swing).
//
// Bounded POD ring, no heap — a shotgun pellet fan can enqueue several impacts
// in one step without allocating on the hot path.
inline constexpr std::size_t kMaxCarveProposals = 128;

struct CarveProposal {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    float radius = 0.0f;       // metres
    std::uint16_t power = 0;   // hardness scale ([material_props.h])
    std::uint32_t seed = 0;
};
static_assert(std::is_trivially_copyable_v<CarveProposal>,
              "CarveProposal must stay a pure POD struct");

struct CarveProposalQueue {
    CarveProposal items[kMaxCarveProposals] = {};
    std::uint8_t count = 0;
    // A refused proposal used to vanish silently — a shot that visibly hit a wall
    // and carved nothing, with no way to tell "queue full" from "degenerate radius"
    // from "bake in flight". Counted per reason so the drain site can PRINT what
    // was dropped instead of letting the miss read as a physics bug. Reset by
    // clear() together with the queue itself.
    std::uint16_t droppedFull = 0;
    std::uint16_t droppedDegenerate = 0;
    std::uint16_t droppedBake = 0;
    std::uint16_t clampedRadius = 0;

    void clear() {
        count = 0;
        droppedFull = 0;
        droppedDegenerate = 0;
        droppedBake = 0;
        clampedRadius = 0;
    }

    bool push(float x, float y, float z, float radius, std::uint16_t power,
              std::uint32_t seed) {
        if (count >= kMaxCarveProposals) {
            ++droppedFull;
            return false;
        }
        if (radius <= 0.0f || power == 0) {
            ++droppedDegenerate;
            return false;
        }
        if (radius > 8.0f) {
            radius = 8.0f; // one carve, not a demolition service
            ++clampedRadius;
        }
        items[count++] = CarveProposal{x, y, z, radius, power, seed};
        return true;
    }
};
static_assert(std::is_trivially_copyable_v<CarveProposalQueue>,
              "CarveProposalQueue must stay a pure POD struct");

// Map weapon damage onto the hardness scale. Concrete = 256; a fist (dmg 3)
// chips plaster/soil; a heavy pipe approaches a full concrete sub-voxel.
// Clamped so authored damage never invents explosive-grade power.
inline std::uint16_t carve_power_from_dmg(std::int16_t dmg) {
    if (dmg < 0) dmg = 0;
    int p = 32 + static_cast<int>(dmg) * 4;
    if (p > 512) p = 512;
    return static_cast<std::uint16_t>(p);
}

// Bullet pockmark radius (metres). Small on purpose: a round scars a wall, it
// does not open a door-sized hole. Melee uses a larger chip.
inline constexpr float kBulletCarveRadius = 0.35f;
inline constexpr float kMeleeCarveRadius = 0.55f;

std::uint32_t projectile_step(Registry& reg, NpcPool& pool, EventBus& bus,
                              LevelStack& stack, LayerId layer, float dt,
                              std::uint64_t tick,
                              StatusSet* playerStatus = nullptr,
                              Entity playerEntity = entt::null,
                              CarveProposalQueue* carves = nullptr,
                              std::vector<std::uint32_t>* stainDirty = nullptr,
                              ParticleBurstQueue* particles = nullptr,
                              NoiseField* noise = nullptr);

// The camera holder swings at whatever monster is in front of it.
//
// Symmetry with mob_melee_step is deliberate: the same apply_damage, the same
// Dead tag, the same finalize_deaths. A mob killed by the player dies through
// exactly the path a player killed by a mob does, so there is no second death
// route to forget to maintain.
//
// `wantsAttack` is edge-or-held at the caller's discretion; the cooldown is what
// bounds the rate either way. Returns true if a swing actually landed.
// The player's firearm, and the structural twin of player_melee_step: resolve the
// camera holder, attach state lazily, decrement the cooldown EXACTLY ONCE at the top
// (defect 3 above), pick the best gun in the inventory, spend one round of its ammo,
// and launch `pellets` projectiles down the camera ray inside the weapon's spread.
//
// ONE round per shot regardless of pellet count — a shotgun blast costs one shell and
// produces up to twelve projectiles, which is the reference's rule.
//
// Belongs immediately after player_melee_step in the sim order. Returns shots fired
// (0 or 1 per call; a pellet spread is one shot).
//
// `noise` is an optional sink for the gunshot ([noise.h]): a gun going off is the
// loudest event in the game and until now it was silent, so a monster that heard a
// firefight behaved exactly like one standing in a library. Optional and trailing so
// the three existing call sites — main.cpp and two tests — compile unchanged; pass
// nullptr and the shot is silent, which is the pre-noise behaviour exactly.
// Optional `status`: when non-null, spread is scaled by status_aim_mult_e3
// (SporeHaze widens the cone). Null keeps the pre-STATAIM path bit-for-bit.
std::uint32_t player_ranged_step(Registry& reg, NpcPool& pool, LayerId layer,
                                 bool wantFire, float dt, std::uint64_t tick,
                                 NoiseField* noise = nullptr,
                                 const StatusSet* status = nullptr,
                                 EventBus* bus = nullptr);

// Optional `grid` + `carves`: when a swing finds no monster in the facing cone,
// probe the cell the camera is looking at and propose a wall chip. Without both
// pointers the function is bit-for-bit the pre-CARVE path (tests compile unchanged).
// Optional `status`: when non-null, swing damage is scaled by
// status_melee_mult_e3 (Zhelemish 0.7 etc). Null keeps the pre-STATMELEE path
// bit-for-bit (tests compile unchanged).
// Optional `gravity`: forwarded to apply_damage for the knockback plane.
bool player_melee_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                       float dt, bool wantsAttack, std::uint64_t tick,
                       const MacroGrid* grid = nullptr,
                       CarveProposalQueue* carves = nullptr,
                       const StatusSet* status = nullptr,
                       ParticleBurstQueue* particles = nullptr,
                       const GravityField* gravity = nullptr);

// Current/maximum HP of an entity, wherever its HP lives. Returns false if it
// holds none. For HUD and tests.
bool entity_health(const Registry& reg, const NpcPool& pool, Entity e,
                   std::int16_t& hp, std::int16_t& maxHp);

} // namespace giga::game
