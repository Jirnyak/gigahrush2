# Test Suite Ready: Utility AI & Room Navigation (R1, R2, R3 - Tiers 1 to 4)

- **Total Test Checks**: 235,282 (+91 checks added)
- **Total Failures**: 0
- **Status**: PASSED (100% test pass rate via CTest and `build\Release\game_test.exe`)

## Test Coverage Summary

### Tier 1: RoleId Enum & RoleTraits Matrix Validation (R1)
- Verified `RoleId` enum values (`Resident` = 0, `Duty` = 1, `Medic` = 2, `Looter` = 3, `Cultist` = 4, `kRoleCount` = 5).
- Verified `RoleTraits` struct fields and exact 5x7 `kRoleTraits` matrix entries for all 5 roles (`workDrive`, `patrolDrive`, `sociability`, `scavengeDrive`, `careDrive`, `homeRooms`, `workRooms`).
- Verified `role_traits(RoleId)` accessor and bounds-safety fallbacks for out-of-bounds RoleIds (`RoleId(5)`, `RoleId(255)` -> `Resident`).

### Tier 2: Room Affordances & Bit Mask Filtering (R2)
- Verified `kRoomAffordance` mappings for `IntentWork` (`Production` | `Office` | `Hq`), `IntentSocial` (`Common` | `Smoking`), `IntentPatrol` (`Corridor`), `IntentHeal` (`Medical`), `IntentEat`/`Drink` (`Kitchen`), `IntentToilet` (`Bathroom`), `IntentSleep` (`Living`).
- Verified bitwise intent room mask filtering for each role (`homeRooms`, `workRooms`).
- Verified Looter `homeRooms = 0` zeroing behavior during `IntentSleep` (forcing sleep destination mask to 0, which delegates steering to `wander_step`).

### Tier 3: Multiplicative & Additive Threat-Dampened Scoring (R3)
- Verified multiplicative scaling in `score_intents` by `RoleTraits` (`workDrive`, `patrolDrive`, `sociability`) across roles.
- Verified additive scavenge drive term (`scavengeDrive * localScore[IntentWork] * (1 - threat)`): maximum boost under `threat = 0.0f`, completely nullified (0.0f boost) under `threat = 1.0f`.
- Verified additive care drive term (`careDrive * nearbyWounded01 * (1 - threat)`): maximum boost under `threat = 0.0f` for Medic with wounded allies, completely nullified (0.0f boost) under `threat = 1.0f`.

### Tier 4: Full NPC Cycle & Behavioural Scenarios (R1, R2, R3)
- **Medic Healing vs High Threat Suppression**: Medic selects `IntentHeal` in calm 0 threat environment; switches to `IntentFlee`/`IntentSafety` under high threat (`threat = 1.0f`).
- **Duty Guard Patrol Weighting**: Duty guard high `patrolDrive` (1.00) causes `IntentPatrol` to outscore resident work/social intents.
- **Looter Sleep Anywhere & Scavenging Drive**: Verified `ai_step` execution where Looter with `homeRooms = 0` gets `roomOwned = 0` and `wanderOwned = 1`, delegating motion to `wander_step`.

## File Modifications
- `tests/suite_utilai.inl`: Added Blocks 19, 20, 21, 22 covering Tiers 1-4.
- `tests/suite_rooms.inl`: Added Tier 2 role room mask filtering checks.
- `CMakeLists.txt`: Updated `PASS_REGULAR_EXPRESSION` check count pin to `235282`.
