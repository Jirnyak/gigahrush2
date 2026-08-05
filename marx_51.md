# План Агента: marx_51
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №51.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Оптимизация: Лимиты на спавн групп (A-Life) для производительности.**

### Контекст задачи
В системе фракций (которая создает `FactionMacroGoal` для рейдов, штурмов или защиты) может произойти переполнение при длительной игре, что приведет к созданию сотен групп и полному падению FPS. Необходимо внедрить жесткие лимиты на количество активных макро-целей и групп, а также логику Garbage Collection для завершенных или застрявших целей.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Обновление `src/data/entity_limits.ts`
Добавьте константы лимитов для макро-уровня фракций.
```typescript
// Stub for src/data/entity_limits.ts
export const LIMITS = {
    // ... existing limits ...
    MAX_FACTION_MACRO_GOALS: 16,
    MAX_ASSAULT_GROUPS_PER_FACTION: 3,
    MAX_ACTIVE_FACTION_ACTORS: 128
};
```

#### 2. Модификация `src/systems/factions.ts` (или `faction_ai.ts`)
В функции принятия решений фракцией (когда фракция пытается создать новую макро-цель, например, штурм соседней зоны), добавьте проверку лимитов.
```typescript
// Stub for faction decision making
import { LIMITS } from '../data/entity_limits';

export function tryCreateMacroGoal(world: World, factionId: string, goalType: string, targetZone: string): boolean {
    const activeGoals = world.factionMacroGoals || [];
    
    // Глобальный лимит
    if (activeGoals.length >= LIMITS.MAX_FACTION_MACRO_GOALS) {
        return false;
    }
    
    // Лимит на фракцию
    const factionGoals = activeGoals.filter(g => g.factionId === factionId && g.type === 'assault');
    if (factionGoals.length >= LIMITS.MAX_ASSAULT_GROUPS_PER_FACTION) {
        return false;
    }
    
    // Создаем цель
    // ... logic ...
    return true;
}
```

#### 3. Garbage Collection макро-целей
Реализуйте функцию `gcFactionMacroGoals`, которая будет вызываться редко (раз в 60 секунд реального времени) и удалять:
- Цели со статусом `completed` или `failed`.
- Цели, которые висят дольше `MAX_GOAL_LIFETIME` (например, 1 час игрового времени), и прогресс по ним застопорился.
- Если цель удаляется, все привязанные к ней NPC-солдаты должны возвращаться к стандартному патрулированию или получать команду "возврат на базу".

```typescript
// Stub for GC
export function gcFactionMacroGoals(world: World, currentTime: number) {
    if (!world.factionMacroGoals) return;
    
    const validGoals = [];
    for (const goal of world.factionMacroGoals) {
        if (goal.status === 'completed' || goal.status === 'failed') continue;
        if (currentTime - goal.createdAt > 3600000 /* 1 hour ms */) {
            // Force fail stagnant goal
            abortFactionGoal(world, goal);
            continue;
        }
        validGoals.push(goal);
    }
    
    world.factionMacroGoals = validGoals;
}
```

#### 4. Cadence (Частота оценки)
Фракции не должны оценивать создание новых макро-целей каждый кадр. Оценка должна происходить с использованием `Cadence`: не чаще 1 раза в 60 секунд для каждой фракции.

#### 5. Тестирование и валидация
- Добавьте unit-тесты, проверяющие, что при попытке создать 20 целей, система обрезает их по лимиту `MAX_FACTION_MACRO_GOALS`.
- Убедитесь, что функция GC успешно очищает массив `world.factionMacroGoals` и не ломает ссылки на существующих NPC.

## Ваши шаги:
1. Изучить `AGENTS.md`, `architecture.md`, `entity_limits.ts`, `factions.ts`.
2. Внедрить константы лимитов в `entity_limits.ts`.
3. Добавить проверки перед спавном `FactionMacroGoal`.
4. Реализовать функцию `gcFactionMacroGoals` и поставить ее на редкий таймер (cadence).
5. Запустить `npm run check:readonly` и юнит-тесты.
6. Сделать `git commit -m "perf(factions): implement macro goal limits and gc"` и создать PR.
7. Документировать архитектуру сборщика мусора фракций, если требуется по контракту.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
