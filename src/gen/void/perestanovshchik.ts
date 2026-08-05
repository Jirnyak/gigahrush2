/* ── Перестановщик — local topology anomaly chamber ───────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  W,
  MonsterKind,
  RoomType,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Room,
  type WorldContainer,
  type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';

export const PERESTANOVSHCHIK_ID = 'perestanovshchik' as const;

const CHAMBER_CONTEXT_CAP = 8;
const ANCHOR_TAG = 'anchor_disable';

interface PerestanovshchikPair {
  sourceIdx: number;
  targetIdx: number;
}

interface PerestanovshchikContext {
  world: World;
  roomId: number;
  anchorIdx: number;
  anchorContainerId: number;
  pairs: PerestanovshchikPair[];
  disabled: boolean;
}

const contexts: PerestanovshchikContext[] = [];

function setVoidRoomTextures(world: World, room: Room): void {
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) world.floorTex[ci] = Tex.F_VOID;
      else world.wallTex[ci] = Tex.VOID_WALL;
    }
  }
}

function openDoor(world: World, x: number, y: number): void {
  const door = world.doors.get(world.idx(x, y));
  if (!door) return;
  door.state = DoorState.OPEN;
  door.timer = 0;
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
  inventory: Item[],
  tags: string[],
): number {
  const id = nextContainerId(world);
  const ci = world.idx(x, y);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
  return id;
}

function dropNote(entities: Entity[], nextId: { v: number }, x: number, y: number, text: string): void {
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
    inventory: [{ defId: 'note', count: 1, data: { text } }],
  });
}

function spawnLoopThreat(world: World, entities: Entity[], nextId: { v: number }, room: Room): void {
  const kind = MonsterKind.SHADOW;
  const def = MONSTERS[kind];
  const x = room.x + (room.w >> 1);
  const y = room.y + (room.h >> 1);
  const level = Math.max(10, world.zones[world.zoneMap[world.idx(x, y)]]?.level ?? 10);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp * 0.78, level)));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed * 0.9, level),
    sprite: monsterSpr(kind),
    name: 'Переставленный жилец',
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function cellInRoom(world: World, room: Room, dx: number, dy: number): number {
  const x = world.wrap(room.x + Math.max(1, Math.min(room.w - 2, dx)));
  const y = world.wrap(room.y + Math.max(1, Math.min(room.h - 2, dy)));
  return world.idx(x, y);
}

function markPairCell(world: World, idx: number, seed: number, safe: boolean): void {
  const x = idx % W;
  const y = (idx / W) | 0;
  world.features[idx] = Feature.SCREEN;
  world.floorTex[idx] = Tex.F_VOID;
  world.fog[idx] = Math.max(world.fog[idx], safe ? 18 : 46);
  stampSurfaceSplat(world, x, y, 0.5, 0.5, safe ? 0.34 : 0.52, safe ? 0.55 : 0.82, seed, safe ? 90 : 160, safe ? 210 : 80, safe ? 180 : 210, false);
}

function addTeleportPair(world: World, sourceIdx: number, targetIdx: number, seed: number, safe: boolean): PerestanovshchikPair {
  world.anomalyTeleports.set(sourceIdx, targetIdx);
  world.anomalyTeleports.set(targetIdx, sourceIdx);
  markPairCell(world, sourceIdx, seed, safe);
  markPairCell(world, targetIdx, seed + 17, safe);
  return { sourceIdx, targetIdx };
}

function connectEastWest(world: World, west: Room, east: Room): void {
  const wy = west.y + (west.h >> 1);
  const ey = east.y + (east.h >> 1);
  placeDoorAt(world, west.x + west.w, wy, west.id);
  placeDoorAt(world, east.x - 1, ey, east.id);
  openDoor(world, west.x + west.w, wy);
  openDoor(world, east.x - 1, ey);
  carveCorridor(world, west.x + west.w + 1, wy, east.x - 2, ey);
}

function connectSouthNorth(world: World, north: Room, south: Room): void {
  const nx = north.x + (north.w >> 1);
  const sx = south.x + (south.w >> 1) - 1;
  placeDoorAt(world, nx, north.y + north.h, north.id);
  placeDoorAt(world, sx, south.y - 1, south.id);
  openDoor(world, nx, north.y + north.h);
  openDoor(world, sx, south.y - 1);
  carveCorridor(world, nx, north.y + north.h + 1, sx, south.y - 2);
}

function registerContext(ctx: PerestanovshchikContext): void {
  const existing = contexts.find(c => c.world === ctx.world && c.roomId === ctx.roomId);
  if (existing) {
    existing.anchorIdx = ctx.anchorIdx;
    existing.anchorContainerId = ctx.anchorContainerId;
    existing.pairs = ctx.pairs;
    existing.disabled = ctx.disabled;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > CHAMBER_CONTEXT_CAP) contexts.splice(0, contexts.length - CHAMBER_CONTEXT_CAP);
}

function contextForEvent(event: WorldEvent): PerestanovshchikContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    if (
      contexts[i].anchorContainerId === event.containerId &&
      (event.roomId === undefined || event.roomId === contexts[i].roomId)
    ) return contexts[i];
  }
  return undefined;
}

function disablePerestanovshchikAnchor(ctx: PerestanovshchikContext): number {
  let removed = 0;
  for (const pair of ctx.pairs) {
    if (ctx.world.anomalyTeleports.get(pair.sourceIdx) === pair.targetIdx) {
      ctx.world.anomalyTeleports.delete(pair.sourceIdx);
      removed++;
    }
    if (ctx.world.anomalyTeleports.get(pair.targetIdx) === pair.sourceIdx) {
      ctx.world.anomalyTeleports.delete(pair.targetIdx);
      removed++;
    }
    ctx.world.features[pair.sourceIdx] = Feature.NONE;
    ctx.world.features[pair.targetIdx] = Feature.NONE;
    ctx.world.floorTex[pair.sourceIdx] = Tex.F_CONCRETE;
    ctx.world.floorTex[pair.targetIdx] = Tex.F_CONCRETE;
  }
  ctx.world.features[ctx.anchorIdx] = Feature.MACHINE;
  stampSurfaceSplat(ctx.world, ctx.anchorIdx % W, (ctx.anchorIdx / W) | 0, 0.5, 0.5, 0.92, 0.7, ctx.anchorIdx ^ 0x17, 35, 245, 180, false);
  ctx.world.markFloorTexDirty();
  ctx.world.markFogDirty();
  const room = ctx.world.rooms[ctx.roomId];
  if (room && !room.name.includes('якорь снят')) room.name = `${room.name}; якорь снят`;
  ctx.disabled = true;
  return removed;
}

function observeAnchorEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  const ctx = contextForEvent(event);
  if (!ctx || ctx.disabled) return;
  const removedLinks = disablePerestanovshchikAnchor(ctx);
  state.msgs.push(msg('Якорь Перестановщика сорван. Повторные двери стали просто дверями.', state.time, '#8cf'));
  publishEvent(state, {
    type: 'elevator_loop_exit',
    zoneId: event.zoneId,
    roomId: ctx.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    severity: 4,
    privacy: 'local',
    tags: ['monster', 'topology', 'teleport', 'route', PERESTANOVSHCHIK_ID, 'anchor'],
    data: {
      monsterId: PERESTANOVSHCHIK_ID,
      ruName: 'Перестановщик',
      outcome: 'anchor_disabled',
      removedLinks,
      sourceCells: ctx.pairs.map(pair => pair.sourceIdx),
      rewardItem: event.itemId,
    },
  });
}

registerWorldEventObserver(observeAnchorEvent);

export function generatePerestanovshchik(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const site = findClearArea(world, sx, sy, 42, 34, 38, 92) ?? {
    x: world.wrap(sx + 54),
    y: world.wrap(sy + 22),
  };

  const entry = stampRoom(world, world.rooms.length, RoomType.CORRIDOR, site.x, site.y + 8, 17, 11, -1);
  entry.name = 'Перестановщик: две двери 36';
  setVoidRoomTextures(world, entry);

  const anchor = stampRoom(world, world.rooms.length, RoomType.OFFICE, site.x + 25, site.y + 9, 13, 9, -1);
  anchor.name = 'Перестановщик: якорная 35/37';
  setVoidRoomTextures(world, anchor);

  const loop = stampRoom(world, world.rooms.length, RoomType.STORAGE, site.x + 4, site.y + 24, 14, 8, -1);
  loop.name = 'Боковая комната 36';
  setVoidRoomTextures(world, loop);

  const entryDoorY = entry.y + (entry.h >> 1);
  placeDoorAt(world, entry.x - 1, entryDoorY, entry.id);
  openDoor(world, entry.x - 1, entryDoorY);
  carveCorridor(world, sx, sy, entry.x - 2, entryDoorY);
  connectEastWest(world, entry, anchor);
  connectSouthNorth(world, entry, loop);

  world.features[cellInRoom(world, entry, 2, 2)] = Feature.LAMP;
  world.features[cellInRoom(world, entry, 14, 8)] = Feature.CANDLE;
  world.features[cellInRoom(world, anchor, 2, 2)] = Feature.LAMP;
  world.features[cellInRoom(world, loop, loop.w - 3, 2)] = Feature.SHELF;

  const anchorIdx = cellInRoom(world, anchor, anchor.w >> 1, anchor.h >> 1);
  world.features[anchorIdx] = Feature.APPARATUS;
  stampSurfaceSplat(world, anchorIdx % W, (anchorIdx / W) | 0, 0.5, 0.5, 1.2, 0.78, 170017, 32, 230, 180, false);

  const safeSource = cellInRoom(world, entry, 12, 5);
  const safeTarget = cellInRoom(world, anchor, 3, 4);
  const loopSource = cellInRoom(world, entry, 5, 5);
  const loopTarget = cellInRoom(world, loop, 6, 3);
  const pairs = [
    addTeleportPair(world, safeSource, safeTarget, 170101, true),
    addTeleportPair(world, loopSource, loopTarget, 170201, false),
  ];

  registerRouteCue(world, {
    id: 'void_perestanovshchik_safe_door',
    x: (safeSource % W) + 0.5,
    y: ((safeSource / W) | 0) + 0.5,
    targetX: (safeTarget % W) + 0.5,
    targetY: ((safeTarget / W) | 0) + 0.5,
    floor: FloorLevel.VOID,
    roomId: entry.id,
    targetRoomId: anchor.id,
    zoneId: world.zoneMap[safeSource],
    label: 'правая дверь 36',
    hint: 'бледная метка ведет к якорной 35/37',
    targetName: 'якорная Перестановщика',
    color: '#8cf',
    tags: [PERESTANOVSHCHIK_ID, 'void', 'teleport', 'anchor', 'safe'],
    toneSeed: entry.id * 1009 + 361,
    radius: 5.5,
    targetRadius: 2.4,
    cooldownSec: 24,
    heardText: 'У двух дверей 36 правая помечена бледным мелом: она ведет к якорной 35/37.',
    followedText: 'Правая дверь вывела к якорю. Заберите шип или схему - петля 36 схлопнется.',
    ignoredText: 'Бледная дверь осталась позади. Две двери 36 продолжат путать маршрут.',
  });
  registerRouteCue(world, {
    id: 'void_perestanovshchik_loop_warning',
    x: (loopSource % W) + 0.5,
    y: ((loopSource / W) | 0) + 0.5,
    targetX: (loopTarget % W) + 0.5,
    targetY: ((loopTarget / W) | 0) + 0.5,
    floor: FloorLevel.VOID,
    roomId: entry.id,
    targetRoomId: loop.id,
    zoneId: world.zoneMap[loopSource],
    label: 'левая дверь 36',
    hint: 'темная метка замыкает боковую петлю',
    targetName: 'боковая комната 36',
    color: '#f8c',
    tags: [PERESTANOVSHCHIK_ID, 'void', 'teleport', 'loop', 'warning'],
    toneSeed: entry.id * 1009 + 362,
    radius: 5.5,
    targetRadius: 2.4,
    cooldownSec: 24,
    heardText: 'Левая дверь 36 помечена темным мелом: это петля с ответной меткой, не короткий путь.',
    followedText: 'Левая метка завела в боковую 36. Ищите ответную метку или обычный выход.',
    ignoredText: 'Темная дверь осталась позади. Петля не забрала время.',
  });

  for (let dx = 3; dx <= 13; dx += 5) {
    stampSurfaceSplat(world, entry.x + dx, entry.y + 1, 0.5, 0.5, 0.28, 0.48, 170300 + dx, 210, 210, 190, false);
  }
  dropNote(
    entities,
    nextId,
    entry.x + 8,
    entry.y + 3,
    'Мелом: две двери с номером 36. Правая ведет к якорной 35/37, левая забирает время в боковой комнате. Якорь можно сорвать.',
  );
  dropNote(
    entities,
    nextId,
    loop.x + 2,
    loop.y + loop.h - 3,
    'Запись на обороте схемы: если попал в боковую 36, не спорь с дверью. Иди по обычному ходу или наступи на ответную метку.',
  );

  const anchorContainerId = addContainer(
    world,
    anchor,
    anchor.x + anchor.w - 4,
    anchor.y + anchor.h - 3,
    'Якорь Перестановщика',
    [
      { defId: 'note', count: 1, data: { text: 'Якорь держит две местные перестановки. Заберите шип или схему - двери 36 станут обычными.' } },
      { defId: 'lift_scheme', count: 1 },
      { defId: 'void_spike', count: 1 },
    ],
    [PERESTANOVSHCHIK_ID, ANCHOR_TAG, 'topology', 'route'],
  );

  spawnLoopThreat(world, entities, nextId, loop);
  registerContext({
    world,
    roomId: anchor.id,
    anchorIdx,
    anchorContainerId,
    pairs,
    disabled: false,
  });
  world.markFogDirty();
}
