/* ── Борщевик: bounded plant effects and authored root sites ─── */

import {
  W,
  Cell,
  MonsterKind,
  ProjType,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import { World } from '../core/world';
import { Spr } from '../render/sprite_index';
import { publishEvent } from './events';
import { cleanCellHazardsNear } from './cell_hazards';
import { hasAirborneHazardProtection } from './status';
import { isPlayerEntity } from './player_actor';

export const BORSHCHEVIK_SMOKE_BURST_CELL_CAP = 24;

const BORSCH_RUMOR_IDS = ['ecology_borshchevik_sap', 'lead_maintenance_borshchevik_blockade'] as const;
const BORSCH_CUT_WEAPONS = new Set(['knife', 'axe', 'liquidator_axe', 'chainsaw', 'fire_hook', 'rebar', 'pipe']);

interface RootSite {
  id: string;
  plantIds: number[];
  weakCells: number[];
  roomId?: number;
  zoneId?: number;
  centerX: number;
  centerY: number;
}

interface Runtime {
  sites: RootSite[];
  byPlant: Map<number, RootSite[]>;
}

export interface BorshchevikRootSiteDraft {
  id: string;
  plantIds: readonly number[];
  weakCells: readonly number[];
  roomId?: number;
  zoneId?: number;
  centerX?: number;
  centerY?: number;
}

const runtimes = new WeakMap<World, Runtime>();

function ensureRuntime(world: World): Runtime {
  let runtime = runtimes.get(world);
  if (!runtime) {
    runtime = { sites: [], byPlant: new Map() };
    runtimes.set(world, runtime);
  }
  return runtime;
}

function rebuildPlantIndex(runtime: Runtime): void {
  runtime.byPlant.clear();
  for (const site of runtime.sites) {
    for (const plantId of site.plantIds) {
      const list = runtime.byPlant.get(plantId);
      if (list) list.push(site);
      else runtime.byPlant.set(plantId, [site]);
    }
  }
}

function compactCells(cells: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of cells) {
    const cell = Math.floor(raw);
    if (cell < 0 || cell >= W * W || seen.has(cell)) continue;
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

export function registerBorshchevikRootSite(world: World, draft: BorshchevikRootSiteDraft): void {
  const weakCells = compactCells(draft.weakCells);
  const plantIds = [...new Set(draft.plantIds.map(id => Math.floor(id)).filter(id => id >= 0))];
  if (weakCells.length === 0 || plantIds.length === 0) return;
  const center = siteCenter(weakCells);
  const site: RootSite = {
    id: draft.id,
    plantIds,
    weakCells,
    roomId: draft.roomId,
    zoneId: draft.zoneId,
    centerX: draft.centerX ?? center.x,
    centerY: draft.centerY ?? center.y,
  };
  const runtime = ensureRuntime(world);
  runtime.sites = runtime.sites.filter(existing => existing.id !== site.id);
  runtime.sites.push(site);
  rebuildPlantIndex(runtime);
}

function cellRoomId(world: World, e: Entity): number | undefined {
  const rid = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
  return rid >= 0 ? rid : undefined;
}

function cellZoneId(world: World, e: Entity): number | undefined {
  return world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
}

function actorName(e: Entity | undefined): string | undefined {
  if (!e) return undefined;
  if (e.name) return e.name;
  if (isPlayerEntity(e)) return 'Вы';
  return e.monsterKind === MonsterKind.BORSHCHEVIK ? 'Борщевик' : undefined;
}

function hasSeedProtection(e: Entity | undefined): boolean {
  return !!e && (
    hasAirborneHazardProtection(e) ||
    (e.inventory ?? []).some(item => item.count > 0 && item.defId === 'cloth_roll')
  );
}

function puffFog(world: World, x: number, y: number, radius: number, fog: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const radius2 = radius * radius;
  let changed = 0;
  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
    for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
      if (changed >= BORSHCHEVIK_SMOKE_BURST_CELL_CAP) break;
      const px = world.wrap(cx + dx);
      const py = world.wrap(cy + dy);
      if (world.dist2(x, y, px + 0.5, py + 0.5) > radius2) continue;
      if (world.solid(px, py)) continue;
      const ci = world.idx(px, py);
      const nextFog = Math.max(world.fog[ci], fog);
      if (nextFog === world.fog[ci]) continue;
      world.fog[ci] = nextFog;
      changed++;
    }
  }
  if (changed > 0) world.markFogDirty();
  return changed;
}

export function releaseBorshchevikSeedPuff(
  world: World,
  state: GameState,
  plant: Entity,
  target?: Entity,
  reason: 'seed' | 'fire' = 'seed',
): number {
  const fire = reason === 'fire';
  const fogCells = puffFog(world, plant.x, plant.y, fire ? 5.2 : 3.8, fire ? 72 : 44);
  if (target && world.dist2(plant.x, plant.y, target.x, target.y) <= (fire ? 6.2 * 6.2 : 4.6 * 4.6)) {
    const protectedTarget = hasSeedProtection(target);
    if (!protectedTarget) target.psiMadness = Math.max(target.psiMadness ?? 0, isPlayerEntity(target) ? 2.5 : 4.5);
    if (isPlayerEntity(target)) {
      state.dmgFlash = Math.max(state.dmgFlash, protectedTarget ? 0.12 : 0.24);
      state.dmgSeed = (state.dmgSeed + (fire ? 73 : 41)) | 0;
      state.msgs.push(msg(
        protectedTarget
          ? 'Фильтр поймал часть семян борщевика.'
          : 'Семена борщевика спутали карту и свет.',
        state.time,
        protectedTarget ? '#9cf' : '#d8f',
      ));
    }
  }

  publishEvent(state, {
    type: 'borshchevik_seed_puff',
    zoneId: cellZoneId(world, plant),
    roomId: cellRoomId(world, plant),
    x: plant.x,
    y: plant.y,
    actorId: plant.id,
    actorName: actorName(plant),
    targetId: target?.id,
    targetName: actorName(target),
    targetFaction: target?.faction,
    monsterKind: MonsterKind.BORSHCHEVIK,
    severity: fire ? 4 : 3,
    privacy: isPlayerEntity(target) ? 'private' : 'local',
    tags: ['monster', 'borshchevik', 'seed_puff', 'plant', fire ? 'smoke' : 'hallucination'],
    data: {
      fogCells,
      cap: BORSHCHEVIK_SMOKE_BURST_CELL_CAP,
      reason,
      rumorIds: [...BORSCH_RUMOR_IDS],
      protected: hasSeedProtection(target),
    },
  });
  return fogCells;
}

export function recordBorshchevikBurned(world: World, state: GameState, plant: Entity, actor?: Entity): number {
  const fogCells = releaseBorshchevikSeedPuff(world, state, plant, isPlayerEntity(actor) ? actor : undefined, 'fire');
  publishEvent(state, {
    type: 'borshchevik_burned',
    zoneId: cellZoneId(world, plant),
    roomId: cellRoomId(world, plant),
    x: plant.x,
    y: plant.y,
    actorId: actor?.id,
    actorName: actorName(actor),
    actorFaction: actor?.faction,
    targetId: plant.id,
    targetName: actorName(plant),
    monsterKind: MonsterKind.BORSHCHEVIK,
    severity: 4,
    privacy: isPlayerEntity(actor) ? 'private' : 'local',
    tags: ['monster', 'borshchevik', 'burned', 'fire', 'smoke'],
    data: { fogCells, rumorIds: [...BORSCH_RUMOR_IDS] },
  });
  return fogCells;
}

export function recordBorshchevikCut(world: World, state: GameState, plant: Entity, actor?: Entity): number {
  const cleanedHazards = cleanCellHazardsNear(world, plant.x, plant.y, 1.8, state, actor, 'tool');
  publishEvent(state, {
    type: 'borshchevik_cut',
    zoneId: cellZoneId(world, plant),
    roomId: cellRoomId(world, plant),
    x: plant.x,
    y: plant.y,
    actorId: actor?.id,
    actorName: actorName(actor),
    actorFaction: actor?.faction,
    targetId: plant.id,
    targetName: actorName(plant),
    monsterKind: MonsterKind.BORSHCHEVIK,
    severity: 3,
    privacy: isPlayerEntity(actor) ? 'private' : 'local',
    tags: ['monster', 'borshchevik', 'cut', 'tool', 'route'],
    data: { cleanedHazards, rumorIds: [...BORSCH_RUMOR_IDS] },
  });
  return cleanedHazards;
}

export function isBorshchevikFireProjectile(projectile: Entity): boolean {
  return (projectile.projType ?? ProjType.NORMAL) === ProjType.FLAME ||
    projectile.sprite === Spr.FLAME_BOLT ||
    projectile.sprite === Spr.HOSTILE_FLAME_BOLT;
}

export function isBorshchevikCuttingWeapon(weaponId: string | undefined): boolean {
  return weaponId !== undefined && BORSCH_CUT_WEAPONS.has(weaponId);
}

export function borshchevikProjectileDamage(target: Entity, projectile: Entity, baseDamage: number): number {
  if (target.monsterKind !== MonsterKind.BORSHCHEVIK || !isBorshchevikFireProjectile(projectile)) return baseDamage;
  const maxHp = Math.max(1, target.maxHp ?? target.hp ?? 1);
  return Math.max(baseDamage, Math.ceil(maxHp * 0.44));
}

export function damageBorshchevikRootSite(world: World, state: GameState, plant: Entity): boolean {
  const runtime = runtimes.get(world);
  const sites = runtime?.byPlant.get(plant.id);
  if (!sites || sites.length === 0) return false;

  for (const site of sites) {
    for (let i = 0; i < site.weakCells.length; i++) {
      const cell = site.weakCells[i];
      const x = cell % W;
      const y = (cell / W) | 0;
      if (world.cells[cell] !== Cell.WALL && world.cells[cell] !== Cell.DOOR) continue;
      const old = world.cells[cell];
      if (old === Cell.DOOR) world.removeDoorAt(cell);
      else world.cells[cell] = Cell.FLOOR;
      world.markCellsDirty();
      publishEvent(state, {
        type: 'collateral_damage',
        zoneId: site.zoneId,
        roomId: site.roomId,
        x: x + 0.5,
        y: y + 0.5,
        actorId: plant.id,
        actorName: actorName(plant),
        monsterKind: MonsterKind.BORSHCHEVIK,
        severity: 3,
        privacy: 'local',
        tags: ['monster', 'borshchevik', 'roots', 'structure'],
        data: {
          rootSiteId: site.id,
          damagedCell: cell,
          previousCell: old,
          rumorIds: [...BORSCH_RUMOR_IDS],
        },
      });
      site.weakCells.splice(i, 1);
      return true;
    }
  }
  return false;
}
