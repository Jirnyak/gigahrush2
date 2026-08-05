import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('weapon checkout tag is official armory audit paperwork', () => {
  const def = ITEMS.weapon_checkout_tag;

  assert.equal(def.id, 'weapon_checkout_tag');
  assert.equal(def.name, 'Оружейная бирка');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'weapon', 'weapon_permit', 'audit', 'official', 'evidence', 'armory']) {
    assert.ok(ITEM_TAGS.weapon_checkout_tag?.includes(tag), `weapon_checkout_tag registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `weapon_checkout_tag item must carry ${tag}`);
  }
});

test('weapon checkout tag is reachable from a liquidator issue stash as theft evidence', () => {
  const world = new World();
  const entities = [];
  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'weapon_checkout_tag')
  );

  assert.ok(stash, 'liquidator issue stash should expose weapon_checkout_tag');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator_archive'));
  assert.ok(stash.tags.includes('issue_stash'));
  assert.ok(stash.tags.includes('theft'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});

test('weapon checkout tag can be sold or spent to scrub stolen weapon serials', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 91 });
  assert.equal(addItem(player, 'weapon_checkout_tag', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'weapon_checkout_tag'), 0);
  assert.equal(player.money, 28);

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, 'weapon_checkout_tag');
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');

  const scrubRecipe = FACTORIES
    .find(factory => factory.id === 'illegal_ammo_smelter')
    ?.recipes.find(recipe => recipe.id === 'scrub_weapon_serials');
  assert.ok(scrubRecipe, 'illegal ammo smelter should expose serial scrubbing');
  assert.ok(scrubRecipe.inputItems?.some(item => item.defId === 'weapon_checkout_tag' && item.count === 1));
  assert.ok(scrubRecipe.outputs.some(item => item.defId === 'scrubbed_serial_plate' && item.count === 2));
});
