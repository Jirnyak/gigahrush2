/* ── Procedural surface marks — shader-style splat generator ──── *
 *
 * Each mark is generated pixel-by-pixel via a procedural function
 * (like a fragment shader). The shape is computed from seed + position,
 * producing organic splatters, cracks, scorch marks, drips, etc.
 *
 * Generated marks are stamped onto the world's 16×16 per-cell surface
 * grid, naturally spilling across cell boundaries.
 *
 * ────────────────────────────────────────────────────────────────── */

import { W, Cell } from '../core/types';
import type { World } from '../core/world';

/* ── Fast hash (same family as pixutil.noise) ─────────────────── */
function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = (n * 0x27d4eb2d) | 0;
  n = n ^ (n >>> 15);
  return (n & 0x7fffffff) / 0x7fffffff; // 0..1
}

function hash2(x: number, y: number, s: number): number {
  return hash((x * 374761393 + y * 668265263 + s * 1274126177) | 0);
}

/* smooth noise with bilinear interpolation */
function snoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  const lx = fx * fx * (3 - 2 * fx); // smoothstep
  const ly = fy * fy * (3 - 2 * fy);
  return a + (b - a) * lx + (c - a) * ly + (a - b - c + d) * lx * ly;
}

/* fractal brownian motion — 3 octaves */
function fbm(x: number, y: number, s: number): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 3; i++) {
    v += snoise(x * freq, y * freq, s + i * 137) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

/* ── Mark shape types ─────────────────────────────────────────── */
export const enum MarkType {
  SPLAT,    // blood / fluid splatter — organic, irregular outline with tendrils
  BULLET,   // bullet hole — small dense center + micro-cracks
  SCORCH,   // explosion / flame — radial gradient with charred edges
  DRIP,     // urine / fluid drip — elongated, gravity-pulled
  POOL,     // death pool — large, irregular outline, high coverage
  PSI,      // psi-energy mark — purple, crystalline, angular
  MARONARY, // green proof/source mark — hard ring with impossible scan lines
  BLACK_HAND, // cult route warning — readable palm + fingers
  SEROBURMALINE, // visual-risk slime — gray/magenta crystalline residue
  BURN,     // fire burn — torn/wispy charred patches, semi-transparent
  WEB,      // pale spider web threads — readable adhesive warning
  BULLET_WALL, // precise wall bullet chip — clipped to one cell tile
}

export interface BlackHandMarkCell {
  x: number;
  y: number;
  order: number;
}

export const BLACK_HAND_TRAIL_MAX_MARKS = 12;
const BLACK_HAND_MARK_CELL_CAP = 48;
const EMPTY_BLACK_HAND_MARKS: readonly BlackHandMarkCell[] = [];
const blackHandMarksByWorld = new WeakMap<World, BlackHandMarkCell[]>();

/* ── Fragment shader per mark type ────────────────────────────── *
 * Returns alpha 0..1 for a normalized coordinate (u,v) in [-1..1].
 * The mark is conceptually a unit disk; the shader decides shape.  */

function shaderSplat(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1) return 0;
  // Noisy edge with tendrils
  const angle = Math.atan2(v, u);
  const tendrilFreq = 3 + hash(seed + 11) * 5; // 3-8 tendrils
  const tendrilAmp = 0.15 + hash(seed + 22) * 0.25;
  const nEdge = fbm(angle * tendrilFreq / 6.28, r * 3, seed);
  const edgeR = 0.55 + tendrilAmp * (nEdge - 0.5) * 2;
  // Secondary splotches
  const blobs = fbm(u * 2.5 + hash(seed + 3) * 10, v * 2.5 + hash(seed + 4) * 10, seed + 77);
  const blobBoost = blobs > 0.55 ? (blobs - 0.55) * 3 : 0;
  const dist = r - edgeR - blobBoost * 0.3;
  if (dist > 0.15) return 0;
  if (dist > 0) return 1 - dist / 0.15;
  return 1;
}

function shaderBullet(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  // Dense dark center
  if (r < 0.3) return 1;
  // Micro-cracks radiating out
  const angle = Math.atan2(v, u);
  const crackCount = 4 + Math.floor(hash(seed + 1) * 5); // 4-8 cracks
  const crackPhase = hash(seed + 2) * 6.28;
  let crackAlpha = 0;
  for (let i = 0; i < crackCount; i++) {
    const ca = crackPhase + i * (6.28 / crackCount) + (hash(seed + 10 + i) - 0.5) * 0.8;
    let da = Math.abs(angle - ca);
    if (da > Math.PI) da = 6.28 - da;
    const crackWidth = 0.08 + hash(seed + 20 + i) * 0.06;
    const crackLen = 0.5 + hash(seed + 30 + i) * 0.5;
    if (da < crackWidth && r < crackLen) {
      const t = 1 - r / crackLen;
      crackAlpha = Math.max(crackAlpha, t * (1 - da / crackWidth));
    }
  }
  // Annular ring around center
  const ring = Math.abs(r - 0.35) < 0.08 ? 1 - Math.abs(r - 0.35) / 0.08 : 0;
  return Math.min(1, Math.max(ring * 0.6, crackAlpha) * (r < 1 ? 1 : 0));
}

function shaderWallBullet(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1) return 0;
  if (r < 0.22) return 1;

  const chip = Math.abs(r - 0.34) < 0.11 ? (1 - Math.abs(r - 0.34) / 0.11) * 0.38 : 0;
  const speckle = snoise(u * 10 + seed * 0.17, v * 10 - seed * 0.11, seed + 610) > 0.64 && r < 0.62 ? 0.22 : 0;

  let crackAlpha = 0;
  const crackCount = Math.floor(hash(seed + 31) * 3); // 0-2 cracks
  const phase = hash(seed + 37) * Math.PI * 2;
  for (let i = 0; i < crackCount; i++) {
    const angle = Math.atan2(v, u);
    const ca = phase + i * (Math.PI * 0.72) + (hash(seed + 43 + i) - 0.5) * 0.9;
    let da = Math.abs(angle - ca);
    if (da > Math.PI) da = Math.PI * 2 - da;
    const width = 0.045 + hash(seed + 57 + i) * 0.025;
    const len = 0.52 + hash(seed + 71 + i) * 0.24;
    if (da < width && r < len && r > 0.2) {
      crackAlpha = Math.max(crackAlpha, (1 - da / width) * (1 - r / len) * 0.58);
    }
  }

  return Math.min(1, Math.max(chip, speckle, crackAlpha));
}

function shaderScorch(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1) return 0;
  // Noisy radial with charred edges
  const n = fbm(u * 3 + hash(seed) * 5, v * 3 + hash(seed + 1) * 5, seed + 200);
  const edge = 0.6 + n * 0.35;
  if (r > edge) {
    const outer = (r - edge) / (1 - edge);
    return Math.max(0, (1 - outer) * 0.4);
  }
  return 0.7 + (1 - r / edge) * 0.3;
}

function shaderDrip(u: number, v: number, seed: number): number {
  // Elongated downward (v direction = "down" on the surface)
  const su = u * 1.8; // squish horizontally
  const sv = v * 0.7 - 0.2; // stretch vertically, shift down
  const r = Math.sqrt(su * su + sv * sv);
  if (r > 1) return 0;
  const n = snoise(su * 4, sv * 3, seed);
  const edge = 0.5 + n * 0.3;
  // Drip tail
  if (v > 0.2) {
    const tailWidth = 0.15 - (v - 0.2) * 0.12;
    if (Math.abs(u) < tailWidth) return Math.max(0, 1 - (v - 0.2) * 1.5);
  }
  if (r > edge) return Math.max(0, (1 - (r - edge) / 0.3) * 0.5);
  return 1;
}

function shaderPool(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1) return 0;
  // Large noisy blob
  const n1 = fbm(u * 2 + hash(seed) * 8, v * 2 + hash(seed + 1) * 8, seed + 300);
  const n2 = fbm(u * 4, v * 4, seed + 500);
  const edge = 0.65 + n1 * 0.25;
  const inner = 0.3 + n2 * 0.15;
  if (r > edge) return Math.max(0, (1 - (r - edge) / 0.25) * 0.3);
  if (r < inner) return 0.9 + n2 * 0.1;
  const t = (r - inner) / (edge - inner);
  return 0.9 - t * 0.4;
}

function shaderPsi(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1) return 0;
  // Crystalline angular shape
  const angle = Math.atan2(v, u);
  const sides = 5 + Math.floor(hash(seed) * 4); // 5-8 sides
  const polyR = Math.cos(Math.PI / sides) / Math.cos(((angle + hash(seed + 5)) % (2 * Math.PI / sides)) - Math.PI / sides);
  const pr = r / Math.max(0.01, Math.abs(polyR) * 0.7);
  if (pr > 1) {
    // Glow falloff
    return Math.max(0, (1.3 - pr) / 0.3 * 0.3);
  }
  const n = snoise(u * 5, v * 5, seed + 400);
  return 0.7 + n * 0.3;
}

function shaderMaronary(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1.15) return 0;
  const ring = Math.abs(r - 0.62) < 0.075 ? 1 - Math.abs(r - 0.62) / 0.075 : 0;
  const core = r < 0.16 ? 0.95 : 0;
  const vertical = Math.abs(u) < 0.035 && Math.abs(v) < 0.95 ? (1 - r / 1.15) * 0.65 : 0;
  const diagonal = Math.abs(v - u * 0.55) < 0.04 && r < 1 ? (1 - r) * 0.7 : 0;
  const scan = Math.abs(Math.sin((v + hash(seed + 17) * 0.2) * 34)) > 0.94 && r < 0.88 ? 0.34 : 0;
  return Math.max(core, ring, vertical, diagonal, scan) * (0.78 + snoise(u * 9, v * 9, seed + 900) * 0.22);
}

function ellipseAlpha(u: number, v: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (u - cx) / rx;
  const dy = (v - cy) / ry;
  const q = dx * dx + dy * dy;
  if (q >= 1.12) return 0;
  if (q > 1) return (1.12 - q) / 0.12;
  return 1;
}

function shaderBlackHand(u: number, v: number, seed: number): number {
  const palm = ellipseAlpha(u, v, 0, 0.18, 0.38, 0.42);
  const wrist = ellipseAlpha(u, v, 0, 0.72, 0.22, 0.25) * 0.85;
  const thumb = Math.max(
    ellipseAlpha(u, v, -0.40, 0.17, 0.17, 0.30),
    ellipseAlpha(u, v, -0.50, 0.02, 0.13, 0.23),
  );
  let fingers = 0;
  const fingerX = [-0.25, -0.08, 0.09, 0.25];
  const fingerLen = [0.34, 0.46, 0.43, 0.31];
  for (let i = 0; i < fingerX.length; i++) {
    const jitter = (hash(seed + i * 19) - 0.5) * 0.035;
    fingers = Math.max(fingers, ellipseAlpha(u, v, fingerX[i] + jitter, -0.27 - fingerLen[i] * 0.2, 0.075, fingerLen[i]));
  }
  const base = Math.max(palm, wrist, thumb, fingers);
  if (base <= 0) return 0;
  const worn = fbm(u * 5.5 + 12, v * 5.5 - 7, seed + 880);
  return Math.max(0, Math.min(1, base * (0.78 + worn * 0.25) - (worn < 0.18 ? 0.25 : 0)));
}

function shaderBurn(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1.25) return 0;
  // Multi-layer noise for highly irregular torn shape
  const n1 = fbm(u * 5 + hash(seed) * 10, v * 5 + hash(seed + 1) * 10, seed + 200);
  const n2 = fbm(u * 10 + hash(seed + 2) * 6, v * 10 + hash(seed + 3) * 6, seed + 300);
  const n3 = snoise(u * 16 + hash(seed + 4) * 8, v * 16 + hash(seed + 5) * 8, seed + 400);
  // Very irregular torn edge
  const edge = 0.3 + n1 * 0.35 + n2 * 0.15;
  // Thin wispy tendrils reaching outward
  const tendril = n3 > 0.5 ? (n3 - 0.5) * 2.0 : 0;
  const effectiveR = r - tendril * 0.22;
  if (effectiveR > edge + 0.3) return 0;
  if (effectiveR > edge) {
    // Thin transparent charred fringe — very faint
    const t = (effectiveR - edge) / 0.3;
    return Math.max(0, (1 - t * t) * 0.18);
  }
  // Inner: charred texture with variation — moderate alpha, not opaque
  const inner = 1 - effectiveR / edge;
  const charPat = n2 * 0.25 + inner * 0.4;
  return 0.3 + charPat * 0.45;
}

function shaderSeroburmaline(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1.15) return 0;
  const angle = Math.atan2(v, u);
  const ringNoise = fbm(u * 4 + hash(seed) * 5, v * 4 + hash(seed + 1) * 5, seed + 700);
  const edge = 0.48 + ringNoise * 0.28;
  const radial = r < edge ? 0.72 + (1 - r / Math.max(0.01, edge)) * 0.22 : Math.max(0, (1.15 - r) * 0.28);

  const spokeCount = 7 + Math.floor(hash(seed + 3) * 5);
  let spoke = 0;
  for (let i = 0; i < spokeCount; i++) {
    const a = i * (Math.PI * 2 / spokeCount) + hash(seed + 20 + i) * 0.45;
    let da = Math.abs(angle - a);
    if (da > Math.PI) da = Math.PI * 2 - da;
    const width = 0.025 + hash(seed + 40 + i) * 0.035;
    if (da < width && r < 1.05) spoke = Math.max(spoke, (1 - da / width) * (1 - r * 0.35));
  }

  const grit = snoise(u * 18 + seed, v * 18 - seed, seed + 900) > 0.58 ? 0.22 : 0;
  return Math.min(1, Math.max(radial, spoke * 0.86) + grit);
}

function shaderWeb(u: number, v: number, seed: number): number {
  const r = Math.sqrt(u * u + v * v);
  if (r > 1.1) return 0;
  const angle = Math.atan2(v, u) + hash(seed) * 0.25;
  const spokes = Math.abs(Math.sin(angle * 4)) > 0.94 ? (1 - r * 0.35) : 0;
  const ringA = Math.abs(r - 0.34) < 0.035 ? 1 - Math.abs(r - 0.34) / 0.035 : 0;
  const ringB = Math.abs(r - 0.62) < 0.03 ? 1 - Math.abs(r - 0.62) / 0.03 : 0;
  const sag = Math.abs(v + Math.sin(u * 5 + seed) * 0.06) < 0.026 && Math.abs(u) < 0.92 ? 0.8 : 0;
  const torn = fbm(u * 7 + seed, v * 7 - seed, seed + 333);
  return Math.max(spokes, ringA, ringB, sag) * (0.7 + torn * 0.3);
}

/* ── Shader dispatch ──────────────────────────────────────────── */
const SHADERS: ((u: number, v: number, seed: number) => number)[] = [
  shaderSplat, shaderBullet, shaderScorch, shaderDrip, shaderPool, shaderPsi, shaderMaronary, shaderBlackHand,
  shaderSeroburmaline, shaderBurn, shaderWeb, shaderWallBullet,
];

function blackHandCells(world: World): BlackHandMarkCell[] {
  let cells = blackHandMarksByWorld.get(world);
  if (!cells) {
    cells = [];
    blackHandMarksByWorld.set(world, cells);
  }
  return cells;
}

function hasBlackHandCell(cells: readonly BlackHandMarkCell[], x: number, y: number): boolean {
  for (const cell of cells) if (cell.x === x && cell.y === y) return true;
  return false;
}

function recordBlackHandCell(world: World, x: number, y: number): boolean {
  const cells = blackHandCells(world);
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (hasBlackHandCell(cells, wx, wy)) return true;
  if (cells.length >= BLACK_HAND_MARK_CELL_CAP) return false;
  cells.push({ x: wx, y: wy, order: cells.length });
  return true;
}

function canStampBlackHandCell(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER || cell === Cell.WALL;
}

export function getBlackHandMarkCells(world: World): readonly BlackHandMarkCell[] {
  return blackHandMarksByWorld.get(world) ?? EMPTY_BLACK_HAND_MARKS;
}

export function stampBlackHandMark(
  world: World,
  x: number,
  y: number,
  seed: number,
  intensity = 230,
  wallOk = false,
): boolean {
  const wx = world.wrap(Math.floor(x));
  const wy = world.wrap(Math.floor(y));
  const ci = world.idx(wx, wy);
  if (!canStampBlackHandCell(world.cells[ci])) return false;
  if (!recordBlackHandCell(world, wx, wy)) return false;
  stampMark(world, wx, wy, 0.5, 0.5, 0.46, MarkType.BLACK_HAND, seed, 5, 5, 4, intensity, wallOk || world.cells[ci] === Cell.WALL);
  return true;
}

export function stampBlackHandTrail(
  world: World,
  cells: readonly { x: number; y: number }[],
  seed: number,
  maxMarks = BLACK_HAND_TRAIL_MAX_MARKS,
): number {
  const limit = Math.max(0, Math.min(maxMarks, BLACK_HAND_TRAIL_MAX_MARKS));
  let placed = 0;
  for (const cell of cells) {
    if (placed >= limit) break;
    const x = world.wrap(Math.floor(cell.x));
    const y = world.wrap(Math.floor(cell.y));
    const ci = world.idx(x, y);
    if (!canStampBlackHandCell(world.cells[ci])) continue;
    const wallOk = world.cells[ci] === Cell.WALL;
    if (stampBlackHandMark(world, x, y, seed + placed * 101, 205 + (placed % 3) * 14, wallOk)) placed++;
  }
  return placed;
}

export function paintSurfacePixel(
  world: World,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha = 220,
): boolean {
  const cx = world.wrap(Math.floor(x));
  const cy = world.wrap(Math.floor(y));
  const ci = world.idx(cx, cy);
  const cellKind = world.cells[ci];
  if (cellKind === Cell.WALL || cellKind === Cell.ABYSS) return false;

  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const px = Math.max(0, Math.min(15, Math.floor(fx * 16)));
  const py = Math.max(0, Math.min(15, Math.floor(fy * 16)));
  let cell = world.surfaceMap.get(ci);
  if (!cell) {
    cell = new Uint8Array(1024);
    world.surfaceMap.set(ci, cell);
  }

  const idx = (py * 16 + px) << 2;
  const newA = Math.max(1, Math.min(255, Math.floor(alpha)));
  const curA = cell[idx + 3];
  if (curA === 0) {
    cell[idx] = r; cell[idx + 1] = g; cell[idx + 2] = b; cell[idx + 3] = newA;
  } else {
    const total = curA + newA;
    cell[idx] = Math.floor((cell[idx] * curA + r * newA) / total);
    cell[idx + 1] = Math.floor((cell[idx + 1] * curA + g * newA) / total);
    cell[idx + 2] = Math.floor((cell[idx + 2] * curA + b * newA) / total);
    cell[idx + 3] = Math.min(255, total);
  }
  world.markSurfaceCellDirty(ci);
  return true;
}

function writeSurfacePixel(cell: Uint8Array, idx: number, r: number, g: number, b: number, newA: number): void {
  const curA = cell[idx + 3];
  if (curA === 0) {
    cell[idx] = r; cell[idx + 1] = g; cell[idx + 2] = b; cell[idx + 3] = newA;
  } else {
    const total = curA + newA;
    cell[idx]     = Math.floor((cell[idx]     * curA + r * newA) / total);
    cell[idx + 1] = Math.floor((cell[idx + 1] * curA + g * newA) / total);
    cell[idx + 2] = Math.floor((cell[idx + 2] * curA + b * newA) / total);
    cell[idx + 3] = Math.min(255, total);
  }
}

function recordTouchedCell(cells: number[], idx: number): void {
  if (cells.indexOf(idx) < 0) cells.push(idx);
}

/* ── Generate & stamp a mark onto the world surface grid ──────── *
 *
 * cx, cy   — integer cell coordinates (center cell)
 * fx, fy   — fractional position within center cell (0..1)
 * radius   — radius in cells (e.g. 0.3 = spans ~0.6 cells)
 * type     — MarkType enum
 * seed     — unique seed for shape variation
 * r, g, b  — mark color
 * intensity — max alpha 0..255
 * wallOk   — if true, allows marking on wall cells (for wall splatters)
 */
export function stampMark(
  world: World,
  cx: number, cy: number,
  fx: number, fy: number,
  radius: number,
  type: MarkType,
  seed: number,
  r: number, g: number, b: number,
  intensity = 220,
  wallOk = false,
): void {
  const shader = SHADERS[type] ?? SHADERS[0];
  // Convert to 16×16 grid coordinates
  const centerPx = fx * 16;
  const centerPy = fy * 16;
  const radiusPx = Math.max(1, radius * 16);
  const touchedCells: number[] = [];

  // Scan bounding box of the mark in surface-pixel space
  const r2 = radiusPx + 1;
  for (let dy = -r2; dy <= r2; dy++) {
    for (let dx = -r2; dx <= r2; dx++) {
      // Absolute pixel position relative to center cell's surface grid
      let px = Math.floor(centerPx + dx);
      let py = Math.floor(centerPy + dy);

      // Determine which cell this pixel belongs to
      let cellDx = 0, cellDy = 0;
      while (px < 0)  { px += 16; cellDx--; }
      while (px >= 16) { px -= 16; cellDx++; }
      while (py < 0)  { py += 16; cellDy--; }
      while (py >= 16) { py -= 16; cellDy++; }

      const ncx = ((cx + cellDx) % W + W) % W;
      const ncy = ((cy + cellDy) % W + W) % W;
      const ci = ncy * W + ncx;

      if (!wallOk && world.cells[ci] === Cell.WALL) continue;

      // Normalized coordinates for the shader: [-1..1]
      const u = dx / radiusPx;
      const v = dy / radiusPx;

      // Run the procedural shader
      const alpha = shader(u, v, seed);
      if (alpha <= 0.01) continue;

      const newA = Math.min(255, Math.floor(intensity * alpha));
      if (newA <= 0) continue;

      // Write to cell's surface map
      let cell = world.surfaceMap.get(ci);
      if (!cell) { cell = new Uint8Array(1024); world.surfaceMap.set(ci, cell); }

      const idx = (py * 16 + px) << 2;
      writeSurfacePixel(cell, idx, r, g, b, newA);
      recordTouchedCell(touchedCells, ci);
    }
  }
  if (touchedCells.length > 0) world.markSurfaceCellsDirty(touchedCells);
}

export function stampLocalMark(
  world: World,
  cx: number, cy: number,
  fx: number, fy: number,
  radius: number,
  type: MarkType,
  seed: number,
  r: number, g: number, b: number,
  intensity = 220,
  wallOk = false,
): void {
  const wx = world.wrap(Math.floor(cx));
  const wy = world.wrap(Math.floor(cy));
  const ci = world.idx(wx, wy);
  if (!wallOk && world.cells[ci] === Cell.WALL) return;

  const shader = SHADERS[type] ?? SHADERS[0];
  const centerPx = fx * 16;
  const centerPy = fy * 16;
  const radiusPx = Math.max(1, radius * 16);
  const r2 = radiusPx + 1;
  let touched = false;
  let cell = world.surfaceMap.get(ci);

  for (let dy = -r2; dy <= r2; dy++) {
    const py = Math.floor(centerPy + dy);
    if (py < 0 || py >= 16) continue;
    for (let dx = -r2; dx <= r2; dx++) {
      const px = Math.floor(centerPx + dx);
      if (px < 0 || px >= 16) continue;

      const alpha = shader(dx / radiusPx, dy / radiusPx, seed);
      if (alpha <= 0.01) continue;
      const newA = Math.min(255, Math.floor(intensity * alpha));
      if (newA <= 0) continue;

      if (!cell) {
        cell = new Uint8Array(1024);
        world.surfaceMap.set(ci, cell);
      }
      writeSurfacePixel(cell, (py * 16 + px) << 2, r, g, b, newA);
      touched = true;
    }
  }
  if (touched) world.markSurfaceCellDirty(ci);
}

export function stampSurfaceSplat(
  world: World,
  cx: number,
  cy: number,
  fx: number,
  fy: number,
  radius: number,
  intensity: number,
  seed: number,
  r: number,
  g: number,
  b: number,
  wallOk = false,
): void {
  stampMark(world, cx, cy, fx, fy, radius, MarkType.SPLAT, seed, r, g, b, intensity, wallOk);
}
