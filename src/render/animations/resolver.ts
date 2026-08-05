import type { Entity } from '../../core/types';
import { allRenderAnimationClips, renderAnimationClipById, renderAnimationClipMatchesEntity } from './registry';
import { renderAnimationRuntimeEntryFor } from './runtime';
import type {
  RenderAnimationClipDef,
  RenderAnimationFrameInfo,
  RenderAnimationMatchValue,
  RenderAnimationResolveContext,
  RenderAnimationRuntimeEntry,
  RenderAnimationSource,
  RenderAnimationStateSelector,
  RenderAnimationTrigger,
} from './types';

const DEFAULT_FPS = 8;
const DEFAULT_MOVING_EPSILON = 0.015;

function matchesValue<T extends string | number>(expected: RenderAnimationMatchValue<T> | undefined, actual: T | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function movementDistance(ctx: RenderAnimationResolveContext): number {
  const delta = ctx.movementDelta;
  if (!delta) return 0;
  if (delta.distance !== undefined && Number.isFinite(delta.distance)) return Math.max(0, delta.distance);
  return Math.hypot(delta.dx, delta.dy);
}

function hpDamageDelta(entity: Entity, memory: RenderAnimationRuntimeEntry): number {
  if (entity.hp === undefined || memory.prevHp === undefined) return 0;
  return Math.max(0, memory.prevHp - entity.hp);
}

function matchesStateSelector(ctx: RenderAnimationResolveContext, state: RenderAnimationStateSelector | undefined): boolean {
  if (!state) return true;
  const entity = ctx.entity;
  if (!matchesValue(state.aiGoal, entity.ai?.goal)) return false;
  if (!matchesValue(state.npcState, entity.ai?.npcState)) return false;
  if (!matchesValue(state.monsterStage, entity.monsterStage)) return false;
  if (state.statusId !== undefined) {
    const statuses = entity.statuses ?? [];
    if (!statuses.some(status => matchesValue(state.statusId, status.id))) return false;
  }
  if (state.attackCooldownActive !== undefined) {
    const active = (entity.attackCd ?? 0) > 0;
    if (active !== state.attackCooldownActive) return false;
  }
  if (state.windupActive !== undefined) {
    const active = (entity.ai?.windupTimer ?? 0) > 0;
    if (active !== state.windupActive) return false;
  }
  if (state.tag !== undefined) {
    const tags = ctx.stateTags ?? [];
    if (!tags.some(tag => matchesValue(state.tag, tag))) return false;
  }
  return true;
}

function matchesTrigger(
  trigger: RenderAnimationTrigger,
  ctx: RenderAnimationResolveContext,
  memory: RenderAnimationRuntimeEntry,
  damageDelta: number,
  distance: number,
): boolean {
  switch (trigger.kind) {
    case 'always':
      return true;
    case 'moving':
      return distance > (trigger.minDistance ?? DEFAULT_MOVING_EPSILON);
    case 'damaged':
      return damageDelta > (trigger.minHpDelta ?? 0.001);
    case 'state':
      return matchesStateSelector(ctx, trigger.state) && (trigger.predicate ? trigger.predicate(ctx, memory) : true);
    case 'manual_event':
      return ctx.manualEvent !== undefined && matchesValue(trigger.eventId, ctx.manualEvent.id);
  }
}

function frameCount(source: RenderAnimationSource): number {
  return Math.max(1, Math.floor(source.frameCount ?? source.frames?.length ?? 1));
}

function clipPlaysOnce(def: RenderAnimationClipDef): boolean {
  return def.playback.once === true || def.playback.mode === 'once';
}

function clipDurationSec(def: RenderAnimationClipDef): number {
  if (def.playback.durationSec !== undefined) return def.playback.durationSec;
  return frameCount(def.source) / (def.playback.fps ?? DEFAULT_FPS);
}

function cooldownAllows(def: RenderAnimationClipDef, memory: RenderAnimationRuntimeEntry, nowSec: number): boolean {
  const cooldown = def.playback.retriggerCooldownSec ?? 0;
  if (cooldown <= 0) return true;
  const last = memory.lastStartedAtByClip.get(def.id);
  return last === undefined || nowSec - last >= cooldown;
}

function startClip(def: RenderAnimationClipDef, memory: RenderAnimationRuntimeEntry, nowSec: number): void {
  memory.activeClipId = def.id;
  memory.activeStartedAt = nowSec;
  memory.activeUntil = clipPlaysOnce(def) ? nowSec + clipDurationSec(def) : undefined;
  memory.activeHoldLast = clipPlaysOnce(def) ? def.playback.holdLast === true : false;
  memory.lastStartedAtByClip.set(def.id, nowSec);
}

function clearActiveClip(memory: RenderAnimationRuntimeEntry): void {
  memory.activeClipId = undefined;
  memory.activeUntil = undefined;
  memory.activeHoldLast = false;
}

function frameInfoForActiveClip(
  def: RenderAnimationClipDef,
  memory: RenderAnimationRuntimeEntry,
  nowSec: number,
  distance: number,
): RenderAnimationFrameInfo | undefined {
  const count = frameCount(def.source);
  const elapsedSec = Math.max(0, nowSec - memory.activeStartedAt);
  const durationSec = clipDurationSec(def);
  const done = clipPlaysOnce(def) && elapsedSec >= durationSec;
  if (done && !def.playback.holdLast) return undefined;

  let frameIndex = 0;
  if (done) {
    frameIndex = count - 1;
  } else if (def.playback.phaseByDistance) {
    memory.walkDistancePhase += Math.max(0, distance);
    frameIndex = Math.floor(memory.walkDistancePhase * (def.playback.fps ?? DEFAULT_FPS)) % count;
  } else {
    const fps = def.playback.fps ?? DEFAULT_FPS;
    frameIndex = clipPlaysOnce(def)
      ? Math.min(count - 1, Math.floor(elapsedSec * fps))
      : Math.floor(elapsedSec * fps) % count;
  }

  return {
    clipId: def.id,
    channel: def.channel,
    source: def.source,
    frameIndex,
    frameCount: count,
    priority: def.priority,
    startedAt: memory.activeStartedAt,
    elapsedSec,
    done,
    heldLast: done && def.playback.holdLast === true,
    anchor: def.anchor,
  };
}

function bestTriggeredClip(
  ctx: RenderAnimationResolveContext,
  memory: RenderAnimationRuntimeEntry,
  damageDelta: number,
  distance: number,
): RenderAnimationClipDef | undefined {
  let best: RenderAnimationClipDef | undefined;
  for (const def of ctx.clips ?? allRenderAnimationClips()) {
    if (!renderAnimationClipMatchesEntity(def, ctx.entity)) continue;
    if (!matchesTrigger(def.trigger, ctx, memory, damageDelta, distance)) continue;
    if (!cooldownAllows(def, memory, ctx.nowSec)) continue;
    if (!best || def.priority > best.priority || (def.priority === best.priority && def.id < best.id)) best = def;
  }
  return best;
}

function updateSnapshot(entity: Entity, memory: RenderAnimationRuntimeEntry, damageDelta: number, nowSec: number): void {
  memory.prevX = entity.x;
  memory.prevY = entity.y;
  if (entity.hp !== undefined) memory.prevHp = entity.hp;
  if (damageDelta > 0) memory.lastDamageAt = nowSec;
}

export function resolveEntityRenderAnimationFrame(ctx: RenderAnimationResolveContext): RenderAnimationFrameInfo | undefined {
  const memory = renderAnimationRuntimeEntryFor(ctx.entity, ctx.nowSec, ctx.runtimeLimit);
  const distance = movementDistance(ctx);
  const damageDelta = hpDamageDelta(ctx.entity, memory);
  const activeDef = memory.activeClipId ? renderAnimationClipById(memory.activeClipId) : undefined;
  const activeInfo = activeDef && clipPlaysOnce(activeDef)
    ? frameInfoForActiveClip(activeDef, memory, ctx.nowSec, distance)
    : undefined;
  if (activeDef && clipPlaysOnce(activeDef) && !activeInfo) clearActiveClip(memory);

  const candidate = bestTriggeredClip(ctx, memory, damageDelta, distance);
  let result = activeInfo;
  if (candidate) {
    const activeBlocks = activeInfo !== undefined && !activeInfo.heldLast && activeInfo.priority >= candidate.priority;
    if (!activeBlocks) {
      if (memory.activeClipId !== candidate.id || clipPlaysOnce(candidate)) startClip(candidate, memory, ctx.nowSec);
      result = frameInfoForActiveClip(candidate, memory, ctx.nowSec, distance);
    }
  } else if (!activeInfo && activeDef) {
    clearActiveClip(memory);
  }

  updateSnapshot(ctx.entity, memory, damageDelta, ctx.nowSec);
  return result;
}
