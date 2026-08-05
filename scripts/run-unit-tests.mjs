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
let reserved = 0;

for (const fileName of allTestFiles) {
  const source = readFileSync(join(testsDir, fileName), 'utf8');
  if (isGenerationCoupledTest(fileName, source)) {
    reserved++;
    continue;
  }
  selected.push(`tests/${fileName}`);
}

if (selected.length === 0) {
  console.error('No unit test files selected.');
  process.exit(1);
}

console.log(`Unit test selection: ${selected.length} files; ${reserved} generation/content files reserved for npm run test:generation.`);

const result = spawnSync(tsxBin, ['--test', '--test-concurrency=3', ...process.argv.slice(2), ...selected], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
if (result.signal) {
  console.error(`Unit test runner terminated by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
