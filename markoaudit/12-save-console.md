# Audit 12 — SAVE / LOAD / PERSISTENCE + CONSOLE
**Repo:** `/Users/jirnyak/Mirror/gigahrush2` · branch `torus` · HEAD `97bdf13e`
**Date verified:** 2026-08-17 (all file:line re-checked today; no claim taken from a doc)
**Scope:** `src/game/save.{h,cpp}` (910+1460), `src/game/console.{h,cpp}` (190+814),
`src/game/keybind.cpp` (179), `src/game/nav_cache.{h,cpp}` (391+963),
`tests/suite_saveload.inl` (2053), `tests/suite_navcache.inl` (1316),
repo-root `gigahrush2_save/` + `navcache_test_tmp/`.

---

## 0. Headline

| # | Finding | Class | Severity |
|---|---|---|---|
| A | 769 MB of save data sits in the repo root; `slot2/run.sav` is **v15 against HEAD's v16** — permanently unloadable | POLLUTING / LEGACY | high |
| B | The entire `FloorStreamer` nav path — bake **and** disk cache **and** the only reader `nav_at` — is enabled by **tests only**. 2 835 LOC. | DEAD / UNWIRED | high |
| C | Commit `11c04dca` changed `kPlayerWire` **+4 without bumping `kSaveVersion`** — two incompatible formats both labelled v13 | FRAGILE | high |
| D | `PlayerSnapshot::eq` (v13) and `SaveState::quests` (v2, 294 B) are **never set in `busy_run()` and never compared in `same_run()`** — the round-trip proves nothing about them | FAKE-TEST | high |
| E | `poolBlob`/`macroBlob` (~770 KB of every real save) go through `save_write`/`save_read` **only ever empty** in tests | FAKE-TEST | high |
| F | `apply_floor_snapshot` mutates the World **before** all failure points; `main.cpp:991` then prints "floor regenerates pristine", which is false | FRAGILE | med |
| G | `SaveError::LayoutMismatch` + 4 header `*Bytes` fields are unreachable — all four sizes are already `static_assert`ed | DEAD-DATA | low |
| H | `gigahrush2.keys` / `gigahrush2.ui` are written to CWD and are **not gitignored** | POLLUTING | med |
| I | Zero migration code exists; the deletion material is ~90 lines of **version-history prose** for 15 dead versions | LEGACY | low |
| J | `console.h:181-185` documents `sell`, `vendor`, `resupply` — all three deleted | LEGACY (stale doc) | low |
| **K** | **`travel_to_saved_floor` has ZERO callers in `src/`** — 47 LOC + `LoadTravel` + 90 lines of "ordering constraint" prose + a 95-line test, for a load path the app does not take | **DEAD / UNWIRED** | **high** |
| **L** | **13 live run systems are NOT-SAVED**, incl. `PowerGridState`, `AiMemory`, `DiceGame` (a mid-game stake is **money destroyed**), and all **stains** | NOT-SAVED | high |
| **M** | `factions` + `macroBlob` are restored **only inside the `poolBlob` success branch** (`main.cpp:4696`, `:4704`) — a refused pool blob silently discards both | DEAD-DATA (conditional) | med |
| **N** | Load commits `runState = in` at `main.cpp:4675`, then `pool.init()` blanks ~950k rows at `:4690` **before** `load_rows` is known to succeed — no rollback past that line | FRAGILE | high |

**No console command is dead code.** Every registered handler's callee exists and is reached.
**`bank.lastInterestTick` IS re-armed** at `main.cpp:4786` — `save.h:165-170`'s claim holds.

---

## 1. Save-format archaeology (v1 → v16)

`git log -S 'kSaveVersion = ' --format=... -- src/game/save.h src/game/save.cpp`, then
`git show <commit>:src/game/save.h | grep kSaveVersion` for each. Verified today.

| v | commit | author | date | what was added | still live at HEAD? |
|---|---|---|---|---|---|
| 1 | `bd4db773` | **marko1olo** | 07-29 | format born: ledger, book, player snapshot, opened-crate keys | shape yes, content reshaped by v15 |
| 2 | `dafd6c90` | **marko1olo** | 07-29 | `QuestLog` appended last + `questCount`/`questFingerprint` header fields | **yes** — `save.cpp:588`, `:751` |
| 3 | `c0fbf5ae` | Jirnyak | 07-31 | CARVE LOG (28 B/op, replayed) | **DELETED in v5** |
| 4 | `92f83056` | Jirnyak | 07-31 | embedded active-floor RLE snapshot in `run.sav` | **MOVED to per-floor files in v5** |
| 5 | `b52cbd6e` | Jirnyak | 07-31 | modular `floor_<N>.sav`; `carveCount`/`snapBytes` header fields removed | **yes** — `save.h:494-510` |
| 6 | `bfcd3554` | Jirnyak | 07-31 | `poolBlob` + `macroBlob` + `FactionRelations`; header `poolBytes`/`macroBytes` | **yes** — `save.cpp:582-585`, `:733-746` |
| 7 | `6a60f5dd` | **marko1olo** | 07-31 | `RpgStats` (12 B) + `CraftingState` (89 B) | **yes** — `save.cpp:700-708` |
| 8 | `430c5d7e` | **marko1olo** | 08-01 | `PlayerRanged` + melee `kills` (21 B, SAVMAG) | **yes** — `save.cpp:709-712` |
| 9 | `1c3c2048` | **marko1olo** | 08-01 | `StatusSet` (42 B, SAVSTAT) | **yes** — `save.cpp:713-714` |
| 10 | `e73be138` | Jirnyak | 08-12 | `SamosborState` (17) + `FastTravelState` (32) (SAVCLOCK) | **yes** — `save.cpp:715-717` |
| 11 | `84be02e6` | Jirnyak | 08-13 | `Needs::hpBank` (+4) | **yes** — `save.cpp:254` |
| 12 | `1de4105b` | Jirnyak | 08-14 | craft bank 9 axes → 8 (−4) | **yes** — `kCraftingWire == 89` |
| 13 | `bbb461f6` | Jirnyak | 08-16 | `ItemSlot` u16 count → u8 count + u8 condition (0 B moved) | superseded by v14 |
| **13** | `11c04dca` | Jirnyak | 08-16 | **`PlayerSnapshot::eq` +4 — NO VERSION BUMP** | **yes** — `save.cpp:284-287` |
| 14 | `180bcc27` | Jirnyak | 08-17 | count back to u16 beside condition → 5 B/slot (+64) | **yes** — `save.cpp:264-268` |
| 15 | `0fb4647c` | Jirnyak | 08-17 | opened-key list **replaced** by `ContainerRecord` + `CorpseRecord` | **yes** — `save.cpp:348-385` |
| 16 | `0ea3a70f` | Jirnyak | 08-17 | `BankAccount` (289 B, SAVBANK) | **yes** — `save.cpp:390-406` |

### 1.1 Migration LOC: **zero**

```
src/game/save.cpp:636:    if (h.version != kSaveVersion) return fail(SaveError::BadVersion);
```
There is no per-version branch anywhere in the file. `grep -n 'h.version ==' src/game/save.cpp`
returns nothing. **There is no back-compat code to delete** — the deletion material is
documentation, not code:

| Deletable | Where | LOC |
|---|---|---|
| Version-history prose for v1–v15 (all unloadable) | `save.h:86-170` | **85** |
| Scattered `// v13:` / `// v14:` / `// Version 8 …` inline archaeology | `save.cpp` throughout | ~40 |
| `SaveError::LayoutMismatch` + 4 `*Bytes` header fields + their check | `save.h:224`, `:252-255`; `save.cpp:650-654` | ~12 (see §3.4) |
| **Total** | | **~137** |

`save.h` is **69 % comment** (632/910 lines); `nav_cache.h` is **67 %** (265/391).
That is the real weight of this subsystem, not the logic.

### 1.2 FINDING C — a wire change without a version bump (FRAGILE)

`11c04dca` ("fix(save): the player's equip decisions ride the snapshot (v13 +4)"),
whose own message says *"Wire: kPlayerWire +4, kSaveFixedWire 927 -> 931"*:

```
-inline constexpr std::size_t kPlayerWire = kNeedsWire + kInventoryWire + 4 + 4 + 4 + 3;
+inline constexpr std::size_t kPlayerWire =
```
and `kSaveVersion` stayed at **13**. This directly violates the law stated 4 lines above
the constant it left alone:

> `save.h:82-84` — *"Bump this whenever the wire layout changes in ANY way — a field added,
> a field reordered, a meaning changed."*

Two mutually unreadable formats both self-identify as v13. The only thing that catches
the older one is the `payloadBytes` subtraction gate at `save.cpp:668-679`, which reports
`SizeMismatch` ("save header contradicts its payload") instead of `BadVersion`
("save is from a different build") — the exact confusion `SaveError` exists to prevent
(`save.h:212-214`). Both v13 formats are dead now (HEAD is v16), so this is a **process**
defect, not live data loss — but the same author repeated the pattern in the pool blob:

**FINDING C2.** `bcb15996` (2026-08-13, Jirnyak) added the `role` byte to every pool row
(`npc_pool.cpp:489`), changing `kPoolRowWire` from 384 to 385 — inside `poolBlob`, which
carries no version of its own. `kSaveVersion` was **not** bumped (it went 10→11 that day
for `hpBank`, an unrelated edit). Caught only by the exact-length check at
`npc_pool.cpp:533-536` (`if (n != want) return false;`), which degrades to
"the macro world silently fails to load" rather than "this save is refused".

---

## 2. Round-trip completeness

### 2.1 What travels

`SaveState` (`save.h:552-599`) carries 15 members. All 15 are written by `save_write`
(`save.cpp:531-615`) and all 15 are parsed by `save_read` (`save.cpp:617-765`).
The write/read symmetry is structurally guaranteed by the single-`visit_*` design
(`save.cpp:28-39`) — a genuinely good decision; a field the writer emits is a field the
reader consumes, by construction, and `round_trip()`'s byte-for-byte re-serialisation
(`suite_saveload.inl:540-543`) pins it.

### 2.2 Deliberately not saved, with a stated reason (`save.h:10-38`)

Geometry (regenerated + per-floor files), monsters (re-rolled per floor/seed),
the NPC pool's non-player rows (reproduced by `seed_floor_population`), a run seed
(every seed is a compile-time literal). These reasons are sound and I verified the
per-floor file path exists (`save.h:494-510`, `save.cpp:1391-1445`).

### 2.3 Capture / restore call sites

**Capture** — all in the `save_run_now` lambda, `main.cpp:2417-2485` (early bail at
`:2420` if the player has no valid `NpcRef`, so no partial capture).
**Restore** — `main.cpp:4671-4853`, inside `if (loadWanted)` (`:4645`).

| `SaveState` field | captured | restored | note |
|---|---|---|---|
| `ledger` | continuous (reference alias `main.cpp:2104`) | `:4675` `runState = in` | |
| `book` | continuous (alias `:2067`) | `:4675` | |
| `quests` | continuous (alias `:2144`) | `:4675` | **never round-trip-tested** (§4.1) |
| `bank` | continuous (alias `:2107`) | `:4675`, tick re-armed `:4786` | |
| `player.clock/inv/hp/maxHp` | `:2423-2426` | `:4734-4735` via `apply_player_snapshot` | guarded by `pid != kInvalidNpc` `:4733` |
| `player.eq` | `:2429-2430` (**conditional** on `try_get<Equipped>`) | `:4739-4741` + `sync_armour` | **never round-trip-tested** (§4.1) |
| `player.floorNumber` | `:2433` | `:4676` → `:4723-4726` | |
| `player.cx/cy/cz` | `:2434-2439` | `:4677-4679` → `place_body_at_cell` `:4832` | |
| `rpg` | `:2443-2446` | `:4747`, `:4749-4750` | |
| `craft` | `:2447` | `:4751` | |
| `hasRanged` / `ranged` | `:2453-2457` | `:4758-4760` | |
| `kills` | `:2459` | `:4756`, `:4761-4763` | |
| `status` | `:2463` | `:4768` | |
| `samosbor` / `fastTravel` | `:2470-2471` | `:4781-4782` | |
| `containers` / `corpses` | `:2474-2475` `refresh_floor_records` | `:4797-4805` | resident floor only, both ends |
| `poolBlob` | `:2478` | `:4691-4693` | |
| `macroBlob` | `:2479` | `:4696-4699` | **nested in the poolBlob branch** — see M |
| `factions` | `:2480` | `:4704` | **nested in the poolBlob branch** — see M |

**No `SaveState` member is serialized-but-never-populated.** Four of them
(`ledger`/`book`/`bank`/`quests`) are live references into `runState`, which is why they
need no explicit copy — a good design that also explains why they cannot rot.

### 2.4 FINDING M — `factions` and `macroBlob` are conditionally discarded

```cpp
main.cpp:4691:  if (!runState.poolBlob.empty() &&
main.cpp:4692:      pool.load_rows(runState.poolBlob.data(), runState.poolBlob.size())) {
main.cpp:4696:      if (!runState.macroBlob.empty() && !macroSim.load_state(...))
main.cpp:4700:          std::fprintf(stderr, "[load] macro blob refused; clock restarts\n");
main.cpp:4703:      macroSim.set_floors_from(registry);
main.cpp:4704:      factionRel = runState.factions;
main.cpp:4705:  } else {
main.cpp:4710:      std::fprintf(stderr, "[load] pool blob refused; reseeding society\n");
main.cpp:4712:      streamer.seed_all_modules(pool);
main.cpp:4713:  }
```
A pool blob that fails `load_rows` — which is exactly what §1.2's **C2** (the unversioned
`role` byte) produces on a stale save — takes the **faction matrix and the macro clock
down with it, without a word**. The run's money, quests and XP still load. Result: run
state from the save, society freshly reseeded, faction matrix from whatever the previous
session left in `factionRel`. Three eras of the world in one game, and only one line of
stderr about it.

`factions` is not dead data in general — it is restored on the happy path — but it is
**dead on the one path where it matters most**, because it is nested one scope too deep.

### 2.5 NOT-SAVED — silent resets on load (FINDING L)

`snapshot_floor` (`save.cpp:1193-1300`) writes exactly three things: cell types (RLE),
sub-masks, and the `sub_material` sub-field. Verified:
```
$ grep -n "subfields()" src/game/save.cpp
1258:        w.subfields().find<CellType>(kSubMaterialName);
1365:        w.subfields().get_or_create<CellType>(kSubMaterialName);
```
Two hits, both `kSubMaterialName`. Everything else in `World::subfields()` and
`World::fields()` is gone on every floor revisit **and** every load.

**Live defects (user-visible, undocumented):**

| System | state lives at | consequence |
|---|---|---|
| **`PowerGridState`** | `main.cpp:1888`; `combat.h:65` | **Two defects.** (a) not saved → every shot-out breaker comes back powered. (b) `cell_key(cx,cy,cz)` (`combat.h:69`) has **no floor component**, and nothing clears the set on a floor change — so a breaker cut on floor 0 keeps the lights out at the same macro cell on *every other floor* for the rest of the session. |
| **`DiceGame`** | `main.cpp:2261`; `dice.h:43` | A game in progress vanishes. `dice_start` has **already debited the stake**, so saving mid-game and loading **destroys money**. |
| **Stains** (`kStainFieldName`, `world/stain.h:37`) | a separate sub-field from `sub_material` | Blood, oil and every liquid mark vanishes on floor revisit *and* on load. The whole "liquids paint the world" layer is session-only. |
| **`AiMemory`** | `main.cpp:2195`; `ai.h:579` | The crowd forgets every corpse seen, shot heard, and the player's last known position. |
| `DoorSet::broken` | `main.cpp:1879`; `door.h:157` | Doors reopening is documented (`save.h:19-21`); **doors the player broke coming back intact is not.** |
| `SpeechMemory` | `main.cpp:2089-2091`; `speech.h:258` | NPCs repeat lines they already said. |
| Props / `Interactable` | ECS, respawned `main.cpp:4808` | Every terminal/panel returns `active = true`; a destroyed prop comes back. Only containers and corpses have record types. |
| `offer` / `questOffer` | `main.cpp:2068`, `:2075-2076` | An offered-but-unaccepted job or quest disappears. |
| `danger` `Field<float>` | `World::fields()`, `main.cpp:3043` | Fear/panic gradients reset; the crowd's fear state is lost. |
| `deaths` counter | `main.cpp:2150` | **Asymmetry:** `kills` (`:2151`) is restored, `deaths` is not — two HUD counters disagree about the same run. Same for `samosborCycles`/`samosborDamage` (`:2055-2056`) beside a restored `SamosborState`, and `crafted`/`scrapped` beside a restored `CraftingState`. |
| `GodMode`, `NoClip`+`Controller::fly` | ECS, set by `console.cpp:229`, `:243-247` | debug toggles silently off after F9 |
| `NpcPool::rel_` (Relationships) | `npc_pool.h:139`, excluded `:461-462` | harmless **today** (nothing writes a `Relationship`); the day one does, every social bond resets |

**Deliberate and correct:** monsters (`save.h:22-24`), `NoiseField` (cleared `:4791`),
`rumourLine` (cleared `:4789`), `RoomZones` (re-derived), keybinds and UI settings (own
config files, `main.cpp:2308-2310`), `Corpse::deathTick`, `NpcPool::floor()`,
`BankAccount::lastInterestTick`.

The pattern: `save.h:10-38` lists four things it deliberately omits and argues each one
well. **None of the twelve above appears on that list.** They are omissions, not
decisions, and the header's confident tone conceals that the list has not been revisited
since v6.

### 2.6 Other DEAD-DATA

| Field | Written | Read back | Verdict |
|---|---|---|---|
| `SaveHeader::tickHz` | `save.cpp:593` | never compared (`save.cpp:640` says so) | **advisory by design** — legitimate; pinned by `suite_saveload.inl:505-521` |
| `SaveHeader::ledgerBytes`/`bookBytes`/`needsBytes`/`invBytes` | `save.cpp:601-604` | `save.cpp:650-654` → `LayoutMismatch` | **DEAD-DATA** — already a compile error (§3.4) |
| **`save_read`'s `hdrOut`** | — | `main.cpp:1016` passes `nullptr` | **DEAD FEATURE.** `save.h:628-630` designed it so a caller could say *"written by version 3, tick 120"* for a save it refused. The shell never asks. That is why `slot2` (§7.1) reports only "save is from a different build" and not *which* build. |
| **`apply_container_records`'s `openedColour`** | — | **all three call sites pass 5 args** (`main.cpp:2608`, `:4798`, `:7129`) | **DEAD PARAMETER.** `Container::opened` round-trips perfectly in the data and has **zero visual consequence** after restore — a spent crate looks unopened, exactly the caveat `save.h:657-662` flagged and nobody closed. |
| `OpenedContainerKey::pad_` / `Contract::pad_` | not written | n/a | correct |

### 2.7 FINDING K — `travel_to_saved_floor` is dead in the shipped app

```
$ grep -rn "travel_to_saved_floor" src tests | grep -v "^src/game/save"
tests/suite_saveload.inl:1630, 1641, 1652, 1676, 1691
```
**Zero hits in `src/`.** The shipped load path does not travel at all — it does a
boot-shaped restore: `streamer.unload` (`main.cpp:4688`) → `pool.init()` (`:4690`) →
`streamer.ensure_loaded` (`:4723`) → `embody_as_player` (`:4730`).

What that makes dead:

| item | LOC |
|---|---|
| `travel_to_saved_floor` body | `save.cpp:939-985` — **47** |
| `struct LoadTravel` + `kMaxLoadHops` + the `kFloorSlots` static_assert | `save.h:732-749`, `save.cpp:931-932` — 20 |
| The "**THE ORDERING CONSTRAINT, because it is not optional**" essay + the 6-step arrival sequence | `save.h:676-720` — **45** |
| `travel_drives_the_existing_elevator` | `suite_saveload.inl:1603-1698` — **95** |
| **Total** | **~207** |

The irony is sharp: `save.h:695-704` spends 10 lines proving that *"A single hop is safe;
two are not"* and instructing the caller to check `nav.baking()` between hops. The app
checks `nav.baking()` once (`main.cpp:4649`) and then never hops. The hazard the essay
describes cannot occur, because the code that would cause it is never called.

This is the same class as §8's nav_cache: correct, tested, documented at length,
and unreachable.

---

## 3. Fragility

### 3.1 Endianness / memcpy — CLEAN

`grep -n "memcpy\|reinterpret_cast" src/game/save.cpp` returns exactly two hits, both
inside `Writer::f32`/`Reader::f32` (`save.cpp:89`, `:156`), both aliasing-safe float-bit
punning. Everything else is byte-at-a-time little-endian (`save.cpp:45-95`, `:99-177`).
The blobs that pass through verbatim are also LE byte-at-a-time at their source
(`npc_pool.cpp:464-522` — `put_u16`/`put_i16`/`put_f32` per column). **No raw struct
memcpy reaches any file.** `nav_cache.cpp` follows the same rule and states it
(`nav_cache.h:77-85`); its only bulk copies are `std::uint8_t` arrays
(`nav_cache.cpp:657-662`), where there is no byte order to impose. This is the strongest
part of the subsystem and it is genuinely portable arm64-macOS ↔ x64-MSVC.

### 3.2 FINDING F — partial apply leaves a corrupt world (FRAGILE)

`apply_floor_snapshot` (`save.cpp:1302-1389`) takes **live references** to the grid
before validating anything:

```cpp
save.cpp:1310:    std::vector<CellType>& types = w.grid().types_mut();
save.cpp:1311:    std::vector<SubMask>& masks = w.grid().masks_mut();
```
and then `return false` at **nine** later points (`:1323, :1327, :1340, :1348, :1352,
:1358, :1370, :1382, :1385`) — after having already written runs into `types` and `masks`.
`save.h:616-618` admits this in as many words. `floor_file_read` calls it at
`save.cpp:1442`, i.e. *after* the CRC gate, so it only fires on a CRC-valid but
structurally malformed blob. The problem is what the app then says:

```cpp
main.cpp:990:    if (!game::floor_file_read(bytes.data(), bytes.size(), w, nullptr, &err)) {
main.cpp:991:        std::fprintf(stderr, "[save] %s refused: %s (floor regenerates pristine)\n",
```
The floor does **not** regenerate pristine — it is left half-stamped with whatever runs
were applied before the malformed one, and `apply_floor_file` returns false without
touching it again. The message contradicts the code it reports on.
Contrast `save_read`, which parses into a scratch `SaveState tmp` and commits with
`st = std::move(tmp)` only on success (`save.cpp:694`, `:763`) — that half is correct
and is pinned by `rejects_the_rest()` (`suite_saveload.inl:846-853`).

### 3.2b FINDING N — the load path has no rollback past `main.cpp:4675`

The *format-level* failure points both precede any mutation, which is good:

```
4649  if (nav.baking()) -> retry next frame                    NO mutation   [safe]
4657  read_run(in, ...) -> FAIL 1; save_read leaves `in` untouched          [safe]
4667  !spec_for_floor(in.player.floorNumber) -> FAIL 2         NO mutation   [safe]
-------------------------- LAST REFUSAL POINT --------------------------
4675  runState = in;        <-- FIRST IRREVERSIBLE MUTATION. Republishes
                                ledger + book + bank + quests at once.
                                The pre-load run is now unrecoverable.
4688  streamer.unload(...)  <-- resident floor evicted
4690  pool.init()           <-- ~950k rows BLANKED, unconditionally,
                                BEFORE the pool blob is known to parse
4691  pool.load_rows(...)   <-- may FAIL; no rollback exists (-> FINDING M)
4723  streamer.ensure_loaded -> may internally refuse the floor file
                                (apply_floor_file -> main.cpp:991, FINDING F)
4832  place_body_at_cell    -> may FAIL (placed.ok false, main.cpp:4838)
```

So a **refused save file** is clean — that part works and is tested. The hazards are the
**post-commit** failures, none of which can be undone:

* **N1 — a pool-blob failure destroys the society.** `pool.init()` at `:4690` blanks the
  pool *before* `load_rows` is attempted at `:4691`. Failure reseeds from scratch and
  skips `factionRel` and `macroSim` (FINDING M).
* **N2 — no player row is a silent split-brain.** If the scan at `:4718-4722` finds no
  `is_player && alive` row, `pid` stays `kInvalidNpc`, the guard at `:4733` skips
  `apply_player_snapshot`, `Equipped` **and** `sync_armour`. The run loads with the
  save's money, quests, XP, craft bank and status effects — and a **default** inventory,
  HP, needs and armour. **No diagnostic is printed for this case.**
* **N3 — the SAVE side has its own non-atomic window.** `save_run_now` writes the floor
  file at `main.cpp:2481` (**return value discarded**) and `run.sav` at `:2484`. Each
  file is replaced atomically by `write_bytes_file` (`:923-950`, write-beside-then-rename
  — a genuinely good pattern), but **the pair is not atomic**. If `write_run` fails, the
  slot holds a *new* `floor_<N>.sav` beside an *old* `run.sav`: geometry from a later
  moment than the run that references it.

### 3.3 Fingerprints — they DO guard (verified, not assumed)

`item_table_fingerprint` / `mob_table_fingerprint` (`save.cpp:448-458`) are FNV-1a over
every display name in table order. They are **computed and acted on**:

```cpp
save.cpp:645:    if (h.itemFingerprint != item_table_fingerprint())
save.cpp:646:        return fail(SaveError::ItemTableChanged);
save.cpp:647:    if (h.mobFingerprint != mob_table_fingerprint())
save.cpp:648:        return fail(SaveError::MobTableChanged);
```
and `weak_check_vs_strong_check()` proves the guard discriminates, using an
*independently written* FNV over a locally reordered name list
(`suite_saveload.inl:753-763`, `:779-809`). This is real, not decorative.

**One wart:** `quest_table_fingerprint` is checked but has no error code of its own —
both quest gates return `SizeMismatch` with the comment *"closest existing error for
table drift"* (`save.cpp:686-689`). A quest-table edit therefore tells the player
"save header contradicts its payload", which is a lie. Two enum values missing.

### 3.4 FINDING G — `LayoutMismatch` is unreachable (DEAD-DATA)

The check at `save.cpp:650-654` compares four host `sizeof`s against header fields.
But all four sizes are already pinned at compile time:

```
src/game/extraction.h:77:  static_assert(sizeof(RunLedger) == 40, ...
src/game/npc_pool.h:179:   static_assert(sizeof(Needs) == 40, ...
src/game/save.cpp:526:     static_assert(sizeof(ContractBook) == 88, ...
src/game/save.cpp:529:     static_assert(sizeof(Inventory) == 384, ...
```
A build in which any of them differs **does not compile**. So the runtime gate can only
fire on a *forged* header — which is exactly and only what the test does
(`suite_saveload.inl:890-892`). Cost: 8 header bytes, 4 comparisons, one `SaveError`
value, one test case. Harmless, but it is 12 lines defending a compile error.

### 3.5 Version check accepting a mismatch — no

`save.cpp:636` is a strict `!=`. The only advisory field is `tickHz`, documented at
`save.h:232-242` and pinned as advisory by test. Correct.

**But:** `kFloorFileVersion` (2) is **independent of `kSaveVersion`** (`save.h:499`).
A `kSaveVersion` bump orphans `run.sav` while leaving every `floor_<N>.sav` in the same
slot directory valid and unreferenced. That is exactly the state `gigahrush2_save/slot2/`
is in right now — see §7.

---

## 4. `suite_saveload.inl` — fakeness

18 test functions, all reached from `test_saveload_all()` (`:2034-2053`), which is called
at `tests/game_test.cpp:5341` inside an unconditional `main()`. **The suite is live.**

Overall this is a **strong** suite — notably stronger than the average in this repo. It
independently re-derives CRC-32 (pinned against the published check value `0xCBF43926`,
`:484`), independently re-derives FNV-1a (`:753`), states its own padding reasoning
(`:19-27`), and `busy_run()` (`:98-265`) deliberately fills fields with distinct
non-round values *for the stated reason* that a zero round-trip proves nothing (`:9-11`).

| test (line) | asserts | production mutation that fails it | verdict |
|---|---|---|---|
| `wire_layout` :417 | 12 `static_assert`s on wire constants; magic bytes `G H 2 S` :471-474; CRC self-validation :484; `tickHz == kSimHz == 125` :494-495; a 120 Hz save still loads :512-521 | reorder the header; change any wire constant; make the CRC a non-CRC; start rejecting on tickHz | **REAL** |
| `round_trip` :524 | write→read→`same_run`; **byte-for-byte re-serialise** :542-543; a third pass :547-550; a default `SaveState` too :554-562 | consume a field into the wrong slot (values present, order different) | **REAL — the re-serialise is the load-bearing assert** |
| `macro_world_round_trips` :584 | `NpcPool::save_rows/load_rows` over 5 rows incl. a dead row's generation, player flag, names, rebuilt floor buckets :618-644; double-load refused :646; truncation refused :650; `MacroSim::save_state/load_state` :652-666 | drop a pool column; forget to bump generation; accept a truncated blob | **REAL — but it bypasses `save_write`/`save_read` entirely.** See E below. |
| `floor_file_round_trips` :674 | carve → write → carve again → stamp onto a fresh twin → **bit-identical to the save moment** :714-717; sub-material coat survives at sub-voxel resolution :719-720; twin ≠ live world :723; five rejections each by its own gate :735-748 | break the RLE; drop sub-material pages; skip a rejection gate | **REAL — the best test in the file** |
| `weak_check_vs_strong_check` :765 | independent FNV agrees :770, :773; a **reorder at constant row count** moves the hash :782-788; a rename does too :791-794; and the format acts on it, leaving a sentinel untouched :802-809; mob table likewise :814-817; weak checks fire first :821-829 | delete either fingerprint; make the hash order-insensitive; half-apply a refused load | **REAL** |
| `rejects_the_rest` :832 | 11 rejection cases, each re-asserting a 3-field sentinel is untouched :846-853; **a CRC is not a signature** :915-925; all `SaveError` strings distinct :929-934; out-of-range code safe :936 | half-apply on failure; collapse two errors to one string; walk off the switch | **REAL** |
| `keys_not_entity_ids` :946 | the documented (floor, cell) collision is asserted as a *known property* :953; floor is part of identity :956; key truncation matches the spawner :961-965 | key on entity id; drop the floor from the key | **REAL — pins a limitation, honest** |
| `floor_records_survive_a_restart` :970 | end-to-end v15: real `generate_floor` + `spawn_floor_containers`, hand-mutate (empty every 3rd, deposit into every 5th), `refresh_floor_records`, `save_write`, destroy the floor, `save_read`, respawn, `apply_container_records`, `spawn_corpse_records`; every crate's component `memcmp`s its record :1105; deposits survive :1118; corpse pos/loot/wear survive :1129-1135; **idempotent** re-apply :1143-1151 | make refresh append instead of replace; make apply first-match-wins instead of consuming; make corpse spawn append | **REAL — the strongest end-to-end test in the subsystem** |
| `ledger_is_pinned` :1164 | `sizeof`/`alignof`/type-identity of `RunLedger`; deepest-floor `|z|` semantics :1182-1187; sign survives the file at both stack ends :1190-1203 | widen `deepestFloor`; compare signed instead of `|z|` | **REAL** |
| `cell_conventions` :1255 | `macro_cell_of(macro_cell_centre(c)) == c`; centre matches `kEmbodyCellSize`; crate key uses the identical truncation | let save-side and load-side rounding drift by one cell | **REAL** |
| `arrival_cell_is_often_a_wall` :1285 | counts solid arrival columns on a real Residential floor, `> 500` and `< 8192` :1303-1304 | — (a wide band by design; it justifies the resolver existing) | **REAL, deliberately loose** |
| `solid_cell_resolves_to_a_standable_neighbour` :1311 | wall → moved, rings 1-2, supported, **verified against the solver's own predicate** :1353; good cell untouched :1360-1362; mid-air reported not corrected :1371-1374 | make the placement test cheaper than the solver; relocate a mid-air body | **REAL** |
| `fully_solid_neighbourhood_fails_loudly` :1377 | refusal returns the **input** cell unchanged and that cell is solid :1400-1404; a wider radius finds the block's roof, derived :1413-1422; radius 0 = this cell or nothing :1427-1430 | hand back a plausible substitute on failure | **REAL** |
| `a_body_in_solid_never_moves_again` :1433 | runs the **real** `physics_step` for 1 s and asserts the body did not move at all :1459-1461, then fixes it via `place_body_safely` and asserts it rests grounded :1476-1482 | any change that makes the soft-lock non-total, or the placement non-restorative | **REAL — measures the premise instead of citing it** |
| `placement_writes_the_body_or_nothing` :1485 | placement zeroes a −30 m/s fall :1515; a refusal leaves the transform byte-identical :1526-1529; no-Transform and `entt::null` are safe :1532-1536 | write the transform before checking `ok` | **REAL** |
| `snapshot_restores_the_row_not_the_body` :1539 | row gets clock/inv/hp/maxHp; cell and floor columns deliberately **not** written :1573-1579; blank `maxHp` leaves the row's own alone :1583-1587; i32→i16 **clamped not wrapped** :1591-1596; invalid row is a no-op :1599 | write the cell (two answers to one question); truncate instead of clamp | **REAL** |
| `travel_drives_the_existing_elevator` :1603 | already-there = 0 hops :1632-1637; unregistered floor refused whole :1641-1648; sparse 0→−26 in 2 hops :1652-1673; only the destination resident :1669-1671; each floor seeded exactly once :1673; return trip :1676-1685; a body with no `NpcRef` cannot ride :1689-1697 | jump instead of hopping; forward `kInvalidNpc` (designating a second player) | **REAL** |
| `candidate_slot_recycled` :1766 | 5 cases of the ABA hole on `FloorModule::candidate`, with the pre/post-change numbers measured and quoted :1750-1755 | revert the handle to a bare `NpcId` | **REAL** — and the file itself flags this test is in the **wrong home** (`:1703-1709`) |

### 4.1 FINDING D — the two holes (FAKE-TEST)

`busy_run()` sets 60+ fields with distinct non-round values. It **never touches two**:

```
$ grep -n '\.eq\b\|Equipped' tests/suite_saveload.inl
464:    // player's Equipped cells (+4); v14 widens ...     ← a COMMENT, nothing else
$ grep -n 'quests\|QuestLog\|quest_log' tests/suite_saveload.inl
(no output)
```

* **`PlayerSnapshot::eq`** (v13, 4 B, `save.cpp:284-287`) — left at `{0,0,0,0}`.
* **`SaveState::quests`** (v2, `kQuestLogWire` = 294 B, `save.cpp:588` / `:751`) — left default.

Neither appears in `same_run()` (`:267-415`). **A serializer that wrote four literal zero
bytes instead of `p.eq`, or that dropped the quest log entirely and just skipped 294
bytes, would pass every assertion in this file** — including the byte-for-byte
re-serialisation, because both halves would be consistently wrong. That is precisely the
failure the file's own header warns about:

> `:9-11` — *"`round_trip()` … fills EVERY field with a distinct value first, because a
> round-trip over zeroes passes even when the serializer drops half the struct."*

The rule is stated and then not applied to 298 of the 1 284 fixed wire bytes (**23 %**).
`11c04dca`'s message claims *"suite_saveload roundtrip green"* — it was green because it
was blind; the diff (`git show 11c04dca -- tests/suite_saveload.inl`) only re-numbered
three `static_assert`s and one `CHECK(bytes.size() == 1046)`. **The v13 `eq` field has
never been round-trip-tested.**

### 4.2 FINDING E — the v6 blobs are only ever tested empty (FAKE-TEST)

`same_run` compares them:
```cpp
suite_saveload.inl:391:    CHECK(a.poolBlob == b.poolBlob);
suite_saveload.inl:392:    CHECK(a.macroBlob == b.macroBlob);
```
but `busy_run()` explicitly leaves them empty (`:224-225`: *"The pool/macro blobs stay
empty here so the wire pins stay arithmetic"*), and **no other test in the file calls
`save_write` with a non-empty blob**. So both asserts compare `{} == {}`.
`macro_world_round_trips` exercises `NpcPool::save_rows`/`MacroSim::save_state` directly
and never routes them through `save_write`/`save_read`.

The consequence: `save.cpp:582-583` (insert), `:660-661` + `:668-672` (the size gate that
uses `poolBytes`/`macroBytes`), and `:733-746` (the skip-and-assign parse) are
**exercised only at length 0** — and in a real save the pool blob is the *dominant*
section. Measured on this machine: `gigahrush2_save/slot1/run.sav` is **770 461 B**
against a `save_bytes_for(0)` floor of **1 388 B**, i.e. **99.8 % of every real run.sav
travels through a code path the test suite only ever runs empty.**

`wire_layout` even asserts the emptiness rather than covering it:
```cpp
suite_saveload.inl:500:    CHECK(h.poolBytes == 0u);
suite_saveload.inl:501:    CHECK(h.macroBytes == 0u);
```

---

## 5. `suite_navcache.inl` — fakeness

**Verdict: 0 fake tests, 0 tautological tests, 0 skipped tests.** 254 `CHECK` sites,
19 `static_assert`s. Wired at `tests/game_test.cpp:121` and called at `:5369`.

The `tools/check_source_rules.cmake:464` claim that it "was born dead" is **historical
and already self-corrected in the same block** (`:471-478`, "CORRECTED 2026-07-29").
It has since grown 733→1316 lines and 104→254 CHECKs.

| test (line) | verdict | note |
|---|---|---|
| `wire_layout` :377 | REAL | header offsets re-derived independently at `:116-127`; CRC instrument self-validated against `0xCBF43926` at `:381` |
| `a_half_baked_fine_is_refused` :475 | REAL | an empty `FineNav` must produce `out.empty()` |
| `names_are_stable` :498 | REAL | right-hand sides are string literals, not re-derived |
| `names_round_trip` :600 | **REAL — strongest in the file** | 540 keys round-trip + **20 enumerated near-misses refused** (`.bin.tmp`, 7/9 hex digits, upper-case, `nav_f+0`, `k256`) |
| `the_demo_stack_is_now_bounded` :534 | **MIXED** | name loop real; `CHECK(unbounded == 1363279880ull)` :556 etc. are constants-vs-literals — pins drift, catches no logic |
| `the_bound_actually_bounds` :667 | REAL | LRU made deterministic by `backdate()` :321 rather than a sleep-race; strangers neither counted nor deleted :702-705 |
| `invalidation_rejects` :828 | REAL | 15 forged-header rejections, each pinning a *specific* error code; output verified byte-identical to a **randomly filled** sentinel :256 (so a memset-then-fail is caught) |
| `the_memory_bound_is_the_section_mask` :913 | REAL | pins a *limitation* (you cannot pull 13 KB out of a 136 MB blob) rather than a virtue |
| `an_evicted_entry_keeps_its_coarse_half` :971 | REAL | 272 MB of real disk, two real bakes; downgrade 136 327 988 → 13 108 B; the downgraded entry still answers coarse-only bit-identically |
| `baked_round_trip_routes_identically` :1109 | **REAL — answers the "codec self-consistency" objection** | real `bake_coarse`+`bake_fine`, walks 17 node pairs cold, encodes, decodes, walks them warm, and compares the **full step trace** :1198-1211 |
| `report` :1236 | REAL (meta) | coverage floors: `codesHit == 8`, `walks == 38`, `namesRoundTripped == 540`, `bytesWritten == 409088760ull` — an active anti-rot device |

`fill_coarse` (`:181-195`) is deliberately anti-zero with the reason stated at `:178-180`
— the same rule `suite_saveload.inl` states and then breaks (§4.1).

**The criticism here is scope, not integrity: 1 316 lines and 254 CHECKs defending a
subsystem `src/app/main.cpp` never switches on.**

---

## 6. `console.cpp` — command table

The console **is reachable**: `keybind.cpp:105` binds action `console` → `scan::kGrave`
(`~`) with `kBindAlways | kBindTyping`. The ImGui shell is `main.cpp:625-730`;
`console.exec` is called at `main.cpp:730` (typed) and `main.cpp:2410` (keybind
dispatch). Registration: `main.cpp:2231-2232`.

37 rows registered (`console.cpp:760-811`) against `kMaxCommands = 64` (`console.h:151`).

| # | name | what it does | callee exists & reached | risk |
|---|---|---|---|---|
| 1 | `help` | prints a fixed line; the overlay renders usage from the registry | `cmd_help` :154 | — |
| 2 | `spawn <mob> [count]` | `spawn_mob_at` × N in a ring, capped at 64 | `mob_spawn.cpp:199` ✓ | mobs are NOT saved — spawned mobs vanish on load (by design) |
| 3 | `god` | toggles `GodMode` component | `combat.h` ✓ | **NOT-SAVED**: silently off after F9 |
| 4 | `noclip` | toggles `NoClip` + `Controller::fly` | ✓ | **NOT-SAVED**: silently off after F9 |
| 5 | `teleport <floor>` | sets `ctx.requestFloor`; app rides at its safe point | drained `main.cpp` ✓ | proposes only — correct seam |
| 6 | `tp <floor>` | alias of 5 | same fn ptr | redundant row |
| 7 | `fasttravel <floor>` | gated hub jump; `fast_travel_gate` + `unlock` | `fast_travel.cpp:5` ✓ | **mutates `ctx.fastTravel->unlock()` directly** (`:463`) — the one command that writes saved state outside the request seam |
| 8 | `ft <floor>` | alias of 7 | same fn ptr | redundant row |
| 9 | `ride <up\|down>` | sets `FloorUp`/`FloorDown` bits | `main.cpp:2937-2940` ✓ | — |
| 10 | `carve [radius] [power]` | proposes a sphere; clamped r≤8, power 1..65535 | drained `main.cpp:4005-4021` ✓ | mutates geometry → **does** change the floor snapshot; correctly deferred until `!doors.frozen` |
| 11 | `spawn_ball` | free body: Transform+AABB+Velocity+Renderable+GravityAffected+DynamicBodyTag | ✓ | not saved (no `DynamicBodyTag` in the format) |
| 12 | `spawn_test_ball` | **alias of 11** | same fn ptr | **redundant row** — marko1olo lineage, `629f4801`/`473a3fb4`/`97f779e6`/`784cf968` |
| 13 | `give <item> [count]` | `item_by_string` → `inventory_give` | `inventory_give.cpp:21` ✓ | writes the player's pool inventory **directly**, which IS saved — a cheat that persists |
| 14 | `gear` | prints equipped weapon/armor + wearable slots | `equip.h:54` ✓ | **never prints the `tool` slot** though `EquipSlot::Tool` exists — cosmetic gap |
| 15 | `equip <slot>` | `equip_item` + `sync_armour` | `equip.h:44`, `combat.h:539` ✓ | writes `Equipped`, which IS saved (v13) |
| 16 | `unequip <w\|a\|t>` | `unequip_slot` + `sync_armour` | `equip.h:47` ✓ | ditto |
| 17-36 | 20 `kRequestRows` (`:318-341`): `menu quit hud console mouselook fly save load heal eat drink door possess interact grenade elevator craft scrap inventory` | one bit each via `cmd_request` :383 | **all 20 drained** — `main.cpp:2884-3005` | `save`/`load` at `:2954-2955` are **not** guarded by `shell.playing()`, unlike `FloorUp`/`FloorDown`/`Fly` at `:2937-2943` |
| 37 | `attr <str\|agi\|int>` | sets `AttrStr`/`AttrAgi`/`AttrInt` | `main.cpp:2968-2986` ✓ | — |

**All 25 `ConsoleRequest` enum values are handled in `main.cpp`.** No dead bit.
**No command calls a removed function.** All 13 distinct callees verified present today.

### 6.1 FINDING J — stale doc (LEGACY)

`console.h:181-185` still documents the default set as including **`sell`, `vendor`,
`resupply`**. All three were deleted with the pad shop — `console.h:61-62` says so
14 lines earlier in the same file:

> *"(Sell/Vendor/Resupply died with the pad shop — торговля стала сделкой с телом на
> экране обыска, [conversation.md].)"*

Two comments in one header disagreeing about the same list. `kRequestRows`
(`console.cpp:318-341`) is authoritative and contains none of them.

### 6.2 Other console notes

* `complete_teleport` / `complete_fasttravel` use `static char scratch[kFloorSlots][8]`
  (`:296`, `:478`) — file-static mutable state, documented as safe for "single console,
  single thread". Not a bug today; a hard blocker for the dedicated-server stdin driver
  the header proposes at `console.h:6-8`.
* `cmd_request`'s fallback `"request: unknown row"` (`:391`) is unreachable via a
  registered name, as its own comment says. Correct.
* `cmd_gear` (`:743`) writes `out` via bare `snprintf` without the `put()` null guard.
  Safe today because `Console::exec` always passes a real buffer; the loop guard
  `static_cast<std::size_t>(n) < cap` is checked before each `out + n`, so no overflow.
* `mob_kind_from_token` (`:51`) lives in `console.cpp` because `mob_table.cpp` is
  generated. Reasonable, documented, one caller.

---

## 7. Repo pollution

| Artifact | Gitignored? | Written by | Path relative to | Size now |
|---|---|---|---|---|
| `gigahrush2_save/` | **yes** — `.gitignore:71` | **the app** — `main.cpp:876-887` | **CWD** | **769 MB, 18 files** |
| `navcache_test_tmp/` | **yes** — `.gitignore:70` | **tests** — `game_test.cpp:4940`, `:4974`; `suite_navcache.inl:292-293` | **CWD** | 0 B (empty dir, cleaned) |
| `gigahrush2.keys` | **NO** | the app — `main.cpp:2282`, written by `save_binds()` `:2295-2302` | **CWD** | absent today |
| `gigahrush2.ui` | **NO** | the app — `main.cpp:2311`, written by `save_ui_cfg()` `:2313+` | **CWD** | absent today |

### 7.1 FINDING A — 769 MB in the source tree, one slot already dead

```
$ du -sh gigahrush2_save/ ; du -sh gigahrush2_save/slot*/
769M    gigahrush2_save/
128M    slot1  128M slot2  128M slot3  128M slot6  128M slot7  128M slot8
$ ls -la gigahrush2_save/slot1/
131563714  floor_0.sav      ← 131 MB, ONE floor
  2060768  floor_5.sav
   770461  run.sav
```
Six occupied slots × ~128 MB. `.gitignore` covers it, so `git status` is clean — but this
is the working tree of a source repo, and the app puts it there because every path is
**CWD-relative** (`main.cpp:876`). Running the game from the repo root is the documented
workflow (memory: *"прострелы для проверки — этаж 5, сейвы в cwd"*), so this grows without
bound.

`floor_0.sav` at **131 MB** is the interesting number: `save.h:369-372` claims the RLE
sub-material encoding took a pristine floor from *736 → 125 MB*. Measured today it is
**131.5 MB per floor per slot** — the encoding fix landed, and the result is still two
orders of magnitude over the `kMaxSnapBytes` justification's own framing. The 1 GiB cap
(`save.h:380`) is not the binding constraint; disk is.

**And one slot is already unloadable:**
```
$ xxd -l 16 gigahrush2_save/slot2/run.sav
00000000: 4748 3253 0f00 0000 ...   GH2S....      ← version 0x0f = 15
$ xxd -l 16 gigahrush2_save/slot1/run.sav
00000000: 4748 3253 1000 0000 ...   GH2S....      ← version 0x10 = 16
```
`slot2` was written under v15 (`0fb4647c`, 2026-08-17) and `kSaveVersion` moved to 16 the
same day (`0ea3a70f`). With **zero migration code** (`save.cpp:636`), that run is gone.
Worse, `slot_occupied()` (`main.cpp:885-893`) only checks that `run.sav` **exists** — it
never reads the version — so the main menu still offers slot 2 as a loadable save and the
player only learns otherwise after clicking (`main.cpp:4666`). Its two `floor_*.sav` files
(133 MB) remain valid and permanently unreferenced, because `kFloorFileVersion` is
independent (`save.h:499`).

**This is the concrete cost of "no migration, standing rule": three version bumps in one
day (v14 → v15 → v16, all 2026-08-17) each silently invalidated every save on disk.**

### 7.2 FINDING H — two config files, not ignored

`gigahrush2.keys` and `gigahrush2.ui` are written to CWD (`main.cpp:2282`, `:2311`) and
`git check-ignore` returns nothing for either. They do not exist right now only because
`save_binds()` fires solely on a rebind/reset (`main.cpp:2377-2379`) and `save_ui_cfg()`
only on `sreq.uiChanged`. The first key rebind performed while running from the repo root
puts an untracked file in the source tree that `git add -A` will sweep in — the exact
failure `.gitignore:69` already documents for `navcache_test_tmp/`. Two lines missing.

---

## 8. `nav_cache` as a whole — FINDING B

**It is worse than the brief's hypothesis.** Not just the disk cache is test-only; the
*entire* `FloorStreamer` nav feature is.

```
src/game/floor_stream.cpp:352:    if (nav_bake()) {                     ← the whole block
src/game/floor_stream.h:171:     bool nav_bake() const { return navBake_ || !navCacheDir_.empty(); }
src/game/floor_stream.h:324:     bool navBake_ = false;   // OFF for the app, on for tests
src/game/floor_stream.h:323:     std::string navCacheDir_; // empty = on-disk nav cache disabled
```
Three switches, and **every one of them is flipped only by a test**:

| switch | only caller | file:line |
|---|---|---|
| `set_nav_cache_dir` | `tests/game_test.cpp` | `:4987` |
| `set_nav_bake` | `tests/game_test.cpp` | `:4881` |
| `nav_at` (the **only reader** of the baked result) | `tests/game_test.cpp` | `:4885, :4893, :4917, :4922, :4995, :5016` |

`src/app/main.cpp` calls none of the three. The code says so itself:

> `floor_stream.cpp:348-351` — *"GATED, and OFF by default (`set_nav_bake`): the shipping
> app steers off its own `nav::AsyncBake` and never reads `nav_at`, so doing this here
> bought a multi-second blocking stall per floor entry and 130 MiB, then freed the result
> unread. [problems.md] §26."*
> `floor_stream.h:159` — *"read the result NEVER: `nav_at` has no caller outside the tests"*

**So: the runtime bakes fresh every time, via a different structure (`nav::AsyncBake`,
`world/nav_async.h`), and never consults the disk cache at all.**

### 8.1 What that makes dead

| Component | LOC | Reachable from `src/app`? |
|---|---|---|
| `src/game/nav_cache.cpp` | 963 | no |
| `src/game/nav_cache.h` | 391 | no |
| `tests/suite_navcache.inl` | 1 316 | test-only by definition |
| `tests/game_test.cpp` nav-cache tests (`test_streamed_nav` :4867, `test_nav_cache_roundtrip` :4932, `test_streamed_nav_cache` :4971) | ~165 | test-only |
| **Total** | **2 835** | |

Plus the dead sub-features inside it, none of which any production caller can reach:
`nav_cache_evict` (the LRU sweep, ~120 LOC), `nav_cache_usage` (~40), the
`NavCachePolicy`/`NavCacheSweep`/`NavCacheUsage` structs, `load_nav_cache_sections`,
`nav_cache_parse_name`'s round-trip name validation, `write_atomic`, `downgrade_to_coarse`,
`classify_entry`, `scan_dir`, `older_first`, `tally`.

The single non-test consumer, `floor_stream.cpp:356-367`, is itself inside a block that
never executes in the app.

**Deletion is a judgement call, not a slam dunk:** the code is high quality, it is
genuinely portable, it is thoroughly tested, and it becomes live the day anything calls
`set_nav_cache_dir`. But 2 835 LOC — 1 % of the tree — sitting behind a switch nothing
flips, for a memoization of a bake the app has already replaced with a different
mechanism, is exactly the "unwired system" class from `[problems.md] §12-36`.

---

## 9. Authorship

`git log --format='%h %an %ad %s' --date=short -- <file>` — run today.

| file | commits | marko1olo / "Петушков" share |
|---|---|---|
| `src/game/save.cpp` | 23 | **7** (30 %) |
| `src/game/save.h` | 22 | **6** (27 %) |
| `src/game/console.cpp` | 16 | **6** (38 %) |
| `src/game/nav_cache.cpp` | 3 | **2** (67 %) |

No commit on any of these four files is authored by "Петушков А."

### 9.1 marko1olo's contributions, by file

**`save.cpp` / `save.h`** — he wrote **the format itself** (v1, v2) and versions 7, 8, 9,
plus the `[place]` SHOTLOG:
* `bd4db773` — *"feat: seven dead subsystems wired, a save format, and a quantization bug
  that had silently deleted a monster"* — **v1, the whole file.**
* `7ce71d54` — *"feat: six more subsystems connected — consumption, fluid, room-aware
  spawning, monster behaviours, save travel, samosbor beats"*
* `dafd6c90` — v2, QuestLog
* `6a60f5dd` — v7, RpgStats + CraftingState
* `430c5d7e` — v8, SAVMAG
* `1c3c2048` — v9, SAVSTAT
* `a3d72771` — `[place] MOVE/REFUSE` stderr

**`nav_cache`** — he wrote 2 of its 3 commits, including its test suite:
* `56c9c6a7` — *"feat(nav): nav_cache was included by the test binary and tested by
  nothing — expanded and pinned"* — **this is the commit `check_source_rules.cmake:462-467`
  singles out**: it added `nav_cache.{cpp,h}` *and* `suite_navcache.inl` and did **not**
  touch `game_test.cpp`, so the suite was uncompiled. That commit's subject says
  "**pinned**". The cmake file's verdict, quoted verbatim: *"733 lines with 104 CHECK
  sites and was born dead … For scale: WILL_FAIL at least caught 1 transition in 7; this
  caught 0 in 104."* **This is the single most load-bearing "suspicious subject" in the
  audit and it is already documented in-tree.**
* `3d35b761` — *"feat: close the recycling ABA hole, make diffusion 2.2-7.8x faster, and
  bound the nav cache"* — three unrelated changes in one commit.

**`console.cpp`** — 6 commits, 4 of them the same feature re-fixed:
* `629f4801` → `473a3fb4` (*"add missing AABB component to spawn_ball"*) → `97f779e6`
  (*"spawn_ball on live BodyPass/physics path"*) → `784cf968` (*"spawn_ball BodyPass
  CHECKs"*) — **four commits to land one debug command**, and the residue is the
  duplicate `spawn_test_ball` row at `console.cpp:801-803`.
* `689fe40f` — *"chore: automated strategic sweep (gigahrush2)"* — **an opaque subject on
  a file this audit covers.** Contentless as a changelog entry.
* `56053f41` — *"feat(attr1/agimv/rpgcmbt-shot): spend attrs 1/2/3, AGI move mult, live
  rpgcmbt proof"* — three features, one commit.

### 9.2 Salvage commits by Jirnyak

Two commits explicitly rescue work from the marko1olo fork, which is context for how much
of it needed rescuing:
* `a1f5c994` — *"fix(save,combat): спасённые из форка marko1olo проверки границ, без
  скрытого static"*
* `7ac39115` — *"feat(§24): salvage fast travel + hermetic-door flee out of the markololo
  fork"*

### 9.3 Assessment

marko1olo's save-format work is **structurally sound** — the single-`visit_*` traversal
(`save.cpp:28-39`) that makes writer/reader drift inexpressible is his design from v1 and
it is the best idea in the subsystem. His `nav_cache` code is likewise high quality. The
pattern is not bad code; it is **claims outrunning wiring** ("pinned" for a suite nothing
compiled; "seven dead subsystems wired" as one commit) and **feature-per-commit
discipline** (four commits for `spawn_ball`, three features in `3d35b761`).

---

## 10. Deletion proposal

### DELETE

| # | What | LOC | Risk | Rationale |
|---|---|---|---|---|
| D1 | `gigahrush2_save/slot2/` — the v15 run + its 2 orphan floor files | 0 (133 MB) | none | permanently unloadable (§7.1). **Owner's call — do not delete without asking.** |
| D2 | `console.cpp:801-803` `spawn_test_ball` alias row | 3 | none | exact duplicate of `spawn_ball`, marko1olo residue |
| D3 | `console.h:181-185` stale doc naming sell/vendor/resupply | 5 | none | contradicts `console.h:61-62` in the same file |
| D4 | `save.h:86-170` version-history prose for v1–v15 | 85 | none | every one of those formats is refused by `save.cpp:636`; replace with a 6-line "current wire" table |
| D5 | `SaveError::LayoutMismatch` + `ledgerBytes`/`bookBytes`/`needsBytes`/`invBytes` + the check | 12 | low | already a compile error (§3.4); frees 8 header bytes for a real field |
| **D6** | **`travel_to_saved_floor` + `LoadTravel` + `kMaxLoadHops` + the ordering-constraint essay + `travel_drives_the_existing_elevator`** | **207** | **low** | **zero callers in `src/`** (§2.7); the app does a boot-shaped restore instead. Lowest-risk large deletion in this report. |
| D7 | `apply_container_records`'s `openedColour` parameter, or its three nullptr call sites | 6 | low | dead parameter (§2.6) — **prefer wiring it**: hoist `kOpenColour` out of `container.cpp` and pass it, closing a real visual bug |
| D8 | `save_read`'s `hdrOut` out-param, or `main.cpp:1016`'s `nullptr` | 4 | low | dead feature (§2.6) — **prefer wiring it**, so a refused save names the version that wrote it |
| D9 | **`nav_cache.{h,cpp}` + `suite_navcache.inl` + 3 game_test fns** | **2 835** | **medium** | nothing in `src/app` can reach it (§8); the app uses `nav::AsyncBake` |
| | **Total** | **3 157** | | |

**D9 is the only one that needs a decision rather than an edit.** Two honest options:
(a) delete it and re-derive if the streamer nav is ever wanted; (b) keep it and **wire
`set_nav_cache_dir` in `main.cpp`**, which turns 2 835 LOC of dead weight into a working
~3.7 s-per-floor saving. What is not defensible is the current state: shipped, tested,
switched off, and undocumented as such outside two source comments.

### MERGE

| # | What | LOC |
|---|---|---|
| M1 | `tp` → `teleport`, `ft` → `fasttravel`: keep the aliases but register them from one alias table instead of four hand-written `con.add` calls | −6 |
| M2 | Fold `quest` table drift out of `SizeMismatch` into two new `SaveError` values (§3.3) | +4 |
| M3 | Move `candidate_slot_recycled` (`suite_saveload.inl:1766-2030`) to a `suite_floorstream.inl` — the test file itself says it is in the wrong home (`:1703-1709`) | ±265 |

### KEEP (and fix)

| # | What | Why |
|---|---|---|
| K1 | The `visit_*` single-traversal design (`save.cpp:28-39`) | it makes writer/reader drift inexpressible; it is the right answer |
| K2 | `item_table_fingerprint` / `mob_table_fingerprint` | real, acted on, independently tested (§3.3) |
| K3 | `save_read`'s parse-into-scratch-then-commit (`save.cpp:694`, `:763`) | correct, tested |
| K4 | The whole placement half (`find_standable_cell` etc., ~230 LOC) | measured against the real solver, not asserted |
| **F1** | **Set `busy_run().player.eq` and `.quests` to distinct values; compare them in `same_run`** | closes §4.1 — **~10 lines, highest value/effort ratio in this report** |
| **F2** | **Give `busy_run` a non-empty `poolBlob`/`macroBlob`** | closes §4.2 — 99.8 % of a real save is currently untested through `save_write` |
| **F3** | **Make `apply_floor_snapshot` parse into scratch and swap on success** (mirror `save_read`) — or fix `main.cpp:991`'s message to tell the truth | closes §3.2 |
| **F4** | **Add `gigahrush2.keys` + `gigahrush2.ui` to `.gitignore`** | 2 lines, closes §7.2 |
| **F5** | Make `slot_occupied` read the 4-byte version and mark stale slots in the menu | closes the half of §7.1 that is a UX bug rather than a data fact |
| **F6** | **Move `factionRel = runState.factions;` and the `macroSim.load_state` call out of the `poolBlob` success branch** (`main.cpp:4696`, `:4704`) | closes §2.4 (M) — ~4 lines, and it is a one-scope move |
| **F7** | **Add `cz`/floor to `PowerGridState::cell_key`** (`combat.h:69`) and clear the set on floor change | closes the cross-floor half of §2.5's power-grid defect, which is a live bug independent of saving |
| **F8** | Print a diagnostic when the load finds no player row (`main.cpp:4733` else-branch) | closes §3.2b N2 — a silent split-brain restore becomes a visible one |
| **F9** | Add `DiceGame` to `SaveState`, or refund the stake on save | closes the money-destruction path in §2.5 |

### 10.1 The one general seam, versus 2 370 hand-written lines

The current format is **one function per version, appended in place**: `save_write`
(`save.cpp:531-615`) is a flat 85-line sequence of `visit_ledger(bw, st.ledger); ...
visit_bank(bw, tmpBank);` and `save_read` is its 148-line mirror. Adding a system means
editing four places (`SaveState`, `save_write`, `save_read`, `kSaveFixedWire`) plus the
version constant plus the test — and §1.2 shows that when someone edits three of the six,
nothing catches it.

A registry seam would look like:

```cpp
// game/persist.h — one row per serializable system.
struct PersistSection {
    std::uint32_t id;              // FourCC, e.g. 'SBNK' — order-independent
    std::uint16_t version;         // PER-SECTION, so a bank change does not
                                   // invalidate a save's inventory
    std::size_t   wire;            // 0 = variable, length prefixed
    void (*write)(const void* src, Writer&);
    bool (*read)(void* dst, Reader&, std::uint16_t fileVersion);
};
// Systems self-register at static-init, the same way FloorCatalog::claim works.
bool persist_register(const PersistSection&);
```

What that buys, each against a defect this audit actually found:

| Property | Fixes |
|---|---|
| **Per-section versions** | §7.1 — v14→v15→v16 in one day would have invalidated *the bank*, not the whole run. Three total saves losses become zero. |
| **Length-prefixed, id-tagged sections** | §1.2 (C, C2) — a section that grew without a version bump is caught by its own length, and named. An unknown id is skipped, not fatal — which is *migration for free*, the thing `save.h:203-207` says is missing. |
| **One registration point** | The four-edit-site problem. `PlayerSnapshot::eq` could not have been added without a row. |
| **Generic round-trip test** | §4.1, §4.2 — a single test that fuzzes every registered section with non-zero bytes and round-trips it makes `busy_run`'s hand-maintained field list, and its two holes, structurally impossible. |
| **Scratch-and-swap per section** | §3.2 — the floor snapshot gets the same all-or-nothing the run save already has. |

Cost: `save.cpp`'s 1 460 lines would fall to roughly a 200-line codec + ~15 rows of ~20
lines each in the systems that own the state. The `Writer`/`Reader` pair
(`save.cpp:45-177`) is already the right primitive and would carry over unchanged.
The `visit_*` templates would become the per-section `write`/`read` bodies — they are
already exactly that shape.

**This is a real design, not a wish: `FloorCatalog::claim` and `ConsoleCommand` rows in
this same subsystem are the pattern, applied to two smaller problems, and both work.**

---

## 11. Classification index

* **DEAD** — `nav_cache.{h,cpp}` in production (§8); **`travel_to_saved_floor` + `LoadTravel`
  + the ordering-constraint essay (§2.7)**; `SaveError::LayoutMismatch` (§3.4)
* **UNWIRED** — `set_nav_cache_dir`, `set_nav_bake`, `nav_at` (§8); the whole
  `floor_stream.cpp:352-369` block
* **LEGACY** — v1–v15 prose in `save.h:86-170` (§1.1); `console.h:181-185` (§6.1);
  `spawn_test_ball` (§6); `slot2/run.sav` at v15 (§7.1)
* **DEAD-DATA** — 4 `*Bytes` header fields; **`save_read`'s `hdrOut` (never asked for)**;
  **`apply_container_records`'s `openedColour` (nullptr at all 3 sites)** (§2.6);
  **`factions` + `macroBlob` on the pool-blob failure path (§2.4)**;
  `Corpse::deathTick`, `NpcPool::floor()` column (both deliberate)
* **FRAGILE** — wire change at constant version ×2 (§1.2); partial world apply +
  a log line that contradicts it (§3.2); **no rollback past `main.cpp:4675`, `pool.init()`
  before `load_rows`, silent no-player-row restore, non-atomic floor+run write pair
  (§3.2b)**; quest drift reported as `SizeMismatch` (§3.3);
  `kFloorFileVersion` decoupled from `kSaveVersion` (§3.5)
* **FAKE-TEST** — `eq` + `quests` never set or compared (§4.1); `poolBlob`/`macroBlob`
  only ever empty (§4.2); `the_demo_stack_is_now_bounded`'s constant arithmetic (§5)
* **NOT-SAVED** — **`PowerGridState` (+ a floor-agnostic key), `DiceGame` (destroys
  money), all stains, `AiMemory`, `DoorSet::broken`, `SpeechMemory`, props, pending
  offers, the `danger` field, the `deaths`/`crafted`/`samosborCycles` counter asymmetry
  (§2.5)**; `GodMode`, `NoClip`/`fly`
* **POLLUTING** — 769 MB `gigahrush2_save/` at CWD (§7.1); un-ignored
  `gigahrush2.keys` / `gigahrush2.ui` (§7.2)

---

## 12. Numbers, for the record

| Measure | Value |
|---|---|
| Subsystem LOC audited | 8 276 (7 files) |
| `save.h` comment density | **69 %** (632/910) |
| `nav_cache.h` comment density | **67 %** (265/391) |
| Save format versions shipped | 16, in 20 days; **3 on 2026-08-17 alone** |
| Migration code | **0 lines** |
| Deletable (ranked, §10) | **3 157 LOC** |
| Of which zero-risk (D1-D8) | **322 LOC** |
| Repo-root save data | **769 MB / 18 files / 6 slots**, 1 slot already unloadable |
| Fixed wire bytes never round-trip-tested | **298 / 1 284 (23 %)** |
| Real `run.sav` bytes never round-trip-tested | **~99.8 %** (the pool blob) |
| `ConsoleRequest` bits declared / drained | 25 / 25 |
| Console commands registered / with a live callee | 37 / 37 |
| marko1olo share of `save.{h,cpp}` commits | 13 / 45 (29 %) |
