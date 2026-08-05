import {
  Cell,
  Feature,
  W,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import { World } from '../core/world';
import { getNetHackTerminalDef, NET_HACK_TERMINALS, type NetHackTerminalDef, type NetHackTerminalDefId } from '../data/net_hack';
import { publishEvent } from './events';
import { floorKeyForStory } from './floor_keys';
import { currentFloorRunEntry, floorRunEntryFloorKey } from './procedural_floors';

export interface NetHackTerminal {
  idx: number;
  x: number;
  y: number;
  defId: NetHackTerminalDefId;
  seed: number;
}

export interface NetHackDifficulty {
  baseDifficulty: number;
  floorDangerOrZ: number;
  terminalRandom: number;
}

export interface NetHackChanceInput extends NetHackDifficulty {
  level: number;
  int: number;
}

export interface NetHackOverlaySnapshot {
  open: boolean;
  terminalIdx: number;
  label: string;
  chance: number;
  chancePercent: number;
  difficulty: number;
  skill: number;
  locked: boolean;
  solved: boolean;
  rewardRubles: number;
  message: string;
}

const netHackRegistry = new Map<number, NetHackTerminal>();
const solvedKeys = new Set<string>();
const lockedUntil = new Map<string, number>();
const NET_HACK_SAVE_VERSION = 1;
const NET_HACK_SOLVED_KEY_CAP = 512;
const NET_HACK_LOCK_CAP = 256;
const NET_HACK_KEY_LEN_CAP = 96;

export interface NetHackSaveState {
  version: 1;
  solvedKeys: string[];
  lockedUntil: Array<[string, number]>;
}

const runtime = {
  open: false,
  terminalIdx: -1,
  activeDefId: 'service_gate' as NetHackTerminalDefId,
  message: '',
};

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function cleanMoney(actor: Entity): number {
  const money = actor.money ?? 0;
  return Number.isFinite(money) ? Math.max(0, Math.floor(money)) : 0;
}

function canUseHackCell(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  const cell = world.cells[idx];
  if (cell === Cell.DOOR || cell === Cell.LIFT || cell === Cell.ABYSS) return false;
  const feature = world.features[idx];
  return feature === Feature.NONE || feature === Feature.SCREEN || feature === Feature.APPARATUS;
}

function currentDef(): NetHackTerminalDef {
  return NET_HACK_TERMINALS[runtime.activeDefId] ?? NET_HACK_TERMINALS.service_gate;
}

function currentFloorKey(state: GameState): string {
  try {
    return floorRunEntryFloorKey(currentFloorRunEntry(state));
  } catch {
    return floorKeyForStory(state.currentFloor);
  }
}

function terminalKey(state: GameState, terminalIdx: number): string {
  return `${currentFloorKey(state)}:${terminalIdx}`;
}

function cleanTerminalKey(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, NET_HACK_KEY_LEN_CAP);
}

function cleanSaveTime(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return Math.max(0, Math.min(10_000_000, Math.floor(n)));
}

function terminalRandom(def: NetHackTerminalDef, terminal: NetHackTerminal): number {
  return (terminal.seed >>> 0) % (def.randomDifficultyMax + 1);
}

function floorDanger(world: World, state: GameState, terminal: NetHackTerminal): number {
  const zone = world.zones[world.zoneMap[terminal.idx]];
  const zoneDanger = zone?.level ?? 1;
  return zoneDanger + state.currentFloor * 2 + (state.samosborActive ? 3 : 0);
}

function currentTerminal(): NetHackTerminal | undefined {
  return netHackRegistry.get(runtime.terminalIdx);
}

export function netHackDifficultyTotal(input: NetHackDifficulty): number {
  return input.baseDifficulty + input.floorDangerOrZ + input.terminalRandom;
}

export function netHackSkill(level: number, int: number): number {
  return Math.max(0, Math.floor(level)) * 2 + Math.max(0, Math.floor(int)) * 3;
}

export function netHackChance(input: NetHackChanceInput): number {
  const difficulty = netHackDifficultyTotal(input);
  const skill = netHackSkill(input.level, input.int);
  return clamp(0.08, 0.92, 0.45 + (skill - difficulty) * 0.035);
}

export function clearNetHackTerminals(): void {
  netHackRegistry.clear();
}

export function resetNetHackState(): void {
  solvedKeys.clear();
  lockedUntil.clear();
  closeNetHackTerminal();
}

export function netHackStateForSave(): NetHackSaveState | undefined {
  if (solvedKeys.size === 0 && lockedUntil.size === 0) return undefined;
  const locks: Array<[string, number]> = [];
  for (const [key, until] of lockedUntil) {
    if (locks.length >= NET_HACK_LOCK_CAP) break;
    if (until > 0) locks.push([key, cleanSaveTime(until)]);
  }
  return {
    version: NET_HACK_SAVE_VERSION,
    solvedKeys: [...solvedKeys].slice(-NET_HACK_SOLVED_KEY_CAP),
    lockedUntil: locks,
  };
}

export function restoreNetHackFromSave(input: unknown): void {
  solvedKeys.clear();
  lockedUntil.clear();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const raw = input as { version?: unknown; solvedKeys?: unknown; lockedUntil?: unknown };
  if (raw.version !== NET_HACK_SAVE_VERSION) return;
  if (Array.isArray(raw.solvedKeys)) {
    for (const item of raw.solvedKeys) {
      if (solvedKeys.size >= NET_HACK_SOLVED_KEY_CAP) break;
      const key = cleanTerminalKey(item);
      if (key) solvedKeys.add(key);
    }
  }
  if (Array.isArray(raw.lockedUntil)) {
    for (const item of raw.lockedUntil) {
      if (lockedUntil.size >= NET_HACK_LOCK_CAP) break;
      if (!Array.isArray(item) || item.length < 2) continue;
      const key = cleanTerminalKey(item[0]);
      const until = cleanSaveTime(item[1]);
      if (key && until > 0) lockedUntil.set(key, until);
    }
  }
}

export function getNetHackTerminalAt(world: World, x: number, y: number): NetHackTerminal | undefined {
  return netHackRegistry.get(world.idx(Math.floor(x), Math.floor(y)));
}

export function isNetHackTerminalTarget(world: World, x: number, y: number): boolean {
  return !!getNetHackTerminalAt(world, x, y);
}

export function placeNetHackTerminal(world: World, x: number, y: number, defId: NetHackTerminalDefId): NetHackTerminal | null {
  const def = getNetHackTerminalDef(defId);
  if (!def) return null;
  const idx = world.idx(x, y);
  if (!canUseHackCell(world, idx)) return null;
  world.setFeatureAt(idx, Feature.APPARATUS);
  const terminal: NetHackTerminal = {
    idx,
    x: idx % W,
    y: (idx / W) | 0,
    defId: def.id,
    seed: ((idx + 1) * 2654435761) >>> 0,
  };
  netHackRegistry.set(idx, terminal);
  return terminal;
}

export function openNetHackTerminal(state: GameState, terminal: NetHackTerminal): void {
  runtime.open = true;
  runtime.terminalIdx = terminal.idx;
  runtime.activeDefId = terminal.defId;
  runtime.message = '';
  state.paused = true;
}

export function closeNetHackTerminal(): void {
  runtime.open = false;
  runtime.terminalIdx = -1;
  runtime.message = '';
}

export function isNetHackOverlayOpen(): boolean {
  return runtime.open;
}

export function getNetHackOverlaySnapshot(world: World, state: GameState, player: Entity): NetHackOverlaySnapshot {
  const terminal = currentTerminal();
  const def = currentDef();
  const difficultyInput = terminal
    ? {
      baseDifficulty: def.baseDifficulty,
      floorDangerOrZ: floorDanger(world, state, terminal),
      terminalRandom: terminalRandom(def, terminal),
    }
    : { baseDifficulty: def.baseDifficulty, floorDangerOrZ: 0, terminalRandom: 0 };
  const level = player.rpg?.level ?? 1;
  const int = player.rpg?.int ?? 1;
  const chance = netHackChance({ ...difficultyInput, level, int });
  const key = terminalKey(state, runtime.terminalIdx);
  return {
    open: runtime.open,
    terminalIdx: runtime.terminalIdx,
    label: def.label,
    chance,
    chancePercent: Math.round(chance * 100),
    difficulty: netHackDifficultyTotal(difficultyInput),
    skill: netHackSkill(level, int),
    locked: (lockedUntil.get(key) ?? 0) > state.time,
    solved: solvedKeys.has(key),
    rewardRubles: def.rewardRubles,
    message: runtime.message,
  };
}

export function attemptNetHack(
  world: World,
  state: GameState,
  player: Entity,
  roll = Math.random(),
): boolean {
  const terminal = currentTerminal();
  const def = terminal ? getNetHackTerminalDef(terminal.defId) : undefined;
  if (!terminal || !def) {
    runtime.message = 'Шлюз исчез из локального списка.';
    return false;
  }

  const key = terminalKey(state, terminal.idx);
  const lock = lockedUntil.get(key) ?? 0;
  if (lock > state.time) {
    runtime.message = `Шлюз заблокирован еще ${Math.ceil(lock - state.time)} сек.`;
    state.msgs.push(msg(runtime.message, state.time, '#888'));
    return false;
  }
  if (solvedKeys.has(key)) {
    runtime.message = 'Доступ уже получен. Повторный взлом не нужен.';
    state.msgs.push(msg(runtime.message, state.time, '#8cf'));
    return true;
  }

  const level = player.rpg?.level ?? 1;
  const int = player.rpg?.int ?? 1;
  const chance = netHackChance({
    baseDifficulty: def.baseDifficulty,
    floorDangerOrZ: floorDanger(world, state, terminal),
    terminalRandom: terminalRandom(def, terminal),
    level,
    int,
  });
  const roomId = world.roomMap[terminal.idx];

  if (roll >= 0 && roll < chance) {
    solvedKeys.add(key);
    player.money = cleanMoney(player) + def.rewardRubles;
    runtime.message = `${def.label}: доступ открыт, +${def.rewardRubles} руб.`;
    publishEvent(state, {
      type: 'net_terminal_hacked',
      zoneId: world.zoneMap[terminal.idx],
      roomId: roomId >= 0 ? roomId : undefined,
      x: terminal.x + 0.5,
      y: terminal.y + 0.5,
      actorId: player.id,
      actorName: player.name,
      actorFaction: player.faction,
      itemValue: def.rewardRubles,
      severity: 4,
      privacy: 'local',
      tags: ['net', 'hack', 'success', def.id],
      data: { chance, rewardRubles: def.rewardRubles, terminalId: def.id },
    });
    state.msgs.push(msg(runtime.message, state.time, '#6cf'));
    return true;
  }

  lockedUntil.set(key, state.time + 55);
  if (player.rpg) player.rpg.psi = Math.max(0, player.rpg.psi - def.failPsiDamage);
  if (player.hp !== undefined) player.hp = Math.max(1, player.hp - def.failHpDamage);
  state.dmgFlash = Math.max(state.dmgFlash, 0.28);
  runtime.message = `${def.label}: отказ, ПСИ -${def.failPsiDamage}, сигнал поднят.`;
  publishEvent(state, {
    type: 'net_terminal_hack_failed',
    zoneId: world.zoneMap[terminal.idx],
    roomId: roomId >= 0 ? roomId : undefined,
    x: terminal.x + 0.5,
    y: terminal.y + 0.5,
    actorId: player.id,
    actorName: player.name,
    actorFaction: player.faction,
    severity: 4,
    privacy: 'local',
    tags: ['net', 'hack', 'failed', 'signal', def.id],
    data: {
      chance,
      psiDamage: def.failPsiDamage,
      hpDamage: def.failHpDamage,
      lockSeconds: 55,
      terminalId: def.id,
    },
  });
  state.msgs.push(msg(runtime.message, state.time, '#f84'));
  return false;
}
