/* ── Fixed-route rail trains for metro floors and anomalies ───── */

import {
  Cell,
  EntityType,
  Faction,
  W,
  msg,
  type Entity,
  type GameState,
  type RailTrain,
  type RailTrainTrack,
  type WorldEventSeverity,
} from '../core/types';
import { World } from '../core/world';
import { RUNTIME_TOPOLOGY_LIMITS } from '../data/runtime_topology';
import { Spr } from '../render/sprite_index';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

const SEGMENT_STRIDE = 2;
const BOARD_DIST2 = 3.2 * 3.2;
const TRAIN_LOOK_DIST2 = 4.8 * 4.8;
const CONTACT_DIST2 = 0.72 * 0.72;
const WARN_DIST2 = 5.0 * 5.0;

export interface RailTrainSpawnOptions {
  id: string;
  label: string;
  speed: number;
  length: number;
  initialOffset?: number;
  direction?: 1 | -1;
  stopSeconds?: number;
}

interface RailTrainRuntimeSnapshot {
  id: string;
  trackId: string;
  offset: number;
  direction: 1 | -1;
  stopUntil: number;
  passengerId: number;
  passengerSeat: number;
  lastStopOffset: number;
  nextWarnAt: number;
  nextCrushAt: number;
  nextDoorMsgAt: number;
}

export interface RailTrainRebuildSnapshot {
  trains: RailTrainRuntimeSnapshot[];
}

function wrapOffset(track: RailTrainTrack, offset: number): number {
  const n = track.cells.length;
  if (n <= 0) return 0;
  return ((offset % n) + n) % n;
}

function offsetIndex(track: RailTrainTrack, offset: number): number {
  return Math.floor(wrapOffset(track, offset)) % track.cells.length;
}

function trackById(world: World, trackId: string): RailTrainTrack | undefined {
  return world.railTracks.find(track => track.id === trackId);
}

function trainStopped(train: RailTrain, state: GameState): boolean {
  return train.stopUntil < 0 || state.time <= train.stopUntil;
}

function entityById(entities: Entity[], id: number): Entity | undefined {
  for (const e of entities) if (e.id === id) return e;
  return undefined;
}

function cellCenter(ci: number): { x: number; y: number } {
  return { x: ci % W, y: (ci / W) | 0 };
}

function trainCellAt(track: RailTrainTrack, train: RailTrain, segment: number): number {
  const offset = train.offset - segment * SEGMENT_STRIDE * train.direction;
  return track.cells[offsetIndex(track, offset)];
}

function crossedStation(track: RailTrainTrack, from: number, to: number, station: number, direction: 1 | -1): boolean {
  const n = track.cells.length;
  if (n <= 0) return false;
  if (direction > 0) {
    const travel = (to - from + n) % n;
    const target = (station - from + n) % n;
    return target > 0.01 && target <= travel + 0.01;
  }
  const travel = (from - to + n) % n;
  const target = (from - station + n) % n;
  return target > 0.01 && target <= travel + 0.01;
}

function nearestPlatformCell(world: World, track: RailTrainTrack, x: number, y: number, maxDist2: number): number {
  let best = -1;
  let bestD2 = maxDist2;
  for (const ci of track.platformCells) {
    const p = cellCenter(ci);
    const d2 = world.dist2(x, y, p.x + 0.5, p.y + 0.5);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = ci;
    }
  }
  return best;
}

function trainDistance2(world: World, track: RailTrainTrack, train: RailTrain, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < train.length; i++) {
    const p = cellCenter(trainCellAt(track, train, i));
    const d2 = world.dist2(x, y, p.x + 0.5, p.y + 0.5);
    if (d2 < best) best = d2;
  }
  return best;
}

function publishRailEvent(
  world: World,
  state: GameState,
  actor: Entity,
  train: RailTrain,
  type: 'rail_train_boarded' | 'rail_train_exited' | 'rail_train_crush',
  severity: WorldEventSeverity,
  tags: string[],
  extra: Record<string, unknown> = {},
): void {
  const ci = world.idx(Math.floor(actor.x), Math.floor(actor.y));
  publishEvent(state, {
    type,
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci],
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? (isPlayerEntity(actor) ? 'Вы' : 'цель'),
    actorFaction: actor.faction,
    severity,
    privacy: 'local',
    tags: ['rail', 'train', 'metro', train.id, train.trackId, ...tags],
    data: {
      trainId: train.id,
      trainLabel: train.label,
      trackId: train.trackId,
      ...extra,
    },
  });
}

function positionTrainEntities(world: World, entities: Entity[], track: RailTrainTrack, train: RailTrain, trainIndex: number): void {
  for (let i = 0; i < train.entityIds.length; i++) {
    const entity = entityById(entities, train.entityIds[i]);
    if (!entity) continue;
    const ci = trainCellAt(track, train, i);
    const p = cellCenter(ci);
    entity.x = p.x + 0.5;
    entity.y = p.y + 0.5;
    entity.angle = 0;
    entity.alive = true;
    world.railTrainCells.set(ci, trainIndex);
    const fillOffset = train.offset - (i * SEGMENT_STRIDE + 1) * train.direction;
    world.railTrainCells.set(track.cells[offsetIndex(track, fillOffset)], trainIndex);
  }
}

function createTrainSegmentEntity(id: number, train: RailTrain, segment: number): Entity {
  return {
    id,
    type: EntityType.BILLBOARD,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.TRAIN_CAR,
    spriteScale: segment === 0 ? 1.85 : 1.55,
    spriteZ: 0,
    name: segment === 0 ? train.label : `${train.label} вагон`,
    faction: Faction.WILD,
  };
}

function bindPassenger(player: Entity, track: RailTrainTrack, train: RailTrain): void {
  const ci = trainCellAt(track, train, Math.max(0, Math.min(train.length - 1, train.passengerSeat)));
  const p = cellCenter(ci);
  player.x = p.x + 0.5;
  player.y = p.y + 0.5;
}

function stopTrain(train: RailTrain, station: number, state: GameState, world: World, track: RailTrainTrack, player: Entity): void {
  train.offset = station;
  train.lastStopOffset = station;
  train.stopUntil = state.time + train.stopSeconds;
  if (state.time >= train.nextDoorMsgAt && trainDistance2(world, track, train, player.x, player.y) < 16 * 16) {
    train.nextDoorMsgAt = state.time + 6;
    state.msgs.push(msg(`${train.label}: двери открыты. Дежурная платформы кивает: ехать, выйти или переждать у стены.`, state.time, '#6cf'));
  }
}

function updateTrainMotion(world: World, track: RailTrainTrack, train: RailTrain, state: GameState, player: Entity, dt: number): void {
  if (train.stopUntil < 0) {
    const station = track.stationOffsets[0] ?? offsetIndex(track, train.offset);
    stopTrain(train, station, state, world, track, player);
    return;
  }
  if (state.time <= train.stopUntil) return;

  const from = wrapOffset(track, train.offset);
  let to = wrapOffset(track, train.offset + train.speed * train.direction * dt);
  for (const station of track.stationOffsets) {
    if (station === train.lastStopOffset && Math.abs(from - station) < 2) continue;
    if (crossedStation(track, from, to, station, train.direction)) {
      to = station;
      stopTrain(train, station, state, world, track, player);
      break;
    }
  }
  train.offset = to;
}

function damageEntity(world: World, victim: Entity, train: RailTrain, state: GameState): void {
  if (!isPlayerEntity(victim) && victim.type !== EntityType.NPC && victim.type !== EntityType.MONSTER) return;
  const amount = isPlayerEntity(victim) ? 38 : 260;
  if (victim.hp !== undefined) {
    victim.hp = Math.max(0, victim.hp - amount);
    if (victim.hp <= 0) victim.alive = false;
  } else {
    victim.alive = false;
  }
  publishRailEvent(world, state, victim, train, 'rail_train_crush', isPlayerEntity(victim) ? 5 : 4, ['crush'], {
    damage: amount,
    killed: !victim.alive,
  });
}

function updateTrainCollisions(world: World, entities: Entity[], player: Entity, state: GameState): void {
  if (world.railTrainCells.size === 0) return;
  for (const entity of entities) {
    if (!entity.alive) continue;
    const ci = world.idx(Math.floor(entity.x), Math.floor(entity.y));
    const trainIndex = world.railTrainCells.get(ci);
    if (trainIndex === undefined) {
      if (entity.id === player.id) {
        for (const train of world.railTrains) {
          const track = trackById(world, train.trackId);
          if (!track || trainStopped(train, state) || train.passengerId === player.id) continue;
          if (state.time >= train.nextWarnAt && trainDistance2(world, track, train, player.x, player.y) < WARN_DIST2) {
            train.nextWarnAt = state.time + 4;
            state.msgs.push(msg('Рельсы дрожат: поезд близко. Уходите на платформу, пока кабина не вошла в поворот.', state.time, '#fa4'));
          }
        }
      }
      continue;
    }

    const train = world.railTrains[trainIndex];
    const track = train ? trackById(world, train.trackId) : undefined;
    if (!train || !track || trainStopped(train, state) || train.passengerId === entity.id) continue;
    if (trainDistance2(world, track, train, entity.x, entity.y) > CONTACT_DIST2) continue;
    if (entity.id === player.id && state.time < train.nextCrushAt) continue;
    if (entity.id === player.id) {
      train.nextCrushAt = state.time + 0.85;
      state.msgs.push(msg(`${train.label} ударил по костям: -38 HP. Машинист не тормозил, двери уже закрывались.`, state.time, '#f66'));
    }
    damageEntity(world, entity, train, state);
  }
}

function boardableTrain(world: World, player: Entity, state: GameState, lookX: number, lookY: number): RailTrain | undefined {
  for (const train of world.railTrains) {
    const track = trackById(world, train.trackId);
    if (!track || !trainStopped(train, state)) continue;
    if (nearestPlatformCell(world, track, player.x, player.y, BOARD_DIST2) < 0) continue;
    if (trainDistance2(world, track, train, lookX, lookY) > TRAIN_LOOK_DIST2) continue;
    return train;
  }
  return undefined;
}

function passableExitCell(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  const c = world.cells[ci];
  return (c === Cell.FLOOR || c === Cell.WATER) && !world.solid(x, y) && !world.railTrainCells.has(ci);
}

function findSafeExitNear(world: World, x: number, y: number, radius: number): number {
  const sx = world.wrap(Math.floor(x));
  const sy = world.wrap(Math.floor(y));
  const current = world.idx(sx, sy);
  if (passableExitCell(world, current)) return current;
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = world.idx(sx + dx, sy + dy);
        if (passableExitCell(world, ci)) return ci;
      }
    }
  }
  return current;
}

function passengerExitCell(world: World, passenger: Entity, track: RailTrainTrack | undefined, train: RailTrain | undefined): number {
  if (track && train) {
    const seatCell = trainCellAt(track, train, Math.max(0, Math.min(train.length - 1, train.passengerSeat)));
    const seat = cellCenter(seatCell);
    const platform = nearestPlatformCell(world, track, seat.x + 0.5, seat.y + 0.5, 96 * 96);
    if (platform >= 0 && passableExitCell(world, platform)) return platform;
  }
  if (track) {
    for (const ci of track.platformCells) if (passableExitCell(world, ci)) return ci;
  }
  return findSafeExitNear(world, passenger.x, passenger.y, 24);
}

function exitInterruptedPassenger(world: World, passenger: Entity, track: RailTrainTrack | undefined, train: RailTrain | undefined): void {
  const ci = passengerExitCell(world, passenger, track, train);
  const p = cellCenter(ci);
  passenger.x = p.x + 0.5;
  passenger.y = p.y + 0.5;
}

function cloneRailTrack(track: RailTrainTrack): RailTrainTrack {
  return {
    id: track.id,
    label: track.label,
    cells: track.cells.slice(),
    stationOffsets: track.stationOffsets.slice(),
    platformCells: track.platformCells.slice(),
    loop: track.loop,
  };
}

function remapTrainEntityIds(
  entities: Entity[],
  nextId: { v: number },
  sourceTrain: RailTrain,
  generatedIdMap: ReadonlyMap<number, number>,
): number[] {
  const ids: number[] = [];
  for (let i = 0; i < sourceTrain.length; i++) {
    const sourceId = sourceTrain.entityIds[i];
    const mappedId = generatedIdMap.get(sourceId);
    if (mappedId !== undefined && entityById(entities, mappedId)) {
      ids.push(mappedId);
      continue;
    }
    const id = nextId.v++;
    ids.push(id);
    entities.push(createTrainSegmentEntity(id, sourceTrain, i));
  }
  return ids;
}

function cloneRailTrainForRebuild(
  entities: Entity[],
  nextId: { v: number },
  sourceTrain: RailTrain,
  track: RailTrainTrack,
  generatedIdMap: ReadonlyMap<number, number>,
  runtime: RailTrainRuntimeSnapshot | undefined,
): RailTrain | null {
  const entityIds = remapTrainEntityIds(entities, nextId, sourceTrain, generatedIdMap);
  if (entityIds.length === 0) return null;
  const train: RailTrain = {
    id: sourceTrain.id,
    label: sourceTrain.label,
    trackId: sourceTrain.trackId,
    offset: wrapOffset(track, sourceTrain.offset),
    speed: sourceTrain.speed,
    length: entityIds.length,
    direction: sourceTrain.direction,
    stopSeconds: sourceTrain.stopSeconds,
    stopUntil: sourceTrain.stopUntil,
    passengerId: -1,
    passengerSeat: Math.max(0, Math.min(entityIds.length - 1, sourceTrain.passengerSeat)),
    entityIds,
    lastStopOffset: sourceTrain.lastStopOffset >= 0 ? wrapOffset(track, sourceTrain.lastStopOffset) : -1,
    nextWarnAt: sourceTrain.nextWarnAt,
    nextCrushAt: sourceTrain.nextCrushAt,
    nextDoorMsgAt: sourceTrain.nextDoorMsgAt,
  };
  if (runtime && runtime.trackId === sourceTrain.trackId) {
    train.offset = wrapOffset(track, runtime.offset);
    train.direction = runtime.direction;
    train.stopUntil = runtime.stopUntil;
    train.passengerSeat = Math.max(0, Math.min(entityIds.length - 1, runtime.passengerSeat));
    train.lastStopOffset = runtime.lastStopOffset >= 0 ? wrapOffset(track, runtime.lastStopOffset) : -1;
    train.nextWarnAt = runtime.nextWarnAt;
    train.nextCrushAt = runtime.nextCrushAt;
    train.nextDoorMsgAt = runtime.nextDoorMsgAt;
  }
  return train;
}

export function snapshotRailTrainsForRebuild(world: World): RailTrainRebuildSnapshot {
  return {
    trains: world.railTrains.map(train => ({
      id: train.id,
      trackId: train.trackId,
      offset: train.offset,
      direction: train.direction,
      stopUntil: train.stopUntil,
      passengerId: train.passengerId,
      passengerSeat: train.passengerSeat,
      lastStopOffset: train.lastStopOffset,
      nextWarnAt: train.nextWarnAt,
      nextCrushAt: train.nextCrushAt,
      nextDoorMsgAt: train.nextDoorMsgAt,
    })),
  };
}

export function installRailTrainsFromGeneration(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  generatedWorld: World,
  generatedIdMap: ReadonlyMap<number, number>,
  snapshot: RailTrainRebuildSnapshot,
): void {
  const runtimeById = new Map<string, RailTrainRuntimeSnapshot>();
  const interruptedPassengers: RailTrainRuntimeSnapshot[] = [];
  for (const train of snapshot.trains) {
    runtimeById.set(train.id, train);
    if (train.passengerId >= 0) interruptedPassengers.push(train);
  }

  world.railTracks = generatedWorld.railTracks.map(cloneRailTrack);
  world.railTrains = [];
  world.railTrainCells.clear();

  for (const sourceTrain of generatedWorld.railTrains) {
    const track = trackById(world, sourceTrain.trackId);
    if (!track || track.cells.length === 0) continue;
    const train = cloneRailTrainForRebuild(
      entities,
      nextId,
      sourceTrain,
      track,
      generatedIdMap,
      runtimeById.get(sourceTrain.id),
    );
    if (train) world.railTrains.push(train);
  }

  for (let i = 0; i < world.railTrains.length; i++) {
    const train = world.railTrains[i];
    const track = trackById(world, train.trackId);
    if (track) positionTrainEntities(world, entities, track, train, i);
  }

  for (const ride of interruptedPassengers) {
    const passenger = entityById(entities, ride.passengerId);
    if (!passenger || !passenger.alive) continue;
    const train = world.railTrains.find(t => t.id === ride.id);
    const track = train ? trackById(world, train.trackId) : world.railTracks.find(t => t.id === ride.trackId);
    exitInterruptedPassenger(world, passenger, track, train);
  }
}

export function addRailTrainRoute(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  track: RailTrainTrack,
  opts: RailTrainSpawnOptions,
): RailTrain | null {
  if (world.railTrains.length >= RUNTIME_TOPOLOGY_LIMITS.railTrainMaxTrains) return null;
  const length = Math.max(1, Math.min(RUNTIME_TOPOLOGY_LIMITS.railTrainMaxLength, opts.length | 0));
  if (track.cells.length < Math.max(12, length * SEGMENT_STRIDE + 2)) return null;
  world.railTracks.push(track);

  const train: RailTrain = {
    id: opts.id,
    label: opts.label,
    trackId: track.id,
    offset: wrapOffset(track, opts.initialOffset ?? track.stationOffsets[0] ?? 0),
    speed: opts.speed,
    length,
    direction: opts.direction ?? 1,
    stopSeconds: opts.stopSeconds ?? 4,
    stopUntil: -1,
    passengerId: -1,
    passengerSeat: Math.max(1, Math.floor(length * 0.42)),
    entityIds: [],
    lastStopOffset: -1,
    nextWarnAt: 0,
    nextCrushAt: 0,
    nextDoorMsgAt: 0,
  };

  for (let i = 0; i < train.length; i++) {
    const id = nextId.v++;
    train.entityIds.push(id);
    entities.push({
      id,
      type: EntityType.BILLBOARD,
      x: 0,
      y: 0,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.TRAIN_CAR,
      spriteScale: i === 0 ? 1.85 : 1.55,
      spriteZ: 0,
      name: i === 0 ? opts.label : `${opts.label} вагон`,
      faction: Faction.WILD,
    });
  }

  world.railTrains.push(train);
  positionTrainEntities(world, entities, track, train, world.railTrains.length - 1);
  return train;
}

export function isRidingRailTrain(world: World, player: Entity): boolean {
  return world.railTrains.some(train => train.passengerId === player.id);
}

export function railTrainInteractionTargetId(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): number | null {
  const riding = world.railTrains.find(train => train.passengerId === player.id);
  if (riding) return 940000 + world.railTrains.indexOf(riding);
  const train = boardableTrain(world, player, state, lookX, lookY);
  return train ? 930000 + world.railTrains.indexOf(train) : null;
}

export function tryUseRailTrain(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const riding = world.railTrains.find(train => train.passengerId === player.id);
  if (riding) {
    const track = trackById(world, riding.trackId);
    if (!track || !trainStopped(riding, state)) {
      state.msgs.push(msg('Двери поезда закрыты. Сойти можно на следующей платформе; мысли тоже держите внутри.', state.time, '#888'));
      return true;
    }
    const exit = nearestPlatformCell(world, track, player.x, player.y, 8 * 8);
    if (exit < 0) {
      state.msgs.push(msg('За дверью нет платформы. Поезд держит маршрут дальше и не признает прыжок выходом.', state.time, '#888'));
      return true;
    }
    const p = cellCenter(exit);
    player.x = p.x + 0.5;
    player.y = p.y + 0.5;
    riding.passengerId = -1;
    state.msgs.push(msg(`${riding.label}: вы вышли на платформу. Сначала к стене, потом смотреть табло.`, state.time, '#8cf'));
    publishRailEvent(world, state, player, riding, 'rail_train_exited', 3, ['exit']);
    return true;
  }

  const train = boardableTrain(world, player, state, lookX, lookY);
  if (!train) return false;
  train.passengerId = player.id;
  train.passengerSeat = Math.max(1, Math.floor(train.length * 0.42));
  const track = trackById(world, train.trackId);
  if (track) bindPassenger(player, track, train);
  state.msgs.push(msg(`${train.label}: двери закрылись, маршрут пошел. Руки убрать, мысли тоже.`, state.time, '#6cf'));
  publishRailEvent(world, state, player, train, 'rail_train_boarded', 3, ['board']);
  return true;
}

export function updateRailTrains(world: World, entities: Entity[], player: Entity, state: GameState, dt: number): void {
  if (world.railTrains.length === 0) return;
  world.railTrainCells.clear();
  for (let i = 0; i < world.railTrains.length; i++) {
    const train = world.railTrains[i];
    const track = trackById(world, train.trackId);
    if (!track || track.cells.length === 0) continue;
    updateTrainMotion(world, track, train, state, player, dt);
    positionTrainEntities(world, entities, track, train, i);
    if (train.passengerId === player.id) bindPassenger(player, track, train);
  }
  updateTrainCollisions(world, entities, player, state);
}
