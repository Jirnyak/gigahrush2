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
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Item,
  type Room,
  type TerritoryOwner,
  type WorldContainer,
} from '../../core/types';
import { World } from '../../core/world';
import { hashSeed, withSeededRandom } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../../data/factions';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG } from '../../systems/rpg';
import { ensureConnectivity, generateZones, sanitizeDoors, stampRoom } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

export const MOEBIUS_PODEZD_ROUTE_ID = 'moebius_podezd' as const;
export const MOEBIUS_PODEZD_Z = 2;
export const MOEBIUS_PODEZD_BASE_FLOOR = FloorLevel.KVARTIRY;
export const MOEBIUS_PODEZD_SEED = hashSeed(MOEBIUS_PODEZD_ROUTE_ID);

export const MOEBIUS_PODEZD_ROOM_NAMES = {
  upperStrip: 'Жилая полоса Мёбиуса А',
  lowerStrip: 'Жилая полоса Мёбиуса Б',
  westLoop: 'Безопасная публичная петля западного пролёта',
  eastLoop: 'Безопасная публичная петля восточного пролёта',
  shortcut: 'Рискованный паритетный шов',
  seamNorth: 'Парный шов Мёбиуса северный ориентир',
  seamSouth: 'Парный шов Мёбиуса южный ориентир',
  lostMarker: 'Кладовка потерянной маршрутной метки',
} as const;

interface OpenRoomSpec {
  type: RoomType;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  floorTex: Tex;
  wallTex: Tex;
}

interface MoebiusRooms {
  upperStrip: Room;
  lowerStrip: Room;
  westLoop: Room;
  eastLoop: Room;
  shortcut: Room;
  seamNorth: Room;
  seamSouth: Room;
  lostMarker: Room;
  mirroredFlats: Room[];
}

interface NextId {
  v: number;
}

type DoorSide = 'north' | 'south' | 'west' | 'east';

interface DoorSite {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

interface MoebiusDistrictSpec {
  x: number;
  y: number;
  cols: number;
  rows: number;
  linkX: number;
  linkY: number;
  name: string;
  owner: TerritoryOwner;
  reverse: boolean;
  wallTex: Tex;
  floorTex: Tex;
}

interface MoebiusHqSite {
  owner: TerritoryOwner;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  linkX: number;
  linkY: number;
  wallTex: Tex;
  floorTex: Tex;
}

interface MoebiusStationSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  type: RoomType;
  name: string;
  owner: TerritoryOwner;
  linkX: number;
  linkY: number;
  wallTex: Tex;
  floorTex: Tex;
}

const LOOP_LEFT = 168;
const LOOP_RIGHT = 856;
const UPPER_Y = 398;
const LOWER_Y = 612;
const STRIP_H = 14;
const CONNECTOR_W = 14;
const SHORTCUT_X = 504;
const SHORTCUT_Y = UPPER_Y + STRIP_H;
const SHORTCUT_W = 17;
const SHORTCUT_H = LOWER_Y - SHORTCUT_Y;
const NORTH_GATE_Y = 492;
const SOUTH_GATE_Y = 528;
const SEAM_KEY_ID = 'rubber_door_wedge';
const FLAT_LABELS = ['17-А', '17-Б', '18-А', '18-Б', '19-А', '19-Б', '20-А', '20-Б'] as const;
const MICRO_ROOM_W = 18;
const MICRO_ROOM_H = 11;
const MICRO_GAP_X = 6;
const MICRO_GAP_Y = 5;
const MICRO_SPINE_H = 8;

const MOEBIUS_HQ_SITES: readonly MoebiusHqSite[] = [
  { owner: ZoneFaction.CITIZEN, x: 74, y: 458, w: 42, h: 24, name: 'Герметичный штаб жильцов прямой стороны', linkX: 184, linkY: 512, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { owner: ZoneFaction.LIQUIDATOR, x: 760, y: 454, w: 40, h: 22, name: 'Герметичный штаб ликвидаторов обратного обхода', linkX: 842, linkY: 512, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { owner: ZoneFaction.CULTIST, x: 876, y: 686, w: 34, h: 20, name: 'Скрытый культовый штаб паритетного шва', linkX: 846, linkY: 619, wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
  { owner: ZoneFaction.SCIENTIST, x: 458, y: 248, w: 40, h: 22, name: 'Герметичный штаб учёных зеркального паритета', linkX: 512, linkY: 398, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { owner: ZoneFaction.WILD, x: 72, y: 688, w: 36, h: 20, name: 'Разорённый штаб диких у нижней петли', linkX: 178, linkY: 619, wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
] as const;

const MOEBIUS_DISTRICTS: readonly MoebiusDistrictSpec[] = [
  { x: 52, y: 74, cols: 11, rows: 5, linkX: 184, linkY: 405, name: 'Северо-западная зеркальная гряда', owner: ZoneFaction.CITIZEN, reverse: false, wallTex: Tex.PANEL, floorTex: Tex.F_CARPET },
  { x: 362, y: 78, cols: 12, rows: 5, linkX: 512, linkY: 398, name: 'Северная лабораторная гряда паритета', owner: ZoneFaction.SCIENTIST, reverse: true, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { x: 696, y: 76, cols: 11, rows: 5, linkX: 846, linkY: 405, name: 'Северо-восточная гряда обратного обхода', owner: ZoneFaction.LIQUIDATOR, reverse: false, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { x: 62, y: 236, cols: 10, rows: 5, linkX: 184, linkY: 405, name: 'Западный подъезд повторной нумерации', owner: ZoneFaction.CITIZEN, reverse: true, wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
  { x: 714, y: 236, cols: 10, rows: 5, linkX: 846, linkY: 405, name: 'Восточный подъезд служебной нумерации', owner: ZoneFaction.LIQUIDATOR, reverse: true, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { x: 72, y: 706, cols: 10, rows: 5, linkX: 178, linkY: 619, name: 'Западная нижняя гряда сбитых дверей', owner: ZoneFaction.WILD, reverse: false, wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
  { x: 714, y: 704, cols: 10, rows: 5, linkX: 846, linkY: 619, name: 'Восточная нижняя гряда шовных слухов', owner: ZoneFaction.CULTIST, reverse: false, wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
  { x: 50, y: 852, cols: 11, rows: 5, linkX: 178, linkY: 619, name: 'Юго-западная жилая лента возвращения', owner: ZoneFaction.CITIZEN, reverse: true, wallTex: Tex.PANEL, floorTex: Tex.F_CARPET },
  { x: 362, y: 848, cols: 12, rows: 5, linkX: 512, linkY: 626, name: 'Южная кладовая лента маршрутных меток', owner: ZoneFaction.WILD, reverse: false, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
  { x: 698, y: 852, cols: 11, rows: 5, linkX: 846, linkY: 619, name: 'Юго-восточная обратная лента печатей', owner: ZoneFaction.CULTIST, reverse: true, wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
] as const;

const MOEBIUS_STATIONS: readonly MoebiusStationSpec[] = [
  { x: 278, y: 292, w: 70, h: 34, type: RoomType.KITCHEN, name: 'Станция кипятка на прямой стороне Мёбиуса', owner: ZoneFaction.CITIZEN, linkX: 256, linkY: 405, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
  { x: 636, y: 292, w: 72, h: 34, type: RoomType.OFFICE, name: 'Станция сверки обратной стороны Мёбиуса', owner: ZoneFaction.LIQUIDATOR, linkX: 768, linkY: 405, wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
  { x: 318, y: 666, w: 76, h: 36, type: RoomType.STORAGE, name: 'Склад одинаковых дверей нижней стороны', owner: ZoneFaction.WILD, linkX: 256, linkY: 619, wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
  { x: 620, y: 666, w: 74, h: 36, type: RoomType.COMMON, name: 'Круг слушателей паритетного шва', owner: ZoneFaction.CULTIST, linkX: 768, linkY: 619, wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
  { x: 466, y: 704, w: 58, h: 38, type: RoomType.MEDICAL, name: 'Пункт измерения тошноты от ориентации', owner: ZoneFaction.SCIENTIST, linkX: 512, linkY: 626, wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
] as const;

export interface MoebiusPodezdDecisionMetrics {
  mirroredFlatRooms: number;
  residentialStrips: number;
  seamLandmarks: number;
  seamLockedDoors: number;
  mirrorTellContainers: number;
  routeMarkerContainers: number;
  reversedPatrolNpcs: number;
  seamHunterMonsters: number;
}

export function generateMoebiusPodezdDesignFloor(seed = MOEBIUS_PODEZD_SEED): FloorGeneration {
  return withSeededRandom(seed, () => {
    const world = new World();
    const entities: Entity[] = [];
    const nextEntityId = { v: 1 };
    const rooms = buildMoebiusRooms(world);

    placeLifts(world);
    decorateRooms(world, rooms);
    generateZones(world);
    placeDecisionContainers(world, rooms);
    spawnReversedPatrols(entities, nextEntityId);
    spawnSeamThreats(world, entities, nextEntityId);

    sanitizeDoors(world);
    ensureConnectivity(world, 184.5, 405.5);
    world.bakeLights();

    return { world, entities, spawnX: 184.5, spawnY: 405.5 };
  });
}

export function moebiusPodezdDecisionMetrics(gen: FloorGeneration): MoebiusPodezdDecisionMetrics {
  const routeRooms = gen.world.rooms.filter(room => room?.name.includes('Мёбиуса') || room?.name.includes('метки'));
  return {
    mirroredFlatRooms: gen.world.rooms.filter(room => room?.name.includes('Зеркальная квартира')).length,
    residentialStrips: gen.world.rooms.filter(room => room?.name.startsWith('Жилая полоса Мёбиуса')).length,
    seamLandmarks: routeRooms.filter(room => room.name.startsWith('Парный шов Мёбиуса')).length,
    seamLockedDoors: [...gen.world.doors.values()].filter(door => door.state === DoorState.LOCKED && door.keyId === SEAM_KEY_ID).length,
    mirrorTellContainers: gen.world.containers.filter(container => container.tags.includes('mirror_tell')).length,
    routeMarkerContainers: gen.world.containers.filter(container => container.tags.includes('route_marker') && container.tags.includes('recover')).length,
    reversedPatrolNpcs: gen.entities.filter(entity => entity.type === EntityType.NPC && entity.name?.includes('обратного обхода')).length,
    seamHunterMonsters: gen.entities.filter(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.SHOVNIK).length,
  };
}

export function expandMoebiusPodezdRouteGeometry(world: World, rng: () => number): void {
  carveMoebiusOuterRibbon(world);
  buildMoebiusFactionHqs(world);
  buildMoebiusStations(world);
  buildMoebiusDistricts(world, rng);
  fillMoebiusVoidsWithDiverseTopologies(world, rng);
  world.markFloorTexDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

export function reinforceMoebiusPodezdAuthoredTerritory(world: World): void {
  for (const site of MOEBIUS_HQ_SITES) {
    const hq = world.rooms.find(room => room.name === site.name);
    if (!hq) continue;
    hq.type = RoomType.HQ;
    hq.sealed = true;
    hq.wallTex = Tex.HERMO_WALL;
    markMoebiusHermeticRoom(world, hq);
    paintRoomOwner(world, hq, site.owner);
    for (const support of world.rooms) {
      if (support.name.startsWith(`${site.name}:`)) paintRoomOwner(world, support, site.owner);
    }
  }
  for (const station of MOEBIUS_STATIONS) {
    const room = world.rooms.find(candidate => candidate.name === station.name);
    if (room) paintRoomOwner(world, room, station.owner);
  }
  for (const district of MOEBIUS_DISTRICTS) {
    for (const room of world.rooms) {
      if (room.name.startsWith(`${district.name}:`)) paintRoomOwner(world, room, district.owner);
    }
  }
  world.markWallTexDirty();
}

export function alignMoebiusPodezdAmbientNpcTerritory(world: World, entities: Entity[]): void {
  const cells = moebiusTerritorySpawnCells(world);
  const offsets = new Uint16Array(8);
  for (const entity of entities) {
    if (!isMoebiusAmbientNpc(entity) || entity.faction === undefined) continue;
    const owner = factionToTerritoryOwner(entity.faction);
    const list = cells.get(owner);
    if (!list || list.length === 0) continue;
    const offset = offsets[owner]++ | 0;
    const cell = list[(entity.id * 109 + offset * 397) % list.length];
    entity.x = (cell % W) + 0.5;
    entity.y = ((cell / W) | 0) + 0.5;
    entity.assignedRoomId = world.roomMap[cell] >= 0 ? world.roomMap[cell] : -1;
    if (entity.ai) {
      entity.ai.tx = cell % W;
      entity.ai.ty = (cell / W) | 0;
      entity.ai.path = [];
      entity.ai.pi = 0;
      entity.ai.stuck = 0;
    }
  }
}

function carveMoebiusOuterRibbon(world: World): void {
  const upper = [
    { x: 0, y: 196 },
    { x: 180, y: 196 },
    { x: 382, y: 338 },
    { x: 624, y: 338 },
    { x: 824, y: 196 },
    { x: W - 1, y: 196 },
  ];
  const lower = [
    { x: 0, y: 828 },
    { x: 184, y: 828 },
    { x: 382, y: 684 },
    { x: 624, y: 684 },
    { x: 824, y: 828 },
    { x: W - 1, y: 828 },
  ];
  for (let i = 1; i < upper.length; i++) carveLineWidth(world, upper[i - 1].x, upper[i - 1].y, upper[i].x, upper[i].y, 9, Tex.F_LINO, ZoneFaction.CITIZEN);
  for (let i = 1; i < lower.length; i++) carveLineWidth(world, lower[i - 1].x, lower[i - 1].y, lower[i].x, lower[i].y, 9, Tex.F_LINO, ZoneFaction.CITIZEN);
  carveLineWidth(world, 36, 196, 36, 828, 9, Tex.F_LINO, ZoneFaction.CITIZEN);
  carveLineWidth(world, W - 37, 196, W - 37, 828, 9, Tex.F_LINO, ZoneFaction.LIQUIDATOR);
  carveLineWidth(world, 512, 338, 512, 398, 7, Tex.F_TILE, ZoneFaction.SCIENTIST);
  carveLineWidth(world, 512, 626, 512, 684, 7, Tex.F_TILE, ZoneFaction.WILD);
}

function buildMoebiusFactionHqs(world: World): void {
  for (const site of MOEBIUS_HQ_SITES) {
    const core = addMoebiusRoom(world, RoomType.HQ, site.x, site.y, site.w, site.h, site.name, Tex.HERMO_WALL, site.floorTex, true);
    decorateMoebiusHqCore(world, core, site.owner);
    paintRoomOwner(world, core, site.owner);
    connectRoomToPoint(world, core, site.linkX, site.linkY, DoorState.HERMETIC_OPEN, site.floorTex, site.owner);
    buildMoebiusHqSupportRooms(world, site, core);
  }
}

function buildMoebiusHqSupportRooms(world: World, site: MoebiusHqSite, core: Room): void {
  const supports = moebiusHqSupportSpecs(site.owner);
  const placements = [
    { dx: 4, dy: -17, w: 18, h: 10 },
    { dx: site.w + 8, dy: 2, w: 18, h: 10 },
    { dx: 5, dy: site.h + 8, w: 18, h: 10 },
    { dx: -24, dy: 2, w: 17, h: 10 },
  ] as const;
  const hubX = core.x + (core.w >> 1);
  const hubY = core.y + (core.h >> 1);
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i]!;
    const placement = placements[i]!;
    const room = tryAddMoebiusRoom(
      world,
      support.type,
      site.x + placement.dx,
      site.y + placement.dy,
      placement.w,
      placement.h,
      `${site.name}: ${support.name}`,
      support.wallTex,
      support.floorTex,
    );
    if (!room) continue;
    paintRoomOwner(world, room, site.owner);
    decorateMoebiusMicroRoom(world, room, i, site.owner, false);
    const side = sideToward(world, room, hubX, hubY);
    connectRooms(world, room, side, core, oppositeSide(side), DoorState.CLOSED, site.owner);
  }
}

function moebiusHqSupportSpecs(owner: TerritoryOwner): readonly { type: RoomType; name: string; wallTex: Tex; floorTex: Tex }[] {
  switch (owner) {
    case ZoneFaction.LIQUIDATOR:
      return [
        { type: RoomType.OFFICE, name: 'дежурная обратного обхода', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.STORAGE, name: 'оружейная резиновых клиньев', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'перевязочная шовных ушибов', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел поста', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.SCIENTIST:
      return [
        { type: RoomType.PRODUCTION, name: 'стол измерения паритета', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.OFFICE, name: 'кабинет графа ориентации', wallTex: Tex.PANEL, floorTex: Tex.F_LINO },
        { type: RoomType.STORAGE, name: 'шкаф меловых меток', wallTex: Tex.METAL, floorTex: Tex.F_CONCRETE },
        { type: RoomType.BATHROOM, name: 'раковина после зеркального обхода', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.CULTIST:
      return [
        { type: RoomType.COMMON, name: 'круг одинаковых дверей', wallTex: Tex.ROTTEN, floorTex: Tex.F_MEAT },
        { type: RoomType.STORAGE, name: 'кладовая чужих табличек', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.SMOKING, name: 'тёмная курилка шва', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.BATHROOM, name: 'умывальная мела', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
    case ZoneFaction.WILD:
      return [
        { type: RoomType.STORAGE, name: 'свалка дверных глазков', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.KITCHEN, name: 'коптилка подъездной еды', wallTex: Tex.ROTTEN, floorTex: Tex.F_CONCRETE },
        { type: RoomType.SMOKING, name: 'лежанки сбитой нумерации', wallTex: Tex.ROTTEN, floorTex: Tex.F_WOOD },
        { type: RoomType.BATHROOM, name: 'ржавый санузел нижней петли', wallTex: Tex.TILE_W, floorTex: Tex.F_WATER },
      ] as const;
    case ZoneFaction.CITIZEN:
    default:
      return [
        { type: RoomType.KITCHEN, name: 'общая кухня прямой стороны', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.STORAGE, name: 'кладовая подписанных дверей', wallTex: Tex.BRICK, floorTex: Tex.F_CONCRETE },
        { type: RoomType.MEDICAL, name: 'медуголок от головокружения', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
        { type: RoomType.BATHROOM, name: 'санузел жильцов', wallTex: Tex.TILE_W, floorTex: Tex.F_TILE },
      ] as const;
  }
}

function buildMoebiusStations(world: World): void {
  for (const spec of MOEBIUS_STATIONS) {
    const room = tryAddMoebiusRoom(world, spec.type, spec.x, spec.y, spec.w, spec.h, spec.name, spec.wallTex, spec.floorTex);
    if (!room) continue;
    paintRoomOwner(world, room, spec.owner);
    decorateMoebiusStation(world, room, spec.owner);
    connectRoomToPoint(world, room, spec.linkX, spec.linkY, DoorState.CLOSED, spec.floorTex, spec.owner);
  }
}

function buildMoebiusDistricts(world: World, rng: () => number): void {
  for (const spec of MOEBIUS_DISTRICTS) buildMoebiusMicroBlock(world, spec, rng);
}

function buildMoebiusMicroBlock(world: World, spec: MoebiusDistrictSpec, rng: () => number): void {
  const topRows = Math.ceil(spec.rows / 2);
  const blockW = spec.cols * MICRO_ROOM_W + (spec.cols - 1) * MICRO_GAP_X + 10;
  const spineY = spec.y + topRows * (MICRO_ROOM_H + MICRO_GAP_Y) + 2;
  const spine = tryAddMoebiusRoom(world, RoomType.CORRIDOR, spec.x, spineY, blockW, MICRO_SPINE_H, `${spec.name}: средний коридор ленты`, spec.wallTex, spec.floorTex);
  if (!spine) return;
  paintRoomOwner(world, spine, spec.owner);
  decorateMoebiusRibbonSpine(world, spine, spec.owner);

  let serial = 0;
  for (let row = 0; row < spec.rows; row++) {
    const aboveSpine = row < topRows;
    const localRow = aboveSpine ? row : row - topRows;
    const y = aboveSpine
      ? spec.y + localRow * (MICRO_ROOM_H + MICRO_GAP_Y)
      : spine.y + spine.h + 6 + localRow * (MICRO_ROOM_H + MICRO_GAP_Y);
    for (let col = 0; col < spec.cols; col++) {
      const effectiveCol = spec.reverse ? spec.cols - 1 - col : col;
      const x = spec.x + 5 + col * (MICRO_ROOM_W + MICRO_GAP_X);
      const type = moebiusMicroRoomType(spec.owner, row, effectiveCol);
      const room = tryAddMoebiusRoom(
        world,
        type,
        x,
        y,
        MICRO_ROOM_W,
        MICRO_ROOM_H,
        `${spec.name}: ${spec.reverse ? 'обратная' : 'прямая'} ${moebiusMicroRoomName(type, spec.owner)} ${serial + 1}`,
        moebiusMicroWallTex(type, spec.wallTex),
        moebiusMicroFloorTex(type, spec.floorTex),
      );
      if (!room) continue;
      paintRoomOwner(world, room, spec.owner);
      connectRoomToPoint(world, room, room.x + (room.w >> 1), spine.y + (spine.h >> 1), DoorState.CLOSED, spec.floorTex, spec.owner);
      decorateMoebiusMicroRoom(world, room, serial, spec.owner, rng() < 0.18);
      serial++;
    }
  }
  connectRoomToPoint(world, spine, spec.linkX, spec.linkY, DoorState.CLOSED, spec.floorTex, spec.owner);
}

function moebiusMicroRoomType(owner: TerritoryOwner, row: number, col: number): RoomType {
  const citizen = [RoomType.LIVING, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.STORAGE, RoomType.COMMON, RoomType.LIVING] as const;
  const liquidator = [RoomType.OFFICE, RoomType.STORAGE, RoomType.MEDICAL, RoomType.BATHROOM, RoomType.COMMON, RoomType.STORAGE] as const;
  const scientist = [RoomType.OFFICE, RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.STORAGE, RoomType.BATHROOM, RoomType.OFFICE] as const;
  const wild = [RoomType.STORAGE, RoomType.SMOKING, RoomType.KITCHEN, RoomType.LIVING, RoomType.BATHROOM, RoomType.COMMON] as const;
  const cultist = [RoomType.COMMON, RoomType.STORAGE, RoomType.SMOKING, RoomType.BATHROOM, RoomType.LIVING, RoomType.COMMON] as const;
  const list = owner === ZoneFaction.LIQUIDATOR
    ? liquidator
    : owner === ZoneFaction.SCIENTIST
      ? scientist
      : owner === ZoneFaction.WILD
        ? wild
        : owner === ZoneFaction.CULTIST
          ? cultist
          : citizen;
  return list[(row * 3 + col * 5 + owner) % list.length];
}

function moebiusMicroRoomName(type: RoomType, owner: TerritoryOwner): string {
  if (type === RoomType.KITCHEN) return owner === ZoneFaction.WILD ? 'кухня-перехват' : 'микрокухня';
  if (type === RoomType.BATHROOM) return 'микросанузел';
  if (type === RoomType.STORAGE) return owner === ZoneFaction.CULTIST ? 'кладовая табличек' : 'кладовка';
  if (type === RoomType.MEDICAL) return 'медшкаф';
  if (type === RoomType.OFFICE) return 'кабинет нумерации';
  if (type === RoomType.PRODUCTION) return 'аппаратная зеркал';
  if (type === RoomType.SMOKING) return 'курилка сбитого обхода';
  if (type === RoomType.COMMON) return owner === ZoneFaction.CULTIST ? 'тихий круг' : 'общая ниша';
  return 'зеркальная комната';
}

function moebiusMicroWallTex(type: RoomType, fallback: Tex): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.MEDICAL) return Tex.TILE_W;
  if (type === RoomType.PRODUCTION || type === RoomType.OFFICE) return Tex.METAL;
  return fallback;
}

function moebiusMicroFloorTex(type: RoomType, fallback: Tex): Tex {
  if (type === RoomType.BATHROOM || type === RoomType.MEDICAL) return Tex.F_TILE;
  if (type === RoomType.PRODUCTION || type === RoomType.STORAGE) return Tex.F_CONCRETE;
  return fallback;
}

function decorateMoebiusHqCore(world: World, room: Room, owner: TerritoryOwner): void {
  setFeature(world, room.x + 5, room.y + 5, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.TABLE);
  setFeature(world, room.x + room.w - 6, room.y + 5, owner === ZoneFaction.LIQUIDATOR ? Feature.DESK : Feature.SHELF);
  setFeature(world, room.x + (room.w >> 1), room.y + room.h - 5, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.LAMP);
}

function decorateMoebiusStation(world: World, room: Room, owner: TerritoryOwner): void {
  setFeature(world, room.x + 8, room.y + 7, owner === ZoneFaction.SCIENTIST ? Feature.APPARATUS : Feature.TABLE);
  setFeature(world, room.x + room.w - 9, room.y + 7, owner === ZoneFaction.LIQUIDATOR ? Feature.DESK : Feature.SHELF);
  setFeature(world, room.x + (room.w >> 1), room.y + room.h - 8, room.type === RoomType.KITCHEN ? Feature.STOVE : Feature.LAMP);
}

function decorateMoebiusRibbonSpine(world: World, room: Room, owner: TerritoryOwner): void {
  const feature = owner === ZoneFaction.CULTIST ? Feature.CANDLE : owner === ZoneFaction.SCIENTIST ? Feature.SCREEN : Feature.LAMP;
  for (let x = room.x + 12; x < room.x + room.w - 8; x += 42) setFeature(world, x, room.y + (room.h >> 1), feature);
}

function decorateMoebiusMicroRoom(world: World, room: Room, serial: number, owner: TerritoryOwner, distressed: boolean): void {
  switch (room.type) {
    case RoomType.KITCHEN:
      setFeature(world, room.x + 3, room.y + 3, Feature.STOVE);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.SINK);
      break;
    case RoomType.BATHROOM:
      setFeature(world, room.x + 3, room.y + 3, Feature.SINK);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.TOILET);
      break;
    case RoomType.MEDICAL:
      setFeature(world, room.x + 3, room.y + 3, Feature.BED);
      setFeature(world, room.x + room.w - 4, room.y + 3, Feature.APPARATUS);
      break;
    case RoomType.OFFICE:
      setFeature(world, room.x + 4, room.y + 3, Feature.DESK);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, Feature.SHELF);
      break;
    case RoomType.PRODUCTION:
      setFeature(world, room.x + 4, room.y + 4, Feature.APPARATUS);
      setFeature(world, room.x + room.w - 5, room.y + 4, Feature.MACHINE);
      break;
    case RoomType.SMOKING:
      setFeature(world, room.x + 4, room.y + 4, Feature.CHAIR);
      setFeature(world, room.x + room.w - 5, room.y + 5, owner === ZoneFaction.CULTIST ? Feature.CANDLE : Feature.TABLE);
      break;
    case RoomType.STORAGE:
      setFeature(world, room.x + 3, room.y + 3, Feature.SHELF);
      setFeature(world, room.x + room.w - 4, room.y + room.h - 3, distressed ? Feature.APPARATUS : Feature.SHELF);
      break;
    default:
      setFeature(world, room.x + 4, room.y + 4, serial % 2 === 0 ? Feature.BED : Feature.TABLE);
      setFeature(world, room.x + room.w - 5, room.y + room.h - 4, Feature.SHELF);
      break;
  }
}

function addMoebiusRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
  sealed = false,
): Room {
  const room = stampRoom(world, world.rooms.length, type, Math.floor(x), Math.floor(y), w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  room.sealed = sealed;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) {
        world.floorTex[idx] = floorTex;
      } else {
        world.wallTex[idx] = sealed ? Tex.HERMO_WALL : wallTex;
        if (sealed) world.hermoWall[idx] = 1;
      }
    }
  }
  return room;
}

function tryAddMoebiusRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room | null {
  const rx = Math.floor(x);
  const ry = Math.floor(y);
  if (rx < 2 || ry < 2 || rx + w >= W - 2 || ry + h >= W - 2) return null;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(rx + dx, ry + dy);
      if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.hermoWall[idx]) return null;
      if (world.roomMap[idx] >= 0) return null;
    }
  }
  return addMoebiusRoom(world, type, rx, ry, w, h, name, wallTex, floorTex);
}

function markMoebiusHermeticRoom(world: World, room: Room): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) {
        world.hermoWall[idx] = 0;
        continue;
      }
      if (world.cells[idx] !== Cell.WALL) continue;
      world.hermoWall[idx] = 1;
      world.wallTex[idx] = Tex.HERMO_WALL;
    }
  }
}

function paintRoomOwner(world: World, room: Room, owner: TerritoryOwner): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id) world.factionControl[idx] = owner;
    }
  }
  for (const idx of room.doors) world.factionControl[idx] = owner;
}

function doorSite(room: Room, side: DoorSide): DoorSite {
  switch (side) {
    case 'north': {
      const x = room.x + (room.w >> 1);
      const y = room.y - 1;
      return { x, y, ox: x, oy: room.y };
    }
    case 'south': {
      const x = room.x + (room.w >> 1);
      const y = room.y + room.h;
      return { x, y, ox: x, oy: room.y + room.h - 1 };
    }
    case 'west': {
      const x = room.x - 1;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x, oy: y };
    }
    case 'east': {
      const x = room.x + room.w;
      const y = room.y + (room.h >> 1);
      return { x, y, ox: room.x + room.w - 1, oy: y };
    }
  }
}

function sideToward(world: World, room: Room, x: number, y: number): DoorSide {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const dx = world.delta(cx, x);
  const dy = world.delta(cy, y);
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function oppositeSide(side: DoorSide): DoorSide {
  if (side === 'north') return 'south';
  if (side === 'south') return 'north';
  if (side === 'west') return 'east';
  return 'west';
}

function addDoorAt(world: World, room: Room, x: number, y: number, state: DoorState, keyId = '', roomB = -1): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.hermoWall[idx] = 0;
  world.wallTex[idx] = state === DoorState.LOCKED || state === DoorState.HERMETIC_OPEN || state === DoorState.HERMETIC_CLOSED
    ? Tex.DOOR_METAL
    : Tex.DOOR_WOOD;
  const existing = world.doors.get(idx);
  if (existing) {
    existing.state = state;
    existing.keyId = keyId;
    if (existing.roomA < 0) existing.roomA = room.id;
    if (existing.roomB < 0) existing.roomB = roomB;
  } else {
    world.doors.set(idx, { idx, state, roomA: room.id, roomB, keyId, timer: 0 });
  }
  if (!room.doors.includes(idx)) room.doors.push(idx);
  return idx;
}

function connectRoomToPoint(
  world: World,
  room: Room,
  tx: number,
  ty: number,
  state: DoorState,
  floorTex: Tex,
  owner: TerritoryOwner,
): void {
  const site = doorSite(room, sideToward(world, room, tx, ty));
  addDoorAt(world, room, site.x, site.y, state);
  carveLineWidth(world, site.ox, site.oy, tx, ty, 3, floorTex, owner);
}

function connectRooms(
  world: World,
  a: Room,
  sideA: DoorSide,
  b: Room,
  sideB: DoorSide,
  state: DoorState,
  owner: TerritoryOwner,
): void {
  const da = doorSite(a, sideA);
  const db = doorSite(b, sideB);
  const ai = addDoorAt(world, a, da.x, da.y, state, '', b.id);
  const bi = addDoorAt(world, b, db.x, db.y, state, '', a.id);
  const ad = world.doors.get(ai);
  const bd = world.doors.get(bi);
  if (ad) ad.roomB = b.id;
  if (bd) bd.roomB = a.id;
  carveLineWidth(world, da.ox, da.oy, db.ox, db.oy, 3, a.floorTex, owner);
}

function carveLineWidth(world: World, ax: number, ay: number, bx: number, by: number, width: number, floorTex: Tex, owner: TerritoryOwner): void {
  if (ax !== bx && ay !== by) {
    carveLineWidth(world, ax, ay, bx, ay, width, floorTex, owner);
    carveLineWidth(world, bx, ay, bx, by, width, floorTex, owner);
    return;
  }
  const half = width >> 1;
  const from = ax === bx ? Math.min(ay, by) : Math.min(ax, bx);
  const to = ax === bx ? Math.max(ay, by) : Math.max(ax, bx);
  for (let p = from; p <= to; p++) {
    for (let n = 0; n < width; n++) {
      const o = n - half;
      openTile(world, ax === bx ? ax + o : p, ax === bx ? p : ay + o, floorTex, owner);
    }
  }
}

function openTile(world: World, x: number, y: number, floorTex: Tex, owner: TerritoryOwner): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.LIFT || world.cells[idx] === Cell.DOOR || world.hermoWall[idx]) return;
  world.cells[idx] = Cell.FLOOR;
  if (world.roomMap[idx] < 0) world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.factionControl[idx] = owner;
  if (world.features[idx] !== Feature.NONE) world.features[idx] = Feature.NONE;
}

function isMoebiusAmbientNpc(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.name?.startsWith('Мёбиус-подъезд:') === true &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function moebiusTerritorySpawnCells(world: World): Map<TerritoryOwner, number[]> {
  const cells = new Map<TerritoryOwner, number[]>();
  for (const owner of HUMAN_TERRITORY_OWNERS) cells.set(owner, []);
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.aptMask[i] || world.hermoWall[i] || world.containerMap.has(i) || world.features[i] === Feature.LIFT_BUTTON) continue;
    const owner = world.factionControl[i] as TerritoryOwner;
    const list = cells.get(owner);
    if (list) list.push(i);
  }
  return cells;
}

function buildMoebiusRooms(world: World): MoebiusRooms {
  const upperStrip = addOpenRoom(world, {
    type: RoomType.CORRIDOR,
    x: LOOP_LEFT,
    y: UPPER_Y,
    w: LOOP_RIGHT - LOOP_LEFT,
    h: STRIP_H,
    name: MOEBIUS_PODEZD_ROOM_NAMES.upperStrip,
    floorTex: Tex.F_LINO,
    wallTex: Tex.PANEL,
  });
  const lowerStrip = addOpenRoom(world, {
    type: RoomType.CORRIDOR,
    x: LOOP_LEFT,
    y: LOWER_Y,
    w: LOOP_RIGHT - LOOP_LEFT,
    h: STRIP_H,
    name: MOEBIUS_PODEZD_ROOM_NAMES.lowerStrip,
    floorTex: Tex.F_LINO,
    wallTex: Tex.PANEL,
  });
  const westLoop = addOpenRoom(world, {
    type: RoomType.CORRIDOR,
    x: LOOP_LEFT,
    y: UPPER_Y,
    w: CONNECTOR_W,
    h: LOWER_Y + STRIP_H - UPPER_Y,
    name: MOEBIUS_PODEZD_ROOM_NAMES.westLoop,
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.PANEL,
  });
  const eastLoop = addOpenRoom(world, {
    type: RoomType.CORRIDOR,
    x: LOOP_RIGHT - CONNECTOR_W,
    y: UPPER_Y,
    w: CONNECTOR_W,
    h: LOWER_Y + STRIP_H - UPPER_Y,
    name: MOEBIUS_PODEZD_ROOM_NAMES.eastLoop,
    floorTex: Tex.F_CONCRETE,
    wallTex: Tex.PANEL,
  });
  const shortcut = addOpenRoom(world, {
    type: RoomType.CORRIDOR,
    x: SHORTCUT_X,
    y: SHORTCUT_Y,
    w: SHORTCUT_W,
    h: SHORTCUT_H,
    name: MOEBIUS_PODEZD_ROOM_NAMES.shortcut,
    floorTex: Tex.F_TILE,
    wallTex: Tex.PANEL,
  });
  addShortcutGate(world, shortcut, NORTH_GATE_Y);
  addShortcutGate(world, shortcut, SOUTH_GATE_Y);

  const mirroredFlats = buildMirroredFlats(world, upperStrip, lowerStrip);
  const seamNorth = makeClosedRoom(world, RoomType.COMMON, 446, 444, 46, 28, MOEBIUS_PODEZD_ROOM_NAMES.seamNorth, Tex.PANEL, Tex.F_LINO);
  const seamSouth = makeClosedRoom(world, RoomType.COMMON, 532, 548, 46, 28, MOEBIUS_PODEZD_ROOM_NAMES.seamSouth, Tex.PANEL, Tex.F_LINO);
  const lostMarker = makeClosedRoom(world, RoomType.STORAGE, 610, 458, 40, 26, MOEBIUS_PODEZD_ROOM_NAMES.lostMarker, Tex.PANEL, Tex.F_CONCRETE);

  addDoor(world, seamNorth.x + seamNorth.w, seamNorth.y + 14, DoorState.CLOSED, '', seamNorth.id, shortcut.id);
  carveConnector(world, seamNorth.x + seamNorth.w + 1, seamNorth.y + 14, SHORTCUT_X, seamNorth.y + 14, Tex.F_LINO);
  addDoor(world, seamSouth.x - 1, seamSouth.y + 13, DoorState.CLOSED, '', seamSouth.id, shortcut.id);
  carveConnector(world, SHORTCUT_X + SHORTCUT_W - 1, seamSouth.y + 13, seamSouth.x - 2, seamSouth.y + 13, Tex.F_LINO);
  addDoor(world, lostMarker.x + Math.floor(lostMarker.w / 2), lostMarker.y - 1, DoorState.LOCKED, 'container_key_label', lostMarker.id, upperStrip.id);
  carveConnector(world, lostMarker.x + Math.floor(lostMarker.w / 2), lostMarker.y - 2, lostMarker.x + Math.floor(lostMarker.w / 2), UPPER_Y + STRIP_H - 1, Tex.F_LINO);

  return { upperStrip, lowerStrip, westLoop, eastLoop, shortcut, seamNorth, seamSouth, lostMarker, mirroredFlats };
}

function buildMirroredFlats(world: World, upperStrip: Room, lowerStrip: Room): Room[] {
  const rooms: Room[] = [];
  const xs = [214, 290, 366, 442, 562, 638, 714, 790];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const directLabel = FLAT_LABELS[i];
    const reverseLabel = FLAT_LABELS[FLAT_LABELS.length - 1 - i];
    const upper = makeClosedRoom(world, RoomType.LIVING, x, UPPER_Y - 29, 42, 28, `Зеркальная квартира ${directLabel} прямая сторона`, Tex.PANEL, Tex.F_CARPET);
    const lower = makeClosedRoom(world, RoomType.LIVING, x, LOWER_Y + STRIP_H + 1, 42, 28, `Зеркальная квартира ${reverseLabel} обратная сторона`, Tex.PANEL, Tex.F_CARPET);
    addDoor(world, x + 21, UPPER_Y - 1, DoorState.CLOSED, '', upper.id, upperStrip.id);
    addDoor(world, x + 21, LOWER_Y + STRIP_H, DoorState.CLOSED, '', lower.id, lowerStrip.id);
    rooms.push(upper, lower);
  }
  return rooms;
}

function addOpenRoom(world: World, spec: OpenRoomSpec): Room {
  const id = world.rooms.length;
  const room: Room = {
    id,
    type: spec.type,
    x: world.wrap(spec.x),
    y: world.wrap(spec.y),
    w: spec.w,
    h: spec.h,
    doors: [],
    sealed: false,
    name: spec.name,
    apartmentId: -1,
    wallTex: spec.wallTex,
    floorTex: spec.floorTex,
  };
  world.rooms[id] = room;
  carveRect(world, spec.x, spec.y, spec.w, spec.h, id, spec.floorTex, spec.wallTex);
  return room;
}

function makeClosedRoom(
  world: World,
  type: RoomType,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  wallTex: Tex,
  floorTex: Tex,
): Room {
  const room = stampRoom(world, world.rooms.length, type, x, y, w, h, -1);
  room.name = name;
  room.wallTex = wallTex;
  room.floorTex = floorTex;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      if (world.cells[idx] === Cell.WALL) world.wallTex[idx] = wallTex;
      if (world.roomMap[idx] === room.id) world.floorTex[idx] = floorTex;
    }
  }
  return room;
}

function carveRect(world: World, x: number, y: number, w: number, h: number, roomId: number, floorTex: Tex, wallTex: Tex): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = roomId;
      world.floorTex[idx] = floorTex;
      world.wallTex[idx] = wallTex;
      world.features[idx] = Feature.NONE;
    }
  }
}

function carveConnector(world: World, fromX: number, fromY: number, toX: number, toY: number, floorTex: Tex): void {
  let x = world.wrap(fromX);
  let y = world.wrap(fromY);
  const dx = Math.sign(world.delta(x, toX));
  const dy = Math.sign(world.delta(y, toY));
  while (x !== world.wrap(toX)) {
    setCorridorCell(world, x, y, floorTex);
    x = world.wrap(x + dx);
  }
  while (y !== world.wrap(toY)) {
    setCorridorCell(world, x, y, floorTex);
    y = world.wrap(y + dy);
  }
  setCorridorCell(world, x, y, floorTex);
}

function setCorridorCell(world: World, x: number, y: number, floorTex: Tex): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.LIFT) return;
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.wallTex[idx] = Tex.PANEL;
  world.features[idx] = Feature.NONE;
}

function addShortcutGate(world: World, shortcut: Room, y: number): void {
  for (let x = SHORTCUT_X; x < SHORTCUT_X + SHORTCUT_W; x++) {
    const idx = world.idx(x, y);
    world.cells[idx] = Cell.WALL;
    world.roomMap[idx] = -1;
    world.wallTex[idx] = Tex.PANEL;
    world.features[idx] = Feature.NONE;
  }
  addDoor(world, SHORTCUT_X + (SHORTCUT_W >> 1), y, DoorState.LOCKED, SEAM_KEY_ID, shortcut.id, shortcut.id);
}

function addDoor(world: World, x: number, y: number, state: DoorState, keyId: string, roomA: number, roomB: number): void {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.wallTex[idx] = state === DoorState.LOCKED ? Tex.DOOR_METAL : Tex.DOOR_WOOD;
  world.features[idx] = Feature.NONE;
  world.doors.set(idx, { idx, state, roomA, roomB, keyId, timer: 0 });
  const a = world.rooms[roomA];
  const b = world.rooms[roomB];
  if (a && !a.doors.includes(idx)) a.doors.push(idx);
  if (b && b !== a && !b.doors.includes(idx)) b.doors.push(idx);
}

function placeLifts(world: World): void {
  placeLift(world, 178, 405, 179, 405, LiftDirection.UP);
  placeLift(world, 846, 619, 845, 619, LiftDirection.DOWN);
  placeLift(world, 846, 405, 845, 405, LiftDirection.UP);
  placeLift(world, 178, 619, 179, 619, LiftDirection.DOWN);
}

function placeLift(world: World, x: number, y: number, buttonX: number, buttonY: number, direction: LiftDirection): void {
  const liftIdx = world.idx(x, y);
  world.cells[liftIdx] = Cell.LIFT;
  world.wallTex[liftIdx] = Tex.LIFT_DOOR;
  world.roomMap[liftIdx] = -1;
  world.features[liftIdx] = Feature.NONE;
  world.liftDir[liftIdx] = direction;
  const buttonIdx = world.idx(buttonX, buttonY);
  if (world.cells[buttonIdx] === Cell.FLOOR) {
    world.features[buttonIdx] = Feature.LIFT_BUTTON;
    world.liftDir[buttonIdx] = direction;
  }
}

function decorateRooms(world: World, rooms: MoebiusRooms): void {
  for (const [i, room] of rooms.mirroredFlats.entries()) {
    setFeature(world, room.x + 5, room.y + 5, i % 2 === 0 ? Feature.TABLE : Feature.BED);
    setFeature(world, room.x + room.w - 6, room.y + room.h - 6, Feature.SHELF);
    if (i % 4 === 0) markScreenWall(world, room.x + Math.floor(room.w / 2), room.y - 1, i);
  }
  setFeature(world, rooms.seamNorth.x + 7, rooms.seamNorth.y + 8, Feature.TABLE);
  setFeature(world, rooms.seamSouth.x + rooms.seamSouth.w - 8, rooms.seamSouth.y + 8, Feature.TABLE);
  markScreenWall(world, rooms.seamNorth.x + 18, rooms.seamNorth.y - 1, 2);
  markScreenWall(world, rooms.seamSouth.x + 28, rooms.seamSouth.y + rooms.seamSouth.h, 6);
  for (const [x, y] of [[256, 405], [512, 405], [768, 405], [256, 619], [512, 619], [768, 619]] as const) {
    setFeature(world, x, y, Feature.LAMP);
  }
}

function setFeature(world: World, x: number, y: number, feature: Feature): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) world.features[idx] = feature;
}

function markScreenWall(world: World, x: number, y: number, frame: number): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] !== Cell.WALL) return;
  world.features[idx] = Feature.SCREEN;
  world.wallTex[idx] = (Tex.SCREEN_BASE + (frame % 8) * 4) as Tex;
  if (!world.screenCells.includes(idx)) world.screenCells.push(idx);
}

function placeDecisionContainers(world: World, rooms: MoebiusRooms): void {
  addContainer(world, rooms.seamNorth, rooms.seamNorth.x + 8, rooms.seamNorth.y + 10, ContainerKind.FILING_CABINET, 'Журнал прямой стороны подъезда', 'public', [
    { defId: 'chalk', count: 1 },
    { defId: 'neighbor_complaint', count: 1 },
  ], ['moebius_podezd', 'mirror_tell', 'public_loop', 'choose_corridor']);
  addContainer(world, rooms.seamSouth, rooms.seamSouth.x + rooms.seamSouth.w - 9, rooms.seamSouth.y + 10, ContainerKind.FILING_CABINET, 'Журнал обратной стороны подъезда', 'public', [
    { defId: 'chalk', count: 1 },
    { defId: 'sealed_complaint', count: 1 },
  ], ['moebius_podezd', 'mirror_tell', 'orientation_flip', 'choose_corridor']);
  addContainer(world, rooms.lostMarker, rooms.lostMarker.x + 12, rooms.lostMarker.y + 9, ContainerKind.SECRET_STASH, 'Коробка с потерянной меткой маршрута', 'secret', [
    { defId: 'chalk', count: 2 },
    { defId: 'elevator_access_order', count: 1 },
    { defId: 'container_key_label', count: 1 },
  ], ['moebius_podezd', 'route_marker', 'recover', 'secret', 'mirror_tell']);
  addContainer(world, rooms.shortcut, SHORTCUT_X + 3, 510, ContainerKind.TOOL_LOCKER, 'Щиток паритетного замка', 'locked', [
    { defId: SEAM_KEY_ID, count: 1 },
    { defId: 'wire_coil', count: 1 },
    { defId: 'fuse', count: 1 },
  ], ['moebius_podezd', 'seam_lock', 'break', 'shortcut']);
  for (const [i, room] of rooms.mirroredFlats.entries()) {
    if (i % 5 !== 0) continue;
    addContainer(world, room, room.x + room.w - 7, room.y + 6, ContainerKind.WOODEN_CHEST, `Зеркальная тумба ${i + 1}`, 'room', [
      { defId: i % 2 === 0 ? 'bread' : 'water_coupon', count: 1 },
      { defId: i % 2 === 0 ? 'felt_door_pad' : 'rubber_door_wedge', count: 1 },
    ], ['moebius_podezd', 'mirror_tell', 'flat_pair', i % 2 === 0 ? 'safe_side' : 'reverse_side']);
  }
}

function addContainer(
  world: World,
  room: Room,
  x: number,
  y: number,
  kind: ContainerKind,
  name: string,
  access: WorldContainer['access'],
  inventory: Item[],
  tags: string[],
): WorldContainer {
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: world.wrap(x),
    y: world.wrap(y),
    floor: MOEBIUS_PODEZD_BASE_FLOOR,
    roomId: room.id,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind,
    name,
    inventory: inventory.map(item => ({ ...item })),
    capacitySlots: Math.max(8, inventory.length + 4),
    access,
    lockDifficulty: access === 'locked' ? 3 : undefined,
    discovered: access !== 'secret',
    tags,
  };
  world.addContainer(container);
  setFeature(world, x, y, kind === ContainerKind.TOOL_LOCKER ? Feature.APPARATUS : Feature.SHELF);
  return container;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function spawnReversedPatrols(entities: Entity[], nextId: NextId): void {
  spawnPatrolNpc(entities, nextId, 'Ликвидатор обратного обхода север', 746, 405, 274, 405, Math.PI);
  spawnPatrolNpc(entities, nextId, 'Ликвидатор обратного обхода юг', 274, 619, 746, 619, 0);
  spawnPatrolNpc(entities, nextId, 'Свидетель обратного обхода А', 332, 405, 332, 619, Math.PI / 2, Faction.CITIZEN, Occupation.TRAVELER);
  spawnPatrolNpc(entities, nextId, 'Свидетель обратного обхода Б', 690, 619, 690, 405, -Math.PI / 2, Faction.CITIZEN, Occupation.HOUSEWIFE);
}

function spawnPatrolNpc(
  entities: Entity[],
  nextId: NextId,
  name: string,
  x: number,
  y: number,
  tx: number,
  ty: number,
  angle: number,
  faction = Faction.LIQUIDATOR,
  occupation = Occupation.HUNTER,
): void {
  const liquidator = faction === Faction.LIQUIDATOR;
  entities.push({
    id: nextId.v++,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle,
    pitch: 0,
    alive: true,
    speed: liquidator ? 0.92 : 0.76,
    sprite: occupation,
    name,
    needs: freshNeeds(),
    hp: liquidator ? 145 : 88,
    maxHp: liquidator ? 145 : 88,
    money: liquidator ? 36 : 9,
    ai: { goal: AIGoal.GOTO, tx: tx + 0.5, ty: ty + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: liquidator
      ? [{ defId: 'rubber_club', count: 1 }, { defId: 'ammo_9mm', count: 8 }]
      : [{ defId: 'bread', count: 1 }, { defId: 'chalk', count: 1 }],
    weapon: liquidator ? 'rubber_club' : undefined,
    faction,
    occupation,
    questId: -1,
    rpg: randomRPG(liquidator ? 3 : 1),
  });
}

function spawnSeamThreats(world: World, entities: Entity[], nextId: NextId): void {
  spawnMonster(world, entities, nextId, MonsterKind.SHOVNIK, 512, 510, 3, 'Шовник на паритетном замке');
  spawnMonster(world, entities, nextId, MonsterKind.NELYUD, 640, 638, 2, 'Нелюдь из обратной квартиры');
}

function spawnMonster(
  world: World,
  entities: Entity[],
  nextId: NextId,
  kind: MonsterKind,
  x: number,
  y: number,
  level: number,
  name: string,
): void {
  const idx = world.idx(x, y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const hp = Math.round(def.hp * (0.9 + level * 0.16));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * (0.95 + level * 0.035),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

function buildMoebiusKeepMask(world: World): Uint8Array {
  const keep = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const ci = world.idx(x, y);
      const cell = world.cells[ci];
      if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT || world.hermoWall[ci] || world.roomMap[ci] >= 0) {
        keep[ci] = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            keep[world.idx(x + dx, y + dy)] = 1;
          }
        }
      }
    }
  }
  for (const container of world.containers) {
    keep[world.idx(container.x, container.y)] = 1;
  }
  for (let y = 390; y <= 630; y++) {
    for (let x = SHORTCUT_X - 2; x <= SHORTCUT_X + SHORTCUT_W + 2; x++) {
      keep[world.idx(x, y)] = 1;
    }
  }
  return keep;
}

function fillMoebiusVoidsWithDiverseTopologies(world: World, rng: () => number): void {
  const keep = buildMoebiusKeepMask(world);

  // Layer 1: Залы ожидания и ниши расширения вдоль магистралей (Corridor Pocket Lounges) - Увеличенная плотность (шаг 28)
  const pocketSpecs = [
    // Outer top ribbon (y=196)
    ...Array.from({ length: 32 }, (_, i) => ({ x: 50 + i * 28, y: 196 - 15, w: 14, h: 12, linkX: 50 + i * 28 + 7, linkY: 196, owner: ZoneFaction.CITIZEN })),
    ...Array.from({ length: 32 }, (_, i) => ({ x: 64 + i * 28, y: 196 + 8, w: 14, h: 12, linkX: 64 + i * 28 + 7, linkY: 196, owner: ZoneFaction.CITIZEN })),
    // Outer bottom ribbon (y=828)
    ...Array.from({ length: 32 }, (_, i) => ({ x: 50 + i * 28, y: 828 - 15, w: 14, h: 12, linkX: 50 + i * 28 + 7, linkY: 828, owner: ZoneFaction.CITIZEN })),
    ...Array.from({ length: 32 }, (_, i) => ({ x: 64 + i * 28, y: 828 + 8, w: 14, h: 12, linkX: 64 + i * 28 + 7, linkY: 828, owner: ZoneFaction.CITIZEN })),
    // Outer left ribbon (x=36)
    ...Array.from({ length: 20 }, (_, i) => ({ x: 36 + 8, y: 220 + i * 28, w: 14, h: 12, linkX: 36, linkY: 220 + i * 28 + 6, owner: ZoneFaction.CITIZEN })),
    // Outer right ribbon (x=987)
    ...Array.from({ length: 20 }, (_, i) => ({ x: 987 - 18, y: 220 + i * 28, w: 14, h: 12, linkX: 987, linkY: 220 + i * 28 + 6, owner: ZoneFaction.LIQUIDATOR })),
    // Inner top loop (y=398)
    ...Array.from({ length: 22 }, (_, i) => ({ x: 180 + i * 28, y: 398 - 16, w: 14, h: 12, linkX: 180 + i * 28 + 7, linkY: 398, owner: ZoneFaction.CITIZEN })),
    // Inner bottom loop (y=612)
    ...Array.from({ length: 22 }, (_, i) => ({ x: 180 + i * 28, y: 612 + 8, w: 14, h: 12, linkX: 180 + i * 28 + 7, linkY: 612, owner: ZoneFaction.CITIZEN })),
  ];

  for (const spec of pocketSpecs) {
    tryPlacePocketLounge(world, keep, spec.x, spec.y, spec.w, spec.h, spec.linkX, spec.linkY, spec.owner, rng);
  }

  // Layer 2: Технические магистральные туннели периметра (Perimeter Technical Bypass Tunnels)
  buildPerimeterBypassTunnels(world, keep, rng);

  // Layer 3: Заброшенные склады госрезерва (State Reserve Warehouses)
  const warehouseAreas = [
    { startX: 60, endX: 450, startY: 25, endY: 105, linkX: 250, linkY: 196 },
    { startX: 550, endX: 960, startY: 25, endY: 105, linkX: 750, linkY: 196 },
    { startX: 60, endX: 450, startY: 915, endY: 995, linkX: 250, linkY: 828 },
    { startX: 550, endX: 960, startY: 915, endY: 995, linkX: 750, linkY: 828 },
  ];

  for (const area of warehouseAreas) {
    buildStateReserveWarehouses(world, keep, area, rng);
  }

  // Layer 4: Гигантские залы водоочистки и вентиляционные градирни (Water Treatment & Ventilation Halls)
  const industrialHalls = [
    { x: 380, y: 220, w: 38, h: 26, linkX: 400, linkY: 196, isWater: true },
    { x: 580, y: 220, w: 38, h: 26, linkX: 600, linkY: 196, isWater: false },
    { x: 380, y: 750, w: 38, h: 26, linkX: 400, linkY: 828, isWater: true },
    { x: 580, y: 750, w: 38, h: 26, linkX: 600, linkY: 828, isWater: false },
  ];

  for (const hall of industrialHalls) {
    buildGiantIndustrialHall(world, keep, hall, rng);
  }

  // Layer 5: Уплотнительная муравейная застройка и общежития сменных бригад (Communal Clusters & Shift Dorms)
  const communalAreas = [
    { startX: 60, endX: 340, startY: 110, endY: 180, linkX: 184, linkY: 196 },
    { startX: 60, endX: 340, startY: 280, endY: 370, linkX: 184, linkY: 398 },
    { startX: 680, endX: 960, startY: 110, endY: 180, linkX: 842, linkY: 196 },
    { startX: 680, endX: 960, startY: 280, endY: 370, linkX: 842, linkY: 398 },
    { startX: 55, endX: 145, startY: 210, endY: 290, linkX: 36, linkY: 250 },
    { startX: 55, endX: 145, startY: 300, endY: 430, linkX: 36, linkY: 365 },
    { startX: 55, endX: 145, startY: 440, endY: 490, linkX: 36, linkY: 465 },
    { startX: 55, endX: 145, startY: 500, endY: 660, linkX: 36, linkY: 580 },
    { startX: 55, endX: 145, startY: 670, endY: 810, linkX: 36, linkY: 740 },
    { startX: 875, endX: 965, startY: 210, endY: 290, linkX: 987, linkY: 250 },
    { startX: 875, endX: 965, startY: 300, endY: 430, linkX: 987, linkY: 365 },
    { startX: 875, endX: 965, startY: 440, endY: 490, linkX: 987, linkY: 465 },
    { startX: 875, endX: 965, startY: 500, endY: 660, linkX: 987, linkY: 580 },
    { startX: 875, endX: 965, startY: 670, endY: 810, linkX: 987, linkY: 740 },
    { startX: 60, endX: 340, startY: 640, endY: 690, linkX: 184, linkY: 612 },
    { startX: 60, endX: 340, startY: 750, endY: 810, linkX: 184, linkY: 828 },
    { startX: 680, endX: 960, startY: 640, endY: 690, linkX: 842, linkY: 612 },
    { startX: 680, endX: 960, startY: 750, endY: 810, linkX: 842, linkY: 828 },
    { startX: 350, endX: 670, startY: 110, endY: 180, linkX: 510, linkY: 196 },
    { startX: 350, endX: 670, startY: 840, endY: 900, linkX: 510, linkY: 828 },
  ];

  for (const area of communalAreas) {
    buildDenseCommunalCluster(world, keep, area, rng);
  }

  // Layer 6: Зеркальные технические лабиринты (Mirrored Tech Labyrinths) - Увеличенная плотность (30 узлов)
  buildMirroredTechLabyrinth(world, keep, 190, 440, 415, 605, 168, 510, ZoneFaction.SCIENTIST, rng, 30);
  buildMirroredTechLabyrinth(world, keep, 580, 830, 415, 605, 856, 510, ZoneFaction.LIQUIDATOR, rng, 30);

  // Layer 7: Индустриальные балки и массивы труб (Macro-structures)
  applyIndustrialMacroStructures(world, keep, rng);

  // Layer 8: Уникальный легендарный POI «Сингулярный изолятор Мёбиуса» (The Spatial Singularity Isolator)
  buildMoebiusSingularityIsolator(world, keep, rng);
}

function buildMoebiusSingularityIsolator(world: World, keep: Uint8Array, _rng: () => number): void {
  const candidates = [
    { x: 480, y: 140, w: 32, h: 26, linkX: 496, linkY: 196 },
    { x: 480, y: 840, w: 32, h: 26, linkX: 496, linkY: 828 },
    { x: 480, y: 280, w: 32, h: 26, linkX: 496, linkY: 398 },
    { x: 480, y: 700, w: 32, h: 26, linkX: 496, linkY: 612 },
    { x: 200, y: 220, w: 32, h: 26, linkX: 216, linkY: 196 },
    { x: 780, y: 220, w: 32, h: 26, linkX: 796, linkY: 196 },
  ];

  for (const site of candidates) {
    let canPlace = true;
    for (let dy = -1; dy <= site.h; dy++) {
      for (let dx = -1; dx <= site.w; dx++) {
        if (keep[world.idx(site.x + dx, site.y + dy)]) {
          canPlace = false;
          break;
        }
      }
      if (!canPlace) break;
    }

    if (!canPlace) continue;

    const room = addMoebiusRoom(world, RoomType.PRODUCTION, site.x, site.y, site.w, site.h, 'Сингулярный изолятор Мёбиуса', Tex.METAL, Tex.F_TILE);
    paintRoomOwner(world, room, ZoneFaction.SCIENTIST);

    for (let wy = site.y + 6; wy <= site.y + site.h - 7; wy++) {
      for (let wx = site.x + 6; wx <= site.x + site.w - 7; wx++) {
        const ci = world.idx(wx, wy);
        world.cells[ci] = Cell.WATER;
        world.floorTex[ci] = Tex.F_WATER;
      }
    }

    for (let cy = site.y + 10; cy <= site.y + site.h - 11; cy++) {
      for (let cx = site.x + 10; cx <= site.x + site.w - 11; cx++) {
        const ci = world.idx(cx, cy);
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_TILE;
      }
    }

    const midX = site.x + (site.w >> 1);
    for (let wy = site.y + 6; wy <= site.y + site.h - 7; wy++) {
      const ci = world.idx(midX, wy);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_TILE;
    }

    setFeature(world, midX, site.y + 11, Feature.APPARATUS);
    setFeature(world, midX - 2, site.y + 11, Feature.MACHINE);
    setFeature(world, midX + 2, site.y + 11, Feature.MACHINE);

    addContainer(world, room, midX, site.y + 13, ContainerKind.SAFE, 'Сейф главного научного сотрудника Мёбиуса', 'locked', [
      { defId: 'uv_spotlight', count: 1 },
      { defId: 'krona_battery', count: 2 },
      { defId: 'decon_fluid', count: 1 },
      { defId: 'psi_storm', count: 1 },
      { defId: 'sealant_tube', count: 1 },
    ], ['moebius_podezd', 'mirror_tell', 'singularity_core', 'legendary_loot']);

    for (let rx = site.x + 3; rx <= site.x + site.w - 4; rx += 3) {
      setFeature(world, rx, site.y + 2, Feature.MACHINE);
      setFeature(world, rx, site.y + site.h - 3, Feature.MACHINE);
    }

    carveSafeConnectingCorridor(world, keep, midX, room.y + (room.h >> 1), midX, site.linkY, Tex.F_TILE, ZoneFaction.SCIENTIST, Tex.PIPE);

    for (let dy = -1; dy <= site.h; dy++) {
      for (let dx = -1; dx <= site.w; dx++) {
        keep[world.idx(site.x + dx, site.y + dy)] = 1;
      }
    }

    break;
  }
}

function tryPlacePocketLounge(
  world: World,
  keep: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  linkX: number,
  linkY: number,
  owner: TerritoryOwner,
  rng: () => number,
): void {
  if (x < 2 || y < 2 || x + w >= W - 2 || y + h >= W - 2) return;
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (keep[world.idx(x + dx, y + dy)]) return;
    }
  }

  const types = [RoomType.COMMON, RoomType.SMOKING, RoomType.STORAGE] as const;
  const type = types[Math.floor(rng() * types.length)]!;
  const name = type === RoomType.SMOKING ? 'Курилка магистрали Мёбиуса' : type === RoomType.STORAGE ? 'Технический карман магистрали' : 'Зал ожидания Мёбиуса';
  const wallTex = type === RoomType.STORAGE ? Tex.METAL : Tex.PANEL;
  const floorTex = type === RoomType.COMMON ? Tex.F_TILE : Tex.F_LINO;

  const room = addMoebiusRoom(world, type, x, y, w, h, name, wallTex, floorTex);
  paintRoomOwner(world, room, owner);

  if (type === RoomType.SMOKING) {
    setFeature(world, room.x + 3, room.y + 3, Feature.CHAIR);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.TABLE);
  } else if (type === RoomType.STORAGE) {
    setFeature(world, room.x + 3, room.y + 3, Feature.SHELF);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.APPARATUS);
  } else {
    setFeature(world, room.x + 4, room.y + 4, Feature.TABLE);
    setFeature(world, room.x + room.w - 5, room.y + room.h - 5, Feature.LAMP);
  }

  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  carveSafeConnectingCorridor(world, keep, cx, cy, linkX, linkY, floorTex, owner);

  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      keep[world.idx(x + dx, y + dy)] = 1;
    }
  }
}

function buildPerimeterBypassTunnels(world: World, keep: Uint8Array, rng: () => number): void {
  const leftX = 16;
  const rightX = 1004;
  const startY = 60;
  const endY = 960;

  // Carve left tunnel
  carveSafeConnectingCorridor(world, keep, leftX, startY, leftX, endY, Tex.F_CONCRETE, ZoneFaction.CITIZEN, Tex.PIPE);
  carveSafeConnectingCorridor(world, keep, leftX, 196, 36, 196, Tex.F_CONCRETE, ZoneFaction.CITIZEN, Tex.PIPE);
  carveSafeConnectingCorridor(world, keep, leftX, 828, 36, 828, Tex.F_CONCRETE, ZoneFaction.CITIZEN, Tex.PIPE);

  for (let y = startY + 20; y < endY - 20; y += 40) {
    if (rng() < 0.7) {
      const w = 10;
      const h = 8;
      let canPlace = true;
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          if (keep[world.idx(leftX + 2 + dx, y + dy)]) {
            canPlace = false;
            break;
          }
        }
        if (!canPlace) break;
      }
      if (canPlace) {
        const room = addMoebiusRoom(world, RoomType.PRODUCTION, leftX + 2, y, w, h, 'Щитовая периметра Мёбиуса', Tex.METAL, Tex.F_CONCRETE);
        paintRoomOwner(world, room, ZoneFaction.CITIZEN);
        setFeature(world, room.x + 2, room.y + 2, Feature.MACHINE);
        carveSafeConnectingCorridor(world, keep, room.x + (w >> 1), room.y + (h >> 1), leftX, room.y + (h >> 1), Tex.F_CONCRETE, ZoneFaction.CITIZEN);
        for (let dy = -1; dy <= h; dy++) {
          for (let dx = -1; dx <= w; dx++) {
            keep[world.idx(leftX + 2 + dx, y + dy)] = 1;
          }
        }
      }
    }
  }

  // Carve right tunnel
  carveSafeConnectingCorridor(world, keep, rightX, startY, rightX, endY, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR, Tex.PIPE);
  carveSafeConnectingCorridor(world, keep, rightX, 196, 987, 196, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR, Tex.PIPE);
  carveSafeConnectingCorridor(world, keep, rightX, 828, 987, 828, Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR, Tex.PIPE);

  for (let y = startY + 20; y < endY - 20; y += 40) {
    if (rng() < 0.7) {
      const w = 10;
      const h = 8;
      const rx = rightX - w - 2;
      let canPlace = true;
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          if (keep[world.idx(rx + dx, y + dy)]) {
            canPlace = false;
            break;
          }
        }
        if (!canPlace) break;
      }
      if (canPlace) {
        const room = addMoebiusRoom(world, RoomType.STORAGE, rx, y, w, h, 'Кладовая периметра Мёбиуса', Tex.METAL, Tex.F_CONCRETE);
        paintRoomOwner(world, room, ZoneFaction.LIQUIDATOR);
        setFeature(world, room.x + 2, room.y + 2, Feature.APPARATUS);
        carveSafeConnectingCorridor(world, keep, room.x + (w >> 1), room.y + (h >> 1), rightX, room.y + (h >> 1), Tex.F_CONCRETE, ZoneFaction.LIQUIDATOR);
        for (let dy = -1; dy <= h; dy++) {
          for (let dx = -1; dx <= w; dx++) {
            keep[world.idx(rx + dx, y + dy)] = 1;
          }
        }
      }
    }
  }
}

function buildStateReserveWarehouses(
  world: World,
  keep: Uint8Array,
  area: { startX: number; endX: number; startY: number; endY: number; linkX: number; linkY: number },
  _rng: () => number,
): void {
  const roomW = 24;
  const roomH = 18;
  const gapX = 6;
  const gapY = 6;

  for (let y = area.startY; y <= area.endY - roomH; y += roomH + gapY) {
    for (let x = area.startX; x <= area.endX - roomW; x += roomW + gapX) {
      let canPlace = true;
      for (let dy = -1; dy <= roomH; dy++) {
        for (let dx = -1; dx <= roomW; dx++) {
          if (keep[world.idx(x + dx, y + dy)]) {
            canPlace = false;
            break;
          }
        }
        if (!canPlace) break;
      }
      if (!canPlace) continue;

      const room = addMoebiusRoom(world, RoomType.STORAGE, x, y, roomW, roomH, 'Заброшенный склад госрезерва', Tex.CONCRETE, Tex.F_CONCRETE);
      paintRoomOwner(world, room, ZoneFaction.CITIZEN);

      for (let sy = y + 3; sy <= y + roomH - 4; sy += 3) {
        for (let sx = x + 3; sx <= x + roomW - 4; sx += 2) {
          setFeature(world, sx, sy, Feature.SHELF);
        }
      }

      const cx = room.x + (room.w >> 1);
      carveSafeConnectingCorridor(world, keep, cx, room.y + (room.h >> 1), cx, area.linkY, Tex.F_CONCRETE, ZoneFaction.CITIZEN);

      for (let dy = -1; dy <= roomH; dy++) {
        for (let dx = -1; dx <= roomW; dx++) {
          keep[world.idx(x + dx, y + dy)] = 1;
        }
      }
    }
  }
}

function buildGiantIndustrialHall(
  world: World,
  keep: Uint8Array,
  hall: { x: number; y: number; w: number; h: number; linkX: number; linkY: number; isWater: boolean },
  _rng: () => number,
): void {
  let canPlace = true;
  for (let dy = -1; dy <= hall.h; dy++) {
    for (let dx = -1; dx <= hall.w; dx++) {
      if (keep[world.idx(hall.x + dx, hall.y + dy)]) {
        canPlace = false;
        break;
      }
    }
    if (!canPlace) break;
  }
  if (!canPlace) return;

  const name = hall.isWater ? 'Зал водоочистки Мёбиуса' : 'Вентиляционная градирня Мёбиуса';
  const floorTex = hall.isWater ? Tex.F_TILE : Tex.F_CONCRETE;
  const room = addMoebiusRoom(world, RoomType.PRODUCTION, hall.x, hall.y, hall.w, hall.h, name, Tex.CONCRETE, floorTex);
  paintRoomOwner(world, room, ZoneFaction.CITIZEN);

  if (hall.isWater) {
    for (let wy = hall.y + 4; wy <= hall.y + hall.h - 5; wy++) {
      for (let wx = hall.x + 4; wx <= hall.x + hall.w - 5; wx++) {
        const ci = world.idx(wx, wy);
        world.cells[ci] = Cell.WATER;
        world.floorTex[ci] = Tex.F_WATER;
      }
    }
    setFeature(world, hall.x + 2, hall.y + 2, Feature.MACHINE);
    setFeature(world, hall.x + hall.w - 3, hall.y + hall.h - 3, Feature.MACHINE);
  } else {
    for (let my = hall.y + 4; my <= hall.y + hall.h - 5; my += 4) {
      for (let mx = hall.x + 4; mx <= hall.x + hall.w - 5; mx += 4) {
        setFeature(world, mx, my, Feature.MACHINE);
      }
    }
  }

  const cx = room.x + (room.w >> 1);
  carveSafeConnectingCorridor(world, keep, cx, room.y + (room.h >> 1), cx, hall.linkY, floorTex, ZoneFaction.CITIZEN);

  for (let dy = -1; dy <= hall.h; dy++) {
    for (let dx = -1; dx <= hall.w; dx++) {
      keep[world.idx(hall.x + dx, hall.y + dy)] = 1;
    }
  }
}

function buildDenseCommunalCluster(
  world: World,
  keep: Uint8Array,
  area: { startX: number; endX: number; startY: number; endY: number; linkX: number; linkY: number },
  rng: () => number,
): void {
  const spineY = Math.floor((area.startY + area.endY) / 2);
  const roomW = 16;
  const roomH = 12;
  const gapX = 4;
  const gapY = 4;

  let firstPlacedX = -1;
  let lastPlacedX = -1;

  for (let y = area.startY; y <= area.endY - roomH; y += roomH + gapY) {
    if (Math.abs(y - spineY) < 6) continue; // Leave space for spine corridor
    for (let x = area.startX; x <= area.endX - roomW; x += roomW + gapX) {
      let canPlace = true;
      for (let dy = -1; dy <= roomH; dy++) {
        for (let dx = -1; dx <= roomW; dx++) {
          if (keep[world.idx(x + dx, y + dy)]) {
            canPlace = false;
            break;
          }
        }
        if (!canPlace) break;
      }
      if (!canPlace) continue;

      const types = [RoomType.LIVING, RoomType.KITCHEN, RoomType.BATHROOM, RoomType.LIVING] as const;
      const type = types[Math.floor(rng() * types.length)]!;
      const name = type === RoomType.KITCHEN ? 'Коммунальная кухня уплотнения' : type === RoomType.BATHROOM ? 'Санузел уплотнения' : 'Жилая ячейка уплотнения Мёбиуса';
      const wallTex = type === RoomType.BATHROOM ? Tex.TILE_W : Tex.PANEL;
      const floorTex = type === RoomType.BATHROOM ? Tex.F_TILE : type === RoomType.KITCHEN ? Tex.F_LINO : Tex.F_CARPET;

      const room = addMoebiusRoom(world, type, x, y, roomW, roomH, name, wallTex, floorTex);
      paintRoomOwner(world, room, ZoneFaction.CITIZEN);

      if (type === RoomType.KITCHEN) {
        setFeature(world, room.x + 3, room.y + 3, Feature.STOVE);
        setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.SINK);
      } else if (type === RoomType.BATHROOM) {
        setFeature(world, room.x + 3, room.y + 3, Feature.SINK);
        setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.TOILET);
      } else {
        setFeature(world, room.x + 4, room.y + 4, Feature.BED);
        setFeature(world, room.x + room.w - 5, room.y + room.h - 5, Feature.SHELF);
      }

      const cx = room.x + (room.w >> 1);
      carveSafeConnectingCorridor(world, keep, cx, room.y + (room.h >> 1), cx, spineY, Tex.F_LINO, ZoneFaction.CITIZEN);

      for (let dy = -1; dy <= roomH; dy++) {
        for (let dx = -1; dx <= roomW; dx++) {
          keep[world.idx(x + dx, y + dy)] = 1;
        }
      }

      if (firstPlacedX === -1 || cx < firstPlacedX) firstPlacedX = cx;
      if (lastPlacedX === -1 || cx > lastPlacedX) lastPlacedX = cx;
    }
  }

  if (firstPlacedX !== -1 && lastPlacedX !== -1) {
    carveSafeConnectingCorridor(world, keep, firstPlacedX, spineY, lastPlacedX, spineY, Tex.F_LINO, ZoneFaction.CITIZEN);
    carveSafeConnectingCorridor(world, keep, Math.floor((firstPlacedX + lastPlacedX) / 2), spineY, area.linkX, area.linkY, Tex.F_LINO, ZoneFaction.CITIZEN);
  }
}

function buildMirroredTechLabyrinth(
  world: World,
  keep: Uint8Array,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
  linkX: number,
  linkY: number,
  owner: TerritoryOwner,
  rng: () => number,
  count = 15,
): void {
  const waypoints: { x: number; y: number }[] = [];
  const roomW = 14;
  const roomH = 12;

  for (let i = 0; i < count; i++) {
    const x = startX + Math.floor(rng() * (endX - startX - roomW));
    const y = startY + Math.floor(rng() * (endY - startY - roomH));
    let canPlace = true;
    for (let dy = -1; dy <= roomH; dy++) {
      for (let dx = -1; dx <= roomW; dx++) {
        if (keep[world.idx(x + dx, y + dy)]) {
          canPlace = false;
          break;
        }
      }
      if (!canPlace) break;
    }
    if (!canPlace) continue;

    const type = rng() < 0.5 ? RoomType.PRODUCTION : RoomType.STORAGE;
    const name = 'Зеркальная техническая выработка';
    const room = addMoebiusRoom(world, type, x, y, roomW, roomH, name, Tex.METAL, Tex.F_CONCRETE);
    paintRoomOwner(world, room, owner);

    setFeature(world, room.x + 3, room.y + 3, type === RoomType.PRODUCTION ? Feature.MACHINE : Feature.SHELF);
    setFeature(world, room.x + room.w - 4, room.y + room.h - 4, Feature.APPARATUS);

    const cx = room.x + (room.w >> 1);
    const cy = room.y + (room.h >> 1);
    waypoints.push({ x: cx, y: cy });

    for (let dy = -1; dy <= roomH; dy++) {
      for (let dx = -1; dx <= roomW; dx++) {
        keep[world.idx(x + dx, y + dy)] = 1;
      }
    }
  }

  if (waypoints.length > 0) {
    for (let i = 1; i < waypoints.length; i++) {
      const a = waypoints[i - 1]!;
      const b = waypoints[i]!;
      // Carve with an intermediate waypoint to make it organic/winding
      const midX = rng() < 0.5 ? a.x : b.x;
      const midY = midX === a.x ? b.y : a.y;
      carveSafeConnectingCorridor(world, keep, a.x, a.y, midX, midY, Tex.F_CONCRETE, owner, Tex.PIPE);
      carveSafeConnectingCorridor(world, keep, midX, midY, b.x, b.y, Tex.F_CONCRETE, owner, Tex.PIPE);
    }
    carveSafeConnectingCorridor(world, keep, waypoints[0]!.x, waypoints[0]!.y, linkX, linkY, Tex.F_CONCRETE, owner, Tex.PIPE);
  }
}

function carveSafeConnectingCorridor(
  world: World,
  keep: Uint8Array,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  floorTex: Tex,
  owner: TerritoryOwner,
  wallTex = Tex.PANEL,
): void {
  let x = world.wrap(fromX);
  let y = world.wrap(fromY);
  const dx = Math.sign(world.delta(x, toX));
  const dy = Math.sign(world.delta(y, toY));

  const stepCell = (cx: number, cy: number) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = world.wrap(cx + ox);
        const ty = world.wrap(cy + oy);
        const ci = world.idx(tx, ty);
        // Never overwrite lifts, doors, hermetic walls, or existing room floors
        if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR || world.hermoWall[ci] || world.roomMap[ci] >= 0) continue;
        world.cells[ci] = Cell.FLOOR;
        world.roomMap[ci] = -1;
        world.floorTex[ci] = floorTex;
        world.wallTex[ci] = wallTex;
        world.factionControl[ci] = owner;
        if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
        keep[ci] = 1;
      }
    }
  };

  while (x !== world.wrap(toX)) {
    stepCell(x, y);
    x = world.wrap(x + dx);
  }
  while (y !== world.wrap(toY)) {
    stepCell(x, y);
    y = world.wrap(y + dy);
  }
  stepCell(x, y);
}

function applyIndustrialMacroStructures(world: World, keep: Uint8Array, rng: () => number): void {
  const step = 32;
  for (let y = 16; y < W - 16; y += step) {
    for (let x = 16; x < W - 16; x += step) {
      if (rng() < 0.3) {
        const isHorizontal = rng() < 0.5;
        const length = 24 + Math.floor(rng() * 32);
        const width = 2 + Math.floor(rng() * 3);
        const tex = rng() < 0.5 ? Tex.CONCRETE : Tex.PIPE;

        for (let l = 0; l < length; l++) {
          for (let w = 0; w < width; w++) {
            const tx = world.wrap(isHorizontal ? x + l : x + w);
            const ty = world.wrap(isHorizontal ? y + w : y + l);
            const ci = world.idx(tx, ty);
            if (keep[ci] === 0 && world.cells[ci] === Cell.WALL && !world.hermoWall[ci]) {
              world.wallTex[ci] = tex;
            }
          }
        }
      }
    }
  }
}
