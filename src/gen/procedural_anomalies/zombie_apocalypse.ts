import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  W,
  type Entity,
  type Room,
  type WorldContainer,
} from '../../core/types';
import { CONTAINER_DEFS } from '../../data/container_defs';
import { activeActorSoftLimit } from '../../data/entity_limits';
import { freshNeeds, randomName } from '../../data/catalog';
import { generateContainerLoot } from '../../systems/procedural_loot';
import { floorRunZAllowsNpcs, type ProceduralFloorSpec } from '../../data/procedural_floors';
import { MONSTERS } from '../../entities/monster';
import { HEAD_SLUG_HOSTED_STAGE } from '../../entities/head_slug';
import { monsterSpr } from '../../render/sprite_index';
import { canSpawnEntityType, entitySpawnSlots } from '../../systems/entity_limits';
import { gaussianLevel, getMaxHp, randomRPG } from '../../systems/rpg';
import { registerRouteCue } from '../../systems/route_cues';
import type { World } from '../../core/world';
import {
  addItemDrop,
  pick,
  randomFloorCell,
  randomRoomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const CROWD_OCCUPATIONS = [
  Occupation.HOUSEWIFE,
  Occupation.LOCKSMITH,
  Occupation.COOK,
  Occupation.TURNER,
  Occupation.MECHANIC,
  Occupation.STOREKEEPER,
  Occupation.ALCOHOLIC,
  Occupation.CHILD,
  Occupation.TRAVELER,
] as const;

const CROWD_BUCKET_SIZE = 32;
const CROWD_BUCKET_CAP = 20;
const QUARANTINE_RADII = [11, 19, 29] as const;
const QUARANTINE_LIFT_CLEARANCE_SQ = 11 * 11;
const MEDICAL_POCKET_COUNT = 2;

interface Point {
  x: number;
  y: number;
}

interface InfectionSeed extends Point {
  kind: 'outbreak' | 'infection' | 'medical' | 'spawn';
}

interface ZombieApocalypseGeometryStats {
  quarantineCells: number;
  quarantineDoors: number;
  funnelCells: number;
  infectedVoronoiCells: number;
  medicalVoronoiCells: number;
}

function crowdCount(ctx: ProceduralAnomalyGenContext): number {
  return entitySpawnSlots(ctx.entities, EntityType.NPC, activeActorSoftLimit());
}

function crowdRooms(rooms: readonly Room[]): Room[] {
  return rooms.filter(room => (
    room.w >= 4 &&
    room.h >= 4 &&
    room.type !== RoomType.BATHROOM &&
    room.type !== RoomType.STORAGE
  ));
}

function chooseOutbreakRoom(ctx: ProceduralAnomalyGenContext, rooms: readonly Room[]): Room | null {
  const sx = Math.floor(ctx.spawnX);
  const sy = Math.floor(ctx.spawnY);
  const candidates = rooms
    .filter(room => room.w * room.h >= 54)
    .map(room => ({ room, d2: ctx.world.dist2(sx, sy, roomCenter(room).x, roomCenter(room).y) }))
    .filter(item => item.d2 > 42 * 42)
    .sort((a, b) => b.d2 - a.d2);
  if (candidates.length === 0) return rooms[0] ?? null;
  return candidates[Math.floor(Math.random() * Math.min(candidates.length, 18))].room;
}

function chooseMedicalSlugRoom(rooms: readonly Room[]): Room | null {
  const candidates = rooms.filter(room => room.type === RoomType.MEDICAL && room.w * room.h >= 30);
  return candidates.length > 0 ? pick(candidates) : null;
}

function hashUnit(seed: number, x: number, y: number, salt: number): number {
  let h = (seed ^ Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + salt + 0xc2b2, 0x27d4eb2d)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h / 0xffffffff;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function toroidalAngle(from: Point, to: Point, ctx: ProceduralAnomalyGenContext): number {
  return Math.atan2(ctx.world.delta(from.y, to.y), ctx.world.delta(from.x, to.x));
}

function roomDist2(ctx: ProceduralAnomalyGenContext, a: Room, b: Room): number {
  const ac = roomCenter(a);
  const bc = roomCenter(b);
  return ctx.world.dist2(ac.x + 0.5, ac.y + 0.5, bc.x + 0.5, bc.y + 0.5);
}

function chooseMedicalCounterplayRooms(ctx: ProceduralAnomalyGenContext, rooms: readonly Room[], outbreak: Room | null): Room[] {
  const existing = rooms.filter(room => room.type === RoomType.MEDICAL && room.w * room.h >= 24 && room !== outbreak);
  const candidates = (existing.length > 0 ? existing : rooms.filter(room => (
    room !== outbreak &&
    room.w * room.h >= 28 &&
    room.type !== RoomType.BATHROOM &&
    room.type !== RoomType.SMOKING
  )))
    .map(room => {
      const c = roomCenter(room);
      const spawnD2 = ctx.world.dist2(ctx.spawnX, ctx.spawnY, c.x + 0.5, c.y + 0.5);
      const outbreakD2 = outbreak ? roomDist2(ctx, room, outbreak) : 9999;
      return { room, score: spawnD2 - outbreakD2 * 0.35 };
    })
    .sort((a, b) => a.score - b.score);

  const out: Room[] = [];
  for (const entry of candidates) {
    if (out.some(room => roomDist2(ctx, room, entry.room) < 28 * 28)) continue;
    out.push(entry.room);
    if (out.length >= MEDICAL_POCKET_COUNT) break;
  }
  return out;
}

function roomInteriorCell(ctx: ProceduralAnomalyGenContext, room: Room, dx: number, dy: number): Point | null {
  const x = ctx.world.wrap(room.x + Math.max(1, Math.min(room.w - 2, dx)));
  const y = ctx.world.wrap(room.y + Math.max(1, Math.min(room.h - 2, dy)));
  const ci = ctx.world.idx(x, y);
  if (ctx.world.roomMap[ci] !== room.id || ctx.world.cells[ci] !== Cell.FLOOR) return null;
  return { x, y };
}

function setFeatureInRoom(ctx: ProceduralAnomalyGenContext, room: Room, dx: number, dy: number, feature: Feature): void {
  const pos = roomInteriorCell(ctx, room, dx, dy);
  if (!pos) return;
  const ci = ctx.world.idx(pos.x, pos.y);
  if (ctx.world.features[ci] !== Feature.NONE && ctx.world.features[ci] !== Feature.LAMP) return;
  ctx.world.features[ci] = feature;
}

function nextContainerId(ctx: ProceduralAnomalyGenContext): number {
  return ctx.world.containers.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
}

function addMedicalCounterplayContainer(ctx: ProceduralAnomalyGenContext, room: Room, pos: Point, index: number): WorldContainer | null {
  if (ctx.world.containersAt(pos.x, pos.y).length > 0) return null;
  const def = CONTAINER_DEFS[ContainerKind.MEDICAL_CABINET];
  const inventory = index === 0
    ? [
      { defId: 'sterile_bandage', count: 2 },
      { defId: 'tourniquet', count: 1 },
      { defId: 'antibiotic', count: 1 },
      { defId: 'official_quarantine_clearance', count: 1 },
    ]
    : [
      { defId: 'bandage', count: 3 },
      { defId: 'clean_health_cert', count: 1 },
      { defId: 'ozk_patch', count: 2 },
      { defId: 'gasmask_filter', count: 1 },
    ];
  const container: WorldContainer = {
    id: nextContainerId(ctx),
    x: pos.x,
    y: pos.y,
    floor: ctx.spec.baseFloor,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(pos.x, pos.y)],
    kind: ContainerKind.MEDICAL_CABINET,
    name: `Карантинный шкаф: ${room.name}`,
    inventory,
    capacitySlots: def.capacitySlots,
    access: 'public',
    discovered: true,
    tags: ['procedural', 'anomaly', 'zombie_apocalypse', 'medical_counterplay', 'quarantine'],
  };
  ctx.world.addContainer(container);
  return container;
}

function prepareMedicalCounterplayPockets(ctx: ProceduralAnomalyGenContext, rooms: readonly Room[], outbreak: Room | null): Room[] {
  const pockets = chooseMedicalCounterplayRooms(ctx, rooms, outbreak);
  for (let i = 0; i < pockets.length; i++) {
    const room = pockets[i];
    room.type = RoomType.MEDICAL;
    if (!room.name.startsWith('Пункт карантинной медицины')) room.name = `Пункт карантинной медицины: ${room.name}`;
    const cx = Math.floor(room.w / 2);
    const cy = Math.floor(room.h / 2);
    setFeatureInRoom(ctx, room, cx, cy, Feature.APPARATUS);
    setFeatureInRoom(ctx, room, 1, 1, Feature.SHELF);
    setFeatureInRoom(ctx, room, room.w - 2, 1, Feature.LAMP);
    setFeatureInRoom(ctx, room, 1, room.h - 2, Feature.SINK);
    const cabinet = roomInteriorCell(ctx, room, Math.min(room.w - 2, 2 + i), Math.max(1, room.h - 2));
    if (cabinet) addMedicalCounterplayContainer(ctx, room, cabinet, i);
  }
  if (pockets.length > 0) ctx.world.markFeaturesDirty(true);
  return pockets;
}

function liftAnchors(ctx: ProceduralAnomalyGenContext): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < W * W; i++) {
    if (ctx.world.cells[i] === Cell.LIFT) out.push({ x: i % W, y: (i / W) | 0 });
  }
  return out;
}

function nearAnyPoint(ctx: ProceduralAnomalyGenContext, x: number, y: number, points: readonly Point[], limitSq: number): boolean {
  for (const p of points) {
    if (ctx.world.dist2(x + 0.5, y + 0.5, p.x + 0.5, p.y + 0.5) < limitSq) return true;
  }
  return false;
}

function mutableQuarantineCellWorld(world: World, ci: number): boolean {
  if (world.aptMask[ci] || world.hermoWall[ci]) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON) return false;
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.DOOR;
}

function mutableQuarantineCell(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  return mutableQuarantineCellWorld(ctx.world, ci);
}

function walkableQuarantineDoorSideWorld(world: World, ci: number): boolean {
  const cell = world.cells[ci];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function frameQuarantineDoorWorld(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  const left = world.idx(x - 1, y);
  const right = world.idx(x + 1, y);
  const up = world.idx(x, y - 1);
  const down = world.idx(x, y + 1);
  const wall = (idx: number) => world.cells[idx] === Cell.WALL;
  if (wall(left) && wall(right) && walkableQuarantineDoorSideWorld(world, up) && walkableQuarantineDoorSideWorld(world, down)) return true;
  if (wall(up) && wall(down) && walkableQuarantineDoorSideWorld(world, left) && walkableQuarantineDoorSideWorld(world, right)) return true;
  const canWall = (idx: number) => mutableQuarantineCellWorld(world, idx) && !world.containerMap.has(idx);
  const setWall = (idx: number): void => {
    world.cells[idx] = Cell.WALL;
    world.wallTex[idx] = Tex.METAL;
    world.features[idx] = Feature.NONE;
    world.roomMap[idx] = -1;
  };

  if (canWall(left) && canWall(right) && walkableQuarantineDoorSideWorld(world, up) && walkableQuarantineDoorSideWorld(world, down)) {
    setWall(left);
    setWall(right);
    return true;
  }
  if (canWall(up) && canWall(down) && walkableQuarantineDoorSideWorld(world, left) && walkableQuarantineDoorSideWorld(world, right)) {
    setWall(up);
    setWall(down);
    return true;
  }
  return false;
}

function setQuarantineDoorWorld(world: World, ci: number): boolean {
  const roomId = world.roomMap[ci];
  if (!frameQuarantineDoorWorld(world, ci)) return false;
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.doors.set(ci, {
    idx: ci,
    state: DoorState.HERMETIC_OPEN,
    roomA: roomId,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  const room = world.rooms[roomId];
  if (room && !room.doors.includes(ci)) room.doors.push(ci);
  return true;
}

function setQuarantineDoor(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  return setQuarantineDoorWorld(ctx.world, ci);
}

function placeFallbackQuarantineDoorWorld(world: World, room: Room): boolean {
  for (let dy = 2; dy < room.h - 2; dy++) {
    for (let dx = 2; dx < room.w - 2; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
      if (world.containerMap.has(ci) || world.features[ci] === Feature.LIFT_BUTTON) continue;
      if (setQuarantineDoorWorld(world, ci)) return true;
    }
  }
  return false;
}

function placeFallbackQuarantineDoor(ctx: ProceduralAnomalyGenContext, room: Room): boolean {
  return placeFallbackQuarantineDoorWorld(ctx.world, room);
}

export function ensureZombieApocalypseQuarantineDoor(world: World, rooms: readonly Room[], spec: ProceduralFloorSpec): void {
  if (spec.anomalyId !== 'zombie_apocalypse' || !floorRunZAllowsNpcs(spec.z)) return;
  const outbreak = rooms.find(room => room.name.startsWith('Очаг ноль:'));
  if (!outbreak) return;
  const hasOutbreakDoor = outbreak.doors.some(idx => {
    const door = world.doors.get(idx);
    return door?.state === DoorState.HERMETIC_OPEN && world.wallTex[idx] === Tex.DOOR_METAL;
  });
  if (hasOutbreakDoor) return;
  if (!placeFallbackQuarantineDoorWorld(world, outbreak)) return;
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFeaturesDirty(false);
}

function applyQuarantineRings(ctx: ProceduralAnomalyGenContext, outbreak: Room, pockets: readonly Room[]): ZombieApocalypseGeometryStats {
  const stats: ZombieApocalypseGeometryStats = {
    quarantineCells: 0,
    quarantineDoors: 0,
    funnelCells: 0,
    infectedVoronoiCells: 0,
    medicalVoronoiCells: 0,
  };
  const center = roomCenter(outbreak);
  const centerPoint = { x: center.x + 0.5, y: center.y + 0.5 };
  const liftPoints = liftAnchors(ctx);
  const gateTargets = [
    { x: ctx.spawnX, y: ctx.spawnY },
    ...pockets.map(room => {
      const c = roomCenter(room);
      return { x: c.x + 0.5, y: c.y + 0.5 };
    }),
  ];
  const gateAngles = gateTargets.map(target => toroidalAngle(centerPoint, target, ctx));

  for (let ring = 0; ring < QUARANTINE_RADII.length; ring++) {
    const radius = QUARANTINE_RADII[ring];
    for (let dy = -radius - 2; dy <= radius + 2; dy++) {
      for (let dx = -radius - 2; dx <= radius + 2; dx++) {
        const x = ctx.world.wrap(center.x + dx);
        const y = ctx.world.wrap(center.y + dy);
        const ci = ctx.world.idx(x, y);
        if (!mutableQuarantineCell(ctx, ci)) continue;
        if (ctx.world.dist2(ctx.spawnX, ctx.spawnY, x + 0.5, y + 0.5) < 10 * 10) continue;
        if (nearAnyPoint(ctx, x, y, liftPoints, QUARANTINE_LIFT_CLEARANCE_SQ)) continue;
        const dist = Math.sqrt(ctx.world.dist2(centerPoint.x, centerPoint.y, x + 0.5, y + 0.5));
        if (Math.abs(dist - radius) > 0.78) continue;
        const angle = toroidalAngle(centerPoint, { x: x + 0.5, y: y + 0.5 }, ctx);
        const gate = gateAngles.some(gateAngle => angleDiff(angle, gateAngle) < 0.34 + ring * 0.04);
        const h = hashUnit(ctx.spec.seed, x, y, ring + 61);
        if (gate) {
          if (ctx.world.cells[ci] === Cell.FLOOR) ctx.world.floorTex[ci] = Tex.F_TILE;
          ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 10 + ring * 3);
          continue;
        }
        if (stats.quarantineDoors === 0 && h < 0.72 && ctx.world.cells[ci] === Cell.FLOOR) {
          if (setQuarantineDoor(ctx, ci)) {
            stats.quarantineDoors++;
            continue;
          }
        }
        if (h < 0.34 && ctx.world.cells[ci] === Cell.FLOOR) {
          ctx.world.cells[ci] = Cell.WALL;
          ctx.world.wallTex[ci] = Tex.METAL;
          ctx.world.roomMap[ci] = -1;
          stats.quarantineCells++;
        } else if (h < 0.45) {
          if (setQuarantineDoor(ctx, ci)) stats.quarantineDoors++;
        } else if (h < 0.72 && ctx.world.features[ci] === Feature.NONE) {
          ctx.world.features[ci] = h < 0.58 ? Feature.TABLE : Feature.APPARATUS;
          ctx.world.floorTex[ci] = Tex.F_CONCRETE;
          stats.quarantineCells++;
        }
      }
    }
  }

  if (stats.quarantineCells > 0 || stats.quarantineDoors > 0) {
    ctx.world.markCellsDirty();
    ctx.world.markWallTexDirty();
    ctx.world.markFloorTexDirty();
    ctx.world.markFeaturesDirty(false);
    ctx.world.markFogDirty();
  }
  if (stats.quarantineDoors === 0 && placeFallbackQuarantineDoor(ctx, outbreak)) {
    stats.quarantineDoors++;
    ctx.world.markCellsDirty();
    ctx.world.markWallTexDirty();
    ctx.world.markFeaturesDirty(false);
  }
  return stats;
}

function stampFunnelLine(ctx: ProceduralAnomalyGenContext, from: Point, to: Point, seed: number): number {
  const dx = ctx.world.delta(from.x, to.x);
  const dy = ctx.world.delta(from.y, to.y);
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const steps = Math.min(104, Math.max(12, Math.ceil(dist)));
  const nx = -dy / dist;
  const ny = dx / dist;
  let changed = 0;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const bx = from.x + dx * t;
    const by = from.y + dy * t;
    for (let w = -2; w <= 2; w++) {
      const x = ctx.world.wrap(Math.round(bx + nx * w));
      const y = ctx.world.wrap(Math.round(by + ny * w));
      const ci = ctx.world.idx(x, y);
      if (ctx.world.cells[ci] !== Cell.FLOOR || ctx.world.aptMask[ci] || ctx.world.hermoWall[ci]) continue;
      const h = hashUnit(seed, x, y, 17);
      ctx.world.floorTex[ci] = h < 0.5 ? Tex.F_CONCRETE : Tex.F_TILE;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 12);
      if (ctx.world.features[ci] === Feature.NONE && h < 0.035) ctx.world.features[ci] = Feature.LAMP;
      if (h < 0.018) stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.26, 0.42, seed + step * 31 + w, 120, 30, 22, false);
      changed++;
    }
  }
  return changed;
}

function markCrowdFunnels(ctx: ProceduralAnomalyGenContext, outbreak: Room, pockets: readonly Room[]): number {
  const c = roomCenter(outbreak);
  const from = { x: c.x + 0.5, y: c.y + 0.5 };
  let changed = stampFunnelLine(ctx, from, { x: ctx.spawnX, y: ctx.spawnY }, ctx.spec.seed ^ 0x4f11);
  for (let i = 0; i < pockets.length; i++) {
    const pc = roomCenter(pockets[i]);
    changed += stampFunnelLine(ctx, from, { x: pc.x + 0.5, y: pc.y + 0.5 }, ctx.spec.seed ^ (0x7219 + i * 131));
  }
  if (changed > 0) {
    ctx.world.markFloorTexDirty();
    ctx.world.markFeaturesDirty(false);
    ctx.world.markFogDirty();
  }
  return changed;
}

function infectionVoronoiSeeds(ctx: ProceduralAnomalyGenContext, rooms: readonly Room[], outbreak: Room, pockets: readonly Room[]): InfectionSeed[] {
  const seeds: InfectionSeed[] = [];
  const outbreakCenter = roomCenter(outbreak);
  seeds.push({ x: outbreakCenter.x + 0.5, y: outbreakCenter.y + 0.5, kind: 'outbreak' });
  seeds.push({ x: ctx.spawnX, y: ctx.spawnY, kind: 'spawn' });
  for (const pocket of pockets) {
    const c = roomCenter(pocket);
    seeds.push({ x: c.x + 0.5, y: c.y + 0.5, kind: 'medical' });
  }
  const candidates = rooms.filter(room => room !== outbreak && !pockets.includes(room) && room.w * room.h >= 36);
  for (let i = 0; i < Math.min(3, candidates.length); i++) {
    const room = candidates[(ctx.spec.seed + i * 23) % candidates.length];
    const c = roomCenter(room);
    seeds.push({ x: c.x + 0.5, y: c.y + 0.5, kind: 'infection' });
  }
  return seeds;
}

function nearestInfectionSeed(ctx: ProceduralAnomalyGenContext, seeds: readonly InfectionSeed[], x: number, y: number): InfectionSeed {
  let best = seeds[0];
  let bestD2 = Infinity;
  for (const seed of seeds) {
    const d2 = ctx.world.dist2(x + 0.5, y + 0.5, seed.x, seed.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = seed;
    }
  }
  return best;
}

function applyInfectionVoronoiCells(
  ctx: ProceduralAnomalyGenContext,
  rooms: readonly Room[],
  outbreak: Room,
  pockets: readonly Room[],
  stats: ZombieApocalypseGeometryStats,
): void {
  const seeds = infectionVoronoiSeeds(ctx, rooms, outbreak, pockets);
  for (const ci of ctx.placement.candidates) {
    const x = ci % W;
    const y = (ci / W) | 0;
    if (ctx.world.aptMask[ci] || ctx.world.hermoWall[ci]) continue;
    const seed = nearestInfectionSeed(ctx, seeds, x, y);
    const h = hashUnit(ctx.spec.seed, x, y, 0x21);
    if (seed.kind === 'medical' || seed.kind === 'spawn') {
      if (h < 0.24) {
        ctx.world.floorTex[ci] = Tex.F_TILE;
        ctx.world.fog[ci] = Math.max(0, ctx.world.fog[ci] - 6);
        stats.medicalVoronoiCells++;
      }
      continue;
    }
    if (h > (seed.kind === 'outbreak' ? 0.52 : 0.32)) continue;
    ctx.world.floorTex[ci] = seed.kind === 'outbreak' ? Tex.F_TILE : Tex.F_CONCRETE;
    ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], seed.kind === 'outbreak' ? 24 : 14);
    if (h < 0.006) stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.22, 0.38, ctx.spec.seed + ci, 96, 28, 24, false);
    stats.infectedVoronoiCells++;
  }
  ctx.world.markFloorTexDirty();
  ctx.world.markFogDirty();
}

function roomOnFunnel(ctx: ProceduralAnomalyGenContext, room: Room, from: Point, to: Point): boolean {
  const c = roomCenter(room);
  const vx = ctx.world.delta(from.x, to.x);
  const vy = ctx.world.delta(from.y, to.y);
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.01) return false;
  const px = ctx.world.delta(from.x, c.x + 0.5);
  const py = ctx.world.delta(from.y, c.y + 0.5);
  const t = (px * vx + py * vy) / len2;
  if (t <= 0 || t >= 1) return false;
  const closestX = vx * t;
  const closestY = vy * t;
  const ox = px - closestX;
  const oy = py - closestY;
  return ox * ox + oy * oy < 32 * 32;
}

function crowdDistributionRooms(ctx: ProceduralAnomalyGenContext, rooms: readonly Room[], outbreak: Room | null, pockets: readonly Room[]): Room[] {
  if (!outbreak) return rooms.slice();
  const fromCenter = roomCenter(outbreak);
  const from = { x: fromCenter.x + 0.5, y: fromCenter.y + 0.5 };
  const targets = [
    { x: ctx.spawnX, y: ctx.spawnY },
    ...pockets.map(room => {
      const c = roomCenter(room);
      return { x: c.x + 0.5, y: c.y + 0.5 };
    }),
  ];
  const weighted: Room[] = [];
  for (const room of rooms) {
    const onFunnel = targets.some(target => roomOnFunnel(ctx, room, from, target));
    const repeats = room === outbreak
      ? 7
      : pockets.includes(room)
        ? 3
        : onFunnel
          ? 5
          : (room.type === RoomType.COMMON || room.type === RoomType.CORRIDOR || room.type === RoomType.KITCHEN) ? 2 : 1;
    for (let i = 0; i < repeats; i++) weighted.push(room);
  }
  return weighted.length > 0 ? weighted : rooms.slice();
}

function registerZombieApocalypseCues(
  ctx: ProceduralAnomalyGenContext,
  outbreak: Room | null,
  pockets: readonly Room[],
  stats: ZombieApocalypseGeometryStats,
): void {
  if (outbreak) {
    const c = roomCenter(outbreak);
    registerRouteCue(ctx.world, {
      id: `${ctx.spec.key}:zombie_apocalypse:outbreak`,
      x: ctx.spawnX,
      y: ctx.spawnY,
      targetX: c.x + 0.5,
      targetY: c.y + 0.5,
      floor: ctx.spec.baseFloor,
      label: 'КАРАНТИННЫЙ ОЧАГ',
      hint: 'металл, толпа, заражение',
      targetName: outbreak.name,
      color: '#9f6',
      tags: ['procedural', 'anomaly', 'zombie_apocalypse', 'quarantine_ring', 'crowd_funnel', 'infection_voronoi'],
      toneSeed: ctx.spec.seed ^ 0x701,
      targetRoomId: outbreak.id,
      targetRadius: 6,
      heardText: 'Из-за карантинной ленты слышен общий стук: толпа идет в один коридор.',
      followedText: 'Очаг найден. Металл оставил проходы, но не оставил тишины.',
      routeGroup: {
        id: 'zombie_apocalypse',
        lead: 'карантинный очаг',
        risk: stats.infectedVoronoiCells > 0 ? 'заражение расползается пятнами' : 'заражение у очага',
        decision: 'обойти через медпункт или резать коридор',
        reward: 'справки и медицина',
      },
    });
  }
  for (let i = 0; i < pockets.length; i++) {
    const room = pockets[i];
    const c = roomCenter(room);
    registerRouteCue(ctx.world, {
      id: `${ctx.spec.key}:zombie_apocalypse:medical:${i}`,
      x: ctx.spawnX,
      y: ctx.spawnY,
      targetX: c.x + 0.5,
      targetY: c.y + 0.5,
      floor: ctx.spec.baseFloor,
      label: 'МЕДПУНКТ КАРАНТИНА',
      hint: 'перевязка, фильтр, справка',
      targetName: room.name,
      color: '#9cf',
      tags: ['procedural', 'anomaly', 'zombie_apocalypse', 'medical_counterplay', 'quarantine'],
      toneSeed: ctx.spec.seed ^ (0x941 + i * 37),
      targetRoomId: room.id,
      targetRadius: 4,
      heardText: 'Где-то щелкает медицинская лампа: пункт карантина еще не растащили.',
      followedText: 'Медпункт найден. Здесь можно собрать себя перед очагом.',
    });
  }
}

function crowdBucketIndex(x: number, y: number): number {
  const side = Math.ceil(W / CROWD_BUCKET_SIZE);
  const bx = Math.min(side - 1, Math.max(0, Math.floor(x / CROWD_BUCKET_SIZE)));
  const by = Math.min(side - 1, Math.max(0, Math.floor(y / CROWD_BUCKET_SIZE)));
  return by * side + bx;
}

function buildCrowdBucketCounts(entities: readonly Entity[]): Int32Array {
  const side = Math.ceil(W / CROWD_BUCKET_SIZE);
  const counts = new Int32Array(side * side);
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.NPC) continue;
    counts[crowdBucketIndex(entity.x, entity.y)]++;
  }
  return counts;
}

function freeCrowdCell(ctx: ProceduralAnomalyGenContext, room: Room, occupied: Set<number>, bucketCounts: Int32Array): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 36; attempt++) {
    const pos = randomRoomCell(ctx.world, room, false);
    if (!pos) continue;
    if (ctx.world.dist2(ctx.spawnX, ctx.spawnY, pos.x + 0.5, pos.y + 0.5) < 8 * 8) continue;
    const ci = ctx.world.idx(pos.x, pos.y);
    if (occupied.has(ci)) continue;
    if (ctx.world.cells[ci] !== Cell.FLOOR) continue;
    const bucket = crowdBucketIndex(pos.x + 0.5, pos.y + 0.5);
    if (bucketCounts[bucket] >= CROWD_BUCKET_CAP) continue;
    occupied.add(ci);
    bucketCounts[bucket]++;
    return pos;
  }
  return null;
}

interface SpawnCrowdNpcConfig {
  ctx: ProceduralAnomalyGenContext;
  room: Room;
  occupied: Set<number>;
  bucketCounts: Int32Array;
  order: number;
  active: boolean;
}

function spawnCrowdNpc(cfg: SpawnCrowdNpcConfig): boolean {
  const { ctx, room, occupied, bucketCounts, order, active } = cfg;
  const pos = freeCrowdCell(ctx, room, occupied, bucketCounts);
  if (!pos) return false;
  const ci = ctx.world.idx(pos.x, pos.y);
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? ctx.spec.danger;
  const rpg = active ? randomRPG(gaussianLevel(zoneLevel, 2)) : undefined;
  const hp = rpg ? getMaxHp(rpg) : 38 + Math.floor(Math.random() * 24);
  const nm = randomName(Faction.CITIZEN);
  const occupation = pick(CROWD_OCCUPATIONS);
  const child = occupation === Occupation.CHILD;

  const npc: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.NPC,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: child ? 0.82 : 1.05 + Math.random() * 0.18,
    sprite: occupation,
    spriteSeed: (ctx.spec.seed ^ Math.imul(order + 1, 0x45d9f3b)) >>> 0,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    hp,
    maxHp: hp,
    money: Math.floor(Math.random() * 35),
    faction: Faction.CITIZEN,
    occupation,
    questId: -1,
    inventory: Math.random() < 0.16
      ? generateContainerLoot(['food', 'trash'], 15, zoneLevel, [Math.random()])
      : [],
  };

  if (active) {
    npc.needs = freshNeeds();
    npc.ai = {
      goal: AIGoal.IDLE,
      tx: pos.x,
      ty: pos.y,
      path: [],
      pi: 0,
      stuck: 0,
      timer: Math.random() * 2,
      combatScanCd: Math.random() * 1.5,
    };
    npc.rpg = rpg;
  }

  ctx.entities.push(npc);
  return true;
}

function markOutbreakRoom(ctx: ProceduralAnomalyGenContext, room: Room): void {
  room.name = `Очаг ноль: ${room.name}`;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      const ci = ctx.world.idx(x, y);
      if (ctx.world.cells[ci] !== Cell.FLOOR) continue;
      if (((dx * 17 + dy * 31 + ctx.spec.seed) & 7) === 0) {
        ctx.world.floorTex[ci] = Tex.F_TILE;
        stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.36, 0.54, ctx.spec.seed + dx * 101 + dy * 37, 92, 24, 20, false);
      }
      if (ctx.world.features[ci] === Feature.LAMP && Math.random() < 0.55) ctx.world.features[ci] = Feature.NONE;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 18 + ctx.spec.danger * 6);
    }
  }
  ctx.world.markFogDirty();
}

function tunePatientZero(ctx: ProceduralAnomalyGenContext, entity: Entity, room: Room): void {
  const pos = randomRoomCell(ctx.world, room, false) ??
    randomFloorCell(ctx.world, ctx.spawnX, ctx.spawnY, 36 * 36) ??
    { x: Math.floor(ctx.spawnX), y: Math.floor(ctx.spawnY) };
  const def = MONSTERS[MonsterKind.ZOMBIE];
  const ci = ctx.world.idx(pos.x, pos.y);
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? ctx.spec.danger;
  const hp = Math.round(def.hp * (1.2 + zoneLevel * 0.2));
  entity.type = EntityType.MONSTER;
  entity.x = pos.x + 0.5;
  entity.y = pos.y + 0.5;
  entity.angle = Math.random() * Math.PI * 2;
  entity.pitch = 0;
  entity.alive = true;
  entity.speed = def.speed * 1.08;
  entity.sprite = monsterSpr(MonsterKind.ZOMBIE);
  entity.spriteSeed = (ctx.spec.seed ^ 0x70) >>> 0;
  entity.name = 'Пациент зеро';
  entity.hp = hp;
  entity.maxHp = hp;
  entity.monsterKind = MonsterKind.ZOMBIE;
  entity.attackCd = 0;
  entity.ai = { goal: AIGoal.HUNT, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0, combatScanCd: 0 };
  entity.rpg = randomRPG(Math.max(1, zoneLevel + 1));
  entity.faction = undefined;
  entity.occupation = undefined;
  entity.needs = undefined;
}

function spawnPatientZero(ctx: ProceduralAnomalyGenContext, room: Room): void {
  if (canSpawnEntityType(ctx.entities, EntityType.MONSTER)) {
    const patient: Entity = {
      id: ctx.nextId.v++,
      type: EntityType.MONSTER,
      x: 0,
      y: 0,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: monsterSpr(MonsterKind.ZOMBIE),
    };
    tunePatientZero(ctx, patient, room);
    ctx.entities.push(patient);
    return;
  }
  const existingZombie = ctx.entities.find(entity => entity.alive && entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.ZOMBIE);
  if (existingZombie) tunePatientZero(ctx, existingZombie, room);
}

function spawnHeadSlugPatient(ctx: ProceduralAnomalyGenContext, room: Room): void {
  if (!canSpawnEntityType(ctx.entities, EntityType.MONSTER)) return;
  const pos = randomRoomCell(ctx.world, room, false);
  if (!pos) return;
  const def = MONSTERS[MonsterKind.HEAD_SLUG];
  const ci = ctx.world.idx(pos.x, pos.y);
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? ctx.spec.danger;
  const hp = Math.round(def.hp * (0.9 + zoneLevel * 0.08));
  const skill = Math.min(1.28, 0.88 + zoneLevel * 0.03);
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: def.speed * skill,
    sprite: monsterSpr(MonsterKind.HEAD_SLUG),
    spriteSeed: (ctx.spec.seed ^ 0x5106) >>> 0,
    name: 'Медицинский носитель слизня',
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.HEAD_SLUG,
    monsterStage: HEAD_SLUG_HOSTED_STAGE,
    parasiteHostSkill: skill,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0, combatScanCd: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
  });
}

function convertShadowSpawnsToZombies(ctx: ProceduralAnomalyGenContext): void {
  const def = MONSTERS[MonsterKind.ZOMBIE];
  for (const e of ctx.entities) {
    if (e.type !== EntityType.MONSTER || e.monsterKind !== MonsterKind.SHADOW) continue;
    const ci = ctx.world.idx(Math.floor(e.x), Math.floor(e.y));
    const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? ctx.spec.danger;
    const hp = Math.round(def.hp * (0.75 + zoneLevel * 0.18));
    e.monsterKind = MonsterKind.ZOMBIE;
    e.sprite = monsterSpr(MonsterKind.ZOMBIE);
    e.name = undefined;
    e.hp = hp;
    e.maxHp = hp;
    e.speed = def.speed * (0.9 + ctx.spec.danger * 0.04);
    e.attackCd = 0;
    e.monsterDmgMult = undefined;
    e.phasing = false;
    if (e.ai) {
      e.ai.windupTimer = undefined;
      e.ai.windupTargetId = undefined;
    }
  }
}

export function applyZombieApocalypse(ctx: ProceduralAnomalyGenContext): void {
  if (ctx.spec.anomalyId !== 'zombie_apocalypse' || !floorRunZAllowsNpcs(ctx.spec.z)) return;
  const rooms = crowdRooms(ctx.rooms);
  if (rooms.length === 0) return;

  const outbreak = chooseOutbreakRoom(ctx, rooms);
  const medicalPockets = prepareMedicalCounterplayPockets(ctx, ctx.rooms, outbreak);
  const stats: ZombieApocalypseGeometryStats = {
    quarantineCells: 0,
    quarantineDoors: 0,
    funnelCells: 0,
    infectedVoronoiCells: 0,
    medicalVoronoiCells: 0,
  };
  if (outbreak) markOutbreakRoom(ctx, outbreak);
  if (outbreak) {
    const ringStats = applyQuarantineRings(ctx, outbreak, medicalPockets);
    stats.quarantineCells += ringStats.quarantineCells;
    stats.quarantineDoors += ringStats.quarantineDoors;
    stats.funnelCells += markCrowdFunnels(ctx, outbreak, medicalPockets);
    applyInfectionVoronoiCells(ctx, ctx.rooms, outbreak, medicalPockets, stats);
  }

  const target = crowdCount(ctx);
  const occupied = new Set<number>();
  const bucketCounts = buildCrowdBucketCounts(ctx.entities);
  const distributionRooms = crowdDistributionRooms(ctx, rooms, outbreak, medicalPockets);
  let spawned = 0;
  for (let i = 0; i < target * 12 && spawned < target; i++) {
    const room = Math.random() < 0.22 && outbreak ? outbreak : pick(distributionRooms);
    if (spawnCrowdNpc({ ctx, room, occupied, bucketCounts, order: spawned, active: true })) spawned++;
  }

  convertShadowSpawnsToZombies(ctx);

  if (outbreak) {
    spawnPatientZero(ctx, outbreak);
    const slugRoom = chooseMedicalSlugRoom(ctx.rooms);
    if (slugRoom) spawnHeadSlugPatient(ctx, slugRoom);
    const c = roomCenter(outbreak);
    addItemDrop(ctx, c.x + 1, c.y, 'clean_health_cert', 1);
    addItemDrop(ctx, c.x - 1, c.y, 'bandage', 2);
  }

  convertShadowSpawnsToZombies(ctx);
  registerZombieApocalypseCues(ctx, outbreak, medicalPockets, stats);
}
