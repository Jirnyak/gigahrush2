import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EntityType, FloorLevel, Faction, MonsterKind, QuestType, type Quest } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import {
  MAX_STORY_DROPS_PER_FACT,
  STORY_DROP_RULES,
  STORY_ITEM_OUTCOME_RULES,
  type StoryItemOutcomeRule,
} from '../src/data/story_outcomes';
import { getRecentEvents } from '../src/systems/events';
import {
  applyStoryItemOutcomes,
  spawnStoryDeathDrops,
  storyDeathDropCandidates,
} from '../src/systems/story_outcomes';
import { countInventoryItem, makeGameState, makeTestEntity, makeTestPlayer } from './helpers';

function shadowQuest(): Quest {
  return {
    id: 50,
    type: QuestType.KILL,
    giverId: 7,
    giverName: 'Ванька Банчиный',
    desc: 'Убей теневика.',
    targetMonsterKind: MonsterKind.SHADOW,
    killCount: 0,
    killNeeded: 1,
    plotStepIndex: 5,
    done: false,
  };
}

function shadowMonster() {
  return makeTestEntity({
    id: 100,
    type: EntityType.MONSTER,
    x: 12,
    y: 12,
    faction: Faction.MONSTER,
    monsterKind: MonsterKind.SHADOW,
    name: 'Теневик',
  });
}

test('story death drop appears only when its quest prerequisite is active', () => {
  const noQuest = makeGameState({ currentFloor: FloorLevel.LIVING });
  const entities = [shadowMonster()];
  const nextId = { v: 200 };

  assert.equal(spawnStoryDeathDrops(entities[0], true, entities, nextId, noQuest, noQuest.msgs, () => 0.5), 0);
  assert.equal(entities.some(e => e.type === EntityType.ITEM_DROP), false);

  const active = makeGameState({ currentFloor: FloorLevel.LIVING });
  active.quests = [shadowQuest()];
  const activeEntities = [shadowMonster()];

  assert.equal(spawnStoryDeathDrops(activeEntities[0], true, activeEntities, nextId, active, active.msgs, () => 0.5), 1);
  const drop = activeEntities.find(e => e.type === EntityType.ITEM_DROP);
  assert.equal(drop?.inventory?.[0]?.defId, 'strange_clot');
  assert.equal(active.msgs.some(line => line.text.includes('сгусток')), true);
});

test('default story outcome registry references existing items', () => {
  const missing: string[] = [];
  for (const rule of STORY_DROP_RULES) {
    for (const drop of rule.drops) {
      if (!ITEMS[drop.itemId]) missing.push(`${rule.id}:drop:${drop.itemId}`);
    }
  }
  for (const rule of STORY_ITEM_OUTCOME_RULES) {
    if (!ITEMS[rule.itemId]) missing.push(`${rule.id}:item:${rule.itemId}`);
  }

  assert.deepEqual(missing, []);
});

test('picked story item can complete the same quest edge as a talk interaction', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ inventory: [{ defId: 'temp_pass', count: 1 }] });
  const quest: Quest = {
    id: 77,
    type: QuestType.TALK,
    giverId: 10,
    giverName: 'Ольга Дмитриевна',
    desc: 'Поговорить с Бариновым или принести записку.',
    targetPlotNpcId: 'barni',
    plotStepIndex: 0,
    done: false,
  };
  state.quests = [quest];
  const rule: StoryItemOutcomeRule = {
    id: 'test_note_counts_as_talk',
    itemId: 'temp_pass',
    triggers: ['pickup'],
    outcome: {
      kind: 'complete_quest',
      quest: { plotStepIndex: 0, type: QuestType.TALK, targetPlotNpcId: 'barni' },
    },
    eventTags: ['test_story_note'],
  };

  assert.equal(applyStoryItemOutcomes({
    trigger: 'pickup',
    item: { defId: 'temp_pass', count: 1 },
    player,
    entities: [],
    state,
    msgs: state.msgs,
  }, [rule]), 1);

  assert.equal(quest.done, true);
  assert.equal(getRecentEvents(state, { type: 'quest_completed', tags: ['quest', 'completed'], limit: 1 }).length, 1);
});

test('story item use can consume evidence after completing an equivalent quest outcome', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const player = makeTestPlayer({ inventory: [{ defId: 'temp_pass', count: 1 }] });
  const quest: Quest = {
    id: 78,
    type: QuestType.TALK,
    giverId: 10,
    giverName: 'Ольга Дмитриевна',
    desc: 'Сдать пропуск как показание.',
    targetPlotNpcId: 'barni',
    plotStepIndex: 0,
    done: false,
  };
  state.quests = [quest];
  const rule: StoryItemOutcomeRule = {
    id: 'test_pass_use_counts_as_talk',
    itemId: 'temp_pass',
    triggers: ['use'],
    outcome: {
      kind: 'complete_quest',
      quest: { plotStepIndex: 0, type: QuestType.TALK, targetPlotNpcId: 'barni' },
      consumeItem: true,
    },
    eventTags: ['test_story_use'],
  };

  assert.equal(applyStoryItemOutcomes({
    trigger: 'use',
    item: { defId: 'temp_pass', count: 1 },
    player,
    entities: [],
    state,
    msgs: state.msgs,
  }, [rule]), 1);

  assert.equal(quest.done, true);
  assert.equal(countInventoryItem(player, 'temp_pass'), 0);
  assert.equal(getRecentEvents(state, { type: 'player_use_item', tags: ['story_outcome', 'use'], limit: 1 })[0]?.data?.ruleId, 'test_pass_use_counts_as_talk');
});

test('malformed and over-cap story drop data is sanitized', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const rules: unknown[] = [
    null,
    { id: 'bad_source', source: { kind: 'pickup' }, drops: [{ itemId: 'water' }] },
    {
      id: 'over_cap',
      source: { kind: 'death', entityTypes: [EntityType.MONSTER], monsterKinds: [MonsterKind.SHADOW] },
      drops: Array.from({ length: MAX_STORY_DROPS_PER_FACT + 3 }, (_, index) => ({
        itemId: index % 2 === 0 ? 'water' : 'missing_item',
        count: 1,
      })),
    },
  ];

  const candidates = storyDeathDropCandidates({ killed: shadowMonster(), killerIsPlayer: true, state }, rules);
  assert.equal(candidates.length <= MAX_STORY_DROPS_PER_FACT, true);
  assert.equal(candidates.every(candidate => candidate.itemId === 'water'), true);
});

test('main has no direct strange_clot story-drop branch after migration', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.equal(main.includes('hasPlotShadowQuest'), false);
  assert.equal(main.includes('Drop strange_clot'), false);
});
