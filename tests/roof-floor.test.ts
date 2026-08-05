import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, FloorLevel, LiftDirection, RoomType, W, ZoneFaction } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  buildRoofLosExposureHeatmap,
  createRoofSkyTextureProvider,
  ROOF_BASE_FLOOR,
  ROOF_FUTURE_Z,
  ROOF_ROUTE_ID,
  ROOF_SKY_HEIGHT,
  ROOF_SKY_WIDTH,
  summarizeRoofLosExposure,
  type RoofGeneration,
} from '../src/gen/design_floors/roof';
import { routeCueCount } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

let cachedGeneration: RoofGeneration | undefined;

function generatedRoof(): RoofGeneration {
  cachedGeneration ??= generateDesignFloor(ROOF_ROUTE_ID) as RoofGeneration;
  return cachedGeneration;
}

function countPlayableCells(gen: RoofGeneration): number {
  let count = 0;
  for (const cell of gen.world.cells) {
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function countReachableCells(gen: RoofGeneration): number {
  const start = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const reachable = auditReachability(gen.world, start).reachable;
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

test('roof is registered as the top authored route floor', () => {
  const route = designFloorById(ROOF_ROUTE_ID);

  assert.equal(route?.z, ROOF_FUTURE_Z);
  assert.equal(route?.baseFloor, ROOF_BASE_FLOOR);
  assert.equal(route?.displayName, 'Крыша');
  assert.equal(route?.baseFloor, FloorLevel.MINISTRY);
  assert.equal(designFloorAtZ(ROOF_FUTURE_Z)?.id, ROOF_ROUTE_ID);
});

test('roof generator exposes sky, shelter cue and two descent routes', () => {
  const gen = generatedRoof();
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const ventShelter = gen.world.rooms.find(room => room.name === 'Вентиляционное укрытие');
  let downLifts = 0;

  for (let i = 0; i < gen.world.liftDir.length; i++) {
    if (gen.world.liftDir[i] === LiftDirection.DOWN && gen.world.cells[i] === Cell.LIFT) downLifts++;
  }

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.skyProvider.width, ROOF_SKY_WIDTH);
  assert.equal(gen.skyProvider.height, ROOF_SKY_HEIGHT);
  assert.equal(gen.skyProvider.pixels.length, ROOF_SKY_WIDTH * ROOF_SKY_HEIGHT);
  assert.equal(routeCueCount(gen.world), 1);
  assert.equal(ventShelter?.sealed, true);
  assert.equal(downLifts >= 2, true);
});

test('roof scale has macro deck network, mid blocks and micro rooms', () => {
  const gen = generatedRoof();
  const openDecks = gen.world.rooms.filter(room => room.name.startsWith('Крыша: открытая плита'));
  const microRooms = gen.world.rooms.filter(room =>
    room.name.includes('будка') ||
    room.name.includes('кладов') ||
    room.name.includes('шкаф') ||
    room.name.includes('пост') ||
    room.name.includes('ниша') ||
    room.name.includes('щель') ||
    room.name.includes('келья') ||
    room.name.includes('кабель')
  );
  const playableCells = countPlayableCells(gen);
  const reachableCells = countReachableCells(gen);

  assert.equal(gen.world.rooms.length >= 750, true);
  assert.equal(gen.world.doors.size >= 1_200, true);
  assert.equal(playableCells >= 380_000, true);
  assert.equal(reachableCells >= 370_000, true);
  assert.equal(playableCells - reachableCells <= 20_000, true);
  assert.equal(openDecks.length >= 24, true);
  assert.equal(microRooms.length >= 600, true);
});

test('roof territory starts from HQ anchors and matches control brief', () => {
  const gen = generatedRoof();
  const anchors = territoryHqAnchors(gen.world);
  const anchorByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const targetShares = new Map([
    [ZoneFaction.CITIZEN, 0.28],
    [ZoneFaction.LIQUIDATOR, 0.38],
    [ZoneFaction.CULTIST, 0.08],
    [ZoneFaction.SCIENTIST, 0.14],
    [ZoneFaction.WILD, 0.12],
  ]);

  for (const [owner, targetShare] of targetShares) {
    const anchor = anchorByOwner.get(owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    const share = (counts.get(owner) ?? 0) / (W * W);
    assert.equal(room?.type, RoomType.HQ, `owner ${owner} should have an HQ anchor`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owner ${owner} cells`);
    assert.equal(Math.abs(share - targetShare) <= 0.015, true, `owner ${owner} share ${share}`);
  }

  let dominant = ZoneFaction.CITIZEN;
  for (const [owner, cells] of counts) {
    if (owner === ZoneFaction.SAMOSBOR) continue;
    if (cells > (counts.get(dominant) ?? 0)) dominant = owner;
  }
  assert.equal(dominant, ZoneFaction.LIQUIDATOR);
});

test('roof sky provider updates bounded cloud pixels and fog tint', () => {
  const sky = createRoofSkyTextureProvider(94, 0.42);
  const firstFog = { ...sky.fogTint };

  sky.dirty = false;
  assert.equal(sky.update(sky.updateInterval * 0.5), false);
  assert.equal(sky.dirty, false);
  assert.equal(sky.update(sky.updateInterval), true);
  assert.equal(sky.dirty, true);

  sky.dirty = false;
  sky.cycleTime(6);
  assert.equal(sky.dirty, true);
  assert.notDeepEqual(sky.fogTint, firstFog);
});

test('roof LOS exposure map keeps ordinary crossings near shelter pockets', () => {
  const gen = generatedRoof();
  const heat = buildRoofLosExposureHeatmap(gen.world);
  const exposure = summarizeRoofLosExposure(gen.world, heat);

  assert.equal(exposure.exposedCells > 10_000, true);
  assert.equal(exposure.deliberateExposedCells > 0, true);
  assert.equal(exposure.shelterCells >= 1_800, true);
  assert.equal(exposure.unshelteredExposedCells <= 128, true);
  assert.equal(exposure.maxScore > 140, true);
});
