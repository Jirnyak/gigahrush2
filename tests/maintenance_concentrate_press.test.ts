import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ContainerKind,
  Faction,
  FloorLevel,
  RoomType,
  Tex,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { generateConcentratePress } from '../src/gen/maintenance/concentrate_press';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { ensureProductionRooms, tickProduction, type ProductionState } from '../src/systems/production';
import { addTestRoom, makeGameState, makeTestContainer } from './helpers';

test('Maintenance concentrate press places owned output and quarantine containers', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateConcentratePress({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const press = world.rooms.find(room => room.name === 'Брикетный цех: линия концентрата');
  assert.ok(press, 'missing concentrate press room');

  const output = world.containers.find(c => c.tags.includes('concentrate_press_output'));
  assert.ok(output, 'missing owned output container');
  assert.equal(output.roomId, press.id);
  assert.equal(output.access, 'owner');
  assert.equal(output.ownerName, 'Инна Прессова');
  assert.equal(output.factoryId, 'concentrate_press');
  assert.equal(output.tags.includes('production_output'), true);
  assert.equal(output.inventory.some(item => item.defId === 'grey_briquette'), true);

  const quarantine = world.containers.find(c => c.tags.includes('concentrate_press_quarantine'));
  assert.ok(quarantine, 'missing bad batch quarantine container');
  assert.equal(quarantine.access, 'owner');
  assert.equal(quarantine.faction, Faction.LIQUIDATOR);
  assert.equal(quarantine.tags.includes('bad_batch'), true);
  assert.equal(quarantine.inventory.some(item => item.defId === 'green_briquette'), true);
});

test('Concentrate press bad batch jams production until a gear repair is supplied', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    time: 1000,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  const room = addTestRoom(world, {
    id: 0,
    type: RoomType.PRODUCTION,
    x: 10,
    y: 10,
    w: 7,
    h: 7,
    name: 'Брикетный цех: линия концентрата',
    wallTex: Tex.PIPE,
  });
  world.addContainer(makeTestContainer({
    id: 1,
    x: 12,
    y: 12,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: 0,
    kind: ContainerKind.METAL_CABINET,
    name: 'Выходной шкаф линии концентрата',
    inventory: [{ defId: 'grey_briquette', count: 1 }],
    capacitySlots: 8,
    access: 'owner',
    ownerName: 'Инна Прессова',
    faction: Faction.CITIZEN,
    tags: ['concentrate_press', 'concentrate_press_output', 'production_output', 'food'],
  }));

  ensureProductionRooms(state, world);
  const production = (state as typeof state & { production: ProductionState[] }).production;
  assert.equal(production.length, 1);
  production[0].cycleCount = 2;
  production[0].nextTickAt = 0;

  assert.equal(tickProduction(state, world, true), 1);
  const output = world.containerById.get(1);
  assert.ok(output);
  assert.equal(output.inventory.find(item => item.defId === 'green_briquette')?.count, 2);
  assert.equal(output.inventory.find(item => item.defId === 'acid_bottle')?.count, 1);
  assert.equal(output.productionBlockedReason, 'no_inputs');
  assert.equal(production[0].jammed, true);
  assert.equal(getRecentEvents(state, { type: 'room_produced_items', tags: ['bad_batch'], limit: 1 }).length, 1);
  assert.equal(getRecentEvents(state, { type: 'room_blocked_production', tags: ['jammed'], limit: 1 }).length, 1);

  state.time += 61;
  assert.equal(tickProduction(state, world, true), 0);
  const jammed = getRecentEvents(state, { type: 'room_blocked_production', tags: ['jammed'], limit: 1 })[0];
  assert.deepEqual(jammed.data?.missingRepairItems, ['gear']);

  output.inventory.push({ defId: 'gear', count: 1 });
  state.time += 61;
  assert.equal(tickProduction(state, world, true), 1);
  assert.equal(output.inventory.some(item => item.defId === 'gear'), false);
  assert.equal(output.productionBlockedReason, undefined);
  assert.equal(production[0].jammed, false);
  assert.equal(getRecentEvents(state, { type: 'room_produced_items', tags: ['jam_repaired'], limit: 1 }).length, 1);
});
