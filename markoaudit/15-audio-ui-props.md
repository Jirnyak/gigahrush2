# Audit 15 — AUDIO / UI-HUD / PROPS / ANTOURAGE
**Repo:** `/Users/jirnyak/Mirror/gigahrush2` · branch `torus` · HEAD `97bdf13e` · audited 2026-08-17
**Scope:** legacy & dead-code hunt so the owner can delete cruft and keep FEW GENERAL systems.
**Method:** every claim below carries a `file:line` verified today by grep/read. Repo docs were treated as hostile witnesses.

---

## 0. Headline

| # | Finding | Class | Evidence |
|---|---------|-------|----------|
| 0.1 | `data/sounds.csv` is **14 bytes — a header and zero rows**; `data/sounds/` is **empty**. The entire artist-sample override path (66 LOC + `SampleBank` + music channel) has never loaded one byte. | DEAD-DATA | `data/sounds.csv` (od: `sound_id,file\n`), `ls data/sounds/` = empty, `src/audio/audio_system.cpp:207-272` |
| 0.2 | **`UiSynth` (217 LOC) is never triggered.** `trigger_ui()` has ZERO callers in `src/`. Its buffer is mixed into every output block, forever silent. | UNWIRED | `src/audio/audio_system.cpp:61`, `src/audio/audio_mixer.cpp:241,290-292`; only caller anywhere is `tests/suite_audio.inl:355` |
| 0.3 | **Six sound-emission sites fire from a keypress, not from physics** (E/P handlers in `main.cpp`), and five of them are mis-tagged `NoiseSource::Door`, so a player **urinating** publishes a "door" noise and the mixer plays the 280 ms hermetic blast-door synth. | SOUND-FROM-INPUT | `src/app/main.cpp:4098, 4137, 4195, 4218, 4246, 4279` |
| 0.4 | Footsteps themselves ARE correct — one law, all bodies, gated on `grounded` + speed, cadence derived from stride/height. The owner's rule holds at its headline case. | COMPLIANT | `src/game/encumbrance.cpp:125-140`, `src/game/encumbrance.h:96-108` |
| 0.5 | **`loot_containers_step` (68 LOC) has no call site in `src/`** — kept alive only by `tests/game_test.cpp:4615`. Its `noise_publish` is the ONLY publisher of `NoiseSource::Container`, so `SoundId::ContainerOpen` is unreachable at runtime. | DEAD | `src/game/container.cpp:367-435`, esp. `:420` |
| 0.6 | Of the mixer's 6 channels, **2 are fully dead (ui, music), 1 is a frozen constant (ambient), 1 is half-dead (geiger dose arm)**. Only spatial + siren carry live data. | UNWIRED | see §1.4 |
| 0.7 | The **Crafting window (183 LOC) is 182/183 lines `marko1olo`**, in English, outside the CRT palette, and hardcodes two game-layer enum name tables in the UI. | LEGACY | `git blame -L 440,622 src/app/main.cpp` → 182 marko1olo / 1 Jirnyak; `src/app/main.cpp:450-451` |
| 0.8 | The **debug tree (569 LOC inside `main.cpp`) is 411/569 `marko1olo`** and now duplicates the HUD the owner just built (HP bar, needs, hands, inventory listing). | LEGACY / DUPLICATE | `git blame -L 5109,5677 src/app/main.cpp`; `src/app/main.cpp:5217-5225` vs `src/app/hud_ui.cpp:54-75` |
| 0.9 | **10 hand-rolled ImGui window scaffolds, 5 duplicated palette blocks in 2 incompatible types, 19 inline colour literals, 4 independent "bar" implementations, 3 independent inventory renderings.** Zero shared widget helpers. | DUPLICATE | §3 |
| 0.10 | `UiWindow::Dialog` is a dead enum value — 0 references outside its own declaration. | DEAD | `src/app/ui_shell.h:44`; `grep -rn "UiWindow::Dialog" src/` = 0 hits |
| 0.11 | Menu and Pause **do share** the settings widget (good) but keep **two separate page-state variables with two different page numberings**, and `ui_shell.h:50` documents the opposite. | DUPLICATE / SPEC-LIE | `src/app/ui_shell.h:50` vs `src/app/main.cpp:2305` (`int menuPage`) and `main.cpp:6595,6679` |

---

# 1. AUDIO

## 1.1 Every sound-emission site in `src/`

There are exactly **two ways** a sound reaches the mixer:
* `noise_publish(...)` → `NoiseField` → `AudioSystem::process_noise_events` → `play_spatial_sound` (`src/audio/audio_system.cpp:69-131`)
* `AudioSystem::trigger_ui(...)` → `UiSynth` — **zero callers** (§1.3)

`AudioSystem::play_3d` (`audio_system.cpp:65`) also has **zero callers**: `grep -rn "SoundId::" src/` outside `src/audio/` returns nothing. Direct 3-D playback is a public API nobody uses.

### Emission table (16 sites, all `noise_publish`)

| # | file:line | What triggers it | NoiseSource | → SoundId | VERDICT |
|---|-----------|------------------|-------------|-----------|---------|
| 1 | `src/game/encumbrance.cpp:136` | physics: `g->grounded && v² > 0.25`, cadence = stride/(speed·dt) | Footstep | Footstep | **PHYSICS-CORRECT** |
| 2 | `src/game/combat.cpp:454` | body dies inside `apply_damage` | Body | BodyFall | **PHYSICS-CORRECT** |
| 3 | `src/game/combat.cpp:1874` | grenade detonates in `projectile_step`, radius from blast | Explosion | Explosion | **PHYSICS-CORRECT** |
| 4 | `src/game/combat.cpp:2103` | ranged fire, one per trigger pull (not per pellet) | WeaponFire | Gunshot | **PHYSICS-CORRECT** |
| 5 | `src/game/container.cpp:420` | `loot_containers_step`, gated on `anyMoved` | Container | ContainerOpen | **UNREACHABLE** (function has no `src/` caller — §0.5) |
| 6 | `src/app/main.cpp:3838` | Lampoglaz flash ability, `(simTick+id) % 250 == 0` | **Door** | DoorMove | TICK-DRIVEN, **WRONG TAG** (a monster flash is not a door) |
| 7 | `src/app/main.cpp:3957` | `door_step` reports `broken > 0` | Door | DoorMove | **PHYSICS-CORRECT** |
| 8 | `src/app/main.cpp:3963` | `door_step` reports `opened > 0` | Door | DoorMove | **PHYSICS-CORRECT** |
| 9 | `src/app/main.cpp:3992` | `doorWanted` (Q key) → `door_toggle_near` succeeded | Door | DoorMove | **INPUT-SITE DUPLICATE** — `door_step` already publishes for every other body; the player's copy lives in the input handler |
| 10 | `src/app/main.cpp:4047` | `carve_sphere` removed > 0 cells | **WeaponFire** | Gunshot | PHYSICS-CORRECT trigger, **WRONG TAG** (`NoiseSource::Explosion` exists and is what a blast is) |
| 11 | `src/app/main.cpp:4098` | **E key opens the corpse search PANEL** | Body | BodyFall | **INPUT-DRIVEN-VIOLATION** |
| 12 | `src/app/main.cpp:4137` | **E key opens the crate search PANEL** | Container | ContainerOpen | **INPUT-DRIVEN-VIOLATION** |
| 13 | `src/app/main.cpp:4195` | **E key** on terminal | **Door** | DoorMove | **INPUT-DRIVEN-VIOLATION** + wrong tag |
| 14 | `src/app/main.cpp:4218` | **E key** shield sabotage | **Door** | DoorMove | **INPUT-DRIVEN-VIOLATION** + wrong tag |
| 15 | `src/app/main.cpp:4246` | **E key** — bladder/bowel relief | **Door** | DoorMove | **INPUT-DRIVEN-VIOLATION** + absurd tag |
| 16 | `src/app/main.cpp:4279` | **P key** — possess nearest survivor | **Door** | DoorMove | **INPUT-DRIVEN-VIOLATION** + absurd tag |

All six violations sit inside one-shot input flags consumed on the sim clock: `interactWanted` (`main.cpp:1883, 4070-4071`), `doorWanted` (`:1882, 3969-3970`), `possessWanted` (`:1884, 4253-4254`).

**The sharpest one is #12.** `container.cpp` reasons at length (`:415-418`) about gating the lid noise on `anyMoved` so *"standing next to an opened box would publish 120 records a second"* cannot happen. That reasoning lives in the **dead** function. The **live** player path (`main.cpp:4137`) has no such gate: open/close the panel N times, get N lid noises with no item ever moved.

**#11 is the same shape:** the comment says *"Ворошить тело слышно"* (rummaging a body is audible), but nothing is rummaged — the noise fires when the *window opens*.

**`NoiseSource::Door` as a catch-all.** Five sites (#6, #13, #14, #15, #16) tag non-door events as doors. Consequences are not cosmetic: (a) every monster's `hunt_step` noise-investigation branch is told "a door moved there"; (b) the mixer maps it to `SoundId::DoorMove`, whose synth is a 280 ms Soviet hermetic blast door — grind + pneumatic hiss + steel latch clack (`src/audio/audio_mixer.cpp:168-181`) — played for a man relieving himself.

### Sources declared but never published

| NoiseSource | Declared | Published? | Consequence |
|---|---|---|---|
| `Melee` | `src/game/noise.h:89` | **NEVER** (`grep NoiseSource::Melee src/` → only the name table `noise.cpp:221` and the audio switch `audio_system.cpp:105`) | `SoundId::MeleeHit` and its 8 LOC synth (`audio_mixer.cpp:154-159`) are **unreachable** |
| `Siren` | `noise.h:94` | NEVER (declared "reserved") | dead enum value |
| `Decoy` | `noise.h:97` | NEVER (declared "reserved") | dead enum value |

### The owner's rule — compliance verdict

**PASS on the headline case.** `src/game/encumbrance.cpp:125-140` is exactly right and the comment there is honest about the history:
* one law for every body including the camera holder — no player special case;
* double gate from sim state only: `g->grounded` **and** `v² > 0.25` (0.5 m/s);
* cadence is **derived**, not authored: `footstep_period_ticks` = `kStepStrideOfHeight · height / (speed · dt)` (`encumbrance.h:96-108`) — a runner steps faster, a short body mincing, from the same numbers that give body mass.
* the **double-stagger trap is documented as fixed** (`encumbrance.cpp:118-124`): the old `(tick&7)==(id&7)` on top of the visit-hash `hash%8` meant 7/8 of the crowd was permanently mute. Current form is `(tick + hash_u32(id)) % period < interval`, with `kFootstepPeriodMin = 8 = kEncumbrancePeriod` (`encumbrance.h:93`) so the camera path (interval = 1) can never fire twice in a period. **I re-derived this and it holds.**

**FAIL on location, six times** (#11-#16). None of those go through a sim primitive; all publish straight out of the input handler.

**One undreived number in the compliant path:** `NoiseProfile np{6.0f * eff.noiseMult, 400, 1, ...}` (`encumbrance.cpp:134`). 6.0 m and 400 ms are asserted, not derived — in a file whose whole argument is that cadence must be derived. Contrast `weapon_fire_noise` (`noise.h:207-225`), which derives radius from damage and pellets. **MAGIC-CONST.**

## 1.2 `data/sounds.csv` — rows and columns

```
sound_id,file
```
**That is the entire file** (14 bytes, `od -c data/sounds.csv`). `data/sounds/` contains nothing.

| Column | Parsed | Consumed | Verdict |
|---|---|---|---|
| `sound_id` | `audio_system.cpp:225` | `sound_id_by_name` (`:192-204`), + special slug `music` (`:258`) | **live mechanism, zero data** |
| `file` | `audio_system.cpp:226` | `SDL_LoadWAV` (`:233`) | **live mechanism, zero data** |

| Rows | 0 |
|---|---|
| Rows ever played | 0 |

The loader (`load_sample_overrides`, 66 LOC), `SampleBank`/`SampleData` (`audio_types.h:65-80`), `sampleStorage_` + `set_sample_bank` (`audio_system.h:63-65`, `audio_mixer.h:36`), the sample branch in `play_spatial_sound` (`audio_mixer.cpp:74-80`), the sample branch in `synthesize_spatial_voice_sample` (`:124-131`) and the whole music channel (`audio_mixer.cpp:316-323`, `musicPos_`) exist to serve an empty file.

**Verdict:** this is a *hook*, not a bug — the "artist file beats procedural default" policy matches textures (`cube_pass.cpp`). But it is ~120 LOC of untested-in-anger machinery for a table with no rows. Call it **DEAD-DATA / speculative**, and decide: keep the hook and delete the *music* half (which has no procedural fallback at all, so today it is unconditionally silent), or delete the whole thing until one WAV exists.

## 1.3 Synth modules — is any an orphan?

All four are constructed, reset and **mixed** (`audio_mixer.cpp:238-241` generate, `:275-292` accumulate). None is unlinked. But three of the four have no live input:

| Synth | LOC | Mixed? | Driven by | Verdict |
|---|---|---|---|---|
| `GeigerSynth` | 184 | ✅ `mixer.cpp:238,275` | `danger` from the layer's danger field (`audio_system.cpp:143-150`) — **live**; `radDose` is **hardcoded `0.0f`** at `:150` with the comment "radDose придёт со своей системой" | **HALF-DEAD** — `doseFactor` (`synth_geiger.cpp:76`) is permanently 0, so `set_rad_dose` and half of `effectiveHazard`/`basePitch` are dead arithmetic |
| `SirenSynth` | 168 | ✅ `:239,280` | samosbor phase (`audio_system.cpp:152-164`) | **LIVE** |
| `AmbientDroneSynth` | 197 | ✅ `:240,285` | `hudBrightness` — **hardcoded `1.0f`** at the only call site `main.cpp:7036`; `gridIntensity` — **never set outside tests** (default 0.8) | **FROZEN** — both knobs are constants, so the channel is a fixed drone; `set_grid_intensity` is test-only (`suite_audio.inl:228`) |
| `UiSynth` | 217 | ✅ `:241,290` | **NOTHING** | **UNWIRED — 0 triggers in `src/`** |

Trace for `UiSynth`: `UiSynth::trigger` ← `AudioMixer::ui()` ← `AudioSystem::trigger_ui` (`audio_system.cpp:61`) ← **nobody**. Verified `grep -rn "trigger_ui\|\.ui()" src/` returns only the declaration/definition pair and the mixer accessor. Every UI panel in the game (inventory, conversation, dice, bank, menu, settings, craft) is silent by construction.

`AudioConfig::uiGain` and `musicGain` (`audio_types.h:86-87`) therefore scale nothing.

### Mixer defects worth the owner's attention

* **No distance cull at voice allocation.** `process_noise_events` calls `play_spatial_sound` for *every* new noise id (`audio_system.cpp:124-127`); `play_spatial_sound` checks only `sound != None && gain > 1e-4` (`audio_mixer.cpp:40`) and `gain` is derived from **severity**, not distance. A noise 200 m across the torus burns one of 32 voices for its full duration.
* **No priority in voice stealing.** The victim is the *oldest* voice (`audio_mixer.cpp:45-54`). A footstep can evict a gunshot. Given ~15.6 footsteps/s per running body (period floor 8 ticks at 125 Hz), a moving crowd saturates the 32-voice pool with severity-1 taps.
* **`noise.h:136-139` sizing rationale is now false:** *"with the publishers wired today (one gunshot per weapon cooldown, one per crate, one per death) a busy second produces single digits."* Footsteps were added since; at 400 ms TTL and 15.6/s, **one running body holds ~6 of the 64 slots**, so ~10 runners saturate the field. `SPEC-LIE` — the eviction policy (weakest first) saves correctness, but the comment's arithmetic no longer describes the system.
* **Mix runs on the main thread** with a ~42 ms buffer (`audio_system.cpp:174-184`). Honestly documented in `audio.md:37-40`. Not a defect, a stated debt.

## 1.4 Dead audio API surface (functions alive only because a test calls them)

| Symbol | Defined | `src/` callers | Test caller | Verdict |
|---|---|---|---|---|
| `AudioSystem::play_3d` | `audio_system.cpp:65` | **0** | 0 | DEAD |
| `AudioSystem::trigger_ui` | `audio_system.cpp:61` | **0** | via mixer, `suite_audio.inl:355` | DEAD |
| `GeigerSynth::set_danger` | `synth_geiger.cpp:50` | 0 | `suite_audio.inl:84,104,352` | TEST-ONLY |
| `GeigerSynth::set_rad_dose` | `synth_geiger.cpp:54` | 0 | `suite_audio.inl:119` | TEST-ONLY |
| `AmbientDroneSynth::set_grid_intensity` | `synth_ambient.cpp:42` | 0 | `suite_audio.inl:228` | TEST-ONLY |
| `AmbientDroneSynth::compute_grid_harmonics` | `synth_ambient.cpp:51` | 0 — `generate()` **re-inlines the same math** at `:106-109` | `suite_audio.inl:210` | TEST-ONLY **+ DUPLICATE** |
| `AmbientDroneSynth::evaluate_fluorescent_hum` | `synth_ambient.cpp:61` | 0 — re-inlined at `:104-109` | `suite_audio.inl:217` | TEST-ONLY **+ DUPLICATE** |
| `AmbientDroneSynth::evaluate_subterranean_rumble` | `synth_ambient.cpp:68` | 0 — re-inlined at `:128-133` | `suite_audio.inl:221` | TEST-ONLY **+ DUPLICATE** |
| `AudioMixer::active_voice_count` / `voice(int)` | `audio_mixer.h:40-42` | 0 | `suite_audio.inl:350` | TEST-ONLY |
| `dsp_math.h::soft_clip` | `:44` | 0 | 0 | DEAD |
| `dsp_math.h::fast_sin` | `:61` | 0 (a wrapper around `std::sin`) | 0 | DEAD |
| `SVF::process_lp` / `process_hp` | `:124,136` | 0 | 0 | DEAD |
| `kCombDelaySamples` | `audio_types.h:42` | **0 anywhere** | 0 | DEAD |
| `SpatialVoice::rolloff` | `audio_types.h:49` | written once (`audio_mixer.cpp:61`), **never read** | 0 | DEAD FIELD |
| `SpatialVoice::customParam` | `audio_types.h:55` | **never written, never read** | 0 | DEAD FIELD |
| `AudioSystem::update(..., bus, ...)` | `audio_system.cpp:140` | `(void)bus;` | — | DEAD PARAM |
| `AudioSystem::update(..., doors, ...)` | `audio_system.cpp:137` | declared, **never dereferenced in the body** | — | DEAD PARAM (and `main.cpp:7038` passes `&doors`) |

Three synth statics (`compute_grid_harmonics`, `evaluate_fluorescent_hum`, `evaluate_subterranean_rumble`) are the worst kind: the sample loop does not call them, it *re-implements* them. Any tune to one drifts from the other silently, and the test suite validates the copy nobody hears.

## 1.5 `tests/suite_audio.inl` (385 LOC) — what it actually pins

It tests **waveform math**, never **wiring**. There is no test anywhere that a gunshot in the sim reaches the mixer, that a footstep reaches the mixer, or that a UI action makes a sound (it cannot — §1.3).

Tautologies found:
* `suite_audio.inl:198` — `CHECK(reverbMax >= 0.0f); // Reverb tail exists and decays gracefully`. `reverbMax` starts at 0 and is only raised by `std::fabs` — **this can never fail**, and it verifies neither existence nor decay. `MAGIC`/non-check.
* `:212` `CHECK(!std::isnan(harmonics[k]))` and `:218` `CHECK(!std::isnan(fHum))` — NaN guards standing in for a value assertion.

## 1.6 Audio magic constants (no visible derivation)

`kRefDistanceM = 1.5` and `kFadeDistanceM = 38.0` (`audio_types.h:16-17`); `kMaxAudibleDistM = 48.0` (`:15`) silently equals `kNoiseRadiusCap = 48.0` (`noise.h:145`) with **neither citing the other**; `layerGainMult = 0.35` (`audio_system.cpp:94`); `severity / 5.0f` (`:125`) writes `kNoiseSeverityMax` as a literal; ten authored voice durations (`audio_mixer.cpp:84-115`); `lambda0 = 0.35`, `kRad = 850`, smoothing `0.002` (`synth_geiger.cpp:66-73`); `crtAmp = 0.015 + 0.035·hud`, crackle Poisson rate `0.00018`, `gridAmp = 0.030`, `0.012/0.008` (`synth_ambient.cpp:100,117,124,139`); siren envelope `0.0001/0.00005` (`synth_siren.cpp:60-62`); all seven `AudioConfig` gains (`audio_types.h:83-89`).

Derived and therefore *fine*: `kTargetQueuedBytes` ("~42 ms", `audio_system.cpp:174`), `compute_occlusion_cutoff` / `compute_wall_attenuation` (`spatial_audio.cpp:17-27`, stated as "~-5.6 dB per solid concrete wall"), `footstep_period_ticks`.

## 1.7 `audio.md` (3.4 KB) vs code — 8 spot-checks

| # | Claim (`audio.md`) | Verdict | Evidence |
|---|---|---|---|
| 1 | "32 пространственных голоса" | **TRUE** | `audio_types.h:14` `kMaxSpatialVoices = 32` |
| 2 | ":29 Дистанции — торовые (`wrap_delta_f`, **все оси**)" | **FALSE** | `spatial_audio.cpp:33-35` wraps x and y only; `float dz = emitterPos.z - listenerPos.z;` and the code's own comment at `:32` says "non-wrapping in Z" |
| 3 | ":6 сирена С-40 с **гребёнчатой** реверберацией" | **FALSE-ish** | `synth_siren.cpp:107-118` is a 2-tap damped feedback delay network, not a comb; the actual `kCombDelaySamples` constant (`audio_types.h:42`) is **unused** |
| 4 | ":6 UI (синтезатор)" — implied audible | **FALSE in effect** | never triggered, §1.3 |
| 5 | ":16-21 `data/sounds.csv` — таблица override'ов … Спец-слаг `music`" | mechanism **TRUE**, data **empty** | `data/sounds.csv` has 0 rows; `data/sounds/` empty |
| 6 | ":25 Слушатель — тело с камерой (игрок не особенный)" | **TRUE** | `main.cpp:7025-7040` resolves `player`'s `Transform`+`CameraTag` |
| 7 | ":27-28 окклюзия — счёт стен по `los_blockers` … этажное затухание по layer" | **TRUE** | `spatial_audio.cpp:104`; `audio_system.cpp:88-95` |
| 8 | ":9-11 DSP-слой `giga_audio` без SDL, тестируется game_test'ом; `audio_system.cpp` только в exe" | **TRUE** | `CMakeLists.txt:236-244` and `:387` |

Bonus stale comment: `spatial_audio.cpp:32` says "1024m x 1024m sector" — the torus is **256 m** (`kMacroDim = 128` × `kCellSize = 2.0`, `world/types.h:17,34`). 4× wrong, fork legacy.

## 1.8 Audio authorship

`git log --format='%h %an %ad %s' --date=short -- src/audio/* data/sounds.csv audio.md tests/suite_audio.inl`
→ **one commit, `10e0ce2b Jirnyak 2026-08-17 "feat(audio): процедурная аудио-подсистема — DSP форка, универсальность наша"`.**

**Not marko.** But the shape is the same failure mode: a 1899-LOC subsystem landed in one commit with a test suite covering the *math* and nothing covering the *wiring*, and ~450 LOC of it is unreachable on day one. The commit message is honest ("DSP форка") — it is a port, and the dead API surface is what the fork shipped, imported wholesale.

---

# 2. UI REACHABILITY

## 2.1 Every panel/window/screen

| # | Panel | File:line | How it opens | Reachable at HEAD? |
|---|---|---|---|---|
| 1 | Intro splash `##intro` | `main.cpp:6540` | auto — `AppScreen::Intro` at boot (`ui_shell.h:48`); any key → Menu | ✅ |
| 2 | Main menu `##mainmenu` | `main.cpp:6588` | auto after Intro | ✅ |
| 3 | Pause menu `Menu` | `main.cpp:6673` | Esc → `menu` cmd (`keybind.cpp:104`, `console.cpp:319`) | ✅ |
| 4 | Settings tab-bar | `settings_ui.cpp:127` | menu page 3 / pause page 1, both via `draw_settings_page` (`main.cpp:2367`) | ✅ **shared** |
| 5 | Debug tree `gigahrush2` | `main.cpp:5109` | F1 → `hud` (`keybind.cpp:106`); **default hidden** | ✅ |
| 6 | Console | `main.cpp:699` | `` ` `` → `console` (`keybind.cpp:105`) | ✅ |
| 7 | Crafting `Workbench & Crafting Studio` | `main.cpp:440`, drawn `:6101` | C → `craft` (`keybind.cpp:140`) | ✅ |
| 8 | Elevator `ЛИФТ / ELEVATOR` | `main.cpp:6134` | L → `elevator` (`keybind.cpp:124`) | ✅ |
| 9 | Inventory grid | `inventory_ui.cpp:243`, drawn `main.cpp:5859` | I → `inventory` (`keybind.cpp:110`); also E on corpse (`main.cpp:4092`), crate (`:4130`), barter (`:6362`) | ✅ |
| 10 | Conversation menu `##conversation` | `conversation_ui.cpp:33`, drawn `main.cpp:6323` | E on a live NPC (`main.cpp:4164`) | ✅ |
| 11 | Dice `##dice` | `conversation_ui.cpp:88`, drawn `main.cpp:6281` | conversation option | ✅ |
| 12 | Bank `##bank` | `conversation_ui.cpp:156`, drawn `main.cpp:6216` | conversation option at a Duty clerk | ✅ |
| 13 | HUD slot windows ×4 | `hud_ui.cpp:196-221`, drawn `main.cpp:5100` | auto in `AppScreen::Playing` | ✅ |
| 14 | Interact prompt `##interact_prompt` | `main.cpp:6514` | auto on proximity | ✅ |
| 15 | CRT overlay `CRT_Overlay` | `imgui_layer.cpp:212` | auto unless `GIGA_NO_CRT` (`:201`) | ✅ |
| — | **`UiWindow::Dialog`** | `ui_shell.h:44` | **never assigned, never drawn** | ❌ **DEAD** |

**Good news: there are no unreachable panels.** The one dead entry is a reserved enum value. The UI's problem is duplication (§3), not orphans.

## 2.2 keybind.cpp cross-check — both directions

**Every bound action resolves to a live command row.** 22 command rows in `keybind_register_defaults` (`keybind.cpp:100-159`); all match `kRequestRows` in `console.cpp:318-340` or the multi-word handlers (`ride` at `console.cpp:780`, `attr` at `:344`). **Zero orphan binds.**

**Every window has an opener** (table above). **Zero orphan panels.**

Two deliberate oddities, both documented:
* `{"fly", "fly", 0, 0}` (`keybind.cpp:118`) — scancode 0, so **unreachable by keyboard by design** (owner's playtest decision 2026-08-18); the row survives so a rebind can restore it. Legitimate, but note the row is a *disabled default* rather than a deleted one.
* `fly_ascend`/`fly_descend` share E/Q with `interact`/`door` (`keybind.cpp:155-156` vs `:129,131`). `find_scancode` skips axis rows (`keybind.cpp:30`), so this is intentional and the header documents it (`keybind.h:64-67`).

## 2.3 What is missing in the reverse direction

`hud_ui.cpp` exposes `hud_elements()` for the settings toggles and `settings_ui.cpp:69-76` consumes it — a genuinely general seam. But **`HudElement::on` is a mutable global** (`hud_ui.cpp:183`, returned non-const at `:225-228`), so the settings tab writes directly into the draw table. Works; not a defect; worth knowing it is process-global, not per-shell.

---

# 3. UI DUPLICATION

## 3.1 Window scaffolds — 10 copies, 0 helpers

| Cluster | Copies | Sites |
|---|---|---|
| **A. Centred fixed-size modal** (`GetMainViewport` → centre → `SetNextWindowSize` → `Begin` with the same 5 flags `NoResize\|NoMove\|NoCollapse\|NoScrollbar\|NoTitleBar`) | **4** | `inventory_ui.cpp:239-246`, `conversation_ui.cpp:29-36`, `:84-91`, `:152-159` |
| **B. Centred auto-resize menu window** | **2** | `main.cpp:6584-6594`, `main.cpp:6675-6682` |
| **C. Decoration-free pinned overlay** (`NoDecoration\|NoInputs\|…`) | **4** | `hud_ui.cpp:213-220`, `main.cpp:6510-6520`, `main.cpp:6538-6544`, `imgui_layer.cpp:208-215` |

The A cluster is verbatim: same viewport maths, same flag set, differing only in `winW`/`winH` literals (420/440/460 × 120+24n/240/230 — all hand-tuned, `MAGIC-CONST`).

> **Proposal — one general widget.** `giga::ui::begin_panel(const char* id, PanelSpec spec)` where `PanelSpec { Anchor anchor; ImVec2 size; float bgAlpha; bool inputs; }` covers all three clusters (Anchor ∈ {Center, TopLeft, BottomLeft, BottomRight, BottomCenter, Fullscreen}). ~40 LOC of helper replaces ~90 LOC of copies and makes "one window at a time, служебная аппаратура" (`ui_shell.h:12-17`) enforceable in one place instead of by convention.

## 3.2 Palette — 5 blocks, 2 incompatible types, 19 inline literals

| Site | Representation |
|---|---|
| `imgui_layer.cpp:57-63` | `ImVec4` — the **canonical** CRT mandate |
| `hud_ui.cpp:23-26` | `ImVec4` copy (`kPhosphor/kAmber/kDanger/kDim`) |
| `settings_ui.cpp:15-16` | `ImVec4` copy (`kAmber/kDanger`) |
| `inventory_ui.cpp:27-34` | **`ImU32` copy** — with a comment claiming "стиль объявлен ОДИН раз в imgui_layer, а это его читатели" (`:25-26`). It is not reading it; it is re-typing it. |
| `conversation_ui.cpp:10-11` | `ImU32` copy |

Plus **10 inline amber literals** (`0.95f, 0.78f, 0.25f` / `242,199,64`) and **9 inline phosphor literals** (`0.349f, 0.949f, 0.400f` / `89,242,102`) scattered across `src/` (grep counts). `main.cpp` alone has 23 `ImVec4(` literals.

**Worse: the Crafting window ignores the palette entirely** — cyan `ImVec4(0.35f, 0.85f, 1.0f, 1.0f)` at `main.cpp:453`, and raw red/green `(1,0.3,0.3)`/`(0.3,1,0.3)` at `:530-532`. Direct violation of the CRT mandate (`AGENTS.md` UI law, restated `hud.md:52-57`).

> **Proposal:** one `src/render/ui_palette.h` exporting both `constexpr ImVec4 kPhosphor…` and `constexpr ImU32 kPhosphorU32 = …` derived from the same source, included by all five sites. ~25 LOC replaces 5 blocks + 19 literals.

## 3.3 Bars — 4 implementations, 3 techniques

| # | Site | Technique | Draws |
|---|---|---|---|
| 1 | `hud_ui.cpp:64-74` | `PushStyleColor(PlotHistogram)` + `ProgressBar` | player HP, 3 colour thresholds |
| 2 | `inventory_ui.cpp:259-266` | same technique, **different thresholds** (1.0 / 0.8) and **different colours** (hand-written `ImVec4` literals, not the file's own `kAmber`) | carried weight |
| 3 | `main.cpp:5217-5225` | same technique, **third** threshold set | debug HP — **duplicates #1** |
| 4 | `inventory_ui.cpp:179-184` | raw `ImDrawList::AddRectFilled` | item durability |

> **Proposal:** `ui_bar(float frac, ImVec2 size, const char* overlay = nullptr)` with **one** threshold table (`>0.8 warn`, `>1.0 danger`, `<0.25 warn` folded into a `BarPolicy` row). Kills #3 outright (the debug tree should read the HUD, not re-derive it) and unifies #1/#2. ~30 LOC replaces ~45 and removes three independent colour conventions.

## 3.4 Item slot / grid — 1 general widget, 2 rogue renderings

`draw_cells` (`inventory_ui.cpp:133-195`) is **exactly right**: one grid, `span` + `policy` + `marks`, both sides of a two-sided screen are the same code, procedural glyphs derived from item id (`:41-96`). This is the model the rest of the UI should follow.

But the same 64 slots are rendered **twice more, independently**:
* `main.cpp:590-615` — the Craft window's "Disassemble Inventory" `ImGui::BeginTable` with 5 columns, slot index, name, count, value, Scrap button. **marko1olo.**
* `main.cpp:~5275` (`for (const auto& sl : inv.slots)` inside the debug tree). **marko1olo region.**

> **Proposal:** disassembly is an *inventory action* — it belongs as one more `InvUiPolicy` flag (`allowScrap`) + one more `InvUiRequest::Kind::Scrap`, exactly like `allowRepair` already is (`inventory_ui.cpp:394-402`). That deletes the whole Disassemble tab (~55 LOC) and its rogue table.

## 3.5 Menu ⇄ Pause — the owner's specific question

**The settings widget IS shared.** `settings_ui_draw` (`settings_ui.cpp:125-138`) is called from one lambda `draw_settings_page` (`main.cpp:2367-2386`) invoked from both the menu page (`main.cpp:6651`) and the pause page (`main.cpp:6700`). Tabs are a data table (`settings_ui.cpp:116-121`). **This is done right.**

What is **not** shared:

1. **Two page-state variables.** `shell.menuPage` (`ui_shell.h:50`) for the main menu; a *separate* local `int menuPage` (`main.cpp:2305`) for pause. `ui_shell.h:50` documents `menuPage` as *"0 root, 1 load, 2 new-game, 3 settings (Menu **и Pause**)"* — **SPEC-LIE**: Pause never touches it.
2. **Two page numberings.** Settings is page **3** in the menu (`main.cpp:6601`) and page **1** in pause (`main.cpp:6694`). Two conventions for one concept.
3. **Duplicated settings-page wrapper**, 8 lines each, byte-similar: `main.cpp:6647-6656` vs `:6698-6705` (`TextUnformatted("НАСТРОЙКИ")` / `Separator` / `draw_settings_page()` / `Spacing` / `Button("Назад")` / reset `menuPage` + `rebindCapture`).
4. **Duplicated CRT-background block**: `main.cpp:6545-6551` (intro) vs `:6579-6588` (menu) — same black fill + 4 px scanline loop.
5. **Pause is data-driven** (`MenuItem{label, command}` rows, `main.cpp:6683-6693`); **the main menu is a hardcoded `if/else if` chain** (`:6595-6656`). Two philosophies for one screen. `menu.md:5-7` promises *"добавки были строками, а не переписыванием"* — true for pause, false for the menu.

> **Proposal:** move `menuPage` into `UiShell` (it is already declared there — just use it), unify the numbering with a `MenuPage` enum, and hoist the settings wrapper into a `draw_settings_page_framed()` used by both. ~30 LOC deleted, one source of truth restored.

## 3.6 `intro_ui.cpp` (503 LOC) — assessment

Self-contained, no duplication, and its own cell physics. **But:** 20 tuning constants at `intro_ui.cpp:49-68` with the provenance comment *"Константы рефа (shell.cpp), под теми же именами"* — provenance is not derivation. `kScatterSteps = 165`, `kFriction = 0.988`, `kFlySpeed = 850`, `kSpringK = 26`, `kPunchImpulse = 1900` etc. are imported magic. The owner playtested and approved the result, so this is **accepted MAGIC-CONST**, flagged for the record — 503 LOC of splash screen is also the largest single UI file in the tree, larger than the HUD (248) and the settings window (140) combined.

## 3.7 Micro-findings

* `inventory_ui.cpp:238` — `const float winH = cell * kInvCols / 1.0f + 96.0f;` — the `/ 1.0f` is vestigial. **DEAD**.
* `main.cpp:450-451` — `stationNames[5]` and `matNames[8]` hardcoded in the UI. There is **no** `craft_material_name`/`craft_station_name` anywhere (`grep` → 0 hits), so the UI is the *only* name table for `CraftMaterial` (`craft.h:117-128`) and `CraftStation` (`craft.h:136-141`). Two enums whose display names live in a marko-written English UI block. **DUPLICATE / LEGACY.**
* `imgui_layer.cpp:201` — `GIGA_NO_CRT`, cached `static const bool`. Added by `marko1olo` (`95f72487`, "Spec 04 §3.2"). Live but a spec-shaped toggle; the CRT toggle also exists as a proper user setting (`renderer.crtEnabled`, `settings_ui.cpp:83`), so **two toggles for one feature**.
* `imgui_layer.cpp` history: marko added a "rare CRT tracking-roll glitch" (`e7dccb51`, `39c10f40`) which the owner **reverted** (`25b70199`). 4 of 10 commits on this file are marko's.

---

# 4. PROPS / ANTOURAGE / CONTAINER OVERLAP — the key question

## 4.0 Two measured defects found while counting

### **4.0.1 Every container on every floor is destroyed the instant it is spawned.**

*Independently re-verified by me today, line by line.*

`Container` entities borrow the prop system's physics by taking its anchor component:
```
src/game/container.cpp:356   // Connect to physical prop system for gravity/destruction
src/game/container.cpp:357   reg.emplace<SubVoxelAnchor>(e, SubVoxelAnchor{cx, cy, cz, 4, 4, 0, 0});
src/game/container.cpp:358   reg.emplace<PropFallMode>(e, PropFallMode::SimpleFall);
```
But `clear_layer_props` uses **`SubVoxelAnchor` as the definition of "is a static prop"**, and its comment asserts an exclusivity that stopped being true the day containers took the component:
```
src/game/prop_system.cpp:328  // SubVoxelAnchor marks every static prop (terminals, shields, padic bulbs).
src/game/prop_system.cpp:331  auto view = reg.view<const SubVoxelAnchor, const Transform>();
src/game/prop_system.cpp:336  for (Entity e : old_) reg.destroy(e);
```
`refresh_floor_props` calls `clear_layer_props` on entry (`src/app/main.cpp:1072`), and containers are refreshed **first** at all four floor-build sites:

| site | containers | props |
|---|---|---|
| initial spawn | `main.cpp:1967` | `main.cpp:1968` |
| elevator ride | `main.cpp:2602` | `main.cpp:2603` |
| save load | `main.cpp:4795` | `main.cpp:4808` |
| fast travel | `main.cpp:7122` | `main.cpp:7124` |

**Measured** with a probe linked against the real `libgiga_game.a` (floor −3 Residential, `main.cpp`'s own seed):
```
spawned=38  containers_before=38  clear_layer_props_destroyed=38  containers_after=0
```
**38 of 38.** Consequences: the player's crate scan (`main.cpp:4108-4123`) finds nothing; `apply_container_records` (`save.cpp:855`) has nothing to stamp; the whole `ContainerRecord` save-v15 machinery persists an empty set. Introduced 2026-08-01 across a seam: `5b1d444e Jirnyak` added the anchor, `adbcffd8 marko1olo` added `clear_layer_props` the same day. Someone already smelled the symptom — `main.cpp:2514` carries the comment *"refresh_floor_containers destroys every crate on the arrival slot"*.

Class: **DEAD-DATA by construction.** This is the single highest-value finding in the whole audit.

### **4.0.2 Beds, toilets, stoves and tables are door-lock terminals.**

`data/props.csv` rows 7-10 author `kitchen_stove`, `kitchen_table`, `toilet_pan`, `bed_cot` with **`interact=Terminal`** (I read the CSV directly). `spawn_prop_from_id` emplaces that kind unconditionally (`prop_system.cpp:287` → `:258`). Downstream:
* `main.cpp:6420-6425` → prompt **"TERMINAL (DOOR LOCKS)"** on a bed;
* `main.cpp:4176-4183` → E on a toilet calls `embody_interact_terminal` → `embody.cpp:153` `door_toggle_locks(...)` — **toggles every lock on the floor**;
* `main.cpp:6028-6032` → standing at a stove makes `CraftStation::NetTerminal` true for repair.

**Measured**, floor −3 Residential:
```
interactable Terminal=1035  Shield=325  LightBulb=93  Corpse=0  Loot=0  Npc=0
wall_devices=517  ceiling_lights=93  furniture=843
```
**843 of 1035 `Terminal` interactables are furniture; 192 are real terminals.** Meanwhile an actual crate has no `[E]` prompt at all. Fix is a **4-cell CSV edit**.

Class: **DEAD-DATA / MAGIC** — a data-entry default that became gameplay.

## 4.1 How many systems represent "an object in the world"? — **9**

| # | System | Storage | Id space | Source data | Rendered by | Destructible | Interactable | Struct |
|---|---|---|---|---|---|---|---|---|
| 1 | **ECS prop** | EnTT: `Transform`+`SubVoxelAnchor`+`PropMesh`+`PropFallMode`+`Renderable`+`StaticPropTag`+`Mass`(+`PropLight`) | `PropId` u16 | `data/props.csv` (9 rows) | `PropPass` (`main.cpp:1303`) | YES `anchor_validate_step` | YES `Interactable` | `prop_system.h:25,53` |
| 2 | **Interactable** | EnTT component | `InteractKind` u8 | `data/interactables.csv` (6 rows) | — | — | *is* the seam | `prop_system.h:34` |
| 3 | **Container** | hand-built entity `container.cpp:347-361` | `ContainerKind` u8, **hardcoded** `container.cpp:32-39` | items.csv contents | `BodyPass` | borrows #1's anchor → **and is deleted by it** | hand-rolled scan `main.cpp:4108`, **no `Interactable`** | `container.h:75` |
| 4 | **AntourageInstance** | flat vector per floor in `AntourageBake` | **none** (array index) | **hardcoded generators**, no CSV | `PropPass` — *same list as #1* (`main.cpp:1348`) | YES `antourage_carve_step` (2nd impl) | NO | `antourage.h:125` |
| 5 | **WireChain** | vector in bake | none | hardcoded | `wire_pass` | YES `wire_live_pins` | NO | `antourage.h:47` |
| 6 | **ClothSheet** | vector in bake | none | hardcoded | `cloth_pass` | YES `cloth_live_pins` | NO | `antourage.h:88` |
| 7 | **DetachedPiece** | render-side vector | none | — | `PropPass` (`main.cpp:1356`) | *is* the debris | NO | `antourage.h:246` |
| 8 | **Corpse** | EnTT component | mobKind u8 | mobs.csv + loot_table | `BodyPass` | no | YES `Kind::Corpse` | `combat.h:192` |
| 9 | **Pickup** | EnTT component | `ItemId` u16 | items.csv | `BodyPass` | no | carries `Kind::Loot` **never queried**; swept by `pickup_step` (`loot.cpp:370`) | `loot.h:77` |
| (10) | **Door** | `DoorSet` vector + dense 128³ index; **writes voxels** | door id u32 | floor_spec | voxel raymarch (*is* geometry) | own hp/chip model | own `door_query_near` + **hardcoded prompt literals** `main.cpp:6410-6414` | `door.h:123,154` |

### The duplication, quantified

| Axis | Count | Sites |
|---|---|---|
| Draw paths for "a box in a room" | **3** | `PropPass` (#1,#4,#7) · `BodyPass` (#3,#8,#9) · voxel pass (#10). A `Container` and a `KitchenTable` are the same silhouette on two pipelines with two colour sources. |
| Carve-response implementations, same `dirtyCells` input | **2** | `anchor_validate_step` (`prop_system.cpp:181`) and `antourage_carve_step` (`antourage.h:279`) — called back-to-back at `main.cpp:4053+4062`, `4407+4415`, `6747+6754`. `antourage.h:264` calls them "twins". |
| "What is near me" implementations | **4** | `find_nearest_interactable` (`prop_system.cpp:539`) · container scan (`main.cpp:4108`) · `door_query_near` (`main.cpp:6398`) · `pickup_step` radius (`loot.cpp:370`) |
| Anchor / aliveness models | **3** | `SubVoxelAnchor` sub-voxel probe · antourage's `ax0..az1` cell-pair probe · none |
| Fall / debris models | **2** | `PropFallMode`+`physics_step` vs `FallClock`+`DetachedPiece`+`antourage_detach_step` |
| Spellings of "reach" | **6** | `interact_table.h` reachM · `props.csv reach_mm` · `kPickupReach` (`loot.h:90`) · `kContainerReach` · `3.5f` literal (`main.cpp:4203`) · `3.0f` literal (`prop_system.cpp:582`) |

## 4.2 Id spaces — `props.csv:interact` vs `interactables.csv`

**`props.csv:interact` IS `interactables.csv:cpp_name`** — resolved at generation time, with a hard error on an unknown name:
```
tools/gen_prop_table.py:42-51   m = {r["cpp_name"].strip(): i for i, r in enumerate(rows)}; m["None"] = 255
tools/gen_prop_table.py:119-122 if interact not in INTERACTS: die(...)
tools/gen_prop_table.py:173     → PropDef.interactKind
tools/gen_interact_table.py:35  names = [r["cpp_name"].strip() ...] → enum class InteractKind
```
That seam is **correct** and should survive any merge.

**The trap:** `PropId` and `InteractKind` ordinals *coincidentally align* for rows 0-1 and diverge at row 2 — I verified both generated enums:
```
prop_table.h:20-30      Terminal=0, ElectricalShield=1, BareBulb=2, FloodLamp=3, ...
interact_table.h:19-27  Terminal=0, ElectricalShield=1, LightBulb=2, Corpse=3, Loot=4, Npc=5
```
Two independent append-only ABIs that look like one.

**And the `None` escape hatch is broken** (`prop_system.cpp:36-42`, re-read by me today):
```cpp
// Out-of-range (255 = "None" and any stale byte) clamps to row 0's
// behaviourless default at the call sites that check `interact != 255`.
return v < kInteractCount ? static_cast<Interactable::Kind>(v)
                          : Interactable::Kind::Loot;
```
The comment is **false twice**: it returns `Loot` (row 4), not row 0; and **no call site checks `!= 255`** — `spawn_prop_from_id:287` passes it straight into `spawn_prop`, which emplaces `Interactable` unconditionally (`:258`). A prop authored `interact=None` becomes **pickupable loot**. `SPEC-LIE` inside the code.

## 4.3 Is antourage an appendix? — **NO. It is one of the best-wired systems in the repo.**

| Hook | Evidence |
|---|---|
| Bake at floor load (not per tick) | `floor_stream.cpp:334-336` |
| Carve — console/blast | `main.cpp:4062` |
| Carve — combat | `main.cpp:4414` |
| Carve — doors | `main.cpp:6754` |
| Detach integration, per frame | `main.cpp:6769` |
| Wire/cloth pin probe + FallClock, per frame | `main.cpp:6889-6899`, `6920-6929` |
| Render — rigid | `PropPass` `main.cpp:1349` |
| Render — falling | `main.cpp:1356-1367` |
| Render — wires / cloth | `wire_pass` + `shaders/wire_sim.comp`; `cloth_pass` + `cloth_sim.comp` |
| Severed pipe → drip emitter | `main.cpp:1331-1333`, consumed `:4425-4440` (`simTick % 50` = 0.4 s @ 125 Hz) |
| HUD counters | `main.cpp:5196-5202` |

Live proof from a `build/game_test` run today: `[antourage] carve severed 1 piece(s)`, `[antourage] pipe fell 4.86 m and rested`, `0.6 m carve at the pin: cell still solid, pins 81 -> 80`.

**Authorship: 21/21 commits `Jirnyak`. Zero marko, zero Петушков.** Untouched for 11 days.

### Antourage's real (small) defects

| # | Finding | Class | Evidence |
|---|---|---|---|
| A1 | `FloorStreamer::antourage_at` — **zero callers repo-wide** (everything uses the `_at_layer` twin) | DEAD | `floor_stream.h:289`, `floor_stream.cpp:461-466` |
| A2 | **`dressingSetChanged` → `upload_wires`/`upload_cloths` on carve is a provable no-op that destroys state.** `antourage_carve_step` takes the bake `const` and never mutates it, so the re-packed bytes are identical *except* `prev[i]=cur[i]=rest pose` — every wire and sheet on the floor snaps to rest with zero velocity. `main.cpp:2652-2661` diagnoses this exact bug ("one shot at a wall froze all the dressing for eight seconds") and fixes only the per-frame half. Pins are already published per frame by `write_pins`. | DISABLED/BUG | `main.cpp:4065`, `6757` → `6781-6784`; packers `main.cpp:1136-1189` esp. `1146-1148`, `1176-1178` |
| A3 | Carve call-site asymmetry: `main.cpp:4414-4416` (combat) sets only `propPassNeedsRebuild`; `4062` and `6754` also set `dressingSetChanged`. Same event class, three sites, two behaviours. | DUPLICATE | as cited |
| A4 | **Three dead `AntourageInstance` fields** — the bake never writes `color`, `emissive` or `yaw`. So `main.cpp:1342-1343` `ownColor` is **always false** (dead branch at `:1345`), `pi.emissive` is always 0 outside debug, `pi.yaw` is always 0. | DEAD-DATA | `antourage.h:129`; only `yaw` writes in the .cpp are `DetachedPiece::yaw` at `:738,760,890` |
| A5 | **Undocumented silent abort:** `if (nodes.size() < 64) return;` — a floor with sparse geometry gets **zero pipes and no diagnostic**. 64 derived from nothing. | MAGIC-CONST | `antourage.cpp:290` |
| A6 | Comment cites `emit_leg()`, which **does not exist** (deleted in the network rewrite) | SPEC-LIE | `antourage.cpp:52`; `grep -rn emit_leg src tests` → that line only |
| A7 | `WireChain` `pinMask = 0x01` "strip curtain that swings free" documented — **no module ever sets it** | DEAD-DATA | `antourage.h:56-60`; `bake_wires` `antourage.cpp:582-611` leaves the `0x81` default |
| A8 | `AntourageBake::pipeCells` written by the bake, **read only by tests** | DEAD-DATA | `antourage.h:152`, written `:390`, read `suite_antourage.inl:41,667,726` |
| A9 | ~14 named constants + ~16 inline float literals with **no derivation**. Worst: `kPipeOutlets = 700` (`antourage.cpp:156`, **no comment at all**), `kPipeRadius = 0.30f` (= a 0.6 m diameter pipe, no DN spec), `kAntourageFallSec = 8.0f`, `kWireTriesPerRoomish` (**lying name** — it is per-floor). | MAGIC-CONST | table in the antourage pass |

**Credit where due:** `kPipeBranchCells = 8` (`:158-164`) ships a measured table (cap 22→259 branch points, 10→392, 6→450); `kBendCost=3` vs `kStraightCost=1` (`:292-301`) is reasoned from a zero-g measurement; `kWireKgPerMetre = 0.35f` (`:534`) names a physical object ("~1.2 cm copper-cored cable: mass from length, not authored"). This is the derivation standard the audio subsystem fails.

## 4.4 Prop-system dead API

| Symbol | Declared | `src/` callers | Verdict |
|---|---|---|---|
| `check_projectile_prop_hits` | `prop_system.h:174` | **0** | DEAD |
| `collect_interactable_positions` | `prop_system.h:163` | **0** (tests only) | DEAD |
| `interaction_step` | `prop_system.h:200` | **0** | DEAD |
| `prop_interact_step` | `prop_system.h:207` | **0** | DEAD |
| `spawn_prop` (public) | `prop_system.h:124` | 0 (tests only) — everything real goes through `spawn_prop_from_id`, contradicting `props.md`'s "единственный способ" | DEAD-PUBLIC |
| `loot_containers_step` | `container.h:128` | **0** (tests only) | DEAD (70 LOC) — §0.5 |
| `prop_name` / `kPropNames` / `kPropIds` / `prop_id_str` / `prop_id_by_string` | `prop_table.cpp:29,41` | **0** | DEAD-DATA |

Plus:
* `interaction_step` hardcodes `const float reach = ... ? 3.0f : 0.0f` and `(void)bus;` (`prop_system.cpp:576-586`) — shadowing both reach tables. Dead anyway.
* **`RagdollRoll`'s spin is integrated but never drawn.** `physics.cpp:339-342` integrates `Rotation`; `physics.cpp:287` admits *"BodyPass is still axis-aligned; Rotation/AngularVelocity are sim state for … future draw"*. `grep Rotation src/render/ main.cpp` → **zero**. And a detached prop is given `AABB{0.2,0.2,0.2}` (`prop_system.cpp:130`), so it draws as a 0.4 m cube regardless of its authored `size_*_m`.
* **Lying comments about a purged system:** `main.cpp:1090, 1127, 1129` still describe `gpu::PropPlacer` filling cosmetics and "reserving slots"; the class no longer exists (`prop_system.cpp:15` calls it "the purged gpu::PropPlacer").
* Container colours are now single-valued: `kOpenColour` (`container.cpp:25`) is only set inside the dead `loot_containers_step`; the live path (`main.cpp:5847`) sets `opened = true` but never recolours — a fact `save.h:659` already documents as unreachable.

## 4.5 Prop-system magic constants

`kLightChancePct = 25u` (`:22`, says what, never why); `0.35f` burst speed (`:97`); `6` particles (`:99`); **`AngularVelocity{vec3{impulse.z, impulse.x, 2.0f}}` (`:116`) — an axis-letter permutation plus a bare 2.0 rad/s on Z, an isotropy violation in a file whose other branches derive `up` from `world.gravity()`**; `-0.5f` shove (`:124`); `AABB{0.2,0.2,0.2}` (`:130`); **`normalize(projVel)*3.0f + vec3{0,0,1}` (`:173`) — a hardcoded +Z directly contradicting the file's own `:92-94` "never assume -Z"**; `2.5f` reach (`:258`); `0.02f` flush gap (`:393`); `-0.14f` bulb drop (`:466`); `kAirDamp=1.5f` (`:594`); `kGroundMul=0.85f` (`:595`, tick-rate dependent); `kRestW2=1e-4f` (`:596`); `Entity settled[64]` (`:598`).

Derived and fine: `kSaltWall`/`kSaltLight` (documented as inherited to preserve historical placement), `0x9E3779B9`, and `:369-376` (`wsel<7`/`<11` of `%2000` with an explicit ≈0.35%/0.2% derivation).

## 4.6 Props/antourage authorship

| File | Commits | marko1olo | Verdict |
|---|---|---|---|
| `src/game/prop_system.cpp` | 25 | **13**, incl. both originating commits `322b49e8`/`069ee505` (2026-08-01, *"Schwab C++ mandate"*) and 5 "Overseer auto-push sweep" chores | **CREATED & DOMINATED BY marko1olo**; Jirnyak's 12 are all later repairs (Z-hardcodes, hash consolidation, lying comments) |
| `src/game/prop_system.h` | 18 | **12**, originating `322b49e8` | **CREATED BY marko1olo** |
| `src/render/prop_pass.cpp` | 8 | **5**, originating `50b8725d`, plus `2958dc45` *"25 shapes total"* (the 29-shape zoo the purge later killed) | **CREATED BY marko1olo** |
| `src/render/prop_mesh.cpp` | 7 | **4**, originating `50b8725d` | **CREATED BY marko1olo** |
| `src/game/container.cpp` | 11 | **5**, originating `34399e4a` | **CREATED BY marko1olo** |
| `data/props.csv` | 7 | 1 (`52947b3b` sweep) | Jirnyak-dominated |
| `data/interactables.csv` | 2 | **0** | **clean** |
| `tools/gen_prop_table.py` | 6 | 1 (sweep) | Jirnyak-dominated |
| `tools/gen_interact_table.py` | 1 | **0** | **clean** |
| `src/game/antourage/*` | 21 | **0** | **clean** |

**Pattern: every hand-written C++ file in the props/container cluster was created by `marko1olo`; both CSV + generator pairs — the parts that actually work — are Jirnyak's.** The container-wipe defect sits exactly on the seam between a Jirnyak commit (`5b1d444e`, the anchor) and a marko auto-sweep (`adbcffd8`, `clear_layer_props`) landed the same day.

---

# 5. DATA LIVENESS

## 5.1 `data/particles.csv` — 5 rows, 14 columns · **CLEANEST TABLE IN SCOPE**

| Column | Parsed | Emitted | Consumed | Verdict |
|---|---|---|---|---|
| `id` | `gen_particle_table.py:88` | `ParticleDef::id` | **never read** | EMITTED-BUT-UNREAD (debug affordance) |
| `cpp_name` | `:36` | `enum ParticleKind` | yes, all 5 | **LIVE** |
| `color_mode` | `:40,89` | `colorFromMaterial` | `main.cpp:1240` | **LIVE** |
| `color_r/g/b` | `:90-91` | `r,g,b` | `main.cpp:1240-1242` | **LIVE** |
| `emissive` | `:91` | `emissive` | `main.cpp:1224` | **LIVE** |
| `gravity_mul` | `:92` | `gravityMul` | `main.cpp:1223` | **LIVE** |
| `drag` | `:92` | `drag` | `main.cpp:1223` | **LIVE** |
| `bounce` | `:93` | `bounce` | `main.cpp:1223` | **LIVE** |
| `size_m` | `:93` | `sizeM` | `main.cpp:1222` | **LIVE** |
| `life_s` | `:94` | `lifeS` | `main.cpp:1216` | **LIVE** |
| `speed_mps` | `:94` | `speedMps` | `main.cpp:1219-1221` | **LIVE** |
| `comment` | read by `DictReader`, **not emitted** | — | — | DOC-ONLY (fine) |

| Row | Spawned at | Verdict |
|---|---|---|
| `dust` | `antourage.cpp:922`, `main.cpp:1268` | **LIVE** |
| `debris` | `prop_system.cpp:99`, `combat.cpp:1888`, `antourage.cpp:875,909`, `main.cpp:1278` | **LIVE** |
| `blood` | `combat.cpp:425` | **LIVE** |
| `spark` | `combat.cpp:1705,1886,1943`, `main.cpp:4452` | **LIVE** |
| `drip` | `main.cpp:4430` | **LIVE** |

**Verdict: 5/5 rows live, 12/14 columns live, 1 doc-only, 1 emitted-unread.** This is the model the other tables should be measured against — and it is Jirnyak's (`07b47a84`).

## 5.2 `data/sounds.csv` — **0 rows.** See §1.2.

## 5.3 `data/props.csv` — 9 rows × 19 columns

### Columns: **16 LIVE, 3 EMITTED-BUT-UNREAD, 0 UNPARSED**

| Column | Parsed | Emitted | Read at | VERDICT |
|---|---|---|---|---|
| `id` | `gen_prop_table.py:105` | `PropId` enum **+** `kPropIds` array | enum: everywhere (`prop_system.cpp:372,374,479`). `kPropIds`/`prop_id_str`/`prop_id_by_string`: **0 callers** | **LIVE** (enum) / dead string array |
| `name` | `:111` | `kPropNames` (`prop_table.cpp:29`) | **nothing** — `prop_name()` has 0 callers repo-wide | **EMITTED-BUT-UNREAD** |
| `shape` | `:124` | `PropDef::shape` | `prop_system.cpp:289` → `main.cpp:1305,1315` → `PropPass` | **LIVE** |
| `fall_mode` | `:115-118` | `fallMode` | `prop_system.cpp:288` | **LIVE** |
| `interact` | `:119-122` | `interactKind` | `prop_system.cpp:287` | **LIVE** |
| `emissive` | `:125` | `emissive` | `prop_system.cpp:290` → `main.cpp:1320` → `prop.vert:14,71` → `prop.frag:270` | **LIVE** |
| `mat_id` | `:126` | `matId` | `prop_system.cpp:290`, `:89-90` (debris tint) | **LIVE** |
| `color_r/g/b_e3` | `:127-129` | `colorRE3/GE3/BE3` | `prop_color()` `prop_table.h:121` ← `prop_system.cpp:289,308` | **LIVE** |
| `reach_mm` | `:130` | `reachMm` → `Interactable::reachM` (`prop_system.cpp:303`) | **never read by any consumer.** `find_nearest_interactable` (`:551-572`) reads only `ia.active`/`ia.kind`; reach comes from the *caller* via `interact_def(kind).reachM` — **the other CSV**. Only reader: `tests/suite_props_game.inl:588` | **EMITTED-BUT-UNREAD** |
| `mass_g` | `:150-166` | `massG` | `prop_system.cpp:294` → `Mass` → impact law | **LIVE** |
| `size_x_m` | `:154` | `sizeXMm` | `:297` → `PropMesh.scale` → `prop.vert:54` | **LIVE** |
| `size_y_m` | `:154` | `sizeYMm` | `:298`, `:379` (flush-mount thickness) | **LIVE** |
| `size_z_m` | `:154` | `sizeZMm` | `:299`, `:311`, `room_zone.cpp:504` | **LIVE** |
| `light_radius_mm` | `:131` | `lightRadiusMm` | `:309` → `main.cpp:336` `grid.add_light` | **LIVE** |
| `light_intensity_e3` | `:132` | `lightIntensityE3` | `:310` → `main.cpp:333,336` | **LIVE** |
| `light_cone_deg` | `:133` | `lightConeDeg` | copied to `PropLight::coneDeg` (`:312`) and **never used** — `main.cpp:336` calls the 4-arg `add_light`; the cone overload (`gpu_light_grid.h:90`) is used only by the flashlight (`main.cpp:390`) | **EMITTED-BUT-UNREAD** |
| `flicker` | `:134-137` | `flickerProfile` | `:313` (light) **and** `:319` (packed into `PropMesh.flags` bits 0-2) → `prop.frag:270` `vFlags & 7u` | **LIVE** |

### Rows: **9/9 SPAWNED**

`terminal` `prop_system.cpp:374→412` · `electrical_shield` `:372→412` · `bare_bulb`/`flood_lamp` `:479→484` · `padic_stair_bulb` `floors/padic/padic_module.cpp:79-81` · `kitchen_stove`/`kitchen_table`/`toilet_pan`/`bed_cot` `room_zone.h:320-328 → room_zone.cpp:522`.

Measured on floor −3: 517 wall devices, 93 ceiling lights, 843 furniture, 285 `PropLight`.

## 5.4 `data/interactables.csv` — 6 rows × 5 columns

### Columns

| Column | Parsed | Emitted | Read | VERDICT |
|---|---|---|---|---|
| `id` | `gen_interact_table.py:77` | `InteractDef::id` (`interact_table.h:32`) | **0 readers repo-wide** | **EMITTED-BUT-UNREAD** |
| `cpp_name` | `:35` | `enum class InteractKind` (`:60-61`) | everywhere | **LIVE** |
| `prompt` | `:77` | `InteractDef::prompt` | **on screen** at `main.cpp:6424` (Terminal), `:6441` (Shield), `:6460/6463` (Corpse), via `set_prompt` (`:6391-6395`) → `##interact_prompt` window (`:6514`) | **LIVE for 3 of 6 rows** |
| `reach_m` | `:78` | `reachM` | `main.cpp:4085,4152,4178,4875,6032,6091,6194,6422,6433,6453`; `embody.cpp:74` — **but `main.cpp:4203` hardcodes `3.5f`** instead of `interact_def(ElectricalShield).reachM`, a duplicated literal of the CSV value | **LIVE** (one bypass) |
| `note` | **never touched by the generator** (`gen_interact_table.py` reads only `cpp_name`/`id`/`prompt`/`reach_m`) | — | — | **UNPARSED** (doc-only) |

### Rows

| Row | Attached at | Queried by kind | VERDICT |
|---|---|---|---|
| `terminal` | props.csv ×5 (1 real + 4 furniture) | `main.cpp:4176, 6031, 6089, 6420` | **LIVE** — but 82% of instances are furniture (§4.0.2) |
| `electrical_shield` | props.csv row 3 | `main.cpp:4202, 6430` | **LIVE** |
| `light_bulb` | props.csv rows 4,5,6 | **nothing** — `grep "Kind::LightBulb"` → 0 query sites; the light gate (`main.cpp:308-312`) reads `Interactable::active`, not the kind | **ATTACHED-BUT-NEVER-QUERIED**; prompt "LIGHT BULB" never displayed; reach 2.5 never read |
| `corpse` | `combat.cpp:645`, `save.cpp:919` | `main.cpp:4084, 6452` | **LIVE** |
| `loot` | `loot.cpp:251,310`, `main.cpp:6011` | **nothing** — `pickup_step` scans `reg.view<const Pickup, const Transform>()` directly (`loot.cpp:370`) | **ATTACHED-BUT-NEVER-QUERIED**; prompt "PICK UP" never shown; `kPickupReach=1.8` (`loot.h:90`) is the live constant instead of the CSV's 2.0 |
| `npc` | `embody.cpp:73` | `main.cpp:4151, 6194` (reach only) | **LIVE for reach**; prompt "BARTER / TRADE" **never displayed** |

**3 of 6 prompts reach the screen. 2 of 6 rows are attached but never queried.**

---

# 6. DEAD / DISABLED / MAGIC (in-scope summary)

* `#if 0` / `if (false)` / `if (0)`: **zero occurrences repo-wide** (`grep -rn "#if 0\|if (false)\|if(false)\|if (0)" src/`). Clean.
* Env toggles in scope: `GIGA_NO_CRT` (`imgui_layer.cpp:201`) — duplicate of a real setting; `GIGA_ANTOURAGE_DEBUG` (`main.cpp:1077,1323`); `GIGA_PARTICLE_DBG` (`:4447`); `GIGA_PARTICLE_NOSIM` (`:6791`); `GIGA_CARVE_DBG` (`:4358`); `GIGA_WIRE_DBG` (`:1154,1184`); `GIGA_WIRE_NOSIM` (`:6790`); `GIGA_NO_GPU_CULL` (`:6789`); `GIGA_LIGHT_DBG` (`:403`); `GIGA_GPU_TIMER` (`gpu_timer.cpp:42`); `GIGA_TEXTURE_DIR` (`cube_pass.cpp:33`). Eleven env vars — none disable a *feature*, all are debug affordances. Acceptable, but there is no single place listing them.
* Hardcoded 0 multipliers / frozen inputs: `radDose = 0.0f` (`audio_system.cpp:150`), `hudBrightness = 1.0f` (`main.cpp:7036`), `gridIntensity` never set (`synth_ambient.cpp:16`). Three dead knobs.
* Dead params: `bus`, `doors` in `AudioSystem::update` (`audio_system.cpp:136-140`).
* Dead include: `src/game/faction_relations.cpp:13` includes `game/noise.h` "NoiseProfile, NoiseSource, noise_publish" — **none of the three is used in that file** (`grep -n Noise src/game/faction_relations.cpp` → only the include line).
* Magic constants: §1.6 (audio, ~25), §3.1/§3.6 (UI window sizes + intro, ~25).

---

# 7. AUTHORSHIP

| File / region | Jirnyak | marko1olo | Note |
|---|---|---|---|
| `src/audio/*` (all 16 files) + `audio.md` + `data/sounds.csv` + `suite_audio.inl` | 100% (1 commit `10e0ce2b`) | — | fork port, landed whole |
| `src/app/hud_ui.cpp` | 100% (`f65f871e`) | — | clean |
| `src/app/settings_ui.cpp` | 100% (`9f6e5270`) | — | clean |
| `src/app/ui_shell.h` | 100% | — | clean |
| `src/render/inventory_ui.cpp` | 100% (5 commits) | — | clean |
| `src/render/conversation_ui.cpp` | 100% (4 commits) | — | clean |
| `src/render/intro_ui.cpp` | 100% (3 commits) | — | clean |
| `src/game/keybind.cpp` | 7 of 8 commits | 1 (`56053f41`) | fine |
| `src/render/imgui_layer.cpp` | 6 of 10 commits | **4** (incl. the CRT overlay itself `f0a35997`, `GIGA_NO_CRT` `95f72487`, and a glitch effect the owner reverted) | mixed |
| `src/app/main.cpp` **whole file** | 4169 lines | **3097 lines** | 43% marko |
| — Crafting window `440-622` | 1 | **182** | **99.5% marko** |
| — Debug tree `5109-5677` | 158 | **411** | **72% marko** |
| — Console window `693-860` | 112 | 56 | mixed |
| — Elevator window `6127-6182` | 56 | 0 | clean |
| `data/particles.csv`, `tools/gen_particle_table.py`, `src/render/particle_pass.cpp` | 100% | — | clean |

**Flag:** the two largest UI blobs in the tree (the 183-LOC Craft window and the 569-LOC debug tree, 752 LOC combined, both inside `main.cpp`) are marko-dominated, English-language, and outside the CRT mandate. Everything the owner built himself in the last three days (`hud_ui`, `settings_ui`, `inventory_ui`, `conversation_ui`, `ui_shell`) is table-driven, Russian, on-palette and duplication-free.

---

# 8. DOC-VS-CODE

## 8.1 `hud.md` (5.4 KB) — 8 checks

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `:8-9` code at `src/app/hud_ui.h/.cpp`, "таблица элементов + слоты-углы" | **TRUE** | `hud_ui.cpp:183-191` |
| 2 | `:13-14` "Тумблеры элементов **ждут** Settings → Interface" | **FALSE (stale)** | built: `settings_ui.cpp:69-76` `tab_interface` iterates `hud_elements()` |
| 3 | `:38-46` table of 7 elements (crosshair/health/needs/hands/status/psi/alerts) | **TRUE** — all 7 present, same ids | `hud_ui.cpp:184-190` |
| 4 | `:17-24` "худ читает флажок игрока, а не «игрока»" | **TRUE** | `live_ref()` re-resolves `NpcRef` every element, every frame (`hud_ui.cpp:31-36`) |
| 5 | `:26-31` "Ни одного write из худа" | **TRUE** — enforced by type: `HudContext` members are `const` pointers except `reg`/`pool` | `hud_ui.h:43-51`; `draw` signature `void(const HudContext&)` (`:61`) |
| 6 | `:54` "CRT-мандат уже в коде [imgui_layer.cpp:36-60]" | **TRUE** — the cited line range is exactly the mandate comment + style block | `imgui_layer.cpp:36-63` |
| 7 | `:12-13` "Отладочное дерево осталось дев-инструментом в main.cpp: F1 / `hud`, по умолчанию СКРЫТО" | **TRUE** | `main.cpp:5104-5109`, `keybind.cpp:106` |
| 8 | `:14-15` "лента одноразовых событий (`alerts`) пока сирена+истощение" | **TRUE** | `hud_ui.cpp:154-179` — exactly two sources |

**1 false of 8** — and it is a stale "not yet built" that *is* built. Best doc in scope.

## 8.2 `menu.md` (5.4 KB) — 8 checks

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `:3` "Каркас уже существует ([src/app/main.cpp] `menuScreenPage`, `menu_start_playing`)" | **FALSE** | `menuScreenPage` exists nowhere in `src/` except a *historical* comment at `ui_shell.h:4` describing it as the thing that was deleted |
| 2 | `:14-16` "ПОСТРОЕНО … настройки — ОДНО окно вкладок из главного меню И из паузы, один код — два входа" | **TRUE** | `main.cpp:6651` and `:6700` both call `draw_settings_page` → `settings_ui_draw` |
| 3 | `:42` table row "Settings … статус: **зачаток**" | **FALSE** — contradicts `:14-16` of the same document | `settings_ui.cpp:116-121` — 4 live tabs |
| 4 | `:58` "Audio: **заглушка** до появления звука; пустая вкладка честнее фальшивой" | **FALSE** | `settings_ui.cpp:92-106` — 3 live sliders writing `AudioConfig` |
| 5 | `:57` "Video: разрешение/фуллскрин/vsync" | **PARTLY FALSE** | `settings_ui.cpp:81-87` has CRT + fullscreen only; no resolution, no vsync |
| 6 | `:29-30` Pause pages "Resume / Settings / Save / **Quit-to-Menu**" | **FALSE** | `main.cpp:6696` runs `quit`, whose help string is "**quit to desktop**" (`console.cpp:319`); there is no quit-to-menu path |
| 7 | `:6-7` "чтобы добавки были строками, а не переписыванием" | **HALF-TRUE** | pause IS row-driven (`main.cpp:6683-6693`); the main menu is a hardcoded `if/else if` chain (`:6595-6656`) |
| 8 | `:39` Main page "Continue (последний слот) … есть (**без Continue**)" | **TRUE** | `main.cpp:6599-6602` — New/Load/Settings/Quit only |

**5 false / 1 half of 8.** `menu.md` is the least trustworthy doc in scope, and its own §Статус contradicts its own §Страницы table.

## 8.3 `inventory.md` (7 KB) — 8 checks

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `:3` "8×8 POD-прямоугольник" | **TRUE** | `inventory.h:13,15` `kInvCols=8`, `kInvSlots=64` |
| 2 | `:6-7` "ОДИН клеточный виджет … три РЕЖИМА одного окна с разной политикой" | **TRUE** | `inventory_ui.cpp:212-217` one entry point, `InvUiPolicy` + optional `InvUiSide` |
| 3 | `:11` "торговые правила — [src/game/vendor.h]" | **STALE** | `vendor.h` still exists (59 LOC) but the barter path goes through `barter.cpp`, which uses `vendor.h` only for `kBuyMult/kSellMult/vendor_kind_for` (`barter.cpp:3,92`); `vendor.cpp` is 16 LOC. The "Vendor window" is gone (`ui_shell.h:40-41`). |
| 4 | `:20` "Торговля тем же экраном — **СЛЕДУЮЩАЯ** (инкремент B)" | **FALSE (stale)** | built: deal mode is live (`inventory_ui.cpp:299-317, 345-357`, `main.cpp:6362`) |
| 5 | `:32` "состояние (**когда появится** `condition` — полоска износа)" | **FALSE (stale)** | built: `inventory_ui.cpp:179-184` draws it |
| 6 | `:40-46` action table (equip / unequip / use / drop / give) | **TRUE** — all five present | `inventory_ui.cpp:371-408` |
| 7 | `:48-50` "Меню НЕ владеет данными … все мутации идут через примитивы" | **TRUE** — the widget returns `InvUiRequest`, mutates nothing | `inventory_ui.h` `InvUiRequest`, `inventory_ui.cpp:212,435` |
| 8 | `:81` "их сумки трогает только их ИИ ([ai.h] `ai_equip_step`)" | **TRUE** | `ai.cpp:1256`, called `main.cpp:3182` |

**2 false (both stale "not yet"), 1 stale reference, of 8.**

## 8.4 `loadout.md` (3.2 KB) — design doc, nothing to falsify

Explicitly a **plan** ("дизайн владельца", "Строится … вместе с эпиком биндов #17"). Its one factual claim — `:4-5` "Сегодняшние `Equipped.weapon/tool/armor` … частный случай" — is **TRUE** (`equip.h`, used at `inventory_ui.cpp:187, 368-370`). Not a spec-lie; correctly labelled as unbuilt.

## 8.5 `audio.md` — see §1.7 (2 false / 1 half of 8).

## 8.6 `props.md` (9.8 KB) — 10 checks

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `:2-4` "Каталог — `props.csv` → `gen_prop_table.py` → `prop_table.h/.cpp`" | **TRUE** | `gen_prop_table.py:27-29`; `prop_table.h:1-2` |
| 2 | `:25` "`spawn_prop_from_id()` — **единственный способ** поставить проп" | **FALSE** | `spawn_prop` is public (`prop_system.h:124`) and used at `suite_props_game.inl:277,335,734`; and `container.cpp:347-361` builds a prop-shaped entity **by hand** with `SubVoxelAnchor`+`PropFallMode`, calling neither |
| 3 | `:48` "786 предметов на жилом этаже" | **FALSE / stale** | measured **843** on floor −3 Residential |
| 4 | `:86` "`PropPass` — пассивная шкура над `reg.view<Transform, PropMesh, StaticPropTag>()`" | **TRUE** | `prop_system.cpp:516` — exactly that view |
| 5 | `:87-88` "до 4096 инстансов на форму, GPU-куллинг через `cull.comp`" | **TRUE (conditional)** | `prop_pass.h:28` `kMaxPropInstances = 4096`; cull enabled `main.cpp:6794`, **default `false`** (`prop_pass.h:105`) |
| 6 | `:88-89` "Оторвавшиеся (`DynamicBodyTag`) пропы уходят в `BodyPass`" | **TRUE but lossy** | `body_pass.cpp:284` skips `StaticPropTag`; but the detached prop draws as a 0.4 m cube (`prop_system.cpp:130`), losing shape and `size_*_m` |
| 7 | `:109-112` "`PropDetached` никто не слушает… шов готов" | **TRUE** | publisher `prop_system.cpp:76`; consumers are only `suite_props_game.inl:316,353,764` and `suite_eventsweb.inl:82` |
| 8 | `:104-107` "`sizeXMm` и `reachMm` остались `uint16` — предмет крупнее **65.5 метра** невыразим" | **HALF-FALSE** | `sizeXMm` yes; `reachMm` is capped by the generator at **10000** (`gen_prop_table.py:130`) = 10 m — and is dead anyway (§5.3) |
| 9 | `:82-83` "Ragdoll и падение интегрирует `physics_step`; игровая часть — `prop_ragdoll_step`" | **HALF-TRUE** | integration exists (`physics.cpp:339-342`) but the resulting `Rotation` is **never rendered** — 0 references in `src/render/` or `main.cpp` |
| 10 | `:79-80` "Ровно тот же долг у `antourage_carve_step()` … вызывается он **в тех же трёх местах**" | **TRUE** | `main.cpp:4053/4062`, `4407/4415`, `6747/6754` |

**5 TRUE, 2 FALSE, 3 HALF-TRUE.** More telling is what `props.md` **omits**: that `reach_mm`, `light_cone_deg` and `name` are dead; that 4 of 9 rows are mislabelled Terminals; and that `Container` borrows the anchor system and is deleted by it.

## 8.7 `antourage.md` (37.8 KB for 1215 LOC) — 25 checks

**The size itself is the finding: 31 KB of prose per 1000 LOC of code.** For comparison, `hud.md` is 5.4 KB for 248 LOC of a system with a comparable number of moving parts. And `antourage.h` is separately **53.5% full-line comments** (153 of 286 lines) — the design is documented twice, in two places that can drift independently.

25 concrete claims checked (structure, constants, wiring, GPU caps, measured numbers), several against a live `build/game_test` run today:

**TRUE (20):** the "no pipe material in any cell after bake" law is literally pinned by `suite_antourage.inl:682-687`; `ensure_loaded` → `bake_antourage` (`floor_stream.cpp:314→335`); floor 0 = 5397 instances = 3550 legs + 1847 fittings (**re-measured today, exact**); 802 wires / 152 cloths (**exact**); `kPipeSources=3`/`kPipeOutlets=700`; wires span 3-7 cells at 0.35 kg/m; cloth 1.8 × 1.6 m, roll ≈ 1 in 8; bend cost 3 vs 1 with Dial buckets; `kPipeCellBudget=3000`; branch cap 8; acceptance 3003 nodes / 3 components / 467 branch points / 0 floating / 0 orphans (**exact**); "the floor is not a mounting surface" (`kFaces=5`, measured `-Z 3220, +Z 0`); Zero-g = 0 bowed wires (test-enforced); a 1.5 m shot severs 1-3 links (measured: 1); a 0.6 m carve does not make the cell air (measured); GPU caps 1024/512/4096 with `[wire] TRUNCATED` / `[prop] shape N FULL` stderr; drip emitter at exactly 0.4 s; `VALID_SHAPES` reduced to the 4 real prop shapes; both instance types carry one `yaw`; Zero-g dresses all six faces (measured `0x3F`).

**FALSE / stale (3) — all measured numbers that drifted after the pipe-network rewrite:**
| Claim | Doc | Measured today |
|---|---|---|
| `:161` bake budget | 70.8 ms | **76.8 ms** (+8.5%) |
| `:184`, `:359` vertical runs | ~175 of 3550 (~5%) | **155** (4.4%) — `run axes X 1553 Y 1842 Z 155` |
| `:221-223` per-regime instance counts | `PosZ` 3082, sides 403-449, `Zero` 1302 | **5048 / 5152-5199 / 5152** — wrong by 4-12×. Wire and cloth counts in the same table are exact. |

The doc **self-flags** the third at `:222-223` ("ЧИСЛА ПО ОСТАЛЬНЫМ СЕМИ РЕЖИМАМ НЕ ПЕРЕМЕРЕНЫ") — honest, but the stale numbers are still printed as fact in the table.

**Misleading (1):** `:35` presents `generate_floor → bake_antourage → nav bake → door_build` as the live pipeline; the nav-bake stage is `if (nav_bake())` — **gated OFF by default** (`floor_stream.cpp:~350`, comment cites `problems.md §26`).

**Verdict:** `antourage.md` is the *most accurate* doc in scope on structure and code facts (20/25) and the *most bloated* by a wide margin. Every failure is a measured number nobody re-measured. Correct numbers are in §4.3 and above and can be pasted in.

---

# 9. DELETION PROPOSAL — ranked

## 9.1 DELETE (no design decision needed, ~1180 LOC)

| Rank | What | LOC | Why safe | Evidence |
|---|---|---|---|---|
| 1 | **Debug tree in `main.cpp`** — cut to FPS + tick + counters, delete the HP bar, needs line, hands line and inventory listing | ~350 of 569 | The owner just built `hud_ui` (7 elements, table-driven, toggleable). This is 72% marko and duplicates all of it. | `main.cpp:5109-5677`; dupes `hud_ui.cpp:54-122` |
| 2 | **`loot_containers_step` + `kOpenColour` + the dead crate-darkening branch** | ~75 | 0 callers in `src/`; already written out of the tick (`main.cpp:4593-4596`); `save.h:659` already documents it as unreachable | `container.cpp:367-436`, `:25` |
| 3 | **`UiSynth` (.cpp+.h) + `UiSound` enum + `trigger_ui` + `uiGain`** | 257 | 0 triggers in `src/`; nothing in the game has ever made a UI sound | `synth_ui.cpp/.h`, `audio_system.cpp:61`, `audio_types.h:34-40,89` |
| 4 | **Prop-system dead public API**: `check_projectile_prop_hits`, `collect_interactable_positions`, `interaction_step`, `prop_interact_step` | ~110 | 0 `src/` callers each | `prop_system.h:163,174,200,207` |
| 5 | **Dead audio API**: `play_3d`, `set_danger`, `set_rad_dose`, `set_grid_intensity`, `compute_grid_harmonics`, `evaluate_fluorescent_hum`, `evaluate_subterranean_rumble`, `active_voice_count`, `voice(int)`, `soft_clip`, `fast_sin`, `process_lp`, `process_hp`, `kCombDelaySamples`, `SpatialVoice::rolloff`, `::customParam`, `update`'s `bus`+`doors` params | ~120 | test-only or zero-caller; three of them are *duplicates* of maths `generate()` re-inlines | §1.4 |
| 6 | **Dead generated data**: `kPropNames`+`prop_name`, `kPropIds`+`prop_id_str`+`prop_id_by_string`, `InteractDef::id`, `props.csv:name`, `:reach_mm`, `:light_cone_deg`, `interactables.csv:note` column | ~60 + 4 CSV columns | 0 readers; §5.3/§5.4 | as cited |
| 7 | **`FloorStreamer::antourage_at`** | ~8 | 0 callers repo-wide | `floor_stream.h:289`, `.cpp:461` |
| 8 | **`UiWindow::Dialog`** | 1 | 0 references | `ui_shell.h:44` |
| 9 | **`AntourageInstance::color`/`emissive`/`yaw`** + the unreachable `ownColor` branch; **`WireChain pinMask=0x01`** variant; **`AntourageBake::pipeCells`** | ~25 | never written / never produced / test-only | §4.3 A4, A7, A8 |
| 10 | **Dead include** `game/noise.h` in `faction_relations.cpp:13`; **`/1.0f`** in `inventory_ui.cpp:238` | 2 | vestigial | as cited |
| 11 | **`data/sounds.csv` + `data/sounds/` + the music channel** (keep the sample-override loader only if a WAV is imminent) | ~50 of the 120 | 0 rows, 0 files; music has no procedural fallback so it is unconditionally silent | §1.2 |

## 9.2 FIX (defects, not cruft — do these first)

| Rank | What | Fix size | Evidence |
|---|---|---|---|
| **F1** | **Containers are wiped on every floor build.** Make `clear_layer_props` filter on `StaticPropTag`+`PropMeshTag` (the real "static prop" identity) instead of on `SubVoxelAnchor` (a physics detail). | **1 line** | §4.0.1 |
| **F2** | **Furniture is a door-lock terminal.** Add `furniture` (or `bed`/`stove`/`table`/`toilet`) rows to `interactables.csv` and repoint `props.csv` rows 7-10. | **4 CSV cells + 1-4 CSV rows** | §4.0.2 |
| **F3** | **Six sound emissions come from a keypress**, five tagged `NoiseSource::Door`. Move each into the primitive that performs the act (`embody_interact_terminal`, `powerGrid.destroy_shield`, `relieve_needs`, `possess_nearest_survivor`, the search-screen *transfer*), and give each a truthful source. Add `NoiseSource::Interact` or reuse `Container`/`Body` correctly. | ~40 lines moved | §1.1 |
| **F4** | **`antourage_carve_step` re-upload snaps all dressing to rest pose.** Drop `dressingSetChanged` from the two carve sites (pins are already published per frame by `write_pins`). | **2 lines** | §4.3 A2 |
| **F5** | **`interact_kind_from_u8` turns `None` into `Loot`.** Return an optional and skip the `Interactable` emplace. | ~6 lines | §4.2 |
| **F6** | **Carve blast is tagged `WeaponFire`** though `NoiseSource::Explosion` exists. | 1 line | `main.cpp:4047` |
| **F7** | **`main.cpp:4203` hardcodes `3.5f`** instead of `interact_def(ElectricalShield).reachM`. | 1 line | §5.4 |
| **F8** | **Voice pool has no priority and no distance cull** — a footstep evicts a gunshot; a noise 200 m away burns a voice. Add a severity term to the steal heuristic and an early distance test in `process_noise_events`. | ~15 lines | §1.3 |
| **F9** | **Two `menuPage` variables, two numberings.** Use `shell.menuPage` for both, add a `MenuPage` enum. | ~15 lines | §3.5 |

## 9.3 MERGE (the "few general systems" work)

| Rank | Merge | LOC saved | What it looks like |
|---|---|---|---|
| **M1** | **ONE `WorldObject` seam.** `Container`, `Corpse`, `Pickup` become `props.csv` rows carrying a payload component; antourage adopts `SubVoxelAnchor`; `anchor_validate_step` and `antourage_carve_step` become one function; `find_nearest_interactable` replaces the container scan and the pickup radius; one spelling of "reach". | **≈560** | §4.1 / §4.2. Storage stays split (bake vs entities) — that split is correct and `props.md:14-17` is right about it. What unifies is the **row format, the anchor, the carve response and the interaction seam**. Doors stay out: a door *is* voxel geometry. **F1 falls out of this for free.** |
| **M2** | **`ui::begin_panel(id, PanelSpec)`** replacing 10 hand-rolled scaffolds. | ~50 | §3.1 |
| **M3** | **`src/render/ui_palette.h`** — one palette, both `ImVec4` and `ImU32`, replacing 5 duplicate blocks and 19 inline literals. | ~40 | §3.2 |
| **M4** | **`ui_bar(frac, size, policy)`** — one bar with one threshold table, replacing 4 implementations in 3 techniques. | ~30 | §3.3 |
| **M5** | **Disassembly becomes `InvUiPolicy::allowScrap` + `InvUiRequest::Kind::Scrap`**, exactly like `allowRepair` already is. Deletes the Craft window's rogue inventory table. | ~55 | §3.4 |
| **M6** | **Rewrite the Craft window** in the CRT palette, in Russian, reading `craft_material_name()`/`craft_station_name()` from the game layer instead of hardcoding two enum name tables in the UI. | −0 LOC, +2 small game-layer functions | §3.7. This is the last marko-authored UI in the tree. |

## 9.4 KEEP (exemplary — use as the pattern)

| What | Why |
|---|---|
| `src/app/hud_ui.{h,cpp}` (248) | table-driven elements, slot-as-data, const-by-type read-only law, silent elements. The model. |
| `src/app/settings_ui.{h,cpp}` (140) | tabs are a table; one code, two entries; request-seam. |
| `src/render/inventory_ui.cpp` `draw_cells` (438) | one grid, `policy` + `span` + `marks`; procedural glyphs derived from item id; both sides of a two-sided screen are the same code. |
| `src/app/ui_shell.h` (67) | the six-flag mess it replaced is named in its own header. |
| `src/game/keybind.{h,cpp}` (179+117) | 0 orphan binds, 0 orphan panels, serialisable, rebindable, headless-testable. |
| `data/particles.csv` + `gen_particle_table.py` + `particle_pass` | 5/5 rows live, 12/14 columns live. The liveness standard. |
| `src/game/encumbrance.cpp:125-140` | sound from physics, cadence derived, double-stagger trap documented and fixed. |
| `src/game/antourage/*` | fully wired to tick + all 3 carve paths + 3 render passes; 21/21 commits Jirnyak; the best-derived constants in the tree (`kPipeBranchCells`, `kBendCost`, `kWireKgPerMetre`). Only its **doc** needs work. |
| `src/audio/spatial_audio.cpp` | 112 LOC, derived attenuation, honest about what it does. Fix the two stale comments (`1024m` → `256m`, and the `audio.md` "all axes" claim). |

## 9.5 Totals

| Bucket | LOC |
|---|---|
| DELETE outright | **≈1180** |
| MERGE saves (M1-M5) | **≈735** |
| FIX (F1-F9) | ~85 lines touched, mostly one-liners |
| **Net removable** | **≈1900 LOC** across audio + UI + props + antourage |

Two of the nine FIXes are **one line** and **four CSV cells**, and between them they restore every container in the game and stop every bed from being a door-lock terminal.
