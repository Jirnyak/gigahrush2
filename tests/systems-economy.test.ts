import assert from 'node:assert/strict';
import test from 'node:test';
import { getEconomyQuote } from '../src/systems/economy';
import { makeGameState } from './helpers';
import { Faction, Occupation } from '../src/core/types';

test('getEconomyQuote returns default response for unknown item', () => {
  const state = makeGameState();
  const quote = getEconomyQuote(state, 'unknown_item_id_that_does_not_exist');

  assert.equal(quote.basePrice, 0);
  assert.equal(quote.scarcityMultiplier, 1);
  assert.equal(quote.demandMultiplier, 1);
  assert.equal(quote.tariffMultiplier, 1);
  assert.equal(quote.buyPrice, 0);
  assert.equal(quote.sellPrice, 0);
  assert.deepEqual(quote.tags, ['unknown_item']);
  assert.equal(quote.reason, 'unknown_item');
});

test('getEconomyQuote calculates correct prices considering item value, demand, tariff and spread', () => {
  const state = makeGameState();

  // Test item with base value 10
  const quoteCanned = getEconomyQuote(state, 'canned');

  assert.equal(quoteCanned.basePrice, 10);
  assert.equal(quoteCanned.buyPrice, 13);
  assert.equal(quoteCanned.sellPrice, 9);
  assert.equal(quoteCanned.scarcityMultiplier, 1);
  assert.equal(typeof quoteCanned.demandMultiplier, 'number');
  assert.equal(typeof quoteCanned.tariffMultiplier, 'number');
  assert.ok(quoteCanned.tags.includes('economy'));
  assert.ok(typeof quoteCanned.reason === 'string');
});

test('getEconomyQuote applies additional tariff multiplier via options', () => {
  const state = makeGameState();
  const baseQuote = getEconomyQuote(state, 'canned');

  const opts = { tariffMultiplier: 2.0 };
  const quoteCanned = getEconomyQuote(state, 'canned', opts);

  assert.equal(quoteCanned.basePrice, 10);
  assert.equal(quoteCanned.tariffMultiplier, baseQuote.tariffMultiplier * 2.0);
  assert.ok(quoteCanned.buyPrice > baseQuote.buyPrice);
  assert.ok(quoteCanned.sellPrice > baseQuote.sellPrice);
  assert.ok(quoteCanned.tags.includes('tariff_modifier'));
});

test('getEconomyQuote returns prices based on provided floor', () => {
  const state = makeGameState();

  const quoteFloor0 = getEconomyQuote(state, 'canned', { floor: 0 });
  const quoteFloor50 = getEconomyQuote(state, 'canned', { floor: 50 });

  assert.ok(typeof quoteFloor0.buyPrice === 'number');
  assert.ok(typeof quoteFloor50.buyPrice === 'number');
});

test('getEconomyQuote uses trader properties for spread', () => {
  const state = makeGameState();

  // Normal quote
  const quoteNormal = getEconomyQuote(state, 'canned');

  // Trader quote using opts.traderFaction / opts.traderOccupation
  // Some factions/occupations might change the spread, we just test that we can pass them.
  const quoteTrader = getEconomyQuote(state, 'canned', {
    traderFaction: Faction.GIGAKHRUSHCHEVKA,
    traderOccupation: Occupation.STOREKEEPER
  });

  assert.ok(typeof quoteTrader.buyPrice === 'number');
  assert.ok(typeof quoteTrader.sellPrice === 'number');
});

test('getEconomyQuote processes price_pressure_cap if raw multiplier exceeds cap', () => {
  const state = makeGameState();
  // By passing an extremely high tariffMultiplier, we trigger the price pressure cap.
  const quote = getEconomyQuote(state, 'canned', { tariffMultiplier: 1000.0 });

  assert.ok(quote.tags.includes('price_cap'));
  // quoteReason will truncate but includes 'price_pressure_cap' at the start
  assert.ok(quote.reason.startsWith('price_pressure_cap'));
});

test('getEconomyQuote adds custom tags and reasons', () => {
  const state = makeGameState();
  const quote = getEconomyQuote(state, 'canned', { tags: ['custom_tag'], reason: 'custom_reason' });

  assert.ok(quote.tags.includes('custom_tag'));
  // Note: custom reason is only appended if tariffMultiplier is NOT provided, as per implementation:
  // if (opts.reason && opts.tariffMultiplier === undefined) reasons.push(opts.reason);
  assert.ok(quote.reason.includes('custom_reason'));
});
