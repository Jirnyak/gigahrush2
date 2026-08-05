# План Агента: marx_65
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №65.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Синематика: Авто-триггер сцен при посещении новых этажей.**



### Контекст задачи
Автоматический запуск кат-сцены при первом посещении ключевого этажа.

### Конкретные файлы и паттерны
- **`src/systems/floor_memory.ts`**: Хранит visited floor keys. При первом посещении — `!floorMemory.has(key)`.
- **`src/main.ts`**: В `switchFloor()` после загрузки этажа — проверить: «первый ли визит?» Если да и этаж ключевой — запустить cinematic.
- **Ключевые этажи**: LIVING (старт), `liquidator_base`, `horror_floor`, `cave_floor`, HELL, VOID.
- **Синематик**: Вызов `startCinematicCamera()` (от marx_80) с preset waypoints для этого этажа.
- **Skip**: Любая клавиша — отмена синематика, возврат в `'player'` mode.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — реализовать механизм авто-триггера кинематографических или сюжетных сцен при первом входе на новый этаж/комнату, используя зоны (triggers).

#### 1. Модель данных Триггера (Слой `data/` и `core/`)
Определите пространственную зону (AABB), при пересечении которой срабатывает событие.

```typescript
// В src/core/types.ts или src/data/triggers.ts
export interface TriggerZone {
    id: string;
    rect: { x: number, y: number, width: number, height: number };
    sceneId: string;
    fired: boolean; // Одноразовый ли триггер
    floorZ?: number; // На каком этаже триггер актуален
}

export interface World {
    // ...
    triggers: TriggerZone[];
}
```

#### 2. Проверка пересечения (Слой `systems/`)
Реализуйте систему, которая проверяет позицию игрока каждый кадр и сверяет с активными триггерами.

```typescript
// В src/systems/trigger_system.ts
import { World, Entity } from '../core/types';

export function updateTriggers(world: World) {
    const player = world.entities.find(e => e.id === world.playerId);
    if (!player) return;

    for (const trigger of world.triggers) {
        if (trigger.fired) continue;
        if (trigger.floorZ !== undefined && trigger.floorZ !== world.z) continue;

        // AABB Collision check
        if (player.x >= trigger.rect.x && player.x <= trigger.rect.x + trigger.rect.width &&
            player.y >= trigger.rect.y && player.y <= trigger.rect.y + trigger.rect.height) {
            
            trigger.fired = true;
            
            // Генерируем событие старта сцены
            publishEvent({ 
                type: 'SCENE_TRIGGERED', 
                sceneId: trigger.sceneId 
            });
        }
    }
}
```

#### 3. Генерация триггеров на этаже (Слой `gen/`)
При создании этажа, генератор должен уметь расставлять триггеры, например, у выхода из лифта.

```typescript
// В src/gen/design_floors/floor_generator.ts
export function spawnElevatorExitTrigger(world: World, elevatorX: number, elevatorY: number, sceneId: string) {
    world.triggers.push({
        id: `trig_elev_${sceneId}`,
        rect: {
            x: elevatorX - 2,
            y: elevatorY - 2,
            width: 4,
            height: 4
        },
        sceneId: sceneId,
        fired: false,
        floorZ: world.z
    });
}
```

#### 4. Сохранение состояния триггеров (Слой `systems/`)
Важно, чтобы после загрузки игры одноразовые сцены не повторялись.

```typescript
// В src/systems/save_runtime.ts
// Добавить массив firedTriggers в полезную нагрузку сохранения
export function serializeSaveData(world: World): object {
    return {
        // ...
        firedTriggers: world.triggers.filter(t => t.fired).map(t => t.id)
    };
}

export function applySaveData(world: World, data: any) {
    // ...
    if (data.firedTriggers) {
        world.triggers.forEach(t => {
            if (data.firedTriggers.includes(t.id)) t.fired = true;
        });
    }
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Определить структуру `TriggerZone` и добавить массив в `World`.
2. **Логика:** Написать `updateTriggers`, проверяющую вхождение `player` в `AABB` триггера.
3. **Генерация:** Добавить хелперы для спавна триггеров привязкой к координатам (например, около лифтов).
4. **События:** Триггер должен пушить событие `SCENE_TRIGGERED`, которое будет подхвачено `cinematic_director.ts`.
5. **Save/Load:** Обязательно реализовать сериализацию `fired` флагов по ID, чтобы триггеры не перезапускались.

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run test:unit`.
* Проверьте, что триггер не срабатывает дважды на одном этаже (если `fired: true`).
* Формат коммита: `feat(gen): add spatial trigger zones for cinematic auto-start with save support`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
