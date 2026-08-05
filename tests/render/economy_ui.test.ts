import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeCellPriceDisplay } from '../../src/render/economy_ui';
import { makeGameState } from '../helpers';
import { Entity } from '../../src/core/types';

test('tradeCellPriceDisplay falls back to default prices when getEconomyQuote throws', () => {
    const state = makeGameState();

    // We create a mock NPC with a getter that throws an error when getEconomyQuote
    // tries to access its faction (which happens inside spreadFor -> traderMatches).
    // This allows getAdjustedItemPrice (which calls getEconomyQuote without opts)
    // to succeed, but the subsequent getEconomyQuote call with the NPC will throw
    // and exercise the catch block.
    const npc = {
        get faction() {
            throw new Error('Simulated economy merging error');
        }
    } as unknown as Entity;

    // This should not throw, it should return the fallback display object
    const display = tradeCellPriceDisplay(state, npc, 'canned', 'buy');

    // The fallback uses getAdjustedItemPrice, so price should be formatted as text
    assert.ok(display.text !== undefined, 'Display text should be present');
    assert.equal(typeof display.text, 'string');
    assert.ok(display.color !== undefined);
    assert.ok(display.scarcityColor !== undefined);
});
