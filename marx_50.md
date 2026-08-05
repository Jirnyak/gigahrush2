# План Агента: marx_50
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №50.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**А-Лайф: Расширение инвентаря мобов (гулям/мутантам давать тех. лут).**

### Контекст задачи
Дать мобам (гулям, мутантам) шанс нести технический или биологический лут. Текущие мобы имеют лишь заглушечный `lootHint`, но не оставляют реальных предметов после смерти. Требуется внедрить систему таблиц лута на базе экологии монстров и обеспечить физический спавн лута при смерти моба.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/data/monster_ecology.ts`
Добавьте поле `lootTable` в интерфейс `MonsterEcologyDef`. 
```typescript
// Stub for src/data/monster_ecology.ts
export interface MonsterLootEntry {
    itemDefId: string; // Идентификатор из items.ts
    chance: number; // Вероятность выпадения (0.0 - 1.0)
    minCount: number; // Минимальное количество
    maxCount: number; // Максимальное количество
}

export interface MonsterEcologyDef {
    kind: string; // e.g., 'ghoul', 'mutant'
    // ... existing fields ...
    lootTable?: MonsterLootEntry[];
}
```
Определите `lootTable` для основных видов монстров (гуль — rags, scrap; мутант — bio_mass, strange_meat и т.д.).

#### 2. Создание логики генерации в `src/systems/procedural_loot.ts`
Реализуйте функцию генерации лута на основе таблицы:
```typescript
// Stub for src/systems/procedural_loot.ts
import { MonsterKind } from '../entities/monster';
import { ItemDef } from '../data/items';
import { getMonsterEcology } from '../data/monster_ecology';

export interface GeneratedLoot {
    itemDefId: string;
    amount: number;
}

export function generateMonsterLoot(kind: MonsterKind): GeneratedLoot[] {
    const ecology = getMonsterEcology(kind);
    if (!ecology || !ecology.lootTable) return [];
    
    const results: GeneratedLoot[] = [];
    for (const entry of ecology.lootTable) {
        if (Math.random() <= entry.chance) {
            const amount = Math.floor(Math.random() * (entry.maxCount - entry.minCount + 1)) + entry.minCount;
            if (amount > 0) {
                results.push({ itemDefId: entry.itemDefId, amount });
            }
        }
    }
    
    // Hard cap at 3-5 items to avoid clutter
    return results.slice(0, 3);
}
```

#### 3. Модификация `src/systems/combat.ts` (или аналогичного обработчика смерти)
При смерти монстра (`entity.hp <= 0` и `entity.type === 'monster'`), необходимо вызывать функцию `generateMonsterLoot` и спавнить предметы в мире на координатах умершего монстра.
```typescript
// Stub for spawning loot in combat/death handler
import { generateMonsterLoot } from './procedural_loot';
import { spawnItemOnFloor } from './inventory'; // Условный импорт

function handleMonsterDeath(world: World, monster: Entity) {
    const lootList = generateMonsterLoot(monster.kind);
    for (const loot of lootList) {
        // Убедитесь, что spawnItemOnFloor (или эквивалент) создает реальную сущность типа 'item' 
        // с корректным itemDefId и amount, и помещает её на (monster.x, monster.y)
        spawnItemOnFloor(world, loot.itemDefId, loot.amount, monster.x, monster.y);
    }
}
```

#### 4. Доработка системы инвентаря/сущностей
- Убедитесь, что сгенерированные сущности `item` могут быть подобраны игроком через систему взаимодействия (interaction - клавиша E). 
- Никакого нового сложного UI для дропа делать не нужно, предметы просто должны появляться как Floor Items.

#### 5. Тестирование и валидация
- Добавьте unit-тесты для `generateMonsterLoot` (проверка вероятностей и лимитов).
- В `npm run typecheck` не должно быть ошибок.
- Убедиться, что при убийстве 10 гулей в мире появляются ресурсы и их можно подобрать.

## Ваши шаги:
1. Прочитать `AGENTS.md`, `architecture.md`, `systems/combat.ts`, `data/monster_ecology.ts`.
2. Внедрить интерфейс `MonsterLootEntry` и заполнить `lootTable` для 3-4 базовых монстров.
3. Реализовать `generateMonsterLoot` с учетом шансов и хард-капа (не более 3 предметов).
4. Настроить хук смерти монстра на спавн `item` entities.
5. Запустить `npm run check:readonly` и убедиться в отсутствии багов компиляции.
6. Сделать `git commit -m "feat(alife): add monster loot drop system based on ecology"` и оформить PR.
7. Обязательно задокументировать логику в `README.md` или `entities.md`, если требуется по контракту.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
