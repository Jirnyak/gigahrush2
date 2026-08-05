import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, MonsterKind, ProjType, Feature } from '../src/core/types';
import { World } from '../src/core/world';
import { applyMonsterArmorHit, ZAKALENNAYA_ARMATURA_ARMOR_STACKS } from '../src/systems/monster_armor';
import { makeGameState, makeTestEntity } from './helpers';

test('applyMonsterArmorHit passes full damage to generic unarmored monster', () => {
  const world = new World();
  const state = makeGameState();
  const target = makeTestEntity({ type: EntityType.MONSTER, monsterKind: MonsterKind.EYE });
  const attacker = makeTestEntity();

  const result = applyMonsterArmorHit(world, state, target, {
    damage: 50,
    attacker,
    weaponId: 'makarov',
  });

  assert.equal(result.damage, 50, 'generic monster should take full raw damage');
  assert.equal(result.armorActive, false, 'generic monster should not have active armor');
  assert.equal(result.armorStacks, 0);
  assert.equal(result.stripped, false);
});

test('applyMonsterArmorHit processes Chervie Avatar interactions correctly', () => {
  const world = new World();
  const state = makeGameState();
  const target = makeTestEntity({ type: EntityType.MONSTER, monsterKind: MonsterKind.CHERVIE_AVATAR });
  const attacker = makeTestEntity();

  // Test 1: Unpowered, Non-Energy (multiplier 1)
  const unpoweredKinetic = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });
  assert.equal(unpoweredKinetic.damage, 100, 'unpowered kinetic should take x1.0 damage');
  assert.equal(unpoweredKinetic.armorActive, false);
  assert.equal(unpoweredKinetic.armorStacks, 0);

  // Test 2: Unpowered, Energy (multiplier 1.34)
  const unpoweredEnergy = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'plasma',
  });
  assert.equal(unpoweredEnergy.damage, 134, 'unpowered energy should take x1.34 damage');
  assert.equal(unpoweredEnergy.armorActive, false);
  assert.equal(unpoweredEnergy.armorStacks, 0);

  // To simulate powered state, we need to add a screen/apparatus in range to the World, or we can just patch `chervieNetPowered` logic
  // Looking at `src/systems/monster_traits.ts`, `findChervieNetSource` searches within `CHERVIE_NET_SOURCE_RADIUS = 3`.
  // We can just add a `Feature.APPARATUS` to `world.features` at the entity's position.
  world.features[world.idx(Math.floor(target.x), Math.floor(target.y))] = Feature.APPARATUS;

  // Test 3: Powered, Non-Energy (multiplier 0.56)
  const poweredKinetic = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });
  assert.equal(poweredKinetic.damage, 56, 'powered kinetic should take x0.56 damage');
  assert.equal(poweredKinetic.armorActive, true, 'powered kinetic hit triggers active armor');
  assert.equal(poweredKinetic.armorStacks, 1);

  // Test 4: Powered, Energy (multiplier 1.08)
  const poweredEnergy = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'plasma',
  });
  assert.equal(poweredEnergy.damage, 108, 'powered energy should take x1.08 damage');
  assert.equal(poweredEnergy.armorActive, false, 'powered energy pierces armor');
  assert.equal(poweredEnergy.armorStacks, 0);
});

test('applyMonsterArmorHit processes Zakalennaya Armatura interactions correctly', () => {
  const world = new World();
  const state = makeGameState();
  const attacker = makeTestEntity();

  const WEAK_DAMAGE_MULT = 0.28;
  const HEAVY_DAMAGE_MULT = 0.68;
  const FINAL_STRIP_DAMAGE_MULT = 0.92;
  const WEAK_CHIP_THRESHOLD = 24;
  const WEAK_CHIP_MULT = 0.07;
  const STRIP_COOLDOWN_S = 0.18;

  // Helper to create a fresh target
  const makeTarget = () => makeTestEntity({
    type: EntityType.MONSTER,
    monsterKind: MonsterKind.ZAKALENNAYA_ARMATURA,
    monsterArmorStacks: ZAKALENNAYA_ARMATURA_ARMOR_STACKS,
    monsterArmorChip: 0,
    monsterArmorLastStripAt: -Infinity,
  });

  // Test 1: Weak Hit
  const targetWeak = makeTarget();
  const weakHit = applyMonsterArmorHit(world, state, targetWeak, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });

  assert.equal(weakHit.damage, Math.round(100 * WEAK_DAMAGE_MULT));
  assert.equal(weakHit.armorActive, true);
  assert.equal(weakHit.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS);
  assert.equal(weakHit.stripped, false);
  assert.equal(weakHit.hitKind, 'weak');
  assert.equal(targetWeak.monsterArmorChip, Math.min(WEAK_CHIP_THRESHOLD, 100 * WEAK_CHIP_MULT));

  // Test 2: Heavy Hit strips armor
  state.time = 10;
  const targetHeavy = makeTarget();
  const heavyHit = applyMonsterArmorHit(world, state, targetHeavy, {
    damage: 100,
    attacker,
    weaponId: 'shotgun',
  });

  assert.equal(heavyHit.damage, Math.round(100 * HEAVY_DAMAGE_MULT));
  assert.equal(heavyHit.armorActive, true);
  assert.equal(heavyHit.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS - 1);
  assert.equal(heavyHit.stripped, true);
  assert.equal(heavyHit.hitKind, 'heavy');
  assert.equal(targetHeavy.monsterArmorChip, 0);
  assert.equal(targetHeavy.monsterArmorLastStripAt, 10);

  // Test 3: Strip cooldown limits repeated heavy hits
  state.time = 10; // Same time as last strip
  const heavyHitCooldown = applyMonsterArmorHit(world, state, targetHeavy, {
    damage: 100,
    attacker,
    weaponId: 'shotgun',
  });

  assert.equal(heavyHitCooldown.stripped, false, 'hit within cooldown should not strip armor');
  assert.equal(heavyHitCooldown.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS - 1);

  // Test 4: Weak hits chipping past threshold trigger a strip
  state.time = 20;
  const targetChip = makeTarget();
  targetChip.monsterArmorChip = WEAK_CHIP_THRESHOLD - 1; // Just below threshold
  const chipHit = applyMonsterArmorHit(world, state, targetChip, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });

  assert.equal(chipHit.stripped, true, 'weak hit pushing chip past threshold should strip armor');
  assert.equal(chipHit.armorStacks, ZAKALENNAYA_ARMATURA_ARMOR_STACKS - 1);
  assert.equal(targetChip.monsterArmorChip, 0);

  // Test 5: Final strip state
  state.time = 30;
  const targetFinal = makeTarget();
  targetFinal.monsterArmorStacks = 1;
  const finalStripHit = applyMonsterArmorHit(world, state, targetFinal, {
    damage: 100,
    attacker,
    weaponId: 'shotgun',
  });

  assert.equal(finalStripHit.stripped, true);
  assert.equal(finalStripHit.armorStacks, 0);
  assert.equal(finalStripHit.damage, Math.round(100 * FINAL_STRIP_DAMAGE_MULT), 'final strip hit should use final strip mult');

  // Test 6: Hitting already fully stripped target
  state.time = 40;
  const targetExposed = makeTarget();
  targetExposed.monsterArmorStacks = 0;
  const exposedHit = applyMonsterArmorHit(world, state, targetExposed, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });

  assert.equal(exposedHit.damage, 100, 'exposed target should take incoming damage normally');
  assert.equal(exposedHit.armorActive, false);
  assert.equal(exposedHit.armorStacks, 0);
  assert.equal(exposedHit.stripped, false);
});

test('applyMonsterArmorHit categorizes hit kinds correctly', () => {
  const world = new World();
  const state = makeGameState();
  const target = makeTestEntity({ type: EntityType.MONSTER, monsterKind: MonsterKind.ZAKALENNAYA_ARMATURA });
  const attacker = makeTestEntity();

  // Tool weapon test
  const toolHit = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'jackhammer',
  });
  assert.equal(toolHit.hitKind, 'tool');

  // Heavy weapon test
  const heavyWeaponHit = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'shotgun',
  });
  assert.equal(heavyWeaponHit.hitKind, 'heavy');

  // AOE heavy test
  const aoeHit = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'makarov', // usually weak
    aoe: true,
  });
  assert.equal(aoeHit.hitKind, 'heavy', 'AOE should override weak weapon to heavy');

  // Projectile heavy test
  const projHit = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'makarov', // usually weak
    projectileType: ProjType.GRENADE,
  });
  assert.equal(projHit.hitKind, 'heavy', 'specific projectiles should override weak weapon to heavy');

  // Weak weapon test
  const weakHit = applyMonsterArmorHit(world, state, target, {
    damage: 100,
    attacker,
    weaponId: 'makarov',
  });
  assert.equal(weakHit.hitKind, 'weak');
});
