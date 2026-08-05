import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell } from '../src/core/types';
import { SURFACE_FLAG_CHALK_MAP, World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { addItem } from '../src/systems/inventory';
import {
  CHALK_ITEM_ID,
  chalkRgbFromData,
  drawEquippedChalkPixel,
} from '../src/systems/chalk';
import { surfaceMapMarkersForTests } from '../src/render/map_ui';
import { makeTestPlayer } from './helpers';

test('chalk pickup creates one colored tool instance per slot', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, CHALK_ITEM_ID, 2), true);

  const slots = player.inventory?.filter(slot => slot.defId === CHALK_ITEM_ID) ?? [];
  assert.equal(slots.length, 2);
  assert.equal(slots.every(slot => slot.count === 1), true);
  for (const slot of slots) {
    const rgb = chalkRgbFromData(slot.data);
    assert.ok(rgb, 'chalk slot should carry RGB data');
    assert.equal((slot.data as { dur?: number }).dur, ITEMS[CHALK_ITEM_ID].durability);
    assert.equal(rgb.every(v => v >= 0 && v <= 255), true);
  }
});

test('equipped chalk paints one floor surface pixel under the player', () => {
  const world = new World();
  const player = makeTestPlayer({ x: 10.25, y: 11.75, tool: CHALK_ITEM_ID });
  const ci = world.idx(10, 11);
  world.cells[ci] = Cell.FLOOR;
  assert.equal(addItem(player, CHALK_ITEM_ID, 1), true);

  assert.equal(drawEquippedChalkPixel(world, player, ITEMS[CHALK_ITEM_ID].durability ?? 0), true);

  const pixels = world.surfaceMap.get(ci);
  assert.ok(pixels, 'chalk should allocate a surface cell');
  const px = Math.floor(0.25 * 16);
  const py = Math.floor(0.75 * 16);
  const pi = (py * 16 + px) << 2;
  assert.equal(pixels[pi + 3] > 0, true);
  assert.equal((world.surfaceFlags[ci] & SURFACE_FLAG_CHALK_MAP) !== 0, true);
  assert.equal(world.surfaceVersion, 1);
});

test('map surface markers only include cells explicitly marked by chalk', () => {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  const bloodIdx = world.idx(3, 4);
  const chalkIdx = world.idx(10, 11);
  const blood = new Uint8Array(16 * 16 * 4);
  blood[0] = 170;
  blood[3] = 220;
  world.surfaceMap.set(bloodIdx, blood);

  const player = makeTestPlayer({ x: 10.25, y: 11.75, tool: CHALK_ITEM_ID });
  assert.equal(addItem(player, CHALK_ITEM_ID, 1), true);
  assert.equal(drawEquippedChalkPixel(world, player, ITEMS[CHALK_ITEM_ID].durability ?? 0), true);

  const markers = surfaceMapMarkersForTests(world);
  assert.equal(markers.has(chalkIdx), true);
  assert.equal(markers.has(bloodIdx), false);
});

test('chalk does not paint wall cells', () => {
  const world = new World();
  const player = makeTestPlayer({ x: 3.5, y: 4.5, tool: CHALK_ITEM_ID });
  assert.equal(addItem(player, CHALK_ITEM_ID, 1), true);

  assert.equal(drawEquippedChalkPixel(world, player, ITEMS[CHALK_ITEM_ID].durability ?? 0), false);
  assert.equal(world.surfaceMap.size, 0);
  assert.equal(world.surfaceFlags.some(flag => flag !== 0), false);
  assert.equal(world.surfaceVersion, 0);
});
