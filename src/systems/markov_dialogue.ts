/* ── Markov dialogue adapter: ordinary NPC talk only ──────────── */

import { type Entity, FloorLevel, RoomType, Faction, Occupation, QuestType } from '../core/types';
import { type ContextSnapshot } from './context';
import { type NpcMemory } from './npc_memory';
import {
  npcPackageSpeechContextTags,
  resolveNpcPackageForEntity,
  selectNpcCuratedFallback,
  type NpcSpeechPackageView,
} from './npc_package_speech';

export type MarkovAdapterIntent =
  | 'talk_context'
  | 'talk_ambient'
  | 'rumor_flavor'
  | 'procedural_quest'
  | 'locked_author_text';

export type MarkovAdapterSource = 'generated_markov' | 'curated_pool' | 'locked_author_text';

export interface MarkovAdapterTextContext {
  actorId?: number;
  actorAlifeId?: number;
  targetId?: number;
  targetAlifeId?: number;
  floor?: FloorLevel;
  roomType?: RoomType;
  roomName?: string;
  zoneId?: number;
  faction?: Faction;
  occupation?: Occupation;
  needBand?: 'ok' | 'low' | 'urgent';
  dangerBand?: 'quiet' | 'uneasy' | 'threat' | 'combat' | 'panic';
  eventType?: string;
  eventId?: number;
  itemId?: string;
  itemName?: string;
  monsterKind?: number;
  questId?: number;
  questType?: QuestType;
  contractId?: string;
  tags: readonly string[];
}

export interface MarkovAdapterSpeechRequest {
  intent: MarkovAdapterIntent;
  source?: MarkovAdapterSource;
  context: MarkovAdapterTextContext;
  lockedText?: string;
  exactFallback?: string;
  repeatIndex?: number;
  maxChars?: number;
  seed?: number | string;
}

export interface MarkovAdapterSpeechResult {
  text: string;
  source: MarkovAdapterSource;
  intent: MarkovAdapterIntent;
  templateId?: string;
  domainId?: string;
  tags: readonly string[];
  fallbackUsed: boolean;
}

export type MarkovRouteSpeech = (request: MarkovAdapterSpeechRequest) => MarkovAdapterSpeechResult | undefined;

export interface MarkovDialogueOptions {
  memory?: NpcMemory;
  lockedText?: string;
  exactFallback?: string;
  seed?: number | string;
  repeatIndex?: number;
  time?: number;
  maxChars?: number;
  routeSpeech?: MarkovRouteSpeech;
}

const DEFAULT_MAX_TALK_CHARS = 140;

import { routeAdapterSpeech } from './markov_router_adapters';

export function renderMarkovDialogueTalk(
  npc: Entity,
  snapshot: ContextSnapshot,
  options: MarkovDialogueOptions = {},
): MarkovAdapterSpeechResult {
  const locked = cleanLine(options.lockedText);
  if (locked) {
    return {
      text: locked,
      source: 'locked_author_text',
      intent: 'locked_author_text',
      tags: ['locked_author_text'],
      fallbackUsed: false,
    };
  }

  const memory = options.memory ?? minimalMemory(npc, options.time ?? 0);
  const seed = options.seed ?? npc.alifeId ?? npc.id;
  const intent: MarkovAdapterIntent = hasContextAnchor(snapshot) ? 'talk_context' : 'talk_ambient';
  const pack = resolveNpcPackageForEntity(npc);
  const packageFallback = pack ? selectNpcCuratedFallback(pack, intent, seed) : undefined;
  const exactFallback = cleanLine(options.exactFallback) ?? packageFallback;
  const context = dialogueContext(npc, snapshot, memory, pack);
  const maxChars = options.maxChars ?? DEFAULT_MAX_TALK_CHARS;
  const router = options.routeSpeech ?? routeAdapterSpeech;
  
  const request: MarkovAdapterSpeechRequest = {
    intent,
    source: 'generated_markov',
    context,
    exactFallback,
    repeatIndex: options.repeatIndex,
    maxChars,
    seed,
  };

  const routed = router?.(request);
  if (routed && validDialogueText(routed.text, context, maxChars)) {
    return { ...routed, intent, tags: routed.tags.length ? routed.tags : context.tags, fallbackUsed: routed.fallbackUsed };
  }

  return {
    text: exactFallback ?? '...',
    source: exactFallback ? 'curated_pool' : 'generated_markov',
    intent,
    domainId: 'ordinary_dialogue',
    tags: context.tags,
    fallbackUsed: true,
  };
}

function dialogueContext(
  npc: Entity,
  snapshot: ContextSnapshot,
  memory: NpcMemory,
  pack: NpcSpeechPackageView | undefined,
): MarkovAdapterTextContext {
  const tags: string[] = ['dialogue', 'ordinary_npc'];
  if (pack) tags.push(...npcPackageSpeechContextTags(pack, npc, 'dialogue'));
  if (snapshot.roomName) tags.push('room');
  if (snapshot.isHungry) tags.push('need.food');
  if (snapshot.isThirsty) tags.push('need.water');
  if (snapshot.isWounded || snapshot.isCritical) tags.push('need.medical');
  if (snapshot.samosborActive || snapshot.hasRecentSamosborWarning) tags.push('danger.samosbor');
  if (snapshot.isDangerousZone) tags.push('danger.zone');
  if (snapshot.nearbyContainer) tags.push('container');
  if (snapshot.nearbyProduction) tags.push('production');
  if (snapshot.hasActiveContract) tags.push('contract');
  if (memory.trustPlayer > 35) tags.push('relation.warm');
  if (memory.trustPlayer < -20 || memory.fear > 45) tags.push('relation.cold');

  return {
    actorId: npc.id,
    actorAlifeId: npc.alifeId,
    floor: snapshot.floor,
    roomType: snapshot.roomType,
    roomName: snapshot.roomName,
    zoneId: snapshot.zoneId,
    faction: snapshot.npcFaction ?? npc.faction,
    occupation: snapshot.npcOccupation as Occupation | undefined,
    needBand: snapshot.isCritical || snapshot.isHungry || snapshot.isThirsty ? 'urgent' : snapshot.isWounded ? 'low' : 'ok',
    dangerBand: snapshot.samosborActive ? 'panic' : snapshot.isDangerousZone ? 'threat' : snapshot.hasRecentSamosborWarning ? 'uneasy' : 'quiet',
    tags,
  };
}

function validDialogueText(text: string, context: MarkovAdapterTextContext, maxChars: number): boolean {
  if (text.length > maxChars) return false;
  if (context.roomName && text.includes('__ANCHOR__')) return false;
  return true;
}

export function cleanLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  return t.length > 0 ? t : undefined;
}

export function hasContextAnchor(snapshot: ContextSnapshot): boolean {
  return snapshot.roomName !== undefined || snapshot.zoneId !== undefined || snapshot.floor !== undefined;
}

export function minimalMemory(npc: Entity, now: number): NpcMemory {
  return {
    entityId: npc.id,
    lastSeenPlayerAt: -Infinity,
    helpedByPlayer: 0,
    hurtByPlayer: 0,
    knownRumorIds: [],
    fear: 0,
    trustPlayer: npc.playerRelation ?? 0,
    lastSpokeAt: now,
    lastRumorAt: -Infinity,
    lastContextAt: -Infinity,
    lastBarkAt: -Infinity,
    lastMemoryTickMinute: -1,
    lastRumorEventId: 0,
    lastEventRumorId: '',
    lastEventRumorAt: -Infinity,
    lastWitnessFactLineAt: -Infinity,
    lastWitnessFactEventId: 0,
    lastTouchedAt: now,
    observedFacts: [],
  };
}

export function hashSpeechSeed(seed: number | string | undefined, repeatIndex = 0, salt = ''): number {
  let h = 0x811c9dc5 ^ repeatIndex;
  const input = `${seed ?? 0}|${salt}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
