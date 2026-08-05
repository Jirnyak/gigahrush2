import fs from 'fs';
import path from 'path';

const tasks = {
  70: {
    stubs: `\`\`\`typescript
// src/render/pixutil.ts (Примерные заглушки)
export function applyOutline(ctx: CanvasRenderingContext2D, size: number, color: string, thickness: number = 1): void {
    // Читаем пиксели, находим границы альфа-канала, рисуем обводку
}

export function applyGradientShading(ctx: CanvasRenderingContext2D, size: number, angle: number): void {
    // Наложение градиента для имитации объема (Multiply/Overlay)
}

// В src/entities/monster.ts
export interface SpriteGenerationContext {
    size: number;
    baseHue: number;
    variationHash: number;
}
\`\`\``,
    integration: `1. **Поддержка разрешения 128x128**: Убедитесь, что все операции рисования в \`generateSprite()\` используют пропорциональные величины (не захардкоженные координаты, а умноженные на \`size\`).
2. **Реализация обводок**: Добавьте \`applyOutline\` для выделения силуэтов монстров на темном фоне. Это критически важно для читаемости.
3. **Улучшение материалов**: Используйте новые утилиты для добавления теней и бликов. Спрайты больше не должны быть плоским шумом.
4. **Специфика видов**: 
   - SBORKA: выразительные зубы и глаза.
   - ZOMBIE: видимые раны и неровный контур.
   - TVAR: асимметрия и градиентные пульсации.
5. **Сохранение кэширования**: Убедитесь, что сгенерированные 128x128 спрайты корректно кэшируются в атласе и не вызывают OOM.`
  },
  71: {
    stubs: `\`\`\`typescript
// src/render/textures.ts (Примерные заглушки)
export function addCracks(ctx: CanvasRenderingContext2D, size: number, seed: number, crackDensity: number): void {
    // Генерация ветвящихся линий (трещин) с использованием random(seed)
}

export function addMoisturePatches(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    // Рисование полупрозрачных темных пятен с размытыми краями
}

export function getCoordinateHashVariation(x: number, y: number, z: number): number {
    // Возвращает детерминированный хэш от 0 до 63 для выбора вариации текстуры
}
\`\`\``,
    integration: `1. **Анализ текущих генераторов**: Проверьте, как создаются \`Tex.CONCRETE\`, \`Tex.BRICK\`, \`Tex.PANEL\`, \`Tex.METAL\`.
2. **Внедрение вариативности**: Используйте \`getCoordinateHashVariation(x, y, z)\` в шейдере или при выборке координат текстуры, чтобы разбивать тайлинг.
3. **Глубина и детали**: В генераторы текстур добавьте функции \`addCracks\` (особенно для бетона и кирпича) и \`addMoisturePatches\` (для подвальных уровней).
4. **Подтёки (Streaks)**: Реализуйте вертикальные градиенты, имитирующие ржавчину или грязь, стекающую сверху вниз.
5. **Ограничения**: Не увеличивайте размер текстуры больше 64x64, чтобы избежать проблем с производительностью на мобильных устройствах.`
  },
  72: {
    stubs: `\`\`\`typescript
// src/render/webgl.ts (Примерные заглушки)
export function initWebGLContextListeners(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn('WebGL Context Lost!');
        // Логика сохранения стейта
    });
    canvas.addEventListener('webglcontextrestored', () => {
        console.log('WebGL Context Restored!');
        // Логика переинициализации
    });
}

export function getSafeTextureSize(gl: WebGLRenderingContext): number {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return Math.min(max, 4096); // Ограничение для стабильности на iOS
}
\`\`\``,
    integration: `1. **Защита контекста WebGL**: Внедрите \`initWebGLContextListeners\` в главный пайплайн рендера. Это спасет от жестких крашей при сворачивании мобильного браузера.
2. **Контроль атласов**: В \`src/render/sprites.ts\` ограничьте размер текстурного атласа. Если количество спрайтов требует больше \`4096x4096\`, реализуйте логику разбиения на несколько атласов или уменьшения разрешения спрайтов (downscaling).
3. **Очистка AudioContext**: Гарантируйте, что старые инстансы \`AudioContext\` закрываются (\`close()\`) при переходе между этажами.
4. **TypedArray Resizing**: Проверьте массивы энтити (\`entities\`). Если они превышают размер, используйте безопасное копирование \`ArrayBuffer\` с проверкой доступной памяти через \`try/catch\`.`
  },
  73: {
    stubs: `\`\`\`typescript
// src/input.ts или src/main.ts (Примерные заглушки)
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isStandalone = ('standalone' in window.navigator) && (window.navigator as any).standalone === true;

export function attemptScrollToHide(): void {
    if (isIOS && !isStandalone) {
        setTimeout(() => window.scrollTo(0, 1), 100);
    }
}

export function showAddToHomeScreenPrompt(): void {
    // Отображение UI элемента, предлагающего добавить PWA на рабочий стол
}
\`\`\``,
    integration: `1. **Скрытие панелей**: Внедрите вызов \`attemptScrollToHide()\` при инициализации игры и после первых тапов пользователя (iOS Safari часто требует жеста пользователя для скролла).
2. **PWA Overlay**: Если \`isIOS && !isStandalone\`, покажите ненавязчивый оверлей с предложением "Add to Home Screen".
3. **Безопасные зоны**: В CSS (встроенном или внешнем) используйте \`env(safe-area-inset-*)\` для отступов от "челки" (notch) и нижней полосы на iPhone X+.
4. **WebGL Safety**: Обязательно убедитесь, что задача marx_72 выполнена или включите обработчики \`webglcontextlost\` здесь, так как смена режима отображения на iOS часто дропает WebGL контекст.`
  },
  74: {
    stubs: `\`\`\`typescript
// src/input.ts (Примерные заглушки)
export const JOYSTICK_CONFIG = {
    deadZoneRadius: 20, // Увеличить
    maxRadius: 80,
    touchMoveThreshold: 5, // Уменьшить для отзывчивости
};

export function triggerHapticFeedback(duration: number = 10): void {
    if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(duration);
    }
}
\`\`\``,
    integration: `1. **Калибровка зон**: Увеличьте радиус виртуального джойстика и сделайте зону "слепого пятна" (dead zone) чуть больше, чтобы избежать случайных микро-движений.
2. **Кнопка Взаимодействия [E]**: Сделайте хитбокс кнопки значительно больше визуального размера иконки. На мобильных промазать по мелкой кнопке — частая боль.
3. **Тактильный отклик**: Добавьте \`triggerHapticFeedback()\` при важных действиях (нажатие кнопки действия, получение урона, выбор пункта в инвентаре).
4. **Сенса Камеры**: Проверьте связку с настройкой "mobile camera sensitivity". Если настройки еще нет в меню — создайте заглушку в \`src/data/settings.ts\`.`
  },
  75: {
    stubs: `\`\`\`typescript
// src/render/hud.ts (Примерные заглушки)
export function calculateUIScale(canvasWidth: number): number {
    const breakpoints = {
        compact: 375,
        emergency: 320
    };
    if (canvasWidth <= breakpoints.emergency) return 0.6;
    if (canvasWidth <= breakpoints.compact) return 0.8;
    return Math.min(1, canvasWidth / 800);
}

export function calculateInventoryGridCols(canvasWidth: number): number {
    return canvasWidth <= 375 ? 4 : 8; // Адаптивная сетка
}
\`\`\``,
    integration: `1. **Масштабирование элементов**: В рендере HUD примените \`calculateUIScale\` ко всем координатам и размерам шрифтов. 
2. **Адаптивный Инвентарь**: Если экран узкий (<=375px), используйте сетку 4xN или 6xN с поддержкой скроллинга вместо фиксированной 8x8.
3. **Emergency Layout**: Для экранов <=320px скройте декоративные элементы HUD. Оставьте только самое критичное: полоску HP, патроны и мини-карту.
4. **Разделение HUD**: Для очень вытянутых экранов (aspect ratio < 0.5) перенесите часть HUD в нижнюю безопасную зону экрана, чтобы освободить обзор по центру.`
  },
  76: {
    stubs: `\`\`\`typescript
// src/render/webgl.ts (Примерные заглушки)
export const GRAPHICS_PROFILE = {
    isMobile: navigator.maxTouchPoints > 0 || window.innerWidth < 1024,
    useComplexFog: true,
    maxParticles: 1000
};

export function setupMobileFallbacks(): void {
    if (GRAPHICS_PROFILE.isMobile) {
        GRAPHICS_PROFILE.useComplexFog = false;
        GRAPHICS_PROFILE.maxParticles = 300;
        // Отключить декоративных криттеров
    }
}
\`\`\``,
    integration: `1. **Детекция устройства**: Инициализируйте \`setupMobileFallbacks()\` при старте игры.
2. **Шейдер тумана**: В вершинном/фрагментном шейдере реализуйте `#ifdef` или логическое ветвление. Для мобильных используйте линейный расчет \`mix(color, fogColor, depth/maxDepth)\` вместо экспоненциального \`exp(-depth*density)\`.
3. **Лимиты частиц**: При спавне крови (\`blood marks\`) или гильз жестко ограничьте массив размером \`maxParticles\`.
4. **Пользовательский контроль**: В меню \`U\` добавьте настройку "Лёгкая графика", которая форсирует мобильные лимиты даже на ПК (или наоборот, отключает их на мощных телефонах).`
  },
  77: {
    stubs: `\`\`\`typescript
// src/systems/save_payload.ts (Примерные заглушки)
export const MAX_CACHED_FLOORS = 10;

export function pruneOldFloorsFromSave(saveData: any): any {
    // Логика удаления самых старых этажей из сохранения, если их больше MAX_CACHED_FLOORS
    // Оставить только активные квесты и глобальный стейт
    return prunedSave;
}

export function estimateLocalStorageSize(): number {
    try {
        return JSON.stringify(localStorage).length;
    } catch {
        return 0;
    }
}
\`\`\``,
    integration: `1. **Проверка размера сохранений**: Внедрите \`estimateLocalStorageSize()\`. Если размер превышает 4MB (лимит обычно 5MB), инициируйте \`pruneOldFloorsFromSave\`.
2. **LRU Кэш Этажей**: Этажи, на которых игрок не был давно и где нет активных квестов/важных NPC, должны быть очищены из памяти. Их состояние сгенерируется заново из сида (с учетом персистентных изменений).
3. **Очистка объектов (Cleanup)**: При вызове \`switchFloor()\` убедитесь, что массивы \`world.entities.length = 0\` и не остается висячих ссылок в замыканиях.
4. **Синглтон AudioContext**: Оберните \`AudioContext\` в синглтон, который никогда не пересоздается. При смене этажей просто останавливайте текущие буферы.`
  },
  78: {
    stubs: `\`\`\`typescript
// src/systems/ai/pathfinding.ts и src/systems/factions.ts (Примерные заглушки)
export function evaluateMacroGoalPerformance(factionId: string): void {
    const t0 = performance.now();
    // Логика оценки макро-целей
    const t1 = performance.now();
    if (t1 - t0 > 1.0) {
        console.warn(\`Macro goal evaluation took \${t1 - t0}ms\`);
    }
}

export function getCachedTerritoryData(factionId: string): TerritoryCache {
    // Возврат предварительно рассчитанных данных вместо обхода графа в реальном времени
}
\`\`\``,
    integration: `1. **Изоляция A-Life**: Убедитесь, что высокоуровневые макро-цели фракций (marx_62) оцениваются не каждый кадр, а по таймеру (например, раз в 5 секунд или асинхронно).
2. **Использование кэша**: Запретите вызовы тяжелых функций поиска (BFS) внутри логики макро-целей. Используйте \`getCachedTerritoryData()\`. Навигационные сетки перестраиваются только при разрушении стен или Самосборе.
3. **Телеметрия**: Добавьте \`evaluateMacroGoalPerformance\` для всех фракций. Если оценка занимает больше 1 миллисекунды, алгоритм должен быть прерван или разбит на микро-задачи.
4. **Соответствие Iron Law**: Прямое выполнение требования из AGENTS.md — никаких тяжелых реалтайм поисков.`
  },
  79: {
    stubs: `\`\`\`javascript
// scripts/smoke_test.js (Примерный скрипт для Node.js)
const { execSync } = require('child_process');

async function runSmokeTest() {
    console.log("Building project...");
    execSync('npm run build', { stdio: 'inherit' });
    
    console.log("Running smoke verification...");
    // Логика запуска headless браузера (Puppeteer/Playwright)
    // - Переход на index.html
    // - Проверка наличия canvas
    // - Перехват window.onerror
    // - Имитация перехода на новый этаж
}
runSmokeTest().catch(err => {
    console.error("Smoke test failed", err);
    process.exit(1);
});
\`\`\``,
    integration: `1. **Автоматизация**: Создайте или обновите \`scripts/smoke_test.js\`. Убедитесь, что скрипт корректно запускается через \`npm run smoke\`.
2. **Интеграция с CI**: Smoke-тест должен завершаться с кодом 1 при любых выброшенных исключениях в браузере или если \`canvas\` не инициализировался.
3. **Особые сценарии**:
   - Эмуляция мобильного устройства (изменение user-agent и размеров окна).
   - Вызов функции смены этажа для проверки утечек памяти.
4. **Универсальность**: Если Puppeteer недоступен, предусмотрите fallback через \`CHROME_BIN\` (указано в README.md). Обеспечьте информативный вывод при ошибках.`
  }
};

const commonFooter = `
### Детальный Workflow Реализации (План действий для Jules)
Этот раздел содержит пошаговую инструкцию для автономной реализации задачи. Вы должны следовать ему неукоснительно.

#### Фаза 1: Анализ и Подготовка
1. **Анализ текущего состояния**: Изучите файлы, упомянутые в контексте задачи. Оцените текущие алгоритмы и структуры данных.
2. **Определение контрактов**: Убедитесь, что ваши изменения не ломают публичные API слоев (особенно \`data/\` и \`systems/\`).
3. **Резервное копирование логики**: В случае рефакторинга сохраните оригинальное поведение как fallback, если новое окажется нестабильным.

#### Фаза 2: Написание заглушек и интерфейсов (TypeScript Stubs)
Вам потребуется создать или обновить следующие интерфейсы и функции. Вот примеры (заглушки), на которые вы должны ориентироваться:

<STUBS_PLACEHOLDER>

#### Фаза 3: Интеграция и Основная Логика
<INTEGRATION_PLACEHOLDER>

#### Фаза 4: Строгое Архитектурное Соответствие (GIGAHRUSH Five-Layer Architecture)
- **Слой Core (\`src/core/\`)**: Изменения допускаются только если вы добавляете новые глобальные типы или константы.
- **Слой Data (\`src/data/\`)**: Все балансовые величины, размеры, настройки, параметры UI должны быть вынесены сюда. НИКАКОГО ХАРДКОДА в системах или рендере.
- **Слой Gen (\`src/gen/\`)**: Если задача касается генерации, убедитесь, что соблюдается воспроизводимость по сиду.
- **Слой Systems (\`src/systems/\`)**: Вся логика должна быть инкапсулирована в системах. Никаких побочных эффектов в рендере.
- **Слой Render (\`src/render/\`)**: Только отрисовка стейта. Никаких расчетов геймплея. Уважайте WebGL контекст.

#### Фаза 5: Тестирование и Валидация
1. **Типизация**: Выполните \`npm run typecheck\`. Исправьте все ошибки. Не используйте \`any\` или \`@ts-ignore\` без крайней необходимости.
2. **Юнит-тесты**: Выполните \`npm run test:unit\`. Если вы добавили новые утилиты, напишите для них тесты в \`tests/\`.
3. **Смоук-тесты**: Выполните \`npm run smoke\` (или \`check:browser\`, если применимо).
4. **Проверка на мобильных**: Используйте Chrome DevTools (Device Mode) для имитации мобильных устройств, так как многие задачи из этого пула критичны для мобильного UX.

#### Чек-лист завершения:
- [ ] Код написан и интегрирован.
- [ ] Архитектурные правила (AGENTS.md) соблюдены.
- [ ] Оптимизация не нарушена (Iron Law).
- [ ] Все тесты и typecheck проходят.
- [ ] Создан осмысленный коммит и отправлен Pull Request.
- [ ] Задача полностью задокументирована.
`;

for (let i = 70; i <= 79; i++) {
    const filename = path.join(process.cwd(), \`marx_\${i}.md\`);
    if (!fs.existsSync(filename)) {
        console.log(\`File \${filename} not found, skipping.\`);
        continue;
    }
    
    let content = fs.readFileSync(filename, 'utf-8');
    
    // Check if we already expanded it to avoid double appending
    if (content.includes('### Детальный Workflow Реализации')) {
        content = content.split('### Детальный Workflow Реализации')[0];
    }

    // Also remove the bottom parts starting with "## Ваши шаги:" as we are replacing them with a better workflow
    if (content.includes('## Ваши шаги:')) {
        content = content.split('## Ваши шаги:')[0];
    }
    
    const taskData = tasks[i];
    if (taskData) {
        let footer = commonFooter
            .replace('<STUBS_PLACEHOLDER>', taskData.stubs)
            .replace('<INTEGRATION_PLACEHOLDER>', taskData.integration);
            
        content = content.trim() + '\n\n' + footer;
        fs.writeFileSync(filename, content);
        console.log('Updated marx_' + i + '.md (new length: ' + content.split('\n').length + ' lines)');
    } else {
        console.log('No task data for marx_' + i);
    }
}
