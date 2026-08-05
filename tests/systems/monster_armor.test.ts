import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { applyMonsterArmorHit, ZAKALENNAYA_ARMATURA_ARMOR_STACKS } from '../../src/systems/monster_armor';
import { EntityType, MonsterKind, ProjType, Feature } from '../../src/core/types';
import type { Entity, GameState } from '../../src/core/types';
import { World } from '../../src/core/world';
import { createWorldEventState } from '../../src/systems/events';

// Mock World creator
function createMockWorld(): World {
  const world = new World(10, 10);
  return world;
}

// Mock GameState creator
function createMockGameState(): GameState {
  return {
    time: 100,
    msgs: [],
    msgLog: [], // Added msgLog
    clock: { totalMinutes: 0, hour: 0, minute: 0 },
    currentFloor: 1,
    worldEvents: createWorldEventState(),
  } as unknown as GameState;
}

// Mock Entity creator
function createMockEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 1,
    type: EntityType.MONSTER,
    x: 5,
    y: 5,
    alive: true,
    speed: 1,
    ...overrides,
  } as Entity;
}

describe('monster_armor', () => {
  it('calculates standard monster damage', () => {
    const world = createMockWorld();
    const state = createMockGameState();
    const monster = createMockEntity({ monsterKind: MonsterKind.ZOMBIE });

    const result = applyMonsterArmorHit(world, state, monster, { damage: 100 });

    assert.strictEqual(result.damage, 100);
    assert.strictEqual(result.armorActive, false);
    assert.strictEqual(result.armorStacks, 0);
    assert.strictEqual(result.stripped, false);
    assert.strictEqual(result.hitKind, 'weak');
  });

  it('calculates panelnik wall brace hit', () => {
    const world = createMockWorld();
    const state = createMockGameState();
    const monster = createMockEntity({ monsterKind: MonsterKind.PANELNIK });
    world.wallTex[world.idx(5, 4)] = 1; // Adjacent wall

    const result = applyMonsterArmorHit(world, state, monster, { damage: 100 });

    assert.strictEqual(result.armorActive, true);
    assert.strictEqual(result.armorStacks, 1);
    assert.strictEqual(result.stripped, false);
    assert.ok(result.damage < 100);
  });

  it('calculates chervie avatar armor hits', () => {
    const world = createMockWorld();
    const state = createMockGameState();
    const monster = createMockEntity({ x: 5, y: 5, monsterKind: MonsterKind.CHERVIE_AVATAR });

    // 1. Unpowered (no screen/apparatus nearby) + Weak hit
    const res1 = applyMonsterArmorHit(world, state, monster, { damage: 100 });
    assert.strictEqual(res1.damage, 100);
    assert.strictEqual(res1.armorActive, false);
    assert.strictEqual(res1.armorStacks, 0);

    // 2. Unpowered + Energy hit
    const res2 = applyMonsterArmorHit(world, state, monster, { damage: 100, projectileType: ProjType.BEAM });
    assert.strictEqual(res2.damage, 134); // Unpowered energy is 1.34 mult
    assert.strictEqual(res2.armorActive, false);
    assert.strictEqual(res2.armorStacks, 0);

    // Setup Power source exactly where it needs to be
    // Using index calculated by our test script that guarantees line-of-sight and range
    world.features[world.idx(5, 5)] = Feature.SCREEN;

    // 3. Powered + Weak hit
    const res3 = applyMonsterArmorHit(world, state, monster, { damage: 100 });
    assert.strictEqual(res3.damage, 56); // Powered non-energy is 0.56 mult
    assert.strictEqual(res3.armorActive, true);
    assert.strictEqual(res3.armorStacks, 1);

    // 4. Powered + Energy hit
    const res4 = applyMonsterArmorHit(world, state, monster, { damage: 100, projectileType: ProjType.BEAM });
    assert.strictEqual(res4.damage, 108); // Powered energy is 1.08 mult
    assert.strictEqual(res4.armorActive, false); // Energy pierces the armor entirely
    assert.strictEqual(res4.armorStacks, 0);
  });

  it('calculates zakalennaya armatura mechanics', () => {
    const world = createMockWorld();
    const state = createMockGameState();
    const monster = createMockEntity({ monsterKind: MonsterKind.ZAKALENNAYA_ARMATURA });

    // 1. Initial hit (Weak) -> chips armor but doesn't strip
    const res1 = applyMonsterArmorHit(world, state, monster, { damage: 100 });
    assert.strictEqual(res1.armorActive, true);
    assert.strictEqual(res1.armorStacks, 3);
    assert.strictEqual(res1.stripped, false);
    assert.ok(res1.damage < 100);

    // 2. Heavy hit -> immediately strips a stack if cooldown passed
    const res2 = applyMonsterArmorHit(world, state, monster, { damage: 100, projectileType: ProjType.GRENADE });
    assert.strictEqual(res2.armorActive, true);
    assert.strictEqual(res2.armorStacks, 2);
    assert.strictEqual(res2.stripped, true);
    assert.ok(res2.damage < 100); // Heavy hit damage mult is 0.68

    // 3. Heavy hit during cooldown -> doesn't strip
    const res3 = applyMonsterArmorHit(world, state, monster, { damage: 100, projectileType: ProjType.GRENADE });
    assert.strictEqual(res3.armorStacks, 2);
    assert.strictEqual(res3.stripped, false);

    // Advance time to pass cooldown
    state.time += 1.0;

    // 4. Multiple Weak hits to chip and strip
    monster.monsterArmorChip = 0; // Reset chip just in case
    // WEAK_CHIP_MULT is 0.07, threshold is 24. We need > 342 damage total
    applyMonsterArmorHit(world, state, monster, { damage: 200 });
    assert.strictEqual(monster.monsterArmorStacks, 2); // 14 chip, not enough

    const res4 = applyMonsterArmorHit(world, state, monster, { damage: 200 });
    assert.strictEqual(res4.armorStacks, 1); // 28 total chip > 24, stripped
    assert.strictEqual(res4.stripped, true);

    state.time += 1.0;

    // 5. Final strip
    const res5 = applyMonsterArmorHit(world, state, monster, { damage: 100, projectileType: ProjType.GRENADE });
    assert.strictEqual(res5.armorStacks, 0);
    assert.strictEqual(res5.stripped, true);

    state.time += 1.0;

    // 6. Hits on 0 stack
    const res6 = applyMonsterArmorHit(world, state, monster, { damage: 100 });
    assert.strictEqual(res6.armorStacks, 0);
    assert.strictEqual(res6.stripped, false);
    assert.strictEqual(res6.armorActive, false);
  });
});
