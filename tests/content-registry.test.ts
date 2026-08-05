import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import '../src/gen/living/content_manifest';
import '../src/gen/living/side_quests';
import '../src/gen/ministry/content_manifest';
import '../src/gen/kvartiry/content_manifest';
import '../src/gen/maintenance/content_manifest';
import '../src/gen/hell/content_manifest';
import '../src/gen/void/content_manifest';
import '../src/gen/design_floors/manifest';

import { FloorLevel, MonsterKind, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { CONTRACTS } from '../src/data/contracts';
import { FACTORIES } from '../src/data/factories';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import {
  PLOT_CHAIN,
  SIDE_QUESTS,
  allPlotNpcIds,
  getSideQuestRegistrySnapshot,
  hasPlotNpc,
  type PlotStep,
} from '../src/data/plot';
import { PLOT_ROOMS } from '../src/data/plot_rooms';
import { RESOURCES } from '../src/data/resources';
import { RUMORS, type RumorDef, type RumorReveal } from '../src/data/rumors';
import { SCREEN_SIGNAL_DEFS } from '../src/data/screen_signals';
import { MONSTERS } from '../src/entities/monster';
import { getZoneContentRegistrySnapshot } from '../src/gen/living/zone_content';

const ITEM_IDS = new Set([...Object.keys(ITEMS), 'money']);
const MONSTER_IDS = new Set(Object.keys(MONSTERS).map(Number));
const ROOM_TYPE_IDS = new Set(Object.values(RoomType).filter(v => typeof v === 'number'));
const FLOOR_LEVEL_IDS = new Set(Object.values(FloorLevel).filter(v => typeof v === 'number'));
const RESOURCE_IDS = new Set(RESOURCES.map(r => r.id));
const RUMORS_BY_ID = new Map(RUMORS.map(r => [r.id, r]));
const ZERO_WEIGHT_MONSTERS = new Set<MonsterKind>([
  MonsterKind.CREATOR,
  MonsterKind.PSEUDOLIFT,
]);

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assert.equal(seen.has(value), false, `${label} duplicate: ${value}`);
    seen.add(value);
  }
}

function assertTrimmedText(value: string, label: string): void {
  assert.equal(value.trim().length > 0, true, `${label} is missing`);
  assert.equal(value, value.trim(), `${label} must be trimmed`);
}

function assertItem(id: string | undefined, scope: string): void {
  if (!id) return;
  assert.equal(ITEM_IDS.has(id), true, `${scope} references missing item "${id}"`);
}

function assertMonster(kind: number | undefined, scope: string): void {
  if (kind === undefined) return;
  assert.equal(MONSTER_IDS.has(kind), true, `${scope} references missing monster kind ${kind}`);
}

function assertContractTarget(contract: { target?: { floor?: number; roomType?: number; hint?: string } }, scope: string): void {
  assert.ok(contract.target, `${scope} is missing target metadata`);
  const floor = contract.target.floor;
  assert.equal(floor !== undefined && FLOOR_LEVEL_IDS.has(floor), true, `${scope}.target references missing floor ${floor}`);
  if (contract.target.roomType !== undefined) {
    assert.equal(ROOM_TYPE_IDS.has(contract.target.roomType), true, `${scope}.target references missing room type ${contract.target.roomType}`);
  }
  assert.equal((contract.target.hint ?? '').trim().length > 0, true, `${scope}.target is missing player hint`);
}

function rumorReveals(reveals: RumorDef['reveals']): readonly RumorReveal[] {
  if (!reveals) return [];
  return Array.isArray(reveals) ? reveals : [reveals as RumorReveal];
}

function assertPlotStep(step: PlotStep, scope: string): void {
  assert.equal(hasPlotNpc(step.giverNpcId), true, `${scope} has missing giverNpcId "${step.giverNpcId}"`);
  if (step.targetNpcId) {
    assert.equal(hasPlotNpc(step.targetNpcId), true, `${scope} has missing targetNpcId "${step.targetNpcId}"`);
  }
  if (step.targetPlotNpcId) {
    assert.equal(hasPlotNpc(step.targetPlotNpcId), true, `${scope} has missing targetPlotNpcId "${step.targetPlotNpcId}"`);
  }
  assertItem(step.targetItem, `${scope}.targetItem`);
  assertItem(step.rewardItem, `${scope}.rewardItem`);
  for (const reward of step.extraRewards ?? []) assertItem(reward.defId, `${scope}.extraRewards`);
  assertMonster(step.targetMonsterKind, `${scope}.targetMonsterKind`);
  if (step.targetRoomType !== undefined) {
    assert.equal(ROOM_TYPE_IDS.has(step.targetRoomType), true, `${scope} references missing room type ${step.targetRoomType}`);
  }
}

test('Living zone content labels are visible and unique after manifest import', () => {
  const entries = getZoneContentRegistrySnapshot();
  assert.ok(entries.length > 0, 'LIVING content manifest did not register zone content');

  for (const entry of entries) {
    assert.equal(Number.isInteger(entry.zoneHudId) && entry.zoneHudId > 0, true, `LIVING zone content "${entry.label}" has invalid zone HUD id`);
    assertTrimmedText(entry.label, `LIVING zone content #${entry.zoneHudId} label`);
  }

  assertUnique(entries.map(entry => String(entry.zoneHudId)), 'LIVING zone content zone HUD id');
  assertUnique(entries.map(entry => entry.label), 'LIVING zone content label');
});

test('side quest registry snapshot exposes unique ids after floor manifests import', () => {
  const entries = getSideQuestRegistrySnapshot();
  assert.equal(entries.length, SIDE_QUESTS.length, 'side quest snapshot must cover the live registry');
  assert.ok(entries.length > 0, 'content manifests did not register side quests');

  for (const entry of entries) {
    assertTrimmedText(entry.id, `SIDE_QUESTS.${entry.id}.id`);
    assertTrimmedText(entry.giverNpcId, `SIDE_QUESTS.${entry.id}.giverNpcId`);
  }

  assertUnique(entries.map(entry => entry.id), 'SIDE_QUESTS snapshot id');
});

test('registered content ids and plot NPC package ids are unique', () => {
  assertUnique(Object.keys(ITEMS), 'ITEMS');
  assertUnique(CONTRACTS.map(c => c.id), 'CONTRACTS');
  assertUnique(RESOURCES.map(r => r.id), 'RESOURCES');
  assertUnique(FACTORIES.map(f => f.id), 'FACTORIES');
  assertUnique(RUMORS.map(r => r.id), 'RUMORS');
  assertUnique(SIDE_QUESTS.map(q => q.id), 'SIDE_QUESTS');
  assertUnique(allPlotNpcIds(), 'plot NPC package ids');
});

test('plot chain and side quest references resolve through NPC packages', () => {
  PLOT_CHAIN.forEach((step, index) => assertPlotStep(step, `PLOT_CHAIN[${index}]`));
  SIDE_QUESTS.forEach(step => assertPlotStep(step, `SIDE_QUESTS.${step.id}`));
});

test('AG82 idol branches preserve the main Yakov item path', () => {
  const branchIds = [
    'idol_ministry_registration',
    'idol_liquidator_field_report',
    'idol_candle_concealment',
    'idol_counterfeit_decoy',
    'idol_hell_contact_handoff',
  ];

  for (const id of branchIds) {
    const quest = SIDE_QUESTS.find(q => q.id === id);
    assert.ok(quest, `missing AG82 side quest ${id}`);
    assert.equal(quest.requiresPlotStepDone !== undefined, true, `${id} must be gated by plot discovery`);
    assert.equal(quest.eventTags?.includes('idol_branch'), true, `${id} must publish idol branch tags`);
    assert.ok(quest.eventData?.rumorIds, `${id} must expose a rumor hook`);
    if (quest.targetItem === 'idol_chernobog') {
      assert.equal(quest.rewardItem, 'idol_chernobog', `${id} must return Yakov's required idol`);
      assert.equal(quest.eventData?.mainPlotItemReturned, true, `${id} must mark the idol as returned`);
    } else {
      assert.equal(quest.eventData?.mainPlotItemConsumed, false, `${id} must not consume Yakov's required idol`);
    }
  }
});

test('contracts, rumors, rooms, and variants reference existing ids', () => {
  for (const contract of CONTRACTS) {
    assertItem(contract.targetItem, `CONTRACTS.${contract.id}.targetItem`);
    assertItem(contract.rewardItem, `CONTRACTS.${contract.id}.rewardItem`);
    for (const reward of contract.extraRewards ?? []) assertItem(reward.defId, `CONTRACTS.${contract.id}.extraRewards`);
    assertMonster(contract.targetMonsterKind, `CONTRACTS.${contract.id}.targetMonsterKind`);
    if (contract.targetPlotNpcId) {
      assert.equal(hasPlotNpc(contract.targetPlotNpcId), true, `CONTRACTS.${contract.id}.targetPlotNpcId references missing plot NPC "${contract.targetPlotNpcId}"`);
    }
    if (contract.rewardResourceId) {
      assert.equal(RESOURCE_IDS.has(contract.rewardResourceId), true, `CONTRACTS.${contract.id}.rewardResourceId references missing resource "${contract.rewardResourceId}"`);
    }
    assertContractTarget(contract, `CONTRACTS.${contract.id}`);
  }

  for (const rumor of RUMORS) {
    for (const reveal of rumorReveals(rumor.reveals)) {
      if (reveal.kind === 'item') assertItem(reveal.itemId, `RUMORS.${rumor.id}.reveals.itemId`);
      if (reveal.kind === 'monster') assertMonster(reveal.monsterKind, `RUMORS.${rumor.id}.reveals.monsterKind`);
    }
    if (rumor.lead) {
      assertItem(rumor.lead.itemId, `RUMORS.${rumor.id}.lead.itemId`);
      assertMonster(rumor.lead.monsterKind, `RUMORS.${rumor.id}.lead.monsterKind`);
      if (rumor.lead.roomType !== undefined) {
        assert.equal(ROOM_TYPE_IDS.has(rumor.lead.roomType), true, `RUMORS.${rumor.id}.lead.roomType references missing room type ${rumor.lead.roomType}`);
      }
      if (rumor.lead.floor !== undefined) {
        assert.equal(FLOOR_LEVEL_IDS.has(rumor.lead.floor), true, `RUMORS.${rumor.id}.lead.floor references missing floor ${rumor.lead.floor}`);
      }
      assert.ok(rumor.lead.action.trim().length >= 12, `RUMORS.${rumor.id}.lead.action needs concrete player action`);
    }
  }

  for (const room of Object.values(PLOT_ROOMS)) {
    for (const plotNpcId of room.plotNpcs) {
      assert.equal(hasPlotNpc(plotNpcId), true, `PLOT_ROOMS.${room.id} references missing plot NPC "${plotNpcId}"`);
    }
  }

  for (const def of SCREEN_SIGNAL_DEFS) {
    assertTrimmedText(def.label, `SCREEN_SIGNAL_DEFS.${def.id}.label`);
    assert.ok(def.rumorIds.length > 0, `SCREEN_SIGNAL_DEFS.${def.id} needs at least one rumor hook`);
    let hasRoomLead = !def.roomTypes;
    for (const rumorId of def.rumorIds) {
      const rumor = RUMORS_BY_ID.get(rumorId);
      assert.ok(rumor, `SCREEN_SIGNAL_DEFS.${def.id} references missing rumor "${rumorId}"`);
      assert.equal(
        rumor.floors.some(floor => def.floors.includes(floor)),
        true,
        `SCREEN_SIGNAL_DEFS.${def.id} rumor "${rumorId}" has no valid floor overlap`,
      );
      if (rumor.lead?.roomType !== undefined && def.roomTypes?.includes(rumor.lead.roomType)) hasRoomLead = true;
    }
    assert.equal(hasRoomLead, true, `SCREEN_SIGNAL_DEFS.${def.id} needs a rumor lead matching one of its screen room types`);
  }
  assertUnique(SCREEN_SIGNAL_DEFS.map(def => def.label), 'SCREEN_SIGNAL_DEFS label');
});

test('monster ecology covers every registered monster and resolves tactical references', () => {
  const ecologyKinds = new Set<MonsterKind>();

  for (const def of MONSTER_ECOLOGY) {
    const scope = `MONSTER_ECOLOGY.${MonsterKind[def.kind]}`;
    assertMonster(def.kind, `${scope}.kind`);
    assert.equal(ecologyKinds.has(def.kind), false, `${scope} duplicate ecology entry`);
    ecologyKinds.add(def.kind);
    assert.ok(def.floors.length > 0, `${scope} needs at least one floor`);
    assert.ok(def.rooms.length > 0, `${scope} needs at least one room type`);
    if (ZERO_WEIGHT_MONSTERS.has(def.kind)) {
      assert.equal(def.spawnWeight, 0, `${scope} must stay data-disabled for generic spawning`);
    } else {
      assert.ok(def.spawnWeight > 0, `${scope} needs positive spawnWeight`);
    }
    assert.ok(def.counterplay.trim().length >= 32, `${scope} needs concrete counterplay`);
    assert.ok(def.lootHint.trim().length >= 8, `${scope} needs lootHint`);
    assert.ok(def.rumorIds.length > 0, `${scope} needs at least one rumor`);

    const rumorFloors = new Set<FloorLevel>();
    for (const rumorId of def.rumorIds) {
      const rumor = RUMORS_BY_ID.get(rumorId);
      assert.ok(rumor, `${scope} references missing rumor "${rumorId}"`);
      assert.equal(rumor.topic, 'monster', `${scope} rumor "${rumorId}" must be a monster rumor`);
      const monsterReveals = rumorReveals(rumor.reveals).filter(reveal => reveal.kind === 'monster');
      assert.ok(monsterReveals.length > 0, `${scope} rumor "${rumorId}" must reveal monster context`);
      assert.equal(
        monsterReveals.some(reveal => reveal.monsterKind === def.kind),
        true,
        `${scope} rumor "${rumorId}" reveals the wrong monster`,
      );
      for (const floor of rumor.floors) rumorFloors.add(floor);
    }
    for (const floor of def.floors) {
      assert.equal(rumorFloors.has(floor), true, `${scope} has no rumor coverage on floor ${FloorLevel[floor]}`);
    }

    for (const drop of def.rareDrops) {
      assertItem(drop.itemId, `${scope}.rareDrops`);
      assert.ok(drop.chance > 0 && drop.chance <= 1, `${scope} rare drop "${drop.itemId}" has invalid chance`);
      if (drop.count !== undefined) assert.ok(drop.count > 0, `${scope} rare drop "${drop.itemId}" has invalid count`);
    }
  }

  assert.equal(MONSTER_ECOLOGY.length, MONSTER_IDS.size, 'MONSTER_ECOLOGY must stay 1:1 with MONSTERS');
  for (const kind of Object.keys(MONSTERS).map(Number) as MonsterKind[]) {
    assert.equal(ecologyKinds.has(kind), true, `MONSTERS.${MonsterKind[kind]} is missing ecology data`);
  }
});
