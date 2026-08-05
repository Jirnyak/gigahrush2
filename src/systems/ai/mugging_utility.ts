import { type GameState } from '../../core/types';

/**
 * ЗАГЛУШКА ДЛЯ СОБЫТИЯ "ГОП-СТОП" (jules agent task)
 *
 * Эта функция должна оценивать, насколько актуален intent 'mugging' для данного NPC.
 *
 * Требования:
 * 1. Проверить фракцию (WILD).
 * 2. Проверить дистанцию до игрока (используйте broadphase/entity_index).
 * 3. Проверить отношение игрока (playerRelation < 0).
 * 4. Убедиться, что группа состоит из >= 3 вооруженных NPC.
 * 5. Проверить cooldown события.
 *
 * Если все условия соблюдены, возвращаем высокий score. Иначе 0.
 */
export function scoreMuggingIntent(_npc: any, _state: GameState, _player: any): number {
  // TODO: jules, реализуй логику оценки здесь
  return 0;
}

/**
 * ЗАГЛУШКА: Логика тактики 'mugging'.
 *
 * Требования:
 * 1. Движение к игроку до дистанции в 2-3 клетки.
 * 2. Остановка и поддержание полукольца (чтобы не блокировать друг друга).
 * 3. Ожидание реакции игрока (оплаты или отказа).
 */
export function updateMuggingTactics(_npc: any, _state: GameState, _delta: number): void {
  // TODO: jules, реализуй логику тактики (передвижения) здесь
}
