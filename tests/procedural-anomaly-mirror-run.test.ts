import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, LiftDirection, type World } from '../src/core/types';
import {
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import {
  auditReachability,
  describeReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';
import { getRouteCueMarkers } from '../src/systems/route_cues';

const MIRROR_LOOT = new Set([
  'inspection_mirror',
  'seal_wax',
  'blank_form',
  'water_coupon',
  'fake_pass',
  'bleached_document',
  'filter_receipt',
  'container_key_label',
]);

function forcedMirrorSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(56_056, 9);
  return {
    ...base,
    anomalyId: 'mirror_run',
    danger: 5,
    title: `зеркальная проводка: ${base.title}`,
  };
}

function assertReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): void {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return;
  }
  assert.fail(`no reachable ${direction === LiftDirection.UP ? 'up' : 'down'} lift`);
}

function assertReachablePoint(world: World, audit: ReachabilityAudit, idx: number, label: string): void {
  assert.equal(audit.reachable[idx], 1, `${label}: ${describeReachability(audit, world, idx)}`);
}

function mirrorRoomPairs(world: World): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  for (const room of world.rooms) {
    const match = /^Зеркало (\d+)([AB]):/.exec(room.name);
    if (!match) continue;
    const sides = pairs.get(match[1]) ?? new Set<string>();
    sides.add(match[2]);
    pairs.set(match[1], sides);
  }
  return pairs;
}

test('mirror run anomaly exposes paired tells, sparse shortcuts, and ordinary route reachability', () => {
  const gen = generateProceduralFloor(forcedMirrorSpec());
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));

  assertReachableLift(world, audit, LiftDirection.UP);
  assertReachableLift(world, audit, LiftDirection.DOWN);

  const pairs = mirrorRoomPairs(world);
  assert.equal(pairs.size >= 3, true, 'expected multiple labelled mirror room pairs');
  for (const [ordinal, sides] of pairs) {
    assert.equal(sides.has('A'), true, `mirror pair ${ordinal} should label side A`);
    assert.equal(sides.has('B'), true, `mirror pair ${ordinal} should label side B`);
  }

  const mirrorRooms = world.rooms.filter(room => /^Зеркало \d+[AB]:/.test(room.name));
  const mirrorRoomIds = new Set(mirrorRooms.map(room => room.id));
  const screenRooms = new Set<number>();
  const lampRooms = new Set<number>();
  for (let i = 0; i < world.features.length; i++) {
    const roomId = world.roomMap[i];
    if (!mirrorRoomIds.has(roomId)) continue;
    if (world.features[i] === Feature.SCREEN) screenRooms.add(roomId);
    else if (world.features[i] === Feature.LAMP) lampRooms.add(roomId);
  }
  assert.equal(screenRooms.size >= 6, true);
  assert.equal(lampRooms.size >= 6, true);

  const mirrorContainers = world.containers.filter(container => (
    mirrorRoomIds.has(container.roomId ?? -1) &&
    container.inventory.some(item => MIRROR_LOOT.has(item.defId))
  ));
  assert.equal(mirrorContainers.length >= 6, true, 'expected paired mirror loot to remain in mirror rooms');
  for (const container of mirrorContainers) {
    assertReachablePoint(world, audit, world.idx(container.x, container.y), `mirror loot ${container.name}`);
  }

  assert.equal(world.anomalyTeleports.size > 0, true, 'mirror shortcuts should be present for this seed');
  assert.equal(world.anomalyTeleports.size <= 6, true, 'mirror shortcuts stay sparse');
  for (const [from, to] of world.anomalyTeleports) {
    assert.equal(world.anomalyTeleports.get(to), from, 'mirror shortcut should be bidirectional');
    assert.equal(world.features[from], Feature.SCREEN);
    assert.equal(world.features[to], Feature.SCREEN);
    assertReachablePoint(world, audit, from, 'mirror shortcut source');
    assertReachablePoint(world, audit, to, 'mirror shortcut target');
  }

  const cue = getRouteCueMarkers(world).find(marker => marker.id.includes('_mirror_run_pair_'));
  assert.notEqual(cue, undefined, 'mirror run should register a visible route cue');
  assert.equal(cue!.tags.includes('mirror_run'), true);
  assert.equal(cue!.tags.includes('route_pressure'), true);
  assertReachablePoint(world, audit, world.idx(Math.floor(cue!.x), Math.floor(cue!.y)), 'mirror cue marker');
  assertReachablePoint(world, audit, world.idx(Math.floor(cue!.targetX), Math.floor(cue!.targetY)), 'mirror cue target');
});
