import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  EntityType,
  FloorLevel,
  MonsterKind,
  QuestType,
  Tex,
  type Quest,
} from '../src/core/types';
import { World } from '../src/core/world';
import { RUMORS } from '../src/data/rumors';
import { SIDE_QUESTS, sideQuestPrereqsMet } from '../src/data/plot';
import { initFactionRelations } from '../src/data/relations';
import { publishEvent, getRecentEvents } from '../src/systems/events';
import {
  generatePustoySosedRoom,
  PUSTOY_SOSED_REFLECTION_RUMOR_ID,
  PUSTOY_SOSED_QUEST_IDS,
  PUSTOY_SOSED_ROOM_NAME,
} from '../src/gen/kvartiry/pustoy_sosed';
import { makeGameState } from './helpers';

function doneSideQuest(sideQuestId: string): Quest {
  return {
    id: 1,
    type: QuestType.FETCH,
    giverId: 1,
    giverName: 'test',
    desc: 'test',
    sideQuestId,
    done: true,
  };
}

test('Pustoy Sosed registers verification, avoidance, and reveal quests', () => {
  const ids = new Set(SIDE_QUESTS.map(q => q.id));
  assert.equal(ids.has(PUSTOY_SOSED_QUEST_IDS.checkPapers), true);
  assert.equal(ids.has(PUSTOY_SOSED_QUEST_IDS.reportLiquidator), true);
  assert.equal(ids.has(PUSTOY_SOSED_QUEST_IDS.keepDistance), true);
  assert.equal(ids.has(PUSTOY_SOSED_QUEST_IDS.closeReveal), true);

  const check = SIDE_QUESTS.find(q => q.id === PUSTOY_SOSED_QUEST_IDS.checkPapers);
  assert.equal(check?.targetItem, 'fake_pass');
  assert.equal(check?.eventTags?.includes('false_neighbor'), true);
  assert.equal(check?.eventTags?.includes('witness'), true);
  assert.equal(check?.eventTags?.includes('expose_choice'), true);
  assert.equal(check?.blockedBySideQuestIds?.includes(PUSTOY_SOSED_QUEST_IDS.keepDistance), true);
  assert.equal(check?.abandonsSideQuestIds?.includes(PUSTOY_SOSED_QUEST_IDS.closeReveal), true);
  assert.equal((check?.eventData?.rumorIds as string[] | undefined)?.includes(PUSTOY_SOSED_REFLECTION_RUMOR_ID), true);

  const reveal = SIDE_QUESTS.find(q => q.id === PUSTOY_SOSED_QUEST_IDS.closeReveal);
  assert.equal(reveal?.targetMonsterKind, MonsterKind.NELYUD);
  assert.equal(reveal?.eventData?.failureCondition, 'close_distance_reveal');
  assert.equal(reveal?.eventTags?.includes('fight_choice'), true);
  assert.equal(reveal?.blockedBySideQuestIds?.includes(PUSTOY_SOSED_QUEST_IDS.checkPapers), true);

  const flee = SIDE_QUESTS.find(q => q.id === PUSTOY_SOSED_QUEST_IDS.keepDistance);
  assert.equal(flee?.eventTags?.includes('flee_choice'), true);
  assert.equal(flee?.abandonsSideQuestIds?.includes(PUSTOY_SOSED_QUEST_IDS.reportLiquidator), true);

  assert.equal(sideQuestPrereqsMet(check!, [doneSideQuest(PUSTOY_SOSED_QUEST_IDS.keepDistance)]), false);
  assert.equal(sideQuestPrereqsMet(reveal!, [doneSideQuest(PUSTOY_SOSED_QUEST_IDS.checkPapers)]), false);
  assert.equal(sideQuestPrereqsMet(flee!, [doneSideQuest(PUSTOY_SOSED_QUEST_IDS.closeReveal)]), false);

  const rumor = RUMORS.find(r => r.id === PUSTOY_SOSED_REFLECTION_RUMOR_ID);
  assert.equal(rumor?.lead?.roomName, PUSTOY_SOSED_ROOM_NAME);
  assert.equal(rumor?.lead?.itemId, 'fake_pass');
});

test('Pustoy Sosed room gives clues before NELYUD close reveal', () => {
  const world = new World();
  const entities = [];
  const nextId = { v: 1 };
  const nextRoomId = generatePustoySosedRoom(world, 0, entities, nextId, 512, 512);

  assert.equal(nextRoomId, 1);
  const witness = entities.find(e => e.plotNpcId === 'pustoy_sosed_liza_sverka');
  const suspect = entities.find(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.NELYUD && e.name === 'Пустой Сосед');
  assert.ok(witness);
  assert.ok(suspect);
  assert.ok(world.dist2(witness.x, witness.y, suspect.x, suspect.y) > 6 * 6);
  assert.equal(world.screenCells.some(idx => world.wallTex[idx] >= Tex.SCREEN_BASE), true);

  const drops = entities
    .filter(e => e.type === EntityType.ITEM_DROP)
    .flatMap(e => e.inventory ?? [])
    .map(item => item.defId);
  assert.equal(drops.includes('fake_pass'), true);
  assert.equal(drops.includes('neighbor_complaint'), true);
  assert.equal(drops.includes('inspection_mirror'), true);
});

test('Pustoy Sosed quest completion publishes compact outcome event data', () => {
  initFactionRelations();
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY });

  publishEvent(state, {
    type: 'quest_completed',
    severity: 4,
    privacy: 'witnessed',
    tags: ['quest', 'completed', 'monster', 'false_neighbor'],
    targetName: 'test completion',
    data: { sideQuestId: PUSTOY_SOSED_QUEST_IDS.checkPapers },
  });

  const outcome = getRecentEvents(state, { type: 'faction_relation_changed', tags: ['pustoy_sosed_outcome'], limit: 1 })[0];
  assert.equal(outcome?.floor, FloorLevel.KVARTIRY);
  assert.equal(outcome?.data?.outcome, 'exposed');
  assert.equal(outcome?.tags.includes('false_neighbor'), true);
  assert.equal(outcome?.tags.includes('infected'), true);
  initFactionRelations();
});
