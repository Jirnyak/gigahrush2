/* ── Blood + transient impact FX ──────────────────────────────── */

import { W, Cell, ProjType, type Entity, EntityType } from '../core/types';
import { World } from '../core/world';
import { stampLocalMark, stampMark, MarkType } from './surface_marks';
import { Spr } from '../render/sprite_index';
import { ensureEntityIndex } from './entity_index';
import { addVisualSlotByPriority, removeVisualSlotCode } from '../gen/visual_cell_slots';
import { SeedRng } from '../core/rand';

/* ── Transient world-space particles ──────────────────────────── */
export type ParticleKind =
  | 'blood'
  | 'gore'
  | 'dust'
  | 'smoke'
  | 'spark'
  | 'debris'
  | 'light_mote';

export interface ParticleLandingMark {
  type: MarkType;
  radius: number;
  intensity: number;
  probability: number;
  wallOk?: boolean;
}

export interface Particle {
  kind: ParticleKind;
  x: number; y: number;      // world position
  z: number;                 // height: 0=floor, 0.5=mid, 1=ceiling
  vx: number; vy: number;    // velocity (cells/sec)
  vz: number;                // vertical velocity (units/sec)
  life: number;              // remaining seconds
  size: number;              // emitter scale, projected by renderer
  r: number; g: number; b: number;
  alpha?: number;
  drag?: number;
  gravity?: number;
  landMark?: ParticleLandingMark;
}

export type BloodParticle = Particle;

const MAX_PARTICLES = 256;
export const particles: BloodParticle[] = [];

// Incrementing counter ensures every splatter is unique
let _splatterSeed = 0;
let particleWorld: World | null = null;

// Substance colors (R, G, B)
const BLOOD: [number, number, number] = [140, 10, 10];
const GORE:  [number, number, number] = [30, 40, 10];
const CONCRETE_DUST: [number, number, number] = [122, 116, 101];
const MEAT_DUST: [number, number, number] = [112, 68, 58];
const SMOKE: [number, number, number] = [74, 70, 63];

function bindParticleWorld(world: World): boolean {
  if (particleWorld === world) return true;
  const sameWorld = particleWorld === null;
  if (!sameWorld) particles.length = 0;
  particleWorld = world;
  return sameWorld;
}

export function clearParticles(): void {
  particles.length = 0;
  particleWorld = null;
}

function emitParticle(p: BloodParticle): void {
  if (particles.length >= MAX_PARTICLES) return;
  particles.push(p);
}

function particleLandMark(kind: ParticleKind, radius: number, intensity: number, probability = 1): ParticleLandingMark | undefined {
  if (kind === 'blood' || kind === 'gore') return { type: MarkType.SPLAT, radius, intensity, probability };
  if (kind === 'spark') return { type: MarkType.BURN, radius, intensity, probability };
  if (kind === 'debris') return { type: MarkType.SCORCH, radius, intensity, probability };
  return undefined;
}

function emitRadialParticle(
  kind: ParticleKind,
  x: number,
  y: number,
  z: number,
  baseSpeed: number,
  vz: number,
  life: number,
  size: number,
  color: readonly [number, number, number],
  alpha: number | undefined,
  drag: number,
  gravity: number,
  landMark?: ParticleLandingMark,
): void {
  const ang = Math.random() * Math.PI * 2;
  const spd = baseSpeed * (0.45 + Math.random() * 0.85);
  const h = (++_splatterSeed * 17) & 31;
  emitParticle({
    kind,
    x,
    y,
    z,
    vx: Math.cos(ang) * spd,
    vy: Math.sin(ang) * spd,
    vz,
    life,
    size,
    r: Math.min(255, color[0] + h),
    g: Math.min(255, color[1] + (h >> 1)),
    b: Math.min(255, color[2] + (h >> 2)),
    alpha,
    drag,
    gravity,
    landMark,
  });
}

export function isEnergyProjectileImpact(sprite: number | undefined, pt = ProjType.NORMAL): boolean {
  return pt === ProjType.BFG ||
    pt === ProjType.FLAME ||
    sprite === Spr.PSI_BOLT ||
    sprite === Spr.HOSTILE_PSI_BOLT ||
    sprite === Spr.EYE_BOLT ||
    sprite === Spr.PARAGRAPH_BOLT ||
    sprite === Spr.PLASMA_BOLT ||
    sprite === Spr.HOSTILE_PLASMA_BOLT ||
    sprite === Spr.GAUSS_BOLT ||
    sprite === Spr.BFG_BOLT ||
    sprite === Spr.FLAME_BOLT ||
    sprite === Spr.HOSTILE_FLAME_BOLT;
}

function stampProjectileMark(
  world: World,
  cx: number, cy: number,
  fx: number, fy: number,
  radius: number,
  type: MarkType,
  seed: number,
  r: number, g: number, b: number,
  intensity: number,
  wallOk = false,
): void {
  stampMark(world, cx, cy, fx, fy, radius, type, seed, r, g, b, intensity, wallOk);
}

function stampEnergyMark(
  world: World,
  cx: number, cy: number,
  fx: number, fy: number,
  radius: number,
  sprite: number | undefined,
  wallOk = false,
): void {
  if (sprite === Spr.EYE_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius, MarkType.PSI, ++_splatterSeed, 120, 220, 35, 190, wallOk);
  } else if (sprite === Spr.PARAGRAPH_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius * 0.9, MarkType.PSI, ++_splatterSeed, 235, 42, 96, 205, wallOk);
    stampProjectileMark(world, cx, cy, fx, fy, radius * 0.45, MarkType.BULLET, ++_splatterSeed, 28, 22, 16, 185, wallOk);
  } else if (sprite === Spr.HOSTILE_PSI_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius, MarkType.PSI, ++_splatterSeed, 230, 35, 140, 205, wallOk);
  } else if (sprite === Spr.PLASMA_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius, MarkType.PSI, ++_splatterSeed, 40, 230, 210, 185, wallOk);
  } else if (sprite === Spr.HOSTILE_PLASMA_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius, MarkType.SCORCH, ++_splatterSeed, 210, 95, 30, 190, wallOk);
  } else if (sprite === Spr.GAUSS_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, radius * 0.75, MarkType.PSI, ++_splatterSeed, 170, 210, 255, 180, wallOk);
  } else {
    stampProjectileMark(world, cx, cy, fx, fy, radius, MarkType.PSI, ++_splatterSeed, 180, 80, 230, 185, wallOk);
  }
}

function projectileImpactColor(sprite: number | undefined, pt = ProjType.NORMAL): [number, number, number] {
  if (pt === ProjType.WEB) return [224, 226, 204];
  if (pt === ProjType.FLAME || sprite === Spr.FLAME_BOLT || sprite === Spr.HOSTILE_FLAME_BOLT) return [255, 92, 24];
  if (sprite === Spr.EYE_BOLT) return [150, 240, 52];
  if (sprite === Spr.PARAGRAPH_BOLT) return [248, 42, 104];
  if (sprite === Spr.HOSTILE_PSI_BOLT) return [248, 36, 132];
  if (sprite === Spr.PSI_BOLT) return [204, 96, 255];
  if (sprite === Spr.PLASMA_BOLT || sprite === Spr.GAUSS_BOLT) return [110, 232, 255];
  if (sprite === Spr.HOSTILE_PLASMA_BOLT) return [255, 126, 45];
  if (pt === ProjType.BFG || sprite === Spr.BFG_BOLT) return [104, 255, 90];
  if (sprite === Spr.HOSTILE_BULLET || sprite === Spr.HOSTILE_PELLET || sprite === Spr.HOSTILE_NAIL) return [255, 86, 42];
  return [255, 214, 118];
}

function spawnProjectileImpactParticles(
  world: World,
  x: number, y: number,
  z: number,
  sprite: number | undefined,
  pt = ProjType.NORMAL,
): void {
  bindParticleWorld(world);
  const energy = isEnergyProjectileImpact(sprite, pt);
  const flame = pt === ProjType.FLAME || sprite === Spr.FLAME_BOLT || sprite === Spr.HOSTILE_FLAME_BOLT;
  const [r, g, b] = projectileImpactColor(sprite, pt);

  if (flame) {
    for (let i = 0; i < 4; i++) {
      emitRadialParticle('spark', x, y, z, 1.7, 0.5 + Math.random() * 0.9, 0.22, 0.85, [r, g, b], 0.9, 0.9, 5.5);
    }
    for (let i = 0; i < 3; i++) {
      emitRadialParticle('smoke', x, y, z, 0.55, 0.16 + Math.random() * 0.22, 0.75, 1.8, SMOKE, 0.28, 0.92, -0.18);
    }
    return;
  }

  if (energy) {
    for (let i = 0; i < 7; i++) {
      emitRadialParticle('spark', x, y, z, 2.35, 0.45 + Math.random() * 1.15, 0.28, 0.9 + (i & 1) * 0.35, [r, g, b], 0.9, 0.9, 5.8);
    }
    for (let i = 0; i < 2; i++) {
      emitRadialParticle('smoke', x, y, z, 0.45, 0.1 + Math.random() * 0.22, 0.55, 1.5, SMOKE, 0.2, 0.92, -0.12);
    }
    emitRadialParticle('dust', x, y, z, 0.75, 0.08 + Math.random() * 0.18, 0.36, 1.2, CONCRETE_DUST, 0.26, 0.9, 0.8);
    return;
  }

  emitRadialParticle('spark', x, y, z, 1.15, 0.35 + Math.random() * 0.75, 0.18, 0.75, [r, g, b], 0.75, 0.9, 5.4);
  for (let i = 0; i < 2; i++) {
    emitRadialParticle('debris', x, y, z, 1.15, 0.25 + Math.random() * 0.6, 0.5, 0.8, [82, 76, 62], 0.75, 0.92, 5.0);
  }
  for (let i = 0; i < 2; i++) {
    emitRadialParticle('dust', x, y, z, 0.7, 0.05 + Math.random() * 0.18, 0.42, 1.35, CONCRETE_DUST, 0.28, 0.9, 0.9);
  }
}

export function spawnProjectileBodyImpact(
  world: World,
  x: number, y: number,
  sprite: number | undefined,
  pt = ProjType.NORMAL,
  z = 0.5,
): void {
  spawnProjectileImpactParticles(world, x, y, z, sprite, pt);
  const cx = Math.floor(x), cy = Math.floor(y);
  if (world.solid(cx, cy)) return;
  const fx = (x % 1 + 1) % 1, fy = (y % 1 + 1) % 1;
  if (pt === ProjType.WEB) {
    stampProjectileMark(world, cx, cy, fx, fy, 0.22, MarkType.WEB, ++_splatterSeed, 226, 226, 202, 170);
  } else if (pt === ProjType.FLAME || sprite === Spr.FLAME_BOLT || sprite === Spr.HOSTILE_FLAME_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, 0.18, MarkType.BURN, ++_splatterSeed, 10, 5, 2, 145);
  } else if (isEnergyProjectileImpact(sprite, pt)) {
    stampEnergyMark(world, cx, cy, fx, fy, 0.12, sprite);
  }
}

export function spawnProjectileFloorImpact(
  world: World,
  x: number, y: number,
  sprite: number | undefined,
  pt = ProjType.NORMAL,
): void {
  const cx = Math.floor(x), cy = Math.floor(y);
  if (world.solid(cx, cy)) return;
  const fx = (x % 1 + 1) % 1, fy = (y % 1 + 1) % 1;
  spawnProjectileImpactParticles(world, x, y, 0.08, sprite, pt);
  if (pt === ProjType.WEB) {
    stampProjectileMark(world, cx, cy, fx, fy, 0.34, MarkType.WEB, ++_splatterSeed, 226, 226, 202, 185);
  } else if (pt === ProjType.FLAME || sprite === Spr.FLAME_BOLT || sprite === Spr.HOSTILE_FLAME_BOLT) {
    stampProjectileMark(world, cx, cy, fx, fy, 0.3, MarkType.BURN, ++_splatterSeed, 8, 5, 2, 180);
  } else if (isEnergyProjectileImpact(sprite, pt)) {
    stampEnergyMark(world, cx, cy, fx, fy, 0.18, sprite);
  } else {
    stampProjectileMark(world, cx, cy, fx, fy, 0.08, MarkType.BULLET, ++_splatterSeed, 20, 18, 14, 140);
  }
}

export function spawnProjectileWallImpact(
  world: World,
  cx: number, cy: number,
  u: number, v: number,
  sprite: number | undefined,
  pt = ProjType.NORMAL,
  impactX = cx + 0.5,
  impactY = cy + 0.5,
): void {
  spawnProjectileImpactParticles(world, impactX, impactY, Math.max(0.001, Math.min(0.999, 1.0 - v)), sprite, pt);
  if (pt === ProjType.WEB) {
    stampProjectileMark(world, cx, cy, u, v, 0.3, MarkType.WEB, ++_splatterSeed, 226, 226, 202, 185, true);
  } else if (pt === ProjType.FLAME || sprite === Spr.FLAME_BOLT || sprite === Spr.HOSTILE_FLAME_BOLT) {
    stampProjectileMark(world, cx, cy, u, v, 0.25, MarkType.BURN, ++_splatterSeed, 5, 3, 1, 190, true);
  } else if (isEnergyProjectileImpact(sprite, pt)) {
    stampEnergyMark(world, cx, cy, u, v, 0.16, sprite, true);
  } else {
    const seed = ++_splatterSeed;
    stampLocalMark(world, cx, cy, u, v, 0.105, MarkType.BULLET_WALL, seed, 30, 27, 22, 165, true);
    stampLocalMark(world, cx, cy, u, v, 0.042, MarkType.BULLET_WALL, seed + 1, 7, 7, 7, 255, true);
  }
}

/* ── Stamp blood/gore on adjacent wall cells ──────────────────── */
function splatAdjacentWalls(
  world: World, ex: number, ey: number,
  radius: number, intensity: number, seed: number,
  cr: number, cg: number, cb: number,
  dvx = 0, dvy = 0, hitZ = 0.5,
): void {
  const ecx = Math.floor(ex), ecy = Math.floor(ey);
  const fracX = ((ex % 1) + 1) % 1;
  const fracY = ((ey % 1) + 1) % 1;
  // Cardinal directions: [dx, dy, face-U from entity position]
  const dirs: [number, number, number][] = [
    [-1, 0, fracY],  // West wall: horizontal on face = entity Y
    [+1, 0, fracY],  // East wall
    [0, -1, fracX],  // North wall: horizontal on face = entity X
    [0, +1, fracX],  // South wall
  ];
  const hasDir = dvx !== 0 || dvy !== 0;
  for (const [dx, dy, faceU] of dirs) {
    const wx = world.wrap(ecx + dx);
    const wy = world.wrap(ecy + dy);
    if (world.cells[wy * W + wx] !== Cell.WALL) continue;
    // Directional bias: skip walls behind projectile travel direction
    if (hasDir) {
      const dot = dx * dvx + dy * dvy;
      if (dot < -0.1) continue;
    }
    // Wall face V at impact height: spriteZ 0=floor→faceV 1.0, spriteZ 0.5=mid→faceV 0.5
    const faceV = Math.max(0.05, Math.min(0.95, 1.0 - hitZ + (Math.random() - 0.5) * 0.12));
    const u = Math.max(0, Math.min(0.999, faceU + (Math.random() - 0.5) * 0.15));
    stampMark(world, wx, wy, u, faceV, radius, MarkType.SPLAT, seed + dx * 7 + dy * 13, cr, cg, cb, intensity, true);
  }
}

/* ── Spawn blood particles on hit ─────────────────────────────── */
export function spawnBloodHit(world: World, ex: number, ey: number, fromAngle: number, dmg: number, gore = false, pvx = 0, pvy = 0, hitZ = 0.5): void {
  bindParticleWorld(world);
  const seed = ++_splatterSeed;
  const [sr, sg, sb] = gore ? GORE : BLOOD;
  // Offset floor splat in projectile travel direction
  const spd = Math.sqrt(pvx * pvx + pvy * pvy);
  const offMag = spd > 0.1 ? Math.min(0.3, spd * 0.012) : 0;
  const offX = spd > 0.1 ? (pvx / spd) * offMag : 0;
  const offY = spd > 0.1 ? (pvy / spd) * offMag : 0;
  const sx = ex + offX, sy = ey + offY;
  const cx = Math.floor(sx), cy = Math.floor(sy);
  const fx = ((sx % 1) + 1) % 1, fy = ((sy % 1) + 1) % 1;
  const radius = Math.min(0.35, 0.08 + dmg * 0.004);
  const intensity = Math.min(220, 80 + dmg * 3);
  stampMark(world, cx, cy, fx, fy, radius, MarkType.SPLAT, seed, sr, sg, sb, intensity);

  // Directional wall splatter at impact height
  splatAdjacentWalls(world, ex, ey, radius * 0.6, Math.floor(intensity * 0.7), seed, sr, sg, sb, pvx, pvy, hitZ);

  // Spray some blood in hit direction (away from attacker) + projectile momentum
  const count = Math.min(24, 4 + Math.floor(dmg * 0.3));
  const pMomentum = spd > 0.1 ? 0.15 : 0;
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const spread = (Math.random() - 0.5) * 1.6;
    const ang = fromAngle + Math.PI + spread;
    const baseSpd = 1.5 + Math.random() * 3;
    // Unique color per particle — dark red / crimson / maroon
    const h = (seed * 7 + i * 31) & 0xFF;
    const size = 1 + (h & 1);
    emitParticle({
      kind: gore ? 'gore' : 'blood',
      x: ex, y: ey,
      z: hitZ,
      vx: Math.cos(ang) * baseSpd + pvx * pMomentum,
      vy: Math.sin(ang) * baseSpd + pvy * pMomentum,
      vz: (Math.random() - 0.3) * 1.5,  // slight upward bias then fall
      life: 1.5,  // generous life — gravity landing will kill them
      size,
      r: gore ? 20 + (h & 31) : 120 + (h & 63),
      g: gore ? 25 + (h & 15) : 5 + (h & 15),
      b: gore ? 5 + (h & 7) : 5 + (h & 7),
      drag: 0.95,
      gravity: 3.5,
      landMark: particleLandMark(gore ? 'gore' : 'blood', 0.04 + size * 0.02, gore ? 105 : 120, gore ? 0.85 : 1),
    });
  }
}

/* ── Large blood pool on death ────────────────────────────────── */
export function spawnDeathPool(world: World, ex: number, ey: number, gore = false, goreLevel = 1, pvx = 0, pvy = 0): void {
  bindParticleWorld(world);
  const seed = ++_splatterSeed;
  const [sr, sg, sb] = gore ? GORE : BLOOD;
  // Offset pool in projectile travel direction
  const spd = Math.sqrt(pvx * pvx + pvy * pvy);
  const offMag = spd > 0.1 ? Math.min(0.4, spd * 0.015) : 0;
  const dirX = spd > 0.1 ? pvx / spd : 0;
  const dirY = spd > 0.1 ? pvy / spd : 0;
  const px = ex + dirX * offMag, py = ey + dirY * offMag;
  const cx = Math.floor(px), cy = Math.floor(py);
  const fx = ((px % 1) + 1) % 1, fy = ((py % 1) + 1) % 1;
  // Pool size scales with gore level
  const poolRadius = 0.35 + goreLevel * 0.08;
  stampMark(world, cx, cy, fx, fy, poolRadius, MarkType.POOL, seed, sr, sg, sb, 255);
  
  // Danger/Blood vector field impulse
  const fieldIdx = cy * 1024 + cx;
  world.dangerField[fieldIdx] = Math.min(255, world.dangerField[fieldIdx] + 50);

  const rng = new SeedRng(seed);

  // Directional wall splatter at mid-body height
  splatAdjacentWalls(world, ex, ey, 0.25 + goreLevel * 0.05, 200, seed, sr, sg, sb, pvx, pvy, 0.5);
  
  // Large gore splatters spraying outward across multiple cells
  const splatCount = 3 + goreLevel * 3;
  for (let i = 0; i < splatCount; i++) {
    const ang = (i / splatCount) * Math.PI * 2 + (rng.random() - 0.5) * 1.2;
    // Spray distance: 0.5 to 2.5 cells from center, further with higher gore
    const dist = 0.3 + rng.random() * (0.6 + goreLevel * 0.5);
    // Bias toward projectile direction
    const biasX = dirX * 0.4, biasY = dirY * 0.4;
    const sx = ex + Math.cos(ang) * dist + biasX;
    const sy = ey + Math.sin(ang) * dist + biasY;
    const scx = Math.floor(((sx % 1024) + 1024) % 1024);
    const scy = Math.floor(((sy % 1024) + 1024) % 1024);
    if (world.solid(scx, scy)) continue;
    const splatRadius = 0.12 + goreLevel * 0.06 + rng.random() * 0.08;
    const splatIntensity = 160 + rng.int(0, 60);
    stampMark(world, scx, scy, ((sx % 1) + 1) % 1, ((sy % 1) + 1) % 1, splatRadius, MarkType.SPLAT, seed + i + 1, sr, sg, sb, splatIntensity);
    // Wall splats at spray endpoints
    if (goreLevel >= 2 && rng.chance(0.5)) {
      splatAdjacentWalls(world, sx, sy, splatRadius * 0.5, splatIntensity - 40, seed + i + 50, sr, sg, sb, Math.cos(ang), Math.sin(ang), 0.3 + rng.random() * 0.5);
    }
  }

  // Central procedural mesh chunk
  if (goreLevel >= 1) {
    const chunkCount = 2 + Math.floor(rng.random() * 2); // 2 to 3 chunks in center
    for (let i = 0; i < chunkCount; i++) {
      addVisualSlotByPriority(world, cy * 1024 + cx, 34, seed + i);
    }
    
    // Add scattered chunks at random adjacent open cells
    const scx = Math.floor(((cx + Math.round(rng.random() * 2 - 1)) % 1024 + 1024) % 1024);
    const scy = Math.floor(((cy + Math.round(rng.random() * 2 - 1)) % 1024 + 1024) % 1024);
    if (!world.solid(scx, scy) && (scx !== cx || scy !== cy)) {
      const outerCount = 1 + Math.floor(rng.random() * 2); // 1 to 2 chunks adjacent
      for (let i = 0; i < outerCount; i++) {
        addVisualSlotByPriority(world, scy * 1024 + scx, 34, seed + 10 + i);
      }
    }
  }

  // Gore spray particles for messy deaths (shotgun / explosion) - transient, uses Math.random
  if (goreLevel >= 2) {
    const particleCount = Math.min(48, goreLevel * 12);
    for (let i = 0; i < particleCount && particles.length < MAX_PARTICLES; i++) {
      const ang = Math.random() * Math.PI * 2;
      const baseSpd = 3 + Math.random() * 6;
      const pM = spd > 0.1 ? 0.25 : 0;
      const h = (seed * 7 + i * 31) & 0xFF;
      const size = 1 + (h & 1);
      emitParticle({
        kind: gore ? 'gore' : 'blood',
        x: ex, y: ey,
        z: 0.3 + Math.random() * 0.4,  // mid-body height
        vx: Math.cos(ang) * baseSpd + pvx * pM,
        vy: Math.sin(ang) * baseSpd + pvy * pM,
        vz: (Math.random() - 0.2) * 2.0,  // mostly upward spray
        life: 1.5,
        size,
        r: gore ? 20 + (h & 31) : 100 + (h & 63),
        g: gore ? 25 + (h & 15) : 5 + (h & 15),
        b: gore ? 5 + (h & 7) : 5 + (h & 7),
        drag: 0.95,
        gravity: 3.5,
        landMark: particleLandMark(gore ? 'gore' : 'blood', 0.04 + size * 0.02, gore ? 110 : 120, gore ? 0.75 : 1),
      });
    }
  }
}

/* ── Blood drip trail for wounded entities ────────────────────── */
const BLOOD_TRAIL_ACTOR_BUDGET = 768;
let bloodTrailCursor = 0;

export function updateBloodTrails(world: World, entities: Entity[], dt: number): void {
  // Only process every ~0.3s worth of dt (accumulate externally)
  const actors = ensureEntityIndex(entities).actors;
  const total = actors.length;
  if (total === 0) return;
  const budget = Math.min(total, BLOOD_TRAIL_ACTOR_BUDGET);
  for (let checked = 0; checked < budget; checked++) {
    if (bloodTrailCursor >= total) bloodTrailCursor = 0;
    const e = actors[bloodTrailCursor++];
    if (!e.alive) continue;
    if (e.hp === undefined || e.maxHp === undefined) continue;
    const ratio = e.hp / e.maxHp;
    if (ratio >= 0.5) continue;  // only bleed when under 50% HP
    // Drip probability scales with damage
    const drip = (0.5 - ratio) * 2;  // 0..1
    if (Math.random() > drip * dt * 3) continue;
    const cx = Math.floor(e.x), cy = Math.floor(e.y);
    const fx = e.x - cx + (Math.random() - 0.5) * 0.3;
    const fy = e.y - cy + (Math.random() - 0.5) * 0.3;
    const isGore = e.type === EntityType.MONSTER;
    const [sr, sg, sb] = isGore ? GORE : BLOOD;
    stampMark(world, cx, cy,
      Math.max(0, Math.min(0.999, fx)),
      Math.max(0, Math.min(0.999, fy)),
      0.06 + Math.random() * 0.04,
      MarkType.DRIP,
      ++_splatterSeed, sr, sg, sb,
      60 + Math.floor(Math.random() * 40));
  }
}

export function spawnDustBurst(
  world: World,
  x: number,
  y: number,
  z = 0.12,
  count = 12,
  color: readonly [number, number, number] = CONCRETE_DUST,
): void {
  bindParticleWorld(world);
  const capped = Math.max(0, Math.min(48, count | 0));
  for (let i = 0; i < capped; i++) {
    emitRadialParticle('dust', x, y, z, 0.7 + Math.random() * 0.35, 0.03 + Math.random() * 0.22, 0.42 + Math.random() * 0.25, 1.2 + Math.random() * 0.8, color, 0.24, 0.88, 0.8);
  }
}

export function spawnBreachDust(world: World, x: number, y: number, radius: number, changedCells: number, biomass = false): void {
  if (changedCells <= 0) return;
  bindParticleWorld(world);
  const color = biomass ? MEAT_DUST : CONCRETE_DUST;
  const dustCount = Math.min(48, 8 + changedCells * 2);
  spawnDustBurst(world, x, y, 0.18, dustCount, color);
  const smokeCount = Math.min(10, Math.max(2, Math.floor(radius * 2)), Math.max(0, 48 - dustCount));
  for (let i = 0; i < smokeCount; i++) {
    emitRadialParticle('smoke', x, y, 0.18, 0.45 + Math.random() * 0.25, 0.12 + Math.random() * 0.28, 0.85 + Math.random() * 0.35, 1.8 + Math.random(), biomass ? MEAT_DUST : SMOKE, 0.2, 0.92, -0.16);
  }
}

export function spawnExplosionParticles(world: World, x: number, y: number, radius: number, pt = ProjType.GRENADE): void {
  bindParticleWorld(world);
  const bfg = pt === ProjType.BFG;
  const sparkColor: readonly [number, number, number] = bfg ? [120, 255, 92] : [255, 150, 56];
  const dustCount = Math.min(20, 10 + Math.floor(radius * 2));
  const smokeCount = Math.min(8, 3 + Math.floor(radius));
  const sparkCount = Math.min(bfg ? 14 : 10, Math.max(0, 48 - dustCount - smokeCount));
  const debrisCount = Math.min(12, 6 + Math.floor(radius * 1.5), Math.max(0, 48 - dustCount - smokeCount - sparkCount));

  for (let i = 0; i < dustCount; i++) {
    emitRadialParticle('dust', x, y, 0.15 + Math.random() * 0.15, 1.0 + radius * 0.12, 0.1 + Math.random() * 0.35, 0.45 + Math.random() * 0.22, 1.3 + Math.random() * 0.8, CONCRETE_DUST, 0.3, 0.9, 0.7);
  }
  for (let i = 0; i < smokeCount; i++) {
    emitRadialParticle('smoke', x, y, 0.2 + Math.random() * 0.18, 0.65 + radius * 0.08, 0.16 + Math.random() * 0.34, 0.85 + Math.random() * 0.35, 2.0 + Math.random() * 1.2, SMOKE, 0.24, 0.93, -0.16);
  }
  for (let i = 0; i < sparkCount; i++) {
    const mark = i < 2 ? particleLandMark('spark', 0.035, bfg ? 135 : 120, 0.22) : undefined;
    emitRadialParticle('spark', x, y, 0.22 + Math.random() * 0.22, 2.1 + radius * 0.18, 0.45 + Math.random() * 1.2, 0.22 + Math.random() * 0.18, 0.8 + (i & 1) * 0.25, sparkColor, 0.9, 0.9, 5.8, mark);
  }
  for (let i = 0; i < debrisCount; i++) {
    const mark = i < 4 ? particleLandMark('debris', 0.045, 95, 0.3) : undefined;
    emitRadialParticle('debris', x, y, 0.18 + Math.random() * 0.18, 1.45 + radius * 0.15, 0.25 + Math.random() * 0.75, 0.55 + Math.random() * 0.28, 0.75 + (i & 1) * 0.2, [82, 72, 56], 0.75, 0.92, 5.2, mark);
  }
}

export function clearCorpseChunks(world: World, ex: number, ey: number): void {
  const cx = Math.floor(ex);
  const cy = Math.floor(ey);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const idx = world.idx(world.wrap(cx + dx), world.wrap(cy + dy));
      removeVisualSlotCode(world, idx, 34); // corpse_meat_chunk
      removeVisualSlotCode(world, idx, 35); // corpse_bone_chunk
    }
  }
}

/* ── Update particle physics ─────────────────────────────────── */
export function updateParticles(world: World, dt: number): void {
  if (!bindParticleWorld(world)) return;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    // 3D gravity: pull particles down
    p.vz -= (p.gravity ?? 3.5) * dt;
    p.z += p.vz * dt;
    // Hit floor: only particles with explicit landing metadata can leave persistent marks.
    if (p.z <= 0) {
      p.z = 0;
      const mark = p.landMark;
      if (mark && Math.random() <= mark.probability) {
        const cx = world.wrap(Math.floor(p.x));
        const cy = world.wrap(Math.floor(p.y));
        if (!world.solid(cx, cy) || mark.wallOk) {
          const fx = ((p.x % 1) + 1) % 1;
          const fy = ((p.y % 1) + 1) % 1;
          stampMark(world, cx, cy, fx, fy, mark.radius, mark.type, ++_splatterSeed, p.r, p.g, p.b, mark.intensity, mark.wallOk);
        }
      }
      particles.splice(i, 1);
      continue;
    }
    // Time-expired (safety)
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    // XY friction (no world-space gravity on XY — the 3D vz handles vertical)
    const drag = p.drag ?? 0.95;
    p.vx *= drag;
    p.vy *= drag;
    p.x = ((p.x + p.vx * dt) % W + W) % W;
    p.y = ((p.y + p.vy * dt) % W + W) % W;
  }
}
