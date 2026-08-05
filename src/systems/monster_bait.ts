/* ── Bounded food/govnyak bait markers for small monsters ─────── */

import {
  EntityType,
  ItemType,
  type Entity,
  type FloorLevel,
  type GameState,
  type ItemDef,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS, ITEM_TAGS } from '../data/items';
import { isBaitAttractedMonster, monsterEcologyTags } from '../data/monster_ecology';
import { isDocumentScentItem } from './document_scent';
import { publishEvent } from './events';
import { activeFloorInstanceWorldKey } from './floor_instances';
import { currentFloorRunEntry, floorRunEntryFloorKey } from './procedural_floors';

export type MonsterBaitKind = 'food' | 'meat' | 'fungal' | 'govnyak' | 'document';
export type MonsterBaitSource = 'drop' | 'use';

export interface MonsterBaitMarker {
  id: number;
  x: number;
  y: number;
  floor: FloorLevel;
  floorKey?: string;
  itemId: string;
  itemName: string;
  itemCount: number;
  itemValue: number;
  kind: MonsterBaitKind;
  baitTags: string[];
  strength: number;
  risk: number;
  source: MonsterBaitSource;
  placedById?: number;
  entityId?: number;
  zoneId?: number;
  roomId?: number;
  radius: number;
  expiresAt: number;
  attractedCount: number;
  maxAttractions: number;
}

export interface MonsterBaitPreview {
  kind: MonsterBaitKind;
  itemName: string;
  baitTags: readonly string[];
  strength: number;
  risk: number;
  radius: number;
  ttlSeconds: number;
  maxAttractions: number;
  activeCap: number;
  markerLabel: string;
}

export const MONSTER_BAIT_MAX_ACTIVE = 8;
export const MONSTER_BAIT_MAX_CANDIDATES = 8;
export const MONSTER_BAIT_RADIUS_CAP = 22;
export const MONSTER_BAIT_TTL_CAP = 42;
export const MONSTER_BAIT_MAX_ATTRACTIONS_CAP = 6;
export const MONSTER_BAIT_CONSUME_RADIUS = 1.15;
export const MONSTER_BAIT_CONSUME_RADIUS_SQ = MONSTER_BAIT_CONSUME_RADIUS * MONSTER_BAIT_CONSUME_RADIUS;
export const MONSTER_BAIT_COMBAT_LOCK_RADIUS = 5;
export const MONSTER_BAIT_COMBAT_LOCK_SQ = MONSTER_BAIT_COMBAT_LOCK_RADIUS * MONSTER_BAIT_COMBAT_LOCK_RADIUS;

const GOVNYAK_BAIT_ITEM_IDS = new Set(['govnyak_roll', 'govnyak_brick', 'govnyak_sample', 'govnyak_bad_batch']);
const BAIT_TRAITS_BY_ECOLOGY_TAG: Record<string, readonly string[]> = {
  monster_krysnozhka: ['bait_meat', 'bait_fungal', 'bait_stale', 'bait_govnyak', 'govnyak'],
  monster_pomoyny_roy: ['bait_food', 'bait_meat', 'bait_fungal', 'bait_stale', 'bait_govnyak', 'govnyak'],
  monster_swarm: ['bait_meat', 'bait_fungal', 'bait_stale', 'bait_govnyak', 'govnyak'],
  monster_sborka: ['bait_starch', 'bait_sugar', 'bait_stale', 'bait_govnyak', 'govnyak'],
  monster_tvar: ['bait_meat', 'bait_govnyak', 'govnyak'],
  monster_zhornaya_tvar: ['bait_meat', 'bait_food', 'bait_stale', 'bait_risky', 'bait_govnyak', 'govnyak'],
  monster_polzun: ['bait_fungal', 'bait_wet', 'bait_govnyak', 'govnyak'],
  monster_tube_eel: ['bait_meat', 'bait_wet', 'bait_fungal', 'bait_govnyak', 'govnyak'],
  monster_olgoy: ['bait_meat', 'bait_wet', 'bait_risky', 'bait_govnyak', 'govnyak'],
  monster_pechateed: ['bait_document', 'document', 'paper', 'forms', 'permit', 'stamp'],
  monster_kontorshchik: ['bait_document', 'document', 'paper', 'forms', 'permit', 'stamp'],
  monster_protokolnik: ['bait_document', 'document', 'paper', 'official', 'permit', 'protocol'],
};
const activeBaits: MonsterBaitMarker[] = [];
let nextBaitId = 1;

export function resetMonsterBaits(): void {
  activeBaits.length = 0;
  nextBaitId = 1;
}

export function getActiveMonsterBaits(): readonly MonsterBaitMarker[] {
  return activeBaits;
}

function monsterBaitFloorKey(state: GameState | undefined): string | undefined {
  if (!state) return undefined;
  return activeFloorInstanceWorldKey(state) ?? floorRunEntryFloorKey(currentFloorRunEntry(state));
}

export function baitKindForItem(defId: string, source: MonsterBaitSource): MonsterBaitKind | null {
  const def = ITEMS[defId];
  if (!def) return null;
  const tags = baitItemTags(defId, def);
  if (GOVNYAK_BAIT_ITEM_IDS.has(defId) || tags.includes('govnyak')) return 'govnyak';
  if (source === 'drop' && isDocumentScentItem(defId, def)) return 'document';
  if (source !== 'drop' || def.type !== ItemType.FOOD) return null;
  if (tags.includes('bait_meat')) return 'meat';
  if (tags.includes('bait_fungal')) return 'fungal';
  return 'food';
}

export function isMonsterBaitItem(defId: string): boolean {
  return baitKindForItem(defId, 'drop') !== null;
}

export function isMonsterBaitUseItem(defId: string): boolean {
  return baitKindForItem(defId, 'use') !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function addUnique(tags: string[], tag: string): void {
  if (tag.length > 0 && !tags.includes(tag)) tags.push(tag);
}

function baitItemTags(defId: string, def: ItemDef): string[] {
  const tags: string[] = [];
  for (const tag of ITEM_TAGS[defId] ?? []) addUnique(tags, tag);
  for (const tag of def.tags ?? []) addUnique(tags, tag);
  if (def.type === ItemType.FOOD) addUnique(tags, 'bait_food');
  if (isDocumentScentItem(defId, def)) addUnique(tags, 'bait_document');
  return tags;
}

function baitCostTier(def: ItemDef, count: number): number {
  const totalValue = Math.max(0, def.value) * Math.max(1, Math.min(4, count));
  if (totalValue >= 40) return 3;
  if (totalValue >= 14) return 2;
  if (totalValue >= 6) return 1;
  return 0;
}

function baitRisk(kind: MonsterBaitKind, tags: readonly string[]): number {
  let risk = kind === 'govnyak' ? 1 : 0;
  if (kind === 'document' && (tags.includes('official') || tags.includes('permit') || tags.includes('warrant') || tags.includes('audit'))) risk += 1;
  if (tags.includes('bait_risky') || tags.includes('bad_batch')) risk += 2;
  if (tags.includes('contaminant') || tags.includes('contraband')) risk = Math.max(risk, 1);
  return Math.min(3, risk);
}

function baitProfileForItem(defId: string, source: MonsterBaitSource, count: number): Pick<MonsterBaitMarker, 'kind' | 'itemValue' | 'baitTags' | 'strength' | 'risk' | 'radius' | 'expiresAt' | 'maxAttractions'> | null {
  const def = ITEMS[defId];
  if (!def || count <= 0) return null;
  const kind = baitKindForItem(defId, source);
  if (!kind) return null;

  const costTier = baitCostTier(def, count);
  const baitTags = baitItemTags(defId, def);
  const risk = baitRisk(kind, baitTags);
  const baseRadius = kind === 'document' ? 16 : kind === 'govnyak' ? 15 : kind === 'meat' ? 16 : kind === 'fungal' ? 14 : 11;
  const baseTtl = kind === 'document' ? 24 : kind === 'govnyak' ? 24 : 18;
  const radius = clamp(baseRadius + costTier * 2 + Math.min(risk, 2) * 2, 8, MONSTER_BAIT_RADIUS_CAP);
  const ttl = clamp(baseTtl + costTier * 5 + risk * 3, 12, MONSTER_BAIT_TTL_CAP);
  const maxAttractions = clamp(
    (kind === 'govnyak' ? 2 : 1) + costTier + Math.min(2, count) + (risk >= 2 ? 1 : 0),
    1,
    MONSTER_BAIT_MAX_ATTRACTIONS_CAP,
  );

  return {
    kind,
    itemValue: def.value,
    baitTags,
    strength: 1 + costTier * 0.12 + risk * 0.08 + (kind === 'govnyak' ? 0.1 : 0),
    risk,
    radius,
    expiresAt: ttl,
    maxAttractions,
  };
}

function baitKindLabel(kind: MonsterBaitKind): string {
  if (kind === 'document') return 'бумага';
  if (kind === 'govnyak') return 'говняк';
  if (kind === 'meat') return 'мясо';
  if (kind === 'fungal') return 'гриб';
  return 'еда';
}

function baitMarkerLabel(
  kind: MonsterBaitKind,
  radius: number,
  ttlSeconds: number,
  maxAttractions: number,
  risk: number,
): string {
  return `приманка:${baitKindLabel(kind)} ${Math.round(radius)}кл/${Math.ceil(ttlSeconds)}с до ${maxAttractions}, риск ${risk}/3`;
}

export function monsterBaitPreviewForItem(defId: string, source: MonsterBaitSource, count: number): MonsterBaitPreview | null {
  const def = ITEMS[defId];
  const profile = baitProfileForItem(defId, source, count);
  if (!def || !profile) return null;
  return {
    kind: profile.kind,
    itemName: def.name,
    baitTags: profile.baitTags,
    strength: profile.strength,
    risk: profile.risk,
    radius: profile.radius,
    ttlSeconds: profile.expiresAt,
    maxAttractions: profile.maxAttractions,
    activeCap: MONSTER_BAIT_MAX_ACTIVE,
    markerLabel: baitMarkerLabel(profile.kind, profile.radius, profile.expiresAt, profile.maxAttractions, profile.risk),
  };
}

function baitScanCooldown(entityId: number): number {
  const h = Math.imul(entityId ^ 0x27D4EB2D, 0x85EBCA6B) >>> 0;
  return 1.1 + ((h & 255) / 255) * 0.45;
}

function markerZone(world: World | undefined, x: number, y: number): { zoneId?: number; roomId?: number } {
  if (!world) return {};
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const roomId = world.roomMap[ci];
  return {
    zoneId: world.zoneMap[ci],
    roomId: roomId >= 0 ? roomId : undefined,
  };
}

function baitEventTags(marker: MonsterBaitMarker, action: string, extraTags: readonly string[] = []): string[] {
  const tags = ['monster', 'bait', 'bait_marker', marker.kind, action];
  if (marker.risk >= 2) addUnique(tags, 'risky_attraction');
  if (marker.baitTags.includes('bait_trap')) addUnique(tags, 'trap_bait');
  for (const tag of extraTags) addUnique(tags, tag);
  return tags;
}

function publishBaitEnd(
  state: GameState | undefined,
  marker: MonsterBaitMarker,
  type: 'monster_bait_consumed' | 'monster_bait_expired',
  time: number,
  reason: string,
  monster?: Entity,
): void {
  if (!state) return;
  const outcome = type === 'monster_bait_consumed'
    ? 'success'
    : marker.attractedCount > 0
      ? 'partial'
      : 'failure';
  publishEvent(state, {
    type,
    time,
    floor: marker.floor,
    zoneId: marker.zoneId,
    roomId: marker.roomId,
    x: marker.x,
    y: marker.y,
    actorId: monster?.id,
    actorName: monster?.name,
    actorFaction: monster?.faction,
    itemId: marker.itemId,
    itemName: marker.itemName,
    itemCount: marker.itemCount,
    itemValue: marker.itemValue,
    monsterKind: monster?.monsterKind,
    severity: type === 'monster_bait_consumed' ? (marker.risk >= 2 ? 3 : 2) : outcome === 'failure' ? 2 : 1,
    privacy: 'local',
    tags: baitEventTags(marker, reason, [outcome]),
    data: {
      baitId: marker.id,
      source: marker.source,
      outcome,
      reason,
      itemValue: marker.itemValue,
      baitTags: marker.baitTags,
      strength: marker.strength,
      risk: marker.risk,
      attractedCount: marker.attractedCount,
      maxAttractions: marker.maxAttractions,
      activeCap: MONSTER_BAIT_MAX_ACTIVE,
      markerLabel: baitMarkerLabel(marker.kind, marker.radius, Math.max(0, marker.expiresAt - time), marker.maxAttractions, marker.risk),
    },
  });
}

function removeBaitAt(index: number, state: GameState | undefined, time: number, reason: string): MonsterBaitMarker {
  const marker = activeBaits.splice(index, 1)[0];
  publishBaitEnd(state, marker, 'monster_bait_expired', time, reason);
  return marker;
}

export function expireMonsterBaits(state: GameState | undefined, time: number): void {
  const floor = state?.currentFloor;
  const floorKey = monsterBaitFloorKey(state);
  for (let i = activeBaits.length - 1; i >= 0; i--) {
    const marker = activeBaits[i];
    if (marker.expiresAt <= time) {
      removeBaitAt(i, state, time, 'timeout');
    } else if (floor !== undefined && (marker.floor !== floor || (floorKey !== undefined && marker.floorKey !== floorKey))) {
      removeBaitAt(i, state, time, 'floor_changed');
    }
  }
}

export function placeMonsterBait(
  state: GameState | undefined,
  world: World | undefined,
  actor: Entity,
  x: number,
  y: number,
  defId: string,
  count: number,
  source: MonsterBaitSource,
  entityId?: number,
): boolean {
  const def = ITEMS[defId];
  const profile = baitProfileForItem(defId, source, count);
  if (!state || !def || !profile) return false;

  if (activeBaits.length >= MONSTER_BAIT_MAX_ACTIVE) {
    let oldest = 0;
    for (let i = 1; i < activeBaits.length; i++) {
      if (activeBaits[i].expiresAt < activeBaits[oldest].expiresAt) oldest = i;
    }
    removeBaitAt(oldest, state, state.time, 'cap');
  }

  const bx = world ? world.wrap(x) : x;
  const by = world ? world.wrap(y) : y;
  const marker: MonsterBaitMarker = {
    id: nextBaitId++,
    x: bx,
    y: by,
    floor: state.currentFloor,
    floorKey: monsterBaitFloorKey(state),
    itemId: defId,
    itemName: def.name,
    itemCount: count,
    itemValue: profile.itemValue,
    kind: profile.kind,
    baitTags: profile.baitTags,
    strength: profile.strength,
    risk: profile.risk,
    source,
    placedById: actor.id,
    entityId,
    ...markerZone(world, bx, by),
    radius: profile.radius,
    expiresAt: state.time + profile.expiresAt,
    attractedCount: 0,
    maxAttractions: profile.maxAttractions,
  };
  activeBaits.push(marker);

  publishEvent(state, {
    type: 'monster_bait_placed',
    x: marker.x,
    y: marker.y,
    zoneId: marker.zoneId,
    roomId: marker.roomId,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    itemId: marker.itemId,
    itemName: marker.itemName,
    itemCount: marker.itemCount,
    itemValue: marker.itemValue,
    severity: marker.risk >= 2 ? 3 : marker.kind === 'govnyak' ? 3 : 2,
    privacy: 'local',
    tags: baitEventTags(marker, source),
    data: {
      baitId: marker.id,
      source: marker.source,
      itemValue: marker.itemValue,
      baitTags: marker.baitTags,
      strength: marker.strength,
      risk: marker.risk,
      radius: marker.radius,
      expiresAt: marker.expiresAt,
      maxAttractions: marker.maxAttractions,
      activeCount: activeBaits.length,
      activeCap: MONSTER_BAIT_MAX_ACTIVE,
      markerLabel: baitMarkerLabel(marker.kind, marker.radius, Math.max(0, marker.expiresAt - state.time), marker.maxAttractions, marker.risk),
    },
  });
  return true;
}

function baitMatchesFloor(marker: MonsterBaitMarker, floor: FloorLevel, floorKey: string | undefined): boolean {
  return marker.floor === floor && (floorKey === undefined || marker.floorKey === floorKey);
}

function activeBaitById(id: number, floor: FloorLevel, floorKey: string | undefined, time: number): MonsterBaitMarker | null {
  for (const marker of activeBaits) {
    if (marker.id === id && baitMatchesFloor(marker, floor, floorKey) && marker.expiresAt > time) return marker;
  }
  return null;
}

function markerHasTrait(marker: MonsterBaitMarker, trait: string): boolean {
  return marker.baitTags.includes(trait) || (trait === 'bait_govnyak' && marker.kind === 'govnyak');
}

function baitMatchScore(marker: MonsterBaitMarker, ecologyTags: readonly string[]): number {
  let matched = marker.kind === 'govnyak';
  let score = marker.strength;

  for (const ecologyTag of ecologyTags) {
    const traits = BAIT_TRAITS_BY_ECOLOGY_TAG[ecologyTag];
    if (!traits) continue;
    for (const trait of traits) {
      if (!markerHasTrait(marker, trait)) continue;
      matched = true;
      score += 0.35;
      break;
    }
  }

  if (!matched) score *= marker.kind === 'food' ? 0.72 : 0.55;
  if (marker.risk >= 2) score += 0.15;
  return clamp(score, 0.45, 1.55);
}

export function findMonsterBaitTarget(
  world: World,
  monster: Entity,
  dt: number,
  time: number,
  state?: GameState,
  currentFloor?: FloorLevel,
  candidateOk?: (marker: MonsterBaitMarker) => boolean,
): MonsterBaitMarker | null {
  const ai = monster.ai;
  const floor = currentFloor ?? state?.currentFloor;
  const floorKey = monsterBaitFloorKey(state);
  if (!ai || floor === undefined || !isBaitAttractedMonster(monster.monsterKind)) return null;

  const ecologyTags = monsterEcologyTags(monster.monsterKind);
  if (ai.baitMarkerId !== undefined) {
    const cached = activeBaitById(ai.baitMarkerId, floor, floorKey, time);
    if (cached && (!candidateOk || candidateOk(cached))) {
      const cachedScore = baitMatchScore(cached, ecologyTags);
      const cachedRadius = cached.radius * cachedScore;
      if (world.dist2(monster.x, monster.y, cached.x, cached.y) <= cachedRadius * cachedRadius) return cached;
    }
    ai.baitMarkerId = undefined;
  }

  ai.baitScanCd = (ai.baitScanCd ?? 0) - dt;
  if (ai.baitScanCd > 0) return null;
  ai.baitScanCd = baitScanCooldown(monster.id);

  let best: MonsterBaitMarker | null = null;
  let bestScore = 0;
  let bestAdjustedD2 = Infinity;
  let checked = 0;
  for (const marker of activeBaits) {
    if (!baitMatchesFloor(marker, floor, floorKey) || marker.expiresAt <= time) continue;
    if (checked++ >= MONSTER_BAIT_MAX_CANDIDATES) break;
    if (marker.attractedCount >= marker.maxAttractions) continue;
    if (candidateOk && !candidateOk(marker)) continue;
    const matchScore = baitMatchScore(marker, ecologyTags);
    const effectiveRadius = marker.radius * matchScore;
    const d2 = world.dist2(monster.x, monster.y, marker.x, marker.y);
    if (d2 > effectiveRadius * effectiveRadius) continue;
    const adjustedD2 = d2 / (matchScore * matchScore);
    if (adjustedD2 >= bestAdjustedD2) continue;
    best = marker;
    bestScore = matchScore;
    bestAdjustedD2 = adjustedD2;
  }
  if (!best) return null;

  best.attractedCount++;
  ai.baitMarkerId = best.id;
  if (state) {
    publishEvent(state, {
      type: 'monster_bait_attracted',
      time,
      floor,
      zoneId: best.zoneId,
      roomId: best.roomId,
      x: best.x,
      y: best.y,
      actorId: monster.id,
      actorName: monster.name,
      actorFaction: monster.faction,
      itemId: best.itemId,
      itemName: best.itemName,
      itemCount: best.itemCount,
      itemValue: best.itemValue,
      monsterKind: monster.monsterKind,
      severity: best.risk >= 2 ? 3 : 2,
      privacy: 'local',
      tags: baitEventTags(best, 'attracted', ecologyTags),
      data: {
        baitId: best.id,
        source: best.source,
        itemValue: best.itemValue,
        baitTags: best.baitTags,
        ecologyTags,
        baitFit: bestScore,
        strength: best.strength,
        risk: best.risk,
        attractedCount: best.attractedCount,
        maxAttractions: best.maxAttractions,
        activeCap: MONSTER_BAIT_MAX_ACTIVE,
        markerLabel: baitMarkerLabel(best.kind, best.radius, Math.max(0, best.expiresAt - time), best.maxAttractions, best.risk),
      },
    });
  }
  return best;
}

export function consumeMonsterBait(state: GameState | undefined, marker: MonsterBaitMarker, monster: Entity, time: number): number | undefined {
  const entityId = consumeMonsterBaitMarker(state, marker, time, 'consumed', monster);
  if (monster.ai?.baitMarkerId === marker.id) monster.ai.baitMarkerId = undefined;
  return entityId;
}

export function consumeMonsterBaitMarker(
  state: GameState | undefined,
  marker: MonsterBaitMarker,
  time: number,
  reason: string,
  monster?: Entity,
): number | undefined {
  const index = activeBaits.findIndex(b => b.id === marker.id);
  if (index < 0) return undefined;
  const [removed] = activeBaits.splice(index, 1);
  if (monster?.ai?.baitMarkerId === removed.id) monster.ai.baitMarkerId = undefined;
  publishBaitEnd(state, removed, 'monster_bait_consumed', time, reason, monster);
  return removed.entityId;
}

export function removeMonsterBaitForEntity(entityId: number, state: GameState | undefined, time: number, reason: string): void {
  const index = activeBaits.findIndex(b => b.entityId === entityId);
  if (index >= 0) removeBaitAt(index, state, time, reason);
}

export function clearDeadBaitDrop(entity: Entity): void {
  if (entity.type === EntityType.ITEM_DROP) entity.alive = false;
}
