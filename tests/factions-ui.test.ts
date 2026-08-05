import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { drawFactionMenu } from '../src/render/factions_ui';
import { makeGameState, makeTestPlayer } from './helpers';

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
  textAlign: CanvasTextAlign = 'start';

  constructor(width = 200, height = 200) {
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
  clip(): void {}
  translate(): void {}
}

test('drawFactionMenu draws the relation and alife rating title', () => {
  const ctx = new CanvasStubContext(1600, 900);
  const player = makeTestPlayer();
  const state = makeGameState();

  drawFactionMenu(ctx as unknown as CanvasRenderingContext2D, player, [], state, 1, 1, 0);

  assert.ok(ctx.texts.includes('ОТНОШЕНИЯ И A-LIFE РЕЙТИНГ'));
});

test('drawFactionMenu handles small canvases gracefully', () => {
  const ctx = new CanvasStubContext(320, 240);
  const player = makeTestPlayer();
  const state = makeGameState();

  assert.doesNotThrow(() => {
    drawFactionMenu(ctx as unknown as CanvasRenderingContext2D, player, [], state, 1, 1, 0);
  });
});
