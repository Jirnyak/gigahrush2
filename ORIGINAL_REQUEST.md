# Original User Request

## Initial Request — 2026-08-12T20:31:22Z

# Teamwork Project Prompt — Draft

> Status: Step 9 — Assembled and Validated — Awaiting user approval
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Project: Implement NPC Body Ownership and Room Navigation for Utility AI based on `Docs/specs/01_ALIFE_AND_UTILITY_AI.md`. The agent team will wire the existing RoomZones mask (`homeRooms`, `workRooms`) into the AI intent system so that `IntentSleep`, `IntentEat`, and `IntentWork` can successfully navigate to specific rooms instead of aimlessly wandering.

Working directory: `C:/hades/gigahrush2`
Integrity mode: development

## Requirements

### R1. Role Traits Implementation
Define `RoleId` (Resident, Duty, Medic, Looter, Cultist, etc.) and `RoleTraits` struct containing `homeRooms`, `workRooms` (as RoomBit masks), and drive multipliers (`workDrive`, `patrolDrive`, `sociability`, `scavengeDrive`, `careDrive`). Update the NPC component definition to store these.

### R2. AI Intent Mask Wiring
Update the intent-to-room mapping (e.g. `kIntentRooms`) in the AI system so that `IntentWork`, `IntentSocial`, `IntentPatrol`, and `IntentHeal` correspond to the correct `RoomBit` masks (e.g., `RoomBit::Medical` for `IntentHeal`), ensuring the pre-baked navigation can route NPCs to them.

### R3. Score Adjustments
Modify `score_intents` in `src/game/ai.cpp` to scale base intent scores by the NPC's `RoleTraits` multipliers, and add the additive terms for `IntentWork` (scavenging) and `IntentHeal` (care), respecting the current threat level constraint `(1 - threat)`.

## Acceptance Criteria

### Role Integration
- [ ] `RoleId` enum is defined and correctly stored per NPC in the ECS.
- [ ] AI intent scoring successfully reads the NPC's `RoleTraits` multipliers and scales `IntentWork`, `IntentPatrol`, and `IntentSocial`.

### Room Navigation
- [ ] NPCs driven by `IntentSleep` no longer delegate to `wander_step` but successfully steer toward their designated `homeRooms` using the generated navigation fields.
- [ ] `IntentWork` and `IntentHeal` correctly map to their specified room bits and drive steering when triggered.
