import {
  Faction,
  Occupation,
  type CharacterSex,
  type Item,
} from '../core/types';
import type { DemosSocialRoleId } from './demos_social';
import type { PlotNpcDef, SideQuestStep } from './plot';
import {
  compileNpcPackageEditorDocument,
  NPC_PACKAGE_INVENTORY_CAP,
  validateCommunityNpcPackageFolder,
  validateNpcPackage,
  type NpcCommunityPackageFolder,
  type NpcPackageEditorDocument,
  type NpcPackageValidationContext,
  type NpcPackageValidationResult,
} from './npc_package_schema';
import { COMMUNITY_NPC_PACKAGE_FOLDERS } from './npc_packages/community';
import { getStack, ITEMS } from './items';

export type NpcPackageKind = 'plot' | 'design' | 'procedural';
export type NpcPackagePresence = 'population' | 'anchor' | 'room_content' | 'event_only';
export type NpcPackageMobility = 'fixed_home' | 'cold_movable' | 'caravan_allowed' | 'event_locked';
export type DemosSocialEdgeFlagId = 'family' | 'friend' | 'enemy' | 'work' | 'faction' | 'debt' | 'quest' | 'hidden';

export interface NpcIdentityDef {
  firstName?: string;
  lastName?: string;
  patronymic?: string;
  nickname?: string;
  displayName?: string;
  aliases?: readonly string[];
}

export interface NpcBioDef {
  publicLine: string;
  short?: string;
  origin?: string;
  work?: string;
  wants?: readonly string[];
  fears?: readonly string[];
  habits?: readonly string[];
  secrets?: readonly string[];
  markovTags?: readonly string[];
}

export interface NpcDemographicsDef {
  sex: CharacterSex;
  age: number;
}

export interface NpcAffiliationDef {
  faction: Faction;
  occupation: Occupation;
  roleId?: string;
  familyId?: number;
}

export interface NpcPerkRef {
  id: string;
  rank?: number;
  tags?: readonly string[];
}

export interface NpcRpgDef {
  level: number;
  str?: number;
  agi?: number;
  int?: number;
  perks?: readonly NpcPerkRef[];
}

export interface NpcWealthDef {
  cashRubles?: number;
  accountRubles?: number;
  debtRubles?: number;
  assetTags?: readonly string[];
}

export interface NpcLoadoutDef {
  weapon?: string;
  tool?: string;
  inventory?: readonly Item[];
}

export interface NpcSocialLinkDef {
  targetNpcId: string;
  relation: number;
  role: DemosSocialRoleId;
  flags?: readonly DemosSocialEdgeFlagId[];
  bidirectional?: boolean;
}

export interface NpcSocialDef {
  playerRelation?: number;
  karma?: number;
  links?: readonly NpcSocialLinkDef[];
}

export interface NpcVisualDef {
  sprite?: number;
  spriteScale?: number;
  npcVisualId?: string;
  spriteSeed?: number;
  portraitHint?: string;
}

export interface NpcPlacementDef {
  homeFloorKey: string;
  presence: NpcPackagePresence;
  mobility?: NpcPackageMobility;
  roomId?: string;
  roomTags?: readonly string[];
  anchorId?: string;
  spawnTags?: readonly string[];
}

export interface NpcSpeechDef {
  voiceTags?: readonly string[];
  markovDomains?: readonly string[];
  catchphrases?: readonly string[];
  forbiddenTopics?: readonly string[];
  talkLines?: readonly string[];
  talkLinesPost?: readonly string[];
  talkQuestResponse?: string | readonly string[];
  ambientCorpus?: readonly string[];
  barkCorpus?: readonly string[];
  demosPostHints?: readonly string[];
}

/**
 * Authored runtime defaults may seed durable folded fields, but live entity id,
 * coordinates after spawn, AI path/timers, needs, statuses, attack cooldowns
 * and temporary combat targets remain runtime-only state.
 */
export interface NpcRuntimeDefaultsDef {
  hp?: number;
  maxHp?: number;
  speed?: number;
  isTraveler?: boolean;
  canGiveQuest?: boolean;
  specialRoutineId?: string;
  assignedRoomId?: number;
  initialKills?: number;
  initialNpcKills?: number;
  initialMonsterKills?: number;
  reserveInAlife?: boolean;
}

export interface NpcContentDef {
  plotNpcId?: string;
  dialogueId?: string;
  questIds?: readonly string[];
  sideQuestSteps?: readonly SideQuestStep[];
  roomContentId?: string;
  documentIds?: readonly string[];
  tradeProfileId?: string;
  debugPath?: string;
  tags?: readonly string[];
}

export interface NpcEditorMetaDef {
  title?: string;
  author?: string;
  source?: 'game' | 'editor' | 'community' | 'debug';
  reviewStatus?: 'draft' | 'submitted' | 'needs_review' | 'accepted' | 'rejected' | 'imported' | 'reviewed';
  notes?: string;
}

export interface NpcPackageDef {
  version: 1;
  id: string;
  kind: NpcPackageKind;
  identity: NpcIdentityDef;
  bio: NpcBioDef;
  demographics: NpcDemographicsDef;
  affiliation: NpcAffiliationDef;
  rpg: NpcRpgDef;
  wealth: NpcWealthDef;
  loadout: NpcLoadoutDef;
  social: NpcSocialDef;
  visual: NpcVisualDef;
  placement: NpcPlacementDef;
  speech: NpcSpeechDef;
  runtime?: NpcRuntimeDefaultsDef;
  content?: NpcContentDef;
  editor?: NpcEditorMetaDef;
  tags?: readonly string[];
}

export type {
  NpcPackageEditorDocument,
  NpcPackageValidationContext,
  NpcPackageValidationResult,
};

export interface NpcPackageRegistryInput {
  version: 1;
  id: string;
  kind: NpcPackageKind;
  identity?: Partial<NpcIdentityDef>;
  bio?: Partial<NpcBioDef>;
  demographics?: Partial<NpcDemographicsDef>;
  affiliation?: Partial<NpcAffiliationDef>;
  rpg?: Partial<NpcRpgDef>;
  wealth?: NpcWealthDef;
  loadout?: NpcLoadoutDef;
  social?: NpcSocialDef;
  visual?: NpcVisualDef;
  placement?: Partial<NpcPlacementDef>;
  speech?: NpcSpeechDef;
  runtime?: NpcRuntimeDefaultsDef;
  content?: NpcContentDef;
  editor?: NpcEditorMetaDef;
  tags?: readonly string[];
}

const NPC_PACKAGES: NpcPackageDef[] = [];
const NPC_PACKAGES_BY_ID = new Map<string, NpcPackageDef>();

function packageIdsWith(extra: readonly NpcPackageDef[]): readonly string[] {
  return [
    ...NPC_PACKAGES.map(pack => pack.id),
    ...extra.map(pack => pack.id),
  ];
}

function nameFromIdentity(id: string, identity: Partial<NpcIdentityDef> | undefined): string {
  const direct = identity?.displayName?.trim();
  if (direct) return direct;
  const parts = [
    identity?.firstName,
    identity?.patronymic,
    identity?.lastName,
  ].map(part => part?.trim()).filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : id;
}

function normalizeNpcPackageInput(input: NpcPackageDef | NpcPackageRegistryInput): NpcPackageDef {
  const identityInput = input.identity ?? {};
  const displayName = nameFromIdentity(input.id, identityInput);
  const bioInput = input.bio ?? {};
  const demographicsInput = input.demographics ?? {};
  const affiliationInput = input.affiliation ?? {};
  const rpgInput = input.rpg ?? {};
  const placementInput = input.placement ?? {};
  return {
    version: 1,
    id: input.id,
    kind: input.kind,
    identity: {
      ...identityInput,
      displayName: identityInput.displayName ?? displayName,
    },
    bio: {
      ...bioInput,
      publicLine: bioInput.publicLine?.trim() || displayName,
    },
    demographics: {
      ...demographicsInput,
      sex: demographicsInput.sex ?? 'male',
      age: demographicsInput.age ?? 35,
    },
    affiliation: {
      ...affiliationInput,
      faction: affiliationInput.faction ?? Faction.CITIZEN,
      occupation: affiliationInput.occupation ?? Occupation.HOUSEWIFE,
    },
    rpg: {
      ...rpgInput,
      level: rpgInput.level ?? 1,
    },
    wealth: input.wealth ?? {},
    loadout: input.loadout ?? {},
    social: input.social ?? {},
    visual: input.visual ?? {},
    placement: {
      ...placementInput,
      homeFloorKey: placementInput.homeFloorKey ?? 'story:living',
      presence: placementInput.presence ?? 'anchor',
    },
    speech: input.speech ?? {},
    runtime: input.runtime,
    content: input.content,
    editor: input.editor,
    tags: input.tags,
  };
}

function registryValidationContext(pack: NpcPackageDef, packageIds?: readonly string[]): NpcPackageValidationContext {
  const extraPerkIds = [...new Set((pack.rpg.perks ?? []).map(perk => perk.id))];
  const extraVisualIds = pack.visual.npcVisualId ? [pack.visual.npcVisualId] : [];
  return {
    ...(packageIds ? { packageIds } : {}),
    ...(extraPerkIds.length > 0 ? { extraPerkIds, allowUnknownPerks: true } : {}),
    ...(extraVisualIds.length > 0 ? { extraVisualIds } : {}),
  };
}

function assertValidForRegistry(pack: NpcPackageDef, packageIds?: readonly string[]): void {
  const result = validateNpcPackage(pack, registryValidationContext(pack, packageIds));
  if (result.errors.length > 0) {
    throw new Error(`[NPC_PACKAGE] invalid package "${pack.id}": ${result.errors.join('; ')}`);
  }
}

export function registerNpcPackage(input: NpcPackageDef | NpcPackageRegistryInput): void {
  const pack = normalizeNpcPackageInput(input);
  if (NPC_PACKAGES_BY_ID.has(pack.id)) throw new Error(`[NPC_PACKAGE] duplicate id "${pack.id}"`);
  assertValidForRegistry(pack);
  NPC_PACKAGES.push(pack);
  NPC_PACKAGES_BY_ID.set(pack.id, pack);
}

export function registerNpcPackages(inputs: readonly (NpcPackageDef | NpcPackageRegistryInput)[]): void {
  const packs = inputs.map(normalizeNpcPackageInput);
  const batchIds = new Set<string>();
  for (const pack of packs) {
    if (NPC_PACKAGES_BY_ID.has(pack.id) || batchIds.has(pack.id)) {
      throw new Error(`[NPC_PACKAGE] duplicate id "${pack.id}"`);
    }
    batchIds.add(pack.id);
  }
  const packageIds = packageIdsWith(packs);
  for (const pack of packs) assertValidForRegistry(pack, packageIds);
  for (const pack of packs) {
    NPC_PACKAGES.push(pack);
    NPC_PACKAGES_BY_ID.set(pack.id, pack);
  }
}

export function getNpcPackage(id: string): NpcPackageDef | undefined {
  return NPC_PACKAGES_BY_ID.get(id);
}

export function getNpcPackageByPlotNpcId(plotNpcId: string): NpcPackageDef | undefined {
  const direct = NPC_PACKAGES_BY_ID.get(plotNpcId);
  if (direct?.content?.plotNpcId === plotNpcId) return direct;
  return NPC_PACKAGES.find(pack => pack.content?.plotNpcId === plotNpcId);
}

export function allNpcPackages(): readonly NpcPackageDef[] {
  return NPC_PACKAGES;
}

export function clearNpcPackagesForTests(): void {
  NPC_PACKAGES.length = 0;
  NPC_PACKAGES_BY_ID.clear();
}

export function validateNpcPackages(): readonly string[] {
  const errors: string[] = [];
  const ids = packageIdsWith([]);
  const seen = new Set<string>();
  for (const pack of NPC_PACKAGES) {
    if (seen.has(pack.id)) errors.push(`${pack.id}:duplicate`);
    seen.add(pack.id);
    const result = validateNpcPackage(pack, registryValidationContext(pack, ids));
    for (const error of result.errors) errors.push(`${pack.id}:${error}`);
  }
  return errors;
}

export function compileNpcPackageForEditor(id: string): NpcPackageEditorDocument | undefined {
  const pack = getNpcPackage(id);
  return pack ? compileNpcPackageEditorDocument(pack, { packageIds: packageIdsWith([]) }) : undefined;
}

export function registerCommunityNpcPackageFolders(folders: readonly NpcCommunityPackageFolder[]): readonly string[] {
  const errors: string[] = [];
  for (const folder of folders) {
    const result = validateCommunityNpcPackageFolder(folder, { packageIds: packageIdsWith([]) });
    if (!result.valid || !result.package) {
      errors.push(...result.errors.map(error => `${folder.folderName}: ${error}`));
      continue;
    }
    try {
      registerNpcPackage(result.package);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

export function registerReviewedCommunityNpcPackages(): readonly string[] {
  return registerCommunityNpcPackageFolders(COMMUNITY_NPC_PACKAGE_FOLDERS);
}

export function npcPackageDisplayName(pack: NpcPackageDef): string {
  if (pack.identity.displayName) return pack.identity.displayName;
  const name = [
    pack.identity.firstName,
    pack.identity.patronymic,
    pack.identity.lastName,
  ].filter(Boolean).join(' ');
  if (name) return pack.identity.nickname ? `${name} ("${pack.identity.nickname}")` : name;
  return pack.identity.nickname ?? pack.id;
}

export function plotNpcIdFromPackage(pack: NpcPackageDef): string | undefined {
  return pack.content?.plotNpcId;
}

export function npcReservedIdentityId(packageId: string): string {
  return `npc:${packageId}`;
}

export function npcPackageRuntimeEligible(pack: NpcPackageDef): boolean {
  if (pack.runtime?.reserveInAlife === false) return false;
  if (pack.editor?.source === 'debug') return false;
  const status = pack.editor?.reviewStatus;
  if (status === 'draft' || status === 'submitted' || status === 'needs_review' || status === 'rejected') return false;
  if (pack.editor?.source === 'community' && status !== 'accepted' && status !== 'imported' && status !== 'reviewed') return false;
  return pack.placement.homeFloorKey.trim().length > 0;
}

export interface PlotNpcPackageInput {
  id: string;
  npc: PlotNpcDef;
  quests?: readonly SideQuestStep[];
  kind?: NpcPackageKind;
  presence?: NpcPackagePresence;
  tags?: readonly string[];
}

function trimTags(input: readonly string[] | undefined, maxItems = 16): readonly string[] | undefined {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const tag = raw.trim();
    if (!tag || out.includes(tag)) continue;
    out.push(tag.slice(0, 48));
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

function displayIdentity(displayName: string): NpcIdentityDef {
  const name = displayName.trim();
  return {
    displayName: name,
  };
}

function authoredPublicLine(npc: PlotNpcDef): string {
  const line = npc.talkLines.find(text => text.trim()) ?? npc.name;
  return line.trim().slice(0, 220);
}

function packageInventoryFromPlotItems(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    if (out.length >= NPC_PACKAGE_INVENTORY_CAP) break;
    const def = ITEMS[item.defId];
    const stackMax = def ? getStack(def) : Math.max(1, Math.floor(item.count));
    let remaining = Math.max(1, Math.floor(item.count));
    while (remaining > 0 && out.length < NPC_PACKAGE_INVENTORY_CAP) {
      const count = Math.min(remaining, stackMax);
      const stack: Item = { defId: item.defId, count };
      if (item.data !== undefined) stack.data = item.data;
      out.push(stack);
      remaining -= count;
    }
  }
  return out;
}

function packageKindForPlotNpc(homeFloorKey: string | undefined, kind: NpcPackageKind | undefined): NpcPackageKind {
  if (kind) return kind;
  return homeFloorKey?.startsWith('procedural:') ? 'procedural' : 'design';
}

function packagePresenceForPlotNpc(homeFloorKey: string | undefined, presence: NpcPackagePresence | undefined, quests: readonly SideQuestStep[]): NpcPackagePresence {
  if (presence) return presence;
  if (quests.length <= 0) return 'population';
  return homeFloorKey?.startsWith('design:') ? 'anchor' : 'room_content';
}

function packageRuntimeSpeed(speed: number): number | undefined {
  if (speed <= 0) return undefined;
  return Math.max(0.1, Math.min(20, speed));
}

export function npcPackageFromPlotNpc(input: PlotNpcPackageInput): NpcPackageDef {
  const quests = input.quests ?? [];
  const homeFloorKey = input.npc.homeFloorKey ?? 'story:living';
  const tags = trimTags(['authored', input.id, ...(input.npc.authoredTags ?? []), ...(input.tags ?? [])]);
  const questIds = quests.map(quest => quest.id);
  const speed = packageRuntimeSpeed(input.npc.speed);
  return {
    version: 1,
    id: input.id,
    kind: packageKindForPlotNpc(homeFloorKey, input.kind),
    identity: displayIdentity(input.npc.name),
    bio: {
      publicLine: authoredPublicLine(input.npc),
    },
    demographics: {
      sex: input.npc.sex ?? (input.npc.isFemale ? 'female' : 'male'),
      age: input.npc.age ?? (input.npc.isFemale ? 30 : 35),
    },
    affiliation: {
      faction: input.npc.faction,
      occupation: input.npc.occupation,
      roleId: `plot:${input.id}`,
    },
    rpg: {
      level: input.npc.level ?? 1,
    },
    wealth: {
      cashRubles: input.npc.money,
      accountRubles: input.npc.accountRubles,
    },
    loadout: {
      weapon: input.npc.weapon,
      inventory: packageInventoryFromPlotItems(input.npc.inventory),
    },
    social: {},
    visual: {
      sprite: input.npc.sprite,
      spriteScale: input.npc.spriteScale,
      npcVisualId: input.npc.npcVisualId,
    },
    placement: {
      homeFloorKey,
      presence: packagePresenceForPlotNpc(homeFloorKey, input.presence, quests),
      mobility: 'fixed_home',
    },
    speech: {
      talkLines: [...input.npc.talkLines],
      talkLinesPost: [...input.npc.talkLinesPost],
      talkQuestResponse: input.npc.talkQuestResponse,
    },
    runtime: {
      hp: input.npc.hp,
      maxHp: input.npc.maxHp,
      ...(speed !== undefined ? { speed } : {}),
      ...(input.npc.specialRoutineId ? { specialRoutineId: input.npc.specialRoutineId } : {}),
      canGiveQuest: questIds.length > 0,
    },
    content: {
      plotNpcId: input.id,
      questIds,
      sideQuestSteps: quests,
      debugPath: `plot:${input.id}`,
    },
    tags,
  };
}

export function registerNpcPackageFromPlotNpc(input: PlotNpcPackageInput): NpcPackageDef {
  const pack = npcPackageFromPlotNpc(input);
  registerNpcPackage(pack);
  return pack;
}
