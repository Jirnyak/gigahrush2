import { test, describe } from 'node:test';
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

describe('calculateDamage', () => {
  test('calculates normal damage correctly', () => {
    assert.equal(calculateDamage(10, DamageType.KINETIC, makeTarget()), 10);
  });

  test('clamps damage to 0 when negative', () => {
    assert.equal(calculateDamage(-10, DamageType.KINETIC, makeTarget()), 0);
  });

  test('handles zero values correctly', () => {
    assert.equal(calculateDamage(0, DamageType.KINETIC, makeTarget()), 0);
  });
});
