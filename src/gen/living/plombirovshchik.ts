/* -- Пломбировщик: local hermodoor route-denial encounter ------- */

import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Feature, FloorLevel,
  MonsterKind, RoomType, Tex, W, msg,
  type Entity, type GameState, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { setDoorState } from '../../systems/door_state';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { findClearArea, protectRoom } from '../shared';
import { genLog } from '../log';
import { registerZoneContent } from './zone_content';
import { isPlayerEntity } from '../../systems/player_actor';

const CONTENT_TAG = 'monster_02_plombirovshchik';
const ZONE_HUD = 62;
const MAIN_W = 14;
const BYPASS_W = 5;
const ROOM_H = 11;
const DIVIDER_W = 1;
const TOTAL_W = MAIN_W + DIVIDER_W + BYPASS_W;
const ROOM_NAME = 'Пломбировщик: шовная ремонтная';
const BYPASS_NAME = 'Пломбировщик: обход пломбы';
const KILL_AWAY_RADIUS2 = 3.4 * 3.4;
const SHOT_INTERRUPT_RADIUS2 = 8 * 8;
const MAX_CONTEXTS = 4;

const CUT_ITEMS = new Set(['knife', 'axe', 'liquidator_axe', 'wrench', 'hammer', 'sledgehammer', 'fire_hook', 'crowbar']);
const REPAIR_ITEMS = new Set(['sealant_tube', 'hermo_gasket']);

interface PlombContext {
  world: World;
  entities: Entity[];
  entitiesMap?: Map<number, Entity>;
  roomId: number;
  bypassRoomId: number;
  sealedDoorIdx: number;
  alternateDoorIdx: number;
  sealContainerId: number;
  monsterId: number;
  noticed: boolean;
  routeOpened: boolean;
  repaired: boolean;
  killHandled: boolean;
  shotHandled: boolean;
}

const contexts: PlombContext[] = [];

function registerContext(ctx: PlombContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.entitiesMap = ctx.entitiesMap;
    existing.sealedDoorIdx = ctx.sealedDoorIdx;
    existing.alternateDoorIdx = ctx.alternateDoorIdx;
    existing.sealContainerId = ctx.sealContainerId;
    existing.monsterId = ctx.monsterId;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > MAX_CONTEXTS) contexts.splice(0, contexts.length - MAX_CONTEXTS);
}

function doorX(idx: number): number {
  return idx % W;
}

function doorY(idx: number): number {
  return (idx / W) | 0;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  name: string,
  inventory: WorldContainer['inventory'],
  tags: string[],
): number {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const id = nextContainerId(world);
  world.addContainer({
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(wx, wy)],
    kind: ContainerKind.TOOL_LOCKER,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(6, inventory.length + 4),
    access: 'public',
    discovered: true,
    tags: [CONTENT_TAG, 'plombirovshchik', 'monster', 'seal', 'hermodoor', 'route_denial', ...tags],
  });
  return id;
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function carveFloor(world: World, room: Room): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = room.floorTex;
      world.wallTex[ci] = room.wallTex;
      world.roomMap[ci] = room.id;
      world.features[ci] = Feature.NONE;
      world.light[ci] = Math.max(world.light[ci], 0.06);
    }
  }
}

function addDoor(world: World, x: number, y: number, roomA: Room, roomB: Room | null, state: DoorState): number {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state, roomA: roomA.id, roomB: roomB?.id ?? -1, keyId: '', timer: 0 });
  roomA.doors.push(ci);
  if (roomB) roomB.doors.push(ci);
  return ci;
}

function carveTowardMaze(world: World, x: number, y: number, dx: number, dy: number, max = 88): void {
  let cx = world.wrap(x + dx);
  let cy = world.wrap(y + dy);
  for (let step = 0; step < max; step++) {
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cx = world.wrap(cx + dx);
    cy = world.wrap(cy + dy);
  }
}

function carveRooms(world: World, nextRoomId: number, rx: number, ry: number): { main: Room; bypass: Room; sealedDoorIdx: number; alternateDoorIdx: number } {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= TOTAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.HERMO_WALL;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const main: Room = {
    id: nextRoomId,
    type: RoomType.PRODUCTION,
    x: world.wrap(rx),
    y: world.wrap(ry),
    w: MAIN_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
  };
  const bypass: Room = {
    id: nextRoomId + 1,
    type: RoomType.CORRIDOR,
    x: world.wrap(rx + MAIN_W + DIVIDER_W),
    y: world.wrap(ry),
    w: BYPASS_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: BYPASS_NAME,
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[main.id] = main;
  world.rooms[bypass.id] = bypass;
  carveFloor(world, main);
  carveFloor(world, bypass);
  protectRoom(world, rx, ry, TOTAL_W, ROOM_H, Tex.HERMO_WALL, Tex.F_CONCRETE);

  const dividerX = world.wrap(rx + MAIN_W);
  for (let dy = 0; dy < ROOM_H; dy++) {
    const ci = world.idx(dividerX, ry + dy);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.HERMO_WALL;
    world.roomMap[ci] = -1;
  }

  const midY = world.wrap(ry + Math.floor(ROOM_H / 2));
  const sealedDoorIdx = addDoor(world, dividerX, midY, main, bypass, DoorState.LOCKED);
  const mainDoorIdx = addDoor(world, world.wrap(rx + 5), world.wrap(ry + ROOM_H), main, null, DoorState.CLOSED);
  const alternateDoorIdx = addDoor(world, world.wrap(bypass.x + bypass.w), midY, bypass, null, DoorState.OPEN);
  carveTowardMaze(world, doorX(mainDoorIdx), doorY(mainDoorIdx), 0, 1);
  carveTowardMaze(world, doorX(alternateDoorIdx), doorY(alternateDoorIdx), 1, 0);
  return { main, bypass, sealedDoorIdx, alternateDoorIdx };
}

function markSeal(world: World, doorIdx: number, seed: number, heavy: boolean): void {
  const x = doorX(doorIdx);
  const y = doorY(doorIdx);
  stampMark(world, x, y, 0.5, 0.5, heavy ? 0.5 : 0.34, MarkType.SPLAT, seed, 244, 241, 223, heavy ? 185 : 135, true);
  stampMark(world, x, y, 0.5, 0.5, heavy ? 0.36 : 0.24, MarkType.BULLET, seed + 17, 42, 38, 34, heavy ? 150 : 95, true);
}

function decorate(world: World, main: Room, bypass: Room, sealedDoorIdx: number): void {
  const rx = main.x;
  const ry = main.y;
  const midY = world.wrap(ry + Math.floor(main.h / 2));
  setFeature(world, rx + 1, ry + 1, Feature.LAMP);
  setFeature(world, rx + 3, ry + 2, Feature.SHELF);
  setFeature(world, rx + 6, ry + 2, Feature.APPARATUS);
  setFeature(world, rx + 8, ry + 3, Feature.MACHINE);
  setFeature(world, rx + 6, midY, Feature.TABLE);
  setFeature(world, rx + 7, midY, Feature.CHAIR);
  setFeature(world, rx + MAIN_W - 2, ry + ROOM_H - 2, Feature.SCREEN);
  setFeature(world, bypass.x + 2, bypass.y + 2, Feature.CANDLE);
  setFeature(world, bypass.x + 2, bypass.y + bypass.h - 3, Feature.SHELF);

  markSeal(world, sealedDoorIdx, 20_200, true);
  for (let dy = 1; dy < ROOM_H - 1; dy++) {
    if (dy % 2 === 0) stampMark(world, doorX(sealedDoorIdx) - 1, ry + dy, 0.5, 0.5, 0.18, MarkType.SPLAT, 20_260 + dy, 244, 241, 223, 82, true);
  }
  world.wallTex[world.idx(rx + MAIN_W - 2, ry - 1)] = Tex.SCREEN_BASE + 9;
}

function addDrop(entities: Entity[], nextId: { v: number }, x: number, y: number, defId: string, count = 1): void {
  const wx = ((Math.floor(x) % W) + W) % W;
  const wy = ((Math.floor(y) % W) + W) % W;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: wx + 0.5,
    y: wy + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnPlombirovshchik(world: World, entities: Entity[], nextId: { v: number }, room: Room, sealedDoorIdx: number): number {
  const def = MONSTERS[MonsterKind.SHOVNIK];
  const sx = world.wrap(room.x + room.w - 3);
  const sy = world.wrap(room.y + Math.floor(room.h / 2) - 1);
  const ci = world.idx(sx, sy);
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 2;
  const hp = Math.max(38, Math.round(scaleMonsterHp(def.hp, zoneLevel) * 0.95));
  const id = nextId.v++;
  const monster: Entity = {
    id,
    type: EntityType.MONSTER,
    x: sx + 0.5,
    y: sy + 0.5,
    angle: Math.atan2((doorY(sealedDoorIdx) + 0.5) - (sy + 0.5), (doorX(sealedDoorIdx) + 0.5) - (sx + 0.5)),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed * 0.92, zoneLevel),
    sprite: monsterSpr(MonsterKind.SHOVNIK),
    hp,
    maxHp: hp,
    name: 'Пломбировщик',
    monsterKind: MonsterKind.SHOVNIK,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: doorX(sealedDoorIdx), ty: doorY(sealedDoorIdx), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  entities.push(monster);
  return id;
}

function publishPlombEvent(
  state: GameState,
  ctx: PlombContext,
  type: 'monster_sighted' | 'door_opened' | 'door_sealed' | 'hermodoor_borer_repaired' | 'death_seen',
  severity: 3 | 4 | 5,
  tags: string[],
  data: Record<string, unknown> = {},
): void {
  publishEvent(state, {
    type,
    floor: FloorLevel.LIVING,
    zoneId: ctx.world.zoneMap[ctx.sealedDoorIdx],
    roomId: ctx.roomId,
    x: doorX(ctx.sealedDoorIdx) + 0.5,
    y: doorY(ctx.sealedDoorIdx) + 0.5,
    actorId: ctx.monsterId,
    actorName: 'Пломбировщик',
    targetId: ctx.sealedDoorIdx,
    targetName: 'белая пломба гермодвери',
    monsterKind: MonsterKind.SHOVNIK,
    severity,
    privacy: 'local',
    tags: ['monster', 'plombirovshchik', 'seal', 'hermodoor', 'route_denial', ...tags].slice(0, 8),
    data: {
      contentId: CONTENT_TAG,
      roomName: ROOM_NAME,
      bypassRoomName: BYPASS_NAME,
      sealedDoorIdx: ctx.sealedDoorIdx,
      alternateDoorIdx: ctx.alternateDoorIdx,
      ...data,
    },
  });
}

function openSealedDoor(ctx: PlombContext, state: GameState): boolean {
  const door = ctx.world.doors.get(ctx.sealedDoorIdx);
  if (!door || door.state === DoorState.OPEN || door.state === DoorState.HERMETIC_OPEN) return false;
  setDoorState(ctx.world, door, DoorState.HERMETIC_OPEN);
  door.timer = 0;
  ctx.routeOpened = true;
  markSeal(ctx.world, ctx.sealedDoorIdx, 30_200 + Math.floor(state.time), false);
  return true;
}

function contextByContainer(event: WorldEvent): PlombContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.sealContainerId === event.containerId) return ctx;
  }
  return undefined;
}

function contextByMonster(event: WorldEvent): PlombContext | undefined {
  if (event.targetId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.monsterId === event.targetId) return ctx;
  }
  return undefined;
}

function nearestActiveContextToPlayer(): PlombContext | undefined {
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (!ctx.entitiesMap) {
      ctx.entitiesMap = new Map();
      for (let j = 0; j < ctx.entities.length; j++) {
        ctx.entitiesMap.set(ctx.entities[j].id, ctx.entities[j]);
      }
    }
    const monster = ctx.entitiesMap.get(ctx.monsterId);
    if (!monster?.alive || ctx.shotHandled || ctx.routeOpened) continue;

    let player = undefined;
    for (let j = ctx.entities.length - 1; j >= 0; j--) {
      const e = ctx.entities[j];
      if (isPlayerEntity(e) && e.alive) {
        player = e;
        break;
      }
    }
    if (!player) continue;
    const dDoor = ctx.world.dist2(player.x, player.y, doorX(ctx.sealedDoorIdx) + 0.5, doorY(ctx.sealedDoorIdx) + 0.5);
    const dMonster = ctx.world.dist2(player.x, player.y, monster.x, monster.y);
    if (Math.min(dDoor, dMonster) <= SHOT_INTERRUPT_RADIUS2) return ctx;
  }
  return undefined;
}

function handleSealContainerEvent(state: GameState, event: WorldEvent): void {
  if (!event.tags.includes(CONTENT_TAG)) return;
  const ctx = contextByContainer(event);
  if (!ctx) return;

  if ((event.type === 'container_opened' || event.type === 'item_stolen') && !ctx.noticed) {
    ctx.noticed = true;
    state.msgs.push(msg('Пахнет свежей резиной. Белая пломба закрыла прямой проход, обход справа еще открыт.', state.time, '#f4e7b0'));
    publishPlombEvent(state, ctx, 'monster_sighted', 4, ['warning', 'noticed'], {
      warning: 'fresh rubber smell, white sealant line, ticking handle',
      itemId: event.itemId,
    });
    return;
  }

  if (event.type !== 'item_deposited' || !event.itemId) return;
  if (CUT_ITEMS.has(event.itemId)) {
    const opened = openSealedDoor(ctx, state);
    state.msgs.push(msg(opened ? 'Пломба срезана. Прямой шовный ход снова открыт.' : 'Пломба уже не держит проход.', state.time, '#9f8'));
    publishPlombEvent(state, ctx, 'door_opened', opened ? 4 : 3, ['broken', 'cut'], {
      itemId: event.itemId,
      sourceEventId: event.id,
    });
  } else if (REPAIR_ITEMS.has(event.itemId)) {
    const opened = openSealedDoor(ctx, state);
    ctx.repaired = true;
    state.msgs.push(msg(opened ? 'Герметик схватился правильно: ручка перестала тикать.' : 'Ремонтная пломба уже держит ровно.', state.time, '#8f8'));
    publishPlombEvent(state, ctx, 'hermodoor_borer_repaired', opened ? 4 : 3, ['repaired'], {
      itemId: event.itemId,
      sourceEventId: event.id,
    });
  }
}

function handleKillEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'player_kill_monster') return;
  const ctx = contextByMonster(event);
  if (!ctx || ctx.killHandled) return;
  ctx.killHandled = true;

  if (!ctx.entitiesMap) {
    ctx.entitiesMap = new Map();
    for (let j = 0; j < ctx.entities.length; j++) {
      ctx.entitiesMap.set(ctx.entities[j].id, ctx.entities[j]);
    }
  }
  const killed = ctx.entitiesMap.get(ctx.monsterId);
  const ex = event.x ?? killed?.x ?? doorX(ctx.sealedDoorIdx) + 0.5;
  const ey = event.y ?? killed?.y ?? doorY(ctx.sealedDoorIdx) + 0.5;
  const d2 = ctx.world.dist2(ex, ey, doorX(ctx.sealedDoorIdx) + 0.5, doorY(ctx.sealedDoorIdx) + 0.5);
  if (d2 > KILL_AWAY_RADIUS2) {
    const opened = openSealedDoor(ctx, state);
    state.msgs.push(msg(opened ? 'Пломбировщик умер вдали от шва. Пломба отлипла от ручки.' : 'Пломбировщик мёртв; шов уже свободен.', state.time, '#9f8'));
    publishPlombEvent(state, ctx, 'door_opened', 4, ['threat_killed', 'killed_away'], {
      sourceEventId: event.id,
      killDistance2: Math.round(d2 * 100) / 100,
    });
  } else {
    state.msgs.push(msg('Пломбировщик умер прямо в шве. Дверь закусило; обход справа остаётся открытым.', state.time, '#fa4'));
    publishPlombEvent(state, ctx, 'door_sealed', 4, ['threat_killed', 'killed_at_seam'], {
      sourceEventId: event.id,
      killDistance2: Math.round(d2 * 100) / 100,
    });
  }
}

function handleShotEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'ammo_consumed' || state.currentFloor !== FloorLevel.LIVING) return;
  const ctx = nearestActiveContextToPlayer();
  if (!ctx) return;
  ctx.shotHandled = true;
  const opened = openSealedDoor(ctx, state);
  if (!opened) return;
  state.msgs.push(msg('Громкий выстрел сорвал тик пломбы. Дверь можно пройти, пока состав сырой.', state.time, '#fc8'));
  publishPlombEvent(state, ctx, 'door_opened', 4, ['shot_interrupt', 'broken'], {
    sourceEventId: event.id,
    itemId: event.itemId,
  });
}

function handlePlombirovshchikEvents(state: GameState, event: WorldEvent): void {
  if (state.currentFloor !== FloorLevel.LIVING) return;
  handleSealContainerEvent(state, event);
  handleKillEvent(state, event);
  handleShotEvent(state, event);
}

registerWorldEventObserver(handlePlombirovshchikEvents);

export function generatePlombirovshchik(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findClearArea(world, Math.floor(zcx), Math.floor(zcy), TOTAL_W, ROOM_H, 70, 230)
    ?? { x: world.wrap(Math.floor(zcx - TOTAL_W / 2)), y: world.wrap(Math.floor(zcy - ROOM_H / 2)) };
  const { main, bypass, sealedDoorIdx, alternateDoorIdx } = carveRooms(world, nextRoomId, pos.x, pos.y);
  decorate(world, main, bypass, sealedDoorIdx);

  const sealContainerId = addContainer(
    world,
    main,
    main.x + MAIN_W - 3,
    main.y + Math.floor(main.h / 2) + 1,
    'Белая пломба на тикающей ручке',
    [{ defId: 'note', count: 1 }],
    ['seal_notice', 'repair_target', 'counterplay'],
  );
  addContainer(
    world,
    bypass,
    bypass.x + 2,
    bypass.y + bypass.h - 2,
    'Ремонтный ящик за обходом',
    [
      { defId: 'hermo_gasket', count: 1 },
      { defId: 'sealant_tube', count: 1 },
    ],
    ['reward', 'bypass'],
  );

  addDrop(entities, nextId, main.x + 4, main.y + main.h - 2, 'knife');
  addDrop(entities, nextId, main.x + 5, main.y + main.h - 2, 'sealant_tube');
  const monsterId = spawnPlombirovshchik(world, entities, nextId, main, sealedDoorIdx);
  registerContext({
    world,
    entities,
    roomId: main.id,
    bypassRoomId: bypass.id,
    sealedDoorIdx,
    alternateDoorIdx,
    sealContainerId,
    monsterId,
    noticed: false,
    routeOpened: false,
    repaired: false,
    killHandled: false,
    shotHandled: false,
  });
  world.bakeLights();

  genLog(`[MONSTER_02] ${ROOM_NAME} at (${main.x}, ${main.y}) room #${main.id}, bypass #${bypass.id}, sealed door (${doorX(sealedDoorIdx)}, ${doorY(sealedDoorIdx)})`);
  return { nextRoomId: bypass.id + 1 };
}

registerZoneContent(ZONE_HUD, 'Пломбировщик: локальная пломба двери', generatePlombirovshchik);
