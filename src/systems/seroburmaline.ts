/* ── Seroburmaline visual-risk residue ──────────────────────────
 * Runtime state stays here; render reads only the HUD snapshot.
 */

import {
  Cell,
  Feature,
  FloorLevel,
  type Entity,
  type GameState,
  type Room,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { MarkType, stampMark } from './surface_marks';
import { addItem, consumeToolDurability, hasItem, removeItem } from './inventory';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

export const SEROBURMALINE_ROOM_PREFIX = 'НИИ Слизи: серобурмалиновый';
export const SEROBURMALINE_ACTIVE_FEATURE = Feature.APPARATUS;
export const SEROBURMALINE_COVERED_FEATURE = Feature.TABLE;

const LOOK_RANGE = 8;
const LOOK_STEP = 0.18;
const SOURCE_RANGE2 = LOOK_RANGE * LOOK_RANGE;
const LOOK_DOWN_SAFE_PITCH = -0.22;
const EXPOSURE_EVENT_GAP = 6;
const AVOID_EVENT_GAP = 14;

export interface SeroburmalineHudFx {
  intensity: number;
  exposure: number;
  looking: boolean;
  warning: string;
}

interface SeroburmalineSource {
  x: number;
  y: number;
  roomId: number;
  roomName: string;
  covered: boolean;
}

interface SeroburmalineRuntime {
  exposure: number;
  nextExposureEventAt: number;
  nextAvoidEventAt: number;
  hud: SeroburmalineHudFx;
}

const runtimeByState = new WeakMap<GameState, SeroburmalineRuntime>();

function runtimeFor(state: GameState): SeroburmalineRuntime {
  let rt = runtimeByState.get(state);
  if (!rt) {
    rt = {
      exposure: 0,
      nextExposureEventAt: 0,
      nextAvoidEventAt: 0,
      hud: { intensity: 0, exposure: 0, looking: false, warning: '' },
    };
    runtimeByState.set(state, rt);
  }
  return rt;
}

function isSeroburmalineRoom(room: Room | null | undefined): room is Room {
  return !!room && room.name.startsWith(SEROBURMALINE_ROOM_PREFIX);
}

function sourceSlotX(world: World, room: Room): number {
  return world.wrap(room.x + Math.max(2, room.w - 6));
}

function firstSourceSlotY(world: World, room: Room): number {
  return world.wrap(room.y + 2);
}

function secondSourceSlotY(world: World, room: Room): number {
  return world.wrap(room.y + Math.max(2, room.h - 3));
}

function isSourceSlot(world: World, room: Room, x: number, y: number): boolean {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (wx !== sourceSlotX(world, room)) return false;
  const y0 = firstSourceSlotY(world, room);
  const y1 = secondSourceSlotY(world, room);
  return wy === y0 || wy === y1;
}

export function forSeroburmalineSourceCells(
  world: World,
  room: Room,
  fn: (x: number, y: number) => void,
): void {
  const x = sourceSlotX(world, room);
  const y0 = firstSourceSlotY(world, room);
  const y1 = secondSourceSlotY(world, room);
  fn(x, y0);
  if (y1 !== y0) fn(x, y1);
}

function sourceAtCell(world: World, x: number, y: number, includeCovered: boolean): SeroburmalineSource | null {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  const ci = world.idx(wx, wy);
  const roomId = world.roomMap[ci];
  if (roomId < 0) return null;
  const room = world.rooms[roomId];
  if (!isSeroburmalineRoom(room) || !isSourceSlot(world, room, wx, wy)) return null;

  const active = world.features[ci] === SEROBURMALINE_ACTIVE_FEATURE;
  if (!active && !includeCovered) return null;
  return { x: wx, y: wy, roomId, roomName: room.name, covered: !active };
}

export function seroburmalineSourceCellState(world: World, x: number, y: number): 'active' | 'covered' | '' {
  const source = sourceAtCell(world, x, y, true);
  if (!source) return '';
  return source.covered ? 'covered' : 'active';
}

function nearestActiveSource(world: World, player: Entity): SeroburmalineSource | null {
  let best: SeroburmalineSource | null = null;
  let bestD2 = SOURCE_RANGE2;

  function considerRoom(room: Room | null): void {
    if (!isSeroburmalineRoom(room)) return;
    forSeroburmalineSourceCells(world, room, (x, y) => {
      const source = sourceAtCell(world, x, y, false);
      if (!source) return;
      const d2 = world.dist2(player.x, player.y, x + 0.5, y + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = source;
      }
    });
  }

  considerRoom(world.roomAt(player.x, player.y));
  considerRoom(world.roomAt(player.x + Math.cos(player.angle) * 2.5, player.y + Math.sin(player.angle) * 2.5));
  return best;
}

function lookedSource(world: World, player: Entity): SeroburmalineSource | null {
  if (player.pitch < LOOK_DOWN_SAFE_PITCH) return null;
  const dx = Math.cos(player.angle);
  const dy = Math.sin(player.angle);
  let lastCi = -1;
  for (let d = 0.55; d <= LOOK_RANGE; d += LOOK_STEP) {
    const x = Math.floor(player.x + dx * d);
    const y = Math.floor(player.y + dy * d);
    const ci = world.idx(x, y);
    if (ci === lastCi) continue;
    lastCi = ci;
    const source = sourceAtCell(world, x, y, false);
    if (source) return source;
    const cell = world.cells[ci];
    if (cell === Cell.WALL || world.solid(x, y)) break;
  }
  return null;
}

function fadeRuntime(rt: SeroburmalineRuntime, dt: number): void {
  rt.exposure = Math.max(0, rt.exposure - dt * 0.9);
  rt.hud.intensity = Math.max(0, rt.hud.intensity - dt * 0.75);
  rt.hud.exposure = rt.exposure;
  rt.hud.looking = false;
  if (rt.hud.intensity <= 0.01) rt.hud.warning = '';
}

function publishSeroburmalineEvent(
  world: World,
  player: Entity,
  state: GameState,
  source: SeroburmalineSource,
  outcome: 'exposure' | 'avoided' | 'covered',
  severity: 2 | 3 | 4,
  itemId?: string,
): void {
  const ci = world.idx(source.x, source.y);
  const def = itemId ? ITEMS[itemId] : undefined;
  publishEvent(state, {
    type: outcome === 'covered' ? 'player_use_item' : 'rumor_observed',
    zoneId: world.zoneMap[ci],
    roomId: source.roomId,
    x: source.x + 0.5,
    y: source.y + 0.5,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId,
    itemName: def?.name ?? itemId,
    itemValue: def?.value ?? 0,
    severity,
    privacy: 'local',
    tags: ['slime', 'seroburmaline', 'visual_risk', 'no_look', outcome, 'maintenance'],
    data: {
      outcome,
      sourceX: source.x,
      sourceY: source.y,
      roomName: source.roomName,
      psi: player.rpg?.psi,
    },
  });
}

export function updateSeroburmalineExposure(world: World, player: Entity, state: GameState, dt: number): void {
  const rt = runtimeFor(state);
  if (state.currentFloor !== FloorLevel.MAINTENANCE || !player.alive) {
    fadeRuntime(rt, dt);
    return;
  }

  const source = lookedSource(world, player);
  if (source) {
    const distFactor = 1 - Math.min(1, world.dist(player.x, player.y, source.x + 0.5, source.y + 0.5) / LOOK_RANGE);
    rt.exposure = Math.min(1, rt.exposure + dt * (0.45 + distFactor * 1.25));
    rt.hud.intensity = Math.min(0.72, Math.max(rt.hud.intensity, 0.16 + rt.exposure * 0.58));
    rt.hud.exposure = rt.exposure;
    rt.hud.looking = true;
    rt.hud.warning = rt.exposure > 0.55 ? 'ОТВЕДИТЕ ВЗГЛЯД' : 'НЕ СМОТРЕТЬ';

    if (player.rpg && rt.exposure > 0.12) {
      player.rpg.psi = Math.max(0, player.rpg.psi - dt * (0.45 + rt.exposure * 2.35));
    }
    if (state.time >= rt.nextExposureEventAt) {
      state.msgs.push(msg('Серобурмалин цепляет взгляд. Отведите глаза.', state.time, '#d8a'));
      publishSeroburmalineEvent(world, player, state, source, 'exposure', 3);
      rt.nextExposureEventAt = state.time + EXPOSURE_EVENT_GAP;
    }
    return;
  }

  fadeRuntime(rt, dt);
  const near = nearestActiveSource(world, player);
  if (!near) return;

  rt.hud.intensity = Math.max(rt.hud.intensity, 0.08);
  if (state.time >= rt.nextAvoidEventAt) {
    const line = player.pitch < LOOK_DOWN_SAFE_PITCH
      ? 'Серобурмалин молчит: взгляд в пол.'
      : 'Серобурмалин сбоку. Не задерживайте взгляд.';
    state.msgs.push(msg(line, state.time, '#9ac'));
    publishSeroburmalineEvent(world, player, state, near, 'avoided', 2);
    rt.nextAvoidEventAt = state.time + AVOID_EVENT_GAP;
  }
}

function muteSurfaceArea(world: World, cx: number, cy: number, radiusCells: number): void {
  const touchedCells: number[] = [];
  for (let y = Math.floor(cy - radiusCells) - 1; y <= Math.floor(cy + radiusCells) + 1; y++) {
    for (let x = Math.floor(cx - radiusCells) - 1; x <= Math.floor(cx + radiusCells) + 1; x++) {
      const wx = world.wrap(x);
      const wy = world.wrap(y);
      const ci = world.idx(wx, wy);
      const cell = world.surfaceMap.get(ci);
      if (!cell) continue;
      for (let py = 0; py < 16; py++) {
        for (let px = 0; px < 16; px++) {
          const sx = wx + (px + 0.5) / 16;
          const sy = wy + (py + 0.5) / 16;
          if (world.dist(sx, sy, cx + 0.5, cy + 0.5) > radiusCells) continue;
          const idx = (py * 16 + px) << 2;
          const a = cell[idx + 3];
          if (a === 0) continue;
          cell[idx] = Math.floor(cell[idx] * 0.25 + 74 * 0.75);
          cell[idx + 1] = Math.floor(cell[idx + 1] * 0.25 + 78 * 0.75);
          cell[idx + 2] = Math.floor(cell[idx + 2] * 0.25 + 76 * 0.75);
          cell[idx + 3] = Math.floor(a * 0.42);
          if (!touchedCells.includes(ci)) touchedCells.push(ci);
        }
      }
    }
  }
  if (touchedCells.length > 0) world.markSurfaceCellsDirty(touchedCells);
}

function coverSource(world: World, source: SeroburmalineSource, seed: number): void {
  const ci = world.idx(source.x, source.y);
  world.setFeatureAt(ci, SEROBURMALINE_COVERED_FEATURE);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const fi = world.idx(source.x + dx, source.y + dy);
      world.fog[fi] = Math.min(world.fog[fi], 24);
    }
  }
  world.markFogDirty();
  muteSurfaceArea(world, source.x, source.y, 1.15);
  stampMark(world, source.x, source.y, 0.5, 0.5, 0.52, MarkType.SCORCH, seed, 58, 64, 62, 190);
}

function coverMethod(player: Entity, toolId?: string): { id: string; tool: boolean } | null {
  if (toolId === 'cleaning_kit' || toolId === 'vacuum') return { id: toolId, tool: true };
  if (hasItem(player, 'duct_tape')) return { id: 'duct_tape', tool: false };
  if (hasItem(player, 'sealant_tube')) return { id: 'sealant_tube', tool: false };
  if (hasItem(player, 'cloth_roll')) return { id: 'cloth_roll', tool: false };
  return null;
}

export function tryCoverSeroburmalineSource(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
  toolId?: string,
): boolean {
  if (state.currentFloor !== FloorLevel.MAINTENANCE || !isPlayerEntity(player)) return false;
  const source = sourceAtCell(world, Math.floor(lookX), Math.floor(lookY), true);
  if (!source) return false;

  const rt = runtimeFor(state);
  rt.hud.intensity = Math.max(rt.hud.intensity, 0.18);
  if (source.covered) {
    state.msgs.push(msg('Источник уже закрыт серой повязкой.', state.time, '#888'));
    return true;
  }

  const method = coverMethod(player, toolId);
  if (!method) {
    state.msgs.push(msg('Нужна изолента, герметик, ткань или чистящий инструмент.', state.time, '#fa4'));
    return true;
  }

  if (method.tool) consumeToolDurability(player, method.id === 'vacuum' ? 3 : 6, state.msgs, state.time, state);
  else removeItem(player, method.id, 1);
  coverSource(world, source, Math.floor(state.time * 1000) + source.x * 31 + source.y * 17);

  const gainedSample = addItem(player, 'slime_sample_seroburmaline', 1);
  state.msgs.push(msg(
    gainedSample ? 'Источник закрыт. Проба запечатана без прямого взгляда.' : 'Источник закрыт. Проба осыпалась в щели.',
    state.time, '#b8c',
  ));
  publishSeroburmalineEvent(world, player, state, source, 'covered', 4, method.id);
  rt.exposure = 0;
  rt.hud.exposure = 0;
  rt.hud.looking = false;
  rt.hud.warning = 'ЗАКРЫТО';
  return true;
}

export function getSeroburmalineHudFx(state: GameState): SeroburmalineHudFx | null {
  const rt = runtimeByState.get(state);
  return rt && rt.hud.intensity > 0.01 ? rt.hud : null;
}
