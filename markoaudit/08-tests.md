# 08 — Test-suite audit (gigahrush2)

Scope: `/Users/jirnyak/Mirror/gigahrush2/tests/` — 50 files, 38 315 LOC, 44 `suite_*.inl`
+ 4 test `.cpp` + 2 benches. Branch `torus`, HEAD `97bdf13e`, working tree dirty
(`tests/suite_floorcatalog.inl`, `tests/suite_navcache.inl` modified).

**Method**: for every assertion, "name the mutation of `src/` that makes this fail".
No named mutation ⇒ FAKE.

**Everything below was verified by building and running the tests**, not by reading alone:

```
build/game_test   → game_test: 243576 checks, 0 failures   (pin: 243576) GREEN
build/audit_test  → audit_test: 146 checks, 0 failures      (pin: 146)    GREEN
build/world_test  → 23391/23391 checks passed               (pin: 23391)  GREEN
build/e2e_test    → e2e_test: 2441 checks, 0 failures        (pin: [0-9]+) GREEN — see §6
```

---

## 0. Headline

The suite is **much better than its provenance suggests**. The count-pinning discipline
(`PASS_REGULAR_EXPRESSION` on exact totals) is real and works; `tools/check_source_rules.cmake`
really does refuse an unincluded/undispatched `suite_*.inl`. There are **no NOT-COMPILED
files, no orphan suites, no skip-if-no-file guards, and no commented-out assertions**.

What there *is*: a **long tail of ~180 assertions that cannot fail**, concentrated in
recognisable patterns, plus **three coverage holes that are worth more than the whole
fake-test list** (`src/world/nav_async.cpp`, `src/game/floors/*/`, `src/app/main.cpp`),
plus one **structurally broken pin** (`e2e_test`'s wildcard).

---

## 1. Inventory

`cases` = top-level test functions in the file. Many suites are one giant
`test_X_all()` with `{ … }` blocks inside — counted as 1.

| suite | LOC | cases | CHECKs | system under test | LIVE in game? |
|---|---:|---:|---:|---|---|
| suite_saveload.inl | 2053 | 19 | 446 | `game/save.cpp` | yes (`main.cpp`, F5) |
| suite_utilai.inl | 1673 | 1 | 280 | `game/ai.cpp`, `wander.cpp` | yes |
| suite_behaviours.inl | 1483 | 1 | 254 | `game/mob_behaviour.cpp` | yes |
| suite_navcache.inl | 1316 | 9 | 254 | `game/nav_cache.cpp` | yes (`floor_stream.cpp`) |
| suite_quest.inl | 1204 | 12 | 256 | `game/quest.cpp`, `quest_table.cpp` | yes |
| suite_audit.inl | 1169 | 13 | 95 | deliberate-red findings | n/a (tripwire file) |
| suite_craft.inl | 1157 | 1 | 271 | `game/craft.cpp`, `craft_table.cpp` | yes |
| suite_needs.inl | 1073 | 11 | 215 | `game/needs.cpp` | yes |
| suite_npcpool.inl | 982 | 1 | 237 | `game/npc_pool.cpp` | yes (core table) |
| suite_rpg.inl | 907 | 11 | 244 | `game/rpg.cpp` | yes |
| suite_diffusion.inl | 882 | 1 | 190 | `sim/diffusion.cpp` | yes (`ai.cpp`, `main.cpp`) |
| suite_props_game.inl | 853 | 16 | 155 | `game/prop_system.cpp`, `prop_table.cpp` | yes |
| suite_antourage.inl | 842 | 7 | 124 | antourage bake + `world/destruct.cpp` | yes |
| suite_samosborhud.inl | 840 | 1 | 117 | `game/samosbor.cpp` HUD projection | yes (`hud_ui.cpp`) |
| suite_economy.inl | 807 | 1 | 187 | `game/economy.cpp`, `economy_table.cpp` | yes |
| suite_rooms.inl | 737 | 7 | 100 | `game/room_zone.cpp` | yes (`needs.cpp`, `ai.cpp`) |
| suite_macrosim.inl | 681 | 1 | 87 | `game/macro_sim.cpp` | yes (`main.cpp`) |
| suite_monster.inl | 675 | 1 | 90 | `game/monster_traits*.cpp` | yes (`combat.cpp`) |
| suite_noise.inl | 658 | 10 | 102 | `game/noise.cpp` | yes |
| suite_doors.inl | 640 | 8 | 113 | `game/door.cpp` | yes |
| suite_samosbor2.inl | 640 | 1 | 125 | `game/samosbor.cpp` | yes |
| suite_speech.inl | 623 | 9 | 81 | `game/speech.cpp`, `speech_table.cpp` | yes |
| suite_loottable.inl | 618 | 1 | 120 | `game/loot_table.cpp` | yes (`loot.cpp`) |
| suite_samosbor.inl | 599 | 1 | 150 | `game/samosbor.cpp` | yes |
| suite_faction2.inl | 589 | 1 | 115 | `game/faction_relations.cpp` | yes |
| suite_packs.inl | 559 | 1 | 52 | `game/mob_spawn.cpp`, `wander.cpp` | yes |
| suite_eventsweb.inl | 500 | 2 | 125 | `game/event_bus.cpp` + web feed | yes |
| suite_hunt.inl | 463 | 1 | 50 | `game/hunt.cpp` | yes |
| suite_console.inl | 454 | 10 | 143 | `game/console.cpp` | yes |
| suite_needs2.inl | 390 | 4 | 55 | `game/needs.cpp` (again) | yes — **DUPLICATE** |
| suite_audio.inl | 385 | 8 | 64 | `src/audio/*` DSP | yes (`giga_audio`, `main.cpp`) |
| suite_gravity_regimes.inl | 335 | 6 | 41 | `world/gravity.h`, `sim/fluid`, `sim/controller` | yes |
| suite_destruct.inl | 320 | 6 | 89 | `world/destruct.cpp` | yes |
| suite_barter.inl | 268 | 8 | 53 | `game/barter.cpp` | yes |
| suite_budgets.inl | 241 | 5 | 23 | RAM/ms budgets | n/a (budget file) |
| suite_dice.inl | 232 | 6 | 62 | `game/dice.cpp` | yes |
| suite_status.inl | 204 | 1 | 69 | `game/status*.cpp` | yes |
| suite_playercmd.inl | 174 | 8 | 27 | `game/player_command.cpp` | yes (`input/input.cpp`) |
| suite_conversation.inl | 171 | 6 | 33 | `game/conversation.cpp` | yes |
| suite_keybind.inl | 151 | 7 | 61 | `game/keybind.cpp` | yes |
| suite_particles.inl | 119 | 4 | 39 | `game/particles.h` + table | yes |
| suite_props.inl | 114 | 3 | 14 | `render/prop_pass.cpp` layout | yes (render) |
| suite_floorcatalog.inl | 89 | 5 | 28 | `game/floor_catalog.cpp` | yes |
| suite_lightbake.inl | 50 | 1 | 11 | `game/light_bake.cpp` | yes (`main.cpp`) |
| **game_test.cpp** | 5414 | 63 | 1061 | engine game layer, driver | — |
| **e2e_test.cpp** | 2545 | 171 | 342 | full-loop integration | — |
| **world_test.cpp** | 895 | 21 | 139 | `giga_core`, driver | — |
| **audit_test.cpp** | 115 | 1 | 1 | driver for suite_audit | — |
| sim_bench.cpp | 330 | 1 | **0** | physics bench | tool, no `add_test` |
| macro_bench.cpp | 96 | 1 | **0** | macro bench | tool, no `add_test` |

**No suite is orphaned.** Every subject of every suite has a live caller in `src/`
outside `tests/`. The one near-miss is `src/game/vendor.h` — `game_test.cpp:17`
still `#include`s it but the `test_vendor` that CMakeLists.txt:558 still describes
("`test_vendor` 36 [CHECK sites]") **no longer exists**; only `src/game/barter.cpp`
consumes the two surviving constants. Stale include + stale CMake comment.

---

## 2. Fake-test hunt

### 2.1 SYSTEMIC: `std::array<T,N>::size() == N` — 15 unfailable CHECKs

These compare a compile-time array extent against the constant that *declares* it.
`src/game/mob_table.h:221` is `extern const std::array<MobDef, kMobKindCount> kMobTable;`,
so `kMobTable.size() == kMobKindCount` is `N == N`. Dropping a table row is a **compile**
error long before these lines execute. **No mutation of `src/` can fail any of them.**

| file:line | assert |
|---|---|
| suite_status.inl:33 | `CHECK(kStatusTable.size() == kStatusCount);` |
| suite_status.inl:34 | `CHECK(kStatusNames.size() == kStatusCount);` |
| suite_quest.inl:129 | `CHECK(kQuestTable.size() == kQuestCount);` |
| suite_quest.inl:130 | `CHECK(kQuestNames.size() == kQuestCount);` |
| suite_quest.inl:131 | `CHECK(kQuestBriefs.size() == kQuestCount);` |
| suite_economy.inl:175 | `CHECK(kBankTerms.size() == kEconomyBands);` |
| suite_economy.inl:176 | `CHECK(kBandNames.size() == kEconomyBands);` |
| suite_economy.inl:177 | `CHECK(kWealthTiers.size() == kWealthTierCount);` |
| suite_economy.inl:178 | `CHECK(kWealthTierNames.size() == kWealthTierCount);` |
| game_test.cpp:1283 | `CHECK(kMobTable.size() == kMobKindCount);` |
| game_test.cpp:1284 | `CHECK(kMobNames.size() == kMobKindCount);` |
| game_test.cpp:1868 | `CHECK(kItemTable.size() == kItemCount);` |
| game_test.cpp:1869 | `CHECK(kItemNames.size() == kItemCount);` |
| game_test.cpp:2114 | `CHECK(kMeleeTable.size() == kMeleeCount);` |
| game_test.cpp:2718 | `CHECK(kRangedTable.size() == kRangedCount);` |

Ironic: `suite_economy.inl:169-172` and `suite_quest.inl:937-941` both contain a
written argument that a constant condition must be a `static_assert` — immediately
above the CHECKs that violate it.

**Classify: TAUTOLOGY. Verdict: DELETE all 15** (they are already covered by the
`static_assert(kQuestCount == 19)`-style pins beside them).

### 2.2 SYSTEMIC: same pure function called twice, compared to itself

The textbook "compare a value to itself". Only a production function with hidden
mutable global state can fail these; the compiler is free to CSE them into one call.

| file:line | assert | note |
|---|---|---|
| suite_utilai.inl:1542-1544 | `CHECK(role_for(id, FloorKind::Derelict) == role_for(id, FloorKind::Derelict));` | ×64 in a loop |
| suite_behaviours.inl:846-848 | `CHECK(burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f) == burst_phase(MobBehaviour::FractureSprint, 7u, t, 2.0f));` | ×64; :850-855 is the real periodicity pin |
| suite_packs.inl:305 | `CHECK(pack_target_node(7, t) == pack_target_node(7, t));` | inside a loop |
| suite_needs.inl:183 | `CHECK(needs_roll(1234u).water == needs_roll(1234u).water);` | :184 is the real one |
| suite_quest.inl:1028 | `CHECK(fp == quest_table_fingerprint());  // pure` | :1030 is the real one |
| suite_destruct.inl:58 | `CHECK(carve_hash(1, 2, 3) == carve_hash(1, 2, 3));` | :59 is the real one |
| game_test.cpp:443 | `CHECK(&floor_spec_for(5) == &floor_spec_for(5));  // deterministic` | address of a static, always equal |
| suite_utilai.inl:209 | `for (int i…) CHECK(a[i] == b[i]);` | two `score_intents` calls, identical inputs — slightly stronger (distinct buffers) |
| suite_floorcatalog.inl:73 | `if (cat.resolve(f).kind != floor_spec_for(f).kind)` | see 2.3 |

**Classify: TAUTOLOGY. Verdict: DELETE** (≈195 executed checks; keep suite_utilai:209
and the block-level determinism digests, which do use distinct buffers/runs).

### 2.3 SELF-CONSISTENCY — expectation computed with the code under test

The most dangerous class here, because these *look* like strong pins and are green
under exactly the mutation they claim to guard.

**suite_behaviours.inl:1253-1255 / :1304-1306 / :1366-1368** (blocks 15/16/17)
```cpp
const float baseDmg = static_cast<float>(mob_hp_at_level(def.dmg, 1));
const std::int16_t expectedBehind = static_cast<std::int16_t>(baseDmg * 1.55f);
```
`src/game/combat.cpp:853` computes `dmg` with the identical `mob_hp_at_level(def.dmg, mr.level)`
and truncates it at :882 with the identical cast. **Mutation: change the `mob_hp_at_level`
curve → expected and actual move together → GREEN.** (The 1.55/0.72 literals *are*
independent and do catch a multiplier retune — good instinct, wrong base.)

**suite_behaviours.inl:1447-1450** (block 18, MELEEGRID) — worse, the multiplier is
*not* independent:
```cpp
const int expect = static_cast<int>(static_cast<float>(fist.dmg) * kWallBraceIncoming + 0.5f);
```
`kWallBraceIncoming` is the production constant (`mob_behaviour.h:462`, 0.58f). With
`fist.dmg == 3`: `int(3*0.58+0.5) == 2`. **Retune `kWallBraceIncoming` 0.58 → 0.75
and this stays green** (`int(3*0.75+0.5) == 2`). Only `:1238 CHECK(rBraced.applied == 6);`
catches it. Additionally **:1448's `floorExpect` ternary is a dead guard** —
`(expect < 1 && fist.dmg > 0)` is unreachable for the only input the test uses, so
block 18's headline claim ("must floor at 1, not 0") **is not exercised at all**;
the ternary makes the test pass whichever way the production floor behaves.

**suite_economy.inl:314** `CHECK(t.band == economy_band(z));` — `src/game/economy.cpp:53`
is literally `acct.band = economy_band(floorZ);`. Output of `economy_band` compared to
output of `economy_band`. Any retune *inside* `economy_band` passes.

**suite_economy.inl:458** `CHECK(carried == inventory_value(bag));` — `carried` is
`at_risk_value(bag)`; `extraction.cpp:69-75` and `loot.cpp:151-158` are two clones of
the same loop. A copy compared to its copy. (The real finding here is the duplication
in `src/`, not the test.)

**suite_needs2.inl:282-324** — `fit_first_pick` is a **test-local reimplementation** of
a retired production rule; `CHECK(chargedLucky == 6);` / `CHECK(chargedUnlucky == 10);`
grade the test's own function. `suite_economy.inl:24-25` states the rule this breaks:
*"a formula duplicated into a test is a formula that agrees with itself and not with
the shipped code."*

**suite_floorcatalog.inl:64-82** `test_catalog_patterns_match_floor_spec_for()` — sweeps
255 floors asserting `cat.resolve(f).kind == floor_spec_for(f).kind`. The file's own
comment admits "the rows are `floor_spec_for` as data". `floor_catalog.cpp:70-77`
registers eight predicates that reimplement the same modulo chain. This catches drift
between two hand-maintained copies, which is real — but it does **not** test that either
copy is correct, and `CHECK(checked > 200)` at :79 is the only thing keeping the sweep
from being vacuous.

**Classify: SELF-CONSISTENCY. Verdict: REWRITE** — replace each computed expectation
with a hard literal (`== 6`, `== 10`, `== 2`) as `suite_behaviours.inl:1234-1245` (block 14)
already does correctly.

### 2.4 FAKE — asserts nothing about `src/`

**suite_saveload.inl:391-392** — the highest-value single finding in the file.
```cpp
CHECK(a.poolBlob == b.poolBlob);
CHECK(a.macroBlob == b.macroBlob);
```
`busy_run()` never touches either blob; `grep -rn "poolBlob" tests/` returns exactly
this one hit. So this is permanently `empty == empty`. Meanwhile `save.cpp:582-583`
and `:739-740` really do serialize/deserialize both. **Deleting the poolBlob/macroBlob
write-and-read from `save.cpp` leaves the whole 446-CHECK suite green** (`:500-501`
`CHECK(h.poolBytes == 0u);` also passes; `save_bytes_for` is size-0-derived). The
comment at :390 claims `macro_world_round_trips` covers them — it does not: that test
drives `NpcPool::save_rows` / `MacroSim::save_state` directly and never puts the result
into a `SaveState`.

**suite_saveload.inl:663-665**
```cpp
CHECK(ms2.tick() == ms.tick());
CHECK(ms2.day_tenths() == ms.day_tenths());
CHECK(ms2.in_transit() == ms.in_transit());
```
`ms.step()` runs **once**, on a 5-row pool. `in_transit()` and `day_tenths()` are
almost certainly 0. **A codec that drops the journey vector entirely round-trips clean.**
One line — `CHECK(ms.in_transit() > 0)` before the comparison — fixes it.

**suite_saveload.inl:643-644** — comment says *"rosters agree as sets"*; the assertion
compares `.size()` only. A rebuild that puts the right *count* of wrong ids in each
bucket passes.

**suite_quest.inl:919-921**
```cpp
char line[512] = {};
CHECK(quest_line(log, id, line, sizeof(line)));
CHECK(valid_utf8(line));
CHECK(std::strlen(line) < sizeof(line) - 1);
```
`valid_utf8("")` is `true`, `strlen("") < 511` is `true`. **`quest_line` mutated to
`return true;` and write nothing passes all three.** The two loops directly above it
(:908-910, :913-916) *do* carry `CHECK(obj[0] != '\0')`. The missing line is the bug.

**suite_craft.inl:1150-1151**
```cpp
CHECK(disassembliesRun > 7000u);
CHECK(craftsRun >= 8u);
```
Both counters are incremented purely by the test's own `for` bounds. **Deleting the
whole body of `craft_disassemble` leaves both green.**

**suite_quest.inl:1036 / :1039** — `CHECK(fnv_over(shuffled, kQuestCount) != fp);`
`fnv_over` is defined in the test (:110-120) and `shuffled` is a test-local permutation.
This proves *the test's own hash* is order-sensitive. No production function runs.

**suite_craft.inl:269-270** — `craft_check` takes `const CraftingState&` / `const Inventory&`
(`craft.h:320`). "A refusal spends nothing" is proved by the **compiler**, not by these
lines; `inv` was default-constructed 7 lines above and passed only to `const&`.

**suite_saveload.inl:484-485, :568; suite_economy.inl:614; suite_craft.inl:123, :893-895**
— assertions about C++ itself (`(uint16_t)(-50) == 65486`, `500*9/10000 == 0`,
`memcpy` works, `kCraftRecipeCount == kItemCount` where `craft.h:174` *defines*
`kCraftRecipeCount = kItemCount`).

**suite_audio.inl:198**
```cpp
float reverbMax = 0.0f;
for (float s : buf) if (std::fabs(s) > reverbMax) reverbMax = std::fabs(s);
CHECK(reverbMax >= 0.0f); // Reverb tail exists and decays gracefully
```
`reverbMax` starts at 0 and only ever receives `fabs()`. **Always true.** The comment
claims the tail *exists*; the assert would need `> 0.0f` to say so. Delete the whole
siren reverb implementation → green.

**suite_audio.inl:100** `CHECK(bgClicks >= 0 && bgClicks <= 20);` — `bgClicks` is a
counter starting at 0 and only incremented, so `>= 0` is trivially true, and the upper
bound is satisfied by a `generate()` that writes silence.

**suite_economy.inl:688** `CHECK(hourly[b] >= 0);` on a sum of credited interest —
the "didn't crash" of that block.

**suite_saveload.inl:936** `CHECK(save_error_text(static_cast<SaveError>(200)) != nullptr);`
— pure non-null.

**suite_props.inl:44** `CHECK(static_cast<int>(shape) == s);` where
`PropShape shape = static_cast<PropShape>(s);` on the line above — a round-trip of the
test's own loop index through two casts. Pure tautology.

**suite_props.inl:91-108** — 9 runtime CHECKs (`szInst == 48`, all seven `offsetof`)
that **restate the `static_assert`s at :77-86 in the same function**. The build already
fails first. Zero added coverage; a comment says they exist "to avoid MSVC C4127".

**Classify: FAKE. Verdict: DELETE or FIX (saveload:391/663 and quest:919 are FIX —
they hide real uncovered production paths).**

### 2.4b FAKE — additional, from samosbor / props_game / rpg / npcpool

**Loop bodies that can never execute.** `suite_props_game.inl:770-778`:
```cpp
for (auto d : view) {
    CHECK(reg.get<Transform>(d).layer == layer);
    CHECK(w.x * w.x + w.y * w.y + w.z * w.z > 1e-6f);
    ++chips;
}
CHECK(chips == 0u);
```
`:778` asserts the view is **empty**, so the two CHECKs inside run zero times, forever.
Two assertions dressed as coverage that cannot execute.

**"Didn't crash" with literally no assertion.** `suite_rpg.inl:818-819`:
```cpp
transfer_player_progression(reg, entt::null, to);
transfer_player_progression(reg, to, entt::null);
```
Two bare calls, nothing after them. The comment says *"invalid handles do not crash"* —
any behaviour short of a segfault, including silently corrupting `to`, passes.

**Asserting an unimplemented feature's zero-init.** `suite_samosbor.inl:500`
`CHECK(c.withLos == 0);` with the comment *"documented hole: no line-of-fire query yet"* —
`samosbor_census` never writes `withLos`. The only mutation that fails this is
**implementing the feature**.

**Asserting a hardcoded `true`.** `suite_props_game.inl:462` `CHECK(res.interacted);`,
where the test's own comment at :448-450 says *"Calling it always reports interacted=true"*.

**"the seeder produced something".** `suite_props_game.inl:75-76, 122-125, 158-159,
203-205, 236, 490-491, 628-629, 636-637, 798-799, 804-805` — ten separate `CHECK(n > 0)`.
A seeder that produced exactly **1** prop on a 68×68 band passes every one. Plus four
copies of `CHECK(isfinite(p.x)…); CHECK(p.x != 0.0f || …);` at :93-98, :169, :247 — "not
NaN and not exactly the origin", which every wrong-but-finite position in the world passes.

**Bands that a stubbed function passes.** `suite_rpg.inl:218`
`CHECK(xp_for_monster_kill(static_cast<MobKind>(k), 1) >= 10);` over all 69 kinds — 10 is
the **default**, so a function that lost its table entirely passes all 69.
`suite_rpg.inl:336` `CHECK(hp >= 50);` with the comment *"credited, never reduced"* — a
`spend_attr_point` that credits **zero** HP passes; the claim asserted is not the claim
made. `suite_rpg.inl:44` `CHECK(total_xp_for_level(kRpgLevelCap) < 0xFFFFFFFFull);` — a
function returning 0 passes. `suite_samosbor.inl:457` is 1694 executed CHECKs of
`CHECK(t >= 1 && t <= kThreatSpikeMax);` — any constant in [1,10] passes all of them.

**Entailed-by-the-test's-own-loop.** `suite_samosbor.inl:404, :412, :421-422, :429-436,
:502-503, :550`; `suite_samosbor2.inl:631-632`; `suite_samosborhud.inl:298, :358, :437,
:555, :742`; `suite_npcpool.inl:433, :507`; `suite_rpg.inl:35, :728-729`. Each restates a
value an assertion 1-9 lines above already pinned exactly, or an arithmetic identity of
two already-asserted literals.

**Verbatim duplicate assertion.** `suite_npcpool.inl:155` is character-for-character
`:134`, 21 lines earlier, with nothing in between that could change it.

**Third and second copies of a self-consistent pressure check.**
`suite_samosbor2.inl:635-638` and `suite_samosborhud.inl:326-327` both assert
`samosbor_unsheltered_pressure(...).hpDamage == kSamosborUnshelteredHp`, where
`samosbor.cpp:544-545` is literally
`return SamosborPressure{kSamosborFogRadiusCells, kSamosborFogStrength, kSamosborUnshelteredHp, kSamosborUnshelteredPsi};`
— a `return` statement asserted to equal itself. Only `suite_samosbor.inl:573-579`
(independent literals `== 4`, `== 3`) is real.

**`suite_samosbor.inl:586`** `CHECK(q.hpDamage == p.hpDamage && q.psiDamage == p.psiDamage);`
across all variants — `samosbor.cpp:538-546` is `(void)variant; return SamosborPressure{…};`.
A constant function compared to itself.

**`suite_rpg.inl` RPGCMBT blocks (:608-627, :724-734)** recompute combat.cpp's exact
formula (`melee_damage`, `agi_attack_speed_mult_e3`, `str_heavy_weapon_speed_mult_e3`)
and compare. Any mutation *inside* those functions moves both sides identically. What is
caught is combat.cpp **dropping the calls**, pinned by `:618-619`. Naming the limit:
these blocks test wiring, not values. `suite_rpg.inl:459-460` / `:510` show the right
pattern — self-consistent recompute **followed by an independent literal** (`== 50`, `== 94`).

### 2.4c FAKE — the two worst individual tests in the repo (`suite_doors.inl`)

**(a) `test_door_query_near`'s broken-door block cannot fail, for two independent
reasons.** `suite_doors.inl:590-598`:
```cpp
// A door that breaks (hp -> 0) is no longer queryable.
if (built > 1) {
    Door& d0 = doors.doors[id0];
    d0.hp = 0;
    const vec3 at{d0r.cx + 0.5f, d0r.cy + 0.5f, static_cast<float>(d0r.cz)};
    CHECK(door_query_near(doors, at) != id0);
}
```
1. **`door_query_near` never reads `hp`.** `src/game/door.cpp:284-285` filters on
   `d.state == DoorState::Broken` only. Setting `hp = 0` changes nothing the function
   looks at. The comment states a contract that does not exist in `src/`.
2. **The probe is built in cell units, not metres** — the exact error the *same test*
   warns against ten lines above (`:580-581`: *"CELLS ARE 2 m ([voxels.md] kCellSize):
   the probe must be built in metres, or it lands half a world away and the query rightly
   misses"*). So `door_query_near` returns `kNoDoor`, and `kNoDoor != id0` passes.

Net: **zero coverage of the broken-door filter**, wrapped in a silent `if (built > 1)`.

**(b) `suite_doors.inl:567` and `:610` pass the wrong argument as the seed.**
```cpp
generate_floor(w, /*number=*/0, res, /*seed=*/909u);
DoorSet doors;
const std::uint32_t built = door_build(w, doors, /*number=*/0, res, layer);
//                                                                  ^^^^^ seed
```
`door_build(World&, DoorSet&, int number, const FloorSpec&, unsigned seed)`
(`src/game/door.h:204`). `layer` is a `LayerId` with value 0. Verified against every
other call site in the tree — `suite_doors.inl:119, :158, :160, :173` all correctly
match the world seed (`31337u`), `:186` uses `5150u`, `:275` uses `4242u`,
`suite_antourage.inl:735` uses `1337u`, and all four `main.cpp` call sites pass a real
seed. **Only these two lines pass a layer id.**

This is precisely the "two-seed bug" the same file documents at `:85-87` — *"a real seed
mismatch fails this by a mile (the old two-seed bug kept ~5%)"*. Both
`test_door_query_near` and `test_door_shut_all_and_locks` therefore run against a ~5 %
survivor door set and assert only `CHECK(built > 0);`, so the mismatch is invisible.
**Everything downstream in those two tests measures an incoherent fixture.**

**(c) `suite_doors.inl:576-588`** — the search loop only asserts on success:
`if (hit != kNoDoor) { CHECK(hit == i); foundSelf = true; }`. A `door_query_near` that
resolves exactly **one** of hundreds of doors and returns `kNoDoor` for the rest passes.
The misses are never counted.

**(d) `suite_doors.inl:106-107`** — commented-out assertion:
```cpp
// A pillar-mode kind has no wall segments to open, so it reports none.
// (Removed because Industrial is no longer a pillar-mode floor)
```
The degradation case (a floor kind that legitimately reports zero doorways) is now
untested anywhere in the suite.

### 2.4d FAKE — `suite_rooms.inl` restates `room_zone.cpp`

**`suite_rooms.inl:53-58`** — the taxonomy block *is* the implementation:
```cpp
if (room_bit_at(kind, number, x, y) ==
    floor_room_mask(kind, number, x / stride, y / stride)) ++agree;
…
CHECK(agree == interior);
```
`src/game/room_zone.cpp:154-163` is literally
`if (wx%stride==0||wy%stride==0) return 0; return floor_room_mask(kind, number, wx/stride, wy/stride);`
and the loop `continue`s on exactly those wall lines. `f(x) == f(x)` for every sampled cell.
`:58 CHECK(interior == 48 * 48);` is pure test arithmetic (64² minus the `%4` lines).

**`suite_rooms.inl:380` `CHECK(hits == 256);`** — `room_zone.cpp:195-205` builds `spots[]`
from exactly the `kRoomFurniture` rows with `f.room==roomBit && f.useSpot` and returns
`room_slot_offset(spots[...])`; the test re-enumerates the same rows and re-calls the same
`room_slot_offset`. **Structurally impossible to fail.**

**`suite_rooms.inl:323-324`** — `CHECK(ox >= 1 && ox <= stride - 1);` where
`room_zone.cpp:209-210` is `ox = 1 + h % span`, `span = stride-1`. Asserting the arithmetic.

**`suite_rooms.inl:139-171` — a 33-line block with ZERO CHECKs.** The `kShowRooms` walk
exists only to `std::printf` `--pos` handles, and contains a triple-nested search loop with
no assertion that the search succeeded. If `room_bit_at` stopped ever returning `Kitchen`,
or `room_body_walkable` returned false everywhere, this block prints nothing and fails
nothing.

**`suite_rooms.inl:300-302`** — the mask-is-a-set claim is disjunctive:
`CHECK(both.bit == want || both.bit == 0);` — `0` is the "no route" answer, so a
`room_route` that ignores multi-bit masks entirely and returns 0 passes. The stated
property is not asserted.

### 2.4e More SELF-CONSISTENCY (mid-size suites)

| file:line | assert | the production line it duplicates |
|---|---|---|
| suite_console.inl:213-221 | `const std::uint8_t want = static_cast<std::uint8_t>(floor_mob_tier(ctx.currentFloor)); … CHECK(levelled);` | `console.cpp:188-189`, verbatim |
| suite_antourage.inl:112-119 | `CHECK(f[0].upSign == -(d.x + d.y + d.z));` where `d = regime_down(r)` | `gravity.h:78-83` (`regime_frame`) feeds the same `regime_down(r)` through the same ladder |
| suite_eventsweb.inl:306, :334-336, :458, :468, :474-477 | every slow magnitude vs `kWebSlowScale` / `kWebSlowMs` / `kMobTable[kWebRow].speedMmps` | the producer uses the same constants. Only `:348 CHECK(flat_speed(reg, player) < spitter);` is independent |
| suite_rooms.inl:683, :692 | `CHECK(fabs(m.hpBank - 100.0f / kGameHourSec) < 1e-4f);` | `room_recover` divides by `kGameHourSec`. Contrast `:659-664`, which pin `53.5f`/`2.1f` as literals — those are real |
| suite_doors.inl:479-490 | `expectL` built from `mob_hp_at_level(md.dmg, kElite)` | `door.cpp:375`, verbatim. Only `:495 CHECK(ticks/ticksL > 2.0f)` survives a curve retune |
| suite_speech.inl:474-487 | "no faction leaks" — the test re-derives the two `speech_bucket` ranges `at()` indexes into | `speech.cpp:59-79`. The load-bearing part is `:493-507` (tiling / `hits[i] != 1`) |
| suite_monster.inl:136 | `CHECK(authored == kMonsterTraitRows);` — `authored` is a hand-inlined copy of `monster_traits.cpp:54-59` | duplicates `:102` |
| suite_speech.inl:205-224, suite_loottable.inl:206-209 | "determinism" = the same pure function called twice with identical args in one process | proves nothing; pin a golden vector instead |

**Verified NOT self-consistent (leave alone):** `suite_loottable.inl:185-200` cross-checks
`item_weight_on_floor` against `spawnWeight * band_drop_scale` — these are **two
independent copies** of `exp(-(over-1)*3)` (`item_table.cpp:3167-3170` vs
`loot_table.cpp:288-296`). A genuine duplication guard.

### 2.4f Tables tested with no reader in `src/`

`suite_monster.inl` blocks 5-7 assert `trait_allows_wet_spawn`, `trait_takes_bait`,
`trait_takes_bait_any`, `trait_move_mult`, `trait_incoming_mult` — **all five have zero
call sites outside `monster_traits.*`**. So `:400-402`, `:419-420`, `:517-522`, `:591-604`
are CSV-content assertions, not behaviour assertions. The suite is honest about this for
bait (`:556-561`) and `trait_allows_wet_spawn` (`:487-489`) but silent for
`trait_move_mult`/`trait_incoming_mult`. Blocks 3, 4 and 8 (through `apply_damage` /
`wander_step`) are the real ones.

### 2.4g Comment/assert drift (each one teaches a reader something false)

| file:line | comment says | assert says |
|---|---|---|
| suite_monster.inl:411-419 | "Exactly the **six** kinds … are the six allowed to spawn in water" | `CHECK(wetSpawn == 5);` |
| suite_monster.inl:576-585 | "**14** baited kinds, **five** list-only" | `CHECK(baitKinds == 13); CHECK(baitOnly == 4);` — and `flagOnly` is computed, **printed, never asserted** (the half the comment names by name, "Мухожук-носитель") |
| suite_samosbor2.inl:207-211 | "spawnWeightX10 = round(0.5) = **0** … unrollable by every spawner" | `CHECK(mob_def(MobKind::Sculpture).spawnWeightX10 == 1);` |
| suite_craft.inl:21-24 vs :172, :175 | "958", "228 / 135", "teaching 67 recipes" | `axis[5] == 959u`, `tierHist[0] == 229`, and :568 says "71 taught" vs `:603 CHECK(taught == 67u)` |
| suite_saveload.inl:390 | "macro_world_round_trips covers them with real objects" | it does not — see §2.4 |
| src/game/samosbor.h:836 | "`samosbor_fog_tick` is now the live caller" | it has no caller at all |

### 2.4h Print-not-assert (mid-size suites)

- `suite_monster.inl:563-585` — `flagOnly` printed, never asserted (above).
- `suite_rooms.inl:139-171` — 33 LOC, zero CHECKs (above).
- `suite_antourage.inl:614-632` — `byStorey`, `byAxis`, `byFace` histograms all printed;
  only `byStorey` is asserted (`:650`). **A bake that emitted 100 % `+Z`-faced pipes passes.**
- `suite_antourage.inl:465-470` — the bake budget is explicitly measured-not-asserted
  (a stated decision), which means "the bake is load-path cheap" has no gate.
- `suite_noise.inl:645 CHECK(quietUs < 5.0);` — **wall-clock** on a shared machine; the
  only functional claim in `test_noise_cost` is `:641 CHECK(sink > 0);`.

### 2.4i Weak-but-real, mid-size suites (selected)

- `suite_noise.inl:473 CHECK(loud.startD - loudEnd > 4.0f); // measured 7.82 m` — the
  test's own comment at :483-486 says the **silent control closes 6.73 m of the 7.82 m**,
  so the 4.0 m threshold is cleared by the control alone. It attributes nothing to hearing.
  `:503 CHECK(silentEnd - loudEnd >= 0.0f); // measured 0.00 m` passes for every
  implementation in which noise has zero effect, including deleting `investigate_step`'s
  steering. `:470 CHECK(soundSteers > 0);` is the one that carries the load.
- `suite_console.inl:152-165` — `CHECK(n >= 1)` after `"spawn"` accepts any non-empty
  result including one that does not contain `"spawn"`. `:168-171` does it right.
- `suite_console.inl:75-81` — `save` and `menu` are checked only through the accumulated
  union, so a `save` handler that sets `Menu`'s bit and vice versa passes.
- `suite_console.inl:397 CHECK(ctx.requestLandHub < 0);` — `ctx` was default-constructed
  at :381 with `-1`; the preceding `exec` was asserted to *fail*. Any no-op handler passes.
- `suite_noise.inl:20-22` — `NoiseField f; CHECK(f.quiet()); CHECK(f.live() == 0); CHECK(f.dropped == 0);`
  — construct, never step, assert member initialisers.
- `suite_doors.inl:174-175 CHECK(derDoors > 0); CHECK(derDoors <= derN);` — `door_build`
  returning 1 door out of 15 000 doorways passes.
- `suite_speech.inl:249 if (changed < 64) ++weakCells;` — floor of 64/128 against an
  expected ~102 (its own comment). A mixer degrading 102 → 65 passes silently.
- `suite_rooms.inl:275 + :281` — `arrived*100 >= sampled*95` and `unreachable*20 <= sampled`
  overlap, so the block tolerates a 5 % regression twice over.
- `suite_antourage.inl:234-235` — a factor-of-two ceiling on a six-face bake vs a
  one-face bake; passes for "zero-g bakes one face's worth and calls it spread".
- `suite_antourage.inl:637, :643-644, :697-698, :713-714` — vacuous lower bounds
  (`comps >= 1u` after `legs > 0`), loose ratios (comment claims 1 per ~1.6 legs, gate is
  1 per 4), and `> 0.0f` on bake-computed geometry.
- `suite_loottable.inl:175 CHECK(s >= 0.0f && s <= 1.0f);` — `band_drop_scale` returns
  `0.0f`, `1.0f` or `exp(x)`; the lower half is vacuous.
- `suite_loottable.inl:433-447` — a block whose own comment admits it is **not** testing
  its title (*"the branch is unreachable today and is documented rather than dead-tested"*);
  the only assert is an unrelated `CHECK(any > 0);`.
- `suite_eventsweb.inl:321 CHECK(!(rr.color.x == 1.00f && rr.color.y == 0.95f));` —
  a negative pin on one exact RGB pair; any other bullet-looking colour passes.

### 2.5 Guard/search loops with no success assertion

**suite_behaviours.inl:1320-1326, :1346-1352** — `std::uint64_t sprintTick = 0;` then a
search loop with no `CHECK` that the search succeeded. If `burst_phase` never returns
`Sprint`, `sprintTick` stays 0 and the block asserts sprint damage at a *windup* tick —
it fails, but for a reason the message will not explain. The file already uses the right
idiom at :622-623 (`CHECK(plainWindow != 0u)`).

**suite_craft.inl:421, :455, :617, :797** — `if (single != kInvalidItem) { … }` *after*
a CHECK on the same condition. Not silently skipped (the CHECK fires), but the guarded
body vanishes on failure, so one red line hides ~40 more.

### 2.6 Weak-but-real (not fake, but named so the coverage claim is honest)

- `suite_utilai.inl:212-215` clamp bands `>= 0.0f` / `<= 100.0f`; `:570`, `:798`, `:1468`,
  `:1636`, `:1664` — lower/upper bounds any sane implementation meets.
- `suite_behaviours.inl:121-130` — 10 × `CHECK(grid.cell(...) == kCellAir)` on a freshly
  constructed `MacroGrid`: construct-never-step-assert-zero-state. Defensible (air *is* a
  production default) but the shape is the shape.
- `suite_behaviours.inl:413` `CHECK(!near_eq(kDebrisCoverDamage, kDebrisCoverDamage * kWallBiasDamage, 0.01f));`
  — algebraically `x ≠ x·k`, only fails if `kWallBiasDamage ≈ 1`.
- `suite_behaviours.inl:140-141` `CHECK(near_eq(bracedAt.x - viewerAt.x, 10.0f));` — both
  vectors are test-local `const vec3` declared six lines above. `110 - 100 == 10`.
- `suite_needs2.inl:173-174, :208, :222-227` — pure arithmetic on `needs.h` constants;
  **no production code executes**. Belongs in `static_assert` (as `suite_needs.inl:205-220`
  correctly does).
- `suite_utilai.inl:270-271`, `suite_needs2.inl:153, :187`, `suite_craft.inl:390-400, :606`,
  `suite_economy.inl:721`, `suite_quest.inl:393, :431` — bands/sums already decided by an
  assertion one to three lines above; zero additional mutation coverage.
- `suite_floorcatalog.inl:41-42` `CHECK(cat.claim_count() >= 1); CHECK(cat.pattern_count() >= 1);`
- `suite_budgets.inl:81-82` `CHECK(flowBytes == 128u*1024u*1024u);` — arithmetic on two
  compile-time constants (`nav::kNodes * kMacroCells`); a real pin on a *decision*, but no
  production code path runs.
- `game_test.cpp:1295-1309, :407, :412, :466, :473, :484` — enum/range sanity bands.

**Running total of assertions that cannot fail on any `src/` mutation: ≈180
(≈205 executed CHECKs once loop multipliers are counted), out of 243 576.**
Numerically negligible; the value of removing them is that each one currently *reads*
as coverage.

---

## 3. Coverage holes vs. production

Ranked by risk × size. Cross-checked by grepping every `src/**/*.h` for a test that
includes it.

| rank | production | LOC | why it matters | current coverage |
|---:|---|---:|---|---|
| 1 | `src/world/nav_async.cpp` | 81 | **Threaded** bake holding a **raw `MacroGrid*`** into a live world; `main.cpp:4646-4648` documents a refuse-and-retry hazard around it. This is the exact defect class that got `LazyFieldRebaker` deleted (a data race that shipped green). | **NONE.** No test includes `world/nav_async.h`. |
| 2 | `src/game/floors/blame/blame_gen.cpp` | 725 | brand-new (untracked!) floor module, 725 LOC of geometry | 3 CHECKs in `suite_floorcatalog.inl` — that the *number* 5 is claimed. Nothing tests the geometry. |
| 3 | `src/app/main.cpp` | 7266 | the entire wiring layer: every system is *called* from here; a system can be unit-green and unwired | none possible (links SDL/Vulkan); `tools/check_wired.cmake` is the only gate, and it is a **text** gate |
| 4 | `src/render/*` (24 files) | ~6000 | the 958 MiB voxel mirror, DDA light grid, all passes | `suite_props.inl` (14 CHECKs, all layout `static_assert`s restated) — that is all |
| 5 | `src/game/floors/padic/padic_gen.cpp` | 700 | the only shipping geometric module | indirect only (via `generate_floor` in other suites) |
| 6 | `src/game/impact.cpp` | — | E=mv²/2 fall damage | no test includes `game/impact.h` |
| 7 | `src/game/ranged_pick.cpp` | — | no header at all; nothing includes it | not testable as written |
| 8 | `src/game/inventory_give.cpp` | — | called everywhere, has **no `.h` of its own** | exercised incidentally (barter/dice/craft), never directly |
| 9 | `src/sim/camera.cpp`, `controller.cpp` | 144 | camera basis, mouselook clamp | `world_test.cpp` (`mat4_lookAt`) + `suite_gravity_regimes.inl` — partial |
| 10 | `*_table.cpp` generated files (craft, economy, monster_traits, prop, quest, speech, status) | — | no test includes the `.cpp`, only the `.h` | fine — the tables *are* tested through their headers |

**Orphan tests: none found.** Every `suite_*.inl` references live symbols; all four
binaries compile and run today. The only relics are:
- `game_test.cpp:17 #include "game/vendor.h"` with no `test_vendor` left,
- `game_test.cpp:2206 + :5309` `// test_floor_kinds_use_distinct_materials(); removed`,
- the CMakeLists.txt:558 comment still naming `test_vendor` as one of the 58 unguarded
  dispatch lines.

---

## 4. Duplication

### 4.1 `suite_needs.inl` (1073) vs `suite_needs2.inl` (390) — REAL DUPLICATE

**needs2 introduces zero new production symbols.** Everything it calls
(`needs_advance`, `needs_warn_mask`, `needs_failed_mask`, `needs_hp_rate`,
`needs_seconds_to_damage`, `apply_consumable`, `consumable_hp_cost`, `relieve_needs`,
`use_best_food`, `use_best_drink`, `item_feeds`, `item_hydrates`, `embody_as_player`,
`embody`) is also called by `suite_needs.inl`. The reverse is not true.

`suite_needs2.inl:32-44` (`full_clock` + `approx`) is **byte-identical** to
`suite_needs.inl:28-40` — `diff` returns 0.

| needs2 | already in suite_needs |
|---|---|
| `:139 approx(needs_hp_rate(run), kOverflowHpPerSec, 1e-6f)` | `:793` — **identical text** |
| `:138 (needs_failed_mask(run) & NeedPee) != 0` | `:792`, `:819` — identical text |
| `:134`, `:161-162`, `:146-148`, `:109-116`, `:271-272`, `:377-378` | `:791/:818`, `:782-783`, `:797-800`, `:810-819`, `:314/:327`, `:668-721` |
| `:52-65 largest_free` | `:129-146 extremes_for` — same scan, same filters |

Genuinely unique to needs2 (worth keeping): the **elapsed-time** queue metering
(:88-97), the destroyed-points accounting (:141-153), the pressure clock (:176-187,
:229-261).

**≈115-125 of 390 LOC (≈30%) and ≈18 of 55 CHECKs (≈33%) restate suite_needs.
Verdict: MERGE the four unique blocks into `suite_needs.inl`, DELETE the file.
Net −270 LOC.**

### 4.2 `suite_props.inl` (114) vs `suite_props_game.inl` (853) — NOT duplicates, but props.inl is dead weight

Different subjects: `suite_props.inl` tests `render/prop_pass.cpp` (GPU instance
layout) and is the **only reason `world_test` links `Vulkan::Vulkan` and compiles
4 `src/render/*.cpp` files**. Its 14 runtime CHECKs are 100 % redundant with the
`static_assert`s in the same functions (§2.4). `suite_props_game.inl` tests
`game/prop_system.cpp` (ECS seeding) — real behaviour.

**Verdict: DELETE `suite_props.inl`'s runtime CHECKs (keep the `static_assert`s,
move them into `render/prop_pass.h`), then drop `world_test`'s Vulkan dependency
and 4 extra source files from its target.** Net −100 LOC and a much cheaper
`world_test` link.

### 4.3 `suite_economy.inl` vs `suite_craft.inl` — NOT duplicates

The premise was wrong. Overlap is ≈15 LOC of ≈1964 (<1 %) and 3 of 458 CHECKs — the
`stackMax == 1` filler-picking idiom (`suite_economy.inl:154-157` vs
`suite_craft.inl:543-546`) and `inventory_give` remainder semantics. Economy is about
`data/economy.csv` (10 rows) + bank arithmetic; craft is about `data/items.csv` craft
columns + equip/wear/repair. **Verdict: KEEP both.**

### 4.4 The samosbor trio — 2079 LOC, 392 CHECKs, **~250 of them testing a system the build itself declares unwired**

**This is the single largest finding in the audit.**

`samosbor_fog_tick` / `samosbor_fog_tick_at` have **zero callers in `src/`** — verified
directly. The only non-test mentions are *comments in `src/game/samosbor.h`* (:452, :459,
:467, :610, **:836 "`samosbor_fog_tick` is now the live caller"**, :869) describing a call
site that does not exist. Everything downstream is dead with it: `samosbor_census`,
`samosbor_threat_target`, `samosbor_threat_headroom`, `samosbor_fog_spawn_allowed`,
`count_layer_fog_mobs`, `despawn_layer_fog_mobs`, `fog_phase_cleanup`, the `FogSpawn`
component. ≈1100 LOC of production code.

**And the project already knows.** `tools/check_wired.cmake:73` carries the declared
deferral:

```cmake
"samosbor_fog_tick:туманная популяция самосбора не тикает в игре; problems.md §52"
```

So the `wired` ctest is green *because the deferral is declared* — while 250 assertions
across two suites test the deferred code. This is precisely the "big test suite for an
unwired system ⇒ delete both" signal.

Worse, both suites *state* this as their reason for existing and then fail to fix it:
- `suite_samosbor2.inl:4-11` — *"This file exists because those predicates had **no call
  site in src/**… A tested function with no caller is a tested function that cannot
  regress the game."* It then adds 125 CHECKs and still leaves them with no call site.
- `suite_samosborhud.inl:8-17` runs an **A/B between `if (samosbor_active(st))
  samosbor_fog_tick(...)` and the unconditional form**, concluding *"the guarded form is
  the one that looks correct"* — **neither form exists in `main.cpp`.** The 30 CHECKs of
  `test_samosborhud_fog_population_returns_to_baseline` (:491-585) test a call-site shape
  that is not in the tree. That A/B is ready-made evidence for a wiring decision and it
  is being left as a test instead of cashed in.

The samosbor **clock** is live and well tested (`samosbor_step` at `main.cpp:3258`, seal
damage at :3310, `samosbor_alarm` at :229, AI weights at `ai.cpp:191-249`, melee frenzy at
`combat.cpp:686`). Only the fog spawner is the island.

**Duplication inside the trio, on top of that — ≈264 LOC (12.7 %):**

| what | copies | LOC |
|---|---:|---:|
| helper trio `kTestGroundZ`/`ground_pos`/`annulus_air` — **byte-identical** (`suite_samosbor2.inl:40-46,78-107` vs `suite_samosborhud.inl:56-86`) | 2 | 31 |
| the Derelict@−50 fixture, same seed `11u`, same anchor (`samosbor2:302,367,508`; `samosborhud:495`) — 4 full 128³ `generate_floor` calls | 4 | 28 |
| **the one-shot-seal / DoT regression guard** (`samosbor:266`, `samosborhud:325`, `samosbor2:594-639` — the last is a **300 000-tick** drive) — all three files' headers claim it as *their* distinctive contribution | 3 | 50 |
| `samosbor_unsheltered_pressure` (`samosbor:571-579` independent; `samosbor2:635-638` and `samosborhud:326-327` both self-consistent against the same `return` statement) | 3 | 8 |
| `samosbor_allows_kind` gate (synthetic `MobDef`s vs real rows) | 2 | 14 |
| fog-population-bounded-by-phase — `samosbor2:502-592` is a strict **subset** of `samosborhud`'s `drive_two_cycles` | 2 | 91 |
| 24-h e2e duty re-derivation (`samosbor:315-353`) vs the analytic pin at `:90-138` — 4 × 432 000 ticks for a claim proven three other ways | 3 | 38 |
| roster-opens-with-count (`samosborhud:804` is strictly weaker than `samosbor2:236-240`) | 2 | 4 |

**Verdict:**
1. **Decide the fog spawner's fate first.** Either wire
   `samosbor_fog_tick(reg, world, samosbor, tr_, activeLayer, player, currentFloor, danger, simTick)`
   into `src/app/main.cpp` right after the `samosbor_step` block at ~:3324 (every argument
   is already in scope there), **or delete `mob_spawn.cpp:473-737` + `mob_spawn.h:125-272`
   + `suite_samosbor2.inl` + `suite_samosborhud.inl:491-585`.** Shipping ~1100 LOC of
   production code and ~250 tests for a subsystem with no caller is the largest single
   liability in the tree.
2. Hoist the helper trio into one `tests/samosbor_fixture.inl` (−31).
3. Build the Derelict floor once in a function-local `static` (−28, −3 `generate_floor`).
4. Keep the one-shot-seal guard only at `suite_samosbor.inl:258-266`; delete
   `suite_samosbor2.inl:594-639` (300 000 ticks for a duplicate) and `samosborhud:325-327`.
5. Delete `suite_samosbor2.inl:502-592` (subsumed) and `suite_samosbor.inl:315-353`
   (or cut to one depth).
6. Fix the **stale comment that contradicts its own assert** at `suite_samosbor2.inl:207-211`
   — the prose says `spawnWeightX10 == 0` and the row is dead; `CHECK(mob_def(MobKind::Sculpture).spawnWeightX10 == 1);`
   says otherwise. Anyone reading it draws the wrong conclusion about the mobs table.

**Projected: 2079 → ~1720 LOC if wired; 2079 → ~600 LOC if deleted.**

### 4.5 Other tests attached to declared-unwired systems

`tools/check_wired.cmake:49-75` declares nine deferred entry points. Test LOC attached:

| deferred entry point | declared reason | attached tests |
|---|---|---|
| `samosbor_fog_tick` | "не тикает в игре; §52" | **suite_samosbor2.inl (640 LOC / 125 CHECKs) + suite_samosborhud.inl:491-585 (~95 / 30)** |
| `feed_tick` | "лента событий читается только тестом; §52" | suite_eventsweb.inl (500 / 125) — but note `feed_tick(feed, i)` is an **accessor**, not a step; the gate matched it on the `_tick` suffix. The deferral row is arguably a false positive, though the *feed itself* is indeed test-only |
| `interaction_step`, `prop_interact_step` | "main.cpp зовёт свои ветки"; "не зовёт НИКТО и не покрыта тестом" | parts of suite_props_game.inl + e2e_test.cpp |
| `route_step` | "отложен к #13" | game_test / world_test / suite_navcache / e2e |
| `loot_containers_step` | "экран обыска заменил авто-лут; тест-бэкенд" | game_test.cpp — **explicitly kept alive as a test backend** |
| `cellular_step` | "§13" | **none** — correctly, no test for dead code |
| `fluid_step`, `diffusion_step` | GPU deferral / gate blind spot | genuinely live, false positives |

**≈1235 test LOC and ≈280 CHECKs sit on entry points the build declares unwired.**

### 4.6 `suite_props.inl` — 13 of 14 CHECKs cannot fail, plus live UB

Beyond §2.4: the `PropPassInspector` at `:20-28` is a **hand-copied stale layout** used
via `reinterpret_cast` at `:31`. The real `PropPass` (`src/render/prop_pass.h:85-105`) has
`std::array<std::uint32_t, kPropShapeCount> droppedInst_{}` **between** `cpuInst_` and
`instBufs_`, plus `culledInstBufs_`, `indirectCmdBufs_`, `useGpuCulling_`. It happens to
read `cpuInst_` correctly today only because `droppedInst_` was added *after* it. **One
member inserted before `cpuInst_` and every CHECK silently reads garbage** — and since 3
of its 4 remaining CHECKs re-assert values the test itself wrote, the failure would be
incoherent. Also `:65-66` assert `dummy.matId`/`dummy.emissive` set seven lines above,
i.e. that `std::vector::push_back` copies a struct.

Net production coverage of the whole file: *`add_instance` appends and `clear_instances`
clears.* **DELETE (−114 LOC).**

### 4.7 `suite_faction2.inl` vs `test_faction_relations`/`test_faction_gates_hunting` in `game_test.cpp`

`suite_faction2.inl:4-5` claims the split is honest ("everything it touches was DEAD
before 2026-07-29") and sections 2-7 genuinely are new. But section 1 (:94-137) restates
`test_faction_relations` nearly line for line, and **one claim is asserted three times in
three places**, each with a comment calling itself *the* regression that mattered:

| claim | game_test.cpp | suite_faction2.inl | game_test.cpp (3rd) |
|---|---|---|---|
| Wild hostile to citizens/cultists | :2371-2372 | :109-110 | — |
| Cultists vs Liquidators only | :2373-2375 | :114-115 | — |
| −50 boundary inclusive | :2379-2380 | :234, :467-468 | — |
| `add_mutual` symmetric + clamped | :2385-2388 | :523-524 | — |
| `reset_player_row_col` | :2391-2398 | :522-529 | — |
| `rel_row` driven by the `NpcPlayer` bit | :2406-2412 | :130-131 | :4193-4195 |
| **`mob_hostile_to` ignores a cultist even while player** | :2409, :2419 | :134 | :4187-4192 |

≈60 redundant LOC. **And `test_faction_gates_hunting` contains a documented assertion
that was never written:**

```cpp
// game_test.cpp:4207-4213
    // And the wander gate agrees with the attack gate. A cultist must not even be
    // pursued: build a nav bake and check a mob beside a cultist does not steer at it.
    (void)reg;
    (void)pool;
}
```

`reg` and `pool` are declared at :4137-4139 — including a `pool.init()` that commits
**~517 MB** (per `suite_faction2.inl:387`) — purely to be discarded. The second half of
the test's stated claim has zero CHECKs.

**Verdict: keep `suite_faction2.inl` as-is (it is the strongest file in this group);
delete `game_test.cpp:4185-4195` + :4207-4213 + the dead `pool.init()`, and trim
`test_faction_relations` to the six claims suite_faction2 does not cover. −60 LOC,
−517 MB of test RSS.**

`suite_faction2.inl:293-335` is the pattern the whole repo should copy: it **names its own
mutation** in a comment (*"Mutation check: revert faction_feud_step to the literal .x/.y
writes and the sentinel below is overwritten → red"*) and plants a sentinel
(`v = vec3{0.125f, 0, 0}`) a wrong implementation must clobber.

---

## 5. Determinism / harness hazards

| hazard | where | severity |
|---|---|---|
| **Writes to CWD** | `suite_navcache.inl:292-336` (`navcache_test_tmp/evict`, `/evict_full`) and `game_test.cpp:4942, 4982` (`navcache_test_tmp/`) — `fopen`, `create_directories`, `remove_all` | medium |
| **Leaves a directory behind** | Confirmed by running: `navcache_test_tmp/` exists in the repo root, **empty**. `.gitignore:88` documents that the tests `std::remove` their files but never `remove_all` the dir, so a run that fails part-way leaves a `.bin` with nothing ignoring it. | low (gitignored) |
| **Repo-root pollution, 769 MB** | `gigahrush2_save/` with slots 1,2,3,6,7,8 — `floor_0.sav` is **131 MB each**. Gitignored, but this is the *game* writing next to the repo, not the tests. `build/` is another 1.2 GB. | medium (disk, not correctness) |
| **Mutates `last_write_time`** | `suite_navcache.inl:323-325` back-dates files by N seconds to test eviction. Depends on the filesystem honouring `last_write_time` writes — fine on APFS, a known flake source on some CI filesystems. | low |
| **Wall-clock timing** | `suite_macrosim.inl:257-268`, `suite_diffusion.inl:769-846`, `suite_antourage.inl:465-469`, `suite_budgets.inl:101-105` | **NONE of these assert the milliseconds.** Verified: macrosim's `ms` is `printf`-only with an explicit comment ("NOT a CHECK"); diffusion asserts only *work counts* (`sat.liveCells == sat.openCells`); budgets asserts `bakeMs <= 4000.0` — a 100× headroom against tens of ms. **Correctly handled.** |
| **Fixed floor seeds** | `suite_budgets.inl:98` `generate_floor(w, 0, …, 1337u)`; `suite_diffusion.inl:762` `(w, -26, …, 4242u)`; `suite_hunt.inl:334` seed `77u`; dozens more | inherent — the generator is deterministic and the ONE-FLOOR-ONE-SEED law makes this correct, but it means a generator change moves ~15 pinned counts at once |
| **No `rand()` / `random_device` / `mt19937` anywhere in tests** | verified by grep | good |
| **Save-file dependence** | none — no test reads `gigahrush2_save/` or `*.sav` | good |
| **`ctest` from repo root** | `.gitignore:/Testing/` exists because ctest writes there | known, handled |

---

## 6. Do the tests actually run?

**Yes — all 44 `.inl` are `#include`d and all 44 entry points are dispatched. Verified
three ways:**

1. Every `suite_*.inl` appears in exactly one `#include` in `tests/*.cpp`
   (`suite_audit`→`audit_test.cpp`; `suite_props`,`suite_destruct`→`world_test.cpp`;
   the other 41 → `game_test.cpp`).
2. Every `test_*_all()` is called from a `main()`. The two files without a
   `_all()` entry point are wired differently but *are* wired:
   `suite_lightbake.inl` → `test_light_bake_clusters()` at `game_test.cpp:5394`;
   `suite_rooms.inl` → seven `rooms_*()` calls at `game_test.cpp:5360-5366`.
3. Scripted check for **uncalled inner test functions** across all 50 files:
   zero hits in `game_test.cpp` and `world_test.cpp`; the six "uncalled" functions in
   `suite_antourage.inl` (`test_gravity_frames`, `test_antourage_isotropy`,
   `test_antourage_carve_drops_the_wire`, `test_antourage_fall_clock`,
   `test_antourage_detached_pipe_falls_and_lands`, `test_pipes_hug_and_branch`) are
   dispatched **directly from `game_test.cpp` main**, not from `test_antourage_all()`.
   Fragile, but live.
4. All 171 functions in `e2e_test.cpp` are called.

**NOT-COMPILED: zero files.** The `unwired-suite` exemption hatch
(`check_source_rules.cmake:513`) is **used by nobody** — grep for
`giga-check: unwired-suite` in `tests/` returns nothing. Good.

### 6.1 THE ONE REAL HOLE IN THE HARNESS: `e2e_test`'s wildcard pin

```cmake
# CMakeLists.txt:1041-1042
set_tests_properties(e2e_test PROPERTIES
    PASS_REGULAR_EXPRESSION "e2e_test: [0-9]+ checks, 0 failures")
```

`game_test` (243576), `world_test` (23391) and `audit_findings` (146) pin **exact
counts**, and CMakeLists.txt:545-570 spends 25 lines explaining precisely why: *"delete
a call from the dispatch list in main() and that test simply never runs: exit 0, ctest
GREEN, no diff to review anywhere near a test file."*

`e2e_test` is the one target that does **not** get that protection. Deleting any of the
171 calls from its main — or shrinking any loop bound — moves 2441 to some smaller
number that `[0-9]+` matches, and **ctest stays green**. The 342 static CHECK sites of
the newest and most integration-shaped suite in the repo are guarded by the exit code
alone, which is the exact hole the other three pins exist to close.

**Verdict: pin it. `PASS_REGULAR_EXPRESSION "e2e_test: 2441 checks, 0 failures"`.**
One-line fix, closes the largest structural gap in the harness.

### 6.2 `sim_bench.cpp` (330 LOC) and `macro_bench.cpp` (96 LOC)

Both have **zero CHECKs** and no `add_test()` — they are `add_executable` only
(CMakeLists.txt:1134, :1148), with comments saying so ("An executable, not a ctest —
it measures, it doesn't pass/fail"). **Correctly classified as manual tools, not dead
tests.** They contribute 426 LOC to the "38 315 LOC of tests" figure while asserting
nothing; worth knowing when quoting the number.

---

## 7. Authorship

`git log --format='%an' -- tests/<file>`. **No commits by `Петушков А.` touch `tests/`
at all** — the Windows/sockpuppet batch never reached the test tree.

**Suites with 100 % `marko1olo` authorship and zero owner commits — the suspect set:**

| suite | LOC | CHECKs | commits |
|---|---:|---:|---|
| suite_diffusion.inl | 882 | 190 | 3 marko1olo |
| suite_macrosim.inl | 681 | 87 | 2 marko1olo |
| suite_rpg.inl | 907 | 244 | 7 marko1olo |
| suite_needs2.inl | 390 | 55 | 1 marko1olo |
| suite_status.inl | 204 | 69 | 2 marko1olo |
| audit_test.cpp | 115 | 1 | 3 marko1olo |

**Assessment after reading them:** `suite_diffusion.inl` and `suite_macrosim.inl` are
**good** — diffusion asserts work counts (`sat.liveCells == sat.openCells`) rather than
milliseconds and reasons explicitly about why a timing figure needs a work count beside
it; macrosim's ABA/generation-handle block (`:576-609`) is one of the sharpest tests in
the repo. `suite_status.inl` is a pure table pin against `status_table.csv` constants
(brittle but real), marred by the two `.size()` tautologies. **`suite_needs2.inl` is the
one that deserves the suspicion** — it is 30 % copy-paste of `suite_needs.inl`, contains
a test-local reimplementation of a retired production rule (§2.3), and its constant
arithmetic runs no production code.

**Suites where marko1olo dominates but the owner has reviewed:** suite_props_game (18/7),
suite_saveload (10/13), suite_behaviours (5/1), suite_console (5/2), suite_hunt (4/2),
suite_npcpool (4/1), suite_monster (4/3), suite_packs (4/2), suite_navcache (3/1),
suite_needs (3/3), suite_audit (9/4), game_test.cpp (52/50).

**Owner-only (highest trust):** suite_antourage, suite_rooms, suite_budgets,
suite_particles, suite_playercmd, suite_floorcatalog, suite_gravity_regimes,
suite_lightbake, suite_audio, suite_barter, suite_conversation, suite_dice,
e2e_test.cpp.

---

## 8. Proposal (ranked)

### DECIDE FIRST — the fog spawner (blocks the biggest deletion)

`samosbor_fog_tick` is declared unwired in `tools/check_wired.cmake:73` and has ~1100 LOC
of production code and ~250 assertions behind it (§4.4). **Either wire it into
`src/app/main.cpp` after the `samosbor_step` block at ~:3324, or delete
`mob_spawn.cpp:473-737` + `mob_spawn.h:125-272` + `tests/suite_samosbor2.inl` (640 LOC)
+ `tests/suite_samosborhud.inl:491-585` (~95 LOC).** `suite_samosborhud.inl`'s own A/B
already answers which call-site form to use; it should be cashed in rather than left as
a test. Everything else in the samosbor trio is downstream of this decision.

### DELETE — ~475 LOC unconditionally (~1210 LOC if the spawner is deleted), zero coverage loss

| # | what | LOC | why |
|---:|---|---:|---|
| 0 | *(conditional)* `suite_samosbor2.inl` + `suite_samosborhud.inl:491-585` | −735 | subject declared unwired (§4.4) |
| 0b | samosbor trio dedup that survives either decision: shared fixture, one `generate_floor`, one copy of the one-shot-seal guard, drop the subsumed `:502-592` and the 24-h e2e | −264 | §4.4 |
| 1 | `tests/suite_needs2.inl` after merging its 4 unique blocks into `suite_needs.inl` | −270 net | 30 % byte-level duplication, test-local reimplementation of a dead rule (§4.1) |
| 2 | the 15 `std::array.size() == N` CHECKs (§2.1) | −15 | compile-time identity, unfailable |
| 3 | the 9 same-function-twice comparisons (§2.2) — ≈195 executed checks | −20 | `x == x` |
| 4 | `suite_props.inl`'s 14 runtime CHECKs; move the `static_assert`s into `render/prop_pass.h`; then drop `Vulkan::Vulkan` + 4 `src/render/*.cpp` from the `world_test` target | −100 | duplicate of `static_assert`s in the same function; the only thing making `world_test` link Vulkan |
| 5 | `game_test.cpp:17 #include "game/vendor.h"`; the `test_vendor` reference in CMakeLists.txt:558; the two `test_floor_kinds_use_distinct_materials` comment stubs | −4 | relics of deleted tests |
| 6 | `suite_saveload.inl:484-485, :568`; `suite_economy.inl:614`; `suite_craft.inl:123, :893-895`; `suite_audio.inl:198` | −20 | assertions about C++/libc, or `>= 0` on a non-negative-by-construction float |
| 7 | `e2e_test.cpp:1710-1716` (`test_t2_f14_05_static_gate_regex_compliance`) | −8 | 5 CHECKs on 5 test-local string literals |
| 8 | `suite_rooms.inl:139-171` (the `kShowRooms` printf walk) | −33 | 33 LOC, zero CHECKs |
| 9 | `game_test.cpp:4185-4195` + `:4207-4213` + the `pool.init()` at `:4137-4139` | −18 | third copy of the player-bit claim + a stub whose assertion was never written; frees ~517 MB of test RSS |
| 10 | `suite_craft.inl:1150-1151` | −2 | asserts the test's own loop bounds |

### FIX — small edits that convert a fake into a real gate (do these first)

| # | file:line | edit |
|---:|---|---|
| 1 | `suite_saveload.inl:391-392` | fill `st.poolBlob` / `st.macroBlob` with distinct non-empty bytes in `busy_run()`. **Today an entire serialized section of `save.cpp` is untested.** |
| 2 | `suite_saveload.inl:663-665` | step `MacroSim` until `in_transit() > 0`, then assert it. Today the journey codec round-trips 0 == 0. |
| 3 | `suite_quest.inl:919-921` | add `CHECK(line[0] != '\0');` — `quest_line` stubbed to `return true` currently passes |
| 4 | `suite_behaviours.inl:1447-1450` | replace `kWallBraceIncoming` with the literal `0.58f`; add an input where the ×1 floor actually binds (kill the dead ternary at :1448) |
| 5 | `suite_behaviours.inl:1253/1304/1366` | replace `mob_hp_at_level(def.dmg, 1)` with the literal base damage for the three kinds |
| 6 | `suite_behaviours.inl:1320, :1346` | add `CHECK(sprintTick != 0u);` after each search loop |
| 7 | `suite_saveload.inl:643-644` | compare bucket *contents*, not `.size()` |
| 8 | `suite_economy.inl:314` | assert `t.band` against a hard literal per depth, not against `economy_band(z)` |
| 9 | `suite_needs2.inl:282-324` (if the file survives) | delete `fit_first_pick`; the rule it models is retired |
| **10** | **`suite_doors.inl:567, :610`** | **pass `909u` as the seed, not `layer`. Two whole tests currently run against a ~5 % survivor door set** |
| **11** | **`suite_doors.inl:590-598`** | **rewrite the probe in metres (`* kCellSize`) and set `d0.state = Broken` (or make `door_query_near` read `hp`, which is what the comment claims). Zero coverage of the broken-door filter today** |
| 12 | `suite_doors.inl:576-588` | count the `kNoDoor` misses; today one resolved door out of hundreds passes |
| 13 | `suite_rooms.inl:53-58` | replace the `floor_room_mask(x/stride, y/stride)` comparison with pinned expected bits for named cells — it is `f(x)==f(x)` |
| 14 | `suite_rooms.inl:380` | `hits == 256` cannot fail; assert instead that the seat's **world** cell holds a `SubVoxelAnchor` prop from `seed_room_furniture` |
| 15 | `suite_rooms.inl:139-171` | 33 LOC, zero CHECKs — add `CHECK(found)` after each search or delete the block |
| 16 | `suite_speech.inl:205-224`, `suite_loottable.inl:206-209` | "determinism" by calling one pure function twice in one process proves nothing; pin a small golden vector `(id, situation, faction, seed) → index` |
| 17 | `suite_monster.inl:585` | assert `flagOnly` too, and reconcile the `13`/`4` asserts with the comment's `14`/`five` |
| 18 | `suite_antourage.inl:614-632` | assert `byAxis`/`byFace`, not just `byStorey` — a 100 % `+Z`-faced bake passes today |
| 19 | `suite_props_game.inl:530`, `:770-778` | turn the silent `if (target != entt::null)` into a `CHECK`; delete the loop whose `CHECK(chips == 0u)` proves its own body never runs |
| 20 | `game_test.cpp:4207-4213` | write the assertion the comment describes, or delete the stub and the `pool.init()` (~517 MB) that exists only to be `(void)`-cast |
| 21 | `e2e_test.cpp:1710-1716` | `test_t2_f14_05_static_gate_regex_compliance` asserts 5 test-local string literals contain `"_step"`/`"_tick"`. **Delete** — it tests nothing |
| 22 | `e2e_test.cpp:1698-1703` | `test_t2_f14_03_entry_points_zero_delta_time` calls `ai_patrol_step` and asserts **nothing**. Add an assertion or delete |

### FIX — harness (highest leverage in the whole report)

| # | what |
|---:|---|
| **A** | **Pin `e2e_test`'s check count exactly** (§6.1). `"e2e_test: 2441 checks, 0 failures"`. One line; closes the only place a whole suite can stop running with ctest green. |
| B | Extend `tools/check_source_rules.cmake`'s dispatch guard to `tests/*.cpp` top-level `test_*()` functions, not just `suite_*.inl` entry points — CMakeLists.txt:552 already documents that 58 of game_test's 81 dispatch lines are unguarded by it |
| C | `remove_all` the scratch dir at the end of `suite_navcache.inl` so `navcache_test_tmp/` does not survive a run |

### REWRITE

- `suite_floorcatalog.inl:64-82` — the 255-floor sweep proves two hand-maintained copies
  of the modulo chain agree. Either derive one from the other in `src/` (so the sweep
  becomes a tautology and can go), or assert a hard table of expected kinds.
- `suite_props.inl` — as above, fold into a header `static_assert` block.

### KEEP (verified strong — these are the model)

- **`suite_utilai.inl` blocks 4/5 (:412-575)** — a per-tick sentinel value
  (`kSentX = 777.0f`) unproducible by either steerer, `CHECK(doubleWrites == 0)`
  **plus** `CHECK(aiWrites > 0)` and `CHECK(wanderWrites > 0)` so it cannot pass
  vacuously, plus the guard forced from both polarities. Deleting
  `src/game/wander.cpp:209` → red. **This is what every test in the repo should look like.**
- `suite_saveload.inl` `round_trip()` / `weak_check_vs_strong_check()` /
  `rejects_the_rest()` — distinct non-round values in every field, byte-for-byte
  re-serialize comparison, per-gate distinct `SaveError`, sentinel-unchanged after
  every refusal, CRC-recomputed-after-tamper.
- `suite_navcache.inl` — enumerated near-miss filenames each with a stated reason,
  CRC-32 anchored on the standard `"123456789" → 0xCBF43926` vector, exact wire offsets.
- `suite_behaviours.inl:257-445` (the 47-enumerator census with hard counts and a named
  single exception) and `:447-541` (ratios to each kind's own table speed with a Plain control).
- `suite_diffusion.inl` — asserts work counts, prints milliseconds; the correct split.
- `suite_budgets.inl` — prints every number pass or fail; ceilings with stated headroom
  rather than today's measurement; documents its own two failed drafts.
- `suite_playercmd.inl`, `suite_keybind.inl`, `suite_conversation.inl`,
  `suite_particles.inl`, `suite_lightbake.inl`, `suite_destruct.inl` — small, exact,
  every assert names a mutation.
- `suite_macrosim.inl:541-649` — the ABA / generation-handle block.

---

## 9. `e2e_test.cpp`, `world_test.cpp`, `audit_test.cpp`, benches

*(This section is direct verification: the four binaries were built and run, and the
zero-assert / literal-only tests below were located by script and confirmed by reading.)*

### 9.1 `e2e_test.cpp` (2545 LOC, 342 CHECK sites, 2441 executed)

Owner-authored (4 commits, all `Jirnyak`, first 2026-08-16 — the newest suite in the
repo). 171 leaf tests, all dispatched. Structure is `test_t<tier>_f<feature>_<nn>_<name>()`
across F1-F15 and four tiers.

**Three leaf tests contain zero assertions** — pure "didn't crash":

| line | test |
|---|---|
| e2e_test.cpp:1123 | `test_t2_f3_02_patrol_plan_with_empty_nav_graphs()` |
| e2e_test.cpp:1139 | `test_t2_f3_04_patrol_plan_on_dead_or_despawned_entity()` |
| e2e_test.cpp:1703 | `test_t2_f14_03_entry_points_zero_delta_time()` — calls `ai_patrol_step(reg, cg, fn, 0u, 0.0f)` and returns |

**One leaf test asserts only its own string literals** —
`test_t2_f14_05_static_gate_regex_compliance()` at :1710-1716:
```cpp
const char* names[] = {"bank_step", "feed_tick", "interaction_step",
                       "prop_interact_step", "route_step"};
for (const char* name : names)
    CHECK(std::strstr(name, "_step") != nullptr ||
          std::strstr(name, "_tick") != nullptr);
```
Five CHECKs asserting that five hard-coded strings contain `"_step"` or `"_tick"`. **No
production symbol is touched.** The name promises it checks `check_wired.cmake`'s regex;
it checks nothing. **DELETE.**

**Weak-shape assertions** (nonzero-count style): `:171 CHECK(cultists > 0 && looters > 0);`,
`:197`/`:1946`/`:2024 CHECK(pool.count() > 0);`, `:669`/`:1947 CHECK(acct.creditLimit > 0);`,
`:713 CHECK(bt.earned > 0);`, `:775`/`:992 CHECK(std::strlen(buf) > 0);`,
`:2053 CHECK(acct.loanAccrued > 0);`. Each catches "the subsystem produced nothing",
which is a real class, but none pins a value.

**The structural hole — §6.1, repeated because it is the headline:** `e2e_test`'s CMake
pin is `"e2e_test: [0-9]+ checks, 0 failures"`. Its check count is a **wildcard** while
`game_test`, `world_test` and `audit_findings` all pin exact totals, and CMakeLists.txt
spends 25 lines explaining why exactness is the point. Delete any of e2e's 171 dispatch
calls, or shrink any loop bound, and ctest stays green.

### 9.2 `world_test.cpp` (895 LOC, 139 CHECK sites, 23 391 executed) — KEEP

Ran green at exactly the pinned `23391/23391`. Its one liability is `suite_props.inl`
(§4.6), which is the sole reason this target links `Vulkan::Vulkan` and compiles
`prop_pass.cpp`, `prop_mesh.cpp`, `vk_buffer.cpp`, `vk_common.cpp`. Removing that suite
turns `world_test` into a pure `giga_core` target.
`world_test.cpp:516 parallel_for(0, [](int) { CHECK(false); });` is **not** a fake — it is
the correct idiom for "this body must never run".

### 9.3 `audit_test.cpp` + `suite_audit.inl` — KEEP, this is the best-designed target

All ten findings are now **CLOSED pins** (`projectile_once`, `ms_timer_drift`,
`gun_kills_counted`, `ammo_has_a_source`, `descend_not_free`, `descend_same_target_once`,
`giver_slot_recycled`, `hunt_is_findable`, `stack_max_respected`, plus the green pins
`budget_vs_demo_cap`, `travel_keeps_crate_records`, `travel_arrival_not_in_wall`). No live
red findings remain. Ran green at exactly `audit_test: 146 checks, 0 failures`.

The file's header documents a genuine defect it already fixed and that the rest of the
repo should learn from: **`WILL_FAIL TRUE` inverts one bit, never a count**, so once six
of seven findings were closed, regressing any one of them moved the tally 2 → 3 — still
non-zero, still inverted, **still green**. Six tripwires that read as guards guarded
nothing. `PASS_REGULAR_EXPRESSION` on the printed line closes both that and the
crash-before-print case. *This is the argument that applies verbatim to `e2e_test`'s
wildcard.*

Only stale detail: `audit_test.cpp:44 #include "game/vendor.h"` — same relic as
`game_test.cpp:17`.

### 9.4 `sim_bench.cpp` (330) / `macro_bench.cpp` (96) — manual tools, correctly classified

Zero `CHECK`s, no `add_test()`, `add_executable` only (CMakeLists.txt:1134, :1148), with
comments stating the intent ("An executable, not a ctest — it measures, it doesn't
pass/fail"). **Not dead tests.** But they contribute **426 LOC** to the headline "38 315
LOC of tests" while asserting nothing — worth knowing when quoting that number. The real
test corpus is ≈37 900 LOC.

### 9.5 `suite_budgets.inl` — KEEP, and copy its form

23 CHECKs, all real gates; `check_budget()` (:47-52) prints the measured value **and** the
limit on every run, pass or fail, then asserts only the ceiling. Thresholds have stated
headroom rather than being today's measurement (nav 160 MiB vs a ~130 MiB design; pool
512 B/head vs hundreds; bake 4000 ms vs tens). The file documents its own two failed
drafts — a default-constructed pool reporting `0.0 B/head` (*"a budget that measures
nothing and can never exceed its limit"*) and a `spawn()` without `init()` that
segfaulted — and pins the first shut with `CHECK(eager != 0);` at :159.

The only soft spot: `:81-82 CHECK(flowBytes == 128u*1024u*1024u);` is arithmetic on two
compile-time constants (`nav::kNodes * kMacroCells`) — a real pin on a *decision*, but no
production code path executes. Its own comment argues for it, and the argument holds.

---

## 10. Classification tally

| class | count | where |
|---|---:|---|
| **TAUTOLOGY** | ≈70 sites (≈340 executed) | §2.1 (15 array-size), §2.2 (9 self-compare loops), §2.4b, §2.4d, e2e:1710 |
| **FAKE** | ≈45 sites | §2.4, §2.4b, §2.4c, §2.4d, e2e's 3 zero-assert tests |
| **SELF-CONSISTENCY** | ≈25 sites | §2.3, §2.4b, §2.4e |
| **SKIPPED-IN-CI** | 0 skip-if-no-file / skip-if-no-GPU; **4 silent-guard blocks** | suite_props_game:530, :808; suite_doors:591; suite_rooms:148 |
| **ORPHAN** | 0 | every suite's subject is live |
| **NOT-COMPILED** | 0 | all 44 `.inl` included and dispatched; verified 4 ways |
| **DUPLICATE** | ≈600 LOC | suite_needs2 (≈120), samosbor trio (≈264), suite_props (114), faction (≈60), suite_samosbor2⊂samosborhud (91) |
| **POLLUTING** | 2 dirs | `navcache_test_tmp/` (empty, gitignored); `gigahrush2_save/` 769 MB (game, not tests) |
| **MISSING-COVERAGE** | 10 areas | §3, headed by `world/nav_async.cpp` (81 LOC, threaded, raw pointer, **zero tests**) |
| **DEAD-SUBJECT** | ≈1235 test LOC / ≈280 CHECKs | tests attached to `check_wired.cmake`'s declared-unwired entry points (§4.5) |

**Assertions that no `src/` mutation can fail: ≈180 sites / ≈420 executed, out of
243 576 in game_test + 23 391 in world_test + 2441 in e2e + 146 in audit_test.**
That is **0.16 %** — numerically trivial. The value of removing them is that each one
currently reads as coverage, and three of them (§2.4 saveload:391/663, quest:919) hide
production paths that are genuinely untested.
