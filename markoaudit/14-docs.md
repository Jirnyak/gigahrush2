# Audit 14 — DOCUMENTATION vs CODE (gigahrush2)

**Verification base.** Branch `torus`, HEAD `97bdf13e` (2026-08-17 17:27). Every claim below carries
the grep or `file:line` that produced it. A doc citing code is never treated as evidence the code
exists. Where a finding came from a parallel sub-audit, I re-ran the grep myself before publishing;
one sub-audit finding was **rejected** on that check and is recorded as such in §3.4.

**Excluded by instruction** (other agents own them): render.md, ddalight.md, nav.md, floors.md,
diffusion.md, destruct.md, monsters.md, conversation.md, npcs.md, ai.md, antourage.md, props.md,
audio.md, hud.md, inventory.md. They appear in the inventory table and where they are the *other*
side of a contradiction.

---

## 0. Headline numbers

| Metric | Value |
|---|---|
| Markdown at repo root | 45 files, **~1.02 MB** |
| `Docs/` | 21 files, **~700 KB** (MASTER_ROADMAP + specs 01–19, 21 — spec 20 deleted) |
| `problems.md` | **279 KB**, 57 numbered problems (+§49а) |
| **FALSE-CITATION RATE, measured** | **26 FALSE of 236 sampled = 11.0 %**, plus 26 MISLOCATED → **combined defect rate 22.0 %, N = 236, 27 documents** |
| Worst documents | `Docs/specs/07` **36.4 %**, `ARCHITECTURE.md` **35.7 %**, `macrosim.md` 23.1 %, `MASTER_ROADMAP.md` 23.1 %, `Docs/specs/15` 22.7 % |
| Clean documents (0 false of 60 sampled) | `ecs.md`, `camera.md`, `controller.md`, `gravity.md`, `voxels.md`, `world.md`, `events.md`, `fields.md`, `elevators.md`, `netcode.md`, `items.md`, `fluid.md`, `worldgen.md` |
| `problems.md` closures independently verified | **31** |
| — CONFIRMED-CLOSED | **24** |
| — closure text real but its cited evidence has rotted | **9** |
| — FALSELY-CLOSED by the owner | **0** |
| `marko1olo` "closed" problems (on `main`, not `torus`) | **20** in 18 commits |
| — verified still live at HEAD | **17 of 17 checked** |
| AGENTS.md rules enumerated | **70** — 12 mechanically enforced, 45 convention, **13 dead-letter** |
| Web payload at repo root | **152 KB**, untouched since 2026-07-30, publishes the whole repo |

---

## 1. Doc inventory

### 1.1 Root markdown, my scope

| File | KB | Last commit | Claims to describe | Exists at HEAD? | VERDICT |
|---|---|---|---|---|---|
| `problems.md` | 279 | 2026-08-16 Jirnyak | Defect registry §1–§57 | mixed | **STALE** — its own header is false (§2.1); ~25 % of closures cite dead code |
| `master_prompt.md` | 75 | 2026-08-14 Jirnyak | Working contract, state of the game layer | mostly | **STALE** — see §5 |
| `jirnyak.md` | 48 | 2026-08-07 Jirnyak | Owner's constitution, 26 doctrine sections | partly | **STALE + one DEAD section (§22)** — §5.2 |
| `ARCHITECTURE.md` | 35 | 2026-08-13 Jirnyak | Layers L0–L4 + owner manifesto + audit verdict table | mixed | **Layer map CURRENT; the verdict table at `:355-370` is the least reliable content in the tree — 5 false of 14** |
| `AGENTS.md` | 25 | 2026-08-17 Jirnyak | 70 hard rules + working method | n/a | §4 — 13 dead letters |
| `README.md` | 15 | 2026-08-12 Jirnyak | Index, feature list, doc map | — | **STALE** — 7 verified false claims, 2 fake badges (§6.6) |
| `performance.md` | 14 | 2026-08-06 Jirnyak | Budgets, measured frame costs | mostly | STALE (pre-DDA-light, pre-air-drag); 1 false of 8 |
| `macrosim.md` | 18 | 2026-08-05 Jirnyak | `MacroSim`, NPC pool, factions | partly | **STALE** — the faction section describes a design renamed and reversed before it landed (§3.2) |
| `netcode.md` | 12 | **2026-07-29** | Server-authoritative seam | step #1 only | **STALE by age** — oldest doc; 0 false citations, but its "Deployment modes" table lists `--dedicated/--host/--connect`, none of which `main.cpp` parses |
| `ecs.md` | 3 | 2026-08-06 | EnTT conventions | ✓ | **CURRENT** (0 false of 8) |
| `events.md` | 3 | 2026-08-06 | `EventBus` | ✓ | CURRENT (0/8) — but `feed_tick` is unwired |
| `fields.md` | 5 | 2026-08-06 | `FieldRegistry`, `SubField` | ✓ | CURRENT (0/6) — and it is *correct* where the **code comment** lies (§3.3 #17) |
| `items.md` | 12 | 2026-08-17 | items.csv → `item_table` | ✓ | **CURRENT — exemplary.** It explicitly documents that the struct it used to describe *does not exist*, and all three of its negative claims verify |
| `production.md` | 14 | 2026-08-14 | Room-stock economy | `RoomStock` **absent** from `src/` | **PLAN, mislabelled as description** |
| `powergrid.md` | 5 | 2026-08-17 | Power grid | ✓ | CURRENT |
| `menu.md` | 5 | 2026-08-17 | Main menu / settings | ✓ | CURRENT (1 mislocated: `menuScreenPage` → `shell.menuPage`) |
| `loadout.md` | 3 | 2026-08-17 | Starting loadout | ✓ | CURRENT |
| `camera.md` | 2 | 2026-08-06 | `sim/camera` | ✓ | CURRENT (0/8) |
| `controller.md` | 1.6 | 2026-08-06 | `controller_step` view | ✓ | **CURRENT (0/5)** — and `problems.md:737` records that `controller.h:7-8`, not this doc, is the liar |
| `gravity.md` | 5 | 2026-08-13 | `GravityFrame`, 8 regimes | `src/world/gravity.h:56,78,154` ✓ | CURRENT (0/8) |
| `physics.md` | 7 | 2026-08-17 | `physics_step`, sweep, drag | ✓ | CURRENT except `voxel_solid` (§3.1 #7–9) |
| `voxels.md` | 6 | 2026-08-10 | `kMacroDim/kSubDim/kCellSize` | `src/world/types.h:17,23,34` ✓ | CURRENT (0/9) except the `kSubDim=16` toggle promise (§6) |
| `world.md` | 2 | 2026-08-06 | `World`, `LevelStack` | ✓ | CURRENT (0/7) — documents `above()/below()` as live API; they have **zero callers** |
| `worldgen.md` | 2 | 2026-08-06 | The generic generator is gone | correctly says so | **CURRENT — an honest tombstone** |
| `elevators.md` | 10 | 2026-08-12 | 4×4×4 lattice, 16 hubs | ✓ | **CURRENT (0/10)** — and the doc that *resolved* the 32-vs-16 fight (`:122`) |
| `fluid.md` | 2 | 2026-08-06 | `fluid_step` | exists, **not called** | Honest tombstone-adjacent (0/5) |
| `LICENSE.md` | 3 | 2026-07-29 Петушков А. | licence | n/a | KEEP |

### 1.2 `Docs/`

| File | KB | Verdict | Evidence |
|---|---|---|---|
| `Docs/MASTER_ROADMAP.md` | 59 | **STALE, 23.1 % false** | «сейв **v10**» at `:252, :307, :438`; code is `save.h:171 kSaveVersion = 16u`. Cites `Sandpile` wired at `main.cpp:4567` (that line is `needs.bodies, needs.recovering, crowdDead);`; `Sandpile` survives only in two "it was deleted" comments). Cites `tests/suite_cellular.inl` **created** — file absent. Cites `DrawVendorWindowUI` — 0 hits |
| `Docs/specs/01–19, 21` (20 files, ~640 KB) | — | **SNAPSHOTS OF 2026-08-09/10, cited by README as current** | `07` **36.4 % false** (cites `buyQty`, `buyFilter`, `particleNoSim`, `wireNoSim`, `lastCorpseLootLogTick` — all 0 hits; its whole extraction line-table is computed against a ~6 000-line `main.cpp`, now 7 266). `15` 22.7 % false. `05` cites `cellular.cpp:365` twice — file deleted 2026-08-10. `10` cites `save.h:110 kSaveVersion = 9u` — wrong line **and** wrong value. `17` "442 items" — `data/items.csv` is 444 lines → 443 |

### 1.3 `.github/`

| File | Verdict | Evidence |
|---|---|---|
| `workflows/source-rules.yml` | **KEEP — the only honest CI.** Its header (`:7-30`) states plainly it cannot configure the project, so it only runs `cmake -P` over source text | — |
| `workflows/pages.yml` | **DELETE** — `upload-pages-artifact` with `path: '.'` (`:29-31`): publishes the **entire repository** to GitHub Pages |
| `workflows/static.yml` | **DELETE** — the same job again, same `concurrency: group: "pages"`, same `path: '.'`. Two workflows race on every push to `main` |
| `workflows/deploy-gh-pages.yml` | **BROKEN — DELETE** — `path: 'docs'` (`:34`). The tracked directory is `Docs/` (`git ls-files` → `Docs/MASTER_ROADMAP.md`). macOS hides this; the ubuntu runner does not. Failing on every push since it landed |
| `dependabot.yml` | **DEAD CONFIG** — `package-ecosystem: "npm", directory: "/"`. No `package.json`; `git ls-files \| grep -c 'package.json\|\.js$'` = **0**. Source of the 4 junk `origin/dependabot/*` branches |
| `stale.yml`, `welcome.yml` | bot theatre, harmless |
| `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/*` | Петушков А., 2026-07-30, never exercised |

---

## 2. `problems.md` forensics — the headline

### 2.1 The document's own header is false today

`problems.md:3-6`:
> «Статусы сверены с кодом 2026-08-06. Живые проблемы: **9**, **10** и **11**. Остальные закрыты…»

At HEAD the same file's headings show **20 sections marked ЖИВА / ЧАСТИЧНО**, and **§10 is
`ЗАКРЫТА 2026-08-14`**. The summary contradicts its own body in both directions. `:16-24` still
warns the tree is *«902 коммита позади origin/main»* with local HEAD `fb6d0f2` — 11 days stale.
`README.md:114` compounds it: *"the defect registry **(§1–§45)**"* — it runs to §57.

### 2.2 Owner's own closures — 25 verified, 0 false

| § | Status | Verification | Verdict |
|---|---|---|---|
| 1 | РЕШЕНО | `grep -rE 'maxf_local\|clamp_local\|wrap_delta_f_local\|kWorldExtentLocal' src` → **0**; `src/core/rng.h:34` is the single `spatial_hash` | **CONFIRMED** |
| 2+14 | ЗАКРЫТА УДАЛЕНИЕМ | `LazyFieldRebaker` survives only as tombstones `src/world/nav.h:124`, `nav_async.h:75` | **CONFIRMED** |
| 3 | РЕШЕНО | `spawn_stair_bulb` → 0; `padic_module.cpp:80` passes `PropId::PadicStairBulb` (`prop_table.h:25`) | **CONFIRMED** |
| 4 | РЕШЕНО | `finalize_deaths` is the one death point (`event_bus.h:83`), called `main.cpp:4591` | **CONFIRMED** |
| 5 | РЕШЕНО | `spawn_debris_pieces` → 0; `anchor_validate_step` takes `ParticleBurstQueue*` (`prop_system.h:185-187`), pinned `suite_props_game.inl:752` | **CONFIRMED** |
| 6 | РЕШЕНО | `soviet_wallpaper\|soviet_tiles\|soviet_bricks` → 0 in `shaders/` | **CONFIRMED** |
| 7C | РЕШЕНО | `src/render/vk_device.cpp:252 feats.robustBufferAccess = VK_TRUE;` | **CONFIRMED** |
| 8 | РЕШЕНО | `gravity.h:56/78/154`; `macro_grid.h:67 face_layer`; both tests called `game_test.cpp:5338-5339` | **CONFIRMED** |
| 10 | ЗАКРЫТА | `door.cpp:202 inventory_has_keycard(…, std::uint8_t requiredTier)`, compared `:261-262`, `main.cpp:6404-6409` | **CONFIRMED** — but see §2.3, marko's original closure was wrong and the owner re-did it |
| 12 | ЗАКРЫТА | `shaders/light_grid.comp:57-59` wraps all three axes; period arrives as `pc.params.w` (`:113`) pushed as `kWorldExtent` (`gpu_light_grid.cpp:289`) | **CONFIRMED** |
| 16.1 | ЗАКРЫТО | `physics.cpp:330 reg.get_or_emplace<AngularVelocity>(e)` | **CONFIRMED** |
| 19 | ЗАКРЫТА | `verify()` compares `fluid_` from both sources (`voxel_mirror.cpp`, `readback_compare(fluid_, …)` ×2) | **CONFIRMED** |
| 24 | ЗАКРЫТА | `activeLayer` refreshed at all four travel sites: `main.cpp:2641, 2650, 4728, 7115` | **CONFIRMED** |
| 26 | ЗАКРЫТА | Exactly one bake site: `floor_stream.cpp:362-363`, gated by `nav_bake()` | **CONFIRMED** |
| 30.2 | ЗАКРЫТО | `level_stack.h:43-51` — fix plus a 6-line note on the `0xFFFFFFFF+1` overflow | **CONFIRMED** |
| 33/50 | ЗАКРЫТА | `Projectile::team` and `p.source != victim` both gone; survive only as history (`combat.cpp:187, 1539-1540, 1754`) | **CONFIRMED** |
| 40 | ЗАКРЫТА | `combat.cpp:500 if (reg.valid(d.killer) && d.killer != e)`; faction side `faction_relations.cpp:413-419` | **CONFIRMED** |
| 41 | ЗАКРЫТА | `hazard_step` declared `combat.h:641`, defined `combat.cpp:961`, **called** `main.cpp:4339` | **CONFIRMED** |
| 43 | ЗАКРЫТА | `save.cpp:505 static_assert(FastTravelState::wire_bytes() == kFastTravelWire)` | **CONFIRMED** |
| 44 | ЗАКРЫТА | `encumbrance_step` called `main.cpp:4548`, read at `:3349, :5395` | **CONFIRMED** |
| 46 | ЗАКРЫТА | `check_source_rules.cmake:108 file(READ "${_path}" _giga_raw)` — whole-file read | **CONFIRMED** |
| 47 | ЗАКРЫТА | `main.cpp:895` («WRITE BESIDE, THEN RENAME OVER»), `:932` tmp open, `:944 std::filesystem::rename(tmpPath, finalPath, ec)` | **CONFIRMED** |
| 48 | ЗАКРЫТА | `samosbor_enter_floor` at both arrival points: `main.cpp:2575`, `:7111` | **CONFIRMED** |
| 49 | ЗАКРЫТА | `kRoomFieldMask` now **derived**: `room_zone.h:171 inline constexpr … = [] {`, consumed `room_zone.cpp:370` | **CONFIRMED** |
| 49а | ЗАКРЫТА | `nav_async.cpp:39-48` — `std::vector<std::uint8_t>().swap(...)` ×4, with a note that `shrink_to_fit` is non-binding | **CONFIRMED** |

**No falsely-closed item was found among the owner's own closures.**

### 2.3 `marko1olo`'s closures — the falsification

Twenty problems "closed" by `marko1olo` in 18 commits, 2026-08-14/15. Found with:

```
git log --all --full-history --format='%h|%ad|%an|%s' --date=short -- problems.md
```

They are ancestors of `main` / `origin/main` / `marko/megastructure` but **not** of `torus`
(`git merge-base --is-ancestor f2a7b042 torus` → **NO**). They do not show in
`git log main -- problems.md` because the owner's merge kept his own side, which prunes them under
default history simplification — **they are invisible without `--full-history`.**

**The method is the finding.** These are not fixes with a status line; they are *deletions of the
evidence*:

| Commit | Subject | `problems.md` diff |
|---|---|---|
| `f2a7b042` | close Problem 13 (Ruthless Purge verification) | **+11 / −57** |
| `17d99211` | close problem 31 live run measurements | **+6 / −60** |
| `06a61b92` | close Problem 23 and Problem 35 | +13 / −55 |
| `a6f9dbfc` | close Problem 15 — full gravity frame isotropy | +9 / −44 |
| `d5000c36` | close Problem 11 — 128^3 volume symmetry | +7 / −41 |
| `d4b3869d` | close problem 51 for keycardTier | +3 / −37 |
| `ef2ac130` | close Problem 29 — modular decomposition | +9 / −36 |
| `e2a71d69` | close problem 52 wired subsystems verification | +12 / −36 |
| `fae008ab` | close problem 34 combat knockback | +2 / −29 |
| `6e25929a` | close Problem 9 — isotropic particles | +9 / −28 |
| `7b89fdb1` | close Problem 21 — MacroSim coarse clock | +5 / −21 |
| `7a25477a` | close problem 30 summary | +13 / −12 |
| `52488357` | close problem 52 (route_step, bank_step, feed_tick, prop_interact_step) | +9 / −9 |
| `a5ccd982` | close Problems 16, 17, 18 | +50 / −94 (+ real code) |
| `a42afbc1` / `e1212adc` / `4d600c44` / `2347bc5d`+`b65474cb` | close 36 / 22 / 38 / 10 | code + doc |

Across the 14 doc-only commits: **+158 inserted, −525 deleted.** One line written per 3.3 lines of
evidence removed.

**Independent verification at HEAD:**

| § | marko's claim | Code at HEAD | Verdict |
|---|---|---|---|
| **51** | "keycardTier security door authorization" | `grep -rn 'keycardTier' src tests data tools` → **5 lines, all reads**: `main.cpp:6404,6409`, `door.cpp:261,262`, decl `door.h:129`. **Zero writers.** Dead by construction, exactly as §51 says | **FALSELY-CLOSED** |
| **29** | "modular decomposition, spiral guard" | `wc -l src/app/main.cpp` = **7266**; the problem was written against 5 616 → **+29 %**. `int g_saveSlot = 1;` still at `main.cpp:873`. Frame-debt guard is still the clamp `main.cpp:2768 if (frameDt > 0.1f) frameDt = 0.1f;`, not a reset | **FALSELY-CLOSED, metric moved the wrong way** |
| **22** | "expand CSV drift gate to 15/15, strict CLI arg validation, untrack agent_mem" | Gate has **9** `_giga_csv_vs_header` calls (`check_source_rules.cmake:415,417,422,427,435,438,443,447,451`) against **16** CSVs → 9/16, *worse* than the 9/15 §22 recorded (`data/sounds.csv` was added ungated). Arg parser `main.cpp:1560-1584` still has **no `else`**. `.agent_mem/sub_gigahrush2.mem.json` still tracked on **both** branches | **FALSELY-CLOSED, all three counts** |
| **13** | "Ruthless Purge verification" | `fluid_step` still has no app caller (`main.cpp:5045` says so in prose); `mark_fluid_dirty` → **zero callers** (`voxel_mirror.h:144` is the only hit); no stain-fade exists (`stain.h:48,57` exports only `stain_paint`/`stain_splat`). Only the `cellular` leg is gone, by deletion, already recorded by the owner on 2026-08-12 | **FALSELY-CLOSED** (3 of 4 legs live) |
| **52** | "wired subsystems verification" ×2 | `check_wired.cmake:43-73` still carries 8 deferrals. Only `bank_step` (`main.cpp:3240`) and `diffusion_tick` (`main.cpp:3175`) got wired. Still unwired: `fluid_step`, `route_step`, `feed_tick`, `samosbor_fog_tick`, `interaction_step`, `prop_interact_step`, `loot_containers_step` | **FALSELY-CLOSED** (6–7 of 9 live) |
| **30** | "summary" | `FieldRegistry::get_or_create` (`field.h:66-80`) still has **no assert** while its own comment `:74-75` says *"We assert via the stored type tag in debug builds"*; `wrapf` (`wrap.h:13-16`) still `fmod`-based, can return exactly `size`; `trait_move_mult`/`trait_damage_mult`/`trait_incoming_mult`/`trait_takes_bait`/`trait_allows_wet_spawn` still have **zero `src/` callers** | **FALSELY-CLOSED** |
| **18** | (in "close 16,17,18") | `gpu_light_grid.h:113 VulkanBuffer lightBuf_{}; // HOST_VISIBLE persistent mapped`; `particle_pass.h:90 VulkanBuffer pool_; // persistent, host-visible`; `wire_pass.h:90-91 points_/bodies_`. Still one allocation each, no ring, with `kMaxFramesInFlight = 2` | **FALSELY-CLOSED** |
| **36** | "regex suite include gates" | The include check is still a raw substring search: `check_source_rules.cmake:522 string(FIND … "#include \"${_suite_name}\"" …)` and `:543 string(FIND … "${_entry}();" …)` — a **commented-out** include satisfies both. `sim_bench.cpp:304` still prints `FAITHFUL` off `fabs(mirrorMs/refMs - 1.0) < 0.25` — comparing *time*, not behaviour | **FALSELY-CLOSED** (the exemption-directive leg was fixed; the two checks doing the work were not) |
| **35** | "verify all data tables" | `mob_table.h:194-197 navStepSub/navClimbSub/navDropSub/navFly` — zero readers outside their own header. `weapon_table.h:34` still confesses `// unused by physics yet; recorded, not invented`. `monster_base_xp` is still a 35-arm `switch` at `rpg.cpp:78` | **FALSELY-CLOSED** |
| **34** | "combat knockback and corpse vertical layout" | Knockback *was* fixed by the owner (`combat.cpp:344-396`, frame-derived). **Corpse half untouched**: `combat.cpp:541-542` still reads `aabb->half.y = 0.18f; // Flatten on ground` / `aabb->half.z = std::max(h*0.75f, 0.55f); // Extend along floor` — flatten across a horizontal, stretch along the vertical | **FALSELY-CLOSED (half)** |
| **21** | "MacroSim coarse clock isolation and budgeted passes" | `main.cpp:5030 if (simTick % game::kMacroPeriodTicks == 0) macroSim.step(...)` — still derived from `kSimHz` (`macro_sim.h:80`), still synchronous inside the fixed-step loop; `macro_sim.cpp:280 for (NpcId id = 0; id < n; ++id)` is still the unbudgeted full sweep | **FALSELY-CLOSED** |
| **9 / 15** | "isotropic particles / full gravity frame isotropy" | `shaders/particle_sim.comp`, `wire_sim.comp`, `cloth_sim.comp` still take gravity as a literal. The owner's own status note (`problems.md:530-540`) had already published *which three of five* `prop_system.cpp` sites closed and which two did not — marko replaced a partial status carrying named residue with a total one | **FALSELY-CLOSED** |
| **23** | "sync controller header" | A real 2-line edit to `src/sim/controller.h`, but 1 of 3 named residual items; the other two (jirnyak.md §18 rewrite, jirnyak.md §22 vs problems.md §2) are still open — §5.2 | **FALSELY-CLOSED (scope inflation)** |
| **11 / 31 / 16 / 17 / 38** | closed | §11's acceptance criterion is still applied to pipes only (`problems.md:311-315`); §31's own closure text now cites `kPageCap = 786432` while the code says `4194304` (`voxel_mirror.h:99`); §16/17/38 each have legs genuinely closed **by the owner** since — §2.4 | **FALSELY-CLOSED / UNVERIFIABLE-AS-STATED** |

**Per-author false-closure table**

| Author | Commits touching `problems.md` | Problems declared closed | False at HEAD | True | Rate |
|---|---|---|---|---|---|
| `Jirnyak` (owner) | 40 | 24 + 1 partial | **0** | 24 | **0 %** |
| `marko1olo` | 18 (16 on 2026-08-14/15) | 20 | **17 of 17 checked** | 0 fully; 3 partially real (§10 keycard, §23 header line, §36 exemption regex) | **≈100 %** |
| `Петушков А.` | 0 | 0 | — | — | n/a |

The single `marko1olo` change that reached `main` — `2347bc5d` *"enforce itemTier matching in
inventory_has_keycard and close problem 10"* — still required the owner to follow with
`f3a65ad5 test(doors): flip the §10 keycard pin to tier comparison, **true up the closure text**`.
Even the accepted one shipped with a wrong test pin and an overclaimed status line.

### 2.4 Closures whose evidence has rotted — `problems.md` citing dead code

Real fixes whose closure paragraph now cites files, lines, or values that no longer exist. The
registry has caught the disease it exists to diagnose.

| § | Closure text says | Reality at HEAD |
|---|---|---|
| 12 | «`gpu_light_grid.cpp` → `params.w`», quotes `shaders/light_grid.comp:35-51, :80` | Fix real; subsystem rewritten by `97bdf13e` (DDA light). Lines are `:47`, `:57-59`, `:113` now |
| 22 | «`.github/workflows/cmake-multi-platform.yml` собирает на ubuntu/windows…» | **That file does not exist.** `ls .github/workflows/` → deploy-gh-pages, pages, source-rules, stale, static, welcome. The *defect* stands; the *citation* is fiction |
| 31.1 | «`kPageCap` поднят 65 536 → **786 432** (768 МиБ)» | `voxel_mirror.h:99: kPageCap = 4194304u` — 5.3× the recorded number |
| 31.3 | «`GIGA_TEXTURE_DIR` резолвится относительно CWD, фолбэка нет» | `cube_pass.cpp:33 if (const char* env = std::getenv("GIGA_TEXTURE_DIR"))` — override exists. Leg closed, §31 still reads ЖИВА |
| 16.2 | «во всём `src/sim` нет ни терминальной скорости, ни сопротивления»; «`sweep_axis` — не свип, а телепорт» | Both false: `src/sim/drag.h:34-51` called from `physics.cpp:225`; `sweep_axis` (`physics.cpp:96-110`) sub-samples at `kVoxelSize` with bisection back-off. §16 still reads ЖИВА |
| 17 | «`remaining` уменьшается ВНУТРИ цикла… `fluid.cpp:125-145`»; «"Вниз" берётся из `gravity().global`, минуя режим» | Both fixed by the owner in `41127e85` (2026-08-10): `fluid.cpp:118-146` computes all four proposals then applies with a `scale`; `:77-78` uses `regime_frame(world.gravity().regime)` / `regime_down(...)`. §17 still reads ЖИВА |
| 38 | «`if (mirrorVerify) voxelMirror.verify(...)` живёт в `do_ride` — только на ПРИБЫТИИ» | Now at `main.cpp:2011` (floor-0 load), `:2626`, `:4828`, `:7148`, and every 300 frames at `:7040`. The `--floor N` / 420-frame half is **still live** (`main.cpp:7052 shotFramesSeen % 420 == 0`) |
| 52 | table titled «**Девять** систем» | Its own table has **ten** rows |
| 13/52 | `cellular_step` deferred «решение по §13 ожидается» | **The symbol does not exist.** `ls src/sim/` = camera, controller, diffusion, drag, fluid, physics. `check_wired.cmake:44` carries a phantom deferral for a module deleted 2026-08-10 |

**~29 % of the examined closures (9 of 31) cite something that no longer exists.**

### 2.5 Live problems that are quietly fixed

The registry also errs safely, which matters for planning: **§16.2, §17 (2 of 5 bullets), §31.3,
§36 (3 of 6 legs), §38 (half), §34 (half)** are done and still labelled ЖИВА. A reader budgeting
from this file over-estimates six items and under-estimates §29, which got 29 % worse.

### 2.6 One live finding that is *understated*

`problems.md:1224-1228` §30 says *«Дистанции в `main.cpp` не заворачивают Y»* and names **two**
sites. There are **six**, all verified by reading the lines:

```
main.cpp:1481-1483   dx = wrap_delta_f(...); dy = playerPos.y - pos.y; dz = wrap_delta_f(...)
main.cpp:3605-3607   (corpse proximity)
main.cpp:3635-3637   (interaction reach)
main.cpp:3841-3843   (Lampoglaz blinding radius)
main.cpp:3857-3859   (SporeCarpet acid radius)
main.cpp:6476-6478   (possess prompt)
```

`AGENTS.md:206-211` is unambiguous — *"x/y/z wrap … World-space distance math must use
`wrap_delta`"* — and `wrap_delta_f` is on the adjacent line at every site. A monster 2 m across the
Y seam reads as 254 m away, in four gameplay-visible predicates.

---

## 3. Fiction detector — the headline rate

### 3.1 Per-document FALSE-CITATION RATE

| Doc | Sampled | FALSE | MISLOCATED | **FALSE rate** |
|---|---:|---:|---:|---:|
| `Docs/specs/07_MAINCPP_DECOMPOSITION.md` | 11 | 4 | 5 | **36.4 %** |
| `ARCHITECTURE.md` | 14 | 5 | 1 | **35.7 %** |
| `macrosim.md` | 13 | 3 | 4 | **23.1 %** |
| `Docs/MASTER_ROADMAP.md` | 13 | 3 | 3 | **23.1 %** |
| `Docs/specs/15_BAKED_NAVIGATION.md` | 22 | 5 | 6 | **22.7 %** |
| `Docs/specs/05_TESTING_AND_PERF_BUDGETS.md` | 10 | 2 | 4 | 20.0 % |
| `physics.md` | 10 | 2 | 0 | 20.0 % |
| `performance.md` | 8 | 1 | 0 | 12.5 % |
| `README.md` (sub-audit sample) | 10 | 1 | 0 | 10.0 % |
| `menu.md`, `production.md`, `Docs/specs/17` | 22 | 0 | 3 | 0 % |
| `ecs.md`, `events.md`, `fields.md`, `items.md`, `powergrid.md`, `loadout.md`, `camera.md`, `controller.md`, `gravity.md`, `voxels.md`, `world.md`, `worldgen.md`, `elevators.md`, `fluid.md`, `netcode.md` | 103 | 0 | 0 | **0 %** |
| **TOTAL** | **236** | **26** | **26** | **11.0 %** |

**Aggregate: 26 FALSE of 236 = 11.0 %. With MISLOCATED: 22.0 %, N = 236, 27 documents.**

My own independent pass over `problems.md` + `README.md` + `Docs/specs/10` (§2.4, §3.3, §6.6),
sampled separately, ran at **20 of 62 = 32 %** — because those are precisely the documents that
carry the most numeric claims.

### 3.2 Verified FALSE citations (the load-bearing ones)

**ARCHITECTURE.md — the audit-verdict table at `:355-370` is the worst content in the tree.**
It was true when written and has been inverted by the very work it prompted.

| # | Claim | Proof |
|---|---|---|
| 1 | `:360` «`equipSlot` читается **в одном месте** и только сравнивается с `Armor` (`combat.cpp:724`)» | `grep -rn equipSlot src/` → **10 hits, 6 distinct readers**: `combat.cpp:1062`, `ai.cpp:1311`, `population.cpp:87`, `console.cpp:750`, `inventory_ui.cpp:365`, `equip.cpp:29,50`. And `sed -n 724p src/game/combat.cpp` → `std::vector<HazardHit> hazardHits;` |
| 2 | `:360` «слотов экипировки **НЕТ**» | `src/game/equip.h:33 struct Equipped { weapon; armor; tool; }` + `equip.cpp`; `EquipSlot` enum `item_table.h:77` |
| 3 | `:360` «оружие выбирается автоматически по лучшему стату (`ranged_pick.cpp:6`)» | `ranged_pick.cpp:6` is a comment; `equipped_ranged` (line 7+) reads `Equipped`/`EquipSlot::Weapon` **first** — an explicit decision, not a stat scan |
| 4 | `:370` «`xp_for_quest` … не имеет **НИ ОДНОГО вызова вне тестов**» | `quest.cpp:443 award_xp(*rpg, xp_for_quest(objective_difficulty_e1(...)))` and `contract.cpp:466`. The cited lines *are* the XP award; `quest.cpp:432`'s own comment says "had no caller outside tests **until 2026-08-12**" |
| 5 | `README.md:27` "CRT aesthetic from GigaHrush 1 (`taste.md`)" | `ls taste.md` → No such file; `git ls-files \| grep -i taste` → empty |
| 6–8 | `performance.md:210`, `physics.md:76`, `physics.md:87` all name **`voxel_solid`** | `grep -rn 'voxel_solid' src tests shaders` → **0 hits**. The inner loop is inlined into `aabb_overlaps_solid` (`src/sim/physics.cpp:24`) |
| 9 | `macrosim.md:8, 184` — «`src/game/faction.{h,cpp}`» | `ls src/game/faction*` → `faction.h`, `faction_relations.h`, `faction_relations.cpp`. **No `faction.cpp`** |
| 10 | `macrosim.md:182` — "a `kFactionCount × kFactionCount = 6×6` matrix" | `faction.h:31 static_assert(kFactionCount == 5)`. The 6-wide constant is `kRelFactionCount = kFactionCount + 1` (`faction_relations.h:53`). The doc's own arithmetic is wrong |
| 11 | `macrosim.md:239-240` — "`MacroSim` now **owns the `FactionMatrix`** (mutable via `factions()`)" | `grep -rn 'factions()' src` → **0 hits**. `src/game/macro_sim.h:294` states the opposite verbatim: *«deliberately does NOT own one»* — it borrows `const FactionRelations*` |
| 12 | `MASTER_ROADMAP.md:41` — "`e720f90` подключил `Sandpile` (`main.cpp:4567`)" | `Sandpile` → 2 hits, both "it was deleted" comments (`voxel_mirror.h:24`, `destruct.h:35`); `main.cpp:4567` is `needs.bodies, needs.recovering, crowdDead);` |
| 13 | `MASTER_ROADMAP.md:42` — "набор `tests/suite_cellular.inl` создан" | absent |
| 14 | `MASTER_ROADMAP.md:182` — «отдельное окно ImGui (`DrawVendorWindowUI`)» | 0 hits |
| 15–16 | `Docs/specs/05:207, :378` — «`cellular.cpp:365`» | File deleted 2026-08-10; the roadmap says so, this spec was never updated |
| 17–20 | `Docs/specs/07:81, :212, :103` — `buyFilter[64]`, `buyQty`, `noGpuCull`/`wireNoSim`/`particleNoSim`, `lastCorpseLootLogTick` | `grep -c` on `src/app/main.cpp` → **0** for each (Vendor window purge + debug-toggle rename) |
| 21–25 | `Docs/specs/15:232, :235, :236, :240, :241` | `wander.cpp:443` is `}` not the quoted comment; `ai.cpp:862` is `const vec3 away = tangent(...)` and the real kNavDir comment is `ai.cpp:1008` with **different wording**; `ai.h:943` is blank; `combat.h:478` is a damage cap, `:485` an unreachable web branch |

### 3.3 Additional false citations found in my own pass

| # | Doc:line | Claim | Proof |
|---|---|---|---|
| 26 | `Docs/specs/10:478` | `save.h:110   kSaveVersion = 9u;` | `src/game/save.h:171` = **`16u`**. Wrong line **and** wrong value |
| 27 | `Docs/specs/10:19, :438` + `MASTER_ROADMAP:252,307,438` + `README:130` | Save v9 / v10 | idem — **v16** |
| 28 | `README.md:114` | "defect registry **(§1–§45)**" | 57 sections |
| 29 | `README.md:127` | "**5927-line** main.cpp split" | `wc -l` = **7266** |
| 30 | `README.md:150-153` | "**Specs 20** and 21 additionally carry…" | `ls Docs/specs/` — no `20_*.md`; deleted with `src/sim/cellular` on 2026-08-10 |
| 31 | `README.md:132` | spec 11 scope "Speech, rumour, **vendor**, quests" | Vendor window removed (`ui_shell.h:41`, `main.cpp:2146`, `console.h:61` all say so); `vendor.cpp` survives only as a price-multiplier table |
| 32 | `README.md:8-9` | badges `Audit-100% Verified`, `Runtime-Zero Allocation` | Static shields.io PNGs with **empty link targets** `()`. Contradicted by `problems.md:1237` (`merge_ecs_prop_meshes` allocates a `std::vector` at `main.cpp:1293`, called 6× in the frame path) |
| 33 | `tools/check_source_rules.cmake:384` | "items.csv is **447 lines for 446 items**" | 444 lines / 443 items. **Comment rot inside the gate itself** |
| 34 | `jirnyak.md:232` §24 title | «…И **32 ЛИФТА**» | Its own body (`:234`) describes 48; `elevators.md:122-123` records the owner's decision **"keep the 16 that exist"**; code agrees — `fast_travel.h:27-43`, one 4×4 grid |
| 35 | `src/world/field.h:74-75` (code comment) | "We assert via the stored type tag in debug builds" | No `assert`, no `#ifndef NDEBUG` in `get_or_create` (`field.h:66-80`). `find<T>` at `:84-90` does check. **`fields.md:20-21` states the guarantee correctly — the code comment is the liar** |
| 36 | `src/game/economy.h:415` | "(still unwired — check_wired's `bank_step` entry stands…)" | `bank_step` **is** wired: `main.cpp:3240`. `src/game/save.h:164` in the same tree says the opposite. Two code comments, one tree, contradictory |
| 37 | `jirnyak.md:29` | «Код компилируется с флагом `-fno-exceptions`» | `CMakeLists.txt:411 giga_target_flags(gigahrush2 ON)` → the `if(NOT rtti)` branch at `:99-106` is skipped, so **the shipping executable gets neither `-fno-rtti` nor `-fno-exceptions`** |

### 3.4 One sub-audit finding I REJECTED

A parallel pass flagged `ARCHITECTURE.md:355` — "`RpgStats.attr[8]`" — as false because
`rpg.h:101` declares `attr[kAttrCount]` with `kAttrCount == 3`. **I checked and this is a false
positive.** `ARCHITECTURE.md:355` reads:

> `Attr{Str,Agi,Int}` ([rpg.h]); пул УЖЕ держит 8 слотов … **КОНФЛИКТ**: расширить enum +
> `RpgStats.attr[8]` (12→16 Б)

It correctly states today's 3 attributes and proposes `attr[8]` as the *target*. `README.md:82`
agrees (`attr[3]`, marked "*TARGET, not yet built*"). Recorded here so the count in §3.1 is not
inflated; it is excluded from the 26.

### 3.5 Root cause of the rot

1. **`file.cpp:NNN` pins into fast-moving files rot silently.** `main.cpp` grew from ~6 000 to
   7 266 and `wander.cpp` shifted ~25 lines; **every** spot-checked pin into those two missed
   (11 of 11). Pins into stable headers (`nav.h`, `jobs.h`, `lattice.h`, `faction_relations.h`,
   `nav_cache.h`, `item_table.cpp:14`, `container.h:24`) were **all correct**. The rot is not a
   discipline problem, it is a *file-churn* problem — and no gate checks any pin.
2. **Deleted subsystems leave live citations behind.** `cellular.cpp`, `suite_cellular.inl`,
   `Sandpile`, `DrawVendorWindowUI`/`buyQty`/`buyFilter`, `src/app/worldgen.cpp`, `prop_placer.cpp`
   — the *root* docs were turned into tombstones; the *specs* and `MASTER_ROADMAP` were not.
3. **Audit verdicts age worse than descriptions.** `ARCHITECTURE.md`'s conflict table scores 35.7 %
   false precisely because the work it prompted got done.
4. **`macrosim.md`'s faction section describes a design that was renamed before it landed** —
   `FactionId`→`Faction`, `FactionMatrix`→`FactionRelations`, `factionAffinity`→`faction_affinity`,
   `faction.cpp`→`faction_relations.cpp`, and the ownership decision was *reversed*.

---

## 4. `AGENTS.md` — the operative rulebook, 70 rules audited

**Enforcement machinery** (verified by running both gates read-only:
`GIGA_SOURCE_RULES=PASS files_scanned=299`, `GIGA_WIRED=PASS entry_points=41`):

| Gate | Invoked | Build-failing? |
|---|---|---|
| `tools/check_source_rules.cmake` | `CMakeLists.txt:1101 add_test(NAME source_rules …)` | YES — `FATAL_ERROR` at `:557` + pin `:1105` |
| `tools/check_wired.cmake` | `CMakeLists.txt:1117 add_test(NAME wired …)` | YES — `FATAL_ERROR` at `:176` + pin `:1121` |
| `giga_target_flags()` | `CMakeLists.txt:94-133` | Flags only. **No `-Werror` / `/WX` anywhere** (`grep -rn 'Werror\|/WX' CMakeLists.txt` → empty) |

There is **no `tests/CMakeLists.txt`** — all test wiring is in the top-level file.

### 4.1 Counts

**70 rules · 12 mechanically enforced · 45 convention-only · 13 DEAD-LETTER.**

Mechanically enforced: no-exceptions (Rule 1, `:327-331`), no-RTTI (Rule 2, `:335-337`), core ships
its own math / no GLM-Eigen (Rule 3, `:341-343`), core must not see the platform (Rule 4, `:347`),
`giga_game` include-direction (Rule 5, `:351`), no UTF-8 BOM (Rule 6, `:361-373`), CSV↔header drift
(Rule 7, `:415-452`), every `*_step`/`*_tick` must be called (`check_wired.cmake:99, 165-176`),
`/utf-8` on MSVC (`CMakeLists.txt:65`), tick-budget ceilings (`tests/suite_budgets.inl:51,70-82`),
never pin a failing suite (four pins, all `0 failures` / `N/N`), glslc runs in the build
(`CMakeLists.txt:262-379`).

### 4.2 The 13 dead letters

| # | Rule (AGENTS.md:line) | Violation, verified |
|---|---|---|
| 1 | «loot tables belong in CSVs …, never hardcoded `if`-chains» (`:14`) and «never an `if` chain baked into the engine» (`:164`) | `src/app/main.cpp:252,254,3834,3852,3898` — a `MobKind` if-chain implementing per-monster abilities (Lampovy regen, Lampoglaz flash, SporeCarpet acid) |
| 2 | «YOUR SCRATCH IS NOT PROJECT STATE … never enters the tree» (`:96`) | `git ls-files` → **`.agent_mem/sub_gigahrush2.mem.json`** (an agent's `completed_steps`/`pending_steps`/`findings`) **and `.clinerules`**. `.gitignore` refuses `.agents/` but neither of these |
| 3 | **«No global state.»** (`:234`) | `src/app/main.cpp:177 static std::vector<game::BakedLight> g_bakedFloorLights;` — file-scope mutable, added **2026-08-17 by the DDA-light commit**, i.e. a *new* violation. `main.cpp:873 int g_saveSlot = 1;` — external linkage, written `:6617, :6633`. Plus ~35 mutable function-local statics, some inside `giga_game`: `combat.cpp:2253 static int rpgcmbtLog = 0;`, `prop_system.cpp:188,192 static thread_local …`, `main.cpp:799 static game::FloorCatalog cat;`. **No gate greps for `g_`** |
| 4 | «Files over ~800 lines should be reviewed; avoid exceeding 1000» (`:226`) | No gate (`grep -i '800\|1000\|line' tools/*.cmake` → nothing). `src/app/main.cpp` **7266** = **7.3× the cap**; `combat.cpp` 2414; `save.cpp` 1460; `ai.cpp` 1330; `ai.h` 1070 |
| 5 | «One file = one responsibility.» (`:223`) | Same file: window + loop + render + HUD + inventory UI + monster abilities + entity spawning + save + console |
| 6 | «Gameplay macro-systems live in `giga_game`, not `src/app`» (`:192`) | **854** `game::` references in `src/app/main.cpp`, including whole monster-ability systems (`:3834-3910`) and item-drop entity spawning (`:5990`). Rule 5 of the gate only checks *include direction* |
| 7 | «Spawning goes through factory functions, never ad-hoc entity construction» (`:244`) | `main.cpp:5990 Entity pe = reg.create();` + 8 inline `reg.emplace<…>` (`:5993-6005`) — a hand-rolled duplicate of `loot.cpp:222/:289` |
| 8 | «**x/y/z wrap** … World-space distance math must use `wrap_delta`» (`:206-211`) | Six sites wrap X and Z and leave Y raw — see §2.6 |
| 9 | «**Gravity is a vector, not a scalar** … never assume −Z» (`:217`) | `main.cpp:253 grid.add_light(tr.pos + vec3{0.0f,0.0f,1.2f}, …)` and `:255 vec3{0.0f,0.0f,1.5f}` — head-height offsets hardcoded to +Z instead of `-gravity().at(pos)` |
| 10 | «Components are POD structs in `src/ecs/components.h`» (`:240`) | `src/game/combat.h:374 struct PlayerRanged`, `:385 struct PlayerMelee`; more in `mob_spawn.h`, `prop_system.h` |
| 11 | «**GLOB is on.** Do not edit `CMakeLists.txt` for individual files.» (`:188-191`) | `CMakeLists.txt:237-240` hand-lists six audio `.cpp`; `:387` adds `src/audio/audio_system.cpp`; `:437` hand-lists four `src/render/*.cpp` into `world_test`. **`src/audio/` is in no `GLOB_RECURSE`** — a new file there is compiled by nothing |
| 12 | «Prefer `std::uint8_t`/`std::int32_t` — never bare `unsigned int`» (`:231`) | `src/game/keybind.cpp:85 unsigned int sc = 0;` |
| 13 | «Do not create stand-alone notes / changelogs … Documentation lives in the per-system docs **orchestrated by the README**» (`:367`) | 45 root `.md` + 21 in `Docs/`. **Nine per-system docs are not referenced by README at all**: `audio.md`, `conversation.md`, `ddalight.md`, `hud.md`, `inventory.md`, `loadout.md`, `menu.md`, `powergrid.md`, `production.md` |

### 4.3 The four rules the brief singled out

**(a) «Звук — производная ФИЗИКИ мира, никогда не ввода»** (`AGENTS.md:135`) —
**enforced by exactly one test, not by a gate, and honoured today.**
`tests/game_test.cpp:2868 test_footsteps_from_physics()` pins grounded+velocity as the sole
footstep predicate, asserts silence in air and at rest, and runs under the pinned `game_test`.
The producer moved correctly: `main.cpp:3801` «Шаги игрока БОЛЬШЕ НЕ ЗДЕСЬ. Их публикует
`encumbrance_step`», producer at `:4548`. `grep -i 'noise\|audio\|sound' tools/*.cmake` → nothing.
The rule also survives partly by **absence**: `AudioSystem::trigger_ui`
(`src/audio/audio_system.cpp:61`) and `play_3d` (`:65`) are called by **nobody** in `src/` or
`tests/`, so the whole `synth_ui.cpp` UI-sound path is dead code — the unwired-system class
`check_wired.cmake` exists for, escaping because the gate harvests only `*_step`/`*_tick`
(`check_wired.cmake:99`). The two closest input-adjacent sounds (`main.cpp:4279` possession,
`:4246` relief) are both gated on the sim action having succeeded, so they comply.

**(b) «Константы обязаны выводиться из свойств объекта» is NOT IN AGENTS.md.**
`grep -i 'derive\|происхожд\|вывод\|магическ\|magic\|tunable' AGENTS.md` finds only `:235`
«Use `constexpr` for tunables; group at top of file». The owner's rule is real and is honoured in
places — `room_zone.h:171 kRoomFieldMask` is an `inline constexpr = []{…}()` derivation;
`combat.cpp:375-382` normalises knockback at `kKnockbackRefMassKg`;
`encumbrance.cpp:132-136` derives footstep cadence from speed and body height, pinned at
`game_test.cpp:2921-2926`. But because the rulebook never states it, it cannot be a dead letter —
it is an **unwritten rule**, which is exactly why it keeps being re-litigated. Violations of even
the *weaker written* rule are everywhere: `main.cpp:3836-3837` —
`if ((simTick + entt::to_integral(me_)) % 250 == 0)` then
`game::NoiseProfile flashNoise{14.0f, 1800, 2, …}` — five undeclared literals inline, none
traceable to any property of a Lampoglaz. `combat.h:122 get_cell_hazard` still hardcodes 15/10/20
damage and channels (problems.md §41 says so in its own closure text). `main.cpp:7052` hardcodes
the `420`-frame threshold that no document names.

**(c) File-size limit: stated at `:226`, never enforced.** See dead letter #4.

**(d) No-globals: violated in all three layers.** See dead letter #3.

**(e) Native-first (`:72-90`, four conditions).** Convention only. Condition 4 ("the script never
enters the tree") is the only checkable one and holds: `git ls-files | grep -E '_patch|patch_.*\.(py|sh)'`
is empty; all `tools/*.py` are sanctioned CSV→C++ generators (`jirnyak.md` §15).

**(f) Exceptions/RTTI ban.** The **text gate** (`check_source_rules.cmake:327-338`) is the real
enforcer and covers `src/` + `tests/` on both hosts. The **compiler half has a hole AGENTS.md does
not mention**: `giga_target_flags()` couples both flags into one `if(NOT rtti)` branch
(`CMakeLists.txt:99-106`), so `giga_target_flags(gigahrush2 ON)` at `:411` — labelled "RTTI is
permitted in the app shell" — **silently drops `-fno-exceptions` from the shipping executable too**.
`jirnyak.md:29` asserts the flag is universal; for `gigahrush2` itself it is false.

**(g) No TODO/FIXME / ASCII-only rule: does not exist.**
`grep -n 'TODO\|FIXME\|XXX\|HACK\|ASCII\|emoji' AGENTS.md` → nothing. (For reference, the tree
carries exactly 1 `TODO|FIXME` in `src/` — the discipline is real, the rule is not written.)

### 4.4 Two AGENTS.md rules that are themselves stale

* `:17` — «All new rules … MUST be written to `C:\hades\gigahrush2`». The repo is at
  `/Users/jirnyak/Mirror/gigahrush2` on macOS. The path is fiction.
* `:290` — «Ensure **zero warnings**. Treat warnings as errors in review.» There is no `-Werror`
  anywhere, so a warning cannot fail the build; "in review" is the honest reading, and there is no
  review gate either.

---

## 5. `master_prompt.md` (75 KB) and `jirnyak.md` (48 KB)

### 5.1 What they are

* **`jirnyak.md`** — the *owner's* voice: 26 numbered doctrine sections (⛔ forbidden / ✅ allowed /
  ⚙️ hard technical frames 1–17, then 18–26 as feature mandates), a "КАТАЛОГ ТОЧЕК РАСШИРЕНИЯ", and
  an "АРХИТЕКТУРНЫЙ МАНИФЕСТ ЖИРНЯКА" carrying its *own* §8.1–8.6. It is the constitution the code
  cites: **67 citations** across `src/`, `tests/`, `tools/`.
* **`master_prompt.md`** — the *agent's* running contract: state of the game layer, what is built,
  what is next. **28 citations** in code. Accumulated sediment, but it holds the only fully
  accurate constants block in the tree.

### 5.2 Cross-reference rot — `src/` citing `jirnyak.md §N`

| Cited § | Count | Section exists? | Still says what the comment claims? |
|---|---|---|---|
| §18 (props/interactables) | **46** (31 `§18`, 14 `section 18`, 1 `s18`) | ✓ `:154` | **NO — see below** |
| §6 (resource limits) | 3 | ✓ `:94` | ✓ |
| §1 (numbers / powers of two) | 3 | ✓ `:67` | ✓ |
| §21 (data-driven props) | 3 | ✓ `:203` | ✓ |
| §7 (caching/hashing) | 2 | ✓ `:100` | ✓ |
| §9 (player is not special) | 2 | ✓ `:109` | ✓ |
| §3 (flat arrays / no alloc in Tick) | 1 | ✓ `:77` | ✓ |
| §19, §20, §24 (incl. `18/19`, `18/20`) | 5 | ✓ `:184, :196, :232` | §24's title is wrong (§6) |
| **§22 (LAZY FIELD REBAKING)** | 1 — `src/world/nav.h:134` | ✓ `:210` | **NO** |

**Every section number resolves. It is the *content* that has rotted, and it has rotted under the
two most-cited sections.**

1. **§22 is a mandate for a deleted system.** `src/world/nav.h:134` reads
   `// jirnyak.md §22 vs problems.md §2 conflict — the background thread is …`.
   `jirnyak.md:210-214` §22 still *requires* «АСИНХРОННЫЙ ФОНОВЫЙ ПОТОК … lazy field rebaking».
   `LazyFieldRebaker` was **deleted whole on 2026-08-06** (problems.md §2/§14). `problems.md:723-726`
   §23 lists this exact conflict as *«осталось, требует решения владельца»*. Eleven days later
   jirnyak.md §22 is unchanged, §23 still says "requires the owner's decision", and the source
   comment still points readers at an unresolved fight.
2. **§18 — 46 of 67 citations (69 %) point into a section the owner's own registry says needs
   rewriting.** `problems.md:722`: *«[jirnyak.md] §18 описывает `src/render/prop_placer.cpp` как
   «текущий баг» — файл вырезан, раздел надо переписать в SHIPPED»*. Verified:
   `grep -rn 'prop_placer' src` → **0 hits**.

**Structural hazard.** `jirnyak.md` has two colliding numbering schemes:
`### 8. ТОРОИДАЛЬНЫЙ МИР` (`:104`) and `## 🏛️ 8. АРХИТЕКТУРНЫЙ МАНИФЕСТ` (`:299`) are both "§8".
Any future `[jirnyak.md] §8` citation is ambiguous by construction. (`main.cpp:6713` already has to
disambiguate by writing `§19/§8.6`.)

### 5.3 Stale fraction

**`jirnyak.md` — 4 of 26 doctrine sections stale or dead (≈15 %), but they carry 70 % of the
citations:**

| § | Problem |
|---|---|
| §18 | Describes a deleted file as "the current bug"; must become SHIPPED. 46 citations depend on it |
| §22 | Mandates `LazyFieldRebaker`, deleted 2026-08-06. **DEAD — delete the section** |
| §24 | Title says «32 ЛИФТА», body says 48, `elevators.md:122` and the code say **16** |
| §12 | «WARNINGS AS ERRORS (ИДЕАЛЬНАЯ СБОРКА)» — no `-Werror` exists |
| §14 | «НЕ ТРОГАТЬ CMAKE ВРУЧНУЮ» — `CMakeLists.txt:237-240, :387, :437` hand-list eleven files |
| §17 (line 29) | «Код компилируется с флагом `-fno-exceptions`» — false for the shipping exe (§3.3 #37) |

**`master_prompt.md` — the stale fraction is concentrated in its status claims, not its rules:**
`:973` records `main.cpp` at **5 616** lines under "PLAN E"; HEAD is **7 266** — the decomposition
plan is 1 650 lines stale **in the wrong direction**. Its *rules* half, by contrast, is the best
text in the repo: `:1061-1064` forbids bare `1/120` and `1/125` literals and points at
`kSimStepMs * kSimHz == 1000`, which is exactly what `src/core/tick.h:31` asserts; `:1026`
(`kMacroDim=128`, `kCellSize=2.0 m`, `kWorldExtent=256 m`) matches `src/world/types.h:17,34,39`
**exactly** — the only fully accurate constants block I found.

### 5.4 A third rulebook nobody mentioned: `.clinerules`

`git ls-files` shows **`.clinerules` is tracked**. Line 4-5:

> «1. ZERO SCRATCH / DUMP SCRIPTS POLICY (THE NATIVE-FIRST LAW): You are **ABSOLUTELY FORBIDDEN**
> from writing Python, Bash, Node, or PowerShell wrapper scripts to edit, append, test, or generate
> code…»

That is the **pre-2026-08-12 absolute ban**, which `AGENTS.md:72-90` explicitly replaced with a
four-condition permission. It is a harness-auto-loaded file at repo root, so an agent entering this
repository gets **two mutually exclusive native-first laws**, and `.gitignore` — which already
refuses `.agents/`, `appDataDir/`, `.goosehints` — covers neither `.clinerules` nor `.agent_mem/`.

---

## 6. Contradictions matrix

| Fact | Doc A | Doc B | Code | Winner |
|---|---|---|---|---|
| **Tick rate** | `master_prompt.md:1064` «Never write a bare `1/120` or `1/125`; use the constant» | `performance.md:39` «`sim_bench` still prints `@120Hz @60Hz` over numbers computed at 125 Hz» | `src/core/tick.h:26 kSimHz = 125` | **125 Hz.** Both docs are right and the **code is wrong**: `tests/sim_bench.cpp:307` literally prints `"max agents @120Hz   @60Hz\n"`. A doc-flagged code defect unfixed for 11 days |
| **Save version** | `README.md:130`, `Docs/specs/10:19,478`, `MASTER_ROADMAP:252,438` — **v9 / v10** | `inventory.md:22` — **v15**; `conversation.md:48` — **v16** | `src/game/save.h:171 kSaveVersion = 16u` | **v16.** Four documents are 6 revisions behind. The per-system docs (touched 2026-08-17) are right; the **index and the specs** are wrong |
| **Elevator shafts** | `jirnyak.md:232` — «32 ЛИФТА» (body: 48) | `elevators.md:6,122` — "**16 planar hub cabins** … keep the 16 that exist"; `Docs/specs/16` — "16 shafts not 32" | `src/game/fast_travel.h:33-43` — one 4×4 grid = **16** | **16.** `jirnyak.md` is the stale side |
| **`main.cpp` size** | `problems.md:1101` — 5 616 | `README.md:127` / `Docs/specs/07` — 5 927; `master_prompt.md:973` — 5 616 | `wc -l` = **7266** | **None of them.** The metric moved 29 % while three docs sat still |
| **Cell size / world extent** | `AGENTS.md:213-214`, `voxels.md:29-31`, `README.md:62`, `master_prompt.md:224,1026`, `physics.md:67-69`, `ARCHITECTURE.md:9` | — | `src/world/types.h:17,23,34,39`: `kMacroDim=128`, `kSubDim=8`, `kCellSize=2.0`, `kWorldExtent=256` | **Unanimous and correct.** The one fact every document gets right |
| **`kSubDim` is a one-line toggle** | `voxels.md:29-33` and `src/world/types.h:6` both promise flipping to 16 is one line | `problems.md:1197-1202` §30 proves it is ill-formed (`macro_grid.h:33-35` assumes one 64-bit word = one Z-layer; 16 gives a shift of 119 on a 64-bit type) | `kSubDim = 8` | **problems.md.** Two places still advertise a toggle that does not compile |
| **Is `bank_step` wired?** | `src/game/economy.h:415` — "still unwired" | `src/game/save.h:164` — "§52's bank_step entry closes with it" | `src/app/main.cpp:3240` calls it | **save.h.** `economy.h:415` is a stale in-code comment |
| **Noise-reaction mechanic** | `jirnyak.md:17` lists «Новая универсальная механика реакции монстров на шум» under «КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО» | `AGENTS.md:139-140` **mandates** it: «всё через шумовое поле ([src/game/noise.h] NoiseField → audio)» | `src/game/noise.h`, `investigate.h:98 investigate_hear`, `:110 investigate_step` — built | **AGENTS.md.** One doc forbids what the other requires |
| **Native-first law** | `.clinerules:4-5` — "ABSOLUTELY FORBIDDEN" | `AGENTS.md:72-90` — permitted under four conditions | n/a | **AGENTS.md** (owner's 2026-08-12 decision). `.clinerules` should be deleted or gitignored |
| **`-fno-exceptions` coverage** | `jirnyak.md:29` — universal | `CMakeLists.txt:411 giga_target_flags(gigahrush2 ON)` | The exe gets neither `-fno-rtti` nor `-fno-exceptions` (`:99-106`) | **CMakeLists.** The text gate is the only enforcement for `src/app` and `src/render` |
| **Equipment slots** | `ARCHITECTURE.md:360` — «слотов экипировки НЕТ», `equipSlot` read in one place | `MASTER_ROADMAP:247` lists `EquipSlot`/`Equipped` as *planned* item 5.2 | `src/game/equip.{h,cpp}` built; 6 distinct `equipSlot` readers; 83 hits for `Equipped` | **The code.** Both docs are behind, in opposite ways |
| **CSV drift gate coverage** | `problems.md:688` — "9 таблиц из 15" | marko `e1212adc` — "15/15" | 9 `_giga_csv_vs_header` calls / **16** CSVs | **9 of 16.** Both wrong; reality drifted further because `data/sounds.csv` landed ungated |
| **Coordinate convention** | `combat.h:92` "Z-up: the 0.40 m mount offset rides the vertical (z) axis" | `combat.cpp:541-542` comments "Flatten on ground" on `half.y`, "Extend along floor" on `half.z` | Z-up (`types.h`, `gravity.h`) | **Z-up.** The corpse block is a surviving Y-up island — problems.md §34, live |

### 6.6 `README.md` specifically — the doc map is the least accurate doc per KB

* `:8` badge `Audit-100% Verified` — static shields.io PNG, **empty link target** `()`.
* `:9` badge `Runtime-Zero Allocation` — same, contradicted by problems.md §30's own finding.
* `:27` cites `taste.md` — file does not exist.
* `:114` "§1–§45" → 57.
* `:127` "5927-line" → 7266.
* `:130` "Save v10" → v16.
* `:132` spec 11 scope names "vendor" — the window is gone.
* `:150-153` "Specs 20 and 21" → spec 20 deleted.
* `:62` is the **model of a good line**: it states `kMacroDim`, `kCellSize`, `kWorldExtent = 256`
  *and* explains why writing 128 is the bug §7 cost a month to find. That paragraph is exactly right.
* `:7` (the `source-rules.yml` badge) is the only live signal on the page.

---

## 7. `index.html` + the web payload at repo root

| File | KB | Author | Date | Touched since |
|---|---|---|---|---|
| `index.html` | **151** | **Петушков А.** | 2026-07-30 | never |
| `favicon.svg` | 0.25 | Петушков А. | 2026-07-30 | never |
| `sitemap.xml` | 0.27 | Петушков А. | 2026-07-30 | never |
| `site.webmanifest` | 0.29 | Петушков А. | 2026-07-30 | never |
| `.nojekyll` | 0 | Петушков А. | 2026-07-30 | never |

Eleven commits, all 2026-07-30, all Петушков А.: *"Deploy SPA for GIGAHRUSH 2"*,
*"seo: inject Schema.org JSON-LD, OpenGraph meta tags, canonical URL & FAQ schema"*,
*"i18n: add multi-language switcher (EN/RU/ZH/DE) for global SEO"*, *"pwa: add PWA webmanifest"*,
*"chore: optimize sitemap.xml for SEO, GitHub Pages & deployment"*.

**Its entire visible prose, extracted** (tags/CSS/JS stripped):

> GIGAHRUSH 2 sequel with C++23 3D engine. … Core Features: **Immersive World** — *"Dive deep into a
> rich environment designed with meticulous attention to detail and atmosphere."* **Advanced
> Engine** — *"Powered by custom technology to ensure optimal performance and stunning visual
> fidelity."* **Dynamic Mechanics** … **Atmospheric Audio** … **Tech Stack: HTML5 · CSS3 ·
> JavaScript · Canvas API** … FAQ: *"How is GIGAHRUSH 2 different from V1? V2 introduces dynamic
> lighting shaders, 3D floor height transitions, and advanced entity AI."* … **© 2024 GIGAHRUSH 2.**

1. **It describes nothing in this repository.** The "Tech Stack" lists the technologies of the
   landing page itself — not a C++23 / Vulkan / MoltenVK / SDL3 / EnTT voxel simulator. Zero
   mentions of Vulkan, voxel, torus, 128³, or any project noun. `grep -oE '128³|Vulkan|voxel|torus'`
   → nothing; the only technical string in the file is "C++23" (10×, in decorative chips).
2. **The FAQ answer is invented.** "3D floor height transitions" and "advanced entity AI" have no
   counterpart in the code or the docs.
3. **`© 2024`** in a repo whose commits are dated 2026.
4. **151 KB of inlined CSS/JS** at repo root, matching no lint, no gate, no test.
5. **It is live and it publishes the whole repository.** `pages.yml:29-31` and `static.yml:26-28`
   both `upload-pages-artifact` with `path: '.'` — the deployed site contains every source file,
   `problems.md`, and `.agent_mem/sub_gigahrush2.mem.json`.
6. A third workflow, `deploy-gh-pages.yml:34`, uploads `path: 'docs'`, which does not exist (the
   tracked directory is `Docs/`) — that job has failed on every push to `main` since it landed.

**Verdict: DELETION CANDIDATE, high confidence.** Nothing in `src/`, `tests/`, `tools/`, or
`CMakeLists.txt` references any of it
(`grep -rn 'index.html\|favicon\|webmanifest\|sitemap' src tools tests CMakeLists.txt` → 0 hits).
Removing it deletes 152 KB of fiction and closes an unintended public mirror of the whole repo.

---

## 8. Proposal — ranked

### DELETE (≈154 KB, zero code references)

| Item | KB | Why |
|---|---|---|
| `index.html` | 151 | Describes a different product; © 2024; never maintained; publishes the repo |
| `favicon.svg`, `sitemap.xml`, `site.webmanifest`, `.nojekyll` | 1 | Support files for the above |
| `.github/workflows/pages.yml`, `static.yml` | — | Duplicate jobs, one concurrency group, `path: '.'` |
| `.github/workflows/deploy-gh-pages.yml` | — | Broken since inception (`path: 'docs'` vs `Docs/`) |
| `.github/dependabot.yml` npm block | — | No `package.json`; source of 4 junk remote branches |
| `.clinerules` | — | A **second, contradictory** native-first law auto-loaded at repo root (§5.4) |
| `.agent_mem/sub_gigahrush2.mem.json` | — | Banned by `AGENTS.md:96`; add `.agent_mem/` to `.gitignore` |
| `jirnyak.md` §22 | — | Mandates `LazyFieldRebaker`, deleted 2026-08-06. Deleting it also resolves the conflict `src/world/nav.h:134` points at |
| `tools/check_wired.cmake:44` `cellular_step` entry | — | Deferral for a symbol deleted 2026-08-10 |

### MERGE / DEMOTE

| Item | KB | Action |
|---|---|---|
| `Docs/specs/01–19, 21` | ~640 | **Move to `Docs/archive/2026-08-10/`, stamp "SNAPSHOT — not maintained".** Measured 20–36 % false, and `README.md:120-141` cites them as current |
| `Docs/MASTER_ROADMAP.md` | 59 | 23 % false. Fold the still-open rows into `problems.md`; the "СДЕЛАНО" rows are history |
| `ARCHITECTURE.md:355-370` (the conflict table) | — | **Re-verify or delete.** 5 of 14 sampled claims false; it is the highest-error content in the tree |
| `macrosim.md` faction section (`:180-245`) | — | Rewrite or cut: describes `FactionId`/`FactionMatrix`/`faction.cpp`/`factions()`, none of which exist; `macro_sim.h:294` refutes its central claim |
| `fluid.md` (2) + `diffusion.md` (5) + `fields.md` (5) | 12 | One `fields.md` |
| `camera.md` (2) + `controller.md` (1.6) | 4 | One `controller.md` — two halves of one seam |
| `world.md` (2) + `voxels.md` (6) | 8 | One `voxels.md` |
| `worldgen.md` | 2 | Two-line tombstone; fold into `floors.md` |
| `netcode.md` | 12 | Oldest doc (2026-07-29), step #1 of N built. Prefix **PLAN** or archive |
| `production.md` | 14 | `RoomStock` absent from `src/`. Mark **PLAN**, not description |

### KEEP — the minimal set (8 entries, ~200 KB after trimming)

| File | KB now → target | Why it earns its place |
|---|---|---|
| `AGENTS.md` | 25 | The only rulebook with mechanical backing. Needs its 13 dead letters either gated or struck, and the two stale rules (`:17` Windows path, `:290` warnings-as-errors) fixed |
| `jirnyak.md` | 48 | The constitution; 67 code citations depend on it. **Requires §22 deletion and §18 rewrite before it can be trusted**; disambiguate the two "§8"s |
| `ARCHITECTURE.md` | 35 → 28 | Layer map is sound; drop or re-verify the conflict table |
| `problems.md` | 279 → **~120** | The only doc with a working evidence culture. **Split**: `problems.md` (live sections) + `Docs/archive/problems-closed.md` (30+ closed ones — lessons, not state). Fix the header |
| `README.md` | 15 → 6 | Strip both fake badges and the 7 false claims; keep the doc map and `:62` |
| `master_prompt.md` | 75 → ~25 | Keep the constants block (`:1026`) and the tick-rate rule (`:1061-1064`) — the best text in the repo; the rest is session sediment |
| Per-system docs touched within 3 days (`items.md`, `menu.md`, `loadout.md`, `physics.md`, `powergrid.md`, `elevators.md`, `gravity.md`, `ecs.md`, `events.md`, `voxels.md`, `world.md`, `camera.md`, `controller.md`, `fields.md`) | ~65 | **0 false citations in 103 samples.** These are the docs the owner actually maintains, and `items.md` is the model: it documents its own obsolete parts as obsolete |
| `LICENSE.md` | 3 | legal |

### Three structural fixes worth more than any deletion

1. **A gate that greps docs for `file.ext:NNN` citations and fails when that line does not contain
   the quoted token.** The measured false-citation rate (11 % strict, 22 % with mislocation, 36 %
   in the worst spec) is a mechanical problem with a mechanical answer, and the machinery already
   exists: `check_source_rules.cmake` reads files and appends to `GIGA_FAILURES`. The evidence is
   unambiguous — **11 of 11 pins into `main.cpp`/`wander.cpp` missed; every pin into a stable
   header was exact.**
2. **A rule that a `problems.md` status line may only change in a commit that also touches `src/`,
   `tests/`, or `tools/`.** All 14 of `marko1olo`'s doc-only closures would have been rejected by
   that one rule.
3. **Extend `check_wired.cmake` past `*_step`/`*_tick`.** It already earns its keep (41 entry
   points, one FATAL). Widening it to any header-declared function with no external caller would
   have caught `AudioSystem::trigger_ui` / `play_3d` (dead UI-sound path), `mark_fluid_dirty`,
   `LevelStack::above/below`, and every `trait_*` accessor — the whole §35 "data with no reader"
   class, in one gate.

---

## 9. What the owner should read first

* **§2.3** — 17 of 17 sampled `marko1olo` closures are false at HEAD. The method is deletion of
  evidence (+158 / −525 lines across 14 doc-only commits), and they are **hidden from
  `git log problems.md`** unless you pass `--full-history`.
* **§2.4** — his own closures are all real, but 9 of 31 now cite files, lines, or values that no
  longer exist. The registry caught the disease it was written to diagnose.
* **§3.1** — the number: **11.0 % strict / 22.0 % combined, N = 236.** `Docs/specs/07` at 36.4 %
  and `ARCHITECTURE.md`'s conflict table at 35.7 % are the two documents to stop citing today.
* **§4.2 #3** — `main.cpp:177 g_bakedFloorLights` is a **new** no-globals violation, introduced
  by yesterday's DDA-light commit. The rule has no gate.
* **§5.2 / §5.4** — `jirnyak.md` §22 still mandates a system deleted 11 days ago, and a **second,
  contradictory** rulebook (`.clinerules`) is tracked at repo root, still carrying the absolute
  script ban the owner lifted on 2026-08-12.
* **§7** — 152 KB of a stranger's marketing SPA at repo root, publishing the entire repository
  (`.agent_mem/` included) to GitHub Pages on every push to `main`.
