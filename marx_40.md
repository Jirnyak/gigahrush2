# План Агента: marx_40

## Роль
Вы — один из агентов Jules, выполняющих МЕГА-АПДЕЙТ для проекта ГИГАХРУЩ. Ваша задача №40.
Вы действуете полностью автономно. От вас ожидается реализация фичи от начала до конца, включая написание кода, интеграцию с архитектурой и проверку работоспособности.

## ⚠️ ОБЩИЕ ПРАВИЛА ДЛЯ ВСЕХ АГЕНТОВ (AGENTS.md)
1. **Никакого хардкода и костылей.** Системы должны быть расширяемыми и опираться на `src/data/`.
2. **Пятислойная архитектура:** `core/` -> `data/` -> `gen/` -> `systems/` -> `render/`. Никакого геймплея в `render/`.
3. **Iron Law (Оптимизация):** Никаких тяжелых поисков (BFS) в реалтайме во время симуляции.
4. Уважайте мобильную платформу и производительность (без лишних DOM манипуляций).
5. **Максимальная независимость:** Все агенты (Жюли) работают параллельно и абсолютно независимо друг от друга.
6. **Полная автономность:** НЕ задавайте пользователю вопросы и не просите советов. Обязательно принимайте все архитектурные, кодовые и дизайнерские решения самостоятельно!
7. **Обязательный коммит и PR:** Обязательно делайте `git commit` ваших изменений и создавайте Pull Request (или делайте пуш) после завершения работы.

## Текущая задача
**Контент: Добавить фракционные торговцы на Базу Ликвидаторов с уникальным ассортиментом.**

### Контекст задачи
На Базе Ликвидаторов должен появиться полноценный торговый хаб. В нём будут: 
1) оружейник (продаёт оружие/патроны), 
2) медик (медикаменты), 
3) квартирмейстер (снаряжение/броня). 
Каждый — это уникальный NPC с соответствующим инвентарем и ценами.

### Конкретные файлы и паттерны
- **`src/data/plot.ts`** / **`src/data/npc_plot_packages.ts`**: Зарегистрировать 3 торговых NPC через `registerNpcPackageFromPlotNpc()`. Occupation: `Occupation.HUNTER` (оружейник), `Occupation.MEDIC` (медик), `Occupation.ENGINEER` (квартирмейстер).
- **`src/gen/design_floors/liquidatorbase.ts`**: Заспавнить их в профильных комнатах: оружейная (`RoomType.STORAGE`), медпункт (`RoomType.MEDICAL`), штаб (`RoomType.HQ`).
- **`src/data/occupation_profiles.ts`**: ИНВЕНТАРЬ — НЕ ХАРДКОДИТЬ! Использовать СУЩЕСТВУЮЩУЮ систему: `generateNpcTradeItems(npc)`. Если для Ликвидаторов нужен специфический ассортимент — расширить профили `tradeItems` для HUNTER (оружие), MEDIC (медикаменты), ENGINEER (снаряжение).
- **Ценообразование**: Использовать `src/systems/economy.ts` — scarcity-adjusted система.

### Детальная спецификация по Архитектуре и Реализации (Строго обязательно к исполнению)

#### Шаг 1: Расширение профилей профессий в `data/occupation_profiles.ts`
Вам необходимо обновить данные о продаваемых предметах (tradeItems) для нужных профессий с учетом фракции Ликвидаторов (если требуется уникальный список).
Пример заглушки для изменения `occupation_profiles.ts`:
```ts
// src/data/occupation_profiles.ts
export const OCCUPATION_PROFILES: Record<Occupation, OccupationProfile> = {
  // ... existing code ...
  [Occupation.HUNTER]: {
    tradeItems: ['ak47', 'shotgun', 'ammo_9mm', 'ammo_12g'], // Дополнить список
    // ...
  },
  [Occupation.MEDIC]: {
    tradeItems: ['bandage', 'medkit', 'stimpack', 'antirad'],
    // ...
  },
  [Occupation.ENGINEER]: {
    tradeItems: ['toolkit', 'armor_plate', 'gas_mask', 'battery'],
    // ...
  }
};
// Добавить специфичные для фракции Ликвидаторов предметы в FACTION_TRADE_OFFERS
export const FACTION_TRADE_OFFERS: TradeOfferDef[] = [
  // ... existing code ...
  { faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER, items: ['heavy_rifle', 'frag_grenade'], minRank: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.MEDIC, items: ['military_medkit'], minRank: 2 },
  { faction: Faction.LIQUIDATOR, occupation: Occupation.ENGINEER, items: ['heavy_armor', 'exoskeleton_part'], minRank: 3 },
];
```

#### Шаг 2: Регистрация сюжетных NPC в `data/plot.ts`
Создать плот-определения для торговцев.
```ts
// src/data/plot.ts
export const PLOT_NPCS: Record<string, PlotNpcDef> = {
  // ... existing code ...
  'liq_armorer': {
    id: 'liq_armorer',
    name: 'Капитан Броня',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    role: NpcRole.TRADER,
  },
  'liq_medic': {
    id: 'liq_medic',
    name: 'Доктор Смерть',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.MEDIC,
    role: NpcRole.TRADER,
  },
  'liq_quartermaster': {
    id: 'liq_quartermaster',
    name: 'Снабженец Петрович',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.ENGINEER,
    role: NpcRole.TRADER,
  }
};
```
И зарегистрировать их пакеты в `src/data/npc_plot_packages.ts`.

#### Шаг 3: Спавн торговцев на генерации базы Ликвидаторов
В файле `src/gen/design_floors/liquidatorbase.ts` найти этап заполнения комнат NPC и добавить спавн сюжетных торговцев в соответствующие комнаты.
```ts
// src/gen/design_floors/liquidatorbase.ts
import { spawnPlotNpc } from '../living/spawn_helpers';

// Внутри функции генерации, после того как комнаты определены:
const armory = rooms.find(r => r.type === RoomType.STORAGE);
if (armory) spawnPlotNpc(world, 'liq_armorer', armory.center.x, armory.center.y);

const medbay = rooms.find(r => r.type === RoomType.MEDICAL);
if (medbay) spawnPlotNpc(world, 'liq_medic', medbay.center.x, medbay.center.y);

const hq = rooms.find(r => r.type === RoomType.HQ);
if (hq) spawnPlotNpc(world, 'liq_quartermaster', hq.center.x, hq.center.y);
```

#### Шаг 4: Интеграция с системой торговли
Убедитесь, что торговый диалог корректно инициализирует список товаров через `generateNpcTradeItems(npc)`.
Никакого хардкода в UI — все товары и их цены подтягиваются динамически.

### QA и Тестирование
1. Сгенерируйте Базу Ликвидаторов.
2. Найдите трех торговцев (оружейник, медик, снабженец).
3. Подойдите к каждому и откройте интерфейс торговли.
4. Проверьте ассортимент: оружейник продает ТОЛЬКО оружие и патроны, медик ТОЛЬКО медикаменты и т.д.
5. Убедитесь, что уникальные предметы фракции (например, военная аптечка) доступны только у Ликвидаторов.
6. Выполните `npm run typecheck` и `npm run check`.

### Требования к PR
- Только изменения в `src/data/occupation_profiles.ts`, `src/data/plot.ts`, `src/gen/design_floors/liquidatorbase.ts`.
- Полное отсутствие захардкоженных списков товаров внутри компонентов UI.
- Описание архитектурных изменений (как расширены профили).
- Отсутствие геймплейной логики в `render` и `gen` — генератор только спавнит NPC.

---
*Ожидается, что вы полностью автономно завершите задачу и оставите проект в компилируемом состоянии.*
