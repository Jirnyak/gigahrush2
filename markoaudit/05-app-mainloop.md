# Audit 05 — Application shell / main loop (LEGACY & DEAD CODE)

Scope: `src/app/` (7841 LOC total, of which `main.cpp` = 7266), `src/input/`,
`src/game/console.cpp`, `src/game/keybind.cpp`, `src/game/event_bus.cpp/.h`.
Every line reference below was read or grepped on **2026-08-17** against the
working tree on branch `torus`. Where this repo's own `problems.md` makes a
claim, I re-verified it and say whether it is still true.

Finding classes used: **DEAD / UNWIRED / DUPLICATE / LEGACY / DISABLED /
GOD-FILE / ORDERING / BLOAT**.

---

## 0. Headline

| # | Finding | Class | Evidence |
|---|---|---|---|
| 1 | `main.cpp` is 7266 lines — 7× the project's own 1000-line ceiling. ~4400 of them are not application shell. | GOD-FILE | `src/app/main.cpp:1-7266` |
| 2 | The floor-arrival sequence is written **four times** (initial build, `do_ride`, F9 load, `--shot` ride) and the four copies already disagree. | DUPLICATE / ORDERING | `:1966-1987`, `:2601-2638`, `:4795-4835`, `:7121-7174` |
| 3 | `diffusion_driver_on_floor_built` runs at **2 of the 4** arrival sites — F9 load and initial build skip it, so a load inherits the previous floor's danger field. | ORDERING | present `:2580`, `:7119`; absent at `:4819`, `:1979` |
| 4 | ~660 lines of `--shot` test-harness scripting live **inside the fixed sim tick** and mutate the world (forces yaw/wishDir, stamps RpgStats, throws grenades). | BLOAT / DEAD | `:3071-3134`, `:3391-3788`, `:7043-7239` |
| 5 | `--no-hud` is a no-op (`showHud` already defaults `false`), and there is no `--hud`. | DEAD | `:1551` vs `:1570` |
| 6 | `--floor N` silently does nothing when `--frames < 420`. | DEAD/LEGACY | `:7052` |
| 7 | 7 game systems declared+tested and never called from the tick; the repo's own gate lists them, but `nav_cache.cpp` (963 LOC) is enabled **only by a test** and is not on the list. | UNWIRED | `tools/check_wired.cmake:44-73`; `src/game/floor_stream.cpp:356` |
| 8 | `cubePass` is initialised, kept alive the whole run and destroyed — `record()` is never called. It exists only to donate a pipeline layout. | LEGACY | `:1650-1661`, `:1702`; no `cubePass.record` anywhere |
| 9 | 574-line debug ImGui panel + 373-line inventory-application block + 215-line F9 restore, all inline in the frame loop. | GOD-FILE / BLOAT | `:5105-5678`, `:5692-6064`, `:4645-4859` |
| 10 | marko1olo added **+4912 / −804** lines to `main.cpp`, mostly in unreviewed "Overseer auto-push sweep" commits. | LEGACY | `git log --numstat --author=marko1olo` |

---

## 1. Anatomy of `main.cpp` — section map

`main()` starts at `:1523` and ends at `:7266`. The frame loop is `:2649-7241`.
The fixed sim tick is `:3046-5063`.

### 1.1 Pre-`main` (file-scope), `:1-1521`

| Lines | LOC | What | Verdict |
|---|---|---|---|
| 1-20 | 20 | File banner | KEEP |
| 21-129 | 109 | 88 `#include`s, of which **2 are duplicated**: `game/macro_sim.h` (`:58`,`:92`), `sim/fluid.h` (`:88`,`:122`) | DUPLICATE |
| 132-182 | 51 | `kBuildKind`, window size, lighting tunables (`kLampIntensity`…`kSamosborFogSqueeze`) | EXTRACT → render config |
| 177 | 1 | `static std::vector<game::BakedLight> g_bakedFloorLights` — **second mutable global** added 2026-08-17, comment openly says "как g_saveSlot" | DEAD-GLOBAL |
| 184-196 | 13 | `carve_touches_light_material` | EXTRACT → `game/light_bake` |
| 198-416 | **219** | `collect_scene_lights` — 9 numbered light sources, `GIGA_LIGHT_DBG` | EXTRACT → `render/scene_lights.cpp` |
| 286-292 | 7 | Comment tombstone: "«Свет из шума» УДАЛЁН" — describes removed code | DEAD-COMMENT |
| 418-429 | 12 | `contains_icase` — a private strstr | EXTRACT/DELETE |
| 431-622 | **192** | `DrawCraftingWindowUI` — ImGui window that **mutates game state** (`craft_item`, `craft_disassemble`, `sync_armour`) | EXTRACT → `render/craft_ui.cpp` + game verbs |
| 624-747 | 124 | Console overlay (`ConsoleUiRefs`, `ConsoleInputCallback`, `DrawConsoleUI`) | EXTRACT → `render/console_ui.cpp` |
| 749-813 | 65 | `kPlayerWalkSpeed`, `kDemoFloors[10]`, `floor_catalog()` | EXTRACT → data/floor catalog |
| 815-857 | 43 | `samosbor_fog_scale`, `aim_player`, `kind_for_floor`, `spec_for_floor` | mixed |
| 859-1017 | 159 | Save-slot paths + `write_bytes_file`/`read_bytes_file`/`write_run`/`write_floor_file`/`apply_floor_file`/`read_run` | EXTRACT → `app/save_io.cpp` (legitimately app-layer I/O, just not here) |
| 873 | 1 | `int g_saveSlot = 1;` — mutable global under an explicit "No global state" rule | DEAD-GLOBAL |
| 1019-1123 | 105 | `refresh_floor_containers`/`_mobs`/`_props` — floor-population POLICY | EXTRACT → `giga_game` |
| 1136-1189 | 54 | `upload_wires` / `upload_cloths` — near-identical twins (same loop, same debug env var `GIGA_WIRE_DBG`) | DUPLICATE → one templated packer |
| 1196-1291 | 96 | `ParticleRng`, `pack_particles`, `drain_particle_bursts`, `spawn_carve_particles` | EXTRACT → `render/particle_bridge.cpp` |
| 1293-1368 | 76 | `merge_ecs_prop_meshes` | EXTRACT → same bridge |
| 1370-1429 | 60 | `begin_floor_nav` / `finish_floor_nav` | EXTRACT |
| 1441-1519 | 79 | `possess_a_survivor` / `possess_nearest_survivor` — 90 % identical | DUPLICATE → `giga_game/embody` |

**Pre-`main` total: 1521 lines. Genuinely app-shell: ~200.**

### 1.2 `main()` setup, `:1523-2647`

| Lines | LOC | What | Verdict |
|---|---|---|---|
| 1523-1583 | 61 | CLI flag parsing (13 flags, hand-rolled `if/else if` chain, no `else` for unknown flags) | KEEP (shrink) |
| 1585-1767 | 183 | SDL + Vulkan + 11 render passes. **Hand-written unwinding cascade** repeated 6× with a growing list of `destroy()` calls (`:1642-1647`, `:1672-1679`, `:1687-1695`, `:1758-1766`, `:1993-2002`) | DUPLICATE → RAII / scope guard |
| 1769-2012 | 244 | World/ECS setup + first floor build (**arrival copy #1**) | EXTRACT |
| 1789-1826 | 38 | A 38-line comment about NpcPool slot recycling that **contradicts itself** — opens "SLOT RECYCLING IS DELIBERATELY NOT ARMED HERE", then says "ARMED." and calls `set_recycling(true)` at `:1826` | DEAD-COMMENT |
| 2014-2272 | **259** | Declaration block: ~90 run-state locals, most with paragraph-length comments | BLOAT → one `RunContext` struct |
| 2274-2412 | 139 | Keybinds file I/O, `gigahrush2.ui` settings file I/O, `draw_settings_page`, `bind_key`, `refresh_console_ctx`, `exec_command` | EXTRACT → `app/config_io.cpp` |
| 2414-2485 | 72 | `save_run_now` lambda | EXTRACT |
| 2487-2647 | **161** | `do_ride` lambda (**arrival copy #2**) | EXTRACT → `game/floor_arrival.cpp` |

### 1.3 Frame loop, `:2649-7241`

| Lines | LOC | What | Verdict |
|---|---|---|---|
| 2649-2768 | 120 | Frame top: layer refresh, dirty flags, `antourage_carve_step_here` lambda, event-bus drain, `nav.poll()`, dt clamp | KEEP (shrink) |
| 2770-2871 | 102 | SDL event loop + keybind dispatch. **Mouse buttons are raw `SDL_BUTTON_LEFT/RIGHT` compares (`:2848-2865`) — unrebindable**, while every keyboard action goes through the table | LEGACY |
| 2873-3020 | 148 | Console-request drain (24 bits) | KEEP |
| 3025-3045 | 21 | Fixed-step preamble | KEEP |
| **3046-5063** | **2018** | **THE TICK** — see §2 | mixed |
| 3071-3134 | 64 | `--shot` wall-walk scripting **inside the tick** | DEAD/BLOAT |
| 3135-3172 | 38 | Comment block about the `PARKED needs_step` / `PARKED ai_step` that are no longer parked | DEAD-COMMENT |
| 3391-3788 | **398** | `--shot` action scripting: `rpgcmbt`, `mag`, `attack`, `interact`, `grenade`, `corp`, `wall`, `carve`, `status`, `save`, `load` | DEAD/BLOAT |
| 3816-3917 | 102 | Per-tick monster traits — a raw `if (kind == MobKind::X)` chain over `view<MobRef,Transform,Velocity>` | EXTRACT → `game/monster_traits.cpp` (data already there) |
| 4070-4252 | 183 | Interact resolution: corpse / crate / NPC / terminal / shield / relief | EXTRACT → `game/interact.cpp` |
| 4253-4282 | 30 | Possess-on-keypress | EXTRACT |
| 4645-4859 | **215** | F9 full world restore (**arrival copy #3**) | EXTRACT → `game/save_restore.cpp` |
| 5066-5101 | 36 | Camera + `hud_ui_draw` + gas sample | KEEP |
| **5105-5678** | **574** | The debug ImGui panel (`showHud`) — ~50 `ImGui::Text` calls | EXTRACT → `app/debug_panel.cpp` |
| 5685-5690 | 6 | Console draw | KEEP |
| 5692-6064 | **373** | Inventory / barter / loot screen — the widget is in `render/inventory_ui`, but **all 11 request handlers (Take, TakeAll, Give, Equip, Drop, Repair, Commit…) are inline here**, including item-stacking math | EXTRACT → `game/inventory_ops.cpp` |
| 6066-6083 | 18 | `requestFloor` drain | KEEP |
| 6085-6107 | 23 | Craft-window bridge | EXTRACT |
| 6109-6177 | 69 | Elevator/shaft window | EXTRACT → `render/elevator_ui.cpp` |
| 6179-6379 | 201 | Conversation + bank counter + dice window | EXTRACT (widgets exist; the glue does not) |
| 6381-6525 | 145 | Contextual interaction prompt — **duplicates the interact-resolution priority chain at `:4070-4252` in a second, silently divergent order** | DUPLICATE |
| 6527-6659 | 133 | Intro screen + main menu (hardcoded `if/else` pages, `slot_occupied()` = `fopen` × 8 **every frame** on the load page, `:6608-6621`) | BLOAT |
| 6661-6708 | 48 | Pause menu (this one IS table-driven, `MenuItem kItems[]` `:6686`) | KEEP as the pattern |
| 6710-6715 | 6 | CRT overlay | KEEP |
| 6717-7042 | 326 | Command recording: voxel-mirror upkeep, cull, gas, wire/cloth verlet, particle sim, world/body/prop draw, post pass, audio | KEEP (shrink) |
| 7043-7239 | **197** | `--shot` capture harness incl. **arrival copy #4** | EXTRACT → `tools/` or DELETE |
| 7243-7266 | 24 | Teardown | KEEP |

---

## 2. The tick — authoritative call order

`src/app/main.cpp:3046` — `while (simAccum >= kSimDt && guard++ < 8)`.
`kSimDt = 1/125 s` (`src/core/tick.h:26-27`).

### 2.1 Systems called, in order

| # | Line | Call | Notes |
|---|---|---|---|
| 1 | 3052 | `game::noise_step` | ages the noise field first, deliberately |
| 2 | 3060-3066 | `input.apply` (or wishDir zeroed when a window/console owns keys) | |
| 3 | 3071-3134 | *`--shot` wall-walk scripting* | test code in the tick |
| 4 | 3173 | `game::ai_panic_publish_step` | |
| 5 | 3175 | `diffusion_tick` | |
| 6 | 3176 | re-fetch `danger` field | ordering-critical, documented |
| 7 | 3177 | `game::ai_step` | |
| 8 | 3182 | `game::ai_equip_step` | |
| 9 | 3230 | `controller_step` | |
| 10 | 3238 | `game::bank_open` | idempotent, called every tick to dodge the two-travel-site trap |
| 11 | 3240 | `game::bank_step` | |
| 12 | 3258 | `game::samosbor_step` (+ seal damage `:3290-3326`) | must precede `finalize_deaths` by a tick |
| 13 | 3339 | `game::status_step` + move-mult fold | |
| 14 | 3391-3788 | *`--shot` action scripting* | test code in the tick |
| 15 | 3794 | `game::ai_patrol_step` | before wander — claims MotionOwner |
| 16 | 3796 | `game::wander_step` | |
| 17 | 3814 | `game::investigate_step` | |
| 18 | 3817-3917 | inline monster-trait loop | should be `monster_traits.cpp` |
| 19 | 3931 | `game::faction_feud_step` | |
| 20 | 3936 | `game::slow_step` | velocity cap after every writer |
| 21 | 3937 | `physics_step` | |
| 22 | 3941 | `game::impact_damage_step` | |
| 23 | 3944 | `game::prop_ragdoll_step` | |
| 24 | 3949 | `game::door_step` | after physics — adjacency |
| 25 | 3969-3996 | door toggle (Q) | |
| 26 | 4005-4069 | console carve → `carve_sphere` + `anchor_validate_step` + antourage | |
| 27 | 4070-4252 | interact resolution | |
| 28 | 4253-4282 | possess | |
| 29 | 4308 | `game::player_ranged_step` | |
| 30 | 4319 | `game::player_throw_step` | must follow #29 — shared cooldown |
| 31 | 4323 | `game::player_melee_step` | |
| 32 | 4329 | `game::mob_attack_step` | |
| 33 | 4339 | `game::hazard_step` | |
| 34 | 4344 | `game::projectile_step` | |
| 35 | 4373-4420 | combat carve drain | second copy of #26's body |
| 36 | 4425-4440 | drip emitters | |
| 37 | 4465 | `drain_particle_bursts` | |
| 38 | 4483-4499 | `speech_say` | |
| 39 | 4500-4539 | `rumour_for` + `contract_offer` + `quest_offer` | |
| 40 | 4548 | `game::encumbrance_step` | before needs — charges the sleep bar |
| 41 | 4550 | `game::needs_step` | |
| 42 | 4587 | `game::loot_dead_mobs` | |
| 43 | 4591 | `game::finalize_deaths` | the ONE death point |
| 44 | 4598 | `game::pickup_step` | |
| 45 | 4610-4616 | `on_extraction_pad` + `deposit_valuables` | |
| 46 | 4620-4641 | save | |
| 47 | 4645-4859 | load (full world restore) | |
| 48 | 4869-4925 | craft / scrap | |
| 49 | 4941 | `game::contract_step` | |
| 50 | 4943 | `game::quest_step` | |
| 51 | 4959-4977 | eat / drink | |
| 52 | 4978-4982 | heal | |
| 53 | 4985-5015 | death → `possess_a_survivor` | |
| 54 | 5016 | `++simTick` | |
| 55 | 5030 | `macroSim.step` every 250 ticks | |
| 56 | 5061-5062 | `simNow += kSimDt; simAccum -= kSimDt;` | |

### 2.2 UNWIRED — exists in `src/game/`, tick never calls it

| System | LOC of owning module | Declared | Called by | Class |
|---|---|---|---|---|
| `samosbor_fog_tick` | `mob_spawn.cpp` 739 | `mob_spawn.h:253` | tests only (`suite_samosbor2.inl:360`) | UNWIRED — **the samosbor's own monster population never spawns in-game** |
| `interaction_step` | `prop_system.cpp` 641 | `prop_system.h:200` | tests only | UNWIRED — main hand-rolls its own chain at `:4070-4252` |
| `prop_interact_step` | same | `prop_system.h:207` | `e2e_test.cpp:829` only | UNWIRED + DUPLICATE (wrapper over the above) |
| `loot_containers_step` | `container.cpp` 438 | `container.h:128` | tests only | UNWIRED — deliberately retired (`:4593-4596`) |
| `route_step` | `world/nav.cpp` | `world/nav.h:154` | `world_test.cpp` only | UNWIRED |
| `feed_tick` / `feed_drain` / `feed_line` / `EventFeed` | `event_bus.cpp:143-181` | `event_bus.h` | tests only | UNWIRED — the whole event **feed** (the readable log) has no consumer; main only reads the raw ring (`:2704-2754`) |
| `fluid_step` | `sim/fluid.cpp` | | nothing | UNWIRED — declared deferred; `main.cpp:5045-5060` explains |
| `cellular_step` | | | nothing | UNWIRED — declared deferred |
| **`nav_cache_write` / `nav_cache_read` / `save_nav_cache` / `load_nav_cache`** | **`nav_cache.cpp` 963** | `nav_cache.h` | `floor_stream.cpp:357-365`, gated on `!navCacheDir_.empty()`; **the only `set_nav_cache_dir` caller in the tree is `tests/game_test.cpp`** | **UNWIRED — 963 LOC + a 733-line suite reachable only from a test.** Not on `check_wired`'s deferred list because the gate only looks at `*_step`/`*_tick` names |
| `vendor_kind_for` | `vendor.cpp` 16 | `vendor.h` | `barter.cpp:92` only | LEGACY remnant of the deleted Vendor window |
| `hunt_step` / `mob_melee_step` | — | — | — | do not exist; only mentioned in prose |

The project's own gate `tools/check_wired.cmake:44-73` already declares 7 of
these with reasons — that list is honest and I confirmed each row today. What it
does **not** catch: `nav_cache` (no `_step` suffix), `EventFeed` (only
`feed_tick` is listed), and `vendor.cpp`.

### 2.3 Modules with no non-self includer at all

`craft_table`, `economy_table`, `inventory_give`, `monster_traits_table`,
`quest_table`, `ranged_pick`, `speech_table`, `status_table` — verified by
grepping every `#include "game/<m>.h"`. All except `ranged_pick` and
`inventory_give` are **generated table `.cpp` files** whose header is the
generated companion, so this is expected, not dead. `ranged_pick.cpp` (59) and
`inventory_give.cpp` (57) are genuinely orphaned translation units — worth a
one-line check before deletion.

---

## 3. CLI flags and `GIGA_*` env vars

### 3.1 Command-line flags — all parsed at `:1561-1583`

| Flag | Line | Effect | Works? | Used by tests/tools? |
|---|---|---|---|---|
| `--shot FILE` | 1563 | enter Playing directly (`:2122`), count presented frames, capture at N, quit | yes | **no** — no `add_test`, no script; docs only |
| `--frames N` | 1564 | capture frame (default 600) | yes | no |
| `--ride N` | 1565 | descend N floors, one per 420 presented frames | yes | no |
| `--floor N` | 1566-1569 | absolute teleport, fires at `shotFramesSeen % 420 == 0` (`:7052`) | **broken for `--frames < 420`** — silently stays on floor 0 | no |
| `--no-hud` / `--nohud` | 1570 | `showHud = false` | **NO-OP** — `showHud` is already `false` at `:1551`, and no flag turns it on | no |
| `--no-crt` / `--nocrt` | 1571 | `renderer.crtEnabled = false`, overrides `gigahrush2.ui` (`:2347-2349`) | yes | no |
| `--mirror-verify` | 1572 | GPU voxel-mirror readback vs CPU, on every upload + every 300 frames (`:7040`) | yes; `problems.md §38` claims it prints nothing — the calls exist, the printing is inside `voxelMirror.verify` | no |
| `--pos X Y Z` | 1573-1578 | set player pos after first embodiment | yes | no |
| `--yaw R` / `--pitch R` | 1579-1580 | radians | yes | no |
| `--orbit` | 1581 | `cam.yaw += 0.015f` **per sim tick** (`:3394`) — 125 Hz, not per frame | yes but framerate-independent in a way nobody documented | no |
| `--action STR` | 1582 | one of `wall rpgcmbt mag attack interact grenade corp carve status save load` | yes | no |

No `else` branch: an unknown flag, or a flag missing its argument, is silently
ignored. `problems.md:707-709` files this; still true at `:1561-1583`.

### 3.2 Environment variables

| Var | Where read | Effect | Live? |
|---|---|---|---|
| `GIGA_LIGHT_DBG` | `main.cpp:403` | prop-light census line every 120 frames | yes |
| `GIGA_ANTOURAGE_DEBUG` | `main.cpp:1077`, `:1323` | shield positions + magenta antourage | yes |
| `GIGA_WIRE_DBG` | `main.cpp:1154`, `:1184` | first 20 wire/cloth midpoints | yes |
| `GIGA_CARVE_DBG` | `main.cpp:4358` | carve-proposal drop counters | yes |
| `GIGA_PARTICLE_DBG` | `main.cpp:4447` | value selects CSV row; fountain 3 m ahead | yes |
| `GIGA_NO_GPU_CULL` | `main.cpp:6789` | CPU cull A/B | yes |
| `GIGA_WIRE_NOSIM` | `main.cpp:6790` | skips **both** wire and cloth sim (`:6901`, `:6932`) — the name lies | yes, misnamed |
| `GIGA_PARTICLE_NOSIM` | `main.cpp:6791` | skip particle compute | yes |
| `GIGA_GPU_TIMER` | `render/gpu_timer.cpp:42` | disable timestamps | yes |
| `GIGA_TEXTURE_DIR` | `render/cube_pass.cpp:33` | texture override | yes |
| `GIGA_NO_CRT` | `render/imgui_layer.cpp:201` | **second, independent** CRT kill switch alongside `--no-crt`/`renderer.crtEnabled` | DUPLICATE |
| `GIGA_PRESENT_MODE` | `tools/perf_notes.md:211` only | **does not exist in code** | DEAD (doc lies) |

Nine debug env vars, each with its own `static const bool` cache and its own
`fprintf` format. **Generalize into one `GIGA_DEBUG=light,wire,carve,…`
bitmask + a `dbg(channel, fmt, …)` helper** — that is ~60 lines of scattered
scaffolding collapsed to ~15.

### 3.3 Is `--shot` a trustworthy verification tool? **No.**

`problems.md:1012` claims the harness "opens the console and the craft panel and
pauses the game". **That specific claim is now STALE** — `:2122` sets
`shell.screen = AppScreen::Playing` directly and nothing in the harness opens a
window. But the tool is still unreliable, for three reasons I verified today:

1. **Frames ≠ ticks.** `shotFrames` counts *presented* frames (`:7049`), while
   sim ticks accrue from wall-clock `frameDt` (`:2682`) with a 0.1 s clamp
   (`:2768`) and an 8-step guard (`:3046`). Ticks-per-frame therefore vary with
   machine load. Two runs of the same binary with the same `--frames` produce
   different `simTick`. (This matches the owner's known "2820 vs 120" report,
   just via a different mechanism than the doc states.)
2. **The harness is not a passive observer.** With `--action`, code *inside the
   tick* forces `cam.yaw`/`cam.pitch`/`ctl->wishDir` (`:3119-3132`), stamps an
   RpgStats sheet (`:3406-3413`), rewrites inventory slots 0-1 (`:3466-3467`),
   forces `attackHeld = true` every tick, and queues carves. Anything measured
   under `--action` is measured on a mutated world.
3. **`--floor` fails silently below 420 frames** (`:7052`), and `--ride` hops on
   the same modulus (`:7056`) — so short captures photograph the wrong floor
   with no warning. `problems.md §38` filed this; **still live**.

Additionally, the `--shot` ride path (`:7056-7177`) is a hand-maintained copy of
`do_ride` — see §4.1.

---

## 4. Duplicated glue

### 4.1 Floor-arrival sequence — 4 copies (DUPLICATE, highest value)

| Step | init `:1966+` | `do_ride` `:2601+` | F9 load `:4795+` | `--shot` `:7121+` |
|---|---|---|---|---|
| `refresh_floor_mobs` | 1966 | 2601 | 4806 | 7121 |
| `refresh_floor_containers` | 1967 | 2602 | 4795 | 7122 |
| `refresh_floor_props` | 1968 | 2603 | 4808 | 7124 |
| `apply_container_records` | — | 2608 | 4798 | 7129 |
| `spawn_corpse_records` | — | 2611 | 4802 | 7132 |
| `door_build` | 1975 | 2618 | 4813 | 7141 |
| `doors.frozen = true` | 1978 | 2621 | 4818 | 7145 |
| `begin_floor_nav` | 1979 | 2622 | 4819 | 7146 |
| `voxelMirror.upload_all` | 2010 | 2625 | 4827 | 7147 |
| `merge_ecs_prop_meshes` + `upload_wires` + `upload_cloths` | 1982-1986 | 2628-2632 | 4821-4825 | 7152-7156 |
| `place_body_safely` | **—** | 2638 | (`place_body_at_cell` 4832) | 7174 |
| **`diffusion_driver_on_floor_built`** | **—** | 2580 | **—** | 7119 |
| `samosbor_enter_floor` | — | 2575 | (restored 4781) | 7111 |
| `noise_clear` | — | 2595 | 4791 | 7170 |
| `currentSpec = spec_for_floor` | 1956 | 2596 | 4726 | 7106 |
| `record_floor(ledger,…)` | — | 2560 | — | 7095 |
| `save_run_now()` autosave | — | 2645 | — | 7150 |

Two live divergences fall straight out of the table:

- **ORDERING/BUG:** `diffusion_driver_on_floor_built` is missing from the F9
  load path. `main.cpp:2576-2580` states the contract in capitals — a
  `LevelStack` slot is recycled and `generate_floor` clears the grid but *not*
  the `FieldRegistry`, so the departed floor's danger sits in the arrival's
  cells. F9 does exactly that recycle (`streamer.unload` `:4688` →
  `ensure_loaded` `:4723`) and never calls the contract. The initial build
  (`:1979`) also skips it, which is benign only because there is no departed
  floor yet.
- The file itself warns about this shape **four separate times**
  (`:2497-2505`, `:7062-7064`, `:7096-7106`, `:7158-7162`). Every one of those
  warnings is a scar from a bug that shipped.

**Proposal:** one `game::arrive_on_floor(ArrivalCtx&)` in `giga_game`, with the
app supplying only the GPU-side callbacks (`upload_all`, `merge_…`). Removes
~330 duplicated lines and makes the fifth travel site impossible to get wrong.

### 4.2 Interact-priority chain — 2 copies, divergent order

| Priority | Sim path `:4070-4252` | Prompt path `:6381-6525` |
|---|---|---|
| 1 | Corpse (`:4082`) | Door (`:6398`) |
| 2 | Container (`:4107`) | Terminal (`:6420`) |
| 3 | NPC conversation (`:4148`) | ElectricalShield (`:6430`) |
| 4 | Terminal (`:4175`) | Corpse (`:6450`) |
| 5 | ElectricalShield (`:4201`) | Possess (`:6470`) |
| 6 | Relief (`:4224`) | Elevator (`:6489`) |
| 7 | — | Relief (`:6497`) |

**The HUD prompt and the actual action disagree about what E does.** Container
and NPC-conversation have no prompt at all; Door and Elevator have prompts but
are on different keys. **Generalize into one `interact_candidates()` table in
`giga_game`, returning `{kind, prompt, verb}`** — the prompt and the effect then
come from the same row by construction.

### 4.3 Carve-and-consequences block — 2 copies

`:4005-4069` (console carve) and `:4373-4420` (combat carve drain) are the same
seven steps: `carve_touches_light_material` → `carve_sphere` →
`bake_material_lights` → `mark_dirty` → `spawn_carve_particles` →
`anchor_validate_step` → `antourage_carve_step_here`. ~60 duplicated lines.
**Generalize into `apply_carve(op)`.**

### 4.4 Verlet primitive glue — 2 near-identical copies

- `upload_wires` (`:1136-1159`) / `upload_cloths` (`:1163-1189`) — same shape,
  same `GIGA_WIRE_DBG` gate.
- Wire alive/pin loop (`:6874-6905`) / cloth alive/pin loop (`:6908-6936`) —
  same `FallClock`, same `write_alive`/`write_pins`, same `record_sim`, and both
  gated on the *same* `noWireSim` flag.

**Generalize into one `VerletPass` interface** — ~110 lines to ~55.

### 4.5 Vulkan init unwinding — 6 copies

`:1642-1647`, `:1672-1679`, `:1687-1695`, `:1758-1766`, `:1993-2002`, `:7244-7257`.
Each is the destroy list as it stood at that point, hand-maintained. Adding a
pass means editing up to six sites; the `:1758` copy already **omits
`propPass`, `cullPass`, `wirePass`, `clothPass`, `gasPass`, `particlePass`**
that were initialised above it. **Generalize with RAII wrappers or a
`std::vector<std::function<void()>> unwind`.**

### 4.6 Craft-station resolution — 3 copies

`:4872-4880` (tick), `:6027-6039` (repair request), `:6088-6096` (craft window).
Identical `on_extraction_pad ? Workbench : nearTerm ? NetTerminal : Any`.
**Generalize into `game::station_at(world, pos, reg, player)`.**

### 4.7 `possess_a_survivor` vs `possess_nearest_survivor`

`:1441-1467` and `:1469-1519` — the second is the first plus a distance test and
a progression transfer. **One function with a `reachM` (or `-1` for "any")**.

### 4.8 Toroidal-delta math inlined

`wrap_delta_f(a, b, kWorldExtent)` triples appear **13 times** in `main.cpp`
(`:221-223`, `:1481-1483`, `:3105-3108`, `:3604-3608`, `:3634-3638`,
`:3649-3652`, `:3841-3843`, `:3857-3859`, `:4116-4121`, `:5465-5467`,
`:6190-6192`, `:6476-6478`). Four of them use the **wrong form**: `:1482`,
`:3606`, `:3636`, `:6477` compute plain `a.y - b.y` for the Y axis while
wrapping X and Z — an isotropy violation on a torus (`core/wrap.h` has the right
primitive). **Generalize into `wrap_dist2(a, b)`** and the class of bug goes
away.

### 4.9 Near-identical ImGui panels

8 `ImGui::Begin` sites in `main.cpp` (`:440`, `:699`, `:5109`, `:6134`, `:6514`,
`:6540`, `:6588`, `:6673`) plus the intro/menu backgrounds at `:6544-6549` and
`:6577-6582` which are a **literal copy-paste** (fill `IM_COL32(2,8,3,255)`,
scanlines every 4 px). `settings_ui.cpp` already demonstrates the right pattern
(a `SettingsTab kTabs[]` table); `hud_ui.cpp` too (`HudElement g_elements[]`).
**Apply the same table pattern to the remaining panels.**

---

## 5. Dead / disabled / unreachable

| Item | Line | Class | Note |
|---|---|---|---|
| `--no-hud` | 1570 | DEAD | no-op; `showHud` already `false` |
| `GIGA_PRESENT_MODE` | `tools/perf_notes.md:211` | DEAD | documented, does not exist in code |
| `UiShell::ui_owns_input()` | `ui_shell.h:57` | DEAD | **zero callers**; `main.cpp:2819-2821` re-implements the gate inline with different terms (`showConsole \|\| WantTextInput \|\| window != None`) |
| `UiWindow::Dialog` | `ui_shell.h:44` | DEAD | reserved, never set, never read |
| `int menuPage` | 2305 | DUPLICATE | a **second** menu-page variable beside `shell.menuPage`; pause menu uses the local (`:6679`), main menu uses the shell's (`:6595`). `ui_shell.h:1-9` claims to be the single source of truth for exactly this |
| `cubePass` | 1650-1661 | LEGACY | init + destroy only; `record()` never called. Kept as texture-array owner + pipeline-layout donor (`:1663-1666`, `:1702`). ~50 lines of live GPU objects for a layout |
| `[[maybe_unused]] double simNow` + 5-line comment | 2026-2030 | LEGACY-COMMENT | comment says "its only consumer is the PARKED ai_step" — **false**: read at `:3177` and `:4551` |
| `[[maybe_unused]] shots` | 2103 | BLOAT | write-only accumulator kept for a side-effecting RHS |
| `[[maybe_unused]] banked` | 2141 | BLOAT | same |
| `[[maybe_unused]] loot` | 2214 | BLOAT | same |
| "PARKED: `needs_step`" comment | 3140-3145 | DEAD-COMMENT | the real call is at `:4550` |
| "THE UTILITY AI, UNPARKED" 27-line comment | 3146-3172 | DEAD-COMMENT | describes a call that has been live for months |
| "SLOT RECYCLING IS DELIBERATELY NOT ARMED" | 1789-1826 | DEAD-COMMENT | self-contradicting; `set_recycling(true)` at `:1826` |
| "«Свет из шума» УДАЛЁН" tombstone | 286-292 | DEAD-COMMENT | describes deleted code |
| "Шаги игрока БОЛЬШЕ НЕ ЗДЕСЬ" tombstone | 3801-3807 | DEAD-COMMENT | |
| "Тёмная адаптация … УДАЛЕНА" tombstone | 7008-7018 | DEAD-COMMENT | |
| Empty comment fragment | 4470-4473 | DEAD-COMMENT | starts mid-sentence ("them and still before finalize_deaths") — the code it described is gone |
| `spawn_test_ball` | `console.cpp:801` | DUPLICATE | alias of `spawn_ball`; `tp` alias of `teleport` (`:773`) and `ft` of `fasttravel` (`:778`) are deliberate, this one is not documented as such |
| `--- Interactive ImGui Crafting Workbench & Trader Windows ---` | 5680 | DEAD-COMMENT | the Trader window was deleted; the header remains above the *console* block |
| `slot_occupied()` in menu loop | 6608, 6631 | BLOAT | up to 16 `fopen`/`fclose` per frame while the load/new-game page is open |

**No `#if 0`, no `if (false)`, no commented-out code blocks** — the file is
clean of those. Its dead weight is stale prose and duplicated live code, not
disabled code.

### 5.1 Keybind ↔ console ↔ panel reachability — cross-checked, CLEAN

- All 23 command-bearing rows in `keybind_register_defaults`
  (`keybind.cpp:104-148`) resolve to a registered console command
  (`console.cpp:760-811`). No dangling bind.
- All 24 `ConsoleRequest` enumerators (`console.h`) are drained in
  `main.cpp:2884-3019`. No orphan bit.
- All 5 live `UiWindow` values are reachable: Inventory (`I`/`inventory`),
  Craft (`C`/`craft`), Elevator (`L`/`elevator`), Conversation (E on a live NPC,
  `:4164`), plus the bank/dice sub-panels inside Conversation. Only `Dialog` is
  unreachable.
- `fly` has scancode `0` by design (`keybind.cpp:118`) — console-only. Correct
  and documented.
- **Gap:** mouse buttons are hardcoded (`main.cpp:2848-2865`). Attack and
  hold-to-look cannot be rebound while every keyboard action can.

---

## 6. Ordering hazards

| # | Hazard | Evidence |
|---|---|---|
| O1 | **Load-bearing but only prose-documented order** in the tick: `ai_panic_publish_step` → `diffusion_tick` → *re-fetch `danger`* → `ai_step`. The re-fetch at `:3176` exists because the first publish on a floor *creates* the field and the pre-loop pointer (`:3043`) predates it. Nothing enforces this. | `:3173-3177` |
| O2 | `player_ranged_step` **must** precede `player_throw_step` — they share one `PlayerRanged::cooldownMs` decrement. Comment-only. | `:4308-4322` |
| O3 | `samosbor_step` must precede `finalize_deaths` by a whole tick (the seal can kill). Comment-only. | `:3251-3255` vs `:4591` |
| O4 | `encumbrance_step` must precede `needs_step` — it charges the same sleep bar. Comment-only. | `:4545-4551` |
| O5 | `slow_step` must run after every velocity writer and before `physics_step`. Comment-only. | `:3933-3937` |
| O6 | `door_build` → `doors.frozen = true` → `begin_floor_nav`; the async bake holds a raw `MacroGrid*`. Four copies of this order (§4.1) — one is one edit away from being wrong. | `:1975-1979` etc. |
| O7 | Particle compute must be recorded **after** the voxel-mirror flush (barrier ordering). Comment-only. | `:6942-6955` |
| O8 | **Bus drain must be once per frame, not per substep** — `relations_drain_deaths` is only snapshot-bounded within one call, and the fixed loop can run 8 substeps. Correctly placed at `:2753`, but this is exactly the double-count trap. | `:2745-2754` |
| O9 | **Death-spiral, still live.** `frameDt` clamped to 0.1 s (`:2768`); the loop runs at most 8 × 8 ms = 0.064 s (`:3046`); there is **no** "if the guard tripped, drop the remainder" line. Any frame heavier than 64 ms grows `simAccum` permanently, and the HUD prints `1/frameDt` of the *already clamped* value (`:5110`), so a 500 ms freeze reads as a steady 10 FPS. `problems.md §29` filed this; unchanged. | `:2768`, `:3046`, `:5061-5062` |
| O10 | **Double-stagger risk (the documented past defect) — currently CLEAN.** I checked every system for a second call site: `needs_step` and `ai_step` each match twice by grep but one match is a comment (`:3140`, `:3163`). `anchor_validate_step` runs 3× per frame but on *disjoint* dirty-cell sets (console carve, combat carve, door edits) — correct. `merge_ecs_prop_meshes`/`upload_wires`/`upload_cloths` run at arrival sites **and** at `:6773-6784`, correctly split behind `propPassNeedsRebuild` vs `dressingSetChanged` (the §28.4 fix, verified at `:2651-2661`, `:6779-6784`). |
| O11 | `activeLayer` is written at frame top (`:2650`) **and** inside `do_ride` (`:2641`), F9 (`:4728`) and `--shot` ride (`:7115`). This is the fix for a real bug, but it means 4 writers of one variable across a frame — the next travel site has to remember. | |
| O12 | `static` locals inside the frame loop that survive floor changes: `gasSeedFloor`/`gasSeedLayer` (`:6826-6827`) correctly key on `(floor, layer)`; `wireFall`/`clothFall` (`:6887`, `:6917`) reset only on **size** change — two floors with the same wire count keep the previous floor's fall clocks. | `:6887-6888` |

---

## 7. Authorship

```
git log --numstat -- src/app/main.cpp   (totals by author)
  Jirnyak  : +5110 −1917
  marko1olo: +4912 − 804
```

marko1olo's 27 commits touching `main.cpp` (2026-07-31 … 2026-08-15). The
largest are **not** feature commits:

| Commit | Date | +/− | Subject |
|---|---|---|---|
| `11183cb1` | 07-31 | +95/−0 | `chore(auto): sync working tree before rebase` |
| `54086888` | 08-01 | +76/−99 | `chore: Overseer 30-min auto-push sweep [18:30]` |
| `c9bb8bf8` | 08-01 | +55/−44 | `chore: Overseer 15-min auto-push sweep [20:45]` |
| `adbcffd8` | 08-01 | +48/−22 | `chore: Overseer 15-min auto-push sweep [15:15]` |
| `15a6a924` | 08-14 | +35/−8 | samosbor hermetic-door shelter + PSI drain |
| `ab12d578` | 08-01 | +32/−3 | `chore: Overseer 30-min auto-push sweep [20:00]` |
| `62653ae0` | 08-01 | +32/−24 | ceiling LightBulb ECS seed |
| `45682912` | 08-01 | +24/−27 | `chore: Overseer 30-min production audit sweep` |

**~330 lines of `main.cpp` arrived through commits whose subject is "auto-push
sweep"** — i.e. with no stated intent and no review. Attributable
marko1olo code still live today:

- `:3290-3326` — the hermetic-door shelter check inside `samosbor_step`
  (`15a6a924`). This is the `for (const auto& d : doors.doors)` linear scan with
  a magic `<= 16` (cells²) radius; it is gameplay logic in the app layer.
- `:5207-5229` — the HP progress bar in the debug panel (`ce7c3c4e`).
- `:5073` — `compute_camera(reg, aspect, worldUp)` gravity up-vector
  (`9453c2d7`) — small and correct.
- `:1304` / `:1235` / `:1256` / `:4427` / `:6845` — `static std::vector` scratch
  buffers (`d1d8b9f6`). Correct optimisation, but it makes those functions
  non-reentrant and thread-hostile with no comment saying so.
- `LazyFieldBaker`/`LazyFieldRebaker` (`c3390e87`, `0767f72b`) — **already
  deleted** by `29527e9c` ("delete LazyFieldBaker — orphaned duplicate whose
  output nothing read").

`tools/check_wired.cmake` is itself lifted from marko1olo's branch and its
header records that **1 of 39 of his commits survived review**, plus the two
holes that had to be closed in it first. Treat the surviving `main.cpp` hunks
with the same suspicion — in particular the `<= 16` shelter radius at `:3303`,
which is a magic number with no derivation (a direct hit on the owner's
"constants must derive" rule).

Note: `git log --format='%an'` shows no `Петушков А.` commits touching
`main.cpp`; his work is elsewhere (Windows/multiplatform).

---

## 8. Deletion / extraction / keep — ranked

### 8.1 DELETE outright (~760 LOC)

| Rank | What | Lines | LOC | Why |
|---|---|---|---|---|
| 1 | `--shot --action` scripting inside the tick | 3391-3788 | 398 | Test harness in the production sim loop. Nothing automated uses it; every `--action` mutates the world it claims to observe. |
| 2 | `--shot` ride block (arrival copy #4) | 7056-7177 | 122 | Delete the copy; call the extracted `arrive_on_floor` |
| 3 | `--shot` wall-walk scripting | 3071-3134 | 64 | same |
| 4 | `--shot` mag/gpu proof printing | 7190-7236 | 47 | one-off proofs for shipped features |
| 5 | Stale comment tombstones | 1789-1826, 3135-3172, 286-292, 3801-3807, 7008-7018, 4470-4473, 5680 | ~90 | prose describing code that no longer exists, some of it actively false |
| 6 | `--no-hud` flag | 1570 | 1 | no-op |
| 7 | Duplicate `#include`s | 92, 122 | 2 | |
| 8 | `UiShell::ui_owns_input()` + `UiWindow::Dialog` | `ui_shell.h:44,57` | 5 | zero callers |
| 9 | `int menuPage` local | 2305 + 6 sites | ~8 | use `shell.menuPage` |
| 10 | `cubePass` (after moving the texture array + layout to `RaymarchPass`) | 1650-1661 + 5 destroy sites | ~20 | a whole GPU pass alive for a pipeline layout |
| 11 | `vendor.cpp` (fold `vendor_kind_for` into `barter.cpp`) | — | 16 | last remnant of the deleted Vendor system |
| 12 | **Decide `nav_cache.cpp` + `suite_navcache.inl`** | — | 963 + 733 | either wire `set_nav_cache_dir` in `main.cpp` or delete both. 1696 LOC currently reachable only from a test. |

### 8.2 EXTRACT into modules (~4000 LOC out of `main.cpp`)

| Rank | Block | Lines | LOC | Destination |
|---|---|---|---|---|
| 1 | **Floor arrival ×4** | §4.1 | ~330 → ~90 | `giga_game/floor_arrival.cpp` — `arrive_on_floor(ArrivalCtx&)`. Kills the highest-value bug class in the file. |
| 2 | Debug HUD panel | 5105-5678 | 574 | `app/debug_panel.cpp`, table-driven like `hud_ui.cpp` |
| 3 | Inventory/barter/loot request handlers | 5692-6064 | 373 | `giga_game/inventory_ops.cpp` (headless-testable) |
| 4 | F9 world restore | 4645-4859 | 215 | `giga_game/save_restore.cpp` |
| 5 | `collect_scene_lights` | 198-416 | 219 | `render/scene_lights.cpp` |
| 6 | Conversation/bank/dice glue | 6179-6379 | 201 | `render/*_ui.cpp` + `game` verbs |
| 7 | `DrawCraftingWindowUI` | 431-622 | 192 | `render/craft_ui.cpp`; move mutations to `game/craft` |
| 8 | Interact resolution + prompt (merged) | 4070-4252, 6381-6525 | 328 → ~120 | `giga_game/interact.cpp` — one candidate table |
| 9 | Save-slot file I/O | 859-1017 | 159 | `app/save_io.cpp` |
| 10 | Intro + main menu | 6527-6659 | 133 | `app/menu_ui.cpp`, table-driven |
| 11 | Run-state declaration block | 2014-2272 | 259 → ~40 | one `RunContext` struct |
| 12 | Per-tick monster traits | 3816-3917 | 102 | `giga_game/monster_traits.cpp` |
| 13 | Particle/prop/wire GPU bridge | 1136-1368 | 226 → ~140 | `render/app_bridge.cpp`; merge the wire/cloth twins |
| 14 | Keybind + UI-config file I/O | 2274-2412 | 139 | `app/config_io.cpp` |
| 15 | `refresh_floor_*` | 1019-1123 | 105 | `giga_game` (floor population policy) |
| 16 | `possess_*` (merged) | 1441-1519 | 79 → ~45 | `giga_game/embody.cpp` |
| 17 | Console overlay | 624-747 | 124 | `render/console_ui.cpp` |
| 18 | Elevator window | 6109-6177 | 69 | `render/elevator_ui.cpp` |
| 19 | Vulkan init/teardown | 1585-1767, 7243-7266 | 207 → ~90 | RAII; kills 6 unwinding copies |

### 8.3 KEEP in `main.cpp`

- `main()` argument parsing (~40 lines after cleanup)
- SDL window + device bring-up call sequence (~90 with RAII)
- The frame loop skeleton: dt, event pump, request drain, the **tick call order
  list** (this is the one thing that legitimately belongs in the app), render
  submission, present
- Teardown (~24)

### 8.4 How small can `main.cpp` honestly become?

| | LOC |
|---|---|
| Today | **7266** |
| − delete outright | −760 |
| − extract to modules | −4000 (of which ~1100 come back as call sites/glue) |
| **Honest target** | **≈ 800–900** |

That lands inside the project's own "review over 800, never exceed 1000" rule
for the first time. It is achievable in ~6 independent commits, and the first
one (§8.2 rank 1, floor arrival) is both the smallest and the one that closes a
live bug.

---

## 9. Supporting files — verdicts

| File | LOC | Verdict |
|---|---|---|
| `src/app/hud_ui.cpp/.h` | 324 | **KEEP AS THE MODEL.** Table-driven (`HudElement g_elements[]`), each element self-declares its slot and its liveness predicate. This is exactly the shape the other 4000 lines should take. |
| `src/app/settings_ui.cpp/.h` | 184 | **KEEP AS THE MODEL.** `SettingsTab kTabs[]`, one code path for the menu and the pause screen. |
| `src/app/ui_shell.h` | 67 | KEEP, minus `ui_owns_input()` and `Dialog`. Its "single source of truth" claim is undermined by `main.cpp:2305`'s duplicate `menuPage` and `:2819`'s hand-rolled input gate — fix those, not the header. |
| `src/input/input.cpp/.h` | 130 | **CLEAN.** Small, one job, no dead paths. The `mouselook_` gate comment at `:40-45` documents a real past bug and is accurate today. |
| `src/game/console.cpp` | 814 | **CLEAN and well-shaped.** One `RequestRow[]` table serving 19 commands through one handler. Only nit: `spawn_test_ball` duplicate alias (`:801`). |
| `src/game/keybind.cpp` | 179 | **CLEAN.** Fully data-driven; every action resolves to a real command. |
| `src/game/event_bus.cpp/.h` | 183 | **HALF-DEAD.** The ring (`publish`/`events`/`clear`) is live and used. `EventFeed` + `feed_drain`/`feed_line`/`feed_tick` (`:143-181`, 39 LOC) have **zero non-test callers** — the readable event log has no consumer. Either wire it into the HUD (it is what `hud_ui.cpp:152-153` says is missing: "лента одноразовых событий … придёт строкой сюда же") or delete it. |
