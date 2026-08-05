/* ── НЕТ-ТЕРМИНАЛ ГЕН map editor runtime ─────────────────────── */

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Tex,
  W,
  type Entity,
  type GameState,
  type WorldContainer,
} from '../core/types';
import { type World } from '../core/world';
import { ITEMS, freshNeeds, randomName } from '../data/catalog';
import { CONTAINER_DEFS } from '../data/container_defs';
import { randomOccupation } from '../data/relations';
import { MONSTERS } from '../entities/monster';
import { Spr } from '../render/sprite_index';
import { markEntityIndexDirty } from './entity_index';
import { getMaxHp, randomRPG } from './rpg';
import { currentFloorRunEntry, floorRunEntryFloorKey } from './procedural_floors';
import { activeFloorInstanceWorldKey, floorInstanceLabel, getActiveFloorInstance } from './floor_instances';
import { controlBindingLabel, controlHint, menuCloseHint } from './controls';
import { mapEditorContainerBrushes, mapEditorEntityBrushes } from './map_editor_catalog';
import { canSpawnEntityType } from './entity_limits';
import { isPlayerEntity } from './player_actor';

export type MapEditorToolId = 'cell' | 'door' | 'texture' | 'feature' | 'entity' | 'container' | 'inspect';
export type MapEditorMode = 'map' | 'menu' | 'brush' | 'details' | 'objects';
export type MapEditorAction = 'apply' | 'close';

export interface MapEditorMenuEntry {
  id: string | number;
  label: string;
  color?: string;
  active?: boolean;
}

export interface MapEditorEntityDef {
  kind: 'npc' | 'monster' | 'item';
  monsterKind?: MonsterKind;
  itemId?: string;
  count?: number;
  faction?: Faction;
}

export interface MapEditorContainerDef {
  kind?: ContainerKind;
  itemId?: string;
  count?: number;
  name?: string;
}

export type MapEditorOp =
  | { kind: 'set_cell'; x: number; y: number; cell: Cell }
  | { kind: 'set_wall_tex'; x: number; y: number; tex: Tex }
  | { kind: 'set_floor_tex'; x: number; y: number; tex: Tex }
  | { kind: 'set_feature'; x: number; y: number; feature: Feature }
  | { kind: 'set_door'; x: number; y: number; state: DoorState; keyId: string }
  | { kind: 'delete_door'; x: number; y: number }
  | { kind: 'spawn_entity'; x: number; y: number; entityDef: MapEditorEntityDef }
  | { kind: 'delete_entity'; entityId: number }
  | { kind: 'spawn_container'; x: number; y: number; def: MapEditorContainerDef }
  | { kind: 'delete_container'; containerId: number };

export interface MapEditorPatch {
  floorKey: string;
  baseFloor: FloorLevel;
  z?: number;
  createdAt: number;
  opCount: number;
  ops: MapEditorOp[];
}

export interface MapEditorPatchState {
  patches: Record<string, MapEditorPatch>;
  skipped: string[];
}

export interface MapEditorApplyResult {
  ok: boolean;
  reason: string;
  dirtyCells?: number[];
}

export interface MapEditorTransactionState {
  geometry: boolean;
  doors: boolean;
  wallTextures: boolean;
  floorTextures: boolean;
  surfaces: boolean;
  features: boolean;
  featureLights: boolean;
  entities: boolean;
  containers: boolean;
  territory: boolean;
  roomMap: boolean;
  dirtyCells: number[];
  dirtyOverflow: boolean;
}

export interface MapEditorCommitResult {
  changed: boolean;
  geometry: boolean;
  doors: boolean;
  surfaces: boolean;
  features: boolean;
  entities: boolean;
  containers: boolean;
  territory: boolean;
  roomMap: boolean;
  dirtyCellCount: number;
}

export interface MapEditorSnapshot {
  floorKey: string;
  floorLabel: string;
  z?: number;
  tool: MapEditorToolId;
  brush: string | number;
  brushLabel: string;
  status: string;
  error: string;
  dirtyOps: number;
  patchOps: number;
  maxPatchOps: number;
  cursorX: number;
  cursorY: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  revision: number;
  dirtyCells: readonly number[];
  tools: readonly MapEditorToolId[];
  palette: readonly { id: string | number; label: string; color?: string; active?: boolean }[];
  mode: MapEditorMode;
  menuTitle: string;
  menuIndex: number;
  menuEntries: readonly MapEditorMenuEntry[];
  hints: readonly string[];
  activeTerminalX?: number;
  activeTerminalY?: number;
}

interface MapEditorRuntime {
  open: boolean;
  floorKey: string;
  cursorX: number;
  cursorY: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  mode: MapEditorMode;
  menuIndex: number;
  tool: MapEditorToolId;
  brushIndex: Record<MapEditorToolId, number>;
  status: string;
  error: string;
  revision: number;
  dirtyCells: number[];
  activeTerminalX?: number;
  activeTerminalY?: number;
  world?: World;
  transaction: MapEditorTransactionState;
}

type MapEditorHost = GameState & { mapEditorPatches?: Partial<MapEditorPatchState> };

const PATCH_OP_CAP = 4096;
const PATCH_FLOOR_CAP = 48;
const OP_ITEM_COUNT_CAP = 999;
const OP_KEY_ID_MAX = 96;
const TRANSACTION_DIRTY_CELL_CAP = 512;
const TRANSACTION_DIRTY_RECT_CAP = 32;
const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TOOLS: readonly MapEditorToolId[] = ['cell', 'door', 'texture', 'feature', 'entity', 'container', 'inspect'];
const PAINT_TOOLS: readonly MapEditorToolId[] = ['cell', 'door', 'texture', 'feature'];
const OBJECT_TOOLS: readonly MapEditorToolId[] = ['entity', 'container'];
const MAIN_MENU: readonly MapEditorMenuEntry[] = [
  { id: 'map', label: 'КАРТА', color: '#63f6ff' },
  { id: 'brush', label: 'КИСТЬ', color: '#9fdbc6' },
  { id: 'details', label: 'ДЕТАЛИ КАРТЫ', color: '#9df' },
  { id: 'objects', label: 'ОБЪЕКТЫ', color: '#db6' },
  { id: 'close', label: 'ВЫЙТИ ИЗ ТЕРМИНАЛА', color: '#ff5868' },
];
const CELL_BRUSHES = [Cell.FLOOR, Cell.WALL, Cell.DOOR, Cell.WATER, Cell.LIFT, Cell.ABYSS] as const;
const DOOR_BRUSHES = [DoorState.CLOSED, DoorState.OPEN, DoorState.LOCKED, DoorState.HERMETIC_CLOSED, DoorState.HERMETIC_OPEN] as const;
const FEATURE_BRUSHES = [Feature.NONE, Feature.LAMP, Feature.CANDLE, Feature.TABLE, Feature.CHAIR, Feature.BED, Feature.SHELF, Feature.MACHINE, Feature.APPARATUS, Feature.SCREEN] as const;
const TEXTURE_BRUSHES = [
  { kind: 'wall' as const, tex: Tex.CONCRETE, label: 'W CONCRETE' },
  { kind: 'wall' as const, tex: Tex.BRICK, label: 'W BRICK' },
  { kind: 'wall' as const, tex: Tex.METAL, label: 'W METAL' },
  { kind: 'floor' as const, tex: Tex.F_CONCRETE, label: 'F CONCRETE' },
  { kind: 'floor' as const, tex: Tex.F_LINO, label: 'F LINO' },
  { kind: 'floor' as const, tex: Tex.F_TILE, label: 'F TILE' },
  { kind: 'floor' as const, tex: Tex.F_WOOD, label: 'F WOOD' },
] as const;

function emptyTransaction(): MapEditorTransactionState {
  return {
    geometry: false,
    doors: false,
    wallTextures: false,
    floorTextures: false,
    surfaces: false,
    features: false,
    featureLights: false,
    entities: false,
    containers: false,
    territory: false,
    roomMap: false,
    dirtyCells: [],
    dirtyOverflow: false,
  };
}

const runtime: MapEditorRuntime = {
  open: false,
  floorKey: '',
  cursorX: 0,
  cursorY: 0,
  cameraX: 0,
  cameraY: 0,
  zoom: 8,
  mode: 'map',
  menuIndex: 0,
  tool: 'cell',
  brushIndex: { cell: 0, door: 0, texture: 0, feature: 0, entity: 0, container: 0, inspect: 0 },
  status: '',
  error: '',
  revision: 0,
  dirtyCells: [],
  transaction: emptyTransaction(),
};

function resetTransaction(): void {
  runtime.transaction = emptyTransaction();
}

function enumNumberValues(source: Record<string, string | number>): Set<number> {
  return new Set(Object.values(source).filter((value): value is number => typeof value === 'number'));
}

const VALID_CELLS = new Set<number>(CELL_BRUSHES);
const VALID_DOOR_STATES = enumNumberValues(DoorState);
const VALID_FEATURES = new Set<number>(FEATURE_BRUSHES);
const VALID_FACTIONS = enumNumberValues(Faction);
const VALID_MONSTERS = enumNumberValues(MonsterKind);
const VALID_TEXTURES = new Set<number>(TEXTURE_BRUSHES.map(brush => brush.tex));
const VALID_CONTAINERS = enumNumberValues(ContainerKind);

function cleanEditorCoord(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return ((Math.floor(value) % W) + W) % W;
}

function cleanPositiveCount(value: unknown, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(OP_ITEM_COUNT_CAP, Math.floor(value)));
}

function cleanKeyId(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, OP_KEY_ID_MAX) : '';
}

function cleanEnumValue<T extends number>(value: unknown, valid: Set<number>): T | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return valid.has(n) ? n as T : null;
}

function normalizeEntityDef(value: unknown): MapEditorEntityDef | null {
  if (!value || typeof value !== 'object') return null;
  const def = value as Partial<MapEditorEntityDef>;
  if (def.kind === 'item') {
    const itemId = typeof def.itemId === 'string' && ITEMS[def.itemId] ? def.itemId : null;
    return itemId ? { kind: 'item', itemId, count: cleanPositiveCount(def.count) } : null;
  }
  if (def.kind === 'monster') {
    const monsterKind = cleanEnumValue<MonsterKind>(def.monsterKind, VALID_MONSTERS);
    if (monsterKind === null || !MONSTERS[monsterKind]) return null;
    return { kind: 'monster', monsterKind };
  }
  if (def.kind === 'npc') {
    const faction = cleanEnumValue<Faction>(def.faction, VALID_FACTIONS);
    return { kind: 'npc', faction: faction ?? Faction.CITIZEN };
  }
  return null;
}

function normalizeContainerDef(value: unknown): MapEditorContainerDef | null {
  if (!value || typeof value !== 'object') return null;
  const def = value as Partial<MapEditorContainerDef>;
  const kind = cleanEnumValue<ContainerKind>(def.kind, VALID_CONTAINERS);
  if (kind === null || !CONTAINER_DEFS[kind]) return null;
  const itemId = typeof def.itemId === 'string' && ITEMS[def.itemId] ? def.itemId : undefined;
  const name = typeof def.name === 'string' ? def.name.slice(0, 96) : undefined;
  return {
    kind,
    itemId,
    count: cleanPositiveCount(def.count),
    name,
  };
}

function normalizeMapEditorOp(value: unknown): MapEditorOp | null {
  if (!value || typeof value !== 'object') return null;
  const op = value as Partial<MapEditorOp>;
  if (op.kind === 'delete_entity') {
    return typeof op.entityId === 'number' && Number.isFinite(op.entityId)
      ? { kind: 'delete_entity', entityId: Math.floor(op.entityId) }
      : null;
  }
  if (op.kind === 'delete_container') {
    return typeof op.containerId === 'number' && Number.isFinite(op.containerId)
      ? { kind: 'delete_container', containerId: Math.floor(op.containerId) }
      : null;
  }

  const x = cleanEditorCoord((op as { x?: unknown }).x);
  const y = cleanEditorCoord((op as { y?: unknown }).y);
  if (x === null || y === null) return null;

  if (op.kind === 'set_cell') {
    const cell = cleanEnumValue<Cell>((op as Partial<Extract<MapEditorOp, { kind: 'set_cell' }>>).cell, VALID_CELLS);
    return cell === null ? null : { kind: 'set_cell', x, y, cell };
  }
  if (op.kind === 'set_wall_tex') {
    const tex = cleanEnumValue<Tex>((op as Partial<Extract<MapEditorOp, { kind: 'set_wall_tex' }>>).tex, VALID_TEXTURES);
    return tex === null ? null : { kind: 'set_wall_tex', x, y, tex };
  }
  if (op.kind === 'set_floor_tex') {
    const tex = cleanEnumValue<Tex>((op as Partial<Extract<MapEditorOp, { kind: 'set_floor_tex' }>>).tex, VALID_TEXTURES);
    return tex === null ? null : { kind: 'set_floor_tex', x, y, tex };
  }
  if (op.kind === 'set_feature') {
    const feature = cleanEnumValue<Feature>((op as Partial<Extract<MapEditorOp, { kind: 'set_feature' }>>).feature, VALID_FEATURES);
    return feature === null ? null : { kind: 'set_feature', x, y, feature };
  }
  if (op.kind === 'set_door') {
    const state = cleanEnumValue<DoorState>((op as Partial<Extract<MapEditorOp, { kind: 'set_door' }>>).state, VALID_DOOR_STATES);
    return state === null ? null : { kind: 'set_door', x, y, state, keyId: cleanKeyId((op as Partial<Extract<MapEditorOp, { kind: 'set_door' }>>).keyId) };
  }
  if (op.kind === 'delete_door') return { kind: 'delete_door', x, y };
  if (op.kind === 'spawn_entity') {
    const entityDef = normalizeEntityDef((op as Partial<Extract<MapEditorOp, { kind: 'spawn_entity' }>>).entityDef);
    return entityDef ? { kind: 'spawn_entity', x, y, entityDef } : null;
  }
  if (op.kind === 'spawn_container') {
    const def = normalizeContainerDef((op as Partial<Extract<MapEditorOp, { kind: 'spawn_container' }>>).def);
    return def ? { kind: 'spawn_container', x, y, def } : null;
  }
  return null;
}

function normalizePatchState(input: Partial<MapEditorPatchState> | null | undefined): MapEditorPatchState {
  const patches: Record<string, MapEditorPatch> = {};
  const srcPatches = input?.patches;
  if (srcPatches && typeof srcPatches === 'object') {
    for (const [key, raw] of Object.entries(srcPatches).slice(-PATCH_FLOOR_CAP)) {
      if (!raw || typeof raw !== 'object') continue;
      const src = raw as Partial<MapEditorPatch>;
      if (typeof src.floorKey !== 'string' || src.floorKey !== key || !Array.isArray(src.ops)) continue;
      const ops = src.ops.slice(0, PATCH_OP_CAP).map(normalizeMapEditorOp).filter((op): op is MapEditorOp => !!op);
      patches[key] = {
        floorKey: key,
        baseFloor: typeof src.baseFloor === 'number' ? src.baseFloor : FloorLevel.LIVING,
        z: typeof src.z === 'number' ? src.z : undefined,
        createdAt: typeof src.createdAt === 'number' ? src.createdAt : 0,
        opCount: ops.length,
        ops,
      };
    }
  }
  const skipped = Array.isArray(input?.skipped)
    ? input.skipped.filter((line): line is string => typeof line === 'string').slice(-12)
    : [];
  return { patches, skipped };
}

export function ensureMapEditorPatchState(state: GameState): MapEditorPatchState {
  const host = state as MapEditorHost;
  host.mapEditorPatches = normalizePatchState(host.mapEditorPatches);
  return host.mapEditorPatches as MapEditorPatchState;
}

export function setMapEditorPatchState(
  state: GameState,
  input: Partial<MapEditorPatchState> | null | undefined,
): MapEditorPatchState {
  const normalized = normalizePatchState(input);
  (state as MapEditorHost).mapEditorPatches = normalized;
  return normalized;
}

export function mapEditorPatchStateForSave(state: GameState): MapEditorPatchState {
  return ensureMapEditorPatchState(state);
}

export function currentMapEditorFloorKey(state: GameState): string {
  const activeKey = activeFloorInstanceWorldKey(state);
  if (activeKey) return activeKey;
  const entry = currentFloorRunEntry(state);
  return floorRunEntryFloorKey(entry);
}

function currentFloorLabel(state: GameState): string {
  const active = getActiveFloorInstance(state);
  if (active) return floorInstanceLabel(active);
  const entry = currentFloorRunEntry(state);
  return entry.label;
}

function currentFloorZ(state: GameState): number | undefined {
  if (getActiveFloorInstance(state)) return undefined;
  return currentFloorRunEntry(state).z;
}

export function openMapEditor(world: World, player: Entity, state: GameState, terminal?: { x: number; y: number }): void {
  const key = currentMapEditorFloorKey(state);
  runtime.open = true;
  runtime.floorKey = key;
  runtime.world = world;
  runtime.cursorX = world.wrap(Math.floor(player.x));
  runtime.cursorY = world.wrap(Math.floor(player.y));
  runtime.cameraX = runtime.cursorX + 0.5;
  runtime.cameraY = runtime.cursorY + 0.5;
  runtime.mode = 'map';
  runtime.menuIndex = 0;
  runtime.status = 'live world edit';
  runtime.error = '';
  runtime.activeTerminalX = terminal?.x;
  runtime.activeTerminalY = terminal?.y;
  resetTransaction();
  state.paused = true;
}

export function closeMapEditor(): MapEditorCommitResult {
  const result = commitMapEditorChanges(runtime.world);
  runtime.open = false;
  runtime.error = '';
  runtime.world = undefined;
  return result;
}

export function isMapEditorOpen(): boolean {
  return runtime.open;
}

export function isMapEditorMapMode(): boolean {
  return runtime.mode === 'map';
}

function cycleIndex(value: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (value + delta + length) % length;
}

function ensurePaintTool(): void {
  if (!PAINT_TOOLS.includes(runtime.tool)) runtime.tool = 'cell';
}

function ensureObjectTool(): void {
  if (!OBJECT_TOOLS.includes(runtime.tool)) runtime.tool = 'entity';
}

export function backMapEditorMode(): MapEditorAction | null {
  runtime.error = '';
  if (runtime.mode === 'map') {
    runtime.mode = 'menu';
    runtime.menuIndex = 0;
    runtime.status = 'terminal menu';
    return null;
  }
  if (runtime.mode === 'menu') {
    runtime.mode = 'map';
    runtime.status = 'map';
    return null;
  }
  runtime.mode = 'menu';
  runtime.status = 'terminal menu';
  return null;
}

export function moveMapEditorMode(world: World, dx: number, dy: number): void {
  runtime.error = '';
  if (runtime.mode === 'map' || runtime.mode === 'details') {
    if (dx !== 0 || dy !== 0) moveMapEditorCursor(world, dx, dy);
    return;
  }

  if (runtime.mode === 'menu') {
    if (dy !== 0) runtime.menuIndex = cycleIndex(runtime.menuIndex, dy, MAIN_MENU.length);
    return;
  }

  if (runtime.mode === 'brush') {
    ensurePaintTool();
    if (dx !== 0) {
      const idx = PAINT_TOOLS.indexOf(runtime.tool);
      runtime.tool = PAINT_TOOLS[cycleIndex(idx, dx, PAINT_TOOLS.length)];
    }
    if (dy !== 0) cycleMapEditorBrush(dy);
    return;
  }

  ensureObjectTool();
  if (dx !== 0) {
    const idx = OBJECT_TOOLS.indexOf(runtime.tool);
    runtime.tool = OBJECT_TOOLS[cycleIndex(idx, dx, OBJECT_TOOLS.length)];
  }
  if (dy !== 0) cycleMapEditorBrush(dy);
}

export function activateMapEditorMode(): MapEditorAction | null {
  runtime.error = '';
  if (runtime.mode === 'map') return 'apply';
  if (runtime.mode === 'menu') {
    const id = MAIN_MENU[runtime.menuIndex]?.id;
    if (id === 'map') {
      runtime.mode = 'map';
      runtime.status = 'map';
    } else if (id === 'brush') {
      runtime.mode = 'brush';
      ensurePaintTool();
      runtime.status = 'brush';
    } else if (id === 'details') {
      runtime.mode = 'details';
      runtime.status = 'details';
    } else if (id === 'objects') {
      runtime.mode = 'objects';
      ensureObjectTool();
      runtime.status = 'objects';
    } else if (id === 'close') {
      return 'close';
    }
    return null;
  }
  if (runtime.mode === 'brush' || runtime.mode === 'objects') {
    runtime.status = `${runtime.mode === 'brush' ? 'brush' : 'object'} selected: ${brushLabel()}`;
    runtime.mode = 'map';
    return null;
  }
  runtime.mode = 'map';
  runtime.status = 'map';
  return null;
}

export function moveMapEditorCursor(world: World, dx: number, dy: number): void {
  runtime.cursorX = world.wrap(runtime.cursorX + dx);
  runtime.cursorY = world.wrap(runtime.cursorY + dy);
  runtime.cameraX = runtime.cursorX + 0.5;
  runtime.cameraY = runtime.cursorY + 0.5;
}

export function adjustMapEditorZoom(delta: number): void {
  runtime.zoom = Math.max(1, Math.min(64, runtime.zoom + delta));
}

export function cycleMapEditorTool(delta = 1): void {
  const idx = TOOLS.indexOf(runtime.tool);
  runtime.tool = TOOLS[(idx + delta + TOOLS.length) % TOOLS.length];
  runtime.error = '';
}

export function cycleMapEditorBrush(delta = 1): void {
  const max = brushCount(runtime.tool);
  runtime.brushIndex[runtime.tool] = (runtime.brushIndex[runtime.tool] + delta + max) % max;
  runtime.error = '';
}

function brushCount(tool: MapEditorToolId): number {
  if (tool === 'door') return DOOR_BRUSHES.length;
  if (tool === 'texture') return TEXTURE_BRUSHES.length;
  if (tool === 'feature') return FEATURE_BRUSHES.length;
  if (tool === 'entity') return mapEditorEntityBrushes().length;
  if (tool === 'container') return mapEditorContainerBrushes().length;
  return CELL_BRUSHES.length;
}

function pushDirty(idx: number): void {
  runtime.revision++;
  runtime.dirtyCells.push(idx);
  if (runtime.dirtyCells.length > 256) runtime.dirtyCells.splice(0, runtime.dirtyCells.length - 256);
}

function transactionDirtyRectInput(tx: MapEditorTransactionState): { x: number; y: number; w: number; h: number }[] | undefined {
  if (tx.dirtyOverflow || tx.dirtyCells.length > TRANSACTION_DIRTY_RECT_CAP) return undefined;
  return tx.dirtyCells.map(idx => ({ x: idx % W, y: (idx / W) | 0, w: 1, h: 1 }));
}

function trackDirtyCells(cells: readonly number[] | undefined): void {
  if (!cells || cells.length === 0 || runtime.transaction.dirtyOverflow) return;
  for (const idx of cells) {
    const cell = ((idx % (W * W)) + W * W) % (W * W);
    if (runtime.transaction.dirtyCells.includes(cell)) continue;
    if (runtime.transaction.dirtyCells.length >= TRANSACTION_DIRTY_CELL_CAP) {
      runtime.transaction.dirtyOverflow = true;
      runtime.transaction.dirtyCells.length = 0;
      return;
    }
    runtime.transaction.dirtyCells.push(cell);
  }
}

function trackMapEditorChange(flags: Partial<Omit<MapEditorTransactionState, 'dirtyCells' | 'dirtyOverflow'>>, cells?: readonly number[]): void {
  runtime.transaction.geometry ||= flags.geometry === true;
  runtime.transaction.doors ||= flags.doors === true;
  runtime.transaction.wallTextures ||= flags.wallTextures === true;
  runtime.transaction.floorTextures ||= flags.floorTextures === true;
  runtime.transaction.surfaces ||= flags.surfaces === true;
  runtime.transaction.features ||= flags.features === true;
  runtime.transaction.featureLights ||= flags.featureLights === true;
  runtime.transaction.entities ||= flags.entities === true;
  runtime.transaction.containers ||= flags.containers === true;
  runtime.transaction.territory ||= flags.territory === true;
  runtime.transaction.roomMap ||= flags.roomMap === true;
  trackDirtyCells(cells);
}

function transactionChanged(tx: MapEditorTransactionState): boolean {
  return tx.geometry || tx.doors || tx.wallTextures || tx.floorTextures || tx.surfaces ||
    tx.features || tx.entities || tx.containers || tx.territory || tx.roomMap;
}

export function commitMapEditorChanges(world: World | undefined = runtime.world): MapEditorCommitResult {
  const tx = runtime.transaction;
  const result: MapEditorCommitResult = {
    changed: transactionChanged(tx),
    geometry: tx.geometry,
    doors: tx.doors,
    surfaces: tx.surfaces || tx.wallTextures || tx.floorTextures,
    features: tx.features,
    entities: tx.entities,
    containers: tx.containers,
    territory: tx.territory,
    roomMap: tx.roomMap,
    dirtyCellCount: tx.dirtyOverflow ? W * W : tx.dirtyCells.length,
  };
  if (!world || !result.changed) {
    resetTransaction();
    return result;
  }

  const rects = transactionDirtyRectInput(tx);
  if (tx.geometry || tx.doors || tx.roomMap) world.markCellsDirty(rects);
  if (tx.wallTextures) world.markWallTexDirty(rects);
  if (tx.floorTextures) world.markFloorTexDirty(rects);
  if (tx.features) world.markFeaturesDirty(tx.featureLights, rects);
  if (tx.entities) markEntityIndexDirty();
  runtime.status = `committed ${result.dirtyCellCount} cells`;
  resetTransaction();
  return result;
}

function setError(reason: string): MapEditorApplyResult {
  runtime.error = reason;
  return { ok: false, reason };
}

function passable(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function cellProtected(world: World, idx: number): boolean {
  return world.aptMask[idx] !== 0 || world.hermoWall[idx] !== 0;
}

function activeTerminalProtected(world: World, idx: number): boolean {
  if (runtime.activeTerminalX === undefined || runtime.activeTerminalY === undefined) return false;
  return world.idx(runtime.activeTerminalX, runtime.activeTerminalY) === idx;
}

function featureNeedsLightBake(feature: Feature): boolean {
  return feature === Feature.LAMP || feature === Feature.CANDLE;
}

function removeIndex(list: number[], idx: number): number[] {
  return list.filter(value => value !== idx);
}

function setEditorFeatureAt(world: World, idx: number, feature: Feature): boolean {
  const old = world.features[idx] as Feature;
  if (old === feature) return false;
  world.features[idx] = feature;
  if (old === Feature.SCREEN && feature !== Feature.SCREEN) world.screenCells = removeIndex(world.screenCells, idx);
  if (feature === Feature.SCREEN && !world.screenCells.includes(idx)) world.screenCells.push(idx);
  if (old === Feature.SLIDE && feature !== Feature.SLIDE) world.slideCells = removeIndex(world.slideCells, idx);
  if (feature === Feature.SLIDE && !world.slideCells.includes(idx)) world.slideCells.push(idx);
  trackMapEditorChange({ features: true, featureLights: featureNeedsLightBake(old) || featureNeedsLightBake(feature) }, [idx]);
  return true;
}

function removeDoorFromRoom(world: World, roomId: number, idx: number): void {
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  if (!room) return;
  room.doors = room.doors.filter(doorIdx => doorIdx !== idx);
}

function removeEditorDoorAt(world: World, idx: number): boolean {
  const door = world.doors.get(idx);
  if (door) {
    removeDoorFromRoom(world, door.roomA, idx);
    removeDoorFromRoom(world, door.roomB, idx);
  }
  for (const room of world.rooms) {
    if (!room) continue;
    room.doors = room.doors.filter(doorIdx => doorIdx !== idx);
  }
  let changed = world.doors.delete(idx);
  if (world.cells[idx] === Cell.DOOR) {
    world.cells[idx] = Cell.FLOOR;
    changed = true;
  }
  if (world.wallTex[idx] === Tex.DOOR_WOOD || world.wallTex[idx] === Tex.DOOR_METAL || world.wallTex[idx] === Tex.DOOR_HERMETIC) {
    world.wallTex[idx] = Tex.CONCRETE;
    changed = true;
  }
  if (changed) trackMapEditorChange({ geometry: true, doors: true, wallTextures: true, roomMap: true }, [idx]);
  return changed;
}

function attachDoorToRooms(world: World, idx: number, roomA: number, roomB: number): void {
  const attach = (roomId: number): void => {
    const room = roomId >= 0 ? world.rooms[roomId] : undefined;
    if (!room || room.doors.includes(idx)) return;
    room.doors.push(idx);
  };
  attach(roomA);
  attach(roomB);
}

function removeContainersAt(world: World, idx: number): number {
  const before = world.containers.length;
  world.containers = world.containers.filter(c => world.idx(c.x, c.y) !== idx);
  if (world.containers.length !== before) {
    world.rebuildContainerMap();
    trackMapEditorChange({ containers: true }, [idx]);
  }
  return before - world.containers.length;
}

function removeLooseEntitiesAt(entities: Entity[], idx: number, world: World): number {
  let removed = 0;
  for (const entity of entities) {
    if (isPlayerEntity(entity)) continue;
    if (world.idx(Math.floor(entity.x), Math.floor(entity.y)) === idx && entity.alive) {
      entity.alive = false;
      removed++;
    }
  }
  if (removed > 0) trackMapEditorChange({ entities: true }, [idx]);
  return removed;
}

function adjacentRoomIds(world: World, x: number, y: number): { roomA: number; roomB: number } {
  let roomA = -1;
  let roomB = -1;
  for (const [dx, dy] of DIRS) {
    const id = world.roomMap[world.idx(x + dx, y + dy)];
    if (id < 0) continue;
    if (roomA < 0) roomA = id;
    else if (id !== roomA) { roomB = id; break; }
  }
  return { roomA, roomB };
}

function inferRoom(world: World, x: number, y: number): number {
  for (const [dx, dy] of DIRS) {
    const id = world.roomMap[world.idx(x + dx, y + dy)];
    if (id >= 0) return id;
  }
  return -1;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) id = Math.max(id, container.id + 1);
  return id;
}

function containerName(kind: ContainerKind): string {
  switch (kind) {
    case ContainerKind.METAL_CABINET: return 'Редактор: металлический шкаф';
    case ContainerKind.SAFE: return 'Редактор: сейф';
    default: return 'Редактор: ящик';
  }
}

function recordOp(state: GameState, op: MapEditorOp): boolean {
  const patches = ensureMapEditorPatchState(state);
  const key = currentMapEditorFloorKey(state);
  let patch = patches.patches[key];
  if (!patch) {
    const keys = Object.keys(patches.patches);
    if (keys.length >= PATCH_FLOOR_CAP) delete patches.patches[keys[0]];
    patch = {
      floorKey: key,
      baseFloor: state.currentFloor,
      z: currentFloorZ(state),
      createdAt: state.time,
      opCount: 0,
      ops: [],
    };
    patches.patches[key] = patch;
  }
  if (patch.ops.length >= PATCH_OP_CAP) {
    runtime.error = 'ПАМЯТЬ ТЕРМИНАЛА ПЕРЕПОЛНЕНА';
    return false;
  }
  patch.ops.push(op);
  patch.opCount = patch.ops.length;
  return true;
}

function applyCellOp(world: World, entities: Entity[], player: Entity, op: { x: number; y: number; cell: Cell }): MapEditorApplyResult {
  const x = world.wrap(Math.floor(op.x));
  const y = world.wrap(Math.floor(op.y));
  const idx = world.idx(x, y);
  if (cellProtected(world, idx)) return setError('ЗАЩИЩЕНО');
  if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
  if (world.idx(Math.floor(player.x), Math.floor(player.y)) === idx && !passable(op.cell)) return setError('Нельзя замуровать себя');
  if (op.cell !== Cell.DOOR) removeEditorDoorAt(world, idx);
  if (op.cell === Cell.WALL || op.cell === Cell.ABYSS) {
    setEditorFeatureAt(world, idx, Feature.NONE);
    removeContainersAt(world, idx);
    removeLooseEntitiesAt(entities, idx, world);
  }
  world.cells[idx] = op.cell;
  if (op.cell === Cell.DOOR) {
    const rooms = adjacentRoomIds(world, x, y);
    removeEditorDoorAt(world, idx);
    world.cells[idx] = Cell.DOOR;
    world.doors.set(idx, { idx, state: DoorState.CLOSED, roomA: rooms.roomA, roomB: rooms.roomB, keyId: '', timer: 0 });
    attachDoorToRooms(world, idx, rooms.roomA, rooms.roomB);
    world.roomMap[idx] = -1;
    world.wallTex[idx] = Tex.DOOR_WOOD;
    trackMapEditorChange({ geometry: true, doors: true, wallTextures: true, roomMap: true }, [idx]);
  } else if (op.cell === Cell.FLOOR || op.cell === Cell.WATER) {
    world.roomMap[idx] = inferRoom(world, x, y);
    if (!world.floorTex[idx]) world.floorTex[idx] = op.cell === Cell.WATER ? Tex.F_WATER : Tex.F_CONCRETE;
    trackMapEditorChange({ geometry: true, floorTextures: true, roomMap: true }, [idx]);
  } else if (op.cell === Cell.LIFT) {
    world.roomMap[idx] = -1;
    world.liftDir[idx] = LiftDirection.UP;
    world.wallTex[idx] = Tex.LIFT_DOOR;
    trackMapEditorChange({ geometry: true, wallTextures: true, roomMap: true }, [idx]);
  } else {
    world.roomMap[idx] = -1;
    world.wallTex[idx] ||= Tex.CONCRETE;
    trackMapEditorChange({ geometry: true, wallTextures: true, roomMap: true }, [idx]);
  }
  pushDirty(idx);
  runtime.status = `cell ${x},${y}`;
  return { ok: true, reason: 'ok', dirtyCells: [idx] };
}

function spawnEditorEntity(world: World, entities: Entity[], nextEntityId: { v: number }, op: Extract<MapEditorOp, { kind: 'spawn_entity' }>): MapEditorApplyResult {
  const x = world.wrap(Math.floor(op.x));
  const y = world.wrap(Math.floor(op.y));
  const idx = world.idx(x, y);
  if (!passable(world.cells[idx])) return setError('Нужен проход');
  const def = op.entityDef;
  if (def.kind === 'item') {
    if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) return setError('Лимит предметов достигнут');
    const itemId = def.itemId ?? 'water';
    if (!ITEMS[itemId]) return setError(`Нет предмета ${itemId}`);
    entities.push({
      id: nextEntityId.v++,
      type: EntityType.ITEM_DROP,
      x: x + 0.5,
      y: y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [{ defId: itemId, count: Math.max(1, Math.floor(def.count ?? 1)) }],
    });
    trackMapEditorChange({ entities: true }, [idx]);
  } else if (def.kind === 'monster') {
    if (!canSpawnEntityType(entities, EntityType.MONSTER)) return setError('Лимит мобов достигнут');
    const kind = def.monsterKind ?? MonsterKind.SBORKA;
    const monsterDef = MONSTERS[kind];
    if (!monsterDef) return setError(`Нет монстра ${kind}`);
    const rpg = randomRPG(1);
    const hp = Math.max(1, monsterDef.hp);
    const monster: Entity = {
      id: nextEntityId.v++,
      type: EntityType.MONSTER,
      x: x + 0.5,
      y: y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: monsterDef.speed,
      sprite: monsterDef.sprite,
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg,
    };
    entities.push(monster);
    trackMapEditorChange({ entities: true }, [idx]);
  } else {
    if (!canSpawnEntityType(entities, EntityType.NPC)) return setError('Лимит NPC достигнут');
    const faction = def.faction ?? Faction.CITIZEN;
    const occupation = randomOccupation(faction);
    const name = randomName(faction);
    const rpg = randomRPG(1);
    const maxHp = getMaxHp(rpg);
    entities.push({
      id: nextEntityId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 1.2,
      sprite: occupation,
      name: name.name,
      firstName: name.firstName,
      lastName: name.lastName,
      isFemale: name.female,
      needs: freshNeeds(),
      hp: maxHp,
      maxHp,
      ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      inventory: [],
      faction,
      occupation,
      isTraveler: true,
      questId: -1,
      money: 20,
      rpg,
    });
    trackMapEditorChange({ entities: true }, [idx]);
  }
  pushDirty(idx);
  return { ok: true, reason: 'ok', dirtyCells: [idx] };
}

function spawnEditorContainer(world: World, state: GameState, op: Extract<MapEditorOp, { kind: 'spawn_container' }>): MapEditorApplyResult {
  const x = world.wrap(Math.floor(op.x));
  const y = world.wrap(Math.floor(op.y));
  const idx = world.idx(x, y);
  if (!passable(world.cells[idx])) return setError('Нужен проход');
  const roomId = world.roomMap[idx];
  if (roomId < 0 || !world.rooms[roomId]) return setError('Нужна клетка комнаты');
  const kind = op.def.kind ?? ContainerKind.WOODEN_CHEST;
  const containerDef = CONTAINER_DEFS[kind];
  const itemId = op.def.itemId ?? 'water';
  const inventory = ITEMS[itemId] ? [{ defId: itemId, count: Math.max(1, Math.floor(op.def.count ?? 1)) }] : [];
  const container: WorldContainer = {
    id: nextContainerId(world),
    x,
    y,
    floor: state.currentFloor,
    roomId,
    zoneId: world.zoneMap[idx],
    kind,
    name: op.def.name ?? containerDef?.name ?? containerName(kind),
    inventory,
    capacitySlots: containerDef?.capacitySlots ?? 5,
    access: containerDef?.defaultAccess ?? 'public',
    discovered: true,
    tags: ['map_editor', 'net_terminal_gen', ...(containerDef?.tags ?? [])],
  };
  world.addContainer(container);
  trackMapEditorChange({ containers: true }, [idx]);
  pushDirty(idx);
  return { ok: true, reason: 'ok', dirtyCells: [idx] };
}

export function applyMapEditorOp(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextEntityId: { v: number },
  op: MapEditorOp,
  record = true,
): MapEditorApplyResult {
  runtime.error = '';
  const safeOp = normalizeMapEditorOp(op);
  if (!safeOp) return setError('Некорректная операция');
  let result: MapEditorApplyResult;
  if (safeOp.kind === 'set_cell') {
    result = applyCellOp(world, entities, player, safeOp);
  } else if (safeOp.kind === 'set_wall_tex') {
    const idx = world.idx(safeOp.x, safeOp.y);
    if (cellProtected(world, idx)) return setError('ЗАЩИЩЕНО');
    if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
    world.wallTex[idx] = safeOp.tex;
    trackMapEditorChange({ wallTextures: true }, [idx]);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'set_floor_tex') {
    const idx = world.idx(safeOp.x, safeOp.y);
    if (cellProtected(world, idx)) return setError('ЗАЩИЩЕНО');
    if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
    world.floorTex[idx] = safeOp.tex;
    trackMapEditorChange({ floorTextures: true }, [idx]);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'set_feature') {
    const idx = world.idx(safeOp.x, safeOp.y);
    if (cellProtected(world, idx)) return setError('ЗАЩИЩЕНО');
    if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
    setEditorFeatureAt(world, idx, safeOp.feature);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'set_door') {
    const x = world.wrap(Math.floor(safeOp.x));
    const y = world.wrap(Math.floor(safeOp.y));
    const idx = world.idx(x, y);
    if (cellProtected(world, idx)) return setError('ЗАЩИЩЕНО');
    if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
    removeEditorDoorAt(world, idx);
    world.cells[idx] = Cell.DOOR;
    const rooms = adjacentRoomIds(world, x, y);
    world.doors.set(idx, { idx, state: safeOp.state, roomA: rooms.roomA, roomB: rooms.roomB, keyId: safeOp.keyId, timer: 0 });
    attachDoorToRooms(world, idx, rooms.roomA, rooms.roomB);
    world.roomMap[idx] = -1;
    world.wallTex[idx] = Tex.DOOR_WOOD;
    trackMapEditorChange({ geometry: true, doors: true, wallTextures: true, roomMap: true }, [idx]);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'delete_door') {
    const idx = world.idx(safeOp.x, safeOp.y);
    if (activeTerminalProtected(world, idx)) return setError('ТЕРМИНАЛ АКТИВЕН');
    removeEditorDoorAt(world, idx);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'spawn_entity') {
    result = spawnEditorEntity(world, entities, nextEntityId, safeOp);
  } else if (safeOp.kind === 'delete_entity') {
    const entity = entities.find(e => e.id === safeOp.entityId && !isPlayerEntity(e));
    if (!entity) return setError('Нет entity');
    entity.alive = false;
    const idx = world.idx(Math.floor(entity.x), Math.floor(entity.y));
    trackMapEditorChange({ entities: true }, [idx]);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  } else if (safeOp.kind === 'spawn_container') {
    result = spawnEditorContainer(world, state, safeOp);
  } else {
    const before = world.containers.length;
    const removed = world.containers.find(c => c.id === safeOp.containerId);
    world.containers = world.containers.filter(c => c.id !== safeOp.containerId);
    world.rebuildContainerMap();
    if (world.containers.length === before || !removed) return setError('Нет контейнера');
    const idx = world.idx(removed.x, removed.y);
    trackMapEditorChange({ containers: true }, [idx]);
    pushDirty(idx);
    result = { ok: true, reason: 'ok', dirtyCells: [idx] };
  }

  if (result.ok && record) recordOp(state, safeOp);
  runtime.status = result.ok ? result.reason : runtime.status;
  return result;
}

function nearestEntityId(world: World, entities: readonly Entity[], x: number, y: number): number | null {
  const idx = world.idx(x, y);
  for (const entity of entities) {
    if (isPlayerEntity(entity) || !entity.alive) continue;
    if (world.idx(Math.floor(entity.x), Math.floor(entity.y)) === idx) return entity.id;
  }
  return null;
}

function nearestContainerId(world: World, x: number, y: number): number | null {
  const ids = world.containerMap.get(world.idx(x, y));
  return ids?.[0] ?? null;
}

export function createCurrentMapEditorOp(world: World, entities: Entity[]): MapEditorOp | null {
  const x = runtime.cursorX;
  const y = runtime.cursorY;
  const brushIdx = runtime.brushIndex[runtime.tool] % brushCount(runtime.tool);
  if (runtime.tool === 'cell') return { kind: 'set_cell', x, y, cell: CELL_BRUSHES[brushIdx] };
  if (runtime.tool === 'door') return { kind: 'set_door', x, y, state: DOOR_BRUSHES[brushIdx], keyId: '' };
  if (runtime.tool === 'feature') return { kind: 'set_feature', x, y, feature: FEATURE_BRUSHES[brushIdx] };
  if (runtime.tool === 'texture') {
    const brush = TEXTURE_BRUSHES[brushIdx];
    return brush.kind === 'wall'
      ? { kind: 'set_wall_tex', x, y, tex: brush.tex }
      : { kind: 'set_floor_tex', x, y, tex: brush.tex };
  }
  if (runtime.tool === 'entity') {
    const brushes = mapEditorEntityBrushes();
    const brush = brushes[brushIdx % brushes.length];
    if (brush.kind === 'delete') {
      const entityId = nearestEntityId(world, entities, x, y);
      return entityId === null ? null : { kind: 'delete_entity', entityId };
    }
    if (brush.kind === 'item') return { kind: 'spawn_entity', x, y, entityDef: { kind: 'item', itemId: brush.itemId, count: 1 } };
    if (brush.kind === 'monster') return { kind: 'spawn_entity', x, y, entityDef: { kind: 'monster', monsterKind: brush.monsterKind } };
    return { kind: 'spawn_entity', x, y, entityDef: { kind: 'npc', faction: brush.faction } };
  }
  if (runtime.tool === 'container') {
    const brushes = mapEditorContainerBrushes();
    const brush = brushes[brushIdx % brushes.length];
    if (brush.kind === 'delete') {
      const containerId = nearestContainerId(world, x, y);
      return containerId === null ? null : { kind: 'delete_container', containerId };
    }
    const seedItem = 'water';
    return { kind: 'spawn_container', x, y, def: { kind: brush.kind, itemId: seedItem, count: 1 } };
  }
  return null;
}

export function applyCurrentMapEditorBrush(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextEntityId: { v: number },
): MapEditorApplyResult {
  const op = createCurrentMapEditorOp(world, entities);
  if (!op) return setError('Нечего применить');
  return applyMapEditorOp(world, entities, player, state, nextEntityId, op, true);
}

export function replayMapEditorPatchForCurrentFloor(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextEntityId: { v: number },
): number {
  const patches = ensureMapEditorPatchState(state);
  const key = currentMapEditorFloorKey(state);
  const patch = patches.patches[key];
  if (!patch) return 0;
  resetTransaction();
  let applied = 0;
  for (const op of patch.ops) {
    const result = applyMapEditorOp(world, entities, player, state, nextEntityId, op, false);
    if (result.ok) applied++;
    else patches.skipped.push(`${key}:${op.kind}:${result.reason}`);
  }
  commitMapEditorChanges(world);
  if (patches.skipped.length > 12) patches.skipped.splice(0, patches.skipped.length - 12);
  runtime.status = applied > 0 ? `replayed ${applied}/${patch.ops.length}` : runtime.status;
  return applied;
}

export function clearCurrentMapEditorPatch(state: GameState): boolean {
  const patches = ensureMapEditorPatchState(state);
  const key = currentMapEditorFloorKey(state);
  const existed = !!patches.patches[key];
  delete patches.patches[key];
  runtime.status = existed ? 'patch cleared' : 'no patch';
  return existed;
}

function cellName(cell: Cell): string {
  switch (cell) {
    case Cell.FLOOR: return 'FLOOR';
    case Cell.WALL: return 'WALL';
    case Cell.DOOR: return 'DOOR';
    case Cell.WATER: return 'WATER';
    case Cell.LIFT: return 'LIFT';
    case Cell.ABYSS: return 'GLITCH';
    default: return String(cell);
  }
}

function featureName(feature: Feature): string {
  switch (feature) {
    case Feature.NONE: return 'NONE';
    case Feature.LAMP: return 'LAMP';
    case Feature.CANDLE: return 'CANDLE';
    case Feature.TABLE: return 'TABLE';
    case Feature.CHAIR: return 'CHAIR';
    case Feature.BED: return 'BED';
    case Feature.SHELF: return 'SHELF';
    case Feature.MACHINE: return 'MACHINE';
    case Feature.APPARATUS: return 'APPARATUS';
    case Feature.SCREEN: return 'SCREEN';
    default: return String(feature);
  }
}

function cellBrushLabel(): string {
  return cellName(CELL_BRUSHES[runtime.brushIndex.cell % CELL_BRUSHES.length]);
}

function doorBrushLabel(): string {
  return DoorState[DOOR_BRUSHES[runtime.brushIndex.door % DOOR_BRUSHES.length]];
}

function featureBrushLabel(): string {
  return featureName(FEATURE_BRUSHES[runtime.brushIndex.feature % FEATURE_BRUSHES.length]);
}

function brushLabel(): string {
  if (runtime.tool === 'cell') return cellBrushLabel();
  if (runtime.tool === 'door') return doorBrushLabel();
  if (runtime.tool === 'feature') return featureBrushLabel();
  if (runtime.tool === 'texture') return TEXTURE_BRUSHES[runtime.brushIndex.texture % TEXTURE_BRUSHES.length].label;
  if (runtime.tool === 'entity') {
    const brushes = mapEditorEntityBrushes();
    return brushes[runtime.brushIndex.entity % brushes.length]?.label ?? '-';
  }
  if (runtime.tool === 'container') {
    const brushes = mapEditorContainerBrushes();
    return brushes[runtime.brushIndex.container % brushes.length]?.label ?? '-';
  }
  return '-';
}

function brushValue(): string | number {
  if (runtime.tool === 'cell') return CELL_BRUSHES[runtime.brushIndex.cell % CELL_BRUSHES.length];
  if (runtime.tool === 'door') return DOOR_BRUSHES[runtime.brushIndex.door % DOOR_BRUSHES.length];
  if (runtime.tool === 'feature') return FEATURE_BRUSHES[runtime.brushIndex.feature % FEATURE_BRUSHES.length];
  if (runtime.tool === 'texture') return TEXTURE_BRUSHES[runtime.brushIndex.texture % TEXTURE_BRUSHES.length].label;
  if (runtime.tool === 'entity') {
    const brushes = mapEditorEntityBrushes();
    return brushes[runtime.brushIndex.entity % brushes.length]?.label ?? 'entity';
  }
  if (runtime.tool === 'container') {
    const brushes = mapEditorContainerBrushes();
    return brushes[runtime.brushIndex.container % brushes.length]?.label ?? 'container';
  }
  return 'inspect';
}

function palette(): MapEditorSnapshot['palette'] {
  if (runtime.tool === 'cell') return CELL_BRUSHES.map((cell, i) => ({ id: cell, label: cellName(cell), active: i === runtime.brushIndex.cell }));
  if (runtime.tool === 'door') return DOOR_BRUSHES.map((state, i) => ({ id: state, label: DoorState[state], active: i === runtime.brushIndex.door }));
  if (runtime.tool === 'feature') return FEATURE_BRUSHES.map((feature, i) => ({ id: feature, label: featureName(feature), active: i === runtime.brushIndex.feature }));
  if (runtime.tool === 'texture') return TEXTURE_BRUSHES.map((brush, i) => ({ id: brush.label, label: brush.label, active: i === runtime.brushIndex.texture }));
  if (runtime.tool === 'entity') {
    const brushes = mapEditorEntityBrushes();
    const active = runtime.brushIndex.entity % brushes.length;
    return brushes.map((brush, i) => ({ id: brush.label, label: brush.label, color: brush.color, active: i === active }));
  }
  if (runtime.tool === 'container') {
    const brushes = mapEditorContainerBrushes();
    const active = runtime.brushIndex.container % brushes.length;
    return brushes.map((brush, i) => ({ id: brush.label, label: brush.label, color: brush.color, active: i === active }));
  }
  return [];
}

function menuTitle(): string {
  if (runtime.mode === 'menu') return 'МЕНЮ ТЕРМИНАЛА';
  if (runtime.mode === 'brush') return `КИСТЬ: ${runtime.tool.toUpperCase()}`;
  if (runtime.mode === 'details') return 'ДЕТАЛИ КАРТЫ';
  if (runtime.mode === 'objects') return `ОБЪЕКТЫ: ${runtime.tool.toUpperCase()}`;
  return 'КАРТА';
}

function menuEntries(): readonly MapEditorMenuEntry[] {
  if (runtime.mode === 'menu') {
    return MAIN_MENU.map((entry, i) => ({ ...entry, active: i === runtime.menuIndex }));
  }
  if (runtime.mode === 'brush') {
    return palette().map(entry => ({
      id: entry.id ?? entry.label,
      label: entry.label,
      color: entry.color,
      active: entry.active,
    }));
  }
  if (runtime.mode === 'objects') {
    return palette().map(entry => ({
      id: entry.id ?? entry.label,
      label: entry.label,
      color: entry.color,
      active: entry.active,
    }));
  }
  return [];
}

function modeHints(): readonly string[] {
  if (runtime.mode === 'map') return [`${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} курсор`, 'wheel масштаб', `${controlHint('gameMenu')} поставить`, `${menuCloseHint()} назад`];
  if (runtime.mode === 'menu') return [`${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} пункт`, `${controlHint('gameMenu')} выбрать`, `${menuCloseHint()} карта`];
  if (runtime.mode === 'brush') return [`${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} тип кисти`, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} значение`, `${controlHint('gameMenu')} выбрать`, `${menuCloseHint()} назад`];
  if (runtime.mode === 'objects') return [`${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} группа`, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} объект`, `${controlHint('gameMenu')} выбрать`, `${menuCloseHint()} назад`];
  return [`${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} инспектор`, `${controlHint('gameMenu')} карта`, `${menuCloseHint()} назад`];
}

export function getMapEditorSnapshot(state: GameState): MapEditorSnapshot {
  const key = currentMapEditorFloorKey(state);
  const patches = ensureMapEditorPatchState(state);
  const patch = patches.patches[key];
  return {
    floorKey: key,
    floorLabel: currentFloorLabel(state),
    z: currentFloorZ(state),
    tool: runtime.tool,
    brush: brushValue(),
    brushLabel: brushLabel(),
    status: runtime.status,
    error: runtime.error,
    dirtyOps: patch?.ops.length ?? 0,
    patchOps: patch?.ops.length ?? 0,
    maxPatchOps: PATCH_OP_CAP,
    cursorX: runtime.cursorX,
    cursorY: runtime.cursorY,
    cameraX: runtime.cameraX,
    cameraY: runtime.cameraY,
    zoom: runtime.zoom,
    revision: runtime.revision,
    dirtyCells: runtime.dirtyCells,
    tools: TOOLS,
    palette: palette(),
    mode: runtime.mode,
    menuTitle: menuTitle(),
    menuIndex: runtime.menuIndex,
    menuEntries: menuEntries(),
    hints: modeHints(),
    activeTerminalX: runtime.activeTerminalX,
    activeTerminalY: runtime.activeTerminalY,
  };
}

export function summarizeMapEditor(state: GameState): string[] {
  const patches = ensureMapEditorPatchState(state);
  const key = currentMapEditorFloorKey(state);
  const current = patches.patches[key];
  const totalOps = Object.values(patches.patches).reduce((sum, patch) => sum + patch.ops.length, 0);
  return [
    `open=${runtime.open ? 'yes' : 'no'} floor=${key} tool=${runtime.tool} brush=${brushLabel()} cursor=${runtime.cursorX},${runtime.cursorY}`,
    `currentOps=${current?.ops.length ?? 0}/${PATCH_OP_CAP} floors=${Object.keys(patches.patches).length} totalOps=${totalOps}`,
    ...patches.skipped.slice(-4).map(line => `skip=${line}`),
  ];
}
