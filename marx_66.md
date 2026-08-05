# План Агента: marx_66
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №66.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Сюжет: Интеграция 'Злодея и Героя' в синематики.**



### Контекст задачи
Сцены преследования «Злодея» «Героем» с диалогами-баблами.

### Конкретные файлы и паттерны
- **`src/data/plot.ts`**: Злодей и Герой (от marx_7) зарегистрированы. Используйте их `plotNpcId`.
- **Синематик сцена**: При посещении определённых этажей (Министерство, Коллекторы) — если оба НПЦ материализованы — камера показывает:
  1. Злодей бежит по коридору (его AI intent = flee).
  2. Герой преследует (AI intent = hunt).
  3. Над обоими — баблы с репликами (marx_82).
- **Интеграция**: Используйте `startCinematicCamera()` с waypoints, следующими за злодеем.
- **Скрипт**: Не скриптуйте точные координаты! Используйте entity positions в реальном времени.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — интеграция ключевых сюжетных NPC ("Злодей" и "Герой") в кинематографическую систему, создание их пресетов данных и привязка к сценам.

#### 1. Определение данных Персонажей (Слой `data/`)
Создайте константы и пресеты для уникальных персонажей сюжета, чтобы их нельзя было спутать с рандомными NPC.

```typescript
// В src/data/plot_characters.ts
import { NpcTemplate } from './npc';

export const CHAR_HERO: NpcTemplate = {
    id: 'char_hero_artem',
    name: 'Артем (Герой)',
    sprite: 'hero_unique', // Требует уникального спрайта в атласе
    health: 200,
    faction: 'resistance',
    flags: ['IMMORTAL', 'PLOT_CRITICAL'],
    dialogId: 'hero_intro_dialog'
};

export const CHAR_VILLAIN: NpcTemplate = {
    id: 'char_villain_kombinat',
    name: 'Глава Комбината',
    sprite: 'villain_suit',
    health: 500,
    faction: 'kombinat',
    flags: ['IMMORTAL', 'PLOT_CRITICAL', 'HOSTILE_LATER']
};
```

#### 2. Генерация Уникальных Персонажей для Сцен (Слой `gen/`)
Функция спавна должна гарантировать, что дубликаты не создаются, если персонаж уже жив в A-Life.

```typescript
// В src/gen/plot_spawns.ts
export function spawnPlotCharacter(world: World, template: NpcTemplate, x: number, y: number): Entity {
    // Проверяем, не существует ли он уже (даже на другом этаже, если A-life глобальный)
    const existing = world.entities.find(e => e.plotId === template.id);
    if (existing) {
        // Телепортируем к сцене
        existing.x = x;
        existing.y = y;
        return existing;
    }
    
    // Иначе создаем нового
    const npc = createEntity(x, y);
    npc.plotId = template.id;
    npc.name = template.name;
    npc.hp = template.health;
    npc.role = NpcRole.CINEMATIC_ACTOR; // Изначально залочен для сцены
    world.entities.push(npc);
    return npc;
}
```

#### 3. Скрипт Сцены (Слой `systems/` или `data/scenes`)
Опишите конфигурацию конкретной сцены противостояния.

```typescript
// В src/data/scenes_manifest.ts
export const SCENE_CONFRONTATION_1 = {
    id: 'scene_confrontation_1',
    steps: [
        { type: 'CAMERA_MOVE', target: 'char_villain_kombinat', duration: 2.0 },
        { type: 'SPEECH', actor: 'char_villain_kombinat', text: 'Думал, сможешь остановить Самосбор? Глупец.' },
        { type: 'WAIT', duration: 3.0 },
        { type: 'CAMERA_MOVE', target: 'char_hero_artem', duration: 1.0 },
        { type: 'SPEECH', actor: 'char_hero_artem', text: 'Я хотя бы попытаюсь.' },
        { type: 'WAIT', duration: 2.0 },
        { type: 'RELEASE_ACTORS' },
        { type: 'CAMERA_RESET' }
    ]
};
```

#### 4. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Завести уникальные идентификаторы `CHAR_HERO` и `CHAR_VILLAIN` с флагами бессмертия для предотвращения поломки сюжета.
2. **Логика Спавна:** Написать логику `spawnPlotCharacter`, которая обрабатывает уникальность персонажа.
3. **Интеграция:** Создать хотя бы один пример `scenes_manifest.ts`, где Герой и Злодей ведут диалог, используя систему баблов и камеры из предыдущих задач.
4. **Бессмертие:** В `src/systems/combat.ts` добавить проверку: если у цели флаг `IMMORTAL` или `PLOT_CRITICAL`, урон сбрасывается в 0.

#### 5. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run test:unit`.
* Убедитесь, что сюжетные NPC не дублируются при многократном вызове сцены.
* Формат коммита: `feat(plot): add unique plot characters logic and confrontation scene definitions`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
