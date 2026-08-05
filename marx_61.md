# План Агента: marx_61
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №61.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Рендер: Эффекты Истотита/Веретара. Пересмотр, отключение вырвиглазных полноэкранных фильтров.**



### Контекст задачи
Ревью спецэффектов (Истотит, Веретар) — убрать вырвиглазные полноэкранные фильтры.

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`**: Найдите screen effects: glitch, scan lines, chromatic aberration. README: «Do not degrade the baseline WebGL image with always-on full-screen grain, blur, scanline, dither, chromatic or noise filters.»
- **Истотит/Веретар**: Это PSI-эффекты (plot items). Если их визуал мешает читаемости — уменьшите opacity, сократите длительность, уберите полноэкранный blur.
- **Toggling**: Добавьте в UI settings (`U` menu) опцию «Косметические эффекты: вкл/выкл».
- **README compliance**: Графика уже deliberately low-fi. Эффекты должны УЛУЧШАТЬ читаемость, не ухудшать.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — отключить или смягчить агрессивные полноэкранные эффекты (noise, dither, chromatic aberration, scanlines), заменив их на более сдержанные и не раздражающие зрение индикаторы состояний "Истотит" и "Веретар". 

#### 1. Пересмотр Шейдеров и Постпроцессинга (Слой `render/`)
Анализ `src/render/webgl.ts` (или файлов шейдеров). Исключить тяжелый и вырвиглазный noise-фильтр, если он применяется ко всему экрану.

```typescript
// В src/render/shaders.ts или там, где определяется фрагментный шейдер
// УДАЛИТЬ ИЛИ ЗАКОММЕНТИРОВАТЬ агрессивные строки:
// gl_FragColor.rgb += noise(uv) * 0.5; // СЛИШКОМ АГРЕССИВНО

// ЗАМЕНИТЬ на мягкое виньетирование или тонирование краев:
export const fragmentShaderSource = `
    // ...
    uniform float u_istotitLevel;
    uniform float u_veretarLevel;
    
    void main() {
        vec4 color = texture2D(u_sampler, v_uv);
        
        // Мягкий эффект Истотита (болезнь/слабость) - легкое обесцвечивание и пожелтение по краям
        if (u_istotitLevel > 0.0) {
            float dist = distance(v_uv, vec2(0.5));
            vec3 istotitColor = vec3(0.8, 0.8, 0.4);
            color.rgb = mix(color.rgb, istotitColor, dist * u_istotitLevel * 0.3);
        }
        
        // Мягкий эффект Веретара (пси-активность/усталость) - фиолетовое/синее виньетирование
        if (u_veretarLevel > 0.0) {
            float dist = distance(v_uv, vec2(0.5));
            vec3 veretarColor = vec3(0.4, 0.2, 0.6);
            color.rgb = mix(color.rgb, veretarColor, dist * u_veretarLevel * 0.4);
        }
        
        gl_FragColor = color;
    }
`;
```

#### 2. Связка Состояния со Значениями Шейдера (Слой `render/`)
В `webgl.ts` при биндинге униформ необходимо передавать нормализованные значения эффектов.

```typescript
// В src/render/webgl.ts
export function bindPostProcessUniforms(gl: WebGLRenderingContext, program: WebGLProgram, player: Entity) {
    const istotitLoc = gl.getUniformLocation(program, 'u_istotitLevel');
    const veretarLoc = gl.getUniformLocation(program, 'u_veretarLevel');
    
    // Предполагаем, что значения эффектов хранятся от 0 до 1 или от 0 до 100
    const istotit = player.statusEffects?.istotit || 0;
    const veretar = player.statusEffects?.veretar || 0;
    
    gl.uniform1f(istotitLoc, Math.min(istotit / 100, 1.0));
    gl.uniform1f(veretarLoc, Math.min(veretar / 100, 1.0));
}
```

#### 3. Альтернатива: Отключение в Настройках
Даже мягкие эффекты могут не нравиться части игроков. Добавьте toggle в настройки.

```typescript
// В src/data/settings.ts
export interface GraphicSettings {
    enableStatusScreenEffects: boolean; // по умолчанию true
}

// В webgl.ts перед вызовом uniform
if (!state.settings.enableStatusScreenEffects) {
    gl.uniform1f(istotitLoc, 0.0);
    gl.uniform1f(veretarLoc, 0.0);
}
```

#### 4. UI Индикация как замена (Слой `render/UI`)
Поскольку визуальный эффект на весь экран уменьшен, убедитесь, что в HUD есть четкая иконка, показывающая текущий статус болезни.

```typescript
// В src/render/hud.ts
export function renderStatusIcons(ctx: CanvasRenderingContext2D, player: Entity) {
    let xOffset = 10;
    if (player.statusEffects?.istotit > 0) {
        drawIcon(ctx, 'icon_istotit', xOffset, 10);
        xOffset += 32;
    }
    if (player.statusEffects?.veretar > 0) {
        drawIcon(ctx, 'icon_veretar', xOffset, 10);
    }
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **Анализ шейдеров:** Найти и удалить тяжелые функции `noise`, `scanlines`, `chromatic_aberration` из основного фрагментного шейдера.
2. **Переработка эффектов:** Написать мягкое, сдержанное виньетирование для отображения Истотита и Веретара.
3. **Биндинг данных:** Обеспечить передачу уровней болезни из сущности игрока в шейдер.
4. **Настройки:** Добавить флаг `enableStatusScreenEffects` для полного отключения.
5. **HUD:** Проверить наличие иконок статуса в интерфейсе, чтобы потеря агрессивного эффекта не скрыла от игрока факт болезни.

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run check:browser` (если есть).
* Проверьте, что шейдер компилируется без ошибок (WebGL не выкидывает warnings в консоль).
* Формат коммита: `refactor(render): replace aggressive screen filters with mild vignette and add toggle`.
* В описании PR опишите, почему старые эффекты были удалены (визуальный шум, резь в глазах) и как работают новые.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
