import { test } from 'node:test';
import assert from 'node:assert';
import { registerWorldEventObserver, unregisterWorldEventObserver, publishEvent, createWorldEventState } from './src/systems/events.ts';
import { makeGameState } from './tests/helpers.ts';

test('world event observer handles undefined console.warn without crashing', () => {
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const originalWarn = console.warn;
  console.warn = undefined as any;

  const throwing = (): void => {
    throw new Error('observer failed');
  };

  try {
    registerWorldEventObserver(throwing);

    publishEvent(state, {
      type: 'faction_event',
      severity: 3,
      privacy: 'public',
      tags: ['observer_test'],
    });
  } finally {
    unregisterWorldEventObserver(throwing);
    console.warn = originalWarn;
  }

  assert.ok(true);
});
