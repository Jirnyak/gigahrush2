import type {
  CharacterSex,
  Entity,
  GameState,
  Item,
  Needs,
  PlayerStatus,
  Quest,
  RPGStats,
  WorldContainer,
} from '../core/types';
import {
  normalizeProductionStateList,
  PRODUCTION_SAVE_STATE_CAP,
  type ProductionState,
} from './production';
import { MAX_INVENTORY_SLOTS, MAX_ITEM_STACK } from '../data/inventory_limits';
import { ITEMS, getStack } from '../data/items';
import { clampCharacterAge, DEFAULT_PLAYER_AGE, DEFAULT_PLAYER_SEX, sanitizeCharacterSex } from '../data/demographics';

export const SAVE_PLAYER_INVENTORY_CAP = MAX_INVENTORY_SLOTS;
export const SAVE_CONTAINER_CAP = 128;
export const SAVE_CONTAINER_TAG_CAP = 12;
export const SAVE_CONTAINER_STOLEN_ITEM_CAP = 16;
export const SAVE_QUEST_CAP = 512;
export const SAVE_STATUS_CAP = 12;
export const PORTAL_COMPACT_QUEST_CAP = 64;
export const PORTAL_COMPACT_CONTAINER_CAP = 16;
export const PORTAL_COMPACT_ALIFE_DEAD_ID_CAP = 1024;
export const PORTAL_COMPACT_ALIFE_PLOT_DEATH_CAP = 128;
export const PORTAL_COMPACT_ALIFE_OVERRIDE_CAP = 64;
export const PORTAL_COMPACT_PRODUCTION_CAP = 16;

const SAVE_DATA_DEPTH_CAP = 2;
const SAVE_DATA_ARRAY_CAP = 16;
const SAVE_DATA_KEY_CAP = 16;
const SAVE_DATA_STRING_CAP = 512;
const SAVE_DATA_KEY_LEN_CAP = 48;

export interface SavePayloadSections {
  floorRun: unknown;
  floorInstances: unknown;
  voidReturnPortal?: unknown;
  voidEntryFromFloor?: unknown;
  liftArachna: unknown;
  pseudolift: unknown;
  floorMemory: unknown;
  alife: unknown;
  alifeMobility: unknown;
  computers?: unknown;
  netHack?: unknown;
  netTerminalGen: unknown;
  mapEditorPatches: unknown;
  worldEvents: unknown;
  crafting: unknown;
  demosSocial?: unknown;
  economy: unknown;
  banking: unknown;
  stockMarket: unknown;
  production: unknown;
}

export interface SavePayloadBuildInput {
  player: Entity;
  state: GameState;
  containers: readonly WorldContainer[];
  sections: SavePayloadSections;
}

export interface SavePayload {
  player: {
    x: number;
    y: number;
    angle: number;
    hp?: number;
    maxHp?: number;
    needs?: Needs;
    inventory?: Item[];
    weapon?: string;
    armorDefId?: string;
    tool?: string;
    rpg?: RPGStats;
    statuses?: PlayerStatus[];
    money?: number;
    age?: number;
    sex?: CharacterSex;
    playerRelation?: number;
    karma?: number;
    kills?: number;
    npcKills?: number;
    monsterKills?: number;
  };
  state: {
    time: number;
    tick: number;
    clock: GameState['clock'];
    samosborActive: boolean;
    samosborCount: number;
    samosborTimer: number;
    quests: Quest[];
    nextQuestId: number;
    currentFloor: GameState['currentFloor'];
    tutorialMode?: boolean;
    tutorialStep?: number;
    floorRun: unknown;
    floorInstances: unknown;
    voidReturnPortal?: unknown;
    voidEntryFromFloor?: unknown;
    liftArachna: unknown;
    pseudolift: unknown;
    floorMemory: unknown;
    alife: unknown;
    alifeMobility: unknown;
    computers?: unknown;
    netHack?: unknown;
    netTerminalGen: unknown;
    mapEditorPatches: unknown;
    worldEvents: unknown;
    crafting: unknown;
    demosSocial?: unknown;
    economy: unknown;
    banking: unknown;
    stockMarket: unknown;
    production: ProductionState[];
    containers: WorldContainer[];
  };
}

export interface SavePayloadSummarySection {
  label: string;
  bytes: number;
  count?: number;
  cap?: number;
}

export interface SavePayloadSummary {
  bytes: number;
  sections: SavePayloadSummarySection[];
  serializedEntities: false;
  liveEntityCount?: number;
}

export interface SavePayloadSummaryOptions {
  liveEntityCount?: number;
}

export function compactSaveData(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, SAVE_DATA_STRING_CAP);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= SAVE_DATA_DEPTH_CAP) return undefined;
    const out: unknown[] = [];
    for (const item of value.slice(0, SAVE_DATA_ARRAY_CAP)) {
      const clean = compactSaveData(item, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    if (depth >= SAVE_DATA_DEPTH_CAP) return undefined;
    const out: Record<string, unknown> = {};
    let used = 0;
    for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
      if (used >= SAVE_DATA_KEY_CAP) break;
      const key = rawKey.slice(0, SAVE_DATA_KEY_LEN_CAP);
      const clean = compactSaveData(rawValue, depth + 1);
      if (key && clean !== undefined) {
        out[key] = clean;
        used++;
      }
    }
    return out;
  }
  return undefined;
}

function itemStackForSave(defId: string): number {
  const def = ITEMS[defId];
  return def ? getStack(def) : MAX_ITEM_STACK;
}

function itemForSave(item: Item, count: number): Item | null {
  if (typeof item.defId !== 'string' || item.defId.length === 0) return null;
  const cleanCount = Math.max(1, Math.min(MAX_ITEM_STACK, Math.floor(Number(count) || 1)));
  const data = compactSaveData(item.data);
  return data === undefined
    ? { defId: item.defId.slice(0, 64), count: cleanCount }
    : { defId: item.defId.slice(0, 64), count: cleanCount, data };
}

export function inventoryForSave(input: readonly Item[] | undefined, cap = SAVE_PLAYER_INVENTORY_CAP): Item[] | undefined {
  if (!input || input.length === 0) return input ? [] : undefined;
  const out: Item[] = [];
  for (const item of input) {
    if (out.length >= cap) break;
    if (typeof item.defId !== 'string' || item.defId.length === 0) continue;
    const stackMax = itemStackForSave(item.defId);
    let remaining = Math.max(1, Math.floor(Number(item.count) || 1));
    while (remaining > 0 && out.length < cap) {
      const moved = Math.min(remaining, stackMax);
      const saved = itemForSave(item, moved);
      if (!saved) break;
      out.push(saved);
      remaining -= moved;
    }
  }
  return out;
}

function statusesForSave(input: readonly PlayerStatus[] | undefined): PlayerStatus[] | undefined {
  if (!input || input.length === 0) return input ? [] : undefined;
  return input.slice(-SAVE_STATUS_CAP).map(status => ({
    id: status.id,
    source: status.source,
    startedAt: Number.isFinite(status.startedAt) ? status.startedAt : 0,
    expiresAt: Number.isFinite(status.expiresAt) ? status.expiresAt : 0,
    intensity: status.intensity === undefined ? undefined : Number.isFinite(status.intensity) ? status.intensity : 0,
    badReaction: status.badReaction === true ? true : undefined,
  }));
}

function questsForSave(input: readonly Quest[]): Quest[] {
  return input.slice(-SAVE_QUEST_CAP).map(quest => {
    const eventData = compactSaveData(quest.eventData);
    return {
      ...quest,
      desc: quest.desc.slice(0, 192),
      giverName: quest.giverName.slice(0, 96),
      eventTags: quest.eventTags?.slice(0, 8).map(tag => tag.slice(0, 48)),
      eventData: eventData && typeof eventData === 'object' && !Array.isArray(eventData)
        ? eventData as Record<string, unknown>
        : undefined,
      extraRewards: quest.extraRewards?.slice(0, 8).map(reward => ({
        defId: reward.defId.slice(0, 64),
        count: Math.max(1, Math.min(999, Math.floor(reward.count))),
      })),
      abandonsSideQuestIds: quest.abandonsSideQuestIds?.slice(0, 12).map(id => id.slice(0, 96)),
    };
  });
}

export function containersForSave(
  containers: readonly WorldContainer[],
  cap = SAVE_CONTAINER_CAP,
): WorldContainer[] {
  const out: WorldContainer[] = [];
  for (const container of containers) {
    if (out.length >= cap) break;
    // Generic feature-loot containers are transient: they regenerate
    // deterministically each session, so they are never persisted and never
    // spend the bounded container budget.
    if (container.tags.includes('feature_loot')) continue;
    out.push({
      ...container,
      x: Math.floor(container.x),
      y: Math.floor(container.y),
      name: container.name.slice(0, 96),
      inventory: inventoryForSave(container.inventory, Math.max(1, Math.min(MAX_INVENTORY_SLOTS, MAX_INVENTORY_SLOTS))) ?? [],
      ownerName: container.ownerName?.slice(0, 64),
      stolenItemIds: container.stolenItemIds?.slice(0, SAVE_CONTAINER_STOLEN_ITEM_CAP).map(id => id.slice(0, 64)),
      tags: container.tags.slice(0, SAVE_CONTAINER_TAG_CAP).map(tag => tag.slice(0, 48)),
    });
  }
  return out;
}

export function buildSavePayload(input: SavePayloadBuildInput): SavePayload {
  const { player, state, sections } = input;
  return {
    player: {
      x: player.x,
      y: player.y,
      angle: player.angle,
      hp: player.hp,
      maxHp: player.maxHp,
      needs: player.needs ? { ...player.needs } : undefined,
      inventory: inventoryForSave(player.inventory),
      weapon: player.weapon,
      armorDefId: player.armorDefId,
      tool: player.tool,
      rpg: player.rpg ? { ...player.rpg } : undefined,
      statuses: statusesForSave(player.statuses),
      money: player.money,
      age: clampCharacterAge(player.age, DEFAULT_PLAYER_AGE),
      sex: sanitizeCharacterSex(player.sex, player.isFemale ? 'female' : DEFAULT_PLAYER_SEX),
      playerRelation: player.playerRelation,
      karma: player.karma,
      kills: player.kills,
      npcKills: player.npcKills,
      monsterKills: player.monsterKills,
    },
    state: {
      time: state.time,
      tick: state.tick,
      clock: { ...state.clock },
      samosborActive: state.samosborActive,
      samosborCount: state.samosborCount,
      samosborTimer: state.samosborTimer,
      quests: questsForSave(state.quests),
      nextQuestId: state.nextQuestId,
      currentFloor: state.currentFloor,
      tutorialMode: state.tutorialMode,
      tutorialStep: state.tutorialStep,
      floorRun: sections.floorRun,
      floorInstances: sections.floorInstances,
      voidReturnPortal: sections.voidReturnPortal,
      voidEntryFromFloor: sections.voidEntryFromFloor,
      liftArachna: sections.liftArachna,
      pseudolift: sections.pseudolift,
      floorMemory: sections.floorMemory,
      alife: sections.alife,
      alifeMobility: sections.alifeMobility,
      computers: sections.computers,
      netHack: sections.netHack,
      netTerminalGen: sections.netTerminalGen,
      mapEditorPatches: sections.mapEditorPatches,
      worldEvents: sections.worldEvents,
      crafting: sections.crafting,
      demosSocial: sections.demosSocial,
      economy: sections.economy,
      banking: sections.banking,
      stockMarket: sections.stockMarket,
      production: normalizeProductionStateList(sections.production, state.currentFloor),
      containers: containersForSave(input.containers),
    },
  };
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function countMapEditorOps(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const patches = (value as { patches?: unknown }).patches;
  if (!patches || typeof patches !== 'object' || Array.isArray(patches)) return undefined;
  let total = 0;
  for (const patch of Object.values(patches)) {
    const ops = (patch as { ops?: unknown } | null)?.ops;
    if (Array.isArray(ops)) total += ops.length;
  }
  return total;
}

function countWorldEvents(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as {
    recentEvents?: { count?: unknown };
    importantEvents?: { count?: unknown };
    facts?: unknown;
  };
  const recent = typeof state.recentEvents?.count === 'number' ? state.recentEvents.count : 0;
  const important = typeof state.importantEvents?.count === 'number' ? state.importantEvents.count : 0;
  const facts = Array.isArray(state.facts) ? state.facts.length : 0;
  return recent + important + facts;
}

export function summarizeSavePayload(
  payload: SavePayload,
  options: SavePayloadSummaryOptions = {},
): SavePayloadSummary {
  const sectionSpecs: Array<{ label: string; value: unknown; count?: number; cap?: number }> = [
    { label: 'player', value: payload.player, count: payload.player.inventory?.length, cap: SAVE_PLAYER_INVENTORY_CAP },
    { label: 'quests', value: payload.state.quests, count: payload.state.quests.length, cap: SAVE_QUEST_CAP },
    { label: 'events', value: payload.state.worldEvents, count: countWorldEvents(payload.state.worldEvents) },
    { label: 'crafting', value: payload.state.crafting },
    { label: 'demosSocial', value: payload.state.demosSocial },
    { label: 'alife', value: payload.state.alife },
    { label: 'alifeMobility', value: payload.state.alifeMobility },
    { label: 'computers', value: payload.state.computers },
    { label: 'netHack', value: payload.state.netHack },
    { label: 'mapEditor', value: payload.state.mapEditorPatches, count: countMapEditorOps(payload.state.mapEditorPatches) },
    { label: 'economy', value: payload.state.economy },
    { label: 'banking', value: payload.state.banking },
    { label: 'stockMarket', value: payload.state.stockMarket },
    { label: 'production', value: payload.state.production, count: payload.state.production.length, cap: PRODUCTION_SAVE_STATE_CAP },
    { label: 'containers', value: payload.state.containers, count: payload.state.containers.length, cap: SAVE_CONTAINER_CAP },
    { label: 'netTerminalGen', value: payload.state.netTerminalGen },
    { label: 'floorRun', value: payload.state.floorRun },
    { label: 'floorInstances', value: payload.state.floorInstances },
    { label: 'liftArachna', value: payload.state.liftArachna },
    { label: 'pseudolift', value: payload.state.pseudolift },
    { label: 'floorMemory', value: payload.state.floorMemory },
    { label: 'voidReturnPortal', value: payload.state.voidReturnPortal },
    { label: 'voidEntryFromFloor', value: payload.state.voidEntryFromFloor },
  ];
  return {
    bytes: encodedBytes(payload),
    sections: sectionSpecs.map(section => ({
      label: section.label,
      bytes: encodedBytes(section.value),
      count: section.count ?? countArray(section.value),
      cap: section.cap,
    })),
    serializedEntities: false,
    liveEntityCount: options.liveEntityCount,
  };
}

type VersionedSavePayload = SavePayload & { version?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactBooleanRecord(input: unknown, cap: number, keyCap = 96): Record<string, true> {
  const out: Record<string, true> = {};
  if (!isRecord(input)) return out;
  let used = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (used >= cap) break;
    if (value !== true) continue;
    const key = rawKey.slice(0, keyCap);
    if (!key) continue;
    out[key] = true;
    used++;
  }
  return out;
}

function compactFloorRunForPortal(input: unknown): unknown {
  if (!isRecord(input)) return undefined;
  return {
    runSeed: input.runSeed,
    currentZ: input.currentZ,
    visited: compactBooleanRecord(input.visited, 128),
  };
}

function compactAlifeForPortal(input: unknown): unknown {
  if (!isRecord(input)) return undefined;
  return {
    version: input.version,
    seed: input.seed,
    total: input.total,
    playerRelationTargetFaction: input.playerRelationTargetFaction,
    playerRelationTargetAlifeId: input.playerRelationTargetAlifeId,
    deadIds: Array.isArray(input.deadIds) ? input.deadIds.slice(0, PORTAL_COMPACT_ALIFE_DEAD_ID_CAP) : [],
    deadPlotNpcIds: Array.isArray(input.deadPlotNpcIds)
      ? input.deadPlotNpcIds.slice(0, PORTAL_COMPACT_ALIFE_PLOT_DEATH_CAP)
      : [],
    overrides: Array.isArray(input.overrides) ? input.overrides.slice(0, PORTAL_COMPACT_ALIFE_OVERRIDE_CAP) : [],
  };
}

function compactBankingForPortal(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return {
    ...input,
    recentLedger: Array.isArray(input.recentLedger) ? input.recentLedger.slice(-6) : [],
  };
}

function compactStockMarketForPortal(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return {
    ...input,
    recentTrades: Array.isArray(input.recentTrades) ? input.recentTrades.slice(-6) : [],
  };
}

export function createPortalCompactSavePayload<T extends VersionedSavePayload>(payload: T): T {
  return {
    version: payload.version,
    player: {
      ...payload.player,
      inventory: inventoryForSave(payload.player.inventory),
      statuses: statusesForSave(payload.player.statuses),
    },
    state: {
      ...payload.state,
      samosborActive: false,
      quests: payload.state.quests.slice(-PORTAL_COMPACT_QUEST_CAP),
      floorRun: compactFloorRunForPortal(payload.state.floorRun),
      floorMemory: { version: 1, entries: [] },
      alife: compactAlifeForPortal(payload.state.alife),
      alifeMobility: undefined,
      mapEditorPatches: undefined,
      worldEvents: undefined,
      demosSocial: undefined,
      banking: compactBankingForPortal(payload.state.banking),
      stockMarket: compactStockMarketForPortal(payload.state.stockMarket),
      production: payload.state.production.slice(0, PORTAL_COMPACT_PRODUCTION_CAP),
      containers: containersForSave(payload.state.containers, PORTAL_COMPACT_CONTAINER_CAP),
      voidReturnPortal: undefined,
      voidEntryFromFloor: undefined,
    },
  } as T;
}
