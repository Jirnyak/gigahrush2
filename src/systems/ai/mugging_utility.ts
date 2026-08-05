import { type GameState } from '../../core/types';

export interface NpcMuggingEntity {
  id: string;
  x: number;
  y: number;
  z?: number;
  faction?: string;
  playerRelation?: number;
  isArmed?: boolean;
  muggingCooldownTicks?: number;
  targetX?: number;
  targetY?: number;
}

/**
 * Оценивает, насколько актуален intent 'mugging' (гоп-стоп) для данного NPC.
 *
 * Критерии:
 * 1. Фракция (WILD / бандиты / враждебное отношение к игроку).
 * 2. Дистанция до игрока (<= 12 клеток).
 * 3. Кулдаун не активен.
 */
export function scoreMuggingIntent(npc: NpcMuggingEntity, _state: GameState, player: { x: number; y: number }): number {
  if (!npc || !player) return 0;
  if (npc.muggingCooldownTicks && npc.muggingCooldownTicks > 0) return 0;

  const isWildOrHostile = npc.faction === 'WILD' || (typeof npc.playerRelation === 'number' && npc.playerRelation < 0);
  if (!isWildOrHostile) return 0;

  const dx = player.x - npc.x;
  const dy = player.y - npc.y;
  const distSq = dx * dx + dy * dy;

  // Дистанция обнаружения игрока: от 2 до 12 клеток
  if (distSq > 144 || distSq < 4) return 0;

  // Базовый вес гоп-стопа в зависимости от близости к игроку
  const dist = Math.sqrt(distSq);
  const proximityBonus = (12 - dist) / 10;
  const armedBonus = npc.isArmed ? 0.25 : 0;

  return Math.min(1.0, 0.5 + proximityBonus * 0.3 + armedBonus);
}

/**
 * Логика тактики 'mugging' (окружение и удержание игрока).
 *
 * 1. Плавное приближение к игроку на дистанцию 2-3 клетки.
 * 2. Формирование веера/окружения вокруг позиции игрока.
 */
export function updateMuggingTactics(npc: NpcMuggingEntity, state: GameState, _delta: number): void {
  if (!npc) return;

  const player = (state as any).player;
  if (!player) return;

  const dx = player.x - npc.x;
  const dy = player.y - npc.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Оптимальная дистанция гоп-стопа: 2-3 клетки
  if (dist > 3) {
    // Движение к игроку
    npc.targetX = player.x - Math.sign(dx);
    npc.targetY = player.y - Math.sign(dy);
  } else if (dist < 2) {
    // Отступ при слишком близком контакте
    npc.targetX = npc.x - Math.sign(dx);
    npc.targetY = npc.y - Math.sign(dy);
  } else {
    // Удержание позиции на идеальной дистанции 2-3 клетки
    npc.targetX = npc.x;
    npc.targetY = npc.y;
  }
}
