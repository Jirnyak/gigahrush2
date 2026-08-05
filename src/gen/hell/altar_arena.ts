/* ── Hell altar arena: capped combat POI ─────────────────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  W, Cell, DoorState, EntityType, AIGoal, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, RoomType, Tex,
  type Entity, type GameState, type Room, type WorldEvent,
} from '../../core/types';
import { World } from '../../core/world';
import { freshNeeds, randomName } from '../../data/catalog';
import { MONSTERS } from '../../entities/monster';
import { getMaxHp, gaussianLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { Spr } from '../../render/sprite_index';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { playRouteCueTone, playSoundAt } from '../../systems/audio';
import { publishEvent, registerWorldEventObserver } from '../../systems/events';
import { registerRouteCue } from '../../systems/route_cues';
import { findClearArea, protectRoom, stampRoom } from '../shared';
import { isPlayerEntity } from '../../systems/player_actor';

const ROOM_W = 23;
const ROOM_H = 19;
const ROUTE_MAX = 80;
const SCREEN_VARIANT_VOID_PROTOCOL = 7;
const SCREEN_FRAMES = 4;
const CUE_ID_PREFIX = 'hell_altar_arena';
const EVENT_TAG = 'hell_altar_arena_event';
const TAG_SITE = 'hell_altar_arena';
const PHASE_FLANK_KILLS = 3;
const PHASE_BOSS_KILLS = 7;

export const HELL_ALTAR_ARENA_MONSTER_CAP = 9;
export const HELL_ALTAR_ARENA_CULTIST_CAP = 4;
export const HELL_ALTAR_ARENA_TOTAL_HOSTILE_CAP = HELL_ALTAR_ARENA_MONSTER_CAP + HELL_ALTAR_ARENA_CULTIST_CAP;

type ArenaWave = 0 | 1 | 2;

interface Site {
  x: number;
  y: number;
}

interface ArenaRoomRef {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Route {
  doorX: number;
  doorY: number;
  outX: number;
  outY: number;
  stepX: number;
  stepY: number;
  perpX: number;
  perpY: number;
}

interface AltarArenaSite {
  floor: FloorLevel;
  roomId: number;
  roomX: number;
  roomY: number;
  roomW: number;
  roomH: number;
  zoneId: number;
  x: number;
  y: number;
  entryX: number;
  entryY: number;
  escapeX: number;
  escapeY: number;
  cueId: string;
  warned: boolean;
  phase: ArenaWave;
  killedIds: number[];
  hostileIds: number[];
  monsterIds: number[];
  cultistIds: number[];
  rewardSpawned: boolean;
  cleared: boolean;
}

const MONSTER_PLACEMENTS: readonly { kind: MonsterKind; dx: number; dy: number; name?: string; bonus: number; wave: ArenaWave }[] = [
  { kind: MonsterKind.EYE, dx: 5, dy: 5, bonus: 3, wave: 0 },
  { kind: MonsterKind.EYE, dx: 17, dy: 5, bonus: 3, wave: 0 },
  { kind: MonsterKind.TVAR, dx: 8, dy: 8, bonus: 1, wave: 0 },
  { kind: MonsterKind.TVAR, dx: 14, dy: 8, bonus: 1, wave: 0 },
  { kind: MonsterKind.SHADOW, dx: 4, dy: 10, bonus: 2, wave: 1 },
  { kind: MonsterKind.SHADOW, dx: 18, dy: 10, bonus: 2, wave: 1 },
  { kind: MonsterKind.POLZUN, dx: 7, dy: 14, bonus: 2, wave: 1 },
  { kind: MonsterKind.REBAR, dx: 15, dy: 14, bonus: 2, wave: 1 },
  { kind: MonsterKind.NIGHTMARE, dx: 11, dy: 5, name: 'Кошмарище пепельной плиты', bonus: 4, wave: 2 },
];

const CULTIST_PLACEMENTS: readonly { dx: number; dy: number; wave: ArenaWave }[] = [
  { dx: 3, dy: 3, wave: 0 },
  { dx: 19, dy: 3, wave: 0 },
  { dx: 3, dy: 15, wave: 1 },
  { dx: 19, dy: 15, wave: 1 },
];

const RIB_COVER_CELLS: readonly [number, number][] = [
  [9, 4], [10, 4], [12, 4], [13, 4],
  [6, 7], [6, 8], [6, 10], [6, 11],
  [16, 7], [16, 8], [16, 10], [16, 11],
  [9, 12], [10, 12], [12, 12], [13, 12],
];

let activeWorld: World | null = null;
let activeEntities: Entity[] | null = null;
let activeSite: AltarArenaSite | null = null;

registerWorldEventObserver(handleAltarArenaEvent);

export function spawnHellAltarArena(world: World, entities: Entity[], nextId: { v: number }): void {
  activeWorld = world;
  activeEntities = entities;
  activeSite = null;

  const site = findArenaSite(world);
  if (!site) return;

  const room = stampRoom(world, world.rooms.length, RoomType.COMMON, site.x, site.y, ROOM_W, ROOM_H, -1);
  room.name = 'Пепельная плита готовности';
  room.wallTex = Tex.GUT;
  room.floorTex = Tex.F_MEAT;
  protectRoom(world, room.x, room.y, room.w, room.h, Tex.GUT, Tex.F_MEAT);

  const routes = bestRoutes(world, room);
  carveArenaDoorRoute(world, room, routes.entry, DoorState.CLOSED);
  if (!sameRoute(routes.entry, routes.escape)) carveArenaDoorRoute(world, room, routes.escape, DoorState.OPEN);
  decorateArena(world, room, routes.entry, routes.escape);

  const monsterIds = spawnArenaMonsters(world, room, entities, nextId, 0, undefined, HELL_ALTAR_ARENA_MONSTER_CAP);
  const cultistIds = spawnArenaCultists(world, room, entities, nextId, 0, undefined, HELL_ALTAR_ARENA_CULTIST_CAP);
  const cueId = registerAltarRouteCue(world, room, routes.entry, routes.escape);
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  const ci = world.idx(cx, cy);
  activeSite = {
    floor: FloorLevel.HELL,
    roomId: room.id,
    roomX: room.x,
    roomY: room.y,
    roomW: room.w,
    roomH: room.h,
    zoneId: world.zoneMap[ci],
    x: cx + 0.5,
    y: cy + 0.5,
    entryX: routes.entry.outX + 0.5,
    entryY: routes.entry.outY + 0.5,
    escapeX: routes.escape.outX + 0.5,
    escapeY: routes.escape.outY + 0.5,
    cueId,
    warned: false,
    phase: 0,
    killedIds: [],
    hostileIds: [...monsterIds, ...cultistIds],
    monsterIds,
    cultistIds,
    rewardSpawned: false,
    cleared: false,
  };
}

export function getHellAltarArenaDebugSite(): AltarArenaSite | null {
  return activeSite ? {
    ...activeSite,
    killedIds: [...activeSite.killedIds],
    hostileIds: [...activeSite.hostileIds],
    monsterIds: [...activeSite.monsterIds],
    cultistIds: [...activeSite.cultistIds],
  } : null;
}

export function resetHellAltarArenaForTests(): void {
  activeWorld = null;
  activeEntities = null;
  activeSite = null;
}

function findArenaSite(world: World): Site | null {
  const cx = W >> 1;
  const cy = W >> 1;
  const direct = findClearArea(world, cx, cy, ROOM_W, ROOM_H, 145, 320);
  if (direct && canStampArena(world, direct.x, direct.y)) return direct;

  for (let attempt = 0; attempt < 1600; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 130 + Math.random() * 280;
    const x = world.wrap(cx + Math.round(Math.cos(angle) * dist) - (ROOM_W >> 1));
    const y = world.wrap(cy + Math.round(Math.sin(angle) * dist) - (ROOM_H >> 1));
    if (canStampArena(world, x, y)) return { x, y };
  }

  for (let attempt = 0; attempt < 1200; attempt++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (canStampArena(world, x, y)) return { x, y };
  }
  return null;
}

function canStampArena(world: World, x: number, y: number): boolean {
  for (let dy = -3; dy <= ROOM_H + 3; dy++) {
    for (let dx = -3; dx <= ROOM_W + 3; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.roomMap[ci] >= 0) return false;
    }
  }
  return true;
}

function arenaRoutes(room: Room): readonly Route[] {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  return [
    { doorX: cx, doorY: room.y - 1, outX: cx, outY: room.y - 2, stepX: 0, stepY: -1, perpX: 1, perpY: 0 },
    { doorX: cx, doorY: room.y + room.h, outX: cx, outY: room.y + room.h + 1, stepX: 0, stepY: 1, perpX: 1, perpY: 0 },
    { doorX: room.x - 1, doorY: cy, outX: room.x - 2, outY: cy, stepX: -1, stepY: 0, perpX: 0, perpY: 1 },
    { doorX: room.x + room.w, doorY: cy, outX: room.x + room.w + 1, outY: cy, stepX: 1, stepY: 0, perpX: 0, perpY: 1 },
  ];
}

function bestRoutes(world: World, room: Room): { entry: Route; escape: Route } {
  const routes = arenaRoutes(room);
  const scored = routes.map(route => ({ route, score: routeScore(world, route) }));
  scored.sort((a, b) => a.score - b.score);
  const entry = scored[0].route;
  const escape = scored.find(item => !sameRoute(item.route, entry) && item.score <= ROUTE_MAX)?.route ?? entry;
  return { entry, escape };
}

function sameRoute(a: Route, b: Route): boolean {
  return a.doorX === b.doorX && a.doorY === b.doorY && a.outX === b.outX && a.outY === b.outY;
}

function routeScore(world: World, route: Route): number {
  for (let step = 1; step <= ROUTE_MAX; step++) {
    for (let side = -1; side <= 1; side++) {
      const x = route.outX + route.stepX * step + route.perpX * side;
      const y = route.outY + route.stepY * step + route.perpY * side;
      const ci = world.idx(x, y);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.roomMap[ci] >= 0) return ROUTE_MAX + 20;
      if (world.cells[ci] === Cell.FLOOR) return step;
    }
  }
  return ROUTE_MAX + 10;
}

function carveArenaDoorRoute(world: World, room: Room, route: Route, state: DoorState): void {
  const doorI = world.idx(route.doorX, route.doorY);
  world.cells[doorI] = Cell.DOOR;
  world.wallTex[doorI] = Tex.DOOR_METAL;
  world.aptMask[doorI] = 0;
  world.doors.set(doorI, {
    idx: doorI,
    state,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorI);

  for (let step = 0; step <= ROUTE_MAX; step++) {
    let touchesOpenFloor = false;
    for (let side = -1; side <= 1; side++) {
      const x = route.outX + route.stepX * step + route.perpX * side;
      const y = route.outY + route.stepY * step + route.perpY * side;
      const ci = world.idx(x, y);
      if (world.aptMask[ci] || world.cells[ci] === Cell.LIFT || world.roomMap[ci] >= 0) continue;
      if (step > 2 && world.cells[ci] === Cell.FLOOR) touchesOpenFloor = true;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_MEAT;
      world.aptMask[ci] = 0;
    }
    if (touchesOpenFloor) return;
  }
}

function decorateArena(world: World, room: Room, entry: Route, escape: Route): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  placeRibCover(world, room);
  setFeature(world, cx, cy, Feature.APPARATUS, 5);
  for (const [dx, dy] of [[0, -5], [4, -3], [5, 0], [4, 3], [0, 5], [-4, 3], [-5, 0], [-4, -3]] as const) {
    setFeature(world, cx + dx, cy + dy, Feature.CANDLE, 5);
  }
  setFeature(world, entry.outX, entry.outY, Feature.LAMP, 7);
  setFeature(world, entry.outX + entry.perpX * 2, entry.outY + entry.perpY * 2, Feature.CANDLE, 5);
  setFeature(world, entry.outX - entry.perpX * 2, entry.outY - entry.perpY * 2, Feature.CANDLE, 5);
  setFeature(world, escape.outX, escape.outY, Feature.LAMP, 8);
  setFeature(world, escape.outX + escape.perpX * 2, escape.outY + escape.perpY * 2, Feature.LAMP, 7);
  setFeature(world, escape.outX - escape.perpX * 2, escape.outY - escape.perpY * 2, Feature.LAMP, 7);

  const screen = screenWallCell(world, room, entry);
  if (screen >= 0) {
    world.features[screen] = Feature.SCREEN;
    world.wallTex[screen] = (Tex.SCREEN_BASE + SCREEN_VARIANT_VOID_PROTOCOL * SCREEN_FRAMES) as Tex;
  }

  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    const x = Math.floor(cx + Math.cos(a) * 6);
    const y = Math.floor(cy + Math.sin(a) * 5);
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.34, 125, 5300 + i, 120, 22, 36);
  }
  stampEscapeTrail(world, room, escape);
  stampWaveTelegraphs(world, room, 1, 90);
  stampWaveTelegraphs(world, room, 2, 120);
}

function placeRibCover(world: World, room: Room): void {
  for (const [dx, dy] of RIB_COVER_CELLS) {
    const x = room.x + dx;
    const y = room.y + dy;
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR || world.features[ci] !== Feature.NONE) continue;
    world.cells[ci] = Cell.WALL;
    world.wallTex[ci] = Tex.GUT;
    world.roomMap[ci] = -1;
    stampMark(world, x, y, 0.5, 0.5, 0.46, MarkType.SCORCH, room.id * 727 + dx * 17 + dy, 95, 20, 34, 130, true);
  }
  world.markCellsDirty();
}

function stampEscapeTrail(world: World, room: Room, escape: Route): void {
  const cx = room.x + (room.w >> 1);
  const cy = room.y + (room.h >> 1);
  for (let step = 2; step <= 9; step += 2) {
    const wobble = (step & 2) === 0 ? 1 : -1;
    stampMark(
      world,
      cx + escape.stepX * step + escape.perpX * wobble,
      cy + escape.stepY * step + escape.perpY * wobble,
      0.5, 0.5, 0.38, MarkType.PSI, room.id * 911 + step,
      210, 156, 62, 120,
    );
  }
  for (let step = 2; step <= 16; step += 4) {
    stampMark(
      world,
      escape.outX + escape.stepX * step,
      escape.outY + escape.stepY * step,
      0.5, 0.5, 0.34, MarkType.SCORCH, room.id * 997 + step,
      230, 166, 70, 115,
    );
  }
}

function stampWaveTelegraphs(world: World, room: ArenaRoomRef, wave: ArenaWave, intensity: number): void {
  for (const placement of MONSTER_PLACEMENTS) {
    if (placement.wave !== wave) continue;
    stampMark(
      world,
      room.x + placement.dx,
      room.y + placement.dy,
      0.5, 0.5, wave === 2 ? 1.05 : 0.54,
      wave === 2 ? MarkType.POOL : MarkType.PSI,
      room.id * 1301 + placement.dx * 31 + placement.dy * 17 + wave,
      wave === 2 ? 126 : 178,
      wave === 2 ? 18 : 42,
      wave === 2 ? 46 : 150,
      intensity,
    );
  }
  for (const placement of CULTIST_PLACEMENTS) {
    if (placement.wave !== wave) continue;
    stampMark(
      world,
      room.x + placement.dx,
      room.y + placement.dy,
      0.5, 0.5, 0.44, MarkType.DRIP,
      room.id * 1423 + placement.dx * 13 + placement.dy * 19 + wave,
      180, 44, 34, Math.max(70, intensity - 20),
    );
  }
}

function screenWallCell(world: World, room: Room, route: Route): number {
  const oppositeX = room.x + (room.w >> 1) - route.stepX * ((room.w >> 1) + 1);
  const oppositeY = room.y + (room.h >> 1) - route.stepY * ((room.h >> 1) + 1);
  const ci = world.idx(oppositeX, oppositeY);
  return world.cells[ci] === Cell.WALL ? ci : -1;
}

function setFeature(world: World, x: number, y: number, feature: Feature, lightRadius: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return;
  world.features[ci] = feature;
  addLocalLight(world, x, y, lightRadius);
}

function addLocalLight(world: World, lx: number, ly: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const ci = world.idx(lx + dx, ly + dy);
      const brightness = 1 - Math.sqrt(d2) / radius;
      if (brightness > world.light[ci]) world.light[ci] = brightness;
    }
  }
}

function spawnArenaMonsters(
  world: World,
  room: ArenaRoomRef,
  entities: Entity[],
  nextId: { v: number },
  wave: ArenaWave,
  target: Entity | undefined,
  cap: number,
): number[] {
  const ids: number[] = [];
  for (const placement of MONSTER_PLACEMENTS) {
    if (placement.wave !== wave || ids.length >= cap) continue;
    const entity = createArenaMonster(world, room, nextId, placement.kind, placement.dx, placement.dy, placement.bonus, placement.name, target);
    entities.push(entity);
    ids.push(entity.id);
  }
  return ids;
}

function createArenaMonster(
  world: World,
  room: ArenaRoomRef,
  nextId: { v: number },
  kind: MonsterKind,
  dx: number,
  dy: number,
  bonus: number,
  name?: string,
  target?: Entity,
): Entity {
  const x = room.x + dx + 0.5;
  const y = room.y + dy + 0.5;
  const def = MONSTERS[kind];
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 10;
  const level = zoneLevel + bonus;
  const rpg = randomRPG(level);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level) * (1 + rpg.str * 0.1)));
  const entity: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x,
    y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: def.sprite,
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: {
      goal: target ? AIGoal.HUNT : AIGoal.WANDER,
      tx: Math.floor(target?.x ?? x),
      ty: Math.floor(target?.y ?? y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: target ? 0 : 2 + Math.random() * 2,
    },
    rpg,
  };
  return entity;
}

function spawnArenaCultists(
  world: World,
  room: ArenaRoomRef,
  entities: Entity[],
  nextId: { v: number },
  wave: ArenaWave,
  target: Entity | undefined,
  cap: number,
): number[] {
  const ids: number[] = [];
  for (const placement of CULTIST_PLACEMENTS) {
    if (placement.wave !== wave || ids.length >= cap) continue;
    const entity = createArenaCultist(world, room, nextId, placement.dx, placement.dy, target);
    entities.push(entity);
    ids.push(entity.id);
  }
  return ids;
}

function createArenaCultist(world: World, room: ArenaRoomRef, nextId: { v: number }, dx: number, dy: number, target?: Entity): Entity {
  const x = room.x + dx + 0.5;
  const y = room.y + dy + 0.5;
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? 10;
  const rpg = randomRPG(gaussianLevel(zoneLevel + 2, 1.5));
  const maxHp = Math.max(1, Math.round(getMaxHp(rpg) * 1.35));
  const nm = randomName(Faction.CULTIST);
  const weapon = Math.random() < 0.65 ? 'psi_meat_hook' : 'rebar';
  return {
    id: nextId.v++,
    type: EntityType.NPC,
    x,
    y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.25 + Math.random() * 0.25,
    sprite: Occupation.PILGRIM,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    ai: {
      goal: target ? AIGoal.HUNT : AIGoal.IDLE,
      tx: Math.floor(target?.x ?? x),
      ty: Math.floor(target?.y ?? y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
    },
    inventory: [{ defId: weapon, count: 1 }],
    weapon,
    familyId: -1,
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    questId: -1,
    canGiveQuest: false,
    rpg,
  };
}

function dropArenaReward(world: World, room: ArenaRoomRef, entities: Entity[], nextId: { v: number }): void {
  const x = room.x + (room.w >> 1);
  const y = room.y + (room.h >> 1) + 1;
  if (world.cells[world.idx(x, y)] !== Cell.FLOOR) return;
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
    inventory: [
      { defId: 'psi_meat_hook', count: 1 },
      { defId: 'meat_rune', count: 1 },
      { defId: 'ammo_energy', count: 2 },
    ],
  });
}

function registerAltarRouteCue(world: World, room: Room, entry: Route, escape: Route): string {
  const cueId = `${CUE_ID_PREFIX}_${room.id}`;
  const cueX = entry.outX + entry.stepX * 3 + 0.5;
  const cueY = entry.outY + entry.stepY * 3 + 0.5;
  const cx = room.x + (room.w >> 1) + 0.5;
  const cy = room.y + (room.h >> 1) + 0.5;
  const escapeDist = Math.round(world.dist(cx, cy, escape.outX + 0.5, escape.outY + 0.5));
  registerRouteCue(world, {
    id: cueId,
    x: cueX,
    y: cueY,
    targetX: cx,
    targetY: cy,
    floor: FloorLevel.HELL,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: world.zoneMap[world.idx(Math.floor(cx), Math.floor(cy))],
    label: 'пепельная плита',
    hint: 'глаза держат дальнюю линию; желтые ожоги ведут к выходу',
    targetName: 'Пепельная плита готовности',
    color: '#f96',
    tags: [TAG_SITE, 'hell', 'arena', 'combat', 'phase_cue', 'escape_route'],
    toneSeed: room.id * 313 + 86086,
    radius: 11,
    targetRadius: 3.4,
    cooldownSec: 24,
    heardText: 'За дверью пепельная плита: сначала снимай глаза и культистов, держи ребро между собой и центром.',
    followedText: `Пепельная плита включилась. Желтые ожоги на полу ведут к выходу примерно в ${escapeDist} кл.`,
    ignoredText: 'Пепельная плита осталась за спиной. Волны начнутся без вашей подготовки.',
  });
  return cueId;
}

function handleAltarArenaEvent(state: GameState, event: WorldEvent): void {
  if (event.tags.includes(EVENT_TAG)) return;
  const site = activeSite;
  const world = activeWorld;
  const entities = activeEntities;
  if (!site || !world || !entities || state.currentFloor !== site.floor || event.floor !== site.floor) return;

  if (event.type === 'rumor_observed' && event.data?.cueId === site.cueId) {
    handleCueEvent(state, site, event);
    return;
  }

  if ((event.type === 'player_kill_monster' || event.type === 'player_kill_npc') && event.targetId !== undefined) {
    handleKillEvent(state, world, entities, site, event);
  }
}

function handleCueEvent(state: GameState, site: AltarArenaSite, event: WorldEvent): void {
  const action = typeof event.data?.action === 'string' ? event.data.action : '';
  if (action === 'heard' || action === 'inspected' || action === 'debug') {
    site.warned = true;
    return;
  }
  if (action !== 'followed') return;
  site.warned = true;
  publishArenaEvent(
    state,
    site,
    event,
    'entered',
    'Пепельная плита включилась: дальние глаза держат центр, ребра дают укрытие, желтый след ведет наружу.',
    3,
    { action },
  );
}

function handleKillEvent(
  state: GameState,
  world: World,
  entities: Entity[],
  site: AltarArenaSite,
  event: WorldEvent,
): void {
  const targetId = event.targetId ?? -1;
  if (!site.hostileIds.includes(targetId) || site.killedIds.includes(targetId)) return;
  site.killedIds.push(targetId);

  if (site.phase === 0 && site.killedIds.length >= PHASE_FLANK_KILLS) {
    spawnArenaWave(state, world, entities, site, event, 1);
  }
  if (site.phase === 1 && site.killedIds.length >= PHASE_BOSS_KILLS) {
    spawnArenaWave(state, world, entities, site, event, 2);
  }

  maybeClearArena(state, world, entities, site, event);
}

function spawnArenaWave(
  state: GameState,
  world: World,
  entities: Entity[],
  site: AltarArenaSite,
  source: WorldEvent,
  wave: ArenaWave,
): void {
  if (site.phase >= wave) return;
  const room = siteRoom(site);
  const player = findPlayer(entities);
  const nextId = { v: nextEntityId(entities) };
  const monsterSlots = Math.max(0, HELL_ALTAR_ARENA_MONSTER_CAP - site.monsterIds.length);
  const cultistSlots = Math.max(0, HELL_ALTAR_ARENA_CULTIST_CAP - site.cultistIds.length);
  stampWaveTelegraphs(world, room, wave, wave === 2 ? 230 : 200);
  const monsterIds = spawnArenaMonsters(world, room, entities, nextId, wave, player ?? undefined, monsterSlots);
  const cultistIds = spawnArenaCultists(world, room, entities, nextId, wave, player ?? undefined, cultistSlots);
  site.monsterIds.push(...monsterIds);
  site.cultistIds.push(...cultistIds);
  site.hostileIds.push(...monsterIds, ...cultistIds);
  site.phase = wave;

  const spawned = monsterIds.length + cultistIds.length;
  if (wave === 1) {
    publishArenaEvent(
      state,
      site,
      source,
      'phase_flank',
      spawned > 0
        ? 'Боковые проходы раскрылись: тени идут с флангов, задние культисты подняли крюки.'
        : 'Боковые проходы вспыхнули, но вторая волна не нашла живой цели.',
      spawned > 0 ? 4 : 3,
      { spawnedNow: spawned, killed: site.killedIds.length },
    );
  } else {
    publishArenaEvent(
      state,
      site,
      source,
      'phase_boss',
      spawned > 0
        ? 'Центральный круг провалился. Кошмарище идет одно: держи ребро между собой и центром.'
        : 'Центральный круг провалился пустым. Плита выдохлась раньше кошмара.',
      spawned > 0 ? 5 : 3,
      { spawnedNow: spawned, killed: site.killedIds.length },
    );
  }
}

function maybeClearArena(
  state: GameState,
  world: World,
  entities: Entity[],
  site: AltarArenaSite,
  source: WorldEvent,
): void {
  if (site.cleared || site.phase < 2) return;

  const entitiesById = new Map<number, Entity>();
  for (const entity of entities) {
    entitiesById.set(entity.id, entity);
  }

  for (const id of site.hostileIds) {
    const hostile = entitiesById.get(id);
    if (hostile?.alive) return;
  }
  site.cleared = true;
  if (!site.rewardSpawned) {
    dropArenaReward(world, siteRoom(site), entities, { v: nextEntityId(entities) });
    site.rewardSpawned = true;
  }
  publishArenaEvent(
    state,
    site,
    source,
    'cleared',
    'Пепельная плита погасла. В центре остались крюк, руна и заряд; желтый выход свободен.',
    4,
    { rewardSpawned: site.rewardSpawned, clearedHostiles: site.hostileIds.length },
  );
}

function publishArenaEvent(
  state: GameState,
  site: AltarArenaSite,
  source: WorldEvent,
  phase: string,
  warning: string,
  severity: 3 | 4 | 5,
  data: Record<string, unknown>,
): void {
  playArenaTone(site, severity);
  publishEvent(state, {
    type: 'samosbor_warning',
    floor: site.floor,
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.x,
    y: site.y,
    actorId: source.actorId,
    actorName: source.actorName,
    actorFaction: source.actorFaction,
    targetName: 'Пепельная плита готовности',
    itemId: source.itemId,
    itemName: source.itemName,
    itemCount: source.itemCount,
    monsterKind: source.monsterKind,
    severity,
    privacy: 'local',
    tags: [EVENT_TAG, TAG_SITE, 'hell', 'arena', 'combat', phase, 'phase_cue'],
    data: {
      sourceEventId: source.id,
      warning,
      phase,
      monsterCap: HELL_ALTAR_ARENA_MONSTER_CAP,
      cultistCap: HELL_ALTAR_ARENA_CULTIST_CAP,
      totalCap: HELL_ALTAR_ARENA_TOTAL_HOSTILE_CAP,
      aliveHostiles: aliveHostileCount(site),
      escapeX: Math.round(site.escapeX),
      escapeY: Math.round(site.escapeY),
      ...data,
    },
  });
}

function playArenaTone(site: AltarArenaSite, severity: 3 | 4 | 5): void {
  if (typeof globalThis.AudioContext === 'undefined') return;
  playSoundAt(() => playRouteCueTone(site.roomId * 409 + severity * 17, severity >= 5 ? 1.25 : 1), site.x, site.y);
}

function aliveHostileCount(site: AltarArenaSite): number {
  const entities = activeEntities;
  if (!entities) return 0;
  let count = 0;
  const set = new Set(site.hostileIds);
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity.alive && set.has(entity.id)) {
      count++;
    }
  }
  return count;
}

function siteRoom(site: AltarArenaSite): ArenaRoomRef {
  return {
    id: site.roomId,
    x: site.roomX,
    y: site.roomY,
    w: site.roomW,
    h: site.roomH,
  };
}

function nextEntityId(entities: readonly Entity[]): number {
  let id = 1;
  for (const entity of entities) id = Math.max(id, entity.id + 1);
  return id;
}

function findPlayer(entities: readonly Entity[]): Entity | null {
  for (const entity of entities) {
    if (isPlayerEntity(entity) && entity.alive) return entity;
  }
  return null;
}
