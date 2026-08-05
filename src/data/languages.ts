export type TitleLanguageId = 'ru' | 'en';
export type TitleFlagKind = 'soviet' | 'british_empire';

export interface TitleLanguageDef {
  id: TitleLanguageId;
  code: string;
  name: string;
  title: string;
  subtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  ageLabel: string;
  sexLabel: string;
  sexMaleLabel: string;
  sexFemaleLabel: string;
  seedLabel: string;
  seedPlaceholder: string;
  startPrompt: string;
  setupTitle: string;
  setupSubtitle: string;
  setupStartLabel: string;
  setupStartValue: string;
  setupStartHint: string;
  setupContinueLabel: string;
  setupContinueValue: string;
  setupContinueHint: string;
  setupAddNpcLabel: string;
  setupAddNpcValue: string;
  setupLanguageLabel: string;
  setupActorCapLabel: string;
  setupAddNpcHint: string;
  setupNameHint: string;
  setupAgeHint: string;
  setupSexHint: string;
  setupSeedHint: string;
  setupLanguageHint: string;
  setupActorCapHint: string;
  setupControlHint: string;
  actorCapValue: (value: number, min: number, max: number) => string;
  languageHint: string;
  mobileHint: string;
  desktopHint: (move: string, interact: string) => string;
  desktopCombatHint: (attack: string, fullscreen: string, controls: string, ui: string) => string;
  pointerGateTitle: string;
  pointerGateSubtitle: string;
  pointerGateWarning1: string;
  pointerGateWarning2: string;
  pointerGateControls1: string;
  pointerGateControls2: string;
  pointerGateResume: string;
  pointerLockPrompt: string;
  pointerLockControls1: (menu: string) => string;
  pointerLockControls2: (back: string, interact: string) => string;
  flag: TitleFlagKind;
}

export const TITLE_LANGUAGES: readonly TitleLanguageDef[] = [
  {
    id: 'ru',
    code: 'RU',
    name: 'Русский',
    title: 'ГИГАХРУЩ',
    subtitle: 'бесконечный бетонный лабиринт',
    nameLabel: 'НЕТ-ИМЯ',
    namePlaceholder: 'введите имя',
    ageLabel: 'ВОЗРАСТ',
    sexLabel: 'ПОЛ',
    sexMaleLabel: 'мужской',
    sexFemaleLabel: 'женский',
    seedLabel: 'СИД',
    seedPlaceholder: 'пусто = случайный',
    startPrompt: 'Выберите язык и нажмите ENTER',
    setupTitle: 'НАСТРОЙКА ЗАБЕГА',
    setupSubtitle: 'меню запуска',
    setupStartLabel: 'СТАРТ',
    setupStartValue: 'новая игра',
    setupStartHint: 'ENTER запускает выбранный забег',
    setupContinueLabel: 'ПРОДОЛЖИТЬ',
    setupContinueValue: 'последнее сохранение',
    setupContinueHint: 'ENTER загружает сохраненную игру',
    setupAddNpcLabel: 'ДОБАВИТЬ ПЕРСОНАЖА',
    setupAddNpcValue: 'анкета NPC',
    setupLanguageLabel: 'ЯЗЫК',
    setupActorCapLabel: 'ЛИМИТ NPC/МОБОВ',
    setupAddNpcHint: 'открывает отдельную страницу формы без захвата курсора',
    setupNameHint: 'текст вводится прямо с клавиатуры',
    setupAgeHint: '1-100; влияет на соц. контекст персонажа',
    setupSexHint: '←/→ переключить',
    setupSeedHint: 'пусто оставит случайный маршрутный сид',
    setupLanguageHint: '←/→ переключить язык',
    setupActorCapHint: '←/→ шаг 1024',
    setupControlHint: '↑/↓ выбор  |  ←/→ изменить  |  ENTER действие  |  текст в выбранном поле',
    actorCapValue: (value, min, max) => `${value} (${min}-${max})`,
    languageHint: '←/→ язык  |  ENTER далее',
    mobileHint: 'Тап — далее  |  ДЕЙСТ — действие  |  КАРТ/ЗАД/UI — рельса',
    desktopHint: (move, interact) => `Клик захватывает курсор перед стартом  |  ${move} — движение  |  ${interact} — действие`,
    desktopCombatHint: (attack, fullscreen, controls, ui) => `ЛКМ/${attack} — атака  |  ${fullscreen} — полный экран  |  ${controls} — клавиши  |  ${ui} — интерфейс`,
    pointerGateTitle: 'КЛИКНИТЕ ПО ЭКРАНУ',
    pointerGateSubtitle: 'ДЛЯ ЗАХВАТА КУРСОРА',
    pointerGateWarning1: 'Данная игра является шутером от первого лица',
    pointerGateWarning2: 'и не использует мышку.',
    pointerGateControls1: 'Enter: меню / принять. ПКМ: назад.',
    pointerGateControls2: 'ЛКМ: атака. ПКМ: инструмент. E: мир.',
    pointerGateResume: 'После клика игра продолжится.',
    pointerLockPrompt: 'Кликните по игре: мышь будет захвачена для обзора',
    pointerLockControls1: (menu) => `После захвата ЛКМ стреляет. ПКМ использует инструмент. ${menu} меню/принять.`,
    pointerLockControls2: (back, interact) => `${back} назад/закрыть. ${interact} действует в мире. Esc отпускает курсор браузером.`,
    flag: 'soviet',
  },
  {
    id: 'en',
    code: 'ENG',
    name: 'English',
    title: 'GIGAHRUSH',
    subtitle: 'endless concrete labyrinth',
    nameLabel: 'NET-NAME',
    namePlaceholder: 'enter name',
    ageLabel: 'AGE',
    sexLabel: 'SEX',
    sexMaleLabel: 'male',
    sexFemaleLabel: 'female',
    seedLabel: 'SEED',
    seedPlaceholder: 'blank = random',
    startPrompt: 'Choose language and press ENTER',
    setupTitle: 'RUN SETUP',
    setupSubtitle: 'launch menu',
    setupStartLabel: 'START',
    setupStartValue: 'new game',
    setupStartHint: 'ENTER starts the configured run',
    setupContinueLabel: 'CONTINUE',
    setupContinueValue: 'latest save',
    setupContinueHint: 'ENTER loads the saved game',
    setupAddNpcLabel: 'ADD CHARACTER',
    setupAddNpcValue: 'NPC form',
    setupLanguageLabel: 'LANGUAGE',
    setupActorCapLabel: 'NPC/MOB LIMIT',
    setupAddNpcHint: 'opens the standalone questionnaire page without cursor capture',
    setupNameHint: 'type directly while this row is selected',
    setupAgeHint: '1-100; affects social context',
    setupSexHint: '←/→ switch',
    setupSeedHint: 'blank keeps a random route seed',
    setupLanguageHint: '←/→ switch language',
    setupActorCapHint: '←/→ step 1024',
    setupControlHint: '↑/↓ select  |  ←/→ change  |  ENTER action  |  type in selected field',
    actorCapValue: (value, min, max) => `${value} (${min}-${max})`,
    languageHint: '←/→ language  |  ENTER next',
    mobileHint: 'Tap — next  |  ACT — interact  |  MAP/QUEST/UI — rail',
    desktopHint: (move, interact) => `Click captures cursor before start  |  ${move} — move  |  ${interact} — action`,
    desktopCombatHint: (attack, fullscreen, controls, ui) => `LMB/${attack} — attack  |  ${fullscreen} — fullscreen  |  ${controls} — keys  |  ${ui} — interface`,
    pointerGateTitle: 'CLICK THE SCREEN',
    pointerGateSubtitle: 'TO CAPTURE THE CURSOR',
    pointerGateWarning1: 'This game is a first-person shooter',
    pointerGateWarning2: 'and does not use the mouse cursor.',
    pointerGateControls1: 'Enter: menu / accept. RMB: back.',
    pointerGateControls2: 'LMB: attack. RMB: tool. E: world.',
    pointerGateResume: 'Game resumes after click.',
    pointerLockPrompt: 'Click on the game: mouse will be captured for aiming',
    pointerLockControls1: (menu) => `After capture LMB attacks. RMB uses tool. ${menu} menu/accept.`,
    pointerLockControls2: (back, interact) => `${back} back/close. ${interact} interacts in the world. Esc releases cursor to browser.`,
    flag: 'british_empire',
  },
];

export function normalizeTitleLanguageId(value: unknown): TitleLanguageId {
  return TITLE_LANGUAGES.some(def => def.id === value) ? value as TitleLanguageId : 'ru';
}

export function titleLanguageDef(id: TitleLanguageId): TitleLanguageDef {
  return TITLE_LANGUAGES.find(def => def.id === id) ?? TITLE_LANGUAGES[0];
}

export function nextTitleLanguageId(id: TitleLanguageId, dir: number): TitleLanguageId {
  const current = TITLE_LANGUAGES.findIndex(def => def.id === id);
  const start = current >= 0 ? current : 0;
  const next = (start + TITLE_LANGUAGES.length + Math.sign(dir || 1)) % TITLE_LANGUAGES.length;
  return TITLE_LANGUAGES[next].id;
}
