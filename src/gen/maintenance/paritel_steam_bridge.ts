/* -- AG110 Paritel steam bridge: valve-count visibility combat -- */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal, Cell, EntityType, Feature, FloorLevel, MonsterKind, RoomType, Tex, W,
  msg,
  type Entity, type GameState, type Room, type WorldEventSeverity,
} from '../../core/types';
import { type World } from '../../core/world';
import { MONSTERS } from '../../entities/monster';
import { registerContentInteractionHook, registerContentRuntimeHook } from '../../systems/content_hooks';
import { publishEvent } from '../../systems/events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature, setWater,
  stampMaintRoom,
} from './content_helpers';

const ROOM_PREFIX = 'Парителев мост';
const THREAT_NAME = 'Паритель у счетного пара';
const TOKEN_CROSSED = 'переход зачтен';
const TOKEN_AVOIDED = 'пар обойден';
const TOKEN_NEUTRAL = 'паритель нейтрален';
const MAX_PRESSURE = 3;
const BRIDGE_W = 37;
const BRIDGE_H = 17;

const VALVE_SLOTS = [6, 18, 30] as const;
const JET_SLOTS = [
  { x: 10, y0: 6, y1: 9 },
  { x: 19, y0: 6, y1: 9 },
  { x: 28, y0: 6, y1: 9 },
] as const;

let valveCooldownState: GameState | null = null;
let nextValveUseAt = 0;
let steamTickState: GameState | null = null;
let nextSteamTickAt = 0;
let lastSteamInjuryAt = -Infinity;
let lastSteamAvoidAt = -Infinity;

function localDelta(from: number, to: number): number {
  return (to - from + W) % W;
}

function localCell(world: World, room: Room, x: number, y: number): { lx: number; ly: number } {
  return {
    lx: localDelta(room.x, world.wrap(x)),
    ly: localDelta(room.y, world.wrap(y)),
  };
}

function isParitelRoom(room: Room | null | undefined): room is Room {
  return !!room && room.name.startsWith(ROOM_PREFIX);
}

function hasToken(room: Room, token: string): boolean {
  return room.name.includes(token);
}

function pressureFromRoom(room: Room): number {
  const match = /давление (\d)\/3/.exec(room.name);
  if (!match) return MAX_PRESSURE;
  return Math.max(0, Math.min(MAX_PRESSURE, Number(match[1]) || 0));
}

function renameParitelRoom(room: Room, pressure: number): void {
  const crossed = hasToken(room, TOKEN_CROSSED);
  const avoided = hasToken(room, TOKEN_AVOIDED);
  const neutral = hasToken(room, TOKEN_NEUTRAL);
  room.name = `${ROOM_PREFIX}: давление ${pressure}/3 ${neutral ? TOKEN_NEUTRAL : 'паритель жив'}`
    + `${crossed ? ` ${TOKEN_CROSSED}` : ''}`
    + `${avoided ? ` ${TOKEN_AVOIDED}` : ''}`;
}

function addRoomToken(room: Room, token: string): void {
  if (!hasToken(room, token)) room.name += ` ${token}`;
}

function setPipeBlock(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.PIPE;
  world.features[ci] = Feature.NONE;
  world.roomMap[ci] = -1;
}

function setFloor(world: World, x: number, y: number, tex = Tex.F_CONCRETE): void {
  openTile(world, x, y, tex);
  world.floorTex[world.idx(x, y)] = tex;
}

function restoreRoomMap(world: World, room: Room): void {
  for (let ly = 1; ly < room.h - 1; ly++) {
    for (let lx = 1; lx < room.w - 1; lx++) {
      const ci = world.idx(room.x + lx, room.y + ly);
      if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) world.roomMap[ci] = room.id;
    }
  }
}

function isValveLocal(lx: number, ly: number): boolean {
  if (ly < 2 || ly > 4) return false;
  for (const vx of VALVE_SLOTS) {
    if (Math.abs(lx - vx) <= 1) return true;
  }
  return false;
}

function isWetRouteLocal(lx: number, ly: number): boolean {
  return lx >= 2 && lx <= BRIDGE_W - 3 && ly >= 12 && ly <= 14;
}

function isBridgeExitLocal(lx: number, ly: number): boolean {
  return lx >= BRIDGE_W - 4 && ly >= 6 && ly <= 14;
}

function isActiveSteamLocal(lx: number, ly: number, pressure: number): boolean {
  if (pressure <= 0) return false;
  const count = Math.min(pressure, JET_SLOTS.length);
  for (let i = 0; i < count; i++) {
    const jet = JET_SLOTS[i];
    if (Math.abs(lx - jet.x) <= 1 && ly >= jet.y0 && ly <= jet.y1) return true;
  }
  return false;
}

function nearActiveSteamLocal(lx: number, ly: number, pressure: number): boolean {
  if (pressure <= 0) return false;
  const count = Math.min(pressure, JET_SLOTS.length);
  for (let i = 0; i < count; i++) {
    const jet = JET_SLOTS[i];
    if (Math.abs(lx - jet.x) <= 2 && ly >= jet.y0 - 1 && ly <= jet.y1 + 1) return true;
  }
  return false;
}

function activeSteamCell(world: World, room: Room, x: number, y: number, pressure: number): boolean {
  const { lx, ly } = localCell(world, room, x, y);
  if (lx >= room.w || ly >= room.h) return false;
  return isActiveSteamLocal(lx, ly, pressure);
}

function applySteamLayout(world: World, room: Room, pressure: number): void {
  let dirty = false;
  for (let ly = 1; ly < room.h - 1; ly++) {
    for (let lx = 1; lx < room.w - 1; lx++) {
      const x = room.x + lx;
      const y = room.y + ly;
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) continue;

      const fog = isActiveSteamLocal(lx, ly, pressure)
        ? 98 + pressure * 12
        : nearActiveSteamLocal(lx, ly, pressure)
        ? 34 + pressure * 8
        : isWetRouteLocal(lx, ly)
        ? 16
        : 0;
      if (world.fog[ci] !== fog) {
        world.fog[ci] = fog;
        dirty = true;
      }
    }
  }

  for (let i = 0; i < JET_SLOTS.length; i++) {
    const jet = JET_SLOTS[i];
    const hot = i < pressure;
    const cx = room.x + jet.x;
    const cy = room.y + jet.y1;
    stampSurfaceSplat(world, cx, cy, 0.5, 0.45, hot ? 0.34 : 0.22, hot ? 96 : 44, 9110 + room.id * 17 + i, hot ? 150 : 80, hot ? 130 : 105, hot ? 95 : 110);
  }

  if (dirty) world.markFogDirty();
}

function valveRoomAtLook(world: World, lookX: number, lookY: number): Room | null {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (world.features[ci] !== Feature.APPARATUS && world.features[ci] !== Feature.MACHINE) return null;
  const roomId = world.roomMap[ci];
  if (roomId < 0) return null;
  const room = world.rooms[roomId];
  if (!isParitelRoom(room)) return null;
  const { lx, ly } = localCell(world, room, x, y);
  return isValveLocal(lx, ly) ? room : null;
}

function publishParitelEvent(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  type: 'paritel_valve_changed' | 'paritel_bridge_crossed' | 'paritel_threat_neutralized' | 'paritel_steam_injury' | 'paritel_steam_avoided',
  severity: WorldEventSeverity,
  tags: string[],
  data: Record<string, unknown>,
): void {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const ci = world.idx(px, py);
  publishEvent(state, {
    type,
    zoneId: world.zoneMap[ci],
    roomId: room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy: 'local',
    tags: ['player', 'maintenance', 'paritel', 'steam', ...tags],
    data: {
      system: 'paritel_steam_bridge',
      pressure: pressureFromRoom(room),
      roomName: room.name,
      ...data,
    },
  });
}

function pressureText(pressure: number): string {
  switch (pressure) {
    case 3: return 'три шипящих удара';
    case 2: return 'два шипящих удара';
    case 1: return 'один шипящий удар';
    default: return 'тишина после третьего вентиля';
  }
}

function damagePlayer(player: Entity, amount: number): boolean {
  if (player.hp === undefined) return false;
  const before = player.hp;
  player.hp = Math.max(1, player.hp - amount);
  return player.hp < before;
}

function paritelThreatAliveInRoom(world: World, room: Room, entities: Entity[]): boolean {
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.MONSTER) continue;
    if (e.name !== THREAT_NAME && e.monsterKind !== MonsterKind.LAMPOVY) continue;
    const ci = world.idx(Math.floor(e.x), Math.floor(e.y));
    if (world.roomMap[ci] === room.id) return true;
  }
  return false;
}

function markThreatNeutralized(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  method: string,
): void {
  if (hasToken(room, TOKEN_NEUTRAL)) return;
  addRoomToken(room, TOKEN_NEUTRAL);
  state.msgs.push(msg('Паритель сорвался в конденсат. На мосту остались только трубы и мокрый пол.', state.time, '#8cf'));
  publishParitelEvent(world, player, state, room, 'paritel_threat_neutralized', 4, ['threat', method], { method });
}

function updateParitelThreatSteam(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  room: Room,
  pressure: number,
): void {
  let damaged = false;
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.MONSTER) continue;
    if (e.name !== THREAT_NAME && e.monsterKind !== MonsterKind.LAMPOVY) continue;
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (world.roomMap[world.idx(ex, ey)] !== room.id) continue;
    if (!activeSteamCell(world, room, ex, ey, pressure)) continue;
    if (e.hp === undefined) continue;
    e.hp -= 18 + pressure * 5;
    damaged = true;
    if (e.hp <= 0) {
      e.hp = 0;
      e.alive = false;
      markThreatNeutralized(world, player, state, room, 'steam_lure');
      break;
    }
  }
  if (damaged && state.time - lastSteamAvoidAt > 3) {
    lastSteamAvoidAt = state.time;
    state.msgs.push(msg('Пар считает цель вслух: шипение бьет Парителя, пока он на мосту.', state.time, '#fc6'));
  }
}

function spawnBridgeMonster(ctx: MaintContentCtx, kind: MonsterKind, x: number, y: number, name?: string): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.solid(x, y) && ctx.world.cells[ci] !== Cell.WATER) return;
  const def = MONSTERS[kind];
  if (!def) return;
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * (name ? 1.65 : 1));
  const monster: Entity = {
    id: ctx.nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel) * (name ? 0.88 : 1),
    sprite: def.sprite,
    hp, maxHp: hp,
    name,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
    spriteScale: name ? 1.12 : undefined,
  };
  ctx.entities.push(monster);
}

export function isParitelSteamValveTarget(world: World, lookX: number, lookY: number): boolean {
  const room = valveRoomAtLook(world, lookX, lookY);
  return !!room && pressureFromRoom(room) > 0;
}

export function tryUseParitelSteamBridge(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const room = valveRoomAtLook(world, lookX, lookY);
  if (!room) return false;
  if (state.currentFloor !== FloorLevel.MAINTENANCE) return false;
  if (valveCooldownState !== state || nextValveUseAt > state.time + 10) {
    valveCooldownState = state;
    nextValveUseAt = 0;
  }
  if (state.time < nextValveUseAt) {
    state.msgs.push(msg('Вентиль еще стучит. Считайте шипение, потом крутите следующий.', state.time, '#888'));
    return true;
  }

  const pressure = pressureFromRoom(room);
  if (pressure <= 0) {
    state.msgs.push(msg('Три вентиля уже закрыты. Паровой мост слышен только водой.', state.time, '#8cf'));
    publishParitelEvent(world, player, state, room, 'paritel_valve_changed', 2, ['valve', 'blocked'], { reason: 'already_closed' });
    nextValveUseAt = state.time + 1;
    return true;
  }

  const nextPressure = pressure - 1;
  renameParitelRoom(room, nextPressure);
  applySteamLayout(world, room, nextPressure);
  state.msgs.push(msg(`Вентиль провернулся. Теперь слышно: ${pressureText(nextPressure)}.`, state.time, nextPressure > 0 ? '#fc6' : '#6cf'));
  publishParitelEvent(world, player, state, room, 'paritel_valve_changed', nextPressure > 0 ? 3 : 4, ['valve', 'pressure'], {
    previousPressure: pressure,
    nextPressure,
  });
  nextValveUseAt = state.time + 1.1;
  return true;
}

export function updateParitelSteamBridge(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  dt: number,
): void {
  if (dt <= 0 || state.currentFloor !== FloorLevel.MAINTENANCE) return;
  if (steamTickState !== state || nextSteamTickAt > state.time + 10) {
    steamTickState = state;
    nextSteamTickAt = 0;
    lastSteamInjuryAt = -Infinity;
    lastSteamAvoidAt = -Infinity;
  }
  if (state.time < nextSteamTickAt) return;
  nextSteamTickAt = state.time + 0.45;

  const room = world.roomAt(player.x, player.y);
  if (!isParitelRoom(room)) return;

  const pressure = pressureFromRoom(room);
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const { lx, ly } = localCell(world, room, px, py);

  updateParitelThreatSteam(world, entities, player, state, room, pressure);

  if (pressure > 0 && isActiveSteamLocal(lx, ly, pressure)) {
    if (damagePlayer(player, 4 + pressure)) {
      publishParitelEvent(world, player, state, room, 'paritel_steam_injury', 3, ['hazard', 'injury'], {
        damage: 4 + pressure,
        localX: lx,
        localY: ly,
      });
      if (state.time - lastSteamInjuryAt > 2.5) {
        lastSteamInjuryAt = state.time;
        state.msgs.push(msg('Пар режет обзор и кожу. Закройте вентиль или уходите в мокрый лоток.', state.time, '#f84'));
      }
    }
  }

  if (!hasToken(room, TOKEN_AVOIDED) && pressure > 0 && isWetRouteLocal(lx, ly) && state.time - lastSteamAvoidAt > 2) {
    lastSteamAvoidAt = state.time;
    addRoomToken(room, TOKEN_AVOIDED);
    publishParitelEvent(world, player, state, room, 'paritel_steam_avoided', 3, ['avoidance', 'wet_route'], {
      method: 'wet_route',
      localX: lx,
      localY: ly,
    });
  }

  if (!hasToken(room, TOKEN_CROSSED) && isBridgeExitLocal(lx, ly)) {
    addRoomToken(room, TOKEN_CROSSED);
    publishParitelEvent(world, player, state, room, 'paritel_bridge_crossed', 4, ['bridge', pressure > 0 ? 'under_pressure' : 'valves_closed'], {
      method: pressure > 0 ? 'fight_or_wet_route' : 'valves_closed',
      localX: lx,
      localY: ly,
    });
    if (!hasToken(room, TOKEN_AVOIDED) && pressure <= 0) {
      addRoomToken(room, TOKEN_AVOIDED);
      publishParitelEvent(world, player, state, room, 'paritel_steam_avoided', 3, ['avoidance', 'valves_closed'], {
        method: 'valves_closed',
      });
    }
  }

  if (!hasToken(room, TOKEN_NEUTRAL) && !paritelThreatAliveInRoom(world, room, entities)) {
    markThreatNeutralized(world, player, state, room, 'combat_or_lure');
  }
}

export function generateParitelSteamBridge(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, BRIDGE_W + 2, BRIDGE_H + 2, 130, 250);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y, BRIDGE_W, BRIDGE_H,
    `${ROOM_PREFIX}: давление 3/3 паритель жив`,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    if (![room.x + 2, room.x + 17, room.x + room.w - 3].includes(x)) setPipeBlock(ctx.world, x, room.y + 5);
    if (![room.x + 3, room.x + 18, room.x + room.w - 4].includes(x)) setPipeBlock(ctx.world, x, room.y + 11);
  }
  for (let y = room.y + 6; y <= room.y + 10; y++) {
    if (y !== room.y + 8) {
      setPipeBlock(ctx.world, room.x + 14, y);
      setPipeBlock(ctx.world, room.x + 24, y);
    }
  }

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    setFloor(ctx.world, x, room.y + 3);
    setFloor(ctx.world, x, room.y + 8);
    setWater(ctx.world, x, room.y + 13);
    if (x % 3 !== 0) setWater(ctx.world, x, room.y + 14);
  }
  for (const x of [room.x + 2, room.x + 17, room.x + room.w - 3]) {
    for (let y = room.y + 3; y <= room.y + 14; y++) {
      if (y === room.y + 13 || y === room.y + 14) setWater(ctx.world, x, y);
      else setFloor(ctx.world, x, y);
    }
  }

  for (const vx of VALVE_SLOTS) {
    setFeature(ctx.world, room.x + vx, room.y + 3, Feature.APPARATUS);
    setFeature(ctx.world, room.x + vx - 1, room.y + 3, Feature.MACHINE);
    setFeature(ctx.world, room.x + vx + 1, room.y + 2, Feature.LAMP);
  }
  for (const jet of JET_SLOTS) {
    setFeature(ctx.world, room.x + jet.x, room.y + jet.y0 - 1, Feature.LAMP);
    setFeature(ctx.world, room.x + jet.x, room.y + jet.y1 + 1, Feature.APPARATUS);
  }
  setFeature(ctx.world, room.x + 2, room.y + 8, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 8, Feature.SHELF);

  restoreRoomMap(ctx.world, room);
  applySteamLayout(ctx.world, room, MAX_PRESSURE);

  dropItems(ctx, room, ['asbestos_cord', 'sealant_tube', 'filtered_water', 'bandage', 'ammo_energy']);
  spawnBridgeMonster(ctx, MonsterKind.LAMPOVY, room.x + 18, room.y + 8, THREAT_NAME);
  spawnBridgeMonster(ctx, MonsterKind.TUBE_EEL, room.x + 26, room.y + 13);
}

registerContentInteractionHook({
  id: 'maint_paritel_steam_bridge',
  target(ctx) {
    if (!isParitelSteamValveTarget(ctx.world, ctx.lookX, ctx.lookY)) return null;
    const idx = ctx.world.idx(Math.floor(ctx.lookX), Math.floor(ctx.lookY));
    return {
      id: idx + 450000,
      targetId: 'paritel_steam_valve',
      x: idx % W,
      y: (idx / W) | 0,
      priority: 70,
      prompt: ' вентиль',
    };
  },
  use(ctx) {
    return tryUseParitelSteamBridge(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)
      ? { handled: true }
      : undefined;
  },
});

registerContentRuntimeHook({
  id: 'maint_paritel_steam_bridge',
  phases: ['post_ai'],
  update(ctx) {
    updateParitelSteamBridge(ctx.world, ctx.entities, ctx.player, ctx.state, ctx.dt);
  },
});
