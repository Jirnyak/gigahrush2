/* ── SCULPTURE — weeping angel mechanic ───────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SCULPTURE,
  name: 'Скульптура',
  hp: 250,
  speed: 8.5,
  dmg: 1000,
  attackRate: 0.25,
  sprite: 0,   // auto-assigned by generateSprites()
  aiFlags: ['weepingAngel' as any], // We will add 'weepingAngel' to MonsterAIFlag in monster.ts
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Двигается только когда на неё никто не смотрит. Смертельно быстрая.',
  lootHint: 'редкая арматура, изолента, странные бетонные фрагменты',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  drawBody(t, cx);
  drawLegs(t, cx);
  drawArms(t, cx);
  drawFacialMarkings(t, cx);

  return t;
}

function drawBody(t: Uint32Array, cx: number): void {
  // Peanut-shaped concrete body
  for (let y = 6; y < 52; y++) {
    let r = 0;
    
    if (y < 26) { // Head
      const dy = y - 15;
      r = 10 * Math.cos((dy / 16) * (Math.PI / 2));
    } else if (y < 35) { // Neck
      const dy = y - 30;
      r = 4.5 + (dy * dy * 0.08);
    } else { // Torso
      const dy = y - 42;
      r = 8.5 * Math.cos((dy / 15) * (Math.PI / 2));
    }

    if (r > 0) {
      for (let dx = -Math.floor(r); dx <= Math.floor(r); dx++) {
        const x = cx + dx;
        if (x < 0 || x >= S) continue;
        const n = noise(x * 3, y * 3, 499) * 35;
        const br = 180 + n;
        const bg = 170 + n;
        const bb = 150 + n;
        const shadow = (dx > r * 0.4) ? -30 : (dx < -r * 0.4) ? 20 : 0;
        t[y * S + x] = rgba(clamp(br + shadow), clamp(bg + shadow), clamp(bb + shadow));
      }
    }
  }
}

function drawLegs(t: Uint32Array, cx: number): void {
  for (let y = 52; y < 62; y++) {
    const dy = y - 52;
    const r = 2.5 - dy * 0.1;
    const sep = 3 + dy * 0.1;
    for (let dx = -Math.floor(r); dx <= Math.floor(r); dx++) {
      let lx = Math.floor(cx - sep + dx);
      if (lx >= 0 && lx < S) {
        let n = noise(lx * 3, y * 3, 499) * 35;
        t[y * S + lx] = rgba(clamp(160 + n), clamp(150 + n), clamp(130 + n));
      }
      let rx = Math.floor(cx + sep + dx);
      if (rx >= 0 && rx < S) {
        let n = noise(rx * 3, y * 3, 499) * 35;
        t[y * S + rx] = rgba(clamp(140 + n), clamp(130 + n), clamp(110 + n));
      }
    }
  }
}

function drawArms(t: Uint32Array, cx: number): void {
  for (let y = 35; y < 41; y++) {
    const dy = y - 38;
    const armR = 2.5 - Math.abs(dy) * 0.4;
    for (let dx = -Math.floor(armR); dx <= Math.floor(armR); dx++) {
      let lx = Math.floor(cx - 9.5 + dx);
      if (lx >= 0 && lx < S) {
        let n = noise(lx * 3, y * 3, 499) * 35;
        t[y * S + lx] = rgba(clamp(150 + n), clamp(140 + n), clamp(120 + n));
      }
      let rx = Math.floor(cx + 9.5 + dx);
      if (rx >= 0 && rx < S) {
        let n = noise(rx * 3, y * 3, 499) * 35;
        t[y * S + rx] = rgba(clamp(130 + n), clamp(120 + n), clamp(100 + n));
      }
    }
  }
}

function drawFacialMarkings(t: Uint32Array, cx: number): void {
  // 1) Central Red/Rust streak
  for (let y = 10; y <= 24; y++) {
    let width = 1;
    if (y >= 14 && y <= 18) width = 2; // wider in the middle
    if (y === 16) width = 3; // diamond center
    if (y === 23 || y === 24) width = 2; // mouth area

    for (let dx = -width; dx <= width; dx++) {
      if (Math.random() > 0.1) {
         t[y * S + cx + dx] = rgba(140, 20, 20); // rust red
      }
    }
  }

  // 2) Green eyes
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dy) === 2) continue; // circle
      t[(14 + dy) * S + cx - 4 + dx] = rgba(100, 160, 60); // Left green
      t[(14 + dy) * S + cx + 4 + dx] = rgba(90, 150, 50); // Right green
    }
  }

  // 3) Black spots
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dy) === 2) continue; // circle
      t[(18 + dy) * S + cx - 4 + dx] = rgba(30, 30, 30); // Left black
      t[(18 + dy) * S + cx + 4 + dx] = rgba(30, 30, 30); // Right black
    }
  }

  // 4) Dark cracks / blemishes
  for (let i = 0; i < 60; i++) {
    const px = cx + Math.floor((Math.random() - 0.5) * 26);
    const py = 6 + Math.floor(Math.random() * 56);
    const idx = py * S + px;
    if (idx >= 0 && idx < t.length && t[idx] !== CLEAR) {
      t[idx] = rgba(50, 50, 40);
    }
  }
}
