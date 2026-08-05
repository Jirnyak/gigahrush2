/* ── Bounded route cues: generated markers -> rare audio/HUD hints ─ */

import {
  LiftDirection,
  msg,
  QuestType,
  type Entity,
  type FloorLevel,
  type GameState,
  type Quest,
  type WorldEventSeverity,
} from '../core/types';
import { type World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { ROUTE_OBJECTIVE_FALLBACKS } from '../data/route_objective_fallbacks';
import {
  isQuestTargetOnCurrentFloor,
  questRouteFloor,
  questRouteTargetLabel,
  questTargetLiftDirection,
  resolveQuestTargetRoom,
} from './contracts';
import { playRouteCueTone, playSoundAt } from './audio';
import { publishEvent } from './events';
import {
  currentFloorRunEntry,
  floorRunEntryMapLabel,
  formatFloorZ,
} from './procedural_floors';
import { isPlayerEntity } from './player_actor';

const FLOOR_NAMES: Record<FloorLevel, string> = {
  0: 'Министерство',
  1: 'Квартиры',
  2: 'Жилая зона',
  3: 'Коллекторы',
  4: 'Мясной низ',
  5: 'Пустота',
};

export interface RouteCueGroup {
  id: string;
  lead: string;
  risk: string;
  decision: string;
  reward: string;
  mapLabel?: string;
  mapHint?: string;
  logLine?: string;
}

export interface PaidRouteAdvice {
  priceRubles: number;
  sellerName?: string;
}

export interface RouteCueMarker {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  floor: FloorLevel;
  label: string;
  hint: string;
  targetName: string;
  color: string;
  tags: readonly string[];
  toneSeed: number;
  radius?: number;
  targetRadius?: number;
  cooldownSec?: number;
  roomId?: number;
  targetRoomId?: number;
  zoneId?: number;
  heardText?: string;
  followedText?: string;
  ignoredText?: string;
  paidRouteAdvice?: PaidRouteAdvice;
  routeGroup?: RouteCueGroup;
}

export interface RouteCueHud {
  id: string;
  floor: FloorLevel;
  label: string;
  hint: string;
  targetName: string;
  color: string;
  targetX: number;
  targetY: number;
  startedAt: number;
  expiresAt: number;
  routeGroup?: RouteCueGroup;
}

export interface ObjectiveRouteHud {
  title: string;
  target: string;
  lift: string;
  risk: string;
  returnPath: string;
  color: string;
  questId?: number;
}

interface RouteCueWorldState {
  markers: RouteCueMarker[];
  nextScanAt: number;
  heardAt: Map<string, number>;
  lastPlayedAt: Map<string, number>;
  followed: Set<string>;
  ignored: Set<string>;
}

const cueByWorld = new WeakMap<World, RouteCueWorldState>();
let activeHud: RouteCueHud | null = null;
const emptyMarkers: readonly RouteCueMarker[] = [];

/* Cue lifetime is tied to one concrete World geometry. New story, design,
 * procedural and floor-instance worlds register their own markers during
 * generation. When samosbor rebuilds a floor in-place, the live World must
 * receive the replacement world's markers and drop all transient state because
 * old room ids and heard/followed flags belong to vanished rooms. */
function emptyState(markers: RouteCueMarker[] = []): RouteCueWorldState {
  return {
    markers,
    nextScanAt: 0,
    heardAt: new Map(),
    lastPlayedAt: new Map(),
    followed: new Set(),
    ignored: new Set(),
  };
}

function cueState(world: World): RouteCueWorldState {
  let state = cueByWorld.get(world);
  if (!state) {
    state = emptyState();
    cueByWorld.set(world, state);
  }
  return state;
}

function normalizedMarker(marker: RouteCueMarker): RouteCueMarker {
  return {
    ...marker,
    radius: marker.radius ?? 9,
    targetRadius: marker.targetRadius ?? 2.6,
    cooldownSec: marker.cooldownSec ?? 26,
  };
}

export function registerRouteCue(world: World, marker: RouteCueMarker): void {
  const state = cueState(world);
  const next = normalizedMarker(marker);
  const existing = state.markers.findIndex(m => m.id === next.id);
  if (existing >= 0) state.markers[existing] = next;
  else state.markers.push(next);
}

export function replaceRouteCueStateForRebuild(target: World, source?: World): void {
  const sourceState = source ? cueByWorld.get(source) : undefined;
  if (sourceState && sourceState.markers.length > 0) {
    cueByWorld.set(target, emptyState(sourceState.markers.map(marker => normalizedMarker(marker))));
  } else {
    cueByWorld.delete(target);
  }
  if (source && source !== target) cueByWorld.delete(source);
  activeHud = null;
}

export function pruneRouteCuesInCells(world: World, cells: readonly number[] | Set<number>): number {
  const state = cueByWorld.get(world);
  if (!state) return 0;
  const touched = cells instanceof Set ? cells : new Set(cells);
  if (touched.size === 0) return 0;
  const markerHitsCell = (marker: RouteCueMarker): boolean => {
    if (touched.has(world.idx(Math.floor(marker.x), Math.floor(marker.y)))) return true;
    if (touched.has(world.idx(Math.floor(marker.targetX), Math.floor(marker.targetY)))) return true;
    if (marker.roomId !== undefined && !world.rooms[marker.roomId]) return true;
    if (marker.targetRoomId !== undefined && !world.rooms[marker.targetRoomId]) return true;
    return false;
  };
  const beforeMarkers = state.markers.length;
  state.markers = state.markers.filter(marker => !markerHitsCell(marker));
  const removed = beforeMarkers - state.markers.length;
  if (removed > 0) {
    const validIds = new Set(state.markers.map(marker => marker.id));
    if (activeHud && !validIds.has(activeHud.id)) activeHud = null;
    for (const id of state.heardAt.keys()) if (!validIds.has(id)) state.heardAt.delete(id);
    for (const id of state.lastPlayedAt.keys()) if (!validIds.has(id)) state.lastPlayedAt.delete(id);
    for (const id of state.followed) if (!validIds.has(id)) state.followed.delete(id);
    for (const id of state.ignored) if (!validIds.has(id)) state.ignored.delete(id);
  }
  return removed;
}

export function routeCueCount(world: World): number {
  return cueByWorld.get(world)?.markers.length ?? 0;
}

export function getRouteCueMarkers(world: World): readonly RouteCueMarker[] {
  return cueByWorld.get(world)?.markers ?? emptyMarkers;
}

type ObjectiveKind = 'plot' | 'side' | 'system';

const OBJECTIVE_PRIORITY: Record<ObjectiveKind, number> = { plot: 3, side: 2, system: 1 };
const OBJECTIVE_COLORS: Record<ObjectiveKind, string> = { plot: '#6cf', side: '#f7a7d8', system: '#ffd35f' };

function objectiveKind(q: Quest): ObjectiveKind {
  if (q.plotStepIndex !== undefined) return 'plot';
  if (q.sideQuestId !== undefined) return 'side';
  return 'system';
}

function primaryRouteObjective(state: GameState): Quest | undefined {
  let best: Quest | undefined;
  let bestScore = -Infinity;
  for (let i = 0; i < state.quests.length; i++) {
    const q = state.quests[i];
    if (q.done || q.failed) continue;
    const kind = objectiveKind(q);
    const rewardPressure = Math.min(90, (q.moneyReward ?? 0) / 4 + (q.xpReward ?? 0) / 8);
    const routePressure = q.targetFloor !== undefined || q.visitFloor !== undefined || q.targetRoute !== undefined ? 80 : 0;
    const score = OBJECTIVE_PRIORITY[kind] * 1000 + routePressure + rewardPressure - i * 0.01;
    if (score > bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}

function compactRouteText(text: string | undefined, max = 92): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const end = clean.search(/[.!?]/);
  const first = end > 8 ? clean.slice(0, end) : clean;
  return first.length > max ? `${first.slice(0, Math.max(0, max - 1)).trim()}…` : first;
}

function objectiveTitle(q: Quest): string {
  if (q.type === QuestType.TALK) return `ЦЕЛЬ: разговор — ${q.targetNpcName ?? 'найти собеседника'}`;
  if (q.type === QuestType.KILL) return `ЦЕЛЬ: бой ${q.killCount ?? 0}/${q.killNeeded ?? 1}`;
  if (q.type === QuestType.VISIT) return `ЦЕЛЬ: дойти до места`;
  const itemName = q.targetItem ? ITEMS[q.targetItem]?.name ?? q.targetItem : 'предмет';
  const count = q.targetCount && q.targetCount > 1 ? ` x${q.targetCount}` : '';
  return `ЦЕЛЬ: добыть ${itemName}${count}`;
}

function targetLine(world: World | undefined, player: Entity | undefined, state: GameState, q: Quest): string {
  if (isQuestTargetOnCurrentFloor(q, state)) {
    if (world && player) {
      const resolved = resolveQuestTargetRoom(world, q, player);
      if (resolved?.room) {
        const cx = resolved.room.x + resolved.room.w / 2;
        const cy = resolved.room.y + resolved.room.h / 2;
        const dist = Math.max(0, Math.round(world.dist(player.x, player.y, cx, cy)));
        return `Здесь: ${resolved.room.name} ${dist}м`;
      }
    }
    if (q.targetNpcName) return `Здесь: ${q.targetNpcName}`;
    const detail = compactRouteText(q.targetHint || q.desc, 72);
    return detail ? `Здесь: ${detail}` : 'Здесь: текущий этаж';
  }

  const label = questRouteTargetLabel(q, state);
  const floor = questRouteFloor(q);
  if (label) return `Цель: ${label}`;
  if (floor !== undefined) return `Цель: ${FLOOR_NAMES[floor]}`;
  return 'Цель: другой маршрут';
}

function returnLiftDirection(state: GameState): LiftDirection | undefined {
  const z = currentFloorRunEntry(state).z;
  if (z < 0) return LiftDirection.UP;
  if (z > 0) return LiftDirection.DOWN;
  return undefined;
}

function routeReturnPath(state: GameState): string {
  const z = currentFloorRunEntry(state).z;
  if (z === 0) return 'Возврат: Жилая зона, герма рядом';
  const step = z < 0 ? 1 : -1;
  const dir = z < 0 ? '↑' : '↓';
  return `Возврат: лифт ${dir} к Z${formatFloorZ(z + step)}`;
}

function objectiveLiftLine(state: GameState, q: Quest): string {
  const dir = questTargetLiftDirection(q, state);
  if (dir === undefined) return 'Лифт: не нужен, цель на этом этаже';
  const currentZ = currentFloorRunEntry(state).z;
  return `Лифт ${dir === LiftDirection.DOWN ? '↓' : '↑'} к цели от Z${formatFloorZ(currentZ)}`;
}

function objectiveRiskLine(_state: GameState, q: Quest): string {
  const hint = compactRouteText(q.targetHint, 68);
  return hint || 'Маршрут: по цели';
}

function fallbackObjectiveForCurrentRoute(state: GameState): ObjectiveRouteHud | undefined {
  const current = currentFloorRunEntry(state);
  const def = ROUTE_OBJECTIVE_FALLBACKS.find(hint =>
    (hint.z === undefined || hint.z === current.z) &&
    (hint.storyFloor === undefined || hint.storyFloor === current.storyFloor));
  if (!def) return undefined;
  return {
    title: def.title,
    target: def.target,
    lift: def.lift,
    risk: def.risk,
    returnPath: routeReturnPath(state),
    color: def.color,
  };
}

export function routeObjectiveLiftPromptSuffix(state: GameState, direction: LiftDirection): string {
  const objective = primaryRouteObjective(state);
  if (objective && questTargetLiftDirection(objective, state) === direction) return ' / ЦЕЛЬ';
  const returnDir = returnLiftDirection(state);
  return returnDir === direction ? ' / ВОЗВРАТ' : '';
}

export function getObjectiveRouteHud(
  state: GameState,
  world?: World,
  player?: Entity,
): ObjectiveRouteHud {
  const objective = primaryRouteObjective(state);
  const current = currentFloorRunEntry(state);
  if (!objective) {
    const fallback = fallbackObjectiveForCurrentRoute(state);
    if (fallback) return fallback;
    return {
      title: 'ЦЕЛЬ: возьмите слух или контракт',
      target: floorRunEntryMapLabel(current),
      lift: 'Лифт: выберите по задаче',
      risk: 'Маршрут: без активной цели',
      returnPath: routeReturnPath(state),
      color: '#8cf',
    };
  }

  const kind = objectiveKind(objective);
  return {
    title: objectiveTitle(objective),
    target: targetLine(world, player, state, objective),
    lift: objectiveLiftLine(state, objective),
    risk: objectiveRiskLine(state, objective),
    returnPath: routeReturnPath(state),
    color: OBJECTIVE_COLORS[kind],
    questId: objective.id,
  };
}

function protectedCellAt(world: World, x: number | undefined, y: number | undefined): boolean {
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return world.aptMask[world.idx(Math.floor(x), Math.floor(y))] !== 0;
}

function protectedRoom(world: World, roomId: number | undefined): boolean {
  if (roomId === undefined) return true;
  const room = world.rooms[roomId];
  if (!room) return false;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (world.aptMask[world.idx(x, y)]) return true;
    }
  }
  return false;
}

function protectedRouteCueMarker(world: World, marker: RouteCueMarker): boolean {
  return protectedCellAt(world, marker.x, marker.y)
    && protectedCellAt(world, marker.targetX, marker.targetY)
    && protectedRoom(world, marker.roomId)
    && protectedRoom(world, marker.targetRoomId);
}

export function pruneRouteCuesForVolatileRebuild(world: World, floor: FloorLevel): number {
  const state = cueByWorld.get(world);
  if (!state) return 0;

  const keptMarkers: RouteCueMarker[] = [];
  const removedMarkerIds = new Set<string>();
  for (const marker of state.markers) {
    if (marker.floor !== floor || protectedRouteCueMarker(world, marker)) {
      keptMarkers.push(marker);
    } else {
      removedMarkerIds.add(marker.id);
    }
  }
  const removed = state.markers.length - keptMarkers.length;
  state.markers = keptMarkers;

  for (const id of removedMarkerIds) {
    state.heardAt.delete(id);
    state.lastPlayedAt.delete(id);
    state.followed.delete(id);
    state.ignored.delete(id);
  }
  if (activeHud?.floor === floor && removedMarkerIds.has(activeHud.id)) activeHud = null;
  return removed;
}

function nearestMarker(world: World, player: Entity, requiredTag?: string): RouteCueMarker | undefined {
  const state = cueByWorld.get(world);
  if (!state || state.markers.length === 0) return undefined;
  let best: RouteCueMarker | undefined;
  let bestD2 = Infinity;
  for (const marker of state.markers) {
    if (requiredTag && !marker.tags.includes(requiredTag)) continue;
    const d2 = world.dist2(player.x, player.y, marker.x, marker.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = marker;
    }
  }
  return best;
}

function eventSeverity(action: string): WorldEventSeverity {
  return action === 'followed' ? 4 : 3;
}

function triggerPaidRouteAdvice(
  world: World,
  player: Entity,
  state: GameState,
  marker: RouteCueMarker,
): void {
  const def = marker.paidRouteAdvice;
  if (!def) return;

  const price = Math.max(0, Math.floor(def.priceRubles));
  const cash = Math.max(0, Math.floor(player.money ?? 0));
  if (cash < price) {
    state.msgs.push(msg(`Проводник не раскрывает маршрут: нужно ${price}₽. У вас ${cash}₽.`, state.time, '#f84'));
    setCueHud(state, marker);
    publishEvent(state, {
      type: 'rumor_observed',
      floor: marker.floor,
      zoneId: marker.zoneId,
      roomId: marker.roomId,
      x: marker.x,
      y: marker.y,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      targetName: marker.targetName,
      severity: 2,
      privacy: 'private',
      tags: ['route_cue', 'paid_route_advice', 'no_money'],
      data: { cueId: marker.id, priceRubles: price, playerRubles: cash },
    });
    return;
  }

  player.money = cash - price;
  const cueWorld = cueState(world);
  const last = cueWorld.lastPlayedAt.get(marker.id) ?? -Infinity;
  if (state.time - last >= (marker.cooldownSec ?? 26)) {
    cueWorld.lastPlayedAt.set(marker.id, state.time);
    playSoundAt(() => playRouteCueTone(marker.toneSeed, 1.1), marker.x, marker.y);
  }
  setCueHud(state, marker);
  state.msgs.push(msg(`${def.sellerName ?? marker.targetName} берёт ${price}₽ и даёт маршрут: ${marker.hint}`, state.time, marker.color));
  publishEvent(state, {
    type: 'player_use_item',
    floor: marker.floor,
    zoneId: marker.zoneId,
    roomId: marker.roomId,
    x: marker.x,
    y: marker.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetName: def.sellerName ?? marker.targetName,
    itemName: marker.label,
    itemValue: price,
    severity: 3,
    privacy: 'private',
    tags: ['route_cue', 'paid_route_advice'],
    data: {
      cueId: marker.id,
      paidRubles: price,
      hint: marker.hint,
      targetName: marker.targetName,
    },
  });
}

function publishCueEvent(
  world: World,
  player: Entity,
  state: GameState,
  marker: RouteCueMarker,
  action: 'heard' | 'inspected' | 'followed' | 'ignored' | 'debug',
): void {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const ci = world.idx(px, py);
  publishEvent(state, {
    type: 'rumor_observed',
    floor: marker.floor,
    zoneId: marker.zoneId ?? world.zoneMap[ci],
    roomId: action === 'followed' ? marker.targetRoomId : marker.roomId,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetName: marker.targetName,
    severity: eventSeverity(action),
    privacy: isPlayerEntity(player) ? 'local' : 'private',
    tags: ['route_cue', action, ...marker.tags],
    data: {
      cueId: marker.id,
      action,
      label: marker.label,
      hint: marker.hint,
      targetName: marker.targetName,
      routeGroup: marker.routeGroup,
      logLine: marker.routeGroup?.logLine,
      targetX: Math.round(marker.targetX),
      targetY: Math.round(marker.targetY),
      distanceCells: Math.round(world.dist(player.x, player.y, marker.targetX, marker.targetY)),
    },
  });
}

function cueMessage(marker: RouteCueMarker, action: string): string {
  const group = marker.routeGroup;
  if (action === 'followed') return marker.followedText ?? (group
    ? `${group.reward} Цель маршрута: ${marker.targetName}.`
    : `Метка вывела к цели: ${marker.targetName}. Проверьте отход перед лутом.`);
  if (action === 'ignored') return marker.ignoredText ?? (group
    ? `Маршрут отложен: ${group.lead} Риск остался: ${group.risk}`
    : `Метка осталась за спиной: ${marker.targetName} не проверена.`);
  if (group) return marker.heardText ?? `${group.lead} Риск: ${group.risk} Решение: ${group.decision} Награда: ${group.reward}`;
  return marker.heardText ?? `Меловая стрелка и шум стены дают маршрут: ${marker.hint}`;
}

function setCueHud(state: GameState, marker: RouteCueMarker): void {
  activeHud = {
    id: marker.id,
    floor: marker.floor,
    label: marker.label,
    hint: marker.hint,
    targetName: marker.targetName,
    color: marker.color,
    targetX: marker.targetX,
    targetY: marker.targetY,
    startedAt: state.time,
    expiresAt: state.time + 7,
    routeGroup: marker.routeGroup,
  };
}

function triggerCue(
  world: World,
  player: Entity,
  state: GameState,
  marker: RouteCueMarker,
  action: 'heard' | 'inspected' | 'followed' | 'ignored' | 'debug',
  forceSound: boolean,
): void {
  const cueWorld = cueState(world);
  const now = state.time;
  if (action === 'heard' || action === 'inspected' || action === 'debug') {
    cueWorld.heardAt.set(marker.id, now);
    const last = cueWorld.lastPlayedAt.get(marker.id) ?? -Infinity;
    if (forceSound || now - last >= (marker.cooldownSec ?? 26)) {
      cueWorld.lastPlayedAt.set(marker.id, now);
      playSoundAt(() => playRouteCueTone(marker.toneSeed, action === 'debug' ? 1.15 : 1), marker.x, marker.y);
    }
    setCueHud(state, marker);
  }

  if (action === 'followed') cueWorld.followed.add(marker.id);
  if (action === 'ignored') cueWorld.ignored.add(marker.id);

  state.msgs.push(msg(cueMessage(marker, action), now, action === 'ignored' ? '#888' : marker.color));
  publishCueEvent(world, player, state, marker, action);
}

export function updateRouteCues(world: World, player: Entity, state: GameState): void {
  const cueWorld = cueByWorld.get(world);
  if (!cueWorld || cueWorld.markers.length === 0) return;
  if (state.time < cueWorld.nextScanAt) return;
  cueWorld.nextScanAt = state.time + 0.45;

  for (const marker of cueWorld.markers) {
    const heardAt = cueWorld.heardAt.get(marker.id);
    if (heardAt !== undefined && !cueWorld.followed.has(marker.id)) {
      const targetRadius = marker.targetRadius ?? 2.6;
      if (world.dist2(player.x, player.y, marker.targetX, marker.targetY) <= targetRadius * targetRadius) {
        triggerCue(world, player, state, marker, 'followed', false);
        continue;
      }
      const radius = marker.radius ?? 9;
      if (!cueWorld.ignored.has(marker.id) && state.time - heardAt > 32 &&
          world.dist2(player.x, player.y, marker.x, marker.y) > (radius + 18) * (radius + 18)) {
        triggerCue(world, player, state, marker, 'ignored', false);
        continue;
      }
    }

    const radius = marker.radius ?? 9;
    if (world.dist2(player.x, player.y, marker.x, marker.y) > radius * radius) continue;
    const last = cueWorld.lastPlayedAt.get(marker.id) ?? -Infinity;
    if (state.time - last >= (marker.cooldownSec ?? 26)) {
      triggerCue(world, player, state, marker, 'heard', false);
      break;
    }
  }
}

function markerAtLook(
  world: World,
  player: Entity,
  lookX: number,
  lookY: number,
): RouteCueMarker | undefined {
  const cueWorld = cueByWorld.get(world);
  if (!cueWorld || cueWorld.markers.length === 0) return undefined;
  const lx = Math.floor(lookX) + 0.5;
  const ly = Math.floor(lookY) + 0.5;
  for (const marker of cueWorld.markers) {
    if (world.dist2(lx, ly, marker.x, marker.y) > 2.25) continue;
    if (world.dist2(player.x, player.y, marker.x, marker.y) > 12.25) continue;
    return marker;
  }
  return undefined;
}

export function isRouteCueTarget(world: World, player: Entity, lookX: number, lookY: number): boolean {
  return markerAtLook(world, player, lookX, lookY) !== undefined;
}

export function tryUseRouteCue(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const marker = markerAtLook(world, player, lookX, lookY);
  if (!marker) return false;
  if (marker.paidRouteAdvice) {
    triggerPaidRouteAdvice(world, player, state, marker);
    return true;
  }
  triggerCue(world, player, state, marker, 'inspected', true);
  return true;
}

export function debugTriggerRouteCue(world: World, player: Entity, state: GameState, requiredTag?: string): string[] {
  const marker = nearestMarker(world, player, requiredTag);
  if (!marker) {
    playSoundAt(() => playRouteCueTone(75075, 1.15), player.x, player.y);
    activeHud = {
      id: 'debug_route_cue',
      floor: state.currentFloor,
      label: 'DEBUG route cue',
      hint: 'local audio/HUD smoke',
      targetName: 'debug marker',
      color: '#9f7',
      targetX: player.x + Math.cos(player.angle) * 8,
      targetY: player.y + Math.sin(player.angle) * 8,
      startedAt: state.time,
      expiresAt: state.time + 5,
    };
    publishEvent(state, {
      type: 'rumor_observed',
      x: player.x,
      y: player.y,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      targetName: 'debug route cue',
      severity: 2,
      privacy: 'private',
      tags: ['route_cue', 'debug', 'audio_smoke'],
      data: { cueId: 'debug_route_cue', action: 'debug_no_marker' },
    });
    return [requiredTag
      ? `no registered route cue with tag "${requiredTag}"; played local route-cue smoke`
      : 'no registered route cue; played local route-cue smoke'];
  }

  triggerCue(world, player, state, marker, 'debug', true);
  return [
    `${marker.id}: ${Math.round(world.dist(player.x, player.y, marker.x, marker.y))} cells to cue`,
    `target: ${marker.targetName}, ${Math.round(world.dist(player.x, player.y, marker.targetX, marker.targetY))} cells`,
    marker.routeGroup ? `decision: ${marker.routeGroup.decision}` : '',
    marker.routeGroup ? `reward: ${marker.routeGroup.reward}` : '',
  ].filter(Boolean);
}

export function getActiveRouteCueHud(time: number, floor: FloorLevel): RouteCueHud | null {
  if (!activeHud || activeHud.expiresAt < time || activeHud.floor !== floor) return null;
  return activeHud;
}
