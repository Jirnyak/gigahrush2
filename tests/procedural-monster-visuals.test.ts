import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { MonsterKind } from '../src/core/types';
import { generateProceduralMonsterSprite } from '../src/entities/procedural_visuals';

function brightRedOrangePixels(sprite: Uint32Array): number {
  let count = 0;
  for (const px of sprite) {
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    const a = px >>> 24;
    if (a > 150 && r > 180 && g < 105 && b < 105) count++;
  }
  return count;
}

test('procedural monster variants do not stamp one shared red eye motif over base art', () => {
  const checkedKinds = [MonsterKind.SLEPOGLAZ, MonsterKind.BETONNIK] as const;
  for (const kind of checkedKinds) {
    for (const seed of [12_345, 98_765]) {
      const sprite = generateProceduralMonsterSprite(kind, seed);
      assert.equal(
        brightRedOrangePixels(sprite) <= 4,
        true,
        `${MonsterKind[kind]} procedural sprite should preserve its own eye/readability language`,
      );
    }
  }

  const falseHuman = generateProceduralMonsterSprite(MonsterKind.NELYUD, 77_711);
  assert.equal(
    brightRedOrangePixels(falseHuman) >= 4,
    true,
    'false-human monsters should keep their wrong red eye cue',
  );
});
