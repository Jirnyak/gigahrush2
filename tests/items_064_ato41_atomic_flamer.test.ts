import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, ItemType, ProjType, type Entity } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { PHYS_WEAPON_ROLE_TIERS, PHYS_WEAPON_STATS } from '../src/data/weapons';
import { generateDarknessDesignFloor } from '../src/gen/design_floors/darkness';
import { addItem, consumeAmmo, countAmmo, getWeaponReadiness } from '../src/systems/inventory';

function makePlayer(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    inventory: [],
    weapon: 'ato41_atomic_flamer',
    faction: Faction.PLAYER,
    name: 'Вы',
  };
}

test('ATO-41 is a capped endgame deletion flamer with self ammo', () => {
  const item = ITEMS.ato41_atomic_flamer;
  assert.equal(item.type, ItemType.WEAPON);
  assert.equal(item.spawnW, 0);
  assert.deepEqual(item.spawnRooms, []);
  assert.equal(getStack(item), 2);
  assert.equal(resourceForItem('ato41_atomic_flamer')?.id, 'fuel');
  assert.ok(ITEM_TAGS.ato41_atomic_flamer.includes('door_cutter'));
  assert.ok(ITEM_TAGS.ato41_atomic_flamer.includes('slime_counterplay'));
  assert.ok(ITEM_TAGS.ato41_atomic_flamer.includes('collateral'));

  const stats = PHYS_WEAPON_STATS.ato41_atomic_flamer;
  assert.equal(stats.ammoType, 'ato41_atomic_flamer');
  assert.equal(stats.deletionBeam, true);
  assert.equal(stats.projType, ProjType.FLAME);
  assert.equal(PHYS_WEAPON_ROLE_TIERS.ato41_atomic_flamer, 'fuel_clear');
  assert.ok((stats.beamRange ?? 0) < (PHYS_WEAPON_STATS.gravity_beam_emitter.beamRange ?? 0));
  assert.ok((stats.beamWidth ?? 0) < (PHYS_WEAPON_STATS.gravity_beam_emitter.beamWidth ?? 0));
});

test('ATO-41 spends its two sealed sections through generic ammo use', () => {
  const player = makePlayer();
  assert.equal(addItem(player, 'ato41_atomic_flamer', 2), true);
  assert.equal(countAmmo(player), 2);
  assert.equal(getWeaponReadiness(player).resourceLabel, 'АТО-41 2');

  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 1);
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 0);
  assert.equal(player.inventory?.some(slot => slot.defId === 'ato41_atomic_flamer'), false);
});

test('ATO-41 is reachable once through the Darkness route floor', () => {
  const floor = generateDarknessDesignFloor();
  const carriers = floor.world.containers
    .filter(container => container.inventory.some(item => item.defId === 'ato41_atomic_flamer'));

  assert.equal(carriers.length, 1);
  assert.equal(carriers[0].name, 'Атомный футляр АТО-41');
  assert.deepEqual(
    carriers[0].inventory.filter(item => item.defId === 'ato41_atomic_flamer').map(item => item.count),
    [2],
  );
  assert.ok(carriers[0].tags.includes('darkness'));
  assert.ok(carriers[0].tags.includes('collateral'));
});
