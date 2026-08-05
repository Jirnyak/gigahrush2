import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import '../src/gen/kvartiry/content_manifest';
import { FloorLevel, MonsterKind, QuestType, RoomType } from '../src/core/types';
import { getNpcPackageByPlotNpcId } from '../src/data/npc_packages';
import { SIDE_QUESTS } from '../src/data/plot';
import {
  COMMUNAL_KITCHEN_FEUD_FINAL_BRANCH_IDS,
  COMMUNAL_KITCHEN_FEUD_QUEST_IDS,
} from '../src/gen/kvartiry/communal_kitchen_feud';
import { FALSE_NEIGHBOR_QUEST_ID, FALSE_NEIGHBOR_TAG } from '../src/gen/kvartiry/false_neighbor';
import { MEDICINE_SWAP_QUEST_IDS, MEDICINE_SWAP_TAG } from '../src/gen/kvartiry/medicine_swap';
import { PUSTOY_SOSED_QUEST_IDS } from '../src/gen/kvartiry/pustoy_sosed';
import { RATION_QUEUE_QUEST_IDS, RATION_QUEUE_TAG } from '../src/gen/kvartiry/ration_queue';
import { WATER_RIOT_QUEST_IDS, WATER_RIOT_TAG } from '../src/gen/kvartiry/water_riot';

type RegisteredSideQuest = typeof SIDE_QUESTS[number];

function sideQuest(id: string): RegisteredSideQuest {
  const quest = SIDE_QUESTS.find(q => q.id === id);
  assert.ok(quest, `missing side quest ${id}`);
  return quest;
}

function assertKvartiryRoute(quest: RegisteredSideQuest, roomType: RoomType, tag: string): void {
  assert.equal(quest.targetFloor, FloorLevel.KVARTIRY, `${quest.id} must point to Kvartiry`);
  assert.equal(quest.targetRoomType, roomType, `${quest.id} must mark a local room type`);
  assert.equal(quest.targetZoneTag, tag, `${quest.id} must resolve through a local trace tag`);
  assert.ok(quest.targetHint?.includes('Квартиры'), `${quest.id} needs a readable floor hint`);
}

function assertRumorTrace(quest: RegisteredSideQuest): void {
  const rumorIds = quest.eventData?.rumorIds;
  assert.equal(Array.isArray(rumorIds), true, `${quest.id} must publish rumor ids`);
  assert.ok((rumorIds as unknown[]).length > 0, `${quest.id} must publish at least one rumor id`);
}

test('communal kitchen feud registers five mutually resolving branches', () => {
  const ids = Object.values(COMMUNAL_KITCHEN_FEUD_QUEST_IDS);
  assert.deepEqual(ids, [...COMMUNAL_KITCHEN_FEUD_FINAL_BRANCH_IDS]);

  for (const id of ids) {
    const quest = SIDE_QUESTS.find(q => q.id === id);
    assert.ok(quest, `missing kitchen feud quest ${id}`);
    assert.equal(quest.type, QuestType.FETCH);
    assert.ok(getNpcPackageByPlotNpcId(quest.giverNpcId), `${id} has missing giver package`);
    assert.equal(quest.targetFloor, FloorLevel.KVARTIRY);
    assert.equal(quest.targetRoomType, RoomType.KITCHEN);
    assert.equal(quest.targetZoneTag, 'kitchen_feud');
    assert.ok(quest.targetHint?.includes('Квартиры'), `${id} needs a floor hint`);
    assert.equal(quest.eventTags?.includes('kitchen_feud'), true, `${id} needs kitchen event tag`);

    const blockers = COMMUNAL_KITCHEN_FEUD_FINAL_BRANCH_IDS.filter(qid => qid !== id);
    assert.deepEqual(quest.blockedBySideQuestIds, blockers);
    assert.deepEqual(quest.abandonsSideQuestIds, blockers);
  }
});

test('communal kitchen feud covers food, side, theft, expose, and liquidator outcomes', () => {
  const byId = new Map(SIDE_QUESTS.map(q => [q.id, q]));

  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.mediateFood)?.targetItem, 'kasha');
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.sideSanek)?.targetItem, 'cigs');
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey)?.targetItem, 'borrowed_kitchen_key');
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard)?.targetItem, 'forged_ration_card');
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators)?.targetItem, 'sealed_complaint');

  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.stealKey)?.eventTags?.includes('theft'), true);
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.exposeCard)?.eventTags?.includes('witness'), true);
  assert.equal(byId.get(COMMUNAL_KITCHEN_FEUD_QUEST_IDS.callLiquidators)?.eventTags?.includes('liquidator'), true);
});

test('Kvartiry social crisis route stays legible from ration to false-neighbor denunciation', () => {
  for (const id of Object.values(RATION_QUEUE_QUEST_IDS)) {
    const quest = sideQuest(id);
    assertKvartiryRoute(
      quest,
      RoomType.OFFICE,
      id === RATION_QUEUE_QUEST_IDS.audit ? 'ration_coupon_audit' : RATION_QUEUE_TAG,
    );
    assertRumorTrace(quest);
    assert.equal(quest.eventTags?.includes('ration_queue'), true, `${id} must tag the ration queue`);
  }

  for (const id of Object.values(WATER_RIOT_QUEST_IDS)) {
    const quest = sideQuest(id);
    assertKvartiryRoute(quest, RoomType.BATHROOM, WATER_RIOT_TAG);
    assertRumorTrace(quest);
    assert.equal(quest.eventTags?.includes('water'), true, `${id} must tag the water crisis`);
    const blockers = Object.values(WATER_RIOT_QUEST_IDS).filter(qid => qid !== id);
    assert.deepEqual(quest.blockedBySideQuestIds, blockers);
    assert.deepEqual(quest.abandonsSideQuestIds, blockers);
  }

  for (const id of Object.values(MEDICINE_SWAP_QUEST_IDS)) {
    const quest = sideQuest(id);
    assertKvartiryRoute(quest, RoomType.MEDICAL, 'medicine_trust');
    assertRumorTrace(quest);
    assert.equal(quest.targetRoomName, 'Аптечный разменник');
    assert.equal(quest.eventTags?.includes(MEDICINE_SWAP_TAG), true, `${id} must tag the medicine swap`);
  }

  const falseNeighbor = sideQuest(FALSE_NEIGHBOR_QUEST_ID);
  assertKvartiryRoute(falseNeighbor, RoomType.LIVING, FALSE_NEIGHBOR_TAG);
  assert.equal(falseNeighbor.targetMonsterKind, MonsterKind.NELYUD);
  assert.equal(falseNeighbor.eventTags?.includes('denunciation'), true);
  assert.equal(falseNeighbor.eventData?.localTrace, 'false_neighbor_denunciation_box');
  assertRumorTrace(falseNeighbor);

  const report = sideQuest(PUSTOY_SOSED_QUEST_IDS.reportLiquidator);
  assert.equal(report.type, QuestType.TALK);
  assert.equal(report.eventTags?.includes('denunciation'), true);
  assert.equal(report.eventData?.revealPrevented, true);
  assertRumorTrace(report);
});
