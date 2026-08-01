# RPGCMBT critique

## Verdict (short)

| Question | Answer |
|---|---|
| (a) Is RPGCMBT combat.cpp correct? | **Yes** for the scoped wire (melee dmg/CD, ranged spread/CD, identity fallback). |
| (b) Live player missing RpgStats on spawn? | **No** on primary paths (embody_as_player, death re-possess + carriedRpg, elevator restore). **Yes** on voluntary possess. |
| (c) XP-on-kill status | **Wired** in finalize_deaths via award_xp. Gated on killer having RpgStats. |
| (d) Any test pin that will red? | **No** - last run game_test EXIT=0, 219409 checks, 0 failures. Combat-wire setup can hit. |

---

## (a) combat.cpp RPGCMBT correctness

### Melee (~1210-1302)
- Damage: melee_damage(*rs, heldWeapon, wp->dmg) with heldWeapon=0 bare-hands sentinel - matches rpg.h two-branch rule.
- CD: (baseMs * agi_attack_speed_mult_e3 * str_heavy_weapon_speed_mult_e3) / 1_000_000, clamped to [1, 65535].
- Heavy gate: str_heavy_weapon_speed_mult_e3 returns 1000 when base < kHeavyWeaponCooldownMs (650). Fists are 340 ms -> STR does not speed fists (correct).
- No RpgStats -> raw table dmg/CD (identity contract preserved).
- Overflow: intermediate is uint32_t; max stays well under 2^32; cast clamp present.

### Ranged spread (~1115-1118)
- spread *= agi_ranged_spread_mult_e3(*rs) / 1000.0f on the cone - correct inverse mult, identity when absent.

### Ranged CD (~1172-1180)
- (def->cooldownMs * agi_attack_speed_mult_e3) / 1000, floor 1 / ceil 65535.
- No STR-heavy on firearms (reference: heavy gate is melee cooldown threshold only).

### Not wired (out of patch or no API)
- Ranged damage still raw def->dmg (no rpg.h gun-damage formula).
- agi_move_speed_mult_e3, str_durability_wear_mult_e3 still caller-less outside rpg.cpp.

Attr indices: Attr::{Str=0,Agi=1,Int=2}; combat only goes through named helpers - no raw wrong-slot reads.

---

## (b) Live player RpgStats spawn

| Path | Attaches RpgStats? |
|---|---|
| embody_as_player (embody.cpp:95) | **Yes** - random_rpg(pool.level(id), id) |
| Floor stream / maze / load via embody_as_player | **Yes** |
| Elevator re-embody (elevator.cpp) | **Yes** - restores pre-ride sheet if hadRpg |
| Death -> possess_a_survivor + main re-emplace carriedRpg | **Yes** (main, not the helper) |
| Voluntary possess_nearest_survivor (mind projection) | **NO** - only CameraTag/Controller; ordinary residents never had a sheet |

So RPGCMBT is not unit-green / live-dead on normal boot. It is live-dead after voluntary body hop until something else re-attaches a sheet.

possess_a_survivor itself is also naked; sole death caller paper-covers it. Fragile if reused.

---

## (c) XP-on-kill

Status: wired.

finalize_deaths (combat.cpp ~192-219):
1. Resolve victim level from MobRef or pool row.
2. If killer valid and has RpgStats:
   - mob -> xp_for_monster_kill(kind, level)
   - npc -> xp_for_npc_kill(level)
3. award_xp with optional pool HP pointers for level-up max-HP credit.

Covered by test_rpg_kill_awards_xp (50 XP Tvar, level-up on second kill, no-component silent, level-5 scale 94).

Same-tick footgun: main snapshots carriedRpg before finalize_deaths. If the player dies on the same tick they score a kill, XP is applied to the dying entity then the entity is destroyed; the pre-snapshot never saw it. Surviving killers re-snapshot after finalize (correct).

---

## (d) test_rpg_combat_wire - will it red?

No. Geometry and preload are sound:

- camera_forward(yaw=0,pitch=0) = +X; mob at {41,40,40} vs self {40,40,40} -> facing dot 1.0 >= kMeleeFacingDot 0.35.
- Fist reach: 0.5 cell * 2 m + 0.9 slack = 1.9 m > 1 m separation.
- Ranged: mag pre-filled, weapon=gun, inventory has gun+ammo so equipped_ranged stays on gun (no swap wipe).
- Attr writes use Attr::Str/Agi enum indices.
- Expected CD/dmg recomputed with the same helpers combat uses.

Evidence: shots/_rpgcmbt_test_out.txt - game_test: 219409 checks, 0 failures, EXIT=0.

MobRef{0,1,500,500} is Sborka (kind 0), not Tvar - fine for melee HP checks; kill-XP test uses explicit MobKind::Tvar.

---

## Residual live risks (priority)

1. HIGH - voluntary possess drops RPG sheet (identity combat + no XP).
2. MED - killing-blow + player death same tick loses that XP in carriedRpg.
3. LOW - move-speed / durability-wear still unwired.
4. INFO - guns ignore STR/level damage (no API yet).

## What is solid

- Formula call shapes match rpg.h.
- CD overflow/floor handled.
- Identity path keeps old table behaviour when component absent.
- Primary spawn + death carry + elevator preserve progression.
- Kill -> award_xp is the single award site (as designed).
- Suite pins green end-to-end.
