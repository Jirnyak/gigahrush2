import { EntityType, type Entity, type GameState } from '../core/types';
import { World } from '../core/world';
import { countContainerItems } from './containers';
import { summarizeEconomy } from './economy';
import { summarizeProduction } from './production';

export function populationItemSummary(world: World, entities: Entity[], state: GameState): string[] {
  let npcs = 0, monsters = 0, drops = 0, dropItems = 0;
  for (const e of entities) {
    if (!e.alive) continue;
    if (e.type === EntityType.NPC) npcs++;
    else if (e.type === EntityType.MONSTER) monsters++;
    else if (e.type === EntityType.ITEM_DROP) {
      drops++;
      for (const i of e.inventory ?? []) dropItems += i.count;
    }
  }
  return [
    `NPC=${npcs} MON=${monsters} DROP=${drops}/${dropItems}`,
    `CONT=${world.containers.length}/${countContainerItems(world)}`,
    ...summarizeEconomy(state, 4),
    ...summarizeProduction(state, 3),
  ];
}
