# План Агента: marx_21
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №21.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Окраина: Конфликт Фракций. Wild vs Ликвидаторы на этаже Окраины.**

### Контекст задачи
На этаже «Окраина» (marx_30) две фракции делят территорию. Wild контролируют западную часть (хаотичные баррикады, граффити, мусор), Ликвидаторы — восточную (порядок, посты, прожекторы). Центральная полоса — нейтральная зона, куда патрули обеих сторон заходят, но не атакуют друг друга без провокации. Атмосфера: холодная война, вот-вот рванёт.

### Конкретные файлы и паттерны
- **`src/gen/design_floors/outskirts.ts`** (от marx_30): После генерации этажа, разделите зоны по roomMap: комнаты с x < centerX = Wild territory, x > centerX = Liquidator. Центр = нейтрально.
- **`src/systems/territory.ts`**: `world.factionControl` для назначения ячеек фракциям.
- **Контент-модуль** `src/gen/design_floors/outskirts_conflict.ts` [НОВЫЙ]: Спавн лидеров обеих фракций в их HQ-комнатах. Лидер Wild = «Бригадир» (с дробовиком, hp:200). Лидер Ликвидаторов = «Капитан» (с автоматом, hp:250, броня).
- **Квесты**: Оба лидера через `registerSideQuest()` предлагают: «помоги нам — получишь пропуск». Wild: «убей патруль Ликвидаторов». Ликвидаторы: «зачисти гнездо мутантов у западного КПП».
- **Третий путь**: Можно обойти обоих — найти тайный проход (разрушаемая стена marx_44) или украсть пропуск (pickpocket если есть).

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Gen (Генератор) - `src/gen/design_floors/outskirts.ts`
После генерации комнат, назначьте зоны контроля на основе координаты X. Используйте `territory.ts` для формализации.
```typescript
// Stub for faction territory assignment
export function assignOutskirtsTerritories(world: World, centerX: number) {
  for (const room of world.rooms) {
    const cx = room.rect.x + Math.floor(room.rect.w / 2);
    if (cx < centerX - 10) {
      room.factionId = Faction.WILD;
      applyWildDecorations(world, room);
    } else if (cx > centerX + 10) {
      room.factionId = Faction.LIQUIDATOR;
      applyLiquidatorDecorations(world, room);
    } else {
      room.factionId = Faction.NEUTRAL;
    }
  }
}
```

#### 2. Слой Gen (Контент) - `src/gen/design_floors/outskirts_conflict.ts`
Модуль для спавна лидеров фракций и их свиты. Размещайте их в HQ-комнатах соответствующих территорий.
```typescript
// Stub for leader spawning
export function spawnFactionLeaders(world: World) {
  // Spawn Wild Leader "Бригадир"
  const wildHq = findRoom(world, Faction.WILD, 'hq');
  if (wildHq) {
    const brigadier = createNpc('wild_brigadier', wildHq.center);
    brigadier.hp = 200;
    brigadier.inventory.push(createItem('shotgun'));
    world.entities.push(brigadier);
  }

  // Spawn Liquidator Leader "Капитан"
  const liqHq = findRoom(world, Faction.LIQUIDATOR, 'hq');
  if (liqHq) {
    const captain = createNpc('liquidator_captain', liqHq.center);
    captain.hp = 250;
    captain.armor = 50;
    captain.inventory.push(createItem('assault_rifle'));
    world.entities.push(captain);
  }
}
```

#### 3. Слой Data (Квесты) - `src/data/plot.ts`
Зарегистрируйте квесты, которые выдают лидеры. Это позволит игроку выбрать сторону и заработать награду (Пропуск Окраины).
```typescript
// Stub for plot.ts
import { registerSideQuest } from '../systems/quests';

registerSideQuest({
  id: 'outskirts_wild_help',
  title: 'Устранение конкурентов',
  giverId: 'wild_brigadier',
  description: 'Убей патруль Ликвидаторов в нейтральной зоне. Они слишком близко.',
  rewardItems: ['outskirts_pass']
});

registerSideQuest({
  id: 'outskirts_liq_help',
  title: 'Зачистка периметра',
  giverId: 'liquidator_captain',
  description: 'Зачисти гнездо мутантов у западного КПП, чтобы обезопасить зону.',
  rewardItems: ['outskirts_pass']
});
```

#### 4. Слой Systems (Взаимодействия и Репутация)
Подготовьте базовые триггеры для начала конфликта. Если игрок атакует нейтральный патруль одной фракции на глазах у другой, репутация должна измениться.
```typescript
// Stub for handling attacks in neutral zone
function onNpcAttacked(attacker: Entity, victim: Entity) {
  if (victim.factionId === Faction.LIQUIDATOR && attacker.isPlayer) {
    // Wilds might like it if they see it
    publishEvent('faction_action_observed', {
      actorId: attacker.id,
      action: 'attack_liquidator'
    });
  }
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Прочитайте AGENTS.md, `architecture.md` и исходники генератора Окраины.
2. **Проектирование:** Разделите карту на запад, центр и восток. Определите логику расстановки баррикад и КПП.
3. **Реализация Data-слоя:** Добавьте новых уникальных NPC (`wild_brigadier`, `liquidator_captain`) в `src/data/npc.ts`. Зарегистрируйте квесты в `src/data/plot.ts`.
4. **Реализация Gen-слоя:** Создайте новый файл `outskirts_conflict.ts`. Напишите логику `assignOutskirtsTerritories()` и `spawnFactionLeaders()`.
5. **Интеграция:** Подключите `outskirts_conflict.ts` в основной генератор Окраины. Убедитесь, что NPC появляются ровно там, где должны.
6. **Реализация Systems-слоя:** Проверьте систему `territory.ts`. Убедитесь, что назначенные фракциям комнаты корректно сохраняются в стейт этажа.
7. **Тестирование:** Сгенерируйте этаж 5 раз и проверьте через `npm run test:generation`, что базы обеих фракций успешно размещаются.
8. **Валидация типов:** Запустите `npm run typecheck`, чтобы убедиться, что контракты интерфейсов NPC и квестов не нарушены.
9. **Проверка работы:** Запустите локальный сервер (`npm run dev`) и визуально проверьте расстановку баз фракций.
10. **Коммит:** Закоммитить изменения (`git commit`) с подробным описанием добавления фракций и квестов.
11. **Pull Request:** Запушить ветку и открыть Pull Request. В комментариях описать логику разделения территории.
12. **Документация:** Задокументируйте архитектурные решения в файле PR.

---
*Ожидается, что вы завершите задачу, создав живую, дышащую экосистему на этаже Окраины, и оставите проект в компилируемом состоянии.*
