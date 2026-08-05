import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { DEF as LAMPOVY_DEF } from '../src/entities/lampovy';

test('lampovy remains a light-context monster, not a generic fast melee enemy', () => {
  assert.equal(LAMPOVY_DEF.kind, MonsterKind.LAMPOVY);
  assert.deepEqual(LAMPOVY_DEF.aiFlags, ['lampPowered']);
  assert.ok(LAMPOVY_DEF.speed < 1.8, 'lampovy should not rely on chase speed for danger');
  assert.ok(LAMPOVY_DEF.counterplay?.includes('три клетки'));
  assert.ok(LAMPOVY_DEF.counterplay?.includes('ламп'));
  assert.ok(LAMPOVY_DEF.counterplay?.includes('угол'));
  assert.ok(LAMPOVY_DEF.lootHint?.includes('предохранитель'));
  assert.deepEqual(LAMPOVY_DEF.floors, [
    FloorLevel.LIVING,
    FloorLevel.KVARTIRY,
    FloorLevel.MINISTRY,
    FloorLevel.MAINTENANCE,
  ]);
});
