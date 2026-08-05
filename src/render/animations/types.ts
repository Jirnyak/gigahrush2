import type {
  AIGoal,
  Entity,
  EntityType,
  MonsterKind,
  NpcState,
  Occupation,
  PlayerStatusId,
} from '../../core/types';

export const RENDER_ANIMATION_PRIORITY = {
  harm: 100,
  action: 80,
  specialState: 60,
  locomotion: 30,
  idle: 10,
  fallback: 0,
} as const;

export type RenderAnimationChannel = 'entity_sprite' | 'surface_material' | 'screen_fx';
export type RenderAnimationTriggerKind = 'moving' | 'damaged' | 'state' | 'always' | 'manual_event';

export type RenderAnimationMatchValue<T extends string | number> = T | readonly T[];

export interface RenderAnimationSelector {
  plotNpcId?: RenderAnimationMatchValue<string>;
  npcVisualId?: RenderAnimationMatchValue<string>;
  fallbackPlotNpcId?: RenderAnimationMatchValue<string>;
  entityType?: RenderAnimationMatchValue<EntityType>;
  monsterKind?: RenderAnimationMatchValue<MonsterKind>;
  sprite?: RenderAnimationMatchValue<number>;
  occupation?: RenderAnimationMatchValue<Occupation>;
}

export interface RenderAnimationStateSelector {
  aiGoal?: RenderAnimationMatchValue<AIGoal>;
  npcState?: RenderAnimationMatchValue<NpcState>;
  monsterStage?: RenderAnimationMatchValue<number>;
  statusId?: RenderAnimationMatchValue<PlayerStatusId | string>;
  attackCooldownActive?: boolean;
  windupActive?: boolean;
  tag?: RenderAnimationMatchValue<string>;
}

export interface RenderAnimationMovementDelta {
  dx: number;
  dy: number;
  distance?: number;
}

export interface RenderAnimationManualEvent {
  id: string;
  serial?: number;
  atSec?: number;
}

export interface RenderAnimationResolveContext {
  entity: Entity;
  nowSec: number;
  movementDelta?: RenderAnimationMovementDelta;
  manualEvent?: RenderAnimationManualEvent;
  stateTags?: readonly string[];
  clips?: readonly RenderAnimationClipDef[];
  runtimeLimit?: number;
}

export interface RenderAnimationRuntimeEntry {
  entityId: number;
  prevX: number;
  prevY: number;
  prevHp?: number;
  lastSeenAt: number;
  activeClipId?: string;
  activeStartedAt: number;
  activeUntil?: number;
  activeHoldLast?: boolean;
  lastDamageAt?: number;
  walkDistancePhase: number;
  lastStartedAtByClip: Map<string, number>;
}

export type RenderAnimationPredicate = (
  ctx: RenderAnimationResolveContext,
  memory: RenderAnimationRuntimeEntry,
) => boolean;

export type RenderAnimationTrigger =
  | { kind: 'always' }
  | { kind: 'moving'; minDistance?: number }
  | { kind: 'damaged'; minHpDelta?: number }
  | { kind: 'state'; state?: RenderAnimationStateSelector; predicate?: RenderAnimationPredicate }
  | { kind: 'manual_event'; eventId?: RenderAnimationMatchValue<string> };

export interface RenderAnimationPlayback {
  mode?: 'loop' | 'once';
  loop?: boolean;
  once?: boolean;
  holdLast?: boolean;
  fps?: number;
  durationSec?: number;
  retriggerCooldownSec?: number;
  phaseByDistance?: boolean;
}

export interface RenderAnimationAnchor {
  width?: number;
  height?: number;
  anchorFeet?: {
    x: number;
    y: number;
  };
}

export type RenderAnimationSourceKind = 'framePack' | 'procedural' | 'staticFallback';

interface RenderAnimationSourceBase {
  type?: RenderAnimationSourceKind | string;
  frameCount?: number;
  frames?: readonly string[];
  width?: number;
  height?: number;
  fallback?: 'static' | string;
}

export type RenderAnimationSource =
  | (RenderAnimationSourceBase & { kind: 'framePack'; framePackId: string })
  | (RenderAnimationSourceBase & { kind: 'procedural'; proceduralId: string })
  | (RenderAnimationSourceBase & { kind: 'staticFallback' });

export interface RenderAnimationCachePolicy {
  maxEntries?: number;
  ttlSec?: number;
}

export interface RenderAnimationClipDef {
  id: string;
  channel: RenderAnimationChannel;
  selector: RenderAnimationSelector;
  trigger: RenderAnimationTrigger;
  playback: RenderAnimationPlayback;
  priority: number;
  source: RenderAnimationSource;
  anchor?: RenderAnimationAnchor;
  anchorFeet?: {
    x: number;
    y: number;
  };
  cache?: RenderAnimationCachePolicy;
}

export interface RenderAnimationFrameInfo {
  clipId: string;
  channel: RenderAnimationChannel;
  source: RenderAnimationSource;
  frameIndex: number;
  frameCount: number;
  priority: number;
  startedAt: number;
  elapsedSec: number;
  done: boolean;
  heldLast: boolean;
  anchor?: RenderAnimationAnchor;
}

export interface RenderAnimationProceduralContext {
  clipId: string;
  visualKey: string;
  frameIndex: number;
  phase: number;
  phaseBucket: number;
  seed: number;
  width: number;
  height: number;
}

export interface RenderAnimationProceduralCachePolicy {
  maxEntries?: number;
  targetEntries?: number;
}

export type RenderAnimationProceduralFrameGenerator = (
  ctx: Readonly<RenderAnimationProceduralContext>,
  frame: Uint32Array,
) => Uint32Array | void | null;

export interface RenderAnimationProceduralCpuFrameSource {
  kind: 'procedural_cpu_frame';
  width?: number;
  height?: number;
  anchor?: RenderAnimationAnchor;
  phaseBuckets?: number;
  baseFrame?: Uint32Array | (() => Uint32Array | null);
  mutate: RenderAnimationProceduralFrameGenerator;
}

export type RenderAnimationPhaseParams = Readonly<Record<string, number>>;

export interface RenderAnimationProceduralPhaseSource {
  kind: 'procedural_phase';
  phaseBuckets?: number;
  resolve: (
    ctx: Readonly<RenderAnimationProceduralContext>,
  ) => RenderAnimationPhaseParams | null;
}

export type RenderAnimationProceduralSource =
  | RenderAnimationProceduralCpuFrameSource
  | RenderAnimationProceduralPhaseSource;

export interface RenderAnimationProceduralFrameResult {
  kind: 'frame';
  clipId: string;
  visualKey: string;
  frameIndex: number;
  phaseBucket: number;
  phase: number;
  seed: number;
  cacheKey: string;
  frame: {
    pixels: Uint32Array;
    width: number;
    height: number;
    anchor?: RenderAnimationAnchor;
  };
}

export interface RenderAnimationProceduralPhaseResult {
  kind: 'phase';
  clipId: string;
  visualKey: string;
  frameIndex: number;
  phaseBucket: number;
  phase: number;
  seed: number;
  params: RenderAnimationPhaseParams;
}

export type RenderAnimationProceduralResult =
  | RenderAnimationProceduralFrameResult
  | RenderAnimationProceduralPhaseResult;
