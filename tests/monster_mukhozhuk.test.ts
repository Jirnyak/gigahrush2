import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { DEF, generateSprite } from '../src/entities/mukhozhuk';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { S } from '../src/render/pixutil';

test('mukhozhuk definition and ecology read correctly', () => {
  const ecology = getMonsterEcology(MonsterKind.MUKHOZHUK_HOST);

  assert.equal(DEF.kind, MonsterKind.MUKHOZHUK_HOST);
  assert.deepEqual(DEF.aiFlags, ['parasiteLeader', 'foodBait']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE]);
  assert.equal(ecology?.rare, true);
  assert.match(DEF.counterplay ?? '', /свидетелях|карантиньте/i);
});

test('mukhozhuk sprite generation creates a valid sprite', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let sickGreen = 0;
  let coatGray = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;

    if (g > r + 20 && g > b + 20) sickGreen++;
    if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r < 100) coatGray++;
  }

  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 100, true, 'mukhozhuk sprite should have a body');
  assert.equal(sickGreen > 0, true, 'mukhozhuk sprite should have sick green pixels');
  assert.equal(coatGray > 50, true, 'mukhozhuk sprite should have coat gray pixels');
});
