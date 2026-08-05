# План Агента: marx_60
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №60.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Оптимизация: Отключение частиц (мух/тараканов) на мобильных.**



### Контекст задачи
Оптимизация: отключение рендера мух/крыс на слабых устройствах.

### Конкретные файлы и паттерны
- **`src/render/critters.ts`** (от marx_74): Добавьте глобальный toggle: `critterRenderEnabled`.
- **`src/render/webgl.ts`**: Перед draw pass critters — проверить toggle.
- **Детекция**: `navigator.maxTouchPoints > 0` → отключить. Или FPS < 30 → отключить. Или пользовательская настройка в `U` menu.
- **UI settings**: Через `src/render/controls_ui.ts` или `hud.ts` — добавить toggle «Живность: вкл/выкл» в UI panel.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Ожидается полная автономность: вы должны спроектировать и реализовать весь необходимый код строго в рамках 5-слойной архитектуры ГИГАХРУЩА, не задавая вопросов. Цель — отключить рендер частиц (мухи, крысы) на мобильных устройствах или при низком FPS для повышения производительности.

#### 1. Определение Конфигурации (Слой `data/`)
Вам необходимо расширить или создать конфигурацию настроек пользователя, где будет храниться флаг включения/отключения рендера частиц.

```typescript
// В файле src/data/settings.ts или аналогичном
export interface GraphicSettings {
    renderCritters: boolean;
    // ... другие настройки
}

// Конфигурация по умолчанию: автодетект мобильных устройств
export const DEFAULT_GRAPHIC_SETTINGS: GraphicSettings = {
    // navigator.maxTouchPoints используется как простой способ определить тач-устройство
    renderCritters: !(typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
};
```

#### 2. Интеграция в State (Слой `core/`)
Добавьте этот флаг в глобальное состояние, чтобы система рендера могла его читать без вызова тяжелых функций или постоянных проверок DOM.

```typescript
// В src/core/world.ts или src/core/state.ts
export interface WorldState {
    // ...
    settings: GraphicSettings;
}
```

#### 3. Модификация Рендера (Слой `render/`)
Основная задача: если `renderCritters` выставлено в `false`, мы полностью пропускаем этап рендеринга и обновления анимаций для частиц-насекомых/грызунов.

```typescript
// В файле src/render/critters.ts или аналогичном
export function drawCritters(gl: WebGLRenderingContext, world: World, state: WorldState) {
    if (!state.settings.renderCritters) {
        return; // Полностью пропускаем рендер и обход массива
    }
    
    // ... существующий код рендера частиц
}
```

Также необходимо убедиться, что логика спавна частиц (если она есть) тоже учитывает эту настройку, чтобы не накапливать объекты в памяти.

```typescript
// В src/systems/critter_system.ts или генераторе
export function spawnCritter(world: World, type: string, x: number, y: number) {
    if (!world.settings.renderCritters) return; // Не создаем
    // ...
}
```

#### 4. UI Настройки (Слой `render/` / Интерфейс)
Добавьте переключатель в меню настроек (`U` menu или аналогичное), чтобы игрок мог вручную включить или отключить эту опцию.

```typescript
// В src/render/controls_ui.ts или src/ui/settings_menu.ts
export function renderSettingsMenu(container: HTMLElement, state: WorldState) {
    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = `Живность: ${state.settings.renderCritters ? 'ВКЛ' : 'ВЫКЛ'}`;
    toggleBtn.onclick = () => {
        state.settings.renderCritters = !state.settings.renderCritters;
        toggleBtn.innerText = `Живность: ${state.settings.renderCritters ? 'ВКЛ' : 'ВЫКЛ'}`;
        // Сохранение настроек в localStorage
        saveSettingsToLocalStorage(state.settings);
    };
    container.appendChild(toggleBtn);
}
```

#### 5. Авто-определение и Адаптация FPS (Опционально)
Реализуйте простую систему адаптации: если FPS падает ниже 30 на протяжении 5 секунд, предлагать игроку отключить эффекты.

```typescript
// В src/systems/fps_monitor.ts
let lowFpsFrames = 0;
export function checkPerformance(fps: number, state: WorldState) {
    if (state.settings.renderCritters && fps < 30) {
        lowFpsFrames++;
        if (lowFpsFrames > 300) { // Примерно 5 секунд при 60 fps
            publishEvent({ 
                type: 'UI_MESSAGE', 
                text: 'Низкая производительность. Рекомендуем отключить живность в настройках (U).' 
            });
            lowFpsFrames = 0; // Сброс
        }
    } else {
        lowFpsFrames = 0;
    }
}
```

#### 6. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Создать `GraphicSettings` и добавить настройку `renderCritters`.
2. **Инициализация:** Настроить автодетект (`maxTouchPoints`).
3. **Рендер:** Обернуть вызовы в `critters.ts` в проверку флага.
4. **UI:** Добавить кнопку-переключатель в меню настроек.
5. **Сохранение:** Убедиться, что настройка сохраняется и загружается между сессиями.
6. **Тестирование:** Включить эмуляцию мобильного в Chrome DevTools и убедиться, что частицы не рендерятся и FPS стабилен.

#### 7. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run test:unit`.
* Выполните визуальную проверку (открытие меню настроек, переключение опции).
* Формат коммита: `perf(render): add toggle to disable critters on mobile and low-end devices`.
* В описании PR: укажите, какие файлы рендера были затронуты и как реализовано сохранение настройки.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
