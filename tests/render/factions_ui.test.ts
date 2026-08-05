import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { drawFactionMenu } from '../../src/render/factions_ui';
import { makeGameState, makeTestPlayer } from '../helpers';

class CanvasStubContext {
  readonly canvas: { width: number; height: number };
  readonly pathFills: string[] = [];
  readonly texts: string[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  imageSmoothingEnabled = false;
  textBaseline: CanvasTextBaseline = 'alphabetic';
  textAlign: CanvasTextAlign = 'left';

  constructor(width = 800, height = 600) {
    this.canvas = { width, height };
  }

  measureText(text: string): TextMetrics { return { width: text.length * 7 } as TextMetrics; }
  fillText(text: string, _x: number, _y: number): void { this.texts.push(text); }
  fillRect(_x: number, _y: number, _w: number, _h: number): void {}
  strokeRect(_x: number, _y: number, _w: number, _h: number): void {}
  beginPath(): void {}
  moveTo(_x: number, _y: number): void {}
  lineTo(_x: number, _y: number): void {}
  closePath(): void {}
  stroke(): void {}
  fill(): void { this.pathFills.push(String(this.fillStyle)); }
  save(): void {}
  restore(): void {}
  drawImage(..._args: unknown[]): void {}
}

test('drawFactionMenu renders without errors in side-by-side mode (wide screen)', () => {
  const ctx = new CanvasStubContext(800, 600);
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const state = makeGameState();

  assert.doesNotThrow(() => {
    drawFactionMenu(
      ctx as unknown as CanvasRenderingContext2D,
      player,
      [player],
      state,
      1,
      1,
      0,
    );
  });

  assert.ok(ctx.texts.length > 0, 'Should render some text');
  assert.ok(ctx.texts.includes('ОТНОШЕНИЯ И A-LIFE РЕЙТИНГ'), 'Should render the title');

  // Checking for some panel titles
  assert.ok(ctx.texts.includes('ТЕРРИТОРИИ И СОБЫТИЯ'), 'Should render the territory panel in side-by-side');
  assert.ok(ctx.texts.includes('A-LIFE РЕЙТИНГ ТОП 100'), 'Should render the rating panel');
});

test('drawFactionMenu renders without errors in non-side-by-side mode (narrow screen)', () => {
  const ctx = new CanvasStubContext(400, 600);
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const state = makeGameState();

  assert.doesNotThrow(() => {
    drawFactionMenu(
      ctx as unknown as CanvasRenderingContext2D,
      player,
      [player],
      state,
      1,
      1,
      0,
    );
  });

  assert.ok(ctx.texts.length > 0, 'Should render some text');
  assert.ok(ctx.texts.includes('ОТНОШЕНИЯ И A-LIFE РЕЙТИНГ'), 'Should render the title');

  // It should NOT render 'ТЕРРИТОРИИ И СОБЫТИЯ' if w < 520 * sx
  assert.equal(ctx.texts.includes('ТЕРРИТОРИИ И СОБЫТИЯ'), false, 'Should NOT render the territory panel in narrow screen');
  assert.ok(ctx.texts.includes('A-LIFE РЕЙТИНГ ТОП 100'), 'Should render the rating panel');
});
