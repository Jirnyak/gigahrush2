/* ── Neuro-interface HUD visual effects ───────────────────────── *
 * Procedural VHS / neural-interface distortion for HUD overlay.   *
 * All state-free — pure functions of time.                        *
 * ────────────────────────────────────────────────────────────── */

/* ── Seeded pseudo-random ─────────────────────────────────────── */
function hash(n: number): number {
  let x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}

function hash2(a: number, b: number): number {
  return hash(a * 12.9898 + b * 78.233);
}

function hashByte(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = (n * 0x27d4eb2d) | 0;
  n ^= n >>> 15;
  return n & 255;
}

interface StaticNoiseCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  w: number;
  h: number;
  seed: number;
}

const STATIC_NOISE_MAX_W = 160;
const STATIC_NOISE_MAX_H = 100;
const STATIC_NOISE_PIXEL_SCALE = 6;
let staticNoiseCache: StaticNoiseCache | null = null;

function getStaticNoiseCache(w: number, h: number): StaticNoiseCache {
  if (staticNoiseCache && staticNoiseCache.w === w && staticNoiseCache.h === h) {
    return staticNoiseCache;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const noiseCtx = canvas.getContext('2d', { alpha: true })!;
  staticNoiseCache = {
    canvas,
    ctx: noiseCtx,
    image: noiseCtx.createImageData(w, h),
    w,
    h,
    seed: -1,
  };
  return staticNoiseCache;
}

function updateStaticNoise(cache: StaticNoiseCache, seed: number): void {
  if (cache.seed === seed) return;
  cache.seed = seed;
  const data = cache.image.data;
  const count = cache.w * cache.h;
  for (let i = 0; i < count; i++) {
    const v = hashByte(seed * 374761393 + i * 668265263);
    const di = i << 2;
    data[di] = v;
    data[di + 1] = v;
    data[di + 2] = v;
    data[di + 3] = 255;
  }
  cache.ctx.putImageData(cache.image, 0, 0);
}

/* ── Text jitter: small XY offset that varies over time ───────── *
 * Each text element gets a unique `seed` for distinct motion.     */
export function textJitter(time: number, seed: number): { dx: number; dy: number } {
  // Slow drift + fast micro-jitter
  const phase = time * 0.7 + seed * 137.1;
  const drift = Math.sin(phase) * 0.6;
  const jitterX = (hash2(Math.floor(time * 12), seed) - 0.5) * 1.2;
  const jitterY = (hash2(Math.floor(time * 10), seed + 50) - 0.5) * 0.8;
  return {
    dx: drift + jitterX,
    dy: jitterY,
  };
}

/* ── Alpha flicker: procedural opacity pulsation ──────────────── */
export function flicker(time: number, seed: number): number {
  const base = 0.92;
  const pulse = Math.sin(time * 2.3 + seed * 7.1) * 0.03;
  const glitch = hash2(Math.floor(time * 6), seed) > 0.93 ? -0.15 : 0;
  return Math.max(0.5, Math.min(1, base + pulse + glitch));
}

/* ── Draw neuro-panel background with glitch border ───────────── */
export function drawNeuroPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  time: number, seed = 0,
): void {
  ctx.save();

  // Main background — dark with subtle cyan tint
  ctx.fillStyle = 'rgba(2,8,16,0.92)';
  ctx.fillRect(x, y, w, h);

  // Scanline overlay inside panel
  const lineH = 2;
  ctx.fillStyle = 'rgba(0,255,200,0.015)';
  for (let ly = 0; ly < h; ly += lineH * 2) {
    ctx.fillRect(x, y + ly, w, lineH);
  }

  // Horizontal noise lines (rare, procedural)
  const barSeed = Math.floor(time * 3) + seed;
  for (let i = 0; i < 3; i++) {
    const rh = hash2(barSeed, i + seed * 10);
    if (rh > 0.85) {
      const ly = y + rh * h;
      const alpha = (rh - 0.85) * 2;
      ctx.fillStyle = `rgba(0,220,180,${alpha * 0.08})`;
      ctx.fillRect(x, ly, w, 1);
    }
  }

  // Border — thin glowing lines with occasional breaks
  ctx.strokeStyle = 'rgba(0,200,180,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // Corner accents
  const cornerLen = Math.min(12, w * 0.1, h * 0.1);
  ctx.strokeStyle = 'rgba(0,255,220,0.5)';
  ctx.lineWidth = 1.5;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen);
  ctx.stroke();

  ctx.restore();
}

/* ── Draw holographic status bar ──────────────────────────────── */
export function drawHoloBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  pct: number, color: string, time: number, seed = 0,
): void {
  ctx.save();
  const fillW = w * Math.max(0, Math.min(1, pct / 100));

  // Background track
  ctx.fillStyle = 'rgba(10,20,30,0.8)';
  ctx.fillRect(x, y, w, h);

  // Fill with animated scanlines
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85 + Math.sin(time * 1.5 + seed) * 0.1;
  ctx.fillRect(x, y, fillW, h);

  // Inner scanline pattern
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#000';
  for (let ly = 0; ly < h; ly += 2) {
    ctx.fillRect(x, y + ly, fillW, 1);
  }
  ctx.globalAlpha = 1;

  // Glow edge at fill boundary
  if (fillW > 2) {
    const glowX = x + fillW - 1;
    const grd = ctx.createLinearGradient(glowX - 4, 0, glowX + 2, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(glowX - 4, y, 6, h);
  }

  // Thin border
  ctx.strokeStyle = 'rgba(0,200,180,0.2)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);

  ctx.restore();
}

/* ── Draw text with procedural jitter and optional glow ───────── */
export function drawGlitchText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number,
  time: number, seed: number,
  color = '#ccc',
  fontSize = 8,
): void {
  const j = textJitter(time, seed);
  const alpha = flicker(time, seed + 77);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px monospace`;

  // Occasional character dropout (1 char replaced with noise)
  const dropIdx = hash2(Math.floor(time * 4), seed) > 0.92
    ? Math.floor(hash2(Math.floor(time * 4) + 1, seed) * text.length)
    : -1;

  let rendered = text;
  if (dropIdx >= 0 && dropIdx < text.length) {
    const glitchChars = '░▒▓█▄▀│┤╡╢';
    const gc = glitchChars[Math.floor(hash2(Math.floor(time * 8), seed + 3) * glitchChars.length)];
    rendered = text.substring(0, dropIdx) + gc + text.substring(dropIdx + 1);
  }

  ctx.fillText(rendered, x + j.dx, y + j.dy);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ── Static noise overlay on a rectangular region ─────────────── */
export function drawStaticNoise(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  time: number, intensity = 0.03,
): void {
  if (intensity <= 0 || w <= 0 || h <= 0) return;
  const noiseW = Math.max(8, Math.min(STATIC_NOISE_MAX_W, Math.ceil(w / STATIC_NOISE_PIXEL_SCALE)));
  const noiseH = Math.max(8, Math.min(STATIC_NOISE_MAX_H, Math.ceil(h / STATIC_NOISE_PIXEL_SCALE)));
  const cache = getStaticNoiseCache(noiseW, noiseH);
  updateStaticNoise(cache, Math.floor(time * 12));

  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache.canvas, x, y, w, h);
  ctx.restore();
}

/* ── Cheap brown-grey smog veil for bounded procedural anomaly ── */
export function drawSmogVeil(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  intensity: number,
): void {
  const a = Math.max(0, Math.min(1, intensity));
  if (a <= 0) return;
  ctx.save();
  const edge = Math.min(0.24, 0.07 + a * 0.16);
  const grd = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
  grd.addColorStop(0, `rgba(66,60,48,${a * 0.05})`);
  grd.addColorStop(0.72, `rgba(76,68,52,${a * 0.11})`);
  grd.addColorStop(1, `rgba(28,24,18,${edge})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const y = ((hash2(Math.floor(time * 0.7), i + 71) + i / rows) % 1) * h;
    const bh = (5 + hash2(i, Math.floor(time)) * 12) * (0.7 + a);
    ctx.fillStyle = `rgba(118,106,76,${a * 0.035})`;
    ctx.fillRect(0, y, w, bh);
  }
  drawStaticNoise(ctx, 0, 0, w, h, time * 0.55, a * 0.018);
  ctx.restore();
}

/* ── Veretar overexposure: dry white HUD veil, not blankout ───── */
export function drawVeretarVeil(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  time: number,
  intensity = 1,
): void {
  const strength = Math.max(0, Math.min(1, intensity));
  if (strength <= 0 || w <= 0 || h <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `rgba(244,241,223,${0.035 * strength})`;
  ctx.fillRect(0, 0, w, h);

  const bandSeed = Math.floor(time * 3);
  for (let i = 0; i < 5; i++) {
    const y = hash2(bandSeed, i * 17) * h;
    const bandH = 1 + hash2(bandSeed + 11, i) * 2;
    ctx.fillStyle = `rgba(248,245,226,${(0.018 + hash2(bandSeed, i + 91) * 0.025) * strength})`;
    ctx.fillRect(0, y, w, bandH);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(59,59,54,${0.045 * strength})`;
  for (let i = 0; i < 18; i++) {
    const sx = hash2(bandSeed + 31, i) * w;
    const sy = hash2(bandSeed + 53, i) * h;
    const sw = 1 + hash2(bandSeed + 71, i) * 2;
    ctx.fillRect(sx, sy, sw, 1);
  }
  ctx.restore();
}

/* ── Horizontal glitch line across the HUD ────────────────────── */
export function drawGlitchLine(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  time: number,
): void {
  const lineSeed = Math.floor(time * 2.5);
  const chance = hash(lineSeed * 13.7);
  if (chance > 0.7) return; // only draw ~30% of the time

  const ly = hash(lineSeed * 31.3) * h;
  const lineH = 1 + hash(lineSeed * 47.1) * 2;
  const alpha = 0.03 + hash(lineSeed * 61.9) * 0.04;

  ctx.save();
  ctx.fillStyle = `rgba(0,255,200,${alpha})`;
  ctx.fillRect(0, ly, w, lineH);
  ctx.restore();
}

export interface SeroburmalineHudFxView {
  intensity: number;
  exposure: number;
  looking: boolean;
  warning: string;
}

export function drawSeroburmalineNoLookFx(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  fx: SeroburmalineHudFxView,
): void {
  const intensity = Math.max(0, Math.min(0.78, fx.intensity));
  if (intensity <= 0.01) return;

  ctx.save();
  const grd = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.16, w * 0.5, h * 0.5, Math.max(w, h) * 0.64);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.58, `rgba(76,52,68,${0.04 * intensity})`);
  grd.addColorStop(1, `rgba(96,54,82,${0.22 * intensity})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const bandCount = 6;
  ctx.lineWidth = 1;
  for (let i = 0; i < bandCount; i++) {
    const phase = time * 1.7 + i * 8.13;
    const y = h * (0.22 + i * 0.105) + Math.sin(phase) * 4;
    const skew = Math.sin(phase * 0.7) * 18;
    ctx.strokeStyle = `rgba(185,132,158,${(0.035 + i * 0.006) * intensity})`;
    ctx.beginPath();
    ctx.moveTo(w * 0.18 + skew, y);
    ctx.lineTo(w * 0.82 - skew, y + Math.sin(phase + 1.7) * 3);
    ctx.stroke();
  }

  if (fx.looking || fx.exposure > 0.28) {
    const fontSize = Math.max(10, Math.min(18, Math.floor(Math.min(w, h) * 0.034)));
    const x = w * 0.5;
    const y = h * 0.5 - fontSize * 3.1;
    const pulse = 0.76 + Math.sin(time * 9) * 0.12;
    ctx.textAlign = 'center';
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.shadowColor = `rgba(190,110,150,${0.45 * intensity})`;
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(235,205,218,${pulse * intensity})`;
    ctx.fillText(fx.warning, x + (hash2(Math.floor(time * 18), 870) - 0.5) * 2.2, y);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.max(8, Math.floor(fontSize * 0.62))}px monospace`;
    ctx.fillStyle = `rgba(190,215,205,${0.56 * intensity})`;
    ctx.fillText('в сторону / вниз / закрыть', x, y + fontSize * 1.15);
  }

  ctx.restore();
}

/* ── Compact route-cue waveform for actionable HUD hints ─────── */
export function drawRouteCueWave(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  time: number,
  color: string,
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.35 + Math.sin(time * 7) * 0.12;
  ctx.beginPath();
  const mid = y + h * 0.5;
  const amp = h * 0.24;
  const steps = Math.max(8, Math.floor(w / 5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x + t * w;
    const py = mid + Math.sin(t * Math.PI * 6 + time * 4.5) * amp * (0.35 + 0.65 * Math.sin(t * Math.PI));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = color;
  ctx.fillRect(x, mid - 0.5, w, 1);
  ctx.restore();
}

/* ── Cached warning channel rows: audio / visual / NPC signal ─── */
export function drawSignalRows(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  time: number,
  color: string,
  lines: readonly string[],
  fontSize: number,
): void {
  const count = Math.min(3, lines.length);
  if (count <= 0 || w <= 0 || h <= 0) return;
  const rowH = h / count;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const textSize = Math.max(6, fontSize);
  const labels = ['ЗВУК', 'КАРТ', 'ЛЮДИ'];
  ctx.font = `bold ${textSize}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < count; i++) {
    const cy = y + rowH * (i + 0.5);
    const pulse = 0.72 + Math.sin(time * 5 + i * 1.7) * 0.16;
    const labelW = Math.max(27, textSize * 4.8);
    ctx.fillStyle = `rgba(255,255,255,${0.06 + i * 0.016})`;
    ctx.fillRect(x, y + i * rowH, w, Math.max(1, rowH - 1));
    ctx.fillStyle = color;
    ctx.globalAlpha = pulse;
    ctx.fillRect(x + 1, cy - rowH * 0.36, 3, Math.max(2, rowH * 0.72));
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(labels[i] ?? 'СИГН', x + 7, cy);
    ctx.font = `${textSize}px monospace`;
    ctx.shadowColor = i === 0 ? color : 'rgba(0,0,0,0)';
    ctx.shadowBlur = i === 0 ? 5 : 0;
    ctx.fillStyle = i === 0 ? '#fff4c2' : '#e4e4e4';
    ctx.fillText(lines[i], x + labelW + 8, cy);
    ctx.shadowBlur = 0;
    ctx.font = `bold ${textSize}px monospace`;
  }
  ctx.restore();
}

export interface RangedThreatCueView {
  label: string;
  color: string;
  progress: number;
  side: number;
}

export function drawRangedThreatCue(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  cue: RangedThreatCueView,
): void {
  const progress = Math.max(0, Math.min(1, cue.progress));
  const panelW = Math.min(w * 0.78, 210);
  const panelH = 28;
  const x = (w - panelW) * 0.5;
  const y = h * 0.5 - 48;
  const pulse = 0.72 + Math.sin(time * 18) * 0.14;
  const side = Math.max(-1, Math.min(1, cue.side));

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(10,5,8,0.72)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cue.color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);

  const meterX = x + 9;
  const meterY = y + panelH - 7;
  const meterW = panelW - 18;
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(meterX, meterY, meterW, 2);
  ctx.fillStyle = cue.color;
  ctx.globalAlpha = 0.6 + progress * 0.35;
  ctx.fillRect(meterX, meterY, meterW * progress, 2);
  ctx.globalAlpha = pulse;

  ctx.textAlign = 'center';
  ctx.font = 'bold 10px monospace';
  ctx.shadowColor = cue.color;
  ctx.shadowBlur = 8;
  const arrow = side < -0.2 ? '< ' : side > 0.2 ? ' >' : '';
  ctx.fillStyle = cue.color;
  ctx.fillText(`ЛИНИЯ ОГНЯ ${cue.label}${arrow}`, w * 0.5 + (hash2(Math.floor(time * 20), 805) - 0.5) * 1.5, y + 6);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/* ── Maronary overlay: bounded green proof/door repeat noise ─── */
export function drawMaronaryProofNoise(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  time: number,
  intensity = 1,
): void {
  const k = Math.max(0, Math.min(1, intensity));
  if (k <= 0) return;

  ctx.save();
  ctx.globalAlpha = 0.1 * k;
  ctx.strokeStyle = '#35ff66';
  ctx.lineWidth = 1;
  const seed = Math.floor(time * 3);
  const count = 2 + Math.floor(hash2(seed, 91) * 3);
  for (let i = 0; i < count; i++) {
    const rw = (18 + hash2(seed, i + 10) * 54) * k;
    const rh = (22 + hash2(seed, i + 20) * 38) * k;
    const x = hash2(seed, i + 30) * Math.max(0, w - rw);
    const y = hash2(seed, i + 40) * Math.max(0, h - rh);
    ctx.strokeRect(x + 0.5, y + 0.5, rw, rh);
  }

  ctx.globalAlpha = 0.045 * k;
  ctx.fillStyle = '#6cff88';
  for (let i = 0; i < 5; i++) {
    const y = hash2(seed, i + 70) * h;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
}
