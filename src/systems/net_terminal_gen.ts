/* ── НЕТ-ТЕРМИНАЛ ГЕН: unlock state, flesh target and terminals ─ */

import {
  Cell,
  EntityType,
  Feature,
  FloorLevel,
  W,
  msg,
  type Entity,
  type GameState,
  type Item,
} from '../core/types';
import { World } from '../core/world';
import { hashSeed, seededRandom } from '../core/rand';
import { designFloorAtZ } from '../data/design_floors';
import {
  FLOOR_RUN_MAX_Z,
  FLOOR_RUN_MIN_Z,
  isProceduralFloorZ,
  proceduralFloorKey,
  storyFloorAtZ,
} from '../data/procedural_floors';
import {
  NET_TERMINAL_GEN_DEBUG_MAX_TERMINALS,
  NET_TERMINAL_GEN_DENIED_TEXT,
  NET_TERMINAL_GEN_ITEM_ID,
  NET_TERMINAL_GEN_ITEM_NAME,
  NET_TERMINAL_GEN_FLOOR_PROFILES,
  NET_TERMINAL_GEN_NORMAL_MIN_TERMINALS,
  NET_TERMINAL_GEN_NORMAL_MAX_TERMINALS,
  NET_TERMINAL_GEN_OPEN_TEXT,
  NET_TERMINAL_GEN_PALETTE,
  NET_TERMINAL_GEN_PICKUP_MESSAGE,
  NET_TERMINAL_GEN_TERMINAL_COUNT_WEIGHTS,
  NET_TERMINAL_GEN_TERMINALS,
  type NetTerminalGenTerminalDef,
  type NetTerminalGenFloorProfile,
} from '../data/net_terminal_gen';
import { Spr } from '../render/sprite_index';
import {
  accountToCash,
  cashToAccount,
  ensureBankingState,
} from './banking';
import { publishEvent } from './events';
import {
  currentFloorRunEntry,
  ensureFloorRunState,
  floorRunEntryForDesignFloor,
  floorRunEntryFloorKey,
  type FloorRunEntry,
} from './procedural_floors';
import { floorInstanceLabel, floorInstanceWorldKey, getActiveFloorInstance } from './floor_instances';
import { spawnSafeguardHackBacklash } from './safeguard';
import { canSpawnEntityType } from './entity_limits';
import { floorKeyForDesign, floorKeyForProcedural, floorKeyForStory } from './floor_keys';

export interface NetTerminalGenState {
  runSeed: number;
  targetZ: number;
  targetKey: string;
  rawX: number;
  rawY: number;
  resolvedX?: number;
  resolvedY?: number;
  found: boolean;
  pickupClaimed: boolean;
  firstTerminalDenied: boolean;
  hackCooldowns: Record<string, number>;
}

export interface NetTerminalGenTarget {
  runSeed: number;
  targetZ: number;
  targetKey: string;
  rawX: number;
  rawY: number;
}

export interface NetTerminalGenRouteTarget {
  z: number;
  key: string;
  kind: 'story' | 'design' | 'procedural';
  baseFloor: FloorLevel;
  label: string;
}

export interface NetTerminalGenResolvedTarget {
  targetKey: string;
  z: number;
  x: number;
  y: number;
  idx: number;
  newlyResolved: boolean;
}

export interface NetTerminalGenFleshData {
  netTerminalGen: true;
  targetKey: string;
  runSeed: number;
}

export interface NetTerminalGenTerminal {
  idx: number;
  x: number;
  y: number;
  defId: string;
  label: string;
  feature: Feature.SCREEN | Feature.APPARATUS;
  source: 'generated' | 'debug' | 'manual';
}

export interface NetTerminalGenPlacementOptions {
  max?: number;
  seed?: number;
  debug?: boolean;
  clearExisting?: boolean;
  source?: NetTerminalGenTerminal['source'];
}

export type NetTerminalGenOverlayMode = 'closed' | 'denied' | 'editor' | 'bank';
export type NetTerminalBankAction = 'deposit' | 'withdraw';

export interface NetTerminalGenRuntimeSnapshot {
  mode: NetTerminalGenOverlayMode;
  open: boolean;
  terminalIdx: number;
  terminalLabel: string;
  text: string;
  bankAction: NetTerminalBankAction;
  bankPresetIndex: number;
  bankMessage: string;
}

export interface NetTerminalBankSnapshot {
  terminalIdx: number;
  terminalLabel: string;
  action: NetTerminalBankAction;
  actionLabel: string;
  presetIndex: number;
  presetLabel: string;
  amountRubles: number;
  cashRubles: number;
  accountRubles: number;
  depositRubles: number;
  debtRubles: number;
  canSubmit: boolean;
  message: string;
}

export interface NetTerminalGenUseResult {
  handled: boolean;
  access: boolean;
  mode: NetTerminalGenOverlayMode;
  terminal?: NetTerminalGenTerminal;
  text?: string;
}

export interface NetTerminalGenHackContext {
  entities: Entity[];
  nextId: { v: number };
}

type NetTerminalGenHost = GameState & { netTerminalGen?: Partial<NetTerminalGenState> };

const terminalRegistry = new Map<number, NetTerminalGenTerminal>();
const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const runtime: NetTerminalGenRuntimeSnapshot = {
  mode: 'closed',
  open: false,
  terminalIdx: -1,
  terminalLabel: '',
  text: '',
  bankAction: 'deposit',
  bankPresetIndex: 0,
  bankMessage: '',
};

const BANK_ACTIONS: readonly NetTerminalBankAction[] = ['deposit', 'withdraw'];
const BANK_PRESETS: readonly number[] = [10, 50, 100, -1];

function cleanCoord(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return ((Math.trunc(value) % W) + W) % W;
}

function cleanHackCooldowns(input: unknown, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= now) continue;
    out[key.slice(0, 96)] = value;
  }
  return out;
}

function routeKeyForStory(floor: FloorLevel): string {
  return floorKeyForStory(floor);
}

function routeKeyForEntry(entry: FloorRunEntry): string {
  return floorRunEntryFloorKey(entry);
}

export function currentNetTerminalGenFloorKey(state: GameState): string {
  const active = getActiveFloorInstance(state);
  if (active) return floorInstanceWorldKey(active);
  return routeKeyForEntry(currentFloorRunEntry(state));
}

function buildRouteDeck(state: GameState): NetTerminalGenRouteTarget[] {
  const run = ensureFloorRunState(state);
  const deck: NetTerminalGenRouteTarget[] = [];
  for (let z = FLOOR_RUN_MIN_Z; z <= FLOOR_RUN_MAX_Z; z++) {
    const story = storyFloorAtZ(z);
    if (story !== undefined) {
      deck.push({
        z,
        key: routeKeyForStory(story),
        kind: 'story',
        baseFloor: story,
        label: FloorLevel[story],
      });
      continue;
    }

    const design = designFloorAtZ(z);
    if (design) {
      const entry = floorRunEntryForDesignFloor(state, design.id);
      if (entry?.spec) {
        deck.push({
          z,
          key: routeKeyForEntry(entry),
          kind: 'procedural',
          baseFloor: entry.baseFloor,
          label: entry.spec.title,
        });
        continue;
      }
      deck.push({
        z,
        key: entry ? routeKeyForEntry(entry) : floorKeyForDesign(design.id),
        kind: 'design',
        baseFloor: design.baseFloor,
        label: design.displayName,
      });
      continue;
    }

    if (!isProceduralFloorZ(z)) continue;
    const key = proceduralFloorKey(z);
    const spec = run.specs[key];
    deck.push({
      z,
      key: floorKeyForProcedural(key),
      kind: 'procedural',
      baseFloor: spec?.baseFloor ?? state.currentFloor,
      label: spec?.title ?? key,
    });
  }
  return deck;
}

export function deriveNetTerminalGenTarget(state: GameState): NetTerminalGenTarget {
  const run = ensureFloorRunState(state);
  const deck = buildRouteDeck(state);
  const fallback = deck[0] ?? {
    z: 0,
    key: routeKeyForStory(state.currentFloor),
    kind: 'story' as const,
    baseFloor: state.currentFloor,
    label: FloorLevel[state.currentFloor],
  };
  const deckFingerprint = deck.map(entry => entry.key).join('|');
  const routeSeed = hashSeed(deckFingerprint, run.runSeed);
  const picked = deck[routeSeed % Math.max(1, deck.length)] ?? fallback;
  return {
    runSeed: run.runSeed,
    targetZ: picked.z,
    targetKey: picked.key,
    rawX: hashSeed('net_terminal_gen:raw_x', routeSeed) % W,
    rawY: hashSeed('net_terminal_gen:raw_y', routeSeed) % W,
  };
}

export function normalizeNetTerminalGenState(
  input: Partial<NetTerminalGenState> | null | undefined,
  state: GameState,
): NetTerminalGenState {
  const derived = deriveNetTerminalGenTarget(state);
  const sameRun = input?.runSeed === derived.runSeed;
  const sameTarget = sameRun && input?.targetKey === derived.targetKey && input?.targetZ === derived.targetZ;
  return {
    ...derived,
    resolvedX: sameTarget ? cleanCoord(input?.resolvedX) : undefined,
    resolvedY: sameTarget ? cleanCoord(input?.resolvedY) : undefined,
    found: sameRun ? !!input?.found : false,
    pickupClaimed: sameRun ? !!input?.pickupClaimed : false,
    firstTerminalDenied: sameRun ? !!input?.firstTerminalDenied : false,
    hackCooldowns: sameRun ? cleanHackCooldowns(input?.hackCooldowns, state.time) : {},
  };
}

export function getNetTerminalGenState(state: GameState): NetTerminalGenState | undefined {
  const src = (state as NetTerminalGenHost).netTerminalGen;
  return src ? normalizeNetTerminalGenState(src, state) : undefined;
}

export function ensureNetTerminalGenState(state: GameState): NetTerminalGenState {
  const host = state as NetTerminalGenHost;
  host.netTerminalGen = normalizeNetTerminalGenState(host.netTerminalGen, state);
  return host.netTerminalGen as NetTerminalGenState;
}

export function setNetTerminalGenState(
  state: GameState,
  input: Partial<NetTerminalGenState> | null | undefined,
): NetTerminalGenState {
  const normalized = normalizeNetTerminalGenState(input, state);
  (state as NetTerminalGenHost).netTerminalGen = normalized;
  return normalized;
}

export function netTerminalGenStateForSave(state: GameState): NetTerminalGenState {
  return { ...ensureNetTerminalGenState(state) };
}

export function isCurrentNetTerminalGenTargetFloor(state: GameState): boolean {
  const ntg = ensureNetTerminalGenState(state);
  if (getActiveFloorInstance(state)) return false;
  const entry = currentFloorRunEntry(state);
  return entry.z === ntg.targetZ && routeKeyForEntry(entry) === ntg.targetKey;
}

function isFleshCell(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function resolveNearestFleshCell(world: World, rawX: number, rawY: number): { x: number; y: number; idx: number } | null {
  const x0 = world.wrap(rawX);
  const y0 = world.wrap(rawY);
  const i0 = world.idx(x0, y0);
  if (isFleshCell(world, i0)) return { x: x0, y: y0, idx: i0 };

  const maxRadius = W >> 1;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const topX = world.wrap(x0 + dx);
      const topY = world.wrap(y0 - r);
      const topIdx = world.idx(topX, topY);
      if (isFleshCell(world, topIdx)) return { x: topX, y: topY, idx: topIdx };

      const bottomX = world.wrap(x0 + dx);
      const bottomY = world.wrap(y0 + r);
      const bottomIdx = world.idx(bottomX, bottomY);
      if (isFleshCell(world, bottomIdx)) return { x: bottomX, y: bottomY, idx: bottomIdx };
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const leftX = world.wrap(x0 - r);
      const leftY = world.wrap(y0 + dy);
      const leftIdx = world.idx(leftX, leftY);
      if (isFleshCell(world, leftIdx)) return { x: leftX, y: leftY, idx: leftIdx };

      const rightX = world.wrap(x0 + r);
      const rightY = world.wrap(y0 + dy);
      const rightIdx = world.idx(rightX, rightY);
      if (isFleshCell(world, rightIdx)) return { x: rightX, y: rightY, idx: rightIdx };
    }
  }
  return null;
}

export function resolveNetTerminalGenTargetForCurrentFloor(
  world: World,
  state: GameState,
): NetTerminalGenResolvedTarget | null {
  const ntg = ensureNetTerminalGenState(state);
  if (!isCurrentNetTerminalGenTargetFloor(state)) return null;

  let x = cleanCoord(ntg.resolvedX);
  let y = cleanCoord(ntg.resolvedY);
  let newlyResolved = false;
  if (x === undefined || y === undefined || !isFleshCell(world, world.idx(x, y))) {
    const resolved = resolveNearestFleshCell(world, ntg.rawX, ntg.rawY);
    if (!resolved) return null;
    x = resolved.x;
    y = resolved.y;
    ntg.resolvedX = x;
    ntg.resolvedY = y;
    newlyResolved = true;
  }

  return {
    targetKey: ntg.targetKey,
    z: ntg.targetZ,
    x,
    y,
    idx: world.idx(x, y),
    newlyResolved,
  };
}

function fleshData(state: NetTerminalGenState): NetTerminalGenFleshData {
  return {
    netTerminalGen: true,
    targetKey: state.targetKey,
    runSeed: state.runSeed,
  };
}

export function isNetTerminalGenFleshItem(item: Item | undefined): boolean {
  if (!item || item.defId !== NET_TERMINAL_GEN_ITEM_ID) return false;
  const data = item.data;
  return !!data && typeof data === 'object' && (data as Partial<NetTerminalGenFleshData>).netTerminalGen === true;
}

export function isNetTerminalGenFleshDrop(drop: Entity): boolean {
  return drop.type === EntityType.ITEM_DROP && !!drop.inventory?.some(isNetTerminalGenFleshItem);
}

function existingFleshDrop(entities: readonly Entity[], target: NetTerminalGenResolvedTarget): Entity | null {
  for (const e of entities) {
    if (!e.alive || !isNetTerminalGenFleshDrop(e)) continue;
    if (Math.floor(e.x) === target.x && Math.floor(e.y) === target.y) return e;
  }
  return null;
}

export function ensureNetTerminalGenFleshDrop(
  world: World,
  entities: Entity[],
  nextEntityId: { v: number },
  state: GameState,
): Entity | null {
  const ntg = ensureNetTerminalGenState(state);
  if (ntg.found || ntg.pickupClaimed) return null;
  const target = resolveNetTerminalGenTargetForCurrentFloor(world, state);
  if (!target) return null;

  const existing = existingFleshDrop(entities, target);
  if (existing) return existing;
  if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) return null;

  const drop: Entity = {
    id: nextEntityId.v++,
    type: EntityType.ITEM_DROP,
    x: target.x + 0.5,
    y: target.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId: NET_TERMINAL_GEN_ITEM_ID, count: 1, data: fleshData(ntg) }],
  };
  entities.push(drop);
  return drop;
}

export function claimNetTerminalGenFleshDrop(
  state: GameState,
  drop: Entity,
  player?: Entity,
  world?: World,
): boolean {
  if (!isNetTerminalGenFleshDrop(drop)) return false;
  const ntg = ensureNetTerminalGenState(state);
  const firstClaim = !ntg.found;
  ntg.found = true;
  ntg.pickupClaimed = true;
  drop.alive = false;

  if (firstClaim) {
    state.msgs.push(msg(NET_TERMINAL_GEN_PICKUP_MESSAGE, state.time, NET_TERMINAL_GEN_PALETTE.flesh));
    publishEvent(state, {
      type: 'player_pick_item',
      actorId: player?.id,
      actorName: player?.name,
      itemId: NET_TERMINAL_GEN_ITEM_ID,
      itemName: NET_TERMINAL_GEN_ITEM_NAME,
      itemCount: 1,
      itemValue: 0,
      x: Math.floor(drop.x),
      y: Math.floor(drop.y),
      zoneId: world ? world.zoneMap[world.idx(Math.floor(drop.x), Math.floor(drop.y))] : undefined,
      severity: 4,
      privacy: 'secret',
      tags: ['net_terminal_gen', 'flesh_found'],
      data: { targetKey: ntg.targetKey, targetZ: ntg.targetZ },
    });
  }
  return true;
}

export function grantNetTerminalGenAccess(state: GameState): NetTerminalGenState {
  const ntg = ensureNetTerminalGenState(state);
  ntg.found = true;
  ntg.pickupClaimed = true;
  return ntg;
}

export function hasNetTerminalGen(state: GameState, player?: Entity): boolean {
  const ntg = ensureNetTerminalGenState(state);
  if (ntg.found) return true;
  return !!player?.inventory?.some(slot => slot.defId === NET_TERMINAL_GEN_ITEM_ID);
}

function chooseWeightedCount(rng: () => number): number {
  let total = 0;
  for (const def of NET_TERMINAL_GEN_TERMINAL_COUNT_WEIGHTS) total += Math.max(0, def.weight);
  if (total <= 0) return 0;
  let roll = rng() * total;
  for (const def of NET_TERMINAL_GEN_TERMINAL_COUNT_WEIGHTS) {
    roll -= Math.max(0, def.weight);
    if (roll <= 0) return Math.max(0, Math.floor(def.count));
  }
  return 0;
}

function chooseTerminalDef(rng: () => number): NetTerminalGenTerminalDef {
  let total = 0;
  for (const def of NET_TERMINAL_GEN_TERMINALS) total += Math.max(0, def.weight);
  let roll = rng() * Math.max(1, total);
  for (const def of NET_TERMINAL_GEN_TERMINALS) {
    roll -= Math.max(0, def.weight);
    if (roll <= 0) return def;
  }
  return NET_TERMINAL_GEN_TERMINALS[0];
}

function floorProfileForCurrentFloor(state: GameState): NetTerminalGenFloorProfile | undefined {
  const key = currentNetTerminalGenFloorKey(state);
  return NET_TERMINAL_GEN_FLOOR_PROFILES.find(profile => profile.floorKey === key);
}

function hasAdjacentPassable(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of DIRS) {
    const nx = world.wrap(x + dx);
    const ny = world.wrap(y + dy);
    const ni = world.idx(nx, ny);
    if ((world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.WATER) && !world.solid(nx, ny)) return true;
  }
  return false;
}

function canUseTerminalCell(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  const cell = world.cells[idx];
  if (cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.ABYSS) return false;
  if (world.features[idx] !== Feature.NONE && world.features[idx] !== Feature.SCREEN && world.features[idx] !== Feature.APPARATUS) return false;
  return hasAdjacentPassable(world, idx % W, (idx / W) | 0);
}

export function clearNetTerminalGenTerminals(): void {
  terminalRegistry.clear();
}

export function getNetTerminalGenTerminals(): readonly NetTerminalGenTerminal[] {
  return [...terminalRegistry.values()];
}

export function getNetTerminalGenTerminalAt(world: World, x: number, y: number): NetTerminalGenTerminal | undefined {
  return terminalRegistry.get(world.idx(Math.floor(x), Math.floor(y)));
}

export function isNetTerminalGenTarget(world: World, _state: GameState, x: number, y: number): boolean {
  return !!getNetTerminalGenTerminalAt(world, x, y);
}

export function registerNetTerminalGenTerminal(
  world: World,
  x: number,
  y: number,
  def: NetTerminalGenTerminalDef = NET_TERMINAL_GEN_TERMINALS[0],
  source: NetTerminalGenTerminal['source'] = 'manual',
): NetTerminalGenTerminal | null {
  const idx = world.idx(x, y);
  if (!canUseTerminalCell(world, idx)) return null;
  const terminal: NetTerminalGenTerminal = {
    idx,
    x: idx % W,
    y: (idx / W) | 0,
    defId: def.id,
    label: def.label,
    feature: def.feature,
    source,
  };
  terminalRegistry.set(idx, terminal);
  return terminal;
}

export function placeNetTerminalGenTerminal(
  world: World,
  x: number,
  y: number,
  def: NetTerminalGenTerminalDef = NET_TERMINAL_GEN_TERMINALS[0],
  source: NetTerminalGenTerminal['source'] = 'manual',
): NetTerminalGenTerminal | null {
  const idx = world.idx(x, y);
  if (!canUseTerminalCell(world, idx)) return null;
  const feature = world.cells[idx] === Cell.WALL ? Feature.SCREEN : def.feature === Feature.SCREEN ? Feature.APPARATUS : def.feature;
  world.setFeatureAt(idx, feature);
  if (feature === Feature.SCREEN) {
    world.wallTex[idx] = def.wallTex;
    world.markWallTexDirty();
  }
  return registerNetTerminalGenTerminal(world, x, y, { ...def, feature }, source);
}

function roomEdgeCandidate(world: World, rng: () => number): number {
  if (world.rooms.length === 0) return -1;
  const room = world.rooms[Math.floor(rng() * world.rooms.length)];
  if (!room) return -1;
  const side = Math.floor(rng() * 4);
  if (side === 0) return world.idx(room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2)), room.y - 1);
  if (side === 1) return world.idx(room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2)), room.y + room.h);
  if (side === 2) return world.idx(room.x - 1, room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2)));
  return world.idx(room.x + room.w, room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2)));
}

function findTerminalCandidate(world: World, rng: () => number): number {
  if (world.screenCells.length > 0) {
    const start = Math.floor(rng() * world.screenCells.length);
    const tries = Math.min(world.screenCells.length, 256);
    for (let n = 0; n < tries; n++) {
      const idx = world.screenCells[(start + n) % world.screenCells.length];
      if (idx !== undefined && !terminalRegistry.has(idx) && canUseTerminalCell(world, idx)) return idx;
    }
  }

  for (let attempt = 0; attempt < 720; attempt++) {
    const idx = roomEdgeCandidate(world, rng);
    if (idx >= 0 && !terminalRegistry.has(idx) && canUseTerminalCell(world, idx)) return idx;
  }

  for (let attempt = 0; attempt < 1024; attempt++) {
    const idx = world.idx(Math.floor(rng() * W), Math.floor(rng() * W));
    if (!terminalRegistry.has(idx) && canUseTerminalCell(world, idx)) return idx;
  }
  return -1;
}

export function placeNetTerminalGenTerminalsForCurrentFloor(
  world: World,
  state: GameState,
  options: NetTerminalGenPlacementOptions = {},
): number {
  if (options.clearExisting ?? true) clearNetTerminalGenTerminals();
  const seed = options.seed ?? hashSeed(`net_terminal_gen:terminals:${currentNetTerminalGenFloorKey(state)}`, ensureFloorRunState(state).runSeed);
  const rng = seededRandom(seed);
  const profile = options.debug ? undefined : floorProfileForCurrentFloor(state);
  const maxDefault = profile?.maxTerminals ?? (options.debug ? NET_TERMINAL_GEN_DEBUG_MAX_TERMINALS : NET_TERMINAL_GEN_NORMAL_MAX_TERMINALS);
  const max = Math.max(0, Math.floor(options.max ?? maxDefault));
  const desired = options.debug
    ? Math.max(1, max)
    : profile
      ? Math.max(0, Math.min(max, profile.minTerminals + Math.floor(rng() * Math.max(1, profile.maxTerminals - profile.minTerminals + 1))))
      : Math.max(
        Math.min(max, NET_TERMINAL_GEN_NORMAL_MIN_TERMINALS),
        Math.min(max, chooseWeightedCount(rng)),
      );
  let placed = 0;

  for (let attempt = 0; attempt < desired * 24 && placed < desired; attempt++) {
    const idx = findTerminalCandidate(world, rng);
    if (idx < 0 || terminalRegistry.has(idx)) continue;
    const def = profile?.terminalDef ?? chooseTerminalDef(rng);
    if (placeNetTerminalGenTerminal(world, idx % W, (idx / W) | 0, def, options.source ?? (options.debug ? 'debug' : 'generated'))) placed++;
  }
  return placed;
}

function setRuntime(mode: NetTerminalGenOverlayMode, terminal?: NetTerminalGenTerminal): void {
  runtime.mode = mode;
  runtime.open = mode !== 'closed';
  runtime.terminalIdx = terminal?.idx ?? -1;
  runtime.terminalLabel = terminal?.label ?? '';
  runtime.text = mode === 'denied'
    ? NET_TERMINAL_GEN_DENIED_TEXT
    : mode === 'editor'
      ? NET_TERMINAL_GEN_OPEN_TEXT
      : mode === 'bank'
        ? 'НЕТ-БАНК'
        : '';
  if (mode === 'closed') runtime.bankMessage = '';
}

export function markNetTerminalGenDenied(state: GameState): NetTerminalGenState {
  const ntg = ensureNetTerminalGenState(state);
  ntg.firstTerminalDenied = true;
  return ntg;
}

export function openNetTerminalGenDenied(state: GameState, terminal?: NetTerminalGenTerminal): void {
  markNetTerminalGenDenied(state);
  state.paused = true;
  setRuntime('denied', terminal);
}

export function openNetTerminalGenEditor(state: GameState, terminal?: NetTerminalGenTerminal): void {
  state.paused = true;
  setRuntime('editor', terminal);
}

export function openNetTerminalBank(state: GameState, terminal?: NetTerminalGenTerminal): void {
  ensureBankingState(state);
  state.paused = true;
  runtime.bankAction = 'deposit';
  runtime.bankPresetIndex = 0;
  runtime.bankMessage = '';
  setRuntime('bank', terminal);
}

export function closeNetTerminalGen(): void {
  setRuntime('closed');
}

export function isNetTerminalGenOpen(): boolean {
  return runtime.open;
}

export function isNetTerminalGenDeniedOpen(): boolean {
  return runtime.mode === 'denied';
}

export function isNetTerminalGenEditorOpen(): boolean {
  return runtime.mode === 'editor';
}

export function isNetTerminalBankOpen(): boolean {
  return runtime.mode === 'bank';
}

export function getNetTerminalGenRuntimeSnapshot(): NetTerminalGenRuntimeSnapshot {
  return { ...runtime };
}

function cleanCash(player: Entity): number {
  const cash = player.money ?? 0;
  return Number.isFinite(cash) ? Math.max(0, Math.floor(cash)) : 0;
}

function bankActionLabel(action: NetTerminalBankAction): string {
  return action === 'deposit' ? 'Внести' : 'Снять';
}

function selectedBankLimit(state: GameState, player: Entity): number {
  const banking = ensureBankingState(state);
  return runtime.bankAction === 'deposit' ? cleanCash(player) : banking.accountRubles;
}

function selectedBankAmount(state: GameState, player: Entity): number {
  const preset = BANK_PRESETS[runtime.bankPresetIndex] ?? BANK_PRESETS[0];
  return preset < 0 ? selectedBankLimit(state, player) : preset;
}

function bankPresetLabel(state: GameState, player: Entity): string {
  const preset = BANK_PRESETS[runtime.bankPresetIndex] ?? BANK_PRESETS[0];
  if (preset >= 0) return `${preset} руб.`;
  return runtime.bankAction === 'deposit'
    ? `${selectedBankLimit(state, player)} руб. (все наличные)`
    : `${selectedBankLimit(state, player)} руб. (весь счет)`;
}

function clampBankPreset(): void {
  runtime.bankPresetIndex = ((runtime.bankPresetIndex % BANK_PRESETS.length) + BANK_PRESETS.length) % BANK_PRESETS.length;
}

export function moveNetTerminalBankAction(delta: number): void {
  const current = Math.max(0, BANK_ACTIONS.indexOf(runtime.bankAction));
  const next = (current + delta + BANK_ACTIONS.length) % BANK_ACTIONS.length;
  runtime.bankAction = BANK_ACTIONS[next];
  runtime.bankMessage = '';
}

export function moveNetTerminalBankPreset(delta: number): void {
  runtime.bankPresetIndex += delta;
  clampBankPreset();
  runtime.bankMessage = '';
}

export function activateNetTerminalBank(state: GameState, player: Entity): boolean {
  const moved = selectedBankAmount(state, player);
  const limit = selectedBankLimit(state, player);
  if (moved <= 0 || moved > limit) {
    runtime.bankMessage = runtime.bankAction === 'deposit' ? 'Недостаточно наличных.' : 'Недостаточно на счете.';
    state.msgs.push(msg(runtime.bankMessage, state.time, '#f84'));
    return false;
  }

  const ok = runtime.bankAction === 'deposit'
    ? cashToAccount(state, player, moved, 'net_terminal')
    : accountToCash(state, player, moved, 'net_terminal');
  runtime.bankMessage = ok
    ? runtime.bankAction === 'deposit'
      ? `Внесено ${moved} руб.`
      : `Снято ${moved} руб.`
    : runtime.bankAction === 'deposit'
      ? 'Взнос не прошел.'
      : 'Снятие не прошло.';
  state.msgs.push(msg(runtime.bankMessage, state.time, ok ? '#6cf' : '#f84'));
  return ok;
}

export function getNetTerminalBankSnapshot(state: GameState, player: Entity): NetTerminalBankSnapshot {
  const banking = ensureBankingState(state);
  clampBankPreset();
  const limit = selectedBankLimit(state, player);
  const moved = selectedBankAmount(state, player);
  return {
    terminalIdx: runtime.terminalIdx,
    terminalLabel: runtime.terminalLabel,
    action: runtime.bankAction,
    actionLabel: bankActionLabel(runtime.bankAction),
    presetIndex: runtime.bankPresetIndex,
    presetLabel: bankPresetLabel(state, player),
    amountRubles: moved,
    cashRubles: cleanCash(player),
    accountRubles: banking.accountRubles,
    depositRubles: banking.depositPrincipal,
    debtRubles: banking.loanPrincipal + banking.loanAccrued,
    canSubmit: moved > 0 && moved <= limit,
    message: runtime.bankMessage,
  };
}

function terminalDefById(defId: string): NetTerminalGenTerminalDef | undefined {
  for (const def of NET_TERMINAL_GEN_TERMINALS) if (def.id === defId) return def;
  for (const profile of NET_TERMINAL_GEN_FLOOR_PROFILES) if (profile.terminalDef.id === defId) return profile.terminalDef;
  return undefined;
}

function terminalHackKey(state: GameState, terminal: NetTerminalGenTerminal): string {
  return `${currentNetTerminalGenFloorKey(state)}:${terminal.idx}:${terminal.defId}`;
}

function routeTagFromKey(key: string): string | undefined {
  const prefix = 'design:';
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

function resolveTerminalHack(
  world: World,
  player: Entity,
  state: GameState,
  terminal: NetTerminalGenTerminal,
  entities: Entity[] | undefined,
  nextId: { v: number } | undefined,
): 'none' | 'success' | 'failed' | 'cooldown' {
  const def = terminalDefById(terminal.defId);
  if (!entities || !nextId) return 'none';
  if (!def || def.hackDifficulty === undefined) return 'none';
  const difficulty = def.hackDifficulty;

  const ntg = ensureNetTerminalGenState(state);
  const hackKey = terminalHackKey(state, terminal);
  const cooldownUntil = ntg.hackCooldowns[hackKey] ?? 0;
  if (cooldownUntil > state.time) {
    state.msgs.push(msg(`Терминал в карантине: ${Math.ceil(cooldownUntil - state.time)}с.`, state.time, '#f84'));
    return 'cooldown';
  }

  const floorKey = currentNetTerminalGenFloorKey(state);
  const routeTag = routeTagFromKey(floorKey);
  const successChance = Math.max(0.08, Math.min(0.55, 0.28 + (player.rpg?.int ?? 0) * 0.045 - difficulty * 0.045));
  if (Math.random() < successChance) {
    grantNetTerminalGenAccess(state);
    state.msgs.push(msg('НЕТ-колодец принял обход. Доступ открыт.', state.time, NET_TERMINAL_GEN_PALETTE.open));
    publishEvent(state, {
      type: 'net_terminal_hacked',
      x: terminal.x,
      y: terminal.y,
      zoneId: world.zoneMap[terminal.idx],
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      severity: 4,
      privacy: 'secret',
      tags: ['net', 'terminal', 'hack_success', terminal.defId, ...(routeTag ? [routeTag] : [])],
      data: { terminalIdx: terminal.idx, terminalDef: terminal.defId, floorKey, difficulty, successChance },
    });
    return 'success';
  }

  ntg.hackCooldowns[hackKey] = state.time + (def?.hackCooldownS ?? 90);
  state.msgs.push(msg('НЕТ-колодец отверг взлом. Протокол охраны поднимается рядом.', state.time, '#f84'));
  spawnSafeguardHackBacklash(world, entities, nextId, state, terminal.x + 0.5, terminal.y + 0.5, 'net_terminal_hack_failed', {
    terminalIdx: terminal.idx,
    floorKey,
  });
  return 'failed';
}

export function tryUseNetTerminalGen(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
  entities?: Entity[],
  nextId?: { v: number },
): NetTerminalGenUseResult {
  const terminal = getNetTerminalGenTerminalAt(world, lookX, lookY);
  if (!terminal) return { handled: false, access: false, mode: 'closed' };
  if (hasNetTerminalGen(state, player)) {
    openNetTerminalGenEditor(state, terminal);
    return { handled: true, access: true, mode: 'editor', terminal, text: NET_TERMINAL_GEN_OPEN_TEXT };
  }
  const hackResult = resolveTerminalHack(world, player, state, terminal, entities, nextId);
  if (hackResult === 'success') {
    openNetTerminalGenEditor(state, terminal);
    return { handled: true, access: true, mode: 'editor', terminal, text: NET_TERMINAL_GEN_OPEN_TEXT };
  }
  if (hackResult === 'failed' || hackResult === 'cooldown') {
    if (terminalDefById(terminal.defId)?.hackDifficulty !== undefined) {
      return { handled: true, access: false, mode: 'closed', terminal, text: hackResult };
    }
    openNetTerminalBank(state, terminal);
    return { handled: true, access: false, mode: 'bank', terminal, text: 'НЕТ-БАНК' };
  }
  openNetTerminalBank(state, terminal);
  return { handled: true, access: false, mode: 'bank', terminal, text: 'НЕТ-БАНК' };
}

export function summarizeNetTerminalGen(state: GameState, player?: Entity): string[] {
  const ntg = ensureNetTerminalGenState(state);
  const entry = currentFloorRunEntry(state);
  const active = getActiveFloorInstance(state);
  const currentKey = currentNetTerminalGenFloorKey(state);
  const resolved = ntg.resolvedX !== undefined && ntg.resolvedY !== undefined ? `${ntg.resolvedX},${ntg.resolvedY}` : 'none';
  return [
    `seed=${ntg.runSeed} target=${ntg.targetKey} z=${ntg.targetZ} raw=${ntg.rawX},${ntg.rawY} resolved=${resolved}`,
    `current=${currentKey} z=${active ? 'instance' : entry.z} ${active ? floorInstanceLabel(active) : entry.label} targetFloor=${isCurrentNetTerminalGenTargetFloor(state) ? 'yes' : 'no'}`,
    `found=${ntg.found ? 'yes' : 'no'} claimed=${ntg.pickupClaimed ? 'yes' : 'no'} access=${hasNetTerminalGen(state, player) ? 'yes' : 'no'} denied=${ntg.firstTerminalDenied ? 'yes' : 'no'}`,
    `terminals=${terminalRegistry.size} overlay=${runtime.mode}${runtime.terminalIdx >= 0 ? ` idx=${runtime.terminalIdx}` : ''}`,
  ];
}
