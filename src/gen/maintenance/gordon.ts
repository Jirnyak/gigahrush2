/* ── Гордон Фримен — silent wandering NPC (maintenance) ───────── */
/* Не разговаривает. Все «реплики» — narration в скобках.          */

import {
  W, Cell,
  type Entity, Faction, FloorLevel, Occupation,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { authoredNpcSpr } from '../../render/sprite_index';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_ID = 'gordon_freeman';

const NPC_DEF: PlotNpcDef = {
  name: 'Гордон Фримен',
  isFemale: false,
  age: 28,
  sex: 'male',
  faction: Faction.SCIENTIST,
  occupation: Occupation.SCIENTIST,
  sprite: authoredNpcSpr(NPC_ID),
  hp: 350, maxHp: 350, money: 0, speed: 1.3,
  inventory: [
    { defId: 'wrench', count: 1 },
    { defId: 'ammo_9mm', count: 30 },
    { defId: 'bandage', count: 4 },
  ],
  talkLines: [
    '[Гордон молча смотрит на вас сквозь очки.]',
    '[По его взгляду вы понимаете, что он highly trained professional and doesn\'t need to hear all of this.]',
    '[Гордон поправляет очки.]',
    '[Он перехватывает гаечный ключ поудобнее. Ничего не говорит.]',
    '[Гордон медленно кивает. Один раз.]',
    '[На груди тихо мигает индикатор HEV-костюма. 76% брони.]',
    '[Вы вспоминаете, как сержант Баринов говорил: «Похоже, наука — это ещё не всё».]',
    '[Гордон роется в ближайшей куче хлама, будто ищет монтировку?]',
    '[Он смотрит в потолок коллектора. Возможно, ищет вентиляцию.]',
    '[Гордон поднимает руку — то ли приветствие, то ли проверка перчаток.]',
  ],
  talkLinesPost: [
    '[Гордон молча смотрит сквозь вас. Очки бликуют.]',
    '[Он ничего не говорит. Это уже всё сказано.]',
  ],
};

// No quest — just a silent reference NPC
registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.MAINTENANCE),
  tags: ['maintenance', 'silent'],
});

export function spawnGordonFreeman(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'wrench',
      canGiveQuest: false,
      isTraveler: true,
    });
    return;
  }
}
