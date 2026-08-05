import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, EntityType, ItemType, QuestType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { METRO_DEPOT_ROOM_NAME } from '../src/data/metro';
import { SIDE_QUESTS } from '../src/data/plot';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateMetroErrorLine } from '../src/gen/maintenance/metro_error_line';

const ITEM_ID = 'rail_signal_lamp';

test('rail signal lamp is depot electronics repair stock', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Сигнальная лампа депо');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.25);
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'electronics');
  assert.equal(RESOURCES.find(resource => resource.id === 'tools')?.itemIds.includes(def.id), false);

  for (const tag of ['rail', 'electronics', 'lamp', 'signal', 'terminal', 'repair', 'depot', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `rail_signal_lamp registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `rail_signal_lamp item must carry ${tag}`);
  }

  assert.ok(
    CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool.some(item => item.defId === ITEM_ID),
    'tool lockers should expose spare depot signal lamps',
  );
});

test('rail signal lamp is reachable from the maintenance metro depot', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateMetroErrorLine({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const depot = world.rooms.find(room => room?.name === METRO_DEPOT_ROOM_NAME);
  assert.ok(depot, 'metro depot room should exist');

  const source = entities.find(entity =>
    entity.type === EntityType.ITEM_DROP
    && entity.inventory?.some(item => item.defId === ITEM_ID)
    && world.roomAt(entity.x, entity.y)?.id === depot.id
  );
  assert.ok(source, 'metro depot should expose a rail_signal_lamp drop');
});

test('Borya can spend the rail signal lamp after the switch repair', () => {
  const quest = SIDE_QUESTS.find(step => step.id === 'ag19_signal_lamp');

  assert.ok(quest, 'Borya signal-lamp side quest should be registered');
  assert.equal(quest.giverNpcId, 'ag19_borya_conductor');
  assert.equal(quest.type, QuestType.FETCH);
  assert.equal(quest.targetItem, ITEM_ID);
  assert.equal(quest.targetCount, 1);
  assert.equal(quest.rewardItem, 'fuse');
  assert.equal(quest.requiresSideQuestDone, 'ag19_switch_handle');
  assert.ok(quest.eventTags?.includes('repair'));
  assert.ok(quest.eventTags?.includes('transport'));
});
