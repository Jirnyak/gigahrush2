# План Агента: marx_64
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №64.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Синематика: Диалоговые Баблы над головами НПЦ.**



### Контекст задачи
Speech bubbles: canvas overlay поверх 3D. World coords→screen space→rounded rect с хвостиком (белый фон, чёрный текст, max 2 строки × 20 символов). Fade in 0.3s, hold 3s, fade out 0.3s. Queue: по очереди (overlap нечитаемо). API: showSpeechBubble(entityId, text, duration). Для синематик (marx_80-84) и micro-goals (marx_61).

### Конкретные файлы и паттерны
- **`src/render/hud.ts`**: Canvas HUD. Добавьте систему рендера баблов:
  - Структура: `{ entityId: number, text: string, startTime: number, duration: number }`.
  - Массив (ring buffer, cap 8): `activeBubbles: SpeechBubble[]`.
  - Рендер: Canvas fillText + rounded rect background над позицией entity (project 3D→2D screen coords).
- **`src/systems/speech_router.ts`**: При генерации NPC речи — добавлять bubble через `showSpeechBubble(entityId, text, duration)`.
- **Позиция**: Используйте entity screen projection из raycaster (x, y на экране). Не рисуйте если entity за камерой.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — реализовать систему диалоговых баблов (bubbles) над головами NPC, чтобы отображать фразы непосредственно в игровом мире во время сцен, а не только в UI-логе.

#### 1. Модель данных Бабла (Слой `core/` и `systems/`)
Добавьте к сущностям компонент, который будет хранить активную фразу и таймер.

```typescript
// В src/core/entity.ts
export interface SpeechBubble {
    text: string;
    durationSec: number;
    elapsedSec: number;
    color?: string; // для выделения важных фраз
}

export interface Entity {
    // ...
    speechBubble?: SpeechBubble;
}
```

#### 2. Система управления Баблами (Слой `systems/`)
Таймеры баблов должны обновляться в `systems/`.

```typescript
// В src/systems/speech_system.ts
import { World } from '../core/types';

export function sayText(entity: Entity, text: string, durationSec: number = 3.0, color: string = '#FFFFFF') {
    entity.speechBubble = {
        text,
        durationSec,
        elapsedSec: 0,
        color
    };
    // Опционально публикуем событие для лога
    publishEvent({ type: 'LOG_MESSAGE', text: `${entity.name}: ${text}` });
}

export function updateSpeechBubbles(world: World, dt: number) {
    for (const entity of world.entities) {
        if (entity.speechBubble) {
            entity.speechBubble.elapsedSec += dt;
            if (entity.speechBubble.elapsedSec >= entity.speechBubble.durationSec) {
                // Время вышло, удаляем бабл
                entity.speechBubble = undefined;
            }
        }
    }
}
```

#### 3. Рендеринг (Слой `render/`)
Система рендеринга должна проецировать мировые координаты NPC на экран и рисовать canvas-текст поверх WebGL. Не используйте DOM-элементы для каждого бабла, чтобы избежать лагов.

```typescript
// В src/render/hud.ts или src/render/overlays.ts
export function renderSpeechBubbles(ctx: CanvasRenderingContext2D, world: World, camera: Camera) {
    ctx.textAlign = 'center';
    
    for (const entity of world.entities) {
        if (!entity.speechBubble) continue;
        
        // 1. Проекция 3D (или 2D world) координат в экранные
        const screenPos = worldToScreen(entity.x, entity.y, entity.z, camera);
        
        // Если NPC за камерой - не рисуем
        if (!screenPos.visible) continue;
        
        // Смещение вверх над головой
        const bubbleY = screenPos.y - 60; 
        
        const bubble = entity.speechBubble;
        
        // 2. Рисование фона бабла
        ctx.font = '14px sans-serif';
        const metrics = ctx.measureText(bubble.text);
        const padding = 6;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(
            screenPos.x - metrics.width/2 - padding, 
            bubbleY - 14 - padding, 
            metrics.width + padding*2, 
            14 + padding*2, 
            4
        );
        ctx.fill();
        
        // Рисование хвостика
        ctx.beginPath();
        ctx.moveTo(screenPos.x - 5, bubbleY + padding);
        ctx.lineTo(screenPos.x + 5, bubbleY + padding);
        ctx.lineTo(screenPos.x, bubbleY + padding + 10);
        ctx.fill();
        
        // 3. Рисование текста
        ctx.fillStyle = bubble.color || '#FFF';
        ctx.fillText(bubble.text, screenPos.x, bubbleY);
    }
}
```

#### 4. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Добавить `speechBubble` в интерфейс `Entity`.
2. **Логика:** Написать функцию `sayText()` и систему `updateSpeechBubbles(dt)`, которая удаляет просроченные баблы.
3. **Проекция:** В рендере использовать матрицу камеры для получения экранных координат (`worldToScreen`). Учесть Z-высоту (над головой).
4. **Отрисовка:** Написать логику `renderSpeechBubbles` с использованием Canvas2D API: фон (полупрозрачный черный с закруглениями), треугольный хвостик, центрированный текст.
5. **Тестирование:** В `debug_cheats.ts` добавьте хоткей, заставляющий ближайшего NPC сказать случайную фразу, и визуально проверьте отображение и исчезновение.

#### 5. Требования к верификации, коммиту и PR
* Осуществите локальный прогон `npm run check:full`.
* Избегайте генерации DOM-узлов (`document.createElement('div')`) для баблов — это нарушает Iron Law оптимизации мобильного рендера. Только Canvas API поверх WebGL.
* Формат коммита: `feat(ui): implement world-space canvas speech bubbles for entities`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
