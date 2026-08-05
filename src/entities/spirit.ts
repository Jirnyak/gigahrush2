/* ── Spirit — ghostly skull face (дух) ────────────────────────── */
/*   Whitish distorted face with hollow eye sockets.             */
/*   Floats through walls.                                       */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SPIRIT,
  name: 'Дух',
  hp: 40,
  speed: 2.0,
  dmg: 15,
  attackRate: 1.5,
  sprite: 0,   // auto-assigned by generateSprites()
  aiFlags: ['flying'],
  floors: [FloorLevel.MINISTRY, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Двери и стены не держат духа: меняйте позицию до контакта, держите дистанцию и сбивайте темп УФ-светом.',
  lootHint: 'пустая память, холодный сквозняк, редкая ПСИ-пыль',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const cy = S / 2 - 4;

  // Pale phase veil keeps the wall-passing threat visible without making it solid.
  for (let y = 0; y < S - 2; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - cx) / 16;
      const dy = (y - cy) / 21;
      const r2 = dx * dx + dy * dy + noise(x * 2, y * 2, 6659) * 0.14;
      if (r2 < 0.78 || r2 > 1.24) continue;
      const fade = 1 - Math.abs(r2 - 1.01) / 0.23;
      const pulse = noise(x * 5, y, 6660);
      const alpha = clamp(Math.floor(34 + fade * 58 + pulse * 22));
      t[y * S + x] = rgba(118, 194, 226, alpha);
    }
  }

  // Skull shape — elongated oval, whitish with noise distortion
  for (let y = 2; y < S - 6; y++) {
    for (let x = 2; x < S - 2; x++) {
      const dx = (x - cx) / 12;
      const dy = (y - cy) / 16;
      // Distort shape with noise for creepy irregularity
      const distort = noise(x * 3, y * 3, 6661) * 0.25 - 0.12;
      const r2 = dx * dx + dy * dy + distort;
      if (r2 > 1) continue;

      // Base bone-white with grey-green tint
      const n1 = noise(x, y, 6662) * 30 - 15;
      const n2 = noise(x * 2, y * 2, 6663) * 20 - 10;
      const edge = Math.max(0, 1 - r2);
      const bright = 180 + edge * 60;
      let cr = clamp(bright + n1);
      let cg = clamp(bright - 8 + n2);
      let cb = clamp(bright - 15 + n1 * 0.7);
      // Fade alpha at edges for ghostly look
      const alpha = clamp(Math.floor(120 + 135 * Math.min(1, edge * 2.8)));

      // Eye sockets — two large dark voids
      const eyeY = cy - 2;
      const eyeLX = cx - 5, eyeRX = cx + 5;
      const eyeW = 3.5, eyeH = 4.5;
      const leDx = (x - eyeLX) / eyeW, leDy = (y - eyeY) / eyeH;
      const reDx = (x - eyeRX) / eyeW, reDy = (y - eyeY) / eyeH;
      const inLeftEye = leDx * leDx + leDy * leDy < 1;
      const inRightEye = reDx * reDx + reDy * reDy < 1;
      if (inLeftEye || inRightEye) {
        // Hollow black void with faint inner glow
        const eyeR2 = inLeftEye ? (leDx * leDx + leDy * leDy) : (reDx * reDx + reDy * reDy);
        const glow = Math.max(0, 1 - eyeR2) * 0.3;
        cr = clamp(Math.floor(10 + glow * 40));
        cg = clamp(Math.floor(5 + glow * 20));
        cb = clamp(Math.floor(15 + glow * 50));
      }

      // Nose cavity — small dark triangle
      const noseY = cy + 4;
      if (Math.abs(x - cx) < 2 && y >= noseY && y < noseY + 3) {
        const nd = (y - noseY) / 3;
        if (Math.abs(x - cx) < 1 + nd) {
          cr = clamp(30 + Math.floor(n1));
          cg = clamp(25 + Math.floor(n2));
          cb = clamp(35);
        }
      }

      // Mouth — jagged dark line with teeth hints
      const mouthY = cy + 9;
      if (y >= mouthY && y <= mouthY + 2 && Math.abs(x - cx) < 9) {
        const toothPattern = noise(x * 7, 0, 6664);
        if (y === mouthY) {
          // Dark seam
          cr = clamp(40 + Math.floor(n1));
          cg = clamp(35);
          cb = clamp(45);
        } else if (toothPattern > 0.5) {
          // Teeth — brighter
          cr = clamp(200 + Math.floor(n1));
          cg = clamp(195 + Math.floor(n2));
          cb = clamp(185);
        }
      }

      // Cracks — dark lines across skull for distortion
      const crack1 = Math.abs(noise(x + y * 0.3, y * 0.7, 6665) - 0.5);
      const crack2 = Math.abs(noise(x * 0.5 + y, y * 0.4, 6666) - 0.5);
      if (crack1 < 0.03 || crack2 < 0.025) {
        cr = Math.floor(cr * 0.4);
        cg = Math.floor(cg * 0.35);
        cb = Math.floor(cb * 0.45);
      }

      t[y * S + x] = rgba(cr, cg, cb, alpha);
    }
  }

  return t;
}
