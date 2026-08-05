import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import { decodeGeneratedAnimationFrame, getGeneratedAnimationFramePack } from './generated_frames';
import './index';
import { renderAnimationProceduralSourceById, resolveProceduralAnimationSource } from './procedural';
import { allRenderAnimationClips, renderAnimationClipMatchesEntity } from './registry';
import { resolveEntityRenderAnimationFrame } from './resolver';
import { resetRenderAnimationRuntime } from './runtime';
import type { RenderAnimationFrameInfo, RenderAnimationResolveContext } from './types';

export const ANIMATED_ENTITY_TEXTURE_CACHE_MAX = 512;
export const ANIMATED_ENTITY_TEXTURE_CACHE_TARGET = 448;
export const ANIMATED_ENTITY_RUNTIME_MAX = 2048;

const MOVING_EPSILON_DIST2 = 0.0004;

export interface AnimatedEntityTextureAnchor {
  readonly kind: 'feet' | 'center' | string;
  readonly x: number;
  readonly y: number;
}

export interface AnimatedEntityTextureFrame {
  readonly cacheKey: string;
  readonly pixels: Uint32Array | Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly clipId?: string;
  readonly statId?: string;
  readonly frameIndex?: number;
  readonly anchor?: AnimatedEntityTextureAnchor;
}

export interface AnimatedEntityTextureRuntimeContext {
  readonly previousX: number;
  readonly previousY: number;
  readonly previousHp: number | undefined;
  readonly movementDx: number;
  readonly movementDy: number;
  readonly movementDist2: number;
  readonly moving: boolean;
  readonly damaged: boolean;
  readonly lastSeenAt: number;
}

export interface AnimatedEntityTextureContext {
  readonly entity: Entity;
  readonly world: World;
  readonly time: number;
  readonly spriteIndex: number;
  readonly spriteSource: number | string;
  readonly spriteScale: number;
  readonly spriteZ: number;
  readonly runtime: AnimatedEntityTextureRuntimeContext;
}

export interface AnimatedEntityTextureResult {
  readonly texture: WebGLTexture;
  readonly clipId?: string;
  readonly statId?: string;
  readonly frameIndex?: number;
  readonly anchor?: AnimatedEntityTextureAnchor;
}

export interface AnimatedEntityTextureDebugStats {
  readonly activeSprites: number;
  readonly drawnSprites: number;
  readonly cacheSize: number;
  readonly cacheCap: number;
  readonly runtimeSize: number;
  readonly runtimeCap: number;
  readonly resolverCount: number;
  readonly lastClipId: string | null;
  readonly lastStatId: string | null;
}

export type AnimatedEntityTextureResolver = (ctx: AnimatedEntityTextureContext) => AnimatedEntityTextureFrame | null;

interface AnimatedEntityRuntimeEntry extends AnimatedEntityTextureRuntimeContext {
  previousX: number;
  previousY: number;
  previousHp: number | undefined;
  movementDx: number;
  movementDy: number;
  movementDist2: number;
  moving: boolean;
  damaged: boolean;
  lastSeenAt: number;
  usedAt: number;
}

interface AnimatedTextureCacheEntry extends AnimatedEntityTextureResult {
  readonly width: number;
  readonly height: number;
  usedAt: number;
}

export interface AnimatedTextureLruEntry {
  readonly usedAt: number;
}

const resolvers: AnimatedEntityTextureResolver[] = [];
const runtimeByEntityId = new Map<number, AnimatedEntityRuntimeEntry>();
const textureCache = new Map<string, AnimatedTextureCacheEntry>();
let textureUseTick = 0;
let frameActiveSprites = 0;
let frameDrawnSprites = 0;
let lastClipId: string | null = null;
let lastStatId: string | null = null;

const resolverContext: AnimatedEntityTextureContext = {
  entity: null as unknown as Entity,
  world: null as unknown as World,
  time: 0,
  spriteIndex: -1,
  spriteSource: 0,
  spriteScale: 1,
  spriteZ: 0,
  runtime: null as unknown as AnimatedEntityTextureRuntimeContext,
};
const registeredAnimationMovementDelta = {
  dx: 0,
  dy: 0,
  distance: 0,
};
const registeredAnimationResolveContext: RenderAnimationResolveContext = {
  entity: null as unknown as Entity,
  nowSec: 0,
  movementDelta: registeredAnimationMovementDelta,
};

function proceduralVisualKey(entity: Entity, spriteIndex: number, spriteSource: number | string): string {
  return [
    entity.npcVisualId ?? '',
    entity.plotNpcId ?? '',
    entity.monsterKind ?? '',
    entity.sprite ?? spriteIndex,
    entity.spriteSeed ?? 0,
    spriteSource,
  ].join('|');
}

export function registerAnimatedEntityTextureResolver(resolver: AnimatedEntityTextureResolver): () => void {
  resolvers.push(resolver);
  return () => {
    const idx = resolvers.indexOf(resolver);
    if (idx >= 0) resolvers.splice(idx, 1);
  };
}

export function clearAnimatedEntityTextureResolvers(): void {
  resolvers.length = 0;
}

export function hasAnimatedEntityTextureResolvers(): boolean {
  return resolvers.length > 0 || allRenderAnimationClips().length > 0;
}

export function animatedEntityTextureCacheKey(frame: Pick<AnimatedEntityTextureFrame, 'cacheKey' | 'width' | 'height'>): string {
  const key = frame.cacheKey.trim();
  if (!key) throw new Error('Animated entity texture frame cacheKey is empty');
  const width = Math.floor(frame.width);
  const height = Math.floor(frame.height);
  if (width <= 0 || height <= 0) throw new Error(`Invalid animated entity texture size ${frame.width}x${frame.height}`);
  return `${key}|${width}x${height}`;
}

export function selectAnimatedTextureLruEvictionKeys<K>(
  entries: Iterable<readonly [K, AnimatedTextureLruEntry]>,
  targetSize: number,
): K[] {
  const ordered = Array.from(entries).sort((a, b) => a[1].usedAt - b[1].usedAt);
  const removeCount = Math.max(0, ordered.length - Math.max(0, targetSize));
  const keys: K[] = [];
  for (let i = 0; i < removeCount; i++) keys.push(ordered[i][0]);
  return keys;
}

export function beginAnimatedEntityTextureFrame(): void {
  frameActiveSprites = 0;
  frameDrawnSprites = 0;
  lastClipId = null;
  lastStatId = null;
}

export function recordDrawnAnimatedEntityTexture(): void {
  frameDrawnSprites++;
}

export function getAnimatedEntityTextureDebugStats(): AnimatedEntityTextureDebugStats {
  return {
    activeSprites: frameActiveSprites,
    drawnSprites: frameDrawnSprites,
    cacheSize: textureCache.size,
    cacheCap: ANIMATED_ENTITY_TEXTURE_CACHE_MAX,
    runtimeSize: runtimeByEntityId.size,
    runtimeCap: ANIMATED_ENTITY_RUNTIME_MAX,
    resolverCount: resolvers.length,
    lastClipId,
    lastStatId,
  };
}

export function resetAnimatedEntityTextureOverride(gl?: WebGL2RenderingContext): void {
  if (gl) {
    for (const entry of textureCache.values()) gl.deleteTexture(entry.texture);
  }
  textureCache.clear();
  runtimeByEntityId.clear();
  resetRenderAnimationRuntime();
  textureUseTick = 0;
  beginAnimatedEntityTextureFrame();
}

export function animatedEntityTextureOverride(
  gl: WebGL2RenderingContext,
  entity: Entity,
  world: World,
  time: number,
  spriteIndex: number,
  spriteSource: number | string,
  spriteScale: number,
  spriteZ: number,
): AnimatedEntityTextureResult | null {
  if (!entity.alive) return null;
  const hasCustomResolvers = resolvers.length > 0;
  const canMatchRegisteredClip = hasRegisteredEntityAnimationClip(entity);
  if (!hasCustomResolvers && !canMatchRegisteredClip) return null;

  const runtime = touchRuntime(entity, world, time);
  (resolverContext as {
    entity: Entity;
    world: World;
    time: number;
    spriteIndex: number;
    spriteSource: number | string;
    spriteScale: number;
    spriteZ: number;
    runtime: AnimatedEntityTextureRuntimeContext;
  }).entity = entity;
  (resolverContext as { world: World }).world = world;
  (resolverContext as { time: number }).time = time;
  (resolverContext as { spriteIndex: number }).spriteIndex = spriteIndex;
  (resolverContext as { spriteSource: number | string }).spriteSource = spriteSource;
  (resolverContext as { spriteScale: number }).spriteScale = spriteScale;
  (resolverContext as { spriteZ: number }).spriteZ = spriteZ;
  (resolverContext as { runtime: AnimatedEntityTextureRuntimeContext }).runtime = runtime;

  let result = canMatchRegisteredClip
    ? resolveRegisteredAnimationTexture(gl, entity, time, runtime, spriteIndex, spriteSource)
    : null;
  if (!result) {
    for (const resolver of resolvers) {
      const frame = resolver(resolverContext);
      if (!frame) continue;
      result = textureForFrame(gl, frame);
      if (result) break;
    }
  }
  if (!result) return null;
  frameActiveSprites++;
  lastClipId = result.clipId ?? null;
  lastStatId = result.statId ?? null;
  return result;
}

function hasRegisteredEntityAnimationClip(entity: Entity): boolean {
  for (const clip of allRenderAnimationClips()) {
    if (renderAnimationClipMatchesEntity(clip, entity)) return true;
  }
  return false;
}

function touchRuntime(entity: Entity, world: World, time: number): AnimatedEntityRuntimeEntry {
  let entry = runtimeByEntityId.get(entity.id);
  if (!entry) {
    entry = {
      previousX: entity.x,
      previousY: entity.y,
      previousHp: entity.hp,
      movementDx: 0,
      movementDy: 0,
      movementDist2: 0,
      moving: false,
      damaged: false,
      lastSeenAt: time,
      usedAt: time,
    };
    runtimeByEntityId.set(entity.id, entry);
    trimRuntime();
    return entry;
  }

  const dx = world.delta(entry.previousX, entity.x);
  const dy = world.delta(entry.previousY, entity.y);
  const prevHp = entry.previousHp;
  entry.movementDx = dx;
  entry.movementDy = dy;
  entry.movementDist2 = dx * dx + dy * dy;
  entry.moving = entry.movementDist2 > MOVING_EPSILON_DIST2;
  entry.damaged = prevHp !== undefined && entity.hp !== undefined && entity.hp < prevHp;
  entry.previousX = entity.x;
  entry.previousY = entity.y;
  entry.previousHp = entity.hp;
  entry.lastSeenAt = time;
  entry.usedAt = time;
  return entry;
}

function resolveRegisteredAnimationTexture(
  gl: WebGL2RenderingContext,
  entity: Entity,
  time: number,
  runtime: AnimatedEntityRuntimeEntry,
  spriteIndex: number,
  spriteSource: number | string,
): AnimatedEntityTextureResult | null {
  registeredAnimationMovementDelta.dx = runtime.movementDx;
  registeredAnimationMovementDelta.dy = runtime.movementDy;
  registeredAnimationMovementDelta.distance = Math.sqrt(runtime.movementDist2);
  registeredAnimationResolveContext.entity = entity;
  registeredAnimationResolveContext.nowSec = time;
  const frameInfo = resolveEntityRenderAnimationFrame(registeredAnimationResolveContext);
  if (!frameInfo) return null;
  return animationFrameTexture(gl, entity, frameInfo, spriteIndex, spriteSource);
}

function animationFrameTexture(
  gl: WebGL2RenderingContext,
  entity: Entity,
  frameInfo: RenderAnimationFrameInfo,
  spriteIndex: number,
  spriteSource: number | string,
): AnimatedEntityTextureResult | null {
  if (frameInfo.source.kind === 'framePack' && 'framePackId' in frameInfo.source) {
    return framePackTexture(gl, frameInfo);
  }
  if (frameInfo.source.kind !== 'procedural' || !('proceduralId' in frameInfo.source)) return null;
  const source = renderAnimationProceduralSourceById(frameInfo.source.proceduralId);
  if (!source) return null;
  const result = resolveProceduralAnimationSource(source, {
    clipId: frameInfo.clipId,
    visualKey: proceduralVisualKey(entity, spriteIndex, spriteSource),
    frameIndex: frameInfo.frameIndex,
    phase: frameInfo.frameCount > 0 ? frameInfo.frameIndex / frameInfo.frameCount : 0,
    seed: entity.spriteSeed ?? entity.id,
    width: frameInfo.source.width ?? frameInfo.anchor?.width,
    height: frameInfo.source.height ?? frameInfo.anchor?.height,
  });
  if (!result || result.kind !== 'frame') return null;
  const cacheKey = animatedEntityTextureCacheKey({
    cacheKey: `procedural:${result.cacheKey}`,
    width: result.frame.width,
    height: result.frame.height,
  });
  const cached = cachedTexture(cacheKey);
  if (cached) return cached;
  return uploadFrameTexture(gl, {
    cacheKey,
    pixels: result.frame.pixels,
    width: result.frame.width,
    height: result.frame.height,
    clipId: frameInfo.clipId,
    statId: frameInfo.clipId,
    frameIndex: frameInfo.frameIndex,
    anchor: result.frame.anchor?.anchorFeet
      ? { kind: 'feet', x: result.frame.anchor.anchorFeet.x, y: result.frame.anchor.anchorFeet.y }
      : undefined,
  }, cacheKey);
}

function framePackTexture(gl: WebGL2RenderingContext, frameInfo: RenderAnimationFrameInfo): AnimatedEntityTextureResult | null {
  if (frameInfo.source.kind !== 'framePack' || !('framePackId' in frameInfo.source)) return null;
  const pack = getGeneratedAnimationFramePack(frameInfo.source.framePackId);
  if (!pack) return null;
  const cacheKey = animatedEntityTextureCacheKey({
    cacheKey: `${frameInfo.clipId}:${frameInfo.frameIndex}:${pack.sha256}`,
    width: pack.width,
    height: pack.height,
  });
  const cached = cachedTexture(cacheKey);
  if (cached) return cached;

  const pixels = decodeGeneratedAnimationFrame(pack.id, frameInfo.frameIndex);
  if (!pixels) return null;
  return uploadFrameTexture(gl, {
    cacheKey,
    pixels,
    width: pack.width,
    height: pack.height,
    clipId: frameInfo.clipId,
    statId: frameInfo.clipId,
    frameIndex: frameInfo.frameIndex,
    anchor: frameInfo.anchor?.anchorFeet
      ? { kind: 'feet', x: frameInfo.anchor.anchorFeet.x, y: frameInfo.anchor.anchorFeet.y }
      : undefined,
  }, cacheKey);
}

function trimRuntime(): void {
  if (runtimeByEntityId.size <= ANIMATED_ENTITY_RUNTIME_MAX) return;
  const removeKeys = selectAnimatedTextureLruEvictionKeys(
    Array.from(runtimeByEntityId, ([key, entry]) => [key, { usedAt: entry.lastSeenAt }] as const),
    ANIMATED_ENTITY_RUNTIME_MAX,
  );
  for (const key of removeKeys) runtimeByEntityId.delete(key);
}

function textureForFrame(gl: WebGL2RenderingContext, frame: AnimatedEntityTextureFrame): AnimatedEntityTextureResult | null {
  const key = animatedEntityTextureCacheKey(frame);
  const cached = cachedTexture(key);
  if (cached) return cached;
  return uploadFrameTexture(gl, frame, key);
}

function cachedTexture(key: string): AnimatedTextureCacheEntry | null {
  textureUseTick++;
  const cached = textureCache.get(key);
  if (cached) {
    cached.usedAt = textureUseTick;
    return cached;
  }
  return null;
}

function uploadFrameTexture(
  gl: WebGL2RenderingContext,
  frame: AnimatedEntityTextureFrame,
  key: string,
): AnimatedTextureCacheEntry | null {
  const pixels = framePixelsToRgba8(frame);
  if (!pixels) return null;
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Math.floor(frame.width), Math.floor(frame.height), 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const entry: AnimatedTextureCacheEntry = {
    texture,
    usedAt: textureUseTick,
    width: Math.floor(frame.width),
    height: Math.floor(frame.height),
    clipId: frame.clipId,
    statId: frame.statId,
    frameIndex: frame.frameIndex,
    anchor: frame.anchor,
  };
  textureCache.set(key, entry);
  trimTextureCache(gl);
  return entry;
}

function framePixelsToRgba8(frame: AnimatedEntityTextureFrame): Uint8Array | null {
  const width = Math.floor(frame.width);
  const height = Math.floor(frame.height);
  const pixelCount = width * height;
  if (width <= 0 || height <= 0 || pixelCount <= 0) return null;
  if (frame.pixels instanceof Uint8Array) {
    return frame.pixels.length >= pixelCount * 4 ? frame.pixels : null;
  }
  if (frame.pixels.length < pixelCount) return null;
  const out = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const c = frame.pixels[i];
    out[i * 4 + 0] = c & 0xff;
    out[i * 4 + 1] = (c >>> 8) & 0xff;
    out[i * 4 + 2] = (c >>> 16) & 0xff;
    out[i * 4 + 3] = (c >>> 24) & 0xff;
  }
  return out;
}

function trimTextureCache(gl: WebGL2RenderingContext): void {
  if (textureCache.size <= ANIMATED_ENTITY_TEXTURE_CACHE_MAX) return;
  const removeKeys = selectAnimatedTextureLruEvictionKeys(textureCache, ANIMATED_ENTITY_TEXTURE_CACHE_TARGET);
  for (const key of removeKeys) {
    const entry = textureCache.get(key);
    if (!entry) continue;
    gl.deleteTexture(entry.texture);
    textureCache.delete(key);
  }
}
