# Audit 04 — Items / Crafting / Economy / Loot / Inventory
### LEGACY & DEAD CODE audit, gigahrush2 @ branch `torus` (HEAD 97bdf13e), 2026-08-17
### Read-only. Every claim below was re-grepped today; repo comments and Docs/*.md were NOT trusted.

---

## 0. Method note (and the one thing I proved is NOT wrong)

I re-ran every generator in the scope into `/tmp/markoaudit/` and diffed against the committed `.cpp`:

```
gen_item_table    -> src/game/item_table.cpp      IDENTICAL
gen_craft_table   -> src/game/craft_table.cpp     IDENTICAL
gen_economy_table -> src/game/economy_table.cpp   IDENTICAL
gen_weapon_table  -> src/game/weapon_table.cpp    IDENTICAL
gen_ranged_table  -> src/game/ranged_table.cpp    IDENTICAL
gen_quest_table   -> src/game/quest_table.cpp     IDENTICAL
gen_prop_table    -> src/game/prop_table.{h,cpp}  IDENTICAL (verified via `git status` — clean)
```

**There is NO DRIFT in this subsystem today.** The generated tables are byte-exact reproductions
of their CSVs. That closes the "hand-edited generated code" hypothesis for item_table.cpp.

---

## 1. CSV COLUMN LIVENESS (the highest-value section)

### 1.1 `data/items.csv` — 45 columns, 443 rows

| # | column | parsed by | emitted as | consumer (file:line) | VERDICT |
|---|--------|-----------|------------|----------------------|---------|
| 1 | `id` | gen_item_table:249 | `kItemIdStrs` | console.cpp `give` via `item_by_string` (item_table.h:164) | LIVE |
| 2 | `name_ru` | gen_item_table:212 | `kItemNames` | inventory_ui.cpp:328, main.cpp | LIVE |
| 3 | **`name_en`** | — | — | **0** (432/443 rows filled) | **DEAD** |
| 4 | `category` | :170 | `ItemDef::category` | craft.cpp:318, door.cpp:209, extraction.cpp:50, population.cpp:88, inventory_ui.cpp:170 | LIVE |
| 5 | `value_rub` | :197 | `ItemDef::value` | contract.cpp:63/76, main.cpp:5819/5834, inventory_ui.cpp:329 | LIVE |
| 6 | `stack_max` | :206 | `ItemDef::stackMax` | loot.cpp:71/130/235, main.cpp:5922/5942 | LIVE |
| 7 | **`stack_declared`** | — | — | **0**. 161 rows filled, **0 of them differ from `stack_max`** (verified by script today) — a pure duplicate column | **DEAD / DUPLICATE** |
| 8 | `spawn_w_milli` | :199 | `spawnWeight` | item_table.cpp:324, contract.cpp:339 | LIVE |
| 9 | `spawn_rooms` | :204 | `roomMask` | item_table.cpp:325 (`item_weight_on_floor`) | LIVE |
| 10 | **`spawn_count_max`** | — | — | **0**, and all 443 rows are filled (367×"1", 28×"2", …) | **DEAD** |
| 11 | `equip_slot` | :171 | `equipSlot` | equip.cpp:29, combat.cpp:1062, ai.cpp:1311, inventory_ui.cpp:365 | LIVE |
| 12 | `durability` | :210 | `durability` | equip.cpp:64 (`item_durability`) → `wear_equipped`, inventory_ui.cpp:179/334/394 | LIVE (17 rows) |
| 13-17 | `resist_*` ×5 | :176 | `resist[5]` | combat.cpp:1064/1097, ai.cpp:1313, inventory_ui.cpp:116 | LIVE (2–5 rows each) |
| 18 | **`science_value`** | — | — | **0** (2 rows filled) | **DEAD** |
| 19 | **`contraband_score`** | — | — | **0** (5 rows) | **DEAD** |
| 20 | **`deceptive_score`** | — | — | **0** (2 rows) | **DEAD** |
| 21 | `use_effect` | :172 | `useEffect` | needs.cpp:359/371/382/393, loot.cpp:443 | LIVE-ish (see §5.4 — 8 of 15 enum values have no handler) |
| 22 | `use_a` | :201 | `useA` | needs.cpp:83/394, loot.cpp:444, door.cpp:210 | LIVE |
| 23 | **`use_b`** | — | — | **0** (17 rows). Replaced by hardcode `kRiskyFeedHpCost = 6` (needs.h:179), which **disagrees with the authored data on all 4 FeedRisky rows** (CSV says −5 / −8 / −6 / −6) | **DEAD-DATA + MAGIC-CONST** |
| 24 | **`use_grant_id`** | — | — | **0** (6 rows: `decon_fluid`, `ammo_762`, `ammo_shells`, `blue_glow_sample_open`, …) | **DEAD** |
| 25 | **`use_grant_n`** | — | — | **0** (6 rows) | **DEAD** |
| 26 | **`ammo_id`** | — | — | **0** in items.csv. The *live* ammo link is `weapons_ranged.csv:ammo_item`, resolved in gen_ranged_table.py:112. `ranged_table.h:137` cites items.csv's `ammo_id` as the source of truth — **that citation is false today** | **DEAD / DUPLICATE** |
| 27-34 | `craft_mechanics` … `craft_metamatter` | **gen_craft_table.py:64-66** | `CraftRecipe::comp[8]` | craft.cpp `craft_check`/`craft_item`/`craft_disassemble`/`craft_repair_item` | LIVE (this is the answer to "are the 8 craft columns dead" — they are NOT; a different generator eats them) |
| 35 | `craft_station` | gen_craft_table:186 | `CraftRecipe::station` | craft.cpp:127/425 | LIVE |
| 36 | `craft_tier` | gen_craft_table:189 | `CraftRecipe::tier` | craft.cpp (`TierTooHigh`) | LIVE |
| 37 | **`tag_count`** | — | — | **0** (319 rows) | **DEAD** |
| 38 | **`tags_hot`** | — | — | **0** (310 rows) | **DEAD** |
| 39 | **`tags_all`** | — | — | **0** (319 rows, 465 distinct strings per header) | **DEAD** |
| 40 | `desc_ru` | :215 | `kItemDescs` | inventory_ui.cpp:338 | LIVE |
| 41 | `mass_g` | :141 | `massG` | item_table.h:207, encumbrance.cpp, loot.cpp:246, inventory_ui.cpp:329 | LIVE |
| 42-45 | `light_*`, `flicker` | :184-186 | `lightRadiusMm`… | main.cpp:364-390, prop_system.cpp:309-320 | LIVE (only **1 row** — `flashlight` — is non-zero) |

**Total dead columns in items.csv: 13** (`name_en`, `stack_declared`, `spawn_count_max`,
`science_value`, `contraband_score`, `deceptive_score`, `use_b`, `use_grant_id`, `use_grant_n`,
`ammo_id`, `tag_count`, `tags_hot`, `tags_all`).
The owner's "~14" is right; the 14th is arguably `light_*` (4 columns carrying data for 1 of 443 rows).
`item_table.h:14-24` declares only **6** of these as deferred — `spawn_count_max`, `stack_declared`,
`name_en`, `use_b`, `use_grant_n`, `tag_count`/`tags_hot` are **not on its own list**.

`item_table.h:99-104` still says massG is "Resolved from `data/item_mass.csv` by rule (id > tag >
prefix > category)". **`data/item_mass.csv` does not exist** — the generator reads the `mass_g`
column directly (gen_item_table.py:141). **LEGACY comment.**

### 1.2 `data/craft_recipes.csv` — 6 columns, 24 rows

| column | parsed | emitted | consumer | VERDICT |
|--------|--------|---------|----------|---------|
| `source_id` | :225 | `kCraftSourceIds` | **tests only** (suite_craft.inl) | DEAD-DATA (in src/) |
| `kind` | :~275 | `CraftSource::kind` | **tests only** (suite_craft.inl:594) — see §4.2 | DEAD-DATA (in src/) |
| `unlock_item` | :254 | `CraftSource::unlock` | craft.cpp:253 `craft_source_for_item` | LIVE **for 9 of 24 rows** |
| `consume` | :267 | `CraftSource::consume` | craft.cpp:279 | LIVE |
| `recipe_items` | :235 | `CraftSource::recipe[9]` | craft.cpp:242 | LIVE for reachable sources only |
| `text_ru` | :289 | `kCraftSourceText` | **tests only** | DEAD-DATA (in src/) |

### 1.3 `data/economy.csv` — 12 columns, 10 rows

| column | emitted as | consumer in src/ | VERDICT |
|--------|-----------|------------------|---------|
| `kind` / `id` / `name_ru` | `kBandNames` / `kWealthTierNames` | economy.cpp:49/253 (`band_name`, `wealth_tier_name`) — **but neither of those two functions has an app caller** (§4.3) | DEAD-DATA |
| `lo` / `hi` (BAND rows) | `BankTerms::floorLo/floorHi` | **0 in src/** — the live band ladder is hardcoded in `item_table.cpp:3144 economy_band()` (`<=3 / <=10 / <=22 / <=38`). Cross-checked at generate-time (gen_economy_table.py:175) so no drift, but the CSV copy is not what runs | DEAD-DATA / DUPLICATE (gated) |
| `lo` / `hi` (WEALTH rows) | `WealthTier` | economy.cpp:244/247 (`wealth_tier`) — which itself has no app caller | DEAD-DATA |
| `loot_cap` | `BankTerms::lootCap` | **0 in src/** — everyone reads the hardcoded `kLootValueCap[]` (item_table.h:222): container.cpp, contract.cpp, loot_table.h, population.cpp, rumour.cpp. Cross-checked at generate-time (:182) | DUPLICATE (gated) |
| `cash_cap` | `cashCap` | **0** — tests only (suite_economy.inl:184) | **DEAD-DATA** (economy.h:179-182 admits it) |
| `quest_cap` | `questCap` | **0** — tests only | **DEAD-DATA** |
| `quest_rate` | `questRate` | **0** — tests only. contract.cpp instead hardcodes `kFetchPayMult=1.6f`, `kHuntPayPerHp=3`, `kDescendPayPerBand=900` (contract.cpp:23/28/32) | **DEAD-DATA + DUPLICATE** |
| `deposit_bp` | `depositBp` | economy.cpp:187-190 | LIVE |
| `loan_bp` | `loanBp` | economy.cpp:208-210 | LIVE |
| `credit_limit` | `creditLimit` | economy.cpp:64-66, save.cpp:397 | LIVE |

### 1.4 `data/weapons_melee.csv` — 7 columns, 22 rows

| column | emitted | consumer | VERDICT |
|--------|---------|----------|---------|
| `item_id` | `kMeleeByItem` | equip/combat | LIVE |
| `dmg` | `dmg` | combat.cpp | LIVE |
| `range_cells` | `reachMm` | combat.cpp:2283, inventory_ui.cpp:104 | LIVE |
| `cooldown_s` | `cooldownMs` | combat.cpp | LIVE |
| `durability` | `durability` | equip.cpp:64 | LIVE |
| **`knockback`** | `knockbackMm` | **0** — weapon_table.h:33 says so itself: *"unused by physics yet; recorded, not invented"*. 22/22 rows authored | **DEAD-DATA** |
| **`hit_radius`** | `hitRadiusMm` | **0** | **DEAD-DATA** |

### 1.5 `data/weapons_ranged.csv` — 12 columns, 30 rows

All 12 columns parsed and emitted. Consumers:
`dmg`/`cooldown_s`/`pellets`/`spread_rad`/`magazine`/`ammo_item`/`proj_type`/`blast_cells`/`fuse_s`
→ combat.cpp, main.cpp, ranged_pick.cpp — **LIVE**.
`proj_speed_cells` → `RangedDef::projSpeedMmps` → combat.cpp — **LIVE**.
`reload_s` → `reloadMs` → combat.cpp/hud_ui.cpp — **LIVE**, but the column holds **`1.0` on 29 of
30 rows** (0.0 on grenade): a "column" that is a constant. ranged_table.h:52-54 argues this is
honesty-over-hidden-magic; it is defensible but it is one number wearing a table costume.
**`RangedDef::channel` (offset 14)** has **no CSV column at all** — the generator emits a literal
`0` (ranged_table.cpp:9 onwards, 10th field) and **nothing reads it**. → **DEAD-DATA field.**

### 1.6 `data/props.csv` — 19 columns, 9 rows

All parsed. **`name`** → `kPropNames` → **0 consumers in src/** (`prop_name()` is never called).
→ **DEAD-DATA.** `kPropIds` likewise has no reader outside its own definition.
Everything else (shape/fall_mode/interact/emissive/mat_id/color/reach/mass/size/light/flicker)
is read by prop_system.cpp / main.cpp. **LIVE.**

### 1.7 `data/interactables.csv` — 5 columns, 6 rows

`id` → `InteractDef::id`: **0 consumers**. `cpp_name` → the generated enum: LIVE.
`prompt`: LIVE (main.cpp:6424/6441/6460). `reach_m`: LIVE for Terminal/ElectricalShield/Corpse/Npc.
**`note`**: not parsed at all → documentation-only column. **DEAD (benign).**
**`loot` row's `reach_m = 2.0` is DEAD**: floor pickups use `kPickupReach = 1.8f` (loot.h:91,
loot.cpp:251/310/376) — the table's own banner promises "never hardcodes … a reach literal again"
and the very next system does. **DUPLICATE + MAGIC-CONST.**
`InteractKind::LightBulb` is never named in code (only reached as a `props.csv` ordinal).

### 1.8 `data/quests.csv` — 13 columns, 19 rows

Every column parsed, emitted and read: `subject`/`target`/`kind` (quest.cpp:51-62),
`floor_lo`/`floor_hi` (:203), `limit_s`→`limitMs` (:292/:353), `reward_rub` (:532),
`reward_item`/`reward_count` (:426), `prereq` (:214-216), `name_ru`/`brief_ru` (:532-533).
**Cleanest CSV in the scope — 0 dead columns.**

---

## 2. WHY `item_table.cpp` IS 3,174 LINES — structural verdict

**Verdict: BLOAT-BY-DESIGN, not drift, not a switch. It is 99% generated data with a banner and
it is committed on purpose.**

```
src/game/item_table.cpp
  1..26     generated banner + includes + u8()/u16() helpers
  27..1800  kItemTable       443 ItemDef rows          (1,773 lines, 4 lines/row)
1802..2246  kItemNames       443 Cyrillic strings        (444)
2248..2692  kItemDescs       443 flavour strings         (444)
2696..3140  kItemIdStrs      443 CSV slugs               (444)
3144..3174  economy_band() + item_weight_on_floor()   <- the ONLY logic: 32 lines
```

- Banner present and truthful: `// GENERATED by tools/gen_item_table.py … do not hand-edit`
  (item_table.cpp:1, emitted from gen_item_table.py:283).
- File **is committed** (deliberately, so the build needs no Python — gen_item_table.py:6-7).
- **DRIFT: none.** Regenerated to a temp dir today → byte-identical.
- The 32 lines of real logic live in the generator's `FOOTER` string
  (gen_item_table.py:308-341), i.e. **executable C++ is authored inside a Python string literal**.
  That is the one genuinely bad structural fact: `economy_band()`'s thresholds `3/10/22/38` are
  magic numbers inside a Python heredoc, and `gen_economy_table.py:115-120` reaches back with a
  *regex over the generated .cpp* to cross-check them. Two files parse each other's text.
  **MERGE candidate**: move those 32 lines into a hand-written `item_gating.cpp` and let the
  generator emit data only.

Same shape, same verdict, for `craft_table.cpp` (1,488) and `quest_table.cpp` (125).

---

## 3. DUPLICATE CONCEPTS

### 3.1 "A thing you can hold / trade / use" — id spaces

| owner | id space | count | overlaps with |
|-------|----------|-------|---------------|
| `item_table.h` `ItemId` (1-based u16) | items.csv row order | 443 | THE canonical space |
| `craft.h` `CraftRecipe` | **same** `ItemId`, `kCraftRecipeCount == kItemCount` | 443 | none — correctly unified (craft.h:174) |
| `weapon_table.h` / `ranged_table.h` | sparse maps **keyed by ItemId** | 22 / 30 | none — correctly unified |
| `loot_table.h` `RareDrop`/`LootEntry` | **hardcoded numeric ItemId literals** in loot_table.cpp | 142 rows | **fragile**: guarded only by a checksum `kLootTableValueChecksum = 104447` (loot_table.h:228). Not a CSV, not generated. **LEGACY — the only content table in the scope that is hand-written C++.** |
| `container.h` `Container` | ItemId ×4 slots | — | fine |
| `prop_table.h` `PropId` | props.csv row order | 9 | **separate space, correctly separate** (a prop is furniture, not an item) |
| `interact_table.h` `InteractKind` | interactables.csv row order | 6 | fine |

**Verdict: the item id space is actually well-unified.** The one true duplicate is
`loot_table.cpp`'s 142 rows of hand-written numeric ids — it is the sibling of items.csv that
never became a CSV. **MERGE proposal: `data/mob_drops.csv` + `tools/gen_loot_table.py`**, which
deletes the checksum, the "re-derive the ids and update this constant" ritual (loot_table.h:220-228)
and 363 lines of hand-maintained C++.

### 3.2 "What is this worth" — SEVEN authorities

| # | authority | file:line | scope |
|---|-----------|-----------|-------|
| 1 | `items.csv value_rub` → `ItemDef::value` | item_table.h:97 | face value — **the root** |
| 2 | `kLootValueCap[5]` (hardcoded array) | item_table.h:222 | depth cap |
| 3 | `economy.csv loot_cap` → `BankTerms::lootCap` | economy_table.cpp:12 | **a second copy of #2**, zero src consumers, gated by a generator regex |
| 4 | `kContainerCapPct[4] = {6, 30, 100, 45}` | container.h:59-65 | per-kind slice — **derivation: none stated** |
| 5 | `kBuyMult 1.15` / `kSellMult{0.85, 0.92, 0.72}` | **vendor.h:43-48** | barter spread |
| 6 | `kFetchPayMult 1.6f`, `kHuntPayPerHp 3`, `kDescendPayPerBand 900`, floors `20`/`30` | contract.cpp:23-32, :77, :120 | contract reward — **while economy.csv's `quest_rate`/`quest_cap` sit unread** |
| 7 | `quests.csv reward_rub` | quest_table.cpp | authored per-quest |

Plus `dice.cpp:75` `stake = money / 10` and `main.cpp:6229` `teller_withdraw_cash(..., 1000)`.

**Proposal:** economy.csv should become the single band contract. Delete `kLootValueCap[]` from
item_table.h and have `economy_band`/`item_weight_on_floor` read `kBankTerms[b].lootCap`; wire
`questRate`/`questCap` into contract.cpp so #6's four magic numbers derive from the band. That
alone kills authorities #3 and #6 and un-deads three economy.csv columns.

---

## 4. UNWIRED FEATURES — what the player can actually reach

### 4.1 Reachability matrix

| system | entry point | reachable? |
|--------|-------------|-----------|
| inventory grid, equip/unequip/drop/repair | `I` → `inventory_ui_draw` → main.cpp:5867 switch | **YES** |
| **per-slot "Использовать [U]"** | inventory_ui.cpp:383-388 | **NO — see §4.4** |
| craft (learn / best-available / scrap) | console `craft`, `scrap` → main.cpp:4888-4910 | YES (console only, no key, no menu) |
| repair | inventory card button → main.cpp:6021 | YES |
| barter | conv menu «ТОРГ» → `ConvActionKind::Barter` → main.cpp barter deal screen | **YES** |
| bank teller (cash↔account) | conv menu «БАНК» (Duty role only) → main.cpp:6222/6229 | **YES** |
| bank deposit/loan/repay | same panel → main.cpp:6241-6265 | **YES** |
| `bank_step` interest | main.cpp:3238-3240, every sim tick | YES |
| dice | conv menu «КОСТИ» | **YES** |
| contract offer/accept | **proximity sweep** main.cpp:4519 + `E` main.cpp:3007 | YES, but **not through the menu** |
| quest offer/accept | proximity sweep main.cpp:4530 + `E` main.cpp:3012 | YES, but **not through the menu** |
| conv menu «ЗАДАНИЕ» | conversation.cpp:67-78 | **prints a line only** — it cannot offer or accept anything |
| container looting | main.cpp:4104-4136 (two-sided search screen) | YES |
| `loot_containers_step` | — | **NO — dead in production** |

### 4.2 UNWIRED: 14 of 24 craft knowledge sources

`craft_learn_from_carried` (craft.cpp:257) is the **only** caller of `craft_learn_from_source`
in `src/`. It resolves a source by `CraftSource::unlock` (craft.cpp:250-255).
In `data/craft_recipes.csv`, `unlock_item` is **empty on all 14 rows** of kind
`note`(2) / `quest`(5) / `npc`(4) / `terminal`(2) / `floor`(1).

→ **14 authored sources teaching ~40 recipes are unreachable by any code path.**
`CraftSourceKind` values `Note`, `Quest`, `Terminal`, `Npc`, `Floor` are **never compared
against anything in src/** (only suite_craft.inl:594 does).
craft.h:191-199 admits this — but the excuse ("there is no quest system, no computer terminal
and no interactable billboard") **is now false**: quest.cpp exists, `InteractKind::Terminal`
exists and is wired (main.cpp:6422), and the NPC conversation menu exists.
**This is the single best-value unwiring in the scope: 5 new `kConvOptions` rows / one
terminal branch would revive 14 rows of authored content.**

### 4.3 UNWIRED: half the bank's public API

Declared in economy.h, defined in economy.cpp, **zero callers in `src/` outside tests**:

- `net_worth()` (economy.cpp:239) — the header calls it "the number the HUD should show". No HUD shows it.
- `wealth_tier()` / `wealth_tier_name()` (:243/:251) — with them, the whole `kWealthTiers` +
  `kWealthTierNames` tables and the 5 WEALTH rows of economy.csv.
- `band_name()` (:47) — and `kBandNames`.
- `bank_last_entry()` / `bank_op_name()` (:256/:261) — **and therefore the entire 24-slot
  `BankEntry ledger[]` ring**: `push_entry` writes it on every operation, `save.cpp:399-404`
  serialises **24 × 10 bytes = 240 bytes into every save file**, and nothing ever reads it back.
  `BankOp::DepositInterest` / `LoanInterest` are produced and never consumed.
- `bank_terms()` is used internally only.

`economy.h:293-295` still says *"**NOT in `SaveState` yet.** … today F5/F9 preserve `banked` and
forget the deposit and the debt."* — **FALSE today**: `save.cpp:389-405 visit_bank` + v16 ship it.
**LEGACY comment.**

### 4.4 DEAD: the inventory "Use" verb

- `inventory_ui.cpp:383-388` draws «Использовать [U]» and emits `InvUiRequest::Kind::Use`.
- `main.cpp:5867` switch has **no `case Kind::Use`**; `main.cpp:6053-6057 default:` swallows it
  with the comment *"Use — послотовое использование придёт со своим примитивом"*.
- `main.cpp:5714` sets `policy.allowUse = false`, so the button is never even drawn.
- `InvUiPolicy::allowUse` (inventory_ui.h:63) **defaults to `true`** — a default no caller uses.

→ **`InvUiRequest::Kind::Use` is a never-constructed enum value; inventory_ui.cpp:383-388 is
dead code; `allowUse` is a dead field.** Consumption happens only via
`use_best_food/drink/heal` on their own keys (main.cpp:4962-4979).

### 4.5 DEAD in production: `loot_containers_step`

`container.cpp:367-438` (72 lines). Callers: **tests only** (game_test.cpp:4615/4623).
`main.cpp:4595-4596` says it plainly: *"loot_containers_step остался тест-бэкендом
([container.h]) — из тика он выписан."*
`tools/check_wired.cmake:49-50` carries it as a **sanctioned self-exclusion**:
`"loot_containers_step:экран обыска заменил авто-лут; тест-бэкенд, inventory.md"`.
`container.h:117-129` still documents it as the way to loot containers. **LEGACY doc.**

### 4.6 DEAD in production: `drop_mob_loot` + `drop_weapon_ammo` public entry

`loot.cpp:160` `drop_mob_loot` — production death path uses
`loot_dead_mobs → roll_mob_loot_slots → CorpseLootPending`. Its only non-internal caller is
`tests/suite_props_game.inl:623`. loot.h:110-112 admits "kept for any non-corpse caller (debug,
scripted drops)" — there are none.
`drop_weapon_ammo` (loot.cpp:269) is called once, from inside `drop_mob_loot` (:264), i.e. from
the dead path, plus two tests. **The ammo-bundling rule loot.h:149-161 argues is load-bearing
does not run in the shipped death path.** Worth confirming with the owner — if
`roll_mob_loot_slots` has its own bundling this is fine; if not, it is a live content bug.

### 4.7 Two competing NPC-interaction entry points on the SAME key

`E` (`ConsoleRequest::Interact`) does **both** of these in one frame:
- main.cpp:3005-3018 — silently `contract_accept` / `quest_accept` whatever the proximity sweep
  parked in `offer` / `questOffer`;
- main.cpp:4148-4169 — open the conversation menu on the nearest NPC.

So walking up to any NPC and pressing E to *talk* also **silently signs any pending contract**.
Meanwhile the menu's own «ЗАДАНИЕ» row (conversation.cpp:67-78) can only print a sentence.
**DUPLICATE entry point.** The unification is obvious and cheap: make `quest_activate` return a
new `ConvActionKind::Offer` and delete the proximity accept from the Interact handler.

---

## 5. DEAD DATA, DISABLED CODE, MAGIC CONSTANTS

### 5.1 Struct fields never read (outside tests)

| field | declared | note |
|-------|----------|------|
| `BankTerms::cashCap` / `questCap` / `questRate` | economy.h:185-187 | economy.h:179-182 admits it: "carried because they are the authored contract for … systems that will price against them" |
| `BankTerms::floorLo` / `floorHi` | economy.h:191-192 | live ladder is `economy_band()` |
| `BankAccount::ledger[24]` | economy.h:306 | written every op, saved every save, never read |
| `BankAccount::interestEarned` / `interestPaid` | economy.h:300-301 | "lifetime, for the HUD" — no HUD |
| `MeleeDef::knockbackMm` / `hitRadiusMm` | weapon_table.h:33-34 | self-declared unused |
| `RangedDef::channel` | ranged_table.h:114 | no CSV column, literal `0` on all 30 rows, no reader |
| `InvUiPolicy::allowUse` | inventory_ui.h:63 | defaults true, forced false at the only call site |
| `CraftSource::kind` | craft.h:221 | tests only |
| `kPropNames` / `kPropIds` | prop_table.h:84-85 | no reader |
| `InteractDef::id` | interact_table.h:32 | no reader |

### 5.2 Enum values never constructed / never compared

- `UseEffect::HealPsi, Painkiller, Antiemetic, PsiSurge, TechnicalSpirit, Unpack, UnsealSample,
  RedeemCoupon` — **8 of 15**. Constructed from CSV, dispatched by **nothing**
  (only `Feed/FeedPsi/FeedRisky/Drink/DrinkStim/SleepingPills` in needs.cpp:357-388 and `Heal` in
  loot.cpp:443). ≈17 items whose `use_effect` column is decoration.
- `CraftSourceKind::Note, Quest, Terminal, Npc, Floor` — see §4.2.
- `CraftFail::NotDiscoverable` — craft.h:268 says so: *"nothing sets this today"*.
- `InvUiRequest::Kind::Use` — §4.4.
- `InteractKind::LightBulb` — never named in code.
- `BankOp::DepositInterest` / `LoanInterest` — produced, never read.

### 5.3 Disabled code

No `#if 0`, no `if (false)`, no early `return;` neutering anything in the scope.
`craft.cpp` has no dead branches. The only "disabled" mechanisms are the two `default:`
swallows and `policy.allowUse = false` above. **Clean on this axis.**

### 5.4 Magic constants with no derivation

| constant | site | problem |
|----------|------|---------|
| `teller_withdraw_cash(binv, ledger, **1000**)` | main.cpp:6229 | the withdrawal amount is a literal. Not derived from the bag's free stack room, the band's `cashCap`, or anything |
| `kContainerCapPct = {6, 30, 100, 45}` | container.h:61-64 | four numbers, one comment each, no derivation from container volume/kind |
| `kFetchPayMult 1.6` / `kHuntPayPerHp 3` / `kDescendPayPerBand 900` / `reward < 20 → 20` / `< 30 → 30` | contract.cpp:23-32, :77, :120 | cited to the reference's doc, not derived; and `economy.csv questRate` exists for exactly this |
| `kOfferPct = 18` vs `kQuestOfferPct = 8` | contract.cpp:16, quest.h:294 | two offer rates, both authored, neither derived |
| `pick < 45` / `pick < 80` (objective kind roll) | contract.cpp:52, :78 | bare literals |
| `d = 12.0f / 8.0f / 10.0f`, `d += 60.0f * depth01`, `hp / 12.0f`, `kTypicalWeight = 1000.0f` | contract.cpp:300-338 | difficulty weights, hand-tuned |
| `kRiskyFeedHpCost = 6` | needs.h:179 | **contradicts `items.csv use_b`** on 4/4 rows |
| `kPickupReach = 1.8f` | loot.h:91 | **contradicts `interactables.csv loot,…,2.0`** |
| `stake = money / 10` | dice.cpp:75 | 10% of pocket, undocumented |
| `economy_band` thresholds `3 / 10 / 22 / 38` | **inside a Python string**, gen_item_table.py:315-318 | see §2 |
| `kLootTableValueChecksum = 104447` | loot_table.h:228 | a hash-of-content masquerading as a constant |

---

## 6. VENDOR PURGE RESIDUE

The purge is **incomplete**. `src/game/vendor.cpp` (16 lines) and `src/game/vendor.h` (59 lines)
**still exist and are still compiled**, and `barter.cpp:3` includes vendor.h for
`VendorKind`, `kBuyMult`, `kSellMult`, `vendor_kind_for` (barter.cpp:92-95).

| location | residue | class |
|----------|---------|-------|
| `src/game/vendor.{h,cpp}` | the whole files — now just a 3-row price-multiplier table under a name for a system that was deleted | **LEGACY (rename/merge)** |
| `src/game/barter.cpp:3, :92-95` | the only real consumer | live, but should own the constants |
| `src/game/economy.h:10, :44-45, :113-114, :364` | prose about `vendor_sell_all`, `kSellPerVisitCap`, "the field the vendor reads", "NOT spendable by the vendor" | stale comments |
| `src/game/craft.h:333, :400-401, :414` | `"following vendor_buy / apply_damage"`, `"The same idiom vendor_resupply establishes"`, `"the same rule vendor_sell_all follows"` | stale comments referencing deleted functions |
| `src/game/craft.cpp` (3 sites) | `"vendor.cpp's rule"`, `"vendor's keep-alive"`, `"the same … vendor.cpp gives"` | stale |
| `src/game/console.h:184` | the console help string still lists `vendor, resupply` as commands | **stale user-facing text** (console.cpp has no such commands — verified) |
| `src/game/rumour.h:167-168`, `rumour.cpp` | prose about VendorKind | stale |
| `src/game/npc_pool.h`, `item_table.h:53` | "vendor / needs all read it", "loot/vendor code rolls cash by id" | stale |
| `tests/suite_audit.inl:130`, `audit_test.cpp:44`, `game_test.cpp:17` | `#include "game/vendor.h"` ×3 | live includes for the surviving constants |
| `tests/suite_craft.inl`, `suite_barter.inl`, `suite_audit.inl` | references to a **deleted** `suite_vendorammo.inl` | orphan references (file does not exist) |
| `Docs/specs/11_SOCIAL_SYSTEMS.md`, `21_RUMOURS_AND_INFORMATION.md`, `MASTER_ROADMAP.md` | ~25 lines citing `vendor.h:50-54`, `vendor.h:79-81`, `vendor.h:101`, `main.cpp:2081` line numbers that no longer exist | **stale specs — cite code that does not exist** |

**Proposal: delete `vendor.{h,cpp}`; move `kBuyMult`/`kSellMult`/`VendorKind`→`TradeRate`/
`vendor_kind_for`→`trade_rate_for` into `barter.h`/`barter.cpp` (≈20 lines moved, 55 deleted).**
`data/` has zero vendor residue — clean.

---

## 7. AUTHORSHIP

`git log --format='%an' -- <file>` counts, and the **creating** commit:

| file | commits (Jirnyak / marko1olo) | created by | flag |
|------|------|------------|------|
| `item_table.{h,cpp}` | 18 / 3 | **marko1olo** `224b7457` | owner-hardened |
| `craft.{h,cpp}` + `craft_table.cpp` | 9 / 3 | **marko1olo** `a7f1e217` | owner-hardened |
| `loot.cpp` | 5 / **10** | **marko1olo** `224b7457` | **marko-DOMINATED** |
| `loot.h` | 2 / **6** | **marko1olo** | **marko-DOMINATED** |
| `loot_table.{h,cpp}` | 8 / 8 | Jirnyak `124a568e` | mixed |
| **`economy.h` (431 L)** | 1 / 1 | **marko1olo** `6b75c984` | **marko-CREATED, 688 lines in one commit; owner touched it once (teller, `86bcef93`)** |
| **`economy.cpp` (309 L)** | 1 / 1 | **marko1olo** `6b75c984` | same |
| **`economy_table.cpp` + `data/economy.csv`** | 0 / 1 | **marko1olo** | **100% marko, never revised** |
| `container.{h,cpp}` | 9 / 8 | **marko1olo** `34399e4a` | mixed |
| **`contract.h`** | 1 / **5** | **marko1olo** `83bd4426` | **marko-DOMINATED** |
| **`contract.cpp`** | 4 / **6** | **marko1olo** | **marko-DOMINATED** |
| `quest.{h,cpp}` + `quest_table.cpp` + `data/quests.csv` | 10 / 6 | **marko1olo** `a7f1e217` | mixed |
| `vendor.{h,cpp}` | 6 / 5 | **marko1olo** `637eceaf` "the vendor — banked roubles finally have a use" | **marko-CREATED, system since deleted** |
| `weapon_table.*`, `ranged_table.*`, `data/weapons_*.csv` | mixed | **marko1olo** | owner-hardened |
| `barter.{h,cpp}`, `conversation.cpp`, `dice.cpp`, `inventory_give.cpp`, `equip.*`, `inventory.h`, `render/inventory_ui.cpp` | **100% Jirnyak** | Jirnyak | **clean** |
| `data/interactables.csv` | 100% Jirnyak | Jirnyak | clean |
| `data/props.csv` | 6 / 1 | marko1olo `52947b3b` "chore: automated strategic sweep" | owner-hardened |

**Pattern.** Everything the owner built himself in the last two weeks (barter, conversation,
dice, inventory_give, equip, inventory_ui) is **wired, small and has no dead columns**.
Everything marko1olo created in bulk on 2026-07-28/29 carries the dead columns, the unread
struct fields, and the 200–380-line headers. `economy.h/.cpp/economy_table.cpp/economy.csv`
is the purest case: **688 lines dropped in one commit, half of it still has no consumer.**
No `Петушков А.` commits touch this scope.

---

## 8. BLOAT: header comment-to-code ratio

| header | total | comment lines | share |
|--------|-------|---------------|-------|
| `quest.h` | 514 | 378 | **74%** |
| `economy.h` | 431 | 276 | **64%** |
| `loot_table.h` | 230 | 187 | **81%** |
| `contract.h` | 233 | 165 | 71% |
| `craft.h` | 450 | 258 | 57% |
| `item_table.h` | 233 | 113 | 48% |

`loot_table.h` carries a **30-cell measured income table** (lines 44-50) and `loot.h` a second
one (lines 35-38) that **contradicts `container.h`'s opening claim** — loot.h:28-33 says so
explicitly. Those are design essays living in headers. Not a deletion demand, but the
30-row-table-in-a-comment class is where "comments lie" starts: several of them already do
(§2 `item_mass.csv`, §4.3 save, §4.5 container looting, §4.2 "no quest system", §1.5 `ammo_id`).

## 9. GATE GAPS

`tools/check_source_rules.cmake:415-450` Rule 7 registers **items, mobs, weapons_melee,
weapons_ranged, materials, props, interactables, particles, monster_traits** — nine CSVs.
**Outside the drift gate: `data/quests.csv`, `data/economy.csv`, `data/craft_recipes.csv`.**
quest.h:118-134 documents this at length and asks for the one-line fix. Confirmed still open
today; `problems.md:689-691` says the same.
(No live drift — §0 — but "CSV edited, generator not re-run" is invisible for those three.)

---

## 10. DELETION PROPOSAL — ranked

### DELETE (safe, mechanical)

| # | what | where | LOC | class |
|---|------|-------|-----|-------|
| 1 | 13 dead columns of `data/items.csv` (443 cells each → 5,759 cells) | data/items.csv + the "deferred" list in item_table.h:14-24 | −13 cols, −11 header lines | DEAD |
| 2 | `loot_containers_step` + its tests | container.cpp:367-438, container.h:117-129, game_test.cpp:4610-4625, check_wired.cmake:49-50 | **~110** | DEAD |
| 3 | `drop_mob_loot` public entry (fold into `roll_mob_loot_slots`) | loot.cpp:160-268, loot.h:109-122 | **~120** | DEAD |
| 4 | `BankAccount::ledger[24]` + `BankEntry` + `BankOp` + `push_entry` + `bank_last_entry` + `bank_op_name` + save block | economy.h:264-286/:306/:403-405, economy.cpp:28-38/:256-273, save.cpp:399-404 (**save v17**) | **~90 code + 240 B/save** | DEAD-DATA |
| 5 | `net_worth`, `wealth_tier`, `wealth_tier_name`, `band_name`, `kWealthTiers`, `kWealthTierNames`, the 5 WEALTH rows of economy.csv | economy.h:163-213 partial, economy.cpp:47-50/:239-254, economy_table.cpp:36-55, data/economy.csv | **~70** | UNWIRED |
| 6 | `InvUiRequest::Kind::Use` + `allowUse` + the Use button branch | inventory_ui.h:26/:63, inventory_ui.cpp:383-388, main.cpp:5714/:6053-6057 | **~20** | DEAD |
| 7 | `MeleeDef::knockbackMm` / `hitRadiusMm` + 2 CSV columns | weapon_table.h:33-34, gen_weapon_table.py, weapons_melee.csv | ~10 | DEAD-DATA |
| 8 | `RangedDef::channel` | ranged_table.h:114, gen_ranged_table.py | ~5 | DEAD-DATA |
| 9 | `kPropNames`/`kPropIds`/`prop_name` + `props.csv name` + `InteractDef::id` | prop_table.h:84-85/:95, gen_prop_table.py, interact_table.h:32 | ~25 | DEAD-DATA |
| 10 | Stale vendor prose in economy.h / craft.h / craft.cpp / rumour.h / npc_pool.h / item_table.h / console.h:184 | 12 sites | ~25 | LEGACY |
| 11 | Orphan `suite_vendorammo.inl` references | suite_craft.inl, suite_barter.inl, suite_audit.inl | ~6 | LEGACY |
| 12 | Stale Docs/specs vendor sections citing dead line numbers | specs/11, specs/21, MASTER_ROADMAP | ~40 | LEGACY |

**DELETE subtotal ≈ 550 LOC + 13 CSV columns + 240 bytes/save.**

### MERGE

| # | what | why | LOC moved / saved |
|---|------|-----|-------------------|
| M1 | `vendor.{h,cpp}` → `barter.{h,cpp}` (`VendorKind`→`TradeRate`, `vendor_kind_for`→`trade_rate_for`) | last shred of a deleted system; one consumer | −55, +20 |
| M2 | `loot_table.cpp`'s 142 hand-written id rows → `data/mob_drops.csv` + `tools/gen_loot_table.py` | the only non-generated content table in the scope; kills `kLootTableValueChecksum` and its manual re-derivation ritual | −363 C++, +1 CSV +1 tool |
| M3 | `economy_band()` + `item_weight_on_floor()` out of gen_item_table.py's `FOOTER` string → `src/game/item_gating.cpp` | executable C++ inside a Python literal; and it lets gen_economy_table.py drop its regex-over-generated-.cpp cross-check | ±35 |
| M4 | `kLootValueCap[]` (item_table.h:222) → read `kBankTerms[b].lootCap` | one authority for the band cap; un-deads `economy.csv loot_cap` | −5 |
| M5 | contract.cpp's `kFetchPayMult`/`kHuntPayPerHp`/`kDescendPayPerBand`/floors → `BankTerms::questRate`/`questCap` | un-deads 3 economy.csv columns, kills 5 magic constants | ±20 |
| M6 | `kPickupReach` → `interact_def(InteractKind::Loot).reachM` | the table's own promise | −1 |
| M7 | `kRiskyFeedHpCost` → `items.csv use_b` | un-deads a column, fixes a 4/4-row data disagreement | ±5 |
| M8 | contract offer/accept → a `ConvActionKind::Offer` row in `kConvOptions`; delete the proximity accept from the `E` handler | one NPC entry point, not two on the same key | ±40 |
| M9 | craft `Note/Quest/Terminal/Npc/Floor` sources → conv-menu rows + terminal branch | revives 14 authored sources / ~40 recipes | +60 |

### KEEP (verified healthy — do not touch)

- `item_table.cpp` / `craft_table.cpp` / `quest_table.cpp` / `weapon_table.cpp` /
  `ranged_table.cpp` / `economy_table.cpp` — generated, banner-marked, committed, **zero drift**.
- `inventory.h` + `inventory_give.cpp` + `render/inventory_ui.cpp` + `equip.*` +
  `barter.*` + `conversation.*` + `dice.*` — 100% owner-authored, fully wired, no dead fields.
- `data/quests.csv` — the only CSV in the scope with **zero** dead columns.
- The craft 8-axis vector: `kCraftRecipeCount == kItemCount` is a genuinely good unification.
- Item id space unification across item/craft/melee/ranged tables.

---

## Appendix — verification commands used (all run today, 2026-08-17, HEAD 97bdf13e)

```
python3 /tmp/markoaudit/drift.py                  # regenerate all 7 tables to /tmp, diff
git status --porcelain src/game/prop_table.*      # confirm no repo write
grep -rn '<symbol>' src tests --include='*.cpp' --include='*.h' --include='*.inl'
python3 - <<'EOF'  # per-column non-empty counts + stack_declared vs stack_max
import csv; rows=list(csv.DictReader(open('data/items.csv',encoding='utf-8')))
EOF
git log --format='%an' -- <file> | sort | uniq -c
git log --reverse --format='%h %an %ad %s' --date=short -- <file> | head -1
```
