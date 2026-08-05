import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel, type GameState } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';
import { MAX_INVENTORY_SLOTS } from '../src/data/inventory_limits';
import { ensureEconomyState, getEconomyQuote } from '../src/systems/economy';
import {
  addTradeAskFromSlot,
  addTradeOfferFromSlot,
  buyFromNpc,
  clearTradeOffers,
  executeTradeDeal,
  getTradeCreditSummary,
  getTradeDealSummary,
  getTradeNpcOffer,
  getTradeOffer,
  removeTradeAskSlot,
  removeTradeOfferSlot,
} from '../src/systems/trade';
import { getRecentEvents } from '../src/systems/events';
import { countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function resetFloor(state: GameState, floor: FloorLevel): void {
  const economy = ensureEconomyState(state);
  economy.floors[floor] = createEconomyFloorState(floor);
}

function resourceStock(state: GameState, floor: FloorLevel, resourceId: string): number {
  const economy = ensureEconomyState(state);
  return economy.floors[floor]?.resources[resourceId]?.stock ?? 0;
}

test('NPC purchase consumes staged player offer as trade credit before cash', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'flashlight', count: 1 }], money: 100 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'water', count: 1 }], money: 0 });
  const beforeWaterStock = resourceStock(state, FloorLevel.LIVING, 'drink_water');

  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const summary = getTradeCreditSummary(state, npc, 'water');
  const result = buyFromNpc(state, player, npc, 0);

  assert.equal(result.ok, true);
  assert.equal(result.code, 'bought');
  assert.equal(result.price, summary.cashDue);
  assert.equal(player.money, 100 - summary.cashDue);
  assert.equal(npc.money, summary.cashDue);
  assert.equal(countInventoryItem(player, 'flashlight'), 0);
  assert.equal(countInventoryItem(player, 'water'), 1);
  assert.equal(countInventoryItem(npc, 'water'), 0);
  assert.equal(countInventoryItem(npc, 'flashlight'), 1);
  assert.equal(resourceStock(state, FloorLevel.LIVING, 'drink_water'), beforeWaterStock - 1);
  assert.equal(getTradeOffer(state).length, 0);

  const event = getRecentEvents(state, { limit: 1 })[0];
  assert.equal(event.type, 'player_handoff_item');
  assert.equal(event.data?.cashPaid, summary.cashDue);
  assert.equal(event.data?.creditValue, summary.creditValue);
  assert.equal(event.tags.includes('trade'), true);
  assert.equal(event.tags.includes('barter'), true);
});

test('symmetric trade stages NPC ask and player offer without mutating inventories', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'bread', count: 2 }], money: 100 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'water', count: 2 }], money: 0 });

  const ask = addTradeAskFromSlot(state, npc, 0);
  const offer = addTradeOfferFromSlot(state, player, npc, 0);
  const summary = getTradeDealSummary(state, npc);

  assert.equal(ask.ok, true);
  assert.equal(ask.code, 'ask_added');
  assert.equal(offer.ok, true);
  assert.equal(offer.code, 'offer_added');
  assert.equal(countInventoryItem(player, 'bread'), 2);
  assert.equal(countInventoryItem(player, 'water'), 0);
  assert.equal(countInventoryItem(npc, 'water'), 2);
  assert.equal(countInventoryItem(npc, 'bread'), 0);
  assert.equal(getTradeOffer(state)[0]?.count, 1);
  assert.equal(getTradeNpcOffer(state)[0]?.count, 1);
  assert.equal(summary.fullPrice, getEconomyQuote(state, 'water', { trader: npc }).buyPrice);
  assert.equal(summary.creditValue, getEconomyQuote(state, 'bread', { trader: npc }).sellPrice);

  assert.equal(removeTradeAskSlot(state, npc, 0).ok, true);
  assert.equal(removeTradeOfferSlot(state, npc, 0).ok, true);
  assert.equal(getTradeOffer(state).length, 0);
  assert.equal(getTradeNpcOffer(state).length, 0);
});

test('symmetric trade commits baskets with only cash delta and no change', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'flashlight', count: 1 }], money: 100 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'water', count: 1 }], money: 0 });
  const beforeWaterStock = resourceStock(state, FloorLevel.LIVING, 'drink_water');

  assert.equal(addTradeAskFromSlot(state, npc, 0).ok, true);
  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const summary = getTradeDealSummary(state, npc);
  const result = executeTradeDeal(state, player, npc);

  assert.equal(result.ok, true);
  assert.equal(result.code, 'deal_done');
  assert.equal(result.price, summary.cashDue);
  assert.equal(summary.changeDue, 0);
  assert.equal(player.money, 100 - summary.cashDue);
  assert.equal(npc.money, summary.cashDue);
  assert.equal(countInventoryItem(player, 'water'), 1);
  assert.equal(countInventoryItem(player, 'flashlight'), 0);
  assert.equal(countInventoryItem(npc, 'water'), 0);
  assert.equal(countInventoryItem(npc, 'flashlight'), 1);
  assert.equal(resourceStock(state, FloorLevel.LIVING, 'drink_water'), beforeWaterStock - 1);
  assert.equal(getTradeOffer(state).length, 0);
  assert.equal(getTradeNpcOffer(state).length, 0);

  const event = getRecentEvents(state, { limit: 1 })[0];
  assert.equal(event.type, 'player_handoff_item');
  assert.equal(event.data?.cashPaid, summary.cashDue);
  assert.equal(event.data?.cashReceived, 0);
  assert.equal(event.data?.creditValue, summary.creditValue);
  assert.equal(event.data?.askValue, summary.fullPrice);
  assert.equal(event.tags.includes('trade'), true);
  assert.equal(event.tags.includes('barter'), true);
});

test('symmetric trade pays NPC change when the trader has cash', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'flashlight', count: 1 }], money: 100 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'water', count: 1 }], money: 200 });

  assert.equal(addTradeAskFromSlot(state, npc, 0).ok, true);
  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const summary = getTradeDealSummary(state, npc);
  assert.ok(summary.surplus > 0);
  assert.equal(summary.changeDue, summary.surplus);
  const result = executeTradeDeal(state, player, npc);

  assert.equal(result.ok, true);
  assert.equal(result.code, 'deal_done');
  assert.equal(result.price, 0);
  assert.equal(player.money, 100 + summary.changeDue);
  assert.equal(npc.money, 200 - summary.changeDue);
  assert.equal(countInventoryItem(player, 'water'), 1);
  assert.equal(countInventoryItem(npc, 'flashlight'), 1);

  const event = getRecentEvents(state, { limit: 1 })[0];
  assert.equal(event.data?.cashPaid, 0);
  assert.equal(event.data?.cashReceived, summary.changeDue);
  assert.equal(event.data?.unpaidSurplus, 0);
});

test('NPC accepts a player-only profitable barter offer', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'bread', count: 1 }], money: 0 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [], money: 0 });

  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const summary = getTradeDealSummary(state, npc);
  const result = executeTradeDeal(state, player, npc);

  assert.equal(result.ok, true);
  assert.equal(result.code, 'deal_done');
  assert.equal(result.defId, 'bread');
  assert.equal(result.price, 0);
  assert.equal(summary.fullPrice, 0);
  assert.equal(summary.changeDue, 0);
  assert.equal(countInventoryItem(player, 'bread'), 0);
  assert.equal(countInventoryItem(npc, 'bread'), 1);
  assert.equal(getTradeOffer(state).length, 0);
  assert.equal(getTradeNpcOffer(state).length, 0);

  const event = getRecentEvents(state, { limit: 1 })[0];
  assert.equal(event.data?.direction, 'player_to_npc');
  assert.equal(event.tags.includes('sell'), true);
  assert.equal(event.tags.includes('barter'), true);
});

test('symmetric trade rejects missing cash delta without mutation and keeps baskets', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'bread', count: 1 }], money: 0 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'flashlight', count: 1 }], money: 10 });

  assert.equal(addTradeAskFromSlot(state, npc, 0).ok, true);
  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const result = executeTradeDeal(state, player, npc);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'player_no_money');
  assert.equal(player.money, 0);
  assert.equal(npc.money, 10);
  assert.equal(countInventoryItem(player, 'bread'), 1);
  assert.equal(countInventoryItem(player, 'flashlight'), 0);
  assert.equal(countInventoryItem(npc, 'flashlight'), 1);
  assert.equal(countInventoryItem(npc, 'bread'), 0);
  assert.equal(getTradeOffer(state).length, 1);
  assert.equal(getTradeNpcOffer(state).length, 1);
  assert.equal(getRecentEvents(state, { limit: 1 }).length, 0);
});

test('trade credit can partially discount an NPC purchase with cash top-up', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'bread', count: 1 }], money: 1000 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'flashlight', count: 1 }], money: 10 });

  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const flashlightQuote = getEconomyQuote(state, 'flashlight', { trader: npc });
  const breadQuote = getEconomyQuote(state, 'bread', { trader: npc });
  const summary = getTradeCreditSummary(state, npc, 'flashlight');
  assert.equal(summary.fullPrice, flashlightQuote.buyPrice);
  assert.equal(summary.creditValue, breadQuote.sellPrice);
  assert.equal(summary.cashDue, Math.max(0, flashlightQuote.buyPrice - breadQuote.sellPrice));

  const result = buyFromNpc(state, player, npc, 0);

  assert.equal(result.ok, true);
  assert.equal(player.money, 1000 - summary.cashDue);
  assert.equal(npc.money, 10 + summary.cashDue);
  assert.equal(countInventoryItem(player, 'bread'), 0);
  assert.equal(countInventoryItem(player, 'flashlight'), 1);
  assert.equal(countInventoryItem(npc, 'bread'), 1);
});

test('trade credit purchase rejects missing cash top-up without mutation', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const player = makeTestPlayer({ id: 1, inventory: [{ defId: 'bread', count: 1 }], money: 0 });
  const npc = makeTestNpc({ id: 2, name: 'Торговец', inventory: [{ defId: 'flashlight', count: 1 }], money: 10 });

  assert.equal(addTradeOfferFromSlot(state, player, npc, 0).ok, true);
  const result = buyFromNpc(state, player, npc, 0);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'player_no_money');
  assert.equal(player.money, 0);
  assert.equal(npc.money, 10);
  assert.equal(countInventoryItem(player, 'bread'), 1);
  assert.equal(countInventoryItem(player, 'flashlight'), 0);
  assert.equal(countInventoryItem(npc, 'flashlight'), 1);
  assert.equal(countInventoryItem(npc, 'bread'), 0);
  assert.equal(getTradeOffer(state).length, 1);
  assert.equal(getRecentEvents(state, { limit: 1 }).length, 0);
});

test('trade credit offer caps distinct staged slots and can be cleared', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({
    id: 1,
    inventory: Array.from({ length: MAX_INVENTORY_SLOTS + 1 }, (_, i) => ({ defId: 'bread', count: 1, data: { serial: i } })),
  });
  const npc = makeTestNpc({
    id: 2,
    name: 'Торговец',
    inventory: Array.from({ length: MAX_INVENTORY_SLOTS + 1 }, (_, i) => ({ defId: 'water', count: 1, data: { serial: i } })),
  });

  for (let i = 0; i < MAX_INVENTORY_SLOTS; i++) {
    assert.equal(addTradeOfferFromSlot(state, player, npc, i).ok, true);
    assert.equal(addTradeAskFromSlot(state, npc, i).ok, true);
  }
  const overflow = addTradeOfferFromSlot(state, player, npc, MAX_INVENTORY_SLOTS);
  const askOverflow = addTradeAskFromSlot(state, npc, MAX_INVENTORY_SLOTS);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.code, 'offer_full');
  assert.equal(askOverflow.ok, false);
  assert.equal(askOverflow.code, 'ask_full');
  assert.equal(getTradeOffer(state).length, MAX_INVENTORY_SLOTS);
  assert.equal(getTradeNpcOffer(state).length, MAX_INVENTORY_SLOTS);

  clearTradeOffers(state);
  assert.equal(getTradeOffer(state).length, 0);
  assert.equal(getTradeNpcOffer(state).length, 0);
});
