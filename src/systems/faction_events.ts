import {
  AIGoal, Cell, EntityType, Faction, Occupation, ZoneFaction,
  type Entity, type GameState, type Item, msg,
} from '../core/types';
import { World } from '../core/world';
import {
  FACTION_EVENT_DEFS,
  type FactionClashOutcome,
  type FactionClashOutcomeDef,
  type FactionClashSideDef,
  type FactionEventDef,
  type FactionEventKind,
  type FactionResidueChoiceDef,
  type FactionResidueChoiceKind,
  type FactionResidueMarkDef,
} from '../data/faction_events';
import { freshNeeds, ITEMS, randomName, WEAPON_STATS } from '../data/catalog';
import {
  factionToTerritoryOwner,
  territoryOwnerName,
  territoryOwnerToFaction,
} from '../data/factions';
import { getStack } from '../data/items';
import { getEntityIndex } from './entity_index';
import { addFactionRelMutual } from '../data/relations';
import { stampMark, MarkType } from './surface_marks';
import { Spr } from '../render/sprite_index';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { ensureRoomContainers } from './containers';
import { controlHint } from './controls';
import { changeResourceStock } from './economy';
import { publishEvent } from './events';
import { addItem, hasItem } from './inventory';
import { observeRumorEvent } from './rumor';
import { gaussianLevel, getMaxHp, randomRPG } from './rpg';
import { entitySpawnSlots } from './entity_limits';
import { steerEntityTowardCell, tryAssignPathToCell } from './ai/pathfinding';
import {
  currentTerritoryZoneId,
  setTerritoryOwnerAtIndex,
  syncZoneMetadataFromTerritory,
  territoryOwnerAt,
  territoryOwnerAtIndex,
} from './territory';

const SCHEDULER_TICK_SEC = 10;
const MIN_EVENT_GAP_SEC = 45;
const MAX_EVENT_NPCS = 44;
const MAX_EVENT_DROPS = 24;
const MAX_EVENT_MARKS = 10;
const MAX_PRESSURE_CELLS = 96;
export const MAX_PROCESSION_PILGRIMS = 5;
const FACTION_EVENT_QUEST_ID = -25025;
const RECENT_LIMIT = 12;
const MAX_ACTIVE_PROCESSIONS = 3;
const PROCESSION_FEAR_TICK_SEC = 5;
const PROCESSION_REPORT_CLOSE_SEC = 18;
const PROCESSION_RESIST_GRACE_SEC = 0.45;
const PROCESSION_RESIST_ACTION_SEC = 1.35;
const PROCESSION_PULL_MIN_DIST = 1.35;
const PROCESSION_PULL_AXIS = 0.72;
const MAX_ACTIVE_CLASHES = 2;
const CLASH_SEEN_DIST2 = 26 * 26;
const CLASH_AVOID_DIST2 = 38 * 38;
const CLASH_TIMEOUT_SEC = 95;
const CLASH_REPORT_WINDOW_SEC = 14 * 60;
const CLASH_REPORT_DIST2 = 96 * 96;
const MAX_ACTIVE_RESIDUE_SITES = 16;
const RESIDUE_SITE_TTL_SEC = 12 * 60;
const RESIDUE_CLEANUP_DIST2 = 16 * 16;
const RESIDUE_REPORT_WINDOW_SEC = 12 * 60;
const RESIDUE_REPORT_DIST2 = 72 * 72;
const RESIDUE_PRESSURE_RELIEF_CELLS = 36;
const RESIDUE_NPC_REACT_DIST2 = 32 * 32;
const MAX_RESIDUE_NPC_REACTIONS = 16;

interface FactionEventRecord {
  time: number;
  id: string;
  zoneId: number;
  npcs: number;
  drops: number;
  marks: number;
  deposited: number;
  pressureCells: number;
}

interface TriggerResult {
  ok: boolean;
  message: string;
  npcs: number;
  drops: number;
  marks: number;
  deposited: number;
  pressureCells: number;
}

interface ConsequenceResult {
  deposited: number;
  containersTouched: number;
  economyDeltas: number;
}

type CultProcessionAction = 'avoid' | 'follow' | 'report' | 'disguise' | 'disrupt' | 'aftermath';

interface TempControlCell {
  idx: number;
  prev: ZoneFaction;
}

interface ActiveCultProcession {
  id: number;
  floor: number;
  samosborCount: number;
  zoneId: number;
  x: number;
  y: number;
  startedAt: number;
  expiresAt: number;
  nextFearAt: number;
  coverUntil: number;
  eventId: number;
  npcIds: number[];
  tempCells: TempControlCell[];
  avoided: boolean;
  followed: boolean;
  reported: boolean;
  disguised: boolean;
  disrupted: boolean;
  warned: boolean;
  playerDamage: number;
}

type ClashChoice = 'help_liquidators' | 'help_cultists' | 'loot_during_fight' | 'avoid' | 'report_aftermath';

interface ActiveFactionClash {
  key: string;
  floor: number;
  zoneId: number;
  x: number;
  y: number;
  startedAt: number;
  def: FactionEventDef;
  liquidatorIds: number[];
  cultistIds: number[];
  choices: ClashChoice[];
  sawPlayer: boolean;
  aftermathDone: boolean;
}

interface FactionClashAftermath {
  key: string;
  floor: number;
  zoneId: number;
  x: number;
  y: number;
  time: number;
  outcome: FactionClashOutcome;
  reported: boolean;
  rumorIds: readonly string[];
}

interface ActiveFactionResidueSite {
  key: string;
  floor: number;
  zoneId: number;
  x: number;
  y: number;
  createdAt: number;
  expiresAt: number;
  eventId: number;
  def: FactionEventDef;
  cleaned: boolean;
  reported: boolean;
  pressureCells: number;
}

export interface CultProcessionMapSnapshot {
  id: number;
  floor: number;
  zoneId: number;
  x: number;
  y: number;
  fearRadius: number;
  actionRadius: number;
  expiresIn: number;
  avoided: boolean;
  followed: boolean;
  reported: boolean;
  disrupted: boolean;
  disguised: boolean;
}

export interface CultProcessionCompulsion {
  x: number;
  y: number;
  strength: number;
  distance: number;
}

let schedulerAccum = 0;
let nextEventAt = 25 + Math.random() * 25;
let forceCursor = 0;
let nextProcessionId = 1;
const zoneCooldownUntil = new Map<string, number>();
const recentEvents: FactionEventRecord[] = [];
const activeCultProcessions: ActiveCultProcession[] = [];
const cultProcessionSnapshots: CultProcessionMapSnapshot[] = [];
const activeFactionClashes: ActiveFactionClash[] = [];
const spawnedFactionClashKeys = new Set<string>();
const factionClashAftermaths: FactionClashAftermath[] = [];
const activeFactionResidueSites: ActiveFactionResidueSite[] = [];
let lastFactionEventTime = 0;

function residueProfile(def: FactionEventDef): string {
  if (def.clash) return 'clash';
  if (def.procession) return 'procession';
  if (def.tags.includes('cult') || def.tags.includes('chernobog')) return 'cult';
  if (def.tags.includes('theft') || def.tags.includes('looters')) return 'theft';
  if (def.tags.includes('raid') || def.tags.includes('liquidator')) return 'enforcement';
  if (def.tags.includes('caravan') || def.tags.includes('shortage_escort')) return 'shortage';
  return def.tags[0] ?? def.id;
}

function serializeResidueChoices(choices: readonly FactionResidueChoiceDef[] | undefined): string[] {
  return (choices ?? []).map(choice => `${choice.kind}:${choice.text}`).slice(0, 8);
}

function residueAllowsChoice(def: FactionEventDef, choice: FactionResidueChoiceKind): boolean {
  const choices = def.residueChoices;
  return !choices || choices.length === 0 || choices.some(item => item.kind === choice);
}

function rememberResidueSite(
  state: GameState,
  def: FactionEventDef,
  zoneId: number,
  x: number,
  y: number,
  eventId: number,
  pressureCells: number,
): void {
  activeFactionResidueSites.unshift({
    key: `${state.currentFloor}:${eventId}:${def.id}`,
    floor: state.currentFloor,
    zoneId,
    x,
    y,
    createdAt: state.time,
    expiresAt: state.time + RESIDUE_SITE_TTL_SEC,
    eventId,
    def,
    cleaned: false,
    reported: false,
    pressureCells,
  });
  if (activeFactionResidueSites.length > MAX_ACTIVE_RESIDUE_SITES) {
    activeFactionResidueSites.length = MAX_ACTIVE_RESIDUE_SITES;
  }
}

function pruneResidueSites(state: GameState): void {
  let writeIdx = 0;
  for (let i = 0; i < activeFactionResidueSites.length; i++) {
    const site = activeFactionResidueSites[i];
    if (site.floor === state.currentFloor && state.time < site.expiresAt) {
      activeFactionResidueSites[writeIdx++] = site;
    }
  }
  activeFactionResidueSites.length = writeIdx;
}

function nearestResidueSiteForChoice(
  state: GameState,
  world: World,
  player: Entity,
  choice: FactionResidueChoiceKind,
  maxDist2: number,
): ActiveFactionResidueSite | null {
  pruneResidueSites(state);
  let best: ActiveFactionResidueSite | null = null;
  let bestD2 = maxDist2;
  for (const site of activeFactionResidueSites) {
    if (site.floor !== state.currentFloor || !residueAllowsChoice(site.def, choice)) continue;
    if (choice === 'cleanup' && site.cleaned) continue;
    if (choice === 'report' && site.reported) continue;
    const d2 = world.dist2(player.x, player.y, site.x, site.y);
    if (d2 > bestD2) continue;
    best = site;
    bestD2 = d2;
  }
  return best;
}

function relieveResiduePressure(world: World, site: ActiveFactionResidueSite): number {
  const owner = territoryOwnerAt(world, site.x, site.y);
  if (owner === ZoneFaction.SAMOSBOR) return 0;
  const radius = Math.max(2, Math.min(10, Math.ceil(Math.sqrt(Math.max(1, site.pressureCells)))));
  const ix = Math.floor(site.x);
  const iy = Math.floor(site.y);
  let changed = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (changed >= RESIDUE_PRESSURE_RELIEF_CELLS) return changed;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = world.idx(ix + dx, iy + dy);
      if (world.zoneMap[i] !== site.zoneId) continue;
      const previousOwner = territoryOwnerAtIndex(world, i);
      if (previousOwner === ZoneFaction.SAMOSBOR || previousOwner === owner) continue;
      if (setTerritoryOwnerAtIndex(world, i, owner)) changed++;
    }
  }
  if (changed > 0) syncZoneMetadataFromTerritory(world, [site.zoneId]);
  return changed;
}

function applyResidueChoiceRelations(def: FactionEventDef, choice: FactionResidueChoiceKind, reportFaction?: Faction): void {
  const actor = reportFaction ?? def.actorFaction;
  if (choice === 'cleanup' && actor !== undefined) addFactionRelMutual(Faction.PLAYER, actor, 1);
  if (choice === 'report' && reportFaction !== undefined) addFactionRelMutual(Faction.PLAYER, reportFaction, 2);
  if (choice === 'loot' && actor !== undefined) addFactionRelMutual(Faction.PLAYER, actor, -1);
}

function publishResidueChoiceEvent(
  state: GameState,
  site: ActiveFactionResidueSite,
  actor: Entity,
  choice: FactionResidueChoiceKind,
  data: Record<string, unknown> = {},
): number {
  const event = publishEvent(state, {
    type: 'faction_event',
    zoneId: site.zoneId,
    x: site.x,
    y: site.y,
    actorId: actor.id,
    actorName: actor.name,
    actorFaction: actor.faction,
    targetFaction: site.def.actorFaction,
    itemId: site.def.itemId,
    itemName: site.def.itemId ? ITEMS[site.def.itemId]?.name : undefined,
    severity: Math.max(1, Math.min(5, site.def.severity - 1)) as 1 | 2 | 3 | 4 | 5,
    privacy: site.def.privacy,
    tags: ['faction_event', site.def.id, 'residue', choice, ...site.def.tags],
    data: {
      factionEventId: site.def.id,
      sourceEventId: site.eventId,
      residueChoice: choice,
      residueProfile: residueProfile(site.def),
      residueText: site.def.residueText,
      ...data,
    },
  });
  return event.id;
}

function tryReportGenericResidueSite(
  state: GameState,
  world: World,
  player: Entity,
  npc: Entity,
): string | null {
  const site = nearestResidueSiteForChoice(state, world, player, 'report', RESIDUE_REPORT_DIST2);
  if (!site || site.reported || state.time - site.createdAt > RESIDUE_REPORT_WINDOW_SEC) return null;
  site.reported = true;
  const reportFaction = npc.faction ?? site.def.actorFaction;
  applyResidueChoiceRelations(site.def, 'report', reportFaction);
  publishResidueChoiceEvent(state, site, player, 'report', {
    reportNpcId: npc.id,
    reportNpcName: npc.name,
    reportFaction,
  });
  return `Доклад принят: ${site.def.residueText}`;
}

function reactNearbyNpcsToResidue(
  world: World,
  entities: Entity[],
  x: number,
  y: number,
  zoneId: number,
  def: FactionEventDef,
  phase: 'start' | 'aftermath',
): number {
  let reacted = 0;
  for (const npc of nearbyNpcsByDistance(world, entities, x, y, zoneId, RESIDUE_NPC_REACT_DIST2)) {
    if (reacted >= MAX_RESIDUE_NPC_REACTIONS) break;
    if (!npc.ai) continue;
    npc.ai.ambientBarkCd = Math.min(npc.ai.ambientBarkCd ?? 0, phase === 'start' ? 2 : 5);
    if (phase === 'start' && def.severity >= 4 && npc.faction !== def.actorFaction) {
      npc.ai.goal = AIGoal.FLEE;
      npc.ai.tx = Math.floor(npc.x + world.delta(x, npc.x));
      npc.ai.ty = Math.floor(npc.y + world.delta(y, npc.y));
      npc.ai.path = [];
      npc.ai.pi = 0;
    }
    reacted++;
  }
  return reacted;
}

export function updateFactionEvents(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
  dt: number,
  allowSpawns = true,
): void {
  resetFactionEventRuntimeIfNeeded(state);
  pruneResidueSites(state);
  updateActiveCultProcessions(state, world, player, entities, nextId, dt);
  updateActiveFactionClashes(state, world, player, entities, nextId);
  if (!allowSpawns) {
    schedulerAccum = 0;
    return;
  }
  schedulerAccum += dt;
  if (schedulerAccum < SCHEDULER_TICK_SEC) return;
  schedulerAccum -= SCHEDULER_TICK_SEC;
  if (state.samosborActive || state.time < nextEventAt) return;

  const zoneId = currentZoneId(world, player);
  const def = pickEligibleDef(state, world, entities, zoneId, false);
  if (!def) {
    nextEventAt = state.time + 20 + Math.random() * 25;
    return;
  }

  const result = triggerFactionEvent(state, world, player, entities, nextId, zoneId, def, false);
  nextEventAt = state.time + (result.ok ? MIN_EVENT_GAP_SEC + Math.random() * 70 : 25 + Math.random() * 35);
}

export function forceFactionEvent(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
  forcedId?: FactionEventKind,
): string {
  resetFactionEventRuntimeIfNeeded(state);
  const zoneId = currentZoneId(world, player);
  if (forcedId) {
    const def = FACTION_EVENT_DEFS.find(d => d.id === forcedId);
    if (!def) return `[FACTION] неизвестное событие: ${forcedId}`;
    const result = triggerFactionEvent(state, world, player, entities, nextId, zoneId, def, true);
    return result.message;
  }
  for (let i = 0; i < FACTION_EVENT_DEFS.length; i++) {
    const def = FACTION_EVENT_DEFS[(forceCursor + i) % FACTION_EVENT_DEFS.length];
    if (!isDefEligibleForZone(world, zoneId, def)) continue;
    forceCursor = (forceCursor + i + 1) % FACTION_EVENT_DEFS.length;
    const result = triggerFactionEvent(state, world, player, entities, nextId, zoneId, def, true);
    return result.message;
  }
  return '[FACTION] В текущей зоне нет подходящего события.';
}

export function summarizeFactionEvents(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
): string[] {
  const zoneId = currentZoneId(world, player);
  const owner = territoryOwnerAt(world, player.x, player.y);
  const npcCount = countTagged(entities, EntityType.NPC);
  const dropCount = countTagged(entities, EntityType.ITEM_DROP);
  const lines = [
    `sector ${zoneId + 1}: ${territoryOwnerName(owner)}`,
    `event NPC=${npcCount}/${MAX_EVENT_NPCS} DROP=${dropCount}/${MAX_EVENT_DROPS}`,
    `next auto ${Math.max(0, Math.round(nextEventAt - state.time))}s`,
  ];
  for (const def of FACTION_EVENT_DEFS) {
    if (!isDefEligibleForZone(world, zoneId, def)) continue;
    const cd = Math.max(0, Math.round((zoneCooldownUntil.get(cooldownKey(state, zoneId, def)) ?? 0) - state.time));
    lines.push(`${def.id}: cd ${cd}s`);
  }
  for (const e of recentEvents.slice(0, 5)) {
    lines.push(`${Math.round(state.time - e.time)}s ago ${e.id} z${e.zoneId + 1} npc${e.npcs} drop${e.drops} mark${e.marks} cont${e.deposited} press${e.pressureCells}`);
  }
  for (const p of activeCultProcessions) {
    if (p.floor !== state.currentFloor) continue;
    const flags = [
      p.avoided ? 'avoid' : '',
      p.followed ? 'follow' : '',
      p.reported ? 'report' : '',
      p.disguised ? 'disguise' : '',
      p.disrupted ? 'disrupt' : '',
    ].filter(Boolean).join(',');
    lines.push(`procession#${p.id} z${p.zoneId + 1} ${Math.max(0, Math.round(p.expiresAt - state.time))}s npc${aliveProcessionNpcs(p, entities)}/${p.npcIds.length} ${flags || 'open'}`);
  }
  for (const c of activeFactionClashes) {
    if (c.floor !== state.currentFloor) continue;
    const liq = countAliveIds(entities, c.liquidatorIds);
    const cult = countAliveIds(entities, c.cultistIds);
    lines.push(`clash z${c.zoneId + 1} L${liq}/${c.liquidatorIds.length} C${cult}/${c.cultistIds.length} ${c.choices.join(',') || 'open'}`);
  }
  return lines;
}

export function getActiveCultProcessionSnapshots(state: GameState): readonly CultProcessionMapSnapshot[] {
  cultProcessionSnapshots.length = 0;
  const def = cultProcessionDef();
  if (!def?.procession) return cultProcessionSnapshots;
  for (const p of activeCultProcessions) {
    if (p.floor !== state.currentFloor || p.expiresAt <= state.time) continue;
    cultProcessionSnapshots.push({
      id: p.id,
      floor: p.floor,
      zoneId: p.zoneId,
      x: p.x,
      y: p.y,
      fearRadius: def.procession.fearRadius,
      actionRadius: def.procession.actionRadius,
      expiresIn: Math.max(0, p.expiresAt - state.time),
      avoided: p.avoided,
      followed: p.followed,
      reported: p.reported,
      disrupted: p.disrupted,
      disguised: p.coverUntil > state.time || p.disguised,
    });
  }
  return cultProcessionSnapshots;
}

export function getCultProcessionPrompt(world: World, state: GameState, player: Entity): string {
  const p = nearestCultProcession(world, state, player);
  if (!p) return '';
  const def = cultProcessionDef();
  if (!def?.procession) return '';
  const dist = world.dist(player.x, player.y, p.x, p.y);
  if (player.tool === 'radio') return ' доложить';
  if (dist > def.procession.actionRadius) return ' удерживать: сопротивляться';
  if (hasItem(player, 'meat_rune')) return ' удерживать: не идти за знаком';
  return ' удерживать: сопротивляться ходу';
}

function beginCultProcessionFollow(
  state: GameState,
  p: ActiveCultProcession,
  player: Entity,
): void {
  if (p.followed) return;
  p.followed = true;
  const psiLoss = 2 + Math.floor(Math.random() * 3);
  let riskText = `ПСИ -${psiLoss}`;
  if (player.rpg && player.rpg.psi > 0) {
    player.rpg.psi = Math.max(0, player.rpg.psi - psiLoss);
  } else if (player.hp !== undefined) {
    const hpLoss = 1 + Math.floor(Math.random() * 3);
    player.hp = Math.max(1, player.hp - hpLoss);
    riskText = `HP -${hpLoss}`;
  }
  const foundRune = Math.random() < 0.18 && addItem(player, 'meat_rune', 1);
  publishProcessionAction(state, p, player, 'follow', 4, {
    actionText: 'Псалом процессии подхватил шаг игрока.',
    riskText,
    foundRune,
  });
  state.msgs.push(msg(foundRune
    ? `Псалом подхватил шаг. ${riskText}; в ладонь липнет мясная руна. Удерживайте ${controlHint('interact')}, чтобы сопротивляться.`
    : `Псалом подхватил шаг. ${riskText}; удерживайте ${controlHint('interact')}, чтобы сопротивляться.`,
    state.time,
    '#f8c',
  ));
}

export function updateCultProcessionCompulsion(
  state: GameState,
  world: World,
  player: Entity,
  resisting: boolean,
): CultProcessionCompulsion | null {
  const p = nearestCultProcession(world, state, player);
  if (!p) return null;
  const def = cultProcessionDef();
  if (!def?.procession) return null;
  const dist = world.dist(player.x, player.y, p.x, p.y);
  if (dist > def.procession.fearRadius || dist <= PROCESSION_PULL_MIN_DIST) return null;

  if (resisting) {
    p.coverUntil = Math.max(p.coverUntil, state.time + PROCESSION_RESIST_GRACE_SEC);
    p.nextFearAt = Math.max(p.nextFearAt, state.time + PROCESSION_FEAR_TICK_SEC);
    if (!p.avoided) {
      p.avoided = true;
      publishProcessionAction(state, p, player, 'avoid', 3, {
        actionText: 'Игрок сопротивляется ходу процессии и сбивает навязанный шаг.',
        resisted: true,
      });
      state.msgs.push(msg('Вы упираетесь в бетон. Псалом тянет слабее, пока удерживается клавиша.', state.time, '#ccf'));
    }
    return null;
  }

  if (p.coverUntil > state.time) return null;
  const steering = steerEntityTowardCell(world, player, Math.floor(p.x), Math.floor(p.y));
  if (!steering) return null;
  beginCultProcessionFollow(state, p, player);
  const near = Math.max(0, 1 - dist / Math.max(1, def.procession.fearRadius));
  const strength = PROCESSION_PULL_AXIS * (0.55 + near * 0.45);
  return { x: steering.x, y: steering.y, strength, distance: dist };
}

export function tryInteractCultProcession(
  state: GameState,
  world: World,
  player: Entity,
  _entities: Entity[],
): boolean {
  const p = nearestCultProcession(world, state, player);
  if (!p) return false;
  const def = cultProcessionDef();
  if (!def?.procession) return false;

  const dist = world.dist(player.x, player.y, p.x, p.y);
  if (player.tool === 'radio') {
    if (!p.reported) {
      p.reported = true;
      p.expiresAt = Math.min(p.expiresAt, state.time + PROCESSION_REPORT_CLOSE_SEC);
      addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 4);
      addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -5);
      publishProcessionAction(state, p, player, 'report', 4, {
        actionText: 'Игрок передал ликвидаторам ход процессии по рации.',
      });
      state.msgs.push(msg('Рация шипит: ликвидаторы приняли маршрут процессии.', state.time, '#8cf'));
    } else {
      state.msgs.push(msg('Маршрут процессии уже передан ликвидаторам.', state.time, '#888'));
    }
    return true;
  }

  if (dist > def.procession.actionRadius) {
    if (!p.avoided) {
      p.avoided = true;
      p.nextFearAt = state.time + PROCESSION_FEAR_TICK_SEC * 2;
      publishProcessionAction(state, p, player, 'avoid', 3, {
        actionText: 'Игрок переждал процессию у края коридора.',
      });
      state.msgs.push(msg('Вы переждали процессию у стены. Псалом проходит мимо.', state.time, '#ccf'));
    } else {
      state.msgs.push(msg('Вы уже держитесь вне хода процессии.', state.time, '#888'));
    }
    return true;
  }

  if (hasItem(player, 'meat_rune')) {
    p.coverUntil = Math.max(p.coverUntil, state.time + PROCESSION_RESIST_ACTION_SEC);
    if (!p.disguised) {
      p.disguised = true;
      addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, 1);
      publishProcessionAction(state, p, player, 'disguise', 3, {
        actionText: 'Игрок держит мясную руну как якорь и не дает процессии забрать шаг.',
        disguiseSec: PROCESSION_RESIST_ACTION_SEC,
        resisted: true,
      });
      state.msgs.push(msg('Мясная руна теплеет и держит вас на месте. Процессия проходит мимо.', state.time, '#c8f'));
    } else {
      state.msgs.push(msg('Руна уже держит ваш шаг вне процессии.', state.time, '#888'));
    }
    return true;
  }

  p.coverUntil = Math.max(p.coverUntil, state.time + PROCESSION_RESIST_ACTION_SEC);
  p.nextFearAt = state.time + PROCESSION_FEAR_TICK_SEC;
  if (!p.avoided) {
    p.avoided = true;
    publishProcessionAction(state, p, player, 'avoid', 3, {
      actionText: 'Игрок сопротивляется ходу процессии у самой линии.',
      resisted: true,
    });
    state.msgs.push(msg('Вы сбили навязанный шаг. Держите клавишу, иначе псалом снова потянет.', state.time, '#ccf'));
  } else {
    state.msgs.push(msg('Вы уже сопротивляетесь ходу процессии.', state.time, '#888'));
  }
  return true;
}

export function recordFactionClashPlayerHit(
  state: GameState,
  _world: World,
  player: Entity,
  target: Entity,
  damage: number,
): void {
  if (target.type !== EntityType.NPC || target.faction === undefined || damage <= 0) return;
  recordCultProcessionPlayerHit(state, target, damage);
  const clash = activeFactionClashes.find(c =>
    c.floor === state.currentFloor
    && !c.aftermathDone
    && (c.liquidatorIds.includes(target.id) || c.cultistIds.includes(target.id))
  );
  if (!clash) return;

  if (target.faction === Faction.CULTIST) {
    addClashChoice(state, player, clash, 'help_liquidators', target.faction);
  } else if (target.faction === Faction.LIQUIDATOR) {
    addClashChoice(state, player, clash, 'help_cultists', target.faction);
  }
}

export function recordFactionEventLootTaken(
  state: GameState | undefined,
  world: World,
  player: Entity,
  drop: Entity,
): void {
  if (!state || drop.questId !== FACTION_EVENT_QUEST_ID) return;
  const residue = nearestResidueSiteForChoice(state, world, player, 'cleanup', RESIDUE_CLEANUP_DIST2);
  if (residue && !residue.cleaned) {
    residue.cleaned = true;
    const pressureCleared = relieveResiduePressure(world, residue);
    applyResidueChoiceRelations(residue.def, 'cleanup');
    publishResidueChoiceEvent(state, residue, player, 'cleanup', {
      pickedItemId: drop.inventory?.[0]?.defId,
      pressureCleared,
    });
    if (pressureCleared > 0) state.msgs.push(msg('След события разобран: местный нажим немного спал.', state.time, '#9d9'));
  }
  const clash = activeFactionClashes.find(c =>
    c.floor === state.currentFloor
    && !c.aftermathDone
    && world.dist2(drop.x, drop.y, c.x, c.y) <= CLASH_SEEN_DIST2
  );
  if (!clash) return;
  addClashChoice(state, player, clash, 'loot_during_fight');
}

export function tryReportLiquidatorCultClashAftermath(
  state: GameState,
  world: World,
  player: Entity,
  npc: Entity,
): string | null {
  resetFactionClashRuntimeIfNeeded(state);
  const def = factionClashDef();
  if (!def?.clash || npc.faction !== def.clash.reportFaction) return tryReportGenericResidueSite(state, world, player, npc);
  const hasEvidence = playerHasClashEvidence(player);
  const aftermath = factionClashAftermaths.find(a =>
    !a.reported
    && a.floor === state.currentFloor
    && state.time - a.time <= CLASH_REPORT_WINDOW_SEC
    && (hasEvidence || world.dist2(player.x, player.y, a.x, a.y) <= CLASH_REPORT_DIST2)
  );
  if (!aftermath) return tryReportGenericResidueSite(state, world, player, npc);

  aftermath.reported = true;
  player.money = (player.money ?? 0) + def.clash.reportRewardMoney;
  addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 4);
  if (aftermath.outcome === 'cultists_win') addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -2);
  publishClashPhaseEvent(state, def, aftermath.zoneId, aftermath.x, aftermath.y, 'intervention', {
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: Faction.PLAYER,
    playerChoice: 'report_aftermath',
    outcome: aftermath.outcome,
    rumorIds: aftermath.rumorIds,
    text: def.clash.reportText,
  });
  return `${def.clash.reportText} (+${def.clash.reportRewardMoney}₽)`;
}

function triggerFactionClash(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
  zoneId: number,
  def: FactionEventDef,
  force: boolean,
  taggedNpcs: number,
  taggedDrops: number,
  key: string,
): TriggerResult {
  const clashDef = def.clash;
  if (!clashDef) return blocked('нет описания стычки');
  if (spawnedFactionClashKeys.has(key)) return blocked('эта стычка уже оставила след в зоне');
  if (activeFactionClashes.length >= MAX_ACTIVE_CLASHES) return blocked('достигнут лимит активных стычек');

  const sideCounts = clashDef.sides.map(side =>
    Math.max(0, side.minGroup + Math.floor(Math.random() * (side.maxGroup - side.minGroup + 1)))
  );
  const totalNpcs = sideCounts[0] + sideCounts[1];
  if (totalNpcs <= 1) return blocked('стороны стычки не собрались');
  if (force && taggedNpcs + totalNpcs > MAX_EVENT_NPCS) return blocked('достигнут лимит NPC событий');
  if (force && entitySpawnSlots(entities, EntityType.NPC, totalNpcs) < totalNpcs) return blocked('достигнут общий лимит NPC');

  const center = spawnCenter(world, player, zoneId);
  const angle = Math.random() * Math.PI * 2;
  const anchors = [
    { x: center.x + Math.cos(angle) * 4, y: center.y + Math.sin(angle) * 4 },
    { x: center.x - Math.cos(angle) * 4, y: center.y - Math.sin(angle) * 4 },
  ];
  const staged: Entity[] = [];
  const createdIds = new Set<number>();
  const claimedIds = new Set<number>();
  const liquidatorIds: number[] = [];
  const cultistIds: number[] = [];

  for (let s = 0; s < clashDef.sides.length; s++) {
    const side = clashDef.sides[s];
    for (let i = 0; i < sideCounts[s]; i++) {
      const npc = force
        ? createFactionEventNpcAt(world, zoneId, def, side.faction, anchors[s].x, anchors[s].y, nextId, side, 0, 6)
        : claimFactionEventNpc(world, entities, zoneId, side.faction, anchors[s].x, anchors[s].y, claimedIds);
      if (!npc) continue;
      if (force) createdIds.add(npc.id);
      npc.angle = Math.atan2(anchors[1 - s].y - npc.y, anchors[1 - s].x - npc.x);
      npc.ai!.goal = AIGoal.HUNT;
      npc.ai!.tx = Math.floor(anchors[1 - s].x);
      npc.ai!.ty = Math.floor(anchors[1 - s].y);
      staged.push(npc);
      if (side.faction === Faction.LIQUIDATOR) liquidatorIds.push(npc.id);
      if (side.faction === Faction.CULTIST) cultistIds.push(npc.id);
    }
  }

  if (liquidatorIds.length === 0 || cultistIds.length === 0) return blocked('не найдено место для обеих сторон стычки');
  for (const npc of staged) {
    const targetFaction = npc.faction === Faction.LIQUIDATOR ? Faction.CULTIST : Faction.LIQUIDATOR;
    npc.ai!.combatTargetId = nearestStagedOpponent(world, npc, staged, targetFaction)?.id;
    if (createdIds.has(npc.id)) entities.push(npc);
  }

  const availableDrops = entitySpawnSlots(entities, EntityType.ITEM_DROP, Math.max(0, MAX_EVENT_DROPS - taggedDrops));
  const spawnedDrops = spawnFactionEventDrops(world, entities, nextId, center.x, center.y, zoneId, def.drops, availableDrops);
  const marksPlaced = placeResidueMarks(world, center.x, center.y, zoneId, def);
  const consequences = applyConsequences(state, world, zoneId, def);
  if (staged.length === 0 && spawnedDrops === 0 && marksPlaced === 0 && consequences.deposited === 0 && consequences.economyDeltas === 0) {
    return blocked('не найдено место для видимой стычки');
  }
  const npcReactions = reactNearbyNpcsToResidue(world, entities, center.x, center.y, zoneId, def, 'start');

  spawnedFactionClashKeys.add(key);
  zoneCooldownUntil.set(key, state.time + def.cooldownSec);
  const startEventId = publishClashPhaseEvent(state, def, zoneId, center.x, center.y, 'start', {
    actorFaction: Faction.LIQUIDATOR,
    spawnedNpcs: staged.length,
    spawnedDrops,
    marksPlaced,
    deposited: consequences.deposited,
    npcReactions,
    text: def.message,
  });
  rememberResidueSite(state, def, zoneId, center.x, center.y, startEventId, 0);
  seedNearbyRumors(world, entities, state, zoneId, def, Faction.LIQUIDATOR, startEventId, center.x, center.y);

  activeFactionClashes.push({
    key,
    floor: state.currentFloor,
    zoneId,
    x: center.x,
    y: center.y,
    startedAt: state.time,
    def,
    liquidatorIds,
    cultistIds,
    choices: [],
    sawPlayer: world.dist2(player.x, player.y, center.x, center.y) <= CLASH_SEEN_DIST2,
    aftermathDone: false,
  });

  state.msgs.push(msg(def.message, state.time, '#fc6'));
  rememberEvent(state.time, def.id, zoneId, staged.length, spawnedDrops, marksPlaced, consequences.deposited, 0);
  return {
    ok: true,
    message: `[FACTION] ${def.name}: ликвидаторы ${liquidatorIds.length}, культ ${cultistIds.length}, трофеи ${spawnedDrops}, метки ${marksPlaced}`,
    npcs: staged.length,
    drops: spawnedDrops,
    marks: marksPlaced,
    deposited: consequences.deposited,
    pressureCells: 0,
  };
}

function updateActiveFactionClashes(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
): void {
  let keepCount = 0;
  for (let i = 0; i < activeFactionClashes.length; i++) {
    const clash = activeFactionClashes[i];
    if (clash.floor !== state.currentFloor) {
      continue;
    }

    const playerDist2 = world.dist2(player.x, player.y, clash.x, clash.y);
    if (playerDist2 <= CLASH_SEEN_DIST2) clash.sawPlayer = true;
    if (
      clash.sawPlayer
      && clash.choices.length === 0
      && state.time - clash.startedAt > 6
      && playerDist2 > CLASH_AVOID_DIST2
    ) {
      addClashChoice(state, player, clash, 'avoid');
    }

    const liquidatorsAlive = countAliveIds(entities, clash.liquidatorIds);
    const cultistsAlive = countAliveIds(entities, clash.cultistIds);
    const timedOut = state.time - clash.startedAt >= CLASH_TIMEOUT_SEC;
    if (liquidatorsAlive > 0 && cultistsAlive > 0 && !timedOut) {
      activeFactionClashes[keepCount++] = clash;
      continue;
    }

    finishFactionClash(state, world, entities, nextId, clash, liquidatorsAlive, cultistsAlive);
  }
  activeFactionClashes.length = keepCount;
}

function finishFactionClash(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  clash: ActiveFactionClash,
  liquidatorsAlive: number,
  cultistsAlive: number,
): void {
  if (clash.aftermathDone) return;
  clash.aftermathDone = true;
  const outcome: FactionClashOutcome = liquidatorsAlive > 0 && cultistsAlive <= 0
    ? 'liquidators_win'
    : cultistsAlive > 0 && liquidatorsAlive <= 0
      ? 'cultists_win'
      : liquidatorsAlive <= 0 && cultistsAlive <= 0
        ? 'mutual_ruin'
        : 'unresolved';
  const outcomeDef = clashOutcomeDef(clash.def, outcome);
  const availableDrops = entitySpawnSlots(entities, EntityType.ITEM_DROP, Math.max(0, MAX_EVENT_DROPS - countTagged(entities, EntityType.ITEM_DROP)));
  const spawnedDrops = spawnFactionEventDrops(
    world,
    entities,
    nextId,
    clash.x,
    clash.y,
    clash.zoneId,
    outcomeDef?.items,
    Math.min(4, availableDrops),
  );
  const marksPlaced = placeResidueMarks(world, clash.x, clash.y, clash.zoneId, clash.def);
  const pressureCells = outcomeDef?.winnerFaction !== undefined
    ? applyLocalPressure(world, clash.x, clash.y, clash.zoneId, outcomeDef.winnerFaction, clash.def)
    : 0;
  const npcReactions = reactNearbyNpcsToResidue(world, entities, clash.x, clash.y, clash.zoneId, clash.def, 'aftermath');
  const eventId = publishClashPhaseEvent(state, clash.def, clash.zoneId, clash.x, clash.y, 'aftermath', {
    actorFaction: outcomeDef?.winnerFaction,
    outcome,
    playerChoice: clash.choices[0],
    choices: clash.choices,
    spawnedDrops,
    marksPlaced,
    pressureCells,
    npcReactions,
    rumorIds: outcomeDef?.rumorIds,
    text: outcomeDef?.text ?? clash.def.residueText,
  });
  rememberResidueSite(state, clash.def, clash.zoneId, clash.x, clash.y, eventId, pressureCells);
  if (outcomeDef) seedClashOutcomeRumors(world, entities, state, clash, outcomeDef, eventId, outcome);
  factionClashAftermaths.unshift({
    key: clash.key,
    floor: clash.floor,
    zoneId: clash.zoneId,
    x: clash.x,
    y: clash.y,
    time: state.time,
    outcome,
    reported: false,
    rumorIds: outcomeDef?.rumorIds ?? ['faction_zone_border'],
  });
  if (factionClashAftermaths.length > RECENT_LIMIT) factionClashAftermaths.length = RECENT_LIMIT;
  state.msgs.push(msg(outcomeDef?.text ?? clash.def.residueText, state.time, '#fc6'));
  if (pressureCells > 0) state.msgs.push(msg(clash.def.pressure.text, state.time, '#c96'));
  rememberEvent(state.time, clash.def.id, clash.zoneId, 0, spawnedDrops, marksPlaced, 0, pressureCells);
}

function addClashChoice(
  state: GameState,
  player: Entity,
  clash: ActiveFactionClash,
  choice: ClashChoice,
  targetFaction?: Faction,
): boolean {
  if (clash.choices.includes(choice)) return false;
  clash.choices.push(choice);
  let text = '';
  let severity: 3 | 4 | 5 = 4;
  if (choice === 'help_liquidators') {
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 3);
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -5);
    text = 'Вы вмешались на стороне ликвидаторов.';
  } else if (choice === 'help_cultists') {
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, 2);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -6);
    text = 'Вы ударили по ликвидаторам, и культ это заметил.';
  } else if (choice === 'loot_during_fight') {
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
    addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -1);
    text = 'Вы сняли добычу с пола, пока обе стороны заняты друг другом.';
  } else if (choice === 'avoid') {
    severity = 3;
    text = 'Вы оставили стычку позади, пока коридор еще стреляет.';
  } else {
    text = 'Стычка получила нового свидетеля.';
  }
  publishClashPhaseEvent(state, clash.def, clash.zoneId, clash.x, clash.y, 'intervention', {
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: Faction.PLAYER,
    targetFaction,
    playerChoice: choice,
    choices: clash.choices,
    severity,
    text,
  });
  state.msgs.push(msg(text, state.time, choice === 'avoid' ? '#ccf' : '#fc6'));
  return true;
}

function spawnFactionEventDrops(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  cx: number,
  cy: number,
  zoneId: number,
  items: readonly Item[] | undefined,
  maxDrops: number,
): number {
  let spawned = 0;
  const dropSlots = entitySpawnSlots(entities, EntityType.ITEM_DROP, maxDrops);
  for (const item of items ?? []) {
    if (spawned >= dropSlots) break;
    const pos = findSpawnCell(world, cx, cy, zoneId, 1, 9);
    if (!pos) continue;
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [cloneItem(item)],
      questId: FACTION_EVENT_QUEST_ID,
    });
    spawned++;
  }
  return spawned;
}

function publishClashPhaseEvent(
  state: GameState,
  def: FactionEventDef,
  zoneId: number,
  x: number,
  y: number,
  phase: 'start' | 'intervention' | 'aftermath',
  detail: {
    actorId?: number;
    actorName?: string;
    actorFaction?: Faction;
    targetFaction?: Faction;
    outcome?: FactionClashOutcome;
    playerChoice?: ClashChoice;
    choices?: readonly ClashChoice[];
    spawnedNpcs?: number;
    spawnedDrops?: number;
    marksPlaced?: number;
    pressureCells?: number;
    npcReactions?: number;
    deposited?: number;
    severity?: 3 | 4 | 5;
    rumorIds?: readonly string[];
    text?: string;
  },
): number {
  const event = publishEvent(state, {
    type: 'faction_patrol_clash',
    zoneId,
    x,
    y,
    actorId: detail.actorId,
    actorName: detail.actorName,
    actorFaction: detail.actorFaction,
    targetFaction: detail.targetFaction,
    itemId: def.itemId,
    itemName: def.itemId ? ITEMS[def.itemId]?.name : undefined,
    severity: detail.severity ?? (phase === 'start' ? def.severity : 4),
    privacy: def.privacy,
    tags: ['faction_event', def.id, 'clash', phase, 'liquidator', 'cult'],
    data: {
      factionEventId: def.id,
      phase,
      name: def.name,
      outcome: detail.outcome,
      playerChoice: detail.playerChoice,
      choices: detail.choices,
      spawnedNpcs: detail.spawnedNpcs,
      spawnedDrops: detail.spawnedDrops,
      marksPlaced: detail.marksPlaced,
      pressureCells: detail.pressureCells,
      npcReactions: detail.npcReactions,
      deposited: detail.deposited,
      rumorIds: detail.rumorIds,
      residueText: detail.text ?? def.residueText,
      residueProfile: residueProfile(def),
      residueChoices: serializeResidueChoices(def.residueChoices),
    },
  });
  return event.id;
}

function seedClashOutcomeRumors(
  world: World,
  entities: Entity[],
  state: GameState,
  clash: ActiveFactionClash,
  outcomeDef: FactionClashOutcomeDef,
  eventId: number,
  outcome: FactionClashOutcome,
): void {
  let seeded = 0;
  const maxDist2 = 54 * 54;
  for (const e of nearbyNpcsByDistance(world, entities, clash.x, clash.y, clash.zoneId, maxDist2)) {
    if (seeded >= 12) break;
    observeRumorEvent(e, {
      id: eventId,
      type: 'faction_event',
      severity: clash.def.severity,
      floor: state.currentFloor,
      zoneId: clash.zoneId,
      x: clash.x,
      y: clash.y,
      itemId: clash.def.itemId,
      actorFaction: outcomeDef.winnerFaction,
      privacy: clash.def.privacy,
      tags: ['faction_event', clash.def.id, 'clash'],
      data: {
        factionEventId: clash.def.id,
        outcome,
        rumorIds: outcomeDef.rumorIds,
        residueText: outcomeDef.text,
      },
    }, state.time);
    seeded++;
  }
}

function countAliveIds(_entities: Entity[], ids: readonly number[]): number {
  let alive = 0;
  const byId = getEntityIndex().byId;
  for (const id of ids) {
    const e = byId.get(id);
    if (e?.alive) alive++;
  }
  return alive;
}

function resetFactionClashRuntimeIfNeeded(state: GameState): void {
  resetFactionEventRuntimeIfNeeded(state);
}

function resetFactionEventRuntimeIfNeeded(state: GameState): void {
  if (state.time + 1 >= lastFactionEventTime) {
    lastFactionEventTime = state.time;
    return;
  }
  schedulerAccum = 0;
  nextEventAt = state.time + 25 + Math.random() * 25;
  forceCursor = 0;
  activeCultProcessions.length = 0;
  cultProcessionSnapshots.length = 0;
  activeFactionClashes.length = 0;
  factionClashAftermaths.length = 0;
  spawnedFactionClashKeys.clear();
  zoneCooldownUntil.clear();
  recentEvents.length = 0;
  lastFactionEventTime = state.time;
}

export function resetFactionEventsForTests(): void {
  schedulerAccum = 0;
  nextEventAt = 25;
  forceCursor = 0;
  nextProcessionId = 1;
  zoneCooldownUntil.clear();
  recentEvents.length = 0;
  activeCultProcessions.length = 0;
  cultProcessionSnapshots.length = 0;
  activeFactionClashes.length = 0;
  spawnedFactionClashKeys.clear();
  factionClashAftermaths.length = 0;
  lastFactionEventTime = 0;
}

function factionClashDef(): FactionEventDef | undefined {
  return FACTION_EVENT_DEFS.find(def => def.id === 'cult_liquidator_clash' && def.clash !== undefined);
}

function clashOutcomeDef(def: FactionEventDef, outcome: FactionClashOutcome): FactionClashOutcomeDef | undefined {
  return def.clash?.outcomes.find(o => o.outcome === outcome) ?? def.clash?.outcomes[0];
}

function playerHasClashEvidence(player: Entity): boolean {
  return (player.inventory ?? []).some(item =>
    item.defId === 'note'
    && typeof item.data === 'string'
    && item.data.includes('Свидетельство схватки')
  );
}

function triggerFactionEvent(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
  zoneId: number,
  def: FactionEventDef,
  force: boolean,
): TriggerResult {
  const localOwner = territoryOwnerAt(world, player.x, player.y);
  if (localOwner === ZoneFaction.SAMOSBOR) return blocked('территория занята самосбором');
  const key = cooldownKey(state, zoneId, def);
  if (!force && state.time < (zoneCooldownUntil.get(key) ?? 0)) return blocked('событие на перезарядке');

  const taggedNpcs = countTagged(entities, EntityType.NPC);
  const taggedDrops = countTagged(entities, EntityType.ITEM_DROP);
  if (taggedNpcs >= MAX_EVENT_NPCS) return blocked('достигнут лимит NPC событий');
  const eventNpcSlots = force ? entitySpawnSlots(entities, EntityType.NPC, MAX_EVENT_NPCS - taggedNpcs) : MAX_EVENT_NPCS - taggedNpcs;
  if (force && eventNpcSlots <= 0 && def.minGroup > 0) return blocked('достигнут общий лимит NPC');
  if (taggedDrops >= MAX_EVENT_DROPS && def.drops && def.drops.length > 0) return blocked('достигнут лимит трофеев событий');
  const eventDropSlots = entitySpawnSlots(entities, EntityType.ITEM_DROP, MAX_EVENT_DROPS - taggedDrops);
  if (eventDropSlots <= 0 && def.drops && def.drops.length > 0) return blocked('достигнут общий лимит предметов');
  if (def.clash) {
    return triggerFactionClash(state, world, player, entities, nextId, zoneId, def, force, taggedNpcs, taggedDrops, key);
  }

  const faction = def.actorFaction ?? territoryOwnerToFaction(localOwner);
  if (faction === null) return blocked('нет фракции-исполнителя');

  const eventNpcCap = def.procession ? Math.min(MAX_PROCESSION_PILGRIMS, def.maxGroup) : def.maxGroup;
  const groupCap = Math.min(eventNpcCap, MAX_EVENT_NPCS - taggedNpcs, eventNpcSlots);
  const groupSize = Math.max(0, Math.min(groupCap, def.minGroup + Math.floor(Math.random() * (def.maxGroup - def.minGroup + 1))));
  const center = spawnCenter(world, player, zoneId);
  let spawnedNpcs = 0;
  const spawnedNpcIds: number[] = [];
  const claimedNpcIds = new Set<number>();
  for (let i = 0; i < groupSize; i++) {
    const npc = force
      ? createFactionEventNpcAt(world, zoneId, def, faction, center.x, center.y, nextId)
      : claimFactionEventNpc(world, entities, zoneId, faction, center.x, center.y, claimedNpcIds);
    if (!npc) continue;
    if (force) entities.push(npc);
    if (def.procession) guideProcessionNpc(world, npc, center.x, center.y, def.procession.activeSec);
    spawnedNpcIds.push(npc.id);
    spawnedNpcs++;
  }

  let spawnedDrops = 0;
  const availableDrops = eventDropSlots;
  for (const item of def.drops ?? []) {
    if (spawnedDrops >= availableDrops) break;
    const pos = findSpawnCell(world, center.x, center.y, zoneId, 2, 10);
    if (!pos) continue;
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: pos.x + 0.5, y: pos.y + 0.5,
      angle: 0, pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [cloneItem(item)],
      questId: FACTION_EVENT_QUEST_ID,
    });
    spawnedDrops++;
  }

  const marksPlaced = placeResidueMarks(world, center.x, center.y, zoneId, def);
  const activeProcession = def.procession
    ? startCultProcession(state, world, zoneId, def, faction, center.x, center.y, spawnedNpcIds)
    : null;
  const pressureCells = activeProcession
    ? activeProcession.tempCells.length
    : applyLocalPressure(world, center.x, center.y, zoneId, faction, def);
  const consequences = applyConsequences(state, world, zoneId, def);
  if (
    spawnedNpcs === 0
    && spawnedDrops === 0
    && marksPlaced === 0
    && pressureCells === 0
    && consequences.deposited === 0
    && consequences.economyDeltas === 0
  ) {
    if (activeProcession) cancelCultProcession(world, activeProcession);
    return blocked('не найдено место для видимого события');
  }
  const npcReactions = reactNearbyNpcsToResidue(world, entities, center.x, center.y, zoneId, def, 'start');

  zoneCooldownUntil.set(key, state.time + def.cooldownSec);
  const eventId = publishFactionEvent(state, zoneId, def, faction, center.x, center.y, spawnedNpcs, spawnedDrops, marksPlaced, pressureCells, consequences, npcReactions);
  if (activeProcession) activeProcession.eventId = eventId;
  rememberResidueSite(state, def, zoneId, center.x, center.y, eventId, pressureCells);
  seedNearbyRumors(world, entities, state, zoneId, def, faction, eventId, center.x, center.y);
  state.msgs.push(msg(def.message, state.time, '#fc6'));
  if (pressureCells > 0) state.msgs.push(msg(def.pressure.text, state.time, '#c96'));
  rememberEvent(state.time, def.id, zoneId, spawnedNpcs, spawnedDrops, marksPlaced, consequences.deposited, pressureCells);
  return {
    ok: true,
    message: `[FACTION] ${def.name}: NPC ${spawnedNpcs}, трофеи ${spawnedDrops}, метки ${marksPlaced}, контейнер ${consequences.deposited}, нажим ${pressureCells}`,
    npcs: spawnedNpcs,
    drops: spawnedDrops,
    marks: marksPlaced,
    deposited: consequences.deposited,
    pressureCells,
  };
}

function blocked(reason: string): TriggerResult {
  return { ok: false, message: `[FACTION] ${reason}`, npcs: 0, drops: 0, marks: 0, deposited: 0, pressureCells: 0 };
}

function nearbyNpcsByDistance(
  world: World,
  entities: readonly Entity[],
  x: number,
  y: number,
  zoneId: number,
  maxDist2: number,
): Entity[] {
  return entities
    .filter(e => (
      e.alive &&
      e.type === EntityType.NPC &&
      world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))] === zoneId &&
      world.dist2(x, y, e.x, e.y) <= maxDist2
    ))
    .map(e => ({ e, score: world.dist2(x, y, e.x, e.y) + ((e.id * 137) % 100) * 0.001 }))
    .sort((a, b) => a.score - b.score)
    .map(c => c.e);
}

function nearestStagedOpponent(world: World, npc: Entity, staged: readonly Entity[], faction: Faction): Entity | undefined {
  let best: Entity | undefined;
  let bestScore = Infinity;
  for (const other of staged) {
    if (other.faction !== faction) continue;
    const score = world.dist2(npc.x, npc.y, other.x, other.y) + ((other.id * 137) % 100) * 0.001;
    if (score >= bestScore) continue;
    best = other;
    bestScore = score;
  }
  return best;
}

function pickEligibleDef(
  state: GameState,
  world: World,
  entities: Entity[],
  zoneId: number,
  force: boolean,
): FactionEventDef | null {
  if (countTagged(entities, EntityType.NPC) >= MAX_EVENT_NPCS) return null;
  const candidates = FACTION_EVENT_DEFS.filter(def => {
    if (!isDefEligibleForZone(world, zoneId, def)) return false;
    if (def.clash && spawnedFactionClashKeys.has(cooldownKey(state, zoneId, def))) return false;
    if (force) return true;
    return state.time >= (zoneCooldownUntil.get(cooldownKey(state, zoneId, def)) ?? 0);
  });
  let total = 0;
  for (const def of candidates) total += def.weight;
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const def of candidates) {
    r -= def.weight;
    if (r <= 0) return def;
  }
  return candidates[0] ?? null;
}

function isDefEligibleForZone(world: World, zoneId: number, def: FactionEventDef): boolean {
  const zone = world.zones[zoneId];
  if (!zone) return false;
  const owner = territoryOwnerAt(world, zone.cx, zone.cy);
  return owner !== ZoneFaction.SAMOSBOR && def.zoneFactions.includes(owner);
}

function cooldownKey(state: GameState, zoneId: number, def: FactionEventDef): string {
  return `${state.currentFloor}:${zoneId}:${def.id}`;
}

function currentZoneId(world: World, actor: Entity): number {
  return currentTerritoryZoneId(world, actor.x, actor.y);
}

function spawnCenter(world: World, player: Entity, zoneId: number): { x: number; y: number } {
  const pi = world.idx(Math.floor(player.x), Math.floor(player.y));
  if (world.zoneMap[pi] === zoneId) return { x: player.x, y: player.y };
  const zone = world.zones[zoneId];
  return zone ? { x: zone.cx + 0.5, y: zone.cy + 0.5 } : { x: player.x, y: player.y };
}

function findSpawnCell(
  world: World,
  cx: number,
  cy: number,
  zoneId: number,
  minR: number,
  maxR: number,
): { x: number; y: number } | null {
  for (let a = 0; a < 80; a++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = minR + Math.random() * Math.max(1, maxR - minR);
    const x = world.wrap(Math.floor(cx + Math.cos(ang) * dist));
    const y = world.wrap(Math.floor(cy + Math.sin(ang) * dist));
    const i = world.idx(x, y);
    if (world.zoneMap[i] === zoneId && !world.solid(x, y)) return { x, y };
  }
  const zone = world.zones[zoneId];
  if (!zone) return null;
  for (let a = 0; a < 80; a++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * 42;
    const x = world.wrap(Math.floor(zone.cx + Math.cos(ang) * dist));
    const y = world.wrap(Math.floor(zone.cy + Math.sin(ang) * dist));
    const i = world.idx(x, y);
    if (world.zoneMap[i] === zoneId && !world.solid(x, y)) return { x, y };
  }
  return null;
}

function cultProcessionDef(): FactionEventDef | undefined {
  return FACTION_EVENT_DEFS.find(def => def.id === 'cult_procession');
}

function startCultProcession(
  state: GameState,
  world: World,
  zoneId: number,
  def: FactionEventDef,
  faction: Faction,
  x: number,
  y: number,
  npcIds: number[],
): ActiveCultProcession | null {
  if (!def.procession) return null;
  const zf = factionToTerritoryOwner(faction);
  const p: ActiveCultProcession = {
    id: nextProcessionId++,
    floor: state.currentFloor,
    samosborCount: state.samosborCount,
    zoneId,
    x,
    y,
    startedAt: state.time,
    expiresAt: state.time + def.procession.activeSec,
    nextFearAt: state.time + PROCESSION_FEAR_TICK_SEC,
    coverUntil: 0,
    eventId: 0,
    npcIds: npcIds.slice(0, MAX_PROCESSION_PILGRIMS),
    tempCells: [],
    avoided: false,
    followed: false,
    reported: false,
    disguised: false,
    disrupted: false,
    warned: false,
    playerDamage: 0,
  };
  applyTemporaryControl(world, p, zf, def);
  activeCultProcessions.unshift(p);
  while (activeCultProcessions.length > MAX_ACTIVE_PROCESSIONS) {
    const old = activeCultProcessions.pop();
    if (old) cancelCultProcession(world, old);
  }
  return p;
}

function applyTemporaryControl(world: World, p: ActiveCultProcession, zf: ZoneFaction, def: FactionEventDef): void {
  const radius = Math.max(1, Math.min(10, Math.floor(def.procession?.controlRadius ?? def.pressure.radius)));
  const strength = Math.max(0.15, Math.min(1, def.pressure.strength));
  const ix = Math.floor(p.x);
  const iy = Math.floor(p.y);
  const startLength = p.tempCells.length;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (p.tempCells.length >= MAX_PRESSURE_CELLS) {
        if (p.tempCells.length > startLength) syncZoneMetadataFromTerritory(world, [p.zoneId]);
        return;
      }
      if (dx * dx + dy * dy > radius * radius) continue;
      if (Math.random() > strength) continue;
      const x = world.wrap(ix + dx);
      const y = world.wrap(iy + dy);
      const i = world.idx(x, y);
      if (world.zoneMap[i] !== p.zoneId) continue;
      const cell = world.cells[i];
      if (cell === Cell.WALL || cell === Cell.ABYSS || cell === Cell.LIFT) continue;
      const prev = territoryOwnerAtIndex(world, i);
      if (prev === ZoneFaction.SAMOSBOR || prev === zf) continue;
      p.tempCells.push({ idx: i, prev });
      setTerritoryOwnerAtIndex(world, i, zf);
    }
  }
  if (p.tempCells.length > startLength) syncZoneMetadataFromTerritory(world, [p.zoneId]);
}

function cancelCultProcession(world: World, p: ActiveCultProcession): void {
  restoreTemporaryControl(world, p);
  dropCultProcession(p);
}

function dropCultProcession(p: ActiveCultProcession): void {
  const idx = activeCultProcessions.indexOf(p);
  if (idx >= 0) activeCultProcessions.splice(idx, 1);
}

function restoreTemporaryControl(world: World, p: ActiveCultProcession): void {
  let changed = 0;
  for (const cell of p.tempCells) {
    if (territoryOwnerAtIndex(world, cell.idx) === ZoneFaction.CULTIST && setTerritoryOwnerAtIndex(world, cell.idx, cell.prev)) changed++;
  }
  p.tempCells.length = 0;
  if (changed > 0) syncZoneMetadataFromTerritory(world, [p.zoneId]);
}

function nearestCultProcession(world: World, state: GameState, player: Entity): ActiveCultProcession | null {
  const def = cultProcessionDef();
  if (!def?.procession) return null;
  const playerZone = currentZoneId(world, player);
  let best: ActiveCultProcession | null = null;
  let bestD2 = def.procession.fearRadius * def.procession.fearRadius;
  for (const p of activeCultProcessions) {
    if (p.floor !== state.currentFloor || p.zoneId !== playerZone || p.expiresAt <= state.time || p.disrupted) continue;
    const d2 = world.dist2(player.x, player.y, p.x, p.y);
    if (d2 <= bestD2) {
      best = p;
      bestD2 = d2;
    }
  }
  return best;
}

function updateActiveCultProcessions(
  state: GameState,
  world: World,
  player: Entity,
  entities: Entity[],
  nextId: { v: number },
  _dt: number,
): void {
  const def = cultProcessionDef();
  if (!def?.procession) return;
  for (let i = activeCultProcessions.length - 1; i >= 0; i--) {
    const p = activeCultProcessions[i];
    if (p.floor !== state.currentFloor) {
      dropCultProcession(p);
      continue;
    }
    if (p.samosborCount !== state.samosborCount) {
      finishCultProcession(state, world, entities, nextId, p, 'смыта самосбором');
      continue;
    }
    if (!p.disrupted && processionDisrupted(p, entities)) {
      p.disrupted = true;
      addFactionRelMutual(Faction.PLAYER, Faction.CULTIST, -6);
      addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, 2);
      publishProcessionAction(state, p, player, 'disrupt', 5, {
        actionText: 'Процессия сорвана: часть паломников не дошла до метки.',
      });
      state.msgs.push(msg('Процессия сбилась. Культ это запомнит, ликвидаторы тоже.', state.time, '#fa0'));
      finishCultProcession(state, world, entities, nextId, p, 'сорвана');
      continue;
    }
    if (state.time >= p.expiresAt) {
      finishCultProcession(state, world, entities, nextId, p, p.reported ? 'доложена' : 'затихла');
      continue;
    }
    applyProcessionFearTick(state, world, player, p, def);
  }
}

function processionDisrupted(p: ActiveCultProcession, entities: Entity[]): boolean {
  if (p.npcIds.length === 0 || p.playerDamage <= 0) return false;
  const alive = aliveProcessionNpcs(p, entities);
  return alive <= Math.floor(p.npcIds.length / 2);
}

function recordCultProcessionPlayerHit(state: GameState, target: Entity, damage: number): void {
  for (const p of activeCultProcessions) {
    if (p.floor !== state.currentFloor || p.disrupted || p.expiresAt <= state.time) continue;
    if (!p.npcIds.includes(target.id)) continue;
    p.playerDamage += damage;
    return;
  }
}

function aliveProcessionNpcs(p: ActiveCultProcession, _entities: Entity[]): number {
  let alive = 0;
  const byId = getEntityIndex().byId;
  for (const id of p.npcIds) {
    const e = byId.get(id);
    if (e?.alive) alive++;
  }
  return alive;
}

function applyProcessionFearTick(
  state: GameState,
  world: World,
  player: Entity,
  p: ActiveCultProcession,
  def: FactionEventDef,
): void {
  if (!def.procession || state.time < p.nextFearAt) return;
  const dist = world.dist(player.x, player.y, p.x, p.y);
  if (dist > def.procession.fearRadius) return;
  const covered = p.coverUntil > state.time;
  const safelyAvoiding = p.avoided && dist > def.procession.actionRadius;
  p.nextFearAt = state.time + PROCESSION_FEAR_TICK_SEC;
  if (covered || safelyAvoiding) return;
  if (!p.warned) {
    p.warned = true;
    state.msgs.push(msg(`Процессия рядом. Шаг потянет сам; удерживайте ${controlHint('interact')}, чтобы сопротивляться, или доложите рацией.`, state.time, '#fc6'));
    return;
  }
  if (dist <= def.procession.actionRadius) {
    if (player.rpg && player.rpg.psi > 0) {
      player.rpg.psi = Math.max(0, player.rpg.psi - 1);
      state.msgs.push(msg('Псалом давит на ПСИ. Держите сопротивление или уходите с линии.', state.time, '#c8f'));
    } else if (player.hp !== undefined) {
      player.hp = Math.max(1, player.hp - 1);
      state.msgs.push(msg('Псалом режет слух до крови. Удерживайте шаг против хода.', state.time, '#f8c'));
    }
  }
}

function finishCultProcession(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  p: ActiveCultProcession,
  outcome: string,
): void {
  const def = cultProcessionDef();
  const availableDrops = entitySpawnSlots(entities, EntityType.ITEM_DROP, Math.max(0, MAX_EVENT_DROPS - countTagged(entities, EntityType.ITEM_DROP)));
  const spawnedDrops = def
    ? spawnFactionEventDrops(world, entities, nextId, p.x, p.y, p.zoneId, def.drops, Math.min(1, availableDrops))
    : 0;
  const marksPlaced = def ? placeResidueMarks(world, p.x, p.y, p.zoneId, def) : 0;
  const npcReactions = def ? reactNearbyNpcsToResidue(world, entities, p.x, p.y, p.zoneId, def, 'aftermath') : 0;
  restoreTemporaryControl(world, p);
  const eventId = publishProcessionAction(state, p, undefined, 'aftermath', p.disrupted ? 5 : 4, {
    actionText: `Процессия ${outcome}; временное давление коридора спало.`,
    processionOutcome: outcome,
    avoided: p.avoided,
    followed: p.followed,
    reported: p.reported,
    disguised: p.disguised,
    spawnedDrops,
    marksPlaced,
    npcReactions,
  });
  if (def) rememberResidueSite(state, def, p.zoneId, p.x, p.y, eventId, 0);
  const idx = activeCultProcessions.indexOf(p);
  if (idx >= 0) activeCultProcessions.splice(idx, 1);
}

function publishProcessionAction(
  state: GameState,
  p: ActiveCultProcession,
  player: Entity | undefined,
  action: CultProcessionAction,
  severity: 3 | 4 | 5,
  data: Record<string, unknown>,
): number {
  const def = cultProcessionDef();
  const event = publishEvent(state, {
    type: 'faction_relation_changed',
    zoneId: p.zoneId,
    x: p.x,
    y: p.y,
    actorId: player?.id,
    actorName: player?.name,
    actorFaction: player?.faction,
    targetFaction: Faction.CULTIST,
    itemId: action === 'disguise' || action === 'follow' ? 'meat_rune' : undefined,
    itemName: action === 'disguise' || action === 'follow' ? ITEMS.meat_rune?.name : undefined,
    severity,
    privacy: 'local',
    tags: ['faction_event', 'cult_procession', 'procession_action', action],
    data: {
      factionEventId: 'cult_procession',
      processionId: p.id,
      sourceEventId: p.eventId,
      processionAction: action,
      temporaryControlCells: p.tempCells.length,
      residueText: def?.residueText,
      residueProfile: def ? residueProfile(def) : 'procession',
      residueChoices: serializeResidueChoices(def?.residueChoices),
      ...data,
    },
  });
  return event.id;
}

function claimFactionEventNpc(
  world: World,
  entities: Entity[],
  zoneId: number,
  faction: Faction,
  x: number,
  y: number,
  claimedIds: Set<number>,
): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const npc of entities) {
    if (!npc.alive || npc.type !== EntityType.NPC || !npc.ai) continue;
    if (claimedIds.has(npc.id)) continue;
    if (npc.plotNpcId || npc.canGiveQuest || (npc.questId !== undefined && npc.questId !== -1)) continue;
    if (npc.faction !== faction) continue;
    if (world.zoneMap[world.idx(Math.floor(npc.x), Math.floor(npc.y))] !== zoneId) continue;
    const score = world.dist2(x, y, npc.x, npc.y) + ((npc.id * 137) % 100) * 0.001;
    if (score >= bestScore) continue;
    best = npc;
    bestScore = score;
  }
  if (!best) return null;
  const ai = best.ai;
  if (!ai) return null;
  claimedIds.add(best.id);
  best.isTraveler = true;
  ai.goal = AIGoal.GOTO;
  ai.tx = Math.floor(x);
  ai.ty = Math.floor(y);
  ai.path = [];
  ai.pi = 0;
  ai.timer = 0;
  ai.combatTargetId = undefined;
  return best;
}

function guideProcessionNpc(world: World, npc: Entity, x: number, y: number, activeSec: number): void {
  const ai = npc.ai;
  if (!ai) return;
  ai.goal = AIGoal.GOTO;
  ai.combatTargetId = undefined;
  ai.combatScanCd = 0;
  ai.timer = Math.max(ai.timer, Math.min(activeSec, 18));
  const status = tryAssignPathToCell(world, npc, Math.floor(x), Math.floor(y));
  if (status === 'not_found') {
    ai.goal = AIGoal.WANDER;
    ai.timer = Math.min(ai.timer, 3);
  }
}

function createFactionEventNpcAt(
  world: World,
  zoneId: number,
  def: FactionEventDef,
  faction: Faction,
  cx: number,
  cy: number,
  nextId: { v: number },
  side?: FactionClashSideDef,
  minR = 5,
  maxR = 18,
): Entity | null {
  const pos = findSpawnCell(world, cx, cy, zoneId, minR, maxR);
  if (!pos) return null;
  return createFactionNpc(world, zoneId, def, faction, pos.x + 0.5, pos.y + 0.5, nextId, side);
}

function createFactionNpc(
  world: World,
  zoneId: number,
  def: FactionEventDef,
  faction: Faction,
  x: number,
  y: number,
  nextId: { v: number },
  side?: FactionClashSideDef,
): Entity {
  const zoneLevel = world.zones[zoneId]?.level ?? 1;
  const rpg = randomRPG(gaussianLevel(zoneLevel, 2));
  const maxHp = Math.round(getMaxHp(rpg) * 1.15);
  const nm = randomName(faction);
  const occupation = side?.occupation ?? occupationFor(def, faction);
  const pickedWeapon = pickWeapon(def, faction, side?.weapons);
  const psiTool = isPsiCombatItem(pickedWeapon) ? pickedWeapon : undefined;
  const weapon = psiTool ? undefined : pickedWeapon;
  const inventory = cloneItems(side?.npcInventory ?? def.npcInventory);
  if (psiTool && !inventory.some(item => item.defId === psiTool)) inventory.push({ defId: psiTool, count: 1 });
  addDefaultAmmo(inventory, weapon);
  return {
    id: nextId.v++,
    type: EntityType.NPC,
    x, y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.25 + Math.random() * 0.35,
    sprite: occupation,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    money: Math.floor(Math.random() * 45),
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory,
    weapon,
    tool: psiTool,
    faction,
    occupation,
    isTraveler: true,
    questId: FACTION_EVENT_QUEST_ID,
    rpg,
  };
}

function occupationFor(def: FactionEventDef, faction: Faction): Occupation {
  if (def.id !== 'patrol') return def.occupation;
  if (faction === Faction.LIQUIDATOR) return Occupation.HUNTER;
  if (faction === Faction.CULTIST) return Occupation.PILGRIM;
  return def.occupation;
}

function pickWeapon(def: FactionEventDef, faction: Faction, weapons?: readonly string[]): string | undefined {
  const pool = weapons ?? def.weapons ?? defaultWeapons(faction);
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

function isPsiCombatItem(itemId: string | undefined): itemId is string {
  return !!itemId && !!WEAPON_STATS[itemId]?.psiCost;
}

function defaultWeapons(faction: Faction): readonly string[] {
  if (faction === Faction.LIQUIDATOR) return ['makarov', 'pipe'];
  if (faction === Faction.CULTIST) return ['knife', 'psi_strike'];
  if (faction === Faction.WILD) return ['pipe', 'knife'];
  return ['knife'];
}

function addDefaultAmmo(inventory: Item[], weapon: string | undefined): void {
  if (!weapon) return;
  const ammo = weapon === 'shotgun' || weapon === 'toz_shotgun' ? 'ammo_shells'
    : weapon === 'ppsh' || weapon === 'makarov' || weapon === 'homemade_pistol' ? 'ammo_9mm'
    : weapon === 'tt_pistol' ? 'ammo_762tt'
    : undefined;
  if (!ammo || inventory.some(i => i.defId === ammo)) return;
  inventory.push({ defId: ammo, count: 8 + Math.floor(Math.random() * 9) });
}

function cloneItems(items: readonly Item[] | undefined): Item[] {
  return (items ?? []).map(cloneItem);
}

function cloneItem(item: Item): Item {
  return { defId: item.defId, count: item.count, data: item.data };
}

function applyConsequences(state: GameState, world: World, zoneId: number, def: FactionEventDef): ConsequenceResult {
  let economyDeltas = 0;
  for (const delta of def.economyDeltas ?? []) {
    if (changeResourceStock(state, delta.resourceId, delta.count)) economyDeltas++;
  }
  if (!def.containerDrops || def.containerDrops.length === 0) return { deposited: 0, containersTouched: 0, economyDeltas };
  ensureRoomContainers(world, state.currentFloor);
  let deposited = 0;
  let containersTouched = 0;
  const visibleContainer = findResidueContainer(world, zoneId, true);
  const fallbackContainer = visibleContainer ? null : findResidueContainer(world, zoneId, false);
  const container = visibleContainer ?? fallbackContainer;
  if (!container) return { deposited: 0, containersTouched: 0, economyDeltas };
  for (const item of def.containerDrops) {
    if (addContainerItem(container.inventory, MAX_INVENTORY_SLOTS, item)) deposited++;
  }
  if (deposited > 0) {
    container.lastAuditAt = state.time;
    if (!container.tags.includes('faction_residue')) container.tags.push('faction_residue');
    containersTouched = 1;
  }
  return { deposited, containersTouched, economyDeltas };
}

function findResidueContainer(world: World, zoneId: number, preferVisible: boolean) {
  for (const container of world.containers) {
    if (container.zoneId !== zoneId) continue;
    const visible = container.discovered || container.access !== 'secret';
    if (preferVisible && !visible) continue;
    return container;
  }
  return null;
}

function addContainerItem(inventory: Item[], capacitySlots: number, item: Item): boolean {
  const def = ITEMS[item.defId];
  if (!def) return false;
  const maxStack = getStack(def);
  const existing = inventory.find(i => i.defId === item.defId && i.count < maxStack);
  if (existing) {
    existing.count = Math.min(maxStack, existing.count + item.count);
    return true;
  }
  if (inventory.length >= capacitySlots) return false;
  inventory.push({ defId: item.defId, count: Math.min(maxStack, item.count), data: item.data });
  return true;
}

function placeResidueMarks(world: World, cx: number, cy: number, zoneId: number, def: FactionEventDef): number {
  let placed = 0;
  const maxR = Math.max(3, Math.min(10, def.pressure.radius + 1));
  for (const mark of def.marks) {
    const count = Math.max(0, Math.min(mark.count, MAX_EVENT_MARKS - placed));
    for (let i = 0; i < count; i++) {
      const pos = findSpawnCell(world, cx, cy, zoneId, 0, maxR);
      if (!pos) continue;
      stampResidueMark(world, pos.x, pos.y, mark, def.id.length * 4099 + zoneId * 101 + placed * 37 + i);
      placed++;
      if (placed >= MAX_EVENT_MARKS) return placed;
    }
  }
  return placed;
}

function stampResidueMark(world: World, x: number, y: number, mark: FactionResidueMarkDef, seed: number): void {
  const visual = residueMarkVisual(mark);
  const fx = 0.2 + Math.random() * 0.6;
  const fy = 0.2 + Math.random() * 0.6;
  stampMark(
    world,
    x, y,
    fx, fy,
    mark.radius,
    visual.type,
    seed + Math.floor(Math.random() * 100_000),
    visual.r, visual.g, visual.b,
    mark.intensity ?? visual.intensity,
  );
}

function residueMarkVisual(mark: FactionResidueMarkDef): { type: MarkType; r: number; g: number; b: number; intensity: number } {
  switch (mark.kind) {
    case 'blood': return { type: MarkType.SPLAT, r: 135, g: 9, b: 9, intensity: 165 };
    case 'gore': return { type: MarkType.POOL, r: 42, g: 34, b: 11, intensity: 190 };
    case 'bullet': return { type: MarkType.BULLET, r: 18, g: 16, b: 14, intensity: 210 };
    case 'scorch': return { type: MarkType.SCORCH, r: 34, g: 29, b: 23, intensity: 175 };
    case 'psi': return { type: MarkType.PSI, r: 88, g: 18, b: 140, intensity: 190 };
    case 'ash': return { type: MarkType.BURN, r: 28, g: 26, b: 22, intensity: 150 };
    case 'chalk': return { type: MarkType.SPLAT, r: 190, g: 186, b: 150, intensity: 95 };
    case 'water': return { type: MarkType.DRIP, r: 70, g: 100, b: 120, intensity: 80 };
    case 'scuff': return { type: MarkType.SPLAT, r: 48, g: 45, b: 38, intensity: 95 };
  }
}

function applyLocalPressure(world: World, cx: number, cy: number, zoneId: number, faction: Faction, def: FactionEventDef): number {
  const zf = factionToTerritoryOwner(faction);
  const radius = Math.max(1, Math.min(10, Math.floor(def.pressure.radius)));
  const strength = Math.max(0, Math.min(1, def.pressure.strength));
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  let changed = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (changed >= MAX_PRESSURE_CELLS) return changed;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (Math.random() > strength) continue;
      const x = world.wrap(ix + dx);
      const y = world.wrap(iy + dy);
      const i = world.idx(x, y);
      if (world.zoneMap[i] !== zoneId) continue;
      const cell = world.cells[i];
      if (cell === Cell.WALL || cell === Cell.ABYSS || cell === Cell.LIFT) continue;
      const previousOwner = territoryOwnerAtIndex(world, i);
      if (previousOwner === ZoneFaction.SAMOSBOR) continue;
      if (setTerritoryOwnerAtIndex(world, i, zf)) changed++;
    }
  }
  if (changed > 0) syncZoneMetadataFromTerritory(world, [zoneId]);
  return changed;
}

function publishFactionEvent(
  state: GameState,
  zoneId: number,
  def: FactionEventDef,
  faction: Faction,
  x: number,
  y: number,
  spawnedNpcs: number,
  spawnedDrops: number,
  marksPlaced: number,
  pressureCells: number,
  consequences: ConsequenceResult,
  npcReactions: number,
): number {
  const event = publishEvent(state, {
    type: 'faction_relation_changed',
    zoneId,
    x,
    y,
    actorFaction: faction,
    itemId: def.itemId,
    itemName: def.itemId ? ITEMS[def.itemId]?.name : undefined,
    severity: def.severity,
    privacy: def.privacy,
    tags: ['faction_event', def.id, ...def.tags],
    data: {
      factionEventId: def.id,
      name: def.name,
      spawnedNpcs,
      spawnedDrops,
      marksPlaced,
      pressureCells,
      deposited: consequences.deposited,
      containersTouched: consequences.containersTouched,
      economyDeltas: economyDeltaSummary(def),
      npcReactions,
      residueText: def.residueText,
      pressureText: def.pressure.text,
      markKinds: def.marks.map(m => m.kind),
      residueProfile: residueProfile(def),
      residueChoices: serializeResidueChoices(def.residueChoices),
    },
  });
  return event.id;
}

function seedNearbyRumors(
  world: World,
  entities: Entity[],
  state: GameState,
  zoneId: number,
  def: FactionEventDef,
  faction: Faction,
  eventId: number,
  x: number,
  y: number,
): void {
  let seeded = 0;
  const maxDist2 = 42 * 42;
  for (const e of nearbyNpcsByDistance(world, entities, x, y, zoneId, maxDist2)) {
    if (seeded >= 12) break;
    observeRumorEvent(e, {
      id: eventId,
      type: 'faction_event',
      severity: def.severity,
      floor: state.currentFloor,
      zoneId,
      x,
      y,
      itemId: def.itemId,
      actorFaction: faction,
      privacy: def.privacy,
      tags: def.tags,
      data: {
        factionEventId: def.id,
        residueText: def.residueText,
        pressureText: def.pressure.text,
      },
    }, state.time);
    seeded++;
  }
}

function economyDeltaSummary(def: FactionEventDef): string[] {
  const out: string[] = [];
  for (const delta of def.economyDeltas ?? []) {
    out.push(`${delta.resourceId}${delta.count >= 0 ? '+' : ''}${delta.count}`);
  }
  return out;
}

function rememberEvent(time: number, id: string, zoneId: number, npcs: number, drops: number, marks: number, deposited: number, pressureCells: number): void {
  recentEvents.unshift({ time, id, zoneId, npcs, drops, marks, deposited, pressureCells });
  if (recentEvents.length > RECENT_LIMIT) recentEvents.length = RECENT_LIMIT;
}

function countTagged(entities: Entity[], type: EntityType): number {
  let n = 0;
  for (const e of entities) {
    if (!e.alive || e.type !== type) continue;
    if (e.questId === FACTION_EVENT_QUEST_ID) n++;
  }
  return n;
}
