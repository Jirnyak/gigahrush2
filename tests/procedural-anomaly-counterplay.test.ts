import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, W, type World } from '../src/core/types';
import {
  makeProceduralFloorSpec,
  type FloorAnomalyId,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import {
  tryUseConveyorSorterAnomaly,
  updateConveyorSorterAnomaly,
} from '../src/systems/procedural_anomalies/conveyor_sorter';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import {
  auditReachability,
  describeReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';
import { testGenerationMatrix } from './generator_helpers';
import { makeGameState, makeTestPlayer } from './helpers';

interface HeavyTopologyCase {
  id: Extract<FloorAnomalyId, 'wall_snake' | 'living_tunnels' | 'conway_life' | 'section_shift'>;
  controlFeature: Feature;
  roomPattern: RegExp;
}

const HEAVY_TOPOLOGY_CASES: readonly HeavyTopologyCase[] = [
  { id: 'wall_snake', controlFeature: Feature.SCREEN, roomPattern: /\[wall_snake:/ },
  { id: 'living_tunnels', controlFeature: Feature.APPARATUS, roomPattern: /\[living_tunnel:/ },
  { id: 'section_shift', controlFeature: Feature.APPARATUS, roomPattern: /\[section_shift:/ },
  { id: 'conway_life', controlFeature: Feature.APPARATUS, roomPattern: /^Игра жизнь:/ },
];

function forcedSpec(anomalyId: HeavyTopologyCase['id']): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(880, 9);
  return {
    ...base,
    anomalyId,
    danger: 5,
    title: `${anomalyId}: ${base.title}`,
  };
}

function assertReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection, label: string): void {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return;
  }
  assert.fail(`${label}: no reachable ${LiftDirection[direction]} lift`);
}

function assertReachablePoint(world: World, audit: ReachabilityAudit, x: number, y: number, label: string): void {
  const idx = world.idx(Math.floor(x), Math.floor(y));
  assert.equal(audit.reachable[idx], 1, `${label}: ${describeReachability(audit, world, idx)}`);
}

function forcedConveyorSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(58_058, 9);
  return {
    ...base,
    geometryId: 'workshops',
    baseFloor: FloorLevel.MAINTENANCE,
    anomalyId: 'conveyor_sorter',
    danger: 4,
    title: `сортировочный конвейер: ${base.title}`,
  };
}

for (const anomalyCase of HEAVY_TOPOLOGY_CASES) {
  testGenerationMatrix(`heavy topology anomaly ${anomalyCase.id} keeps route reachable and counterplay cued`, () => {
    const spec = forcedSpec(anomalyCase.id);
    const gen = generateProceduralFloor(spec);
    const world = gen.world;
    const spawnIdx = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
    const audit = auditReachability(world, spawnIdx);

    assertReachableLift(world, audit, LiftDirection.UP, anomalyCase.id);
    assertReachableLift(world, audit, LiftDirection.DOWN, anomalyCase.id);
    assert.equal(
      world.rooms.some(room => anomalyCase.roomPattern.test(room.name)),
      true,
      `${anomalyCase.id}: generation should leave a rebuildable room tag`,
    );
    assert.equal(
      world.features.some(feature => feature === anomalyCase.controlFeature),
      true,
      `${anomalyCase.id}: expected visible interaction affordance`,
    );

    const cue = getRouteCueMarkers(world).find(marker => marker.tags.includes(anomalyCase.id));
    assert.notEqual(cue, undefined, `${anomalyCase.id}: route cue should carry anomaly tag`);
    assert.equal(cue!.tags.includes('route_pressure'), true);
    assert.equal(cue!.label.length > 0 && cue!.hint.length > 0 && cue!.targetName.length > 0, true);
    assertReachablePoint(world, audit, cue!.x, cue!.y, `${anomalyCase.id}: route cue marker`);
    assertReachablePoint(world, audit, cue!.targetX, cue!.targetY, `${anomalyCase.id}: route cue target`);
  });
}

testGenerationMatrix('conveyor sorter creates reachable belts, receivers and local shutdown control', () => {
  const gen = generateProceduralFloor(forcedConveyorSpec());
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const room = world.rooms.find(candidate => candidate.name.startsWith('Сортировочный конвейер'));
  assert.notEqual(room, undefined, 'conveyor room should be stamped');
  assertReachableLift(world, audit, LiftDirection.UP, 'conveyor_sorter');
  assertReachableLift(world, audit, LiftDirection.DOWN, 'conveyor_sorter');

  let controlIdx = -1;
  let receiverIdx = -1;
  for (let y = room!.y + 1; y < room!.y + room!.h - 1; y++) {
    for (let x = room!.x + 1; x < room!.x + room!.w - 1; x++) {
      const idx = world.idx(x, y);
      if (world.roomMap[idx] !== room!.id) continue;
      if (world.features[idx] === Feature.APPARATUS && controlIdx < 0) controlIdx = idx;
      if (world.features[idx] === Feature.SHELF && receiverIdx < 0) receiverIdx = idx;
    }
  }
  assert.notEqual(controlIdx, -1, 'conveyor control apparatus should exist');
  assert.notEqual(receiverIdx, -1, 'conveyor receiver shelf should exist');
  assert.equal(audit.reachable[controlIdx], 1, `control: ${describeReachability(audit, world, controlIdx)}`);
  assert.equal(audit.reachable[receiverIdx], 1, `receiver: ${describeReachability(audit, world, receiverIdx)}`);

  const belt = { x: room!.x + 3, y: room!.y + Math.floor(room!.h / 2) };
  const beltIdx = world.idx(belt.x, belt.y);
  assert.equal(audit.reachable[beltIdx], 1, `belt lane: ${describeReachability(audit, world, beltIdx)}`);
  const player = makeTestPlayer({ x: belt.x + 0.5, y: belt.y + 0.5, hp: 100 });
  const state = makeGameState({ time: 1 });
  updateConveyorSorterAnomaly(world, player, state, 0.36);
  assert.equal(player.x > belt.x + 0.5, true, 'belt should push the player along the item lane');

  const controlX = controlIdx % W;
  const controlY = (controlIdx / W) | 0;
  player.x = controlX + 0.5;
  player.y = controlY + 1.5;
  assert.equal(tryUseConveyorSorterAnomaly(world, player, state, controlX + 0.5, controlY + 0.5), true);
  player.x = belt.x + 0.5;
  player.y = belt.y + 0.5;
  updateConveyorSorterAnomaly(world, player, state, 0.36);
  assert.equal(player.x, belt.x + 0.5, 'shutdown should stop the belt until its timer expires');

  state.time += 25;
  updateConveyorSorterAnomaly(world, player, state, 0.36);
  assert.equal(player.x > belt.x + 0.5, true, 'belt should resume after temporary shutdown');
});
