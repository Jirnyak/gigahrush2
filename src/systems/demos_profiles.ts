import {
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
  type GameState,
  type WorldEvent,
  type WorldEventBuffer,
} from '../core/types';
import {
  DEMOS_TRAIT_REGISTRY_VERSION,
  DEMOS_TRAIT_SLOTS,
  demosTraitByIndex,
  demosTraitIndexById,
  demosTraitsByKind,
  type DemosTraitDef,
  type DemosTraitKind,
} from '../data/demos_traits';
import { occupationHasProfileTag, occupationProfile } from '../data/occupation_profiles';
import {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_QUEST,
  DEMOS_EDGE_WORK,
  DEMOS_RELATION_FRIENDLY_THRESHOLD,
  DEMOS_RELATION_HOSTILE_THRESHOLD,
  DEMOS_SOCIAL_PUBLIC_SLOTS,
  DemosSocialRoleId,
} from '../data/demos_social';
import {
  characterAgeBandLabelRu,
  characterAgeSexTags,
  characterSexLabelRu,
} from '../data/demographics';
import {
  alifeNpcRecordCount,
  alifeSeed,
  getAlifeNpcRecordSnapshot,
  packageIdFromReservedIdentityId,
  type AlifeNpcSnapshot,
} from './alife';
import {
  getNpcPackage,
  npcPackageDisplayName,
  type NpcPackageDef,
} from '../data/npc_packages';
import { demosRelationBand } from './demos';
import { getDemosOutgoingSocialEdges, type DemosSocialEdgeView } from './demos_social';

const DEMOS_PROFILE_RECENT_LIMIT = 48;
const DEMOS_SOCIAL_FALLBACK_TRIES = 24;
const DEMOS_FAMILY_PROBE_RANGE = 18;

export interface DemosTraitView {
  index: number;
  id: string;
  kind: DemosTraitKind;
  label: string;
  tags: readonly string[];
  relationBias?: number;
  questWeightBias?: number;
  barkWeightBias?: number;
}

export interface DemosSocialLinkSeed {
  targetKind?: 'player' | 'alife';
  targetAlifeId?: number;
  relation: number;
  role?: DemosSocialRoleId;
  flags?: number;
  hidden?: boolean;
  tags?: readonly string[];
}

export interface DemosSocialLinkView {
  sourceAlifeId: number;
  targetKind: 'player' | 'alife';
  targetAlifeId?: number;
  targetLabel: string;
  relation: number;
  relationLabel: string;
  relationColor: string;
  role: DemosSocialRoleId;
  roleLabel: string;
  flags: number;
  hidden: boolean;
  dead: boolean;
  tags: readonly string[];
}

export interface DemosProfileFeedEntry {
  postId: number;
  eventId: number;
  eventType: string;
  createdAt: number;
  label: string;
  summary: string;
  tags: readonly string[];
}

export interface DemosProfileDetails {
  alifeId: number;
  packageId?: string;
  packageDisplayName?: string;
  packagePublicLine?: string;
  packageBioLine?: string;
  packageOriginLabel?: string;
  packageWorkLabel?: string;
  packagePortraitHint?: string;
  age: number;
  ageBandLabel: string;
  sexLabel: string;
  accountRubles: number;
  accountLabel: string;
  capitalRubles: number;
  capitalLabel: string;
  familyStatusLabel: string;
  relationToPlayerLabel: string;
  friendsCount: number;
  enemiesCount: number;
  familyCount: number;
  traits: readonly DemosTraitView[];
  packageFlavorTags: readonly string[];
  interests: readonly string[];
  favoriteWorkLabel?: string;
  fearLabel?: string;
  lastPostId?: number;
  mentionsRecent: number;
  dead: boolean;
}

interface DemosTraitCache {
  signature: string;
  total: number;
  traitIds: Uint16Array;
  ready: Uint8Array;
}

interface DemosProfileHost {
  demosProfileTraitCache?: DemosTraitCache;
  demosProfileSocialEdges?: Record<number, readonly DemosSocialLinkSeed[]> | Map<number, readonly DemosSocialLinkSeed[]>;
}

const ROLE_LABELS: Record<DemosSocialRoleId, string> = {
  [DemosSocialRoleId.ACQUAINTANCE]: 'знакомый',
  [DemosSocialRoleId.FRIEND]: 'друг',
  [DemosSocialRoleId.RIVAL]: 'спор',
  [DemosSocialRoleId.ENEMY]: 'враг',
  [DemosSocialRoleId.PARENT]: 'родитель',
  [DemosSocialRoleId.CHILD]: 'ребёнок',
  [DemosSocialRoleId.PARTNER]: 'пара',
  [DemosSocialRoleId.WORK]: 'смена',
  [DemosSocialRoleId.DEBT]: 'долг',
  [DemosSocialRoleId.QUEST]: 'дело',
};

const ROLE_BY_STRING: Readonly<Record<string, DemosSocialRoleId>> = {
  acquaintance: DemosSocialRoleId.ACQUAINTANCE,
  friend: DemosSocialRoleId.FRIEND,
  rival: DemosSocialRoleId.RIVAL,
  enemy: DemosSocialRoleId.ENEMY,
  parent: DemosSocialRoleId.PARENT,
  child: DemosSocialRoleId.CHILD,
  partner: DemosSocialRoleId.PARTNER,
  work: DemosSocialRoleId.WORK,
  debt: DemosSocialRoleId.DEBT,
  quest: DemosSocialRoleId.QUEST,
};

const FACTION_INTERESTS: Record<Faction, readonly string[]> = {
  [Faction.CITIZEN]: ['жилая очередь'],
  [Faction.LIQUIDATOR]: ['патрульный журнал'],
  [Faction.CULTIST]: ['знак у двери'],
  [Faction.SCIENTIST]: ['лабораторная заявка'],
  [Faction.WILD]: ['тихий проход'],
  [Faction.PLAYER]: ['маршрут игрока'],
};

const TRAIT_INTEREST_LABELS: Partial<Record<string, string>> = {
  fear_debt: 'чистая расписка',
  fear_hunger: 'запасная пайка',
  fear_monster: 'светлый угол',
  fear_samosbor: 'герма до сирены',
  taste_documents: 'ровная справка',
  taste_food: 'кухонные слухи',
  taste_medicine: 'сухой бинт',
  taste_tools: 'исправный инструмент',
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function hash32(a: number, b: number, c = 0, d = 0): number {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b)
    + Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d)
    + Math.imul(c ^ 0x165667b1, 0x9e3779b1)
    + d) | 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

function traitCacheSignature(state: GameState, total: number): string {
  return `demos_traits:${DEMOS_TRAIT_REGISTRY_VERSION}:${alifeSeed(state)}:${total}`;
}

function ensureTraitCache(state: GameState, total: number): DemosTraitCache {
  const host = state as GameState & DemosProfileHost;
  const signature = traitCacheSignature(state, total);
  const existing = host.demosProfileTraitCache;
  if (existing && existing.signature === signature && existing.total === total) return existing;
  const cache = {
    signature,
    total,
    traitIds: new Uint16Array(total * DEMOS_TRAIT_SLOTS),
    ready: new Uint8Array(total),
  };
  host.demosProfileTraitCache = cache;
  return cache;
}

function traitIdByHash(kind: DemosTraitKind, seed: number, snapshot: AlifeNpcSnapshot, salt: number): string {
  const traits = demosTraitsByKind(kind);
  if (traits.length === 0) return '';
  const idx = hash32(seed, snapshot.id, snapshot.faction + snapshot.occupation * 31, salt) % traits.length;
  return traits[idx].id;
}

function temperTraitId(seed: number, snapshot: AlifeNpcSnapshot): string {
  const relation = snapshot.playerRelation ?? 0;
  if (relation <= -55 || snapshot.karma <= -50) return 'vengeful';
  if (occupationHasProfileTag(snapshot.occupation, 'combat') || relation >= 55) return 'brave';
  if (snapshot.faction === Faction.LIQUIDATOR || snapshot.faction === Faction.SCIENTIST) return 'orderly';
  if ((hash32(seed, snapshot.id, 1) & 3) === 0) return 'cowardly';
  return traitIdByHash('temper', seed, snapshot, 11);
}

function socialTraitId(seed: number, snapshot: AlifeNpcSnapshot): string {
  const relation = snapshot.playerRelation ?? 0;
  if (relation >= 45 || snapshot.karma >= 35) return 'helpful';
  if (snapshot.accountRubles > 2500 || relation <= -35) return 'greedy';
  if ((hash32(seed, snapshot.id, 2) & 1) === 0) return 'quiet_neighbor';
  return traitIdByHash('social', seed, snapshot, 23);
}

function workTraitId(snapshot: AlifeNpcSnapshot): string {
  return occupationProfile(snapshot.occupation)?.demosTraits.work ?? 'work_pride';
}

function tasteTraitId(snapshot: AlifeNpcSnapshot): string {
  return occupationProfile(snapshot.occupation)?.demosTraits.taste ?? 'taste_tools';
}

function questTraitId(snapshot: AlifeNpcSnapshot): string {
  return occupationProfile(snapshot.occupation)?.demosTraits.quest ?? 'quest_fetch';
}

function fourthTraitId(seed: number, snapshot: AlifeNpcSnapshot): string {
  if (snapshot.canGiveQuest) return questTraitId(snapshot);
  const h = hash32(seed, snapshot.id, snapshot.floor + 7, 41) % 4;
  if (h === 0) return snapshot.floor === FloorLevel.HELL || snapshot.floor === FloorLevel.VOID ? 'fear_monster' : 'fear_samosbor';
  if (h === 1) return snapshot.accountRubles < 40 ? 'fear_debt' : 'fear_hunger';
  return tasteTraitId(snapshot);
}

function fillTraitSlots(state: GameState, snapshot: AlifeNpcSnapshot, cache: DemosTraitCache): void {
  const offset = (snapshot.id - 1) * DEMOS_TRAIT_SLOTS;
  const seed = alifeSeed(state);
  const ids = [
    temperTraitId(seed, snapshot),
    socialTraitId(seed, snapshot),
    workTraitId(snapshot),
    fourthTraitId(seed, snapshot),
  ];
  const used = new Set<number>();
  for (let slot = 0; slot < DEMOS_TRAIT_SLOTS; slot++) {
    let index = demosTraitIndexById(ids[slot]);
    if (index > 0 && used.has(index)) index = 0;
    if (index === 0) {
      const fallback = demosTraitsByKind(slot === 3 ? 'taste' : 'temper');
      for (const def of fallback) {
        const fallbackIndex = demosTraitIndexById(def.id);
        if (!used.has(fallbackIndex)) {
          index = fallbackIndex;
          break;
        }
      }
    }
    cache.traitIds[offset + slot] = index;
    if (index > 0) used.add(index);
  }
  cache.ready[snapshot.id - 1] = 1;
}

function traitView(index: number, def: DemosTraitDef): DemosTraitView {
  return {
    index,
    id: def.id,
    kind: def.kind,
    label: def.label,
    tags: def.tags,
    relationBias: def.relationBias,
    questWeightBias: def.questWeightBias,
    barkWeightBias: def.barkWeightBias,
  };
}

export function getDemosTraitViews(state: GameState, alifeId: number): readonly DemosTraitView[] {
  const total = alifeNpcRecordCount(state);
  if (!Number.isInteger(alifeId) || alifeId <= 0 || alifeId > total) return [];
  const snapshot = getAlifeNpcRecordSnapshot(state, alifeId);
  if (!snapshot) return [];
  const cache = ensureTraitCache(state, total);
  if (cache.ready[alifeId - 1] === 0) fillTraitSlots(state, snapshot, cache);
  const out: DemosTraitView[] = [];
  const offset = (alifeId - 1) * DEMOS_TRAIT_SLOTS;
  for (let slot = 0; slot < DEMOS_TRAIT_SLOTS; slot++) {
    const index = cache.traitIds[offset + slot];
    const def = demosTraitByIndex(index);
    if (def) out.push(traitView(index, def));
  }
  return out;
}

function relationLabel(score: number): { label: string; color: string } {
  const scaled = Math.max(-100, Math.min(100, Math.round(score * 100 / 127)));
  return demosRelationBand(scaled);
}

function roleFromRelation(relation: number): DemosSocialRoleId {
  if (relation <= DEMOS_RELATION_HOSTILE_THRESHOLD) return DemosSocialRoleId.ENEMY;
  if (relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD) return DemosSocialRoleId.FRIEND;
  return relation < 0 ? DemosSocialRoleId.RIVAL : DemosSocialRoleId.ACQUAINTANCE;
}

function normalizeRole(role: unknown, fallback: DemosSocialRoleId): DemosSocialRoleId {
  if (typeof role === 'number' && Number.isInteger(role) && role >= DemosSocialRoleId.ACQUAINTANCE && role <= DemosSocialRoleId.QUEST) {
    return role as DemosSocialRoleId;
  }
  if (typeof role === 'string') return ROLE_BY_STRING[role] ?? fallback;
  return fallback;
}

function readInjectedSocialEdges(state: GameState, alifeId: number): readonly DemosSocialLinkSeed[] | undefined {
  const edges = (state as GameState & DemosProfileHost).demosProfileSocialEdges;
  if (!edges) return undefined;
  if (edges instanceof Map) return edges.get(alifeId);
  return edges[alifeId];
}

function roleFromGraphRole(role: DemosSocialRoleId, relation: number): DemosSocialRoleId {
  switch (role) {
    case DemosSocialRoleId.FRIEND:
    case DemosSocialRoleId.RIVAL:
    case DemosSocialRoleId.ENEMY:
    case DemosSocialRoleId.PARENT:
    case DemosSocialRoleId.CHILD:
    case DemosSocialRoleId.PARTNER:
    case DemosSocialRoleId.WORK:
    case DemosSocialRoleId.DEBT:
    case DemosSocialRoleId.QUEST:
      return role;
    default:
      return roleFromRelation(relation);
  }
}

function graphEdgeTags(edge: DemosSocialEdgeView): readonly string[] {
  const out: string[] = [];
  if ((edge.flags & DEMOS_EDGE_FAMILY) !== 0) out.push('family');
  if ((edge.flags & DEMOS_EDGE_FRIEND) !== 0) out.push('friend');
  if ((edge.flags & DEMOS_EDGE_ENEMY) !== 0) out.push('enemy');
  if ((edge.flags & DEMOS_EDGE_WORK) !== 0) out.push('work');
  if ((edge.flags & DEMOS_EDGE_DEBT) !== 0) out.push('debt');
  if ((edge.flags & DEMOS_EDGE_QUEST) !== 0) out.push('quest');
  return out;
}

function readGraphSocialEdges(state: GameState, alifeId: number): readonly DemosSocialLinkSeed[] | undefined {
  const edges = getDemosOutgoingSocialEdges(state, alifeId);
  if (edges.length === 0) return [];
  return edges.map(edge => ({
    targetKind: edge.targetKind,
    targetAlifeId: edge.targetAlifeId ?? 0,
    relation: edge.relation,
    role: roleFromGraphRole(edge.role, edge.relation),
    flags: edge.flags,
    hidden: edge.hidden,
    tags: graphEdgeTags(edge),
  }));
}

function addLinkSeed(out: DemosSocialLinkSeed[], seen: Set<number>, seed: DemosSocialLinkSeed, sourceAlifeId: number, total: number): void {
  if (seed.targetKind === 'player') {
    if (seen.has(0)) return;
    out.push({
      targetKind: 'player',
      relation: Math.max(-127, Math.min(127, Math.round(seed.relation))),
      role: seed.role,
      flags: seed.flags,
      hidden: seed.hidden,
      tags: seed.tags,
    });
    seen.add(0);
    return;
  }
  const target = clampInt(seed.targetAlifeId, 0, 1, total);
  if (target <= 0 || target === sourceAlifeId || seen.has(target)) return;
  out.push({
    targetKind: 'alife',
    targetAlifeId: target,
    relation: Math.max(-127, Math.min(127, Math.round(seed.relation))),
    role: seed.role,
    flags: seed.flags,
    hidden: seed.hidden,
    tags: seed.tags,
  });
  seen.add(target);
}

function relationForSnapshots(seed: number, source: AlifeNpcSnapshot, target: AlifeNpcSnapshot, role: DemosSocialRoleId): number {
  if (role === DemosSocialRoleId.PARENT || role === DemosSocialRoleId.CHILD || role === DemosSocialRoleId.PARTNER) {
    return 92 - (hash32(seed, source.id, target.id, 1) % 14);
  }
  let relation = (hash32(seed, source.id, target.id, 2) % 63) - 24;
  if (source.faction === target.faction) relation += 36;
  else relation -= 28;
  if (source.floorKey === target.floorKey) relation += 16;
  if (source.occupation === target.occupation) relation += 18;
  if (target.dead) relation -= 8;
  return Math.max(-127, Math.min(127, relation));
}

function familyRole(source: AlifeNpcSnapshot, target: AlifeNpcSnapshot): DemosSocialRoleId | undefined {
  if (source.familyId <= 0 || source.familyId !== target.familyId) return undefined;
  if (source.occupation === Occupation.CHILD && target.occupation !== Occupation.CHILD) return DemosSocialRoleId.PARENT;
  if (source.occupation !== Occupation.CHILD && target.occupation === Occupation.CHILD) return DemosSocialRoleId.CHILD;
  if (source.occupation !== Occupation.CHILD && target.occupation !== Occupation.CHILD) return DemosSocialRoleId.PARTNER;
  return undefined;
}

function addFamilyProbeEdges(
  state: GameState,
  out: DemosSocialLinkSeed[],
  seen: Set<number>,
  source: AlifeNpcSnapshot,
  total: number,
): void {
  if (source.familyId <= 0) return;
  const seed = alifeSeed(state);
  for (let delta = 1; delta <= DEMOS_FAMILY_PROBE_RANGE && out.length < 3; delta++) {
    for (const targetId of [source.id - delta, source.id + delta]) {
      if (targetId <= 0 || targetId > total || seen.has(targetId)) continue;
      const target = getAlifeNpcRecordSnapshot(state, targetId);
      const role = target ? familyRole(source, target) : undefined;
      if (!target || !role) continue;
      addLinkSeed(out, seen, {
        targetAlifeId: target.id,
        relation: relationForSnapshots(seed, source, target, role),
        role,
        tags: ['family'],
      }, source.id, total);
    }
  }
}

function fallbackSocialSeeds(state: GameState, source: AlifeNpcSnapshot, limit: number): readonly DemosSocialLinkSeed[] {
  const total = alifeNpcRecordCount(state);
  if (total <= 1 || limit <= 0) return [];
  const out: DemosSocialLinkSeed[] = [];
  const seen = new Set<number>();
  addFamilyProbeEdges(state, out, seen, source, total);
  const seed = alifeSeed(state);
  for (let attempt = 0; attempt < DEMOS_SOCIAL_FALLBACK_TRIES && out.length < limit; attempt++) {
    const targetId = (hash32(seed, source.id, attempt, 77) % total) + 1;
    if (targetId === source.id || seen.has(targetId)) continue;
    const target = getAlifeNpcRecordSnapshot(state, targetId);
    if (!target) continue;
    const family = familyRole(source, target);
    const role = family
      ?? (source.occupation === target.occupation ? DemosSocialRoleId.WORK
        : source.faction !== target.faction && (hash32(seed, source.id, target.id, 3) & 1) === 0 ? DemosSocialRoleId.RIVAL
          : roleFromRelation(relationForSnapshots(seed, source, target, DemosSocialRoleId.ACQUAINTANCE)));
    addLinkSeed(out, seen, {
      targetAlifeId: target.id,
      relation: relationForSnapshots(seed, source, target, role),
      role,
      tags: family ? ['family'] : source.occupation === target.occupation ? ['work'] : ['social'],
    }, source.id, total);
  }
  return out;
}

function linkViewFromSeed(
  state: GameState,
  source: AlifeNpcSnapshot,
  seed: DemosSocialLinkSeed,
): DemosSocialLinkView | undefined {
  if (seed.targetKind === 'player') {
    const relation = Math.max(-127, Math.min(127, Math.round(seed.relation)));
    const role = normalizeRole(seed.role, roleFromRelation(relation));
    const band = relationLabel(relation);
    return {
      sourceAlifeId: source.id,
      targetKind: 'player',
      targetLabel: 'player: игрок',
      relation,
      relationLabel: band.label,
      relationColor: band.color,
      role,
      roleLabel: ROLE_LABELS[role],
      flags: Math.max(0, Math.min(255, Math.trunc(seed.flags ?? 0))),
      hidden: seed.hidden === true,
      dead: false,
      tags: seed.tags ?? [],
    };
  }
  if (seed.targetAlifeId === undefined) return undefined;
  const target = getAlifeNpcRecordSnapshot(state, seed.targetAlifeId);
  if (!target) return undefined;
  const relation = Math.max(-127, Math.min(127, Math.round(seed.relation)));
  const role = normalizeRole(seed.role, roleFromRelation(relation));
  const band = relationLabel(relation);
  return {
    sourceAlifeId: source.id,
    targetKind: 'alife',
    targetAlifeId: target.id,
    targetLabel: `${target.dead ? 'мертв: ' : ''}alife:${target.id} ${target.name}`,
    relation,
    relationLabel: band.label,
    relationColor: band.color,
    role,
    roleLabel: ROLE_LABELS[role],
    flags: Math.max(0, Math.min(255, Math.trunc(seed.flags ?? 0))),
    hidden: seed.hidden === true,
    dead: target.dead,
    tags: seed.tags ?? [],
  };
}

export function buildDemosSocialLinksView(
  state: GameState,
  alifeId: number,
  limit = DEMOS_SOCIAL_PUBLIC_SLOTS,
): readonly DemosSocialLinkView[] {
  const total = alifeNpcRecordCount(state);
  if (!Number.isInteger(alifeId) || alifeId <= 0 || alifeId > total) return [];
  const source = getAlifeNpcRecordSnapshot(state, alifeId);
  if (!source) return [];
  const cap = Math.max(0, Math.min(12, Math.floor(limit)));
  const injected = readInjectedSocialEdges(state, alifeId);
  const graphSeeds = injected === undefined ? readGraphSocialEdges(state, alifeId) : undefined;
  const seeds = injected !== undefined ? injected : graphSeeds ?? fallbackSocialSeeds(state, source, cap);
  const out: DemosSocialLinkView[] = [];
  const seen = new Set<number>();
  for (const seed of seeds) {
    if (out.length >= cap) break;
    const seenKey = seed.targetKind === 'player' ? 0 : seed.targetAlifeId;
    if (seenKey !== undefined && seen.has(seenKey)) continue;
    const view = linkViewFromSeed(state, source, seed);
    if (!view) continue;
    seen.add(view.targetKind === 'player' ? 0 : view.targetAlifeId ?? 0);
    out.push(view);
  }
  return out;
}

function isFamilyRole(role: DemosSocialRoleId): boolean {
  return role === DemosSocialRoleId.PARENT || role === DemosSocialRoleId.CHILD || role === DemosSocialRoleId.PARTNER;
}

function familyStatusLabel(snapshot: AlifeNpcSnapshot, links: readonly DemosSocialLinkView[]): string {
  const partner = links.find(link => link.role === DemosSocialRoleId.PARTNER);
  if (partner) return `семейное: вместе с alife:${partner.targetAlifeId}`;
  const parent = links.find(link => link.role === DemosSocialRoleId.PARENT);
  if (snapshot.occupation === Occupation.CHILD && parent) return `семейное: ребёнок, родитель alife:${parent.targetAlifeId}`;
  if (links.some(link => link.role === DemosSocialRoleId.CHILD)) return 'семейное: есть дети';
  return 'семейное: один по журналу';
}

function pushUnique(out: string[], value: string, cap: number): void {
  if (out.length < cap && value && !out.includes(value)) out.push(value);
}

function packageForSnapshot(snapshot: AlifeNpcSnapshot): { packageId: string; pack: NpcPackageDef } | undefined {
  const packageId = packageIdFromReservedIdentityId(snapshot.reservedIdentityId);
  const pack = packageId ? getNpcPackage(packageId) : undefined;
  return packageId && pack ? { packageId, pack } : undefined;
}

function cleanPackageLine(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const out = value.replace(/\s+/g, ' ').trim().slice(0, cap);
  return out.length > 0 ? out : undefined;
}

function packageFlavorTags(pack: NpcPackageDef | undefined): readonly string[] {
  const out: string[] = [];
  for (const perk of pack?.rpg?.perks ?? []) {
    pushUnique(out, `perk:${perk.id}`, 8);
    for (const tag of perk.tags ?? []) pushUnique(out, tag, 8);
  }
  for (const tag of pack?.tags ?? []) pushUnique(out, tag, 8);
  for (const tag of pack?.bio?.markovTags ?? []) pushUnique(out, tag, 8);
  return out;
}

function capitalLabel(snapshot: AlifeNpcSnapshot, pack: NpcPackageDef | undefined): { rubles: number; label: string } {
  const cash = Math.max(0, Math.floor(snapshot.money));
  const account = Math.max(0, Math.floor(snapshot.accountRubles));
  const total = cash + account;
  const debt = typeof pack?.wealth?.debtRubles === 'number' && Number.isFinite(pack.wealth.debtRubles)
    ? Math.max(0, Math.floor(pack.wealth.debtRubles))
    : 0;
  const assets = (pack?.wealth?.assetTags ?? []).slice(0, 2).join(', ');
  const parts = [`${total}₽`];
  if (debt > 0) parts.push(`долг ${debt}₽`);
  if (assets) parts.push(assets);
  return { rubles: total, label: parts.join(' / ') };
}

function buildInterests(snapshot: AlifeNpcSnapshot, traits: readonly DemosTraitView[]): readonly string[] {
  const out: string[] = [];
  for (const item of occupationProfile(snapshot.occupation)?.interests ?? []) pushUnique(out, item, 5);
  for (const item of FACTION_INTERESTS[snapshot.faction] ?? []) pushUnique(out, item, 5);
  for (const trait of traits) {
    if (trait.kind === 'taste' || trait.kind === 'fear') {
      pushUnique(out, TRAIT_INTEREST_LABELS[trait.id] ?? trait.label, 5);
    }
  }
  return out;
}

function readRecentEvents(state: GameState, limit: number): WorldEvent[] {
  const buffer: WorldEventBuffer | undefined = state.worldEvents?.recentEvents;
  if (!buffer || buffer.capacity <= 0 || buffer.count <= 0) return [];
  const out: WorldEvent[] = [];
  const total = Math.min(buffer.count, Math.max(0, Math.floor(limit)));
  for (let i = 0; i < total; i++) {
    const idx = (buffer.start + buffer.count - 1 - i + buffer.capacity) % buffer.capacity;
    const event = buffer.items[idx];
    if (event) out.push(event);
  }
  return out;
}

function eventDataAlifeIds(event: WorldEvent): number[] {
  const data = event.data;
  if (!data) return [];
  const out: number[] = [];
  for (const key of ['authorAlifeId', 'actorAlifeId', 'targetAlifeId', 'victimAlifeId', 'reactorAlifeId', 'alifeId']) {
    const raw = data[key];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) out.push(raw);
  }
  const rawIds = data.alifeIds;
  if (Array.isArray(rawIds)) {
    for (const raw of rawIds.slice(0, 8)) {
      if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) out.push(raw);
    }
  }
  return out;
}

function eventMentionsAlifeId(event: WorldEvent, alifeId: number): boolean {
  return eventDataAlifeIds(event).includes(alifeId);
}

function eventLabel(event: WorldEvent): string {
  if (event.type.includes('samosbor')) return 'самосбор';
  if (event.type.includes('quest') || event.type.includes('contract')) return 'заявка';
  if (event.type.includes('kill') || event.type === 'death_seen') return 'смерть';
  if (event.type.includes('migration') || event.type === 'floor_transition') return 'маршрут';
  if (event.type.includes('faction')) return 'фракция';
  if (event.type.includes('stolen') || event.type.includes('looted')) return 'пропажа';
  return 'запись';
}

function eventSummary(event: WorldEvent): string {
  const parts = [event.actorName, event.targetName, event.itemName].filter((part): part is string => !!part);
  const place = event.roomId !== undefined ? `комната ${Math.floor(event.roomId)}`
    : event.zoneId !== undefined ? `зона ${Math.floor(event.zoneId)}`
      : `этаж ${event.floor}`;
  return parts.length > 0 ? `${parts.join(' -> ')}; ${place}` : `${event.type}; ${place}`;
}

export function buildDemosProfileFeedView(
  state: GameState,
  alifeId: number,
  limit = 6,
): readonly DemosProfileFeedEntry[] {
  if (!Number.isInteger(alifeId) || alifeId <= 0 || limit <= 0) return [];
  const out: DemosProfileFeedEntry[] = [];
  for (const event of readRecentEvents(state, DEMOS_PROFILE_RECENT_LIMIT)) {
    if (out.length >= limit) break;
    if (!eventMentionsAlifeId(event, alifeId)) continue;
    out.push({
      postId: event.id,
      eventId: event.id,
      eventType: event.type,
      createdAt: event.time,
      label: eventLabel(event),
      summary: eventSummary(event),
      tags: event.tags.slice(0, 5),
    });
  }
  return out;
}

function recentMentionCount(state: GameState, alifeId: number): number {
  let count = 0;
  for (const event of readRecentEvents(state, DEMOS_PROFILE_RECENT_LIMIT)) {
    if (eventMentionsAlifeId(event, alifeId)) count++;
  }
  return count;
}

export function getDemosProfileDetails(state: GameState, alifeId: number): DemosProfileDetails | undefined {
  const snapshot = getAlifeNpcRecordSnapshot(state, alifeId);
  if (!snapshot) return undefined;
  const traits = getDemosTraitViews(state, alifeId);
  const links = buildDemosSocialLinksView(state, alifeId, DEMOS_SOCIAL_PUBLIC_SLOTS);
  const feed = buildDemosProfileFeedView(state, alifeId, 1);
  const relationScore = Math.round(snapshot.playerRelation ?? 0);
  const relation = demosRelationBand(relationScore);
  const fear = traits.find(trait => trait.kind === 'fear');
  const accountRubles = Math.max(0, Math.floor(snapshot.accountRubles));
  const packageView = packageForSnapshot(snapshot);
  const pack = packageView?.pack;
  const capital = capitalLabel(snapshot, pack);
  return {
    alifeId,
    packageId: packageView?.packageId,
    packageDisplayName: pack ? npcPackageDisplayName(pack) : undefined,
    packagePublicLine: cleanPackageLine(pack?.bio?.publicLine, 120),
    packageBioLine: cleanPackageLine(pack?.bio?.short, 160),
    packageOriginLabel: cleanPackageLine(pack?.bio?.origin, 96),
    packageWorkLabel: cleanPackageLine(pack?.bio?.work, 96),
    packagePortraitHint: cleanPackageLine(pack?.visual?.portraitHint, 64),
    age: snapshot.age,
    ageBandLabel: characterAgeBandLabelRu(snapshot.age),
    sexLabel: characterSexLabelRu(snapshot.sex),
    accountRubles,
    accountLabel: `${accountRubles}₽`,
    capitalRubles: capital.rubles,
    capitalLabel: capital.label,
    familyStatusLabel: familyStatusLabel(snapshot, links),
    relationToPlayerLabel: `${relationScore} / ${relation.label}`,
    friendsCount: links.filter(link => link.relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD || link.role === DemosSocialRoleId.FRIEND).length,
    enemiesCount: links.filter(link => link.relation <= DEMOS_RELATION_HOSTILE_THRESHOLD || link.role === DemosSocialRoleId.ENEMY).length,
    familyCount: links.filter(link => isFamilyRole(link.role)).length,
    traits,
    packageFlavorTags: packageFlavorTags(pack),
    interests: buildInterests(snapshot, traits),
    favoriteWorkLabel: occupationProfile(snapshot.occupation)?.workLabel,
    fearLabel: fear?.label,
    lastPostId: feed[0]?.postId,
    mentionsRecent: recentMentionCount(state, alifeId),
    dead: snapshot.dead,
  };
}

function alifeIdFromNpcEntity(npc: Entity): number | undefined {
  if (npc.alifeId !== undefined && Number.isInteger(npc.alifeId) && npc.alifeId > 0) return npc.alifeId;
  const id = npc.persistentNpcId;
  if (!id?.startsWith('alife:')) return undefined;
  const parsed = Number(id.slice('alife:'.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function canOpenDemosProfileForNpc(npc: Entity): boolean {
  return npc.type === EntityType.NPC && alifeIdFromNpcEntity(npc) !== undefined;
}

export function demosCursorForNpcProfile(state: GameState, npc: Entity): number | undefined {
  const alifeId = alifeIdFromNpcEntity(npc);
  if (alifeId === undefined) return undefined;
  const total = alifeNpcRecordCount(state);
  if (alifeId <= 0 || alifeId > total) return undefined;
  return getAlifeNpcRecordSnapshot(state, alifeId) ? alifeId - 1 : undefined;
}

export function getDemosProfileForNpcEntity(state: GameState, npc: Entity): DemosProfileDetails | undefined {
  const alifeId = alifeIdFromNpcEntity(npc);
  return alifeId === undefined ? undefined : getDemosProfileDetails(state, alifeId);
}

export function demosTraitContextTags(state: GameState, alifeId: number): readonly string[] {
  const out: string[] = [];
  const snapshot = getAlifeNpcRecordSnapshot(state, alifeId);
  if (snapshot) {
    for (const tag of characterAgeSexTags(snapshot.age, snapshot.sex)) {
      if (!out.includes(tag)) out.push(tag);
    }
  }
  for (const trait of getDemosTraitViews(state, alifeId)) {
    for (const tag of trait.tags) {
      if (out.length >= 12) return out;
      if (!out.includes(tag)) out.push(tag);
    }
  }
  return out;
}
