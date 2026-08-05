[AGENTS.md](rule;file:///Users/jirnyak/Mirror/gigahrush/AGENTS.md) [README.md](file;file:///Users/jirnyak/Mirror/gigahrush/README.md)

халтурно расписан план он короткий
надо сделать план длиннее минимум 100 строк (можно больше)

и по сути будут работать jules для них надо создать заглушки если надо ts (уже частично могут быть)

улучши (дополни а не перписывай) @marx_# План Агента: marx_8
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №8.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Туториал: Простейший крафт в квартире (вместо завода).**

### Контекст задачи
В оригинальном дизайне игрок должен был идти на завод, чтобы освоить крафт. Так как туториал теперь полностью изолирован в стартовой квартире, скрипт завода заменяется на обучение базовому ручному крафту прямо в начальной зоне. Игрок должен создать простейший предмет (например, отмычку, бинт или простейший инструмент) из подручных материалов (например, металлолома или тряпок), которые он найдет рядом с верстаком в квартире. Это действие выступает триггером для перехода к следующей фазе обучения (Самосбор).

### Конкретные файлы и паттерны
- **`src/data/items.ts`**: Определение предметов и базовых рецептов (если рецепты лежат там или в `src/data/recipes.ts` / `src/data/economics.ts`).
- **`src/gen/design_floors/tutorial_apartment.ts`** (или эквивалент генерации начальной квартиры): Спавн станка (workbench) и ресурсов для крафта.
- **`src/systems/tutorial.ts`**: Обработка шага `CRAFT`. Слушатель на событие `'craft_complete'` → запуск сирены Самосбора → переход к шагу `SAMOSBOR`.
- **`src/systems/interactions.ts`** (опционально): Логика взаимодействия со станком, если требуется кастомная логика, хотя лучше использовать единую систему крафта (см. задачу marx_49).

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования и технические заглушки (stubs) для реализации:

#### 1. Слой Данных (Data Layer)
Необходимо убедиться, что базовые предметы для крафта (ресурсы) и сам рецепт существуют в `src/data/`. Если их нет, добавьте их. Предмет не должен ломать баланс и должен быть применим только в рамках базовой экономики или туториала.

```typescript
// Пример: src/data/items.ts
export const ITEM_JUNK_METAL = 'junk_metal';
export const ITEM_LOCKPICK = 'lockpick';

// Убедитесь, что рецепт прописан в реестре крафта:
// src/data/recipes.ts или src/data/economics.ts
export interface CraftingRecipe {
  id: string;
  resultItemId: string;
  requiredItems: { itemId: string; count: number }[];
  workAmount: number;
}

export const TUTORIAL_RECIPE: CraftingRecipe = {
  id: 'recipe_tutorial_lockpick',
  resultItemId: ITEM_LOCKPICK,
  requiredItems: [
    { itemId: ITEM_JUNK_METAL, count: 2 }
  ],
  workAmount: 5 // Быстрый крафт для туториала
};
```

#### 2. Слой Генерации (Gen Layer)
При генерации начальной квартиры туториала необходимо гарантированно заспавнить станок и материалы.
Материалы можно разбросать рядом на полу, либо положить в начальный ящик (контейнер).

```typescript
// Пример: src/gen/tutorial_floor.ts (или аналогичный модуль генерации)
import { ITEM_JUNK_METAL } from '../data/items';
import { spawnItem } from '../systems/inventory'; // или соответствующая функция спавна

export function placeCraftingTutorialProps(world: World, startRoom: Room) {
  // Найти подходящую стену в стартовой комнате для установки станка
  const workbenchPos = findWallForWorkbench(world, startRoom);
  
  // Установить fixture: Станок
  addFixture(world, workbenchPos.x, workbenchPos.y, 'workbench_basic');

  // Заспавнить материалы (например, 2 куска металлолома) рядом
  const dropPos1 = getFreeNeighbor(world, workbenchPos);
  const dropPos2 = getFreeNeighbor(world, dropPos1);
  spawnItem(world, ITEM_JUNK_METAL, dropPos1.x, dropPos1.y);
  spawnItem(world, ITEM_JUNK_METAL, dropPos2.x, dropPos2.y);
}
```

#### 3. Слой Систем (Systems Layer)
Состояние туториала должно отслеживать выполнение крафта. В `src/systems/tutorial.ts` должен быть обработчик, который ждет события успешного крафта. Как только крафт совершен, нужно инициировать Самосбор.

```typescript
// Пример: src/systems/tutorial.ts
import { TutorialStep, setTutorialStep } from '../core/state';
import { subscribeEvent, publishEvent } from './events';

export function initTutorialCraftingSystem() {
  subscribeEvent('craft_complete', (event) => {
    // Проверяем, что игрок сейчас на этапе обучения крафту
    if (world.tutorialStep === TutorialStep.CRAFT) {
      // Игрок скрафтил предмет! 
      // 1. Похвалить или выдать сообщение
      publishEvent({
        type: 'log_message',
        text: 'Вы собрали отмычку. Руки помнят.',
        color: 'green'
      });

      // 2. Сменить этап туториала
      setTutorialStep(TutorialStep.SAMOSBOR);

      // 3. Запустить сирену Самосбора (переход к следующей фазе)
      publishEvent({
        type: 'samosbor_start_warning',
        force: true // Принудительный старт для туториала
      });
    }
  });
}
```

#### 4. Взаимодействие со станком
Если общая система станков (workbench) еще не до конца реализована (задача marx_49), создайте базовый fallback:
Взаимодействие со станком (`E`) в туториале должно просто проверять инвентарь на наличие `junk_metal` и выдавать `lockpick`, публикуя `'craft_complete'`.

```typescript
// Пример: src/systems/interactions.ts (обработчик взаимодействия)
import { removeItem, addItem, hasItem } from './inventory';

export function handleWorkbenchInteraction(entity: Entity) {
  if (world.tutorialStep === TutorialStep.CRAFT) {
    if (hasItem(world.player, ITEM_JUNK_METAL, 2)) {
      removeItem(world.player, ITEM_JUNK_METAL, 2);
      addItem(world.player, ITEM_LOCKPICK, 1);
      publishEvent({ type: 'craft_complete', itemId: ITEM_LOCKPICK });
    } else {
      publishEvent({
        type: 'log_message',
        text: 'Не хватает материалов. Найдите металлолом рядом со станком.',
        color: 'yellow'
      });
    }
  } else {
    // Обычная логика станка
    openCraftingUI();
  }
}
```

### Пошаговый План Выполнения (Action Plan)
1. **Анализ файлов**: Открыть `src/systems/tutorial.ts`, `src/data/items.ts`, `src/gen/` (файл квартиры туториала) и `src/systems/interactions.ts`. Проанализировать текущую реализацию крафта и инвентаря.
2. **Определение ресурсов**: Добавить рецепт и нужные айтемы в Data-слой, если они отсутствуют. Убедиться в наличии спрайтов/иконок (или назначить дефолтные).
3. **Генерация объектов**: Обновить логику генератора начальной квартиры: заспавнить станок и материалы (металлолом, ткань или детали). Обеспечить 100% гарантию доступности компонентов.
4. **Машина состояний туториала**: Добавить в `tutorial.ts` (или `core/state.ts` если это там) новый шаг `CRAFT` и слушатель на событие `'craft_complete'`.
5. **Триггер Самосбора**: Связать успешный крафт в туториале с немедленным запуском фазы Самосбора через системные события (`publishEvent({ type: 'samosbor_start_warning' })`).
6. **Валидация типов**: Запустить `npm run typecheck`, чтобы убедиться, что типы событий и предметы соответствуют архитектуре.
7. **Smoke-тестирование**: Если возможно, убедиться локально или мысленно пройти пайплайн, что при взаимодействии (кнопка `E`) логика отрабатывает без падений (также используйте `npm run check:readonly`).
8. **Финальный коммит**: Оформить код в соответствии с `commit.md` и запушить изменения/создать PR.

---
*Ожидается, что вы завершите задачу, написав код без хардкода, полностью совместимый с 5-слойной архитектурой, и оставите проект в компилируемом состоянии. Все заглушки выше даны для примера — вы обязаны адаптировать их под актуальное состояние GIGAHRUSH.*
