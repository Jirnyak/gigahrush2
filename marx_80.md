# План Агента: marx_80
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №80.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Убрать заполнение стен для крыши**

### Контекст задачи
В генераторе этажей существует система визуального заполнения пустот стен до потолка. Эта система работает отлично для большинства уровней, но на этаже "Крыша" (roof) она создает визуальный артефакт в виде "бетонного купола", так как крыша должна символизировать открытое небо (или пустоту мегаструктуры).
Необходимо отключить заполнение потолков специфично для крыши, сохранив алгоритм для остальных этажей.

### Конкретные файлы и паттерны
- **`src/gen/visual_cell_slots.ts`**
- **`src/gen/design_floors/roof.ts`**
- **`src/core/world.ts`** (опционально, флаги этажа)

## Подробный Workflow реализации

### Шаг 1. Анализ текущей системы заполнения стен
1. Изучите `src/gen/visual_cell_slots.ts` (или аналогичный файл, отвечающий за экструзию геометрии до потолка).
2. Найдите функцию, которая отвечает за генерацию `roofMask` или `wallTopMask`.
3. Поймите, как передаются параметры уровня (например, `world.floorId` или `world.env.isRoofOpen`).

### Шаг 2. Расширение структуры `World` или параметров этажа
1. В `src/core/types.ts` или `src/core/world.ts` проверьте наличие свойства, описывающего открытое небо (например, `hasOpenSky: boolean` в параметрах этажа или `env`).
2. Если такого свойства нет, добавьте его в метаданные этажа (на уровне `FloorDef` в `src/data/`).

```typescript
// Stub: src/data/design_floors.ts
export interface FloorDef {
    id: string;
    // ...
    hasOpenSky?: boolean; // New flag to prevent ceiling fill
}
```

### Шаг 3. Модификация `roof.ts`
1. Откройте `src/gen/design_floors/roof.ts`.
2. В функции инициализации или регистрации этажа `Roof`, убедитесь, что флаг `hasOpenSky` устанавливается в `true`.

```typescript
// Stub: src/gen/design_floors/roof.ts
export function generateRoofFloor(world: World): void {
    world.env.hasOpenSky = true;
    // ... rest of roof generation ...
}
```

### Шаг 4. Обновление визуального слотирования стен
1. Откройте `src/gen/visual_cell_slots.ts` (или `webgl.ts`, в зависимости от того, где происходит билд вокселей).
2. Оберните логику экструзии потолочных блоков в условие, проверяющее флаг `hasOpenSky`.

```typescript
// Stub: src/gen/visual_cell_slots.ts
export function processWallExtrusion(world: World) {
    if (world.env.hasOpenSky) {
        // Skip extruding walls to ceiling height for open-sky floors
        return;
    }
    
    // Existing extrusion logic...
    for (let i = 0; i < world.size; i++) {
        // ... fill to ceiling ...
    }
}
```

### Шаг 5. Обработка скайбокса (Render Layer)
1. Убедитесь, что рендерер правильно реагирует на отсутствие потолочных блоков.
2. В `src/render/webgl.ts` или `src/render/skybox.ts` при наличии `hasOpenSky` должен рендериться скайбокс или специфичный туман, а не просто черная пустота (зависит от текущей реализации).

### Шаг 6. Написание тестов
1. Создайте тест `tests/gen-roof-sky.test.ts`.
2. Замокайте генерацию этажа-крыши.
3. Проверьте, что количество блоков на высоте `z > wallHeight` равно нулю (или значительно меньше, чем на обычном этаже).

```typescript
// Stub: tests/gen-roof-sky.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
import { World } from '../src/core/world';
import { generateRoofFloor } from '../src/gen/design_floors/roof';
import { processWallExtrusion } from '../src/gen/visual_cell_slots';

test('Roof floor does not generate ceiling wall extensions', () => {
    const world = new World();
    generateRoofFloor(world);
    processWallExtrusion(world);
    
    // Assert that high-Z slots are empty
    // assert(world.getHighZSlots().length === 0);
});
```

### Шаг 7. Валидация и проверка производительности
1. Запустите `npm run typecheck`.
2. Запустите `npm run test:unit`.
3. Запустите `npm run check:full`.
4. Визуально проверьте крышу: не должно быть лагов при рендере "пустоты", и стены должны заканчиваться на логичной высоте.

### Шаг 8. Оформление PR
1. Убедитесь, что нет лишних изменений в других этажах.
2. Убедитесь, что для подземелий экструзия по-прежнему работает.
3. Создайте коммит с четким описанием: `fix(gen): disable wall-to-ceiling extrusion on open-sky floors like Roof`.
4. Оформите PR.
