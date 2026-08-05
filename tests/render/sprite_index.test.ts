import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { authoredNpcSpriteGeneratorOffset, isAuthoredNpcSpr, Spr } from '../../src/render/sprite_index';

describe('Sprite Index Utilities', () => {
  describe('authoredNpcSpriteGeneratorOffset', () => {
    it('returns 0 for the base authored NPC sprite', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE), 0);
    });

    it('returns the correct offset for valid authored NPC sprites', () => {
      for (let i = 0; i < Spr.AUTHORED_NPC_COUNT; i++) {
        assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + i), i);
      }
    });

    it('returns -1 for sprites just below the base', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE - 1), -1);
    });

    it('returns -1 for sprites at or above the upper bound', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT), -1);
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT + 10), -1);
    });

    it('returns -1 for negative values', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(-1), -1);
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(-100), -1);
    });

    it('returns -1 for zero (assuming 0 is not the base)', () => {
      if (Spr.AUTHORED_NPC_BASE !== 0) {
        assert.strictEqual(authoredNpcSpriteGeneratorOffset(0), -1);
      }
    });

    it('truncates floating point values and returns correct offset if valid', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + 0.1), 0);
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + 0.99), 0);

      const middleOffset = Math.floor(Spr.AUTHORED_NPC_COUNT / 2);
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + middleOffset + 0.5), middleOffset);
    });

    it('truncates floating point values and returns -1 if out of bounds', () => {
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE - 0.1), -1);
      assert.strictEqual(authoredNpcSpriteGeneratorOffset(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT + 0.1), -1);
    });
  });

  describe('isAuthoredNpcSpr', () => {
    it('returns true for valid authored NPC sprites', () => {
      for (let i = 0; i < Spr.AUTHORED_NPC_COUNT; i++) {
        assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE + i), true);
      }
    });

    it('returns false for sprites just below the base', () => {
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE - 1), false);
    });

    it('returns false for sprites at or above the upper bound', () => {
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT), false);
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT + 10), false);
    });

    it('returns false for negative values', () => {
      assert.strictEqual(isAuthoredNpcSpr(-1), false);
    });

    it('returns false for zero (assuming 0 is not the base)', () => {
      if (Spr.AUTHORED_NPC_BASE !== 0) {
        assert.strictEqual(isAuthoredNpcSpr(0), false);
      }
    });

    it('correctly handles floating point values', () => {
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE + 0.5), true);
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE - 0.5), false);
      assert.strictEqual(isAuthoredNpcSpr(Spr.AUTHORED_NPC_BASE + Spr.AUTHORED_NPC_COUNT + 0.5), false);
    });
  });
});
