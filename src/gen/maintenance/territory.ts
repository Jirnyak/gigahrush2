import {
  W,
  Cell,
  Tex,
  RoomType,
  Feature,
  Faction,
  Occupation,
  ZoneFaction,
  EntityType,
  AIGoal,
  FloorLevel,
  type Entity,
  type Room,
  type TerritoryOwner,
} from '../../core/types';
import { World } from '../../core/world';
import { randomName, freshNeeds } from '../../data/catalog';
import { activeActorCountAtDefaultSoftLimit } from '../../data/entity_limits';
import { factionToTerritoryOwner } from '../../data/factions';
import { territorySharesForStoryFloor } from '../../data/floor_territory';
import { entitySpawnSlots } from '../../systems/entity_limits';
import { gaussianLevel, getMaxHp, randomRPG } from '../../systems/rpg';
import { initializeCellTerritory, territoryHqAnchors, territoryOwnerAtIndex } from '../../systems/territory';
import { pick, rng } from '../shared';

const MAINTENANCE_NPC_TARGET_AT_DEFAULT_CAP = 500;
export const MAINTENANCE_TERRITORY_SEED = 0x4d770077;
const HQ_SPAWN_RADIUS = 96;
const HQ_SPAWN_RADIUS2 = HQ_SPAWN_RADIUS * HQ_SPAWN_RADIUS;

const PSI_IDS = ['psi_strike','psi_rupture','psi_madness','psi_storm','psi_brainburn'];

interface MaintenanceFactionDef {
  faction: Faction;
  owner: TerritoryOwner;
  occupation: Occupation;
}

interface MaintenanceSpawnBuckets {
  owned: Map<TerritoryOwner, number[]>;
  hq: Map<TerritoryOwner, number[]>;
}

const MAINTENANCE_FACTION_SQUADS: readonly MaintenanceFactionDef[] = [
  { faction: Faction.LIQUIDATOR, owner: factionToTerritoryOwner(Faction.LIQUIDATOR), occupation: Occupation.HUNTER },
  { faction: Faction.CULTIST, owner: factionToTerritoryOwner(Faction.CULTIST), occupation: Occupation.PILGRIM },
  { faction: Faction.WILD, owner: factionToTerritoryOwner(Faction.WILD), occupation: Occupation.TRAVELER },
  { faction: Faction.CITIZEN, owner: factionToTerritoryOwner(Faction.CITIZEN), occupation: Occupation.TRAVELER },
  { faction: Faction.SCIENTIST, owner: factionToTerritoryOwner(Faction.SCIENTIST), occupation: Occupation.SCIENTIST },
];

const MAINTENANCE_HQ_SEEDS: readonly { owner: TerritoryOwner; roomName: string; fallbackX: number; fallbackY: number }[] = [
  { owner: ZoneFaction.LIQUIDATOR, roomName: 'Пост обходчиков: устье коллекторов', fallbackX: 346, fallbackY: 392 },
  { owner: ZoneFaction.CITIZEN, roomName: 'Водомерный пост: давление спорное', fallbackX: 510, fallbackY: 644 },
  { owner: ZoneFaction.CULTIST, roomName: 'Пост Черной ладони у мастерской', fallbackX: 278, fallbackY: 470 },
  { owner: ZoneFaction.SCIENTIST, roomName: 'НИИ Слизи: зелёная кислотная проба', fallbackX: 717, fallbackY: 488 },
  { owner: ZoneFaction.WILD, roomName: 'Логово Манкобуса', fallbackX: 588, fallbackY: 588 },
];

function pickPsi(): string {
  return PSI_IDS[Math.floor(Math.random() * PSI_IDS.length)];
}

function mappedRoomCells(world: World, room: Room): number[] {
  const cells: number[] = [];
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id && !world.aptMask[idx]) cells.push(idx);
    }
  }
  return cells;
}

function roomCenter(room: Room): { x: number; y: number } {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

function paintMaintenanceRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (const idx of mappedRoomCells(world, room)) world.factionControl[idx] = owner;
  for (const idx of room.doors) {
    if (!world.aptMask[idx]) world.factionControl[idx] = owner;
  }
}

function hardenMaintenanceHqSeed(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  paintMaintenanceRoomOwner(world, room, owner);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) {
        if (world.roomMap[idx] === room.id && world.features[idx] === Feature.NONE && ((dx * 13 + dy * 29 + owner) % 17) === 0) {
          world.features[idx] = Feature.TABLE;
        }
        continue;
      }
      if (world.cells[idx] !== Cell.WALL || world.aptMask[idx]) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function claimMaintenanceHqRoom(world: World, room: Room | undefined, owner: TerritoryOwner): boolean {
  if (!room || mappedRoomCells(world, room).length === 0) return false;
  hardenMaintenanceHqSeed(world, room, owner);
  return true;
}

function chooseMaintenanceHqFallbackRoom(world: World, targetX: number, targetY: number, usedRooms: Set<number>): Room | undefined {
  let best: Room | undefined;
  let bestScore = Infinity;
  for (const room of world.rooms) {
    if (!room || usedRooms.has(room.id) || room.apartmentId >= 0 || room.w <= 2 || room.h <= 2) continue;
    if (room.w * room.h > 1200 || mappedRoomCells(world, room).length === 0) continue;
    const center = roomCenter(room);
    const score = world.dist2(center.x, center.y, targetX, targetY) - Math.min(240, room.w * room.h);
    if (score < bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best;
}

const SECONDARY_HQ_NAMES = [
  'Форпост ликвидаторов',
  'Слепой пост охотника на угрей',
  'Сломанный пост караула: Митькина смена',
  'Проваленный пост зачистки: неверный код',
];

const HQ_TARGET_NAMES = [
  ...MAINTENANCE_HQ_SEEDS.map(s => s.roomName),
  ...SECONDARY_HQ_NAMES,
];

function seedMaintenanceHqTerritory(world: World): void {
  const usedRooms = new Set<number>();

  const roomsByName = new Map<string, Room>();
  for (const room of world.rooms) {
    if (room?.name && HQ_TARGET_NAMES.includes(room.name)) {
      roomsByName.set(room.name, room);
      if (roomsByName.size === HQ_TARGET_NAMES.length) break;
    }
  }

  for (const seed of MAINTENANCE_HQ_SEEDS) {
    const room = roomsByName.get(seed.roomName);
    const picked = room && mappedRoomCells(world, room).length > 0
      ? room
      : chooseMaintenanceHqFallbackRoom(world, seed.fallbackX, seed.fallbackY, usedRooms);
    if (!picked) continue;
    usedRooms.add(picked.id);
    hardenMaintenanceHqSeed(world, picked, seed.owner);
  }

  for (const name of SECONDARY_HQ_NAMES) {
    claimMaintenanceHqRoom(world, roomsByName.get(name), ZoneFaction.LIQUIDATOR);
  }
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function initializeMaintenanceTerritory(world: World, generationSeed: number): void {
  seedMaintenanceHqTerritory(world);
  initializeCellTerritory(world, {
    seed: generationSeed,
    targetShares: territorySharesForStoryFloor(FloorLevel.MAINTENANCE),
  });
}

function collectMaintenanceSpawnBuckets(world: World): MaintenanceSpawnBuckets {
  const owned = new Map<TerritoryOwner, number[]>();
  const hq = new Map<TerritoryOwner, number[]>();
  for (const def of MAINTENANCE_FACTION_SQUADS) {
    owned.set(def.owner, []);
    hq.set(def.owner, []);
  }
  const anchors = territoryHqAnchors(world);
  for (let idx = 0; idx < W * W; idx++) {
    if (world.cells[idx] !== Cell.FLOOR || world.aptMask[idx]) continue;
    const owner = territoryOwnerAtIndex(world, idx);
    const ownedCells = owned.get(owner);
    if (!ownedCells) continue;
    ownedCells.push(idx);
    const x = idx % W;
    const y = (idx / W) | 0;
    for (const anchor of anchors) {
      if (anchor.owner !== owner) continue;
      if (world.dist2(x, y, anchor.x, anchor.y) <= HQ_SPAWN_RADIUS2) {
        hq.get(owner)?.push(idx);
        break;
      }
    }
  }
  return { owned, hq };
}

function randomFloorCell(world: World): number {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const idx = rng(0, W * W - 1);
    if (world.cells[idx] === Cell.FLOOR && !world.aptMask[idx]) return idx;
  }
  return world.idx(W >> 1, W >> 1);
}

function pickMaintenanceSpawnCell(world: World, buckets: MaintenanceSpawnBuckets, owner: TerritoryOwner): number {
  const hqCells = buckets.hq.get(owner) ?? [];
  if (hqCells.length > 0 && Math.random() < 0.62) return pick(hqCells);
  const ownedCells = buckets.owned.get(owner) ?? [];
  if (ownedCells.length > 0) return pick(ownedCells);
  return randomFloorCell(world);
}

export function spawnMaintenanceFactionNpcSquads(world: World, entities: Entity[], nextId: number): number {
  let npcCount = 0;
  const npcTarget = entitySpawnSlots(entities, EntityType.NPC, activeActorCountAtDefaultSoftLimit(MAINTENANCE_NPC_TARGET_AT_DEFAULT_CAP));
  while (npcCount < npcTarget) {
    const prevCount = npcCount;
    for (const zone of world.zones) {
      if (npcCount >= npcTarget) break;
      const squadSize = rng(1, 4);
      const fDef = pick(MAINTENANCE_FACTION_SQUADS);
      for (let s = 0; s < squadSize && npcCount < npcTarget; s++) {
        let sx = -1, sy = -1;
        for (let r = 0; r < 30; r++) {
          const tx = world.wrap(zone.cx + rng(-r * 3, r * 3));
          const ty = world.wrap(zone.cy + rng(-r * 3, r * 3));
          const tci = world.idx(tx, ty);
          if (world.cells[tci] === Cell.FLOOR) {
            sx = tx; sy = ty;
            break;
          }
        }
        if (sx < 0) continue;
        const zoneLevel = zone.level ?? 5;
        const npcLevel = gaussianLevel(zoneLevel + 3, 3);
        const rpg = randomRPG(npcLevel);
        const maxHp = Math.round(getMaxHp(rpg) * 1.5);
        const nm = randomName(fDef.faction);
        const hasPsi = fDef.faction === Faction.CULTIST && Math.random() < 0.4;
        const psiWeapon = hasPsi ? pickPsi() : undefined;
        const weapon = psiWeapon ? 'knife' : undefined;
        const tool = psiWeapon;
        const inventory = psiWeapon ? [{ defId: 'knife', count: 1 }, { defId: psiWeapon, count: 1 }] : [];
        entities.push({
          id: nextId++, type: EntityType.NPC,
          x: sx + 0.5, y: sy + 0.5,
          angle: Math.random() * Math.PI * 2, pitch: 0,
          alive: true,
          speed: 1.4 + Math.random() * 0.4,
          sprite: fDef.occupation,
          name: nm.name,
          firstName: nm.firstName,
          lastName: nm.lastName,
          isFemale: nm.female,
          needs: freshNeeds(),
          hp: maxHp, maxHp,
          money: rng(10, 80),
          ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
          inventory,
          weapon,
          tool,
          faction: fDef.faction,
          occupation: fDef.occupation,
          isTraveler: true,
          questId: -1,
          rpg,
        });
        npcCount++;
      }
    }
    if (npcCount === prevCount) break;
  }
  return nextId;
}

export function relocateMaintenanceFactionNpcSquads(world: World, entities: Entity[], firstId: number, nextIdExclusive: number): void {
  const buckets = collectMaintenanceSpawnBuckets(world);
  for (const entity of entities) {
    if (entity.id < firstId || entity.id >= nextIdExclusive) continue;
    if (entity.type !== EntityType.NPC || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const spawnCell = pickMaintenanceSpawnCell(world, buckets, owner);
    entity.x = (spawnCell % W) + 0.5;
    entity.y = ((spawnCell / W) | 0) + 0.5;
    if (entity.ai) {
      entity.ai.tx = entity.x;
      entity.ai.ty = entity.y;
      entity.ai.path = [];
      entity.ai.pi = 0;
      entity.ai.stuck = 0;
    }
  }
}
