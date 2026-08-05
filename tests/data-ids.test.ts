import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Faction,
  FloorLevel,
  ItemType,
  MonsterKind,
  Occupation,
  QuestType,
  RoomType,
  ZoneFaction,
  type Item,
} from '../src/core/types';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { PHYS_WEAPON_ROLE_TIERS, PHYS_WEAPON_STATS } from '../src/data/weapons';
import { PSI_WEAPON_ROLE_TIERS, PSI_WEAPON_STATS } from '../src/data/psi';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { CONTRACTS } from '../src/data/contracts';
import { COMPUTER_DEFS } from '../src/data/computers';
import { FACTORIES } from '../src/data/factories';
import { FACTION_EVENT_DEFS } from '../src/data/faction_events';
import { EMERGENCY_PANEL_DEFS } from '../src/data/emergency_panels';
import { FLOOR_CATALOG } from '../src/data/floor_catalog';
import { FLOOR_INSTANCES } from '../src/data/floor_instances';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { NET_HACK_TERMINALS } from '../src/data/net_hack';
import { PERMIT_DEFS, PERMIT_FORGERY_RECIPES } from '../src/data/permits';
import {
  PLOT_CHAIN,
  SIDE_QUESTS,
  allPlotNpcEntries,
  allPlotNpcIds,
  hasPlotNpc,
  type PlotStep,
  type SideQuestStep,
} from '../src/data/plot';
import { FLOOR_GEOMETRIES } from '../src/data/procedural_floors';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { RUMORS, type RumorReveal } from '../src/data/rumors';
import { getSamosborBeatDefs } from '../src/data/samosbor_director';
import {
  SAMOSBOR_BASE_SUBSYSTEMS,
  SAMOSBOR_AFTERMATH_BEATS,
  SAMOSBOR_MODIFIERS,
  SAMOSBOR_VARIANTS,
  buildActiveSamosborVariant,
  getSamosborAftermathBeats,
  getSamosborVariantWeight,
} from '../src/data/samosbor_variants';
import { SCREEN_SIGNAL_DEFS } from '../src/data/screen_signals';
import { SLIME_DEFS, SLIME_SAMPLE_IDS, slimeRoomAttractionWeight, slimeSampleIdForRoomName, validateSlimeDefs } from '../src/data/slime_defs';
import { ZHELEMISH_DEFS, ZHELEMISH_ITEM_IDS, validateZhelemishDefs } from '../src/data/zhelemish_defs';
import { MONSTERS } from '../src/entities/monster';
import { BLACK_MARKET_88_CONTRACT_ROWS } from '../src/gen/design_floors/black_market_88';
import '../src/gen/design_floors/manifest';
import { isFloorLevel } from '../src/gen/floor_manifest';

type QuestLike = PlotStep & {
  id?: string;
  type: QuestType;
};

type SideQuestRefs = Partial<Pick<SideQuestStep, 'requiresSideQuestDone' | 'blockedBySideQuestIds'>>;

const ID_RE = /^[a-z][a-z0-9_]*$/;
const SCREEN_VARIANT_COUNT = 8;
const CONTRACT_FLOOR_TAGS: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'floor_ministry',
  [FloorLevel.KVARTIRY]: 'floor_kvartiry',
  [FloorLevel.LIVING]: 'floor_living',
  [FloorLevel.MAINTENANCE]: 'floor_maintenance',
  [FloorLevel.HELL]: 'floor_hell',
  [FloorLevel.VOID]: 'floor_void',
};
const COMPACT_CONTRACT_ACTION_TAGS = ['kill', 'retrieve', 'deliver', 'repair', 'talk', 'visit'] as const;
const COMPACT_CONTRACT_ACTION_TAG_SET = new Set<string>(COMPACT_CONTRACT_ACTION_TAGS);

const ROOM_TYPE_IDS = numericEnumValues(RoomType);
const FACTION_IDS = numericEnumValues(Faction);
const OCCUPATION_IDS = numericEnumValues(Occupation);
const ZONE_FACTION_IDS = numericEnumValues(ZoneFaction);

function numericEnumValues(enumObj: Record<string, string | number>): Set<number> {
  return new Set(Object.values(enumObj).filter((value): value is number => typeof value === 'number'));
}

function duplicateIds(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
}

function assertUnique(label: string, ids: readonly string[]): void {
  assert.deepEqual(duplicateIds(ids), [], `${label} ids must be unique`);
}

function referencedItems(step: QuestLike): string[] {
  const ids: string[] = [];
  if (step.targetItem) ids.push(step.targetItem);
  if (step.rewardItem) ids.push(step.rewardItem);
  for (const reward of step.extraRewards ?? []) ids.push(reward.defId);
  return ids;
}

function missingItems(label: string, ids: readonly string[]): string[] {
  return ids.filter(id => !itemExists(id)).map(id => `${label}:${id}`);
}

function dataRef(domain: string, id: string | number, field: string, value: unknown): string {
  return `${domain}:${String(id)}:${field}:${String(value)}`;
}

function itemExists(id: string): boolean {
  return id === 'money' || !!ITEMS[id];
}

function monsterExists(kind: number): boolean {
  return Object.prototype.hasOwnProperty.call(MONSTERS, kind);
}

function missingItemRefs(domain: string, id: string | number, field: string, ids: readonly string[]): string[] {
  return ids.filter(itemId => !itemExists(itemId)).map(itemId => dataRef(domain, id, field, itemId));
}

function pushItemRef(missing: string[], domain: string, id: string | number, field: string, itemId: string | undefined): void {
  if (itemId && !itemExists(itemId)) missing.push(dataRef(domain, id, field, itemId));
}

function pushItemStackRefs(
  missing: string[],
  domain: string,
  id: string | number,
  field: string,
  stack: Pick<Item, 'defId' | 'count'>,
): void {
  pushItemRef(missing, domain, id, `${field}.defId`, stack.defId);
  if (stack.count <= 0) missing.push(dataRef(domain, id, `${field}.count`, stack.count));
}

function sideQuestRefs(refs: string | readonly string[] | undefined): readonly string[] {
  if (refs === undefined) return [];
  return Array.isArray(refs) ? refs : [refs];
}

function pushEventDataRumorRefs(
  missing: string[],
  domain: string,
  id: string | number,
  eventData: Record<string, unknown> | undefined,
  rumorIds: ReadonlySet<string>,
): void {
  const raw = eventData?.rumorIds;
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    missing.push(dataRef(domain, id, 'eventData.rumorIds', raw));
    return;
  }
  raw.forEach((rumorId, index) => {
    if (typeof rumorId !== 'string' || !rumorIds.has(rumorId)) {
      missing.push(dataRef(domain, id, `eventData.rumorIds[${index}]`, rumorId));
    }
  });
}

test('item ids are unique, keyed by id, and weapon items have stats', () => {
  const entries = Object.entries(ITEMS);

  assertUnique('item', entries.map(([, def]) => def.id));
  assert.deepEqual(
    entries.filter(([key, def]) => key !== def.id).map(([key, def]) => `${key}->${def.id}`),
    [],
  );

  const weaponIdsWithoutStats = entries
    .filter(([, def]) => def.type === ItemType.WEAPON)
    .map(([id]) => id)
    .filter(id => !WEAPON_STATS[id]);
  assert.deepEqual(weaponIdsWithoutStats, [], 'weapon items must have weapon stats');

  const physicalStatsWithoutItems = Object.keys(PHYS_WEAPON_STATS)
    .filter(id => id !== '' && !ITEMS[id]);
  assert.deepEqual(physicalStatsWithoutItems, [], 'physical weapon stats must have item definitions');

  const physicalStatsWithoutRole = Object.keys(PHYS_WEAPON_STATS)
    .filter(id => !PHYS_WEAPON_ROLE_TIERS[id]);
  assert.deepEqual(physicalStatsWithoutRole, [], 'physical weapon stats must have role tiers');

  const psiStatsWithoutItems = Object.keys(PSI_WEAPON_STATS)
    .filter(id => !ITEMS[id]);
  assert.deepEqual(psiStatsWithoutItems, [], 'PSI weapon stats must have item definitions');

  const psiStatsWithoutRole = Object.keys(PSI_WEAPON_STATS)
    .filter(id => PSI_WEAPON_ROLE_TIERS[id] !== 'psi');
  assert.deepEqual(psiStatsWithoutRole, [], 'PSI weapon stats must have psi role tiers');

  const missingAmmoItems = Object.entries(PHYS_WEAPON_STATS)
    .filter(([, stats]) => !!stats.ammoType)
    .map(([id, stats]) => `${id}:${stats.ammoType}`)
    .filter(ref => !ITEMS[ref.slice(ref.indexOf(':') + 1)]);
  assert.deepEqual(missingAmmoItems, [], 'physical weapon ammo types must reference item definitions');
});

test('ammo uses planned sources and explicit scarcity resources', () => {
  const ammoEntries = Object.values(ITEMS).filter(def => def.type === ItemType.AMMO);

  assert.deepEqual(
    ammoEntries.filter(def => def.spawnRooms.length > 0).map(def => def.id),
    [],
    'ammo must not enter generic room loot tables',
  );
  assert.deepEqual(
    ammoEntries.filter(def => def.spawnW !== 0).map(def => def.id),
    [],
    'ammo generic spawn weight must stay zero',
  );
  assert.deepEqual(
    ammoEntries.filter(def => !resourceForItem(def.id)).map(def => def.id),
    [],
    'ammo items must map to explicit resource ids',
  );

  const mismatchedContracts: string[] = [];
  for (const contract of CONTRACTS) {
    const rewardIds = [
      ...(contract.rewardItem && ITEMS[contract.rewardItem]?.type === ItemType.AMMO ? [contract.rewardItem] : []),
      ...(contract.extraRewards ?? []).filter(reward => ITEMS[reward.defId]?.type === ItemType.AMMO).map(reward => reward.defId),
    ];
    if (rewardIds.length === 0) continue;
    const resourceIds = [...new Set(rewardIds.map(id => resourceForItem(id)?.id).filter((id): id is string => !!id))];
    if (!contract.rewardResourceId) mismatchedContracts.push(`${contract.id}:missing`);
    else if (!resourceIds.includes(contract.rewardResourceId)) {
      mismatchedContracts.push(`${contract.id}:${contract.rewardResourceId}->${resourceIds.join('|')}`);
    }
  }
  assert.deepEqual(mismatchedContracts, [], 'ammo reward contracts must scale against rewarded ammo resources');
});

test('story and side quest ids are unique and resolve through NPC packages', () => {
  assertUnique('side quest', SIDE_QUESTS.map(q => q.id));
  assertUnique('plot npc', allPlotNpcIds());

  const sideQuestIds = new Set(SIDE_QUESTS.map(q => q.id));
  const rumorIds = new Set(RUMORS.map(rumor => rumor.id));
  const missing: string[] = [];

  const validateQuest = (q: QuestLike, id: string): void => {
    if (!hasPlotNpc(q.giverNpcId)) missing.push(dataRef('quest', id, 'giverNpcId', q.giverNpcId));
    if (q.targetNpcId && !hasPlotNpc(q.targetNpcId)) missing.push(dataRef('quest', id, 'targetNpcId', q.targetNpcId));
    if (q.targetPlotNpcId && !hasPlotNpc(q.targetPlotNpcId)) missing.push(dataRef('quest', id, 'targetPlotNpcId', q.targetPlotNpcId));
    if (q.failOnNpcDeathPlotId && !hasPlotNpc(q.failOnNpcDeathPlotId)) missing.push(dataRef('quest', id, 'failOnNpcDeathPlotId', q.failOnNpcDeathPlotId));
    pushItemRef(missing, 'quest', id, 'targetItem', q.targetItem);
    pushItemRef(missing, 'quest', id, 'rewardItem', q.rewardItem);
    (q.extraRewards ?? []).forEach((reward, index) => pushItemStackRefs(missing, 'quest', id, `extraRewards[${index}]`, reward));
    if (q.targetMonsterKind !== undefined && !monsterExists(q.targetMonsterKind)) {
      missing.push(dataRef('quest', id, 'targetMonsterKind', q.targetMonsterKind));
    }
    if (q.targetRoomType !== undefined && !ROOM_TYPE_IDS.has(q.targetRoomType)) {
      missing.push(dataRef('quest', id, 'targetRoomType', q.targetRoomType));
    }
    if (q.targetFloor !== undefined && !isFloorLevel(q.targetFloor)) {
      missing.push(dataRef('quest', id, 'targetFloor', q.targetFloor));
    }
    if (q.visitFloor !== undefined && !isFloorLevel(q.visitFloor)) {
      missing.push(dataRef('quest', id, 'visitFloor', q.visitFloor));
    }
    const sideRefs = q as QuestLike & SideQuestRefs;
    for (const sideQuestId of sideQuestRefs(sideRefs.requiresSideQuestDone)) {
      if (!sideQuestIds.has(sideQuestId)) missing.push(dataRef('quest', id, 'requiresSideQuestDone', sideQuestId));
    }
    for (const sideQuestId of sideRefs.blockedBySideQuestIds ?? []) {
      if (!sideQuestIds.has(sideQuestId)) missing.push(dataRef('quest', id, 'blockedBySideQuestIds', sideQuestId));
    }
    for (const sideQuestId of q.abandonsSideQuestIds ?? []) {
      if (!sideQuestIds.has(sideQuestId)) missing.push(dataRef('quest', id, 'abandonsSideQuestIds', sideQuestId));
    }
    pushEventDataRumorRefs(missing, 'quest', id, q.eventData, rumorIds);
  };

  PLOT_CHAIN.forEach((q, index) => validateQuest(q, `plot_${index}`));
  for (const q of SIDE_QUESTS) validateQuest(q, q.id);

  for (const [id, npc] of allPlotNpcEntries()) {
    if (npc.weapon && !WEAPON_STATS[npc.weapon]) missing.push(dataRef('plotNpc', id, 'weapon', npc.weapon));
    npc.inventory.forEach((item, index) => pushItemStackRefs(missing, 'plotNpc', id, `inventory[${index}]`, item));
  }

  assert.deepEqual(missing, [], 'quest and plot NPC references must exist');
});

test('contract, resource, factory, and container ids stay coherent', () => {
  assertUnique('contract', CONTRACTS.map(c => c.id));
  assertUnique('resource', RESOURCES.map(r => r.id));
  assertUnique('factory', FACTORIES.map(f => f.id));
  assertUnique('faction event', FACTION_EVENT_DEFS.map(e => e.id));

  const resourceIds = new Set(RESOURCES.map(r => r.id));
  const rumorIds = new Set(RUMORS.map(r => r.id));
  const missing: string[] = [];

  for (const r of RESOURCES) {
    if (!ID_RE.test(r.id)) missing.push(dataRef('resource', r.id, 'idFormat', r.id));
    if (r.baseStock <= 0) missing.push(dataRef('resource', r.id, 'baseStock', r.baseStock));
    if (r.lowStock < 0 || r.lowStock >= r.baseStock) missing.push(dataRef('resource', r.id, 'lowStock', r.lowStock));
    if (r.roomTypes.length === 0) missing.push(dataRef('resource', r.id, 'roomTypes', 'empty'));
    for (const roomType of r.roomTypes) if (!ROOM_TYPE_IDS.has(roomType)) missing.push(dataRef('resource', r.id, 'roomTypes', roomType));
  }

  for (const c of CONTRACTS) {
    pushItemRef(missing, 'contract', c.id, 'targetItem', c.targetItem);
    pushItemRef(missing, 'contract', c.id, 'rewardItem', c.rewardItem);
    (c.extraRewards ?? []).forEach((reward, index) => pushItemStackRefs(missing, 'contract', c.id, `extraRewards[${index}]`, reward));
    if (c.targetCount !== undefined && c.targetCount <= 0) missing.push(dataRef('contract', c.id, 'targetCount', c.targetCount));
    if (c.rewardCount !== undefined && c.rewardCount <= 0) missing.push(dataRef('contract', c.id, 'rewardCount', c.rewardCount));
    if (!isFloorLevel(c.target.floor)) missing.push(dataRef('contract', c.id, 'target.floor', c.target.floor));
    if (c.target.roomType !== undefined && !ROOM_TYPE_IDS.has(c.target.roomType)) missing.push(dataRef('contract', c.id, 'target.roomType', c.target.roomType));
    if (c.targetPlotNpcId && !hasPlotNpc(c.targetPlotNpcId)) missing.push(dataRef('contract', c.id, 'targetPlotNpcId', c.targetPlotNpcId));
    if (c.rewardResourceId && !resourceIds.has(c.rewardResourceId)) missing.push(dataRef('contract', c.id, 'rewardResourceId', c.rewardResourceId));
    if (c.targetMonsterKind !== undefined && !monsterExists(c.targetMonsterKind)) missing.push(dataRef('contract', c.id, 'targetMonsterKind', c.targetMonsterKind));
    assertUnique(`contract ${c.id} tag`, [...c.tags]);
  }

  for (const row of BLACK_MARKET_88_CONTRACT_ROWS) {
    row.rewardTable.forEach((itemId, index) => pushItemRef(missing, 'blackMarket88', row.id, `rewardTable[${index}]`, itemId));
  }

  for (const r of RESOURCES) missing.push(...missingItemRefs('resource', r.id, 'itemIds', r.itemIds));

  for (const f of FACTORIES) {
    if (!ID_RE.test(f.id)) missing.push(dataRef('factory', f.id, 'idFormat', f.id));
    if (f.roomTypes.length === 0) missing.push(dataRef('factory', f.id, 'roomTypes', 'empty'));
    if (f.workerOccupations.length === 0) missing.push(dataRef('factory', f.id, 'workerOccupations', 'empty'));
    for (const roomType of f.roomTypes) if (!ROOM_TYPE_IDS.has(roomType)) missing.push(dataRef('factory', f.id, 'roomTypes', roomType));
    for (const occupation of f.workerOccupations) if (!OCCUPATION_IDS.has(occupation)) missing.push(dataRef('factory', f.id, 'workerOccupations', occupation));
    if (f.ownerFaction !== undefined && !FACTION_IDS.has(f.ownerFaction)) missing.push(dataRef('factory', f.id, 'ownerFaction', f.ownerFaction));
    assertUnique(`factory ${f.id} recipe`, f.recipes.map(r => r.id));
    for (const recipe of f.recipes) {
      const recipeId = `${f.id}.${recipe.id}`;
      if (!ID_RE.test(recipe.id)) missing.push(dataRef('factoryRecipe', recipeId, 'idFormat', recipe.id));
      if (recipe.cycleSec <= 0) missing.push(dataRef('factoryRecipe', recipeId, 'cycleSec', recipe.cycleSec));
      if (recipe.inputs.length === 0 && (recipe.inputItems ?? []).length === 0) missing.push(dataRef('factoryRecipe', recipeId, 'inputs', 'empty'));
      if (recipe.outputs.length === 0) missing.push(dataRef('factoryRecipe', recipeId, 'outputs', 'empty'));
      for (const input of recipe.inputs) {
        if (!resourceIds.has(input.id)) missing.push(dataRef('factoryRecipe', recipeId, 'inputs.resourceId', input.id));
        if (input.count <= 0) missing.push(dataRef('factoryRecipe', recipeId, `inputs.${input.id}.count`, input.count));
      }
      for (const [index, item] of (recipe.inputItems ?? []).entries()) {
        pushItemStackRefs(missing, 'factoryRecipe', recipeId, `inputItems[${index}]`, item);
      }
      for (const [index, output] of recipe.outputs.entries()) {
        pushItemStackRefs(missing, 'factoryRecipe', recipeId, `outputs[${index}]`, output);
      }
      if (recipe.badBatch) {
        if (recipe.badBatch.everyCycles <= 0) missing.push(dataRef('factoryRecipe', recipeId, 'badBatch.everyCycles', recipe.badBatch.everyCycles));
        if (recipe.badBatch.jammedCycleSec <= 0) missing.push(dataRef('factoryRecipe', recipeId, 'badBatch.jammedCycleSec', recipe.badBatch.jammedCycleSec));
        if (recipe.badBatch.outputs.length === 0) missing.push(dataRef('factoryRecipe', recipeId, 'badBatch.outputs', 'empty'));
        if (recipe.badBatch.repairItems.length === 0) missing.push(dataRef('factoryRecipe', recipeId, 'badBatch.repairItems', 'empty'));
        for (const [index, output] of recipe.badBatch.outputs.entries()) {
          pushItemStackRefs(missing, 'factoryRecipe', recipeId, `badBatch.outputs[${index}]`, output);
        }
        for (const [index, item] of recipe.badBatch.repairItems.entries()) {
          pushItemStackRefs(missing, 'factoryRecipe', recipeId, `badBatch.repairItems[${index}]`, item);
        }
        for (const [index, output] of (recipe.badBatch.repairOutputs ?? []).entries()) {
          pushItemStackRefs(missing, 'factoryRecipe', recipeId, `badBatch.repairOutputs[${index}]`, output);
        }
      }
    }
  }

  for (const [key, def] of Object.entries(CONTAINER_DEFS)) {
    if (Number(key) !== def.kind) missing.push(dataRef('container', def.kind, 'kindKey', key));
    if (def.capacitySlots <= 0) missing.push(dataRef('container', def.kind, 'capacitySlots', def.capacitySlots));
    if (def.roomTypes.length === 0) missing.push(dataRef('container', def.kind, 'roomTypes', 'empty'));
    for (const roomType of def.roomTypes) if (!ROOM_TYPE_IDS.has(roomType)) missing.push(dataRef('container', def.kind, 'roomTypes', roomType));
    (def.itemPool ?? []).forEach((item, index) => {
      pushItemRef(missing, 'container', def.kind, `itemPool[${index}].defId`, item.defId);
      if (item.min < 0) missing.push(dataRef('container', def.kind, `itemPool[${index}].min`, item.min));
      if (item.max < item.min) missing.push(dataRef('container', def.kind, `itemPool[${index}].max`, item.max));
      if (item.chance !== undefined && (item.chance <= 0 || item.chance > 1)) missing.push(dataRef('container', def.kind, `itemPool[${index}].chance`, item.chance));
    });
  }

  for (const event of FACTION_EVENT_DEFS) {
    pushItemRef(missing, 'factionEvent', event.id, 'itemId', event.itemId);
    for (const zoneFaction of event.zoneFactions) if (!ZONE_FACTION_IDS.has(zoneFaction)) missing.push(dataRef('factionEvent', event.id, 'zoneFactions', zoneFaction));
    if (event.actorFaction !== undefined && !FACTION_IDS.has(event.actorFaction)) missing.push(dataRef('factionEvent', event.id, 'actorFaction', event.actorFaction));
    if (!OCCUPATION_IDS.has(event.occupation)) missing.push(dataRef('factionEvent', event.id, 'occupation', event.occupation));
    for (const [index, item] of (event.npcInventory ?? []).entries()) pushItemStackRefs(missing, 'factionEvent', event.id, `npcInventory[${index}]`, item);
    for (const [index, item] of (event.drops ?? []).entries()) pushItemStackRefs(missing, 'factionEvent', event.id, `drops[${index}]`, item);
    for (const [index, item] of (event.containerDrops ?? []).entries()) pushItemStackRefs(missing, 'factionEvent', event.id, `containerDrops[${index}]`, item);
    for (const weapon of event.weapons ?? []) if (!WEAPON_STATS[weapon]) missing.push(dataRef('factionEvent', event.id, 'weapons', weapon));
    for (const delta of event.economyDeltas ?? []) {
      if (!resourceIds.has(delta.resourceId)) missing.push(dataRef('factionEvent', event.id, 'economyDeltas.resourceId', delta.resourceId));
      if (delta.count === 0) missing.push(dataRef('factionEvent', event.id, `economyDeltas.${delta.resourceId}.count`, delta.count));
    }
    if (event.minGroup < 0 || event.maxGroup < event.minGroup) missing.push(dataRef('factionEvent', event.id, 'group', `${event.minGroup}-${event.maxGroup}`));
    if (event.clash) {
      if (!FACTION_IDS.has(event.clash.reportFaction)) missing.push(dataRef('factionEvent', event.id, 'clash.reportFaction', event.clash.reportFaction));
      event.clash.sides.forEach((side, sideIndex) => {
        if (!FACTION_IDS.has(side.faction)) missing.push(dataRef('factionEvent', event.id, `clash.sides[${sideIndex}].faction`, side.faction));
        if (!OCCUPATION_IDS.has(side.occupation)) missing.push(dataRef('factionEvent', event.id, `clash.sides[${sideIndex}].occupation`, side.occupation));
        if (side.minGroup < 0 || side.maxGroup < side.minGroup) missing.push(dataRef('factionEvent', event.id, `clash.sides[${sideIndex}].group`, `${side.minGroup}-${side.maxGroup}`));
        for (const weapon of side.weapons ?? []) if (!WEAPON_STATS[weapon]) missing.push(dataRef('factionEvent', event.id, `clash.sides[${sideIndex}].weapons`, weapon));
        for (const [itemIndex, item] of (side.npcInventory ?? []).entries()) {
          pushItemStackRefs(missing, 'factionEvent', event.id, `clash.sides[${sideIndex}].npcInventory[${itemIndex}]`, item);
        }
      });
      event.clash.outcomes.forEach((outcome, outcomeIndex) => {
        if (outcome.winnerFaction !== undefined && !FACTION_IDS.has(outcome.winnerFaction)) missing.push(dataRef('factionEvent', event.id, `clash.outcomes[${outcomeIndex}].winnerFaction`, outcome.winnerFaction));
        outcome.items.forEach((item, itemIndex) => pushItemStackRefs(missing, 'factionEvent', event.id, `clash.outcomes[${outcomeIndex}].items[${itemIndex}]`, item));
        for (const rumorId of outcome.rumorIds) if (!rumorIds.has(rumorId)) missing.push(dataRef('factionEvent', event.id, `clash.outcomes[${outcomeIndex}].rumorIds`, rumorId));
      });
    }
    assertUnique(`factionEvent ${event.id} tag`, [...event.tags]);
  }

  assert.deepEqual(missing, [], 'runtime data references must resolve');
});

test('compact expedition contracts cover real contract actions with concrete targets', () => {
  const pack = CONTRACTS.filter(c => c.tags.includes('compact_expedition'));
  assert.equal(pack.length > 0, true, 'must have compact expedition contracts');
  assertUnique('compact expedition contract', pack.map(c => c.id));

  const actionCoverage = new Set<string>();
  const typeCoverage = new Set<QuestType>();

  for (const c of pack) {
    const actionTags = c.tags.filter(tag => COMPACT_CONTRACT_ACTION_TAG_SET.has(tag));
    actionTags.forEach(tag => actionCoverage.add(tag));
    typeCoverage.add(c.type);

    assert.equal(c.tags.includes('compact_expedition'), true, `${c.id} must be tagged as compact_expedition`);
    assert.equal(c.tags.includes(CONTRACT_FLOOR_TAGS[c.target.floor]), true, `${c.id} must expose a floor tag`);
    assert.equal(actionTags.length > 0, true, `${c.id} needs an action tag`);
    assert.equal((c.target.zoneTag ?? '').trim().length > 0, true, `${c.id} needs a zone tag`);
    assert.equal(c.target.hint.trim().length >= 48, true, `${c.id} needs a concrete player hint`);
    assert.equal(c.rewardResourceId !== undefined, true, `${c.id} needs scarcity-aware reward resource`);
    assert.equal(c.rewardScarcityMax !== undefined && c.rewardScarcityMax > 1 && c.rewardScarcityMax <= 3, true, `${c.id} needs bounded reward scarcity`);
    assert.equal(c.moneyReward > 0, true, `${c.id} needs money reward`);
    assert.equal(c.xpReward > 0, true, `${c.id} needs XP reward`);
    assert.equal(c.relationDelta > 0, true, `${c.id} needs faction relation effect`);

    if (c.type === QuestType.FETCH) {
      assert.equal(c.targetItem !== undefined, true, `${c.id} FETCH needs targetItem`);
      assert.equal((c.targetCount ?? 1) > 0, true, `${c.id} FETCH needs positive targetCount`);
    }
    if (c.type === QuestType.KILL) {
      assert.equal(c.targetMonsterKind !== undefined, true, `${c.id} KILL needs targetMonsterKind`);
      assert.equal((c.killNeeded ?? 0) > 0, true, `${c.id} KILL needs positive killNeeded`);
    }
    if (c.type === QuestType.TALK) {
      assert.equal(c.targetPlotNpcId !== undefined, true, `${c.id} TALK needs targetPlotNpcId`);
      assert.equal((c.targetNpcName ?? '').trim().length > 0, true, `${c.id} TALK needs targetNpcName`);
    }
    if (c.type === QuestType.VISIT) {
      assert.equal(c.target.roomType !== undefined, true, `${c.id} VISIT needs roomType`);
    }
  }

  for (const action of COMPACT_CONTRACT_ACTION_TAGS) {
    assert.equal(actionCoverage.has(action), true, `compact expedition pack needs ${action}`);
  }
  assert.equal(typeCoverage.has(QuestType.FETCH), true, 'compact expedition pack needs FETCH contracts');
  assert.equal(typeCoverage.has(QuestType.KILL), true, 'compact expedition pack needs KILL contracts');
  assert.equal(typeCoverage.has(QuestType.TALK), true, 'compact expedition pack needs TALK contracts');
  assert.equal(typeCoverage.has(QuestType.VISIT), true, 'compact expedition pack needs VISIT contracts');
});

test('samosbor variants, director beats, and aftermath stay coherent', () => {
  assertUnique('samosbor variant', SAMOSBOR_VARIANTS.map(v => v.id));
  assertUnique('samosbor modifier', Object.keys(SAMOSBOR_MODIFIERS));
  assertUnique('samosbor aftermath', SAMOSBOR_AFTERMATH_BEATS.map(b => b.id));
  assertUnique('samosbor director beat', getSamosborBeatDefs().map(b => b.id));

  const resourceIds = new Set(RESOURCES.map(r => r.id));
  const variantIds = new Set(SAMOSBOR_VARIANTS.map(v => v.id));
  const modifierIds = new Set(Object.keys(SAMOSBOR_MODIFIERS));
  const missing: string[] = [];

  for (const variant of SAMOSBOR_VARIANTS) {
    for (const floor of variant.floors) if (!isFloorLevel(floor)) missing.push(`samosborVariant:${variant.id}:floor:${floor}`);
    if (variant.warningLines.length === 0) missing.push(`samosborVariant:${variant.id}:warningLines`);
    if (variant.gameplaySignal.length < 16) missing.push(`samosborVariant:${variant.id}:gameplaySignal`);
    for (const modifierId of variant.modifiers) {
      if (!modifierIds.has(modifierId)) missing.push(`samosborVariant:${variant.id}:modifier:${modifierId}`);
    }
  }

  for (const beat of getSamosborBeatDefs()) {
    for (const floor of beat.floors) if (!isFloorLevel(floor)) missing.push(`samosborDirector:${beat.id}:floor:${floor}`);
    for (const variant of beat.variants) if (!variantIds.has(variant)) missing.push(`samosborDirector:${beat.id}:variant:${variant}`);
    if (beat.resourceId && !resourceIds.has(beat.resourceId)) missing.push(`samosborDirector:${beat.id}:resource:${beat.resourceId}`);
    if (beat.cooldown < 0) missing.push(`samosborDirector:${beat.id}:cooldown:${beat.cooldown}`);
    if (beat.maxPerCycle <= 0) missing.push(`samosborDirector:${beat.id}:maxPerCycle:${beat.maxPerCycle}`);
  }

  for (const beat of SAMOSBOR_AFTERMATH_BEATS) {
    for (const floor of beat.floors) if (!isFloorLevel(floor)) missing.push(`samosborAftermath:${beat.id}:floor:${floor}`);
    for (const variant of beat.variants) if (!variantIds.has(variant)) missing.push(`samosborAftermath:${beat.id}:variant:${variant}`);
    if (beat.resourceId && !resourceIds.has(beat.resourceId)) missing.push(`samosborAftermath:${beat.id}:resource:${beat.resourceId}`);
    if (beat.itemId) missing.push(...missingItems(`samosborAftermath:${beat.id}`, [beat.itemId]));
    if (beat.monsterKind !== undefined && !MONSTERS[beat.monsterKind]) missing.push(`samosborAftermath:${beat.id}:monster:${beat.monsterKind}`);
    if (beat.cooldownSec < 0) missing.push(`samosborAftermath:${beat.id}:cooldown:${beat.cooldownSec}`);
    if (beat.maxRuns <= 0) missing.push(`samosborAftermath:${beat.id}:maxRuns:${beat.maxRuns}`);
    if (beat.radius <= 0) missing.push(`samosborAftermath:${beat.id}:radius:${beat.radius}`);
  }

  assert.deepEqual(missing, [], 'samosbor data references must resolve');
});

test('samosbor variants keep the universal active pipeline and variant fog semantics', () => {
  const requiredBaseSubsystems = [
    'warning',
    'audio',
    'fog_tint',
    'fog_spread',
    'seal',
    'monster_pressure',
    'random_transfer',
    'room_sirens',
    'local_wave',
    'aftermath',
  ] as const;
  assert.deepEqual(SAMOSBOR_BASE_SUBSYSTEMS, requiredBaseSubsystems);

  const specialFogSubsystems = ['fog_rewrite', 'fog_create', 'fog_delete'] as const;
  const requiredVariantSubsystems = new Map([
    ['classic', []],
    ['wet', []],
    ['electric', []],
    ['meat', ['hell_meat_walls']],
    ['maronary', ['maronary_sources', 'wrong_door', 'source_glow', 'fog_rewrite']],
    ['istotit', ['istotit_shelters', 'bell_compulsion', 'fog_create']],
    ['veretar', ['veretar_area_leak', 'fog_delete']],
  ]);

  const missing: string[] = [];
  for (const def of SAMOSBOR_VARIANTS) {
    const active = buildActiveSamosborVariant(def);
    for (const subsystem of requiredBaseSubsystems) {
      if (!active.subsystems.includes(subsystem)) missing.push(`samosborVariant:${def.id}:base:${subsystem}`);
    }
    for (const subsystem of requiredVariantSubsystems.get(def.id) ?? []) {
      if (!active.subsystems.includes(subsystem)) missing.push(`samosborVariant:${def.id}:variant:${subsystem}`);
    }

    const activeSpecialFog = specialFogSubsystems.filter(subsystem => active.subsystems.includes(subsystem));
    if (def.id === 'maronary') assert.deepEqual(activeSpecialFog, ['fog_rewrite']);
    else if (def.id === 'istotit') assert.deepEqual(activeSpecialFog, ['fog_create']);
    else if (def.id === 'veretar') assert.deepEqual(activeSpecialFog, ['fog_delete']);
    else assert.deepEqual(activeSpecialFog, [], `${def.id} should keep default monster-spawning fog`);
  }

  assert.deepEqual(missing, [], 'samosbor active pipeline subsystems must stay data-driven and complete');
});

test('samosbor floor families expose warning and aftermath identities', () => {
  const directorBeats = getSamosborBeatDefs();
  const families = [
    {
      label: 'social',
      floor: FloorLevel.MINISTRY,
      variants: ['electric', 'maronary', 'istotit', 'veretar'] as const,
      aftermathVariant: 'electric' as const,
      tag: 'civil',
      warningTag: 'social',
    },
    {
      label: 'maintenance',
      floor: FloorLevel.MAINTENANCE,
      variants: ['wet', 'electric'] as const,
      aftermathVariant: 'wet' as const,
      tag: 'maintenance',
      warningTag: 'maintenance',
    },
    {
      label: 'hell',
      floor: FloorLevel.HELL,
      variants: ['meat'] as const,
      aftermathVariant: 'meat' as const,
      tag: 'hell',
      warningTag: 'hell',
    },
    {
      label: 'void',
      floor: FloorLevel.VOID,
      variants: ['veretar', 'maronary'] as const,
      aftermathVariant: 'veretar' as const,
      tag: 'void',
      warningTag: 'void',
    },
  ];

  for (const family of families) {
    const classicWeight = getSamosborVariantWeight('classic', family.floor);
    const familyWeight = family.variants.reduce((sum, id) => sum + getSamosborVariantWeight(id, family.floor), 0);
    assert.ok(familyWeight > classicWeight, `${family.label} variants should outweigh classic on their floor family`);
    assert.ok(
      directorBeats.some(beat =>
        beat.phase === 'warning' && beat.floors.includes(family.floor) && beat.tags.includes(family.warningTag)),
      `${family.label} needs a warning/counterplay director beat`,
    );
    assert.ok(
      getSamosborAftermathBeats(family.aftermathVariant, family.floor).some(beat => beat.tags.includes(family.tag)),
      `${family.label} needs tagged aftermath`,
    );
  }
});

test('slime definitions expose stable sample ids and text handles', () => {
  assert.equal(SLIME_DEFS.length, 8, 'AG61 defines the MVP slime type set');
  assert.deepEqual(validateSlimeDefs(), [], 'slime definitions must validate internally');
  assertUnique('slime', SLIME_DEFS.map(def => def.id));
  assertUnique('slime sample', SLIME_SAMPLE_IDS);

  const slimeResource = RESOURCES.find(resource => resource.id === 'slime_samples');
  assert.ok(slimeResource, 'slime_samples resource must exist for contract/economy lookup');
  assert.equal(slimeResource.itemIds.includes('zinc_slime_bucket'), true, 'zinc slime bucket must price as a slime sample');
  assert.equal(
    SAMOSBOR_AFTERMATH_BEATS.some(beat =>
      beat.id === 'aftermath_zinc_slime_bucket'
      && beat.floors.includes(FloorLevel.MAINTENANCE)
      && beat.itemId === 'zinc_slime_bucket'),
    true,
    'zinc slime bucket must be reachable through Maintenance aftermath',
  );

  const rumorIds = new Set(RUMORS.map(rumor => rumor.id));
  const rumorSampleIds = new Set<string>();
  for (const rumor of RUMORS) {
    const reveals: readonly RumorReveal[] = rumor.reveals === undefined ? [] : Array.isArray(rumor.reveals) ? rumor.reveals : [rumor.reveals];
    for (const reveal of reveals) {
      if (reveal.kind === 'item') rumorSampleIds.add(reveal.itemId);
    }
  }

  const missing: string[] = [];
  for (const def of SLIME_DEFS) {
    const item = ITEMS[def.sampleId];
    if (!item) {
      missing.push(dataRef('slime', def.id, 'sampleId', def.sampleId));
      continue;
    }
    if (item.id !== def.sampleId) missing.push(dataRef('slime', def.id, 'sampleKey', item.id));
    if (item.type !== ItemType.MISC) missing.push(dataRef('slime', def.id, 'itemType', item.type));
    if (!slimeResource.itemIds.includes(def.sampleId)) missing.push(dataRef('slime', def.id, 'resource.itemIds', def.sampleId));
    if (!rumorSampleIds.has(def.sampleId)) missing.push(dataRef('slime', def.id, 'rumorSample', def.sampleId));
    for (const handle of def.textHandles) {
      if (!rumorIds.has(handle)) missing.push(dataRef('slime', def.id, 'textHandles', handle));
    }
  }

  assert.equal(slimeSampleIdForRoomName('Зелёная кислотная пробная'), 'slime_sample_green');
  assert.equal(slimeSampleIdForRoomName('Белый остаток'), 'slime_sample_white');
  assert.equal(slimeSampleIdForRoomName('Черная слизь: остаток смотрит назад'), 'slime_sample_black');
  assert.equal(slimeSampleIdForRoomName('Кормовая ванна слизневика'), 'slime_sample_brown');
  assert.ok(slimeRoomAttractionWeight('Слизевой пробный отсек', RoomType.PRODUCTION) > 0);

  assert.deepEqual(missing, [], 'slime sample ids must resolve through items, resources, and rumors');
});

test('zhelemish definitions expose stable item ids and economy roles', () => {
  assert.equal(ZHELEMISH_DEFS.length, 3, 'AG101 defines raw, dried, and boiled zhelemish forms');
  assert.deepEqual(validateZhelemishDefs(), [], 'zhelemish definitions must validate internally');
  assertUnique('zhelemish item', ZHELEMISH_ITEM_IDS);

  const zhelemishResource = RESOURCES.find(resource => resource.id === 'zhelemish');
  assert.ok(zhelemishResource, 'zhelemish resource must exist for economy lookup');

  const rumorItemIds = new Set<string>();
  for (const rumor of RUMORS) {
    const reveals: readonly RumorReveal[] = rumor.reveals === undefined ? [] : Array.isArray(rumor.reveals) ? rumor.reveals : [rumor.reveals];
    for (const reveal of reveals) {
      if (reveal.kind === 'item') rumorItemIds.add(reveal.itemId);
    }
  }

  const missing: string[] = [];
  for (const def of ZHELEMISH_DEFS) {
    const item = ITEMS[def.itemId];
    if (!item) {
      missing.push(dataRef('zhelemish', def.itemId, 'itemId', def.itemId));
      continue;
    }
    if (item.id !== def.itemId) missing.push(dataRef('zhelemish', def.itemId, 'itemKey', item.id));
    if (item.value !== def.baseValue) missing.push(dataRef('zhelemish', def.itemId, 'value', `${item.value}->${def.baseValue}`));
    if (!zhelemishResource.itemIds.includes(def.itemId)) missing.push(dataRef('zhelemish', def.itemId, 'resource.itemIds', def.itemId));
    if (!rumorItemIds.has(def.itemId)) missing.push(dataRef('zhelemish', def.itemId, 'rumorItem', def.itemId));
  }

  assert.equal(ZHELEMISH_DEFS.some(def => def.tradeRoles.includes('food')), true, 'zhelemish needs a food trade role');
  assert.equal(ZHELEMISH_DEFS.some(def => def.tradeRoles.includes('medicine_counterfeit')), true, 'zhelemish needs a counterfeit medicine trade role');
  assert.equal(ZHELEMISH_DEFS.some(def => def.tradeRoles.includes('reagent')), true, 'zhelemish needs a reagent trade role');
  assert.equal(ZHELEMISH_DEFS.some(def => def.tradeRoles.includes('cult_interest')), true, 'zhelemish needs cult interest');
  assert.equal(ZHELEMISH_DEFS.some(def => def.tradeRoles.includes('science_interest')), true, 'zhelemish needs science interest');
  assert.deepEqual(missing, [], 'zhelemish ids must resolve through items, resources, and rumors');
});

test('rumor reveals and expedition leads reference known gameplay ids', () => {
  const missing: string[] = [];
  let leadCount = 0;

  for (const rumor of RUMORS) {
    if (!ID_RE.test(rumor.id)) missing.push(dataRef('rumor', rumor.id, 'idFormat', rumor.id));
    if (rumor.floors.length === 0) missing.push(dataRef('rumor', rumor.id, 'floors', 'empty'));
    for (const floor of rumor.floors) if (!isFloorLevel(floor)) missing.push(dataRef('rumor', rumor.id, 'floors', floor));
    const reveals: readonly RumorReveal[] = rumor.reveals === undefined ? [] : Array.isArray(rumor.reveals) ? rumor.reveals : [rumor.reveals];
    reveals.forEach((reveal, index) => {
      if (reveal.kind === 'item') pushItemRef(missing, 'rumor', rumor.id, `reveals[${index}].itemId`, reveal.itemId);
      if (reveal.kind === 'monster' && reveal.monsterKind !== undefined && !monsterExists(reveal.monsterKind)) {
        missing.push(dataRef('rumor', rumor.id, `reveals[${index}].monsterKind`, reveal.monsterKind));
      }
      if (reveal.kind === 'room' && reveal.roomType !== undefined && !ROOM_TYPE_IDS.has(reveal.roomType)) {
        missing.push(dataRef('rumor', rumor.id, `reveals[${index}].roomType`, reveal.roomType));
      }
      if (reveal.kind === 'floor' && !isFloorLevel(reveal.floor)) {
        missing.push(dataRef('rumor', rumor.id, `reveals[${index}].floor`, reveal.floor));
      }
      if (reveal.kind === 'faction' && reveal.faction !== undefined && !FACTION_IDS.has(reveal.faction)) {
        missing.push(dataRef('rumor', rumor.id, `reveals[${index}].faction`, reveal.faction));
      }
      if (reveal.kind === 'zone' && reveal.faction !== undefined && !ZONE_FACTION_IDS.has(reveal.faction)) {
        missing.push(dataRef('rumor', rumor.id, `reveals[${index}].zoneFaction`, reveal.faction));
      }
    });

    if (!rumor.lead) continue;
    leadCount++;
    if (rumor.lead.floor !== undefined && !isFloorLevel(rumor.lead.floor)) missing.push(dataRef('rumor', rumor.id, 'lead.floor', rumor.lead.floor));
    if (rumor.lead.roomType !== undefined && !ROOM_TYPE_IDS.has(rumor.lead.roomType)) missing.push(dataRef('rumor', rumor.id, 'lead.roomType', rumor.lead.roomType));
    pushItemRef(missing, 'rumor', rumor.id, 'lead.itemId', rumor.lead.itemId);
    if (rumor.lead.monsterKind !== undefined && !monsterExists(rumor.lead.monsterKind as MonsterKind)) {
      missing.push(dataRef('rumor', rumor.id, 'lead.monsterKind', rumor.lead.monsterKind));
    }
    if (rumor.lead.action.trim().length < 12) missing.push(dataRef('rumor', rumor.id, 'lead.action', rumor.lead.action));
  }

  assert.ok(leadCount >= 30, `expected at least 30 practical rumor leads, got ${leadCount}`);
  assert.deepEqual(missing, [], 'rumor reveal and lead references must resolve');
});

test('screen signal definitions reference known rumors, rooms, factions, and variants', () => {
  assertUnique('screen signal', SCREEN_SIGNAL_DEFS.map(def => def.id));

  const rumorIds = new Set(RUMORS.map(r => r.id));
  const variantOwners = new Map<number, string>();
  const invalid: string[] = [];

  for (const def of SCREEN_SIGNAL_DEFS) {
    if (!ID_RE.test(def.id)) invalid.push(dataRef('screenSignal', def.id, 'idFormat', def.id));
    if (def.weight <= 0) invalid.push(dataRef('screenSignal', def.id, 'weight', def.weight));
    if (def.textureVariants.length === 0) invalid.push(dataRef('screenSignal', def.id, 'textureVariants', 'empty'));
    if (def.floors.length === 0) invalid.push(dataRef('screenSignal', def.id, 'floors', 'empty'));
    if (def.eventTypes.length === 0) invalid.push(dataRef('screenSignal', def.id, 'eventTypes', 'empty'));
    if (def.rumorIds.length === 0) invalid.push(dataRef('screenSignal', def.id, 'rumorIds', 'empty'));
    if (!def.tags.includes('screen_signal')) invalid.push(dataRef('screenSignal', def.id, 'tags', 'screen_signal'));

    for (const variant of def.textureVariants) {
      if (!Number.isInteger(variant) || variant < 0 || variant >= SCREEN_VARIANT_COUNT) {
        invalid.push(dataRef('screenSignal', def.id, 'textureVariants', variant));
        continue;
      }
      const owner = variantOwners.get(variant);
      if (owner) invalid.push(dataRef('screenSignal', def.id, 'textureVariants.duplicate', `${owner}:${variant}`));
      else variantOwners.set(variant, def.id);
    }
    for (const floor of def.floors) if (!isFloorLevel(floor)) invalid.push(dataRef('screenSignal', def.id, 'floors', floor));
    for (const roomType of def.roomTypes ?? []) if (!ROOM_TYPE_IDS.has(roomType)) invalid.push(dataRef('screenSignal', def.id, 'roomTypes', roomType));
    for (const zoneFaction of def.zoneFactions ?? []) if (!ZONE_FACTION_IDS.has(zoneFaction)) invalid.push(dataRef('screenSignal', def.id, 'zoneFactions', zoneFaction));
    def.eventTypes.forEach((eventType, index) => {
      if (typeof eventType !== 'string' || eventType.trim().length === 0) {
        invalid.push(dataRef('screenSignal', def.id, `eventTypes[${index}]`, eventType));
      }
    });
    for (const rumorId of def.rumorIds) if (!rumorIds.has(rumorId)) invalid.push(dataRef('screenSignal', def.id, 'rumorIds', rumorId));
    assertUnique(`screenSignal ${def.id} tag`, [...def.tags]);
  }

  for (let variant = 0; variant < SCREEN_VARIANT_COUNT; variant++) {
    if (!variantOwners.has(variant)) invalid.push(dataRef('screenSignal', 'registry', 'textureVariants.missing', variant));
  }

  assert.deepEqual(invalid, [], 'screen signal references must resolve');
});

test('permit and local terminal registries stay keyed and reference live data', () => {
  assertUnique('permit', PERMIT_DEFS.map(def => def.id));
  assertUnique('permit item', PERMIT_DEFS.map(def => def.itemId));
  assertUnique('permit forgery recipe', PERMIT_FORGERY_RECIPES.map(recipe => recipe.id));
  assertUnique('computer', Object.keys(COMPUTER_DEFS));
  assertUnique('net hack terminal', Object.keys(NET_HACK_TERMINALS));
  assertUnique('emergency panel', EMERGENCY_PANEL_DEFS.map(def => def.id));
  assertUnique('emergency panel domain', EMERGENCY_PANEL_DEFS.map(def => def.domain));

  const rumorIds = new Set(RUMORS.map(rumor => rumor.id));
  const geometryIds = new Set(FLOOR_GEOMETRIES.map(geometry => geometry.id));
  const invalid: string[] = [];

  for (const def of PERMIT_DEFS) {
    if (!ID_RE.test(def.id)) invalid.push(dataRef('permit', def.id, 'idFormat', def.id));
    pushItemRef(invalid, 'permit', def.id, 'itemId', def.itemId);
    if (def.title.trim().length === 0) invalid.push(dataRef('permit', def.id, 'title', def.title));
    if (def.accessTags.length === 0) invalid.push(dataRef('permit', def.id, 'accessTags', 'empty'));
    for (const tag of def.accessTags) if (!ID_RE.test(tag)) invalid.push(dataRef('permit', def.id, 'accessTags', tag));
    if (def.floors.length === 0) invalid.push(dataRef('permit', def.id, 'floors', 'empty'));
    for (const floor of def.floors) if (!isFloorLevel(floor)) invalid.push(dataRef('permit', def.id, 'floors', floor));
    if (def.severity < 1 || def.severity > 5) invalid.push(dataRef('permit', def.id, 'severity', def.severity));
    if (!['private', 'local', 'witnessed', 'public'].includes(def.privacy)) invalid.push(dataRef('permit', def.id, 'privacy', def.privacy));
    if (def.successLine.trim().length < 16) invalid.push(dataRef('permit', def.id, 'successLine', def.successLine));
    for (const cost of def.factionCost) {
      if (!FACTION_IDS.has(cost.faction)) invalid.push(dataRef('permit', def.id, 'factionCost.faction', cost.faction));
      if (cost.delta === 0) invalid.push(dataRef('permit', def.id, `factionCost.${cost.faction}.delta`, cost.delta));
    }
    for (const rumorId of def.rumorIds ?? []) if (!rumorIds.has(rumorId)) invalid.push(dataRef('permit', def.id, 'rumorIds', rumorId));
  }

  const permitItemIds = new Set(PERMIT_DEFS.map(def => def.itemId));
  for (const recipe of PERMIT_FORGERY_RECIPES) {
    if (!ID_RE.test(recipe.id)) invalid.push(dataRef('permitForgery', recipe.id, 'idFormat', recipe.id));
    pushItemRef(invalid, 'permitForgery', recipe.id, 'outputItemId', recipe.outputItemId);
    if (!permitItemIds.has(recipe.outputItemId)) invalid.push(dataRef('permitForgery', recipe.id, 'outputPermit', recipe.outputItemId));
    recipe.inputItemIds.forEach((itemId, index) => pushItemRef(invalid, 'permitForgery', recipe.id, `inputItemIds[${index}]`, itemId));
    if (recipe.inputItemIds.length === 0) invalid.push(dataRef('permitForgery', recipe.id, 'inputItemIds', 'empty'));
    for (const tag of recipe.eventTags) if (!ID_RE.test(tag)) invalid.push(dataRef('permitForgery', recipe.id, 'eventTags', tag));
    for (const rumorId of recipe.rumorIds) if (!rumorIds.has(rumorId)) invalid.push(dataRef('permitForgery', recipe.id, 'rumorIds', rumorId));
  }

  for (const [key, def] of Object.entries(COMPUTER_DEFS)) {
    if (key !== def.id) invalid.push(dataRef('computer', key, 'id', def.id));
    if (def.label.trim().length === 0) invalid.push(dataRef('computer', def.id, 'label', def.label));
    if (def.prompt.trim().length === 0) invalid.push(dataRef('computer', def.id, 'prompt', def.prompt));
    if (def.stealRewardRubles < 0) invalid.push(dataRef('computer', def.id, 'stealRewardRubles', def.stealRewardRubles));
    if (def.pages.length === 0) invalid.push(dataRef('computer', def.id, 'pages', 'empty'));
    def.pages.forEach((page, index) => {
      if (page.title.trim().length === 0) invalid.push(dataRef('computer', def.id, `pages[${index}].title`, page.title));
      if (page.lines.length === 0) invalid.push(dataRef('computer', def.id, `pages[${index}].lines`, 'empty'));
    });
  }

  for (const [key, def] of Object.entries(NET_HACK_TERMINALS)) {
    if (key !== def.id) invalid.push(dataRef('netHackTerminal', key, 'id', def.id));
    if (def.baseDifficulty <= 0) invalid.push(dataRef('netHackTerminal', def.id, 'baseDifficulty', def.baseDifficulty));
    if (def.randomDifficultyMax < 0) invalid.push(dataRef('netHackTerminal', def.id, 'randomDifficultyMax', def.randomDifficultyMax));
    if (def.rewardRubles < 0) invalid.push(dataRef('netHackTerminal', def.id, 'rewardRubles', def.rewardRubles));
    if (def.failPsiDamage < 0) invalid.push(dataRef('netHackTerminal', def.id, 'failPsiDamage', def.failPsiDamage));
    if (def.failHpDamage < 0) invalid.push(dataRef('netHackTerminal', def.id, 'failHpDamage', def.failHpDamage));
  }

  for (const def of EMERGENCY_PANEL_DEFS) {
    if (!ID_RE.test(def.id)) invalid.push(dataRef('emergencyPanel', def.id, 'idFormat', def.id));
    if (def.weight <= 0) invalid.push(dataRef('emergencyPanel', def.id, 'weight', def.weight));
    if (!/^#[0-9a-f]{6}$/i.test(def.color)) invalid.push(dataRef('emergencyPanel', def.id, 'color', def.color));
    if (def.roomTypes.length === 0) invalid.push(dataRef('emergencyPanel', def.id, 'roomTypes', 'empty'));
    for (const roomType of def.roomTypes) if (!ROOM_TYPE_IDS.has(roomType)) invalid.push(dataRef('emergencyPanel', def.id, 'roomTypes', roomType));
    for (const geometryId of Object.keys(def.geometryWeights)) {
      if (!geometryIds.has(geometryId)) invalid.push(dataRef('emergencyPanel', def.id, 'geometryWeights', geometryId));
      if ((def.geometryWeights[geometryId] ?? 0) <= 0) invalid.push(dataRef('emergencyPanel', def.id, `geometryWeights.${geometryId}`, def.geometryWeights[geometryId]));
    }
    if (def.repairCost.length === 0) invalid.push(dataRef('emergencyPanel', def.id, 'repairCost', 'empty'));
    def.repairCost.forEach((cost, index) => pushItemStackRefs(invalid, 'emergencyPanel', def.id, `repairCost[${index}]`, { defId: cost.itemId, count: cost.count }));
    assertUnique(`emergencyPanel ${def.id} tag`, [...def.tags]);
    for (const tag of def.tags) if (!ID_RE.test(tag)) invalid.push(dataRef('emergencyPanel', def.id, 'tags', tag));
    for (const [action, label] of Object.entries(def.actionLabels)) {
      if (label.trim().length === 0) invalid.push(dataRef('emergencyPanel', def.id, `actionLabels.${action}`, label));
    }
  }

  assert.deepEqual(invalid, [], 'permit, terminal, and emergency panel references must resolve');
});

test('monster ecology and floor catalog ids are unique and valid', () => {
  assertUnique('monster ecology', MONSTER_ECOLOGY.map(e => String(e.kind)));
  assertUnique('floor catalog', FLOOR_CATALOG.map(f => f.id));
  assertUnique('floor instance', FLOOR_INSTANCES.map(f => f.id));

  const rumorIds = new Set(RUMORS.map(r => r.id));
  const invalid: string[] = [];

  for (const [kind, def] of Object.entries(MONSTERS)) {
    if (def.kind !== Number(kind)) invalid.push(dataRef('monster', kind, 'kind', def.kind));
  }

  for (const e of MONSTER_ECOLOGY) {
    if (!monsterExists(e.kind)) invalid.push(dataRef('monsterEcology', e.kind, 'kind', e.kind));
    for (const floor of e.floors) if (!isFloorLevel(floor)) invalid.push(dataRef('monsterEcology', e.kind, 'floors', floor));
    for (const roomType of e.rooms) if (!ROOM_TYPE_IDS.has(roomType)) invalid.push(dataRef('monsterEcology', e.kind, 'rooms', roomType));
    for (const rumorId of e.rumorIds) if (!rumorIds.has(rumorId)) invalid.push(dataRef('monsterEcology', e.kind, 'rumorIds', rumorId));
    e.rareDrops.forEach((drop, index) => pushItemRef(invalid, 'monsterEcology', e.kind, `rareDrops[${index}].itemId`, drop.itemId));
  }

  for (const f of FLOOR_CATALOG) {
    if (!ID_RE.test(f.id)) invalid.push(dataRef('floorCatalog', f.id, 'idFormat', f.id));
    if (!isFloorLevel(f.baseFloor)) invalid.push(dataRef('floorCatalog', f.id, 'baseFloor', f.baseFloor));
    if (f.tags.length === 0) invalid.push(dataRef('floorCatalog', f.id, 'tags', 'empty'));
  }
  for (const f of FLOOR_INSTANCES) {
    if (!ID_RE.test(f.id)) invalid.push(dataRef('floorInstance', f.id, 'idFormat', f.id));
    if (!isFloorLevel(f.baseFloor)) invalid.push(dataRef('floorInstance', f.id, 'baseFloor', f.baseFloor));
    if (!rumorIds.has(f.rumorId)) invalid.push(dataRef('floorInstance', f.id, 'rumorId', f.rumorId));
    if (f.generatorId !== 'story_pocket') invalid.push(dataRef('floorInstance', f.id, 'generatorId', f.generatorId));
    if (f.exitRule !== 'next_lift_returns') invalid.push(dataRef('floorInstance', f.id, 'exitRule', f.exitRule));
    if (f.npcPolicy !== 'none' && f.npcPolicy !== 'generator') invalid.push(dataRef('floorInstance', f.id, 'npcPolicy', f.npcPolicy));
    if (f.monsterPolicy !== 'none' && f.monsterPolicy !== 'generator') invalid.push(dataRef('floorInstance', f.id, 'monsterPolicy', f.monsterPolicy));
    if (f.samosborPolicy !== 'normal' && f.samosborPolicy !== 'exempt') invalid.push(dataRef('floorInstance', f.id, 'samosborPolicy', f.samosborPolicy));
    if (f.debugCommandId !== 'arm_floor_instance') invalid.push(dataRef('floorInstance', f.id, 'debugCommandId', f.debugCommandId));
    if (!f.lore.trim()) invalid.push(dataRef('floorInstance', f.id, 'lore', 'empty'));
    if (!f.tags.includes('numbered_lift')) invalid.push(dataRef('floorInstance', f.id, 'tags', 'missing numbered_lift'));
    if (f.risk < 1 || f.risk > 5) invalid.push(dataRef('floorInstance', f.id, 'risk', f.risk));
    if (f.weight <= 0) invalid.push(dataRef('floorInstance', f.id, 'weight', f.weight));
  }

  assert.deepEqual(invalid, [], 'monster/floor references must resolve');
});
