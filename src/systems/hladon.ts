/* ── Hladon cold pocket anomaly runtime ────────────────────────
 * Room-local cold pressure only: no floor temperature field.
 */

import { stampSurfaceSplat } from './surface_marks';
import {
  W,
  Cell,
  Feature,
  type Entity,
  type GameState,
  type Room,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { hasItem, removeItem } from './inventory';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

const HLADON_PREFIX = 'Хладон:';
const HLADON_CLEARED = 'разморожен';
export const HLADON_COLD_SHELL_RADIUS = 6;
const WARM_COUNTER_ITEMS = ['boiler_water', 'asbestos_cord', 'cloth_roll', 'valve_tag', 'meat_rune'] as const;
const FIRE_COUNTER_WEAPONS = ['flamethrower', 'fire_hook', 'chainsaw'] as const;
const HLADON_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

interface HladonCache {
  mask: Uint8Array;
  rooms: Room[];
  roomIds: Set<number>;
  coreCells: number;
  fringeCells: number;
  cellVersion: number;
  roomSignature: number;
  lastLevel: 0 | 1 | 2;
  lastRoomId: number;
  countered: boolean;
  nextMsgAt: number;
}

export interface HladonColdStatus {
  level: 0 | 1 | 2;
  countered: boolean;
  roomName: string;
  activeRooms: number;
  coreCells: number;
  fringeCells: number;
}

const hladonCaches = new WeakMap<World, HladonCache>();

function isAnyHladonRoom(room: Room): boolean {
  return room.name.startsWith(HLADON_PREFIX);
}

function isActiveHladonRoom(room: Room): boolean {
  return isAnyHladonRoom(room) && !room.name.includes(HLADON_CLEARED);
}

function hashText(hash: number, text: string): number {
  let out = hash | 0;
  for (let i = 0; i < text.length; i++) out = Math.imul(out ^ text.charCodeAt(i), 16777619);
  return out | 0;
}

function hladonRoomSignature(world: World): number {
  let hash = Math.imul(0x6d2b79f5 ^ world.rooms.length, 16777619);
  for (const room of world.rooms) {
    if (!room || !isAnyHladonRoom(room)) continue;
    hash = Math.imul(hash ^ room.id, 16777619);
    hash = Math.imul(hash ^ room.x, 16777619);
    hash = Math.imul(hash ^ room.y, 16777619);
    hash = Math.imul(hash ^ room.w, 16777619);
    hash = Math.imul(hash ^ room.h, 16777619);
    hash = hashText(hash, room.name);
  }
  return hash | 0;
}

function isWalkableColdCell(cell: Cell): boolean {
  return cell !== Cell.WALL && cell !== Cell.LIFT && cell !== Cell.ABYSS;
}

function markColdMask(cache: HladonCache, ci: number, level: 1 | 2): boolean {
  const prev = cache.mask[ci] as 0 | 1 | 2;
  if (prev >= level) return false;
  if (prev === 1) cache.fringeCells--;
  if (level === 1) cache.fringeCells++;
  else cache.coreCells++;
  cache.mask[ci] = level;
  return true;
}

function buildHladonCache(world: World, roomSignature = hladonRoomSignature(world)): HladonCache {
  const rooms = world.rooms.filter(isActiveHladonRoom);
  const cache: HladonCache = {
    mask: rooms.length > 0 ? new Uint8Array(W * W) : new Uint8Array(0),
    rooms,
    roomIds: new Set(rooms.map(room => room.id)),
    coreCells: 0,
    fringeCells: 0,
    cellVersion: world.cellVersion,
    roomSignature,
    lastLevel: 0,
    lastRoomId: -1,
    countered: false,
    nextMsgAt: 0,
  };
  if (rooms.length === 0) return cache;

  const queue = new Int32Array(W * W);
  let tail = 0;
  for (const room of rooms) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const ci = world.idx(x, y);
        if (!isWalkableColdCell(world.cells[ci] as Cell)) continue;
        if (world.roomMap[ci] !== room.id) continue;
        if (markColdMask(cache, ci, 2)) queue[tail++] = ci;
      }
    }
  }

  let head = 0;
  for (let depth = 1; depth <= HLADON_COLD_SHELL_RADIUS; depth++) {
    const layerEnd = tail;
    while (head < layerEnd) {
      const ci = queue[head++];
      const x = ci % W;
      const y = (ci / W) | 0;
      for (const [dx, dy] of HLADON_DIRS) {
        const ni = world.idx(x + dx, y + dy);
        if (cache.mask[ni] !== 0) continue;
        if (!isWalkableColdCell(world.cells[ni] as Cell)) continue;
        if (markColdMask(cache, ni, 1)) queue[tail++] = ni;
      }
    }
  }
  return cache;
}

function getHladonCache(world: World): HladonCache {
  const roomSignature = hladonRoomSignature(world);
  let cache = hladonCaches.get(world);
  if (!cache || cache.cellVersion !== world.cellVersion || cache.roomSignature !== roomSignature) {
    cache = buildHladonCache(world, roomSignature);
    hladonCaches.set(world, cache);
  }
  return cache;
}

function coldLevelAt(world: World, cache: HladonCache, x: number, y: number): 0 | 1 | 2 {
  if (cache.mask.length === 0) return 0;
  return cache.mask[world.idx(Math.floor(x), Math.floor(y))] as 0 | 1 | 2;
}

function currentColdRoom(world: World, cache: HladonCache, x: number, y: number): Room | undefined {
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const roomId = world.roomMap[ci];
  return cache.roomIds.has(roomId) ? world.rooms[roomId] : undefined;
}

function hasEquippedFireCounter(player: Entity): boolean {
  return FIRE_COUNTER_WEAPONS.some(id => player.weapon === id);
}

function counterItemId(player: Entity): string | undefined {
  if (player.weapon && FIRE_COUNTER_WEAPONS.some(id => player.weapon === id)) return player.weapon;
  for (const id of WARM_COUNTER_ITEMS) if (hasItem(player, id)) return id;
  return undefined;
}

function hasWarmInventoryCounter(player: Entity): boolean {
  return counterItemId(player) !== undefined;
}

function isWarmFeature(feature: Feature): boolean {
  return feature === Feature.STOVE ||
    feature === Feature.CANDLE ||
    feature === Feature.LAMP ||
    feature === Feature.MACHINE ||
    feature === Feature.APPARATUS;
}

function nearWarmFeature(world: World, player: Entity): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 6) continue;
      const x = world.wrap(Math.floor(player.x) + dx);
      const y = world.wrap(Math.floor(player.y) + dy);
      if (isWarmFeature(world.features[world.idx(x, y)] as Feature)) return true;
    }
  }
  return false;
}

function isColdCountered(world: World, player: Entity, level: 0 | 1 | 2): boolean {
  return level > 0 && (hasWarmInventoryCounter(player) || nearWarmFeature(world, player));
}

function publishHladonEvent(
  world: World,
  player: Entity,
  state: GameState,
  kind: 'entered' | 'countered' | 'escaped' | 'cleared',
  room: Room | undefined,
  level: 0 | 1 | 2,
  method?: string,
): void {
  if (!isPlayerEntity(player)) return;
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const ci = world.idx(px, py);
  const itemId = kind === 'cleared' ? method : counterItemId(player);
  const item = itemId ? ITEMS[itemId] : undefined;
  publishEvent(state, {
    type: kind === 'cleared' ? 'player_use_item' : 'rumor_observed',
    zoneId: world.zoneMap[ci],
    roomId: room?.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId,
    itemName: item?.name ?? itemId,
    severity: kind === 'cleared' ? 4 : kind === 'entered' ? 3 : 2,
    privacy: 'local',
    tags: ['player', 'anomaly', 'cold', 'hladon', `cold_${kind}`],
    data: {
      system: 'hladon_cold_pocket',
      kind,
      level,
      roomName: room?.name,
      method,
    },
  });
}

export function getHladonColdStatus(world: World, player: Entity): HladonColdStatus {
  const cache = getHladonCache(world);
  const level = coldLevelAt(world, cache, player.x, player.y);
  const room = currentColdRoom(world, cache, player.x, player.y);
  return {
    level,
    countered: isColdCountered(world, player, level),
    roomName: room?.name ?? '',
    activeRooms: cache.rooms.length,
    coreCells: cache.coreCells,
    fringeCells: cache.fringeCells,
  };
}

export function hladonColdMoveMultiplier(world: World, player: Entity): number {
  const status = getHladonColdStatus(world, player);
  if (status.level === 0) return 1;
  if (status.countered) return status.level === 2 ? 0.86 : 1;
  return status.level === 2 ? 0.58 : 0.82;
}

export function updateHladonColdPocket(world: World, player: Entity, state: GameState, dt: number): void {
  if (!player.alive) return;
  const cache = getHladonCache(world);
  if (cache.rooms.length === 0) return;

  const level = coldLevelAt(world, cache, player.x, player.y);
  if (level === 0) {
    if (cache.lastLevel > 0) {
      publishHladonEvent(world, player, state, 'escaped', undefined, 0);
      state.msgs.push(msg('Хладон отпустил ботинки. Дальше можно идти своим шагом.', state.time, '#9cf'));
    }
    cache.lastLevel = 0;
    cache.lastRoomId = -1;
    cache.countered = false;
    return;
  }

  const room = currentColdRoom(world, cache, player.x, player.y);
  const countered = isColdCountered(world, player, level);
  if (cache.lastLevel === 0 || (room && room.id !== cache.lastRoomId)) {
    publishHladonEvent(world, player, state, 'entered', room, level);
    state.msgs.push(msg('Воздух стал стеклянным. Хладон режет шаг и сон.', state.time, '#9cf'));
  }
  if (countered && !cache.countered) {
    publishHladonEvent(world, player, state, 'countered', room, level);
    state.msgs.push(msg('Тепло держит хладон на расстоянии.', state.time, '#fc8'));
  }

  if (player.needs) {
    const pressure = (level === 2 ? 1 : 0.42) * (countered ? 0.28 : 1);
    player.needs.food = Math.max(0, player.needs.food - 0.055 * pressure * dt);
    player.needs.water = Math.max(0, player.needs.water - 0.03 * pressure * dt);
    player.needs.sleep = Math.max(0, player.needs.sleep - 0.075 * pressure * dt);
  }

  if (!countered && state.time >= cache.nextMsgAt) {
    state.msgs.push(msg(level === 2 ? 'Пальцы плохо слушаются. Нужен жар, пар или обход.' : 'От кармана тянет холодом.', state.time, '#8cf'));
    cache.nextMsgAt = state.time + 7;
  }

  cache.lastLevel = level;
  cache.lastRoomId = room?.id ?? -1;
  cache.countered = countered;
}

function clearMethod(player: Entity): { itemId: string; consume: readonly string[]; label: string } | null {
  if (player.weapon === 'flamethrower' && hasItem(player, 'ammo_fuel')) {
    return { itemId: 'flamethrower', consume: ['ammo_fuel'], label: 'огонь' };
  }
  if (hasItem(player, 'valve_tag')) return { itemId: 'valve_tag', consume: [], label: 'сброс по бирке вентиля' };
  if (hasItem(player, 'asbestos_cord') && hasItem(player, 'sealant_tube')) {
    return { itemId: 'sealant_tube', consume: ['asbestos_cord', 'sealant_tube'], label: 'паровой шов' };
  }
  if (hasItem(player, 'boiler_water')) return { itemId: 'boiler_water', consume: ['boiler_water'], label: 'кипяток' };
  if (hasEquippedFireCounter(player)) return { itemId: player.weapon ?? 'fire_hook', consume: [], label: 'ручной жар' };
  return null;
}

function clearHladonRoom(world: World, room: Room, seed: number): void {
  room.name = `${HLADON_PREFIX} ${HLADON_CLEARED} карман ${room.id}`;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      world.fog[ci] = Math.min(world.fog[ci], 10);
      if ((dx + dy) % 7 === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.3, 0.35, seed + dx * 41 + dy * 97, 135, 135, 125, false);
    }
  }
  world.markFogDirty();
  hladonCaches.delete(world);
}

export function tryUseHladonColdPocketCounter(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  const feature = world.features[ci] as Feature;
  if (feature !== Feature.APPARATUS && feature !== Feature.MACHINE && feature !== Feature.STOVE) return false;

  const roomId = world.roomMap[ci];
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  if (!room || !isAnyHladonRoom(room)) return false;
  if (!isActiveHladonRoom(room)) {
    state.msgs.push(msg('Карман уже разморожен. Граница держится только пятнами.', state.time, '#8cf'));
    return true;
  }

  const method = clearMethod(player);
  if (!method) {
    state.msgs.push(msg('Нужен жар: бирка вентиля, кипяток, герметик с асбестом или огнемет.', state.time, '#f84'));
    return true;
  }

  for (const itemId of method.consume) removeItem(player, itemId, 1);
  clearHladonRoom(world, room, state.tick + room.id * 131);
  state.msgs.push(msg(`Хладон сдулся через ${method.label}. Карман стал проходимым.`, state.time, '#8ff'));
  publishHladonEvent(world, player, state, 'cleared', room, 0, method.itemId);
  return true;
}

export function hladonInteractionTargetId(world: World, lookX: number, lookY: number): number | null {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  const feature = world.features[ci] as Feature;
  if (feature !== Feature.APPARATUS && feature !== Feature.MACHINE && feature !== Feature.STOVE) return null;
  const roomId = world.roomMap[ci];
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  return room && isAnyHladonRoom(room) ? ci + 540000 : null;
}

export function summarizeHladonColdPockets(world: World, player?: Entity, limit = 6): string[] {
  const cache = getHladonCache(world);
  const total = world.rooms.filter(isAnyHladonRoom).length;
  const cleared = world.rooms.filter(room => isAnyHladonRoom(room) && !isActiveHladonRoom(room)).length;
  if (total === 0) return ['[HLADON] pockets=0'];

  const lines = [
    `[HLADON] pockets=${cache.rooms.length}/${total} cleared=${cleared} core=${cache.coreCells} fringe=${cache.fringeCells}`,
  ];
  if (player) {
    const status = getHladonColdStatus(world, player);
    lines.push(`[HLADON] player level=${status.level} countered=${status.countered ? 1 : 0} room=${status.roomName || 'none'}`);
  }
  for (const room of cache.rooms.slice(0, limit)) {
    lines.push(`[HLADON] #${room.id} ${room.type} ${room.name}`);
  }
  return lines;
}
