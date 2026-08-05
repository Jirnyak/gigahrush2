import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { inventoryItemCategory, useItem } from '../src/systems/inventory';
import { generateItemSprite } from '../src/render/item_sprites';
import { cloneItems, countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

function countSpritePixels(sprite: Uint32Array, predicate: (r: number, g: number, b: number, a: number) => boolean): number {
  let count = 0;
  for (const px of sprite) {
    const a = px >>> 24;
    if (a === 0) continue;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (predicate(r, g, b, a)) count++;
  }
  return count;
}

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (const px of sprite) {
    h ^= px;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

test('ammo rifle coupon is an HQ/office document mapped to ammo scarcity', () => {
  const def = ITEMS.ammo_rifle_coupon;

  assert.equal(def.id, 'ammo_rifle_coupon');
  assert.equal(def.name, 'Талон на винтовочные патроны');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.spawnW > 0, true);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'ammo');

  const byId = Object.fromEntries(RESOURCES.map(resource => [resource.id, resource]));
  assert.ok(byId.ammo.itemIds.includes(def.id), 'rifle coupon must pressure ammo supply');
  assert.ok(byId.paper.itemIds.includes(def.id), 'rifle coupon must pressure paper supply');
  assert.ok(byId.documents.itemIds.includes(def.id), 'rifle coupon must pressure document supply');

  for (const tag of ['document', 'coupon', 'weapon_permit', 'rifle', 'ammo_762', 'single_use', 'liquidator']) {
    assert.ok(ITEM_TAGS.ammo_rifle_coupon?.includes(tag), `ammo_rifle_coupon must publish ${tag}`);
  }
});

test('using ammo rifle coupon spends the paper for a small 7.62 issue', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    time: 30,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({
    id: 1,
    inventory: cloneItems([{ defId: 'ammo_rifle_coupon', count: 1 }]),
  });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'ammo_rifle_coupon'), 0);
  assert.equal(countInventoryItem(player, 'ammo_762'), 6);
  assert.equal(state.msgs.some(line => line.text.includes('выдали шесть 7.62')), true);

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['coupon', 'ammo_762'], limit: 1 })[0];
  assert.ok(event, 'coupon spend should publish a bounded inventory event');
  assert.equal(event.itemId, 'ammo_rifle_coupon');
});

test('ammo rifle coupon sprite reads as a rifle cartridge issue paper', () => {
  const sprite = generateItemSprite('ammo_rifle_coupon');
  const paper = countSpritePixels(sprite, (r, g, b, a) => a > 150 && r > 135 && g > 120 && b > 75 && b < 170);
  const brass = countSpritePixels(sprite, (r, g, b, a) => a > 170 && r > 145 && g > 95 && g < 205 && b < 95);
  const darkCases = countSpritePixels(sprite, (r, g, b, a) => a > 170 && r < 80 && g < 70 && b < 58);
  const issueMarks = countSpritePixels(sprite, (r, g, b, a) => a > 170 && ((r > 150 && g < 90 && b < 80) || (g > 115 && r < 110 && b < 115)));

  assert.ok(paper > 320, 'rifle coupon should keep a visible paper coupon body');
  assert.ok(brass > 90, 'rifle coupon should show brass rifle cartridge mass');
  assert.ok(darkCases > 50, 'rifle coupon should show dark cartridge cases or ink');
  assert.ok(issueMarks > 35, 'rifle coupon should show colored issue/stamp marks');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_762')), 'rifle coupon should not reuse loose 7.62 ammo');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_coupon_9mm')), 'rifle coupon should differ from the 9mm coupon');
  assert.notEqual(spriteHash(sprite), spriteHash(generateItemSprite('ammo_coupon_shells')), 'rifle coupon should differ from the shells coupon');
});
