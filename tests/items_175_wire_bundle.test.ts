import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { EMERGENCY_PANEL_DEFS } from '../src/data/emergency_panels';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';

test('items 175 wire bundle is merged into existing wire coil repair item', () => {
  assert.equal(ITEMS.wire_bundle, undefined, 'wire_bundle should not duplicate wire_coil');

  const def = ITEMS.wire_coil;
  assert.equal(def.id, 'wire_coil');
  assert.equal(def.name, 'Моток провода');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.length > 0, 'wire_coil must remain reachable as room loot');
  assert.ok(def.spawnW > 0, 'wire_coil must remain reachable through generic placement');

  for (const tag of ['repair', 'electronics', 'emergency_panel', 'pneumomail']) {
    assert.ok(ITEM_TAGS.wire_coil?.includes(tag), `wire_coil must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `wire_coil item def must carry ${tag}`);
  }
});

test('wire coil covers electrical repair economy and player spend decisions', () => {
  assert.equal(resourceForItem('wire_coil')?.id, 'tools');
  assert.ok(RESOURCE_BY_ID.electronics.itemIds.includes('wire_coil'));

  const powerPanel = EMERGENCY_PANEL_DEFS.find(def => def.id === 'panel_power');
  assert.ok(powerPanel?.repairCost.some(cost => cost.itemId === 'wire_coil' && cost.count === 1));
});
