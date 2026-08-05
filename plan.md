1. **Add `hp` and `maxHp` to `Door` interface in `src/core/types.ts`**:
   - Add `hp?: number;` and `maxHp?: number;` to the `Door` interface (around line 173).

2. **Handle saving/loading `hp` and `maxHp` in `src/systems/floor_memory.ts`**:
   - Modify `sanitizeDoorEntries` to parse `hp` and `maxHp` from the `raw` object, validating they are finite numbers (or undefined). `hp` can be <= 0 if destroyed (though it should be open then, but just in case), and `maxHp` > 0.

3. **Implement `damageDoor` logic in a new export or existing file (e.g. `src/systems/door_state.ts`)**:
   - Create a `damageDoor(world: World, door: Door, amount: number, msgs: any[], time: number, state: GameState)` function.
   - If `door.maxHp` is undefined, initialize it based on the door type (HERMETIC=500, LOCKED/METAL=150, WOOD/others=50). Set `door.hp` = `door.maxHp`.
   - Subtract `amount` from `door.hp`.
   - If `door.hp <= 0`, set state to `DoorState.OPEN`, `world.cellVersion++` (to trigger nav tree rebuild), and call `world.markCellsDirty()`. Also push a message to `msgs` like `"Дверь выбита!"`.

4. **Add melee hit detection for doors in `src/main.ts`**:
   - In the melee attack logic (around line 2980), after checking for `meleeTarget`, if no entity is hit (`!hitSomething`), calculate the cell index the player is facing (using `ax, ay`).
   - If that cell is `Cell.DOOR`, retrieve the door from `world.doors`.
   - Call `damageDoor` with the melee damage (`normalDmg`). Play a hit sound (e.g., `playBreak` or generic hit). Set `hitSomething = true` so durability is consumed.

5. **Add E action (interact) bash for locked/hermetic doors in `src/systems/interactions.ts`**:
   - In `activateDoor`, when the door is `HERMETIC_CLOSED` and locked by Samosbor, or `LOCKED` and the player doesn't have the key, apply a small amount of damage (e.g. 5) by calling `damageDoor`.
   - E.g., player kicks the door when interacting without a key.

6. **Visuals in `src/render/webgl.ts` (Cracks on low HP)**:
   - "при door.hp < door.maxHp * 0.5 — рисовать текстуру с трещинами (модифицировать UV или overlay)".
   - Update `rebuildDoorStates` to pack the "cracked" state into the highest bit of the 8-bit integer:
     `const isCracked = door.hp !== undefined && door.maxHp !== undefined && door.hp < door.maxHp * 0.5;`
     `out[ci] = door.state | (isCracked ? 128 : 0);`
   - In the shader, unpack it in `sampleDoor` and `lightBoundary` using `& 127u`.
   - In the rendering loop (DDA), read the top bit to determine `isCracked`. Pass this information along, or recalculate it. Actually, `uDoorStates` is read during DDA and `wallTexId` is assigned. We can also set a boolean `crackedDoor = (rawDoorState & 128u) != 0u;`.
   - In the fragment coloring section, if `crackedDoor` is true, mix the texture color `c` with a darker color based on a procedural noise pattern (e.g. `noiseI` or `fract`) to simulate cracks.

7. **Pre-commit step**:
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
