# План Агента: marx_68
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №68.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Интерфейс: Улучшение UI окон, поддержка слота брони и резистов.**



### Контекст задачи
Редизайн инвентаря: слот брони, отображение резистов и типов урона оружия.

### Конкретные файлы и паттерны
- **`src/render/stats_ui.ts`**: Текущий inventory view (8x8 grid). Добавьте:
  - Отдельный слот «БРОНЯ» сбоку от сетки.
  - При наведении на оружие — показать `DamageType` (от marx_50) иконкой/текстом.
  - При наведении на броню — показать resistances per damage type.
- **`src/data/items.ts`**: `ItemDef.resistances` (от marx_53).
- **Layout**: Слот брони — большой квадрат 2x размера обычного слота, под основной сеткой или справа.
- **Цвета**: Иконки типов урона: 🔴 огонь, 🔵 энерго, 🟣 пси, ⚫ кинетика, 🟡 дробь.


### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

Для успешного выполнения задачи агент (Jules) должен следовать этому пошаговому плану. Цель — расширить инвентарный UI, добавив специализированный слот для брони и отображение статистик сопротивлений (резистов) игрока.

#### 1. Модель Данных Брони и Резистов (Слой `data/`)
Определите типы урона и структуру данных для брони.

```typescript
// В src/data/items.ts
export enum DamageType {
    FIRE = 'FIRE',
    ENERGY = 'ENERGY',
    PSI = 'PSI',
    KINETIC = 'KINETIC',
    ACID = 'ACID'
}

export interface ArmorStats {
    [DamageType.FIRE]: number;
    [DamageType.ENERGY]: number;
    [DamageType.PSI]: number;
    [DamageType.KINETIC]: number;
    [DamageType.ACID]: number;
}

export interface ItemDef {
    // ...
    armorStats?: ArmorStats; // Если предмет является броней
}
```

#### 2. Инвентарь Сущности (Слой `core/`)
Добавьте слот брони непосредственно в сущность или инвентарь игрока.

```typescript
// В src/core/entity.ts
export interface Inventory {
    items: Item[];
    equippedWeapon?: string; // ID предмета
    equippedArmor?: string;  // ID предмета брони
}
```

#### 3. Расчет Резистов (Слой `systems/`)
Создайте функцию для динамического расчета защиты.

```typescript
// В src/systems/combat_math.ts
export function getPlayerResistances(player: Entity): ArmorStats {
    const baseResist = { FIRE: 0, ENERGY: 0, PSI: 0, KINETIC: 0, ACID: 0 };
    
    if (!player.inventory.equippedArmor) return baseResist;
    
    const armorItem = player.inventory.items.find(i => i.id === player.inventory.equippedArmor);
    if (armorItem && armorItem.def.armorStats) {
        return armorItem.def.armorStats;
    }
    
    return baseResist;
}
```

#### 4. Рендеринг UI Инвентаря (Слой `render/UI`)
Отрисуйте слот 2x размера и блок с иконками резистов.

```typescript
// В src/render/inventory_ui.ts
export function drawInventory(ctx: CanvasRenderingContext2D, player: Entity) {
    // ... отрисовка обычной сетки инвентаря
    
    // Слот брони (увеличенный)
    const armorSlotX = 300;
    const armorSlotY = 50;
    ctx.strokeRect(armorSlotX, armorSlotY, 64, 64); // 2x размер (если обычный 32)
    ctx.fillText("БРОНЯ", armorSlotX, armorSlotY - 5);
    
    if (player.inventory.equippedArmor) {
        // Отрисовка иконки надетой брони
        const armorItem = player.inventory.items.find(i => i.id === player.inventory.equippedArmor);
        drawItemIcon(ctx, armorItem, armorSlotX, armorSlotY, 64);
    }
    
    // Отрисовка резистов
    const resists = getPlayerResistances(player);
    let rx = 300;
    let ry = 130;
    
    const resistColors = {
        FIRE: 'red', ENERGY: 'blue', PSI: 'purple', KINETIC: 'gray', ACID: 'green'
    };
    
    for (const [type, value] of Object.entries(resists)) {
        ctx.fillStyle = resistColors[type];
        ctx.beginPath();
        ctx.arc(rx + 10, ry + 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.fillText(`${value}%`, rx + 25, ry + 15);
        ry += 20;
    }
}
```

#### 5. Порядок реализации (Чеклист для агента Jules)
1. **Данные:** Расширить `ItemDef` полем `armorStats`. Завести константы `DamageType`.
2. **Стейт:** Добавить `equippedArmor` в `Inventory`.
3. **Расчет:** Реализовать функцию агрегации защиты `getPlayerResistances`.
4. **Взаимодействие:** Добавить логику эквипа/анэквипа предмета типа броня по двойному клику в инвентаре.
5. **UI:** Перерисовать окно инвентаря: выделить большое место (2x2 ячейки) под слот брони и колонку/строку с иконками текущего поглощения урона.

#### 6. Требования к верификации, коммиту и PR
* Выполните `npm run typecheck` и `npm run check:full`.
* Запустите игру и проверьте, что надевание брони изменяет цифры в блоке резистов.
* Формат коммита: `feat(ui): add dedicated armor slot and damage resistances panel`.

---
*Вы — независимый агент Jules. Ваша цель — надежный, протестированный код, строго соблюдающий архитектурные границы. Выполните задачу, закоммитьте код и завершите сессию.*
