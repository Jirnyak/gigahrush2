/* ── Plot event handlers — story triggers, quest creation, messages ── */
/*   Extracted from main.ts for modularity.                            */

import {
  Tex,
  type Entity,
  type GameState,
  MonsterKind,
  QuestType,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { PLOT_CHAIN } from './plot';

/* ── Heralds killed → lower Podad route opens ───────────────── */
export function onHeraldKilled(
  e: Entity, world: World, state: GameState,
): boolean {
  const heraldStepIndex = PLOT_CHAIN.findIndex(step =>
    step.type === QuestType.KILL &&
    step.targetMonsterKind === MonsterKind.HERALD &&
    (step.killNeeded ?? 1) === 3);
  if (heraldStepIndex < 0) return false;
  const heraldQuest = state.quests.find(q =>
    q.plotStepIndex === heraldStepIndex &&
    !q.done &&
    q.type === QuestType.KILL);
  if (!heraldQuest || (heraldQuest.killCount ?? 0) < (heraldQuest.killNeeded ?? 3)) return false;

  const px = Math.floor(e.x), py = Math.floor(e.y);
  const ci = world.idx(px, py);
  const portalZid = world.zoneMap[ci];
  const zoneName = portalZid >= 0 ? `зона ${portalZid + 1}` : '???';
  state.msgs.push(msg('Марфа Пороговая: «Счёт сошёлся. Нижний лифт теперь услышит кнопку, но Пустота сама к тебе не придёт.»', state.time, '#0f8'));
  state.msgs.push(msg(`Нижний маршрут Подада открыт через ${zoneName}. Ищи лифт вниз.`, state.time, '#0ff'));
  return true; // caller should update route gates/world data
}

/* ── Creator killed → return portal ──────────────────────────── */
export function onCreatorKilled(
  e: Entity, world: World, state: GameState,
): boolean {
  const px = Math.floor(e.x), py = Math.floor(e.y);
  const ci = world.idx(px, py);
  world.floorTex[ci] = Tex.PORTAL;
  state.msgs.push(msg('Творец упал. Портал возврата открылся на его месте.', state.time, '#9f8'));
  state.msgs.push(msg('Встаньте в центр портала, пока залпы не вернулись.', state.time, '#0ff'));
  return true; // caller should updateWorldData
}

/* ── Hell holdout hint on arrival ────────────────────────────── */
export function onHellArrival(
  _player: Entity, state: GameState,
): void {
  const holdoutQuest = state.quests.find(q => !q.done && q.eventTags?.includes('hell_holdout'));
  if (!holdoutQuest || (holdoutQuest.holdProgressSeconds ?? 0) > 0) return;
  state.msgs.push(msg('Мясной низ принял высадку. Найдите зону закрепления и держите её до подхода группы.', state.time, '#f66'));
}

/* ── Hell entry hint; the chain itself is data-driven in PLOT_CHAIN. */
export function tryCreateVoiceQuest(
  _world: World, _entities: Entity[], state: GameState,
): void {
  const holdoutDone = state.quests.some(q => q.done && q.eventTags?.includes('hell_holdout'));
  const podadStepIndex = PLOT_CHAIN.findIndex(step => step.targetRoute?.designFloorId === 'podad');
  if (podadStepIndex < 0) return;
  const podadStepReached = state.quests.some(q => q.plotStepIndex !== undefined && q.plotStepIndex >= podadStepIndex);
  if (!holdoutDone || podadStepReached) return;
  state.msgs.push(msg('Лифт ответил тяжелым металлом: группа Громного уже идёт к зоне закрепления.', state.time, '#0f8'));
}

/* ── Void entry messages — Creator trap reveal ───────────────── */
export function onVoidEntry(state: GameState): void {
  state.msgs.push(msg('Лифт довёз до Z-50: двери называют чужие комнаты, документы не совпадают с выходами.', state.time, '#0f8'));
  state.msgs.push(msg('Творец вышел на связь без портала. Обычная дверь сейчас не вернёт вас домой.', state.time, '#9f8'));
  state.msgs.push(msg('Проверяйте рабочие предупреждения: они пишут, какая комната врёт.', state.time, '#9f8'));
  state.msgs.push(msg('Голос, который вёл вас сюда, был Творцом. Считайте новые объявления ловушкой.', state.time, '#fa0'));
  state.msgs.push(msg('Найдите Жана Пустотника. Он знает, где открыть обратный портал.', state.time, '#4af'));
}
