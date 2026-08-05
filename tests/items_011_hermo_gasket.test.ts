import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { EMERGENCY_PANEL_DEFS } from '../src/data/emergency_panels';
import { ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('hermo gasket is a spendable door seal repair component', () => {
  const def = ITEMS.hermo_gasket;
  assert.ok(def);
  assert.equal(def.name, 'Гермопрокладка');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  for (const tag of ['repair', 'seal', 'hermodoor', 'lift', 'samosbor', 'tool']) {
    assert.equal(def.tags?.includes(tag), true, `hermo_gasket missing ${tag} tag`);
  }

  const doorPanel = EMERGENCY_PANEL_DEFS.find(panel => panel.id === 'panel_doors');
  assert.ok(doorPanel);
  assert.deepEqual(doorPanel.repairCost.map(cost => cost.itemId), ['door_kit', 'hermo_gasket']);
  assert.match(doorPanel.actionLabels.repair, /гермоконтур/);

  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER];
  assert.equal(toolLocker.itemPool.some(item => item.defId === 'hermo_gasket'), true);
});
