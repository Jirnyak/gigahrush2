import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(root, 'tests');
const tsxBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const unitGenerationExceptions = new Set([
  'living-npc-corridor-attractors.test.ts',
]);

function isGenerationCoupledTest(fileName, source) {
  if (unitGenerationExceptions.has(fileName)) return false;
  if (/^items_\d+_/.test(fileName)) return true;
  return source.includes("../src/gen/");
}

const allTestFiles = readdirSync(testsDir)
  .filter(fileName => fileName.endsWith('.test.ts'))
  .sort();

const selected = [];
let skipped = 0;

for (const fileName of allTestFiles) {
  const source = readFileSync(join(testsDir, fileName), 'utf8');
  if (isGenerationCoupledTest(fileName, source)) {
    selected.push(`tests/${fileName}`);
  } else {
    skipped++;
  }
}

if (selected.length === 0) {
  console.error('No generation/content test files selected.');
  process.exit(1);
}

console.log(`Generation test selection: ${selected.length} files; ${skipped} unit files covered by npm run test:unit.`);

const inheritedArgs = process.argv.slice(2);
const env = { ...process.env, GIGAHRUSH_GENERATION_MATRIX: '1' };

const result = spawnSync(tsxBin, ['--test', '--test-concurrency=2', ...inheritedArgs, ...selected], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Generation test runner terminated by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
