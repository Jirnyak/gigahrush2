import test from 'node:test';
import assert from 'node:assert/strict';
import { demosSocialVisitIntent, DEMOS_SOCIAL_VISIT_INTENTS, type DemosSocialVisitReason } from '../src/data/demos_social_visits';

test('demosSocialVisitIntent returns correct intent for all defined reasons', () => {
  for (const intent of DEMOS_SOCIAL_VISIT_INTENTS) {
    const returnedIntent = demosSocialVisitIntent(intent.id);
    assert.strictEqual(returnedIntent, intent, `Should return correct intent for ${intent.id}`);
  }
});

test('demosSocialVisitIntent returns default intent for invalid or unknown reasons', () => {
  // TypeScript will complain if we pass an invalid string directly,
  // but at runtime it could happen.
  const invalidReason = 'some_invalid_reason' as DemosSocialVisitReason;
  const returnedIntent = demosSocialVisitIntent(invalidReason);
  assert.strictEqual(returnedIntent, DEMOS_SOCIAL_VISIT_INTENTS[0], 'Should fallback to the first intent');
});
