import type { WorldEvent } from '../core/types';
import type { ContextSnapshot } from './context';
import {
  buildMarkovBarkContext,
  exactFallbackResult,
  isUnsafeMarkovBarkSignal,
  normalizeRouterResult,
  type MarkovNpcSpeechActorFacts,
  type MarkovNpcSpeechContext,
  type MarkovNpcSpeechEventFacts,
  type MarkovNpcSpeechTargetFacts,
  type MarkovSpeechAdapterResult,
  type MarkovSpeechRouter,
} from './markov_barks';

export interface MarkovLogSpeechRequest {
  routeSpeech?: MarkovSpeechRouter;
  event: MarkovLogSpeechEventFacts;
  actor?: MarkovNpcSpeechActorFacts;
  target?: MarkovNpcSpeechTargetFacts;
  context?: Partial<ContextSnapshot>;
  isSpeech?: boolean;
  exactFallback?: string;
  maxChars?: number;
  repeatIndex?: number;
  seed?: number | string;
  tags?: readonly string[];
}

export type MarkovLogSpeechEventFacts = Pick<
  WorldEvent,
  | 'id'
  | 'type'
  | 'actorId'
  | 'actorName'
  | 'actorFaction'
  | 'targetId'
  | 'targetName'
  | 'targetFaction'
  | 'itemId'
  | 'itemName'
  | 'itemCount'
  | 'roomId'
  | 'zoneId'
  | 'x'
  | 'y'
  | 'tags'
  | 'data'
>;

export const DEFAULT_MARKOV_LOG_SPEECH_MAX_CHARS = 128;
export const MAX_MARKOV_LOG_SPEECH_CHARS = 180;

const EXPLICIT_SPEECH_TAGS = new Set(['npc_speech', 'log_speech', 'spoken']);

export function eventIsMarkedNpcSpeech(event: MarkovLogSpeechEventFacts, isSpeech = false): boolean {
  if (isSpeech) return true;
  for (const tag of event.tags) {
    if (EXPLICIT_SPEECH_TAGS.has(tag)) return true;
  }
  return event.data?.npcSpeech === true || event.data?.speech === true;
}

export function buildMarkovLogSpeechContext(request: MarkovLogSpeechRequest): MarkovNpcSpeechContext {
  const event = request.event;
  const actor: MarkovNpcSpeechActorFacts = {
    id: request.actor?.id ?? event.actorId,
    name: request.actor?.name ?? event.actorName,
    faction: request.actor?.faction ?? event.actorFaction,
    occupation: request.actor?.occupation,
    isFemale: request.actor?.isFemale,
    hpRatio: request.actor?.hpRatio,
  };
  const target: MarkovNpcSpeechTargetFacts = {
    id: request.target?.id ?? event.targetId,
    name: request.target?.name ?? event.targetName,
    faction: request.target?.faction ?? event.targetFaction,
  };
  const eventFacts: MarkovNpcSpeechEventFacts = {
    id: event.id,
    type: event.type,
    targetId: event.targetId,
    targetName: event.targetName,
    targetFaction: event.targetFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    roomId: event.roomId,
    zoneId: event.zoneId,
    x: event.x,
    y: event.y,
    tags: event.tags,
  };
  return buildMarkovBarkContext({
    signal: 'witness',
    actor,
    target,
    event: eventFacts,
    context: request.context,
    tags: ['log_speech', ...(request.tags ?? [])],
    exactFallback: request.exactFallback,
  });
}

export function generateMarkovLogSpeech(request: MarkovLogSpeechRequest): MarkovSpeechAdapterResult | undefined {
  if (!eventIsMarkedNpcSpeech(request.event, request.isSpeech)) return undefined;
  const context = buildMarkovLogSpeechContext(request);
  if (!context.actorName && context.actorId === undefined) {
    return exactFallbackResult('log_speech', request.exactFallback, context.tags, 'missing_speaker');
  }
  if (logSpeechEventIsUnsafe(request.event, context)) {
    return exactFallbackResult('log_speech', request.exactFallback, context.tags, 'unsafe_log_speech');
  }
  if (!request.routeSpeech) {
    return exactFallbackResult('log_speech', request.exactFallback, context.tags, 'missing_router');
  }

  const maxChars = normalizeLogMaxChars(request.maxChars);
  const result = request.routeSpeech({
    intent: 'log_speech',
    source: 'generated_markov',
    context,
    exactFallback: request.exactFallback,
    repeatIndex: request.repeatIndex,
    maxChars,
    seed: request.seed,
  });
  return normalizeRouterResult(result, request.exactFallback, maxChars, MAX_MARKOV_LOG_SPEECH_CHARS);
}

export function logSpeechEventIsUnsafe(event: MarkovLogSpeechEventFacts, context = buildMarkovLogSpeechContext({
  event,
  isSpeech: true,
})): boolean {
  if (isUnsafeMarkovBarkSignal('witness', context.tags)) return true;
  if (event.type.startsWith('samosbor_')) return true;
  if (event.type === 'player_kill_monster' || event.type === 'player_kill_npc') return true;
  if (event.type === 'npc_kill_monster' || event.type === 'npc_kill_npc') return event.tags.includes('combat');
  return false;
}

function normalizeLogMaxChars(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MARKOV_LOG_SPEECH_MAX_CHARS;
  return Math.max(1, Math.min(MAX_MARKOV_LOG_SPEECH_CHARS, Math.floor(value!)));
}
