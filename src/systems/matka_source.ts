/* ── Matka source spawning: capped persistent children ────────── */

import {
  AIGoal,
  Cell,
  EntityType,
  MonsterKind,
  msg,
  type Entity,
  type GameState,
  type Msg,
} from '../core/types';
import { World } from '../core/world';
import { MONSTERS, entityDisplayName } from '../entities/monster';
import { monsterSpr } from '../render/sprite_index';
import { canSpawnEntityType } from './entity_limits';
import { ENTITY_MASK_ACTOR, getEntityIndex } from './entity_index';
import { publishEvent } from './events';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from './rpg';

export const MATKA_CHILD_CAP = 12;
export const MATKA_SPAWN_COOLDOWN_SEC = 60;

const MATKA_SPAWN_ATTEMPTS = 32;
const MATKA_SPAWN_RADIUS = 3.2;
const MATKA_CHILD_KINDS: readonly MonsterKind[] = [
  MonsterKind.SBORKA,
  MonsterKind.TVAR,
  MonsterKind.ZOMBIE,
  MonsterKind.SHADOW,
  MonsterKind.POLZUN,
];
const MATKA_RUMOR_IDS = ['monster_matka_spawn', 'ecology_matka_children', 'hell_matka_wall_heat'] as const;
const matkaSpawnBlockQuery: Entity[] = [];

function sourceChildren(source: Entity): number[] {
  const ai = source.ai;
  if (!ai) return [];
  if (!ai.sourceChildIds) ai.sourceChildIds = [];
  let write = 0;
  for (const rawId of ai.sourceChildIds as unknown[]) {
    const id = Math.floor(Number(rawId));
    if (!Number.isFinite(id) || id <= 0) continue;
    if (write >= MATKA_CHILD_CAP) break;
    ai.sourceChildIds[write++] = id;
  }
  ai.sourceChildIds.length = write;
  return ai.sourceChildIds;
}

function compactMatkaChildren(source: Entity, byId: ReadonlyMap<number, Entity>): number {
  const ids = sourceChildren(source);
  let write = 0;
  for (const id of ids) {
    const child = byId.get(id);
    if (!child?.alive || child.type !== EntityType.MONSTER || child.ai?.sourceEntityId !== source.id) continue;
    ids[write++] = id;
  }
  ids.length = write;
  return write;
}

function zoneLevelAt(world: World, x: number, y: number): number {
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zid = world.zoneMap[ci];
  return (zid >= 0 && world.zones[zid]) ? Math.max(1, world.zones[zid].level ?? 1) : 1;
}

function findMatkaSpawnCell(world: World, source: Entity, slot: number): { x: number; y: number } | null {
  const entityIndex = getEntityIndex();
  const base = source.id * 0.61803398875 + slot * 2.3999632297;
  for (let attempt = 0; attempt < MATKA_SPAWN_ATTEMPTS; attempt++) {
    const angle = base + attempt * 1.917;
    const dist = 1.1 + ((attempt + slot) % 5) * (MATKA_SPAWN_RADIUS / 5);
    const x = world.wrap(Math.floor(source.x + Math.cos(angle) * dist));
    const y = world.wrap(Math.floor(source.y + Math.sin(angle) * dist));
    const ci = world.idx(x, y);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
    if (world.solid(x, y)) continue;
    entityIndex.queryRadiusCapped(x + 0.5, y + 0.5, 0.72, matkaSpawnBlockQuery, ENTITY_MASK_ACTOR, 1);
    if (matkaSpawnBlockQuery.length > 0) continue;
    return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}

function spawnMatkaChild(
  world: World,
  entities: Entity[],
  source: Entity,
  nextId: { v: number },
): Entity | null {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return null;
  const ai = source.ai;
  if (!ai) return null;
  const slot = ai.sourceSpawnedChildren ?? 0;
  const pos = findMatkaSpawnCell(world, source, slot);
  if (!pos) return null;

  const kind = MATKA_CHILD_KINDS[slot % MATKA_CHILD_KINDS.length];
  const def = MONSTERS[kind];
  const level = zoneLevelAt(world, pos.x, pos.y);
  const rpg = randomRPG(level);
  const hp = Math.max(1, Math.round(scaleMonsterHp(def.hp, level) * (0.82 + Math.min(0.3, rpg.str * 0.04))));
  const child: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: pos.x,
    y: pos.y,
    angle: Math.atan2(world.delta(pos.y, source.y), world.delta(pos.x, source.x)),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name: 'Приплод Матки',
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: {
      goal: AIGoal.HUNT,
      tx: Math.floor(source.x),
      ty: Math.floor(source.y),
      path: [],
      pi: 0,
      stuck: 0,
      timer: 0,
      sourceEntityId: source.id,
    },
    rpg,
    spriteScale: kind === MonsterKind.SBORKA || kind === MonsterKind.ZOMBIE ? 0.82 : 0.92,
  };
  entities.push(child);
  sourceChildren(source).push(child.id);
  ai.sourceSpawnedChildren = slot + 1;
  return child;
}

export function updateMatkaSource(
  world: World,
  entities: Entity[],
  source: Entity,
  dt: number,
  time: number,
  msgs: Msg[],
  nextId: { v: number },
  entityById: ReadonlyMap<number, Entity>,
  state?: GameState,
): void {
  if (source.monsterKind !== MonsterKind.MATKA || !source.ai) return;
  if (source.matkaTimer === Number.POSITIVE_INFINITY) return;

  const liveChildren = compactMatkaChildren(source, entityById);
  source.matkaTimer = (source.matkaTimer ?? MATKA_SPAWN_COOLDOWN_SEC) - dt;
  if (source.matkaTimer > 0) return;
  source.matkaTimer = MATKA_SPAWN_COOLDOWN_SEC;
  if (liveChildren >= MATKA_CHILD_CAP) return;

  const child = spawnMatkaChild(world, entities, source, nextId);
  if (!child) {
    source.matkaTimer = Math.max(1, MATKA_SPAWN_COOLDOWN_SEC * 0.25);
    return;
  }

  const def = MONSTERS[child.monsterKind ?? MonsterKind.SBORKA];
  msgs.push(msg(`Матка родила ${def.name}. Источник умрёт, но приплод останется.`, time, '#f4a'));
  if (state) {
    const ci = world.idx(Math.floor(source.x), Math.floor(source.y));
    const roomId = world.roomMap[ci];
    publishEvent(state, {
      type: 'matka_child_spawned',
      zoneId: world.zoneMap[ci],
      roomId: roomId >= 0 ? roomId : undefined,
      x: source.x,
      y: source.y,
      actorId: source.id,
      actorName: entityDisplayName(source),
      targetId: child.id,
      targetName: entityDisplayName(child),
      monsterKind: MonsterKind.MATKA,
      severity: 4,
      privacy: 'local',
      tags: ['monster', 'matka', 'source_hive', 'children', 'spawn'],
      data: {
        sourceId: source.id,
        childKind: child.monsterKind,
        liveChildren: liveChildren + 1,
        maxChildren: MATKA_CHILD_CAP,
        cooldown: MATKA_SPAWN_COOLDOWN_SEC,
        rumorIds: [...MATKA_RUMOR_IDS],
        counterplay: 'kill_source_stops_new_children_existing_children_remain',
      },
    });
  }
}
