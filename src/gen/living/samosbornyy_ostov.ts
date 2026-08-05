/* -- Monster 15: Самосборный Остов corpse/loot-risk scene ------- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, QuestType, RoomType, Tex,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { connectProtectedRoom, protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

export const SAMOSBORNYY_OSTOV_ID = 'samosbornyy_ostov' as const;
export const SAMOSBORNYY_OSTOV_ROOM_PREFIX = 'Самосборный Остов' as const;
export const SAMOSBORNYY_OSTOV_ZONE = 64 as const;
export const SAMOSBORNYY_OSTOV_METADATA = {
  id: SAMOSBORNYY_OSTOV_ID,
  floor: 'living',
  zoneHudId: SAMOSBORNYY_OSTOV_ZONE,
  zoneTitle: SAMOSBORNYY_OSTOV_ROOM_PREFIX,
  reachability: 'living_content_manifest_zone_64',
  samosbor: 'protected_room_apt_mask_connect_protected_room',
  performance: 'generation_time_19x13_room_one_npc_one_zombie_three_containers',
} as const;

const ROOM_W = 19;
const ROOM_H = 13;
const SEAL_X = 8;
const SEAL_DOOR_Y = 6;
export const SAMOSBORNYY_OSTOV_LIQUIDATOR_ID = 'samosbornyy_ostov_liquidator' as const;

const LIQUIDATOR_DEF: PlotNpcDef = {
  name: 'Павел Сухой Обход',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: Occupation.HUNTER,
  hp: 190,
  maxHp: 190,
  money: 64,
  speed: 0.88,
  inventory: [
    { defId: 'bandage', count: 2 },
    { defId: 'ammo_fuel', count: 1 },
    { defId: 'liquidator_token', count: 1 },
  ],
  talkLines: [
    'Труп после самосбора не трогают руками. Сначала смотрят грудь, пальцы и пыль на простыне.',
    'Мух нет, а карманы целые. Значит, у койки есть причина, почему ее не разобрали до нас.',
    'Хочешь безопасно - оставь тело, сдай записку или дай топливо на прожиг.',
    'Хочешь быстро - открывай гермодверь и бей с расстояния. Только не называй это лутом.',
  ],
  talkLinesPost: [
    'Остов записан. Если полезешь внутрь, это уже не находка, а решение.',
    'Жадность хороша, когда успеваешь закрыть за ней дверь.',
  ],
  talkQuestResponse: 'Принял. Пока тело за дверью, у тебя ещё есть выбор.',
};

registerSideQuest(SAMOSBORNYY_OSTOV_LIQUIDATOR_ID, LIQUIDATOR_DEF, [
  {
    id: 'samosbornyy_ostov_report',
    giverNpcId: SAMOSBORNYY_OSTOV_LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Павел Сухой Обход: «Сними записку с двери и сдай мне. Не каждую добычу надо проверять руками.»',
    targetItem: 'note',
    targetCount: 1,
    rewardItem: 'bandage',
    rewardCount: 2,
    extraRewards: [{ defId: 'liquidator_ration', count: 1 }],
    relationDelta: 9,
    xpReward: 35,
    moneyReward: 24,
    eventTags: [SAMOSBORNYY_OSTOV_ID, 'reported', 'monster', 'corpse', 'loot_risk', 'liquidator'],
    eventData: {
      outcome: 'reported_without_disturbing',
      counterplay: ['inspect', 'leave_for_liquidators'],
      rumorIds: ['monster_zombie_human', 'faction_liquidator_patrol'],
    },
  },
  {
    id: 'samosbornyy_ostov_burn',
    giverNpcId: SAMOSBORNYY_OSTOV_LIQUIDATOR_ID,
    type: QuestType.FETCH,
    desc: 'Павел Сухой Обход: «Принеси канистру бензина. Остов лучше сжечь по акту, чем будить по жадности.»',
    targetItem: 'ammo_fuel',
    targetCount: 1,
    rewardItem: 'liquidator_token',
    rewardCount: 1,
    extraRewards: [{ defId: 'bandage', count: 1 }],
    relationDelta: 8,
    xpReward: 42,
    moneyReward: 35,
    eventTags: [SAMOSBORNYY_OSTOV_ID, 'burned', 'fire', 'counterplay', 'corpse', 'loot_risk'],
    eventData: {
      outcome: 'burned_by_liquidators',
      counterplay: ['fire', 'safe_disposal'],
      rumorIds: ['monster_zombie_human', 'samosbor_meat_variant'],
    },
  },
]);

function areaClear(world: World, rx: number, ry: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) return false;
    }
  }
  return true;
}

function findOrigin(world: World, zcx: number, zcy: number): { x: number; y: number } {
  const baseX = zcx - Math.floor(ROOM_W / 2);
  const baseY = zcy - Math.floor(ROOM_H / 2);
  for (let r = 0; r <= 80; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = ((k + 17) / 24) * Math.PI * 2;
      const x = world.wrap(baseX + Math.round(Math.cos(a) * r));
      const y = world.wrap(baseY + Math.round(Math.sin(a) * r));
      if (areaClear(world, x, y, ROOM_W, ROOM_H)) return { x, y };
    }
  }
  return { x: world.wrap(baseX), y: world.wrap(baseY) };
}

function carveRoom(world: World, roomId: number, rx: number, ry: number): Room {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.HERMO_WALL;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const room: Room = {
    id: roomId,
    type: RoomType.MEDICAL,
    x: rx,
    y: ry,
    w: ROOM_W,
    h: ROOM_H,
    doors: [],
    sealed: true,
    name: `${SAMOSBORNYY_OSTOV_ROOM_PREFIX}: послесамосборная койка`,
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_TILE,
  };
  world.rooms[roomId] = room;

  for (let dy = 0; dy < ROOM_H; dy++) {
    for (let dx = 0; dx < ROOM_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
      world.roomMap[ci] = roomId;
      world.features[ci] = Feature.NONE;
    }
  }

  protectRoom(world, rx, ry, ROOM_W, ROOM_H, Tex.HERMO_WALL, Tex.F_TILE);
  connectProtectedRoom(world, rx, ry, ROOM_W, ROOM_H);
  return room;
}

function addHermeticSplit(world: World, room: Room): void {
  const wallX = world.wrap(room.x + SEAL_X);
  for (let dy = 1; dy < ROOM_H - 1; dy++) {
    const y = world.wrap(room.y + dy);
    const ci = world.idx(wallX, y);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.HERMO_WALL;
    world.roomMap[ci] = -1;
    world.features[ci] = Feature.NONE;
    world.hermoWall[ci] = 1;
  }

  const doorY = world.wrap(room.y + SEAL_DOOR_Y);
  const di = world.idx(wallX, doorY);
  world.cells[di] = Cell.DOOR;
  world.wallTex[di] = Tex.HERMO_WALL;
  world.floorTex[di] = Tex.F_TILE;
  world.roomMap[di] = room.id;
  world.features[di] = Feature.NONE;
  world.hermoWall[di] = 1;
  world.doors.set(di, {
    idx: di,
    state: DoorState.HERMETIC_CLOSED,
    roomA: room.id,
    roomB: room.id,
    keyId: '',
    timer: 0,
  });
  room.doors.push(di);
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addDrop(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  count = 1,
  data?: unknown,
): void {
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
  });
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  dx: number,
  dy: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: WorldContainer['inventory'],
  tags: string[],
  faction?: Faction,
  ownerNpcId?: number,
  ownerName?: string,
): void {
  const x = world.wrap(room.x + dx);
  const y = world.wrap(room.y + dy);
  const ci = world.idx(x, y);
  world.addContainer({
    id: nextContainerId(world),
    x,
    y,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(6, inventory.length + 3),
    ownerNpcId,
    ownerName,
    faction,
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: true,
    tags,
  });
}

function suspiciousCorpseInventory(room: Room): WorldContainer['inventory'] {
  const inventory: WorldContainer['inventory'] = [
    { defId: 'bandage', count: 2 },
    { defId: 'rawmeat', count: 1 },
    {
      defId: 'note',
      count: 1,
      data: 'Лут слишком чистый. Пыль на простыне сбита, мух нет, пальцы у тела свежие. Если берешь - бей первым или жги.',
    },
  ];
  if ((room.id + room.x + room.y) % 4 === 0) inventory.push({ defId: 'samosbor_tally', count: 1 });
  return inventory;
}

function spawnLiquidator(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
): number {
  const existing = entities.find(e => e.alive && e.plotNpcId === SAMOSBORNYY_OSTOV_LIQUIDATOR_ID);
  if (existing) return existing.id;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, SAMOSBORNYY_OSTOV_LIQUIDATOR_ID, x + 0.5, y + 0.5, {
    angle: 0,
    weapon: 'makarov',
    canGiveQuest: true,
    aiTarget: { x, y },
    extra: { isTraveler: false },
  });
  return npc.id;
}

function spawnOstov(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const x = world.wrap(room.x + 13);
  const y = world.wrap(room.y + 7);
  const def = MONSTERS[MonsterKind.ZOMBIE];
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: def.speed * 0.9,
    sprite: monsterSpr(MonsterKind.ZOMBIE),
    name: 'Самосборный Остов',
    hp: Math.round(def.hp * 1.35),
    maxHp: Math.round(def.hp * 1.35),
    monsterKind: MonsterKind.ZOMBIE,
    attackCd: 0,
    ai: {
      goal: AIGoal.WANDER,
      tx: world.wrap(room.x + 12),
      ty: world.wrap(room.y + 6),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
    },
    inventory: [
      { defId: 'rawmeat', count: 1 },
      { defId: 'note', count: 1, data: 'Остов не был трупом. Он был инвентарем, который дождался рук.' },
    ],
  });
}

function decorateRoom(world: World, room: Room): void {
  const rx = room.x;
  const ry = room.y;

  for (const [dx, dy, feature] of [
    [1, 1, Feature.LAMP],
    [5, 1, Feature.LAMP],
    [2, 3, Feature.DESK],
    [3, 3, Feature.CHAIR],
    [5, 4, Feature.SHELF],
    [6, 9, Feature.APPARATUS],
    [10, 2, Feature.SCREEN],
    [11, 5, Feature.BED],
    [12, 5, Feature.BED],
    [13, 5, Feature.APPARATUS],
    [15, 5, Feature.BED],
    [16, 8, Feature.SINK],
    [11, 9, Feature.SHELF],
    [16, 10, Feature.LAMP],
  ] as const) {
    setFeature(world, world.wrap(rx + dx), world.wrap(ry + dy), feature);
  }

  for (let dy = 2; dy < ROOM_H - 2; dy++) {
    for (let dx = 10; dx < ROOM_W - 1; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      world.floorTex[ci] = dx >= 11 && dy >= 4 && dy <= 8 ? Tex.F_GUT : Tex.F_TILE;
      world.fog[ci] = Math.max(world.fog[ci], dx >= 11 ? 38 : 12);
    }
  }

  world.wallTex[world.idx(rx + 2, ry - 1)] = Tex.POSTER_BASE + 15;
  world.wallTex[world.idx(rx + 10, ry - 1)] = Tex.SCREEN_BASE + 6;
  stampSurfaceSplat(world, rx + 12, ry + 6, 0.5, 0.5, 3.7, 0.58, 15015, 22, 16, 24, false);
  stampSurfaceSplat(world, rx + 15, ry + 8, 0.5, 0.5, 2.4, 0.42, 15016, 12, 10, 16, false);
  stampSurfaceSplat(world, rx + 6, ry + 7, 0.5, 0.5, 1.8, 0.22, 15017, 140, 128, 96, false);
  world.markFogDirty();
  world.markFloorTexDirty();
}

function seedScene(world: World, room: Room, entities: Entity[], nextId: { v: number }, liquidatorId: number): void {
  addDrop(
    entities,
    nextId,
    world.wrap(room.x + 3),
    world.wrap(room.y + 5),
    'note',
    1,
    'Записка обхода: Лут слишком чистый. Тело за гермодверью без мух, пыль на простыне сбита, карманы слишком целые. Не лезь без огня или дистанции.',
  );

  addContainer(
    world,
    room,
    3,
    9,
    ContainerKind.EMERGENCY_BOX,
    'Осмотренный набор у двери',
    'public',
    [
      { defId: 'bandage', count: 1 },
      { defId: 'filtered_water', count: 1 },
    ],
    [SAMOSBORNYY_OSTOV_ID, 'safely_looted', 'corpse', 'aftermath', 'loot_risk', 'safe_option'],
    Faction.LIQUIDATOR,
    liquidatorId,
    LIQUIDATOR_DEF.name,
  );
  addContainer(
    world,
    room,
    6,
    9,
    ContainerKind.TRASH_BIN,
    'Жаровня ликвидаторского акта',
    'public',
    [],
    [SAMOSBORNYY_OSTOV_ID, 'burned', 'fire', 'counterplay', 'corpse', 'loot_risk', 'sabotage_drop'],
    Faction.LIQUIDATOR,
    liquidatorId,
    LIQUIDATOR_DEF.name,
  );
  addContainer(
    world,
    room,
    12,
    6,
    ContainerKind.SECRET_STASH,
    'Слишком чистый трупный узел',
    'public',
    suspiciousCorpseInventory(room),
    [SAMOSBORNYY_OSTOV_ID, 'disturbed', 'monster', 'corpse', 'loot_risk', 'aftermath'],
  );
}

export function generateSamosbornyyOstov(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findOrigin(world, zcx, zcy);
  const room = carveRoom(world, nextRoomId++, pos.x, pos.y);
  addHermeticSplit(world, room);
  decorateRoom(world, room);
  const liquidatorId = spawnLiquidator(entities, nextId, world.wrap(room.x + 4), world.wrap(room.y + 4));
  seedScene(world, room, entities, nextId, liquidatorId);
  spawnOstov(world, entities, nextId, room);
  genLog(`[MONSTER_15] ${room.name} at (${room.x}, ${room.y}) room #${room.id}`);
  return { nextRoomId };
}

registerZoneContent(SAMOSBORNYY_OSTOV_ZONE, SAMOSBORNYY_OSTOV_ROOM_PREFIX, generateSamosbornyyOstov);
