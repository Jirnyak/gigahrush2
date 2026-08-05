# План Агента: marx_29
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №29.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Хоррор-этаж: Крайне Живучие Преследователи. Спавн малого количества страшных мобов.**

### Контекст задачи
Создать AI-профиль для крайне живучих преследователей на хоррор-этаже. Они НЕ бессмертны — их можно убить, потратив огромное количество боеприпасов, но это крайне невыгодно. Основной counterplay — прятки и побег. Эта сущность работает по принципу Немезиса/Тирана, создавая постоянное давление на игрока.

### Конкретные файлы и паттерны
- **`src/entities/stalker_hunter.ts`** [НОВЫЙ ФАЙЛ]: Новый `MonsterKind`. `hp: 2000` (для сравнения, Betonnik-босс ~300hp), `speed: 1.8` (чуть медленнее игрока), `dmg: 50` (one-shot), `regenRate: 5` (восстанавливает 5 HP/сек — за 60 сек восстановится на ~300hp, то есть убить МОЖНО но нужно давить непрерывно). Крупный тёмный спрайт.
- **`src/entities/monster.ts`**: Зарегистрируйте `MonsterKind.STALKER_HUNTER` в enum и registry.
- **`src/systems/ai/tactics.ts`**: Добавьте tactic profile `'stalker_hunter'`: bounded radius 80 клеток, всегда `HUNT` на ближайшего living actor (игрока), НЕ использует BFS каждый кадр — следуйте навигационному дереву (`baked nav tree`) с bounded chunks.
- **Звук**: Тяжёлые шаги — `publishEvent('noise', ...)` каждые 2 секунды. Игрок слышит приближение.
- **`src/data/monster_ecology.ts`**: Counterplay: «Прячьтесь в укрытиях или за гермодверями. Убить МОЖНО — но патронов не хватит, а он регенерирует. Бегите.»

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Data (Определение) - `src/entities/stalker_hunter.ts`
Создайте и экспортируйте конфигурацию монстра.
```typescript
// Stub for stalker definition
export const STALKER_HUNTER_DEF = {
  kind: MonsterKind.STALKER_HUNTER,
  name: 'Тварь из Блока 4',
  hp: 2000,
  maxHp: 2000,
  speed: 1.8, // Player sprint is ~2.5, walking is 1.5
  dmg: 50, // Almost guaranteed one-shot for early/mid game
  regenRate: 5, // HP per second passive regen
  tactic: 'stalker_hunt',
  sprite: Tex.MONSTER_STALKER,
  radius: 80, // Sensory radius, huge
  tags: ['huge', 'unstoppable', 'horror']
};
```

#### 2. Слой Systems (ИИ Тактика) - `src/systems/ai/tactics.ts`
Имплементируйте тактику преследования. Он не должен вычислять A* по всей карте каждый кадр, это убьет FPS (Iron Law). Используйте запеченный flow field или грубую навигацию по комнатам.
```typescript
// Stub for AI tactic
export function runStalkerHuntTactic(entity: Entity, target: Entity | null, deltaTime: number) {
  // Regenerate HP passively
  if (entity.hp < entity.maxHp) {
    entity.hp = Math.min(entity.maxHp, entity.hp + (STALKER_HUNTER_DEF.regenRate * deltaTime));
  }

  // Heavy footsteps sound effect
  if (world.ticks % 120 === 0) { // Every ~2 seconds
    publishEvent('noise', { type: 'heavy_step', pos: entity.pos, volume: 1.5 });
  }

  if (target) {
    // Use cached nav tree / flow field for routing to player
    const nextStep = getNextNavStepTo(entity.pos, target.pos);
    if (nextStep) {
      moveTo(entity, nextStep);
    }
  } else {
    // Roam slowly towards the last known noise or patrol
    patrolSector(entity);
  }
}
```

#### 3. Слой Data (Справочник/Локализация) - `src/data/monster_ecology.ts`
Добавьте подсказку для внутриигрового справочника (Бестиария), чтобы игрок понимал правила взаимодействия.
```typescript
// Stub for ecology
export const ECOLOGY = {
  // ...
  [MonsterKind.STALKER_HUNTER]: {
    description: 'Огромная масса плоти и бетона. Не чувствует боли.',
    counterplay: 'Прячьтесь в укрытиях или за гермодверями. Убить МОЖНО — но патронов не хватит, а он регенерирует. Бегите.'
  }
};
```

#### 4. Слой Gen (Спавн) - `src/gen/procedural_floor.ts`
Убедитесь, что этот моб спавнится исключительно на специальных хоррор-уровнях (например, маршруты 'void' или 'hell'), и в количестве строго не более 1-2 на этаж.
```typescript
// Stub for horror floor generator
export function spawnHorrorEntities(world: World, floorTheme: Theme) {
  if (floorTheme === Theme.HORROR) {
    // Find a dark room far away from the elevator spawn
    const spawnCell = findDistantDarkRoom(world);
    if (spawnCell) {
      const stalker = createEntity(MonsterKind.STALKER_HUNTER, spawnCell);
      world.entities.push(stalker);
    }
  }
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Ознакомьтесь с архитектурой монстров (`src/entities/monster.ts`) и системой тактик ИИ (`src/systems/ai/tactics.ts`).
2. **Data-слой:** Создайте модуль `stalker_hunter.ts`. Определите его безумные статы. Не забудьте зарегистрировать новый энум `MonsterKind.STALKER_HUNTER`.
3. **Data-слой:** Заполните энциклопедию в `monster_ecology.ts`.
4. **Systems-слой:** Добавьте тактику `'stalker_hunt'`. Реализуйте пассивный реген. Реализуйте тяжелые шаги через систему `publishEvent`. 
5. **Оптимизация:** Убедитесь, что преследование не делает `findPathAStar` на 80 клеток каждый такт. Используйте промежуточные waypoints или Room Graph.
6. **Gen-слой:** Встройте вызов `spawnHorrorEntities` в конец генератора этажа, если тема этажа — Хоррор. 
7. **Тестирование:** Сгенерируйте хоррор-этаж локально, проверьте, появляется ли монстр. Проверьте, что его шаги слышны издалека (эффект затухания звука должен работать).
8. **Проверка типов:** `npm run typecheck`.
9. **Коммит:** Закоммитьте `feat(entities): add Stalker Hunter horror nemesis`.
10. **Pull Request:** Запушьте код и откройте PR. Прикрепите пояснение, как была решена проблема производительности pathfinding'а для этого моба.

---
*Ожидается, что вы завершите задачу, добавив напряженный хоррор-элемент в игру, сохранив при этом 60 FPS на мобильных устройствах.*
