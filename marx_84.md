# План Агента: marx_84
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №84.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Баг дебаг-телепорта в министерство**

### Контекст задачи
При дебаг-телепорте в Министерство (или другие спец-этажи) плохо рендерятся потолки (или другая геометрия). Если загрузиться потом через лифт (штатный геймплейный переход) — всё нормально.
Это означает, что `debug.ts` пропускает важные этапы инициализации геометрии, кэшей рендера или масок освещения, которые штатный `main.ts` или `floor_memory.ts` выполняют при смене этажа. Необходимо починить инициализацию при прямом ТП (телепорте).

### Конкретные файлы и паттерны
- **`src/systems/debug.ts`** (функции читов/тп)
- **`src/systems/floor_memory.ts`** (или переключение этажей)
- **`src/main.ts`** (флоу смены этажа)

## Подробный Workflow реализации

### Шаг 1. Сравнение флоу загрузки
1. Изучите функцию смены этажа в штатном режиме (например, `switchFloor()` или обработчик использования лифта).
2. Выпишите все вызываемые методы. Обычно это:
   - Сохранение/упаковка текущего этажа.
   - Загрузка/генерация нового этажа (`world` state).
   - Инвалидация кэшей (pathfinding, lighting, renderer).
   - Вызов хуков рендера (например, `webgl.initWorld(world)`, `rebuildCeilings()`).
3. Изучите функцию телепорта в `src/systems/debug.ts`. Найдите, чего не хватает.

### Шаг 2. Централизация смены этажа
1. Не дублируйте логику смены этажа в `debug.ts`. Это костыль.
2. Если в `debug.ts` сейчас жестко прописан `world = generateMinistry()`, перепишите это на вызов централизованной функции смены этажа, передавая целевой `floorId` или `Z`.

```typescript
// Stub: src/systems/floor_manager.ts (или внутри main.ts / world.ts)
export function transitionToFloor(world: World, targetZ: number, targetId?: string): void {
    // 1. Pack current floor
    // 2. Generate or unpack target floor
    // 3. Set player position
    // 4. INVALIDATE CACHES AND REBUILD GEOMETRY
    invalidateAllCaches(world);
}
```

### Шаг 3. Исправление геометрии (Потолки)
1. Конкретная проблема с потолками связана с `surfaceVersion`, `fogVersion` или `wallExtrusion`.
2. Убедитесь, что при телепорте инкрементируются нужные `dirty` флаги:
   ```typescript
   world.surfaceVersion++;
   world.cellVersion++;
   ```
3. Это заставит рендерер перестроить меши на следующем кадре.

### Шаг 4. Написание юнит/интеграционного теста
1. Создайте `tests/debug-teleport.test.ts`.
2. Замокайте рендерер или проверьте версии грязных данных (dirty flags).
3. Убедитесь, что после вызова `debugTeleport(world, 'ministry')` флаги геометрии инкрементированы.

```typescript
// Stub: tests/debug-teleport.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
import { executeCheat } from '../src/systems/debug_cheats';

test('Debug teleport to ministry triggers geometry rebuild flags', () => {
    const v1 = world.surfaceVersion;
    executeCheat('tp ministry');
    assert.ok(world.surfaceVersion > v1, 'Surface version must increment on TP to rebuild ceilings');
});
```

### Шаг 5. Валидация
1. `npm run check:readonly`.
2. `npm run check:full`.
3. Визуальная валидация в браузере: откройте консоль читов, пропишите ТП в министерство. Потолки должны быть на месте, меши не должны быть сломаны или черные.

### Шаг 6. Оформление PR
1. Проверьте отсутствие регрессий при штатном переходе через лифт.
2. Коммит: `fix(debug): ensure full geometry and render cache invalidation during debug teleports`.
3. Оформите PR, сославшись на решенную проблему с потолками.
