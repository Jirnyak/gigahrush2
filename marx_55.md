# План Агента: marx_55
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №55.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Самосбор (Мокрый): Спавн мобов 'Акулы'.**

### Контекст задачи
Разные варианты Самосбора несут разные угрозы. При Мокром самосборе (когда этаж частично затапливается `Cell.WATER`), в лужах и тумане должны спавниться специфичные мобы — Туманные Акулы (`FOG_SHARK`). Эти мобы уже описаны в базе, но не спавнятся системно.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/systems/samosbor.ts` (или спавнера `samosbor_director.ts`)
Во время активной фазы "Мокрого" самосбора, необходимо добавлять периодический спавн `FOG_SHARK` на затопленных клетках (`Cell.WATER`), недалеко от игрока, но за пределами FOV (Field of View).
```typescript
// Stub for src/systems/samosbor.ts
import { MonsterKind, spawnMonster } from '../entities/monster';

export function handleSamosborSpawns(world: World, dt: number) {
    const state = world.samosbor;
    if (!state.isActive || state.variant !== 'wet') return;

    state.spawnTimer = (state.spawnTimer || 0) + dt;
    if (state.spawnTimer >= 10.0) { // Каждые 10 секунд
        state.spawnTimer = 0;
        
        // Лимит акул
        const sharksCount = world.entities.filter(e => e.kind === MonsterKind.FOG_SHARK).length;
        if (sharksCount < 5) {
            spawnFogSharkNearPlayer(world);
        }
    }
}

function spawnFogSharkNearPlayer(world: World) {
    const px = Math.floor(world.player.x);
    const py = Math.floor(world.player.y);
    
    // Ищем клетку WATER в радиусе 10-20
    const cell = findWaterCellOutofSight(world, px, py, 10, 20);
    if (cell) {
        spawnMonster(world, MonsterKind.FOG_SHARK, cell.x, cell.y);
        publishEvent({ type: 'samosbor_spawn', entity: 'fog_shark' });
    }
}
```

#### 2. Интеграция с `src/entities/fog_shark.ts`
Убедитесь, что логика `fog_shark` правильно обрабатывает передвижение по воде.
Если акула находится в ячейке `Cell.WATER`, её `speedMultiplier` должен быть `2.0`. Вне воды — `0.5`.
Это можно добавить в AI контроллер акулы или в системный обсчет movement.
```typescript
// Stub for src/systems/ai.ts (Movement update logic)
export function updateSharkSpeed(world: World, shark: Entity) {
    if (shark.kind !== MonsterKind.FOG_SHARK) return;

    const currentCell = world.getCell(Math.floor(shark.x), Math.floor(shark.y));
    if (currentCell.type === 'WATER') {
        shark.speed = shark.baseSpeed * 2.0; // Быстро плывет
    } else {
        shark.speed = shark.baseSpeed * 0.5; // Медленно ползет по суше
    }
}
```

#### 3. Garbage Collection
По завершении Самосбора (`state.phase === 'aftermath'`), все Акулы, оставшиеся в живых, должны "раствориться" или быстро умереть (например, терять по 10 HP в секунду, так как им нужна влага Самосбора).

#### 4. Тестирование и валидация
- Добавьте unit-тест: `test('wet samosbor spawns fog sharks on water cells')`.
- Убедиться, что акулы не спавнятся внутри гермодверей или убежищ.
- Запустить `npm run check:readonly` (typescript typecheck).

## Ваши шаги:
1. Изучить `AGENTS.md`, `samosbor.ts`, `fog_shark.ts`.
2. Реализовать `handleSamosborSpawns` и встроить в main loop самосбора.
3. Реализовать поиск `findWaterCellOutofSight` (не использовать BFS! обычный random sampling по радиусу).
4. Обновить модификатор скорости акулы в зависимости от тайла.
5. Запустить `npm run check:readonly` и юнит-тесты.
6. Сделать `git commit -m "feat(samosbor): implement fog shark spawning for wet variant"` и создать PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
