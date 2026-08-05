/* ── Blood Plant: red-mold source, roots, and counterplay hooks ─ */

import {
  Cell,
  MonsterKind,
  ProjType,
  W,
  msg,
  type Entity,
  type GameState,
  type WorldEvent,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/items';
import { Spr } from '../render/sprite_index';
import { entityDisplayName } from '../entities/monster';
import { publishEvent, registerWorldEventObserver } from './events';
import { registerInventoryUseHandler, type InventoryUseHandlerContext } from './inventory';
import { isPlayerEntity } from './player_actor';

export const RED_MOLD_SAMPLE_ID = 'red_mold_sample';
export const BLOOD_PLANT_TENDRIL_RANGE = 8.25;
export const BLOOD_PLANT_TENDRIL_MAX_CELLS = 9;
export const BLOOD_PLANT_HEAL_RADIUS = 7.5;
export const BLOOD_PLANT_HEAL_SCAN_SEC = 1.2;
export const BLOOD_PLANT_HEAL_PER_SOURCE = 4;
export const BLOOD_PLANT_SALT_RADIUS = 3.6;

const BLOOD_PLANT_CUT_WEAPONS = new Set([
  'knife',
  'axe',
  'liquidator_axe',
  'chainsaw',
  'fire_hook',
  'rebar',
  'pipe',
  'crowbar',
  'entrenching_spade',
  'bayonet',
]);

interface BloodRootSite {
  id: string;
  plantIds: number[];
  rootCells: number[];
  roomId?: number;
  zoneId?: number;
}

interface Runtime {
  sites: BloodRootSite[];
  byPlant: Map<number, BloodRootSite[]>;
}

export interface BloodPlantRootSiteDraft {
  id: string;
  plantIds: readonly number[];
  rootCells: readonly number[];
  roomId?: number;
  zoneId?: number;
}

export interface RedMoldSourceScan {
  sources: number;
  containerIds: number[];
}

export interface BloodPlantHealResult {
  healed: number;
  sources: number;
  containerIds: number[];
}

const runtimes = new WeakMap<World, Runtime>();

function ensureRuntime(world: World): Runtime {
  let runtime = runtimes.get(world);
  if (!runtime) {
    runtime = { sites: [], byPlant: new Map() };
    runtimes.set(world, runtime);
  }
  return runtime;
}

function rebuildPlantIndex(runtime: Runtime): void {
  runtime.byPlant.clear();
  for (const site of runtime.sites) {
    for (const plantId of site.plantIds) {
      const list = runtime.byPlant.get(plantId);
      if (list) list.push(site);
      else runtime.byPlant.set(plantId, [site]);
    }
  }
}

function compactCells(cells: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of cells) {
    const cell = Math.floor(raw);
    if (cell < 0 || cell >= W * W || seen.has(cell)) continue;
    seen.add(cell);
    out.push(cell);
  }
  return out;
}

export function registerBloodPlantRootSite(world: World, draft: BloodPlantRootSiteDraft): void {
  const rootCells = compactCells(draft.rootCells);
  const plantIds = [...new Set(draft.plantIds.map(id => Math.floor(id)).filter(id => id >= 0))];
  if (rootCells.length === 0 || plantIds.length === 0) return;
  const site: BloodRootSite = {
    id: draft.id,
    plantIds,
    rootCells,
    roomId: draft.roomId,
    zoneId: draft.zoneId,
  };
  const runtime = ensureRuntime(world);
  runtime.sites = runtime.sites.filter(existing => existing.id !== site.id);
  runtime.sites.push(site);
  rebuildPlantIndex(runtime);
}

function openRootCells(world: World, site: BloodRootSite): number {
  let opened = 0;
  for (const cell of site.rootCells) {
    const old = world.cells[cell];
    if (old !== Cell.WALL && old !== Cell.DOOR) continue;
    if (old === Cell.DOOR) world.removeDoorAt(cell);
    else world.cells[cell] = Cell.FLOOR;
    opened++;
  }
  if (opened > 0) world.markCellsDirty();
  return opened;
}

function openBloodPlantRootSites(world: World, plant: Entity): number {
  const runtime = runtimes.get(world);
  const sites = runtime?.byPlant.get(plant.id);
  if (!sites || sites.length === 0) return 0;
  let opened = 0;
  for (const site of sites) opened += openRootCells(world, site);
  return opened;
}

function cellZoneId(world: World, e: Entity): number | undefined {
  const zid = world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return zid >= 0 ? zid : undefined;
}

function cellRoomId(world: World, e: Entity): number | undefined {
  const rid = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return rid >= 0 ? rid : undefined;
}

function actorName(e: Entity | undefined): string | undefined {
  if (!e) return undefined;
  if (e.name) return e.name;
  return e.monsterKind !== undefined ? entityDisplayName(e) : isPlayerEntity(e) ? 'Вы' : undefined;
}

function hasRedMoldInventory(items: readonly { defId: string; count: number }[]): boolean {
  for (const item of items) {
    if (item.count > 0 && item.defId === RED_MOLD_SAMPLE_ID) return true;
  }
  return false;
}

function removeOneRedMold(items: { defId: string; count: number }[]): boolean {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.defId !== RED_MOLD_SAMPLE_ID || item.count <= 0) continue;
    item.count--;
    if (item.count <= 0) {
      const last = items.pop();
      if (last !== undefined && i < items.length) {
        items[i] = last;
      }
    }
    return true;
  }
  return false;
}

export function redMoldSourcesNear(world: World, plant: Entity, radius = BLOOD_PLANT_HEAL_RADIUS): RedMoldSourceScan {
  const radiusSq = radius * radius;
  const containerIds: number[] = [];
  for (const container of world.containers) {
    if (containerIds.length >= 6) break;
    if (world.dist2(plant.x, plant.y, container.x + 0.5, container.y + 0.5) > radiusSq) continue;
    if (!hasRedMoldInventory(container.inventory)) continue;
    containerIds.push(container.id);
  }
  return { sources: containerIds.length, containerIds };
}

export function healBloodPlantFromRedMold(world: World, plant: Entity): BloodPlantHealResult {
  const scan = redMoldSourcesNear(world, plant);
  if (scan.sources <= 0 || plant.hp === undefined) return { healed: 0, ...scan };
  const maxHp = plant.maxHp ?? plant.hp;
  const healed = Math.min(Math.max(0, maxHp - plant.hp), scan.sources * BLOOD_PLANT_HEAL_PER_SOURCE);
  if (healed > 0) plant.hp += healed;
  return { healed, ...scan };
}

export function traceBloodPlantTendrilCells(
  world: World,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  maxCells = BLOOD_PLANT_TENDRIL_MAX_CELLS,
): number[] {
  const dx = world.delta(fromX, toX);
  const dy = world.delta(fromY, toY);
  const len = Math.hypot(dx, dy);
  if (len <= 0.0001 || maxCells <= 0) return [];
  const ux = dx / len;
  const uy = dy / len;
  const cells: number[] = [];
  let last = -1;
  for (let step = 1; step <= Math.min(maxCells, Math.ceil(len)); step++) {
    const x = world.wrap(Math.floor(fromX + ux * step));
    const y = world.wrap(Math.floor(fromY + uy * step));
    const ci = world.idx(x, y);
    if (ci === last) continue;
    last = ci;
    if (world.solid(x, y)) break;
    cells.push(ci);
  }
  return cells;
}

export function isBloodPlantFireProjectile(projectile: Entity): boolean {
  return (projectile.projType ?? ProjType.NORMAL) === ProjType.FLAME ||
    projectile.sprite === Spr.FLAME_BOLT ||
    projectile.sprite === Spr.HOSTILE_FLAME_BOLT;
}

export function isBloodPlantCuttingWeapon(weaponId: string | undefined): boolean {
  return weaponId !== undefined && BLOOD_PLANT_CUT_WEAPONS.has(weaponId);
}

export function bloodPlantProjectileDamage(target: Entity, projectile: Entity, baseDamage: number): number {
  if (target.monsterKind !== MonsterKind.BLOOD_PLANT || !isBloodPlantFireProjectile(projectile)) return baseDamage;
  const maxHp = Math.max(1, target.maxHp ?? target.hp ?? 1);
  return Math.max(baseDamage, Math.ceil(maxHp * 0.38));
}

export function recordBloodPlantBurned(world: World, state: GameState, plant: Entity, actor?: Entity): number {
  const openedRootCells = openBloodPlantRootSites(world, plant);
  publishEvent(state, {
    type: 'blood_plant_burned',
    zoneId: cellZoneId(world, plant),
    roomId: cellRoomId(world, plant),
    x: plant.x,
    y: plant.y,
    actorId: actor?.id,
    actorName: actorName(actor),
    actorFaction: actor?.faction,
    targetId: plant.id,
    targetName: actorName(plant),
    monsterKind: MonsterKind.BLOOD_PLANT,
    severity: 5,
    privacy: isPlayerEntity(actor) ? 'local' : 'witnessed',
    tags: ['monster', 'blood_plant', 'burned', 'fire', 'red_mold', 'route'],
    data: {
      openedRootCells,
      rumorIds: ['monster_blood_plant_red_mold', 'ecology_blood_plant_roots'],
    },
  });
  return openedRootCells;
}

export function recordBloodPlantRootCut(
  world: World,
  state: GameState,
  plant: Entity,
  actor?: Entity,
  reason: 'tool' | 'salt' = 'tool',
): number {
  const openedRootCells = openBloodPlantRootSites(world, plant);
  publishEvent(state, {
    type: 'blood_plant_root_cut',
    zoneId: cellZoneId(world, plant),
    roomId: cellRoomId(world, plant),
    x: plant.x,
    y: plant.y,
    actorId: actor?.id,
    actorName: actorName(actor),
    actorFaction: actor?.faction,
    targetId: plant.id,
    targetName: actorName(plant),
    monsterKind: MonsterKind.BLOOD_PLANT,
    severity: 4,
    privacy: isPlayerEntity(actor) ? 'local' : 'witnessed',
    tags: ['monster', 'blood_plant', 'cut', reason, 'roots', 'route'],
    data: {
      openedRootCells,
      reason,
      rumorIds: ['ecology_blood_plant_roots', 'lead_living_blood_plant_den'],
    },
  });
  return openedRootCells;
}

export function neutralizeRedMoldSourceNear(
  world: World,
  state: GameState,
  actor: Entity,
  radius = BLOOD_PLANT_SALT_RADIUS,
): boolean {
  const radiusSq = radius * radius;
  let bestContainerId = -1;
  let bestDist = radiusSq;
  for (const container of world.containers) {
    if (!hasRedMoldInventory(container.inventory)) continue;
    const d2 = world.dist2(actor.x, actor.y, container.x + 0.5, container.y + 0.5);
    if (d2 > bestDist) continue;
    bestDist = d2;
    bestContainerId = container.id;
  }
  if (bestContainerId < 0) return false;
  const container = world.containerById.get(bestContainerId);
  if (!container || !removeOneRedMold(container.inventory)) return false;
  publishEvent(state, {
    type: 'red_mold_exposed',
    floor: container.floor,
    zoneId: container.zoneId,
    roomId: container.roomId,
    x: container.x + 0.5,
    y: container.y + 0.5,
    actorId: actor.id,
    actorName: actorName(actor),
    actorFaction: actor.faction,
    targetId: container.ownerNpcId,
    targetName: container.ownerName ?? container.name,
    targetFaction: container.faction,
    itemId: RED_MOLD_SAMPLE_ID,
    itemName: ITEMS[RED_MOLD_SAMPLE_ID]?.name,
    itemCount: 1,
    itemValue: ITEMS[RED_MOLD_SAMPLE_ID]?.value,
    monsterKind: MonsterKind.BLOOD_PLANT,
    containerId: container.id,
    containerOwnerId: container.ownerNpcId,
    containerFaction: container.faction,
    severity: 4,
    privacy: isPlayerEntity(actor) ? 'local' : 'witnessed',
    tags: ['blood_plant', 'red_mold', 'contraband', 'salt', 'neutralized', 'counterplay'],
    data: {
      containerName: container.name,
      rumorIds: ['monster_blood_plant_red_mold', 'ecology_blood_plant_roots'],
    },
  });
  return true;
}

function consumeInventorySlot(actor: Entity, slotIdx: number): void {
  const inventory = actor.inventory;
  if (!inventory || slotIdx < 0 || slotIdx >= inventory.length) return;
  inventory[slotIdx].count--;
  if (inventory[slotIdx].count <= 0) {
    const last = inventory.pop();
    if (last !== undefined && slotIdx < inventory.length) {
      inventory[slotIdx] = last;
    }
  }
}

function handleBloodPlantInventoryUse(ctx: InventoryUseHandlerContext): boolean {
  if (ctx.def.id !== 'rock_salt' || !ctx.world || !ctx.state) return false;
  if (!neutralizeRedMoldSourceNear(ctx.world, ctx.state, ctx.actor)) return false;
  consumeInventorySlot(ctx.actor, ctx.slotIdx);
  ctx.msgs.push(msg('Соль зашипела в красной плесени. Корень потерял один кормовой ящик.', ctx.time, '#fba'));
  return true;
}

function shouldExposeRedMold(event: WorldEvent): boolean {
  if (event.type === 'red_mold_exposed') return false;
  if (event.itemId === RED_MOLD_SAMPLE_ID) return true;
  if (!event.tags.includes('red_mold')) return false;
  return event.type === 'item_stolen' ||
    event.type === 'player_pick_item' ||
    event.type === 'container_opened' ||
    event.type === 'quest_completed';
}

function redMoldExposurePrivacy(event: WorldEvent): 'public' | 'local' | 'witnessed' {
  if (event.type === 'quest_completed' || event.tags.includes('expose')) return 'public';
  if (event.privacy === 'witnessed' || event.tags.includes('witnessed')) return 'witnessed';
  return 'local';
}

function handleRedMoldExposure(state: GameState, event: WorldEvent): void {
  if (!shouldExposeRedMold(event)) return;
  const privacy = redMoldExposurePrivacy(event);
  publishEvent(state, {
    type: 'red_mold_exposed',
    floor: event.floor,
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: event.targetName ?? 'Партия красной плесени',
    targetFaction: event.targetFaction,
    itemId: RED_MOLD_SAMPLE_ID,
    itemName: ITEMS[RED_MOLD_SAMPLE_ID]?.name,
    itemCount: event.itemCount,
    itemValue: ITEMS[RED_MOLD_SAMPLE_ID]?.value,
    monsterKind: event.monsterKind === MonsterKind.BLOOD_PLANT ? MonsterKind.BLOOD_PLANT : undefined,
    severity: privacy === 'public' ? 5 : 4,
    privacy,
    tags: ['blood_plant', 'red_mold', 'contraband', 'social_infection', privacy === 'public' ? 'expose' : 'harvest'],
    data: {
      sourceEventId: event.id,
      rumorIds: ['monster_blood_plant_red_mold', 'lead_living_blood_plant_den'],
    },
  });
}

registerInventoryUseHandler(handleBloodPlantInventoryUse);
registerWorldEventObserver(handleRedMoldExposure);
