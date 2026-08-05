import {
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
  type GameState,
  type Item,
  msg,
} from '../core/types';
import { ITEMS } from '../data/catalog';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { ITEM_OUTCOME_RULES, type ItemOutcomeRule } from '../data/item_outcomes';
import { getStack } from '../data/items';
import { addFactionRelMutual } from '../data/relations';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';
import { currentFloorRunEntry, floorRunEntryKind, floorRunEntryRouteId } from './procedural_floors';

const ITEM_ID = 'maronary_shaving';
const BASE_TAGS = ['player', 'inventory', 'maronary', 'contraband', 'evidence'];

function shavingDef() {
  return ITEMS[ITEM_ID];
}

function eventTags(...extra: string[]): string[] {
  const tags = [...BASE_TAGS, ...extra];
  const def = shavingDef();
  for (const tag of def?.tags ?? []) if (!tags.includes(tag)) tags.push(tag);
  return tags;
}

function removeOneFromSlot(inv: Item[], slotIdx: number): boolean {
  const slot = inv[slotIdx];
  if (!slot || slot.defId !== ITEM_ID || slot.count <= 0) return false;
  slot.count--;
  if (slot.count <= 0) inv.splice(slotIdx, 1);
  return true;
}

function addToNpcInventory(npc: Entity): boolean {
  if (!npc.inventory) npc.inventory = [];
  const def = shavingDef();
  if (!def) return false;
  const maxStack = getStack(def);
  for (const slot of npc.inventory) {
    if (slot.defId !== ITEM_ID || slot.count >= maxStack || slot.data !== undefined) continue;
    slot.count++;
    return true;
  }
  if (npc.inventory.length >= MAX_INVENTORY_SLOTS) return false;
  npc.inventory.push({ defId: ITEM_ID, count: 1 });
  return true;
}

function enumTag(prefix: string, registry: object, value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = (registry as Record<number, string>)[value];
  return name ? `${prefix}:${name.toLowerCase()}` : undefined;
}

function pushUnique(out: string[], tag: string | undefined): void {
  if (tag && !out.includes(tag)) out.push(tag);
}

function buyerRoleTags(npc: Entity): string[] {
  const tags: string[] = [];
  const roleSource = npc as Entity & { roleId?: string; roleTags?: readonly string[] };
  pushUnique(tags, roleSource.roleId ? `role:${roleSource.roleId}` : undefined);
  for (const tag of roleSource.roleTags ?? []) pushUnique(tags, tag);
  pushUnique(tags, npc.plotNpcId ? `plot:${npc.plotNpcId}` : undefined);
  pushUnique(tags, npc.persistentNpcId ? `persistent:${npc.persistentNpcId}` : undefined);
  pushUnique(tags, npc.npcVisualId ? `visual:${npc.npcVisualId}` : undefined);
  pushUnique(tags, enumTag('faction', Faction, npc.faction));
  pushUnique(tags, enumTag('occupation', Occupation, npc.occupation));
  if (npc.canGiveQuest) pushUnique(tags, 'quest_giver');
  return tags;
}

function currentQuestTags(state: GameState): string[] {
  const tags: string[] = [];
  for (const quest of state.quests) {
    if (quest.done || quest.failed) continue;
    pushUnique(tags, quest.sideQuestId ? `side:${quest.sideQuestId}` : undefined);
    pushUnique(tags, quest.contractId ? `contract:${quest.contractId}` : undefined);
    pushUnique(tags, quest.targetItem ? `target_item:${quest.targetItem}` : undefined);
    for (const tag of quest.eventTags ?? []) pushUnique(tags, tag);
    for (const tag of quest.targetRoute?.tags ?? []) pushUnique(tags, tag);
  }
  return tags;
}

function currentRouteTags(state: GameState): string[] {
  const tags: string[] = [];
  pushUnique(tags, enumTag('floor', FloorLevel, state.currentFloor));
  const entry = currentFloorRunEntry(state);
  pushUnique(tags, `route:${floorRunEntryRouteId(entry)}`);
  pushUnique(tags, `route_kind:${floorRunEntryKind(entry)}`);
  pushUnique(tags, `z:${entry.z}`);
  pushUnique(tags, enumTag('base_floor', FloorLevel, entry.baseFloor));
  return tags;
}

function matchesAll(required: readonly string[] | undefined, actual: readonly string[]): boolean {
  return required === undefined || required.every(tag => actual.includes(tag));
}

function hasAny<T>(required: readonly T[] | undefined, value: T | undefined): boolean {
  return value !== undefined && required !== undefined && required.includes(value);
}

function ruleMatchesBuyer(rule: ItemOutcomeRule, npc: Entity, roleTags: readonly string[]): boolean {
  const match = rule.match;
  const hasBuyerRule = Boolean(
    match.buyerPlotNpcIds?.length
    || match.buyerFactions?.length
    || match.buyerOccupations?.length
    || match.buyerRoleTags?.length
  );
  if (!hasBuyerRule) return true;
  if (match.buyerPlotNpcIds?.includes(npc.plotNpcId ?? '')) return true;
  if (hasAny(match.buyerFactions, npc.faction)) return true;
  if (hasAny(match.buyerOccupations, npc.occupation)) return true;
  return Boolean(match.buyerRoleTags?.some(tag => roleTags.includes(tag)));
}

function ruleMatches(rule: ItemOutcomeRule, npc: Entity, state: GameState): boolean {
  if (rule.itemId !== ITEM_ID) return false;
  const defTags = shavingDef()?.tags ?? [];
  const routeTags = currentRouteTags(state);
  const questTags = currentQuestTags(state);
  if (!matchesAll(rule.match.itemTags, defTags)) return false;
  if (rule.match.floorLevels && !rule.match.floorLevels.includes(state.currentFloor)) return false;
  if (!matchesAll(rule.match.routeTags, routeTags)) return false;
  if (!matchesAll(rule.match.questTags, questTags)) return false;
  return ruleMatchesBuyer(rule, npc, buyerRoleTags(npc));
}

function resolveOutcomeRule(npc: Entity, state: GameState): ItemOutcomeRule {
  const rule = ITEM_OUTCOME_RULES.find(entry => ruleMatches(entry, npc, state)) ?? ITEM_OUTCOME_RULES[ITEM_OUTCOME_RULES.length - 1];
  if (!rule) throw new Error('Missing maronary shaving item outcome rule');
  return rule;
}

function applyRelationDeltas(rule: ItemOutcomeRule): void {
  for (const delta of rule.relationDeltas ?? []) {
    addFactionRelMutual(delta.faction, delta.targetFaction, delta.delta);
  }
}

function renderOutcomeText(rule: ItemOutcomeRule, npcName: string): string {
  return rule.message
    .split('{buyer}').join(npcName)
    .split('{reward}').join(String(rule.rewardMoney));
}

export function destroyMaronaryShaving(actor: Entity, state: GameState | undefined): string {
  if (actor.rpg) actor.rpg.psi = Math.max(0, actor.rpg.psi - 6);
  else if (actor.hp !== undefined) actor.hp = Math.max(1, actor.hp - 2);

  if (state && isPlayerEntity(actor)) {
    const def = shavingDef();
    publishEvent(state, {
      type: 'player_destroy_item',
      actorId: actor.id,
      actorName: actor.name ?? 'Вы',
      actorFaction: actor.faction,
      itemId: ITEM_ID,
      itemName: def?.name ?? ITEM_ID,
      itemCount: 1,
      itemValue: def?.value ?? 0,
      severity: 4,
      privacy: 'local',
      tags: eventTags('destroyed', 'sample'),
      data: {
        outcome: 'destroyed',
        psiCost: actor.rpg ? 6 : 0,
        hpCost: actor.rpg ? 0 : 2,
        rumorIds: ['samosbor_maronary_shaving_hidden'],
      },
    });
  }

  return actor.rpg
    ? 'Стружка рассыпалась в серую пыль. Писк доказал ошибку: ПСИ -6.'
    : 'Стружка рассыпалась в серую пыль. Пальцы саднит, но документы молчат: HP -2.';
}

export function publishMaronaryShavingAcquired(actor: Entity, state: GameState, source: string): void {
  if (!isPlayerEntity(actor)) return;
  const def = shavingDef();
  publishEvent(state, {
    type: 'player_pick_item',
    actorId: actor.id,
    actorName: actor.name ?? 'Вы',
    actorFaction: actor.faction,
    itemId: ITEM_ID,
    itemName: def?.name ?? ITEM_ID,
    itemCount: 1,
    itemValue: def?.value ?? 0,
    severity: 3,
    privacy: 'local',
    tags: eventTags('acquire', source),
    data: {
      source,
      rumorIds: ['samosbor_maronary_shaving'],
    },
  });
}

export function tryHandleMaronaryShavingHandoff(
  player: Entity,
  npc: Entity,
  slotIdx: number,
  state: GameState,
): boolean {
  const inv = player.inventory;
  const slot = inv?.[slotIdx];
  if (!inv || !slot || slot.defId !== ITEM_ID) return false;
  if (!addToNpcInventory(npc)) {
    state.msgs.push(msg(`${npc.name ?? 'Покупатель'} некуда спрятать стружку отдельно от документов.`, state.time, '#f84'));
    return true;
  }
  if (!removeOneFromSlot(inv, slotIdx)) return false;

  const rule = resolveOutcomeRule(npc, state);
  const outcome = rule.outcome;
  const reward = rule.rewardMoney;
  const def = shavingDef();
  player.money = (player.money ?? 0) + reward;
  applyRelationDeltas(rule);

  const npcName = npc.name ?? 'Покупатель';
  state.msgs.push(msg(
    renderOutcomeText(rule, npcName),
    state.time,
    rule.messageColor,
  ));
  publishEvent(state, {
    type: rule.kind === 'sale' ? 'player_sell_item' : 'player_handoff_item',
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetId: npc.id,
    targetName: npcName,
    targetFaction: npc.faction,
    itemId: ITEM_ID,
    itemName: def?.name ?? ITEM_ID,
    itemCount: 1,
    itemValue: reward,
    severity: rule.severity,
    privacy: rule.privacy,
    tags: eventTags(...rule.eventTags),
    data: {
      outcome,
      buyerPlotNpcId: npc.plotNpcId,
      reward,
      rumorIds: [...rule.rumorIds],
    },
  });
  return true;
}
