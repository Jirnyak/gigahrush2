/* ── Gnilushka: altered neutral woman, defensive only ───────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.GNILUSHKA,
  name: 'Гнилушка',
  hp: 74,
  speed: 1.42,
  dmg: 16,
  attackRate: 1.05,
  sprite: 0,
  aiFlags: ['defensiveNeutral'],
  floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY],
  counterplay: 'Не загоняйте в угол и не начинайте первым: спокойный разговор или тара НИИ закрывают встречу без боя, а раненая Гнилушка делает короткий опасный рывок только в тесноте.',
  lootHint: 'серо-зеленый соскоб, старая записка, редкий мутный образец после добровольной передачи НИИ',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed: number, alpha = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 22 - 11;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n), alpha));
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), color);
  }
}

function antler(t: Uint32Array, x: number, y: number, side: -1 | 1): void {
  const bone = rgba(176, 179, 166);
  line(t, x, y, x + side * 6, y - 10, bone);
  line(t, x + side * 3, y - 5, x + side * 8, y - 8, bone);
  line(t, x + side * 5, y - 8, x + side * 7, y - 13, bone);
  line(t, x + side * 2, y - 3, x + side * 1, y - 9, bone);
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 24; y < 57; y++) {
    const lean = Math.sin(y * 0.19) * 1.6;
    const half = y < 34 ? 5.5 : 8.5 - (y - 34) * 0.08;
    for (let x = Math.floor(cx - half + lean); x <= Math.ceil(cx + half + lean); x++) {
      const dx = (x - cx - lean) / Math.max(1, half);
      const dy = (y - 41) / 20;
      if (dx * dx + dy * dy > 1.06) continue;
      const n = noise(x, y, 7201) * 18;
      const torn = y > 47 && noise(x, y, 7202) < 0.28;
      if (!torn) put(t, x, y, rgba(clamp(28 + n), clamp(31 + n), clamp(32 + n)));
    }
  }

  ellipse(t, cx - 1, 19, 5.2, 7.5, 18, 20, 19, 7210);
  ellipse(t, cx - 3, 15, 8.5, 9.5, 156, 158, 150, 7211, 238);
  ellipse(t, cx + 3, 16, 8.0, 9.0, 112, 118, 112, 7212, 220);
  antler(t, cx - 4, 13, -1);
  antler(t, cx + 4, 13, 1);

  for (let y = 25; y < 51; y++) {
    const l = Math.floor(cx - 7 - Math.sin(y * 0.33) * 2.0);
    const r = Math.floor(cx + 8 + Math.sin(y * 0.27) * 2.2);
    put(t, l, y, rgba(18, 21, 19));
    put(t, l - 1, y + 1, rgba(68, 91, 70, 210));
    put(t, r, y, rgba(20, 22, 20));
    if (y > 38) put(t, r + 1, y, rgba(178, 188, 178, 220));
  }

  for (let y = 53; y < 63; y++) {
    put(t, Math.floor(cx - 4 - (y - 53) * 0.16), y, rgba(17, 18, 18));
    put(t, Math.floor(cx + 3 + (y - 53) * 0.12), y, rgba(18, 20, 19));
  }

  for (let i = 0; i < 46; i++) {
    const x = 19 + Math.floor(noise(i, 3, 7220) * 27);
    const y = 18 + Math.floor(noise(i, 7, 7221) * 36);
    if ((t[y * S + x] >>> 24) === 0) continue;
    const green = i % 3 === 0;
    put(t, x, y, green ? rgba(75, 108, 78, 210) : rgba(9, 10, 9, 235));
  }

  put(t, cx - 2, 19, rgba(246, 238, 196));
  put(t, cx + 2, 19, rgba(244, 188, 72));
  put(t, cx - 1, 20, rgba(34, 24, 18));
  put(t, cx + 3, 20, rgba(34, 22, 16));

  for (let i = 0; i < 11; i++) {
    const x = 18 + Math.floor(noise(i, 11, 7230) * 30);
    const y = 46 + Math.floor(noise(i, 13, 7231) * 14);
    put(t, x, y, rgba(150, 154, 148, 130));
  }

  return t;
}
