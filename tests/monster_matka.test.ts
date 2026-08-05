import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { DEF, generateSprite } from '../src/entities/matka';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { S } from '../src/render/pixutil';

test('matka definition, ecology, and sprite read as a warm-wall crawler spawner', () => {
  const ecology = getMonsterEcology(MonsterKind.MATKA);
  const sprite = generateSprite();

  let opaque = 0;
  let redEyes = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;

    // check for glowing red pixels (pupils are 180, 40, 40)
    if (r > 150 && g < 50 && b < 50) redEyes++;
  }

  assert.equal(DEF.kind, MonsterKind.MATKA);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID]);

  assert.equal(ecology?.rare, true);
  assert.match(DEF.counterplay ?? '', /убить матку/i);
  assert.equal(sprite.length, S * S);

  // ensure sprite has a substantial body
  assert.equal(opaque > 1000, true, 'matka sprite should have a massive bloated body');
  // check for glowing red eyes
  assert.equal(redEyes >= 2, true, 'matka should have glowing red eyes');
});
