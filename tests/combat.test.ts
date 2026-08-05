import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { calculateDamage } from '../src/systems/combat';
import { Entity, EntityType, Faction, DamageType } from '../src/core/types';

function makeTarget(armorDefId?: string): Entity {
  return {
    id: 1, type: EntityType.NPC, x: 0, y: 0, angle: 0, pitch: 0, alive: true,
    hp: 10, maxHp: 10, speed: 1, sprite: 0,
    faction: Faction.CITIZEN, weapon: '', armorDefId
  };
}

test('calculateDamage does not reduce damage when armor is empty', () => {
  assert.equal(calculateDamage(10, DamageType.KINETIC, makeTarget()), 10);
});

test('calculateDamage applies percentage resistance from armor', () => {
  // armor_medium has 40 KINETIC resist -> 10 * (100-40)/100 = 6
  assert.equal(calculateDamage(10, DamageType.KINETIC, makeTarget('armor_medium')), 6);
});

test('calculateDamage handles zero damage', () => {
  assert.equal(calculateDamage(0, DamageType.KINETIC, makeTarget('armor_medium')), 0);
});

test('calculateDamage returns unmodified damage when damageType is undefined', () => {
  assert.equal(calculateDamage(15, undefined, makeTarget('armor_medium')), 15);
});
