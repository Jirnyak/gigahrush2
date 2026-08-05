/* -- Procedural 2D structure families for route floors ------------ */

import {
  W,
  Cell,
  Feature,
  Tex,
  type Room,
} from '../core/types';
import { World } from '../core/world';
import type { FloorAnomalyId, FloorGeometryId, ProceduralFloorSpec } from '../data/procedural_floors';
import { registerRouteCue } from '../systems/route_cues';
import { generateGrowingTreeMaze } from './maze_graph';

export type ProceduralStructureFamily =
  | 'none'
  | 'cellular_braid'
  | 'prime_xor_registry'
  | 'braided_maintenance_maze'
  | 'factory_islands';

export interface ProceduralStructureResult {
  family: ProceduralStructureFamily;
  carvedCells: number;
}

const GEOMETRY_STRUCTURE_FAMILY: Readonly<Partial<Record<FloorGeometryId, ProceduralStructureFamily>>> = {
  communal_knots: 'cellular_braid',
  admin_pockets: 'prime_xor_registry',
  service_spines: 'braided_maintenance_maze',
  attic_weatherworks: 'braided_maintenance_maze',
  workshops: 'factory_islands',
};

const GEOMETRY_OWNING_ANOMALIES: ReadonlySet<FloorAnomalyId> = new Set([
  'bad_apple_world',
  'conway_life',
  'fractal_floor',
  'rail_trains',
  'sandpile_perekrytie',
  'section_shift',
  'wall_snake',
]);

function hash01(seed: number, x: number, y: number, salt: number): number {
  let h = seed ^ Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x632b, 0xc2b2ae35) ^ Math.imul(salt + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function seededRand(seed: number): () => number {
  let x = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

function isPrimeSmall(value: number): boolean {
  const n = Math.abs(Math.floor(value));
  if (n < 2) return false;
  if (n === 2 || n === 3) return true;
  if ((n & 1) === 0 || n % 3 === 0) return false;
  for (let d = 5; d * d <= n; d += 6) {
    if (n % d === 0 || n % (d + 2) === 0) return false;
  }
  return true;
}

function mutableStructureCell(world: World, ci: number): boolean {
  if (world.cells[ci] === Cell.LIFT || world.cells[ci] === Cell.DOOR) return false;
  if (world.cells[ci] === Cell.WATER || world.cells[ci] === Cell.ABYSS) return false;
  if (world.hermoWall[ci] || world.aptMask[ci] || world.containerMap.has(ci)) return false;
  if (world.features[ci] === Feature.LIFT_BUTTON) return false;
  return true;
}

function carveStructureCell(
  world: World,
  x: number,
  y: number,
  floorTex: Tex,
  wallTex: Tex,
  fog: number,
  samples: number[],
): number {
  const ci = world.idx(x, y);
  if (!mutableStructureCell(world, ci)) return 0;
  if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] >= 0) return 0;
  const changed = world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== -1 || world.floorTex[ci] !== floorTex;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = -1;
  world.floorTex[ci] = floorTex;
  world.wallTex[ci] = wallTex;
  world.fog[ci] = Math.min(world.fog[ci], fog);
  if (world.features[ci] !== Feature.LIFT_BUTTON && world.features[ci] !== Feature.SCREEN) world.features[ci] = Feature.NONE;
  if (changed && samples.length < 512 && (samples.length % 5 === 0 || hash01(ci, x, y, 0x51) > 0.76)) samples.push(ci);
  return changed ? 1 : 0;
}

function setStructureObstacle(world: World, x: number, y: number, wallTex: Tex): number {
  const ci = world.idx(x, y);
  if (!mutableStructureCell(world, ci)) return 0;
  if (world.roomMap[ci] >= 0 || world.cells[ci] !== Cell.FLOOR) return 0;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = wallTex;
  world.features[ci] = Feature.NONE;
  world.removeDoorAt(ci);
  return 1;
}

function carveStructureRect(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number,
  floorTex: Tex,
  wallTex: Tex,
  fog: number,
  samples: number[],
): number {
  let carved = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      carved += carveStructureCell(world, x + dx, y + dy, floorTex, wallTex, fog, samples);
    }
  }
  return carved;
}

function carveStructureLine(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  floorTex: Tex,
  wallTex: Tex,
  fog: number,
  samples: number[],
): number {
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  let carved = 0;
  for (let step = 0; step <= steps; step++) {
    const x = world.wrap(Math.round(ax + dx * step / steps));
    const y = world.wrap(Math.round(ay + dy * step / steps));
    for (let side = -width; side <= width; side++) {
      carved += carveStructureCell(world, x + side, y, floorTex, wallTex, fog, samples);
      if (side !== 0) carved += carveStructureCell(world, x, y + side, floorTex, wallTex, fog, samples);
    }
  }
  return carved;
}

function caNeighborCount(cells: Uint8Array, size: number, x: number, y: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + size) % size;
      const ny = (y + dy + size) % size;
      count += cells[ny * size + nx];
    }
  }
  return count;
}

function simulateCellularBraid(seed: number, size: number, density: number, generations: number): Uint8Array {
  let current = new Uint8Array(size * size);
  let next = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = (x + seed) % 11 === 0 || (y + (seed >>> 5)) % 13 === 0 ? 0.08 : 0;
      current[y * size + x] = hash01(seed, x, y, 0xca11) < density + stripe ? 1 : 0;
    }
  }
  for (let g = 0; g < generations; g++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const n = caNeighborCount(current, size, x, y);
        next[i] = current[i] ? (n >= 2 && n <= 5 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    const tmp = current;
    current = next;
    next = tmp;
  }
  return current;
}

function stampCellularBraid(world: World, spec: ProceduralFloorSpec, samples: number[]): number {
  const size = 64 + ((spec.seed >>> 4) % 4) * 8;
  const cell = Math.max(8, Math.floor(W / size));
  const conveyorBonus = spec.anomalyId === 'conveyor_sorter' ? 0.03 : 0;
  const cells = simulateCellularBraid(spec.seed ^ 0xcebada, size, 0.32 + spec.danger * 0.015 + conveyorBonus, 5 + (spec.seed & 3));
  let carved = 0;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      if (!cells[gy * size + gx]) continue;
      const x = world.wrap(Math.floor(gx * W / size + cell * 0.33));
      const y = world.wrap(Math.floor(gy * W / size + cell * 0.33));
      carved += carveStructureRect(world, x, y, Math.max(2, Math.floor(cell * 0.42)), Math.max(2, Math.floor(cell * 0.42)), Tex.F_LINO, Tex.BRICK, 3, samples);
      const right = cells[gy * size + ((gx + 1) % size)];
      const down = cells[((gy + 1) % size) * size + gx];
      if (right) carved += carveStructureLine(world, x, y, world.wrap(x + cell), y, 0, Tex.F_LINO, Tex.BRICK, 3, samples);
      if (down) carved += carveStructureLine(world, x, y, x, world.wrap(y + cell), 0, Tex.F_LINO, Tex.BRICK, 3, samples);
    }
  }
  return carved;
}

function stampPrimeXorRegistry(world: World, spec: ProceduralFloorSpec, samples: number[]): number {
  const grid = 24;
  const step = Math.floor(W / grid);
  const saltX = spec.seed & 255;
  const saltY = (spec.seed >>> 8) & 255;
  const hubs: { x: number; y: number; gx: number; gy: number; value: number }[] = [];
  let carved = 0;
  for (let gy = 1; gy < grid - 1; gy++) {
    for (let gx = 1; gx < grid - 1; gx++) {
      const value = Math.abs(((gx + saltX) ^ (gy + saltY)) + gx * 31 - gy * 17);
      if (!isPrimeSmall(value)) continue;
      if (hash01(spec.seed, gx, gy, 0xad11) > 0.68) continue;
      const x = world.wrap(gx * step + 5 + ((value + spec.ordinal) % Math.max(1, step - 10)));
      const y = world.wrap(gy * step + 5 + ((value >>> 3) % Math.max(1, step - 10)));
      const w = 18 + (value % 5) * 4;
      const h = 14 + ((value >>> 3) % 5) * 3;
      carved += carveStructureRect(world, x - (w >> 1), y - (h >> 1), w, h, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples);
      hubs.push({ x, y, gx, gy, value });

      const alcoveCount = 2 + (value % 3);
      for (let k = 0; k < alcoveCount; k++) {
        const side = (value + k * 5) & 3;
        const aw = 5 + ((value >>> (k + 1)) % 6);
        const ah = 4 + ((value >>> (k + 3)) % 5);
        const offset = -Math.floor((side < 2 ? h : w) / 2) + 2 + ((value + k * 11) % Math.max(3, (side < 2 ? h : w) - 4));
        const ax = side === 2
          ? x - (w >> 1) - aw
          : side === 3
            ? x + (w >> 1)
            : x + offset;
        const ay = side === 0
          ? y - (h >> 1) - ah
          : side === 1
            ? y + (h >> 1)
            : y + offset;
        carved += carveStructureRect(world, ax, ay, aw, ah, Tex.F_PARQUET, Tex.MARBLE, 2, samples);
      }

      const stackSpacing = 5 + (value % 4);
      const horizontalStacks = (value & 1) === 0;
      for (let offset = -Math.floor((horizontalStacks ? h : w) / 2) + 3; offset <= Math.floor((horizontalStacks ? h : w) / 2) - 3; offset += stackSpacing) {
        for (let run = -Math.floor((horizontalStacks ? w : h) / 2) + 4; run <= Math.floor((horizontalStacks ? w : h) / 2) - 4; run++) {
          if ((run + value) % 9 === 0) continue;
          const ox = horizontalStacks ? x + run : x + offset;
          const oy = horizontalStacks ? y + offset : y + run;
          carved += setStructureObstacle(world, ox, oy, Tex.MARBLE);
        }
      }

      const desk = world.idx(x, y);
      if (world.cells[desk] === Cell.FLOOR && world.features[desk] === Feature.NONE) {
        world.features[desk] = (value & 7) === 1 ? Feature.SCREEN : Feature.DESK;
      }
      if (world.cells[desk] === Cell.FLOOR && samples.length < 512) samples.push(desk);
    }
  }

  const sorted = hubs.slice().sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  for (let i = 0; i < sorted.length; i++) {
    const hub = sorted[i];
    let right: typeof hub | undefined;
    let down: typeof hub | undefined;
    for (let j = i + 1; j < sorted.length; j++) {
      const other = sorted[j];
      if (!right && other.gy === hub.gy && other.gx > hub.gx && other.gx - hub.gx <= 4) right = other;
      if (!down && other.gx === hub.gx && other.gy > hub.gy && other.gy - hub.gy <= 4) down = other;
      if (right && down) break;
      if (other.gy - hub.gy > 4) break;
    }
    if (right) carved += carveStructureLine(world, hub.x, hub.y, right.x, right.y, 1, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples);
    if (down) carved += carveStructureLine(world, hub.x, hub.y, down.x, down.y, 1, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples);
  }

  const railCount = 6 + spec.danger;
  for (let i = 0; i < railCount; i++) {
    const horizontal = (i & 1) === 0;
    const a = hubs[(spec.seed + i * 11) % Math.max(1, hubs.length)];
    const b = hubs[(spec.seed + i * 17 + Math.floor(hubs.length / 2)) % Math.max(1, hubs.length)];
    if (!a || !b || a === b) continue;
    carved += horizontal
      ? carveStructureLine(world, a.x, a.y, b.x, a.y, 1, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples)
      : carveStructureLine(world, a.x, a.y, a.x, b.y, 1, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples);
    carved += horizontal
      ? carveStructureLine(world, b.x, a.y, b.x, b.y, 0, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples)
      : carveStructureLine(world, a.x, b.y, b.x, b.y, 0, Tex.F_MARBLE_TILE, Tex.MARBLE, 1, samples);
  }
  return carved;
}

function stampBraidedMaintenanceMaze(world: World, spec: ProceduralFloorSpec, spawnX: number, spawnY: number, samples: number[]): number {
  const width = 15 + (spec.seed % 5);
  const height = 13 + ((spec.seed >>> 3) % 5);
  const cellSize = Math.floor((W - 120) / Math.max(width, height));
  const graph = generateGrowingTreeMaze({
    width,
    height,
    originX: 60,
    originY: 60,
    cellSize,
    startGx: Math.max(0, Math.min(width - 1, Math.floor((spawnX - 60) / cellSize))),
    startGy: Math.max(0, Math.min(height - 1, Math.floor((spawnY - 60) / cellSize))),
    braidChance: 0.24 + spec.danger * 0.035,
    extraChordCount: 8 + spec.danger * 3,
    landmarkCount: 5 + spec.danger,
    selectionWeights: spec.geometryId === 'attic_weatherworks'
      ? { newest: 0.78, oldest: 0.1, random: 0.12 }
      : { newest: 0.46, oldest: 0.28, random: 0.26 },
    rand: seededRand(spec.seed ^ 0xbad1ab),
  });
  let carved = 0;
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    const widthCells = edge.tag === 'chord' ? 0 : spec.geometryId === 'service_spines' ? 1 : 0;
    carved += carveStructureLine(world, a.x, a.y, b.x, b.y, widthCells, Tex.F_CONCRETE, spec.geometryId === 'attic_weatherworks' ? Tex.PIPE : Tex.METAL, 4, samples);
  }
  for (const node of graph.nodes) {
    if (node.degree < 3 && !graph.landmarkIds.includes(node.id)) continue;
    carved += carveStructureRect(world, node.x - 2, node.y - 2, 5, 5, Tex.F_CONCRETE, spec.geometryId === 'attic_weatherworks' ? Tex.PIPE : Tex.METAL, 3, samples);
    const ci = world.idx(node.x, node.y);
    if (world.cells[ci] === Cell.FLOOR && world.features[ci] === Feature.NONE) world.features[ci] = node.degree >= 3 ? Feature.APPARATUS : Feature.LAMP;
  }
  return carved;
}

function stampFactoryIslands(world: World, spec: ProceduralFloorSpec, samples: number[]): number {
  const rand = seededRand(spec.seed ^ 0xfa770);
  const slabCount = 5 + Math.floor(spec.danger / 2);
  let carved = 0;
  for (let i = 0; i < slabCount; i++) {
    const w = 64 + Math.floor(rand() * 62);
    const h = 38 + Math.floor(rand() * 46);
    const x = 42 + Math.floor(rand() * (W - 84 - w));
    const y = 42 + Math.floor(rand() * (W - 84 - h));
    carved += carveStructureRect(world, x, y, w, h, Tex.F_CONCRETE, Tex.METAL, 2, samples);
    const islandCount = 3 + ((spec.seed + i) % 4);
    for (let k = 0; k < islandCount; k++) {
      const iw = 6 + Math.floor(rand() * 12);
      const ih = 4 + Math.floor(rand() * 9);
      const ix = x + 4 + Math.floor(rand() * Math.max(1, w - iw - 8));
      const iy = y + 4 + Math.floor(rand() * Math.max(1, h - ih - 8));
      for (let dy = 0; dy < ih; dy++) {
        for (let dx = 0; dx < iw; dx++) carved += setStructureObstacle(world, ix + dx, iy + dy, Tex.METAL);
      }
      const ci = world.idx(ix + Math.floor(iw / 2), iy + Math.floor(ih / 2));
      if (world.cells[ci] === Cell.WALL) world.features[ci] = Feature.MACHINE;
    }
  }
  return carved;
}

export function proceduralStructureFamilyForSpec(spec: ProceduralFloorSpec): ProceduralStructureFamily {
  if (spec.anomalyId === 'rail_trains' && spec.geometryId === 'admin_pockets') {
    return GEOMETRY_STRUCTURE_FAMILY[spec.geometryId] ?? 'none';
  }
  if (GEOMETRY_OWNING_ANOMALIES.has(spec.anomalyId)) return 'none';
  return GEOMETRY_STRUCTURE_FAMILY[spec.geometryId] ?? 'none';
}

function chooseStructureCueRoom(world: World, rooms: readonly Room[]): Room | undefined {
  let best: Room | undefined;
  let bestD2 = Infinity;
  for (const room of rooms) {
    const sx = room.x + Math.floor(room.w / 2);
    const sy = room.y + Math.floor(room.h / 2);
    const d2 = world.dist2(W / 2, W / 2, sx + 0.5, sy + 0.5);
    if (
      !best ||
      d2 < bestD2 ||
      (d2 === bestD2 && (
        room.x < best.x ||
        (room.x === best.x && room.y < best.y) ||
        (room.x === best.x && room.y === best.y && room.w < best.w) ||
        (room.x === best.x && room.y === best.y && room.w === best.w && room.h < best.h) ||
        (room.x === best.x && room.y === best.y && room.w === best.w && room.h === best.h && room.type < best.type)
      ))
    ) {
      best = room;
      bestD2 = d2;
    }
  }
  return best;
}

function registerStructureCue(
  world: World,
  rooms: readonly Room[],
  spec: ProceduralFloorSpec,
  family: ProceduralStructureFamily,
  samples: readonly number[],
): void {
  if (family === 'none' || samples.length === 0) return;
  const sourceRoom = chooseStructureCueRoom(world, rooms);
  const sx = sourceRoom ? sourceRoom.x + Math.floor(sourceRoom.w / 2) : W / 2;
  const sy = sourceRoom ? sourceRoom.y + Math.floor(sourceRoom.h / 2) : W / 2;
  let target = samples[0];
  let best = -1;
  for (const ci of samples) {
    const d2 = world.dist2(sx + 0.5, sy + 0.5, (ci % W) + 0.5, ((ci / W) | 0) + 0.5);
    if (d2 > best) {
      best = d2;
      target = ci;
    }
  }
  const labels: Record<Exclude<ProceduralStructureFamily, 'none'>, { label: string; hint: string; target: string; color: string }> = {
    cellular_braid: {
      label: 'клеточная вязь',
      hint: 'план этажа пророс клеточным лабиринтом, а не прямым коридором',
      target: 'дальняя жилая вязь',
      color: '#b9d889',
    },
    prime_xor_registry: {
      label: 'простая картотека',
      hint: 'координаты прошиты простыми числами; карманы идут не сеткой, а шифром',
      target: 'дальний простой карман',
      color: '#d7c899',
    },
    braided_maintenance_maze: {
      label: 'плетеный сервисный лабиринт',
      hint: 'магистрали идут узлами, тупиками и хордами, а не одной кишкой',
      target: 'дальний сервисный узел',
      color: '#9ec8d8',
    },
    factory_islands: {
      label: 'цеховые острова',
      hint: 'широкие пролеты и станочные острова ломают обычную комнатную нарезку',
      target: 'дальний цеховой остров',
      color: '#d4a55f',
    },
  };
  const copy = labels[family];
  registerRouteCue(world, {
    id: `procedural_${spec.key}_structure_${family}`,
    x: sx + 0.5,
    y: sy + 0.5,
    targetX: (target % W) + 0.5,
    targetY: ((target / W) | 0) + 0.5,
    floor: spec.baseFloor,
    roomId: sourceRoom?.id,
    zoneId: world.zoneMap[world.idx(sx, sy)],
    label: copy.label,
    hint: copy.hint,
    targetName: copy.target,
    color: copy.color,
    tags: ['procedural_floor', 'structure_library', family, spec.geometryId, spec.anomalyId],
    toneSeed: (spec.seed ^ family.length * 0x9e37) >>> 0,
    radius: 12,
    targetRadius: 5,
    cooldownSec: 50,
    heardText: `${copy.label}: этот этаж собран другим алгоритмом, маршрут читается по крупной структуре.`,
    followedText: `${copy.target}: макрогеометрия отличается от соседних этажей.`,
    ignoredText: `${copy.label}: необычная структура осталась на карте сбоку.`,
  });
}

export function applyProceduralStructureLibrary(
  world: World,
  rooms: readonly Room[],
  spec: ProceduralFloorSpec,
  spawnX: number,
  spawnY: number,
): ProceduralStructureResult {
  const family = proceduralStructureFamilyForSpec(spec);
  if (family === 'none') return { family, carvedCells: 0 };
  const samples: number[] = [];
  let carvedCells = 0;
  if (family === 'cellular_braid') carvedCells = stampCellularBraid(world, spec, samples);
  else if (family === 'prime_xor_registry') carvedCells = stampPrimeXorRegistry(world, spec, samples);
  else if (family === 'braided_maintenance_maze') carvedCells = stampBraidedMaintenanceMaze(world, spec, spawnX, spawnY, samples);
  else if (family === 'factory_islands') carvedCells = stampFactoryIslands(world, spec, samples);
  if (samples.length === 0 && rooms.length > 0) {
    const room = rooms[Math.min(rooms.length - 1, Math.max(0, Math.floor(rooms.length * 0.67)))];
    samples.push(world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2)));
  }
  if (samples.length > 0) {
    registerStructureCue(world, rooms, spec, family, samples);
  }
  if (carvedCells > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
    world.markFogDirty();
  }
  return { family, carvedCells };
}
