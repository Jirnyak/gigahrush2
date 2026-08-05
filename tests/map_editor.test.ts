import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, ContainerKind, DoorState, EntityType, FloorLevel, Tex } from '../src/core/types';
import { World } from '../src/core/world';
import {
  applyMapEditorOp,
  closeMapEditor,
  commitMapEditorChanges,
  currentMapEditorFloorKey,
  openMapEditor,
  replayMapEditorPatchForCurrentFloor,
  setMapEditorPatchState,
  ensureMapEditorPatchState,
  isMapEditorOpen,
} from '../src/systems/map_editor';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function makeEditorFixture(): {
  world: World;
  state: ReturnType<typeof makeGameState>;
  player: ReturnType<typeof makeTestPlayer>;
  entities: ReturnType<typeof makeTestPlayer>[];
  nextEntityId: { v: number };
} {
  const world = new World();
  addTestRoom(world, { id: 0, x: 8, y: 8, w: 8, h: 8, zoneId: 0 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 10 });
  const player = makeTestPlayer({ id: 1, x: 9.5, y: 9.5 });
  return { world, state, player, entities: [player], nextEntityId: { v: 2 } };
}

test('map editor mutates the live world and commits cell topology once on close', () => {
  const { world, state, player, entities, nextEntityId } = makeEditorFixture();
  const idx = world.idx(12, 12);
  const beforeCellVersion = world.cellVersion;

  openMapEditor(world, player, state);
  const result = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'set_cell',
    x: 12,
    y: 12,
    cell: Cell.WALL,
  });

  assert.equal(result.ok, true);
  assert.equal(world.cells[idx], Cell.WALL);
  assert.equal(world.cellVersion, beforeCellVersion, 'brush stroke should not rebake navigation immediately');

  const commit = closeMapEditor();
  assert.equal(commit.changed, true);
  assert.equal(commit.geometry, true);
  assert.equal(world.cellVersion > beforeCellVersion, true, 'closing editor should invalidate topology once');
});

test('map editor set-door and delete-door update real door records and room metadata', () => {
  const { world, state, player, entities, nextEntityId } = makeEditorFixture();
  const idx = world.idx(13, 12);

  const set = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'set_door',
    x: 13,
    y: 12,
    state: DoorState.LOCKED,
    keyId: 'test_key',
  });
  assert.equal(set.ok, true);
  assert.equal(world.cells[idx], Cell.DOOR);
  assert.equal(world.doors.get(idx)?.state, DoorState.LOCKED);
  assert.equal(world.rooms[0].doors.includes(idx), true);

  const del = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'delete_door',
    x: 13,
    y: 12,
  });
  assert.equal(del.ok, true);
  assert.equal(world.cells[idx], Cell.FLOOR);
  assert.equal(world.doors.has(idx), false);
  assert.equal(world.rooms[0].doors.includes(idx), false);
  assert.equal(commitMapEditorChanges(world).doors, true);
});

test('map editor entity and container operations use real registries', () => {
  const { world, state, player, entities, nextEntityId } = makeEditorFixture();

  const spawnItem = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'spawn_entity',
    x: 12,
    y: 12,
    entityDef: { kind: 'item', itemId: 'water', count: 2 },
  });
  assert.equal(spawnItem.ok, true);
  const drop = entities.find(entity => entity.type === EntityType.ITEM_DROP);
  assert.equal(drop?.inventory?.[0]?.defId, 'water');
  assert.equal(drop?.inventory?.[0]?.count, 2);

  const spawnContainer = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'spawn_container',
    x: 12,
    y: 13,
    def: { kind: ContainerKind.METAL_CABINET, itemId: 'water', count: 1 },
  });
  assert.equal(spawnContainer.ok, true);
  const container = world.containers[0];
  assert.equal(container.kind, ContainerKind.METAL_CABINET);
  assert.equal(container.inventory[0]?.defId, 'water');
  assert.deepEqual(world.containersAt(12, 13).map(c => c.id), [container.id]);

  const delContainer = applyMapEditorOp(world, entities, player, state, nextEntityId, {
    kind: 'delete_container',
    containerId: container.id,
  });
  assert.equal(delContainer.ok, true);
  assert.equal(world.containersAt(12, 13).length, 0);

  const commit = commitMapEditorChanges(world);
  assert.equal(commit.entities, true);
  assert.equal(commit.containers, true);
});

test('map editor patch replay sanitizes malformed ops and commits restored edits', () => {
  const { world, state, player, entities, nextEntityId } = makeEditorFixture();
  const key = currentMapEditorFloorKey(state);
  const cellIdx = world.idx(10, 10);
  const doorIdx = world.idx(11, 10);
  const beforeCellVersion = world.cellVersion;

  setMapEditorPatchState(state, {
    patches: {
      [key]: {
        floorKey: key,
        baseFloor: FloorLevel.LIVING,
        createdAt: 1,
        opCount: 5,
        ops: [
          { kind: 'set_cell', x: 10, y: 10, cell: Cell.WATER },
          { kind: 'set_door', x: 11, y: 10, state: DoorState.CLOSED, keyId: 'k'.repeat(200) },
          { kind: 'set_wall_tex', x: 10, y: 10, tex: Tex.CONCRETE },
          { kind: 'set_cell', x: Number.NaN, y: 10, cell: Cell.WALL },
          { kind: 'spawn_entity', x: 12, y: 12, entityDef: { kind: 'item', itemId: 'missing_item' } },
        ],
      },
    },
    skipped: [],
  });

  const applied = replayMapEditorPatchForCurrentFloor(world, entities, player, state, nextEntityId);
  assert.equal(applied, 3);
  assert.equal(world.cells[cellIdx], Cell.WATER);
  assert.equal(world.cells[doorIdx], Cell.DOOR);
  assert.equal(world.doors.get(doorIdx)?.keyId.length, 96);
  assert.equal(world.wallTex[cellIdx], Tex.CONCRETE);
  assert.equal(world.cellVersion > beforeCellVersion, true);
});

test('ensureMapEditorPatchState initializes and returns valid patch state', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 10 });
  const patchState = ensureMapEditorPatchState(state);
  assert.ok(patchState);
  assert.ok(patchState.patches);
  assert.ok(Array.isArray(patchState.skipped));
});

test('isMapEditorOpen returns true when editor is open and false when closed', () => {
  const { world, state, player } = makeEditorFixture();
  assert.equal(isMapEditorOpen(), false, 'should be initially closed');

  openMapEditor(world, player, state);
  assert.equal(isMapEditorOpen(), true, 'should be open after openMapEditor');

  closeMapEditor();
  assert.equal(isMapEditorOpen(), false, 'should be closed after closeMapEditor');
});
