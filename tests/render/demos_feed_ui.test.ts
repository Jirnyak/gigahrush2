import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { drawDemosFeedPanel } from '../../src/render/demos_feed_ui';
import type { DemosFeedView } from '../../src/systems/demos_posts';

class CanvasStubContext {
  fillStyle: string = '';
  strokeStyle: string = '';
  textAlign: string = '';
  textBaseline: string = '';
  font: string = '';

  calls: any[] = [];

  measureText(text: string): { width: number } {
    return { width: text.length * 5 };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ type: 'fillRect', x, y, w, h, fillStyle: this.fillStyle });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ type: 'strokeRect', x, y, w, h, strokeStyle: this.strokeStyle });
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({ type: 'fillText', text, x, y, fillStyle: this.fillStyle, font: this.font });
  }
}

test('drawDemosFeedPanel rendering tests', async (t) => {
  await t.test('Renders empty feed correctly', () => {
    const ctx = new CanvasStubContext() as unknown as CanvasRenderingContext2D;
    const view: DemosFeedView = {
      posts: [],
      total: 0,
      capacity: 100,
      emptyLabel: 'No posts yet.',
    };

    drawDemosFeedPanel(ctx, view, 10, 10, 200, 300, 1, 1);

    const stub = ctx as unknown as CanvasStubContext;

    // Background
    assert.equal(stub.calls[0].type, 'fillRect');
    assert.equal(stub.calls[0].fillStyle, 'rgba(0,10,14,0.84)');

    // Outline
    assert.equal(stub.calls[1].type, 'strokeRect');

    // Title
    assert.equal(stub.calls[2].type, 'fillText');
    assert.equal(stub.calls[2].text, 'ЛЕНТА ДЕМОСА');

    // Pagination
    assert.equal(stub.calls[3].type, 'fillText');
    assert.equal(stub.calls[3].text, '0/100');

    // Empty label
    assert.equal(stub.calls[4].type, 'fillText');
    assert.equal(stub.calls[4].text, 'No posts yet.');
  });

  await t.test('Renders feed with posts correctly', () => {
    const ctx = new CanvasStubContext() as unknown as CanvasRenderingContext2D;
    const view: DemosFeedView = {
      posts: [
        {
          id: 1,
          authorAlifeId: 42,
          createdAt: 100,
          sourceEventId: 1000,
          text: 'Hello world',
          source: 'generated_markov',
          templateId: 'test_tpl',
          domainId: 'test',
          tags: ['test', 'hello'],
          fallbackUsed: false,
        }
      ],
      total: 1,
      capacity: 100,
      emptyLabel: 'No posts yet.',
    };

    drawDemosFeedPanel(ctx, view, 10, 10, 200, 300, 1, 1);

    const stub = ctx as unknown as CanvasStubContext;

    const postFillRect = stub.calls.find(c => c.type === 'fillRect' && c.fillStyle === 'rgba(2,18,22,0.74)');
    assert.ok(postFillRect, 'Post background should be rendered');

    const postMetadata = stub.calls.find(c => c.type === 'fillText' && c.text.includes('post:1'));
    assert.ok(postMetadata, 'Post metadata should be rendered');

    const tagText = stub.calls.find(c => c.type === 'fillText' && c.text === 'test');
    assert.ok(tagText, 'Tag text should be rendered');

    const postText = stub.calls.find(c => c.type === 'fillText' && c.text === 'Hello world');
    assert.ok(postText, 'Post text should be rendered');
  });

  await t.test('Handles scrolling properly', () => {
    const ctx = new CanvasStubContext() as unknown as CanvasRenderingContext2D;
    const view: DemosFeedView = {
      posts: [
        {
          id: 1,
          authorAlifeId: 42,
          createdAt: 100,
          sourceEventId: 1000,
          text: 'Hello world',
          source: 'generated_markov',
          templateId: 'test_tpl',
          domainId: 'test',
          tags: ['test', 'hello'],
          fallbackUsed: false,
        }
      ],
      total: 1,
      capacity: 100,
      emptyLabel: 'No posts yet.',
    };

    drawDemosFeedPanel(ctx, view, 10, 10, 200, 300, 1, 1, { scroll: 100 });

    const stub = ctx as unknown as CanvasStubContext;

    // Since we scrolled a lot, the post should be above the rendering bounds
    // Wait, the logic is `if (rowY > bottom) break;` and `if (rowY + rowH >= y + 20 * sy) { render }`
    // If scroll = 100, `rowY = y + 23*sy - Math.max(0, scroll)*18*sy`.
    // It should skip rendering the post since it's scrolled out.
    const postFillRect = stub.calls.find(c => c.type === 'fillRect' && c.fillStyle === 'rgba(2,18,22,0.74)');
    assert.ok(!postFillRect, 'Post should be skipped due to scroll');
  });

  await t.test('Renders post with reactions correctly', () => {
    const ctx = new CanvasStubContext() as unknown as CanvasRenderingContext2D;
    const view: DemosFeedView = {
      posts: [
        {
          id: 1,
          authorAlifeId: 42,
          createdAt: 100,
          sourceEventId: 1000,
          text: 'Hello world',
          source: 'generated_markov',
          templateId: 'test_tpl',
          domainId: 'test',
          tags: ['test', 'hello'],
          fallbackUsed: false,
        }
      ],
      total: 1,
      capacity: 100,
      emptyLabel: 'No posts yet.',
    };

    const reactions = [
      {
        postId: 1,
        reactorAlifeId: 88,
        kind: 'like' as any,
        relation: 64,
        text: 'Cool post',
        source: 'generated_markov' as any,
        templateId: 'like_tpl',
        domainId: 'test',
        tags: ['reaction'],
        fallbackUsed: false,
      },
      {
        postId: 1,
        reactorAlifeId: 99,
        kind: 'dislike' as any,
        relation: -50,
        text: 'Bad post',
        source: 'generated_markov' as any,
        templateId: 'dislike_tpl',
        domainId: 'test',
        tags: ['reaction'],
        fallbackUsed: false,
      }
    ];

    drawDemosFeedPanel(ctx, view, 10, 10, 200, 300, 1, 1, {
      reactionsByPostId: { 1: reactions }
    });

    const stub = ctx as unknown as CanvasStubContext;

    // Check reaction text
    const posReaction = stub.calls.find(c => c.type === 'fillText' && c.text.includes('alife:88: Cool post'));
    assert.ok(posReaction, 'Positive reaction text should be rendered');
    assert.equal(posReaction.fillStyle, '#9dc');

    const negReaction = stub.calls.find(c => c.type === 'fillText' && c.text.includes('alife:99: Bad post'));
    assert.ok(negReaction, 'Negative reaction text should be rendered');
    assert.equal(negReaction.fillStyle, '#e99');
  });
});
