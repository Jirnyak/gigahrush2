import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateNightmareSprite, generateSprite } from '../src/entities/nightmare';
import { generateSprite as generateShadowSprite } from '../src/entities/shadow';
import { generateSprite as generateSpiritSprite } from '../src/entities/spirit';
import { S } from '../src/render/pixutil';

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function opaquePixels(sprite: Uint32Array): number {
  let count = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) count++;
  return count;
}

test('nightmare is a rare elite pressure enemy, not a boss sponge', () => {
  const ecology = getMonsterEcology(MonsterKind.NIGHTMARE);

  assert.equal(DEF.kind, MonsterKind.NIGHTMARE);
  assert.equal(DEF.name, 'Кошмарище');
  assert.equal(ecology?.rare, true, 'NIGHTMARE should keep rare ecology status');
  assert.equal((ecology?.minSamosborCount ?? 0) >= 3, true, 'NIGHTMARE should stay post-pressure gated');
  assert.equal(DEF.hp >= 120 && DEF.hp <= 350, true, 'NIGHTMARE should stay in the elite HP band');
  assert.equal(DEF.speed >= 1.2 && DEF.speed <= 1.7, true, 'NIGHTMARE should pressure without outrunning flee counterplay');
  assert.equal(DEF.dmg >= 30, true, 'NIGHTMARE should punish hesitation quickly');
  assert.equal(DEF.attackRate <= 1.5, true, 'NIGHTMARE pressure should come from burst contact, not attrition');
  assert.deepEqual(DEF.floors, [
    FloorLevel.MINISTRY,
    FloorLevel.LIVING,
    FloorLevel.MAINTENANCE,
    FloorLevel.HELL,
    FloorLevel.VOID,
  ]);
  for (const floor of DEF.floors ?? []) assert.equal(ecology?.floors.includes(floor), true);
  assert.ok(DEF.counterplay?.includes('урон'));
  assert.ok(DEF.counterplay?.includes('уходите'));
  assert.ok(DEF.lootHint?.includes('ПСИ'));
});

test('nightmare sprite remains distinct from shadow and spirit silhouettes', () => {
  const nightmare = generateSprite();
  const shadow = generateShadowSprite();
  const spirit = generateSpiritSprite();

  assert.equal(nightmare.length, 128 * 128);
  assert.ok(opaquePixels(nightmare) > 400, 'NIGHTMARE sprite should not be blank');
  assert.notEqual(spriteHash(nightmare), spriteHash(shadow), 'NIGHTMARE must not collapse into SHADOW art');
  assert.notEqual(spriteHash(nightmare), spriteHash(spirit), 'NIGHTMARE must not collapse into SPIRIT art');
  assert.notEqual(
    spriteHash(generateNightmareSprite(32032)),
    spriteHash(generateNightmareSprite(32033)),
    'seeded NIGHTMARE sprites should keep procedural variation',
  );
});
