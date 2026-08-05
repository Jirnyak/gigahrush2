import test from 'node:test';
import assert from 'node:assert/strict';

import { FloorLevel, MonsterKind, QuestType } from '../src/core/types';
import { CONTRACTS, contractToQuest, questTargetRoute } from '../src/data/contracts';
import { isQuestTargetOnCurrentFloor } from '../src/systems/contracts';
import { notifyKill, notifyNpcKill } from '../src/systems/quests';
import { makeGameState } from './helpers';

test('generic kill quests count matching monsters on any current floor', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY });
  state.quests = [{
    id: 1,
    type: QuestType.KILL,
    giverId: 10,
    giverName: 'Охотник',
    desc: 'Убей теневика.',
    targetMonsterKind: MonsterKind.SHADOW,
    killCount: 0,
    killNeeded: 2,
    done: false,
  }];

  notifyKill(MonsterKind.SHADOW, state);

  assert.equal(state.quests[0].killCount, 1);
});

test('floor-targeted kill quests do not count matching monsters on a wrong floor', () => {
  const wrongFloor = makeGameState({ currentFloor: FloorLevel.LIVING });
  wrongFloor.quests = [{
    id: 2,
    type: QuestType.KILL,
    giverId: 11,
    giverName: 'Ликвидатор',
    desc: 'Убей глаз в коллекторах.',
    targetFloor: FloorLevel.MAINTENANCE,
    targetMonsterKind: MonsterKind.EYE,
    killCount: 0,
    killNeeded: 1,
    done: false,
  }];

  notifyKill(MonsterKind.EYE, wrongFloor);

  assert.equal(wrongFloor.quests[0].killCount, 0);

  const rightFloor = makeGameState({ currentFloor: FloorLevel.MAINTENANCE });
  rightFloor.quests = [{ ...wrongFloor.quests[0], killCount: 0 }];

  notifyKill(MonsterKind.EYE, rightFloor);

  assert.equal(rightFloor.quests[0].killCount, 1);
});

test('plot NPC kill quests do not count ordinary monster kills', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY });
  state.quests = [{
    id: 4,
    type: QuestType.KILL,
    giverId: 12,
    giverName: 'Секретарь',
    desc: 'Убери печатееда с личным делом.',
    targetPlotNpcId: 'plot_pechateed',
    killCount: 0,
    killNeeded: 1,
    done: false,
  }];

  notifyKill(MonsterKind.TVAR, state);

  assert.equal(state.quests[0].killCount, 0);

  notifyNpcKill('plot_pechateed', state);

  assert.equal(state.quests[0].killCount, 1);
});

test('risk-only contract route metadata does not bypass target floor checks', () => {
  const def = CONTRACTS.find(contract => contract.id === 'compact_ministry_pechateed_kill');
  assert.ok(def);
  const quest = contractToQuest(def, 3);
  assert.equal(quest.targetFloor, FloorLevel.MINISTRY);
  assert.ok(questTargetRoute(quest), 'contract keeps route metadata for HUD/risk');

  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  assert.equal(isQuestTargetOnCurrentFloor(quest, state), false);
});
