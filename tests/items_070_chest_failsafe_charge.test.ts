import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, ProjType, type Entity } from '../src/core/types';
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
import { consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';
import { countInventoryItem, makeTestPlayer } from './helpers';

test('chest failsafe charge is a rare self-consuming liquidator explosive', () => {
  const def = ITEMS.chest_failsafe_charge;
  const stats = WEAPON_STATS.chest_failsafe_charge;

  assert.equal(def.type, ItemType.WEAPON);
  assert.equal(def.name, 'Фугасный нагрудный заряд');
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(WEAPON_ROLE_TIERS.chest_failsafe_charge, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'chest_failsafe_charge');
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.pellets, 1);
  assert.ok((stats.aoeRadius ?? 0) > (WEAPON_STATS.breach_charge.aoeRadius ?? 0));
  assert.ok(stats.dmg > WEAPON_STATS.breach_charge.dmg);
  assert.ok(stats.speed > WEAPON_STATS.breach_charge.speed);

  for (const tag of ['liquidator', 'explosive', 'grenade', 'failsafe', 'single_use', 'contraband', 'panic_clear']) {
    assert.ok(def.tags?.includes(tag), `chest_failsafe_charge item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.chest_failsafe_charge?.includes(tag), `chest_failsafe_charge tag registry must publish ${tag}`);
  }
});

test('chest failsafe charge consumes itself as the last-resort shot', () => {
  const player = makeTestPlayer({
    inventory: [{ defId: 'chest_failsafe_charge', count: 1 }],
    weapon: 'chest_failsafe_charge',
  });

  const readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, 'фугас 1');
  assert.equal(readiness.damageLabel, '175');
  assert.equal(countAmmo(player), 1);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countInventoryItem(player, 'chest_failsafe_charge'), 0);
  assert.equal(countAmmo(player), 0);
});

test('chest failsafe charge can be bought as dangerous black market heat', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === 'chest_failsafe_charge');
  assert.ok(offer, 'black market 88 should expose a single chest failsafe charge');
  assert.equal(offer.count, 1);
  assert.equal(offer.lane, 'weapons');
  assert.equal(offer.traderId, 'market88_zhoka_knife');

  const state = createBlackMarket88DesignState();
  const quote = quoteBlackMarket88Purchase(state, offer.id, 1, 10);
  assert.equal(quote?.itemId, 'chest_failsafe_charge');
  assert.ok((quote?.buyPrice ?? 0) > ITEMS.chest_failsafe_charge.value);

  const heatBefore = state.heat;
  const result = applyBlackMarket88Purchase(state, offer.id, 10);
  assert.equal(result.ok, true);
  assert.equal(state.stock[offer.id], 0);
  assert.ok(state.heat > heatBefore);
});

test('chest failsafe charge is stealable from the Ministry liquidator archive', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container =>
    container.inventory.some(item => item.defId === 'chest_failsafe_charge')
  );
  assert.ok(stash, 'liquidator archive should expose chest_failsafe_charge');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  for (const tag of ['liquidator', 'explosive', 'failsafe', 'theft']) {
    assert.ok(stash.tags.includes(tag), `failsafe charge stash must publish ${tag} tag`);
  }

  const access = containerAccessInfo(stash, makeTestPlayer());
  assert.equal(access.mode, 'steal');
  assert.equal(access.theft, true);
});
