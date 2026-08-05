/* ── Kvartiry floor generator (Floor -1) — КВАРТИРЫ ──────────── */
/*   Dense residential maze with wall_l=4 grid pattern.           */
/*   Data-driven crowd profile: larger resident/wild/response caps. */
/*   Whole-floor natural resident field — eternal riots.          */
/*   Uprising mechanic: civilians rally → become WILD.            */
/*   Rooms by zone: living, kitchen, smoking, bathroom, etc.      */

import {
  W, Cell, Tex, RoomType, Feature, LiftDirection, DoorState,
  Faction, Occupation,
  type Room, type Entity,
  EntityType, AIGoal, FloorLevel, type GameState,
} from '../../core/types';
import { World } from '../../core/world';
import { rng, placeLifts, generateZones, ensureConnectivity } from '../shared';
import { placeProceduralScreens } from '../procedural_screens';
import { randomName, freshNeeds } from '../../data/catalog';
import { KVARTIRY_POPULATION_PROFILE, type NpcPopulationProfile } from '../../data/population_profiles';
import { activeActorCountAtDefaultSoftLimit } from '../../data/entity_limits';
import { territorySharesForStoryFloor } from '../../data/floor_territory';
import { sampleNaturalPopulationCells } from '../population_placement';
import { registerContentRuntimeHook } from '../../systems/content_hooks';
import { initializeCellTerritory } from '../../systems/territory';
import { calcZoneLevel, randomRPG, gaussianLevel, getMaxHp } from '../../systems/rpg';
import { entitySpawnSlots } from '../../systems/entity_limits';
import { Spr } from '../../render/sprite_index';
import { randomOccupation } from '../../data/relations';
import { buildKvartirySocialMacroGraph } from './social_macro_graph';
import {
  resetKvartiryContentState,
  publishKvartiryContentUprising,
  runKvartiryPermanentContent,
  spawnKvartiryNamedNpcs,
  tryKvartiryContentUprising,
} from './content_manifest';

/* ── Constants ────────────────────────────────────────────────── */
const WALL_L = 4;  // grid spacing for wall sources
const KV_POPULATION = KVARTIRY_POPULATION_PROFILE;
const CITIZEN_PROFILE = KV_POPULATION.citizens;
const WILD_PROFILE = KV_POPULATION.wild;
const LIQUIDATOR_PROFILE = KV_POPULATION.liquidators;
const UPRISING_CHECK_INTERVAL = KV_POPULATION.uprising.intervalSec;
const UPRISING_RADIUS = KV_POPULATION.uprising.radius;
const LIQUIDATOR_RESPONSE_RADIUS = KV_POPULATION.uprising.responseRadius;
const AMBIENT_UPRISING_CHANCE = KV_POPULATION.uprising.ambientChance;
const AMBIENT_UPRISING_MIN_CITIZENS = KV_POPULATION.uprising.minCitizens;
const AMBIENT_UPRISING_MAX_CONVERTED = KV_POPULATION.uprising.maxConverted;
const AMBIENT_UPRISING_MAX_RESPONDERS = KV_POPULATION.uprising.maxResponders;
const KV_SEGMENT_DOOR_CANDIDATE_CHANCE = 1;
const KV_CONNECTOR_DOOR_OPEN_CHANCE = 0.10;
const KV_DOOR_LINK_DX = [1, -1, 0, 0] as const;
const KV_DOOR_LINK_DY = [0, 0, 1, -1] as const;

let kvUprisingAccum = 0;

/* ── Room type definitions for kvartiry floor ─────────────────── */
const KV_ROOM_TYPES: { type: RoomType; name: string; weight: number }[] = [
  { type: RoomType.LIVING,     name: 'Комната с матрасом', weight: 30 },
  { type: RoomType.KITCHEN,    name: 'Общая кухня',        weight: 20 },
  { type: RoomType.BATHROOM,   name: 'Мокрый санузел',     weight: 12 },
  { type: RoomType.SMOKING,    name: 'Курилка у шахты',    weight: 10 },
  { type: RoomType.STORAGE,    name: 'Кладовка с пайками', weight: 10 },
  { type: RoomType.COMMON,     name: 'Зал очереди',        weight: 8 },
  { type: RoomType.CORRIDOR,   name: 'Проходной коридор',  weight: 5 },
  { type: RoomType.OFFICE,     name: 'Стол учёта',         weight: 5 },
];

let lastPickedIdx = -1;
function pickKvRoomType(): { type: RoomType; name: string } {
  // Avoid picking the same type twice in a row
  let total = 0;
  for (let i = 0; i < KV_ROOM_TYPES.length; i++) {
    if (i === lastPickedIdx) continue;
    total += KV_ROOM_TYPES[i].weight;
  }
  let roll = Math.random() * total;
  for (let i = 0; i < KV_ROOM_TYPES.length; i++) {
    if (i === lastPickedIdx) continue;
    roll -= KV_ROOM_TYPES[i].weight;
    if (roll <= 0) {
      lastPickedIdx = i;
      return { type: KV_ROOM_TYPES[i].type, name: KV_ROOM_TYPES[i].name };
    }
  }
  lastPickedIdx = 0;
  return KV_ROOM_TYPES[0];
}

/* ── Room wall/floor textures by type ─────────────────────────── */
function roomTextures(type: RoomType): { wall: Tex; floor: Tex } {
  switch (type) {
    case RoomType.LIVING:     return { wall: Tex.PANEL,    floor: Tex.F_WOOD };
    case RoomType.KITCHEN:    return { wall: Tex.TILE_W,   floor: Tex.F_LINO };
    case RoomType.BATHROOM:   return { wall: Tex.TILE_W,   floor: Tex.F_TILE };
    case RoomType.STORAGE:    return { wall: Tex.CONCRETE, floor: Tex.F_CONCRETE };
    case RoomType.COMMON:     return { wall: Tex.PANEL,    floor: Tex.F_CARPET };
    case RoomType.SMOKING:    return { wall: Tex.CONCRETE, floor: Tex.F_CONCRETE };
    case RoomType.CORRIDOR:   return { wall: Tex.CONCRETE, floor: Tex.F_LINO };
    case RoomType.OFFICE:     return { wall: Tex.PANEL,    floor: Tex.F_LINO };
    default:                  return { wall: Tex.PANEL,    floor: Tex.F_WOOD };
  }
}

/* ── Room features by type ────────────────────────────────────── */
function placeRoomFeatures(world: World, room: Room): void {
  const feats: Feature[] = [];
  switch (room.type) {
    case RoomType.LIVING:   feats.push(Feature.BED, Feature.TABLE, Feature.LAMP, Feature.SHELF); break;
    case RoomType.KITCHEN:  feats.push(Feature.STOVE, Feature.SINK, Feature.TABLE, Feature.LAMP); break;
    case RoomType.BATHROOM: feats.push(Feature.TOILET, Feature.SINK); break;
    case RoomType.SMOKING:  feats.push(Feature.CHAIR, Feature.LAMP); break;
    case RoomType.STORAGE:  feats.push(Feature.SHELF, Feature.SHELF); break;
    case RoomType.COMMON:   feats.push(Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.CHAIR); break;
    case RoomType.CORRIDOR: feats.push(Feature.LAMP); break;
    case RoomType.OFFICE:   feats.push(Feature.TABLE, Feature.CHAIR, Feature.LAMP); break;
  }
  for (const f of feats) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const fx = room.x + rng(1, Math.max(1, room.w - 2));
      const fy = room.y + rng(1, Math.max(1, room.h - 2));
      const fi = world.idx(fx, fy);
      if (world.cells[fi] === Cell.FLOOR && world.features[fi] === Feature.NONE) {
        world.features[fi] = f;
        break;
      }
    }
  }
}

function linkKvartiryDoorsToRooms(world: World): void {
  for (const [doorIdx, door] of world.doors) {
    const x = doorIdx % W;
    const y = (doorIdx / W) | 0;
    const adjacentRooms: number[] = [];
    for (let i = 0; i < KV_DOOR_LINK_DX.length; i++) {
      const roomId = world.roomMap[world.idx(x + KV_DOOR_LINK_DX[i], y + KV_DOOR_LINK_DY[i])];
      if (roomId < 0 || adjacentRooms.includes(roomId)) continue;
      adjacentRooms.push(roomId);
      const room = world.rooms[roomId];
      if (room && !room.doors.includes(doorIdx)) room.doors.push(doorIdx);
      if (adjacentRooms.length >= 2) break;
    }
    door.roomA = adjacentRooms[0] ?? -1;
    door.roomB = adjacentRooms[1] ?? -1;
  }
}

/* ── Weapon loadout ───────────────────────────────────────────── */
function npcWeapon(faction: Faction, occupation: Occupation): { weapon: string; inv: { defId: string; count: number }[] } {
  if (faction === Faction.LIQUIDATOR || occupation === Occupation.HUNTER) {
    const roll = Math.random();
    if (roll < 0.20) return { weapon: 'makarov', inv: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: rng(6, 16) }] };
    if (roll < 0.32) return { weapon: 'shotgun', inv: [{ defId: 'shotgun', count: 1 }, { defId: 'ammo_shells', count: rng(4, 8) }] };
    if (roll < 0.40) return { weapon: 'ppsh', inv: [{ defId: 'ppsh', count: 1 }, { defId: 'ammo_9mm', count: rng(20, 40) }] };
    if (roll < 0.55) return { weapon: 'axe', inv: [{ defId: 'axe', count: 1 }] };
    if (roll < 0.75) return { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] };
    return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  }
  if (faction === Faction.WILD) {
    const roll = Math.random();
    if (roll < 0.15) return { weapon: 'makarov', inv: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: rng(4, 10) }] };
    if (roll < 0.35) return { weapon: 'rebar', inv: [{ defId: 'rebar', count: 1 }] };
    if (roll < 0.55) return { weapon: 'pipe', inv: [{ defId: 'pipe', count: 1 }] };
    if (roll < 0.75) return { weapon: 'wrench', inv: [{ defId: 'wrench', count: 1 }] };
    return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  }
  if (Math.random() < 0.15) return { weapon: 'knife', inv: [{ defId: 'knife', count: 1 }] };
  return { weapon: '', inv: [] };
}

/* ── Spawn a single NPC on an exact floor cell ───────────────── */
function spawnNpcAtCell(
  world: World, entities: Entity[], nextId: { v: number },
  faction: Faction, occupation: Occupation,
  x: number, y: number,
): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR) return false;
  const zoneId = world.zoneMap[ci];
  const zoneLevel = world.zones[zoneId]?.level ?? 1;
  const npcLevel = gaussianLevel(zoneLevel, 2);
  const rpg = randomRPG(npcLevel);
  const maxHp = getMaxHp(rpg);
  const nm = randomName(faction);
  const loadout = npcWeapon(faction, occupation);
  entities.push({
    id: nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: occupation === Occupation.CHILD ? 0.8 : 1.2,
    sprite: occupation,
    spriteScale: occupation === Occupation.CHILD ? 0.6 : 1.0,
    name: nm.name, firstName: nm.firstName, lastName: nm.lastName, isFemale: nm.female,
    needs: freshNeeds(), hp: maxHp, maxHp,
    money: rng(5, 60),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: loadout.inv.map(i => ({ ...i })),
    weapon: loadout.weapon || undefined,
    faction, occupation,
    questId: -1, isTraveler: false,
    rpg,
  });
  return true;
}

function npcPopulationSeed(faction: Faction, nextId: number): number {
  return 1009 + faction * 10007 + nextId * 13;
}

function spawnNaturalNpcBatch(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  faction: Faction,
  profile: NpcPopulationProfile,
  count: number,
  fixedOccupation?: Occupation,
): number {
  const cells = sampleNaturalPopulationCells(world, count, profile, npcPopulationSeed(faction, nextId.v));
  let spawned = 0;
  for (const cell of cells) {
    const occ = fixedOccupation ?? randomOccupation(faction);
    if (spawnNpcAtCell(world, entities, nextId, faction, occ, cell % W, (cell / W) | 0)) spawned++;
  }
  return spawned;
}

function spawnNpcPopulationBatch(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  faction: Faction,
  profile: NpcPopulationProfile,
  count: number,
  fixedOccupation?: Occupation,
): number {
  const slots = entitySpawnSlots(entities, EntityType.NPC, count);
  if (slots <= 0) return 0;
  return spawnNaturalNpcBatch(world, entities, nextId, faction, profile, slots, fixedOccupation);
}

function seedNpcPopulation(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  faction: Faction,
  profile: NpcPopulationProfile,
  fixedOccupation?: Occupation,
): void {
  spawnNpcPopulationBatch(world, entities, nextId, faction, profile, activeActorCountAtDefaultSoftLimit(profile.initial), fixedOccupation);
}

/* ══════════════════════════════════════════════════════════════════
   Main generator — kvartiry dense residential maze
   Port of the C++ wall-grid generation algorithm.
   World starts as FLOOR; walls grow from a regular grid of sources.
   Each source grows exactly 2 wall segments, creating small rooms.
   ══════════════════════════════════════════════════════════════════ */
export function generateKvartiry(territorySeed = 0): { world: World; entities: Entity[]; spawnX: number; spawnY: number } {
  const world = new World();
  const entities: Entity[] = [];
  let nextId = 1;
  let nextRoomId = 0;
  lastPickedIdx = -1; // reset room type picker
  resetKvartiryContentState();

  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];

  // ── Phase 0: All cells start as FLOOR (empty space) ───────────
  for (let i = 0; i < W * W; i++) {
    world.cells[i] = Cell.FLOOR;
    world.wallTex[i] = Tex.PANEL;
    world.floorTex[i] = Tex.F_LINO;
  }

  // ── Phase 1: Place source grid points ─────────────────────────
  // Sources are on a regular WALL_L grid. They are marked via isSource
  // but kept as FLOOR so they don't interfere with wallSum checks.
  const sources: number[] = [];
  const isSource = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (x % WALL_L === 0 && y % WALL_L === 0) {
        const ci = world.idx(x, y);
        sources.push(ci);
        isSource[ci] = 1;
      }
    }
  }

  // ── Phase 2: Build walls from sources ─────────────────────────
  // Each source grows wall segments until it has 2+ WALL neighbors.
  // Doors are placed at the midpoint of each segment.
  const W_MASK = W - 1;
  let activeSources = [...sources];
  while (activeSources.length > 0) {
    const nextSources: number[] = [];
    for (const idx of activeSources) {
      const sx = idx % W;
      const sy = (idx / W) | 0;
      // Count WALL neighbors (sources don't count as WALL)
      let wallSum = 0;
      if (world.cells[((sy - 1) & W_MASK) * W + sx] === Cell.WALL) wallSum++;
      if (world.cells[sy * W + ((sx + 1) & W_MASK)] === Cell.WALL) wallSum++;
      if (world.cells[((sy + 1) & W_MASK) * W + sx] === Cell.WALL) wallSum++;
      if (world.cells[sy * W + ((sx - 1) & W_MASK)] === Cell.WALL) wallSum++;

      if (wallSum < 2) {
        let drop = rng(0, 3);
        // If chosen direction already has a wall, rotate
        const nx = (sx + DX[drop]) & W_MASK;
        const ny = (sy + DY[drop]) & W_MASK;
        const nCheck = ny * W + nx;
        if (world.cells[nCheck] === Cell.WALL) drop = (drop + 1) & 3;

        let cx = sx, cy = sy;
        for (let j = 0; j < WALL_L - 1; j++) {
          cx = (cx + DX[drop]) & W_MASK;
          cy = (cy + DY[drop]) & W_MASK;
          const ni = cy * W + cx;
          // Don't overwrite another source
          if (isSource[ni]) continue;
          if (j + 1 === Math.floor(WALL_L / 2) && Math.random() < KV_SEGMENT_DOOR_CANDIDATE_CHANCE) {
            world.cells[ni] = Cell.DOOR;
          } else {
            world.cells[ni] = Cell.WALL;
          }
        }
        nextSources.push(idx);
      }
    }
    activeSources = nextSources;
  }

  // Convert source positions to WALL
  for (const idx of sources) {
    world.cells[idx] = Cell.WALL;
  }

  // ── Phase 3: C++ door connectivity — flood-fill + open candidate doors ──
  // Candidate midpoint doors are barriers here. Connectivity opens a sparse
  // subset, then all unopened candidates collapse back into walls.
  let startCell = -1;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR) { startCell = i; break; }
  }

  if (startCell >= 0) {
    const visited = new Uint8Array(W * W);
    const queue: number[] = [startCell];
    visited[startCell] = 1;
    let head = 0;
    const candidates: number[] = [];

    const floodFloors = (): void => {
      while (head < queue.length) {
        const ci = queue[head++];
        const cx = ci % W, cy = (ci / W) | 0;
        for (let s = 0; s < 4; s++) {
          const ni = world.idx(world.wrap(cx + DX[s]), world.wrap(cy + DY[s]));
          if (visited[ni]) continue;
          if (world.cells[ni] === Cell.FLOOR) {
            visited[ni] = 1;
            queue.push(ni);
          }
        }
      }
    };

    const addConnectorCandidates = (): void => {
      candidates.length = 0;
      for (let i = 0; i < W * W; i++) {
        if (world.cells[i] !== Cell.DOOR) continue;
        const x = i % W, y = (i / W) | 0;

        let ax = x - 1; if (ax < 0) ax += W;
        let bx = x + 1; if (bx >= W) bx -= W;
        let ai = y * W + ax;
        let bi = y * W + bx;

        if (
          (visited[ai] && world.cells[bi] === Cell.FLOOR && !visited[bi]) ||
          (visited[bi] && world.cells[ai] === Cell.FLOOR && !visited[ai])
        ) {
          candidates.push(i);
          continue;
        }

        let ay = y - 1; if (ay < 0) ay += W;
        let by = y + 1; if (by >= W) by -= W;
        ai = ay * W + x;
        bi = by * W + x;

        if (
          (visited[ai] && world.cells[bi] === Cell.FLOOR && !visited[bi]) ||
          (visited[bi] && world.cells[ai] === Cell.FLOOR && !visited[ai])
        ) {
          candidates.push(i);
          continue;
        }
      }
    };

    floodFloors();
    while (true) {
      addConnectorCandidates();
      if (candidates.length === 0) break;
      let opened = 0;
      for (const idx of candidates) {
        if (Math.random() >= KV_CONNECTOR_DOOR_OPEN_CHANCE) continue;
        world.cells[idx] = Cell.FLOOR;
        visited[idx] = 1;
        queue.push(idx);
        opened++;
      }
      if (opened === 0) {
        const idx = candidates[rng(0, candidates.length - 1)];
        world.cells[idx] = Cell.FLOOR;
        visited[idx] = 1;
        queue.push(idx);
      }
      floodFloors();
    }

    // C++ cleanup: convert remaining candidate DOORs to WALL.
    for (let i = 0; i < W * W; i++) {
      if (world.cells[i] === Cell.DOOR) world.cells[i] = Cell.WALL;
    }
  }

  // ── Phase 4: Additional doors — FLOOR between opposite walls ──
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.FLOOR) continue;
    const x = i % W, y = (i / W) | 0;
    const northIdx = world.idx(x, world.wrap(y - 1));
    const southIdx = world.idx(x, world.wrap(y + 1));
    const eastIdx  = world.idx(world.wrap(x + 1), y);
    const westIdx  = world.idx(world.wrap(x - 1), y);
    const ns = world.cells[northIdx] === Cell.WALL && world.cells[southIdx] === Cell.WALL;
    const ew = world.cells[eastIdx] === Cell.WALL && world.cells[westIdx] === Cell.WALL;
    if (ns || ew) {
      world.cells[i] = Cell.DOOR;
    }
  }

  // Register all doors in world.doors map
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.DOOR) {
      world.doors.set(i, {
        idx: i,
        state: DoorState.CLOSED,
        roomA: -1,
        roomB: -1,
        keyId: '',
        timer: 0,
      });
      world.wallTex[i] = Tex.DOOR_WOOD;
    }
  }

  // ── Phase 5: Fill rooms (BFS flood-fill) ──────────────────────
  const roomZones = new Int32Array(W * W).fill(-1);
  let roomN = 0;

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.FLOOR || roomZones[i] >= 0) continue;
    const roomCells: number[] = [];
    roomZones[i] = roomN;
    const frontier = [i];
    let fHead = 0;
    while (fHead < frontier.length) {
      const ci = frontier[fHead++];
      roomCells.push(ci);
      const cx = ci % W, cy = (ci / W) | 0;
      for (let s = 0; s < 4; s++) {
        const ni = world.idx(world.wrap(cx + DX[s]), world.wrap(cy + DY[s]));
        if (world.cells[ni] === Cell.FLOOR && roomZones[ni] < 0) {
          roomZones[ni] = roomN;
          frontier.push(ni);
        }
      }
    }

    if (roomCells.length < 1) { roomN++; continue; }

    // Compute bounding box for room
    let minX = W, maxX = 0, minY = W, maxY = 0;
    for (const ci of roomCells) {
      const x = ci % W, y = (ci / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Assign a room type
    const rt = pickKvRoomType();
    const tex = roomTextures(rt.type);

    const room: Room = {
      id: nextRoomId++,
      type: rt.type,
      x: minX, y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      doors: [],
      sealed: false,
      name: rt.name,
      apartmentId: -1,
      wallTex: tex.wall,
      floorTex: tex.floor,
    };
    world.rooms.push(room);

    // Apply textures
    for (const ci of roomCells) {
      world.roomMap[ci] = room.id;
      world.floorTex[ci] = tex.floor;
    }
    // Set wall textures around room cells
    for (const ci of roomCells) {
      const cx = ci % W, cy = (ci / W) | 0;
      for (let s = 0; s < 4; s++) {
        const ni = world.idx(world.wrap(cx + DX[s]), world.wrap(cy + DY[s]));
        if (world.cells[ni] === Cell.WALL) world.wallTex[ni] = tex.wall;
      }
    }

    // Place features in rooms large enough
    if (roomCells.length >= 2) {
      placeRoomFeatures(world, room);
    }

    roomN++;
  }
  linkKvartiryDoorsToRooms(world);

  // ── Phase 6: Zones (64 macro-regions) ─────────────────────────
  generateZones(world);
  for (const z of world.zones) z.level = calcZoneLevel(z.cx, z.cy, FloorLevel.KVARTIRY);

  // ── Phase 6b: Ensure connectivity ─────────────────────────────
  const spawnCenterX = W / 2, spawnCenterY = W / 2;
  ensureConnectivity(world, spawnCenterX, spawnCenterY);

  // ── Phase 7: Lifts (BEFORE room assignment eats all floor cells) ──
  // placeLifts requires roomMap[ci] < 0, so we place them early and
  // clear roomMap around lifts to satisfy the check.
  // Actually we must clear roomMap for cells we want lifts on:
  // Reset roomMap to -1 for corridor-type rooms (to allow lift placement)
  for (let i = 0; i < W * W; i++) {
    const rid = world.roomMap[i];
    if (rid >= 0) {
      const room = world.rooms[rid];
      if (room && (room.type === RoomType.CORRIDOR || room.type === RoomType.COMMON)) {
        world.roomMap[i] = -1;
      }
    }
  }
  placeLifts(world, 16, LiftDirection.UP);    // up to жилая
  placeLifts(world, 16, LiftDirection.DOWN);  // down to министерство
  // Restore roomMap for cells that didn't become lifts
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR && world.roomMap[i] < 0) {
      // Re-find room by checking neighbors
      const ix = i % W, iy = (i / W) | 0;
      for (let s = 0; s < 4; s++) {
        const ni = world.idx(world.wrap(ix + DX[s]), world.wrap(iy + DY[s]));
        if (world.roomMap[ni] >= 0) {
          world.roomMap[i] = world.roomMap[ni];
          break;
        }
      }
    }
  }

  // ── Phase 8: Light map ────────────────────────────────────────
  world.bakeLights();

  // ── Phase 8b: Cell territory before population placement ─────
  initializeCellTerritory(world, {
    seed: territorySeed,
    targetShares: territorySharesForStoryFloor(FloorLevel.KVARTIRY),
  });

  // ── Phase 9: Spawn NPCs (whole-floor natural baseline)
  const nid = { v: nextId };
  seedNpcPopulation(world, entities, nid, Faction.CITIZEN, CITIZEN_PROFILE);
  seedNpcPopulation(world, entities, nid, Faction.WILD, WILD_PROFILE);
  seedNpcPopulation(world, entities, nid, Faction.LIQUIDATOR, LIQUIDATOR_PROFILE, Occupation.HUNTER);
  nextId = nid.v;

  // ── Phase 10: Spawn items (ballots scattered everywhere) ─────
  for (let i = 0; i < 500; i++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * W);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR) continue;
      entities.push({
        id: nextId++, type: EntityType.ITEM_DROP,
        x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
        alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId: 'ballot', count: rng(1, 3) }],
      });
      break;
    }
  }

  // ── Phase 11: Manifest-owned named NPCs ──────────────────────
  nextId = spawnKvartiryNamedNpcs(world, entities, nextId);

  // ── Phase 12: Find spawn point ────────────────────────────────
  let spawnX = W / 2 + 0.5, spawnY = W / 2 + 0.5;
  for (let r = 0; r < 50; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = world.idx(world.wrap(Math.floor(W / 2) + dx), world.wrap(Math.floor(W / 2) + dy));
        if (world.cells[ci] === Cell.FLOOR) {
          spawnX = world.wrap(Math.floor(W / 2) + dx) + 0.5;
          spawnY = world.wrap(Math.floor(W / 2) + dy) + 0.5;
          r = 999;
          break;
        }
      }
    }
  }

  // ── Phase 13: Manifest-owned permanent themed rooms ──────────
  nextId = runKvartiryPermanentContent(world, entities, nextId, spawnX, spawnY);
  ensureConnectivity(world, spawnX, spawnY);
  linkKvartiryDoorsToRooms(world);

  // ── Phase 13b: Generation-time social macro routes and debug domains
  buildKvartirySocialMacroGraph(world, spawnX, spawnY);

  // ── Phase 14: Rare procedural TVs/monitors on suitable room walls
  placeProceduralScreens(world, FloorLevel.KVARTIRY);

  return { world, entities, spawnX, spawnY };
}

/* ══════════════════════════════════════════════════════════════════
   Population pressure update — called every frame from main.ts.
   ══════════════════════════════════════════════════════════════════ */
export function resetKvPopulationState(): void {
  kvUprisingAccum = 0;
  resetKvartiryContentState();
}

export function updateKvPopulation(
  world: World, entities: Entity[], dt: number, state?: GameState,
): void {
  kvUprisingAccum += dt;

  // ── Uprising trigger ──────────────────────────────────────────
  if (kvUprisingAccum >= UPRISING_CHECK_INTERVAL) {
    kvUprisingAccum -= UPRISING_CHECK_INTERVAL;
    const pressureResult = tryKvartiryContentUprising(world, entities, UPRISING_CHECK_INTERVAL);
    if (pressureResult) {
      if (state) publishKvartiryContentUprising(state, pressureResult);
      return;
    }
    // Random background flare-up stays capped; POIs carry the readable unrest.
    if (Math.random() < AMBIENT_UPRISING_CHANCE) {
      triggerUprising(world, entities);
    }
  }
}

registerContentRuntimeHook({
  id: 'kvartiry_population_pressure',
  phases: ['floor_activity'],
  update(ctx) {
    if (ctx.state.currentFloor !== FloorLevel.KVARTIRY) return;
    updateKvPopulation(ctx.world, ctx.entities, ctx.dt, ctx.state);
  },
});

/* ── Uprising mechanic ────────────────────────────────────────── */
function triggerUprising(world: World, entities: Entity[]): void {
  // Pick a random living citizen as rally center
  let citizenCount = 0;
  let leader: Entity | null = null;
  for (const e of entities) {
    if (e.type !== EntityType.NPC || !e.alive || e.faction !== Faction.CITIZEN || e.plotNpcId) continue;
    citizenCount++;
    if (Math.random() < 1 / citizenCount) leader = e;
  }
  if (!leader || citizenCount < 50) return;
  const rallyX = leader.x, rallyY = leader.y;

  // Count a local cluster before mutating anyone.
  let ralliedCount = 0;
  const rallyR2 = UPRISING_RADIUS * UPRISING_RADIUS;
  for (const e of entities) {
    if (e.type !== EntityType.NPC || !e.alive || e.faction !== Faction.CITIZEN) continue;
    if (e.plotNpcId) continue; // don't convert plot NPCs
    if (world.dist2(e.x, e.y, rallyX, rallyY) <= rallyR2) ralliedCount++;
  }

  if (ralliedCount < AMBIENT_UPRISING_MIN_CITIZENS) return; // not enough for uprising

  // Convert only a small edge of the crowd so background unrest does not flood the floor.
  let converted = 0;
  for (const e of entities) {
    if (converted >= AMBIENT_UPRISING_MAX_CONVERTED) break;
    if (e.type !== EntityType.NPC || !e.alive || e.faction !== Faction.CITIZEN) continue;
    if (e.plotNpcId) continue;
    if (world.dist2(e.x, e.y, rallyX, rallyY) > rallyR2) continue;
    e.faction = Faction.WILD;
    if (e.ai) {
      e.ai.goal = AIGoal.GOTO;
      e.ai.tx = world.wrap(rallyX + (Math.random() - 0.5) * 10);
      e.ai.ty = world.wrap(rallyY + (Math.random() - 0.5) * 10);
    }
    converted++;
  }

  // Gather a bounded liquidator response within response radius.
  let responders = 0;
  const responseR2 = LIQUIDATOR_RESPONSE_RADIUS * LIQUIDATOR_RESPONSE_RADIUS;
  for (const e of entities) {
    if (responders >= AMBIENT_UPRISING_MAX_RESPONDERS) break;
    if (e.type !== EntityType.NPC || !e.alive || e.faction !== Faction.LIQUIDATOR) continue;
    if (world.dist2(e.x, e.y, rallyX, rallyY) > responseR2) continue;
    if (e.ai) {
      e.ai.goal = AIGoal.GOTO;
      e.ai.tx = world.wrap(rallyX + (Math.random() - 0.5) * 20);
      e.ai.ty = world.wrap(rallyY + (Math.random() - 0.5) * 20);
    }
    responders++;
  }
}
