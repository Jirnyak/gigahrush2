import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  type Room,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  PNEUMOMAIL_CAPSULE_ITEM_ID,
  PNEUMOMAIL_CONTRACT_ID,
  PNEUMOMAIL_HISTORY_CAPACITY,
  PNEUMOMAIL_REQUIRED_KINDS,
  PNEUMOMAIL_ROOM_NAME,
} from '../src/data/pneumomail';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { tryUsePneumomailTube } from '../src/systems/pneumomail';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

function makePneumomailWorld(): {
  world: World;
  intake: { x: number; y: number };
  intercept: { x: number; y: number };
  jam: { x: number; y: number };
  report: { x: number; y: number };
} {
  const world = new World();
  const room: Room = {
    id: 0,
    type: RoomType.OFFICE,
    x: 8,
    y: 8,
    w: 10,
    h: 8,
    doors: [],
    sealed: false,
    name: PNEUMOMAIL_ROOM_NAME,
    apartmentId: -1,
    wallTex: Tex.PIPE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms = [room];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = room.id;
    }
  }

  const intake = { x: 10, y: 10 };
  const intercept = { x: 11, y: 10 };
  const jam = { x: 12, y: 10 };
  const report = { x: 13, y: 10 };
  world.features[world.idx(intake.x, intake.y)] = Feature.APPARATUS;
  world.features[world.idx(intercept.x, intercept.y)] = Feature.MACHINE;
  world.features[world.idx(jam.x, jam.y)] = Feature.DESK;
  world.features[world.idx(report.x, report.y)] = Feature.SCREEN;
  return { world, intake, intercept, jam, report };
}

test('pneumomail intake covers required capsule outcomes with bounded history', () => {
  const { world, intake } = makePneumomailWorld();
  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({ id: 1, x: 9, y: 10, inventory: [] });

  for (let i = 0; i < PNEUMOMAIL_REQUIRED_KINDS.length; i++) {
    state.time = i * 600;
    assert.equal(tryUsePneumomailTube(world, player, state, intake.x, intake.y), true);
  }

  const events = getRecentEvents(state, { tags: ['pneumomail'], limit: 20 });
  const capsuleKinds = new Set(events.map(event => event.data?.capsuleKind).filter((kind): kind is string => typeof kind === 'string'));
  for (const kind of PNEUMOMAIL_REQUIRED_KINDS) assert.equal(capsuleKinds.has(kind), true, `${kind} capsule should be seen`);

  assert.equal(state.quests.filter(q => q.contractId === PNEUMOMAIL_CONTRACT_ID).length, 1);
  const falseLead = events.find(event => event.data?.capsuleKind === 'false_lead');
  assert.ok(falseLead);
  assert.equal(falseLead.data?.rumorIds, undefined);

  const contraband = events.find(event => event.data?.capsuleKind === 'contraband');
  assert.ok(contraband);
  assert.equal(contraband.tags.includes('pneumomail_contraband'), true);
  assert.equal(countInventoryItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID), 1);
  assert.equal(countInventoryItem(player, 'forged_permit_slip'), 1);
  assert.equal(events.every(event => Number(event.data?.historyCount ?? 0) <= PNEUMOMAIL_HISTORY_CAPACITY), true);
});

test('pneumomail intercept, jam, and report publish explicit events', () => {
  const { world, intercept, jam, report } = makePneumomailWorld();
  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({
    id: 1,
    x: 9,
    y: 10,
    money: 0,
    inventory: [
      { defId: 'wrench', count: 1 },
      { defId: 'wire_coil', count: 1 },
    ],
  });

  assert.equal(tryUsePneumomailTube(world, player, state, intercept.x, intercept.y), true);
  assert.equal(countInventoryItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID), 1);

  state.time = 10;
  assert.equal(tryUsePneumomailTube(world, player, state, jam.x, jam.y), true);
  assert.equal(countInventoryItem(player, 'wire_coil'), 0);

  state.time = 20;
  assert.equal(tryUsePneumomailTube(world, player, state, report.x, report.y), true);
  assert.equal(countInventoryItem(player, PNEUMOMAIL_CAPSULE_ITEM_ID), 0);
  assert.equal(countInventoryItem(player, 'water_coupon'), 1);
  assert.equal(player.money, 35);

  assert.ok(getRecentEvents(state, { tags: ['pneumomail_intercept'], limit: 1 })[0]);
  assert.ok(getRecentEvents(state, { tags: ['pneumomail_jam'], limit: 1 })[0]);
  assert.ok(getRecentEvents(state, { tags: ['pneumomail_report'], limit: 1 })[0]);
});
