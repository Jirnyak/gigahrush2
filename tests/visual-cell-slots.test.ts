import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature, RoomType, W } from '../src/core/types';
import {
  EMPTY_VISUAL_CELL_CODE,
  VISUAL_SLOTS_PER_CELL,
  World,
  clearVisualSlots,
  getVisualSlot,
  setVisualSlot,
  visualSlotOffset,
} from '../src/core/world';
import {
  VISUAL_CELL_DEF_BY_CODE,
  VISUAL_CELL_DEF_BY_ID,
  VISUAL_CELL_DEFS,
  visualCellDefById,
} from '../src/data/visual_cell_slots';
import {
  addVisualSlotByPriority,
  addVisualSlotFirstFree,
  featureVisualCellIds,
  fillVisualSlotsFromFeature,
  fillVisualSlotsForWorldFeatures,
  fillVisualSlotsForRoomDecor,
  rebuildVisualSlotsFromWorldFeatures,
  resolveVisualCellFace,
  visualWallLineMergeCompatible,
} from '../src/gen/visual_cell_slots';
import {
  captureFloorMemory,
  clearFloorMemory,
  floorMemoryStateForSave,
} from '../src/systems/floor_memory';
import { addTestRoom } from './helpers';

const ID_RE = /^[a-z][a-z0-9_]*$/;

function code(id: string): number {
  const def = visualCellDefById(id);
  assert.ok(def, `missing visual cell def ${id}`);
  return def.code;
}

function slotCodes(world: World, cellIdx: number): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) out.push(getVisualSlot(world, cellIdx, slot));
  return out;
}

function nonEmptyVisualSlots(world: World): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i < world.visualSlots.length; i++) {
    const value = world.visualSlots[i];
    if (value !== EMPTY_VISUAL_CELL_CODE) out.push([i, value]);
  }
  return out;
}


test('visual slot bounds validation handles edge cases', () => {
  const world = new World();
  const validCell = 0;
  const validSlot = 0;
  const validCode = 0;

  // assertVisualSlotCell
  assert.throws(() => visualSlotOffset(-1, validSlot), RangeError);
  assert.throws(() => visualSlotOffset(W * W, validSlot), RangeError);
  assert.throws(() => visualSlotOffset(1.5, validSlot), RangeError);
  assert.throws(() => visualSlotOffset(NaN, validSlot), RangeError);
  assert.throws(() => visualSlotOffset(Infinity, validSlot), RangeError);
  assert.throws(() => visualSlotOffset(-Infinity, validSlot), RangeError);
  // Valid extremes for cell
  assert.ok(visualSlotOffset(0, validSlot) >= 0);
  assert.ok(visualSlotOffset(W * W - 1, validSlot) >= 0);

  // assertVisualSlotIndex
  assert.throws(() => visualSlotOffset(validCell, -1), RangeError);
  assert.throws(() => visualSlotOffset(validCell, VISUAL_SLOTS_PER_CELL), RangeError);
  assert.throws(() => visualSlotOffset(validCell, 1.5), RangeError);
  assert.throws(() => visualSlotOffset(validCell, NaN), RangeError);
  assert.throws(() => visualSlotOffset(validCell, Infinity), RangeError);
  assert.throws(() => visualSlotOffset(validCell, -Infinity), RangeError);
  // Valid extremes for slot
  assert.ok(visualSlotOffset(validCell, 0) >= 0);
  assert.ok(visualSlotOffset(validCell, VISUAL_SLOTS_PER_CELL - 1) >= 0);

  // assertVisualCellCode
  assert.throws(() => setVisualSlot(world, validCell, validSlot, -1), RangeError);
  assert.throws(() => setVisualSlot(world, validCell, validSlot, 256), RangeError);
  assert.throws(() => setVisualSlot(world, validCell, validSlot, 1.5), RangeError);
  assert.throws(() => setVisualSlot(world, validCell, validSlot, NaN), RangeError);
  assert.throws(() => setVisualSlot(world, validCell, validSlot, Infinity), RangeError);
  assert.throws(() => setVisualSlot(world, validCell, validSlot, -Infinity), RangeError);
  // Valid extremes for code
  assert.doesNotThrow(() => setVisualSlot(world, validCell, validSlot, 0));
  assert.doesNotThrow(() => setVisualSlot(world, validCell, validSlot, 255));
});

test('world visual slots are a flat 16-byte-per-cell layer', () => {
  const world = new World();
  const cellIdx = 7;

  assert.equal(world.visualSlots.length, W * W * VISUAL_SLOTS_PER_CELL);
  assert.equal(visualSlotOffset(cellIdx, 3), cellIdx * VISUAL_SLOTS_PER_CELL + 3);
  assert.equal(getVisualSlot(world, cellIdx, 3), EMPTY_VISUAL_CELL_CODE);
  assert.throws(() => visualSlotOffset(cellIdx, -1), RangeError);
  assert.throws(() => visualSlotOffset(cellIdx, VISUAL_SLOTS_PER_CELL), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, 256), RangeError);

  // Validation edge cases
  assert.throws(() => visualSlotOffset(-1, 0), RangeError);
  assert.throws(() => visualSlotOffset(W * W, 0), RangeError);
  assert.throws(() => visualSlotOffset(NaN, 0), RangeError);
  assert.throws(() => visualSlotOffset(Infinity, 0), RangeError);
  assert.throws(() => visualSlotOffset(1.5, 0), RangeError);

  assert.throws(() => visualSlotOffset(cellIdx, NaN), RangeError);
  assert.throws(() => visualSlotOffset(cellIdx, Infinity), RangeError);
  assert.throws(() => visualSlotOffset(cellIdx, 1.5), RangeError);

  assert.throws(() => setVisualSlot(world, cellIdx, 0, -1), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, NaN), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, Infinity), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, 1.5), RangeError);

  const before = world.visualSlotVersion;
  assert.equal(setVisualSlot(world, cellIdx, 3, code('pipe_wall_small')), true);
  assert.equal(getVisualSlot(world, cellIdx, 3), code('pipe_wall_small'));
  assert.equal(world.visualSlotVersion, before + 1);
  assert.equal(setVisualSlot(world, cellIdx, 3, code('pipe_wall_small')), false);
  assert.equal(clearVisualSlots(world, cellIdx), true);
  assert.equal(getVisualSlot(world, cellIdx, 3), EMPTY_VISUAL_CELL_CODE);
});


test('setVisualSlot rejects invalid visual cell codes', () => {
  const world = new World();
  const cellIdx = 7;

  // valid bounds
  assert.equal(setVisualSlot(world, cellIdx, 0, 0), false); // 0 is EMPTY_VISUAL_CELL_CODE, so it returns false since it is already 0
  assert.equal(setVisualSlot(world, cellIdx, 1, 255), true);

  // out of bounds
  assert.throws(() => setVisualSlot(world, cellIdx, 0, -1), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, 256), RangeError);

  // non-integers
  assert.throws(() => setVisualSlot(world, cellIdx, 0, 128.5), RangeError);

  // non-finite
  assert.throws(() => setVisualSlot(world, cellIdx, 0, Infinity), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, -Infinity), RangeError);
  assert.throws(() => setVisualSlot(world, cellIdx, 0, NaN), RangeError);
});

test('visual cell slot registry uses unique non-empty byte codes', () => {
  const ids = new Set<string>();
  const codes = new Set<number>();

  for (const def of VISUAL_CELL_DEFS) {
    assert.match(def.id, ID_RE);
    assert.equal(ids.has(def.id), false, `duplicate visual cell id ${def.id}`);
    assert.equal(codes.has(def.code), false, `duplicate visual cell code ${def.code}`);
    assert.ok(def.code >= 1 && def.code <= 255, `${def.id} code must fit 1..255`);
    assert.ok(def.priority >= 0 && def.priority <= 255, `${def.id} priority should stay byte-like`);
    assert.ok(def.densityCost >= 0 && def.densityCost <= 16, `${def.id} density cost should stay bounded`);
    assert.equal(VISUAL_CELL_DEF_BY_ID.get(def.id)?.code, def.code);
    assert.equal(VISUAL_CELL_DEF_BY_CODE.get(def.code)?.id, def.id);
    ids.add(def.id);
    codes.add(def.code);
  }

  assert.equal(codes.has(EMPTY_VISUAL_CELL_CODE), false, '0 is reserved for empty visual slots');
});

test('visual slot insertion fills the first lane and replaces deterministically by priority', () => {
  const a = new World();
  const b = new World();
  const cellIdx = a.idx(11, 12);
  const low = code('rubble_chunk');
  const high = code('machine_panel');

  assert.equal(addVisualSlotFirstFree(a, cellIdx, low), 0);
  for (let slot = 1; slot < VISUAL_SLOTS_PER_CELL; slot++) setVisualSlot(a, cellIdx, slot, low);
  for (let slot = 0; slot < VISUAL_SLOTS_PER_CELL; slot++) setVisualSlot(b, cellIdx, slot, low);

  const replacedA = addVisualSlotByPriority(a, cellIdx, high, 0xabc);
  const replacedB = addVisualSlotByPriority(b, cellIdx, high, 0xabc);

  assert.equal(replacedA, replacedB);
  assert.equal(getVisualSlot(a, cellIdx, replacedA), high);
  assert.deepEqual(slotCodes(a, cellIdx), slotCodes(b, cellIdx));
  assert.equal(addVisualSlotByPriority(a, cellIdx, low, 0xabc), -1, 'low priority code should not replace high priority content');
});

test('feature-to-visual transitional fill is deterministic', () => {
  const a = new World();
  const b = new World();
  const cellIdx = a.idx(20, 20);
  a.cells[cellIdx] = Cell.FLOOR;
  b.cells[cellIdx] = Cell.FLOOR;
  a.features[cellIdx] = Feature.LAMP;
  b.features[cellIdx] = Feature.LAMP;

  const lampCodes = new Set([code('ceiling_bulb'), code('ceiling_light_panel')]);
  assert.deepEqual(featureVisualCellIds(Feature.LAMP), ['ceiling_bulb', 'ceiling_light_panel']);
  assert.equal(fillVisualSlotsFromFeature(a, cellIdx, 1234), 2);
  assert.equal(fillVisualSlotsFromFeature(b, cellIdx, 1234), 2);
  assert.deepEqual(slotCodes(a, cellIdx), slotCodes(b, cellIdx));
  assert.equal(slotCodes(a, cellIdx).some(slot => lampCodes.has(slot)), true);
  assert.equal(slotCodes(a, cellIdx).includes(code('lamp_stand_hint')), false);
  assert.equal(fillVisualSlotsFromFeature(a, cellIdx, 1234), 0, 'feature fill should be idempotent');
});

test('feature rebuild derives visual slots from current feature grid', () => {
  const world = new World();
  const lamp = world.idx(22, 22);
  const machine = world.idx(23, 22);
  world.cells[lamp] = Cell.FLOOR;
  world.cells[machine] = Cell.FLOOR;
  world.features[lamp] = Feature.LAMP;
  world.features[machine] = Feature.MACHINE;
  setVisualSlot(world, lamp, 0, code('rubble_chunk'));

  const placed = rebuildVisualSlotsFromWorldFeatures(world, 0x5150);

  assert.equal(placed >= 4, true);
  assert.equal(slotCodes(world, lamp).includes(code('rubble_chunk')), false);
  assert.equal(slotCodes(world, lamp).some(slot => slot === code('ceiling_bulb') || slot === code('ceiling_light_panel')), true);
  assert.equal(slotCodes(world, lamp).includes(code('lamp_stand_hint')), false);
  assert.equal(slotCodes(world, machine).includes(code('machine_body')), true);
  assert.equal(slotCodes(world, machine).includes(code('machine_panel')), true);
});

test('world feature fill preserves existing non-feature visual decor', () => {
  const world = new World();
  const lamp = world.idx(26, 26);
  world.cells[lamp] = Cell.FLOOR;
  world.features[lamp] = Feature.LAMP;
  setVisualSlot(world, lamp, 0, code('pipe_wall_small'));

  const placed = fillVisualSlotsForWorldFeatures(world, 0x5151);

  assert.equal(placed, 2);
  assert.equal(slotCodes(world, lamp).includes(code('pipe_wall_small')), true);
  assert.equal(slotCodes(world, lamp).some(slot => slot === code('ceiling_bulb') || slot === code('ceiling_light_panel')), true);
  assert.equal(slotCodes(world, lamp).includes(code('lamp_stand_hint')), false);
});

test('room visual decor fills wall, ceiling and column slots deterministically under caps', () => {
  const a = new World();
  const b = new World();
  const roomA = addTestRoom(a, { type: RoomType.PRODUCTION, w: 18, h: 14 });
  const roomB = addTestRoom(b, { type: RoomType.PRODUCTION, w: 18, h: 14 });
  const options = {
    seed: 0x5eed,
    tags: ['maintenance', 'industrial'],
    wallCap: 8,
    ceilingCap: 4,
    columnCap: 2,
    maxPerRoom: 8,
    avoidX: roomA.x + 1,
    avoidY: roomA.y + 1,
  };
  const wallCodes = new Set([
    code('pipe_wall_small'),
    code('pipe_wall_large'),
    code('cable_wall_loose'),
  ]);
  const ceilingCodes = new Set([
    code('ceiling_pipe_bundle'),
    code('ceiling_cable_bundle'),
  ]);

  const summaryA = fillVisualSlotsForRoomDecor(a, [roomA], options);
  const summaryB = fillVisualSlotsForRoomDecor(b, [roomB], options);

  assert.deepEqual(summaryA, summaryB);
  assert.equal(summaryA.wallFixtures > 0 && summaryA.wallFixtures <= 8, true);
  assert.equal(summaryA.ceilingDetails > 0 && summaryA.ceilingDetails <= 4, true);
  assert.equal(summaryA.columns > 0 && summaryA.columns <= 2, true);
  const entries = nonEmptyVisualSlots(a);
  assert.deepEqual(entries, nonEmptyVisualSlots(b));
  assert.equal(entries.some(([, value]) => wallCodes.has(value)), true);
  assert.equal(entries.some(([, value]) => ceilingCodes.has(value)), true);
  assert.equal(entries.some(([offset, value]) => {
    if (!ceilingCodes.has(value)) return false;
    const cellIdx = Math.floor(offset / VISUAL_SLOTS_PER_CELL);
    const x = cellIdx % W;
    const y = (cellIdx / W) | 0;
    return slotCodes(a, a.idx(x + 1, y)).includes(value) ||
      slotCodes(a, a.idx(x, y + 1)).includes(value);
  }), true);
  assert.equal(entries.some(([, value]) => value === code('column_concrete_round')), true);
});

test('wall-cell visual codes resolve to exposed passable wall faces', () => {
  const world = new World();
  const wall = world.idx(40, 40);
  const floor = world.idx(39, 40);
  world.cells[wall] = Cell.WALL;
  world.cells[floor] = Cell.FLOOR;
  setVisualSlot(world, wall, 0, code('pipe_wall_small'));

  const resolved = resolveVisualCellFace(world, wall, 0, 9);

  assert.ok(resolved);
  assert.equal(resolved.wallCell, wall);
  assert.equal(resolved.normalX, -1);
  assert.equal(resolved.normalY, 0);
});

test('adjacent-floor visual codes resolve to neighboring wall faces', () => {
  const world = new World();
  const source = world.idx(50, 50);
  const wall = world.idx(51, 50);
  world.cells[source] = Cell.FLOOR;
  world.cells[wall] = Cell.WALL;
  world.cells[world.idx(49, 50)] = Cell.FLOOR;
  world.cells[world.idx(50, 49)] = Cell.FLOOR;
  world.cells[world.idx(50, 51)] = Cell.FLOOR;
  setVisualSlot(world, source, 0, code('button_panel'));

  const resolved = resolveVisualCellFace(world, source, 0, 77);

  assert.ok(resolved);
  assert.equal(resolved.sourceCell, source);
  assert.equal(resolved.wallCell, wall);
  assert.equal(resolved.normalX, -1);
  assert.equal(resolved.normalY, 0);
});

test('wall-only codes without exposed wall context are skipped safely', () => {
  const world = new World();
  const sealedWall = world.idx(60, 60);
  const floor = world.idx(62, 60);
  world.cells[sealedWall] = Cell.WALL;
  world.cells[floor] = Cell.FLOOR;
  setVisualSlot(world, sealedWall, 0, code('pipe_wall_small'));
  setVisualSlot(world, floor, 0, code('pipe_wall_small'));

  assert.equal(resolveVisualCellFace(world, sealedWall, 0, 1), null);
  assert.equal(resolveVisualCellFace(world, floor, 0, 1), null);
});

test('wall-line merge requires the same resolved wall face', () => {
  const world = new World();
  const a = world.idx(70, 70);
  const b = world.idx(70, 71);
  const c = world.idx(71, 70);
  world.cells[world.idx(69, 70)] = Cell.FLOOR;
  world.cells[world.idx(69, 71)] = Cell.FLOOR;
  world.cells[world.idx(71, 69)] = Cell.FLOOR;
  setVisualSlot(world, a, 0, code('pipe_wall_small'));
  setVisualSlot(world, b, 0, code('pipe_wall_small'));
  setVisualSlot(world, c, 0, code('pipe_wall_small'));

  assert.equal(visualWallLineMergeCompatible(world, a, 0, b, 0, 42), true);
  assert.equal(visualWallLineMergeCompatible(world, a, 0, c, 0, 42), false);
});

test('floor memory save does not full-dump visual slot bytes', () => {
  clearFloorMemory();
  const world = new World();
  const cellIdx = world.idx(80, 80);
  setVisualSlot(world, cellIdx, 0, code('machine_panel'));

  assert.equal(captureFloorMemory('story:visual_slots', world, [], 1, 1, 1, 0), true);
  const saved = floorMemoryStateForSave();
  const entry = saved.entries.find(candidate => candidate.key === 'story:visual_slots');
  assert.ok(entry);

  assert.equal(Object.prototype.hasOwnProperty.call(entry.world, 'visualSlots'), false);
  assert.equal(entry.world.arrays.some(array => (array.field as string) === 'visualSlots'), false);
  assert.equal(JSON.stringify(entry).includes('visualSlots'), false);
  clearFloorMemory();
});
