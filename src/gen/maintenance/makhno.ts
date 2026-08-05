/* ── Махно — лидер диких в коллекторах (side quest target) ─────── */
/*   Spawns on the maintenance floor. Target for Kantselev quest.  */

import {
  W, Cell, FloorLevel,
  type Entity, EntityType, AIGoal, Faction, Occupation,
} from '../../core/types';
import { World } from '../../core/world';
import { irand } from '../../core/rand';
import { freshNeeds } from '../../data/catalog';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { randomRPG, getMaxHp } from '../../systems/rpg';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_ID = 'makhno';

/* ── NPC definition ──────────────────────────────────────────── */
const NPC_DEF: PlotNpcDef = {
  name: 'Махно',
  isFemale: false,
  faction: Faction.WILD,
  occupation: Occupation.TRAVELER,
  sprite: Occupation.TRAVELER,
  hp: 8000, maxHp: 8000, money: 200, speed: 1.8,
  inventory: [
    { defId: 'axe', count: 1 },
    { defId: 'canned', count: 3 },
    { defId: 'bandage', count: 2 },
  ],
  talkLines: [
    'Махно! Батька Махно! Кто спрашивает?!',
    'Эти трубы — наша территория. Скажи своему Председателю — пусть подавится своими коврами.',
    'Мы свободные люди. Ни министерство, ни ликвидаторы нам не указ.',
    'Хочешь войны? Получишь. Дикие не сдаются.',
    'Уходи пока цел. Или оставайся — навсегда.',
  ],
  talkLinesPost: [
    'Ещё живой? Не надолго.',
    'Батька помнит всех.',
  ],
};

// Register in global plot NPCs (no quests from Makhno — he's a target)
registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.MAINTENANCE),
  tags: ['maintenance', 'wild', 'leader'],
});

/* ── Spawn Makhno at a random floor cell on maintenance ───────── */
export function spawnMakhno(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    const rpg = randomRPG(12);
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'axe',
      canGiveQuest: false,
      isTraveler: true,
      extra: {
        ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        rpg,
      },
    });
    // Also spawn 4-6 wild bodyguards nearby
    const guardCount = 4 + Math.floor(Math.random() * 3);
    for (let g = 0; g < guardCount; g++) {
      for (let a = 0; a < 50; a++) {
        const gx = x + Math.floor(Math.random() * 8) - 4;
        const gy = y + Math.floor(Math.random() * 8) - 4;
        const wi = world.wrap(gx), wiy = world.wrap(gy);
        if (world.cells[world.idx(wi, wiy)] !== Cell.FLOOR) continue;
        const gRpg = randomRPG(10);
        const gMaxHp = Math.round(getMaxHp(gRpg) * 2);
        entities.push({
          id: nextId.v++, type: EntityType.NPC,
          x: wi + 0.5, y: wiy + 0.5,
          angle: Math.random() * Math.PI * 2, pitch: 0,
          alive: true, speed: 1.6 + Math.random() * 0.3, sprite: Occupation.TRAVELER,
          name: 'Дикий боец', isFemale: false,
          needs: freshNeeds(), hp: gMaxHp, maxHp: gMaxHp, money: irand(5, 30),
          ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
          inventory: [{ defId: 'pipe', count: 1 }],
          weapon: 'pipe',
          faction: Faction.WILD, occupation: Occupation.TRAVELER,
          isTraveler: true,
          rpg: gRpg,
        });
        break;
      }
    }
    return;
  }
}
