/* ── Protokolnik: document-pressure Ministry horror ─────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.PROTOKOLNIK,
  name: 'Протокольник',
  hp: 112,
  speed: 1.08,
  dmg: 6,
  attackRate: 2.4,
  sprite: 0,
  aiFlags: ['protocolPressure'],
  floors: [FloorLevel.MINISTRY],
  counterplay: 'Протокольник закрывает бой протоколом: сбросьте или спрячьте официальные бумаги, бейте коротким уроном или уходите из комнаты до роста давления.',
  lootHint: 'испорченный протокол, сургучная крошка и бумага с пустым местом для вашей фамилии',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px >= 0 && px < S && py >= 0 && py < S) t[py * S + px] = c;
}

function rect(t: Uint32Array, x0: number, y0: number, w: number, h: number, c: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(t, x, y, c);
  }
}

function stampCircle(t: Uint32Array, cx: number, cy: number, r: number, c: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1 && d2 > 0.42) put(t, x, y, c);
    }
  }
}

function drawPage(t: Uint32Array, cx: number, cy: number, ang: number, scale: number, seed: number): void {
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const w = 4 * scale;
  const h = 6 * scale;
  for (let yy = -Math.floor(h); yy <= Math.floor(h); yy++) {
    for (let xx = -Math.floor(w); xx <= Math.floor(w); xx++) {
      const rx = xx / Math.max(1, w);
      const ry = yy / Math.max(1, h);
      if (Math.abs(rx) > 1 || Math.abs(ry) > 1) continue;
      const x = Math.floor(cx + xx * cos - yy * sin);
      const y = Math.floor(cy + xx * sin + yy * cos);
      const n = noise(x, y, seed) * 18 - 7;
      const edge = Math.abs(rx) > 0.78 || Math.abs(ry) > 0.82;
      put(t, x, y, edge
        ? rgba(clamp(86 + n), clamp(74 + n), clamp(58 + n))
        : rgba(clamp(210 + n), clamp(194 + n), clamp(136 + n)));
    }
  }
}

export function generateProtokolnikSprite(seed = 3535, pressureTier = 0): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const pressure = Math.max(0, Math.min(4, pressureTier));

  for (let strip = 0; strip < 8; strip++) {
    const base = cx - 20 + strip * 5.6;
    const stripW = 6 + Math.floor(noise(strip, 2, seed) * 4);
    const lean = (noise(strip, 3, seed) - 0.5) * 5;
    const top = 14 + Math.floor(noise(strip, 4, seed) * 7);
    const bottom = 58 - Math.floor(noise(strip, 5, seed) * 4);
    for (let y = top; y < bottom; y++) {
      const k = (y - top) / Math.max(1, bottom - top);
      const center = base + lean * k + Math.sin(y * 0.17 + strip) * 1.4;
      const half = stripW * (0.55 + k * 0.85);
      for (let x = Math.floor(center - half); x <= Math.ceil(center + half); x++) {
        if (x < 0 || x >= S) continue;
        const edge = Math.abs(x - center) > half - 1.3;
        const fold = ((strip + Math.floor(y / 7)) & 1) === 0;
        const n = noise(x, y, seed + strip * 37) * 22 - 9;
        t[y * S + x] = edge || fold
          ? rgba(clamp(22 + n), clamp(20 + n), clamp(24 + n))
          : rgba(clamp(190 + n), clamp(174 + n), clamp(124 + n));
      }
    }
  }

  for (let y = 18; y < 57; y += 6) {
    const len = 7 + Math.floor(noise(y, 0, seed + 300) * 17);
    const x0 = Math.floor(cx - 12 + noise(y, 1, seed + 301) * 8);
    for (let x = x0; x < x0 + len; x++) put(t, x, y, rgba(18, 15, 18));
  }

  const violet = rgba(70, 44, 96);
  for (let y = 25; y < 58; y++) {
    if (y % 2 === 0) {
      put(t, cx - 21 + Math.sin(y * 0.3) * 2, y, violet);
      put(t, cx + 21 + Math.cos(y * 0.27) * 2, y, violet);
    }
  }

  const red = rgba(150, 18, 26);
  for (let i = 0; i < 9; i++) {
    const x = 17 + Math.floor(noise(i, 0, seed + 500) * 31);
    const y = 24 + Math.floor(noise(i, 1, seed + 501) * 28);
    if (i & 1) {
      rect(t, x, y, 5, 4, red);
      rect(t, x + 1, y + 1, 3, 2, rgba(196, 42, 38));
    } else {
      stampCircle(t, x + 2, y + 2, 4, red);
    }
  }

  rect(t, 23, 8, 18, 11, rgba(214, 196, 136));
  rect(t, 21, 10, 22, 7, rgba(28, 24, 22));
  rect(t, 24, 11, 16, 5, rgba(214, 196, 136));
  rect(t, 27, 5, 10, 5, rgba(30, 24, 20));
  rect(t, 29, 2, 6, 4, rgba(84, 54, 32));

  const orbitCount = 4 + pressure * 2;
  const spin = pressure * 0.72;
  for (let i = 0; i < orbitCount; i++) {
    const a = (Math.PI * 2 * i) / orbitCount + spin + noise(i, pressure, seed + 800) * 0.5;
    const r = 18 + pressure * 1.4 + noise(i, 1, seed + 801) * 3;
    drawPage(t, cx + Math.cos(a) * r, 27 + Math.sin(a) * (r * 0.58), a + Math.PI * 0.35, 0.62, seed + 900 + i);
  }

  return t;
}

export function generateSprite(): Uint32Array {
  return generateProtokolnikSprite();
}
