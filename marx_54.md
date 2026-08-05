# План Агента: marx_54
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №54.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Экипировка: Противогазы (защита от тумана Самосбора).**

### Контекст задачи
Без противогаза Самосбор наносит постоянный урон и ослепляет. Наличие экипированного противогаза (и расходных фильтров) спасает жизнь и позволяет свободно передвигаться во время активной фазы. НПЦ также должны проверять наличие противогаза в инвентаре, чтобы не умирать сразу. 

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/data/items.ts`
Добавьте определение противогаза и фильтров:
```typescript
// Stub for src/data/items.ts
export const ITEMS: Record<string, ItemDef> = {
    // ... existing items ...
    'gas_mask': {
        id: 'gas_mask',
        name: 'Противогаз',
        type: 'equipment', // или 'tool', зависит от схемы экипировки
        slot: 'head',
        value: 150,
        durabilityMax: 100 // Опционально, если износ идет по самому противогазу
    },
    'gas_filter': {
        id: 'gas_filter',
        name: 'Угольный фильтр',
        type: 'consumable',
        value: 30,
        stackable: true,
        maxStack: 5
    }
};
```

#### 2. Интеграция урона в `src/systems/samosbor.ts` (или `combat.ts`)
Во время активной фазы самосбора (`world.samosbor.isActive === true`), все акторы (игрок и NPCs) на незащищенных клетках (вне гермодверей) получают урон.
```typescript
// Stub for src/systems/samosbor.ts
import { applyDamage } from './combat';

export function processSamosborDamage(world: World, dt: number) {
    if (!world.samosbor.isActive) return;

    // Таймер тика (каждые 5 секунд)
    world.samosbor.damageTimer = (world.samosbor.damageTimer || 0) + dt;
    if (world.samosbor.damageTimer >= 5.0) {
        world.samosbor.damageTimer = 0;
        
        // Process Player
        if (!isActorProtected(world, world.player)) {
            applySamosborEffect(world, world.player);
        }

        // Process active NPCs on the floor
        for (const npc of world.entities.filter(e => e.type === 'npc')) {
            if (!isActorProtected(world, npc)) {
                applySamosborEffect(world, npc);
            }
        }
    }
}

function isActorProtected(world: World, actor: Entity): boolean {
    // 1. Проверка на гермозону/убежище (protected cell)
    const cell = world.getCell(Math.floor(actor.x), Math.floor(actor.y));
    if (cell.tags && cell.tags.includes('samosbor_shelter')) return true;

    // 2. Проверка инвентаря
    if (actor.equipment && actor.equipment.head === 'gas_mask') {
        // Уменьшаем фильтр/durability
        return consumeFilterOrDurability(actor);
    }
    
    return false;
}

function applySamosborEffect(world: World, actor: Entity) {
    applyDamage(actor, 1, 'samosbor_toxic'); 
    // Если это игрок, можно вызвать publishEvent для UI "Вы задыхаетесь!"
}

function consumeFilterOrDurability(actor: Entity): boolean {
    // Условная логика: тратим 1 заряд фильтра или durability
    if (actor.inventory.has('gas_filter')) {
        actor.inventory.consume('gas_filter', 1);
        return true;
    }
    // Если нет фильтров, противогаз бесполезен
    return false;
}
```

#### 3. AI Логика НПЦ (A-Life)
В `src/systems/ai.ts` (или `faction_ai.ts`) при фазе warning НПЦ должны панически искать убежище ИЛИ, если у них есть противогаз, они могут продолжать патруль (с пониженным FOV). Это делает мир более живым. Проверьте `npc.equipment.head === 'gas_mask'`.

#### 4. Взаимодействие с рендером
Задача marx_53 уже внедряет множитель `0.5` на плотность тумана, если у игрока экипирован противогаз. Убедитесь, что стейт `actor.equipment.head === 'gas_mask'` прозрачно доступен рендереру без жесткой зависимости.

#### 5. Тестирование и валидация
- Добавьте unit-тесты: `test('samosbor damage ignores actor with gas mask and filters')`.
- Убедитесь, что фильтры корректно тратятся, а урон начинается, как только фильтры заканчиваются.
- Проверьте компиляцию: `npm run typecheck`.

## Ваши шаги:
1. Прочитать `items.ts`, `samosbor.ts`, `combat.ts`.
2. Внедрить дефы `gas_mask` и `gas_filter`.
3. Добавить системный тик урона `processSamosborDamage` внутри активной фазы.
4. Настроить трату фильтров/прочности.
5. Запустить `npm run check:readonly` и юнит-тесты.
6. Сделать `git commit -m "feat(items): add gas mask mechanics and samosbor damage logic"` и оформить PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
