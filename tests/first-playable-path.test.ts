import test from 'node:test';
import assert from 'node:assert/strict';

import { FloorLevel, LiftDirection, QuestType, type Quest } from '../src/core/types';
import { World } from '../src/core/world';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName } from '../src/data/npc_packages';
import { PLOT_CHAIN } from '../src/data/plot';
import { setFloorRunState } from '../src/systems/procedural_floors';
import {
  getActiveQuest,
  getCurrentObjective,
  nextAvailablePlotStepForNpc,
  npcCanGiveQuestNow,
  npcHasImportantQuestAction,
  npcHasQuestMarker,
  npcQuestMarkerState,
  npcQuestActionHint,
  offerQuest,
  toggleActiveQuest,
} from '../src/systems/quests';
import { getObjectiveRouteHud, routeObjectiveLiftPromptSuffix } from '../src/systems/route_cues';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function plotNpcName(plotNpcId: string): string {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  assert.ok(pack, `missing NPC package for plot NPC ${plotNpcId}`);
  return npcPackageDisplayName(pack);
}

test('fresh run exposes Olga as the first soft objective', () => {
  const state = makeGameState();
  const olga = makeTestNpc({ id: 10, name: plotNpcName('olga'), plotNpcId: 'olga', canGiveQuest: true });
  const barni = makeTestNpc({ id: 11, name: plotNpcName('barni'), plotNpcId: 'barni', canGiveQuest: true });

  const objective = getCurrentObjective(state, [olga, barni]);

  assert.equal(objective?.line, 'Вводная Ольги');
  assert.equal(objective?.source, 'plot_offer');
  assert.equal(objective?.targetEntityId, olga.id);
  assert.equal(nextAvailablePlotStepForNpc(olga, state)?.index, 0);
  assert.equal(npcHasImportantQuestAction(olga, state), true);
  assert.equal(npcHasQuestMarker(olga, state), true);
  assert.deepEqual(npcQuestMarkerState(olga, state), { tone: 'authored', active: true, showExclamation: true });
  assert.equal(npcHasQuestMarker(barni, state), false);
  assert.deepEqual(npcQuestMarkerState(barni, state), { tone: 'authored', active: false, showExclamation: false });
  assert.match(npcQuestActionHint(olga, state) ?? '', /Баринов/);
});

test('accepted first plot step points to Sergeant Barinov and the armory range', () => {
  const olga = makeTestNpc({ id: 10, name: plotNpcName('olga'), plotNpcId: 'olga', canGiveQuest: true });
  const barni = makeTestNpc({ id: 11, name: plotNpcName('barni'), plotNpcId: 'barni', canGiveQuest: true });
  const quest: Quest = {
    id: 1,
    type: QuestType.TALK,
    giverId: olga.id,
    giverName: olga.name ?? plotNpcName('olga'),
    desc: PLOT_CHAIN[0].desc,
    targetNpcId: barni.id,
    targetNpcName: barni.name,
    targetPlotNpcId: 'barni',
    plotStepIndex: 0,
    done: false,
  };
  const state = makeGameState({ quests: [quest], nextQuestId: 2 });

  const objective = getCurrentObjective(state, [olga, barni]);

  assert.equal(objective?.line, 'Найти сержанта Баринова в оружейной и получить табельное.');
  assert.equal(objective?.targetEntityId, barni.id);
  assert.equal(npcHasImportantQuestAction(barni, state), true);
  assert.equal(npcCanGiveQuestNow(barni, state), false);
  assert.equal(npcHasQuestMarker(olga, state), false);
  assert.equal(npcHasQuestMarker(barni, state), true);
  assert.match(npcQuestActionHint(barni, state) ?? '', /Баринов/);

  quest.done = true;
  assert.equal(npcCanGiveQuestNow(barni, state), true);
  assert.equal(npcHasQuestMarker(barni, state), true);
});

test('player-selected active quest overrides the automatic objective and toggles off', () => {
  const plotQuest: Quest = {
    id: 1,
    type: QuestType.TALK,
    giverId: 10,
    giverName: plotNpcName('olga'),
    desc: PLOT_CHAIN[0].desc,
    targetPlotNpcId: 'barni',
    plotStepIndex: 0,
    done: false,
  };
  const sideQuest: Quest = {
    id: 2,
    type: QuestType.VISIT,
    giverId: 20,
    giverName: 'Дежурная по лестнице',
    desc: 'Проверить сухую кладовую.',
    targetRoom: 7,
    sideQuestId: 'test_storage_check',
    done: false,
  };
  const state = makeGameState({ quests: [plotQuest, sideQuest], nextQuestId: 3 });

  assert.equal(getCurrentObjective(state)?.questId, plotQuest.id);
  assert.equal(toggleActiveQuest(state, sideQuest.id)?.id, sideQuest.id);
  assert.equal(getActiveQuest(state)?.id, sideQuest.id);
  assert.equal(getCurrentObjective(state)?.questId, sideQuest.id);

  assert.equal(toggleActiveQuest(state, sideQuest.id), undefined);
  assert.equal(getActiveQuest(state), undefined);
  assert.equal(getCurrentObjective(state)?.questId, plotQuest.id);
});

test('quest marker state separates authored and procedural NPC map roles', () => {
  const state = makeGameState();
  const giver = makeTestNpc({ id: 20, name: 'Диспетчер', canGiveQuest: true });
  const target = makeTestNpc({ id: 21, name: 'Адресат', canGiveQuest: false });

  assert.deepEqual(npcQuestMarkerState(giver, state), { tone: 'procedural', active: true, showExclamation: true });

  state.quests.push({
    id: 77,
    type: QuestType.TALK,
    giverId: giver.id,
    giverName: giver.name ?? 'Диспетчер',
    desc: 'Передай сообщение.',
    targetNpcId: target.id,
    targetNpcName: target.name,
    done: false,
  });

  assert.equal(npcQuestMarkerState(giver, state), null);
  assert.deepEqual(npcQuestMarkerState(target, state), { tone: 'procedural', active: true, showExclamation: false });

  state.quests[0].done = true;
  assert.equal(npcQuestMarkerState(target, state), null);
});

test('Olga quest action accepts the first plot step instead of ambient no-op', () => {
  const world = new World();
  const player = makeTestPlayer({ id: 1, x: 10, y: 10 });
  const olga = makeTestNpc({
    id: 10,
    name: plotNpcName('olga'),
    plotNpcId: 'olga',
    canGiveQuest: true,
    x: 11,
    y: 10,
  });
  const state = makeGameState({ time: 7 });

  offerQuest(olga, player, world, [player, olga], state, state.msgs, { v: 20 });

  assert.equal(state.quests.length, 1);
  assert.equal(state.quests[0].plotStepIndex, 0);
  assert.equal(state.quests[0].targetPlotNpcId, 'barni');
  assert.equal(olga.questId, state.quests[0].id);
  assert.match(state.msgs.at(-1)?.text ?? '', /Принято задание|Новое поручение/);
  assert.equal(state.msgs.some(m => /Пока ничего|нечего тебе поручить/.test(m.text)), false);
});

test('route objective HUD prioritizes the active plot route and labels its lift', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 123, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);

  const systemQuest: Quest = {
    id: 20,
    type: QuestType.FETCH,
    giverId: -20,
    giverName: 'Пост давления',
    desc: 'Принеси манометр с нижнего маршрута.',
    targetItem: 'manometer',
    targetCount: 1,
    targetFloor: FloorLevel.MAINTENANCE,
    targetRoute: { z: -20, label: 'Z-20 Коллекторы', risk: 2 },
    moneyReward: 2000,
    done: false,
  };
  const plotQuest: Quest = {
    id: 21,
    type: QuestType.VISIT,
    giverId: 10,
    giverName: plotNpcName('olga'),
    desc: 'Проверить верхний ручной маршрут до отчета Якову.',
    plotStepIndex: 3,
    targetFloor: FloorLevel.KVARTIRY,
    targetRoute: { z: 12, label: 'Z+12 НИИ слизевой пробы', risk: 4 },
    targetHint: 'Верхний маршрут важнее оплаченной рутины.',
    done: false,
  };
  state.quests.push(systemQuest, plotQuest);

  const hud = getObjectiveRouteHud(state);

  assert.equal(hud.questId, plotQuest.id);
  assert.match(hud.target, /Z\+12 НИИ слизевой пробы/);
  assert.match(hud.lift, /Лифт ↑ к цели от Z\+0/);
  assert.match(hud.risk, /Верхний маршрут важнее оплаченной рутины/);
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.UP), ' / ЦЕЛЬ');
  assert.equal(routeObjectiveLiftPromptSuffix(state, LiftDirection.DOWN), '');
});
