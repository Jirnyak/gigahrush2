import { test } from 'node:test';
import * as assert from 'node:assert/strict';

global.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(400) }),
      putImageData: () => {},
      drawImage: () => {}
    })
  })
} as any;

import { drawGamblingOverlay } from '../src/render/gambling_ui';
import type { GamblingOverlaySnapshot } from '../src/systems/gambling';

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

const defaultSnapshot: GamblingOverlaySnapshot = {
  open: true,
  machineIdx: 123,
  label: 'SLOTS',
  betRubles: 10,
  cashRubles: 100,
  itemStakeName: '',
  itemStakeRubles: 0,
  presetIndex: 0,
  presets: [10, 50, 100],
  minBet: 10,
  maxBet: 100,
  houseEdge: 0.05,
  message: '',
  canSubmit: true,
};

test('drawGamblingOverlay renders cash betting correctly', () => {
  const ctx = new CanvasStubContext();
  drawGamblingOverlay(
    ctx as unknown as CanvasRenderingContext2D,
    1, // sx
    1, // sy
    0, // time
    defaultSnapshot
  );

  assert.ok(ctx.texts.some(t => t.includes('SLOTS')));
  assert.ok(ctx.texts.some(t => t.includes('Наличные: 100 руб.')));
  assert.ok(ctx.texts.some(t => t.includes('Ставка: 10 руб.')));
  assert.ok(ctx.texts.some(t => t.includes('маржа 5.0%')));
  assert.ok(ctx.texts.some(t => t.includes('Автомат принимает ставку.')));
});

test('drawGamblingOverlay renders item stakes and errors', () => {
  const ctx = new CanvasStubContext();
  const snapshot: GamblingOverlaySnapshot = {
    ...defaultSnapshot,
    cashRubles: 0,
    betRubles: 50,
    itemStakeName: 'Золотые часы',
    itemStakeRubles: 50,
  };

  drawGamblingOverlay(
    ctx as unknown as CanvasRenderingContext2D,
    1,
    1,
    0,
    snapshot
  );

  assert.ok(ctx.texts.some(t => t.includes('Золотые часы: ставка 50 руб.')));
});

test('drawGamblingOverlay renders error messages', () => {
  const ctx = new CanvasStubContext();
  const snapshot: GamblingOverlaySnapshot = {
    ...defaultSnapshot,
    cashRubles: 5,
    betRubles: 10,
    canSubmit: false,
    message: 'Не хватает средств!',
  };

  drawGamblingOverlay(
    ctx as unknown as CanvasRenderingContext2D,
    1,
    1,
    0,
    snapshot
  );

  assert.ok(ctx.texts.some(t => t.includes('Наличных не хватает.')));
  assert.ok(ctx.texts.some(t => t.includes('Не хватает средств!')));
});
