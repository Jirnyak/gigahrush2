import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  BLACK_MARKET_88_STOCK,
  applyBlackMarket88Purchase,
  createBlackMarket88DesignState,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { containerAccessInfo } from '../src/systems/containers';
import { makeTestPlayer } from './helpers';

test('rb91 auto shotgun is a veteran shell-burn shotgun', () => {
  const def = ITEMS.rb91_auto_shotgun;
  const stats = WEAPON_STATS.rb91_auto_shotgun;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'РБ-91');
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.SMOKING]);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(WEAPON_ROLE_TIERS.rb91_auto_shotgun, 'shotgun_corridor_stop');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_shells');
  assert.equal(resourceForItem(stats.ammoType ?? '')?.id, 'ammo');
  assert.equal(stats.pellets, 9);
  assert.ok(stats.speed < WEAPON_STATS.chizh3_shotgun.speed, 'РБ-91 should cycle faster than the pump shotgun');
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.chizh3_shotgun.spread ?? 0), 'РБ-91 should pay for speed with spread');
  assert.ok(stats.dmg * (stats.pellets ?? 1) < WEAPON_STATS.chizh3_shotgun.dmg * (WEAPON_STATS.chizh3_shotgun.pellets ?? 1));

  for (const tag of ['liquidator', 'shotgun', 'ammo_shells', 'black_market', 'contraband', 'veteran', 'ammo_burn']) {
    assert.ok(def.tags?.includes(tag), `rb91_auto_shotgun item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.rb91_auto_shotgun?.includes(tag), `rb91_auto_shotgun tag registry must publish ${tag}`);
  }
});

test('rb91 auto shotgun can be bought as black market heat', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === 'rb91_auto_shotgun');
  assert.ok(offer, 'black market 88 should expose a single РБ-91 offer');
  assert.equal(offer.count, 1);
  assert.equal(offer.lane, 'weapons');
  assert.equal(offer.traderId, 'market88_zhoka_knife');

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, offer.id, 1, 10);
  assert.equal(quote?.itemId, 'rb91_auto_shotgun');
  assert.ok((quote?.buyPrice ?? 0) > ITEMS.rb91_auto_shotgun.value);

  const heatBefore = state.heat;
  const result = applyBlackMarket88Purchase(state, offer.id, 10);
  assert.equal(result.ok, true);
  assert.equal(state.stock[offer.id], 0);
  assert.ok(state.heat > heatBefore);
});

test('rb91 auto shotgun is stealable from a liquidator archive stash with shells', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'rb91_auto_shotgun')
    && container.inventory.some(item => item.defId === 'ammo_shells' && item.count >= 12)
  );
  assert.ok(stash, 'liquidator archive should expose rb91_auto_shotgun with a shell reserve');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['liquidator', 'issue_stash', 'shotgun', 'theft']) {
    assert.ok(stash.tags.includes(tag), `rb91 stash must publish ${tag} tag`);
  }

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
