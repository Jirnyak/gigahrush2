# План Агента: marx_53
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №53.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Самосбор: Сплошной Туман (шейдеры/плотность).**

### Контекст задачи
Во время события "Самосбор" атмосфера должна кардинально меняться. Видимость должна падать с условных 15 клеток до 3-5 клеток за счет густого тумана. При наступлении (warning phase) плотность тумана плавно увеличивается за 30 секунд. Также цвет тумана зависит от варианта Самосбора (обычный, мясной, мокрый). Противогаз (marx_71/54) должен позволять видеть дальше.

### Детальная спецификация по Архитектуре и Реализации

#### 1. Модификация `src/render/webgl.ts` (или `shader_programs.ts`)
Убедитесь, что шейдер поддерживает униформы `u_fogDensity` и `u_fogColor`.
Если шейдер использует экспоненциальный туман: `visibility = exp(-u_fogDensity * distance)`.
```glsl
// Concept stub for fragment shader
uniform float u_fogDensity;
uniform vec3 u_fogColor;
// ...
float fogFactor = clamp(exp(-u_fogDensity * distToCamera), 0.0, 1.0);
finalColor = mix(u_fogColor, texColor * lighting, fogFactor);
```
В функции рендера кадра добавьте передачу этих значений.
```typescript
// Stub for src/render/webgl.ts
export function applyFogUniforms(gl: WebGLRenderingContext, program: WebGLProgram, density: number, color: [number, number, number]) {
    const densityLoc = gl.getUniformLocation(program, 'u_fogDensity');
    const colorLoc = gl.getUniformLocation(program, 'u_fogColor');
    gl.uniform1f(densityLoc, density);
    gl.uniform3fv(colorLoc, color);
}
```

#### 2. Управление состоянием в `src/systems/samosbor.ts` (или `samosbor_hooks.ts`)
В системном стейте необходимо плавно интерполировать параметры тумана.
```typescript
// Stub for src/systems/samosbor.ts
import { SamosborVariant } from '../data/samosbor_variants';

export interface SamosborRenderState {
    targetFogDensity: number;
    currentFogDensity: number;
    targetFogColor: [number, number, number];
    currentFogColor: [number, number, number];
}

const NORMAL_FOG_DENSITY = 0.02;
const SAMOSBOR_FOG_DENSITY = 0.15;

export function updateSamosborFog(world: World, dt: number) {
    const state = world.samosbor;
    const renderState = world.renderState.samosbor; // Assuming render state proxy
    
    if (state.isActive || state.phase === 'warning') {
        renderState.targetFogDensity = SAMOSBOR_FOG_DENSITY;
        renderState.targetFogColor = getSamosborColor(state.variant);
    } else {
        renderState.targetFogDensity = NORMAL_FOG_DENSITY;
        renderState.targetFogColor = [0.1, 0.1, 0.1]; // Default dark grey
    }
    
    // Lerp (плавный переход за 30 секунд при warning)
    const lerpSpeed = state.phase === 'warning' ? (1.0 / 30.0) * dt : 2.0 * dt;
    renderState.currentFogDensity += (renderState.targetFogDensity - renderState.currentFogDensity) * lerpSpeed;
    
    // Lerp для цвета (поэлементно)
    for (let i=0; i<3; i++) {
        renderState.currentFogColor[i] += (renderState.targetFogColor[i] - renderState.currentFogColor[i]) * lerpSpeed;
    }
}

function getSamosborColor(variant: SamosborVariant): [number, number, number] {
    switch(variant) {
        case 'meat': return [0.7, 0.1, 0.1]; // 180,30,30 normalized
        case 'wet': return [0.4, 0.47, 0.55]; // 100,120,140 normalized
        default: return [0.31, 0.0, 0.47]; // 80,0,120 Purple for classic samosbor
    }
}
```

#### 3. Связь с экипировкой (Противогаз)
В `webgl.ts` перед отправкой `density` в шейдер проверьте состояние игрока:
```typescript
let actualDensity = renderState.currentFogDensity;
if (world.player.inventory.hasEquipped('gas_mask')) {
    actualDensity *= 0.5; // Противогаз снижает плотность тумана в 2 раза
}
applyFogUniforms(gl, program, actualDensity, renderState.currentFogColor);
```

#### 4. Тестирование и валидация
- Запустить `npm run check:full` для проверки интеграции с WebGL типами.
- Убедиться, что при вызове события `triggerSamosbor('wet')` цвет тумана плавно становится сине-серым.
- Убедиться, что нет хардкода: цвета и лимиты берутся из констант, зависящих от `samosbor_variants.ts`.

## Ваши шаги:
1. Изучить шейдеры в `src/render/webgl.ts` (или где хранятся GLSL строки).
2. Реализовать логику `updateSamosborFog` в `systems/samosbor.ts`.
3. Обновить render loop для передачи униформ.
4. Убедиться, что `SamosborVariant` импортируется корректно из `data/`.
5. Сделать `git commit -m "feat(render): implement dense volumetric fog for samosbor variants"` и оформить PR.

---
*Ожидается, что вы завершите задачу и оставите проект в компилируемом состоянии без сломанных тестов.*
