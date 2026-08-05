import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

const ITEM_ID = 'electrode_pack';

test('electrode pack is a production repair consumable', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Электроды');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnW > 0);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(ITEM_ID)?.id, 'metal');

  for (const tag of ['metal', 'repair', 'repair_input', 'factory_input', 'production', 'welding', 'trade']) {
    assert.ok(def.tags?.includes(tag), `electrode_pack must publish ${tag} on the item`);
    assert.ok(ITEM_TAGS.electrode_pack?.includes(tag), `electrode_pack tag registry must publish ${tag}`);
  }
});

test('electrode pack is reachable and spendable through production', () => {
  const metalCabinet = CONTAINER_DEFS[ContainerKind.METAL_CABINET].itemPool;
  const cabinetEntry = metalCabinet.find(entry => entry.defId === ITEM_ID);
  assert.ok(cabinetEntry, 'metal cabinets must stock electrode packs');
  assert.ok((cabinetEntry.chance ?? 1) > 0);

  const metalShop = FACTORIES.find(factory => factory.id === 'metal_shop');
  const recipe = metalShop?.recipes.find(row => row.id === 'weld_emergency_door_kit');
  assert.ok(recipe, 'metal shop must spend electrode packs on an emergency repair recipe');
  assert.deepEqual(recipe.inputItems, [{ defId: ITEM_ID, count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'door_kit', count: 1 }]);
  assert.ok(recipe.outputTags.includes('repair_input'));
  assert.ok(recipe.eventTags?.includes(ITEM_ID));
});
