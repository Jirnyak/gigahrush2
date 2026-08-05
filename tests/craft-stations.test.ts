import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Feature,
  FloorLevel,
} from '../src/core/types';
import { World, auditReachability } from '../src/core/world';
import {
  craftStationProfileForDesignFloor,
  craftStationProfileForStoryFloor,
} from '../src/data/craft_station_placement';
import { designFloorById } from '../src/data/design_floors';
import { getInteractiveDef, interactiveDefIdForSurfaceFlags } from '../src/data/interactive';
import { makeProceduralFloorSpec, type ProceduralFloorSpec } from '../src/data/procedural_floors';
import {
  CRAFT_STATION_CAPS,
  craftStationCells,
  placeCraftStationAt,
} from '../src/gen/craft_stations';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { generateFloor } from '../src/gen/floor_manifest';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { activateInteraction, findInteractionTarget } from '../src/systems/interactions';
import {
  addTestRoom,
  makeGameState,
  makeTestPlayer,
} from './helpers';
import { testGenerationMatrix } from './generator_helpers';

let cachedLivingCraftStations: ReturnType<typeof generateFloor> | undefined;

function livingCraftStationsForRead(): ReturnType<typeof generateFloor> {
  cachedLivingCraftStations ??= generateFloor(FloorLevel.LIVING, 0x5a7103);
  return cachedLivingCraftStations;
}

function cloneWorldPrimitives(source: World): World {
  const world = new World();
  world.cells.set(source.cells);
  world.roomMap.set(source.roomMap);
  world.zoneMap.set(source.zoneMap);
  world.features.set(source.features);
  world.surfaceFlags.set(source.surfaceFlags);
  world.rooms = source.rooms.map(room => ({ ...room, doors: [...room.doors] }));
  world.zones = source.zones.map(zone => ({ ...zone }));
  return world;
}

test('craft station interactive ids are registered', () => {
  assert.equal(getInteractiveDef('craft_lathe')?.actions[0]?.kind, 'open_craft_menu');
  assert.equal(getInteractiveDef('disassembly_workbench')?.actions[0]?.kind, 'open_disassembly_menu');
  assert.equal(getInteractiveDef('craft_lab_bench')?.actions[0]?.kind, 'open_craft_menu');
  assert.equal(getInteractiveDef('recipe_billboard')?.actions[0]?.kind, 'learn_recipe');
});

test('craft station placement profiles are data-owned per floor route', () => {
  const maintenance = craftStationProfileForStoryFloor(FloorLevel.MAINTENANCE);
  assert.equal(maintenance?.requiredById?.craft_lathe, 1);
  assert.equal(maintenance?.requiredById?.disassembly_workbench, 1);

  const slimeRoute = designFloorById('slime_nii');
  assert.ok(slimeRoute, 'slime_nii route should exist');
  const slime = craftStationProfileForDesignFloor(slimeRoute);
  assert.equal(slime?.requiredById?.craft_lab_bench, 1);
  assert.equal(slime?.requiredById?.craft_lathe, 1);
  assert.equal(slime?.requiredById?.disassembly_workbench, 1);

  const productionRoute = designFloorById('production_belt');
  assert.ok(productionRoute, 'production_belt route should exist');
  const production = craftStationProfileForDesignFloor(productionRoute);
  assert.equal(production?.requiredById?.craft_lathe, 1);
  assert.equal(production?.requiredById?.disassembly_workbench, 1);
});

test('craft station placement refuses blocked and protected empty cells', () => {
  const world = new World();
  assert.equal(placeCraftStationAt(world, 1, 1, 'craft_lathe'), null);
  assert.equal(world.features[world.idx(1, 1)], Feature.NONE);

  const room = addTestRoom(world);
  const idx = world.idx(room.x + 2, room.y + 2);
  world.aptMask[idx] = 1;
  assert.equal(placeCraftStationAt(world, room.x + 2, room.y + 2, 'craft_lathe'), null);
  assert.equal(world.features[idx], Feature.NONE);
  assert.equal(interactiveDefIdForSurfaceFlags(world.surfaceFlags[idx]), undefined);
});

test('craft station placement may attach to a matching protected authored feature only', () => {
  const world = new World();
  const room = addTestRoom(world);
  const idx = world.idx(room.x + 2, room.y + 2);
  world.aptMask[idx] = 1;
  world.features[idx] = Feature.TABLE;

  const placed = placeCraftStationAt(world, room.x + 2, room.y + 2, 'disassembly_workbench', {
    allowProtectedExistingFeature: true,
  });

  assert.ok(placed);
  assert.equal(world.features[idx], Feature.TABLE);
  assert.equal(interactiveDefIdForSurfaceFlags(world.surfaceFlags[idx]), 'disassembly_workbench');
});

test('craft station interaction opens generic craft and disassembly hooks', () => {
  const world = new World();
  const room = addTestRoom(world);
  assert.ok(placeCraftStationAt(world, room.x + 2, room.y + 2, 'craft_lathe'));
  assert.ok(placeCraftStationAt(world, room.x + 3, room.y + 2, 'disassembly_workbench'));
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: room.x + 1.5, y: room.y + 2 });
  const opened: string[] = [];

  const craft = activateInteraction({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: room.x + 2,
    lookY: room.y + 2,
    openCraftMenu: request => opened.push(`${request.mode}:${request.station}:${request.sourceDefId}`),
  });
  assert.equal(craft.handled, true);
  assert.equal(craft.openedOverlay, true);
  assert.equal(opened.at(-1), 'craft:lathe:craft_lathe');

  player.x = room.x + 4.5;

  const target = findInteractionTarget({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: room.x + 3,
    lookY: room.y + 2,
  });
  assert.equal(target?.defId, 'disassembly_workbench');

  const disassembly = activateInteraction({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: room.x + 3,
    lookY: room.y + 2,
    openCraftMenu: request => opened.push(`${request.mode}:${request.station}:${request.sourceDefId}`),
  });
  assert.equal(disassembly.handled, true);
  assert.equal(opened.at(-1), 'disassemble:workbench:disassembly_workbench');
});

test('station surface flags rehydrate behavior on a restored world object', () => {
  const source = new World();
  const room = addTestRoom(source);
  assert.ok(placeCraftStationAt(source, room.x + 2, room.y + 2, 'craft_lathe'));
  const restored = cloneWorldPrimitives(source);
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: room.x + 1.5, y: room.y + 2 });
  const opened: string[] = [];

  const target = findInteractionTarget({
    world: restored,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: room.x + 2,
    lookY: room.y + 2,
  });
  assert.equal(target?.defId, 'craft_lathe');

  const activation = activateInteraction({
    world: restored,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: room.x + 2,
    lookY: room.y + 2,
    openCraftMenu: request => opened.push(`${request.mode}:${request.station}:${request.sourceDefId}`),
  });
  assert.equal(activation.handled, true);
  assert.equal(activation.openedOverlay, true);
  assert.equal(opened.at(-1), 'craft:lathe:craft_lathe');
});

testGenerationMatrix('LIVING expedition prep exposes reachable lathe and disassembly station pair', () => {
  const gen = livingCraftStationsForRead();
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const lathe = craftStationCells(gen.world, 'craft_lathe');
  const workbench = craftStationCells(gen.world, 'disassembly_workbench');

  assert.equal(lathe.length >= 1, true, 'living should have a reachable craft_lathe');
  assert.equal(workbench.length >= 1, true, 'living should have a reachable disassembly_workbench');
  assert.equal(audit.reachable[lathe[0]], 1, 'living craft_lathe should be reachable from spawn');
  assert.equal(audit.reachable[workbench[0]], 1, 'living disassembly_workbench should be reachable from spawn');
});

testGenerationMatrix('Yakov lab exposes a guaranteed reachable lathe and disassembly workbench', () => {
  const gen = livingCraftStationsForRead();
  const lab = gen.world.rooms.find(room => room?.name === 'Лаборатория');
  assert.ok(lab, 'Yakov lab should be generated');
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const inLab = (idx: number) => gen.world.roomMap[idx] === lab.id;
  const lathe = craftStationCells(gen.world, 'craft_lathe').filter(inLab);
  const workbench = craftStationCells(gen.world, 'disassembly_workbench').filter(inLab);

  assert.equal(lathe.length >= 1, true, 'Yakov lab should contain a craft_lathe');
  assert.equal(workbench.length >= 1, true, 'Yakov lab should contain a disassembly_workbench');
  assert.equal(lathe.every(idx => audit.reachable[idx] === 1), true, 'Yakov lab lathe should be reachable from spawn');
  assert.equal(workbench.every(idx => audit.reachable[idx] === 1), true, 'Yakov lab workbench should be reachable from spawn');
});

testGenerationMatrix('ordinary story floor craft station placement stays reachable and capped', () => {
  const gen = generateFloor(FloorLevel.MINISTRY, 0x51a7103);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const stations = craftStationCells(gen.world);

  assert.equal(stations.length >= CRAFT_STATION_CAPS.story.min, true, 'ordinary story floor should place craft stations');
  assert.equal(stations.length <= CRAFT_STATION_CAPS.story.max, true, `station count ${stations.length}`);
  assert.equal(stations.every(idx => audit.reachable[idx] === 1), true, 'ordinary story stations should be reachable');
  assert.equal(stations.every(idx => gen.world.aptMask[idx] === 0), true, 'ordinary story stations should not occupy aptMask cells');
});

testGenerationMatrix('maintenance collectors use the story-floor craft station profile', () => {
  const gen = generateFloor(FloorLevel.MAINTENANCE, 0x51001);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const profile = craftStationProfileForStoryFloor(FloorLevel.MAINTENANCE);
  const stations = craftStationCells(gen.world);

  assert.ok(profile, 'maintenance craft station profile should exist');
  assert.equal(craftStationCells(gen.world, 'craft_lathe').length >= 1, true, 'maintenance should expose a lathe');
  assert.equal(craftStationCells(gen.world, 'disassembly_workbench').length >= 1, true, 'maintenance should expose a workbench');
  assert.equal(stations.length >= profile.min, true, 'maintenance should place profile minimum stations');
  assert.equal(stations.length <= profile.max, true, `station count ${stations.length}`);
  assert.equal(stations.every(idx => audit.reachable[idx] === 1), true, 'maintenance stations should be reachable');
});

testGenerationMatrix('slime NII uses design-floor craft station profile', () => {
  const gen = generateDesignFloor('slime_nii');
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const lathe = craftStationCells(gen.world, 'craft_lathe');
  const workbench = craftStationCells(gen.world, 'disassembly_workbench');
  const lab = craftStationCells(gen.world, 'craft_lab_bench');

  assert.equal(lathe.length >= 1, true, 'slime_nii should expose a craft_lathe');
  assert.equal(workbench.length >= 1, true, 'slime_nii should expose a disassembly_workbench');
  assert.equal(lab.length >= 1, true, 'slime_nii should expose a craft_lab_bench');
  assert.equal([...lathe, ...workbench, ...lab].every(idx => audit.reachable[idx] === 1), true, 'slime_nii stations should be reachable');
});

testGenerationMatrix('procedural craft station placement respects cap and avoids aptMask', () => {
  const base = makeProceduralFloorSpec(1, -34);
  const spec: ProceduralFloorSpec = {
    ...base,
    key: 'test_craft_station_caps',
    z: -34,
    depth: 34,
    danger: 4,
    geometryId: 'workshops',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'none',
    title: 'Тестовый цеховой этаж со станциями',
  };
  const gen = generateProceduralFloor(spec);
  const stations = [
    ...craftStationCells(gen.world, 'craft_lathe'),
    ...craftStationCells(gen.world, 'disassembly_workbench'),
    ...craftStationCells(gen.world, 'craft_lab_bench'),
    ...craftStationCells(gen.world, 'recipe_billboard'),
  ];

  assert.equal(stations.length >= 1, true, 'workshop procedural floor should place at least one craft station');
  assert.equal(stations.length <= CRAFT_STATION_CAPS.procedural.max, true, `station count ${stations.length}`);
  assert.equal(stations.every(idx => gen.world.aptMask[idx] === 0), true, 'procedural stations should not occupy aptMask cells');
});
