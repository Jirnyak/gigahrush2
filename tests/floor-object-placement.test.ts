import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Feature, FloorLevel, RoomType, Tex, W } from '../src/core/types';
import { World, auditReachability } from '../src/core/world';
import { designFloorById } from '../src/data/design_floors';
import {
  floorObjectProfileDuplicateRuleIds,
  floorObjectProfileForDesignFloor,
  floorObjectProfileForProceduralFloor,
  floorObjectProfileForStoryFloor,
  type FloorObjectPlacementProfile,
} from '../src/data/floor_object_placement';
import { craftStationCells } from '../src/gen/craft_stations';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { applyFloorObjectPlacementProfile } from '../src/gen/floor_object_placement';
import { generateFloor } from '../src/gen/floor_manifest';
import { interactiveAt } from '../src/systems/interactive';
import { findInteractionTarget } from '../src/systems/interactions';
import {
  addTestRoom,
  makeGameState,
  makeTestPlayer,
} from './helpers';
import { testGenerationMatrix } from './generator_helpers';

test('floor object profile places decor, explicit interactives and fixture overlays in one pass', () => {
  const world = new World();
  const room = addTestRoom(world, { type: RoomType.PRODUCTION, w: 20, h: 12 });
  const sinkX = room.x + room.w - 3;
  const sinkY = room.y + room.h - 3;
  world.setFeatureAt(world.idx(sinkX, sinkY), Feature.SINK);
  const profile: FloorObjectPlacementProfile = {
    id: 'test_object_profile',
    tags: ['test'],
    density: { features: 3, interactives: 1, brokenFixtures: 1, wallDecor: 3, screens: 1, maxPerRoom: 3 },
    roomTextureRules: [
      {
        id: 'test_production_texture',
        kind: 'room_texture',
        wallTex: Tex.METAL,
        floorTex: Tex.F_TILE,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
    ],
    wallDecorRules: [
      {
        id: 'test_room_posters',
        kind: 'wall_decor',
        decor: 'poster',
        textureBase: Tex.POSTER_BASE,
        variantCount: 64,
        min: 2,
        max: 2,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
      {
        id: 'test_room_screen',
        kind: 'wall_decor',
        decor: 'screen',
        textureBase: Tex.SCREEN_BASE,
        variantCount: 8,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
    ],
    featureRules: [
      {
        id: 'test_pump_machines',
        kind: 'feature',
        feature: Feature.MACHINE,
        min: 2,
        max: 2,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
    ],
    interactiveRules: [
      {
        id: 'test_basic_workbench',
        kind: 'interactive',
        defId: 'workbench_basic',
        forceFeature: true,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
    ],
    brokenFixtures: [
      {
        id: 'test_broken_sink',
        baseChance: 1,
        max: 1,
        features: [Feature.SINK],
        roomTypeWeights: { [RoomType.PRODUCTION]: 1 },
      },
    ],
  };

  const summary = applyFloorObjectPlacementProfile(world, [room], room.x + 1, room.y + 1, profile);
  const machineCells = [...world.features].filter(feature => feature === Feature.MACHINE).length;
  const posterCells = [...world.wallTex].filter(tex => tex >= Tex.POSTER_BASE && tex < Tex.POSTER_BASE + 64).length;
  const screenCells = world.screenCells.filter(idx => world.wallTex[idx] >= Tex.SCREEN_BASE && world.wallTex[idx] < Tex.SCREEN_BASE + 32);
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: sinkX - 1, y: sinkY });
  const target = findInteractionTarget({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: sinkX,
    lookY: sinkY,
  });

  assert.equal(summary?.roomTextures.test_production_texture, 1);
  assert.equal(summary?.wallDecor.test_room_posters, 2);
  assert.equal(summary?.wallDecor.test_room_screen, 1);
  assert.equal(summary?.features.test_pump_machines, 2);
  assert.equal(summary?.interactives.test_basic_workbench, 1);
  assert.equal(summary?.brokenFixtures.test_broken_sink, 1);
  assert.equal((summary?.visualSlotDecor?.wallFixtures ?? 0) > 0, true);
  assert.equal((summary?.visualSlotDecor?.ceilingDetails ?? 0) > 0, true);
  assert.equal((summary?.visualSlotDecor?.columns ?? 0) <= 1, true);
  assert.equal(room.wallTex, Tex.METAL);
  assert.equal(room.floorTex, Tex.F_TILE);
  assert.equal(world.floorTex[world.idx(room.x + 2, room.y + 2)], Tex.F_TILE);
  assert.equal(posterCells, 2);
  assert.equal(screenCells.length, 1);
  assert.equal(world.features[screenCells[0]], Feature.SCREEN);
  assert.equal(machineCells >= 3, true, 'decor machines and workbench feature should be visible');
  assert.equal(target?.defId, 'sink_broken');
});

test('broken fixture placement scores candidates instead of preferring first room order', () => {
  const world = new World();
  const earlyRoom = addTestRoom(world, { id: 0, type: RoomType.BATHROOM, x: 10, y: 10, w: 8, h: 8 });
  const preferredRoom = addTestRoom(world, { id: 1, type: RoomType.MEDICAL, x: 40, y: 10, w: 8, h: 8 });
  const earlySink = world.idx(earlyRoom.x + 2, earlyRoom.y + 2);
  const preferredSink = world.idx(preferredRoom.x + 2, preferredRoom.y + 2);
  world.setFeatureAt(earlySink, Feature.SINK);
  world.setFeatureAt(preferredSink, Feature.SINK);

  const profile: FloorObjectPlacementProfile = {
    id: 'test_broken_fixture_candidate_scoring',
    tags: ['test'],
    density: { brokenFixtures: 1 },
    brokenFixtures: [
      {
        id: 'test_scored_broken_sink',
        baseChance: 1,
        max: 1,
        features: [Feature.SINK],
        roomTypeWeights: {
          [RoomType.BATHROOM]: 1,
          [RoomType.MEDICAL]: 3,
        },
      },
    ],
  };

  const reachable = new Uint8Array(W * W);
  reachable[earlySink] = 1;
  reachable[preferredSink] = 1;
  const summary = applyFloorObjectPlacementProfile(world, [earlyRoom, preferredRoom], earlyRoom.x + 1, earlyRoom.y + 1, profile, {
    reachable,
    seed: 0x4f17,
  });

  assert.equal(summary?.brokenFixtures.test_scored_broken_sink, 1);
  assert.equal(interactiveAt(world, earlySink % W, (earlySink / W) | 0).some(instance => instance.defId === 'sink_broken'), false);
  assert.equal(interactiveAt(world, preferredSink % W, (preferredSink / W) | 0).some(instance => instance.defId === 'sink_broken'), true);
});

test('floor object profile wall decor and textures skip apartment rooms', () => {
  const world = new World();
  const room = addTestRoom(world, { type: RoomType.COMMON, w: 12, h: 10, apartmentId: 7 });
  const profile: FloorObjectPlacementProfile = {
    id: 'test_protected_profile',
    tags: ['test'],
    density: { wallDecor: 2, maxPerRoom: 2 },
    roomTextureRules: [
      {
        id: 'protected_texture_attempt',
        kind: 'room_texture',
        wallTex: Tex.MARBLE,
        floorTex: Tex.F_PARQUET,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.COMMON]: 1 },
      },
    ],
    wallDecorRules: [
      {
        id: 'protected_poster_attempt',
        kind: 'wall_decor',
        decor: 'poster',
        textureBase: Tex.POSTER_BASE,
        variantCount: 64,
        min: 1,
        max: 2,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.COMMON]: 1 },
      },
    ],
  };

  const summary = applyFloorObjectPlacementProfile(world, [room], room.x + 1, room.y + 1, profile);
  const posterCells = [...world.wallTex].filter(tex => tex >= Tex.POSTER_BASE && tex < Tex.POSTER_BASE + 64).length;

  assert.equal(summary?.roomTextures.protected_texture_attempt, 0);
  assert.equal(summary?.wallDecor.protected_poster_attempt, 0);
  assert.equal(room.wallTex, Tex.CONCRETE);
  assert.equal(room.floorTex, Tex.F_CONCRETE);
  assert.equal(posterCells, 0);
});

test('floor object profile duplicate rule ids are reported across rule families', () => {
  const profile: FloorObjectPlacementProfile = {
    id: 'test_duplicate_profile',
    tags: ['test'],
    roomTextureRules: [
      {
        id: 'same_id',
        kind: 'room_texture',
        wallTex: Tex.PANEL,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.COMMON]: 1 },
      },
    ],
    wallDecorRules: [
      {
        id: 'same_id',
        kind: 'wall_decor',
        decor: 'sign',
        textureBase: Tex.POSTER_BASE,
        variantCount: 16,
        min: 1,
        max: 1,
        roomDivisor: 1,
        roomTypeWeights: { [RoomType.COMMON]: 1 },
      },
    ],
  };

  assert.deepEqual(floorObjectProfileDuplicateRuleIds(profile), ['same_id']);
});

test('maintenance object profile wraps craft stations and collector machinery rules', () => {
  const profile = floorObjectProfileForStoryFloor(FloorLevel.MAINTENANCE);
  assert.ok(profile, 'maintenance object profile should exist');
  assert.ok(profile.craftStations, 'maintenance object profile should include craft station subprofile');
  assert.equal(profile.featureRules?.some(rule => rule.id.includes('pump')), true);
  assert.deepEqual(floorObjectProfileDuplicateRuleIds(profile), []);
  assert.equal(profile.wallDecorRules?.some(rule => rule.id === 'maintenance_warning_screens'), true);
});

testGenerationMatrix('maintenance object profile places reachable craft stations', () => {
  const gen = generateFloor(FloorLevel.MAINTENANCE, 0x51002);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const stations = [...craftStationCells(gen.world, 'craft_lathe'), ...craftStationCells(gen.world, 'disassembly_workbench')];

  assert.equal(craftStationCells(gen.world, 'craft_lathe').length >= 1, true);
  assert.equal(craftStationCells(gen.world, 'disassembly_workbench').length >= 1, true);
  assert.equal(stations.every(idx => audit.reachable[idx] === 1), true, 'profile stations should be reachable');
});

test('slime NII object profile wraps lab decor and craft stations', () => {
  const route = designFloorById('slime_nii');
  assert.ok(route, 'slime_nii route should exist');
  const profile = floorObjectProfileForDesignFloor(route);
  assert.ok(profile?.craftStations, 'slime_nii object profile should include craft station subprofile');
  assert.equal(profile?.featureRules?.some(rule => rule.id === 'slime_nii_sample_apparatus'), true);
  assert.equal(profile?.roomTextureRules?.some(rule => rule.id === 'slime_nii_wet_lab_bias'), true);
  assert.equal(profile?.wallDecorRules?.some(rule => rule.id === 'slime_nii_protocol_wall_screens'), true);
});

test('procedural object profile composes base, geometry, majority, anomaly and depth layers', () => {
  const profile = floorObjectProfileForProceduralFloor({
    key: 'test_science_quarantine',
    z: -42,
    ordinal: 1,
    seed: 0x1234,
    depth: 42,
    danger: 4,
    geometryId: 'living_blocks',
    baseFloor: FloorLevel.LIVING,
    majorityId: 'scientists',
    anomalyId: 'zombie_apocalypse',
    title: 'test',
    lootBiasIds: [],
    monsterBiasKinds: [],
    monsterBiasTags: [],
  });

  assert.ok(profile, 'procedural profile should exist');
  assert.equal(profile.tags.includes('living_blocks'), true);
  assert.equal(profile.tags.includes('scientists'), true);
  assert.equal(profile.tags.includes('zombie_apocalypse'), true);
  assert.equal(profile.wallDecorRules?.some(rule => rule.id === 'majority_scientist_protocol_screens'), true);
  assert.equal(profile.wallDecorRules?.some(rule => rule.id === 'anomaly_zombie_quarantine_signs'), true);
  assert.equal(profile.wallDecorRules?.some(rule => rule.id === 'danger_depth_warning_signs'), true);
  assert.deepEqual(floorObjectProfileDuplicateRuleIds(profile), []);
});

testGenerationMatrix('slime NII object profile places reachable craft stations', () => {
  const gen = generateDesignFloor('slime_nii');
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const stations = [
    ...craftStationCells(gen.world, 'craft_lathe'),
    ...craftStationCells(gen.world, 'disassembly_workbench'),
    ...craftStationCells(gen.world, 'craft_lab_bench'),
  ];

  assert.equal(stations.length >= 3, true, 'slime_nii should expose profile craft stations');
  assert.equal(stations.every(idx => audit.reachable[idx] === 1), true, 'slime_nii stations should be reachable');
});
