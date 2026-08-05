import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind, type GameState } from '../src/core/types';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import {
  buyShares,
  ensureStockMarketState,
  normalizeStockMarketState,
  portfolioValue,
  sellShares,
  stockMarketForSave,
  stockMarketSnapshot,
  tickStockMarket,
  type StockMarketState,
} from '../src/systems/stock_market';
import { makeGameState } from './helpers';

type MarketTestState = GameState & {
  banking?: { accountRubles: number };
  stockMarket?: StockMarketState;
};

test('stock market state normalizes from empty save', () => {
  const normalized = normalizeStockMarketState(undefined);
  assert.ok(Object.keys(normalized.quotes).length >= 10);
  assert.equal(normalized.lastEventId, 0);
  assert.equal(normalized.recentTrades.length, 0);
  assert.equal(normalized.quotes.toha_heavy_industries.price, 180);
});

test('buying shares debits banking account and records portfolio/event', () => {
  const state = makeMarketState(1000);
  const result = buyShares(state, 'toha_heavy_industries', 3);

  assert.equal(result.ok, true);
  assert.equal(state.banking?.accountRubles, 450.24);
  assert.equal(state.stockMarket?.portfolio.toha_heavy_industries.shares, 3);
  assert.equal(state.stockMarket?.portfolio.toha_heavy_industries.avgPrice, 183.25);

  const event = getRecentEvents(state, { tags: ['buy_shares'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.tags.includes('stock_market'), true);
  assert.equal(event.tags.includes('corp_toha_heavy_industries'), true);
});

test('buying refuses fractional shares and insufficient account balance', () => {
  const state = makeMarketState(100);
  assert.equal(buyShares(state, 'toha_heavy_industries', 1.5).reason, 'invalid_shares');
  assert.equal(buyShares(state, 'toha_heavy_industries', 1).reason, 'insufficient_funds');
  assert.equal(state.banking?.accountRubles, 100);
});

test('selling shares credits banking account and reduces portfolio', () => {
  const state = makeMarketState(1000);
  assert.equal(buyShares(state, 'toha_heavy_industries', 3).ok, true);
  const before = state.banking?.accountRubles ?? 0;
  const sold = sellShares(state, 'toha_heavy_industries', 2);

  assert.equal(sold.ok, true);
  assert.equal(state.stockMarket?.portfolio.toha_heavy_industries.shares, 1);
  assert.equal(state.banking?.accountRubles, 803.79);
  assert.ok((state.banking?.accountRubles ?? 0) > before);
  assert.equal(sellShares(state, 'toha_heavy_industries', 2).reason, 'insufficient_shares');

  const event = getRecentEvents(state, { tags: ['sell_shares'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.tags.includes('stock_market'), true);
});

test('portfolio value and save snapshot stay compact', () => {
  const state = makeMarketState(1000);
  assert.equal(buyShares(state, 'toha_heavy_industries', 2).ok, true);
  assert.equal(portfolioValue(state), 360);

  const saved = stockMarketForSave(state);
  assert.equal(saved.portfolio.toha_heavy_industries.shares, 2);
  assert.ok(saved.recentTrades.length <= 24);

  const snapshot = stockMarketSnapshot(state);
  assert.equal(snapshot.portfolioValue, 360);
  assert.equal(snapshot.quotes.find(q => q.corpId === 'toha_heavy_industries')?.shares, 2);
});

test('random stock tick changes quotes within bounds', () => {
  const state = makeMarketState(0);
  const market = ensureStockMarketState(state);
  const before = Object.fromEntries(Object.entries(market.quotes).map(([id, quote]) => [id, quote.price]));

  state.time = 120;
  state.tick = 120;
  tickStockMarket(state);

  const changed = Object.entries(market.quotes).filter(([id, quote]) => quote.price !== before[id]);
  assert.ok(changed.length > 0);
  for (const [, quote] of Object.entries(market.quotes)) {
    assert.ok(quote.price >= 1 && quote.price <= 99999);
    assert.ok(Math.abs(quote.lastDelta) <= quote.price * 0.08);
  }
});

test('production event raises related factory corporation quote', () => {
  const state = makeMarketState(0);
  const market = ensureStockMarketState(state);
  const before = market.quotes.zavod_serp_i_beton.price;

  publishEvent(state, {
    type: 'room_produced_items',
    severity: 3,
    privacy: 'local',
    tags: ['production', 'output', 'metal_shop'],
    data: { recipeId: 'cut_pipe' },
  });
  tickStockMarket(state);

  assert.ok(market.quotes.zavod_serp_i_beton.price > before);
  assert.equal(market.lastEventId, 1);
});

test('industrial monster kill and slime science events move matching corporations', () => {
  const state = makeMarketState(0);
  const market = ensureStockMarketState(state);
  const heavyBefore = market.quotes.toha_heavy_industries.price;
  const scienceBefore = market.quotes.nii_slizi_i_biologii.price;

  publishEvent(state, {
    type: 'player_kill_monster',
    monsterKind: MonsterKind.REBAR,
    severity: 4,
    privacy: 'witnessed',
    tags: ['combat'],
  });
  publishEvent(state, {
    type: 'player_handoff_item',
    severity: 3,
    privacy: 'local',
    tags: ['slime', 'sample', 'science', 'nii'],
    itemId: 'slime_sample_brown',
  });
  tickStockMarket(state);

  assert.ok(market.quotes.toha_heavy_industries.price > heavyBefore);
  assert.ok(market.quotes.nii_slizi_i_biologii.price > scienceBefore);
});

function makeMarketState(accountRubles: number): MarketTestState {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  }) as MarketTestState;
  state.banking = { accountRubles };
  state.stockMarket = normalizeStockMarketState(undefined);
  return state;
}
