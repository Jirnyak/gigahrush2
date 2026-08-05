import {
  SCREEN_FRAMES,
  SCREEN_VARIANTS,
  proceduralScreenTex,
} from '../data/procedural_screen_textures';
import { drawTextCentered } from './text';
import { S, rgba, noise, clamp } from './pixutil';

function tpx(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function fillRect(t: Uint32Array, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) tpx(t, xx, yy, c);
}

function strokeRect(t: Uint32Array, x: number, y: number, w: number, h: number, c: number): void {
  for (let i = 0; i < w; i++) { tpx(t, x + i, y, c); tpx(t, x + i, y + h - 1, c); }
  for (let i = 0; i < h; i++) { tpx(t, x, y + i, c); tpx(t, x + w - 1, y + i, c); }
}

function drawLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: number): void {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    tpx(t, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = err * 2;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawCircle(t: Uint32Array, cx: number, cy: number, r: number, c: number, fill: boolean): void {
  const r2 = r * r;
  const inner = Math.max(0, r - 1);
  const inner2 = inner * inner;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dy * dy;
    if (fill ? d2 <= r2 : d2 <= r2 && d2 >= inner2) tpx(t, cx + dx, cy + dy, c);
  }
}

function drawScreenCase(t: Uint32Array, seed: number, frame: number): void {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = noise(x, y, seed) * 22 - 11;
    const seam = (x < 2 || x > S - 3 || y < 2 || y > S - 3) ? -20 : 0;
    t[y * S + x] = rgba(clamp(34 + n + seam), clamp(36 + n + seam), clamp(38 + n + seam));
  }
  fillRect(t, 4, 6, 56, 45, rgba(12, 13, 15));
  strokeRect(t, 4, 6, 56, 45, rgba(78, 82, 88));
  strokeRect(t, 7, 9, 50, 38, rgba(6, 7, 9));
  fillRect(t, 7, 49, 50, 8, rgba(22, 23, 25));
  for (let x = 12; x <= 48; x += 12) {
    const on = ((x + seed + frame * 3) & 1) === 0;
    drawCircle(t, x, 53, 2, on ? rgba(75, 220, 95) : rgba(80, 55, 45), true);
  }
}

function drawScanlines(t: Uint32Array, c = rgba(0, 0, 0, 45)): void {
  for (let y = 11; y < 46; y += 3) for (let x = 8; x < 57; x++) tpx(t, x, y, c);
}

function drawSamosborWarning(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(22, 12, 34));
  for (let y = 10; y < 46; y++) for (let x = 8; x < 56; x++) {
    const n = noise(x + frame * 5, y - frame * 3, 610) * 32;
    tpx(t, x, y, rgba(clamp(28 + n), clamp(8 + n * 0.4), clamp(50 + n)));
  }
  for (let x = 10; x < 55; x += 8) fillRect(t, x, 12, 4, 4, (x + frame) & 8 ? rgba(235, 45, 210) : rgba(255, 210, 40));
  drawLine(t, 18, 36, 32, 14, rgba(245, 220, 60));
  drawLine(t, 32, 14, 46, 36, rgba(245, 220, 60));
  drawLine(t, 46, 36, 18, 36, rgba(245, 220, 60));
  fillRect(t, 30, 20, 4, 10, rgba(245, 220, 60));
  fillRect(t, 30, 33, 4, 3, rgba(245, 220, 60));
  fillRect(t, 8, 38, 48, 8, rgba(45, 8, 60));
  drawTextCentered(t, frame & 1 ? 'ШЛЮЗ' : 'СБОР', 39, rgba(255, 230, 110));
  drawScanlines(t);
}

function drawShortageGraph(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(28, 22, 10));
  for (let x = 12; x < 54; x += 8) drawLine(t, x, 12, x, 44, rgba(20, 70, 48));
  for (let y = 14; y < 44; y += 6) drawLine(t, 10, y, 54, y, rgba(70, 60, 30));
  let px = 10, py = 18;
  for (let i = 0; i < 12; i++) {
    const x = 10 + i * 4;
    const y = 18 + Math.min(24, i * 2 + Math.floor(noise(i, frame, 620) * 6));
    drawLine(t, px, py, x, y, rgba(230, 70, 45));
    px = x; py = y;
  }
  for (let i = 0; i < 7; i++) {
    const h = Math.max(2, 18 - i * 2 + Math.floor(noise(i, frame, 621) * 4));
    fillRect(t, 12 + i * 6, 44 - h, 3, h, i < 3 ? rgba(190, 155, 45) : rgba(130, 55, 45));
  }
  drawTextCentered(t, frame & 1 ? 'ВОДА' : 'ПАЙК', 12, rgba(250, 220, 120));
  drawScanlines(t);
}

function drawFactionMap(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(16, 18, 22));
  const cols = [rgba(210, 160, 55), rgba(80, 155, 220), rgba(165, 65, 205), rgba(160, 55, 45)];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 11 + col * 9;
      const y = 13 + row * 7;
      const c = cols[(row + col + frame) % cols.length];
      fillRect(t, x, y, 7, 5, c);
      if (noise(col, row, 630 + frame) > 0.62) strokeRect(t, x, y, 7, 5, rgba(240, 230, 160));
    }
  }
  drawLine(t, 8, 36, 56, 36, rgba(90, 90, 80));
  drawTextCentered(t, frame & 1 ? 'ШТАБ' : 'ЗОНА', 38, rgba(230, 225, 170));
  drawScanlines(t);
}

function drawLiftAnomaly(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(10, 18, 20));
  strokeRect(t, 20, 13, 24, 25, rgba(95, 115, 120));
  drawLine(t, 32, 13, 32, 38, rgba(55, 70, 75));
  for (let y = 15; y < 37; y += 6) drawLine(t, 22, y, 42, y + ((frame + y) & 1 ? 1 : -1), rgba(32, 52, 58));
  drawLine(t, 14, 18, 14, 30, rgba(60, 230, 210));
  drawLine(t, 14, 18, 10, 22, rgba(60, 230, 210));
  drawLine(t, 14, 18, 18, 22, rgba(60, 230, 210));
  drawLine(t, 50, 30, 50, 18, rgba(230, 80, 70));
  drawLine(t, 50, 30, 46, 26, rgba(230, 80, 70));
  drawLine(t, 50, 30, 54, 26, rgba(230, 80, 70));
  const errY = 40 + (frame & 1);
  fillRect(t, 8, errY, 48, 5, rgba(55, 18, 18));
  drawTextCentered(t, 'ЛИФТ', errY, rgba(245, 120, 90));
  drawScanlines(t);
}

function drawMinistry(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(48, 14, 14));
  strokeRect(t, 10, 12, 44, 28, rgba(190, 160, 80));
  for (let i = 0; i < 5; i++) {
    const y = 15 + i * 5;
    fillRect(t, 13, y, 8, 3, i === frame ? rgba(240, 220, 120) : rgba(125, 95, 65));
    drawLine(t, 25, y + 1, 46 - ((i + frame) % 9), y + 1, rgba(235, 220, 180));
  }
  drawCircle(t, 46, 24, 6, frame & 1 ? rgba(180, 30, 25) : rgba(120, 25, 22), false);
  drawTextCentered(t, frame & 1 ? 'ОКНО' : '№' + (17 + frame), 41, rgba(245, 225, 170));
  drawScanlines(t);
}

function drawHomeTv(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(25, 21, 17));
  if ((frame & 1) === 0) {
    fillRect(t, 12, 14, 12, 18, rgba(120, 90, 45));
    fillRect(t, 28, 18, 8, 14, rgba(80, 130, 170));
    fillRect(t, 40, 16, 9, 16, rgba(165, 70, 50));
    fillRect(t, 8, 36, 48, 10, rgba(50, 28, 18));
    drawTextCentered(t, 'ПАЙК', 38, rgba(245, 225, 155));
  } else {
    for (let i = 0; i < 6; i++) {
      const h = 4 + Math.floor(noise(i, frame, 650) * 18);
      fillRect(t, 12 + i * 7, 34 - h, 4, h, i < 2 ? rgba(210, 175, 80) : rgba(150, 65, 55));
    }
    drawTextCentered(t, 'НЕТ', 38, rgba(245, 120, 80));
  }
  for (let i = 0; i < 80; i++) {
    const x = 8 + Math.floor(noise(i, frame, 650) * 48);
    const y = 10 + Math.floor(noise(frame, i, 651) * 36);
    tpx(t, x, y, rgba(230, 230, 230, 90));
  }
  drawScanlines(t);
}

function drawMaintenance(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(8, 28, 30));
  for (let i = 0; i < 3; i++) {
    const cx = 18 + i * 14;
    drawCircle(t, cx, 23, 6, rgba(82, 130, 125), false);
    const a = -2.4 + noise(i, frame, 660) * 4.8;
    drawLine(t, cx, 23, cx + Math.round(Math.cos(a) * 5), 23 + Math.round(Math.sin(a) * 5), rgba(230, 80, 60));
  }
  for (let x = 10; x < 54; x += 3) {
    const y = 40 + Math.round(Math.sin((x + frame * 7) * 0.45) * 3);
    tpx(t, x, y, rgba(70, 230, 220));
  }
  drawTextCentered(t, 'ДАВЛ', 12, rgba(155, 245, 235));
  drawScanlines(t);
}

function drawHell(t: Uint32Array, frame: number): void {
  fillRect(t, 8, 10, 48, 36, rgba(8, 4, 14));
  for (let y = 10; y < 46; y++) for (let x = 8; x < 56; x++) {
    const n = noise(x + frame * 3, y - frame * 2, 670);
    if (n > 0.72) tpx(t, x, y, n > 0.9 ? rgba(190, 40, 130) : rgba(40, 30, 80));
  }
  for (let i = 0; i < 4; i++) strokeRect(t, 14 + i * 7, 15 + i * 4, 34 - i * 8, 24 - i * 5, rgba(90 + i * 35, 40, 130 + i * 20));
  drawLine(t, 11, 14 + frame * 4, 53, 36 - frame * 3, rgba(205, 45, 160));
  drawLine(t, 16, 40 - frame * 2, 48, 14 + frame * 3, rgba(70, 230, 210));
  drawTextCentered(t, frame & 1 ? 'ПУСТ' : 'VOID', 38, rgba(220, 210, 255));
  drawScanlines(t, rgba(40, 0, 0, 70));
}

export function generateProceduralScreenTextures(textures: Uint32Array[]): void {
  for (let variant = 0; variant < SCREEN_VARIANTS; variant++) {
    for (let frame = 0; frame < SCREEN_FRAMES; frame++) {
      const t = textures[proceduralScreenTex(variant, frame)];
      drawScreenCase(t, 600 + variant * 40, frame);
      switch (variant) {
        case 0: drawSamosborWarning(t, frame); break;
        case 1: drawShortageGraph(t, frame); break;
        case 2: drawFactionMap(t, frame); break;
        case 3: drawLiftAnomaly(t, frame); break;
        case 4: drawMinistry(t, frame); break;
        case 5: drawHomeTv(t, frame); break;
        case 6: drawMaintenance(t, frame); break;
        default: drawHell(t, frame); break;
      }
    }
  }
}
