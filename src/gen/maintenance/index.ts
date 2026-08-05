/* ── Maintenance tunnels generator (Floor 1) — orchestrator ──── */
/*   Randomized coarse tunnel families on a service-grid base. */
/*   1-wide tunnel passages, rooms at junctions, pipe fragments. */

import {
  W, Cell, Tex, RoomType, Feature, LiftDirection,
  type Room, type Entity,
  EntityType, AIGoal, MonsterKind, FloorLevel,
} from '../../core/types';
import { World } from '../../core/world';
import { rng, pick, placeLifts, generateZones, ensureConnectivity } from '../shared';
import { placeProceduralScreens } from '../procedural_screens';
import { calcZoneLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { runMaintenanceContent } from './content_manifest';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { applyCollectorMacroGeometry, placeCollectorMacroPanels } from './geometry';
import { entitySpawnSlots } from '../../systems/entity_limits';
import { activeActorCountAtDefaultSoftLimit } from '../../data/entity_limits';
import {
  MAINTENANCE_TERRITORY_SEED,
  initializeMaintenanceTerritory,
  relocateMaintenanceFactionNpcSquads,
  spawnMaintenanceFactionNpcSquads,
} from './territory';

/* ── Coarse grid parameters ───────────────────────────────────── */
const CELL = 6;                   // world-tiles per maze cell (walls between = 1-wide passage)
const GRID = Math.floor(W / CELL);// 1024/6 = 170 coarse cells
const EXTRA_CONN = 0.06;          // fraction of extra random connections (loops)
const MAINTENANCE_MONSTER_TARGET_AT_DEFAULT_CAP = 1000;

/* Room type pool for maintenance floor */
const MAINT_ROOM_TYPES: { type: RoomType; name: string; weight: number }[] = [
  { type: RoomType.STORAGE,    name: 'Кладовая',     weight: 25 },
  { type: RoomType.PRODUCTION, name: 'Насосная',      weight: 20 },
  { type: RoomType.COMMON,     name: 'Коллектор',     weight: 20 },
  { type: RoomType.MEDICAL,    name: 'Медпункт',      weight: 8 },
  { type: RoomType.SMOKING,    name: 'Курилка',       weight: 10 },
  { type: RoomType.OFFICE,     name: 'Диспетчерская', weight: 10 },
  { type: RoomType.CORRIDOR,   name: 'Тоннель',       weight: 7 },
];

function pickRoomType(): { type: RoomType; name: string } {
  let total = 0;
  for (const r of MAINT_ROOM_TYPES) total += r.weight;
  let roll = Math.random() * total;
  for (const r of MAINT_ROOM_TYPES) {
    roll -= r.weight;
    if (roll <= 0) return { type: r.type, name: r.name };
  }
  return MAINT_ROOM_TYPES[0];
}

/* ── Maze edge set (undirected) stored as flat bitmask per cell ── */
const DIR_R = 1;  // +x
const DIR_D = 2;  // +y
const DIR_L = 4;  // -x
const DIR_U = 8;  // -y
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const DIR_BIT  = [DIR_R, DIR_D, DIR_L, DIR_U];
const OPP_BIT  = [DIR_L, DIR_U, DIR_R, DIR_D];

function gWrap(v: number): number { return ((v % GRID) + GRID) % GRID; }
function gIdx(gx: number, gy: number): number { return gWrap(gy) * GRID + gWrap(gx); }

function openMazeEdge(mazeOpen: Uint8Array, gx: number, gy: number, d: number): void {
  const ci = gIdx(gx, gy);
  const nx = gWrap(gx + DX[d]);
  const ny = gWrap(gy + DY[d]);
  const ni = gIdx(nx, ny);
  mazeOpen[ci] |= DIR_BIT[d];
  mazeOpen[ni] |= OPP_BIT[d];
}

function applyCoarseTunnelFamily(mazeOpen: Uint8Array): void {
  const roll = Math.random();
  if (roll < 0.34) {
    addGrowingTreeDuctFamily(mazeOpen);
  } else if (roll < 0.67) {
    addHuntAndKillDuctFamily(mazeOpen);
  } else {
    addEllerLadderFamily(mazeOpen);
  }
}

function addGrowingTreeDuctFamily(mazeOpen: Uint8Array): void {
  let active: number[] = [gIdx(Math.floor(GRID / 2), Math.floor(GRID / 2))];
  const targetSteps = GRID * 3;
  for (let step = 0; step < targetSteps && active.length > 0; step++) {
    const newest = active.length - 1;
    const pickIndex = Math.random() < 0.68 ? newest : rng(0, newest);
    const cur = active[pickIndex];
    const gx = cur % GRID;
    const gy = (cur / GRID) | 0;
    const d = rng(0, 3);
    openMazeEdge(mazeOpen, gx, gy, d);
    active.push(gIdx(gx + DX[d], gy + DY[d]));
    if (active.length > 144 || Math.random() < 0.22) active = active.filter((_, i) => i !== pickIndex);
  }
}

function addHuntAndKillDuctFamily(mazeOpen: Uint8Array): void {
  const stride = rng(5, 9);
  for (let gy = rng(0, stride - 1); gy < GRID; gy += stride) {
    let gx = rng(0, GRID - 1);
    const run = rng(12, 28);
    let d = Math.random() < 0.5 ? 0 : 2;
    for (let step = 0; step < run; step++) {
      openMazeEdge(mazeOpen, gx, gy, d);
      if (Math.random() < 0.24) openMazeEdge(mazeOpen, gx, gy, Math.random() < 0.5 ? 1 : 3);
      gx = gWrap(gx + DX[d]);
      if (Math.random() < 0.18) d = (d + (Math.random() < 0.5 ? 1 : 3)) & 3;
    }
  }
}

function addEllerLadderFamily(mazeOpen: Uint8Array): void {
  const rowStep = rng(7, 11);
  const colStep = rng(8, 13);
  for (let gy = rng(0, rowStep - 1); gy < GRID; gy += rowStep) {
    for (let gx = 0; gx < GRID; gx++) {
      if ((gx + gy) % 5 !== 0 || Math.random() < 0.78) openMazeEdge(mazeOpen, gx, gy, 0);
      if (gx % colStep === 0) openMazeEdge(mazeOpen, gx, gy, 1);
    }
  }
  for (let gx = rng(0, colStep - 1); gx < GRID; gx += colStep) {
    for (let gy = 0; gy < GRID; gy += 2) {
      if (Math.random() < 0.42) openMazeEdge(mazeOpen, gx, gy, 1);
    }
  }
}

export function generateMaintenance(generationSeed = MAINTENANCE_TERRITORY_SEED): { world: World; entities: Entity[]; spawnX: number; spawnY: number } {
  const world = new World();
  const entities: Entity[] = [];
  let nextId = 1;
  let nextRoomId = 0;

  // Default wall texture = pipe
  for (let i = 0; i < W * W; i++) world.wallTex[i] = Tex.PIPE;

  /* ══════════════════════════════════════════════════════════════
     Phase 1-5: Maze generation & Geometry carving
     ══════════════════════════════════════════════════════════════ */
  const mazeOpen = generateCoarseMaze();
  carvePassages(world, mazeOpen);
  carveDeadEnds(world, mazeOpen);
  const roomCarveResult = carveRooms(world, mazeOpen, nextRoomId);
  nextRoomId = roomCarveResult.nextRoomId;
  const rooms = roomCarveResult.rooms;
  carveWaterCanals(world);

  const half = Math.floor(CELL / 2);
  const centerX = Math.floor(GRID / 2) * CELL + half;
  const centerY = Math.floor(GRID / 2) * CELL + half;

  nextRoomId = applyCollectorMacroGeometry(world, rooms, nextRoomId, centerX, centerY);

  /* ══════════════════════════════════════════════════════════════
     Phase 6: Spawn point (center of the maze)
     ══════════════════════════════════════════════════════════════ */
  // Ensure spawn cell is floor
  if (world.cells[world.idx(world.wrap(centerX), world.wrap(centerY))] === Cell.WALL) { world.cells[world.idx(world.wrap(centerX), world.wrap(centerY))] = Cell.FLOOR; world.floorTex[world.idx(world.wrap(centerX), world.wrap(centerY))] = Tex.F_CONCRETE; }
  const spawnX = world.wrap(centerX) + 0.5;
  const spawnY = world.wrap(centerY) + 0.5;

  /* ══════════════════════════════════════════════════════════════
     Phase 7: Lifts
     ══════════════════════════════════════════════════════════════ */
  placeLifts(world, 8, LiftDirection.UP);
  placeLifts(world, 8, LiftDirection.DOWN);

  /* ══════════════════════════════════════════════════════════════
     Phase 8: Zones + zone levels
     ══════════════════════════════════════════════════════════════ */
  generateZones(world);
  for (const z of world.zones) z.level = calcZoneLevel(z.cx, z.cy, FloorLevel.MAINTENANCE);

  /* ══════════════════════════════════════════════════════════════
     Phase 9-11: Entities & Environment
     ══════════════════════════════════════════════════════════════ */
  placeLights(world, rooms);
  nextId = placeItems(entities, rooms, nextId);
  nextId = placeMonsters(world, entities, nextId);

  /* ══════════════════════════════════════════════════════════════
     Phase 12-14e: Manifest-owned maintenance content
     ══════════════════════════════════════════════════════════════ */
  const factionNpcIdStart = nextId;
  nextId = spawnMaintenanceFactionNpcSquads(world, entities, nextId);
  const factionNpcIdEnd = nextId;

  nextId = runMaintenanceContent(world, entities, nextId, spawnX, spawnY);

  /* ══════════════════════════════════════════════════════════════
     Phase 15: Ensure all rooms are reachable (connectivity fix)
     ══════════════════════════════════════════════════════════════ */
  ensureConnectivity(world, spawnX, spawnY);

  /* ══════════════════════════════════════════════════════════════
     Phase 16: Rare procedural monitor/gauge walls
     ══════════════════════════════════════════════════════════════ */
  placeProceduralScreens(world, FloorLevel.MAINTENANCE);
  placeCollectorMacroPanels(world, centerX, centerY);

  /* ══════════════════════════════════════════════════════════════
     Phase 17: Cell-first territory and faction NPC squads
     ══════════════════════════════════════════════════════════════ */
  initializeMaintenanceTerritory(world, generationSeed);
  relocateMaintenanceFactionNpcSquads(world, entities, factionNpcIdStart, factionNpcIdEnd);

  return { world, entities, spawnX, spawnY };
}

function generateCoarseMaze(): Uint8Array {
  const mazeOpen = new Uint8Array(GRID * GRID);
  const visited = new Uint8Array(GRID * GRID);

  const stack: number[] = [];
  const startG = gIdx(Math.floor(GRID / 2), Math.floor(GRID / 2));
  visited[startG] = 1;
  stack.push(startG);

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const cx = cur % GRID;
    const cy = (cur / GRID) | 0;

    const nbrs: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = gWrap(cx + DX[d]);
      const ny = gWrap(cy + DY[d]);
      if (!visited[gIdx(nx, ny)]) nbrs.push(d);
    }

    if (nbrs.length === 0) {
      stack.pop();
      continue;
    }

    const d = nbrs[Math.floor(Math.random() * nbrs.length)];
    const nx = gWrap(cx + DX[d]);
    const ny = gWrap(cy + DY[d]);
    const ni = gIdx(nx, ny);

    mazeOpen[cur] |= DIR_BIT[d];
    mazeOpen[ni] |= OPP_BIT[d];
    visited[ni] = 1;
    stack.push(ni);
  }

  applyCoarseTunnelFamily(mazeOpen);

  const totalCells = GRID * GRID;
  const extraCount = Math.floor(totalCells * EXTRA_CONN);
  for (let i = 0; i < extraCount; i++) {
    const ci = rng(0, totalCells - 1);
    const d = rng(0, 3);
    const cx = ci % GRID;
    const cy = (ci / GRID) | 0;
    openMazeEdge(mazeOpen, cx, cy, d);
  }

  return mazeOpen;
}

function carvePassages(world: World, mazeOpen: Uint8Array): void {
  const half = Math.floor(CELL / 2);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const ox = gx * CELL + half;
      const oy = gy * CELL + half;
      const bits = mazeOpen[gIdx(gx, gy)];

      const carve = (x: number, y: number) => {
        const ci = world.idx(x, y);
        if (world.cells[ci] === Cell.WALL) {
          world.cells[ci] = Cell.FLOOR;
          world.floorTex[ci] = Tex.F_CONCRETE;
        }
      };

      carve(world.wrap(ox), world.wrap(oy));

      if (bits & DIR_R) {
        for (let s = 0; s <= CELL; s++) carve(world.wrap(ox + s), world.wrap(oy));
      }
      if (bits & DIR_D) {
        for (let s = 0; s <= CELL; s++) carve(world.wrap(ox), world.wrap(oy + s));
      }
    }
  }
}

function carveDeadEnds(world: World, mazeOpen: Uint8Array): void {
  const half = Math.floor(CELL / 2);
  const carve = (x: number, y: number) => {
    const ci = world.idx(x, y);
    if (world.cells[ci] === Cell.WALL) {
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
    }
  };

  for (let i = 0; i < 600; i++) {
    const gx = rng(0, GRID - 1);
    const gy = rng(0, GRID - 1);
    const ox = gx * CELL + half;
    const oy = gy * CELL + half;

    const bits = mazeOpen[gIdx(gx, gy)];
    const closed: number[] = [];
    for (let d = 0; d < 4; d++) {
      if (!(bits & DIR_BIT[d])) closed.push(d);
    }
    if (closed.length === 0) continue;

    const d = closed[Math.floor(Math.random() * closed.length)];
    const len = rng(1, half);
    for (let s = 1; s <= len; s++) {
      carve(world.wrap(ox + DX[d] * s), world.wrap(oy + DY[d] * s));
    }
  }
}

function carveRooms(world: World, mazeOpen: Uint8Array, nextRoomIdStart: number): { rooms: Room[], nextRoomId: number } {
  const half = Math.floor(CELL / 2);
  const rooms: Room[] = [];
  let nextRoomId = nextRoomIdStart;

  const connCount = (gi: number): number => {
    let c = 0, b = mazeOpen[gi];
    while (b) { c += b & 1; b >>= 1; }
    return c;
  };

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const gi = gIdx(gx, gy);
      const conns = connCount(gi);

      const isJunction = conns >= 3 && Math.random() < 0.5;
      const isRandom = Math.random() < 0.03;
      if (!isJunction && !isRandom) continue;

      const rw = rng(3, 6), rh = rng(3, 6);
      const ox = gx * CELL + half;
      const oy = gy * CELL + half;
      const rx = world.wrap(ox - Math.floor(rw / 2));
      const ry = world.wrap(oy - Math.floor(rh / 2));

      const rt = pickRoomType();
      const room: Room = {
        id: nextRoomId, type: rt.type,
        x: rx, y: ry, w: rw, h: rh,
        doors: [], sealed: false,
        name: `${rt.name} #${nextRoomId}`,
        apartmentId: -1,
        wallTex: Tex.PIPE,
        floorTex: Tex.F_CONCRETE,
      };

      for (let dy = -1; dy <= rh; dy++) {
        for (let dx = -1; dx <= rw; dx++) {
          const ci = world.idx(room.x + dx, room.y + dy);
          if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) {
            world.cells[ci] = Cell.FLOOR;
            world.floorTex[ci] = Tex.F_CONCRETE;
            world.roomMap[ci] = nextRoomId;
          } else {
            if (world.cells[ci] !== Cell.FLOOR) {
              world.cells[ci] = Cell.WALL;
              world.wallTex[ci] = Tex.PIPE;
            }
          }
        }
      }

      for (let dy = -1; dy <= rh; dy++) {
        for (let dx = -1; dx <= rw; dx++) {
          if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) continue;
          const wx = world.wrap(room.x + dx);
          const wy = world.wrap(room.y + dy);
          const ci = world.idx(wx, wy);
          if (world.cells[ci] !== Cell.WALL) continue;

          for (const [odx, ody] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
            const nx = world.wrap(wx + odx);
            const ny = world.wrap(wy + ody);
            const ni = world.idx(nx, ny);
            if (world.cells[ni] === Cell.FLOOR && world.roomMap[ni] !== nextRoomId) {
              const ix = world.wrap(wx - odx);
              const iy = world.wrap(wy - ody);
              const ii = world.idx(ix, iy);
              if (world.roomMap[ii] === nextRoomId) {
                world.cells[ci] = Cell.FLOOR;
                break;
              }
            }
          }
        }
      }

      const ccx = room.x + Math.floor(rw / 2);
      const ccy = room.y + Math.floor(rh / 2);
      const fci = world.idx(ccx, ccy);
      if (rt.type === RoomType.MEDICAL && world.cells[fci] === Cell.FLOOR)
        world.features[fci] = Feature.SHELF;
      if (rt.type === RoomType.PRODUCTION && world.cells[fci] === Cell.FLOOR)
        world.features[fci] = Feature.MACHINE;

      world.rooms[nextRoomId] = room;
      rooms.push(room);
      nextRoomId++;
    }
  }
  return { rooms, nextRoomId };
}

function carveWaterCanals(world: World): void {
  for (let canal = 0; canal < 30; canal++) {
    const horiz = Math.random() < 0.5;
    const pos = rng(10, W - 10);
    const start = rng(0, W - 100);
    const len = rng(40, 200);
    for (let d = 0; d < len; d++) {
      let x: number, y: number;
      if (horiz) {
        x = world.wrap(start + d);
        y = world.wrap(pos);
      } else {
        x = world.wrap(pos);
        y = world.wrap(start + d);
      }
      const ci = world.idx(x, y);
      if (world.cells[ci] === Cell.WALL) {
        world.cells[ci] = Cell.WATER;
        world.floorTex[ci] = Tex.F_WATER;
      }
    }
  }
}

function placeLights(world: World, rooms: Room[]): void {
  const half = Math.floor(CELL / 2);
  for (const room of rooms) {
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR) world.features[ci] = Feature.LAMP;
  }
  for (let gy = 0; gy < GRID; gy++) {
    const cyOffset = (gy * CELL + half) * W;
    for (let gx = 0; gx < GRID; gx++) {
      if (Math.random() < 0.06) {
        const ci = cyOffset + (gx * CELL + half);
        if (world.cells[ci] === Cell.FLOOR && world.features[ci] === 0)
          world.features[ci] = Feature.LAMP;
      }
    }
  }
  world.bakeLights();
}

function placeItems(entities: Entity[], rooms: Room[], nextIdStart: number): number {
  let nextId = nextIdStart;
  for (const room of rooms) {
    const numItems = rng(0, 3);
    for (let n = 0; n < numItems; n++) {
      const defs = ['pipe', 'wrench', 'flashlight', 'bandage', 'water', 'canned', 'bread', 'ammo_fuel', 'grenade'];
      const defId = pick(defs);
      const ix = room.x + rng(0, Math.max(0, room.w - 1));
      const iy = room.y + rng(0, Math.max(0, room.h - 1));
      entities.push({
        id: nextId++, type: EntityType.ITEM_DROP,
        x: ix + 0.5, y: iy + 0.5, angle: 0, pitch: 0,
        alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId, count: 1 }],
      });
    }
  }
  return nextId;
}

function placeMonsters(world: World, entities: Entity[], nextIdStart: number): number {
  let nextId = nextIdStart;
  let monsterCount = 0;
  const monsterTarget = entitySpawnSlots(entities, EntityType.MONSTER, activeActorCountAtDefaultSoftLimit(MAINTENANCE_MONSTER_TARGET_AT_DEFAULT_CAP));
  for (let attempt = 0; attempt < 50_000 && monsterCount < monsterTarget; attempt++) {
    const ci = rng(0, W * W - 1);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const mx = (ci % W) + 0.5, my = ((ci / W) | 0) + 0.5;
    const kind = Math.random() < 0.10
      ? pick([MonsterKind.EYE, MonsterKind.NIGHTMARE, MonsterKind.REBAR, MonsterKind.BETONNIK, MonsterKind.MATKA])
      : pick([
      MonsterKind.SBORKA, MonsterKind.SBORKA,
      MonsterKind.POLZUN,
      MonsterKind.ZOMBIE,
      MonsterKind.SHADOW,
      MonsterKind.TVAR,
    ]);
    const mstats: Record<number, { hp: number; speed: number; sprite: number }> = {
      [MonsterKind.SBORKA]: { hp: 5,  speed: 2.8, sprite: monsterSpr(MonsterKind.SBORKA) },
      [MonsterKind.TVAR]:   { hp: 40, speed: 1.8, sprite: monsterSpr(MonsterKind.TVAR) },
      [MonsterKind.POLZUN]: { hp: 80, speed: 1.0, sprite: monsterSpr(MonsterKind.POLZUN) },
      [MonsterKind.ZOMBIE]: { hp: 25, speed: 1.4, sprite: monsterSpr(MonsterKind.ZOMBIE) },
      [MonsterKind.SHADOW]: { hp: 45, speed: 2.4, sprite: monsterSpr(MonsterKind.SHADOW) },
      [MonsterKind.EYE]:       { hp: 30,  speed: 2.0, sprite: monsterSpr(MonsterKind.EYE) },
      [MonsterKind.NIGHTMARE]: { hp: 60,  speed: 2.2, sprite: monsterSpr(MonsterKind.NIGHTMARE) },
      [MonsterKind.REBAR]:     { hp: 55,  speed: 1.6, sprite: monsterSpr(MonsterKind.REBAR) },
      [MonsterKind.BETONNIK]:  { hp: 120, speed: 1.2, sprite: monsterSpr(MonsterKind.BETONNIK) },
      [MonsterKind.MATKA]:     { hp: 100, speed: 1.0, sprite: monsterSpr(MonsterKind.MATKA) },
    };
    const def = mstats[kind];
    if (!def) continue;
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 5) : 5;
    const rpg = randomRPG(zoneLevel);
    entities.push({
      id: nextId++, type: EntityType.MONSTER,
      x: mx, y: my, angle: Math.random() * Math.PI * 2, pitch: 0,
      alive: true, speed: scaleMonsterSpeed(def.speed, zoneLevel), sprite: def.sprite,
      hp: scaleMonsterHp(def.hp, zoneLevel), maxHp: scaleMonsterHp(def.hp, zoneLevel),
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg,
    });
    monsterCount++;
  }
  return nextId;
}
