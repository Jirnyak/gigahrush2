export const GAME_MENU_ITEMS = [
  { id: 'continue', label: 'Продолжить' },
  { id: 'new_game', label: 'Новая игра' },
  { id: 'save', label: 'Сохранить' },
  { id: 'load', label: 'Загрузить' },
  { id: 'sound', label: 'Звук: Вкл/Выкл' },
  { id: 'help', label: 'HELP / F1' },
  { id: 'demos', label: 'Инфосеть Демос' },
  { id: 'keys', label: 'Клавиши' },
  { id: 'interface', label: 'Интерфейс' },
  { id: 'graphics', label: 'Графика' },
  { id: 'feedback', label: 'Обратная связь' },
] as const;

export type GameMenuItemId = typeof GAME_MENU_ITEMS[number]['id'];
