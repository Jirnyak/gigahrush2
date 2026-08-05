/* ── Gnilushka runtime: talk, spare, handoff, defensive flight ─ */

import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  ItemType,
  MonsterKind,
  msg,
  type Entity,
  type GameState,
  type Msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/items';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { Spr } from '../render/sprite_index';
import { spawnBloodHit } from './blood_fx';
import { playGrowl, playSoundAt } from './audio';
import { recordPlayerDamage } from './damage';
import { ENTITY_MASK_ACTOR, ENTITY_MASK_MONSTER, ensureEntityIndex, getEntityIndex } from './entity_index';
import { publishEvent } from './events';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive } from './debug_cheats';
import { scaleMonsterDmg, strMeleeDmgMult } from './rpg';
import { followPath, tryAssignPathToCell, wanderNearby } from './ai/pathfinding';
import { isPlayerEntity } from './player_actor';

const INTERACTION_RANGE = 2.15;
const INTERACTION_FORWARD = 0.2;
const INTERACTION_QUERY_CAP = 16;
const ACTOR_QUERY_CAP = 32;
const AVOID_ARMED_RADIUS = 5.4;
const CROWD_RADIUS = 3.6;
const FLEE_DISTANCE = 8;
const FLEE_SECONDS = 1.65;
const DEFENSIVE_RANGE = 1.35;
const DEFENSIVE_SECONDS = 9;
const CALM_STAGE = 0;
const HURT_STAGE = 1;
const SPARED_STAGE = 2;
const DELIVERED_STAGE = 3;
const GNILUSHKA_RUMOR_IDS = ['ecology_gnilushka_restraint', 'lead_living_lost_gnilushka_cell'] as const;
const gnilushkaMonsterQuery: Entity[] = [];
const gnilushkaActorQuery: Entity[] = [];

function zoneIdAt(world: World, x: number, y: number): number | undefined {
  const zoneId = world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
  return zoneId >= 0 ? zoneId : undefined;
}

function roomIdAt(world: World, x: number, y: number): number | undefined {
  const roomId = world.roomMap[world.idx(Math.floor(x), Math.floor(y))];
  return roomId >= 0 ? roomId : undefined;
}

function hasReadableSight(world: World, player: Entity, target: Entity): boolean {
  const dx = world.delta(player.x, target.x);
  const dy = world.delta(player.y, target.y);
  const forward = dx * Math.cos(player.angle) + dy * Math.sin(player.angle);
  if (forward <= INTERACTION_FORWARD || forward > INTERACTION_RANGE) return false;
  const side = Math.abs(-dx * Math.sin(player.angle) + dy * Math.cos(player.angle));
  return side <= 0.72;
}

export function findGnilushkaInteractionTarget(world: World, player: Entity, entities: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  ensureEntityIndex(entities).queryRadiusCapped(player.x, player.y, INTERACTION_RANGE, gnilushkaMonsterQuery, ENTITY_MASK_MONSTER, INTERACTION_QUERY_CAP);
  for (const e of gnilushkaMonsterQuery) {
    if (!e.alive || e.monsterKind !== MonsterKind.GNILUSHKA) continue;
    if (!hasReadableSight(world, player, e)) continue;
    const d2 = world.dist2(player.x, player.y, e.x, e.y);
    if (d2 < bestScore) {
      best = e;
      bestScore = d2;
    }
  }
  return best;
}

function consumeFirst(player: Entity, ids: readonly string[]): { id: string; name: string } | null {
  const inv = player.inventory;
  if (!inv) return null;
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i];
    if (slot.count <= 0 || !ids.includes(slot.defId)) continue;
    slot.count--;
    if (slot.count <= 0) inv.splice(i, 1);
    return { id: slot.defId, name: ITEMS[slot.defId]?.name ?? slot.defId };
  }
  return null;
}

function consumeHelpItem(player: Entity): { id: string; name: string } | null {
  const direct = consumeFirst(player, ['filtered_water', 'water', 'bandage', 'antidep', 'bread']);
  if (direct) return direct;
  const inv = player.inventory;
  if (!inv) return null;
  for (let i = 0; i < inv.length; i++) {
    const slot = inv[i];
    const def = ITEMS[slot.defId];
    if (!def || slot.count <= 0) continue;
    if (def.type !== ItemType.FOOD && def.type !== ItemType.DRINK && def.type !== ItemType.MEDICINE) continue;
    slot.count--;
    if (slot.count <= 0) inv.splice(i, 1);
    return { id: def.id, name: def.name };
  }
  return null;
}

function dropGift(world: World, entities: Entity[], nextId: { v: number }, source: Entity, defId: string, data: string): void {
  for (let attempt = 0; attempt < 18; attempt++) {
    const a = attempt * 2.399;
    const d = 1 + (attempt % 4);
    const x = world.wrap(Math.floor(source.x + Math.cos(a) * d));
    const y = world.wrap(Math.floor(source.y + Math.sin(a) * d));
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
      inventory: [{ defId, count: 1, data }],
    });
    return;
  }
}

function publishGnilushkaEvent(
  state: GameState,
  world: World,
  type: 'gnilushka_spared' | 'gnilushka_hurt' | 'gnilushka_delivered',
  actor: Entity,
  target: Entity,
  severity: 2 | 3 | 4,
  tags: string[],
  data?: Record<string, unknown>,
): void {
  publishEvent(state, {
    type,
    zoneId: zoneIdAt(world, target.x, target.y),
    roomId: roomIdAt(world, target.x, target.y),
    x: target.x,
    y: target.y,
    actorId: actor.id,
    actorName: actor.name ?? entityDisplayName(actor),
    actorFaction: actor.faction ?? Faction.PLAYER,
    targetId: target.id,
    targetName: entityDisplayName(target),
    targetFaction: target.faction,
    monsterKind: MonsterKind.GNILUSHKA,
    severity,
    privacy: 'local',
    tags: ['monster', 'gnilushka', ...tags],
    data: { rumorIds: [...GNILUSHKA_RUMOR_IDS], ...data },
  });
}

export function tryUseGnilushkaInteraction(
  world: World,
  player: Entity,
  state: GameState,
  entities: Entity[],
  nextId: { v: number },
): boolean {
  const gnilushka = findGnilushkaInteractionTarget(world, player, entities);
  if (!gnilushka) return false;

  if ((gnilushka.monsterStage ?? CALM_STAGE) === HURT_STAGE || (gnilushka.hp ?? 1) < (gnilushka.maxHp ?? gnilushka.hp ?? 1)) {
    gnilushka.monsterStage = HURT_STAGE;
    if (gnilushka.ai) gnilushka.ai.anger = Math.max(gnilushka.ai.anger ?? 0, DEFENSIVE_SECONDS);
    state.msgs.push(msg('Гнилушка пятится и прячет лицо в серые волосы. После удара она не верит словам.', state.time, '#9d7'));
    return true;
  }

  const handoff = consumeFirst(player, ['nii_sample_container']);
  if (handoff) {
    gnilushka.monsterStage = DELIVERED_STAGE;
    gnilushka.alive = false;
    dropGift(world, entities, nextId, gnilushka, 'slime_sample_brown', 'Серо-зеленый соскоб оставлен добровольно после передачи Гнилушки к НИИ.');
    state.msgs.push(msg('Вы дали тару НИИ и маршрут к Якову. Гнилушка ушла тихо; на полу остался сухой соскоб.', state.time, '#9d7'));
    publishGnilushkaEvent(state, world, 'gnilushka_delivered', player, gnilushka, 4, ['delivered', 'science', 'noncombat'], {
      consumedItemId: handoff.id,
      rewardItemId: 'slime_sample_brown',
      counterplay: 'handoff_to_scientists_without_fight',
    });
    return true;
  }

  const helped = consumeHelpItem(player);
  const firstSpare = (gnilushka.monsterStage ?? CALM_STAGE) !== SPARED_STAGE;
  gnilushka.monsterStage = SPARED_STAGE;
  if (gnilushka.ai) {
    gnilushka.ai.anger = 0;
    gnilushka.ai.combatTargetId = undefined;
  }
  if (helped) {
    gnilushka.hp = Math.min(gnilushka.maxHp ?? gnilushka.hp ?? 1, (gnilushka.hp ?? 1) + 8);
    if (firstSpare) dropGift(world, entities, nextId, gnilushka, 'note', 'Гнилушка шепчет: "низкий лифт шумит не хуже сирены; не стой у мягкой двери".');
    state.msgs.push(msg(`Гнилушка приняла ${helped.name} и шепнула про мягкую дверь у нижнего лифта.`, state.time, '#9d7'));
  } else {
    state.msgs.push(msg('Гнилушка отвечает не сразу: "Не загоняй. Я помню только серый коридор и мягкую дверь".', state.time, '#9d7'));
  }
  if (firstSpare) {
    publishGnilushkaEvent(state, world, 'gnilushka_spared', player, gnilushka, helped ? 3 : 2, ['spared', helped ? 'helped' : 'talked', 'noncombat'], {
      consumedItemId: helped?.id,
      rewardItemId: helped ? 'note' : undefined,
      counterplay: 'talk_or_offer_supply_before_cornering',
    });
  }
  return true;
}

function nearestActor(world: World, e: Entity, radius: number): Entity | null {
  let best: Entity | null = null;
  let bestD2 = radius * radius;
  getEntityIndex().queryRadiusCapped(e.x, e.y, radius, gnilushkaActorQuery, ENTITY_MASK_ACTOR, ACTOR_QUERY_CAP);
  for (const other of gnilushkaActorQuery) {
    if (!other.alive || other.id === e.id || (!isPlayerEntity(other) && other.type !== EntityType.NPC)) continue;
    const d2 = world.dist2(e.x, e.y, other.x, other.y);
    if (d2 < bestD2) {
      best = other;
      bestD2 = d2;
    }
  }
  return best;
}

function actorLooksArmed(actor: Entity): boolean {
  return !!actor.weapon || actor.tool === 'uv_spotlight';
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

function fleeFrom(world: World, e: Entity, threat: Entity, dt: number): void {
  const ai = e.ai!;
  ai.goal = AIGoal.FLEE;
  ai.combatTargetId = undefined;
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

function defensiveSlash(
  world: World,
  e: Entity,
  target: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  state?: GameState,
): boolean {
  if (world.dist2(e.x, e.y, target.x, target.y) > DEFENSIVE_RANGE * DEFENSIVE_RANGE) return false;
  if (wallNeighborCount(world, e) < 2 && (e.ai?.stuck ?? 0) < 0.65) return false;
  e.attackCd = Math.max(0, (e.attackCd ?? 0) - dt);
  if (e.attackCd > 0) return true;

  const def = MONSTERS[MonsterKind.GNILUSHKA];
  const level = e.rpg?.level ?? 1;
  const strMult = e.rpg ? strMeleeDmgMult(e.rpg) : 1;
  const dmg = Math.max(1, Math.round(scaleMonsterDmg(def.dmg, level) * strMult * 1.25));
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
    spawnBloodHit(world, target.x, target.y, Math.atan2(target.y - e.y, target.x - e.x), dmg, target.type === EntityType.MONSTER);
    if (isPlayerEntity(target)) recordPlayerDamage(state, e, dmg, 'Гнилушка ударила когтями из угла');
  }
  msgs.push(msg(`Гнилушка ударила ${isPlayerEntity(target) ? 'вас' : entityDisplayName(target)} когтями: -${dmg}`, time, '#f96'));
  playSoundAt(playGrowl, e.x, e.y);
  e.attackCd = def.attackRate;
  return true;
}

function publishHurtOnce(state: GameState | undefined, world: World, e: Entity, actor: Entity | undefined, time: number, msgs: Msg[]): void {
  if ((e.monsterStage ?? CALM_STAGE) === HURT_STAGE) return;
  e.monsterStage = HURT_STAGE;
  if (e.ai) e.ai.anger = Math.max(e.ai.anger ?? 0, DEFENSIVE_SECONDS);
  msgs.push(msg('Гнилушка сорвалась в бег: теперь разговор заменили углы и когти.', time, '#f96'));
  if (!state || !actor) return;
  publishGnilushkaEvent(state, world, 'gnilushka_hurt', actor, e, 4, ['hurt', 'defensive'], {
    counterplay: 'stop_chasing_leave_exit_or_finish_fight',
  });
}

export function updateGnilushkaMonster(
  world: World,
  _entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  state?: GameState,
): boolean {
  if (e.monsterKind !== MonsterKind.GNILUSHKA || !e.ai) return false;
  if (!e.alive) return true;

  const player = getEntityIndex().byId.get(playerId);
  const hurt = (e.hp ?? 1) < (e.maxHp ?? e.hp ?? 1);
  if (hurt) publishHurtOnce(state, world, e, player, time, msgs);

  const nearest = nearestActor(world, e, AVOID_ARMED_RADIUS);
  const angry = (e.monsterStage ?? CALM_STAGE) === HURT_STAGE || (e.ai.anger ?? 0) > 0;
  e.ai.anger = Math.max(0, (e.ai.anger ?? 0) - dt);

  if (angry && nearest) {
    if (defensiveSlash(world, e, nearest, dt, time, msgs, state)) return true;
    fleeFrom(world, e, nearest, dt);
    return true;
  }

  const threat = nearest && (
    (nearest.id === playerId && actorLooksArmed(nearest)) ||
    world.dist2(e.x, e.y, nearest.x, nearest.y) <= CROWD_RADIUS * CROWD_RADIUS
  ) ? nearest : null;
  if (threat) {
    fleeFrom(world, e, threat, dt);
    return true;
  }

  e.ai.goal = AIGoal.WANDER;
  e.ai.combatTargetId = undefined;
  e.ai.timer -= dt;
  if (e.ai.path.length === 0 || e.ai.pi >= e.ai.path.length || e.ai.timer <= 0) {
    wanderNearby(world, e);
    e.ai.timer = 2 + Math.random() * 2.5;
  }
  followPath(world, e, dt);
  return true;
}
