/* ── Generic beam weapon effects ─────────────────────────────── */

import {
  Cell,
  EntityType,
  Feature,
  Tex,
  W,
  msg,
  type Entity,
  type GameState,
} from '../core/types';
import type { World } from '../core/world';
import type { WeaponStats } from '../data/weapons';
import { ITEMS } from '../data/items';
import { rebuildPathBlockersFromWorldObjects } from '../gen/path_blockers';
import { stampMark, MarkType } from './surface_marks';
import { ENTITY_MASK_ACTOR, ensureEntityIndex } from './entity_index';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

export interface DeletionBeamResult {
  beamLen: number;
  cellsDeleted: number;
  doorsDeleted: number;
  featuresCleared: number;
  containersDeleted: number;
  itemsLost: number;
  targetsKilled: number;
}

const BEAM_SCAN_STEP = 0.28;
const MAX_DELETED_CELLS = 64;
const MAX_TARGETS = 18;
const deletionBeamQuery: Entity[] = [];

export function fireDeletionBeam(
  world: World,
  entities: Entity[],
  actor: Entity,
  state: GameState,
  weaponId: string,
  stats: WeaponStats,
  handleKill: (e: Entity, killerIsPlayer: boolean, vx?: number, vy?: number, goreLevel?: number) => void,
): DeletionBeamResult {
  const itemDef = ITEMS[weaponId];
  const itemName = itemDef?.name ?? weaponId;
  const beamTag = weaponId === 'gravity_beam_emitter' ? 'gravity_beam' : 'deletion_beam';
  const eventTags = beamTag === 'gravity_beam'
    ? ['weapon', 'gravity_beam', 'deletion_beam', 'collateral', weaponId]
    : ['weapon', 'deletion_beam', 'collateral', weaponId];
  const range = Math.max(4, Math.min(48, stats.beamRange ?? 28));
  const width = Math.max(0.25, Math.min(1.5, stats.beamWidth ?? 0.65));
  const dirX = Math.cos(actor.angle);
  const dirY = Math.sin(actor.angle);
  const sideX = -dirY;
  const sideY = dirX;
  const touched = new Set<number>();
  let beamLen = range;
  let cellsDeleted = 0;
  let doorsDeleted = 0;
  let featuresCleared = 0;

  for (let d = 0.75; d <= range; d += BEAM_SCAN_STEP) {
    for (let lateral = -width; lateral <= width + 0.001; lateral += 0.48) {
      const x = actor.x + dirX * d + sideX * lateral;
      const y = actor.y + dirY * d + sideY * lateral;
      const idx = world.idx(Math.floor(x), Math.floor(y));
      if (touched.has(idx)) continue;
      touched.add(idx);
      const changed = deleteBeamCell(world, idx);
      cellsDeleted += changed.cells;
      doorsDeleted += changed.doors;
      featuresCleared += changed.features;
      if (changed.any) {
        const fx = ((x % 1) + 1) % 1;
        const fy = ((y % 1) + 1) % 1;
        stampMark(world, idx % W, (idx / W) | 0, fx, fy, 0.55, MarkType.PSI, (idx ^ state.tick) >>> 0, 40, 210, 235, 220);
      }
      if (cellsDeleted >= MAX_DELETED_CELLS) {
        beamLen = d;
        d = range + 1;
        break;
      }
    }
  }

  const containerLoss = deleteTouchedContainers(world, touched);
  if (cellsDeleted > 0 || featuresCleared > 0 || containerLoss.containersDeleted > 0) {
    rebuildPathBlockersFromWorldObjects(world, state.tick, Array.from(touched));
  }
  const targetsKilled = killBeamTargets(world, entities, actor, beamLen, width, handleKill);
  if (cellsDeleted > 0 || doorsDeleted > 0 || featuresCleared > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
  }

  publishEvent(state, {
    type: 'gravity_beam_fired',
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? (isPlayerEntity(actor) ? 'Вы' : undefined),
    actorFaction: actor.faction,
    itemId: weaponId,
    itemName,
    itemCount: 1,
    itemValue: itemDef?.value ?? 0,
    severity: targetsKilled > 0 || cellsDeleted > 0 ? 5 : 3,
    privacy: 'local',
    tags: eventTags,
    data: {
      beamLen: Math.round(beamLen * 10) / 10,
      cellsDeleted,
      doorsDeleted,
      featuresCleared,
      containersDeleted: containerLoss.containersDeleted,
      itemsLost: containerLoss.itemsLost,
      targetsKilled,
    },
  });

  const lost = containerLoss.itemsLost > 0 ? ` Лут потерян: ${containerLoss.itemsLost}.` : '';
  state.msgs.push(msg(`${itemName}: удалено ${cellsDeleted} кл., целей ${targetsKilled}.${lost}`, state.time, '#63f6ff'));
  return {
    beamLen,
    cellsDeleted,
    doorsDeleted,
    featuresCleared,
    containersDeleted: containerLoss.containersDeleted,
    itemsLost: containerLoss.itemsLost,
    targetsKilled,
  };
}

function deleteBeamCell(world: World, idx: number): { any: boolean; cells: number; doors: number; features: number } {
  if (world.hermoWall[idx] || world.aptMask[idx]) return { any: false, cells: 0, doors: 0, features: 0 };
  const cell = world.cells[idx];
  if (cell === Cell.LIFT || cell === Cell.ABYSS) return { any: false, cells: 0, doors: 0, features: 0 };

  let any = false;
  let cells = 0;
  let doors = 0;
  let features = 0;
  if (cell === Cell.WALL || cell === Cell.DOOR) {
    if (cell === Cell.DOOR) {
      world.removeDoorAt(idx);
      doors = 1;
    }
    world.cells[idx] = Cell.FLOOR;
    world.roomMap[idx] = -1;
    world.floorTex[idx] = Tex.F_CONCRETE;
    world.fog[idx] = 0;
    cells = 1;
    any = true;
  }
  if (world.features[idx] !== Feature.NONE) {
    world.setFeatureAt(idx, Feature.NONE);
    features = 1;
    any = true;
  }
  return { any, cells, doors, features };
}

function deleteTouchedContainers(world: World, touched: Set<number>): { containersDeleted: number; itemsLost: number } {
  let containersDeleted = 0;
  let itemsLost = 0;
  if (world.containers.length === 0) return { containersDeleted, itemsLost };
  const kept = [];
  for (const container of world.containers) {
    if (!touched.has(world.idx(container.x, container.y))) {
      kept.push(container);
      continue;
    }
    containersDeleted++;
    for (const item of container.inventory) itemsLost += Math.max(0, item.count);
  }
  if (containersDeleted > 0) {
    world.containers = kept;
    world.rebuildContainerMap();
  }
  return { containersDeleted, itemsLost };
}

function killBeamTargets(
  world: World,
  entities: Entity[],
  actor: Entity,
  beamLen: number,
  width: number,
  handleKill: (e: Entity, killerIsPlayer: boolean, vx?: number, vy?: number, goreLevel?: number) => void,
): number {
  const dirX = Math.cos(actor.angle);
  const dirY = Math.sin(actor.angle);
  const radius = beamLen + width + 1;
  let killed = 0;
  ensureEntityIndex(entities).queryRadius(actor.x, actor.y, radius, deletionBeamQuery, ENTITY_MASK_ACTOR);
  for (const target of deletionBeamQuery) {
    if (killed >= MAX_TARGETS) break;
    if (!target.alive || target.id === actor.id) continue;
    if (target.type !== EntityType.NPC && target.type !== EntityType.MONSTER && !isPlayerEntity(target)) continue;
    const dx = world.delta(actor.x, target.x);
    const dy = world.delta(actor.y, target.y);
    const along = dx * dirX + dy * dirY;
    if (along < 0.5 || along > beamLen + 0.5) continue;
    const perp = Math.abs(dx * -dirY + dy * dirX);
    if (perp > width + 0.45) continue;
    if (target.hp !== undefined) target.hp = 0;
    target.alive = false;
    handleKill(target, isPlayerEntity(actor), dirX * 16, dirY * 16, 1);
    killed++;
  }
  return killed;
}
