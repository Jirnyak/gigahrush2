import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, ItemType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { SIDE_QUESTS } from '../src/data/plot';
import { resourceForItem } from '../src/data/resources';
import { generateWeaponPermitBureau } from '../src/gen/ministry/weapon_permit_bureau';

test('karkarov pistol is a legal liquidator sidearm sidegrade', () => {
  const def = ITEMS.karkarov_pistol;
  const stats = WEAPON_STATS.karkarov_pistol;

  assert.equal(def.type, ItemType.WEAPON);
  assert.ok(def.tags?.includes('liquidator'));
  assert.ok(def.tags?.includes('weapon_permit'));
  assert.ok(def.tags?.includes('legal'));
  assert.equal(def.value < ITEMS.makarov.value, true);

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'ammo_9mm');
  assert.equal(resourceForItem(stats.ammoType)?.id, 'ammo');
  assert.equal(stats.dmg < WEAPON_STATS.makarov.dmg, true);
  assert.equal((stats.spread ?? 0) > (WEAPON_STATS.makarov.spread ?? 0), true);
  assert.equal(WEAPON_ROLE_TIERS.karkarov_pistol, 'pistol_sidegrade');
});

test('karkarov pistol is reachable through the Ministry weapon permit bureau', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateWeaponPermitBureau(world, 0, entities, { v: 1 }, 512, 512);

  const sidearmQuest = SIDE_QUESTS.find(q => q.id === 'weapon_permit_sidearm_issue');
  assert.equal(sidearmQuest?.rewardItem, 'karkarov_pistol');
  assert.equal(sidearmQuest?.requiresSideQuestDone, 'weapon_permit_legal_forms');

  const stepan = entities.find(e => e.plotNpcId === 'stepan_patronov');
  assert.equal(stepan?.weapon, 'karkarov_pistol');
  assert.ok(stepan?.inventory?.some(item => item.defId === 'karkarov_pistol'));

  const locker = world.containers.find(container =>
    container.tags.includes('weapon_permit')
    && container.inventory.some(item => item.defId === 'karkarov_pistol'),
  );
  assert.ok(locker, 'weapon permit bureau locker should expose karkarov_pistol');
  assert.equal(locker.access, 'owner');
  assert.equal(locker.faction, Faction.LIQUIDATOR);
});
