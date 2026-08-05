/* ── Lotochnik: wet-service drain crawler ────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.LOTOCHNIK,
  name: 'Лоточник',
  hp: 74,
  speed: 1.25,
  dmg: 13,
  attackRate: 1.25,
  sprite: 0,
  aiFlags: ['waterStrider', 'drainArmor'],
  floors: [FloorLevel.MAINTENANCE, FloorLevel.LIVING],
  counterplay: 'Не принимайте его в лотке: вытяните Лоточника на сухой бетон, разорвите погоню через сухой порог и бейте, пока мокрая броня не вернулась.',
  lootHint: 'мокрая ветошь, фильтрующий слой, желтый осадок из служебного лотка',
};

function paintEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (d: number, x: number, y: number) => number,
): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    if (y < 0 || y >= S) continue;
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1.08) continue;
      t[y * S + x] = color(d, x, y);
    }
  }
}

function paintLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  paintEllipse(t, cx, 36, 22, 9, (d, x, y) => {
    const n = noise(x, y, 12600) * 26;
    const edge = d * 32;
    return rgba(clamp(54 + n - edge), clamp(86 + n - edge * 0.5), clamp(104 + n), 245);
  });
  paintEllipse(t, cx - 2, 30, 15, 6, (d, x, y) => {
    const n = noise(x, y, 12610) * 18;
    return rgba(clamp(48 + n - d * 20), clamp(78 + n), clamp(96 + n), 235);
  });

  for (let y = 27; y <= 37; y++) {
    const half = 4 + Math.sin(y * 0.7) * 1.2;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 12620) * 18;
      t[y * S + x] = rgba(clamp(14 + n), clamp(26 + n), clamp(33 + n), 245);
    }
  }
  for (let y = 28; y <= 34; y += 2) {
    paintLine(t, Math.floor(cx - 7), y, Math.floor(cx + 7), y + 1, rgba(118, 176, 190, 115));
  }

  for (const [px, py, rx, ry] of [
    [12, 39, 7, 4],
    [52, 39, 7, 4],
    [16, 47, 8, 4],
    [48, 47, 8, 4],
  ] as const) {
    paintEllipse(t, px, py, rx, ry, (d, x, y) => {
      const n = noise(x, y, 12630) * 22;
      return rgba(clamp(28 + n), clamp(62 + n), clamp(76 + n), clamp(220 - d * 30));
    });
  }

  for (let i = 0; i < 28; i++) {
    const x = 17 + Math.floor(noise(i, 3, 12640) * 30);
    const y = 42 + Math.floor(noise(i, 7, 12641) * 12);
    const r = noise(i, y, 12642) > 0.5 ? 2 : 1;
    paintEllipse(t, x, y, r + 1, r, () => rgba(176, 142, 36, 185));
  }

  for (let i = 0; i < 10; i++) {
    const x = 18 + Math.floor(noise(i, 11, 12650) * 28);
    const y0 = 45 + Math.floor(noise(i, 13, 12651) * 5);
    const len = 4 + Math.floor(noise(i, 17, 12652) * 8);
    paintLine(t, x, y0, x + (i % 3) - 1, Math.min(S - 2, y0 + len), rgba(54, 126, 158, 155));
  }

  t[29 * S + (cx - 5)] = rgba(230, 194, 70);
  t[29 * S + (cx + 5)] = rgba(230, 194, 70);
  t[30 * S + (cx - 5)] = rgba(108, 82, 28);
  t[30 * S + (cx + 5)] = rgba(108, 82, 28);

  return t;
}
