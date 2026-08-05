import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, ProjType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { Spr } from '../src/render/sprite_index';

test('pistol grenade launcher is a rare militia single-shot explosive weapon', () => {
  const def = ITEMS.pistol_grenade_launcher;
  const stats = WEAPON_STATS.pistol_grenade_launcher;

  assert.equal(def.name, 'Пистолет-гранатомёт');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.SMOKING, RoomType.HQ]);
  assert.ok(def.spawnW > 0);
  assert.ok(def.spawnW < ITEMS.grenade.spawnW);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(WEAPON_ROLE_TIERS.pistol_grenade_launcher, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'grenade');
  assert.equal(ITEMS.grenade.type, ItemType.WEAPON);
  assert.equal(stats.projSprite, Spr.GRENADE);
  assert.equal(stats.projType, ProjType.GRENADE);
  assert.equal(stats.pellets, 1);
  assert.ok(stats.dmg < WEAPON_STATS.grenade.dmg, 'launcher should not outdamage a hand grenade');
  assert.ok((stats.aoeRadius ?? 0) < (WEAPON_STATS.grenade.aoeRadius ?? 0), 'launcher blast should be smaller than a hand grenade');
  assert.ok((stats.projSpeed ?? 0) > (WEAPON_STATS.grenade.projSpeed ?? 0), 'launcher should trade blast for reach');
  assert.ok((stats.spread ?? 0) > (WEAPON_STATS.grenade.spread ?? 0), 'launcher should keep militia instability');
  assert.ok(stats.speed > WEAPON_STATS.grenade.speed, 'launcher should be slower than throwing one grenade');

  for (const tag of ['militia', 'grenade', 'contraband', 'single_shot', 'self_risk', 'rare_stash']) {
    assert.ok(def.tags?.includes(tag), `pistol_grenade_launcher item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.pistol_grenade_launcher?.includes(tag), `pistol_grenade_launcher tag registry must publish ${tag}`);
  }
});

test('pistol grenade launcher is reachable through a secret militia stash with one grenade', () => {
  const stash = CONTAINER_DEFS[ContainerKind.SECRET_STASH];
  const launcher = stash.itemPool.find(item => item.defId === 'pistol_grenade_launcher');
  const grenade = stash.itemPool.find(item => item.defId === 'grenade');

  assert.equal(stash.defaultAccess, 'secret');
  assert.ok(stash.roomTypes.includes(RoomType.SMOKING));
  assert.ok(launcher, 'secret militia stash should expose pistol_grenade_launcher');
  assert.equal(launcher.min, 1);
  assert.equal(launcher.max, 1);
  assert.ok((launcher.chance ?? 0) > 0);
  assert.ok((launcher.chance ?? 1) <= 0.03);
  assert.ok(grenade, 'secret militia stash should expose a single grenade for the launcher path');
  assert.equal(grenade.min, 1);
  assert.equal(grenade.max, 1);
});
