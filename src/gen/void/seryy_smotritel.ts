/* -- Seryy Smotritel -- local VOID no-look encounter ------------ */

import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Feature, FloorLevel,
  MonsterKind, RoomType, Tex, msg,
  type Entity, type GameState, type Item, type Room, type WorldContainer, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver as observeWorldEvents } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoor, placeDoorAt, stampRoom } from '../shared';
import { genLog } from '../log';
import { isPlayerEntity } from '../../systems/player_actor';

export const SERYY_SMOTRITEL_ID = 'seryy_smotritel' as const;
export const SERYY_SMOTRITEL_RU_NAME = 'Серый Смотритель' as const;

const TAG_ID = SERYY_SMOTRITEL_ID;
const TAG_NO_LOOK = 'no_look';
const TAG_SEROBURMALINE = 'seroburmaline';
const TAG_MONSTER = 'monster';
const TAG_PSI = 'psi';
const TAG_WATCHED = 'watched';
const TAG_AVOIDED = 'avoided';
const TAG_DISABLED = 'disabled';
const TAG_SAMPLE = 'sample';
const CONTEXT_CAP = 8;
const WATCH_RANGE = 10;
const WATCH_RANGE2 = WATCH_RANGE * WATCH_RANGE;
const WATCH_ANGLE = 0.62;

export interface SeryySmotritelGeneration {
  roomId: number;
  sourceX: number;
  sourceY: number;
  watchContainerId: number;
  avoidContainerId: number;
  disableContainerId: number;
  sampleContainerId: number;
}

interface SeryyContext extends SeryySmotritelGeneration {
  world: World;
  entities: Entity[];
  watched: boolean;
  avoided: boolean;
  disabled: boolean;
  sampleTaken: boolean;
}

const contexts: SeryyContext[] = [];

function contextTags(phase: string): string[] {
  return [TAG_ID, TAG_NO_LOOK, TAG_SEROBURMALINE, TAG_MONSTER, TAG_PSI, phase];
}

function eventHasTags(event: WorldEvent, ...tags: string[]): boolean {
  return tags.every(tag => event.tags.includes(tag));
}

function registerContext(ctx: SeryyContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.sourceX = ctx.sourceX;
    existing.sourceY = ctx.sourceY;
    existing.watchContainerId = ctx.watchContainerId;
    existing.avoidContainerId = ctx.avoidContainerId;
    existing.disableContainerId = ctx.disableContainerId;
    existing.sampleContainerId = ctx.sampleContainerId;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > CONTEXT_CAP) contexts.splice(0, contexts.length - CONTEXT_CAP);
}

function contextForEvent(event: WorldEvent): SeryyContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (
      ctx.watchContainerId === event.containerId
      || ctx.avoidContainerId === event.containerId
      || ctx.disableContainerId === event.containerId
      || ctx.sampleContainerId === event.containerId
    ) return ctx;
  }
  return undefined;
}

function playerInContext(ctx: SeryyContext): Entity | undefined {
  return ctx.entities.find(e => isPlayerEntity(e) && e.alive);
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

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

function openRoomDoors(world: World, rooms: readonly Room[]): void {
  const seen = new Set<number>();
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (seen.has(doorIdx)) continue;
      seen.add(doorIdx);
      const door = world.doors.get(doorIdx);
      if (door) {
        door.state = DoorState.OPEN;
        door.timer = 0;
      }
      if (world.cells[doorIdx] === Cell.DOOR) world.wallTex[doorIdx] = Tex.DOOR_METAL;
    }
  }
}

function setInteriorWall(world: World, room: Room, dx: number, dy: number): void {
  const ci = world.idx(room.x + dx, room.y + dy);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.cells[ci] = Cell.WALL;
  world.roomMap[ci] = -1;
  world.wallTex[ci] = Tex.VOID_WALL;
  world.floorTex[ci] = 0;
  world.features[ci] = Feature.NONE;
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
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const container: WorldContainer = {
    id,
    x: wx,
    y: wy,
    floor: FloorLevel.VOID,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(wx, wy)],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: Math.max(3, inventory.length),
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
  return id;
}

function note(text: string): Item {
  return { defId: 'note', count: 1, data: { text } };
}

function markSeroburmaline(world: World, x: number, y: number, seed: number, radius = 0.62): void {
  stampMark(world, x, y, 0.5, 0.5, radius, MarkType.SEROBURMALINE, seed, 142, 92, 124, 230);
  stampMark(world, x, y, 0.5, 0.5, radius * 0.55, MarkType.PSI, seed + 101, 96, 58, 138, 165);
}

function markSafeRoute(world: World, room: Room): void {
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    const x = room.x + dx;
    const y = room.y + 2;
    world.features[world.idx(x, y)] = dx % 8 === 2 ? Feature.CANDLE : Feature.APPARATUS;
    stampMark(world, x, y, 0.5, 0.5, 0.2, MarkType.SCORCH, 19019 + room.id * 31 + dx, 68, 72, 72, 135);
  }
}

function decorateEntry(world: World, room: Room): void {
  world.features[world.idx(room.x + 2, room.y + 2)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 3, room.y + 2)] = Feature.SHELF;
  world.features[world.idx(room.x + 2, room.y + room.h - 3)] = Feature.CANDLE;
}

function decorateWatcherHall(world: World, room: Room): void {
  for (const dy of [2, 3, 5, 6]) setInteriorWall(world, room, 5, dy);
  for (const dy of [1, 2, 6, 7]) setInteriorWall(world, room, 11, dy);
  for (const dy of [2, 3, 5, 6]) setInteriorWall(world, room, 16, dy);
  world.features[world.idx(room.x + 3, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 3, room.y + 7)] = Feature.SCREEN;
  markSeroburmaline(world, room.x + 8, room.y + 4, 19190, 0.36);
  markSeroburmaline(world, room.x + 14, room.y + 4, 19191, 0.36);
}

function decorateSource(world: World, room: Room, sourceX: number, sourceY: number): void {
  world.features[world.idx(sourceX, sourceY)] = Feature.APPARATUS;
  world.features[world.idx(room.x + 2, room.y + 2)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 3, room.y + 2)] = Feature.SCREEN;
  world.features[world.idx(room.x + 2, room.y + room.h - 3)] = Feature.CANDLE;
  markSeroburmaline(world, sourceX, sourceY, 19019, 0.86);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ci = world.idx(sourceX + dx, sourceY + dy);
      if (world.cells[ci] === Cell.FLOOR) world.fog[ci] = Math.max(world.fog[ci], 46 + (Math.abs(dx) + Math.abs(dy)) * 7);
    }
  }
  world.markFogDirty();
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function sourceVisibleToPlayer(ctx: SeryyContext, player: Entity): boolean {
  const targetX = ctx.sourceX + 0.5;
  const targetY = ctx.sourceY + 0.5;
  const dx = ctx.world.delta(player.x, targetX);
  const dy = ctx.world.delta(player.y, targetY);
  const d2 = dx * dx + dy * dy;
  if (d2 > WATCH_RANGE2) return false;
  if (Math.abs(angleDiff(player.angle, Math.atan2(dy, dx))) > WATCH_ANGLE) return false;

  const steps = Math.max(1, Math.ceil(Math.sqrt(d2) / 0.25));
  const sourceCi = ctx.world.idx(ctx.sourceX, ctx.sourceY);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(player.x + dx * t);
    const y = Math.floor(player.y + dy * t);
    const ci = ctx.world.idx(x, y);
    if (ci === sourceCi) return true;
    if (ctx.world.solid(x, y)) return false;
  }
  return true;
}

function publishSeryyEvent(
  state: GameState,
  ctx: SeryyContext,
  phase: typeof TAG_WATCHED | typeof TAG_AVOIDED | typeof TAG_DISABLED | typeof TAG_SAMPLE,
  severity: 2 | 3 | 4,
  event: WorldEvent,
): void {
  const player = playerInContext(ctx);
  publishEvent(state, {
    type: phase === TAG_DISABLED ? 'player_use_item' : 'rumor_observed',
    zoneId: event.zoneId ?? ctx.world.zoneMap[ctx.world.idx(ctx.sourceX, ctx.sourceY)],
    roomId: ctx.roomId,
    x: event.x ?? ctx.sourceX + 0.5,
    y: event.y ?? ctx.sourceY + 0.5,
    actorId: player?.id ?? event.actorId,
    actorName: player?.name ?? event.actorName ?? 'Вы',
    actorFaction: player?.faction ?? event.actorFaction,
    itemId: event.itemId,
    itemName: event.itemName,
    itemCount: event.itemCount,
    itemValue: event.itemValue,
    containerId: event.containerId,
    severity,
    privacy: 'local',
    tags: [TAG_MONSTER, TAG_SEROBURMALINE, TAG_NO_LOOK, TAG_PSI, TAG_ID, phase, 'void'],
    data: {
      outcome: phase,
      sourceX: ctx.sourceX,
      sourceY: ctx.sourceY,
      sourceDisabled: ctx.disabled,
      sourceAvoided: ctx.avoided,
      roomName: ctx.world.rooms[ctx.roomId]?.name,
    },
  });
}

function findAmbushCell(world: World, x: number, y: number): { x: number; y: number } {
  const offsets: readonly (readonly [number, number])[] = [
    [-2, 0], [2, 0], [0, -2], [0, 2],
    [-3, -1], [3, 1], [-1, 3], [1, -3],
  ];
  for (const [dx, dy] of offsets) {
    const wx = world.wrap(Math.floor(x + dx));
    const wy = world.wrap(Math.floor(y + dy));
    if (!world.solid(wx, wy)) return { x: wx, y: wy };
  }
  return { x: world.wrap(Math.floor(x)), y: world.wrap(Math.floor(y)) };
}

function spawnShadowAmbush(ctx: SeryyContext, player: Entity | undefined, event: WorldEvent): void {
  const def = MONSTERS[MonsterKind.SHADOW];
  const anchorX = player?.x ?? event.x ?? ctx.sourceX;
  const anchorY = player?.y ?? event.y ?? ctx.sourceY;
  const pos = findAmbushCell(ctx.world, anchorX, anchorY);
  const zoneId = ctx.world.zoneMap[ctx.world.idx(pos.x, pos.y)];
  const level = Math.max(14, ctx.world.zones[zoneId]?.level ?? 14);
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  ctx.entities.push({
    id: nextEntityId(ctx.entities),
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(MonsterKind.SHADOW),
    name: 'Тень Серого Смотрителя',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SHADOW,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function applyWatched(ctx: SeryyContext, state: GameState, event: WorldEvent): void {
  if (ctx.watched) return;
  ctx.watched = true;
  const player = playerInContext(ctx);
  if (player) {
    if (player.hp !== undefined) player.hp = Math.max(1, player.hp - 9);
    if (player.rpg) player.rpg.psi = Math.max(0, player.rpg.psi - 10);
    state.dmgFlash = Math.max(state.dmgFlash, 0.36);
  }
  spawnShadowAmbush(ctx, player, event);
  state.msgs.push(msg('Серый Смотритель поймал прямой взгляд. За спиной поднялась тень.', state.time, '#d8a'));
  publishSeryyEvent(state, ctx, TAG_WATCHED, 4, event);
}

function markAvoided(ctx: SeryyContext, state: GameState, event: WorldEvent): void {
  if (ctx.avoided) return;
  ctx.avoided = true;
  state.msgs.push(msg('Вы прошли по нижним меткам, не глядя на источник.', state.time, '#9ac'));
  publishSeryyEvent(state, ctx, TAG_AVOIDED, 2, event);
}

function disableSource(ctx: SeryyContext, state: GameState, event: WorldEvent): void {
  if (ctx.disabled) return;
  ctx.disabled = true;
  const ci = ctx.world.idx(ctx.sourceX, ctx.sourceY);
  ctx.world.features[ci] = Feature.TABLE;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const fi = ctx.world.idx(ctx.sourceX + dx, ctx.sourceY + dy);
      if (ctx.world.cells[fi] === Cell.FLOOR) ctx.world.fog[fi] = Math.min(ctx.world.fog[fi], 22);
    }
  }
  stampMark(ctx.world, ctx.sourceX, ctx.sourceY, 0.5, 0.5, 0.58, MarkType.SCORCH, 19819, 60, 66, 64, 190);
  ctx.world.markFogDirty();
  state.msgs.push(msg('Отражатель разбит. Серый Смотритель стал пятном на бетоне.', state.time, '#b8c'));
  publishSeryyEvent(state, ctx, TAG_DISABLED, 4, event);
}

function markSampleTaken(ctx: SeryyContext, state: GameState, event: WorldEvent): void {
  if (ctx.sampleTaken || event.itemId !== 'slime_sample_seroburmaline') return;
  ctx.sampleTaken = true;
  state.msgs.push(msg('Проба серобурмалина снята из слепого соскоба.', state.time, '#b8c'));
  publishSeryyEvent(state, ctx, TAG_SAMPLE, 3, event);
}

function handleSeryyEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!eventHasTags(event, TAG_ID, TAG_NO_LOOK)) return;
  const ctx = contextForEvent(event);
  if (!ctx) return;

  const player = playerInContext(ctx);
  const riskyLook = !!player && !ctx.disabled && sourceVisibleToPlayer(ctx, player);
  if (eventHasTags(event, TAG_WATCHED)) {
    applyWatched(ctx, state, event);
    return;
  }

  if (eventHasTags(event, TAG_AVOIDED)) markAvoided(ctx, state, event);

  if (eventHasTags(event, TAG_DISABLED)) {
    if (riskyLook) applyWatched(ctx, state, event);
    disableSource(ctx, state, event);
  }

  if (eventHasTags(event, TAG_SAMPLE)) {
    if (!ctx.disabled && !ctx.avoided && riskyLook) applyWatched(ctx, state, event);
    if (!ctx.avoided && !riskyLook) markAvoided(ctx, state, event);
    markSampleTaken(ctx, state, event);
  }
}

observeWorldEvents(handleSeryyEvent);

export function generateSeryySmotritel(
  world: World,
  entities: Entity[],
  _nextId: { v: number },
  spawnX: number,
  spawnY: number,
): SeryySmotritelGeneration | null {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const pos = findClearArea(world, sx, sy, 43, 20, 28, 68) ?? { x: world.wrap(sx + 34), y: world.wrap(sy + 17) };

  const entry = stampRoom(world, world.rooms.length, RoomType.OFFICE, pos.x, pos.y + 5, 9, 9, -1);
  entry.name = `${SERYY_SMOTRITEL_RU_NAME}: памятка не смотреть`;
  const hall = stampRoom(world, world.rooms.length, RoomType.PRODUCTION, pos.x + 10, pos.y + 5, 21, 9, -1);
  hall.name = `${SERYY_SMOTRITEL_RU_NAME}: прямой коридор`;
  const bypass = stampRoom(world, world.rooms.length, RoomType.CORRIDOR, pos.x + 10, pos.y + 15, 21, 5, -1);
  bypass.name = `${SERYY_SMOTRITEL_RU_NAME}: обход без взгляда`;
  const source = stampRoom(world, world.rooms.length, RoomType.OFFICE, pos.x + 32, pos.y + 5, 9, 9, -1);
  source.name = `${SERYY_SMOTRITEL_RU_NAME}: серобурмалиновый источник`;
  const reward = stampRoom(world, world.rooms.length, RoomType.STORAGE, pos.x + 32, pos.y + 15, 9, 5, -1);
  reward.name = `${SERYY_SMOTRITEL_RU_NAME}: слепой соскоб`;

  for (const room of [entry, hall, bypass, source, reward]) setVoidRoomTextures(world, room);

  placeDoor(world, entry, hall, '', false);
  placeDoor(world, entry, bypass, '', false);
  placeDoor(world, hall, bypass, '', false);
  placeDoor(world, hall, source, '', false);
  placeDoor(world, bypass, reward, '', false);
  placeDoor(world, source, reward, '', false);
  openRoomDoors(world, [entry, hall, bypass, source, reward]);

  const entryDoorY = world.wrap(entry.y + (entry.h >> 1));
  placeDoorAt(world, entry.x - 1, entryDoorY, entry.id);
  const entryDoor = world.doors.get(world.idx(entry.x - 1, entryDoorY));
  if (entryDoor) {
    entryDoor.state = DoorState.OPEN;
    entryDoor.timer = 0;
  }
  carveCorridor(world, sx, sy, entry.x - 2, entryDoorY);

  const sourceX = world.wrap(source.x + (source.w >> 1));
  const sourceY = world.wrap(source.y + (source.h >> 1));
  decorateEntry(world, entry);
  decorateWatcherHall(world, hall);
  decorateSource(world, source, sourceX, sourceY);
  markSafeRoute(world, bypass);
  markSafeRoute(world, reward);

  const watchContainerId = addContainer(world, hall, hall.x + 10, hall.y + 4, 'Прямой взгляд Серого Смотрителя', [
    note('ПРЯМО НЕ СМОТРЕТЬ. Если читаешь эту строку из коридора, уже поздно: отходи за стену.'),
  ], contextTags(TAG_WATCHED));
  const avoidContainerId = addContainer(world, bypass, bypass.x + 9, bypass.y + 2, 'Нижние метки: идти без взгляда', [
    note('Идти по меткам: два шага от свечи, рука по стене, источник остается сбоку.'),
  ], contextTags(TAG_AVOIDED));
  const disableContainerId = addContainer(world, source, source.x + 2, source.y + 4, 'Боковой рычаг: разбить отражатель', [
    note('Рычаг сбоку ломает зеркало. Не стой в прямой линии с серым пятном.'),
    { defId: 'glass_shard', count: 1 },
  ], contextTags(TAG_DISABLED));
  const sampleContainerId = addContainer(world, reward, reward.x + 4, reward.y + 2, 'Слепая проба серобурмалина', [
    { defId: 'slime_sample_seroburmaline', count: 1 },
    { defId: 'psi_dust', count: 1 },
    note('Слух для НИИ: Серого Смотрителя берут маршрутом: источник сбоку, рука по стене, глаза вниз.'),
  ], contextTags(TAG_SAMPLE));

  registerRouteCue(world, {
    id: 'void_seryy_smotritel_memory_bypass',
    x: entry.x + 2.5,
    y: entry.y + (entry.h >> 1) + 0.5,
    targetX: reward.x + 4.5,
    targetY: reward.y + 2.5,
    floor: FloorLevel.VOID,
    roomId: entry.id,
    targetRoomId: reward.id,
    zoneId: world.zoneMap[world.idx(entry.x + 2, entry.y + (entry.h >> 1))],
    label: 'серый обход',
    hint: 'нижний ход держит источник сбоку',
    targetName: 'слепой соскоб серобурмалина',
    color: '#b8c',
    tags: [SERYY_SMOTRITEL_ID, 'void', 'no_look', 'bypass', 'sample'],
    toneSeed: entry.id * 977 + 19019,
    radius: 9,
    targetRadius: 2.6,
    cooldownSec: 28,
    heardText: 'Нижняя метка показывает обход: рука по стене, источник сбоку, глаза вниз.',
    followedText: 'Обход вывел к слепому соскобу. Пробу можно взять без прямого взгляда.',
    ignoredText: 'Серый обход остался в стороне. Прямой коридор ведет прямо под источник.',
  });

  const generation: SeryySmotritelGeneration = {
    roomId: source.id,
    sourceX,
    sourceY,
    watchContainerId,
    avoidContainerId,
    disableContainerId,
    sampleContainerId,
  };
  registerContext({
    ...generation,
    world,
    entities,
    watched: false,
    avoided: false,
    disabled: false,
    sampleTaken: false,
  });

  world.markFogDirty();
  genLog(`[MONSTER_19] ${SERYY_SMOTRITEL_RU_NAME} at (${source.x}, ${source.y}) room #${source.id}`);
  return generation;
}
