# План Агента: marx_45

## Роль
Вы — один из агентов Jules, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №45.
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
**ИИ: Умный Инвентарь НПЦ. Подбор лучшего оружия, выброс мусора.**

### Контекст задачи
Текущие NPC статичны в плане экипировки: с чем заспавнились, с тем и ходят. Необходимо внедрить «Умный Инвентарь»: NPC должны сканировать окружение на предмет лучшего оружия, подбирать его и выбрасывать более слабое. Это сделает поле боя динамичным — NPC могут поднять выпавшее мощное оружие игрока или убитого товарища.

### Конкретные файлы и паттерны
- **`src/systems/ai/npc_utility.ts`**: Добавить новый intent `'loot_upgrade'`.
- **`src/systems/inventory.ts`**: Использовать существующие `pickupItem()` / `dropItem()`.
- **`src/systems/entity_index.ts`**: Использовать broadphase query для поиска ближайших `ItemDrop`, чтобы не сканировать весь массив `world.entities` каждый кадр.
- **Оптимизация**: Сканирование выполняется с низким приоритетом и большим cooldown (например, раз в 30 секунд или только вне активного боя/при патрулировании).

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

#### Шаг 1: Создание микро-цели 'loot_upgrade'
В `src/systems/ai/npc_utility.ts` (или там, где определяются цели ИИ) добавьте логику оценки ближайшего лута.
```ts
// src/systems/ai/npc_utility.ts
function evaluateLootUpgrade(npc: Npc, world: World): UtilityScore {
  // Выполнять проверку не чаще раза в 10-30 секунд
  if (world.time - npc.aiState.lastLootScanTime < 30000) return 0;
  
  // В бою не лутаемся (или делаем это с очень низким приоритетом)
  if (npc.aiState.inCombat) return 0;

  // Broadphase: ищем ItemDrop в радиусе 15 клеток
  const nearbyItems = queryEntitiesNearby(world, npc.x, npc.y, 15, EntityType.ITEM_DROP);
  
  let bestItem: Entity | null = null;
  let bestScore = 0;
  
  const currentWeaponDmg = getWeaponValue(npc.inventory.equippedWeapon); // Функция оценки мощи
  
  for (const itemDrop of nearbyItems) {
    const itemDef = getItemDef(itemDrop.itemId);
    if (isWeapon(itemDef)) {
       const newWeaponDmg = getWeaponValue(itemDrop.itemId);
       if (newWeaponDmg > currentWeaponDmg) {
         // Нашли пушку лучше!
         const score = (newWeaponDmg - currentWeaponDmg) * 10;
         if (score > bestScore) {
           bestScore = score;
           bestItem = itemDrop;
         }
       }
    }
  }
  
  if (bestItem) {
    npc.aiState.targetItem = bestItem.id;
    return bestScore; // Если score высокий, intent перебьет патруль
  }
  
  npc.aiState.lastLootScanTime = world.time;
  return 0;
}
```

#### Шаг 2: Исполнение намерения (Execution)
Когда NPC выбирает цель `'loot_upgrade'`, он должен двигаться к предмету. По достижении:
```ts
// src/systems/ai/npc_actions.ts
function executeLootUpgrade(npc: Npc, world: World) {
  const item = world.getEntity(npc.aiState.targetItem);
  if (!item || item.type !== EntityType.ITEM_DROP) {
    // Предмет пропал (кто-то другой подобрал)
    npc.aiState.currentIntent = 'idle';
    return;
  }
  
  const dist = calculateDist2(npc.x, npc.y, item.x, item.y);
  if (dist <= 1.5) { // Дистанция подбора
     // Выбрасываем старое оружие
     if (npc.inventory.equippedWeapon) {
       dropItem(world, npc, npc.inventory.equippedWeapon);
     }
     // Подбираем новое
     pickupItem(world, npc, item);
     equipWeapon(npc, item.itemId);
     
     publishEvent('npc_upgraded_weapon', { npcId: npc.id, weapon: item.itemId });
     npc.aiState.currentIntent = 'idle';
  } else {
     // Идём к предмету
     steerTo(npc, item.x, item.y, world);
  }
}
```

#### Шаг 3: Функция оценки `getWeaponValue`
В `src/data/weapons.ts` или `src/systems/inventory.ts` реализуйте (или используйте) функцию, которая объективно оценивает "мощь" оружия (DPS = damage * fireRate). Это позволит NPC принимать правильные решения.

### QA и Тестирование
1. Заспавните NPC с плохим оружием (например, пистолетом).
2. Выбросьте рядом с ним на землю мощное оружие (штурмовую винтовку).
3. Подождите до 30 секунд. NPC должен заметить винтовку, подойти к ней, выбросить свой пистолет и подобрать винтовку.
4. Начните перестрелку, убедитесь, что NPC использует новое оружие.
5. Убедитесь, что поиск использует `queryEntitiesNearby` и не вызывает лагов (`npm run check` и `npm run typecheck`).

### Требования к PR
- Отсутствие `for(const e of world.entities)` в ИИ-лупе, строго broadphase.
- Анимация подбора не обязательна, но выброс старого предмета на землю (spawn ITEM_DROP) обязателен, чтобы он не исчезал вникуда.

---
*Ожидается, что вы полностью автономно завершите задачу и оставите проект в компилируемом состоянии.*
