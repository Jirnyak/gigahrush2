import { Faction, type Entity, type GameState, type WorldEventPrivacy, type WorldEventSeverity } from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import {
  getPermitDef,
  type PermitAccessTag,
  type PermitDef,
  type PermitForgeryRecipe,
} from '../data/permits';
import { applyFactionRelationDeltas, type FactionRelationDelta } from './factions';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

function actorItemIds(actor: Entity): string[] {
  const out: string[] = [];
  for (const item of actor.inventory ?? []) {
    if (item.count > 0 && !out.includes(item.defId)) out.push(item.defId);
  }
  return out;
}

export function findActorPermit(
  actor: Entity,
  tags: readonly PermitAccessTag[],
): PermitDef | undefined {
  const ids = actorItemIds(actor);
  let best: PermitDef | undefined;
  let bestScore = -1;
  for (const itemId of ids) {
    const def = getPermitDef(itemId);
    if (!def || !tags.some(tag => def.accessTags.includes(tag))) continue;
    const score = def.official ? 100 : def.method === 'expose' ? 90 : def.method === 'debt' ? 80 : 40;
    if (score > bestScore) {
      best = def;
      bestScore = score;
    }
  }
  return best;
}

function relationDeltas(def: PermitDef): FactionRelationDelta[] {
  return def.factionCost.map(cost => [cost.faction, cost.delta] as const);
}

function applyPermitFactionCost(def: PermitDef): Record<string, number> | undefined {
  const applied = applyFactionRelationDeltas(relationDeltas(def), Faction.PLAYER);
  return Object.keys(applied).length > 0 ? applied : undefined;
}

function zoneIdFor(actor: Entity, zoneId: number | undefined, world: World | undefined): number | undefined {
  if (zoneId !== undefined) return zoneId;
  if (!world) return undefined;
  return world.zoneMap[world.idx(Math.floor(actor.x), Math.floor(actor.y))];
}

function roomIdFor(actor: Entity, world: World | undefined): number | undefined {
  return world?.roomAt(actor.x, actor.y)?.id;
}

function publishPermitEvent(
  state: GameState | undefined,
  actor: Entity,
  world: World | undefined,
  def: PermitDef,
  type: 'permit_forged' | 'permit_exposed' | 'access_granted',
  severity: WorldEventSeverity,
  privacy: WorldEventPrivacy,
  targetName: string,
  tags: readonly string[],
  data: Record<string, unknown>,
  zoneId?: number,
): void {
  if (!state || !isPlayerEntity(actor)) return;
  const item = ITEMS[def.itemId];
  const relationDelta = type === 'access_granted' ? applyPermitFactionCost(def) : undefined;
  publishEvent(state, {
    type,
    zoneId: zoneIdFor(actor, zoneId, world),
    roomId: roomIdFor(actor, world),
    x: actor.x,
    y: actor.y,
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    targetName,
    targetFaction: type === 'permit_exposed' ? Faction.LIQUIDATOR : Faction.CITIZEN,
    itemId: def.itemId,
    itemName: item?.name ?? def.itemId,
    itemCount: 1,
    itemValue: item?.value ?? 0,
    severity,
    privacy,
    tags: [
      'permit',
      def.method,
      def.official ? 'official' : 'unofficial',
      ...def.accessTags,
      ...tags,
    ],
    data: {
      permitId: def.id,
      permitTitle: def.title,
      permitMethod: def.method,
      official: def.official,
      accessTags: [...def.accessTags],
      relationDelta,
      rumorIds: def.rumorIds ? [...def.rumorIds] : undefined,
      ...data,
    },
  });
}

export function recordPermitAccess(
  state: GameState | undefined,
  actor: Entity,
  world: World | undefined,
  def: PermitDef,
  targetName: string,
  requiredTag: PermitAccessTag,
  zoneId?: number,
): void {
  publishPermitEvent(
    state,
    actor,
    world,
    def,
    'access_granted',
    def.severity,
    def.privacy,
    targetName,
    ['access', 'access_granted', requiredTag],
    {
      outcome: 'access_granted',
      requiredTag,
      line: def.successLine,
    },
    zoneId,
  );
}

export function recordPermitExposure(
  state: GameState | undefined,
  actor: Entity,
  world: World | undefined,
  def: PermitDef,
  targetName: string,
  reason: string,
  zoneId?: number,
): void {
  publishPermitEvent(
    state,
    actor,
    world,
    def,
    'permit_exposed',
    Math.max(def.severity, 4) as WorldEventSeverity,
    def.method === 'forged' ? 'witnessed' : def.privacy,
    targetName,
    ['access', 'permit_exposed', 'expose', reason],
    {
      outcome: 'permit_exposed',
      reason,
      line: def.exposeLine ?? def.successLine,
    },
    zoneId,
  );
}

export function recordPermitForged(
  state: GameState | undefined,
  actor: Entity,
  world: World | undefined,
  recipe: PermitForgeryRecipe,
  zoneId?: number,
): void {
  const def = getPermitDef(recipe.outputItemId);
  if (!def) return;
  publishPermitEvent(
    state,
    actor,
    world,
    def,
    'permit_forged',
    Math.max(def.severity, 4) as WorldEventSeverity,
    'secret',
    recipe.label,
    ['access', ...recipe.eventTags],
    {
      outcome: 'permit_forged',
      recipeId: recipe.id,
      sourceItemIds: [...recipe.inputItemIds],
      rumorIds: [...recipe.rumorIds],
    },
    zoneId,
  );
}
