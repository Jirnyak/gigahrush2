import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getNetHackTerminalDef, NET_HACK_TERMINALS } from '../src/data/net_hack';

test('getNetHackTerminalDef returns correct definitions for valid IDs', () => {
  const serviceGateDef = getNetHackTerminalDef('service_gate');
  assert.deepEqual(serviceGateDef, NET_HACK_TERMINALS['service_gate']);

  const archiveGateDef = getNetHackTerminalDef('archive_gate');
  assert.deepEqual(archiveGateDef, NET_HACK_TERMINALS['archive_gate']);
});

test('getNetHackTerminalDef returns undefined for invalid IDs', () => {
  const invalidDef = getNetHackTerminalDef('invalid_id');
  assert.equal(invalidDef, undefined);
});
