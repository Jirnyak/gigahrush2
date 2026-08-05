# План Агента: marx_82
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №82.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Пропасти вниз**

### Контекст задачи
Раз есть стены вверх, то нужно добавить пропасти вниз. Рендер и генерация провалов в полу (бесконечные или глубокие ямы). Игрок не может ходить по этим клеткам, а рендерер должен рисовать пустоту или уходящие вниз текстуры вместо плоского пола.

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`**
- **`src/core/world.ts`**
- **`src/gen/`** (процедурные генераторы, добавление маски пропасти)
- **`src/systems/pathfinding.ts`** (чтобы AI не ходил в ямы)

## Подробный Workflow реализации

### Шаг 1. Анализ структур данных пола
1. Изучите `src/core/world.ts`. Найдите, как сейчас хранится информация о поле (например, `world.floorTex`, `world.walkable`).
2. Добавьте флаг/текстурный ID, обозначающий пропасть (Abyss / Pit). Это может быть зарезервированный ID в `floorTex` (например, 0 или 255) или отдельный бит в `world.flags`.

```typescript
// Stub: src/core/types.ts
export const TILE_PIT = 255; // Special texture ID for a bottomless pit
export const FLAG_PIT = 1 << 5; // Alternative: a specific flag
```

### Шаг 2. Интеграция в генерацию
1. В процедурных генераторах (например, `src/gen/procedural_anomalies/` или `src/gen/design_floors/`) создайте участки пропастей.
2. При назначении пропасти клетке (idx):
   - Уберите бит `walkable` из маски коллизий.
   - Установите текстуру пола в `TILE_PIT`.

```typescript
// Stub: src/gen/anomalies_pits.ts
export function generatePits(world: World, count: number): void {
    for (let i = 0; i < count; i++) {
        const idx = world.getRandomCell();
        if (isSafeToCarvePit(world, idx)) {
            world.walkable[idx] = 0; // Impassable
            world.floorTex[idx] = TILE_PIT;
            // Optionally remove wall if it existed
            world.walls[idx] = 0;
        }
    }
}
```

### Шаг 3. Модификация WebGL рендерера
1. Откройте `src/render/webgl.ts`.
2. Найдите место, где генерируется меш пола (цикл по `world.size`).
3. Если текущая клетка — это яма, **пропустите** генерацию горизонтального квада пола.
4. **Важно:** Для клеток, соседствующих с ямой, сгенерируйте "вертикальные стенки вниз", чтобы создать эффект глубины.

```typescript
// Stub: src/render/webgl.ts (mesh generation loop)
if (floorTex[idx] === TILE_PIT) {
    // Render deep dark gradient walls on the adjacent non-pit cells
    renderPitWalls(idx, world);
    continue; // Do not render flat floor
}
```

### Шаг 4. Обработка ИИ и навигации
1. В `src/systems/pathfinding.ts` убедитесь, что клетка без бита `walkable` надежно блокирует путь для наземных существ.
2. Если есть летающие мобы, добавьте для них свойство "может летать над пропастью", игнорируя `walkable` если там `TILE_PIT`.

### Шаг 5. Взаимодействие (Падение)
1. Добавьте физическую проверку: если игрок каким-то образом оказался на клетке с `TILE_PIT` (толкнули, сломался мост), срабатывает триггер падения.
2. В `src/systems/physics.ts` или `movement.ts`:

```typescript
// Stub: src/systems/movement.ts
if (world.floorTex[player.idx] === TILE_PIT) {
    killPlayer(DeathReason.FALL);
}
```

### Шаг 6. Написание тестов
1. Создайте `tests/world-pits.test.ts`.
2. Убедитесь, что генерация ямы корректно снимает флаг проходимости.
3. Проверьте, что обычный ИИ не строит путь через яму.

```typescript
// Stub: tests/world-pits.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
// ... test setup ...
test('Pit cells are not walkable', () => {
    // setup world and pit at cell X
    assert.strictEqual(isWalkable(world, pitCell), false);
});
```

### Шаг 7. Валидация и производительность
1. Прогоните `npm run typecheck` и `npm run check:full`.
2. Визуально в Chrome (`npm run check:browser`) проверьте, что пропасти выглядят глубокими (черные или с параллакс текстурой), и в них нельзя наступить без последствий.

### Шаг 8. Оформление PR
1. Коммит: `feat(render, gen): add bottomless pits with deep vertical wall rendering`.
2. Убедитесь, что логика ям не крашит кэш путей при динамическом создании (если таковое будет).
