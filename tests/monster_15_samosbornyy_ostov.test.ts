import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { SIDE_QUESTS } from '../src/data/plot';
import {
  SAMOSBORNYY_OSTOV_ID,
  SAMOSBORNYY_OSTOV_LIQUIDATOR_ID,
  SAMOSBORNYY_OSTOV_ROOM_PREFIX,
  generateSamosbornyyOstov,
} from '../src/gen/living/samosbornyy_ostov';

test('Самосборный Остов scene has warning, safe options, and a bounded local ambush', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  const result = generateSamosbornyyOstov(world, 0, entities, nextId, 160, 160);
  assert.equal(result.nextRoomId, 1);

  const room = world.rooms[0];
  assert.ok(room.name.includes(SAMOSBORNYY_OSTOV_ROOM_PREFIX));
  assert.equal(room.sealed, true);

  const hermeticDoor = room.doors
    .map(idx => world.doors.get(idx))
    .find(door => door?.state === DoorState.HERMETIC_CLOSED);
  assert.ok(hermeticDoor, 'corpse bay should start behind a hermetic door');

  const containers = world.containers.filter(c => c.tags.includes(SAMOSBORNYY_OSTOV_ID));
  assert.equal(containers.length, 3);
  assert.ok(containers.some(c => c.tags.includes('disturbed') && c.tags.includes('loot_risk')));
  assert.ok(containers.some(c => c.tags.includes('safely_looted')));
  assert.ok(containers.some(c => c.tags.includes('burned') && c.tags.includes('sabotage_drop')));

  const ostov = entities.find(e =>
    e.type === EntityType.MONSTER
    && e.monsterKind === MonsterKind.ZOMBIE
    && e.name === 'Самосборный Остов'
    && world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))] === room.id
  );
  assert.ok(ostov, 'local zombie ambush should be inside only this scene');

  const warningNote = entities.find(e =>
    e.type === EntityType.ITEM_DROP
    && e.inventory?.some(item => item.defId === 'note' && String(item.data ?? '').includes('Лут слишком чистый'))
  );
  assert.ok(warningNote, 'warning note should be reachable before risky looting');

  const liquidator = entities.find(e => e.plotNpcId === SAMOSBORNYY_OSTOV_LIQUIDATOR_ID);
  assert.ok(liquidator, 'liquidator report/burn path NPC should be present');

  const questIds = new Set(SIDE_QUESTS
    .filter(q => q.giverNpcId === SAMOSBORNYY_OSTOV_LIQUIDATOR_ID)
    .map(q => q.id));
  assert.equal(questIds.has('samosbornyy_ostov_report'), true);
  assert.equal(questIds.has('samosbornyy_ostov_burn'), true);

  const doorCell = world.cells[hermeticDoor.idx];
  assert.equal(doorCell, Cell.DOOR);
});
