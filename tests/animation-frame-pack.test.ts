import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GENERATED_ANIMATION_CLIP_IDS,
  decodeGeneratedAnimationFrame,
  getGeneratedAnimationFramePack,
} from '../src/render/animations/generated_frames';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANIMS_DIR = path.join(ROOT, 'anims');
const CYRILLIC_ANIMS_DIR = path.join(ROOT, '\u0430nims');

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name);
    out.push(filePath);
    if (statSync(filePath).isDirectory()) out.push(...walkFiles(filePath));
  }
  return out;
}

function sourceFrameIndexes(sourceDirectory: string): number[] {
  const dir = path.join(ROOT, sourceDirectory);
  return readdirSync(dir)
    .map(name => /^(\d+)\.png$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => Number(match[1]))
    .sort((a, b) => a - b);
}

function assertContiguous(indexes: readonly number[], label: string) {
  indexes.forEach((index, expected) => {
    assert.equal(index, expected, `${label} frame ${expected}`);
  });
}

test('generated Olga animation frame packs match source intake contract', () => {
  assert.equal(existsSync(CYRILLIC_ANIMS_DIR), false, 'old Cyrillic ./аnims/ path must not remain');
  assert.equal(existsSync(ANIMS_DIR), true, 'ASCII anims/ path must exist');
  assert.equal(walkFiles(ANIMS_DIR).some(filePath => path.basename(filePath) === '.DS_Store'), false);

  assert.deepEqual([...GENERATED_ANIMATION_CLIP_IDS].sort(), [
    'olga_dmitrievna_harm',
    'olga_dmitrievna_walk',
  ]);

  const expected = {
    olga_dmitrievna_harm: 3,
    olga_dmitrievna_walk: 6,
  } as const;

  for (const [clipId, frameCount] of Object.entries(expected)) {
    const pack = getGeneratedAnimationFramePack(clipId);
    assert.ok(pack, `${clipId} frame pack`);
    assert.equal(pack.width, 64, `${clipId} width`);
    assert.equal(pack.height, 64, `${clipId} height`);
    assert.equal(pack.frameCount, frameCount, `${clipId} frame count`);
    assert.equal(pack.frames.length, frameCount, `${clipId} frame array length`);

    assertContiguous(pack.frames.map(frame => frame.index), `${clipId} generated`);
    assertContiguous(sourceFrameIndexes(pack.sourceDirectory), `${clipId} source`);

    for (const frame of pack.frames) {
      const filePath = path.join(ROOT, frame.sourcePath);
      assert.equal(existsSync(filePath), true, `${frame.sourcePath} exists`);
      assert.equal(createHash('sha256').update(readFileSync(filePath)).digest('hex'), frame.sha256);
      const decoded = decodeGeneratedAnimationFrame(clipId, frame.index);
      assert.ok(decoded, `${clipId}/${frame.index} decodes`);
      assert.equal(decoded.length, 64 * 64, `${clipId}/${frame.index} decoded pixel count`);
    }
  }
});
