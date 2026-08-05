import type { Entity } from '../../core/types';
import type { RenderAnimationRuntimeEntry } from './types';

export const DEFAULT_RENDER_ANIMATION_RUNTIME_CAP = 2048;

const runtimeByEntityId = new Map<number, RenderAnimationRuntimeEntry>();

export function resetRenderAnimationRuntime(): void {
  runtimeByEntityId.clear();
}

export function renderAnimationRuntimeEntryFor(
  entity: Entity,
  nowSec: number,
  maxEntries = DEFAULT_RENDER_ANIMATION_RUNTIME_CAP,
): RenderAnimationRuntimeEntry {
  let entry = runtimeByEntityId.get(entity.id);
  if (!entry) {
    entry = {
      entityId: entity.id,
      prevX: entity.x,
      prevY: entity.y,
      prevHp: entity.hp,
      lastSeenAt: nowSec,
      activeStartedAt: nowSec,
      walkDistancePhase: 0,
      lastStartedAtByClip: new Map(),
    };
    runtimeByEntityId.set(entity.id, entry);
  }
  entry.lastSeenAt = nowSec;
  trimRenderAnimationRuntime(maxEntries, entity.id);
  return entry;
}

export function trimRenderAnimationRuntime(
  maxEntries = DEFAULT_RENDER_ANIMATION_RUNTIME_CAP,
  protectedEntityId = -1,
): void {
  if (maxEntries < 1) maxEntries = 1;
  while (runtimeByEntityId.size > maxEntries) {
    let oldestEntityId = -1;
    let oldestLastSeenAt = Number.POSITIVE_INFINITY;
    for (const entry of runtimeByEntityId.values()) {
      if (entry.entityId === protectedEntityId) continue;
      if (entry.lastSeenAt < oldestLastSeenAt) {
        oldestLastSeenAt = entry.lastSeenAt;
        oldestEntityId = entry.entityId;
      }
    }
    if (oldestEntityId < 0) break;
    runtimeByEntityId.delete(oldestEntityId);
  }
}

export function hasRenderAnimationRuntimeEntry(entityId: number): boolean {
  return runtimeByEntityId.has(entityId);
}

export function renderAnimationRuntimeStats(): { entries: number; cap: number } {
  return {
    entries: runtimeByEntityId.size,
    cap: DEFAULT_RENDER_ANIMATION_RUNTIME_CAP,
  };
}
