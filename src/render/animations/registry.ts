import type { Entity } from '../../core/types';
import type { RenderAnimationClipDef, RenderAnimationMatchValue, RenderAnimationSource } from './types';

export type { RenderAnimationClipDef } from './types';

const CLIP_ID_RE = /^[a-z0-9_.:-]+$/;
const clips: RenderAnimationClipDef[] = [];
const clipsById = new Map<string, RenderAnimationClipDef>();

function validateRenderAnimationClip(def: RenderAnimationClipDef): void {
  const id = def.id.trim();
  if (!id) throw new Error('[render-animation] missing clip id');
  if (id !== def.id) throw new Error(`[render-animation] clip id "${def.id}" must be trimmed`);
  if (!CLIP_ID_RE.test(id)) throw new Error(`[render-animation] invalid clip id "${def.id}"`);
  if (!Number.isFinite(def.priority)) throw new Error(`[render-animation] invalid priority for "${def.id}"`);
  if (def.playback.fps !== undefined && (!(def.playback.fps > 0) || !Number.isFinite(def.playback.fps))) {
    throw new Error(`[render-animation] invalid fps for "${def.id}"`);
  }
  if (def.playback.durationSec !== undefined && (!(def.playback.durationSec > 0) || !Number.isFinite(def.playback.durationSec))) {
    throw new Error(`[render-animation] invalid durationSec for "${def.id}"`);
  }
  if (def.playback.retriggerCooldownSec !== undefined && (!(def.playback.retriggerCooldownSec >= 0) || !Number.isFinite(def.playback.retriggerCooldownSec))) {
    throw new Error(`[render-animation] invalid retriggerCooldownSec for "${def.id}"`);
  }
  const frameCount = renderAnimationFrameCount(def);
  if (!(frameCount >= 1) || !Number.isFinite(frameCount)) {
    throw new Error(`[render-animation] invalid frame count for "${def.id}"`);
  }
}

function normalizeRenderAnimationSource(source: RenderAnimationSource): RenderAnimationSource {
  return source;
}

function normalizeRenderAnimationClip(def: RenderAnimationClipDef): RenderAnimationClipDef {
  return {
    ...def,
    source: normalizeRenderAnimationSource(def.source),
  };
}

export function registerRenderAnimationClip(def: RenderAnimationClipDef): () => boolean {
  const normalized = normalizeRenderAnimationClip(def);
  validateRenderAnimationClip(normalized);
  if (clipsById.has(normalized.id)) throw new Error(`[render-animation] duplicate clip id "${normalized.id}"`);
  clipsById.set(normalized.id, normalized);
  clips.push(normalized);
  clips.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return () => {
    if (!clipsById.delete(normalized.id)) return false;
    const index = clips.findIndex(clip => clip.id === normalized.id);
    if (index >= 0) clips.splice(index, 1);
    return true;
  };
}

export function registerRenderAnimationClips(defs: readonly RenderAnimationClipDef[]): (() => boolean)[] {
  return defs.map(registerRenderAnimationClip);
}

export function allRenderAnimationClips(): readonly RenderAnimationClipDef[] {
  return clips;
}

export function renderAnimationClipById(id: string): RenderAnimationClipDef | undefined {
  return clipsById.get(id);
}

function matchesValue<T extends string | number>(expected: RenderAnimationMatchValue<T> | undefined, actual: T | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function matchesVisualOrPlotFallback(def: RenderAnimationClipDef, entity: Entity): boolean {
  const selector = def.selector;
  const fallbackPlotNpcId = selector.fallbackPlotNpcId ?? selector.plotNpcId;
  if (selector.npcVisualId === undefined) {
    return matchesValue(fallbackPlotNpcId, entity.plotNpcId);
  }
  if (matchesValue(selector.npcVisualId, entity.npcVisualId)) return true;
  return entity.npcVisualId === undefined && matchesValue(fallbackPlotNpcId, entity.plotNpcId);
}

export function renderAnimationClipMatchesEntity(def: RenderAnimationClipDef, entity: Entity): boolean {
  const selector = def.selector;
  return matchesVisualOrPlotFallback(def, entity)
    && matchesValue(selector.entityType, entity.type)
    && matchesValue(selector.monsterKind, entity.monsterKind)
    && matchesValue(selector.sprite, entity.sprite)
    && matchesValue(selector.occupation, entity.occupation);
}

export function highestPriorityRenderAnimationClip(clipsToSearch: readonly RenderAnimationClipDef[]): RenderAnimationClipDef | undefined {
  let best: RenderAnimationClipDef | undefined;
  for (const clip of clipsToSearch) {
    if (!best || clip.priority > best.priority || (clip.priority === best.priority && clip.id < best.id)) best = clip;
  }
  return best;
}

export function renderAnimationFrameCount(def: RenderAnimationClipDef): number {
  return Math.max(1, Math.floor(def.source.frameCount ?? def.source.frames?.length ?? 1));
}
