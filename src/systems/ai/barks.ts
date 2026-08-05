/* ── A-Life barks: contextual NPC dialogue lines ─────────────── */

import { type Entity, type Msg, msg } from '../../core/types';
import { generateMarkovBark, isUnsafeMarkovBarkSignal } from '../markov_barks';
import { routeBarkSpeech } from '../markov_router_adapters';
import {
  npcPackageSpeechContextTags,
  resolveNpcPackageForEntity,
  selectNpcCuratedFallback,
} from '../npc_package_speech';

/* ── Probabilities ────────────────────────────────────────────── */

export const BARK_CHANCE_COMBAT = 0.06;
export const BARK_CHANCE_WOUNDED = 0.04;
export const BARK_CHANCE_FLEE = 0.08;
export const BARK_CHANCE_KILL = 0.12;
export const BARK_CHANCE_ARRIVE = 0.008;
export const BARK_CHANCE_HIDE = 0.03;
export const BARK_CHANCE_GENERIC = 0.01;

/* ── Helpers ──────────────────────────────────────────────────── */

const BARK_ENTITY_COOLDOWN_S = 6;
const MAX_BARK_COOLDOWNS = 1536;
export const DEFAULT_NPC_BARK_LOG_RADIUS_METERS = 100;
const MAX_NPC_BARK_LOG_RADIUS_METERS = 1024;
const lastBarkByEntity = new Map<number, { time: number; text: string }>();
export type NpcBarkSignal = 'alert' | 'witness' | 'lead' | 'ambient';

export interface NpcBarkLogContext {
  listener?: Pick<Entity, 'x' | 'y'>;
  radiusMeters?: number;
  dist2?: (x1: number, y1: number, x2: number, y2: number) => number;
  signal?: NpcBarkSignal;
  hud?: boolean;
  hudPriority?: number;
}

let npcBarkLogContext: NpcBarkLogContext = {
  radiusMeters: DEFAULT_NPC_BARK_LOG_RADIUS_METERS,
};

export function resolveNpcBarkLogRadiusMeters(radiusMeters?: number): number {
  if (!Number.isFinite(radiusMeters)) return DEFAULT_NPC_BARK_LOG_RADIUS_METERS;
  return Math.max(0, Math.min(MAX_NPC_BARK_LOG_RADIUS_METERS, Math.round(radiusMeters!)));
}

export function setNpcBarkLogContext(context: NpcBarkLogContext = {}): void {
  npcBarkLogContext = {
    listener: context.listener,
    radiusMeters: resolveNpcBarkLogRadiusMeters(context.radiusMeters),
    dist2: context.dist2,
  };
}

function resolveNpcBarkContext(context?: NpcBarkLogContext): NpcBarkLogContext {
  if (!context) return npcBarkLogContext;
  return {
    listener: context.listener ?? npcBarkLogContext.listener,
    radiusMeters: context.radiusMeters ?? npcBarkLogContext.radiusMeters,
    dist2: context.dist2 ?? npcBarkLogContext.dist2,
    signal: context.signal,
    hud: context.hud,
    hudPriority: context.hudPriority,
  };
}

function npcBarkDistanceForLog(e: Entity, context: NpcBarkLogContext = npcBarkLogContext): number | null | undefined {
  const listener = context.listener;
  if (!listener) return undefined;
  const d2 = context.dist2
    ? context.dist2(listener.x, listener.y, e.x, e.y)
    : (listener.x - e.x) * (listener.x - e.x) + (listener.y - e.y) * (listener.y - e.y);
  if (!Number.isFinite(d2)) return undefined;
  const distance = Math.sqrt(Math.max(0, d2));
  if (distance > resolveNpcBarkLogRadiusMeters(context.radiusMeters)) return null;
  return Math.max(0, Math.round(distance));
}

export function pushNpcLogMessage(
  e: Entity,
  msgs: Msg[],
  time: number,
  text: string,
  color = '#cca',
  context?: NpcBarkLogContext,
): boolean {
  const resolvedContext = resolveNpcBarkContext(context);
  const distanceMeters = npcBarkDistanceForLog(e, resolvedContext);
  if (distanceMeters === null) return false;
  const entry = msg(text, time, color, distanceMeters);
  if (resolvedContext.hud !== undefined) entry.hud = resolvedContext.hud;
  if (resolvedContext.hudPriority !== undefined) entry.hudPriority = resolvedContext.hudPriority;
  msgs.push(entry);
  return true;
}

export function pushNpcBarkMessage(
  e: Entity,
  msgs: Msg[],
  time: number,
  line: string,
  color = '#cca',
  context?: NpcBarkLogContext,
): boolean {
  if (!e.name) return false;
  const resolvedContext = resolveNpcBarkContext(context);
  const signal = resolvedContext.signal ?? 'ambient';
  return pushNpcLogMessage(e, msgs, time, `${e.name}: ${line}`, color, {
    ...resolvedContext,
    hud: resolvedContext.hud ?? barkSignalShowsHud(signal),
    hudPriority: resolvedContext.hudPriority ?? barkSignalHudPriority(signal),
  });
}

export function emitMarkovBark(e: Entity, msgs: Msg[], time: number, signal: string, fallback: string, chance: number = 1.0, color = '#cca'): void {
  if (Math.random() > chance) return;
  if (!e.name) return;
  const last = lastBarkByEntity.get(e.id);
  if (last && time - last.time < BARK_ENTITY_COOLDOWN_S && last.text === fallback) return;

  const pack = resolveNpcPackageForEntity(e);
  const seed = e.alifeId ?? e.id;
  const packageFallback = pack && !isUnsafeMarkovBarkSignal(signal)
    ? selectNpcCuratedFallback(pack, 'bark_ambient', seed)
    : undefined;
  const routed = generateMarkovBark({
    actor: {
      id: e.id,
      name: e.name,
      faction: e.faction,
      occupation: e.occupation,
    },
    signal,
    exactFallback: packageFallback ?? fallback,
    seed,
    repeatIndex: Math.floor(time),
    tags: pack ? npcPackageSpeechContextTags(pack, e, 'bark') : undefined,
    routeSpeech: routeBarkSpeech,
  });

  const text = routed?.text ?? fallback;
  const heard = pushNpcBarkMessage(e, msgs, time, text, color, { signal: signal as any });
  if (heard) {
    // Determine display duration: minimum 2.5s, plus 0.12s per character, max 6s
    const duration = Math.min(6, Math.max(2.5, text.length * 0.12));
    e.activeBark = { text, until: time + duration, color };
  }
  if (!heard) return;
  lastBarkByEntity.set(e.id, { time, text: fallback });
  if (lastBarkByEntity.size > MAX_BARK_COOLDOWNS) pruneBarkCooldowns();
}

function barkSignalShowsHud(signal: NpcBarkSignal): boolean {
  return signal === 'alert' || signal === 'witness';
}

function barkSignalHudPriority(signal: NpcBarkSignal): number {
  switch (signal) {
    case 'alert': return 80;
    case 'witness': return 58;
    case 'lead': return 38;
    default: return 8;
  }
}

function pruneBarkCooldowns(): void {
  let oldestId = -1;
  let oldestTime = Infinity;
  for (const [id, entry] of lastBarkByEntity) {
    if (entry.time < oldestTime) {
      oldestTime = entry.time;
      oldestId = id;
    }
  }
  if (oldestId >= 0) lastBarkByEntity.delete(oldestId);
}
