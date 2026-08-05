import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  xpForLevel,
  totalXpForLevel,
  clampRpgLevel,
  clampRpgAttribute,
  getLevelHp,
  getLevelPsi,
  freshRPG,
  randomRPG,
  getMaxPsi,
  getMaxHp,
  strMeleeDmgMult,
  agiSpeedMult,
  agiAttackSpeedMult,
  intXpMult,
  rpgStatEffects,
  rpgStatEffectsAfterSpend,
  awardXP,
  spendAttrPoint,
  xpForMonsterKill,
  xpForNpcKill,
  calcZoneLevel,
  scaleMonsterHp,
  scaleMonsterDmg,
  scaleMonsterSpeed,
  questDifficulty,
  questXpReward,
  questMoneyReward,
  RPG_LEVEL_CAP,
  RPG_ATTRIBUTE_CAP
} from '../src/systems/rpg';

import { Entity, EntityType, MonsterKind, FloorLevel, Msg } from '../src/core/types';
import { W } from '../src/core/types';

function makeMockEntity(rpg = freshRPG(1)): Entity {
  return {
    id: 1,
    type: EntityType.NPC,
    persistentNpcId: 'mock',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    rpg,
  };
}

test('XP calculations correctly scale with level', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 100);
  assert.equal(xpForLevel(5), 295); // 75 + 25*4 + 10*4*3 = 75 + 100 + 120 = 295

  assert.equal(totalXpForLevel(1), 0);
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(3), 100 + (75 + 25*2 + 10*2*1)); // 100 + 75 + 50 + 20 = 245
});

test('RPG stat creation and bounding works correctly', () => {
  const fresh = freshRPG(1);
  assert.equal(fresh.level, 1);
  assert.equal(fresh.xp, 0);
  assert.equal(fresh.attrPoints, 0);
  assert.equal(fresh.str, 0);
  assert.equal(fresh.agi, 0);
  assert.equal(fresh.int, 0);

  const cappedFresh = freshRPG(1000);
  assert.equal(cappedFresh.level, RPG_LEVEL_CAP);

  const random = randomRPG(5);
  assert.equal(random.level, 5);
  assert.equal(random.str + random.agi + random.int, 4); // 4 attr points for level 5

  assert.equal(clampRpgLevel(-5), 1);
  assert.equal(clampRpgLevel(RPG_LEVEL_CAP + 10), RPG_LEVEL_CAP);
  assert.equal(clampRpgAttribute(-10), 0);
  assert.equal(clampRpgAttribute(RPG_ATTRIBUTE_CAP + 5), RPG_ATTRIBUTE_CAP);
});

test('Core getters scale correctly with level and stats', () => {
  assert.equal(getLevelHp(1), 100);
  assert.equal(getLevelHp(2), 101); // 100 + 1*(2-1)

  assert.equal(getLevelPsi(1), 100);
  assert.equal(getLevelPsi(3), 102);

  const rpg = freshRPG(1);
  rpg.str = 10;
  assert.equal(getMaxHp(rpg), Math.round(100 * (1 + 10 * 0.01))); // 110

  rpg.int = 20;
  assert.equal(getMaxPsi(rpg), Math.round(100 * (1 + 20 * 0.01))); // 120
});

test('RPG stat effects compute the correct multipliers', () => {
  const rpg = freshRPG(1);
  rpg.str = 5;
  rpg.agi = 10;
  rpg.int = 15;

  const effects = rpgStatEffects(rpg);

  // STR
  assert.equal(effects.maxHp, getMaxHp(rpg));
  assert.equal(effects.meleeDamageMult, strMeleeDmgMult(rpg));

  // AGI
  assert.equal(effects.moveSpeedMult, agiSpeedMult(rpg));
  assert.equal(effects.attackCooldownMult, agiAttackSpeedMult(rpg));

  // INT
  assert.equal(effects.maxPsi, getMaxPsi(rpg));
  assert.equal(effects.xpMult, intXpMult(rpg));

  // Test effects after spend
  const afterSpendStr = rpgStatEffectsAfterSpend(rpg, 'str');
  const tempRpg = { ...rpg, str: rpg.str + 1 };
  assert.equal(afterSpendStr.maxHp, getMaxHp(tempRpg));
  assert.equal(afterSpendStr.meleeDamageMult, strMeleeDmgMult(tempRpg));
});

test('awardXP processes XP and levels up correctly', () => {
  const entity = makeMockEntity(freshRPG(1));
  const msgs: Msg[] = [];

  // Initial award, no level up
  awardXP(entity, 50, msgs, 0);
  assert.equal(entity.rpg!.level, 1);
  assert.equal(entity.rpg!.xp, 50);

  // Level up to 2 (needs 100)
  awardXP(entity, 60, msgs, 0);
  assert.equal(entity.rpg!.level, 2);
  assert.equal(entity.rpg!.xp, 10); // 50 + 60 - 100
  assert.equal(entity.rpg!.attrPoints, 1);

  // Multiple level ups
  awardXP(entity, totalXpForLevel(5) - totalXpForLevel(2), msgs, 0);
  assert.equal(entity.rpg!.level, 5);
  assert.equal(entity.rpg!.attrPoints, 4);

  // Reaching level cap
  awardXP(entity, 999999999, msgs, 0);
  assert.equal(entity.rpg!.level, RPG_LEVEL_CAP);
  assert.equal(entity.rpg!.xp, 0);
});

test('awardXP scales with INT multiplier', () => {
  const entity = makeMockEntity(freshRPG(1));
  entity.rpg!.int = 10;
  const msgs: Msg[] = [];

  const expectedBonus = intXpMult(entity.rpg!); // > 1.0
  const baseXP = 50;
  const actualXP = Math.round(baseXP * expectedBonus);

  awardXP(entity, baseXP, msgs, 0);
  assert.equal(entity.rpg!.xp, actualXP);
});

test('spendAttrPoint works correctly and updates maxHp/maxPsi', () => {
  const entity = makeMockEntity(freshRPG(1));
  entity.rpg!.attrPoints = 2;

  assert.equal(spendAttrPoint(entity, 'str'), true);
  assert.equal(entity.rpg!.str, 1);
  assert.equal(entity.rpg!.attrPoints, 1);
  assert.equal(entity.maxHp, getMaxHp(entity.rpg!));

  assert.equal(spendAttrPoint(entity, 'int'), true);
  assert.equal(entity.rpg!.int, 1);
  assert.equal(entity.rpg!.attrPoints, 0);
  assert.equal(entity.rpg!.maxPsi, getMaxPsi(entity.rpg!));

  // No points left
  assert.equal(spendAttrPoint(entity, 'agi'), false);
  assert.equal(entity.rpg!.agi, 0);
});

test('Monster and NPC kill XP calculate correctly', () => {
  // xpForMonsterKill
  const baseTvar = xpForMonsterKill(MonsterKind.TVAR, 1);
  assert.equal(baseTvar, 50); // From MONSTER_BASE_XP

  const higherTvar = xpForMonsterKill(MonsterKind.TVAR, 5);
  assert.equal(higherTvar, Math.round(50 * (1 + 0.22 * 4)));

  // xpForNpcKill
  assert.equal(xpForNpcKill(1), 10);
  assert.equal(xpForNpcKill(5), Math.round(10 * (1 + 0.22 * 4)));
});

test('calcZoneLevel returns appropriate zone level based on coordinates and floor', () => {
  const ZONE_CELL = Math.floor(W / 8);
  const centerX = 3.5 * ZONE_CELL;
  const centerY = 3.5 * ZONE_CELL;

  // Center zone, base level should be 1
  assert.equal(calcZoneLevel(centerX, centerY, FloorLevel.LIVING), 1);

  // Corner zone, distance should increase level
  const cornerLevel = calcZoneLevel(0, 0, FloorLevel.LIVING);
  assert.ok(cornerLevel > 1);

  // Floor bonuses
  assert.equal(calcZoneLevel(centerX, centerY, FloorLevel.MAINTENANCE), 1 + 4);
  assert.equal(calcZoneLevel(centerX, centerY, FloorLevel.HELL), 1 + 9);
  assert.equal(calcZoneLevel(centerX, centerY, FloorLevel.VOID), 1 + 15);
});

test('Monster scaling scales stats by level', () => {
  assert.equal(scaleMonsterHp(100, 1), 100);
  assert.equal(scaleMonsterHp(100, 5), Math.round(100 * (1 + 0.12 * 4)));

  assert.equal(scaleMonsterDmg(20, 1), 20);
  assert.equal(scaleMonsterDmg(20, 5), Math.round(20 * (1 + 0.10 * 4)));

  assert.equal(scaleMonsterSpeed(1.5, 1), 1.5);
  assert.equal(scaleMonsterSpeed(1.5, 5), 1.5 * (1 + 0.02 * 4));
});

test('Quest difficulty and rewards calculate correctly', () => {
  const itemValue = 60;
  const distance = 200;
  const questTypeBase = 1.5;

  const diff = questDifficulty(itemValue, distance, questTypeBase);
  const valueMod = 1 + 60 / 30; // 3.0
  const distMod = 1 + 200 / 100; // 3.0
  const expectedDiff = Math.round((1.5 * 3.0 * 3.0) * 10) / 10;
  assert.equal(diff, expectedDiff);

  assert.equal(questXpReward(diff), Math.round(20 * diff));
  assert.equal(questMoneyReward(diff), Math.round(5 * diff));
});
