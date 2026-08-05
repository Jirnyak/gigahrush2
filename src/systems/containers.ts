import {
  Cell, ContainerKind, EntityType, Faction, Feature, FloorLevel, ItemType, RoomType,
  type ContainerAccess, type Entity, type GameState, type Item, type Room, type WorldContainer,
} from '../core/types';
import { World } from '../core/world';
import { CONTAINER_DEFS, containerKindsForRoom } from '../data/container_defs';
import { ITEMS } from '../data/catalog';
import { rebuildPathBlockersFromWorldObjects } from '../gen/path_blockers';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import {
  getPermitDef,
  permitAccessTagsFromContainerTags,
  resolvePermitAccess,
} from '../data/permits';
import {
  chernobogDocketContainerEventTags,
  chernobogDocketContainerRumorIds,
  isChernobogDocketItem,
} from '../data/chernobog_docket';
import { getStack } from '../data/items';
import { addFactionRelMutual } from '../data/relations';
import { changeResourceStock, getEconomyQuote, type EconomyQuote } from './economy';
import { controlHint } from './controls';
import { publishEvent } from './events';
import { CHALK_ITEM_ID, createChalkItemData } from './chalk';
import { generateContainerLoot } from './procedural_loot';
import { recordPermitAccess } from './permits';
import { applyRoomMemoryRelationPenalty, applyTheftRelationPenalty } from './factions';
import { addKarma } from './alife_rating';
import { publishMaronaryShavingAcquired } from './maronary_shaving';
import { territoryOwnerToFaction } from '../data/factions';
import { territoryRoomOwner } from './territory';
import {
  ROOM_MEMORY_BITS,
  getRoomMemoryForContainer,
  roomMemoryHas,
  roomMemoryIsHelpful,
  roomMemoryPriceMultiplier,
  roomMemoryRevealsStash,
  roomMemoryShouldRefuseService,
  roomMemoryShouldReportTouch,
  type RoomMemoryRecord,
} from './room_memory';
import { observeRumorEvent } from './rumor';
import {
  SHELTER_TALLY_ID,
  isShelterTallyItem,
  publishShelterTallyEvent,
} from './shelter_tally';
import { isPlayerEntity } from './player_actor';
import { ENTITY_MASK_NPC, ensureEntityIndex } from './entity_index';

const THEFT_WITNESS_RADIUS = 7;
const THEFT_WITNESS_SCAN_CAP = 160;
const THEFT_WITNESS_REPORT_CAP = 4;
const THEFT_AUDIT_COOLDOWN_S = 120;
const THEFT_AUDIT_RADIUS = 12;
const THEFT_AUDIT_SCAN_CAP = 160;
const THEFT_AUDIT_REPORT_CAP = 2;
const THEFT_AUDIT_TICK_CONTAINER_CAP = 8;
const CONTAINER_BUY_TARIFF = 1.12;
const CONTAINER_UNLOCK_ITEM_IDS = [
  'container_key_label',
  'key',
  'official_permit_slip',
  'official_quarantine_clearance',
  'elevator_access_order',
] as const;

let theftAuditCursor = 0;
const theftWitnessQuery: Entity[] = [];
const theftAuditQuery: Entity[] = [];

export type ContainerAccessMode = 'free' | 'steal' | 'buy' | 'unlock' | 'locked' | 'secret';

export interface ContainerAccessInfo {
  label: string;
  detail: string;
  color: string;
  canTake: boolean;
  canPut: boolean;
  theft: boolean;
  mode?: ContainerAccessMode;
  purchase?: boolean;
  unlock?: boolean;
  service?: boolean;
}

export interface ContainerInteractionContext {
  state?: GameState;
  world?: World;
  entities?: readonly Entity[];
}

export interface ContainerTheftStatus {
  label: string;
  detail: string;
  color: string;
}

export interface ContainerItemActionInfo {
  label: string;
  detail: string;
  color: string;
  enabled: boolean;
  mode: ContainerAccessMode | 'put' | 'service';
  price?: number;
}

function containerSeed(roomId: number, kind: ContainerKind, n: number): number {
  let x = (roomId + 1) * 1103515245 + (kind + 3) * 12345 + n * 2654435761;
  x ^= x >>> 16;
  return x >>> 0;
}

function findContainerCell(world: World, room: Room, n: number): { x: number; y: number } | null {
  for (let a = 0; a < 16; a++) {
    const x = world.wrap(room.x + 1 + ((n * 3 + a * 5) % Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + ((n * 5 + a * 7) % Math.max(1, room.h - 2)));
    const i = world.idx(x, y);
    if (world.cells[i] === Cell.FLOOR && world.features[i] === Feature.NONE && world.roomMap[i] === room.id) return { x, y };
  }
  return null;
}

function seedInventory(kind: ContainerKind, roomId: number, level = 0): Item[] {
  const def = CONTAINER_DEFS[kind];
  const inv: Item[] = [];
  const rollItems: number[] = [];
  let numItems = 1;
  const Z = Math.abs(level);
  let n = 0;
  while (true) {
    const seed = containerSeed(roomId, kind, n++);
    const r = (seed % 100_000) / 100_000;
    if (r < (Z + 1) / (Z + 1 + numItems)) {
      numItems++;
    } else {
      break;
    }
  }

  for (let i = 0; i < numItems; i++) {
    const seed = containerSeed(roomId, kind, n + i);
    rollItems.push((seed % 10_000) / 10_000);
  }
  const proceduralItems = generateContainerLoot(def.tags, def.proceduralValueCap, level, rollItems);
  for (const item of proceduralItems) {
    const existing = inv.find(i => i.defId === item.defId && i.count < getStack(ITEMS[item.defId]));
    if (existing) {
      existing.count++;
    } else if (inv.length < MAX_INVENTORY_SLOTS) {
      inv.push(item);
    }
  }
  return inv;
}

/* ── Generic feature-loot containers ──────────────────────────────
 * Bare decorative `Feature` cells (table, shelf, desk, machine, ...) that have
 * no explicit interaction lazily become lootable containers when the player
 * interacts with them (see `ensureFeatureLootContainer` in systems/interactive).
 * Container kind comes from the feature type; deeper/higher-level cells lean
 * toward richer loot kinds, so loot scales with floor level. These are tagged
 * `feature_loot` and excluded from save serialization (regenerated determ. each
 * session), so they never consume the persistent container budget. */
export const FEATURE_LOOT_TAG = 'feature_loot';

const FEATURE_LOOT_BASE_KIND: Partial<Record<Feature, ContainerKind>> = {
  [Feature.STOVE]: ContainerKind.FRIDGE,
  [Feature.SHELF]: ContainerKind.METAL_CABINET,
  [Feature.DESK]: ContainerKind.FILING_CABINET,
  [Feature.MACHINE]: ContainerKind.TOOL_LOCKER,
  [Feature.APPARATUS]: ContainerKind.TOOL_LOCKER,
  [Feature.TABLE]: ContainerKind.WOODEN_CHEST,
  [Feature.CHAIR]: ContainerKind.WOODEN_CHEST,
  [Feature.BED]: ContainerKind.WOODEN_CHEST,
};

const FEATURE_LOOT_UPGRADE_KINDS = [
  ContainerKind.MEDICAL_CABINET,
  ContainerKind.WEAPON_CRATE,
  ContainerKind.SAFE,
] as const;

export function featureLootContainerKind(feature: Feature, level: number, seed: number): ContainerKind | null {
  const base = FEATURE_LOOT_BASE_KIND[feature];
  if (base === undefined) return null;
  // Floor-level scaling: deeper/edge cells (higher zone level) lean toward richer loot.
  const upgradeChance = Math.max(0, Math.min(0.5, 0.06 + level * 0.03));
  if ((seed % 1000) / 1000 < upgradeChance) {
    return FEATURE_LOOT_UPGRADE_KINDS[(seed >>> 7) % FEATURE_LOOT_UPGRADE_KINDS.length];
  }
  return base;
}

export function makeFeatureLootContainer(
  id: number,
  world: World,
  x: number,
  y: number,
  floor: FloorLevel,
  feature: Feature,
  level: number,
  seed: number,
): WorldContainer | null {
  const kind = featureLootContainerKind(feature, level, seed);
  if (kind === null) return null;
  const def = CONTAINER_DEFS[kind];
  const idx = world.idx(x, y);
  return {
    id,
    x,
    y,
    floor,
    // roomId -1: a transient feature-loot layer that never matches a real room,
    // so it cannot suppress a room's normal container seeding and is pruned on
    // floor transition/samosbor (then lazily recreated). Never saved.
    roomId: -1,
    zoneId: world.zoneMap[idx],
    kind,
    name: def.name,
    inventory: seedInventory(kind, seed, level),
    capacitySlots: def.capacitySlots,
    access: 'public',
    discovered: true,
    tags: [...def.tags, FEATURE_LOOT_TAG],
  };
}

function tallyFloorAllowsStaticSeed(floor: FloorLevel): boolean {
  return floor === FloorLevel.LIVING || floor === FloorLevel.KVARTIRY || floor === FloorLevel.MINISTRY;
}

function hasShelterTallyStaticPath(world: World, floor: FloorLevel): boolean {
  for (const container of world.containers) {
    if (container.floor !== floor) continue;
    if (!container.tags.includes('istotit_tally_source')) continue;
    if (container.inventory.some(item => isShelterTallyItem(item.defId))) return true;
  }
  return false;
}

function ensureShelterTallyStaticPath(world: World, floor: FloorLevel): void {
  if (!tallyFloorAllowsStaticSeed(floor) || !ITEMS[SHELTER_TALLY_ID]) return;
  if (hasShelterTallyStaticPath(world, floor)) return;
  const target = world.containers.find(c => c.floor === floor
    && c.inventory.length < c.capacitySlots
    && (c.tags.includes('samosbor') || c.tags.includes('paper'))
    && c.access !== 'locked')
    ?? world.containers.find(c => c.floor === floor && c.inventory.length < c.capacitySlots && c.access !== 'locked');
  if (!target) return;
  if (!target.inventory.some(item => isShelterTallyItem(item.defId))) target.inventory.push({ defId: SHELTER_TALLY_ID, count: 1 });
  if (!target.tags.includes('istotit_tally_source')) target.tags.push('istotit_tally_source');
}

function normalizeContainerInventory(input: unknown, capacitySlots: number): Item[] {
  if (!Array.isArray(input)) return [];
  const inv: Item[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<Item>;
    if (typeof item.defId !== 'string') continue;
    const def = ITEMS[item.defId];
    if (!def) continue;
    const count = Math.floor(Number(item.count) || 0);
    if (count <= 0) continue;
    inv.push({
      defId: item.defId,
      count: Math.min(count, getStack(def)),
      data: item.data,
    });
    if (inv.length >= capacitySlots) break;
  }
  return inv;
}

function validContainerAccess(input: unknown): input is ContainerAccess {
  return input === 'public'
    || input === 'room'
    || input === 'faction'
    || input === 'owner'
    || input === 'locked'
    || input === 'secret';
}

function validProductionBlockedReason(input: unknown): WorldContainer['productionBlockedReason'] | undefined {
  return input === 'no_inputs' || input === 'container_full' || input === 'no_container'
    ? input
    : undefined;
}

function containerCellValid(world: World, floor: FloorLevel, container: WorldContainer): boolean {
  if (container.floor !== floor) return false;
  if (!Number.isFinite(container.x) || !Number.isFinite(container.y)) return false;
  const x = world.wrap(Math.floor(container.x));
  const y = world.wrap(Math.floor(container.y));
  const room = world.rooms[container.roomId];
  if (!room) return false;
  const ci = world.idx(x, y);
  if (world.roomMap[ci] !== room.id) return false;
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function normalizeSavedContainer(
  world: World,
  floor: FloorLevel,
  raw: unknown,
  usedIds: Set<number>,
): WorldContainer | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<WorldContainer>;
  const id = Math.floor(Number(src.id) || 0);
  const rawX = Math.floor(Number(src.x));
  const rawY = Math.floor(Number(src.y));
  const roomId = Math.floor(Number(src.roomId));
  const kind = Math.floor(Number(src.kind));
  if (id <= 0 || usedIds.has(id)) return null;
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
  const def = CONTAINER_DEFS[kind as ContainerKind];
  if (!Number.isFinite(roomId) || !def) return null;
  const x = world.wrap(rawX);
  const y = world.wrap(rawY);
  const savedCapacity = Math.floor(Number(src.capacitySlots));
  const capacitySlots = Number.isFinite(savedCapacity) && savedCapacity > 0
    ? Math.max(1, Math.min(MAX_INVENTORY_SLOTS, savedCapacity))
    : def.capacitySlots;
  const container: WorldContainer = {
    id,
    x,
    y,
    floor,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: kind as ContainerKind,
    name: typeof src.name === 'string' ? src.name.slice(0, 96) : def.name,
    inventory: normalizeContainerInventory(src.inventory, capacitySlots),
    capacitySlots,
    ownerNpcId: typeof src.ownerNpcId === 'number' ? src.ownerNpcId : undefined,
    ownerName: typeof src.ownerName === 'string' ? src.ownerName.slice(0, 64) : undefined,
    faction: typeof src.faction === 'number' ? src.faction : undefined,
    access: validContainerAccess(src.access) ? src.access : def.defaultAccess,
    lockDifficulty: typeof src.lockDifficulty === 'number' ? src.lockDifficulty : undefined,
    discovered: src.discovered === true,
    stolenItemIds: Array.isArray(src.stolenItemIds)
      ? src.stolenItemIds.filter((id): id is string => typeof id === 'string' && !!ITEMS[id]).slice(0, 16)
      : undefined,
    lastOpenedBy: typeof src.lastOpenedBy === 'number' ? src.lastOpenedBy : undefined,
    lastOpenedAt: typeof src.lastOpenedAt === 'number' ? src.lastOpenedAt : undefined,
    lastAuditAt: typeof src.lastAuditAt === 'number' ? src.lastAuditAt : undefined,
    factoryId: typeof src.factoryId === 'string' ? src.factoryId : undefined,
    lastProducedAt: typeof src.lastProducedAt === 'number' ? src.lastProducedAt : undefined,
    lastProducedItemId: typeof src.lastProducedItemId === 'string' ? src.lastProducedItemId : undefined,
    lastProducedCount: typeof src.lastProducedCount === 'number' ? src.lastProducedCount : undefined,
    productionBlockedReason: validProductionBlockedReason(src.productionBlockedReason),
    tags: Array.isArray(src.tags)
      ? src.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12)
      : [...def.tags],
  };
  if (!containerCellValid(world, floor, container)) return null;
  usedIds.add(id);
  return container;
}

export function pruneContainersForWorld(world: World, floor: FloorLevel): number {
  const usedIds = new Set<number>();
  const kept: WorldContainer[] = [];
  const changedCells: number[] = [];
  for (const container of world.containers) {
    if (!containerCellValid(world, floor, container) || usedIds.has(container.id)) {
      if (Number.isFinite(container.x) && Number.isFinite(container.y)) {
        changedCells.push(world.idx(container.x, container.y));
      }
      continue;
    }
    container.x = world.wrap(Math.floor(container.x));
    container.y = world.wrap(Math.floor(container.y));
    container.zoneId = world.zoneMap[world.idx(container.x, container.y)];
    kept.push(container);
    usedIds.add(container.id);
  }
  const removed = world.containers.length - kept.length;
  world.containers = kept;
  world.rebuildContainerMap();
  if (changedCells.length > 0) rebuildPathBlockersFromWorldObjects(world, undefined, changedCells);
  return removed;
}

export function pruneVolatileContainersForRebuild(world: World, floor: FloorLevel): number {
  const kept: WorldContainer[] = [];
  const changedCells: number[] = [];
  for (const container of world.containers) {
    if (container.floor === floor && Number.isFinite(container.x) && Number.isFinite(container.y)) {
      const x = world.wrap(Math.floor(container.x));
      const y = world.wrap(Math.floor(container.y));
      const idx = world.idx(x, y);
      if (!world.aptMask[idx]) {
        changedCells.push(idx);
        continue;
      }
    }
    kept.push(container);
  }
  const removed = world.containers.length - kept.length;
  if (removed > 0) {
    world.containers = kept;
    world.rebuildContainerMap();
    rebuildPathBlockersFromWorldObjects(world, undefined, changedCells);
  }
  return removed;
}

export function restoreValidContainers(world: World, floor: FloorLevel, saved: unknown, maxContainers = 128): number {
  world.containers = [];
  world.rebuildContainerMap();
  if (!Array.isArray(saved)) return 0;
  const usedIds = new Set<number>();
  for (const raw of saved) {
    if (world.containers.length >= maxContainers) break;
    const container = normalizeSavedContainer(world, floor, raw, usedIds);
    if (!container) continue;
    world.addContainer(container);
  }
  rebuildPathBlockersFromWorldObjects(world);
  return world.containers.length;
}

function accessForRoom(room: Room, kind: ContainerKind): ContainerAccess {
  const base = CONTAINER_DEFS[kind].defaultAccess;
  if (room.type === RoomType.HQ && base !== 'public') return 'faction';
  if (room.type === RoomType.OFFICE && kind === ContainerKind.SAFE) return 'locked';
  return base;
}

function factionForRoom(world: World, room: Room): Faction | undefined {
  return territoryOwnerToFaction(territoryRoomOwner(world, room.id)) ?? undefined;
}

export function ensureRoomContainers(world: World, floor: FloorLevel, maxContainers = 128): number {
  pruneContainersForWorld(world, floor);
  if (world.containers.length >= maxContainers) {
    ensureShelterTallyStaticPath(world, floor);
    return 0;
  }
  let created = 0;
  const changedCells: number[] = [];
  for (const room of world.rooms) {
    if (world.containers.length >= maxContainers) break;
    if (!room || room.type === RoomType.CORRIDOR || room.w < 3 || room.h < 3) continue;
    if (world.containers.some(c => c.floor === floor && c.roomId === room.id)) continue;
    const kinds = containerKindsForRoom(room.type);
    const count = room.type === RoomType.STORAGE ? Math.min(3, kinds.length) : room.type === RoomType.PRODUCTION ? 2 : 1;
    for (let n = 0; n < count; n++) {
      if (world.containers.length >= maxContainers) break;
      const kind = kinds[(room.id + n) % kinds.length];
      const def = CONTAINER_DEFS[kind];
      const pos = findContainerCell(world, room, n);
      if (!pos) continue;
      const container: WorldContainer = {
        id: world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1,
        x: pos.x,
        y: pos.y,
        floor,
        roomId: room.id,
        zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
        kind,
        name: `${def.name}: ${room.name}`,
        inventory: seedInventory(kind, room.id, floor),
        capacitySlots: def.capacitySlots,
        faction: factionForRoom(world, room),
        access: accessForRoom(room, kind),
        lockDifficulty: def.defaultAccess === 'locked' ? 2 + (room.id % 4) : undefined,
        discovered: def.defaultAccess !== 'secret',
        tags: [...def.tags],
      };
      world.addContainer(container);
      changedCells.push(world.idx(container.x, container.y));
      created++;
    }
  }
  ensureShelterTallyStaticPath(world, floor);
  if (changedCells.length > 0) rebuildPathBlockersFromWorldObjects(world, undefined, changedCells);
  return created;
}

function containerMemory(container: WorldContainer, state?: GameState): RoomMemoryRecord | undefined {
  if (state && container.floor !== state.currentFloor) return undefined;
  return getRoomMemoryForContainer(container);
}

function revealSecretByRoomMemory(container: WorldContainer, state?: GameState): boolean {
  if (container.access !== 'secret' || container.discovered) return false;
  if (!roomMemoryRevealsStash(containerMemory(container, state))) return false;
  container.discovered = true;
  if (!container.tags.includes('room_memory_revealed')) container.tags.push('room_memory_revealed');
  return true;
}

export function nearbyContainers(world: World, player: Entity, radius = 2.0, state?: GameState): WorldContainer[] {
  const out: WorldContainer[] = [];
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const r = Math.ceil(radius);
  const radiusSq = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = world.wrap(px + dx);
      const y = world.wrap(py + dy);
      if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > radiusSq) continue;
      for (const c of world.containersAt(x, y)) {
        if (c.discovered || c.access !== 'secret' || revealSecretByRoomMemory(c, state)) out.push(c);
      }
    }
  }
  return out;
}

export function firstNearbyContainer(world: World, player: Entity, state?: GameState): WorldContainer | null {
  const list = nearbyContainers(world, player, 2.0, state);
  return list.length > 0 ? list[0] : null;
}

function inventoryHasAny(actor: Entity, defIds: readonly string[]): string | undefined {
  const inv = actor.inventory;
  if (!inv) return undefined;
  for (const defId of defIds) {
    if (inv.some(item => item.defId === defId && item.count > 0)) return defId;
  }
  return undefined;
}

function containerUnlockItemId(container: WorldContainer, actor: Entity): string | undefined {
  if (container.access !== 'locked' || container.tags.includes('unlocked')) return undefined;
  const permitTags = permitAccessTagsFromContainerTags(container.tags);
  if (permitTags.length > 0) {
    const itemIds = actor.inventory?.filter(item => item.count > 0).map(item => item.defId) ?? [];
    const permit = resolvePermitAccess(itemIds, permitTags);
    if (permit) return permit.itemId;
  }
  if (container.tags.includes('quarantine')) {
    const quarantine = inventoryHasAny(actor, ['official_quarantine_clearance', 'key', 'container_key_label']);
    if (quarantine) return quarantine;
  }
  if (container.tags.includes('paper') || container.tags.includes('permit')) {
    const paper = inventoryHasAny(actor, ['official_permit_slip', 'elevator_access_order', 'key', 'container_key_label']);
    if (paper) return paper;
  }
  return inventoryHasAny(actor, CONTAINER_UNLOCK_ITEM_IDS);
}

function isBuyableContainer(container: WorldContainer): boolean {
  return container.tags.includes('buyable') || container.tags.includes('legal_output');
}

export function containerServiceHint(container: WorldContainer): string | null {
  if (container.tags.includes('resident_relief') && !container.tags.includes('resident_relief_done')) return 'еда, вода или талон в общий запас';
  if (container.tags.includes('veretar_window_seal') && !container.tags.includes('veretar_window_sealed_done')) return 'ткань или герметик для белой щели';
  if (container.tags.includes('evidence_drop') && !container.tags.includes('evidence_drop_done')) return 'улика или документ для сдачи';
  if (container.tags.includes('sabotage_drop') && !container.tags.includes('sabotage_drop_done')) return 'грязная закладка испортит запас';
  if (container.tags.includes('production_output')) return 'выдача цеха: можно получить, купить или украсть';
  if (container.tags.includes('service')) return 'служебная сдача предметов';
  return null;
}

export function canAccessContainer(container: WorldContainer, actor: Entity): boolean {
  if (container.access === 'public' || container.access === 'room') return true;
  if (container.access === 'faction') return actor.faction !== undefined && actor.faction === container.faction;
  if (container.access === 'owner') return actor.id === container.ownerNpcId;
  if (container.access === 'locked') return container.tags.includes('unlocked')
    || (actor.faction === container.faction && actor.faction !== undefined);
  if (container.access === 'secret') return container.discovered;
  return false;
}

function roomMemoryAccessDetail(container: WorldContainer, state?: GameState): string {
  const memory = containerMemory(container, state);
  if (!memory) return '';
  if (roomMemoryHas(memory, ROOM_MEMORY_BITS.THEFT)) return 'Комната помнит пропажу; соседи проверяют руки.';
  if (roomMemoryHas(memory, ROOM_MEMORY_BITS.COMBAT)) return 'После боя здесь отвечают через список и свидетелей.';
  if (roomMemoryIsHelpful(memory)) return 'Здесь помнят помощь; цена мягче, тайники вспоминаются охотнее.';
  if (roomMemoryHas(memory, ROOM_MEMORY_BITS.SAMOSBOR)) return 'После самосбора тут говорят шепотом и считают, кто был у гермы.';
  return '';
}

export function containerAccessInfo(container: WorldContainer, actor: Entity, state?: GameState): ContainerAccessInfo {
  const hasAccess = canAccessContainer(container, actor);
  const service = containerServiceHint(container) !== null;
  const unlockItemId = containerUnlockItemId(container, actor);
  const memory = containerMemory(container, state);
  const memoryDetail = roomMemoryAccessDetail(container, state);
  const playerRememberedBad = actor.faction === Faction.PLAYER && roomMemoryShouldRefuseService(memory);
  const memorySuffix = memoryDetail ? ` ${memoryDetail}` : '';
  switch (container.access) {
    case 'public':
      return { label: 'ОБЩИЙ', detail: `Можно брать и класть без последствий.${memorySuffix}`, color: '#8f8', canTake: true, canPut: true, theft: false, mode: 'free', service };
    case 'room':
      return { label: 'КОМНАТНЫЙ', detail: `Комнатный запас. Доступ открыт.${memorySuffix}`, color: '#8cf', canTake: true, canPut: true, theft: false, mode: 'free', service };
    case 'faction':
      if (playerRememberedBad && isBuyableContainer(container)) {
        return { label: 'ОТКАЗ ФРАКЦИИ', detail: `Покупку закрыли до разговора с жильцами.${memorySuffix}`, color: '#f84', canTake: false, canPut: false, theft: false, mode: 'locked', service };
      }
      if (!hasAccess && isBuyableContainer(container)) {
        return { label: 'ПОКУПКА ФРАКЦИИ', detail: `Можно купить по цене дефицита; взлом не нужен.${memorySuffix}`, color: '#ee4', canTake: true, canPut: true, theft: false, mode: 'buy', purchase: true, service };
      }
      return hasAccess
        ? { label: 'ФРАКЦИЯ', detail: `Доступ вашей фракции.${memorySuffix}`, color: '#8cf', canTake: true, canPut: true, theft: false, mode: 'free', service }
        : { label: 'ЧУЖАЯ ФРАКЦИЯ', detail: `Кража: свидетели до ${THEFT_WITNESS_RADIUS} м или ревизия фракции через ${Math.round(THEFT_AUDIT_COOLDOWN_S / 60)} мин.${memorySuffix}`, color: '#f84', canTake: true, canPut: true, theft: true, mode: 'steal', service };
    case 'owner':
      if (playerRememberedBad && isBuyableContainer(container)) {
        return { label: 'ОТКАЗ ВЛАДЕЛЬЦА', detail: `Владелец не продает после комнатного слуха.${memorySuffix}`, color: '#f84', canTake: false, canPut: false, theft: false, mode: 'locked', service };
      }
      if (!hasAccess && isBuyableContainer(container)) {
        return { label: 'ПОКУПКА У ВЛАДЕЛЬЦА', detail: `Владелец: ${container.ownerName ?? 'неизвестен'}. Деньги оставят след вместо кражи.${memorySuffix}`, color: '#ee4', canTake: true, canPut: true, theft: false, mode: 'buy', purchase: true, service };
      }
      return hasAccess
        ? { label: 'ВЛАДЕЛЕЦ', detail: `Владелец: ${container.ownerName ?? 'вы'}.${memorySuffix}`, color: '#8f8', canTake: true, canPut: true, theft: false, mode: 'free', service }
        : { label: 'ЧУЖОЕ', detail: `Владелец: ${container.ownerName ?? 'неизвестен'}. Свидетели до ${THEFT_WITNESS_RADIUS} м или ревизия через ${Math.round(THEFT_AUDIT_COOLDOWN_S / 60)} мин поднимут слух.${memorySuffix}`, color: '#f84', canTake: true, canPut: true, theft: true, mode: 'steal', service };
    case 'locked':
      if (!hasAccess && unlockItemId) {
        return { label: 'МОЖНО ОТПЕРЕТЬ', detail: `Подойдёт: ${ITEMS[unlockItemId]?.name ?? unlockItemId}. Открытие будет записано.${memorySuffix}`, color: '#ee4', canTake: true, canPut: true, theft: false, mode: 'unlock', unlock: true, service };
      }
      return hasAccess
        ? { label: 'ОТПЕРТО', detail: `Замок признаёт ваш доступ.${memorySuffix}`, color: '#8cf', canTake: true, canPut: true, theft: false, mode: 'free', service }
        : { label: 'ЗАПЕРТО', detail: `Нужен ключ, код или фракционный доступ.${memorySuffix}`, color: '#f84', canTake: false, canPut: false, theft: false, mode: 'locked', service };
    case 'secret':
      return container.discovered
        ? { label: container.tags.includes('room_memory_revealed') ? 'ТАЙНИК ПО СЛУХУ' : 'ТАЙНИК', detail: `Тайник найден. Свидетелей нет.${memorySuffix}`, color: '#c8f', canTake: true, canPut: true, theft: false, mode: 'secret', service }
        : { label: 'СКРЫТО', detail: 'Тайник ещё не найден.', color: '#555', canTake: false, canPut: false, theft: false, mode: 'secret', service };
  }
}

export function containerTheftStatus(container: WorldContainer): ContainerTheftStatus | null {
  const stolenCount = container.stolenItemIds?.length ?? 0;
  if (stolenCount <= 0) return null;
  if (container.lastAuditAt !== undefined) {
    return {
      label: 'РЕВИЗИЯ',
      detail: `Пропажа записана: ${stolenCount} вид(а) предметов.`,
      color: '#fa0',
    };
  }
  return {
    label: 'ПРОПАЖА',
    detail: `Не хватает ${stolenCount} вид(а) предметов; владелец может заметить.`,
    color: '#f84',
  };
}

function inventoryFitCount(inv: Item[], defId: string, _capacitySlots: number): number {
  const def = ITEMS[defId];
  if (!def) return 0;
  const maxStack = getStack(def);
  let free = 0;
  for (const slot of inv) {
    if (slot.defId === defId && slot.count < maxStack) free += maxStack - slot.count;
  }
  free += Math.max(0, MAX_INVENTORY_SLOTS - inv.length) * maxStack;
  return free;
}

function addToInventory(inv: Item[], item: Item, count: number, _capacitySlots: number): number {
  const def = ITEMS[item.defId];
  if (!def || count <= 0) return 0;
  const maxStack = getStack(def);
  let left = Math.min(count, inventoryFitCount(inv, item.defId, MAX_INVENTORY_SLOTS));
  const moved = left;
  for (const slot of inv) {
    if (left <= 0) break;
    if (slot.defId !== item.defId || slot.count >= maxStack) continue;
    const add = Math.min(left, maxStack - slot.count);
    slot.count += add;
    left -= add;
  }
  while (left > 0 && inv.length < MAX_INVENTORY_SLOTS) {
    const add = Math.min(left, maxStack);
    const data = item.data ?? (item.defId === CHALK_ITEM_ID ? createChalkItemData(def.durability ?? 0) : undefined);
    inv.push({ defId: item.defId, count: add, data });
    left -= add;
  }
  return moved - left;
}

function removeFromInventorySlot(inv: Item[], slotIdx: number, count: number): boolean {
  const slot = inv[slotIdx];
  if (!slot || count <= 0 || slot.count < count) return false;
  slot.count -= count;
  if (slot.count <= 0) inv.splice(slotIdx, 1);
  return true;
}

function markStolen(container: WorldContainer, item: Item): boolean {
  if (!container.stolenItemIds) container.stolenItemIds = [];
  if (container.stolenItemIds.includes(item.defId)) return false;
  container.stolenItemIds.push(item.defId);
  if (container.stolenItemIds.length > 16) container.stolenItemIds.splice(0, container.stolenItemIds.length - 16);
  return true;
}

function normalizeContext(input?: GameState | ContainerInteractionContext): ContainerInteractionContext {
  if (!input) return {};
  if ('clock' in input && 'msgs' in input) return { state: input };
  return input;
}

function theftCanBeAudited(container: WorldContainer): boolean {
  return container.access === 'owner' || container.access === 'faction';
}

function markTheftKnown(container: WorldContainer, state: GameState): boolean {
  if (container.lastAuditAt !== undefined) return false;
  if (!container.stolenItemIds || container.stolenItemIds.length === 0) return false;
  if (!theftCanBeAudited(container)) return false;
  container.lastAuditAt = state.time;
  return true;
}

function theftAuditReady(container: WorldContainer, state: GameState): boolean {
  const missingSince = container.lastOpenedAt ?? 0;
  return state.time - missingSince >= THEFT_AUDIT_COOLDOWN_S;
}

function addContainerTag(container: WorldContainer, tag: string): void {
  if (!container.tags.includes(tag)) container.tags.push(tag);
}

function isEvidenceItem(defId: string): boolean {
  return isChernobogDocketItem(defId)
    || defId === 'cult_supply_list'
    || defId === 'denunciation'
    || defId === 'sealed_complaint'
    || defId === 'record_exposure_notice'
    || defId === 'voluntary_receipt'
    || defId === 'ration_registry_extract'
    || defId === 'zhelemish_raw';
}

function isSabotageItem(defId: string): boolean {
  return defId === 'infected_mushroom'
    || defId === 'rawmeat'
    || defId === 'acid_bottle'
    || defId === 'ammo_fuel'
    || defId === 'sealant_tube'
    || defId === 'glass_shard';
}

function isVeretarSealItem(defId: string): boolean {
  return defId === 'cloth_roll' || defId === 'sealant_tube';
}

function containerDepositOutcome(container: WorldContainer, item: Item): {
  outcome: string;
  relationDelta: number;
  severity: 1 | 2 | 3 | 4;
  tags: string[];
  rumorIds: string[];
} {
  const def = ITEMS[item.defId];
  if (container.tags.includes('resident_relief') && !container.tags.includes('resident_relief_done')
    && (def?.type === ItemType.FOOD || def?.type === ItemType.DRINK || item.defId === 'water_coupon' || item.defId === 'concentrate_coupon')) {
    addContainerTag(container, 'resident_relief_done');
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 1);
    return {
      outcome: 'resident_relief',
      relationDelta: 1,
      severity: 3,
      tags: ['resident_relief', 'relief'],
      rumorIds: ['faction_citizen_food'],
    };
  }
  if (container.tags.includes('veretar_window_seal') && !container.tags.includes('veretar_window_sealed_done') && isVeretarSealItem(item.defId)) {
    addContainerTag(container, 'veretar_window_sealed_done');
    const curtain = item.defId === 'cloth_roll';
    addContainerTag(container, curtain ? 'veretar_window_curtained' : 'veretar_window_sealed_done_hard');
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, curtain ? 1 : 2);
    return {
      outcome: curtain ? 'veretar_window_curtained' : 'veretar_window_sealed',
      relationDelta: curtain ? 1 : 2,
      severity: curtain ? 3 : 4,
      tags: ['veretar', curtain ? 'veretar_window_curtain' : 'veretar_window_seal', 'witness'],
      rumorIds: [curtain ? 'samosbor_veretar_window_curtained' : 'samosbor_veretar_window_sealed'],
    };
  }
  if (container.tags.includes('evidence_drop') && !container.tags.includes('evidence_drop_done') && isEvidenceItem(item.defId)) {
    addContainerTag(container, 'evidence_drop_done');
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 1);
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -2);
    return {
      outcome: 'evidence_planted',
      relationDelta: -2,
      severity: 4,
      tags: ['evidence', 'expose'],
      rumorIds: ['faction_cultist_after_fog'],
    };
  }
  if (container.tags.includes('sabotage_drop') && !container.tags.includes('sabotage_drop_done') && isSabotageItem(item.defId)) {
    addContainerTag(container, 'sabotage_drop_done');
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -1);
    return {
      outcome: 'supply_sabotage',
      relationDelta: -1,
      severity: 4,
      tags: ['sabotage', 'shortage'],
      rumorIds: ['faction_cultist_after_fog'],
    };
  }
  if (
    item.defId === 'maronary_shaving'
    && (container.access === 'secret' || container.tags.includes('secret') || container.tags.includes('trash'))
  ) {
    addContainerTag(container, 'maronary_hidden');
    return {
      outcome: 'maronary_hidden',
      relationDelta: 0,
      severity: 3,
      tags: ['maronary', 'hidden', 'contraband'],
      rumorIds: ['samosbor_maronary_shaving_hidden'],
    };
  }
  return { outcome: 'deposit', relationDelta: 0, severity: 1, tags: [], rumorIds: [] };
}

function containerPurchaseQuote(
  state: GameState | undefined,
  container: WorldContainer,
  defId: string,
  count: number,
): { unitPrice: number; totalPrice: number; quote?: EconomyQuote } {
  const memoryMultiplier = roomMemoryPriceMultiplier(containerMemory(container, state));
  const fallback = Math.max(1, Math.round((ITEMS[defId]?.value ?? 1) * CONTAINER_BUY_TARIFF * memoryMultiplier));
  if (!state) return { unitPrice: fallback, totalPrice: fallback * count };
  const quote = getEconomyQuote(state, defId, {
    traderFaction: container.faction,
    tariffMultiplier: CONTAINER_BUY_TARIFF * memoryMultiplier,
    tags: ['container_purchase'],
    reason: 'container_owner_stock',
  });
  return { unitPrice: quote.buyPrice, totalPrice: quote.buyPrice * count, quote };
}

function depositActionLabel(container: WorldContainer, item: Item): { label: string; detail: string; color: string; mode: 'put' | 'service' } {
  const def = ITEMS[item.defId];
  if (container.tags.includes('resident_relief') && !container.tags.includes('resident_relief_done')
    && (def?.type === ItemType.FOOD || def?.type === ItemType.DRINK || item.defId === 'water_coupon' || item.defId === 'concentrate_coupon')) {
    return { label: `${controlHint('interact')} отдать в общий запас`, detail: 'Жильцы запомнят помощь.', color: '#8f8', mode: 'service' };
  }
  if (container.tags.includes('veretar_window_seal') && !container.tags.includes('veretar_window_sealed_done') && isVeretarSealItem(item.defId)) {
    return item.defId === 'cloth_roll'
      ? { label: `${controlHint('interact')} занавесить`, detail: 'Ткань закроет белое окно и даст свидетелю отойти.', color: '#f4f1df', mode: 'service' }
      : { label: `${controlHint('interact')} замазать`, detail: 'Герметик закроет белую щель под рамой.', color: '#f4f1df', mode: 'service' };
  }
  if (container.tags.includes('evidence_drop') && !container.tags.includes('evidence_drop_done') && isEvidenceItem(item.defId)) {
    return { label: `${controlHint('interact')} сдать улику`, detail: 'Документ станет событием и слухом.', color: '#8cf', mode: 'service' };
  }
  if (container.tags.includes('sabotage_drop') && !container.tags.includes('sabotage_drop_done') && isSabotageItem(item.defId)) {
    return { label: `${controlHint('interact')} испортить запас`, detail: 'Саботаж ударит по владельцу.', color: '#f84', mode: 'service' };
  }
  if (item.defId === 'maronary_shaving'
    && (container.access === 'secret' || container.tags.includes('secret') || container.tags.includes('trash'))) {
    return { label: `${controlHint('interact')} спрятать`, detail: 'Контрабанда уйдет в тайник.', color: '#c8f', mode: 'service' };
  }
  return { label: `${controlHint('interact')} положить`, detail: 'Обычная сдача в контейнер.', color: '#8cf', mode: 'put' };
}

export function containerItemActionInfo(
  container: WorldContainer,
  actor: Entity,
  side: 'container' | 'player',
  item: Item | undefined,
  state?: GameState,
): ContainerItemActionInfo {
  if (!item) return { label: 'Пустой слот', detail: '', color: '#555', enabled: false, mode: 'free' };
  const access = containerAccessInfo(container, actor, state);
  if (side === 'player') {
    if (!access.canPut) return { label: 'нет доступа', detail: access.detail, color: '#f84', enabled: false, mode: access.mode ?? 'locked' };
    const action = depositActionLabel(container, item);
    return { ...action, enabled: true };
  }
  if (!access.canTake) return { label: 'нет доступа', detail: access.detail, color: '#f84', enabled: false, mode: access.mode ?? 'locked' };
  if (access.purchase) {
    const price = containerPurchaseQuote(state, container, item.defId, 1).totalPrice;
    const enabled = (actor.money ?? 0) >= price;
    return {
      label: enabled ? `${controlHint('interact')} купить ${price}₽` : `нужно ${price}₽`,
      detail: enabled ? 'Деньги оставят торговый след.' : 'Не хватает наличных.',
      color: enabled ? '#ee4' : '#f84',
      enabled,
      mode: 'buy',
      price,
    };
  }
  if (access.unlock) return { label: `${controlHint('interact')} отпереть и взять`, detail: access.detail, color: '#ee4', enabled: true, mode: 'unlock' };
  if (access.theft) return { label: `${controlHint('interact')} украсть`, detail: access.detail, color: '#f84', enabled: true, mode: 'steal' };
  return { label: `${controlHint('interact')} взять`, detail: access.detail, color: access.color, enabled: true, mode: 'free' };
}

function findTheftWitnesses(
  world: World | undefined,
  entities: readonly Entity[] | undefined,
  actor: Entity,
  container: WorldContainer,
): { witnesses: Entity[]; scannedNpcs: number; capped: boolean } {
  if (!world || !entities) return { witnesses: [], scannedNpcs: 0, capped: false };

  const witnesses: Entity[] = [];
  let scannedNpcs = 0;
  ensureEntityIndex(entities).queryRadiusCapped(
    container.x + 0.5,
    container.y + 0.5,
    THEFT_WITNESS_RADIUS,
    theftWitnessQuery,
    ENTITY_MASK_NPC,
    THEFT_WITNESS_SCAN_CAP,
  );
  const capped = theftWitnessQuery.length >= THEFT_WITNESS_SCAN_CAP;
  for (const entity of theftWitnessQuery) {
    if (witnesses.length >= THEFT_WITNESS_REPORT_CAP) {
      break;
    }
    if (!entity.alive || entity.type !== EntityType.NPC || entity.id === actor.id) continue;
    scannedNpcs++;
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
    witnesses.push(entity);
  }
  theftWitnessQuery.length = 0;
  return { witnesses, scannedNpcs, capped };
}

function canAuditContainerTheft(entity: Entity, container: WorldContainer): boolean {
  if (container.ownerNpcId !== undefined && entity.id === container.ownerNpcId) return true;
  return container.faction !== undefined && entity.faction === container.faction;
}

function findTheftAuditors(
  world: World | undefined,
  entities: readonly Entity[] | undefined,
  actor: Entity,
  container: WorldContainer,
): { auditors: Entity[]; scannedNpcs: number; capped: boolean } {
  if (!world || !entities) return { auditors: [], scannedNpcs: 0, capped: false };

  const auditors: Entity[] = [];
  let scannedNpcs = 0;
  ensureEntityIndex(entities).queryRadiusCapped(
    container.x + 0.5,
    container.y + 0.5,
    THEFT_AUDIT_RADIUS,
    theftAuditQuery,
    ENTITY_MASK_NPC,
    THEFT_AUDIT_SCAN_CAP,
  );
  const capped = theftAuditQuery.length >= THEFT_AUDIT_SCAN_CAP;
  for (const entity of theftAuditQuery) {
    if (auditors.length >= THEFT_AUDIT_REPORT_CAP) {
      break;
    }
    if (!entity.alive || entity.type !== EntityType.NPC || entity.id === actor.id) continue;
    scannedNpcs++;
    if (!canAuditContainerTheft(entity, container)) continue;
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
    auditors.push(entity);
  }
  theftAuditQuery.length = 0;
  return { auditors, scannedNpcs, capped };
}

function publishTheftAuditIfDue(container: WorldContainer, actor: Entity, context: ContainerInteractionContext): boolean {
  const state = context.state;
  if (!state || !theftCanBeAudited(container)) return false;
  if (container.lastAuditAt !== undefined) return false;
  if (!container.stolenItemIds || container.stolenItemIds.length === 0) return false;
  if (!theftAuditReady(container, state)) return false;

  const audit = findTheftAuditors(context.world, context.entities, actor, container);
  if (audit.auditors.length === 0) return false;

  const auditedItemId = container.stolenItemIds[container.stolenItemIds.length - 1];
  const auditedItem = ITEMS[auditedItemId];
  const firstAuditor = audit.auditors[0];
  const relationPenalty = applyTheftRelationPenalty(container.faction, false, true);
  markTheftKnown(container, state);
  const eventTags = [
    'container',
    'theft',
    'audit',
    'later_audit',
    ...(auditedItem?.tags ?? []),
    ...container.tags,
  ].filter((tag, idx, all) => all.indexOf(tag) === idx);
  const event = publishEvent(state, {
    type: 'item_stolen',
    zoneId: container.zoneId,
    roomId: container.roomId,
    x: container.x,
    y: container.y,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    targetId: firstAuditor.id,
    targetName: firstAuditor.name ?? container.ownerName,
    targetFaction: firstAuditor.faction ?? container.faction,
    itemId: auditedItemId,
    itemName: auditedItem?.name ?? auditedItemId,
    itemCount: 0,
    itemValue: auditedItem?.value ?? 0,
    containerId: container.id,
    containerOwnerId: container.ownerNpcId,
    containerFaction: container.faction,
    severity: 4,
    privacy: 'local',
    tags: eventTags,
    data: {
      containerName: container.name,
      containerAccess: container.access,
      containerTags: container.tags,
      ownerName: container.ownerName,
      theftOutcome: 'audit',
      auditOnly: true,
      auditAt: container.lastAuditAt,
      auditDelaySeconds: THEFT_AUDIT_COOLDOWN_S,
      auditRadius: THEFT_AUDIT_RADIUS,
      auditorCount: audit.auditors.length,
      auditorIds: audit.auditors.map(a => a.id),
      auditorNames: audit.auditors.map(a => a.name ?? `NPC ${a.id}`),
      auditScanCapped: audit.capped,
      stolenItemIds: container.stolenItemIds.slice(0, 8),
      relationPenalty,
    },
  });
  for (const auditor of audit.auditors) observeRumorEvent(auditor, event, state.time);
  return true;
}

export function tickContainerAudits(
  state: GameState,
  world: World,
  actor: Entity,
  entities: readonly Entity[],
  maxContainers = THEFT_AUDIT_TICK_CONTAINER_CAP,
): number {
  const total = world.containers.length;
  if (total <= 0 || maxContainers <= 0) {
    theftAuditCursor = 0;
    return 0;
  }

  theftAuditCursor %= total;
  let published = 0;
  const scanCount = Math.min(total, Math.max(1, Math.floor(maxContainers)));
  for (let scanned = 0; scanned < scanCount; scanned++) {
    const container = world.containers[theftAuditCursor];
    theftAuditCursor = (theftAuditCursor + 1) % total;
    if (!container || container.floor !== state.currentFloor) continue;
    if (publishTheftAuditIfDue(container, actor, { state, world, entities })) published++;
  }
  return published;
}

function publishRoomMemoryReportIfNeeded(container: WorldContainer, actor: Entity, state: GameState | undefined): number {
  if (!state || actor.faction !== Faction.PLAYER || container.tags.includes('room_memory_reported')) return 0;
  if (container.access === 'public' || container.access === 'secret') return 0;
  const memory = containerMemory(container, state);
  if (!roomMemoryShouldReportTouch(memory)) return 0;
  addContainerTag(container, 'room_memory_reported');
  const relationPenalty = applyRoomMemoryRelationPenalty(container.faction, memory?.severity ?? 3);
  publishEvent(state, {
    type: 'faction_relation_changed',
    zoneId: container.zoneId,
    roomId: container.roomId,
    x: container.x,
    y: container.y,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    targetName: container.ownerName ?? container.name,
    targetFaction: container.faction,
    containerId: container.id,
    containerOwnerId: container.ownerNpcId,
    containerFaction: container.faction,
    severity: Math.min(4, Math.max(3, memory?.severity ?? 3)) as 3 | 4,
    privacy: 'local',
    tags: ['room_memory', 'denunciation', 'container', 'faction_event', ...container.tags]
      .filter((tag, idx, all) => all.indexOf(tag) === idx),
    data: {
      containerName: container.name,
      roomMemoryBits: memory?.bits ?? 0,
      roomMemorySeverity: memory?.severity ?? 0,
      roomMemoryLastEventId: memory?.lastEventId ?? 0,
      relationPenalty,
    },
  });
  return relationPenalty;
}

function unlockContainerForActor(container: WorldContainer, actor: Entity, state: GameState | undefined): { itemId: string } | null {
  const itemId = containerUnlockItemId(container, actor);
  if (!itemId) return null;
  addContainerTag(container, 'unlocked');
  container.discovered = true;
  if (state) {
    publishEvent(state, {
      type: 'container_opened',
      zoneId: container.zoneId,
      roomId: container.roomId,
      x: container.x,
      y: container.y,
      actorId: actor.id,
      actorName: actor.name,
      actorFaction: actor.faction,
      targetId: container.ownerNpcId,
      targetName: container.ownerName,
      targetFaction: container.faction,
      itemId,
      itemName: ITEMS[itemId]?.name ?? itemId,
      itemCount: 0,
      itemValue: ITEMS[itemId]?.value ?? 0,
      containerId: container.id,
      containerOwnerId: container.ownerNpcId,
      containerFaction: container.faction,
      severity: 2,
      privacy: 'local',
      tags: ['container', 'access', 'unlock', 'keyed', ...container.tags].filter((tag, idx, all) => all.indexOf(tag) === idx),
      data: {
        containerName: container.name,
        containerAccess: container.access,
        containerTags: container.tags,
        accessOutcome: 'unlock',
        unlockItemId: itemId,
        unlockItemName: ITEMS[itemId]?.name ?? itemId,
      },
    });
    const permit = getPermitDef(itemId);
    const permitTags = permitAccessTagsFromContainerTags(container.tags);
    if (permit && permitTags.length > 0) {
      recordPermitAccess(state, actor, undefined, permit, container.name, permitTags[0], container.zoneId);
    }
  }
  return { itemId };
}

export function takeFromContainer(
  container: WorldContainer,
  actor: Entity,
  slotIdx: number,
  count: number,
  input?: GameState | ContainerInteractionContext,
): boolean {
  const slot = container.inventory[slotIdx];
  const def = slot ? ITEMS[slot.defId] : undefined;
  if (!slot || count <= 0 || !def) return false;
  const context = normalizeContext(input);
  const state = context.state;
  const access = containerAccessInfo(container, actor, state);
  if (!access.canTake) return false;
  if (!actor.inventory) actor.inventory = [];
  const take = Math.min(count, slot.count, inventoryFitCount(actor.inventory, slot.defId, MAX_INVENTORY_SLOTS));
  if (take <= 0) return false;
  const purchase = access.purchase === true;
  const purchaseQuote = purchase ? containerPurchaseQuote(state, container, slot.defId, take) : undefined;
  if (purchaseQuote && (actor.money ?? 0) < purchaseQuote.totalPrice) return false;
  publishTheftAuditIfDue(container, actor, context);
  const defId = slot.defId;
  const itemName = def.name;
  const item: Item = { defId, count: take, data: take === slot.count ? slot.data : undefined };
  if (!removeFromInventorySlot(container.inventory, slotIdx, take)) return false;
  const moved = addToInventory(actor.inventory, item, take, MAX_INVENTORY_SLOTS);
  if (moved !== take) {
    addToInventory(container.inventory, item, take - moved, container.capacitySlots);
    return false;
  }
  const unlock = access.unlock ? unlockContainerForActor(container, actor, state) : null;
  if (purchaseQuote) {
    actor.money = (actor.money ?? 0) - purchaseQuote.totalPrice;
    if (state && purchaseQuote.quote?.resourceId) {
      changeResourceStock(state, purchaseQuote.quote.resourceId, -moved, state.currentFloor);
    }
  }
  const stolen = access.theft;
  container.lastOpenedBy = actor.id;
  container.lastOpenedAt = state?.time;
  if (state) {
    const quarantine = container.tags.includes('quarantine');
    const theftWitness = stolen ? findTheftWitnesses(context.world, context.entities, actor, container) : { witnesses: [], scannedNpcs: 0, capped: false };
    const stolenItemKnown = stolen ? markStolen(container, { defId, count: moved }) : false;
    const theftWitnessed = theftWitness.witnesses.length > 0;
    const auditMarked = stolen && theftWitnessed ? markTheftKnown(container, state) : false;
    const relationPenalty = stolen
      ? applyTheftRelationPenalty(container.faction, theftWitnessed, false)
      : 0;
    const karmaPenalty = stolen ? (theftWitnessed ? -3 : -2) : 0;
    if (karmaPenalty !== 0) addKarma(actor, karmaPenalty);
    const evidenceTags = chernobogDocketContainerEventTags(container.tags, defId);
    const rumorIds = chernobogDocketContainerRumorIds(container.tags, defId);
    const eventTags = [
      'container',
      stolen ? 'theft' : purchase ? 'buy' : 'open',
      ...evidenceTags,
      ...(purchase ? ['container_purchase'] : []),
      ...(unlock ? ['unlock'] : []),
      ...(stolen ? [theftWitnessed ? 'witnessed' : 'unseen'] : []),
      ...(def.tags ?? []),
      ...container.tags,
    ]
      .filter((tag, idx, all) => all.indexOf(tag) === idx);
    const firstWitness = theftWitness.witnesses[0];
    const event = publishEvent(state, {
      type: stolen ? 'item_stolen' : 'container_opened',
      zoneId: container.zoneId,
      roomId: container.roomId,
      x: container.x,
      y: container.y,
      actorId: actor.id,
      actorName: actor.name,
      actorFaction: actor.faction,
      targetId: firstWitness?.id ?? container.ownerNpcId,
      targetName: firstWitness?.name ?? container.ownerName,
      targetFaction: firstWitness?.faction ?? container.faction,
      itemId: defId,
      itemName,
      itemCount: moved,
      itemValue: purchaseQuote?.totalPrice ?? def.value ?? 0,
      containerId: container.id,
      containerOwnerId: container.ownerNpcId,
      containerFaction: container.faction,
      severity: stolen ? theftWitnessed ? 5 : 2 : purchase ? 2 : quarantine ? 3 : 1,
      privacy: stolen ? theftWitnessed ? 'witnessed' : 'private' : purchase || quarantine ? 'local' : 'private',
      tags: eventTags,
      data: {
        containerName: container.name,
        containerAccess: container.access,
        containerTags: container.tags,
        accessOutcome: stolen ? 'theft' : purchase ? 'purchase' : unlock ? 'unlock_take' : 'open',
        price: purchaseQuote?.totalPrice,
        unitPrice: purchaseQuote?.unitPrice,
        resourceId: purchaseQuote?.quote?.resourceId,
        unlockItemId: unlock?.itemId,
        theftOutcome: stolen ? theftWitnessed ? 'witnessed' : 'unseen' : undefined,
        auditDelaySeconds: stolen && !theftWitnessed && theftCanBeAudited(container) ? THEFT_AUDIT_COOLDOWN_S : undefined,
        witnessCount: theftWitness.witnesses.length,
        witnessIds: theftWitness.witnesses.map(w => w.id),
        witnessScanCapped: theftWitness.capped,
        auditMarked,
        relationPenalty: stolen ? relationPenalty : undefined,
        karmaPenalty: stolen ? karmaPenalty : undefined,
        stolenItemKnown,
        ...(rumorIds.length > 0 ? { rumorIds } : {}),
      },
    });
    if (stolen) {
      for (const witness of theftWitness.witnesses) observeRumorEvent(witness, event, state.time);
      if (isPlayerEntity(actor) && isShelterTallyItem(defId)) {
        publishShelterTallyEvent(state, actor, defId, 'stolen', {
          targetId: firstWitness?.id ?? container.ownerNpcId,
          targetName: firstWitness?.name ?? container.ownerName,
          targetFaction: firstWitness?.faction ?? container.faction,
          container,
        });
      }
    } else {
      publishRoomMemoryReportIfNeeded(container, actor, state);
    }
    if (defId === 'maronary_shaving') {
      publishMaronaryShavingAcquired(actor, state, stolen ? 'container_theft' : 'container');
    }
  }
  return true;
}

function isShelterTallyHideContainer(container: WorldContainer): boolean {
  return container.access === 'secret' || container.tags.includes('secret') || container.tags.includes('trash');
}

export function putIntoContainer(
  container: WorldContainer,
  actor: Entity,
  slotIdx: number,
  count: number,
  input?: GameState | ContainerInteractionContext,
): boolean {
  const inv = actor.inventory;
  if (!inv) return false;
  const source = inv[slotIdx];
  const def = source ? ITEMS[source.defId] : undefined;
  if (!source || count <= 0 || !def) return false;
  const context = normalizeContext(input);
  const state = context.state;
  const access = containerAccessInfo(container, actor, state);
  if (!access.canPut) return false;
  const defId = source.defId;
  const itemName = def.name;
  const moved = Math.min(count, source.count, inventoryFitCount(container.inventory, source.defId, container.capacitySlots));
  if (moved <= 0) return false;
  publishTheftAuditIfDue(container, actor, context);
  const item: Item = { defId, count: moved, data: moved === source.count ? source.data : undefined };
  if (!removeFromInventorySlot(inv, slotIdx, moved)) return false;
  const added = addToInventory(container.inventory, item, moved, container.capacitySlots);
  if (added !== moved) {
    addToInventory(inv, item, moved - added, MAX_INVENTORY_SLOTS);
    return false;
  }
  const unlock = access.unlock ? unlockContainerForActor(container, actor, state) : null;
  container.lastOpenedBy = actor.id;
  container.lastOpenedAt = state?.time;
  if (state) {
    const outcome = containerDepositOutcome(container, { defId, count: moved, data: item.data });
    const witnesses = findTheftWitnesses(context.world, context.entities, actor, container);
    const firstWitness = witnesses.witnesses[0];
    const primaryTags = ['cult', 'supply', 'witness', 'kvartiry'].filter(tag => container.tags.includes(tag));
    const eventTags = [
      'container',
      'deposit',
      ...(unlock ? ['unlock'] : []),
      ...(witnesses.witnesses.length > 0 ? ['witnessed'] : []),
      ...primaryTags,
      ...outcome.tags,
      ...(def.tags ?? []),
      ...container.tags,
    ].filter((tag, idx, all) => all.indexOf(tag) === idx);
    const event = publishEvent(state, {
      type: 'item_deposited',
      zoneId: container.zoneId,
      roomId: container.roomId,
      x: container.x,
      y: container.y,
      actorId: actor.id,
      actorName: actor.name,
      actorFaction: actor.faction,
      targetId: firstWitness?.id ?? container.ownerNpcId,
      targetName: firstWitness?.name ?? container.ownerName,
      targetFaction: firstWitness?.faction ?? container.faction,
      itemId: defId,
      itemName,
      itemCount: moved,
      itemValue: def.value ?? 0,
      containerId: container.id,
      containerOwnerId: container.ownerNpcId,
      containerFaction: container.faction,
      severity: witnesses.witnesses.length > 0 ? Math.max(outcome.severity, 3) as 3 | 4 : outcome.severity,
      privacy: witnesses.witnesses.length > 0 ? 'witnessed' : outcome.severity >= 3 ? 'local' : 'private',
      tags: eventTags,
      data: {
        containerName: container.name,
        containerAccess: container.access,
        containerTags: container.tags,
        accessOutcome: unlock ? 'unlock_deposit' : 'deposit',
        unlockItemId: unlock?.itemId,
        depositOutcome: outcome.outcome,
        relationDelta: outcome.relationDelta,
        witnessCount: witnesses.witnesses.length,
        witnessIds: witnesses.witnesses.map(w => w.id),
        witnessScanCapped: witnesses.capped,
        rumorIds: outcome.rumorIds,
      },
    });
    for (const witness of witnesses.witnesses) observeRumorEvent(witness, event, state.time);
    if (isPlayerEntity(actor) && isShelterTallyItem(defId) && isShelterTallyHideContainer(container)
      && !container.tags.includes('shelter_tally_hidden')) {
      container.tags.push('shelter_tally_hidden');
      publishShelterTallyEvent(state, actor, defId, 'hide', { container });
    }
  }
  return true;
}

export function describeContainer(container: WorldContainer): string {
  const access = container.access === 'public' ? 'общий' : container.access === 'locked' ? 'заперт' : container.access === 'secret' ? 'тайник' : container.access;
  return `#${container.id} ${container.name} ${container.inventory.length}/${container.capacitySlots} ${access}`;
}

export function countContainerItems(world: World): number {
  let n = 0;
  for (const c of world.containers) for (const i of c.inventory) n += i.count;
  return n;
}

export function storeNpcItemInRoomContainer(world: World, npc: Entity): boolean {
  if (npc.type !== EntityType.NPC || !npc.inventory || npc.inventory.length === 0) return false;
  const room = world.roomAt(npc.x, npc.y);
  if (!room) return false;
  const container = world.containers.find(c => c.roomId === room.id && canAccessContainer(c, npc));
  if (!container) return false;
  return putIntoContainer(container, npc, 0, npc.inventory[0].count);
}
