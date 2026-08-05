import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ContainerKind,
  EntityType,
  Faction,
  FloorLevel,
  RoomType,
} from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { SIDE_QUESTS } from '../src/data/plot';
import { initFactionRelations } from '../src/data/relations';
import '../src/gen/ministry/stamp_room';
import { takeFromContainer } from '../src/systems/containers';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  addTestRoom,
  countInventoryItem,
  makeGameState,
  makeTestContainer,
  makeTestEntity,
  makeTestPlayer,
} from './helpers';

test('stamp room registers a witnessed forged stamp sheet route', () => {
  const quest = SIDE_QUESTS.find(q => q.id === 'stamp_room_witnessed_forgery');

  assert.ok(quest);
  assert.equal(quest.targetItem, 'seal_wax');
  assert.equal(quest.targetCount, 2);
  assert.equal(quest.rewardItem, 'forged_stamp_sheet');
  assert.equal(quest.eventPrivacy, 'witnessed');
  assert.ok(quest.eventTags?.includes('audit'));
  assert.deepEqual(quest.eventData?.usePaths, [
    'archive_forged_stamp_supply',
    'ministry_weapon_permit_forgery',
    'raionsovet_archive_forged_gate',
  ]);
  assert.ok(ITEM_TAGS.forged_stamp_sheet?.includes('audit'));
  assert.ok(ITEMS.forged_stamp_sheet.tags?.includes('forgery'));
});

test('stealing stamp room forged output publishes witness and audit risk', () => {
  initFactionRelations();
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    time: 345,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    id: 0,
    x: 10,
    y: 10,
    w: 8,
    h: 8,
    type: RoomType.STORAGE,
    name: 'Комната печатей',
    zoneId: 0,
  });
  const player = makeTestPlayer({ id: 0, x: 11.5, y: 11.5 });
  const witness = makeTestEntity({
    id: 77,
    type: EntityType.NPC,
    x: 12.5,
    y: 12.5,
    name: 'Понятая',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const ledger = makeTestContainer({
    id: 22,
    x: 12,
    y: 12,
    floor: FloorLevel.MINISTRY,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.FILING_CABINET,
    name: 'Журнал подштамповки Зои',
    access: 'owner',
    ownerNpcId: 55,
    ownerName: 'Зоя Сургучная',
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'forged_stamp_sheet', count: 1 }],
    capacitySlots: 4,
    tags: ['ministry', 'stamp_room', 'stamp_room_forgery', 'paper', 'forgery', 'audit', 'witness'],
  });
  world.addContainer(ledger);

  assert.equal(takeFromContainer(ledger, player, 0, 1, { state, world, entities: [player, witness] }), true);

  assert.equal(countInventoryItem(player, 'forged_stamp_sheet'), 1);
  assert.equal(ledger.lastAuditAt, 345);
  assert.deepEqual(ledger.stolenItemIds, ['forged_stamp_sheet']);

  const theft = getRecentEvents(state, { type: 'item_stolen', limit: 1 })[0];
  assert.equal(theft.privacy, 'witnessed');
  assert.equal(theft.severity, 5);
  assert.equal(theft.data?.witnessCount, 1);
  assert.deepEqual(theft.data?.witnessIds, [77]);
  assert.ok((theft.data?.containerTags as string[]).includes('stamp_room_forgery'));

  const audit = getRecentEvents(state, { type: 'faction_relation_changed', limit: 1 })[0];
  assert.equal(audit.itemId, 'forged_stamp_sheet');
  assert.equal(audit.data?.outcome, 'stolen_sheet');
  assert.equal(audit.data?.sourceEventId, theft.id);
  assert.ok(audit.tags.includes('audit'));

  initFactionRelations();
});

test('container theft witnesses are chosen by distance instead of entity array order', () => {
  initFactionRelations();
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    time: 440,
    worldEvents: createWorldEventState(),
  });
  const world = new World();
  addTestRoom(world, {
    id: 0,
    x: 10,
    y: 10,
    w: 8,
    h: 8,
    type: RoomType.STORAGE,
    name: 'Комната печатей',
    zoneId: 0,
  });
  const player = makeTestPlayer({ id: 0, x: 11.5, y: 11.5 });
  const farWitness = makeTestEntity({
    id: 88,
    type: EntityType.NPC,
    x: 16.4,
    y: 12.5,
    name: 'Дальний свидетель',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const nearWitness = makeTestEntity({
    id: 66,
    type: EntityType.NPC,
    x: 13.1,
    y: 12.5,
    name: 'Ближний свидетель',
    faction: Faction.CITIZEN,
    inventory: [],
  });
  const ledger = makeTestContainer({
    id: 23,
    x: 12,
    y: 12,
    floor: FloorLevel.MINISTRY,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.FILING_CABINET,
    name: 'Чужой журнал печатей',
    access: 'owner',
    ownerNpcId: 55,
    ownerName: 'Зоя Сургучная',
    faction: Faction.CITIZEN,
    inventory: [{ defId: 'forged_stamp_sheet', count: 1 }],
    capacitySlots: 4,
    tags: ['ministry', 'stamp_room', 'paper', 'forgery', 'audit', 'witness'],
  });
  world.addContainer(ledger);

  assert.equal(takeFromContainer(ledger, player, 0, 1, { state, world, entities: [player, farWitness, nearWitness] }), true);

  const theft = getRecentEvents(state, { type: 'item_stolen', limit: 1 })[0];
  assert.equal(theft.targetId, 66);
  assert.deepEqual(theft.data?.witnessIds, [66, 88]);

  initFactionRelations();
});
