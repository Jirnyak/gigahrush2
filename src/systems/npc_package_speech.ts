/* -- NPC package speech context bridge -------------------------- */

import type { Entity } from '../core/types';
import { hashSeed } from '../core/rand';
import { PLOT_CHAIN } from '../data/plot';
import { allNpcPackages, getNpcPackage, type NpcPackageDef } from '../data/npc_packages';
import type { AlifeNpcSnapshot } from './alife';
import { finalizeMarkovContext, type MarkovTextContext } from './markov_context';
import type { MarkovIntent, MarkovSource } from './speech_router';

export type NpcPackageSpeechSurface = 'dialogue' | 'bark' | 'log_speech' | 'demos_post' | 'demos_reaction';

export interface NpcSpeechTagRef {
  id: string;
  tags?: readonly string[];
}

export interface NpcPackageBioSpeechView {
  publicLine?: string;
  short?: string;
  origin?: string;
  work?: string;
  wants?: readonly string[];
  fears?: readonly string[];
  habits?: readonly string[];
  secrets?: readonly string[];
  markovTags?: readonly string[];
  revealedSecretTags?: readonly string[];
}

export interface NpcPackageSpeechView {
  talkLines?: readonly string[];
  talkLinesPost?: readonly string[];
  talkQuestResponse?: string | readonly string[];
  voiceTags?: readonly string[];
  ambientCorpus?: readonly string[];
  barkCorpus?: readonly string[];
  demosPostHints?: readonly string[];
}

export interface NpcSpeechPackageView {
  id: string;
  tags?: readonly string[];
  bio?: NpcPackageBioSpeechView;
  speech?: NpcPackageSpeechView;
  rpg?: {
    perks?: readonly NpcSpeechTagRef[];
  };
  social?: {
    traits?: readonly (string | NpcSpeechTagRef)[];
  };
  content?: {
    plotNpcId?: string;
  };
}

export interface NpcLockedTalkLine {
  text: string;
  source: Extract<MarkovSource, 'locked_author_text'>;
  phase: 'talk_pre' | 'talk_post' | 'talk_quest_response';
}

type QuestProgressView = readonly { plotStepIndex?: number; done?: boolean }[];
type NpcSpeechSubject = Entity | AlifeNpcSnapshot | Record<string, unknown>;
type NpcPostTalkCursor = Entity & { _plotPostTalkIdx?: number };

const registry = new Map<string, NpcSpeechPackageView>();
const registryByPlotId = new Map<string, string>();

const INTERNAL_TEXT_BLACKLIST = [
  '1024x1024',
  'persistentnpcid',
  'alife:',
  'debug',
  'todo',
] as const;

export function registerNpcSpeechPackage(pack: NpcSpeechPackageView): void {
  const id = cleanId(pack.id);
  if (!id) return;
  registry.set(id, { ...pack, id });
  const plotNpcId = cleanId(pack.content?.plotNpcId);
  if (plotNpcId) registryByPlotId.set(plotNpcId, id);
}

export function registerNpcSpeechPackages(packs: readonly NpcSpeechPackageView[]): void {
  for (const pack of packs) registerNpcSpeechPackage(pack);
}

export function clearNpcSpeechPackages(): void {
  registry.clear();
  registryByPlotId.clear();
}

export function resolveNpcPackageForEntity(entity: Entity): NpcSpeechPackageView | undefined {
  const entityRecord = entity as unknown as Record<string, unknown>;
  const direct = packageIdFromUnknown(entityRecord.npcPackageId)
    ?? packageIdFromUnknown(entityRecord.packageId)
    ?? packageIdFromReservedUnknown(entity.persistentNpcId);
  if (direct) {
    const pack = speechPackageById(direct);
    if (pack) return pack;
  }

  if (entity.plotNpcId) return resolvePackageForPlotNpcId(entity.plotNpcId);
  if (entity.persistentNpcId) {
    const pack = speechPackageById(cleanId(entity.persistentNpcId) ?? '');
    if (pack) return pack;
  }
  if (entity.alifeId !== undefined) return registry.get(`alife:${entity.alifeId}`);
  return undefined;
}

export function resolveNpcPackageForAlifeSnapshot(snapshot: AlifeNpcSnapshot): NpcSpeechPackageView | undefined {
  if (snapshot.reservedIdentityId) {
    const reservedId = packageIdFromReservedUnknown(snapshot.reservedIdentityId) ?? cleanId(snapshot.reservedIdentityId);
    if (reservedId) {
      const pack = speechPackageById(reservedId);
      if (pack) return pack;
    }
  }
  if (snapshot.plotNpcId) return resolvePackageForPlotNpcId(snapshot.plotNpcId);
  return registry.get(`alife:${snapshot.id}`);
}

export function lowerNpcPackageSpeechContext(
  pack: NpcSpeechPackageView,
  snapshotOrEntity: NpcSpeechSubject,
  surface: NpcPackageSpeechSurface,
): MarkovTextContext {
  const entity = isEntity(snapshotOrEntity) ? snapshotOrEntity : undefined;
  const snapshot = isAlifeSnapshot(snapshotOrEntity) ? snapshotOrEntity : undefined;
  return finalizeMarkovContext({
    actorId: entity?.id,
    actorAlifeId: entity?.alifeId ?? snapshot?.id,
    floorKey: snapshot?.floorKey,
    floor: snapshot?.floor,
    faction: entity?.faction ?? snapshot?.faction,
    occupation: entity?.occupation ?? snapshot?.occupation,
    wealthBand: undefined,
    tags: npcPackageSpeechContextTags(pack, snapshotOrEntity, surface),
  });
}

export function npcPackageSpeechContextTags(
  pack: NpcSpeechPackageView,
  _snapshotOrEntity: NpcSpeechSubject,
  surface: NpcPackageSpeechSurface,
): readonly string[] {
  const tags = new TagSet();
  tags.add('npc.package');
  tags.addId('npc.package', pack.id);
  tags.addId('speech.surface', surface);
  for (const tag of pack.tags ?? []) tags.addId('npc.tag', tag);

  const bio = pack.bio;
  if (bio?.publicLine) tags.add('bio.public');
  for (const tag of bio?.markovTags ?? []) tags.addId('bio', tag);
  for (const tag of bio?.revealedSecretTags ?? []) tags.addId('bio.secret_revealed', tag);

  const speech = pack.speech;
  for (const tag of speech?.voiceTags ?? []) tags.addId('voice', tag);
  if (surface === 'demos_post' || surface === 'demos_reaction') {
    for (const tag of speech?.demosPostHints ?? []) tags.addId('demos_hint', tag);
  }

  for (const perk of pack.rpg?.perks ?? []) {
    tags.addId('perk', perk.id);
    for (const tag of perk.tags ?? []) tags.addId('perk_tag', tag);
  }
  for (const trait of pack.social?.traits ?? []) {
    if (typeof trait === 'string') {
      tags.addId('trait', trait);
    } else {
      tags.addId('trait', trait.id);
      for (const tag of trait.tags ?? []) tags.addId('trait_tag', tag);
    }
  }

  return tags.values();
}

export function selectNpcLockedTalkLine(
  pack: NpcSpeechPackageView,
  entity: Entity,
  quests: QuestProgressView | undefined,
  time: number,
): NpcLockedTalkLine | undefined {
  const speech = pack.speech;
  if (!speech) return undefined;
  const postUnlocked = isPostTalkUnlocked(pack, entity, quests);
  const postLines = cleanLinePool(speech.talkLinesPost, pack);

  if (postUnlocked && postLines.length > 0) {
    const runtime = entity as NpcPostTalkCursor;
    const idx = (runtime._plotPostTalkIdx ?? 0) % postLines.length;
    runtime._plotPostTalkIdx = idx + 1;
    return lockedLine(postLines[idx], 'talk_post');
  }

  const preLines = cleanLinePool(speech.talkLines, pack);
  if (!postUnlocked && preLines.length > 0) {
    const idx = (entity._plotTalkIdx ?? 0) % preLines.length;
    entity._plotTalkIdx = idx + 1;
    return lockedLine(preLines[idx], 'talk_pre');
  }

  if (postLines.length > 0 && chanceForLine(pack, entity, time, 'post_fallback', 0.75)) {
    return lockedLine(pickLine(postLines, pack, entity, time, 'post_fallback'), 'talk_post');
  }
  return undefined;
}

export function selectNpcLockedQuestResponse(
  pack: NpcSpeechPackageView,
  seed: number | string = pack.id,
): NpcLockedTalkLine | undefined {
  const response = pack.speech?.talkQuestResponse;
  if (typeof response === 'string') {
    const text = cleanSpeechLine(response, pack);
    return text ? lockedLine(text, 'talk_quest_response') : undefined;
  }
  const pool = cleanLinePool(response, pack);
  if (pool.length === 0) return undefined;
  return lockedLine(pool[hashSeed(`${pack.id}:quest:${seed}`) % pool.length], 'talk_quest_response');
}

export function selectNpcCuratedFallback(
  pack: NpcSpeechPackageView,
  intent: MarkovIntent,
  seed: number | string = pack.id,
): string | undefined {
  const speech = pack.speech;
  if (!speech) return undefined;
  const pool = intent === 'bark_ambient'
    ? cleanLinePool(speech.barkCorpus, pack)
    : cleanLinePool(speech.ambientCorpus, pack);
  if (pool.length === 0) return undefined;
  return pool[hashSeed(`${pack.id}:${intent}:${seed}`) % pool.length];
}

function resolvePackageForPlotNpcId(plotNpcId: string): NpcSpeechPackageView | undefined {
  const cleanPlotId = cleanId(plotNpcId);
  if (!cleanPlotId) return undefined;
  const registeredId = registryByPlotId.get(cleanPlotId);
  if (registeredId) {
    const pack = speechPackageById(registeredId);
    if (pack) return pack;
  }
  const canonical = canonicalPackageForPlotNpcId(cleanPlotId);
  if (canonical) return canonical;
  for (const id of [`plot:${cleanPlotId}`, cleanPlotId]) {
    const pack = speechPackageById(id);
    if (pack) return pack;
  }
  return undefined;
}

function speechPackageById(id: string): NpcSpeechPackageView | undefined {
  return registry.get(id) ?? canonicalSpeechPackage(id);
}

function canonicalSpeechPackage(id: string): NpcSpeechPackageView | undefined {
  const pack = getNpcPackage(id);
  return pack ? packageFromNpcPackageDef(pack) : undefined;
}

function canonicalPackageForPlotNpcId(plotNpcId: string): NpcSpeechPackageView | undefined {
  const direct = getNpcPackage(plotNpcId);
  if (direct && (!direct.content?.plotNpcId || direct.content.plotNpcId === plotNpcId)) {
    return packageFromNpcPackageDef(direct);
  }
  for (const pack of allNpcPackages()) {
    if (pack.content?.plotNpcId === plotNpcId) return packageFromNpcPackageDef(pack);
  }
  return undefined;
}

function packageFromNpcPackageDef(pack: NpcPackageDef): NpcSpeechPackageView {
  return {
    id: pack.id,
    tags: pack.tags,
    bio: {
      publicLine: pack.bio.publicLine,
      short: pack.bio.short,
      origin: pack.bio.origin,
      work: pack.bio.work,
      wants: pack.bio.wants,
      fears: pack.bio.fears,
      habits: pack.bio.habits,
      secrets: pack.bio.secrets,
      markovTags: pack.bio.markovTags,
    },
    speech: {
      talkLines: pack.speech.talkLines,
      talkLinesPost: pack.speech.talkLinesPost,
      talkQuestResponse: pack.speech.talkQuestResponse,
      voiceTags: pack.speech.voiceTags,
      ambientCorpus: pack.speech.ambientCorpus,
      barkCorpus: pack.speech.barkCorpus,
      demosPostHints: pack.speech.demosPostHints,
    },
    rpg: {
      perks: pack.rpg.perks,
    },
    content: {
      plotNpcId: pack.content?.plotNpcId,
    },
  };
}

function isPostTalkUnlocked(
  pack: NpcSpeechPackageView,
  entity: Entity,
  quests: QuestProgressView | undefined,
): boolean {
  if (entity.plotDone) return true;
  const plotNpcId = entity.plotNpcId ?? pack.content?.plotNpcId;
  if (!plotNpcId || !quests) return false;
  let hasStep = false;
  for (let i = 0; i < PLOT_CHAIN.length; i++) {
    if (PLOT_CHAIN[i].giverNpcId !== plotNpcId) continue;
    hasStep = true;
    if (!quests.some(q => q.plotStepIndex === i && q.done)) return false;
  }
  return hasStep;
}

function lockedLine(text: string, phase: NpcLockedTalkLine['phase']): NpcLockedTalkLine {
  return { text, source: 'locked_author_text', phase };
}

function chanceForLine(
  pack: NpcSpeechPackageView,
  entity: Entity,
  time: number,
  salt: string,
  chance: number,
): boolean {
  const tick = Number.isFinite(time) ? Math.floor(time * 1000) : 0;
  return (hashSeed(`${pack.id}:${entity.id}:${entity._plotTalkIdx ?? 0}:${tick}:${salt}`) % 10_000) < Math.floor(chance * 10_000);
}

function pickLine(
  lines: readonly string[],
  pack: NpcSpeechPackageView,
  entity: Entity,
  time: number,
  salt: string,
): string {
  const tick = Number.isFinite(time) ? Math.floor(time * 1000) : 0;
  return lines[hashSeed(`${pack.id}:${entity.id}:${tick}:${salt}`) % lines.length];
}

function cleanLinePool(lines: readonly string[] | undefined, pack: NpcSpeechPackageView): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    const clean = cleanSpeechLine(line, pack);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function cleanSpeechLine(line: string | undefined, pack: NpcSpeechPackageView): string | undefined {
  if (typeof line !== 'string') return undefined;
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const lower = clean.toLocaleLowerCase('ru-RU');
  if (INTERNAL_TEXT_BLACKLIST.some(word => lower.includes(word))) return undefined;
  for (const secret of pack.bio?.secrets ?? []) {
    const hidden = secret.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    if (hidden && lower.includes(hidden)) return undefined;
  }
  return clean.slice(0, 4096);
}

function packageIdFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' ? cleanId(value) : undefined;
}

function packageIdFromReservedUnknown(value: unknown): string | undefined {
  const id = packageIdFromUnknown(value);
  if (!id?.startsWith('npc:')) return undefined;
  return cleanId(id.slice(4));
}

function cleanId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().toLowerCase();
  if (!clean) return undefined;
  return clean.slice(0, 96);
}

function cleanTagText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function isEntity(value: NpcSpeechSubject): value is Entity {
  return typeof (value as Entity).type === 'number' && typeof (value as Entity).alive === 'boolean';
}

function isAlifeSnapshot(value: NpcSpeechSubject): value is AlifeNpcSnapshot {
  return typeof (value as AlifeNpcSnapshot).floorKey === 'string' && typeof (value as AlifeNpcSnapshot).dead === 'boolean';
}

class TagSet {
  private readonly tags: string[] = [];

  add(raw: string | undefined): this {
    if (!raw) return this;
    const tag = cleanTagText(raw);
    if (tag && !this.tags.includes(tag)) this.tags.push(tag);
    return this;
  }

  addId(prefix: string, id: string | undefined): this {
    if (!id) return this;
    const tag = cleanTagText(id);
    if (tag) this.add(`${prefix}.${tag}`);
    return this;
  }

  values(): readonly string[] {
    return [...this.tags].sort();
  }
}
