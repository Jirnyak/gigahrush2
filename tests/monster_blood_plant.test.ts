import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { DEF, generateSprite } from '../src/entities/blood_plant';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { S } from '../src/render/pixutil';

test('blood plant definition, ecology, and sprite read as a red mold rooted hive', () => {
  const ecology = getMonsterEcology(MonsterKind.BLOOD_PLANT);
  const sprite = generateSprite();
  let opaque = 0;
  let red = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    if (r > g + 20 && r > b + 20) red++;
  }

  assert.equal(DEF.kind, MonsterKind.BLOOD_PLANT);
  assert.deepEqual(DEF.aiFlags, ['rootHive']);
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(ecology?.rare, true);
  assert.match(DEF.counterplay ?? '', /соли|огня|режущего/i);
  assert.equal(sprite.length, S * S);
  assert.ok(opaque > 150, 'blood plant sprite should have visible elements');
  assert.ok(red > 50, 'blood plant should have clear red mold/vein colors');
});
