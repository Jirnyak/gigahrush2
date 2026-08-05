import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction, QuestType, type Quest } from '../src/core/types';
import { World } from '../src/core/world';
import { checkQuests, resetNonStoryQuestsForNewPlayer } from '../src/systems/quests';
import { makeGameState, makeTestEntity, makeTestNpc, makeTestPlayer } from './helpers';

function quest(overrides: Partial<Quest>): Quest {
  return {
    id: 1,
    type: QuestType.FETCH,
    giverId: 10,
    giverName: 'NPC',
    desc: 'test',
    targetItem: 'bread',
    targetCount: 1,
    done: false,
    ...overrides,
  };
}

test('death continuation resets non-story quests and keeps plot quests', () => {
  const plot = quest({ id: 1, plotStepIndex: 0 });
  const procedural = quest({ id: 2, giverId: 20 });
  const side = quest({ id: 3, giverId: 21, sideQuestId: 'side_test' });
  const contract = quest({ id: 4, giverId: 22, contractId: 'contract_test' });
  const state = makeGameState({
    quests: [plot, procedural, side, contract],
    activeQuestId: 2,
  });
  const giver = makeTestNpc({ id: 20, questId: 2, canGiveQuest: false });

  assert.equal(resetNonStoryQuestsForNewPlayer(state, [giver]), 3);

  assert.deepEqual(state.quests.map(q => q.id), [1]);
  assert.equal(state.activeQuestId, undefined);
  assert.equal(giver.questId, -1);
  assert.equal(giver.canGiveQuest, true);
});

test('dead plot talk target auto-completes the active story talk quest', () => {
  const player = makeTestPlayer({ id: 1 });
  const target = makeTestEntity({
    id: 42,
    type: EntityType.NPC,
    name: 'Баринов',
    faction: Faction.CITIZEN,
    plotNpcId: 'barni',
    alive: false,
  });
  const state = makeGameState({
    quests: [quest({
      id: 79,
      type: QuestType.TALK,
      giverId: 10,
      giverName: 'Ольга Дмитриевна',
      desc: 'Поговорить с Бариновым.',
      targetItem: undefined,
      targetCount: undefined,
      targetPlotNpcId: 'barni',
      targetNpcName: 'Баринов',
      plotStepIndex: 0,
    })],
  });

  checkQuests(player, new World(), [player, target], state, state.msgs);

  assert.equal(state.quests[0].done, true);
  assert.equal(state.msgs.some(line => line.text.includes('Поручение закрыто')), true);
});
