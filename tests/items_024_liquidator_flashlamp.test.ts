import test from 'node:test';
import assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import {
  activeToolLightDrainPerSecond,
  activeToolLightMoveMultiplier,
  activeToolLightRenderIntensity,
  droppedToolLightScore,
  equippedToolLightScore,
  passiveToolLightDrainPerSecond,
  passiveToolLightMoveMultiplier,
  passiveToolLightRenderIntensity,
  toolLightDef,
} from '../src/data/tool_lights';
import { addItem, getEquippedToolDurability } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

test('liquidator flashlamp is a reachable heavy light tool', () => {
  const item = ITEMS.liquidator_flashlamp;
  assert.equal(item.type, ItemType.TOOL);
  assert.equal(item.name, 'Переносной прожектор');
  assert.ok(item.spawnRooms.includes(RoomType.HQ));
  assert.ok(item.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(item.spawnW > 0);
  assert.ok(item.value > ITEMS.flashlight.value);
  assert.ok(ITEM_TAGS.liquidator_flashlamp?.includes('liquidator'));
  assert.ok(ITEM_TAGS.liquidator_flashlamp?.includes('heavy_tool'));
});

test('liquidator flashlamp maps to tool and electronics scarcity', () => {
  assert.equal(resourceForItem('liquidator_flashlamp')?.id, 'tools');
  const electronics = RESOURCES.find(resource => resource.id === 'electronics');
  assert.ok(electronics?.itemIds.includes('liquidator_flashlamp'));
});

test('liquidator flashlamp keeps heavy light metadata without passive activation', () => {
  const player = makeTestPlayer();
  assert.equal(addItem(player, 'liquidator_flashlamp', 1), true);
  player.tool = 'liquidator_flashlamp';

  const durability = getEquippedToolDurability(player);
  const flashlamp = toolLightDef('liquidator_flashlamp');
  const flashlight = toolLightDef('flashlight');
  assert.deepEqual(durability, { cur: ITEMS.liquidator_flashlamp.durability, max: ITEMS.liquidator_flashlamp.durability });
  assert.equal(flashlamp?.passive, false);
  assert.ok((flashlamp?.renderIntensity ?? 0) > (flashlight?.renderIntensity ?? 0));
  assert.ok((flashlamp?.moveMultiplier ?? 1) < (flashlight?.moveMultiplier ?? 1));
  assert.equal(passiveToolLightDrainPerSecond('liquidator_flashlamp'), 0);
  assert.equal(passiveToolLightRenderIntensity('liquidator_flashlamp', durability), 0);
  assert.equal(passiveToolLightMoveMultiplier('liquidator_flashlamp'), 1);
  assert.equal(equippedToolLightScore('liquidator_flashlamp'), 0);
  assert.equal(equippedToolLightScore('flashlight'), 0);
  assert.ok(activeToolLightDrainPerSecond('liquidator_flashlamp') > activeToolLightDrainPerSecond('flashlight'));
  assert.ok(activeToolLightMoveMultiplier('liquidator_flashlamp') < activeToolLightMoveMultiplier('flashlight'));
  assert.ok(activeToolLightRenderIntensity('liquidator_flashlamp', durability) > 1);
  assert.ok(droppedToolLightScore('liquidator_flashlamp') > droppedToolLightScore('flashlight'));
});
