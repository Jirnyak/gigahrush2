# План Агента: marx_57
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №57.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Рендер: Крысы и Тараканы (миграция точек по клеткам пола).**

### Контекст задачи
Продолжение marx_56. Необходимо детализировать поведение двух типов critters: крыс и тараканов, в `src/render/critters.ts`. Они должны иметь разные паттерны движения. Крысы: жмутся к стенам, убегают от игрока. Тараканы: хаотичное блуждание, замирают. Если игрок наступает на таракана — хруст.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация поведения в `src/render/critters.ts`
Добавьте логику выбора следующей клетки в зависимости от типа.
```typescript
// Stub for pickNewCritterTarget
import { getCellType, CellType } from '../core/world';

export function pickNewCritterTarget(world: World, c: Critter, playerX: number, playerY: number) {
    if (Math.random() > 0.05) return;

    if (c.type === 'rat') {
        // Убегает от игрока
        const distToPlayer = Math.sqrt((c.x - playerX)**2 + (c.y - playerY)**2);
        if (distToPlayer < 3.0) {
            c.speed = 4.0;
            // Target = opposite direction from player
            c.targetX = c.x + Math.sign(c.x - playerX);
            c.targetY = c.y + Math.sign(c.y - playerY);
        } else {
            c.speed = 1.0; // Normal roaming
            // Ищет стены (bias to walls)
            const candidates = getAdjacentFloors(world, c.x, c.y);
            const nearWall = candidates.find(pos => hasAdjacentWall(world, pos.x, pos.y));
            if (nearWall) {
                c.targetX = nearWall.x;
                c.targetY = nearWall.y;
            } else {
                c.targetX = c.x + (Math.random() > 0.5 ? 1 : -1);
            }
        }
    } else if (c.type === 'roach') {
        // Таракан
        const distToPlayer = Math.sqrt((c.x - playerX)**2 + (c.y - playerY)**2);
        if (distToPlayer < 2.0 && Math.random() < 0.8) {
            c.speed = 0; // Freeze ("замирает при приближении")
        } else {
            c.speed = 1.5;
            // Random walk
            c.targetX = Math.round(c.x) + (Math.random() > 0.5 ? 1 : -1);
            c.targetY = Math.round(c.y) + (Math.random() > 0.5 ? 1 : -1);
        }
    }
}

function hasAdjacentWall(world: World, x: number, y: number): boolean {
    // Check offsets -1, 0, 1 for CellType.WALL
    return false; // Implement
}
```

#### 2. Интерактивность (Хруст)
Поскольку critters не существуют в `world.entities`, проверку "наступил" нужно делать прямо в `updateCritters` (или в `systems/interactions.ts` с доступом к рендер-пулу). 
```typescript
// Inside updateCritters loop
if (c.type === 'roach') {
    const distToPlayer = Math.sqrt((c.x - playerX)**2 + (c.y - playerY)**2);
    if (distToPlayer < 0.5) {
        c.active = false; // "Умер"
        publishEvent({ type: 'audio_play', soundId: 'roach_crunch', volume: 0.5 });
    }
}
```

#### 3. Визуализация
В `drawCritters` (`src/render/webgl.ts`):
- Крысы: 8x8 пикселей, цвет `rgb(60, 50, 50)`, высота `c.z = 0.05`.
- Тараканы: 4x4 пикселей, цвет `rgb(80, 40, 20)`, высота `c.z = 0.02`.
- Ограничьте отрисовку: если дистанция до камеры > 15 клеток, пропускаем draw call.

#### 4. Тестирование и валидация
- Убедиться, что `getAdjacentFloors` не вылезает за пределы карты (1024x1024).
- Проверить, что хруст издается только при плотном сближении `dist < 0.5`.
- Запустить `npm run typecheck` и `npm run check:readonly`.

## Ваши шаги:
1. Изучить `AGENTS.md`, `critters.ts` (из marx_56) и `webgl.ts`.
2. Реализовать `pickNewCritterTarget` с логикой для крыс и тараканов.
3. Внедрить механику хруста при `dist < 0.5`.
4. Настроить размеры и цвета билбордов в функции отрисовки.
5. Запустить проверки типов.
6. Сделать `git commit -m "feat(render): implement rat and roach specific roaming behaviors"` и создать PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
