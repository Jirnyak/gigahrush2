# План Агента: marx_25
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №25.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Геометрия: Оптимизация ламп. Авто-подгонка Z-координаты ламп, чтобы они не висели в воздухе ниже высокого потолка.**

### Контекст задачи
Лампы (`Feature.LAMP`) в игровом мире генерируются с фиксированной высотой (Z-координатой или Y в зависимости от осей WebGL). При генерации высоких помещений (где `Room.ceilingTier` больше стандартного) лампы визуально отрываются от потолка и парят в воздухе. Задача — реализовать авто-подгонку координаты ламп на этапе рендеринга и освещения.

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`**: Отрисовка фичей, в том числе светильников (billboards/sprites).
- **`src/core/world.ts`**: Определение интерфейса фичи `Feature`.
- **`src/gen/shared.ts`**: Установка фичей при генерации мира. Добавление `roomId` к фичам, чтобы знать, в какой они комнате.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Gen (Инициализация фичей) - `src/gen/shared.ts`
При спавне лампы, она должна знать, к какой комнате принадлежит, чтобы рендерер и система освещения могли легко найти `ceilingTier` комнаты. Обновите `placeFeature` или аналогичный метод.
```typescript
// Stub for feature placement
export function placeLampFeature(world: World, cellIdx: number) {
  const roomId = world.roomMap[cellIdx]; // Find room via spatial map
  
  const feature: Feature = {
    type: FeatureType.LAMP,
    cellIdx: cellIdx,
    roomId: roomId, // Store reference to room for height query
    state: FeatureState.ON,
    // coordinates x, z usually derived from cellIdx
  };
  world.features.push(feature);
}
```

#### 2. Слой Render (Динамическая высота) - `src/render/webgl.ts`
Во время рейкастинга или отрисовки 3D-спрайтов (billboards) ламп, вычисляйте их высоту от потолка динамически.
```typescript
// Stub for lamp rendering
function renderLampFeature(gl: WebGLRenderingContext, feature: Feature, world: World) {
  let ceilingHeight = 2.0; // Default flat ceiling height
  
  if (feature.roomId !== undefined) {
    const room = world.rooms[feature.roomId];
    if (room) {
      // Calculate real ceiling height based on tier
      // (Can reuse getCeilingHeightForTier() from marx_24)
      ceilingHeight = 2.0 + (room.ceilingTier * 1.5);
    }
  }
  
  // Lamps hang slightly below the ceiling. 
  // lampDropOffset specifies how far down the fixture extends.
  const lampDropOffset = 0.2; 
  const yPosition = ceilingHeight - lampDropOffset;
  
  // Draw the lamp sprite billboard at the correct yPosition
  drawSpriteAtHeight(gl, Tex.LAMP, feature.x, yPosition, feature.z);
}
```

#### 3. Слой Systems (Система освещения) - `src/systems/light.ts`
Убедитесь, что система расчета освещения (point lights) берет правильную позицию источника света. Если лампа висит на высоте 4.0, свет должен падать оттуда.
```typescript
// Stub for lighting engine
export function updateLightGrid(world: World) {
  for (const feature of world.features) {
    if (feature.type === FeatureType.LAMP && feature.state === FeatureState.ON) {
      let tier = 0;
      if (feature.roomId !== undefined) {
         tier = world.rooms[feature.roomId]?.ceilingTier || 0;
      }
      
      const yPos = 2.0 + (tier * 1.5) - 0.2;
      
      // Inject light source into volume grid at dynamic Y
      addPointLight(world.lightMap, feature.x, yPos, feature.z, feature.color, feature.radius);
    }
  }
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Изучите `src/render/webgl.ts` (как рендерятся спрайты `Feature.LAMP`). Найдите движок освещения (возможно, `src/systems/light.ts` или `render/light.ts`).
2. **Модификация Core:** Проверьте `src/core/types.ts` и убедитесь, что интерфейс `Feature` содержит опциональное поле `roomId?: number`.
3. **Реализация Gen-слоя:** В утилитах генерации, где ставятся лампы, добавьте определение `roomId` через `world.roomMap`.
4. **Реализация Render-слоя:** В функции отрисовки фичей (billboard pass) добавьте динамический расчет Y-координаты для ламп.
5. **Реализация Systems-слоя:** Обновите расчет 3D освещения, чтобы источник света поднимался вместе с лампой.
6. **Оптимизация:** Чтение `room.ceilingTier` очень дешевое, но старайтесь не дублировать код. Если `getCeilingHeightForTier` уже существует — импортируйте.
7. **Тестирование визуальное:** Откройте dev-сервер, зайдите на этаж Коллекторов или сгенерируйте тестовый этаж с высоким потолком. Убедитесь, что лампа висит ровно под потолком и отбрасывает свет корректно.
8. **Проверка типов:** Выполните `npm run typecheck`.
9. **Коммит:** Закоммитьте изменения: `feat(render): dynamic lamp Y-position based on ceiling tier`.
10. **Pull Request:** Запушьте код и откройте PR.
11. **Документация:** Укажите, что теперь все `Feature.LAMP` жестко привязаны к геометрии потолка.

---
*Ожидается, что вы завершите задачу, сделав освещение и декорации процедурными и зависящими от геометрии этажа, оставив проект в компилируемом состоянии.*
