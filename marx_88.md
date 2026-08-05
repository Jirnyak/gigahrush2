# План Агента: marx_88
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №88.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Баланс декораций-ящиков**

### Контекст задачи
Теперь все столы, тумбочки и бытовые декорации работают как интерактивные контейнеры. Из-за высокой плотности таких объектов игрок получает слишком много халявных предметов, что ломает экономику выживания. Нужно сбалансировать шансы спавна лута в бытовых декорациях так, чтобы большинство из них были пустыми (или содержали мусор), сохраняя ощущение дефицита ресурсов.

### Конкретные файлы и паттерны
- **`src/systems/procedural_loot.ts`**
- **`src/data/interactive.ts`**
- **`src/data/balance.ts`** (или конфигурации дроп-таблиц)
- **`balance.md`** (документ правил баланса)

## Подробный Workflow реализации

### Шаг 1. Анализ таблиц лута (Drop Tables)
1. Изучите `src/data/interactive.ts`. Посмотрите, какие таблицы лута (LootTable ID) привязаны к декорациям типа `TABLE`, `CLOSET`, `NIGHTSTAND`.
2. Найдите определения этих таблиц лута в `src/systems/procedural_loot.ts` или `src/data/items.ts`.

### Шаг 2. Внедрение вероятности "Пусто" (Empty Chance)
1. В механизме генерации лута для контейнера добавьте высокую базовую вероятность ничего не сгенерировать.
2. Либо добавьте "мусорные" предметы (пустая банка, пыль) с высоким весом, чтобы игрок понимал, что обыскал объект, но не обогатился.

```typescript
// Stub: src/data/loot_tables.ts
export const DECOR_LOOT_TABLE: LootTableDef = {
    id: 'decor_basic',
    rolls: 1,
    entries: [
        { itemId: 'none', weight: 80 }, // 80% chance of empty
        { itemId: 'scrap', weight: 15 },
        { itemId: 'tushonka', weight: 1 },
        { itemId: 'ammo_9mm', weight: 4 }
    ]
};
```

### Шаг 3. Модификация процедурного распределения
1. В `src/systems/procedural_loot.ts` (при инициализации этажа), если идет перебор всех контейнеров:
2. Введите глобальный модификатор скудности (Scarcity Modifier) в зависимости от типа этажа. В министерстве столы могут быть пустыми, а на жилом этаже шанс чуть выше.

```typescript
// Stub: src/systems/procedural_loot.ts
export function populateContainers(world: World): void {
    const isHardFloor = world.dangerLevel > 5;
    const emptyMultiplier = isHardFloor ? 1.5 : 1.0;

    for (const container of world.containers) {
        // Adjust empty weights dynamically if needed, 
        // or just rely on the static table definitions.
        generateLootForContainer(container, emptyMultiplier);
    }
}
```

### Шаг 4. Ребаланс специфичных контейнеров
1. Убедитесь, что *настоящие* ящики с лутом (Military Crate, Safe) сохраняют высокие шансы на ценные вещи, чтобы игрок мог их искать.
2. Проверьте `src/data/interactive.ts`, чтобы у настоящих сундуков был свой LootTable (например, `rare_crate`), а не общий бытовой `decor_basic`.

### Шаг 5. Написание тестов баланса
1. Создайте/обновите `tests/balance-loot.test.ts`.
2. Создайте 1000 декораций и сгенерируйте в них лут.
3. Проверьте статистику: процент непустых ящиков должен быть в диапазоне 10-20%, а процент выпадения аптечек/патронов — менее 1-2%.

```typescript
// Stub: tests/balance-loot.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
import { rollLootTable } from '../src/systems/procedural_loot';

test('Decor loot is sparse (mostly empty)', () => {
    let emptyCount = 0;
    for(let i = 0; i < 1000; i++) {
        const items = rollLootTable('decor_basic');
        if (items.length === 0 || items[0] === 'none') {
            emptyCount++;
        }
    }
    assert.ok(emptyCount > 700, 'At least 70% of decor containers should be empty');
});
```

### Шаг 6. Валидация
1. Запустите тесты (`npm run test:unit`).
2. Запустите игру (`npm run dev`), побегайте по квартирам, пооткрывайте шкафы. Вы должны чувствовать фрустрацию от пустых ящиков (это хорошо для survival-horror).

### Шаг 7. Оформление PR
1. Коммит: `balance(loot): severely reduce drop rates in common decor containers (tables, closets)`.
2. В PR укажите, что шанс пустого ящика увеличен до X% согласно `balance.md`.
