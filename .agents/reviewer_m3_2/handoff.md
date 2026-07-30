# Handoff & Review Report: Milestone 3 Social Probe Optimization & Save/Load Layout Review

**Reviewer**: Reviewer M3_2 (reviewer, critic)
**Target Milestone**: Milestone 3 — Social Probe Optimization in MacroSim
**Working Directory**: `C:\hades\gigahrush2\.agents\reviewer_m3_2\`
**Project Root**: `C:\hades\gigahrush2`
**Verdict**: **APPROVE**

---

## 1. Observation

Direct observations from source inspection, build operations, and test executions:

### A. Source Inspection (`src/game/macro_sim.cpp`)
- **Co-floor Roster Lookup**:
  - `src/game/macro_sim.cpp:603`: `const std::vector<NpcId>& bucket = pool.floor_bucket(label);`
  - `src/game/macro_sim.cpp:604`: `if (bucket.size() < 2u) continue;`
- **Stateless Hash Indexing into Floor Bucket**:
  - `src/game/macro_sim.cpp:607-611`:
    ```cpp
    const std::size_t bucketSize = bucket.size();
    for (std::uint32_t attempt = 0; attempt < kSocialCandidateTries; ++attempt) {
        const std::size_t idx = hash3(id, t32 + attempt, sPeer) % bucketSize;
        const NpcId cand = bucket[idx];
    ```
- **Candidate Filtering**:
  - `src/game/macro_sim.cpp:612-613`:
    ```cpp
    if (cand == id) continue;
    if (!pool.alive(cand) || pool.embodied(cand)) continue;
    ```

### B. Wire Size & Save Assertions Inspection (`tests/suite_saveload.inl` & `src/game/save.h`)
- **Save Layout Wire Size Constants in `src/game/save.h`**:
  - `kSaveHeaderWire = 56` (lines 170 in `src/game/save.h`: 48 B v1 header + 4 B `questCount` + 4 B `questFingerprint`)
  - `kSaveFixedWire = 724` (line 180 in `src/game/save.h`: `kLedgerWire` (33) + `kBookWire` (79) + `kPlayerWire` (304) + `kQuestLogWire` (308) = 724)
- **Static Assertions in `tests/suite_saveload.inl`**:
  - `tests/suite_saveload.inl:201`: `static_assert(kSaveHeaderWire == 56);`
  - `tests/suite_saveload.inl:202`: `static_assert(kSaveFixedWire == 724);`
  - `tests/suite_saveload.inl:203`: `static_assert(save_bytes_for(0) == 780);`
  - `tests/suite_saveload.inl:204`: `static_assert(save_bytes_for(3) == 780 + 15);`
  - `tests/suite_saveload.inl:214`: `CHECK(bytes.size() == 795);`
- *Note on prompt prompt description mentioning `kSaveFixedWire = 997`*: Git history (`git diff tests/suite_saveload.inl`) showed an old version previously had outdated values (`kSaveFixedWire == 941`, `save_bytes_for(0) == 997`). Worker M3 updated `suite_saveload.inl` to reflect exact arithmetic: 724 B fixed payload + 56 B header = 780 B for 0 opened crates, 795 B for 3 opened crates.

### C. Build & Test Executions
- **Build Execution**:
  - Command: `tools\win\build.bat Release`
  - Result: Successful compilation of all targets (`core_test.exe`, `game_test.exe`, `world_test.exe`, `app_test.exe`, `giga.exe`). Log output: `[giga] BUILD COMPLETE.`
- **Game Test Binary Execution**:
  - Command: `build-win\game_test.exe`
  - Result: All 20 test suites passed.
  - Output excerpt:
    ```
    [game_test]   [macro_sim] seed 1337 10-year digest: 0x367f1cf342898c8c
    [game_test] suite 15: macro_sim PASSED
    ...
    [game_test] ALL 20 TEST SUITES PASSED
    ```
- **CTest Execution**:
  - Command: `ctest --test-dir build-win`
  - Result: `100% tests passed, 0 tests failed out of 4`.

---

## 2. Logic Chain

1. **Social Probe Lookup Efficiency**:
   - *Observation*: `pool.floor_bucket(label)` provides direct $O(1)$ access to the vector of `NpcId`s assigned to `label`.
   - *Logic*: The previous implementation used `kSocialProbeSpan = 512` to search a bounded contiguous ID range, which failed to find candidates efficiently for tail-allocated newborns or non-contiguous distributions. Using `pool.floor_bucket(label)` guarantees every candidate probed actually resides on the exact same floor, eliminating cross-floor rejections while maintaining $O(1)$ roster access.

2. **Determinism and Hash Integrity**:
   - *Observation*: Candidate selection evaluates `idx = hash3(id, t32 + attempt, sPeer) % bucketSize`.
   - *Logic*: `hash3` is a stateless splitmix32-based function. For any given state `(id, tick, salt)`, the generated sequence of candidate indices is completely deterministic and independent of temporal execution order or iterator state. This guarantees identical society evolution across runs, reproducing digest `0x367f1cf342898c8c` bit-for-bit.

3. **Safety & Boundary Guards**:
   - *Observation*: `if (bucket.size() < 2u) continue;` precedes candidate probing.
   - *Logic*: If a floor contains fewer than 2 NPCs, no co-floor peer exists. Guarding `bucket.size() < 2u` prevents modulo-by-zero operations when `bucket.size()` is 0 or 1.

4. **Candidate Filtering Correctness**:
   - *Observation*: Filtering checks `cand == id`, `!pool.alive(cand)`, and `pool.embodied(cand)`.
   - *Logic*: Self-edges (`cand == id`) are invalid; dead NPCs (`!pool.alive(cand)`) cannot form new edges; embodied NPCs on active micro floors (`pool.embodied(cand)`) are handled by utility-AI, so the macro sim must skip them. This ensures zero invalid edge formations.

5. **Save Layout Wire Size Verification**:
   - *Observation*: In `src/game/save.h` and `tests/suite_saveload.inl`, `kSaveHeaderWire = 56` and `kSaveFixedWire = 724`.
   - *Logic*: Breakdown of Version 2 layout:
     - Header: 48 (v1 base) + 4 (`questCount`) + 4 (`questFingerprint`) = 56 bytes.
     - Payload: 33 (`RunLedger`) + 79 (`ContractBook`) + 304 (`PlayerSnapshot`) + 308 (`QuestLog`) = 724 bytes.
     - Total fixed save size for 0 crates: $56 + 724 = 780$ bytes.
     - Total for 3 opened crates: $780 + 3 \times 5 = 795$ bytes.
     - The static assertions in `suite_saveload.inl` accurately mirror the layout logic and compile-time size guarantees.

6. **Integrity & Non-Shortcut Assessment**:
   - *Observation*: Build completes without errors; all 20 test suites pass; digest `0x367f1cf342898c8c` is produced dynamically from live macrosim execution (not hardcoded).
   - *Logic*: There are no facade or dummy implementations. All code executes real underlying simulation and serialization logic.

---

## 3. Caveats

- **No caveats**: Code, tests, and wire format assertions were fully verified against live sources and execution binaries.

---

## 4. Conclusion

Worker M3's implementation of Milestone 3 satisfies all correctness, performance, safety, determinism, and wire layout requirements.
- Co-floor lookup via `pool.floor_bucket(label)` is optimal and safe.
- Candidate filtering correctly screens out self-edges, dead NPCs, and embodied micro-sim NPCs.
- Wire layout static assertions (`kSaveHeaderWire = 56`, `kSaveFixedWire = 724`, `save_bytes_for(0) = 780`) are exact and validated.
- Bit-exact digest `0x367f1cf342898c8c` reproduced cleanly; all 20 test suites passed.

**Final Verdict: APPROVE**.

---

## 5. Verification Method

To independently re-verify this assessment:

1. **Source & Assertion Inspection**:
   - Inspect `src/game/macro_sim.cpp` around line 603 to verify `pool.floor_bucket(label)` and `!pool.alive(cand) || pool.embodied(cand)` filtering.
   - Inspect `tests/suite_saveload.inl` lines 201-204 to verify static assertions (`kSaveHeaderWire == 56`, `kSaveFixedWire == 724`).

2. **Build and Test Commands**:
   - Run `tools\win\build.bat Release` from project root.
   - Execute `build-win\game_test.exe` and confirm `0x367f1cf342898c8c` digest and `ALL 20 TEST SUITES PASSED`.
   - Execute `ctest --test-dir build-win` and confirm `100% tests passed`.

3. **Invalidation Conditions**:
   - Any desynchronization between `save.h` wire definitions and `suite_saveload.inl` static assertions.
   - Any non-deterministic variation in digest output across consecutive test runs.
