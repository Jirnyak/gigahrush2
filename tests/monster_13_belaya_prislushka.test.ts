import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import '../src/gen/living/content_manifest';
import {
  BELAYA_PRISLUSHKA_QUEST_IDS,
  BELAYA_PRISLUSHKA_ZONE_HUD,
} from '../src/gen/living/belaya_prislushka';
import { FloorLevel, QuestType } from '../src/core/types';
import { getNpcPackageByPlotNpcId } from '../src/data/npc_packages';
import { SIDE_QUESTS } from '../src/data/plot';
import { getZoneContentRegistrySnapshot } from '../src/gen/living/zone_content';
import { publishEvent, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

test('Белая Прислушка registers one living-zone POI and the expected side quests', () => {
  const content = getZoneContentRegistrySnapshot().filter(entry => entry.label === 'Белая Прислушка');
  assert.equal(content.some(entry => entry.zoneHudId === BELAYA_PRISLUSHKA_ZONE_HUD), true);

  assert.ok(getNpcPackageByPlotNpcId('m13_anya_prislushka'), 'missing at-risk witness NPC package');
  assert.ok(getNpcPackageByPlotNpcId('m13_stepan_quiet_door'), 'missing source-clear NPC package');
  assert.ok(getNpcPackageByPlotNpcId('m13_ira_white_sample'), 'missing risky sample NPC package');
  assert.ok(getNpcPackageByPlotNpcId('m13_efim_quiet_act'), 'missing loss-branch NPC package');

  const rescue = SIDE_QUESTS.find(q => q.id === BELAYA_PRISLUSHKA_QUEST_IDS.rescue);
  assert.equal(rescue?.type, QuestType.TALK);
  assert.equal(rescue?.timeLimitMinutes, 30);
  assert.equal(rescue?.targetFloor, FloorLevel.LIVING);
  assert.equal(rescue?.eventTags?.includes('compulsion'), true);

  const clear = SIDE_QUESTS.find(q => q.id === BELAYA_PRISLUSHKA_QUEST_IDS.sourceCleared);
  assert.equal(clear?.targetItem, 'sealant_tube');
  assert.equal(clear?.eventTags?.includes('source_cleared'), true);

  const sample = SIDE_QUESTS.find(q => q.id === BELAYA_PRISLUSHKA_QUEST_IDS.sampled);
  assert.equal(sample?.targetItem, 'slime_sample_white');
  assert.equal(sample?.spawnMonstersOnAccept, 1);

  const lost = SIDE_QUESTS.find(q => q.id === BELAYA_PRISLUSHKA_QUEST_IDS.lost);
  assert.equal(lost?.targetItem, 'voluntary_receipt');
  assert.equal(lost?.spawnMonstersOnAccept, 1);
  assert.ok((lost?.relationDelta ?? 0) < 0);
});

test('Белая Прислушка publishes compact outcome events for quest completion and failure', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  publishEvent(state, {
    type: 'quest_completed',
    floor: FloorLevel.LIVING,
    targetName: 'rescue source event',
    severity: 4,
    privacy: 'local',
    tags: ['quest', 'completed'],
    data: { sideQuestId: BELAYA_PRISLUSHKA_QUEST_IDS.rescue },
  });
  publishEvent(state, {
    type: 'quest_failed',
    floor: FloorLevel.LIVING,
    targetName: 'failed rescue source event',
    severity: 3,
    privacy: 'local',
    tags: ['quest', 'failed', 'deadline'],
    data: { sideQuestId: BELAYA_PRISLUSHKA_QUEST_IDS.rescue },
  });

  const rescued = getRecentEvents(state, { tags: ['belaya_prislushka_outcome', 'rescued'], limit: 1 })[0];
  assert.equal(rescued?.data?.outcome, 'rescued');

  const lost = getRecentEvents(state, { tags: ['belaya_prislushka_outcome', 'lost'], limit: 1 })[0];
  assert.equal(lost?.data?.outcome, 'lost');
});
