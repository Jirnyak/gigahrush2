# План Агента: marx_24
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №24.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Геометрия: Исправление потолков (Коллекторы/Мин-во). Потолочные меши не должны наслаиваться или быть выше логики.**

### Контекст задачи
Потолки на некоторых этажах (Коллекторы, Министерство) слишком высокие, и потолочные меши/лампы наслаиваются. Это вызывает Z-fighting и ломает визуальное восприятие (лампы висят глубоко в потолке или ниже других текстур).

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`**: Рендерер рисует потолок. Изучите, как `Room.ceilingTier` влияет на высоту.
- **`src/render/` mesh pass**: Файлы `mesh.md` описывают систему декоративных коридорных покрытий. Потолочные элементы — часть mesh pass.
- **Проблема**: Если `ceilingTier` высокий, а лампа фиксированной высоты — она «висит в воздухе».
- **`src/gen/maintenance/index.ts`**: Коллекторы могут задавать `ceilingTier` для комнат. Убедитесь, что значения разумные (1-2, не 3+).
- **Генераторы Министерства**: `src/gen/ministry/index.ts` — тоже проверьте.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Gen (Ограничение Tier'ов) - `src/gen/maintenance/index.ts`
Установите жесткие лимиты на высоту потолков при генерации. В Гигахруще потолки высокие, но они не бесконечны. Не допускайте неадекватных `ceilingTier`.
```typescript
// Stub for ceiling tier limits
export function setupMaintenanceRooms(world: World) {
  for (const room of world.rooms) {
    // Limit ceiling tier to max 2 to prevent mesh overlapping and Z-fighting
    if (room.type === RoomType.INDUSTRIAL || room.type === RoomType.PUMP_STATION) {
      room.ceilingTier = 2; // High industrial ceiling, but strictly capped
    } else {
      room.ceilingTier = 1; // Standard corridor/room ceiling
    }
  }
}
```

#### 2. Слой Render (Рендеринг потолков) - `src/render/webgl.ts`
При отрисовке мешей потолка необходимо учитывать `ceilingTier`, сдвигая элементы (вентиляционные трубы, провода, балки) на корректную базовую высоту.
```typescript
// Stub for ceiling mesh rendering logic
function renderCeilingMeshes(gl: WebGLRenderingContext, world: World, camera: Camera) {
  for (const room of world.rooms) {
    // Calculate the actual Y coordinate of the ceiling
    const baseCeilingY = getCeilingHeightForTier(room.ceilingTier);
    
    for (const mesh of room.ceilingMeshes) {
      // Offset mesh Y coordinate based on base ceiling height
      // Drop distance is how far below the ceiling the mesh hangs
      const yOffset = baseCeilingY - mesh.localDropDistance;
      
      // Draw mesh at the calculated dynamic Y offset
      drawMesh(gl, mesh.texture, mesh.x, yOffset, mesh.z);
    }
  }
}

// Global utility for translating tiers to Y-coords
export function getCeilingHeightForTier(tier: number): number {
  const BASE_HEIGHT = 2.0;
  const TIER_STEP = 1.5;
  // Cap tier just in case generators pass bad data
  return BASE_HEIGHT + Math.min(tier, 2) * TIER_STEP; 
}
```

#### 3. Слой Data (Валидация геометрии) - `src/gen/shared.ts`
Добавьте санитарную проверку в систему контента, чтобы ни один генератор случайно не сломал рендер.
```typescript
// Stub for room sanity check post-generation
export function validateFloorGeometry(world: World) {
  for (const room of world.rooms) {
    if (room.ceilingTier > 2) {
      console.warn(\`[Sanity] Room \${room.id} has invalid ceilingTier \${room.ceilingTier}. Capping to 2.\`);
      room.ceilingTier = 2;
    }
    if (room.ceilingTier < 0) {
      room.ceilingTier = 0;
    }
  }
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Изучите `src/render/webgl.ts` (поиск рендеринга `ceilingMeshes` и Raycaster логики). Изучите файлы генераторов (`maintenance`, `ministry`).
2. **Проектирование:** Унифицируйте расчет высоты потолка через единую функцию `getCeilingHeightForTier()`, чтобы рендер и генерация не расходились в математике.
3. **Реализация Gen-слоя:** Проверьте `src/gen/maintenance/index.ts` и `ministry/index.ts`. Ограничьте `ceilingTier` значением `2` или `1`. 
4. **Реализация Валидации:** Добавьте `validateFloorGeometry()` в основной пайплайн генерации `procedural_floor.ts` как финальный шаг.
5. **Реализация Render-слоя:** Измените цикл отрисовки в `webgl.ts`. Теперь Y-координата мешей должна опираться на динамический `baseCeilingY`, а не быть хардкодом.
6. **Тестирование визуальное:** Обязательно запустите `npm run check:browser` или `npm run dev` и пройдитесь по этажу Коллекторов. Убедитесь, что лампы не парят в пустоте и текстуры потолка не наслаиваются.
7. **Проверка типов:** Выполните `npm run typecheck`.
8. **Юнит-тесты:** Напишите небольшой тест для `getCeilingHeightForTier()`, гарантирующий, что возвращаемое значение не превышает допустимых лимитов.
9. **Рефакторинг:** Удалите старые хардкодные смещения по Y, которые разработчики оставили как костыли.
10. **Коммит:** Закоммитьте с указанием `fix(render): ceiling mesh vertical overlapping`.
11. **Pull Request:** Запушьте код и откройте PR. 
12. **Документация:** Опишите стандарт высоты потолков (BASE_HEIGHT и TIER_STEP) в комментариях PR для будущих агентов.

---
*Ожидается, что вы завершите задачу, полностью устранив графические артефакты геометрии потолков, и оставите проект в компилируемом состоянии.*
