import { FloorLevel, RoomType, Tex, Cell, DoorState, EntityType } from '../../core/types';
import { World as WorldClass } from '../../core/world';
import type { FloorGeneration } from '../floor_manifest';
import { stampRoom, protectRoom } from '../shared';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

export const LIQUIDATOR_BASE_BASE_FLOOR = FloorLevel.MAINTENANCE;

export function generateLiquidatorBaseDesignFloor(): FloorGeneration {
  const world = new WorldClass();

  const entities: any[] = [];
  const spawnX = 100;
  const spawnY = 100;

  let nextRoomId = 1;
  const nextId = { v: 1000 };

  // Generate Central HQ
  const hq = stampRoom(world, nextRoomId++, RoomType.HQ, spawnX - 25, spawnY - 15, 50, 30, -1);
  hq.name = 'Штаб Базы';
  hq.wallTex = Tex.HERMO_WALL;
  hq.floorTex = Tex.F_CONCRETE;
  protectRoom(world, hq.x, hq.y, hq.w, hq.h, hq.wallTex, hq.floorTex);

  // Generate Armory (STORAGE)
  const armory = stampRoom(world, nextRoomId++, RoomType.STORAGE, spawnX - 55, spawnY - 10, 25, 20, -1);
  armory.name = 'Оружейная Базы';
  armory.wallTex = Tex.METAL;
  armory.floorTex = Tex.F_CONCRETE;
  protectRoom(world, armory.x, armory.y, armory.w, armory.h, armory.wallTex, armory.floorTex);

  // Generate Medical (MEDICAL)
  const medbay = stampRoom(world, nextRoomId++, RoomType.MEDICAL, spawnX + 30, spawnY - 10, 25, 20, -1);
  medbay.name = 'Медпункт Базы';
  medbay.wallTex = Tex.TILE_W;
  medbay.floorTex = Tex.F_TILE;
  protectRoom(world, medbay.x, medbay.y, medbay.w, medbay.h, medbay.wallTex, medbay.floorTex);

  // Generate Arena (COMMON)
  const arena = stampRoom(world, nextRoomId++, RoomType.COMMON, spawnX - 20, spawnY - 55, 40, 35, -1);
  arena.name = 'Арена Ликвидаторов';
  arena.wallTex = Tex.HERMO_WALL;
  arena.floorTex = Tex.F_CONCRETE;
  protectRoom(world, arena.x, arena.y, arena.w, arena.h, arena.wallTex, arena.floorTex);

  // Connect them

  // Manual connection between rooms to avoid export issues and ensure they are accessible
  const hqLeftDoorIdx = world.idx(hq.x, hq.y + 10);
  world.cells[hqLeftDoorIdx] = Cell.DOOR;
  world.doors.set(hqLeftDoorIdx, { idx: hqLeftDoorIdx, state: DoorState.HERMETIC_OPEN, roomA: hq.id, roomB: armory.id, keyId: '', timer: 0 });
  world.floorTex[hqLeftDoorIdx] = Tex.F_CONCRETE;

  const hqRightDoorIdx = world.idx(hq.x + hq.w, hq.y + 10);
  world.cells[hqRightDoorIdx] = Cell.DOOR;
  world.doors.set(hqRightDoorIdx, { idx: hqRightDoorIdx, state: DoorState.HERMETIC_OPEN, roomA: hq.id, roomB: medbay.id, keyId: '', timer: 0 });
  world.floorTex[hqRightDoorIdx] = Tex.F_CONCRETE;

  const hqTopDoorIdx = world.idx(spawnX, hq.y);
  world.cells[hqTopDoorIdx] = Cell.DOOR;
  world.doors.set(hqTopDoorIdx, { idx: hqTopDoorIdx, state: DoorState.HERMETIC_OPEN, roomA: hq.id, roomB: arena.id, keyId: '', timer: 0 });
  world.floorTex[hqTopDoorIdx] = Tex.F_CONCRETE;

  const arenaBottomDoorIdx = world.idx(spawnX, arena.y + arena.h);
  world.cells[arenaBottomDoorIdx] = Cell.DOOR;
  world.doors.set(arenaBottomDoorIdx, { idx: arenaBottomDoorIdx, state: DoorState.HERMETIC_OPEN, roomA: arena.id, roomB: hq.id, keyId: '', timer: 0 });
  world.floorTex[arenaBottomDoorIdx] = Tex.F_CONCRETE;

  const armoryDoorIdx = world.idx(armory.x + armory.w, armory.y + 10);
  world.cells[armoryDoorIdx] = Cell.DOOR;
  world.doors.set(armoryDoorIdx, { idx: armoryDoorIdx, state: DoorState.OPEN, roomA: armory.id, roomB: hq.id, keyId: '', timer: 0 });
  world.floorTex[armoryDoorIdx] = Tex.F_CONCRETE;

  const medbayDoorIdx = world.idx(medbay.x, medbay.y + 10);
  world.cells[medbayDoorIdx] = Cell.DOOR;
  world.doors.set(medbayDoorIdx, { idx: medbayDoorIdx, state: DoorState.OPEN, roomA: medbay.id, roomB: hq.id, keyId: '', timer: 0 });
  world.floorTex[medbayDoorIdx] = Tex.F_TILE;

  // Simple straight corridor floors between them
  for(let x = armory.x + armory.w + 1; x < hq.x; x++) {
    const i = world.idx(x, armory.y + 10);
    world.cells[i] = Cell.FLOOR;
    world.floorTex[i] = Tex.F_CONCRETE;
  }
  for(let x = hq.x + hq.w + 1; x < medbay.x; x++) {
    const i = world.idx(x, medbay.y + 10);
    world.cells[i] = Cell.FLOOR;
    world.floorTex[i] = Tex.F_CONCRETE;
  }
  for(let y = arena.y + arena.h + 1; y < hq.y; y++) {
    const i = world.idx(spawnX, y);
    world.cells[i] = Cell.FLOOR;
    world.floorTex[i] = Tex.F_CONCRETE;
  }

  // Add viewing windows (holes with bars/fences in the south wall of the arena)
  for (const wx of [85, 88, 91, 94, 106, 109, 112, 115]) {
    const wi = world.idx(wx, arena.y + arena.h);
    world.cells[wi] = Cell.ABYSS; // Blocks movement but allows vision through
    world.floorTex[wi] = Tex.F_CONCRETE;
    entities.push({
      id: nextId.v++,
      type: EntityType.BILLBOARD,
      x: wx,
      y: arena.y + arena.h,
      angle: 0,
      pitch: 0,
      alive: true,
      sprite: 40, // Metal grille / prop sprite
      spriteScale: 1.0,
      name: 'Смотровая решетка арены',
    });
  }


  // Decorate and spawn NPCs
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'liquidator_quartermaster', hq.x + hq.w / 2, hq.y + hq.h / 2, { angle: Math.PI / 2 });
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'marko_lolo', hq.x + hq.w / 2 - 2, hq.y + hq.h / 2 + 2, { angle: Math.PI / 2 });
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'liquidator_armorer', armory.x + armory.w / 2, armory.y + armory.h / 2, { angle: 0 });
  requireSpawnedPlotNpcFromPackage(entities, nextId, 'liquidator_medic', medbay.x + medbay.w / 2, medbay.y + medbay.h / 2, { angle: Math.PI });

  return { world, entities, spawnX, spawnY };
}
