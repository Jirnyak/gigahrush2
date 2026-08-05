import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  rememberRecentRumorLead,
  getRecentRumorLead,
} from '../src/systems/npc_memory';

test('rememberRecentRumorLead stores a rumor that can be retrieved before expiry', () => {
  // Clear any existing state just in case
  getRecentRumorLead(Infinity);

  const input = {
    rumorId: 'test-rumor-1',
    text: 'A test rumor',
    heardAt: 1000,
  };

  rememberRecentRumorLead(input);

  const retrieved = getRecentRumorLead(1000);
  assert.ok(retrieved);
  assert.equal(retrieved.rumorId, 'test-rumor-1');
  assert.equal(retrieved.text, 'A test rumor');
  assert.equal(retrieved.heardAt, 1000);
  assert.equal(retrieved.expiresAt, 1000 + 360);
});

test('getRecentRumorLead returns undefined if accessed after expiry and clears memory', () => {
  getRecentRumorLead(Infinity); // clear

  const input = {
    rumorId: 'test-rumor-2',
    text: 'Another test rumor',
    heardAt: 2000,
  };

  rememberRecentRumorLead(input);

  // Still active at heardAt + 360
  assert.ok(getRecentRumorLead(2360));

  // Expired at heardAt + 361
  const retrievedAfterExpiry = getRecentRumorLead(2361);
  assert.equal(retrievedAfterExpiry, undefined);

  // Subsequent calls should also return undefined as the memory is cleared
  assert.equal(getRecentRumorLead(1000), undefined);
});

test('getRecentRumorLead returns undefined initially when no rumor is set', () => {
  getRecentRumorLead(Infinity); // clear
  assert.equal(getRecentRumorLead(1000), undefined);
});
