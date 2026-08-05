# План Агента: marx_67
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №67.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Интерфейс: Улучшение шрифтов (читаемость, сглаживание).**



### Контекст задачи
Шрифты: 1) Min 12px (бывает 8-9 — нечитаемо). 2) Outline/shadow 1px dark для контраста. 3) Bold для мелких. 4) Проверить читаемость на СВЕТЛОМ фоне (белые стены Министерства!). 5) Лог: увеличить line-height, полупрозрачный backdrop.

### Конкретные файлы и паттерны
- **`src/render/hud.ts`**: Все тексты рисуются через Canvas 2D API (`ctx.fillText()`). Найдите `ctx.font = '...'`.
- **Шрифт**: Текущий — скорее всего system sans-serif. Замените на pixel-perfect или добавьте text shadow для читаемости:
  ```ts
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ```
- **Контрастность**: Белый текст на тёмном фоне. Добавьте полупрозрачную подложку под текст.
- **`src/render/`**: Проверьте ВСЕ _ui.ts файлы — шрифт должен быть единообразным.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — улучшить рендеринг шрифтов в Canvas/WebGL, обеспечив читаемость пиксель-арта на разных разрешениях и плотностях пикселей (High DPI/Retina).

#### 1. Адаптация под High DPI (Слой `render/`)
Проблема мыльных шрифтов на мобильных и макбуках решается через `window.devicePixelRatio`.

```typescript
// В src/render/canvas_setup.ts или src/render/hud.ts
export function setupCanvasResolution(canvas: HTMLCanvasElement, width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    
    // Устанавливаем физическое разрешение
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    
    // Устанавливаем CSS размер
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
        // Нормализуем координаты
        ctx.scale(dpr, dpr);
        
        // Отключаем сглаживание для пиксель-арта
        ctx.imageSmoothingEnabled = false;
    }
}
```

#### 2. Загрузка Пиксельного Шрифта (Слой `render/` / CSS)
Используйте кастомный веб-шрифт для сохранения стилистики "Гигахруща", избегая стандартных Arial/Times.

```css
/* В index.css или assets/fonts.css */
@font-face {
    font-family: 'GigahrushPixel';
    src: url('./fonts/GigahrushPixel.woff2') format('woff2');
    font-weight: normal;
    font-style: normal;
}

/* Для DOM элементов UI */
body {
    font-family: 'GigahrushPixel', monospace;
    /* Отключение антиалиасинга браузера для четких пикселей */
    -webkit-font-smoothing: none;
    font-smooth: never; 
}
```

#### 3. Рендеринг текста на Canvas (Слой `render/`)
При отрисовке текста в Canvas2D необходимо использовать округленные координаты, чтобы избежать субпиксельного размытия.

```typescript
// В src/render/ui_helpers.ts
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string = '#FFF') {
    ctx.font = '16px "GigahrushPixel", monospace';
    ctx.fillStyle = color;
    
    // Округление до целого пикселя критически важно для резкости!
    const rx = Math.round(x);
    const ry = Math.round(y);
    
    // Опционально: тень для читаемости на пестром фоне
    ctx.fillStyle = '#000';
    ctx.fillText(text, rx + 1, ry + 1);
    
    ctx.fillStyle = color;
    ctx.fillText(text, rx, ry);
}
```

#### 4. Решение проблемы предзагрузки шрифта
Canvas не отрисует кастомный шрифт, пока он не загружен браузером.

```typescript
// В src/main.ts или инициализаторе ассетов
export async function loadFonts() {
    const font = new FontFace('GigahrushPixel', 'url(./fonts/GigahrushPixel.woff2)');
    await font.load();
    document.fonts.add(font);
    console.log('Шрифт загружен и готов для Canvas');
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **DPI:** Настроить скейлинг canvas через `devicePixelRatio`.
2. **Шрифт:** Подключить `@font-face` (создать заглушку, если самого файла пока нет, использовать `monospace` как фоллбэк).
3. **Хелперы:** Написать функцию `drawPixelText` с принудительным `Math.round()` для X и Y.
4. **Тень:** Реализовать контур или каплю тени (+1px X/Y) для текста, чтобы он читался на белых стенах этажа.
5. **Асинхронность:** Добавить ожидание загрузки шрифта (`document.fonts.ready`) перед первым render pass интерфейса.

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run check:full`.
* Запустите сборку и откройте в браузере. Убедитесь, что при зуме или на Retina-дисплее текст не "мылится".
* Формат коммита: `fix(ui): implement High DPI canvas scaling and crisp pixel font rendering`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
