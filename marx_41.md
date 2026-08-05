# План Агента: marx_41

## Роль
Вы — один из агентов Jules, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №41.
Вы действуете полностью автономно. От вас ожидается реализация фичи от начала до конца, включая написание кода, интеграцию с архитектурой и проверку работоспособности.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**ИИ Багфикс: Застревание монстров в узких проходах.**

### Контекст задачи
На данный момент монстры часто застревают в дверных проёмах (шириной 1 клетка), особенно когда два существа идут навстречу друг другу, что приводит к deadlock'у. Крупные мобы (с радиусом коллизии > 0.4) физически не могут пройти через такие двери, хотя pathfinder считает их проходимыми.
Необходимо реализовать:
1. Приоритет коллизий: монстр с меньшим ID уступает дорогу (шаг в сторону).
2. Крупные мобы ломают дверной проём, расширяя его (связано с marx_39).
3. Тайм-аут: если entity не двигался 3 секунды, выполняется force-teleport на ближайшую свободную клетку.

### Конкретные файлы и паттерны
- **`src/systems/ai/monster.ts`**: Изучите движение монстров к цели. Проблема в том, что collision radius мешает прохождению через `Cell.DOOR`.
- **`src/systems/ai/pathfinding.ts`**: Nav tree работает корректно, ошибка в физическом resolution движений (steering/collision).
- **Решение без noclip**: При подходе к двери добавить door-squeeze behaviour: если расстояние до центра двери < 2, монстр должен двигаться строго по оси двери (x или y), игнорируя diagonal drift.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

#### Шаг 1: Door-Squeeze Behaviour (Умное протискивание)
В `src/systems/ai/monster.ts` обновите логику steering'а:
```ts
// src/systems/ai/monster.ts
function applyDoorSqueeze(entity: Entity, world: World, moveVector: Vec2) {
  const currentCell = world.getCell(Math.floor(entity.x), Math.floor(entity.y));
  const nextCellX = Math.floor(entity.x + moveVector.x);
  const nextCellY = Math.floor(entity.y + moveVector.y);
  
  if (world.getCell(nextCellX, nextCellY) === Cell.DOOR || currentCell === Cell.DOOR) {
    // Временно уменьшаем влияние диагонального дрифта, выравниваем движение
    // Монстр идет строго вдоль оси двери (протискивается)
    const doorCenterX = nextCellX + 0.5;
    const doorCenterY = nextCellY + 0.5;
    
    // Сжимаем коллизию или принудительно центрируем монстра в проеме
    const dx = doorCenterX - entity.x;
    const dy = doorCenterY - entity.y;
    
    if (Math.abs(dx) > Math.abs(dy)) {
       moveVector.y *= 0.1; // гасим отклонение
    } else {
       moveVector.x *= 0.1; 
    }
  }
}
```

#### Шаг 2: Collision Priority (Разрешение Deadlock-ов)
При столкновении двух Entity, они должны иметь механизм уступки дороги.
```ts
// src/systems/physics/collision.ts или внутри steering'a
function resolveEntityCollision(e1: Entity, e2: Entity) {
  if (e1.id < e2.id) {
    // e1 отступает в сторону
    const tangentX = -(e2.y - e1.y);
    const tangentY = (e2.x - e1.x);
    e1.moveIntent.x += tangentX * 0.5;
    e1.moveIntent.y += tangentY * 0.5;
  }
}
```

#### Шаг 3: Destruction for Large Mobs
Если радиус монстра `> 0.4`, и перед ним закрытая или узкая дверь, он должен ломать стену/дверь.
```ts
// src/systems/ai/monster.ts
if (entity.radius > 0.4 && isBlockedByNarrowDoor(entity, moveVector, world)) {
  destroyDoorFrame(world, nextCellX, nextCellY); // Превращаем стену в Floor/Rubble
  publishEvent('wall_broken', { x: nextCellX, y: nextCellY });
}
```

#### Шаг 4: Timeout Force-Teleport
Отслеживайте позицию монстра. Если он имеет цель, но его `distance` за последние 3 секунды изменилась менее чем на 0.1 клетки — значит застрял.
```ts
// src/systems/ai/ai_runtime.ts
if (currentTime - entity.aiState.lastMoveTime > 3000) {
  if (calculateDist2(entity.x, entity.y, entity.aiState.lastMovePos) < 0.1) {
    // Застрял -> force teleport на соседнюю свободную клетку
    forceTeleportToUnblockedCell(entity, world);
  }
  entity.aiState.lastMoveTime = currentTime;
  entity.aiState.lastMovePos = { x: entity.x, y: entity.y };
}
```

### QA и Тестирование
1. Разместите в узком коридоре (1 клетка) двух монстров навстречу друг другу. Они не должны заблокировать друг друга (collision priority решит спор).
2. Заспавните крупного моба (например, Мясника) в комнате с обычной дверью — убедитесь, что он выламывает косяки и проходит.
3. Проверьте анти-софтлок: специально заблокируйте монстра бочками. Через 3 секунды попыток он должен переместиться на свободное место.
4. Выполните `npm run test:unit` и `npm run typecheck`.

### Требования к PR
- Сохраняйте оптимизацию: проверки тайм-аута не должны создавать мусор в памяти.
- Никакого DOM, все расчеты строго в `systems/`.

---
*Ожидается, что вы полностью автономно завершите задачу и оставите проект в компилируемом состоянии.*
