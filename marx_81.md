# План Агента: marx_81
## Роль
Вы — один из 100 агентов, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №81.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность.
5. **Максимальная независимость:** Работайте параллельно.
6. **Полная автономность:** Принимайте архитектурные решения самостоятельно.

## Текущая задача
**Перезарядка и ловкость**

### Контекст задачи
Разобраться с перезарядкой оружия и влиянием ловкости. Ловкость (Agility) должна влиять на скорость перезарядки как асимптотический ускоритель (убывающая отдача). Это означает, что первые очки ловкости дают сильный буст, а последующие — все меньший, не позволяя скорости перезарядки стать мгновенной (0 кадров/секунд).

### Конкретные файлы и паттерны
- **`src/systems/combat.ts`**
- **`src/systems/inventory.ts`**
- **`src/systems/rpg_stats.ts`** (или эквивалент, где хранится ловкость)
- **`src/data/weapons.ts`**

## Подробный Workflow реализации

### Шаг 1. Анализ контрактов статов и перезарядки
1. Изучите `src/systems/combat.ts` на предмет функции, обрабатывающей таймер перезарядки оружия (`processReload()`, `updateWeaponCD()`).
2. Найдите базовое значение времени перезарядки в `src/data/weapons.ts` (например, `baseReloadTime`).
3. Изучите, как в текущей системе получаются статы игрока (Agility/Ловкость).

### Шаг 2. Разработка формулы асимптотического убывания
1. Формула должна иметь вид: `actualReloadTime = baseReloadTime / (1 + k * agility)` или `baseReloadTime * (MIN_RELOAD_MULTIPLIER + (1 - MIN_RELOAD_MULTIPLIER) * Math.exp(-k * agility))`.
2. Убедитесь, что `actualReloadTime` никогда не опускается ниже хардкап минимума (например, 20% от базового времени).

### Шаг 3. Интеграция формулы в `systems/combat.ts`
1. Найдите место, где устанавливается кулдаун перезарядки.
2. Вместо простого присвоения `cooldown = weapon.reloadTime`, вызывайте чистую функцию-хелпер, вычисляющую итоговое время с учетом статов.

```typescript
// Stub: src/systems/combat_helpers.ts (или внутри combat.ts)
export function calculateReloadTime(baseReload: number, agility: number): number {
    const MIN_RELOAD_RATIO = 0.25; // 25% is the maximum possible speedup
    const k = 0.05; // Scaling factor
    
    // Asymptotic formula
    const multiplier = MIN_RELOAD_RATIO + (1 - MIN_RELOAD_RATIO) * Math.exp(-k * agility);
    return Math.max(1, Math.round(baseReload * multiplier));
}
```

### Шаг 4. Обновление стейта перезарядки
1. Если перезарядка прерывается (например, убрал оружие), проверьте, сохраняется ли прогресс или сбрасывается.
2. При смене статов (например, выпил стимулятор) во время перезарядки: решите, обновляется ли таймер динамически или формула считается только в момент начала перезарядки (второе — проще и стабильнее).

### Шаг 5. Привязка к инвентарю и UI
1. В инвентаре или окне статов игрок должен видеть влияние ловкости.
2. Если есть тултип оружия, обновляйте отображаемое "Время перезарядки", используя ту же функцию `calculateReloadTime`.

```typescript
// Stub: src/render/ui_inventory.ts
const displayReload = calculateReloadTime(weapon.baseReload, player.stats.agility);
ui.drawText(`Reload: ${displayReload.toFixed(1)}s`);
```

### Шаг 6. Написание юнит-тестов
1. Создайте `tests/combat-reload-agility.test.ts`.
2. Напишите тесты для `calculateReloadTime`:
   - При `agility = 0`, время должно быть равно базовому.
   - При `agility = 10`, время должно быть меньше базового.
   - При `agility = 100`, время не должно упасть ниже `MIN_RELOAD_RATIO`.

```typescript
// Stub: tests/combat-reload-agility.test.ts
import { test } from 'node:test';
import { assert } from 'node:assert';
import { calculateReloadTime } from '../src/systems/combat';

test('Agility asymptotically reduces reload time', () => {
    const base = 100;
    const t0 = calculateReloadTime(base, 0);
    const t10 = calculateReloadTime(base, 10);
    const t100 = calculateReloadTime(base, 100);
    
    assert.strictEqual(t0, 100);
    assert.ok(t10 < t0);
    assert.ok(t100 < t10);
    assert.ok(t100 >= 25); // assuming 0.25 min ratio
});
```

### Шаг 7. Валидация и проверка производительности
1. Запустите `npm run typecheck` и `npm run test:unit`.
2. Сделайте `npm run check:full`.
3. Запустите игру в браузере, прокачайте ловкость через дебаг-панель и проверьте скорость перезарядки визуально.

### Шаг 8. Оформление PR
1. Убедитесь, что нет хардкода конкретных ID оружия.
2. Создайте коммит: `feat(combat): implement asymptotic agility scaling for weapon reload time`.
3. Убедитесь, что лог изменений не затрагивает другие механики оружия.
