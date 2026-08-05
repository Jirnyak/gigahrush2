import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateBrownSlimeCleanup } from '../src/gen/maintenance/brown_slime_cleanup';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { getCellHazardMoveMultiplier, registerCellHazardSite } from '../src/systems/cell_hazards';
import { tryUseCarnivorousFungus } from '../src/systems/carnivorous_fungus';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, useItem } from '../src/systems/inventory';
import { addTestRoom, countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('decon fluid is a liquidator cleanup reagent with resource pressure', () => {
  const def = ITEMS.decon_fluid;

  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.HQ]);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['cleanup', 'decon', 'slime', 'fungus', 'liquidator', 'reagent']) {
    assert.ok(ITEM_TAGS.decon_fluid?.includes(tag), `decon_fluid must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `decon_fluid item def must carry ${tag} tag`);
  }
});

test('decon fluid is reachable from maintenance cleanup and liquidator stash paths', () => {
  const maintenanceWorld = new World();
  const maintenanceEntities: Entity[] = [];
  generateBrownSlimeCleanup({ world: maintenanceWorld, entities: maintenanceEntities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const maintenanceDropIds = maintenanceEntities
    .filter(e => e.type === EntityType.ITEM_DROP)
    .flatMap(e => e.inventory ?? [])
    .map(item => item.defId);
  assert.ok(maintenanceDropIds.includes('decon_fluid'), 'brown slime cleanup room should expose decon_fluid');

  const archiveWorld = new World();
  const archiveEntities: Entity[] = [];
  generateLiquidatorArchive(archiveWorld, 0, archiveEntities, { v: 1 }, 512, 512);

  const stash = archiveWorld.containers.find(container => container.inventory.some(item => item.defId === 'decon_fluid'));
  assert.ok(stash, 'liquidator archive should expose decon_fluid');
});

test('using decon fluid cleans nearby slime or fungus hazards and publishes cleanup facts', () => {
  const world = new World();
  addTestRoom(world, { id: 1, type: RoomType.PRODUCTION, x: 10, y: 10, w: 8, h: 8 });
  const cells = [world.idx(12, 12), world.idx(13, 12), world.idx(12, 13)];
  registerCellHazardSite(world, {
    id: 'test_decon_slime',
    kind: 'test_slime_residue',
    displayName: 'Тестовая слизь',
    cells,
    tags: ['slime', 'fungus', 'cleanup'],
    cleanable: true,
    slowMult: 0.5,
    roomId: 1,
    zoneId: 0,
    centerX: 12.5,
    centerY: 12.5,
    warning: 'Тестовый налёт ждёт раствор.',
  });

  const player = makeTestPlayer({ id: 77, x: 12.5, y: 12.5 });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 12 });
  assert.equal(addItem(player, 'decon_fluid', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter зачистить');
  assert.ok(getCellHazardMoveMultiplier(world, player) < 1, 'test hazard should slow before cleanup');

  useItem(player, 0, state.msgs, 12, state, 0, world);

  assert.equal(countInventoryItem(player, 'decon_fluid'), 0);
  assert.equal(getCellHazardMoveMultiplier(world, player), 1);
  assert.ok(state.msgs.some(line => line.text.includes('сняла налёт')));

  const cleanedEvent = getRecentEvents(state, { type: 'hazard_cleaned', tags: ['slime'], limit: 1 })[0];
  assert.equal(cleanedEvent?.data?.reason, 'solvent');
  assert.equal(cleanedEvent?.data?.cleanedCells, 3);

  const useEvent = getRecentEvents(state, { type: 'player_use_item', tags: ['decon', 'solvent'], limit: 1 })[0];
  assert.equal(useEvent?.itemId, 'decon_fluid');
  assert.equal(useEvent?.data?.cleanedHazardCells, 3);
});

test('decon fluid is not consumed when no cleanable hazard is nearby', () => {
  const world = new World();
  addTestRoom(world, { id: 1, type: RoomType.PRODUCTION, x: 10, y: 10, w: 8, h: 8 });
  const player = makeTestPlayer({ x: 12.5, y: 12.5, inventory: [{ defId: 'decon_fluid', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 16 });

  useItem(player, 0, state.msgs, 16, state, 0, world);

  assert.equal(countInventoryItem(player, 'decon_fluid'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Сохраните жидкость')));
});

test('decon fluid neutralizes carnivorous fungus as a reagent counterplay', () => {
  const world = new World();
  addTestRoom(world, {
    id: 2,
    type: RoomType.BATHROOM,
    x: 10,
    y: 10,
    w: 8,
    h: 8,
    name: 'Плотоядная грибница: тестовый погреб',
  });
  const player = makeTestPlayer({ id: 91, x: 12.5, y: 12.5, inventory: [{ defId: 'decon_fluid', count: 1 }] });
  const entities: Entity[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 20 });

  assert.equal(tryUseCarnivorousFungus(world, entities, { v: 1 }, player, state), true);

  assert.equal(countInventoryItem(player, 'decon_fluid'), 0);
  assert.equal(countInventoryItem(player, 'zhelemish_boiled'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Раствор снял грибницу')));

  const event = getRecentEvents(state, { type: 'hazard_cleaned', tags: ['decon'], limit: 1 })[0];
  assert.equal(event?.itemId, 'decon_fluid');
  assert.equal(event?.data?.consumed, 'decon_fluid');
});
