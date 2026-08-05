import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { chernobogDocketGateItems, isChernobogDocketItem } from '../src/data/chernobog_docket';

test('chernobogDocketGateItems returns expected items', () => {
  const items = chernobogDocketGateItems();
  assert.deepEqual(items, [
    { defId: 'chernobog_cell_map', count: 1 },
    { defId: 'chernobog_witness_correction', count: 1 },
  ]);
});

test('isChernobogDocketItem correctly identifies valid and invalid items', () => {
  assert.equal(isChernobogDocketItem('chernobog_cell_map'), true);
  assert.equal(isChernobogDocketItem('chernobog_witness_correction'), true);
  assert.equal(isChernobogDocketItem('invalid_item_id'), false);
  assert.equal(isChernobogDocketItem(undefined), false);
});
