/* ── RPG system: levels, XP, attributes, PSI ─────────────────── */

import {
  type Entity,
  type RPGStats,
  type Msg,
  W,
  EntityType,
  MonsterKind,
  FloorLevel,
  msg,
} from '../core/types';
import { RPG_ATTRIBUTE_CAP, RPG_LEVEL_CAP } from '../data/rpg_progression';

export { RPG_ATTRIBUTE_CAP, RPG_LEVEL_CAP } from '../data/rpg_progression';

// ── XP formula: first level-up at 100, then soft quadratic growth ──
// xpForLevel(2) = 100, xpForLevel(5) = 295, xpForLevel(10) = 1020.
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const rank = level - 1;
  return 75 + 25 * rank + 10 * rank * (rank - 1);
}

// Total XP needed to reach a given level (from 0)
export function totalXpForLevel(level: number): number {
  const cappedLevel = clampRpgLevel(level);
  let total = 0;
  for (let i = 1; i <= cappedLevel; i++) total += xpForLevel(i);
  return total;
}

// ── Base stats + per-level linear growth ─────────────────────────
const BASE_HP = 100;
const HP_PER_LEVEL = 1;
const BASE_PSI = 100;
const PSI_PER_LEVEL = 1;
const STR_HP_PER_POINT = 0.01;
const STR_MELEE_DAMAGE_PER_POINT = 0.01;
export const HUMANOID_BASE_MOVE_SPEED = 2.0;
const AGI_MOVE_SPEED_PER_POINT = 0.01;
const AGI_ATTACK_COOLDOWN_PER_POINT = 0.02;
const AGI_SPREAD_PER_POINT = 0.12;
const INT_PSI_PER_POINT = 0.01;
const INT_PSI_DURATION_SEC_PER_POINT = 1;
const INT_XP_BONUS_PER_POINT = 0.08;
const INT_XP_BONUS_ASYMPTOTE = 1.0;
const INT_CONTRACT_REWARD_PER_POINT = 0.04;
const INT_CONTRACT_REWARD_ASYMPTOTE = 0.5;
const INT_DOCUMENT_REWARD_PER_POINT = 0.06;
const INT_DOCUMENT_REWARD_ASYMPTOTE = 0.7;
const INT_PSI_COST_EFFICIENCY_PER_POINT = 0.035;
const STR_DURABILITY_WEAR_PER_POINT = 0.08;
const HEAVY_WEAPON_COOLDOWN = 0.65;
const STR_HEAVY_WEAPON_SPEED_PER_POINT = 0.05;

export function clampRpgLevel(level: number): number {
  return Math.max(1, Math.min(RPG_LEVEL_CAP, Math.floor(Number.isFinite(level) ? level : 1)));
}

export function clampRpgAttribute(points: number): number {
  return Math.max(0, Math.min(RPG_ATTRIBUTE_CAP, Math.floor(Number.isFinite(points) ? points : 0)));
}

export function getLevelHp(level: number): number {
  const cappedLevel = clampRpgLevel(level);
  return BASE_HP + HP_PER_LEVEL * (cappedLevel - 1);
}
export function getLevelPsi(level: number): number {
  const cappedLevel = clampRpgLevel(level);
  return BASE_PSI + PSI_PER_LEVEL * (cappedLevel - 1);
}

// ── Fresh RPG stats ──────────────────────────────────────────────
export function freshRPG(level = 1): RPGStats {
  const cappedLevel = clampRpgLevel(level);
  const maxPsi = getLevelPsi(cappedLevel);
  return {
    level: cappedLevel,
    xp: 0,
    attrPoints: 0,
    str: 0,
    agi: 0,
    int: 0,
    psi: maxPsi,
    maxPsi,
  };
}

// ── Random RPG stats for NPC/monster at given level ──────────────
export function randomRPG(level: number): RPGStats {
  const cappedLevel = clampRpgLevel(level);
  const points = Math.max(0, cappedLevel - 1);
  let str = 0, agi = 0, int_ = 0;
  for (let i = 0; i < points; i++) {
    const r = Math.random();
    if (r < 0.34) str++;
    else if (r < 0.67) agi++;
    else int_++;
  }
  const maxPsi = getMaxPsi({ level: cappedLevel, xp: 0, attrPoints: 0, str, agi, int: int_, psi: 0, maxPsi: 0 });
  return {
    level: cappedLevel,
    xp: 0,
    attrPoints: 0,
    str,
    agi,
    int: int_,
    psi: maxPsi,
    maxPsi,
  };
}

function positivePoints(points: number): number {
  return Math.max(0, points);
}

function inverseStatMult(points: number, perPoint: number): number {
  return 1 / (1 + positivePoints(points) * perPoint);
}

function asymptoticBonus(points: number, perPoint: number, asymptote: number): number {
  const p = positivePoints(points);
  if (p <= 0 || perPoint <= 0 || asymptote <= 0) return 0;
  return asymptote * (1 - Math.exp(-(p * perPoint) / asymptote));
}

// ── Compute effective max PSI (level base + INT multiplier) ──────
export function getMaxPsi(rpg: RPGStats): number {
  return Math.round(getLevelPsi(rpg.level) * (1 + Math.max(0, rpg.int) * INT_PSI_PER_POINT));
}

// ── Compute effective max HP (level base + STR multiplier) ───────
export function getMaxHp(rpg: RPGStats): number {
  return Math.round(getLevelHp(rpg.level) * (1 + Math.max(0, rpg.str) * STR_HP_PER_POINT));
}

// ── Attribute multipliers ────────────────────────────────────────
export function strMeleeDmgMult(rpg: RPGStats): number { return 1 + Math.max(0, rpg.str) * STR_MELEE_DAMAGE_PER_POINT; }
export function meleeBaseDamage(rpg: RPGStats | undefined, weaponId: string | undefined, weaponDamage: number): number {
  const base = Math.max(0, weaponDamage);
  if (!rpg) return base;
  const levelBonus = Math.max(0, Math.floor(rpg.level) - 1);
  return weaponId ? base + levelBonus : Math.max(1, Math.floor(rpg.level));
}
export function meleeDamage(rpg: RPGStats | undefined, weaponId: string | undefined, weaponDamage: number): number {
  return Math.round(meleeBaseDamage(rpg, weaponId, weaponDamage) * (rpg ? strMeleeDmgMult(rpg) : 1));
}
export function agiSpeedMult(rpg: RPGStats): number { return 1 + positivePoints(rpg.agi) * AGI_MOVE_SPEED_PER_POINT; }
export function actorMoveSpeed(e: Entity): number {
  const base = e.type === EntityType.NPC ? HUMANOID_BASE_MOVE_SPEED : Math.max(0, e.speed);
  return base * (e.rpg ? agiSpeedMult(e.rpg) : 1);
}
export function aiPathMoveSpeed(e: Entity): number {
  return e.type === EntityType.NPC ? actorMoveSpeed(e) : Math.max(0, e.speed);
}
export function normalizeHumanoidBaseMoveSpeed(e: Entity): void {
  if (e.type === EntityType.NPC) e.speed = HUMANOID_BASE_MOVE_SPEED;
}
export function normalizeHumanoidBaseMoveSpeeds(entities: Iterable<Entity>): void {
  for (const e of entities) normalizeHumanoidBaseMoveSpeed(e);
}
export function agiAttackSpeedMult(rpg: RPGStats): number {
  return inverseStatMult(rpg.agi, AGI_ATTACK_COOLDOWN_PER_POINT);
} // lower cooldown
export function intXpMult(rpg: RPGStats): number {
  return 1 + asymptoticBonus(rpg.int, INT_XP_BONUS_PER_POINT, INT_XP_BONUS_ASYMPTOTE);
}
export function strDurabilityWearMult(rpg: RPGStats): number {
  return inverseStatMult(rpg.str, STR_DURABILITY_WEAR_PER_POINT);
}
export function strHeavyWeaponSpeedMult(rpg: RPGStats, baseCooldown: number): number {
  return baseCooldown >= HEAVY_WEAPON_COOLDOWN
    ? inverseStatMult(rpg.str, STR_HEAVY_WEAPON_SPEED_PER_POINT)
    : 1;
}
export function agiRangedSpreadMult(rpg: RPGStats): number {
  return inverseStatMult(rpg.agi, AGI_SPREAD_PER_POINT);
}
export function intPsiCostMult(rpg: RPGStats): number {
  return inverseStatMult(rpg.int, INT_PSI_COST_EFFICIENCY_PER_POINT);
}
export function intPsiDurationBonusSec(rpg: RPGStats): number {
  return positivePoints(rpg.int) * INT_PSI_DURATION_SEC_PER_POINT;
}
export function intContractRewardMult(rpg: RPGStats): number {
  return 1 + asymptoticBonus(rpg.int, INT_CONTRACT_REWARD_PER_POINT, INT_CONTRACT_REWARD_ASYMPTOTE);
}
export function intDocumentRewardMult(rpg: RPGStats): number {
  return 1 + asymptoticBonus(rpg.int, INT_DOCUMENT_REWARD_PER_POINT, INT_DOCUMENT_REWARD_ASYMPTOTE);
}

export function adjustedPsiCost(baseCost: number, rpg?: RPGStats): number {
  if (!rpg || baseCost <= 0) return baseCost;
  return Math.max(1, Math.round(baseCost * intPsiCostMult(rpg) * 10) / 10);
}

export interface RPGStatEffects {
  maxHp: number;
  maxPsi: number;
  meleeDamageMult: number;
  heavyWeaponSpeedMult: number;
  durabilityWearMult: number;
  moveSpeedMult: number;
  attackCooldownMult: number;
  rangedSpreadMult: number;
  xpMult: number;
  psiCostMult: number;
  psiDurationBonusSec: number;
  contractRewardMult: number;
  documentRewardMult: number;
}

export function rpgStatEffects(rpg: RPGStats): RPGStatEffects {
  return {
    maxHp: getMaxHp(rpg),
    maxPsi: getMaxPsi(rpg),
    meleeDamageMult: strMeleeDmgMult(rpg),
    heavyWeaponSpeedMult: strHeavyWeaponSpeedMult(rpg, HEAVY_WEAPON_COOLDOWN),
    durabilityWearMult: strDurabilityWearMult(rpg),
    moveSpeedMult: agiSpeedMult(rpg),
    attackCooldownMult: agiAttackSpeedMult(rpg),
    rangedSpreadMult: agiRangedSpreadMult(rpg),
    xpMult: intXpMult(rpg),
    psiCostMult: intPsiCostMult(rpg),
    psiDurationBonusSec: intPsiDurationBonusSec(rpg),
    contractRewardMult: intContractRewardMult(rpg),
    documentRewardMult: intDocumentRewardMult(rpg),
  };
}

export function rpgStatEffectsAfterSpend(rpg: RPGStats, attr: 'str' | 'agi' | 'int'): RPGStatEffects {
  return rpgStatEffects({ ...rpg, [attr]: rpg[attr] + 1 });
}

// ── Award XP and handle level-ups ────────────────────────────────
export function awardXP(e: Entity, amount: number, msgs: Msg[], time: number): void {
  if (!e.rpg) return;
  e.rpg.level = clampRpgLevel(e.rpg.level);
  if (e.rpg.level >= RPG_LEVEL_CAP) {
    e.rpg.xp = 0;
    e.rpg.maxPsi = getMaxPsi(e.rpg);
    e.rpg.psi = Math.min(e.rpg.psi, e.rpg.maxPsi);
    return;
  }
  // INT bonus to XP
  const adjusted = Math.max(0, Math.round(amount * intXpMult(e.rpg)));
  if (adjusted <= 0) return;
  e.rpg.xp += adjusted;

  msgs.push(msg(`+${adjusted} XP`, time, '#af4'));

  // Check for level up(s)
  while (e.rpg.level < RPG_LEVEL_CAP && e.rpg.xp >= xpForLevel(e.rpg.level + 1)) {
    e.rpg.xp -= xpForLevel(e.rpg.level + 1);
    e.rpg.level++;
    e.rpg.attrPoints++;
    // Recalculate maxPsi (level + INT)
    e.rpg.maxPsi = getMaxPsi(e.rpg);
    e.rpg.psi = e.rpg.maxPsi; // full PSI on level up
    // Recalculate maxHp (level + STR)
    if (e.maxHp !== undefined) {
      const newMax = getMaxHp(e.rpg);
      const diff = newMax - (e.maxHp ?? 100);
      e.maxHp = newMax;
      if (e.hp !== undefined) e.hp = Math.min(e.maxHp, e.hp + diff);
    }
    msgs.push(msg(`УРОВЕНЬ ${e.rpg.level}! +1 очко атрибутов`, time, '#ff4'));
  }
  if (e.rpg.level >= RPG_LEVEL_CAP) e.rpg.xp = 0;
}

// ── Spend attribute point ────────────────────────────────────────
export function spendAttrPoint(e: Entity, attr: 'str' | 'agi' | 'int'): boolean {
  if (!e.rpg || e.rpg.attrPoints <= 0) return false;
  const current = clampRpgAttribute(e.rpg[attr]);
  if (current >= RPG_ATTRIBUTE_CAP) return false;
  e.rpg.attrPoints--;
  e.rpg[attr] = current + 1;

  // Recalculate derived stats
  if (attr === 'str' && e.maxHp !== undefined) {
    const newMax = getMaxHp(e.rpg);
    const diff = newMax - (e.maxHp ?? 100);
    e.maxHp = newMax;
    if (e.hp !== undefined) e.hp = Math.min(e.maxHp, e.hp + Math.max(0, diff));
  }
  if (attr === 'int') {
    const oldMax = e.rpg.maxPsi;
    e.rpg.maxPsi = getMaxPsi(e.rpg);
    e.rpg.psi = Math.min(e.rpg.maxPsi, e.rpg.psi + Math.max(0, e.rpg.maxPsi - oldMax));
  }
  return true;
}

// ── XP for killing a monster (scales with monster level) ─────────
const MONSTER_BASE_XP: Partial<Record<MonsterKind, number>> = {
  [MonsterKind.SBORKA]:     10,
  [MonsterKind.TVAR]:       50,
  [MonsterKind.POLZUN]:    100,
  [MonsterKind.BETONNIK]:  240,
  [MonsterKind.BETONOED]:  130,
  [MonsterKind.ZOMBIE]:     14,
  [MonsterKind.DIKIY_MERTVYAK]: 16,
  [MonsterKind.EYE]:        35,
  [MonsterKind.NIGHTMARE]:  90,
  [MonsterKind.SHADOW]:     70,
  [MonsterKind.TONKAYA_TEN]: 58,
  [MonsterKind.REBAR]:     110,
  [MonsterKind.MATKA]:     300,
  [MonsterKind.KHOROVAYA_MATKA]: 380,
  [MonsterKind.SOBRANNYY]: 220,
  [MonsterKind.MANCOBUS]:  400,
  [MonsterKind.HERALD]:    360,
  [MonsterKind.CREATOR]:  10_000,
  [MonsterKind.SPIRIT]:    80,
  [MonsterKind.LOZHNYY_DUKH]: 95,
  [MonsterKind.IDOL]:       20,
  [MonsterKind.ROBOT]:      70,
  [MonsterKind.TRUBNYY_AVTOMAT]: 150,
  [MonsterKind.SHOVNIK]:    64,
  [MonsterKind.LAMPOVY]:    56,
  [MonsterKind.LAMPOGLAZ]:  84,
  [MonsterKind.PECHATEED]:  76,
  [MonsterKind.TUBE_EEL]:  110,
  [MonsterKind.PARAGRAPH]:  90,
  [MonsterKind.NELYUD]:    140,
  [MonsterKind.KRYSNOZHKA]: 48,
  [MonsterKind.GREEN_DOG]: 72,
  [MonsterKind.KOSTOREZ]:  190,
  [MonsterKind.SAFEGUARD]: 250,
  [MonsterKind.RZHAVNIK]:   70,
  [MonsterKind.OLGOY]:     170,
};

export function xpForMonsterKill(kind: MonsterKind, monsterLevel: number): number {
  const base = MONSTER_BASE_XP[kind] ?? 10;
  return Math.round(base * (1 + 0.22 * (monsterLevel - 1)));
}

// ── XP for killing an NPC (based on NPC level) ──────────────────
export function xpForNpcKill(npcLevel: number): number {
  return Math.round(10 * (1 + 0.22 * (npcLevel - 1)));
}

// ── Zone level calculation ───────────────────────────────────────
// Level depends on distance from center of the zone grid + floor bonus.
const ZONE_CELL = Math.floor(W / 8); // ~128; must match shared.ts ZONE_CELL
export function calcZoneLevel(zoneCx: number, zoneCy: number, floor: FloorLevel): number {
  // Convert world-space center to grid coordinates (0-7)
  const zx = zoneCx / ZONE_CELL;
  const zy = zoneCy / ZONE_CELL;
  const dx = Math.abs(zx - 3.5);
  const dy = Math.abs(zy - 3.5);
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  const baseLevel = Math.max(1, Math.round(1 + distFromCenter * 1.5));

  // Floor bonus
  const floorBonus: Record<FloorLevel, number> = {
    [FloorLevel.MINISTRY]: 0,
    [FloorLevel.KVARTIRY]: 0,
    [FloorLevel.LIVING]: 0,
    [FloorLevel.MAINTENANCE]: 4,
    [FloorLevel.HELL]: 9,
    [FloorLevel.VOID]: 15,
  };

  return baseLevel + (floorBonus[floor] ?? 0);
}

// ── Scale monster stats by zone level ────────────────────────────
export function scaleMonsterHp(baseHp: number, level: number): number {
  return Math.round(baseHp * (1 + 0.12 * (level - 1)));
}

export function scaleMonsterDmg(baseDmg: number, level: number): number {
  return Math.round(baseDmg * (1 + 0.10 * (level - 1)));
}

export function scaleMonsterSpeed(baseSpeed: number, level: number): number {
  return baseSpeed * (1 + 0.02 * (level - 1));
}

// ── Gaussian random math ──────────────────────────────────────────
export function generateHeight(age: number, isFemale?: boolean): number {
  const base = age < 18 ? (age / 18) * 1.8 : 1.8;
  const height = Math.max(0.2, randomGaussian(base, 0.1 * (base / 1.8)));
  return isFemale ? height * 0.9 : height;
}

export function randomGaussian(center = 0, sigma = 1): number {
  // Box-Muller transform
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return center + z * sigma;
}

// ── Gaussian-ish random level (for NPCs) ─────────────────────────
export function gaussianLevel(center: number, sigma = 2): number {
  return clampRpgLevel(Math.round(randomGaussian(center, sigma)));
}

// ── PSI recovery is explicit: items, rewards, drains and level-ups only ──
export function regenPsi(_e: Entity, _dt: number): void {
}

// ── Quest difficulty based on item value and distance ────────────
export function questDifficulty(
  itemValue: number, distance: number, questTypeBase: number,
): number {
  // itemValue: 0-120, distance: 0-500+
  const valueMod = 1 + itemValue / 30;    // 1.0 - 5.0
  const distMod = 1 + distance / 100;     // 1.0 - 6.0
  return Math.round((questTypeBase * valueMod * distMod) * 10) / 10;
}

// ── XP and money reward from quest difficulty ────────────────────
export function questXpReward(difficulty: number): number {
  return Math.round(20 * difficulty);
}

export function questMoneyReward(difficulty: number): number {
  return Math.round(5 * difficulty);
}
