# План Агента: marx_26
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №26.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Рендер: Решение дублирования текстур (Особенно двери и надписи на высоких стенах). Использовать вытягивание UV или бордюры.**

### Контекст задачи
При высоких потолках (высокие стены, высокий `ceilingTier`) стандартный raycaster просто повторяет (тайлит) текстуру по вертикали, потому что UV-координата `v` масштабируется. Из-за этого двери (`Tex.DOOR_WOOD`, `Tex.DOOR_METAL`) рисуются в два этажа, а постеры/надписи клонируются друг над другом. Требуется исправить это, переписав логику вычисления UV, либо создав гибридную отрисовку для конкретных стен.

### Конкретные файлы и паттерны
- **`src/render/webgl.ts`**: Основной цикл рейкастера (отрисовка вертикальных полосок стен).
- **`src/render/textures.ts`**: Генерация и конфигурация текстур.
- **`src/core/textures.ts`**: Определение флагов текстур (`nonTiling`, `clampToEdge`).

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)
Вам необходимо детально интегрировать вашу задачу в существующие слои проекта. Ниже приведены конкретные архитектурные требования, релевантные вашей задаче:

#### 🛠 Общие Архитектурные Рекомендации
Ваша задача базовая, но не забывайте о разделении: логика строго в `systems/`, данные строго в `data/`, стейт сохраняемый. Никакого хардкода.

#### 1. Слой Render (Модификация Raycaster) - `src/render/webgl.ts`
При растеризации вертикальной полоски стены, нужно проверять тип текстуры. Если это дверь, отрисовываем саму дверь только в нижнем диапазоне (0..2.0 по высоте), а выше рисуем дефолтную стену.
```typescript
// Stub for raycaster wall rendering
function drawWallStrip(x: number, tex: number, wallHeight: number, baseWallTex: number) {
  // Check if texture is non-tiling (doors, posters)
  const isNonTiling = isTextureNonTiling(tex); 
  const baseDoorHeight = 2.0; // standard 1-tier height
  
  if (isNonTiling && wallHeight > baseDoorHeight) {
    // 1. Draw standard wall overlay for the top section
    const topStripHeight = wallHeight - baseDoorHeight;
    // Map V coordinate based on standard tile size
    drawVerticalStrip(x, baseWallTex, topStripHeight, 0, false); 
    
    // 2. Draw the actual door/poster exactly at the bottom
    // We restrict its drawing region to [0, baseDoorHeight]
    drawVerticalStrip(x, tex, baseDoorHeight, topStripHeight, true); 
  } else {
    // Default tiling behavior for regular walls (brick, concrete)
    drawVerticalStrip(x, tex, wallHeight, 0, false); 
  }
}
```

#### 2. Слой Core (Флаги текстур) - `src/core/textures.ts`
Добавьте реестр свойств текстур, чтобы избежать хардкода `if (tex === Tex.DOOR)`.
```typescript
// Stub for texture properties
export const TEXTURE_PROPERTIES: Record<number, { clampToEdge?: boolean, nonTiling?: boolean }> = {
  [Tex.DOOR_METAL]: { clampToEdge: true, nonTiling: true },
  [Tex.DOOR_WOOD]: { clampToEdge: true, nonTiling: true },
  [Tex.POSTER_BASE]: { clampToEdge: true, nonTiling: true },
  [Tex.WALL_BRICK]: { clampToEdge: false, nonTiling: false },
};

export function isTextureNonTiling(texId: number): boolean {
  return TEXTURE_PROPERTIES[texId]?.nonTiling === true;
}
```

#### 3. Слой Render (Альтернатива: Процедурные текстуры) - `src/render/textures.ts`
В качестве альтернативы (или дополнения к плакатам), можно добавить логику в генерацию 64x64 текстур, создавая прозрачный "бордюр".
```typescript
// Stub for texture generation (optional approach for decals/posters)
export function generatePosterTexture(ctx: CanvasRenderingContext2D) {
  // Clear entirely to transparent first
  ctx.clearRect(0, 0, 64, 64);
  
  // Draw the poster strictly in the center
  ctx.fillStyle = '#fff';
  ctx.fillRect(16, 16, 32, 32);
  ctx.fillStyle = '#000';
  ctx.fillText('САМОСБОР', 18, 32);
  
  // Do NOT fill the edges. In WebGL, use gl.CLAMP_TO_EDGE for this specific texture
  // so the transparent pixels stretch infinitely upwards.
}
```

## Ваши шаги (Расширенный Workflow):
1. **Анализ:** Ознакомьтесь с тем, как Raycaster (`src/render/webgl.ts`) сейчас масштабирует текстуру (параметр `v_scale` или аналогичный в шейдере/программной отрисовке).
2. **Слой Core:** Добавьте или обновите словарь конфигураций текстур (`TEXTURE_PROPERTIES`).
3. **Проектирование Render-слоя:** Решите, будете ли вы разбивать одну вертикальную линию на 2 вызова отрисовки (для стены выше и двери внизу) или решать это внутри фрагментного шейдера (если используется WebGL).
4. **Реализация (Если Software Raycaster / Canvas):** Разделите `drawWallStrip` на два вызова.
5. **Реализация (Если WebGL Shader):** Передайте uniform `isNonTiling`. В фрагментном шейдере: `if (isNonTiling && vTexCoord.y > baseHeightLimit) discard;` и подложите базовую стену за дверью.
6. **Оптимизация:** Избегайте ветвлений `if` в шейдере, если можно решить это геометрией. Дверь можно рендерить как отдельный billboard (декаль), слегка сдвинутый от стены.
7. **Тестирование визуальное:** Сгенерируйте комнату с `ceilingTier = 2` и поставьте дверь. Убедитесь, что дверь не дублируется.
8. **Проверка типов:** `npm run typecheck`.
9. **Коммит:** Закоммитьте `fix(render): prevent texture vertical tiling for doors and decals`.
10. **Pull Request:** Запушьте ветку. В описании четко укажите, какой подход выбран (разбиение стрипов, шейдерный хак или декали).

---
*Ожидается, что вы завершите задачу, решив один из самых неприятных визуальных багов псевдо-3D, и оставите проект в компилируемом состоянии.*
