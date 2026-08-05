/* ── Bounded sparse cell hazards ──────────────────────────────── */

import {
  W, AIGoal, EntityType, msg,
  type Entity, type GameState, type WorldEventSeverity,
} from '../core/types';
import { World } from '../core/world';
import { recordPlayerDamage } from './damage';
import { ENTITY_MASK_ACTOR, getEntityIndex } from './entity_index';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

export type CellHazardCleanReason = 'fire' | 'solvent' | 'tool' | 'debug';

export interface CellHazardSiteDraft {
  id: string;
  kind: string;
  displayName: string;
  cells: readonly number[];
  tags?: readonly string[];
  sticky?: boolean;
  cleanable?: boolean;
  slowMult?: number;
  trappedMult?: number;
  stickAfter?: number;
  escapeSeconds?: number;
  npcEscapeSeconds?: number;
  pulsePeriodSeconds?: number;
  pulseActiveSeconds?: number;
  pulseOffsetSeconds?: number;
  activeFog?: number;
  inactiveFog?: number;
  playerDamagePerSecond?: number;
  monsterDamagePerSecond?: number;
  messageCooldownSeconds?: number;
  expiresAt?: number;
  roomId?: number;
  zoneId?: number;
  centerX?: number;
  centerY?: number;
  warning?: string;
  inactiveWarning?: string;
  warningColor?: string;
}

interface CellHazardSite {
  id: string;
  kind: string;
  displayName: string;
  tags: string[];
  cells: number[];
  activeCells: Set<number>;
  sticky: boolean;
  cleanable: boolean;
  slowMult: number;
  trappedMult: number;
  stickAfter: number;
  escapeSeconds: number;
  npcEscapeSeconds: number;
  pulsePeriodSeconds: number;
  pulseActiveSeconds: number;
  pulseOffsetSeconds: number;
  pulseActive: boolean;
  activeFog: number;
  inactiveFog: number;
  playerDamagePerSecond: number;
  monsterDamagePerSecond: number;
  messageCooldownSeconds: number;
  expiresAt: number;
  lastPulseMessageAt: number;
  lastMonsterHitMessageAt: number;
  roomId?: number;
  zoneId?: number;
  centerX: number;
  centerY: number;
  queryRadius: number;
  warning: string;
  inactiveWarning: string;
  warningColor: string;
}

interface HazardSubjectState {
  hazardId: string;
  timeIn: number;
  trapped: boolean;
  escapeProgress: number;
  escapedUntil: number;
  damageCarry: number;
  lastDamageMessageAt: number;
}

interface CellHazardRuntime {
  sites: CellHazardSite[];
  byCell: Map<number, CellHazardSite[]>;
  allByCell: Map<number, CellHazardSite[]>;
  subjects: Map<number, HazardSubjectState>;
  npcScanAccum: number;
}

export interface CellHazardWarning {
  title: string;
  detail: string;
  color: string;
  trapped: boolean;
  critical: boolean;
}

const runtimes = new WeakMap<World, CellHazardRuntime>();
const NPC_HAZARD_SCAN_INTERVAL = 0.25;
const MONSTER_HAZARD_DAMAGE_CAP = 12;
const HAZARD_MESSAGE_RADIUS2 = 18 * 18;
const HAZARD_ACTOR_SCAN_CAP_PER_SITE = 160;
const HAZARD_ACTOR_SCAN_CAP_TOTAL = 384;
const HAZARD_BUCKET_STALE_PAD = 18;
const hazardActorQuery: Entity[] = [];
const hazardActorSeen = new Set<number>();

function ensureRuntime(world: World): CellHazardRuntime {
  let runtime = runtimes.get(world);
  if (!runtime) {
    runtime = { sites: [], byCell: new Map(), allByCell: new Map(), subjects: new Map(), npcScanAccum: 0 };
    runtimes.set(world, runtime);
  }
  return runtime;
}

function clampMult(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0.05, Math.min(1, value ?? fallback));
}

function clampNonNegative(value: number | undefined, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value ?? fallback);
}

function clampFog(value: number | undefined): number {
  if (!Number.isFinite(value)) return -1;
  return Math.max(0, Math.min(255, Math.floor(value ?? -1)));
}

function normalizeCells(cells: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of cells) {
    const cell = Math.floor(raw);
    if (!Number.isFinite(cell) || cell < 0 || cell >= W * W || seen.has(cell)) continue;
    seen.add(cell);
    out.push(cell);
  }
  return out;
}

function siteCenter(cells: readonly number[]): { x: number; y: number } {
  if (cells.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const cell of cells) {
    sx += cell % W;
    sy += (cell / W) | 0;
  }
  return { x: sx / cells.length + 0.5, y: sy / cells.length + 0.5 };
}

function siteQueryRadius(cells: readonly number[], center: { x: number; y: number }): number {
  let maxD2 = 1;
  for (const cell of cells) {
    const x = cell % W + 0.5;
    const y = ((cell / W) | 0) + 0.5;
    const dx = x - center.x;
    const dy = y - center.y;
    maxD2 = Math.max(maxD2, dx * dx + dy * dy);
  }
  return Math.min(96, Math.sqrt(maxD2) + HAZARD_BUCKET_STALE_PAD);
}

function pulseActiveAt(site: Pick<CellHazardSite, 'pulsePeriodSeconds' | 'pulseActiveSeconds' | 'pulseOffsetSeconds'>, time: number): boolean {
  if (site.pulsePeriodSeconds <= 0) return true;
  const raw = (time - site.pulseOffsetSeconds) % site.pulsePeriodSeconds;
  const phase = raw < 0 ? raw + site.pulsePeriodSeconds : raw;
  return phase < site.pulseActiveSeconds;
}

function setPulseActive(site: CellHazardSite, active: boolean): boolean {
  if (site.pulseActive === active) return false;
  site.pulseActive = active;
  site.activeCells.clear();
  if (active) {
    for (const cell of site.cells) site.activeCells.add(cell);
  }
  return true;
}

function applyPulseFog(world: World, site: CellHazardSite): boolean {
  const fog = site.pulseActive ? site.activeFog : site.inactiveFog;
  if (fog < 0) return false;
  let dirty = false;
  for (const cell of site.cells) {
    if (world.fog[cell] === fog) continue;
    world.fog[cell] = fog;
    dirty = true;
  }
  return dirty;
}

function normalizeSite(draft: CellHazardSiteDraft): CellHazardSite | null {
  const cells = normalizeCells(draft.cells);
  if (cells.length === 0) return null;
  const center = siteCenter(cells);
  const centerX = draft.centerX ?? center.x;
  const centerY = draft.centerY ?? center.y;
  const pulsePeriodSeconds = Math.max(0, draft.pulsePeriodSeconds ?? 0);
  const pulseActiveSeconds = pulsePeriodSeconds > 0
    ? Math.max(0.1, Math.min(pulsePeriodSeconds, draft.pulseActiveSeconds ?? pulsePeriodSeconds * 0.5))
    : 0;
  const site: CellHazardSite = {
    id: draft.id,
    kind: draft.kind,
    displayName: draft.displayName,
    tags: [...(draft.tags ?? [])],
    cells,
    activeCells: new Set(cells),
    sticky: draft.sticky ?? true,
    cleanable: draft.cleanable ?? true,
    slowMult: clampMult(draft.slowMult, 0.45),
    trappedMult: clampMult(draft.trappedMult, 0.12),
    stickAfter: Math.max(0.1, draft.stickAfter ?? 0.7),
    escapeSeconds: Math.max(0.5, draft.escapeSeconds ?? 2.4),
    npcEscapeSeconds: Math.max(0.5, draft.npcEscapeSeconds ?? 4.5),
    pulsePeriodSeconds,
    pulseActiveSeconds,
    pulseOffsetSeconds: Math.max(0, draft.pulseOffsetSeconds ?? 0),
    pulseActive: true,
    activeFog: clampFog(draft.activeFog),
    inactiveFog: clampFog(draft.inactiveFog),
    playerDamagePerSecond: clampNonNegative(draft.playerDamagePerSecond),
    monsterDamagePerSecond: clampNonNegative(draft.monsterDamagePerSecond),
    messageCooldownSeconds: Math.max(0.5, draft.messageCooldownSeconds ?? 2.5),
    expiresAt: Number.isFinite(draft.expiresAt) ? Math.max(0, draft.expiresAt ?? 0) : 0,
    lastPulseMessageAt: -Infinity,
    lastMonsterHitMessageAt: -Infinity,
    roomId: draft.roomId,
    zoneId: draft.zoneId,
    centerX,
    centerY,
    queryRadius: siteQueryRadius(cells, { x: centerX, y: centerY }),
    warning: draft.warning ?? 'Красная слизь держит ноги. Обойдите, выжгите или чистите комплектом.',
    inactiveWarning: draft.inactiveWarning ?? 'Опасный такт стих. Проход открыт ненадолго.',
    warningColor: draft.warningColor ?? '#c22',
  };
  if (pulsePeriodSeconds > 0) setPulseActive(site, pulseActiveAt(site, 0));
  return site;
}

function cloneSite(site: CellHazardSite): CellHazardSite {
  return {
    ...site,
    tags: [...site.tags],
    cells: [...site.cells],
    activeCells: new Set(site.activeCells),
  };
}

function addIndexedSite(map: Map<number, CellHazardSite[]>, cell: number, site: CellHazardSite): void {
  const list = map.get(cell);
  if (list) list.push(site);
  else map.set(cell, [site]);
}

function rebuildCellIndex(runtime: CellHazardRuntime): void {
  runtime.byCell.clear();
  runtime.allByCell.clear();
  for (const site of runtime.sites) {
    for (const cell of site.cells) addIndexedSite(runtime.allByCell, cell, site);
    for (const cell of site.activeCells) addIndexedSite(runtime.byCell, cell, site);
  }
}

function activeHazardAt(runtime: CellHazardRuntime, cell: number): CellHazardSite | null {
  const sites = runtime.byCell.get(cell);
  if (!sites) return null;
  let best: CellHazardSite | null = null;
  let bestMult = 1;
  for (const site of sites) {
    if (!site.activeCells.has(cell)) continue;
    if (site.slowMult < bestMult) {
      best = site;
      bestMult = site.slowMult;
    }
  }
  return best;
}

function inactivePulseHazardAt(runtime: CellHazardRuntime, cell: number): CellHazardSite | null {
  const sites = runtime.allByCell.get(cell);
  if (!sites) return null;
  for (const site of sites) {
    if (site.pulsePeriodSeconds > 0 && !site.pulseActive && site.cells.length > 0) return site;
  }
  return null;
}

function hazardAtEntity(world: World, e: Entity): { site: CellHazardSite; cell: number } | null {
  const runtime = runtimes.get(world);
  if (!runtime) return null;
  const cell = world.idx(Math.floor(e.x), Math.floor(e.y));
  const site = activeHazardAt(runtime, cell);
  return site ? { site, cell } : null;
}

function subjectName(e: Entity): string {
  if (e.name) return e.name;
  if (isPlayerEntity(e)) return 'Вы';
  return e.type === EntityType.NPC ? 'Жилец' : 'Существо';
}

function hazardTags(site: CellHazardSite): string[] {
  const tags = ['hazard', site.kind];
  for (const tag of site.tags) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

function publishHazardEvent(
  state: GameState,
  type: 'hazard_trapped' | 'hazard_escaped' | 'hazard_cleaned',
  site: CellHazardSite,
  severity: WorldEventSeverity,
  actor?: Entity,
  data?: Record<string, unknown>,
): void {
  publishEvent(state, {
    type,
    zoneId: site.zoneId,
    roomId: site.roomId,
    x: site.centerX,
    y: site.centerY,
    actorId: actor?.id,
    actorName: actor ? subjectName(actor) : undefined,
    actorFaction: actor?.faction,
    severity,
    privacy: isPlayerEntity(actor) ? 'private' : 'local',
    tags: hazardTags(site),
    data: {
      hazardId: site.id,
      hazardKind: site.kind,
      hazardName: site.displayName,
      ...data,
    },
  });
}

function createSubjectState(hazardId: string, escapedUntil = 0): HazardSubjectState {
  return {
    hazardId,
    timeIn: 0,
    trapped: false,
    escapeProgress: 0,
    escapedUntil,
    damageCarry: 0,
    lastDamageMessageAt: -Infinity,
  };
}

function updateHazardPulses(world: World, runtime: CellHazardRuntime, state: GameState, player: Entity): void {
  let indexDirty = false;
  let fogDirty = false;

  for (const site of runtime.sites) {
    if (site.pulsePeriodSeconds <= 0 || site.cells.length === 0) continue;
    const active = pulseActiveAt(site, state.time);
    if (!setPulseActive(site, active)) continue;
    indexDirty = true;
    if (applyPulseFog(world, site)) fogDirty = true;

    if (
      world.dist2(player.x, player.y, site.centerX, site.centerY) <= HAZARD_MESSAGE_RADIUS2
      && state.time - site.lastPulseMessageAt >= site.messageCooldownSeconds
    ) {
      state.msgs.push(msg(active ? site.warning : site.inactiveWarning, state.time, active ? site.warningColor : '#8cf'));
      site.lastPulseMessageAt = state.time;
    }
  }

  if (indexDirty) rebuildCellIndex(runtime);
  if (fogDirty) world.markFogDirty();
}

export function registerCellHazardSite(world: World, draft: CellHazardSiteDraft): void {
  const site = normalizeSite(draft);
  if (!site) return;
  const runtime = ensureRuntime(world);
  runtime.sites = runtime.sites.filter(existing => existing.id !== site.id);
  runtime.sites.push(site);
  if (applyPulseFog(world, site)) world.markFogDirty();
  rebuildCellIndex(runtime);
}

function expireCellHazards(runtime: CellHazardRuntime, time: number): boolean {
  const kept = runtime.sites.filter(site => site.expiresAt <= 0 || site.expiresAt > time);
  if (kept.length === runtime.sites.length) return false;
  runtime.sites = kept;
  const liveIds = new Set(kept.map(site => site.id));
  for (const [entityId, subject] of runtime.subjects) {
    if (!liveIds.has(subject.hazardId)) runtime.subjects.delete(entityId);
  }
  rebuildCellIndex(runtime);
  return true;
}

export function replaceCellHazards(target: World, source: World): void {
  const sourceRuntime = runtimes.get(source);
  if (!sourceRuntime || sourceRuntime.sites.length === 0) {
    runtimes.delete(target);
    return;
  }
  const targetRuntime: CellHazardRuntime = {
    sites: sourceRuntime.sites.map(cloneSite),
    byCell: new Map(),
    allByCell: new Map(),
    subjects: new Map(),
    npcScanAccum: 0,
  };
  let fogDirty = false;
  for (const site of targetRuntime.sites) {
    if (applyPulseFog(target, site)) fogDirty = true;
  }
  if (fogDirty) target.markFogDirty();
  rebuildCellIndex(targetRuntime);
  runtimes.set(target, targetRuntime);
}

export function clearCellHazards(world: World): void {
  runtimes.delete(world);
}

export function deactivateCellHazardSite(
  world: World,
  id: string,
  state?: GameState,
  actor?: Entity,
  reason: CellHazardCleanReason = 'tool',
): number {
  const runtime = runtimes.get(world);
  if (!runtime) return 0;
  const site = runtime.sites.find(candidate => candidate.id === id);
  if (!site || site.cells.length === 0) return 0;

  const cleaned = site.activeCells.size > 0 ? site.activeCells.size : site.cells.length;
  site.activeCells.clear();
  site.cells = [];
  rebuildCellIndex(runtime);
  if (state) {
    publishHazardEvent(state, 'hazard_cleaned', site, 4, actor, {
      cleanedCells: cleaned,
      remainingCells: 0,
      reason,
    });
  }
  return cleaned;
}

export function getCellHazardMoveMultiplier(world: World, e: Entity): number {
  if (!isPlayerEntity(e) && e.type !== EntityType.NPC) return 1;
  const runtime = runtimes.get(world);
  if (!runtime) return 1;
  const cell = world.idx(Math.floor(e.x), Math.floor(e.y));
  const site = activeHazardAt(runtime, cell);
  if (!site) return 1;
  const subject = runtime.subjects.get(e.id);
  return subject?.hazardId === site.id && subject.trapped ? site.trappedMult : site.slowMult;
}

export function getPlayerHazardWarning(world: World, player: Entity): CellHazardWarning | null {
  const hit = hazardAtEntity(world, player);
  const runtime = runtimes.get(world);
  if (!hit) {
    if (!runtime) return null;
    const cell = world.idx(Math.floor(player.x), Math.floor(player.y));
    const inactive = inactivePulseHazardAt(runtime, cell);
    if (!inactive) return null;
    return {
      title: inactive.displayName,
      detail: inactive.inactiveWarning,
      color: '#8cf',
      trapped: false,
      critical: false,
    };
  }
  const subject = runtime?.subjects.get(player.id);
  const trapped = subject?.hazardId === hit.site.id && subject.trapped === true;
  return {
    title: trapped ? 'ВЛИПЛИ' : hit.site.displayName,
    detail: trapped ? 'Двигайтесь, чтобы вырваться. R с чистящим комплектом или огонь снимут липучку.' : hit.site.warning,
    color: trapped ? '#ff3838' : hit.site.warningColor,
    trapped,
    critical: trapped || hit.site.playerDamagePerSecond > 0,
  };
}

export function entityInActiveCellHazard(world: World, e: Entity, tags: readonly string[] = []): boolean {
  const hit = hazardAtEntity(world, e);
  if (!hit) return false;
  if (tags.length === 0) return true;
  for (const tag of tags) {
    if (hit.site.tags.includes(tag) || hit.site.kind === tag) return true;
  }
  return false;
}

export function cleanCellHazardsNear(
  world: World,
  x: number,
  y: number,
  radius: number,
  state: GameState,
  actor: Entity | undefined,
  reason: CellHazardCleanReason,
): number {
  const runtime = runtimes.get(world);
  if (!runtime || radius <= 0) return 0;
  const radius2 = radius * radius;
  let cleaned = 0;

  for (const site of runtime.sites) {
    if (!site.cleanable) continue;
    if (site.activeCells.size === 0) continue;
    const removed: number[] = [];
    for (const cell of site.activeCells) {
      const cx = (cell % W) + 0.5;
      const cy = ((cell / W) | 0) + 0.5;
      if (world.dist2(x, y, cx, cy) <= radius2) removed.push(cell);
    }
    if (removed.length === 0) continue;
    for (const cell of removed) site.activeCells.delete(cell);
    const removedSet = new Set(removed);
    site.cells = site.cells.filter(cell => !removedSet.has(cell));
    cleaned += removed.length;
    publishHazardEvent(state, 'hazard_cleaned', site, site.activeCells.size === 0 ? 4 : 3, actor, {
      cleanedCells: removed.length,
      remainingCells: site.activeCells.size,
      reason,
    });
  }

  if (cleaned > 0) rebuildCellIndex(runtime);
  return cleaned;
}

function forceHazardFlee(e: Entity): void {
  if (!e.ai || (e.type !== EntityType.NPC && e.type !== EntityType.MONSTER)) return;
  e.ai.goal = AIGoal.FLEE;
  e.ai.path = [];
  e.ai.pi = 0;
  e.ai.timer = Math.max(e.ai.timer, 0.8);
}

function applyHazardDamage(
  world: World,
  state: GameState,
  site: CellHazardSite,
  subject: HazardSubjectState,
  e: Entity,
  dt: number,
  damagePerSecond: number,
  player: Entity,
): boolean {
  if (damagePerSecond <= 0 || e.hp === undefined) return false;
  subject.damageCarry += damagePerSecond * dt;
  const amount = Math.floor(subject.damageCarry);
  if (amount <= 0) return false;

  subject.damageCarry -= amount;
  if (isPlayerEntity(e)) {
    const before = e.hp;
    e.hp = Math.max(1, e.hp - amount);
    const actual = before - e.hp;
    if (actual <= 0) return false;
    const maxHp = Math.max(1, e.maxHp ?? 100);
    state.dmgFlash = Math.max(state.dmgFlash, Math.min(1, 0.22 + actual / maxHp));
    recordPlayerDamage(state, undefined, actual, `${site.displayName}: -${actual}. ${site.warning}`, 'hazard');
  } else {
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
    } else {
      forceHazardFlee(e);
    }
  }

  const nearPlayer = isPlayerEntity(e) || world.dist2(player.x, player.y, e.x, e.y) <= HAZARD_MESSAGE_RADIUS2;
  if (!nearPlayer) return true;

  if (e.type === EntityType.MONSTER) {
    if (state.time - site.lastMonsterHitMessageAt < site.messageCooldownSeconds) return true;
    state.msgs.push(msg(e.alive
      ? `${site.displayName} бьет ${subjectName(e)}: -${amount}`
      : `${site.displayName} добивает ${subjectName(e)}.`,
    state.time, e.alive ? '#fa4' : '#f66'));
    site.lastMonsterHitMessageAt = state.time;
    return true;
  }

  if (state.time - subject.lastDamageMessageAt >= site.messageCooldownSeconds) {
    state.msgs.push(msg(`${site.displayName}: -${amount}`, state.time, '#f66'));
    subject.lastDamageMessageAt = state.time;
  }
  return true;
}

function tickHazardSubject(
  world: World,
  runtime: CellHazardRuntime,
  state: GameState,
  e: Entity,
  dt: number,
  playerId: number,
  playerStruggling: boolean,
): void {
  if (!e.alive || (!isPlayerEntity(e) && e.type !== EntityType.NPC)) return;
  const hit = hazardAtEntity(world, e);
  const prior = runtime.subjects.get(e.id);
  if (!hit) {
    if (prior?.trapped) {
      const site = runtime.sites.find(s => s.id === prior.hazardId);
      if (site) publishHazardEvent(state, 'hazard_escaped', site, 3, e, { reason: 'left_cell' });
    }
    runtime.subjects.delete(e.id);
    return;
  }

  let subject = prior?.hazardId === hit.site.id ? prior : createSubjectState(hit.site.id);
  if (subject.escapedUntil > state.time) {
    runtime.subjects.set(e.id, subject);
    return;
  }

  subject.timeIn += dt;
  if (e.id === playerId) applyHazardDamage(world, state, hit.site, subject, e, dt, hit.site.playerDamagePerSecond, e);
  if (hit.site.sticky && !subject.trapped && subject.timeIn >= hit.site.stickAfter) {
    subject.trapped = true;
    subject.escapeProgress = 0;
    publishHazardEvent(state, 'hazard_trapped', hit.site, isPlayerEntity(e) ? 4 : 3, e, { cell: hit.cell });
  }

  if (subject.trapped) {
    if (e.ai) {
      e.ai.path = [];
      e.ai.pi = 0;
      e.ai.timer = Math.max(e.ai.timer, 0.5);
    }
    const effort = e.id === playerId ? (playerStruggling ? 1 : 0.08) : 0.7;
    subject.escapeProgress += dt * effort;
    const need = e.id === playerId ? hit.site.escapeSeconds : hit.site.npcEscapeSeconds;
    if (subject.escapeProgress >= need) {
      publishHazardEvent(state, 'hazard_escaped', hit.site, 3, e, {
        reason: 'struggle',
        noisy: true,
        seconds: Math.round(subject.timeIn * 10) / 10,
      });
      subject = createSubjectState(hit.site.id, state.time + 2.5);
    }
  }

  runtime.subjects.set(e.id, subject);
}

function tickMonsterHazardDamage(
  world: World,
  runtime: CellHazardRuntime,
  state: GameState,
  e: Entity,
  dt: number,
  player: Entity,
): boolean {
  if (!e.alive || e.type !== EntityType.MONSTER) return false;
  const hit = hazardAtEntity(world, e);
  if (!hit || hit.site.monsterDamagePerSecond <= 0) {
    runtime.subjects.delete(e.id);
    return false;
  }

  const prior = runtime.subjects.get(e.id);
  const subject = prior?.hazardId === hit.site.id ? prior : createSubjectState(hit.site.id);
  const damaged = applyHazardDamage(world, state, hit.site, subject, e, dt, hit.site.monsterDamagePerSecond, player);
  if (e.alive) runtime.subjects.set(e.id, subject);
  else runtime.subjects.delete(e.id);
  return damaged;
}

export function tickCellHazards(
  world: World,
  _entities: Entity[],
  state: GameState,
  dt: number,
  player: Entity,
  playerStruggling: boolean,
): void {
  const runtime = runtimes.get(world);
  if (!runtime || runtime.sites.length === 0) return;

  expireCellHazards(runtime, state.time);
  if (runtime.sites.length === 0) return;
  updateHazardPulses(world, runtime, state, player);
  tickHazardSubject(world, runtime, state, player, dt, player.id, playerStruggling);

  runtime.npcScanAccum += dt;
  if (runtime.npcScanAccum < NPC_HAZARD_SCAN_INTERVAL) return;
  const npcDt = runtime.npcScanAccum;
  runtime.npcScanAccum = 0;
  let damagedMonsters = 0;
  let scanned = 0;
  hazardActorSeen.clear();
  const index = getEntityIndex();
  for (const site of runtime.sites) {
    if (scanned >= HAZARD_ACTOR_SCAN_CAP_TOTAL) break;
    if (site.activeCells.size === 0) continue;
    const cap = Math.min(HAZARD_ACTOR_SCAN_CAP_PER_SITE, HAZARD_ACTOR_SCAN_CAP_TOTAL - scanned);
    index.queryRadiusCapped(site.centerX, site.centerY, site.queryRadius, hazardActorQuery, ENTITY_MASK_ACTOR, cap);
    for (const e of hazardActorQuery) {
      if (scanned >= HAZARD_ACTOR_SCAN_CAP_TOTAL) break;
      if (hazardActorSeen.has(e.id)) continue;
      hazardActorSeen.add(e.id);
      scanned++;
      if (!e.alive) continue;
      if (e.type === EntityType.NPC && !isPlayerEntity(e)) {
        tickHazardSubject(world, runtime, state, e, npcDt, player.id, false);
      } else if (damagedMonsters < MONSTER_HAZARD_DAMAGE_CAP && e.type === EntityType.MONSTER) {
        if (tickMonsterHazardDamage(world, runtime, state, e, npcDt, player)) damagedMonsters++;
      }
    }
  }
  hazardActorQuery.length = 0;
  for (const id of runtime.subjects.keys()) {
    if (hazardActorSeen.has(id)) continue;
    const e = index.byId.get(id);
    if (!e?.alive) {
      runtime.subjects.delete(id);
      continue;
    }
    if (e.type === EntityType.NPC && !isPlayerEntity(e)) {
      tickHazardSubject(world, runtime, state, e, npcDt, player.id, false);
    } else if (e.type === EntityType.MONSTER) {
      tickMonsterHazardDamage(world, runtime, state, e, npcDt, player);
    }
  }
  hazardActorSeen.clear();
}
