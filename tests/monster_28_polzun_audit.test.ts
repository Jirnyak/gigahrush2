import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { CLEAR, S } from '../src/render/pixutil';
import { DEF, generateSprite } from '../src/entities/polzun';

test('polzun remains a slow heavy doorway threat with local guidance', () => {
  assert.equal(DEF.kind, MonsterKind.POLZUN);
  assert.ok(DEF.hp >= 100 && DEF.hp <= 220, 'hp should stay in the heavy band');
  assert.ok(DEF.speed >= 0.7 && DEF.speed <= 1.4, 'speed should stay in the heavy band');
  assert.ok(DEF.dmg >= 16 && DEF.dmg <= 30, 'damage should stay in the heavy band');
  assert.ok(DEF.attackRate >= 1.6, 'attack cadence should preserve a planning window');
  assert.deepEqual(DEF.floors, [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.deepEqual(DEF.aiFlags, ['foodBait']);
  assert.match(DEF.counterplay ?? '', /двер|ванн|вод|дистанц|говняк/);
  assert.match(DEF.lootHint ?? '', /фильтр|ванн|мокр/);
});

test('polzun sprite reads as low and crawling', () => {
  const sprite = generateSprite();
  let upperPixels = 0;
  let lowerPixels = 0;
  let maxLowWidth = 0;

  for (let y = 0; y < S; y++) {
    let minX = S;
    let maxX = -1;
    for (let x = 0; x < S; x++) {
      if (sprite[y * S + x] === CLEAR) continue;
      if (y < 28) upperPixels++;
      if (y >= 35) lowerPixels++;
      if (y >= 40) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    if (maxX >= minX) maxLowWidth = Math.max(maxLowWidth, maxX - minX + 1);
  }

  assert.ok(lowerPixels > upperPixels * 8, 'most opaque pixels should sit low');
  assert.ok(maxLowWidth >= 40, 'low silhouette should be wide enough to read as crawling');
});
