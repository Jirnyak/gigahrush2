/* ── Shadow — dark ambush silhouette (теневик) ────────────────── */
/*   Black humanoid figure with readable violet rim and eye cues. */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { rgba, noise, clamp, CLEAR, outline } from '../render/pixutil';
const S = 128;

export const DEF: MonsterDef = {
  kind: MonsterKind.SHADOW,
  name: 'Теневик',
  hp: 50,
  speed: 2.4,
  dmg: 12,
  attackRate: 1.0,
  sprite: 0,   // auto-assigned by generateSprites()
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Темный рывок читается паузой силуэта: шагните в свет, включите фонарь или разорвите дистанцию до первого удара.',
  lootHint: 'темный след, холодная пыль, редкий странный сгусток',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const sc = S / 64; // scale multiplier

  // Faint afterimage makes the ambush readable even against dark walls.
  for (let y = Math.floor(6 * sc); y < Math.floor(60 * sc); y++) {
    const fade = y < 18 * sc ? 0.6 : y > 48 * sc ? (60 * sc - y) / (12 * sc) : 1;
    const halfW = (y < 18 * sc ? 8 : y < 42 * sc ? 11 : 8) * sc;
    for (let side = -1; side <= 1; side += 2) {
      const edgeX = Math.floor(cx + side * (halfW + 1 + noise(y, side, 1098) * 2 * sc));
      if (edgeX < 0 || edgeX >= S) continue;
      const a = Math.floor((38 + noise(edgeX, y, 1099) * 46) * fade);
      if (a > 8) t[y * S + edgeX] = rgba(70, 38, 92, a);
    }
  }

  // Head — slightly oval, very dark with noise
  for (let y = Math.floor(4 * sc); y < Math.floor(18 * sc); y++) {
    for (let x = Math.floor(cx - 6 * sc); x < Math.floor(cx + 6 * sc); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / (6 * sc), dy = (y - 11 * sc) / (7 * sc);
      if (dx * dx + dy * dy < 1) {
        const n = noise(x, y, 1101) * 8;
        t[y * S + x] = rgba(clamp(8 + n), clamp(8 + n), clamp(10 + n));
      }
    }
  }

  // Eyes — small but bright enough to warn before contact
  for (const exBase of [-3, 3]) {
    for (let dy = 0; dy < Math.max(1, Math.floor(2 * sc)); dy++) {
      for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
        const px = Math.floor(cx + exBase * sc) + dx;
        const eY1 = Math.floor(9 * sc) + dy;
        const eY2 = Math.floor(10 * sc) + dy;
        const eY3 = Math.floor(11 * sc) + dy;

        t[eY1 * S + px] = rgba(88, 48, 118, 180);
        t[eY2 * S + px] = rgba(255, 255, 255); // bright core (255 instead of 184 for contrast)
        t[eY3 * S + px] = rgba(116, 54, 168);
        if (exBase > 0 && px - 1 >= 0) t[eY2 * S + px - 1] = rgba(74, 34, 104, 190);
        if (px + 1 < S) t[eY2 * S + px + 1] = rgba(74, 34, 104, 190);
      }
    }
  }

  // Torso — tall slender black form with wispy edges
  for (let y = Math.floor(18 * sc); y < Math.floor(50 * sc); y++) {
    const taper = (y < 25 * sc ? 8 : y < 40 * sc ? 7 : 5) * sc;
    const wispL = noise(y, 0, 1102) * 3 * sc;
    const wispR = noise(0, y, 1103) * 3 * sc;
    for (let x = Math.floor(cx - taper - wispL); x < Math.floor(cx + taper + wispR); x++) {
      if (x < 0 || x >= S) continue;
      const edgeDist = Math.min(x - (cx - taper), (cx + taper) - x) / sc;
      const n = noise(x, y, 1104) * 6;
      // Edges are semi-transparent (wispy shadow)
      const alpha = edgeDist < 2 ? 120 + Math.floor(noise(x, y, 1105) * 80) : 255;
      const edgeGlow = edgeDist < 1.2 ? 14 : 0;
      t[y * S + x] = rgba(clamp(6 + n + edgeGlow), clamp(6 + n), clamp(8 + n + edgeGlow), alpha);
    }
  }

  // Shoulder breaks: a player should read a body, not a black column.
  for (let y = Math.floor(19 * sc); y < Math.floor(28 * sc); y++) {
    const hw = Math.floor((9 - (y / sc - 19) / 3) * sc);
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      const xl = Math.floor(cx - hw) + dx;
      const xr = Math.floor(cx + hw) + dx;
      if (xl >= 0 && xl < S) t[y * S + xl] = rgba(92, 46, 112, 135);
      if (xr >= 0 && xr < S) t[y * S + xr] = rgba(92, 46, 112, 135);
    }
  }

  // Arms — thin trailing wisps
  for (let y = Math.floor(22 * sc); y < Math.floor(44 * sc); y++) {
    const spread = (y / sc - 22) * 0.3 * sc;
    const lx = Math.floor(cx - 9 * sc - spread + noise(y, 1, 1106) * 2 * sc);
    const rx = Math.floor(cx + 9 * sc + spread - noise(1, y, 1107) * 2 * sc);
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      if (lx + dx >= 0 && lx + dx < S) t[y * S + lx + dx] = rgba(48, 26, 62, 165);
      if (rx + dx >= 0 && rx + dx < S)  t[y * S + rx + dx] = rgba(48, 26, 62, 165);
      if (lx + 1 + dx >= 0 && lx + 1 + dx < S) t[y * S + lx + 1 + dx] = rgba(6, 6, 8, 180);
      if (rx - 1 + dx >= 0 && rx - 1 + dx < S) t[y * S + rx - 1 + dx] = rgba(6, 6, 8, 180);
    }
  }

  // Lower body dissolves into wisps — no distinct legs
  for (let y = Math.floor(50 * sc); y < Math.floor(62 * sc); y++) {
    const fade = (y / sc - 50) / 12;
    const halfW = Math.floor(5 * (1 - fade) * sc);
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      if (x < 0 || x >= S) continue;
      const alpha = Math.floor(200 * (1 - fade) * (0.5 + noise(x, y, 1108) * 0.5));
      if (alpha > 10) t[y * S + x] = rgba(5, 5, 7, alpha);
    }
  }

  outline(t, rgba(20, 5, 35, 255), 180);
  return t;
}
