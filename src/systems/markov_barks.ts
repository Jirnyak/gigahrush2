import type {
  Faction,
  FloorLevel,
  Occupation,
  RoomType,
  WorldEventType,
} from '../core/types';
import type { ContextSnapshot } from './context';

export type MarkovBarkSignal =
  | 'ambient'
  | 'lead'
  | 'witness'
  | 'alert'
  | 'combat'
  | 'flee'
  | 'wounded'
  | 'samosbor_critical'
  | (string & {});

export type MarkovSpeechIntent = 'bark_ambient' | 'log_speech';
export type MarkovSource = 'generated_markov' | 'curated_pool' | 'locked_author_text';

export interface MarkovNpcSpeechActorFacts {
  id?: number;
  name?: string;
  faction?: Faction;
  occupation?: Occupation | number;
  isFemale?: boolean;
  hpRatio?: number;
}

export interface MarkovNpcSpeechTargetFacts {
  id?: number;
  name?: string;
  faction?: Faction;
}

export interface MarkovNpcSpeechEventFacts {
  id?: number;
  type?: WorldEventType | string;
  targetId?: number;
  targetName?: string;
  targetFaction?: Faction;
  itemId?: string;
  itemName?: string;
  itemCount?: number;
  roomId?: number;
  zoneId?: number;
  x?: number;
  y?: number;
  tags?: readonly string[];
}

export interface MarkovNpcSpeechContext {
  actorId?: number;
  actorName?: string;
  actorFaction?: Faction;
  actorOccupation?: Occupation | number;
  targetId?: number;
  targetName?: string;
  targetFaction?: Faction;
  itemId?: string;
  itemName?: string;
  itemCount?: number;
  eventId?: number;
  eventType?: WorldEventType | string;
  floor?: FloorLevel;
  roomType?: RoomType;
  roomName?: string;
  roomId?: number;
  zoneId?: number;
  x?: number;
  y?: number;
  hpRatio?: number;
  tags: readonly string[];
  anchors: readonly string[];
  snapshot?: Partial<ContextSnapshot>;
}

export interface MarkovSpeechRouterRequest {
  intent: MarkovSpeechIntent;
  source?: MarkovSource;
  context: MarkovNpcSpeechContext;
  lockedText?: string;
  exactFallback?: string;
  repeatIndex?: number;
  maxChars?: number;
  seed?: number | string;
}

export interface MarkovSpeechRouterResult {
  text: string;
  source: MarkovSource;
  intent: MarkovSpeechIntent;
  templateId?: string;
  domainId?: string;
  tags: readonly string[];
  fallbackUsed: boolean;
}

export interface MarkovSpeechAdapterResult extends MarkovSpeechRouterResult {
  rejected?: boolean;
  rejectReason?: string;
}

export type MarkovSpeechRouter = (request: MarkovSpeechRouterRequest) => MarkovSpeechRouterResult;

export interface MarkovBarkRequest {
  routeSpeech?: MarkovSpeechRouter;
  signal?: MarkovBarkSignal;
  actor: MarkovNpcSpeechActorFacts;
  target?: MarkovNpcSpeechTargetFacts;
  event?: MarkovNpcSpeechEventFacts;
  context?: Partial<ContextSnapshot>;
  exactFallback?: string;
  maxChars?: number;
  repeatIndex?: number;
  seed?: number | string;
  tags?: readonly string[];
}

export const DEFAULT_MARKOV_BARK_MAX_CHARS = 96;
export const MAX_MARKOV_BARK_CHARS = 160;

const UNSAFE_BARK_SIGNALS = new Set([
  'alert',
  'combat',
  'flee',
  'wounded',
  'samosbor_critical',
]);

const UNSAFE_BARK_TAGS = new Set([
  'alert',
  'combat',
  'flee',
  'wounded',
  'samosbor_critical',
  'shelter_instruction',
  'shelter_critical',
]);

export function markovBarkIntentForSignal(signal: MarkovBarkSignal = 'ambient'): MarkovSpeechIntent {
  return signal === 'witness' ? 'log_speech' : 'bark_ambient';
}

export function isUnsafeMarkovBarkSignal(signal: MarkovBarkSignal = 'ambient', tags: readonly string[] = []): boolean {
  const normalized = signal.toLowerCase();
  if (UNSAFE_BARK_SIGNALS.has(normalized)) return true;
  if (normalized.includes('combat') || normalized.includes('wounded') || normalized.includes('flee')) return true;
  if (normalized.includes('samosbor') && normalized.includes('critical')) return true;
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (UNSAFE_BARK_TAGS.has(t)) return true;
    if (t.includes('combat') || t.includes('wounded') || t.includes('flee')) return true;
    if (t.includes('samosbor') && (t.includes('critical') || t.includes('shelter'))) return true;
  }
  return false;
}

export function buildMarkovBarkContext(request: MarkovBarkRequest): MarkovNpcSpeechContext {
  const signal = request.signal ?? 'ambient';
  const context = request.context;
  const event = request.event;
  const actor = request.actor;
  const target = request.target;
  const tags = uniqueTags([
    'bark',
    `bark_${signal}`,
    ...(request.tags ?? []),
    ...(event?.tags ?? []),
  ]);
  const targetId = target?.id ?? event?.targetId;
  const targetName = cleanText(target?.name) ?? cleanText(event?.targetName);
  const targetFaction = target?.faction ?? event?.targetFaction;
  const roomName = cleanText(context?.roomName);
  const itemName = cleanText(event?.itemName);
  const anchors = uniqueAnchors([
    cleanText(actor.name),
    roomName,
    targetName,
    itemName,
    cleanText(event?.type),
  ]);

  return {
    actorId: finiteId(actor.id),
    actorName: cleanText(actor.name),
    actorFaction: actor.faction,
    actorOccupation: actor.occupation,
    targetId: finiteId(targetId),
    targetName,
    targetFaction,
    itemId: cleanText(event?.itemId),
    itemName,
    itemCount: finitePositive(event?.itemCount),
    eventId: finiteId(event?.id),
    eventType: event?.type,
    floor: context?.floor,
    roomType: context?.roomType,
    roomName,
    roomId: finiteId(event?.roomId),
    zoneId: finiteId(event?.zoneId ?? context?.zoneId),
    x: finiteCoord(event?.x),
    y: finiteCoord(event?.y),
    hpRatio: finiteRatio(actor.hpRatio ?? context?.npcHpRatio),
    tags,
    anchors,
    snapshot: context,
  };
}

export function generateMarkovBark(request: MarkovBarkRequest): MarkovSpeechAdapterResult | undefined {
  const signal = request.signal ?? 'ambient';
  const context = buildMarkovBarkContext(request);
  const intent = markovBarkIntentForSignal(signal);
  if (isUnsafeMarkovBarkSignal(signal, context.tags)) {
    return exactFallbackResult(intent, request.exactFallback, context.tags, `unsafe_${signal}`);
  }
  if (!request.routeSpeech) return exactFallbackResult(intent, request.exactFallback, context.tags, 'missing_router');

  const maxChars = normalizeMaxChars(request.maxChars, DEFAULT_MARKOV_BARK_MAX_CHARS, MAX_MARKOV_BARK_CHARS);
  const result = request.routeSpeech({
    intent,
    source: 'generated_markov',
    context,
    exactFallback: request.exactFallback,
    repeatIndex: request.repeatIndex,
    maxChars,
    seed: request.seed,
  });
  return normalizeRouterResult(result, request.exactFallback, maxChars, MAX_MARKOV_BARK_CHARS);
}

export function generateAmbientBark(request: Omit<MarkovBarkRequest, 'signal'>): MarkovSpeechAdapterResult | undefined {
  return generateMarkovBark({ ...request, signal: 'ambient' });
}

export function generateLeadBark(request: Omit<MarkovBarkRequest, 'signal'>): MarkovSpeechAdapterResult | undefined {
  return generateMarkovBark({ ...request, signal: 'lead' });
}

export function generateWitnessBark(request: Omit<MarkovBarkRequest, 'signal'>): MarkovSpeechAdapterResult | undefined {
  return generateMarkovBark({ ...request, signal: 'witness' });
}

export function normalizeRouterResult(
  result: MarkovSpeechRouterResult,
  exactFallback: string | undefined,
  maxChars: number | undefined,
  maxAllowedChars: number,
): MarkovSpeechAdapterResult {
  const text = cleanText(result.text);
  if (!text) {
    return exactFallbackResult(result.intent, exactFallback, result.tags, 'empty_router_text')
      ?? { ...result, text: '', fallbackUsed: true, rejected: true, rejectReason: 'empty_router_text' };
  }
  return {
    ...result,
    text: clipGeneratedText(text, normalizeMaxChars(maxChars, text.length, maxAllowedChars)),
    tags: uniqueTags(result.tags),
  };
}

export function exactFallbackResult(
  intent: MarkovSpeechIntent,
  exactFallback: string | undefined,
  tags: readonly string[] = [],
  reason = 'exact_fallback',
): MarkovSpeechAdapterResult | undefined {
  const text = cleanText(exactFallback);
  if (!text) return undefined;
  return {
    text,
    source: 'locked_author_text',
    intent,
    tags: uniqueTags([...tags, 'markov_rejected', reason]),
    fallbackUsed: true,
    rejected: true,
    rejectReason: reason,
  };
}

export function clipGeneratedText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function normalizeMaxChars(value: number | undefined, fallback: number, maxAllowed: number): number {
  if (!Number.isFinite(value)) return Math.max(1, Math.min(maxAllowed, fallback));
  return Math.max(1, Math.min(maxAllowed, Math.floor(value!)));
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function finiteId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function finiteCoord(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteRatio(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function uniqueTags(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = cleanText(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function uniqueAnchors(values: readonly (string | undefined)[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const anchor = cleanText(value);
    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    out.push(anchor);
  }
  return out;
}
