import { Faction } from '../core/types';
import {
  ECONOMY_MONEY_BANDS,
  economyProgressBandForRoute,
  hasMajorRewardTag,
  type EconomyProgressBand,
} from '../data/economics';

export type QuestRewardObjectiveKind = 'fetch' | 'visit' | 'kill' | 'talk' | 'repair' | 'steal' | 'expose' | 'escort' | 'hold' | 'route';

export interface QuestRewardInput {
  objectiveKind: QuestRewardObjectiveKind;
  objectiveValue?: number;
  objectiveCount?: number;
  routeDistance?: number;
  currentZ?: number;
  targetZ?: number;
  danger?: 1 | 2 | 3 | 4 | 5;
  plotPhase?: number;
  giverLevel?: number;
  giverWealth?: number;
  giverFaction?: Faction;
  risk?: number;
  urgency?: number;
  scarcityMult?: number;
  playerRewardMult?: number;
  authoredBaseMoney?: number;
  authoredBaseXp?: number;
  tags?: readonly string[];
}

export interface QuestRewardResult {
  difficulty: number;
  moneyReward: number;
  xpReward: number;
  moneyCap: number;
  band: EconomyProgressBand;
}

const OBJECTIVE_BASE: Record<QuestRewardObjectiveKind, number> = {
  talk: 0.9,
  visit: 0.8,
  fetch: 1.0,
  repair: 1.15,
  kill: 1.35,
  steal: 1.6,
  expose: 1.6,
  route: 1.65,
  hold: 1.8,
  escort: 1.8,
};

export const QUEST_REWARD_MONEY_MULTIPLIER = 2;
export const QUEST_REWARD_XP_MULTIPLIER = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundCash(value: number): number {
  if (value >= 10_000) return Math.round(value / 500) * 500;
  if (value >= 1_000) return Math.round(value / 50) * 50;
  if (value >= 100) return Math.round(value / 5) * 5;
  return Math.round(value);
}

function factionBudgetMult(faction: Faction | undefined): number {
  switch (faction) {
    case Faction.SCIENTIST:
    case Faction.LIQUIDATOR:
      return 1.18;
    case Faction.WILD:
    case Faction.CULTIST:
      return 0.92;
    default:
      return 1;
  }
}

function giverWealthMult(wealth: number): number {
  if (!Number.isFinite(wealth) || wealth <= 0) return 1;
  return clamp(1 + Math.log10(1 + wealth) * 0.08, 1, 1.55);
}

export function calculateQuestReward(input: QuestRewardInput): QuestRewardResult {
  const danger = clamp(Math.round(input.danger ?? 1), 1, 5) as 1 | 2 | 3 | 4 | 5;
  const currentZ = Math.trunc(input.currentZ ?? 0);
  const targetZ = Math.trunc(input.targetZ ?? currentZ);
  const routeSteps = Math.abs(targetZ - currentZ);
  const band = economyProgressBandForRoute(danger, targetZ);
  const bandDef = ECONOMY_MONEY_BANDS[band];
  const typeBase = OBJECTIVE_BASE[input.objectiveKind] ?? 1;
  const objectiveValue = Math.max(0, input.objectiveValue ?? 0) * Math.max(1, input.objectiveCount ?? 1);
  const objectiveMult = clamp(1 + Math.log2(1 + objectiveValue / 60) * 0.24, 1, 3.2);
  const distance = Math.max(0, input.routeDistance ?? 0);
  const routeDistanceMult = clamp(1 + routeSteps / 24 + distance / 220, 1, 2.4);
  const routeDangerMult = clamp(1 + (danger - 1) * 0.38, 1, 3.0);
  const plotPhaseMult = clamp(1 + Math.max(0, input.plotPhase ?? 0) * 0.16, 1, 4.0);
  const giverLevelMult = clamp(1 + Math.max(0, (input.giverLevel ?? 1) - 1) * 0.045, 1, 2.0);
  const riskMult = clamp(1 + Math.max(0, input.risk ?? 1) * 0.22, 1, 3.0);
  const urgencyMult = clamp(input.urgency ?? 1, 1, 1.5);
  const rawDifficulty = Math.round(
    typeBase *
    objectiveMult *
    routeDistanceMult *
    routeDangerMult *
    plotPhaseMult *
    giverLevelMult *
    riskMult *
    urgencyMult *
    10,
  ) / 10;
  const difficulty = clamp(rawDifficulty, 0.1, 10);
  const baseRate = Math.max(bandDef.baseQuestCashRate, input.authoredBaseMoney ?? 0);
  const rawMoney = baseRate *
    rawDifficulty *
    QUEST_REWARD_MONEY_MULTIPLIER *
    clamp(input.scarcityMult ?? 1, 0.5, 3) *
    clamp(input.playerRewardMult ?? 1, 1, 1.7) *
    factionBudgetMult(input.giverFaction) *
    giverWealthMult(input.giverWealth ?? 0);
  const majorAllowed = hasMajorRewardTag(input.tags);
  const moneyCap = majorAllowed ? bandDef.ordinaryQuestCap : Math.min(bandDef.ordinaryQuestCap, 99_000);
  const moneyReward = Math.max(0, roundCash(clamp(rawMoney, 0, moneyCap)));
  const xpReward = Math.max(
    1,
    Math.round(Math.max(input.authoredBaseXp ?? 0, 20 * rawDifficulty) * QUEST_REWARD_XP_MULTIPLIER),
  );
  return { difficulty, moneyReward, xpReward, moneyCap, band };
}

export function scaleAuthoredQuestRewards<T extends { difficulty?: number; contractId?: string; xpReward?: number; moneyReward?: number }>(quest: T): T {
  if (quest.difficulty !== undefined || quest.contractId !== undefined) return quest;
  if (quest.xpReward !== undefined && Number.isFinite(quest.xpReward) && quest.xpReward > 0) {
    quest.xpReward = Math.round(quest.xpReward * QUEST_REWARD_XP_MULTIPLIER);
  }
  if (quest.moneyReward !== undefined && Number.isFinite(quest.moneyReward) && quest.moneyReward > 0) {
    quest.moneyReward = roundCash(quest.moneyReward * QUEST_REWARD_MONEY_MULTIPLIER);
  }
  return quest;
}
