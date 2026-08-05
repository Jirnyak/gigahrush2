# План Агента: marx_89
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №89.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Баг рендера: меш над мешем**

### Контекст задачи
Иногда меш декорации (например, шкафа или стола) возникает над другим мешем на одной и той же клетке, создавая Z-fighting или визуальный мусор. Причина кроется либо в ошибках z-индексации WebGL рендерера, либо в отсутствии жестких правил взаимоисключающего размещения при процедурной генерации декораций (визуальных слотов).

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`** (обработка отрисовки мешей и слотов)
- **`src/gen/visual_cell_slots.ts`** (правила размещения визуальных объектов)
- **`src/core/world.ts`** (хранение слотов на клетке)

## Подробный Workflow реализации

### Шаг 1. Анализ бага на уровне генерации
1. В `src/gen/visual_cell_slots.ts` проверьте, могут ли несколько крупных декораций назначаться на один `idx` (клетку).
2. По правилам, в одном `cell` может быть только одна центральная большая декорация (Center Slot). Настенные декорации (Wall Slots) должны находиться сбоку, а напольный мусор (Floor Slots) — лежать внизу.
3. Проверьте маски коллизий при генерации: перед спавном шкафа (Wall/Center object) нужно убедиться, что слот не занят.

```typescript
// Stub: src/gen/visual_cell_slots.ts
export function placeDecor(world: World, idx: number, decorType: DecorType): boolean {
    if (world.decor[idx] !== DECOR_NONE) {
        // PREVENT DOUBLE MESH: Slot already occupied
        return false; 
    }
    world.decor[idx] = decorType;
    return true;
}
```

### Шаг 2. Анализ бага на уровне рендера (Z-fighting)
1. Если на клетке ДОПУСТИМО наличие нескольких объектов (например, ковер + стол + лампа на столе), рендерер должен правильно выставлять Z-координату.
2. В `src/render/webgl.ts` убедитесь, что функция построения квадов добавляет смещение (offset) по Z или Y для накладывающихся слоев.

```typescript
// Stub: src/render/webgl.ts
function buildQuadForDecor(decor: DecorDef, baseX: number, baseY: number, baseZ: number) {
    // Add micro-offset to prevent z-fighting with the floor or other meshes
    const zOffset = decor.isFloorLayer ? 0.01 : 0.0;
    const finalZ = baseZ + zOffset;
    
    // ... push vertices with finalZ ...
}
```

### Шаг 3. Внедрение строгой типизации слотов (Slot Enums)
1. Чтобы избежать конфликтов, категоризируйте объекты. В `src/data/interactive.ts` каждый объект должен иметь тип `SlotType` (`CENTER`, `WALL_NORTH`, `FLOOR`, `CEILING`).
2. Клетка может хранить массив объектов, но не более одного для каждого `SlotType`.

```typescript
// Stub: src/core/types.ts
export enum SlotType {
    CENTER = 0,
    WALL_N = 1,
    WALL_E = 2,
    WALL_S = 3,
    WALL_W = 4,
    FLOOR = 5
}
```

### Шаг 4. Очистка существующих конфликтов генераторов
1. Если баг возникает на специфичных этажах (например, квартирах), проверьте генераторы этих комнат (`src/gen/living/rooms.ts`).
2. Убедитесь, что они не пытаются спавнить стол поверх дивана при неудачном рандоме.

### Шаг 5. Написание тестов коллизий
1. Создайте `tests/render-mesh-collisions.test.ts`.
2. Замокайте генерацию комнаты и проверьте, что функция размещения возвращает `false`, если попытаться поставить два центральных объекта в одну клетку.

```typescript
// Stub: tests/render-mesh-collisions.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
import { placeDecor } from '../src/gen/visual_cell_slots';

test('Cannot place two center meshes on the same cell', () => {
    // ...
    const success1 = placeDecor(world, cell, DecorType.CLOSET);
    const success2 = placeDecor(world, cell, DecorType.TABLE);
    
    assert.strictEqual(success1, true);
    assert.strictEqual(success2, false, 'Should reject overlapping center mesh');
});
```

### Шаг 6. Валидация и проверка ФПС
1. `npm run check:readonly`.
2. Запустите игру (`npm run check:browser`), перейдите на жилой этаж, внимательно посмотрите на углы комнат и столы. Не должно быть мерцающих пикселей (Z-fighting) или слипшихся мешей.

### Шаг 7. Оформление PR
1. Коммит: `fix(render, gen): resolve mesh overlapping and z-fighting by enforcing cell slot exclusivity`.
2. В описании укажите, была ли проблема в рендере (глубина) или в генераторе (спавн в одну точку).
