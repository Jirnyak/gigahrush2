# План Агента: marx_56
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №56.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Рендер: Система Мелкой Живности (легковесный менеджер в src/render/).**

### Контекст задачи
Атмосфера Гигахруща требует наличия крыс, тараканов и мух. Однако делать их полноценными Entity с AI и коллизиями — самоубийство для производительности (Iron Law). Необходим сугубо визуальный менеджер мелкой живности (`critters.ts`), работающий только на стороне рендеринга. Они не сохраняются, не участвуют в геймплее, а просто рисуются поверх пола.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Создание `src/render/critters.ts`
Создайте легковесный менеджер для точек (critters) с использованием типизированных массивов (или pre-allocated flat objects) для обеспечения zero-allocation per frame.
```typescript
// Stub for src/render/critters.ts
export type CritterType = 'rat' | 'roach' | 'fly';

export interface Critter {
    active: boolean;
    type: CritterType;
    x: number;
    y: number;
    z: number; // height from floor
    targetX: number;
    targetY: number;
    speed: number;
    phase: number;
}

const MAX_CRITTERS = 64;
export const CRITTERS_POOL: Critter[] = Array.from({ length: MAX_CRITTERS }, () => ({
    active: false, type: 'roach', x: 0, y: 0, z: 0, targetX: 0, targetY: 0, speed: 1, phase: 0
}));

export function updateCritters(dt: number) {
    if (navigator.maxTouchPoints > 0) return; // Disable on mobile!

    for (let i = 0; i < MAX_CRITTERS; i++) {
        const c = CRITTERS_POOL[i];
        if (!c.active) continue;

        // Simple interpolation towards target
        const dx = c.targetX - c.x;
        const dy = c.targetY - c.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < 0.1) {
            // Reached target, pick new random adjacent target (migration)
            pickNewCritterTarget(c);
        } else {
            c.x += (dx / dist) * c.speed * dt;
            c.y += (dy / dist) * c.speed * dt;
        }
    }
}

function pickNewCritterTarget(c: Critter) {
    // 5% chance to move each tick, else stay
    if (Math.random() > 0.05) return;
    
    // Pick adjacent cell randomly (-1, 0, 1)
    const tx = Math.round(c.x) + (Math.random() > 0.5 ? 1 : -1);
    const ty = Math.round(c.y) + (Math.random() > 0.5 ? 1 : -1);
    c.targetX = tx;
    c.targetY = ty;
}
```

#### 2. Рендеринг (Интеграция в WebGL)
Живность должна рисоваться как 2D billboards (размером 2-4px). В `src/render/webgl.ts` добавьте проход после entity sprites, но перед HUD.
```typescript
// Stub for src/render/webgl.ts
import { CRITTERS_POOL } from './critters';

export function drawCritters(gl: WebGLRenderingContext, camera: Camera) {
    if (navigator.maxTouchPoints > 0) return;

    for (let i = 0; i < CRITTERS_POOL.length; i++) {
        const c = CRITTERS_POOL[i];
        if (!c.active) continue;
        
        // Draw tiny billboard at (c.x, c.y, c.z)
        // Use color based on type: roach (brown), rat (dark grey), fly (black)
    }
}
```

#### 3. Мобильная производительность
Обязательно добавьте проверку `navigator.maxTouchPoints > 0` (или используйте глобальный флаг мобильной платформы), чтобы вообще не запускать update и draw для живности на смартфонах.

#### 4. Тестирование и валидация
- Запустить `npm run check:full` для проверки интеграции рендера.
- Убедиться, что `MAX_CRITTERS` не превышает 64.
- Убедиться, что аллокации (создание новых объектов) внутри `updateCritters` сведены к нулю.

## Ваши шаги:
1. Изучить `AGENTS.md`, `optimization.md` и `webgl.ts`.
2. Создать новый файл `src/render/critters.ts` и определить пул `CRITTERS_POOL`.
3. Реализовать простой update цикл.
4. Добавить функцию `drawCritters` в рендер пайплайн.
5. Запустить сборку `npm run build` и typecheck.
6. Сделать `git commit -m "feat(render): add zero-allocation critter render system"` и создать PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
