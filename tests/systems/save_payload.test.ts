import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSavePayload, type SavePayload, SAVE_PLAYER_INVENTORY_CAP, SAVE_QUEST_CAP, SAVE_CONTAINER_CAP } from '../../src/systems/save_payload';
import { PRODUCTION_SAVE_STATE_CAP } from '../../src/systems/production';

function makeMockPayload(overrides: any = {}): SavePayload {
  return {
    player: {
      x: 0,
      y: 0,
      angle: 0,
      inventory: [],
      ...overrides.player,
    },
    state: {
      time: 0,
      tick: 0,
      clock: { hour: 8, minute: 0, totalMinutes: 0 },
      samosborActive: false,
      samosborCount: 0,
      samosborTimer: 0,
      quests: [],
      nextQuestId: 1,
      currentFloor: 1,
      floorRun: {},
      floorInstances: {},
      liftArachna: {},
      pseudolift: {},
      floorMemory: {},
      alife: {},
      alifeMobility: {},
      mapEditorPatches: {},
      worldEvents: {},
      crafting: {},
      economy: {},
      banking: {},
      stockMarket: {},
      production: [],
      containers: [],
      netTerminalGen: {},
      ...overrides.state,
    },
  } as SavePayload;
}

test('summarizeSavePayload', async (t) => {
  await t.test('handles basic empty payload', () => {
    const payload = makeMockPayload();
    const summary = summarizeSavePayload(payload);

    assert.ok(summary);
    assert.equal(typeof summary.bytes, 'number');
    assert.ok(summary.bytes > 0);
    assert.equal(summary.serializedEntities, false);
    assert.equal(summary.liveEntityCount, undefined);

    const playerSection = summary.sections.find(s => s.label === 'player');
    assert.ok(playerSection);
    assert.equal(playerSection.count, 0);
    assert.equal(playerSection.cap, SAVE_PLAYER_INVENTORY_CAP);

    const questsSection = summary.sections.find(s => s.label === 'quests');
    assert.ok(questsSection);
    assert.equal(questsSection.count, 0);
    assert.equal(questsSection.cap, SAVE_QUEST_CAP);
  });

  await t.test('includes liveEntityCount if provided', () => {
    const payload = makeMockPayload();
    const summary = summarizeSavePayload(payload, { liveEntityCount: 42 });
    assert.equal(summary.liveEntityCount, 42);
  });

  await t.test('counts arrays correctly for production and containers', () => {
    const payload = makeMockPayload({
      state: {
        production: [{}, {}],
        containers: [{}, {}, {}],
      }
    });
    const summary = summarizeSavePayload(payload);

    const productionSection = summary.sections.find(s => s.label === 'production');
    assert.ok(productionSection);
    assert.equal(productionSection.count, 2);
    assert.equal(productionSection.cap, PRODUCTION_SAVE_STATE_CAP);

    const containersSection = summary.sections.find(s => s.label === 'containers');
    assert.ok(containersSection);
    assert.equal(containersSection.count, 3);
    assert.equal(containersSection.cap, SAVE_CONTAINER_CAP);
  });

  await t.test('counts mapEditorPatches correctly', () => {
    const payload = makeMockPayload({
      state: {
        mapEditorPatches: {
          patches: {
            'map1': { ops: [1, 2, 3] },
            'map2': { ops: [4, 5] },
            'map3': { noOpsHere: true }
          }
        }
      }
    });
    const summary = summarizeSavePayload(payload);

    const mapEditorSection = summary.sections.find(s => s.label === 'mapEditor');
    assert.ok(mapEditorSection);
    assert.equal(mapEditorSection.count, 5);
  });

  await t.test('counts worldEvents correctly', () => {
    const payload = makeMockPayload({
      state: {
        worldEvents: {
          recentEvents: { count: 3 },
          importantEvents: { count: 2 },
          facts: ['fact1', 'fact2', 'fact3', 'fact4']
        }
      }
    });
    const summary = summarizeSavePayload(payload);

    const eventsSection = summary.sections.find(s => s.label === 'events');
    assert.ok(eventsSection);
    assert.equal(eventsSection.count, 9); // 3 + 2 + 4
  });

  await t.test('handles undefined worldEvents and mapEditorPatches gracefully', () => {
    const payload = makeMockPayload({
      state: {
        worldEvents: undefined,
        mapEditorPatches: undefined
      }
    });
    const summary = summarizeSavePayload(payload);

    const eventsSection = summary.sections.find(s => s.label === 'events');
    assert.ok(eventsSection);
    assert.equal(eventsSection.count, undefined);

    const mapEditorSection = summary.sections.find(s => s.label === 'mapEditor');
    assert.ok(mapEditorSection);
    assert.equal(mapEditorSection.count, undefined);
  });

  await t.test('handles missing array fields gracefully (undefined array lengths)', () => {
     const payload = makeMockPayload({
        player: { inventory: undefined },
        state: { quests: { length: undefined }, production: { length: undefined }, containers: { length: undefined } }
     });
     const summary = summarizeSavePayload(payload);

     const playerSection = summary.sections.find(s => s.label === 'player');
     assert.ok(playerSection);
     assert.equal(playerSection.count, undefined);
  });
});
