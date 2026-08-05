# План Агента: marx_49

## Роль
Вы — один из агентов Jules, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №49.
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
**Интерфейс: Выбор интерактов. Исправление raycast/focus, чтобы предметы в куче легко выделялись.**

### Контекст задачи
В игре возникает проблема UX: когда игрок смотрит на кучу предметов (трупы, оружие, ящики, NPC стоят рядом), фокус (raycast) хаотично прыгает между ними при малейшем движении мыши.
Требуется исправить это через 4 механики:
1. **Priority system**: NPC (особенно с квестами) > Контейнеры > Лут > Декорации (Features).
2. **Sticky focus**: Если объект уже в фокусе, он «прилипает» и не сбрасывается, пока игрок не отведет взгляд на угол > 15°.
3. **Tab cycling**: Если рядом несколько объектов, повторное нажатие кнопки `E` или `Tab` циклически переключает фокус на следующий объект в куче.
4. **Визуальный highlight**: Текущий сфокусированный объект должен подсвечиваться (sprite brightness +20% или белый outline).

### Конкретные файлы и паттерны
- **`src/input.ts`** / **`src/systems/interactions.ts`**: Центральный диспетчер интерактов.
- **Raycast логика**: Сейчас raycast берет ближайший коллайдер на луче. Нужно изменить на сферу/конус перед игроком и сортировать результаты.
- **`src/render/sprites.ts`** / **`src/render/webgl.ts`**: В рендере добавить проверку: если `entity.id === player.focusedEntityId`, применять шейдер подсветки.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

#### Шаг 1: Улучшение логики поиска интерактов (Cone Cast)
Вместо тонкого луча используйте конический поиск или `queryEntitiesNearby` перед игроком, а затем сортируйте результаты.
```ts
// src/systems/interactions.ts
function getInteractableInFocus(player: Entity, world: World): Entity | null {
  const lookDir = player.rotation;
  const nearby = queryEntitiesNearby(world, player.x, player.y, 2.5); // Радиус взаимодействия
  
  const candidates = nearby.filter(e => {
    if (!isInteractable(e)) return false;
    const angleToObj = calculateAngle(player.x, player.y, e.x, e.y);
    const angleDiff = Math.abs(normalizeAngle(lookDir - angleToObj));
    return angleDiff < Math.PI / 4; // 45 градусов конус видимости
  });
  
  if (candidates.length === 0) return null;

  // Шаг 2: Система приоритетов
  candidates.sort((a, b) => {
     const scoreA = getInteractPriority(a) - getDistancePenalty(player, a);
     const scoreB = getInteractPriority(b) - getDistancePenalty(player, b);
     return scoreB - scoreA; 
  });

  return candidates[0]; // Возвращаем самый приоритетный
}

function getInteractPriority(e: Entity): number {
  if (e.type === EntityType.NPC && hasActiveQuest(e)) return 100;
  if (e.type === EntityType.NPC) return 80;
  if (e.type === EntityType.CONTAINER) return 60;
  if (e.type === EntityType.ITEM_DROP) return 40;
  return 10; // feature
}
```

#### Шаг 3: Sticky Focus (Липкий фокус)
Сохраняйте ID текущего объекта в стейте игрока и применяйте hysteresis (задержку сброса).
```ts
// src/systems/interactions.ts
let currentFocusId = player.state.focusedEntityId;

if (currentFocusId) {
  const focusedObj = world.getEntity(currentFocusId);
  if (focusedObj) {
     const angleDiff = getAngleDiff(player, focusedObj);
     const dist = calculateDist2(player.x, player.y, focusedObj.x, focusedObj.y);
     // Прилипание: угол сброса больше (например 30 градусов), чем угол захвата (15 градусов)
     if (angleDiff < Math.PI / 3 && dist < 3.0) {
        return focusedObj; // Продолжаем держать фокус
     }
  }
}
```

#### Шаг 4: Визуальная подсветка в Рендере
Изменения в `render` слое должны быть минимальны — только визуализация факта фокуса.
```ts
// src/render/webgl.ts (цикл отрисовки сущностей)
const isFocused = (entity.id === gameState.player.state.focusedEntityId);

if (isFocused) {
  // Передаем uniform в шейдер или применяем фильтр яркости
  gl.uniform1f(uBrightnessLoc, 1.2); 
  // или рисуем рамку
} else {
  gl.uniform1f(uBrightnessLoc, 1.0);
}
```

### QA и Тестирование
1. Выбросьте 5 разных предметов (оружие, аптечка, мусор) в одну кучу.
2. Подойдите и наведите прицел. Фокус должен захватить самый ценный/приоритетный объект.
3. Подвигайте мышью влево-вправо на небольшие углы — фокус не должен хаотично перепрыгивать благодаря Sticky Focus.
4. Подойдите к торговцу, бросьте перед ним ящик. Наведение в сторону торговца должно выделять NPC, так как его приоритет (80) выше ящика (60).
5. Визуально проверьте, что подсвечивается ровно один объект.
6. Выполните `npm run check:browser` (так как затрагивается рендер и инпут).

### Требования к PR
- Не перегружать рендер-луп сложной логикой выбора. Выбор происходит в `systems/interactions.ts`, рендер только читает ID.
- Подсветка не должна ломать атмосферу (использовать аккуратный outline или +brightness, никаких вырвиглазных CSS-обводок на canvas).

---
*Ожидается, что вы полностью автономно завершите задачу и оставите проект в компилируемом состоянии.*
