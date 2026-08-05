/* ── Maronary Signalshchik — local green source aftermath ─────── */

import {
  AIGoal, Cell, ContainerKind, DoorState, EntityType, Feature, FloorLevel, MonsterKind, RoomType, Tex, W, msg,
  type Entity, type GameState, type Item, type WorldContainer, type WorldEvent, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { playMaronaryPing } from '../../systems/audio';
import { publishEvent, registerWorldEventObserver as observeWorldEvents } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';
import { isPlayerEntity } from '../../systems/player_actor';

const ENCOUNTER_ID = 'maronary_signalshchik';
const ENCOUNTER_NAME = 'Маронарный Сигнальщик';
const TAG_HEARD = 'signal_heard';
const TAG_FOLLOW = 'signal_follow';
const TAG_DISABLE = 'signal_disable';
const TAG_AVOID = 'signal_avoid';
const CONTEXT_CAP = 8;
const SCREEN_FRAMES = 4;

interface SignalshchikContext {
  world: World;
  entities: Entity[];
  roomId: number;
  avoidRoomId: number;
  sourceCell: number;
  screenCells: number[];
  monsterId: number;
  heardContainerId: number;
  followContainerId: number;
  disableContainerId: number;
  avoidContainerId: number;
  heard: boolean;
  followed: boolean;
  disabled: boolean;
  avoided: boolean;
  cleared: boolean;
}

const signalshchikContexts: SignalshchikContext[] = [];

function signalTags(phase: string, extra: string[] = []): string[] {
  return ['monster', 'maronary', 'green_source', 'signal', ENCOUNTER_ID, phase, 'samosbor_maronary', ...extra].slice(0, 8);
}

function registerSignalshchikContext(ctx: SignalshchikContext): void {
  const existing = signalshchikContexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    Object.assign(existing, ctx);
    return;
  }
  signalshchikContexts.push(ctx);
  if (signalshchikContexts.length > CONTEXT_CAP) signalshchikContexts.splice(0, signalshchikContexts.length - CONTEXT_CAP);
}

function findSignalshchikContext(event: WorldEvent): SignalshchikContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = signalshchikContexts.length - 1; i >= 0; i--) {
    const ctx = signalshchikContexts[i];
    if (
      event.containerId === ctx.heardContainerId ||
      event.containerId === ctx.followContainerId ||
      event.containerId === ctx.disableContainerId ||
      event.containerId === ctx.avoidContainerId
    ) {
      return ctx;
    }
  }
  return undefined;
}

function findPlayer(entities: Entity[]): Entity | undefined {
  return entities.find(e => isPlayerEntity(e) && e.alive);
}

function pushHud(state: GameState, line: string, color = '#35ff66'): void {
  state.msgs.push(msg(line, state.time, color));
}

function publishSignalEvent(
  state: GameState,
  ctx: SignalshchikContext,
  phase: string,
  type: WorldEventType,
  severity: 2 | 3 | 4,
  extraTags: string[] = [],
  data: Record<string, unknown> = {},
): void {
  const x = ctx.sourceCell % W;
  const y = (ctx.sourceCell / W) | 0;
  publishEvent(state, {
    type,
    zoneId: ctx.world.zoneMap[ctx.sourceCell],
    roomId: ctx.roomId,
    x,
    y,
    targetId: ctx.monsterId,
    targetName: ENCOUNTER_NAME,
    monsterKind: MonsterKind.EYE,
    severity,
    privacy: 'local',
    tags: signalTags(phase, extraTags),
    data: {
      encounterId: ENCOUNTER_ID,
      ruName: ENCOUNTER_NAME,
      phase,
      ...data,
    },
  });
}

function signalMonster(ctx: SignalshchikContext): Entity | undefined {
  return ctx.entities.find(e => e.id === ctx.monsterId && e.alive);
}

function setMonsterHunt(ctx: SignalshchikContext, player?: Entity): void {
  const monster = signalMonster(ctx);
  if (!monster) return;
  if (!monster.ai) monster.ai = { goal: AIGoal.HUNT, tx: monster.x, ty: monster.y, path: [], pi: 0, stuck: 0, timer: 0 };
  monster.ai.goal = AIGoal.HUNT;
  monster.ai.tx = player?.x ?? monster.x;
  monster.ai.ty = player?.y ?? monster.y;
  monster.attackCd = 0;
}

function stampGreenMark(world: World, cell: number, seed: number, radius: number, wall = false): void {
  stampMark(
    world,
    cell % W,
    (cell / W) | 0,
    0.5,
    0.5,
    radius,
    MarkType.MARONARY,
    seed,
    53,
    255,
    102,
    175,
    wall,
  );
}

function disableSource(ctx: SignalshchikContext): void {
  for (const cell of ctx.screenCells) {
    ctx.world.wallTex[cell] = Tex.VOID_WALL;
    if (ctx.world.features[cell] === Feature.SCREEN) ctx.world.features[cell] = Feature.NONE;
    stampGreenMark(ctx.world, cell, 121_000 + cell, 0.34, true);
  }
  const room = ctx.world.rooms[ctx.roomId];
  if (room) {
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        const ci = ctx.world.idx(x, y);
        if (ctx.world.features[ci] === Feature.LAMP) ctx.world.features[ci] = Feature.NONE;
      }
    }
  }
  const monster = signalMonster(ctx);
  if (monster) {
    monster.alive = false;
    monster.hp = 0;
  }
  ctx.world.markWallTexDirty();
}

function handleHeard(ctx: SignalshchikContext, state: GameState): void {
  if (ctx.heard) return;
  ctx.heard = true;
  playMaronaryPing();
  setMonsterHunt(ctx, findPlayer(ctx.entities));
  pushHud(state, 'Высокий писк записан. Пойдете по стрелке - получите ПСИ-сбой; источник можно разбить.');
  publishSignalEvent(state, ctx, 'heard', 'samosbor_warning', 3, [], { counterplay: 'leave_room_break_source_ignore_signal' });
}

function handleFollowed(ctx: SignalshchikContext, state: GameState): void {
  if (ctx.followed) return;
  ctx.followed = true;
  const player = findPlayer(ctx.entities);
  if (player) player.psiMadness = Math.max(player.psiMadness ?? 0, 5);
  setMonsterHunt(ctx, player);
  pushHud(state, 'Вы пошли за зеленой стрелкой. Шаг замедлился, ПСИ поплыло, монстр взял ваш след.');
  publishSignalEvent(state, ctx, 'followed', 'samosbor_warning', 4, ['wrong_door'], { failure: 'confusion_delay_eye_pressure' });
}

function handleDisabled(ctx: SignalshchikContext, state: GameState): void {
  if (ctx.disabled) return;
  ctx.disabled = true;
  disableSource(ctx);
  pushHud(state, 'Зеленый источник разбит. Писк выключился, в стекле остался голос в банке.');
  publishSignalEvent(state, ctx, 'disabled', 'hazard_cleaned', 4, [], { reward: 'bottled_voice' });
  if (!ctx.cleared) {
    ctx.cleared = true;
    publishSignalEvent(state, ctx, 'cleared', 'hazard_cleaned', 4, [], { sourceRecoverable: true });
  }
}

function handleAvoided(ctx: SignalshchikContext, state: GameState): void {
  if (ctx.avoided) return;
  ctx.avoided = true;
  pushHud(state, 'Незеленый обход сработал. Сигнал остался за стеной, награда лежит в полке.');
  publishSignalEvent(state, ctx, 'avoided', 'samosbor_warning', 2, [], { reward: 'overexposed_photo' });
}

function handleSignalEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!event.tags.includes(ENCOUNTER_ID)) return;
  const ctx = findSignalshchikContext(event);
  if (!ctx) return;
  if (event.tags.includes(TAG_HEARD)) handleHeard(ctx, state);
  else if (event.tags.includes(TAG_FOLLOW)) handleFollowed(ctx, state);
  else if (event.tags.includes(TAG_DISABLE)) handleDisabled(ctx, state);
  else if (event.tags.includes(TAG_AVOID)) handleAvoided(ctx, state);
}

observeWorldEvents(handleSignalEvent);

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addSignalContainer(
  world: World,
  roomId: number,
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
    roomId,
    zoneId: world.zoneMap[world.idx(wx, wy)],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 3,
    access: 'public',
    discovered: true,
    tags: [ENCOUNTER_ID, ...tags],
  };
  world.addContainer(container);
  return id;
}

function setVoidRoomTextures(world: World, rx: number, ry: number, rw: number, rh: number): void {
  for (let dy = -1; dy <= rh; dy++) {
    for (let dx = -1; dx <= rw; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) world.floorTex[ci] = Tex.F_VOID;
      else world.wallTex[ci] = Tex.VOID_WALL;
    }
  }
}

function screenTex(variant: number, frame: number): Tex {
  return (Tex.SCREEN_BASE + variant * SCREEN_FRAMES + frame) as Tex;
}

function addScreen(world: World, cells: number[], x: number, y: number, variant: number, seed: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.WALL) return;
  world.wallTex[ci] = screenTex(variant, seed & (SCREEN_FRAMES - 1));
  world.features[ci] = Feature.SCREEN;
  if (!world.screenCells.includes(ci)) world.screenCells.push(ci);
  cells.push(ci);
  stampGreenMark(world, ci, 120_000 + seed + ci, 0.44, true);
}

function addRoomCues(world: World, roomId: number, screenCells: number[]): number {
  const room = world.rooms[roomId];
  if (!room) return -1;
  const eastWall = room.x + room.w;
  addScreen(world, screenCells, eastWall, room.y + 2, 0, 1);
  addScreen(world, screenCells, eastWall, room.y + (room.h >> 1), 7, 2);
  addScreen(world, screenCells, eastWall, room.y + room.h - 3, 0, 3);

  for (let dx = 3; dx < room.w - 3; dx += 4) {
    world.features[world.idx(room.x + dx, room.y + 2)] = Feature.DESK;
  }
  world.features[world.idx(room.x + 2, room.y + room.h - 3)] = Feature.CHAIR;
  world.features[world.idx(room.x + room.w - 3, room.y + room.h - 3)] = Feature.SHELF;
  world.features[world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1))] = Feature.APPARATUS;
  world.features[world.idx(room.x + 4, room.y + room.h - 2)] = Feature.LAMP;
  world.features[world.idx(room.x + room.w - 5, room.y + 1)] = Feature.LAMP;
  const sourceCell = world.idx(room.x + (room.w >> 1), room.y + (room.h >> 1));
  stampGreenMark(world, sourceCell, 120_317 + room.id, 0.58);
  return sourceCell;
}

function stampCorridorCues(world: World, sx: number, sy: number, tx: number, ty: number): void {
  const dx = world.delta(sx, tx);
  const dy = world.delta(sy, ty);
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const x = world.wrap(Math.round(sx + dx * t));
    const y = world.wrap(Math.round(sy + dy * t));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    stampGreenMark(world, ci, 121_700 + i * 31 + ci, 0.24);
    if (i === 2) world.features[ci] = Feature.LAMP;
  }
}

function spawnSignalshchik(world: World, entities: Entity[], nextId: { v: number }, x: number, y: number): number {
  const kind = MonsterKind.EYE;
  const def = MONSTERS[kind];
  const zoneId = world.zoneMap[world.idx(x, y)];
  const level = Math.max(14, world.zones[zoneId]?.level ?? 14);
  const hp = Math.round(scaleMonsterHp(def.hp, level) * 1.2);
  const id = nextId.v++;
  entities.push({
    id,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name: ENCOUNTER_NAME,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    spriteScale: 1.12,
  });
  return id;
}

export function generateMaronarySignalshchik(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const rw = 17;
  const rh = 11;
  const pos = findClearArea(world, sx, sy, rw, rh, 42, 78);
  const rx = pos ? pos.x : world.wrap(sx + 62);
  const ry = pos ? pos.y : world.wrap(sy - 38);
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, rx, ry, rw, rh, -1);
  room.name = 'Маронарная диспетчерская';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, room.x, room.y, room.w, room.h);

  const doorY = world.wrap(room.y + (room.h >> 1));
  placeDoorAt(world, room.x - 1, doorY, room.id);
  carveCorridor(world, sx, sy, room.x - 2, doorY);
  const door = world.doors.get(world.idx(room.x - 1, doorY));
  if (door) {
    door.state = DoorState.OPEN;
    door.timer = 0;
  }
  stampCorridorCues(world, sx, sy, room.x - 2, doorY);

  const screenCells: number[] = [];
  const sourceCell = addRoomCues(world, room.id, screenCells);
  const monsterId = spawnSignalshchik(world, entities, nextId, room.x + room.w - 5, room.y + (room.h >> 1));

  const heardContainerId = addSignalContainer(
    world,
    room.id,
    room.x + 3,
    room.y + 3,
    'Писк: слушать источник',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'Маронарный источник пищит выше сирены. Услышал - не обязан идти. Источник локален: уход, укрытие и разбитый экран работают.' },
    }],
    [TAG_HEARD, 'warning'],
  );
  const followContainerId = addSignalContainer(
    world,
    room.id,
    room.x + room.w - 4,
    room.y + 3,
    'Зеленая стрелка: следовать',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ЗЕЛЕНЫЙ МАРШРУТ: стрелка ведет через задержку и ПСИ-сбой. Не проверяйте взглядом; уходите, ломайте источник или берите темную полку.' },
    }],
    [TAG_FOLLOW, 'wrong_door'],
  );
  const disableContainerId = addSignalContainer(
    world,
    room.id,
    room.x + (room.w >> 1),
    room.y + (room.h >> 1),
    'Источник: разбить экран',
    [{ defId: 'bottled_voice', count: 1 }],
    [TAG_DISABLE, 'source'],
  );

  const arw = 11;
  const arh = 7;
  const apos = findClearArea(world, sx, sy, arw, arh, 24, 56);
  const arx = apos ? apos.x : world.wrap(sx - 46);
  const ary = apos ? apos.y : world.wrap(sy + 34);
  const avoidRoom = stampRoom(world, world.rooms.length, RoomType.STORAGE, arx, ary, arw, arh, -1);
  avoidRoom.name = 'Незеленый обход';
  avoidRoom.wallTex = Tex.VOID_WALL;
  avoidRoom.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, avoidRoom.x, avoidRoom.y, avoidRoom.w, avoidRoom.h);
  const avoidDoorY = world.wrap(avoidRoom.y + (avoidRoom.h >> 1));
  placeDoorAt(world, avoidRoom.x - 1, avoidDoorY, avoidRoom.id);
  carveCorridor(world, sx, sy, avoidRoom.x - 2, avoidDoorY);
  const avoidDoor = world.doors.get(world.idx(avoidRoom.x - 1, avoidDoorY));
  if (avoidDoor) {
    avoidDoor.state = DoorState.OPEN;
    avoidDoor.timer = 0;
  }
  world.features[world.idx(avoidRoom.x + 2, avoidRoom.y + 2)] = Feature.SHELF;
  world.features[world.idx(avoidRoom.x + avoidRoom.w - 3, avoidRoom.y + avoidRoom.h - 3)] = Feature.LAMP;
  const avoidContainerId = addSignalContainer(
    world,
    avoidRoom.id,
    avoidRoom.x + (avoidRoom.w >> 1),
    avoidRoom.y + (avoidRoom.h >> 1),
    'Темная полка: не идти по зеленой стрелке',
    [{ defId: 'overexposed_photo', count: 1 }],
    [TAG_AVOID, 'cover'],
  );

  registerRouteCue(world, {
    id: 'void_maronary_signalshchik_dark_bypass',
    x: room.x + 3.5,
    y: room.y + 3.5,
    targetX: avoidRoom.x + (avoidRoom.w >> 1) + 0.5,
    targetY: avoidRoom.y + (avoidRoom.h >> 1) + 0.5,
    floor: FloorLevel.VOID,
    roomId: room.id,
    targetRoomId: avoidRoom.id,
    zoneId: world.zoneMap[world.idx(room.x + 3, room.y + 3)],
    label: 'обходной тон',
    hint: 'темная полка дает награду без зеленого сигнала',
    targetName: 'незеленый обход',
    color: '#7f9',
    tags: [ENCOUNTER_ID, 'void', 'maronary', 'bypass', 'wrong_door'],
    toneSeed: room.id * 991 + 120317,
    radius: 10,
    targetRadius: 2.8,
    cooldownSec: 26,
    heardText: 'За зеленым писком есть низкий тон: он ведет к темной полке, не к стрелке.',
    followedText: 'Незеленый обход сработал. Сигнал остался за стеной, награда - в полке.',
    ignoredText: 'Низкий тон стих. Зеленая стрелка снова ведет кратчайшим, но опасным путем.',
  });

  registerSignalshchikContext({
    world,
    entities,
    roomId: room.id,
    avoidRoomId: avoidRoom.id,
    sourceCell,
    screenCells,
    monsterId,
    heardContainerId,
    followContainerId,
    disableContainerId,
    avoidContainerId,
    heard: false,
    followed: false,
    disabled: false,
    avoided: false,
    cleared: false,
  });
}
