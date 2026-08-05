import {
  AIGoal,
  EntityType,
  MonsterKind,
  type Entity,
  type GameState,
  type Msg,
  msg,
} from '../../core/types';
import { World } from '../../core/world';
import { MONSTERS, entityDisplayName } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { publishEvent } from '../events';
import { randomRPG } from '../rpg';
import { currentProceduralFloorSpec } from '../procedural_floors';
import { floorRunZAllowsNpcs } from '../../data/procedural_floors';
import { ENTITY_MASK_ACTOR, getEntityIndex } from '../entity_index';
import { isPlayerEntity } from '../player_actor';

interface ZombieApocalypseRuntime {
  infections: number;
  capNotified: boolean;
  lastMsgAt: number;
  lastEventAt: number;
}

const runtimeByState = new WeakMap<GameState, ZombieApocalypseRuntime>();
const ZOMBIE_TARGET_SCAN_CAP = 80;
const BASE_INFECTION_CAP = 96;
const INFECTION_CAP_PER_DANGER = 64;
const zombieTargetQuery: Entity[] = [];

function runtimeFor(state: GameState): ZombieApocalypseRuntime {
  let runtime = runtimeByState.get(state);
  if (!runtime) {
    runtime = { infections: 0, capNotified: false, lastMsgAt: -Infinity, lastEventAt: -Infinity };
    runtimeByState.set(state, runtime);
  }
  return runtime;
}

export function isZombieApocalypseActive(state: GameState | undefined): boolean {
  const spec = state ? currentProceduralFloorSpec(state) : undefined;
  return !!spec && spec.anomalyId === 'zombie_apocalypse' && floorRunZAllowsNpcs(spec.z);
}

function canZombieApocalypseTarget(e: Entity, zombieId: number): boolean {
  return e.alive && e.id !== zombieId && (e.type === EntityType.NPC || isPlayerEntity(e));
}

export function findZombieApocalypseTarget(
  world: World,
  _entities: Entity[],
  zombie: Entity,
  dt: number,
  rangeSq: number,
): Entity | null {
  const ai = zombie.ai;
  if (!ai) return null;

  ai.combatScanCd = (ai.combatScanCd ?? 0) - dt;
  if (ai.combatTargetId !== undefined) {
    const cached = getEntityIndex().byId.get(ai.combatTargetId);
    if (cached && canZombieApocalypseTarget(cached, zombie.id) && world.dist2(zombie.x, zombie.y, cached.x, cached.y) < rangeSq) {
      return cached;
    }
    ai.combatTargetId = undefined;
  }

  if (ai.combatScanCd !== undefined && ai.combatScanCd > 0) return null;
  ai.combatScanCd = 0.45 + ((zombie.id * 17) % 37) / 100;

  let npcTarget: Entity | null = null;
  let npcBest = rangeSq;
  let playerTarget: Entity | null = null;
  let playerBest = Math.min(rangeSq, 7 * 7);

  getEntityIndex().queryRadiusCapped(zombie.x, zombie.y, Math.sqrt(rangeSq), zombieTargetQuery, ENTITY_MASK_ACTOR, ZOMBIE_TARGET_SCAN_CAP);
  for (const other of zombieTargetQuery) {
    if (!canZombieApocalypseTarget(other, zombie.id)) continue;
    const d2 = world.dist2(zombie.x, zombie.y, other.x, other.y);
    if (other.type === EntityType.NPC && d2 < npcBest) {
      npcBest = d2;
      npcTarget = other;
    } else if (isPlayerEntity(other) && d2 < playerBest) {
      playerBest = d2;
      playerTarget = other;
    }
  }

  const target = npcTarget ?? playerTarget;
  if (target) ai.combatTargetId = target.id;
  return target;
}

function infectionHp(world: World, target: Entity): number {
  const def = MONSTERS[MonsterKind.ZOMBIE];
  const ci = world.idx(Math.floor(target.x), Math.floor(target.y));
  const zoneLevel = world.zones[world.zoneMap[ci]]?.level ?? target.rpg?.level ?? 1;
  return Math.max(18, Math.round(def.hp * (0.75 + zoneLevel * 0.15)));
}

function infectionCap(state: GameState): number {
  const spec = currentProceduralFloorSpec(state);
  return BASE_INFECTION_CAP + (spec?.danger ?? 1) * INFECTION_CAP_PER_DANGER;
}

function publishInfectionCapEvent(world: World, zombie: Entity, target: Entity, state: GameState, runtime: ZombieApocalypseRuntime, cap: number): void {
  if (runtime.capNotified) return;
  runtime.capNotified = true;
  publishEvent(state, {
    type: 'rumor_observed',
    zoneId: world.zoneMap[world.idx(Math.floor(target.x), Math.floor(target.y))],
    roomId: world.roomMap[world.idx(Math.floor(target.x), Math.floor(target.y))],
    x: target.x,
    y: target.y,
    actorId: zombie.id,
    actorName: entityDisplayName(zombie),
    targetId: target.id,
    targetName: entityDisplayName(target),
    monsterKind: MonsterKind.ZOMBIE,
    severity: 4,
    privacy: 'witnessed',
    tags: ['procedural', 'anomaly', 'zombie_apocalypse', 'zombie', 'infection_cap', 'bounded'],
    data: {
      anomalyId: 'zombie_apocalypse',
      infectionCount: runtime.infections,
      infectionCap: cap,
    },
  });
}

export function tryZombieApocalypseInfection(
  world: World,
  zombie: Entity,
  target: Entity,
  state: GameState | undefined,
  msgs: Msg[],
  time: number,
): boolean {
  if (!state || !isZombieApocalypseActive(state)) return false;
  if (zombie.monsterKind !== MonsterKind.ZOMBIE || target.type !== EntityType.NPC || !target.alive) return false;
  const runtime = runtimeFor(state);
  const cap = infectionCap(state);
  if (runtime.infections >= cap) {
    publishInfectionCapEvent(world, zombie, target, state, runtime, cap);
    return false;
  }

  const oldName = entityDisplayName(target);
  const hp = infectionHp(world, target);
  target.type = EntityType.MONSTER;
  target.monsterKind = MonsterKind.ZOMBIE;
  target.sprite = monsterSpr(MonsterKind.ZOMBIE);
  target.name = oldName ? `Мертвяк ${oldName}` : 'Мертвяк';
  target.hp = hp;
  target.maxHp = hp;
  target.speed = MONSTERS[MonsterKind.ZOMBIE].speed * (0.92 + Math.random() * 0.2);
  target.attackCd = 0.25 + Math.random() * 0.35;
  target.ai = { goal: AIGoal.HUNT, tx: Math.floor(zombie.x), ty: Math.floor(zombie.y), path: [], pi: 0, stuck: 0, timer: 0, combatScanCd: Math.random() * 0.5 };
  target.rpg = target.rpg ?? randomRPG(1);
  target.needs = undefined;
  target.faction = undefined;
  target.occupation = undefined;
  target.isTraveler = undefined;
  target.canGiveQuest = undefined;
  target.questId = undefined;
  target.weapon = undefined;
  target.tool = undefined;
  target.monsterDmgMult = undefined;
  target.phasing = false;
  target.psiControlledBy = undefined;
  target.psiMadness = undefined;
  zombie.ai!.combatTargetId = undefined;

  runtime.infections++;
  const shouldMsg = runtime.infections === 1 || runtime.infections % 25 === 0 || time - runtime.lastMsgAt > 10;
  if (shouldMsg) {
    runtime.lastMsgAt = time;
    msgs.push(msg(
      runtime.infections === 1
        ? `${entityDisplayName(zombie)} заразил ${oldName}. Очаг пошел по этажу.`
        : `Заражений на этаже: ${runtime.infections}. Толпа ломается в мертвяков.`,
      time,
      '#9f6',
    ));
  }

  if (runtime.infections === 1 || runtime.infections % 50 === 0 || time - runtime.lastEventAt > 12) {
    runtime.lastEventAt = time;
    publishEvent(state, {
      type: 'rumor_observed',
      zoneId: world.zoneMap[world.idx(Math.floor(target.x), Math.floor(target.y))],
      roomId: world.roomMap[world.idx(Math.floor(target.x), Math.floor(target.y))],
      x: target.x,
      y: target.y,
      actorId: zombie.id,
      actorName: entityDisplayName(zombie),
      targetId: target.id,
      targetName: oldName,
      monsterKind: MonsterKind.ZOMBIE,
      severity: 5,
      privacy: 'witnessed',
      tags: ['procedural', 'anomaly', 'zombie_apocalypse', 'zombie', 'infection', 'patient_zero'],
      data: {
        anomalyId: 'zombie_apocalypse',
        infectionCount: runtime.infections,
        sourceId: zombie.id,
        sourceName: entityDisplayName(zombie),
      },
    });
  }

  return true;
}
