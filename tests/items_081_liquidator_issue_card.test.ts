import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { getRecentEvents } from '../src/systems/events';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const CARD_ID = 'liquidator_issue_card';
const FIELD_KIT = ['filter_canister', 'decon_fluid', 'sterile_bandage', 'liquidator_ration'] as const;

test('liquidator issue card is a legal single-use document for a field kit', () => {
  const def = ITEMS[CARD_ID];
  assert.equal(def.name, 'Карточка выдачи ликвидатора');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'permit', 'official', 'liquidator', 'issue', 'field_kit', 'single_use', 'access']) {
    assert.ok(ITEM_TAGS[CARD_ID]?.includes(tag), `liquidator_issue_card registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `liquidator_issue_card item must carry ${tag}`);
  }

  const player = makeTestPlayer();
  assert.equal(addItem(player, CARD_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');
});

test('liquidator issue card is reachable in the Ministry archive and redeems one field kit at the issue stash', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const source = world.containers.find(container => container.inventory.some(item => item.defId === CARD_ID));
  assert.ok(source, 'liquidator archive should expose a liquidator_issue_card source');
  assert.equal(source.faction, Faction.LIQUIDATOR);
  assert.ok(source.tags.includes('liquidator_archive'));

  const stash = world.containers.find(container =>
    container.tags.includes('liquidator_archive') && container.tags.includes('issue_stash')
  );
  assert.ok(stash, 'liquidator archive should expose a field issue stash');

  const player = makeTestPlayer({
    id: 9001,
    x: stash.x + 0.5,
    y: stash.y + 0.5,
  });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 44 });
  assert.equal(addItem(player, CARD_ID, 1), true);

  useItem(player, 0, state.msgs, state.time, state, stash.zoneId, world);

  assert.equal(countInventoryItem(player, CARD_ID), 0);
  for (const itemId of FIELD_KIT) assert.equal(countInventoryItem(player, itemId), 1, `${itemId} should be issued`);
  assert.ok(stash.tags.includes('issue_card_stamped'));
  assert.ok(stash.tags.includes('field_kit_issued'));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['issue_card', 'field_kit'], limit: 1 })[0];
  assert.equal(event?.itemId, CARD_ID);
  assert.equal((event?.data as { outcome?: string } | undefined)?.outcome, 'liquidator_field_kit_issued');
});

test('liquidator issue card is not consumed away from the Ministry issue stash', () => {
  const world = new World();
  const player = makeTestPlayer({ x: 10.5, y: 10.5 });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 50 });
  assert.equal(addItem(player, CARD_ID, 1), true);

  useItem(player, 0, state.msgs, state.time, state, undefined, world);

  assert.equal(countInventoryItem(player, CARD_ID), 1);
  assert.equal(getRecentEvents(state, { type: 'player_use_item', tags: ['issue_card'], limit: 1 }).length, 0);
  assert.ok(state.msgs.some(line => line.text.includes('шкафу боевой описи Л-47')));
});
