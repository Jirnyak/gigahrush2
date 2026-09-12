# Audit 09 — COMBAT / DAMAGE / SAMOSBOR (anomaly)

Repo: `/Users/jirnyak/Mirror/gigahrush2` · branch `torus` · HEAD `97bdf13e` · audited 2026-08-17
Method: every claim below was re-verified today by `grep`/`git log`/reading the file. Doc text was
treated as a hypothesis, never as evidence.

Scope LOC: combat.cpp 2414, combat.h 899, samosbor.cpp 617, samosbor.h 928, mob_behaviour.h 866,
monster_traits.h 484, destruct.cpp 359, hunt.h 164, ranged_table.h 185, noise.h 333, noise.cpp 292,
monster_traits.cpp 256, mob_behaviour.cpp 347, status.h 147, status.cpp 131, destruct.h 139,
hunt.cpp 67. **Total 8 628 LOC in scope; tests 4 241 LOC.**

---

## 0. Executive summary of classification counts

| Class | Count |
|---|---|
| DEAD (code with no reachable caller) | 14 |
| UNWIRED (system built + tested, no game call site) | 11 |
| DUPLICATE (independent damage/HP computation) | 9 |
| DEAD-DATA (column/field parsed+emitted, never read) | 21 |
| DISABLED (guard that makes a feature unreachable) | 4 |
| MAGIC-CONST (tuning number with no visible derivation) | 41 |
| ISOTROPY-VIOLATION | 6 |
| SPEC-LIE (doc/comment contradicted by code today) | 17 |

---

## 1. `combat.cpp` — section map (2 414 lines)

| Lines | Symbol | Responsibility |
|---|---|---|
| 1–38 | includes | 26 headers; pulls `sim/camera.h`, `sim/drag.h`, `world/los.h`, `world/stain.h` |
| 40–50 | `adjacent_wall` (anon) | 4 **cardinal XY** neighbours only — ISOTROPY-VIOLATION #1 |
| 52–61 | `axis(vec3&,int)` | isotropy accessor used by the grenade DDA and the ricochet |
| 63–82 | `cell_solid`, `kBounceEpsilon` | cell-level solidity probe |
| 84–169 | `grenade_advance` | miniature DDA, ≤4 crossings, reflects off the crossed face |
| 171–225 | `muzzle_point` | ray/sphere exit; the function that let `p.source != victim` be deleted |
| 227–238 | `mitigate` | flat %, clamp `[-100, +95]` |
| 240–258 | `entity_health` | HP-location resolver (MobRef vs NpcRef+pool) |
| **260–437** | **`apply_damage`** | **THE damage sink**: counterplay floor → Armour → behaviour incoming → HP → knockback impulse → blood → `Dead` tag |
| 439–652 | `finalize_deaths` | noise, bag snapshot, pool.kill, XP award, `NpcDied`, **corpse cosmetics (buggy, §6)**, corpse loot spill into Container |
| 656–959 | `mob_attack_step` | monster melee **+** monster ranged **+** monster environmental hazard, in one two-phase pass |
| 961–1022 | `hazard_step` | environmental hazard for embodied bodies (NpcRef) |
| 1024–1041 | `equipped_melee` | strict-`Equipped` read, else best-dmg scan |
| 1043–1068 | `equipped_armour` | strict read, else best-resist-sum scan |
| 1070–1099 | `sync_armour` | item resists × wear → `Armour` component |
| 1101–1208 | `spawn_projectile` | monster lob, solved in the gravity frame |
| 1210–1251 | `spawn_projectile_dir` | player bullet, flat arc (`gravityPct` 40) |
| 1253–1295 | `spawn_grenade` | thrown explosive, full gravity, fuse == ttl |
| 1297–1336 | `apply_slow` | resolve cap from victim's own top speed |
| 1338–1355 | `slow_scale` | HUD query — **UNWIRED**, see §4 |
| 1357–1390 | `slow_step` | ages + enforces the cap (x/y only) |
| **1392–1967** | **`projectile_step`** | integrate (gravity vector + air drag) → grenade bounce → TTL/fuse → victim hit → nearest-body hit → wall stop **+ ricochet** → phase-2: web slow / detonation sweep / body damage / carve / stain / particles |
| 1970–2126 | `player_ranged_step` | cooldown, reload, spread cone, N pellets, noise, wear, AGI cd |
| 2128–2193 | `player_throw_step` | spend item, throw down look ray |
| 2195–2370 | `player_melee_step` | swing, RPG scale, wear, status mult, nearest-in-cone, wall chip |
| 2374–2412 | `transfer_player_progression` | POSRPG live-to-live hop |

### 1.1 Damage paths — how many, and where they diverge

`apply_damage` **is** the single sink; that part of the header note is TRUE (verified: every
`DamageChannel::` call site in `src/` funnels into it — `grep -rn "DamageChannel::" src/`).
What is NOT single is the **damage NUMBER**. Nine independent computations exist:

| # | Path | Where the number is computed | Class |
|---|---|---|---|
| 1 | Monster melee | `combat.cpp:851–882` — `mob_hp_at_level(def.dmg,lvl)` × `behaviour_damage_mult` / `wall_bias_damage` × `facing_damage_mult` × `burst_damage_mult` | DUPLICATE |
| 2 | Player melee | `combat.cpp:2243–2281` — `MeleeDef::dmg` → `melee_damage(rpg)` → `wear_damage_scale` → `status_melee_mult_e3` | DUPLICATE |
| 3 | Player ranged | `combat.cpp:2092` — `def->dmg` per pellet, no wear/RPG scaling of DAMAGE (only of spread + cd) | DUPLICATE |
| 4 | Grenade throw | `combat.cpp:2178` — `def->dmg` raw | DUPLICATE |
| 5 | Ricochet decay | `combat.cpp:1692–1693` — `p.dmg = (p.dmg*(65|50)+50)/100` | DUPLICATE + MAGIC |
| 6 | Blast falloff | `combat.cpp:1835–1838` — `f = 1 − d/R`, floored at 1 | DUPLICATE |
| 7 | Environmental hazard | `combat.h:122–144` — hardcoded 15 / 10 / 20 per CellType | DUPLICATE + MAGIC |
| 8 | Fall / impact | `impact.cpp:34–36` — `0.5·m·v²·kImpactHpPerJoule` | the only DERIVED one |
| 9 | Samosbor seal | `main.cpp:3313` — `samosbor_unsheltered_pressure().hpDamage` (4) | DUPLICATE |

Plus two app-layer one-offs that also bypass every table:
`main.cpp:3861` (`SporeCarpet` cloud, literal `4`, channel Fire) and
`main.cpp:4973` (`ConsumeResult::hpCost`).
And `faction_relations.cpp:365–383` computes a raw + clamps to a non-lethal HP floor before calling in.

### 1.2 HP writers that bypass `apply_damage` entirely — the real breach of "one damage function"

| Site | What it does | Class |
|---|---|---|
| `main.cpp:3320–3322` | `rpg->psi -= sp.psiDamage` — the PSI half of the samosbor seal, raw subtraction | DUPLICATE |
| `main.cpp:3828` | `mr.hp = min(maxHp, mr.hp + regen)` — wet regen writes mob HP directly | DUPLICATE |
| `loot.cpp:457` | `pool.hp(selfId) = hp + healed` | DUPLICATE |
| `needs.cpp:310–312` | `hpBank` → HP, the medical ward path | DUPLICATE |
| `door.cpp:387` | `d.hp` — doors keep a **second, parallel** HP system with no `apply_damage`, no `Dead`, no `finalize_deaths` | DUPLICATE / LEGACY |

**What unification costs.** `apply_damage` already accepts `(raw, channel, source, grid, particles, gravity)`.
The missing piece is a `DamageIntent` POD carrying `{ baseDmg, channel, sourceKind, distance01, falloff }`
so paths 1–7 become table lookups + one shared modifier chain instead of seven bespoke chains. Paths 8
and 9 already produce a scalar and need nothing. The 5 bypass writers need a `heal()` sibling on the same
sink (they are negative damage). Estimated: ~120 LOC of new code, ~300 LOC deleted from the seven call sites.

---

## 2. `samosbor.h` — 928 lines of header: what is in it

**927 of 928 lines are prose + constants; there is no implementation logic in the header** beyond
6 trivial inline accessors (`samosbor_variant_def/name/name_ru/effect_ru`, `samosbor_active`) and
a POD struct set. Breakdown by measurement:

| Content | Lines | Verdict |
|---|---|---|
| Comment prose (design essays, port provenance, measured tables, warnings) | ~700 | **~76 % of the file**. Several blocks are stale (§8). |
| `inline constexpr` tuning constants (28 of them) | ~60 | belongs in the header, fine |
| POD structs (`SamosborRng/VariantDef/State/Transition/Pressure/ThreatCensus/Alarm`) | ~90 | fine |
| Function declarations | ~50 | fine |
| Inline accessors | ~25 | fine |

**Is the 7-row variant table CSV material?** The header itself argues no (`samosbor.h:226–230`:
"seven rows of five bytes is not worth a CSV"). That is defensible for the 5-byte row — but the table
has since grown **three parallel string arrays** (`kSamosborVariantNames`, `…NamesRu`, `…EffectRu`,
`samosbor.cpp:89–164`, 76 lines of hand-escaped UTF-8). That is 4 parallel arrays hand-kept in sync with
no generator and no `check_source_rules` gate — exactly the drift class the CSV gate exists for.
**Recommendation: `data/samosbor_variants.csv` + `gen_samosbor_table.py` — removes 76 LOC of \x escapes.**

### 2.1 Call chain from the game tick — VERIFIED WIRED

```
main.cpp:3256–3327   samosbor_step(samosbor, 8ms, currentFloor, sbRng)   [after controller_step]
  ├─ tr_.cycleEnded  → ++samosborCycles                          main.cpp:3262
  ├─ any edge        → fprintf "[samosbor] tick=… phase=… "      main.cpp:3273
  └─ tr_.sealed      → hermetic-door shelter scan → apply_damage + psi drain   main.cpp:3290–3326
main.cpp:2054        samosbor_new_game(sbRng)                    once per run
main.cpp:2575        samosbor_enter_floor(samosbor, floor, rng)  on every floor ride  ✓
main.cpp:2470/4781   runState.samosbor = / = runState.samosbor   save v10+ round-trip  ✓
main.cpp:4335        mob_attack_step(..., samosbor_active(st))   the frenzy flag       ✓
main.cpp:4487/4512   speech_context(..., samosbor.phase) / rumour ✓
main.cpp:5086        hctx.samosbor = &samosbor  → hud_ui.cpp:155–175                   ✓
main.cpp:229         samosbor_alarm(samosbor) → HUD banner + per-variant fog tint      ✓
```

So the **clock** is fully wired. But:

### 2.2 UNWIRED — the half of samosbor that produces monsters does not run

`samosbor_fog_tick` / `samosbor_fog_tick_at` (`mob_spawn.cpp:552`, `:719`) have **no call site
in `src/`**. Verified by exhaustive grep — the only hits outside their own definition file are
`samosbor.h` comments, `tests/suite_samosbor2.inl`, `tests/suite_samosborhud.inl`, and:

```
tools/check_wired.cmake:70:
  "samosbor_fog_tick:туманная популяция самосбора не тикает в игре; problems.md §52"
```

i.e. the project's own unwired-system gate carries an explicit **exemption row** for it.

**Consequences, all measurable:**
- `SamosborTransition::warningBegan / activeBegan / activeEnded` have **zero consumers**.
  `samosbor.h:452–454` states they are "all three consumed by `samosbor_fog_tick`". They are not.
  → **DEAD-DATA (3 fields)**.
- `samosbor_census`, `samosbor_fog_spawn_allowed`, `samosbor_threat_headroom`,
  `samosbor_threat_target`, `samosbor_allows_kind` — the entire threat-density budget — have no
  `src/` caller (verified `grep -rn … src/` → only `tools/xray_map.cpp:1001` calls `samosbor_duty01`).
  → **UNWIRED (5 functions, ~90 LOC in samosbor.cpp:552–615 + all 12 `kThreat*` constants)**.
- `SamosborState::count` is incremented (`samosbor.cpp:508`) and saved, but its **only** reader
  is `samosbor_allows_kind`, which is unwired. The `min_samosbor` column of all 68 mobs.csv rows
  is therefore **DEAD-DATA** — exactly the defect `samosbor.h:520–523` warns about, still live.
- `samosbor.h:456–464` claims: *"The fix was one line at the call site, not a change here."*
  **SPEC-LIE** — that line does not exist in `src/app/main.cpp` today.
- `samosbor.h:466–487` spends 22 lines on a "one-keyword mistake" trap in a call site that
  does not exist. **SPEC-LIE / dead prose.**

### 2.3 marko1olo's "hermetic door shelter / variant pressure / PSI drain" — verified

| Claim | Verdict | Evidence |
|---|---|---|
| Hermetic door shelter | **EXISTS and is reachable** | `main.cpp:3290–3308` scans `doors.doors`, requires `d.hermetic && d.hp>0 && (Shut\|Locked)`, cell-space radius `dx²+dy²+dz² <= 16`. `door.cpp:74–151` tags Living/Medical/Hq apartment doorways `hermetic=1`. `door.h:132` `hermetic : 1`. |
| …does anything measurable | **Partially. `problems.md:1793–1794` records that on floors whose rooms are neither Living/Medical/Hq, `room_is_hermetic` is always false and the flee is inert.** Not re-measured here per floor. |
| Variant pressure | **DOES NOTHING.** `samosbor_unsheltered_pressure(variant)` at `samosbor.cpp:538–546` opens with `(void)variant;` and returns four constants. All 7 variants return an identical struct. | `samosbor.cpp:543` |
| PSI drain | **EXISTS and is live**, but bypasses `apply_damage` — raw `rpg->psi -=` at `main.cpp:3320`. `hud_ui.cpp:94` prints it, `save.cpp:295` persists it. | verified |
| `samosbor.h:756–761` "…`psiDamage` … **nothing reads it today**" | **SPEC-LIE (stale)** — `main.cpp:3319` reads it. | |

**Magic in the shelter test:** the literal `16` at `main.cpp:3303` is a squared 4-cell radius. It
numerically equals `kSamosborFogRadiusCells²` but does not reference the constant — an undocumented
coincidence, exactly the class the owner rejects. Also `d.hermetic && d.hp > 0` uses the DOOR's
private HP pool, which nothing in the damage system can reduce (§1.2).

### 2.4 Other samosbor DEAD-DATA / dead code

| Item | Site | Verdict |
|---|---|---|
| `ThreatCensus::withLos` | `samosbor.h:812` | **written 0 always** (`samosbor.cpp:607`), read at `samosbor.cpp:555`. Gate 3 of 4 in `samosbor_fog_spawn_allowed` can never fire. **DEAD-DATA + DISABLED** (self-documented, honestly). |
| `SamosborPressure::fogRadiusCells/fogStrength` | `samosbor.h:739–740` | no reader anywhere. **DEAD-DATA** (self-documented). |
| `kSamosborFogRadiusM` | `samosbor.h:735` | no reader. **DEAD**. |
| `SamosborState::activeMs` | `samosbor.h:426` | written+read only inside `samosbor_step`. Fine. |
| `SamosborTransition::from/to/steps/changed/variant` | `samosbor.h:491–495` | no `src/` reader (only `cycleEnded`/`sealed` are read). **DEAD-DATA (5 fields)**. |
| `samosbor_phase_name` | `samosbor.cpp:228` | read by `main.cpp:5524` debug line only. |
| `samosbor_duty01` | `samosbor.cpp:195` | only `tools/xray_map.cpp:1001`. Not in the game. |

---

## 3. Dead data — CSV columns and struct fields

### 3.1 `data/weapons_melee.csv` (22 rows, 7 columns)

| Column | Parsed | Emitted | Consumed at | VERDICT |
|---|---|---|---|---|
| `item_id` | ✓ `gen_weapon_table.py` | index map | `melee_for_item` combat.cpp:1036 | LIVE |
| `dmg` | ✓ | `MeleeDef::dmg` | `combat.cpp:2243`, `:1038` | LIVE |
| `range_cells` | ✓ | `reachMm` | `combat.cpp:2283` | LIVE |
| `cooldown_s` | ✓ | `cooldownMs` | `combat.cpp:2244`, `:2249` | LIVE |
| `durability` | ✓ | `durability` | `equip.cpp:63` `item_durability` | LIVE |
| `knockback` | ✓ | `knockbackMm` | **no reader anywhere** (`grep -rn knockbackMm src/ tests/ tools/` → header only) | **DEAD-DATA** |
| `hit_radius` | ✓ | `hitRadiusMm` | **no reader anywhere** | **DEAD-DATA** |

`weapon_table.h:34` self-declares `knockbackMm` "unused by physics yet" — honest, but the value has
been dead since 2026-07-28. `apply_damage` uses a hardcoded `2.5f` impulse instead (`combat.cpp:382`).

### 3.2 `data/weapons_ranged.csv` (30 rows, 12 columns)

| Column | Parsed | Emitted | Consumed at | VERDICT |
|---|---|---|---|---|
| `item_id` | ✓ | `kRangedByItem` | `ranged_for_item` | LIVE |
| `dmg` | ✓ | `RangedDef::dmg` | `combat.cpp:2092`, `:2178` | LIVE |
| `cooldown_s` | ✓ | `cooldownMs` | `combat.cpp:2116`, `:2190` | LIVE |
| `proj_speed_cells` | ✓ | `projSpeedMmps` | `combat.cpp:2093` | LIVE |
| `pellets` | ✓ | `pellets` | `combat.cpp:2070` | LIVE |
| `spread_rad` | ✓ | `spreadE4` | `combat.cpp:2047` | LIVE |
| `magazine` | ✓ | `magazine` | `combat.cpp:2016` | LIVE |
| `ammo_item` | ✓ | `ammo` (1-based ItemId) | `combat.cpp:2020`, `ranged_is_thrown` | LIVE-but-unreachable for 23/30 rows (§4.2) |
| `reload_s` | ✓ | `reloadMs` | `combat.cpp:2030` | LIVE — but **1.000 on all 30 rows**, a constant masquerading as data |
| `proj_type` | ✓ | `projType` | `combat.cpp:1499`, `:1201`, `:1737` | LIVE (2 distinct values: normal/grenade) |
| `blast_cells` | ✓ | `blastDm` | `combat.cpp:1769`, `:2179` | LIVE (1 non-zero row) |
| `fuse_s` | ✓ | `fuseDs` | `combat.cpp:2180` | LIVE (1 non-zero row) |

**`RangedDef::channel` — DEAD-DATA, and the docs about it are false.**
There is **no `channel` / `damage_type` column in `data/weapons_ranged.csv`** (verify: `head -1`).
`gen_ranged_table.py` emits a **hardcoded literal `0`** in the 9th initialiser position
(see the format string, `RangedDef{ %d,%d,%d,%d,%d,%d,%d,%d, 0, %d,%d,%d }`).
Therefore `def->channel == 0` (Kinetic) on **all 30 rows, permanently**.

Three places assert the opposite:
- `combat.h:299–301`: *"The column exists in [ranged_table.h], the generator fills it from
  data/weapons_ranged.csv"* — **SPEC-LIE**.
- `combat.cpp:2086–2090`: same claim, verbatim — **SPEC-LIE**.
- `ranged_table.h:92` comment "`DamageChannel; Kinetic on all 30 today`" — accurate, and contradicts
  the two above inside the same repo.

### 3.3 `data/status.csv` (6 rows, 14 columns)

| Column | Emitted to | Consumed at | VERDICT |
|---|---|---|---|
| `id` | `kStatusNames` idx | `status_name` | LIVE |
| `name` | `kStatusNames` | `main.cpp` HUD | LIVE |
| `duration_ms` | `durationMs` | `status.cpp:38` | LIVE |
| `alt_duration_ms` | `altDurationMs` | `status.cpp:38` | LIVE |
| `move_mult_e3` | `moveMultE3` | `status.cpp:91` → `main.cpp:3341` | LIVE |
| `alt_move_mult_e3` | `altMoveMultE3` | `status.cpp:91` | LIVE |
| `aim_mult_e3` | `aimMultE3` | `status.cpp:98` → `combat.cpp:2053` | LIVE |
| `alt_aim_mult_e3` | `altAimMultE3` | `status.cpp:98` | LIVE |
| `root_ms` | `rootMs` | `status.cpp:126` → `main.cpp:3342` | LIVE |
| `melee_mult_e3` | `meleeMultE3` | `status.cpp:103` → `combat.cpp:2272` | LIVE |
| `heal_mult_e3` | `healMultE3` | `status_heal_mult_e3` — **NO `src/` caller** | **DEAD-DATA** |
| `water_drain_e3` | `waterDrainE3` | `status_water_drain_e3` — **NO `src/` caller** | **DEAD-DATA** |
| `gate_item` | `gateItem` | `main.cpp:3871` (SporeHaze only) | LIVE for 1 of 6 rows |
| `stacks` | `stacks` | `status.cpp:49` writes `intensityE3`; **`intensityE3` has no reader** in any query | **DEAD-DATA (column + field + `kStatusIntensityCapE3`)** |

`StatusSet::intensityE3` is written, saved (`save.cpp:321`), loaded — and never read by
`status_move/aim/melee/heal/water/is_rooted`. It is a persisted no-op.

### 3.4 `data/monster_traits.csv` (21 rows, 17 columns)

| Column | Emitted to | Consumed at | VERDICT |
|---|---|---|---|
| `idx`,`id` | row index/kind | `monster_traits_rows_indexed` (tests only) | LIVE (structural) |
| `resist_kinetic..resist_psi` | `MonsterTraits::resist[5]` | `sync_monster_armour` ← `main.cpp:1059` | **LIVE for `resist_kinetic` only** — the other 4 channels can never be delivered (§4.1) |
| `terrain` | `terrain` | `trait_allows_wet_spawn` — **no `src/` caller** | **DEAD-DATA** |
| `wet_move`,`dry_move` | `wetMoveX100/dryMoveX100` | `trait_move_mult` — **no `src/` caller** | **DEAD-DATA (2 cols)** |
| `wet_dmg`,`dry_dmg` | `wetDmgX100/dryDmgX100` | `trait_damage_mult` — **no `src/` caller** | **DEAD-DATA (2 cols)** |
| `wet_incoming` | `wetIncomingX100` | `trait_incoming_mult` — **no `src/` caller** | **DEAD-DATA** |
| `wet_regen_hps` | `wetRegenMilliHps` | `main.cpp:3824` ✓ | LIVE (1 authored row: LOTOCHNIK) |
| `vuln_channel`,`vuln_floor_pct` | `vulnChannel/vulnFloorPct` | `trait_counterplay_damage` ← `combat.cpp:274` — **called, but unreachable** (§4.1) | **DISABLED** |
| `bait` | `baitMask` | `trait_takes_bait`/`_any` — **no `src/` caller** | **DEAD-DATA** |
| `ref` | (comment only) | — | documentation column, fine |
| `authored` (derived) | `authored` | `monster_trait_authored_count` — tests only | **DEAD-DATA** |

**11 of 17 columns dead.** Verified by:
`grep -rn "trait_move_mult\|trait_damage_mult\|trait_incoming_mult\|trait_takes_bait\|trait_allows_wet_spawn\|cell_wet\|trait_has_vulnerability\|monster_traits_unauthored_reason" src/ --include='*.cpp'` → **0 hits**.

### 3.5 Struct fields — written-never-read / read-never-written

| Field | File:line | Class |
|---|---|---|
| `MeleeDef::knockbackMm` | `weapon_table.h:34` | written-never-read |
| `MeleeDef::hitRadiusMm` | `weapon_table.h:35` | written-never-read |
| `RangedDef::channel` | `ranged_table.h:92` | written-constant-0, read but always Kinetic |
| `StatusSet::intensityE3[6]` | `status.h:107` | written-never-read (but saved) |
| `SamosborTransition::from/to/steps/changed/variant` | `samosbor.h:491–495` | written-never-read in `src/` |
| `SamosborTransition::warningBegan/activeBegan/activeEnded` | `samosbor.h:496–499` | written-never-read in `src/` |
| `SamosborPressure::fogRadiusCells/fogStrength` | `samosbor.h:739–740` | written-never-read |
| `ThreatCensus::withLos` | `samosbor.h:812` | read-never-written-nonzero |
| `MonsterTraits::terrain/wetMove/dryMove/wetDmg/dryDmg/wetIncoming/baitMask/authored` | `monster_traits.h:204–216` | written-never-read (8 fields) |
| `Corpse::searched` | `combat.h:197` | set once; only reader is the interact path — verify separately (out of scope) |
| `Noise::pad_` | `noise.h:31` | padding, fine |

---

## 4. Unwired / unreachable content

### 4.1 Damage channels — 3 of 5 are unproducible

| Channel | Producer today | Verdict |
|---|---|---|
| `Kinetic` | everything | LIVE |
| `Buckshot` | **nothing** — `RangedDef::channel` is 0 on all 7 shotguns | **UNWIRED** |
| `Energy` | `get_cell_hazard(kMatElectricGrate)` → `combat.h:127`. Grate IS placed: `padic_gen.cpp:329`. | LIVE (geometry only) |
| `Fire` | `get_cell_hazard(kMatFireCell)` — **`kMatFireCell` is never written by any generator** (`grep -rn kMatFireCell src/` → materials.h + combat.h + tests only). Plus **`main.cpp:3861`**, SporeCarpet cloud, which targets **only `player`**. | **effectively UNWIRED** |
| `Psi` | **nothing** — `grep -rn "DamageChannel::Psi" src/` → only `combat.cpp:403` (the *guard* `ch != Psi`) and prose | **UNWIRED**; `combat.cpp:403`'s Psi branch is dead code |

**Cascade:** `trait_counterplay_damage` (`combat.cpp:274`) requires `channel == Fire` **and** a
`MobRef` target. The one Fire producer hits `player` (an `NpcRef`). Therefore the fire counterplay for
BORSHCHEVIK / BLOOD_PLANT / FOG_SHARK / SWARM **cannot fire in a real session**. `monster_traits.h:101–103`
says exactly this and was correct; it is still correct after `main.cpp:3861` was added, because that
call cannot reach a monster. → **DISABLED**.

Same cascade for `kMatAcidPool`: never placed → the `Acid 10 Kinetic` row of `get_cell_hazard` is
**DEAD** (`combat.h:130–134`).

### 4.2 Weapons that can occur — measured against `data/items.csv`

Computed today from `spawn_w_milli`, `spawn_rooms` and `container.cpp:74–100` / `:213–232`:

| Set | Count | Note |
|---|---|---|
| Melee rows in the table | 21 (+fists) | |
| …with `spawn_w_milli > 0` | **20** | **`tracked_zhernov` (96 dmg — the strongest melee weapon in the game) has weight 0 and no craft/loot row → UNREACHABLE** |
| Ranged rows | 30 | |
| …with `spawn_w_milli > 0` | **23** | unreachable: `ak47`, `machinegun`, `p41_heavy_mg`, `tanev_svt40`, `ptrs_liquidator`, `gauss`, `plasma` |
| **AMMO items with `spawn_w_milli > 0`** | **0 of 17** | **every ammo row is weight 0 with an empty `spawn_rooms`** |

**The ammo economy is a single hardcoded item.** Because all 17 AMMO rows are weight 0,
`item_weight_on_floor` (`item_table.cpp:3158`) returns 0 for every one of them, so `build_pool`
(`container.cpp:74–100`) never puts ammo in any container. The **only** ammo source in the world is
the WeaponCrate forced-slot at `container.cpp:213–232`, which picks *the cheapest AMMO with
`value <= cap` and `stackMax >= 8`* — deterministically **`ammo_9mm`** (value 3, stack 255;
verified against `data/items.csv`).

Consequence: **6 of 30 firearms are loadable in a real session** (`makarov`, `homemade_pistol`,
`karkarov_pistol`, `zatychkin_pistol`, `ppsh`, `slyoznev_pps41` — the 9mm family), plus `grenade`
(its own ammo, weight 1000/STORAGE) and `gauss`/`plasma` **only** via the T3 craft unlock of
`ammo_energy` — but both those guns have spawn weight 0, so neither can be held.
**23 of 30 ranged rows are UNWIRED content.**

`combat.cpp:2028` `if (got == 0) return 0; // out of ammo entirely` is where every one of them stops.

### 4.3 Statuses that can actually land

| Status | Applied by | Verdict |
|---|---|---|
| `PaupsinaWeb` | `combat.cpp:1744` (web projectile onto the camera holder) | LIVE |
| `SporeHaze` | `main.cpp:3884` (SporeCarpet cloud) | LIVE |
| `ZhelemishSkin` | **only** `main.cpp:3758` — inside the `shotAction == "status"` **screenshot-harness branch** | **UNWIRED in gameplay** |
| `GovnyakRelief` | **nothing** | **UNWIRED** |
| `GovnyakCough` | **nothing** | **UNWIRED** |
| `GovnyakDebt` | **nothing** | **UNWIRED** |

And the three govnyak rows carry `move=1000, aim=1000, melee=1000, heal=1000, water_drain=0, root=0`
— **even if applied they change nothing measurable**; their only distinguishing column is `stacks=1`,
which feeds `intensityE3`, which nothing reads (§3.3). **3 of 6 status rows are pure DEAD-DATA.**

### 4.4 Other unwired symbols in scope

| Symbol | Site | Evidence |
|---|---|---|
| `slow_scale` | `combat.cpp:1338` | declared "For the HUD"; **0 callers in `src/`**, 6 in `tests/suite_eventsweb.inl` |
| `carve_at` | `destruct.cpp:337` | "the pickaxe primitive" — **0 callers in `src/`**, tests only |
| `set_sub_material` | `destruct.cpp:262` | "Генератор красит" — **0 callers in `src/`**, tests only |
| `noise_distance` | `noise.h:253` | 0 external callers |
| `noise_audible` | `noise.h:258` | 0 external callers |
| `NoiseSource::Footstep/Door/Siren/Decoy` | `noise.h:89–96` | self-declared "reserved"; `Melee` also has no publisher in `combat.cpp` |
| `trait_move_mult/damage_mult/incoming_mult/takes_bait/takes_bait_any/allows_wet_spawn/cell_wet/has_vulnerability/unauthored_reason` | `monster_traits.cpp` | 0 `src/` callers (9 functions) |
| `samosbor_fog_tick`, `_at`, `_census`, `_fog_spawn_allowed`, `_threat_headroom`, `_threat_target`, `_allows_kind` | §2.2 | 0 `src/` callers (7 functions) |
| `behaviour_hurt_move_mult` (CrowdShove) | `mob_behaviour.cpp:259` | self-documented at `mob_behaviour.cpp:333`: *"whose every answer comes from a function with no caller in src/"* |
| `MobBehaviour::Melee / WeakWallBreach / RangedClause / SourceSwarm` | `mob_behaviour.cpp:268–289` | declared dead by `behaviour_is_dead` — 4 enumerators |

---

## 5. Disabled & magic

### 5.1 Disabled / gating guards

| Site | Guard | Effect |
|---|---|---|
| `samosbor.cpp:543` | `(void)variant;` | all 7 variants produce identical unsheltered pressure — **variant pressure is a no-op** |
| `samosbor.cpp:607` | `withLos` left 0 | LOS gate 3 of 4 in `samosbor_fog_spawn_allowed` never fires |
| `combat.cpp:799` | `if (def.dmg == 0 && !control) continue;` | the fix that unblocked PAUPSINA — **currently correct**, listed because it is the shape that killed the web-spitter once |
| `combat.cpp:1640` | `p.dmg >= 4` on the ricochet | any bullet under 4 damage cannot ricochet; **`ppsh` (8), `slyoznev_pps41` (7), `granit4u` (8)** are the low end. Threshold is undreived. |
| `combat.cpp:1678` | `cosInc > 0.01f && cosInc < maxCos` | the ricochet window; `maxCos` 0.55/0.40 undreived |
| `combat.cpp:2404` | early `return;` in `transfer_player_progression` | intentional and commented; not a defect |

No `#if 0` and no `if (false)` anywhere in scope (verified).
**No `p.source != victim`-style exclusion guard remains** — verified: the only `source` reads in
`projectile_step` are attribution (`h.source` at `:1849`, `:1876`, `:1906`). The header's claim on this
is TRUE.

### 5.2 MAGIC-CONST — tuning numbers with no visible derivation

Numbers whose comment either gives no derivation or asserts a measurement that is not reproducible
from the code:

| # | Value | Site | Note |
|---|---|---|---|
| 1 | `15` / `10` / `20` HP | `combat.h:126,131,136` | hazard damage per material — **no comment at all** |
| 2 | `12.0f` m | `combat.h:98` | power-cut radius |
| 3 | `0.40f` m | `combat.h:94` | shield mount offset |
| 4 | `128` | `combat.h:62` | `kMaxDestroyedShields` |
| 5 | `95` / `-100` | `combat.cpp:231–232` | resist clamp |
| 6 | `2.5f` | `combat.cpp:382` | knockback impulse — "the historical flat 2.5" (a legacy value, not derived) |
| 7 | `0.45f` | `combat.cpp:411` | blood upward bias |
| 8 | `0.8f` | `combat.cpp:419` | blood away-component |
| 9 | `0.9f` | `combat.cpp:424` | blood chest offset |
| 10 | `2 + applied/3`, cap `18` | `combat.cpp:422,426` | blood particle count |
| 11 | `0.18f` | `combat.cpp:541` | corpse flatten half-extent |
| 12 | `0.75f` / `0.55f` | `combat.cpp:542` | corpse extend |
| 13 | `0.45f` | `combat.cpp:545` | corpse sink |
| 14 | `0.35/0.35/0.40` | `combat.cpp:549` | corpse tint |
| 15 | `2.2f` | `combat.cpp:645` | corpse `Interactable` radius |
| 16 | `15u` / `50u` | `combat.cpp:689` | samosbor frenzy % (comment says "~15%" then admits it lands at 12.5%) |
| 17 | `% 16` | `combat.cpp:757`, `:1014` | hazard cadence |
| 18 | `12.0f` | `combat.cpp:1114`, `:1215`, `:1259` | projectile speed fallback, **triplicated** |
| 19 | `0.6f` | `combat.cpp:1187` | muzzle chest height |
| 20 | `0.1f` | `combat.cpp:1173` | point-blank travel floor |
| 21 | `0.05f` | `combat.cpp:203` | `muzzle_point` clearance epsilon |
| 22 | `0.55f` / `0.40f` | `combat.cpp:1677` | ricochet `maxCos` (steel/other) |
| 23 | `0.55f` / `0.40f` | `combat.cpp:1679` | ricochet restitution |
| 24 | `0.85f` / `0.70f` | `combat.cpp:1680` | ricochet friction |
| 25 | `180` | `combat.cpp:1675` | "hard" material hardness threshold |
| 26 | `65` / `50` | `combat.cpp:1693` | ricochet damage retention % |
| 27 | `0.02f` | `combat.cpp:1688` | ricochet push-off |
| 28 | `0.6f` | `combat.cpp:1702` | ricochet carve radius scale |
| 29 | `12` / `6` | `combat.cpp:1706` | ricochet spark count |
| 30 | `24` / `18` | `combat.cpp:1886–1888` | detonation spark/debris counts |
| 31 | `4 + dmg/4`, cap `12` | `combat.cpp:1934,1944` | wall-spark count |
| 32 | `1.6f`, `rays=10` | `combat.cpp:1957` | stain splat |
| 33 | `0.5f` | `combat.cpp:2081` | spread cone half-factor |
| 34 | `8` | `combat.cpp:2320` | melee wall-probe steps |
| 35 | `32 + dmg*4`, cap `512` | `combat.h:827–828` | `carve_power_from_dmg` |
| 36 | `8.0f` | `combat.h:811` | carve radius clamp |
| 37 | `0.35f` / `0.55f` | `combat.h:834–835` | bullet/melee carve radius |
| 38 | `6.0f` | `combat.h:422` | `kProjGravity` — "lighter than the world's so a shot arcs readably" |
| 39 | `0.38/0.72/0.55` | `combat.h:445–447` | grenade restitution/friction/rest — "measured against the thing it must produce", the measurement is not in the tree |
| 40 | `16` | `main.cpp:3303` | hermetic shelter radius² (cells²) — equals `kSamosborFogRadiusCells²` but does not say so |
| 41 | `4` / `2.15f` / `%40` and `0.40f` / `1200` / `14.0f` / `%250` | `main.cpp:3844–3861`, `:3835–3845` | SporeCarpet + Lampoglaz abilities, entirely hand-authored in the app loop |

Samosbor's own constants are, by contrast, mostly **derived and shown** (`samosbor.h:88–168` cites
`desdoc.md:439`, code line numbers, and carries `static_assert`s tying `kSamosborCooldownFloorMs`
to its three summands). Exceptions: `kSamosborAftermathMs` (12 s, self-labelled "AUTHORED HERE, not
measured"), `kSamosborJitter` 0.25, `kSamosborBeatImpact/Seal/ClearMs` (4/3/4 s, self-labelled
authored), and the four `kThreatBackoff*` values (cited to `balance.md:510`, unverifiable here).
`kHuntShare` 32 (`hunt.h:131`) is explicitly "the only number here with no derivation — it was
MEASURED" and ships a measurement table. That is the standard the rest of the file should meet.

---

## 6. Physics coupling — Mass/Impact and isotropy

### 6.1 The Mass/Impact seam is honoured, once

`impact.cpp:34–40` is the only place `E = ½mv²` appears, and it routes through `apply_damage`.
`impact.h:31–37` documents both constants (`kImpactFreeSpeed` 6.5 derived from the jump arc,
`kImpactHpPerJoule` 0.05 calibrated on a 70 kg body). **This is the model the rest of combat should
follow.**

`apply_damage`'s knockback (`combat.cpp:376–384`) also honours it: `impulse = 2.5 * (67.4 / mass)`,
i.e. `p = m·v` normalised at `kKnockbackRefMassKg`. Correct in form.
**But `MeleeDef::knockbackMm` is ignored** (§3.1): a sledgehammer (0.65) and a knife (0.10) deliver
identical knockback. The authored column exists; the code invents a flat 2.5.

`projectile_step` correctly applies `air_drag_step`/`drag_q` (`combat.cpp:1486–1493`) — projectiles
obey the same drag law as bodies. Good.

### 6.2 ISOTROPY-VIOLATIONS found

| # | Site | Violation |
|---|---|---|
| 1 | `combat.cpp:46–49` `adjacent_wall` | probes `±x, ±y` only. **`±z` is never tested.** `WallBias`, `WallBrace` and `DebrisLurker` therefore see a floor/ceiling as open air. Under any non-NegZ `GravityRegime` the function tests two walls and the floor-normal axis is skipped entirely. |
| 2 | `combat.cpp:540–546` `finalize_deaths` corpse | **Y-up legacy.** Reads `aabb->half.y` as "height", flattens **Y** to 0.18 and extends **Z** "along floor" — but bodies are Z-up (`embody.cpp:55` `AABB{{0.4f, 0.4f, hh}}`; `mob_spawn.cpp:141` "the body sits `half.z` above the cell floor"). It squashes a horizontal axis and stretches the vertical one. `tr->pos.y -= 0.45f` then moves the corpse **sideways**, not down. Introduced by marko1olo `f0a35997` "§21 corpse ragdoll dynamics". |
| 3 | `combat.cpp:1957` | `stain_splat(..., vec3{0,0,-0.35f}, ...)` — blood splat direction hardcoded to −Z while the sparks two lines above (`:1938–1941`) correctly read the gravity field. Same function, two frames. |
| 4 | `combat.cpp:1885–1888` | detonation spark/debris pushed along `{0,0,1}` / `{0,0,0.5}` regardless of gravity |
| 5 | `combat.cpp:1382–1386` `slow_step` | clamps `v.x, v.y` only; correct **only** under NegZ. Self-documented ("z untouched: a slow is not reduced gravity") but the argument assumes z is up. |
| 6 | `combat.h:94` `PowerGridState::is_power_cut` | `sz * kCellSize + 0.40f` — the mount offset is hardcoded to +Z; comment admits "Z-up" as an assumption |

Correctly isotropic (credit where due): `grenade_advance` (`combat.cpp:95–169`, axis loop),
the ricochet normal (`combat.cpp:1647–1663`, plane sweep), `spawn_projectile`'s lob
(`combat.cpp:1145–1175`), `apply_damage`'s knockback plane (`combat.cpp:360–368`) and blood frame
(`combat.cpp:405–410`), `hazard_step`'s floor probe (`combat.cpp:998–1008`),
`mob_attack_step`'s hazard probe (`combat.cpp:744–752`).

---

## 7. Authorship

`git log --format='%an' -- <file> | sort | uniq -c`, run today:

| File | Jirnyak | marko1olo | Origin commit |
|---|---|---|---|
| `combat.cpp` | 24 | **36** | `bb6fd89b marko1olo 2026-07-28 feat(game): combat — the floors are dangerous, and death is not a special case` |
| `combat.h` | 18 | **20** | same day, same author |
| `samosbor.cpp` | 1 | **3** | `04e3e3ca marko1olo 2026-07-28 feat(game): samosbor — the depth-scaled pressure clock that makes descending frightening` |
| `samosbor.h` | 0 | **3** | same — **100 % marko1olo** |
| `monster_traits.cpp` | 0 | **1** | `6b75c984 marko1olo 2026-07-29 feat: Implement economy, monster traits, and cellular simulation, update shaders and ai` |
| `monster_traits.h` | 1 | 1 | same |
| `mob_behaviour.h` | 0 | **4** | `5badfb16 marko1olo 2026-07-28` |
| `mob_behaviour.cpp` | 1 | **3** | same |
| `noise.h/.cpp` | 1 | 1 | `29b43ecb marko1olo 2026-07-29 feat(game): noise as information` |
| `hunt.h` | 1 | **2** | `6a0c61ce marko1olo 2026-07-28 feat(game): monsters hunt the residents too — 418 of 420 alive after a minute` |
| `status.h/.cpp` | 1 | 1 | `138068b6 marko1olo 2026-07-30` |
| `ranged_table.h` | 2 | 1 | `0fa06bea marko1olo 2026-07-28 feat(game): the player can shoot back — 29 firearms, and two suicides prevented before they shipped` |
| `data/weapons_melee.csv` | 1 | 1 | `574fbc62 marko1olo 2026-07-28` |
| `data/weapons_ranged.csv` | 1 | 1 | `0fa06bea marko1olo` |
| `data/status.csv` | 0 | **1** | `138068b6 marko1olo` |
| `data/monster_traits.csv` | 1 | 1 | `6b75c984 marko1olo` |
| `destruct.cpp/.h` | **2** | 0 | `3c04a2d8 Jirnyak 2026-07-31` — the one clean module in scope |

**Every file in this audit except `destruct.*` and `impact.*` was created by `marko1olo`.**
`combat.cpp` is majority-marko1olo by commit count despite the recent Jirnyak work.

Suspicious commit subjects (verbatim):
- `c9bb8bf8 / 3cd15d8d / 13da4ac1 marko1olo 2026-08-01 "chore: Overseer 15-min auto-push sweep [2026-08-01 20:45]"` — three automated timestamp sweeps that touched `combat.cpp`. Machine-generated commits into a damage system.
- `f0a35997 marko1olo 2026-08-02 "feat(s21/ui): implement §21 corpse ragdoll dynamics and Retro-Pixel VHS/CRT UI Mandate (Интерфейс це важно)"` — the corpse-flatten Y-up bug (§6.2 #2) landed here, bundled with an unrelated UI rewrite.
- `79f860a3 marko1olo 2026-07-31 "RPGCMBT: wire RPG melee/ranged formulas into combat (+22 checks)"` — landed the `static int rpgcmbtLog` + `fprintf(stderr)` at `combat.cpp:2253–2263`, which is a **process-lifetime mutable static in a headless library** and directly contradicts `combat.cpp:1799`'s own claim that *"`giga_game` holds no `getenv` anywhere on purpose — it stays headless and pure"*.
- `05d710db marko1olo 2026-07-31 "feat(gameplay): persistent corpses & tactical looting, keycard security doors, electrical shield power-cut sabotage"` — three unrelated subsystems in one commit; `PowerGridState` (combat.h:65–105) is a lighting concern living in the combat header.
- `bd4db773 marko1olo 2026-07-29 "feat: seven dead subsystems wired, a save format, and a quantization bug that had silently deleted a monster"` and `7ce71d54 "feat: six more subsystems connected"` — the two commits that wrote the "wired" claims in `samosbor.h` that §2.2 shows are false today.
- `f438969b marko1olo 2026-07-28 "feat(combat): ranged monsters — 13 kinds that had the data and never fired"` — accurate (13 verified against `data/mobs.csv`).

---

## 8. Doc-vs-code spot checks

### 8.1 `destruct.md` (165 lines) — 10 claims

| # | Line | Claim | Verdict |
|---|---|---|---|
| 1 | 10–11 | "Кирка, пуля, взрывчатка, **самосбор**, **монстр, грызущий стену**" all express as carve | **FALSE.** `carve_at` (the pickaxe) has 0 `src/` callers; nothing in samosbor proposes a carve; no monster carves. Real proposers: console, bullet impact, **bullet ricochet** (undocumented), melee wall swing, grenade detonation. |
| 2 | 23 | `удалён ⇔ (hash & 0xFFFF) * hardness < power << 16` | **TRUE** — matches `destruct.cpp` `carve_roll`. |
| 3 | 41 | "Генератор красит `set_sub_material()`" | **FALSE.** 0 callers in `src/` (only `tests/suite_destruct.inl`, `tests/suite_saveload.inl`). No generator paints layers. |
| 4 | 68 | "их судьба принадлежит sandpile-правилам (`[sim/cellular.h]`)" | **FALSE.** `src/sim/` contains no `cellular.h` (`ls src/sim/` → camera, controller, diffusion, drag, fluid, physics). `destruct.h:37–38` even says the module "was deleted 2026-08-10 as dead code" — the .md was never updated. |
| 5 | 77 | Render owes `voxelMirror.mark_dirty(dirtyCells)` | **TRUE** — `main.cpp:4036`, `:4392`. |
| 6 | 80 | Props owe `anchor_validate_step()` | **TRUE** — `main.cpp:4053`, `:4407`, `:6747`. |
| 7 | 81 | Антураж owes `antourage_carve_step()` | **TRUE** — `main.cpp:4062`, `:4414`, `:6754`. |
| 8 | 79 | Nav: "потребителя нет (2026-08-06)" | **TRUE** as written. |
| 9 | 93–98 | Proposer table (console / bullet / melee / grenade) | **INCOMPLETE.** Missing the ricochet chip proposer (`combat.cpp:1699–1702`, radius `kBulletCarveRadius*0.6`). |
| 10 | 98,103 | grenade carve = `0.35 × 5.0 = 1.75 m`, power 392 at dmg 90; `kMaxCarveProposals = 128` | **TRUE** — `blast_cells 2.5` × 2 m/cell = 5.0 m R (`ranged_table` blastDm 50 dm); `carve_power_from_dmg(90) = 32 + 360 = 392`; `combat.h:767`. |

**3 FALSE, 1 INCOMPLETE of 10.**

### 8.2 `monsters.md` (166 lines) — 10 claims

| # | Line | Claim | Verdict |
|---|---|---|---|
| 1 | 23 vs 25 | "**68 monster kinds**" … then "69 is what the reference's enum … all agree on" | **SELF-CONTRADICTORY.** `mob_table.h:47` `static_assert(kMobKindCount == 68)`. The "69" is wrong — and it has propagated: `combat.h:284,301`, `combat.cpp:900`, `monster_traits.h:69,91,398`, `samosbor.h:386,899,906` all say 69. |
| 2 | 37 | "The whole table is 2,208 B" | **FALSE.** `sizeof(MobDef) == 44` (`mob_table.h:214`) × 68 = **2 992 B**. (`samosbor.h:194` says 2 484 B — also false; `monster_traits.h:194` says 1 656 B for a 24-byte × 68 table = **1 632 B** — also false.) |
| 3 | 46 | "23 of 69 kinds are `Plain`" | **FALSE.** `data/mobs.csv` has **22** rows with `behaviour == Plain`, out of 68. |
| 4 | 76 | "`CREATOR` and `PSEUDOLIFT` carry weight 0" | **TRUE** — verified against `data/mobs.csv` (exactly those two). |
| 5 | 88–90 | "`test_hunt_all` … ten simulated minutes leave **361 survivors, 59 dead, 14%**" | **FALSE / STALE.** `tests/suite_hunt.inl:437–449` records that number as historical and now asserts `survivors >= 380` with a measured **417**. |
| 6 | 93–94 | "A monster's projectile can hit a resident too (**`Projectile::team == 0`**)" | **FALSE.** `Projectile::team` was deleted 2026-08-12; `combat.h:263–282` is a 20-line note saying so. |
| 7 | 110–112 | "the four with speed 0 — IDOL, BORSHCHEVIK, KANTSELYARSKIY_IDOL, BLOOD_PLANT" | **TRUE** — exactly those four in `data/mobs.csv`. |
| 8 | 116–121 | "**Nothing heals a crowd body** … `needs.h` ticks the camera holder's row alone" | **FALSE / STALE.** `ai.cpp:735` `pool.needs(oid).hpBank += kMedicHealPerSec*dt` (Medic role, another body), `needs.cpp:310–312` converts it. `hunt.h:40–43` records the correction; `monsters.md` was not updated. |
| 9 | 128–130 | "The 13 `Ranged` kinds honour `shotRangeMm`/`minRangeMm`/`windupMs`" | **TRUE** — 13 rows with `shot_range_cells > 0`, honoured at `combat.cpp:900–921`. |
| 10 | 133–135 | "**27 of the 47 enumerators still read as `Plain`**" | **TRUE** — `behaviour_is_dispatched` returns true for 20; `behaviour_is_dead` for 4; 47 − 20 = 27. |
| 11 | 139–140 | "only the samosbor fog spawner deliberately ignores [MobPackMode]" | **MISLEADING** — the fog spawner never runs at all (§2.2). |
| 12 | 122 | "65 of the 68 kinds have *no* loot table" | **TRUE** — 3 rows with `has_loot_table == 1`. |

**6 FALSE/stale + 1 self-contradictory + 1 misleading of 12.**

---

## 9. Deletion proposal — ranked

### DELETE (safe today; nothing in `src/` reads them)

| Rank | Target | LOC | Why |
|---|---|---|---|
| 1 | `samosbor.h` prose bloat: the fog-tick contract essays (`:436–489`, `:586–612`), the SamosborState measurement table (`:377–423`), the pack/roster relaxation essay (`:887–925`) | ~180 | describes a call site that does not exist; keep a 6-line pointer to `problems.md §52` |
| 2 | `MonsterTraits` dead columns (terrain, wetMove, dryMove, wetDmg, dryDmg, wetIncoming, baitMask, authored) + their 9 accessor functions + 11 CSV columns + `BaitBit`/`TerrainPref` enums | ~200 (h) + ~130 (cpp) + ~140 (traits.h prose) | 0 `src/` callers in 12 months |
| 3 | `data/status.csv` govnyak rows ×3 + `heal_mult_e3` + `water_drain_e3` + `stacks`/`intensityE3`/`kStatusIntensityCapE3` | ~40 + a save-format field | never applied, never read |
| 4 | `PowerGridState` (`combat.h:56–105`) → move to `render/` or `world/` | 50 | not damage; a lighting concern squatting in the combat header |
| 5 | `MeleeDef::knockbackMm` + `hitRadiusMm` + their CSV columns | ~10 | never read since 2026-07-28 |
| 6 | `slow_scale`, `carve_at`, `set_sub_material`, `noise_distance`, `noise_audible` | ~90 | 0 `src/` callers (keep `carve_at` if a pickaxe is planned; then WIRE it) |
| 7 | `combat.cpp:2253–2263` `static int rpgcmbtLog` + `fprintf(stderr)` | 12 | mutable static + stderr in a headless library; violates the file's own stated law |
| 8 | `SamosborTransition` fields `from/to/steps/changed/variant` + the 3 edge flags — **only after** deciding fog-tick's fate | 10 | |
| 9 | `get_cell_hazard` `kMatAcidPool` arm | 5 | material never placed |

**DELETE subtotal ≈ 870 LOC.**

### MERGE

| Rank | Target | Into | LOC saved |
|---|---|---|---|
| 1 | Nine damage-number computations (§1.1) | one `DamageIntent` + one modifier chain feeding `apply_damage` | ~300 net |
| 2 | Five HP writers that bypass `apply_damage` (§1.2) | an `apply_heal` sibling on the same sink | ~60 |
| 3 | Three `speed < 1.0f → 12.0f` fallbacks (`combat.cpp:1114, 1215, 1259`) | one `projectile_speed(mmps)` helper | ~6 |
| 4 | `spawn_projectile` / `_dir` / `spawn_grenade` | one spawner taking a `ProjectileSpec` POD | ~60 |
| 5 | 4 hand-kept parallel samosbor variant arrays | `data/samosbor_variants.csv` + generator | ~76 |
| 6 | `hazard_step` + the hazard block inside `mob_attack_step` (`combat.cpp:738–761`) | one hazard pass over `MobRef|NpcRef` | ~40 |
| 7 | `main.cpp:3817–3890` SporeCarpet/Lampoglaz/wet-regen app-loop abilities | `mob_behaviour` / `monster_traits` data rows | ~80 out of `main.cpp` |
| 8 | Two `--shot`-harness-only paths (`main.cpp:3752–3774` status apply) | a console command | ~25 |

### KEEP (well-built, derived, correctly wired)

- `apply_damage` + `finalize_deaths` — the two-defect design is real and holds. **Fix the corpse block (§6.2 #2) rather than deleting it.**
- `impact.cpp` / `impact.h` — the only fully derived damage law in the tree; the model for the rest.
- `grenade_advance` + the ricochet normal solve — genuinely isotropic, worth the LOC.
- `muzzle_point` — the arithmetic that let the last exclusion guard be deleted.
- `hunt.h` — `kHuntShare` ships its measurement table; the design is correct.
- `destruct.cpp` / `destruct.h` — the only Jirnyak-only module in scope; clean.
- The samosbor **clock** (`samosbor_step`, the depth curve, `samosbor_enter_floor`, `samosbor_alarm`) — wired, saved, HUD-visible, `static_assert`-pinned.

### Sketch — the unified damage pipeline

```
struct DamageIntent {                    // POD, ~24 B
    std::int16_t     base;               // from ONE table lookup, never inline
    DamageChannel    channel;
    Entity           source;
    std::uint8_t     falloff;            // 0=none 1=linear(blast) 2=ricochet-decay
    float            distance01;         // for falloff==1
    const GravityField* gravity;
};

// ONE modifier chain, in ONE order, applied ONCE:
//   base
//   → weapon wear            (wear_damage_scale)
//   → attacker RPG           (melee_damage / agi_*)
//   → attacker status        (status_melee_mult_e3)
//   → behaviour outgoing     (behaviour_damage_mult, facing, burst, wall_bias)
//   → falloff                (linear blast | ricochet retention)
//   ────────── apply_damage(intent) ──────────
//   → defender counterplay   (trait_counterplay_damage)
//   → defender armour        (mitigate)
//   → defender behaviour     (behaviour_incoming_mult)
//   → defender terrain       (trait_incoming_mult  ← currently unwired, gets a home here)
//   → HP  →  Dead  →  finalize_deaths
DamageResult apply_damage(Registry&, NpcPool&, Entity target, const DamageIntent&);
DamageResult apply_heal  (Registry&, NpcPool&, Entity target, std::int16_t amount);
```

Everything to the LEFT of `apply_damage` today lives in nine different files. Everything to the RIGHT
already lives in one function and works. The unification is the left half.

**Prerequisites that must land first, or the unified pipeline is still delivering only Kinetic:**
1. Add a `channel` column to `data/weapons_ranged.csv` and `weapons_melee.csv`, and stop
   `gen_ranged_table.py` from emitting a literal `0`. Until then §4.1 stands and 4 of 5 channels,
   5 armour items, the 5 resist columns of `monster_traits.csv` and the whole fire counterplay
   are decorative.
2. Give the 17 AMMO rows a non-zero `spawn_w_milli` and a `spawn_rooms`, or 23 of 30 firearms
   stay unusable (§4.2).
3. Decide fog-tick: wire it or delete it (~250 LOC in `mob_spawn.cpp` plus 7 samosbor functions
   plus 8 struct fields plus 12 constants hang off that one decision).
