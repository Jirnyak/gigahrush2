import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const TRANSFORM_USES = [
  { source: 'black_market_shells', output: 'ammo_shells', count: 4 },
  { source: 'stolen_filter_pack', output: 'gasmask_filter', count: 2 },
  { source: 'homemade_9mm', output: 'ammo_9mm', count: 6 },
  { source: 'ammo_12g_chemical', output: 'decon_fluid', count: 1 },
  { source: 'blue_glow_sample_sealed', output: 'blue_glow_sample_open', count: 1 },
] as const;

function fillerSlots(count: number) {
  return Array.from({ length: count }, (_, i) => ({ defId: 'pipe', count: 1, data: { dur: 100 + i } }));
}

test('transforming use items reuse the selected freed slot when inventory is full', () => {
  for (const row of TRANSFORM_USES) {
    const player = makeTestPlayer({
      hp: 80,
      maxHp: 100,
      inventory: [
        { defId: row.source, count: 1 },
        ...fillerSlots(MAX_INVENTORY_SLOTS - 1),
      ],
    });
    const state = makeGameState({ time: 10 });

    useItem(player, 0, state.msgs, state.time, state);

    assert.equal(countInventoryItem(player, row.source), 0, `${row.source} should be consumed`);
    assert.equal(countInventoryItem(player, row.output), row.count, `${row.output} should be created`);
    assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS, `${row.source} should reuse the freed slot`);
  }
});

test('transforming use refuses when the source stack stays occupied and no output capacity exists', () => {
  const player = makeTestPlayer({
    inventory: [
      { defId: 'black_market_shells', count: 2 },
      ...fillerSlots(MAX_INVENTORY_SLOTS - 1),
    ],
  });
  const state = makeGameState({ time: 20 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'black_market_shells'), 2);
  assert.equal(countInventoryItem(player, 'ammo_shells'), 0);
  assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS);
  assert.ok(state.msgs.some(line => line.text.includes('Нет места')));
});

test('transforming use stacks output when full inventory has a compatible partial stack', () => {
  const player = makeTestPlayer({
    inventory: [
      { defId: 'black_market_shells', count: 2 },
      { defId: 'ammo_shells', count: 1 },
      ...fillerSlots(MAX_INVENTORY_SLOTS - 2),
    ],
  });
  const state = makeGameState({ time: 30 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'black_market_shells'), 1);
  assert.equal(countInventoryItem(player, 'ammo_shells'), 5);
  assert.equal(player.inventory?.length, MAX_INVENTORY_SLOTS);
});
