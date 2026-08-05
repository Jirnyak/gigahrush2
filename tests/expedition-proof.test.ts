import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FloorLevel, QuestType, RoomType } from '../src/core/types';
import { CONTRACTS, contractToQuest, questTargetEventData, questTargetRoute } from '../src/data/contracts';
import {
  SMOKE_DEBUG_COMMAND_IDS,
  getDebugCommandIndex,
  type DebugCommandId,
} from '../src/systems/debug';

const EXPEDITION_PROOF_CONTRACT_ID = 'exp_maint_pressure_repair';
const PROOF_ROUTE: readonly {
  key: keyof typeof SMOKE_DEBUG_COMMAND_IDS;
  id: DebugCommandId;
  labelPart: string;
}[] = [
  { key: 'expeditionProofPrep', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofPrep, labelPart: 'подготовка' },
  { key: 'expeditionProofLiftReady', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofLiftReady, labelPart: 'лифт готов' },
  { key: 'expeditionProofCollectorsArrival', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofCollectorsArrival, labelPart: 'прибытие в Коллекторы' },
  { key: 'expeditionProofRisk', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofRisk, labelPart: 'риск маршрута' },
  { key: 'expeditionProofContainer', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofContainer, labelPart: 'контейнер маршрута' },
  { key: 'expeditionProofSamosborWarning', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofSamosborWarning, labelPart: 'предупреждение самосбора' },
  { key: 'expeditionProofReturn', id: SMOKE_DEBUG_COMMAND_IDS.expeditionProofReturn, labelPart: 'возврат домой' },
] as const;

function sourcePath(relativePath: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', relativePath);
}

function quotedId(text: string, id: string): boolean {
  return text.includes(`'${id}'`) || text.includes(`"${id}"`);
}

function debugLabel(source: string, id: string): string | undefined {
  const pattern = new RegExp(`\\{\\s*id:\\s*['"]${id}['"],\\s*label:\\s*['"]([^'"]+)['"]\\s*\\}`);
  return pattern.exec(source)?.[1];
}

test('expedition proof debug commands form the shipped player-readable route', () => {
  const debugSource = readFileSync(sourcePath('src/systems/debug.ts'), 'utf8');
  const smokeSource = readFileSync(sourcePath('scripts/smoke-playability.mjs'), 'utf8');

  assert.ok(
    debugSource.includes(`const EXPEDITION_PROOF_CONTRACT_ID = '${EXPEDITION_PROOF_CONTRACT_ID}'`),
    'prep command must be wired to the expedition proof contract id',
  );
  assert.ok(
    debugSource.includes(`spawnContractById(state, EXPEDITION_PROOF_CONTRACT_ID, ['debug_route', 'expedition_proof'])`),
    'prep command must publish the proof route as a debug-spawned assignment',
  );

  const indexes = PROOF_ROUTE.map(step => getDebugCommandIndex(step.id));
  assert.deepEqual(indexes.filter(index => index < 0), [], 'all proof commands must resolve through the debug API');
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
    'proof commands must stay in route order: prep, lift, arrival, risk, container, warning, return',
  );

  for (const step of PROOF_ROUTE) {
    const label = debugLabel(debugSource, step.id);
    assert.ok(label?.includes('EXPEDITION'), `${step.id} must be visibly grouped in the debug menu`);
    assert.ok(label?.includes(step.labelPart), `${step.id} label must expose route step "${step.labelPart}"`);
    assert.ok(quotedId(smokeSource, step.id), `smoke script must keep the stable hook id ${step.id}`);
    assert.equal(SMOKE_DEBUG_COMMAND_IDS[step.key], step.id, `${step.key} must map to the expected stable id`);
  }
});

test('expedition proof contract carries risk, container objective, reward, and return-readable target data', () => {
  const def = CONTRACTS.find(contract => contract.id === EXPEDITION_PROOF_CONTRACT_ID);
  assert.ok(def, 'expedition proof contract definition must exist');
  assert.equal(def.title, 'Манометр для перепада');
  assert.equal(def.type, QuestType.FETCH);
  assert.equal(def.target.floor, FloorLevel.MAINTENANCE);
  assert.equal(def.target.roomType, RoomType.PRODUCTION);
  assert.equal(def.target.zoneTag, 'pressure_station');
  assert.equal(def.targetItem, 'manometer');
  assert.equal(def.targetCount, 1);
  assert.equal(def.rewardItem, 'filtered_water');
  assert.equal(def.rewardCount, 3);
  assert.ok(def.extraRewards?.some(reward => reward.defId === 'sealant_tube'), 'reward must include repair-relevant sealant');
  assert.equal(def.rewardResourceId, 'drink_water');
  assert.ok(def.target.hint.includes('Коллекторы'), 'target hint must name the route floor');
  assert.ok(def.target.hint.includes('насосная') || def.target.hint.includes('пост давления'), 'target hint must name a concrete risky area');

  for (const tag of ['expedition', 'floor_maintenance', 'room_production', 'container', 'tool_locker', 'repair', 'water']) {
    assert.ok(def.tags.includes(tag), `contract must include ${tag} tag`);
  }

  const quest = contractToQuest(def, 42);
  assert.equal(quest.contractId, EXPEDITION_PROOF_CONTRACT_ID);
  assert.equal(quest.targetFloor, FloorLevel.MAINTENANCE);
  assert.equal(quest.targetRoomType, RoomType.PRODUCTION);
  assert.equal(quest.targetZoneTag, 'pressure_station');
  assert.equal(quest.targetHint, def.target.hint);
  assert.equal(quest.targetMarker?.floor, FloorLevel.MAINTENANCE);
  assert.equal(quest.targetMarker?.roomType, RoomType.PRODUCTION);
  assert.equal(quest.targetMarker?.zoneTag, 'pressure_station');
  assert.equal(quest.targetMarker?.risk, 2);
  assert.equal(quest.rewardItem, 'filtered_water');
  assert.equal(quest.moneyReward, def.moneyReward);
});

test('all system contracts keep route-readable quest and event target data', () => {
  for (const def of CONTRACTS) {
    assert.ok(def.target.hint.trim().length >= 12, `${def.id} needs a concrete target hint`);

    const quest = contractToQuest(def, 10_000);
    assert.equal(quest.contractId, def.id, `${def.id} must survive as quest contract id`);
    assert.equal(quest.targetFloor, def.target.floor, `${def.id} must preserve target floor`);
    assert.equal(quest.targetRoomType, def.target.roomType, `${def.id} must preserve target room type`);
    assert.equal(quest.targetZoneTag, def.target.zoneTag, `${def.id} must preserve target zone tag`);
    assert.equal(quest.targetHint, def.target.hint, `${def.id} must preserve target hint`);
    assert.equal(quest.targetMarker?.floor, def.target.floor, `${def.id} must expose marker floor`);
    assert.equal(quest.targetMarker?.roomType, def.target.roomType, `${def.id} must expose marker room type`);
    assert.equal(quest.targetMarker?.zoneTag, def.target.zoneTag, `${def.id} must expose marker zone tag`);
    assert.ok(questTargetRoute(quest), `${def.id} must expose a route target`);

    const eventData = questTargetEventData(quest);
    assert.equal(eventData.targetFloor, def.target.floor, `${def.id} event data must include target floor`);
    assert.equal(eventData.targetHint, def.target.hint, `${def.id} event data must include target hint`);
    assert.deepEqual(eventData.targetMarker, quest.targetMarker, `${def.id} event data must include target marker`);
    if (def.target.zoneTag) {
      assert.equal(eventData.targetZoneTag, def.target.zoneTag, `${def.id} event data must include target zone tag`);
    }
  }
});
