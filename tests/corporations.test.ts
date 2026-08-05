import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  CORPORATIONS,
  CORPORATION_BY_ID,
  CORPORATION_BY_TICKER,
  MAX_CORPORATION_BASE_PRICE,
  STOCK_SIGNALS,
} from '../src/data/corporations';
import { FACTORIES } from '../src/data/factories';
import { RESOURCES } from '../src/data/resources';

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assert.equal(seen.has(value), false, `${label} duplicate id: ${value}`);
    seen.add(value);
  }
}

test('corporation catalog validates and exposes lookup maps', () => {
  assert.ok(CORPORATIONS.length >= 10, 'catalog needs at least ten corporations');
  assertUnique(CORPORATIONS.map(def => def.id), 'corporation');
  assertUnique(CORPORATIONS.map(def => def.ticker), 'ticker');

  for (const def of CORPORATIONS) {
    assert.equal(CORPORATION_BY_ID[def.id], def, `${def.id} must resolve by id`);
    assert.equal(CORPORATION_BY_TICKER[def.ticker], def, `${def.ticker} must resolve by ticker`);
    assert.match(def.ticker, /^[A-Z]{2,5}$/, `${def.id} ticker must be uppercase ASCII`);
    assert.match(def.id, /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, `${def.id} must be lowercase snake case`);
    assert.ok(def.basePrice > 0 && def.basePrice <= MAX_CORPORATION_BASE_PRICE, `${def.id} base price must be bounded`);
    assert.ok(def.volatility > 0 && def.volatility <= 1, `${def.id} volatility must be bounded`);
  }
});

test('corporations reference existing economy resources and factories', () => {
  const resourceIds = new Set(RESOURCES.map(resource => resource.id));
  const factoryIds = new Set(FACTORIES.map(factory => factory.id));

  for (const def of CORPORATIONS) {
    assert.ok(def.resourceIds.length > 0, `${def.id} needs resource anchors`);
    assert.ok(def.factoryIds.length > 0, `${def.id} needs factory anchors`);
    for (const id of def.resourceIds) assert.equal(resourceIds.has(id), true, `${def.id} missing resource ${id}`);
    for (const id of def.factoryIds) assert.equal(factoryIds.has(id), true, `${def.id} missing factory ${id}`);
  }
});

test('required corporation taste hooks stay present', () => {
  const toha = CORPORATION_BY_ID.toha_heavy_industries;
  assert.ok(toha, 'TOHA Heavy Industries must exist');
  assert.equal(toha.name, 'ТОХА Heavy Industries');
  assert.equal(toha.resourceIds.includes('metal'), true);
  assert.equal(toha.resourceIds.includes('electronics'), true);
  assert.equal(toha.factoryIds.includes('metal_shop'), true);
  assert.equal(toha.positiveEventTags.includes('monster_robot'), true);
  assert.equal(toha.positiveEventTags.includes('monster_rebar'), true);

  const nii = CORPORATION_BY_ID.nii_slizi_i_biologii;
  assert.equal(nii.resourceIds.includes('slime_samples'), true);
  assert.equal(nii.positiveEventTags.includes('slime'), true);
  assert.equal(nii.positiveEventTags.includes('sample'), true);
  assert.equal(nii.positiveEventTags.includes('science'), true);

  const logistics = CORPORATION_BY_ID.krasnyy_koridor_logistics;
  assert.equal(logistics.positiveEventTags.includes('caravan'), true);
  assert.equal(logistics.negativeEventTags.includes('tax'), true);
  assert.equal(logistics.negativeEventTags.includes('tariff'), true);

  const net = CORPORATION_BY_ID.net_obmen_kontora;
  assert.equal(net.positiveEventTags.includes('net_sphere'), true);
  assert.equal(net.positiveEventTags.includes('online_exchange'), true);
});

test('stock signals are declarative and reference catalog corporations', () => {
  assert.ok(STOCK_SIGNALS.length >= CORPORATIONS.length, 'each corporation should have at least one stock signal seed');

  const idsWithSignals = new Set<string>();
  for (const signal of STOCK_SIGNALS) {
    assert.ok(CORPORATION_BY_ID[signal.corporationId], `signal references missing corporation ${signal.corporationId}`);
    assert.ok(signal.direction === 'positive' || signal.direction === 'negative', `${signal.corporationId} signal direction`);
    assert.ok(signal.weight > 0, `${signal.corporationId} signal weight`);
    assert.ok(signal.eventTags.length > 0, `${signal.corporationId} signal tags`);
    idsWithSignals.add(signal.corporationId);
  }

  for (const def of CORPORATIONS) {
    assert.equal(idsWithSignals.has(def.id), true, `${def.id} needs a stock signal seed`);
  }
});
