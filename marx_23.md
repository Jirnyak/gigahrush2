# План Агента: marx_23
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №23.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Генератор: Рефакторинг Плотности. Исправление проблемы сплошных стен (много пустых зон) — делать комнат больше.**

### Контекст задачи
Генератор этажей создаёт слишком много пустых зон (сплошные стены без комнат). Из-за этого уровни кажутся пустыми, а коридоры — неестественно длинными. Нужно гарантировать высокую плотность застройки Гигахруща.

### Конкретные файлы и паттерны
- **`src/gen/procedural_floor.ts`**: Основной процедурный генератор. Изучите алгоритм создания комнат (room graph stamping).
- **Проблема**: Длинные коридоры без боковых комнат, большие прямоугольники сплошных стен. Посмотрите floor maps в `tmp/floor-maps/all_route_seed_61061/` — если на карте много чёрного (стены) — плохо.
- **Решение**: После основной генерации запустите проход «заполнитель пустот»: найдите прямоугольные блоки стен >8x8 клеток и вставьте туда дополнительную комнату или короткий коридор.
- **`src/gen/shared.ts`**: Утилиты генерации: `stampRoom()`, `carveRoomCells()`. Используйте их.
- **Проверка**: `npm run test:generation` — расширенная матрица генерации должна пройти.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Gen (Алгоритм поиска пустот) - `src/gen/procedural_floor.ts`
После основной фазы расстановки комнат и коридоров, необходимо просканировать двумерную сетку. Используйте скользящее окно (sliding window) или рекурсивный subdivision для нахождения сплошных блоков стен.
```typescript
// Stub for density refactoring
export function fillEmptySpaces(world: World) {
  const minBlockSize = 8;
  const padding = 1;
  
  // Iterate over world chunks
  for (let y = padding; y < world.height - minBlockSize; y += 4) {
    for (let x = padding; x < world.width - minBlockSize; x += 4) {
      if (isSolidWallBlock(world, x, y, minBlockSize, minBlockSize)) {
        // Found a large solid block! Carve a new room.
        const w = randRange(4, minBlockSize - 2);
        const h = randRange(4, minBlockSize - 2);
        const newRoom = createRoom(x + 1, y + 1, w, h);
        newRoom.type = RoomType.UTILITY; // Mark as filler
        
        stampRoom(world, newRoom);
        connectToNearestCorridor(world, newRoom);
      }
    }
  }
}

function isSolidWallBlock(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (world.cells[getCellIdx(x + i, y + j)].type !== CellType.WALL) {
        return false;
      }
    }
  }
  return true;
}
```

#### 2. Слой Gen (Связывание) - `src/gen/shared.ts`
Новая комната абсолютно бесполезна, если в неё нет входа. Убедитесь, что новые «заполняющие» комнаты корректно соединяются с ближайшим коридором или соседней комнатой.
```typescript
// Stub for connecting filler rooms
export function connectToNearestCorridor(world: World, room: Room) {
  const nearestFloorCell = findNearestFloorCell(world, room.center);
  if (nearestFloorCell) {
    // Carve a straight 1-tile wide path from room edge to corridor
    carveCorridor(world, room.center, nearestFloorCell);
    // Add a door at the room boundary
    const boundaryCell = getRoomBoundaryCell(room, nearestFloorCell);
    placeDoor(world, boundaryCell);
  } else {
    // If no nearby corridor, discard the room or dig a long tunnel
  }
}
```

#### 3. Слой Валидации (Тесты) - `tests/generation.test.ts`
Алгоритм должен быть быстрым и не приводить к бесконечным циклам. Напишите тест на плотность этажа.
```typescript
// Stub for tests/generation.test.ts
import { generateFloor, calculateDensity } from '../src/gen/procedural_floor';

test('Floor density should be greater than 40% after refactoring', () => {
  const world = generateFloor('test_seed_123');
  const floorRatio = calculateDensity(world);
  // Expect at least 40% of the map to be walkable
  expect(floorRatio).toBeGreaterThan(0.40);
  
  // Expect no massive blocks larger than 12x12
  const hasMassiveBlock = checkMassiveBlocks(world, 12, 12);
  expect(hasMassiveBlock).toBeFalsy();
});
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Изучите функцию `stampRoom` и структуру данных `world.cells` в `shared.ts`.
2. **Проектирование алгоритма:** Решите, будете ли вы сканировать сетку линейно или использовать BSP (Binary Space Partitioning) для нахождения пустот. Линейное сканирование проще, BSP — эффективнее.
3. **Реализация Gen-слоя:** Напишите функцию `fillEmptySpaces()` и интегрируйте её в конец `procedural_floor.ts` перед спавном лута и мобов.
4. **Интеграция:** Обновите утилиты соединения `connectToNearestCorridor()`. Обязательно добавьте двери, чтобы логика A-Life не ломалась от открытых коридоров.
5. **Валидация производительности:** Убедитесь, что `fillEmptySpaces()` работает за O(W*H) или быстрее. Долгая генерация недопустима (лимит ~50мс на мобильном устройстве).
6. **Оценка визуального результата:** Выведите карту в `tmp/floor-maps/` и убедитесь визуально, что огромные черные блоки исчезли.
7. **Написание тестов:** Обновите `test:generation` для проверки метрики плотности.
8. **Проверка типов:** Выполните `npm run typecheck`.
9. **Запуск тестов:** Выполните `npm run test:generation` и `npm run test:unit`.
10. **Коммит:** Закоммитьте код с описанием алгоритма повышения плотности.
11. **Pull Request:** Запушьте код и откройте PR. Прикрепите ASCII-рендеринг или скриншот до/после плотности.
12. **Документация:** Кратко опишите в PR, почему выбран именно этот алгоритм поиска пустот.

---
*Ожидается, что вы завершите задачу, значительно улучшив левел-дизайн процедурных этажей, и оставите проект в компилируемом состоянии.*
