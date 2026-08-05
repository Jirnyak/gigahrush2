/* ── Emergency maintenance panels: local room infrastructure controls ─ */

import { stampSurfaceSplat } from './surface_marks';
import {
  AIGoal,
  Cell,
  DoorState,
  EntityType,
  Faction,
  Feature,
  MonsterKind,
  RoomType,
  Tex,
  W,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Room,
  type WorldContainer,
  type WorldEventSeverity,
} from '../core/types';
import { World } from '../core/world';
import {
  EMERGENCY_PANEL_DEFS,
  getEmergencyPanelDef,
  type EmergencyPanelActionId,
  type EmergencyPanelCost,
  type EmergencyPanelDef,
  type EmergencyPanelDomain,
  type EmergencyPanelId,
} from '../data/emergency_panels';
import { ITEMS } from '../data/catalog';
import { MONSTERS } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { randomRPG } from './rpg';
import { removeItem } from './inventory';
import { publishEvent } from './events';
import { applyInfrastructureRelationResponse } from './factions';
import { territoryFactionAt } from './territory';
import { setDoorState } from './door_state';
import { ENTITY_MASK_NPC, ensureEntityIndex } from './entity_index';

type PanelAction = Exclude<EmergencyPanelActionId, 'leave'>;
type PanelStatus = 'idle' | 'repaired' | 'shutdown' | 'forced' | 'overloaded';
const PANEL_PATROL_QUERY_CAP = 96;
const panelPatrolQuery: Entity[] = [];

export interface EmergencyPanelInstance {
  idx: number;
  x: number;
  y: number;
  defId: EmergencyPanelId;
  roomId: number;
  zoneId: number;
  seed: number;
  status: PanelStatus;
  usedAt: number;
}

export interface EmergencyPanelMenuOption {
  id: EmergencyPanelActionId;
  label: string;
  detail: string;
  enabled: boolean;
  disabledReason?: string;
  costLine?: string;
}

export interface EmergencyPanelMenuSnapshot {
  open: boolean;
  title: string;
  subtitle: string;
  status: string;
  color: string;
  selected: number;
  options: EmergencyPanelMenuOption[];
  message: string;
}

export interface EmergencyPanelMenuInput {
  up: boolean;
  down: boolean;
  confirm: boolean;
  close: boolean;
}

export interface EmergencyPanelMenuResult {
  handled: boolean;
  worldChanged: boolean;
}

interface EmergencyPanelWorldState {
  panels: Map<number, EmergencyPanelInstance>;
}

interface EmergencyPanelMenuState {
  world: World;
  idx: number;
  selected: number;
  message: string;
}

interface PanelActionResult {
  worldChanged: boolean;
  message: string;
  color: string;
  severity: WorldEventSeverity;
  noise: number;
  fogCells: number;
  lightCells: number;
  waterCells: number;
  doors: number;
  containers: number;
  spawned: number;
  patrols: number;
  relationDelta: number;
}

const panelStates = new WeakMap<World, EmergencyPanelWorldState>();
let menuState: EmergencyPanelMenuState | null = null;

function panelWorldState(world: World): EmergencyPanelWorldState {
  let state = panelStates.get(world);
  if (!state) {
    state = { panels: new Map() };
    panelStates.set(world, state);
  }
  return state;
}

function inventoryCount(items: readonly Item[] | undefined, itemId: string): number {
  let count = 0;
  for (const item of items ?? []) if (item.defId === itemId) count += item.count;
  return count;
}

function hasCost(player: Entity, cost: readonly EmergencyPanelCost[]): boolean {
  return cost.every(item => inventoryCount(player.inventory, item.itemId) >= item.count);
}

function consumeCost(player: Entity, cost: readonly EmergencyPanelCost[]): void {
  for (const item of cost) removeItem(player, item.itemId, item.count);
}

function costLine(cost: readonly EmergencyPanelCost[]): string {
  if (cost.length === 0) return '';
  return cost.map(item => {
    const name = ITEMS[item.itemId]?.name ?? item.itemId;
    return `${name} x${item.count}`;
  }).join(', ');
}

function statusLine(status: PanelStatus): string {
  if (status === 'repaired') return 'линия стабилизирована';
  if (status === 'shutdown') return 'контур отключен';
  if (status === 'forced') return 'пломба сорвана';
  if (status === 'overloaded') return 'контур перегружен';
  return 'пломба целая, реле дрожит';
}

function actionStatus(action: PanelAction): PanelStatus {
  if (action === 'repair') return 'repaired';
  if (action === 'shutdown') return 'shutdown';
  if (action === 'force') return 'forced';
  return 'overloaded';
}

function actionSeverity(action: PanelAction): WorldEventSeverity {
  if (action === 'repair') return 2;
  if (action === 'shutdown') return 3;
  if (action === 'force') return 4;
  return 5;
}

function panelStateLabel(def: EmergencyPanelDef, action: PanelAction): string {
  if (action === 'repair') return `${def.shortName}: ремонт`;
  if (action === 'shutdown') return `${def.shortName}: отключение`;
  if (action === 'force') return `${def.shortName}: вскрытие`;
  return `${def.shortName}: перегруз`;
}

function getPanelAtIdx(world: World, idx: number): EmergencyPanelInstance | undefined {
  return panelStates.get(world)?.panels.get(idx);
}

export function getEmergencyPanelAt(world: World, x: number, y: number): EmergencyPanelInstance | undefined {
  return getPanelAtIdx(world, world.idx(Math.floor(x), Math.floor(y)));
}

export function getEmergencyPanels(world: World): readonly EmergencyPanelInstance[] {
  return [...(panelStates.get(world)?.panels.values() ?? [])];
}

export function registerEmergencyPanel(
  world: World,
  x: number,
  y: number,
  defId: EmergencyPanelId,
  seed = 0,
): EmergencyPanelInstance | null {
  const def = getEmergencyPanelDef(defId);
  if (!def) return null;
  const idx = world.idx(x, y);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return null;
  const panel: EmergencyPanelInstance = {
    idx,
    x: idx % W,
    y: (idx / W) | 0,
    defId,
    roomId: world.roomMap[idx],
    zoneId: world.zoneMap[idx],
    seed,
    status: 'idle',
    usedAt: -Infinity,
  };
  panelWorldState(world).panels.set(idx, panel);
  return panel;
}

export function placeEmergencyPanel(
  world: World,
  x: number,
  y: number,
  defId: EmergencyPanelId,
  seed = 0,
): EmergencyPanelInstance | null {
  const panel = registerEmergencyPanel(world, x, y, defId, seed);
  if (!panel) return null;
  world.setFeatureAt(panel.idx, Feature.APPARATUS);
  const def = getEmergencyPanelDef(defId) ?? EMERGENCY_PANEL_DEFS[0];
  const tint = def.domain === 'power'
    ? [220, 190, 70]
    : def.domain === 'water'
      ? [70, 150, 210]
      : def.domain === 'doors'
        ? [150, 170, 145]
        : [95, 185, 145];
  stampSurfaceSplat(world, panel.x, panel.y, 0.5, 0.5, 0.34, 0.58, seed ^ panel.idx, tint[0], tint[1], tint[2], false);
  return panel;
}

export function replaceEmergencyPanelStateForRebuild(target: World, source?: World): void {
  const sourceState = source ? panelStates.get(source) : undefined;
  if (sourceState) {
    const panels = new Map<number, EmergencyPanelInstance>();
    for (const [idx, panel] of sourceState.panels) panels.set(idx, { ...panel });
    panelStates.set(target, { panels });
  } else {
    panelStates.delete(target);
  }
  if (source && source !== target) panelStates.delete(source);
  if (menuState && (menuState.world === target || menuState.world === source)) menuState = null;
}

export function emergencyPanelInteractionTargetId(world: World, lookX: number, lookY: number): number | null {
  const panel = getEmergencyPanelAt(world, lookX, lookY);
  if (!panel) return null;
  return panel.idx + 620000;
}

export function tryUseEmergencyPanel(world: World, _player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const panel = getEmergencyPanelAt(world, lookX, lookY);
  if (!panel) return false;
  const def = getEmergencyPanelDef(panel.defId);
  if (!def) return false;
  menuState = { world, idx: panel.idx, selected: 0, message: 'Выберите, что сделать со щитком.' };
  state.msgs.push(msg(`${def.name}: ${statusLine(panel.status)}.`, state.time, def.color));
  return true;
}

function affectedRooms(world: World, panel: EmergencyPanelInstance): Room[] {
  const primary = panel.roomId >= 0 ? world.rooms[panel.roomId] : undefined;
  const out: Room[] = [];
  if (primary) out.push(primary);
  const candidates = world.rooms
    .filter(room => room.id !== panel.roomId && room.w >= 3 && room.h >= 3)
    .map(room => {
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      return { room, d2: world.dist2(panel.x + 0.5, panel.y + 0.5, cx, cy) };
    })
    .filter(item => item.d2 <= 52 * 52)
    .sort((a, b) => a.d2 - b.d2);
  for (const item of candidates) {
    if (out.length >= 4) break;
    out.push(item.room);
  }
  return out;
}

function forRoomCells(world: World, rooms: readonly Room[], fn: (idx: number, x: number, y: number, room: Room) => void): void {
  let visited = 0;
  for (const room of rooms) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        if (visited++ > 7000) return;
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const idx = world.idx(x, y);
        if (world.roomMap[idx] !== room.id) continue;
        fn(idx, x, y, room);
      }
    }
  }
}

function reduceFog(world: World, rooms: readonly Room[], amount: number): number {
  let changed = 0;
  forRoomCells(world, rooms, idx => {
    if (world.fog[idx] === 0) return;
    world.fog[idx] = Math.max(0, world.fog[idx] - amount);
    changed++;
  });
  if (changed > 0) world.markFogDirty();
  return changed;
}

function increaseFog(world: World, rooms: readonly Room[], amount: number): number {
  let changed = 0;
  forRoomCells(world, rooms, idx => {
    if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) return;
    const next = Math.min(225, world.fog[idx] + amount);
    if (next === world.fog[idx]) return;
    world.fog[idx] = next;
    changed++;
  });
  if (changed > 0) world.markFogDirty();
  return changed;
}

function addLamps(world: World, rooms: readonly Room[], seed: number): number {
  let added = 0;
  forRoomCells(world, rooms, (idx, x, y) => {
    if (added >= 5) return;
    if (world.cells[idx] !== Cell.FLOOR || world.features[idx] !== Feature.NONE) return;
    if (((x * 17 + y * 31 + seed) & 15) !== 0) return;
    world.setFeatureAt(idx, Feature.LAMP, false);
    added++;
  });
  if (added > 0) world.markFeaturesDirty(true);
  return added;
}

function removeLamps(world: World, rooms: readonly Room[]): number {
  let removed = 0;
  forRoomCells(world, rooms, idx => {
    if (world.features[idx] !== Feature.LAMP) return;
    world.setFeatureAt(idx, Feature.NONE, false);
    removed++;
  });
  if (removed > 0) world.markFeaturesDirty(true);
  return removed;
}

function drainWater(world: World, rooms: readonly Room[], maxCells: number): number {
  let changed = 0;
  forRoomCells(world, rooms, idx => {
    if (changed >= maxCells || world.cells[idx] !== Cell.WATER) return;
    world.cells[idx] = Cell.FLOOR;
    world.floorTex[idx] = Tex.F_CONCRETE;
    changed++;
  });
  if (changed > 0) {
    world.markCellsDirty();
    world.markFloorTexDirty();
  }
  return changed;
}

function floodCells(world: World, rooms: readonly Room[], maxCells: number): number {
  let changed = 0;
  forRoomCells(world, rooms, idx => {
    if (changed >= maxCells || world.cells[idx] !== Cell.FLOOR || world.features[idx] !== Feature.NONE) return;
    if (((idx * 13 + changed * 7) & 7) !== 0) return;
    world.cells[idx] = Cell.WATER;
    world.floorTex[idx] = Tex.F_WATER;
    changed++;
  });
  if (changed > 0) {
    world.markCellsDirty();
    world.markFloorTexDirty();
  }
  return changed;
}

function mutateDoors(world: World, rooms: readonly Room[], action: 'open' | 'close' | 'repair'): number {
  let changed = 0;
  const used = new Set<number>();
  for (const room of rooms) {
    for (const doorIdx of room.doors) {
      if (used.has(doorIdx)) continue;
      used.add(doorIdx);
      const door = world.doors.get(doorIdx);
      if (!door) continue;
      if (action === 'open') {
        if (door.state === DoorState.OPEN || door.state === DoorState.HERMETIC_OPEN) continue;
        setDoorState(world, door, door.state === DoorState.HERMETIC_CLOSED ? DoorState.HERMETIC_OPEN : DoorState.OPEN);
        door.timer = 0;
        changed++;
      } else if (action === 'close') {
        if (door.state === DoorState.CLOSED || door.state === DoorState.HERMETIC_CLOSED) continue;
        setDoorState(world, door, door.state === DoorState.HERMETIC_OPEN ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED);
        changed++;
      } else if (door.state === DoorState.LOCKED) {
        setDoorState(world, door, DoorState.CLOSED);
        door.keyId = '';
        changed++;
      }
    }
  }
  if (changed > 0) world.markCellsDirty();
  return changed;
}

function containerInRooms(container: WorldContainer, roomIds: ReadonlySet<number>): boolean {
  return container.roomId !== undefined && roomIds.has(container.roomId);
}

function unlockLocalContainers(world: World, rooms: readonly Room[], maxContainers: number): number {
  const roomIds = new Set(rooms.map(room => room.id));
  let changed = 0;
  for (const container of world.containers) {
    if (changed >= maxContainers || !containerInRooms(container, roomIds)) continue;
    if (container.access === 'public' && container.discovered) continue;
    container.discovered = true;
    if (container.access === 'locked' || container.access === 'faction' || container.access === 'owner') {
      container.access = 'public';
      container.lockDifficulty = undefined;
    }
    changed++;
  }
  return changed;
}

function stampNoise(world: World, panel: EmergencyPanelInstance, action: PanelAction): number {
  const loud = action === 'force' || action === 'overload';
  const count = loud ? 5 : action === 'shutdown' ? 2 : 1;
  for (let i = 0; i < count; i++) {
    stampSurfaceSplat(world,
      panel.x + ((i * 3) % 5) - 2,
      panel.y + ((i * 5) % 5) - 2,
      0.5,
      0.5,
      0.22 + i * 0.03,
      0.42,
      panel.seed + i * 101 + panel.idx,
      loud ? 210 : 120,
      loud ? 150 : 120,
      loud ? 80 : 140,
      false,
    );
  }
  return count;
}

function monsterKindForPanel(domain: EmergencyPanelDomain): MonsterKind {
  if (domain === 'power') return Math.random() < 0.55 ? MonsterKind.LAMPOVY : MonsterKind.ROBOT;
  if (domain === 'water') return Math.random() < 0.55 ? MonsterKind.TUBE_EEL : MonsterKind.POLZUN;
  if (domain === 'doors') return Math.random() < 0.55 ? MonsterKind.REBAR : MonsterKind.SHOVNIK;
  return Math.random() < 0.55 ? MonsterKind.SHADOW : MonsterKind.EYE;
}

function spawnPanelThreat(
  world: World,
  rooms: readonly Room[],
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
  def: EmergencyPanelDef,
): number {
  const candidates = rooms.filter(room => room.type !== RoomType.BATHROOM && room.w >= 3 && room.h >= 3);
  if (candidates.length === 0) return 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const room = candidates[Math.floor(Math.random() * candidates.length)];
    const x = world.wrap(room.x + 1 + Math.floor(Math.random() * Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + Math.floor(Math.random() * Math.max(1, room.h - 2)));
    if (world.solid(x, y) || world.dist2(player.x, player.y, x + 0.5, y + 0.5) < 7 * 7) continue;
    const kind = monsterKindForPanel(def.domain);
    const monsterDef = MONSTERS[kind];
    const zoneLevel = world.zones[world.zoneMap[world.idx(x, y)]]?.level ?? 2;
    const hp = Math.round(monsterDef.hp * (0.78 + zoneLevel * 0.14));
    const monster: Entity = {
      id: nextId.v++,
      type: EntityType.MONSTER,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: monsterDef.speed,
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.HUNT, tx: player.x, ty: player.y, path: [], pi: 0, stuck: 0, timer: 0, combatTargetId: player.id },
      rpg: randomRPG(Math.max(1, zoneLevel)),
      phasing: kind === MonsterKind.SPIRIT,
    };
    entities.push(monster);
    return 1;
  }
  return 0;
}

function spawnPanelInspector(
  world: World,
  panel: EmergencyPanelInstance,
  entities: Entity[],
  owner: Faction | null,
): number {
  if (owner === null || owner === Faction.PLAYER || Math.random() > 0.35) return 0;
  const room = panel.roomId >= 0 ? world.rooms[panel.roomId] : undefined;
  if (!room) return 0;
  let best: Entity | null = null;
  let bestD2 = Infinity;
  const tx = panel.x + 0.5;
  const ty = panel.y + 0.5;
  for (const npc of entities) {
    if (!npc.alive || npc.type !== EntityType.NPC || !npc.ai || npc.faction !== owner) continue;
    if (npc.plotNpcId || npc.canGiveQuest || (npc.questId !== undefined && npc.questId !== -1)) continue;
    if (world.zoneMap[world.idx(Math.floor(npc.x), Math.floor(npc.y))] !== panel.zoneId) continue;
    const d2 = world.dist2(tx, ty, npc.x, npc.y);
    if (d2 >= bestD2) continue;
    best = npc;
    bestD2 = d2;
  }
  if (best) {
    const ai = best.ai;
    if (!ai) return 0;
    best.isTraveler = true;
    ai.goal = AIGoal.GOTO;
    ai.tx = tx;
    ai.ty = ty;
    ai.path = [];
    ai.pi = 0;
    ai.timer = 0;
    return 1;
  }
  return 0;
}

function alertLocalPatrols(
  world: World,
  panel: EmergencyPanelInstance,
  entities: readonly Entity[],
  player: Entity,
  owner: Faction | null,
  severity: WorldEventSeverity,
): number {
  if (owner === null) return 0;
  let alerted = 0;
  ensureEntityIndex(entities).queryRadiusCapped(
    panel.x + 0.5,
    panel.y + 0.5,
    88,
    panelPatrolQuery,
    ENTITY_MASK_NPC,
    PANEL_PATROL_QUERY_CAP,
  );
  for (const entity of panelPatrolQuery) {
    if (alerted >= 6) break;
    if (!entity.alive || entity.type !== EntityType.NPC || entity.faction !== owner || !entity.ai) continue;
    if (world.zoneMap[world.idx(Math.floor(entity.x), Math.floor(entity.y))] !== panel.zoneId) continue;
    entity.ai.goal = severity >= 4 ? AIGoal.HUNT : AIGoal.GOTO;
    entity.ai.tx = panel.x + 0.5;
    entity.ai.ty = panel.y + 0.5;
    entity.ai.path.length = 0;
    entity.ai.pi = 0;
    if (severity >= 4) entity.ai.combatTargetId = player.id;
    alerted++;
  }
  panelPatrolQuery.length = 0;
  return alerted;
}

function applyDomainEffect(
  world: World,
  rooms: readonly Room[],
  panel: EmergencyPanelInstance,
  def: EmergencyPanelDef,
  action: PanelAction,
): Pick<PanelActionResult, 'worldChanged' | 'fogCells' | 'lightCells' | 'waterCells' | 'doors' | 'containers' | 'noise'> {
  let fogCells = 0;
  let lightCells = 0;
  let waterCells = 0;
  let doors = 0;
  let containers = 0;
  const noise = stampNoise(world, panel, action);

  if (action === 'repair') {
    if (def.domain === 'power') lightCells += addLamps(world, rooms, panel.seed);
    if (def.domain === 'water') waterCells += drainWater(world, rooms, 72);
    if (def.domain === 'doors') doors += mutateDoors(world, rooms, 'repair');
    if (def.domain === 'vent') fogCells += reduceFog(world, rooms, 88);
    fogCells += reduceFog(world, rooms, 24);
  } else if (action === 'shutdown') {
    if (def.domain === 'power') lightCells += removeLamps(world, rooms);
    if (def.domain === 'water') waterCells += drainWater(world, rooms, 96);
    if (def.domain === 'doors') doors += mutateDoors(world, rooms, 'close');
    if (def.domain === 'vent') fogCells += increaseFog(world, rooms, 46);
  } else if (action === 'force') {
    doors += mutateDoors(world, rooms, 'open');
    containers += unlockLocalContainers(world, rooms, 3);
    if (def.domain === 'water') waterCells += drainWater(world, rooms, 64);
    if (def.domain === 'vent') fogCells += reduceFog(world, rooms, 64);
  } else {
    doors += mutateDoors(world, rooms, 'open');
    if (def.domain === 'power') lightCells += addLamps(world, rooms, panel.seed ^ 0x71);
    if (def.domain === 'water') waterCells += floodCells(world, rooms, 42);
    if (def.domain === 'vent') fogCells += increaseFog(world, rooms, 72);
    if (def.domain === 'doors') containers += unlockLocalContainers(world, rooms, 2);
  }

  return {
    worldChanged: fogCells > 0 || lightCells > 0 || waterCells > 0 || doors > 0 || containers > 0 || noise > 0,
    fogCells,
    lightCells,
    waterCells,
    doors,
    containers,
    noise,
  };
}

function publishPanelEvents(
  _world: World,
  player: Entity,
  state: GameState,
  panel: EmergencyPanelInstance,
  def: EmergencyPanelDef,
  action: PanelAction,
  result: PanelActionResult,
  owner: Faction | null,
): void {
  const tags = [
    'emergency_panel',
    def.id,
    def.domain,
    action,
    ...def.tags,
    ...(action === 'repair' ? ['repair'] : ['sabotage', 'noise']),
  ];
  publishEvent(state, {
    type: 'emergency_panel_used',
    zoneId: panel.zoneId,
    roomId: panel.roomId >= 0 ? panel.roomId : undefined,
    x: panel.x + 0.5,
    y: panel.y + 0.5,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetName: def.name,
    targetFaction: owner ?? undefined,
    severity: result.severity,
    privacy: result.severity >= 4 ? 'witnessed' : 'local',
    tags,
    data: {
      panelId: def.id,
      action,
      status: panel.status,
      relationDelta: result.relationDelta,
      patrols: result.patrols,
      spawned: result.spawned,
      doors: result.doors,
      fogCells: result.fogCells,
      lightCells: result.lightCells,
      waterCells: result.waterCells,
      containers: result.containers,
      noise: result.noise,
    },
  });
  if (owner !== null && (result.relationDelta !== 0 || result.patrols > 0)) {
    publishEvent(state, {
      type: 'faction_event',
      zoneId: panel.zoneId,
      roomId: panel.roomId >= 0 ? panel.roomId : undefined,
      x: panel.x + 0.5,
      y: panel.y + 0.5,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      targetFaction: owner,
      severity: Math.max(2, result.severity - 1) as WorldEventSeverity,
      privacy: 'witnessed',
      tags: ['faction_event', 'emergency_panel', 'territory_response', action],
      data: {
        factionEventId: 'emergency_panel_response',
        name: 'Аварийный щиток',
        phase: panelStateLabel(def, action),
        relationDelta: result.relationDelta,
        patrols: result.patrols,
      },
    });
  }
}

function activatePanelAction(
  world: World,
  panel: EmergencyPanelInstance,
  def: EmergencyPanelDef,
  action: PanelAction,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
): PanelActionResult {
  if (action === 'repair') consumeCost(player, def.repairCost);
  const rooms = affectedRooms(world, panel);
  const owner = territoryFactionAt(world, panel.x, panel.y);
  const domainEffect = applyDomainEffect(world, rooms, panel, def, action);
  const severity = actionSeverity(action);
  const relationDelta = applyInfrastructureRelationResponse(owner, action);
  const patrols = alertLocalPatrols(world, panel, entities, player, owner, severity);
  const spawned = (action === 'shutdown' || action === 'overload')
    ? spawnPanelThreat(world, rooms, entities, nextId, player, def) + spawnPanelInspector(world, panel, entities, owner)
    : action === 'force'
      ? spawnPanelInspector(world, panel, entities, owner)
      : 0;

  panel.status = actionStatus(action);
  panel.usedAt = state.time;
  const message = action === 'repair'
    ? `${def.shortName}: ремонт принят. Локальный контур стал тише.`
    : action === 'shutdown'
      ? `${def.shortName}: контур отключен. Кто-то услышал щелчок.`
      : action === 'force'
        ? `${def.shortName}: пломба сорвана. Доступ открыт, тревога пошла.`
        : `${def.shortName}: перегруз прошел грубо. Коридор отвечает шумом.`;
  const result: PanelActionResult = {
    ...domainEffect,
    message,
    color: action === 'repair' ? '#8f8' : action === 'shutdown' ? '#fc8' : action === 'force' ? '#fba' : '#f68',
    severity,
    spawned,
    patrols,
    relationDelta,
  };
  publishPanelEvents(world, player, state, panel, def, action, result, owner);
  return result;
}

function buildOptions(panel: EmergencyPanelInstance, def: EmergencyPanelDef, player: Entity): EmergencyPanelMenuOption[] {
  const repaired = panel.status === 'repaired';
  const shutdown = panel.status === 'shutdown';
  const forced = panel.status === 'forced';
  const overloaded = panel.status === 'overloaded';
  const repairCost = costLine(def.repairCost);
  const canRepair = !repaired && hasCost(player, def.repairCost);
  return [
    {
      id: 'repair',
      label: def.actionLabels.repair,
      detail: 'Стабилизирует комнату и уменьшает локальную угрозу.',
      enabled: canRepair,
      disabledReason: repaired ? 'уже починено' : `нужно: ${repairCost}`,
      costLine: repairCost,
    },
    {
      id: 'shutdown',
      label: def.actionLabels.shutdown,
      detail: 'Меняет локальный свет, воду, двери или туман без расходников.',
      enabled: !shutdown,
      disabledReason: shutdown ? 'контур уже отключен' : undefined,
    },
    {
      id: 'force',
      label: def.actionLabels.force,
      detail: 'Открывает обходы и контейнеры, но оставляет след для хозяев зоны.',
      enabled: !forced,
      disabledReason: forced ? 'пломба уже сорвана' : undefined,
    },
    {
      id: 'overload',
      label: def.actionLabels.overload,
      detail: 'Самый сильный локальный эффект: шум, тревога и ответ из темноты.',
      enabled: !overloaded,
      disabledReason: overloaded ? 'контур уже перегружен' : undefined,
    },
    {
      id: 'leave',
      label: 'Уйти от щитка',
      detail: 'Не трогать аварийный контур.',
      enabled: true,
    },
  ];
}

export function isEmergencyPanelMenuOpen(): boolean {
  return menuState !== null;
}

export function closeEmergencyPanelMenu(): void {
  menuState = null;
}

export function getEmergencyPanelMenuSnapshot(player: Entity): EmergencyPanelMenuSnapshot | null {
  if (!menuState) return null;
  const panel = getPanelAtIdx(menuState.world, menuState.idx);
  const def = panel ? getEmergencyPanelDef(panel.defId) : undefined;
  if (!panel || !def) {
    menuState = null;
    return null;
  }
  const room = panel.roomId >= 0 ? menuState.world.rooms[panel.roomId] : undefined;
  const options = buildOptions(panel, def, player);
  menuState.selected = Math.max(0, Math.min(menuState.selected, options.length - 1));
  return {
    open: true,
    title: def.name,
    subtitle: room?.name ?? `зона ${panel.zoneId + 1}`,
    status: statusLine(panel.status),
    color: def.color,
    selected: menuState.selected,
    options,
    message: menuState.message,
  };
}

export function handleEmergencyPanelMenuInput(
  input: EmergencyPanelMenuInput,
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
): EmergencyPanelMenuResult {
  if (!menuState) return { handled: false, worldChanged: false };
  if (menuState.world !== world) {
    menuState = null;
    return { handled: true, worldChanged: false };
  }
  const panel = getPanelAtIdx(world, menuState.idx);
  const def = panel ? getEmergencyPanelDef(panel.defId) : undefined;
  if (!panel || !def) {
    menuState = null;
    return { handled: true, worldChanged: false };
  }
  const options = buildOptions(panel, def, player);
  if (input.close) {
    menuState = null;
    return { handled: true, worldChanged: false };
  }
  if (input.up) menuState.selected = (menuState.selected + options.length - 1) % options.length;
  if (input.down) menuState.selected = (menuState.selected + 1) % options.length;
  if (!input.confirm) return { handled: true, worldChanged: false };

  const option = options[menuState.selected] ?? options[0];
  if (option.id === 'leave') {
    state.msgs.push(msg('Щиток оставлен как есть.', state.time, '#888'));
    menuState = null;
    return { handled: true, worldChanged: false };
  }
  if (!option.enabled) {
    menuState.message = option.disabledReason ?? 'Нельзя выполнить.';
    state.msgs.push(msg(menuState.message, state.time, '#f84'));
    return { handled: true, worldChanged: false };
  }
  const result = activatePanelAction(world, panel, def, option.id, player, entities, state, nextId);
  menuState.message = result.message;
  state.msgs.push(msg(result.message, state.time, result.color));
  if (result.spawned > 0) state.msgs.push(msg('На шум аварийки кто-то вышел.', state.time, '#f66'));
  return { handled: true, worldChanged: result.worldChanged };
}
