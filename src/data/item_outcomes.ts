import {
  Faction,
  FloorLevel,
  Occupation,
  type WorldEventPrivacy,
  type WorldEventSeverity,
} from '../core/types';

export type ItemOutcomeKind = 'handoff' | 'sale';

export interface ItemOutcomeRuleMatch {
  itemTags?: readonly string[];
  buyerPlotNpcIds?: readonly string[];
  buyerFactions?: readonly Faction[];
  buyerOccupations?: readonly Occupation[];
  buyerRoleTags?: readonly string[];
  floorLevels?: readonly FloorLevel[];
  routeTags?: readonly string[];
  questTags?: readonly string[];
}

export interface ItemOutcomeRelationDelta {
  faction: Faction;
  targetFaction: Faction;
  delta: number;
}

export interface ItemOutcomeRule {
  id: string;
  itemId: string;
  outcome: string;
  kind: ItemOutcomeKind;
  match: ItemOutcomeRuleMatch;
  rewardMoney: number;
  message: string;
  messageColor: string;
  severity: WorldEventSeverity;
  privacy: WorldEventPrivacy;
  eventTags: readonly string[];
  rumorIds: readonly string[];
  relationDeltas?: readonly ItemOutcomeRelationDelta[];
}

export const ITEM_OUTCOME_RULES: readonly ItemOutcomeRule[] = [
  {
    id: 'maronary_shaving_science_yakov',
    itemId: 'maronary_shaving',
    outcome: 'science',
    kind: 'handoff',
    match: { buyerPlotNpcIds: ['yakov'] },
    rewardMoney: 280,
    message: 'Яков спрятал зелёную стружку отдельно от бумаг: «Это не покупка, это изъятие из логики». +{reward}₽',
    messageColor: '#8cf',
    severity: 4,
    privacy: 'witnessed',
    eventTags: ['handoff', 'science'],
    rumorIds: ['samosbor_maronary_shaving'],
    relationDeltas: [
      { faction: Faction.PLAYER, targetFaction: Faction.SCIENTIST, delta: 6 },
      { faction: Faction.PLAYER, targetFaction: Faction.CULTIST, delta: -2 },
    ],
  },
  {
    id: 'maronary_shaving_science_buyer',
    itemId: 'maronary_shaving',
    outcome: 'science',
    kind: 'handoff',
    match: {
      buyerFactions: [Faction.SCIENTIST],
      buyerOccupations: [Occupation.SCIENTIST],
    },
    rewardMoney: 280,
    message: '{buyer} купил стружку для НИИ и сразу спросил, какая дверь повторилась. +{reward}₽',
    messageColor: '#8cf',
    severity: 4,
    privacy: 'witnessed',
    eventTags: ['handoff', 'science'],
    rumorIds: ['samosbor_maronary_shaving'],
    relationDeltas: [
      { faction: Faction.PLAYER, targetFaction: Faction.SCIENTIST, delta: 6 },
      { faction: Faction.PLAYER, targetFaction: Faction.CULTIST, delta: -2 },
    ],
  },
  {
    id: 'maronary_shaving_cult_buyer',
    itemId: 'maronary_shaving',
    outcome: 'cult',
    kind: 'handoff',
    match: {
      buyerFactions: [Faction.CULTIST],
      buyerOccupations: [Occupation.PILGRIM, Occupation.PRIEST],
    },
    rewardMoney: 320,
    message: '{buyer} принял зелёную стружку как возвращённый слог стены. Деньги отсчитаны без взгляда в глазок. +{reward}₽',
    messageColor: '#c8f',
    severity: 4,
    privacy: 'witnessed',
    eventTags: ['handoff', 'cult'],
    rumorIds: ['samosbor_maronary_cult_buyer'],
    relationDeltas: [
      { faction: Faction.PLAYER, targetFaction: Faction.CULTIST, delta: 7 },
      { faction: Faction.PLAYER, targetFaction: Faction.SCIENTIST, delta: -4 },
    ],
  },
  {
    id: 'maronary_shaving_ministry_buyer',
    itemId: 'maronary_shaving',
    outcome: 'ministry',
    kind: 'handoff',
    match: {
      floorLevels: [FloorLevel.MINISTRY],
      buyerPlotNpcIds: ['rotenbergov', 'kantselev'],
      buyerOccupations: [Occupation.DIRECTOR, Occupation.SECRETARY],
      buyerFactions: [Faction.CITIZEN],
    },
    rewardMoney: 240,
    message: '{buyer} оформил стружку как зелёный инцидент. Продажа звучит как признание маршрута. +{reward}₽',
    messageColor: '#fa0',
    severity: 4,
    privacy: 'witnessed',
    eventTags: ['handoff', 'ministry'],
    rumorIds: ['samosbor_maronary_ministry_buyer'],
    relationDeltas: [
      { faction: Faction.PLAYER, targetFaction: Faction.CITIZEN, delta: -2 },
      { faction: Faction.PLAYER, targetFaction: Faction.SCIENTIST, delta: -2 },
    ],
  },
  {
    id: 'maronary_shaving_quick_sale',
    itemId: 'maronary_shaving',
    outcome: 'sale',
    kind: 'sale',
    match: {},
    rewardMoney: 190,
    message: '{buyer} купил стружку и завернул её дважды. Теперь вопрос купил вас обратно и знает вашу дверь. +{reward}₽',
    messageColor: '#8cf',
    severity: 3,
    privacy: 'local',
    eventTags: ['handoff', 'sale'],
    rumorIds: ['samosbor_maronary_shaving'],
    relationDeltas: [
      { faction: Faction.PLAYER, targetFaction: Faction.CITIZEN, delta: -1 },
    ],
  },
];
