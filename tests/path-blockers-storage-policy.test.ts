import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, FloorLevel } from '../src/core/types';
import { World } from '../src/core/world';
import { setPathBlockerRow } from '../src/core/path_blockers';
import {
  captureFloorMemory,
  clearFloorMemory,
  floorMemoryStateForSave,
} from '../src/systems/floor_memory';
import { buildSavePayload } from '../src/systems/save_payload';
import { makeGameState, makeTestPlayer } from './helpers';

function blockerWorld(): World {
  const world = new World();
  const idx = world.idx(12, 13);
  world.cells[idx] = Cell.FLOOR;
  assert.equal(setPathBlockerRow(world, idx, 2, 0b1111), true);
  return world;
}

test('floor memory save excludes full path blocker arrays', () => {
  clearFloorMemory();
  const world = blockerWorld();

  assert.equal(captureFloorMemory('story:path_blocker_policy', world, [], 12.5, 13.5, 1, 0), true);
  const saved = floorMemoryStateForSave();
  const entry = saved.entries.find(candidate => candidate.key === 'story:path_blocker_policy');

  assert.ok(entry, 'captured blocker policy floor should be present in save view');
  assert.equal(Object.prototype.hasOwnProperty.call(entry.world, 'pathBlockers'), false);
  assert.equal(entry.world.arrays.some(array => (array.field as string) === 'pathBlockers'), false);
  assert.equal(JSON.stringify(entry).includes('pathBlockers'), false);

  clearFloorMemory();
});

test('top-level save payload does not acquire path blocker storage', () => {
  clearFloorMemory();
  const world = blockerWorld();
  assert.equal(captureFloorMemory('story:path_blocker_payload', world, [], 12.5, 13.5, 2, 0), true);

  const payload = buildSavePayload({
    player: makeTestPlayer({ x: 12.5, y: 13.5, angle: 0 }),
    state: makeGameState({ currentFloor: FloorLevel.LIVING }),
    containers: [],
    sections: {
      floorRun: undefined,
      floorInstances: undefined,
      liftArachna: undefined,
      pseudolift: undefined,
      floorMemory: floorMemoryStateForSave(),
      alife: undefined,
      alifeMobility: undefined,
      netTerminalGen: undefined,
      mapEditorPatches: undefined,
      worldEvents: undefined,
      crafting: undefined,
      economy: undefined,
      banking: undefined,
      stockMarket: undefined,
      production: undefined,
    },
  });

  assert.equal(JSON.stringify(payload).includes('pathBlockers'), false);
  clearFloorMemory();
});

test('current path blocker source does not derive collision from render-only mesh data', () => {
  const root = process.cwd();
  const sources = [
    'src/core/path_blockers.ts',
    'src/data/path_blockers.ts',
    'src/gen/path_blockers.ts',
    'src/systems/movement_collision.ts',
  ].filter(relative => existsSync(join(root, relative)));

  assert.ok(sources.length >= 1, 'at least the core path blocker source should exist');
  for (const relative of sources) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.equal(source.includes('visualSlots'), false, `${relative} must not read World.visualSlots for blockers`);
    assert.equal(source.includes('visual_models'), false, `${relative} must not import visual model definitions`);
    assert.equal(source.includes('render/mesh'), false, `${relative} must not import render mesh code`);
  }
});
