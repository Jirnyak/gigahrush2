import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, QuestType, type Entity, type Item, type Quest } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';
import { getRecentEvents } from '../src/systems/events';
import { addItem, dropItem, pickupDrop, pickupNearby } from '../src/systems/inventory';
import { checkQuests } from '../src/systems/quests';
import { countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function pipeSlots(count: number): Item[] {
  return Array.from({ length: count }, () => ({ defId: 'pipe', count: 1 }));
}

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

test('addItem is atomic when a near-full inventory can only accept part of a stack', () => {
  const player = makeTestPlayer({
    inventory: [{ defId: 'bread', count: 998 }, ...pipeSlots(MAX_INVENTORY_SLOTS - 1)],
  });
  const before = player.inventory?.map(item => ({ ...item })) ?? [];

  assert.equal(addItem(player, 'bread', 2), false);
  assert.deepEqual(player.inventory, before);
  assert.equal(countInventoryItem(player, 'bread'), 998);
});

test('pickupNearby keeps unconsumed stacks on a multi-stack drop', () => {
  installNoopAudioContext();
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10, inventory: pipeSlots(MAX_INVENTORY_SLOTS - 1) });
  const drop: Entity = {
    id: 2,
    type: EntityType.ITEM_DROP,
    x: 10.5,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [{ defId: 'bread', count: 1 }, { defId: 'pipe', count: 1 }],
  };
  const entities = [player, drop];
  const msgs = makeGameState().msgs;

  pickupNearby(world, entities, player, msgs, 1);

  assert.equal(drop.alive, true);
  assert.deepEqual(drop.inventory, [{ defId: 'pipe', count: 1 }]);
  assert.equal(countInventoryItem(player, 'bread'), 1);
  assert.equal(countInventoryItem(player, 'pipe'), MAX_INVENTORY_SLOTS - 1);
  assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS);
});

test('tool drops preserve durability data through pickup', () => {
  installNoopAudioContext();
  const world = new World();
  const state = makeGameState({ time: 7 });
  const player = makeTestPlayer({
    id: 1,
    x: 10,
    y: 10,
    angle: 0,
    tool: 'flashlight',
    inventory: [{ defId: 'flashlight', count: 1, data: { dur: 123 } }],
  });
  const entities: Entity[] = [player];
  const nextId = { v: 2 };

  dropItem(player, 0, entities, state.msgs, state.time, nextId, state, world);

  assert.equal(player.tool, '');
  assert.deepEqual(player.inventory, []);
  const drop = entities.find(entity => entity.type === EntityType.ITEM_DROP);
  assert.ok(drop);
  assert.deepEqual(drop.inventory, [{ defId: 'flashlight', count: 1, data: { dur: 123 } }]);
  assert.equal(state.msgs.some(entry => entry.text.includes('сломан')), false);

  const result = pickupDrop(world, drop, player, state.msgs, state.time, state);

  assert.equal(result.pickedAny, true);
  assert.equal(drop.alive, false);
  const flashlight = player.inventory?.find(item => item.defId === 'flashlight');
  assert.equal((flashlight?.data as { dur?: number } | undefined)?.dur, 123);
});

test('cleanup tongs recover green acid samples with durability instead of filter layer', () => {
  installNoopAudioContext();
  const world = new World();
  const state = makeGameState({ time: 12 });
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  assert.equal(addItem(player, 'cleanup_tongs', 1), true);
  player.tool = 'cleanup_tongs';
  const drop: Entity = {
    id: 2,
    type: EntityType.ITEM_DROP,
    x: 10.5,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    inventory: [{
      defId: 'slime_sample_green',
      count: 1,
      data: { ag64GreenAcid: true, organicRisk: true, sample: true },
    }],
  };

  pickupNearby(world, [player, drop], player, state.msgs, state.time, state);

  assert.equal(drop.alive, false);
  assert.equal(countInventoryItem(player, 'slime_sample_green'), 1);
  assert.equal(countInventoryItem(player, 'filter_layer'), 0);
  const tongs = player.inventory?.find(item => item.defId === 'cleanup_tongs');
  assert.equal((tongs?.data as { dur?: number } | undefined)?.dur, (ITEMS.cleanup_tongs.durability ?? 0) - 1);
  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['green_acid', 'sample_handling'], limit: 1 })[0];
  assert.equal(event?.itemId, 'cleanup_tongs');
  assert.equal(event?.data?.affectedItemId, 'slime_sample_green');
});

test('full inventory blocks item quest rewards without marking the quest done', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, inventory: pipeSlots(MAX_INVENTORY_SLOTS), money: 0 });
  const giver = makeTestNpc({ id: 2, name: 'Выдающий' });
  const quest: Quest = {
    id: 1,
    type: QuestType.KILL,
    giverId: giver.id,
    giverName: giver.name ?? 'Выдающий',
    desc: 'проверить плату',
    killCount: 1,
    killNeeded: 1,
    rewardItem: 'bread',
    rewardCount: 1,
    done: false,
  };
  const state = makeGameState({ quests: [quest], time: 3 });

  checkQuests(player, world, [player, giver], state, state.msgs);

  assert.equal(quest.done, false);
  assert.equal(countInventoryItem(player, 'bread'), 0);
  assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS);
  assert.ok(state.msgs.some(entry => /Нет места для платы/.test(entry.text)));
  assert.equal(state.msgs.some(entry => /Поручение закрыто/.test(entry.text)), false);
});
