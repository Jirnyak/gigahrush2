# План Агента: marx_63
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №63.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Синематика: Набор массовки (извлечение НПЦ из популяции для сцен).**



### Контекст задачи
Механика извлечения НПЦ из A-Life популяции для массовки в синематиках.

### Конкретные файлы и паттерны
- **`src/systems/alife.ts`**: A-Life pool хранит всех НПЦ. При синематике нужно «выхватить» 3-5 НПЦ из текущего materialized floor для массовки.
- **Функция**: `selectCinematicExtras(world, count, nearX, nearY, radius): Entity[]` — выбрать живых НПЦ рядом с камерой.
- **`src/systems/entity_index.ts`**: Broadphase для поиска ближайших. ОБЯЗАТЕЛЬНО через broadphase, не full scan.
- **Они не телепортируются**: extras продолжают жить обычной AI жизнью. Камера просто пролетает мимо.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — реализовать механизм "найма/извлечения" (extraction) NPC из системы A-Life для использования их в катсценах, обеспечивая сохранение их идентичности.

#### 1. Модель Данных Actor (Слой `data/`)
Определите, как NPC помечается как "актер катсцены".

```typescript
// В src/data/alife_types.ts или src/core/entity.ts
export enum NpcRole {
    WANDERER = 'WANDERER',
    TRADER = 'TRADER',
    CINEMATIC_ACTOR = 'CINEMATIC_ACTOR'
}

export interface CinematicState {
    originalRole: NpcRole;
    originalX: number;
    originalY: number;
    sceneId: string;
}

// Расширение Entity
export interface Entity {
    // ...
    cinematicState?: CinematicState;
}
```

#### 2. Логика Извлечения (Слой `systems/`)
Реализуйте функционал для временного перехвата контроля над NPC системой катсцен, отключая обычный ИИ.

```typescript
// В src/systems/cinematic_actors.ts
import { World, Entity } from '../core/types';
import { NpcRole } from '../data/alife_types';

export function extractNpcForScene(world: World, npcId: string, sceneId: string, targetX: number, targetY: number): boolean {
    const npc = world.entities.find(e => e.id === npcId);
    if (!npc) return false;

    // Сохраняем оригинальное состояние
    npc.cinematicState = {
        originalRole: npc.role || NpcRole.WANDERER,
        originalX: npc.x,
        originalY: npc.y,
        sceneId: sceneId
    };

    // Отключаем стандартный AI
    npc.role = NpcRole.CINEMATIC_ACTOR;
    
    // Телепортируем или назначаем путь к точке сцены
    npc.x = targetX;
    npc.y = targetY;
    
    return true;
}
```

#### 3. Возврат в A-Life после сцены
Когда катсцена заканчивается, актеры должны вернуться к своим обычным делам.

```typescript
// В src/systems/cinematic_actors.ts
export function releaseNpcFromScene(world: World, npcId: string) {
    const npc = world.entities.find(e => e.id === npcId);
    if (!npc || !npc.cinematicState) return;

    // Возвращаем роль
    npc.role = npc.cinematicState.originalRole;
    
    // Опционально: отправить обратно на исходную позицию или оставить где стоит
    npc.cinematicState = undefined;
}

export function releaseAllSceneActors(world: World, sceneId: string) {
    world.entities.forEach(npc => {
        if (npc.cinematicState?.sceneId === sceneId) {
            releaseNpcFromScene(world, npc.id);
        }
    });
}
```

#### 4. Интеграция с ИИ (Слой `systems/`)
Обычный ИИ (patrol, wander, combat) должен игнорировать NPC, если у них установлена роль `CINEMATIC_ACTOR`.

```typescript
// В src/systems/ai_behavior.ts
export function updateAi(world: World, dt: number) {
    for (const entity of world.entities) {
        if (entity.role === NpcRole.CINEMATIC_ACTOR) {
            // Управляется только через cinematic_director.ts, обычный ИИ пропускает
            continue;
        }
        
        // ... обычный ИИ
    }
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Расширить `Entity` и определить `NpcRole.CINEMATIC_ACTOR` с `CinematicState`.
2. **Извлечение:** Написать `extractNpcForScene`, обеспечивающую сохранение старого стейта.
3. **Освобождение:** Написать `releaseNpcFromScene` и `releaseAllSceneActors`.
4. **Блокировка ИИ:** Добавить guard clauses в системы ИИ, чтобы они не трогали актеров (не заставляли их идти патрулировать или атаковать вне сценария).
5. **A-Life Интеграция:** Убедиться, что A-Life корректно сохраняет статус актеров, если во время сцены происходит сохранение игры (serialize/deserialize).

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run test:unit`.
* Проверьте логику: напишите тест, где NPC "нанимается", его AI tick не меняет его координаты, а после "увольнения" AI снова работает.
* Формат коммита: `feat(cinematic): implement NPC extraction and release system for directed scenes`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
