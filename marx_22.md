# План Агента: marx_22
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №22.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Окраина: Разрешение конфликта. Получение Пропуска через помощь фракции, силу или хитрость.**

### Контекст задачи
Игрок получает Пропуск Окраины (marx_31) одним из путей: 1) Помощь Wild (выполнить квест Бригадира), 2) Помощь Ликвидаторам (выполнить квест Капитана), 3) Убить лидера любой фракции (дроп), 4) Тайный проход через разрушаемую стену. Выбор влияет на репутацию — помощь одной стороне портит отношения с другой. Эта задача реализует последствия и саму механику получения ключа.

### Конкретные файлы и паттерны
- **Путь Wild**: Квест «Убей патруль Ликвидаторов» → при успехе Бригадир даёт `outskirts_pass` через `rewardItem`. Последствие: `Faction.LIQUIDATOR.relation -= 30`.
- **Путь Ликвидаторов**: Квест «Зачисти мутантов у КПП» → Капитан даёт пропуск. Последствие: `Faction.WILD.relation -= 30`.
- **Силовой путь**: Лидеры имеют `outskirts_pass` в inventory. Death drop через стандартную систему. Последствие: обе фракции враждебны.
- **Тайный путь**: Где-то в нейтральной зоне — тонкая стена (wallHp: 30) за которой проход к лифту. Кирка/отбойник (marx_46) ломает за 5-10 ударов. Никаких репутационных последствий.
- **`src/data/plot.ts`**: `registerSideQuest()` для Wild и Liquidator paths. `registerSideQuestSteps()` для шагов.
- **Events**: `publishEvent('outskirts_resolved', { method: 'wild'|'liquidator'|'force'|'stealth' })` — для А-Лайф последствий.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Systems (Квесты и Репутация) - `src/systems/quests.ts`
При завершении квеста одной из фракций, необходимо изменять репутацию с другой, а также вызывать глобальное событие завершения конфликта Окраины.
```typescript
// Stub for quest completion logic
function onQuestCompleted(questId: string) {
  if (questId === 'outskirts_wild_help') {
    changeFactionRelation(Faction.LIQUIDATOR, -30);
    changeFactionRelation(Faction.WILD, +15);
    publishEvent('outskirts_resolved', { method: 'wild' });
  } else if (questId === 'outskirts_liq_help') {
    changeFactionRelation(Faction.WILD, -30);
    changeFactionRelation(Faction.LIQUIDATOR, +15);
    publishEvent('outskirts_resolved', { method: 'liquidator' });
  }
}
```

#### 2. Слой Systems (Силовой путь) - `src/systems/loot.ts`
Если игрок решает убить лидера, пропуск должен выпасть из его инвентаря вместе с остальным лутом. Это альтернативный хардкорный метод.
```typescript
// Stub for leader death drop
function onEntityDeath(entity: Entity) {
  if (entity.npcId === 'wild_brigadier' || entity.npcId === 'liquidator_captain') {
    // Drop all inventory items, including outskirts_pass
    spawnLoot(entity.pos, entity.inventory);
    
    // Huge reputation penalty for killing a leader
    changeFactionRelation(entity.factionId, -100);
    
    // Announce to the world
    publishEvent('outskirts_resolved', { method: 'force', deadLeader: entity.npcId });
  }
}
```

#### 3. Слой Gen (Тайный путь) - `src/gen/design_floors/outskirts_secret.ts`
Создание разрушаемой стены в нейтральной зоне. Этот путь предназначен для внимательных игроков или тех, кто не хочет портить репутацию.
```typescript
// Stub for secret passage generation
export function carveSecretPassage(world: World, neutralZoneX: number) {
  const wallCell = findSuitableWall(world, neutralZoneX);
  if (!wallCell) return;
  
  // Mark cell as destructible
  world.cells[wallCell.idx].hp = 30; // 5-10 hits with a pickaxe
  world.cells[wallCell.idx].type = CellType.DESTRUCTIBLE_WALL;
  world.cells[wallCell.idx].material = Material.FRAGILE_BRICK;
  
  // Connect passage to the elevator room behind it
  const elevatorRoom = findElevatorRoom(world);
  carveCorridor(world, wallCell, elevatorRoom.center);
}
```

#### 4. Слой Systems (Разрушение стены) - `src/systems/interactions.ts`
Логика взаимодействия с разрушаемой стеной через `E` или удары (melee).
```typescript
// Stub for wall destruction
function handleWallAttack(entity: Entity, cellIdx: number) {
  const cell = world.cells[cellIdx];
  if (cell.type === CellType.DESTRUCTIBLE_WALL) {
    const dmg = entity.equipment?.toolDmg || 1;
    cell.hp -= dmg;
    
    publishEvent('noise', { type: 'wall_hit', pos: cellIdx });
    
    if (cell.hp <= 0) {
      cell.type = CellType.FLOOR; // Opened passage
      world.cellVersion++; // Trigger nav mesh rebuild!
      publishEvent('secret_passage_opened');
      publishEvent('outskirts_resolved', { method: 'stealth' });
    }
  }
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Ознакомьтесь с логикой квестов в `plot.ts` и `quests.ts`. Изучите структуру фракций в `factions.ts`.
2. **Проектирование:** Разработайте механизм учета "Разрешения конфликта" (состояние этажа должно запоминать выбор игрока).
3. **Реализация Data-слоя:** Добавьте шаги квестов (`registerSideQuestSteps`) для обоих путей в `plot.ts`.
4. **Реализация Systems-слоя (Квесты):** Настройте выдачу награды и штрафов репутации в обработчике завершения квеста.
5. **Реализация Systems-слоя (Лут):** Гарантируйте, что при смерти NPC предметы из инвентаря выбрасываются в мир как сущности (Items on floor).
6. **Реализация Gen-слоя:** Создайте скрытую область на Окраине. Используйте `carveSecretPassage` для соединения нейтральной зоны и лифтового холла.
7. **Реализация Systems-слоя (Взаимодействия):** В `interactions.ts` обработайте удар киркой или другим оружием по `DESTRUCTIBLE_WALL`. Не забудьте инкрементировать `world.cellVersion`, иначе мобы и ИИ не поймут, что стена исчезла.
8. **Тестирование:** Напишите тесты в `tests/quests.test.ts` для проверки изменения репутации при завершении квеста. Проверьте логику `handleWallAttack`.
9. **Валидация типов:** Запустите `npm run typecheck`.
10. **Оптимизация:** Убедитесь, что проверки урона стене не выполняются при каждом шаге игрока, а только при направленном ударе.
11. **Коммит:** Закоммитить изменения с детализацией новых путей прохождения.
12. **Pull Request:** Запушить изменения и подготовить PR.
13. **Документация:** Распишите все 4 метода получения ключа в описании PR.

---
*Ожидается, что вы завершите задачу, предоставив игроку истинную вариативность в решении проблемы, и оставите проект в компилируемом состоянии.*
