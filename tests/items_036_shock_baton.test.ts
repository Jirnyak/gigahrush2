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

test('shock baton is an executable liquidator control weapon', () => {
  const def = ITEMS.shock_baton;
  const stats = WEAPON_STATS.shock_baton;

  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE, RoomType.SMOKING]);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(stats.isRanged, false);
  assert.equal(stats.dmg, 9);
  assert.equal(stats.durability, 80);
  assert.ok(stats.dmg < WEAPON_STATS.pipe.dmg, 'shock baton should not outdamage monster-facing melee');
  assert.ok((stats.knockback ?? 0) >= 0.45, 'shock baton should use generic melee control');
  assert.equal(WEAPON_ROLE_TIERS.shock_baton, 'melee_control');

  for (const tag of ['liquidator', 'ovb', 'control', 'contraband', 'electronics']) {
    assert.ok(def.tags?.includes(tag), `shock_baton item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.shock_baton?.includes(tag), `shock_baton tag registry must publish ${tag}`);
  }
});

test('shock baton can be bought through black market weapon pressure', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === 'shock_baton');
  assert.ok(offer, 'black market 88 should expose a shock baton offer');
  assert.equal(offer.lane, 'weapons');
  assert.equal(offer.traderId, 'market88_zhoka_knife');

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, offer.id, 1.2, 10);
  assert.equal(quote?.itemId, 'shock_baton');
  assert.ok((quote?.buyPrice ?? 0) > ITEMS.shock_baton.value);

  const heatBefore = state.heat;
  const result = applyBlackMarket88Purchase(state, offer.id, 10);
  assert.equal(result.ok, true);
  assert.equal(state.stock[offer.id], offer.count - 1);
  assert.ok(state.heat > heatBefore);
});

test('shock baton is stealable from a faction liquidator archive stash', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'shock_baton'));
  assert.ok(stash, 'liquidator archive should expose shock_baton');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['liquidator', 'control', 'ovb', 'theft']) {
    assert.ok(stash.tags.includes(tag), `shock baton stash must publish ${tag} tag`);
  }
});
