import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, EntityType, MonsterKind } from '../src/core/types';
import { World } from '../src/core/world';
import { generateNasosnayaMatka, NASOSNAYA_MATKA_ID } from '../src/gen/maintenance/nasosnaya_matka';
import type { Entity } from '../src/core/types';

test('Nasosnaya Matka room keeps dry perimeter, local water lanes, and capped adds', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  generateNasosnayaMatka({ world, entities, nextId, spawnX: 512, spawnY: 512 });

  const room = world.rooms.find(r => r.name.startsWith('Насосная Матка'));
  assert.ok(room, 'boss room is generated');

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    assert.notEqual(world.cells[world.idx(x, room.y + 1)], Cell.WATER, 'top perimeter stays dry');
    assert.notEqual(world.cells[world.idx(x, room.y + room.h - 2)], Cell.WATER, 'bottom perimeter stays dry');
  }
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    assert.notEqual(world.cells[world.idx(room.x + 1, y)], Cell.WATER, 'left perimeter stays dry');
    assert.notEqual(world.cells[world.idx(room.x + room.w - 2, y)], Cell.WATER, 'right perimeter stays dry');
  }

  let waterCells = 0;
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      if (world.cells[world.idx(x, y)] === Cell.WATER) waterCells++;
    }
  }
  assert.ok(waterCells >= 120, 'room has multiple local water lanes');

  const valves = world.containers.filter(c => c.tags.includes(NASOSNAYA_MATKA_ID) && c.tags.includes('valve'));
  assert.equal(valves.length, 3, 'three valve controls are interactable containers');
  assert.ok(valves.every(c => c.inventory.some(item => item.defId === 'valve_tag')), 'each valve exposes a valve tag');

  const core = entities.find(e => e.type === EntityType.MONSTER && e.name === 'Насосная Матка');
  assert.ok(core, 'named boss core is spawned');
  assert.equal(core.monsterKind, MonsterKind.MATKA);
  assert.equal(core.matkaTimer, Number.POSITIVE_INFINITY, 'generic Matka reproduction is disabled for this core');

  const adds = entities.filter(e => e.type === EntityType.MONSTER && e.name !== 'Насосная Матка');
  assert.equal(adds.length, 5, 'active adds are capped at five');
  assert.equal(adds.filter(e => e.monsterKind === MonsterKind.TUBE_EEL).length, 4, 'adds are water-biased');
  assert.ok(adds.some(e => e.monsterKind === MonsterKind.POLZUN), 'one dry-edge pressure add exists');

  const reward = world.containers.find(c => c.tags.includes(NASOSNAYA_MATKA_ID) && c.tags.includes('reward'));
  assert.ok(reward, 'reward locker exists in the boss room');
  assert.ok(reward.inventory.some(item => item.defId === 'manometer'), 'reward includes manometer trace');
  assert.ok(reward.inventory.some(item => item.defId === 'pipe'), 'reward includes pipe trace');
});
