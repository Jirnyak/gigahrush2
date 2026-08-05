import { stampSurfaceSplat } from './surface_marks';
import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  RoomType,
  type Entity,
  type GameState,
  type Item,
  type Msg,
  type Quest,
  type Room,
  type WorldContainer,
  msg,
  QuestType,
} from '../core/types';
import { type World } from '../core/world';
import {
  CONTRACTS,
  GOVNYAK_COURIER_CONTRACT_IDS,
  GOVNYAK_COURIER_PACKAGE_ITEM,
  type ContractDef,
  type QuestRouteTarget,
  contractToQuest,
  questTargetRoute,
  questTargetEventData,
  setQuestTargetRoute,
} from '../data/contracts';
import { ITEMS } from '../data/catalog';
import { addFactionRelMutual } from '../data/relations';
import { MONSTERS } from '../entities/monster';
import { monsterSpr, Spr } from '../render/sprite_index';
import { hashSeed } from '../core/rand';
import { getResourceContractPressure } from './economy';
import { publishEvent } from './events';
import { addItem, removeItem } from './inventory';
import {
  currentFloorRunEntry,
  ensureFloorRunState,
  floorRunEntryFloorKey,
  floorRunEntryForDesignFloor,
  isCurrentStoryFloor,
  type FloorRunEntry,
} from './procedural_floors';
import {
  FLOOR_ANOMALIES,
  FLOOR_GEOMETRIES,
  FLOOR_MAJORITY_FACTIONS,
  FLOOR_RUN_MAX_Z,
  FLOOR_RUN_MIN_Z,
  isProceduralFloorZ,
  proceduralFloorKey,
  storyFloorAtZ,
  zForStoryFloor,
  type ProceduralFloorSpec,
} from '../data/procedural_floors';
import { designFloorAtZ, designFloorById } from '../data/design_floors';
import { assignProceduralQuestDeadline } from './quest_deadlines';
import { canSpawnEntityType, entitySpawnSlots } from './entity_limits';
import { intContractRewardMult } from './rpg';
import { calculateQuestReward, type QuestRewardObjectiveKind } from './quest_rewards';
import { getAlifeNpcTotalMoney } from './alife';

const CLEANUP_SURFACE_THRESHOLD = 480;
const ZHELEMISH_NII_CONTRACT_ID = 'nii_zhelemish_pure_sample';
const ZHELEMISH_SAMPLE_SEALED = 'zhelemish_sample_sealed';
const ZHELEMISH_SAMPLE_CONTAMINATED = 'zhelemish_sample_contaminated';
const ZHELEMISH_SAMPLE_ZONE_TAG = 'zhelemish_sample_site';
const GOVNYAK_COURIER_ROUTE_SET = new Set<string>(GOVNYAK_COURIER_CONTRACT_IDS);
const CONTRACT_BY_ID = new Map<string, ContractDef>();
for (const def of CONTRACTS) {
  if (!CONTRACT_BY_ID.has(def.id)) CONTRACT_BY_ID.set(def.id, def);
}
const GOVNYAK_COURIER_DEFS: readonly ContractDef[] = GOVNYAK_COURIER_CONTRACT_IDS
  .map(id => CONTRACT_BY_ID.get(id))
  .filter((def): def is ContractDef => def !== undefined);

interface ZhelemishNiiTarget {
  kind: 'procedural_mushroom' | 'living_cellar';
  targetKey: string;
  floor: FloorLevel;
  roomType: RoomType;
  roomName?: string;
  z?: number;
  danger: number;
}

interface ZhelemishSampleData {
  ag105ZhelemishSample: true;
  contractId: string;
  quality: 'sealed' | 'contaminated';
  targetKey: string;
  sourceZ?: number;
  sourceRoom?: string;
}

type ContractStateHost = GameState & { zhelemishNiiTarget?: ZhelemishNiiTarget };

export interface QuestTargetRoomResolution {
  room: Room;
  container?: WorldContainer;
  source: 'quest_room' | 'tagged_container' | 'room_type';
}

const CONTRACT_FLOOR_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Мясной низ',
  [FloorLevel.VOID]: 'Пустота',
};

const GOVNYAK_COURIER_OUTCOMES: Record<string, {
  id: string;
  label: string;
  message: string;
  consequence: string;
  penaltyFaction?: Faction;
  penaltyDelta?: number;
}> = {
  govnyak_courier_deliver: {
    id: 'delivery',
    label: 'доставка',
    message: 'Пакет ушёл исходному покупателю. В тетради 88 исчезла одна мелкая строка долга.',
    consequence: 'market88_debt_line_erased',
  },
  govnyak_courier_confiscate: {
    id: 'confiscation',
    label: 'конфискация',
    message: 'Пакет приняли под акт. Рынок запомнил, что вы умеете ходить в окна.',
    consequence: 'market_suspicion',
    penaltyFaction: Faction.WILD,
    penaltyDelta: -6,
  },
  govnyak_courier_switch: {
    id: 'switch',
    label: 'смена адреса',
    message: 'Пакет сменил хозяина. Старый покупатель уже спрашивает у лифтов, кто видел курьера.',
    consequence: 'ambush_rumor',
    penaltyFaction: Faction.CITIZEN,
    penaltyDelta: -8,
  },
};

function formatFloorZ(z: number): string {
  return z > 0 ? `+${z}` : `${z}`;
}

function routeZ(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const z = Math.trunc(value);
  return z >= FLOOR_RUN_MIN_Z && z <= FLOOR_RUN_MAX_Z ? z : undefined;
}

function proceduralSpecRouteTags(spec: ProceduralFloorSpec): Set<string> {
  const tags = new Set<string>([
    spec.key,
    spec.geometryId,
    spec.majorityId,
    spec.anomalyId,
    `danger_${spec.danger}`,
    `z_${spec.z}`,
  ]);
  const geometry = FLOOR_GEOMETRIES.find(def => def.id === spec.geometryId);
  const majority = FLOOR_MAJORITY_FACTIONS.find(def => def.id === spec.majorityId);
  const anomaly = FLOOR_ANOMALIES.find(def => def.id === spec.anomalyId);
  for (const tag of geometry?.tags ?? []) tags.add(tag);
  for (const tag of majority?.tags ?? []) tags.add(tag);
  for (const tag of anomaly?.tags ?? []) tags.add(tag);
  return tags;
}

function proceduralSpecMatchesRoute(spec: ProceduralFloorSpec, route: QuestRouteTarget, baseFloor?: FloorLevel): boolean {
  if (baseFloor !== undefined && spec.baseFloor !== baseFloor) return false;
  if (route.z !== undefined && spec.z !== route.z) return false;
  if (route.anomalyId !== undefined && spec.anomalyId !== route.anomalyId) return false;
  if (route.tags?.length) {
    const specTags = proceduralSpecRouteTags(spec);
    for (const tag of route.tags) if (!specTags.has(tag)) return false;
  }
  return route.anomalyId !== undefined || route.tags !== undefined || route.z !== undefined;
}

function resolveProceduralRouteTarget(
  state: GameState,
  route: QuestRouteTarget,
  baseFloor?: FloorLevel,
): ProceduralFloorSpec | undefined {
  const run = ensureFloorRunState(state);
  if (route.z !== undefined && isProceduralFloorZ(route.z)) {
    const spec = run.specs[proceduralFloorKey(route.z)];
    return spec && proceduralSpecMatchesRoute(spec, route, baseFloor) ? spec : undefined;
  }

  let best: ProceduralFloorSpec | undefined;
  let bestScore = -Infinity;
  for (const spec of Object.values(run.specs)) {
    if (!proceduralSpecMatchesRoute(spec, route, baseFloor)) continue;
    const visitedPenalty = run.visited[spec.key] ? 12 : 0;
    const score = spec.danger * 20 - Math.abs(spec.z - run.currentZ) - visitedPenalty;
    if (score > bestScore || (score === bestScore && (!best || spec.z < best.z))) {
      best = spec;
      bestScore = score;
    }
  }
  return best;
}

function routeBaseFloor(state: GameState, route: QuestRouteTarget, fallback?: FloorLevel): FloorLevel | undefined {
  const z = routeZ(route.z) ?? (route.designFloorId ? designFloorById(route.designFloorId)?.z : undefined);
  if (z !== undefined) {
    const storyFloor = storyFloorAtZ(z);
    if (storyFloor !== undefined) return storyFloor;
    const designFloor = designFloorAtZ(z);
    if (designFloor) return designFloor.baseFloor;
    const spec = ensureFloorRunState(state).specs[proceduralFloorKey(z)];
    if (spec) return spec.baseFloor;
  }
  return fallback;
}

function routeTargetFromSpec(route: QuestRouteTarget, spec: ProceduralFloorSpec): QuestRouteTarget {
  return {
    ...route,
    z: spec.z,
    anomalyId: route.anomalyId ?? (spec.anomalyId === 'none' ? undefined : spec.anomalyId),
    label: route.label ?? proceduralRouteLabel(spec),
  };
}

function normalizeQuestRouteTarget(q: Quest, state: GameState): QuestRouteTarget | undefined {
  const route = questTargetRoute(q);
  if (!route) return undefined;

  let normalized: QuestRouteTarget = { ...route };
  const design = route.designFloorId ? designFloorById(route.designFloorId) : undefined;
  const z = routeZ(route.z) ?? design?.z;
  if (z !== undefined) {
    normalized.z = z;
    const atZ = designFloorAtZ(z);
    if (atZ) {
      normalized.designFloorId = route.designFloorId ?? atZ.id;
      normalized.label = route.label ?? `Z${formatFloorZ(z)} ${atZ.displayName}`;
    } else if (isProceduralFloorZ(z)) {
      const spec = ensureFloorRunState(state).specs[proceduralFloorKey(z)];
      if (spec) normalized = routeTargetFromSpec(normalized, spec);
      else normalized.label = route.label ?? `Z${formatFloorZ(z)}`;
    } else {
      const storyFloor = storyFloorAtZ(z);
      normalized.label = route.label ?? (storyFloor !== undefined ? `Z${formatFloorZ(z)} ${CONTRACT_FLOOR_NAMES[storyFloor]}` : `Z${formatFloorZ(z)}`);
    }
  } else {
    const spec = resolveProceduralRouteTarget(state, route, q.targetFloor);
    if (spec) normalized = routeTargetFromSpec(normalized, spec);
  }

  const baseFloor = routeBaseFloor(state, normalized, q.targetFloor);
  if (baseFloor !== undefined) {
    q.targetFloor = baseFloor;
    if (q.type === QuestType.VISIT) q.visitFloor = baseFloor;
  }
  setQuestTargetRoute(q, normalized);
  return normalized;
}

function proceduralRouteLabel(spec: ProceduralFloorSpec): string {
  const geometry = FLOOR_GEOMETRIES.find(def => def.id === spec.geometryId)?.title ?? spec.geometryId;
  const majority = FLOOR_MAJORITY_FACTIONS.find(def => def.id === spec.majorityId)?.title ?? spec.majorityId;
  const anomaly = FLOOR_ANOMALIES.find(def => def.id === spec.anomalyId)?.title ?? spec.anomalyId;
  return `Z${formatFloorZ(spec.z)} ${geometry}, ${majority}, ${anomaly}`;
}

function routeLabelFromTarget(route: QuestRouteTarget | undefined, state?: GameState): string {
  if (!route) return '';
  if (route.label) return route.label;
  const z = routeZ(route.z) ?? (route.designFloorId ? designFloorById(route.designFloorId)?.z : undefined);
  if (z !== undefined) {
    const design = designFloorAtZ(z);
    if (design) return `Z${formatFloorZ(z)} ${design.displayName}`;
    if (state && isProceduralFloorZ(z)) {
      const spec = ensureFloorRunState(state).specs[proceduralFloorKey(z)];
      if (spec) return proceduralRouteLabel(spec);
    }
    return `Z${formatFloorZ(z)}`;
  }
  const parts: string[] = [];
  if (route.designFloorId) parts.push(route.designFloorId);
  if (route.anomalyId) parts.push(route.anomalyId);
  if (route.tags?.length) parts.push(route.tags.join('+'));
  return parts.length > 0 ? parts.join(' ') : '';
}

function routeShortLabelFromTarget(route: QuestRouteTarget | undefined): string {
  if (!route) return '';
  const z = routeZ(route.z) ?? (route.designFloorId ? designFloorById(route.designFloorId)?.z : undefined);
  if (z !== undefined) return `Z${formatFloorZ(z)}`;
  if (route.designFloorId) return 'ROUTE';
  if (route.anomalyId) return 'ANOM';
  if (route.tags?.length) return 'TAG';
  return '';
}

export function questRouteTargetLabel(q: Quest, state?: GameState): string {
  return routeLabelFromTarget(questTargetRoute(q), state);
}

export function questRouteTargetShortLabel(q: Quest): string {
  return routeShortLabelFromTarget(questTargetRoute(q));
}

function entryMatchesRouteTarget(entry: FloorRunEntry, route: QuestRouteTarget, state: GameState): boolean {
  const normalizedZ = routeZ(route.z) ?? (route.designFloorId ? designFloorById(route.designFloorId)?.z : undefined);
  if (normalizedZ !== undefined && entry.z !== normalizedZ) return false;
  if (route.designFloorId !== undefined && entry.designFloorId !== route.designFloorId) {
    const effective = floorRunEntryForDesignFloor(state, route.designFloorId);
    if (!effective || floorRunEntryFloorKey(effective) !== floorRunEntryFloorKey(entry)) return false;
  }
  if (route.anomalyId !== undefined && entry.spec?.anomalyId !== route.anomalyId) return false;
  if (route.tags?.length) {
    if (!entry.spec) return false;
    const tags = proceduralSpecRouteTags(entry.spec);
    for (const tag of route.tags) if (!tags.has(tag)) return false;
  }
  if (normalizedZ === undefined && route.designFloorId === undefined && route.anomalyId === undefined && !route.tags?.length) {
    const baseFloor = routeBaseFloor(state, route);
    return baseFloor === undefined || entry.baseFloor === baseFloor;
  }
  return true;
}

function routeHasPositionalTarget(route: QuestRouteTarget | undefined): route is QuestRouteTarget {
  if (!route) return false;
  return routeZ(route.z) !== undefined ||
    route.designFloorId !== undefined ||
    route.anomalyId !== undefined ||
    (route.tags?.length ?? 0) > 0;
}

function enrichRouteHint(q: Quest, state: GameState): void {
  const label = questRouteTargetLabel(q, state);
  if (!label) return;
  if (q.targetHint?.includes(label)) return;
  q.targetHint = q.targetHint ? `Маршрут ${label}. ${q.targetHint}` : `Маршрут ${label}.`;
}

function zhelemishSampleData(data: unknown): ZhelemishSampleData | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const sample = data as Partial<ZhelemishSampleData>;
  return sample.ag105ZhelemishSample === true ? sample as ZhelemishSampleData : undefined;
}

function validStoredZhelemishTarget(state: GameState, target: ZhelemishNiiTarget | undefined): ZhelemishNiiTarget | undefined {
  if (!target) return undefined;
  if (target.kind === 'living_cellar') return target;
  const spec = ensureFloorRunState(state).specs[target.targetKey];
  if (!spec || spec.anomalyId !== 'mushroom_mycelium') return undefined;
  return { ...target, floor: spec.baseFloor, z: spec.z, danger: spec.danger };
}

function ensureZhelemishTarget(state: GameState): ZhelemishNiiTarget {
  const host = state as ContractStateHost;
  const stored = validStoredZhelemishTarget(state, host.zhelemishNiiTarget);
  if (stored) {
    host.zhelemishNiiTarget = stored;
    return stored;
  }

  const run = ensureFloorRunState(state);
  const best = Object.values(run.specs)
    .filter(spec => spec.anomalyId === 'mushroom_mycelium')
    .sort((a, b) => {
      const aScore = a.danger * 100 - Math.abs(a.z - run.currentZ) * 2 - (run.visited[a.key] ? 25 : 0);
      const bScore = b.danger * 100 - Math.abs(b.z - run.currentZ) * 2 - (run.visited[b.key] ? 25 : 0);
      return bScore - aScore;
    })[0];

  if (best) {
    host.zhelemishNiiTarget = {
      kind: 'procedural_mushroom',
      targetKey: best.key,
      floor: best.baseFloor,
      roomType: RoomType.PRODUCTION,
      z: best.z,
      danger: best.danger,
    };
    return host.zhelemishNiiTarget;
  }

  host.zhelemishNiiTarget = {
    kind: 'living_cellar',
    targetKey: 'living_mushroom_cellar',
    floor: FloorLevel.LIVING,
    roomType: RoomType.PRODUCTION,
    roomName: 'Грибная прачечная первой смены',
    danger: 2,
  };
  return host.zhelemishNiiTarget;
}

function zhelemishTargetHint(target: ZhelemishNiiTarget): string {
  if (target.kind === 'procedural_mushroom') {
    return `НИИ: Z${formatFloorZ(target.z ?? 0)}, процедурная грибница (${CONTRACT_FLOOR_NAMES[target.floor]}-основа). Ищите аппаратуру/стеллажи с желемышем; сдавайте только запечатанную пробу.`;
  }
  return 'Жилая зона: грибная прачечная первой смены. Ищите аппаратный стол с пломбой НИИ; открытый комок будет загрязнён.';
}

export function prepareAcceptedContract(q: Quest, state: GameState): void {
  normalizeQuestRouteTarget(q, state);
  enrichRouteHint(q, state);
  if (q.contractId !== ZHELEMISH_NII_CONTRACT_ID) return;
  const target = ensureZhelemishTarget(state);
  q.targetItem = ZHELEMISH_SAMPLE_SEALED;
  q.targetCount = 1;
  q.targetFloor = target.floor;
  q.targetRoomType = target.roomType;
  q.targetZoneTag = ZHELEMISH_SAMPLE_ZONE_TAG;
  q.targetHint = zhelemishTargetHint(target);
  setQuestTargetRoute(q, target.kind === 'procedural_mushroom'
    ? {
      z: target.z,
      anomalyId: 'mushroom_mycelium',
      tags: ['mushroom'],
      label: `Z${formatFloorZ(target.z ?? 0)} грибница`,
    }
    : undefined);
  enrichRouteHint(q, state);
}

function publishContractFailure(state: GameState, reason: string): void {
  publishEvent(state, {
    type: 'contract_failed',
    severity: 2,
    privacy: 'private',
    tags: ['contract', 'failed', reason],
    data: { reason },
  });
}

export function isGovnyakCourierContractId(contractId: string | undefined): boolean {
  return contractId !== undefined && GOVNYAK_COURIER_ROUTE_SET.has(contractId);
}

export function isContractHiddenForAssignment(def: ContractDef): boolean {
  return def.tags.includes('debug_only');
}

function contractById(contractId: string | undefined): ContractDef | undefined {
  return contractId === undefined ? undefined : CONTRACT_BY_ID.get(contractId);
}

function questObjectiveKindForContract(def: ContractDef): QuestRewardObjectiveKind {
  if (def.tags.includes('repair')) return 'repair';
  if (def.tags.includes('theft') || def.tags.includes('steal')) return 'steal';
  if (def.tags.includes('expose') || def.tags.includes('audit')) return 'expose';
  switch (def.type) {
    case QuestType.TALK: return 'talk';
    case QuestType.VISIT: return def.tags.includes('hold') || def.tags.includes('defend') ? 'hold' : 'visit';
    case QuestType.KILL: return 'kill';
    case QuestType.FETCH:
    default: return 'fetch';
  }
}

function contractTargetZ(def: ContractDef, q: Quest): number {
  const route = questTargetRoute(q);
  if (route?.z !== undefined) return route.z;
  if (route?.designFloorId) return designFloorById(route.designFloorId)?.z ?? zForStoryFloor(def.target.floor);
  return zForStoryFloor(def.target.floor);
}

function contractTargetDanger(state: GameState, def: ContractDef, q: Quest): 1 | 2 | 3 | 4 | 5 {
  const route = questTargetRoute(q);
  if (route?.risk !== undefined) return Math.max(1, Math.min(5, Math.round(route.risk))) as 1 | 2 | 3 | 4 | 5;
  if (route?.designFloorId) return Math.max(1, Math.min(5, designFloorById(route.designFloorId)?.danger ?? def.rank)) as 1 | 2 | 3 | 4 | 5;
  if (route?.z !== undefined && isProceduralFloorZ(route.z)) {
    const spec = ensureFloorRunState(state).specs[proceduralFloorKey(route.z)];
    if (spec) return spec.danger;
  }
  return Math.max(1, Math.min(5, def.rank)) as 1 | 2 | 3 | 4 | 5;
}

function contractObjectiveValue(def: ContractDef): number {
  const itemValue = def.targetItem ? (ITEMS[def.targetItem]?.value ?? 0) * Math.max(1, def.targetCount ?? 1) : 0;
  const killValue = def.type === QuestType.KILL ? 90 * Math.max(1, def.killNeeded ?? 1) * Math.max(1, def.rank) : 0;
  return Math.max(itemValue, killValue, def.moneyReward);
}

export function applyContractRewardAtAcceptance(
  q: Quest,
  def: ContractDef,
  state: GameState,
  player?: Entity,
  giver?: Entity,
): void {
  const current = currentFloorRunEntry(state);
  const targetZ = contractTargetZ(def, q);
  const danger = contractTargetDanger(state, def, q);
  const scarcityMult = def.rewardResourceId
    ? getResourceContractPressure(state, def.rewardResourceId, def.target.floor, def.rewardScarcityMax ?? 3)
    : 1;
  const playerRewardMult = player?.rpg ? intContractRewardMult(player.rpg) : 1;
  const reward = calculateQuestReward({
    objectiveKind: questObjectiveKindForContract(def),
    objectiveValue: contractObjectiveValue(def),
    objectiveCount: 1,
    currentZ: current.z,
    targetZ,
    routeDistance: Math.abs(targetZ - current.z) * 24,
    danger,
    plotPhase: 0,
    giverLevel: giver?.rpg?.level ?? def.rank,
    giverWealth: getAlifeNpcTotalMoney(state, giver) ?? ((giver?.money ?? 0) + (giver?.accountRubles ?? 0)),
    giverFaction: giver?.faction ?? def.faction,
    risk: questTargetRoute(q)?.risk ?? def.rank,
    scarcityMult,
    playerRewardMult,
    authoredBaseMoney: def.moneyReward,
    authoredBaseXp: def.xpReward,
    tags: def.tags,
  });
  q.difficulty = reward.difficulty;
  q.moneyReward = reward.moneyReward;
  q.xpReward = reward.xpReward;
}

export function questRouteFloor(q: Quest): FloorLevel | undefined {
  return q.targetFloor ?? q.visitFloor;
}

export function isQuestTargetOnCurrentFloor(q: Quest, state: GameState): boolean {
  const route = questTargetRoute(q);
  if (routeHasPositionalTarget(route)) return entryMatchesRouteTarget(currentFloorRunEntry(state), route, state);
  const floor = questRouteFloor(q);
  if (floor === undefined) return true;
  return isCurrentStoryFloor(state, floor);
}

export function questRequiresRouteTravel(q: Quest, state: GameState): boolean {
  if (questRouteFloor(q) === undefined && !questTargetRoute(q)) return false;
  return !isQuestTargetOnCurrentFloor(q, state);
}

export function questTargetLiftDirection(q: Quest, state: GameState): LiftDirection | undefined {
  const floor = questRouteFloor(q);
  const route = questTargetRoute(q);
  const positionalRoute = routeHasPositionalTarget(route) ? route : undefined;
  if ((floor === undefined && !positionalRoute) || isQuestTargetOnCurrentFloor(q, state)) return undefined;
  const currentZ = currentFloorRunEntry(state).z;
  const targetZ = routeZ(positionalRoute?.z) ?? (positionalRoute?.designFloorId ? designFloorById(positionalRoute.designFloorId)?.z : undefined) ?? (floor !== undefined ? zForStoryFloor(floor) : undefined);
  if (targetZ === undefined) return undefined;
  if (currentZ === targetZ) return undefined;
  return targetZ < currentZ ? LiftDirection.DOWN : LiftDirection.UP;
}

function roomMatchesQuestType(q: Quest, room: Room): boolean {
  return q.targetRoomType === undefined || room.type === q.targetRoomType;
}

function roomHasTaggedContainer(world: World, roomId: number, tag: string): boolean {
  for (const c of world.containers) {
    if (c.roomId === roomId && c.tags.includes(tag)) return true;
  }
  return false;
}

function worldHasTaggedContainer(world: World, tag: string): boolean {
  for (const c of world.containers) if (c.tags.includes(tag)) return true;
  return false;
}

function roomStillMatchesQuest(world: World, q: Quest, room: Room): boolean {
  if (q.targetRoomName !== undefined && room.name !== q.targetRoomName) return false;
  if (!roomMatchesQuestType(q, room)) return false;
  return !q.targetZoneTag
    || !worldHasTaggedContainer(world, q.targetZoneTag)
    || roomHasTaggedContainer(world, room.id, q.targetZoneTag);
}

function roomDistanceScore(world: World, room: Room, origin?: Pick<Entity, 'x' | 'y'>): number {
  const area = room.w * room.h;
  if (!origin) return area;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  return area * 0.01 - world.dist2(origin.x, origin.y, cx, cy);
}

function resolveByTaggedContainer(
  world: World,
  q: Quest,
  origin?: Pick<Entity, 'x' | 'y'>,
): QuestTargetRoomResolution | undefined {
  const tag = q.targetZoneTag;
  if (!tag) return undefined;
  let best: QuestTargetRoomResolution | undefined;
  let bestScore = -Infinity;
  for (const c of world.containers) {
    if (!c.tags.includes(tag)) continue;
    const room = world.rooms[c.roomId] ?? world.roomAt(c.x, c.y);
    if (!room || !roomMatchesQuestType(q, room)) continue;
    const score = roomDistanceScore(world, room, origin);
    if (score > bestScore) {
      best = { room, container: c, source: 'tagged_container' };
      bestScore = score;
    }
  }
  return best;
}

function resolveByRoomType(
  world: World,
  q: Quest,
  origin?: Pick<Entity, 'x' | 'y'>,
): QuestTargetRoomResolution | undefined {
  if (q.targetRoomType === undefined) return undefined;
  let best: Room | undefined;
  let bestScore = -Infinity;
  for (const room of world.rooms) {
    if (!room || room.type !== q.targetRoomType) continue;
    const score = roomDistanceScore(world, room, origin);
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best ? { room: best, source: 'room_type' } : undefined;
}

function resolveByRoomName(
  world: World,
  q: Quest,
  origin?: Pick<Entity, 'x' | 'y'>,
): QuestTargetRoomResolution | undefined {
  if (!q.targetRoomName) return undefined;
  let best: Room | undefined;
  let bestScore = -Infinity;
  for (const room of world.rooms) {
    if (!room || room.name !== q.targetRoomName || !roomMatchesQuestType(q, room)) continue;
    const score = roomDistanceScore(world, room, origin);
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best ? { room: best, source: 'room_type' } : undefined;
}

export function resolveQuestTargetRoom(
  world: World,
  q: Quest,
  origin?: Pick<Entity, 'x' | 'y'>,
): QuestTargetRoomResolution | undefined {
  if (q.targetRoom !== undefined) {
    const room = world.rooms[q.targetRoom];
    if (room && roomStillMatchesQuest(world, q, room)) return { room, source: 'quest_room' };
  }
  return resolveByTaggedContainer(world, q, origin) ?? resolveByRoomName(world, q, origin) ?? resolveByRoomType(world, q, origin);
}

function createContractQuest(def: ContractDef, state: GameState, giver?: { id: number; name?: string }, player?: Entity) {
  const quest = contractToQuest(def, state.nextQuestId++, giver);
  prepareAcceptedContract(quest, state);
  applyContractRewardAtAcceptance(quest, def, state, player);
  return quest;
}

function publishContractCreated(
  state: GameState,
  def: ContractDef,
  quest: Quest,
  sourceTags: string[] = [],
  rumorIds?: string[],
): void {
  publishEvent(state, {
    type: 'contract_created',
    actorName: def.issuer,
    actorFaction: def.faction,
    targetName: def.title,
    severity: 3,
    privacy: 'local',
    tags: ['quest', 'contract', 'created', ...sourceTags, ...def.tags],
    data: {
      contractId: def.id,
      questType: quest.type,
      rank: def.rank,
      targetItem: quest.targetItem,
      targetMonsterKind: quest.targetMonsterKind,
      targetPlotNpcId: quest.targetPlotNpcId,
      rewardResourceId: def.rewardResourceId,
      rumorIds,
      ...questTargetEventData(quest),
    },
  });
}

function inventoryCount(player: Entity, defId: string): number {
  return (player.inventory ?? []).reduce((sum, slot) => slot.defId === defId ? sum + slot.count : sum, 0);
}

function isCleanupTargetRoom(world: World, state: GameState, def: ContractDef, x: number, y: number): boolean {
  if (!def.tags.includes('cleanup') || def.target.floor !== state.currentFloor) return false;
  const room = world.roomAt(x, y);
  if (!room) return false;
  if (def.target.roomName && room.name !== def.target.roomName) return false;
  if (def.target.roomType !== undefined && room.type !== def.target.roomType) return false;
  return true;
}

export function notifyCleanupToolUse(
  player: Entity,
  world: World,
  state: GameState,
  x: number,
  y: number,
  cleanedSurface: number,
  cleanedHazards = 0,
): boolean {
  if (cleanedSurface < CLEANUP_SURFACE_THRESHOLD && cleanedHazards <= 0) return false;

  for (const q of activeContracts(state)) {
    if (q.type !== QuestType.FETCH || !q.targetItem || !q.contractId) continue;
    const def = contractById(q.contractId);
    if (!def || !isCleanupTargetRoom(world, state, def, x, y)) continue;

    const needed = q.targetCount ?? 1;
    const have = inventoryCount(player, q.targetItem);
    if (have >= needed) return false;
    if (!addItem(player, q.targetItem, needed - have)) {
      state.msgs.push(msg('Нет места для акта зачистки.', state.time, '#f84'));
      return false;
    }

    const room = world.roomAt(x, y);
    state.msgs.push(msg(`Зачистка принята: ${room?.name ?? def.title}. Акт обработки получен.`, state.time, '#8f8'));
    return true;
  }

  return false;
}

function contractSampleInInventory(player: Entity, defId: string, contractId: string): boolean {
  return (player.inventory ?? []).some(slot => {
    if (slot.defId !== defId) return false;
    const sample = zhelemishSampleData(slot.data);
    return !sample || sample.contractId === contractId;
  });
}

function findContaminatedContractSample(player: Entity, contractId: string): Item | undefined {
  return (player.inventory ?? []).find(slot => {
    if (slot.defId !== ZHELEMISH_SAMPLE_CONTAMINATED) return false;
    return zhelemishSampleData(slot.data)?.contractId === contractId;
  });
}

function currentFloorMatchesZhelemishTarget(state: GameState, target: ZhelemishNiiTarget): boolean {
  const entry = currentFloorRunEntry(state);
  if (target.kind === 'procedural_mushroom') return entry.spec?.key === target.targetKey;
  return entry.storyFloor === FloorLevel.LIVING && state.currentFloor === FloorLevel.LIVING;
}

function currentFloorIsWrongZhelemishMycelium(state: GameState, target: ZhelemishNiiTarget): boolean {
  if (target.kind !== 'procedural_mushroom') return false;
  const entry = currentFloorRunEntry(state);
  return entry.spec?.anomalyId === 'mushroom_mycelium' && entry.spec.key !== target.targetKey;
}

function existingSampleDrop(entities: Entity[], defId: string, contractId: string): boolean {
  return entities.some(e => {
    if (!e.alive || e.type !== EntityType.ITEM_DROP) return false;
    return (e.inventory ?? []).some(slot => {
      if (slot.defId !== defId) return false;
      return zhelemishSampleData(slot.data)?.contractId === contractId;
    });
  });
}

function chooseZhelemishRoom(world: World, player: Entity, target: ZhelemishNiiTarget): Room | undefined {
  let best: Room | undefined;
  let bestScore = -Infinity;

  for (const room of world.rooms) {
    if (!room || room.w < 4 || room.h < 4) continue;
    if (target.roomName && room.name !== target.roomName && target.kind === 'living_cellar') continue;
    const biologicalRoom = room.type === RoomType.PRODUCTION
      || room.type === RoomType.STORAGE
      || room.type === RoomType.BATHROOM
      || room.type === RoomType.KITCHEN
      || room.type === RoomType.COMMON;
    if (!biologicalRoom) continue;

    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const distScore = Math.min(90000, world.dist2(player.x, player.y, cx, cy));
    const typeScore = room.type === target.roomType ? 30000 : room.type === RoomType.STORAGE ? 12000 : 0;
    const nameScore = target.roomName && room.name === target.roomName ? 100000 : 0;
    const score = nameScore + typeScore + distScore + room.w * room.h;
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }

  return best;
}

function roomFloorCell(world: World, room: Room): { x: number; y: number } | undefined {
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  for (let r = 0; r <= Math.max(room.w, room.h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(cx + dx);
        const y = world.wrap(cy + dy);
        const ci = world.idx(x, y);
        if (world.roomMap[ci] !== room.id) continue;
        if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) return { x, y };
      }
    }
  }
  return undefined;
}

function dropContractSample(
  entities: Entity[],
  nextId: { v: number },
  x: number,
  y: number,
  defId: string,
  data: ZhelemishSampleData,
): void {
  if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) return;
  entities.push({
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count: 1, data }],
  });
}

function markZhelemishSampleSite(world: World, x: number, y: number, sealed: boolean): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  world.setFeatureAt(ci, sealed ? Feature.APPARATUS : Feature.SHELF);
  stampSurfaceSplat(world, x, y, 0.5, 0.5, sealed ? 5 : 3, sealed ? 0.62 : 0.42, 105105 + (sealed ? 1 : 2), 84, sealed ? 150 : 92, sealed ? 72 : 58, false);
}

function guardCell(world: World, room: Room, sampleX: number, sampleY: number, offset: number): { x: number; y: number } | undefined {
  for (let r = 2; r <= Math.max(room.w, room.h); r++) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2 + offset;
      const x = world.wrap(sampleX + Math.round(Math.cos(angle) * r));
      const y = world.wrap(sampleY + Math.round(Math.sin(angle) * r));
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === room.id && world.cells[ci] === Cell.FLOOR) return { x, y };
    }
  }
  return undefined;
}

function spawnZhelemishGuards(world: World, room: Room, entities: Entity[], nextId: { v: number }, target: ZhelemishNiiTarget, x: number, y: number): void {
  const kinds = [MonsterKind.POLZUN, MonsterKind.SBORKA, MonsterKind.ZOMBIE, MonsterKind.TVAR];
  const count = entitySpawnSlots(entities, EntityType.MONSTER, Math.min(4, Math.max(2, target.danger)));
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const def = MONSTERS[kind];
    if (!def) continue;
    const pos = guardCell(world, room, x, y, i * 0.9);
    if (!pos) continue;
    const hp = Math.round(def.hp * (1 + target.danger * 0.12));
    entities.push({
      id: nextId.v++,
      type: EntityType.MONSTER,
      x: pos.x + 0.5,
      y: pos.y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: def.speed * (0.95 + target.danger * 0.03),
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: pos.x, ty: pos.y, path: [], pi: 0, stuck: 0, timer: 0 },
    });
  }
}

export function applyContractFloorHooks(
  state: GameState,
  world: World,
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
): void {
  for (const q of activeContracts(state)) {
    if (q.contractId !== ZHELEMISH_NII_CONTRACT_ID || q.failed) continue;
    prepareAcceptedContract(q, state);

    const target = ensureZhelemishTarget(state);
    const onTargetFloor = currentFloorMatchesZhelemishTarget(state, target);
    const contaminatedFloor = currentFloorIsWrongZhelemishMycelium(state, target);
    if (!onTargetFloor && !contaminatedFloor) continue;

    const defId = onTargetFloor ? ZHELEMISH_SAMPLE_SEALED : ZHELEMISH_SAMPLE_CONTAMINATED;
    if (existingSampleDrop(entities, defId, q.contractId)) continue;
    if (contractSampleInInventory(player, defId, q.contractId)) continue;

    const room = chooseZhelemishRoom(world, player, target);
    if (!room) continue;
    const pos = roomFloorCell(world, room);
    if (!pos) continue;

    const currentSpec = currentFloorRunEntry(state).spec;
    const data: ZhelemishSampleData = {
      ag105ZhelemishSample: true,
      contractId: q.contractId,
      quality: onTargetFloor ? 'sealed' : 'contaminated',
      targetKey: target.targetKey,
      sourceZ: currentSpec?.z,
      sourceRoom: room.name,
    };
    dropContractSample(entities, nextId, pos.x, pos.y, defId, data);
    markZhelemishSampleSite(world, pos.x, pos.y, onTargetFloor);

    if (onTargetFloor) {
      spawnZhelemishGuards(world, room, entities, nextId, target, pos.x, pos.y);
      state.msgs.push(msg('Маркер НИИ пищит: чистый желемыш рядом. Не берите открытые комки.', state.time, '#9f4'));
      publishEvent(state, {
        type: 'rumor_observed',
        roomId: room.id,
        zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
        x: pos.x + 0.5,
        y: pos.y + 0.5,
        targetName: room.name,
        itemId: defId,
        itemName: 'Запечатанный образец желемыша',
        itemCount: 1,
        itemValue: 240,
        severity: 3,
        privacy: 'private',
        tags: ['nii', 'zhelemish', 'sample', 'sealed', 'target_marker'],
        data: { contractId: q.contractId, targetKey: target.targetKey, sourceZ: currentSpec?.z },
      });
    } else {
      state.msgs.push(msg('Полевой акт НИИ предупреждает: этот желемыш не из нужной точки, проба будет грязной.', state.time, '#db6'));
    }
  }
}

export function handleContractQuestItemOutcome(
  q: Quest,
  player: Entity,
  entities: Entity[],
  state: GameState,
  msgs: Msg[],
): boolean {
  if (q.done || q.contractId !== ZHELEMISH_NII_CONTRACT_ID) return false;
  prepareAcceptedContract(q, state);
  const contaminated = findContaminatedContractSample(player, q.contractId);
  if (!contaminated) return false;

  removeItem(player, ZHELEMISH_SAMPLE_CONTAMINATED, 1);
  q.done = true;
  q.failed = true;
  const giver = entities.find(e => e.id === q.giverId);
  if (giver?.questId === q.id) giver.questId = -1;
  msgs.push(msg('НИИ вскрыл акт: образец желемыша загрязнён. Контракт закрыт провалом.', state.time, '#f66'));
  publishEvent(state, {
    type: 'contract_failed',
    actorId: q.giverId,
    actorName: q.giverName,
    actorFaction: giver?.faction ?? q.contractFaction,
    targetName: q.desc,
    itemId: ZHELEMISH_SAMPLE_CONTAMINATED,
    itemName: 'Загрязнённый образец желемыша',
    itemCount: 1,
    itemValue: 18,
    severity: 4,
    privacy: 'local',
    tags: ['quest', 'contract', 'failed', 'contaminated', 'nii', 'zhelemish', 'sample'],
    data: {
      questId: q.id,
      contractId: q.contractId,
      reason: 'contaminated_sample',
      targetItem: q.targetItem,
      contaminatedItem: contaminated.defId,
      ...questTargetEventData(q),
    },
  });
  return true;
}

function activeGovnyakCourierQuests(state: GameState): Quest[] {
  return state.quests.filter(q => !q.done && isGovnyakCourierContractId(q.contractId));
}

function anyGovnyakCourierHistory(state: GameState): boolean {
  return state.quests.some(q => isGovnyakCourierContractId(q.contractId));
}

function govnyakCourierDefs(): readonly ContractDef[] {
  return GOVNYAK_COURIER_DEFS;
}

export function canCompleteGovnyakCourierEndpoint(
  q: Quest,
  player: Entity,
  world: World,
  state: GameState,
): boolean | undefined {
  if (isGovnyakCourierContractId(q.contractId)) {
    if (!isQuestTargetOnCurrentFloor(q, state)) return false;
    if (inventoryCount(player, GOVNYAK_COURIER_PACKAGE_ITEM) < 1) return false;

    if (q.targetRoomType !== undefined) {
      const room = world.roomAt(player.x, player.y);
      if (!room || room.type !== q.targetRoomType) return false;
    }

    return true;
  }

  if (!q.contractId || q.type !== QuestType.VISIT) return undefined;
  const def = contractById(q.contractId);
  if (!def || def.type !== QuestType.VISIT) return undefined;
  if (q.targetRoomType === undefined && !def.target.roomName) return undefined;
  if (!isQuestTargetOnCurrentFloor(q, state)) return false;

  const room = world.roomAt(player.x, player.y);
  if (!room) return false;
  if (q.targetRoomType !== undefined && room.type !== q.targetRoomType) return false;
  if (def.target.roomName && room.name !== def.target.roomName) return false;
  return true;
}

export function govnyakCourierOutcomeEventData(q: Quest): Record<string, unknown> {
  const outcome = q.contractId ? GOVNYAK_COURIER_OUTCOMES[q.contractId] : undefined;
  if (!outcome) return {};
  return {
    courierOutcome: outcome.id,
    packageItem: GOVNYAK_COURIER_PACKAGE_ITEM,
    consequence: outcome.consequence,
  };
}

export function resolveGovnyakCourierOutcome(
  q: Quest,
  player: Entity,
  state: GameState,
  msgs: Msg[],
): boolean {
  const outcome = q.contractId ? GOVNYAK_COURIER_OUTCOMES[q.contractId] : undefined;
  if (!outcome) return false;

  removeItem(player, GOVNYAK_COURIER_PACKAGE_ITEM, 1);
  if (outcome.penaltyFaction !== undefined && outcome.penaltyDelta !== undefined) {
    addFactionRelMutual(Faction.PLAYER, outcome.penaltyFaction, outcome.penaltyDelta);
  }

  for (const other of activeGovnyakCourierQuests(state)) {
    if (other.id === q.id) continue;
    other.done = true;
    other.failed = true;
    publishEvent(state, {
      type: 'contract_failed',
      actorName: other.giverName,
      actorFaction: other.contractFaction,
      targetName: other.desc,
      severity: 3,
      privacy: 'local',
      tags: ['quest', 'contract', 'failed', 'govnyak_courier', 'route_closed'],
      data: {
        questId: other.id,
        contractId: other.contractId,
        contractFaction: other.contractFaction,
        reason: 'route_closed',
        chosenOutcome: outcome.id,
        ...questTargetEventData(other),
      },
    });
  }

  msgs.push(msg(outcome.message, state.time, outcome.id === 'confiscation' ? '#8cf' : outcome.id === 'switch' ? '#d8a' : '#ee4'));
  return true;
}

export function spawnGovnyakCourierContract(
  state: GameState,
  player: Entity,
  giver?: { id: number; name?: string },
): boolean {
  if (anyGovnyakCourierHistory(state) || inventoryCount(player, GOVNYAK_COURIER_PACKAGE_ITEM) > 0) {
    state.msgs.push(msg('[QUEST] Курьерский пакет уже выдан или маршрут закрыт.', state.time, '#f84'));
    publishContractFailure(state, 'govnyak_courier_duplicate');
    return false;
  }

  if (!addItem(player, GOVNYAK_COURIER_PACKAGE_ITEM, 1)) {
    state.msgs.push(msg('[QUEST] Нет места для опечатанного пакета.', state.time, '#f84'));
    publishContractFailure(state, 'govnyak_courier_no_space');
    return false;
  }

  const defs = govnyakCourierDefs();
  if (defs.length !== GOVNYAK_COURIER_CONTRACT_IDS.length) {
    state.msgs.push(msg('[QUEST] Курьерские маршруты не найдены в реестре.', state.time, '#f84'));
    removeItem(player, GOVNYAK_COURIER_PACKAGE_ITEM, 1);
    publishContractFailure(state, 'govnyak_courier_missing_defs');
    return false;
  }

  for (const def of defs) {
    const quest = createContractQuest(def, state, giver, player);
    assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
      crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
    });
    state.quests.push(quest);
    publishContractCreated(state, def, quest);
  }

  publishEvent(state, {
    type: 'player_pick_item',
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: GOVNYAK_COURIER_PACKAGE_ITEM,
    itemName: 'Опечатанный пакет',
    itemCount: 1,
    itemValue: 1,
    severity: 3,
    privacy: 'private',
    tags: ['player', 'inventory', 'govnyak_courier', 'sealed_package'],
    data: {
      routeCount: defs.length,
      packageItem: GOVNYAK_COURIER_PACKAGE_ITEM,
    },
  });
  state.msgs.push(msg('[QUEST] Опечатанный пакет: доставить, сдать или сменить адрес. Маршруты добавлены в журнал.', state.time, '#6cf'));
  return true;
}

export function activeContracts(state: GameState) {
  return state.quests.filter(q => !q.done && q.contractId);
}

function assignedContractIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const q of state.quests) if (q.contractId !== undefined) ids.add(q.contractId);
  return ids;
}

export function listAvailableContracts(state: GameState, limit = 6) {
  const assignedIds = assignedContractIds(state);
  const sliceLimit = Number.isFinite(limit) ? Math.trunc(limit) : Number.POSITIVE_INFINITY;
  if (sliceLimit === 0) return [];

  const currentFloor: ContractDef[] = [];
  const otherFloors: ContractDef[] = [];
  for (const def of CONTRACTS) {
    if (isContractHiddenForAssignment(def) || assignedIds.has(def.id)) continue;
    if (def.target.floor === state.currentFloor) {
      currentFloor.push(def);
    } else {
      otherFloors.push(def);
    }
  }

  const floorRunSeed = (state as { floorRun?: { runSeed?: number } }).floorRun?.runSeed ?? 0;
  const assignmentSeed = hashSeed(`contracts:${state.currentFloor}:${assignedIds.size}`, floorRunSeed);
  const ordered = orderedContractsForAssignment(currentFloor, assignmentSeed)
    .concat(orderedContractsForAssignment(otherFloors, assignmentSeed ^ 0x9e3779b9));
  return sliceLimit > 0 ? ordered.slice(0, sliceLimit) : ordered;
}

function orderedContractsForAssignment(defs: readonly ContractDef[], seed: number): ContractDef[] {
  return defs.slice().sort((a, b) => {
    const rankDelta = a.rank - b.rank;
    if (rankDelta !== 0) return rankDelta;
    const hashDelta = hashSeed(a.id, seed) - hashSeed(b.id, seed);
    return hashDelta !== 0 ? hashDelta : a.id.localeCompare(b.id);
  });
}

export function spawnContract(state: GameState): boolean {
  const def = listAvailableContracts(state, 1)[0];
  if (!def) {
    state.msgs.push(msg('[QUEST] Новых системных заданий нет.', state.time, '#888'));
    publishContractFailure(state, 'none_available');
    return false;
  }
  const quest = createContractQuest(def, state);
  assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
    crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
  });
  state.quests.push(quest);
  state.msgs.push(msg(`[QUEST] ${def.title}`, state.time, '#6cf'));
  publishContractCreated(state, def, quest);
  return true;
}

export function spawnContractById(
  state: GameState,
  contractId: string,
  sourceTags: string[] = [],
  rumorIds?: string[],
): boolean {
  const def = contractById(contractId);
  if (!def) {
    state.msgs.push(msg(`[QUEST] Контракт не найден: ${contractId}`, state.time, '#f84'));
    publishContractFailure(state, 'missing_definition');
    return false;
  }
  if (state.quests.some(q => q.contractId === contractId)) {
    state.msgs.push(msg('[QUEST] Этот контракт уже в журнале.', state.time, '#888'));
    publishContractFailure(state, 'duplicate_contract');
    return false;
  }
  const quest = createContractQuest(def, state);
  assignProceduralQuestDeadline(quest, state.clock.totalMinutes, {
    crossFloor: quest.targetFloor !== undefined && quest.targetFloor !== state.currentFloor,
  });
  state.quests.push(quest);
  state.msgs.push(msg(`[QUEST] ${def.title}`, state.time, '#6cf'));
  publishContractCreated(state, def, quest, sourceTags, rumorIds);
  return true;
}

export function summarizeContracts(state: GameState, limit = 8): string[] {
  const active = activeContracts(state);
  const available = listAvailableContracts(state, Math.max(0, limit - active.length));
  const rows: string[] = [];
  for (const q of active.slice(0, limit)) rows.push(`ACTIVE #${q.id}: ${q.contractId} -> ${q.targetHint ?? q.targetZoneTag ?? q.targetFloor ?? '?'}`);
  for (const c of available) rows.push(`OPEN r${c.rank}: ${questTypeName(c.type)} ${c.id} -> ${c.target.hint}`);
  return rows.length > 0 ? rows : ['Системных заданий нет'];
}

function questTypeName(type: ContractDef['type']): string {
  switch (type) {
    case QuestType.FETCH: return 'FETCH';
    case QuestType.VISIT: return 'VISIT';
    case QuestType.KILL: return 'KILL';
    case QuestType.TALK: return 'TALK';
  }
  return 'QUEST';
}
