import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { MONSTER_ECOLOGY, getMonsterEcology } from '../src/data/monster_ecology';
import { generateSprite as generateEyeSprite } from '../src/entities/eye';
import { DEF, generateSprite } from '../src/entities/slepoglaz';
import { CLEAR, S } from '../src/render/pixutil';

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function countPixels(sprite: Uint32Array, pred: (px: number, x: number, y: number) => boolean): number {
  let count = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = sprite[y * S + x];
      if (pred(px, x, y)) count++;
    }
  }
  return count;
}

test('Slepoglaz is a standalone last-sound beam monster', () => {
  assert.equal(DEF.kind, MonsterKind.SLEPOGLAZ);
  assert.equal(DEF.name, 'Слепоглаз');
  assert.deepEqual(DEF.aiFlags, ['lastSoundBeam']);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(DEF.hp >= 40 && DEF.hp <= 70, true, 'Slepoglaz should stay medium durability');
  assert.equal(DEF.speed <= 0.8, true, 'Slepoglaz should stay slow enough to rush after a miss');
  assert.equal(DEF.dmg >= 20, true, 'Slepoglaz beam should stay lethal at range');
  assert.equal(DEF.attackRate >= 3, true, 'Slepoglaz should preserve a long recovery window');
  assert.match(DEF.counterplay ?? '', /шум|сторон|после|упор/);
});

test('Slepoglaz ecology has no old blind Eye variant dependency', () => {
  const ecology = getMonsterEcology(MonsterKind.SLEPOGLAZ);
  assert.ok(ecology, 'Slepoglaz needs ecology data');
  assert.deepEqual(ecology.floors, [FloorLevel.MAINTENANCE, FloorLevel.HELL]);
  assert.equal(ecology.rare, false);
  assert.equal(ecology.rumorIds.includes('ecology_slepoglaz_last_sound'), true);
  assert.match(ecology.counterplay, /Шумните|шаг|После|упор/);
});

test('Slepoglaz sprite reads as a sealed green blind eye, not the base eye', () => {
  const sprite = generateSprite();
  assert.equal(sprite.length, S * S);
  assert.equal(countPixels(sprite, px => px !== CLEAR && (px >>> 24) !== 0) > 600, true, 'sprite should not be blank');

  const greenPixels = countPixels(sprite, px => {
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    return (px >>> 24) > 0 && g > 135 && g > r * 1.45 && g > b * 1.35;
  });
  assert.equal(greenPixels > 12, true, 'sprite needs readable green beam/charge pixels');

  const darkSeam = countPixels(sprite, (px, x, y) => {
    const r = px & 0xff;
    const g = (px >>> 8) & 0xff;
    const b = (px >>> 16) & 0xff;
    return x >= 21 && x <= 43 && y >= 24 && y <= 36 && (px >>> 24) > 0 && r < 35 && g < 38 && b < 35;
  });
  assert.equal(darkSeam > 25, true, 'sprite should have a dark sealed central slit');

  assert.notEqual(spriteHash(sprite), spriteHash(generateEyeSprite()), 'Slepoglaz sprite must not duplicate Eye art');
});

test('Slepoglaz AI hook owns last-sound beam windup, fire, and recovery', () => {
  const source = readFileSync('src/systems/ai/monster.ts', 'utf8');
  assert.match(source, /function acquireSlepoglazAim\(/, 'AI needs a dedicated aim acquisition path');
  assert.match(source, /findNoiseForActor\([\s\S]*SLEPOGLAZ_NOISE_HEARING_MULT/, 'AI should prefer bounded loud noise records');
  assert.match(source, /source: 'sound'/, 'AI should distinguish sound-locked shots from sight shots');
  assert.match(source, /function fireSlepoglazBeam\(/, 'AI needs direct beam fire logic, not old Eye projectile variants');
  assert.match(source, /SLEPOGLAZ_WINDUP_SEC/, 'beam charge must stay readable');
  assert.match(source, /SLEPOGLAZ_RECOVERY_SEC/, 'miss or shot must leave a rush window');
  assert.match(source, /Слепоглаз зарядил зеленый луч в \$\{sourceText\}/, 'player warning must name the charged old position');
  assert.match(source, /\['slepoglaz', 'last_sound', 'beam', 'warning'\]/, 'readability event should expose counterplay tags');
});
