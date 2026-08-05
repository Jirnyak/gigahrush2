import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

test('game code never releases pointer lock programmatically', () => {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = sourceFiles(srcRoot).filter(path => readFileSync(path, 'utf8').includes('.exitPointerLock('));
  assert.deepEqual(offenders, []);
});
