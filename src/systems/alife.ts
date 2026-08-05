import {
  W,
  Cell,
  type CharacterSex,
  EntityType,
  AIGoal,
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
  type GameState,
  type Item,
  type RPGStats,
} from '../core/types';
import { World } from '../core/world';
import {
  ALIFE_POPULATION_BASELINE,
  ALIFE_POPULATION_CAPACITY,
  ALIFE_POPULATION_MIN_RANDOM,
  buildAlifePopulationPlan,
  clampAlifePopulationTotal,
  type AlifePopulationPlanDef,
  type AlifeReservedIdentityDef,
} from '../data/alife_population_plan';
import { DESIGN_FLOOR_ROUTES } from '../data/design_floors';
import {
  ALIFE_FACTION_PROFILES,
  ALIFE_MAX_LEVEL,
  type AlifeFactionProfile,
  type WeightedValue,
} from '../data/alife_generation';
import { resolveNpcArtVisualId } from '../data/npc_art_visuals';
import { occupationHasRoutineTag, sanitizeOccupation } from '../data/occupation_profiles';
import {
  designFloorAgeRange,
  designFloorFactionWeightMultiplier,
  designFloorFemaleProbability,
} from '../data/design_floor_profiles';
import { MAX_ITEM_STACK } from '../data/inventory_limits';
import {
  RPG_ATTRIBUTE_CAP,
  RPG_LEVEL_CAP,
  generateHeight,
} from './rpg';
import { freshNeeds } from '../data/catalog';
import {
  CITIZEN_FIRST_M, CITIZEN_FIRST_F, CITIZEN_LAST_M, CITIZEN_LAST_F,
  LIQ_RANKS, LIQ_LAST,
  WILD_FIRST_M, WILD_FIRST_F, WILD_NICK,
  CULT_ADJ_M, CULT_ADJ_F, CULT_NOUN_M, CULT_NOUN_F,
  SCIENTIST_TITLE,
} from '../data/names';
import {
  CHARACTER_SEX_MALE,
  characterSexCode,
  characterSexFromCode,
  characterSexFromFemale,
  clampCharacterAge,
  sanitizeCharacterSex,
} from '../data/demographics';
import { sanitizeNpcVisualId } from '../entities/npc_visuals';
import {
  ensureFloorRunState,
  floorRunEntryFloorKey,
  currentFloorRunEntry,
  floorRunEntryForDesignFloor,
} from './procedural_floors';
import { cleanFloorKey, floorKeyForDesign, floorKeyForProcedural, floorKeyForStory } from './floor_keys';
import { generateNpcLoadout, generateMerchantStock } from './procedural_loot';
import { ITEMS } from '../data/catalog';
import { getStack } from '../data/items';
import { getFactionRel } from '../data/relations';
import { HUMANOID_BASE_MOVE_SPEED, getMaxHp, getMaxPsi } from './rpg';
import {
  NPC_PLAYER_RELATION_FLUCTUATION,
  clampRelation,
  getFactionPlayerRelation,
} from './npc_relations';
import {
  clampKarma,
  entityRankScore,
  initialNpcKarma,
  rankScore,
  type RankStats,
} from './alife_rating';
import { getEntityIndex, ENTITY_MASK_NPC } from './entity_index';

const ALIFE_VERSION = 2;
const ALIFE_POPULATION = ALIFE_POPULATION_CAPACITY;
const ALIFE_MIN_FLOOR_POOL = 32;
const ALIFE_SAVE_OVERRIDE_CAP = 12_000;
const ALIFE_SAVE_DEAD_IDS_CAP = 65_536;
const ALIFE_MONEY_CAP = 5_000_000;
const ALIFE_PLAYER_RELATION_UNSET = -128;
const ALIFE_NPC_SPEED_MIN = 0.1;
const ALIFE_NPC_SPEED_MAX = 8;

interface AlifeFloorPlan {
  key: string;
  floor: FloorLevel;
  danger: 1 | 2 | 3 | 4 | 5;
  weight: number;
  majorityFaction?: Faction;
  factionWeights?: readonly WeightedValue<Faction>[];
  occupationWeights?: readonly WeightedValue<Occupation>[];
}

export interface AlifePopulationReservedNpc {
  id?: string;
  kind?: 'plot' | 'authored' | 'event_reserved';
  presence?: 'population' | 'event_only';
  plotNpcId?: string;
  name?: string;
  female?: boolean;
  age?: number;
  sex?: CharacterSex;
  faction?: Faction;
  occupation?: Occupation;
  sprite?: number;
  npcVisualId?: string;
  familyId?: number;
  canGiveQuest?: boolean;
  level?: number;
  rpg?: RPGStats;
  hp?: number;
  maxHp?: number;
  speed?: number;
  isTraveler?: boolean;
  weapon?: string;
  tool?: string;
  inventory?: readonly Item[];
  money?: number;
  accountRubles?: number;
  kills?: number;
  npcKills?: number;
  monsterKills?: number;
  playerRelation?: number;
  karma?: number;
}

export interface AlifePopulationBucket {
  floorKey: string;
  floor: FloorLevel;
  danger?: 1 | 2 | 3 | 4 | 5;
  targetCount?: number;
  weight?: number;
  majorityFaction?: Faction;
  factionWeights?: readonly WeightedValue<Faction>[];
  occupationWeights?: readonly WeightedValue<Occupation>[];
  reserved?: readonly AlifePopulationReservedNpc[];
}

export interface AlifePopulationPlan {
  buckets: readonly AlifePopulationBucket[];
}

export interface CreateAlifeStateOptions {
  populationPlan?: AlifePopulationPlan | AlifePopulationPlanDef;
}

export interface AlifeNpcSnapshot {
  id: number;
  floorKey: string;
  floor: FloorLevel;
  faction: Faction;
  occupation: Occupation;
  name: string;
  firstName: string;
  lastName: string;
  female: boolean;
  age: number;
  sex: CharacterSex;
  level: number;
  hp: number;
  maxHp: number;
  money: number;
  accountRubles: number;
  familyId: number;
  canGiveQuest: boolean;
  sprite?: number;
  npcVisualId?: string;
  spriteSeed?: number;
  playerRelation?: number;
  karma: number;
  dead: boolean;
  reservedKind?: 'plot' | 'authored' | 'event_reserved';
  reservedIdentityId?: string;
  reservedPresence?: 'population' | 'event_only';
  plotNpcId?: string;
  x?: number;
  y?: number;
  angle?: number;
}

export interface MoveAlifeNpcOptions {
  floor?: FloorLevel;
  markTouched?: boolean;
  preservePosition?: boolean;
  x?: number;
  y?: number;
  angle?: number;
}

export interface MaterializeAlifeArrivalOptions {
  x: number;
  y: number;
  angle?: number;
  isTraveler?: boolean;
  goalX?: number;
  goalY?: number;
}

interface AlifeNpcRecord {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  npcVisualId?: string;
  weapon?: string;
  tool?: string;
  inventory?: Item[];
  reservedKind?: 'plot' | 'authored' | 'event_reserved';
  reservedIdentityId?: string;
  reservedPresence?: 'population' | 'event_only';
  speed?: number;
  isTraveler?: boolean;
  plotNpcId?: string;
  x?: number;
  y?: number;
  angle?: number;
}

export interface AlifeNpcOverride {
  id: number;
  floorKey?: string;
  floor?: FloorLevel;
  name?: string;
  firstName?: string;
  lastName?: string;
  female?: boolean;
  age?: number;
  sex?: CharacterSex;
  faction?: Faction;
  occupation?: Occupation;
  familyId?: number;
  canGiveQuest?: boolean;
  x?: number;
  y?: number;
  angle?: number;
  hp?: number;
  money?: number;
  accountRubles?: number;
  weapon?: string;
  tool?: string;
  inventory?: Item[];
  rpg?: RPGStats;
  sprite?: number;
  npcVisualId?: string;
  spriteSeed?: number;
  kills?: number;
  npcKills?: number;
  monsterKills?: number;
  playerRelation?: number;
  karma?: number;
}

export interface AlifeSaveState {
  version: number;
  seed: number;
  total: number;
  playerRelationTargetFaction?: Faction;
  playerRelationTargetAlifeId?: number;
  deadIds: number[];
  deadPlotNpcIds: string[];
  overrides: AlifeNpcOverride[];
}

interface AlifeNumericColumns {
  floorKeyIndex: Uint16Array;
  floor: Uint8Array;
  danger: Uint8Array;
  faction: Uint8Array;
  occupation: Uint8Array;
  age: Uint8Array;
  sex: Uint8Array;
  flags: Uint8Array;
  level: Uint8Array;
  str: Uint8Array;
  agi: Uint8Array;
  int: Uint8Array;
  hp: Uint16Array;
  maxHp: Uint16Array;
  money: Uint32Array;
  accountRubles: Uint32Array;
  familyId: Uint32Array;
  sprite: Uint16Array;
  spriteSeed: Uint32Array;
  kills: Uint32Array;
  npcKills: Uint32Array;
  monsterKills: Uint32Array;
  playerRelation: Int8Array;
  karma: Int8Array;
}

interface AlifeState {
  version: number;
  seed: number;
  total: number;
  playerRelationTargetFaction?: Faction;
  playerRelationTargetAlifeId?: number;
  npcs: AlifeNpcRecord[];
  columns: AlifeNumericColumns;
  floorKeys: string[];
  floorKeyLookup: Record<string, number>;
  floorIndex: Record<string, number[]>;
  deadPlotNpcIds: Set<string>;
  leaderboardVersion: number;
  leaderboardCache?: AlifeLeaderboardSnapshot & { signature: string; limit: number };
}

export interface AlifeLeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  faction: Faction;
  floorKey?: string;
  level: number;
  score: number;
  kills: number;
  npcKills: number;
  monsterKills: number;
  karma: number;
  player: boolean;
}

export interface AlifeLeaderboardSnapshot {
  entries: AlifeLeaderboardEntry[];
  player: AlifeLeaderboardEntry;
  totalAlive: number;
}

interface LegacySampleAlifeFloorRecordOptions {
  faction?: Faction;
  excludeIds?: ReadonlySet<number>;
  maxAttempts?: number;
}

type AlifeHost = GameState & { alife?: AlifeState };

const ALIFE_FLAG_FEMALE = 1 << 0;
const ALIFE_FLAG_CAN_GIVE_QUEST = 1 << 1;
const ALIFE_FLAG_DEAD = 1 << 2;
const ALIFE_FLAG_TOUCHED = 1 << 3;
const ALIFE_FLAG_CUSTOM_LOADOUT = 1 << 4;
const ALIFE_SPRITE_UNSET = 0xffff;
const ALIFE_SPRITE_MAX = ALIFE_SPRITE_UNSET - 1;

function createAlifeNumericColumns(total: number): AlifeNumericColumns {
  const bounded = Math.max(0, Math.floor(total));
  const columns: AlifeNumericColumns = {
    floorKeyIndex: new Uint16Array(bounded),
    floor: new Uint8Array(bounded),
    danger: new Uint8Array(bounded),
    faction: new Uint8Array(bounded),
    occupation: new Uint8Array(bounded),
    age: new Uint8Array(bounded),
    sex: new Uint8Array(bounded),
    flags: new Uint8Array(bounded),
    level: new Uint8Array(bounded),
    str: new Uint8Array(bounded),
    agi: new Uint8Array(bounded),
    int: new Uint8Array(bounded),
    hp: new Uint16Array(bounded),
    maxHp: new Uint16Array(bounded),
    money: new Uint32Array(bounded),
    accountRubles: new Uint32Array(bounded),
    familyId: new Uint32Array(bounded),
    sprite: new Uint16Array(bounded),
    spriteSeed: new Uint32Array(bounded),
    kills: new Uint32Array(bounded),
    npcKills: new Uint32Array(bounded),
    monsterKills: new Uint32Array(bounded),
    playerRelation: new Int8Array(bounded),
    karma: new Int8Array(bounded),
  };
  columns.sprite.fill(ALIFE_SPRITE_UNSET);
  columns.sex.fill(CHARACTER_SEX_MALE);
  columns.playerRelation.fill(ALIFE_PLAYER_RELATION_UNSET);
  return columns;
}

function growUint8Array(input: Uint8Array, size: number): Uint8Array {
  if (input.length >= size) return input;
  const out = new Uint8Array(size);
  out.set(input);
  return out;
}

function growInt8Array(input: Int8Array, size: number, fillValue?: number): Int8Array {
  if (input.length >= size) return input;
  const out = new Int8Array(size);
  out.set(input);
  if (fillValue !== undefined) out.fill(fillValue, input.length);
  return out;
}

function growUint16Array(input: Uint16Array, size: number, fillValue?: number): Uint16Array {
  if (input.length >= size) return input;
  const out = new Uint16Array(size);
  out.set(input);
  if (fillValue !== undefined) out.fill(fillValue, input.length);
  return out;
}

function growUint32Array(input: Uint32Array, size: number): Uint32Array {
  if (input.length >= size) return input;
  const out = new Uint32Array(size);
  out.set(input);
  return out;
}

function ensureAlifeColumnCapacity(alife: AlifeState, requiredId: number): void {
  const required = Math.max(0, Math.floor(requiredId));
  if (alife.columns.level.length >= required) return;
  const next = Math.max(required, alife.columns.level.length * 2, 32);
  alife.columns.floorKeyIndex = growUint16Array(alife.columns.floorKeyIndex, next);
  alife.columns.floor = growUint8Array(alife.columns.floor, next);
  alife.columns.danger = growUint8Array(alife.columns.danger, next);
  alife.columns.faction = growUint8Array(alife.columns.faction, next);
  alife.columns.occupation = growUint8Array(alife.columns.occupation, next);
  alife.columns.age = growUint8Array(alife.columns.age, next);
  const previousSexLength = alife.columns.sex.length;
  alife.columns.sex = growUint8Array(alife.columns.sex, next);
  if (previousSexLength < alife.columns.sex.length) alife.columns.sex.fill(CHARACTER_SEX_MALE, previousSexLength);
  alife.columns.flags = growUint8Array(alife.columns.flags, next);
  alife.columns.level = growUint8Array(alife.columns.level, next);
  alife.columns.str = growUint8Array(alife.columns.str, next);
  alife.columns.agi = growUint8Array(alife.columns.agi, next);
  alife.columns.int = growUint8Array(alife.columns.int, next);
  alife.columns.hp = growUint16Array(alife.columns.hp, next);
  alife.columns.maxHp = growUint16Array(alife.columns.maxHp, next);
  alife.columns.money = growUint32Array(alife.columns.money, next);
  alife.columns.accountRubles = growUint32Array(alife.columns.accountRubles, next);
  alife.columns.familyId = growUint32Array(alife.columns.familyId, next);
  alife.columns.sprite = growUint16Array(alife.columns.sprite, next, ALIFE_SPRITE_UNSET);
  alife.columns.spriteSeed = growUint32Array(alife.columns.spriteSeed, next);
  alife.columns.kills = growUint32Array(alife.columns.kills, next);
  alife.columns.npcKills = growUint32Array(alife.columns.npcKills, next);
  alife.columns.monsterKills = growUint32Array(alife.columns.monsterKills, next);
  alife.columns.playerRelation = growInt8Array(alife.columns.playerRelation, next, ALIFE_PLAYER_RELATION_UNSET);
  alife.columns.karma = growInt8Array(alife.columns.karma, next);
}

function recordColumnIndex(record: AlifeNpcRecord): number {
  return record.id - 1;
}

function internAlifeFloorKey(alife: AlifeState, floorKeyInput: string): number {
  const floorKey = cleanFloorKey(floorKeyInput) || floorKeyForStory(FloorLevel.LIVING);
  const existing = alife.floorKeyLookup[floorKey];
  if (existing !== undefined) return existing;
  const next = alife.floorKeys.length;
  if (next > 0xffff) throw new RangeError('A-Life floor key dictionary exceeded Uint16 capacity');
  alife.floorKeys.push(floorKey);
  alife.floorKeyLookup[floorKey] = next;
  return next;
}

function recordFloorKey(alife: AlifeState, record: AlifeNpcRecord): string {
  return alife.floorKeys[alife.columns.floorKeyIndex[recordColumnIndex(record)]] ?? floorKeyForStory(recordFloor(alife, record));
}

function setRecordFloorKey(alife: AlifeState, record: AlifeNpcRecord, floorKey: string): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.floorKeyIndex[recordColumnIndex(record)] = internAlifeFloorKey(alife, floorKey);
}

function recordFloor(alife: AlifeState, record: AlifeNpcRecord): FloorLevel {
  return (alife.columns.floor[recordColumnIndex(record)] ?? FloorLevel.LIVING) as FloorLevel;
}

function setRecordFloor(alife: AlifeState, record: AlifeNpcRecord, value: FloorLevel): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.floor[recordColumnIndex(record)] = sanitizeFloor(value, FloorLevel.LIVING);
}

function recordDanger(alife: AlifeState, record: AlifeNpcRecord): 1 | 2 | 3 | 4 | 5 {
  const danger = alife.columns.danger[recordColumnIndex(record)];
  return clampInt(danger, 1, 1, 5) as 1 | 2 | 3 | 4 | 5;
}

function setRecordDanger(alife: AlifeState, record: AlifeNpcRecord, value: number): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.danger[recordColumnIndex(record)] = clampInt(value, 1, 1, 5);
}

function recordFaction(alife: AlifeState, record: AlifeNpcRecord): Faction {
  return (alife.columns.faction[recordColumnIndex(record)] ?? Faction.CITIZEN) as Faction;
}

function setRecordFaction(alife: AlifeState, record: AlifeNpcRecord, value: Faction): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.faction[recordColumnIndex(record)] = clampInt(value, Faction.CITIZEN, Faction.CITIZEN, Faction.PLAYER);
}

function recordOccupation(alife: AlifeState, record: AlifeNpcRecord): Occupation {
  return sanitizeOccupation(alife.columns.occupation[recordColumnIndex(record)], Occupation.HOUSEWIFE);
}

function setRecordOccupation(alife: AlifeState, record: AlifeNpcRecord, value: Occupation): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.occupation[recordColumnIndex(record)] = sanitizeOccupation(value, Occupation.HOUSEWIFE);
}

function recordFlag(alife: AlifeState, record: AlifeNpcRecord, flag: number): boolean {
  return (alife.columns.flags[recordColumnIndex(record)] & flag) !== 0;
}

function setRecordFlag(alife: AlifeState, record: AlifeNpcRecord, flag: number, enabled: boolean): void {
  ensureAlifeColumnCapacity(alife, record.id);
  const i = recordColumnIndex(record);
  alife.columns.flags[i] = enabled ? (alife.columns.flags[i] | flag) : (alife.columns.flags[i] & ~flag);
}

function recordFemale(alife: AlifeState, record: AlifeNpcRecord): boolean {
  return recordFlag(alife, record, ALIFE_FLAG_FEMALE);
}

function setRecordFemale(alife: AlifeState, record: AlifeNpcRecord, value: boolean): void {
  setRecordFlag(alife, record, ALIFE_FLAG_FEMALE, value);
}

function recordAge(alife: AlifeState, record: AlifeNpcRecord): number {
  return clampCharacterAge(alife.columns.age[recordColumnIndex(record)], 25);
}

function setRecordAge(alife: AlifeState, record: AlifeNpcRecord, value: unknown, fallback = 25): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.age[recordColumnIndex(record)] = clampCharacterAge(value, fallback);
}

function recordSex(alife: AlifeState, record: AlifeNpcRecord): CharacterSex {
  return characterSexFromCode(alife.columns.sex[recordColumnIndex(record)], recordFemale(alife, record) ? 'female' : 'male');
}

function setRecordSex(alife: AlifeState, record: AlifeNpcRecord, value: CharacterSex): void {
  const sex = sanitizeCharacterSex(value);
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.sex[recordColumnIndex(record)] = characterSexCode(sex);
  setRecordFemale(alife, record, sex === 'female');
}

function setRecordSexFromInput(alife: AlifeState, record: AlifeNpcRecord, sexInput: unknown, femaleInput?: unknown): void {
  if (sexInput === 'male' || sexInput === 'female') {
    setRecordSex(alife, record, sexInput);
  } else if (typeof femaleInput === 'boolean') {
    setRecordSex(alife, record, characterSexFromFemale(femaleInput));
  }
}

function recordCanGiveQuest(alife: AlifeState, record: AlifeNpcRecord): boolean {
  return recordFlag(alife, record, ALIFE_FLAG_CAN_GIVE_QUEST);
}

function setRecordCanGiveQuest(alife: AlifeState, record: AlifeNpcRecord, value: boolean): void {
  setRecordFlag(alife, record, ALIFE_FLAG_CAN_GIVE_QUEST, value);
}

function recordDead(alife: AlifeState, record: AlifeNpcRecord): boolean {
  return recordFlag(alife, record, ALIFE_FLAG_DEAD);
}

function setRecordDead(alife: AlifeState, record: AlifeNpcRecord, value: boolean): void {
  setRecordFlag(alife, record, ALIFE_FLAG_DEAD, value);
}

function recordTouched(alife: AlifeState, record: AlifeNpcRecord): boolean {
  return recordFlag(alife, record, ALIFE_FLAG_TOUCHED);
}

function setRecordTouched(alife: AlifeState, record: AlifeNpcRecord, value = true): void {
  setRecordFlag(alife, record, ALIFE_FLAG_TOUCHED, value);
}

function recordCustomLoadout(alife: AlifeState, record: AlifeNpcRecord): boolean {
  return recordFlag(alife, record, ALIFE_FLAG_CUSTOM_LOADOUT);
}

function setRecordCustomLoadout(alife: AlifeState, record: AlifeNpcRecord, value = true): void {
  setRecordFlag(alife, record, ALIFE_FLAG_CUSTOM_LOADOUT, value);
}

function recordLevel(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.level[recordColumnIndex(record)] || 1;
}

function recordStr(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.str[recordColumnIndex(record)];
}

function recordAgi(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.agi[recordColumnIndex(record)];
}

function recordInt(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.int[recordColumnIndex(record)];
}

function recordPlayerRelation(alife: AlifeState, record: AlifeNpcRecord): number | undefined {
  const relation = alife.columns.playerRelation[recordColumnIndex(record)];
  return relation === ALIFE_PLAYER_RELATION_UNSET ? undefined : relation;
}

function setRecordPlayerRelation(alife: AlifeState, record: AlifeNpcRecord, value: number | undefined): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.playerRelation[recordColumnIndex(record)] = value === undefined
    ? ALIFE_PLAYER_RELATION_UNSET
    : clampRelation(value);
}

function ensureRecordPlayerRelation(alife: AlifeState, record: AlifeNpcRecord): number {
  const existing = recordPlayerRelation(alife, record);
  if (existing !== undefined) return existing;
  return defaultPlayerRelationForRecord(alife, record);
}

function recordKarma(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.karma[recordColumnIndex(record)];
}

function setRecordKarma(alife: AlifeState, record: AlifeNpcRecord, value: number): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.karma[recordColumnIndex(record)] = clampKarma(value);
}

function recordMaxHp(alife: AlifeState, record: AlifeNpcRecord): number {
  const raw = alife.columns.maxHp[recordColumnIndex(record)];
  if (raw > 0) return raw;
  return Math.max(1, getMaxHp(rpgFromRecord(alife, record)));
}

function setRecordMaxHp(alife: AlifeState, record: AlifeNpcRecord, value: number): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.maxHp[recordColumnIndex(record)] = clampInt(value, 1, 1, 65_535);
}

function recordHp(alife: AlifeState, record: AlifeNpcRecord): number {
  const maxHp = recordMaxHp(alife, record);
  const hp = alife.columns.hp[recordColumnIndex(record)];
  return Math.max(0, Math.min(hp, maxHp));
}

function setRecordHp(alife: AlifeState, record: AlifeNpcRecord, value: number): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.hp[recordColumnIndex(record)] = clampInt(value, recordMaxHp(alife, record), 0, recordMaxHp(alife, record));
}

function recordMoney(alife: AlifeState, record: AlifeNpcRecord): number {
  return Math.min(ALIFE_MONEY_CAP, alife.columns.money[recordColumnIndex(record)]);
}

function recordAccountRubles(alife: AlifeState, record: AlifeNpcRecord): number {
  return Math.min(ALIFE_MONEY_CAP, alife.columns.accountRubles[recordColumnIndex(record)]);
}

function setRecordMoney(alife: AlifeState, record: AlifeNpcRecord, money: unknown, accountRubles: unknown): void {
  ensureAlifeColumnCapacity(alife, record.id);
  const split = splitClampedMoney(money, accountRubles);
  const i = recordColumnIndex(record);
  alife.columns.money[i] = split.money;
  alife.columns.accountRubles[i] = split.accountRubles;
}

function recordFamilyId(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.familyId[recordColumnIndex(record)];
}

function setRecordFamilyId(alife: AlifeState, record: AlifeNpcRecord, value: number): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.familyId[recordColumnIndex(record)] = clampInt(value, 0, 0, 1_000_000_000);
}

function recordSprite(alife: AlifeState, record: AlifeNpcRecord): number | undefined {
  const sprite = alife.columns.sprite[recordColumnIndex(record)];
  return sprite === ALIFE_SPRITE_UNSET ? undefined : sprite;
}

function setRecordSprite(alife: AlifeState, record: AlifeNpcRecord, value: number | undefined): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.sprite[recordColumnIndex(record)] = value === undefined
    ? ALIFE_SPRITE_UNSET
    : clampInt(value, 0, 0, ALIFE_SPRITE_MAX);
}

function recordSpriteSeed(alife: AlifeState, record: AlifeNpcRecord): number | undefined {
  return alife.columns.spriteSeed[recordColumnIndex(record)] || undefined;
}

function setRecordSpriteSeed(alife: AlifeState, record: AlifeNpcRecord, value: number | undefined): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.spriteSeed[recordColumnIndex(record)] = value === undefined
    ? 0
    : clampInt(value, 1, 1, 0xffffffff);
}

function recordKills(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.kills[recordColumnIndex(record)];
}

function setRecordKills(alife: AlifeState, record: AlifeNpcRecord, value: unknown): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.kills[recordColumnIndex(record)] = clampInt(value, 0, 0, 1_000_000);
}

function recordNpcKills(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.npcKills[recordColumnIndex(record)];
}

function setRecordNpcKills(alife: AlifeState, record: AlifeNpcRecord, value: unknown): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.npcKills[recordColumnIndex(record)] = clampInt(value, 0, 0, 1_000_000);
}

function recordMonsterKills(alife: AlifeState, record: AlifeNpcRecord): number {
  return alife.columns.monsterKills[recordColumnIndex(record)];
}

function setRecordMonsterKills(alife: AlifeState, record: AlifeNpcRecord, value: unknown): void {
  ensureAlifeColumnCapacity(alife, record.id);
  alife.columns.monsterKills[recordColumnIndex(record)] = clampInt(value, 0, 0, 1_000_000);
}

function setRecordRpg(alife: AlifeState, record: AlifeNpcRecord, rpg: RPGStats): void {
  ensureAlifeColumnCapacity(alife, record.id);
  const previousMaxHp = alife.columns.maxHp[recordColumnIndex(record)];
  const shell = {
    ...rpg,
    level: clampInt(rpg.level, 1, 1, RPG_LEVEL_CAP),
    str: clampInt(rpg.str, 0, 0, RPG_ATTRIBUTE_CAP),
    agi: clampInt(rpg.agi, 0, 0, RPG_ATTRIBUTE_CAP),
    int: clampInt(rpg.int, 0, 0, RPG_ATTRIBUTE_CAP),
  };
  const i = recordColumnIndex(record);
  alife.columns.level[i] = shell.level;
  alife.columns.str[i] = shell.str;
  alife.columns.agi[i] = shell.agi;
  alife.columns.int[i] = shell.int;
  const nextMaxHp = getMaxHp(shell);
  setRecordMaxHp(alife, record, nextMaxHp);
  const nextHp = previousMaxHp > 0 ? Math.min(recordHp(alife, record), nextMaxHp) : nextMaxHp;
  setRecordHp(alife, record, nextHp);
}

// Name pools imported from '../data/names' — single source of truth

function hash32(a: number, b: number, c = 0): number {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d) + c) | 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

function unit(seed: number, index: number, salt: number): number {
  return hash32(seed, index, salt) / 0x100000000;
}

function pickDet<T>(items: readonly T[], seed: number, index: number, salt: number): T {
  return items[Math.floor(unit(seed, index, salt) * items.length) % items.length];
}

function pickWeighted<T>(items: readonly WeightedValue<T>[], seed: number, index: number, salt: number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, item.weight);
  if (total <= 0) return items[0].value;
  let roll = unit(seed, index, salt) * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function defaultAlifePopulation(): number {
  return ALIFE_POPULATION_BASELINE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function packageIdFromReservedIdentityId(reservedIdentityId: string | undefined): string | undefined {
  if (!reservedIdentityId?.startsWith('npc:')) return undefined;
  const id = reservedIdentityId.slice(4);
  return id.length > 0 ? id : undefined;
}

export function findAlifeNpcIdByReservedIdentityId(
  state: GameState,
  reservedIdentityIdInput: string,
  floorKeyInput?: string,
): number | undefined {
  const reservedIdentityId = cleanFloorKey(reservedIdentityIdInput);
  if (!reservedIdentityId) return undefined;
  const alife = ensureAlifeState(state);
  const floorKey = cleanFloorKey(floorKeyInput);
  const scanIndexes = floorKey ? alife.floorIndex[floorKey] : undefined;
  if (scanIndexes) {
    for (const recordIndex of scanIndexes) {
      const record = alife.npcs[recordIndex];
      if (record?.reservedIdentityId === reservedIdentityId) return record.id;
    }
    return undefined;
  }
  for (const record of alife.npcs) {
    if (record.reservedIdentityId === reservedIdentityId) return record.id;
  }
  return undefined;
}

function recordPackageId(record: AlifeNpcRecord): string | undefined {
  return packageIdFromReservedIdentityId(record.reservedIdentityId);
}

function recordCanMaterializeAsOrdinaryPopulation(record: AlifeNpcRecord): boolean {
  if (!record.reservedKind) return true;
  return record.reservedPresence === 'population' && recordPackageId(record) !== undefined;
}

function storyDanger(floor: FloorLevel): 1 | 2 | 3 | 4 | 5 {
  switch (floor) {
    case FloorLevel.LIVING: return 1;
    case FloorLevel.KVARTIRY:
    case FloorLevel.MINISTRY: return 3;
    case FloorLevel.MAINTENANCE: return 4;
    case FloorLevel.HELL:
    case FloorLevel.VOID: return 5;
  }
}

function allocatedCounts(plans: readonly AlifeFloorPlan[], total: number): number[] {
  const sum = plans.reduce((acc, plan) => acc + plan.weight, 0);
  if (sum <= 0 || total <= 0) return plans.map(() => 0);
  const counts = plans.map(plan => {
    const raw = total * plan.weight / sum;
    return plan.weight > 0 ? Math.max(ALIFE_MIN_FLOOR_POOL, Math.floor(raw)) : 0;
  });
  let used = counts.reduce((acc, count) => acc + count, 0);
  if (used > total) {
    for (let i = counts.length - 1; i >= 0 && used > total; i--) {
      const drop = Math.min(counts[i], used - total);
      counts[i] -= drop;
      used -= drop;
    }
  }
  let cursor = 0;
  while (used < total && counts.length > 0) {
    counts[cursor % counts.length]++;
    cursor++;
    used++;
  }
  return counts;
}

function profileForFaction(faction: Faction): AlifeFactionProfile {
  return ALIFE_FACTION_PROFILES.find(profile => profile.faction === faction) ?? ALIFE_FACTION_PROFILES[0];
}

function factionProfileWeight(profile: AlifeFactionProfile, plan: AlifeFloorPlan): number {
  const floorMult = profile.floorWeights[plan.floor] ?? 1;
  const dangerMult = Math.max(0.05, 1 + (plan.danger - 3) * profile.dangerBias);
  const majorityMult = plan.majorityFaction === profile.faction ? 4.5 : 1;
  const designFloorMult = designFloorFactionWeightMultiplier(plan.key, profile.faction);
  return profile.baseWeight * floorMult * dangerMult * majorityMult * designFloorMult;
}

function factionForPlan(plan: AlifeFloorPlan, seed: number, index: number): Faction {
  if (plan.factionWeights && plan.factionWeights.length > 0) return pickWeighted(plan.factionWeights, seed, index, 11);
  const weighted = ALIFE_FACTION_PROFILES.map(profile => ({
    value: profile.faction,
    weight: factionProfileWeight(profile, plan),
  }));
  return pickWeighted(weighted, seed, index, 11);
}

function occupationForRecord(plan: AlifeFloorPlan, profile: AlifeFactionProfile, seed: number, index: number): Occupation {
  if (plan.occupationWeights && plan.occupationWeights.length > 0) return pickWeighted(plan.occupationWeights, seed, index, 24);
  if (profile.faction === Faction.CITIZEN && plan.floor === FloorLevel.MAINTENANCE) {
    return unit(seed, index, 22) < 0.55 ? Occupation.MECHANIC : Occupation.ELECTRICIAN;
  }
  if (profile.faction === Faction.CITIZEN && plan.floor === FloorLevel.MINISTRY) {
    return unit(seed, index, 23) < 0.58 ? Occupation.SECRETARY : Occupation.DIRECTOR;
  }
  return pickWeighted(profile.occupations, seed, index, 24);
}

function nameForRecord(
  plan: AlifeFloorPlan,
  faction: Faction,
  occupation: Occupation,
  seed: number,
  index: number,
): { name: string; firstName: string; lastName: string; female: boolean; sex: CharacterSex } {
  if (faction === Faction.LIQUIDATOR) {
    const rank = pickDet(LIQ_RANKS, seed, index, 31);
    const last = pickDet(LIQ_LAST, seed, index, 32);
    return { name: `${rank} ${last}`, firstName: rank, lastName: last, female: false, sex: 'male' };
  }
  if (faction === Faction.CULTIST) {
    const female = unit(seed, index, 40) < designFloorFemaleProbability(plan.key, occupation, 0.5);
    const adj = pickDet(female ? CULT_ADJ_F : CULT_ADJ_M, seed, index, 33);
    const noun = pickDet(female ? CULT_NOUN_F : CULT_NOUN_M, seed, index, 34);
    return { name: `${adj} ${noun}`, firstName: adj, lastName: noun, female, sex: characterSexFromFemale(female) };
  }
  if (faction === Faction.WILD) {
    const female = unit(seed, index, 41) < designFloorFemaleProbability(plan.key, occupation, 0.33);
    const first = pickDet(female ? WILD_FIRST_F : WILD_FIRST_M, seed, index, 35);
    const nick = pickDet(WILD_NICK, seed, index, 36);
    return { name: `${first} «${nick}»`, firstName: first, lastName: nick, female, sex: characterSexFromFemale(female) };
  }
  if (faction === Faction.SCIENTIST) {
    const female = unit(seed, index, 42) < designFloorFemaleProbability(plan.key, occupation, 0.4);
    const title = pickDet(SCIENTIST_TITLE, seed, index, 43);
    const last = pickDet(female ? CITIZEN_LAST_F : CITIZEN_LAST_M, seed, index, 44);
    return { name: `${title} ${last}`, firstName: title, lastName: last, female, sex: characterSexFromFemale(female) };
  }
  const female = unit(seed, index, 37) < designFloorFemaleProbability(plan.key, occupation, 0.5);
  const first = pickDet(female ? CITIZEN_FIRST_F : CITIZEN_FIRST_M, seed, index, 38);
  const last = pickDet(female ? CITIZEN_LAST_F : CITIZEN_LAST_M, seed, index, 39);
  return { name: `${first} ${last}`, firstName: first, lastName: last, female, sex: characterSexFromFemale(female) };
}

function ageForRecord(
  plan: AlifeFloorPlan,
  faction: Faction,
  occupation: Occupation,
  level: number,
  seed: number,
  index: number,
): number {
  if (occupation === Occupation.CHILD) {
    return clampCharacterAge(7 + Math.floor(unit(seed, index, 45) * 9) + (level > 12 ? 1 : 0), 12);
  }

  let min = 18;
  let max = 67;
  const designAgeRange = designFloorAgeRange(plan.key, occupation);
  if (designAgeRange) {
    min = designAgeRange.min;
    max = designAgeRange.max;
  } else if (faction === Faction.LIQUIDATOR) {
    min = 22;
    max = 58;
  } else if (faction === Faction.SCIENTIST || occupation === Occupation.SCIENTIST) {
    min = 24;
    max = 72;
  } else if (occupation === Occupation.DIRECTOR) {
    min = 34;
    max = 74;
  } else if (occupation === Occupation.HOUSEWIFE || occupation === Occupation.COOK) {
    min = 24;
    max = 63;
  } else if (occupation === Occupation.SECRETARY || occupation === Occupation.TRAVELER) {
    min = 18;
    max = 52;
  } else if (occupation === Occupation.ALCOHOLIC || faction === Faction.WILD) {
    min = 18;
    max = 61;
  } else if (faction === Faction.CULTIST) {
    min = 18;
    max = 70;
  }

  const spread = Math.max(0, max - min);
  const base = min + Math.floor(Math.pow(unit(seed, index, 46), 1.18) * (spread + 1));
  const levelBias = Math.round(Math.sqrt(Math.max(1, level)) * (0.85 + unit(seed, index, 47) * 1.2));
  const prodigyPenalty = unit(seed, index, 48) < 0.11 ? Math.round(unit(seed, index, 49) * 9) : 0;
  const veteranBonus = unit(seed, index, 50) > 0.93 ? Math.round(unit(seed, index, 52) * 12) : 0;
  return clampCharacterAge(Math.max(min, Math.min(max + 10, base + levelBias + veteranBonus - prodigyPenalty)), min);
}

function rpgForRecord(level: number, seed: number, index: number): RPGStats {
  const points = Math.max(0, level - 1);
  let str = 0;
  let agi = 0;
  let int = 0;
  for (let i = 0; i < points; i++) {
    const roll = unit(seed, index, 100 + i);
    if (roll < 0.34) str++;
    else if (roll < 0.67) agi++;
    else int++;
  }
  const shell = { level, xp: 0, attrPoints: 0, str, agi, int, psi: 0, maxPsi: 0 };
  const maxPsi = getMaxPsi(shell);
  return { ...shell, psi: maxPsi, maxPsi };
}

function levelForRecord(plan: AlifeFloorPlan, faction: Faction, seed: number, index: number): number {
  const eliteBias = faction === Faction.LIQUIDATOR || faction === Faction.SCIENTIST || faction === Faction.CULTIST ? 0.14 : 0;
  const exponent = Math.max(0.82, Math.min(1.48, 1.46 - plan.danger * 0.11 - eliteBias));
  const scaled = Math.pow(unit(seed, index, 41), exponent) * Math.log(ALIFE_MAX_LEVEL + 1);
  return Math.max(1, Math.min(ALIFE_MAX_LEVEL, 1 + Math.floor(Math.expm1(scaled))));
}

function wealthForRecord(plan: AlifeFloorPlan, profile: AlifeFactionProfile, level: number, seed: number, index: number): number {
  const floorMult = plan.floor === FloorLevel.MINISTRY ? 2.4
    : plan.key === floorKeyForDesign('bank_floor') ? 6.5
      : plan.floor === FloorLevel.MAINTENANCE ? 1.25
        : plan.floor === FloorLevel.HELL ? 0.45
          : 1;
  const base = (8 + plan.danger * 3 + level * 0.8) * profile.wealthMult * floorMult;
  const u = Math.max(0.000001, 1 - unit(seed, index, 42));
  const tail = Math.pow(u, -0.8) - 1;
  const money = Math.floor(base * (0.45 + tail));
  return Math.max(0, Math.min(ALIFE_MONEY_CAP, money));
}

function defaultLoadoutForRecord(alife: AlifeState, record: AlifeNpcRecord): { weapon?: string; tool?: string; inventory?: Item[] } {
  const faction = recordFaction(alife, record);
  const danger = recordDanger(alife, record);
  const level = recordLevel(alife, record);
  
  const rollWeapon = unit(alife.seed, record.id, 51);
  const rollPockets = [
    unit(alife.seed, record.id, 700),
    unit(alife.seed, record.id, 701),
    unit(alife.seed, record.id, 702),
  ];

  const loadout = generateNpcLoadout(faction, level, danger, rollWeapon, rollPockets);
  
  const occupation = recordOccupation(alife, record);
  if (occupation === Occupation.STOREKEEPER) {
    const rollStock: number[] = [];
    for (let i = 0; i < 15; i++) {
      rollStock.push(unit(alife.seed, record.id, 800 + i));
    }
    const stock = generateMerchantStock(faction, level, danger, rollStock);
    if (!loadout.inventory) loadout.inventory = [];
    for (const item of stock) {
      if (!ITEMS[item.defId]) continue;
      const existing = loadout.inventory.find(i => i.defId === item.defId && i.count < getStack(ITEMS[item.defId]));
      if (existing) {
        existing.count += item.count;
      } else {
        loadout.inventory.push(item);
      }
    }
  }

  return loadout;
}

function playerRelationForRecord(faction: Faction, recordId: number, seed: number): number {
  const base = getFactionPlayerRelation(faction);
  const jitter = Math.round((unit(seed, recordId, 88) * 2 - 1) * NPC_PLAYER_RELATION_FLUCTUATION);
  return clampRelation(base + jitter);
}

function playerRelationForRecordToFaction(
  faction: Faction,
  targetFaction: Faction,
  recordId: number,
  seed: number,
  targetAlifeId = 0,
): number {
  const base = getFactionRel(faction, targetFaction);
  const targetSalt = 88 + (targetAlifeId > 0 ? (targetAlifeId % 997) : targetFaction * 31);
  const jitter = Math.round((unit(seed ^ Math.imul(targetFaction + 1, 0x45d9f3b), recordId, targetSalt) * 2 - 1) * NPC_PLAYER_RELATION_FLUCTUATION);
  return clampRelation(base + jitter);
}

function defaultPlayerRelationForRecord(alife: AlifeState, record: AlifeNpcRecord): number {
  const targetFaction = alife.playerRelationTargetFaction;
  if (targetFaction === undefined) return playerRelationForRecord(recordFaction(alife, record), record.id, alife.seed);
  const targetAlifeId = alife.playerRelationTargetAlifeId;
  if (targetAlifeId !== undefined && record.id === targetAlifeId) return 100;
  return playerRelationForRecordToFaction(recordFaction(alife, record), targetFaction, record.id, alife.seed, targetAlifeId);
}

function questCandidateChance(): number {
  return 0.10;
}

function cashForWealth(wealth: number, seed: number, index: number): number {
  const total = Math.max(0, Math.min(ALIFE_MONEY_CAP, Math.floor(wealth)));
  if (total <= 0) return 0;
  const share = 0.08 + unit(seed, index, 96) * 0.06;
  const targetCash = Math.max(1, Math.round(total * share));
  return Math.max(0, Math.min(total, targetCash));
}

function splitClampedMoney(cash: unknown, accountRubles: unknown): { money: number; accountRubles: number } {
  const money = clampInt(cash, 0, 0, ALIFE_MONEY_CAP);
  const account = clampInt(accountRubles, 0, 0, ALIFE_MONEY_CAP);
  const total = Math.min(ALIFE_MONEY_CAP, money + account);
  const pocket = Math.min(money, total);
  return { money: pocket, accountRubles: total - pocket };
}

function createRecord(alife: AlifeState, id: number, plan: AlifeFloorPlan, seed: number): AlifeNpcRecord {
  const faction = factionForPlan(plan, seed, id);
  const profile = profileForFaction(faction);
  const occupation = occupationForRecord(plan, profile, seed, id);
  const level = levelForRecord(plan, faction, seed, id);
  const rpg = rpgForRecord(level, seed, id);
  const maxHp = getMaxHp(rpg);
  const named = nameForRecord(plan, faction, occupation, seed, id);
  const age = ageForRecord(plan, faction, occupation, level, seed, id);
  const wealth = wealthForRecord(plan, profile, level, seed, id);
  const money = cashForWealth(wealth, seed, id);
  const record: AlifeNpcRecord = {
    id,
    name: named.name,
    firstName: named.firstName,
    lastName: named.lastName,
  };
  setRecordFloorKey(alife, record, plan.key);
  setRecordFloor(alife, record, plan.floor);
  setRecordDanger(alife, record, plan.danger);
  setRecordFaction(alife, record, faction);
  setRecordOccupation(alife, record, occupation);
  setRecordSex(alife, record, named.sex);
  setRecordAge(alife, record, age);
  setRecordFamilyId(alife, record, Math.floor((id - 1) / 4));
  setRecordCanGiveQuest(alife, record, unit(seed, id, 94) < questCandidateChance());
  setRecordMoney(alife, record, money, Math.max(0, wealth - money));
  setRecordRpg(alife, record, rpg);
  setRecordHp(alife, record, maxHp);
  setRecordKarma(alife, record, initialNpcKarma(faction, occupation, unit(seed, id, 93)));
  return record;
}

function populationBucketToFloorPlan(bucket: AlifePopulationBucket): AlifeFloorPlan | null {
  const key = cleanFloorKey(bucket.floorKey);
  if (!key) return null;
  const floor = sanitizeFloor(bucket.floor, FloorLevel.LIVING);
  return {
    key,
    floor,
    danger: bucket.danger ?? storyDanger(floor),
    weight: Math.max(0, Math.floor(bucket.weight ?? bucket.targetCount ?? 0)),
    majorityFaction: bucket.majorityFaction,
    factionWeights: bucket.factionWeights,
    occupationWeights: bucket.occupationWeights,
  };
}

function isDataPopulationPlan(plan: AlifePopulationPlan | AlifePopulationPlanDef): plan is AlifePopulationPlanDef {
  return (plan as AlifePopulationPlanDef).version === 1 && Array.isArray((plan as AlifePopulationPlanDef).reserved);
}

function reservedNpcFromData(def: AlifeReservedIdentityDef): AlifePopulationReservedNpc {
  return {
    id: def.id,
    kind: def.kind,
    presence: def.presence,
    plotNpcId: def.plotNpcId,
    name: def.name,
    female: def.female,
    age: def.age,
    sex: def.sex,
    faction: def.faction,
    occupation: def.occupation,
    sprite: def.sprite,
    npcVisualId: def.npcVisualId,
    familyId: def.familyId,
    level: def.level,
    rpg: def.rpg,
    hp: def.hp,
    maxHp: def.maxHp,
    speed: def.speed,
    isTraveler: def.isTraveler,
    weapon: def.weapon,
    tool: def.tool,
    inventory: def.inventory,
    money: def.money,
    accountRubles: def.accountRubles,
    kills: def.kills,
    npcKills: def.npcKills,
    monsterKills: def.monsterKills,
    playerRelation: def.playerRelation,
    karma: def.karma,
    canGiveQuest: def.canGiveQuest ?? def.kind !== 'plot',
  };
}

function normalizePopulationPlan(plan: AlifePopulationPlan | AlifePopulationPlanDef): AlifePopulationPlan {
  if (!isDataPopulationPlan(plan)) return plan;
  const reservedByFloor = new Map<string, AlifePopulationReservedNpc[]>();
  for (const def of plan.reserved) {
    const floorKey = cleanFloorKey(def.floorKey);
    if (!floorKey) continue;
    const list = reservedByFloor.get(floorKey) ?? [];
    list.push(reservedNpcFromData(def));
    reservedByFloor.set(floorKey, list);
  }

  const usedFloors = new Set<string>();
  const buckets: AlifePopulationBucket[] = plan.buckets.map(bucket => {
    const reserved = reservedByFloor.get(bucket.floorKey) ?? [];
    usedFloors.add(bucket.floorKey);
    return {
      floorKey: bucket.floorKey,
      floor: bucket.baseFloor,
      targetCount: Math.max(0, Math.floor(bucket.targetCount)) + reserved.length,
      factionWeights: bucket.factionWeights,
      occupationWeights: bucket.occupationWeights,
      reserved,
    };
  });

  for (const [floorKey, reserved] of reservedByFloor) {
    if (usedFloors.has(floorKey)) continue;
    const first = plan.reserved.find(def => def.floorKey === floorKey);
    buckets.push({
      floorKey,
      floor: first?.faction === Faction.LIQUIDATOR ? FloorLevel.MINISTRY : FloorLevel.LIVING,
      targetCount: reserved.length,
      reserved,
    });
  }

  return { buckets };
}

function buildCurrentRunPopulationPlan(state: GameState, total?: number): AlifePopulationPlan {
  const run = ensureFloorRunState(state);
  const routeKeySet = new Set<string>([
    floorKeyForStory(FloorLevel.MINISTRY),
    floorKeyForStory(FloorLevel.KVARTIRY),
    floorKeyForStory(FloorLevel.LIVING),
    floorKeyForStory(FloorLevel.MAINTENANCE),
    floorKeyForStory(FloorLevel.HELL),
    floorKeyForStory(FloorLevel.VOID),
  ]);
  for (const route of DESIGN_FLOOR_ROUTES) {
    const entry = floorRunEntryForDesignFloor(state, route.id);
    if (entry) routeKeySet.add(floorRunEntryFloorKey(entry));
  }
  const proceduralSpecs = Object.values(run.specs);
  for (const spec of proceduralSpecs) routeKeySet.add(floorKeyForProcedural(spec.key));
  return normalizePopulationPlan(buildAlifePopulationPlan({
    runSeed: run.runSeed,
    routeKeys: [...routeKeySet],
    proceduralSpecs,
    total,
  }));
}

function populationPlanTotal(plan: AlifePopulationPlan): number {
  let total = 0;
  for (const bucket of plan.buckets) {
    if (bucket.targetCount === undefined) return 0;
    total += Math.max(0, Math.floor(bucket.targetCount));
  }
  return total;
}

function populationPlanCounts(plan: AlifePopulationPlan, total: number): number[] {
  const buckets = plan.buckets;
  const counts = buckets.map(bucket =>
    bucket.targetCount === undefined
      ? -1
      : clampInt(bucket.targetCount, 0, 0, total)
  );
  const specified = counts.reduce((acc, count) => acc + Math.max(0, count), 0);
  if (specified > total) throw new RangeError('A-Life population plan over-allocates the fixed pool');

  const openPlans: AlifeFloorPlan[] = [];
  const openIndexes: number[] = [];
  for (let i = 0; i < buckets.length; i++) {
    if (counts[i] >= 0) continue;
    const floorPlan = populationBucketToFloorPlan(buckets[i]);
    if (!floorPlan || floorPlan.weight <= 0) {
      counts[i] = 0;
      continue;
    }
    openPlans.push(floorPlan);
    openIndexes.push(i);
  }

  const remaining = total - specified;
  if (remaining > 0 && openPlans.length > 0) {
    const openCounts = allocatedCounts(openPlans, remaining);
    for (let i = 0; i < openCounts.length; i++) counts[openIndexes[i]] = openCounts[i];
  } else if (remaining > 0) {
    throw new RangeError('A-Life population plan leaves records without a floor bucket');
  }

  return counts.map(count => Math.max(0, count));
}

function applyReservedNpcToRecord(alife: AlifeState, record: AlifeNpcRecord, reserved: AlifePopulationReservedNpc): void {
  if (reserved.id) record.reservedIdentityId = cleanFloorKey(reserved.id);
  if (reserved.kind) record.reservedKind = reserved.kind;
  if (reserved.presence === 'population' || reserved.presence === 'event_only') record.reservedPresence = reserved.presence;
  if (reserved.plotNpcId) record.plotNpcId = reserved.plotNpcId.slice(0, 96);
  if (reserved.name) {
    record.name = reserved.name.slice(0, 80);
    const parts = reserved.name.split(' ');
    record.firstName = parts[0] ?? record.firstName;
    record.lastName = parts.slice(1).join(' ') || record.lastName;
  }
  setRecordSexFromInput(alife, record, reserved.sex, reserved.female);
  if (reserved.faction !== undefined) setRecordFaction(alife, record, reserved.faction);
  if (reserved.occupation !== undefined) setRecordOccupation(alife, record, reserved.occupation);
  if (reserved.age !== undefined) {
    setRecordAge(alife, record, reserved.age, recordAge(alife, record));
  } else if (reserved.occupation === Occupation.CHILD) {
    setRecordAge(alife, record, 7 + Math.floor(unit(alife.seed, record.id, 121) * 10), 12);
  }
  if (reserved.sprite !== undefined) setRecordSprite(alife, record, clampInt(reserved.sprite, recordOccupation(alife, record), 0, 4096));
  record.npcVisualId = sanitizeNpcVisualId(reserved.npcVisualId) ?? record.npcVisualId;
  if (reserved.familyId !== undefined) setRecordFamilyId(alife, record, reserved.familyId);
  if (typeof reserved.canGiveQuest === 'boolean') setRecordCanGiveQuest(alife, record, reserved.canGiveQuest);
  if (reserved.rpg) {
    setRecordRpg(alife, record, reserved.rpg);
  } else if (reserved.level !== undefined) {
    setRecordRpg(alife, record, {
      level: clampInt(reserved.level, recordLevel(alife, record), 1, RPG_LEVEL_CAP),
      xp: 0,
      attrPoints: 0,
      str: recordStr(alife, record),
      agi: recordAgi(alife, record),
      int: recordInt(alife, record),
      psi: 0,
      maxPsi: 0,
    });
  }
  if (reserved.maxHp !== undefined) setRecordMaxHp(alife, record, reserved.maxHp);
  if (reserved.hp !== undefined) setRecordHp(alife, record, reserved.hp);
  if (reserved.speed !== undefined) record.speed = clampFloat(reserved.speed, record.speed ?? 1.2, ALIFE_NPC_SPEED_MIN, ALIFE_NPC_SPEED_MAX);
  if (typeof reserved.isTraveler === 'boolean') record.isTraveler = reserved.isTraveler;
  let hasCustomLoadout = false;
  if (typeof reserved.weapon === 'string') {
    record.weapon = reserved.weapon.slice(0, 64);
    hasCustomLoadout = true;
  }
  if (typeof reserved.tool === 'string') {
    record.tool = reserved.tool.slice(0, 64);
    hasCustomLoadout = true;
  }
  if (reserved.inventory !== undefined) {
    record.inventory = inventoryCopy(reserved.inventory);
    hasCustomLoadout = true;
  }
  if (hasCustomLoadout) setRecordCustomLoadout(alife, record);
  if (reserved.money !== undefined || reserved.accountRubles !== undefined) {
    setRecordMoney(
      alife,
      record,
      reserved.money ?? recordMoney(alife, record),
      reserved.accountRubles ?? recordAccountRubles(alife, record),
    );
  }
  if (reserved.kills !== undefined) setRecordKills(alife, record, reserved.kills);
  if (reserved.npcKills !== undefined) setRecordNpcKills(alife, record, reserved.npcKills);
  if (reserved.monsterKills !== undefined) setRecordMonsterKills(alife, record, reserved.monsterKills);
  if (reserved.playerRelation !== undefined) setRecordPlayerRelation(alife, record, reserved.playerRelation);
  if (reserved.karma !== undefined) setRecordKarma(alife, record, reserved.karma);
}

export function buildAlifeStateFromPopulationPlan(
  state: GameState,
  seed: number,
  total: number,
  inputPlan: AlifePopulationPlan | AlifePopulationPlanDef,
): AlifeState {
  void state;
  const plan = normalizePopulationPlan(inputPlan);
  const boundedTotal = clampInt(total, ALIFE_POPULATION, 0, ALIFE_POPULATION);
  const npcs: AlifeNpcRecord[] = [];
  const floorIndex: Record<string, number[]> = {};
  const alife: AlifeState = {
    version: ALIFE_VERSION,
    seed,
    total: boundedTotal,
    npcs,
    columns: createAlifeNumericColumns(boundedTotal),
    floorKeys: [],
    floorKeyLookup: {},
    floorIndex,
    deadPlotNpcIds: new Set(),
    leaderboardVersion: 0,
  };
  const counts = populationPlanCounts(plan, boundedTotal);
  let id = 1;

  for (let i = 0; i < plan.buckets.length; i++) {
    const source = plan.buckets[i];
    const floorPlan = populationBucketToFloorPlan(source);
    if (!floorPlan) continue;
    const count = counts[i] ?? 0;
    const reserved = source.reserved ?? [];
    if (reserved.length > count) throw new RangeError(`A-Life population bucket ${floorPlan.key} has more reserved identities than records`);
    const bucket = floorIndex[floorPlan.key] ?? [];
    floorIndex[floorPlan.key] = bucket;
    for (let n = 0; n < count; n++) {
      const record = createRecord(alife, id++, floorPlan, seed);
      if (n < reserved.length) applyReservedNpcToRecord(alife, record, reserved[n]);
      bucket.push(npcs.length);
      npcs.push(record);
    }
  }

  if (npcs.length !== boundedTotal) throw new RangeError('A-Life population plan did not assign every record to a floor bucket');
  return alife;
}

export function createPrefilledAlifeState(
  state: GameState,
  seed: number,
  total: number,
  plan: AlifePopulationPlan | AlifePopulationPlanDef,
): AlifeState {
  const alife = buildAlifeStateFromPopulationPlan(state, seed, total, plan);
  (state as AlifeHost).alife = alife;
  return alife;
}

function createAlifeState(state: GameState, seed: number, requestedTotal: number, options: CreateAlifeStateOptions = {}): AlifeState {
  if (options.populationPlan) {
    const plan = normalizePopulationPlan(options.populationPlan);
    const total = requestedTotal > 0 ? requestedTotal : populationPlanTotal(plan);
    return buildAlifeStateFromPopulationPlan(state, seed, total, plan);
  }
  const plan = buildCurrentRunPopulationPlan(state, requestedTotal > 0 ? requestedTotal : undefined);
  return buildAlifeStateFromPopulationPlan(state, seed, populationPlanTotal(plan), plan);
}

export function ensureAlifeState(state: GameState): AlifeState {
  const host = state as AlifeHost;
  if (host.alife?.version === ALIFE_VERSION && host.alife.npcs.length > 0 && host.alife.columns) return host.alife;
  const seed = Math.floor(Math.random() * 0x7fffffff);
  host.alife = createAlifeState(state, seed, 0);
  return host.alife;
}

export function alifeSeed(state: GameState): number {
  return ensureAlifeState(state).seed;
}

export function alifeNpcRecordCount(state: GameState): number {
  return ensureAlifeState(state).npcs.length;
}

export function debugMarkAllAlifeNpcRecordsTouched(state: GameState): void {
  const alife = ensureAlifeState(state);
  for (let i = 0; i < alife.npcs.length; i++) {
    alife.columns.flags[i] |= ALIFE_FLAG_TOUCHED;
  }
}

export function forEachAlifeNpcRecordSlice(
  state: GameState,
  cursor: number,
  maxRecords: number,
  visit: (record: AlifeNpcSnapshot, cursor: number) => void,
): { visited: number; nextCursor: number } {
  const alife = ensureAlifeState(state);
  const total = alife.npcs.length;
  if (total <= 0 || maxRecords <= 0) return { visited: 0, nextCursor: 0 };
  let nextCursor = Math.max(0, Math.floor(cursor)) % total;
  const limit = Math.min(total, Math.max(0, Math.floor(maxRecords)));
  for (let visited = 0; visited < limit; visited++) {
    const record = alife.npcs[nextCursor];
    const snapshot = record ? getAlifeNpcRecordSnapshot(state, record.id) : undefined;
    if (snapshot) visit(snapshot, nextCursor);
    nextCursor = (nextCursor + 1) % total;
  }
  return { visited: limit, nextCursor };
}

function inventoryCopy(input: readonly Item[] | undefined): Item[] | undefined {
  if (!input || input.length === 0) return input ? [] : undefined;
  return input.slice(0, 8).map(item => ({
    defId: item.defId,
    count: Math.max(1, Math.min(MAX_ITEM_STACK, Math.floor(item.count))),
    ...(item.data === undefined ? {} : { data: item.data }),
  }));
}

function rpgFromRecord(alife: AlifeState, record: AlifeNpcRecord): RPGStats {
  const shell = {
    level: recordLevel(alife, record),
    xp: 0,
    attrPoints: 0,
    str: recordStr(alife, record),
    agi: recordAgi(alife, record),
    int: recordInt(alife, record),
    psi: 0,
    maxPsi: 0,
  };
  const maxPsi = getMaxPsi(shell);
  return { ...shell, psi: maxPsi, maxPsi };
}

function sanitizeFloor(value: unknown, fallback: FloorLevel): FloorLevel {
  return typeof value === 'number' && Number.isFinite(value) && value >= FloorLevel.MINISTRY && value <= FloorLevel.VOID
    ? Math.trunc(value) as FloorLevel
    : fallback;
}

function isAmbientNpcCandidate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1;
}

function captureEntityToRecord(alife: AlifeState, record: AlifeNpcRecord, entity: Entity): void {
  record.x = entity.x;
  record.y = entity.y;
  record.angle = entity.angle;
  setRecordSprite(alife, record, entity.sprite);
  record.npcVisualId = sanitizeNpcVisualId(entity.npcVisualId) ?? record.npcVisualId;
  setRecordSpriteSeed(alife, record, entity.spriteSeed);
  if (entity.maxHp !== undefined) setRecordMaxHp(alife, record, entity.maxHp);
  setRecordHp(alife, record, entity.hp ?? recordHp(alife, record));
  setRecordMoney(
    alife,
    record,
    entity.money ?? recordMoney(alife, record),
    entity.accountRubles ?? recordAccountRubles(alife, record),
  );
  if (entity.age !== undefined) setRecordAge(alife, record, entity.age, recordAge(alife, record));
  setRecordSexFromInput(alife, record, entity.sex, entity.isFemale);
  record.weapon = entity.weapon;
  record.tool = entity.tool;
  record.inventory = inventoryCopy(entity.inventory);
  setRecordCustomLoadout(alife, record);
  if (entity.playerRelation !== undefined) setRecordPlayerRelation(alife, record, entity.playerRelation);
  if (entity.karma !== undefined) setRecordKarma(alife, record, entity.karma);
  setRecordKills(alife, record, entity.kills ?? recordKills(alife, record));
  setRecordNpcKills(alife, record, entity.npcKills ?? recordNpcKills(alife, record));
  setRecordMonsterKills(alife, record, entity.monsterKills ?? recordMonsterKills(alife, record));
  if (entity.rpg) setRecordRpg(alife, record, entity.rpg);
  setRecordTouched(alife, record);
}

function reconcileExistingAlifeEntities(alife: AlifeState, entities: readonly Entity[]): void {
  for (const entity of entities) {
    if (entity.type !== EntityType.NPC || entity.alifeId === undefined || !entity.alive) continue;
    const record = alife.npcs[entity.alifeId - 1];
    if (!record || recordDead(alife, record)) continue;
    if (entity.money === undefined) entity.money = recordMoney(alife, record);
    if (entity.accountRubles === undefined) entity.accountRubles = recordAccountRubles(alife, record);
  }
}

export function captureAlifeFloorState(state: GameState, entities: readonly Entity[]): void {
  const alife = (state as AlifeHost).alife;
  if (!alife) return;
  let captured = false;
  for (const entity of entities) {
    if (entity.type !== EntityType.NPC || entity.alifeId === undefined) continue;
    const record = alife.npcs[entity.alifeId - 1];
    if (!record) continue;
    if (!entity.alive) {
      setRecordDead(alife, record, true);
      setRecordTouched(alife, record);
      alife.leaderboardVersion++;
      continue;
    }
    captureEntityToRecord(alife, record, entity);
    captured = true;
  }
  if (captured) alife.leaderboardVersion++;
}

export function recordAlifeNpcDeath(state: GameState, entity: Entity): void {
  const alife = ensureAlifeState(state);
  if (entity.alifeId !== undefined) {
    const record = alife.npcs[entity.alifeId - 1];
    if (record) {
      captureEntityToRecord(alife, record, entity);
      setRecordDead(alife, record, true);
      setRecordHp(alife, record, 0);
      setRecordTouched(alife, record);
      alife.leaderboardVersion++;
    }
  }
  if (entity.plotNpcId) alife.deadPlotNpcIds.add(entity.plotNpcId);
}

export function rewriteAlifeNpcIdentityFromEntity(state: GameState, entity: Entity): void {
  if (entity.alifeId === undefined) return;
  const alife = ensureAlifeState(state);
  const record = alife.npcs[entity.alifeId - 1];
  if (!record) return;
  if (entity.name) record.name = entity.name.slice(0, 80);
  if (entity.firstName) record.firstName = entity.firstName.slice(0, 40);
  if (entity.lastName) record.lastName = entity.lastName.slice(0, 40);
  if (entity.age !== undefined) setRecordAge(alife, record, entity.age, recordAge(alife, record));
  setRecordSexFromInput(alife, record, entity.sex, entity.isFemale);
  if (entity.faction !== undefined) setRecordFaction(alife, record, entity.faction);
  if (entity.occupation !== undefined) setRecordOccupation(alife, record, entity.occupation);
  if (entity.familyId !== undefined) setRecordFamilyId(alife, record, entity.familyId);
  if (entity.canGiveQuest !== undefined) setRecordCanGiveQuest(alife, record, entity.canGiveQuest);
  record.npcVisualId = sanitizeNpcVisualId(entity.npcVisualId) ?? record.npcVisualId;
  captureEntityToRecord(alife, record, entity);
  alife.leaderboardVersion++;
}

function attachRecordToFloor(alife: AlifeState, recordIndex: number, floorKey: string): void {
  for (const key of Object.keys(alife.floorIndex)) {
    const bucket = alife.floorIndex[key];
    const at = bucket.indexOf(recordIndex);
    if (at >= 0) bucket.splice(at, 1);
  }
  const bucket = alife.floorIndex[floorKey] ?? [];
  if (!bucket.includes(recordIndex)) bucket.push(recordIndex);
  alife.floorIndex[floorKey] = bucket;
}

function resolvedFloorForAlifeKey(state: GameState, floorKey: string): FloorLevel | undefined {
  for (const floor of [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID]) {
    if (floorKeyForStory(floor) === floorKey) return floor;
  }
  const design = DESIGN_FLOOR_ROUTES.find(def => floorKeyForDesign(def.id) === floorKey);
  if (design) return design.baseFloor;
  if (floorKey.startsWith('procedural:')) {
    const routeId = floorKey.slice('procedural:'.length);
    const run = ensureFloorRunState(state);
    const spec = run.specs[routeId] ?? Object.values(run.specs).find(candidate => floorKeyForProcedural(candidate.key) === floorKey);
    if (spec) return spec.baseFloor;
  }
  return undefined;
}

function normalizeWorldCoord(value: number): number {
  return ((value % W) + W) % W;
}

function normalizeAngle(value: number): number {
  const turn = Math.PI * 2;
  return ((value % turn) + turn) % turn;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function moveAlifeNpcRecord(
  state: GameState,
  alifeId: number,
  toFloorKey: string,
  opts: MoveAlifeNpcOptions = {},
): boolean {
  if (!Number.isInteger(alifeId) || alifeId <= 0) return false;
  const floorKey = cleanFloorKey(toFloorKey);
  if (!floorKey) return false;
  const alife = ensureAlifeState(state);
  const record = alife.npcs[alifeId - 1];
  if (!record || recordDead(alife, record)) return false;

  attachRecordToFloor(alife, alifeId - 1, floorKey);
  setRecordFloorKey(alife, record, floorKey);
  setRecordFloor(
    alife,
    record,
    resolvedFloorForAlifeKey(state, floorKey)
      ?? (opts.floor !== undefined ? sanitizeFloor(opts.floor, recordFloor(alife, record)) : recordFloor(alife, record)),
  );

  const x = opts.x;
  const y = opts.y;
  const hasPosition = isFiniteNumber(x) && isFiniteNumber(y);
  if (opts.preservePosition !== true) {
    record.x = undefined;
    record.y = undefined;
    record.angle = undefined;
  }
  if (hasPosition) {
    record.x = normalizeWorldCoord(x);
    record.y = normalizeWorldCoord(y);
  }
  if (isFiniteNumber(opts.angle)) record.angle = normalizeAngle(opts.angle);
  if (opts.markTouched !== false) setRecordTouched(alife, record);
  return true;
}

export function getAlifeNpcRecordSnapshot(state: GameState, alifeId: number): AlifeNpcSnapshot | undefined {
  if (!Number.isInteger(alifeId) || alifeId <= 0) return undefined;
  const alife = ensureAlifeState(state);
  const record = alife.npcs[alifeId - 1];
  if (!record) return undefined;
  return {
    id: record.id,
    floorKey: recordFloorKey(alife, record),
    floor: recordFloor(alife, record),
    faction: recordFaction(alife, record),
    occupation: recordOccupation(alife, record),
    name: record.name,
    firstName: record.firstName,
    lastName: record.lastName,
    female: recordFemale(alife, record),
    age: recordAge(alife, record),
    sex: recordSex(alife, record),
    level: recordLevel(alife, record),
    hp: recordHp(alife, record),
    maxHp: recordMaxHp(alife, record),
    money: recordMoney(alife, record),
    accountRubles: recordAccountRubles(alife, record),
    familyId: recordFamilyId(alife, record),
    canGiveQuest: recordCanGiveQuest(alife, record),
    sprite: recordSprite(alife, record),
    npcVisualId: record.npcVisualId,
    spriteSeed: recordSpriteSeed(alife, record),
    playerRelation: ensureRecordPlayerRelation(alife, record),
    karma: recordKarma(alife, record),
    dead: recordDead(alife, record),
    reservedKind: record.reservedKind,
    reservedIdentityId: record.reservedIdentityId,
    reservedPresence: record.reservedPresence,
    plotNpcId: record.plotNpcId,
    x: record.x,
    y: record.y,
    angle: record.angle,
  };
}

export function setAlifeNpcPlayerRelation(state: GameState, alifeId: number, relation: number): boolean {
  if (!Number.isInteger(alifeId) || alifeId <= 0) return false;
  const alife = ensureAlifeState(state);
  const record = alife.npcs[alifeId - 1];
  if (!record) return false;
  setRecordPlayerRelation(alife, record, relation);
  setRecordTouched(alife, record);
  alife.leaderboardVersion++;
  return true;
}

export interface ResetAlifePlayerRelationsResult {
  updated: number;
  newPlayerAlifeId?: number;
}

export type ExistingAlifeRelationResolver = (fromAlifeId: number, targetAlifeId: number) => number | undefined;

export function resetAlifePlayerRelationsForNewPlayer(
  state: GameState,
  entities: readonly Entity[],
  newPlayer: Pick<Entity, 'alifeId' | 'faction'>,
  existingRelation?: ExistingAlifeRelationResolver,
): ResetAlifePlayerRelationsResult {
  const alife = ensureAlifeState(state);
  const newPlayerAlifeId = newPlayer.alifeId !== undefined && newPlayer.alifeId > 0
    ? Math.floor(newPlayer.alifeId)
    : undefined;
  const targetFaction = newPlayer.faction ?? Faction.CITIZEN;
  let updated = 0;

  alife.playerRelationTargetFaction = targetFaction;
  alife.playerRelationTargetAlifeId = newPlayerAlifeId;
  for (const record of alife.npcs) {
    if (!record || recordDead(alife, record)) continue;
    setRecordPlayerRelation(alife, record, undefined);
    const relation = newPlayerAlifeId !== undefined && record.id !== newPlayerAlifeId
      ? existingRelation?.(record.id, newPlayerAlifeId)
      : undefined;
    if (relation !== undefined) {
      setRecordPlayerRelation(alife, record, relation);
      setRecordTouched(alife, record);
    }
    updated++;
  }

  for (const entity of entities) {
    if (entity.type !== EntityType.NPC || entity.alifeId === undefined) continue;
    if (newPlayerAlifeId !== undefined && entity.alifeId === newPlayerAlifeId) {
      entity.playerRelation = 100;
      continue;
    }
    const record = alife.npcs[entity.alifeId - 1];
    if (!record || recordDead(alife, record)) continue;
    entity.playerRelation = ensureRecordPlayerRelation(alife, record);
  }

  if (updated > 0) alife.leaderboardVersion++;
  return { updated, newPlayerAlifeId };
}

export function randomAliveAlifeNpcSnapshot(
  state: GameState,
  random: () => number = Math.random,
  excludeIds: ReadonlySet<number> = new Set(),
): AlifeNpcSnapshot | undefined {
  const alife = ensureAlifeState(state);
  let selected: AlifeNpcSnapshot | undefined;
  let seen = 0;
  for (const record of alife.npcs) {
    if (!record || excludeIds.has(record.id) || recordDead(alife, record)) continue;
    if (!recordCanMaterializeAsOrdinaryPopulation(record)) continue;
    const snapshot = getAlifeNpcRecordSnapshot(state, record.id);
    if (!snapshot || snapshot.dead) continue;
    seen++;
    if (random() * seen < 1) selected = snapshot;
  }
  return selected;
}

export function sampleAlifeFloorRecordIds(
  state: GameState,
  floorKeyInput: string,
  cursor: number,
  limit: number,
): { ids: number[]; nextCursor: number };
export function sampleAlifeFloorRecordIds(
  state: GameState,
  floorKeyInput: string,
  limit: number,
  salt: number,
  options: LegacySampleAlifeFloorRecordOptions,
): number[];
export function sampleAlifeFloorRecordIds(
  state: GameState,
  floorKeyInput: string,
  cursorOrLimit: number,
  limitOrSalt?: number,
  options?: LegacySampleAlifeFloorRecordOptions,
): { ids: number[]; nextCursor: number } | number[] {
  const floorKey = cleanFloorKey(floorKeyInput);
  if (!floorKey) return options ? [] : { ids: [], nextCursor: 0 };
  const alife = ensureAlifeState(state);
  const bucket = alife.floorIndex[floorKey] ?? [];
  if (bucket.length === 0) return options ? [] : { ids: [], nextCursor: 0 };
  if (options) {
    const cap = clampInt(cursorOrLimit, 0, 0, 8);
    if (cap <= 0) return [];
    const salt = clampInt(limitOrSalt, 0, -1_000_000_000, 1_000_000_000);
    const out: number[] = [];
    const maxAttempts = Math.min(
      bucket.length,
      clampInt(options.maxAttempts, Math.max(16, cap * 32), cap, 256),
    );
    const start = hash32(alife.seed, bucket.length, salt) % bucket.length;
    const stepBase = bucket.length > 1 ? (hash32(alife.seed, salt, bucket.length) % (bucket.length - 1)) + 1 : 1;
    for (let attempt = 0; attempt < maxAttempts && out.length < cap; attempt++) {
      const recordIndex = bucket[(start + attempt * stepBase) % bucket.length];
      const record = alife.npcs[recordIndex];
      if (!record || recordDead(alife, record)) continue;
      if (!recordCanMaterializeAsOrdinaryPopulation(record)) continue;
      if (options.faction !== undefined && recordFaction(alife, record) !== options.faction) continue;
      if (options.excludeIds?.has(record.id)) continue;
      if (!out.includes(record.id)) out.push(record.id);
    }
    return out;
  }

  const boundedLimit = clampInt(limitOrSalt, 0, 0, 256);
  let at = ((clampInt(cursorOrLimit, 0, -1_000_000_000, 1_000_000_000) % bucket.length) + bucket.length) % bucket.length;
  const ids: number[] = [];
  for (let seen = 0; seen < bucket.length && ids.length < boundedLimit; seen++) {
    const record = alife.npcs[bucket[at]];
    if (record && !recordDead(alife, record) && recordCanMaterializeAsOrdinaryPopulation(record)) ids.push(record.id);
    at = (at + 1) % bucket.length;
  }
  return { ids, nextCursor: at };
}

export function currentAlifeFloorRecordIds(state: GameState, floorKeyInput: string): readonly number[] {
  const floorKey = cleanFloorKey(floorKeyInput);
  if (!floorKey) return [];
  const alife = ensureAlifeState(state);
  const bucket = alife.floorIndex[floorKey] ?? [];
  return bucket
    .map(recordIndex => alife.npcs[recordIndex]?.id)
    .filter((id): id is number => id !== undefined);
}

function arrivalRecordFromEntity(alife: AlifeState, id: number, state: GameState, floorKey: string, entity: Entity): AlifeNpcRecord {
  const faction = entity.faction ?? Faction.CITIZEN;
  const occupation = entity.occupation ?? Occupation.TRAVELER;
  const rpg = entity.rpg;
  const level = clampInt(rpg?.level, 1, 1, RPG_LEVEL_CAP);
  const str = clampInt(rpg?.str, 1, 0, RPG_ATTRIBUTE_CAP);
  const agi = clampInt(rpg?.agi, 1, 0, RPG_ATTRIBUTE_CAP);
  const int = clampInt(rpg?.int, 1, 0, RPG_ATTRIBUTE_CAP);
  const rpgShell = { level, xp: 0, attrPoints: 0, str, agi, int, psi: 0, maxPsi: 0 };
  const maxHp = Math.max(1, Math.floor(entity.maxHp ?? getMaxHp(rpgShell)));
  const record: AlifeNpcRecord = {
    id,
    name: (entity.name ?? `Житель ${id}`).slice(0, 80),
    firstName: (entity.firstName ?? (entity.name ?? `Житель`).split(' ')[0]).slice(0, 40),
    lastName: (entity.lastName ?? ((entity.name ?? `${id}`).split(' ').slice(1).join(' ') || `${id}`)).slice(0, 40),
    npcVisualId: sanitizeNpcVisualId(entity.npcVisualId),
    weapon: entity.weapon,
    tool: entity.tool,
    inventory: inventoryCopy(entity.inventory),
    x: entity.x,
    y: entity.y,
    angle: entity.angle,
  };
  setRecordFloorKey(alife, record, floorKey);
  setRecordFloor(alife, record, state.currentFloor);
  setRecordDanger(alife, record, storyDanger(state.currentFloor));
  setRecordFaction(alife, record, faction);
  setRecordOccupation(alife, record, occupation);
  setRecordSexFromInput(alife, record, entity.sex, entity.isFemale);
  setRecordAge(alife, record, entity.age, 25);
  setRecordFamilyId(alife, record, entity.familyId ?? id);
  setRecordCanGiveQuest(alife, record, entity.canGiveQuest === true);
  setRecordSprite(alife, record, entity.sprite);
  setRecordSpriteSeed(alife, record, entity.spriteSeed);
  setRecordCustomLoadout(alife, record);
  setRecordKills(alife, record, entity.kills ?? 0);
  setRecordNpcKills(alife, record, entity.npcKills ?? 0);
  setRecordMonsterKills(alife, record, entity.monsterKills ?? 0);
  setRecordMoney(alife, record, entity.money ?? 0, entity.accountRubles ?? 0);
  setRecordRpg(alife, record, rpgShell);
  setRecordMaxHp(alife, record, maxHp);
  setRecordHp(alife, record, Math.max(1, Math.min(Math.floor(entity.hp ?? maxHp), maxHp)));
  setRecordPlayerRelation(alife, record, entity.playerRelation);
  setRecordKarma(alife, record, entity.karma ?? initialNpcKarma(faction, occupation, 0.5));
  setRecordTouched(alife, record);
  return record;
}

function copyArrivalSocialFieldsToEntity(alife: AlifeState, record: AlifeNpcRecord, entity: Entity): void {
  entity.playerRelation = ensureRecordPlayerRelation(alife, record);
  entity.karma = recordKarma(alife, record);
  entity.kills = recordKills(alife, record);
  entity.npcKills = recordNpcKills(alife, record);
  entity.monsterKills = recordMonsterKills(alife, record);
}

function liveAlifeIds(entities: readonly Entity[]): Set<number> {
  const ids = new Set<number>();
  for (const entity of entities) {
    if (entity.type === EntityType.NPC && entity.alifeId !== undefined && entity.alive) ids.add(entity.alifeId);
  }
  return ids;
}

function arrivalRecordReusable(alife: AlifeState, record: AlifeNpcRecord, activeIds: ReadonlySet<number>): boolean {
  return !recordDead(alife, record) &&
    !record.reservedKind &&
    !recordTouched(alife, record) &&
    !activeIds.has(record.id) &&
    recordPlayerRelation(alife, record) === undefined &&
    recordKills(alife, record) === 0 &&
    recordNpcKills(alife, record) === 0 &&
    recordMonsterKills(alife, record) === 0;
}

function reserveArrivalRecordIndex(alife: AlifeState, entities: readonly Entity[], floorKey: string): number {
  const activeIds = liveAlifeIds(entities);
  const bucket = alife.floorIndex[floorKey] ?? [];
  for (const recordIndex of bucket) {
    const record = alife.npcs[recordIndex];
    if (record && arrivalRecordReusable(alife, record, activeIds)) return recordIndex;
  }
  for (let recordIndex = 0; recordIndex < alife.npcs.length; recordIndex++) {
    const record = alife.npcs[recordIndex];
    if (record && arrivalRecordReusable(alife, record, activeIds)) return recordIndex;
  }
  return -1;
}

export function assignPersistentAlifeNpcFromEntity(
  state: GameState,
  entity: Entity,
  entities: readonly Entity[],
  floorKey = currentAlifeFloorKey(state),
): boolean {
  if (entity.type !== EntityType.NPC || entity.plotNpcId || entity.persistentNpcId) return false;
  if (entity.alifeId !== undefined) {
    rewriteAlifeNpcIdentityFromEntity(state, entity);
    return true;
  }
  const alife = ensureAlifeState(state);
  let recordIndex = alife.npcs.length;
  let record: AlifeNpcRecord;
  if (recordIndex < ALIFE_POPULATION) {
    record = arrivalRecordFromEntity(alife, recordIndex + 1, state, floorKey, entity);
    alife.npcs.push(record);
    alife.total = alife.npcs.length;
  } else {
    recordIndex = reserveArrivalRecordIndex(alife, entities, floorKey);
    if (recordIndex < 0) return false;
    record = arrivalRecordFromEntity(alife, alife.npcs[recordIndex].id, state, floorKey, entity);
    alife.npcs[recordIndex] = record;
  }
  attachRecordToFloor(alife, recordIndex, floorKey);
  copyArrivalSocialFieldsToEntity(alife, record, entity);
  entity.alifeId = record.id;
  entity.persistentNpcId = `alife:${record.id}`;
  alife.leaderboardVersion++;
  return true;
}

export function bindReservedPlotNpcAlifeRecord(
  state: GameState,
  entity: Entity,
  plotNpcId = entity.plotNpcId,
  floorKey = currentAlifeFloorKey(state),
): boolean {
  if (entity.type !== EntityType.NPC || !plotNpcId) return false;
  const cleanPlotNpcId = plotNpcId.slice(0, 96);
  const cleanTargetFloorKey = cleanFloorKey(floorKey);
  if (!cleanTargetFloorKey) return false;
  const alife = ensureAlifeState(state);
  const recordIndex = alife.npcs.findIndex(record =>
    record.plotNpcId === cleanPlotNpcId &&
    record.reservedKind === 'plot'
  );
  if (recordIndex < 0) return false;
  const record = alife.npcs[recordIndex];
  if (!record || recordDead(alife, record)) return false;

  attachRecordToFloor(alife, recordIndex, cleanTargetFloorKey);
  setRecordFloorKey(alife, record, cleanTargetFloorKey);
  setRecordFloor(alife, record, resolvedFloorForAlifeKey(state, cleanTargetFloorKey) ?? recordFloor(alife, record));
  entity.alifeId = record.id;
  entity.persistentNpcId = `alife:${record.id}`;
  entity.npcVisualId = sanitizeNpcVisualId(entity.npcVisualId) ?? record.npcVisualId;
  rewriteAlifeNpcIdentityFromEntity(state, entity);
  return true;
}

export function isPlotNpcDead(state: GameState, plotNpcId: string): boolean {
  return ensureAlifeState(state).deadPlotNpcIds.has(plotNpcId);
}

export function isPlotNpcDeadKnown(state: GameState, plotNpcId: string): boolean {
  const alife = (state as AlifeHost).alife;
  return alife?.deadPlotNpcIds.has(plotNpcId) ?? false;
}

export function getAlifeNpcTotalMoney(state: GameState, npc: Entity | undefined): number | undefined {
  if (!npc || npc.alifeId === undefined) return undefined;
  const alife = (state as AlifeHost).alife ?? ensureAlifeState(state);
  const record = alife.npcs[npc.alifeId - 1];
  return record ? Math.max(0, Math.floor(recordMoney(alife, record) + recordAccountRubles(alife, record))) : undefined;
}

function passable(world: World, x: number, y: number): boolean {
  const cell = world.cells[world.idx(Math.floor(x), Math.floor(y))];
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function fallbackPosition(world: World, seed: number, id: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 4096; attempt++) {
    const x = hash32(seed, id, 200 + attempt) % W;
    const y = hash32(seed, id, 600 + attempt) % W;
    const cell = world.cells[world.idx(x, y)];
    if (cell === Cell.FLOOR || cell === Cell.WATER) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function materializeEntity(record: AlifeNpcRecord, template: Entity | undefined, world: World, alife: AlifeState, nextId: { v: number }): Entity | null {
  let occupation = recordOccupation(alife, record);
  let faction = recordFaction(alife, record);
  let x = record.x;
  let y = record.y;
  if (x === undefined || y === undefined || !passable(world, x, y)) {
    x = template?.x;
    y = template?.y;
  }
  if (x === undefined || y === undefined || !passable(world, x, y)) {
    const fallback = fallbackPosition(world, alife.seed, record.id);
    if (!fallback) return null;
    x = fallback.x;
    y = fallback.y;
  }
  record.x = x;
  record.y = y;
  record.angle = record.angle ?? template?.angle ?? unit(alife.seed, record.id, 77) * Math.PI * 2;
  const templateSprite = template?.sprite;
  const templateVisualId = sanitizeNpcVisualId(template?.npcVisualId);
  const templateHasVisualOverride = templateVisualId !== undefined ||
    (templateSprite !== undefined && templateSprite !== (template?.occupation ?? occupation));
  const adoptTemplateProfile = recordSprite(alife, record) === undefined &&
    record.npcVisualId === undefined &&
    template !== undefined &&
    templateHasVisualOverride;
  if (adoptTemplateProfile) {
    if (template.name) record.name = template.name;
    if (template.firstName) record.firstName = template.firstName;
    if (template.lastName) record.lastName = template.lastName;
    if (template.isFemale !== undefined) setRecordFemale(alife, record, template.isFemale);
    if (template.occupation !== undefined) setRecordOccupation(alife, record, template.occupation);
    if (template.faction !== undefined) setRecordFaction(alife, record, template.faction);
    occupation = recordOccupation(alife, record);
    faction = recordFaction(alife, record);
  }
  record.npcVisualId = record.npcVisualId ?? templateVisualId;
  if (record.npcVisualId === undefined && !templateHasVisualOverride) {
    record.npcVisualId = resolveNpcArtVisualId({
      faction,
      occupation,
      isFemale: recordFemale(alife, record),
    });
  }
  if (recordSprite(alife, record) === undefined) setRecordSprite(alife, record, templateSprite ?? occupation);
  if (recordSpriteSeed(alife, record) === undefined) setRecordSpriteSeed(alife, record, hash32(alife.seed, record.id, 901) || 1);
  const sprite = recordSprite(alife, record) ?? occupation;
  const spriteSeed = recordSpriteSeed(alife, record);
  const maxHp = recordMaxHp(alife, record);
  const playerRelation = ensureRecordPlayerRelation(alife, record);
  const karma = recordKarma(alife, record);
  const rpg = rpgFromRecord(alife, record);
  const generatedLoadout = recordCustomLoadout(alife, record) ? undefined : defaultLoadoutForRecord(alife, record);
  const templateHasLocalAnchor = template?.familyId !== undefined || template?.assignedRoomId !== undefined;
  const isTraveler = record.isTraveler ?? template?.isTraveler ?? (templateHasLocalAnchor ? false : occupationHasRoutineTag(occupation, 'traveler'));
  const familyId = template?.familyId ?? recordFamilyId(alife, record);
  const ai = template?.ai
    ? { goal: template.ai.goal, tx: template.ai.tx, ty: template.ai.ty, path: [], pi: 0, stuck: 0, timer: 0 }
    : { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
  return {
    id: nextId.v++,
    type: EntityType.NPC,
    x,
    y,
    angle: record.angle,
    pitch: 0,
    alive: true,
    speed: HUMANOID_BASE_MOVE_SPEED,
    sprite,
    npcVisualId: record.npcVisualId,
    spriteSeed,
    height: generateHeight(recordAge(alife, record), recordFemale(alife, record)),
    name: record.name,
    firstName: record.firstName,
    lastName: record.lastName,
    isFemale: recordFemale(alife, record),
    needs: freshNeeds(),
    hp: Math.max(1, Math.min(recordHp(alife, record), maxHp)),
    maxHp,
    money: recordMoney(alife, record),
    accountRubles: recordAccountRubles(alife, record),
    ai,
    inventory: inventoryCopy(record.inventory ?? generatedLoadout?.inventory) ?? [],
    weapon: record.weapon ?? generatedLoadout?.weapon,
    tool: record.tool ?? generatedLoadout?.tool,
    faction,
    occupation,
    playerRelation,
    karma,
    kills: recordKills(alife, record),
    npcKills: recordNpcKills(alife, record),
    monsterKills: recordMonsterKills(alife, record),
    isTraveler,
    assignedRoomId: template?.assignedRoomId,
    questId: -1,
    canGiveQuest: recordCanGiveQuest(alife, record),
    familyId,
    rpg,
    alifeId: record.id,
    persistentNpcId: `alife:${record.id}`,
  };
}

export function materializeAlifeArrival(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  alifeId: number,
  opts: MaterializeAlifeArrivalOptions,
): Entity | null;
export function materializeAlifeArrival(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  alifeId: number,
  anchor: { x: number; y: number; angle?: number },
  floorKey: string,
): Entity | null;
export function materializeAlifeArrival(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  alifeId: number,
  opts: MaterializeAlifeArrivalOptions,
  floorKeyOverride?: string,
): Entity | null {
  if (!Number.isInteger(alifeId) || alifeId <= 0) return null;
  if (!isFiniteNumber(opts.x) || !isFiniteNumber(opts.y)) return null;
  const x = normalizeWorldCoord(opts.x);
  const y = normalizeWorldCoord(opts.y);
  if (!passable(world, x, y)) return null;
  if (entities.some(entity => entity.alifeId === alifeId && entity.alive)) return null;

  const alife = ensureAlifeState(state);
  const record = alife.npcs[alifeId - 1];
  if (!record || recordDead(alife, record)) return null;
  const angle = isFiniteNumber(opts.angle) ? normalizeAngle(opts.angle) : record.angle;
  const floorKey = cleanFloorKey(floorKeyOverride) || currentAlifeFloorKey(state);
  if (!moveAlifeNpcRecord(state, alifeId, floorKey, {
    x,
    y,
    angle,
    preservePosition: false,
  })) {
    return null;
  }

  const goalX = isFiniteNumber(opts.goalX) ? normalizeWorldCoord(opts.goalX) : x;
  const goalY = isFiniteNumber(opts.goalY) ? normalizeWorldCoord(opts.goalY) : y;
  const template: Entity = {
    id: -1,
    type: EntityType.NPC,
    x,
    y,
    angle: angle ?? unit(alife.seed, record.id, 77) * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: HUMANOID_BASE_MOVE_SPEED,
    sprite: recordOccupation(alife, record),
    npcVisualId: record.npcVisualId,
    name: record.name,
    firstName: record.firstName,
    lastName: record.lastName,
    hp: recordHp(alife, record),
    maxHp: recordMaxHp(alife, record),
    ai: {
      goal: opts.goalX !== undefined || opts.goalY !== undefined ? AIGoal.GOTO : AIGoal.IDLE,
      tx: goalX,
      ty: goalY,
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
    },
    faction: recordFaction(alife, record),
    occupation: recordOccupation(alife, record),
    isTraveler: opts.isTraveler ?? true,
    questId: -1,
  };
  const entity = materializeEntity(record, template, world, alife, nextId);
  if (!entity) return null;
  entities.push(entity);
  return entity;
}

function filterDeadPlotNpcs(alife: AlifeState, entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read++) {
    const entity = entities[read];
    if (entity.type === EntityType.NPC && entity.plotNpcId && alife.deadPlotNpcIds.has(entity.plotNpcId)) continue;
    entities[write++] = entity;
  }
  entities.length = write;
}

function extractAmbientNpcTemplates(entities: Entity[]): Entity[] {
  const templates: Entity[] = [];
  let write = 0;
  for (let read = 0; read < entities.length; read++) {
    const entity = entities[read];
    if (isAmbientNpcCandidate(entity)) {
      templates.push(entity);
      continue;
    }
    entities[write++] = entity;
  }
  entities.length = write;
  return templates;
}

export function materializeAlifeFloorPopulation(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  floorKey = floorRunEntryFloorKey(currentFloorRunEntry(state)),
): void {
  const alife = ensureAlifeState(state);
  reconcileExistingAlifeEntities(alife, entities);
  filterDeadPlotNpcs(alife, entities);
  const templates = extractAmbientNpcTemplates(entities);
  if (templates.length === 0) return;
  const floorIds = alife.floorIndex[floorKey] ?? [];
  if (floorIds.length === 0) return;

  let slot = 0;
  for (const recordIndex of floorIds) {
    if (slot >= templates.length) break;
    const record = alife.npcs[recordIndex];
    if (!record || !recordCanMaterializeAsOrdinaryPopulation(record)) continue;
    const template = templates[slot];
    slot++;
    if (recordDead(alife, record)) continue;
    const entity = materializeEntity(record, template, world, alife, nextId);
    if (!entity) continue;
    entities.push(entity);
  }

  // Dynamic Event: Lost Child
  for (const child of entities) {
    if (child.type !== EntityType.NPC) continue;
    if (child.age === undefined || child.age >= 16) {
      if (child.occupation !== Occupation.CHILD) continue;
    }
    const familyId = child.familyId;
    if (!familyId) continue;

    // Find parent
    const parent = entities.find(e =>
      e.type === EntityType.NPC &&
      e.id !== child.id &&
      e.familyId === familyId &&
      (e.age === undefined || e.age >= 16) &&
      e.occupation !== Occupation.CHILD
    );

    if (parent) {
      const dist2 = world.dist2(child.x, child.y, parent.x, parent.y);
      if (dist2 > 400) { // far away
        const hasQuest = state.quests?.some(q => q.giverId === child.id && !q.done);
        if (!hasQuest) {
          child.canGiveQuest = true;
        }
      }
    }
  }
}

function normalizeInventory(input: unknown): Item[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: Item[] = [];
  for (const raw of input) {
    if (out.length >= 8 || !isRecord(raw) || typeof raw.defId !== 'string') continue;
    out.push({
      defId: raw.defId.slice(0, 64),
      count: clampInt(raw.count, 1, 1, MAX_ITEM_STACK),
      ...(raw.data === undefined ? {} : { data: raw.data }),
    });
  }
  return out;
}

function normalizeRpg(input: unknown): RPGStats | undefined {
  if (!isRecord(input)) return undefined;
  const level = clampInt(input.level, 1, 1, RPG_LEVEL_CAP);
  const str = clampInt(input.str, 0, 0, RPG_ATTRIBUTE_CAP);
  const agi = clampInt(input.agi, 0, 0, RPG_ATTRIBUTE_CAP);
  const int = clampInt(input.int, 0, 0, RPG_ATTRIBUTE_CAP);
  const shell = { level, xp: 0, attrPoints: 0, str, agi, int, psi: 0, maxPsi: 0 };
  const maxPsi = getMaxPsi(shell);
  return { ...shell, psi: maxPsi, maxPsi };
}

function applyOverride(alife: AlifeState, input: unknown): void {
  if (!isRecord(input)) return;
  const id = clampInt(input.id, 0, 1, alife.npcs.length);
  const record = alife.npcs[id - 1];
  if (!record) return;
  if (typeof input.floorKey === 'string' && input.floorKey.length > 0) {
    const floorKey = input.floorKey.trim().replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 96);
    if (floorKey && floorKey !== recordFloorKey(alife, record)) {
      attachRecordToFloor(alife, id - 1, floorKey);
      setRecordFloorKey(alife, record, floorKey);
    }
  }
  setRecordFloor(alife, record, sanitizeFloor(input.floor, recordFloor(alife, record)));
  if (typeof input.name === 'string' && input.name.length > 0) record.name = input.name.slice(0, 80);
  if (typeof input.firstName === 'string' && input.firstName.length > 0) record.firstName = input.firstName.slice(0, 40);
  if (typeof input.lastName === 'string' && input.lastName.length > 0) record.lastName = input.lastName.slice(0, 40);
  setRecordSexFromInput(alife, record, input.sex, input.female);
  if (input.age !== undefined) setRecordAge(alife, record, input.age, recordAge(alife, record));
  if (typeof input.faction === 'number' && Number.isFinite(input.faction)) {
    setRecordFaction(alife, record, clampInt(input.faction, recordFaction(alife, record), Faction.CITIZEN, Faction.PLAYER) as Faction);
  }
  if (typeof input.occupation === 'number' && Number.isFinite(input.occupation)) {
    setRecordOccupation(alife, record, sanitizeOccupation(input.occupation, recordOccupation(alife, record)));
  }
  setRecordFamilyId(alife, record, clampInt(input.familyId, recordFamilyId(alife, record), 0, 1_000_000_000));
  if (typeof input.canGiveQuest === 'boolean') setRecordCanGiveQuest(alife, record, input.canGiveQuest);
  if (typeof input.x === 'number' && Number.isFinite(input.x)) record.x = input.x;
  if (typeof input.y === 'number' && Number.isFinite(input.y)) record.y = input.y;
  if (typeof input.angle === 'number' && Number.isFinite(input.angle)) record.angle = input.angle;
  if (typeof input.sprite === 'number' && Number.isFinite(input.sprite)) {
    setRecordSprite(alife, record, clampInt(input.sprite, recordSprite(alife, record) ?? recordOccupation(alife, record), 0, 4096));
  }
  record.npcVisualId = sanitizeNpcVisualId(input.npcVisualId) ?? record.npcVisualId;
  if (typeof input.spriteSeed === 'number' && Number.isFinite(input.spriteSeed)) {
    setRecordSpriteSeed(alife, record, clampInt(input.spriteSeed, recordSpriteSeed(alife, record) ?? 1, 1, 0x7fffffff));
  }
  setRecordHp(alife, record, clampInt(input.hp, recordHp(alife, record), 0, recordMaxHp(alife, record)));
  setRecordMoney(
    alife,
    record,
    input.money ?? recordMoney(alife, record),
    input.accountRubles ?? recordAccountRubles(alife, record),
  );
  if (typeof input.weapon === 'string') {
    record.weapon = input.weapon.slice(0, 64);
    setRecordCustomLoadout(alife, record);
  }
  if (typeof input.tool === 'string') {
    record.tool = input.tool.slice(0, 64);
    setRecordCustomLoadout(alife, record);
  }
  const inventory = normalizeInventory(input.inventory);
  if (inventory !== undefined) {
    record.inventory = inventory;
    setRecordCustomLoadout(alife, record);
  }
  setRecordKills(alife, record, clampInt(input.kills, recordKills(alife, record), 0, 1_000_000));
  setRecordNpcKills(alife, record, clampInt(input.npcKills, recordNpcKills(alife, record), 0, 1_000_000));
  setRecordMonsterKills(alife, record, clampInt(input.monsterKills, recordMonsterKills(alife, record), 0, 1_000_000));
  if (typeof input.playerRelation === 'number' && Number.isFinite(input.playerRelation)) {
    setRecordPlayerRelation(alife, record, input.playerRelation);
  }
  if (typeof input.karma === 'number' && Number.isFinite(input.karma)) setRecordKarma(alife, record, input.karma);
  const rpg = normalizeRpg(input.rpg);
  if (rpg) setRecordRpg(alife, record, rpg);
  setRecordTouched(alife, record);
}

function sanitizeRelationTargetFaction(input: unknown): Faction | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined;
  const faction = Math.trunc(input);
  return faction >= Faction.CITIZEN && faction <= Faction.PLAYER ? faction as Faction : undefined;
}

function sanitizeRelationTargetAlifeId(alife: AlifeState, input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined;
  const id = Math.trunc(input);
  return id > 0 && id <= alife.npcs.length ? id : undefined;
}

export function setAlifeState(state: GameState, input: unknown): AlifeState {
  const save = isRecord(input) ? input : {};
  const seed = clampInt(save.seed, Math.floor(Math.random() * 0x7fffffff), 1, 0x7fffffff);
  const total = typeof save.total === 'number' && Number.isFinite(save.total) && save.total >= ALIFE_POPULATION_MIN_RANDOM
    ? clampAlifePopulationTotal(save.total, 0)
    : 0;
  const alife = createAlifeState(state, seed, total);
  alife.playerRelationTargetFaction = sanitizeRelationTargetFaction(save.playerRelationTargetFaction);
  alife.playerRelationTargetAlifeId = sanitizeRelationTargetAlifeId(alife, save.playerRelationTargetAlifeId);
  if (Array.isArray(save.deadIds)) {
    const seenDeadIds = new Set<number>();
    for (const rawId of save.deadIds) {
      if (seenDeadIds.size >= ALIFE_SAVE_DEAD_IDS_CAP) break;
      const id = clampInt(rawId, 0, 1, alife.npcs.length);
      if (seenDeadIds.has(id)) continue;
      const record = alife.npcs[id - 1];
      if (record) {
        seenDeadIds.add(id);
        setRecordDead(alife, record, true);
        setRecordHp(alife, record, 0);
        setRecordTouched(alife, record);
      }
    }
  }
  if (Array.isArray(save.deadPlotNpcIds)) {
    for (const rawId of save.deadPlotNpcIds) {
      if (typeof rawId === 'string' && rawId.length > 0) alife.deadPlotNpcIds.add(rawId.slice(0, 96));
    }
  }
  if (Array.isArray(save.overrides)) {
    for (const item of save.overrides) applyOverride(alife, item);
  }
  (state as AlifeHost).alife = alife;
  return alife;
}

export function alifeForSave(state: GameState): AlifeSaveState {
  const alife = ensureAlifeState(state);
  const deadIds: number[] = [];
  const overrides: AlifeNpcOverride[] = [];
  for (const record of alife.npcs) {
    if (recordDead(alife, record)) {
      if (deadIds.length < ALIFE_SAVE_DEAD_IDS_CAP) deadIds.push(record.id);
      continue;
    }
    if (!recordTouched(alife, record) || overrides.length >= ALIFE_SAVE_OVERRIDE_CAP) continue;
    const rpg = rpgFromRecord(alife, record);
    const hasCustomLoadout = recordCustomLoadout(alife, record);
    overrides.push({
      id: record.id,
      floorKey: recordFloorKey(alife, record),
      floor: recordFloor(alife, record),
      name: record.name,
      firstName: record.firstName,
      lastName: record.lastName,
      female: recordFemale(alife, record),
      age: recordAge(alife, record),
      sex: recordSex(alife, record),
      faction: recordFaction(alife, record),
      occupation: recordOccupation(alife, record),
      familyId: recordFamilyId(alife, record),
      canGiveQuest: recordCanGiveQuest(alife, record),
      x: record.x,
      y: record.y,
      angle: record.angle,
      hp: recordHp(alife, record),
      money: recordMoney(alife, record),
      accountRubles: recordAccountRubles(alife, record),
      weapon: hasCustomLoadout ? record.weapon : undefined,
      tool: hasCustomLoadout ? record.tool : undefined,
      inventory: hasCustomLoadout ? inventoryCopy(record.inventory) : undefined,
      rpg,
      sprite: recordSprite(alife, record),
      npcVisualId: record.npcVisualId,
      spriteSeed: recordSpriteSeed(alife, record),
      kills: recordKills(alife, record),
      npcKills: recordNpcKills(alife, record),
      monsterKills: recordMonsterKills(alife, record),
      playerRelation: recordPlayerRelation(alife, record),
      karma: recordKarma(alife, record),
    });
  }
  return {
    version: ALIFE_VERSION,
    seed: alife.seed,
    total: alife.total,
    playerRelationTargetFaction: alife.playerRelationTargetFaction,
    playerRelationTargetAlifeId: alife.playerRelationTargetAlifeId,
    deadIds,
    deadPlotNpcIds: [...alife.deadPlotNpcIds],
    overrides,
  };
}

export function currentAlifeFloorKey(state: GameState): string {
  return floorRunEntryFloorKey(currentFloorRunEntry(state));
}

function recordRankStats(alife: AlifeState, record: AlifeNpcRecord): RankStats {
  return {
    level: recordLevel(alife, record),
    money: recordMoney(alife, record) + recordAccountRubles(alife, record),
    kills: recordKills(alife, record),
    npcKills: recordNpcKills(alife, record),
    monsterKills: recordMonsterKills(alife, record),
    karma: recordKarma(alife, record),
  };
}

function playerRankSignature(player: Entity, version: number): string {
  return [
    version,
    player.rpg?.level ?? 1,
    (player.money ?? 0) + (player.accountRubles ?? 0),
    player.kills ?? 0,
    player.npcKills ?? 0,
    player.monsterKills ?? 0,
    player.karma ?? 0,
  ].join(':');
}

function insertTop(entries: AlifeLeaderboardEntry[], entry: AlifeLeaderboardEntry, limit: number): void {
  let idx = entries.findIndex(candidate => entry.score > candidate.score);
  if (idx < 0) idx = entries.length;
  if (idx >= limit) return;
  entries.splice(idx, 0, entry);
  if (entries.length > limit) entries.length = limit;
}

function canEnterTop(entries: readonly AlifeLeaderboardEntry[], score: number, limit: number): boolean {
  return entries.length < limit || score > entries[entries.length - 1].score;
}

export function getAlifeLeaderboardSnapshot(state: GameState, player: Entity, limit = 100): AlifeLeaderboardSnapshot {
  const alife = ensureAlifeState(state);
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const signature = playerRankSignature(player, alife.leaderboardVersion);
  if (alife.leaderboardCache?.signature === signature && alife.leaderboardCache.limit === boundedLimit) {
    return alife.leaderboardCache;
  }

  const playerScore = entityRankScore(player);
  const playerEntry: AlifeLeaderboardEntry = {
    rank: 1,
    id: 'player',
    name: player.name ?? 'Вы',
    faction: Faction.PLAYER,
    level: Math.max(1, Math.floor(player.rpg?.level ?? 1)),
    score: playerScore,
    kills: Math.max(0, Math.floor(player.kills ?? 0)),
    npcKills: Math.max(0, Math.floor(player.npcKills ?? 0)),
    monsterKills: Math.max(0, Math.floor(player.monsterKills ?? 0)),
    karma: clampKarma(player.karma ?? 0),
    player: true,
  };
  const entries: AlifeLeaderboardEntry[] = [];
  let betterThanPlayer = 0;
  let totalAlive = 1;

  insertTop(entries, playerEntry, boundedLimit);
  for (const record of alife.npcs) {
    if (recordDead(alife, record)) continue;
    totalAlive++;
    const score = rankScore(recordRankStats(alife, record));
    if (score > playerScore) betterThanPlayer++;
    if (!canEnterTop(entries, score, boundedLimit)) continue;
    insertTop(entries, {
      rank: 0,
      id: `alife:${record.id}`,
      name: record.name,
      faction: recordFaction(alife, record),
      floorKey: recordFloorKey(alife, record),
      level: recordLevel(alife, record),
      score,
      kills: recordKills(alife, record),
      npcKills: recordNpcKills(alife, record),
      monsterKills: recordMonsterKills(alife, record),
      karma: recordKarma(alife, record),
      player: false,
    }, boundedLimit);
  }

  for (let i = 0; i < entries.length; i++) entries[i].rank = i + 1;
  playerEntry.rank = betterThanPlayer + 1;
  const snapshot: AlifeLeaderboardSnapshot & { signature: string; limit: number } = {
    signature,
    limit: boundedLimit,
    entries,
    player: playerEntry,
    totalAlive,
  };
  alife.leaderboardCache = snapshot;
  return snapshot;
}

export function selectCinematicExtras(
  _world: World,
  count: number,
  nearX: number,
  nearY: number,
  radius: number,
): Entity[] {
  if (count <= 0) return [];
  const queryLimit = count * 3;
  const raw: Entity[] = [];
  getEntityIndex().queryRadiusCapped(nearX, nearY, radius, raw, ENTITY_MASK_NPC, queryLimit);

  const extras: Entity[] = [];
  for (const e of raw) {
    if (e.alive) {
      extras.push(e);
      if (extras.length >= count) {
        break;
      }
    }
  }
  return extras;
}
