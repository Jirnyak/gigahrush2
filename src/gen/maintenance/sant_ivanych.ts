/* ── Сантехник Иваныч — side quest (maintenance floor) ────────── */
/* Старый сантехник коллектора — собирает ключи и трубы.            */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Сантехник Иваныч',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.LOCKSMITH,
  sprite: Occupation.LOCKSMITH,
  hp: 140, maxHp: 140, money: 30, speed: 0.9,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'water', count: 2 },
    { defId: 'cigs', count: 3 },
  ],
  talkLines: [
    'Сантехник я. Иваныч. Тридцать лет в этих трубах. Знаю каждый стояк.',
    'Тут, брат, всё дышит. Трубы. Стены. Бетон сосёт воду из канала и срыгивает через швы.',
    'Ключей мне не хватает. Дикие воруют, мертвяки грызут, а я с одним хожу.',
    'Прокладка сухая? Значит кран ещё можно уговорить. Мокрую мне не суй, она уже на стороне воды.',
    'В луже под лампой не стой. Электрик потом скажет "фаза", а мне тебя вытаскивать.',
    'Принеси пять гаечных ключей — и я тебе бак с горючкой откачу. Прям из канистры.',
  ],
  talkLinesPost: [
    'Теперь у меня запас. Спасибо, родной.',
    'Заходи, если течь увидишь. Заварю.',
    'Главное — не пей из канала. Там и тварь живёт, и хлор.',
    'Если кран кашляет фиолетовым, сначала рот закрывай, потом стояк.',
  ],
};

registerSideQuest('sant_ivanych', NPC_DEF, [
  {
    id: 'ivanych_wrenches',
    giverNpcId: 'sant_ivanych',
    type: QuestType.FETCH,
    desc: 'Иваныч: «Принеси пять гаечных ключей. Без них я ни одну течь не заварю, а ты в луже не стой.»',
    targetItem: 'wrench', targetCount: 5,
    rewardItem: 'ammo_fuel', rewardCount: 2,
    extraRewards: [
      { defId: 'pipe', count: 1 },
      { defId: 'canned', count: 2 },
      { defId: 'grenade', count: 1 },
    ],
    relationDelta: 15, xpReward: 50, moneyReward: 60,
  },
]);

export function spawnIvanych(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'sant_ivanych', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'wrench',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
