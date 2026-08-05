# План Агента: marx_59
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №59.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Рендер: Динамичность Живности. Спавн только при наличии 'грязи' или трупов.**

### Контекст задачи
Сборка системы мелкой живности. Ранее вы написали менеджер (56) и поведение (57, 58). Теперь необходимо реализовать **спавнер**, который будет динамически активировать (`c.active = true`) элементы `CRITTERS_POOL` вокруг игрока (радиус 15) в зависимости от контекста клетки (грязь, темнота, кухня, труп).

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/render/critters.ts`
Добавьте функцию `spawnAmbientCritters`, которая вызывается раз в 1-2 секунды.
```typescript
// Stub for spawning logic
export function spawnAmbientCritters(world: World, playerX: number, playerY: number) {
    if (navigator.maxTouchPoints > 0) return;

    let activeRats = 0;
    let activeRoaches = 0;
    let activeFlies = 0;

    // Count currently active
    for (const c of CRITTERS_POOL) {
        if (c.active) {
            if (c.type === 'rat') activeRats++;
            else if (c.type === 'roach') activeRoaches++;
            else if (c.type === 'fly') activeFlies++;
            
            // Despawn if too far (> 20 cells)
            const dist = Math.sqrt((c.x - playerX)**2 + (c.y - playerY)**2);
            if (dist > 20) c.active = false;
        }
    }

    // Спавн Крыс (Max 5)
    if (activeRats < 5 && Math.random() < 0.2) {
        const p = findCellForRat(world, playerX, playerY);
        if (p) activateCritter('rat', p.x, p.y);
    }

    // Спавн Тараканов (Max 15)
    if (activeRoaches < 15 && Math.random() < 0.3) {
        const p = findCellForRoach(world, playerX, playerY);
        if (p) activateCritter('roach', p.x, p.y);
    }

    // Спавн Мух (Max 30) над трупами
    if (activeFlies < 30) {
        spawnFliesOverCorpses(world, playerX, playerY);
    }
}
```

#### 2. Логика поиска клеток (Context Aware)
Для соблюдения атмосферы крысы и тараканы не спавнятся в "чистых" пустых светлых коридорах:
- `findCellForRat`: ищет `RoomType.STORAGE` или `RoomType.KITCHEN` в радиусе 10-15 клеток. Если там темно (`world.light < 30`), шанс спавна 100%.
- `findCellForRoach`: ищет `RoomType.BATHROOM` или просто любую клетку с `light < 20`.
- `spawnFliesOverCorpses`: итерирует по `world.entities` в радиусе 15. Если `entity.hp <= 0` и `timeSinceDeath > 30s` (нужно проверять timestamp смерти или просто таймер гниения), спавнит 5 мух вокруг `targetX/targetY = entity.x/entity.y`.

#### 3. Активация из пула
Функция `activateCritter(type, x, y, targetX?, targetY?)` должна найти первый `!c.active` элемент в `CRITTERS_POOL` и инициализировать его параметры (phase, speed и т.д.).

#### 4. Производительность (Iron Law)
- `findCellForRat` и `findCellForRoach` НЕ должны сканировать весь этаж 1024x1024.
- Используйте случайную выборку: сгенерируйте 5-10 случайных координат вокруг игрока, проверьте условия `world.getCell()`, если подходит — возвращаем. Если нет — возвращаем `null`. (O(1) сложность).

#### 5. Тестирование и валидация
- Убедиться, что общее количество critters не превышает `MAX_CRITTERS` (64).
- Запустить игру и убедиться, что возле трупа появляются мухи.
- Выполнить `npm run check:readonly`.

## Ваши шаги:
1. Изучить `AGENTS.md`, `critters.ts` и структуру `world.light` / `world.rooms`.
2. Реализовать `spawnAmbientCritters` с вызовом на таймере (раз в секунду).
3. Написать O(1) random-sampling функции для поиска грязных/тёмных клеток.
4. Настроить спавн мух над мертвыми `entities`.
5. Запустить `npm run check:full`.
6. Сделать `git commit -m "feat(render): implement context-aware spawning for ambient critters"` и создать PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
