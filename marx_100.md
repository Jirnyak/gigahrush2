# План Агента: marx_100
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №100.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Убрать механику «Сопротивляться ходу»**

### Контекст задачи
Механика сопротивления ходу (нажатие E) глючная и ломает игру (нельзя взаимодействовать). Убрать её и переделать на что-то более интересное. Текущая реализация конфликтует с обычным использованием предметов и терминалов, создавая race conditions в обработке ввода. Вместо нее нужно добавить пассивную систему "Ошеломление" (Stagger), зависящую от статов игрока и массы.

### Конкретные файлы и паттерны
- **`src/systems/interactions.ts`**
- **`src/input.ts`**
- **`src/systems/combat.ts`**
- **`src/core/types.ts`**

## Детальный план реализации (Шаги для Агента Jules)

### Шаг 1. Анализ и очистка текущего кода
Проанализируйте `src/input.ts` и `src/systems/interactions.ts`.
Найдите обработчики события `E` (взаимодействие), которые в данный момент перехватывают управление для "сопротивления".
Аккуратно удалите весь блок кода, связанный с `action: 'resist'` или проверкой `isResisting`.
Убедитесь, что удаление не ломает фоллбэк на открытие дверей или сбор лута.

### Шаг 2. Разработка архитектуры замены (Stagger System)
Вместо активного сопротивления по кнопке, введите пассивный расчет `staggerResistance` в `src/systems/combat.ts`.
```typescript
// Заглушка для src/core/types.ts
export interface CombatStats {
  hp: number;
  maxHp: number;
  mass: number;
  staggerResistance: number; // От 0.0 до 1.0
}

export interface StaggerEvent {
  type: 'STAGGER';
  entityId: number;
  durationFrames: number;
}
```

### Шаг 3. Интеграция в боевую систему
Обновите формулу получения урона:
```typescript
// Заглушка для src/systems/combat.ts
export function applyDamageAndStagger(
  world: World,
  targetId: number,
  damage: number,
  knockbackPower: number
): void {
  const target = world.entities[targetId];
  if (!target || !target.combatStats) return;

  target.combatStats.hp -= damage;
  
  // Расчет шанса и длительности ошеломления
  const resist = target.combatStats.staggerResistance;
  const staggerChance = Math.max(0, (knockbackPower / target.combatStats.mass) - resist);
  
  if (Math.random() < staggerChance) {
     const duration = Math.floor(staggerChance * 60); // кадры
     publishEvent(world, { type: 'STAGGER', entityId: targetId, durationFrames: duration });
     applyStun(world, targetId, duration);
  }
}
```

### Шаг 4. Обновление визуальной обратной связи
В `src/render/hud.ts` или `src/render/particles.ts` добавьте реакцию на событие `STAGGER`.
При ошеломлении игрока (если `targetId === PLAYER_ID`) экран должен слегка дергаться (камера shake).
При ошеломлении врага - над ним появляется частица (например, звездочки или индикатор сбоя).
```typescript
// Заглушка для src/render/camera.ts
export function triggerCameraShake(intensity: number, frames: number): void {
  // Реализация тряски камеры
}
```

### Шаг 5. Очистка UI и Input
Удалите из интерфейса (HUD) подсказку "Нажмите E чтобы сопротивляться".
Убедитесь, что в `src/input.ts` клавиша E теперь всегда инициирует `InteractionSystem`, без задержек.
```typescript
// Заглушка для src/input.ts
export function handleKeyE() {
  // Только обычное взаимодействие
  queueInteraction(PLAYER_ID);
}
```

### Шаг 6. Обновление баланса
Проверьте `src/data/items.ts` на предмет брони. Если броня влияла на сопротивление, обновите её параметры на `staggerResistance`.
Пропишите базовое значение `staggerResistance` для разных типов мобов (например, у Слизня — 0.9, у обычного Гигачада — 0.2).

### Шаг 7. Валидация и тестирование
1. **Typecheck:** Запустите `npm run typecheck` и убедитесь, что удаленные свойства (`isResisting`) больше нигде не вызываются.
2. **Unit Tests:** В `tests/systems/combat.test.ts` напишите тесты на расчет ошеломления.
   - Проверка: легкий урон не вызывает стаггер у тяжелого моба.
   - Проверка: тяжелый урон вызывает стаггер у легкого моба.
3. **Smoke Test:** Запустите `npm run smoke` для проверки общего состояния игры.
4. **Manual Check:** Проведите визуальную проверку, что взаимодействие (E) теперь работает мгновенно для лута и дверей.

### Шаг 8. Оформление PR
Создайте ветку `feature/remove-active-resist`.
Убедитесь, что изменены только файлы из систем (core, systems, input), и ничего не сломано в генераторе этажей.
Добавьте в PR-описание (commit message) информацию о том, как теперь работает баланс массы и стаггера.
Создайте артефакт `walkthrough.md` для этого патча.

## Требования к автономности
- Все импорты должны быть корректно резолвиться.
- Строго соблюдайте границы пяти слоев (core, data, gen, systems, render).
- События должны проходить через стандартную шину событий (`publishEvent`).
- Не вводить новые зависимости в `package.json`.
- Код должен быть покрыт тестами для новых функций.
- Если меняется структура `localStorage`, убедитесь в наличии функции-санитайзера для совместимости со старыми сохранениями (см. `save.md`).
- Для завершения работы выполните проверку `npm run check:readonly`, закоммитьте изменения с понятным описанием и оформите PR.
