import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel, Faction } from '../src/core/types';
import { recordPlayerItemSale } from '../src/systems/economy';
import { getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

test('recordPlayerItemSale logic correctly categorizes handoff to scientists', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const scientist = makeTestNpc({ id: 2, faction: Faction.SCIENTIST });

  // Choose an item with scienceValue >= 50
  recordPlayerItemSale(state, player, scientist, 'govnyak_sample', 1, 100);

  const events = getRecentEvents(state, { limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'player_handoff_item');
  assert.ok(events[0].tags.includes('science_handoff'));
  assert.ok(events[0].tags.includes('science'));
});


test('recordPlayerItemSale logic correctly categorizes confiscation by liquidators', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const liquidator = makeTestNpc({ id: 2, faction: Faction.LIQUIDATOR });

  recordPlayerItemSale(state, player, liquidator, 'govnyak_roll', 1, 100);

  const events = getRecentEvents(state, { limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'player_handoff_item');
  assert.ok(events[0].tags.includes('confiscation'));
});

test('recordPlayerItemSale logic correctly categorizes contraband sale to black market (WILD)', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const wildNpc = makeTestNpc({ id: 2, faction: Faction.WILD });

  recordPlayerItemSale(state, player, wildNpc, 'govnyak_roll', 1, 100);

  const events = getRecentEvents(state, { limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'player_sell_item');
  assert.ok(events[0].tags.includes('contraband_sale'));
  assert.ok(events[0].tags.includes('black_market'));
});

test('recordPlayerItemSale logic categorizes deceptive item sale as witnessed pressure sale', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const citizen = makeTestNpc({ id: 2, faction: Faction.CITIZEN });

  // SILVER_SLIME_OPENED_ID has deceptiveScore: 90
  recordPlayerItemSale(state, player, citizen, 'slime_sample_silver_open', 1, 100);

  const events = getRecentEvents(state, { limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'player_sell_item');
  assert.ok(events[0].tags.includes('pressure_sale'));
  assert.equal(events[0].severity, 4);
  assert.equal(events[0].privacy, 'witnessed');
});

test('recordPlayerItemSale logic logs normal sale for regular items', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const citizen = makeTestNpc({ id: 2, faction: Faction.CITIZEN });

  recordPlayerItemSale(state, player, citizen, 'water', 1, 10);

  const events = getRecentEvents(state, { limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'player_sell_item');
  assert.ok(events[0].tags.includes('sale'));
  assert.ok(!events[0].tags.includes('contraband'));
  assert.equal(events[0].severity, 1);
});

test('recordPlayerItemSale logic bails out early for invalid items', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ id: 1, faction: Faction.PLAYER });
  const citizen = makeTestNpc({ id: 2, faction: Faction.CITIZEN });

  const initialEventsLength = getRecentEvents(state).length;
  recordPlayerItemSale(state, player, citizen, 'invalid_item_id_123', 1, 10);

  const finalEventsLength = getRecentEvents(state).length;
  assert.equal(finalEventsLength, initialEventsLength);
});
