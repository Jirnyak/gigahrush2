import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, RoomType, Tex, W } from '../src/core/types';
import { World, setVisualSlot as setWorldVisualSlot } from '../src/core/world';
import { fillVisualSlotsForRoomDecor } from '../src/gen/visual_cell_slots';
import type { CameraView } from '../src/systems/camera';
import { resolveVisualGeometryProfile } from '../src/data/visual_geometry_profiles';
import { visualModelDef, type VisualModelId } from '../src/data/visual_models';
import {
  collectMeshScene,
  collectMeshSceneWithStats,
  capMeshInstances,
  MeshInstanceFlag,
  VISUAL_CELL_CODES,
  VISUAL_SLOTS_PER_CELL,
  type MeshInstance,
  type MeshPassContext,
} from '../src/render/mesh/scene_collect';
import { addTestRoom } from './helpers';

function actualMeshBounds(instance: { modelId: string; scaleX: number; scaleY: number; scaleZ: number }): { x: number; y: number; z: number } {
  const bounds = visualModelDef(instance.modelId as VisualModelId).bounds;
  return {
    x: bounds.x * instance.scaleX,
    y: bounds.y * instance.scaleY,
    z: bounds.z * instance.scaleZ,
  };
}

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
  world.rooms.push({
    id: 0,
    type: RoomType.COMMON,
    x: 0,
    y: 0,
    w: W,
    h: W,
    doors: [],
    sealed: false,
    name: 'test room',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  });
  world.roomMap.fill(0);
  return world;
}

function corridorWorld(roomType = RoomType.CORRIDOR, width = 18): World {
  const world = new World();
  const room = {
    id: 0,
    type: roomType,
    x: 4,
    y: 10,
    w: width,
    h: 1,
    doors: [],
    sealed: false,
    name: 'test corridor',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms.push(room);
  for (let x = room.x; x < room.x + room.w; x++) {
    const idx = world.idx(x, room.y);
    world.cells[idx] = Cell.FLOOR;
    world.roomMap[idx] = room.id;
  }
  return world;
}

function camera(x: number, y: number): CameraView {
  return {
    mode: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    height: 0.5,
    fovRadians: Math.PI / 2,
  };
}

function context(world: World, x = 10.5, y = 10.5, seed = 123, overrides: Partial<MeshPassContext> = {}): MeshPassContext {
  const base: MeshPassContext = {
    world,
    camera: camera(x, y),
    floorKey: 'test:mesh',
    seed,
    time: 0,
    profile: { radius: 8, instanceCap: 64, ceilingDetail: 0, furnitureDetail: 0 },
  };
  return {
    ...base,
    ...overrides,
    profile: { ...(base.profile ?? {}), ...(overrides.profile ?? {}) },
  };
}

function attachVisualSlots(world: World): Uint8Array {
  const slots = new Uint8Array(W * W * VISUAL_SLOTS_PER_CELL);
  (world as World & { visualSlots: Uint8Array; visualSlotVersion: number }).visualSlots = slots;
  (world as World & { visualSlots: Uint8Array; visualSlotVersion: number }).visualSlotVersion = 1;
  return slots;
}

function setVisualSlot(world: World, slots: Uint8Array, x: number, y: number, code: number, slot = 0): void {
  slots[world.idx(x, y) * VISUAL_SLOTS_PER_CELL + slot] = code;
}

test('feature mapping creates expected model id', () => {
  const world = openWorld();
  world.features[world.idx(10, 10)] = Feature.TABLE;

  const instances = collectMeshScene(context(world));

  assert.equal(instances.some(instance => instance.modelId === 'table_slab'), true);
});

test('tutorial slide features stay texture-only and do not emit mesh panels', () => {
  const world = openWorld();
  const idx = world.idx(10, 10);
  world.cells[idx] = Cell.WALL;
  world.features[idx] = Feature.SLIDE;

  const instances = collectMeshScene(context(world));

  assert.equal(instances.some(instance => instance.modelId === 'wall_panel_flat'), false);
  assert.equal(instances.some(instance => (instance.flags & MeshInstanceFlag.Feature) !== 0), false);
});

test('feature visual slot suppresses duplicate feature fallback mesh', () => {
  const world = openWorld();
  const idx = world.idx(10, 10);
  world.features[idx] = Feature.TABLE;
  setWorldVisualSlot(world, idx, 0, VISUAL_CELL_CODES.FURNITURE_TABLE_HINT);

  const instances = collectMeshScene(context(world));

  assert.equal(instances.some(instance => instance.modelId === 'table_slab'), false);
  assert.equal(instances.filter(instance => instance.modelId === 'furniture_table_hint').length, 1);
});

test('furniture visual slots keep floor-scale proportions', () => {
  const world = openWorld();
  setWorldVisualSlot(world, world.idx(10, 10), 0, VISUAL_CELL_CODES.FURNITURE_TABLE_HINT);
  setWorldVisualSlot(world, world.idx(11, 10), 0, VISUAL_CELL_CODES.FURNITURE_DESK_HINT);
  setWorldVisualSlot(world, world.idx(12, 10), 0, VISUAL_CELL_CODES.FURNITURE_CHAIR_HINT);
  setWorldVisualSlot(world, world.idx(13, 10), 0, VISUAL_CELL_CODES.FURNITURE_BED_HINT);

  const instances = collectMeshScene(context(world, 11.5, 10.5, 123, {
    profile: { radius: 6, instanceCap: 64, visualSlotInstanceCap: 64 },
  }));

  const table = instances.find(instance => instance.modelId === 'furniture_table_hint');
  const desk = instances.find(instance => instance.modelId === 'desk_slab');
  const chair = instances.find(instance => instance.modelId === 'chair_simple');
  const bed = instances.find(instance => instance.modelId === 'bed_frame');
  assert.ok(table);
  assert.ok(desk);
  assert.ok(chair);
  assert.ok(bed);
  assert.ok(actualMeshBounds(table).z < 0.3);
  assert.ok(actualMeshBounds(desk).z < 0.35);
  assert.ok(actualMeshBounds(chair).z < 0.55);
  assert.ok(actualMeshBounds(bed).z < 0.25);
  assert.equal(table.scaleZ, 0.42);
  assert.equal(desk.scaleZ, 0.48);
});

test('lamp feature stays a ceiling visual slot instead of a floor stand', () => {
  const world = openWorld();
  const lamp = world.idx(10, 10);
  world.features[lamp] = Feature.LAMP;
  setWorldVisualSlot(world, lamp, 0, VISUAL_CELL_CODES.CEILING_BULB);

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, { profile: { radius: 12, includeVisualSlots: true, instanceCap: 96 } }));

  assert.equal(instances.some(instance => instance.modelId === 'lamp_stand'), false);
  assert.equal(instances.some(instance => instance.modelId === 'ceiling_bulb' || instance.modelId === 'ceiling_light_panel'), true);
});

test('meat corridor profile renders ceiling lamps as organic light glands', () => {
  const world = openWorld();
  const lamp = world.idx(10, 10);
  world.features[lamp] = Feature.LAMP;
  setWorldVisualSlot(world, lamp, 0, VISUAL_CELL_CODES.CEILING_BULB);

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, {
    floorKey: 'story:hell',
    profile: {
      radius: 6,
      instanceCap: 64,
      corridorVolumeStyle: 'organic',
      corridorCoveringId: 'meat',
    },
  }));

  const lampInstance = instances.find(instance => instance.modelId === 'meat_ceiling_lamp');
  assert.ok(lampInstance);
  assert.equal(instances.some(instance => instance.modelId === 'ceiling_bulb'), false);
  assert.equal(lampInstance.z, 0.98);
  assert.equal((lampInstance.flags & MeshInstanceFlag.Emissive) !== 0, true);
});

test('lamp stand remains available as explicit visual slot decor', () => {
  const world = openWorld();
  setWorldVisualSlot(world, world.idx(10, 10), 0, VISUAL_CELL_CODES.LAMP_STAND_HINT);

  const instances = collectMeshScene(context(world));

  assert.equal(instances.some(instance => instance.modelId === 'lamp_stand'), true);
});

test('sanitary feature mapping uses distinct fixture model ids', () => {
  const world = openWorld();
  world.features[world.idx(10, 10)] = Feature.SINK;
  world.features[world.idx(11, 10)] = Feature.TOILET;

  const instances = collectMeshScene(context(world));

  assert.equal(instances.some(instance => instance.modelId === 'sink_basin'), true);
  assert.equal(instances.some(instance => instance.modelId === 'toilet_bowl'), true);
});

test('visual slot code creates expected model id', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  world.cells[world.idx(10, 10)] = Cell.WALL;
  setVisualSlot(world, slots, 10, 10, VISUAL_CELL_CODES.PIPE_WALL_SMALL);

  const instances = collectMeshScene(context(world));

  assert.equal(instances.length, 1);
  assert.equal(instances[0].modelId, 'pipe_wall_small');
});

test('generated room visual decor is collected as wall, ceiling and column mesh instances', () => {
  const world = new World();
  const room = addTestRoom(world, { type: RoomType.PRODUCTION, w: 22, h: 16 });
  const summary = fillVisualSlotsForRoomDecor(world, [room], {
    seed: 0x6d35,
    tags: ['maintenance', 'industrial'],
    wallCap: 10,
    ceilingCap: 5,
    columnCap: 3,
    maxPerRoom: 10,
    avoidX: room.x + 1,
    avoidY: room.y + 1,
  });

  const instances = collectMeshScene(context(world, room.x + 8.5, room.y + 8.5, 0x6d35, {
    profile: { radius: 14, instanceCap: 80, ceilingDetail: 0, furnitureDetail: 0 },
  }));

  assert.equal(summary.wallFixtures > 0, true);
  assert.equal(summary.ceilingDetails > 0, true);
  assert.equal(summary.columns > 0, true);
  assert.equal(instances.some(instance => instance.modelId.includes('pipe') || instance.modelId.includes('cable')), true);
  assert.equal(instances.some(instance => instance.modelId.includes('ceiling')), true);
  assert.equal(instances.some(instance => instance.modelId === 'column_concrete_round'), true);
});

test('optional room columns remain collected when camera approaches them', () => {
  const world = openWorld();
  const idx = world.idx(24, 24);
  world.cells[idx] = Cell.FLOOR;
  setWorldVisualSlot(world, idx, 0, VISUAL_CELL_CODES.COLUMN_CONCRETE_SQUARE);
  const profile = {
    radius: 12,
    instanceCap: 96,
    includeVisualSlots: true,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: false,
    furnitureDetail: 1,
  };
  const far = collectMeshScene(context(world, 24.5, 24.5, 0x636f, { profile }));
  const column = far.find(instance => instance.modelId.startsWith('column_')) ?? far[0];

  assert.ok(column);

  const near = collectMeshScene(context(world, column.x, column.y, 0x636f, { profile }));

  assert.equal(near.some(instance => instance.modelId === column.modelId && instance.seed === column.seed), true);
});

test('compatible neighbor visual slots merge into one wall run', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  world.cells[world.idx(10, 10)] = Cell.WALL;
  world.cells[world.idx(11, 10)] = Cell.WALL;
  setVisualSlot(world, slots, 10, 10, VISUAL_CELL_CODES.PIPE_WALL_SMALL);
  setVisualSlot(world, slots, 11, 10, VISUAL_CELL_CODES.PIPE_WALL_SMALL);

  const instances = collectMeshScene(context(world));

  assert.equal(instances.length, 1);
  assert.equal(instances[0].modelId, 'pipe_wall_small');
  assert.equal(instances[0].scaleX, 2);
});

test('cluster visual slots merge into one local cluster', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  setVisualSlot(world, slots, 10, 10, VISUAL_CELL_CODES.RUBBLE_CHUNK);
  setVisualSlot(world, slots, 11, 10, VISUAL_CELL_CODES.RUBBLE_CHUNK);
  setVisualSlot(world, slots, 10, 11, VISUAL_CELL_CODES.RUBBLE_CHUNK);

  const instances = collectMeshScene(context(world));

  assert.equal(instances.length > 0, true);
  assert.equal(instances[0].modelId, 'rubble_chunk');
});

test('cluster visual slots merge across torus edge', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  setVisualSlot(world, slots, W - 1, 10, VISUAL_CELL_CODES.RUBBLE_CHUNK);
  setVisualSlot(world, slots, 0, 10, VISUAL_CELL_CODES.RUBBLE_CHUNK);

  const instances = collectMeshScene(context(world, W - 0.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64 },
  }));

  assert.equal(instances.length > 0, true);
  assert.equal(instances[0].modelId, 'rubble_chunk');
});

test('unknown visual slot code is skipped safely with debug counter', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  setVisualSlot(world, slots, 10, 10, 250);

  const result = collectMeshSceneWithStats(context(world));

  assert.equal(result.instances.length, 0);
  assert.equal(result.stats.unknownVisualCodes, 1);
});

test('visual slot scan cap bounds slot bytes read', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  setVisualSlot(world, slots, 9, 6, 250);
  for (let y = 7; y <= 13; y++) {
    for (let x = 7; x <= 13; x++) setVisualSlot(world, slots, x, y, 250);
  }

  const result = collectMeshSceneWithStats(context(world, 10.5, 10.5, 123, {
    profile: { radius: 4, instanceCap: 64, visualSlotScanCap: 1 },
  }));

  assert.equal(result.stats.visualSlotsRead, 1);
});

test('visual slot instance cap preserves non-slot feature output', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  world.features[world.idx(10, 10)] = Feature.TABLE;
  setVisualSlot(world, slots, 11, 10, VISUAL_CELL_CODES.COLUMN_CONCRETE_SQUARE);
  setVisualSlot(world, slots, 12, 10, VISUAL_CELL_CODES.COLUMN_CONCRETE_SQUARE);

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, {
    profile: { radius: 5, instanceCap: 64, visualSlotInstanceCap: 1 },
  }));

  assert.equal(instances.filter(instance => (instance.flags & MeshInstanceFlag.VisualSlot) !== 0).length, 1);
  assert.equal(instances.some(instance => instance.modelId === 'table_slab'), true);
});

test('visual slot merge cap limits merged run outputs', () => {
  const world = openWorld();
  const slots = attachVisualSlots(world);
  for (const [x, y] of [[10, 10], [11, 10], [10, 12], [11, 12]] as const) {
    world.cells[world.idx(x, y)] = Cell.WALL;
    setVisualSlot(world, slots, x, y, VISUAL_CELL_CODES.PIPE_WALL_SMALL);
  }

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, {
    profile: { radius: 5, instanceCap: 64, visualSlotInstanceCap: 64, visualSlotMergeCap: 1 },
  }));

  assert.equal(instances.filter(instance => (instance.flags & MeshInstanceFlag.Merged) !== 0).length, 1);
});

test('collection radius rejects distant output', () => {
  const world = openWorld();
  world.features[world.idx(10, 10)] = Feature.TABLE;
  world.features[world.idx(30, 10)] = Feature.CHAIR;

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, {
    profile: { radius: 3, instanceCap: 64 },
  }));

  assert.equal(instances.length, 1);
  assert.equal(instances[0].modelId, 'table_slab');
});

test('toroidal near-camera wrapping collects local edge cells', () => {
  const world = openWorld();
  world.features[world.idx(1, 10)] = Feature.CHAIR;

  const instances = collectMeshScene(context(world, 1023.75, 10.5, 123, {
    profile: { radius: 3, instanceCap: 64 },
  }));

  assert.equal(instances.some(instance => instance.modelId === 'chair_simple'), true);
});

test('corridor volume profile adds structural relief from rectangular 2d corridors', () => {
  const world = corridorWorld();

  const instances = collectMeshScene(context(world, 10.5, 10.5, 0x7711, {
    profile: {
      radius: 8,
      instanceCap: 96,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'service',
      corridorCoveringId: 'technical',
    },
  }));

  assert.equal(instances.some(instance =>
    instance.modelId === 'corridor_wall_relief' ||
    instance.modelId === 'corridor_side_ledge' ||
    instance.modelId === 'corridor_floor_threshold',
  ), true);
  assert.equal(instances.some(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0), true);
});

test('corridor volume stays out of broad furnished rooms', () => {
  const world = new World();
  const room = addTestRoom(world, { type: RoomType.COMMON, x: 10, y: 10, w: 8, h: 8 });
  const table = world.idx(room.x, room.y);
  world.features[table] = Feature.TABLE;
  setWorldVisualSlot(world, table, 0, VISUAL_CELL_CODES.FURNITURE_TABLE_HINT);

  const instances = collectMeshScene(context(world, room.x + 0.5, room.y + 0.5, 0x7777, {
    profile: {
      radius: 8,
      instanceCap: 128,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'concrete',
      corridorCoveringId: 'concrete',
    },
  }));

  assert.equal(instances.some(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0), false);
});

test('service corridor volume emits small infrastructure panels and controls', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 80);

  const instances = collectMeshScene(context(world, 30.5, 10.5, 0x7788, {
    profile: {
      radius: 28,
      instanceCap: 260,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'service',
      corridorCoveringId: 'technical',
    },
  }));

  const devices = instances.filter(instance =>
    instance.modelId === 'wall_panel_flat' ||
    instance.modelId === 'wall_panel_screen' ||
    instance.modelId === 'button_panel',
  );
  assert.equal(devices.length > 0, true);
  assert.equal(devices.some(instance => instance.modelId === 'button_panel' || instance.modelId === 'wall_panel_screen'), true);
  for (const instance of devices) {
    const bounds = actualMeshBounds(instance);
    assert.equal(bounds.x <= 0.2, true, `${instance.modelId} width`);
    assert.equal(bounds.y <= 0.03, true, `${instance.modelId} depth`);
    assert.equal(bounds.z <= 0.12, true, `${instance.modelId} height`);
  }
});

test('collector corridor wall volume uses pipe relief instead of service panels', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 80);

  const instances = collectMeshScene(context(world, 30.5, 10.5, 0x7788, {
    floorKey: 'story:maintenance',
    profile: {
      radius: 28,
      instanceCap: 260,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'service',
      corridorCoveringId: 'collector',
    },
  }));

  const wallVolumes = instances.filter(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0);
  assert.equal(wallVolumes.length > 0, true);
  assert.equal(instances.some(instance =>
    instance.modelId === 'wall_panel_flat' ||
    instance.modelId === 'wall_panel_screen' ||
    instance.modelId === 'button_panel',
  ), false);
  assert.equal(instances.some(instance => instance.modelId === 'pipe_wall_large'), true);
});

test('meat corridor wall volume uses organic relief instead of service panels', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 80);

  const instances = collectMeshScene(context(world, 30.5, 10.5, 0x7799, {
    floorKey: 'story:hell',
    profile: {
      radius: 28,
      instanceCap: 260,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 1,
      corridorVolumeStyle: 'organic',
      corridorCoveringId: 'meat',
    },
  }));

  const wallVolumes = instances.filter(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0);
  assert.equal(wallVolumes.length > 0, true);
  assert.equal(instances.some(instance =>
    instance.modelId === 'wall_panel_flat' ||
    instance.modelId === 'wall_panel_screen' ||
    instance.modelId === 'button_panel',
  ), false);
  assert.equal(instances.some(instance =>
    instance.modelId === 'meat_wall_fold' || instance.modelId === 'organic_wall_bulge',
  ), true);
});

test('corridor wall volume stays micro-local on wall edges', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 64);

  const instances = collectMeshScene(context(world, 24.5, 10.5, 0x7722, {
    profile: {
      radius: 20,
      instanceCap: 180,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'concrete',
      corridorCoveringId: 'concrete',
    },
  }));

  const wallInstances = instances.filter(instance =>
    (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0 &&
    (instance.flags & MeshInstanceFlag.WallMount) !== 0,
  );
  assert.equal(wallInstances.length > 0, true);
  for (const instance of wallInstances) {
    const fx = instance.x - Math.floor(instance.x);
    const fy = instance.y - Math.floor(instance.y);
    const edgeDistance = Math.min(fx, 1 - fx, fy, 1 - fy);
    const bounds = actualMeshBounds(instance);
    assert.equal(edgeDistance < 0.14, true, `${instance.modelId} must sit near a wall edge`);
    if (instance.modelId === 'pipe_wall_large' || instance.modelId === 'cable_wall_loose') {
      assert.equal(bounds.y <= 0.04, true, `${instance.modelId} depth`);
      assert.equal(bounds.z <= 0.08, true, `${instance.modelId} height`);
    } else {
      assert.equal(bounds.x <= 0.28, true, `${instance.modelId} width`);
      assert.equal(bounds.y <= 0.03, true, `${instance.modelId} depth`);
      assert.equal(bounds.z <= 0.12, true, `${instance.modelId} height`);
    }
  }
});

test('corridor floor thresholds are thin strips and do not cull at camera proximity', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 64);

  const instances = collectMeshScene(context(world, 24.5, 10.5, 159521, {
    profile: {
      radius: 12,
      instanceCap: 160,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'concrete',
      corridorCoveringId: 'concrete',
    },
  }));

  const threshold = instances.find(instance => instance.modelId === 'corridor_floor_threshold' && Math.abs(instance.x - 24.5) < 0.001);
  assert.equal(!!threshold, true, 'near-camera threshold should remain collected');
  const bounds = actualMeshBounds(threshold!);
  assert.equal(bounds.x <= 0.22, true, 'threshold length');
  assert.equal(bounds.y <= 0.028, true, 'threshold width');
  assert.equal(bounds.z <= 0.016, true, 'threshold height');
});

test('meat corridor volume profile adds smooth organic folds without visual slots', () => {
  const world = corridorWorld(RoomType.COMMON, 42);

  const instances = collectMeshScene(context(world, 18.5, 10.5, 0x7733, {
    floorKey: 'story:hell',
    profile: {
      radius: 18,
      instanceCap: 180,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      ceilingDetail: 0,
      furnitureDetail: 0,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 1,
      corridorVolumeStyle: 'organic',
      corridorCoveringId: 'meat',
    },
  }));

  assert.equal(instances.some(instance => instance.modelId === 'meat_wall_fold'), true);
  assert.equal(instances.some(instance => instance.modelId === 'meat_floor_fold'), true);
  assert.equal(instances.some(instance =>
    (instance.modelId === 'meat_wall_fold' || instance.modelId === 'meat_floor_fold') &&
    actualMeshBounds(instance).x >= 0.42,
  ), true);
  assert.equal(instances.some(instance => instance.modelId === 'pipe_wall_large' || instance.modelId === 'cable_wall_loose'), false);
});

test('cave corridor covering adds stone protrusions and stalactites from topology only', () => {
  const world = corridorWorld(RoomType.COMMON, 48);

  const instances = collectMeshScene(context(world, 20.5, 10.5, 0x7744, {
    profile: {
      radius: 20,
      instanceCap: 180,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 1,
      corridorVolumeStyle: 'organic',
      corridorCoveringId: 'cave',
    },
  }));

  assert.equal(instances.some(instance => instance.modelId === 'cave_stalactite'), true);
  assert.equal(instances.some(instance => instance.modelId === 'cave_wall_protrusion'), true);
});

test('collector corridor covering adds gutters and service runs from topology only', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 56);

  const instances = collectMeshScene(context(world, 24.5, 10.5, 0x7755, {
    profile: {
      radius: 24,
      instanceCap: 220,
      includeVisualSlots: false,
      includeFeatures: false,
      includeContainers: false,
      includeCorridorVolumes: true,
      corridorVolumeDetail: 1,
      organicVolumeDetail: 0,
      corridorVolumeStyle: 'service',
      corridorCoveringId: 'collector',
    },
  }));

  assert.equal(instances.some(instance => instance.modelId === 'collector_gutter'), true);
  assert.equal(instances.some(instance =>
    instance.modelId === 'pipe_wall_large' ||
    instance.modelId === 'cable_wall_loose' ||
    instance.modelId === 'ceiling_pipe_bundle' ||
    instance.modelId === 'ceiling_cable_bundle',
  ), true);
});

test('collector ceiling service runs merge along procedural lanes', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 80);

  const baseProfile = {
    radius: 28,
    instanceCap: 260,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'service' as const,
    corridorCoveringId: 'collector' as const,
  };
  const ceilingRunSignature = (seed: number, floorKey = 'test:mesh'): string => {
    const instances = collectMeshScene(context(world, 30.5, 10.5, seed, {
      floorKey,
      profile: baseProfile,
    }));
    return instances
      .filter(instance =>
        instance.modelId === 'ceiling_pipe_bundle' ||
        instance.modelId === 'ceiling_cable_bundle',
      )
      .map(instance => [
        instance.modelId,
        Math.round(instance.x * 100),
        Math.round(instance.y * 100),
        Math.round(instance.scaleX * 100),
      ].join(':'))
      .join('|');
  };

  const instances = collectMeshScene(context(world, 30.5, 10.5, 0x7756, {
    profile: {
      ...baseProfile,
    },
  }));

  const runs = instances.filter(instance =>
    instance.modelId === 'ceiling_pipe_bundle' ||
    instance.modelId === 'ceiling_cable_bundle',
  );
  const longRuns = runs.filter(instance => instance.scaleX >= 10);
  assert.equal(longRuns.length > 0, true);
  assert.equal(longRuns.every(instance => {
    const fy = instance.y - Math.floor(instance.y);
    return Math.abs(fy - 0.5) > 0.24;
  }), true);
  assert.notEqual(ceilingRunSignature(0x7756), ceilingRunSignature(0x7757));
  assert.notEqual(ceilingRunSignature(0x7756), ceilingRunSignature(0x7756, 'story:maintenance'));
});

test('collector ceiling visual slot bundles use topology lanes instead of cell centers', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 24);
  const slots = attachVisualSlots(world);
  for (let x = 10; x < 14; x++) setVisualSlot(world, slots, x, 10, VISUAL_CELL_CODES.CEILING_PIPE_BUNDLE);

  const instances = collectMeshScene(context(world, 12.5, 10.5, 0x7758, {
    profile: {
      radius: 8,
      instanceCap: 64,
      includeFeatures: false,
      includeContainers: false,
      includeCorridorVolumes: false,
      corridorVolumeStyle: 'service',
      corridorCoveringId: 'collector',
    },
  }));

  const run = instances.find(instance => instance.modelId === 'ceiling_pipe_bundle');
  assert.ok(run);
  assert.equal(run.scaleX, 4);
  assert.equal((run.flags & MeshInstanceFlag.VisualSlot) !== 0, true);
  const fy = run.y - Math.floor(run.y);
  assert.equal(Math.abs(fy - 0.5) > 0.24, true);
});

test('collector procedural ceiling pipe network adds dense render-only local pipes', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 80);
  const profile = {
    radius: 14,
    instanceCap: 384,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'service' as const,
    corridorCoveringId: 'collector' as const,
  };
  const collectShortPipes = (seed: number) => collectMeshScene(context(world, 30.5, 10.5, seed, {
    mode: 'high',
    profile,
  })).filter(instance =>
    (instance.modelId === 'ceiling_pipe_bundle' ||
      instance.modelId === 'ceiling_cable_bundle' ||
      instance.modelId === 'ceiling_cable') &&
    instance.scaleX < 2 &&
    instance.z > 0.85,
  );

  const pipes = collectShortPipes(0x7759);

  assert.equal(pipes.length >= 24, true);
  assert.equal(pipes.length <= 64, true);
  assert.equal(Math.max(...pipes.map(instance => Math.hypot(instance.x - 30.5, instance.y - 10.5))) <= 8.25, true);
  assert.equal(Math.max(...pipes.map(instance => Math.hypot(instance.x - 30.5, instance.y - 10.5))) > 6, true);
  assert.equal(new Set(pipes.map(instance => instance.modelId)).size >= 3, true);
  assert.equal(pipes.every(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0), true);
  assert.equal(pipes.some(instance => Math.abs(instance.y - Math.floor(instance.y) - 0.5) > 0.12), true);
  assert.deepEqual(
    pipes.slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
    collectShortPipes(0x7759).slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
  );
  assert.notDeepEqual(
    pipes.slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
    collectShortPipes(0x7760).slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
  );
});

test('procedural local mesh fields stay stable during subcell camera movement', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 90);
  const profile = {
    radius: 14,
    instanceCap: 384,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'service' as const,
    corridorCoveringId: 'collector' as const,
  };
  const localFieldSignature = (cameraX: number): string => collectMeshScene(context(world, cameraX, 10.5, 0x7791, {
    mode: 'high',
    profile,
  }))
    .filter(instance =>
      ((instance.modelId === 'ceiling_pipe_bundle' ||
          instance.modelId === 'ceiling_cable_bundle' ||
          instance.modelId === 'ceiling_cable') &&
        instance.scaleX < 2) ||
      instance.modelId === 'collector_floor_pipe' ||
      instance.modelId === 'floor_tile_shard' ||
      instance.modelId === 'brick_fragment' ||
      instance.modelId === 'rubble_chunk' ||
      instance.modelId === 'paper_sheet' ||
      instance.modelId === 'newspaper_sheet' ||
      instance.modelId === 'floor_crumb')
    .map(instance => [
      instance.modelId,
      Math.round(instance.x * 100),
      Math.round(instance.y * 100),
      Math.round(instance.yaw * 100),
      Math.round(instance.scaleX * 100),
    ].join(':'))
    .join('|');

  const left = localFieldSignature(30.12);
  const right = localFieldSignature(30.88);

  assert.notEqual(left, '');
  assert.equal(left, right);
});

test('collector procedural floor scatter adds render-only tile brick debris and floor pipes', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 90);
  const profile = {
    radius: 18,
    instanceCap: 512,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'service' as const,
    corridorCoveringId: 'collector' as const,
  };
  const collectFloorScatter = (seed: number) => collectMeshScene(context(world, 34.5, 10.5, seed, {
    mode: 'high',
    profile,
  })).filter(instance =>
    instance.modelId === 'collector_floor_pipe' ||
    instance.modelId === 'floor_tile_shard' ||
    instance.modelId === 'brick_fragment' ||
    instance.modelId === 'rubble_chunk' ||
    instance.modelId === 'paper_sheet' ||
    instance.modelId === 'newspaper_sheet' ||
    instance.modelId === 'floor_crumb',
  );

  const debris = collectFloorScatter(0x7781);

  assert.equal(debris.length >= 3, true);
  assert.equal(debris.length <= 64, true);
  assert.equal(new Set(debris.map(instance => instance.modelId)).size >= 3, true);
  assert.equal(debris.some(instance => instance.modelId === 'collector_floor_pipe'), true);
  assert.equal(debris.every(instance => instance.z > 0 && instance.z <= 0.01), true);
  assert.equal(debris.every(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0), true);
  assert.equal(debris.every(instance => (instance.flags & MeshInstanceFlag.VisualSlot) === 0), true);
  assert.deepEqual(
    debris.slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
    collectFloorScatter(0x7781).slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
  );
  assert.notDeepEqual(
    debris.slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
    collectFloorScatter(0x7782).slice(0, 12).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
  );
});

test('linoleum procedural floor scatter follows floor material without stored slots', () => {
  const world = openWorld();
  world.floorTex.fill(Tex.F_LINO);
  const profile = {
    radius: 16,
    instanceCap: 256,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'concrete' as const,
    corridorCoveringId: 'concrete' as const,
  };
  const collectLinoleum = (seed: number) => collectMeshScene(context(world, 20.5, 20.5, seed, {
    mode: 'high',
    floorKey: 'story:living',
    profile,
  })).filter(instance =>
    instance.modelId === 'linoleum_peel' ||
    instance.modelId === 'linoleum_scrap' ||
    instance.modelId === 'paper_sheet' ||
    instance.modelId === 'newspaper_sheet' ||
    instance.modelId === 'floor_crumb',
  );

  const scraps = collectLinoleum(0x7783);

  assert.equal(scraps.length >= 12, true);
  assert.equal(scraps.length <= 64, true);
  assert.equal(new Set(scraps.map(instance => instance.modelId)).size >= 3, true);
  assert.equal(scraps.some(instance => instance.modelId === 'paper_sheet' || instance.modelId === 'newspaper_sheet'), true);
  assert.equal(scraps.some(instance => instance.modelId === 'floor_crumb'), true);
  assert.equal(scraps.some(instance =>
    instance.modelId === 'brick_fragment' ||
    instance.modelId === 'floor_tile_shard' ||
    instance.modelId === 'rubble_chunk' ||
    instance.modelId === 'collector_floor_pipe',
  ), false);
  assert.equal(scraps.every(instance => instance.z > 0 && instance.z <= 0.01), true);
  assert.equal(scraps.every(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0), true);
  assert.equal(scraps.every(instance => (instance.flags & MeshInstanceFlag.VisualSlot) === 0), true);
  assert.deepEqual(
    scraps.slice(0, 10).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
    collectLinoleum(0x7783).slice(0, 10).map(instance => [instance.modelId, Math.round(instance.x * 100), Math.round(instance.y * 100), Math.round(instance.yaw * 100)]),
  );
});

test('linoleum procedural floor scatter stays enabled from current room material', () => {
  const world = openWorld();
  world.floorTex.fill(Tex.F_CONCRETE);
  world.rooms[0].floorTex = Tex.F_LINO;
  const profile = {
    radius: 16,
    instanceCap: 256,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'concrete' as const,
    corridorCoveringId: 'concrete' as const,
  };
  const scatter = collectMeshScene(context(world, 20.5, 20.5, 0x7785, {
    mode: 'high',
    floorKey: 'story:living',
    profile,
  })).filter(instance =>
    instance.modelId === 'linoleum_peel' ||
    instance.modelId === 'linoleum_scrap' ||
    instance.modelId === 'paper_sheet' ||
    instance.modelId === 'newspaper_sheet' ||
    instance.modelId === 'floor_crumb',
  );

  assert.equal(scatter.length > 0, true);
  assert.equal(scatter.length <= 64, true);
});

test('procedural floor scatter follows compact resolved field budgets', () => {
  const collectorWorld = corridorWorld(RoomType.CORRIDOR, 120);
  const collectorIds = new Set(['collector_floor_pipe', 'floor_tile_shard', 'brick_fragment', 'rubble_chunk', 'paper_sheet', 'newspaper_sheet', 'floor_crumb']);
  const lowCollectorProfile = resolveVisualGeometryProfile('low', 'procedural:collector_test', ['collectors', 'industrial', 'water', 'pipes']);
  const mediumCollectorProfile = resolveVisualGeometryProfile('medium', 'procedural:collector_test', ['collectors', 'industrial', 'water', 'pipes']);
  const lowCollector = collectMeshScene(context(collectorWorld, 34.5, 10.5, 0x7781, {
    mode: 'low',
    floorKey: lowCollectorProfile.key,
    profile: lowCollectorProfile,
  })).filter(instance => collectorIds.has(instance.modelId));
  const mediumCollector = collectMeshScene(context(collectorWorld, 34.5, 10.5, 0x7781, {
    mode: 'medium',
    floorKey: mediumCollectorProfile.key,
    profile: mediumCollectorProfile,
  })).filter(instance => collectorIds.has(instance.modelId));

  const livingWorld = openWorld();
  livingWorld.floorTex.fill(Tex.F_LINO);
  const linoIds = new Set(['linoleum_peel', 'linoleum_scrap', 'paper_sheet', 'newspaper_sheet', 'floor_crumb']);
  const lowLivingProfile = resolveVisualGeometryProfile('low', 'story:living', ['living', 'residential']);
  const mediumLivingProfile = resolveVisualGeometryProfile('medium', 'story:living', ['living', 'residential']);
  const lowLiving = collectMeshScene(context(livingWorld, 34.5, 34.5, 0x7781, {
    mode: 'low',
    floorKey: lowLivingProfile.key,
    profile: lowLivingProfile,
  })).filter(instance => linoIds.has(instance.modelId));
  const mediumLiving = collectMeshScene(context(livingWorld, 34.5, 34.5, 0x7781, {
    mode: 'medium',
    floorKey: mediumLivingProfile.key,
    profile: mediumLivingProfile,
  })).filter(instance => linoIds.has(instance.modelId));

  assert.equal(lowCollector.length >= 1, true);
  assert.equal(lowCollector.length <= lowCollectorProfile.proceduralFieldInstanceCap, true);
  assert.equal(mediumCollector.length >= lowCollector.length, true);
  assert.equal(mediumCollector.length <= mediumCollectorProfile.proceduralFieldInstanceCap, true);
  assert.equal(lowLiving.length <= lowLivingProfile.proceduralFieldInstanceCap, true);
  assert.equal(mediumLiving.length >= 0, true);
  assert.equal(mediumLiving.length >= lowLiving.length, true);
  assert.equal(mediumLiving.length <= mediumLivingProfile.proceduralFieldInstanceCap, true);
});

test('procedural floor scatter field does not depend on per-cell passability', () => {
  const world = new World();
  world.cells.fill(Cell.WALL);
  world.floorTex.fill(Tex.F_LINO);
  const profile = {
    radius: 16,
    instanceCap: 256,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'concrete' as const,
    corridorCoveringId: 'concrete' as const,
  };

  const scatter = collectMeshScene(context(world, 20.5, 20.5, 0x7784, {
    mode: 'high',
    floorKey: 'story:living',
    profile,
  })).filter(instance =>
    instance.modelId === 'linoleum_peel' ||
    instance.modelId === 'linoleum_scrap' ||
    instance.modelId === 'paper_sheet' ||
    instance.modelId === 'newspaper_sheet' ||
    instance.modelId === 'floor_crumb',
  );

  assert.equal(scatter.length > 0, true);
  assert.equal(scatter.length <= 64, true);
});

test('corridor covering placement changes by seed without simple stride pattern', () => {
  const world = corridorWorld(RoomType.CORRIDOR, 72);
  const profile = {
    radius: 32,
    instanceCap: 260,
    includeVisualSlots: false,
    includeFeatures: false,
    includeContainers: false,
    includeCorridorVolumes: true,
    corridorVolumeDetail: 1,
    organicVolumeDetail: 0,
    corridorVolumeStyle: 'concrete' as const,
    corridorCoveringId: 'concrete' as const,
  };

  const a = collectMeshScene(context(world, 30.5, 10.5, 0x7766, { profile }));
  const b = collectMeshScene(context(world, 30.5, 10.5, 0x8866, { profile }));
  const positionsA = a
    .filter(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0)
    .map(instance => Math.round(instance.x * 10) / 10)
    .sort((x, y) => x - y);
  const positionsB = b
    .filter(instance => (instance.flags & MeshInstanceFlag.CorridorVolume) !== 0)
    .map(instance => Math.round(instance.x * 10) / 10)
    .sort((x, y) => x - y);
  const gaps = positionsA.slice(1).map((x, i) => Math.round((x - positionsA[i]) * 10) / 10);

  assert.equal(positionsA.length > 5, true);
  assert.notDeepEqual(positionsA, positionsB);
  assert.equal(new Set(gaps).size > 1, true);
});

test('same world and seed gives stable instance seeds', () => {
  const world = openWorld();
  world.features[world.idx(10, 10)] = Feature.MACHINE;

  const a = collectMeshScene(context(world, 10.5, 10.5, 777));
  const b = collectMeshScene(context(world, 10.5, 10.5, 777));

  assert.deepEqual(a.map(instance => instance.seed), b.map(instance => instance.seed));
});

test('off mode and zero profile return no instances', () => {
  const world = openWorld();
  world.features[world.idx(10, 10)] = Feature.TABLE;

  assert.equal(collectMeshScene(context(world, 10.5, 10.5, 123, { mode: 'off' })).length, 0);
  assert.equal(collectMeshScene(context(world, 10.5, 10.5, 123, {
    profile: { radius: 0, instanceCap: 64 },
  })).length, 0);
});

test('instance cap is stable for small camera motion inside one cell', () => {
  const world = openWorld();
  const raw: MeshInstance[] = [
    {
      modelId: 'table_slab',
      x: 10.12,
      y: 10.5,
      z: 0,
      yaw: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      seed: 20,
      flags: MeshInstanceFlag.Feature,
    },
    {
      modelId: 'table_slab',
      x: 10.88,
      y: 10.5,
      z: 0,
      yaw: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      seed: 10,
      flags: MeshInstanceFlag.Feature,
    },
  ];
  const profile = { radius: 12, instanceCap: 1 };
  const left = capMeshInstances(context(world, 10.49, 10.5, 123, { profile }), raw);
  const right = capMeshInstances(context(world, 10.51, 10.5, 123, { profile }), raw);

  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(left[0].seed, right[0].seed);
});

test('radius capping uses camera cell center for subcell stability', () => {
  const world = openWorld();
  const raw: MeshInstance[] = [
    {
      modelId: 'table_slab',
      x: 14.7,
      y: 10.5,
      z: 0,
      yaw: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      seed: 42,
      flags: MeshInstanceFlag.Feature,
    },
  ];
  const profile = { radius: 4, instanceCap: 4 };
  const left = capMeshInstances(context(world, 10.12, 10.5, 123, { profile }), raw);
  const right = capMeshInstances(context(world, 10.88, 10.5, 123, { profile }), raw);

  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(left[0].seed, right[0].seed);
});

test('instance cap is enforced after priority and stable cell scoring', () => {
  const world = openWorld();
  for (let i = 0; i < 6; i++) world.features[world.idx(10 + i, 10)] = Feature.TABLE;

  const instances = collectMeshScene(context(world, 10.5, 10.5, 123, {
    profile: { radius: 12, instanceCap: 2 },
  }));

  assert.equal(instances.length, 2);
});

