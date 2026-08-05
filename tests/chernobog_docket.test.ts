import test from 'node:test';
import assert from 'node:assert/strict';
import { chernobogDocketGateItems, isChernobogDocketItem } from '../src/data/chernobog_docket';

test('chernobogDocketGateItems returns expected gate items', () => {
  const items = chernobogDocketGateItems();
  assert.deepEqual(items, [
    { defId: 'chernobog_cell_map', count: 1 },
    { defId: 'chernobog_witness_correction', count: 1 },
  ]);
});

test('isChernobogDocketItem correctly identifies docket items', () => {
  // Test valid items
  assert.equal(isChernobogDocketItem('chernobog_cell_map'), true);
  assert.equal(isChernobogDocketItem('chernobog_witness_correction'), true);
  assert.equal(isChernobogDocketItem('chernobog_confiscation_act'), true);
  assert.equal(isChernobogDocketItem('chernobog_liquidator_memo'), true);
  assert.equal(isChernobogDocketItem('chernobog_redacted_central_note'), true);
  assert.equal(isChernobogDocketItem('chernobog_external_cell_index'), true);

  // Test invalid items
  assert.equal(isChernobogDocketItem('some_other_item'), false);
  assert.equal(isChernobogDocketItem(''), false);
  assert.equal(isChernobogDocketItem(undefined), false);
});
