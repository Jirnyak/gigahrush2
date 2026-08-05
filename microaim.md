# Micro-Goals and Sub-Goal Interruption Architecture

> Центральный документ, описывающий систему микро-целей для NPC в ГИГАХРУЩЕ.

This document describes the Micro-Goal system (MicroAIM), the short-term interruption architecture for A-Life AI entities. It is aligned with the data-oriented philosophy described in `AGENTS.md` and `README.md`.

## 1. Overview and Intent
NPCs run a continuous utility scoring loop (`npc_utility.ts` and `npc_fsm.ts`) that evaluates long-term survival and routine intents (e.g., `wander`, `work`, `safety`, `sleep`). However, they also need to react dynamically to immediate stimuli without tearing down their long-term pathfinding or losing state.

The Micro-Goal System (`src/systems/ai/micro_goals.ts`) solves this by acting as a **high-priority overlay**. When a micro-goal triggers, it interrupts the normal `updateNPC` routine execution, freezing the primary path and state timer until the micro-goal completes or times out.

## 2. Core Data Structures

The state is stored in the `AIState` (inside `src/core/types.ts`):

```typescript
export interface AIState {
  // ... (primary routine properties)
  
  // -- Micro-Goal Subsystem --
  microGoalId?: string;           // Active micro-goal identifier (e.g., 'greet', 'investigate_noise')
  microTargetX?: number;          // Spatial target of the micro-goal
  microTargetY?: number;
  microTimer?: number;            // TTL/duration of the active micro-goal
  microSourceId?: number;         // Entity ID related to the goal
  microCooldowns?: Record<string, number>; // Cooldowns to prevent spamming
}
```

## 3. Supported Micro-Goals & Priorities
Micro-goals override each other based on priority. The current supported signals and priorities are:
- `pack_pulse` (Priority 50): Sync with A-Life packs.
- `search_lkp` (Priority 40): Search Last Known Position of a hostile.
- `investigate_noise` (Priority 30): Walk towards a suspicious sound.
- `greet` (Priority 20): Stop and face another NPC.
- `reposition` (Priority 10): Move short distances in combat/idle.
- `loot_nearby` (Priority 5): Walk to a nearby item drop and pick it up.

## 4. Execution Flow (`tickMicroGoal`)

At the beginning of each tick in `updateNPC` (within `npc_fsm.ts`):
1. `evaluateMicroStimuli` runs. It scans for noise, nearby items, or nearby NPCs. If a condition is met and its cooldown is clear, it calls `trySetMicroGoal`.
2. `trySetMicroGoal` compares the new priority against the active `microGoalId`. If it's higher, it overwrites the state and clears the current entity steering path (to halt long-term movement).
3. `tickMicroGoal` executes. It decrements the `microTimer`. If the timer reaches 0, the goal is cleared.
4. If a micro-goal is active, `tickMicroGoal` performs specific logic (e.g., steering towards `microTargetX`/`Y` or facing the target for `greet`).
5. **Crucially**, if `tickMicroGoal` returns `true`, the `updateNPC` function returns early. This effectively freezes the main intent evaluation (`handleToilet`, `handleWander`, etc.).

## 5. Interaction with Markov Barks
Micro-goals heavily utilize the `emitMarkovBark` system to verbalize intent:
- `investigate_noise`: Triggers `emitMarkovBark` with intent `alert`.
- `greet`: Triggers `emitMarkovBark` with intent `ambient`.

Because micro-goals prevent normal ambient barks from firing during their execution, these direct `emitMarkovBark` calls act as contextual dialogue anchors, replacing the deprecated `CONTEXT_LINES` hardcoded system.

## 6. Integration Contract
- **Do not** add complex pathfinding BFS to micro-goals. They use direct `steerEntityTowardCell` for localized movement.
- **Do not** use micro-goals for states that last more than 10-15 seconds. If an action requires long-term commitment, it should be a proper utility intent in `npc_utility.ts`.
- **Combat Immunity:** If `ai.combatTargetId` is active, or if the primary goal is `FLEE` or `HIDE`, `trySetMicroGoal` will automatically reject all non-combat micro-goals to prevent suicidal distractions.
