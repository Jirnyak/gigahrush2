import { S } from '../pixutil';
import type {
  RenderAnimationProceduralCachePolicy,
  RenderAnimationProceduralContext,
  RenderAnimationProceduralCpuFrameSource,
  RenderAnimationProceduralFrameResult,
  RenderAnimationProceduralResult,
  RenderAnimationProceduralSource,
} from './types';

export const PROCEDURAL_ANIMATION_FRAME_CACHE_MAX = 512;
export const PROCEDURAL_ANIMATION_FRAME_CACHE_TARGET = 384;
const PROCEDURAL_ANIMATION_SOURCE_ID_RE = /^[a-z0-9_.:-]+$/;

interface CacheEntry {
  result: RenderAnimationProceduralFrameResult;
  usedAt: number;
}

export interface RenderAnimationProceduralInput {
  clipId: string;
  visualKey: string;
  frameIndex?: number;
  phase?: number;
  phaseBucket?: number;
  seed?: number;
  width?: number;
  height?: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function positiveIntOr(value: number | undefined, fallback: number): number {
  const n = finiteOr(value, fallback);
  return Math.max(1, Math.floor(n));
}

export function proceduralAnimationPhaseBucket(phase: number, bucketCount: number | undefined): number {
  const count = positiveIntOr(bucketCount, 1);
  if (count <= 1) return 0;
  const p = finiteOr(phase, 0);
  const wrapped = p - Math.floor(p);
  return Math.min(count - 1, Math.floor(wrapped * count));
}

export function proceduralAnimationFrameCacheKey(ctx: Pick<RenderAnimationProceduralContext, 'clipId' | 'visualKey' | 'frameIndex' | 'phaseBucket'>): string {
  return `${ctx.clipId.length}:${ctx.clipId}|${ctx.visualKey.length}:${ctx.visualKey}|${ctx.frameIndex}|${ctx.phaseBucket}`;
}

export class RenderAnimationProceduralFrameCache {
  private entries = new Map<string, CacheEntry>();
  private useTick = 0;
  private readonly maxEntries: number;
  private readonly targetEntries: number;

  constructor(policy: RenderAnimationProceduralCachePolicy = {}) {
    this.maxEntries = positiveIntOr(policy.maxEntries, PROCEDURAL_ANIMATION_FRAME_CACHE_MAX);
    this.targetEntries = Math.min(
      this.maxEntries,
      positiveIntOr(policy.targetEntries, Math.min(PROCEDURAL_ANIMATION_FRAME_CACHE_TARGET, this.maxEntries)),
    );
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.useTick = 0;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): RenderAnimationProceduralFrameResult | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.useTick++;
    entry.usedAt = this.useTick;
    return entry.result;
  }

  set(key: string, result: RenderAnimationProceduralFrameResult): void {
    this.useTick++;
    this.entries.set(key, { result, usedAt: this.useTick });
    this.trim();
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return;
    while (this.entries.size > this.targetEntries) {
      let oldestKey = '';
      let oldestUse = Number.MAX_SAFE_INTEGER;
      for (const [key, entry] of this.entries) {
        if (entry.usedAt < oldestUse) {
          oldestUse = entry.usedAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

export const defaultProceduralAnimationFrameCache = new RenderAnimationProceduralFrameCache();
const proceduralSources = new Map<string, RenderAnimationProceduralSource>();

export function registerRenderAnimationProceduralSource(id: string, source: RenderAnimationProceduralSource): () => boolean {
  const cleanId = id.trim();
  if (!cleanId || cleanId !== id || !PROCEDURAL_ANIMATION_SOURCE_ID_RE.test(cleanId)) {
    throw new Error(`[render-animation] invalid procedural source id "${id}"`);
  }
  if (proceduralSources.has(cleanId)) throw new Error(`[render-animation] duplicate procedural source id "${cleanId}"`);
  proceduralSources.set(cleanId, source);
  return () => proceduralSources.delete(cleanId);
}

export function renderAnimationProceduralSourceById(id: string | undefined): RenderAnimationProceduralSource | undefined {
  return id ? proceduralSources.get(id) : undefined;
}

export function clearRenderAnimationProceduralSources(): void {
  proceduralSources.clear();
}

function normalizeContext(
  source: RenderAnimationProceduralSource,
  input: RenderAnimationProceduralInput,
): RenderAnimationProceduralContext {
  const phase = finiteOr(input.phase, 0);
  const frameIndex = Math.max(0, Math.floor(finiteOr(input.frameIndex, 0)));
  const width = positiveIntOr(input.width ?? (source.kind === 'procedural_cpu_frame' ? source.width : undefined), S);
  const height = positiveIntOr(input.height ?? (source.kind === 'procedural_cpu_frame' ? source.height : undefined), S);
  const phaseBucket = input.phaseBucket !== undefined
    ? Math.max(0, Math.floor(finiteOr(input.phaseBucket, 0)))
    : proceduralAnimationPhaseBucket(phase, source.phaseBuckets);
  return {
    clipId: input.clipId,
    visualKey: input.visualKey,
    frameIndex,
    phase,
    phaseBucket,
    seed: Math.floor(finiteOr(input.seed, 1)) || 1,
    width,
    height,
  };
}

function baseFrameFor(source: RenderAnimationProceduralCpuFrameSource, width: number, height: number): Uint32Array | null {
  const expected = width * height;
  const base = typeof source.baseFrame === 'function' ? source.baseFrame() : source.baseFrame;
  if (!base) return new Uint32Array(expected);
  if (base.length !== expected) return null;
  return new Uint32Array(base);
}

function resolveCpuFrame(
  source: RenderAnimationProceduralCpuFrameSource,
  input: RenderAnimationProceduralInput,
  cache: RenderAnimationProceduralFrameCache,
): RenderAnimationProceduralFrameResult | null {
  const ctx = normalizeContext(source, input);
  const cacheKey = proceduralAnimationFrameCacheKey(ctx);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const frame = baseFrameFor(source, ctx.width, ctx.height);
    if (!frame) return null;
    const generated = source.mutate(ctx, frame);
    if (generated === null) return null;
    const pixels = generated ?? frame;
    if (pixels.length !== ctx.width * ctx.height) return null;
    const result: RenderAnimationProceduralFrameResult = {
      kind: 'frame',
      clipId: ctx.clipId,
      visualKey: ctx.visualKey,
      frameIndex: ctx.frameIndex,
      phaseBucket: ctx.phaseBucket,
      phase: ctx.phase,
      seed: ctx.seed,
      cacheKey,
      frame: {
        pixels,
        width: ctx.width,
        height: ctx.height,
        anchor: source.anchor,
      },
    };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export function resolveProceduralAnimationSource(
  source: RenderAnimationProceduralSource,
  input: RenderAnimationProceduralInput,
  cache = defaultProceduralAnimationFrameCache,
): RenderAnimationProceduralResult | null {
  if (source.kind === 'procedural_cpu_frame') return resolveCpuFrame(source, input, cache);

  const ctx = normalizeContext(source, input);
  try {
    const params = source.resolve(ctx);
    if (!params) return null;
    return {
      kind: 'phase',
      clipId: ctx.clipId,
      visualKey: ctx.visualKey,
      frameIndex: ctx.frameIndex,
      phaseBucket: ctx.phaseBucket,
      phase: ctx.phase,
      seed: ctx.seed,
      params,
    };
  } catch {
    return null;
  }
}
