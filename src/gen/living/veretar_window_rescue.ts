/* ── Белое окно Веретара: witness rescue POI ─────────────────── */

import {
  Cell, ContainerKind, DoorState, EntityType, Faction, Feature,
  FloorLevel, Occupation, QuestType, RoomType, Tex, W,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { Spr } from '../../render/sprite_index';
import { findClearArea, protectRoom } from '../shared';
import { genLog } from '../log';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { registerZoneContent } from './zone_content';

const CONTENT_TAG = 'ag95_veretar_window';
const ZONE_HUD = 58;
const MAIN_W = 14;
const ROOM_H = 10;
const DIVIDER_W = 1;
const SHORTCUT_W = 4;
const TOTAL_W = MAIN_W + DIVIDER_W + SHORTCUT_W;
const ROOM_NAME = 'Комната белого окна';
const SHORTCUT_NAME = 'Белый обход за окном';
const WITNESS_ID = 'ag95_lida_white_window';

const WITNESS: PlotNpcDef = {
  name: 'Лида Белооконная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 70,
  maxHp: 70,
  money: 9,
  speed: 0.65,
  inventory: [
    { defId: 'cloth_roll', count: 1 },
    { defId: 'water_coupon', count: 1 },
  ],
  talkLines: [
    'Там белое окно. Не двор. Пятно света на раме, от него сложно отвернуться.',
    'Не дай мне досмотреть. Тяни за плечо, не спорь со мной.',
    'Белое не светит. Оно выедает фото и сушит кожу на пальцах.',
    'Ткань на столе - для рамы. Герметик - для нижней щели. Песок руками не бери.',
    'Справа от окна белый обход. Он короче, но после него люди говорят не все.',
    'Если поднимешь фото у порога, не смотри на него как на карту.',
    'Если оттащишь меня - я буду злиться. Если не оттащишь - меня потом не будет кому злиться.',
  ],
  talkLinesPost: [
    'Я стояла у окна и думала, что меня зовут по имени. Теперь помню только занавеску.',
    'Если кто спросит, окна не было. Но песок под ногтями есть.',
    'Заклейте раму без меня. Я больше не буду стоять там вместо пломбы.',
    'Белый обход пусть берут те, кто уже решил, кого не будет объяснять.',
  ],
  talkQuestResponse: 'Не тяните за руку. Тяните за плечо. Глаза сами потом догонят.',
};

registerSideQuest(WITNESS_ID, WITNESS, [
  {
    id: 'ag95_pull_witness_from_window',
    giverNpcId: WITNESS_ID,
    type: QuestType.TALK,
    desc: 'Лида Белооконная: «Оттащи меня от белого окна. Если я скажу, что там двор, веди к двери и не спорь.»',
    targetNpcId: WITNESS_ID,
    rewardItem: 'water_coupon',
    rewardCount: 2,
    relationDelta: 12,
    xpReward: 45,
    moneyReward: 12,
    eventTargetName: 'Свидетеля оттащили от белого окна Веретара.',
    eventSeverity: 4,
    eventPrivacy: 'witnessed',
    eventTags: ['samosbor_veretar', 'veretar_window_rescue', 'witness', 'rescued'],
    eventData: {
      outcome: 'rescued',
      readableChoices: ['cover', 'seal', 'sand', 'photo', 'shortcut'],
      rumorIds: ['samosbor_veretar_window_rescue'],
    },
  },
  {
    id: 'ag95_mark_white_shortcut',
    giverNpcId: WITNESS_ID,
    type: QuestType.VISIT,
    desc: 'Лида Белооконная: «Белый обход справа от окна короче обычного коридора. Если выберешь его, фото заберёшь, а свидетель замолчит.»',
    targetRoomName: SHORTCUT_NAME,
    rewardItem: 'overexposed_photo',
    rewardCount: 1,
    relationDelta: -6,
    xpReward: 40,
    targetFloor: FloorLevel.LIVING,
    targetHint: 'Жилая зона: белый проход рядом с комнатой окна; песок лежит полосой у рамы, засвеченный кадр ждёт на пороге.',
    eventTargetName: 'Игрок выбрал белый обход Веретара: путь стал короче, свидетель после окна замолчал.',
    eventSeverity: 4,
    eventPrivacy: 'local',
    eventTags: ['samosbor_veretar', 'veretar_window_shortcut', 'veretar_window_lost', 'costly_shortcut', 'overexposed_photo', 'shortcut', 'witness'],
    eventData: {
      outcome: 'shortcut_used',
      routeCost: 'silent_witness',
      witnessOutcome: 'silent',
      contaminatedItem: 'overexposed_photo',
      rumorIds: ['samosbor_veretar_window_lost'],
    },
  },
]);

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
  ownerNpcId?: number,
): void {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ci = world.idx(wx, wy);
  world.addContainer({
    id: nextContainerId(world),
    x: wx,
    y: wy,
    floor: FloorLevel.LIVING,
    roomId: room.id,
    zoneId: world.zoneMap[ci],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory: inventory.map(i => ({ ...i })),
    capacitySlots: Math.max(4, inventory.length + 3),
    ownerNpcId,
    ownerName: WITNESS.name,
    faction: Faction.CITIZEN,
    access: 'owner',
    discovered: true,
    tags: [CONTENT_TAG, 'samosbor_veretar', 'area_leak', ...tags],
  });
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
      world.light[ci] = Math.max(world.light[ci], 0.08);
    }
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) world.features[ci] = feature;
}

function addDoor(world: World, x: number, y: number, roomA: Room, roomB: Room | null, state: DoorState): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.roomMap[ci] = -1;
  world.doors.set(ci, { idx: ci, state, roomA: roomA.id, roomB: roomB?.id ?? -1, keyId: '', timer: 0 });
  roomA.doors.push(ci);
  if (roomB) roomB.doors.push(ci);
}

function carveProtectedRooms(world: World, nextRoomId: number, rx: number, ry: number): { main: Room; shortcut: Room } {
  for (let dy = -1; dy <= ROOM_H; dy++) {
    for (let dx = -1; dx <= TOTAL_W; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT) continue;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = Tex.PANEL;
      world.floorTex[ci] = Tex.F_LINO;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
  }

  const main: Room = {
    id: nextRoomId,
    type: RoomType.LIVING,
    x: world.wrap(rx),
    y: world.wrap(ry),
    w: MAIN_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.PANEL,
    floorTex: Tex.F_LINO,
  };
  const shortcut: Room = {
    id: nextRoomId + 1,
    type: RoomType.CORRIDOR,
    x: world.wrap(rx + MAIN_W + DIVIDER_W),
    y: world.wrap(ry),
    w: SHORTCUT_W,
    h: ROOM_H,
    doors: [],
    sealed: false,
    name: SHORTCUT_NAME,
    apartmentId: -1,
    wallTex: Tex.HERMO_WALL,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[main.id] = main;
  world.rooms[shortcut.id] = shortcut;
  carveFloor(world, main);
  carveFloor(world, shortcut);

  protectRoom(world, rx, ry, TOTAL_W, ROOM_H, Tex.PANEL, Tex.F_LINO);
  const wallX = world.wrap(rx + MAIN_W);
  for (let dy = 0; dy < ROOM_H; dy++) {
    const ci = world.idx(wallX, ry + dy);
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.HERMO_WALL;
    world.roomMap[ci] = -1;
  }
  addDoor(world, wallX, world.wrap(ry + Math.floor(ROOM_H / 2)), main, shortcut, DoorState.OPEN);
  return { main, shortcut };
}

function connectMainToMaze(world: World, room: Room): void {
  const doorX = world.wrap(room.x + Math.floor(room.w / 2));
  const doorY = world.wrap(room.y + room.h);
  addDoor(world, doorX, doorY, room, null, DoorState.CLOSED);
  let cy = world.wrap(doorY + 1);
  for (let step = 0; step < 72; step++) {
    const ci = world.idx(doorX, cy);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
    }
    cy = world.wrap(cy + 1);
  }
}

function connectShortcutToMaze(world: World, room: Room): void {
  const doorX = world.wrap(room.x + room.w);
  const doorY = world.wrap(room.y + Math.floor(room.h / 2));
  addDoor(world, doorX, doorY, room, null, DoorState.OPEN);
  let cx = world.wrap(doorX + 1);
  for (let step = 0; step < 96; step++) {
    const ci = world.idx(cx, doorY);
    if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) break;
    if (!world.aptMask[ci] && world.cells[ci] !== Cell.LIFT) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.roomMap[ci] = -1;
      world.features[ci] = Feature.NONE;
      if (step < 10) world.light[ci] = Math.max(world.light[ci], 0.55 - step * 0.04);
    }
    if (step < 8) stampMark(world, cx, doorY, 0.5, 0.5, 0.35, MarkType.SPLAT, 95_500 + step, 244, 241, 223, 120);
    cx = world.wrap(cx + 1);
  }
}

function decorate(world: World, main: Room, shortcut: Room): void {
  const rx = main.x;
  const ry = main.y;
  const midY = world.wrap(ry + Math.floor(main.h / 2));
  const windowX = world.wrap(rx + Math.floor(main.w / 2));
  const windowY = world.wrap(ry - 1);

  world.wallTex[world.idx(windowX, windowY)] = Tex.SCREEN_BASE + 11;
  world.wallTex[world.idx(world.wrap(windowX - 1), windowY)] = Tex.SCREEN_BASE + 10;
  world.wallTex[world.idx(world.wrap(windowX + 1), windowY)] = Tex.SCREEN_BASE + 12;

  for (let dy = 1; dy < main.h - 1; dy++) {
    for (let dx = 4; dx <= 9; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.light[ci] = Math.max(world.light[ci], 0.78 - Math.abs(dy - 2) * 0.08);
    }
  }
  for (let dy = 0; dy < shortcut.h; dy++) {
    for (let dx = 0; dx < shortcut.w; dx++) {
      const ci = world.idx(shortcut.x + dx, shortcut.y + dy);
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.light[ci] = Math.max(world.light[ci], 0.85);
    }
  }

  setFeature(world, rx + 2, ry + 2, Feature.BED);
  setFeature(world, rx + 3, ry + 6, Feature.TABLE);
  setFeature(world, rx + 4, ry + 6, Feature.CHAIR);
  setFeature(world, rx + 1, ry + 1, Feature.LAMP);
  setFeature(world, rx + main.w - 2, ry + 2, Feature.SHELF);
  setFeature(world, rx + main.w - 3, ry + 7, Feature.SCREEN);
  setFeature(world, shortcut.x + 1, shortcut.y + 2, Feature.APPARATUS);
  setFeature(world, shortcut.x + 2, shortcut.y + shortcut.h - 3, Feature.CANDLE);

  for (let i = 0; i < 12; i++) {
    const x = world.wrap(windowX - 3 + (i % 7));
    const y = world.wrap(ry + 1 + Math.floor(i / 3));
    stampMark(world, x, y, 0.5, 0.5, 0.28 + (i % 3) * 0.07, MarkType.SPLAT, 95_000 + i, 244, 241, 223, 140);
  }
  for (let dy = 1; dy < shortcut.h - 1; dy++) {
    stampMark(world, shortcut.x + 1, shortcut.y + dy, 0.5, 0.5, 0.36, MarkType.PSI, 95_200 + dy, 244, 241, 223, 115);
  }
  stampMark(world, windowX, midY, 0.5, 0.5, 0.48, MarkType.POOL, 95_300, 244, 241, 223, 150);
}

function spawnWitness(world: World, entities: Entity[], nextId: { v: number }, room: Room): number {
  const existing = entities.find(e => e.alive && e.plotNpcId === WITNESS_ID);
  if (existing) return existing.id;
  const x = world.wrap(room.x + Math.floor(room.w / 2));
  const y = world.wrap(room.y + 2);
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, WITNESS_ID, x + 0.5, y + 0.5, {
    angle: -Math.PI / 2,
    canGiveQuest: true,
    aiTarget: { x: x + 0.5, y: y + 0.5 },
  });
  return npc.id;
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

function generateVeretarWindowRescue(
  world: World,
  nextRoomId: number,
  entities: Entity[],
  nextId: { v: number },
  zcx: number,
  zcy: number,
): { nextRoomId: number } {
  const pos = findClearArea(world, Math.floor(zcx), Math.floor(zcy), TOTAL_W, ROOM_H, 70, 230)
    ?? { x: world.wrap(Math.floor(zcx - TOTAL_W / 2)), y: world.wrap(Math.floor(zcy - ROOM_H / 2)) };
  const { main, shortcut } = carveProtectedRooms(world, nextRoomId, pos.x, pos.y);
  connectMainToMaze(world, main);
  connectShortcutToMaze(world, shortcut);
  decorate(world, main, shortcut);

  const witnessId = spawnWitness(world, entities, nextId, main);
  const windowX = world.wrap(main.x + Math.floor(main.w / 2));
  const sampleY = world.wrap(main.y + 1);
  const sealY = world.wrap(main.y + 2);
  const shortcutY = world.wrap(shortcut.y + Math.floor(shortcut.h / 2));

  addContainer(
    world,
    main,
    windowX,
    sampleY,
    'Песок на белом подоконнике',
    [{ defId: 'veretar_sand', count: 1 }],
    ['veretar_window_sample', 'white_sand', 'sample', 'evidence', 'contaminant'],
    witnessId,
  );
  addContainer(
    world,
    main,
    world.wrap(windowX + 1),
    sealY,
    'Белая щель под рамой',
    [],
    ['veretar_window_seal', 'seal_target', 'cover_target', 'witness'],
    witnessId,
  );
  addContainer(
    world,
    shortcut,
    world.wrap(shortcut.x + 1),
    shortcutY,
    'Засвеченный порог обхода',
    [{ defId: 'overexposed_photo', count: 1 }],
    ['veretar_window_shortcut', 'veretar_window_lost', 'costly_shortcut', 'contaminated_item', 'photo', 'shortcut', 'outside'],
    witnessId,
  );

  addDrop(entities, nextId, main.x + 3, main.y + 6, 'sealant_tube');
  addDrop(entities, nextId, main.x + 4, main.y + 6, 'cloth_roll');
  addDrop(entities, nextId, shortcut.x + 2, shortcut.y + shortcut.h - 2, 'glass_shard');
  world.bakeLights();

  genLog(`[AG95] ${ROOM_NAME} at (${main.x}, ${main.y}) room #${main.id}, shortcut #${shortcut.id}`);
  return { nextRoomId: shortcut.id + 1 };
}

registerZoneContent(ZONE_HUD, ROOM_NAME, generateVeretarWindowRescue);
