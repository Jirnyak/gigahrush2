import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  LiftDirection,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type Zone,
} from '../src/core/types';
import { pathBlockedAt } from '../src/core/path_blockers';
import { SURFACE_FLAG_CHALK_MAP, World } from '../src/core/world';
import { floorKeyForFloorInstance, floorKeyForProcedural, floorKeyForStory } from '../src/data/floor_keys';
import { PROCEDURAL_FLOOR_ZS, proceduralFloorKey } from '../src/data/procedural_floors';
import {
  collectFloorLiftAnchors,
  captureFloorMemory,
  clearFloorMemory,
  ensureFloorRouteLiftLayout,
  floorMemoryStats,
  floorMemoryStateForSave,
  restoreFloorMemoryFromSave,
  setFloorMemoryByteBudgetForTests,
  setFloorMemorySaveByteBudgetForTests,
  takeFloorMemory,
  tryBase64ToBytes,
} from '../src/systems/floor_memory';
import { canActorOccupy } from '../src/systems/movement_collision';

const HUMAN_R = 0.16;

function proceduralMemoryKeyAt(index: number): string {
  const z = PROCEDURAL_FLOOR_ZS[index];
  assert.equal(typeof z, 'number');
  return floorKeyForProcedural(proceduralFloorKey(z));
}

function entity(id: number, type: EntityType): Entity {
  return {
    id,
    type,
    x: 10.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
  };
}

function testRoom(id: number, doors: number[] = []): Room {
  return {
    id,
    type: RoomType.COMMON,
    x: 0,
    y: 0,
    w: 4,
    h: 4,
    doors,
    sealed: false,
    name: `room ${id}`,
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
}

function testZone(id: number, hasLift: boolean): Zone {
  return {
    id,
    cx: id * 128 + 64,
    cy: 64,
    faction: ZoneFaction.CITIZEN,
    hasLift,
    fogged: false,
    level: 0,
    hqRoomId: -1,
  };
}

function minLiftDistance(world: World, direction: LiftDirection): number {
  const anchors = collectFloorLiftAnchors(world, direction);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      min = Math.min(
        min,
        world.dist(
          anchors[i].liftX + 0.5,
          anchors[i].liftY + 0.5,
          anchors[j].liftX + 0.5,
          anchors[j].liftY + 0.5,
        ),
      );
    }
  }
  return min;
}

test('floor memory restores live world and keeps only persistent floor entities', () => {
  clearFloorMemory();
  const world = new World();
  const surface = new Uint8Array([1, 2, 3, 4]);
  world.surfaceMap.set(world.idx(12, 13), surface);

  const player = entity(1, EntityType.NPC);
  player.persistentNpcId = 'player';
  const npc = entity(2, EntityType.NPC);
  const projectile = entity(3, EntityType.PROJECTILE);
  assert.equal(captureFloorMemory(' route:test ', world, [player, npc, projectile], 12.5, 13.5, 90, 2), true);

  const loaded = takeFloorMemory('route:test');
  assert.ok(loaded);
  assert.equal(loaded.fromMemory, true);
  assert.equal(loaded.generation.world, world);
  assert.equal(loaded.generation.world.surfaceMap.get(world.idx(12, 13)), surface);
  assert.deepEqual(loaded.generation.entities.map(e => e.id), [2]);
  assert.equal(loaded.generation.spawnX, 12.5);
  assert.equal(loaded.generation.spawnY, 13.5);
  assert.equal((loaded.generation as { skyProvider?: unknown }).skyProvider, undefined);
  assert.equal(takeFloorMemory('route:test'), null, 'load is single-use while the floor is active');
  clearFloorMemory();
});

test('floor memory carries generation extras such as dynamic sky providers', () => {
  clearFloorMemory();
  const world = new World();
  const skyProvider = { update: () => false, dirty: false };
  assert.equal(captureFloorMemory('design:roof', world, [], 1.5, 2.5, 0, 0, { skyProvider }), true);

  const loaded = takeFloorMemory('design:roof');
  assert.ok(loaded);
  assert.equal((loaded.generation as { skyProvider?: unknown }).skyProvider, skyProvider);
  clearFloorMemory();
});

test('floor memory save restores full world snapshot without regenerating baseline', () => {
  clearFloorMemory();
  const key = proceduralMemoryKeyAt(0);
  const world = new World();
  const cellIdx = world.idx(17, 19);
  world.cells[cellIdx] = Cell.FLOOR;
  world.features[cellIdx] = Feature.SCREEN;
  world.rooms = [testRoom(0), testRoom(1), testRoom(2)];
  world.apartmentRoomCount = 2;
  world.surfaceMap.set(cellIdx, new Uint8Array(16 * 16 * 4).fill(7));
  world.surfaceFlags[cellIdx] |= SURFACE_FLAG_CHALK_MAP;
  world.addContainer({
    id: 44,
    x: 17,
    y: 19,
    floor: 0,
    roomId: -1,
    zoneId: 0,
    kind: 0,
    name: 'snapshot box',
    inventory: [{ defId: 'bread', count: 1 }],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: ['snapshot'],
  });
  const npc = entity(9, EntityType.NPC);
  npc.x = 17.5;
  npc.y = 19.5;

  assert.equal(captureFloorMemory(key, world, [npc], 17.5, 19.5, 12, 3), true);
  const saved = floorMemoryStateForSave();
  assert.equal(saved.entries[0]?.world.apartmentRoomCount, 2);
  clearFloorMemory();

  const restored = restoreFloorMemoryFromSave(saved);
  assert.equal(restored.restored, 1);
  const loaded = takeFloorMemory(key);
  assert.ok(loaded);
  const restoredWorld = loaded.generation.world;
  assert.equal(restoredWorld.apartmentRoomCount, 2);
  assert.equal(restoredWorld.cells[cellIdx], Cell.FLOOR);
  assert.equal(restoredWorld.features[cellIdx], Feature.SCREEN);
  assert.equal(restoredWorld.surfaceMap.get(cellIdx)?.[0], 7);
  assert.equal((restoredWorld.surfaceFlags[cellIdx] & SURFACE_FLAG_CHALK_MAP) !== 0, true);
  assert.equal(restoredWorld.containers[0]?.name, 'snapshot box');
  assert.deepEqual(loaded.generation.entities.map(e => e.id), [9]);
  assert.equal(loaded.generation.spawnX, 17.5);
  assert.equal(loaded.generation.spawnY, 19.5);
  clearFloorMemory();
});

test('floor memory packed restore rebuilds fine blockers from saved features and containers', () => {
  clearFloorMemory();
  const key = floorKeyForStory(FloorLevel.LIVING);
  const world = new World();
  for (let y = 41; y <= 45; y++) {
    for (let x = 40; x <= 47; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }

  const tableIdx = world.idx(42, 43);
  world.features[tableIdx] = Feature.TABLE;
  world.addContainer({
    id: 88,
    x: 45,
    y: 43,
    floor: 0,
    roomId: -1,
    zoneId: -1,
    kind: ContainerKind.METAL_CABINET,
    name: 'restored cabinet',
    inventory: [],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: ['blocker_restore'],
  });

  assert.equal(captureFloorMemory(key, world, [], 40.5, 41.5, 1, 0), true);
  const saved = floorMemoryStateForSave();
  assert.ok(saved.entries.some(entry => entry.key === key));
  clearFloorMemory();

  const restored = restoreFloorMemoryFromSave(saved);
  assert.equal(restored.restored, 1);
  const loaded = takeFloorMemory(key);
  assert.ok(loaded);

  const restoredWorld = loaded.generation.world;
  assert.equal(restoredWorld.features[tableIdx], Feature.TABLE);
  assert.equal(restoredWorld.containers[0]?.kind, ContainerKind.METAL_CABINET);
  assert.equal(pathBlockedAt(restoredWorld, 42.5, 43.5), true);
  assert.equal(pathBlockedAt(restoredWorld, 45.5, 43.5), true);
  assert.equal(canActorOccupy(restoredWorld, 42.5, 43.5, HUMAN_R), false);
  assert.equal(canActorOccupy(restoredWorld, 45.5, 43.5, HUMAN_R), false);
  clearFloorMemory();
});

test('floor memory save view is capped and prefers newest entries', () => {
  clearFloorMemory();
  setFloorMemoryByteBudgetForTests(1);
  for (let i = 0; i < 32; i++) {
    assert.equal(captureFloorMemory(`story:cap_${i}`, new World(), [], 1, 1, i, 0), true);
  }

  const saved = floorMemoryStateForSave();
  assert.ok(saved.entries.length < 32);
  assert.ok(saved.bytes <= saved.byteBudget);
  assert.ok(saved.entries.some(entry => entry.key === 'story:cap_31'));
  assert.equal(saved.entries.some(entry => entry.key === 'story:cap_0'), false);

  setFloorMemoryByteBudgetForTests(undefined);
  clearFloorMemory();
});

test('floor memory restore keeps saved entries packed and capped until take', () => {
  clearFloorMemory();
  const world = new World();
  assert.equal(captureFloorMemory(proceduralMemoryKeyAt(0), world, [entity(50, EntityType.NPC)], 3, 4, 1, 0), true);
  const template = floorMemoryStateForSave().entries[0];
  assert.ok(template);

  const entries = Array.from({ length: 32 }, (_, i) => ({
    ...JSON.parse(JSON.stringify(template)),
    key: proceduralMemoryKeyAt(i),
    capturedAt: i,
  }));
  clearFloorMemory();

  const restored = restoreFloorMemoryFromSave({
    version: 1,
    entries,
    bytes: 0,
    byteBudget: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(restored.restored, 24);
  assert.equal(restored.keys.length, 24);

  const stats = floorMemoryStats();
  assert.equal(stats.fullCount, 0);
  assert.equal(stats.packedCount, 24);
  assert.ok(takeFloorMemory(proceduralMemoryKeyAt(23)));
  assert.equal(floorMemoryStats().fullCount, 0);
  assert.equal(floorMemoryStats().packedCount, 23);
  assert.equal(takeFloorMemory(proceduralMemoryKeyAt(31)), null);
  clearFloorMemory();
});

test('floor memory restore skips unknown keys before applying restored entry cap', () => {
  clearFloorMemory();
  const validKey = floorKeyForStory(FloorLevel.LIVING);
  const staleInstanceKey = floorKeyForFloorInstance('not_registered');
  assert.equal(captureFloorMemory(validKey, new World(), [entity(60, EntityType.NPC)], 5, 6, 2, 0), true);
  const template = floorMemoryStateForSave().entries[0];
  assert.ok(template);

  const unknownEntries = Array.from({ length: 23 }, (_, i) => ({
    ...JSON.parse(JSON.stringify(template)),
    key: `design:missing_${i}`,
    capturedAt: i,
  }));
  const entries = [
    ...unknownEntries,
    { ...JSON.parse(JSON.stringify(template)), key: staleInstanceKey, capturedAt: 23 },
    { ...JSON.parse(JSON.stringify(template)), key: validKey, capturedAt: 24 },
  ];
  clearFloorMemory();

  const restored = restoreFloorMemoryFromSave({
    version: 1,
    entries,
    bytes: 0,
    byteBudget: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(restored.restored, 1);
  assert.equal(restored.skipped, 24);
  assert.deepEqual(restored.keys, [validKey]);
  assert.equal(takeFloorMemory(staleInstanceKey), null);
  assert.ok(takeFloorMemory(validKey));
  clearFloorMemory();
});

test('floor memory restore resolves generation extras lazily when packed memory is taken', () => {
  clearFloorMemory();
  const key = floorKeyForStory(FloorLevel.LIVING);
  assert.equal(captureFloorMemory(key, new World(), [], 3, 4, 1, 0), true);
  const saved = floorMemoryStateForSave();
  clearFloorMemory();

  let calls = 0;
  const restored = restoreFloorMemoryFromSave(saved, {
    generationExtrasForKey: restoredKey => {
      calls++;
      return { lazyExtraKey: restoredKey };
    },
  });
  assert.equal(restored.restored, 1);
  assert.equal(calls, 0);

  const loaded = takeFloorMemory(key);
  assert.ok(loaded);
  assert.equal(calls, 1);
  assert.equal((loaded.generation as { lazyExtraKey?: string }).lazyExtraKey, key);
  clearFloorMemory();
});

test('floor memory save byte cap skips oversized entries', () => {
  clearFloorMemory();
  setFloorMemorySaveByteBudgetForTests(4096);
  assert.equal(captureFloorMemory('story:small_save', new World(), [], 1, 1, 1, 0), true);

  const huge = new World();
  for (let i = 0; i < 20; i++) {
    huge.surfaceMap.set(huge.idx(100 + i, 100), new Uint8Array(16 * 16 * 4).fill(i + 1));
  }
  assert.equal(captureFloorMemory('story:huge_save', huge, [], 1, 1, 2, 0), true);

  const saved = floorMemoryStateForSave();
  assert.ok(saved.bytes <= saved.byteBudget);
  assert.ok(saved.entries.some(entry => entry.key === 'story:small_save'));
  assert.equal(saved.entries.some(entry => entry.key === 'story:huge_save'), false);

  setFloorMemorySaveByteBudgetForTests(undefined);
  clearFloorMemory();
});

test('floor memory restore sanitizes billboard props as non-item entities', () => {
  clearFloorMemory();
  const key = floorKeyForStory(FloorLevel.LIVING);
  const world = new World();
  const billboard = entity(55, EntityType.BILLBOARD);
  billboard.inventory = [{ defId: 'bread', count: 1 }];
  assert.equal(captureFloorMemory(key, world, [billboard], 10.5, 10.5, 1, 0), true);

  const saved = floorMemoryStateForSave();
  const entry = JSON.parse(JSON.stringify(saved.entries[0])) as typeof saved.entries[number] & { entities: unknown[] };
  (entry.entities[0] as Record<string, unknown>).x = 'bad';
  entry.entities.push({ id: 99, type: 999, x: 1, y: 1, angle: 0, pitch: 0, alive: true, speed: 0, sprite: 0 });

  clearFloorMemory();
  const restored = restoreFloorMemoryFromSave({ version: 1, entries: [entry], bytes: 0, byteBudget: 0 });
  assert.equal(restored.restored, 1);

  const loaded = takeFloorMemory(key);
  assert.ok(loaded);
  assert.equal(loaded.generation.entities.length, 1);
  const restoredBillboard = loaded.generation.entities[0];
  assert.equal(restoredBillboard.type, EntityType.BILLBOARD);
  assert.equal(restoredBillboard.inventory, undefined);
  assert.equal(restoredBillboard.x, W / 2);
  clearFloorMemory();
});

test('floor memory restore skips corrupt snapshots and malformed nested entries', () => {
  clearFloorMemory();
  const goodKey = floorKeyForStory(FloorLevel.LIVING);
  const badKey = floorKeyForStory(FloorLevel.MINISTRY);
  const world = new World();
  const idx = world.idx(21, 22);
  world.cells[idx] = Cell.FLOOR;
  world.surfaceMap.set(idx, new Uint8Array(16 * 16 * 4).fill(9));
  assert.equal(captureFloorMemory(goodKey, world, [entity(40, EntityType.NPC)], 21.5, 22.5, 5, 0), true);
  const saved = floorMemoryStateForSave();
  const good = JSON.parse(JSON.stringify(saved.entries[0])) as typeof saved.entries[number];
  good.world.surfaceMap.push([world.idx(23, 24), 'not valid base64']);
  const badRle = JSON.parse(JSON.stringify(good)) as typeof good;
  (good.entities as unknown[]).push({ id: BigInt(41), type: EntityType.NPC });
  badRle.key = badKey;
  badRle.world.arrays[0].data = 'AAAA';

  clearFloorMemory();
  const restored = restoreFloorMemoryFromSave({
    version: 1,
    entries: [good, badRle],
    bytes: 0,
    byteBudget: 0,
  });
  assert.equal(restored.restored, 1);
  assert.equal(restored.skipped, 1);

  const loaded = takeFloorMemory(goodKey);
  assert.ok(loaded);
  assert.equal(loaded.generation.world.surfaceMap.get(idx)?.[0], 9);
  assert.deepEqual(loaded.generation.entities.map(e => e.id), [40]);
  assert.equal(takeFloorMemory(badKey), null);
  clearFloorMemory();
});

test('floor memory restore sanitizes invalid doors and malformed containers before hydration', () => {
  clearFloorMemory();
  const key = floorKeyForStory(FloorLevel.LIVING);
  const world = new World();
  const doorIdx = world.idx(30, 30);
  world.cells[doorIdx] = Cell.DOOR;
  world.rooms = [testRoom(0, [doorIdx])];
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.OPEN,
    roomA: 0,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  world.addContainer({
    id: 77,
    x: 31,
    y: 30,
    floor: 0,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.METAL_CABINET,
    name: 'valid box',
    inventory: [{ defId: 'bread', count: 2 }],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: ['valid'],
  });

  assert.equal(captureFloorMemory(key, world, [], 30.5, 31.5, 1, 0), true);
  const saved = floorMemoryStateForSave();
  const entry = JSON.parse(JSON.stringify(saved.entries[0])) as typeof saved.entries[number];
  entry.world.doors[0][1].state = 999;
  entry.world.doors.push([world.idx(31, 31), {
    idx: world.idx(31, 31),
    state: DoorState.OPEN,
    roomA: 0,
    roomB: -1,
    keyId: '',
    timer: 0,
  }]);
  (entry.world.containers as unknown[]).push({
    id: 'bad',
    x: 'nope',
    y: 30,
    floor: 0,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.SAFE,
    name: 'bad box',
    inventory: [{ defId: 'ammo_9x18', count: 1 }],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: ['bad'],
  });

  clearFloorMemory();
  const restored = restoreFloorMemoryFromSave({ version: 1, entries: [entry], bytes: 0, byteBudget: 0 });
  assert.equal(restored.restored, 1);
  assert.equal(floorMemoryStats().packedCount, 1);

  const loaded = takeFloorMemory(key);
  assert.ok(loaded);
  const restoredWorld = loaded.generation.world;
  assert.equal(restoredWorld.doors.get(doorIdx)?.state, DoorState.CLOSED);
  assert.equal(restoredWorld.solid(30, 30), true);
  assert.equal(restoredWorld.doors.has(world.idx(31, 31)), false);
  assert.equal(restoredWorld.containers.length, 1);
  assert.equal(restoredWorld.containerById.get(77)?.name, 'valid box');
  assert.equal(restoredWorld.containerById.has(Number.NaN), false);
  clearFloorMemory();
});

test('floor memory byte budget evicts least-recent captured floors', () => {
  clearFloorMemory();
  setFloorMemoryByteBudgetForTests(1);
  assert.equal(captureFloorMemory('story:one', new World(), [], 1, 1, 0, 0), true);
  assert.equal(captureFloorMemory('story:two', new World(), [], 2, 2, 0, 0), true);
  const stats = floorMemoryStats();
  assert.equal(stats.fullCount, 1);
  assert.equal(stats.packedCount, 1);
  assert.ok(takeFloorMemory('story:one'));
  assert.ok(takeFloorMemory('story:two'));
  setFloorMemoryByteBudgetForTests(undefined);
  clearFloorMemory();
});

test('route lift layout mirrors return lifts and normalizes both directions to sixteen', () => {
  const source = new World();
  const target = new World();
  for (let y = 24; y <= 72; y++) {
    for (let x = 24; x <= 72; x++) {
      source.cells[source.idx(x, y)] = Cell.FLOOR;
      target.cells[target.idx(x, y)] = Cell.FLOOR;
    }
  }

  const anchors = [
    [30, 30], [38, 30], [46, 30], [54, 30],
    [30, 46], [38, 46], [46, 46], [54, 46],
    [62, 46], [30, 62], [38, 62], [46, 62],
    [54, 62], [62, 62], [62, 30], [70, 62],
  ] as const;
  for (const [x, y] of anchors) {
    const liftIdx = source.idx(x, y);
    const buttonIdx = source.idx(x, y + 1);
    source.cells[liftIdx] = Cell.LIFT;
    source.liftDir[liftIdx] = LiftDirection.DOWN;
    source.features[buttonIdx] = Feature.LIFT_BUTTON;
    source.liftDir[buttonIdx] = LiftDirection.DOWN;
    target.features[target.idx(x, y + 1)] = Feature.LIFT_BUTTON;
    target.liftDir[target.idx(x, y + 1)] = LiftDirection.UP;
  }

  const mirror = collectFloorLiftAnchors(source, LiftDirection.DOWN);
  const result = ensureFloorRouteLiftLayout(target, 32.5, 31.5, [LiftDirection.DOWN, LiftDirection.UP], {
    mirror: { direction: LiftDirection.UP, anchors: mirror },
  });

  assert.equal(result.up, 16);
  assert.equal(result.down, 16);
  assert.equal(result.mirrored, 16);
  for (const anchor of mirror) {
    const liftIdx = target.idx(anchor.liftX, anchor.liftY);
    assert.equal(target.cells[liftIdx], Cell.LIFT);
    assert.equal(target.liftDir[liftIdx], LiftDirection.UP);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      assert.notEqual(target.features[target.idx(anchor.liftX + dx, anchor.liftY + dy)], Feature.LIFT_BUTTON);
    }
  }
});

test('route lift layout distributes filled lifts across the reachable floor', () => {
  const world = new World();
  for (let y = 100; y < 356; y++) {
    for (let x = 100; x < 356; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }

  const result = ensureFloorRouteLiftLayout(world, 228.5, 228.5, [LiftDirection.DOWN], {
    countPerDirection: 8,
  });

  assert.equal(result.down, 8);
  assert.equal(result.placed, 8);
  assert.equal(minLiftDistance(world, LiftDirection.DOWN) >= 96, true);
});

test('route lift layout redistributes existing clustered route lifts', () => {
  const world = new World();
  for (let y = 100; y < 356; y++) {
    for (let x = 100; x < 356; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }
  for (let i = 0; i < 8; i++) {
    const liftIdx = world.idx(220 + i, 220);
    world.cells[liftIdx] = Cell.LIFT;
    world.wallTex[liftIdx] = Tex.LIFT_DOOR;
    world.liftDir[liftIdx] = LiftDirection.DOWN;
  }

  const result = ensureFloorRouteLiftLayout(world, 228.5, 228.5, [LiftDirection.DOWN], {
    countPerDirection: 8,
  });

  assert.equal(result.down, 8);
  assert.equal(result.demoted, 8);
  assert.equal(result.placed, 8);
  assert.equal(minLiftDistance(world, LiftDirection.DOWN) >= 96, true);
});

test('route lift layout recomputes zone lift flags after demotion and placement', () => {
  const world = new World();
  world.zones = [testZone(0, true), testZone(1, false)];
  world.zoneMap.fill(0);

  const staleLiftIdx = world.idx(12, 12);
  world.cells[staleLiftIdx] = Cell.LIFT;
  world.liftDir[staleLiftIdx] = LiftDirection.DOWN;
  world.zoneMap[staleLiftIdx] = 0;

  for (let y = 40; y <= 48; y++) {
    for (let x = 40; x <= 48; x++) {
      const idx = world.idx(x, y);
      world.cells[idx] = Cell.FLOOR;
      world.zoneMap[idx] = 1;
    }
  }

  const result = ensureFloorRouteLiftLayout(world, 44.5, 44.5, [LiftDirection.UP], {
    countPerDirection: 1,
  });

  assert.equal(result.demoted, 1);
  assert.equal(result.up, 1);
  assert.equal(world.zones[0]?.hasLift, false);
  assert.equal(world.zones[1]?.hasLift, true);
});

test('route lift layout forces mirrored anchors by carving bounded access', () => {
  const source = new World();
  const target = new World();
  const sourceLift = source.idx(80, 80);
  source.cells[sourceLift] = Cell.LIFT;
  source.liftDir[sourceLift] = LiftDirection.DOWN;

  for (let x = 10; x <= 16; x++) {
    target.cells[target.idx(x, 10)] = Cell.FLOOR;
  }

  const mirror = collectFloorLiftAnchors(source, LiftDirection.DOWN);
  const result = ensureFloorRouteLiftLayout(target, 10.5, 10.5, [LiftDirection.UP], {
    countPerDirection: 1,
    mirror: { direction: LiftDirection.UP, anchors: mirror },
  });

  assert.equal(result.up, 1);
  assert.equal(result.mirrored, 1);
  assert.equal(target.cells[target.idx(80, 80)], Cell.LIFT);
  assert.equal(target.liftDir[target.idx(80, 80)], LiftDirection.UP);
  assert.equal(
    [
      target.idx(80, 79),
      target.idx(80, 81),
      target.idx(79, 80),
      target.idx(81, 80),
    ].some(idx => target.cells[idx] === Cell.FLOOR),
    true,
  );
});
test('tryBase64ToBytes handles invalid base64 by returning null', () => {
  const originalBuffer = globalThis.Buffer;
  (globalThis as any).Buffer = undefined;
  try {
    assert.equal(tryBase64ToBytes('%%%'), null);
  } finally {
    globalThis.Buffer = originalBuffer;
  }
});
