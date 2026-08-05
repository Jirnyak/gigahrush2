/* ── Ветеран Степаныч — side quest content module ─────────────── */
/* Wandering hunter who lost his squad. Wants the player to clean   */
/* zombies. Self-contained: NPC + KILL quest + spawn.               */

import {
  W, Cell,
  type Entity, Faction, Occupation, QuestType, MonsterKind,
  FloorLevel,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';
import { authoredNpcSpr } from '../../render/sprite_index';

const NPC_ID = 'veteran_stepanych';

const NPC_DEF: PlotNpcDef = {
  name: 'Ветеран Степаныч',
  isFemale: false,
  faction: Faction.LIQUIDATOR,
  occupation: Occupation.HUNTER,
  sprite: authoredNpcSpr(NPC_ID),
  hp: 220, maxHp: 220, money: 60, speed: 1.0,
  inventory: [
    { defId: 'pipe', count: 1 },
    { defId: 'cigs', count: 4 },
    { defId: 'kompot', count: 1 },
  ],
  talkLines: [
    'Я Степаныч. Ликвидатор первой волны. Был… Сейчас просто ходок.',
    'Мой взвод полёг в коридоре «Г-7». Мертвяки полезли изо всех щелей. Двенадцать мужиков.',
    'С тех пор я их режу везде где встречу. По одному. По два. Считаю.',
    'Поможешь? Я уже не тот. Руки трясутся. А мертвяков всё больше.',
  ],
  talkLinesPost: [
    'Ты молодец, парень. Взвод бы тобой гордился.',
    'Курить будешь? У меня всегда есть.',
    'Если снова мертвяки полезут — крикни. Приду.',
  ],
};

registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.LIVING),
  tags: ['living', 'liquidator'],
  quests: [
    {
      id: 'stepanych_zombies',
      giverNpcId: NPC_ID,
      type: QuestType.KILL,
      desc: 'Степаныч: «Прибей пятерых мертвяков. За мой взвод. Для счёта.»',
      targetMonsterKind: MonsterKind.ZOMBIE,
      killNeeded: 5,
      rewardItem: 'rebar', rewardCount: 1,
      extraRewards: [{ defId: 'kompot', count: 2 }, { defId: 'bandage', count: 2 }],
      relationDelta: 20, xpReward: 60, moneyReward: 80,
    },
  ],
});

export function spawnVeteran(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 2000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'pipe',
      canGiveQuest: true,
      isTraveler: true,
    });
    return;
  }
}
