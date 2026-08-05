import {
  Cell,
  DoorState,
  Feature,
  Tex,
  W,
  type Entity,
  type GameState,
} from '../core/types';
import type { World } from '../core/world';
import { ITEMS } from '../data/items';
import { rebuildPathBlockersFromWorldObjects } from '../gen/path_blockers';
import { spawnBreachDust } from './blood_fx';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

export const BREACH_CHARGE_ID = 'breach_charge';

const MAX_BREACHED_DOORS = 6;
const MAX_BREACHED_WALLS = 18;

const BREACHABLE_WALL_TEX = new Set<number>([
  Tex.CONCRETE,
  Tex.BRICK,
  Tex.PANEL,
  Tex.TILE_W,
  Tex.METAL,
  Tex.ROTTEN,
  Tex.PIPE,
  Tex.MEAT,
  Tex.GUT,
  Tex.VOID_WALL,
]);

const PROTECTED_WALL_TEX = new Set<number>([
  Tex.HERMO_WALL,
  Tex.LIFT_DOOR,
  Tex.PORTAL,
  Tex.CROSS,
  Tex.ICON,
  Tex.MARBLE,
]);

interface NeighborFloorInfo {
  floorTex: Tex;
  roomId: number;
  zoneId: number;
}

interface BreachCandidate {
  idx: number;
  x: number;
  y: number;
  d2: number;
  kind: 'door' | 'wall';
}

export interface BreachChargeResult {
  changedCells: number;
  breachedDoors: number;
  breachedWalls: number;
  breachedBiomass: number;
  protectedBlocked: number;
}

function isProtectedCell(world: World, idx: number): boolean {
  return world.aptMask[idx] !== 0 ||
    world.hermoWall[idx] !== 0 ||
    PROTECTED_WALL_TEX.has(world.wallTex[idx]);
}

function isHermeticDoor(world: World, idx: number): boolean {
  const door = world.doors.get(idx);
  return door?.state === DoorState.HERMETIC_CLOSED || door?.state === DoorState.HERMETIC_OPEN;
}

function isBiomassTex(tex: number): boolean {
  return tex === Tex.MEAT || tex === Tex.GUT || tex === Tex.ROTTEN;
}

function neighborFloorInfo(world: World, x: number, y: number): NeighborFloorInfo | undefined {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const [dx, dy] of dirs) {
    const ni = world.idx(x + dx, y + dy);
    const cell = world.cells[ni];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    return {
      floorTex: world.floorTex[ni] as Tex || Tex.F_CONCRETE,
      roomId: world.roomMap[ni] ?? -1,
      zoneId: world.zoneMap[ni] ?? -1,
    };
  }
  return undefined;
}

function applyFloorOpening(world: World, candidate: BreachCandidate, info: NeighborFloorInfo): void {
  const idx = candidate.idx;
  world.cells[idx] = Cell.FLOOR;
  world.floorTex[idx] = info.floorTex;
  world.wallTex[idx] = 0;
  world.roomMap[idx] = info.roomId;
  world.zoneMap[idx] = info.zoneId;
  world.setFeatureAt(idx, Feature.NONE, true);
  if (world.surfaceMap.delete(idx)) world.markSurfaceDirty();
}

function collectBreachCandidates(world: World, x: number, y: number, radius: number): BreachCandidate[] {
  const out: BreachCandidate[] = [];
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const r = Math.max(0.5, Math.min(6, radius));
  const ri = Math.ceil(r);
  const r2 = r * r;
  for (let oy = -ri; oy <= ri; oy++) {
    for (let ox = -ri; ox <= ri; ox++) {
      const tx = world.wrap(cx + ox);
      const ty = world.wrap(cy + oy);
      const dx = world.delta(x, tx + 0.5);
      const dy = world.delta(y, ty + 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const idx = ty * W + tx;
      const cell = world.cells[idx];
      if (cell === Cell.DOOR) out.push({ idx, x: tx, y: ty, d2, kind: 'door' });
      else if (cell === Cell.WALL) out.push({ idx, x: tx, y: ty, d2, kind: 'wall' });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'door' ? -1 : 1;
    return a.d2 - b.d2;
  });
  return out;
}

function publishBreachEvent(
  world: World,
  state: GameState | undefined,
  actor: Entity | undefined,
  x: number,
  y: number,
  radius: number,
  result: BreachChargeResult,
): void {
  if (!state) return;
  const centerIdx = world.idx(Math.floor(x), Math.floor(y));
  const roomId = world.roomMap[centerIdx] ?? -1;
  const item = ITEMS[BREACH_CHARGE_ID];
  const changed = result.changedCells > 0;
  publishEvent(state, {
    type: 'collateral_damage',
    zoneId: world.zoneMap[centerIdx],
    roomId: roomId >= 0 ? roomId : undefined,
    x,
    y,
    actorId: actor?.id,
    actorName: actor?.name,
    actorFaction: actor?.faction,
    itemId: BREACH_CHARGE_ID,
    itemName: item?.name ?? 'Пробивной заряд',
    itemCount: 1,
    itemValue: item?.value ?? 0,
    targetName: changed ? 'Пробитый проход' : 'Защищенная преграда',
    severity: changed ? 4 : 3,
    privacy: 'local',
    tags: [
      isPlayerEntity(actor) ? 'player' : 'actor',
      'breach_charge',
      'breach',
      'explosive',
      'collateral',
      changed ? 'opened' : 'blocked',
      result.breachedBiomass > 0 ? 'biomass' : 'concrete',
    ],
    data: {
      weaponId: BREACH_CHARGE_ID,
      changedCells: result.changedCells,
      breachedDoors: result.breachedDoors,
      breachedWalls: result.breachedWalls,
      breachedBiomass: result.breachedBiomass,
      protectedBlocked: result.protectedBlocked,
      radius: Math.round(radius * 10) / 10,
    },
  });
}

export function resolveBreachChargeExplosion(
  world: World,
  state: GameState | undefined,
  actor: Entity | undefined,
  weaponId: string | undefined,
  x: number,
  y: number,
  radius: number,
): BreachChargeResult {
  const result: BreachChargeResult = {
    changedCells: 0,
    breachedDoors: 0,
    breachedWalls: 0,
    breachedBiomass: 0,
    protectedBlocked: 0,
  };
  if (weaponId !== BREACH_CHARGE_ID) return result;
  const changedCellIndices: number[] = [];

  for (const candidate of collectBreachCandidates(world, x, y, radius)) {
    if (candidate.kind === 'door') {
      if (result.breachedDoors >= MAX_BREACHED_DOORS) continue;
      if (isProtectedCell(world, candidate.idx) || isHermeticDoor(world, candidate.idx)) {
        result.protectedBlocked++;
        continue;
      }
      const info = neighborFloorInfo(world, candidate.x, candidate.y);
      if (!info) continue;
      if (world.removeDoorAt(candidate.idx)) {
        applyFloorOpening(world, candidate, info);
        changedCellIndices.push(candidate.idx);
        result.breachedDoors++;
        result.changedCells++;
      }
      continue;
    }

    if (result.breachedWalls >= MAX_BREACHED_WALLS) continue;
    if (isProtectedCell(world, candidate.idx)) {
      result.protectedBlocked++;
      continue;
    }
    const wallTex = world.wallTex[candidate.idx];
    if (!BREACHABLE_WALL_TEX.has(wallTex)) continue;
    const info = neighborFloorInfo(world, candidate.x, candidate.y);
    if (!info) continue;
    applyFloorOpening(world, candidate, info);
    changedCellIndices.push(candidate.idx);
    result.breachedWalls++;
    result.changedCells++;
    if (isBiomassTex(wallTex)) result.breachedBiomass++;
  }

  if (result.changedCells > 0) {
    rebuildPathBlockersFromWorldObjects(world, undefined, changedCellIndices);
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty();
    spawnBreachDust(world, x, y, radius, result.changedCells, result.breachedBiomass > 0);
  }
  publishBreachEvent(world, state, actor, x, y, radius, result);
  return result;
}
