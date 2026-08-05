import fs from 'fs';

const shaders1Path = '/Users/jirnyak/Mirror/gigahrush/shaders_1.md';
const lightPath = '/Users/jirnyak/Mirror/gigahrush/light.md';

const newShaders1Content = `# Agent Task Plan: Shaders 1 - Voxel Ambient Occlusion (AO)

> **ВНИМАНИЕ АГЕНТУ (JULES / GEMINI 3.1 PRO):**
> Ты работаешь над интеграцией Voxel Ambient Occlusion (угловых теней) в DDA-рейкастер GIGAHRUSH.
> **КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ:** У нас бесконечные и бесплатные ресурсы GPU, но жесточайший bottleneck по CPU.
> ЗАПРЕЩЕНО добавлять любые новые вычисления, циклы, проходы массивов или проверки на стороне CPU (включая \`src/core/world.ts\`, \`systems/\`, \`gen/\`).
> ВСЯ нагрузка по вычислению Ambient Occlusion должна быть перенесена исключительно во фрагментный шейдер WebGL (\`FRAG_SRC\` в \`src/render/webgl.ts\`).
> 
> **КОНКУРЕНТНЫЙ ДОСТУП:** Параллельно с тобой еще 4 агента редактируют \`src/render/webgl.ts\` (Reflections, Normal Mapping, God Rays, Tonemapping).
> Твоя задача — сделать изменения максимально изолированно. Не переписывай весь шейдер. Добавляй свои функции как отдельные блоки \`/* AO INJECTION */\` и делай точечные вызовы.

## Цель
Добавить Screen-Space / Voxel Ambient Occlusion (угловые тени) в DDA-рейкастер для придания объема стыкам стен, дверным проемам и внутренним углам. Фича должна вычисляться **только на GPU** и только при \`uLightQuality >= 3\`.

## Контекст и Архитектура
\`webgl.ts\` — красный файл (integrator-owned). Рендер реализован через WebGL2 DDA рейкастинг в полноэкранном фрагментном шейдере (\`FRAG_SRC\`). 
AO в нашем воксельном/grid-based движке — это проверка соседних тайлов вокруг точки попадания луча (hit point) на наличие твердых стен.

Так как CPU трогать нельзя, GPU будет самостоятельно опрашивать текстуру карты \`uCells\` через \`texelFetch\` вокруг найденной точки попадания.

## План Реализации (Workflow)

### 1. Подготовка и Изучение
- Открой \`src/render/webgl.ts\` и изучи фрагментный шейдер \`FRAG_SRC\`. Обрати особое внимание на секции \`── Wall ──\` и вызовы \`applyLightFX\`.
- Найди, как читаются данные из карты: \`texelFetch(uCells, ...)\` и проверь типы клеток (0 - воздух, \`Cell.WALL\`, \`Cell.DOOR\` и т.д.).
- Убедись, что ты понимаешь, как интерполируются константы (например, \`\${Cell.ABYSS}u\`) в строку шейдера. Никаких магических чисел.

### 2. Внедрение GLSL Функции AO (Только GPU)
Добавь функцию \`computeVoxelAO\` в секцию утилит фрагментного шейдера. Функция должна принимать координату клетки (\`hitCell\`), нормаль (\`wN\`) и карту (\`cellMap\`), а затем проверять две соседние клетки слева и справа относительно нормали, чтобы определить, есть ли там углы/затенение.

\`\`\`glsl
/* --- AO INJECTION START --- */
float computeVoxelAO(ivec2 cell, vec2 normal, highp usampler2D cellMap) {
    // Вычисляем только на высоких настройках качества графики
    if (uLightQuality < 3) return 1.0;
    
    // Определяем перпендикуляр к нормали для проверки соседних блоков
    vec2 tangent = vec2(-normal.y, normal.x);
    ivec2 t1 = ivec2(tangent);
    ivec2 t2 = ivec2(-tangent);
    
    // Проверяем соседние блоки по диагонали внутрь угла
    // Смещение на -normal проверяет соседнюю клетку, а +t1/+t2 проверяет угловые
    ivec2 checkPos1 = cell - ivec2(normal) + t1;
    ivec2 checkPos2 = cell - ivec2(normal) + t2;
    
    uint c1 = texelFetch(cellMap, checkPos1, 0).r;
    uint c2 = texelFetch(cellMap, checkPos2, 0).r;
    
    float ao = 1.0;
    
    // Используем константы движка (интерполированные в строку)
    // Предположим \${Cell.WALL}u, \${Cell.DOOR}u, \${Cell.HERMETIC_DOOR}u
    bool isSolid1 = (c1 != 0u && c1 != \${Cell.ABYSS}u && c1 != \${Cell.WATER}u);
    bool isSolid2 = (c2 != 0u && c2 != \${Cell.ABYSS}u && c2 != \${Cell.WATER}u);
    
    if (isSolid1) ao -= 0.35;
    if (isSolid2) ao -= 0.35;
    
    return max(0.3, ao);
}
/* --- AO INJECTION END --- */
\`\`\`
*(Обязательно проверь реальные типы клеток в \`src/core/types.ts\` и вставь правильные проверки)*

### 3. Применение AO к Стенам
Внутри главного цикла отрисовки стен (\`if (hit) { ... }\`), где вычисляется итоговый цвет и свет стены (\`c = applyLightFX(...)\`), добавь точечное применение AO.

\`\`\`glsl
// Точечное внедрение AO для стен
float voxelAO = computeVoxelAO(hitCell, wN, uCells);
c *= voxelAO; // Применяем затенение к цвету
\`\`\`

### 4. Применение AO к Полу (Опционально, Только GPU)
Для пола (\`── Floor ──\`) координаты клетки уже известны (\`fCell\`). Можно проверять соседние клетки крестом (N, S, E, W) на факт наличия стен. Если стена рядом, затемняем пиксель пола в зависимости от дистанции до края клетки.
Это тоже делается **исключительно внутри шейдера**.

\`\`\`glsl
/* --- FLOOR AO INJECTION --- */
float computeFloorAO(ivec2 cell, vec2 worldPos, highp usampler2D cellMap) {
    if (uLightQuality < 3) return 1.0;
    
    vec2 localPos = fract(worldPos);
    float ao = 1.0;
    
    // Проверка 4 соседей
    uint nN = texelFetch(cellMap, cell + ivec2(0, -1), 0).r;
    uint nS = texelFetch(cellMap, cell + ivec2(0, 1), 0).r;
    uint nE = texelFetch(cellMap, cell + ivec2(1, 0), 0).r;
    uint nW = texelFetch(cellMap, cell + ivec2(-1, 0), 0).r;
    
    // Если сосед - стена, затемняем край
    if (nN != 0u && nN != \${Cell.ABYSS}u) { if (localPos.y < 0.2) ao -= (0.2 - localPos.y) * 2.0; }
    if (nS != 0u && nS != \${Cell.ABYSS}u) { if (localPos.y > 0.8) ao -= (localPos.y - 0.8) * 2.0; }
    if (nW != 0u && nW != \${Cell.ABYSS}u) { if (localPos.x < 0.2) ao -= (0.2 - localPos.x) * 2.0; }
    if (nE != 0u && nE != \${Cell.ABYSS}u) { if (localPos.x > 0.8) ao -= (localPos.x - 0.8) * 2.0; }
    
    return max(0.4, ao);
}
/* -------------------------- */
\`\`\`

### 5. Архитектурные Ограничения и Валидация
- **CPU Bottleneck:** Запрещено вычислять AO-карты на CPU при загрузке или в реальном времени. Все вычисления - только через \`texelFetch\` в WebGL.
- **Ограничения Циклов:** Шейдер должен оставаться легким. Используй максимум 2-4 \`texelFetch\` на фрагмент для AO. Не используй циклы \`for\` для обхода 3x3 если можно обойтись хардкодом 4 выборок.
- **Сохраняй стиль кода** (отступы, именование).
- **Изолированность:** Делай патчи минимальными \`String.replace\` или аккуратным добавлением, чтобы не мешать другим агентам, работающим над этим же файлом.

### 6. Проверка и Билд (QA)
- Запусти \`npm run check:readonly\` чтобы убедиться, что типы не сломаны (хотя мы меняем только конкатенацию строк).
- Убедись, что шейдер компилируется. В WebGL опечатки в шейдерах не видны в TypeScript. Вызови \`npm run smoke\` и/или \`npm run check:browser\` (или проверь через dev-сервер визуально).
- Включи настройку графики "Экспериментальная" (или \`SMOKE_LIGHTING_MODE=experimental npm run smoke\`) чтобы сработал \`uLightQuality >= 3\`.
`;

fs.writeFileSync(shaders1Path, newShaders1Content, 'utf-8');

const lightContent = fs.readFileSync(lightPath, 'utf-8');
const appendedLightContent = lightContent + '\n\n### P6: Voxel Ambient Occlusion (AO)\n\n' + newShaders1Content;
fs.writeFileSync(lightPath, appendedLightContent, 'utf-8');

console.log('Successfully updated shaders_1.md and appended to light.md');
