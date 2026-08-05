import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { getEconomyQuote, registerEconomyTariffProvider, invalidateEconomyPrices, type EconomyTariffProvider, ensureEconomyState } from '../src/systems/economy';
import { makeGameState } from './helpers';
import { FloorLevel } from '../src/core/types';

test('registerEconomyTariffProvider adds a new provider and overrides existing if ID matches', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  ensureEconomyState(state);

  const initialQuote = getEconomyQuote(state, 'water');
  const initialTariff = initialQuote.tariffMultiplier;

  const provider1: EconomyTariffProvider = {
    id: 'test_provider',
    quote(state, resourceId, floor) {
      if (resourceId === 'drink_water') {
        return { multiplier: 1.5, tags: ['test_tag_1'], reason: 'test_reason_1' };
      }
      return undefined;
    }
  };

  registerEconomyTariffProvider(provider1);
  invalidateEconomyPrices(state);

  const quote1 = getEconomyQuote(state, 'water');
  assert.ok(Math.abs(quote1.tariffMultiplier - (initialTariff * 1.5)) < 0.0001, `Quote1 was ${quote1.tariffMultiplier}, expected ${initialTariff * 1.5}`);
  assert.ok(quote1.tags.includes('test_tag_1'));
  assert.ok(quote1.reason?.includes('test_reason_1'));

  const provider2: EconomyTariffProvider = {
    id: 'test_provider',
    quote(state, resourceId, floor) {
      if (resourceId === 'drink_water') {
        return { multiplier: 2.0, tags: ['test_tag_2'], reason: 'test_reason_2' };
      }
      return undefined;
    }
  };

  registerEconomyTariffProvider(provider2);
  invalidateEconomyPrices(state);

  const quote2 = getEconomyQuote(state, 'water');
  assert.ok(Math.abs(quote2.tariffMultiplier - (initialTariff * 2.0)) < 0.0001, `Quote2 was ${quote2.tariffMultiplier}, expected ${initialTariff * 2.0}`);
  assert.ok(quote2.tags.includes('test_tag_2'));
  assert.ok(!quote2.tags.includes('test_tag_1'));
  assert.ok(quote2.reason?.includes('test_reason_2'));
  assert.ok(!quote2.reason?.includes('test_reason_1'));
});
