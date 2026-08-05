/* ── Горланов — side quest (kvartiry floor) ───────────────────── */
/* Шумный провокатор с обрезом. Контрбаланс Листовому.             */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType, MonsterKind,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_DEF: PlotNpcDef = {
  name: 'Горланов',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.DIRECTOR,
  sprite: Occupation.DIRECTOR,
  hp: 250, maxHp: 250, money: 300, speed: 1.2,
  inventory: [
    { defId: 'shotgun', count: 1 },
    { defId: 'ammo_shells', count: 8 },
    { defId: 'cigs', count: 5 },
    { defId: 'kompot', count: 2 },
  ],
  talkLines: [
    'ОДНОЗНАЧНО! От двери отошли. Я через ваш шум не слышу, где стена шевелится.',
    'Я громкий не для красоты. Когда сирена молчит, громкий голос заменяет обходной журнал.',
    'Листовой собирает бюллетени, а теневики собирают лица. Угадайте, кто быстрее работает ночью.',
    'Сначала на кухне плесень, потом в углу тень, потом сосед просит соль чужим голосом.',
    'Принеси пять отметок о теневиках. Головы не тащи: в коридоре и так пахнет после зачистки.',
    'Всем по квартире? Сначала всем по рабочей герме, сухому фильтру и целому глазку.',
    'Если наряд не успевает, порядок идёт с обрезом, журналом учёта и двумя свидетелями.',
    'Кричу потому, что тихих здесь первыми записывают в пропавшие без номера комнаты.',
  ],
  talkLinesPost: [
    'ОДНОЗНАЧНО! Пять теней списаны. Теперь ведомость хотя бы похожа на правду.',
    'Держи сигарету. Не награда, а отметка: ты видел, где стена была не стеной.',
    'Если ещё кого чистить, сначала покажи маршрут, запас патронов и кто закроет дверь за нами.',
  ],
};

registerSideQuest('gorlanov', NPC_DEF, [
  {
    id: 'gorlanov_shadows',
    giverNpcId: 'gorlanov',
    type: QuestType.KILL,
    desc: 'Горланов: «ОДНОЗНАЧНО! Пять теневиков списать. Без чистого прохода очередь до кухни не доживёт.»',
    targetMonsterKind: MonsterKind.SHADOW,
    killNeeded: 5,
    rewardItem: 'ppsh', rewardCount: 1,
    extraRewards: [
      { defId: 'ammo_9mm', count: 30 },
      { defId: 'cigs', count: 5 },
      { defId: 'kompot', count: 2 },
    ],
    relationDelta: 20, xpReward: 90, moneyReward: 200,
  },
]);

export function spawnGorlanov(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, 'gorlanov', x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'shotgun',
      isTraveler: true,
      canGiveQuest: true,
    });
    return;
  }
}
