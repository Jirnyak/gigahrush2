import { World } from '../../core/world';
import { Entity, EntityType, Tex, Feature, Cell, DoorState, W, MonsterKind, RoomType } from '../../core/types';
import { seededRandom } from '../../core/rand';
import { carveCorridor, ensureConnectivity, generateZones, placeDoorAt, stampRoom, sanitizeDoors } from '../shared';
import type { FloorGeneration } from '../floor_manifest';

const MACRO_SIZE = 16;
const MACRO_GRID = 25; // 25 * 16 = 400
const OFFSET_MACRO = 20; // Starts at 320

function blackoutHorrorLights(world: World): void {
  let removed = false;
  for (let i = 0; i < W * W; i++) {
    const feature = world.features[i];
    if (feature === Feature.LAMP || feature === Feature.CANDLE) {
      world.features[i] = Feature.NONE;
      removed = true;
    }
  }
  world.light.fill(0);
  if (removed) world.markFeaturesDirty(false);
}

export function generateHorrorFloorDesignFloor(): FloorGeneration {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  let nextRoomId = 1;

  world.wallTex.fill(Tex.DARK);
  world.floorTex.fill(Tex.F_CONCRETE);

  // Initialize all to walls
  for (let i = 0; i < W * W; i++) {
    world.cells[i] = Cell.WALL;
  }

  const rng = seededRandom(404);

  // Recursive backtracker
  const visited = new Set<string>();
  const stack: {mx: number, my: number}[] = [];
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  const startX = Math.floor(rng() * MACRO_GRID);
  const startY = Math.floor(rng() * MACRO_GRID);

  stack.push({mx: startX, my: startY});
  visited.add(`${startX},${startY}`);

  const deadEnds: {mx: number, my: number}[] = [];

  while(stack.length > 0) {
    const curr = stack[stack.length - 1];

    // shuffle dirs
    const shuffledDirs = [...dirs].sort(() => rng() - 0.5);
    let moved = false;

    for (const [dx, dy] of shuffledDirs) {
      const nx = curr.mx + dx;
      const ny = curr.my + dy;

      if (nx >= 0 && nx < MACRO_GRID && ny >= 0 && ny < MACRO_GRID) {
        if (!visited.has(`${nx},${ny}`)) {
          visited.add(`${nx},${ny}`);
          stack.push({mx: nx, my: ny});

          // carve path from curr to n
          const wx1 = (curr.mx + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);
          const wy1 = (curr.my + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);
          const wx2 = (nx + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);
          const wy2 = (ny + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);

          carveCorridor(world, wx1, wy1, wx2, wy2);

          moved = true;
          break;
        }
      }
    }

    if (!moved) {
      deadEnds.push(stack.pop()!);
    }
  }

  const spawnX = (startX + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2) + 0.5;
  const spawnY = (startY + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2) + 0.5;

  // Carve safe rooms at dead ends
  let numSafeRooms = 5;
  let numMonsters = 3;

  // Randomize dead ends a bit
  deadEnds.sort(() => rng() - 0.5);

  for (const deadEnd of deadEnds) {
    if (deadEnd.mx === startX && deadEnd.my === startY) continue; // no safe room exactly at start

    const cx = (deadEnd.mx + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);
    const cy = (deadEnd.my + OFFSET_MACRO) * MACRO_SIZE + Math.floor(MACRO_SIZE / 2);

    if (numSafeRooms > 0) {
      numSafeRooms--;

      const roomId = nextRoomId++;
      // Stamp 5x5 room
      stampRoom(world, roomId, RoomType.LIVING, cx - 2, cy - 2, 5, 5, -1);

      // find connections
      const adjacentFloor = dirs.map(([dx, dy]) => {
          const fx = cx + dx * 3;
          const fy = cy + dy * 3;
          return {fx, fy, dx, dy, isFloor: world.cells[world.idx(fx, fy)] === Cell.FLOOR};
      }).filter(a => a.isFloor);

      if (adjacentFloor.length > 0) {
          const doorSpot = adjacentFloor[0];
          placeDoorAt(world, cx + doorSpot.dx * 2, cy + doorSpot.dy * 2, roomId);
          const idx = world.idx(cx + doorSpot.dx * 2, cy + doorSpot.dy * 2);
          if (world.doors.has(idx)) {
              world.doors.get(idx)!.state = DoorState.HERMETIC_CLOSED;
          }
      }
    } else if (numMonsters > 0) {
      numMonsters--;
      entities.push({
        id: nextId.v++,
        type: EntityType.MONSTER,
        monsterKind: MonsterKind.GLUBINNAYA_TEN,
        x: cx + 0.5,
        y: cy + 0.5,
        hp: 99999,
        maxHp: 99999,
        angle: 0,
        pitch: 0,
        alive: true,
        speed: 1,
        sprite: 0,
      });
    }
  }

  generateZones(world);
  sanitizeDoors(world);
  ensureConnectivity(world, spawnX, spawnY);
  blackoutHorrorLights(world);

  return { world, entities, spawnX, spawnY };
}
