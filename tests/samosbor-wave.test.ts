import { beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  FloorLevel,
  RoomType,
  Tex,
  ZoneFaction,
  type Entity,
  type Room,
} from '../src/core/types';
import { World, getVisualSlot, setVisualSlot } from '../src/core/world';
import { createWorldEventState } from '../src/systems/events';
import { registerRouteCue, routeCueCount } from '../src/systems/route_cues';
import {
  canRunSamosborWave,
  cancelSamosborWave,
  chooseSamosborScale,
  finishSamosborWave,
  getSamosborWaveDebugSnapshot,
  startSamosborWave,
  tickSamosborWave,
} from '../src/systems/samosbor_wave';
import {
  nextFloorRunSamosborCooldown,
  nextFloorRunSamosborDuration,
} from '../src/systems/procedural_floors';
import { makeGameState, makeTestContainer, makeTestPlayer } from './helpers';

beforeEach(() => {
  cancelSamosborWave();
});

function makeOpenWaveWorld(cx = 24, cy = 24, half = 8): { world: World; state: ReturnType<typeof makeGameState>; player: Entity; entities: Entity[] } {
  const world = new World();
  world.zones[0] = { id: 0, cx, cy, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const idx = world.idx(x, y);
      world.cells[idx] = Cell.FLOOR;
      world.floorTex[idx] = Tex.F_LINO;
      world.zoneMap[idx] = 0;
      world.roomMap[idx] = -1;
    }
  }
  const player = makeTestPlayer({ x: cx + 0.5, y: cy + 0.5, speed: 1 });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 2,
    worldEvents: createWorldEventState(),
  });
  return { world, state, player, entities: [player] };
}

function runWaveToEnd(world: World, entities: Entity[], state: ReturnType<typeof makeGameState>): void {
  for (let i = 0; i < 512; i++) {
    const snapshot = getSamosborWaveDebugSnapshot();
    if (snapshot && !snapshot.active) return;
    tickSamosborWave(world, entities, state);
  }
  const snapshot = getSamosborWaveDebugSnapshot();
  assert.equal(snapshot?.active, false, 'wave should finish within bounded test ticks');
}

function makeRoom(id: number, x: number, y: number, w: number, h: number, apartmentId = -1): Room {
  return {
    id,
    type: RoomType.COMMON,
    x,
    y,
    w,
    h,
    doors: [],
    sealed: false,
    name: `room ${id}`,
    apartmentId,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
}

function makeReplacementWorld(cx = 24, cy = 24): World {
  const world = new World();
  world.zones[0] = { id: 0, cx, cy, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  const generatedRoom = makeRoom(3, cx - 2, cy - 2, 5, 5);
  generatedRoom.type = RoomType.KITCHEN;
  generatedRoom.name = 'Сгенерированная кухня';
  generatedRoom.wallTex = Tex.PANEL;
  generatedRoom.floorTex = Tex.F_TILE;
  world.rooms[generatedRoom.id] = generatedRoom;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      const idx = world.idx(x, y);
      world.cells[idx] = Cell.FLOOR;
      world.floorTex[idx] = Tex.F_TILE;
      world.wallTex[idx] = Tex.PANEL;
      world.zoneMap[idx] = 0;
      world.roomMap[idx] = generatedRoom.id;
    }
  }
  return world;
}

test('samosbor wave does not mutate aptMask or protected apartment cells', () => {
  const { world, state, entities } = makeOpenWaveWorld();
  const protectedRoom = makeRoom(7, 27, 23, 3, 3, 1);
  world.rooms[protectedRoom.id] = protectedRoom;
  world.apartmentRoomCount = 1;
  const protectedIdx = world.idx(28, 24);
  world.aptMask[protectedIdx] = 1;
  world.hermoWall[protectedIdx] = 1;
  world.cells[protectedIdx] = Cell.FLOOR;
  world.roomMap[protectedIdx] = protectedRoom.id;
  world.floorTex[protectedIdx] = Tex.F_TILE;

  assert.equal(startSamosborWave(world, entities, state, 'small', 24, 24, { seed: 11, radius: 6, budgetCellsPerTick: 32 }), true);
  runWaveToEnd(world, entities, state);

  assert.equal(world.aptMask[protectedIdx], 1);
  assert.equal(world.hermoWall[protectedIdx], 1);
  assert.equal(world.cells[protectedIdx], Cell.FLOOR);
  assert.equal(world.roomMap[protectedIdx], protectedRoom.id);
  assert.equal(world.floorTex[protectedIdx], Tex.F_TILE);
});

test('samosbor wave queues through toroidal wrap without duplicates', () => {
  const { world, state, entities } = makeOpenWaveWorld(1023, 10, 0);
  const wrappedIdx = world.idx(0, 10);
  world.cells[wrappedIdx] = Cell.FLOOR;
  world.floorTex[wrappedIdx] = Tex.F_LINO;

  assert.equal(startSamosborWave(world, entities, state, 'small', 1023, 10, { seed: 22, radius: 2, budgetCellsPerTick: 1 }), true);
  const queued = getSamosborWaveDebugSnapshot();
  assert.ok(queued?.queuedSample.includes(wrappedIdx), 'wrapped east neighbor should be queued');
  assert.equal(queued?.frontierLength, queued?.queuedCount);

  const tick = tickSamosborWave(world, entities, state);
  assert.equal(tick.processed <= 1, true);
  const afterTick = getSamosborWaveDebugSnapshot();
  assert.equal(afterTick?.frontierLength, afterTick?.queuedCount);
});

test('samosbor wave respects the per-tick budget', () => {
  const { world, state, entities } = makeOpenWaveWorld();
  assert.equal(startSamosborWave(world, entities, state, 'medium', 24, 24, { seed: 33, radius: 10, budgetCellsPerTick: 3 }), true);

  const tick = tickSamosborWave(world, entities, state);
  const snapshot = getSamosborWaveDebugSnapshot();
  assert.equal(tick.processed <= 3, true);
  assert.equal((snapshot?.lastProcessed ?? 99) <= 3, true);
});

test('samosbor wave cleanup keeps player standing in an open door cell', () => {
  const { world, state, player, entities } = makeOpenWaveWorld();
  const doorIdx = world.idx(24, 24);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_OPEN, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  player.x = 24.5;
  player.y = 24.5;

  assert.equal(startSamosborWave(world, entities, state, 'small', 21, 24, { seed: 34, radius: 1, budgetCellsPerTick: 1 }), true);
  tickSamosborWave(world, entities, state);

  assert.equal(player.x, 24.5);
  assert.equal(player.y, 24.5);
});

test('samosbor scale can be local or full depending on roll', () => {
  const originalRandom = Math.random;
  // High roll (> 0.4) → local wave (small or medium)
  Math.random = () => 0.999999;
  try {
    for (const floor of [
      FloorLevel.MINISTRY,
      FloorLevel.KVARTIRY,
      FloorLevel.LIVING,
      FloorLevel.MAINTENANCE,
      FloorLevel.HELL,
      FloorLevel.VOID,
    ]) {
      const state = makeGameState({ currentFloor: floor });
      assert.equal(canRunSamosborWave(state), true);
      assert.notEqual(chooseSamosborScale(state), 'full');
    }
  } finally {
    Math.random = originalRandom;
  }
  // Low roll (< 0.4) → full (global fronts only)
  Math.random = () => 0.1;
  try {
    const state = makeGameState({ currentFloor: FloorLevel.LIVING });
    assert.equal(chooseSamosborScale(state), 'full');
  } finally {
    Math.random = originalRandom;
  }
});

test('samosbor duration grows and cooldown shrinks by absolute route z', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const living = makeGameState({ currentFloor: FloorLevel.LIVING });
    const voidFloor = makeGameState({ currentFloor: FloorLevel.VOID });
    // LIVING (depth=0): duration min=20, maxForDepth=20, result=20
    // VOID (depth=1): duration min=20, maxForDepth=300, result=20 + 0.5*(300-20) = 160
    const dLiving = nextFloorRunSamosborDuration(living);
    const dVoid = nextFloorRunSamosborDuration(voidFloor);
    assert.ok(dLiving >= 20, `living duration ${dLiving} >= 20`);
    assert.ok(dVoid > dLiving, `void duration ${dVoid} > living ${dLiving}`);
    // LIVING (depth=0): cooldown maxForDepth=1500, mid-band: 45 + 0.5*(1500-45) ≈ 772
    // VOID (depth=1): cooldown maxForDepth=45, mid-band: 45 + 0.5*(45-45) = 45
    const cLiving = nextFloorRunSamosborCooldown(living);
    const cVoid = nextFloorRunSamosborCooldown(voidFloor);
    assert.ok(cLiving > cVoid, `living cooldown ${cLiving} > void ${cVoid}`);
    assert.ok(cLiving >= 45, `living cooldown ${cLiving} >= min 45`);
    assert.ok(cVoid >= 45, `void cooldown ${cVoid} >= min 45`);
  } finally {
    Math.random = originalRandom;
  }
});

test('samosbor wave leaves doors, containers, route cues, and entity cells consistent after patch', () => {
  const { world, state, player, entities } = makeOpenWaveWorld();
  world.floorTex[world.idx(24, 24)] = Tex.F_MEAT;
  const doorIdx = world.idx(27, 24);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  world.containers = [];
  world.rebuildContainerMap();
  world.addContainer(makeTestContainer({ id: 42, x: 24, y: 24, floor: FloorLevel.LIVING, roomId: -1, zoneId: 0, capacitySlots: 2 }));
  entities.push({
    id: 99,
    type: EntityType.PROJECTILE,
    x: 24.5,
    y: 24.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 4,
    sprite: 0,
    ownerId: player.id,
    projLife: 3,
  });
  registerRouteCue(world, {
    id: 'wave_test_cue',
    x: 24,
    y: 24,
    targetX: 24,
    targetY: 24,
    floor: FloorLevel.LIVING,
    label: 'test',
    hint: 'test',
    targetName: 'test',
    color: '#fff',
    tags: ['test'],
    toneSeed: 1,
  });

  assert.equal(routeCueCount(world), 1);
  assert.equal(startSamosborWave(world, entities, state, 'small', 24, 24, { seed: 44, radius: 8, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);

  for (const [idx, door] of world.doors) {
    assert.equal(world.cells[idx], Cell.DOOR);
    assert.equal(door.idx, idx);
  }
  for (const room of world.rooms) {
    if (!room) continue;
    for (const idx of room.doors) assert.equal(world.cells[idx], Cell.DOOR);
  }
  for (const container of world.containers) {
    const idx = world.idx(container.x, container.y);
    assert.equal(world.containerById.get(container.id), container);
    assert.equal(world.containerMap.get(idx)?.includes(container.id), true);
    assert.ok(world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.DOOR || world.cells[idx] === Cell.WATER);
  }
  assert.equal(entities.some(entity => entity.type === EntityType.PROJECTILE), false);
  assert.equal(routeCueCount(world), 0);
  const snapshot = getSamosborWaveDebugSnapshot();
  assert.equal(snapshot?.frontierLength, snapshot?.queuedCount);
});

test('finished local samosbor wave splices a regenerated field and stitches old boundary floors', () => {
  const { world, state, entities } = makeOpenWaveWorld();
  const protectedRoom = makeRoom(9, 22, 23, 3, 3, 1);
  world.rooms[protectedRoom.id] = protectedRoom;
  world.apartmentRoomCount = 1;
  const protectedIdx = world.idx(23, 24);
  world.aptMask[protectedIdx] = 1;
  world.hermoWall[protectedIdx] = 1;
  world.cells[protectedIdx] = Cell.FLOOR;
  world.roomMap[protectedIdx] = protectedRoom.id;
  world.floorTex[protectedIdx] = Tex.F_WOOD;

  const outsideIdx = world.idx(17, 24);
  const boundaryIdx = world.idx(18, 24);
  const generatedIdx = world.idx(26, 24);
  world.cells[outsideIdx] = Cell.FLOOR;
  world.floorTex[outsideIdx] = Tex.F_LINO;
  world.zones[0].faction = ZoneFaction.CITIZEN;
  world.zones[0].fogged = false;
  world.zones[0].level = 7;

  assert.equal(startSamosborWave(world, entities, state, 'small', 24, 24, { seed: 55, radius: 4, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);
  world.fog[generatedIdx] = 180;
  const replacementWorld = makeReplacementWorld();
  replacementWorld.zones[0].faction = ZoneFaction.CULTIST;
  replacementWorld.zones[0].fogged = true;
  replacementWorld.zones[0].level = 2;
  const replacement = { world: replacementWorld, entities: [], spawnX: 24.5, spawnY: 24.5 };
  const finished = finishSamosborWave(world, entities, state, replacement);

  assert.equal(world.cells[generatedIdx], Cell.FLOOR);
  assert.equal(world.floorTex[generatedIdx], Tex.F_TILE);
  assert.equal(world.fog[generatedIdx], 180);
  assert.equal(world.zones[0].faction, ZoneFaction.CITIZEN);
  assert.equal(world.zones[0].fogged, false);
  assert.equal(world.zones[0].level, 7);
  const generatedRoom = world.rooms[world.roomMap[generatedIdx]];
  assert.equal(generatedRoom?.type, RoomType.KITCHEN);
  assert.equal(generatedRoom?.name, 'Сгенерированная кухня');
  assert.equal(world.cells[outsideIdx], Cell.FLOOR);
  assert.equal(world.floorTex[outsideIdx], Tex.F_LINO);
  assert.equal(world.cells[boundaryIdx], Cell.FLOOR);
  assert.equal(world.aptMask[protectedIdx], 1);
  assert.equal(world.hermoWall[protectedIdx], 1);
  assert.equal(world.cells[protectedIdx], Cell.FLOOR);
  assert.equal(world.roomMap[protectedIdx], protectedRoom.id);
  assert.equal(world.floorTex[protectedIdx], Tex.F_WOOD);
  assert.ok((finished?.fieldCells ?? 0) > 0);
  assert.ok((finished?.regeneratedCells ?? 0) > 0);
  assert.ok((finished?.stitchedCells ?? 0) > 0);
});

test('finished local samosbor wave copies fresh replacement geometry inside the field only', () => {
  const { world, state, entities } = makeOpenWaveWorld();
  const insideIdx = world.idx(24, 24);
  const outsideIdx = world.idx(17, 24);
  world.cells[insideIdx] = Cell.FLOOR;
  world.floorTex[insideIdx] = Tex.F_LINO;
  setVisualSlot(world, insideIdx, 0, 23);
  world.cells[outsideIdx] = Cell.FLOOR;
  world.floorTex[outsideIdx] = Tex.F_WOOD;
  setVisualSlot(world, outsideIdx, 0, 24);

  assert.equal(startSamosborWave(world, entities, state, 'small', 24, 24, { seed: 77, radius: 4, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);
  const beforePatchCell = world.cells[insideIdx];
  const beforePatchFloorTex = world.floorTex[insideIdx];

  const replacementWorld = makeReplacementWorld();
  replacementWorld.cells[insideIdx] = Cell.WATER;
  replacementWorld.floorTex[insideIdx] = Tex.F_ABYSS;
  replacementWorld.wallTex[insideIdx] = Tex.DARK;
  setVisualSlot(replacementWorld, insideIdx, 0, 3);
  const replacement = { world: replacementWorld, entities: [], spawnX: 24.5, spawnY: 24.5 };
  const finished = finishSamosborWave(world, entities, state, replacement);

  assert.notEqual(beforePatchCell, Cell.WATER);
  assert.notEqual(beforePatchFloorTex, Tex.F_ABYSS);
  assert.equal(world.cells[insideIdx], Cell.WATER);
  assert.equal(world.floorTex[insideIdx], Tex.F_ABYSS);
  assert.equal(getVisualSlot(world, insideIdx, 0), 3);
  assert.equal(world.cells[outsideIdx], Cell.FLOOR);
  assert.equal(world.floorTex[outsideIdx], Tex.F_WOOD);
  assert.equal(getVisualSlot(world, outsideIdx, 0), 24);
  assert.ok((finished?.regeneratedCells ?? 0) > 0);
});

test('finished local samosbor wave does not patch behind a hermowall barrier', () => {
  const { world, state, entities } = makeOpenWaveWorld(24, 24, 10);
  for (let y = 14; y <= 34; y++) {
    const idx = world.idx(25, y);
    world.cells[idx] = Cell.WALL;
    world.hermoWall[idx] = 1;
    world.aptMask[idx] = 1;
  }
  const behindIdx = world.idx(29, 24);
  world.cells[behindIdx] = Cell.FLOOR;
  world.floorTex[behindIdx] = Tex.F_WOOD;

  assert.equal(startSamosborWave(world, entities, state, 'small', 20, 24, { seed: 90, radius: 8, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);

  const replacementWorld = makeReplacementWorld();
  replacementWorld.cells[behindIdx] = Cell.WATER;
  replacementWorld.floorTex[behindIdx] = Tex.F_ABYSS;
  const replacement = { world: replacementWorld, entities: [], spawnX: 20.5, spawnY: 24.5 };

  finishSamosborWave(world, entities, state, replacement);

  assert.equal(world.cells[behindIdx], Cell.FLOOR);
  assert.equal(world.floorTex[behindIdx], Tex.F_WOOD);
});

test('finished local samosbor wave treats hermetic doors as a patch barrier', () => {
  const { world, state, entities } = makeOpenWaveWorld(24, 24, 10);
  for (let y = 14; y <= 34; y++) {
    const idx = world.idx(25, y);
    world.cells[idx] = Cell.DOOR;
    world.wallTex[idx] = Tex.DOOR_METAL;
    world.doors.set(idx, { idx, state: DoorState.HERMETIC_CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  }
  const behindIdx = world.idx(29, 24);
  world.cells[behindIdx] = Cell.FLOOR;
  world.floorTex[behindIdx] = Tex.F_WOOD;

  assert.equal(startSamosborWave(world, entities, state, 'small', 20, 24, { seed: 91, radius: 8, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);

  const replacementWorld = makeReplacementWorld();
  replacementWorld.cells[behindIdx] = Cell.WATER;
  replacementWorld.floorTex[behindIdx] = Tex.F_ABYSS;
  const replacement = { world: replacementWorld, entities: [], spawnX: 20.5, spawnY: 24.5 };

  finishSamosborWave(world, entities, state, replacement);

  assert.equal(world.cells[behindIdx], Cell.FLOOR);
  assert.equal(world.floorTex[behindIdx], Tex.F_WOOD);
  for (let y = 14; y <= 34; y++) {
    const idx = world.idx(25, y);
    assert.equal(world.cells[idx], Cell.DOOR);
    assert.equal(world.doors.get(idx)?.state, DoorState.HERMETIC_CLOSED);
  }
});

test('finished local samosbor wave strips replacement doors instead of leaving door traces', () => {
  const { world, state, entities } = makeOpenWaveWorld();
  const doorIdx = world.idx(24, 24);

  assert.equal(startSamosborWave(world, entities, state, 'small', 24, 24, { seed: 88, radius: 4, budgetCellsPerTick: 64 }), true);
  runWaveToEnd(world, entities, state);

  const replacementWorld = makeReplacementWorld();
  replacementWorld.cells[doorIdx] = Cell.DOOR;
  replacementWorld.wallTex[doorIdx] = Tex.DOOR_METAL;
  replacementWorld.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: 0, roomB: 1, keyId: '', timer: 0 });
  const replacement = { world: replacementWorld, entities: [], spawnX: 24.5, spawnY: 24.5 };

  finishSamosborWave(world, entities, state, replacement);

  assert.equal(world.cells[doorIdx], Cell.FLOOR);
  assert.equal(world.wallTex[doorIdx] === Tex.DOOR_WOOD || world.wallTex[doorIdx] === Tex.DOOR_METAL, false);
  assert.equal(world.doors.has(doorIdx), false);
  for (const room of world.rooms) {
    if (!room) continue;
    assert.equal(room.doors.includes(doorIdx), false);
  }
  assert.equal(world.solid(24, 24), false);
});
