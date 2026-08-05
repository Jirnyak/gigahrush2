/* ── Радист Глеб — side quest (maintenance floor) ─────────────── */
/* Учёный с радиостанцией охотится за арматурными тварями.         */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Радист Глеб',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: Occupation.SCIENTIST,
  hp: 110, maxHp: 110, money: 70, speed: 1.0,
  inventory: [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 10 },
    { defId: 'antidep', count: 1 },
    { defId: 'note', count: 2 },
  ],
  talkLines: [
    'Тс-с… Я Глеб. Радист научного корпуса. Ловлю эфир в этих трубах.',
    'Слышишь треск? Это арматурные твари. Они излучают на 27 МГц. Это не норма.',
    'Каждая арматура, которую ты убьёшь — освобождает участок эфира. Я смогу слышать дальше.',
    'Убей трёх. Я отблагодарю — у меня есть «Возврат». Телепорт. Полезная штука.',
  ],
  talkLinesPost: [
    'Эфир чище. Слышу теперь Министерство. Удивительно.',
    'Если найдёшь ещё арматурные шумы — приходи.',
    'Возьми антидепрессант. От пси-фона помогает.',
  ],
};

registerSideQuest('radist_gleb', NPC_DEF, [
  {
    id: 'gleb_rebars',
    giverNpcId: 'radist_gleb',
    type: QuestType.KILL,
    desc: 'Глеб: «Убей трёх арматурных тварей. Они глушат эфир.»',
    targetMonsterKind: MonsterKind.REBAR,
    killNeeded: 3,
    rewardItem: 'psi_recall', rewardCount: 1,
    extraRewards: [
      { defId: 'psi_mark', count: 1 },
      { defId: 'ammo_energy', count: 2 },
      { defId: 'pills', count: 2 },
    ],
    relationDelta: 18, xpReward: 80, moneyReward: 100,
  },
]);

export function spawnRadistGleb(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'radist_gleb', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'makarov',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
