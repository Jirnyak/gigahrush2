import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, ZoneFaction } from '../src/core/types';
import { World } from '../src/core/world';
import { initFactionRelations } from '../src/data/relations';
import { putIntoContainer } from '../src/systems/containers';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { destroyMaronaryShaving, tryHandleMaronaryShavingHandoff } from '../src/systems/maronary_shaving';
import {
  ContainerKind,
  Faction,
  FloorLevel,
  Occupation,
  WRONG_DOOR_MAX_DIST2,
  WRONG_DOOR_MIN_DIST2,
  chooseWrongDoorRouteOption,
  createWrongDoorRemap,
  isUsableWrongDoorRoute,
  wrongDoorCueActionLabel,
  wrongDoorCueSecondsLeft,
  type WrongDoorMapCue,
  type WrongDoorRouteOption,
} from '../src/systems/wrong_door';
import { addTestRoom, makeGameState, makeTestContainer, makeTestNpc, makeTestPlayer } from './helpers';

function option(overrides: Partial<WrongDoorRouteOption>): WrongDoorRouteOption {
  return {
    sourceIdx: 1,
    targetIdx: 2,
    targetDoorIdx: 3,
    sourceRoomId: 10,
    targetRoomId: 20,
    distance2: WRONG_DOOR_MIN_DIST2 + 1,
    sourceDist2: 4,
    targetDanger: 0,
    ...overrides,
  };
}

function addDoor(world: World, x: number, y: number, roomId: number, protectedDoor = false): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.roomMap[idx] = roomId;
  world.zoneMap[idx] = 0;
  world.doors.set(idx, { idx, state: DoorState.HERMETIC_OPEN, roomA: roomId, roomB: -1, keyId: '', timer: 0 });
  for (const dx of [-1, 1]) {
    const fi = world.idx(x + dx, y);
    world.cells[fi] = Cell.FLOOR;
    world.roomMap[fi] = -1;
    world.zoneMap[fi] = 0;
  }
  if (protectedDoor) {
    world.aptMask[idx] = 1;
    world.hermoWall[idx] = 1;
  }
  return idx;
}

function makeWrongDoorWorld(): World {
  const world = new World();
  world.zones[0] = { id: 0, cx: 10, cy: 10, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  return world;
}

test('wrong-door route validation rejects same-room, same-cell, and out-of-band routes', () => {
  assert.equal(isUsableWrongDoorRoute(option({})), true);
  assert.equal(isUsableWrongDoorRoute(option({ targetIdx: 1 })), false);
  assert.equal(isUsableWrongDoorRoute(option({ targetRoomId: 10 })), false);
  assert.equal(isUsableWrongDoorRoute(option({ distance2: WRONG_DOOR_MIN_DIST2 - 1 })), false);
  assert.equal(isUsableWrongDoorRoute(option({ distance2: WRONG_DOOR_MAX_DIST2 + 1 })), false);
});

test('wrong-door route picker prefers a reachable nearby source over a remote source', () => {
  const picked = chooseWrongDoorRouteOption([
    option({ sourceIdx: 11, sourceDist2: 400, distance2: 60 * 60 }),
    option({ sourceIdx: 22, sourceDist2: 4, distance2: 42 * 42 }),
    option({ sourceIdx: 33, targetRoomId: 10, sourceDist2: 0, distance2: 90 * 90, targetDanger: 5 }),
  ], 1234);

  assert.equal(picked?.sourceIdx, 22);
});

test('wrong-door route picker is invariant to candidate array order', () => {
  const routes = [
    option({ sourceIdx: 11, targetIdx: 101, targetDoorIdx: 201, sourceDist2: 16, distance2: 48 * 48, targetDanger: 1 }),
    option({ sourceIdx: 22, targetIdx: 102, targetDoorIdx: 202, sourceDist2: 16, distance2: 48 * 48, targetDanger: 1 }),
    option({ sourceIdx: 33, targetIdx: 103, targetDoorIdx: 203, sourceDist2: 16, distance2: 48 * 48, targetDanger: 1 }),
  ];

  const pickedA = chooseWrongDoorRouteOption(routes, 9123);
  const pickedB = chooseWrongDoorRouteOption([...routes].reverse(), 9123);

  assert.ok(pickedA);
  assert.equal(pickedB?.sourceIdx, pickedA.sourceIdx);
  assert.equal(pickedB?.targetIdx, pickedA.targetIdx);
});

test('wrong-door map cue tells the player to distrust or wait out the route', () => {
  const cue: WrongDoorMapCue = {
    id: 1,
    sourceX: 10,
    sourceY: 20,
    targetX: 70,
    targetY: 80,
    expiresAt: 100,
  };

  assert.equal(wrongDoorCueSecondsLeft(cue, 88.2), 12);
  assert.equal(wrongDoorCueActionLabel(cue, 60), 'НЕ ВЕРЬ');
  assert.equal(wrongDoorCueActionLabel(cue, 88.2), 'ЖДИ');
  assert.equal(wrongDoorCueActionLabel(cue, 101), 'СБРОШЕНО');
});

test('maronary wrong-door remap ignores protected hermetic source doors', () => {
  const world = makeWrongDoorWorld();
  const protectedSource = addDoor(world, 10, 10, 1, true);
  addDoor(world, 55, 10, 2);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const cue = createWrongDoorRemap(world, state, 10.5, 10.5, 'test_protected_source', false, protectedSource);

  assert.equal(cue, null);
  assert.equal(world.anomalyTeleports.has(protectedSource), false);
});

test('maronary wrong-door remap can still use ordinary route doors', () => {
  const world = makeWrongDoorWorld();
  const source = addDoor(world, 10, 10, 1);
  addDoor(world, 55, 10, 2);
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const cue = createWrongDoorRemap(world, state, 10.5, 10.5, 'test_open_source', false, source);

  assert.ok(cue);
  assert.equal(world.anomalyTeleports.has(source), true);
  assert.notEqual(world.anomalyTeleports.get(source), source);
});

test('maronary shaving can be sold to science or hidden as contraband evidence', () => {
  initFactionRelations();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({
    id: 0,
    inventory: [{ defId: 'maronary_shaving', count: 1 }],
    money: 0,
  });
  const yakov = makeTestNpc({
    id: 2,
    name: 'Яков Давидович',
    faction: Faction.SCIENTIST,
    occupation: Occupation.SCIENTIST,
    plotNpcId: 'yakov',
    inventory: [],
  });

  assert.equal(tryHandleMaronaryShavingHandoff(player, yakov, 0, state), true);
  assert.equal(player.inventory?.length, 0);
  assert.equal(player.money, 280);
  assert.deepEqual(yakov.inventory, [{ defId: 'maronary_shaving', count: 1 }]);

  const handoff = getRecentEvents(state, { type: 'player_handoff_item', tags: ['maronary', 'science'], limit: 1 })[0];
  assert.equal(handoff.data?.outcome, 'science');
  assert.equal(handoff.data?.reward, 280);

  const world = new World();
  addTestRoom(world);
  const secret = makeTestContainer({
    id: 3,
    x: 12,
    y: 12,
    roomId: 0,
    zoneId: 0,
    kind: ContainerKind.SECRET_STASH,
    access: 'secret',
    discovered: true,
    capacitySlots: 3,
    tags: ['secret'],
  });
  world.addContainer(secret);
  player.inventory = [{ defId: 'maronary_shaving', count: 1 }];

  assert.equal(putIntoContainer(secret, player, 0, 1, { state, world, entities: [player] }), true);
  assert.equal(player.inventory.length, 0);
  assert.ok(secret.tags.includes('maronary_hidden'));

  const hidden = getRecentEvents(state, { type: 'item_deposited', tags: ['maronary', 'hidden'], limit: 1 })[0];
  assert.equal(hidden.data?.depositOutcome, 'maronary_hidden');
  assert.deepEqual(hidden.data?.rumorIds, ['samosbor_maronary_shaving_hidden']);
});

test('maronary shaving handoff uses ordered item outcome rules', () => {
  initFactionRelations();
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    worldEvents: createWorldEventState(),
  });
  const player = makeTestPlayer({
    id: 0,
    inventory: [{ defId: 'maronary_shaving', count: 1 }],
    money: 0,
  });
  const ministryBuyer = makeTestNpc({
    id: 2,
    name: 'Ротенбергов',
    faction: Faction.WILD,
    occupation: Occupation.HUNTER,
    plotNpcId: 'rotenbergov',
    inventory: [],
  });

  assert.equal(tryHandleMaronaryShavingHandoff(player, ministryBuyer, 0, state), true);
  assert.equal(player.money, 240);
  const ministry = getRecentEvents(state, { type: 'player_handoff_item', tags: ['maronary', 'ministry'], limit: 1 })[0];
  assert.equal(ministry.data?.outcome, 'ministry');
  assert.equal(ministry.data?.buyerPlotNpcId, 'rotenbergov');

  player.inventory = [{ defId: 'maronary_shaving', count: 1 }];
  const cultBuyer = makeTestNpc({
    id: 3,
    name: 'Тихий священник',
    faction: Faction.CITIZEN,
    occupation: Occupation.PRIEST,
    inventory: [],
  });

  assert.equal(tryHandleMaronaryShavingHandoff(player, cultBuyer, 0, state), true);
  assert.equal(player.money, 560);
  const cult = getRecentEvents(state, { type: 'player_handoff_item', tags: ['maronary', 'cult'], limit: 1 })[0];
  assert.equal(cult.data?.outcome, 'cult');
  assert.equal(cult.data?.reward, 320);

  const saleState = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const salePlayer = makeTestPlayer({
    id: 4,
    inventory: [{ defId: 'maronary_shaving', count: 1 }],
    money: 0,
  });
  const saleBuyer = makeTestNpc({
    id: 5,
    name: 'Покупатель',
    faction: Faction.CITIZEN,
    occupation: Occupation.STOREKEEPER,
    inventory: [],
  });

  assert.equal(tryHandleMaronaryShavingHandoff(salePlayer, saleBuyer, 0, saleState), true);
  assert.equal(salePlayer.money, 190);
  const sale = getRecentEvents(saleState, { type: 'player_sell_item', tags: ['maronary', 'sale'], limit: 1 })[0];
  assert.equal(sale.data?.outcome, 'sale');
  assert.equal(sale.data?.reward, 190);
});

test('maronary shaving can be destroyed to cut the trace at a PSI cost', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const player = makeTestPlayer({
    id: 0,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 1, agi: 1, int: 1, psi: 10, maxPsi: 10 },
  });

  const text = destroyMaronaryShaving(player, state);

  assert.equal(player.rpg?.psi, 4);
  assert.match(text, /ПСИ -6/);
  const destroyed = getRecentEvents(state, { type: 'player_destroy_item', tags: ['maronary', 'destroyed'], limit: 1 })[0];
  assert.equal(destroyed.data?.outcome, 'destroyed');
  assert.equal(destroyed.data?.psiCost, 6);
});
