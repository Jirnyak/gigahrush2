# План Агента: marx_27
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №27.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Интеракты: Двери (Прочность). Добавление ХП дверям.**

### Контекст задачи
Двери в игре сейчас являются бинарными объектами (Открыто/Закрыто/Заперто). Для расширения тактических возможностей и песочницы необходимо добавить дверям параметр прочности (HP), чтобы игрок или монстры могли их выломать физической силой (melee) или взрывчаткой. Уничтоженная дверь навсегда остается в состоянии `BROKEN`.

### Конкретные файлы и паттерны
- **`src/core/types.ts`**: В интерфейс `Door` добавьте `hp?: number` и `maxHp?: number`. Default = 50 (деревянные), 150 (металлические), 500 (гермодвери).
- **`src/systems/interactions.ts`**: В обработчике удара по двери (`E` action или melee hit) — уменьшайте `door.hp`. Когда `hp <= 0` → `door.state = DoorState.BROKEN` + bump `world.cellVersion` (для перестройки nav tree).
- **Визуал**: В `src/render/webgl.ts` при `door.hp < door.maxHp * 0.5` — рисовать текстуру с трещинами (модифицировать UV или overlay).
- **Save**: `door.hp` должен сохраняться в floor memory. Проверьте `src/systems/floor_memory.ts`.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Core (Типы) - `src/core/types.ts`
Расширьте интерфейсы и энумы, связанные с дверьми.
```typescript
// Stub for Door interface
export interface Door {
  id: string;
  idx: number;
  state: DoorState; 
  material: DoorMaterial; // WOOD, METAL, HERMETIC
  hp: number;
  maxHp: number;
  keyId?: string;
}

export enum DoorState { 
  OPEN = 0, 
  CLOSED = 1, 
  LOCKED = 2, 
  BROKEN = 3 // NEW STATE
}
```

#### 2. Слой Systems (Взаимодействие) - `src/systems/interactions.ts`
Добавьте логику обработки входящего урона для двери.
```typescript
// Stub for hitting a door
export function damageDoor(door: Door, damage: number) {
  if (door.state === DoorState.BROKEN || door.state === DoorState.OPEN) {
    return; // Already broken or open, attack passes through
  }
  
  door.hp -= damage;
  publishEvent('door_damaged', { doorId: door.id, hp: door.hp });
  
  // Visual & Audio feedback
  publishEvent('noise', { type: 'door_hit', pos: door.idx });
  publishEvent('particle_spawn', { type: 'debris', pos: door.idx });
  
  if (door.hp <= 0) {
    door.hp = 0;
    door.state = DoorState.BROKEN;
    // VERY IMPORTANT: Notify world that navigation mesh changed
    // so A* recalculates paths through the broken door
    world.cellVersion++; 
    publishEvent('door_broken', { doorId: door.id });
    publishEvent('noise', { type: 'door_break', pos: door.idx, volume: 1.5 });
  }
}
```

#### 3. Слой Render (Визуал трещин) - `src/render/webgl.ts`
Обновите отрисовку дверей. Сломанная дверь не рисуется (или рисуется как мусор на полу), а поврежденная имеет декаль трещин.
```typescript
// Stub for rendering doors
function renderDoor(gl: WebGLRenderingContext, door: Door) {
  if (door.state === DoorState.BROKEN) return; // Draw nothing or draw debris flat on floor
  if (door.state === DoorState.OPEN) return; 
  
  let texture = getTextureForMaterial(door.material);
  
  // If heavily damaged, overlay a crack texture
  if (door.hp < door.maxHp * 0.5) {
    // WebGL approach: pass uniform to mix with crack texture
    // Software approach: composite textures
    texture = applyDamageOverlay(texture, Tex.CRACKS);
  }
  
  drawVerticalStrip(door.idx, texture, 2.0, 0);
}
```

#### 4. Слой Systems (Сохранение) - `src/systems/floor_memory.ts`
Убедитесь, что новое поле `hp` сериализуется при выгрузке этажа, иначе двери будут чиниться при загрузке сейва.
```typescript
// Stub for save runtime
export function serializeDoors(doors: Door[]): any[] {
  return doors.map(d => ({
    i: d.idx,
    s: d.state,
    h: d.hp // Save HP compactly
  }));
}

export function deserializeDoors(data: any[]): Door[] {
  return data.map(d => ({
    idx: d.i,
    state: d.s,
    hp: d.h ?? getDefaultHpForMaterial(DoorMaterial.WOOD), // Backwards compatibility
    // ...
  } as Door));
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Изучите `core/types.ts` и систему сейвов `floor_memory.ts` (или `save.ts`).
2. **Реализация Core-слоя:** Добавьте `hp`, `maxHp` и состояние `BROKEN`.
3. **Реализация Gen-слоя:** При генерации дверей (в `shared.ts` или генераторах комнат), устанавливайте `hp` равным `maxHp` в зависимости от материала (WOOD=50, METAL=150, HERMETIC=500).
4. **Реализация Systems-слоя:** Измените обработку мили-атак. Если игрок атакует пустую клетку с закрытой дверью — вызывайте `damageDoor`. Убедитесь, что `cellVersion++` работает.
5. **Интеграция:** Убедитесь, что сломанная дверь считается прозрачной и проходимой (update `isCellWalkable` / `isCellOpaque` utilities).
6. **Реализация Render-слоя:** Если дверь `BROKEN`, не рендерите её стенку. Опционально добавьте отрисовку трещин.
7. **Тестирование:** Проверьте сохранение. Разбейте дверь, сделайте Save&Load, убедитесь, что она сломана.
8. **Проверка типов:** `npm run typecheck`.
9. **Коммит:** Закоммитьте `feat(interact): destructible doors with HP`.
10. **Pull Request:** Запушьте код. Задокументируйте, как работает `cellVersion` для перестройки путей ИИ.

---
*Ожидается, что вы завершите задачу, добавив тактическую глубину, и оставите проект в компилируемом состоянии без потери производительности.*
