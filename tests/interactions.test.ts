import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, Feature, LiftDirection, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { GAMBLING_MACHINES } from '../src/data/gambling';
import {
  activateGamblingBet,
  clearGamblingMachines,
  getGamblingOverlaySnapshot,
  openGamblingMachine,
  resolveGamblingBet,
  placeGamblingMachine,
} from '../src/systems/gambling';
import { activateInteraction, findInteractionTarget } from '../src/systems/interactions';
import { netHackChance, netHackDifficultyTotal, netHackSkill } from '../src/systems/net_hack';
import { addTestRoom, countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function installNoopAudioContext(): void {
  const fakeNode = {
    connect: () => fakeNode,
    disconnect: () => undefined,
    gain: {
      value: 0,
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    },
    frequency: {
      setValueAtTime: () => undefined,
      exponentialRampToValueAtTime: () => undefined,
    },
    start: () => undefined,
    stop: () => undefined,
    type: 'sine',
  };
  class FakeAudioContext {
    currentTime = 0;
    destination = fakeNode;
    state: AudioContextState = 'running';
    createOscillator(): OscillatorNode { return fakeNode as unknown as OscillatorNode; }
    createGain(): GainNode { return fakeNode as unknown as GainNode; }
    resume(): Promise<void> { return Promise.resolve(); }
  }
  (globalThis as typeof globalThis & { AudioContext: typeof AudioContext }).AudioContext = FakeAudioContext as unknown as typeof AudioContext;
}

test('gambling odds resolve stake, gross payout and net result without mutating state', () => {
  const roulette = GAMBLING_MACHINES.roulette;
  assert.deepEqual(resolveGamblingBet(roulette, 10, 0.01), {
    win: true,
    stake: 10,
    grossPayout: 20,
    net: 10,
  });
  assert.deepEqual(resolveGamblingBet(roulette, 10, 0.99), {
    win: false,
    stake: 10,
    grossPayout: 0,
    net: -10,
  });
});

test('net hack chance follows the documented difficulty and skill formula', () => {
  const input = { baseDifficulty: 10, floorDangerOrZ: 5, terminalRandom: 2, level: 4, int: 3 };
  assert.equal(netHackDifficultyTotal(input), 17);
  assert.equal(netHackSkill(input.level, input.int), 17);
  assert.equal(netHackChance(input), 0.45);
  assert.equal(netHackChance({ ...input, level: 99, int: 99 }), 0.92);
  assert.equal(netHackChance({ ...input, level: 0, int: 0, baseDifficulty: 200 }), 0.08);
});

test('interaction dispatcher reports generated gambling machines as E targets', () => {
  clearGamblingMachines();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 6, h: 6 });
  const idx = world.idx(6, 6);
  world.cells[idx] = Cell.FLOOR;
  const machine = placeGamblingMachine(world, 6, 6, 'slots');
  assert.ok(machine);

  const state = makeGameState();
  const player = makeTestPlayer({ x: 5, y: 6, angle: 0 });
  const target = findInteractionTarget({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(target?.kind, 'gambling');
  assert.equal(target?.defId, 'slots');
});

test('gambling machines accept gambling-tagged resident goods as a stake when cash is short', () => {
  clearGamblingMachines();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 6, h: 6 });
  const idx = world.idx(6, 6);
  world.cells[idx] = Cell.FLOOR;
  const machine = placeGamblingMachine(world, 6, 6, 'slots');
  assert.ok(machine);

  const state = makeGameState({ time: 12 });
  const player = makeTestPlayer({
    money: 0,
    inventory: [{ defId: 'dice_bone', count: 1 }],
  });

  openGamblingMachine(state, machine);
  const snapshot = getGamblingOverlaySnapshot(player);
  assert.equal(snapshot.canSubmit, true);
  assert.equal(snapshot.itemStakeName, 'Игральные кости');
  assert.equal(snapshot.betRubles, 16);

  const outcome = activateGamblingBet(world, state, player, 0.01);
  assert.deepEqual(outcome, {
    win: true,
    stake: 16,
    grossPayout: 48,
    net: 32,
  });
  assert.equal(player.money, 48);
  assert.equal(countInventoryItem(player, 'dice_bone'), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Игральные кости приняли')));
});

test('lift button feature alone is not a route transition target', () => {
  clearGamblingMachines();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 8, h: 8 });
  const idx = world.idx(6, 6);
  world.cells[idx] = Cell.FLOOR;
  world.features[idx] = Feature.LIFT_BUTTON;
  world.liftDir[idx] = LiftDirection.DOWN;

  const state = makeGameState();
  const player = makeTestPlayer({ x: 5, y: 6, angle: 0 });
  const target = findInteractionTarget({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(target, null);
});

test('interaction dispatcher only reports NPCs when the crosshair is on the sprite', () => {
  clearGamblingMachines();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 8, h: 8 });
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0 });
  const npc = makeTestNpc({ id: 2, x: 6.25, y: 6, angle: Math.PI });

  const aimed = findInteractionTarget({
    world,
    state,
    player,
    entities: [player, npc],
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(aimed?.kind, 'npc');

  npc.y = 6.75;
  const offCrosshair = findInteractionTarget({
    world,
    state,
    player,
    entities: [player, npc],
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(offCrosshair, null);
});

test('manual item pickup exposes aimed drops as E targets and picks only on interact', () => {
  installNoopAudioContext();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 8, h: 8 });
  const state = makeGameState({ time: 10 });
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0, inventory: [] });
  const drop: Entity = {
    id: 2,
    type: EntityType.ITEM_DROP,
    x: 6.1,
    y: 6,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [{ defId: 'bread', count: 1 }],
  };
  const entities = [player, drop];

  assert.equal(findInteractionTarget({
    world,
    state,
    player,
    entities,
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
  }), null);

  const target = findInteractionTarget({
    world,
    state,
    player,
    entities,
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
    manualItemPickup: true,
  });
  assert.equal(target?.kind, 'item_drop');
  assert.equal(target?.defId, 'bread');
  assert.equal(target?.itemName, 'Хлеб');
  assert.equal(target?.prompt, ' поднять');

  let pickedHook = 0;
  const result = activateInteraction({
    world,
    state,
    player,
    entities,
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
    manualItemPickup: true,
    onPickedDrop: picked => {
      if (picked.id === drop.id) pickedHook++;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(drop.alive, false);
  assert.equal(countInventoryItem(player, 'bread'), 1);
  assert.equal(pickedHook, 1);
});

test('off-crosshair nearby NPC does not mask an aimed door', () => {
  clearGamblingMachines();
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 8, h: 8 });
  const doorIdx = world.idx(6, 6);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });

  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0 });
  const npc = makeTestNpc({ id: 2, x: 5.4, y: 7.1, angle: -Math.PI / 2 });
  const target = findInteractionTarget({
    world,
    state,
    player,
    entities: [player, npc],
    nextEntityId: { v: 3 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(target?.kind, 'door');
});

function makeLockedDoorWorld(keyId: string): { world: World; doorIdx: number } {
  const world = new World();
  addTestRoom(world, { id: 0, x: 4, y: 4, w: 8, h: 8 });
  const doorIdx = world.idx(6, 6);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.LOCKED, roomA: -1, roomB: -1, keyId, timer: 0 });
  return { world, doorIdx };
}

test('locked custom keyed door opens with matching custom key', () => {
  clearGamblingMachines();
  const { world, doorIdx } = makeLockedDoorWorld('borrowed_kitchen_key');
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0, inventory: [{ defId: 'borrowed_kitchen_key', count: 1 }] });

  const result = activateInteraction({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(result.handled, true);
  assert.equal(world.doors.get(doorIdx)?.state, DoorState.OPEN);
  assert.equal(state.msgs.at(-1)?.text, 'Дверь отперта ключом');
});

test('generic key does not open custom keyed locked door', () => {
  clearGamblingMachines();
  const { world, doorIdx } = makeLockedDoorWorld('borrowed_kitchen_key');
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0, inventory: [{ defId: 'key', count: 1 }] });

  const result = activateInteraction({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(result.handled, true);
  assert.equal(world.doors.get(doorIdx)?.state, DoorState.LOCKED);
  assert.equal(state.msgs.at(-1)?.text, 'Заперто. Нужен ключ. (Удар -5)');
});

test('generic key opens empty-key generic locked door', () => {
  clearGamblingMachines();
  const { world, doorIdx } = makeLockedDoorWorld('');
  const state = makeGameState();
  const player = makeTestPlayer({ id: 1, x: 5, y: 6, angle: 0, inventory: [{ defId: 'key', count: 1 }] });

  const result = activateInteraction({
    world,
    state,
    player,
    entities: [player],
    nextEntityId: { v: 2 },
    lookX: 6,
    lookY: 6,
  });

  assert.equal(result.handled, true);
  assert.equal(world.doors.get(doorIdx)?.state, DoorState.OPEN);
  assert.equal(state.msgs.at(-1)?.text, 'Дверь отперта ключом');
});
