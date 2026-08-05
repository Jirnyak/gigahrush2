# План Агента: marx_85
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №85.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Оптимизация тестов (отказ от хардкода)**

### Контекст задачи
Тесты слишком хрупкие (brittle) и мешают добавлять контент из-за хардкода точных чисел (например, `assert.equal(doorCount, 42)`). Изменение алгоритма генерации на 1% ломает десятки тестов. Переделать тесты так, чтобы они проверяли ключевые инварианты (наличие связности, отсутствие комнат без дверей, валидность спавнов), а не точные абсолютные значения.

### Конкретные файлы и паттерны
- **`tests/living-genfix-051.test.ts`** (и подобные тесты генерации)
- **`tests/generation_invariants.ts`** (новый файл для общих проверок)
- **Утилиты тестирования генерации**

## Подробный Workflow реализации

### Шаг 1. Аудит текущих хрупких тестов
1. Просмотрите папку `tests/` и найдите тесты, падающие при изменении `Math.random()` сидов или добавлении новых вариантов декораций (особенно в `living-genfix-*.test.ts`).
2. Выявите паттерны жестких проверок (`assert.strictEqual(objects.filter(o => o.type === 'window').length, 12)`).

### Шаг 2. Разработка инвариантных проверок (Invariants)
1. Создайте модуль утилит для тестов `tests/helpers/invariants.ts`.
2. Вместо хардкода, напишите функции, проверяющие "здоровье" этажа.
   - **Связность**: от лифта можно дойти до всех не-защищенных комнат.
   - **Двери**: каждая сгенерированная комната имеет хотя бы одну дверь (кроме спец-кейсов).
   - **Отсутствие застреваний**: спавн игрока и NPC находится на `walkable` клетке.
   - **Лимиты**: количество монстров или лута находится в разумных пределах (например, `> 0` и `< MAX_ENTITIES`).

```typescript
// Stub: tests/helpers/invariants.ts
export function assertFloorConnectivity(world: World): void {
    const connectedCount = runFloodFill(world, world.playerIdx);
    const expectedWalkable = countWalkableCells(world);
    // Allow a small percentage of isolated cells (e.g., hidden stashes), 
    // but assert main connectivity.
    assert.ok(connectedCount > expectedWalkable * 0.95, 'Floor must be well connected');
}

export function assertNoEmptyRooms(world: World): void {
    for (const room of world.rooms) {
        assert.ok(room.doors.length > 0, `Room ${room.id} has no doors`);
    }
}
```

### Шаг 3. Рефакторинг хрупких тестов
1. Откройте `tests/living-genfix-051.test.ts` и аналогичные.
2. Замените точные сравнения чисел на инвариантные проверки.
3. Если тест проверяет фикс конкретного бага (например, "спавн внутри стены"), оставьте проверку именно этого факта: `assert.strictEqual(isWalkable(world, bugSpawnIdx), true)`.

```typescript
// Stub: tests/living-genfix-051.test.ts
import { test } from 'node:test';
import { assertFloorConnectivity, assertNoEmptyRooms } from './helpers/invariants';

test('Living floor generation does not produce fatal errors', () => {
    const world = generateTestFloor('living', 'seed_051');
    assertFloorConnectivity(world);
    assertNoEmptyRooms(world);
    
    // Instead of: assert.equal(world.entities.length, 105)
    assert.ok(world.entities.length > 50, 'Should spawn enough entities');
    assert.ok(world.entities.length < 500, 'Should not overpopulate');
});
```

### Шаг 4. Внедрение генераторов снапшотов (Опционально)
1. Если нужно отслеживать статистику этажа (чтобы заметить, если лут внезапно исчезнет), используйте снапшоты "размера" (ranges), а не точные числа. 
2. Например, создайте функцию проверки `assertInRange(value, min, max)`.

### Шаг 5. Запуск и стабилизация
1. Запустите `npm run test:generation` (или скрипт, гоняющий генерацию на разных сидах).
2. Убедитесь, что переписанные тесты проходят стабильно (Flaky tests -> 0).
3. Измените один из генераторов (добавьте случайную комнату), чтобы проверить, что тесты *не упали* от незначительного изменения контента, но упадут, если комната заблокирует лифт.

### Шаг 6. Оформление PR
1. Коммит: `test(gen): replace brittle hardcoded checks with robust invariant testing`.
2. В описании PR укажите, что это разблокирует работу контент-дизайнерам.
