/* ── Quest log panel — paginated, one quest per page ──────────── */

import {
  FloorLevel,
  LiftDirection,
  RoomType,
  type GameState,
  type Quest,
  QuestType,
} from '../core/types';
import { ITEMS } from '../data/catalog';
import { zForStoryFloor } from '../data/procedural_floors';
import { isQuestTargetOnCurrentFloor, questRouteFloor, questRouteTargetLabel, questTargetLiftDirection } from '../systems/contracts';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { getRecentEvents } from '../systems/events';
import { getRecentRumorLead } from '../systems/npc_memory';
import { currentFloorRunEntry, floorRunEntryMapLabel, formatFloorZ } from '../systems/procedural_floors';
import { formatQuestMinutes, questDeadlineText, questHasDeadline, questRemainingMinutes } from '../systems/quest_deadlines';
import { getActiveQuest, isQuestSelectableAsActive, type CurrentObjective } from '../systems/quests';
import { drawNeuroPanel, drawGlitchText } from './hud_fx';
import { drawWrappedText, fitText } from './ui_text';

const FLOOR_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'Министерство',
  [FloorLevel.KVARTIRY]: 'Квартиры',
  [FloorLevel.LIVING]: 'Жилая зона',
  [FloorLevel.MAINTENANCE]: 'Коллекторы',
  [FloorLevel.HELL]: 'Мясной низ',
  [FloorLevel.VOID]: 'Пустота',
};

const FLOOR_SHORT_NAMES: Record<FloorLevel, string> = {
  [FloorLevel.MINISTRY]: 'МИН',
  [FloorLevel.KVARTIRY]: 'КВ',
  [FloorLevel.LIVING]: 'ЖИЛ',
  [FloorLevel.MAINTENANCE]: 'КОЛ',
  [FloorLevel.HELL]: 'АД',
  [FloorLevel.VOID]: 'ПУСТ',
};

const ROOM_TYPE_NAMES: Record<RoomType, string> = {
  [RoomType.LIVING]: 'жилые комнаты',
  [RoomType.KITCHEN]: 'кухни',
  [RoomType.BATHROOM]: 'санузлы',
  [RoomType.STORAGE]: 'кладовые',
  [RoomType.MEDICAL]: 'медпункты',
  [RoomType.COMMON]: 'общие залы',
  [RoomType.PRODUCTION]: 'цеха',
  [RoomType.CORRIDOR]: 'коридоры',
  [RoomType.SMOKING]: 'курилки',
  [RoomType.OFFICE]: 'кабинеты',
  [RoomType.HQ]: 'штабы',
  [RoomType.CLASSROOM]: 'классы',
};

const QUEST_TYPE_LABELS: Record<QuestType, string> = {
  [QuestType.FETCH]: 'ДОБ',
  [QuestType.VISIT]: 'МЕСТ',
  [QuestType.KILL]: 'БОЙ',
  [QuestType.TALK]: 'РАЗГ',
};

type QuestKind = 'plot' | 'side' | 'system';

const QUEST_KIND_META: Record<QuestKind, { label: string; stroke: string; fill: string; text: string }> = {
  plot: { label: 'СЮЖ', stroke: '#0b5570', fill: '#0c2633', text: '#6cf' },
  side: { label: 'БОК', stroke: '#704060', fill: '#2b1726', text: '#f7a7d8' },
  system: { label: 'СИСТ', stroke: '#76631a', fill: '#2a2309', text: '#ffd35f' },
};

function routeFloor(q: Quest): FloorLevel | undefined {
  return questRouteFloor(q);
}

function questKind(q: Quest): QuestKind {
  if (q.plotStepIndex !== undefined) return 'plot';
  if (q.sideQuestId !== undefined) return 'side';
  return 'system';
}

function displayFloor(q: Quest, state: GameState): FloorLevel | undefined {
  const floor = routeFloor(q);
  if (floor !== undefined) return floor;
  if (q.targetRoom !== undefined || q.targetNpcId !== undefined || q.targetMonsterKind !== undefined) return state.currentFloor;
  if (q.plotStepIndex === undefined && q.sideQuestId === undefined) return state.currentFloor;
  return undefined;
}

function objectiveFloorLabel(q: Quest, state: GameState): string {
  const floor = displayFloor(q, state);
  if (floor === undefined) return 'ЭТ ?';
  return isQuestTargetOnCurrentFloor(q, state) ? 'ЭТ ЗДЕСЬ' : `ЭТ ${FLOOR_SHORT_NAMES[floor]}`;
}

function deadlineMeta(q: Quest, state: GameState): { text: string; stroke: string; fill: string; color: string } {
  if (q.failed) return { text: 'ПРОВАЛ', stroke: '#733', fill: '#281010', color: '#f66' };
  if (q.done) return { text: 'ГОТОВО', stroke: '#365536', fill: '#102410', color: '#8f8' };

  const remaining = questRemainingMinutes(q, state.clock.totalMinutes);
  if (remaining === undefined) return { text: 'СРОК --', stroke: '#33444a', fill: '#10181c', color: '#789' };
  const color = remaining <= 120 ? '#f66' : remaining <= 360 ? '#fa6' : '#8cf';
  const stroke = remaining <= 120 ? '#733' : remaining <= 360 ? '#754' : '#34536c';
  const fill = remaining <= 120 ? '#281010' : remaining <= 360 ? '#261908' : '#101925';
  return { text: `СРОК ${formatQuestMinutes(remaining)}`, stroke, fill, color };
}

function rewardItemLabel(defId: string, count = 1): string {
  const name = ITEMS[defId]?.name ?? defId;
  return count > 1 ? `${name}×${count}` : name;
}

function rewardSummary(q: Quest): string {
  const parts: string[] = [];
  if ((q.moneyReward ?? 0) > 0) parts.push(`${q.moneyReward}₽`);
  if (q.rewardItem) parts.push(rewardItemLabel(q.rewardItem, q.rewardCount ?? 1));
  if (q.extraRewards?.length) {
    if (q.extraRewards.length === 1) {
      const extra = q.extraRewards[0];
      parts.push(rewardItemLabel(extra.defId, extra.count));
    } else {
      const count = q.extraRewards.reduce((sum, r) => sum + r.count, 0);
      parts.push(`ещё×${count}`);
    }
  }
  if ((q.xpReward ?? 0) > 0) parts.push(`${q.xpReward}XP`);
  return parts.length > 0 ? `ПЛАТА ${parts.join('+')}` : 'ПЛАТА --';
}

function drawLabelCell(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  stroke: string,
  fill: string,
  color: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.fillStyle = color;
  const oldBaseline = ctx.textBaseline;
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, text, Math.max(0, w - 4)), x + 2, y + h * 0.5);
  ctx.textBaseline = oldBaseline;
}

function drawObjectiveRow(
  ctx: CanvasRenderingContext2D,
  q: Quest,
  state: GameState,
  x: number,
  y: number,
  maxW: number,
  sx: number,
  sy: number,
  selected: boolean,
  suffix = '',
): void {
  const h = 10 * sy;
  const gap = 3 * sx;
  const kindW = 34 * sx;
  const typeW = 32 * sx;
  const floorW = 54 * sx;
  const dueW = 64 * sx;
  const rewardW = Math.max(36 * sx, maxW - kindW - typeW - floorW - dueW - gap * 4);
  const kind = QUEST_KIND_META[questKind(q)];
  const due = deadlineMeta(q, state);

  if (selected) {
    ctx.fillStyle = '#11222c';
    ctx.fillRect(x - 2 * sx, y - sy, maxW + 4 * sx, h + 2 * sy);
  }

  ctx.font = `${7 * sy}px monospace`;
  let lx = x;
  drawLabelCell(ctx, kind.label, lx, y, kindW, h, kind.stroke, kind.fill, kind.text);
  lx += kindW + gap;
  drawLabelCell(ctx, QUEST_TYPE_LABELS[q.type], lx, y, typeW, h, '#334', '#111820', '#ccd');
  lx += typeW + gap;
  drawLabelCell(ctx, objectiveFloorLabel(q, state), lx, y, floorW, h, '#25465a', '#0c1a22', '#9df');
  lx += floorW + gap;
  drawLabelCell(ctx, due.text, lx, y, dueW, h, due.stroke, due.fill, due.color);
  lx += dueW + gap;
  drawLabelCell(ctx, `${rewardSummary(q)}${suffix}`, lx, y, rewardW, h, '#40382a', '#17140d', '#f0d68a');
}

function routeDetail(q: Quest): string {
  if (q.targetHint) return q.targetHint;
  if (q.targetRoomType !== undefined) return `Нужна зона: ${ROOM_TYPE_NAMES[q.targetRoomType]}.`;
  return '';
}

function questRouteHint(q: Quest, state: GameState): string {
  if (q.done) return '';
  const floor = routeFloor(q);
  const detail = routeDetail(q);
  if (floor !== undefined) {
    if (isQuestTargetOnCurrentFloor(q, state)) return detail ? `Цель здесь. ${detail}` : 'Цель здесь.';
    const dir = questTargetLiftDirection(q, state) === LiftDirection.DOWN ? '↓' : '↑';
    const currentZ = currentFloorRunEntry(state).z;
    const routeLabel = questRouteTargetLabel(q, state);
    const targetZ = zForStoryFloor(floor);
    const target = routeLabel || `${FLOOR_NAMES[floor]} Z${formatFloorZ(targetZ)}`;
    return detail
      ? `Цель: ${target}. Лифт ${dir} от Z${formatFloorZ(currentZ)}. ${detail}`
      : `Цель: ${target}. Лифт ${dir} от Z${formatFloorZ(currentZ)}.`;
  }
  if (q.type === QuestType.TALK && q.targetPlotNpcId && q.targetNpcId === undefined) {
    return 'Собеседник на другом уровне. Нужен лифт.';
  }
  if (q.type === QuestType.VISIT && q.targetRoom === undefined) {
    return 'Комната появится на карте после входа на этаж.';
  }
  return detail;
}

function failedQuestText(q: Quest, state: GameState): string {
  const eventType = q.contractId ? 'contract_failed' : 'quest_failed';
  const event = getRecentEvents(state, { type: eventType, limit: 24 })
    .find(e => e.data?.questId === q.id || (q.contractId !== undefined && e.data?.contractId === q.contractId));
  const reason = typeof event?.data?.reason === 'string' ? event.data.reason : '';
  if (reason === 'deadline') return 'Сорвано: срок вышел';
  if (reason === 'npc_dead') return 'Сорвано: ключевой NPC погиб';
  if (reason === 'abandoned') return 'Сорвано: выбран другой исход';
  if (reason === 'opened_package') return 'Сорвано: пакет вскрыт';
  if (reason === 'route_closed') return 'Сорвано: маршрут закрыт';
  if (questHasDeadline(q) && questRemainingMinutes(q, state.clock.totalMinutes) === 0) return 'Сорвано: срок вышел';
  return 'Сорвано';
}

export function drawQuestLog(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  sx: number, sy: number,
  uiTime = state.time,
  currentObjective?: CurrentObjective | null,
): void {
  const pw = Math.min(400 * sx, ctx.canvas.width - 24 * sx);
  const ph = Math.min(320 * sy, ctx.canvas.height - 24 * sy);
  const px = (ctx.canvas.width - pw) / 2;
  const py = (ctx.canvas.height - ph) / 2;
  const time = uiTime;

  ctx.fillStyle = '#00040a';
  ctx.fillRect(px, py, pw, ph);
  drawNeuroPanel(ctx, px, py, pw, ph, time, 50);

  drawGlitchText(ctx, `ЗАДАНИЯ ${controlHint('quests')}`, px + 8 * sx, py + 6 * sy, time, 500, '#6cf', 9 * sy);
  ctx.font = `${9 * sy}px monospace`;

  const active = state.quests.filter(q => !q.done);
  const done = state.quests.filter(q => q.done);
  const all = [...active, ...done];

  if (all.length === 0) {
    ctx.fillStyle = '#666';
    ctx.font = `${8 * sy}px monospace`;
    const emptyLine = currentObjective?.line ?? `Нет заданий. Поговорите с жильцами ${controlHint('interact')}.`;
    ctx.fillText(fitText(ctx, emptyLine, pw - 16 * sx), px + 8 * sx, py + 24 * sy);
    return;
  }

  const page = Math.min(state.questPage, all.length - 1);
  const q = all[page];
  const isActiveQuest = getActiveQuest(state)?.id === q.id;
  const maxW = pw - 16 * sx;
  const contentBottom = py + ph - 22 * sy;

  // Page indicator
  ctx.fillStyle = '#888';
  ctx.font = `${7 * sy}px monospace`;
  ctx.fillText(`${page + 1} / ${all.length}`, px + pw - 40 * sx, py + 6 * sy);
  if (isActiveQuest) {
    drawLabelCell(ctx, 'АКТИВНО', px + pw - 98 * sx, py + 5 * sy, 50 * sx, 10 * sy, '#8a5c00', '#2a2107', '#ffd21f');
  }

  // Quest giver
  ctx.fillStyle = '#8af';
  ctx.font = `${8 * sy}px monospace`;
  let ly = py + 32 * sy;
  ctx.fillText(fitText(ctx, `От: ${q.giverName ?? '???'}`, maxW), px + 8 * sx, ly);
  ly += 8 * sy;
  drawObjectiveRow(ctx, q, state, px + 8 * sx, ly, maxW, sx, sy, isActiveQuest);

  // Status badge
  const isFailed = q.failed === true;
  const isDone = q.done && !isFailed;
  ctx.fillStyle = isFailed ? '#f66' : isDone ? '#484' : '#dda';
  ctx.font = `${8 * sy}px monospace`;

  // Word-wrapped description
  const prefix = isFailed ? '× ' : isDone ? '✓ ' : '• ';
  ly += 16 * sy;
  ly = drawWrappedText(
    ctx,
    prefix + q.desc,
    px + 8 * sx,
    ly,
    maxW,
    12 * sy,
    Math.max(1, Math.floor((contentBottom - ly) / (12 * sy))),
  );

  // Progress for KILL quests
  if (!q.done && q.killNeeded !== undefined && ly < contentBottom) {
    ly += 4 * sy;
    ctx.fillStyle = '#aaa';
    ctx.fillText(`Прогресс: ${q.killCount ?? 0}/${q.killNeeded}`, px + 8 * sx, ly);
  }
  if (!q.done && q.holdSeconds !== undefined && ly < contentBottom) {
    ly += 4 * sy;
    ctx.fillStyle = '#aaa';
    const have = Math.floor(q.holdProgressSeconds ?? 0);
    const need = Math.floor(q.holdSeconds);
    ctx.fillText(`Удержание: ${have}/${need} сек`, px + 8 * sx, ly);
  }

  const remaining = questRemainingMinutes(q, state.clock.totalMinutes);
  if (!q.done && remaining !== undefined && ly < contentBottom) {
    ly += 12 * sy;
    ctx.fillStyle = remaining <= 120 ? '#f66' : remaining <= 360 ? '#fa6' : '#8cf';
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillText(fitText(ctx, `Срок: ${questDeadlineText(q, state.clock.totalMinutes)}`, maxW), px + 8 * sx, ly);
  } else if (isFailed && ly < contentBottom) {
    ly += 12 * sy;
    ctx.fillStyle = '#f66';
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillText(fitText(ctx, failedQuestText(q, state), maxW), px + 8 * sx, ly);
  }

  const routeHint = questRouteHint(q, state);
  if (routeHint && ly < contentBottom) {
    ly += 12 * sy;
    ctx.fillStyle = '#8cf';
    ctx.font = `${7 * sy}px monospace`;
    ly = drawWrappedText(
      ctx,
      routeHint,
      px + 8 * sx,
      ly,
      maxW,
      9 * sy,
      Math.max(1, Math.floor((contentBottom - ly) / (9 * sy))),
    );
  }
  if (ly < contentBottom) {
    ly += 8 * sy;
    ctx.fillStyle = '#7ad';
    ctx.font = `${7 * sy}px monospace`;
    ctx.fillText(fitText(ctx, `Маршрут: ${floorRunEntryMapLabel(currentFloorRunEntry(state))}`, maxW), px + 8 * sx, ly);
  }

  const rumorLead = getRecentRumorLead(state.time);
  if (rumorLead && ly < py + ph - 28 * sy) {
    ly += 8 * sy;
    ctx.fillStyle = '#d9a';
    ctx.font = `${7 * sy}px monospace`;
    drawWrappedText(ctx, `Слух: ${rumorLead.text}`, px + 8 * sx, ly, maxW, 9 * sy, Math.max(1, Math.floor((contentBottom - ly) / (9 * sy))));
  }

  // Bottom hint
  ctx.fillStyle = '#555';
  ctx.font = `${7 * sy}px monospace`;
  const pageHint = all.length > 1 ? `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} листать` : '';
  const activeHint = isQuestSelectableAsActive(q) ? `${controlHint('gameMenu')} ${isActiveQuest ? 'снять цель' : 'цель на карте'}` : '';
  const hint = [pageHint, activeHint, `${menuCloseHint()} закрыть`].filter(Boolean).join('  |  ');
  ctx.fillText(fitText(ctx, hint, maxW), px + 8 * sx, py + ph - 8 * sy);
}
