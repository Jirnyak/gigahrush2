/* -- Shared actor urination surface traces ---------------------- */

import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { MarkType, stampMark } from './surface_marks';

const URINE_R = 200;
const URINE_G = 180;
const URINE_B = 30;
const DEFAULT_TRACE_INTERVAL = 0.22;
let nextTraceAtByActor = new WeakMap<Entity, number>();

export interface UrineTraceOptions {
  seed?: number;
  pressure?: number;
  streamLength?: number;
  spread?: number;
  dropCount?: number;
  streamSteps?: number;
  width?: number;
  intensityScale?: number;
}

export interface CadencedUrineTraceOptions extends UrineTraceOptions {
  intervalSeconds?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function hashUnit(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = (n * 0x27d4eb2d) | 0;
  n = n ^ (n >>> 15);
  return (n >>> 0) / 0xffffffff;
}

function frac01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function actorTraceSeed(actor: Pick<Entity, 'id' | 'x' | 'y'>, seed?: number): number {
  if (seed !== undefined && Number.isFinite(seed)) return seed | 0;
  return ((actor.id * 1009) ^ (Math.floor(actor.x * 64) * 9176) ^ (Math.floor(actor.y * 64) * 131)) | 0;
}

export function stampUrineTrace(
  world: World,
  actor: Pick<Entity, 'id' | 'x' | 'y' | 'angle'>,
  options: UrineTraceOptions = {},
): boolean {
  const pressure = Math.max(0.12, clamp01(options.pressure ?? 0.65));
  const streamLength = Math.max(0.15, options.streamLength ?? 1.15);
  const spread = Math.max(0.02, options.spread ?? 0.22);
  const traceSteps = Math.max(1, Math.min(5, Math.ceil((options.streamSteps ?? 12) / 8)));
  const streamWidth = Math.max(0.01, Math.min(0.11, options.width ?? (0.02 + pressure * 0.04)));
  const dropCount = Math.max(0, Math.min(3, Math.floor(options.dropCount ?? 1)));
  const intensityScale = Math.max(0.2, options.intensityScale ?? 1);
  const angle = Number.isFinite(actor.angle) ? actor.angle : 0;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const sideX = -dirY;
  const sideY = dirX;
  const seedBase = actorTraceSeed(actor, options.seed);
  let stamped = false;

  for (let i = 0; i < traceSteps; i++) {
    const h = hashUnit(seedBase + i * 977);
    const h2 = hashUnit(seedBase ^ (i * 13007 + 0x51a7));
    const distance = streamLength + (h - 0.5) * 0.1;
    const lateral = (h2 - 0.5) * spread * 0.32;
    const radius = Math.max(0.07, Math.min(0.21, 0.075 + pressure * 0.075 + streamWidth * 0.65 + h * 0.025));
    const alpha = Math.floor((38 + pressure * 34 + h2 * 16) * intensityScale);
    const x = actor.x + dirX * distance + sideX * lateral;
    const y = actor.y + dirY * distance + sideY * lateral;
    const cx = world.wrap(Math.floor(x));
    const cy = world.wrap(Math.floor(y));
    if (world.solid(cx, cy)) continue;
    stampMark(
      world,
      cx,
      cy,
      frac01(x),
      frac01(y),
      radius,
      MarkType.DRIP,
      seedBase + i * 4099,
      URINE_R,
      URINE_G,
      URINE_B,
      alpha,
    );
    stamped = true;
  }

  for (let i = 0; i < dropCount; i++) {
    const h = hashUnit(seedBase + 3109 + i * 977);
    const h2 = hashUnit(seedBase ^ (0x51a7 + i * 13007));
    const distance = streamLength + (h - 0.5) * 0.18;
    const lateral = (h2 - 0.5) * spread * 0.55;
    const x = actor.x + dirX * distance + sideX * lateral;
    const y = actor.y + dirY * distance + sideY * lateral;
    const cx = world.wrap(Math.floor(x));
    const cy = world.wrap(Math.floor(y));
    if (world.solid(cx, cy)) continue;

    const radius = 0.035 + pressure * 0.035 + h * 0.02;
    const intensity = Math.floor((28 + pressure * 36 + h2 * 14) * intensityScale);
    stampMark(
      world,
      cx,
      cy,
      frac01(x),
      frac01(y),
      radius,
      MarkType.DRIP,
      seedBase + i * 4099,
      URINE_R,
      URINE_G,
      URINE_B,
      intensity,
    );
    stamped = true;
  }

  return stamped;
}

export function stampUrineTraceCadenced(
  world: World,
  actor: Entity,
  time: number,
  options: CadencedUrineTraceOptions = {},
): boolean {
  const now = Number.isFinite(time) ? time : 0;
  const next = nextTraceAtByActor.get(actor);
  if (next !== undefined && now < next) return false;

  const interval = Math.max(0.05, options.intervalSeconds ?? DEFAULT_TRACE_INTERVAL);
  const seed = actorTraceSeed(actor, options.seed ?? Math.floor(now * 1000));
  const jitter = (hashUnit(seed ^ 0x6d2b79f5) - 0.5) * interval * 0.35;
  nextTraceAtByActor.set(actor, now + interval + jitter);
  return stampUrineTrace(world, actor, { ...options, seed });
}

export function resetUrinationTraceCadenceForTests(): void {
  nextTraceAtByActor = new WeakMap<Entity, number>();
}
