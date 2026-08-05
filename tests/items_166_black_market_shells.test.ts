import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  BLACK_MARKET_88_STOCK,
  applyBlackMarket88Purchase,
  createBlackMarket88DesignState,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('black market shells are explicit contraband shotgun ammo with ammo resource pressure', () => {
  const def = ITEMS.black_market_shells;

  assert.equal(def.id, 'black_market_shells');
  assert.equal(def.name, 'Чёрнорыночная дробь');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 12);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');

  for (const tag of ['ammo', 'shells', 'shotgun', 'black_market', 'contraband', 'audit']) {
    assert.ok(def.tags?.includes(tag), `black_market_shells item must carry ${tag}`);
    assert.ok(ITEM_TAGS.black_market_shells?.includes(tag), `black_market_shells tags must publish ${tag}`);
  }
});

test('black market shells are reachable through Black Market 88 and illegal ammo production', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === 'black_market_shells');
  assert.ok(offer, 'Black Market 88 should sell black-market shells');
  assert.equal(offer.lane, 'weapons');
  assert.ok(offer.heatDelta > 0, 'buying illegal shells should increase market heat');

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, offer.id, 1.25, 166);
  assert.ok(quote);
  assert.equal(quote.itemId, 'black_market_shells');
  assert.ok(quote.buyPrice > ITEMS.black_market_shells.value);

  const bought = applyBlackMarket88Purchase(state, offer.id, 166);
  assert.equal(bought.ok, true);
  assert.equal(state.stock[offer.id], offer.count - 1);

  assert.ok(
    CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.some(entry => entry.defId === 'black_market_shells'),
    'secret stashes should occasionally expose black-market shells',
  );

  const recipe = FACTORIES.find(factory => factory.id === 'illegal_ammo_smelter')?.recipes.find(row => row.id === 'cast_black_market_shells');
  assert.ok(recipe, 'illegal ammo smelter should produce black-market shells');
  assert.deepEqual(recipe.outputs, [{ defId: 'black_market_shells', count: 2 }]);
  assert.equal(recipe.outputAccess, 'faction');
});

test('black market shells can be unpacked into ordinary shells before use in shotguns', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'black_market_shells', count: 1 }] });
  const state = makeGameState({ time: 166 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'black_market_shells'), 0);
  assert.equal(countInventoryItem(player, 'ammo_shells'), 4);
  assert.ok(state.msgs.some(line => line.text.includes('Чёрнорыночная дробь разобрана')));
});
