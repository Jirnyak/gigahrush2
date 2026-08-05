/* ── Tvar — hunched shadow creature ───────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { rgba, noise, clamp, CLEAR, outline } from '../render/pixutil';
const S = 128;

export const DEF: MonsterDef = {
  kind: MonsterKind.TVAR,
  name: 'Тварь',
  hp: 54,
  speed: 1.65,
  dmg: 13,
  attackRate: 1.15,
  sprite: 0,   // auto-assigned by generateSprites()
  aiFlags: ['foodBait', 'wallBias'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не жмитесь к панели: держите полторы клетки и центр комнаты, а еду или говняк бросайте вбок, чтобы разорвать контакт.',
  lootHint: 'сырая органика, бетонная крошка у лап, редкий кусок мяса',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const sc = S / 64; // scale multiplier

  // Hunched mass
  for (let y = Math.floor(8 * sc); y < Math.floor(55 * sc); y++) {
    const rx = Math.floor(14 * sc);
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / rx, dy = (y - 32 * sc) / (24 * sc);
      if (dx * dx + dy * dy < 1) {
        const n = noise(x, y, 555) * 20;
        const depth = Math.abs(x - cx) * 2 / sc;
        const baseDark = y > 40 * sc ? 15 : 0;
        const dark = baseDark + depth;
        t[y * S + x] = rgba(clamp(45 + n - dark), clamp(40 + n - dark), clamp(50 + n - dark));
      }
    }
  }

  // Panel scars across the shoulders make the wall-born silhouette readable.
  for (let y = Math.floor(21 * sc); y < Math.floor(47 * sc); y += Math.max(1, Math.floor(7 * sc))) {
    const lean = Math.sin(y * 0.31 / sc) * 2 * sc;
    for (let dx = Math.floor(-10 * sc); dx <= Math.floor(10 * sc); dx++) {
      const x = Math.floor(cx + dx + lean);
      if (x < 0 || x >= S) continue;
      if (Math.abs(dx) > 8 * sc && y < 30 * sc) continue;
      const n = noise(x, y, 558) * 14;
      t[y * S + x] = rgba(clamp(82 + n), clamp(80 + n), clamp(76 + n));
    }
  }

  // Wall-scraping forelimbs
  for (let y = Math.floor(25 * sc); y < Math.floor(50 * sc); y += Math.max(1, Math.floor(2 * sc))) {
    const reach = (y / sc - 25) * 0.24 * sc;
    const lx = Math.floor(cx - 12 * sc - reach);
    const rx = Math.floor(cx + 12 * sc + reach);
    const n = noise(y, 0, 559) * 16;
    if (lx >= 0 && lx < S) t[y * S + lx] = rgba(clamp(86 + n), clamp(82 + n), clamp(78 + n));
    if (rx >= 0 && rx < S) t[y * S + rx] = rgba(clamp(86 + n), clamp(82 + n), clamp(78 + n));
  }

  // Multiple eyes with bright cores
  for (const [ex, ey] of [[-5,16],[-2,14],[2,14],[5,16],[0,18]]) {
    const px = Math.floor(cx + ex * sc);
    const py = Math.floor(ey * sc);
    if (px >= 0 && px < S && py >= 0 && py < S) {
      t[py * S + px] = rgba(255, 255, 255); // bright core
      if (px - 1 >= 0) t[py * S + px - 1] = rgba(180, 255, 180);
      if (px + 1 < S) t[py * S + px + 1] = rgba(180, 255, 180);
      if (py - 1 >= 0) t[(py - 1) * S + px] = rgba(180, 255, 180);
      if (py + 1 < S) t[(py + 1) * S + px] = rgba(80, 170, 90);
    }
  }

  outline(t, rgba(15, 15, 18));
  return t;
}
