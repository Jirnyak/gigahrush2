import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType } from '../src/core/types';
import { WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  BLACK_MARKET_88_STOCK,
  applyBlackMarket88Purchase,
  createBlackMarket88DesignState,
  generateBlackMarket88DesignFloor,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

const PUSHKIN_MARKET_OFFER_ID = 'market88.purchase.pushkin_shell_platform';

test('pushkin shotgun is a rare tactical shell platform on existing shell mechanics', () => {
  const def = ITEMS.pushkin_shotgun;
  const stats = WEAPON_STATS.pushkin_shotgun;

  assert.equal(def.name, 'Ружьё «Пушкин»');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.SMOKING]);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.pushkin_shotgun, 'shotgun_corridor_stop');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_shells');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');
  assert.equal(stats.dmg, 14);
  assert.equal(stats.pellets, 6);
  assert.ok((stats.spread ?? 1) < (WEAPON_STATS.rb91_auto_shotgun.spread ?? 0), 'Pushkin should be tighter than RB-91');
  assert.ok(stats.speed > WEAPON_STATS.rb91_auto_shotgun.speed, 'Pushkin should fire slower than auto shotgun');
  assert.ok(stats.speed < WEAPON_STATS.chizh3_shotgun.speed, 'Pushkin should cycle faster than Chizh-3');
  assert.ok(stats.dmg * (stats.pellets ?? 1) < WEAPON_STATS.chizh3_shotgun.dmg * (WEAPON_STATS.chizh3_shotgun.pellets ?? 1));

  for (const tag of ['liquidator', 'shotgun', 'ammo_shells', 'tactical', 'black_market', 'shell_platform']) {
    assert.ok(ITEM_TAGS.pushkin_shotgun?.includes(tag), `pushkin_shotgun registry must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `pushkin_shotgun item must carry ${tag} tag`);
  }
});

test('pushkin shotgun is reachable as a Black Market 88 buy-or-steal decision', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.id === PUSHKIN_MARKET_OFFER_ID);
  assert.equal(offer?.itemId, 'pushkin_shotgun');
  assert.equal(offer?.lane, 'weapons');
  assert.equal(offer?.count, 1);

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, PUSHKIN_MARKET_OFFER_ID, 1, 20);
  assert.equal(quote?.itemId, 'pushkin_shotgun');
  assert.equal(quote?.stock, 1);
  assert.equal(quote?.locked, false);

  const result = applyBlackMarket88Purchase(state, PUSHKIN_MARKET_OFFER_ID, 20);
  assert.equal(result.ok, true);
  assert.equal(state.stock[PUSHKIN_MARKET_OFFER_ID], 0);
  assert.ok(state.heat >= (offer?.heatDelta ?? 0));

  const generated = generateBlackMarket88DesignFloor();
  const stash = generated.world.containers.find(container =>
    container.inventory.some(item => item.defId === 'pushkin_shotgun')
  );

  assert.ok(stash, 'Black Market 88 weapon crate should expose pushkin_shotgun');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('market88'));
  assert.ok(stash.tags.includes('weapons'));

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
