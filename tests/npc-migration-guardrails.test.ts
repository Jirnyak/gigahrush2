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
    } else if (/\.(?:ts|mjs|js)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function relativeSource(path: string): string {
  const root = fileURLToPath(new URL('../', import.meta.url));
  return path.slice(root.length);
}

test('active source and scripts no longer read or export the old PLOT_NPCS projection', () => {
  const roots = [
    fileURLToPath(new URL('../src/', import.meta.url)),
    fileURLToPath(new URL('../scripts/', import.meta.url)),
  ];
  const offenders = roots.flatMap(root => sourceFiles(root))
    .flatMap(path => {
      const lines = readFileSync(path, 'utf8').split('\n');
      return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\bPLOT_NPCS\b/.test(line))
        .map(({ index }) => `${relativeSource(path)}:${index + 1}`);
    });

  assert.deepEqual(offenders, []);
});

test('intake questionnaire sync rejects source-less package summaries', () => {
  const syncPath = fileURLToPath(new URL('../gigahrush-npc-intake/scripts/sync-lookups.mjs', import.meta.url));
  const source = readFileSync(syncPath, 'utf8');

  assert.equal(source.includes("sourceFile: 'runtime package registry'"), false);
  assert.match(source, /NPC package summaries missing source locations/);
  assert.match(source, /allNpcPackages\(\)/);
});
