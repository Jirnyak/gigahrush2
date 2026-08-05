# План Агента: marx_62
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №62.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Синематика: Система Камеры (src/systems/camera.ts). Сплайны и пролеты.**



### Контекст задачи
Расширить камеру: 1) CameraSpline — массив {x,y,angle,time} waypoints, Catmull-Rom. 2) playCinematic(spline, onComplete) — пролёт, блок управления. 3) Скорость адаптивна: медленнее у NPC, быстрее в пустоте. 4) fogDensity↓ при пролёте (видимость). 5) Skip: любая клавиша/тап. Есть TrailerCameraState и setFreeCamera() — расширяйте.

### Конкретные файлы и паттерны
- **`src/systems/camera.ts`**: УЖЕ есть `CameraMode: 'trailer'` и `TrailerCameraState` с path/node навигацией! Расширьте его:
  - Добавьте `CameraMode: 'cinematic'` (или используйте 'trailer').
  - Добавьте возможность задать ФИКСИРОВАННЫЙ path (массив waypoints), а не random.
  - Добавьте `lookAtTarget?: { x: number, y: number }` — камера всегда смотрит на цель.
- **API**: `startCinematicCamera(camera, waypoints: {x,y}[], lookAt?: {x,y}, speed?: number)`.
- **Завершение**: Когда path пройден — автоматически вернуть `'player'` mode через `followPlayerCamera()`.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — реализовать систему камеры, поддерживающую плавные пролеты (сплайны/интерполяцию) для катсцен, абстрагировав управление позицией от жесткой привязки к игроку.

#### 1. Модель данных Камеры (Слой `data/` и `core/`)
Определите структуру стейта камеры в `World`.

```typescript
// В файле src/core/camera.ts или src/core/world.ts
export enum CameraMode {
    FOLLOW_PLAYER = 'FOLLOW_PLAYER',
    FREE = 'FREE',
    CINEMATIC_SPLINE = 'CINEMATIC_SPLINE'
}

export interface CameraState {
    x: number;
    y: number;
    z: number;      // высота или zoom
    pitch: number;  // наклон
    yaw: number;    // поворот
    mode: CameraMode;
    targetEntityId?: string; // За кем следить
    // Данные для сплайна
    splinePoints?: Array<{x: number, y: number, time: number}>;
    splineProgress?: number;
    splineDuration?: number;
}
```

#### 2. Система Обновления Камеры (Слой `systems/`)
Реализуйте `src/systems/camera_system.ts`, которая будет вызываться каждый кадр (или tick) для вычисления текущей позиции.

```typescript
// В src/systems/camera_system.ts
import { World, CameraMode } from '../core/types';

export function updateCamera(world: World, dt: number) {
    const cam = world.camera;
    if (!cam) return;

    switch (cam.mode) {
        case CameraMode.FOLLOW_PLAYER:
            const player = world.entities.find(e => e.id === world.playerId);
            if (player) {
                // Плавное следование (lerp)
                const lerpFactor = 5.0 * dt;
                cam.x += (player.x - cam.x) * lerpFactor;
                cam.y += (player.y - cam.y) * lerpFactor;
            }
            break;

        case CameraMode.CINEMATIC_SPLINE:
            if (cam.splinePoints && cam.splineDuration) {
                cam.splineProgress = (cam.splineProgress || 0) + dt;
                const t = Math.min(cam.splineProgress / cam.splineDuration, 1.0);
                
                // Простая линейная интерполяция между массивом точек (или Catmull-Rom для кривых)
                const pos = evaluateSpline(cam.splinePoints, t);
                cam.x = pos.x;
                cam.y = pos.y;

                if (t >= 1.0) {
                    publishEvent({ type: 'CAMERA_SPLINE_FINISHED' });
                }
            }
            break;
            
        case CameraMode.FREE:
            // Управление из debug или скрипта
            break;
    }
}

// Вспомогательная функция (Catmull-Rom или линейная)
function evaluateSpline(points: Array<{x: number, y: number, time: number}>, t: number): {x: number, y: number} {
    // Реализация интерполяции
    // ...
    return points[0]; // заглушка
}
```

#### 3. API для Синематики (Слой `systems/` или `scripts/`)
Добавьте функции для запуска пролетов.

```typescript
// В src/systems/cinematic_director.ts
export function startCameraFlight(world: World, points: Array<{x: number, y: number}>, durationSec: number) {
    world.camera.mode = CameraMode.CINEMATIC_SPLINE;
    world.camera.splinePoints = points.map((p, i) => ({ ...p, time: i / (points.length - 1) }));
    world.camera.splineDuration = durationSec;
    world.camera.splineProgress = 0;
    
    // Отключить инпут игрока во время катсцены
    world.playerInputDisabled = true;
}
```

#### 4. Интеграция в Рендер (Слой `render/`)
Обновите WebGL рендерер, чтобы он использовал `world.camera`, а не хардкодил координаты игрока.

```typescript
// В src/render/webgl.ts
export function renderFrame(gl: WebGLRenderingContext, world: World) {
    const camX = world.camera.x;
    const camY = world.camera.y;
    // ... использовать camX/camY для установки ViewMatrix
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Определить структуру `CameraState` в ядре.
2. **Логика:** Создать `camera_system.ts` с поддержкой режимов (Follow, Spline). Реализовать математику интерполяции (Catmull-Rom spline для гладкости).
3. **Рендер:** Переключить WebGL с `player.x/y` на `world.camera.x/y`.
4. **События:** Реализовать отключение ввода игрока на время пролета и возврат камеры после завершения сплайна.
5. **Тестирование:** Написать юнит-тест `evaluateSpline`, чтобы убедиться, что точки правильно интерполируются по `t` от 0 до 1.

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run test:unit`.
* Формат коммита: `feat(camera): implement camera state machine and cinematic spline trajectories`.
* В описании PR: укажите математическую модель сплайна и как рендер теперь получает View Matrix.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
