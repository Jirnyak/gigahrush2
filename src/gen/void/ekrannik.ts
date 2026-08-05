/* ── Экранник — local screen-bound misinformation encounter ───── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  W,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Room,
  type WorldContainer,
  type WorldEvent,
  type WorldEventSeverity,
  type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver as observeWorldEvents } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';
import { SCREEN_FRAMES } from '../procedural_screens';

export const EKRANNIK_ID = 'ekrannik';
export const EKRANNIK_EVENT_READ = 'ekrannik_false_signal_read';
export const EKRANNIK_EVENT_DISABLED = 'ekrannik_disabled';
export const EKRANNIK_EVENT_DANGER = 'ekrannik_danger_followed';

const RU_NAME = 'Экранник';
const TAG_READ = 'ekrannik_read';
const TAG_DISABLE = 'ekrannik_disable';
const TAG_DANGER = 'ekrannik_danger';
const TAG_READ_DONE = 'ekrannik_read_done';
const TAG_DISABLED_DONE = 'ekrannik_disabled_done';
const TAG_DANGER_DONE = 'ekrannik_danger_done';
const CONTEXT_CAP = 8;

const SCREEN_VARIANT_LIFT = 3;
const SCREEN_VARIANT_MINISTRY = 4;
const SCREEN_VARIANT_VOID = 7;
const RUMOR_IDS = ['floor_void_listens', 'monster_eye_lamps', 'ecology_paragraph_clause'] as const;

type EkrannikPhase = 'read' | 'disabled' | 'danger';

interface EkrannikContext {
  world: World;
  entities: Entity[];
  roomId: number;
  dangerRoomId: number;
  readContainerId: number;
  fuseContainerId: number;
  dangerContainerId: number;
  screenCells: number[];
  controllerMonsterId: number;
  pressureMonsterIds: number[];
}

const contexts: EkrannikContext[] = [];

function registerEkrannikContext(ctx: EkrannikContext): void {
  const existing = contexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.dangerRoomId = ctx.dangerRoomId;
    existing.readContainerId = ctx.readContainerId;
    existing.fuseContainerId = ctx.fuseContainerId;
    existing.dangerContainerId = ctx.dangerContainerId;
    existing.screenCells = ctx.screenCells;
    existing.controllerMonsterId = ctx.controllerMonsterId;
    existing.pressureMonsterIds = ctx.pressureMonsterIds;
    return;
  }
  contexts.push(ctx);
  if (contexts.length > CONTEXT_CAP) contexts.splice(0, contexts.length - CONTEXT_CAP);
}

function contextContainers(ctx: EkrannikContext): (WorldContainer | undefined)[] {
  return [
    ctx.world.containerById.get(ctx.readContainerId),
    ctx.world.containerById.get(ctx.fuseContainerId),
    ctx.world.containerById.get(ctx.dangerContainerId),
  ];
}

function addContainerTag(container: WorldContainer | undefined, tag: string): void {
  if (container && !container.tags.includes(tag)) container.tags.push(tag);
}

function contextHasTag(ctx: EkrannikContext, tag: string): boolean {
  return contextContainers(ctx).some(container => container?.tags.includes(tag));
}

function markContext(ctx: EkrannikContext, tag: string): void {
  for (const container of contextContainers(ctx)) addContainerTag(container, tag);
}

function findContextForContainer(event: WorldEvent): EkrannikContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (
      ctx.readContainerId === event.containerId ||
      ctx.fuseContainerId === event.containerId ||
      ctx.dangerContainerId === event.containerId
    ) return ctx;
  }
  return undefined;
}

function findContextForMonster(event: WorldEvent): EkrannikContext | undefined {
  if (event.targetId === undefined || event.floor !== FloorLevel.VOID) return undefined;
  for (let i = contexts.length - 1; i >= 0; i--) {
    const ctx = contexts[i];
    if (ctx.pressureMonsterIds.includes(event.targetId)) return ctx;
  }
  return undefined;
}

function pushHud(state: GameState, line: string, color: string): void {
  state.msgs.push(msg(line, state.time, color));
}

function publishEkrannikEvent(
  state: GameState,
  ctx: EkrannikContext,
  source: WorldEvent,
  type: string,
  phase: EkrannikPhase,
  method: string,
  line: string,
  severity: WorldEventSeverity,
): void {
  publishEvent(state, {
    type: type as WorldEventType,
    zoneId: source.zoneId,
    roomId: ctx.roomId,
    x: source.x,
    y: source.y,
    actorId: source.actorId ?? 0,
    actorName: source.actorName ?? 'Вы',
    actorFaction: source.actorFaction,
    targetId: ctx.controllerMonsterId > 0 ? ctx.controllerMonsterId : undefined,
    targetName: RU_NAME,
    monsterKind: MonsterKind.EYE,
    itemId: source.itemId,
    itemName: source.itemName,
    severity,
    privacy: 'local',
    tags: ['monster', 'screen', 'signal', 'misdirection', EKRANNIK_ID, phase, method, 'void'],
    data: {
      encounterId: EKRANNIK_ID,
      ruName: RU_NAME,
      phase,
      method,
      falseMarker: 'C',
      falseRoute: 'east_white_frame',
      safeCounterplay: 'ignore_or_disable_screen',
      localOnly: true,
      questStateMutated: false,
      sourceEventId: source.id,
      sourceContainerId: source.containerId,
      rumorIds: RUMOR_IDS,
    },
  });
  pushHud(state, line, phase === 'danger' ? '#f84' : phase === 'disabled' ? '#8ff' : '#afa');
}

function disableScreens(ctx: EkrannikContext): void {
  const remove = new Set(ctx.screenCells);
  let changed = false;
  for (const ci of ctx.screenCells) {
    if (ctx.world.features[ci] === Feature.SCREEN) {
      ctx.world.features[ci] = Feature.NONE;
      changed = true;
    }
    if (ctx.world.cells[ci] === Cell.WALL && ctx.world.wallTex[ci] !== Tex.VOID_WALL) {
      ctx.world.wallTex[ci] = Tex.VOID_WALL;
      changed = true;
    }
  }
  for (const roomId of [ctx.roomId, ctx.dangerRoomId]) {
    const room = ctx.world.rooms[roomId];
    if (!room) continue;
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const ci = ctx.world.idx(room.x + dx, room.y + dy);
        if (ctx.world.features[ci] === Feature.SCREEN) {
          ctx.world.features[ci] = Feature.NONE;
          changed = true;
        }
      }
    }
  }
  if (remove.size > 0) ctx.world.screenCells = ctx.world.screenCells.filter(ci => !remove.has(ci));
  if (changed) ctx.world.markWallTexDirty();
}

function readFalseSignal(ctx: EkrannikContext, state: GameState, event: WorldEvent): void {
  if (contextHasTag(ctx, TAG_READ_DONE)) return;
  markContext(ctx, TAG_READ_DONE);
  publishEkrannikEvent(
    state,
    ctx,
    event,
    EKRANNIK_EVENT_READ,
    'read',
    'screen_note',
    'Экранник показывает метку C. В записке указан этаж КРЫША, а карта говорит ПУСТОТА.',
    3,
  );
}

function disableEkrannik(ctx: EkrannikContext, state: GameState, event: WorldEvent, method: string): void {
  if (contextHasTag(ctx, TAG_DISABLED_DONE)) return;
  markContext(ctx, TAG_DISABLED_DONE);
  disableScreens(ctx);
  publishEkrannikEvent(
    state,
    ctx,
    event,
    EKRANNIK_EVENT_DISABLED,
    'disabled',
    method,
    method === 'controller_killed' ? 'Экранник погас вместе с глазом.' : 'Экранник погас: предохранитель вышел из щитка.',
    4,
  );
}

function followDanger(ctx: EkrannikContext, state: GameState, event: WorldEvent, method: string): void {
  if (contextHasTag(ctx, TAG_DANGER_DONE)) return;
  markContext(ctx, TAG_DANGER_DONE);
  publishEkrannikEvent(
    state,
    ctx,
    event,
    EKRANNIK_EVENT_DANGER,
    'danger',
    method,
    'Метка C была приманкой: экран вел на открытую линию огня.',
    4,
  );
}

function handleEkrannikEvent(state: GameState, event: WorldEvent): void {
  if (event.type === 'container_opened' || event.type === 'item_stolen') {
    const ctx = findContextForContainer(event);
    if (!ctx) return;
    if (event.containerId === ctx.readContainerId) readFalseSignal(ctx, state, event);
    if (event.containerId === ctx.dangerContainerId) followDanger(ctx, state, event, 'wrong_marker');
    if (event.containerId === ctx.fuseContainerId) disableEkrannik(ctx, state, event, 'fuse');
    return;
  }

  if (event.type !== 'player_kill_monster') return;
  const ctx = findContextForMonster(event);
  if (!ctx) return;
  if (contextHasTag(ctx, TAG_READ_DONE)) followDanger(ctx, state, event, 'line_of_sight');
  if (event.targetId === ctx.controllerMonsterId) disableEkrannik(ctx, state, event, 'controller_killed');
}

observeWorldEvents(handleEkrannikEvent);

function screenTex(variant: number, x: number, y: number): Tex {
  const frame = Math.abs((x * 17 + y * 31 + variant * 7) % SCREEN_FRAMES);
  return (Tex.SCREEN_BASE + variant * SCREEN_FRAMES + frame) as Tex;
}

function setWallScreen(world: World, x: number, y: number, variant: number): number {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.WALL) return -1;
  world.features[ci] = Feature.SCREEN;
  world.wallTex[ci] = screenTex(variant, world.wrap(x), world.wrap(y));
  if (!world.screenCells.includes(ci)) world.screenCells.push(ci);
  return ci;
}

function setVoidRoomTextures(world: World, room: Room): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[ci] = Tex.F_VOID;
      } else {
        world.wallTex[ci] = Tex.VOID_WALL;
      }
    }
  }
}

function setFloorFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function openDoor(world: World, x: number, y: number): void {
  const door = world.doors.get(world.idx(x, y));
  if (door) {
    door.state = DoorState.OPEN;
    door.timer = 0;
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addEkrannikContainer(
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
    tags: [EKRANNIK_ID, 'monster', 'screen', 'signal', 'misdirection', ...tags],
  };
  world.addContainer(container);
  return id;
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  name: string,
  x: number,
  y: number,
): number {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return -1;
  const def = MONSTERS[kind];
  const level = Math.max(14, world.zones[world.zoneMap[ci]]?.level ?? 14);
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  const id = nextId.v++;
  entities.push({
    id,
    type: EntityType.MONSTER,
    x: world.wrap(x) + 0.5,
    y: world.wrap(y) + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
  return id;
}

function decorateEkrannikRooms(world: World, room: Room, danger: Room): number[] {
  const screenPlan = [
    [room.x + 3, room.y - 1, SCREEN_VARIANT_VOID],
    [room.x + 8, room.y - 1, SCREEN_VARIANT_LIFT],
    [room.x + 13, room.y - 1, SCREEN_VARIANT_MINISTRY],
    [room.x + 3, room.y + room.h, SCREEN_VARIANT_VOID],
    [room.x + 6, room.y + room.h, SCREEN_VARIANT_LIFT],
    [room.x + 11, room.y + room.h, SCREEN_VARIANT_MINISTRY],
    [room.x + 2, room.y - 1, SCREEN_VARIANT_VOID],
    [room.x + 14, room.y - 1, SCREEN_VARIANT_MINISTRY],
  ] as const;
  const screens: number[] = [];
  for (const [x, y, variant] of screenPlan) {
    if (screens.length >= 3) break;
    const ci = setWallScreen(world, x, y, variant);
    if (ci >= 0) screens.push(ci);
  }

  for (let dx = 2; dx < room.w - 2; dx += 4) setFloorFeature(world, room.x + dx, room.y + 2, Feature.APPARATUS);
  setFloorFeature(world, room.x + 2, room.y + room.h - 2, Feature.LAMP);
  setFloorFeature(world, room.x + room.w - 3, room.y + room.h - 2, Feature.LAMP);
  setFloorFeature(world, room.x + 5, room.y + 5, Feature.DESK);
  setFloorFeature(world, room.x + room.w - 4, room.y + 5, Feature.MACHINE);

  setFloorFeature(world, danger.x + 2, danger.y + 2, Feature.SCREEN);
  setFloorFeature(world, danger.x + danger.w - 3, danger.y + 2, Feature.CANDLE);
  setFloorFeature(world, danger.x + 2, danger.y + danger.h - 3, Feature.CANDLE);
  setFloorFeature(world, danger.x + danger.w - 3, danger.y + danger.h - 3, Feature.SHELF);

  for (const ci of screens) {
    const x = ci % W;
    const y = (ci / W) | 0;
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 1.4, 0.34, 16016 + ci, ci & 1 ? 230 : 45, 245, ci & 1 ? 230 : 80, true);
  }
  for (let dx = 1; dx < room.w - 1; dx += 3) {
    stampSurfaceSplat(world, room.x + dx, room.y + room.h - 1, 0.5, 0.5, 0.22, 95, room.id * 97 + dx, 210, 220, 220);
  }
  for (let dx = 1; dx < danger.w - 1; dx += 2) {
    stampSurfaceSplat(world, danger.x + dx, danger.y + 1, 0.5, 0.5, 0.28, 105, danger.id * 113 + dx, 45, 220, 85);
  }
  return screens;
}

export function generateEkrannik(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const mainW = 17;
  const mainH = 11;
  const dangerW = 10;
  const dangerH = 9;
  const pos = findClearArea(world, sx, sy, mainW + dangerW + 8, Math.max(mainH, dangerH) + 3, 44, 82);
  const rx = pos ? pos.x : world.wrap(sx + 68);
  const ry = pos ? pos.y : world.wrap(sy - 22);

  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, rx, ry, mainW, mainH, -1);
  room.name = 'Гнездо Экранника';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, room);

  const danger = stampRoom(world, world.rooms.length, RoomType.CORRIDOR, rx + mainW + 5, ry + 1, dangerW, dangerH, -1);
  danger.name = 'Ложный маршрут C';
  danger.wallTex = Tex.VOID_WALL;
  danger.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, danger);

  const entryY = world.wrap(room.y + (room.h >> 1));
  const falseY = entryY;
  const altX = world.wrap(room.x + (room.w >> 1));
  const altY = world.wrap(room.y + room.h);
  placeDoorAt(world, room.x - 1, entryY, room.id);
  placeDoorAt(world, room.x + room.w, falseY, room.id);
  placeDoorAt(world, altX, altY, room.id);
  placeDoorAt(world, danger.x - 1, danger.y + (danger.h >> 1), danger.id);
  openDoor(world, room.x - 1, entryY);
  openDoor(world, room.x + room.w, falseY);
  openDoor(world, altX, altY);
  openDoor(world, danger.x - 1, danger.y + (danger.h >> 1));

  carveCorridor(world, sx, sy, room.x - 2, entryY);
  carveCorridor(world, room.x + room.w + 1, falseY, danger.x - 2, danger.y + (danger.h >> 1));
  carveCorridor(world, altX, altY + 1, sx + 8, sy + 6);

  const screenCells = decorateEkrannikRooms(world, room, danger);
  const readContainerId = addEkrannikContainer(
    world,
    room,
    room.x + 5,
    room.y + 5,
    'Экран C: локальная строка',
    [{
      defId: 'note',
      count: 1,
      data: {
        text: 'ЕКРАННИК: строка C врёт про КРЫШУ. Карта права: это ПУСТОТА. Восточный ход ведёт под глаз; сначала щиток справа.',
      },
    }],
    [TAG_READ, 'false_route'],
  );
  const fuseContainerId = addEkrannikContainer(
    world,
    room,
    room.x + room.w - 4,
    room.y + 5,
    'Щиток: вынуть предохранитель',
    [{ defId: 'fuse', count: 1 }, { defId: 'circuit_board', count: 1 }],
    [TAG_DISABLE, 'counterplay', 'fuse'],
  );
  const dangerContainerId = addEkrannikContainer(
    world,
    danger,
    danger.x + danger.w - 3,
    danger.y + danger.h - 3,
    'Метка C: найденный след',
    [{
      defId: 'overexposed_photo',
      count: 1,
      data: { text: 'Снимок пересвечен: этот же экран стоит у двери C, только глаз и строка маршрута нарисованы за рамкой.' },
    }],
    [TAG_DANGER, 'reward', 'trace'],
  );

  registerRouteCue(world, {
    id: 'void_ekrannik_fuse_counterroute',
    x: room.x + 5.5,
    y: room.y + 5.5,
    targetX: room.x + room.w - 3.5,
    targetY: room.y + 5.5,
    floor: FloorLevel.VOID,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: world.zoneMap[world.idx(room.x + 5, room.y + 5)],
    label: 'экран C',
    hint: 'строка врет; правый щиток гудит тише',
    targetName: 'предохранитель Экранника',
    color: '#8ff',
    tags: [EKRANNIK_ID, 'void', 'screen', 'false_route', 'counterplay'],
    toneSeed: room.id * 983 + 16016,
    radius: 9,
    targetRadius: 2.2,
    cooldownSec: 26,
    heardText: 'Экран C повторяет одну строку. Правый щиток гудит тише и ведет к предохранителю.',
    followedText: 'Вы нашли щиток Экранника. Предохранитель гасит ложный маршрут до стрельбы.',
    ignoredText: 'Экран C остался гореть. Восточный ход ведет под глаз и Параграф.',
  });

  const controllerMonsterId = spawnMonster(world, entities, nextId, MonsterKind.EYE, RU_NAME, danger.x + 4, danger.y + 3);
  const paragraphId = spawnMonster(world, entities, nextId, MonsterKind.PARAGRAPH, 'Строка маршрута C', danger.x + 7, danger.y + 5);
  const pressureMonsterIds = [controllerMonsterId, paragraphId].filter(id => id > 0);

  registerEkrannikContext({
    world,
    entities,
    roomId: room.id,
    dangerRoomId: danger.id,
    readContainerId,
    fuseContainerId,
    dangerContainerId,
    screenCells,
    controllerMonsterId,
    pressureMonsterIds,
  });
}
