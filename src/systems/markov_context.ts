/* -- Markov NPC speech context lowering ------------------------- */

import {
  Faction,
  FloorLevel,
  QuestType,
  RoomType,
  ZoneFaction,
  type Quest,
  type WorldEvent,
} from '../core/types';
import type { ContractDef, QuestRouteTarget } from '../data/contracts';
import type { ContextSnapshot } from './context';
import {
  FRIENDLY_RELATION_THRESHOLD,
  HOSTILE_RELATION_THRESHOLD,
} from './npc_relations';

export type MarkovRelationBand = 'hostile' | 'cold' | 'neutral' | 'warm' | 'friend';
export type MarkovNeedBand = 'ok' | 'low' | 'urgent';
export type MarkovDangerBand = 'quiet' | 'uneasy' | 'threat' | 'combat' | 'panic';
export type MarkovRouteZBand = 'center' | 'upper' | 'lower' | 'deep';
export type MarkovWealthBand = 'broke' | 'small' | 'payday' | 'fat';
export type MarkovTimeBand = 'night' | 'morning' | 'work' | 'evening' | 'late';

export interface MarkovTextContext {
  actorId?: number;
  actorAlifeId?: number;
  targetId?: number;
  targetAlifeId?: number;
  floorKey?: string;
  floor?: FloorLevel;
  routeZBand?: MarkovRouteZBand;
  roomId?: number;
  roomType?: RoomType;
  roomName?: string;
  zoneId?: number;
  zoneFaction?: ZoneFaction;
  faction?: Faction;
  occupation?: number;
  relationBand?: MarkovRelationBand;
  socialEdgeFlags?: number;
  needBand?: MarkovNeedBand;
  dangerBand?: MarkovDangerBand;
  wealthBand?: MarkovWealthBand;
  timeBand?: MarkovTimeBand;
  itemId?: string;
  itemName?: string;
  monsterKind?: number;
  eventType?: string;
  eventId?: number;
  questId?: number;
  questType?: QuestType;
  contractId?: string;
  tags: readonly string[];
  contextHash: string;
}

export interface MarkovContextLoweringOptions {
  actorId?: number;
  actorAlifeId?: number;
  targetId?: number;
  targetAlifeId?: number;
  floorKey?: string;
  floor?: FloorLevel;
  routeZ?: number;
  routeZBand?: MarkovRouteZBand;
  roomId?: number;
  relationToPlayer?: number;
  relationBand?: MarkovRelationBand;
  socialEdgeFlags?: number;
  wealth?: number;
  wealthBand?: MarkovWealthBand;
  timeMinutes?: number;
  timeBand?: MarkovTimeBand;
  extraTags?: readonly string[];
}

export interface MarkovDemosCandidate extends MarkovContextLoweringOptions {
  event?: WorldEvent;
  eventType?: string;
  eventId?: number;
  faction?: Faction;
  zoneId?: number;
  zoneFaction?: ZoneFaction;
  itemId?: string;
  itemName?: string;
  monsterKind?: number;
  tags?: readonly string[];
}

const ROOM_TAGS: Record<RoomType, string> = {
  [RoomType.LIVING]: 'living',
  [RoomType.KITCHEN]: 'kitchen',
  [RoomType.BATHROOM]: 'bathroom',
  [RoomType.STORAGE]: 'storage',
  [RoomType.MEDICAL]: 'medical',
  [RoomType.COMMON]: 'common',
  [RoomType.PRODUCTION]: 'production',
  [RoomType.CORRIDOR]: 'corridor',
  [RoomType.SMOKING]: 'smoking',
  [RoomType.OFFICE]: 'office',
  [RoomType.HQ]: 'hq',
  [RoomType.CLASSROOM]: 'classroom',
};

const FACTION_TAGS: Record<Faction, string> = {
  [Faction.CITIZEN]: 'citizen',
  [Faction.LIQUIDATOR]: 'liquidator',
  [Faction.CULTIST]: 'cultist',
  [Faction.SCIENTIST]: 'scientist',
  [Faction.WILD]: 'wild',
  [Faction.PLAYER]: 'player',
};

const ZONE_FACTION_TAGS: Record<ZoneFaction, string> = {
  [ZoneFaction.CITIZEN]: 'citizen',
  [ZoneFaction.LIQUIDATOR]: 'liquidator',
  [ZoneFaction.CULTIST]: 'cultist',
  [ZoneFaction.SAMOSBOR]: 'samosbor',
  [ZoneFaction.WILD]: 'wild',
  [ZoneFaction.SCIENTIST]: 'scientist',
};

const QUEST_TYPE_TAGS: Record<QuestType, string> = {
  [QuestType.FETCH]: 'fetch',
  [QuestType.VISIT]: 'visit',
  [QuestType.KILL]: 'kill',
  [QuestType.TALK]: 'talk',
};

const DANGER_RANK: Record<MarkovDangerBand, number> = {
  quiet: 0,
  uneasy: 1,
  threat: 2,
  combat: 3,
  panic: 4,
};

const COMBAT_EVENT_TYPES = new Set([
  'npc_kill_monster',
  'npc_kill_npc',
  'player_kill_monster',
  'player_kill_npc',
  'player_hurt_npc',
  'monster_sighted',
  'death_seen',
]);

export function lowerContextSnapshot(
  snapshot: ContextSnapshot,
  options: MarkovContextLoweringOptions = {},
): MarkovTextContext {
  const tags = new MarkovTagBuilder(options.extraTags);
  const roomTag = snapshot.roomType === undefined ? undefined : ROOM_TAGS[snapshot.roomType];
  if (roomTag) tags.add(`room.${roomTag}`);
  if (snapshot.nearbyContainer) tags.add('context.container.nearby');
  if (snapshot.nearbyProduction) tags.add('context.production.nearby');
  for (const rumorId of snapshot.nearbyScreenRumorIds) tags.addId('rumor', rumorId);

  const faction = snapshot.npcFaction;
  if (faction !== undefined) tags.add(`faction.${FACTION_TAGS[faction]}`);
  if (snapshot.zoneFaction !== undefined) {
    const zoneTag = ZONE_FACTION_TAGS[snapshot.zoneFaction];
    tags.add(`zone_faction.${zoneTag}`);
    tags.add(`territory.${zoneTag}`);
  }

  const relationBand = options.relationBand ?? relationBandForScore(options.relationToPlayer);
  if (relationBand) tags.add(`relation.${relationBand}`);

  const needBand = addNeedTags(tags, snapshot);
  let dangerBand = dangerBandFromSnapshot(snapshot);
  if (snapshot.hasRecentFactionClash || snapshot.hasRoomMemoryCombat || snapshot.hasRecentMonsterKill) {
    tags.add('danger.combat');
    dangerBand = maxDangerBand(dangerBand, 'combat');
  }
  if (snapshot.hasRecentSamosborWarning) tags.add('danger.samosbor.warning');
  if (snapshot.samosborActive) tags.add('danger.samosbor.active');
  if (snapshot.hasRecentSamosborAftermath) tags.add('event.samosbor_aftermath');
  if (snapshot.hasActiveContract) tags.add('quest.contract');
  if (snapshot.hasRecentPlayerTheft || snapshot.hasRoomMemoryTheft) tags.add('event.theft');
  if (snapshot.hasRecentMetroEvent) tags.add('event.metro');
  if (snapshot.hasRecentLiftAnomaly) tags.add('event.lift_anomaly');
  if (snapshot.hasRecentFactionClash) tags.add('event.faction_clash');
  if (snapshot.hasRecentMonsterKill) tags.add('event.monster_kill');
  if (snapshot.hasRecentContainerOpen) tags.add('event.container_open');
  if (snapshot.hasRoomMemoryHelp) tags.add('event.room_help');
  if (snapshot.hasRoomMemoryInform) tags.add('event.room_inform');
  if (snapshot.hasRoomMemoryRepair) tags.add('event.room_repair');
  if (snapshot.hasRoomMemorySamosbor) tags.add('event.room_samosbor');
  if (snapshot.hasRecentProductionOutput) tags.add('event.production_output');
  if (snapshot.hasRecentProductionShortage) tags.add('event.production_shortage');

  return finalizeMarkovContext({
    actorId: options.actorId,
    actorAlifeId: options.actorAlifeId,
    targetId: options.targetId,
    targetAlifeId: options.targetAlifeId,
    floorKey: options.floorKey,
    floor: snapshot.floor ?? options.floor,
    routeZBand: options.routeZBand ?? routeZBandForZ(options.routeZ),
    roomId: options.roomId,
    roomType: snapshot.roomType,
    roomName: snapshot.roomName,
    zoneId: snapshot.zoneId,
    zoneFaction: snapshot.zoneFaction,
    faction,
    occupation: snapshot.npcOccupation,
    relationBand,
    socialEdgeFlags: options.socialEdgeFlags,
    needBand,
    dangerBand,
    wealthBand: options.wealthBand ?? wealthBandForValue(options.wealth),
    timeBand: options.timeBand ?? timeBandForMinutes(options.timeMinutes),
    tags: tags.values(),
  });
}

export function lowerWorldEventContext(
  event: WorldEvent,
  options: MarkovContextLoweringOptions = {},
): MarkovTextContext {
  const tags = new MarkovTagBuilder(options.extraTags);
  tags.add(`event.${event.type}`);
  for (const tag of event.tags) tags.add(`event.${tag}`);
  addEventSemanticTags(tags, event);

  if (event.actorFaction !== undefined) tags.add(`faction.${FACTION_TAGS[event.actorFaction]}`);
  if (event.targetFaction !== undefined) tags.add(`target_faction.${FACTION_TAGS[event.targetFaction]}`);
  if (event.itemId) tags.addId('item', event.itemId);
  if (event.monsterKind !== undefined) tags.add(`monster.${event.monsterKind}`);

  const relationBand = options.relationBand ?? relationBandForScore(options.relationToPlayer);
  if (relationBand) tags.add(`relation.${relationBand}`);

  return finalizeMarkovContext({
    actorId: options.actorId ?? event.actorId,
    actorAlifeId: options.actorAlifeId,
    targetId: options.targetId ?? event.targetId,
    targetAlifeId: options.targetAlifeId,
    floorKey: options.floorKey,
    floor: event.floor ?? options.floor,
    routeZBand: options.routeZBand ?? routeZBandForZ(options.routeZ),
    roomId: event.roomId ?? options.roomId,
    zoneId: event.zoneId,
    faction: event.actorFaction ?? event.targetFaction,
    relationBand,
    socialEdgeFlags: options.socialEdgeFlags,
    dangerBand: dangerBandFromEvent(event),
    wealthBand: options.wealthBand ?? wealthBandForValue(options.wealth),
    timeBand: options.timeBand ?? timeBandForMinutes(options.timeMinutes),
    itemId: event.itemId,
    itemName: event.itemName,
    monsterKind: event.monsterKind,
    eventType: event.type,
    eventId: event.id,
    tags: tags.values(),
  });
}

export function lowerQuestContext(
  quest: Quest,
  options: MarkovContextLoweringOptions = {},
): MarkovTextContext {
  const tags = new MarkovTagBuilder(options.extraTags);
  addQuestTags(tags, quest.type);
  if (quest.contractId) tags.add('quest.contract').addId('contract', quest.contractId);
  if (quest.sideQuestId) tags.add('quest.side').addId('quest.side', quest.sideQuestId);
  if (quest.plotStepIndex !== undefined) tags.add('quest.plot');
  if (quest.done) tags.add('quest.done');
  if (quest.failed) tags.add('quest.failed');
  if (quest.targetItem) tags.addId('item', quest.targetItem);
  if (quest.targetMonsterKind !== undefined) tags.add(`monster.${quest.targetMonsterKind}`);
  addRouteTags(tags, quest.targetRoute ?? quest.targetMarker);

  const relationBand = options.relationBand ?? relationBandForScore(options.relationToPlayer);
  if (relationBand) tags.add(`relation.${relationBand}`);

  const routeZ = quest.targetRoute?.z ?? quest.targetMarker?.routeZ ?? options.routeZ;
  const risk = quest.targetRoute?.risk ?? quest.targetMarker?.risk ?? quest.difficulty;

  return finalizeMarkovContext({
    actorId: options.actorId ?? quest.giverId,
    actorAlifeId: options.actorAlifeId,
    targetId: options.targetId ?? quest.targetNpcId,
    targetAlifeId: options.targetAlifeId,
    floorKey: options.floorKey,
    floor: quest.targetFloor ?? quest.targetMarker?.floor ?? quest.visitFloor ?? options.floor,
    routeZBand: options.routeZBand ?? routeZBandForZ(routeZ),
    roomId: options.roomId ?? quest.targetRoom,
    roomType: quest.targetRoomType ?? quest.targetMarker?.roomType,
    roomName: quest.targetRoomName ?? quest.targetMarker?.roomName,
    zoneId: undefined,
    faction: quest.contractFaction,
    relationBand,
    socialEdgeFlags: options.socialEdgeFlags,
    dangerBand: dangerBandForRisk(risk),
    wealthBand: options.wealthBand ?? wealthBandForValue(options.wealth ?? quest.moneyReward),
    timeBand: options.timeBand ?? timeBandForMinutes(options.timeMinutes),
    itemId: quest.targetItem,
    monsterKind: quest.targetMonsterKind,
    questId: quest.id,
    questType: quest.type,
    contractId: quest.contractId,
    tags: tags.values(),
  });
}

export function lowerContractContext(
  contract: ContractDef,
  options: MarkovContextLoweringOptions = {},
): MarkovTextContext {
  const tags = new MarkovTagBuilder(options.extraTags);
  addQuestTags(tags, contract.type);
  tags.add('quest.contract').addId('contract', contract.id);
  tags.add(`faction.${FACTION_TAGS[contract.faction]}`);
  for (const tag of contract.tags) tags.add(`quest.${tag}`);
  if (contract.targetItem) tags.addId('item', contract.targetItem);
  if (contract.targetMonsterKind !== undefined) tags.add(`monster.${contract.targetMonsterKind}`);
  addRouteTags(tags, contract.target.route);

  const relationBand = options.relationBand ?? relationBandForScore(options.relationToPlayer);
  if (relationBand) tags.add(`relation.${relationBand}`);

  return finalizeMarkovContext({
    actorId: options.actorId,
    actorAlifeId: options.actorAlifeId,
    targetId: options.targetId,
    targetAlifeId: options.targetAlifeId,
    floorKey: options.floorKey,
    floor: contract.target.floor ?? options.floor,
    routeZBand: options.routeZBand ?? routeZBandForZ(contract.target.route?.z ?? options.routeZ),
    roomType: contract.target.roomType,
    roomName: contract.target.roomName,
    faction: contract.faction,
    relationBand,
    socialEdgeFlags: options.socialEdgeFlags,
    dangerBand: dangerBandForRisk(contract.target.route?.risk ?? contract.rank),
    wealthBand: options.wealthBand ?? wealthBandForValue(options.wealth ?? contract.moneyReward),
    timeBand: options.timeBand ?? timeBandForMinutes(options.timeMinutes),
    itemId: contract.targetItem,
    monsterKind: contract.targetMonsterKind,
    questType: contract.type,
    contractId: contract.id,
    tags: tags.values(),
  });
}

export function lowerDemosCandidateContext(candidate: MarkovDemosCandidate): MarkovTextContext {
  const base = candidate.event ? lowerWorldEventContext(candidate.event, candidate) : undefined;
  const tags = new MarkovTagBuilder(base?.tags);
  tags.add('demos.candidate');
  for (const tag of candidate.tags ?? []) tags.add(tag);
  if (candidate.faction !== undefined) tags.add(`faction.${FACTION_TAGS[candidate.faction]}`);
  if (candidate.zoneFaction !== undefined) tags.add(`zone_faction.${ZONE_FACTION_TAGS[candidate.zoneFaction]}`);
  if (candidate.itemId) tags.addId('item', candidate.itemId);
  if (candidate.monsterKind !== undefined) tags.add(`monster.${candidate.monsterKind}`);

  const relationBand = candidate.relationBand ?? relationBandForScore(candidate.relationToPlayer) ?? base?.relationBand;
  if (relationBand) tags.add(`relation.${relationBand}`);

  return finalizeMarkovContext({
    ...base,
    actorId: candidate.actorId ?? base?.actorId,
    actorAlifeId: candidate.actorAlifeId ?? base?.actorAlifeId,
    targetId: candidate.targetId ?? base?.targetId,
    targetAlifeId: candidate.targetAlifeId ?? base?.targetAlifeId,
    floorKey: candidate.floorKey ?? base?.floorKey,
    floor: candidate.floor ?? base?.floor,
    routeZBand: candidate.routeZBand ?? routeZBandForZ(candidate.routeZ) ?? base?.routeZBand,
    zoneId: candidate.zoneId ?? base?.zoneId,
    zoneFaction: candidate.zoneFaction ?? base?.zoneFaction,
    faction: candidate.faction ?? base?.faction,
    relationBand,
    socialEdgeFlags: candidate.socialEdgeFlags ?? base?.socialEdgeFlags,
    wealthBand: candidate.wealthBand ?? wealthBandForValue(candidate.wealth) ?? base?.wealthBand,
    timeBand: candidate.timeBand ?? timeBandForMinutes(candidate.timeMinutes) ?? base?.timeBand,
    itemId: candidate.itemId ?? base?.itemId,
    itemName: candidate.itemName ?? base?.itemName,
    monsterKind: candidate.monsterKind ?? base?.monsterKind,
    eventType: candidate.eventType ?? base?.eventType,
    eventId: candidate.eventId ?? base?.eventId,
    tags: tags.values(),
  });
}

export function finalizeMarkovContext(input: Partial<MarkovTextContext> & { tags?: readonly string[] }): MarkovTextContext {
  const tags = new MarkovTagBuilder(input.tags).values();
  const context: Omit<MarkovTextContext, 'contextHash'> = {
    actorId: finiteInt(input.actorId),
    actorAlifeId: finiteInt(input.actorAlifeId),
    targetId: finiteInt(input.targetId),
    targetAlifeId: finiteInt(input.targetAlifeId),
    floorKey: cleanId(input.floorKey),
    floor: input.floor,
    routeZBand: input.routeZBand,
    roomId: finiteInt(input.roomId),
    roomType: input.roomType,
    roomName: cleanText(input.roomName, 96),
    zoneId: finiteInt(input.zoneId),
    zoneFaction: input.zoneFaction,
    faction: input.faction,
    occupation: finiteInt(input.occupation),
    relationBand: input.relationBand,
    socialEdgeFlags: finiteInt(input.socialEdgeFlags),
    needBand: input.needBand,
    dangerBand: input.dangerBand,
    wealthBand: input.wealthBand,
    timeBand: input.timeBand,
    itemId: cleanId(input.itemId),
    itemName: cleanText(input.itemName, 96),
    monsterKind: finiteInt(input.monsterKind),
    eventType: cleanId(input.eventType),
    eventId: finiteInt(input.eventId),
    questId: finiteInt(input.questId),
    questType: input.questType,
    contractId: cleanId(input.contractId),
    tags,
  };
  return {
    ...context,
    contextHash: buildMarkovContextHash(context),
  };
}

export function buildMarkovContextHash(context: Omit<MarkovTextContext, 'contextHash'> | MarkovTextContext): string {
  const parts: string[] = [];
  addHashPart(parts, 'actorId', context.actorId);
  addHashPart(parts, 'actorAlifeId', context.actorAlifeId);
  addHashPart(parts, 'targetId', context.targetId);
  addHashPart(parts, 'targetAlifeId', context.targetAlifeId);
  addHashPart(parts, 'floorKey', context.floorKey);
  addHashPart(parts, 'floor', context.floor);
  addHashPart(parts, 'routeZBand', context.routeZBand);
  addHashPart(parts, 'roomId', context.roomId);
  addHashPart(parts, 'roomType', context.roomType);
  addHashPart(parts, 'zoneId', context.zoneId);
  addHashPart(parts, 'zoneFaction', context.zoneFaction);
  addHashPart(parts, 'faction', context.faction);
  addHashPart(parts, 'occupation', context.occupation);
  addHashPart(parts, 'relationBand', context.relationBand);
  addHashPart(parts, 'socialEdgeFlags', context.socialEdgeFlags);
  addHashPart(parts, 'needBand', context.needBand);
  addHashPart(parts, 'dangerBand', context.dangerBand);
  addHashPart(parts, 'wealthBand', context.wealthBand);
  addHashPart(parts, 'timeBand', context.timeBand);
  addHashPart(parts, 'itemId', context.itemId);
  addHashPart(parts, 'monsterKind', context.monsterKind);
  addHashPart(parts, 'eventType', context.eventType);
  addHashPart(parts, 'eventId', context.eventId);
  addHashPart(parts, 'questId', context.questId);
  addHashPart(parts, 'questType', context.questType);
  addHashPart(parts, 'contractId', context.contractId);
  for (const tag of [...context.tags].sort()) parts.push(`tag=${tag}`);
  return fnv1a(parts.join('|'));
}

export function relationBandForScore(value: number | undefined): MarkovRelationBand | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (value <= HOSTILE_RELATION_THRESHOLD) return 'hostile';
  if (value < -10) return 'cold';
  if (value < 25) return 'neutral';
  if (value < FRIENDLY_RELATION_THRESHOLD) return 'warm';
  return 'friend';
}

export function routeZBandForZ(z: number | undefined): MarkovRouteZBand | undefined {
  if (z === undefined || !Number.isFinite(z)) return undefined;
  const n = Math.trunc(z);
  if (Math.abs(n) >= 35) return 'deep';
  if (n > 5) return 'upper';
  if (n < -5) return 'lower';
  return 'center';
}

export function wealthBandForValue(value: number | undefined): MarkovWealthBand | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (value < 10) return 'broke';
  if (value < 100) return 'small';
  if (value < 500) return 'payday';
  return 'fat';
}

export function timeBandForMinutes(totalMinutes: number | undefined): MarkovTimeBand | undefined {
  if (totalMinutes === undefined || !Number.isFinite(totalMinutes)) return undefined;
  const minute = positiveMod(Math.trunc(totalMinutes), 1440);
  const hour = Math.floor(minute / 60);
  if (hour < 6) return 'night';
  if (hour < 10) return 'morning';
  if (hour < 18) return 'work';
  if (hour < 22) return 'evening';
  return 'late';
}

export const markovContextFromSnapshot = lowerContextSnapshot;
export const markovContextFromWorldEvent = lowerWorldEventContext;
export const markovContextFromQuest = lowerQuestContext;
export const markovContextFromContract = lowerContractContext;
export const markovContextFromDemosCandidate = lowerDemosCandidateContext;

function addNeedTags(tags: MarkovTagBuilder, snapshot: ContextSnapshot): MarkovNeedBand {
  let band: MarkovNeedBand = 'ok';
  const needs = snapshot.npcNeeds;
  if (needs) {
    band = maxNeedBand(band, addLowNeedTag(tags, 'food', needs.food));
    band = maxNeedBand(band, addLowNeedTag(tags, 'water', needs.water));
    band = maxNeedBand(band, addLowNeedTag(tags, 'sleep', needs.sleep));
    band = maxNeedBand(band, addHighNeedTag(tags, 'pee', needs.pee));
    band = maxNeedBand(band, addHighNeedTag(tags, 'poo', needs.poo));
  } else {
    if (snapshot.isHungry) band = maxNeedBand(band, tagNeed(tags, 'food', 'low'));
    if (snapshot.isThirsty) band = maxNeedBand(band, tagNeed(tags, 'water', 'low'));
    if (snapshot.isTired) band = maxNeedBand(band, tagNeed(tags, 'sleep', 'low'));
  }
  const hpRatio = snapshot.npcHpRatio;
  if (snapshot.isCritical || (hpRatio !== undefined && hpRatio < 0.25)) {
    band = maxNeedBand(band, tagNeed(tags, 'wound', 'urgent'));
    tags.add('health.critical');
  } else if (snapshot.isWounded || (hpRatio !== undefined && hpRatio < 0.5)) {
    band = maxNeedBand(band, tagNeed(tags, 'wound', 'low'));
    tags.add('health.wounded');
  }
  return band;
}

function addLowNeedTag(tags: MarkovTagBuilder, id: string, value: number): MarkovNeedBand {
  if (!Number.isFinite(value)) return 'ok';
  if (value <= 10) return tagNeed(tags, id, 'urgent');
  if (value < 30) return tagNeed(tags, id, 'low');
  return 'ok';
}

function addHighNeedTag(tags: MarkovTagBuilder, id: string, value: number): MarkovNeedBand {
  if (!Number.isFinite(value)) return 'ok';
  if (value >= 90) return tagNeed(tags, id, 'urgent');
  if (value >= 70) return tagNeed(tags, id, 'low');
  return 'ok';
}

function tagNeed(tags: MarkovTagBuilder, id: string, band: MarkovNeedBand): MarkovNeedBand {
  tags.add(`need.${id}.${band}`);
  return band;
}

function maxNeedBand(a: MarkovNeedBand, b: MarkovNeedBand): MarkovNeedBand {
  if (a === 'urgent' || b === 'urgent') return 'urgent';
  if (a === 'low' || b === 'low') return 'low';
  return 'ok';
}

function dangerBandFromSnapshot(snapshot: ContextSnapshot): MarkovDangerBand {
  let band: MarkovDangerBand = 'quiet';
  if (snapshot.isDangerousZone) band = maxDangerBand(band, 'uneasy');
  if (snapshot.hasRecentSamosborWarning || snapshot.hasRoomMemorySamosbor) band = maxDangerBand(band, 'threat');
  if (snapshot.hasRecentFactionClash || snapshot.hasRecentMonsterKill || snapshot.hasRoomMemoryCombat) band = maxDangerBand(band, 'combat');
  if (snapshot.samosborActive || snapshot.isCritical) band = maxDangerBand(band, 'panic');
  return band;
}

function dangerBandFromEvent(event: WorldEvent): MarkovDangerBand {
  let band: MarkovDangerBand = event.severity >= 3 ? 'uneasy' : 'quiet';
  if (event.type === 'samosbor_warning' || event.tags.includes('samosbor')) band = maxDangerBand(band, 'threat');
  if (COMBAT_EVENT_TYPES.has(event.type) || event.tags.includes('combat') || event.tags.includes('kill')) {
    band = maxDangerBand(band, 'combat');
  }
  if (event.type === 'samosbor_started' || event.severity >= 5) band = maxDangerBand(band, 'panic');
  return band;
}

function dangerBandForRisk(risk: number | undefined): MarkovDangerBand | undefined {
  if (risk === undefined || !Number.isFinite(risk)) return undefined;
  if (risk >= 5) return 'panic';
  if (risk >= 4) return 'threat';
  if (risk >= 2) return 'uneasy';
  return 'quiet';
}

function maxDangerBand(a: MarkovDangerBand, b: MarkovDangerBand): MarkovDangerBand {
  return DANGER_RANK[b] > DANGER_RANK[a] ? b : a;
}

function addEventSemanticTags(tags: MarkovTagBuilder, event: WorldEvent): void {
  if (event.type === 'samosbor_warning') tags.add('danger.samosbor.warning');
  if (event.type === 'samosbor_started') tags.add('danger.samosbor.active');
  if (event.type === 'samosbor_ended') tags.add('event.samosbor_aftermath');
  if (COMBAT_EVENT_TYPES.has(event.type)) tags.add('danger.combat');
  if (event.type === 'contract_created' || event.type === 'contract_completed' || event.type === 'contract_failed') {
    tags.add('quest.contract');
  }
  if (event.type === 'quest_created' || event.type === 'quest_completed' || event.type === 'quest_failed') {
    tags.add('quest.event');
  }
  if (event.type === 'room_lacked_resources' || event.type === 'room_blocked_production') tags.add('event.production_shortage');
  if (event.type === 'room_produced_items') tags.add('event.production_output');
  if (event.type === 'item_stolen' || event.tags.includes('theft')) tags.add('event.theft');
  if (event.type === 'faction_event' || event.type === 'faction_patrol_clash' || event.type === 'faction_relation_changed') {
    tags.add('event.faction_clash');
  }
}

function addQuestTags(tags: MarkovTagBuilder, type: QuestType): void {
  const questTag = QUEST_TYPE_TAGS[type];
  tags.add('quest.active');
  if (questTag) tags.add(`quest.${questTag}`);
}

function addRouteTags(tags: MarkovTagBuilder, route: QuestRouteTarget | Quest['targetMarker'] | undefined): void {
  if (!route) return;
  if ('designFloorId' in route && route.designFloorId) tags.addId('route.design', route.designFloorId);
  if ('proceduralTag' in route && route.proceduralTag) tags.addId('route.procedural', route.proceduralTag);
  if ('anomalyId' in route && route.anomalyId) tags.addId('route.anomaly', route.anomalyId);
  if ('tags' in route && route.tags) for (const tag of route.tags) tags.add(`route.${tag}`);
  const z = 'z' in route ? route.z : 'routeZ' in route ? route.routeZ : undefined;
  const zBand = routeZBandForZ(z);
  if (zBand) tags.add(`route.${zBand}`);
}

function addHashPart(parts: string[], key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  parts.push(`${key}=${String(value)}`);
}

function cleanText(value: string | undefined, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, maxLen) : undefined;
}

function cleanId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = cleanTagText(value);
  return id.length > 0 ? id.slice(0, 96) : undefined;
}

function finiteInt(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.trunc(value);
}

function positiveMod(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanTagText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

class MarkovTagBuilder {
  private readonly tags: string[] = [];

  constructor(seed: readonly string[] = []) {
    for (const tag of seed) this.add(tag);
  }

  add(raw: string | undefined): this {
    if (!raw) return this;
    const tag = cleanTagText(raw);
    if (tag.length > 0 && !this.tags.includes(tag)) this.tags.push(tag);
    return this;
  }

  addId(prefix: string, id: string | undefined): this {
    const clean = cleanId(id);
    if (clean) this.add(`${prefix}.${clean}`);
    return this;
  }

  values(): readonly string[] {
    return [...this.tags].sort();
  }
}
