# Commit forensics — `marko1olo` + "Петушков А." on branch `torus`

**Repo:** `/Users/jirnyak/Mirror/gigahrush2` · **Branch:** `torus` @ `97bdf13e` · **579 commits**
**Audit date:** 2026-08-17 · **Method:** read-only git archaeology + grep/blame verification of every claim.

Every number below is reproducible from a command shown in-line. Where a document makes a claim,
I grepped the code rather than trusting the document.

---

## 0. Headline: the sockpuppet is proven by the commit metadata itself

```
$ git log --format='%an <%ae>' | sort | uniq -c | sort -rn
 307 marko1olo <marko1olo@users.noreply.github.com>
 211 Jirnyak <jirnyak@gmail.com>
  55 Петушков А. <96879250+marko1olo@users.noreply.github.com>
   5 dependabot[bot] <...>
   1 Jirny Jirnov <50689126+Jirnyak@users.noreply.github.com>
```

`Петушков А.` commits are signed with **`96879250+marko1olo@users.noreply.github.com`** — the GitHub
noreply address of *account id 96879250, login `marko1olo`*. It is not a similar name; it is
literally the same GitHub account with `user.name` changed. 362 of the 579 commits on `torus`
(62.5%) come from that one account.

Committer field adds the second half of the story:

```
$ git log --format='%cn' --author='marko1olo' | sort | uniq -c
  54 Петушков А.
   1 GitHub
  22 Jirnyak      <- cherry-picked BY THE OWNER
 285 marko1olo    <- pushed directly
```

Only **22** of his 362 commits passed through the owner's hands. Those 22 are, by survival rate,
the best material in the whole set (section 6). The other 285 are self-merged.

---

## 1. Full inventory, by date-batch

Batches are sharply separated in time; there are 8 of them.

| Batch | Date | Author | Commits | +added | −deleted | Lines still in HEAD | Survival |
|---|---|---|---:|---:|---:|---:|---:|
| B1 | 2026-07-28 | marko1olo | 48 | 22 549 | 847 | 16 494 | **73 %** |
| B2 | 2026-07-29 | marko1olo | 62 | 50 345 | 3 468 | 41 805 | **83 %** |
| B2′ | 2026-07-29 | Петушков | 3 | 57 | 8 | 49 | 86 % |
| B3 | 2026-07-30 | marko1olo | 58 | 23 559 | 4 302 | 5 788 | **25 %** |
| B3′ | 2026-07-30 | Петушков | **52** | 5 116 | 1 302 | 2 001 | 39 % |
| B4 | 2026-07-31 | marko1olo | 36 | 12 082 | 910 | 2 476 | **20 %** |
| B5 | 2026-08-01 | marko1olo | 56 | 44 849 | 41 554 | 2 478 | **6 %** |
| B6 | 2026-08-02 | marko1olo | 25 | 3 833 | 1 301 | 1 089 | 28 % |
| B7 | 2026-08-04 | marko1olo | 8 | 234 | 17 | 157 | 67 % (owner-picked) |
| B8a | 2026-08-13 | marko1olo | 2 | 11 | 6 | 10 | 91 % (owner-picked) |
| B8b | 2026-08-14 | marko1olo | 7 | 105 | 46 | 104 | **99 %** (owner-picked) |
| B8c | 2026-08-15 | marko1olo | 5 | 29 | 12 | 28 | **97 %** (owner-picked) |
| | **total** | | **362** | **162 769** | **53 773** | **72 479** | **44.5 %** |

Survival computed by `git blame --line-porcelain` over all 466 non-binary tracked files in HEAD,
bucketed by originating commit.

For contrast: Jirnyak is 211 commits, `+90 590 / −52 393`.

**The curve is the finding.** 28–29 July is real engineering (73 %/83 % survival). 30 July –
2 August is a collapse to 6–28 %: SEO spam, agent-scratch dumps, screenshot logs, and bot-style
auto-push sweeps. The 4 August–15 August tail is 97–99 % because the *owner*, not marko, selected it.

**78 of 362 commits (22 %) have ZERO surviving lines in HEAD** — 18 445 lines added that no longer
exist anywhere.

### By system (file-touch counts per batch)

| Batch | Dominant subtrees |
|---|---|
| B1 07-28 | `src/game` 94, `tests` 39, `src/app` 28, `src/render` 23, `tools` 17, `shaders` 14 |
| B2 07-29 | `src/game` 133, `tests` 64, `tools` 18, `src/app` 17, `src/render` 16, `data` 14 |
| B3 07-30 | **`*.md` 250**, `src/render` 58, `shaders` 55, `src/game` 26, `.github` 11 |
| B4 07-31 | **`shots/` 60**, `src/game` 38, `*.md` 29, `shaders` 25 |
| B5 08-01 | **`shots/` 553**, `src/game` 51, `tests` 27, `*.md` 24 |
| B6 08-02 | `src/game` 19, `tests` 10, `src/world` 8, plus `_run_full.py`, `_patch_zup.py`, `_run_full_stdout.txt` |
| B7–B8 | `src/render`, `src/combat`, `src/sim` — small, targeted |

`shots/` (613 file-touches across B4+B5) is **entirely gone from HEAD** — `git ls-tree -r HEAD -- shots`
returns nothing.

---

## 2. "Петушков А." is not a Windows-portability contributor. It is an SEO spam account.

This contradicts the working assumption. All 55 Петушков commits on `torus`, in full:

| What | Count | Evidence |
|---|---:|---|
| README.md rewrites | **19** | `README.md` touched 19 times in 24 h; subjects include "PERFECT ULTRA-MEGA README", "MEGA README", "epic bilingual README", "deploy massive 25+ paragraph technical deep-dive README" |
| GitHub-Pages landing page | 6 | `index.html` (1 733 lines), `docs/index.html`, `bdb02126` "Deploy SPA for GIGAHRUSH 2" (+1 622), `21c6105a` "seo: sync SEO-enhanced index.html to docs/" (+1 705) |
| SEO artefacts | 8 | `sitemap.xml`, `robots.txt`, `site.webmanifest`, `favicon.svg`, `.nojekyll`, Schema.org JSON-LD, OpenGraph, "social share badges and virality CTAs" |
| GitHub community boilerplate | 8 | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue forms, PR template |
| CI bots | 5 | `stale.yml`, `welcome.yml`, `release.yml`, `dependabot.yml`, `pages.yml` |
| LICENSE rewrites | 3 | "ГИГАХРУЩ 2: Лицензия Бесконечного Подъезда v2.0" |
| Build config | **1** | `2b84ab6b` `.github/workflows/cmake-multi-platform.yml` — see below, it is the worst commit of the 55 |

**Zero lines of C++. Zero files under `src/`.** Confirmed:

```
$ awk -F'|' '{print $3}' /tmp/markoaudit/first_commit.txt | sort | uniq -c
 204 Jirnyak
 173 marko1olo          <- no Петушков row at all
```
Not one of the 377 tracked files under `src/ tests/ tools/ shaders/ data/` was created by Петушков,
and blame attributes **0** surviving source lines to that name.

The Windows toolchain the owner remembers as "Петушков" is actually **marko1olo**:
`tools/win/build.bat` first added by `9af5b79c|marko1olo|2026-07-28|build(win): make the tree build on Windows/MSVC, green with zero warnings`.

### 2.1 MAJOR: the fake "Build: passing" badge + a CI pipeline that could never run

`2b84ab6b` (Петушков, 2026-07-30) added the **unmodified GitHub "CMake on multiple platforms"
starter template** — a 3-leg matrix going checkout → configure → build → ctest with **no
dependency-installation step**. `CMakeLists.txt` opens with `find_package(Vulkan REQUIRED)` and
`FATAL_ERROR` when `glslc` is missing. A bare runner has neither Vulkan, nor glslc, nor SDL3, so
the pipeline **could not reach the configure step on any leg and had never been green**.

In parallel the same account's README commits installed a hardcoded shields.io **"Build: Passing"**
image. A pipeline that cannot run + a badge asserting it passes = a false green in the most visible
place in the repo. It stood for **12 days** until the owner removed both:
`c958e166|2026-08-12|Jirnyak|ci: конвейер, который может выполниться, и значок, который не врёт`.
(The reasoning is preserved verbatim in the header of `.github/workflows/source-rules.yml`.)

### 2.2 Петушков artefacts STILL IN HEAD

| File | Lines | Origin |
|---|---:|---|
| `index.html` | 1 733 | `c4c79bc9` Петушков |
| `sitemap.xml` | 8 | `5002f804` Петушков |
| `site.webmanifest` | 14 | `35910dc0` Петушков |
| `favicon.svg`, `.nojekyll` | — | `d170f821`, `ad58c0da` Петушков |
| `.github/workflows/pages.yml` | | `19885e91` Петушков |
| `.github/workflows/static.yml` | | `aefe2b1f` Петушков |
| `.github/workflows/deploy-gh-pages.yml` | | `e22f8a41` **marko1olo, smuggled into a `feat(game)` RPG commit** |
| `.github/workflows/{stale,welcome}.yml`, `dependabot.yml`, `release.yml` | | Петушков |

**Three separate GitHub-Pages deploy workflows** coexist in HEAD. Nobody consolidated them.

`README.md:12` in HEAD still reads:
> `Authored by **Graf Irnyak (Klaus Schwab)** & **Adolf Petushkov** (2026).`

The sockpuppet wrote itself into the project's authorship line (`3e3f18fb`, marko1olo,
"chore(manifesto)") and it is still there.

---

## 3. THE CI GATES — full exclusion ledger

### 3.1 Provenance

Two gates exist. **Neither has ever been weakened on `torus`.** This is worth stating plainly,
because it contradicts the prior-audit summary.

| Gate | Created by | When |
|---|---|---|
| `tools/check_source_rules.cmake` | **marko1olo** (`224b7457`) | 2026-07-28 |
| `tools/check_wired.cmake` | **Jirnyak** (`84dfe8de`), from marko's idea | 2026-08-13 |

```
$ git blame --line-porcelain tools/check_wired.cmake | grep '^author ' | sort | uniq -c
 179 author Jirnyak
```
All 179 lines of `check_wired.cmake` in HEAD are Jirnyak's.

Both gates are **green at HEAD** (I ran them):
```
$ cmake -P tools/check_wired.cmake        -> GIGA_WIRED=PASS entry_points=41
$ cmake -P tools/check_source_rules.cmake -> GIGA_SOURCE_RULES=PASS files_scanned=299
```

### 3.2 Every change ever made to `check_source_rules.cmake` (all 16 commits, full history)

| # | Hash | Date | Author | Direction | What it did |
|---|---|---|---|---|---|
| 1 | `224b7457` | 07-28 | marko | **create** | 245-line gate: no-throw/no-RTTI/no-GLM/no-BOM text rules; `giga-check: allow` escape hatch |
| 2 | `8c3bb837` | 07-28 | marko | **strengthen** | `weapons_melee.csv` joins CSV-drift gate |
| 3 | `6e768657` | 07-28 | marko | **strengthen** | `weapons_ranged.csv` joins CSV-drift gate |
| 4 | `156761fb` | 07-28 | marko | **strengthen** | `materials.csv` ↔ `material_surface.glsl` drift gate |
| 5 | `f1afa158` | 07-29 | marko | **strengthen** | `.inl` added to all 4 globs — 18 files / 10 468 lines of test code had bypassed *every* rule; plus a positive-list cross-check so a new extension can't repeat it |
| 6 | `e2e8fbd6` | 07-29 | marko | **strengthen** | unwired-suite guard: every `tests/suite_*.inl` must be `#include`d and its `test_*_all()` called. Escape hatch `// giga-check: unwired-suite <reason>` |
| 7 | `a10b907b` | 07-29 | marko | comment | **retracted a false claim in his own comment** ("floor_stream.cpp calls nav_cache on every floor load" → FALSE; the path is gated behind `if (!navCacheDir_.empty())` and only a test sets it) |
| 8 | `db26b698` | 07-29 | marko | **strengthen** | his own guard required `static void`; `suite_speech.inl`'s 81 CHECKs were invisible. Now matches bare `void ` too |
| 9 | `52947b3b` | 08-02 | marko | **strengthen** | `props.csv` ↔ `prop_table.h` drift gate |
| 10 | `07b47a84` | 08-03 | Jirnyak | strengthen | particles table |
| 11 | `f7a92279` | 08-03 | Jirnyak | **tighten** | unwired-suite exemption must be a line-start directive |
| 12 | `3c22e0f0` | 08-04 | Jirnyak | strengthen | `monster_traits` drift gate |
| 13 | `0cf5b418` | 08-04 | marko | **tighten** | cherry-pick: only a directive LINE counts as an exemption, so a comment *quoting* the string can't exempt a suite |
| 14 | `9e1335c2` | 08-12 | Jirnyak | **fix blindness** | the gate was reading **two lines per file** — CMake splits a list inside `[ ]` (problems.md §46) |
| 15 | `81d51c52` | 08-12 | Jirnyak | **fix FN** | `://` no longer truncates a line and hides a banned token |
| 16 | `e9af5f8d` | 08-04 | marko | tighten | "stop a comment from faking the unwired-suite exemption" |

**Verdict: marko did not weaken this gate once.** He created it and hardened it five times, twice
against holes he had personally introduced, and once retracted his own false justification. On
`torus` this is his single most valuable contribution.

### 3.3 EVERY exclusion/exemption/skip present in HEAD

**(a) `giga-check: allow` — free-text per-line escape hatch.** Repo-wide usage:
```
$ grep -rn "giga-check" --include='*.inl' --include='*.cpp' --include='*.h' .
tests/game_test.cpp:5411   // giga-check: allow — the English word "catch" inside a printf literal
```
**Exactly one use in the entire tree**, and it is legitimate. Author: Jirnyak.

**(b) `giga-check: unwired-suite <reason>` — per-suite exemption.** **Zero uses in HEAD.**
No test suite is exempted.

**(c) `GIGA_DEFERRED_ENTRY_POINTS` in `tools/check_wired.cmake` — 9 rows, all added by Jirnyak:**

| Row | Owner of the system | Status verified today |
|---|---|---|
| `cellular_step` | Jirnyak | **STALE — the system does not exist.** `grep -rn cellular_step src/ tests/` → nothing. `src/sim/cellular.{cpp,h}` deleted in `1c9b06f0` (2026-08-10). The file's own doc says "a row leaving this file means the system got wired or got deleted" — this row should have gone with it. |
| `fluid_step` | Jirnyak | live, genuinely deferred |
| `loot_containers_step` | **marko** (`34399e4a`) | test-only backend; superseded by the owner's search screen |
| `diffusion_step` | Jirnyak | gate blind-spot, documented; `diffusion_tick` IS wired |
| `route_step` | Jirnyak | deferred to #13 |
| `feed_tick` | Jirnyak | read only by a test |
| `samosbor_fog_tick` | **marko** (`3803aacb`) | not ticked in the game |
| `interaction_step` | **marko** (`322b49e8`) | main.cpp calls its own branches instead |
| `prop_interact_step` | **marko** (`322b49e8`) | "called by NOBODY and not covered by a test" |

4 of the 9 deferred-because-nobody-calls-them systems are marko's.

### 3.4 MAJOR: the gate self-exclusions DO exist — on marko's own branches, and one is smuggled into a merge

The prior audit's "self-exclusions added to check_wired.cmake" is real, but it lives on branches
that were **never merged into `torus`**:

```
$ git merge-base --is-ancestor origin/marko/megastructure HEAD  -> NOT merged (ahead 126)
$ git merge-base --is-ancestor backup/origin-main-2026-08-15 HEAD -> NOT merged (ahead 119)
$ git merge-base --is-ancestor origin/fix-z-axis-hardcodes HEAD -> NOT merged (ahead 38)
```

| Hash | Branch | Author | What |
|---|---|---|---|
| `591bc1df` | megastructure | marko | `chore(gate): update check_wired.cmake removing wired samosbor_fog_tick` — a **1-line-only commit** whose entire content is deleting a deferral row. No code accompanies it. |
| `46c971f5` | megastructure | marko | A **merge commit** whose conflict resolution introduces `"vendor_restock_step: ..."` as a `++` line — i.e. it exists in **neither parent**. A new gate exclusion invented inside a merge, where diffs are least reviewed. |
| n/a | `origin/fix-z-axis-hardcodes` | marko | His original `check_wired.cmake`: no `[ ]` neutralisation (so it stops reading at the first bracket) and **a function's own definition counts as a call**, so a self-calling system passes. Jirnyak measured this against `diffusion_step` and closed both holes before adopting the idea (`84dfe8de`). His version deferred **2** entry points; closing the holes exposed **9**. |

---

## 4. MAJOR: `3f59733d` — a commit whose subject says "merge" and which is not a merge

```
$ git log -1 --format='%h parents=%p' 3f59733d
3f59733d parents=96118391          <- ONE parent
```
Subject: *"merge: bring origin/nav-routing-diffusion onto main — 15 conflicts resolved by hand,
best of each side kept"*, with a 40-line body describing per-file adjudications.

What it actually does (`git show --stat 3f59733d`, 19 files, `+1110 / −1046`):

```
tests/game_test.cpp                                | 1025 +------------------
tools/branch_port_pending/branch_tests.inl         | 1049 ++++++++++++++++++++
{src/game => tools/branch_port_pending}/ai.cpp     |    0
{src/game => tools/branch_port_pending}/ai.h       |    0
{src/game => tools/branch_port_pending}/faction.cpp|    0
{src/game => tools/branch_port_pending}/loot_table.{cpp,h}
{src/game => tools/branch_port_pending}/macro_sim.{cpp,h}
{src/game => tools/branch_port_pending}/macro_bench.cpp
```

It **moved the owner's `ai`, `faction`, `loot_table`, `macro_sim`, `macro_bench` out of `src/` and
out of the build**, and moved 1 049 lines of the owner's tests out of `game_test.cpp` and out of
ctest, into a directory named `branch_port_pending`. Marko had shipped his own same-named
reimplementations of three of those in the preceding 24 hours:

| Subsystem | Owner's original | Marko's replacement (≤24 h later) | Kept |
|---|---|---|---|
| `ai.{cpp,h}` | `6a075223` Jirnyak 07-29 | `cdf50b14` marko 07-29 | marko's |
| `macro_sim.{cpp,h}` | `73624958` Jirnyak 07-28 | `d86c89ca` marko 07-29 | marko's |
| `loot_table.{cpp,h}` | `124a568e` Jirnyak 07-29 | `d9c7aaaf` marko 07-29 | marko's |
| `faction.cpp` | `de510db3` Jirnyak 07-28 | — | **deleted, never restored** (`git cat-file -e HEAD:src/game/faction.cpp` → NO) |

The owner permanently discarded the parked directory five days later:
`519bdeb7|2026-08-03|Jirnyak|chore: purge repo litter — .agents scratch, stale SPIR-V, superseded
branch_port_pending, ctest output` (202 files, **−12 347 lines**), including `ai.cpp` 361,
`ai.h` 402, `branch_tests.inl` 1 049, `loot_table.*` 288, `faction.cpp` 34.

Its own commit body admits: *"NOT VERIFIED: nothing here was observed in the running game."*

Surviving lines from `3f59733d` in HEAD: **25 of 1 110**.

---

## 5. MAJOR: the Native-First Law, written and violated the same afternoon

| Time (author date) | Commit | Content |
|---|---|---|
| **2026-08-02 14:45:33** | `d7d67df9` marko | Adds to `AGENTS.md`: *"**THE NATIVE-FIRST LAW (ZERO CRUTCH SCRIPTS):** You are ABSOLUTELY FORBIDDEN from creating Python, Bash, Node, or PowerShell wrapper scripts (`_patch_*.py`, `_wire_*.py`, etc.) to edit, append, test, or generate code… Any attempt to bypass direct file editing with a script is a CRITICAL COMPLIANCE FAILURE."* |
| **2026-08-02 16:48:02** | `1e805c9a` marko | Commits **`_patch_zup.py`, 769 lines** — literally the `_patch_*.py` name pattern his own rule enumerates. Header: `"""One-shot Z-up + DynamicBodyTag + padic lamp lattice patch. Delete after use."""`, containing `must_replace(path, old, new)` which does `path.write_text(text.replace(...))` on source files. The actual code change in that commit is **12 lines**. |

**2 hours 3 minutes** between writing the ban and breaking it.

He had already done this at scale the previous day and then had to undo it:
`a8a70c30|2026-08-01|chore(shots): delete crutch _probe_*.py _patch_*.py scripts — Overseer cleanup`,
**286 files, −40 607 lines**.

Other rules marko unilaterally legislated into `AGENTS.md` that are **still binding at HEAD**:
- `AGENTS.md:16` "Retro-Pixel / VHS / CRT UI Mandate … from GigaHrush 1 (`taste.md`)" — **`taste.md` does not exist in this repository** (`ls taste.md` → absent). A mandatory rule citing a nonexistent file.
- `AGENTS.md:17` "v1 is Read-Only Canon: `C:\hades\gigahrush` … All new code MUST be written to `C:\hades\gigahrush2`" — a **hardcoded Windows path** as a hard rule in a repo the owner develops on macOS.
- `AGENTS.md:318` a 13-line "UI / HUD Aesthetic Mandate" pinning exact ImGui style constants.

The owner later had to revert one of the products of that mandate:
`25b70199|2026-08-05|Jirnyak|revert(ui): убрать пробегающую полосу помех из CRT-оверлея`.

---

## 6. MAJOR: `2347bc5d` — "close problem 10" closed nothing, and it is in HEAD *because the owner cherry-picked it*

Subject: `feat(door): enforce itemTier matching in inventory_has_keycard and close problem 10`.
Author marko (2026-08-14), **committer Jirnyak (2026-08-16)** — one of the 22 hand-picked ones.
Diff: `problems.md +2/−19`, `src/game/door.cpp +5/−1`.

The code, still live at `src/game/door.cpp:202-217`:
```cpp
bool inventory_has_keycard(const Inventory& inv, std::uint8_t requiredTier) {
    if (requiredTier == 0) return true;                       // <-- (B)
    ...
        if (def.category == static_cast<std::uint8_t>(ItemCategory::Key)) {
            const std::uint8_t itemTier = def.useA > 0 ? ... : 1u;   // <-- (A)
            if (itemTier >= requiredTier || itemTier >= (std::uint8_t)KeycardTier::Master)
                return true;
        }
```
It removed 19 lines of problems.md and wrote *"ЗАКРЫТО 2026-08-14 … Все тесты зеленые."*

**Verified today, two independent reasons it closes nothing:**

**(A) the data column it reads is empty for every key in the game.**
```
$ python3 - data/items.csv     # 443 rows, 3 with category KEY
 id=key                      use_a=     (empty)
 id=key_tutorial_apartment    use_a=     (empty)
 id=tut_cafe_key              use_a=     (empty)
```
and the generated table agrees — `src/game/item_table.cpp:833` `ItemDef{ … u8(UseEffect::None), {0,0,0,0,0}, … }`.
So `def.useA` is 0 for all three keys, `itemTier` is always the `1u` fallback, and the "tier
matching" degenerates to a constant. The owner's own §51 note predicted exactly this.

**(B) `Door::keycardTier` has no writer anywhere in the tree.**
```
$ grep -rn "keycardTier" src/ tests/
src/game/door.h:129    std::uint8_t keycardTier : 5 = 0;   // declaration, default 0
src/game/door.cpp:261  if (isShutOrLocked && targetDoor.keycardTier > 0)   READ
src/game/door.cpp:262  ... inventory_has_keycard(*playerInv, targetDoor.keycardTier)  READ
src/app/main.cpp:6404  if (isShutOrLocked && d.keycardTier > 0)            READ
src/app/main.cpp:6409  ... inventory_has_keycard(*pInv, d.keycardTier)     READ
```
**Four reads, zero writes.** Every door in the game has `keycardTier == 0`, so
`inventory_has_keycard` returns `true` on line 1 and the whole keycard system is inert.

`git show HEAD:problems.md | grep 'Проблема 10'` → **"— ЗАКРЫТА 2026-08-14"**.
The owner softened the wording in `f3a65ad5` but left the closure standing. **§10 is falsely closed
in HEAD today.**

---

## 7. The unwired-API census: 115 marko functions that only tests ever call

`check_wired.cmake` only inspects names ending `_step`/`_tick` (41 entry points). Everything else
escapes it. I built the equivalent check for marko's whole API surface — every free function
declared in a marko-created header still in HEAD — and classified each by who calls it.

**370 functions. 239 have a real caller in `src/`. 115 are called ONLY from `tests/`. 16 have no
caller anywhere.**

A second, stricter pass — transitive reachability from `src/app`, `src/render`, `src/audio`,
`src/input` roots through an approximate call graph — finds **68 of 370 (18 %) unreachable from
the running game at any depth**:

| Module | Unreachable | Symbols |
|---|---:|---|
| `monster_traits` | **12** | `trait_damage_mult`, `trait_incoming_mult`, `trait_move_mult`, `trait_has_vulnerability`, `trait_takes_bait`, `trait_takes_bait_any`, `trait_allows_wet_spawn`, `monster_traits_default`, `monster_trait_authored_count`, `monster_traits_rows_indexed`, `monster_traits_unauthored_reason`, `has_bait` |
| `rpg` | 8 | `adjusted_psi_cost`, `total_xp_for_level`, `int_xp_mult_e3`, `int_psi_cost_mult_e3`, `int_contract_reward_mult_e3`, `int_document_reward_mult_e3`, `str_durability_wear_mult_e3`, `clamp_rpg_attribute` |
| `economy` | 6 | `net_worth`, `wealth_tier`, `wealth_tier_name`, `band_name`, `bank_op_name`, `bank_last_entry` |
| `mob_spawn` | 5 | `samosbor_fog_tick`, `samosbor_fog_tick_at`, `count_layer_fog_mobs`, `despawn_layer_fog_mobs`, `spawn_mob_at` |
| `prop_system` | 4 | `interaction_step`, `prop_interact_step`, `check_projectile_prop_hits`, `collect_interactable_positions` |
| `samosbor` | 4 | `samosbor_census`, `samosbor_threat_target`, `samosbor_threat_headroom`, `samosbor_fog_spawn_allowed` |
| `prop_table` | 3 | `prop_id_by_string`, `prop_id_str`, `prop_name` |
| `status` | 3 | `status_name`, `status_heal_mult_e3`, `status_water_drain_e3` |
| others (14 modules) | 23 | incl. `roll_container`, `loot_containers_step`, `drop_mob_loot`, `drop_weapon_ammo`, `door_shut_all`, `quest_state`, `quest_objective_text`, `craft_cost_total`, `craft_known_count`, `speech_line_count`, `noise_audible`, `behaviour_is_dead` |

### 7.1 `monster_traits` is the flagship appendix

```
$ grep -rn "monster_traits" src/ | grep -v '^src/game/monster_traits'
src/app/main.cpp:60      #include "game/monster_traits.h"
src/app/main.cpp:1055    // Sync Armour components ... according to monster_traits
src/game/combat.cpp:23   #include "game/monster_traits.h"
src/game/combat.h:150,302  (comments only)
src/game/combat.cpp:2089   (comment only)
$ grep -rn "trait_damage_mult\|trait_incoming_mult\|trait_move_mult\|MonsterTraits" src/ | grep -v monster_traits
(nothing)
```
Two `#include`s, three prose comments, **one** live entry point (`sync_monster_armour`). The system
is `monster_traits.h` 484 + `.cpp` 256 + `monster_traits_table.cpp` 332 + `data/monster_traits.csv` +
`tools/gen_monster_traits.py` 343 + `tests/suite_monster.inl` 675 ≈ **2 100 lines** delivering one
armour-sync call. Wet-movement, damage multipliers, vulnerabilities and bait — the entire premise —
are exercised only by the test suite.

### 7.2 `economy`'s bank was rebuilt in parallel rather than fixed

main.cpp calls `bank_deposit_all` / `bank_withdraw_all` / `bank_borrow_max` (Jirnyak, `0ea3a70f`).
marko's `bank_deposit` / `bank_withdraw` / `bank_take_loan` / `bank_repay` remain **test-only**.
Two bank APIs live side by side.

### 7.3 `vendor`: 537 → 75 lines

`637eceaf|07-28|marko|feat(game): the vendor — banked roubles finally have a use` (+537). HEAD:
`vendor.cpp` **16 lines**, `vendor.h` **59 lines**, whose own header comment reads *"This header
used to BE the economy's sell side … All of it died on 2026-08-17 with the barter increment."*
40 of marko's 537 lines survive.

---

## 8. Files in `src/` whose FIRST commit is marko's (the appendix candidates)

**88 files under `src/` still in HEAD were created by marko1olo. Zero by Петушков.**

| Subtree | Files | Modules |
|---|---:|---|
| `src/game` | 71 | combat, container, contract, craft(+table), door, economy(+table), extraction, faction, faction_relations, hunt, investigate, item_table, loot, mob_behaviour, mob_spawn, mob_table, monster_traits(+table), needs, noise, prop_system, prop_table, quest(+table), ranged_pick, ranged_table, rpg, rumour, samosbor, save, speech(+table), status(+table), vendor, wander, weapon_table |
| `src/render` | 14 | gpu_cull_pass, gpu_light_grid, gpu_timer, prop_mesh, prop_pass, screenshot, vk_texture |
| `src/world` | 3 | materials.h, nav_async.{cpp,h} |
| `src/core` | 1 | tick.h |

Plus 25 test suites, 12 CSV-table generators under `tools/`, 11 `data/*.csv`, 18 `.ktx2` textures,
8 shaders, `tools/check_source_rules.cmake`, `tools/win/build.bat`.

**This is essentially the entire game layer.** Ripping it out is not an option; the question is
which modules are live and which are appendices — section 7 answers that.

Orphan worth noting: `src/game/ranged_pick.cpp` — there is **no `ranged_pick.h`** and no file
`#include`s anything that names it; it defines `equipped_ranged` / `equipped_throwable` declared in
`ranged_table.h`. A file whose name matches nothing.

---

## 9. Files the owner had to rewrite or delete after marko (the rot map)

Ranked by owner-authored fix/refactor/purge commits landing on a marko-created file:

| File | Jirnyak commits | of which fix/purge | Blame split (marko / Jirnyak) |
|---|---:|---:|---|
| `src/game/combat.cpp` | 24 | **10** | 1 333 / 1 081 |
| `src/game/combat.h` | 18 | 7 | 600 / 299 |
| `src/game/save.cpp` | 17 | 4 | 833 / 627 |
| `src/game/prop_system.cpp` | 9 | 4 | 450 / 191 |
| `src/game/save.h` | 16 | 3 | 558 / 352 |
| `src/game/faction_relations.cpp` | 7 | 3 | 379 / 62 |
| `src/game/item_table.cpp` | — | — | **504 / 2 670** (owner rewrote 84 %) |
| `src/game/rumour.{cpp,h}` | 5 | 4 | |
| `src/world/nav_async.{cpp,h}` | 3 | 3 | |

Named owner cleanups of marko's work:

| Hash | Date | Subject |
|---|---|---|
| `60dbd2aa` | 08-02 | **`Fix Markololo regressions: thread LazyFieldRebaker, remove hardcoded bulbs, revert corpse ragdoll`** |
| `d9eb0f1e` | 08-02 | `[prop] Decommission legacy PropPlacer/EnvDetail subsystem` — deletes `prop_placer.*`, `env_detail.*` from `cefee616` |
| `b9755496` | 08-02 | deletes `gpu_particle_pass.*` from `26972e1d` |
| `29527e9c` | 08-03 | `refactor: delete LazyFieldBaker — orphaned duplicate whose output nothing read` |
| `519bdeb7` | 08-03 | `chore: purge repo litter` — 202 files, −12 347 |
| `6e12ec94` | 08-03 | `chore: audit small-fry — hash consolidation, orphan textures, lying comments` |
| `1c9b06f0` | 08-10 | `снос мёртвого cellular` — deletes `src/sim/cellular.*` |
| `c958e166` | 08-12 | kills the never-runnable CI + the lying badge |
| `25b70199` | 08-05 | `revert(ui): убрать пробегающую полосу помех из CRT-оверлея` |
| `a1f5c994` | 08-05 | `fix(save,combat): спасённые из форка marko1olo проверки границ, без скрытого static` |

**Highest-risk systems today** (marko-authored, heavily patched by the owner, still central):
`combat`, `save`, `prop_system`, `faction_relations`.

---

## 10. THE 30 WORST COMMITS

`surv` = lines from that commit still present in HEAD (blame).

| # | Hash | Date | Author | Subject | Why bad | Left in HEAD |
|---:|---|---|---|---|---|---|
| 1 | `fe84f3cf` | 08-01 | marko | `chore(auto): 15-min strategic sweep sync for GigaHrush2` | **273 files, +37 777, empty body.** Agent scratch (`.agent_mem/`), `shots/_await_*.py`, stderr dumps, a JPEG. Zero engineering. | **20 lines** — and `.agent_mem/sub_gigahrush2.mem.json` is *still tracked at HEAD*, missed by the owner's purge |
| 2 | `a8a70c30` | 08-01 | marko | `chore(shots): delete crutch _probe_*.py _patch_*.py scripts — Overseer cleanup` | **286 files, −40 607**, empty body. Undoing #1 and its siblings. Together ≈78 k lines of pure churn in one day, permanently in history | 0 |
| 3 | `3f59733d` | 07-29 | marko | `merge: bring origin/nav-routing-diffusion onto main — best of each side kept` | **Not a merge (one parent).** Moved the owner's `ai`/`faction`/`loot_table`/`macro_sim`/`macro_bench` out of the build and 1 049 lines of his tests out of ctest. Body admits "NOT VERIFIED". | 25 / 1 110; `src/game/faction.cpp` gone forever |
| 4 | `2347bc5d` | 08-14 | marko | `feat(door): enforce itemTier matching … and close problem 10` | **False closure.** Reads `def.useA`, empty for all 3 KEY rows; and `Door::keycardTier` has 4 reads / **0 writes**. Deleted 19 lines of problems.md. | **Live in `door.cpp:202`; §10 still marked ЗАКРЫТА** |
| 5 | `d7d67df9` | 08-02 | marko | `chore(rules): enforce Native-First Law` | Legislated a ban on `_patch_*.py`; **violated it 2 h 03 m later** in `1e805c9a` | rule text in AGENTS.md (later relaxed by owner) |
| 6 | `1e805c9a` | 08-02 | marko | `fix(s19): forcefully correct GpuHandoff event payload` | 12 lines of real change + **769-line `_patch_zup.py`** with `must_replace()` writing source files; hardcoded `C:\hades\gigahrush2` | 0 |
| 7 | `2b84ab6b` | 07-30 | **Петушков** | `Add multi-platform CMake workflow configuration` | Starter-template CI with no dep install; **could never configure**; paired with a hardcoded "Build: Passing" badge. False green for 12 days | 0 (owner removed) |
| 8 | `43237403` | 07-30 | marko | `chore: sync project changes` | **148 files, +5 461, empty body.** `.agents/*` scratch + **binary `.spv`** blobs + 19 textures + a 4-line code change | 0 |
| 9 | `c24837ad` | 07-30 | marko | `chore(agents): lane handoffs, handbooks, worker_game_audit and m4 audit docs` | 57 files, **+3 333/−1 071**, empty body, all `.agents/` scratch | 0 |
| 10 | `79f78e27` | 07-31 | marko | `docs(shots): add recent carve testing screenshots, metrics, and handoff log` | 38 files, **+5 086**, empty body, all `shots/` stderr dumps | 0 |
| 11 | `dc415f1f` | 08-01 | marko | `chore: Overseer 15-min auto-push sweep [2026-08-01 16:45]` | 24 files, **+3 398**, timestamped bot message; mixes real `prop_system` work with `_scan18.txt`, `_test_run.txt` | 295 |
| 12 | `689fe40f` | 08-02 | marko | `chore: automated strategic sweep (gigahrush2)` | 23 files, **+1 375/−890**, empty body. A >2 kLOC change with a meaningless subject | 127 |
| 13 | `21c6105a` | 07-30 | **Петушков** | `seo: sync SEO-enhanced index.html to docs/` | **+1 705** lines of marketing HTML into an engine repo | 0 |
| 14 | `bdb02126` | 07-30 | **Петушков** | `Deploy SPA for GIGAHRUSH 2` | +1 622/−389, one HTML file, empty body | 14 |
| 15 | `cefee616` | 07-30 | marko | `feat(render): prop_placer, GPU particles, env_detail; RPG kill-XP wiring + pins` | Three whole render subsystems; **all three decommissioned by the owner within 3 days** (`d9eb0f1e`, `b9755496`) | 337 / 3 671 |
| 16 | `26972e1d` | 07-30 | marko | `feat: implement 3D Volumetric Light Grid, Raymarched Fog & GPU Compute Particle …` | 72 files, +3 626/−1 324, **empty body**; `.agents/` scratch mixed with a render rewrite; particles later deleted | 645 |
| 17 | `c99c3865` | 07-31 | marko | `feat(game): update door logic, compiled shaders, and diagnostic shot scripts` | +1 373, empty body; commits a file literally named **`--pos`** (a shell-redirect accident) plus 11 `shots/` logs | 93 |
| 18 | `52947b3b` | 08-02 | marko | `chore: automated strategic sweep (gigahrush2)` | 9 files +499; a **gate change** (`check_source_rules.cmake`) hidden behind a "sweep" subject. Gate changes must never travel anonymously | 426 |
| 19 | `2edd3a19` | 08-02 | marko | `chore: automated strategic sweep (gigahrush2)` | commits `_run_full_stdout.txt`, `_run_full.py`; rewrites `suite_props_game.inl` under a meaningless subject | 8 |
| 20 | `e22f8a41` | 07-30 | marko | `feat(game): sync RPG progression suite, environmental cell hazards, and texture pipeline assets` | +1 655/−717 empty body; **smuggles `.github/workflows/deploy-gh-pages.yml`** into a gameplay commit — a third Pages workflow, still in HEAD | 1 610 |
| 21 | `3e3f18fb` | 08-01 | marko | `chore(manifesto): update README, AGENTS and jirnyak with Graf Irnyak manifesto` | Writes **"Adolf Petushkov"** (the sockpuppet) and "Klaus Schwab" into the README authorship line; installs the CRT mandate citing **`taste.md`, which does not exist** | `README.md:12`, `AGENTS.md:16-17,318` |
| 22 | `9ba1e6fe` | 08-02 | marko | `docs(rules): apply /learn proposal -- enforce Retro-Pixel VHS/CRT UI Mandate and v1 Read-Only Canon` | Unilateral hard rules incl. hardcoded `C:\hades\gigahrush2` path; the CRT product was partly reverted (`25b70199`) | AGENTS.md HEAD |
| 23 | `322b49e8` | 08-01 | marko | prop_system introduction | Ships `interaction_step` + `prop_interact_step`; **neither has ever been called by the game**; both are deferral rows in `check_wired.cmake` a year of commits later | 58 lines; 2 deferral rows |
| 24 | `6b75c984` | 07-29 | marko | `feat: Implement economy, monster traits, and cellular simulation, update shaders and ai` | **+7 235, empty body**, 4 unrelated systems in one commit. `cellular` deleted as dead (`1c9b06f0`); `monster_traits` is 12/22 dead today | 5 570 |
| 25 | `637eceaf` | 07-28 | marko | `feat(game): the vendor — banked roubles finally have a use` | +537-line trading system; superseded wholesale by the owner's barter increment | 40 lines of price constants |
| 26 | `2958dc45` | 07-30 | marko | `feat(render): prop_pass Phase 2-4 — 25 shapes total` | +865, empty body; 19 new procedural shapes added in one unreviewable go | 46 |
| 27 | `ff70b788` | 07-29 | marko | `perf(render): greedy run merging cuts 34% of the world pass` | +556; the cube mesher it optimises was deleted a day later (`5cab03b6` "the raymarcher is the world renderer") | **1** |
| 28 | `fe10d8c9` | 07-31 | marko | `feat(tex): TEX1 ship 3 missing roughness ktx2, live load 6/6 GREEN` | +329, empty body, "GREEN" claim with no artefact; ships binaries | 0 |
| 29 | `8defce63` | 07-31 | marko | `feat(render): implement procedural authentic multi-biome Soviet architectural …` | +175, empty body; the "biome hash" was purged by `510819b0` `fix: purge legacy architectural biome hash` | 0 |
| 30 | `591bc1df` / `46c971f5` | 08-14/17 | marko | gate edits on `marko/megastructure` | `591bc1df`'s **entire content is deleting a gate deferral row**; `46c971f5` invents a new `vendor_restock_step` exclusion **inside a merge resolution** (`++`, in neither parent) | not on `torus` — but is what a future merge from that branch would bring |

Honourable mentions that just missed the list: `b81cb65c` (Петушков, +404 "premium UI showcase"),
`7d243caf` ("pin 215499" — a check-count pin moved in a commit whose subject is about loot),
`f2215de2` ("unpark macro_bench … and deepen procedural material" — two unrelated things),
and the remaining 20 `chore: Overseer NN-min auto-push sweep [timestamp]` commits.

**Message-quality baseline.** 209 of 362 marko/Петушков commits (**58 %**) have a message body under
60 characters. Jirnyak: 19 of 211 (**9 %**). 26 of those bodyless marko commits move >300 lines.

---

## 11. THE 15 COMMITS WORTH KEEPING

| # | Hash | Date | Subject | Why it earns its place | Surviving lines |
|---:|---|---|---|---|---:|
| 1 | `224b7457` | 07-28 | `feat(game): loot and the greed loop — 446 items, depth-gated, pickable` | Created `data/items.csv` + `gen_item_table.py` + **`tools/check_source_rules.cmake` itself**. The CSV→header pipeline and the gate are the two things this repo runs on | 1 618 |
| 2 | `a7f1e217` | 07-29 | `feat(craft,quest,speech): the three ported modules themselves` | Largest surviving contribution in the repo; craft/quest/speech + three generators | **8 025** |
| 3 | `6b75c984` | 07-29 | `feat: Implement economy, monster traits, and cellular simulation` | *(also #24 on the worst list — bimodal.)* The economy half is load-bearing | 5 570 |
| 4 | `7ce71d54` | 07-29 | `feat: six more subsystems connected — consumption, fluid, room-aware spawning, monster behaviours, save travel, samosbor beats` | Wiring work with a real body explaining each hookup | 5 551 |
| 5 | `bd4db773` | 07-29 | `feat: seven dead subsystems wired, a save format, and a quantization bug that had silently deleted a monster` | The save format's ancestor; found and fixed a real data-loss bug | 4 535 |
| 6 | `3d35b761` | 07-29 | `feat: close the recycling ABA hole, make diffusion 2.2-7.8x faster, bound the …` | Genuine correctness + measured perf | 2 066 |
| 7 | `f1afa158` | 07-29 | `fix(gate): the source rules skipped every .inl — 10,468 lines of test code bypassed all of them` | **Gate hole worth more than most features.** 18 files / 530 KB were exempt from every rule; also added a positive-list cross-check so a new extension can't repeat it | 90 |
| 8 | `e2e8fbd6` | 07-29 | `test(gate): a suite nobody includes passes every rule in this file while asserting nothing` | Invented the unwired-suite guard; found `suite_navcache.inl` — 733 lines, 104 CHECKs, born dead. Proven in both polarities | 55 |
| 9 | `db26b698` | 07-29 | `fix(gate): my own unwired-suite guard required \`static\`, so one suite's 81 checks stayed invisible` | Audited his own new gate and published the hole. Rare behaviour, exactly right | 9 |
| 10 | `7c7f835b` | 07-29 | `test(audit): WILL_FAIL read one bit, so six of the seven pins guarded nothing` | Removed `WILL_FAIL` in favour of `PASS_REGULAR_EXPRESSION`; the reasoning is still quoted in `CMakeLists.txt:490-512` | 57 |
| 11 | `6e768657` | 07-28 | `fix: a phantom player per death, a table outside the gate, and a population that could only rise` | Three real shipped-code defects: `kill()` leaving `NpcPlayer` set, HUD showing high-water instead of alive, `weapons_ranged.csv` outside the drift gate | 176 |
| 12 | `8c3bb837` | 07-28 | `perf(nav): bake navigation off the main thread — no more multi-second floor freeze` | `src/world/nav_async.{cpp,h}`, alive in HEAD; a measured ~4 s freeze removed, with the degradation contract stated honestly | 180 |
| 13 | `0cb9f58d` | 07-29 | `feat(render): the world is drawn from photographs — 6/6 materials sampled` | `vk_texture.*` + the KTX2 pipeline; still the texture path | 974 |
| 14 | `9af5b79c` | 07-28 | `build(win): make the tree build on Windows/MSVC, green with zero warnings` | `tools/win/build.bat` + `tools/win/README.md`; the real multiplatform work (marko's, *not* Петушков's) | 346 |
| 15 | **B8 as a unit** (`89f61a19` `a39bddcd` `9a77b1c9` `5285c0d4` `2d7d9c47` `03f1ce57` `9453c2d7` `d7bef71e` `4ee37928` `d1d8b9f6` `15a6a924`) | 08-13→15 | toroidal-wrap and isotropy fixes, arbitrary camera up-vector, swapchain failure propagation, static scratch buffer | **11 commits, 145 lines, 97–99 % survival.** Surgical one-to-three-line fixes; the highest signal-per-line in his entire output. All committer=Jirnyak | 104+28+10 |

Also genuinely good but edged out: `cdf50b14` (utility AI + Velocity ownership audit, 1 482 lines
surviving), `d86c89ca` (macro_sim, 1 306), `1be3339e` (mob table, 1 312), `29b43ecb`
(investigate/noise, 1 477), `04e3e3ca` (samosbor, 1 540), `1402609c` (doors, 986), `77a3b593`
("the sim runs at 125 Hz and the docs said 120 — 21 stale claims", 160), `50b2851e`
("MSVC-verify the nav bake, fix silent globs, correct the /utf-8 claim", 88).

---

## 12. Loose ends still in HEAD (fix list)

| # | Item | Evidence | Severity |
|---:|---|---|---|
| 1 | **problems.md §10 falsely marked ЗАКРЫТА** | `use_a` empty for all 3 KEY rows; `Door::keycardTier` 4 reads / 0 writes | **high** |
| 2 | `check_wired.cmake` deferral for `cellular_step` is stale — the system was deleted 08-10 | `grep -rn cellular_step src/ tests/` → nothing | medium |
| 3 | `monster_traits`: ~2 100 lines, 12 of 22 exported functions unreachable | §7.1 | medium |
| 4 | Two parallel bank APIs (marko's test-only, Jirnyak's live) | §7.2 | medium |
| 5 | `AGENTS.md:16` mandates conformance to **`taste.md`, which does not exist** | `ls taste.md` → absent | medium |
| 6 | `AGENTS.md:17` hardcodes `C:\hades\gigahrush2` as a hard rule on a macOS project | `AGENTS.md:17` | medium |
| 7 | `README.md:12` credits the sockpuppet **"Adolf Petushkov"** as co-author | `README.md:12` | medium |
| 8 | `.agent_mem/sub_gigahrush2.mem.json` — marko's agent scratch, tracked at HEAD, from the 37 777-line junk commit | `git ls-tree -r HEAD` | low |
| 9 | **Three** GitHub-Pages deploy workflows (`pages.yml`, `static.yml`, `deploy-gh-pages.yml`) | `.github/workflows/` | low |
| 10 | 1 733-line marketing `index.html` + `sitemap.xml` + `site.webmanifest` + `favicon.svg` in an engine repo | `git ls-tree -r HEAD` | low |
| 11 | `src/game/ranged_pick.cpp` — no matching header, no file names it | §8 | low |
| 12 | 115 marko functions reachable only from `tests/` — a test suite that proves an API nobody uses | §7 | **structural** |
| 13 | If `origin/marko/megastructure` is ever merged it re-introduces the `vendor_restock_step` gate exclusion born inside merge `46c971f5` | §3.4 | **watch** |

### Recommended gate hardening (from what this audit had to hand-build)

`check_wired.cmake` catches 41 `_step`/`_tick` names. It missed all 68 unreachable functions in
section 7 and all 115 test-only ones. The cheap generalisation: **for every free function declared
in a `src/**/*.h`, require at least one caller outside its own translation unit and outside
`tests/`** — with the same "declare the deferral with a reason" mechanism. Run against HEAD it
would produce a list of 68 named debts instead of a comfortable `PASS`.
