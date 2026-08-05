import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1, `${name} body must start`);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`${name} body must close`);
}

test('active samosbor HUD text avoids expensive Canvas2D blur shadows', () => {
  const source = readFileSync(new URL('../src/render/hud.ts', import.meta.url), 'utf8');
  const activeTitle = functionBody(source, 'drawSamosborActiveInstruction');
  const crawl = functionBody(source, 'drawSamosborCrawl');

  assert.equal(activeTitle.includes('shadowBlur'), false, 'active samosbor title must use cheap text duplicates, not shadowBlur');
  assert.equal(crawl.includes('shadowBlur'), false, 'fullscreen samosbor crawl must not use shadowBlur');
  assert.match(crawl, /Math\.min\(7,\s*Math\.round\(w \/ 220\)\)/, 'crawl text count must stay bounded');
});

test('pre-active samosbor warning uses locked samosbor text channel', () => {
  const source = readFileSync(new URL('../src/render/hud.ts', import.meta.url), 'utf8');
  const warningTitle = functionBody(source, 'drawSamosborWarningInstruction');

  assert.equal(warningTitle.includes('shadowBlur'), false, 'pre-active samosbor warning must stay cheap');
  assert.equal(warningTitle.includes('fillRect'), false, 'pre-active samosbor warning should be text-only');
  assert.equal(warningTitle.includes('drawStaticNoise'), false, 'pre-active samosbor warning should not draw a panel effect');
  assert.match(warningTitle, /ВНИМАНИЕ/, 'pre-active samosbor warning should use a minimal red attention title');
  assert.match(warningTitle, /через \$\{warning\.secondsLeft\} секунд объявляется самосбор/, 'pre-active samosbor warning should use the requested countdown wording');
  assert.match(source, /showSamosborText && !state\.samosborActive/, 'pre-active warning should use the locked samosbor_text surface');
  assert.match(source, /getSamosborWarningSnapshot\(state\)/, 'HUD must read the warning snapshot directly instead of relying on messages');
});
