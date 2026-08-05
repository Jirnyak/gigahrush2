import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { resourceForItem } from '../src/data/resources';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { registerCellHazardSite } from '../src/systems/cell_hazards';
import { tryUseCarnivorousFungus } from '../src/systems/carnivorous_fungus';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, useItem } from '../src/systems/inventory';
import { addTestRoom, countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('incendiary 12g shells are rare ammo with cleanup tags and resource pressure', () => {
  const def = ITEMS.ammo_12g_incendiary;

  assert.equal(def.type, ItemType.AMMO);
  assert.equal(def.name, 'Зажигательная дробь');
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.stack, 12);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');

  for (const tag of ['ammo', 'shells', 'shotgun', 'incendiary', 'fire', 'cleanup', 'slime', 'fungus', 'liquidator', 'counterplay']) {
    assert.ok(def.tags?.includes(tag), `ammo_12g_incendiary item must carry ${tag}`);
    assert.ok(ITEM_TAGS.ammo_12g_incendiary?.includes(tag), `ammo_12g_incendiary tags must publish ${tag}`);
  }
});

test('incendiary 12g shells are reachable from liquidator crates, archive and armory production', () => {
  const weaponCrate = CONTAINER_DEFS[ContainerKind.WEAPON_CRATE].itemPool;
  assert.ok(weaponCrate.some(entry => entry.defId === 'ammo_12g_incendiary'), 'weapon crates should rarely expose incendiary shells');

  const world = new World();
  const entities: Entity[] = [];
  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);
  assert.ok(
    world.containers.some(container => container.inventory.some(item => item.defId === 'ammo_12g_incendiary' && item.count >= 2)),
    'liquidator archive issue stash should expose incendiary shells',
  );

  const recipe = FACTORIES.find(factory => factory.id === 'armory_bench')?.recipes.find(row => row.id === 'load_incendiary_12g');
  assert.ok(recipe, 'armory bench should craft incendiary 12g shells');
  assert.equal(recipe.outputAccess, 'faction');
  assert.deepEqual(recipe.outputs, [{ defId: 'ammo_12g_incendiary', count: 2 }]);
  assert.ok(recipe.inputs.some(input => input.id === 'fuel'), 'recipe must spend fuel pressure');
  assert.ok(recipe.inputItems?.some(input => input.defId === 'ammo_shells' && input.count === 2), 'recipe must spend ordinary shells');
});

test('incendiary 12g shells burn nearby cleanable slime or fungus hazards', () => {
  const world = new World();
  addTestRoom(world, { id: 1, type: RoomType.PRODUCTION, x: 10, y: 10, w: 8, h: 8 });
  const cells = [world.idx(12, 12), world.idx(13, 12), world.idx(12, 13)];
  registerCellHazardSite(world, {
    id: 'test_incendiary_slime',
    kind: 'test_slime_residue',
    displayName: 'Тестовый налёт',
    cells,
    tags: ['slime', 'fungus', 'cleanup'],
    cleanable: true,
    slowMult: 0.5,
    roomId: 1,
    zoneId: 0,
    centerX: 12.5,
    centerY: 12.5,
    warning: 'Тестовый налёт ждёт огня.',
  });

  const player = makeTestPlayer({ id: 74, x: 12.5, y: 12.5, inventory: [{ defId: 'ammo_12g_incendiary', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 74 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter выжечь');
  useItem(player, 0, state.msgs, state.time, state, 0, world);

  assert.equal(countInventoryItem(player, 'ammo_12g_incendiary'), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Зажигательная дробь выжгла')));

  const cleanedEvent = getRecentEvents(state, { type: 'hazard_cleaned', tags: ['slime'], limit: 1 })[0];
  assert.equal(cleanedEvent?.data?.reason, 'fire');
  assert.equal(cleanedEvent?.data?.cleanedCells, 3);

  const useEvent = getRecentEvents(state, { type: 'player_use_item', tags: ['fire', 'cleanup'], limit: 1 })[0];
  assert.equal(useEvent?.itemId, 'ammo_12g_incendiary');
  assert.equal(useEvent?.data?.cleanedHazardCells, 3);
});

test('incendiary 12g shells burn carnivorous fungus without generic ammo selection', () => {
  const world = new World();
  const room = addTestRoom(world, {
    id: 2,
    type: RoomType.BATHROOM,
    x: 10,
    y: 10,
    w: 8,
    h: 8,
    name: 'Плотоядная грибница: тестовый погреб',
  });
  const entities: Entity[] = [];
  const player = makeTestPlayer({ id: 91, x: 12.5, y: 12.5, inventory: [{ defId: 'ammo_12g_incendiary', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 20 });

  assert.equal(tryUseCarnivorousFungus(world, entities, { v: 1 }, player, state, player.x, player.y), true);

  assert.equal(countInventoryItem(player, 'ammo_12g_incendiary'), 0);
  assert.ok(room.name.includes('[зола 0]'));
  assert.ok(entities.some(e => e.inventory?.some(item => item.defId === 'zhelemish_dried')));
  assert.ok(state.msgs.some(line => line.text.includes('Грибница вспыхнула')));

  const event = getRecentEvents(state, { type: 'hazard_cleaned', tags: ['fire'], limit: 1 })[0];
  assert.equal(event?.itemId, 'ammo_12g_incendiary');
  assert.equal(event?.data?.consumed, 'ammo_12g_incendiary');
});
