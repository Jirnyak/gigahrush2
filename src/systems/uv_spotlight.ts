/* ── Liquidator UV spotlight: short utility light pulse ───────── */

import {
  AIGoal, EntityType, MonsterKind,
  type Entity, type GameState,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { entityDisplayName } from '../entities/monster';
import { HEAD_SLUG_DETACHED_STAGE } from '../entities/head_slug';
import { consumeToolDurability, getEquippedToolDurability } from './inventory';
import { publishEvent } from './events';
import { interruptLozhnyyDukhFalsePhase } from './ai/monster';

export const UV_SPOTLIGHT_ID = 'uv_spotlight';

const UV_RANGE = 10;
const UV_DRAIN = 1;
const UV_BASE_HALF_WIDTH = 0.38;
const UV_WIDTH_PER_CELL = 0.045;
const UV_SCAN_STEP = 0.5;
export const UV_SPOTLIGHT_FX_SECONDS = 0.24;

export interface UvSpotlightResult {
  beamLen: number;
  affected: number;
  revealed: number;
  depleted: boolean;
}

export function uvSpotlightRenderIntensity(uvBeamFx: number): number {
  const t = Math.max(0, Math.min(1, uvBeamFx / UV_SPOTLIGHT_FX_SECONDS));
  return t <= 0 ? 0 : 1.05 * t;
}

function isUvHiddenResiduePixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 28) return false;
  const brightness = (r * 2 + g * 3 + b) / 6;
  if (brightness > 48) return false;
  return b >= r + 2 && b >= g + 2 && r <= 42 && g <= 36 && b <= 62;
}

function zoneAt(world: World, x: number, y: number): number {
  return world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
}

function publishUvUsed(state: GameState, world: World, player: Entity, beamLen: number): void {
  publishEvent(state, {
    type: 'uv_spotlight_used',
    zoneId: zoneAt(world, player.x, player.y),
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: UV_SPOTLIGHT_ID,
    itemName: 'УФ-прожектор ликвидатора',
    itemCount: 1,
    itemValue: 950,
    severity: 2,
    privacy: 'local',
    tags: ['player', 'inventory', 'uv_spotlight', 'tool', 'counterplay'],
    data: { beamLen },
  });
}

function publishUvTarget(
  state: GameState,
  world: World,
  player: Entity,
  target: Entity | null,
  effect: string,
  x: number,
  y: number,
  revealedCells = 0,
): void {
  publishEvent(state, {
    type: 'uv_spotlight_target_affected',
    zoneId: zoneAt(world, x, y),
    x,
    y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : 'скрытый след',
    targetFaction: target?.faction,
    monsterKind: target?.monsterKind,
    itemId: UV_SPOTLIGHT_ID,
    itemName: 'УФ-прожектор ликвидатора',
    itemValue: 950,
    severity: target ? 3 : 2,
    privacy: 'local',
    tags: target
      ? ['player', 'combat', 'uv_spotlight', 'counterplay', effect]
      : ['player', 'uv_spotlight', 'mark_reveal', 'black_slime', 'hidden_mark'],
    data: target ? { effect } : { effect, revealedCells },
  });
}

function publishUvDepleted(state: GameState, world: World, player: Entity): void {
  publishEvent(state, {
    type: 'uv_spotlight_depleted',
    zoneId: zoneAt(world, player.x, player.y),
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: UV_SPOTLIGHT_ID,
    itemName: 'УФ-прожектор ликвидатора',
    itemCount: 1,
    itemValue: 950,
    severity: 4,
    privacy: 'private',
    tags: ['player', 'inventory', 'uv_spotlight', 'tool', 'depleted'],
  });
}

function traceUvBeamEnd(world: World, player: Entity): number {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  let mapX = Math.floor(player.x);
  let mapY = Math.floor(player.y);
  const ddx = Math.abs(dirX) < 0.0001 ? Infinity : Math.abs(1 / dirX);
  const ddy = Math.abs(dirY) < 0.0001 ? Infinity : Math.abs(1 / dirY);
  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;
  let sdx = ddx === Infinity ? Infinity : (dirX < 0 ? (player.x - mapX) * ddx : (mapX + 1 - player.x) * ddx);
  let sdy = ddy === Infinity ? Infinity : (dirY < 0 ? (player.y - mapY) * ddy : (mapY + 1 - player.y) * ddy);

  for (let step = 0; step < UV_RANGE * 3; step++) {
    const dist = Math.min(sdx, sdy);
    if (dist >= UV_RANGE) break;
    if (sdx < sdy) {
      sdx += ddx;
      mapX += stepX;
    } else {
      sdy += ddy;
      mapY += stepY;
    }
    if (world.solid(mapX, mapY)) return Math.max(0.6, dist);
  }
  return UV_RANGE;
}

function targetInUvCone(world: World, player: Entity, target: Entity, beamLen: number): boolean {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  const dx = world.delta(player.x, target.x);
  const dy = world.delta(player.y, target.y);
  const along = dx * dirX + dy * dirY;
  if (along < 0.7 || along > beamLen + 0.2) return false;
  const perp = Math.abs(dx * -dirY + dy * dirX);
  const halfWidth = Math.min(0.95, UV_BASE_HALF_WIDTH + along * UV_WIDTH_PER_CELL);
  return perp <= halfWidth;
}

function applyUvMonsterEffect(world: World, target: Entity, dirX: number, dirY: number): string | null {
  if (target.type !== EntityType.MONSTER || target.monsterKind === undefined) return null;
  if (target.monsterKind === MonsterKind.EYE) {
    target.attackCd = Math.max(target.attackCd ?? 0, 2.2);
    if (target.ai) {
      target.ai.goal = AIGoal.WANDER;
      target.ai.combatTargetId = undefined;
      target.ai.path = [];
      target.ai.timer = 1.4;
    }
    return 'eye_stun';
  }
  if (target.monsterKind === MonsterKind.SPIRIT) {
    target.attackCd = Math.max(target.attackCd ?? 0, 1.6);
    target.x = world.wrap(target.x + dirX * 0.6);
    target.y = world.wrap(target.y + dirY * 0.6);
    if (target.ai) {
      target.ai.combatTargetId = undefined;
      target.ai.path = [];
      target.ai.timer = 1.0;
    }
    return 'spirit_stagger';
  }
  if (target.monsterKind === MonsterKind.LOZHNYY_DUKH) {
    return interruptLozhnyyDukhFalsePhase(world, undefined, target, undefined, 'uv_spotlight')
      ? 'false_phase_interrupted'
      : null;
  }
  if (target.monsterKind === MonsterKind.SLIME_WOMAN) {
    target.attackCd = Math.max(target.attackCd ?? 0, 2.1);
    if (target.hp !== undefined) target.hp = Math.max(1, target.hp - Math.max(6, Math.round((target.maxHp ?? target.hp) * 0.08)));
    const nx = world.wrap(target.x + dirX * 0.35);
    const ny = world.wrap(target.y + dirY * 0.35);
    if (!world.solid(Math.floor(nx), Math.floor(ny))) {
      target.x = nx;
      target.y = ny;
    }
    target.spriteScale = 0.86;
    if (target.ai) {
      target.ai.goal = AIGoal.WANDER;
      target.ai.combatTargetId = undefined;
      target.ai.path = [];
      target.ai.timer = 1.2;
    }
    return 'slime_humanoid_dried';
  }
  if (target.monsterKind === MonsterKind.LISHENNYY) {
    target.attackCd = Math.max(target.attackCd ?? 0, 2.4);
    const nx = world.wrap(target.x + dirX * 0.55);
    const ny = world.wrap(target.y + dirY * 0.55);
    if (!world.solid(Math.floor(nx), Math.floor(ny))) {
      target.x = nx;
      target.y = ny;
    }
    target.spriteScale = 0.84;
    if (target.ai) {
      target.ai.lightAvoidTimer = Math.max(target.ai.lightAvoidTimer ?? 0, 2.4);
      target.ai.staggerTimer = Math.max(target.ai.staggerTimer ?? 0, 0.75);
      target.ai.combatTargetId = undefined;
      target.ai.lightTargetId = undefined;
      target.ai.lightTargetKind = undefined;
      target.ai.path = [];
      target.ai.timer = 0.9;
    }
    return 'lishennyy_light_repel';
  }
  if (target.monsterKind === MonsterKind.HEAD_SLUG) {
    target.attackCd = Math.max(target.attackCd ?? 0, 2.0);
    if (target.hp !== undefined && target.monsterStage === HEAD_SLUG_DETACHED_STAGE) target.hp = Math.max(1, target.hp - 3);
    const nx = world.wrap(target.x + dirX * 0.45);
    const ny = world.wrap(target.y + dirY * 0.45);
    if (!world.solid(Math.floor(nx), Math.floor(ny))) {
      target.x = nx;
      target.y = ny;
    }
    target.spriteScale = target.monsterStage === HEAD_SLUG_DETACHED_STAGE ? 0.5 : 0.9;
    if (target.ai) {
      target.ai.parasiteRehostCd = Math.max(target.ai.parasiteRehostCd ?? 0, 5.5);
      target.ai.combatTargetId = undefined;
      target.ai.path = [];
      target.ai.timer = 1.1;
    }
    return target.monsterStage === HEAD_SLUG_DETACHED_STAGE ? 'head_slug_rehost_blocked' : 'head_slug_stagger';
  }
  return null;
}

function revealSurfaceCell(cell: Uint8Array): boolean {
  let changed = false;
  for (let i = 0; i < cell.length; i += 4) {
    const a = cell[i + 3];
    const r = cell[i];
    const g = cell[i + 1];
    const b = cell[i + 2];
    if (!isUvHiddenResiduePixel(r, g, b, a)) continue;
    const nr = Math.max(r, 86);
    const ng = Math.max(g, 44);
    const nb = Math.max(b, 212);
    const na = Math.max(a, 150);
    if (nr !== r || ng !== g || nb !== b || na !== a) {
      cell[i] = nr;
      cell[i + 1] = ng;
      cell[i + 2] = nb;
      cell[i + 3] = na;
      changed = true;
    }
  }
  return changed;
}

function revealUvSurfaceMarks(world: World, player: Entity, beamLen: number): number {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  const sideX = -dirY;
  const sideY = dirX;
  const touched = new Set<number>();
  const changedCells: number[] = [];
  let revealed = 0;

  for (let d = 0.7; d <= beamLen; d += UV_SCAN_STEP) {
    const halfWidth = Math.min(0.95, UV_BASE_HALF_WIDTH + d * UV_WIDTH_PER_CELL);
    for (let off = -halfWidth; off <= halfWidth + 0.01; off += 0.45) {
      const x = Math.floor(player.x + dirX * d + sideX * off);
      const y = Math.floor(player.y + dirY * d + sideY * off);
      const ci = world.idx(x, y);
      if (touched.has(ci)) continue;
      touched.add(ci);
      const cell = world.surfaceMap.get(ci);
      if (!cell) continue;
      if (revealSurfaceCell(cell)) {
        revealed++;
        changedCells.push(ci);
      }
    }
  }

  if (changedCells.length > 0) world.markSurfaceCellsDirty(changedCells);
  return revealed;
}

export function useUvSpotlight(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
): UvSpotlightResult | null {
  const charge = getEquippedToolDurability(player);
  if (!charge || charge.cur <= 0) {
    state.msgs.push(msg('УФ-прожектор не включается: батарея мертва', state.time, '#88f'));
    publishUvDepleted(state, world, player);
    return null;
  }

  const beamLen = traceUvBeamEnd(world, player);
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  let affected = 0;
  const affectedNames: string[] = [];

  for (const target of entities) {
    if (!target.alive || target.id === player.id) continue;
    if (!targetInUvCone(world, player, target, beamLen)) continue;
    const effect = applyUvMonsterEffect(world, target, dirX, dirY);
    if (!effect) continue;
    affected++;
    if (affectedNames.length < 2) affectedNames.push(entityDisplayName(target));
    publishUvTarget(state, world, player, target, effect, target.x, target.y);
    if (effect === 'slime_humanoid_dried') {
      publishEvent(state, {
        type: 'slime_humanoid_dried',
        zoneId: zoneAt(world, target.x, target.y),
        x: target.x,
        y: target.y,
        actorId: player.id,
        actorName: player.name ?? 'Вы',
        actorFaction: player.faction,
        targetId: target.id,
        targetName: entityDisplayName(target),
        targetFaction: target.faction,
        monsterKind: MonsterKind.SLIME_WOMAN,
        itemId: UV_SPOTLIGHT_ID,
        itemName: 'УФ-прожектор ликвидатора',
        itemValue: 950,
        severity: 4,
        privacy: 'local',
        tags: ['player', 'monster', 'slime_woman', 'uv_spotlight', 'counterplay'],
        data: { effect, counterplay: 'uv_spotlight_pushes_slime_humanoid_into_dry_window' },
      });
    }
  }

  const revealed = revealUvSurfaceMarks(world, player, beamLen);
  publishUvUsed(state, world, player, beamLen);

  if (affected > 0) {
    const suffix = affected > affectedNames.length ? ` и ещё ${affected - affectedNames.length}` : '';
    state.msgs.push(msg(`УФ прожёг цель: ${affectedNames.join(', ')}${suffix}`, state.time, '#8ff'));
  }
  if (revealed > 0) {
    state.msgs.push(msg(`УФ проявил тёмные следы: ${revealed}`, state.time, '#8cf'));
    publishUvTarget(state, world, player, null, 'hidden_mark_reveal', player.x + dirX * Math.min(beamLen, 3), player.y + dirY * Math.min(beamLen, 3), revealed);
  }

  const depleted = consumeToolDurability(player, UV_DRAIN, state.msgs, state.time, state);
  if (depleted) publishUvDepleted(state, world, player);
  return { beamLen, affected, revealed, depleted };
}
