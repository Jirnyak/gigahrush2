# План Агента: marx_28
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №28.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**ИИ: Монстры выламывают двери. Научить ИИ наносить урон дверям вместо их элегантного открытия.**

### Контекст задачи
В настоящее время все сущности (включая безмозглых монстров) просто открывают двери, используя функцию `openDoor()`, словно у них есть руки и манеры. Чтобы создать чувство угрозы и хоррора, агрессивные безрукие монстры (или брутальные мутанты) должны выламывать закрытые двери. Это замедляет их, но оставляет дверь навсегда сломанной (изменение состояния мира).

### Конкретные файлы и паттерны
- **`src/systems/ai/monster.ts`**: Логика поведения монстров при столкновении с преградой.
- **`src/systems/ai/pathfinding.ts`**: Учет сломанных/закрытых дверей при поиске пути.
- **`src/systems/interactions.ts`**: Вызов `damageDoor()`, добавленный в задаче marx_27.
- **НПЦ**: Обычные НПЦ (`EntityType.NPC`) продолжают открывать двери нормально.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Systems (Поведение ИИ) - `src/systems/ai/monster.ts`
Вместо автоматического открытия двери, монстр атакует её, используя систему ближнего боя.
```typescript
// Stub for AI door interaction
import { damageDoor } from '../interactions';

export function handleMonsterPathObstacle(monster: Entity, cellIdx: number) {
  const door = getDoorAt(cellIdx);
  
  if (door && door.state !== DoorState.OPEN && door.state !== DoorState.BROKEN) {
    // The monster is blocked by a door.
    if (canMonsterBreakDoor(monster.kind, door.material)) {
      // Apply melee damage based on monster stats.
      const damage = monster.stats.meleeDmg || 10;
      
      // Call the interaction system to apply damage
      damageDoor(door, damage);
      
      // Monster loses its action points doing this
      monster.actionPoints -= 1.0;
    } else {
      // Monster cannot break this door (e.g. slime vs hermetic). 
      // Repath needed or give up.
      monster.path = null;
    }
  }
}
```

#### 2. Слой Systems (Pathfinding) - `src/systems/ai/pathfinding.ts`
Навигационное дерево должно считать закрытые двери проходимыми (но с высоким penalty cost), чтобы монстр строил путь через них, зная, что сможет их сломать. Иначе он просто будет стоять.
```typescript
// Stub for A* cost heuristic
export function getCellCostForMonster(monsterKind: MonsterKind, cellIdx: number): number {
  const cell = world.cells[cellIdx];
  if (cell.type === CellType.WALL) return Infinity;
  
  const door = getDoorAt(cellIdx);
  if (door && (door.state === DoorState.CLOSED || door.state === DoorState.LOCKED)) {
    if (!canMonsterBreakDoor(monsterKind, door.material)) {
      return Infinity; // Impassable for this monster
    }
    // High cost, but not Infinity. The monster will path through it and break it.
    // Cost scales with HP, so it prefers open routes if available.
    return 1 + (door.hp / 10); 
  }
  
  return 1; // Normal floor
}
```

#### 3. Слой Data (Характеристики монстров) - `src/data/monster_ecology.ts`
Определите, какие монстры умеют ломать двери, а какие — нет. Эта логика должна опираться на конфиги, а не на огромный `switch/case`.
```typescript
// Stub for monster ecology / logic
export function canMonsterBreakDoor(monsterKind: MonsterKind, material: DoorMaterial): boolean {
  const def = MONSTER_DEFS[monsterKind];
  
  // If monster lacks physical attack, it can't break doors
  if (!def || def.meleeDmg === 0) return false;
  
  // Example rules:
  if (def.tags.includes('huge')) return true; // Breaks anything
  if (material === DoorMaterial.HERMETIC) return false; // Normal monsters can't break bunkers
  if (material === DoorMaterial.METAL && def.meleeDmg < 20) return false; // Weak monsters can't break metal
  
  return true; // Standard zombies break wood
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Изучите, как в данный момент работает ИИ `src/systems/ai/tactics.ts` или `monster.ts` при обработке следующего шага на пути (path).
2. **Проектирование Data-слоя:** Добавьте новые теги или свойства в определения монстров (`MONSTER_DEFS`), чтобы указывать их способность к разрушению.
3. **Реализация Systems-слоя (Навигация):** Обновите эвристику A* или алгоритма поиска пути. Монстры должны видеть сквозь двери, которые они могут сломать, но добавлять штраф к пути (cost penalty).
4. **Реализация Systems-слоя (Атака):** Перехватите момент, когда ИИ собирается шагнуть на клетку с дверью. Если это монстр — отмените `openDoor()` и вызовите `damageDoor()`.
5. **Аудиовизуальный фидбек:** ИИ бьющий в дверь издает громкий звук (`noise`), который привлекает игрока и других сущностей. Используйте `publishEvent`.
6. **Тестирование:** Создайте модульный тест в `tests/ai.test.ts`, где монстр отделен от игрока деревянной дверью. Убедитесь, что монстр атакует дверь несколько ходов подряд.
7. **Проверка типов:** `npm run typecheck`.
8. **Коммит:** Закоммитьте `feat(ai): aggressive monsters break doors instead of opening`.
9. **Pull Request:** Откройте PR и укажите, как изменение стоимости пути повлияло на производительность (если повлияло).

---
*Ожидается, что вы завершите задачу, сделав поведение монстров более естественным и угрожающим, оставив проект в компилируемом состоянии.*
