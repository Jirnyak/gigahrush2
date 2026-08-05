import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Feature, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { SIDE_QUESTS } from '../src/data/plot';
import {
  CHERNOBOZHIY_SVOD_TAG,
  generateChernobozhiySvod,
} from '../src/gen/kvartiry/chernobozhiy_svod';

test('chernobozhiy svod generates a bounded marked room with noncombat outcomes', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  const nextRoomId = generateChernobozhiySvod(world, 0, entities, nextId, 512, 512);

  assert.equal(nextRoomId, 1);
  const room = world.rooms[0];
  assert.ok(room.name.includes('Чернобожий Свод'));
  assert.ok(room.w <= 17 && room.h <= 11);
  assert.ok(world.surfaceMap.size > 0, 'black-hand marks should stamp visible surface residue');

  const roomFeatureIds = new Set<number>();
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      roomFeatureIds.add(world.features[world.idx(room.x + dx, room.y + dy)]);
    }
  }
  assert.equal(roomFeatureIds.has(Feature.SCREEN), true, 'false-shelter warning screen should be visible');
  assert.equal(roomFeatureIds.has(Feature.APPARATUS), true, 'anchor marker should be visible');

  assert.equal(
    world.containers.some(c => c.roomId === room.id && c.tags.includes(CHERNOBOZHIY_SVOD_TAG) && c.tags.includes('false_safe_block')),
    true,
    'Svod containers should feed false-safe/cult event tags',
  );
  assert.equal(
    world.containers.some(c => c.inventory.some(item => item.defId === 'chernobog_confiscation_act')),
    true,
    'room should include expose/report evidence',
  );

  assert.equal(entities.some(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.IDOL), true);
  assert.equal(entities.some(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.SHADOW), true);

  const questIds = new Set(SIDE_QUESTS.map(q => q.id));
  for (const id of [
    'svod_expose_black_hand_marker',
    'svod_seal_false_shelter',
    'svod_ruin_cult_supply',
    'svod_destroy_room_anchor',
  ]) {
    assert.equal(questIds.has(id), true, `missing side quest ${id}`);
  }
});
