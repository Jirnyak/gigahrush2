/* ── Пахом Братишка — wandering NPC (kvartiry) ───────────────── */
/* Цитаты из «Зелёного слоника».                                   */

import {
  W, Cell,
  type Entity, Faction, FloorLevel, Occupation,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerAuthoredNpc, storyNpcFloorKey } from '../../data/plot';
import { authoredNpcSpr } from '../../render/sprite_index';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const NPC_ID = 'pahom_bratishka';

const NPC_DEF: PlotNpcDef = {
  name: 'Пахом Братишка',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.ALCOHOLIC,
  sprite: authoredNpcSpr(NPC_ID),
  hp: 250, maxHp: 250, money: 30, speed: 1.0,
  inventory: [
    { defId: 'kasha', count: 3 },
    { defId: 'bread', count: 2 },
    { defId: 'cigs', count: 4 },
    { defId: 'knife', count: 1 },
  ],
  talkLines: [
    'Я кашу держу в кармане, пока крысы не нашли. Тебе надо?',
    'Ты тут как, живой? Глаза нормальные, только усталые.',
    'Не обижайся, если я близко стою. В коридоре иначе тебя сразу отрежут.',
    'Каша тёплая была утром. Сейчас просто честная.',
    'Поешь. С пустым животом сирена звучит ближе.',
    'Я по-доброму. Нож у меня для двери, не для людей, если люди не первые.',
    'Свои тут те, кто делится до отбоя. После отбоя уже поздно знакомиться.',
    'Я принёс хлеб и сигареты. За них сосед иногда становится соседом.',
    'Не кричи. Стены тонкие, а некоторые стены отвечают.',
    'Покурим у шахты, только пепел в банку. Клава за грязь ругается страшнее обхода.',
  ],
  talkLinesPost: [
    'Заходи, если будет чем делиться. Я обычно здесь, пока коридор не передумал.',
    'Каша стынет, но ещё съедобная. Это редкость.',
    'Если у стояка начнётся давка, держись стены и не спорь с мокрыми руками.',
  ],
};

registerAuthoredNpc({
  id: NPC_ID,
  npc: NPC_DEF,
  homeFloorKey: storyNpcFloorKey(FloorLevel.KVARTIRY),
  tags: ['kvartiry', 'social'],
});

export function spawnPahomBratishka(
  world: World, entities: Entity[], nextId: { v: number },
): void {
  for (let i = 0; i < 3000; i++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    if (world.cells[world.idx(x, y)] !== Cell.FLOOR) continue;
    requireSpawnedPlotNpcFromPackage(entities, nextId, NPC_ID, x + 0.5, y + 0.5, {
      angle: Math.random() * Math.PI * 2,
      weapon: 'knife',
      canGiveQuest: false,
      isTraveler: true,
    });
    return;
  }
}
