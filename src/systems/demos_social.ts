import { Faction, Occupation, type GameState } from '../core/types';
import {
  DEMOS_AUTHORED_RELATIONS,
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FACTION,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_HIDDEN,
  DEMOS_EDGE_WORK,
  DEMOS_PLAYER_SOCIAL_SLOT,
  DEMOS_RELATION_EMPTY,
  DEMOS_RELATION_FRIENDLY_THRESHOLD,
  DEMOS_RELATION_HOSTILE_THRESHOLD,
  DEMOS_SOCIAL_INITIAL_NPC_SLOTS,
  DEMOS_RELATION_MAX,
  DEMOS_RELATION_MIN,
  DEMOS_SOCIAL_CANDIDATE_TRIES,
  DEMOS_SOCIAL_NPC_SLOTS,
  DEMOS_SOCIAL_NPC_SLOT_START,
  DEMOS_SOCIAL_OVERRIDE_CAP,
  DEMOS_SOCIAL_PUBLIC_SLOTS,
  type DemosAuthoredRelationDef,
  DemosSocialRoleId,
  demosSocialFlagsFromIds,
  demosSocialRoleIdById,
} from '../data/demos_social';
import {
  getNpcPackage,
  npcReservedIdentityId,
  type NpcPackageDef,
  type NpcSocialLinkDef,
} from '../data/npc_packages';
import { getFactionRel } from '../data/relations';
import {
  alifeNpcRecordCount,
  alifeSeed,
  findAlifeNpcIdByReservedIdentityId,
  getAlifeNpcRecordSnapshot,
  packageIdFromReservedIdentityId,
  setAlifeNpcPlayerRelation,
  type AlifeNpcSnapshot,
} from './alife';
import { createEmptyDemosSocialSaveState, type DemosRelationOverride, type DemosSocialSaveState } from './demos_save';
import { getFactionPlayerRelation } from './npc_relations';

export interface DemosSocialEdgeView {
  slot: number;
  targetKind: 'player' | 'alife';
  targetAlifeId?: number;
  relation: number;
  flags: number;
  role: DemosSocialRoleId;
  hidden: boolean;
}

export interface DemosSocialGraphStats {
  totalRecords: number;
  npcSlots: number;
  directedEdges: number;
  emptySlots: number;
  familyEdges: number;
  parentEdges: number;
  enemyEdges: number;
  heapBytesApprox: number;
  total: number;
  slots: number;
  overrides: number;
}

export interface DemosRelationBand {
  label: string;
  color: string;
}

export interface DemosRelationDeltaTarget {
  targetKind: 'player' | 'alife';
  targetAlifeId?: number;
}

export interface DemosRelationDeltaOptions {
  flags?: number;
  createIfMissing?: boolean;
  replaceWeakestIfMissing?: boolean;
  propagate?: boolean;
  reasonTag?: string;
}

export interface DemosRelationDeltaResult {
  changed: boolean;
  fromAlifeId: number;
  targetKind: 'player' | 'alife';
  targetAlifeId?: number;
  previous: number;
  relation: number;
  delta: number;
  flags: number;
  reasonTag?: string;
}

interface DemosSocialGraph {
  signature: string;
  alifeRef?: AlifeStateLike;
  total: number;
  targets: Uint32Array;
  relations: Int8Array;
  flags: Uint8Array;
  roles: Uint8Array;
  initialized: Uint8Array;
  builtAll: boolean;
  overrideKeys: string[];
  packageAlifeIds: Map<string, number>;
  socialRef?: DemosSocialSaveState;
  socialOverrideCount: number;
}

interface DemosSocialHost {
  demosSocialGraph?: DemosSocialGraph;
}

const DEMOS_FULL_GRAPH_BUILD_LIMIT = 2048;

interface AlifeStateLike {
  floorKeys?: unknown[];
  floorIndex?: Record<string, unknown>;
  leaderboardVersion?: number;
}

interface DemosSocialBuckets {
  byFloor: Map<string, number[]>;
  byFaction: Map<number, number[]>;
  byOccupation: Map<number, number[]>;
  familyAdults: Map<number, number[]>;
  familyAliveAdults: Map<number, number[]>;
  familyFloorAdults: Map<string, number[]>;
  familyFloorAliveAdults: Map<string, number[]>;
  floorAdults: Map<string, number[]>;
  floorFactionAdults: Map<string, number[]>;
}

function hash32(a: number, b: number, c = 0): number {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2d) + c) | 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return x >>> 0;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampRelation(value: number): number {
  return clampInt(Math.round(value), 0, DEMOS_RELATION_MIN, DEMOS_RELATION_MAX);
}

function edgeOffset(alifeId: number, slot: number): number {
  return (alifeId - 1) * DEMOS_SOCIAL_PUBLIC_SLOTS + slot;
}

function npcSlotEnd(): number {
  return DEMOS_SOCIAL_NPC_SLOT_START + DEMOS_SOCIAL_NPC_SLOTS;
}

function npcEdgeCount(graph: DemosSocialGraph, sourceId: number): number {
  let count = 0;
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (graph.targets[edgeOffset(sourceId, slot)] !== 0) count++;
  }
  return count;
}

function pushBucket<K>(map: Map<K, number[]>, key: K, id: number): void {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

function familyFloorKey(familyId: number, floorKey: string): string {
  return `${familyId}|${floorKey}`;
}

function floorFactionKey(floorKey: string, faction: Faction): string {
  return `${floorKey}|${faction}`;
}

function isAdult(snapshot: AlifeNpcSnapshot): boolean {
  return snapshot.age >= 18;
}

function buildBuckets(snapshots: readonly (AlifeNpcSnapshot | undefined)[], total: number): DemosSocialBuckets {
  const buckets: DemosSocialBuckets = {
    byFloor: new Map(),
    byFaction: new Map(),
    byOccupation: new Map(),
    familyAdults: new Map(),
    familyAliveAdults: new Map(),
    familyFloorAdults: new Map(),
    familyFloorAliveAdults: new Map(),
    floorAdults: new Map(),
    floorFactionAdults: new Map(),
  };
  for (let id = 1; id <= total; id++) {
    const snapshot = snapshots[id];
    if (!snapshot) continue;
    pushBucket(buckets.byFloor, snapshot.floorKey, id);
    pushBucket(buckets.byFaction, snapshot.faction, id);
    pushBucket(buckets.byOccupation, snapshot.occupation, id);
    if (!isAdult(snapshot)) continue;
    pushBucket(buckets.floorAdults, snapshot.floorKey, id);
    pushBucket(buckets.floorFactionAdults, floorFactionKey(snapshot.floorKey, snapshot.faction), id);
    if (snapshot.familyId <= 0) continue;
    pushBucket(buckets.familyAdults, snapshot.familyId, id);
    pushBucket(buckets.familyFloorAdults, familyFloorKey(snapshot.familyId, snapshot.floorKey), id);
    if (snapshot.dead) continue;
    pushBucket(buckets.familyAliveAdults, snapshot.familyId, id);
    pushBucket(buckets.familyFloorAliveAdults, familyFloorKey(snapshot.familyId, snapshot.floorKey), id);
  }
  return buckets;
}

function edgeTargetExists(graph: DemosSocialGraph, sourceId: number, targetId: number): boolean {
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (graph.targets[edgeOffset(sourceId, slot)] === targetId) return true;
  }
  return false;
}

function firstEmptySlot(graph: DemosSocialGraph, sourceId: number): number {
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (graph.targets[edgeOffset(sourceId, slot)] === 0) return slot;
  }
  return -1;
}

function weakestSlot(graph: DemosSocialGraph, sourceId: number): number {
  let out = DEMOS_SOCIAL_NPC_SLOT_START;
  let weakest = Number.POSITIVE_INFINITY;
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    const offset = edgeOffset(sourceId, slot);
    const score = Math.abs(graph.relations[offset] === DEMOS_RELATION_EMPTY ? 0 : graph.relations[offset]);
    if (score < weakest) {
      weakest = score;
      out = slot;
    }
  }
  return out;
}

function validAlifeId(graph: DemosSocialGraph, alifeId: number): boolean {
  return Number.isInteger(alifeId) && alifeId > 0 && alifeId <= graph.total;
}

function setEdgeAtSlot(
  graph: DemosSocialGraph,
  sourceId: number,
  slot: number,
  targetId: number,
  relation: number,
  flags: number,
  role: DemosSocialRoleId,
): boolean {
  if (!validAlifeId(graph, sourceId) || !validAlifeId(graph, targetId) || sourceId === targetId) return false;
  const offset = edgeOffset(sourceId, slot);
  graph.targets[offset] = targetId;
  graph.relations[offset] = clampRelation(relation);
  graph.flags[offset] = flags & 0xff;
  graph.roles[offset] = role & 0xff;
  return true;
}

function setEdge(
  graph: DemosSocialGraph,
  sourceId: number,
  targetId: number,
  relation: number,
  flags: number,
  role: DemosSocialRoleId,
): boolean {
  if (!validAlifeId(graph, sourceId) || !validAlifeId(graph, targetId)) return false;
  if (sourceId === targetId || edgeTargetExists(graph, sourceId, targetId)) return false;
  const slot = firstEmptySlot(graph, sourceId);
  return slot >= 0 && setEdgeAtSlot(graph, sourceId, slot, targetId, relation, flags, role);
}

function setAuthoredEdge(
  graph: DemosSocialGraph,
  sourceId: number,
  targetId: number,
  relation: number,
  flags: number,
  role: DemosSocialRoleId,
): boolean {
  if (!validAlifeId(graph, sourceId) || !validAlifeId(graph, targetId) || sourceId === targetId) return false;
  let slot = findExistingTargetSlot(graph, sourceId, targetId);
  if (slot < 0) slot = firstEmptySlot(graph, sourceId);
  if (slot < 0) slot = weakestSlot(graph, sourceId);
  return setEdgeAtSlot(graph, sourceId, slot, targetId, relation, relationFlags(relation, flags), role);
}

function reverseAuthoredRole(role: DemosSocialRoleId): DemosSocialRoleId {
  if (role === DemosSocialRoleId.PARENT) return DemosSocialRoleId.CHILD;
  if (role === DemosSocialRoleId.CHILD) return DemosSocialRoleId.PARENT;
  return role;
}

function findPlotNpcAlifeId(
  state: GameState,
  graph: DemosSocialGraph,
  plotNpcId: string,
): number | undefined {
  for (let id = 1; id <= graph.total; id++) {
    const snapshot = getAlifeNpcRecordSnapshot(state, id);
    if (snapshot?.plotNpcId === plotNpcId) return id;
  }
  return undefined;
}

function plotIdMapFromSnapshots(
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  total: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (let id = 1; id <= total; id++) {
    const plotNpcId = snapshots[id]?.plotNpcId;
    if (plotNpcId && !out.has(plotNpcId)) out.set(plotNpcId, id);
  }
  return out;
}

function packageIdForSnapshot(snapshot: AlifeNpcSnapshot): string | undefined {
  return packageIdFromReservedIdentityId(snapshot.reservedIdentityId);
}

function packageIdMapFromSnapshots(
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  total: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (let id = 1; id <= total; id++) {
    const snapshot = snapshots[id];
    if (!snapshot) continue;
    const packageId = packageIdForSnapshot(snapshot);
    if (packageId && !out.has(packageId)) out.set(packageId, id);
  }
  return out;
}

function resolvePackageAlifeId(
  state: GameState,
  graph: DemosSocialGraph,
  packageIdInput: string,
): number | undefined {
  const packageId = packageIdInput.trim();
  if (!packageId) return undefined;
  const cached = graph.packageAlifeIds.get(packageId);
  if (cached !== undefined) return cached > 0 ? cached : undefined;
  const pack = getNpcPackage(packageId);
  const alifeId = findAlifeNpcIdByReservedIdentityId(state, npcReservedIdentityId(packageId), pack?.placement?.homeFloorKey);
  graph.packageAlifeIds.set(packageId, alifeId ?? 0);
  return alifeId;
}

function resolvePackageAlifeIdFromMap(
  packageIds: ReadonlyMap<string, number>,
  packageId: string,
): number | undefined {
  const alifeId = packageIds.get(packageId);
  return alifeId && alifeId > 0 ? alifeId : undefined;
}

function edgeSlotForPackageLink(graph: DemosSocialGraph, sourceId: number, targetId: number): number {
  let slot = findExistingTargetSlot(graph, sourceId, targetId);
  if (slot >= 0) return slot;
  slot = firstEmptySlot(graph, sourceId);
  return slot;
}

function setPackageEdgeAtResolvedSlot(
  graph: DemosSocialGraph,
  sourceId: number,
  targetId: number,
  link: NpcSocialLinkDef,
  reverse = false,
): boolean {
  const slot = edgeSlotForPackageLink(graph, sourceId, targetId);
  if (slot < 0) return false;
  const relation = clampRelation(link.relation);
  const rawFlags = demosSocialFlagsFromIds(link.flags);
  const role = reverse
    ? reverseAuthoredRole(demosSocialRoleIdById(link.role))
    : demosSocialRoleIdById(link.role);
  return setEdgeAtSlot(graph, sourceId, slot, targetId, relation, relationFlags(relation, rawFlags), role);
}

function applyPackageLink(
  graph: DemosSocialGraph,
  sourceId: number,
  targetId: number | undefined,
  link: NpcSocialLinkDef,
): void {
  if (targetId === undefined) return;
  setPackageEdgeAtResolvedSlot(graph, sourceId, targetId, link);
}

function applyPackageBidirectionalLink(
  graph: DemosSocialGraph,
  sourceId: number,
  targetId: number | undefined,
  link: NpcSocialLinkDef,
): void {
  if (targetId === undefined || sourceId === targetId) return;
  if (edgeSlotForPackageLink(graph, sourceId, targetId) < 0) return;
  if (edgeSlotForPackageLink(graph, targetId, sourceId) < 0) return;
  setPackageEdgeAtResolvedSlot(graph, sourceId, targetId, link);
  setPackageEdgeAtResolvedSlot(graph, targetId, sourceId, link, true);
}

function applyPackageRelationsForSource(
  graph: DemosSocialGraph,
  source: AlifeNpcSnapshot,
  pack: NpcPackageDef | undefined,
  resolveTarget: (packageId: string) => number | undefined,
): void {
  const links = pack?.social?.links;
  if (!links || links.length === 0) return;
  for (const link of links.slice(0, DEMOS_SOCIAL_NPC_SLOTS)) {
    const targetId = resolveTarget(link.targetNpcId);
    if (link.bidirectional) applyPackageBidirectionalLink(graph, source.id, targetId, link);
    else applyPackageLink(graph, source.id, targetId, link);
  }
}

function applyAllPackageRelations(
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
): void {
  const byPackageId = packageIdMapFromSnapshots(snapshots, graph.total);
  if (byPackageId.size === 0) return;
  for (let id = 1; id <= graph.total; id++) {
    const source = snapshots[id];
    if (!source) continue;
    const packageId = packageIdForSnapshot(source);
    const pack = packageId ? getNpcPackage(packageId) : undefined;
    applyPackageRelationsForSource(graph, source, pack, targetPackageId => resolvePackageAlifeIdFromMap(byPackageId, targetPackageId));
  }
}

function applyPackageRelationsForLazySource(
  state: GameState,
  graph: DemosSocialGraph,
  source: AlifeNpcSnapshot,
): void {
  const packageId = packageIdForSnapshot(source);
  const pack = packageId ? getNpcPackage(packageId) : undefined;
  applyPackageRelationsForSource(graph, source, pack, targetPackageId => resolvePackageAlifeId(state, graph, targetPackageId));
}

function applyAuthoredDirection(
  graph: DemosSocialGraph,
  fromId: number | undefined,
  toId: number | undefined,
  def: DemosAuthoredRelationDef,
  reverse = false,
): void {
  if (fromId === undefined || toId === undefined) return;
  setAuthoredEdge(
    graph,
    fromId,
    toId,
    def.relation,
    def.flags ?? 0,
    reverse ? reverseAuthoredRole(def.role) : def.role,
  );
}

function applyAllAuthoredRelations(
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
): void {
  if (DEMOS_AUTHORED_RELATIONS.length === 0) return;
  const byPlotId = plotIdMapFromSnapshots(snapshots, graph.total);
  for (const def of DEMOS_AUTHORED_RELATIONS) {
    const fromId = byPlotId.get(def.fromPlotNpcId);
    const toId = byPlotId.get(def.toPlotNpcId);
    applyAuthoredDirection(graph, fromId, toId, def);
    if (def.bidirectional) applyAuthoredDirection(graph, toId, fromId, def, true);
  }
}

function applyAuthoredRelationsForSource(
  state: GameState,
  graph: DemosSocialGraph,
  source: AlifeNpcSnapshot,
): void {
  if (!source.plotNpcId || DEMOS_AUTHORED_RELATIONS.length === 0) return;
  for (const def of DEMOS_AUTHORED_RELATIONS) {
    if (def.fromPlotNpcId === source.plotNpcId) {
      applyAuthoredDirection(graph, source.id, findPlotNpcAlifeId(state, graph, def.toPlotNpcId), def);
    } else if (def.bidirectional && def.toPlotNpcId === source.plotNpcId) {
      applyAuthoredDirection(graph, source.id, findPlotNpcAlifeId(state, graph, def.fromPlotNpcId), def, true);
    }
  }
}

function validCandidate(
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  sourceId: number,
  targetId: number,
): boolean {
  return validAlifeId(graph, targetId)
    && targetId !== sourceId
    && snapshots[targetId] !== undefined
    && !edgeTargetExists(graph, sourceId, targetId);
}

function pickFromIds(
  ids: readonly number[] | undefined,
  source: AlifeNpcSnapshot,
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  seed: number,
  salt: number,
  preferAlive: boolean,
  avoid: Set<number>,
): number | undefined {
  if (!ids || ids.length === 0) return undefined;
  const start = hash32(seed, source.id, salt) % ids.length;
  const step = ids.length > 1 ? (hash32(seed, salt, source.id) % (ids.length - 1)) + 1 : 1;
  const attempts = Math.min(ids.length, DEMOS_SOCIAL_CANDIDATE_TRIES);
  let fallback = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const id = ids[(start + attempt * step) % ids.length];
    if (avoid.has(id) || !validCandidate(graph, snapshots, source.id, id)) continue;
    const target = snapshots[id];
    if (preferAlive && target?.dead) {
      if (fallback === 0) fallback = id;
      continue;
    }
    return id;
  }
  return fallback || undefined;
}

function pickParentCandidates(
  source: AlifeNpcSnapshot,
  buckets: DemosSocialBuckets,
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  seed: number,
): number[] {
  const out: number[] = [];
  const avoid = new Set<number>();
  const addFrom = (ids: readonly number[] | undefined, salt: number, preferAlive = true): void => {
    while (out.length < 2) {
      const id = pickFromIds(ids, source, graph, snapshots, seed, salt + out.length * 17, preferAlive, avoid);
      if (id === undefined) break;
      avoid.add(id);
      out.push(id);
    }
  };
  if (source.familyId > 0) {
    const familyFloor = familyFloorKey(source.familyId, source.floorKey);
    addFrom(buckets.familyFloorAliveAdults.get(familyFloor), 1000);
    addFrom(buckets.familyAliveAdults.get(source.familyId), 1100);
    addFrom(buckets.familyFloorAdults.get(familyFloor), 1200, false);
    addFrom(buckets.familyAdults.get(source.familyId), 1300, false);
  }
  addFrom(buckets.floorFactionAdults.get(floorFactionKey(source.floorKey, source.faction)), 1400);
  addFrom(buckets.floorAdults.get(source.floorKey), 1500);
  return out;
}

function familyRelation(seed: number, sourceId: number, targetId: number, base: number): number {
  return clampRelation(base + (hash32(seed, sourceId, targetId) % 17) - 8);
}

function addFamilyEdges(
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  buckets: DemosSocialBuckets,
  seed: number,
): void {
  for (let id = 1; id <= graph.total; id++) {
    const child = snapshots[id];
    if (!child || child.occupation !== Occupation.CHILD) continue;
    const parents = pickParentCandidates(child, buckets, graph, snapshots, seed);
    for (const parentId of parents) {
      setEdge(graph, child.id, parentId, familyRelation(seed, child.id, parentId, 96), DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND, DemosSocialRoleId.PARENT);
      setEdge(graph, parentId, child.id, familyRelation(seed, parentId, child.id, 88), DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND, DemosSocialRoleId.CHILD);
    }
    if (parents.length >= 2) {
      setEdge(graph, parents[0], parents[1], familyRelation(seed, parents[0], parents[1], 86), DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND, DemosSocialRoleId.PARTNER);
      setEdge(graph, parents[1], parents[0], familyRelation(seed, parents[1], parents[0], 86), DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND, DemosSocialRoleId.PARTNER);
    }
  }
}

function factionAffinity(a: Faction, b: Faction): number {
  return Math.round((getFactionRel(a, b) + getFactionRel(b, a)) * 0.25);
}

function relationJitter(seed: number, sourceId: number, targetId: number, salt: number, span: number): number {
  return (hash32(seed, sourceId ^ salt, targetId) % (span * 2 + 1)) - span;
}

function describeCandidateEdge(
  source: AlifeNpcSnapshot,
  target: AlifeNpcSnapshot,
  mode: number,
  seed: number,
  salt: number,
): { relation: number; flags: number; role: DemosSocialRoleId } {
  if (mode === 1) {
    const relation = clampRelation(18 + factionAffinity(source.faction, target.faction) + relationJitter(seed, source.id, target.id, salt, 28));
    return { relation, flags: DEMOS_EDGE_WORK, role: DemosSocialRoleId.WORK };
  }
  if (mode === 2) {
    const relation = clampRelation(48 + relationJitter(seed, source.id, target.id, salt, 24));
    const friend = relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD;
    return {
      relation,
      flags: DEMOS_EDGE_FACTION | (friend ? DEMOS_EDGE_FRIEND : 0),
      role: friend ? DemosSocialRoleId.FRIEND : DemosSocialRoleId.ACQUAINTANCE,
    };
  }
  if (mode === 3) {
    const roll = hash32(seed, source.id, target.id ^ salt) % 3;
    const relation = clampRelation(-42 - (hash32(seed, target.id, source.id ^ salt) % 70));
    if (roll === 0) return { relation, flags: DEMOS_EDGE_ENEMY, role: DemosSocialRoleId.ENEMY };
    if (roll === 1) return { relation, flags: DEMOS_EDGE_DEBT, role: DemosSocialRoleId.DEBT };
    return { relation, flags: DEMOS_EDGE_ENEMY, role: DemosSocialRoleId.RIVAL };
  }
  const base = mode === 4 ? Math.round(factionAffinity(source.faction, target.faction) * 0.5) : factionAffinity(source.faction, target.faction);
  const relation = clampRelation(base + relationJitter(seed, source.id, target.id, salt, mode === 4 ? 40 : 32));
  const friendly = relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD;
  const hostile = relation <= DEMOS_RELATION_HOSTILE_THRESHOLD;
  return {
    relation,
    flags: (friendly ? DEMOS_EDGE_FRIEND : 0) | (hostile ? DEMOS_EDGE_ENEMY : 0),
    role: friendly ? DemosSocialRoleId.FRIEND : hostile ? DemosSocialRoleId.ENEMY : DemosSocialRoleId.ACQUAINTANCE,
  };
}

function pickGlobalCandidate(
  source: AlifeNpcSnapshot,
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  seed: number,
  salt: number,
): number | undefined {
  let fallback = 0;
  for (let attempt = 0; attempt < DEMOS_SOCIAL_CANDIDATE_TRIES; attempt++) {
    const id = (hash32(seed, source.id, salt + attempt * 97) % graph.total) + 1;
    if (!validCandidate(graph, snapshots, source.id, id)) continue;
    if (snapshots[id]?.dead) {
      if (fallback === 0) fallback = id;
      continue;
    }
    return id;
  }
  return fallback || undefined;
}

function candidateForMode(
  source: AlifeNpcSnapshot,
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  buckets: DemosSocialBuckets,
  seed: number,
  mode: number,
  salt: number,
): number | undefined {
  const avoid = new Set<number>();
  if (mode === 0) return pickFromIds(buckets.byFloor.get(source.floorKey), source, graph, snapshots, seed, salt, true, avoid);
  if (mode === 1) return pickFromIds(buckets.byOccupation.get(source.occupation), source, graph, snapshots, seed, salt, true, avoid);
  if (mode === 2) return pickFromIds(buckets.byFaction.get(source.faction), source, graph, snapshots, seed, salt, true, avoid);
  if (mode === 3) {
    return pickFromIds(buckets.byFloor.get(source.floorKey), source, graph, snapshots, seed, salt, true, avoid)
      ?? pickGlobalCandidate(source, graph, snapshots, seed, salt);
  }
  return pickGlobalCandidate(source, graph, snapshots, seed, salt);
}

function fillRemainingEdges(
  graph: DemosSocialGraph,
  snapshots: readonly (AlifeNpcSnapshot | undefined)[],
  buckets: DemosSocialBuckets,
  seed: number,
): void {
  for (let id = 1; id <= graph.total; id++) {
    const source = snapshots[id];
    if (!source) continue;
    for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
      if (npcEdgeCount(graph, source.id) >= DEMOS_SOCIAL_INITIAL_NPC_SLOTS) break;
      if (graph.targets[edgeOffset(source.id, slot)] !== 0) continue;
      for (let attempt = 0; attempt < DEMOS_SOCIAL_CANDIDATE_TRIES; attempt++) {
        const salt = slot * 131 + attempt * 17;
        const mode = hash32(seed, source.id, salt) % 5;
        const targetId = candidateForMode(source, graph, snapshots, buckets, seed, mode, salt);
        const target = targetId === undefined ? undefined : snapshots[targetId];
        if (!target) continue;
        const edge = describeCandidateEdge(source, target, mode, seed, salt);
        if (setEdge(graph, source.id, target.id, edge.relation, edge.flags, edge.role)) break;
      }
    }
  }
}

function alifeLike(state: GameState): AlifeStateLike | undefined {
  return (state as GameState & { alife?: AlifeStateLike }).alife;
}

function graphSignature(state: GameState, seed: number, total: number): string {
  const alife = alifeLike(state);
  const floorKeyCount = Array.isArray(alife?.floorKeys) ? alife.floorKeys.length : 0;
  const floorIndexCount = alife?.floorIndex ? Object.keys(alife.floorIndex).length : 0;
  const populationVersion = typeof alife?.leaderboardVersion === 'number' ? alife.leaderboardVersion : 0;
  return `${seed}:${total}:${floorKeyCount}:${floorIndexCount}:${populationVersion}`;
}

function demosSocialState(state: GameState): DemosSocialSaveState | undefined {
  return (state as GameState & { demosSocial?: DemosSocialSaveState }).demosSocial;
}

function playerRelationToDemosRelation(snapshot: AlifeNpcSnapshot): number {
  const relation = snapshot.playerRelation ?? getFactionPlayerRelation(snapshot.faction);
  return clampRelation(relation * DEMOS_RELATION_MAX / 100);
}

function setPlayerEdgeAtSlot(
  graph: DemosSocialGraph,
  sourceId: number,
  relation: number,
  flags: number,
  role: DemosSocialRoleId,
): void {
  if (!validAlifeId(graph, sourceId)) return;
  const offset = edgeOffset(sourceId, DEMOS_PLAYER_SOCIAL_SLOT);
  graph.targets[offset] = 0;
  graph.relations[offset] = clampRelation(relation);
  graph.flags[offset] = flags & 0xff;
  graph.roles[offset] = role & 0xff;
}

function initializePlayerSlot(graph: DemosSocialGraph, snapshot: AlifeNpcSnapshot): void {
  const offset = edgeOffset(snapshot.id, DEMOS_PLAYER_SOCIAL_SLOT);
  if (graph.relations[offset] !== DEMOS_RELATION_EMPTY) return;
  const relation = playerRelationToDemosRelation(snapshot);
  setPlayerEdgeAtSlot(graph, snapshot.id, relation, relationFlags(relation), roleForRelation(relation));
}

function applySavedRelationOverride(graph: DemosSocialGraph, override: DemosRelationOverride): void {
  if (!validAlifeId(graph, override.fromAlifeId)) return;
  if (override.targetKind === 'player') {
    const relation = clampRelation(override.value);
    setPlayerEdgeAtSlot(graph, override.fromAlifeId, relation, relationFlags(relation), roleForRelation(relation));
    recordOverride(graph, `${override.fromAlifeId}->player`);
    return;
  }
  const targetAlifeId = override.targetAlifeId ?? 0;
  if (!validAlifeId(graph, targetAlifeId)) return;
  if (override.fromAlifeId === targetAlifeId) return;
  let slot = findExistingTargetSlot(graph, override.fromAlifeId, targetAlifeId);
  if (slot < 0) slot = firstEmptySlot(graph, override.fromAlifeId);
  if (slot < 0) slot = weakestSlot(graph, override.fromAlifeId);
  const relation = clampRelation(override.value);
  setEdgeAtSlot(
    graph,
    override.fromAlifeId,
    slot,
    targetAlifeId,
    relation,
    relationFlags(relation),
    roleForRelation(relation),
  );
  recordOverride(graph, `${override.fromAlifeId}->alife:${override.targetAlifeId}`);
}

function applySavedRelationOverridesForSource(
  graph: DemosSocialGraph,
  fromAlifeId: number,
): void {
  const overrides = graph.socialRef?.relationOverrides;
  if (!overrides || overrides.length === 0) return;
  for (const override of overrides) {
    if (override.fromAlifeId === fromAlifeId) applySavedRelationOverride(graph, override);
  }
}

function applyAllSavedRelationOverrides(graph: DemosSocialGraph): void {
  const overrides = graph.socialRef?.relationOverrides;
  if (!overrides || overrides.length === 0) return;
  for (const override of overrides) applySavedRelationOverride(graph, override);
}

function createGraph(state: GameState, seed: number, total: number, signature: string, alifeRef: AlifeStateLike | undefined): DemosSocialGraph {
  const social = demosSocialState(state);
  const graph: DemosSocialGraph = {
    signature,
    alifeRef,
    total,
    targets: new Uint32Array(total * DEMOS_SOCIAL_PUBLIC_SLOTS),
    relations: new Int8Array(total * DEMOS_SOCIAL_PUBLIC_SLOTS),
    flags: new Uint8Array(total * DEMOS_SOCIAL_PUBLIC_SLOTS),
    roles: new Uint8Array(total * DEMOS_SOCIAL_PUBLIC_SLOTS),
    initialized: new Uint8Array(total + 1),
    builtAll: false,
    overrideKeys: [],
    packageAlifeIds: new Map(),
    socialRef: social,
    socialOverrideCount: social?.relationOverrides.length ?? 0,
  };
  graph.relations.fill(DEMOS_RELATION_EMPTY);
  if (total > DEMOS_FULL_GRAPH_BUILD_LIMIT) return graph;
  const snapshots = new Array<AlifeNpcSnapshot | undefined>(total + 1);
  for (let id = 1; id <= total; id++) snapshots[id] = getAlifeNpcRecordSnapshot(state, id);
  for (let id = 1; id <= total; id++) {
    const snapshot = snapshots[id];
    if (snapshot) initializePlayerSlot(graph, snapshot);
  }
  const buckets = buildBuckets(snapshots, total);
  addFamilyEdges(graph, snapshots, buckets, seed);
  applyAllAuthoredRelations(graph, snapshots);
  applyAllPackageRelations(graph, snapshots);
  fillRemainingEdges(graph, snapshots, buckets, seed);
  applyAllSavedRelationOverrides(graph);
  graph.initialized.fill(1);
  graph.builtAll = true;
  return graph;
}

function lazyCandidateId(graph: DemosSocialGraph, sourceId: number, slot: number, attempt: number): number {
  if (graph.total <= 1) return 0;
  let targetId = (hash32(graphSeed(graph), sourceId ^ (slot * 7919), attempt * 104729) % graph.total) + 1;
  if (targetId === sourceId) targetId = (targetId % graph.total) + 1;
  return targetId;
}

function graphSeed(graph: DemosSocialGraph): number {
  const raw = graph.signature.split(':', 1)[0];
  const seed = Number(raw);
  return Number.isFinite(seed) ? seed | 0 : 0;
}

function initializeLazyRow(state: GameState, graph: DemosSocialGraph, alifeId: number): void {
  if (graph.builtAll || !validAlifeId(graph, alifeId) || graph.initialized[alifeId]) return;
  graph.initialized[alifeId] = 1;
  const source = getAlifeNpcRecordSnapshot(state, alifeId);
  if (!source) return;
  initializePlayerSlot(graph, source);
  const seed = graphSeed(graph);
  applyAuthoredRelationsForSource(state, graph, source);
  applyPackageRelationsForLazySource(state, graph, source);
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (npcEdgeCount(graph, alifeId) >= DEMOS_SOCIAL_INITIAL_NPC_SLOTS) break;
    if (graph.targets[edgeOffset(alifeId, slot)] !== 0) continue;
    for (let attempt = 0; attempt < DEMOS_SOCIAL_CANDIDATE_TRIES; attempt++) {
      const targetId = lazyCandidateId(graph, alifeId, slot, attempt);
      const target = getAlifeNpcRecordSnapshot(state, targetId);
      if (!target || edgeTargetExists(graph, alifeId, targetId)) continue;
      const mode = hash32(seed, alifeId, slot * 131 + attempt * 17) % 5;
      const edge = describeCandidateEdge(source, target, mode, seed, slot * 131 + attempt * 17);
      if (setEdgeAtSlot(graph, alifeId, slot, targetId, edge.relation, edge.flags, edge.role)) break;
    }
  }
  applySavedRelationOverridesForSource(graph, alifeId);
}

function ensureGraph(state: GameState): DemosSocialGraph {
  const seed = alifeSeed(state);
  const total = alifeNpcRecordCount(state);
  const signature = graphSignature(state, seed, total);
  const alifeRef = alifeLike(state);
  const social = demosSocialState(state);
  const socialOverrideCount = social?.relationOverrides.length ?? 0;
  const host = state as GameState & DemosSocialHost;
  if (
    host.demosSocialGraph?.signature === signature &&
    host.demosSocialGraph.alifeRef === alifeRef &&
    host.demosSocialGraph.socialRef === social &&
    host.demosSocialGraph.socialOverrideCount === socialOverrideCount
  ) {
    return host.demosSocialGraph;
  }
  host.demosSocialGraph = createGraph(state, seed, total, signature, alifeRef);
  return host.demosSocialGraph;
}

function viewForNpcEdge(graph: DemosSocialGraph, alifeId: number, slot: number): DemosSocialEdgeView | undefined {
  const offset = edgeOffset(alifeId, slot);
  const targetId = graph.targets[offset];
  if (targetId <= 0) return undefined;
  const flags = graph.flags[offset];
  return {
    slot,
    targetKind: 'alife',
    targetAlifeId: targetId,
    relation: graph.relations[offset],
    flags,
    role: graph.roles[offset] as DemosSocialRoleId,
    hidden: (flags & DEMOS_EDGE_HIDDEN) !== 0,
  };
}

function roleForRelation(relation: number): DemosSocialRoleId {
  if (relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD) return DemosSocialRoleId.FRIEND;
  if (relation <= DEMOS_RELATION_HOSTILE_THRESHOLD) return DemosSocialRoleId.ENEMY;
  return DemosSocialRoleId.ACQUAINTANCE;
}

function relationFlags(relation: number, extra = 0): number {
  let flags = extra & 0xff;
  if (relation >= DEMOS_RELATION_FRIENDLY_THRESHOLD) flags |= DEMOS_EDGE_FRIEND;
  if (relation <= DEMOS_RELATION_HOSTILE_THRESHOLD) flags |= DEMOS_EDGE_ENEMY;
  return flags & 0xff;
}

export function getDemosRelationToPlayerSlot(state: GameState, alifeId: number): DemosSocialEdgeView | undefined {
  const snapshot = getAlifeNpcRecordSnapshot(state, alifeId);
  if (!snapshot) return undefined;
  const graph = ensureGraph(state);
  if (!validAlifeId(graph, alifeId)) return undefined;
  initializeLazyRow(state, graph, alifeId);
  const offset = edgeOffset(alifeId, DEMOS_PLAYER_SOCIAL_SLOT);
  if (graph.relations[offset] === DEMOS_RELATION_EMPTY) initializePlayerSlot(graph, snapshot);
  const relation = graph.relations[offset] === DEMOS_RELATION_EMPTY ? playerRelationToDemosRelation(snapshot) : graph.relations[offset];
  const flags = graph.flags[offset] || relationFlags(relation);
  return {
    slot: DEMOS_PLAYER_SOCIAL_SLOT,
    targetKind: 'player',
    relation,
    flags,
    role: graph.roles[offset] as DemosSocialRoleId || roleForRelation(relation),
    hidden: false,
  };
}

export function getDemosNpcOnlySocialEdges(state: GameState, alifeId: number): readonly DemosSocialEdgeView[] {
  const graph = ensureGraph(state);
  if (!validAlifeId(graph, alifeId)) return [];
  initializeLazyRow(state, graph, alifeId);
  const out: DemosSocialEdgeView[] = [];
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    const edge = viewForNpcEdge(graph, alifeId, slot);
    if (edge) out.push(edge);
  }
  return out;
}

export function getDemosOutgoingSocialEdges(state: GameState, alifeId: number): readonly DemosSocialEdgeView[] {
  const player = getDemosRelationToPlayerSlot(state, alifeId);
  if (!player) return [];
  return [player, ...getDemosNpcOnlySocialEdges(state, alifeId)];
}

export function clearDemosNpcSocialEdges(state: GameState, alifeId: number): void {
  const graph = ensureGraph(state);
  if (!validAlifeId(graph, alifeId)) return;
  initializeLazyRow(state, graph, alifeId);
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    const offset = edgeOffset(alifeId, slot);
    graph.targets[offset] = 0;
    graph.relations[offset] = DEMOS_RELATION_EMPTY;
    graph.flags[offset] = 0;
    graph.roles[offset] = 0;
  }
  recordOverride(graph, `${alifeId}->clear`);
}

export function demosNpcRelationBand(scoreInput: number): DemosRelationBand {
  const score = clampRelation(scoreInput);
  if (score < -96) return { label: 'ненавидит', color: '#ff3b4f' };
  if (score <= DEMOS_RELATION_HOSTILE_THRESHOLD) return { label: 'враг', color: '#ff6a3b' };
  if (score < -32) return { label: 'недруг', color: '#f09a38' };
  if (score < 0) return { label: 'холодное', color: '#d7b86a' };
  if (score < 32) return { label: 'нейтрально', color: '#b8c0a0' };
  if (score < DEMOS_RELATION_FRIENDLY_THRESHOLD) return { label: 'приятель', color: '#8fd47a' };
  if (score < 96) return { label: 'друг', color: '#51e08e' };
  return { label: 'любовь', color: '#ff7ad9' };
}

export function getDemosSocialGraphStats(state: GameState): DemosSocialGraphStats {
  const graph = ensureGraph(state);
  if (!graph.builtAll && graph.total > DEMOS_FULL_GRAPH_BUILD_LIMIT) {
    return {
      totalRecords: graph.total,
      npcSlots: DEMOS_SOCIAL_NPC_SLOTS,
      directedEdges: 0,
      emptySlots: graph.targets.length,
      familyEdges: 0,
      parentEdges: 0,
      enemyEdges: 0,
      heapBytesApprox: graph.targets.byteLength + graph.relations.byteLength + graph.flags.byteLength + graph.roles.byteLength,
      total: graph.total,
      slots: DEMOS_SOCIAL_PUBLIC_SLOTS,
      overrides: graph.overrideKeys.length,
    };
  }
  let directedEdges = 0;
  let familyEdges = 0;
  let parentEdges = 0;
  let enemyEdges = 0;
  for (let i = 0; i < graph.targets.length; i++) {
    const publicSlot = i % DEMOS_SOCIAL_PUBLIC_SLOTS;
    const exists = publicSlot === DEMOS_PLAYER_SOCIAL_SLOT
      ? graph.relations[i] !== DEMOS_RELATION_EMPTY
      : graph.targets[i] !== 0;
    if (!exists) continue;
    directedEdges++;
    if ((graph.flags[i] & DEMOS_EDGE_FAMILY) !== 0) familyEdges++;
    if (graph.roles[i] === DemosSocialRoleId.PARENT) parentEdges++;
    if ((graph.flags[i] & DEMOS_EDGE_ENEMY) !== 0 || graph.relations[i] <= DEMOS_RELATION_HOSTILE_THRESHOLD) enemyEdges++;
  }
  return {
    totalRecords: graph.total,
    npcSlots: DEMOS_SOCIAL_NPC_SLOTS,
    directedEdges,
    emptySlots: graph.targets.length - directedEdges,
    familyEdges,
    parentEdges,
    enemyEdges,
    heapBytesApprox: graph.targets.byteLength + graph.relations.byteLength + graph.flags.byteLength + graph.roles.byteLength,
    total: graph.total,
    slots: DEMOS_SOCIAL_PUBLIC_SLOTS,
    overrides: graph.overrideKeys.length,
  };
}

function recordOverride(graph: DemosSocialGraph, key: string): void {
  if (graph.overrideKeys.includes(key)) return;
  graph.overrideKeys.push(key);
  if (graph.overrideKeys.length <= DEMOS_SOCIAL_OVERRIDE_CAP) return;
  graph.overrideKeys.shift();
}

function findExistingTargetSlot(graph: DemosSocialGraph, fromAlifeId: number, targetAlifeId: number): number {
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (graph.targets[edgeOffset(fromAlifeId, slot)] === targetAlifeId) return slot;
  }
  return -1;
}

function ensureWritableDemosSocialState(state: GameState, graph: DemosSocialGraph): DemosSocialSaveState {
  const host = state as GameState & { demosSocial?: DemosSocialSaveState };
  if (!host.demosSocial) host.demosSocial = createEmptyDemosSocialSaveState();
  graph.socialRef = host.demosSocial;
  graph.socialOverrideCount = host.demosSocial.relationOverrides.length;
  return host.demosSocial;
}

function relationOverrideMatches(
  override: DemosRelationOverride,
  result: Pick<DemosRelationDeltaResult, 'fromAlifeId' | 'targetKind' | 'targetAlifeId'>,
): boolean {
  if (override.fromAlifeId !== result.fromAlifeId || override.targetKind !== result.targetKind) return false;
  return result.targetKind === 'player' || override.targetAlifeId === result.targetAlifeId;
}

function persistRelationOverride(state: GameState, graph: DemosSocialGraph, result: DemosRelationDeltaResult): void {
  const social = ensureWritableDemosSocialState(state, graph);
  const next: DemosRelationOverride = {
    fromAlifeId: result.fromAlifeId,
    targetKind: result.targetKind,
    targetAlifeId: result.targetKind === 'alife' ? result.targetAlifeId : undefined,
    value: result.relation,
    updatedAt: state.time,
    reasonTag: result.reasonTag,
  };
  const existingIndex = social.relationOverrides.findIndex(override => relationOverrideMatches(override, result));
  if (existingIndex >= 0) social.relationOverrides[existingIndex] = next;
  else social.relationOverrides.push(next);
  while (social.relationOverrides.length > DEMOS_SOCIAL_OVERRIDE_CAP) social.relationOverrides.shift();
  graph.socialOverrideCount = social.relationOverrides.length;
}

function demosRelationToPlayerRelation(relation: number): number {
  return Math.max(-100, Math.min(100, Math.round(clampRelation(relation) * 100 / DEMOS_RELATION_MAX)));
}

export function existingDemosRelationToNewPlayer(
  state: GameState,
  fromAlifeId: number,
  targetAlifeId: number,
): number | undefined {
  if (!Number.isInteger(fromAlifeId) || !Number.isInteger(targetAlifeId) || fromAlifeId <= 0 || targetAlifeId <= 0 || fromAlifeId === targetAlifeId) {
    return undefined;
  }
  const social = demosSocialState(state);
  const overrides = social?.relationOverrides;
  if (overrides) {
    for (let i = overrides.length - 1; i >= 0; i--) {
      const override = overrides[i];
      if (
        override.fromAlifeId === fromAlifeId &&
        override.targetKind === 'alife' &&
        override.targetAlifeId === targetAlifeId
      ) {
        return demosRelationToPlayerRelation(override.value);
      }
    }
  }

  const graph = (state as GameState & DemosSocialHost).demosSocialGraph;
  if (!graph || !validAlifeId(graph, fromAlifeId) || !validAlifeId(graph, targetAlifeId)) return undefined;
  initializeLazyRow(state, graph, fromAlifeId);
  const slot = findExistingTargetSlot(graph, fromAlifeId, targetAlifeId);
  if (slot < 0) return undefined;
  const relation = graph.relations[edgeOffset(fromAlifeId, slot)];
  return relation === DEMOS_RELATION_EMPTY ? undefined : demosRelationToPlayerRelation(relation);
}

export function resetDemosPlayerRelationSlotsForNewPlayer(state: GameState): void {
  const social = demosSocialState(state);
  if (social?.relationOverrides.length) {
    social.relationOverrides = social.relationOverrides.filter(override => override.targetKind !== 'player');
  }

  const graph = (state as GameState & DemosSocialHost).demosSocialGraph;
  if (!graph) return;
  graph.overrideKeys = graph.overrideKeys.filter(key => !key.endsWith('->player'));
  graph.socialOverrideCount = social?.relationOverrides.length ?? 0;
  for (let alifeId = 1; alifeId <= graph.total; alifeId++) {
    const snapshot = getAlifeNpcRecordSnapshot(state, alifeId);
    if (!snapshot || snapshot.dead || !validAlifeId(graph, alifeId)) continue;
    const relation = playerRelationToDemosRelation(snapshot);
    setPlayerEdgeAtSlot(
      graph,
      alifeId,
      relation,
      relationFlags(relation),
      roleForRelation(relation),
    );
  }
}

function propagationDelta(sourceDelta: number, circleRelation: number): number {
  return clampInt(Math.round(sourceDelta * clampRelation(circleRelation) / DEMOS_RELATION_MAX), 0, -32, 32);
}

function applyNpcRelationDelta(
  state: GameState,
  graph: DemosSocialGraph,
  fromAlifeId: number,
  targetAlifeId: number,
  delta: number,
  opts: DemosRelationDeltaOptions,
): DemosRelationDeltaResult | undefined {
  if (!validAlifeId(graph, targetAlifeId) || targetAlifeId === fromAlifeId) return undefined;
  initializeLazyRow(state, graph, fromAlifeId);
  let slot = findExistingTargetSlot(graph, fromAlifeId, targetAlifeId);
  if (slot < 0) {
    if (opts.createIfMissing === false) return undefined;
    slot = firstEmptySlot(graph, fromAlifeId);
    if (slot < 0 && opts.replaceWeakestIfMissing !== false) slot = weakestSlot(graph, fromAlifeId);
    if (slot < 0) return undefined;
    setEdgeAtSlot(graph, fromAlifeId, slot, targetAlifeId, 0, 0, DemosSocialRoleId.ACQUAINTANCE);
  }
  const offset = edgeOffset(fromAlifeId, slot);
  const previous = graph.relations[offset] === DEMOS_RELATION_EMPTY ? 0 : graph.relations[offset];
  const relation = clampRelation(previous + delta);
  graph.relations[offset] = relation;
  graph.flags[offset] = relationFlags(relation, graph.flags[offset] | (opts.flags ?? 0));
  graph.roles[offset] = roleForRelation(relation);
  recordOverride(graph, `${fromAlifeId}->alife:${targetAlifeId}`);
  return {
    changed: relation !== previous,
    fromAlifeId,
    targetKind: 'alife',
    targetAlifeId,
    previous,
    relation,
    delta: relation - previous,
    flags: graph.flags[offset],
    reasonTag: opts.reasonTag,
  };
}

function applyPlayerRelationDelta(
  state: GameState,
  graph: DemosSocialGraph,
  fromAlifeId: number,
  delta: number,
  opts: DemosRelationDeltaOptions,
): DemosRelationDeltaResult | undefined {
  const current = getDemosRelationToPlayerSlot(state, fromAlifeId);
  if (!current) return undefined;
  const previous = current.relation;
  const relation = clampRelation(previous + delta);
  const flags = relationFlags(relation, current.flags | (opts.flags ?? 0));
  setPlayerEdgeAtSlot(graph, fromAlifeId, relation, flags, roleForRelation(relation));
  setAlifeNpcPlayerRelation(state, fromAlifeId, demosRelationToPlayerRelation(relation));
  recordOverride(graph, `${fromAlifeId}->player`);
  return {
    changed: relation !== previous,
    fromAlifeId,
    targetKind: 'player',
    previous,
    relation,
    delta: relation - previous,
    flags,
    reasonTag: opts.reasonTag,
  };
}

function propagateRelationDelta(
  state: GameState,
  graph: DemosSocialGraph,
  result: DemosRelationDeltaResult,
): void {
  if (!result.changed || result.delta === 0) return;
  initializeLazyRow(state, graph, result.fromAlifeId);
  let processed = 0;
  for (let slot = DEMOS_SOCIAL_NPC_SLOT_START; slot < npcSlotEnd(); slot++) {
    if (processed >= DEMOS_SOCIAL_NPC_SLOTS) break;
    const offset = edgeOffset(result.fromAlifeId, slot);
    const relatedAlifeId = graph.targets[offset];
    if (!validAlifeId(graph, relatedAlifeId)) continue;
    if (result.targetKind === 'alife' && relatedAlifeId === result.targetAlifeId) continue;
    const related = getAlifeNpcRecordSnapshot(state, relatedAlifeId);
    if (!related || related.dead) continue;
    const delta = propagationDelta(result.delta, graph.relations[offset] === DEMOS_RELATION_EMPTY ? 0 : graph.relations[offset]);
    if (delta === 0) continue;
    processed++;
    const target = result.targetKind === 'player'
      ? { targetKind: 'player' as const }
      : { targetKind: 'alife' as const, targetAlifeId: result.targetAlifeId };
    applyDemosRelationDelta(state, relatedAlifeId, target, delta, {
      createIfMissing: true,
      replaceWeakestIfMissing: false,
      propagate: false,
      reasonTag: result.reasonTag ? `${result.reasonTag}:circle` : 'social_circle',
    });
  }
}

export function applyDemosRelationDelta(
  state: GameState,
  fromAlifeId: number,
  target: DemosRelationDeltaTarget,
  deltaInput: number,
  opts: DemosRelationDeltaOptions = {},
): DemosRelationDeltaResult | undefined {
  const graph = ensureGraph(state);
  if (!validAlifeId(graph, fromAlifeId)) return undefined;
  const delta = clampInt(deltaInput, 0, -32, 32);
  if (delta === 0) return undefined;
  const result = target.targetKind === 'player'
    ? applyPlayerRelationDelta(state, graph, fromAlifeId, delta, opts)
    : applyNpcRelationDelta(state, graph, fromAlifeId, clampInt(target.targetAlifeId, 0, 1, graph.total), delta, opts);
  if (result?.changed) {
    persistRelationOverride(state, graph, result);
    if (opts.propagate !== false) propagateRelationDelta(state, graph, result);
  }
  return result;
}

export function setDemosSocialEdge(
  state: GameState,
  fromAlifeId: number,
  targetAlifeId: number,
  relationInput: number,
  flagsInput = 0,
): boolean {
  const graph = ensureGraph(state);
  if (!validAlifeId(graph, fromAlifeId) || !validAlifeId(graph, targetAlifeId) || fromAlifeId === targetAlifeId) return false;
  initializeLazyRow(state, graph, fromAlifeId);
  let slot = findExistingTargetSlot(graph, fromAlifeId, targetAlifeId);
  if (slot < 0) slot = firstEmptySlot(graph, fromAlifeId);
  if (slot < 0) slot = weakestSlot(graph, fromAlifeId);
  const relation = clampRelation(relationInput);
  const ok = setEdgeAtSlot(graph, fromAlifeId, slot, targetAlifeId, relation, relationFlags(relation, flagsInput), roleForRelation(relation));
  if (ok) recordOverride(graph, `${fromAlifeId}->alife:${targetAlifeId}`);
  return ok;
}
