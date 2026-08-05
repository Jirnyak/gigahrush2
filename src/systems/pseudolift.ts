/* ── Pseudolift: sparse readable lift mimic trap ─────────────── */

import {
  AIGoal,
  Cell,
  EntityType,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Tex,
  W,
  msg,
  type Entity,
  type GameState,
  type WorldEventType,
} from '../core/types';
import { World } from '../core/world';
import { hashSeed, randSeed, seededRandom } from '../core/rand';
import { designFloorPseudoliftChance } from '../data/design_floor_profiles';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { MarkType, stampMark } from './surface_marks';
import { publishEvent } from './events';
import { getActiveFloorInstance } from './floor_instances';
import {
  currentFloorRunEntry,
  floorRunEntryDanger,
  floorRunEntryKind,
  floorRunEntryRouteId,
} from './procedural_floors';
import { randomRPG } from './rpg';
import {
  clearDeadBaitDrop,
  consumeMonsterBaitMarker,
  getActiveMonsterBaits,
  type MonsterBaitMarker,
} from './monster_bait';

type PseudoliftStatus = 'dormant' | 'suspected' | 'revealed' | 'fed' | 'escaped' | 'cleared';

export interface PseudoliftSite {
  key: string;
  routeKey: string;
  routeKind: string;
  floor: FloorLevel;
  liftIdx: number;
  liftX: number;
  liftY: number;
  accessX: number;
  accessY: number;
  direction: LiftDirection;
  zoneId: number;
  roomId?: number;
  fakeFloorLabel: string;
  status: PseudoliftStatus;
  createdAt: number;
  suspectedAt?: number;
  revealedAt?: number;
  fedAt?: number;
  resolvedAt?: number;
  monsterId?: number;
}

export interface PseudoliftState {
  sites: Record<string, PseudoliftSite>;
  routeSites: Record<string, string>;
  preparedRouteKey: string;
  activeSiteKey?: string;
  suspectedCount: number;
  revealedCount: number;
  fedCount: number;
  escapedCount: number;
  clearedCount: number;
}

interface PseudoliftRouteCtx {
  routeKey: string;
  routeKind: string;
  chance: number;
  danger: number;
}

interface PseudoliftCandidate {
  liftIdx: number;
  liftX: number;
  liftY: number;
  accessX: number;
  accessY: number;
  direction: LiftDirection;
  zoneId: number;
  roomId?: number;
}

type PseudoliftHost = GameState & { pseudolift?: PseudoliftState };

const MAX_SAVED_PSEUDOLIFTS = 48;
const BAIT_RADIUS_SQ = 3.35 * 3.35;
const ESCAPE_RADIUS_SQ = 6.5 * 6.5;
const MONSTER_ANCHOR_RADIUS_SQ = 4.25 * 4.25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createPseudoliftState(): PseudoliftState {
  return {
    sites: {},
    routeSites: {},
    preparedRouteKey: '',
    suspectedCount: 0,
    revealedCount: 0,
    fedCount: 0,
    escapedCount: 0,
    clearedCount: 0,
  };
}

function cleanStatus(value: unknown): PseudoliftStatus {
  return value === 'suspected' || value === 'revealed' || value === 'fed' || value === 'escaped' || value === 'cleared'
    ? value
    : 'dormant';
}

function normalizeSite(input: unknown): PseudoliftSite | null {
  if (!isRecord(input) || typeof input.key !== 'string' || typeof input.routeKey !== 'string') return null;
  const liftIdx = Math.max(0, Math.min(W * W - 1, Math.floor(Number(input.liftIdx) || 0)));
  const direction = input.direction === LiftDirection.UP ? LiftDirection.UP : LiftDirection.DOWN;
  return {
    key: input.key.slice(0, 96),
    routeKey: input.routeKey.slice(0, 96),
    routeKind: typeof input.routeKind === 'string' ? input.routeKind.slice(0, 24) : 'route',
    floor: typeof input.floor === 'number' && FloorLevel[input.floor] !== undefined ? input.floor as FloorLevel : FloorLevel.LIVING,
    liftIdx,
    liftX: Math.max(0, Math.min(W - 1, Math.floor(Number(input.liftX) || liftIdx % W))),
    liftY: Math.max(0, Math.min(W - 1, Math.floor(Number(input.liftY) || ((liftIdx / W) | 0)))),
    accessX: Math.max(0, Math.min(W - 1, Math.floor(Number(input.accessX) || 0))),
    accessY: Math.max(0, Math.min(W - 1, Math.floor(Number(input.accessY) || 0))),
    direction,
    zoneId: Math.max(-1, Math.min(63, Math.floor(Number(input.zoneId) || -1))),
    roomId: typeof input.roomId === 'number' && Number.isFinite(input.roomId) ? Math.floor(input.roomId) : undefined,
    fakeFloorLabel: typeof input.fakeFloorLabel === 'string' ? input.fakeFloorLabel.slice(0, 12) : '0',
    status: cleanStatus(input.status),
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : 0,
    suspectedAt: typeof input.suspectedAt === 'number' ? input.suspectedAt : undefined,
    revealedAt: typeof input.revealedAt === 'number' ? input.revealedAt : undefined,
    fedAt: typeof input.fedAt === 'number' ? input.fedAt : undefined,
    resolvedAt: typeof input.resolvedAt === 'number' ? input.resolvedAt : undefined,
    monsterId: typeof input.monsterId === 'number' ? input.monsterId : undefined,
  };
}

export function normalizePseudoliftState(input: Partial<PseudoliftState> | null | undefined): PseudoliftState {
  const out = createPseudoliftState();
  if (!input) return out;
  out.preparedRouteKey = typeof input.preparedRouteKey === 'string' ? input.preparedRouteKey.slice(0, 96) : '';
  out.activeSiteKey = typeof input.activeSiteKey === 'string' ? input.activeSiteKey.slice(0, 96) : undefined;
  out.suspectedCount = Math.max(0, Math.floor(input.suspectedCount ?? 0));
  out.revealedCount = Math.max(0, Math.floor(input.revealedCount ?? 0));
  out.fedCount = Math.max(0, Math.floor(input.fedCount ?? 0));
  out.escapedCount = Math.max(0, Math.floor(input.escapedCount ?? 0));
  out.clearedCount = Math.max(0, Math.floor(input.clearedCount ?? 0));

  let saved = 0;
  const sites = input.sites ?? {};
  for (const raw of Object.values(sites)) {
    if (saved >= MAX_SAVED_PSEUDOLIFTS) break;
    const site = normalizeSite(raw);
    if (!site) continue;
    out.sites[site.key] = site;
    out.routeSites[site.routeKey] = site.key;
    saved++;
  }
  const routeSites = input.routeSites ?? {};
  for (const [routeKey, siteKey] of Object.entries(routeSites)) {
    if (typeof siteKey === 'string' && out.sites[siteKey]) out.routeSites[routeKey.slice(0, 96)] = siteKey;
  }
  return out;
}

export function ensurePseudoliftState(state: GameState): PseudoliftState {
  const host = state as PseudoliftHost;
  host.pseudolift = normalizePseudoliftState(host.pseudolift);
  return host.pseudolift;
}

export function setPseudoliftState(
  state: GameState,
  input: Partial<PseudoliftState> | null | undefined,
): PseudoliftState {
  const normalized = normalizePseudoliftState(input);
  (state as PseudoliftHost).pseudolift = normalized;
  return normalized;
}

export function pseudoliftStateForSave(state: GameState): PseudoliftState {
  return normalizePseudoliftState((state as PseudoliftHost).pseudolift);
}

function routeCtx(state: GameState): PseudoliftRouteCtx {
  const activeInstance = getActiveFloorInstance(state);
  const entry = currentFloorRunEntry(state);
  if (activeInstance) {
    const danger = Math.max(1, Math.min(5, Math.round(activeInstance.risk)));
    return {
      routeKey: `instance:${activeInstance.id}:${activeInstance.seed}`,
      routeKind: 'instance',
      chance: Math.min(0.24, 0.08 + danger * 0.025 + Math.min(4, state.samosborCount) * 0.012),
      danger,
    };
  }

  const routeId = floorRunEntryRouteId(entry);
  const danger = floorRunEntryDanger(entry);
  if (entry.spec) {
    const anomalyBonus = entry.spec.anomalyId === 'samosbor_seed' || entry.spec.anomalyId === 'smog' || entry.spec.anomalyId === 'rail_trains' ? 0.035 : 0;
    return {
      routeKey: `proc:${entry.spec.key}:${entry.spec.seed}`,
      routeKind: 'procedural',
      chance: Math.min(0.16, 0.025 + danger * 0.012 + anomalyBonus + Math.min(3, state.samosborCount) * 0.006),
      danger,
    };
  }
  const designChance = designFloorPseudoliftChance(entry.designFloorId);
  if (designChance > 0) {
    return {
      routeKey: `design:${entry.designFloorId}`,
      routeKind: 'design',
      chance: designChance,
      danger,
    };
  }
  return {
    routeKey: `${floorRunEntryKind(entry)}:${routeId}`,
    routeKind: floorRunEntryKind(entry),
    chance: 0,
    danger,
  };
}

function passable(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return (cell === Cell.FLOOR || cell === Cell.WATER) && !world.solid(x, y);
}

function liftAccess(world: World, liftX: number, liftY: number): { x: number; y: number } | null {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const [dx, dy] of dirs) {
    const x = world.wrap(liftX + dx);
    const y = world.wrap(liftY + dy);
    if (passable(world, x, y)) return { x, y };
  }
  return null;
}

export function choosePseudoliftCandidate(world: World, seed: number): PseudoliftCandidate | null {
  const candidates: PseudoliftCandidate[] = [];
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const liftX = i % W;
    const liftY = (i / W) | 0;
    const access = liftAccess(world, liftX, liftY);
    if (!access) continue;
    const roomId = world.roomMap[i];
    candidates.push({
      liftIdx: i,
      liftX,
      liftY,
      accessX: access.x,
      accessY: access.y,
      direction: world.liftDir[i] === LiftDirection.UP ? LiftDirection.UP : LiftDirection.DOWN,
      zoneId: world.zoneMap[i],
      roomId: roomId >= 0 ? roomId : undefined,
    });
  }
  if (candidates.length < 2) return null;
  const rng = seededRandom(seed);
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

function fakeFloorLabel(seed: number, direction: LiftDirection): string {
  const rng = seededRandom(seed ^ 0x51f7);
  if (rng() < 0.2) return direction === LiftDirection.DOWN ? 'ВВЕРХ' : 'ВНИЗ';
  if (rng() < 0.45) return `${rng() < 0.5 ? '-' : '+'}${Math.floor(7 + rng() * 82)}`;
  return rng() < 0.5 ? 'СБ' : '0?';
}

function makeSite(state: GameState, route: PseudoliftRouteCtx, candidate: PseudoliftCandidate, seed: number): PseudoliftSite {
  const key = `pseudolift:${route.routeKey}:${candidate.liftIdx}`;
  return {
    key,
    routeKey: route.routeKey,
    routeKind: route.routeKind,
    floor: state.currentFloor,
    liftIdx: candidate.liftIdx,
    liftX: candidate.liftX,
    liftY: candidate.liftY,
    accessX: candidate.accessX,
    accessY: candidate.accessY,
    direction: candidate.direction,
    zoneId: candidate.zoneId,
    roomId: candidate.roomId,
    fakeFloorLabel: fakeFloorLabel(seed, candidate.direction),
    status: 'dormant',
    createdAt: state.time,
  };
}

function stampPseudoliftCue(world: World, site: PseudoliftSite, red = false): void {
  const seed = hashSeed(site.key, Math.floor(site.createdAt * 1000) ^ randSeed());
  stampMark(world, site.accessX, site.accessY, 0.5, 0.5, red ? 0.5 : 0.28, red ? MarkType.SPLAT : MarkType.DRIP, seed, red ? 100 : 70, red ? 14 : 52, red ? 18 : 44, red ? 130 : 92);
}

function currentSite(state: GameState): PseudoliftSite | null {
  const store = ensurePseudoliftState(state);
  const route = routeCtx(state);
  const siteKey = store.routeSites[route.routeKey];
  return siteKey ? store.sites[siteKey] ?? null : null;
}

export function preparePseudoliftForCurrentFloor(world: World, state: GameState): PseudoliftSite | null {
  const store = ensurePseudoliftState(state);
  const route = routeCtx(state);
  if (store.preparedRouteKey === route.routeKey) {
    const site = currentSite(state);
    if (site && (site.status === 'dormant' || site.status === 'suspected')) stampPseudoliftCue(world, site);
    return site;
  }
  store.preparedRouteKey = route.routeKey;

  const existingKey = store.routeSites[route.routeKey];
  if (existingKey) {
    const existing = store.sites[existingKey];
    if (existing) {
      if (existing.status === 'dormant' || existing.status === 'suspected') stampPseudoliftCue(world, existing);
      return existing;
    }
  }
  if (route.chance <= 0) return null;

  const seed = hashSeed(`pseudolift:${route.routeKey}`, state.samosborCount * 97 + route.danger * 17);
  if (seededRandom(seed)() >= route.chance) return null;
  const candidate = choosePseudoliftCandidate(world, seed);
  if (!candidate) return null;

  const site = makeSite(state, route, candidate, seed);
  store.sites[site.key] = site;
  store.routeSites[route.routeKey] = site.key;
  stampPseudoliftCue(world, site);
  return site;
}

function targetSite(world: World, state: GameState, lookX: number, lookY: number): PseudoliftSite | null {
  const site = currentSite(state);
  if (!site || site.floor !== state.currentFloor) return null;
  if (site.status !== 'dormant' && site.status !== 'suspected' && site.status !== 'revealed') return null;
  const x = Math.floor(lookX);
  const y = Math.floor(lookY);
  const idx = world.idx(x, y);
  if (idx === site.liftIdx) return site;
  return null;
}

export function pseudoliftPrompt(world: World, state: GameState, lookX: number, lookY: number): string | null {
  const site = targetSite(world, state, lookX, lookY);
  if (!site) return null;
  if (site.status === 'revealed') return ' псевдолифт: отойти из тамбура';
  if (site.status === 'suspected') return ` ! табло ${site.fakeFloorLabel}: рискнуть`;
  return ` ? лифт: табло ${site.fakeFloorLabel}, мокрый порог`;
}

function publishPseudoliftEvent(
  state: GameState,
  site: PseudoliftSite,
  type: WorldEventType,
  severity: 3 | 4,
  outcome: string,
  marker?: MonsterBaitMarker,
): void {
  publishEvent(state, {
    type,
    zoneId: site.zoneId >= 0 ? site.zoneId : undefined,
    roomId: site.roomId,
    x: site.liftX + 0.5,
    y: site.liftY + 0.5,
    targetId: site.monsterId,
    targetName: 'Псевдолифт',
    monsterKind: MonsterKind.PSEUDOLIFT,
    itemId: marker?.itemId,
    itemName: marker?.itemName,
    itemCount: marker?.itemCount,
    itemValue: marker?.itemValue,
    severity,
    privacy: 'local',
    tags: ['lift', 'pseudolift', outcome, site.routeKind],
    data: {
      key: site.key,
      routeKey: site.routeKey,
      routeKind: site.routeKind,
      direction: site.direction === LiftDirection.UP ? 'up' : 'down',
      fakeFloorLabel: site.fakeFloorLabel,
      liftX: site.liftX,
      liftY: site.liftY,
      status: site.status,
      outcome,
      baitId: marker?.id,
      baitKind: marker?.kind,
    },
  });
}

function suspectPseudolift(state: GameState, world: World, site: PseudoliftSite): void {
  site.status = 'suspected';
  site.suspectedAt = state.time;
  ensurePseudoliftState(state).suspectedCount++;
  stampPseudoliftCue(world, site);
  state.msgs.push(msg(`Лифт не сходится: на табло "${site.fakeFloorLabel}", щель дышит сыростью. Можно отойти или бросить приманку.`, state.time, '#fc4'));
  publishPseudoliftEvent(state, site, 'pseudolift_suspected', 3, 'inspected');
}

function findRevealSpot(world: World, player: Entity, site: PseudoliftSite): { x: number; y: number } {
  if (passable(world, site.accessX, site.accessY)) return { x: site.accessX + 0.5, y: site.accessY + 0.5 };
  return { x: player.x, y: player.y };
}

function revealPseudolift(world: World, entities: Entity[], player: Entity, state: GameState, nextId: { v: number }, site: PseudoliftSite): void {
  const def = MONSTERS[MonsterKind.PSEUDOLIFT];
  const spot = findRevealSpot(world, player, site);
  const level = Math.max(2, Math.min(7, (player.rpg?.level ?? 1) + 1));
  const hp = def.hp + Math.max(0, level - 2) * 10;
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: spot.x,
    y: spot.y,
    angle: Math.atan2(player.y - spot.y, player.x - spot.x),
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(MonsterKind.PSEUDOLIFT),
    hp,
    maxHp: hp,
    name: 'Псевдолифт',
    monsterKind: MonsterKind.PSEUDOLIFT,
    attackCd: 0,
    spriteScale: 1.25,
    ai: {
      goal: AIGoal.HUNT,
      tx: Math.floor(player.x),
      ty: Math.floor(player.y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
      combatTargetId: player.id,
    },
    rpg: randomRPG(level),
  };
  entities.push(monster);
  site.status = 'revealed';
  site.revealedAt = state.time;
  site.monsterId = monster.id;
  const store = ensurePseudoliftState(state);
  store.activeSiteKey = site.key;
  store.revealedCount++;
  stampPseudoliftCue(world, site, true);
  state.msgs.push(msg('Кабина раскрылась мясной шахтой. Держите порог или отступайте из лифтового тамбура.', state.time, '#f44'));
  publishPseudoliftEvent(state, site, 'pseudolift_revealed', 4, 'entered');
}

export function tryUsePseudolift(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const site = targetSite(world, state, lookX, lookY);
  if (!site) return false;
  if (site.status === 'dormant') {
    suspectPseudolift(state, world, site);
    return true;
  }
  if (site.status === 'suspected') {
    revealPseudolift(world, entities, player, state, nextId, site);
    return true;
  }
  state.msgs.push(msg('Пасть лифта держит порог. Отойдите из тамбура, чтобы она захлопнулась.', state.time, '#f84'));
  return true;
}

function feedPseudolift(world: World, entities: Entity[], state: GameState, site: PseudoliftSite, marker: MonsterBaitMarker): void {
  const entityId = consumeMonsterBaitMarker(state, marker, state.time, 'pseudolift_fed');
  if (entityId !== undefined) {
    const drop = entities.find(e => e.id === entityId);
    if (drop) clearDeadBaitDrop(drop);
  }
  site.status = 'fed';
  site.fedAt = state.time;
  site.resolvedAt = state.time;
  const store = ensurePseudoliftState(state);
  store.fedCount++;
  if (store.activeSiteKey === site.key) store.activeSiteKey = undefined;
  stampPseudoliftCue(world, site, true);
  state.msgs.push(msg(`Псевдолифт захлопнулся на ${marker.itemName}. Кабина обмякла, маршрут снова честный.`, state.time, '#8cf'));
  publishPseudoliftEvent(state, site, 'pseudolift_fed', 3, 'baited', marker);
}

function consumeNearbyBait(world: World, entities: Entity[], state: GameState, site: PseudoliftSite): boolean {
  if (site.status !== 'dormant' && site.status !== 'suspected') return false;
  for (const marker of getActiveMonsterBaits()) {
    if (marker.floor !== state.currentFloor || marker.expiresAt <= state.time) continue;
    if (world.dist2(marker.x, marker.y, site.liftX + 0.5, site.liftY + 0.5) > BAIT_RADIUS_SQ) continue;
    feedPseudolift(world, entities, state, site, marker);
    return true;
  }
  return false;
}

function resolveRevealed(world: World, state: GameState, site: PseudoliftSite, status: 'escaped' | 'cleared', text: string, color: string): void {
  site.status = status;
  site.resolvedAt = state.time;
  site.monsterId = undefined;
  const store = ensurePseudoliftState(state);
  if (status === 'escaped') store.escapedCount++;
  else store.clearedCount++;
  if (store.activeSiteKey === site.key) store.activeSiteKey = undefined;
  stampPseudoliftCue(world, site, status === 'cleared');
  state.msgs.push(msg(text, state.time, color));
  publishPseudoliftEvent(state, site, status === 'cleared' ? 'pseudolift_revealed' : 'monster_escaped', status === 'cleared' ? 4 : 3, status);
}

function killActivePseudoliftMonster(site: PseudoliftSite, entities: Entity[] | undefined): void {
  if (!entities || site.monsterId === undefined) return;
  const monster = entities.find(e => e.id === site.monsterId && e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.PSEUDOLIFT);
  if (!monster) return;
  monster.alive = false;
  monster.hp = 0;
}

export function clearPseudoliftActive(state: GameState, entities?: Entity[]): void {
  const store = ensurePseudoliftState(state);
  if (!store.activeSiteKey) return;
  const site = store.sites[store.activeSiteKey];
  if (site?.status === 'revealed') {
    killActivePseudoliftMonster(site, entities);
    site.status = 'escaped';
    site.resolvedAt = state.time;
    site.monsterId = undefined;
  }
  store.activeSiteKey = undefined;
}

export function updatePseudolifts(world: World, entities: Entity[], player: Entity, state: GameState): void {
  const site = currentSite(state);
  if (!site || site.floor !== state.currentFloor) return;
  if (consumeNearbyBait(world, entities, state, site)) return;
  if (site.status !== 'revealed') return;

  const monster = site.monsterId !== undefined ? entities.find(e => e.id === site.monsterId) : undefined;
  if (!monster || !monster.alive) {
    resolveRevealed(world, state, site, 'cleared', 'Псевдолифт осел в шахту. Двери снова стали дверями.', '#4f4');
    return;
  }

  const playerD2 = world.dist2(player.x, player.y, site.liftX + 0.5, site.liftY + 0.5);
  const monsterD2 = world.dist2(monster.x, monster.y, site.liftX + 0.5, site.liftY + 0.5);
  if (playerD2 > ESCAPE_RADIUS_SQ || monsterD2 > MONSTER_ANCHOR_RADIUS_SQ) {
    monster.alive = false;
    resolveRevealed(world, state, site, 'escaped', 'Вы вышли из лифтового тамбура. Псевдолифт захлопнулся и притворился обычной кабиной.', '#8cf');
    return;
  }

  if (monster.ai) {
    monster.ai.goal = AIGoal.HUNT;
    monster.ai.combatTargetId = player.id;
    monster.ai.tx = Math.floor(player.x);
    monster.ai.ty = Math.floor(player.y);
  }
}

export function debugForcePseudoliftNearPlayer(world: World, player: Entity, state: GameState): string[] {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  let liftIdx = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const lx = i % W;
    const ly = (i / W) | 0;
    const access = liftAccess(world, lx, ly);
    if (!access) continue;
    const d2 = world.dist2(player.x, player.y, lx + 0.5, ly + 0.5);
    if (d2 < bestD2) {
      bestD2 = d2;
      liftIdx = i;
    }
  }

  let madeFake = false;
  if (liftIdx < 0 || bestD2 > 12 * 12) {
    const lx = world.wrap(Math.floor(player.x + Math.cos(player.angle) * 2));
    const ly = world.wrap(Math.floor(player.y + Math.sin(player.angle) * 2));
    liftIdx = world.idx(lx, ly);
    world.cells[liftIdx] = Cell.LIFT;
    world.wallTex[liftIdx] = Tex.LIFT_DOOR;
    world.liftDir[liftIdx] = LiftDirection.DOWN;
    world.markCellsDirty();
    world.markWallTexDirty();
    madeFake = true;
  }

  const lx = liftIdx % W;
  const ly = (liftIdx / W) | 0;
  const access = liftAccess(world, lx, ly) ?? { x: px, y: py };
  const route = routeCtx(state);
  const site = makeSite(state, route, {
    liftIdx,
    liftX: lx,
    liftY: ly,
    accessX: access.x,
    accessY: access.y,
    direction: world.liftDir[liftIdx] === LiftDirection.UP ? LiftDirection.UP : LiftDirection.DOWN,
    zoneId: world.zoneMap[liftIdx],
    roomId: world.roomMap[liftIdx] >= 0 ? world.roomMap[liftIdx] : undefined,
  }, hashSeed(`debug:${state.tick}`, liftIdx));
  const store = ensurePseudoliftState(state);
  store.sites[site.key] = site;
  store.routeSites[route.routeKey] = site.key;
  store.preparedRouteKey = route.routeKey;
  store.activeSiteKey = undefined;
  stampPseudoliftCue(world, site);
  return [
    `pseudolift=${site.liftX},${site.liftY} route=${route.routeKey}`,
    madeFake ? 'fake lift marker placed near player' : 'nearest existing lift armed',
    `cue=табло ${site.fakeFloorLabel}, bait radius=${Math.sqrt(BAIT_RADIUS_SQ).toFixed(1)}`,
  ];
}

export function pseudoliftDebugSummary(state: GameState): string[] {
  const store = ensurePseudoliftState(state);
  const active = store.activeSiteKey ? store.sites[store.activeSiteKey] : undefined;
  return [
    `sites=${Object.keys(store.sites).length}/${MAX_SAVED_PSEUDOLIFTS} prepared=${store.preparedRouteKey || 'none'}`,
    `suspected=${store.suspectedCount} revealed=${store.revealedCount} fed=${store.fedCount} escaped=${store.escapedCount} cleared=${store.clearedCount}`,
    active ? `active=${entityDisplayName({ monsterKind: MonsterKind.PSEUDOLIFT })} ${active.status} ${active.liftX},${active.liftY}` : 'active=none',
  ];
}
