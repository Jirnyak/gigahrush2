# План Агента: marx_52
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №52.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Оптимизация: Дебаг-оверлей макро-целей.**

### Контекст задачи
Для балансировки глобального A-Life и войн фракций, разработчикам необходим визуальный инструментарий. Нужно добавить опциональный дебаг-оверлей на глобальную карту (или миникарту), который рисует стрелки от баз фракций к текущим `targetZone` их активных `FactionMacroGoal`. Это сугубо render/debug фича, она не влияет на симуляцию.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/systems/debug.ts` (или `debug_cheats.ts`)
Добавьте поддержку новой дебаг-команды.
```typescript
// Stub for src/systems/debug.ts
export const DEBUG_FLAGS = {
    // ... existing flags ...
    SHOW_MACRO_GOALS: false
};

export function handleDebugCommand(cmd: string) {
    if (cmd === '/macro_goals') {
        DEBUG_FLAGS.SHOW_MACRO_GOALS = !DEBUG_FLAGS.SHOW_MACRO_GOALS;
        publishEvent({ type: 'debug_log', message: `Macro goals overlay: ${DEBUG_FLAGS.SHOW_MACRO_GOALS}` });
        return true;
    }
    // ...
}
```

#### 2. Рисование оверлея в `src/render/map_ui.ts` (или `map_renderer.ts`)
В функции отрисовки глобальной карты добавьте слой дебага, который будет активен только если `DEBUG_FLAGS.SHOW_MACRO_GOALS === true`.

```typescript
// Stub for src/render/map_ui.ts
import { DEBUG_FLAGS } from '../systems/debug';
import { getFactionColor } from '../data/factions';

export function drawDebugMacroGoals(ctx: CanvasRenderingContext2D, world: World, mapScale: number, offsetX: number, offsetY: number) {
    if (!DEBUG_FLAGS.SHOW_MACRO_GOALS || !world.factionMacroGoals) return;

    for (const goal of world.factionMacroGoals) {
        if (goal.status !== 'active') continue;

        const hqZone = world.zones.find(z => z.id === goal.originZoneId);
        const targetZone = world.zones.find(z => z.id === goal.targetZoneId);
        
        if (!hqZone || !targetZone) continue;

        const startX = (hqZone.centroidX * mapScale) + offsetX;
        const startY = (hqZone.centroidY * mapScale) + offsetY;
        const endX = (targetZone.centroidX * mapScale) + offsetX;
        const endY = (targetZone.centroidY * mapScale) + offsetY;

        const color = getFactionColor(goal.factionId) || 'magenta';

        // Draw line
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]); // Dashed line for goals
        ctx.stroke();

        // Draw arrowhead at endX, endY
        drawArrowhead(ctx, startX, startY, endX, endY, color);
        ctx.setLineDash([]); // Reset
    }
}

function drawArrowhead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
    // Basic math for arrow
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(angle - Math.PI / 6), y2 - 10 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - 10 * Math.cos(angle + Math.PI / 6), y2 - 10 * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(x2, y2);
    ctx.fillStyle = color;
    ctx.fill();
}
```

#### 3. Связь данных
- Функция `getFactionColor` должна быть экспортирована из `src/data/factions.ts`. Если её нет, добавьте базовую логику (например, возвращать hex цвет, определенный в JSON/структуре фракции).
- Координаты `centroidX` и `centroidY` должны присутствовать в описании зон (или вычисляться как среднее между `minX`, `maxX` и т.д.).

#### 4. Тестирование и валидация
- Убедиться, что вызов `/macro_goals` в консоли игры (терминале) включает флаг без крашей.
- При включенном флаге карта не должна сильно проседать по FPS (Canvas stroke operations достаточно быстры, но проверяйте типы).
- Запустить `npm run check:readonly` (typescript typecheck).

## Ваши шаги:
1. Изучить `AGENTS.md`, `map_ui.ts`, `debug.ts`.
2. Добавить флаг `SHOW_MACRO_GOALS` и команду `/macro_goals`.
3. Реализовать `drawDebugMacroGoals` и интегрировать её в конец render loop карты (поверх всех слоев).
4. Проверить доступность `centroidX/Y` у зон, при необходимости вычислять на лету (с кэшированием!).
5. Запустить все проверки типов и сборку `npm run build`.
6. Сделать `git commit -m "feat(debug): add map overlay for faction macro goals"` и создать PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
