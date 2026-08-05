import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { DEF, generateSprite } from '../src/entities/paragraph';
import { generateSprite as generateEyeSprite } from '../src/entities/eye';
import { CLEAR, S } from '../src/render/pixutil';

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

test('paragraph stays a medium-range document shooter with a close-after-shot answer', () => {
  assert.equal(DEF.kind, MonsterKind.PARAGRAPH);
  assert.equal(DEF.isRanged, true);
  assert.equal(DEF.aiFlags?.includes('rangedClause'), true);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.VOID]);
  assert.equal(DEF.hp >= 40 && DEF.hp <= 70, true, 'PARAGRAPH should stay tougher than Eye but not boss-heavy');
  assert.equal(DEF.speed <= 1.2, true, 'PARAGRAPH should not kite like Eye');
  assert.equal(DEF.dmg >= 14, true, 'PARAGRAPH shot should matter at medium range');
  assert.equal(DEF.attackRate >= 2.2, true, 'PARAGRAPH should leave a rush window after firing');
  assert.equal((DEF.projSpeed ?? 0) <= 7, true, 'PARAGRAPH shot should stay dodgeable/readable');
  assert.match(DEF.counterplay ?? '', /линию видимости/);
  assert.match(DEF.counterplay ?? '', /после выстрела/);
  assert.match(DEF.counterplay ?? '', /15 клет/);
  assert.match(DEF.counterplay ?? '', /упор/);
  assert.match(DEF.lootHint ?? '', /приказ|формулировк/);
});

test('paragraph sprite reads as stamped paper, not an eye clone', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let redStamp = 0;

  for (const px of sprite) {
    if (px === CLEAR) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (r > 120 && g < 70 && b < 80) redStamp++;
  }

  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 800, 'PARAGRAPH sprite should not be a tiny projectile dot');
  assert.ok(redStamp > 30, 'PARAGRAPH sprite should carry a readable red stamp/legal cue');
  assert.notEqual(spriteHash(sprite), spriteHash(generateEyeSprite()), 'PARAGRAPH must not collapse into EYE art');
});
