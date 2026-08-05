import {
  Cell,
  Feature,
  FloorLevel,
  W,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import { World } from '../core/world';
import { COMPUTER_DEFS, getComputerDef, type ComputerDef, type ComputerDefId } from '../data/computers';
import { getCraftRecipeSource } from '../data/craft_recipe_sources';
import {
  craftRecipeLearnedMessage,
  learnCraftRecipesFromSource,
  type CraftRecipeLearnResult,
} from './crafting';
import { publishEvent } from './events';
import { floorKeyForStory } from './floor_keys';
import { currentFloorRunEntry, floorRunEntryFloorKey } from './procedural_floors';

export interface ComputerTerminal {
  idx: number;
  x: number;
  y: number;
  defId: ComputerDefId;
}

export interface ComputerOverlaySnapshot {
  open: boolean;
  terminalIdx: number;
  label: string;
  pageIndex: number;
  pageCount: number;
  title: string;
  lines: readonly string[];
  copied: boolean;
  copyLabel: string;
  rewardRubles: number;
  message: string;
}

const computerRegistry = new Map<number, ComputerTerminal>();
const copiedKeys = new Set<string>();
const COMPUTER_SAVE_VERSION = 1;
const COMPUTER_COPIED_KEY_CAP = 512;
const COMPUTER_KEY_LEN_CAP = 96;

export interface ComputerSaveState {
  version: 1;
  copiedKeys: string[];
}

const runtime = {
  open: false,
  terminalIdx: -1,
  activeDefId: 'floor_archive' as ComputerDefId,
  pageIndex: 0,
  message: '',
};

function canUseComputerCell(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  const cell = world.cells[idx];
  if (cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.ABYSS) return false;
  const feature = world.features[idx];
  return feature === Feature.NONE || feature === Feature.SCREEN || feature === Feature.APPARATUS;
}

function currentDef(): ComputerDef {
  return COMPUTER_DEFS[runtime.activeDefId] ?? COMPUTER_DEFS.floor_archive;
}

function currentFloorKey(state: GameState): string {
  try {
    return floorRunEntryFloorKey(currentFloorRunEntry(state));
  } catch {
    return floorKeyForStory(state.currentFloor);
  }
}

function copiedKey(state: GameState, terminalIdx: number): string {
  return `${currentFloorKey(state)}:${terminalIdx}`;
}

function cleanTerminalKey(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, COMPUTER_KEY_LEN_CAP);
}

function clampPage(): void {
  const def = currentDef();
  runtime.pageIndex = ((runtime.pageIndex % def.pages.length) + def.pages.length) % def.pages.length;
}

function floorFactLines(world: World, state: GameState, terminal: ComputerTerminal | undefined): string[] {
  const idx = terminal?.idx ?? -1;
  const roomId = idx >= 0 ? world.roomMap[idx] : -1;
  const zoneId = idx >= 0 ? world.zoneMap[idx] : -1;
  const room = roomId >= 0 ? world.rooms[roomId] : undefined;
  const zone = zoneId >= 0 ? world.zones[zoneId] : undefined;
  return [
    `Этаж: ${FloorLevel[state.currentFloor] ?? state.currentFloor}. Зона: ${zoneId >= 0 ? zoneId : 'нет'}.`,
    `Комната: ${room?.name ?? 'не подписана'}. Опасность зоны: ${zone?.level ?? 0}.`,
    `Самосбор: ${state.samosborActive ? 'активен' : 'нет'}; таймер ${Math.max(0, Math.floor(state.samosborTimer))} сек.`,
  ];
}

function learnComputerRecipeSources(state: GameState, def: ComputerDef): CraftRecipeLearnResult[] {
  const results: CraftRecipeLearnResult[] = [];
  for (const sourceId of def.recipeSourceIds ?? []) {
    const source = getCraftRecipeSource(sourceId);
    if (!source || source.kind !== 'terminal') continue;
    results.push(learnCraftRecipesFromSource(state, source));
  }
  return results;
}

function learnedComputerRecipeIds(results: readonly CraftRecipeLearnResult[]): string[] {
  return results.flatMap(result => result.learned);
}

function allComputerRecipeIds(def: ComputerDef): string[] {
  const ids: string[] = [];
  for (const sourceId of def.recipeSourceIds ?? []) {
    const source = getCraftRecipeSource(sourceId);
    if (source?.kind === 'terminal') ids.push(...source.recipeIds);
  }
  return [...new Set(ids)];
}

export function clearComputers(): void {
  computerRegistry.clear();
}

export function resetComputerState(): void {
  copiedKeys.clear();
  closeComputer();
}

export function computersStateForSave(): ComputerSaveState | undefined {
  if (copiedKeys.size === 0) return undefined;
  return {
    version: COMPUTER_SAVE_VERSION,
    copiedKeys: [...copiedKeys].slice(-COMPUTER_COPIED_KEY_CAP),
  };
}

export function restoreComputersFromSave(input: unknown): void {
  copiedKeys.clear();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const raw = input as { version?: unknown; copiedKeys?: unknown };
  if (raw.version !== COMPUTER_SAVE_VERSION || !Array.isArray(raw.copiedKeys)) return;
  for (const item of raw.copiedKeys) {
    if (copiedKeys.size >= COMPUTER_COPIED_KEY_CAP) break;
    const key = cleanTerminalKey(item);
    if (key) copiedKeys.add(key);
  }
}

export function getComputerAt(world: World, x: number, y: number): ComputerTerminal | undefined {
  return computerRegistry.get(world.idx(Math.floor(x), Math.floor(y)));
}

export function isComputerTarget(world: World, x: number, y: number): boolean {
  return !!getComputerAt(world, x, y);
}

export function placeComputer(world: World, x: number, y: number, defId: ComputerDefId): ComputerTerminal | null {
  const def = getComputerDef(defId);
  if (!def) return null;
  const idx = world.idx(x, y);
  if (!canUseComputerCell(world, idx)) return null;
  world.setFeatureAt(idx, Feature.SCREEN);
  const terminal: ComputerTerminal = { idx, x: idx % W, y: (idx / W) | 0, defId: def.id };
  computerRegistry.set(idx, terminal);
  return terminal;
}

export function openComputer(state: GameState, terminal: ComputerTerminal): void {
  runtime.open = true;
  runtime.terminalIdx = terminal.idx;
  runtime.activeDefId = terminal.defId;
  runtime.pageIndex = 0;
  runtime.message = '';
  state.paused = true;
}

export function closeComputer(): void {
  runtime.open = false;
  runtime.terminalIdx = -1;
  runtime.message = '';
}

export function isComputerOverlayOpen(): boolean {
  return runtime.open;
}

export function moveComputerPage(delta: number): void {
  runtime.pageIndex += delta;
  clampPage();
  runtime.message = '';
}

export function copyComputerData(world: World, state: GameState, player: Entity): boolean {
  const terminal = computerRegistry.get(runtime.terminalIdx);
  const def = terminal ? getComputerDef(terminal.defId) : undefined;
  if (!terminal || !def) {
    runtime.message = 'Компьютер выпал из локальной сети.';
    return false;
  }
  const key = copiedKey(state, terminal.idx);
  if (copiedKeys.has(key)) {
    runtime.message = 'Эта выгрузка уже скопирована.';
    state.msgs.push(msg(runtime.message, state.time, '#888'));
    return false;
  }

  copiedKeys.add(key);
  player.money = Math.max(0, Math.floor(player.money ?? 0)) + def.stealRewardRubles;
  const recipeResults = learnComputerRecipeSources(state, def);
  const learnedRecipeIds = learnedComputerRecipeIds(recipeResults);
  runtime.message = `${def.stealLabel}: +${def.stealRewardRubles} руб.`;
  for (const recipeId of learnedRecipeIds) {
    state.msgs.push(msg(craftRecipeLearnedMessage(recipeId), state.time, '#8cf'));
  }
  if (learnedRecipeIds.length === 0 && recipeResults.some(result => result.duplicate.length > 0)) {
    state.msgs.push(msg('Рецепт уже известен', state.time, '#888'));
  }
  const roomId = world.roomMap[terminal.idx];
  publishEvent(state, {
    type: 'computer_data_stolen',
    zoneId: world.zoneMap[terminal.idx],
    roomId: roomId >= 0 ? roomId : undefined,
    x: terminal.x + 0.5,
    y: terminal.y + 0.5,
    actorId: player.id,
    actorName: player.name,
    actorFaction: player.faction,
    itemValue: def.stealRewardRubles,
    severity: 3,
    privacy: 'local',
    tags: ['computer', 'archive', 'stolen', def.id],
    data: {
      terminalId: def.id,
      rewardRubles: def.stealRewardRubles,
      pageIndex: runtime.pageIndex,
      recipeSourceIds: def.recipeSourceIds,
      recipeIds: allComputerRecipeIds(def),
      learnedRecipeIds,
    },
  });
  state.msgs.push(msg(runtime.message, state.time, '#6cf'));
  return true;
}

export function getComputerOverlaySnapshot(world: World, state: GameState): ComputerOverlaySnapshot {
  const terminal = computerRegistry.get(runtime.terminalIdx);
  const def = currentDef();
  clampPage();
  const page = def.pages[runtime.pageIndex] ?? def.pages[0];
  const dynamicLines = runtime.pageIndex === 0 ? floorFactLines(world, state, terminal) : [];
  return {
    open: runtime.open,
    terminalIdx: runtime.terminalIdx,
    label: def.label,
    pageIndex: runtime.pageIndex,
    pageCount: def.pages.length,
    title: page.title,
    lines: [...page.lines, ...dynamicLines],
    copied: copiedKeys.has(copiedKey(state, runtime.terminalIdx)),
    copyLabel: def.stealLabel,
    rewardRubles: def.stealRewardRubles,
    message: runtime.message,
  };
}
