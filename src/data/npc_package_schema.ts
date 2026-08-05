import {
  Faction,
  FloorLevel,
  Occupation,
  type CharacterSex,
  type Item,
} from '../core/types';
import {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FACTION,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_HIDDEN,
  DEMOS_EDGE_QUEST,
  DEMOS_EDGE_WORK,
  DEMOS_RELATION_MAX,
  DEMOS_RELATION_MIN,
  DemosSocialRoleId,
} from './demos_social';
import { DESIGN_FLOOR_ROUTES } from './design_floors';
import {
  cleanFloorKey,
  floorKeyForDesign,
  floorKeyForProcedural,
  floorKeyForStory,
  floorKeyKnown,
  type FloorKeyResolveContext,
} from './floor_keys';
import { getStack, ITEMS, itemEquipSlot } from './items';
import { allNpcPerks, getNpcPerk } from './npc_perks';
import { PROCEDURAL_FLOOR_ZS, proceduralFloorKey, zForStoryFloor } from './procedural_floors';
import { RPG_ATTRIBUTE_CAP } from './rpg_progression';
import { NPC_VISUAL_FAMILIES } from '../entities/npc_visuals';
import type {
  DemosSocialEdgeFlagId,
  NpcPackageDef,
  NpcPackageKind,
  NpcPackageMobility,
  NpcPackagePresence,
} from './npc_packages';

export const NPC_PACKAGE_INVENTORY_CAP = 16;
export const NPC_PACKAGE_SOCIAL_LINK_CAP = 9;
export const NPC_PACKAGE_SCHEMA_VERSION = 1;

const PACKAGE_ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9][a-z0-9_:.-]{0,47}$/;
const SIMPLE_ID_RE = /^[a-z][a-z0-9]*(?:[_:.-][a-z0-9]+)*$/;
const URL_RE = /\bhttps?:\/\//i;
const GEOMETRY_LEAK_RE = /\b(1024\s*x\s*1024|1024x1024|toroid(?:al)?|W\s*=|world\.idx|world\.wrap|FloorLevel|route\s*z\s*=|z\s*=\s*[-+]?\d+)\b|тороид|1024 на 1024/i;
const MONEY_MAX = 2_147_483_647;
const SPRITE_MAX = 8191;
const UINT32_MAX = 0xffff_ffff;
const AUTHORED_LEVEL_CAP = 100;

const PACKAGE_KINDS = new Set<NpcPackageKind>(['plot', 'design', 'procedural']);
const PRESENCES = new Set<NpcPackagePresence>(['population', 'anchor', 'room_content', 'event_only']);
const MOBILITIES = new Set<NpcPackageMobility>(['fixed_home', 'cold_movable', 'caravan_allowed', 'event_locked']);
const SEXES = new Set<CharacterSex>(['male', 'female']);
const LIVE_ENTITY_KEY_NAMES = new Set(['entityId', 'liveEntityId', 'entity_id', 'live_entity_id', 'alifeId', 'persistentNpcId']);
const SOCIAL_FLAGS: Record<DemosSocialEdgeFlagId, number> = {
  family: DEMOS_EDGE_FAMILY,
  friend: DEMOS_EDGE_FRIEND,
  enemy: DEMOS_EDGE_ENEMY,
  work: DEMOS_EDGE_WORK,
  faction: DEMOS_EDGE_FACTION,
  debt: DEMOS_EDGE_DEBT,
  quest: DEMOS_EDGE_QUEST,
  hidden: DEMOS_EDGE_HIDDEN,
};

export interface NpcPackageLookupHints {
  factions: readonly string[];
  occupations: readonly string[];
  itemIds: readonly string[];
  floorKeys: readonly string[];
  visualIds: readonly string[];
  perkIds: readonly string[];
  demosRelationRoles: readonly string[];
  demosEdgeFlags: readonly string[];
}

export interface NpcPackageValidationContext extends FloorKeyResolveContext {
  packageIds?: readonly string[] | ReadonlySet<string>;
  extraPerkIds?: readonly string[] | ReadonlySet<string>;
  extraVisualIds?: readonly string[] | ReadonlySet<string>;
  allowUnknownPerks?: boolean;
}

export interface NpcPackageValidationResult {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
}

export interface NpcPackageEditorDocument {
  schema: 'gigahrush.npc-package';
  version: 1;
  package: NpcPackageDef;
  validation: {
    errors: readonly string[];
    warnings: readonly string[];
  };
  lookupHints: NpcPackageLookupHints;
}

type ProblemList = {
  errors: string[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericEnumValues(enumObj: Record<string, string | number>): Set<number> {
  return new Set(Object.values(enumObj).filter((value): value is number => typeof value === 'number'));
}

function enumNames(enumObj: Record<string, string | number>): readonly string[] {
  return Object.keys(enumObj).filter(key => Number.isNaN(Number(key))).sort();
}

function enumValueName(enumObj: Record<string, string | number>, value: unknown): string {
  return typeof value === 'number' ? String(enumObj[value] ?? value) : String(value);
}

function setHas(setOrList: readonly string[] | ReadonlySet<string> | undefined, value: string): boolean {
  if (!setOrList) return false;
  return 'has' in setOrList ? setOrList.has(value) : setOrList.includes(value);
}

function stringListFromSetOrList(input: readonly string[] | ReadonlySet<string> | undefined): readonly string[] {
  if (!input) return [];
  return 'has' in input ? [...input].sort() : [...input].sort();
}

function hasFunction(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => hasFunction(item, seen));
  return Object.values(value as Record<string, unknown>).some(item => hasFunction(item, seen));
}

function scanStrings(value: unknown, visit: (text: string) => void, seen = new Set<unknown>()): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) scanStrings(item, visit, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) scanStrings(item, visit, seen);
}

function scanObjectKeys(
  value: unknown,
  visit: (scope: string, key: string) => void,
  scope = 'package',
  seen = new Set<unknown>(),
): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanObjectKeys(item, visit, `${scope}[${index}]`, seen));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visit(scope, key);
    scanObjectKeys(item, visit, `${scope}.${key}`, seen);
  }
}

function pushRequiredRecord(problems: ProblemList, root: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = root[key];
  if (!isRecord(value)) {
    problems.errors.push(`${key} must be an object`);
    return undefined;
  }
  return value;
}

function requireString(problems: ProblemList, scope: string, value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') {
    problems.errors.push(`${scope} must be a string`);
    return undefined;
  }
  if (!value.trim()) problems.errors.push(`${scope} must not be empty`);
  if (value !== value.trim()) problems.errors.push(`${scope} must be trimmed`);
  if (value.length > maxChars) problems.errors.push(`${scope} exceeds ${maxChars} chars`);
  return value;
}

function optionalString(problems: ProblemList, scope: string, value: unknown, maxChars: number): string | undefined {
  if (value === undefined) return undefined;
  return requireString(problems, scope, value, maxChars);
}

function validateStringArray(
  problems: ProblemList,
  scope: string,
  value: unknown,
  options: { maxItems: number; maxChars: number; pattern?: RegExp } = { maxItems: 8, maxChars: 96 },
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    problems.errors.push(`${scope} must be an array`);
    return;
  }
  if (value.length > options.maxItems) problems.errors.push(`${scope} must have at most ${options.maxItems} entries`);
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const text = requireString(problems, `${scope}[${index}]`, item, options.maxChars);
    if (text === undefined) return;
    if (options.pattern && !options.pattern.test(text)) problems.errors.push(`${scope}[${index}] has invalid id "${text}"`);
    if (seen.has(text)) problems.errors.push(`${scope}[${index}] duplicates "${text}"`);
    seen.add(text);
  });
}

function integerInRange(problems: ProblemList, scope: string, value: unknown, min: number, max: number, optional = false): void {
  if (value === undefined && optional) return;
  if (!Number.isInteger(value)) {
    problems.errors.push(`${scope} must be an integer`);
    return;
  }
  const n = value as number;
  if (n < min || n > max) problems.errors.push(`${scope} must be ${min}..${max}`);
}

function numberInRange(problems: ProblemList, scope: string, value: unknown, min: number, max: number, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.errors.push(`${scope} must be a finite number`);
    return;
  }
  const n = value;
  if (n < min || n > max) problems.errors.push(`${scope} must be ${min}..${max}`);
}

function validEnumValue(enumObj: Record<string, string | number>, value: unknown): boolean {
  return typeof value === 'number' && numericEnumValues(enumObj).has(value);
}

function validateEnum(
  problems: ProblemList,
  scope: string,
  enumObj: Record<string, string | number>,
  value: unknown,
): void {
  if (!validEnumValue(enumObj, value)) {
    problems.errors.push(`${scope} must be a known enum value, got ${enumValueName(enumObj, value)}`);
  }
}

function validateTags(problems: ProblemList, scope: string, value: unknown, maxItems = 16): void {
  validateStringArray(problems, scope, value, { maxItems, maxChars: 48, pattern: TAG_RE });
}

function validateTextSafety(problems: ProblemList, pack: unknown): void {
  scanStrings(pack, text => {
    if (URL_RE.test(text)) problems.errors.push('package text must not contain remote URLs');
  });
  if (!isRecord(pack)) return;
  const publicFields = [
    pack.bio,
    pack.speech,
    pack.editor,
  ];
  for (const field of publicFields) {
    scanStrings(field, text => {
      if (GEOMETRY_LEAK_RE.test(text)) {
        problems.errors.push('public/community text must not leak implementation geometry');
      }
    });
  }
}

function validateLiveEntityKeySafety(problems: ProblemList, pack: unknown): void {
  scanObjectKeys(pack, (scope, key) => {
    if (LIVE_ENTITY_KEY_NAMES.has(key)) {
      problems.errors.push(`${scope}.${key} is live entity state and cannot be authored in an NPC package`);
    }
  });
}

function validateForbiddenRuntimeKeys(problems: ProblemList, runtime: Record<string, unknown> | undefined): void {
  if (!runtime) return;
  const forbidden = [
    'id',
    'entityId',
    'liveEntityId',
    'alifeId',
    'persistentNpcId',
    'ai',
    'path',
    'statuses',
    'attackCd',
    'combatTargetId',
  ];
  for (const key of forbidden) {
    if (key in runtime) problems.errors.push(`runtime.${key} is runtime-only and cannot be authored`);
  }
}

function validateIdentity(problems: ProblemList, identity: Record<string, unknown>): void {
  optionalString(problems, 'identity.firstName', identity.firstName, 64);
  optionalString(problems, 'identity.lastName', identity.lastName, 64);
  optionalString(problems, 'identity.patronymic', identity.patronymic, 64);
  optionalString(problems, 'identity.nickname', identity.nickname, 64);
  optionalString(problems, 'identity.displayName', identity.displayName, 96);
  validateStringArray(problems, 'identity.aliases', identity.aliases, { maxItems: 8, maxChars: 64 });
  const displayName = typeof identity.displayName === 'string' ? identity.displayName.trim() : '';
  const firstName = typeof identity.firstName === 'string' ? identity.firstName.trim() : '';
  if (!displayName && !firstName) {
    problems.errors.push('identity.displayName or identity.firstName is required');
  }
  if (!displayName && firstName) {
    problems.warnings.push('identity.displayName is canonical; firstName/lastName/patronymic are compatibility fallback only');
  }
}

function validateBio(problems: ProblemList, bio: Record<string, unknown>): void {
  requireString(problems, 'bio.publicLine', bio.publicLine, 220);
  optionalString(problems, 'bio.short', bio.short, 480);
  optionalString(problems, 'bio.origin', bio.origin, 160);
  optionalString(problems, 'bio.work', bio.work, 160);
  validateStringArray(problems, 'bio.wants', bio.wants, { maxItems: 8, maxChars: 120 });
  validateStringArray(problems, 'bio.fears', bio.fears, { maxItems: 8, maxChars: 120 });
  validateStringArray(problems, 'bio.habits', bio.habits, { maxItems: 8, maxChars: 120 });
  validateStringArray(problems, 'bio.secrets', bio.secrets, { maxItems: 8, maxChars: 160 });
  validateTags(problems, 'bio.markovTags', bio.markovTags, 16);
}

function validateDemographics(problems: ProblemList, demographics: Record<string, unknown>): void {
  if (!SEXES.has(demographics.sex as CharacterSex)) problems.errors.push('demographics.sex must be male or female');
  integerInRange(problems, 'demographics.age', demographics.age, 1, 100);
}

function validateAffiliation(problems: ProblemList, affiliation: Record<string, unknown>): void {
  validateEnum(problems, 'affiliation.faction', Faction, affiliation.faction);
  validateEnum(problems, 'affiliation.occupation', Occupation, affiliation.occupation);
  if (affiliation.roleId !== undefined) {
    const roleId = requireString(problems, 'affiliation.roleId', affiliation.roleId, 64);
    if (roleId && !SIMPLE_ID_RE.test(roleId)) problems.errors.push(`affiliation.roleId has invalid id "${roleId}"`);
  }
  integerInRange(problems, 'affiliation.familyId', affiliation.familyId, 0, UINT32_MAX, true);
}

function validatePerks(problems: ProblemList, rpg: Record<string, unknown>, context?: NpcPackageValidationContext): void {
  const perks = rpg.perks;
  if (perks === undefined) return;
  if (!Array.isArray(perks)) {
    problems.errors.push('rpg.perks must be an array');
    return;
  }
  if (perks.length > 12) problems.errors.push('rpg.perks must have at most 12 entries');
  const seen = new Set<string>();
  perks.forEach((perk, index) => {
    if (!isRecord(perk)) {
      problems.errors.push(`rpg.perks[${index}] must be an object`);
      return;
    }
    const id = requireString(problems, `rpg.perks[${index}].id`, perk.id, 64);
    if (!id) return;
    if (!PACKAGE_ID_RE.test(id)) problems.errors.push(`rpg.perks[${index}].id must be snake_case`);
    if (seen.has(id)) problems.errors.push(`rpg.perks[${index}] duplicates "${id}"`);
    seen.add(id);
    if (!getNpcPerk(id) && !setHas(context?.extraPerkIds, id)) {
      if (context?.allowUnknownPerks) problems.warnings.push(`rpg.perks[${index}].id "${id}" is extension-only`);
      else problems.errors.push(`rpg.perks[${index}].id references unknown perk "${id}"`);
    }
    integerInRange(problems, `rpg.perks[${index}].rank`, perk.rank, 1, 10, true);
    validateTags(problems, `rpg.perks[${index}].tags`, perk.tags, 8);
  });
}

function validateRpg(problems: ProblemList, rpg: Record<string, unknown>, context?: NpcPackageValidationContext): void {
  integerInRange(problems, 'rpg.level', rpg.level, 1, AUTHORED_LEVEL_CAP);
  integerInRange(problems, 'rpg.str', rpg.str, 0, RPG_ATTRIBUTE_CAP, true);
  integerInRange(problems, 'rpg.agi', rpg.agi, 0, RPG_ATTRIBUTE_CAP, true);
  integerInRange(problems, 'rpg.int', rpg.int, 0, RPG_ATTRIBUTE_CAP, true);
  validatePerks(problems, rpg, context);
}

function validateWealth(problems: ProblemList, wealth: Record<string, unknown>): void {
  integerInRange(problems, 'wealth.cashRubles', wealth.cashRubles, 0, MONEY_MAX, true);
  integerInRange(problems, 'wealth.accountRubles', wealth.accountRubles, 0, MONEY_MAX, true);
  integerInRange(problems, 'wealth.debtRubles', wealth.debtRubles, 0, MONEY_MAX, true);
  validateTags(problems, 'wealth.assetTags', wealth.assetTags, 16);
}

function validateItemStack(problems: ProblemList, scope: string, stack: unknown): void {
  if (!isRecord(stack)) {
    problems.errors.push(`${scope} must be an object`);
    return;
  }
  const defId = requireString(problems, `${scope}.defId`, stack.defId, 96);
  if (!defId) return;
  const def = ITEMS[defId];
  if (!def) {
    problems.errors.push(`${scope}.defId references unknown item "${defId}"`);
    return;
  }
  integerInRange(problems, `${scope}.count`, stack.count, 1, getStack(def));
}

function validateEquipItem(problems: ProblemList, scope: string, itemId: unknown, expectedSlot: 'weapon' | 'tool'): void {
  if (itemId === undefined) return;
  const id = requireString(problems, scope, itemId, 96);
  if (!id) return;
  const def = ITEMS[id];
  if (!def) {
    problems.errors.push(`${scope} references unknown item "${id}"`);
    return;
  }
  const slot = itemEquipSlot(def);
  if (slot !== expectedSlot) problems.errors.push(`${scope} must reference a ${expectedSlot} item`);
}

function validateLoadout(problems: ProblemList, loadout: Record<string, unknown>): void {
  validateEquipItem(problems, 'loadout.weapon', loadout.weapon, 'weapon');
  validateEquipItem(problems, 'loadout.tool', loadout.tool, 'tool');
  if (loadout.inventory === undefined) return;
  if (!Array.isArray(loadout.inventory)) {
    problems.errors.push('loadout.inventory must be an array');
    return;
  }
  if (loadout.inventory.length > NPC_PACKAGE_INVENTORY_CAP) {
    problems.errors.push(`loadout.inventory must have at most ${NPC_PACKAGE_INVENTORY_CAP} stacks`);
  }
  loadout.inventory.forEach((stack: Item, index: number) => validateItemStack(problems, `loadout.inventory[${index}]`, stack));
}

function validateSocial(problems: ProblemList, packId: string | undefined, social: Record<string, unknown>, context?: NpcPackageValidationContext): void {
  integerInRange(problems, 'social.playerRelation', social.playerRelation, -100, 100, true);
  integerInRange(problems, 'social.karma', social.karma, DEMOS_RELATION_MIN, DEMOS_RELATION_MAX, true);
  if (social.links === undefined) return;
  if (!Array.isArray(social.links)) {
    problems.errors.push('social.links must be an array');
    return;
  }
  if (social.links.length > NPC_PACKAGE_SOCIAL_LINK_CAP) {
    problems.errors.push(`social.links must have at most ${NPC_PACKAGE_SOCIAL_LINK_CAP} NPC links`);
  }
  const seenTargets = new Set<string>();
  social.links.forEach((link, index) => {
    if (!isRecord(link)) {
      problems.errors.push(`social.links[${index}] must be an object`);
      return;
    }
    const target = requireString(problems, `social.links[${index}].targetNpcId`, link.targetNpcId, 96);
    if (target) {
      if (!PACKAGE_ID_RE.test(target)) problems.errors.push(`social.links[${index}].targetNpcId must be snake_case`);
      if (target === packId) problems.errors.push(`social.links[${index}] cannot target self`);
      if (seenTargets.has(target)) problems.errors.push(`social.links[${index}] duplicates target "${target}"`);
      seenTargets.add(target);
      if (context?.packageIds && !setHas(context.packageIds, target)) {
        problems.errors.push(`social.links[${index}].targetNpcId references unknown NPC package "${target}"`);
      }
    }
    integerInRange(problems, `social.links[${index}].relation`, link.relation, DEMOS_RELATION_MIN, DEMOS_RELATION_MAX);
    validateEnum(problems, `social.links[${index}].role`, DemosSocialRoleId, link.role);
    if (link.bidirectional !== undefined && typeof link.bidirectional !== 'boolean') {
      problems.errors.push(`social.links[${index}].bidirectional must be boolean`);
    }
    if (link.flags !== undefined) {
      if (!Array.isArray(link.flags)) {
        problems.errors.push(`social.links[${index}].flags must be an array`);
      } else {
        const flagSeen = new Set<string>();
        link.flags.forEach((rawFlag, flagIndex) => {
          const flag = requireString(problems, `social.links[${index}].flags[${flagIndex}]`, rawFlag, 32);
          if (!flag) return;
          if (!(flag in SOCIAL_FLAGS)) problems.errors.push(`social.links[${index}].flags[${flagIndex}] references unknown Demos edge flag "${flag}"`);
          if (flagSeen.has(flag)) problems.errors.push(`social.links[${index}].flags[${flagIndex}] duplicates "${flag}"`);
          flagSeen.add(flag);
        });
      }
    }
  });
}

function validateVisual(problems: ProblemList, visual: Record<string, unknown>, context?: NpcPackageValidationContext): void {
  integerInRange(problems, 'visual.sprite', visual.sprite, 0, SPRITE_MAX, true);
  numberInRange(problems, 'visual.spriteScale', visual.spriteScale, 0.25, 1.6, true);
  integerInRange(problems, 'visual.spriteSeed', visual.spriteSeed, 0, UINT32_MAX, true);
  if (visual.npcVisualId !== undefined) {
    const id = requireString(problems, 'visual.npcVisualId', visual.npcVisualId, 64);
    if (id && !NPC_VISUAL_FAMILIES.some(family => family.id === id) && !setHas(context?.extraVisualIds, id)) {
      problems.errors.push(`visual.npcVisualId references unknown visual family "${id}"`);
    }
  }
  optionalString(problems, 'visual.portraitHint', visual.portraitHint, 120);
}

function validatePlacement(problems: ProblemList, placement: Record<string, unknown>, context?: NpcPackageValidationContext): void {
  const floorKey = requireString(problems, 'placement.homeFloorKey', placement.homeFloorKey, 96);
  if (floorKey) {
    if (cleanFloorKey(floorKey) !== floorKey) problems.errors.push('placement.homeFloorKey contains invalid characters');
    if (!floorKeyKnown(floorKey, context)) problems.errors.push(`placement.homeFloorKey references unknown floor key "${floorKey}"`);
  }
  if (!PRESENCES.has(placement.presence as NpcPackagePresence)) {
    problems.errors.push('placement.presence must be population, anchor, room_content or event_only');
  }
  if (placement.mobility !== undefined && !MOBILITIES.has(placement.mobility as NpcPackageMobility)) {
    problems.errors.push('placement.mobility has unknown value');
  }
  if (placement.roomId !== undefined) {
    const roomId = requireString(problems, 'placement.roomId', placement.roomId, 64);
    if (roomId && !SIMPLE_ID_RE.test(roomId)) problems.errors.push(`placement.roomId has invalid id "${roomId}"`);
  }
  if (placement.anchorId !== undefined) {
    const anchorId = requireString(problems, 'placement.anchorId', placement.anchorId, 64);
    if (anchorId && !SIMPLE_ID_RE.test(anchorId)) problems.errors.push(`placement.anchorId has invalid id "${anchorId}"`);
  }
  validateTags(problems, 'placement.roomTags', placement.roomTags, 16);
  validateTags(problems, 'placement.spawnTags', placement.spawnTags, 16);
}

function validateSpeech(problems: ProblemList, speech: Record<string, unknown>): void {
  validateTags(problems, 'speech.voiceTags', speech.voiceTags, 16);
  validateTags(problems, 'speech.markovDomains', speech.markovDomains, 16);
  validateStringArray(problems, 'speech.catchphrases', speech.catchphrases, { maxItems: 12, maxChars: 160 });
  validateStringArray(problems, 'speech.forbiddenTopics', speech.forbiddenTopics, { maxItems: 12, maxChars: 96 });
  validateStringArray(problems, 'speech.talkLines', speech.talkLines, { maxItems: 32, maxChars: 520 });
  validateStringArray(problems, 'speech.talkLinesPost', speech.talkLinesPost, { maxItems: 32, maxChars: 520 });
  if (typeof speech.talkQuestResponse === 'string') {
    requireString(problems, 'speech.talkQuestResponse', speech.talkQuestResponse, 520);
  } else {
    validateStringArray(problems, 'speech.talkQuestResponse', speech.talkQuestResponse, { maxItems: 8, maxChars: 520 });
  }
  validateStringArray(problems, 'speech.ambientCorpus', speech.ambientCorpus, { maxItems: 24, maxChars: 240 });
  validateStringArray(problems, 'speech.barkCorpus', speech.barkCorpus, { maxItems: 24, maxChars: 180 });
  validateStringArray(problems, 'speech.demosPostHints', speech.demosPostHints, { maxItems: 16, maxChars: 180 });
}

function validateRuntime(problems: ProblemList, runtime: Record<string, unknown> | undefined): void {
  if (!runtime) return;
  validateForbiddenRuntimeKeys(problems, runtime);
  integerInRange(problems, 'runtime.hp', runtime.hp, 1, 1_000_000, true);
  integerInRange(problems, 'runtime.maxHp', runtime.maxHp, 1, 1_000_000, true);
  if (typeof runtime.hp === 'number' && typeof runtime.maxHp === 'number' && runtime.hp > runtime.maxHp) {
    problems.errors.push('runtime.hp must not exceed runtime.maxHp');
  }
  numberInRange(problems, 'runtime.speed', runtime.speed, 0.1, 20, true);
  if (runtime.isTraveler !== undefined && typeof runtime.isTraveler !== 'boolean') problems.errors.push('runtime.isTraveler must be boolean');
  if (runtime.canGiveQuest !== undefined && typeof runtime.canGiveQuest !== 'boolean') problems.errors.push('runtime.canGiveQuest must be boolean');
  if (runtime.reserveInAlife !== undefined && typeof runtime.reserveInAlife !== 'boolean') problems.errors.push('runtime.reserveInAlife must be boolean');
  if (runtime.specialRoutineId !== undefined) {
    const id = requireString(problems, 'runtime.specialRoutineId', runtime.specialRoutineId, 64);
    if (id && !SIMPLE_ID_RE.test(id)) problems.errors.push(`runtime.specialRoutineId has invalid id "${id}"`);
  }
  integerInRange(problems, 'runtime.assignedRoomId', runtime.assignedRoomId, 0, 1_000_000, true);
  integerInRange(problems, 'runtime.initialKills', runtime.initialKills, 0, UINT32_MAX, true);
  integerInRange(problems, 'runtime.initialNpcKills', runtime.initialNpcKills, 0, UINT32_MAX, true);
  integerInRange(problems, 'runtime.initialMonsterKills', runtime.initialMonsterKills, 0, UINT32_MAX, true);
}

function validateContent(problems: ProblemList, content: Record<string, unknown> | undefined): void {
  if (!content) return;
  for (const key of ['plotNpcId', 'dialogueId', 'roomContentId', 'tradeProfileId'] as const) {
    if (content[key] === undefined) continue;
    const id = requireString(problems, `content.${key}`, content[key], 96);
    if (id && !SIMPLE_ID_RE.test(id)) problems.errors.push(`content.${key} has invalid id "${id}"`);
  }
  validateStringArray(problems, 'content.questIds', content.questIds, { maxItems: 16, maxChars: 96, pattern: SIMPLE_ID_RE });
  validateStringArray(problems, 'content.documentIds', content.documentIds, { maxItems: 16, maxChars: 96, pattern: SIMPLE_ID_RE });
  validateTags(problems, 'content.tags', content.tags, 16);
  optionalString(problems, 'content.debugPath', content.debugPath, 160);
  if (content.sideQuestSteps !== undefined && !Array.isArray(content.sideQuestSteps)) {
    problems.errors.push('content.sideQuestSteps must be an array');
  }
}

function validateEditor(problems: ProblemList, editor: Record<string, unknown> | undefined): void {
  if (!editor) return;
  optionalString(problems, 'editor.title', editor.title, 120);
  optionalString(problems, 'editor.author', editor.author, 96);
  optionalString(problems, 'editor.notes', editor.notes, 480);
  if (editor.source !== undefined && !['game', 'editor', 'community', 'debug'].includes(String(editor.source))) {
    problems.errors.push('editor.source has unknown value');
  }
  if (editor.reviewStatus !== undefined && !['draft', 'submitted', 'needs_review', 'accepted', 'rejected', 'imported', 'reviewed'].includes(String(editor.reviewStatus))) {
    problems.errors.push('editor.reviewStatus has unknown value');
  }
}

export function npcPackageLookupHints(context?: NpcPackageValidationContext): NpcPackageLookupHints {
  const storyKeyRows = [...numericEnumValues(FloorLevel)].map(floor => ({
    key: floorKeyForStory(floor as FloorLevel),
    z: zForStoryFloor(floor as FloorLevel),
  }));
  const designKeyRows = DESIGN_FLOOR_ROUTES.map(route => ({
    key: floorKeyForDesign(route.id),
    z: route.z,
  }));
  const fixedKeys = [...storyKeyRows, ...designKeyRows]
    .sort((a, b) => b.z - a.z || a.key.localeCompare(b.key))
    .map(entry => entry.key);
  const proceduralKeys = [...PROCEDURAL_FLOOR_ZS]
    .sort((a, b) => b - a)
    .map(z => floorKeyForProcedural(proceduralFloorKey(z)));
  const floorKeys = [
    ...fixedKeys,
    ...proceduralKeys,
    ...stringListFromSetOrList(context?.extraKnownKeys),
  ];
  return {
    factions: enumNames(Faction),
    occupations: enumNames(Occupation),
    itemIds: Object.keys(ITEMS).sort(),
    floorKeys: [...new Set(floorKeys)],
    visualIds: [...new Set([...NPC_VISUAL_FAMILIES.map(family => family.id), ...stringListFromSetOrList(context?.extraVisualIds)])].sort(),
    perkIds: [...new Set([...allNpcPerks().map(perk => perk.id), ...stringListFromSetOrList(context?.extraPerkIds)])].sort(),
    demosRelationRoles: enumNames(DemosSocialRoleId),
    demosEdgeFlags: Object.keys(SOCIAL_FLAGS).sort(),
  };
}

export function validateNpcPackage(pack: unknown, context?: NpcPackageValidationContext): NpcPackageValidationResult {
  const problems: ProblemList = { errors: [], warnings: [] };
  if (hasFunction(pack)) problems.errors.push('package must not contain function values');
  validateTextSafety(problems, pack);
  validateLiveEntityKeySafety(problems, pack);

  if (!isRecord(pack)) {
    problems.errors.push('package must be an object');
    return { valid: false, errors: problems.errors, warnings: problems.warnings };
  }

  if (pack.version !== NPC_PACKAGE_SCHEMA_VERSION) problems.errors.push('version must be 1');
  const id = requireString(problems, 'id', pack.id, 96);
  if (id && !PACKAGE_ID_RE.test(id)) problems.errors.push('id must be stable lowercase snake_case');
  if (!PACKAGE_KINDS.has(pack.kind as NpcPackageKind)) {
    problems.errors.push('kind must be plot, design or procedural');
  }

  const identity = pushRequiredRecord(problems, pack, 'identity');
  const bio = pushRequiredRecord(problems, pack, 'bio');
  const demographics = pushRequiredRecord(problems, pack, 'demographics');
  const affiliation = pushRequiredRecord(problems, pack, 'affiliation');
  const rpg = pushRequiredRecord(problems, pack, 'rpg');
  const wealth = pushRequiredRecord(problems, pack, 'wealth');
  const loadout = pushRequiredRecord(problems, pack, 'loadout');
  const social = pushRequiredRecord(problems, pack, 'social');
  const visual = pushRequiredRecord(problems, pack, 'visual');
  const placement = pushRequiredRecord(problems, pack, 'placement');
  const speech = pushRequiredRecord(problems, pack, 'speech');

  if (identity) validateIdentity(problems, identity);
  if (bio) validateBio(problems, bio);
  if (demographics) validateDemographics(problems, demographics);
  if (affiliation) validateAffiliation(problems, affiliation);
  if (rpg) validateRpg(problems, rpg, context);
  if (wealth) validateWealth(problems, wealth);
  if (loadout) validateLoadout(problems, loadout);
  if (social) validateSocial(problems, id, social, context);
  if (visual) validateVisual(problems, visual, context);
  if (placement) validatePlacement(problems, placement, context);
  if (speech) validateSpeech(problems, speech);

  validateRuntime(problems, isRecord(pack.runtime) ? pack.runtime : undefined);
  if (pack.runtime !== undefined && !isRecord(pack.runtime)) problems.errors.push('runtime must be an object');
  validateContent(problems, isRecord(pack.content) ? pack.content : undefined);
  if (pack.content !== undefined && !isRecord(pack.content)) problems.errors.push('content must be an object');
  validateEditor(problems, isRecord(pack.editor) ? pack.editor : undefined);
  if (pack.editor !== undefined && !isRecord(pack.editor)) problems.errors.push('editor must be an object');
  validateTags(problems, 'tags', pack.tags, 16);

  return {
    valid: problems.errors.length === 0,
    errors: problems.errors,
    warnings: problems.warnings,
  };
}

export function compileNpcPackageEditorDocument(
  pack: NpcPackageDef,
  context?: NpcPackageValidationContext,
): NpcPackageEditorDocument {
  const validation = validateNpcPackage(pack, context);
  return {
    schema: 'gigahrush.npc-package',
    version: NPC_PACKAGE_SCHEMA_VERSION,
    package: pack,
    validation: {
      errors: validation.errors,
      warnings: validation.warnings,
    },
    lookupHints: npcPackageLookupHints(context),
  };
}

export const NPC_SPRITE_RLE_FORMAT = 'gigahrush_sprite_rle_v1';
export const NPC_SPRITE_RLE_MAX_DIMENSION = 128;
export const NPC_SPRITE_RLE_MAX_PALETTE = 32;
export const NPC_SPRITE_RLE_MAX_BYTES = 64 * 1024;

export interface NpcSpriteRlePayload {
  format: typeof NPC_SPRITE_RLE_FORMAT;
  width: number;
  height: number;
  palette: readonly (string | number)[];
  rle: string | readonly number[];
  anchor: {
    feetX: number;
    feetY: number;
  };
  portraitCrop?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface NpcSpriteRleValidationResult {
  valid: boolean;
  errors: readonly string[];
  sprite?: NpcSpriteRlePayload;
}

export interface NpcCommunityPackageFolder {
  folderName: string;
  npc: unknown;
  spriteRle: unknown;
  readme: unknown;
  consent: unknown;
  files?: readonly string[];
}

export interface NpcCommunityPackageValidationResult {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  package?: NpcPackageDef;
  sprite?: NpcSpriteRlePayload;
}

const COMMUNITY_PACKAGE_FILES = new Set(['npc.json', 'sprite.rle.json', 'README.md', 'consent.json']);
const EXECUTABLE_MARKDOWN_RE = /<\s*(?:script|iframe|object|embed)\b|javascript:/i;
const COLOR_RE = /^#?[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function validatePaletteEntry(problems: ProblemList, scope: string, value: unknown): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) problems.errors.push(`${scope} must be uint32 color`);
    return;
  }
  if (typeof value === 'string' && COLOR_RE.test(value)) return;
  problems.errors.push(`${scope} must be a hex or uint32 color`);
}

export function validateNpcSpriteRlePayload(payload: unknown): NpcSpriteRleValidationResult {
  const problems: ProblemList = { errors: [], warnings: [] };
  if (hasFunction(payload)) problems.errors.push('sprite payload must not contain function values');
  if (!isRecord(payload)) {
    problems.errors.push('sprite.rle.json must be an object');
    return { valid: false, errors: problems.errors };
  }
  if (payload.format !== NPC_SPRITE_RLE_FORMAT) problems.errors.push(`sprite.format must be ${NPC_SPRITE_RLE_FORMAT}`);
  integerInRange(problems, 'sprite.width', payload.width, 1, NPC_SPRITE_RLE_MAX_DIMENSION);
  integerInRange(problems, 'sprite.height', payload.height, 1, NPC_SPRITE_RLE_MAX_DIMENSION);

  if (!Array.isArray(payload.palette)) {
    problems.errors.push('sprite.palette must be an array');
  } else {
    if (payload.palette.length <= 0 || payload.palette.length > NPC_SPRITE_RLE_MAX_PALETTE) {
      problems.errors.push(`sprite.palette must have 1..${NPC_SPRITE_RLE_MAX_PALETTE} entries`);
    }
    payload.palette.forEach((entry, index) => validatePaletteEntry(problems, `sprite.palette[${index}]`, entry));
  }

  if (typeof payload.rle === 'string') {
    if (payload.rle.length <= 0 || payload.rle.length > NPC_SPRITE_RLE_MAX_BYTES) {
      problems.errors.push(`sprite.rle string length must be 1..${NPC_SPRITE_RLE_MAX_BYTES}`);
    }
  } else if (Array.isArray(payload.rle)) {
    if (payload.rle.length <= 0 || payload.rle.length > NPC_SPRITE_RLE_MAX_BYTES) {
      problems.errors.push(`sprite.rle byte length must be 1..${NPC_SPRITE_RLE_MAX_BYTES}`);
    }
    payload.rle.forEach((byte, index) => {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) problems.errors.push(`sprite.rle[${index}] must be byte`);
    });
  } else {
    problems.errors.push('sprite.rle must be a string or byte array');
  }

  if (!isRecord(payload.anchor)) {
    problems.errors.push('sprite.anchor must be an object');
  } else {
    const width = typeof payload.width === 'number' ? payload.width : 0;
    const height = typeof payload.height === 'number' ? payload.height : 0;
    integerInRange(problems, 'sprite.anchor.feetX', payload.anchor.feetX, 0, Math.max(0, width - 1));
    integerInRange(problems, 'sprite.anchor.feetY', payload.anchor.feetY, 0, Math.max(0, height - 1));
  }

  if (payload.portraitCrop !== undefined) {
    if (!isRecord(payload.portraitCrop)) {
      problems.errors.push('sprite.portraitCrop must be an object');
    } else {
      const width = typeof payload.width === 'number' ? payload.width : 0;
      const height = typeof payload.height === 'number' ? payload.height : 0;
      integerInRange(problems, 'sprite.portraitCrop.x', payload.portraitCrop.x, 0, Math.max(0, width - 1));
      integerInRange(problems, 'sprite.portraitCrop.y', payload.portraitCrop.y, 0, Math.max(0, height - 1));
      integerInRange(problems, 'sprite.portraitCrop.w', payload.portraitCrop.w, 1, width);
      integerInRange(problems, 'sprite.portraitCrop.h', payload.portraitCrop.h, 1, height);
      if (
        typeof payload.portraitCrop.x === 'number'
        && typeof payload.portraitCrop.w === 'number'
        && payload.portraitCrop.x + payload.portraitCrop.w > width
      ) {
        problems.errors.push('sprite.portraitCrop exceeds sprite width');
      }
      if (
        typeof payload.portraitCrop.y === 'number'
        && typeof payload.portraitCrop.h === 'number'
        && payload.portraitCrop.y + payload.portraitCrop.h > height
      ) {
        problems.errors.push('sprite.portraitCrop exceeds sprite height');
      }
    }
  }

  return {
    valid: problems.errors.length === 0,
    errors: problems.errors,
    sprite: problems.errors.length === 0 ? payload as unknown as NpcSpriteRlePayload : undefined,
  };
}

function validateCommunityFiles(problems: ProblemList, files: readonly string[] | undefined): void {
  if (!files) return;
  for (const file of files) {
    if (!COMMUNITY_PACKAGE_FILES.has(file)) problems.errors.push(`community file "${file}" is not part of the runtime contract`);
  }
  for (const file of COMMUNITY_PACKAGE_FILES) {
    if (!files.includes(file)) problems.errors.push(`community folder missing ${file}`);
  }
}

function validateCommunityMarkdown(problems: ProblemList, readme: unknown): void {
  const text = requireString(problems, 'README.md', readme, 2048);
  if (!text) return;
  if (URL_RE.test(text)) problems.errors.push('README.md must not contain remote URLs');
  if (EXECUTABLE_MARKDOWN_RE.test(text)) problems.errors.push('README.md must not contain executable markup');
}

export function validateCommunityNpcPackageFolder(
  folder: NpcCommunityPackageFolder,
  context?: NpcPackageValidationContext,
): NpcCommunityPackageValidationResult {
  const problems: ProblemList = { errors: [], warnings: [] };
  if (!PACKAGE_ID_RE.test(folder.folderName)) problems.errors.push('community folder name must be a package id');
  validateCommunityFiles(problems, folder.files);
  validateCommunityMarkdown(problems, folder.readme);

  if (!isRecord(folder.consent)) {
    problems.errors.push('consent.json is required for community packs');
  } else {
    if (hasFunction(folder.consent)) problems.errors.push('consent.json must not contain function values');
    scanStrings(folder.consent, text => {
      if (URL_RE.test(text)) problems.errors.push('consent.json must not contain remote URLs');
    });
  }

  const npc = validateNpcPackage(folder.npc, context);
  problems.errors.push(...npc.errors.map(error => `npc.json: ${error}`));
  problems.warnings.push(...npc.warnings.map(warning => `npc.json: ${warning}`));
  const pack = npc.valid ? folder.npc as NpcPackageDef : undefined;
  if (pack && pack.id !== folder.folderName) {
    problems.errors.push(`folder name "${folder.folderName}" must equal npc.json id "${pack.id}"`);
  }

  const sprite = validateNpcSpriteRlePayload(folder.spriteRle);
  problems.errors.push(...sprite.errors.map(error => `sprite.rle.json: ${error}`));

  return {
    valid: problems.errors.length === 0,
    errors: problems.errors,
    warnings: problems.warnings,
    package: problems.errors.length === 0 ? pack : undefined,
    sprite: problems.errors.length === 0 ? sprite.sprite : undefined,
  };
}
