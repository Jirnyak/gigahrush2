import {
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  QuestType,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../core/types';

export const MAX_STORY_DROPS_PER_FACT = 4;
export const MAX_STORY_ITEM_OUTCOMES_PER_TRIGGER = 4;

export type StoryOutcomeTrigger = 'pickup' | 'use' | 'handoff' | 'interact';

export interface StoryQuestSelector {
  questId?: number;
  plotStepIndex?: number;
  sideQuestId?: string;
  contractId?: string;
  type?: QuestType;
  targetItem?: string;
  targetPlotNpcId?: string;
  targetMonsterKind?: MonsterKind;
}

export interface StoryOutcomeCondition {
  activeQuest?: StoryQuestSelector;
  completedQuest?: StoryQuestSelector;
  ownedItemId?: string;
  floorLevels?: readonly FloorLevel[];
  routeTags?: readonly string[];
}

export interface StoryDropSourceMatcher {
  kind: 'death';
  killer?: 'player' | 'any';
  entityTypes?: readonly EntityType[];
  plotNpcIds?: readonly string[];
  actorPackageIds?: readonly string[];
  monsterKinds?: readonly MonsterKind[];
  factions?: readonly Faction[];
}

export interface StoryDropItemDef {
  itemId: string;
  count?: number;
  data?: unknown;
}

export interface StoryDropRule {
  id: string;
  source: StoryDropSourceMatcher;
  condition?: StoryOutcomeCondition;
  drops: readonly StoryDropItemDef[];
  message?: string;
  messageColor?: string;
  severity?: WorldEventSeverity;
  privacy?: WorldEventPrivacy;
  eventTags?: readonly string[];
}

export interface StoryQuestOutcomeDef {
  kind: 'complete_quest';
  quest: StoryQuestSelector;
  consumeItem?: boolean;
}

export interface StoryItemOutcomeRule {
  id: string;
  itemId: string;
  triggers: readonly StoryOutcomeTrigger[];
  condition?: StoryOutcomeCondition;
  outcome: StoryQuestOutcomeDef;
  message?: string;
  messageColor?: string;
  severity?: WorldEventSeverity;
  privacy?: WorldEventPrivacy;
  eventTags?: readonly string[];
}

export const STORY_DROP_RULES: readonly StoryDropRule[] = [
  {
    id: 'shadow_plot_strange_clot_drop',
    source: {
      kind: 'death',
      killer: 'player',
      entityTypes: [EntityType.MONSTER],
      monsterKinds: [MonsterKind.SHADOW],
    },
    condition: {
      activeQuest: {
        plotStepIndex: 5,
        type: QuestType.KILL,
        targetMonsterKind: MonsterKind.SHADOW,
      },
    },
    drops: [{ itemId: 'strange_clot', count: 1 }],
    message: 'Теневик выронил странный пульсирующий сгусток!',
    messageColor: '#c8f',
    severity: 3,
    privacy: 'local',
    eventTags: ['story_drop', 'shadow', 'strange_clot'],
  },
];

export const STORY_ITEM_OUTCOME_RULES: readonly StoryItemOutcomeRule[] = [
  {
    id: 'shadow_clot_fetch_outcome',
    itemId: 'strange_clot',
    triggers: ['pickup', 'handoff'],
    condition: {
      activeQuest: {
        plotStepIndex: 6,
        type: QuestType.FETCH,
        targetItem: 'strange_clot',
      },
    },
    outcome: {
      kind: 'complete_quest',
      quest: {
        plotStepIndex: 6,
        type: QuestType.FETCH,
        targetItem: 'strange_clot',
      },
    },
    message: 'Сгусток засчитан как целое доказательство по поручению.',
    messageColor: '#c8f',
    severity: 3,
    privacy: 'local',
    eventTags: ['story_outcome', 'shadow', 'strange_clot'],
  },
];
