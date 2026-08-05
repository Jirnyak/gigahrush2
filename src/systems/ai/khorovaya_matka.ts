/* ── Хоровая Матка: capped choir waves and vulnerability window ─ */

import {
  AIGoal,
  Cell,
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
import { canSpawnEntityType } from '../entity_limits';
import { publishEvent } from '../events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../rpg';
import { playGrowl, playSoundAt } from '../audio';

export const KHOROVAYA_MATKA_CHILD_CAP = 7;
export const KHOROVAYA_MATKA_VULNERABLE_SEC = 8;
export const KHOROVAYA_MATKA_COUNTDOWN_SEC = 15;

const CHOIR_CUE_STEP_SEC = 3;
const CHOIR_WAVE_SIZE = 3;
const CHOIR_SPAWN_ATTEMPTS = 32;
const CHOIR_AUDIBLE_RADIUS_SQ = 34 * 34;
const CHOIR_MEMBRANE_REPAIR = 0.65;
const CHOIR_CHILD_KINDS: readonly MonsterKind[] = [
  MonsterKind.SBORKA,
  MonsterKind.KRYSNOZHKA,
  MonsterKind.SBORKA,
  MonsterKind.TVAR,
];

function zoneLevelAt(world: World, x: number, y: number): number {
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zid = world.zoneMap[ci];
  return (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 10) : 10;
}

function playerNear(world: World, e: Entity, entityById: ReadonlyMap<number, Entity>, playerId: number): Entity | undefined {
  const player = entityById.get(playerId);
  if (!player?.alive) return undefined;
  return world.dist2(e.x, e.y, player.x, player.y) <= CHOIR_AUDIBLE_RADIUS_SQ ? player : undefined;
}

function compactChoirChildren(e: Entity, entityById: ReadonlyMap<number, Entity>): number {
  const ai = e.ai;
  if (!ai?.choirChildIds || ai.choirChildIds.length === 0) return 0;
  let write = 0;
  for (const id of ai.choirChildIds) {
    const child = entityById.get(id);
    if (!child?.alive || child.type !== EntityType.MONSTER) continue;
    ai.choirChildIds[write++] = id;
  }
  ai.choirChildIds.length = write;
  return write;
}

function publishChoirEvent(
  state: GameState | undefined,
  world: World,
  e: Entity,
  target: Entity | undefined,
  tags: string[],
  data: Record<string, unknown>,
): void {
  if (!state) return;
  const ci = world.idx(Math.floor(e.x), Math.floor(e.y));
  const roomId = world.roomMap[ci];
  const zoneId = world.zoneMap[ci];
  publishEvent(state, {
    type: tags.includes('vulnerable') ? 'monster_windup_interrupted' : 'monster_sighted',
    zoneId,
    roomId: roomId >= 0 ? roomId : undefined,
    x: e.x,
    y: e.y,
    actorId: e.id,
    actorName: entityDisplayName(e),
    targetId: target?.id,
    targetName: target ? entityDisplayName(target) : undefined,
    monsterKind: MonsterKind.KHOROVAYA_MATKA,
    severity: tags.includes('spawn') || tags.includes('vulnerable') ? 4 : 3,
    privacy: target ? 'local' : 'witnessed',
    tags: ['monster', 'khorovaya_matka', 'choir', ...tags],
    data,
  });
}

function applyMembraneDamageGate(e: Entity): void {
  const ai = e.ai;
  if (!ai || e.hp === undefined) return;
  if (ai.choirLastHp === undefined || ai.choirLastHp <= 0 || e.hp > ai.choirLastHp) {
    ai.choirLastHp = e.hp;
    return;
  }
  if ((ai.choirVulnerableTimer ?? 0) > 0) {
    ai.choirLastHp = e.hp;
    return;
  }
  if (e.hp >= ai.choirLastHp) return;

  const repaired = Math.max(1, Math.round((ai.choirLastHp - e.hp) * CHOIR_MEMBRANE_REPAIR));
  e.hp = Math.min(e.maxHp ?? ai.choirLastHp, e.hp + repaired);
  ai.choirLastHp = e.hp;
}

function findChoirSpawnCell(world: World, e: Entity, slot: number): { x: number; y: number } | null {
  const base = e.id * 0.61803398875 + slot * 1.917;
  for (let attempt = 0; attempt < CHOIR_SPAWN_ATTEMPTS; attempt++) {
    const angle = base + attempt * 2.3999632297;
    const dist = 2 + ((attempt + slot) % 4);
    const x = world.wrap(Math.floor(e.x + Math.cos(angle) * dist));
    const y = world.wrap(Math.floor(e.y + Math.sin(angle) * dist));
    const ci = world.idx(x, y);
    const cell = world.cells[ci];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (world.solid(x, y)) continue;
    return { x, y };
  }
  return null;
}

function spawnChoirChild(
  world: World,
  entities: Entity[],
  e: Entity,
  nextId: { v: number },
  slot: number,
): Entity | null {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return null;
  const pos = findChoirSpawnCell(world, e, slot);
  if (!pos) return null;
  const kind = CHOIR_CHILD_KINDS[slot % CHOIR_CHILD_KINDS.length];
  const def = MONSTERS[kind];
  const level = zoneLevelAt(world, pos.x, pos.y);
  const rpg = randomRPG(level);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level) * 0.72));
  const child: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level) * 0.92,
    sprite: monsterSpr(kind),
    name: 'Приплод Хоровой Матки',
    hp,
    maxHp: hp,
    monsterKind: kind,
    monsterDmgMult: 0.82,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.HUNT, tx: Math.floor(e.x), ty: Math.floor(e.y), path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
    spriteScale: kind === MonsterKind.SBORKA || kind === MonsterKind.KRYSNOZHKA ? 0.72 : 0.82,
  };
  entities.push(child);
  return child;
}

function spawnChoirWave(
  world: World,
  entities: Entity[],
  e: Entity,
  nextId: { v: number },
  liveChildren: number,
): number {
  const ai = e.ai!;
  const slots = Math.min(CHOIR_WAVE_SIZE, KHOROVAYA_MATKA_CHILD_CAP - liveChildren);
  if (slots <= 0) return 0;
  if (!ai.choirChildIds) ai.choirChildIds = [];
  let spawned = 0;
  for (let i = 0; i < slots; i++) {
    const child = spawnChoirChild(world, entities, e, nextId, (ai.choirSpawnedChildren ?? 0) + i);
    if (!child) continue;
    ai.choirChildIds.push(child.id);
    spawned++;
  }
  ai.choirSpawnedChildren = (ai.choirSpawnedChildren ?? 0) + spawned;
  return spawned;
}

export function updateKhorovayaMatka(
  world: World,
  entities: Entity[],
  e: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  playerId: number,
  nextId: { v: number },
  entityById: ReadonlyMap<number, Entity>,
  state?: GameState,
): void {
  if (e.monsterKind !== MonsterKind.KHOROVAYA_MATKA || !e.ai) return;
  const ai = e.ai;
  const player = playerNear(world, e, entityById, playerId);

  applyMembraneDamageGate(e);

  ai.choirVulnerableTimer = Math.max(0, (ai.choirVulnerableTimer ?? 0) - dt);
  const liveChildren = compactChoirChildren(e, entityById);
  const previousChildren = ai.choirLastChildCount ?? liveChildren;
  if ((ai.choirSpawnedChildren ?? 0) > 0 && previousChildren > 0 && liveChildren === 0) {
    ai.choirVulnerableTimer = KHOROVAYA_MATKA_VULNERABLE_SEC;
    ai.choirCountdown = Math.max(ai.choirCountdown ?? 0, KHOROVAYA_MATKA_COUNTDOWN_SEC * 0.55);
    ai.choirLastHp = e.hp;
    e.spriteScale = 1.18;
    if (player) {
      msgs.push(msg('Хор сорван: детские рты закрылись. Матка открыта ненадолго.', time, '#f8c'));
      playSoundAt(playGrowl, e.x, e.y);
    }
    publishChoirEvent(state, world, e, player, ['vulnerable', 'children_cleared'], {
      vulnerableSec: KHOROVAYA_MATKA_VULNERABLE_SEC,
      childCap: KHOROVAYA_MATKA_CHILD_CAP,
      counterplay: 'burst_source_during_child_clear_window',
    });
  }
  ai.choirLastChildCount = liveChildren;

  if ((ai.choirVulnerableTimer ?? 0) > 0) {
    e.spriteScale = 1.08 + Math.min(0.12, (ai.choirVulnerableTimer ?? 0) * 0.015);
  } else if (e.spriteScale !== undefined && e.spriteScale > 1) {
    e.spriteScale = undefined;
  }

  ai.choirCountdown = (ai.choirCountdown ?? KHOROVAYA_MATKA_COUNTDOWN_SEC) - dt;
  const cueStep = Math.max(0, Math.ceil((ai.choirCountdown ?? 0) / CHOIR_CUE_STEP_SEC));
  if (ai.choirCueStep === undefined) ai.choirCueStep = cueStep;
  if (player && cueStep < ai.choirCueStep && cueStep > 0) {
    const opened = Math.max(1, 6 - cueStep);
    msgs.push(msg(`Хоровая Матка открывает ${opened}-й детский рот. Припев близко.`, time, '#f8c'));
    publishChoirEvent(state, world, e, player, ['countdown'], {
      countdown: Math.max(0, ai.choirCountdown ?? 0),
      openFaceBud: opened,
      childCap: KHOROVAYA_MATKA_CHILD_CAP,
    });
    playSoundAt(playGrowl, e.x, e.y);
  }
  ai.choirCueStep = cueStep;

  if ((ai.choirCountdown ?? 0) > 0) return;
  ai.choirCountdown = liveChildren >= KHOROVAYA_MATKA_CHILD_CAP
    ? CHOIR_CUE_STEP_SEC
    : KHOROVAYA_MATKA_COUNTDOWN_SEC;
  ai.choirCueStep = Math.ceil(ai.choirCountdown / CHOIR_CUE_STEP_SEC);
  if (liveChildren >= KHOROVAYA_MATKA_CHILD_CAP) return;

  const spawned = spawnChoirWave(world, entities, e, nextId, liveChildren);
  if (spawned <= 0) return;
  ai.choirLastChildCount = liveChildren + spawned;
  e.spriteScale = 1.16;
  if (player) {
    msgs.push(msg(`Хоровая Матка вывела приплод: ${spawned}. Чисти детей или бей источник сейчас.`, time, '#f6a'));
    playSoundAt(playGrowl, e.x, e.y);
  }
  publishChoirEvent(state, world, e, player, ['spawn', 'children'], {
    spawned,
    liveChildren: liveChildren + spawned,
    childCap: KHOROVAYA_MATKA_CHILD_CAP,
    counterplay: 'kill_children_for_vulnerability_or_rush_source',
  });
}
