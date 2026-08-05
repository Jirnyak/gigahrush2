/* ── Slimevik runtime: neutral scavenging, barter, contact risk ─ */

import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  Faction,
  ItemType,
  MonsterKind,
  msg,
  type Entity,
  type GameState,
  type Item,
  type Msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/items';
import { slimeRoomAttractionWeight, slimeSampleIdForRoomName } from '../data/slime_defs';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { Spr } from '../render/sprite_index';
import { cleanCellHazardsNear } from './cell_hazards';
import { recordPlayerDamage } from './damage';
import { ENTITY_MASK_ACTOR, ENTITY_MASK_MONSTER, ensureEntityIndex } from './entity_index';
import { publishEvent, registerWorldEventObserver } from './events';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive } from './debug_cheats';
import { scaleMonsterDmg, strMeleeDmgMult } from './rpg';
import { followPath, tryAssignPathToCell, wanderNearby } from './ai/pathfinding';
import { isPlayerEntity } from './player_actor';

const INTERACTION_RANGE = 2.0;
const INTERACTION_FORWARD = 0.2;
const INTERACTION_QUERY_CAP = 24;
const SCAN_RADIUS = 13;
const SCAN_STEP = 2;
const CONTACT_RANGE_SQ = 1.05 * 1.05;
const CONTACT_SECONDS = 2.2;
const CONTACT_COOLDOWN = 6;
const FLEE_SECONDS = 2.2;
const FLEE_DISTANCE = 8;
const LASH_RANGE = 1.35;
const slimevikQuery: Entity[] = [];
const slimevikActorQuery: Entity[] = [];

registerWorldEventObserver((state, event) => {
  if (
    (event.type !== 'player_kill_monster' && event.type !== 'npc_kill_monster') ||
    event.monsterKind !== MonsterKind.SLIMEVIK
  ) return;
  publishEvent(state, {
    type: 'slimevik_killed',
    zoneId: event.zoneId,
    roomId: event.roomId,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    actorName: event.actorName,
    actorFaction: event.actorFaction,
    targetId: event.targetId,
    targetName: event.targetName,
    monsterKind: MonsterKind.SLIMEVIK,
    severity: 3,
    privacy: 'local',
    tags: ['monster', 'slimevik', 'slime', 'kill'],
    data: { sourceEventId: event.id, counterplay: 'trade_or_keep_distance' },
  });
});

function itemTradeValue(item: Item): number {
  const def = ITEMS[item.defId];
  if (!def || item.count <= 0) return 0;
  if (def.type === ItemType.MEDICINE) return 3;
  if (def.type === ItemType.FOOD) return 2;
  if (def.type === ItemType.DRINK) return 1;
  return 0;
}

function consumeTradeItem(player: Entity): { itemId: string; itemName: string } | null {
  const inv = player.inventory;
  if (!inv) return null;
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < inv.length; i++) {
    const value = itemTradeValue(inv[i]);
    if (value > bestValue) {
      best = i;
      bestValue = value;
    }
  }
  if (best < 0) return null;
  const item = inv[best];
  const def = ITEMS[item.defId];
  item.count--;
  if (item.count <= 0) inv.splice(best, 1);
  return { itemId: item.defId, itemName: def?.name ?? item.defId };
}

function hasSlimevikProtection(player: Entity): boolean {
  if (player.tool === 'uv_spotlight') return true;
  for (const item of player.inventory ?? []) {
    if (item.count <= 0) continue;
    if (
      item.defId === 'gasmask_filter' ||
      item.defId === 'filter_layer' ||
      item.defId === 'nii_sample_container' ||
      item.defId === 'sealant_tube'
    ) return true;
  }
  return false;
}

function cellSlimeWeight(world: World, x: number, y: number): number {
  const ci = world.idx(x, y);
  const room = world.rooms[world.roomMap[ci]];
  let weight = room ? slimeRoomAttractionWeight(room.name, room.type) : 0;
  if (world.cells[ci] === Cell.WATER) weight += 3;
  const feature = world.features[ci];
  if (feature === Feature.SINK || feature === Feature.TOILET) weight += 2;
  if (feature === Feature.APPARATUS || feature === Feature.MACHINE) weight += 1;
  const fog = world.fog[ci] ?? 0;
  if (fog > 90) weight += 1;
  return weight;
}

function refreshSlimeTarget(world: World, e: Entity): boolean {
  let bestX = -1;
  let bestY = -1;
  let bestScore = 0;
  const ex = Math.floor(e.x);
  const ey = Math.floor(e.y);
  for (let dy = -SCAN_RADIUS; dy <= SCAN_RADIUS; dy += SCAN_STEP) {
    for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx += SCAN_STEP) {
      if (dx * dx + dy * dy > SCAN_RADIUS * SCAN_RADIUS) continue;
      const x = world.wrap(ex + dx);
      const y = world.wrap(ey + dy);
      if (world.cells[world.idx(x, y)] !== Cell.FLOOR && world.cells[world.idx(x, y)] !== Cell.WATER) continue;
      const weight = cellSlimeWeight(world, x, y);
      if (weight <= 0) continue;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const score = weight * 10 - dist;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestX < 0) return false;
  e.ai!.slimeTargetX = bestX;
  e.ai!.slimeTargetY = bestY;
  return true;
}

function wallNeighborCount(world: World, e: Entity): number {
  const x = Math.floor(e.x);
  const y = Math.floor(e.y);
  let n = 0;
  if (world.solid(x - 1, y)) n++;
  if (world.solid(x + 1, y)) n++;
  if (world.solid(x, y - 1)) n++;
  if (world.solid(x, y + 1)) n++;
  return n;
}

function nearestActor(world: World, entities: readonly Entity[], e: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = FLEE_DISTANCE * FLEE_DISTANCE;
  ensureEntityIndex(entities).queryRadiusCapped(e.x, e.y, FLEE_DISTANCE, slimevikActorQuery, ENTITY_MASK_ACTOR, INTERACTION_QUERY_CAP);
  for (const other of slimevikActorQuery) {
    if (!other.alive || other.id === e.id || (!isPlayerEntity(other) && other.type !== EntityType.NPC)) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 < bestD2) {
      best = other;
      bestD2 = d2;
    }
  }
  return best;
}

function fleeFrom(world: World, e: Entity, threat: Entity, dt: number): void {
  const ai = e.ai!;
  ai.goal = AIGoal.FLEE;
  ai.combatTargetId = threat.id;
  ai.timer -= dt;
  if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    const dx = world.delta(threat.x, e.x);
    const dy = world.delta(threat.y, e.y);
    const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const tx = Math.floor(e.x + (dx / len) * FLEE_DISTANCE);
    const ty = Math.floor(e.y + (dy / len) * FLEE_DISTANCE);
    if (tryAssignPathToCell(world, e, tx, ty) === 'not_found') wanderNearby(world, e);
    ai.timer = FLEE_SECONDS;
  }
  followPath(world, e, dt);
}

function lashIfCornered(
  world: World,
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): void {
  if (world.dist2(e.x, e.y, target.x, target.y) > LASH_RANGE * LASH_RANGE) return;
  if (wallNeighborCount(world, e) < 2 && (e.ai?.stuck ?? 0) < 0.8) return;
  e.attackCd = (e.attackCd ?? 0) - dt;
  if ((e.attackCd ?? 0) > 0) return;

  const def = MONSTERS[MonsterKind.SLIMEVIK];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const dmg = Math.max(1, Math.round(scaleMonsterDmg(def.dmg, level) * strMult));
  if (target.hp !== undefined) {
    if (isPlayerEntity(target) && isDebugOnePunchManEnabled()) {
      keepDebugOnePunchManAlive(target);
    } else {
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp <= 0) {
        target.alive = false;
        target.hp = 0;
      }
    }
    if (isPlayerEntity(target)) recordPlayerDamage(state, e, dmg, 'Слизневик хлестнул кислотной слизью в углу');
  }
  msgs.push(msg(`Слизневик хлестнул ${isPlayerEntity(target) ? 'тебя' : entityDisplayName(target)} кислотной слизью: -${dmg}`, time, '#9d7'));
  e.attackCd = def.attackRate;
}

function applyContactRisk(world: World, e: Entity, player: Entity, dt: number, time: number, msgs: Msg[], state?: GameState): void {
  const ai = e.ai!;
  ai.slimeContactCd = Math.max(0, (ai.slimeContactCd ?? 0) - dt);
  if (world.dist2(e.x, e.y, player.x, player.y) > CONTACT_RANGE_SQ) {
    ai.slimeContactTimer = 0;
    return;
  }
  if (hasSlimevikProtection(player)) {
    ai.slimeContactTimer = 0;
    if (ai.slimeContactCd <= 0) {
      msgs.push(msg('Фильтр и тара держат слизневика на безопасной дистанции.', time, '#8cf'));
      ai.slimeContactCd = CONTACT_COOLDOWN;
    }
    return;
  }
  ai.slimeContactTimer = (ai.slimeContactTimer ?? 0) + dt;
  if (ai.slimeContactTimer < CONTACT_SECONDS || ai.slimeContactCd > 0) return;

  let psiLoss = 0;
  if (player.rpg) {
    const before = player.rpg.psi;
    player.rpg.psi = Math.max(0, player.rpg.psi - 1);
    psiLoss = before - player.rpg.psi;
  }
  if (player.needs) player.needs.water = Math.max(0, player.needs.water - 2);
  msgs.push(msg(`Слизневик оставил липкий след: вода -2${psiLoss > 0 ? ', ПСИ -1' : ''}. Держи дистанцию или фильтр.`, time, '#9d7'));
  if (state) publishEvent(state, {
    type: 'player_status_bad_reaction',
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: e.id,
    targetName: entityDisplayName(e),
    monsterKind: MonsterKind.SLIMEVIK,
    severity: 2,
    privacy: 'private',
    tags: ['player', 'status', 'slimevik', 'slime', 'contact'],
    data: { waterLoss: 2, psiLoss, bounded: true, counterplay: 'distance_filter_container' },
  });
  ai.slimeContactTimer = 0;
  ai.slimeContactCd = CONTACT_COOLDOWN;
}

export function updateSlimevikMonster(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  player: Entity | undefined,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.SLIMEVIK || !e.ai) return false;
  if (player?.alive) applyContactRisk(world, e, player, dt, time, msgs, state);

  const hurt = (e.hp ?? 1) < (e.maxHp ?? e.hp ?? 1);
  if (hurt) {
    const threat = nearestActor(world, entities, e);
    if (threat) {
      lashIfCornered(world, e, threat, dt, time, msgs, state);
      fleeFrom(world, e, threat, dt);
      return true;
    }
  }

  const ai = e.ai;
  ai.goal = AIGoal.WANDER;
  ai.combatTargetId = undefined;
  ai.slimeScanCd = Math.max(0, (ai.slimeScanCd ?? 0) - dt);
  if (ai.slimeScanCd <= 0) {
    refreshSlimeTarget(world, e);
    ai.slimeScanCd = 2.5 + ((e.id * 37) % 17) * 0.07;
  }

  const tx = ai.slimeTargetX;
  const ty = ai.slimeTargetY;
  ai.timer -= dt;
  if (tx !== undefined && ty !== undefined && world.dist2(e.x, e.y, tx + 0.5, ty + 0.5) > 2.0) {
    if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
      tryAssignPathToCell(world, e, tx, ty);
      ai.timer = 2.0;
    }
  } else if (ai.path.length === 0 || ai.pi >= ai.path.length || ai.timer <= 0) {
    wanderNearby(world, e);
    ai.timer = 2.5 + Math.random() * 2;
  }
  followPath(world, e, dt);
  return true;
}

export function findSlimevikInteractionTarget(
  world: World,
  player: Entity,
  entities: Entity[],
): Entity | null {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  let best: Entity | null = null;
  let bestScore = Infinity;
  ensureEntityIndex(entities).queryRadiusCapped(player.x, player.y, INTERACTION_RANGE, slimevikQuery, ENTITY_MASK_MONSTER, INTERACTION_QUERY_CAP);
  for (const e of slimevikQuery) {
    if (!e.alive || e.monsterKind !== MonsterKind.SLIMEVIK) continue;
    const dx = world.delta(player.x, e.x);
    const dy = world.delta(player.y, e.y);
    const forward = dx * dirX + dy * dirY;
    if (forward <= INTERACTION_FORWARD || forward > INTERACTION_RANGE) continue;
    const side = Math.abs(-dx * dirY + dy * dirX);
    if (side > 0.65) continue;
    const score = forward + side * 0.5;
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

function dropSampleNear(world: World, entities: Entity[], nextId: { v: number }, slimevik: Entity): string | null {
  const room = world.roomAt(slimevik.x, slimevik.y);
  const sampleId = slimeSampleIdForRoomName(room?.name ?? '');
  for (let attempt = 0; attempt < 24; attempt++) {
    const a = attempt * 2.399;
    const d = 1 + (attempt % 4);
    const x = world.wrap(Math.floor(slimevik.x + Math.cos(a) * d));
    const y = world.wrap(Math.floor(slimevik.y + Math.sin(a) * d));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
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
      inventory: [{ defId: sampleId, count: 1, data: 'Слизневик показал пробу и уполз в сторону.' }],
    });
    return sampleId;
  }
  return null;
}

export function tryUseSlimevikInteraction(
  world: World,
  player: Entity,
  state: GameState,
  entities: Entity[],
  nextId: { v: number },
): boolean {
  const slimevik = findSlimevikInteractionTarget(world, player, entities);
  if (!slimevik) return false;
  const trade = consumeTradeItem(player);
  if (!trade) {
    state.msgs.push(msg('Слизневик тянет усик к еде, воде или лекарству. Без дара лучше не прижиматься.', state.time, '#9d7'));
    return true;
  }

  const cleaned = cleanCellHazardsNear(world, slimevik.x, slimevik.y, 2.4, state, player, 'tool');
  const sampleId = cleaned > 0 ? null : dropSampleNear(world, entities, nextId, slimevik);
  slimevik.hp = Math.min(slimevik.maxHp ?? slimevik.hp ?? 1, (slimevik.hp ?? 1) + 3);
  slimevik.ai!.slimeContactCd = CONTACT_COOLDOWN;
  state.msgs.push(msg(cleaned > 0
    ? `Слизневик съел ${trade.itemName} и снял слизь рядом: ${cleaned} клет.`
    : `Слизневик съел ${trade.itemName} и пометил пробу рядом.`,
  state.time, '#9d7'));

  const ci = world.idx(Math.floor(slimevik.x), Math.floor(slimevik.y));
  publishEvent(state, {
    type: 'slimevik_bargain',
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci] >= 0 ? world.roomMap[ci] : undefined,
    x: slimevik.x,
    y: slimevik.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction ?? Faction.PLAYER,
    targetId: slimevik.id,
    targetName: entityDisplayName(slimevik),
    monsterKind: MonsterKind.SLIMEVIK,
    itemId: trade.itemId,
    itemName: trade.itemName,
    itemCount: 1,
    severity: 2,
    privacy: 'local',
    tags: ['slimevik', 'slime', 'trade', cleaned > 0 ? 'hazard_cleaned' : 'sample_marked'],
    data: { cleanedCells: cleaned, sampleId, bounded: true },
  });
  if (sampleId) {
    publishEvent(state, {
      type: 'slimevik_harvested',
      zoneId: world.zoneMap[ci],
      roomId: world.roomMap[ci] >= 0 ? world.roomMap[ci] : undefined,
      x: slimevik.x,
      y: slimevik.y,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction ?? Faction.PLAYER,
      targetId: slimevik.id,
      targetName: entityDisplayName(slimevik),
      monsterKind: MonsterKind.SLIMEVIK,
      itemId: sampleId,
      itemName: ITEMS[sampleId]?.name ?? sampleId,
      itemCount: 1,
      severity: 3,
      privacy: 'local',
      tags: ['slimevik', 'slime', 'sample', 'harvest'],
      data: { via: 'bargain', bounded: true },
    });
  }
  return true;
}
