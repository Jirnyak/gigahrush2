/* ── Blood plant den: red mold stash, witnesses, root source ──── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  ContainerKind,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { registerBloodPlantRootSite } from '../../systems/blood_plant';
import { connectProtectedRoom, protectRoom, stampRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const ZONE_HUD = 35;
const ROOM_NAME = 'Красный притон плесени';
const ROOM_W = 21;
const ROOM_H = 13;
const DISTRIBUTOR_ID = 'blood_plant_senya_red_mold';
const WITNESS_ID = 'blood_plant_raya_witness';
const SPORE_KEEPER_ID = 'blood_plant_tikhon_spore';

const DEN_NPC_DEFS: Record<string, PlotNpcDef> = {
  [DISTRIBUTOR_ID]: {
    name: 'Сеня Красная Плесень',
    isFemale: false,
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    sprite: Occupation.PILGRIM,
    hp: 86, maxHp: 86, money: 32, speed: 0.9,
    weapon: 'knife',
    inventory: [{ defId: 'red_mold_sample', count: 1 }, { defId: 'knife', count: 1 }],
    talkLines: ['Красная проба греет лучше батареи. Только солью не трогай.'],
    talkLinesPost: ['Корень живой. Пока корень живой, притон дышит.'],
  },
  [WITNESS_ID]: {
    name: 'Рая Свидетельница',
    isFemale: true,
    faction: Faction.CITIZEN,
    occupation: Occupation.HOUSEWIFE,
    sprite: Occupation.HOUSEWIFE,
    hp: 86, maxHp: 86, money: 9, speed: 0.9,
    inventory: [{ defId: 'note', count: 1 }],
    talkLines: ['Я видела, как пробу продавали под видом счастливой плесени. Не ешь её.'],
    talkLinesPost: ['Если режешь корень - режь быстро. Он слушает.'],
  },
  [SPORE_KEEPER_ID]: {
    name: 'Тихон Споровой',
    isFemale: false,
    faction: Faction.CULTIST,
    occupation: Occupation.STOREKEEPER,
    sprite: Occupation.STOREKEEPER,
    hp: 86, maxHp: 86, money: 32, speed: 0.9,
    weapon: 'pipe',
    inventory: [{ defId: 'red_mold_sample', count: 1 }, { defId: 'knife', count: 1 }],
    talkLines: ['Плесень не товар. Плесень - сосед. За соседа платят заранее.'],
    talkLinesPost: ['Спрятал бы пробу глубже, да корень сам выбирает стену.'],
  },
};

for (const [id, def] of Object.entries(DEN_NPC_DEFS)) registerSideQuest(id, def, []);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (world.aptMask[world.idx(rx + dx, ry + dy)]) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 70; r += 5) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 7) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, ROOM_W, ROOM_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveDen(world: World, roomId: number, rx: number, ry: number): { room: Room; rootCells: number[] } {
  const room = stampRoom(world, roomId, RoomType.STORAGE, rx, ry, ROOM_W, ROOM_H, -1);
  room.name = ROOM_NAME;
  room.wallTex = Tex.ROTTEN;
  room.floorTex = Tex.F_TILE;
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = Tex.ROTTEN;
      if (dx >= 0 && dx < ROOM_W && dy >= 0 && dy < ROOM_H) {
        world.floorTex[ci] = Tex.F_TILE;
        world.light[ci] = Math.max(world.light[ci], 0.08);
      }
      world.features[ci] = Feature.NONE;
    }
  }

  const rootCells: number[] = [];
  const rootX = room.x + 12;
  for (let y = room.y + 2; y <= room.y + ROOM_H - 3; y++) {
    const ci = world.idx(rootX, y);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.ROTTEN;
    world.roomMap[ci] = room.id;
    rootCells.push(ci);
  }

  protectRoom(world, room.x, room.y, room.w, room.h, Tex.ROTTEN, Tex.F_TILE);
  connectProtectedRoom(world, room.x, room.y, room.w, room.h);
  return { room, rootCells };
}

function setFeature(world: World, room: Room, dx: number, dy: number, feature: Feature): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function nextContainerId(world: World): number {
  let id = world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
  while (world.containerById.has(id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  name: string,
  inventory: WorldContainer['inventory'],
  tags: string[],
  access: WorldContainer['access'] = 'public',
  owner?: Entity,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = Feature.SHELF;
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId: owner?.id,
    ownerName: owner?.name,
    faction: owner?.faction,
    access,
    discovered: true,
    tags: ['blood_plant_den', 'blood_plant', 'red_mold', 'contraband', ...tags],
  });
}

function spawnBloodPlant(world: World, entities: Entity[], nextId: { v: number }, room: Room): Entity {
  const def = MONSTERS[MonsterKind.BLOOD_PLANT];
  const x = room.x + 8;
  const y = room.y + 6;
  const zoneLevel = world.zones[world.zoneMap[world.idx(x, y)]]?.level ?? 3;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 1.08);
  const plant: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: monsterSpr(MonsterKind.BLOOD_PLANT),
    hp,
    maxHp: hp,
    name: 'Корень красного притона',
    monsterKind: MonsterKind.BLOOD_PLANT,
    attackCd: def.attackRate * 0.5,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
    spriteScale: 1.25,
  };
  entities.push(plant);
  return plant;
}

function spawnDenNpc(
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  x: number,
  y: number,
  weapon = '',
): Entity {
  const isWitness = plotNpcId === WITNESS_ID;
  return requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, x + 0.5, y + 0.5, {
    angle: Math.PI,
    weapon: weapon || undefined,
    canGiveQuest: false,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
    extra: {
      speed: scaleMonsterSpeed(0.9, 2),
      playerRelation: isWitness ? 0 : -35,
      ...(isWitness
        ? { inventory: [{ defId: 'note', count: 1, data: 'Свидетельская записка: красную пробу продавали под видом счастливой плесени.' }] }
        : {}),
    },
  });
}

function decorateDen(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  for (const [dx, dy, feature] of [
    [2, 2, Feature.LAMP],
    [4, 3, Feature.TABLE],
    [5, 6, Feature.SHELF],
    [7, 9, Feature.CANDLE],
    [10, 6, Feature.APPARATUS],
    [15, 4, Feature.SHELF],
    [17, 8, Feature.MACHINE],
    [19, 2, Feature.LAMP],
  ] as const) setFeature(world, room, dx, dy, feature);

  for (let i = 0; i < 12; i++) {
    const x = room.x + 4 + (i % 5);
    const y = room.y + 4 + ((i * 3) % 6);
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.68, 0.62, 151_000 + i * 41, 142, 14, 28, false);
  }

  const distributor = spawnDenNpc(entities, nextId, DISTRIBUTOR_ID, room.x + 4, room.y + 8, 'knife');
  spawnDenNpc(entities, nextId, WITNESS_ID, room.x + 3, room.y + 3);
  spawnDenNpc(entities, nextId, SPORE_KEEPER_ID, room.x + 9, room.y + 4, 'pipe');

  addContainer(world, room, 5, 6, 'Теплый ящик красной плесени', [
    { defId: 'red_mold_sample', count: 2 },
    { defId: 'govnyak_bad_batch', count: 1 },
  ], ['heal_source', 'social_infection', 'witnessed'], 'owner', distributor);
  addContainer(world, room, 2, ROOM_H - 3, 'Сухой аварийный ящик у порога', [
    { defId: 'rock_salt', count: 2 },
    { defId: 'ammo_fuel', count: 1 },
    { defId: 'fire_hook', count: 1 },
  ], ['counterplay', 'salt', 'fire', 'cut'], 'public');
  addContainer(world, room, 17, 6, 'Корневой тайник за красной стеной', [
    { defId: 'red_mold_sample', count: 1 },
    { defId: 'nii_sample_container', count: 1 },
    { defId: 'antifungal_ointment', count: 1 },
  ], ['root_locked', 'harvest', 'science'], 'secret');
}

export function generateBloodPlantDen(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zoneCx: number,
  zoneCy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zoneCx, zoneCy);
  const { room, rootCells } = carveDen(world, nextRoomId++, pos.x, pos.y);
  const plant = spawnBloodPlant(world, entities, nextId, room);
  decorateDen(world, entities, nextId, room);
  registerBloodPlantRootSite(world, {
    id: 'living_blood_plant_den_cut_path',
    plantIds: [plant.id],
    rootCells,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(Math.floor(plant.x), Math.floor(plant.y))],
  });
  world.bakeLights();
  genLog(`[BLOOD_PLANT] ${ROOM_NAME} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(ZONE_HUD, ROOM_NAME, generateBloodPlantDen);
