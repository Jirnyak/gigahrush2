export type ComputerDefId = 'floor_archive' | 'dispatch_terminal';

export interface ComputerPageDef {
  title: string;
  lines: readonly string[];
}

export interface ComputerDef {
  id: ComputerDefId;
  label: string;
  prompt: string;
  pages: readonly ComputerPageDef[];
  stealRewardRubles: number;
  stealLabel: string;
  recipeSourceIds?: readonly string[];
}

export const COMPUTER_DEFS: Record<ComputerDefId, ComputerDef> = {
  floor_archive: {
    id: 'floor_archive',
    label: 'Локальный архив',
    prompt: 'архив',
    stealRewardRubles: 45,
    stealLabel: 'архивная выгрузка',
    recipeSourceIds: ['terminal_floor_archive_scrap_schemes'],
    pages: [
      {
        title: 'Журнал этажа',
        lines: [
          'Записи неполные: часть комнат меняла владельцев после сирены.',
          'Маршруты, слухи и контейнеры сверяются по локальной памяти.',
        ],
      },
      {
        title: 'Предупреждение',
        lines: [
          'Копирование оставляет след в журнале доступа.',
          'След можно продать, но источник станет заметнее.',
          'Схемы в выгрузке локальные: НЕТ не требуется.',
        ],
      },
    ],
  },
  dispatch_terminal: {
    id: 'dispatch_terminal',
    label: 'Диспетчерский компьютер',
    prompt: 'компьютер',
    stealRewardRubles: 30,
    stealLabel: 'диспетчерский слепок',
    recipeSourceIds: ['terminal_dispatch_net_relay'],
    pages: [
      {
        title: 'Сменная сводка',
        lines: [
          'Диспетчер держал список дверей, лифтов и жалоб до последней пересменки.',
          'В строках есть полезные обрывки, но половина подписей намеренно стерта.',
        ],
      },
      {
        title: 'Локальный факт',
        lines: [
          'Если этаж шумит, не верьте карте без второго источника.',
          'Веди заметки: после Самосбора сверишь дверь, список жильцов и маршрут назад.',
          'Релейную схему копируй в блокнот, а не в облако.',
        ],
      },
    ],
  },
};

export function getComputerDef(id: string): ComputerDef | undefined {
  return COMPUTER_DEFS[id as ComputerDefId];
}
