import { EntityType, Faction, Occupation, type Entity } from '../core/types';
import { occupationProfile } from '../data/occupation_profiles';

export const KARMA_MIN = -127;
export const KARMA_MAX = 127;
export const PLAYER_START_KARMA = 0;
export const PLAYER_SELF_RELATION = 100;

export interface RankStats {
  level?: number;
  money?: number;
  kills?: number;
  npcKills?: number;
  monsterKills?: number;
  karma?: number;
}

export function clampKarma(value: number): number {
  return Math.max(KARMA_MIN, Math.min(KARMA_MAX, Math.trunc(value)));
}

export function getEntityLevel(entity: Pick<Entity, 'rpg'>): number {
  return Math.max(1, Math.floor(entity.rpg?.level ?? 1));
}

export function rankScore(stats: RankStats): number {
  const level = Math.max(1, Math.floor(stats.level ?? 1));
  const kills = Math.max(0, Math.floor(stats.kills ?? 0));
  const npcKills = Math.max(0, Math.floor(stats.npcKills ?? 0));
  const monsterKills = Math.max(0, Math.floor(stats.monsterKills ?? 0));
  const money = Math.max(0, Math.floor(stats.money ?? 0));
  const karma = clampKarma(stats.karma ?? 0);
  return level * 1000 +
    kills * 40 +
    npcKills * 140 +
    monsterKills * 70 +
    Math.floor(Math.sqrt(money)) * 3 +
    karma * 5;
}

export function entityRankScore(entity: Entity): number {
  return rankScore({
    level: getEntityLevel(entity),
    money: (entity.money ?? 0) + (entity.accountRubles ?? 0),
    kills: entity.kills,
    npcKills: entity.npcKills,
    monsterKills: entity.monsterKills,
    karma: entity.karma,
  });
}

export function addKarma(entity: Entity, delta: number): number {
  const next = clampKarma((entity.karma ?? 0) + delta);
  entity.karma = next;
  return next;
}

export function recordEntityKill(killer: Entity, victim: Entity): void {
  if (victim.type !== EntityType.NPC && victim.type !== EntityType.MONSTER) return;
  killer.kills = Math.max(0, Math.floor(killer.kills ?? 0)) + 1;
  if (victim.type === EntityType.NPC) killer.npcKills = Math.max(0, Math.floor(killer.npcKills ?? 0)) + 1;
  else killer.monsterKills = Math.max(0, Math.floor(killer.monsterKills ?? 0)) + 1;
}

export function initialNpcKarma(faction: Faction, occupation: Occupation, roll: number): number {
  const factionBase = faction === Faction.SCIENTIST ? 28
    : faction === Faction.LIQUIDATOR ? 12
      : faction === Faction.CITIZEN ? 4
        : faction === Faction.WILD ? -14
          : faction === Faction.CULTIST ? -42
            : 0;
  const occupationBonus = occupationProfile(occupation)?.karmaOffset ?? 0;
  const jitter = Math.round((Math.max(0, Math.min(1, roll)) * 2 - 1) * 34);
  return clampKarma(factionBase + occupationBonus + jitter);
}
