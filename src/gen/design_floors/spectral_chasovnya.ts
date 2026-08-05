/* -- Design floor: spectral_chasovnya - sound, cult and hearing geometry -- */

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { factionToTerritoryOwner } from '../../data/factions';
import { designNpcFloorKey, type PlotNpcDef, registerFloorSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerContentInteractionHook } from '../../systems/content_hooks';
import { publishEvent } from '../../systems/events';
import { publishNoise } from '../../systems/noise';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG } from '../../systems/rpg';
import { setTerritoryOwnerAtIndex, syncZoneMetadataFromTerritory, territoryOwnerAtIndex } from '../../systems/territory';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { carveCorridor, ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const DESIGN_NPC_HOME_FLOOR_KEY = designNpcFloorKey('spectral_chasovnya');

export const SPECTRAL_CHASOVNYA_ROUTE_ID = 'spectral_chasovnya' as const;
export const SPECTRAL_CHASOVNYA_Z = -42 as const;
export const SPECTRAL_CHASOVNYA_BASE_FLOOR = FloorLevel.HELL;

export const SPECTRAL_CHASOVNYA_ROOM_NAMES = {
  entry: 'Преддверие спектральной часовни',
  nave: 'Неф стоячей волны',
  bellCage: 'Колокольная клетка спектрального звона',
  radioSacristy: 'Радиоризница глухих свечей',
  quietNorth: 'Северная акустическая тень',
  quietSouth: 'Южная акустическая тень',
  focusArch: 'Фокусирующая арка слепого прострела',
  crypt: 'Костяной резонатор нижнего хора',
  exit: 'Нижний притвор без эха',
} as const;

type NextId = { v: number };
type SpectralRoomKey = keyof typeof SPECTRAL_CHASOVNYA_ROOM_NAMES;
type SpectralRooms = Record<SpectralRoomKey, Room>;
type SpectralDecision = 'fire_loudly' | 'move_silently' | 'ring_bell' | 'avoid_focus' | 'listen_radio' | 'flee';

export interface SpectralStandingWaveRoom {
  id: string;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  wavelengthCells: number;
  pressure: 1 | 2 | 3 | 4 | 5;
  decisions: SpectralDecision[];
  tags: string[];
}

export interface SpectralShadowZone {
  id: string;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  radius: number;
  coverCells: number;
  decisions: SpectralDecision[];
  tags: string[];
}

export interface SpectralBellNode {
  id: string;
  roomName: string;
  roomId: number;
  x: number;
  y: number;
  radius: number;
  cooldownSec: number;
  pulseTags: string[];
  decisions: SpectralDecision[];
}

export interface SpectralAcousticBand {
  id: string;
  modeIndex: number;
  frequencyHint: string;
  standingWaveRoomIds: number[];
  shadowRoomIds: number[];
  bellNodeIds: string[];
  tags: string[];
}

export interface SpectralChasovnyaState {
  routeId: typeof SPECTRAL_CHASOVNYA_ROUTE_ID;
  z: typeof SPECTRAL_CHASOVNYA_Z;
  baseFloor: typeof SPECTRAL_CHASOVNYA_BASE_FLOOR;
  standingWaveRooms: SpectralStandingWaveRoom[];
  shadowZones: SpectralShadowZone[];
  bellNodes: SpectralBellNode[];
  acousticBands: SpectralAcousticBand[];
  rungBellNodeIds: string[];
  lastBellPulseAt: number;
}

export interface SpectralChasovnyaGeneration extends FloorGeneration {
  spectralState: SpectralChasovnyaState;
}

const NPC_ID = 'spectral_bellwarden_miron' as const;
const BELL_COOLDOWN_SEC = 18;
const BELL_INTERACTION_RANGE = 2.6;
const BELL_LOOK_RADIUS = 1.45;
const SPECTRAL_CENTER_X = W >> 1;
const SPECTRAL_CENTER_Y = W >> 1;
const SPECTRAL_AMBIENT_NPC_PREFIX = 'Спектральная часовня: слушатель ';

interface SpectralHqSupportSpec {
  name: string;
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpectralHqSpec {
  owner: TerritoryOwner;
  title: string;
  hq: SpectralHqSupportSpec;
  support: readonly SpectralHqSupportSpec[];
}

const SPECTRAL_HQ_SPECS: readonly SpectralHqSpec[] = [
  {
    owner: ZoneFaction.CITIZEN,
    title: 'Гражданский слуховой двор',
    hq: { name: 'Гражданский слуховой двор: гермоядро', type: RoomType.HQ, x: 132, y: 150, w: 28, h: 16 },
    support: [
      { name: 'Гражданский слуховой двор: кухня тихого кипятка', type: RoomType.KITCHEN, x: 96, y: 128, w: 24, h: 12 },
      { name: 'Гражданский слуховой двор: общая комната шепота', type: RoomType.COMMON, x: 164, y: 128, w: 30, h: 14 },
      { name: 'Гражданский слуховой двор: кладовая ватных дверей', type: RoomType.STORAGE, x: 96, y: 174, w: 22, h: 12 },
      { name: 'Гражданский слуховой двор: медугол слуха', type: RoomType.MEDICAL, x: 164, y: 174, w: 24, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.LIQUIDATOR,
    title: 'Ликвидаторский пост глушения',
    hq: { name: 'Ликвидаторский пост глушения: гермоядро', type: RoomType.HQ, x: 836, y: 148, w: 28, h: 16 },
    support: [
      { name: 'Ликвидаторский пост глушения: оружейная тишины', type: RoomType.STORAGE, x: 798, y: 128, w: 26, h: 12 },
      { name: 'Ликвидаторский пост глушения: журнал эха', type: RoomType.OFFICE, x: 868, y: 128, w: 28, h: 12 },
      { name: 'Ликвидаторский пост глушения: санитарный шлюз', type: RoomType.BATHROOM, x: 798, y: 174, w: 24, h: 12 },
      { name: 'Ликвидаторский пост глушения: мастерская наушников', type: RoomType.PRODUCTION, x: 868, y: 174, w: 28, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.SCIENTIST,
    title: 'НИИ стоячей волны',
    hq: { name: 'НИИ стоячей волны: гермоядро', type: RoomType.HQ, x: 142, y: 804, w: 28, h: 16 },
    support: [
      { name: 'НИИ стоячей волны: лаборатория тишины', type: RoomType.PRODUCTION, x: 100, y: 782, w: 30, h: 13 },
      { name: 'НИИ стоячей волны: кабинет спектра', type: RoomType.OFFICE, x: 176, y: 782, w: 28, h: 13 },
      { name: 'НИИ стоячей волны: медизмерительная', type: RoomType.MEDICAL, x: 100, y: 828, w: 24, h: 12 },
      { name: 'НИИ стоячей волны: склад камертонов', type: RoomType.STORAGE, x: 176, y: 828, w: 24, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.WILD,
    title: 'Дикий притон сорванного хора',
    hq: { name: 'Дикий притон сорванного хора: гермоядро', type: RoomType.HQ, x: 836, y: 804, w: 28, h: 16 },
    support: [
      { name: 'Дикий притон сорванного хора: кухня жестянок', type: RoomType.KITCHEN, x: 798, y: 782, w: 24, h: 12 },
      { name: 'Дикий притон сорванного хора: курилка глухих', type: RoomType.SMOKING, x: 868, y: 782, w: 26, h: 12 },
      { name: 'Дикий притон сорванного хора: разборная кладовая', type: RoomType.STORAGE, x: 798, y: 828, w: 28, h: 12 },
      { name: 'Дикий притон сорванного хора: общий костяк', type: RoomType.COMMON, x: 868, y: 828, w: 28, h: 12 },
    ],
  },
  {
    owner: ZoneFaction.CULTIST,
    title: 'Культовая ризница низкого звона',
    hq: { name: 'Культовая ризница низкого звона: гермоядро', type: RoomType.HQ, x: 486, y: 708, w: 32, h: 18 },
    support: [
      { name: 'Культовая ризница низкого звона: общая хора', type: RoomType.COMMON, x: 444, y: 686, w: 30, h: 14 },
      { name: 'Культовая ризница низкого звона: кухня свечного жира', type: RoomType.KITCHEN, x: 528, y: 686, w: 26, h: 13 },
      { name: 'Культовая ризница низкого звона: кладовая свечей', type: RoomType.STORAGE, x: 444, y: 734, w: 26, h: 13 },
      { name: 'Культовая ризница низкого звона: исповедальная радиопомех', type: RoomType.OFFICE, x: 528, y: 734, w: 30, h: 13 },
      { name: 'Культовая ризница низкого звона: костяной медугол', type: RoomType.MEDICAL, x: 486, y: 760, w: 30, h: 13 },
    ],
  },
] as const;

const MIRON_DEF: PlotNpcDef = {
  name: 'Мирон Звонарь',
  isFemale: false,
  faction: Faction.CULTIST,
  occupation: Occupation.PRIEST,
  sprite: Occupation.PRIEST,
  hp: 150,
  maxHp: 150,
  money: 42,
  speed: 0.74,
  inventory: [
    { defId: 'istotit_candle', count: 1 },
    { defId: 'radio_jammer', count: 1 },
    { defId: 'bottled_voice', count: 1 },
  ],
  talkLines: [
    'В часовне не слушают стены. Здесь слушают пустоты между стенами.',
    'Выстрел двигает слепых. Тихий шаг проходит мимо них, если не смотреть на колокол.',
    'Звон не спасает. Он собирает угрозу в одну точку, чтобы у тебя была другая.',
  ],
  talkLinesPost: [
    'Колокол помнит, кто тянул верёвку. Это не всегда плохо.',
    'Не спорь с эхом: оно отвечает чужим голосом.',
  ],
};

registerFloorSideQuest(DESIGN_NPC_HOME_FLOOR_KEY, NPC_ID, MIRON_DEF, [{
  id: 'spectral_tune_radio_sacristy',
  giverNpcId: NPC_ID,
  type: QuestType.FETCH,
  desc: 'Мирон Звонарь: «Принеси звукоизлучатель в радиоризницу. Настроим тишину так, чтобы слепые ушли к колоколу, а не к тебе.»',
  targetItem: 'sound_emitter',
  targetCount: 1,
  targetFloor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
  targetRoute: { designFloorId: SPECTRAL_CHASOVNYA_ROUTE_ID },
  targetRoomName: SPECTRAL_CHASOVNYA_ROOM_NAMES.radioSacristy,
  targetHint: 'Спектральная часовня z=-42: радиоризница стоит за боковой акустической тенью.',
  rewardItem: 'bottled_voice',
  rewardCount: 1,
  extraRewards: [{ defId: 'istotit_candle', count: 1 }],
  relationDelta: 8,
  xpReward: 70,
  moneyReward: 24,
  eventTags: ['spectral_chasovnya', 'sound_emitter', 'bell_route', 'quiet_path'],
}]);

const spectralStateByWorld = new WeakMap<World, SpectralChasovnyaState>();

export function getSpectralChasovnyaState(world: World): SpectralChasovnyaState | undefined {
  return ensureSpectralChasovnyaState(world);
}

function roomCenter(room: Room): { x: number; y: number } {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

function findSpectralRooms(world: World): SpectralRooms | undefined {
  const rooms: Partial<SpectralRooms> = {};
  for (const key of Object.keys(SPECTRAL_CHASOVNYA_ROOM_NAMES) as SpectralRoomKey[]) {
    const roomName = SPECTRAL_CHASOVNYA_ROOM_NAMES[key];
    const room = world.rooms.find(candidate => candidate?.name === roomName);
    if (!room) return undefined;
    rooms[key] = room;
  }
  return rooms as SpectralRooms;
}

function ensureSpectralChasovnyaState(world: World): SpectralChasovnyaState | undefined {
  const existing = spectralStateByWorld.get(world);
  if (existing) return existing;
  const rooms = findSpectralRooms(world);
  if (!rooms) return undefined;
  const rebuilt = buildSpectralState(world, rooms);
  spectralStateByWorld.set(world, rebuilt);
  return rebuilt;
}

function setRoomStyle(world: World, room: Room, wallTex: Tex, floorTex: Tex, fog = 0): void {
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
    }
  }
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] !== room.id) continue;
      world.floorTex[ci] = floorTex;
      world.fog[ci] = fog;
    }
  }
}

function stampSpectralRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  fog = 0,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  setRoomStyle(world, room, wallTex, floorTex, fog);
  return room;
}

function connectCenters(world: World, a: Room, b: Room): void {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  carveCorridor(world, Math.floor(ac.x), Math.floor(ac.y), Math.floor(bc.x), Math.floor(bc.y));
}

function placeFeature(world: World, x: number, y: number, feature: Feature): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.features[ci] = feature;
}

function placeLift(world: World, room: Room, x: number, y: number, direction: LiftDirection): void {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.LIFT;
  world.roomMap[ci] = room.id;
  world.floorTex[ci] = Tex.LIFT_DOOR;
  world.wallTex[ci] = Tex.LIFT_DOOR;
  world.liftDir[ci] = direction;
  const bi = world.idx(x + (direction === LiftDirection.DOWN ? -1 : 1), y);
  if (world.cells[bi] === Cell.FLOOR) {
    world.features[bi] = Feature.LIFT_BUTTON;
    world.liftDir[bi] = direction;
  }
}

function decorateStandingWave(world: World, room: Room, pitch: number): void {
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] !== room.id) continue;
      if (((dx + dy) % pitch) === 0) world.floorTex[ci] = Tex.F_GUT;
      if (((dx - dy + pitch * 4) % (pitch * 2)) === 0) world.fog[ci] = Math.max(world.fog[ci], 34);
    }
  }
}

function countRoomFloorCells(world: World, room: Room): number {
  let count = 0;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) count++;
    }
  }
  return count;
}

function canStampSpectralRect(world: World, x: number, y: number, w: number, h: number): boolean {
  if (x <= 2 || y <= 2 || x + w >= W - 2 || y + h >= W - 2) return false;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx]) return false;
      if (world.roomMap[idx] >= 0) return false;
      if (world.cells[idx] !== Cell.WALL) return false;
    }
  }
  return true;
}

function tryStampSpectralRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  fog = 0,
): Room | null {
  const rx = Math.floor(x);
  const ry = Math.floor(y);
  const rw = Math.floor(w);
  const rh = Math.floor(h);
  if (!canStampSpectralRect(world, rx, ry, rw, rh)) return null;
  const room = stampSpectralRoom(world, type, rx, ry, rw, rh, name, wallTex, floorTex, fog);
  decorateSpectralRoom(world, room);
  return room;
}

function decorateSpectralRoom(world: World, room: Room): void {
  if (room.w < 4 || room.h < 4) return;
  const salt = room.id * 17 + room.w * 3 + room.h;
  if (room.type === RoomType.KITCHEN) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.STOVE);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  } else if (room.type === RoomType.BATHROOM) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.TOILET);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.SINK);
  } else if (room.type === RoomType.STORAGE) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 6) placeFeature(world, x, room.y + 2, Feature.SHELF);
  } else if (room.type === RoomType.OFFICE) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.DESK);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.SCREEN);
  } else if (room.type === RoomType.PRODUCTION) {
    for (let y = room.y + 3; y < room.y + room.h - 2; y += 7) {
      placeFeature(world, room.x + 3, y, Feature.MACHINE);
      placeFeature(world, room.x + room.w - 4, y, Feature.APPARATUS);
    }
  } else if (room.type === RoomType.MEDICAL) {
    placeFeature(world, room.x + 2, room.y + 2, Feature.BED);
    placeFeature(world, room.x + room.w - 3, room.y + 2, Feature.SHELF);
  } else if (room.type === RoomType.HQ || room.type === RoomType.COMMON) {
    for (let x = room.x + 4; x < room.x + room.w - 3; x += 9) {
      placeFeature(world, x, room.y + 3, (x + salt) % 3 === 0 ? Feature.CANDLE : Feature.TABLE);
    }
  }
}

function decorateEchoCourt(world: World, room: Room, serial: number): void {
  const vertical = serial % 2 === 0;
  if (vertical) {
    for (let x = room.x + 10; x < room.x + room.w - 9; x += 18) {
      for (let y = room.y + 7; y < room.y + room.h - 7; y++) {
        if (y % 13 === 0 || y % 13 === 1) continue;
        const idx = world.idx(x, y);
        if (world.roomMap[idx] !== room.id) continue;
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = room.wallTex;
      }
    }
  } else {
    for (let y = room.y + 8; y < room.y + room.h - 7; y += 16) {
      for (let x = room.x + 9; x < room.x + room.w - 9; x++) {
        if (x % 15 === 0 || x % 15 === 1) continue;
        const idx = world.idx(x, y);
        if (world.roomMap[idx] !== room.id) continue;
        world.cells[idx] = Cell.WALL;
        world.wallTex[idx] = room.wallTex;
      }
    }
  }
  for (let y = room.y + 6; y < room.y + room.h - 5; y += 14) {
    for (let x = room.x + 6; x < room.x + room.w - 5; x += 14) {
      placeFeature(world, x, y, (x + y + serial) % 4 === 0 ? Feature.CANDLE : Feature.APPARATUS);
    }
  }
}

function carveWideCorridor(world: World, ax: number, ay: number, bx: number, by: number, radius: number): void {
  const dx = Math.abs(world.delta(ax, bx));
  const dy = Math.abs(world.delta(ay, by));
  const horizontal = dx >= dy;
  for (let offset = -radius; offset <= radius; offset++) {
    if (horizontal) carveCorridor(world, ax, ay + offset, bx, by + offset);
    else carveCorridor(world, ax + offset, ay, bx + offset, by);
  }
}

function connectRoomToPoint(world: World, room: Room, x: number, y: number, wide = 0): void {
  const c = roomCenter(room);
  if (wide > 0) carveWideCorridor(world, Math.floor(c.x), Math.floor(c.y), Math.floor(x), Math.floor(y), wide);
  else carveCorridor(world, Math.floor(c.x), Math.floor(c.y), Math.floor(x), Math.floor(y));
}

function roomByNearestAngle(rooms: readonly Room[], angle: number): Room | undefined {
  let best: Room | undefined;
  let bestDelta = Infinity;
  for (const room of rooms) {
    const c = roomCenter(room);
    const a = Math.atan2(c.y - SPECTRAL_CENTER_Y, c.x - SPECTRAL_CENTER_X);
    const d = Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle)));
    if (d < bestDelta) {
      bestDelta = d;
      best = room;
    }
  }
  return best;
}

function styleForOwner(owner: TerritoryOwner): { wallTex: Tex; floorTex: Tex; fog: number } {
  switch (owner) {
    case ZoneFaction.CITIZEN:
      return { wallTex: Tex.PANEL, floorTex: Tex.F_LINO, fog: 10 };
    case ZoneFaction.LIQUIDATOR:
      return { wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE, fog: 8 };
    case ZoneFaction.SCIENTIST:
      return { wallTex: Tex.SCREEN_BASE, floorTex: Tex.F_TILE, fog: 12 };
    case ZoneFaction.WILD:
      return { wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE, fog: 22 };
    case ZoneFaction.CULTIST:
    default:
      return { wallTex: Tex.CROSS, floorTex: Tex.F_GUT, fog: 24 };
  }
}

function stampSpectralHqCompound(world: World, spec: SpectralHqSpec): Room[] {
  const out: Room[] = [];
  const style = styleForOwner(spec.owner);
  const hq = tryStampSpectralRoom(world, RoomType.HQ, spec.hq.x, spec.hq.y, spec.hq.w, spec.hq.h, spec.hq.name, style.wallTex, style.floorTex, style.fog);
  if (hq) {
    out.push(hq);
    hq.sealed = true;
    paintRoomOwner(world, hq, spec.owner);
  }
  for (const support of spec.support) {
    const room = tryStampSpectralRoom(world, support.type, support.x, support.y, support.w, support.h, support.name, style.wallTex, style.floorTex, style.fog);
    if (!room) continue;
    out.push(room);
    paintRoomOwner(world, room, spec.owner);
    if (hq) connectCenters(world, hq, room);
  }
  if (hq) hardenSpectralHqCore(world, hq, spec.owner);
  return out;
}

function paintRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] !== room.id || world.aptMask[idx]) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
  for (const doorIdx of room.doors) {
    if (!world.aptMask[doorIdx]) setTerritoryOwnerAtIndex(world, doorIdx, owner);
  }
}

function paintOwnerPatch(world: World, x: number, y: number, owner: TerritoryOwner, radius = 18): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const idx = world.idx(x + dx, y + dy);
      if (world.aptMask[idx] || world.cells[idx] === Cell.ABYSS || world.cells[idx] === Cell.LIFT) continue;
      setTerritoryOwnerAtIndex(world, idx, owner);
    }
  }
}

function hardenSpectralHqCore(world: World, room: Room, owner: TerritoryOwner): void {
  room.type = RoomType.HQ;
  room.sealed = true;
  room.wallTex = Tex.HERMO_WALL;
  paintRoomOwner(world, room, owner);
  const center = roomCenter(room);
  paintOwnerPatch(world, Math.floor(center.x), Math.floor(center.y), owner, 10);
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) continue;
      if (world.aptMask[idx]) continue;
      if (world.cells[idx] === Cell.WALL || world.cells[idx] === Cell.DOOR) {
        world.hermoWall[idx] = 1;
        world.wallTex[idx] = Tex.HERMO_WALL;
      }
    }
  }
  for (const doorIdx of room.doors) {
    const door = world.doors.get(doorIdx);
    if (door) door.state = DoorState.HERMETIC_OPEN;
    world.hermoWall[doorIdx] = 1;
    world.wallTex[doorIdx] = Tex.HERMO_WALL;
  }
}

function stampSpectralEchoCourts(world: World): Room[] {
  const rooms: Room[] = [];
  const specs = [
    [250, 238, 96, 54],
    [438, 202, 104, 58],
    [646, 238, 96, 54],
    [198, 418, 94, 58],
    [732, 418, 94, 58],
    [208, 570, 96, 58],
    [724, 570, 96, 58],
    [250, 744, 96, 54],
    [628, 744, 104, 54],
    [424, 830, 112, 52],
    [88, 478, 74, 72],
    [862, 478, 74, 72],
  ] as const;
  for (let i = 0; i < specs.length; i++) {
    const [x, y, w, h] = specs[i];
    const type = i % 4 === 0 ? RoomType.COMMON : i % 4 === 1 ? RoomType.PRODUCTION : i % 4 === 2 ? RoomType.STORAGE : RoomType.MEDICAL;
    const room = tryStampSpectralRoom(
      world,
      type,
      x,
      y,
      w,
      h,
      `Эхо-двор спектральной часовни ${i + 1}`,
      i % 3 === 0 ? Tex.CROSS : Tex.GUT,
      i % 3 === 1 ? Tex.F_MEAT : Tex.F_GUT,
      18 + (i % 4) * 6,
    );
    if (!room) continue;
    decorateEchoCourt(world, room, i);
    rooms.push(room);
  }
  return rooms;
}

function stampSpectralOuterDistricts(world: World): Room[] {
  const rooms: Room[] = [];
  const courts = [
    [352, 70, 96, 44, RoomType.COMMON, 'Верхний слуховой двор гражданских помех'],
    [572, 70, 96, 44, RoomType.PRODUCTION, 'Верхняя машинная глухого звона'],
    [352, 908, 96, 44, RoomType.STORAGE, 'Нижний склад сломанных псалмов'],
    [572, 908, 96, 44, RoomType.COMMON, 'Нижний хор без голоса'],
    [48, 300, 58, 92, RoomType.MEDICAL, 'Западный меддвор акустической тени'],
    [48, 632, 58, 92, RoomType.STORAGE, 'Западная кладовая обратного эха'],
    [918, 300, 58, 92, RoomType.PRODUCTION, 'Восточная будка резонаторной пилы'],
    [918, 632, 58, 92, RoomType.COMMON, 'Восточный двор шепчущих свечей'],
  ] as const;
  for (let i = 0; i < courts.length; i++) {
    const [x, y, w, h, type, name] = courts[i];
    const room = tryStampSpectralRoom(world, type, x, y, w, h, name, i % 2 === 0 ? Tex.GUT : Tex.CROSS, i % 2 === 0 ? Tex.F_GUT : Tex.F_MEAT, 20 + (i % 3) * 8);
    if (!room) continue;
    decorateEchoCourt(world, room, i + 20);
    rooms.push(room);
  }

  const perimeter: Room[] = [];
  const types = [RoomType.STORAGE, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.OFFICE, RoomType.SMOKING, RoomType.COMMON] as const;
  for (let i = 0; i < 30; i++) {
    const x = 46 + i * 31;
    const top = tryStampSpectralRoom(world, types[i % types.length], x, 24, 13, 8, `Верхняя микрокелья спектральной стены ${i + 1}`, Tex.GUT, Tex.F_CONCRETE, 22);
    const bottom = tryStampSpectralRoom(world, types[(i + 2) % types.length], x, 988, 13, 8, `Нижняя микрокелья спектральной стены ${i + 1}`, Tex.GUT, Tex.F_CONCRETE, 28);
    if (top) perimeter.push(top);
    if (bottom) perimeter.push(bottom);
  }
  for (let i = 0; i < 28; i++) {
    const y = 88 + i * 30;
    const left = tryStampSpectralRoom(world, types[(i + 1) % types.length], 24, y, 9, 13, `Западная микрокелья спектральной стены ${i + 1}`, Tex.GUT, Tex.F_CONCRETE, 24);
    const right = tryStampSpectralRoom(world, types[(i + 4) % types.length], 991, y, 9, 13, `Восточная микрокелья спектральной стены ${i + 1}`, Tex.GUT, Tex.F_CONCRETE, 24);
    if (left) perimeter.push(left);
    if (right) perimeter.push(right);
  }

  carveWideCorridor(world, 42, 48, 982, 48, 2);
  carveWideCorridor(world, 42, 976, 982, 976, 2);
  carveWideCorridor(world, 48, 42, 48, 982, 2);
  carveWideCorridor(world, 976, 42, 976, 982, 2);
  for (const room of [...rooms, ...perimeter]) {
    const c = roomCenter(room);
    if (c.y < 160) connectRoomToPoint(world, room, c.x, 48);
    else if (c.y > 864) connectRoomToPoint(world, room, c.x, 976);
    else if (c.x < 160) connectRoomToPoint(world, room, 48, c.y);
    else connectRoomToPoint(world, room, 976, c.y);
  }
  rooms.push(...perimeter);
  return rooms;
}

function stampSpectralRingStations(world: World): Room[] {
  const halls: Room[] = [];
  const rings = [
    { radius: 155, yScale: 0.74, count: 16, w: 38, h: 22, label: 'низкий обертон' },
    { radius: 286, yScale: 0.82, count: 24, w: 42, h: 24, label: 'средний обертон' },
    { radius: 412, yScale: 0.88, count: 28, w: 44, h: 24, label: 'дальний обертон' },
  ] as const;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const ringRooms: Room[] = [];
    for (let i = 0; i < ring.count; i++) {
      const angle = (Math.PI * 2 * i) / ring.count + r * 0.17;
      const cx = Math.round(SPECTRAL_CENTER_X + Math.cos(angle) * ring.radius);
      const cy = Math.round(SPECTRAL_CENTER_Y + Math.sin(angle) * ring.radius * ring.yScale);
      const type = i % 6 === 0 ? RoomType.PRODUCTION : i % 5 === 0 ? RoomType.OFFICE : i % 4 === 0 ? RoomType.STORAGE : RoomType.COMMON;
      const hall = tryStampSpectralRoom(
        world,
        type,
        cx - (ring.w >> 1),
        cy - (ring.h >> 1),
        ring.w,
        ring.h,
        `Слуховая станция ${ring.label} ${i + 1}`,
        i % 3 === 0 ? Tex.CROSS : Tex.GUT,
        i % 2 === 0 ? Tex.F_GUT : Tex.F_MEAT,
        18 + r * 8,
      );
      if (!hall) continue;
      decorateStandingWave(world, hall, 3 + ((i + r) % 4));
      ringRooms.push(hall);
      halls.push(hall);
      stampSpectralStationMicroRooms(world, hall, r, i, angle);
    }
    for (let i = 0; i < ringRooms.length; i++) {
      const a = ringRooms[i];
      const b = ringRooms[(i + 1) % ringRooms.length];
      connectCenters(world, a, b);
      if (i % 4 === 0 && ringRooms.length > 6) connectCenters(world, a, ringRooms[(i + Math.floor(ringRooms.length / 2)) % ringRooms.length]);
    }
  }
  return halls;
}

function stampSpectralStationMicroRooms(world: World, hall: Room, ringIndex: number, stationIndex: number, angle: number): void {
  const types = [RoomType.STORAGE, RoomType.BATHROOM, RoomType.KITCHEN, RoomType.OFFICE, RoomType.SMOKING] as const;
  const dirs = [
    { a: angle, dist: 34 },
    { a: angle + Math.PI / 2, dist: 31 },
    { a: angle - Math.PI / 2, dist: 31 },
    { a: angle + Math.PI, dist: 28 },
  ];
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    const w = 10 + ((stationIndex + i) % 3) * 2;
    const h = 7 + ((ringIndex + i) % 2) * 2;
    const c = roomCenter(hall);
    const cx = Math.round(c.x + Math.cos(dir.a) * dir.dist);
    const cy = Math.round(c.y + Math.sin(dir.a) * dir.dist);
    const type = types[(stationIndex + i + ringIndex) % types.length];
    const room = tryStampSpectralRoom(
      world,
      type,
      cx - (w >> 1),
      cy - (h >> 1),
      w,
      h,
      `${hall.name}: микрокелья ${i + 1}`,
      type === RoomType.BATHROOM ? Tex.TILE_W : Tex.GUT,
      type === RoomType.BATHROOM ? Tex.F_TILE : Tex.F_CONCRETE,
      16 + ringIndex * 6,
    );
    if (room) connectCenters(world, hall, room);
  }
}

function carveSpectralMacroNetwork(world: World, rooms: SpectralRooms, halls: readonly Room[], courts: readonly Room[], hqs: readonly Room[]): void {
  const innerNorth = roomByNearestAngle(halls, -Math.PI / 2);
  const innerEast = roomByNearestAngle(halls, 0);
  const innerSouth = roomByNearestAngle(halls, Math.PI / 2);
  const innerWest = roomByNearestAngle(halls, Math.PI);
  for (const room of [innerNorth, innerEast, innerSouth, innerWest]) {
    if (room) connectCenters(world, rooms.nave, room);
  }

  carveWideCorridor(world, SPECTRAL_CENTER_X, SPECTRAL_CENTER_Y, 0, SPECTRAL_CENTER_Y, 3);
  carveWideCorridor(world, SPECTRAL_CENTER_X, SPECTRAL_CENTER_Y, W - 1, SPECTRAL_CENTER_Y, 3);
  carveWideCorridor(world, SPECTRAL_CENTER_X, SPECTRAL_CENTER_Y, SPECTRAL_CENTER_X, 0, 3);
  carveWideCorridor(world, SPECTRAL_CENTER_X, SPECTRAL_CENTER_Y, SPECTRAL_CENTER_X, W - 1, 3);
  carveWideCorridor(world, 96, 96, 928, 928, 2);
  carveWideCorridor(world, 928, 96, 96, 928, 2);

  for (let i = 0; i < courts.length; i++) {
    const nearest = roomByNearestAngle(halls, Math.atan2(roomCenter(courts[i]).y - SPECTRAL_CENTER_Y, roomCenter(courts[i]).x - SPECTRAL_CENTER_X));
    if (nearest) connectCenters(world, courts[i], nearest);
    if (i > 0 && i % 3 !== 0) connectCenters(world, courts[i - 1], courts[i]);
  }
  for (const hq of hqs) {
    const c = roomCenter(hq);
    const nearest = roomByNearestAngle(halls, Math.atan2(c.y - SPECTRAL_CENTER_Y, c.x - SPECTRAL_CENTER_X));
    if (nearest) connectCenters(world, hq, nearest);
    else connectRoomToPoint(world, hq, SPECTRAL_CENTER_X, SPECTRAL_CENTER_Y);
  }
}

function expandSpectralRouteGeometry(world: World, rooms: SpectralRooms): void {
  const hqRooms: Room[] = [];
  for (const spec of SPECTRAL_HQ_SPECS) {
    const compoundRooms = stampSpectralHqCompound(world, spec);
    for (let i = 0; i < compoundRooms.length; i++) {
      if (compoundRooms[i].type === RoomType.HQ) {
        hqRooms.push(compoundRooms[i]);
      }
    }
  }
  const courts = stampSpectralEchoCourts(world);
  const outer = stampSpectralOuterDistricts(world);
  const halls = stampSpectralRingStations(world);
  carveSpectralMacroNetwork(world, rooms, halls, [...courts, ...outer], hqRooms);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(false);
  world.markFogDirty();
}

function buildRooms(world: World): SpectralRooms {
  const cx = W >> 1;
  const cy = W >> 1;
  const rooms = {
    entry: stampSpectralRoom(world, RoomType.CORRIDOR, cx - 70, cy - 7, 20, 14, SPECTRAL_CHASOVNYA_ROOM_NAMES.entry, Tex.GUT, Tex.F_CONCRETE, 8),
    nave: stampSpectralRoom(world, RoomType.HQ, cx - 35, cy - 16, 42, 32, SPECTRAL_CHASOVNYA_ROOM_NAMES.nave, Tex.CROSS, Tex.F_MEAT, 18),
    bellCage: stampSpectralRoom(world, RoomType.PRODUCTION, cx - 7, cy - 58, 18, 24, SPECTRAL_CHASOVNYA_ROOM_NAMES.bellCage, Tex.METAL, Tex.F_GUT, 22),
    radioSacristy: stampSpectralRoom(world, RoomType.OFFICE, cx + 23, cy - 38, 26, 18, SPECTRAL_CHASOVNYA_ROOM_NAMES.radioSacristy, Tex.SCREEN_BASE, Tex.F_TILE, 12),
    quietNorth: stampSpectralRoom(world, RoomType.STORAGE, cx - 62, cy - 42, 24, 18, SPECTRAL_CHASOVNYA_ROOM_NAMES.quietNorth, Tex.DARK, Tex.F_VOID, 52),
    quietSouth: stampSpectralRoom(world, RoomType.STORAGE, cx - 62, cy + 25, 24, 18, SPECTRAL_CHASOVNYA_ROOM_NAMES.quietSouth, Tex.DARK, Tex.F_VOID, 52),
    focusArch: stampSpectralRoom(world, RoomType.COMMON, cx + 31, cy - 3, 32, 14, SPECTRAL_CHASOVNYA_ROOM_NAMES.focusArch, Tex.MEAT, Tex.F_GUT, 30),
    crypt: stampSpectralRoom(world, RoomType.MEDICAL, cx + 16, cy + 29, 30, 20, SPECTRAL_CHASOVNYA_ROOM_NAMES.crypt, Tex.MEAT, Tex.F_GUT, 28),
    exit: stampSpectralRoom(world, RoomType.CORRIDOR, cx + 72, cy - 6, 20, 14, SPECTRAL_CHASOVNYA_ROOM_NAMES.exit, Tex.GUT, Tex.F_CONCRETE, 16),
  };

  connectCenters(world, rooms.entry, rooms.nave);
  connectCenters(world, rooms.nave, rooms.bellCage);
  connectCenters(world, rooms.nave, rooms.radioSacristy);
  connectCenters(world, rooms.nave, rooms.quietNorth);
  connectCenters(world, rooms.nave, rooms.quietSouth);
  connectCenters(world, rooms.nave, rooms.focusArch);
  connectCenters(world, rooms.focusArch, rooms.exit);
  connectCenters(world, rooms.focusArch, rooms.crypt);
  connectCenters(world, rooms.quietNorth, rooms.radioSacristy);
  connectCenters(world, rooms.quietSouth, rooms.crypt);

  decorateStandingWave(world, rooms.nave, 5);
  decorateStandingWave(world, rooms.bellCage, 4);
  decorateStandingWave(world, rooms.focusArch, 3);
  return rooms;
}

function dressRooms(world: World, rooms: SpectralRooms): void {
  placeLift(world, rooms.entry, rooms.entry.x + 4, rooms.entry.y + (rooms.entry.h >> 1), LiftDirection.UP);
  placeLift(world, rooms.exit, rooms.exit.x + rooms.exit.w - 5, rooms.exit.y + (rooms.exit.h >> 1), LiftDirection.DOWN);

  for (let x = rooms.nave.x + 4; x < rooms.nave.x + rooms.nave.w - 3; x += 7) {
    placeFeature(world, x, rooms.nave.y + 3, Feature.CANDLE);
    placeFeature(world, x, rooms.nave.y + rooms.nave.h - 4, Feature.CANDLE);
  }
  placeFeature(world, rooms.bellCage.x + (rooms.bellCage.w >> 1), rooms.bellCage.y + 5, Feature.APPARATUS);
  placeFeature(world, rooms.bellCage.x + (rooms.bellCage.w >> 1), rooms.bellCage.y + 9, Feature.MACHINE);
  placeFeature(world, rooms.radioSacristy.x + 4, rooms.radioSacristy.y + 4, Feature.SCREEN);
  placeFeature(world, rooms.radioSacristy.x + rooms.radioSacristy.w - 5, rooms.radioSacristy.y + 5, Feature.APPARATUS);
  placeFeature(world, rooms.quietNorth.x + 3, rooms.quietNorth.y + 3, Feature.CANDLE);
  placeFeature(world, rooms.quietSouth.x + rooms.quietSouth.w - 4, rooms.quietSouth.y + rooms.quietSouth.h - 4, Feature.CANDLE);
  placeFeature(world, rooms.focusArch.x + rooms.focusArch.w - 5, rooms.focusArch.y + (rooms.focusArch.h >> 1), Feature.APPARATUS);
  placeFeature(world, rooms.crypt.x + 4, rooms.crypt.y + rooms.crypt.h - 5, Feature.SHELF);
}

function tuneZones(world: World): void {
  for (const zone of world.zones) {
    const d = world.dist(zone.cx, zone.cy, W / 2, W / 2);
    zone.level = Math.max(4, Math.min(7, 4 + Math.floor(d / 260)));
    zone.faction = zone.id % 5 === 0 ? ZoneFaction.SAMOSBOR : ZoneFaction.CULTIST;
    zone.fogged = false;
  }
}

function makeStandingWaveRoom(id: string, room: Room, wavelengthCells: number, pressure: SpectralStandingWaveRoom['pressure'], decisions: SpectralDecision[], tags: string[]): SpectralStandingWaveRoom {
  const c = roomCenter(room);
  return {
    id,
    roomName: room.name,
    roomId: room.id,
    x: c.x,
    y: c.y,
    wavelengthCells,
    pressure,
    decisions,
    tags,
  };
}

function makeShadowZone(world: World, id: string, room: Room, radius: number, decisions: SpectralDecision[], tags: string[]): SpectralShadowZone {
  const c = roomCenter(room);
  return {
    id,
    roomName: room.name,
    roomId: room.id,
    x: c.x,
    y: c.y,
    radius,
    coverCells: countRoomFloorCells(world, room),
    decisions,
    tags,
  };
}

function makeBellNode(id: string, room: Room, x: number, y: number, radius: number, tags: string[]): SpectralBellNode {
  return {
    id,
    roomName: room.name,
    roomId: room.id,
    x: x + 0.5,
    y: y + 0.5,
    radius,
    cooldownSec: BELL_COOLDOWN_SEC,
    pulseTags: tags,
    decisions: ['ring_bell', 'flee'],
  };
}

function buildSpectralState(world: World, rooms: SpectralRooms): SpectralChasovnyaState {
  const standingWaveRooms = [
    makeStandingWaveRoom('nave_mode_low', rooms.nave, 10, 3, ['move_silently', 'fire_loudly'], ['standing_wave', 'nave', 'low_mode']),
    makeStandingWaveRoom('bell_mode_high', rooms.bellCage, 7, 5, ['ring_bell', 'flee'], ['standing_wave', 'bell', 'high_mode']),
    makeStandingWaveRoom('focus_mode_line', rooms.focusArch, 6, 5, ['avoid_focus', 'fire_loudly'], ['standing_wave', 'focus', 'monster_line']),
    makeStandingWaveRoom('crypt_mode_chor', rooms.crypt, 9, 4, ['listen_radio', 'move_silently'], ['standing_wave', 'crypt', 'choir']),
  ];
  const shadowZones = [
    makeShadowZone(world, 'north_shadow', rooms.quietNorth, 12, ['move_silently', 'flee'], ['acoustic_shadow', 'quiet_route']),
    makeShadowZone(world, 'south_shadow', rooms.quietSouth, 12, ['move_silently', 'flee'], ['acoustic_shadow', 'quiet_route']),
    makeShadowZone(world, 'radio_shadow', rooms.radioSacristy, 9, ['listen_radio', 'move_silently'], ['acoustic_shadow', 'radio']),
  ];
  const bellNodes = [
    makeBellNode('main_bell_pull', rooms.bellCage, rooms.bellCage.x + (rooms.bellCage.w >> 1), rooms.bellCage.y + 5, 32, ['main_bell', 'sound_bait', 'cult']),
    makeBellNode('crypt_handbell', rooms.crypt, rooms.crypt.x + 4, rooms.crypt.y + rooms.crypt.h - 5, 20, ['handbell', 'sound_bait', 'crypt']),
  ];
  return {
    routeId: SPECTRAL_CHASOVNYA_ROUTE_ID,
    z: SPECTRAL_CHASOVNYA_Z,
    baseFloor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    standingWaveRooms,
    shadowZones,
    bellNodes,
    acousticBands: [
      {
        id: 'laplacian_low_bell_band',
        modeIndex: 2,
        frequencyHint: 'низкий колокол ведёт угрозу к клетке',
        standingWaveRoomIds: [rooms.nave.id, rooms.bellCage.id],
        shadowRoomIds: [rooms.quietNorth.id, rooms.quietSouth.id],
        bellNodeIds: ['main_bell_pull'],
        tags: ['graph_laplacian', 'low_band', 'bell'],
      },
      {
        id: 'radio_side_shadow_band',
        modeIndex: 5,
        frequencyHint: 'радио глушит боковые шаги',
        standingWaveRoomIds: [rooms.radioSacristy.id, rooms.crypt.id],
        shadowRoomIds: [rooms.radioSacristy.id],
        bellNodeIds: ['crypt_handbell'],
        tags: ['graph_laplacian', 'radio', 'shadow_zone'],
      },
      {
        id: 'focus_warning_band',
        modeIndex: 8,
        frequencyHint: 'фокусирующая арка усиливает выстрел и открывает линию слепым',
        standingWaveRoomIds: [rooms.focusArch.id],
        shadowRoomIds: [rooms.quietNorth.id, rooms.quietSouth.id],
        bellNodeIds: ['main_bell_pull', 'crypt_handbell'],
        tags: ['graph_laplacian', 'focus', 'sound_monster'],
      },
    ],
    rungBellNodeIds: [],
    lastBellPulseAt: -Infinity,
  };
}

function spawnPlotNpc(entities: Entity[], nextId: NextId, npcId: typeof NPC_ID, _def: PlotNpcDef, x: number, y: number, angle: number): number {
  const px = x + 0.5;
  const py = y + 0.5;
  const npc = requireSpawnedPlotNpcFromPackage(entities, nextId, npcId, px, py, {
    angle,
    aiTarget: { x: px, y: py },
  });
  return npc.id;
}

function spawnSpectralMonster(
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
  name: string,
  level: number,
): void {
  const def = MONSTERS[kind];
  if (!def) return;
  const id = nextId.v++;
  const hp = Math.round(def.hp * (0.9 + level * 0.16));
  entities.push({
    id,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: (id * 0.771) % (Math.PI * 2),
    pitch: 0,
    alive: true,
    speed: def.speed * (1.02 + level * 0.025),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT || kind === MonsterKind.SHADOW || kind === MonsterKind.TONKAYA_TEN || kind === MonsterKind.GLUBINNAYA_TEN,
  });
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(container => container.id === id)) id++;
  return id;
}

function addSpectralContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  tags: string[],
): void {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: world.wrap(x),
    y: world.wrap(y),
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory,
    capacitySlots: 6,
    access,
    lockDifficulty: access === 'locked' ? 4 : undefined,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  placeFeature(world, x, y, kind === ContainerKind.FILING_CABINET ? Feature.SHELF : Feature.APPARATUS);
}

function placeContent(world: World, entities: Entity[], nextId: NextId, rooms: SpectralRooms): void {
  spawnPlotNpc(entities, nextId, NPC_ID, MIRON_DEF, rooms.quietNorth.x + 5, rooms.quietNorth.y + 7, 0);
  spawnSpectralMonster(entities, nextId, MonsterKind.SLEPOGLAZ, rooms.focusArch.x + rooms.focusArch.w - 6, rooms.focusArch.y + 7, 'Слепоглаз у фокусирующей арки', 7);
  spawnSpectralMonster(entities, nextId, MonsterKind.TUMANNIK, rooms.nave.x + rooms.nave.w - 8, rooms.nave.y + 8, 'Туманник стоячей волны', 6);
  spawnSpectralMonster(entities, nextId, MonsterKind.GLUBINNAYA_TEN, rooms.crypt.x + rooms.crypt.w - 7, rooms.crypt.y + 12, 'Глубинная тень нижнего хора', 7);
  spawnSpectralMonster(entities, nextId, MonsterKind.SPIRIT, rooms.bellCage.x + 6, rooms.bellCage.y + 14, 'Дух с языком колокола', 6);

  addSpectralContainer(world, rooms.radioSacristy, rooms.radioSacristy.x + rooms.radioSacristy.w - 5, rooms.radioSacristy.y + 5, ContainerKind.FILING_CABINET, 'Шкаф радиоризницы с настройками тишины', 'locked', [
    { defId: 'radio_headset_liquidator', count: 1 },
    { defId: 'sound_emitter', count: 1 },
    { defId: 'field_radio_battery', count: 2 },
  ], ['spectral_chasovnya', 'radio', 'hearing_boost', 'locked']);
  addSpectralContainer(world, rooms.bellCage, rooms.bellCage.x + 5, rooms.bellCage.y + rooms.bellCage.h - 5, ContainerKind.SECRET_STASH, 'Ниша под главным колоколом', 'secret', [
    { defId: 'istotit_candle', count: 1 },
    { defId: 'bottled_voice', count: 1 },
  ], ['spectral_chasovnya', 'bell', 'psi', 'secret']);
  addSpectralContainer(world, rooms.crypt, rooms.crypt.x + 4, rooms.crypt.y + rooms.crypt.h - 5, ContainerKind.METAL_CABINET, 'Костяной ящик нижнего хора', 'public', [
    { defId: 'ammo_energy', count: 1 },
    { defId: 'radio_jammer', count: 1 },
  ], ['spectral_chasovnya', 'crypt', 'sound_counterplay']);
}

export function reinforceSpectralChasovnyaAuthoredHqTerritory(world: World): void {
  for (const spec of SPECTRAL_HQ_SPECS) {
    const hq = world.rooms.find(room => room?.name === spec.hq.name);
    if (hq) hardenSpectralHqCore(world, hq, spec.owner);
    for (const support of spec.support) {
      const room = world.rooms.find(candidate => candidate?.name === support.name);
      if (room) paintRoomOwner(world, room, spec.owner);
    }
    if (hq) {
      const c = roomCenter(hq);
      paintOwnerPatch(world, Math.floor(c.x), Math.floor(c.y), spec.owner, 22);
    }
  }
  syncZoneMetadataFromTerritory(world);
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function ambientSpectralNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    entity.name?.startsWith(SPECTRAL_AMBIENT_NPC_PREFIX) === true &&
    entity.faction !== undefined;
}

export function alignSpectralChasovnyaAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const slots = new Map<TerritoryOwner, number[]>();
  for (let idx = 0; idx < world.cells.length; idx++) {
    if (world.cells[idx] !== Cell.FLOOR || world.features[idx] !== Feature.NONE || world.containerMap.has(idx)) continue;
    const owner = territoryOwnerAtIndex(world, idx);
    if (owner === ZoneFaction.SAMOSBOR) continue;
    let list = slots.get(owner);
    if (!list) {
      list = [];
      slots.set(owner, list);
    }
    list.push(idx);
  }

  const used = new Set<number>();
  for (const entity of entities) {
    if (!ambientSpectralNpc(entity)) continue;
    const owner = factionToTerritoryOwner(entity.faction!);
    const list = slots.get(owner);
    if (!list || list.length === 0) continue;
    let pickIndex = (entity.id * 1103515245 + owner * 97) >>> 0;
    let cell = -1;
    for (let attempt = 0; attempt < Math.min(96, list.length); attempt++) {
      const candidate = list[(pickIndex + attempt * 37) % list.length];
      if (used.has(candidate)) continue;
      cell = candidate;
      break;
    }
    if (cell < 0) cell = list[pickIndex % list.length];
    used.add(cell);
    entity.x = (cell % W) + 0.5;
    entity.y = ((cell / W) | 0) + 0.5;
    if (entity.ai) {
      entity.ai.tx = entity.x;
      entity.ai.ty = entity.y;
      entity.ai.path.length = 0;
      entity.ai.pi = 0;
    }
  }
}

function registerQuietShadowRouteCue(world: World, rooms: SpectralRooms): void {
  const entry = roomCenter(rooms.entry);
  const quiet = roomCenter(rooms.quietSouth);

  registerRouteCue(world, {
    id: 'spectral_quiet_shadow_route',
    x: entry.x,
    y: entry.y,
    targetX: quiet.x,
    targetY: quiet.y,
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    label: 'Тихая тень',
    hint: 'Боковая зона гасит шаги. Хороший путь, если не стрелять.',
    targetName: rooms.quietSouth.name,
    color: '#8cf',
    tags: ['spectral_chasovnya', 'acoustic_shadow', 'quiet_route'],
    toneSeed: 0x5ec7a1,
    roomId: rooms.entry.id,
    targetRoomId: rooms.quietSouth.id,
    heardText: 'Сбоку нет эха: туда можно пройти тише, чем через неф.',
    followedText: 'Акустическая тень держит шаг. Слепые слушают не здесь.',
    ignoredText: 'Тихая тень осталась сбоку; впереди звук собирается в линию.',
    routeGroup: {
      id: 'spectral_shadow_choice',
      lead: 'Тень сбоку гасит шаг.',
      risk: 'Дольше, но меньше шума.',
      decision: 'идти тихо через боковую тень',
      reward: 'обход фокусирующей арки',
      mapLabel: 'тихий обход',
    },
  });
}

function registerMainBellRouteCue(world: World, rooms: SpectralRooms, state: SpectralChasovnyaState): void {
  const bell = state.bellNodes[0];

  registerRouteCue(world, {
    id: 'spectral_main_bell_route',
    x: rooms.nave.x + 4,
    y: rooms.nave.y + 4,
    targetX: bell.x,
    targetY: bell.y,
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    label: 'Колокол',
    hint: 'Звон собирает слуховых тварей к клетке. Это не защита, а отвлечение.',
    targetName: rooms.bellCage.name,
    color: '#d6a64b',
    tags: ['spectral_chasovnya', 'bell', 'sound_bait'],
    toneSeed: 0x5ec7b11,
    roomId: rooms.nave.id,
    targetRoomId: rooms.bellCage.id,
    heardText: 'Над нефом висит низкий колокол. Веревка выглядит рабочей.',
    followedText: 'Веревка колокола найдена. Если дернуть, шум уйдет не только к тебе.',
    ignoredText: 'Колокол молчит. В фокусирующей арке слышно каждый патрон.',
    routeGroup: {
      id: 'spectral_bell_choice',
      lead: 'Колокол может стянуть угрозу.',
      risk: 'После звона лучше уйти сразу.',
      decision: 'позвонить и сменить маршрут',
      reward: 'локальный шумовой приманивающий импульс',
      mapLabel: 'колокол',
    },
  });
}

function registerFocusWarningRouteCue(world: World, rooms: SpectralRooms): void {
  const focus = roomCenter(rooms.focusArch);

  registerRouteCue(world, {
    id: 'spectral_focus_warning_route',
    x: rooms.nave.x + rooms.nave.w - 4,
    y: rooms.nave.y + (rooms.nave.h >> 1),
    targetX: focus.x,
    targetY: focus.y,
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    label: 'Слуховой фокус',
    hint: 'Выстрел здесь раскрывает линию слепым. Приманка или тихий обход лучше прямого боя.',
    targetName: rooms.focusArch.name,
    color: '#f66',
    tags: ['spectral_chasovnya', 'standing_wave', 'sound_focus', 'monster_warning'],
    toneSeed: 0x5ec7f0c,
    roomId: rooms.nave.id,
    targetRoomId: rooms.focusArch.id,
    heardText: 'Арка впереди усиливает щелчок затвора. Там не нужно проверять оружие.',
    followedText: 'Линия фокуса видна по мокрым ребрам пола. Двигайся боком или шуми не здесь.',
    ignoredText: 'Фокусирующая арка осталась на прямой. Слепые любят прямые.',
  });
}

function registerRadioSacristyRouteCue(world: World, rooms: SpectralRooms): void {
  const radio = roomCenter(rooms.radioSacristy);

  registerRouteCue(world, {
    id: 'spectral_radio_sacristy_route',
    x: rooms.quietNorth.x + rooms.quietNorth.w - 3,
    y: rooms.quietNorth.y + 4,
    targetX: radio.x,
    targetY: radio.y,
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    label: 'Радиоризница',
    hint: 'Радиоузел дает предметы для слуха и глушения, но шкаф заперт.',
    targetName: rooms.radioSacristy.name,
    color: '#63f6ff',
    tags: ['spectral_chasovnya', 'radio', 'hearing_boost', 'quest_target'],
    toneSeed: 0x5ec7ad1,
    roomId: rooms.quietNorth.id,
    targetRoomId: rooms.radioSacristy.id,
    heardText: 'За тенью трещит радиоризница. Там звук не идёт прямо.',
    followedText: 'Радиоризница найдена. Гарнитура здесь полезнее громкого героизма.',
    ignoredText: 'Радиотреск уходит за свечи. Без него придется слушать своими ушами.',
  });
}

function registerSpectralRouteCues(world: World, rooms: SpectralRooms, state: SpectralChasovnyaState): void {
  registerQuietShadowRouteCue(world, rooms);
  registerMainBellRouteCue(world, rooms, state);
  registerFocusWarningRouteCue(world, rooms);
  registerRadioSacristyRouteCue(world, rooms);
}

function findBellNodeForLook(world: World, player: Entity, lookX: number, lookY: number): SpectralBellNode | undefined {
  const state = ensureSpectralChasovnyaState(world);
  if (!state) return undefined;
  const lx = Math.floor(lookX) + 0.5;
  const ly = Math.floor(lookY) + 0.5;
  let best: SpectralBellNode | undefined;
  let bestD2 = Infinity;
  for (const node of state.bellNodes) {
    if (world.dist2(player.x, player.y, node.x, node.y) > BELL_INTERACTION_RANGE * BELL_INTERACTION_RANGE) continue;
    const d2 = world.dist2(lx, ly, node.x, node.y);
    if (d2 > BELL_LOOK_RADIUS * BELL_LOOK_RADIUS || d2 >= bestD2) continue;
    best = node;
    bestD2 = d2;
  }
  return best;
}

export function ringSpectralChasovnyaBell(
  world: World,
  state: GameState,
  player: Entity,
  entities: readonly Entity[],
  nodeId?: string,
): boolean {
  const spectral = ensureSpectralChasovnyaState(world);
  if (!spectral) return false;
  const node = nodeId
    ? spectral.bellNodes.find(candidate => candidate.id === nodeId)
    : spectral.bellNodes[0];
  if (!node) return false;
  const elapsed = state.time - spectral.lastBellPulseAt;
  if (elapsed < node.cooldownSec) {
    state.msgs.push(msg('Колокол ещё дрожит. Новый звон сольётся с предыдущим.', state.time, '#888'));
    return true;
  }

  spectral.lastBellPulseAt = state.time;
  if (!spectral.rungBellNodeIds.includes(node.id)) spectral.rungBellNodeIds.push(node.id);
  const noise = publishNoise(state, {
    x: node.x,
    y: node.y,
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    radius: node.radius,
    ttl: 4.0,
    source: 'siren',
    severity: 4,
    actorId: player.id,
    actorFaction: player.faction,
    tags: ['spectral_chasovnya', 'bell', ...node.pulseTags],
  });

  let pulled = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.MONSTER || !entity.ai) continue;
    if (world.dist2(entity.x, entity.y, node.x, node.y) > node.radius * node.radius) continue;
    if (
      entity.monsterKind !== MonsterKind.SLEPOGLAZ &&
      entity.monsterKind !== MonsterKind.TUMANNIK &&
      entity.monsterKind !== MonsterKind.SPIRIT &&
      entity.monsterKind !== MonsterKind.SHADOW &&
      entity.monsterKind !== MonsterKind.TONKAYA_TEN &&
      entity.monsterKind !== MonsterKind.GLUBINNAYA_TEN
    ) continue;
    entity.ai.goal = AIGoal.HUNT;
    entity.ai.tx = node.x;
    entity.ai.ty = node.y;
    entity.ai.path.length = 0;
    entity.ai.pi = 0;
    entity.ai.timer = Math.max(entity.ai.timer, 2.5);
    pulled++;
  }

  state.msgs.push(msg(pulled > 0
    ? `Колокол ударил низко. Слуховые твари сдвинулись к звону: ${pulled}.`
    : 'Колокол ударил низко. Эхо ушло в боковые тени.', state.time, '#d6a64b'));
  publishEvent(state, {
    type: 'monster_bait_placed',
    floor: SPECTRAL_CHASOVNYA_BASE_FLOOR,
    roomId: node.roomId,
    x: node.x,
    y: node.y,
    actorId: player.id,
    actorFaction: player.faction,
    severity: 4,
    privacy: 'local',
    tags: ['spectral_chasovnya', 'bell', 'sound_bait', 'local_pulse'],
    data: {
      routeId: spectral.routeId,
      nodeId: node.id,
      noiseId: noise?.id,
      pulledMonsters: pulled,
      counterplay: 'ring_bell_then_move_through_acoustic_shadow',
    },
  });
  return true;
}

registerContentInteractionHook({
  id: 'spectral_chasovnya_bell',
  target(ctx) {
    const node = findBellNodeForLook(ctx.world, ctx.player, ctx.lookX, ctx.lookY);
    if (!node) return null;
    return {
      id: 744000 + node.roomId,
      targetId: 'spectral_chasovnya_bell',
      x: node.x,
      y: node.y,
      priority: 74,
      prompt: ' колокол',
    };
  },
  use(ctx) {
    const node = findBellNodeForLook(ctx.world, ctx.player, ctx.lookX, ctx.lookY);
    if (!node) return null;
    return { handled: ringSpectralChasovnyaBell(ctx.world, ctx.state, ctx.player, ctx.entities, node.id), worldChanged: false };
  },
});

export function generateSpectralChasovnyaDesignFloor(): SpectralChasovnyaGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId: NextId = { v: 1 };

  world.wallTex.fill(Tex.GUT);
  world.floorTex.fill(Tex.F_GUT);
  world.fog.fill(22);

  const rooms = buildRooms(world);
  expandSpectralRouteGeometry(world, rooms);
  const spawnX = rooms.entry.x + 8.5;
  const spawnY = rooms.entry.y + (rooms.entry.h >> 1) + 0.5;
  dressRooms(world, rooms);
  generateZones(world);
  tuneZones(world);
  placeContent(world, entities, nextId, rooms);
  const spectralState = buildSpectralState(world, rooms);
  registerSpectralRouteCues(world, rooms, spectralState);
  ensureConnectivity(world, spawnX, spawnY);
  sanitizeDoors(world);
  world.bakeLights();
  spectralStateByWorld.set(world, spectralState);
  return { world, entities, spawnX, spawnY, spectralState };
}
